from __future__ import annotations

import json
import os
import threading
import uuid
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any


@dataclass
class GenerationJob:
    job_id: str
    status: str = "pending"
    step: str = "init"
    percent: int = 0
    message: str = "准备中…"
    preview: str = ""
    result: dict[str, Any] | None = None
    error: str | None = None


_lock = threading.Lock()
_jobs: dict[str, GenerationJob] = {}
_JOBS_DIR = Path(os.environ.get("JOEKU_DATA", Path.home() / ".joeku")) / "jobs"


def _job_path(job_id: str) -> Path:
    return _JOBS_DIR / f"{job_id}.json"


def _persist(job: GenerationJob) -> None:
    try:
        _JOBS_DIR.mkdir(parents=True, exist_ok=True)
        payload = asdict(job)
        _job_path(job.job_id).write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    except OSError:
        pass


def _load_from_disk(job_id: str) -> GenerationJob | None:
    path = _job_path(job_id)
    if not path.is_file():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return GenerationJob(**data)
    except (OSError, json.JSONDecodeError, TypeError):
        return None


def create_job() -> str:
    job_id = uuid.uuid4().hex[:12]
    with _lock:
        job = GenerationJob(job_id=job_id)
        _jobs[job_id] = job
        _persist(job)
    return job_id


def update_job(job_id: str, *, step: str, percent: int, message: str, preview: str | None = None) -> None:
    with _lock:
        job = _jobs.get(job_id) or _load_from_disk(job_id)
        if not job:
            return
        job.status = "running"
        job.step = step
        job.percent = max(0, min(100, percent))
        job.message = message
        if preview is not None:
            job.preview = preview
        _jobs[job_id] = job
        _persist(job)


def complete_job(job_id: str, result: dict[str, Any]) -> None:
    with _lock:
        job = _jobs.get(job_id) or _load_from_disk(job_id)
        if not job:
            return
        job.status = "done"
        job.step = "done"
        job.percent = 100
        job.message = "生成完成"
        job.result = result
        _jobs[job_id] = job
        _persist(job)


def fail_job(job_id: str, error: str) -> None:
    with _lock:
        job = _jobs.get(job_id) or _load_from_disk(job_id)
        if not job:
            return
        job.status = "error"
        job.error = error
        job.message = error
        _jobs[job_id] = job
        _persist(job)


def get_job(job_id: str) -> GenerationJob | None:
    with _lock:
        job = _jobs.get(job_id)
        if job:
            return job
        job = _load_from_disk(job_id)
        if job:
            _jobs[job_id] = job
        return job


def prune_old_jobs(max_jobs: int = 80) -> None:
    with _lock:
        if len(_jobs) <= max_jobs:
            return
        for job_id in list(_jobs.keys())[:-max_jobs]:
            _jobs.pop(job_id, None)
    try:
        if not _JOBS_DIR.is_dir():
            return
        files = sorted(_JOBS_DIR.glob("*.json"), key=lambda p: p.stat().st_mtime, reverse=True)
        for path in files[max_jobs:]:
            path.unlink(missing_ok=True)
    except OSError:
        pass