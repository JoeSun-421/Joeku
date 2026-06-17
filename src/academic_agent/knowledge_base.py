from __future__ import annotations

import json
import re
from importlib.resources import files
from pathlib import Path


def _default_corpus() -> list[dict[str, str]]:
    return [
        {
            "tags": "学术 引言 结构 thesis",
            "text": (
                "强引言应在一段内交代研究背景、核心问题与本文贡献。"
                "避免空泛套话，用具体现象或数据切入；末句明确论文主张（thesis）。"
            ),
        },
        {
            "tags": "引用 段内 citation in-text",
            "text": (
                "每个论证段落至少一处段内引用，且同一段落避免重复同一文献。"
                "引用应支撑具体论断，而非装饰性堆砌；优先近五年高相关研究。"
            ),
        },
        {
            "tags": "去AI 自然 学术风格",
            "text": (
                "去AI化写作：减少“综上所述”“值得注意的是”等模板句；"
                "句式长短交替；用领域术语与具体案例替代笼统形容词；保持克制客观语气。"
            ),
        },
        {
            "tags": "方法 证据 分析",
            "text": (
                "分析段遵循“主张—证据—解释”：先给出判断，再引用文献或数据，"
                "最后说明证据如何支持主张并回应可能反驳。"
            ),
        },
    ]


def load_corpus() -> list[dict[str, str]]:
    try:
        path = files("academic_agent").joinpath("data", "writing_corpus.json")
        if path.is_file():
            return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        pass
    return _default_corpus()


def retrieve_snippets(topic: str, *, limit: int = 3) -> str:
    """Lightweight keyword retrieval — no embedding dependency."""
    corpus = load_corpus()
    words = set(re.findall(r"[\u4e00-\u9fff]{2,}|[A-Za-z]{3,}", topic.lower()))
    scored: list[tuple[int, str]] = []
    for item in corpus:
        hay = f"{item.get('tags', '')} {item.get('text', '')}".lower()
        score = sum(1 for w in words if w in hay)
        scored.append((score, item.get("text", "")))
    scored.sort(key=lambda x: x[0], reverse=True)
    picked = [t for s, t in scored if t][:limit]
    if not picked:
        picked = [c.get("text", "") for c in corpus[:limit]]
    return "\n".join(f"- {p}" for p in picked if p)