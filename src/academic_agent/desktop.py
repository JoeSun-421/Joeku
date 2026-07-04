"""Desktop app launcher using pywebview for a native window experience.

This makes the app feel like a real desktop application instead of
"run server then open localhost in browser".
"""

from __future__ import annotations

import socket
import threading
import time
from contextlib import closing
from pathlib import Path

import uvicorn
import webview

from importlib.resources import files


def _find_free_port() -> int:
    """Find an available port on localhost."""
    with closing(socket.socket(socket.AF_INET, socket.SOCK_STREAM)) as s:
        s.bind(("", 0))
        s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        return s.getsockname()[1]


def _wait_for_server(url: str, timeout: float = 6.0) -> bool:
    """Poll the health endpoint until the server is ready."""
    import httpx

    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            resp = httpx.get(f"{url}/api/health", timeout=0.6)
            if resp.status_code == 200:
                return True
        except Exception:
            pass
        time.sleep(0.15)
    return False


def _get_icon_path() -> str | None:
    """Try to find a suitable icon for the window."""
    candidates = [
        Path("Joeku.ico"),
        Path("src/academic_agent/static/joeku.ico"),
    ]
    for p in candidates:
        if p.exists():
            return str(p.resolve())

    # Try package data
    try:
        icon = files("academic_agent").joinpath("static/joeku.ico")
        if icon.is_file():
            return str(icon)
    except Exception:
        pass
    return None


def run_desktop(port: int | None = None, *, open_devtools: bool = False) -> None:
    """
    Start the FastAPI backend in a background thread and open it
    inside a native desktop window using pywebview.

    This is the recommended way for end users after `pip install -e .`
    or `uv sync`.
    """
    if port is None or port <= 0:
        port = _find_free_port()

    host = "127.0.0.1"
    url = f"http://{host}:{port}"

    def _server_worker() -> None:
        # Keep logs quiet so the desktop app feels clean
        config = uvicorn.Config(
            "academic_agent.web:app",
            host=host,
            port=port,
            log_level="warning",
            access_log=False,
            loop="asyncio",
        )
        server = uvicorn.Server(config)
        server.run()

    server_thread = threading.Thread(target=_server_worker, daemon=True, name="joeku-server")
    server_thread.start()

    # Wait for the server to be responsive
    ready = _wait_for_server(url, timeout=8.0)
    if not ready:
        print(f"[Joeku] Warning: Server at {url} may not be fully ready yet.")

    icon = _get_icon_path()

    window_title = "Joeku"

    create_kwargs = dict(
        title=window_title,
        url=url,
        width=1360,
        height=880,
        min_size=(980, 640),
        resizable=True,
        frameless=True,
        easy_drag=False,          # We provide our own titlebar drag region
        text_select=True,
        confirm_close=False,
        background_color="#0a0c12",  # Match the app's dark bg
    )
    if icon:
        create_kwargs["icon"] = icon

    # Force an embedded webview (not the system browser) for true desktop window feel.
    # On Windows this uses Edge WebView2 (native control, not a browser tab).
    import platform
    system = platform.system().lower()
    if system == "windows":
        gui = "edgechromium"
    elif system == "darwin":
        gui = "cocoa"
    else:
        gui = "gtk"

    try:
        win = webview.create_window(**create_kwargs)

        # Expose a tiny API for the frontend to control the window
        class Api:
            def minimize(self):
                win.minimize()

            def toggle_maximize(self):
                if win.maximized:
                    win.restore()
                else:
                    win.maximize()

            def close(self):
                win.destroy()

        win.js_api = Api()

        print(f"[Joeku] Using embedded webview gui='{gui}' (should be a native app window, NOT a browser tab).")
        # Start the GUI event loop. This blocks until the window is closed.
        webview.start(debug=open_devtools, gui=gui)
    except Exception as exc:
        print(f"[Joeku] Failed to create native window: {exc}")
        print("Falling back to printing the URL. You can open it manually if pywebview/webview2 is missing.")
        print(f"URL: {url}")
        # Do not auto open browser here. User can copy the URL.
        # Keep the server running in foreground so they can use it.
        # (the thread is daemon so main thread keeps it alive? Wait, uvicorn is running in thread.
        # For fallback, just let it run the server in main? But to keep simple, just inform.
        import time
        while True:
            time.sleep(3600)  # keep process alive so server thread continues


if __name__ == "__main__":
    run_desktop()
