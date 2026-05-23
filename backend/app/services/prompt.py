from __future__ import annotations

from typing import Iterable


def build_history_messages(history: Iterable[dict]) -> list[dict]:
    messages: list[dict] = []
    for item in history:
        role = item.get("role")
        content = item.get("content")
        if role and content is not None:
            messages.append({"role": role, "content": content})
    return messages


def build_user_content(text: str | None, image_data_url: str | None) -> str | list[dict]:
    if image_data_url:
        parts: list[dict] = []
        if text:
            parts.append({"type": "text", "text": text})
        parts.append({"type": "image_url", "image_url": {"url": image_data_url}})
        return parts
    return text or ""
