"""Build joeku.ico from the Joeku app icon design (matches icon.svg)."""
from __future__ import annotations

import math
from pathlib import Path

from PIL import Image, ImageDraw


def _lerp(a: int, b: int, t: float) -> int:
    return int(a + (b - a) * t)


def _bg_color(x: int, y: int, size: int) -> tuple[int, int, int, int]:
    t = (x / size * 0.55 + y / size * 0.45)
    t = max(0.0, min(1.0, t))
    return (
        _lerp(10, 3, t),
        _lerp(22, 5, t),
        _lerp(40, 8, t),
        255,
    )


def render_icon(size: int) -> Image.Image:
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    px = img.load()
    cx = cy = size / 2
    radius = size * 0.46
    corner = size * 0.22

    for y in range(size):
        for x in range(size):
            dx = max(abs(x - cx) - (radius - corner), 0)
            dy = max(abs(y - cy) - (radius - corner), 0)
            dist = math.hypot(dx, dy) - corner
            if dist <= 0:
                px[x, y] = _bg_color(x, y, size)

    draw = ImageDraw.Draw(img)
    inset = size * 0.03
    draw.rounded_rectangle(
        (inset, inset, size - inset, size - inset),
        radius=size * 0.2,
        outline=(56, 189, 248, 52),
        width=max(1, size // 170),
    )

    for r, color, width, dash in (
        (0.305, (34, 211, 238, 140), max(1, size // 100), True),
        (0.225, (99, 102, 241, 90), max(1, size // 120), False),
    ):
        ring_r = size * r
        if dash:
            steps = 120
            for i in range(0, steps, 2):
                a0 = 2 * math.pi * i / steps
                a1 = 2 * math.pi * (i + 1) / steps
                draw.arc(
                    (cx - ring_r, cy - ring_r, cx + ring_r, cy + ring_r),
                    math.degrees(a0),
                    math.degrees(a1),
                    fill=color,
                    width=width,
                )
        else:
            draw.ellipse(
                (cx - ring_r, cy - ring_r, cx + ring_r, cy + ring_r),
                outline=color,
                width=width,
            )

    tilt_rx, tilt_ry = size * 0.35, size * 0.11
    for deg in range(0, 360, 6):
        rad = math.radians(deg - 24)
        x = cx + tilt_rx * math.cos(rad)
        y = cy + tilt_ry * math.sin(rad)
        draw.ellipse((x - 1, y - 1, x + 1, y + 1), fill=(34, 211, 238, 64))

    j_left = size * 0.42
    j_top = size * 0.31
    j_bottom = size * 0.69
    j_bar_right = size * 0.58
    j_hook_bottom = size * 0.56
    j_th = max(2, size // 14)
    draw.rounded_rectangle(
        (j_left, j_top, j_left + j_th, j_bottom),
        radius=j_th // 2,
        fill=(125, 211, 252, 255),
    )
    draw.rounded_rectangle(
        (j_left, j_top, j_bar_right, j_top + j_th),
        radius=j_th // 2,
        fill=(224, 242, 254, 255),
    )
    draw.pieslice(
        (j_bar_right - j_th * 2.2, j_hook_bottom - j_th * 2.5, j_bar_right + j_th, j_hook_bottom + j_th * 0.8),
        start=0,
        end=90,
        fill=(125, 211, 252, 255),
    )

    draw.ellipse((size * 0.71, size * 0.24, size * 0.76, size * 0.29), fill=(34, 211, 238, 230))
    draw.ellipse((size * 0.24, size * 0.69, size * 0.28, size * 0.73), fill=(129, 140, 248, 210))

    return img


def build_ico(path: Path) -> None:
    base = render_icon(256)
    sizes = [(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
    path.parent.mkdir(parents=True, exist_ok=True)
    base.save(path, format="ICO", sizes=sizes)
    print(f"Wrote {path} ({path.stat().st_size} bytes)")


if __name__ == "__main__":
    root = Path(__file__).resolve().parents[1]
    static_ico = root / "src" / "academic_agent" / "static" / "joeku.ico"
    root_ico = root / "Joeku.ico"
    build_ico(static_ico)
    root_ico.write_bytes(static_ico.read_bytes())
    print(f"Copied -> {root_ico}")