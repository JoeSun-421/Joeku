from __future__ import annotations

from academic_agent.models import Paper
from academic_agent.scholar_quality import paper_link, scholar_url

# University-standard citation rules (APA 7, MLA 9, Chicago, IEEE — common US/UK undergrad requirements)
UNIVERSITY_CITATION_RULES = """
University citation standards (apply strictly):
1) Every factual or argumentative claim from a source MUST have an in-text citation; no unsupported claims.
2) Reference list entries MUST correspond 1:1 to in-text citations — no unused sources, no uncited sources.
3) Use ONLY the provided numbered English sources; never invent authors, years, DOIs, or page numbers.
4) Paraphrase in your own words; direct quotes need quotation marks and page numbers when available.
5) Reference section heading: "## References" (APA/Chicago/IEEE) or "## Works Cited" (MLA).
6) List references alphabetically by first author surname (APA, MLA, Chicago) or in order of first appearance (IEEE).
7) Include clickable DOI/URL in each reference entry as provided in the source list.
"""

CITATION_FORMATS: dict[str, dict[str, str]] = {
    "bracket": {
        "label": "Bracket [AuthorYear]",
        "in_text": (
            "Bracket style per many STEM syllabi: use keys like [Smith2024] matching the reference list. "
            "Place one citation per argument paragraph minimum; multiple sources: [Smith2024; Lee2023]. "
            "Reference list: alphabetical by key, full bibliographic line with link."
        ),
        "reference_style": "bracket",
    },
    "apa7": {
        "label": "APA 7th (Author, Year)",
        "in_text": (
            "APA 7th (American Psychological Association) — standard at most US/UK universities:\n"
            "- Narrative: Smith (2024) argued…; Parenthetical: (Smith, 2024).\n"
            "- Two authors: (Smith & Jones, 2024). Three or more: (Smith et al., 2024).\n"
            "- Multiple works: (Smith, 2024; Jones, 2023) alphabetical, semicolon-separated.\n"
            "- Direct quote: include page (Smith, 2024, p. 12) when known; otherwise omit page.\n"
            "- References: alphabetically by author surname; hanging indent; italicize journal/book titles; "
            "include DOI as https://doi.org/… when available."
        ),
        "reference_style": "apa7",
    },
    "mla9": {
        "label": "MLA 9th",
        "in_text": (
            "MLA 9th (Modern Language Association) — standard in humanities:\n"
            "- Parenthetical: (Smith 45) author + page; no comma between name and page.\n"
            "- Two authors: (Smith and Jones 45). Three+: (Smith et al. 45).\n"
            "- Works Cited: alphabetical by author; title in quotation marks for articles, italics for books; "
            "include URL/DOI for online sources."
        ),
        "reference_style": "mla9",
    },
    "chicago": {
        "label": "Chicago (Author-Date)",
        "in_text": (
            "Chicago Manual of Style (author-date) — common in history/social sciences:\n"
            "- Parenthetical: (Smith 2024, 45) or (Smith 2024, 45–47).\n"
            "- Reference list: alphabetical; journal/book titles italicized; full DOI/URL."
        ),
        "reference_style": "chicago",
    },
    "ieee": {
        "label": "IEEE [n]",
        "in_text": (
            "IEEE numeric style — standard in engineering/computer science:\n"
            "- In-text: bracket numbers [1], [2] in order of first use; same source reuse same number.\n"
            "- Reference list: numbered in order of first citation; abbreviate journal names where standard; "
            "include DOI/URL."
        ),
        "reference_style": "ieee",
    },
}


def citation_format_instruction(fmt: str) -> str:
    spec = CITATION_FORMATS.get(fmt, CITATION_FORMATS["apa7"])
    return f"{UNIVERSITY_CITATION_RULES.strip()}\n\nFormat-specific rules:\n{spec['in_text']}"


def _md_link(text: str, url: str) -> str:
    safe = text.replace("[", "").replace("]", "")
    return f"[{safe}]({url})"


def format_reference_line(paper: Paper, fmt: str, index: int = 1) -> str:
    style = CITATION_FORMATS.get(fmt, CITATION_FORMATS["apa7"])["reference_style"]
    authors = ", ".join(paper.authors[:6]) if paper.authors else "Unknown author"
    if len(paper.authors or []) > 6:
        authors += ", et al."
    year = paper.year or "n.d."
    title = paper.title
    venue = paper.venue or ""
    link = paper_link(paper)
    gs = scholar_url(paper)

    if style == "apa7":
        venue_part = f" *{venue}*." if venue else "."
        return (
            f"{index}. {authors} ({year}). {_md_link(title, link)}{venue_part} "
            f"[DOI/Paper]({link}) · [Google Scholar]({gs})"
        ).strip()
    if style == "mla9":
        return f"{index}. {authors}. {_md_link('\"' + title + '\"', link)}. *{venue}*, {year}. [Scholar]({gs})".strip()
    if style == "chicago":
        return f"{index}. {authors}. {year}. {_md_link('\"' + title + '\"', link)}. *{venue}*. [Scholar]({gs})".strip()
    if style == "ieee":
        return f"[{index}] {authors}, {_md_link('\"' + title + '\"', link)}, *{venue}*, {year}. [Scholar]({gs})".strip()
    return f"- [{paper.citation_key}] {authors} ({year}). {_md_link(title, link)}. [Scholar]({gs})"


def render_references_formatted(papers: list[Paper], fmt: str) -> str:
    if not papers:
        return "No English scholarly sources were retrieved. Try broadening the topic or increasing citation limit."
    heading = "## Works Cited" if fmt == "mla9" else "## References"
    lines = [format_reference_line(p, fmt, i + 1) for i, p in enumerate(papers)]
    return f"{heading}\n\n" + "\n\n".join(lines)