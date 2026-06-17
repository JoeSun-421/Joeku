from academic_agent.document_reader import extract_document, normalize_text


def test_extract_utf8_text_document() -> None:
    document = extract_document("paper.md", "# Title\n\nAcademic text".encode("utf-8"))
    assert document.extension == ".md"
    assert document.word_count == 4
    assert "Academic text" in document.text


def test_normalize_text_collapses_blank_runs() -> None:
    assert normalize_text("A\n\n\nB\r\n C ") == "A\n\nB\nC"
