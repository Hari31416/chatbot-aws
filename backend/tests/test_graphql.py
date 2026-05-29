"""
Tests for the /graphql endpoint.

Auth behaviour:
- ``health`` → no token required, always returns {"status": "ok"}
- ``conversations`` → requires a valid (or local-dev stub) user token
- ``rag_documents`` → requires a valid (or local-dev stub) user token
"""

from __future__ import annotations

from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

from app.dependencies import (
    get_optional_user_id,
    get_repository,
    get_settings,
    get_vector_store,
)
from app.settings import Settings

# ── helpers ────────────────────────────────────────────────────────────────────

GRAPHQL_URL = "/graphql"

HEALTH_QUERY = '{"query": "{ health { status } }"}'

CONVERSATIONS_QUERY = '{"query": "{ conversations { id name createdAt updatedAt } }"}'

RAG_DOCUMENTS_QUERY = '{"query": "{ ragDocuments { documentId filename status chunksIngested createdAt tags } }"}'

INITIAL_DATA_QUERY = '{"query": "{ health { status } conversations { id name } ragDocuments { documentId filename } }"}'


def _post(client: TestClient, body: str, token: str | None = None) -> dict:
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    resp = client.post(GRAPHQL_URL, content=body, headers=headers)
    assert resp.status_code == 200, resp.text
    return resp.json()


# ── fixtures ───────────────────────────────────────────────────────────────────


@pytest.fixture()
def gql_client(monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    """TestClient with all heavy dependencies replaced by in-memory fakes."""
    from app.main import app
    from tests.conftest import (
        FakeVectorStore,
        InMemoryConversationRepository,
        InMemoryStorageService,
    )

    monkeypatch.delenv("CLERK_ISSUER", raising=False)
    monkeypatch.delenv("CLERK_AUTHORIZED_PARTIES", raising=False)
    get_settings.cache_clear()

    repo = InMemoryConversationRepository()
    vector_store = FakeVectorStore()
    settings = Settings(
        dynamodb_table_name="test",
        s3_bucket_name="test-bucket",
        clerk_issuer=None,
        clerk_authorized_parties=[],
    )

    app.dependency_overrides[get_repository] = lambda: repo
    app.dependency_overrides[get_vector_store] = lambda: vector_store
    app.dependency_overrides[get_settings] = lambda: settings

    # Seed one conversation and one RAG document for "admin"
    repo.create_conversation("conv-1", "2024-01-01T00:00:00Z", "admin", "Hello World")
    repo.put_rag_document(
        "admin", "doc-1", "guide.pdf", 5, "2024-01-01T00:00:00Z", "ready", ["ai"]
    )

    client = TestClient(app)
    yield client
    app.dependency_overrides.clear()


@pytest.fixture()
def authed_client(
    gql_client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> TestClient:
    """
    gql_client with get_optional_user_id overridden to always return "admin".
    Simulates a fully authenticated request without needing a real JWT.
    """
    from app.main import app

    app.dependency_overrides[get_optional_user_id] = lambda: "admin"
    yield gql_client
    # cleanup handled by gql_client fixture teardown


# ── tests: health (public) ─────────────────────────────────────────────────────


def test_graphql_health_no_auth(gql_client: TestClient) -> None:
    """health field must work with no Authorization header."""
    data = _post(gql_client, HEALTH_QUERY)
    assert "errors" not in data
    assert data["data"]["health"]["status"] == "ok"


def test_graphql_health_with_auth(authed_client: TestClient) -> None:
    """health field must also work when authenticated."""
    data = _post(authed_client, HEALTH_QUERY, token="admin")
    assert "errors" not in data
    assert data["data"]["health"]["status"] == "ok"


# ── tests: conversations (auth required) ──────────────────────────────────────


def test_graphql_conversations_no_auth_local_dev(gql_client: TestClient) -> None:
    """
    In local-dev mode (auth_enabled=False, no clerk_issuer), an unauthenticated
    request falls back to the "admin" user — conversations are returned normally.
    """
    data = _post(gql_client, CONVERSATIONS_QUERY)
    assert "errors" not in data
    # seeded conversation is returned
    assert len(data["data"]["conversations"]) == 1


def test_graphql_conversations_auth_required_when_enabled(
    gql_client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """
    When auth IS enabled (clerk_issuer set), a missing token must produce a
    GraphQL error from _require_user.
    """
    from app.main import app

    # Override get_optional_user_id to simulate auth-enabled returning None
    app.dependency_overrides[get_optional_user_id] = lambda: None
    try:
        data = _post(gql_client, CONVERSATIONS_QUERY)
        assert "errors" in data
        assert any(
            "authentication" in str(e.get("message", "")).lower()
            for e in data["errors"]
        )
    finally:
        app.dependency_overrides.pop(get_optional_user_id, None)


def test_graphql_conversations_authed(authed_client: TestClient) -> None:
    """Authenticated request returns the seeded conversation."""
    data = _post(authed_client, CONVERSATIONS_QUERY, token="admin")
    assert "errors" not in data, data.get("errors")
    convs = data["data"]["conversations"]
    assert len(convs) == 1
    assert convs[0]["id"] == "conv-1"
    assert convs[0]["name"] == "Hello World"


# ── tests: rag_documents (auth required) ──────────────────────────────────────


def test_graphql_rag_documents_no_auth_local_dev(gql_client: TestClient) -> None:
    """
    In local-dev mode (auth_enabled=False), an unauthenticated request falls
    back to the "admin" user — RAG documents are returned normally.
    """
    data = _post(gql_client, RAG_DOCUMENTS_QUERY)
    assert "errors" not in data
    assert len(data["data"]["ragDocuments"]) == 1


def test_graphql_rag_documents_auth_required_when_enabled(
    gql_client: TestClient,
) -> None:
    """When auth is enabled (user_id=None), ragDocuments returns a GraphQL error."""
    from app.main import app

    app.dependency_overrides[get_optional_user_id] = lambda: None
    try:
        data = _post(gql_client, RAG_DOCUMENTS_QUERY)
        assert "errors" in data
        assert any(
            "authentication" in str(e.get("message", "")).lower()
            for e in data["errors"]
        )
    finally:
        app.dependency_overrides.pop(get_optional_user_id, None)


def test_graphql_rag_documents_authed(authed_client: TestClient) -> None:
    """Authenticated request returns the seeded RAG document."""
    data = _post(authed_client, RAG_DOCUMENTS_QUERY, token="admin")
    assert "errors" not in data, data.get("errors")
    docs = data["data"]["ragDocuments"]
    assert len(docs) == 1
    assert docs[0]["documentId"] == "doc-1"
    assert docs[0]["filename"] == "guide.pdf"
    assert docs[0]["tags"] == ["ai"]


# ── tests: combined InitialData query ─────────────────────────────────────────


def test_graphql_initial_data_authed(authed_client: TestClient) -> None:
    """Single InitialData query returns all three fields in one round-trip."""
    data = _post(authed_client, INITIAL_DATA_QUERY, token="admin")
    assert "errors" not in data, data.get("errors")
    assert data["data"]["health"]["status"] == "ok"
    assert len(data["data"]["conversations"]) == 1
    assert len(data["data"]["ragDocuments"]) == 1


def test_graphql_initial_data_partial_auth_enabled(gql_client: TestClient) -> None:
    """
    When user_id is forced to None (simulating auth-enabled + no token),
    conversations and ragDocuments raise PermissionError.

    Strawberry propagates the error up (since the list fields are non-nullable
    at the resolver level), so ``data`` may be null but ``errors`` is always
    present — demonstrating that protected fields block the response.
    """
    from app.main import app

    app.dependency_overrides[get_optional_user_id] = lambda: None
    try:
        data = _post(gql_client, INITIAL_DATA_QUERY)
        # errors must always be present for the protected fields
        assert "errors" in data
        assert any(
            "authentication" in str(e.get("message", "")).lower()
            for e in data["errors"]
        )
    finally:
        app.dependency_overrides.pop(get_optional_user_id, None)
