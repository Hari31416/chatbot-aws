from __future__ import annotations

import logging
from typing import List, Optional

import strawberry
from anyio import to_thread
from strawberry.types import Info

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


# ── Query root ─────────────────────────────────────────────────────────────────


@strawberry.type
class Query:
    """
    GraphQL query root.

    - ``health`` — public, no auth required (mirrors GET /health).
    - ``conversations`` — requires a valid auth token.
    - ``rag_documents`` — requires a valid auth token.
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


schema = strawberry.Schema(query=Query)
