from __future__ import annotations

from pathlib import Path
from typing import Iterable

PROMPTS_DIR = Path(__file__).parent.parent / "prompts"


def load_prompt(filename: str) -> str:
    path = PROMPTS_DIR / filename
    try:
        with open(path, "r", encoding="utf-8") as f:
            return f.read()
    except Exception:
        # Fallback values in case the prompt files are not deployed/packaged correctly
        if filename == "general_chat.txt":
            return "You are a helpful assistant. Answer the user's questions clearly and concisely."
        elif filename == "rag_chat.txt":
            return (
                "You are an assistant that answers questions using ONLY the information provided in the context.\n"
                "Answer the question strictly based on the context provided. Do not use your own domain knowledge or make assumptions. "
                "If the context is not sufficient or the answer cannot be found in the context, respond with 'I can not answer the question based on the provided information.' and nothing else.\n"
                "Cite each factual sentence with source markers. Source markers should be in the format [n], where n corresponds "
                "to the number of the source document in the provided list of sources (e.g. [SOURCE 1] corresponds to citation [1]). "
                "If multiple sentences are supported by the same source, cite them with the same source marker. "
                "If one sentence is supported by multiple sources, cite all relevant source markers together, like [1][3].\n"
                "Do not use special brackets such as 【 or 】 for citations. Use only standard square brackets [].\n\n"
                "### Retrieved Context\n{context}"
            )
        elif filename == "reformulate_query.txt":
            return (
                "Given a conversation history and a follow-up query, rephrase the follow-up query to be a standalone, self-contained search query.\n"
                "This standalone query will be used for document retrieval (semantic search).\n\n"
                "Instructions:\n"
                '1. The standalone query must not have any dependencies on past turns, vagueness, or reference keywords (like "this", "that", "previous", "it", "they", "he", "she", etc.).\n'
                "2. Resolve any references or pronouns using the context of the conversation.\n"
                "3. Perform spelling correction and optimize keywords for better search retrieval.\n"
                "4. If there is no conversation history, simply correct any spelling errors and optimize the keywords of the query.\n"
                "5. Do NOT add any preamble, explanation, extra commentary, or quotes. Output ONLY the rephrased standalone query.\n\n"
                "Conversation History:\n{history_text}\n\n"
                "Follow-up Query: {user_message}\n\n"
                "Standalone Query:"
            )
        raise


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
