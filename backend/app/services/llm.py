from __future__ import annotations

import logging

from litellm import acompletion

logger = logging.getLogger(__name__)


class LlmClient:
    def __init__(
        self, model: str, api_key: str | None = None, base_url: str | None = None
    ):
        self._model = model
        self._api_key = api_key
        self._base_url = base_url
        logger.info("LlmClient initialised model=%s base_url=%s", model, base_url)

    async def generate(self, messages: list[dict]) -> str:
        logger.info("LLM request model=%s message_count=%d", self._model, len(messages))
        try:
            response = await acompletion(
                model=self._model,
                messages=messages,
                api_key=self._api_key,
                base_url=self._base_url,
            )
        except Exception:
            logger.exception("LLM call failed model=%s", self._model)
            raise

        message = response.choices[0].message
        if isinstance(message, dict):
            content = message.get("content")
        else:
            content = message.content
        if not content:
            logger.error("LLM returned empty content model=%s", self._model)
            raise RuntimeError("LLM returned empty response")

        logger.info(
            "LLM response received model=%s content_length=%d",
            self._model,
            len(content),
        )
        return content

    async def astream(self, messages: list[dict]):
        logger.info(
            "LLM stream request model=%s message_count=%d", self._model, len(messages)
        )
        try:
            response = await acompletion(
                model=self._model,
                messages=messages,
                api_key=self._api_key,
                base_url=self._base_url,
                stream=True,
            )
            async for chunk in response:
                yield chunk
        except Exception:
            logger.exception("LLM stream call failed model=%s", self._model)
            raise
