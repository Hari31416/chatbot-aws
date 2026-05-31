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


@pytest.mark.asyncio
async def test_vector_store_get_embeddings_gemini_data_uri() -> None:
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
                {"embedding": [0.15] * 768}
            ]
        }
        with patch("litellm.embedding", return_value=mock_response) as mock_embed:
            vectors = await client.get_embeddings(["data:image/png;base64,iVBORw..."])

            assert vectors == [[0.15] * 768]
            mock_embed.assert_called_once_with(
                model="gemini/gemini-embedding-2",
                input=["data:image/png;base64,iVBORw..."],
                api_key=None,
                dimensions=768,
            )


@pytest.mark.asyncio
async def test_vector_store_similarity_search_returns_image_metadata() -> None:
    from unittest.mock import MagicMock
    mock_boto_client = MagicMock()
    with patch("boto3.client", return_value=mock_boto_client):
        client = VectorStoreClient(
            region_name="us-east-1",
            vector_bucket="test-bucket",
            index_name="test-index",
            embedding_model="gemini/gemini-embedding-2",
            dimension=768,
        )

        mock_embed_res = {"data": [{"embedding": [0.1] * 768}]}

        mock_query_res = {
            "vectors": [
                {
                    "key": "photo-1",
                    "distance": 0.05,
                    "metadata": {
                        "text": "[Image: photo.png]",
                        "source_doc": "photo.png",
                        "is_image": True,
                        "image_s3_key": "rag-raw-uploads/123/photo-1.png",
                        "mime_type": "image/png",
                    }
                }
            ]
        }
        mock_boto_client.query_vectors.return_value = mock_query_res

        with patch("litellm.embedding", return_value=mock_embed_res):
            results = await client.similarity_search("explain image", user_id="123")

            assert len(results) == 1
            res = results[0]
            assert res["key"] == "photo-1"
            assert res["score"] == 0.95
            assert res["is_image"] is True
            assert res["image_s3_key"] == "rag-raw-uploads/123/photo-1.png"
            assert res["mime_type"] == "image/png"
