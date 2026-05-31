from __future__ import annotations

import base64
import logging
from dataclasses import dataclass
from datetime import timedelta
from uuid import uuid4

from anyio import to_thread

from ..models.schemas import ChatRequest
from ..services.llm import LlmClient
from ..services.prompt import (
    build_general_chat_messages,
    build_history_messages,
    build_image_chat_messages,
    build_multimodal_rag_chat_messages,
    build_rag_chat_messages,
    build_reformulate_prompt,
)
from ..services.storage import build_image_key, extension_for_mime
from ..utils.time import to_epoch_seconds, utcnow, utcnow_iso

logger = logging.getLogger(__name__)


@dataclass
class ChatContext:
    conversation_id: str
    user_message_id: str
    history: list[dict]
    messages: list[dict]
    context_results: list[dict]
    llm_client: LlmClient


class ChatService:
    def __init__(
        self,
        repo,
        settings,
        llm_client: LlmClient,
        vision_llm_client: LlmClient,
        vector_store,
        storage,
    ) -> None:
        self.repo = repo
        self.settings = settings
        self.llm_client = llm_client
        self.vision_llm_client = vision_llm_client
        self.vector_store = vector_store
        self.storage = storage

    async def prepare_chat(self, payload: ChatRequest, user_id: str) -> ChatContext:
        conversation_id = payload.conversation_id or str(uuid4())
        logger.info(
            "chat prepare request conversation_id=%s user_id=%s",
            conversation_id,
            user_id,
        )
        created_at = utcnow_iso()

        # Set dynamic conversation name based on first message (up to 30 chars)
        conv_name = payload.message[:30] if payload.message else "New Chat..."
        if payload.message and len(payload.message) > 30:
            conv_name += "..."

        await to_thread.run_sync(
            self.repo.create_conversation,
            conversation_id,
            created_at,
            user_id,
            conv_name,
        )

        user_message_id = str(uuid4())
        attachments_list = await self._upload_payload_images(
            conversation_id, user_message_id, payload.images
        )
        attachment_legacy = attachments_list[0] if attachments_list else None

        await to_thread.run_sync(
            self.repo.put_message,
            conversation_id,
            user_message_id,
            "user",
            payload.message,
            created_at,
            attachment_legacy,
            user_id,
            attachments_list,
        )

        history = await self._load_history(
            conversation_id, self.settings.max_history_messages
        )
        llm = self.llm_client

        if payload.use_rag:
            # RAG Pathway
            history_lines = []
            for msg in history:
                role = msg.get("role", "").capitalize()
                content = msg.get("content", "")
                history_lines.append(f"{role}: {content}")
            history_text = "\n".join(history_lines) if history_lines else "None"

            reformulate_prompt = build_reformulate_prompt(history_text, payload.message)
            try:
                standalone_query = await self.llm_client.generate(
                    [{"role": "user", "content": reformulate_prompt}]
                )
                standalone_query = standalone_query.strip().strip('"').strip("'")
                logger.info(
                    "Generated standalone query: '%s' from original: '%s'",
                    standalone_query,
                    payload.message,
                )
            except Exception as e:
                logger.warning(
                    "Failed to generate standalone query: %s. Falling back to original query.",
                    e,
                )
                standalone_query = payload.message

            context_results = await self.vector_store.similarity_search(
                standalone_query,
                user_id=user_id,
                top_k=self.settings.rag_top_k,
                documents=payload.rag_documents,
                tags=payload.rag_tags,
            )

            # Format the context
            context = ""
            if context_results:
                for idx, item in enumerate(context_results, start=1):
                    context += f"[SOURCE {idx} STARTS]\n"
                    context += f"File: {item['source']}\n"
                    if item.get("page"):
                        context += f"Page: {item['page']}\n"
                    context += f"Content: {item['text']}\n"
                    context += f"[/SOURCE {idx} ENDS]\n\n"
            else:
                logger.info("RAG requested but no context was retrieved")
                context = "No relevant context found."

            # Check for image chunks
            image_chunks = [item for item in context_results if item.get("is_image")]
            if image_chunks or payload.images:
                llm = self.vision_llm_client
                image_data_urls = list(payload.images) if payload.images else []
                for chunk in image_chunks:
                    try:
                        img_bytes = await to_thread.run_sync(
                            self.storage.download_bytes, chunk["image_s3_key"]
                        )
                        mime_type = chunk.get("mime_type", "image/png")
                        encoded = base64.b64encode(img_bytes).decode("ascii")
                        image_data_urls.append(f"data:{mime_type};base64,{encoded}")
                    except Exception as e:
                        logger.warning(
                            "Failed to download image for chunk %s: %s",
                            chunk.get("key"),
                            e,
                        )
                messages = build_multimodal_rag_chat_messages(
                    payload.message, history, context, image_data_urls
                )
            else:
                messages = build_rag_chat_messages(payload.message, history, context)
        else:
            # General Chat Pathway
            context_results = []
            if payload.images:
                llm = self.vision_llm_client
                messages = build_image_chat_messages(
                    payload.message, payload.images, history
                )
            else:
                messages = build_general_chat_messages(payload.message, history)

        return ChatContext(
            conversation_id=conversation_id,
            user_message_id=user_message_id,
            history=history,
            messages=messages,
            context_results=context_results,
            llm_client=llm,
        )

    async def finalize_chat(
        self,
        conversation_id: str,
        history: list[dict],
        user_message: str,
        assistant_text: str,
        use_rag: bool,
        context_results: list[dict],
        assistant_message_id: str | None = None,
    ) -> tuple[str, str, list[dict]]:
        from ..services.citation import process_citations

        if use_rag and context_results:
            processed_text, cited_sources = process_citations(
                assistant_text, context_results
            )
        else:
            processed_text = assistant_text
            cited_sources = []

        if not assistant_message_id:
            assistant_message_id = str(uuid4())
        assistant_created_at = utcnow_iso()

        await to_thread.run_sync(
            self.repo.put_message,
            conversation_id,
            assistant_message_id,
            "assistant",
            processed_text,
            assistant_created_at,
            None,
            None,
            None,
            cited_sources,
        )

        await self._update_context(
            conversation_id,
            self.settings.max_history_messages,
            self.settings.context_ttl_seconds,
            history,
            user_message,
            processed_text,
        )

        return processed_text, assistant_message_id, cited_sources

    async def _load_history(
        self, conversation_id: str, max_messages: int
    ) -> list[dict]:
        context_item = await to_thread.run_sync(self.repo.get_context, conversation_id)
        if context_item and context_item.get("messages"):
            return context_item["messages"]
        items = await to_thread.run_sync(
            self.repo.get_recent_messages, conversation_id, max_messages
        )
        return build_history_messages(items)

    async def _update_context(
        self,
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
            self.repo.set_context, conversation_id, trimmed, ttl_epoch, utcnow_iso()
        )

    async def _upload_payload_images(
        self,
        conversation_id: str,
        user_message_id: str,
        images: list[str] | None,
    ) -> list[dict]:
        if not images:
            return []
        attachments_list = []
        for idx, data_url in enumerate(images):
            try:
                header, base64_data = data_url.split(",", 1)
                mime_type = header.split(";")[0].split(":")[1]
                extension = extension_for_mime(mime_type)
                suffix = f"_{idx}" if len(images) > 1 else ""
                s3_key = build_image_key(
                    conversation_id, f"{user_message_id}{suffix}", extension
                )
                img_b64_str = base64_data
                rem = len(img_b64_str) % 4
                if rem > 0:
                    img_b64_str += "=" * (4 - rem)
                img_bytes = base64.b64decode(img_b64_str)
                await to_thread.run_sync(
                    self.storage.upload_image,
                    s3_key,
                    img_bytes,
                    mime_type,
                )
                attachments_list.append(
                    {
                        "s3_key": s3_key,
                        "mime_type": mime_type,
                        "size_bytes": len(img_bytes),
                    }
                )
            except Exception as e:
                logger.warning("Failed to process image payload %d: %s", idx, e)
        return attachments_list
