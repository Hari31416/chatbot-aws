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

    assert response.status_code == 201
    payload = response.json()
    assert payload == {
        "status": "success",
        "filename": "company_rules.txt",
        "document_id": "doc-test",
        "chunks_ingested": 1,
    }


def test_rag_documents_endpoint_lists_ingested_items(test_client: TestClient) -> None:
    ingest_response = test_client.post(
        "/rag/ingest",
        json={
            "filename": "company_rules.txt",
            "content": "The secure Wi-Fi password is AntigravityRAG2026.",
        },
    )
    assert ingest_response.status_code == 201

    response = test_client.get("/rag/documents")

    assert response.status_code == 200
    payload = response.json()
    assert len(payload) == 1
    assert payload[0]["document_id"] == "doc-test"
    assert payload[0]["filename"] == "company_rules.txt"
    assert payload[0]["source_doc"] == "company_rules.txt"
    assert payload[0]["chunks_ingested"] == 1
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
        "query_text": "What is the Wi-Fi password?",
        "user_id": "admin",
        "top_k": 3,
        "documents": ["company_rules.txt"],
    }
