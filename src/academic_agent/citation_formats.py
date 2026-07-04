from __future__ import annotations

import re

from academic_agent.models import Paper
from academic_agent.scholar_quality import paper_link, scholar_url

# University-standard citation rules (APA 7, MLA 9, Chicago, IEEE)
UNIVERSITY_CITATION_RULES = """
University citation standards (apply strictly):
1) Every factual or argumentative claim from a source MUST have an in-text citation.
2) Use ONLY the provided numbered sources; never invent authors, years, DOIs, or URLs.
3) In-text citations must follow the selected style exactly — never paste raw URLs in body paragraphs.
4) Do NOT write a References / Works Cited / Bibliography section — it is appended automatically.
5) Paraphrase in your own words; direct quotes need quotation marks and page numbers when available.
"""

CITATION_FORMATS: dict[str, dict[str, str]] = {
    "bracket": {
        "label": "Bracket [AuthorYear]",
        "in_text": (
            "Use bracket keys matching the source list, e.g. [Smith2024]. "
            "Multiple sources: [Smith2024; Lee2023]. No URLs in body text."
        ),
        "reference_style": "bracket",
    },
    "apa7": {
        "label": "APA 7th (Author, Year)",
        "in_text": (
            "APA 7th in-text ONLY (no URLs in body):\n"
            "- One author: (Smith, 2024) or Smith (2024).\n"
            "- Two authors: (Smith & Jones, 2024).\n"
            "- Three or more: (Smith et al., 2024).\n"
            "- Multiple works: (Jones, 2023; Smith, 2024) alphabetical.\n"
            "- Map each [n] source to (Surname, Year) using Authors/Year in the source list.\n"
            "- Direct quote: (Smith, 2024, p. 12) only when page is known."
        ),
        "reference_style": "apa7",
    },
    "mla9": {
        "label": "MLA 9th",
        "in_text": (
            "MLA 9th in-text: (Author Page) e.g. (Smith 45). Two authors: (Smith and Jones 45). "
            "Three+: (Smith et al. 45). No URLs in body."
        ),
        "reference_style": "mla9",
    },
    "chicago": {
        "label": "Chicago (Author-Date)",
        "in_text": (
            "Chicago author-date in-text: (Smith 2024, 45) or (Smith 2024, 45–47). No URLs in body."
        ),
        "reference_style": "chicago",
    },
    "ieee": {
        "label": "IEEE [n]",
        "in_text": (
            "IEEE numeric in-text: [1], [2] in order of first use. Reuse the same number for the same source."
        ),
        "reference_style": "ieee",
    },
}


def citation_format_instruction(fmt: str) -> str:
    spec = CITATION_FORMATS.get(fmt, CITATION_FORMATS["apa7"])
    return f"{UNIVERSITY_CITATION_RULES.strip()}\n\nFormat-specific rules:\n{spec['in_text']}"


def _surname(author: str) -> str:
    last, _ = _parse_author_name(author)
    return last or "Unknown"


def _sort_key_author(authors: list[str]) -> str:
    return _surname(authors[0]).lower() if authors else "unknown"


def _parse_author_name(author: str) -> tuple[str, str]:
    author = author.strip()
    if "," in author:
        last, first = author.split(",", 1)
        return last.strip(), first.strip()
    parts = author.split()
    if len(parts) <= 1:
        return author, ""
    return parts[-1], " ".join(parts[:-1])


def _apa_one_author(author: str) -> str:
    last, first = _parse_author_name(author)
    if not first:
        return last
    initials = ". ".join(w[0].upper() for w in first.split() if w) + "."
    return f"{last}, {initials}"


def _apa_author_list(authors: list[str]) -> str:
    if not authors:
        return "Unknown author"
    if len(authors) == 1:
        return _apa_one_author(authors[0])
    if len(authors) == 2:
        return f"{_apa_one_author(authors[0])}, & {_apa_one_author(authors[1])}"
    if len(authors) <= 20:
        head = ", ".join(_apa_one_author(a) for a in authors[:-1])
        return f"{head}, & {_apa_one_author(authors[-1])}"
    head = ", ".join(_apa_one_author(a) for a in authors[:19])
    return f"{head}, ... {_apa_one_author(authors[-1])}"


def _canonical_url(paper: Paper) -> str:
    if paper.doi:
        doi = str(paper.doi).strip().removeprefix("https://doi.org/").removeprefix("http://doi.org/")
        return f"https://doi.org/{doi}"
    link = paper_link(paper)
    if link.startswith("http"):
        return link
    return scholar_url(paper)


def _format_reference_apa(paper: Paper) -> str:
    authors = _apa_author_list(paper.authors)
    year = paper.year if paper.year else "n.d."
    title = paper.title.strip().rstrip(".")
    venue = (paper.venue or "").strip()
    url = _canonical_url(paper)
    if venue:
        return f"{authors} ({year}). {title}. *{venue}*. {url}"
    return f"{authors} ({year}). {title}. {url}"


def _format_reference_mla(paper: Paper) -> str:
    authors = ", ".join(paper.authors[:2]) if paper.authors else "Unknown author"
    if len(paper.authors or []) > 2:
        authors += ", et al."
    title = paper.title.strip().rstrip(".")
    venue = (paper.venue or "").strip()
    year = paper.year or "n.d."
    url = _canonical_url(paper)
    if venue:
        return f'{authors}. "{title}." *{venue}*, {year}, {url}.'
    return f'{authors}. "{title}." {year}, {url}.'


def _format_reference_chicago(paper: Paper) -> str:
    authors = ", ".join(paper.authors[:6]) if paper.authors else "Unknown author"
    year = paper.year or "n.d."
    title = paper.title.strip().rstrip(".")
    venue = (paper.venue or "").strip()
    url = _canonical_url(paper)
    if venue:
        return f"{authors}. {year}. \"{title}.\" *{venue}*. {url}"
    return f"{authors}. {year}. \"{title}.\" {url}"


def _format_reference_ieee(paper: Paper, index: int) -> str:
    authors = ", ".join(paper.authors[:6]) if paper.authors else "Unknown author"
    year = paper.year or "n.d."
    title = paper.title.strip().rstrip(".")
    venue = (paper.venue or "").strip()
    url = _canonical_url(paper)
    venue_part = f" *{venue}*," if venue else ""
    return f"[{index}] {authors}, \"{title},\"{venue_part} {year}. {url}"


def _format_reference_bracket(paper: Paper) -> str:
    key = paper.citation_key
    authors = ", ".join(paper.authors[:4]) if paper.authors else "Unknown author"
    year = paper.year or "n.d."
    title = paper.title.strip().rstrip(".")
    url = _canonical_url(paper)
    return f"[{key}] {authors} ({year}). {title}. {url}"


def format_reference_line(paper: Paper, fmt: str, index: int = 1) -> str:
    style = CITATION_FORMATS.get(fmt, CITATION_FORMATS["apa7"])["reference_style"]
    if style == "apa7":
        return _format_reference_apa(paper)
    if style == "mla9":
        return _format_reference_mla(paper)
    if style == "chicago":
        return _format_reference_chicago(paper)
    if style == "ieee":
        return _format_reference_ieee(paper, index)
    return _format_reference_bracket(paper)


def in_text_hint(paper: Paper, fmt: str, index: int) -> str:
    surname = _surname(paper.authors[0]) if paper.authors else "Unknown"
    year = paper.year or "n.d."
    style = CITATION_FORMATS.get(fmt, CITATION_FORMATS["apa7"])["reference_style"]
    if style == "apa7":
        return f"({surname}, {year})"
    if style == "mla9":
        return f"({surname} PAGE)"
    if style == "chicago":
        return f"({surname} {year}, PAGE)"
    if style == "ieee":
        return f"[{index}]"
    return f"[{paper.citation_key}]"


def render_references_formatted(papers: list[Paper], fmt: str) -> str:
    if not papers:
        return "No English scholarly sources were retrieved. Try broadening the topic or increasing citation limit."
    style = CITATION_FORMATS.get(fmt, CITATION_FORMATS["apa7"])["reference_style"]
    heading = "## Works Cited" if fmt == "mla9" else "## References"
    ordered = list(papers)
    if style in {"apa7", "mla9", "chicago", "bracket"}:
        ordered.sort(key=lambda p: _sort_key_author(p.authors))
    lines = [format_reference_line(p, fmt, i + 1) for i, p in enumerate(ordered)]
    return f"{heading}\n\n" + "\n\n".join(lines)


_REF_SECTION_IN_BODY = re.compile(
    r"(?im)^\s*##\s+(References|Works Cited|Bibliography|参考文献|Reference List)\s*$"
)


def strip_embedded_reference_sections(text: str) -> str:
    """Remove LLM-written reference blocks from section body."""
    m = _REF_SECTION_IN_BODY.search(text)
    if not m:
        return text.strip()
    return text[: m.start()].strip()