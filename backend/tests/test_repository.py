from __future__ import annotations

from decimal import Decimal
from unittest.mock import MagicMock

from app.repositories.conversation_repository import ConversationRepository


def test_repository_float_decimal_conversion() -> None:
    mock_table = MagicMock()
    repo = ConversationRepository(mock_table)

    # 1. Test put_message converts floats to Decimals
    citations = [
        {
            "key": "chunk-1",
            "score": 0.91,
            "text": "test",
            "page": 1,
        }
    ]
    repo.put_message(
        conversation_id="conv-1",
        message_id="msg-1",
        role="assistant",
        content="hello",
        created_at="2026-05-27T12:00:00",
        citations=citations,
    )

    # Assert that put_item was called with Decimal instead of float
    mock_table.put_item.assert_called_once()
    called_item = mock_table.put_item.call_args[1]["Item"]
    assert isinstance(called_item["citations"][0]["score"], Decimal)
    assert called_item["citations"][0]["score"] == Decimal("0.91")

    # 2. Test get_all_messages converts Decimals back to floats
    mock_table.query.return_value = {
        "Items": [
            {
                "pk": "CONV#conv-1",
                "sk": "MSG#2026-05-27T12:00:00#msg-1",
                "message_id": "msg-1",
                "role": "assistant",
                "content": "hello",
                "created_at": "2026-05-27T12:00:00",
                "citations": [
                    {
                        "key": "chunk-1",
                        "score": Decimal("0.91"),
                        "text": "test",
                        "page": 1,
                    }
                ],
            }
        ]
    }

    messages = repo.get_all_messages(conversation_id="conv-1")
    assert len(messages) == 1
    assert isinstance(messages[0]["citations"][0]["score"], float)
    assert messages[0]["citations"][0]["score"] == 0.91
