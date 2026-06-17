from __future__ import annotations

import os
import platform
import subprocess
from pathlib import Path


def open_in_file_manager(path: str) -> str:
    """Open a folder (or the parent of a file) in the system file manager."""
    target = Path(path).expanduser().resolve()
    folder = target if target.is_dir() else target.parent
    if not folder.exists():
        raise FileNotFoundError(f"路径不存在: {folder}")

    system = platform.system()
    if system == "Windows":
        os.startfile(folder)  # type: ignore[attr-defined]
    elif system == "Darwin":
        subprocess.run(["open", str(folder)], check=True)
    else:
        subprocess.run(["xdg-open", str(folder)], check=True)
    return str(folder)