from __future__ import annotations

import re
from pathlib import Path

from docx import Document
from docx.enum.text import WD_LINE_SPACING, WD_PARAGRAPH_ALIGNMENT
from docx.oxml.ns import qn
from docx.shared import Inches, Pt

from academic_agent.export_options import ExportFormatOptions


def markdown_to_docx(
    markdown_text: str,
    output_path: Path,
    *,
    title: str | None = None,
    options: ExportFormatOptions | None = None,
) -> Path:
    """Convert academic paper markdown to a Word (.docx) document."""
    opts = options or ExportFormatOptions()
    family = opts.resolved_family()["docx"]
    doc = Document()
    style = doc.styles["Normal"]
    style.font.name = family
    style.font.size = Pt(opts.font_size)
    if style._element.rPr is not None:
        style._element.rPr.rFonts.set(qn("w:eastAsia"), family)
    style.paragraph_format.line_spacing_rule = WD_LINE_SPACING.MULTIPLE
    style.paragraph_format.line_spacing = opts.line_spacing

    lines = markdown_text.splitlines()
    idx = 0
    doc_title = title

    while idx < len(lines):
        line = lines[idx].rstrip()
        idx += 1

        if not line.strip():
            continue

        if line.startswith("# ") and doc_title is None:
            doc_title = line[2:].strip()
            p = doc.add_heading(doc_title, level=0)
            p.alignment = WD_PARAGRAPH_ALIGNMENT.CENTER
            _apply_para_format(p, opts, family, heading_scale=1.35)
            continue

        if line.startswith("# "):
            p = doc.add_heading(line[2:].strip(), level=1)
            _apply_para_format(p, opts, family, heading_scale=1.25)
            continue

        if line.startswith("## "):
            p = doc.add_heading(line[3:].strip(), level=2)
            _apply_para_format(p, opts, family, heading_scale=1.12)
            continue

        if line.startswith("### "):
            p = doc.add_heading(line[4:].strip(), level=3)
            _apply_para_format(p, opts, family, heading_scale=1.05)
            continue

        if line.startswith("- ") or line.startswith("* "):
            p = doc.add_paragraph(line[2:].strip(), style="List Bullet")
            _apply_para_format(p, opts, family)
            continue

        if re.match(r"^\d+\.\s", line):
            p = doc.add_paragraph(re.sub(r"^\d+\.\s", "", line).strip(), style="List Number")
            _apply_para_format(p, opts, family)
            continue

        text = _strip_markdown_inline(line)
        if text.startswith("**") and text.endswith("**"):
            p = doc.add_paragraph()
            run = p.add_run(text.strip("*"))
            run.bold = True
            _style_run(run, family, opts.font_size)
            _apply_para_format(p, opts, family)
            continue

        p = doc.add_paragraph()
        _add_inline_formatted(p, line, family=family, font_size=opts.font_size)
        _apply_para_format(p, opts, family)

    margin = Inches(opts.margin_inches)
    for section in doc.sections:
        section.top_margin = margin
        section.bottom_margin = margin
        section.left_margin = margin
        section.right_margin = margin

    output_path = Path(output_path)
    if output_path.suffix.lower() not in {".docx", ".doc"}:
        output_path = output_path.with_suffix(".docx")
    output_path.parent.mkdir(parents=True, exist_ok=True)
    doc.save(str(output_path))
    return output_path


def _apply_para_format(paragraph, opts: ExportFormatOptions, family: str, *, heading_scale: float = 1.0) -> None:
    fmt = paragraph.paragraph_format
    fmt.line_spacing_rule = WD_LINE_SPACING.MULTIPLE
    fmt.line_spacing = opts.line_spacing
    for run in paragraph.runs:
        _style_run(run, family, int(opts.font_size * heading_scale))


def _style_run(run, family: str, size: int) -> None:
    run.font.name = family
    run.font.size = Pt(size)
    if run._element.rPr is not None:
        run._element.rPr.rFonts.set(qn("w:eastAsia"), family)


def _strip_markdown_inline(text: str) -> str:
    text = re.sub(r"\[(.+?)\]\((https?://[^)]+)\)", r"\1 (\2)", text)
    text = re.sub(r"\*\*(.+?)\*\*", r"\1", text)
    text = re.sub(r"\*(.+?)\*", r"\1", text)
    text = re.sub(r"`(.+?)`", r"\1", text)
    return text


def _add_inline_formatted(paragraph, text: str, *, family: str, font_size: int) -> None:
    pattern = re.compile(r"(\*\*.+?\*\*|\*.+?\*|`[^`]+`|\[[^\]]+\]\([^)]+\))")
    pos = 0
    for match in pattern.finditer(text):
        if match.start() > pos:
            run = paragraph.add_run(_strip_markdown_inline(text[pos : match.start()]))
            _style_run(run, family, font_size)
        token = match.group(0)
        if token.startswith("**") and token.endswith("**"):
            run = paragraph.add_run(token[2:-2])
            run.bold = True
            _style_run(run, family, font_size)
        elif token.startswith("*") and token.endswith("*"):
            run = paragraph.add_run(token[1:-1])
            run.italic = True
            _style_run(run, family, font_size)
        elif token.startswith("`") and token.endswith("`"):
            run = paragraph.add_run(token[1:-1])
            run.font.name = "Consolas"
            run.font.size = Pt(font_size)
        elif token.startswith("["):
            m = re.match(r"\[(.+?)\]\((.+?)\)", token)
            if m:
                run = paragraph.add_run(f"{m.group(1)} ({m.group(2)})")
                _style_run(run, family, font_size)
        pos = match.end()
    if pos < len(text):
        run = paragraph.add_run(_strip_markdown_inline(text[pos:]))
        _style_run(run, family, font_size)