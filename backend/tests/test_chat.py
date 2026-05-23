from fastapi.testclient import TestClient


def test_chat_text(test_client: TestClient) -> None:
    response = test_client.post("/chat", json={"message": "Hello"})
    assert response.status_code == 200
    payload = response.json()
    assert payload["assistant_message"] == "stubbed response"
    assert payload["conversation_id"]
    assert payload["user_message_id"]
    assert payload["assistant_message_id"]


def test_chat_image_upload(test_client: TestClient) -> None:
    image_bytes = b"\x89PNG\r\n\x1a\n"
    response = test_client.post(
        "/chat/image",
        data={"message": "Describe this"},
        files={"file": ("test.png", image_bytes, "image/png")},
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["assistant_message"] == "stubbed response"
    assert payload["attachment"]["mime_type"] == "image/png"
    assert "http://mock-s3-presigned-url/" in payload["attachment"]["presigned_url"]


def test_chat_error_handling(test_client: TestClient) -> None:
    from app.dependencies import get_llm_client, get_vision_llm_client

    class ErrorLlmClient:
        async def generate(self, messages: list[dict]) -> str:
            raise RuntimeError("API failure")

    test_client.app.dependency_overrides[get_llm_client] = lambda: ErrorLlmClient()
    test_client.app.dependency_overrides[get_vision_llm_client] = lambda: ErrorLlmClient()

    response = test_client.post("/chat", json={"message": "Hello"})
    assert response.status_code == 200
    payload = response.json()
    assert payload["error"] == "API failure"
    assert payload["assistant_message"] is None


