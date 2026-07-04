from __future__ import annotations

from pydantic import BaseModel, Field

FONT_FAMILIES: dict[str, dict[str, str]] = {
    "times": {"label": "Times New Roman", "docx": "Times New Roman", "pdf": "times"},
    "simsun": {"label": "宋体", "docx": "宋体", "pdf": "simsun"},
    "yahei": {"label": "微软雅黑", "docx": "微软雅黑", "pdf": "yahei"},
    "arial": {"label": "Arial", "docx": "Arial", "pdf": "arial"},
}


class CoverPageOptions(BaseModel):
    title: str = ""
    subtitle: str = ""
    author: str = ""
    institution: str = ""
    course: str = ""
    instructor: str = ""
    date: str = ""


class ExportFormatOptions(BaseModel):
    font_family: str = Field(default="times")
    font_size: int = Field(default=12, ge=9, le=18)
    line_spacing: float = Field(default=1.5, ge=1.0, le=3.0)
    margin_inches: float = Field(default=1.25, ge=0.5, le=2.0)
    first_line_indent_chars: float = Field(default=0, ge=0, le=8)
    cover_page: CoverPageOptions | None = None

    def resolved_family(self) -> dict[str, str]:
        return FONT_FAMILIES.get(self.font_family, FONT_FAMILIES["times"])