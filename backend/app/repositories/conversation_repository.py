from __future__ import annotations

import logging

from boto3.dynamodb.conditions import Key
from botocore.exceptions import ClientError

logger = logging.getLogger(__name__)


def pk_for_conversation(conversation_id: str) -> str:
    return f"CONV#{conversation_id}"


def message_sk(created_at: str, message_id: str) -> str:
    return f"MSG#{created_at}#{message_id}"


def pk_for_user(user_id: str) -> str:
    return f"USER#{user_id}"


def rag_document_sk(created_at: str, document_id: str) -> str:
    return f"RAGDOC#{created_at}#{document_id}"


class ConversationRepository:
    def __init__(self, table):
        self._table = table

    def create_conversation(
        self,
        conversation_id: str,
        created_at: str,
        user_id: str | None,
        name: str = "New Chat...",
    ) -> None:
        logger.debug(
            "create_conversation conversation_id=%s user_id=%s name=%s",
            conversation_id,
            user_id,
            name,
        )
        item = {
            "pk": pk_for_conversation(conversation_id),
            "sk": "META",
            "conversation_id": conversation_id,
            "created_at": created_at,
            "updated_at": created_at,
            "name": name,
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
                    "DynamoDB error creating conversation conversation_id=%s",
                    conversation_id,
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
        attachments: list[dict] | None = None,
    ) -> None:
        logger.debug(
            "put_message conversation_id=%s message_id=%s role=%s",
            conversation_id,
            message_id,
            role,
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
        if attachments:
            item["attachments"] = attachments
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

    def get_user_conversations(self, user_id: str) -> list[dict]:
        logger.debug("get_user_conversations user_id=%s", user_id)
        response = self._table.query(
            IndexName="UserConversationsIndexV2",
            KeyConditionExpression=Key("user_id").eq(user_id) & Key("sk").eq("META"),
        )
        items = response.get("Items", [])
        items.sort(
            key=lambda x: x.get("updated_at", x.get("created_at", "")), reverse=True
        )
        return items

    def get_conversation_meta(self, conversation_id: str) -> dict | None:
        logger.debug("get_conversation_meta conversation_id=%s", conversation_id)
        response = self._table.get_item(
            Key={"pk": pk_for_conversation(conversation_id), "sk": "META"}
        )
        return response.get("Item")

    def update_conversation(
        self, conversation_id: str, name: str, updated_at: str
    ) -> None:
        logger.debug(
            "update_conversation conversation_id=%s name=%s", conversation_id, name
        )
        self._table.update_item(
            Key={"pk": pk_for_conversation(conversation_id), "sk": "META"},
            UpdateExpression="SET #name = :name, updated_at = :updated_at",
            ExpressionAttributeNames={"#name": "name"},
            ExpressionAttributeValues={":name": name, ":updated_at": updated_at},
        )

    def get_all_messages(self, conversation_id: str) -> list[dict]:
        logger.debug("get_all_messages conversation_id=%s", conversation_id)
        response = self._table.query(
            KeyConditionExpression=Key("pk").eq(pk_for_conversation(conversation_id))
            & Key("sk").begins_with("MSG#"),
            ScanIndexForward=True,
        )
        return response.get("Items", [])

    def delete_conversation(self, conversation_id: str) -> None:
        logger.debug("delete_conversation conversation_id=%s", conversation_id)
        pk = pk_for_conversation(conversation_id)
        response = self._table.query(KeyConditionExpression=Key("pk").eq(pk))
        items = response.get("Items", [])
        if not items:
            return
        with self._table.batch_writer() as batch:
            for item in items:
                batch.delete_item(Key={"pk": item["pk"], "sk": item["sk"]})

    def put_rag_document(
        self,
        user_id: str,
        document_id: str,
        filename: str,
        chunks_ingested: int,
        created_at: str,
        status: str = "ready",
    ) -> None:
        logger.debug(
            "put_rag_document user_id=%s document_id=%s filename=%s status=%s",
            user_id,
            document_id,
            filename,
            status,
        )
        self._table.put_item(
            Item={
                "pk": pk_for_user(user_id),
                "sk": rag_document_sk(created_at, document_id),
                "user_id": user_id,
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
        logger.debug(
            "update_rag_document_status user_id=%s document_id=%s status=%s chunks=%d",
            user_id,
            document_id,
            status,
            chunks_ingested,
        )
        # Find the document first by querying all rag documents of this user
        response = self._table.query(
            KeyConditionExpression=Key("pk").eq(pk_for_user(user_id))
            & Key("sk").begins_with("RAGDOC#")
        )
        items = response.get("Items", [])
        target_item = None
        for item in items:
            if item.get("document_id") == document_id:
                target_item = item
                break
        
        if not target_item:
            logger.warning("RAG document not found for update user_id=%s document_id=%s", user_id, document_id)
            return
            
        self._table.update_item(
            Key={"pk": target_item["pk"], "sk": target_item["sk"]},
            UpdateExpression="SET #status = :status, chunks_ingested = :chunks_ingested, updated_at = :updated_at",
            ExpressionAttributeNames={"#status": "status"},
            ExpressionAttributeValues={
                ":status": status,
                ":chunks_ingested": chunks_ingested,
                ":updated_at": updated_at,
            }
        )

    def list_rag_documents(self, user_id: str) -> list[dict]:
        logger.debug("list_rag_documents user_id=%s", user_id)
        response = self._table.query(
            KeyConditionExpression=Key("pk").eq(pk_for_user(user_id))
            & Key("sk").begins_with("RAGDOC#"),
            ScanIndexForward=False,
        )
        return response.get("Items", [])
