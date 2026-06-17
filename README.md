# Academic Agent

一个可接入 OpenAI 协议模型的学术 agent，用于学术检索、引用查证、论文结构分析，以及 3k-30k words 独立学术论文生成。

## 功能

- 学术检索：聚合 OpenAlex、Semantic Scholar、Crossref、arXiv。
- 引用查证：支持 DOI、arXiv ID、论文标题查证，并返回匹配置信度。
- 拖拽读取文档：本地 Web UI 支持 PDF、DOCX、TXT、Markdown。
- 论文结构分析：读取文档文本后分析研究问题、论点、章节结构、证据缺口与修改建议。
- 独立长篇论文生成：根据主题要求生成 3k-30k words 完整学术论文草稿，可通过 --citations 指定引用数量要求（默认 15 篇参考文献）。
- 文档引用审查与改进建议（Web）：对上传文档提取所有引用进行准确性批量查证，结合学术搜索（OpenAlex/Semantic Scholar 等，覆盖类似 Google Scholar 范围）与 LLM 给出针对性学术改进建议；结果以浮窗注释（popover）形式在文档视图中逐条悬停显示，同时提供全文全局改进建议。
- 模型接入：支持任何兼容 OpenAI `chat/completions` 协议的模型服务。

## 安装

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -e .[dev]
```

复制配置：

```powershell
Copy-Item .env.example .env
```

编辑 `.env`：

```env
OPENAI_BASE_URL=https://api.deepseek.com
OPENAI_API_KEY=your-deepseek-api-key
OPENAI_MODEL=deepseek-v4-flash
# SEMANTIC_SCHOLAR_API_KEY=（可选）Semantic Scholar 更高限速 key，其它学术搜索源默认无需 key
```

**学术搜索说明**（重要）：
- 联网学术搜索（用于论文生成时的真实引用、查证等）**默认零配置**，会自动聚合多个公开免费接口：OpenAlex（主要）、Crossref、arXiv、Semantic Scholar。
- 你**不需要**自己申请或配置 Google Scholar / 其它学术 API。公共端点即可使用。
- 只有当你频繁使用且遇到 Semantic Scholar 速率限制时，才建议在 `.env` 增加可选的 `SEMANTIC_SCHOLAR_API_KEY`（可从 semanticscholar.org 免费申请）。
- 搜索本身不消耗你的 LLM token，只在生成论文内容时才会调用 LLM。

可以接入 DeepSeek、OpenAI、Azure/OpenAI-compatible gateway、本地 vLLM、LM Studio、Ollama OpenAI endpoint 等。DeepSeek 可按需要把模型换成 `deepseek-v4-pro`。

## Web UI

启动本地浏览器界面：

```powershell
python -m academic_agent.cli web --port 8000
```

然后打开：

```text
http://127.0.0.1:8000
```

Web UI 支持：

- 拖拽上传 PDF / DOCX / TXT / MD 并抽取文本。
- 联网学术搜索。
- DOI / arXiv / 标题引用查证。
- 基于上传文本进行论文结构分析。
- **独立论文生成**：在右侧表单输入主题、目标字数（最高 30000）、引用数量。**默认会自动进行免费联网学术搜索**（获取真实文献与引用，无需配学术 API），生成带参考文献的独立论文。生成成功后可一键下载 `.md` 文件。如需极快但无真实引用的草稿，可勾选“直接生成（跳过搜索）”。
- **引用查证 + 浮窗学术改进建议**：点击“验证引用 + 浮窗改进建议”，系统自动提取文档中所有可识别的引用（DOI/arXiv/作者-年份/标题），逐一准确性查证，调用学术搜索（类似 Google Scholar 的多源索引）+ LLM 分析，生成每条引用的验证状态与具体改进建议；提供“显示带浮窗标注的文档视图”，鼠标悬停带下划线的引用文字即可弹出浮窗显示单条建议，同时在页面下方展开全文全局学术改进建议列表。

文档抽取在本机完成。只有点击“分析论文结构”、“验证引用 + 浮窗改进建议”或“生成独立论文草稿”时，文本/主题才会发送到你配置的 OpenAI-compatible 模型接口。

## CLI 用法

检索论文：

```powershell
python -m academic_agent.cli search "retrieval augmented generation for academic writing" --limit 8
```

查证引用：

```powershell
python -m academic_agent.cli verify --doi "10.48550/arXiv.2312.10997"
python -m academic_agent.cli verify --title "Retrieval-Augmented Generation for Large Language Models: A Survey"
```

分析论文结构：

```powershell
python -m academic_agent.cli analyze paper.md --output analysis.md
```

生成独立长篇学术论文（支持 30k words + 指定引用数，默认会联网搜索真实文献）：

```powershell
python -m academic_agent.cli write "AI agents for academic literature review" --words 12000 --citations 25 --output draft.md
```

先检索（可控搜索数量），再生成带真实引用与资料包的草稿：

```powershell
python -m academic_agent.cli write "AI agents for academic literature review" --words 8000 --search-limit 20 --citations 18 --output draft.md
```

（如果你想跳过搜索纯用模型知识快速出稿，可加 `--search-limit 0`。）

## 设计说明

独立长篇生成（现支持最高 30k words）不是一次性要求模型输出 30k words，而是：

1. 检索并归一化文献资料（可通过 --citations 精确控制最终纳入的参考文献数量）。
2. 生成论文题目、论点、章节大纲和每节目标字数（planner 会考虑目标引用数）。
3. 逐节写作，每节携带相关资料和引用约束。
4. 生成参考文献和一致性检查清单。

这种方式更稳定，也更适合接入上下文长度不同的 OpenAI-compatible 模型。

引用审查功能：使用正则提取结构化引用标识后，复用 CitationVerifier 进行 DOI/arXiv/标题级精确查证；对整体文章使用 AcademicSearcher 拉取相关高影响力文献（覆盖 Google Scholar 常见索引范围），结合 LLM 产出可操作的改进建议。建议以结构化数据返回，由前端实现浮窗（popover）交互式标注展示。
