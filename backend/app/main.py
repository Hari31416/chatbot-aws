import logging
import os
from typing import Any, cast

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from mangum import Mangum
from strawberry.fastapi import GraphQLRouter

from .api.routes import router
from .graphql.context import get_graphql_context
from .graphql.schema import schema
from .logging_config import configure_logging

configure_logging()

logger = logging.getLogger(__name__)

app = FastAPI(title="Chatbot API")

app.add_middleware(
    cast(Any, CORSMiddleware),
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router)

# ── GraphQL endpoint ───────────────────────────────────────────────────────────
# Playground is disabled by default (recommended for Lambda / production).
# Set GRAPHQL_PLAYGROUND=true in the environment to enable GraphiQL locally.
_graphql_ide = (
    "graphiql" if os.getenv("GRAPHQL_PLAYGROUND", "").lower() == "true" else None
)

graphql_app: GraphQLRouter = GraphQLRouter(
    schema,
    context_getter=get_graphql_context,
    graphql_ide=_graphql_ide,
)
app.include_router(graphql_app, prefix="/graphql")


@app.get("/health")
def health() -> dict[str, str]:
    logger.debug("Health check requested")
    return {"status": "ok"}


logger.info("Chatbot API initialised")

handler = Mangum(app)
