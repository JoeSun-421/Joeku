from __future__ import annotations

import httpx


def make_http_client(*, timeout: float = 30.0, follow_redirects: bool = True) -> httpx.Client:
    """HTTP client that ignores system proxy env (avoids broken SOCKS proxy crashes)."""
    return httpx.Client(timeout=timeout, follow_redirects=follow_redirects, trust_env=False)