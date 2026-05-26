from __future__ import annotations

from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

from app.dependencies import (
    get_llm_client,
    get_rag_service,
    get_repository,
    get_settings,
    get_storage,
    get_vector_store,
    get_vision_llm_client,
)
from app.services.rag import RagIngestResult
from app.services.storage import UploadResult
from app.settings import Settings


class FakeLlmClient:
    def __init__(self) -> None:
        self.messages: list[list[dict]] = []

    async def generate(self, messages: list[dict]) -> str:
        self.messages.append(messages)
        return "stubbed response"

    async def astream(self, messages: list[dict]):
        self.messages.append(messages)

        class MockDelta:
            def __init__(self, content: str):
                self.content = content

        class MockChoice:
            def __init__(self, content: str):
                self.delta = MockDelta(content)

        class MockChunk:
            def __init__(self, content: str):
                self.choices = [MockChoice(content)]

        tokens = ["stubbed", " ", "response"]
        for token in tokens:
            yield MockChunk(token)


class InMemoryConversationRepository:
    def __init__(self) -> None:
        self._messages: dict[str, list[dict]] = {}
        self._context: dict[str, list[dict]] = {}
        self._conversations: dict[str, dict] = {}
        self._rag_documents: dict[str, list[dict]] = {}

    def create_conversation(
        self,
        conversation_id: str,
        created_at: str,
        user_id: str | None,
        name: str = "New Chat...",
    ) -> None:
        self._messages.setdefault(conversation_id, [])
        self._conversations[conversation_id] = {
            "conversation_id": conversation_id,
            "created_at": created_at,
            "updated_at": created_at,
            "user_id": user_id,
            "name": name,
        }

    def put_message(
        self,
        conversation_id: str,
        message_id: str,
        role: str,
        content: str,
        created_at: str,
        attachment: dict | None = None,
        user_id: str | None = None,
        attachments: list[dict] | None = None,
    ) -> None:
        self._messages.setdefault(conversation_id, []).append(
            {
                "message_id": message_id,
                "role": role,
                "content": content,
                "created_at": created_at,
                "attachment": attachment,
                "attachments": attachments,
                "user_id": user_id,
            }
        )

    def get_recent_messages(self, conversation_id: str, limit: int) -> list[dict]:
        items = self._messages.get(conversation_id, [])
        return items[-limit:]

    def get_context(self, conversation_id: str) -> dict | None:
        messages = self._context.get(conversation_id)
        if not messages:
            return None
        return {"messages": messages}

    def set_context(
        self,
        conversation_id: str,
        messages: list[dict],
        ttl_epoch: int,
        updated_at: str,
    ) -> None:
        self._context[conversation_id] = messages

    def get_user_conversations(self, user_id: str) -> list[dict]:
        convs = [c for c in self._conversations.values() if c.get("user_id") == user_id]
        convs.sort(
            key=lambda x: x.get("updated_at", x.get("created_at", "")), reverse=True
        )
        return convs

    def get_conversation_meta(self, conversation_id: str) -> dict | None:
        return self._conversations.get(conversation_id)

    def update_conversation(
        self, conversation_id: str, name: str, updated_at: str
    ) -> None:
        if conversation_id in self._conversations:
            self._conversations[conversation_id]["name"] = name
            self._conversations[conversation_id]["updated_at"] = updated_at

    def get_all_messages(self, conversation_id: str) -> list[dict]:
        return self._messages.get(conversation_id, [])

    def delete_conversation(self, conversation_id: str) -> None:
        self._conversations.pop(conversation_id, None)
        self._messages.pop(conversation_id, None)
        self._context.pop(conversation_id, None)

    def put_rag_document(
        self,
        user_id: str,
        document_id: str,
        filename: str,
        chunks_ingested: int,
        created_at: str,
        status: str = "ready",
    ) -> None:
        self._rag_documents.setdefault(user_id, []).append(
            {
                "document_id": document_id,
                "filename": filename,
                "source_doc": filename,
                "chunks_ingested": chunks_ingested,
                "status": status,
                "created_at": created_at,
                "updated_at": created_at,
            }
        )

    def update_rag_document_status(
        self,
        user_id: str,
        document_id: str,
        status: str,
        chunks_ingested: int,
        updated_at: str,
    ) -> None:
        docs = self._rag_documents.setdefault(user_id, [])
        for doc in docs:
            if doc["document_id"] == document_id:
                doc["status"] = status
                doc["chunks_ingested"] = chunks_ingested
                doc["updated_at"] = updated_at
                break

    def list_rag_documents(self, user_id: str) -> list[dict]:
        return list(reversed(self._rag_documents.get(user_id, [])))


class InMemoryStorageService:
    def __init__(self) -> None:
        self.uploads: list[UploadResult] = []
        self.raw_uploads: list[dict] = []

    def upload_image(self, key: str, data: bytes, mime_type: str) -> UploadResult:
        result = UploadResult(s3_key=key, mime_type=mime_type, size_bytes=len(data))
        self.uploads.append(result)
        return result

    def upload_bytes(self, key: str, data: bytes, mime_type: str) -> None:
        self.raw_uploads.append({"key": key, "data": data, "mime_type": mime_type})
        result = UploadResult(s3_key=key, mime_type=mime_type, size_bytes=len(data))
        self.uploads.append(result)
        return result

    def generate_presigned_url(self, key: str, expiration_seconds: int = 3600) -> str:
        return f"http://mock-s3-presigned-url/{key}"


class FakeVectorStore:
    def __init__(self) -> None:
        self.search_calls: list[dict] = []
        self.results = [
            {
                "key": "rules#chunk-0",
                "text": "The secure Wi-Fi network password is AntigravityRAG2026.",
                "source": "company_rules.txt",
                "score": 0.91,
            }
        ]

    async def similarity_search(
        self,
        query_text: str,
        user_id: str,
        top_k: int = 3,
        documents: list[str] | None = None,
    ) -> list[dict]:
        self.search_calls.append(
            {
                "query_text": query_text,
                "user_id": user_id,
                "top_k": top_k,
                "documents": documents,
            }
        )
        return self.results


class FakeRagService:
    def __init__(self) -> None:
        self.ingested: list[dict] = []

    async def ingest_document(
        self, filename: str, content: str, user_id: str
    ) -> RagIngestResult:
        self.ingested.append(
            {"filename": filename, "content": content, "user_id": user_id}
        )
        return RagIngestResult(document_id="doc-test", chunks_ingested=1)

    async def ingest_binary_document(
        self, filename: str, data: bytes, mime_type: str, user_id: str
    ) -> RagIngestResult:
        if "limit_exceeded" in filename:
            raise ValueError("Document exceeds maximum page limit of 100 pages (got 150 pages)")
        self.ingested.append(
            {"filename": filename, "data": data, "mime_type": mime_type, "user_id": user_id}
        )
        return RagIngestResult(document_id="doc-test", chunks_ingested=2)



@pytest.fixture()
def test_client() -> Iterator[TestClient]:
    from app.main import app

    repo = InMemoryConversationRepository()
    storage = InMemoryStorageService()
    llm = FakeLlmClient()
    vector_store = FakeVectorStore()
    rag_service = FakeRagService()
    settings = Settings(
        dynamodb_table_name="test",
        s3_bucket_name="test-bucket",
        max_image_bytes=5 * 1024 * 1024,
        allowed_image_mime_types=["image/png", "image/jpeg", "image/webp"],
    )

    app.dependency_overrides[get_repository] = lambda: repo
    app.dependency_overrides[get_storage] = lambda: storage
    app.dependency_overrides[get_llm_client] = lambda: llm
    app.dependency_overrides[get_vision_llm_client] = lambda: llm
    app.dependency_overrides[get_vector_store] = lambda: vector_store
    app.dependency_overrides[get_rag_service] = lambda: rag_service
    app.dependency_overrides[get_settings] = lambda: settings

    client = TestClient(app)
    setattr(client, "fake_llm", llm)
    setattr(client, "fake_vector_store", vector_store)
    setattr(client, "fake_rag_service", rag_service)
    yield client
    app.dependency_overrides.clear()
