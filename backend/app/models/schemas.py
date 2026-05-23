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

