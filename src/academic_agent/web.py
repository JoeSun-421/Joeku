from __future__ import annotations

import re
import threading
from datetime import datetime
from pathlib import Path

from importlib.resources import files

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from starlette.requests import Request

from academic_agent.analyze import StructureAnalyzer
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
    normalize_base_url,
    settings_from_request,
    tavily_key_from_request,
)
from academic_agent.pdf_export import markdown_to_pdf
from academic_agent.search import AcademicSearcher
from academic_agent.citation_formats import CITATION_FORMATS
from academic_agent.word_count import count_words
from academic_agent.writer import LANGUAGE_INSTRUCTIONS, LongFormWriter


app = FastAPI(title="Joeku", version="0.3.0")
static_dir = files("academic_agent").joinpath("static")
app.mount("/static", StaticFiles(directory=str(static_dir)), name="static")


class AnalyzeRequest(BaseModel):
    text: str = Field(min_length=20)


class GenerateRequest(BaseModel):
    topic: str = Field(min_length=3)
    target_words: int = Field(default=5000, ge=300, le=30000)
    search_limit: int = Field(default=15, ge=0, le=50)
    citation_limit: int = Field(default=15, ge=0, le=80)
    language: str = Field(default="zh")
    citation_format: str = Field(default="apa7")
    requirements: str = Field(default="")
    fast_mode: bool = Field(default=False)
    web_search: bool = Field(default=True)
    de_ai: bool = Field(default=False)
    deep_quality: bool = Field(default=False)


class ReviewRequest(BaseModel):
    text: str = Field(min_length=20)


class ChatMessage(BaseModel):
    role: str = Field(pattern="^(user|assistant|system)$")
    content: str = Field(min_length=1)


class ChatRequest(BaseModel):
    messages: list[ChatMessage] = Field(min_length=1)
    paper_context: str = Field(default="")


class ImprovePaperRequest(BaseModel):
    paper: str = Field(min_length=50)
    feedback: str = Field(min_length=5)


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


CHAT_SYSTEM = """You are Joeku, a friendly academic writing agent in a chat interface.
You converse naturally with the user while helping them write and refine university-level papers.
When a paper draft is provided in context, reference it specifically.
When the user asks about citations, follow common university standards (APA 7 / MLA 9 / Chicago / IEEE as relevant).
Give concise, actionable replies in the user's language; use short paragraphs, not walls of text.
If asked to revise a section, provide paste-ready prose with proper in-text citations preserved.
During long paper generation, reassure the user that writing continues in the background and answer their questions."""


IMPROVE_SYSTEM = """You are an academic revision agent.
Apply the user's feedback to improve the paper while preserving valid citations and scholarly tone.
Return the full revised paper in Markdown format (headings with ##, references section, etc.)."""


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
    settings = settings_from_request(request)
    if body.api_key.strip():
        settings = settings.model_copy(
            update={
                "openai_api_key": body.api_key.strip(),
                "openai_base_url": normalize_base_url(body.base_url.strip() or settings.openai_base_url),
                "openai_model": body.model.strip() or settings.openai_model,
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
    def on_progress(step: str, percent: int, message: str) -> None:
        update_job(job_id, step=step, percent=percent, message=message)

    def on_preview(text: str) -> None:
        job = get_job(job_id)
        pct = job.percent if job else 28
        update_job(job_id, step="write", percent=pct, message="撰写中…", preview=text)

    try:
        if not settings.openai_api_key:
            fail_job(job_id, "缺少 API Key，请重新登录后再试。")
            return
        writer = LongFormWriter(llm=client_from_settings(settings))
        language = body.language if body.language in LANGUAGE_INSTRUCTIONS else "zh"
        cite_fmt = body.citation_format if body.citation_format in CITATION_FORMATS else "apa7"
        document = writer.write(
            body.topic,
            target_words=body.target_words,
            search_limit=body.search_limit,
            citation_limit=body.citation_limit,
            language=language,
            citation_format=cite_fmt,
            requirements=body.requirements,
            fast_mode=body.fast_mode,
            web_search=body.web_search,
            tavily_key=tavily_key,
            de_ai=body.de_ai,
            deep_quality=body.deep_quality,
            on_progress=on_progress,
            on_preview=on_preview,
        )
        word_count = count_words(document)
        complete_job(
            job_id,
            {
                "document": document,
                "word_count": word_count,
                "topic": body.topic,
                "target_words": body.target_words,
                "citation_limit": body.citation_limit,
                "language": language,
                "citation_format": cite_fmt,
                "word_count_ok": abs(word_count - body.target_words) <= body.target_words * 0.08,
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


@app.post("/api/chat")
def chat_with_agent(request: Request, body: ChatRequest) -> dict:
    _require_api_key(request)
    client = client_from_request(request)
    messages: list[dict[str, str]] = [{"role": "system", "content": CHAT_SYSTEM}]
    if body.paper_context.strip():
        messages.append(
            {
                "role": "system",
                "content": f"Current paper draft (for reference):\n\n{body.paper_context[:80000]}",
            }
        )
    for msg in body.messages[-20:]:
        messages.append({"role": msg.role, "content": msg.content})
    try:
        reply = client.chat(messages, temperature=0.4)
    except RuntimeError as exc:
        raise _api_key_error(exc) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"对话失败: {exc}") from exc
    return {"reply": reply}


@app.post("/api/improve-paper")
def improve_paper(request: Request, body: ImprovePaperRequest) -> dict:
    _require_api_key(request)
    client = client_from_request(request)
    try:
        revised = client.chat(
            [
                {"role": "system", "content": IMPROVE_SYSTEM},
                {
                    "role": "user",
                    "content": (
                        f"User feedback:\n{body.feedback}\n\n"
                        f"Paper to revise:\n{body.paper[:100000]}\n\n"
                        "Return the complete revised paper in Markdown."
                    ),
                },
            ],
            temperature=0.35,
        )
    except RuntimeError as exc:
        raise _api_key_error(exc) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"修订失败: {exc}") from exc
    return {"document": revised, "word_count": len(revised.split())}


@app.get("/api/pick-folder")
def pick_folder() -> dict:
    try:
        folder = pick_folder_dialog()
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    if not folder:
        raise HTTPException(status_code=400, detail="未选择文件夹。")
    return {"path": folder}


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