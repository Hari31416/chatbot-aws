from __future__ import annotations

from pydantic import BaseModel, Field


class ChatRequest(BaseModel):
    message: str = Field(min_length=1)
    conversation_id: str | None = None
    user_id: str | None = None
    use_rag: bool = False
    rag_documents: list[str] | None = None


class RagIngestRequest(BaseModel):
    filename: str = Field(..., min_length=1, max_length=255)
    content: str = Field(..., min_length=1)


class RagIngestResponse(BaseModel):
    status: str
    filename: str
    document_id: str
    chunks_ingested: int


class RagDocumentResponse(BaseModel):
    document_id: str
    filename: str
    source_doc: str
    chunks_ingested: int
    created_at: str
    updated_at: str
    status: str = "ready"


class RagSearchRequest(BaseModel):
    query: str = Field(..., min_length=1)
    top_k: int = Field(default=3, ge=1, le=20)
    documents: list[str] | None = None


class RagSearchResult(BaseModel):
    text: str
    source: str
    score: float
    key: str | None = None


class RagSearchResponse(BaseModel):
    query: str
    results: list[RagSearchResult]


class Attachment(BaseModel):
    s3_key: str
    mime_type: str
    size_bytes: int
    presigned_url: str | None = None


class ChatResponse(BaseModel):
    conversation_id: str | None = None
    user_message_id: str | None = None
    assistant_message_id: str | None = None
    assistant_message: str | None = None
    created_at: str | None = None
    error: str | None = None


class ChatImageResponse(ChatResponse):
    attachment: Attachment | None = None
    attachments: list[Attachment] | None = None


class ConversationResponse(BaseModel):
    id: str
    name: str
    created_at: str
    updated_at: str
    user_id: str | None = None


class MessageResponse(BaseModel):
    id: str
    role: str
    content: str
    created_at: str
    attachment: Attachment | None = None
    attachments: list[Attachment] | None = None


class UpdateConversationRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
