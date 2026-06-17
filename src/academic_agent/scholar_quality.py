from __future__ import annotations

import re
from urllib.parse import quote_plus

from academic_agent.models import Paper, SourceName

_CJK = re.compile(r"[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]")
_LATIN_RATIO = re.compile(r"[A-Za-z]")


def is_english_scholarly(paper: Paper) -> bool:
    title = paper.title or ""
    if _CJK.search(title):
        return False
    if _CJK.search(paper.abstract or ""):
        return False
    letters = len(_LATIN_RATIO.findall(title))
    if letters < max(8, len(title) * 0.45):
        return False
    if not paper.abstract or len(paper.abstract.strip()) < 60:
        return False
    return True


def paper_link(paper: Paper) -> str:
    if paper.doi:
        return f"https://doi.org/{paper.doi}"
    if paper.url:
        return str(paper.url)
    if paper.arxiv_id:
        return f"https://arxiv.org/abs/{paper.arxiv_id}"
    return scholar_url(paper)


def scholar_url(paper: Paper) -> str:
    q = quote_plus(paper.title)
    if paper.authors:
        q = quote_plus(f"{paper.title} {paper.authors[0]}")
    return f"https://scholar.google.com/scholar?hl=en&q={q}"


def quality_rank(paper: Paper) -> int:
    score = 0
    if paper.source == SourceName.SEMANTIC_SCHOLAR:
        score += 12
    if paper.source == SourceName.OPENALEX:
        score += 8
    if paper.doi:
        score += 10
    if paper.abstract:
        score += 6
    cites = paper.citation_count or 0
    score += min(cites, 500) // 5
    if paper.venue:
        score += 3
    return score


def is_scholarly_source(paper: Paper) -> bool:
    return paper.source in {
        SourceName.SEMANTIC_SCHOLAR,
        SourceName.OPENALEX,
        SourceName.CROSSREF,
        SourceName.ARXIV,
    }


def filter_scholar_quality(papers: list[Paper], *, min_citations: int = 5) -> list[Paper]:
    filtered: list[Paper] = []
    for p in papers:
        if not is_scholarly_source(p):
            continue
        if not is_english_scholarly(p):
            continue
        cites = p.citation_count or 0
        if cites < min_citations and p.source not in {SourceName.ARXIV, SourceName.SEMANTIC_SCHOLAR}:
            continue
        if p.source == SourceName.CROSSREF and cites < 3 and not p.doi:
            continue
        filtered.append(p)
    filtered.sort(key=quality_rank, reverse=True)
    return filtered