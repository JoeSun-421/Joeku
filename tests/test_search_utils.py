from academic_agent.search import dedupe_papers, inverted_index_to_text, normalize_title
from academic_agent.models import Paper, SourceName


def test_inverted_index_to_text() -> None:
    assert inverted_index_to_text({"hello": [0], "world": [1]}) == "hello world"


def test_normalize_title() -> None:
    assert normalize_title("Retrieval-Augmented Generation!") == "retrievalaugmentedgeneration"


def test_dedupe_keeps_order_and_prefers_better_duplicate() -> None:
    papers = [
        Paper(title="First", doi="10.1/first", citation_count=2, source=SourceName.CROSSREF),
        Paper(title="Same", doi="10.1/example", citation_count=2, source=SourceName.CROSSREF),
        Paper(title="Same", doi="10.1/example", abstract="better", citation_count=10, source=SourceName.OPENALEX),
    ]
    unique = dedupe_papers(papers)
    assert len(unique) == 2
    assert unique[0].title == "First"
    assert unique[1].citation_count == 10
