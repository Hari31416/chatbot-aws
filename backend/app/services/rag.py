from __future__ import annotations

import asyncio
import logging
import re
import time
from dataclasses import dataclass
from typing import Any
from uuid import uuid4

from .vector_store import VectorStoreClient

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class RagIngestResult:
    document_id: str
    chunks_ingested: int


class RagService:
    def __init__(
        self,
        vector_store: VectorStoreClient,
        chunk_size: int = 800,
        chunk_overlap: int = 80,
        s3_client: Any = None,
        s3_bucket_name: str | None = None,
        textract_client: Any = None,
    ) -> None:
        if chunk_size <= 0:
            raise ValueError("chunk_size must be positive")
        if chunk_overlap < 0 or chunk_overlap >= chunk_size:
            raise ValueError("chunk_overlap must be smaller than chunk_size")
        self.vector_store = vector_store
        self.chunk_size = chunk_size
        self.chunk_overlap = chunk_overlap
        self.s3_client = s3_client
        self.s3_bucket_name = s3_bucket_name
        self.textract_client = textract_client

    async def ingest_document(
        self,
        filename: str,
        content: str,
        user_id: str,
        document_id: str | None = None,
        tags: list[str] | None = None,
    ) -> RagIngestResult:
        chunks = self.split_text(content)
        if not document_id:
            document_id = str(uuid4())
        if not chunks:
            return RagIngestResult(document_id=document_id, chunks_ingested=0)

        # Exponential backoff retry around get_embeddings for rate-limit errors
        max_retries = 5
        base_delay = 2.0
        for attempt in range(max_retries):
            try:
                embeddings = await self.vector_store.get_embeddings(chunks)
                break
            except Exception as exc:
                err_str = str(exc).lower()
                is_rate_limit = any(
                    kw in err_str
                    for kw in ("rate", "429", "quota", "resource_exhausted")
                )
                if not is_rate_limit or attempt == max_retries - 1:
                    raise
                delay = base_delay * (2**attempt)
                logger.warning(
                    "Embedding rate-limit hit (attempt %d/%d), retrying in %.1fs: %s",
                    attempt + 1,
                    max_retries,
                    delay,
                    exc,
                )
                await asyncio.sleep(delay)

        keys = [f"{document_id}#chunk-{idx}" for idx in range(len(chunks))]
        await self.vector_store.upsert_chunks(
            keys=keys,
            texts=chunks,
            embeddings=embeddings,
            source_doc=filename,
            document_id=document_id,
            user_id=user_id,
            tags=tags,
        )
        return RagIngestResult(
            document_id=document_id,
            chunks_ingested=len(chunks),
        )

    async def fetch_textract_text(self, job_id: str) -> str:
        """Retrieve completed Textract results in a single pass (no polling).

        Paginates through all result pages, collects LINE-type blocks, and
        returns their text joined by newlines.  Raises ``ValueError`` if the
        job did not SUCCEED.
        """
        from anyio import to_thread

        if not self.textract_client:
            raise ValueError(
                "textract_client must be configured to fetch Textract text"
            )

        blocks: list[dict] = []
        next_token: str | None = None
        first_page = True

        while True:
            kwargs: dict[str, Any] = {"JobId": job_id}
            if next_token:
                kwargs["NextToken"] = next_token

            page_res = await to_thread.run_sync(
                lambda: self.textract_client.get_document_text_detection(**kwargs)
            )

            if first_page:
                job_status = page_res.get("JobStatus", "")
                if job_status != "SUCCEEDED":
                    raise ValueError(
                        f"Textract job {job_id!r} did not succeed: status={job_status!r}, "
                        f"message={page_res.get('StatusMessage', '')!r}"
                    )
                pages_count = page_res.get("DocumentMetadata", {}).get("Pages", 1)
                logger.info(
                    "fetch_textract_text job_id=%s pages=%d", job_id, pages_count
                )
                first_page = False

            blocks.extend(page_res.get("Blocks", []))
            next_token = page_res.get("NextToken")
            if not next_token:
                break

        lines = [
            block["Text"]
            for block in blocks
            if block.get("BlockType") == "LINE" and block.get("Text")
        ]
        logger.info(
            "fetch_textract_text job_id=%s extracted %d lines", job_id, len(lines)
        )
        return "\n".join(lines)

    async def ingest_binary_document(
        self,
        filename: str,
        data: bytes,
        mime_type: str,
        user_id: str,
        document_id: str | None = None,
        tags: list[str] | None = None,
    ) -> RagIngestResult:
        import os
        import asyncio
        from anyio import to_thread
        from uuid import uuid4

        if not self.s3_client or not self.s3_bucket_name or not self.textract_client:
            raise ValueError(
                "S3 and Textract clients must be configured to process binary documents"
            )

        if not document_id:
            document_id = str(uuid4())
        extension = os.path.splitext(filename.lower())[1] or ""
        s3_key = f"rag-raw-uploads/{user_id}/{document_id}{extension}"

        # 1. Upload raw binary to S3
        logger.info(
            "Uploading raw binary document filename=%s user_id=%s s3_key=%s",
            filename,
            user_id,
            s3_key,
        )
        await to_thread.run_sync(
            lambda: self.s3_client.put_object(
                Bucket=self.s3_bucket_name,
                Key=s3_key,
                Body=data,
                ContentType=mime_type,
            )
        )

        try:
            # 2. Trigger AWS Textract asynchronous parsing
            logger.info("Triggering Textract async parsing for s3_key=%s", s3_key)
            response = await to_thread.run_sync(
                lambda: self.textract_client.start_document_text_detection(
                    DocumentLocation={
                        "S3Object": {
                            "Bucket": self.s3_bucket_name,
                            "Name": s3_key,
                        }
                    }
                )
            )
            job_id = response["JobId"]
            logger.info("Textract parsing started job_id=%s", job_id)

            # 3. Poll for completion
            while True:
                poll_res = await to_thread.run_sync(
                    lambda: self.textract_client.get_document_text_detection(
                        JobId=job_id
                    )
                )
                status = poll_res["JobStatus"]
                if status == "SUCCEEDED":
                    break
                elif status == "FAILED":
                    raise ValueError(
                        f"Textract job failed: {poll_res.get('StatusMessage', 'Unknown error')}"
                    )
                await asyncio.sleep(1.5)

            # 4. Paginate and gather all blocks, enforcing page limit
            blocks = []
            next_token = None
            first_page = True

            while True:
                kwargs = {"JobId": job_id}
                if next_token:
                    kwargs["NextToken"] = next_token

                page_res = await to_thread.run_sync(
                    lambda: self.textract_client.get_document_text_detection(**kwargs)
                )

                if first_page:
                    pages_count = page_res.get("DocumentMetadata", {}).get("Pages", 1)
                    logger.info("Detected pages_count=%d", pages_count)
                    if pages_count > 100:
                        raise ValueError(
                            f"Document exceeds maximum page limit of 100 pages (got {pages_count} pages)"
                        )
                    first_page = False

                blocks.extend(page_res.get("Blocks", []))
                next_token = page_res.get("NextToken")
                if not next_token:
                    break

            # 5. Extract text lines grouped by page
            from collections import defaultdict

            lines_by_page = defaultdict(list)
            total_lines = 0
            total_chars = 0
            for block in blocks:
                if block.get("BlockType") == "LINE":
                    text = block.get("Text")
                    page = block.get("Page", 1)
                    if text:
                        lines_by_page[page].append(text)
                        total_lines += 1
                        total_chars += len(text)

            logger.info(
                "Extracted %d lines (%d chars) from %d pages in document=%s",
                total_lines,
                total_chars,
                len(lines_by_page),
                filename,
            )

        finally:
            # 6. Ensure S3 temporary raw file deletion
            try:
                logger.info("Cleaning up temporary raw file s3_key=%s", s3_key)
                await to_thread.run_sync(
                    lambda: self.s3_client.delete_object(
                        Bucket=self.s3_bucket_name,
                        Key=s3_key,
                    )
                )
            except Exception as e:
                logger.warning(
                    "Failed to clean up temporary raw file s3_key=%s: %s",
                    s3_key,
                    e,
                )

        # 7. Split text page-by-page and upsert to vector store
        chunks = []
        page_numbers = []
        for page in sorted(lines_by_page.keys()):
            page_text = "\n".join(lines_by_page[page])
            page_chunks = self.split_text(page_text)
            for chunk in page_chunks:
                chunks.append(chunk)
                page_numbers.append(page)

        if not chunks:
            return RagIngestResult(document_id=document_id, chunks_ingested=0)

        embeddings = await self.vector_store.get_embeddings(chunks)
        keys = [f"{document_id}#chunk-{idx}" for idx in range(len(chunks))]
        await self.vector_store.upsert_chunks(
            keys=keys,
            texts=chunks,
            embeddings=embeddings,
            source_doc=filename,
            document_id=document_id,
            user_id=user_id,
            page_numbers=page_numbers,
            tags=tags,
        )
        return RagIngestResult(
            document_id=document_id,
            chunks_ingested=len(chunks),
        )

    def split_text(self, text: str) -> list[str]:
        normalized = re.sub(r"\s+", " ", text).strip()
        if not normalized:
            return []
        if len(normalized) <= self.chunk_size:
            return [normalized]

        chunks: list[str] = []
        step = self.chunk_size - self.chunk_overlap
        start = 0
        while start < len(normalized):
            end = min(start + self.chunk_size, len(normalized))
            chunks.append(normalized[start:end].strip())
            if end == len(normalized):
                break
            start += step
        return [chunk for chunk in chunks if chunk]
