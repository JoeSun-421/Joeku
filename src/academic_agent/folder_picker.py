from __future__ import annotations

import threading


def pick_folder_dialog() -> str | None:
    """Open a native folder picker dialog. Returns absolute path or None if cancelled."""
    result: list[str | None] = [None]
    error: list[Exception | None] = [None]

    def _run() -> None:
        try:
            import tkinter as tk
            from tkinter import filedialog

            root = tk.Tk()
            root.withdraw()
            root.attributes("-topmost", True)
            root.update()
            folder = filedialog.askdirectory(title="选择论文保存文件夹")
            root.destroy()
            result[0] = folder or None
        except Exception as exc:
            error[0] = exc

    thread = threading.Thread(target=_run)
    thread.start()
    thread.join(timeout=120)
    if error[0]:
        raise RuntimeError(f"无法打开文件夹选择对话框: {error[0]}") from error[0]
    return result[0]