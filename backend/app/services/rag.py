from __future__ import annotations

import logging
import re
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
        self, filename: str, content: str, user_id: str, document_id: str | None = None
    ) -> RagIngestResult:
        chunks = self.split_text(content)
        if not document_id:
            document_id = str(uuid4())
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
        )
        return RagIngestResult(
            document_id=document_id,
            chunks_ingested=len(chunks),
        )

    async def ingest_binary_document(
        self, filename: str, data: bytes, mime_type: str, user_id: str, document_id: str | None = None
    ) -> RagIngestResult:
        import os
        import asyncio
        from anyio import to_thread
        from uuid import uuid4

        if not self.s3_client or not self.s3_bucket_name or not self.textract_client:
            raise ValueError("S3 and Textract clients must be configured to process binary documents")

        if not document_id:
            document_id = str(uuid4())
        extension = os.path.splitext(filename.lower())[1] or ""
        s3_key = f"rag-raw-uploads/{user_id}/{document_id}{extension}"

        # 1. Upload raw binary to S3
        logger.info("Uploading raw binary document filename=%s user_id=%s s3_key=%s", filename, user_id, s3_key)
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
                    lambda: self.textract_client.get_document_text_detection(JobId=job_id)
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

            # 5. Extract text lines
            lines = []
            for block in blocks:
                if block.get("BlockType") == "LINE":
                    text = block.get("Text")
                    if text:
                        lines.append(text)
            extracted_text = "\n".join(lines)
            logger.info(
                "Extracted %d lines (%d chars) from document=%s",
                len(lines),
                len(extracted_text),
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

        # 7. Split text and upsert to vector store
        chunks = self.split_text(extracted_text)
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
