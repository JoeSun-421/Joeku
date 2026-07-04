from __future__ import annotations

import base64

from academic_agent.config import Settings, get_settings
from academic_agent.llm import OpenAICompatibleClient
from starlette.requests import Request

DEEPSEEK_DEFAULTS = {
    "base_url": "https://api.deepseek.com/v1",
    "model": "deepseek-chat",
}


def normalize_base_url(url: str) -> str:
    """Ensure OpenAI-compatible base URL ends with /v1."""
    cleaned = (url or "").strip().rstrip("/")
    if not cleaned:
        return DEEPSEEK_DEFAULTS["base_url"]
    if cleaned.endswith("/v1"):
        return cleaned
    if cleaned.endswith("/chat/completions"):
        return cleaned[: -len("/chat/completions")].rstrip("/")
    return f"{cleaned}/v1"


def decode_header_value(value: str) -> str:
    raw = (value or "").strip()
    if raw.startswith("b64:"):
        return base64.b64decode(raw[4:]).decode("utf-8")
    return raw


def tavily_key_from_request(request: Request) -> str:
    return decode_header_value(request.headers.get("x-tavily-key") or "")


def settings_from_request(request: Request) -> Settings:
    """Use per-request LLM headers only — never fall back to server .env API key."""
    base = get_settings()
    api_key = decode_header_value(request.headers.get("x-api-key") or "")
    base_url = normalize_base_url(
        decode_header_value(request.headers.get("x-base-url") or "") or base.openai_base_url
    )
    model = decode_header_value(request.headers.get("x-model") or "") or base.openai_model
    return base.model_copy(
        update={
            "openai_api_key": api_key,
            "openai_base_url": base_url,
            "openai_model": model,
        }
    )


def client_from_settings(settings: Settings) -> OpenAICompatibleClient:
    normalized = settings.model_copy(update={"openai_base_url": normalize_base_url(settings.openai_base_url)})
    return OpenAICompatibleClient(settings=normalized)


def client_from_request(request: Request) -> OpenAICompatibleClient:
    return client_from_settings(settings_from_request(request))