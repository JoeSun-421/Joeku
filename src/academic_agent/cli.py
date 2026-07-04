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

app = typer.Typer(
    help="Academic search, verification, analysis, and long-form writing agent.",
    add_completion=False,
)
console = Console()


@app.callback(invoke_without_command=True)
def main(ctx: typer.Context) -> None:
    """Default behavior: launch the desktop app.

    So after install, users can simply run:
        academic-agent
    instead of academic-agent desktop
    """
    if ctx.invoked_subcommand is None:
        try:
            from academic_agent.desktop import run_desktop
        except ImportError:
            console.print("[red]pywebview not installed — cannot open native desktop window.[/red]")
            console.print("Run this to enable the proper app window:")
            console.print("  uv add pywebview")
            console.print("or")
            console.print("  pip install pywebview")
            console.print("")
            console.print("Then run 'academic-agent' again.")
            console.print("If you really want the raw server, use: academic-agent web")
            raise SystemExit(1)
        console.print("[green]Starting Joeku Desktop (native window)...[/green]")
        run_desktop()


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
    """Run the local server only (for advanced use or custom browser).

    This starts the backend but does NOT auto-open anything.
    For the normal desktop app experience, just run `academic-agent` (or `academic-agent desktop`).
    """
    import uvicorn

    url = f"http://{host}:{port}"
    console.print(f"[green]Starting Joeku server[/green] at {url}")
    if host not in ("127.0.0.1", "localhost"):
        console.print("[yellow]注意：正在以公开地址模式启动。确保设置了 DEFAULT_DATA_ROOT 并做好安全措施（防火墙 / 认证）。[/yellow]")
    console.print("Open this URL manually in your browser if needed.")
    console.print("Tip: For the native window experience use the default command instead.")

    uvicorn.run("academic_agent.web:app", host=host, port=port, reload=False)


@app.command()
def desktop(
    port: Annotated[int, typer.Option("--port", "-p", help="Port to use (0 = auto pick free port)")] = 0,
    dev: Annotated[bool, typer.Option("--dev", help="Open with developer tools (debug)")] = False,
) -> None:
    """Launch Joeku as a native desktop application (recommended).

    Opens in a proper window instead of requiring you to manually visit localhost.
    After cloning the repo and installing, just run:

        academic-agent desktop
    """
    try:
        from academic_agent.desktop import run_desktop
    except ImportError as exc:
        console.print(
            "[red]pywebview is required for desktop mode.[/red]\n"
            "Install it with: pip install pywebview\n"
            "or: uv add pywebview"
        )
        raise SystemExit(1) from exc

    console.print("[green]Starting Joeku Desktop...[/green]")
    run_desktop(port=port, open_devtools=dev)


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
