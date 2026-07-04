# Joeku

Joeku is a powerful academic writing agent that helps researchers and students generate high-quality, citation-rich papers with ease.

Built on top of any OpenAI-compatible LLM (DeepSeek, OpenAI, Ollama, local models, etc.), Joeku combines intelligent literature search, citation verification, paper structure analysis, and an advanced long-form generation engine that can produce complete 3,000–30,000 word academic drafts with real references.

The application features a modern, desktop-like web interface with drag-and-drop document support, a personal per-project knowledge library, floating citation improvement suggestions, and professional DOCX/PDF export. It can run completely locally for maximum privacy or be easily deployed to the cloud so others can access it through a web browser.

> **Design Philosophy**: Local-first by default. Your API keys and data never leave your control unless you explicitly deploy it yourself.

## 功能

- 学术检索：聚合 OpenAlex、Semantic Scholar、Crossref、arXiv。
- 引用查证：支持 DOI、arXiv ID、论文标题查证，并返回匹配置信度。
- 拖拽读取文档：本地 Web UI 支持 PDF、DOCX、TXT、Markdown。
- 论文结构分析：读取文档文本后分析研究问题、论点、章节结构、证据缺口与修改建议。
- 独立长篇论文生成：根据主题要求生成 3k-30k words 完整学术论文草稿，可通过 --citations 指定引用数量要求（默认 15 篇参考文献）。
- 文档引用审查与改进建议（Web）：对上传文档提取所有引用进行准确性批量查证，结合学术搜索（OpenAlex/Semantic Scholar 等，覆盖类似 Google Scholar 范围）与 LLM 给出针对性学术改进建议；结果以浮窗注释（popover）形式在文档视图中逐条悬停显示，同时提供全文全局改进建议。
- 模型接入：支持任何兼容 OpenAI `chat/completions` 协议的模型服务（云端或本地）。

## Quick Start (for others after git clone)

### Prerequisites
- Python 3.10+
- An OpenAI-compatible API Key (DeepSeek recommended for cost/performance; also supports OpenAI, local Ollama, etc.)
- (Recommended) Install [uv](https://docs.astral.sh/uv/) — the fastest Python environment manager

### Method 1: Using uv (recommended, cross-platform)

```bash
git clone <your-repo-url>
cd academic-agent

uv sync

# Launch the desktop app directly (native window)
uv run academic-agent
```

### Easiest for Windows users

After cloning, simply **double-click** `Joeku.bat` in the repo root:

- First run automatically creates the virtual environment and installs dependencies
- Afterwards it opens a native window directly (no localhost browser)
- It will also create a desktop shortcut automatically

This gives a "clone → double-click and use" experience.

### Method 2: Traditional venv + pip

**Windows (PowerShell)**
```powershell
git clone <your-repo-url>
cd academic-agent

python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -e .

# Optional: copy example config
Copy-Item .env.example .env
```

**macOS / Linux**
```bash
git clone <your-repo-url>
cd academic-agent

python -m venv .venv
source .venv/bin/activate
pip install -e .

# Optional
cp .env.example .env
```

Launch (recommended desktop mode):
```bash
academic-agent desktop
```

This opens a native application window (no more "terminal + manually open localhost").

If you want to use your own browser (advanced):
```bash
academic-agent web
```

### Convenient Windows launcher (optional)
The repo includes `Joeku.bat`. Double-click it to start automatically (after setting up the venv as above).

---

## Configure Your Model (Most Important Step)

After cloning, you do **not** have to edit `.env`. The Web UI shows a login form on first start:

- **Base URL**: For cloud, use `https://api.deepseek.com/v1`. For local Ollama use `http://localhost:11434/v1`
- **API Key**: Enter your DeepSeek / OpenAI key. For local models you can usually use `ollama` or any non-empty string
- **Model**: `deepseek-chat`, `deepseek-v4-flash`, `gpt-4o-mini`, or your local model name (e.g. `qwen2.5:14b`)

Click Connect and you're ready. Keys only live in your browser and are never uploaded.

**Academic Search Notes (Important)**:
- Networked academic search works with **zero configuration** by default. It automatically uses public free endpoints: OpenAlex, Crossref, arXiv, Semantic Scholar.
- You do **not** need a Google Scholar API key.
- Only add `SEMANTIC_SCHOLAR_API_KEY` in `.env` if you use Semantic Scholar very frequently.
- Searching itself does not consume LLM tokens.

Supported model examples:
- DeepSeek (recommended): `deepseek-chat` / `deepseek-v4-flash` / `deepseek-reasoner`
- Local: Ollama, LM Studio, vLLM, llama.cpp server — any OpenAI-compatible endpoint

## Main Features (works in both Desktop and Web mode)

- Drag & drop PDF / DOCX / TXT / MD for local text extraction
- Standalone long-form paper generation (with real citations)
- Citation verification + floating improvement suggestions
- Chat-assisted writing + per-project Library
- Export to DOCX / PDF

**Recommended way to start**: `academic-agent desktop` — opens a native window like a regular app. No need to manually visit 127.0.0.1 in a browser.

**Note**: Text is only sent to the model you configured when you click "Generate paper", "Analyze structure", "Verify citations", etc. Document parsing happens 100% locally.

## CLI Usage (optional)

```bash
# Search
academic-agent search "retrieval augmented generation" --limit 8

# Verify citation
academic-agent verify --doi "10.48550/arXiv.2312.10997"

# Analyze local file
academic-agent analyze paper.md --output analysis.md

# Generate paper (add --search-limit 0 to skip web search and use only model knowledge)
academic-agent write "your topic" --words 8000 --citations 15 --output draft.md
```

---

## Use Local Models for a More Offline Experience

1. Install [Ollama](https://ollama.com) (or LM Studio)
2. Pull a model:
   ```bash
   ollama pull qwen2.5:14b
   # or
   ollama pull llama3.1
   ```
3. Start Ollama (it listens on port 11434 by default)
4. In the Joeku login form enter:
   - Base URL: `http://localhost:11434/v1`
   - API Key: `ollama`
   - Model: `qwen2.5:14b` (or the name you pulled)

5. When generating papers you can:
   - Set "English citations" to 5 or lower, or
   - Uncheck "Search English literature online", or
   - Use CLI flag `--search-limit 0`

## Cloud Deployment & Public Access

Yes, you're correct.

Many web projects on GitHub are deployed to cloud servers (Render, Railway, Fly.io, VPS, etc.). Users simply visit a public URL — no cloning, no local server, no localhost.

**Why is this project local-first by design?**
- It uses **your own LLM API keys** (DeepSeek, OpenAI, etc.).
- Documents, Library items, and projects live on local disk by default.
- Privacy is a core goal.

**Good news: it supports cloud deployment (BYOK style)**

The backend never stores API keys. Keys travel from the browser via headers. Once deployed, users visit your URL, enter their own key in the UI, and start working.

### Quick Deployment

**Using Docker (recommended)**

仓库已提供 `Dockerfile` 和 `docker-compose.yml`。

```bash
# 本地构建并运行
docker compose up --build

# 或者
docker build -t joeku .
docker run -p 8000:8000 joeku
```

然后访问 `http://localhost:8000`

**一键部署到 Render（推荐，免费额度可用）**：
[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=你的仓库地址)

或手动：
- New Web Service → Connect GitHub repo
- Build Command: `pip install uv && uv pip install --system -e .`
- Start Command: `python -m academic_agent.cli web --host 0.0.0.0 --port $PORT`
- **重要**：在 Environment 设置 `DEFAULT_DATA_ROOT=/var/data` 并挂载 Persistent Disk

**Other platforms**:
- Railway, Fly.io, VPS support Docker or direct run.
- Set `DEFAULT_DATA_ROOT` and mount persistent storage.

**Public Demo Notes**:
Uploaded documents live on the server. Best for personal or self-hosted use. Add protection for public demos.

**2. Run directly on a server**

```bash
uv sync
uv run academic-agent web --host 0.0.0.0 --port 8000
```

Or under systemd/supervisor.

**Notes for public/cloud deployments**:
- Uploaded files live on the server disk.
- No multi-user isolation or auth yet (suitable for personal/small team use — add your own if needed).
- Generation is resource heavy — consider rate limits.
- For public demos, pin data root or improve storage later.

### Recommended Hybrid Usage
- Normal users → Desktop mode (`academic-agent`)
- Quick public use → Deploy once and share the URL
- Advanced → Self-host or local

This preserves strong local/privacy options while making the project usable like other GitHub tools via a URL.

需要我继续完善吗？
- 优化 Dockerfile（多阶段构建、更好生产配置）
- 加部署文档 + 一键按钮说明
- 改进数据存储以便更好支持多用户云部署
- 或者继续强化桌面打包（exe / 更好 launcher）？

告诉我你想优先走哪个方向。

这样核心写作和聊天完全由本地 LLM 完成，只有想用真实引用时才联网。

## 常见问题

- **提示缺少 API Key**：在网页右上角或登录弹窗里填你的配置。
- **端口被占用**：`academic-agent web --port 8001`
- **想让同一局域网其他人访问**（不推荐日常使用）：`academic-agent web --host 0.0.0.0 --port 8000`（注意防火墙和安全）。
- **完全不想联网搜索**：生成时设置 search_limit=0，或取消 web_search。

---

## 旧版安装流程（兼容保留）

如果你更习惯老命令：

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -e .
# 然后
academic-agent
```

**推荐**：直接双击 `Joeku.bat`（会自动创建环境并以桌面窗口启动）。

## 设计说明

独立长篇生成（现支持最高 30k words）不是一次性要求模型输出 30k words，而是：

1. 检索并归一化文献资料（可通过 --citations 精确控制最终纳入的参考文献数量）。
2. 生成论文题目、论点、章节大纲和每节目标字数（planner 会考虑目标引用数）。
3. 逐节写作，每节携带相关资料和引用约束。
4. 生成参考文献和一致性检查清单。

这种方式更稳定，也更适合接入上下文长度不同的 OpenAI-compatible 模型。

引用审查功能：使用正则提取结构化引用标识后，复用 CitationVerifier 进行 DOI/arXiv/标题级精确查证；对整体文章使用 AcademicSearcher 拉取相关高影响力文献（覆盖 Google Scholar 常见索引范围），结合 LLM 产出可操作的改进建议。建议以结构化数据返回，由前端实现浮窗（popover）交互式标注展示。
