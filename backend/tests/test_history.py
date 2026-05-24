from fastapi.testclient import TestClient


def test_history_workflow(test_client: TestClient) -> None:
    # 1. Create a conversation and message through chat endpoint
    response = test_client.post(
        "/chat",
        json={"message": "Hello from testing!", "conversation_id": "test-conv-123"},
        headers={"X-User-ID": "test-user"},
    )
    assert response.status_code == 200
    payload = response.json()
    conv_id = payload["conversation_id"]
    assert conv_id == "test-conv-123"

    # 2. Get list of conversations
    response = test_client.get(
        "/conversations",
        headers={"X-User-ID": "test-user"},
    )
    assert response.status_code == 200
    conversations = response.json()
    assert len(conversations) == 1
    assert conversations[0]["id"] == "test-conv-123"
    assert conversations[0]["name"] == "Hello from testing!"

    # 3. Get messages for the conversation
    response = test_client.get(
        f"/conversations/{conv_id}/messages",
        headers={"X-User-ID": "test-user"},
    )
    assert response.status_code == 200
    messages = response.json()
    # Should have two messages: user message and assistant message
    assert len(messages) == 2
    assert messages[0]["role"] == "user"
    assert messages[0]["content"] == "Hello from testing!"
    assert messages[1]["role"] == "assistant"
    assert messages[1]["content"] == "stubbed response"

    # 4. Update conversation name
    response = test_client.put(
        f"/conversations/{conv_id}",
        json={"name": "Updated Chat Name"},
        headers={"X-User-ID": "test-user"},
    )
    assert response.status_code == 200
    updated_conv = response.json()
    assert updated_conv["name"] == "Updated Chat Name"

    # Verify update persisted in the list endpoint
    response = test_client.get(
        "/conversations",
        headers={"X-User-ID": "test-user"},
    )
    assert response.status_code == 200
    conversations = response.json()
    assert conversations[0]["name"] == "Updated Chat Name"

    # 5. Delete the conversation
    response = test_client.delete(
        f"/conversations/{conv_id}",
        headers={"X-User-ID": "test-user"},
    )
    assert response.status_code == 200
    assert response.json() == {"deleted": True, "conversation_id": conv_id}

    # Verify it is deleted from list endpoint
    response = test_client.get(
        "/conversations",
        headers={"X-User-ID": "test-user"},
    )
    assert response.status_code == 200
    assert len(response.json()) == 0

    # Verify detail returns 404
    response = test_client.get(
        f"/conversations/{conv_id}/messages",
        headers={"X-User-ID": "test-user"},
    )
    assert response.status_code == 404


def test_history_unauthorized_access(test_client: TestClient) -> None:
    # 1. Create conversation as user A
    response = test_client.post(
        "/chat",
        json={"message": "Hello from user A", "conversation_id": "conv-a"},
        headers={"X-User-ID": "user-a"},
    )
    assert response.status_code == 200

    # 2. Try to fetch messages as user B -> should be 404 not found
    response = test_client.get(
        "/conversations/conv-a/messages",
        headers={"X-User-ID": "user-b"},
    )
    assert response.status_code == 404

    # 3. Try to rename as user B -> should be 404 not found
    response = test_client.put(
        "/conversations/conv-a",
        json={"name": "Hacked Name"},
        headers={"X-User-ID": "user-b"},
    )
    assert response.status_code == 404

    # 4. Try to delete as user B -> should be 404 not found
    response = test_client.delete(
        "/conversations/conv-a",
        headers={"X-User-ID": "user-b"},
    )
    assert response.status_code == 404
