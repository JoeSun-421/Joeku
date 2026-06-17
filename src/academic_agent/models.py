from __future__ import annotations

from enum import Enum
from typing import Any

from pydantic import BaseModel, Field, HttpUrl


class SourceName(str, Enum):
    OPENALEX = "openalex"
    SEMANTIC_SCHOLAR = "semantic_scholar"
    CROSSREF = "crossref"
    ARXIV = "arxiv"
    TAVILY = "tavily"


class Paper(BaseModel):
    title: str
    authors: list[str] = Field(default_factory=list)
    year: int | None = None
    abstract: str | None = None
    doi: str | None = None
    arxiv_id: str | None = None
    url: HttpUrl | str | None = None
    venue: str | None = None
    citation_count: int | None = None
    source: SourceName
    source_id: str | None = None
    raw: dict[str, Any] = Field(default_factory=dict)

    @property
    def citation_key(self) -> str:
        author = self.authors[0].split()[-1].lower() if self.authors else "unknown"
        year = self.year or "nd"
        words = "".join(ch for ch in self.title.lower() if ch.isalnum() or ch.isspace()).split()
        slug = "".join(words[:2]) or "paper"
        return f"{author}{year}{slug}"


class CitationCheck(BaseModel):
    query: str
    matched: Paper | None = None
    confidence: float
    issues: list[str] = Field(default_factory=list)


class SectionPlan(BaseModel):
    heading: str
    target_words: int
    purpose: str
    evidence_queries: list[str] = Field(default_factory=list)


class PaperPlan(BaseModel):
    title: str
    thesis: str
    target_words: int
    sections: list[SectionPlan]


class CitationReviewItem(BaseModel):
    raw_match: str
    kind: str  # "doi" | "arxiv" | "title" | "author_year"
    query: str
    check: CitationCheck
    suggestion: str = ""


class DocumentCitationReview(BaseModel):
    citations: list[CitationReviewItem] = Field(default_factory=list)
    overall_suggestions: str = ""
    related_sources_used: int = 0
