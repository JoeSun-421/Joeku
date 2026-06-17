from __future__ import annotations

import re


def count_words(text: str) -> int:
    """Count words in mixed Chinese/English academic text."""
    if not text.strip():
        return 0
    cjk = re.findall(r"[\u4e00-\u9fff]", text)
    latin = re.findall(r"[A-Za-z0-9]+(?:'[A-Za-z]+)?", text)
    return len(cjk) + len(latin)


def estimate_max_tokens(target_words: int) -> int:
    # Reasoning models (e.g. deepseek-v4-pro) need headroom beyond visible output.
    return min(max(int(target_words * 2.8) + 320, 1024), 12000)


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