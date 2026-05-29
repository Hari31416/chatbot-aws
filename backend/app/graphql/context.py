from __future__ import annotations

import logging
from typing import Optional

import strawberry
from fastapi import Depends, Request
from strawberry.fastapi import BaseContext

from ..dependencies import (
    get_current_user_id,
    get_optional_user_id,
    get_repository,
    get_vector_store,
    get_storage,
)
from ..repositories.conversation_repository import ConversationRepository
from ..services.vector_store import VectorStoreClient
from ..services.storage import StorageService

logger = logging.getLogger(__name__)


class GraphQLContext(BaseContext):
    """
    Typed context passed to every GraphQL resolver via ``info.context``.

    ``user_id`` is *optional*: the ``health`` field works without auth;
    protected fields (``conversations``, ``ragDocuments``) check for it
    themselves and raise ``PermissionError`` when absent.
    """

    def __init__(
        self,
        request: Request,
        repo: ConversationRepository,
        vector_store: VectorStoreClient,
        storage: StorageService,
        user_id: Optional[str],
    ) -> None:
        super().__init__()
        self.request = request
        self.repo = repo
        self.vector_store = vector_store
        self.storage = storage
        self.user_id = user_id


async def get_graphql_context(
    request: Request,
    repo: ConversationRepository = Depends(get_repository),
    vector_store: VectorStoreClient = Depends(get_vector_store),
    storage: StorageService = Depends(get_storage),
    user_id: Optional[str] = Depends(get_optional_user_id),
) -> GraphQLContext:
    """
    FastAPI dependency injected by ``GraphQLRouter`` as ``context_getter``.

    Auth is intentionally optional here so that the ``health`` field
    remains publicly accessible.  Individual resolvers that require an
    authenticated user call ``_require_user``.
    """
    return GraphQLContext(
        request=request,
        repo=repo,
        vector_store=vector_store,
        storage=storage,
        user_id=user_id,
    )


def _require_user(context: GraphQLContext) -> str:
    """
    Assert that a user_id is present in the context.

    Raises ``PermissionError`` (translated to a GraphQL error with HTTP 200)
    when the request carries no valid auth token.
    """
    if not context.user_id:
        raise PermissionError("Authentication required")
    return context.user_id
