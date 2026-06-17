from __future__ import annotations

import json
from pathlib import Path
from typing import Annotated

import typer
from rich.console import Console
from rich.table import Table

from academic_agent.analyze import StructureAnalyzer
from academic_agent.citation import CitationVerifier
from academic_agent.models import Paper
from academic_agent.search import AcademicSearcher
from academic_agent.writer import LongFormWriter

app = typer.Typer(help="Academic search, verification, analysis, and long-form writing agent.")
console = Console()


@app.command()
def search(
    query: Annotated[str, typer.Argument(help="Academic search query.")],
    limit: Annotated[int, typer.Option("--limit", "-n", min=1, max=50)] = 10,
    jsonl: Annotated[bool, typer.Option("--jsonl", help="Print JSON lines instead of a table.")] = False,
) -> None:
    """Search academic sources and merge duplicate records."""
    papers = AcademicSearcher().search(query, limit=limit)
    if jsonl:
        for paper in papers:
            console.print(json.dumps(paper.model_dump(mode="json"), ensure_ascii=False))
        return
    render_paper_table(papers)


@app.command()
def verify(
    doi: Annotated[str | None, typer.Option("--doi", help="DOI to verify.")] = None,
    arxiv_id: Annotated[str | None, typer.Option("--arxiv", help="arXiv id to verify.")] = None,
    title: Annotated[str | None, typer.Option("--title", help="Paper title to verify.")] = None,
) -> None:
    """Verify a citation by DOI, arXiv id, or title."""
    result = CitationVerifier().verify(doi=doi, arxiv_id=arxiv_id, title=title)
    console.print_json(result.model_dump_json(indent=2))


@app.command()
def analyze(
    path: Annotated[Path, typer.Argument(exists=True, dir_okay=False, readable=True)],
    output: Annotated[Path | None, typer.Option("--output", "-o", help="Write analysis to a Markdown file.")] = None,
) -> None:
    """Analyze academic manuscript structure."""
    result = StructureAnalyzer().analyze_file(path)
    if output:
        output.write_text(result, encoding="utf-8")
        console.print(f"[green]Wrote analysis to[/green] {output}")
    else:
        console.print(result)


@app.command()
def write(
    topic: Annotated[str, typer.Argument(help="Paper topic or research question.")],
    words: Annotated[int, typer.Option("--words", "-w", min=3000, max=30000)] = 5000,
    search_limit: Annotated[int, typer.Option("--search-limit", min=0, max=50)] = 15,
    citations: Annotated[int, typer.Option("--citations", "-c", min=0, max=80, help="Target number of references to include.")] = 15,
    output: Annotated[Path, typer.Option("--output", "-o", help="Markdown output path.")] = Path("paper-draft.md"),
) -> None:
    """Generate a 3k-30k word standalone academic paper draft. Use --citations to specify reference count."""
    console.print("[cyan]Searching sources and planning draft...[/cyan]")
    document = LongFormWriter().write(
        topic, target_words=words, search_limit=search_limit, citation_limit=citations, output_path=output
    )
    actual_words = len(document.split())
    console.print(f"[green]Wrote draft to[/green] {output} [dim]({actual_words} words generated in current pass)[/dim]")


@app.command()
def web(
    host: Annotated[str, typer.Option("--host", help="Host interface for the local web app.")] = "127.0.0.1",
    port: Annotated[int, typer.Option("--port", "-p", min=1, max=65535)] = 8000,
) -> None:
    """Run the drag-and-drop browser interface."""
    import uvicorn

    console.print(f"[green]Starting Joeku[/green] http://{host}:{port}")
    uvicorn.run("academic_agent.web:app", host=host, port=port, reload=False)


def render_paper_table(papers: list[Paper]) -> None:
    table = Table(show_lines=True)
    table.add_column("#", justify="right", style="dim", width=4)
    table.add_column("Title", overflow="fold")
    table.add_column("Year", width=6)
    table.add_column("Source", width=18)
    table.add_column("DOI / arXiv", overflow="fold")
    for index, paper in enumerate(papers, start=1):
        identifier = paper.doi or paper.arxiv_id or ""
        table.add_row(str(index), paper.title, str(paper.year or ""), paper.source.value, identifier)
    console.print(table)


if __name__ == "__main__":
    app()
