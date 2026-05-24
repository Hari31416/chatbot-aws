from __future__ import annotations

from pydantic import BaseModel, Field


class ChatRequest(BaseModel):
    message: str = Field(min_length=1)
    conversation_id: str | None = None
    user_id: str | None = None


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


class UpdateConversationRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)

