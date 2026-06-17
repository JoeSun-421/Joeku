from __future__ import annotations

from academic_agent.http_utils import make_http_client
from academic_agent.models import Paper, SourceName


def search_tavily(query: str, *, api_key: str, limit: int = 8) -> list[Paper]:
    """Fetch web results via Tavily and map to Paper objects for citation pipeline."""
    if not api_key.strip() or not query.strip():
        return []
    payload = {
        "api_key": api_key.strip(),
        "query": query,
        "search_depth": "advanced",
        "max_results": max(1, min(limit, 20)),
        "include_answer": False,
        "include_raw_content": False,
    }
    try:
        with make_http_client(timeout=45.0) as client:
            response = client.post("https://api.tavily.com/search", json=payload)
            if response.status_code >= 400:
                return []
            data = response.json()
    except Exception:
        return []

    papers: list[Paper] = []
    for item in data.get("results") or []:
        title = (item.get("title") or "Web source").strip()
        url = item.get("url") or ""
        snippet = (item.get("content") or "")[:1200]
        papers.append(
            Paper(
                title=title,
                authors=["Web"],
                year=None,
                abstract=snippet or None,
                url=url,
                source=SourceName.TAVILY,
                source_id=url,
                raw=item,
            )
        )
    return papers