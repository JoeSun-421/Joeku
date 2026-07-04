from __future__ import annotations

import json
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from academic_agent.document_reader import SUPPORTED_EXTENSIONS, extract_document
from academic_agent.http_utils import make_http_client
from academic_agent.local_store import project_data_dir, project_library_dir


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _index_path(lib_root: Path) -> Path:
    return lib_root / "index.json"


def _read_index(lib_root: Path) -> dict[str, Any]:
    path = _index_path(lib_root)
    if not path.is_file():
        return {"items": [], "updated_at": _now_iso()}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return {"items": [], "updated_at": _now_iso()}


def _write_index(lib_root: Path, data: dict[str, Any]) -> None:
    data["updated_at"] = _now_iso()
    _index_path(lib_root).write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def _chunk_text(text: str, *, chunk_size: int = 1200, overlap: int = 150) -> list[str]:
    if not text:
        return []
    chunks: list[str] = []
    start = 0
    length = len(text)
    while start < length:
        end = min(length, start + chunk_size)
        piece = text[start:end].strip()
        if piece:
            chunks.append(piece)
        if end >= length:
            break
        start = max(0, end - overlap)
    return chunks


def list_items(data_root: Path, user_id: str, project_id: str) -> list[dict[str, Any]]:
    lib = project_data_dir(data_root, user_id, project_id) / "library"
    if not lib.is_dir():
        return []
    index = _read_index(lib)
    return list(index.get("items") or [])


def _strip_html(html: str) -> str:
    text = re.sub(r"(?is)<(script|style)[^>]*>.*?</\1>", " ", html)
    text = re.sub(r"(?s)<[^>]+>", " ", text)
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def _fetch_url_text(url: str) -> str:
    with make_http_client(timeout=25.0) as client:
        response = client.get(url, headers={"User-Agent": "Joeku/1.0"})
        response.raise_for_status()
        content_type = (response.headers.get("content-type") or "").lower()
        body = response.text
    if "html" in content_type or "<html" in body[:500].lower():
        body = _strip_html(body)
    return body.strip()


def add_url_item(data_root: Path, user_id: str, project_id: str, url: str) -> dict[str, Any]:
    cleaned = (url or "").strip()
    if not cleaned.lower().startswith(("http://", "https://")):
        raise ValueError("请输入有效的 http(s) 链接。")
    text = _fetch_url_text(cleaned)
    if len(text) < 40:
        raise ValueError("未能从该链接提取到足够正文，请换用 PDF 或文档上传。")
    slug = re.sub(r"[^\w.\-]", "_", cleaned.split("://", 1)[-1])[:80] or "webpage"
    filename = f"{slug}.txt"
    return add_text_item(data_root, user_id, project_id, filename, text, source_url=cleaned)


def add_text_item(
    data_root: Path,
    user_id: str,
    project_id: str,
    filename: str,
    text: str,
    *,
    source_url: str = "",
) -> dict[str, Any]:
    lib = project_library_dir(data_root, user_id, project_id)
    ref_id = f"ref_{uuid.uuid4().hex[:10]}"
    safe_name = re.sub(r"[^\w.\-]", "_", Path(filename).name)[:120] or "document.txt"
    stored = lib / "files" / f"{ref_id}_{safe_name}"
    stored.write_text(text, encoding="utf-8")

    chunks = _chunk_text(text)
    chunk_path = lib / "chunks" / f"{ref_id}.json"
    chunk_path.parent.mkdir(parents=True, exist_ok=True)
    chunk_path.write_text(json.dumps(chunks, ensure_ascii=False), encoding="utf-8")

    preview = text[:400].replace("\n", " ")
    item = {
        "id": ref_id,
        "filename": filename,
        "stored_name": stored.name,
        "extension": Path(filename).suffix.lower() or ".txt",
        "word_count": len(text.split()),
        "char_count": len(text),
        "preview": preview,
        "enabled": True,
        "chunk_count": len(chunks),
        "added_at": _now_iso(),
        "source_url": source_url,
    }

    index = _read_index(lib)
    items = list(index.get("items") or [])
    items.insert(0, item)
    index["items"] = items
    _write_index(lib, index)
    return item


def add_item(data_root: Path, user_id: str, project_id: str, filename: str, content: bytes) -> dict[str, Any]:
    lib = project_library_dir(data_root, user_id, project_id)
    ext = Path(filename).suffix.lower()
    if ext not in SUPPORTED_EXTENSIONS:
        supported = ", ".join(sorted(SUPPORTED_EXTENSIONS))
        raise ValueError(f"不支持的文件类型。支持：{supported}")

    extracted = extract_document(filename, content)
    ref_id = f"ref_{uuid.uuid4().hex[:10]}"
    safe_name = re.sub(r"[^\w.\-]", "_", Path(filename).name)[:120] or "document"
    stored = lib / "files" / f"{ref_id}_{safe_name}"
    stored.write_bytes(content)

    chunks = _chunk_text(extracted.text)
    chunk_path = lib / "chunks" / f"{ref_id}.json"
    chunk_path.parent.mkdir(parents=True, exist_ok=True)
    chunk_path.write_text(json.dumps(chunks, ensure_ascii=False), encoding="utf-8")

    preview = extracted.text[:400].replace("\n", " ")
    item = {
        "id": ref_id,
        "filename": filename,
        "stored_name": stored.name,
        "extension": ext,
        "word_count": extracted.word_count,
        "char_count": extracted.char_count,
        "preview": preview,
        "enabled": True,
        "chunk_count": len(chunks),
        "added_at": _now_iso(),
    }

    index = _read_index(lib)
    items = list(index.get("items") or [])
    items.insert(0, item)
    index["items"] = items
    _write_index(lib, index)
    return item


def delete_item(data_root: Path, user_id: str, project_id: str, ref_id: str) -> bool:
    lib = project_library_dir(data_root, user_id, project_id)
    index = _read_index(lib)
    items = list(index.get("items") or [])
    kept: list[dict[str, Any]] = []
    removed = False
    for item in items:
        if item.get("id") == ref_id:
            removed = True
            stored = lib / "files" / item.get("stored_name", "")
            if stored.is_file():
                stored.unlink(missing_ok=True)
            chunk = lib / "chunks" / f"{ref_id}.json"
            if chunk.is_file():
                chunk.unlink(missing_ok=True)
            continue
        kept.append(item)
    if removed:
        index["items"] = kept
        _write_index(lib, index)
    return removed


def set_item_enabled(
    data_root: Path, user_id: str, project_id: str, ref_id: str, enabled: bool
) -> dict[str, Any] | None:
    lib = project_library_dir(data_root, user_id, project_id)
    index = _read_index(lib)
    items = list(index.get("items") or [])
    for item in items:
        if item.get("id") == ref_id:
            item["enabled"] = enabled
            index["items"] = items
            _write_index(lib, index)
            return item
    return None


def _load_chunks(lib: Path, ref_id: str) -> list[str]:
    chunk_path = lib / "chunks" / f"{ref_id}.json"
    if not chunk_path.is_file():
        return []
    try:
        data = json.loads(chunk_path.read_text(encoding="utf-8"))
        return data if isinstance(data, list) else []
    except (json.JSONDecodeError, OSError):
        return []


def retrieve_for_topic(
    data_root: Path,
    user_id: str,
    project_id: str,
    topic: str,
    *,
    library_ids: list[str] | None = None,
    limit: int = 5,
) -> str:
    if not (project_id or "").strip():
        return ""
    lib = project_library_dir(data_root, user_id, project_id)
    index = _read_index(lib)
    items = [i for i in (index.get("items") or []) if i.get("enabled", True)]
    if library_ids:
        allowed = set(library_ids)
        items = [i for i in items if i.get("id") in allowed]
    if not items:
        return ""

    words = set(re.findall(r"[\u4e00-\u9fff]{2,}|[A-Za-z]{3,}", (topic or "").lower()))
    scored: list[tuple[int, str, dict[str, Any]]] = []

    for item in items:
        ref_id = item.get("id", "")
        for chunk in _load_chunks(lib, ref_id):
            hay = chunk.lower()
            score = sum(1 for w in words if w in hay) if words else 1
            if score > 0:
                scored.append((score, chunk, item))

    scored.sort(key=lambda x: x[0], reverse=True)
    lines: list[str] = []
    for idx, (_, chunk, item) in enumerate(scored[:limit], start=1):
        title = item.get("filename") or "资料"
        ref_id = item.get("id") or "?"
        lines.append(f"[用户资料 {idx}] id={ref_id} | 文件: {title}\n{chunk[:1800]}")
    return "\n\n".join(lines)