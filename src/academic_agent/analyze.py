from __future__ import annotations

from pathlib import Path

from academic_agent.llm import OpenAICompatibleClient


ANALYSIS_SYSTEM = """You are a meticulous academic writing analyst.
Return concise, actionable analysis in Markdown. Identify structure, argument flow,
methodological claims, evidence quality, missing citations, and revision priorities."""


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
