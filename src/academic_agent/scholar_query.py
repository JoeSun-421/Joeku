from __future__ import annotations

import re

_CJK = re.compile(r"[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]")


def topic_needs_english_queries(topic: str) -> bool:
    return bool(_CJK.search(topic))


def english_scholar_queries(topic: str, *, llm=None) -> list[str]:
    """Build English search phrases for scholarly APIs (GS has no public API)."""
    topic = topic.strip()
    if not topic:
        return []
    if not topic_needs_english_queries(topic):
        return _dedupe_queries([topic])

    if llm is not None:
        try:
            raw = llm.chat(
                [
                    {
                        "role": "system",
                        "content": (
                            "Translate academic topics into 3 concise English Google Scholar search queries. "
                            "Return one query per line, no numbering, no Chinese."
                        ),
                    },
                    {"role": "user", "content": f"Topic: {topic}"},
                ],
                temperature=0.1,
                max_tokens=180,
            )
            lines = [ln.strip(" -•\t") for ln in raw.splitlines() if ln.strip()]
            cleaned = [ln for ln in lines if ln and not _CJK.search(ln)]
            if cleaned:
                return _dedupe_queries(cleaned[:4])
        except Exception:
            pass

    return _dedupe_queries([topic, f"{topic} systematic review", f"{topic} empirical study"])


def _dedupe_queries(queries: list[str]) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for q in queries:
        key = re.sub(r"\W+", " ", q.lower()).strip()
        if not key or key in seen:
            continue
        seen.add(key)
        out.append(q.strip())
    return out