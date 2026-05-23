from __future__ import annotations

import logging

from boto3.dynamodb.conditions import Key
from botocore.exceptions import ClientError

logger = logging.getLogger(__name__)


def pk_for_conversation(conversation_id: str) -> str:
    return f"CONV#{conversation_id}"


def message_sk(created_at: str, message_id: str) -> str:
    return f"MSG#{created_at}#{message_id}"


class ConversationRepository:
    def __init__(self, table):
        self._table = table

    def create_conversation(
        self, conversation_id: str, created_at: str, user_id: str | None
    ) -> None:
        logger.debug(
            "create_conversation conversation_id=%s user_id=%s", conversation_id, user_id
        )
        item = {
            "pk": pk_for_conversation(conversation_id),
            "sk": "META",
            "conversation_id": conversation_id,
            "created_at": created_at,
            "updated_at": created_at,
        }
        if user_id:
            item["user_id"] = user_id
        try:
            self._table.put_item(
                Item=item,
                ConditionExpression="attribute_not_exists(pk)",
            )
            logger.debug("Conversation created conversation_id=%s", conversation_id)
        except ClientError as exc:
            if exc.response["Error"]["Code"] != "ConditionalCheckFailedException":
                logger.exception(
                    "DynamoDB error creating conversation conversation_id=%s", conversation_id
                )
                raise
            logger.debug(
                "Conversation already exists, skipping create conversation_id=%s",
                conversation_id,
            )

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
        logger.debug(
            "put_message conversation_id=%s message_id=%s role=%s", conversation_id, message_id, role
        )
        item = {
            "pk": pk_for_conversation(conversation_id),
            "sk": message_sk(created_at, message_id),
            "message_id": message_id,
            "role": role,
            "content": content,
            "created_at": created_at,
        }
        if attachment:
            item["attachment"] = attachment
        if user_id:
            item["user_id"] = user_id
        self._table.put_item(Item=item)

    def get_recent_messages(self, conversation_id: str, limit: int) -> list[dict]:
        logger.debug(
            "get_recent_messages conversation_id=%s limit=%d", conversation_id, limit
        )
        response = self._table.query(
            KeyConditionExpression=Key("pk").eq(pk_for_conversation(conversation_id))
            & Key("sk").begins_with("MSG#"),
            ScanIndexForward=False,
            Limit=limit,
        )
        items = response.get("Items", [])
        items.reverse()
        logger.debug(
            "get_recent_messages returned %d messages conversation_id=%s",
            len(items),
            conversation_id,
        )
        return items

    def get_context(self, conversation_id: str) -> dict | None:
        logger.debug("get_context conversation_id=%s", conversation_id)
        response = self._table.get_item(
            Key={"pk": pk_for_conversation(conversation_id), "sk": "CTX"}
        )
        item = response.get("Item")
        logger.debug(
            "get_context conversation_id=%s found=%s", conversation_id, item is not None
        )
        return item

    def set_context(
        self,
        conversation_id: str,
        messages: list[dict],
        ttl_epoch: int,
        updated_at: str,
    ) -> None:
        logger.debug(
            "set_context conversation_id=%s message_count=%d ttl=%d",
            conversation_id,
            len(messages),
            ttl_epoch,
        )
        self._table.put_item(
            Item={
                "pk": pk_for_conversation(conversation_id),
                "sk": "CTX",
                "messages": messages,
                "ttl": ttl_epoch,
                "updated_at": updated_at,
            }
        )
