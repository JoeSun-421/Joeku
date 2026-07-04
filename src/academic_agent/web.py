from __future__ import annotations

import asyncio
import queue
import re
import threading
from datetime import datetime
from pathlib import Path

from importlib.resources import files

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, JSONResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from starlette.requests import Request

from academic_agent.agents import list_agents
from academic_agent.chat_tools import (
    iter_brief_context_step,
    requires_thinking_trace,
    AGENT_MODES,
    is_simple_chat_message,
    iter_tool_steps,

)
from academic_agent.analyze import STRUCTURE_SYSTEM, StructureAnalyzer
from academic_agent.citation import CitationReviewer, CitationVerifier
from academic_agent.docx_export import markdown_to_docx
from academic_agent.export_options import ExportFormatOptions, FONT_FAMILIES
from academic_agent.document_reader import extract_document
from academic_agent.folder_opener import open_in_file_manager
from academic_agent.folder_picker import pick_folder_dialog
from academic_agent.generation_jobs import (
    complete_job,
    create_job,
    fail_job,
    get_job,
    prune_old_jobs,
    update_job,
)
from academic_agent.llm import OpenAICompatibleClient
from academic_agent.config import Settings, get_settings
from academic_agent.llm_config import (
    DEEPSEEK_DEFAULTS,
    client_from_request,
    client_from_settings,
    decode_header_value,
    normalize_base_url,
    settings_from_request,
    tavily_key_from_request,
)
from academic_agent.local_store import (
    delete_project_data,
    ensure_root,
    get_profile,
    list_users,
    load_user_state,
    normalize_data_root,
    register_user,
    save_user_state,
)
from academic_agent.user_library import (
    add_item as library_add_item,
    add_url_item as library_add_url_item,
    delete_item as library_delete_item,
    list_items as library_list_items,
    retrieve_for_topic as library_retrieve,
    set_item_enabled as library_set_enabled,
)
from academic_agent.pdf_export import markdown_to_pdf
from academic_agent.search import AcademicSearcher
from academic_agent.citation_formats import CITATION_FORMATS
from academic_agent.word_count import count_body_words, count_words
from academic_agent.writer import LANGUAGE_INSTRUCTIONS, LongFormWriter


app = FastAPI(title="Joeku", version="0.3.0")
static_dir = files("academic_agent").joinpath("static")
app.mount("/static", StaticFiles(directory=str(static_dir)), name="static")


class AnalyzeRequest(BaseModel):
    text: str = Field(min_length=20)


class GenerateRequest(BaseModel):
    topic: str = Field(min_length=3)
    target_words: int = Field(default=5000, ge=300, le=30000)
    search_limit: int = Field(default=10, ge=0, le=50)
    citation_limit: int = Field(default=15, ge=0, le=80)
    language: str = Field(default="zh")
    citation_format: str = Field(default="apa7")
    requirements: str = Field(default="")
    fast_mode: bool = Field(default=True)
    web_search: bool = Field(default=True)
    de_ai: bool = Field(default=False)
    deep_quality: bool = Field(default=False)
    data_root: str = Field(default="")
    user_id: str = Field(default="")
    project_id: str = Field(default="")
    library_ids: list[str] = Field(default_factory=list)
    use_library: bool = Field(default=True)
    chat_mode: str = Field(default="default")
    agent_tool: str = Field(default="chatbot")


class ReviewRequest(BaseModel):
    text: str = Field(min_length=20)


class ChatMessage(BaseModel):
    role: str = Field(pattern="^(user|assistant|system)$")
    content: str = Field(min_length=1)


class ChatRequest(BaseModel):
    messages: list[ChatMessage] = Field(min_length=1)
    paper_context: str = Field(default="")
    data_root: str = Field(default="")
    user_id: str = Field(default="")
    project_id: str = Field(default="")
    persona_hint: str = Field(default="")
    library_ids: list[str] = Field(default_factory=list)
    use_library: bool = Field(default=True)
    chat_mode: str = Field(default="default")
    agent_tool: str = Field(default="chatbot")


class SummarizeTopicRequest(BaseModel):
    messages: list[ChatMessage] = Field(default_factory=list)
    paper_context: str = Field(default="")
    persona_hint: str = Field(default="")


class IntentRequest(BaseModel):
    message: str = Field(min_length=1)
    paper_context: str = Field(default="")
    persona_hint: str = Field(default="")
    chat_mode: str = Field(default="default")


class SuggestionsRequest(BaseModel):
    recent_topics: list[str] = Field(default_factory=list)
    persona_hint: str = Field(default="")


class ImprovePaperRequest(BaseModel):
    paper: str = Field(min_length=50)
    feedback: str = Field(min_length=5)


class ReviseSelectionRequest(BaseModel):
    paper: str = Field(min_length=20)
    selection: str = Field(min_length=5)
    selections: list[str] = Field(default_factory=list)
    comment: str = Field(min_length=2)
    data_root: str = Field(default="")
    user_id: str = Field(default="")
    library_ids: list[str] = Field(default_factory=list)
    project_id: str = Field(default="")


class ApplyRevisionRequest(BaseModel):
    paper: str = Field(min_length=20)
    selection: str = Field(min_length=5)
    advice: str = Field(min_length=10)
    data_root: str = Field(default="")
    user_id: str = Field(default="")
    library_ids: list[str] = Field(default_factory=list)
    project_id: str = Field(default="")


class StructureAnalyzeRequest(BaseModel):
    paper: str = Field(min_length=50)
    topic: str = Field(default="")


class LocalRegisterRequest(BaseModel):
    data_root: str = Field(min_length=1)
    display_name: str = Field(min_length=1)
    persona_hint: str = Field(default="")


class LocalStateRequest(BaseModel):
    data_root: str = Field(min_length=1)
    user_id: str = Field(min_length=1)
    state: dict


class LocalDeleteProjectRequest(BaseModel):
    data_root: str = Field(min_length=1)
    user_id: str = Field(min_length=1)
    project_id: str = Field(min_length=1)


class LibraryToggleRequest(BaseModel):
    data_root: str = Field(min_length=1)
    user_id: str = Field(min_length=1)
    project_id: str = Field(min_length=1)
    ref_id: str = Field(min_length=1)
    enabled: bool = True


class LibraryUrlRequest(BaseModel):
    data_root: str = Field(min_length=1)
    user_id: str = Field(min_length=1)
    project_id: str = Field(min_length=1)
    url: str = Field(min_length=8)


class SaveDocxRequest(BaseModel):
    document: str = Field(min_length=20)
    topic: str = Field(min_length=1)
    output_dir: str = Field(min_length=1)
    filename: str | None = None
    format_options: ExportFormatOptions | None = None


class SavePdfRequest(BaseModel):
    document: str = Field(min_length=20)
    topic: str = Field(min_length=1)
    output_dir: str = Field(min_length=1)
    filename: str | None = None
    format_options: ExportFormatOptions | None = None


class ExportDocumentRequest(BaseModel):
    document: str = Field(min_length=20)
    topic: str = Field(min_length=1)
    filename: str | None = None
    format_options: ExportFormatOptions | None = None


class SettingsStatusRequest(BaseModel):
    api_key: str = ""
    base_url: str = DEEPSEEK_DEFAULTS["base_url"]
    model: str = DEEPSEEK_DEFAULTS["model"]


THINK_SYSTEM = """You are Joeku's live inner monologue — the user watches this stream in real time.
Think aloud in first person (ALWAYS in English) about THIS specific message: echo their key words, note what's unclear, what draft/library context matters, what you still need to verify.
Write like a person thinking, not a checklist. Short clauses, stream-friendly. No bullet lists or headings.
Do NOT give the final answer. Do NOT use filler like "let me analyze" or "I will structure my reply".
3-8 sentences, concrete to their request. Keep thinking in English even if user spoke Chinese."""

CHAT_SYSTEM = """You are Joeku, a friendly academic writing agent in a chat interface.
You help users write and refine university-level papers with academic integrity.
When a paper draft is in context, reference specific sections — do not speak generically.
Ground claims in the user's library excerpts when provided; never invent references or citations.
When discussing citations, follow APA 7 / MLA 9 / Chicago / IEEE as relevant and say when uncertain.

Your visible answer MUST follow DeepSeek Chat Markdown layout (body only — never repeat reasoning):
- Plain prose paragraphs separated by ONE blank line.
- Use ## for section titles when covering 2+ topics; never use ### or deeper unless code docs.
- NEVER put a blank line between numbered list items. Format exactly:
  1. First item
  2. Second item
- Bullet lists: "- item" one per line, no blank lines between bullets.
- Use **bold** sparingly for key terms; `code` for identifiers; fenced ``` for multi-line code.
- Do NOT wrap the entire reply in one giant paragraph.
- Do NOT output HTML, XML, or JSON in the answer.
- Reason internally in English.
- Match the user's language for the final visible answer only (Chinese question → Chinese answer).

Default to concise replies (1-2 short paragraphs). Expand only when the user asks for depth.
During long paper generation, reassure the user that writing continues and answer their questions."""

CHAT_MODE_HINTS: dict[str, str] = {
    "default": (
        "Balance warmth and clarity; expand enough to be genuinely useful. "
        "Use ## section headings whenever the reply covers 2+ topics or steps."
    ),
    "deep": (
        "Deep-thinking mode: reason step-by-step, cover multiple angles, trade-offs, and evidence. "
        "Use 3-5 paragraphs; end with 2-3 actionable next steps."
    ),
    "structure": (
        "Clear-architecture mode: lead with an outline or section headings (##). "
        "Use numbered steps and hierarchical bullets; prioritize structure before prose."
    ),
    "rigorous": (
        "Academic-rigor mode: formal scholarly tone, precise terminology, explicit assumptions and limits. "
        "Cite standards (APA/MLA etc.) when relevant."
    ),
}

WRITING_MODE_HINTS: dict[str, str] = {
    "default": "",
    "deep": "Emphasize depth of argument, literature integration, and nuanced claims in the plan.",
    "structure": "Prioritize explicit hierarchical section purposes and logical flow in the plan.",
    "rigorous": "Prioritize formal academic tone and defensible thesis structure in the plan.",
}


IMPROVE_SYSTEM = """You are an academic revision agent.
Apply the user's feedback to improve the paper while preserving valid citations and scholarly tone.
Return the full revised paper in Markdown format (headings with ##, references section, etc.)."""

SELECTION_REVISE_SYSTEM = """You are an academic writing coach.
The user highlighted one or more passages and left an annotation.
Respond in the SAME language as the paper (Chinese paper → Chinese; English → English).
Use Markdown with exactly these headings (translate labels to match paper language):
## Annotation understood
## Suggested revision
(paste-ready replacement prose for the highlighted passage only — no meta commentary)
## Further improvements
Preserve valid citations; do not invent references. Be concise and actionable."""

APPLY_REVISION_SYSTEM = """You are an academic editor.
Apply the agent's revision advice to the selected passage only.
Return ONLY the revised passage in Markdown — same tone and structure as the original.
Preserve in-text citations; do not invent new references."""




def _resolve_data_root(raw: str) -> Path:
    raw = decode_header_value(raw) or ""
    if not raw.strip():
        default = get_settings().default_data_root
        if default.strip():
            raw = default
        else:
            # For cloud/public deploys, you should set DEFAULT_DATA_ROOT
            # or the client must always send data_root.
            raise HTTPException(
                status_code=400,
                detail="未提供 data_root，且服务器未配置 DEFAULT_DATA_ROOT。公共部署请设置环境变量 DEFAULT_DATA_ROOT。"
            )
    try:
        return normalize_data_root(raw)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


def _library_context(
    data_root: str,
    user_id: str,
    project_id: str,
    topic: str,
    library_ids: list[str],
    use_library: bool,
) -> str:
    if not use_library or not data_root.strip() or not user_id.strip() or not project_id.strip():
        return ""
    try:
        root = _resolve_data_root(data_root)
        return library_retrieve(
            root, user_id, project_id, topic, library_ids=library_ids or None, limit=6
        )
    except Exception:
        return ""


def _persona_block(hint: str) -> str:
    text = (hint or "").strip()
    if not text:
        return ""
    return f"User identity preferences for this session:\n{text}"


def _chat_mode_block(mode: str) -> str:
    key = (mode or "default").strip().lower()
    hint = CHAT_MODE_HINTS.get(key, "")
    if not hint:
        return ""
    return f"Active chat mode ({key}):\n{hint}"


INTENT_SYSTEM = """You classify messages for Joeku, an academic writing assistant.
Return JSON only: {"intent":"chat"|"write","topic":"","reply":""}
- write: user wants to START composing a full paper/article now — e.g. 帮我写/撰写/生成/创作 + topic, write a paper on X, 写一篇关于X的论文
- chat: greetings, small talk, short Q&A, editing one paragraph, citation help only, vague brainstorming without write-now intent
If chat: warm substantive reply in user's language (2-4 sentences).
If write: extract concise scholarly topic in topic (8-80 chars, user's language). reply MUST:
  1) confirm the topic enthusiastically
  2) recommend switching to Generate mode for full paper creation (literature search, outline, section-by-section writing)
  3) NOT pretend the full paper is already written — only invite them to start Generate."""

SUMMARIZE_TOPIC_SYSTEM = """You infer an academic paper topic from a chat history for Joeku.
Return JSON only: {"topic":""}
- topic: one concise scholarly title (8–80 chars) in the language of the substantive discussion
- Synthesize themes across the whole conversation — never echo a single trivial last message
- If only greetings, small talk, or no clear paper subject, return {"topic":""}
- Ignore "hello", "hi", thanks, and filler unless the full chat still implies a research direction"""


SUGGESTIONS_SYSTEM = """You suggest 3 starter prompts for an academic writing app user.
Return JSON only: {"greeting":"...","chips":[{"label":"short label","prompt":"full topic to write"}]}
greeting: one warm line (can reference time of day or encourage self-care), user's language if topics are Chinese else English.
chips: personalized from recent_topics if provided; mix academic + light emotional value; labels ≤12 chars."""


def _sse_token(text: str) -> str:
    escaped = text.replace("\r", "").replace("\n", "\ndata: ")
    return f"data: {escaped}\n\n"


def _sse_event(event: str, text: str = "") -> str:
    payload = "ok" if not text and event in {"done", "think_done"} else text
    escaped = payload.replace("\r", "").replace("\n", "\ndata: ")
    return f"event: {event}\ndata: {escaped}\n\n"


def _sse_error(message: str) -> str:
    return f"event: error\ndata: {message}\n\n"


_SSE_HEADERS = {
    "Cache-Control": "no-cache, no-transform",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",
}


def _sse_streaming_response(generator) -> StreamingResponse:
    return StreamingResponse(generator, media_type="text/event-stream", headers=_SSE_HEADERS)


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    return JSONResponse(
        status_code=500,
        content={"detail": f"Internal server error while handling {request.url.path}: {exc}"},
    )


def _api_key_error(exc: Exception) -> HTTPException:
    return HTTPException(
        status_code=400,
        detail="缺少 API Key。请先在页面登录并填入你自己的 API Key。",
    )


def _require_api_key(request: Request) -> None:
    settings = settings_from_request(request)
    if not settings.openai_api_key:
        raise HTTPException(
            status_code=400,
            detail="缺少 API Key。请先在页面登录并填入你自己的 API Key。",
        )


def _safe_filename(topic: str) -> str:
    slug = re.sub(r"[^\w\u4e00-\u9fff\-]+", "-", topic.strip())[:60].strip("-")
    stamp = datetime.now().strftime("%Y%m%d-%H%M")
    return f"{slug or 'paper'}-{stamp}.docx"


_NO_CACHE = {"Cache-Control": "no-cache, no-store, must-revalidate", "Pragma": "no-cache"}


@app.middleware("http")
async def disable_static_cache(request: Request, call_next):
    response = await call_next(request)
    path = request.url.path
    if path == "/" or (
        path.startswith("/static/")
        and path.rsplit(".", 1)[-1] in {"js", "css", "html", "svg"}
    ):
        response.headers.update(_NO_CACHE)
    return response


@app.get("/")
def index() -> FileResponse:
    return FileResponse(str(static_dir.joinpath("index.html")), headers=_NO_CACHE)


@app.get("/api/config/defaults")
def config_defaults() -> dict:
    return {
        "app_name": "Joeku",
        "base_url": DEEPSEEK_DEFAULTS["base_url"],
        "model": DEEPSEEK_DEFAULTS["model"],
        "api_path": "/v1",
        "languages": [
            {"code": "zh", "label": "简体中文"},
            {"code": "en", "label": "English"},
            {"code": "ja", "label": "日本語"},
            {"code": "de", "label": "Deutsch"},
            {"code": "fr", "label": "Français"},
            {"code": "es", "label": "Español"},
            {"code": "ko", "label": "한국어"},
        ],
        "citation_formats": [
            {"code": k, "label": v["label"]} for k, v in CITATION_FORMATS.items()
        ],
        "font_families": [{"code": k, "label": v["label"]} for k, v in FONT_FAMILIES.items()],
        "font_sizes": [10, 11, 12, 14, 16],
        "line_spacings": [
            {"value": 1.0, "label": "单倍"},
            {"value": 1.15, "label": "1.15 倍"},
            {"value": 1.5, "label": "1.5 倍"},
            {"value": 2.0, "label": "2 倍"},
        ],
        "first_line_indents": [
            {"value": 0, "label": "无首行缩进"},
            {"value": 2, "label": "2 字符（中文常用）"},
            {"value": 4, "label": "4 字符"},
        ],
    }


@app.get("/api/health")
def health() -> dict:
    """Local service health — confirms generation stack is available on this machine."""
    return {
        "ok": True,
        "app": "Joeku",
        "local": True,
        "requires_user_key": True,
    }


@app.post("/api/config/test")
def test_config(request: Request, body: SettingsStatusRequest) -> dict:
    base = get_settings()
    settings = base.model_copy(
        update={
            "openai_api_key": body.api_key.strip(),
            "openai_base_url": normalize_base_url(body.base_url.strip() or base.openai_base_url),
            "openai_model": body.model.strip() or base.openai_model,
        }
    )
    if not settings.openai_api_key:
        raise HTTPException(status_code=400, detail="请先输入 API Key。")
    try:
        client = client_from_settings(settings)
        reply = client.chat(
            [{"role": "user", "content": "Reply with exactly: OK"}],
            temperature=0,
            max_tokens=64,
        )
        text = reply.strip() or "OK"
        return {"ok": True, "message": "连接成功", "reply": text[:80]}
    except Exception as exc:
        # Unwrap tenacity RetryError to show the real cause
        from tenacity import RetryError
        if isinstance(exc, RetryError) and exc.last_attempt and exc.last_attempt.exception():
            exc = exc.last_attempt.exception()
        raise HTTPException(status_code=400, detail=f"连接失败: {exc}") from exc


@app.post("/api/upload")
async def upload_document(file: UploadFile = File(...)) -> dict:
    content = await file.read()
    try:
        document = extract_document(file.filename or "document", content)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"Could not extract text: {exc}") from exc
    return {
        "filename": document.filename,
        "extension": document.extension,
        "text": document.text,
        "word_count": document.word_count,
        "char_count": document.char_count,
    }


@app.get("/api/search")
def search(q: str, limit: int = 8) -> dict:
    if not q.strip():
        raise HTTPException(status_code=400, detail="Search query is required.")
    papers = AcademicSearcher().search(q, limit=max(1, min(limit, 30)))
    return {"papers": [paper.model_dump(mode="json", exclude={"raw"}) for paper in papers]}


@app.post("/api/verify")
def verify(
    doi: str | None = Form(default=None),
    arxiv_id: str | None = Form(default=None),
    title: str | None = Form(default=None),
) -> dict:
    try:
        result = CitationVerifier().verify(doi=doi, arxiv_id=arxiv_id, title=title)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return result.model_dump(mode="json")


@app.post("/api/analyze")
def analyze(request: Request, body: AnalyzeRequest) -> dict:
    _require_api_key(request)
    try:
        result = StructureAnalyzer(llm=client_from_request(request)).analyze_text(body.text)
    except RuntimeError as exc:
        raise _api_key_error(exc) from exc
    return {"analysis": result}


def _run_generation_job(job_id: str, settings: Settings, body: GenerateRequest, tavily_key: str = "") -> None:
    def on_progress(step: str, percent: int, message: str, **meta: object) -> None:
        update_job(
            job_id,
            step=step,
            percent=percent,
            message=message,
            section_current=str(meta.get("section_current") or ""),
            sections_plan=meta.get("sections_plan") if isinstance(meta.get("sections_plan"), list) else None,
        )

    def on_preview(text: str) -> None:
        job = get_job(job_id)
        pct = job.percent if job else 28
        update_job(
            job_id,
            step="write",
            percent=pct,
            message=job.message if job and job.message else "撰写中…",
            preview=text,
            section_current=job.section_current if job else "",
            sections_plan=job.sections_plan if job else None,
        )

    try:
        if not settings.openai_api_key:
            fail_job(job_id, "缺少 API Key，请重新登录后再试。")
            return
        writer = LongFormWriter(llm=client_from_settings(settings), max_parallel_sections=4)
        language = body.language if body.language in LANGUAGE_INSTRUCTIONS else "zh"
        cite_fmt = body.citation_format if body.citation_format in CITATION_FORMATS else "apa7"
        lib_ctx = _library_context(
            body.data_root,
            body.user_id,
            body.project_id,
            body.topic,
            body.library_ids,
            body.use_library,
        )
        writing_hint = WRITING_MODE_HINTS.get((body.chat_mode or "default").strip().lower(), "")
        requirements = body.requirements
        if writing_hint:
            requirements = (requirements + "\n\nWriting mode guidance:\n" + writing_hint).strip()
        document = writer.write(
            body.topic,
            target_words=body.target_words,
            search_limit=body.search_limit,
            citation_limit=body.citation_limit,
            language=language,
            citation_format=cite_fmt,
            requirements=requirements,
            library_context=lib_ctx,
            fast_mode=body.fast_mode,
            web_search=body.web_search,
            tavily_key=tavily_key,
            de_ai=body.de_ai,
            deep_quality=body.deep_quality,
            on_progress=on_progress,
            on_preview=on_preview,
        )
        body_word_count = count_body_words(document)
        complete_job(
            job_id,
            {
                "document": document,
                "word_count": body_word_count,
                "body_word_count": body_word_count,
                "topic": body.topic,
                "target_words": body.target_words,
                "citation_limit": body.citation_limit,
                "language": language,
                "citation_format": cite_fmt,
                "word_count_ok": abs(body_word_count - body.target_words) <= body.target_words * 0.08,
            },
        )
    except RuntimeError as exc:
        msg = str(exc)
        if "OPENAI_API_KEY" in msg or "api_key" in msg.lower():
            fail_job(job_id, "缺少 API Key，请重新登录后再试。")
        else:
            fail_job(job_id, f"生成失败: {msg}")
    except Exception as exc:
        from tenacity import RetryError

        if isinstance(exc, RetryError) and exc.last_attempt and exc.last_attempt.exception():
            exc = exc.last_attempt.exception()
        fail_job(job_id, f"论文生成过程中出错: {exc}")


@app.post("/api/generate")
def generate_paper(request: Request, body: GenerateRequest) -> dict:
    """Synchronous generate (legacy). Prefer /api/generate/start for progress."""
    _require_api_key(request)
    settings = settings_from_request(request)
    job_id = create_job()
    _run_generation_job(job_id, settings, body, tavily_key_from_request(request))
    job = get_job(job_id)
    if job and job.status == "error":
        raise HTTPException(status_code=500, detail=job.error or "生成失败")
    return job.result if job else {}


@app.post("/api/generate/start")
def start_generate(request: Request, body: GenerateRequest) -> dict:
    _require_api_key(request)
    settings = settings_from_request(request)
    prune_old_jobs()
    job_id = create_job()
    tavily_key = tavily_key_from_request(request)
    thread = threading.Thread(target=_run_generation_job, args=(job_id, settings, body, tavily_key), daemon=True)
    thread.start()
    return {"job_id": job_id}


@app.get("/api/generate/status/{job_id}")
def generate_status(job_id: str) -> dict:
    job = get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="任务不存在或已过期。")
    payload = {
        "job_id": job.job_id,
        "status": job.status,
        "step": job.step,
        "percent": job.percent,
        "message": job.message,
        "section_current": job.section_current or "",
        "sections_plan": job.sections_plan or [],
        "preview_len": len(job.preview or ""),
    }
    preview = job.preview or ""
    payload["preview"] = preview[-16000:] if len(preview) > 16000 else preview
    if job.status == "done" and job.result:
        slim = {k: v for k, v in job.result.items() if k != "document"}
        slim["has_document"] = bool(job.result.get("document"))
        payload["result"] = slim
    if job.status == "error":
        payload["error"] = job.error
    return payload


@app.get("/api/generate/result/{job_id}")
def generate_result(job_id: str) -> dict:
    job = get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="任务不存在或已过期。")
    if job.status != "done" or not job.result:
        raise HTTPException(status_code=409, detail="论文尚未生成完成。")
    document = job.result.get("document") or job.preview or ""
    return {
        "job_id": job.job_id,
        "document": document,
        "word_count": job.result.get("word_count"),
        "topic": job.result.get("topic"),
    }


def _last_user_message(body: ChatRequest) -> str:
    for msg in reversed(body.messages):
        if msg.role == "user":
            return msg.content
    return ""


def _chat_max_tokens(chat_mode: str, model: str = "") -> int:
    m = (model or "").lower()
    if "reasoner" in m or "r1" in m or "thinking" in m:
        return 8192
    mode = (chat_mode or "default").strip().lower()
    if mode == "deep":
        return 4096
    if mode in {"structure", "rigorous"}:
        return 3072
    return 2048


def _build_think_messages(body: ChatRequest, last_user: str) -> list[dict[str, str]]:
    messages: list[dict[str, str]] = [{"role": "system", "content": THINK_SYSTEM}]
    mode_block = _chat_mode_block(body.chat_mode)
    if mode_block:
        messages.append({"role": "system", "content": f"Reply style to plan for: {mode_block[:400]}"})
    tool = (body.agent_tool or "chatbot").strip().lower()
    if tool != "chatbot":
        messages.append({"role": "system", "content": f"Workspace mode: {tool}"})
    if body.paper_context.strip():
        messages.append(
            {
                "role": "system",
                "content": f"Draft excerpt:\n{body.paper_context[:2500]}",
            }
        )
    if last_user.strip():
        messages.append({"role": "user", "content": last_user})
    else:
        messages.append({"role": "user", "content": "Hello"})
    return messages


def _build_chat_messages(
    body: ChatRequest,
    extra_context: str = "",
    *,
    tool_context_used: bool = False,
) -> list[dict[str, str]]:
    messages: list[dict[str, str]] = [{"role": "system", "content": CHAT_SYSTEM}]
    mode_block = _chat_mode_block(body.chat_mode)
    if mode_block:
        messages.append({"role": "system", "content": mode_block})
    tool = (body.agent_tool or "chatbot").strip().lower()
    tool_hints = {
        "library_search": "Prioritize the current project's library excerpts. Cite only real sources from context.",
        "web_research": "Synthesize web search snippets; name sources and URLs when used.",
        "structure_review": "Analyze structure, flow, and section balance; suggest concrete reorganization.",
        "citation_check": "Flag unsupported claims and missing citations; never invent references.",
        "outline_plan": "Return a clear IMRaD-style outline with section goals.",
    }
    if tool in tool_hints:
        messages.append({"role": "system", "content": tool_hints[tool]})
    persona = _persona_block(body.persona_hint)
    if persona:
        messages.append({"role": "system", "content": persona})
    if extra_context.strip():
        messages.append({"role": "system", "content": extra_context[:12000]})
    if body.paper_context.strip() and not tool_context_used:
        messages.append(
            {
                "role": "system",
                "content": f"Current paper draft (for reference):\n\n{body.paper_context[:12000]}",
            }
        )
    for msg in body.messages[-12:]:
        messages.append({"role": msg.role, "content": msg.content})
    return messages


@app.post("/api/chat")
def chat_with_agent(request: Request, body: ChatRequest) -> dict:
    _require_api_key(request)
    client = client_from_request(request)
    try:
        reply = client.chat(_build_chat_messages(body), temperature=0.4)
    except RuntimeError as exc:
        raise _api_key_error(exc) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"对话失败: {exc}") from exc
    return {"reply": reply}


@app.get("/api/agent/modes")
def agent_modes() -> dict:
    return {"modes": AGENT_MODES}


@app.post("/api/chat/stream")
async def chat_stream(request: Request, body: ChatRequest) -> StreamingResponse:
    _require_api_key(request)
    settings = settings_from_request(request)
    client = client_from_request(request)
    tavily_key = tavily_key_from_request(request)

    async def generate():
        try:
            yield ": connected\n\n"
            last_user = _last_user_message(body)
            agent_tool = body.agent_tool or "chatbot"
            chat_mode = body.chat_mode or "default"
            trace_required = requires_thinking_trace(agent_tool, chat_mode)
            simple = is_simple_chat_message(last_user, agent_tool=agent_tool) and not trace_required
            message_count = len([m for m in body.messages if m.role in {"user", "assistant"}])

            # Super fast path for pure greetings like "hello" / "hi" — avoid any heavy thinking
            if simple and len(last_user.strip()) <= 20 and not any(c.isdigit() for c in last_user):
                # direct short reply without tool steps or native thinking
                short_reply = "Hello! How can I help with your academic writing today?"
                yield _sse_event("answer", short_reply)
                yield _sse_event("done")
                return

            tool_ctx = ""

            if simple:
                pass
            elif trace_required and is_simple_chat_message(last_user, agent_tool=agent_tool):
                for step in iter_brief_context_step(
                    agent_tool=agent_tool,
                    chat_mode=chat_mode,
                ):
                    yield _sse_event("step", step.to_json())
            else:
                ctx_holder: list[str] = []
                step_q: queue.Queue[object] = queue.Queue()

                def _run_tools() -> None:
                    try:
                        for tool_step in iter_tool_steps(
                            agent_tool=agent_tool,
                            last_user=last_user,
                            paper_context=body.paper_context,
                            data_root=body.data_root,
                            user_id=body.user_id,
                            project_id=body.project_id,
                            library_ids=body.library_ids,
                            use_library=body.use_library,
                            tavily_key=tavily_key,
                            chat_mode=chat_mode,
                            message_count=message_count,
                            ctx_out=ctx_holder,
                        ):
                            step_q.put(tool_step)
                    finally:
                        step_q.put(None)

                threading.Thread(target=_run_tools, daemon=True).start()

                while True:
                    tool_step = await asyncio.to_thread(step_q.get)
                    if tool_step is None:
                        break
                    yield _sse_event("step", tool_step.to_json())

                tool_ctx = ctx_holder[0] if ctx_holder else ""

            messages = _build_chat_messages(
                body,
                extra_context=tool_ctx,
                tool_context_used=bool(tool_ctx.strip()),
            )
            max_tokens = _chat_max_tokens(body.chat_mode or "default", settings.openai_model)
            if simple:
                max_tokens = min(max_tokens, 256)  # keep simple greetings fast, no long thinking
            use_native_thinking = (
                (not simple or trace_required)
                and OpenAICompatibleClient.supports_native_thinking(settings.openai_model)
            )

            answer_count = 0
            reasoning_count = 0
            think_closed = simple and not trace_required

            async for kind, token in client.iter_chat_stream_dual_threaded(
                messages,
                temperature=0.4,
                max_tokens=max_tokens,
                enable_thinking=use_native_thinking,
            ):
                if not token:
                    continue
                if kind == "reasoning":
                    reasoning_count += 1
                    yield _sse_event("reasoning", token)
                    yield _sse_event("think", token)
                else:
                    if reasoning_count > 0 and not think_closed:
                        yield _sse_event("think_done")
                        think_closed = True
                    answer_count += 1
                    yield _sse_event("answer", token)

            if not think_closed:
                yield _sse_event("think_done")

            if answer_count == 0:
                reply = await asyncio.to_thread(
                    client.chat,
                    messages,
                    temperature=0.4,
                    max_tokens=max_tokens,
                )
                if (reply or "").strip():
                    yield _sse_event("answer", reply.strip())
                    yield _sse_event("done")
                else:
                    yield _sse_error(
                        "模型未返回内容。请换用 deepseek-chat 或 deepseek-v4-flash，"
                        "reasoner 模型请确保 max_tokens 充足。"
                    )
            else:
                yield _sse_event("done")
        except Exception as exc:
            yield _sse_error(str(exc))

    return _sse_streaming_response(generate())


@app.post("/api/summarize-topic")
def summarize_topic(request: Request, body: SummarizeTopicRequest) -> dict:
    _require_api_key(request)
    client = client_from_request(request)
    msgs = [m for m in body.messages if m.content.strip()][-24:]
    if not msgs:
        return {"topic": ""}
    transcript = "\n".join(f"{m.role}: {m.content.strip()[:800]}" for m in msgs)
    user_content = f"Chat transcript:\n{transcript}"
    if body.paper_context.strip():
        user_content += f"\n\nDraft excerpt:\n{body.paper_context[:2000]}"
    messages: list[dict[str, str]] = [{"role": "system", "content": SUMMARIZE_TOPIC_SYSTEM}]
    persona = _persona_block(body.persona_hint)
    if persona:
        messages.append({"role": "system", "content": persona})
    messages.append({"role": "user", "content": user_content})
    try:
        raw = client.json_chat(messages, temperature=0.15)
    except RuntimeError as exc:
        raise _api_key_error(exc) from exc
    except Exception:
        return {"topic": ""}
    topic = (raw.get("topic") or "").strip()
    if len(topic) < 3:
        topic = ""
    return {"topic": topic}


@app.post("/api/intent")
def detect_intent(request: Request, body: IntentRequest) -> dict:
    _require_api_key(request)
    client = client_from_request(request)
    persona = _persona_block(body.persona_hint)
    mode_block = _chat_mode_block(body.chat_mode)
    user_content = f"Message:\n{body.message.strip()}"
    if body.paper_context.strip():
        user_content += f"\n\nExisting draft excerpt:\n{body.paper_context[:2000]}"
    messages: list[dict[str, str]] = [{"role": "system", "content": INTENT_SYSTEM}]
    if mode_block:
        messages.append({"role": "system", "content": mode_block})
    if persona:
        messages.append({"role": "system", "content": persona})
    messages.append({"role": "user", "content": user_content})
    try:
        raw = client.json_chat(messages, temperature=0.1)
    except RuntimeError as exc:
        raise _api_key_error(exc) from exc
    except Exception:
        return {"intent": "chat", "topic": "", "reply": ""}
    intent = str(raw.get("intent") or "chat").lower()
    if intent not in {"chat", "write"}:
        intent = "chat"
    return {
        "intent": intent,
        "topic": (raw.get("topic") or "").strip(),
        "reply": (raw.get("reply") or "").strip(),
    }


@app.post("/api/suggestions")
def topic_suggestions(request: Request, body: SuggestionsRequest) -> dict:
    _require_api_key(request)
    client = client_from_request(request)
    topics = [t.strip() for t in body.recent_topics if t and t.strip()][:8]
    topic_line = ", ".join(topics) if topics else "（暂无历史）"
    persona = _persona_block(body.persona_hint)
    messages: list[dict[str, str]] = [{"role": "system", "content": SUGGESTIONS_SYSTEM}]
    if persona:
        messages.append({"role": "system", "content": persona})
    messages.append(
        {
            "role": "user",
            "content": f"Recent paper topics: {topic_line}\nSuggest greeting and 3 chips.",
        }
    )
    try:
        raw = client.json_chat(messages, temperature=0.55)
    except RuntimeError as exc:
        raise _api_key_error(exc) from exc
    chips = raw.get("chips") or []
    cleaned = []
    for c in chips[:3]:
        if isinstance(c, dict) and c.get("prompt"):
            cleaned.append(
                {
                    "label": str(c.get("label") or c["prompt"])[:24],
                    "prompt": str(c["prompt"]).strip(),
                }
            )
    while len(cleaned) < 3:
        defaults = [
            {"label": "Morning reading", "prompt": "Cognitive benefits of morning reading habits"},
            {"label": "AI & education", "prompt": "AI opportunities and challenges in university classrooms"},
            {"label": "Self-care", "prompt": "Balancing study and rest: a note on self-care"},
        ]
        cleaned.append(defaults[len(cleaned)])
    return {
        "greeting": (raw.get("greeting") or "What paper shall we write today?").strip(),
        "chips": cleaned,
    }


@app.get("/api/agents")
def agents_list() -> dict:
    return {"agents": list_agents()}


def _improve_paper_messages(body: ImprovePaperRequest) -> list[dict[str, str]]:
    return [
        {"role": "system", "content": IMPROVE_SYSTEM},
        {
            "role": "user",
            "content": (
                f"User feedback:\n{body.feedback}\n\n"
                f"Paper to revise:\n{body.paper[:100000]}\n\n"
                "Return the complete revised paper in Markdown."
            ),
        },
    ]


@app.post("/api/improve-paper")
def improve_paper(request: Request, body: ImprovePaperRequest) -> dict:
    _require_api_key(request)
    client = client_from_request(request)
    try:
        revised = client.chat(_improve_paper_messages(body), temperature=0.35)
    except RuntimeError as exc:
        raise _api_key_error(exc) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Revision failed: {exc}") from exc
    return {"document": revised, "word_count": len(revised.split())}


@app.post("/api/improve-paper/stream")
def improve_paper_stream(request: Request, body: ImprovePaperRequest) -> StreamingResponse:
    _require_api_key(request)
    client = client_from_request(request)
    messages = _improve_paper_messages(body)

    def generate():
        try:
            for token in client.chat_stream(messages, temperature=0.35, max_tokens=8192):
                yield _sse_token(token)
            yield "event: done\ndata: ok\n\n"
        except Exception as exc:
            yield _sse_error(str(exc))

    return _sse_streaming_response(generate())


@app.get("/api/pick-folder")
def pick_folder() -> dict:
    # On cloud/server deployments, folder picking is not supported (use DEFAULT_DATA_ROOT instead)
    settings = get_settings()
    if settings.default_data_root.strip():
        raise HTTPException(
            status_code=400,
            detail="此实例使用服务器管理的目录（DEFAULT_DATA_ROOT）。无法从浏览器选择本地文件夹。"
        )
    try:
        folder = pick_folder_dialog()
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    if not folder:
        raise HTTPException(status_code=400, detail="未选择文件夹。")
    return {"path": folder, "folder": folder}


@app.get("/api/open-folder")
def open_folder(path: str) -> dict:
    if not path.strip():
        raise HTTPException(status_code=400, detail="请提供路径。")
    try:
        opened = open_in_file_manager(path.strip())
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"无法打开文件夹: {exc}") from exc
    return {"opened": opened}


@app.post("/api/export/docx")
def export_docx_download(body: ExportDocumentRequest) -> Response:
    import tempfile

    filename = body.filename or _safe_filename(body.topic)
    if not filename.lower().endswith(".docx"):
        filename = f"{filename}.docx"
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / filename
        markdown_to_docx(body.document, path, title=body.topic, options=body.format_options)
        data = path.read_bytes()
    return Response(
        content=data,
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@app.post("/api/export/pdf")
def export_pdf_download(body: ExportDocumentRequest) -> Response:
    import tempfile

    filename = (body.filename or _safe_filename(body.topic)).replace(".docx", ".pdf")
    if not filename.lower().endswith(".pdf"):
        filename = f"{Path(filename).stem}.pdf"
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / filename
        markdown_to_pdf(body.document, path, title=body.topic, options=body.format_options)
        data = path.read_bytes()
    return Response(
        content=data,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@app.post("/api/save-docx")
def save_docx(body: SaveDocxRequest) -> dict:
    output_dir = Path(body.output_dir).expanduser()
    if not output_dir.is_dir():
        raise HTTPException(status_code=400, detail="保存路径无效，请重新选择文件夹。")
    filename = body.filename or _safe_filename(body.topic)
    if not filename.lower().endswith((".docx", ".doc")):
        filename = f"{filename}.docx"
    output_path = output_dir / filename
    try:
        saved = markdown_to_docx(
            body.document, output_path, title=body.topic, options=body.format_options
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"保存 Word 文档失败: {exc}") from exc
    return {"path": str(saved), "filename": saved.name}


@app.post("/api/save-pdf")
def save_pdf(body: SavePdfRequest) -> dict:
    output_dir = Path(body.output_dir).expanduser()
    if not output_dir.is_dir():
        raise HTTPException(status_code=400, detail="保存路径无效，请重新选择文件夹。")
    filename = body.filename or _safe_filename(body.topic).replace(".docx", ".pdf")
    if not filename.lower().endswith(".pdf"):
        filename = f"{Path(filename).stem}.pdf"
    output_path = output_dir / filename
    try:
        saved = markdown_to_pdf(body.document, output_path, title=body.topic, options=body.format_options)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"保存 PDF 失败: {exc}") from exc
    return {"path": str(saved), "filename": saved.name}


@app.post("/api/review-citations")
def review_citations(request: Request, body: ReviewRequest) -> dict:
    _require_api_key(request)
    try:
        reviewer = CitationReviewer(llm=client_from_request(request))
        review = reviewer.review(body.text)
    except RuntimeError as exc:
        raise _api_key_error(exc) from exc
    return {
        "review": review.model_dump(mode="json"),
        "citation_count": len(review.citations),
    }


def _revise_selection_messages(body: ReviseSelectionRequest) -> list[dict[str, str]]:
    selections = [s.strip() for s in body.selections if s and s.strip()] or [body.selection]
    passages = "\n\n---\n\n".join(f"Passage {i + 1}:\n{s}" for i, s in enumerate(selections))
    lib_ctx = _library_context(
        body.data_root, body.user_id, body.project_id, body.selection, body.library_ids, True
    )
    lib_block = f"\n\nReference library:\n{lib_ctx}" if lib_ctx else ""
    return [
        {"role": "system", "content": SELECTION_REVISE_SYSTEM},
        {
            "role": "user",
            "content": (
                f"Annotation:\n{body.comment}\n\n"
                f"Selected passage(s):\n{passages}\n\n"
                f"Full paper context:\n{body.paper[:80000]}"
                f"{lib_block}"
            ),
        },
    ]


@app.post("/api/revise-selection")
def revise_selection(request: Request, body: ReviseSelectionRequest) -> dict:
    _require_api_key(request)
    client = client_from_request(request)
    try:
        advice = client.chat(_revise_selection_messages(body), temperature=0.3, max_tokens=8192)
    except RuntimeError as exc:
        raise _api_key_error(exc) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Annotation analysis failed: {exc}") from exc
    return {"advice": advice}


@app.post("/api/revise-selection/stream")
def revise_selection_stream(request: Request, body: ReviseSelectionRequest) -> StreamingResponse:
    _require_api_key(request)
    client = client_from_request(request)
    messages = _revise_selection_messages(body)

    def generate():
        try:
            for token in client.chat_stream(messages, temperature=0.3, max_tokens=8192):
                yield _sse_token(token)
            yield "event: done\ndata: ok\n\n"
        except Exception as exc:
            yield _sse_error(str(exc))

    return _sse_streaming_response(generate())


@app.post("/api/apply-revision/stream")
def apply_revision_stream(request: Request, body: ApplyRevisionRequest) -> StreamingResponse:
    _require_api_key(request)
    client = client_from_request(request)
    lib_ctx = _library_context(
        body.data_root, body.user_id, body.project_id, body.selection, body.library_ids, True
    )
    lib_block = f"\n\nReference library:\n{lib_ctx}" if lib_ctx else ""
    messages = [
        {"role": "system", "content": APPLY_REVISION_SYSTEM},
        {
            "role": "user",
            "content": (
                f"Agent advice:\n{body.advice}\n\n"
                f"Selected passage to revise:\n{body.selection}\n\n"
                f"Full paper context:\n{body.paper[:80000]}"
                f"{lib_block}"
            ),
        },
    ]

    def generate():
        try:
            for token in client.chat_stream(messages, temperature=0.25, max_tokens=8192):
                yield _sse_token(token)
            yield "event: done\ndata: ok\n\n"
        except Exception as exc:
            yield _sse_error(str(exc))

    return _sse_streaming_response(generate())


@app.post("/api/analyze/structure")
def analyze_structure(request: Request, body: StructureAnalyzeRequest) -> dict:
    _require_api_key(request)
    try:
        text = StructureAnalyzer(llm=client_from_request(request)).analyze_structure(
            body.paper, topic=body.topic
        )
    except RuntimeError as exc:
        raise _api_key_error(exc) from exc
    return {"analysis": text}


@app.post("/api/analyze/structure/stream")
def analyze_structure_stream(request: Request, body: StructureAnalyzeRequest) -> StreamingResponse:
    _require_api_key(request)
    client = client_from_request(request)
    clipped = body.paper[:50000]
    topic_line = f"Topic: {body.topic}\n\n" if body.topic.strip() else ""
    messages = [
        {"role": "system", "content": STRUCTURE_SYSTEM},
        {
            "role": "user",
            "content": (
                f"{topic_line}Analyze this completed academic draft. "
                "Summarize structure and give concrete next-step revision advice.\n\n"
                f"{clipped}"
            ),
        },
    ]

    def generate():
        try:
            for token in client.chat_stream(messages, temperature=0.25, max_tokens=8192):
                yield _sse_token(token)
            yield "event: done\ndata: ok\n\n"
        except Exception as exc:
            yield _sse_error(str(exc))

    return _sse_streaming_response(generate())


@app.get("/api/local/status")
def local_status(data_root: str = "") -> dict:
    try:
        root = _resolve_data_root(data_root)
        ensure_root(root)
        server_default = bool(get_settings().default_data_root.strip())
        return {
            "configured": True,
            "data_root": str(root),
            "users": list_users(root),
            "server_default": server_default,
        }
    except HTTPException as exc:
        if "未提供" in str(exc.detail):
            return {"configured": False, "server_default": False}
        raise
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/api/local/register")
def local_register(body: LocalRegisterRequest) -> dict:
    try:
        root = _resolve_data_root(body.data_root)
        ensure_root(root)
        profile = register_user(root, body.display_name, persona_hint=body.persona_hint)
        state = load_user_state(root, profile["user_id"])
        return {"profile": profile, "state": state, "data_root": str(root)}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/api/local/users")
def local_users(data_root: str) -> dict:
    root = _resolve_data_root(data_root)
    return {"users": list_users(root)}


@app.get("/api/local/state")
def local_get_state(data_root: str, user_id: str) -> dict:
    root = _resolve_data_root(data_root)
    return {"state": load_user_state(root, user_id), "profile": get_profile(root, user_id)}


@app.put("/api/local/state")
def local_put_state(body: LocalStateRequest) -> dict:
    root = _resolve_data_root(body.data_root)
    save_user_state(root, body.user_id, body.state)
    return {"ok": True}


@app.post("/api/local/project/delete")
def local_delete_project(body: LocalDeleteProjectRequest) -> dict:
    root = _resolve_data_root(body.data_root)
    removed = delete_project_data(root, body.user_id, body.project_id)
    return {"ok": True, "removed": removed}


@app.get("/api/library/list")
def library_list(data_root: str, user_id: str, project_id: str) -> dict:
    root = _resolve_data_root(data_root)
    if not project_id.strip():
        return {"items": []}
    return {"items": library_list_items(root, user_id, project_id)}


@app.post("/api/library/add-url")
def library_add_url(body: LibraryUrlRequest) -> dict:
    root = _resolve_data_root(body.data_root)
    try:
        item = library_add_url_item(root, body.user_id, body.project_id, body.url)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"抓取链接失败: {exc}") from exc
    return {"item": item}


@app.post("/api/library/upload")
async def library_upload(
    data_root: str = Form(...),
    user_id: str = Form(...),
    project_id: str = Form(...),
    file: UploadFile = File(...),
) -> dict:
    root = _resolve_data_root(data_root)
    content = await file.read()
    try:
        item = library_add_item(root, user_id, project_id, file.filename or "document", content)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"item": item}


@app.delete("/api/library/{ref_id}")
def library_remove(ref_id: str, data_root: str, user_id: str, project_id: str) -> dict:
    root = _resolve_data_root(data_root)
    if not library_delete_item(root, user_id, project_id, ref_id):
        raise HTTPException(status_code=404, detail="资料不存在。")
    return {"ok": True}


@app.post("/api/library/toggle")
def library_toggle(body: LibraryToggleRequest) -> dict:
    root = _resolve_data_root(body.data_root)
    item = library_set_enabled(root, body.user_id, body.project_id, body.ref_id, body.enabled)
    if not item:
        raise HTTPException(status_code=404, detail="资料不存在。")
    return {"item": item}