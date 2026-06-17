from __future__ import annotations

import re
import xml.etree.ElementTree as ET
from collections.abc import Iterable
from collections.abc import Callable
from urllib.parse import quote_plus

import httpx

from academic_agent.config import Settings, get_settings
from academic_agent.http_utils import make_http_client
from academic_agent.models import Paper, SourceName
from academic_agent.scholar_quality import filter_scholar_quality, is_scholarly_source
from academic_agent.scholar_search import search_scholar_multi, search_scholar_primary
from academic_agent.tavily_search import search_tavily


def _clean_text(value: str | None) -> str | None:
    if not value:
        return None
    return re.sub(r"\s+", " ", value).strip()


def _author_names(items: Iterable[dict]) -> list[str]:
    names: list[str] = []
    for item in items:
        name = item.get("display_name") or item.get("name")
        if name:
            names.append(str(name))
    return names


class AcademicSearcher:
    def __init__(self, settings: Settings | None = None) -> None:
        self.settings = settings or get_settings()

    def search(
        self,
        query: str,
        *,
        limit: int = 10,
        tavily_key: str = "",
        web_search: bool = True,
        extra_queries: list[str] | None = None,
    ) -> list[Paper]:
        queries = [query.strip()]
        if extra_queries:
            queries.extend(q.strip() for q in extra_queries if q.strip())
        results: list[Paper] = (
            search_scholar_multi(queries, limit=max(limit, 15))
            if len(queries) > 1
            else list(search_scholar_primary(query, limit=max(limit, 15)))
        )
        if len(results) < limit:
            per_source = max(4, min(limit, 15))
            with make_http_client(timeout=30.0) as client:
                for fetcher in (self._semantic_scholar, self._openalex):
                    results.extend(self._safe_fetch(fetcher, client, query, per_source))
        results = dedupe_papers(results)
        results = [p for p in results if is_scholarly_source(p)]
        results = filter_scholar_quality(results, min_citations=3)
        if len(results) < limit:
            relaxed = filter_scholar_quality(dedupe_papers(results), min_citations=1)
            results = relaxed[:limit]
        if web_search and tavily_key and len(results) < max(4, limit // 3):
            # Tavily only fills gaps; never used as primary citations.
            tavily_hits = search_tavily(query, api_key=tavily_key, limit=3)
            results = dedupe_papers(results + tavily_hits)
            results = [p for p in results if is_scholarly_source(p)] or results[:limit]
        return results[:limit]

    def by_doi(self, doi: str) -> Paper | None:
        doi = doi.strip().removeprefix("https://doi.org/")
        with make_http_client(timeout=30.0) as client:
            for fetcher in (self._crossref_doi, self._openalex_doi):
                try:
                    paper = fetcher(client, doi)
                except httpx.HTTPError:
                    paper = None
                if paper:
                    return paper
        return None

    def by_arxiv_id(self, arxiv_id: str) -> Paper | None:
        arxiv_id = arxiv_id.strip().removeprefix("arXiv:")
        url = f"https://export.arxiv.org/api/query?id_list={quote_plus(arxiv_id)}"
        with make_http_client(timeout=30.0) as client:
            response = client.get(url)
            if response.status_code >= 400:
                return None
            papers = self._parse_arxiv(response.text)
        return papers[0] if papers else None

    def _openalex(self, client: httpx.Client, query: str, limit: int) -> list[Paper]:
        response = client.get(
            "https://api.openalex.org/works",
            params={
                "search": query,
                "per-page": limit,
                "filter": "language:en,cited_by_count:>5,type:article",
                "sort": "cited_by_count:desc",
            },
        )
        if response.status_code >= 400:
            return []
        return [self._openalex_work(item) for item in response.json().get("results", [])]

    @staticmethod
    def _safe_fetch(
        fetcher: Callable[[httpx.Client, str, int], list[Paper]],
        client: httpx.Client,
        query: str,
        limit: int,
    ) -> list[Paper]:
        try:
            return fetcher(client, query, limit)
        except (httpx.HTTPError, ET.ParseError):
            return []

    def _openalex_doi(self, client: httpx.Client, doi: str) -> Paper | None:
        response = client.get(f"https://api.openalex.org/works/https://doi.org/{doi}")
        if response.status_code >= 400:
            return None
        return self._openalex_work(response.json())

    def _openalex_work(self, item: dict) -> Paper:
        authorships = item.get("authorships") or []
        authors = [a.get("author", {}).get("display_name") for a in authorships]
        abstract = inverted_index_to_text(item.get("abstract_inverted_index"))
        primary_location = item.get("primary_location") or {}
        source = primary_location.get("source") or {}
        return Paper(
            title=_clean_text(item.get("title")) or "Untitled",
            authors=[a for a in authors if a],
            year=item.get("publication_year"),
            abstract=abstract,
            doi=(item.get("doi") or "").removeprefix("https://doi.org/") or None,
            url=item.get("id") or item.get("doi"),
            venue=source.get("display_name"),
            citation_count=item.get("cited_by_count"),
            source=SourceName.OPENALEX,
            source_id=item.get("id"),
            raw=item,
        )

    def _semantic_scholar(self, client: httpx.Client, query: str, limit: int) -> list[Paper]:
        headers = {}
        if self.settings.semantic_scholar_api_key:
            headers["x-api-key"] = self.settings.semantic_scholar_api_key
        response = client.get(
            "https://api.semanticscholar.org/graph/v1/paper/search",
            params={
                "query": query,
                "limit": limit,
                "fields": "title,authors,year,abstract,venue,citationCount,externalIds,url",
            },
            headers=headers,
        )
        if response.status_code >= 400:
            return []
        papers: list[Paper] = []
        for item in response.json().get("data", []):
            external = item.get("externalIds") or {}
            papers.append(
                Paper(
                    title=_clean_text(item.get("title")) or "Untitled",
                    authors=_author_names(item.get("authors") or []),
                    year=item.get("year"),
                    abstract=_clean_text(item.get("abstract")),
                    doi=external.get("DOI"),
                    arxiv_id=external.get("ArXiv"),
                    url=item.get("url"),
                    venue=item.get("venue"),
                    citation_count=item.get("citationCount"),
                    source=SourceName.SEMANTIC_SCHOLAR,
                    source_id=item.get("paperId"),
                    raw=item,
                )
            )
        return papers

    def _crossref(self, client: httpx.Client, query: str, limit: int) -> list[Paper]:
        response = client.get("https://api.crossref.org/works", params={"query": query, "rows": limit})
        if response.status_code >= 400:
            return []
        return [self._crossref_item(item) for item in response.json().get("message", {}).get("items", [])]

    def _crossref_doi(self, client: httpx.Client, doi: str) -> Paper | None:
        response = client.get(f"https://api.crossref.org/works/{quote_plus(doi)}")
        if response.status_code >= 400:
            return None
        item = response.json().get("message")
        return self._crossref_item(item) if item else None

    def _crossref_item(self, item: dict) -> Paper:
        authors = []
        for author in item.get("author") or []:
            given = author.get("given", "")
            family = author.get("family", "")
            name = " ".join(part for part in [given, family] if part).strip()
            if name:
                authors.append(name)
        year = None
        date_parts = (item.get("published-print") or item.get("published-online") or item.get("created") or {}).get(
            "date-parts"
        )
        if date_parts and date_parts[0]:
            year = date_parts[0][0]
        titles = item.get("title") or []
        containers = item.get("container-title") or []
        abstracts = item.get("abstract")
        return Paper(
            title=_clean_text(titles[0] if titles else None) or "Untitled",
            authors=authors,
            year=year,
            abstract=_clean_text(strip_tags(abstracts)),
            doi=item.get("DOI"),
            url=item.get("URL"),
            venue=containers[0] if containers else None,
            citation_count=item.get("is-referenced-by-count"),
            source=SourceName.CROSSREF,
            source_id=item.get("DOI"),
            raw=item,
        )

    def _arxiv(self, client: httpx.Client, query: str, limit: int) -> list[Paper]:
        url = (
            "https://export.arxiv.org/api/query"
            f"?search_query=all:{quote_plus(query)}&start=0&max_results={limit}&sortBy=relevance"
        )
        response = client.get(url)
        if response.status_code >= 400:
            return []
        return self._parse_arxiv(response.text)

    @staticmethod
    def _parse_arxiv(xml_text: str) -> list[Paper]:
        ns = {"a": "http://www.w3.org/2005/Atom"}
        root = ET.fromstring(xml_text)
        papers: list[Paper] = []
        for entry in root.findall("a:entry", ns):
            entry_id = entry.findtext("a:id", default="", namespaces=ns)
            arxiv_id = entry_id.rsplit("/", 1)[-1] if entry_id else None
            authors = [node.findtext("a:name", default="", namespaces=ns) for node in entry.findall("a:author", ns)]
            published = entry.findtext("a:published", default="", namespaces=ns)
            doi_node = entry.find("{http://arxiv.org/schemas/atom}doi")
            doi = doi_node.text if doi_node is not None else None
            papers.append(
                Paper(
                    title=_clean_text(entry.findtext("a:title", default="", namespaces=ns)) or "Untitled",
                    authors=[a for a in authors if a],
                    year=int(published[:4]) if published[:4].isdigit() else None,
                    abstract=_clean_text(entry.findtext("a:summary", default="", namespaces=ns)),
                    doi=doi,
                    arxiv_id=arxiv_id,
                    url=entry_id,
                    source=SourceName.ARXIV,
                    source_id=arxiv_id,
                    raw={},
                )
            )
        return papers


def strip_tags(text: str | None) -> str | None:
    if not text:
        return None
    return re.sub(r"<[^>]+>", " ", text)


def inverted_index_to_text(index: dict[str, list[int]] | None) -> str | None:
    if not index:
        return None
    words: list[str | None] = [None] * (max(pos for positions in index.values() for pos in positions) + 1)
    for word, positions in index.items():
        for pos in positions:
            words[pos] = word
    return _clean_text(" ".join(word or "" for word in words))


def dedupe_papers(papers: list[Paper]) -> list[Paper]:
    index_by_key: dict[str, int] = {}
    unique: list[Paper] = []
    for paper in papers:
        key = paper.doi.lower() if paper.doi else normalize_title(paper.title)
        if key in index_by_key:
            current_index = index_by_key[key]
            if paper_quality_score(paper) > paper_quality_score(unique[current_index]):
                unique[current_index] = paper
            continue
        index_by_key[key] = len(unique)
        unique.append(paper)
    return unique


def paper_quality_score(paper: Paper) -> int:
    return (
        int(bool(paper.doi)) * 4
        + int(bool(paper.arxiv_id)) * 3
        + int(bool(paper.abstract)) * 2
        + int(bool(paper.url))
        + min(paper.citation_count or 0, 1000) // 100
    )


def normalize_title(title: str) -> str:
    return re.sub(r"\W+", "", title.lower())
