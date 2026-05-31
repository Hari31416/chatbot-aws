from __future__ import annotations

import pytest
from unittest.mock import patch
from app.services.vector_store import VectorStoreClient


@pytest.mark.asyncio
async def test_vector_store_get_embeddings_gemini() -> None:
    with patch("boto3.client"):
        client = VectorStoreClient(
            region_name="us-east-1",
            vector_bucket="test-bucket",
            index_name="test-index",
            embedding_model="gemini/gemini-embedding-2",
            dimension=768,
        )

        mock_response = {
            "data": [
                {"embedding": [0.1] * 768}
            ]
        }
        with patch("litellm.embedding", return_value=mock_response) as mock_embed:
            vectors = await client.get_embeddings(["hello world"])

            assert vectors == [[0.1] * 768]
            mock_embed.assert_called_once_with(
                model="gemini/gemini-embedding-2",
                input=["task: sentence similarity | query: hello world"],
                api_key=None,
                dimensions=768,
            )


@pytest.mark.asyncio
async def test_vector_store_get_embeddings_non_gemini() -> None:
    with patch("boto3.client"):
        client = VectorStoreClient(
            region_name="us-east-1",
            vector_bucket="test-bucket",
            index_name="test-index",
            embedding_model="openai/text-embedding-3-small",
            dimension=1536,
        )

        mock_response = {
            "data": [
                {"embedding": [0.2] * 1536}
            ]
        }
        with patch("litellm.embedding", return_value=mock_response) as mock_embed:
            vectors = await client.get_embeddings(["hello world"])

            assert vectors == [[0.2] * 1536]
            mock_embed.assert_called_once_with(
                model="openai/text-embedding-3-small",
                input=["hello world"],
                api_key=None,
                dimensions=1536,
            )
