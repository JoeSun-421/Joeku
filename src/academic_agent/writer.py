from __future__ import annotations

import math
import re
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
import threading

from pydantic import ValidationError

from academic_agent.citation_formats import (
    citation_format_instruction,
    render_references_formatted,
    strip_embedded_reference_sections,
)
from academic_agent.knowledge_base import retrieve_snippets
from academic_agent.llm import OpenAICompatibleClient, compact_sources
from academic_agent.models import Paper, PaperPlan, SectionPlan, SourceName
from academic_agent.scholar_query import english_scholar_queries
from academic_agent.search import AcademicSearcher, dedupe_papers
from academic_agent.word_count import count_body_words, count_words, estimate_max_tokens, within_tolerance


ProgressCallback = Callable[..., None]
PreviewCallback = Callable[[str], None]

LANGUAGE_INSTRUCTIONS: dict[str, str] = {
    "zh": "Write the entire paper in Simplified Chinese (简体中文).",
    "en": "Write the entire paper in English.",
    "ja": "Write the entire paper in Japanese (日本語).",
    "de": "Write the entire paper in German (Deutsch).",
    "fr": "Write the entire paper in French (Français).",
    "es": "Write the entire paper in Spanish (Español).",
    "ko": "Write the entire paper in Korean (한국어).",
}

PLANNER_SYSTEM = """Academic planner. Output JSON only: title, thesis, target_words, sections.
Each section: heading, target_words, purpose, evidence_queries."""

WRITER_SYSTEM = """You are a university-level academic writer producing coursework/thesis-quality papers.
Rules:
1) Follow the citation format rules exactly (APA 7 / MLA 9 / Chicago / IEEE as specified) — these match typical university requirements.
2) Use ONLY numbered English sources provided — never invent citations, authors, years, or URLs.
3) EVERY argumentative paragraph needs ≥1 in-text citation; introduction and conclusion included.
4) Do NOT cite the same source twice in one paragraph unless comparing; diversify references across sections.
5) Prefer peer-reviewed, higher-citation sources for core claims; use others for context.
6) Write in the requested output language; source metadata stays in English.
7) End with a properly formatted reference list matching every in-text citation (alphabetical or numeric per style).
8) NEVER include a References / Works Cited / Bibliography section — it is added automatically.
9) NEVER put http(s) URLs or markdown links in in-text citations or body paragraphs.
10) Do not use bullet lists in body text unless the section purpose requires it; write in full paragraphs."""

DE_AI_SYSTEM = """Revise text to read naturally human-authored academic prose.
Remove AI clichés (综上所述/值得注意的是/in conclusion it is important).
Keep all citations, headings, and facts unchanged. Return full Markdown."""

_SECTION_HEADING_LINE = re.compile(r"^#{1,3}\s+(.+?)\s*$")


def _heading_key(text: str) -> str:
    return re.sub(r"\s+", " ", text.strip().lower())


def _strip_leading_duplicate_headings(content: str, heading: str) -> str:
    """Remove LLM-written ##/### lines that repeat the planned section title."""
    text = content.strip()
    if not text:
        return ""
    key = _heading_key(heading)
    while text:
        lines = text.splitlines()
        first = lines[0].strip()
        if not first:
            text = "\n".join(lines[1:]).lstrip("\n")
            continue
        match = _SECTION_HEADING_LINE.match(first)
        if match:
            title_key = _heading_key(match.group(1))
        else:
            title_key = _heading_key(first)
        if title_key == key or (
            len(key) > 6 and (title_key in key or key in title_key)
        ):
            text = "\n".join(lines[1:]).lstrip("\n")
            continue
        break
    return text.strip()


def _dedupe_consecutive_headings(text: str) -> str:
    """Drop back-to-back identical markdown headings inside section body."""
    lines = text.splitlines()
    out: list[str] = []
    prev_key: str | None = None
    for line in lines:
        stripped = line.strip()
        match = _SECTION_HEADING_LINE.match(stripped)
        if match:
            key = _heading_key(match.group(1))
            if key == prev_key:
                continue
            prev_key = key
        else:
            prev_key = None
        out.append(line)
    return "\n".join(out).strip()


def format_section_markdown(content: str, heading: str) -> str:
    body = _dedupe_consecutive_headings(_strip_leading_duplicate_headings(content, heading))
    if body:
        return f"## {heading}\n\n{body}"
    return f"## {heading}"


class LongFormWriter:
    def __init__(
        self,
        *,
        llm: OpenAICompatibleClient | None = None,
        searcher: AcademicSearcher | None = None,
        max_parallel_sections: int = 4,
    ) -> None:
        self.llm = llm or OpenAICompatibleClient()
        self.searcher = searcher or AcademicSearcher()
        self.max_parallel_sections = max(1, min(max_parallel_sections, 4))

    def write(
        self,
        topic: str,
        *,
        target_words: int,
        search_limit: int = 12,
        citation_limit: int = 15,
        language: str = "zh",
        citation_format: str = "apa7",
        requirements: str = "",
        library_context: str = "",
        fast_mode: bool = False,
        web_search: bool = True,
        tavily_key: str = "",
        de_ai: bool = False,
        deep_quality: bool = False,
        output_path: Path | None = None,
        on_progress: ProgressCallback | None = None,
        on_preview: PreviewCallback | None = None,
    ) -> str:
        if target_words < 300 or target_words > 30000:
            raise ValueError("target_words must be between 300 and 30000.")
        citation_limit = max(0, min(citation_limit, 80))
        lang = language if language in LANGUAGE_INSTRUCTIONS else "zh"
        cite_fmt = citation_format if citation_format in ("bracket", "apa7", "mla9", "chicago", "ieee", "gbt7714") else "apa7"
        req = requirements.strip()
        lib_ctx = library_context.strip()
        if lib_ctx:
            req = (req + "\n\nUser-provided reference materials (cite as user sources when relevant):\n" + lib_ctx).strip()

        def report(step: str, percent: int, message: str, **meta: object) -> None:
            if on_progress:
                on_progress(step, percent, message, **meta)

        kb_hint = "" if fast_mode else (retrieve_snippets(topic) if deep_quality else retrieve_snippets(topic, limit=2))

        report("search", 6, "检索 Google Scholar 级英文文献…")
        if fast_mode:
            scholar_queries = [topic] if (citation_limit > 0 or search_limit > 0) else []
        else:
            scholar_queries = english_scholar_queries(topic, llm=self.llm) if citation_limit > 0 or search_limit > 0 else []
        if search_limit > 0:
            papers = self.searcher.search(
                topic,
                limit=search_limit,
                tavily_key=tavily_key,
                web_search=web_search,
                extra_queries=scholar_queries[1:] if len(scholar_queries) > 1 else None,
            )
            papers = [p for p in papers if p.source != SourceName.TAVILY]
            papers = dedupe_papers(papers)
        else:
            papers = []
        ref_papers = papers[:citation_limit] if citation_limit > 0 else []
        if not fast_mode and citation_limit > 0 and len(ref_papers) < min(5, citation_limit):
            report("search", 10, f"英文文献较少（{len(ref_papers)} 篇），正在扩大检索…")
            backup = self.searcher.search(
                scholar_queries[0] if scholar_queries else topic,
                limit=max(search_limit, citation_limit + 8),
                tavily_key="",
                web_search=False,
            )
            backup = [p for p in backup if p.source != SourceName.TAVILY]
            papers = dedupe_papers(papers + backup)
            ref_papers = papers[:citation_limit]

        report("plan", 18, "规划论文结构…")
        plan = self.plan(
            topic,
            target_words=target_words,
            papers=ref_papers or papers,
            language=lang,
            citation_format=cite_fmt,
            requirements=req,
            fast_mode=fast_mode,
            kb_hint=kb_hint,
        )

        sections_plan = [{"heading": sec.heading, "status": "pending"} for sec in plan.sections]
        outline = " · ".join(sec.heading for sec in plan.sections[:6])
        if len(plan.sections) > 6:
            outline += f" …共 {len(plan.sections)} 节"
        report(
            "plan",
            22,
            f"结构已定 · {outline}",
            sections_plan=sections_plan,
            section_current="",
        )

        if on_preview:
            on_preview(f"# {plan.title}\n\n*正在撰写…*\n")

        report(
            "write",
            28,
            f"开始撰写 · 共 {len(plan.sections)} 节",
            sections_plan=sections_plan,
            section_current=plan.sections[0].heading if plan.sections else "",
        )
        sections = self._write_sections_parallel(
            plan,
            ref_papers or papers,
            language=lang,
            citation_format=cite_fmt,
            kb_hint=kb_hint,
            fast_mode=fast_mode,
            on_progress=report,
            on_preview=on_preview,
        )

        body_text = "\n\n".join(sections)
        body_words = count_words(body_text)
        report("adjust", 82, f"字数校准：当前 {body_words} / 目标 {target_words}")

        if fast_mode:
            report("adjust", 86, f"快速模式 · 保留 {body_words} 词（目标 {target_words}）")
        elif target_words > 800:
            sections, body_text = self._enforce_word_count(
                plan, sections, target_words, papers, lang, cite_fmt, report
            )
        elif not within_tolerance(body_words, target_words):
            report("adjust", 86, f"短篇跳过精调，保留 {body_words} 词")

        sections = [strip_embedded_reference_sections(s) for s in sections]
        body_text = "\n\n".join(sections)

        report("references", 92, "整理参考文献…")
        references = render_references_formatted(ref_papers, cite_fmt)

        checks = ""
        if deep_quality and not fast_mode:
            report("check", 96, "深度质量检查…")
            try:
                checks = self.final_check(plan, body_text, ref_papers or papers, language=lang)
            except RuntimeError:
                checks = ""

        document = render_document(plan, sections, references, checks, target_words=target_words)

        if de_ai:
            report("polish", 98, "去 AI 化润色…")
            document = self._de_ai_pass(document, lang)
        if on_preview:
            on_preview(document)
        if output_path:
            output_path.write_text(document, encoding="utf-8")

        final_words = count_body_words("\n\n".join(sections))
        report("done", 100, f"生成完成 · 正文 {final_words} 词（目标 {target_words}，参考文献不计入）")
        return document

    def plan(
        self,
        topic: str,
        *,
        target_words: int,
        papers: list[Paper],
        language: str = "zh",
        citation_format: str = "apa7",
        requirements: str = "",
        fast_mode: bool = False,
        kb_hint: str = "",
    ) -> PaperPlan:
        source_context = compact_sources(papers, limit=12, citation_format=citation_format)
        lang_note = LANGUAGE_INSTRUCTIONS.get(language, LANGUAGE_INSTRUCTIONS["zh"])
        if target_words < 1200:
            section_hint = "2-3"
        elif fast_mode:
            section_hint = "3-5"
        else:
            section_hint = "6-12"
        req_block = f"\nUser requirements document:\n{requirements[:12000]}\n" if requirements else ""
        raw = self.llm.json_chat(
            [
                {"role": "system", "content": PLANNER_SYSTEM},
                {
                    "role": "user",
                    "content": (
                        f"Topic: {topic}\nTarget words: {target_words}\n"
                        f"Reference count: ~{len(papers)}\nLanguage: {lang_note}\n"
                        f"Writing hints:\n{kb_hint}\n{req_block}\nSources:\n{source_context}\n\n"
                        f"Return JSON with keys title, thesis, target_words, sections. "
                        f"sections: list of {section_hint} objects with heading, target_words, purpose, evidence_queries. "
                        f"Section target_words MUST sum to exactly {target_words}. "
                        "Honor all user requirements when planning structure and emphasis."
                    ),
                },
            ]
        )
        try:
            plan = PaperPlan.model_validate(raw)
        except ValidationError:
            plan = fallback_plan(topic, target_words, fast_mode=fast_mode)
        return rebalance_plan(plan, target_words)

    def _write_sections_parallel(
        self,
        plan: PaperPlan,
        papers: list[Paper],
        *,
        language: str,
        citation_format: str,
        kb_hint: str = "",
        fast_mode: bool = False,
        on_progress: ProgressCallback | None = None,
        on_preview: PreviewCallback | None = None,
    ) -> list[str]:
        total = len(plan.sections)
        results: dict[int, str] = {}
        statuses = ["pending"] * total
        lock = threading.Lock()

        def plan_snapshot() -> list[dict[str, str]]:
            return [
                {"heading": plan.sections[i].heading, "status": statuses[i]}
                for i in range(total)
            ]

        def emit_write_progress(*, done: int, current: str) -> None:
            if not on_progress:
                return
            pct = 28 + int(52 * done / total) if total else 28
            writing = [plan.sections[i].heading for i, s in enumerate(statuses) if s == "writing"]
            label = current or (writing[0] if writing else "")
            if writing and len(writing) > 1:
                msg = f"撰写中 · {' / '.join(writing[:3])}（{len(writing)} 路并行）"
            elif label:
                msg = f"撰写中 · {label}（{done}/{total}）"
            else:
                msg = f"撰写中（{done}/{total}）"
            on_progress(
                "write",
                pct,
                msg,
                section_current=label,
                sections_plan=plan_snapshot(),
            )

        def task(index: int, section: SectionPlan) -> tuple[int, str]:
            with lock:
                statuses[index] = "writing"
                emit_write_progress(done=sum(1 for s in statuses if s == "done"), current=section.heading)
            relevant = self._select_relevant_sources(section, papers)
            text = self.write_section(
                plan,
                section,
                relevant,
                language=language,
                citation_format=citation_format,
                kb_hint=kb_hint,
                fast_mode=fast_mode,
                used_keys=set(),
            )
            return index, text

        with ThreadPoolExecutor(max_workers=self.max_parallel_sections) as pool:
            futures = {
                pool.submit(task, i, sec): i for i, sec in enumerate(plan.sections)
            }
            done = 0
            for fut in as_completed(futures):
                idx, text = fut.result()
                results[idx] = text
                with lock:
                    statuses[idx] = "done"
                    done += 1
                    next_writing = next(
                        (plan.sections[i].heading for i, s in enumerate(statuses) if s == "writing"),
                        "",
                    )
                    emit_write_progress(done=done, current=next_writing)
                    if on_progress and done == total:
                        on_progress(
                            "write",
                            80,
                            f"全部章节完成 · {total}/{total}",
                            section_current="",
                            sections_plan=plan_snapshot(),
                        )
                if on_preview:
                    ordered = [results[i] for i in sorted(results.keys())]
                    on_preview(f"# {plan.title}\n\n**Thesis:** {plan.thesis}\n\n" + "\n\n".join(ordered))

        return [results[i] for i in range(total)]

    def write_section(
        self,
        plan: PaperPlan,
        section: SectionPlan,
        papers: list[Paper],
        *,
        language: str = "zh",
        citation_format: str = "apa7",
        kb_hint: str = "",
        fast_mode: bool = False,
        used_keys: set[str] | None = None,
    ) -> str:
        source_limit = 5 if fast_mode else 8
        source_context = compact_sources(papers, limit=source_limit, citation_format=citation_format)
        lang_note = LANGUAGE_INSTRUCTIONS.get(language, LANGUAGE_INSTRUCTIONS["zh"])
        cite_note = citation_format_instruction(citation_format)
        avoid = ", ".join(sorted(used_keys or [])) or "none"
        min_w = max(int(section.target_words * 0.92), section.target_words - 80)
        max_w = int(section.target_words * 1.08)
        content = self.llm.chat(
            [
                {"role": "system", "content": WRITER_SYSTEM},
                {
                    "role": "user",
                    "content": (
                        f"Paper: {plan.title}\nThesis: {plan.thesis}\n"
                        f"Section: {section.heading}\nPurpose: {section.purpose}\n"
                        f"Word count: {min_w}-{max_w} (target {section.target_words}).\n"
                        f"Language: {lang_note}\nIn-text format: {cite_note}\n"
                        f"Already used source keys (avoid reusing in same paragraph): {avoid}\n"
                        f"Style hints:\n{kb_hint}\n"
                        f"Numbered sources (cite by [n]):\n{source_context}\n\n"
                        "Write body paragraphs only — do NOT include the section heading (##); "
                        "it is added automatically. Use ### only for true subsections inside this section. "
                        "Each paragraph needs in-text citations. "
                        "Do NOT add a References/Works Cited section."
                    ),
                },
            ],
            temperature=0.3,
            max_tokens=estimate_max_tokens(section.target_words),
        )
        return format_section_markdown(content, section.heading)

    def _enforce_word_count(
        self,
        plan: PaperPlan,
        sections: list[str],
        target_words: int,
        papers: list[Paper],
        language: str,
        citation_format: str,
        on_progress: ProgressCallback | None,
    ) -> tuple[list[str], str]:
        body = "\n\n".join(sections)
        actual = count_words(body)
        if within_tolerance(actual, target_words):
            return sections, body

        for attempt in range(2):
            actual = count_words("\n\n".join(sections))
            if within_tolerance(actual, target_words):
                break
            gap = target_words - actual
            if on_progress:
                on_progress("adjust", 85 + attempt * 4, f"字数调整第 {attempt + 1} 轮：{actual} → {target_words}")

            try:
                if gap > 0:
                    sections = self._expand_sections(plan, sections, gap, language, citation_format)
                else:
                    sections = self._trim_sections(sections, target_words, language)
            except RuntimeError:
                if within_tolerance(count_words("\n\n".join(sections)), target_words):
                    break
                if target_words <= 1200:
                    break

        return sections, "\n\n".join(sections)

    def _expand_sections(
        self,
        plan: PaperPlan,
        sections: list[str],
        gap: int,
        language: str,
        citation_format: str,
    ) -> list[str]:
        lang_note = LANGUAGE_INSTRUCTIONS.get(language, LANGUAGE_INSTRUCTIONS["zh"])
        cite_note = citation_format_instruction(citation_format)
        idx = max(range(len(sections)), key=lambda i: count_words(sections[i]))
        heading = plan.sections[idx].heading if idx < len(plan.sections) else "Section"
        expanded = self.llm.chat(
            [
                {"role": "system", "content": WRITER_SYSTEM},
                {
                    "role": "user",
                    "content": (
                        f"Expand the following section by approximately {gap} words while preserving quality.\n"
                        f"Language: {lang_note}\nCitation format: {cite_note}\n"
                        f"Keep heading ## {heading}\n\n{sections[idx]}"
                    ),
                },
            ],
            temperature=0.25,
            max_tokens=estimate_max_tokens(gap + count_words(sections[idx])),
        )
        out = list(sections)
        out[idx] = format_section_markdown(expanded, heading)
        return out

    def _trim_sections(self, sections: list[str], target_words: int, language: str) -> list[str]:
        lang_note = LANGUAGE_INSTRUCTIONS.get(language, LANGUAGE_INSTRUCTIONS["zh"])
        joined = "\n\n".join(sections)
        trimmed = self.llm.chat(
            [
                {"role": "system", "content": "You trim academic drafts to a strict word budget without losing key arguments."},
                {
                    "role": "user",
                    "content": (
                        f"Reduce this paper body to approximately {target_words} words.\n"
                        f"Language: {lang_note}\nKeep all section headings (##).\n\n{joined[:80000]}"
                    ),
                },
            ],
            temperature=0.1,
            max_tokens=max(estimate_max_tokens(target_words), 2048),
        )
        if "##" in trimmed:
            parts = [p.strip() for p in trimmed.split("\n## ") if p.strip()]
            return [parts[0] if parts[0].startswith("##") else f"## {parts[0]}"] + [
                f"## {p}" if not p.startswith("##") else p for p in parts[1:]
            ]
        return sections

    def _de_ai_pass(self, document: str, language: str) -> str:
        lang_note = LANGUAGE_INSTRUCTIONS.get(language, LANGUAGE_INSTRUCTIONS["zh"])
        try:
            return self.llm.chat(
                [
                    {"role": "system", "content": DE_AI_SYSTEM},
                    {"role": "user", "content": f"Language: {lang_note}\n\n{document[:90000]}"},
                ],
                temperature=0.35,
                max_tokens=min(estimate_max_tokens(count_words(document)) + 512, 12000),
            )
        except RuntimeError:
            return document

    def final_check(self, plan: PaperPlan, draft: str, papers: list[Paper], *, language: str = "zh") -> str:
        lang_note = LANGUAGE_INSTRUCTIONS.get(language, LANGUAGE_INSTRUCTIONS["zh"])
        return self.llm.chat(
            [
                {"role": "system", "content": "You are an academic QA reviewer. Be brief."},
                {
                    "role": "user",
                    "content": (
                        f"Draft ({count_words(draft)} words):\n{draft[:30000]}\n\n"
                        f"Language: {lang_note}. Return a short Markdown checklist (max 12 bullets)."
                    ),
                },
            ],
            temperature=0.1,
            max_tokens=800,
        )

    @staticmethod
    def _select_relevant_sources(section: SectionPlan, papers: list[Paper]) -> list[Paper]:
        if not section.evidence_queries:
            return papers[:6]
        query_words = " ".join(section.evidence_queries + [section.heading, section.purpose]).lower().split()
        scored = []
        for paper in papers:
            haystack = f"{paper.title} {paper.abstract or ''}".lower()
            score = sum(1 for word in query_words if len(word) > 2 and word in haystack)
            scored.append((score, paper))
        picked = [p for _, p in sorted(scored, key=lambda x: x[0], reverse=True)[:6] if _ > 0]
        return picked or papers[:6]


def fallback_plan(topic: str, target_words: int, *, fast_mode: bool = False) -> PaperPlan:
    if target_words < 1200:
        headings = ["引言", "正文", "结论"]
    elif fast_mode:
        headings = ["Introduction", "Background", "Analysis", "Discussion", "Conclusion"]
    else:
        headings = [
            "Introduction",
            "Background and Related Work",
            "Research Problem and Framework",
            "Evidence and Analysis",
            "Implications",
            "Limitations",
            "Conclusion",
        ]
    base = math.floor(target_words / len(headings))
    sections = [
        SectionPlan(
            heading=h,
            target_words=base,
            purpose=f"Develop {h.lower()} for: {topic}.",
            evidence_queries=[topic, h],
        )
        for h in headings
    ]
    return PaperPlan(title=topic.title(), thesis=f"This paper examines {topic}.", target_words=target_words, sections=sections)


def rebalance_plan(plan: PaperPlan, target_words: int) -> PaperPlan:
    if not plan.sections:
        return fallback_plan(plan.title, target_words)
    current = sum(max(1, s.target_words) for s in plan.sections)
    factor = target_words / current
    sections = [
        s.model_copy(update={"target_words": max(200, int(s.target_words * factor))})
        for s in plan.sections
    ]
    delta = target_words - sum(s.target_words for s in sections)
    sections[-1] = sections[-1].model_copy(
        update={"target_words": max(200, sections[-1].target_words + delta)}
    )
    return plan.model_copy(update={"target_words": target_words, "sections": sections})


def render_document(
    plan: PaperPlan,
    sections: list[str],
    references: str,
    checks: str,
    *,
    target_words: int,
) -> str:
    body_words = count_words("\n\n".join(sections))
    meta = f"**Words:** {body_words}（正文，不含参考文献；目标 {target_words}） · **Thesis:** {plan.thesis}"
    ref_block = references if references.strip().startswith("##") else f"## References\n\n{references}"
    doc = f"# {plan.title}\n\n{meta}\n\n{chr(10).join(sections)}\n\n{ref_block}\n"
    if checks.strip():
        doc += f"\n## Verification Checklist\n\n{checks.strip()}\n"
    return doc