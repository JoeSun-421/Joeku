from __future__ import annotations

import re
from pathlib import Path

from fpdf import FPDF

from academic_agent.export_options import ExportFormatOptions


def _strip_md(text: str) -> str:
    text = re.sub(r"\[(.+?)\]\((https?://[^)]+)\)", r"\1 (\2)", text)
    text = re.sub(r"\*\*(.+?)\*\*", r"\1", text)
    text = re.sub(r"\*(.+?)\*", r"\1", text)
    text = re.sub(r"`([^`]+)`", r"\1", text)
    return text


def _latin_safe(text: str) -> str:
    try:
        text.encode("latin-1")
        return text
    except UnicodeEncodeError:
        return text.encode("latin-1", errors="replace").decode("latin-1")


def _pick_font(preferred: str) -> tuple[str, str | None]:
    preferred = (preferred or "times").lower()
    mapping = {
        "times": [
            Path("C:/Windows/Fonts/times.ttf"),
            Path("C:/Windows/Fonts/timesnr.ttf"),
        ],
        "simsun": [Path("C:/Windows/Fonts/simsun.ttc"), Path("C:/Windows/Fonts/simsun.ttf")],
        "yahei": [Path("C:/Windows/Fonts/msyh.ttc"), Path("C:/Windows/Fonts/msyh.ttf")],
        "arial": [Path("C:/Windows/Fonts/arial.ttf")],
    }
    fallbacks = [
        Path("C:/Windows/Fonts/msyh.ttc"),
        Path("C:/Windows/Fonts/simsun.ttc"),
        Path("/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc"),
        Path("/System/Library/Fonts/PingFang.ttc"),
    ]
    for path in mapping.get(preferred, []) + fallbacks:
        if path.is_file():
            return "UnicodeFont", str(path)
    return "Helvetica", None


class AcademicPDF(FPDF):
    def footer(self) -> None:
        self.set_y(-15)
        self.set_font(self.font_family, "", 9)
        self.set_text_color(120, 120, 120)
        self.cell(0, 10, f"Page {self.page_no()}", align="C")


def markdown_to_pdf(
    markdown_text: str,
    output_path: Path,
    *,
    title: str | None = None,
    options: ExportFormatOptions | None = None,
) -> Path:
    opts = options or ExportFormatOptions()
    family_key = opts.resolved_family()["pdf"]
    family, font_path = _pick_font(family_key)
    body_size = opts.font_size
    line_h = body_size * opts.line_spacing * 0.52
    margin = opts.margin_inches * 25.4

    pdf = AcademicPDF()
    pdf.set_auto_page_break(auto=True, margin=margin)
    pdf.set_margins(margin, margin, margin)
    if font_path:
        pdf.add_font(family, "", font_path)
        pdf.set_font(family, "", body_size)
    else:
        pdf.set_font("Helvetica", "", body_size)
    if opts.cover_page:
        cover = opts.cover_page
        pdf.ln(40)
        for text, scale in (
            (cover.title, 1.6),
            (cover.subtitle, 1.1),
            ("", 1.0),
            (cover.author, 1.0),
            (cover.institution, 1.0),
            (cover.course, 1.0),
            (cover.instructor, 1.0),
            (cover.date, 1.0),
        ):
            if not (text or "").strip():
                pdf.ln(line_h)
                continue
            pdf.set_font(family, "", int(body_size * scale))
            pdf.multi_cell(0, line_h * 1.2, text if font_path else _latin_safe(text), align="C")
            pdf.ln(line_h * 0.4)
        pdf.set_font(family, "", body_size)
        pdf.add_page()
    else:
        pdf.add_page()

    in_references = False

    for raw in markdown_text.splitlines():
        line = raw.rstrip()
        if not line.strip():
            pdf.ln(line_h * 0.6)
            continue
        text = _strip_md(line)
        safe = text if font_path else _latin_safe(text)

        if line.startswith("# "):
            pdf.set_font(family, "", int(body_size * 1.45))
            pdf.multi_cell(0, line_h * 1.35, safe)
            pdf.ln(2)
            pdf.set_font(family, "", body_size)
            continue
        if line.startswith("## "):
            heading = line[3:].strip().lower()
            in_references = heading in {
                "references",
                "works cited",
                "bibliography",
                "verification checklist",
                "参考文献",
            }
            pdf.set_font(family, "", int(body_size * 1.2))
            pdf.multi_cell(0, line_h * 1.15, safe)
            pdf.ln(1)
            pdf.set_font(family, "", body_size)
            continue
        if line.startswith("### "):
            pdf.set_font(family, "", int(body_size * 1.08))
            pdf.multi_cell(0, line_h * 1.05, safe)
            pdf.ln(1)
            pdf.set_font(family, "", body_size)
            continue
        if line.startswith("- ") or line.startswith("* "):
            pdf.multi_cell(0, line_h, "  • " + safe)
            continue
        if not in_references and opts.first_line_indent_chars > 0:
            indent_mm = opts.first_line_indent_chars * body_size * 0.45
            pdf.set_x(pdf.l_margin + indent_mm)
            pdf.multi_cell(0, line_h, safe)
            pdf.set_x(pdf.l_margin)
        else:
            pdf.multi_cell(0, line_h, safe)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    pdf.output(str(output_path))
    return output_path