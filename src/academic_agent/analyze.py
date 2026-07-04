from __future__ import annotations

from pathlib import Path

from academic_agent.llm import OpenAICompatibleClient


ANALYSIS_SYSTEM = """You are a meticulous academic writing analyst.
Return concise, actionable analysis in Markdown. Identify structure, argument flow,
methodological claims, evidence quality, missing citations, and revision priorities."""

STRUCTURE_SYSTEM = """You are Joeku, an academic writing coach.
After the user finishes a draft, explain the paper clearly in the user's language (match the draft).
Use Markdown with these sections:
## 结构概览
## 论点与章节分工
## 引用与证据评价
## 可执行的改进建议（3–5 条）
Be specific, constructive, and refer to section headings in the draft."""


class StructureAnalyzer:
    def __init__(self, llm: OpenAICompatibleClient | None = None) -> None:
        self.llm = llm or OpenAICompatibleClient()

    def analyze_text(self, text: str) -> str:
        clipped = text[:45000]
        return self.llm.chat(
            [
                {"role": "system", "content": ANALYSIS_SYSTEM},
                {
                    "role": "user",
                    "content": (
                        "Analyze the following academic manuscript or outline. "
                        "Use these headings: Overview, Likely Research Question, Thesis, Section Map, "
                        "Evidence and Citation Gaps, Structural Risks, Revision Plan.\n\n"
                        f"{clipped}"
                    ),
                },
            ],
            temperature=0.15,
        )

    def analyze_file(self, path: Path) -> str:
        return self.analyze_text(path.read_text(encoding="utf-8"))

    def analyze_structure(self, text: str, *, topic: str = "") -> str:
        clipped = text[:50000]
        topic_line = f"Topic: {topic}\n\n" if topic.strip() else ""
        return self.llm.chat(
            [
                {"role": "system", "content": STRUCTURE_SYSTEM},
                {
                    "role": "user",
                    "content": (
                        f"{topic_line}Analyze this completed academic draft. "
                        "Summarize structure and give concrete next-step revision advice.\n\n"
                        f"{clipped}"
                    ),
                },
            ],
            temperature=0.25,
            max_tokens=4096,
        )
