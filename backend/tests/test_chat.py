from fastapi import FastAPI
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

    app = test_client.app
    assert isinstance(app, FastAPI)
    app.dependency_overrides[get_llm_client] = lambda: ErrorLlmClient()
    app.dependency_overrides[get_vision_llm_client] = lambda: ErrorLlmClient()

    response = test_client.post("/chat", json={"message": "Hello"})
    assert response.status_code == 200
    payload = response.json()
    assert payload["error"] == "API failure"
    assert payload["assistant_message"] is None


def test_chat_stream(test_client: TestClient) -> None:
    response = test_client.post("/chat/stream", json={"message": "Hello stream!"})
    assert response.status_code == 200
    assert response.headers["content-type"] == "text/event-stream; charset=utf-8"

    # Read the event stream chunks
    lines = list(response.iter_lines())
    non_empty_lines = [line for line in lines if line.strip()]

    # We expect 4 data lines: "stubbed", " ", "response", and "[DONE]"
    assert len(non_empty_lines) == 4

    import json

    # Parse first chunk
    assert non_empty_lines[0].startswith("data: ")
    chunk_1 = json.loads(non_empty_lines[0].replace("data: ", ""))
    assert chunk_1["text"] == "stubbed"
    assert chunk_1["conversation_id"]
    assert chunk_1["assistant_message_id"]
    assert chunk_1["user_message_id"]

    # Parse last chunk
    assert non_empty_lines[3] == "data: [DONE]"


def test_chat_multi_image_upload(test_client: TestClient) -> None:
    image_bytes = b"\x89PNG\r\n\x1a\n"
    response = test_client.post(
        "/chat/image",
        data={"message": "Describe these two images"},
        files=[
            ("files", ("image1.png", image_bytes, "image/png")),
            ("files", ("image2.png", image_bytes, "image/png")),
        ],
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["assistant_message"] == "stubbed response"
    assert len(payload["attachments"]) == 2
    assert payload["attachments"][0]["mime_type"] == "image/png"
    assert payload["attachments"][1]["mime_type"] == "image/png"
    assert "http://mock-s3-presigned-url/" in payload["attachments"][0]["presigned_url"]
    assert "http://mock-s3-presigned-url/" in payload["attachments"][1]["presigned_url"]
