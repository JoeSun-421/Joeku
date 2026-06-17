"""Smoke test: start a small paper generation job via local Joeku API."""
from __future__ import annotations

import json
import os
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BASE = "http://127.0.0.1:8000"


def load_env() -> dict[str, str]:
    env: dict[str, str] = {}
    dotenv = ROOT / ".env"
    if not dotenv.exists():
        return env
    for line in dotenv.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        env[k.strip()] = v.strip()
    return env


def request(method: str, path: str, body: dict | None, headers: dict[str, str]) -> dict:
    data = None if body is None else json.dumps(body).encode("utf-8")
    req = urllib.request.Request(
        BASE + path,
        data=data,
        method=method,
        headers={"Content-Type": "application/json", **headers},
    )
    with urllib.request.urlopen(req, timeout=300) as resp:
        return json.loads(resp.read().decode("utf-8"))


def main() -> int:
    env = load_env()
    api_key = env.get("OPENAI_API_KEY", "")
    if not api_key:
        print("FAIL: OPENAI_API_KEY missing in .env")
        return 1

    base_url = env.get("OPENAI_BASE_URL", "https://api.deepseek.com/v1")
    if not base_url.rstrip("/").endswith("/v1"):
        base_url = base_url.rstrip("/") + "/v1"
    model = env.get("OPENAI_MODEL", "deepseek-v4-pro")
    if model == "deepseek-v4-pro":
        model = "deepseek-chat"

    headers = {
        "X-Api-Key": api_key,
        "X-Base-Url": base_url,
        "X-Model": model,
    }

    try:
        health = request("GET", "/api/health", None, {})
    except urllib.error.URLError as exc:
        print(f"FAIL: Joeku not running at {BASE}: {exc}")
        return 1

    if not health.get("ok"):
        print("FAIL: health check returned not ok")
        return 1

    payload = {
        "topic": "晨间阅读习惯的三个益处",
        "target_words": 500,
        "search_limit": 3,
        "citation_limit": 3,
        "language": "zh",
        "citation_format": "apa7",
        "requirements": "写一篇简短随笔，含引言、三个小节和结语，语气自然。",
        "fast_mode": True,
        "web_search": True,
        "de_ai": False,
        "deep_quality": False,
    }

    print("Starting generation job...")
    started = request("POST", "/api/generate/start", payload, headers)
    job_id = started["job_id"]
    print(f"job_id={job_id}")

    for i in range(120):
        status = request("GET", f"/api/generate/status/{job_id}", None, headers)
        st = status.get("status")
        msg = status.get("message") or status.get("step") or ""
        pct = status.get("percent", 0)
        print(f"[{i:03d}] {st} {pct}% {msg}")
        if st == "done":
            result = request("GET", f"/api/generate/result/{job_id}", None, headers)
            doc = (result.get("document") or "").strip()
            out = ROOT / "scripts" / "test_article_output.md"
            out.write_text(doc, encoding="utf-8")
            print(f"OK: saved {len(doc)} chars -> {out}")
            print("--- preview ---")
            print(doc[:1200])
            return 0
        if st == "error":
            print("FAIL:", status.get("error"))
            return 1
        time.sleep(3)

    print("FAIL: timeout waiting for job")
    return 1


if __name__ == "__main__":
    sys.exit(main())