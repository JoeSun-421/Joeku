from __future__ import annotations

from urllib.parse import quote_plus

from academic_agent.http_utils import make_http_client
from academic_agent.models import Paper, SourceName
from academic_agent.scholar_quality import filter_scholar_quality, scholar_url


def search_google_scholar_mirror(query: str, *, limit: int = 12) -> list[Paper]:
    """Use Semantic Scholar as Google Scholar-quality proxy (official GS has no free API)."""
    headers: dict[str, str] = {}
    params = {
        "query": query,
        "limit": min(limit * 2, 30),
        "fields": "title,authors,year,abstract,venue,citationCount,externalIds,url,openAccessPdf",
    }
    try:
        with make_http_client(timeout=35.0) as client:
            response = client.get(
                "https://api.semanticscholar.org/graph/v1/paper/search",
                params=params,
                headers=headers,
            )
            if response.status_code >= 400:
                return []
            data = response.json()
    except Exception:
        return []

    papers: list[Paper] = []
    for item in data.get("data") or []:
        ext = item.get("externalIds") or {}
        authors = [a.get("name") for a in item.get("authors") or [] if a.get("name")]
        url = item.get("url") or scholar_url(
            Paper(
                title=item.get("title") or "",
                authors=authors,
                source=SourceName.SEMANTIC_SCHOLAR,
            )
        )
        papers.append(
            Paper(
                title=(item.get("title") or "Untitled").strip(),
                authors=authors,
                year=item.get("year"),
                abstract=(item.get("abstract") or "").strip() or None,
                doi=ext.get("DOI"),
                arxiv_id=ext.get("ArXiv"),
                url=url,
                venue=item.get("venue"),
                citation_count=item.get("citationCount"),
                source=SourceName.SEMANTIC_SCHOLAR,
                source_id=item.get("paperId"),
                raw=item,
            )
        )
    return papers


def search_openalex_english(query: str, *, limit: int = 12) -> list[Paper]:
    try:
        with make_http_client(timeout=35.0) as client:
            response = client.get(
                "https://api.openalex.org/works",
                params={
                    "search": query,
                    "per-page": min(limit * 2, 25),
                    "filter": "cited_by_count:>3,language:en",
                    "sort": "cited_by_count:desc",
                },
            )
            if response.status_code >= 400:
                return []
            items = response.json().get("results") or []
    except Exception:
        return []

    papers: list[Paper] = []
    for item in items:
        authorships = item.get("authorships") or []
        authors = [a.get("author", {}).get("display_name") for a in authorships if a.get("author")]
        loc = item.get("primary_location") or {}
        venue = (loc.get("source") or {}).get("display_name")
        doi = (item.get("doi") or "").removeprefix("https://doi.org/") or None
        papers.append(
            Paper(
                title=(item.get("title") or "Untitled").strip(),
                authors=[a for a in authors if a],
                year=item.get("publication_year"),
                abstract=_openalex_abstract(item.get("abstract_inverted_index")),
                doi=doi,
                url=item.get("doi") or item.get("id") or scholar_url(
                    Paper(title=item.get("title") or "", authors=authors, source=SourceName.OPENALEX)
                ),
                venue=venue,
                citation_count=item.get("cited_by_count"),
                source=SourceName.OPENALEX,
                source_id=item.get("id"),
                raw=item,
            )
        )
    return papers


def _openalex_abstract(index: dict | None) -> str | None:
    if not index:
        return None
    size = max(pos for poses in index.values() for pos in poses) + 1
    words: list[str | None] = [None] * size
    for word, poses in index.items():
        for pos in poses:
            words[pos] = word
    text = " ".join(w or "" for w in words).strip()
    return text or None


def search_scholar_primary(query: str, *, limit: int = 15) -> list[Paper]:
    """English, high-quality sources aligned with Google Scholar expectations."""
    pool: list[Paper] = []
    pool.extend(search_google_scholar_mirror(query, limit=limit))
    pool.extend(search_openalex_english(query, limit=limit))
    seen: set[str] = set()
    unique: list[Paper] = []
    for p in pool:
        key = (p.doi or p.title).lower()
        if key in seen:
            continue
        seen.add(key)
        unique.append(p)
    ranked = filter_scholar_quality(unique, min_citations=3)
    if len(ranked) < limit // 2:
        ranked = filter_scholar_quality(unique, min_citations=1)
    return ranked[:limit]


def search_scholar_multi(queries: list[str], *, limit: int = 15) -> list[Paper]:
    if not queries:
        return []
    per_query = max(6, limit // max(1, len(queries)) + 2)
    pool: list[Paper] = []
    for q in queries:
        if q.strip():
            pool.extend(search_scholar_primary(q.strip(), limit=per_query))
    seen: set[str] = set()
    unique: list[Paper] = []
    for p in pool:
        key = (p.doi or p.title).lower()
        if key in seen:
            continue
        seen.add(key)
        unique.append(p)
    ranked = filter_scholar_quality(unique, min_citations=3)
    return ranked[:limit]