from __future__ import annotations

import json
import asyncio
import queue
import threading
from collections.abc import AsyncGenerator, Generator, Iterable
from typing import Any

import httpx
from tenacity import retry, stop_after_attempt, wait_exponential

from academic_agent.config import Settings, get_settings
from academic_agent.http_utils import make_async_http_client, make_http_client


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

    @staticmethod
    def _is_reasoning_model(model: str) -> bool:
        m = (model or "").lower()
        return "reasoner" in m or "r1" in m or "thinking" in m

    @staticmethod
    def supports_native_thinking(model: str) -> bool:
        m = (model or "").lower()
        return any(tag in m for tag in ("v4", "reasoner", "r1", "thinking"))

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
        if response_format is not None and not self._is_reasoning_model(self.model):
            payload["response_format"] = response_format

        headers = {
            "Authorization": f"Bearer {self.settings.openai_api_key}",
            "Content-Type": "application/json",
        }
        data = self._post_chat(payload, headers)
        content = self._extract_content(data)
        if content:
            return content

        finish = self._finish_reason(data)
        bumped = min(max((max_tokens or 1024) * 4, 4096), 32000) if max_tokens is not None else 8192

        if max_tokens is not None and bumped > max_tokens:
            retry_payload = {**payload, "max_tokens": bumped}
            if response_format and self._is_reasoning_model(self.model):
                retry_payload.pop("response_format", None)
            data = self._post_chat(retry_payload, headers)
            content = self._extract_content(data)
            if content:
                return content

        if response_format is not None:
            plain = {k: v for k, v in payload.items() if k != "response_format"}
            plain["max_tokens"] = bumped
            data = self._post_chat(plain, headers)
            content = self._extract_content(data)
            if content:
                return content

        hint = "deepseek-chat" if self._is_reasoning_model(self.model) else self.model
        detail = f"（finish_reason={finish}）" if finish else ""
        raise RuntimeError(
            f"模型返回为空{detail}。当前模型：{self.model}。"
            f"建议换用 deepseek-chat 或 deepseek-v4-flash；若使用 reasoner/pro 模型，请确保 max_tokens 充足。"
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
            msg = str(exc)
            hint = ""
            if "ConnectError" in msg or "Connection" in msg:
                hint = "（请检查 Base URL 是否正确、对应服务是否已启动；如果是云端 Joeku 则无法连接你本地的 Ollama 等）"
            elif "timeout" in msg.lower():
                hint = "（连接超时，请检查网络或增加超时时间）"
            raise RuntimeError(f"网络请求失败: {exc}{hint}") from exc

    def _stream_payload(
        self,
        messages: list[dict[str, str]],
        *,
        temperature: float,
        max_tokens: int | None,
        enable_thinking: bool,
    ) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "model": self.model,
            "messages": messages,
            "temperature": temperature,
            "stream": True,
        }
        if max_tokens is not None:
            payload["max_tokens"] = max_tokens
        if enable_thinking and self.supports_native_thinking(self.model):
            payload["extra_body"] = {"thinking": {"type": "enabled"}}
            if "v4" in (self.model or "").lower():
                payload["reasoning_effort"] = "high"
        return payload

    def chat_stream(
        self,
        messages: list[dict[str, str]],
        *,
        temperature: float = 0.2,
        max_tokens: int | None = None,
        include_reasoning: bool = False,
        enable_thinking: bool = False,
    ) -> Generator[str, None, None]:
        if not self.settings.openai_api_key:
            raise RuntimeError("缺少 API Key。请先在页面登录。")

        headers = {
            "Authorization": f"Bearer {self.settings.openai_api_key}",
            "Content-Type": "application/json",
        }
        payload = self._stream_payload(
            messages,
            temperature=temperature,
            max_tokens=max_tokens,
            enable_thinking=enable_thinking,
        )
        try:
            for text in self._iter_stream_text(
                headers,
                payload,
                include_reasoning=include_reasoning or enable_thinking,
            ):
                yield text
        except httpx.HTTPError as exc:
            msg = str(exc)
            hint = ""
            if "ConnectError" in msg or "Connection" in msg:
                hint = "（请检查 Base URL 是否正确、对应服务是否已启动；如果是云端 Joeku 则无法连接你本地的 Ollama 等）"
            elif "timeout" in msg.lower():
                hint = "（连接超时，请检查网络或增加超时时间）"
            raise RuntimeError(f"网络请求失败: {exc}{hint}") from exc

    def chat_stream_dual(
        self,
        messages: list[dict[str, str]],
        *,
        temperature: float = 0.2,
        max_tokens: int | None = None,
        enable_thinking: bool = False,
    ) -> Generator[tuple[str, str], None, None]:
        """Yield ('reasoning', text) or ('content', text) — DeepSeek thinking-mode shape."""
        if not self.settings.openai_api_key:
            raise RuntimeError("缺少 API Key。请先在页面登录。")

        headers = {
            "Authorization": f"Bearer {self.settings.openai_api_key}",
            "Content-Type": "application/json",
        }
        payload = self._stream_payload(
            messages,
            temperature=temperature,
            max_tokens=max_tokens,
            enable_thinking=enable_thinking,
        )
        try:
            with make_http_client(timeout=self.settings.openai_timeout_seconds) as client:
                with client.stream(
                    "POST",
                    f"{self.base_url}/chat/completions",
                    headers=headers,
                    json=payload,
                ) as response:
                    try:
                        response.raise_for_status()
                    except httpx.HTTPStatusError as exc:
                        detail = exc.response.text[:800] if exc.response is not None else str(exc)
                        code = exc.response.status_code if exc.response is not None else "?"
                        raise RuntimeError(f"模型 API 请求失败 ({code}): {detail}") from exc
                    for line in response.iter_lines():
                        reasoning, content = self._parse_stream_delta(line)
                        if reasoning:
                            yield ("reasoning", reasoning)
                        if content:
                            yield ("content", content)
        except httpx.HTTPError as exc:
            msg = str(exc)
            hint = ""
            if "ConnectError" in msg or "Connection" in msg:
                hint = "（请检查 Base URL 是否正确、对应服务是否已启动；如果是云端 Joeku 则无法连接你本地的 Ollama 等）"
            elif "timeout" in msg.lower():
                hint = "（连接超时，请检查网络或增加超时时间）"
            raise RuntimeError(f"网络请求失败: {exc}{hint}") from exc

    def _parse_stream_delta(self, line: str) -> tuple[str, str]:
        if not line or not line.startswith("data:"):
            return "", ""
        data = line[5:].strip()
        if data == "[DONE]":
            return "", ""
        try:
            chunk = json.loads(data)
            choice = chunk["choices"][0]
            delta = choice.get("delta") or {}
            reasoning = (
                delta.get("reasoning_content")
                or delta.get("reasoning")
                or ""
            ).replace("\u0000", "")
            content = (delta.get("content") or "").replace("\u0000", "")
            if not reasoning and not content:
                content = (choice.get("text") or "").replace("\u0000", "")
        except (KeyError, IndexError, json.JSONDecodeError, TypeError):
            return "", ""
        return reasoning, content

    def _parse_stream_line(self, line: str, *, include_reasoning: bool) -> str:
        reasoning, content = self._parse_stream_delta(line)
        if content:
            return content
        if include_reasoning and reasoning:
            return reasoning
        return ""

    def _iter_stream_text(
        self,
        headers: dict[str, str],
        payload: dict[str, Any],
        *,
        include_reasoning: bool,
    ) -> Generator[str, None, None]:
        with make_http_client(timeout=self.settings.openai_timeout_seconds) as client:
            with client.stream(
                "POST",
                f"{self.base_url}/chat/completions",
                headers=headers,
                json=payload,
            ) as response:
                try:
                    response.raise_for_status()
                except httpx.HTTPStatusError as exc:
                    detail = exc.response.text[:800] if exc.response is not None else str(exc)
                    code = exc.response.status_code if exc.response is not None else "?"
                    raise RuntimeError(f"模型 API 请求失败 ({code}): {detail}") from exc
                for line in response.iter_lines():
                    text = self._parse_stream_line(line, include_reasoning=include_reasoning)
                    if text:
                        yield text

    async def async_chat_stream(
        self,
        messages: list[dict[str, str]],
        *,
        temperature: float = 0.2,
        max_tokens: int | None = None,
        include_reasoning: bool = False,
    ) -> AsyncGenerator[str, None]:
        if not self.settings.openai_api_key:
            raise RuntimeError("缺少 API Key。请先在页面登录。")

        payload: dict[str, Any] = {
            "model": self.model,
            "messages": messages,
            "temperature": temperature,
            "stream": True,
        }
        if max_tokens is not None:
            payload["max_tokens"] = max_tokens

        headers = {
            "Authorization": f"Bearer {self.settings.openai_api_key}",
            "Content-Type": "application/json",
        }
        try:
            async with make_async_http_client(timeout=self.settings.openai_timeout_seconds) as client:
                async with client.stream(
                    "POST",
                    f"{self.base_url}/chat/completions",
                    headers=headers,
                    json=payload,
                ) as response:
                    try:
                        response.raise_for_status()
                    except httpx.HTTPStatusError as exc:
                        detail = exc.response.text[:800] if exc.response is not None else str(exc)
                        code = exc.response.status_code if exc.response is not None else "?"
                        raise RuntimeError(f"模型 API 请求失败 ({code}): {detail}") from exc
                    async for line in response.aiter_lines():
                        text = self._parse_stream_line(line, include_reasoning=include_reasoning)
                        if text:
                            yield text
        except httpx.HTTPError as exc:
            msg = str(exc)
            hint = ""
            if "ConnectError" in msg or "Connection" in msg:
                hint = "（请检查 Base URL 是否正确、对应服务是否已启动；如果是云端 Joeku 则无法连接你本地的 Ollama 等）"
            elif "timeout" in msg.lower():
                hint = "（连接超时，请检查网络或增加超时时间）"
            raise RuntimeError(f"网络请求失败: {exc}{hint}") from exc

    async def iter_chat_stream_threaded(
        self,
        messages: list[dict[str, str]],
        *,
        temperature: float = 0.2,
        max_tokens: int | None = None,
        include_reasoning: bool = False,
        enable_thinking: bool = False,
    ) -> AsyncGenerator[str, None]:
        """Bridge sync chat_stream to async consumers without blocking the event loop."""
        token_q: queue.Queue[object] = queue.Queue()

        def _worker() -> None:
            try:
                for token in self.chat_stream(
                    messages,
                    temperature=temperature,
                    max_tokens=max_tokens,
                    include_reasoning=include_reasoning,
                    enable_thinking=enable_thinking,
                ):
                    if token:
                        token_q.put(token)
            except Exception as exc:
                token_q.put(exc)
            finally:
                token_q.put(None)

        threading.Thread(target=_worker, daemon=True).start()
        while True:
            item = await asyncio.to_thread(token_q.get)
            if item is None:
                return
            if isinstance(item, Exception):
                raise item
            yield str(item)

    async def iter_chat_stream_dual_threaded(
        self,
        messages: list[dict[str, str]],
        *,
        temperature: float = 0.2,
        max_tokens: int | None = None,
        enable_thinking: bool = False,
    ) -> AsyncGenerator[tuple[str, str], None]:
        """Bridge sync chat_stream_dual to async SSE handlers."""
        token_q: queue.Queue[object] = queue.Queue()

        def _worker() -> None:
            try:
                for kind, token in self.chat_stream_dual(
                    messages,
                    temperature=temperature,
                    max_tokens=max_tokens,
                    enable_thinking=enable_thinking,
                ):
                    if token:
                        token_q.put((kind, token))
            except Exception as exc:
                token_q.put(exc)
            finally:
                token_q.put(None)

        threading.Thread(target=_worker, daemon=True).start()
        while True:
            item = await asyncio.to_thread(token_q.get)
            if item is None:
                return
            if isinstance(item, Exception):
                raise item
            yield item

    @staticmethod
    def _finish_reason(data: dict[str, Any]) -> str:
        try:
            return str(data["choices"][0].get("finish_reason") or "")
        except (KeyError, IndexError, TypeError):
            return ""

    @staticmethod
    def _extract_content(data: dict[str, Any]) -> str:
        try:
            message = data["choices"][0]["message"]
            content = (message.get("content") or "").strip()
            if content:
                return content
        except (KeyError, IndexError, TypeError):
            return ""
        return ""

    def json_chat(self, messages: list[dict[str, str]], *, temperature: float = 0.1) -> dict[str, Any]:
        try:
            content = self.chat(
                messages,
                temperature=temperature,
                response_format={"type": "json_object"},
            )
        except RuntimeError:
            content = self.chat(messages, temperature=temperature, max_tokens=4096)
        try:
            return json.loads(content)
        except json.JSONDecodeError:
            start = content.find("{")
            end = content.rfind("}")
            if start >= 0 and end > start:
                return json.loads(content[start : end + 1])
            raise


def compact_sources(
    papers: Iterable[Any],
    limit: int = 12,
    *,
    numbered: bool = True,
    citation_format: str = "apa7",
) -> str:
    from academic_agent.citation_formats import in_text_hint, _canonical_url

    lines: list[str] = []
    for index, paper in enumerate(list(papers)[:limit], start=1):
        authors = ", ".join(paper.authors[:4]) if paper.authors else "Unknown authors"
        year = paper.year or "n.d."
        doi = f" DOI: {paper.doi}." if paper.doi else ""
        abstract = f" Abstract: {paper.abstract[:500]}" if paper.abstract else ""
        key = getattr(paper, "citation_key", None) or f"ref{index}"
        prefix = f"[{index}]" if numbered else "-"
        cite = in_text_hint(paper, citation_format, index)
        url = _canonical_url(paper)
        lines.append(
            f"{prefix} In-text: {cite} | key={key} | Authors: {authors} | Year: {year} | "
            f"Title: {paper.title} | URL: {url}{doi}{abstract}"
        )
    return "\n".join(lines)