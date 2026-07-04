from __future__ import annotations

import subprocess
import sys


_PICKER_SCRIPT = """
import tkinter as tk
from tkinter import filedialog

root = tk.Tk()
root.withdraw()
root.attributes("-topmost", True)
root.update_idletasks()
root.update()
folder = filedialog.askdirectory(title="选择 Joeku 本地数据目录")
root.destroy()
if folder:
    print(folder, end="")
"""


def pick_folder_dialog() -> str | None:
    """Open a native folder picker. Uses a subprocess so tkinter runs on Windows reliably."""
    try:
        completed = subprocess.run(
            [sys.executable, "-c", _PICKER_SCRIPT],
            capture_output=True,
            text=True,
            timeout=180,
            check=False,
        )
    except subprocess.TimeoutExpired:
        raise RuntimeError("文件夹选择超时，请重试或直接输入路径。") from None
    except OSError as exc:
        raise RuntimeError(f"无法启动文件夹选择器: {exc}") from exc

    if completed.returncode != 0 and completed.stderr.strip():
        raise RuntimeError(f"文件夹选择器错误: {completed.stderr.strip()[:300]}")

    folder = (completed.stdout or "").strip()
    return folder or None