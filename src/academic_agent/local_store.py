from __future__ import annotations

import json
import re
import shutil
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT_META = "joeku.json"
USERS_DIR = "users"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _read_json(path: Path, default: Any) -> Any:
    if not path.is_file():
        return default
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return default


def _write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def normalize_data_root(path: str) -> Path:
    cleaned = (path or "").strip()
    if not cleaned:
        raise ValueError("数据目录不能为空。")
    root = Path(cleaned).expanduser().resolve()
    root.mkdir(parents=True, exist_ok=True)
    return root


def ensure_root(data_root: Path) -> dict[str, Any]:
    meta_path = data_root / ROOT_META
    meta = _read_json(meta_path, {})
    if not meta:
        meta = {"version": 1, "data_root": str(data_root), "created_at": _now_iso()}
        _write_json(meta_path, meta)
    return meta


def user_dir(data_root: Path, user_id: str) -> Path:
    safe = re.sub(r"[^\w\-]", "_", user_id.strip())
    if not safe:
        raise ValueError("无效的用户 ID。")
    return data_root / USERS_DIR / safe


def project_data_dir(data_root: Path, user_id: str, project_id: str) -> Path:
    safe_pid = re.sub(r"[^\w\-]", "_", (project_id or "").strip())
    if not safe_pid:
        raise ValueError("无效的项目 ID。")
    return user_dir(data_root, user_id) / "projects" / safe_pid


def delete_project_data(data_root: Path, user_id: str, project_id: str) -> bool:
    path = project_data_dir(data_root, user_id, project_id)
    if not path.is_dir():
        return False
    shutil.rmtree(path, ignore_errors=True)
    return True


def project_library_dir(data_root: Path, user_id: str, project_id: str) -> Path:
    safe_pid = re.sub(r"[^\w\-]", "_", (project_id or "").strip())
    if not safe_pid:
        raise ValueError("无效的项目 ID。")
    path = project_data_dir(data_root, user_id, project_id) / "library"
    path.mkdir(parents=True, exist_ok=True)
    (path / "files").mkdir(exist_ok=True)
    (path / "chunks").mkdir(exist_ok=True)
    return path


def list_users(data_root: Path) -> list[dict[str, Any]]:
    ensure_root(data_root)
    users_root = data_root / USERS_DIR
    if not users_root.is_dir():
        return []
    out: list[dict[str, Any]] = []
    for entry in sorted(users_root.iterdir()):
        if not entry.is_dir():
            continue
        profile = _read_json(entry / "profile.json", {})
        if not profile:
            continue
        out.append(
            {
                "user_id": profile.get("user_id") or entry.name,
                "display_name": profile.get("display_name") or entry.name,
                "identity_name": profile.get("identity_name") or profile.get("display_name") or entry.name,
                "persona_hint": profile.get("persona_hint") or "",
                "created_at": profile.get("created_at"),
            }
        )
    return out


def register_user(
    data_root: Path,
    display_name: str,
    *,
    persona_hint: str = "",
) -> dict[str, Any]:
    ensure_root(data_root)
    name = (display_name or "").strip()
    if not name:
        raise ValueError("身份名称不能为空。")
    user_id = f"u_{uuid.uuid4().hex[:12]}"
    udir = user_dir(data_root, user_id)
    udir.mkdir(parents=True, exist_ok=True)
    hint = (persona_hint or "").strip()
    profile = {
        "user_id": user_id,
        "display_name": name,
        "identity_name": name,
        "persona_hint": hint,
        "created_at": _now_iso(),
    }
    _write_json(udir / "profile.json", profile)
    default_state = default_user_state()
    _write_json(udir / "state.json", default_state)
    return profile


def default_user_state() -> dict[str, Any]:
    pid = f"p_{uuid.uuid4().hex[:8]}"
    cid = f"c_{uuid.uuid4().hex[:8]}"
    return {
        "projects": [
            {
                "id": pid,
                "name": "默认项目",
                "chats": [
                    {
                        "id": cid,
                        "title": "新对话",
                        "generateMessages": [],
                        "paper": "",
                        "topic": "",
                        "lastSavedPath": "",
                        "updatedAt": int(datetime.now().timestamp() * 1000),
                    }
                ],
                "currentChatId": cid,
                "generateMessages": [],
                "reviseMessages": [],
                "paper": "",
                "topic": "",
                "lastSavedPath": "",
                "createdAt": int(datetime.now().timestamp() * 1000),
            }
        ],
        "currentProjectId": pid,
        "saveFolder": "",
        "updated_at": _now_iso(),
    }


def load_user_state(data_root: Path, user_id: str) -> dict[str, Any]:
    udir = user_dir(data_root, user_id)
    if not udir.is_dir():
        raise FileNotFoundError("用户不存在。")
    state = _read_json(udir / "state.json", None)
    if state is None:
        state = default_user_state()
        _write_json(udir / "state.json", state)
    return state


def save_user_state(data_root: Path, user_id: str, state: dict[str, Any]) -> None:
    udir = user_dir(data_root, user_id)
    if not udir.is_dir():
        raise FileNotFoundError("用户不存在。")
    payload = dict(state)
    payload["updated_at"] = _now_iso()
    _write_json(udir / "state.json", payload)


def get_profile(data_root: Path, user_id: str) -> dict[str, Any]:
    udir = user_dir(data_root, user_id)
    profile = _read_json(udir / "profile.json", {})
    if not profile:
        raise FileNotFoundError("用户不存在。")
    return profile