import pytest
from fastapi.testclient import TestClient

from app.services.rag import RagService


class NoopVectorStore:
    pass


def test_rag_split_text_uses_overlap() -> None:
    service = RagService(NoopVectorStore(), chunk_size=10, chunk_overlap=2)  # type: ignore[arg-type]
    chunks = service.split_text("abcdefghijklmnopqrstuvwxyz")

    assert chunks == ["abcdefghij", "ijklmnopqr", "qrstuvwxyz"]


def test_rag_ingest_endpoint(test_client: TestClient) -> None:
    response = test_client.post(
        "/rag/ingest",
        json={
            "filename": "company_rules.txt",
            "content": "The secure Wi-Fi password is AntigravityRAG2026.",
        },
    )

    assert response.status_code == 202
    payload = response.json()
    assert payload["status"] == "processing"
    assert payload["filename"] == "company_rules.txt"
    assert payload["document_id"]
    assert payload["chunks_ingested"] == 0


def test_rag_documents_endpoint_lists_ingested_items(test_client: TestClient) -> None:
    ingest_response = test_client.post(
        "/rag/ingest",
        json={
            "filename": "company_rules.txt",
            "content": "The secure Wi-Fi password is AntigravityRAG2026.",
        },
    )
    assert ingest_response.status_code == 202
    doc_id = ingest_response.json()["document_id"]

    response = test_client.get("/rag/documents")

    assert response.status_code == 200
    payload = response.json()
    assert len(payload) == 1
    assert payload[0]["document_id"] == doc_id
    assert payload[0]["filename"] == "company_rules.txt"
    assert payload[0]["source_doc"] == "company_rules.txt"
    assert payload[0]["chunks_ingested"] == 0
    assert payload[0]["status"] == "processing"
    assert payload[0]["created_at"]
    assert payload[0]["updated_at"]


def test_rag_search_endpoint(test_client: TestClient) -> None:
    response = test_client.post(
        "/rag/search",
        json={"query": "What is the Wi-Fi password?", "top_k": 2},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["query"] == "What is the Wi-Fi password?"
    assert payload["results"][0]["source"] == "company_rules.txt"


def test_chat_with_rag_injects_retrieved_context(test_client: TestClient) -> None:
    response = test_client.post(
        "/chat",
        json={
            "message": "What is the Wi-Fi password?",
            "use_rag": True,
            "rag_documents": ["company_rules.txt"],
        },
    )

    assert response.status_code == 200
    llm_messages = getattr(test_client, "fake_llm").messages[-1]
    assert llm_messages[0]["role"] == "system"
    assert "AntigravityRAG2026" in llm_messages[0]["content"]
    assert "company_rules.txt" in llm_messages[0]["content"]
    assert getattr(test_client, "fake_vector_store").search_calls[-1] == {
        "query_text": "What is the Wi-Fi password? (standalone)",
        "user_id": "admin",
        "top_k": 3,
        "documents": ["company_rules.txt"],
        "tags": None,
    }


def test_chat_with_rag_follow_up_rewriting(test_client: TestClient) -> None:
    # 1. Send first message to initialize a conversation and set history
    first_response = test_client.post(
        "/chat",
        json={
            "message": "Who is CEO of the company?",
            "use_rag": True,
            "rag_documents": ["company_rules.txt"],
        },
    )
    assert first_response.status_code == 200
    conv_id = first_response.json()["conversation_id"]

    # Clear fake_llm messages to isolate the next turn's prompts
    getattr(test_client, "fake_llm").messages.clear()

    # 2. Send follow-up query
    followup_response = test_client.post(
        "/chat",
        json={
            "conversation_id": conv_id,
            "message": "what is their contact email?",
            "use_rag": True,
            "rag_documents": ["company_rules.txt"],
        },
    )
    assert followup_response.status_code == 200

    # Verify that the LLM was called to reformulate the query with history
    llm_calls = getattr(test_client, "fake_llm").messages
    # There should be 2 LLM calls: 1 for reformulation, 1 for final response generation
    assert len(llm_calls) >= 2

    # Check the first call (reformulation)
    reformulate_prompt = llm_calls[0][0]["content"]
    assert "Conversation History:" in reformulate_prompt
    assert "User: Who is CEO of the company?" in reformulate_prompt
    # The assistant response in history should be "stubbed response" (from first turn)
    assert "Assistant: stubbed response" in reformulate_prompt
    assert "Follow-up Query: what is their contact email?" in reformulate_prompt

    # Verify vector store searched with the reformulated query
    assert (
        getattr(test_client, "fake_vector_store").search_calls[-1]["query_text"]
        == "what is their contact email? (standalone)"
    )


def test_rag_search_uses_original_query(test_client: TestClient) -> None:
    response = test_client.post(
        "/rag/search",
        json={"query": "wifi password?", "top_k": 2},
    )
    assert response.status_code == 200

    # Check that original query was used (no reformulation for standalone search endpoint)
    assert (
        getattr(test_client, "fake_vector_store").search_calls[-1]["query_text"]
        == "wifi password?"
    )


def test_rag_file_ingest_text_file(test_client: TestClient) -> None:
    response = test_client.post(
        "/rag/ingest/file",
        files={"file": ("test.txt", b"plain text content", "text/plain")},
    )
    assert response.status_code == 202
    payload = response.json()
    assert payload["status"] == "processing"
    assert payload["filename"] == "test.txt"
    assert payload["chunks_ingested"] == 0


def test_rag_file_ingest_binary_file(test_client: TestClient) -> None:
    response = test_client.post(
        "/rag/ingest/file",
        files={"file": ("test.pdf", b"%PDF-1.4 dummy", "application/pdf")},
    )
    assert response.status_code == 202
    payload = response.json()
    assert payload["status"] == "processing"
    assert payload["filename"] == "test.pdf"
    assert payload["chunks_ingested"] == 0


def test_rag_file_ingest_too_large(test_client: TestClient) -> None:
    large_data = b"x" * (20 * 1024 * 1024 + 100)
    response = test_client.post(
        "/rag/ingest/file", files={"file": ("big.pdf", large_data, "application/pdf")}
    )
    assert response.status_code == 413


class MockVectorStore:
    def __init__(self):
        self.upserts = []

    async def get_embeddings(self, texts):
        return [[0.1] * 768 for _ in range(len(texts))]

    async def upsert_chunks(
        self,
        keys,
        texts,
        embeddings,
        source_doc,
        document_id,
        user_id,
        page_numbers=None,
        tags=None,
    ):
        self.upserts.append(
            {
                "keys": keys,
                "texts": texts,
                "embeddings": embeddings,
                "source_doc": source_doc,
                "document_id": document_id,
                "user_id": user_id,
                "page_numbers": page_numbers,
                "tags": tags,
            }
        )


class MockS3Client:
    def __init__(self):
        self.uploaded = []
        self.deleted = []

    def put_object(self, Bucket, Key, Body, ContentType):
        self.uploaded.append(
            {"bucket": Bucket, "key": Key, "body": Body, "content_type": ContentType}
        )
        return {}

    def delete_object(self, Bucket, Key):
        self.deleted.append({"bucket": Bucket, "key": Key})
        return {}


class MockTextractClient:
    def __init__(self, pages=5, fail_job=False):
        self.pages = pages
        self.fail_job = fail_job
        self.start_calls = []
        self.get_calls = []

    def start_document_text_detection(self, DocumentLocation):
        self.start_calls.append(DocumentLocation)
        return {"JobId": "test-job-id"}

    def get_document_text_detection(self, JobId, NextToken=None):
        self.get_calls.append({"job_id": JobId, "next_token": NextToken})
        if self.fail_job:
            return {"JobStatus": "FAILED", "StatusMessage": "Textract error test"}

        status = "SUCCEEDED"
        metadata = {"Pages": self.pages}
        blocks = [
            {"BlockType": "LINE", "Text": "Line 1 from Textract"},
            {"BlockType": "LINE", "Text": "Line 2 from Textract"},
        ]
        return {
            "JobStatus": status,
            "DocumentMetadata": metadata,
            "Blocks": blocks,
        }


# ──────────────────────────────────────────────────────────────
# Tests for fetch_textract_text
# ──────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_fetch_textract_text_success() -> None:
    """Happy path: SUCCEEDED job returns joined line text."""
    textract_client = MockTextractClient(pages=1)
    service = RagService(
        vector_store=NoopVectorStore(),  # type: ignore[arg-type]
        chunk_size=100,
        chunk_overlap=10,
        textract_client=textract_client,
    )

    text = await service.fetch_textract_text("test-job-id")

    assert "Line 1 from Textract" in text
    assert "Line 2 from Textract" in text
    assert len(textract_client.get_calls) == 1


@pytest.mark.asyncio
async def test_fetch_textract_text_paginated() -> None:
    """Paginated results: all pages are collected and their lines joined."""

    class PaginatedTextractClient:
        """Returns two pages on the first call (with NextToken), then one page."""

        def __init__(self) -> None:
            self.call_count = 0

        def get_document_text_detection(self, JobId: str, NextToken: str | None = None):
            self.call_count += 1
            if self.call_count == 1:
                return {
                    "JobStatus": "SUCCEEDED",
                    "DocumentMetadata": {"Pages": 2},
                    "Blocks": [{"BlockType": "LINE", "Text": "Page 1 line"}],
                    "NextToken": "token-page-2",
                }
            return {
                "JobStatus": "SUCCEEDED",
                "DocumentMetadata": {"Pages": 2},
                "Blocks": [{"BlockType": "LINE", "Text": "Page 2 line"}],
            }

    client = PaginatedTextractClient()
    service = RagService(
        vector_store=NoopVectorStore(),  # type: ignore[arg-type]
        chunk_size=100,
        chunk_overlap=10,
        textract_client=client,
    )

    text = await service.fetch_textract_text("job-paginated")

    assert "Page 1 line" in text
    assert "Page 2 line" in text
    assert client.call_count == 2


@pytest.mark.asyncio
async def test_fetch_textract_text_non_succeeded() -> None:
    """Non-SUCCEEDED status raises ValueError immediately."""
    textract_client = MockTextractClient(fail_job=True)
    service = RagService(
        vector_store=NoopVectorStore(),  # type: ignore[arg-type]
        chunk_size=100,
        chunk_overlap=10,
        textract_client=textract_client,
    )

    with pytest.raises(ValueError, match="did not succeed"):
        await service.fetch_textract_text("test-job-id")


@pytest.mark.asyncio
async def test_ingest_document_embedding_retry() -> None:
    """Rate-limit errors on get_embeddings trigger exponential backoff retries."""
    import asyncio

    call_count = 0

    class RetryVectorStore:
        async def get_embeddings(self, texts):
            nonlocal call_count
            call_count += 1
            if call_count < 3:
                raise Exception("429 RESOURCE_EXHAUSTED: rate limit exceeded")
            return [[0.1] * 768 for _ in texts]

        async def upsert_chunks(self, **kwargs):
            pass

    service = RagService(
        vector_store=RetryVectorStore(),  # type: ignore[arg-type]
        chunk_size=100,
        chunk_overlap=10,
    )

    # Patch asyncio.sleep so tests don't actually wait
    slept: list[float] = []

    async def fake_sleep(delay: float) -> None:
        slept.append(delay)

    import app.services.rag as rag_module

    original_sleep = rag_module.asyncio.sleep
    rag_module.asyncio.sleep = fake_sleep  # type: ignore[assignment]
    try:
        result = await service.ingest_document(
            filename="test.txt",
            content="Some content that is long enough to form a chunk for embedding.",
            user_id="user-123",
        )
    finally:
        rag_module.asyncio.sleep = original_sleep  # type: ignore[assignment]

    assert call_count == 3  # failed twice, succeeded on third attempt
    assert len(slept) == 2  # two sleep calls for two retries
    assert slept[0] == 2.0  # base_delay * 2^0
    assert slept[1] == 4.0  # base_delay * 2^1
    assert result.chunks_ingested >= 1


@pytest.mark.asyncio
async def test_rag_service_ingest_binary_document_logic() -> None:
    vector_store = MockVectorStore()
    s3_client = MockS3Client()
    textract_client = MockTextractClient(pages=5)

    service = RagService(
        vector_store=vector_store,  # type: ignore[arg-type]
        chunk_size=100,
        chunk_overlap=10,
        s3_client=s3_client,
        s3_bucket_name="test-bucket",
        textract_client=textract_client,
    )

    result = await service.ingest_binary_document(
        filename="report.pdf",
        data=b"pdf binary data",
        mime_type="application/pdf",
        user_id="user-123",
    )

    assert result.chunks_ingested == 1
    assert len(s3_client.uploaded) == 1
    assert s3_client.uploaded[0]["bucket"] == "test-bucket"
    assert s3_client.uploaded[0]["body"] == b"pdf binary data"
    assert s3_client.uploaded[0]["content_type"] == "application/pdf"

    # Assert cleanup was called
    assert len(s3_client.deleted) == 1
    assert s3_client.deleted[0]["key"] == s3_client.uploaded[0]["key"]

    # Assert Textract was triggered
    assert len(textract_client.start_calls) == 1
    assert (
        textract_client.start_calls[0]["S3Object"]["Name"]
        == s3_client.uploaded[0]["key"]
    )

    # Assert upsert calls
    assert len(vector_store.upserts) == 1
    assert "Line 1 from Textract" in vector_store.upserts[0]["texts"][0]


@pytest.mark.asyncio
async def test_rag_service_ingest_binary_document_limit_exceeded() -> None:
    vector_store = MockVectorStore()
    s3_client = MockS3Client()
    textract_client = MockTextractClient(pages=105)

    service = RagService(
        vector_store=vector_store,  # type: ignore[arg-type]
        chunk_size=100,
        chunk_overlap=10,
        s3_client=s3_client,
        s3_bucket_name="test-bucket",
        textract_client=textract_client,
    )

    with pytest.raises(ValueError) as excinfo:
        await service.ingest_binary_document(
            filename="massive.pdf",
            data=b"pdf binary data",
            mime_type="application/pdf",
            user_id="user-123",
        )

    assert "exceeds maximum page limit of 100 pages" in str(excinfo.value)
    # Cleanup should still have run even on failure
    assert len(s3_client.deleted) == 1


def test_rag_delete_endpoint_success(test_client: TestClient) -> None:
    fake_repo = getattr(test_client, "fake_repo")
    fake_repo.put_rag_document(
        user_id="admin",
        document_id="doc-delete-123",
        filename="delete-me.txt",
        chunks_ingested=2,
        created_at="2026-05-27T10:00:00Z",
        status="ready",
    )

    response = test_client.delete("/rag/documents/doc-delete-123")

    assert response.status_code == 200
    payload = response.json()
    assert payload == {"deleted": True, "document_id": "doc-delete-123"}

    fake_vector_store = getattr(test_client, "fake_vector_store")
    assert fake_vector_store.deleted_keys == [
        "doc-delete-123#chunk-0",
        "doc-delete-123#chunk-1",
    ]

    docs = fake_repo.list_rag_documents("admin")
    assert not any(d["document_id"] == "doc-delete-123" for d in docs)


def test_rag_delete_endpoint_success_with_float_chunks(test_client: TestClient) -> None:
    fake_repo = getattr(test_client, "fake_repo")
    fake_repo.put_rag_document(
        user_id="admin",
        document_id="doc-delete-float-123",
        filename="delete-me-float.txt",
        chunks_ingested=3.0,  # Float value
        created_at="2026-05-27T10:00:00Z",
        status="ready",
    )

    response = test_client.delete("/rag/documents/doc-delete-float-123")

    assert response.status_code == 200
    payload = response.json()
    assert payload == {"deleted": True, "document_id": "doc-delete-float-123"}

    fake_vector_store = getattr(test_client, "fake_vector_store")
    assert fake_vector_store.deleted_keys == [
        "doc-delete-float-123#chunk-0",
        "doc-delete-float-123#chunk-1",
        "doc-delete-float-123#chunk-2",
    ]

    docs = fake_repo.list_rag_documents("admin")
    assert not any(d["document_id"] == "doc-delete-float-123" for d in docs)


def test_rag_delete_endpoint_not_found(test_client: TestClient) -> None:
    response = test_client.delete("/rag/documents/non-existent-id")
    assert response.status_code == 404
    assert response.json()["detail"] == "Document not found"


def test_rag_strict_context_and_empty_fallback(test_client: TestClient) -> None:
    # 1. Test standard RAG call: verify strict context prompt is in system message
    response = test_client.post(
        "/chat",
        json={
            "message": "Verify prompt rules?",
            "use_rag": True,
            "rag_documents": ["company_rules.txt"],
        },
    )
    assert response.status_code == 200
    llm_messages = getattr(test_client, "fake_llm").messages[-1]
    assert llm_messages[0]["role"] == "system"
    prompt_content = llm_messages[0]["content"]
    assert "strictly and objectively using only the retrieved context" in prompt_content
    assert (
        "I can not answer the question based on the provided information."
        in prompt_content
    )

    # 2. Test RAG call with no context returned: verify fallback context text is injected
    getattr(test_client, "fake_vector_store").results = []
    response_no_ctx = test_client.post(
        "/chat",
        json={
            "message": "What is the meaning of life?",
            "use_rag": True,
        },
    )
    assert response_no_ctx.status_code == 200
    llm_messages_no_ctx = getattr(test_client, "fake_llm").messages[-1]
    assert llm_messages_no_ctx[0]["role"] == "system"
    no_ctx_prompt = llm_messages_no_ctx[0]["content"]
    assert "No relevant context found." in no_ctx_prompt


def test_rag_ingest_endpoint_with_tags(test_client: TestClient) -> None:
    response = test_client.post(
        "/rag/ingest",
        json={
            "filename": "company_rules.txt",
            "content": "The secure Wi-Fi password is AntigravityRAG2026.",
            "tags": ["HR", "Finance"],
        },
    )

    assert response.status_code == 202
    payload = response.json()
    assert payload["status"] == "processing"
    assert payload["filename"] == "company_rules.txt"
    assert payload["document_id"]
    
    # Verify the document was put in DynamoDB with tags
    fake_repo = getattr(test_client, "fake_repo")
    doc = fake_repo.get_rag_document("admin", payload["document_id"])
    assert doc is not None
    assert doc["tags"] == ["HR", "Finance"]


def test_chat_with_rag_tags_filtering(test_client: TestClient) -> None:
    response = test_client.post(
        "/chat",
        json={
            "message": "What is the Wi-Fi password?",
            "use_rag": True,
            "rag_tags": ["HR"],
        },
    )

    assert response.status_code == 200
    assert getattr(test_client, "fake_vector_store").search_calls[-1] == {
        "query_text": "What is the Wi-Fi password? (standalone)",
        "user_id": "admin",
        "top_k": 3,
        "documents": None,
        "tags": ["HR"],
    }
