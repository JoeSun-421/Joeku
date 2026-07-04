from __future__ import annotations

import json
import re
from collections.abc import Iterator
from concurrent.futures import ThreadPoolExecutor
from dataclasses import asdict, dataclass, field
from urllib.parse import urlparse

from academic_agent.citation import extract_citation_candidates
from academic_agent.local_store import normalize_data_root
from academic_agent.tavily_search import search_tavily
from academic_agent.user_library import list_items, retrieve_for_topic

PHASE_UNDERSTAND = "understand"
PHASE_INVESTIGATE = "investigate"
PHASE_REASON = "reason"
PHASE_RESPOND = "respond"

_MODE_LABELS: dict[str, str] = {
    "chatbot": "Chat",
    "docgen": "Generate",
    "library_search": "Library",
    "web_research": "Web search",
    "structure_review": "Structure",
    "citation_check": "Citations",
    "outline_plan": "Outline",
}

_CHAT_MODE_LABELS: dict[str, str] = {
    "default": "Default",
    "deep": "Deep Think",
    "structure": "Structure",
    "rigorous": "Rigorous",
}


def requires_thinking_trace(agent_tool: str, chat_mode: str) -> bool:
    """Non-default workspace or chat style always shows the thinking panel."""
    tool = (agent_tool or "chatbot").strip().lower()
    mode = (chat_mode or "default").strip().lower()
    if tool != "chatbot":
        return True
    return mode != "default"


AGENT_MODES: list[dict[str, str]] = [
    {"id": "chatbot", "label": "Chat", "hint": "Conversational assistant"},
    {"id": "docgen", "label": "Generate", "hint": "Write a full paper with parameters"},
    {"id": "library_search", "label": "Library", "hint": "Ground answers in this project's library"},
    {"id": "web_research", "label": "Web search", "hint": "Search the web for academic sources"},
    {"id": "structure_review", "label": "Structure", "hint": "Analyze draft structure and flow"},
    {"id": "citation_check", "label": "Citations", "hint": "Scan draft for citation gaps"},
    {"id": "outline_plan", "label": "Outline", "hint": "Plan IMRaD sections and outline"},
]


@dataclass
class ThinkStep:
    type: str
    label: str
    detail: str = ""
    url: str = ""
    phase: str = ""

    def to_json(self) -> str:
        return json.dumps(asdict(self), ensure_ascii=False)


@dataclass
class ToolRunSummary:
    draft_words: int = 0
    heading_count: int = 0
    paragraph_count: int = 0
    library_files: int = 0
    library_matched: list[str] = field(default_factory=list)
    library_excerpt_chars: int = 0
    citation_count: int = 0
    citation_kinds: dict[str, int] = field(default_factory=dict)
    web_hits: int = 0
    structure_sections: list[str] = field(default_factory=list)


def _host(url: str) -> str:
    try:
        return urlparse(url).netloc or url[:48]
    except Exception:
        return url[:48]


def _draft_headings(paper: str) -> list[str]:
    headings: list[str] = []
    for line in paper.splitlines():
        m = re.match(r"^(#{1,6})\s+(.+)", line.strip())
        if m:
            headings.append(m.group(2).strip()[:72])
    return headings


def _draft_paragraphs(paper: str) -> list[str]:
    return [
        p.strip()
        for p in re.split(r"\n\s*\n", paper)
        if p.strip() and not p.strip().startswith("#")
    ]


def _snippet(text: str, limit: int = 72) -> str:
    flat = re.sub(r"\s+", " ", text.strip())
    return flat if len(flat) <= limit else flat[: limit - 1] + "…"


def _is_casual_message(text: str) -> bool:
    """Short greetings / acks."""
    t = text.strip().lower()
    if not t or len(t) > 56:
        return False
    patterns = (
        r"^(hi|hello|hey|thanks|thank you|thx|ok|okay|yes|no|sure|great|nice|cool|got it|bye)[\s!.?]*$",
        r"^(你好|您好|谢谢|多谢|好的|嗯|是的|不是|再见|哈喽)[\s!.?]*$",
    )
    return any(re.match(p, t) for p in patterns)


def is_simple_chat_message(text: str, *, agent_tool: str = "chatbot") -> bool:
    """Skip LLM think + heavy tools for trivial chat."""
    if _is_casual_message(text):
        return True
    tool = (agent_tool or "chatbot").strip().lower()
    if tool != "chatbot":
        return False
    t = text.strip()
    if not t:
        return True
    if len(t) > 80:
        return False
    if re.search(
        r"(论文|段落|引用|大纲|结构|文献|摘要|修改|润色|草稿|"
        r"draft|paper|section|citation|outline|library|bibliography|rewrite|cite|imrad)",
        t,
        re.I,
    ):
        return False
    if body_has_draft_intent(t):
        return False
    if len(t) <= 36:
        return True
    if len(t) <= 80 and "?" not in t and "？" not in t:
        return True
    return False


def body_has_draft_intent(text: str) -> bool:
    return bool(
        re.search(r"(这段|这一句|上文|下文|开头|结尾|第.{0,4}段|section|paragraph|above|below)", text, re.I)
    )


def _library_has_enabled_items(
    *,
    data_root: str,
    user_id: str,
    project_id: str,
    library_ids: list[str] | None = None,
) -> bool:
    if not data_root.strip() or not user_id.strip() or not project_id.strip():
        return False
    try:
        root = normalize_data_root(data_root)
        items = list_items(root, user_id, project_id)
        enabled = [i for i in items if i.get("enabled", True)]
        if library_ids:
            allowed = set(library_ids)
            enabled = [i for i in enabled if i.get("id") in allowed]
        return bool(enabled)
    except Exception:
        return False


def iter_brief_context_step(
    *,
    agent_tool: str,
    chat_mode: str = "default",
) -> Iterator[ThinkStep]:
    """Single understand-phase line — avoid noisy meta steps in the UI."""
    tool = (agent_tool or "chatbot").strip().lower()
    label = _MODE_LABELS.get(tool, tool)
    if chat_mode and chat_mode != "default":
        label = f"{label} · {_CHAT_MODE_LABELS.get(chat_mode, chat_mode)}"
    yield ThinkStep("mode", "准备回复", label, phase=PHASE_UNDERSTAND)


def _tool_read_draft(paper_context: str, summary: ToolRunSummary) -> Iterator[ThinkStep]:
    """Real read: headings, paragraphs, opening/closing excerpts."""
    paper = paper_context.strip()
    if not paper:
        return

    headings = _draft_headings(paper)
    paragraphs = _draft_paragraphs(paper)
    words = len(paper.split())
    summary.draft_words = words
    summary.heading_count = len(headings)
    summary.paragraph_count = len(paragraphs)

    summary.structure_sections = headings
    detail = f"{words} 词 · {len(paragraphs)} 段"
    if headings:
        preview = ", ".join(headings[:3])
        if len(headings) > 3:
            preview += f" 等 {len(headings)} 节"
        detail = f"{detail} · {preview}"
    yield ThinkStep("read", "阅读草稿", detail, phase=PHASE_INVESTIGATE)


def _draft_context(paper_context: str, summary: ToolRunSummary) -> str:
    paper = paper_context.strip()
    if not paper:
        return ""
    parts: list[str] = []
    if summary.structure_sections:
        parts.append("Draft headings:\n" + "\n".join(f"- {h}" for h in summary.structure_sections[:12]))
    paragraphs = _draft_paragraphs(paper)
    if paragraphs:
        parts.append(f"Opening paragraph:\n{paragraphs[0][:2000]}")
        if len(paragraphs) > 1:
            parts.append(f"Closing paragraph:\n{paragraphs[-1][:1200]}")
    return "\n\n".join(parts)


def _tool_search_library(
    *,
    data_root: str,
    user_id: str,
    project_id: str,
    last_user: str,
    library_ids: list[str],
    summary: ToolRunSummary,
    ctx_parts: list[str],
) -> Iterator[ThinkStep]:
    """Real library I/O: list filenames, retrieve excerpts for query."""
    root = normalize_data_root(data_root)
    items = list_items(root, user_id, project_id)
    enabled = [i for i in items if i.get("enabled", True)]
    if not enabled:
        return

    summary.library_files = len(enabled)
    filenames = [(i.get("filename") or "?")[:48] for i in enabled]
    query = last_user.strip() or "academic writing"
    ctx = retrieve_for_topic(root, user_id, project_id, query, library_ids=library_ids or None, limit=4)
    if ctx:
        summary.library_excerpt_chars = len(ctx)
        summary.library_matched = filenames[:3]
        matched = summary.library_matched[0] if summary.library_matched else "资料库"
        yield ThinkStep(
            "grep",
            "检索资料库",
            f"{len(enabled)} 个文件 · {matched}",
            phase=PHASE_INVESTIGATE,
        )
        ctx_parts.append(f"Project library excerpts:\n{ctx[:6000]}")
    else:
        yield ThinkStep(
            "grep",
            "检索资料库",
            f"{len(enabled)} 个文件 · 未命中相关内容",
            phase=PHASE_INVESTIGATE,
        )


def _tool_check_citations(paper_context: str, summary: ToolRunSummary) -> Iterator[ThinkStep]:
    """Real citation extraction from draft."""
    candidates = extract_citation_candidates(paper_context)
    summary.citation_count = len(candidates)
    for c in candidates:
        kind = c.get("kind") or "unknown"
        summary.citation_kinds[kind] = summary.citation_kinds.get(kind, 0) + 1

    if not candidates:
        yield ThinkStep("analyze", "检查引用", "未发现文内引用", phase=PHASE_INVESTIGATE)
        return

    kinds = ", ".join(f"{k}×{v}" for k, v in sorted(summary.citation_kinds.items()))
    yield ThinkStep(
        "analyze",
        "检查引用",
        f"{len(candidates)} 处 · {kinds}",
        phase=PHASE_INVESTIGATE,
    )


def _citation_context(candidates: list[dict]) -> str:
    if not candidates:
        return ""
    lines = [f"- [{c.get('kind', '?')}] {c.get('raw', '')[:120]}" for c in candidates[:20]]
    return "Extracted in-text citations:\n" + "\n".join(lines)


def _tool_map_structure(paper_context: str, summary: ToolRunSummary) -> Iterator[ThinkStep]:
    headings = summary.structure_sections or _draft_headings(paper_context)
    if not headings:
        words = len(paper_context.split())
        yield ThinkStep("analyze", "分析结构", f"{words} 词 · 无章节标题", phase=PHASE_INVESTIGATE)
        return
    preview = " → ".join(headings[:4])
    if len(headings) > 4:
        preview += f" …共 {len(headings)} 节"
    yield ThinkStep("analyze", "分析结构", preview, phase=PHASE_INVESTIGATE)


def _tool_web_search(
    last_user: str,
    tavily_key: str,
    summary: ToolRunSummary,
    ctx_parts: list[str],
) -> Iterator[ThinkStep]:
    query = last_user.strip()
    if not query or not tavily_key.strip():
        return
    hits = search_tavily(query, api_key=tavily_key, limit=3)
    summary.web_hits = len(hits)
    snippets: list[str] = []
    if not hits:
        yield ThinkStep("search", "网络检索", _snippet(query, 48), phase=PHASE_INVESTIGATE)
    else:
        titles = " · ".join((p.title or "Source")[:36] for p in hits[:2])
        if len(hits) > 2:
            titles += f" 等 {len(hits)} 条"
        yield ThinkStep("search", "网络检索", titles, phase=PHASE_INVESTIGATE)
    for paper in hits[:3]:
        snippets.append(f"- {paper.title}: {(paper.abstract or '')[:200]}")
    if snippets:
        ctx_parts.append("Web results:\n" + "\n".join(snippets))


def iter_reason_steps(summary: ToolRunSummary, *, agent_tool: str) -> Iterator[ThinkStep]:
    """Phase 3 — Reason: deterministic synthesis from tool outputs (no LLM)."""
    tool = (agent_tool or "chatbot").strip().lower()

    if summary.draft_words:
        yield ThinkStep(
            "plan",
            "Ground answer in draft",
            f"{summary.draft_words} words, {summary.paragraph_count} paragraphs",
            phase=PHASE_REASON,
        )
    if summary.library_excerpt_chars:
        files = ", ".join(summary.library_matched[:2]) or "library"
        yield ThinkStep(
            "plan",
            "Use library excerpts",
            f"{summary.library_excerpt_chars} chars from {files}",
            phase=PHASE_REASON,
        )
    if summary.citation_count:
        kinds = ", ".join(f"{k}×{v}" for k, v in sorted(summary.citation_kinds.items()))
        yield ThinkStep("plan", "Respect existing citations", kinds, phase=PHASE_REASON)
    if summary.web_hits:
        yield ThinkStep("plan", "Synthesize web sources", f"{summary.web_hits} hits", phase=PHASE_REASON)
    if tool == "outline_plan":
        yield ThinkStep("plan", "Build IMRaD outline", "from draft + sources", phase=PHASE_REASON)
    elif tool == "structure_review" and summary.heading_count:
        yield ThinkStep("plan", "Review section flow", f"{summary.heading_count} sections", phase=PHASE_REASON)
    elif tool == "citation_check" and summary.citation_count:
        yield ThinkStep("plan", "Flag citation gaps", f"{summary.citation_count} markers", phase=PHASE_REASON)
    else:
        yield ThinkStep("plan", "Compose reply", "from gathered context", phase=PHASE_REASON)


def _tool_run_flags(
    *,
    agent_tool: str,
    last_user: str,
    paper_context: str,
    data_root: str,
    user_id: str,
    project_id: str,
    library_ids: list[str] | None = None,
    use_library: bool,
    tavily_key: str,
) -> dict[str, bool]:
    tool = (agent_tool or "chatbot").strip().lower()
    has_project = bool(data_root.strip() and user_id.strip() and project_id.strip())
    has_draft = bool(paper_context.strip())
    casual = tool == "chatbot" and is_simple_chat_message(last_user, agent_tool=tool)
    has_library = _library_has_enabled_items(
        data_root=data_root,
        user_id=user_id,
        project_id=project_id,
        library_ids=library_ids,
    )
    return {
        "tool": tool,
        "casual": casual,
        "run_draft": has_draft and not casual,
        "run_library": (
            use_library
            and has_project
            and has_library
            and not casual
            and tool in ("chatbot", "library_search", "outline_plan", "citation_check")
        ),
        "run_citations": has_draft and not casual and tool in ("chatbot", "citation_check"),
        "run_structure": has_draft and tool == "structure_review",
        "run_web": tool in ("web_research", "docgen") and last_user.strip() and tavily_key.strip(),
    }


def _merge_summary(target: ToolRunSummary, partial: ToolRunSummary) -> None:
    if partial.draft_words:
        target.draft_words = partial.draft_words
        target.heading_count = partial.heading_count
        target.paragraph_count = partial.paragraph_count
        target.structure_sections = partial.structure_sections
    if partial.library_files:
        target.library_files = partial.library_files
        target.library_matched = partial.library_matched
        target.library_excerpt_chars = partial.library_excerpt_chars
    if partial.citation_count:
        target.citation_count = partial.citation_count
        target.citation_kinds = partial.citation_kinds
    if partial.web_hits:
        target.web_hits = partial.web_hits


def _library_tool_bundle(
    *,
    data_root: str,
    user_id: str,
    project_id: str,
    last_user: str,
    library_ids: list[str],
) -> tuple[list[ThinkStep], list[str], ToolRunSummary]:
    summary = ToolRunSummary()
    ctx_parts: list[str] = []
    try:
        steps = list(
            _tool_search_library(
                data_root=data_root,
                user_id=user_id,
                project_id=project_id,
                last_user=last_user,
                library_ids=library_ids,
                summary=summary,
                ctx_parts=ctx_parts,
            )
        )
    except Exception:
        steps = [ThinkStep("grep", "Search project library", "failed", phase=PHASE_INVESTIGATE)]
    return steps, ctx_parts, summary


def _web_tool_bundle(
    last_user: str,
    tavily_key: str,
) -> tuple[list[ThinkStep], list[str], ToolRunSummary]:
    summary = ToolRunSummary()
    ctx_parts: list[str] = []
    steps = list(_tool_web_search(last_user, tavily_key, summary, ctx_parts))
    return steps, ctx_parts, summary


def collect_tool_steps(
    *,
    agent_tool: str,
    last_user: str,
    paper_context: str,
    data_root: str,
    user_id: str,
    project_id: str,
    library_ids: list[str],
    use_library: bool,
    tavily_key: str,
) -> tuple[list[ThinkStep], str]:
    """Run tools (library + web in parallel), return trace steps and LLM context."""
    flags = _tool_run_flags(
        agent_tool=agent_tool,
        last_user=last_user,
        paper_context=paper_context,
        data_root=data_root,
        user_id=user_id,
        project_id=project_id,
        library_ids=library_ids,
        use_library=use_library,
        tavily_key=tavily_key,
    )
    tool = flags["tool"]
    summary = ToolRunSummary()
    ctx_parts: list[str] = []
    steps: list[ThinkStep] = []

    if flags["casual"]:
        return steps, ""

    if flags["run_draft"]:
        steps.extend(_tool_read_draft(paper_context, summary))
        draft_ctx = _draft_context(paper_context, summary)
        if draft_ctx:
            ctx_parts.append(draft_ctx)

    if flags["run_structure"]:
        steps.extend(_tool_map_structure(paper_context, summary))

    if flags["run_citations"]:
        steps.extend(_tool_check_citations(paper_context, summary))
        candidates = extract_citation_candidates(paper_context)
        cite_ctx = _citation_context(candidates)
        if cite_ctx:
            ctx_parts.append(cite_ctx)

    parallel_jobs: list[tuple[str, object]] = []
    if flags["run_library"] or flags["run_web"]:
        with ThreadPoolExecutor(max_workers=2) as pool:
            if flags["run_library"]:
                parallel_jobs.append(
                    (
                        "library",
                        pool.submit(
                            _library_tool_bundle,
                            data_root=data_root,
                            user_id=user_id,
                            project_id=project_id,
                            last_user=last_user,
                            library_ids=library_ids,
                        ),
                    )
                )
            if flags["run_web"]:
                parallel_jobs.append(
                    (
                        "web",
                        pool.submit(_web_tool_bundle, last_user, tavily_key),
                    )
                )
            for _name, fut in parallel_jobs:
                job_steps, job_ctx, partial = fut.result()
                steps.extend(job_steps)
                ctx_parts.extend(job_ctx)
                _merge_summary(summary, partial)

    if tool == "outline_plan":
        ctx_parts.append("Return an IMRaD outline with section goals.")

    return steps, "\n\n".join(ctx_parts)


def iter_tool_steps(
    *,
    agent_tool: str,
    last_user: str,
    paper_context: str,
    data_root: str,
    user_id: str,
    project_id: str,
    library_ids: list[str],
    use_library: bool,
    tavily_key: str,
    chat_mode: str = "default",
    message_count: int = 1,
    ctx_out: list[str] | None = None,
) -> Iterator[ThinkStep]:
    """Run real tools; yield each step as the operation completes."""
    flags = _tool_run_flags(
        agent_tool=agent_tool,
        last_user=last_user,
        paper_context=paper_context,
        data_root=data_root,
        user_id=user_id,
        project_id=project_id,
        library_ids=library_ids,
        use_library=use_library,
        tavily_key=tavily_key,
    )
    tool = flags["tool"]
    summary = ToolRunSummary()
    ctx_parts: list[str] = []
    trace_required = requires_thinking_trace(tool, chat_mode)

    if trace_required:
        yield from iter_brief_context_step(agent_tool=tool, chat_mode=chat_mode)

    if flags["casual"] and not trace_required:
        if ctx_out is not None:
            ctx_out.clear()
        return

    if flags["run_draft"]:
        yield from _tool_read_draft(paper_context, summary)
        draft_ctx = _draft_context(paper_context, summary)
        if draft_ctx:
            ctx_parts.append(draft_ctx)

    if flags["run_structure"]:
        yield from _tool_map_structure(paper_context, summary)

    if flags["run_citations"]:
        yield from _tool_check_citations(paper_context, summary)
        candidates = extract_citation_candidates(paper_context)
        cite_ctx = _citation_context(candidates)
        if cite_ctx:
            ctx_parts.append(cite_ctx)

    if flags["run_library"] or flags["run_web"]:
        with ThreadPoolExecutor(max_workers=2) as pool:
            futures: dict[str, object] = {}
            if flags["run_library"]:
                futures["library"] = pool.submit(
                    _library_tool_bundle,
                    data_root=data_root,
                    user_id=user_id,
                    project_id=project_id,
                    last_user=last_user,
                    library_ids=library_ids,
                )
            if flags["run_web"]:
                futures["web"] = pool.submit(_web_tool_bundle, last_user, tavily_key)
            for key in ("library", "web"):
                fut = futures.get(key)
                if fut is None:
                    continue
                job_steps, job_ctx, partial = fut.result()
                yield from job_steps
                ctx_parts.extend(job_ctx)
                _merge_summary(summary, partial)

    if tool == "outline_plan":
        ctx_parts.append("Return an IMRaD outline with section goals.")

    if ctx_out is not None:
        ctx_out.clear()
        ctx_out.append("\n\n".join(ctx_parts))


def respond_step() -> ThinkStep:
    return ThinkStep("write", "Stream response", "", phase=PHASE_RESPOND)