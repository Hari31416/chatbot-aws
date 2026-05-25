from __future__ import annotations

import logging
from collections.abc import Sequence
from functools import partial
from typing import Any

import boto3
from anyio import to_thread
from botocore.exceptions import ClientError
from litellm import embedding

logger = logging.getLogger(__name__)


class VectorStoreClient:
    def __init__(
        self,
        region_name: str,
        vector_bucket: str,
        index_name: str,
        embedding_model: str,
        dimension: int,
        gemini_api_key: str | None = None,
        endpoint_url: str | None = None,
    ) -> None:
        self.vector_bucket = vector_bucket
        self.index_name = index_name
        self.embedding_model = embedding_model
        self.dimension = dimension
        self.gemini_api_key = gemini_api_key
        self.client = boto3.client(
            "s3vectors",
            region_name=region_name,
            endpoint_url=endpoint_url,
        )
        logger.info(
            "VectorStoreClient initialized bucket=%s index=%s model=%s",
            vector_bucket,
            index_name,
            embedding_model,
        )

    def initialize_storage(self) -> None:
        try:
            self.client.create_vector_bucket(vectorBucketName=self.vector_bucket)
        except ClientError as exc:
            if not _is_already_exists_error(exc):
                logger.exception("Failed to create S3 vector bucket")
                raise
            logger.info("S3 vector bucket already exists bucket=%s", self.vector_bucket)

        try:
            self.client.create_index(
                vectorBucketName=self.vector_bucket,
                indexName=self.index_name,
                dataType="float32",
                dimension=self.dimension,
                distanceMetric="cosine",
                metadataConfiguration={"nonFilterableMetadataKeys": ["text"]},
            )
        except ClientError as exc:
            if not _is_already_exists_error(exc):
                logger.exception("Failed to create S3 vector index")
                raise
            logger.info("S3 vector index already exists index=%s", self.index_name)

    async def get_embeddings(self, texts: Sequence[str]) -> list[list[float]]:
        cleaned = [text for text in texts if text]
        if not cleaned:
            return []

        def embed_texts() -> Any:
            return embedding(
                model=self.embedding_model,
                input=cleaned,
                api_key=self.gemini_api_key,
                dimensions=self.dimension,
            )

        try:
            response = await to_thread.run_sync(embed_texts)
        except Exception:
            logger.exception("Failed to generate embeddings")
            raise

        vectors = [item["embedding"] for item in response["data"]]
        for vector in vectors:
            if len(vector) != self.dimension:
                raise ValueError(
                    f"Embedding dimension mismatch: expected {self.dimension}, "
                    f"got {len(vector)}"
                )
        return vectors

    async def upsert_chunks(
        self,
        keys: Sequence[str],
        texts: Sequence[str],
        embeddings: Sequence[Sequence[float]],
        source_doc: str,
        document_id: str,
        user_id: str,
    ) -> None:
        if not (len(keys) == len(texts) == len(embeddings)):
            raise ValueError("keys, texts, and embeddings must have matching lengths")

        vectors_payload: list[dict[str, Any]] = []
        for idx, (key, text, vector) in enumerate(zip(keys, texts, embeddings)):
            vectors_payload.append(
                {
                    "key": key,
                    "data": {"float32": list(vector)},
                    "metadata": {
                        "text": text,
                        "source_doc": source_doc,
                        "document_id": document_id,
                        "user_id": user_id,
                        "chunk_idx": idx,
                    },
                }
            )

        for offset in range(0, len(vectors_payload), 500):
            batch = vectors_payload[offset : offset + 500]
            await to_thread.run_sync(
                partial(
                    self.client.put_vectors,
                    vectorBucketName=self.vector_bucket,
                    indexName=self.index_name,
                    vectors=batch,
                )
            )
        logger.info("Ingested %d chunks into S3 Vectors", len(vectors_payload))

    async def similarity_search(
        self,
        query_text: str,
        user_id: str,
        top_k: int = 3,
        documents: Sequence[str] | None = None,
    ) -> list[dict[str, Any]]:
        query_embeddings = await self.get_embeddings([query_text])
        if not query_embeddings:
            return []

        query_args: dict[str, Any] = {
            "vectorBucketName": self.vector_bucket,
            "indexName": self.index_name,
            "queryVector": {"float32": query_embeddings[0]},
            "topK": top_k,
            "returnDistance": True,
            "returnMetadata": True,
        }

        query_args["filter"] = _build_query_filter(user_id, documents)

        try:
            response = await to_thread.run_sync(
                partial(self.client.query_vectors, **query_args)
            )
        except Exception:
            logger.exception("S3 Vectors similarity search failed")
            raise

        results: list[dict[str, Any]] = []
        for item in response.get("vectors", []):
            distance = item.get("distance")
            metadata = item.get("metadata") or {}
            score = 0.0 if distance is None else max(0.0, 1.0 - float(distance))
            results.append(
                {
                    "key": item.get("key"),
                    "text": metadata.get("text", ""),
                    "source": metadata.get("source_doc", "unknown"),
                    "score": round(score, 4),
                }
            )
        return results


def _is_already_exists_error(exc: ClientError) -> bool:
    code = exc.response.get("Error", {}).get("Code", "")
    return code in {
        "ConflictException",
        "VectorBucketAlreadyExistsException",
        "IndexAlreadyExistsException",
        "ResourceAlreadyExistsException",
    }


def _build_query_filter(
    user_id: str, documents: Sequence[str] | None
) -> dict[str, Any]:
    document_filter = _build_document_filter(documents)
    user_filter = {"user_id": user_id}
    if not document_filter:
        return user_filter
    return {"$and": [user_filter, document_filter]}


def _build_document_filter(documents: Sequence[str] | None) -> dict[str, Any] | None:
    if not documents:
        return None
    unique_documents = [document for document in dict.fromkeys(documents) if document]
    if not unique_documents:
        return None
    if len(unique_documents) == 1:
        return {"source_doc": unique_documents[0]}
    return {"source_doc": {"$in": unique_documents}}
