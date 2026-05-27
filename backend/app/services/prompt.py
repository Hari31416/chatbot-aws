from __future__ import annotations

from pathlib import Path
from typing import Iterable

PROMPTS_DIR = Path(__file__).parent.parent / "prompts"


def load_prompt(filename: str) -> str:
    path = PROMPTS_DIR / filename
    with open(path, "r", encoding="utf-8") as f:
        return f.read()


def build_history_messages(history: Iterable[dict]) -> list[dict]:
    messages: list[dict] = []
    for item in history:
        role = item.get("role")
        content = item.get("content")
        if role and content is not None:
            messages.append({"role": role, "content": content})
    return messages


def build_user_content(
    text: str | None,
    image_data_url: str | None = None,
    image_data_urls: list[str] | None = None,
) -> str | list[dict]:
    urls = []
    if image_data_urls:
        urls.extend(image_data_urls)
    elif image_data_url:
        urls.append(image_data_url)

    if urls:
        parts: list[dict] = []
        if text:
            parts.append({"type": "text", "text": text})
        for url in urls:
            parts.append({"type": "image_url", "image_url": {"url": url}})
        return parts
    return text or ""


def build_general_chat_messages(
    payload_message: str, history: Iterable[dict]
) -> list[dict]:
    system_prompt = load_prompt("general_chat.txt")
    messages = [{"role": "system", "content": system_prompt}]
    messages.extend(build_history_messages(history))
    messages.append({"role": "user", "content": payload_message})
    return messages


def build_reformulate_prompt(history_text: str, user_message: str) -> str:
    template = load_prompt("reformulate_query.txt")
    return template.format(history_text=history_text, user_message=user_message)


def build_rag_chat_messages(
    payload_message: str, history: Iterable[dict], context: str
) -> list[dict]:
    template = load_prompt("rag_chat.txt")
    system_prompt = template.format(context=context)
    messages = [{"role": "system", "content": system_prompt}]
    messages.extend(build_history_messages(history))
    messages.append({"role": "user", "content": payload_message})
    return messages


def build_image_chat_messages(
    message: str | None,
    image_data_urls: list[str],
    history: Iterable[dict],
) -> list[dict]:
    # Image chat is a VLLM call. It uses the general chat prompt or no system prompt.
    # Let's align with the existing pattern: VLLM didn't have system prompt, but let's load
    # the general chat prompt as a system prompt to be consistent with separate system prompts.
    system_prompt = load_prompt("general_chat.txt")
    messages = [{"role": "system", "content": system_prompt}]
    messages.extend(build_history_messages(history))
    user_content = build_user_content(message, image_data_urls=image_data_urls)
    messages.append({"role": "user", "content": user_content})
    return messages
