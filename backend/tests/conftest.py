from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.dependencies import get_llm_client, get_repository, get_settings, get_storage
from app.settings import Settings
from app.services.storage import UploadResult


class FakeLlmClient:
    async def generate(self, messages: list[dict]) -> str:
        return "stubbed response"


class InMemoryConversationRepository:
    def __init__(self) -> None:
        self._messages: dict[str, list[dict]] = {}
        self._context: dict[str, list[dict]] = {}

    def create_conversation(
        self, conversation_id: str, created_at: str, user_id: str | None
    ) -> None:
        self._messages.setdefault(conversation_id, [])

    def put_message(
        self,
        conversation_id: str,
        message_id: str,
        role: str,
        content: str,
        created_at: str,
        attachment: dict | None = None,
        user_id: str | None = None,
    ) -> None:
        self._messages.setdefault(conversation_id, []).append(
            {
                "message_id": message_id,
                "role": role,
                "content": content,
                "created_at": created_at,
                "attachment": attachment,
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


class InMemoryStorageService:
    def __init__(self) -> None:
        self.uploads: list[UploadResult] = []

    def upload_image(self, key: str, data: bytes, mime_type: str) -> UploadResult:
        result = UploadResult(s3_key=key, mime_type=mime_type, size_bytes=len(data))
        self.uploads.append(result)
        return result

    def generate_presigned_url(self, key: str, expiration_seconds: int = 3600) -> str:
        return f"http://mock-s3-presigned-url/{key}"



@pytest.fixture()
def test_client() -> TestClient:
    from app.main import app

    repo = InMemoryConversationRepository()
    storage = InMemoryStorageService()
    llm = FakeLlmClient()
    settings = Settings(
        dynamodb_table_name="test",
        s3_bucket_name="test-bucket",
        max_image_bytes=5 * 1024 * 1024,
        allowed_image_mime_types=["image/png", "image/jpeg", "image/webp"],
    )

    app.dependency_overrides[get_repository] = lambda: repo
    app.dependency_overrides[get_storage] = lambda: storage
    app.dependency_overrides[get_llm_client] = lambda: llm
    app.dependency_overrides[get_settings] = lambda: settings

    client = TestClient(app)
    yield client
    app.dependency_overrides.clear()
