from __future__ import annotations

import logging
from typing import List, Optional
from uuid import uuid4

import strawberry
from anyio import to_thread
from strawberry.types import Info

from ..utils.time import utcnow_iso
from .context import GraphQLContext, _require_user

logger = logging.getLogger(__name__)


# ── Strawberry output types ────────────────────────────────────────────────────


@strawberry.type
class HealthStatus:
    status: str


@strawberry.type
class ConversationItem:
    id: str
    name: str
    created_at: str
    updated_at: str
    user_id: Optional[str]


@strawberry.type
class RagDocumentItem:
    document_id: str
    filename: str
    status: str
    chunks_ingested: int
    created_at: str
    tags: Optional[List[str]]


@strawberry.type
class AttachmentItem:
    s3_key: str
    mime_type: str
    size_bytes: int
    presigned_url: Optional[str] = None


@strawberry.type
class CitationItem:
    text: str
    source: str
    score: float
    key: Optional[str] = None
    page: Optional[int] = None


@strawberry.type
class MessageItem:
    id: str
    role: str
    content: str
    created_at: str
    attachment: Optional[AttachmentItem] = None
    attachments: Optional[List[AttachmentItem]] = None
    citations: Optional[List[CitationItem]] = None


@strawberry.type
class DeleteConversationPayload:
    deleted: bool
    conversation_id: str


@strawberry.type
class DeleteRagDocumentPayload:
    deleted: bool
    document_id: str


@strawberry.type
class IngestRagTextPayload:
    status: str
    filename: str
    document_id: str
    chunks_ingested: int


# ── Query root ─────────────────────────────────────────────────────────────────


@strawberry.type
class Query:
    """
    GraphQL query root.

    - ``health`` — public, no auth required (mirrors GET /health).
    - ``conversations`` — requires a valid auth token.
    - ``rag_documents`` — requires a valid auth token.
    - ``conversation_messages`` — requires a valid auth token.
    """

    @strawberry.field
    def health(self) -> HealthStatus:
        """Public health probe — used by the connection screen and warmer."""
        return HealthStatus(status="ok")

    @strawberry.field
    async def conversations(
        self, info: Info[GraphQLContext, None]
    ) -> List[ConversationItem]:
        """Return all conversations for the authenticated user."""
        user_id = _require_user(info.context)
        items = await to_thread.run_sync(
            info.context.repo.get_user_conversations, user_id
        )
        return [
            ConversationItem(
                id=item.get("conversation_id", ""),
                name=item.get("name") or "New Chat...",
                created_at=item.get("created_at", ""),
                updated_at=item.get("updated_at", item.get("created_at", "")),
                user_id=item.get("user_id"),
            )
            for item in items
        ]

    @strawberry.field
    async def rag_documents(
        self, info: Info[GraphQLContext, None]
    ) -> List[RagDocumentItem]:
        """Return all ingested RAG documents for the authenticated user."""
        user_id = _require_user(info.context)
        items = await to_thread.run_sync(info.context.repo.list_rag_documents, user_id)
        return [
            RagDocumentItem(
                document_id=item.get("document_id", ""),
                filename=item.get("filename", ""),
                status=item.get("status", "ready"),
                chunks_ingested=int(item.get("chunks_ingested", 0)),
                created_at=item.get("created_at", ""),
                tags=item.get("tags"),
            )
            for item in items
        ]

    @strawberry.field
    async def conversation_messages(
        self, info: Info[GraphQLContext, None], conversation_id: str
    ) -> List[MessageItem]:
        """Return all messages for the specified conversation."""
        user_id = _require_user(info.context)
        meta = await to_thread.run_sync(
            info.context.repo.get_conversation_meta, conversation_id
        )
        if not meta or (meta.get("user_id") and meta.get("user_id") != user_id):
            raise PermissionError("Conversation not found or access denied")

        items = await to_thread.run_sync(
            info.context.repo.get_all_messages, conversation_id
        )
        messages = []
        for item in items:
            attachment_data = item.get("attachment")
            attachment = None
            if attachment_data:
                s3_key = attachment_data.get("s3_key")
                presigned_url = None
                if s3_key:
                    presigned_url = info.context.storage.generate_presigned_url(s3_key)
                attachment = AttachmentItem(
                    s3_key=s3_key or "",
                    mime_type=attachment_data.get("mime_type") or "",
                    size_bytes=int(attachment_data.get("size_bytes") or 0),
                    presigned_url=presigned_url,
                )

            attachments_data = item.get("attachments")
            attachments = None
            if attachments_data:
                attachments = []
                for att in attachments_data:
                    s3_key = att.get("s3_key")
                    presigned_url = None
                    if s3_key:
                        presigned_url = info.context.storage.generate_presigned_url(
                            s3_key
                        )
                    attachments.append(
                        AttachmentItem(
                            s3_key=s3_key or "",
                            mime_type=att.get("mime_type") or "",
                            size_bytes=int(att.get("size_bytes") or 0),
                            presigned_url=presigned_url,
                        )
                    )

            citations_data = item.get("citations")
            citations = None
            if citations_data:
                citations = []
                for cit in citations_data:
                    citations.append(
                        CitationItem(
                            text=cit.get("text") or "",
                            source=cit.get("source") or "",
                            score=float(cit.get("score") or 0.0),
                            key=cit.get("key"),
                            page=cit.get("page"),
                        )
                    )

            messages.append(
                MessageItem(
                    id=item.get("message_id") or item.get("sk", "").split("#")[-1],
                    role=item.get("role") or "user",
                    content=item.get("content") or "",
                    created_at=item.get("created_at") or "",
                    attachment=attachment,
                    attachments=attachments,
                    citations=citations,
                )
            )
        return messages


# ── Mutation root ──────────────────────────────────────────────────────────────


@strawberry.type
class Mutation:
    @strawberry.mutation
    async def update_conversation_name(
        self, info: Info[GraphQLContext, None], conversation_id: str, name: str
    ) -> ConversationItem:
        user_id = _require_user(info.context)
        meta = await to_thread.run_sync(
            info.context.repo.get_conversation_meta, conversation_id
        )
        if not meta or (meta.get("user_id") and meta.get("user_id") != user_id):
            raise PermissionError("Conversation not found or access denied")

        updated_at = utcnow_iso()
        await to_thread.run_sync(
            info.context.repo.update_conversation,
            conversation_id,
            name,
            updated_at,
        )
        return ConversationItem(
            id=conversation_id,
            name=name,
            created_at=meta.get("created_at") or "",
            updated_at=updated_at,
            user_id=meta.get("user_id"),
        )

    @strawberry.mutation
    async def delete_conversation(
        self, info: Info[GraphQLContext, None], conversation_id: str
    ) -> DeleteConversationPayload:
        user_id = _require_user(info.context)
        meta = await to_thread.run_sync(
            info.context.repo.get_conversation_meta, conversation_id
        )
        if not meta or (meta.get("user_id") and meta.get("user_id") != user_id):
            raise PermissionError("Conversation not found or access denied")

        await to_thread.run_sync(info.context.repo.delete_conversation, conversation_id)
        return DeleteConversationPayload(deleted=True, conversation_id=conversation_id)

    @strawberry.mutation
    async def delete_rag_document(
        self, info: Info[GraphQLContext, None], document_id: str
    ) -> DeleteRagDocumentPayload:
        user_id = _require_user(info.context)
        deleted_item = await to_thread.run_sync(
            info.context.repo.delete_rag_document, user_id, document_id
        )
        if not deleted_item:
            raise PermissionError("Document not found or access denied")

        chunks_ingested = int(deleted_item.get("chunks_ingested", 0))
        if chunks_ingested > 0:
            keys = [f"{document_id}#chunk-{idx}" for idx in range(chunks_ingested)]
            try:
                await info.context.vector_store.delete_chunks(keys)
            except Exception as e:
                logger.exception(
                    "Failed to delete vectors for document_id=%s: %s",
                    document_id,
                    e,
                )
        return DeleteRagDocumentPayload(deleted=True, document_id=document_id)

    @strawberry.mutation
    async def ingest_rag_text(
        self,
        info: Info[GraphQLContext, None],
        filename: str,
        content: str,
        tags: List[str],
    ) -> IngestRagTextPayload:
        user_id = _require_user(info.context)
        document_id = str(uuid4())
        created_at = utcnow_iso()

        await to_thread.run_sync(
            info.context.repo.put_rag_document,
            user_id,
            document_id,
            filename,
            0,
            created_at,
            "processing",
            tags,
        )

        s3_key = f"staging/{user_id}/{document_id}/{filename}"
        await to_thread.run_sync(
            info.context.storage.upload_bytes,
            s3_key,
            content.encode("utf-8"),
            "text/plain",
        )

        return IngestRagTextPayload(
            status="processing",
            filename=filename,
            document_id=document_id,
            chunks_ingested=0,
        )


schema = strawberry.Schema(query=Query, mutation=Mutation)
