from __future__ import annotations

import base64
import json
import logging
from dataclasses import asdict
from datetime import timedelta
from uuid import uuid4

from anyio import to_thread
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from fastapi.responses import StreamingResponse

from ..dependencies import (
    get_current_user_id,
    get_llm_client,
    get_rag_service,
    get_repository,
    get_settings,
    get_storage,
    get_vector_store,
    get_vision_llm_client,
)
from ..models.schemas import (
    Attachment,
    ChatImageResponse,
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
from ..services.prompt import build_history_messages, build_user_content
from ..services.storage import build_image_key, extension_for_mime
from ..utils.time import to_epoch_seconds, utcnow, utcnow_iso

logger = logging.getLogger(__name__)

router = APIRouter()


async def _load_history(repo, conversation_id: str, max_messages: int) -> list[dict]:
    context_item = await to_thread.run_sync(repo.get_context, conversation_id)
    if context_item and context_item.get("messages"):
        return context_item["messages"]
    items = await to_thread.run_sync(
        repo.get_recent_messages, conversation_id, max_messages
    )
    return build_history_messages(items)


async def _update_context(
    repo,
    conversation_id: str,
    max_messages: int,
    ttl_seconds: int,
    history: list[dict],
    user_text: str,
    assistant_text: str,
) -> None:
    messages = build_history_messages(history)
    messages.extend(
        [
            {"role": "user", "content": user_text},
            {"role": "assistant", "content": assistant_text},
        ]
    )
    trimmed = messages[-max_messages:]
    ttl_epoch = to_epoch_seconds(utcnow() + timedelta(seconds=ttl_seconds))
    await to_thread.run_sync(
        repo.set_context, conversation_id, trimmed, ttl_epoch, utcnow_iso()
    )


async def _build_chat_messages(
    payload: ChatRequest,
    history: list[dict],
    vector_store,
    top_k: int,
    user_id: str,
) -> list[dict]:
    messages = build_history_messages(history)
    if not payload.use_rag:
        messages.append({"role": "user", "content": payload.message})
        return messages

    context_results = await vector_store.similarity_search(
        payload.message,
        user_id=user_id,
        top_k=top_k,
        documents=payload.rag_documents,
    )
    if not context_results:
        logger.info("RAG requested but no context was retrieved")
        messages.append({"role": "user", "content": payload.message})
        return messages

    context = "\n\n".join(
        f"[Source: {item['source']} | Score: {item['score']}]\n{item['text']}"
        for item in context_results
        if item.get("text")
    )
    system_prompt = (
        "You are an expert AI assistant. Answer the user's question using only "
        "the retrieved context below. If the answer is not contained in the "
        "context, state that you do not know based on the available documents.\n\n"
        f"### Retrieved Context\n{context}"
    )
    return [
        {"role": "system", "content": system_prompt},
        *messages,
        {"role": "user", "content": payload.message},
    ]


@router.post("/chat", response_model=ChatResponse)
async def chat(
    payload: ChatRequest,
    repo=Depends(get_repository),
    settings=Depends(get_settings),
    llm=Depends(get_llm_client),
    vector_store=Depends(get_vector_store),
    user_id: str = Depends(get_current_user_id),
) -> ChatResponse:
    try:
        conversation_id = payload.conversation_id or str(uuid4())
        logger.info(
            "chat request conversation_id=%s user_id=%s", conversation_id, user_id
        )
        created_at = utcnow_iso()
        # Set dynamic conversation name based on first message (up to 30 chars)
        conv_name = payload.message[:30] if payload.message else "New Chat..."
        if payload.message and len(payload.message) > 30:
            conv_name += "..."

        await to_thread.run_sync(
            repo.create_conversation,
            conversation_id,
            created_at,
            user_id,
            conv_name,
        )

        user_message_id = str(uuid4())
        await to_thread.run_sync(
            repo.put_message,
            conversation_id,
            user_message_id,
            "user",
            payload.message,
            created_at,
            None,
            user_id,
        )

        history = await _load_history(
            repo, conversation_id, settings.max_history_messages
        )
        messages = await _build_chat_messages(
            payload=payload,
            history=history,
            vector_store=vector_store,
            top_k=settings.rag_top_k,
            user_id=user_id,
        )

        assistant_text = await llm.generate(messages)
        if not assistant_text:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="LLM returned empty response",
            )

        assistant_message_id = str(uuid4())
        assistant_created_at = utcnow_iso()
        await to_thread.run_sync(
            repo.put_message,
            conversation_id,
            assistant_message_id,
            "assistant",
            assistant_text,
            assistant_created_at,
            None,
            None,
        )

        await _update_context(
            repo,
            conversation_id,
            settings.max_history_messages,
            settings.context_ttl_seconds,
            history,
            payload.message,
            assistant_text,
        )

        logger.info(
            "chat complete conversation_id=%s user_message_id=%s assistant_message_id=%s",
            conversation_id,
            user_message_id,
            assistant_message_id,
        )
        return ChatResponse(
            conversation_id=conversation_id,
            user_message_id=user_message_id,
            assistant_message_id=assistant_message_id,
            assistant_message=assistant_text,
            created_at=assistant_created_at,
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
    repo=Depends(get_repository),
    settings=Depends(get_settings),
    llm=Depends(get_llm_client),
    vector_store=Depends(get_vector_store),
    user_id: str = Depends(get_current_user_id),
) -> StreamingResponse:
    try:
        conversation_id = payload.conversation_id or str(uuid4())
        logger.info(
            "chat_stream request conversation_id=%s user_id=%s",
            conversation_id,
            user_id,
        )
        created_at = utcnow_iso()
        # Set dynamic conversation name based on first message (up to 30 chars)
        conv_name = payload.message[:30] if payload.message else "New Chat..."
        if payload.message and len(payload.message) > 30:
            conv_name += "..."

        await to_thread.run_sync(
            repo.create_conversation,
            conversation_id,
            created_at,
            user_id,
            conv_name,
        )

        user_message_id = str(uuid4())
        await to_thread.run_sync(
            repo.put_message,
            conversation_id,
            user_message_id,
            "user",
            payload.message,
            created_at,
            None,
            user_id,
        )

        history = await _load_history(
            repo, conversation_id, settings.max_history_messages
        )
        messages = await _build_chat_messages(
            payload=payload,
            history=history,
            vector_store=vector_store,
            top_k=settings.rag_top_k,
            user_id=user_id,
        )

        async def token_generator():
            accumulated_text = ""
            assistant_message_id = str(uuid4())
            try:
                # Call streaming method of LiteLLM/OpenAI client
                async for chunk in llm.astream(messages):
                    token = chunk.choices[0].delta.content or ""
                    if token:
                        accumulated_text += token
                        # Yield compliant SSE event chunk
                        yield f"data: {json.dumps({'text': token, 'conversation_id': conversation_id, 'assistant_message_id': assistant_message_id, 'user_message_id': user_message_id})}\n\n"

                # Stream succeeded, now save complete assistant response in DB
                assistant_created_at = utcnow_iso()
                await to_thread.run_sync(
                    repo.put_message,
                    conversation_id,
                    assistant_message_id,
                    "assistant",
                    accumulated_text,
                    assistant_created_at,
                    None,
                    None,
                )

                # Update context cache
                await _update_context(
                    repo,
                    conversation_id,
                    settings.max_history_messages,
                    settings.context_ttl_seconds,
                    history,
                    payload.message,
                    accumulated_text,
                )

                # Send close token
                yield "data: [DONE]\n\n"

            except Exception as e:
                logger.exception(
                    "Error in LLM stream generator for conversation_id=%s",
                    conversation_id,
                )
                yield f"data: {json.dumps({'error': 'Stream generation interrupted', 'details': str(e)})}\n\n"

        return StreamingResponse(token_generator(), media_type="text/event-stream")

    except Exception as e:
        logger.exception("chat_stream initialization failed")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(e),
        )


@router.post("/chat/image", response_model=ChatImageResponse)
async def chat_image(
    file: UploadFile = File(...),
    message: str | None = Form(None),
    conversation_id: str | None = Form(None),
    repo=Depends(get_repository),
    settings=Depends(get_settings),
    storage=Depends(get_storage),
    llm=Depends(get_vision_llm_client),
    user_id: str = Depends(get_current_user_id),
) -> ChatImageResponse:
    try:
        if file.content_type not in settings.allowed_image_mime_types:
            logger.warning(
                "chat_image rejected unsupported mime_type=%s", file.content_type
            )
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Unsupported image type",
            )
        data = await file.read()
        if not data:
            logger.warning("chat_image received empty upload")
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Empty upload",
            )
        if len(data) > settings.max_image_bytes:
            logger.warning(
                "chat_image image too large size=%d max=%d",
                len(data),
                settings.max_image_bytes,
            )
            raise HTTPException(
                status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                detail="Image exceeds max size",
            )

        resolved_conversation_id = conversation_id or str(uuid4())
        logger.info(
            "chat_image request conversation_id=%s user_id=%s mime_type=%s size=%d",
            resolved_conversation_id,
            user_id,
            file.content_type,
            len(data),
        )
        created_at = utcnow_iso()
        # Set dynamic conversation name based on first message (up to 30 chars) or default
        conv_name = message[:30] if message else "Image Chat"
        if message and len(message) > 30:
            conv_name += "..."

        await to_thread.run_sync(
            repo.create_conversation,
            resolved_conversation_id,
            created_at,
            user_id,
            conv_name,
        )

        user_message_id = str(uuid4())
        extension = extension_for_mime(file.content_type)
        s3_key = build_image_key(resolved_conversation_id, user_message_id, extension)
        upload_result = await to_thread.run_sync(
            storage.upload_image,
            s3_key,
            data,
            file.content_type,
        )

        await to_thread.run_sync(
            repo.put_message,
            resolved_conversation_id,
            user_message_id,
            "user",
            message or "",
            created_at,
            asdict(upload_result),
            user_id,
        )

        history = await _load_history(
            repo, resolved_conversation_id, settings.max_history_messages
        )
        data_url = (
            f"data:{file.content_type};base64,{base64.b64encode(data).decode('ascii')}"
        )
        messages = build_history_messages(history)
        user_content = build_user_content(message, data_url)
        messages.append({"role": "user", "content": user_content})

        assistant_text = await llm.generate(messages)
        if not assistant_text:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="LLM returned empty response",
            )

        assistant_message_id = str(uuid4())
        assistant_created_at = utcnow_iso()
        await to_thread.run_sync(
            repo.put_message,
            resolved_conversation_id,
            assistant_message_id,
            "assistant",
            assistant_text,
            assistant_created_at,
            None,
            None,
        )

        context_text = message or "[image]"
        await _update_context(
            repo,
            resolved_conversation_id,
            settings.max_history_messages,
            settings.context_ttl_seconds,
            history,
            context_text,
            assistant_text,
        )

        presigned_url = storage.generate_presigned_url(s3_key)
        attachment_dict = asdict(upload_result)
        attachment_dict["presigned_url"] = presigned_url

        logger.info(
            "chat_image complete conversation_id=%s user_message_id=%s assistant_message_id=%s s3_key=%s",
            resolved_conversation_id,
            user_message_id,
            assistant_message_id,
            s3_key,
        )
        return ChatImageResponse(
            conversation_id=resolved_conversation_id,
            user_message_id=user_message_id,
            assistant_message_id=assistant_message_id,
            assistant_message=assistant_text,
            created_at=assistant_created_at,
            attachment=Attachment(**attachment_dict),
        )
    except Exception as e:
        error_msg = str(e)
        if isinstance(e, HTTPException):
            error_msg = e.detail
            logger.warning(
                "chat_image HTTP error conversation_id=%s status=%d detail=%s",
                conversation_id or "unknown",
                e.status_code,
                e.detail,
            )
        else:
            logger.exception(
                "chat_image unexpected error conversation_id=%s",
                conversation_id or "unknown",
            )
        return ChatImageResponse(
            conversation_id=conversation_id or "unknown",
            error=error_msg,
        )


@router.post(
    "/rag/ingest",
    response_model=RagIngestResponse,
    status_code=status.HTTP_201_CREATED,
)
async def ingest_rag_text(
    payload: RagIngestRequest,
    repo=Depends(get_repository),
    rag_service=Depends(get_rag_service),
    user_id: str = Depends(get_current_user_id),
) -> RagIngestResponse:
    logger.info("RAG ingest request filename=%s user_id=%s", payload.filename, user_id)
    try:
        result = await rag_service.ingest_document(
            payload.filename, payload.content, user_id
        )
    except Exception as exc:
        logger.exception("RAG ingestion failed filename=%s", payload.filename)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Ingestion failed: {exc}",
        ) from exc

    created_at = utcnow_iso()
    await to_thread.run_sync(
        repo.put_rag_document,
        user_id,
        result.document_id,
        payload.filename,
        result.chunks_ingested,
        created_at,
    )

    return RagIngestResponse(
        status="success",
        filename=payload.filename,
        document_id=result.document_id,
        chunks_ingested=result.chunks_ingested,
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
        )
        for item in items
    ]


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
        messages.append(
            MessageResponse(
                id=item.get("message_id") or item.get("sk", "").split("#")[-1],
                role=item.get("role"),
                content=item.get("content"),
                created_at=item.get("created_at"),
                attachment=attachment,
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
