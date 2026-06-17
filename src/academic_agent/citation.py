from __future__ import annotations

import re
from difflib import SequenceMatcher

from academic_agent.llm import OpenAICompatibleClient
from academic_agent.models import CitationCheck, CitationReviewItem, DocumentCitationReview
from academic_agent.search import AcademicSearcher, normalize_title


class CitationVerifier:
    def __init__(self, searcher: AcademicSearcher | None = None) -> None:
        self.searcher = searcher or AcademicSearcher()

    def verify(self, *, doi: str | None = None, arxiv_id: str | None = None, title: str | None = None) -> CitationCheck:
        if doi:
            paper = self.searcher.by_doi(doi)
            if paper:
                return CitationCheck(query=doi, matched=paper, confidence=0.98, issues=[])
            return CitationCheck(query=doi, confidence=0.0, issues=["DOI was not found in Crossref or OpenAlex."])

        if arxiv_id:
            paper = self.searcher.by_arxiv_id(arxiv_id)
            if paper:
                return CitationCheck(query=arxiv_id, matched=paper, confidence=0.96, issues=[])
            return CitationCheck(query=arxiv_id, confidence=0.0, issues=["arXiv id was not found."])

        if title:
            candidates = self.searcher.search(title, limit=5)
            if not candidates:
                return CitationCheck(query=title, confidence=0.0, issues=["No title match found."])
            query_norm = normalize_title(title)
            scored = [
                (SequenceMatcher(None, query_norm, normalize_title(candidate.title)).ratio(), candidate)
                for candidate in candidates
            ]
            score, paper = max(scored, key=lambda item: item[0])
            issues = []
            if score < 0.85:
                issues.append("Best title match is weak; inspect manually before citing.")
            if not paper.doi and not paper.arxiv_id:
                issues.append("Matched record has no DOI or arXiv id.")
            return CitationCheck(query=title, matched=paper, confidence=round(score, 3), issues=issues)

        raise ValueError("Provide one of doi, arxiv_id, or title.")


# --- Citation extraction and document-wide review (for feature: verify all citations + improvement suggestions) ---

DOI_RE = re.compile(r"\b(10\.\d{4,9}/[-._;()/:A-Z0-9]+)\b", re.IGNORECASE)
ARXIV_RE = re.compile(r"arXiv[:\s]*(\d{4}\.\d{4,5}(?:v\d+)?)", re.IGNORECASE)
# Simple author-year like (Smith et al., 2023) or (Zhang, 2021a)
AUTHOR_YEAR_RE = re.compile(r"\(([A-Z][A-Za-z\-']+(?:\s+(?:et al\.?|and|&)\s+[A-Z][A-Za-z\-']+)?,?\s*\d{4}[a-z]?)\)")
# Bracketed numbers [12] or [3, 5]
BRACKET_REF_RE = re.compile(r"\[(\d{1,3}(?:\s*[,–-]\s*\d{1,3}){0,4})\]")


def extract_citation_candidates(text: str) -> list[dict]:
    """Extract candidate citation references from manuscript text.
    Returns list of dicts: {"raw": str, "kind": str, "query": str}
    """
    candidates: list[dict] = []
    seen: set[str] = set()

    # DOIs (highest precision)
    for m in DOI_RE.finditer(text):
        raw = m.group(0)
        q = raw.strip()
        key = ("doi", q.lower())
        if key not in seen:
            seen.add(key)
            candidates.append({"raw": raw, "kind": "doi", "query": q})

    # arXiv
    for m in ARXIV_RE.finditer(text):
        raw = m.group(0)
        q = m.group(1)
        key = ("arxiv", q.lower())
        if key not in seen:
            seen.add(key)
            candidates.append({"raw": raw, "kind": "arxiv", "query": q})

    # Author-year patterns (use the inner capture as query for title-ish search)
    for m in AUTHOR_YEAR_RE.finditer(text):
        raw = m.group(0)
        inner = m.group(1).strip()
        key = ("author_year", inner.lower())
        if key not in seen:
            seen.add(key)
            candidates.append({"raw": raw, "kind": "author_year", "query": inner})

    # Bracket refs are numeric, less useful alone for lookup unless bib present. Record them for context.
    for m in BRACKET_REF_RE.finditer(text):
        raw = m.group(0)
        nums = m.group(1)
        key = ("bracket", nums)
        if key not in seen:
            seen.add(key)
            candidates.append({"raw": raw, "kind": "bracket", "query": nums})

    # If very few structured hits, try to harvest potential titles from sentences (very heuristic, last resort)
    if len([c for c in candidates if c["kind"] in ("doi", "arxiv", "author_year")]) < 3:
        # Look for quoted titles or obvious paper-like phrases near "et al" or years
        titleish = re.findall(r"[\"“]([A-Z][^\"”]{12,120}?[.!?]?)[\"”]", text)
        for t in titleish[:6]:
            tq = t.strip().rstrip(".,;:")
            key = ("title", tq.lower()[:80])
            if key not in seen:
                seen.add(key)
                candidates.append({"raw": t, "kind": "title", "query": tq[:120]})

    return candidates


class CitationReviewer:
    """Verifies every detectable citation in a document and produces scholarly improvement suggestions
    by cross-referencing academic search results (multi-source, Scholar-like) + LLM synthesis.
    Suggestions are intended for display as floating annotations per-citation and global advice.
    """

    def __init__(
        self,
        *,
        verifier: CitationVerifier | None = None,
        searcher: AcademicSearcher | None = None,
        llm: OpenAICompatibleClient | None = None,
    ) -> None:
        self.verifier = verifier or CitationVerifier()
        self.searcher = searcher or AcademicSearcher()
        self.llm = llm or OpenAICompatibleClient()

    def review(self, text: str, max_candidates: int = 40) -> DocumentCitationReview:
        candidates = extract_citation_candidates(text)[:max_candidates]
        items: list[CitationReviewItem] = []

        for cand in candidates:
            try:
                if cand["kind"] == "bracket":
                    # Brackets alone hard to verify without bibliography; mark as low-value info
                    chk = CitationCheck(query=cand["query"], confidence=0.2, issues=["Numeric reference; full bibliographic entry not resolved from text."])
                    suggestion = "Ensure a complete References section lists all bracketed numbers in order."
                else:
                    if cand["kind"] == "doi":
                        chk = self.verifier.verify(doi=cand["query"])
                    elif cand["kind"] == "arxiv":
                        chk = self.verifier.verify(arxiv_id=cand["query"])
                    else:
                        # author_year or harvested title -> search by title-ish query
                        chk = self.verifier.verify(title=cand["query"])
                    suggestion = self._make_citation_suggestion(cand, chk)
            except Exception as exc:  # defensive
                chk = CitationCheck(query=cand.get("query", ""), confidence=0.0, issues=[f"Verification error: {exc}"])
                suggestion = "Manual verification recommended due to lookup error."
            items.append(
                CitationReviewItem(
                    raw_match=cand["raw"],
                    kind=cand["kind"],
                    query=cand["query"],
                    check=chk,
                    suggestion=suggestion,
                )
            )

        # Overall academic improvement suggestions: consult "Google Scholar equivalent" via multi-source search
        overall = self._generate_overall_suggestions(text, items)

        return DocumentCitationReview(
            citations=items,
            overall_suggestions=overall,
            related_sources_used=len(self.searcher.search(text[:180], limit=5)) if items else 0,
        )

    def _make_citation_suggestion(self, cand: dict, chk: CitationCheck) -> str:
        if chk.matched and chk.confidence >= 0.85:
            base = f"Verified with high confidence against {chk.matched.source.value}."
            if chk.matched.doi or chk.matched.arxiv_id:
                base += f" Preferred cite: {chk.matched.doi or chk.matched.arxiv_id}."
            return base
        if chk.matched:
            return (
                f"Partial/weak match ({chk.confidence}). Consider using exact record: "
                f"{chk.matched.title} ({chk.matched.year or 'n.d.'}). {chk.matched.doi or chk.matched.arxiv_id or ''}. "
                "Cross-check against Google Scholar / publisher page."
            )
        issues = "; ".join(chk.issues) if chk.issues else "No match."
        return f"Could not verify reliably ({issues}). Search Google Scholar for the exact title/DOI and update citation."

    def _generate_overall_suggestions(self, text: str, items: list[CitationReviewItem]) -> str:
        # Derive a compact topic from head of doc
        head = text[:1200].replace("\n", " ")
        # Fetch scholar-like sources: search using head keywords + common terms
        related = self.searcher.search(head[:240], limit=8)
        related_ctx = "\n".join(
            f"- {p.title} ({p.year or 'n.d.'}) {p.doi or p.arxiv_id or ''}" for p in related[:6]
        ) or "No additional sources retrieved."

        verified_summary = "\n".join(
            f"* {it.raw_match}: conf={it.check.confidence} issues={len(it.check.issues)}" for it in items[:12]
        ) or "No structured citations detected."

        prompt = (
            "You are an expert academic reviewer consulting sources similar to Google Scholar results.\n"
            "Given the manuscript excerpt and currently detected/verified citations + related high-quality sources, "
            "produce 5-10 concrete, actionable academic improvement suggestions for the paper. "
            "Focus on: citation accuracy/strength, missing seminal or recent works, literature review gaps, "
            "argument support, methodological rigor, counter-arguments, clarity of claims, and future work. "
            "Be specific and cite the source titles where relevant. Return as a Markdown bulleted list.\n\n"
            f"Manuscript head:\n{head}\n\n"
            f"Verified citation summary:\n{verified_summary}\n\n"
            f"Related sources (from academic search):\n{related_ctx}\n\n"
            "Suggestions:"
        )
        try:
            suggestions = self.llm.chat(
                [
                    {"role": "system", "content": "Provide rigorous, citation-grounded revision advice in Markdown."},
                    {"role": "user", "content": prompt},
                ],
                temperature=0.2,
            )
            return suggestions.strip()
        except Exception:
            return "Unable to synthesize LLM suggestions at this time. Manually compare all citations to Google Scholar results and strengthen with 2-3 additional recent high-impact references from the search results."
