from __future__ import annotations

import json
from collections.abc import Iterable
from typing import Any

import httpx
from tenacity import retry, stop_after_attempt, wait_exponential

from academic_agent.config import Settings, get_settings
from academic_agent.http_utils import make_http_client


class OpenAICompatibleClient:
    """Small chat-completions client for OpenAI-compatible endpoints."""

    def __init__(self, settings: Settings | None = None) -> None:
        self.settings = settings or get_settings()
        base = self.settings.openai_base_url.rstrip("/")
        if base.endswith("/chat/completions"):
            base = base[: -len("/chat/completions")].rstrip("/")
        if not base.endswith("/v1"):
            base = f"{base}/v1"
        self.base_url = base
        self.model = self.settings.openai_model

    @retry(wait=wait_exponential(multiplier=1, min=1, max=12), stop=stop_after_attempt(3))
    def chat(
        self,
        messages: list[dict[str, str]],
        *,
        temperature: float = 0.2,
        max_tokens: int | None = None,
        response_format: dict[str, Any] | None = None,
    ) -> str:
        if not self.settings.openai_api_key:
            raise RuntimeError("缺少 API Key。请先在页面登录。")

        payload: dict[str, Any] = {
            "model": self.model,
            "messages": messages,
            "temperature": temperature,
        }
        if max_tokens is not None:
            payload["max_tokens"] = max_tokens
        if response_format is not None:
            payload["response_format"] = response_format

        headers = {
            "Authorization": f"Bearer {self.settings.openai_api_key}",
            "Content-Type": "application/json",
        }
        data = self._post_chat(payload, headers)
        content = self._extract_content(data)
        if content:
            return content

        # Reasoning models may exhaust budget — retry with larger max_tokens once.
        if max_tokens is not None:
            payload_retry = {**payload, "max_tokens": min(max_tokens * 3, 16000)}
            data = self._post_chat(payload_retry, headers)
            content = self._extract_content(data)
            if content:
                return content

        raise RuntimeError(
            "模型返回为空。请换用 deepseek-chat，或在设置中改用 deepseek-v4-flash。"
        )

    def _post_chat(self, payload: dict[str, Any], headers: dict[str, str]) -> dict[str, Any]:
        try:
            with make_http_client(timeout=self.settings.openai_timeout_seconds) as client:
                response = client.post(f"{self.base_url}/chat/completions", headers=headers, json=payload)
                try:
                    response.raise_for_status()
                except httpx.HTTPStatusError as exc:
                    detail = exc.response.text[:800] if exc.response is not None else str(exc)
                    code = exc.response.status_code if exc.response is not None else "?"
                    raise RuntimeError(f"模型 API 请求失败 ({code}): {detail}") from exc
                return response.json()
        except httpx.HTTPError as exc:
            raise RuntimeError(f"网络请求失败: {exc}") from exc

    @staticmethod
    def _extract_content(data: dict[str, Any]) -> str:
        try:
            message = data["choices"][0]["message"]
            return (message.get("content") or "").strip()
        except (KeyError, IndexError, TypeError):
            return ""

    def json_chat(self, messages: list[dict[str, str]], *, temperature: float = 0.1) -> dict[str, Any]:
        content = self.chat(
            messages,
            temperature=temperature,
            response_format={"type": "json_object"},
        )
        try:
            return json.loads(content)
        except json.JSONDecodeError:
            start = content.find("{")
            end = content.rfind("}")
            if start >= 0 and end > start:
                return json.loads(content[start : end + 1])
            raise


def compact_sources(papers: Iterable[Any], limit: int = 12, *, numbered: bool = True) -> str:
    lines: list[str] = []
    for index, paper in enumerate(list(papers)[:limit], start=1):
        authors = ", ".join(paper.authors[:4]) if paper.authors else "Unknown authors"
        year = paper.year or "n.d."
        doi = f" DOI: {paper.doi}." if paper.doi else ""
        abstract = f" Abstract: {paper.abstract[:700]}" if paper.abstract else ""
        key = getattr(paper, "citation_key", None) or f"ref{index}"
        prefix = f"[{index}]" if numbered else "-"
        from academic_agent.scholar_quality import paper_link

        plink = paper_link(paper)
        lines.append(
            f"{prefix} key={key} | {paper.title} ({year}). {authors}.{doi}{abstract} Link: {plink}"
        )
    return "\n".join(lines)