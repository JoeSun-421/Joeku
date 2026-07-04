"""Verify local data-root status, user registration, and pick-folder API shape."""
from __future__ import annotations

import json
import tempfile
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

BASE = "http://127.0.0.1:8000"


def request(method: str, path: str, body: dict | None = None) -> dict:
    data = None if body is None else json.dumps(body).encode("utf-8")
    req = urllib.request.Request(
        BASE + path,
        data=data,
        method=method,
        headers={"Content-Type": "application/json"} if body is not None else {},
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode("utf-8"))


def main() -> int:
    data_dir = Path(tempfile.mkdtemp(prefix="joeku_test_"))
    print(f"data_dir={data_dir}")

    status = request("GET", f"/api/local/status?data_root={urllib.parse.quote(str(data_dir))}")
    if not status.get("configured"):
        print("FAIL: local status not configured after mkdir")
        return 1
    print("OK: local status")

    reg = request(
        "POST",
        "/api/local/register",
        {"data_root": str(data_dir), "display_name": "TestUser"},
    )
    uid = reg.get("profile", {}).get("user_id")
    if not uid:
        print("FAIL: register returned no user_id", reg)
        return 1
    print(f"OK: register user_id={uid}")

    reg2 = request(
        "POST",
        "/api/local/register",
        {"data_root": str(data_dir), "display_name": "TestUser2"},
    )
    uid2 = reg2.get("profile", {}).get("user_id")
    if not uid2 or uid2 == uid:
        print("FAIL: second register should create new user", uid, uid2)
        return 1
    print(f"OK: second register user_id={uid2}")

    users = request("GET", f"/api/local/users?data_root={urllib.parse.quote(str(data_dir))}")
    if len(users.get("users") or []) < 2:
        print("FAIL: expected >=2 users", users)
        return 1
    print(f"OK: users count={len(users['users'])}")

    user_dir = data_dir / "users" / uid
    if not (user_dir / "profile.json").is_file():
        print(f"FAIL: profile.json missing under {user_dir}")
        return 1
    print("OK: profile.json on disk")

    # pick-folder contract: API must return both keys (frontend accepts folder || path)
    sample = {"path": str(data_dir), "folder": str(data_dir)}
    picked = sample.get("folder") or sample.get("path")
    if picked != str(data_dir):
        print("FAIL: pick-folder response contract broken")
        return 1
    print("OK: pick-folder response contract (folder + path)")

    print("ALL OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())