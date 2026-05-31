from __future__ import annotations

import json
import logging
from uuid import uuid4

from anyio import to_thread
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from fastapi.responses import StreamingResponse

from ..dependencies import (
    get_chat_service,
    get_current_user_id,
    get_repository,
    get_settings,
    get_storage,
    get_vector_store,
)
from ..models.schemas import (
    Attachment,
    ChatRequest,
    ChatResponse,
    ConversationResponse,
    MessageResponse,
    RagDocumentResponse,
    RagIngestRequest,
    RagIngestResponse,
    RagSearchRequest,
    RagSearchResponse,
    UpdateConversationRequest,
)
from ..services.chat import ChatService
from ..utils.time import utcnow_iso

logger = logging.getLogger(__name__)

router = APIRouter()


@router.api_route("/warm", methods=["GET", "POST"])
def warm() -> dict[str, str]:
    logger.info("Warmer endpoint called; container kept warm")
    return {"status": "warmed"}


@router.post("/chat", response_model=ChatResponse)
async def chat(
    payload: ChatRequest,
    chat_service: ChatService = Depends(get_chat_service),
    user_id: str = Depends(get_current_user_id),
) -> ChatResponse:
    try:
        chat_ctx = await chat_service.prepare_chat(payload, user_id)

        assistant_text = await chat_ctx.llm_client.generate(chat_ctx.messages)
        if not assistant_text:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="LLM returned empty response",
            )

        processed_text, assistant_message_id, cited_sources = (
            await chat_service.finalize_chat(
                conversation_id=chat_ctx.conversation_id,
                history=chat_ctx.history,
                user_message=payload.message,
                assistant_text=assistant_text,
                use_rag=payload.use_rag,
                context_results=chat_ctx.context_results,
            )
        )

        logger.info(
            "chat complete conversation_id=%s user_message_id=%s assistant_message_id=%s",
            chat_ctx.conversation_id,
            chat_ctx.user_message_id,
            assistant_message_id,
        )
        return ChatResponse(
            conversation_id=chat_ctx.conversation_id,
            user_message_id=chat_ctx.user_message_id,
            assistant_message_id=assistant_message_id,
            assistant_message=processed_text,
            created_at=utcnow_iso(),
            citations=cited_sources if cited_sources else None,
        )
    except Exception as e:
        error_msg = str(e)
        if isinstance(e, HTTPException):
            error_msg = e.detail
            logger.warning(
                "chat HTTP error conversation_id=%s status=%d detail=%s",
                payload.conversation_id or "unknown",
                e.status_code,
                e.detail,
            )
        else:
            logger.exception(
                "chat unexpected error conversation_id=%s",
                payload.conversation_id or "unknown",
            )
        return ChatResponse(
            conversation_id=payload.conversation_id or "unknown",
            error=error_msg,
        )


@router.post("/chat/stream")
async def chat_stream(
    payload: ChatRequest,
    chat_service: ChatService = Depends(get_chat_service),
    user_id: str = Depends(get_current_user_id),
) -> StreamingResponse:
    try:
        chat_ctx = await chat_service.prepare_chat(payload, user_id)

        async def token_generator():
            accumulated_text = ""
            assistant_message_id = str(uuid4())
            try:
                # Call streaming method of LiteLLM/OpenAI client
                async for chunk in chat_ctx.llm_client.astream(chat_ctx.messages):
                    if not chunk.choices:
                        continue
                    token = chunk.choices[0].delta.content or ""
                    if token:
                        accumulated_text += token
                        # Yield compliant SSE event chunk
                        yield f"data: {json.dumps({'text': token, 'conversation_id': chat_ctx.conversation_id, 'assistant_message_id': assistant_message_id, 'user_message_id': chat_ctx.user_message_id})}\n\n"

                processed_text, _, cited_sources = await chat_service.finalize_chat(
                    conversation_id=chat_ctx.conversation_id,
                    history=chat_ctx.history,
                    user_message=payload.message,
                    assistant_text=accumulated_text,
                    use_rag=payload.use_rag,
                    context_results=chat_ctx.context_results,
                    assistant_message_id=assistant_message_id,
                )

                # Yield remapped citations and final remapped content text
                yield f"data: {json.dumps({'citations': cited_sources, 'text': '', 'conversation_id': chat_ctx.conversation_id, 'assistant_message_id': assistant_message_id, 'user_message_id': chat_ctx.user_message_id, 'final_content': processed_text})}\n\n"

                # Send close token
                yield "data: [DONE]\n\n"

            except Exception as e:
                logger.exception(
                    "Error in LLM stream generator for conversation_id=%s",
                    chat_ctx.conversation_id,
                )
                yield f"data: {json.dumps({'error': 'Stream generation interrupted', 'details': str(e)})}\n\n"

        return StreamingResponse(token_generator(), media_type="text/event-stream")

    except Exception as e:
        logger.exception("chat_stream initialization failed")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(e),
        )


@router.post(
    "/rag/ingest",
    response_model=RagIngestResponse,
    status_code=status.HTTP_202_ACCEPTED,
)
async def ingest_rag_text(
    payload: RagIngestRequest,
    repo=Depends(get_repository),
    storage=Depends(get_storage),
    user_id: str = Depends(get_current_user_id),
) -> RagIngestResponse:
    logger.info("RAG ingest request filename=%s user_id=%s", payload.filename, user_id)
    document_id = str(uuid4())
    created_at = utcnow_iso()

    await to_thread.run_sync(
        repo.put_rag_document,
        user_id,
        document_id,
        payload.filename,
        0,
        created_at,
        "processing",
        payload.tags,
    )

    s3_key = f"staging/{user_id}/{document_id}/{payload.filename}"
    await to_thread.run_sync(
        storage.upload_bytes, s3_key, payload.content.encode("utf-8"), "text/plain"
    )

    return RagIngestResponse(
        status="processing",
        filename=payload.filename,
        document_id=document_id,
        chunks_ingested=0,
    )


@router.post(
    "/rag/ingest/file",
    response_model=RagIngestResponse,
    status_code=status.HTTP_202_ACCEPTED,
)
async def ingest_rag_file(
    file: UploadFile = File(...),
    tags: str | None = Form(None),
    repo=Depends(get_repository),
    storage=Depends(get_storage),
    user_id: str = Depends(get_current_user_id),
) -> RagIngestResponse:
    filename = file.filename or "uploaded_document"
    logger.info(
        "RAG file ingest request filename=%s user_id=%s tags=%s",
        filename,
        user_id,
        tags,
    )

    # 1. Enforce 20MB maximum file size limit
    data = await file.read()
    size_bytes = len(data)
    max_bytes = 20 * 1024 * 1024  # 20MB
    if size_bytes > max_bytes:
        logger.warning(
            "RAG file ingest rejected: file too large size=%d max=%d",
            size_bytes,
            max_bytes,
        )
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"File exceeds maximum size of 20MB (got {size_bytes / (1024 * 1024):.1f}MB)",
        )

    parsed_tags = None
    if tags:
        try:
            parsed_tags = json.loads(tags)
            if not isinstance(parsed_tags, list):
                parsed_tags = [str(parsed_tags)]
        except Exception:
            parsed_tags = [t.strip() for t in tags.split(",") if t.strip()]

    document_id = str(uuid4())
    created_at = utcnow_iso()

    # 2. Save placeholder in DynamoDB
    await to_thread.run_sync(
        repo.put_rag_document,
        user_id,
        document_id,
        filename,
        0,
        created_at,
        "processing",
        parsed_tags,
    )

    # 3. Upload raw file to S3 under staging prefix
    s3_key = f"staging/{user_id}/{document_id}/{filename}"
    await to_thread.run_sync(
        storage.upload_bytes,
        s3_key,
        data,
        file.content_type or "application/octet-stream",
    )

    return RagIngestResponse(
        status="processing",
        filename=filename,
        document_id=document_id,
        chunks_ingested=0,
    )


@router.get("/rag/documents", response_model=list[RagDocumentResponse])
async def list_rag_documents(
    repo=Depends(get_repository),
    user_id: str = Depends(get_current_user_id),
) -> list[RagDocumentResponse]:
    items = await to_thread.run_sync(repo.list_rag_documents, user_id)
    return [
        RagDocumentResponse(
            document_id=item.get("document_id"),
            filename=item.get("filename"),
            source_doc=item.get("source_doc") or item.get("filename"),
            chunks_ingested=item.get("chunks_ingested", 0),
            created_at=item.get("created_at"),
            updated_at=item.get("updated_at", item.get("created_at")),
            status=item.get("status", "ready"),
            tags=item.get("tags"),
        )
        for item in items
    ]


@router.delete("/rag/documents/{document_id}")
async def delete_rag_document(
    document_id: str,
    repo=Depends(get_repository),
    vector_store=Depends(get_vector_store),
    user_id: str = Depends(get_current_user_id),
) -> dict:
    logger.info(
        "RAG document delete request document_id=%s user_id=%s",
        document_id,
        user_id,
    )
    deleted_item = await to_thread.run_sync(
        repo.delete_rag_document, user_id, document_id
    )
    if not deleted_item:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Document not found",
        )

    chunks_ingested = int(deleted_item.get("chunks_ingested", 0))
    if chunks_ingested > 0:
        keys = [f"{document_id}#chunk-{idx}" for idx in range(chunks_ingested)]
        try:
            await vector_store.delete_chunks(keys)
        except Exception as e:
            logger.exception(
                "Failed to delete vectors for document_id=%s: %s",
                document_id,
                e,
            )

    return {"deleted": True, "document_id": document_id}


@router.post("/rag/search", response_model=RagSearchResponse)
async def search_rag_context(
    payload: RagSearchRequest,
    vector_store=Depends(get_vector_store),
    user_id: str = Depends(get_current_user_id),
) -> RagSearchResponse:
    logger.info("RAG search request top_k=%d user_id=%s", payload.top_k, user_id)
    try:
        results = await vector_store.similarity_search(
            payload.query,
            user_id=user_id,
            top_k=payload.top_k,
            documents=payload.documents,
            tags=payload.tags,
        )
    except Exception as exc:
        logger.exception("RAG search failed")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Search failed: {exc}",
        ) from exc
    return RagSearchResponse(query=payload.query, results=results)


@router.get("/conversations", response_model=list[ConversationResponse])
async def list_conversations(
    repo=Depends(get_repository),
    user_id: str = Depends(get_current_user_id),
) -> list[ConversationResponse]:
    items = await to_thread.run_sync(repo.get_user_conversations, user_id)
    conversations = []
    for item in items:
        name = item.get("name") or "New Chat..."
        conversations.append(
            ConversationResponse(
                id=item.get("conversation_id"),
                name=name,
                created_at=item.get("created_at"),
                updated_at=item.get("updated_at", item.get("created_at")),
                user_id=item.get("user_id"),
            )
        )
    return conversations


@router.get(
    "/conversations/{conversation_id}/messages", response_model=list[MessageResponse]
)
async def get_conversation_messages(
    conversation_id: str,
    repo=Depends(get_repository),
    storage=Depends(get_storage),
    user_id: str = Depends(get_current_user_id),
) -> list[MessageResponse]:
    meta = await to_thread.run_sync(repo.get_conversation_meta, conversation_id)
    if not meta or (meta.get("user_id") and meta.get("user_id") != user_id):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Conversation not found",
        )

    items = await to_thread.run_sync(repo.get_all_messages, conversation_id)
    messages = []
    for item in items:
        attachment_data = item.get("attachment")
        attachment = None
        if attachment_data:
            s3_key = attachment_data.get("s3_key")
            presigned_url = None
            if s3_key:
                presigned_url = storage.generate_presigned_url(s3_key)
            attachment = Attachment(
                s3_key=s3_key,
                mime_type=attachment_data.get("mime_type"),
                size_bytes=attachment_data.get("size_bytes"),
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
                    presigned_url = storage.generate_presigned_url(s3_key)
                attachments.append(
                    Attachment(
                        s3_key=s3_key,
                        mime_type=att.get("mime_type"),
                        size_bytes=att.get("size_bytes"),
                        presigned_url=presigned_url,
                    )
                )

        messages.append(
            MessageResponse(
                id=item.get("message_id") or item.get("sk", "").split("#")[-1],
                role=item.get("role"),
                content=item.get("content"),
                created_at=item.get("created_at"),
                attachment=attachment,
                attachments=attachments,
                citations=item.get("citations"),
            )
        )
    return messages


@router.put("/conversations/{conversation_id}", response_model=ConversationResponse)
async def update_conversation(
    conversation_id: str,
    payload: UpdateConversationRequest,
    repo=Depends(get_repository),
    user_id: str = Depends(get_current_user_id),
) -> ConversationResponse:
    meta = await to_thread.run_sync(repo.get_conversation_meta, conversation_id)
    if not meta or (meta.get("user_id") and meta.get("user_id") != user_id):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Conversation not found",
        )

    updated_at = utcnow_iso()
    await to_thread.run_sync(
        repo.update_conversation,
        conversation_id,
        payload.name,
        updated_at,
    )

    return ConversationResponse(
        id=conversation_id,
        name=payload.name,
        created_at=meta.get("created_at"),
        updated_at=updated_at,
        user_id=meta.get("user_id"),
    )


@router.delete("/conversations/{conversation_id}")
async def delete_conversation(
    conversation_id: str,
    repo=Depends(get_repository),
    user_id: str = Depends(get_current_user_id),
) -> dict:
    meta = await to_thread.run_sync(repo.get_conversation_meta, conversation_id)
    if not meta or (meta.get("user_id") and meta.get("user_id") != user_id):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Conversation not found",
        )

    await to_thread.run_sync(repo.delete_conversation, conversation_id)
    return {"deleted": True, "conversation_id": conversation_id}
