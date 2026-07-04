# Joeku

Joeku is an academic writing tool for generating long-form papers with proper citations. It works with any model that follows the OpenAI chat completions API, including DeepSeek, OpenAI, Ollama, and other local or self-hosted backends.

The tool handles literature search across several public sources, citation checking, document structure analysis, and step-by-step generation of papers between 3,000 and 30,000 words. It also includes a web interface for uploading documents, managing a personal reference library per project, and reviewing suggestions for improving citations and arguments.

Everything runs on your machine by default. API keys are sent directly from the browser when you use the web interface, and your documents and generated work stay in a folder you control. The same server can be deployed if you want others to access it over the web.

## Features

- Search academic sources using OpenAlex, Semantic Scholar, arXiv, and Crossref
- Verify citations by DOI, arXiv ID, or title
- Analyze the structure of existing papers or drafts
- Generate complete papers section by section, with citations pulled from real sources
- Review citations in an uploaded document and receive targeted improvement notes
- Maintain a project library of PDFs, documents, and web pages for reuse
- Export finished work to DOCX or PDF with configurable formatting
- Run locally or deploy the web server

## Requirements

- Python 3.10 or newer
- An API key for an OpenAI-compatible service (or a local model server)
- uv is recommended for installation, but pip and venv also work

## Installation

Clone the repository and set up the environment:

```bash
git clone https://github.com/your-username/academic-agent.git
cd academic-agent

uv sync
```

Or using the standard tools:

```bash
python -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -e .
```

Copy the example environment file if you prefer to configure defaults there:

```bash
cp .env.example .env
```

## Running the Application

The recommended way to use Joeku is through the desktop interface:

```bash
academic-agent desktop
```

This opens a native window. On Windows you can also double-click `Joeku.bat` after the first setup.

If you prefer to use your browser:

```bash
academic-agent web
```

Then open http://127.0.0.1:8000.

When the interface loads, enter your model details in the login form:

- Base URL (for example `https://api.deepseek.com/v1` or `http://localhost:11434/v1`)
- API key
- Model name

The key is only stored in your browser for that session.

## Using the Web Interface

- Drag documents into the interface to extract text
- Use the chat area for questions, planning, or revisions
- Switch to Generate mode to produce a full paper with a chosen word count and citation target
- The library sidebar lets you attach reference material to a project
- Citation verification and structure analysis tools are available from the document view

## Command Line

Basic commands are available without the web UI:

```bash
# Search for papers
academic-agent search "topic or question" --limit 10

# Verify a specific citation
academic-agent verify --doi "10.xxxx/xxxx"

# Analyze an existing draft
academic-agent analyze draft.md --output analysis.md

# Generate a paper directly
academic-agent write "your research topic" --words 8000 --citations 20 --output paper.md
```

Add `--search-limit 0` if you want to skip external search and rely only on the model.

## Local Models

You can use models running on your own machine. A common setup is Ollama:

1. Install and start Ollama.
2. Pull a model, for example `ollama pull qwen2.5:14b`.
3. In the Joeku interface use:
   - Base URL: `http://localhost:11434/v1`
   - API Key: anything (commonly `ollama`)
   - Model: the name of the model you pulled

To reduce reliance on external search during generation, lower the citation target or disable web search in the generation options.

## Deployment

The web server can be exposed if you want to access it from other machines or share it with a small group.

Run with an explicit host:

```bash
academic-agent web --host 0.0.0.0 --port 8000
```

For containerized deployment a Dockerfile and docker-compose.yml are included. On platforms that support persistent disks (Render, Railway, Fly.io, etc.), set the `DEFAULT_DATA_ROOT` environment variable and mount a volume so that projects and libraries survive restarts.

Note that any data stored through the interface will live on the server. There is currently no built-in user authentication or per-user isolation, so treat a publicly reachable instance as a personal or trusted-team tool.

## How Paper Generation Works

Long papers are not produced in a single call. The process is:

1. Search and collect sources according to the requested citation count.
2. Create a title, thesis, and section outline with target lengths.
3. Write sections one by one, passing relevant sources and constraints to the model.
4. Assemble the final document and add a formatted reference list.

This approach stays within typical context limits and produces more consistent structure than asking for the entire paper at once.

## Troubleshooting

- "Missing API Key": Fill in the connection form in the interface.
- Connection errors: Check that the Base URL is correct and the model server is reachable.
- Port already in use: Use `--port` to choose a different one.
- Local search or library features not working in a deployed instance: Make sure `DEFAULT_DATA_ROOT` points to a writable location with sufficient disk space.

For purely local use the desktop command is usually the simplest option.
