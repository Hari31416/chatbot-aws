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


def test_chat_image_payload(test_client: TestClient) -> None:
    # Minimal 1x1 black PNG base64 string
    image_b64 = "data:image/png;base64,iVBORw0KGgoAAAANSUHeHggAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="
    response = test_client.post(
        "/chat",
        json={"message": "Describe this", "images": [image_b64]},
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["assistant_message"] == "stubbed response"

    messages = getattr(test_client, "fake_repo").get_all_messages(
        payload["conversation_id"]
    )
    assert len(messages) == 2  # user and assistant
    user_msg = messages[0]
    assert user_msg["role"] == "user"
    assert len(user_msg["attachments"]) == 1
    assert user_msg["attachments"][0]["mime_type"] == "image/png"
    assert user_msg["attachments"][0]["size_bytes"] > 0


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

    # We expect 5 data lines: "stubbed", " ", "response", citations/metadata, and "[DONE]"
    assert len(non_empty_lines) == 5

    import json

    # Parse first chunk
    assert non_empty_lines[0].startswith("data: ")
    chunk_1 = json.loads(non_empty_lines[0].replace("data: ", ""))
    assert chunk_1["text"] == "stubbed"
    assert chunk_1["conversation_id"]
    assert chunk_1["assistant_message_id"]
    assert chunk_1["user_message_id"]

    # Parse citations chunk
    assert non_empty_lines[3].startswith("data: ")
    chunk_metadata = json.loads(non_empty_lines[3].replace("data: ", ""))
    assert "citations" in chunk_metadata
    assert chunk_metadata["final_content"] == "stubbed response"

    # Parse last chunk
    assert non_empty_lines[4] == "data: [DONE]"


def test_chat_stream_image_payload(test_client: TestClient) -> None:
    image_b64 = "data:image/png;base64,iVBORw0KGgoAAAANSUHeHggAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="
    response = test_client.post(
        "/chat/stream",
        json={"message": "Describe this stream", "images": [image_b64]},
    )
    assert response.status_code == 200
    assert response.headers["content-type"] == "text/event-stream; charset=utf-8"

    lines = list(response.iter_lines())
    non_empty_lines = [line for line in lines if line.strip()]
    assert len(non_empty_lines) == 5

    import json

    chunk_1 = json.loads(non_empty_lines[0].replace("data: ", ""))
    assert chunk_1["text"] == "stubbed"
    conv_id = chunk_1["conversation_id"]

    messages = getattr(test_client, "fake_repo").get_all_messages(conv_id)
    assert len(messages) >= 1
    user_msg = messages[0]
    assert user_msg["role"] == "user"
    assert len(user_msg["attachments"]) == 1
    assert user_msg["attachments"][0]["mime_type"] == "image/png"


def test_chat_stream_empty_choices(test_client: TestClient) -> None:
    from app.dependencies import get_llm_client

    class EmptyChoiceChunk:
        def __init__(self):
            self.choices = []

    class ChunkDelta:
        def __init__(self, content: str):
            self.content = content

    class ChunkChoice:
        def __init__(self, content: str):
            self.delta = ChunkDelta(content)

    class ValidChunk:
        def __init__(self, content: str):
            self.choices = [ChunkChoice(content)]

    class MockLlmClientWithEmptyChoices:
        async def astream(self, messages: list[dict]):
            yield EmptyChoiceChunk()
            yield ValidChunk("hello")
            yield EmptyChoiceChunk()
            yield ValidChunk(" world")

    app = test_client.app
    app.dependency_overrides[get_llm_client] = lambda: MockLlmClientWithEmptyChoices()

    response = test_client.post("/chat/stream", json={"message": "Test empty choices"})
    assert response.status_code == 200

    lines = list(response.iter_lines())
    non_empty_lines = [line for line in lines if line.strip()]

    import json
    chunks = []
    for line in non_empty_lines:
        line_str = line.decode("utf-8") if isinstance(line, bytes) else line
        if line_str == "data: [DONE]":
            break
        if line_str.startswith("data: "):
            chunks.append(json.loads(line_str.replace("data: ", "")))

    assert len(chunks) >= 2
    assert chunks[0]["text"] == "hello"
    assert chunks[1]["text"] == " world"

