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
