from __future__ import annotations

import json
import sys
from pathlib import Path

import httpx
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

load_dotenv(ROOT / ".env")

from academic_agent.config import get_settings  # noqa: E402


def parse_sse(buf: str) -> tuple[list[str], list[str]]:
    answers: list[str] = []
    errors: list[str] = []
    for block in buf.replace("\r\n", "\n").split("\n\n"):
        if not block.strip() or block.strip().startswith(":"):
            continue
        ev, data = "data", ""
        for line in block.split("\n"):
            if line.startswith("event:"):
                ev = line[6:].strip()
            elif line.startswith("data:"):
                data += line[5:].lstrip()
        if ev == "answer":
            answers.append(data)
        if ev == "error":
            errors.append(data)
    return answers, errors


def main() -> None:
    settings = get_settings()
    headers = {
        "X-API-Key": settings.openai_api_key,
        "X-Base-Url": settings.openai_base_url,
        "X-Model": settings.openai_model,
        "Content-Type": "application/json",
    }

    paper = ""
    state_path = ROOT / "users" / "u_6887c014960a" / "state.json"
    if state_path.is_file():
        data = json.loads(state_path.read_text(encoding="utf-8"))
        paper = data["projects"][0]["chats"][0].get("paper") or ""

    body = {
        "messages": [{"role": "user", "content": "总结这篇论文的主要观点，简短回复"}],
        "paper_context": paper,
        "use_library": False,
        "data_root": "",
        "user_id": "",
        "project_id": "",
    }
    print("paper_len", len(paper))

    with httpx.Client(timeout=180, trust_env=False) as client:
        with client.stream(
            "POST",
            "http://127.0.0.1:8000/api/chat/stream",
            headers=headers,
            json=body,
        ) as response:
            print("status", response.status_code)
            buf = "".join(response.iter_text())

    answers, errors = parse_sse(buf)
    print("answers", len(answers), "errors", errors)
    print("preview", repr("".join(answers)[:200]))


if __name__ == "__main__":
    main()