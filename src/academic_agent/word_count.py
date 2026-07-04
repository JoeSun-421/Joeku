from __future__ import annotations

import re

_REF_HEADING = re.compile(
    r"(?im)^\s*##\s+(References|Works Cited|Bibliography|参考文献)\s*$"
)


def split_body_and_references(text: str) -> tuple[str, str]:
    """Split markdown into body (excludes reference section and trailing checklist)."""
    if not text.strip():
        return "", ""
    match = _REF_HEADING.search(text)
    if not match:
        return text.strip(), ""
    body = text[: match.start()].strip()
    refs = text[match.start() :].strip()
    checklist = re.search(r"(?im)^\s*##\s+Verification Checklist\s*$", refs)
    if checklist:
        refs = refs[: checklist.start()].strip()
    return body, refs


def strip_meta_header(body: str) -> str:
    """Remove title line and **Words:** meta block from body for counting."""
    lines = body.splitlines()
    out: list[str] = []
    skip_meta = False
    for line in lines:
        if line.startswith("# "):
            continue
        if line.strip().startswith("**Words:**"):
            skip_meta = True
            continue
        if skip_meta and not line.strip():
            skip_meta = False
            continue
        if skip_meta:
            continue
        out.append(line)
    return "\n".join(out).strip()


def count_body_words(text: str) -> int:
    """Count words in paper body only — references and checklist excluded."""
    body, _ = split_body_and_references(text)
    return count_words(strip_meta_header(body))


def count_words(text: str) -> int:
    """Count words in mixed Chinese/English academic text."""
    if not text.strip():
        return 0
    cjk = re.findall(r"[\u4e00-\u9fff]", text)
    latin = re.findall(r"[A-Za-z0-9]+(?:'[A-Za-z]+)?", text)
    return len(cjk) + len(latin)


def estimate_max_tokens(target_words: int) -> int:
    # Reasoning models need headroom beyond visible output.
    return min(max(int(target_words * 3.2) + 640, 2048), 32000)


def tolerance_for_target(target: int) -> float:
    if target <= 600:
        return 0.65
    if target <= 1200:
        return 0.22
    return 0.08


def within_tolerance(actual: int, target: int, tolerance: float | None = None) -> bool:
    if target <= 0:
        return True
    tol = tolerance if tolerance is not None else tolerance_for_target(target)
    ratio = actual / target
    return (1 - tol) <= ratio <= (1 + tol)