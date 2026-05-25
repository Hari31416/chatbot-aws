from __future__ import annotations

import re
from dataclasses import dataclass
from uuid import uuid4

from .vector_store import VectorStoreClient


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
    ) -> None:
        if chunk_size <= 0:
            raise ValueError("chunk_size must be positive")
        if chunk_overlap < 0 or chunk_overlap >= chunk_size:
            raise ValueError("chunk_overlap must be smaller than chunk_size")
        self.vector_store = vector_store
        self.chunk_size = chunk_size
        self.chunk_overlap = chunk_overlap

    async def ingest_document(
        self, filename: str, content: str, user_id: str
    ) -> RagIngestResult:
        chunks = self.split_text(content)
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
