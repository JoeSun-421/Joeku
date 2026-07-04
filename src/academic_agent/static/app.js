/* Joeku — projects · modal params · split doc stream (no ES module — avoids load failures) */

function escMd(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function safeHttpUrl(url) {
  const u = String(url || "").trim();
  if (!/^https?:\/\/[^\s<>"']+$/i.test(u)) return "";
  return u;
}

function inlineMarkdown(text) {
  let t = String(text || "");
  t = t.replace(/`([^`\n]+)`/g, "<code>$1</code>");
  t = t.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
  t = t.replace(/__([^_\n]+)__/g, "<strong>$1</strong>");
  t = t.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, "$1<em>$2</em>");
  t = t.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, url) => {
    const href = safeHttpUrl(url);
    return href
      ? `<a href="${href}" target="_blank" rel="noopener noreferrer">${label}</a>`
      : label;
  });
  return t;
}

function autolinkUrls(html) {
  return html.replace(/https?:\/\/[^\s<>"']+/g, (url, offset, full) => {
    const before = full.slice(Math.max(0, offset - 20), offset);
    if (before.includes('href="') || before.includes("href='") || before.endsWith(">")) return url;
    const href = safeHttpUrl(url.replace(/[),.，。；;!?！？]+$/, ""));
    if (!href) return url;
    return `<a href="${href}" target="_blank" rel="noopener noreferrer">${url}</a>`;
  });
}

function renderMarkdown(md) {
  if (!md) return "";
  const lines = String(md).split(/\r?\n/);
  const out = [];
  let inP = false;
  let listType = null;
  let inCode = false;
  let codeBuf = [];

  const closeP = () => {
    if (inP) {
      out.push("</p>");
      inP = false;
    }
  };
  const closeList = () => {
    if (listType) {
      out.push(`</${listType}>`);
      listType = null;
    }
  };
  const pushParagraphLine = (line) => {
    closeList();
    if (!inP) {
      out.push("<p>");
      inP = true;
    } else {
      out.push("<br/>");
    }
    out.push(inlineMarkdown(escMd(line)));
  };

  for (const raw of lines) {
    const line = raw.replace(/\r$/, "");
    const trimmed = line.trim();
    if (trimmed.startsWith("```")) {
      if (!inCode) {
        closeP();
        closeList();
        inCode = true;
        codeBuf = [];
      } else {
        out.push(`<pre class="msg-code-block"><code>${escMd(codeBuf.join("\n"))}</code></pre>`);
        inCode = false;
        codeBuf = [];
      }
      continue;
    }
    if (inCode) {
      codeBuf.push(line);
      continue;
    }
    if (!trimmed) {
      closeP();
      closeList();
      continue;
    }
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      closeP();
      closeList();
      out.push("<hr />");
      continue;
    }
    const h = trimmed.match(/^(#{1,3})\s+(.+)$/);
    if (h) {
      closeP();
      closeList();
      const level = h[1].length;
      const tag = level === 1 ? "h1" : level === 2 ? "h2" : "h3";
      out.push(`<${tag}>${inlineMarkdown(escMd(h[2]))}</${tag}>`);
      continue;
    }
    if (/^>\s?/.test(trimmed)) {
      closeP();
      closeList();
      out.push(`<blockquote>${inlineMarkdown(escMd(trimmed.replace(/^>\s?/, "")))}</blockquote>`);
      continue;
    }
    if (isBulletListLine(trimmed)) {
      closeP();
      if (listType !== "ul") {
        closeList();
        out.push('<ul class="msg-list msg-list--bullet">');
        listType = "ul";
      }
      out.push(`<li>${inlineMarkdown(escMd(trimmed.replace(/^[-*•·▪]\s+/, "")))}</li>`);
      continue;
    }
    const olBody = orderedListBody(trimmed);
    if (olBody !== null) {
      closeP();
      if (listType !== "ol") {
        closeList();
        out.push('<ol class="msg-list msg-list--ordered">');
        listType = "ol";
      }
      out.push(`<li>${inlineMarkdown(escMd(olBody))}</li>`);
      continue;
    }
    pushParagraphLine(trimmed);
  }
  if (inCode && codeBuf.length) {
    closeP();
    closeList();
    out.push(`<pre class="msg-code-block"><code>${escMd(codeBuf.join("\n"))}</code></pre>`);
  }
  closeP();
  closeList();

  return autolinkUrls(out.join(""));
}

function wrapMsgProse(html, { answer = false } = {}) {
  if (!html) return "";
  const cls = answer ? "msg-prose ds-answer-body" : "msg-prose";
  return `<div class="${cls}">${html}</div>`;
}

function wrapDsAnswer(html) {
  if (!html) return "";
  return `<div class="ds-answer">${html}</div>`;
}

function wrapDsReasoning(innerHtml) {
  if (!innerHtml) return "";
  return `<div class="ds-reasoning">${innerHtml}</div>`;
}

function escHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function isOrderedListLine(line) {
  const t = String(line || "").trim();
  return (
    /^\d+[.、．):：]\s+/.test(t) ||
    /^[（(]\d+[）)]\s*/.test(t) ||
    /^第[一二三四五六七八九十百千万\d]+[、.．:：]\s*/.test(t) ||
    /^[①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭]\s*/.test(t)
  );
}

function isBulletListLine(line) {
  return /^[-*•·▪]\s+/.test(String(line || "").trim());
}

function isListLine(line) {
  return isOrderedListLine(line) || isBulletListLine(line);
}

function orderedListBody(line) {
  const t = String(line || "").trim();
  let m = t.match(/^\d+[.、．):：]\s+(.+)$/);
  if (m) return m[1];
  m = t.match(/^[（(]\d+[）)]\s*(.+)$/);
  if (m) return m[1];
  m = t.match(/^第[一二三四五六七八九十百千万\d]+[、.．:：]\s*(.+)$/);
  if (m) return m[1];
  m = t.match(/^[①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭]\s*(.+)$/);
  if (m) return m[1];
  return null;
}

function joinLineBreak(prev, next) {
  if (isListLine(prev) && isListLine(next)) return "\n";
  if (isOrderedListLine(prev) && isOrderedListLine(next)) return "\n";
  if (isBulletListLine(prev) && isBulletListLine(next)) return "\n";
  return "\n\n";
}

function collapseListBlankLines(text) {
  const lines = String(text || "").split(/\r?\n/);
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (!trimmed) {
      let j = i + 1;
      while (j < lines.length && !lines[j].trim()) j++;
      const prev = out.length ? out[out.length - 1] : "";
      const next = j < lines.length ? lines[j].trim() : "";
      if (prev && next && isListLine(prev) && isListLine(next)) continue;
      if (out.length && out[out.length - 1] !== "") out.push("");
      continue;
    }
    out.push(trimmed);
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function normalizeAnswerBreaks(text) {
  const raw = String(text || "").trim();
  if (!raw) return "";
  if (/\n{2,}/.test(raw)) return collapseListBlankLines(raw);
  if (/\n/.test(raw)) {
    const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (lines.length <= 1) return lines[0] || raw;
    const parts = [];
    for (let i = 0; i < lines.length; i++) {
      parts.push(lines[i]);
      if (i < lines.length - 1) parts.push(joinLineBreak(lines[i], lines[i + 1]));
    }
    return parts.join("");
  }
  if (raw.length > 120) {
    return raw
      .replace(/([。！？；])\s*/g, "$1\n")
      .replace(/([.!?])\s+(?=[A-Z\u4e00-\u9fff])/g, "$1\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }
  return raw;
}

function postprocessAssistantMarkdown(text) {
  let t = normalizeAnswerBreaks(String(text || "").trim());
  if (!t) return "";
  t = t.replace(/\r\n/g, "\n");
  t = t.replace(/([^\n])\n(##\s)/g, "$1\n\n$2");
  t = t.replace(/(##[^\n]+)\n([^\n#])/g, "$1\n\n$2");
  t = t.replace(/^(\d+)[.、．)\]:：]\s*\n+\s*/gm, "$1. ");
  t = t.replace(/(^|\n)(\d+)\.\s*\n+(\S)/gm, "$1$2. $3");
  t = t.replace(/(^|\n)([-*•·▪])\s*\n+(\S)/gm, "$1$2 $3");
  t = t.replace(/\n{3,}/g, "\n\n");
  return collapseListBlankLines(t);
}

function buildAnswerHtml(content, { streaming = false } = {}) {
  if (!content && streaming) {
    return wrapDsAnswer('<div class="msg-prose ds-answer-body"><p class="stream-caret">▋</p></div>');
  }
  const normalized = postprocessAssistantMarkdown(content);
  if (!normalized) return "";
  if (streaming) {
    return wrapDsAnswer(formatStreamingProse(normalized));
  }
  return wrapDsAnswer(wrapMsgProse(renderMarkdown(normalized), { answer: true }));
}

function formatStreamingProse(text) {
  const raw = postprocessAssistantMarkdown(text);
  if (!raw) return "";
  const html = renderMarkdown(raw);
  return wrapMsgProse(`${html}<span class="stream-caret">▋</span>`, { answer: true });
}

function shouldShowThinkingTrace(msg, agentTool = state.workspaceMode || "chatbot", chatMode = state.chatMode || "default") {
  const tool = (agentTool || "chatbot").trim().toLowerCase();
  const mode = (chatMode || "default").trim().toLowerCase();
  if (tool !== "chatbot" || mode !== "default") return true;
  return !isSimpleChatMessage(msg, tool);
}

function isSimpleChatMessage(text, agentTool = "chatbot") {
  const t = String(text || "").trim();
  if (!t) return true;
  const tool = (agentTool || "chatbot").trim().toLowerCase();
  if (tool !== "chatbot") return false;
  if (
    /^(hi|hello|hey|thanks|thank you|thx|ok|okay|yes|no|sure|great|nice|cool|got it|bye)[\s!.?]*$/i.test(t) ||
    /^(你好|您好|谢谢|多谢|好的|嗯|是的|不是|再见|哈喽)[\s!.?]*$/u.test(t)
  ) {
    return true;
  }
  if (t.length > 80) return false;
  if (/论文|段落|引用|大纲|结构|文献|摘要|修改|润色|草稿|draft|paper|section|citation|outline|library|bibliography|rewrite|cite|imrad/i.test(t)) {
    return false;
  }
  if (/这段|这一句|上文|下文|开头|结尾|section|paragraph|above|below/i.test(t)) return false;
  if (t.length <= 36) return true;
  if (t.length <= 80 && !/[?？]/.test(t)) return true;
  return false;
}

const STORAGE = {
  lastConfig: "joeku-last-config",
  session: "joeku-session",
  folder: "joeku-save-folder",
  perm: "joeku-local-perm",
  exportFormat: "joeku-export-format",
  activeJob: "joeku-active-job",
  docCollapsed: "joeku-doc-collapsed",
};

function userKey(suffix) {
  const uid = state.userId || "guest";
  return `joeku-${suffix}-${uid}`;
}

const state = {
  mode: "generate",
  loggedIn: false,
  userId: null,
  localUserId: "",
  dataRoot: "",
  libraryItems: [],
  docViewMode: "preview",
  personaHint: "",
  displayName: "",
  config: { api_key: "", base_url: "https://api.deepseek.com/v1", model: "deepseek-chat", tavily_key: "" },
  pollErrors: 0,
  activeJobId: null,
  saveFolder: "",
  permGranted: false,
  projects: [],
  currentProjectId: null,
  generateMessages: [],
  reviseMessages: [],
  docAnnotations: [],
  pendingRevision: null,
  paper: "",
  topic: "",
  requirementsText: "",
  requirementsName: "",
  reviseDocText: "",
  reviseDocName: "",
  lastSavedPath: "",
  isGenerating: false,
  pollTimer: null,
  defaults: null,
  exportFormat: {
    font_family: "times",
    font_size: 12,
    line_spacing: 1.5,
    margin_inches: 1.25,
    first_line_indent_chars: 0,
    cover_page: null,
  },
  coverPage: null,
  chatMode: "default",
  workspaceMode: "chatbot",
  genProgressId: null,
  pendingModel: null,
  paramsPending: false,
  openPicker: null,
  sidebarPanelCollapsed: false,
};

const WORKSPACE_MODES = [
  { id: "chatbot", label: "Chat", hint: "Conversational assistant" },
  { id: "docgen", label: "Generate", hint: "Write a full paper with parameters" },
  { id: "library_search", label: "Library", hint: "Ground answers in this project's library" },
  { id: "web_research", label: "Web search", hint: "Search the web for academic sources" },
  { id: "structure_review", label: "Structure", hint: "Analyze draft structure and flow" },
  { id: "citation_check", label: "Citations", hint: "Scan draft for citation gaps" },
  { id: "outline_plan", label: "Outline", hint: "Plan IMRaD sections and outline" },
];

const CHAT_AGENT_TOOLS = new Set([
  "chatbot",
  "library_search",
  "web_research",
  "structure_review",
  "citation_check",
  "outline_plan",
]);

const CHAT_MODES = [
  { id: "default", label: "Default", hint: "Natural conversation" },
  { id: "deep", label: "Deep Think", hint: "Multi-angle analysis" },
  { id: "structure", label: "Structure", hint: "Outline-first responses" },
  { id: "rigorous", label: "Rigorous", hint: "Academic precision" },
];

const GEN_STEP_LABELS = {
  init: "准备生成",
  search: "检索文献",
  plan: "规划结构",
  write: "撰写章节",
  adjust: "字数校准",
  references: "整理参考文献",
  check: "质量检查",
  polish: "润色去 AI 化",
  done: "生成完成",
};

const GEN_STEP_ORDER = ["init", "search", "plan", "write", "adjust", "references", "check", "polish", "done"];

const DOC_PANEL_STEPS = new Set(["write", "adjust", "references", "check", "polish", "done"]);

const MODEL_OPTIONS = [
  { value: "deepseek-chat", label: "deepseek-chat" },
  { value: "deepseek-v4-pro", label: "deepseek-v4-pro" },
  { value: "deepseek-reasoner", label: "deepseek-reasoner" },
  { value: "deepseek-v4-flash", label: "deepseek-v4-flash" },
  { value: "gpt-4o-mini", label: "gpt-4o-mini" },
];

function shouldOpenDocPanel(step) {
  return DOC_PANEL_STEPS.has(step || "");
}

function userAvatarLetter() {
  const name = (state.displayName || "You").trim();
  const ch = [...name][0] || "Y";
  return /[a-zA-Z]/.test(ch) ? ch.toUpperCase() : ch;
}

function fillAvatar(el, isUser) {
  if (!el) return;
  if (isUser) {
    el.classList.remove("avatar-icon");
    el.textContent = userAvatarLetter();
  } else {
    el.classList.add("avatar-icon");
    el.innerHTML = '<img src="/static/icon.svg" alt="Joeku" width="20" height="20" />';
  }
}

function thinkingLabelForMode(mode) {
  const map = {
    default: "Reasoning",
    deep: "Deep analysis",
    structure: "Structuring",
    rigorous: "Academic review",
  };
  return map[mode] || "Reasoning";
}

const THINK_TICKER_MAX = 44;

function stepTickerLabel(step) {
  if (!step?.label) return "";
  return step.detail ? `${step.label} · ${step.detail}` : step.label;
}

function reasoningPhaseLabel(entry) {
  const map = {
    "Deep analysis": "深度分析中…",
    Structuring: "梳理结构中…",
    "Academic review": "学术审阅中…",
    Reasoning: "推理中…",
    "Working…": "处理中…",
    Revision: "修订中…",
    Analysis: "分析中…",
  };
  return map[entry?.thinkLabel] || "推理中…";
}

function sanitizeThinkTicker(text) {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  if (!t || t.length > THINK_TICKER_MAX) return "";
  return t;
}

function resolveThinkTicker(entry, steps) {
  const fromStep = stepTickerLabel(steps[steps.length - 1]);
  const fromLive = sanitizeThinkTicker(entry.thinkLiveAction);
  if (fromLive) return fromLive;
  if (fromStep) return fromStep;
  if (entry.thinkReasoning) return reasoningPhaseLabel(entry);
  return "";
}

function isDocgenMode() {
  return state.workspaceMode === "docgen";
}

function isChatAgentMode() {
  return CHAT_AGENT_TOOLS.has(state.workspaceMode);
}

function composerPlaceholder() {
  const map = {
    chatbot: "Message Joeku…",
    docgen: "Describe your paper topic…",
    library_search: "Ask about sources in this project's library…",
    web_research: "What should I search for?…",
    structure_review: "Ask about structure, flow, or sections…",
    citation_check: "Ask about citations or unsupported claims…",
    outline_plan: "Describe the paper topic for an outline…",
  };
  return map[state.workspaceMode] || "Message Joeku…";
}

function splitPaperParagraphs(paper) {
  if (window.JoekuFeatures?.splitPaperParagraphs) return window.JoekuFeatures.splitPaperParagraphs(paper);
  return String(paper || "")
    .split(/\n\s*\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function chatModeHint(mode) {
  return CHAT_MODES.find((m) => m.id === mode)?.hint || "";
}

const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);

function uid() {
  return "p_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function deriveUserId(displayName, apiKey, baseUrl) {
  const raw = `${(displayName || "").trim()}|${(baseUrl || "").trim()}|${(apiKey || "").trim()}`;
  let h = 2166136261;
  for (let i = 0; i < raw.length; i++) {
    h ^= raw.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return "u_" + (h >>> 0).toString(36);
}

function saveLastConfig() {
  localStorage.setItem(
    STORAGE.lastConfig,
    JSON.stringify({
      display_name: state.displayName,
      base_url: state.config.base_url,
      model: state.config.model,
      tavily_key: state.config.tavily_key || "",
    })
  );
}

function loadLastConfig() {
  try {
    const raw = localStorage.getItem(STORAGE.lastConfig);
    if (!raw) return;
    const data = JSON.parse(raw);
    if (data.base_url) state.config.base_url = data.base_url;
    if (data.model) state.config.model = data.model;
    if (data.tavily_key) state.config.tavily_key = data.tavily_key;
    if (data.display_name) state.displayName = data.display_name;
  } catch (_) {}
}

async function activateUserSession(displayName, apiKey, baseUrl) {
  state.displayName = (displayName || "").trim() || "User";
  state.userId = state.localUserId || deriveUserId(state.displayName, apiKey, baseUrl);
  localStorage.setItem(
    STORAGE.session,
    JSON.stringify({ userId: state.userId, displayName: state.displayName, localUserId: state.localUserId })
  );
  await loadUserProjects();
}

function esc(s) {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

function showFatal(msg) {
  const el = document.getElementById("joekuFatal");
  if (el) {
    el.textContent = String(msg);
    el.classList.add("show");
  }
  console.error(msg);
}

// --- Storage ---
function defaultProjects() {
  const id = uid();
  const chatId = uid();
  return [{
    id,
    name: "Default project",
    chats: [{ id: chatId, title: "New chat", generateMessages: [], paper: "", topic: "", lastSavedPath: "", updatedAt: Date.now() }],
    currentChatId: chatId,
    generateMessages: [],
    reviseMessages: [],
    paper: "",
    topic: "",
    lastSavedPath: "",
    createdAt: Date.now(),
  }];
}

async function loadUserProjects() {
  if (state.dataRoot && state.localUserId && window.JoekuFeatures) {
    try {
      const ok = await window.JoekuFeatures.loadStateFromDisk();
      if (ok && state.projects?.length) {
        migrateProjectsChats();
        const cur = state.currentProjectId;
        state.currentProjectId = state.projects.some((p) => p.id === cur) ? cur : state.projects[0].id;
        loadCurrentProjectData();
        if (window.JoekuFeatures) window.JoekuFeatures.loadLibrary().catch(() => {});
        return;
      }
    } catch (err) {
      console.warn("Disk state load:", err);
    }
  }
  try {
    state.projects = JSON.parse(localStorage.getItem(userKey("projects")) || "[]");
  } catch (_) {
    state.projects = [];
  }
  if (!state.projects.length) state.projects = defaultProjects();
  migrateProjectsChats();
  const cur = localStorage.getItem(userKey("current-project"));
  state.currentProjectId = state.projects.some((p) => p.id === cur) ? cur : state.projects[0].id;
  state.saveFolder = localStorage.getItem(userKey("save-folder")) || "";
  loadCurrentProjectData();
  if (window.JoekuFeatures) window.JoekuFeatures.loadLibrary().catch(() => {});
}

function loadStorage() {
  loadLastConfig();
  state.permGranted = localStorage.getItem(STORAGE.perm) === "1";
  try {
    const fmt = localStorage.getItem(STORAGE.exportFormat);
    if (fmt) state.exportFormat = { ...state.exportFormat, ...JSON.parse(fmt) };
    if (state.exportFormat.cover_page) state.coverPage = state.exportFormat.cover_page;
  } catch (_) {}
  state.projects = defaultProjects();
  state.currentProjectId = state.projects[0].id;
  state.generateMessages = [];
  state.reviseMessages = [];
  state.paper = "";
  state.topic = "";
}

function saveConfig() {
  saveLastConfig();
}

function saveProjects() {
  if (!state.userId) return;
  persistCurrentProject();
  localStorage.setItem(userKey("projects"), JSON.stringify(state.projects));
  localStorage.setItem(userKey("current-project"), state.currentProjectId);
  if (state.saveFolder) localStorage.setItem(userKey("save-folder"), state.saveFolder);
  if (state.dataRoot && state.localUserId && window.JoekuFeatures) {
    window.JoekuFeatures.syncStateToDisk().catch((err) => console.warn("Disk sync:", err));
  }
}

function migrateProjectsChats() {
  state.projects.forEach((p) => {
    if (Array.isArray(p.chats)) return;
    const chatId = uid();
    p.chats = [{
      id: chatId,
      title: chatTitleFromMessages(p.generateMessages, p.topic),
      generateMessages: p.generateMessages || [],
      paper: p.paper || "",
      topic: p.topic || "",
      lastSavedPath: p.lastSavedPath || "",
      updatedAt: Date.now(),
    }];
    p.currentChatId = chatId;
  });
}

function chatTitleFromMessages(msgs, topic) {
  const first = (msgs || []).find((m) => m.role === "user" && m.content?.trim());
  const raw = first?.content?.trim() || topic?.trim() || "New chat";
  return raw.length > 28 ? `${raw.slice(0, 28)}…` : raw;
}

function currentProject() {
  return state.projects.find((p) => p.id === state.currentProjectId) || state.projects[0];
}

function currentChat() {
  const p = currentProject();
  if (!p?.chats?.length) return null;
  if (p.currentChatId) {
    const hit = p.chats.find((c) => c.id === p.currentChatId);
    if (hit) return hit;
  }
  return p.chats[0] || null;
}

function ensureCurrentChat() {
  const p = currentProject();
  if (!p) return null;
  if (!Array.isArray(p.chats)) p.chats = [];
  let chat = currentChat();
  if (chat) return chat;
  const id = uid();
  chat = {
    id,
    title: "New chat",
    generateMessages: [],
    paper: "",
    topic: "",
    lastSavedPath: "",
    updatedAt: Date.now(),
  };
  p.chats.unshift(chat);
  p.currentChatId = id;
  state.generateMessages = [];
  state.paper = "";
  state.topic = "";
  state.lastSavedPath = "";
  saveProjects();
  renderChatList();
  return chat;
}

function loadCurrentProjectData() {
  const p = currentProject();
  const chat = currentChat();
  state.reviseMessages = p.reviseMessages ? [...p.reviseMessages] : [];
  if (chat) {
    state.generateMessages = chat.generateMessages ? [...chat.generateMessages] : [];
    state.paper = chat.paper || "";
    state.topic = chat.topic || "";
    state.lastSavedPath = chat.lastSavedPath || "";
    state.docAnnotations = chat.docAnnotations ? [...chat.docAnnotations] : [];
    p.currentChatId = chat.id;
  } else {
    state.generateMessages = p.generateMessages ? [...p.generateMessages] : [];
    state.paper = p.paper || "";
    state.topic = p.topic || "";
    state.lastSavedPath = p.lastSavedPath || "";
    state.docAnnotations = p.docAnnotations ? [...p.docAnnotations] : [];
  }
  state.pendingRevision = null;
}

function persistCurrentProject() {
  const p = currentProject();
  if (!p) return;
  p.reviseMessages = state.reviseMessages;
  const chat = currentChat();
  if (chat) {
    chat.generateMessages = state.generateMessages;
    chat.paper = state.paper;
    chat.topic = state.topic;
    chat.lastSavedPath = state.lastSavedPath;
    chat.docAnnotations = state.docAnnotations || [];
    chat.updatedAt = Date.now();
    chat.title = chatTitleFromMessages(chat.generateMessages, chat.topic);
  } else {
    p.generateMessages = state.generateMessages;
    p.paper = state.paper;
    p.topic = state.topic;
    p.lastSavedPath = state.lastSavedPath;
    p.docAnnotations = state.docAnnotations || [];
  }
}

// --- Projects ---
function createSidebarRow({ label, active, onSelect, onDelete, canDelete, deleteTitle }) {
  const li = document.createElement("li");
  li.className = "sidebar-row" + (active ? " active" : "");
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "sidebar-row-btn";
  btn.textContent = label;
  btn.title = label;
  btn.addEventListener("click", onSelect);
  const del = document.createElement("button");
  del.type = "button";
  del.className = "sidebar-row-del";
  del.textContent = "×";
  del.title = deleteTitle || "删除";
  if (!canDelete) del.setAttribute("hidden", "");
  del.addEventListener("click", (e) => {
    e.stopPropagation();
    e.preventDefault();
    if (!canDelete) return;
    onDelete();
  });
  li.appendChild(btn);
  li.appendChild(del);
  return li;
}

function renderProjectList() {
  const el = $("#projectList");
  if (!el) return;
  el.innerHTML = "";
  state.projects.forEach((p) => {
    el.appendChild(
      createSidebarRow({
        label: p.name,
        active: p.id === state.currentProjectId,
        canDelete: true,
        deleteTitle: `删除项目「${p.name}」`,
        onSelect: () => switchProject(p.id),
        onDelete: () => {
          if (confirm(`删除项目「${p.name}」及其对话记录？`)) deleteProject(p.id);
        },
      })
    );
  });
}

function switchProject(id) {
  persistCurrentProject();
  state.currentProjectId = id;
  loadCurrentProjectData();
  saveProjects();
  renderProjectList();
  renderChatList();
  renderThread("generate");
  renderThread("revise");
  renderDocPreview();
  setDocOpenLayout(!!state.paper);
  clearPendingReq();
  if (window.JoekuFeatures) window.JoekuFeatures.loadLibrary().catch(() => {});
}

function openNewProjectDialog() {
  if (!requireLogin()) return;
  const nameEl = $("#newProjectName");
  const filesEl = $("#newProjectFiles");
  const urlsEl = $("#newProjectUrls");
  if (nameEl) nameEl.value = "New project";
  if (filesEl) filesEl.value = "";
  if (urlsEl) urlsEl.value = "";
  openModal("newProjectDialog");
  requestAnimationFrame(() => nameEl?.focus());
}

async function submitNewProject(e) {
  e?.preventDefault();
  const name = $("#newProjectName")?.value?.trim();
  if (!name) return;
  const files = [...($("#newProjectFiles")?.files || [])];
  const urls = ($("#newProjectUrls")?.value || "")
    .split(/\r?\n/)
    .map((u) => u.trim())
    .filter((u) => /^https?:\/\//i.test(u));

  persistCurrentProject();
  const id = uid();
  const chatId = uid();
  state.projects.unshift({
    id,
    name,
    chats: [{ id: chatId, title: "New chat", generateMessages: [], paper: "", topic: "", lastSavedPath: "", updatedAt: Date.now() }],
    currentChatId: chatId,
    generateMessages: [],
    reviseMessages: [],
    paper: "",
    topic: "",
    lastSavedPath: "",
    createdAt: Date.now(),
  });
  closeModal("newProjectDialog");
  switchProject(id);
  const lib = $("#projectLibrarySection");
  if (lib) lib.hidden = false;

  try {
    if (files.length && window.JoekuFeatures?.uploadLibraryFiles) {
      await window.JoekuFeatures.uploadLibraryFiles(files);
    }
    if (urls.length && window.JoekuFeatures?.addLibraryUrls) {
      await window.JoekuFeatures.addLibraryUrls(urls);
    }
    if (files.length || urls.length) {
      addTurn("assistant", `Project "${name}" created — ${files.length + urls.length} item(s) added to your library.`, {
        mode: "generate",
        markdown: false,
      });
    }
  } catch (err) {
    addTurn("assistant", `Project created, but some library items failed: ${err.message}`, { mode: "generate", markdown: false });
  }
  saveProjects();
}

function renderChatList() {
  const el = $("#chatList");
  if (!el) return;
  const p = currentProject();
  el.innerHTML = "";
  const chats = [...(p.chats || [])].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  if (!chats.length) {
    el.innerHTML = '<li class="chat-list-empty">No chats — click New chat or send a message</li>';
    return;
  }
  chats.forEach((c) => {
    const title = c.title || "New chat";
    el.appendChild(
      createSidebarRow({
        label: title,
        active: c.id === p.currentChatId,
        canDelete: true,
        deleteTitle: `Delete chat "${title}"`,
        onSelect: () => switchChat(c.id),
        onDelete: () => {
          if (confirm(`Delete chat "${title}"?`)) deleteChat(c.id);
        },
      })
    );
  });
}

function switchChat(chatId) {
  persistCurrentProject();
  const p = currentProject();
  p.currentChatId = chatId;
  loadCurrentProjectData();
  saveProjects();
  renderChatList();
  renderThread("generate");
  renderDocPreview();
  setDocOpenLayout(!!state.paper);
  clearPendingReq();
}

function startNewSessionChat() {
  if (state.isGenerating) return;
  persistCurrentProject();
  const p = currentProject();
  const id = uid();
  const chat = {
    id,
    title: "New chat",
    generateMessages: [],
    paper: "",
    topic: "",
    lastSavedPath: "",
    updatedAt: Date.now(),
  };
  p.chats = p.chats || [];
  p.chats.unshift(chat);
  p.currentChatId = id;
  state.generateMessages = [];
  state.paper = "";
  state.topic = "";
  state.lastSavedPath = "";
  saveProjects();
  renderChatList();
  renderThread("generate");
  renderDocPreview();
  setDocOpenLayout(false);
  setDocCollapsed(false);
  clearPendingReq();
  const input = $("#composerInput");
  if (input) {
    input.value = "";
    autoResizeTextarea(input);
  }
}

function createChat() {
  if (state.isGenerating) {
    if (!confirm("Paper is generating. Starting a new chat won't stop the job. Continue?")) return;
  }
  persistCurrentProject();
  const p = currentProject();
  const id = uid();
  const chat = { id, title: "New chat", generateMessages: [], paper: "", topic: "", lastSavedPath: "", updatedAt: Date.now() };
  p.chats = p.chats || [];
  p.chats.unshift(chat);
  p.currentChatId = id;
  state.generateMessages = [];
  state.paper = "";
  state.topic = "";
  state.lastSavedPath = "";
  saveProjects();
  renderChatList();
  renderThread("generate");
  renderDocPreview();
  setDocOpenLayout(false);
  setDocCollapsed(false);
  clearPendingReq();
  if (state.workspaceMode === "docgen") {
    state.paramsPending = false;
    setParamsReopenBar(false);
    closeModal("paramsDialog");
    applyWorkspaceMode("chatbot");
  }
  const composerInput = $("#composerInput");
  if (composerInput) composerInput.value = "";
  const btn = $("#newChatBtn");
  btn?.classList.remove("glass-pressed");
  btn?.blur();
  requestAnimationFrame(() => {
    const input = $("#composerInput");
    if (input) input.focus();
  });
}

function deleteChat(chatId) {
  const p = currentProject();
  p.chats = (p.chats || []).filter((c) => c.id !== chatId);
  if (p.currentChatId === chatId) {
    p.currentChatId = p.chats[0]?.id || null;
  }
  state.generateMessages = [];
  state.paper = "";
  state.topic = "";
  state.lastSavedPath = "";
  if (p.currentChatId) {
    loadCurrentProjectData();
  }
  saveProjects();
  renderChatList();
  renderThread("generate");
  renderDocPreview();
  setDocOpenLayout(false);
  setDocCollapsed(false);
}

async function deleteProject(id) {
  state.libraryItems = [];
  if (window.JoekuFeatures?.renderLibraryList) window.JoekuFeatures.renderLibraryList();
  state.projects = state.projects.filter((p) => p.id !== id);
  if (window.JoekuFeatures?.deleteProjectData) {
    try {
      await window.JoekuFeatures.deleteProjectData(id);
    } catch (err) {
      console.warn("Project data delete:", err);
    }
  }
  if (!state.projects.length) {
    const fresh = defaultProjects();
    state.projects = fresh;
    state.currentProjectId = fresh[0].id;
  } else if (state.currentProjectId === id) {
    state.currentProjectId = state.projects[0].id;
  }
  loadCurrentProjectData();
  state.libraryItems = [];
  saveProjects();
  if (window.JoekuFeatures?.syncStateToDisk) {
    try {
      await window.JoekuFeatures.syncStateToDisk();
    } catch (err) {
      console.warn("Disk sync after delete:", err);
    }
  }
  renderProjectList();
  renderChatList();
  if (window.JoekuFeatures?.loadLibrary) {
    await window.JoekuFeatures.loadLibrary();
  } else if (window.JoekuFeatures?.renderLibraryList) {
    window.JoekuFeatures.renderLibraryList();
  }
  renderThread("generate");
  renderThread("revise");
  renderDocPreview();
}

// --- API ---
function latin1Header(value) {
  const s = String(value ?? "");
  if (!/[^\u0000-\u00ff]/.test(s)) return s;
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return "b64:" + btoa(bin);
}

function sanitizeUrl(url) {
  return String(url ?? "")
    .trim()
    .replace(/[^\x00-\x7F]/g, "");
}

function llmHeaders() {
  const h = {
    "Content-Type": "application/json",
    "X-API-Key": latin1Header(state.config.api_key),
    "X-Base-Url": latin1Header(sanitizeUrl(state.config.base_url)),
    "X-Model": latin1Header(state.config.model),
  };
  if (state.config.tavily_key) h["X-Tavily-Key"] = latin1Header(state.config.tavily_key);
  return h;
}

function formatApiError(data, fallback) {
  const d = data?.detail;
  if (typeof d === "string") return d;
  if (Array.isArray(d)) return d.map((x) => x.msg || JSON.stringify(x)).join("; ");
  return data?.message || fallback;
}

async function readApiResponse(res) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(formatApiError(data, res.statusText));
  return data;
}

async function apiJson(path, opts = {}) {
  const res = await fetch(path, { ...opts, headers: { ...llmHeaders(), ...(opts.headers || {}) } });
  return readApiResponse(res);
}

// --- Auth / settings ---
function updateSidebarStatus() {
  const nameEl = $("#settingsUserName");
  const modelEl = $("#settingsUserModel");
  const avatarEl = $("#settingsUserAvatar");
  const rootEl = $("#settingsDataRoot");
  const lib = $("#projectLibrarySection");
  if (state.loggedIn) {
    if (nameEl) nameEl.textContent = state.displayName || "User";
    if (modelEl) modelEl.textContent = state.config.model || "Connected";
    if (avatarEl) avatarEl.textContent = userAvatarLetter();
    if (rootEl) rootEl.value = state.dataRoot || "";
    if (lib) lib.hidden = false;
    window.JoekuFeatures?.updateLibraryProjectLabel?.();
  } else {
    if (nameEl) nameEl.textContent = "Not signed in";
    if (modelEl) modelEl.textContent = "—";
    if (avatarEl) avatarEl.textContent = "J";
    if (rootEl) rootEl.value = "";
    if (lib) lib.hidden = true;
  }
}

function selectModelValue(selectEl, model) {
  if (!selectEl?.options?.length) return;
  const has = [...selectEl.options].some((o) => o.value === model);
  selectEl.value = has ? model : "deepseek-chat";
}

function fillSettingsForm() {
  $("#displayNameInput").value = state.displayName || "";
  $("#apiKeyInput").value = state.config.api_key;
  $("#baseUrlInput").value = sanitizeUrl(state.config.base_url);
  selectModelValue($("#modelInput"), state.config.model || "deepseek-chat");
  $("#tavilyKeyInput").value = state.config.tavily_key || "";
  if ($("#settingsDataRoot")) $("#settingsDataRoot").value = state.dataRoot || "";
  updateSidebarStatus();
}

async function fillLoginForm() {
  $("#loginDisplayName").value = state.displayName || "";
  $("#loginPersonaHint") && ($("#loginPersonaHint").value = state.personaHint || "");
  $("#loginApiKey").value = "";
  $("#loginBaseUrl").value = sanitizeUrl(state.config.base_url) || "https://api.deepseek.com/v1";
  selectModelValue($("#loginModel"), state.config.model || "deepseek-chat");

  // For cloud deployments: try to use server DEFAULT_DATA_ROOT automatically
  if (window.JoekuFeatures?.tryLoadServerDefaultDataRoot) {
    await window.JoekuFeatures.tryLoadServerDefaultDataRoot();
  }

  if ($("#loginDataRoot")) $("#loginDataRoot").value = state.dataRoot || "";
  if ($("#loginDataRootHint")) {
    $("#loginDataRootHint").textContent = state.dataRoot || "数据存储在应用运行的位置";
  }
  // Show hosted hint if server provided default
  const hostedHint = $("#hostedDataHint");
  if (hostedHint) {
    const fromServer = !!window.__JOEKU_SERVER_DEFAULT;
    hostedHint.style.display = (state.dataRoot && fromServer) ? "block" : "none";
  }

  // Also show in settings local tab
  const hostedNote = $("#hostedNote");
  if (hostedNote) {
    const fromServer = !!window.__JOEKU_SERVER_DEFAULT;
    hostedNote.style.display = fromServer ? "block" : "none";
  }
  const identitySel = $("#loginIdentity");
  const dataRoot = ($("#loginDataRoot")?.value || state.dataRoot || "").trim();
  if (!dataRoot) {
    if (identitySel) {
      identitySel.disabled = true;
      identitySel.innerHTML = '<option value="">请先选择或输入数据目录</option>';
    }
    window.JoekuFeatures?.setLoginMode?.("register");
  } else if (window.JoekuFeatures?.renderIdentitySelect) {
    await window.JoekuFeatures.renderIdentitySelect();
    if (state.localUserId && identitySel) identitySel.value = state.localUserId;
    window.JoekuFeatures.onIdentityChange();
  }
}

function setLoginStatus(msg, type = "") {
  const el = $("#loginStatus");
  if (!el) return;
  el.textContent = msg || "";
  el.className = "login-gate-status" + (type ? ` ${type}` : "");
}

async function testConnection(fromLogin = false) {
  const apiKey = (fromLogin ? $("#loginApiKey") : $("#apiKeyInput"))?.value?.trim();
  const baseUrl =
    sanitizeUrl((fromLogin ? $("#loginBaseUrl") : $("#baseUrlInput"))?.value) || "https://api.deepseek.com/v1";
  const model = (fromLogin ? $("#loginModel") : $("#modelInput"))?.value?.trim() || "deepseek-chat";
  const displayName = (fromLogin ? $("#loginDisplayName") : $("#displayNameInput"))?.value?.trim() || state.displayName;
  const statusEl = fromLogin ? null : $("#settingsResult");

  if (!apiKey) {
    const msg = "请输入 API Key";
    if (fromLogin) setLoginStatus(msg, "err");
    else if (statusEl) statusEl.textContent = msg;
    else alert(msg);
    return false;
  }
  const loginMode = fromLogin ? window.JoekuFeatures?.getLoginMode?.() || "existing" : "existing";
  const identityId = fromLogin && loginMode === "existing" ? $("#loginIdentity")?.value?.trim() : "";
  const newIdentityName = fromLogin && loginMode === "register" ? $("#loginDisplayName")?.value?.trim() : "";
  if (fromLogin && loginMode === "existing" && !identityId) {
    setLoginStatus("请选择要登录的身份，或切换到「注册新身份」", "err");
    return false;
  }
  if (fromLogin && loginMode === "register" && !newIdentityName) {
    setLoginStatus("请填写新身份名称", "err");
    return false;
  }
  if (fromLogin) {
    state.dataRoot = ($("#loginDataRoot")?.value || state.dataRoot || "").trim();
    if (!state.dataRoot) {
      setLoginStatus("请先选择本地数据目录", "err");
      return false;
    }
    localStorage.setItem("joeku-data-root", state.dataRoot);
  }
  if (fromLogin) setLoginStatus("正在注册本地用户并测试连接…");
  else if (statusEl) statusEl.textContent = "正在测试连接…";

  const prevUserId = state.userId;
  const prevProjects = state.projects;
  const prevProjectId = state.currentProjectId;
  const prevSaveFolder = state.saveFolder;

  try {
    if (fromLogin && window.JoekuFeatures) {
      state.dataRoot = ($("#loginDataRoot")?.value || state.dataRoot || "").trim();
      await window.JoekuFeatures.validateDataRoot(state.dataRoot);
      if (identityId) {
        state.localUserId = identityId;
        localStorage.setItem("joeku-local-user-id", identityId);
        const st = await fetch(
          `/api/local/state?data_root=${encodeURIComponent(state.dataRoot)}&user_id=${encodeURIComponent(identityId)}`
        );
        const profileData = await st.json();
        state.displayName = profileData.profile?.identity_name || profileData.profile?.display_name || displayName;
        state.personaHint = profileData.profile?.persona_hint || "";
      } else {
        localStorage.removeItem("joeku-local-user-id");
        state.localUserId = "";
        const persona = $("#loginPersonaHint")?.value?.trim() || "";
        await window.JoekuFeatures.registerLocalUser(newIdentityName, persona);
      }
    }
    const res = await fetch("/api/config/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ api_key: apiKey, base_url: baseUrl, model }),
    });
    const data = await readApiResponse(res);
    const tavilyKey = (fromLogin ? state.config.tavily_key : $("#tavilyKeyInput")?.value?.trim()) || state.config.tavily_key || "";
    state.config = { api_key: apiKey, base_url: sanitizeUrl(baseUrl), model, tavily_key: tavilyKey };
    const sessionName = identityId ? state.displayName || displayName : state.displayName || newIdentityName || displayName;
    await activateUserSession(sessionName, apiKey, baseUrl);
    if (window.JoekuFeatures) await window.JoekuFeatures.loadLibrary();
    if (prevUserId && prevUserId !== state.userId) {
      // switched user — projects reloaded in activateUserSession
    } else if (prevUserId === state.userId && prevProjects.length) {
      state.projects = prevProjects;
      state.currentProjectId = prevProjectId;
      state.saveFolder = prevSaveFolder;
      loadCurrentProjectData();
    }
    state.loggedIn = true;
    saveConfig();
    saveProjects();
    updateSidebarStatus();
    fillSettingsForm();
    renderProjectList();
    renderChatList();
    if (fromLogin) startNewSessionChat();
    else {
      renderThread("generate");
      renderDocPreview();
    }
    if (statusEl) statusEl.textContent = data.message || "Connected";
    if (fromLogin) {
      setLoginStatus(data.message || "Connected", "ok");
      closeLoginGate();
      setMode("generate");
      fillComposerModelSelect();
      $("#composerApiReauth")?.setAttribute("hidden", "");
      refreshSuggestions().catch(() => {});
    } else {
      fillComposerModelSelect();
    }
    return true;
  } catch (e) {
    state.loggedIn = false;
    state.userId = prevUserId;
    updateSidebarStatus();
    let msg = e.message || String(e);
    if (!msg.startsWith("连接失败")) msg = "连接失败: " + msg;
    if (msg.startsWith("连接失败: 连接失败:")) msg = msg.replace("连接失败: 连接失败:", "连接失败:");
    if (fromLogin) setLoginStatus(msg, "err");
    else if (statusEl) statusEl.textContent = msg;
    else alert(msg);
    return false;
  }
}

function applyModel() {
  if (!state.loggedIn) {
    openLoginGate();
    return;
  }
  const model = $("#modelInput")?.value?.trim() || "deepseek-chat";
  if (model !== state.config.model) {
    state.pendingModel = model;
    state.config.api_key = "";
    selectModelValue($("#composerModel"), model);
    $("#composerApiReauth")?.removeAttribute("hidden");
  } else {
    state.config.model = model;
    saveConfig();
    fillComposerModelSelect();
  }
  updateSidebarStatus();
  const el = $("#settingsResult");
  if (el) el.textContent = model !== state.config.model ? `已选择 ${model}，请在输入框重新确认 API Key` : `已切换模型为 ${model}`;
}

function logout() {
  state.config.api_key = "";
  state.loggedIn = false;
  state.userId = null;
  saveConfig();
  localStorage.removeItem(STORAGE.session);
  updateSidebarStatus();
  $("#settingsResult").textContent = "已退出，请重新登录";
  openLoginGate();
}

function unlockPage() {
  document.body.removeAttribute("inert");
  document.body.style.pointerEvents = "auto";
  document.querySelectorAll("[inert]").forEach((n) => n.removeAttribute("inert"));
}

function openModal(id) {
  unlockPage();
  const el = document.getElementById(id);
  if (el) el.hidden = false;
}

function closeModal(id) {
  const el = typeof id === "string" ? document.getElementById(id) : id;
  if (el) el.hidden = true;
  unlockPage();
}

async function openLoginGate() {
  unlockPage();
  setLoginStatus("");
  const gate = $("#loginGate");
  if (gate) gate.hidden = false;
  try {
    await fillLoginForm();
  } catch (err) {
    setLoginStatus(`加载身份列表失败：${err.message}`, "err");
  }
}

function closeLoginGate() {
  const gate = $("#loginGate");
  if (gate) gate.hidden = true;
  unlockPage();
}

function requireLogin() {
  if (!state.loggedIn) {
    openLoginGate();
    return false;
  }
  if (!state.config.api_key) {
    $("#composerApiReauth")?.removeAttribute("hidden");
    $("#composerApiKey")?.focus();
    return false;
  }
  return true;
}

// --- Mode / layout ---
function openSidebarDrawer() {
  $("#appShell")?.classList.add("sidebar-drawer-open");
  $("#sidebarDrawerScrim")?.removeAttribute("hidden");
}

function closeSidebarDrawer() {
  $("#appShell")?.classList.remove("sidebar-drawer-open");
  $("#sidebarDrawerScrim")?.setAttribute("hidden", "");
}

function setSettingsTab(tab) {
  const tabs = ["profile", "api", "local"];
  const active = tabs.includes(tab) ? tab : "profile";
  document.querySelectorAll("[data-settings-tab]").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.settingsTab === active);
  });
  document.querySelectorAll("[data-settings-panel]").forEach((panel) => {
    const on = panel.dataset.settingsPanel === active;
    panel.classList.toggle("active", on);
    if (on) panel.removeAttribute("hidden");
    else panel.setAttribute("hidden", "");
  });
  localStorage.setItem("joeku-settings-tab", active);
}

function setMode(mode) {
  if (mode === "revise") mode = "generate";
  state.mode = mode;
  $$(".rail-btn").forEach((el) => el.classList.toggle("active", el.dataset.mode === mode));
  $$(".workspace").forEach((ws) => ws.classList.toggle("active", ws.dataset.mode === mode));
  const settingsOpen = mode === "settings";
  $("#appShell")?.classList.toggle("settings-open", settingsOpen);
  $("#settingsRailBtn")?.classList.toggle("gear-active", settingsOpen);
  $("#workspace-settings")?.classList.toggle("open", settingsOpen);
  const scrim = $("#settingsScrim");
  if (scrim) {
    if (settingsOpen) scrim.removeAttribute("hidden");
    else scrim.setAttribute("hidden", "");
  }
  if (settingsOpen) {
    fillSettingsForm();
    setSettingsTab(localStorage.getItem("joeku-settings-tab") || "profile");
    closeSidebarDrawer();
  }
}

function setDocOpenLayout(on) {
  const ws = $("#workspace-generate");
  ws?.classList.toggle("doc-open", on);
  updateDocPanelChrome();
  updateExportButtons();
}

function isDocCollapsed() {
  return $("#workspace-generate")?.classList.contains("doc-collapsed") ?? false;
}

function updateDocPanelChrome() {
  const ws = $("#workspace-generate");
  const collapsed = isDocCollapsed();
  const open = ws?.classList.contains("doc-open") || ws?.classList.contains("generating");
  const tab = $("#docExpandTab");
  const btn = $("#docToggleBtn");
  if (tab) tab.hidden = !(open && collapsed);
  if (btn) {
    btn.textContent = collapsed ? "‹" : "›";
    btn.title = collapsed ? "Expand document" : "Collapse document";
  }
}

function setDocCollapsed(collapsed) {
  const ws = $("#workspace-generate");
  ws?.classList.toggle("doc-collapsed", collapsed);
  localStorage.setItem(STORAGE.docCollapsed, collapsed ? "1" : "0");
  updateDocPanelChrome();
}

function toggleDocPanel() {
  if (!($("#workspace-generate")?.classList.contains("doc-open") || state.isGenerating)) return;
  setDocCollapsed(!isDocCollapsed());
}

function setGeneratingLayout(on) {
  const ws = $("#workspace-generate");
  ws?.classList.toggle("generating", on);
  state.isGenerating = on;
  const st = $("#docStatus");
  if (st) st.textContent = on ? "Generating…" : state.paper ? "Ready" : "Waiting";
  updateDocPanelChrome();
}

function updateExportButtons() {
  const has = !!state.paper;
  $("#exportDocxBtn").disabled = !has;
  $("#exportPdfBtn").disabled = !has;
}

function applyGenerationPreview(preview, step, message, percent, extra = {}) {
  if (!preview) return;
  const phase = step || "write";
  state.paper = preview;
  persistCurrentProject();
  updateProgressTurn(message || null, percent, phase, preview, extra);
  if (shouldOpenDocPanel(phase)) {
    renderDocPreview();
    setDocOpenLayout(true);
  }
}

// --- Thread ---
function threadEl(mode) {
  return mode === "revise" ? $("#thread-revise") : $("#thread-generate");
}

function messagesFor(mode) {
  return mode === "revise" ? state.reviseMessages : state.generateMessages;
}

function normalizeRole(role) {
  if (role === "agent") return "assistant";
  return role;
}

function addTurn(role, content, opts = {}) {
  const mode = opts.mode || state.mode;
  if (mode === "generate") ensureCurrentChat();
  const entry = { role: normalizeRole(role), content, ts: Date.now(), ...opts };
  if (mode === "revise") state.reviseMessages.push(entry);
  else state.generateMessages.push(entry);
  persistCurrentProject();
  saveProjects();
  renderThread(mode);
  return entry.streamId || entry.thinkId || null;
}

function traceSteps(entry) {
  return (entry.thinkSteps || []).filter((s) => s.label?.trim());
}

function thinkingPanelOpts(entry) {
  const steps = traceSteps(entry);
  const thinkActive = (!!entry.thinking || !!entry.thinkReasoning) && !entry.thinkDone;
  const done = !!entry.thinkDone || (!thinkActive && (!!entry.content || !entry.streaming));
  const started = entry.thinkStartedAt || entry.ts || Date.now();
  const ticker = resolveThinkTicker(entry, steps);
  return {
    label: "Agent",
    steps,
    percent: typeof entry.thinkPercent === "number" ? entry.thinkPercent : null,
    done,
    collapsed: !!entry.thinkCollapsed,
    liveOnly: true,
    liveAction: thinkActive && !ticker ? "处理中…" : ticker,
    thinkStream: "",
    thinkStreaming: false,
    elapsedMs: Date.now() - started,
    streaming: thinkActive,
    showDots: thinkActive,
    tickerExpanded: !!entry.thinkTickerExpanded,
    tickerCollapsed: false,
    progress: !!entry.progress,
    sectionCurrent: entry.sectionCurrent || "",
    sectionsPlan: entry.sectionsPlan || [],
    genStepLabel: entry.thinkLabel || GEN_STEP_LABELS[entry.genStep] || "",
    genStepLog: entry.genStepLog || [],
    genStep: entry.genStep || "",
  };
}

function thinkingBubbleExtras(entry, answerHtml) {
  const opts = thinkingPanelOpts(entry);
  if (entry.genPreview) opts.genPreviewHtml = renderMarkdown(entry.genPreview);
  return { opts, answerHtml: answerHtml || "" };
}

function renderThinkingBubble(bubble, entry, answerHtml, { patch = false } = {}) {
  if (!bubble || !window.JoekuThinking) return;
  const { opts, answerHtml: html } = thinkingBubbleExtras(entry, answerHtml);
  if (patch && window.JoekuThinking.patchBubble) {
    window.JoekuThinking.patchBubble(bubble, opts, html);
  } else {
    let fullHtml = html;
    if (entry.genPreview) {
      fullHtml = `<div class="gen-preview-stream">${renderMarkdown(entry.genPreview)}</div>${fullHtml}`;
    }
    window.JoekuThinking.renderBubble(bubble, opts, fullHtml);
  }
}

function findThinkingBubble(thinkId, mode) {
  const thread = threadEl(mode);
  const row = thread?.querySelector(`[data-think-id="${thinkId}"]`);
  return row?.querySelector(".msg-bubble") || null;
}

function updateThinkingBubbleInPlace(thinkId, mode) {
  const msgs = mode === "revise" ? state.reviseMessages : state.generateMessages;
  const entry = msgs.find((m) => m.thinkId === thinkId);
  if (!entry) return;
  const bubble = findThinkingBubble(thinkId, mode);
  if (!bubble) {
    renderThread(mode);
    return;
  }
  let answerHtml = "";
  if (entry.thinkOnly && entry.thinking) {
    answerHtml = "";
  } else if (entry.content || (entry.streaming && !entry.thinking)) {
    answerHtml =
      entry.markdown === false
        ? wrapDsAnswer(wrapMsgProse(`<p>${esc(entry.content)}</p>`, { answer: true }))
        : buildAnswerHtml(entry.content, { streaming: !!entry.streaming });
  }
  renderThinkingBubble(bubble, entry, answerHtml, { patch: true });
  const scroller = threadEl(mode)?.closest(".chat-scroll");
  if (scroller) scroller.scrollTop = scroller.scrollHeight;
}

function addThinkingTurn(mode, opts = {}) {
  const thinkId = "think_" + Date.now();
  const entry = {
    role: "assistant",
    content: "",
    thinkId,
    thinking: true,
    thinkOnly: !!opts.thinkOnly,
    thinkStream: "",
    thinkLabel: opts.label || thinkingLabelForMode(state.chatMode),
    thinkSteps: opts.steps || [],
    thinkPercent: typeof opts.percent === "number" ? opts.percent : null,
    progress: !!opts.progress,
    thinkCollapsed: false,
    ts: Date.now(),
  };
  if (mode === "revise") state.reviseMessages.push(entry);
  else state.generateMessages.push(entry);
  renderThread(mode);
  return thinkId;
}

function finishThinkingTurn(thinkId, content, mode, opts = {}) {
  const msgs = mode === "revise" ? state.reviseMessages : state.generateMessages;
  const entry = msgs.find((m) => m.thinkId === thinkId);
  if (!entry) {
    addTurn("assistant", content, { mode, thinkLabel: opts.label });
    return;
  }
  entry.thinking = false;
  entry.content = content;
  if (opts.label) entry.thinkLabel = opts.label;
  if (opts.steps?.length) entry.thinkSteps = opts.steps;
  if (typeof opts.percent === "number") entry.thinkPercent = opts.percent;
  entry.thinkCollapsed = opts.collapsed !== false;
  persistCurrentProject();
  saveProjects();
  renderThread(mode);
}

function addStreamingTurn(mode, opts = {}) {
  const streamId = "stream_" + Date.now();
  const withTrace = !!opts.withTrace;
  const entry = {
    role: "assistant",
    content: "",
    streamId,
    streaming: true,
    thinking: withTrace,
    answerOnly: !!opts.answerOnly && !withTrace,
    thinkLabel: opts.label || (opts.answerOnly ? "Response" : "Working…"),
    thinkSteps: opts.steps || [],
    thinkLiveAction: "",
    thinkReasoning: false,
    thinkDone: false,
    thinkStartedAt: Date.now(),
    thinkPercent: null,
    thinkCollapsed: false,
    ts: Date.now(),
  };
  if (mode === "revise") state.reviseMessages.push(entry);
  else state.generateMessages.push(entry);
  renderThread(mode);
  return streamId;
}

function patchStreamingBubble(streamId, mode) {
  const msgs = mode === "revise" ? state.reviseMessages : state.generateMessages;
  const entry = msgs.find((m) => m.streamId === streamId);
  if (!entry) return;
  const thread = threadEl(mode);
  const bubble = thread?.querySelector(`[data-stream-id="${streamId}"] .msg-bubble`);
  if (!bubble) {
    renderThread(mode);
    return;
  }
  const answerHtml = buildAnswerHtml(entry.content, { streaming: !!entry.streaming });
  if (entry.answerOnly && !traceSteps(entry).length && !entry.thinking && !entry.thinkReasoning) {
    bubble.innerHTML = answerHtml || buildAnswerHtml("", { streaming: true });
  } else {
    renderThinkingBubble(bubble, entry, answerHtml, { patch: true });
  }
  const scroller = thread?.closest(".chat-scroll");
  if (scroller) scroller.scrollTop = scroller.scrollHeight;
}

function updateStreamingTurn(streamId, content, mode) {
  const msgs = mode === "revise" ? state.reviseMessages : state.generateMessages;
  const entry = msgs.find((m) => m.streamId === streamId);
  if (!entry) return;
  entry.content = content;
  patchStreamingBubble(streamId, mode);
}

function updateThinkStreamTurn(thinkId, _content, mode) {
  const msgs = mode === "revise" ? state.reviseMessages : state.generateMessages;
  const entry = msgs.find((m) => m.thinkId === thinkId);
  if (!entry) return;
  entry.thinkReasoning = true;
  entry.thinking = true;
  if (!entry.thinkLiveAction) entry.thinkLiveAction = reasoningPhaseLabel(entry);
  updateThinkingBubbleInPlace(thinkId, mode);
}

function finalizeStreamingTurn(streamId, content, mode, opts = {}) {
  const msgs = mode === "revise" ? state.reviseMessages : state.generateMessages;
  const entry = msgs.find((m) => m.streamId === streamId);
  if (!entry) {
    addTurn("assistant", content, { mode });
    return;
  }
  entry.streaming = false;
  entry.thinking = false;
  entry.thinkDone = true;
  entry.content = postprocessAssistantMarkdown(content);
  entry.markdown = true;
  entry.thinkCollapsed = true;
  const lastStep = traceSteps(entry).slice(-1)[0];
  entry.thinkReasoning = false;
  entry.thinkLiveAction =
    stepTickerLabel(lastStep) || entry.thinkLiveAction || "";
  if (opts.revisionAnnId) {
    entry.revisionApply = true;
    entry.revisionAnnId = opts.revisionAnnId;
    if (state.pendingRevision) state.pendingRevision.advice = content;
  }
  persistCurrentProject();
  saveProjects();
  renderThread(mode);
}

function emptyEl(mode) {
  return mode === "revise" ? $("#emptyRevise") : $("#emptyGenerate");
}

function renderThread(mode) {
  const thread = threadEl(mode);
  if (!thread) return;
  const msgs = messagesFor(mode).filter((m) => m.role !== "system");
  const empty = emptyEl(mode);
  if (empty) empty.hidden = msgs.length > 0;
  thread.innerHTML = "";

  msgs.forEach((m, i) => {
    const role = normalizeRole(m.role);
    const isUser = role === "user";
    const row = document.createElement("div");
    const isNew = i === msgs.length - 1;
    row.className = `msg-row ${isUser ? "user" : "assistant"}${isNew ? " is-new" : ""}`;
    if (m.streamId) row.dataset.streamId = m.streamId;
    if (m.thinkId) row.dataset.thinkId = m.thinkId;
    const avatar = document.createElement("div");
    avatar.className = "msg-avatar";
    fillAvatar(avatar, isUser);
    const bubble = document.createElement("div");
    bubble.className = "msg-bubble";
    if (m.thinkOnly && window.JoekuThinking) {
      row.classList.add("thinking-row", "thinking-only");
      renderThinkingBubble(bubble, m, "");
    } else if (
      (m.thinking || m.progress || m.streaming || (m.thinkSteps?.length && m.content)) &&
      window.JoekuThinking &&
      !m.answerOnly
    ) {
      row.classList.add("thinking-row");
      const answerHtml =
        m.markdown === false
          ? wrapDsAnswer(wrapMsgProse(`<p>${esc(m.content)}</p>`, { answer: true }))
          : buildAnswerHtml(m.content, { streaming: !!m.streaming });
      renderThinkingBubble(bubble, m, answerHtml);
    } else if (m.streaming && m.answerOnly) {
      row.classList.add("answer-only");
      bubble.innerHTML = buildAnswerHtml(m.content, { streaming: true });
    } else if (isUser) {
      bubble.innerHTML = `<div class="msg-prose user-prose"><p>${esc(m.content)}</p></div>`;
    } else {
      bubble.innerHTML =
        m.markdown !== false
          ? buildAnswerHtml(m.content)
          : wrapDsAnswer(wrapMsgProse(`<p>${escHtml(m.content)}</p>`, { answer: true }));
      if (m.writeOffer?.topic) {
        const act = document.createElement("div");
        act.className = "msg-gen-offer";
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "btn-pill sm gen-switch-btn";
        btn.textContent = `切换到 Generate 创作 · ${m.writeOffer.topic}`;
        btn.addEventListener("click", () => acceptGenerateOffer(m.writeOffer.topic));
        const hint = document.createElement("p");
        hint.className = "gen-offer-hint";
        hint.textContent = "将打开参数面板，创作过程会逐步显示检索、规划、撰写等步骤。";
        act.appendChild(btn);
        act.appendChild(hint);
        bubble.appendChild(act);
      }
      if (m.revisionApply && m.revisionAnnId) {
        const act = document.createElement("div");
        act.className = "msg-revision-actions";
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "btn-pill sm revision-apply-btn";
        btn.textContent = "Apply to document";
        btn.addEventListener("click", () => {
          window.JoekuFeatures?.applyAnnotationRevision?.(m.revisionAnnId);
        });
        act.appendChild(btn);
        bubble.appendChild(act);
      }
    }
    row.appendChild(avatar);
    row.appendChild(bubble);
    thread.appendChild(row);
  });
  const scroller = thread.closest(".chat-scroll");
  if (scroller) scroller.scrollTo({ top: scroller.scrollHeight, behavior: "smooth" });
}

function ensureGenProgressTurn() {
  if (state.genProgressId) {
    const existing = state.generateMessages.find((m) => m.thinkId === state.genProgressId);
    if (existing) return state.genProgressId;
  }
  const thinkId = addThinkingTurn("generate", {
    label: "Preparing generation",
    steps: [],
    percent: 0,
    progress: true,
  });
  const entry = state.generateMessages.find((m) => m.thinkId === thinkId);
  if (entry) entry.progress = true;
  state.genProgressId = thinkId;
  return thinkId;
}

function updateProgressTurn(message, percent, step, preview, extra = {}) {
  const thinkId = ensureGenProgressTurn();
  const entry = state.generateMessages.find((m) => m.thinkId === thinkId);
  if (!entry) return;
  entry.thinking = true;
  entry.progress = true;
  if (step) entry.genStep = step;
  if (message) entry.thinkLabel = message;
  else if (step) entry.thinkLabel = GEN_STEP_LABELS[step] || entry.thinkLabel;
  if (typeof percent === "number") entry.thinkPercent = percent;
  if (message) entry.content = message;
  if (preview) entry.genPreview = preview;
  if (extra.sectionCurrent !== undefined) entry.sectionCurrent = extra.sectionCurrent || "";
  if (extra.sectionsPlan) entry.sectionsPlan = extra.sectionsPlan;
  entry.thinkLiveAction = entry.sectionCurrent
    ? `撰写 · ${entry.sectionCurrent}`
    : message || entry.thinkLabel || "";
  appendGenStepLog(entry, step, message || GEN_STEP_LABELS[step], percent);
  const steps = entry.thinkSteps || [];
  const line = message || (step ? GEN_STEP_LABELS[step] : "");
  if (line && steps[steps.length - 1]?.label !== line) {
    steps.push({ type: "write", label: line, detail: entry.sectionCurrent || "", phase: "respond" });
  }
  entry.thinkSteps = steps.slice(-12);
  persistCurrentProject();
  updateThinkingBubbleInPlace(thinkId, "generate");
}

function clearProgressTurn() {
  if (state.genProgressId) {
    const entry = state.generateMessages.find((m) => m.thinkId === state.genProgressId);
    if (entry) {
      entry.thinking = false;
      entry.progress = false;
      entry.thinkPercent = 100;
      entry.thinkCollapsed = true;
      if (entry.genStepLog?.length) {
        entry.genStepLog.forEach((s) => {
          s.active = false;
          s.done = true;
        });
      }
      if (!entry.thinkSteps?.length && entry.content) entry.thinkSteps = [entry.content];
    }
    state.genProgressId = null;
    renderThread("generate");
  }
}

// --- Doc preview ---
function renderDocPreview() {
  const el = $("#docPreview");
  const edit = $("#docEditor");
  if (!state.paper) {
    if (el) el.innerHTML = '<p class="doc-placeholder">Your paper will preview here once generation starts</p>';
    if (edit) edit.value = "";
    if (window.JoekuFeatures?.clearParagraphSelection) window.JoekuFeatures.clearParagraphSelection();
    return;
  }
  if (edit && state.docViewMode === "edit") {
    if (document.activeElement !== edit) edit.value = state.paper;
  } else if (el) {
    const paras = splitPaperParagraphs(state.paper);
    el.innerHTML = paras
      .map((p, i) => `<div class="doc-para" data-para-id="${i}">${renderMarkdown(p)}</div>`)
      .join("");
    if (window.JoekuFeatures?.bindDocParagraphSelection) window.JoekuFeatures.bindDocParagraphSelection();
    if (window.JoekuFeatures?.renderAnnotationUI) window.JoekuFeatures.renderAnnotationUI();
  }
  $("#genResult").textContent = state.paper;
  updateExportButtons();
}

// --- Params modal ---
function readExportFormatFromForm() {
  const fmt = {
    font_family: $("#genFontFamily")?.value || "times",
    font_size: parseInt($("#genFontSize")?.value, 10) || 12,
    line_spacing: parseFloat($("#genLineSpacing")?.value) || 1.5,
    margin_inches: 1.25,
    first_line_indent_chars: parseFloat($("#genFirstLineIndent")?.value) || 0,
    cover_page: state.coverPage || state.exportFormat?.cover_page || null,
  };
  state.exportFormat = fmt;
  localStorage.setItem(STORAGE.exportFormat, JSON.stringify(fmt));
  return fmt;
}

function applyExportFormatToForm() {
  const f = state.exportFormat;
  if ($("#genFontFamily")) $("#genFontFamily").value = f.font_family || "times";
  if ($("#genFontSize")) $("#genFontSize").value = String(f.font_size || 12);
  if ($("#genLineSpacing")) $("#genLineSpacing").value = String(f.line_spacing || 1.5);
  if ($("#genFirstLineIndent")) $("#genFirstLineIndent").value = String(f.first_line_indent_chars ?? 0);
}

function setParamsReopenBar(show) {
  const el = $("#paramsReopenBar");
  if (el) el.hidden = !show;
}

function readGenParamsFromForm() {
  return {
    target_words: parseInt($("#genWords")?.value, 10) || 6000,
    citation_limit: parseInt($("#genCites")?.value, 10) || 15,
    language: $("#genLanguage")?.value || "zh",
    citation_format: $("#genCitationFormat")?.value || "apa7",
    web_search: $("#genWebSearch")?.checked !== false,
    de_ai: !!$("#genDeAi")?.checked,
    deep_quality: !!$("#genDeepQuality")?.checked,
  };
}

function saveGenParamsToChat(params) {
  const chat = currentChat();
  if (chat) chat.lastGenParams = { ...params, topic: state.topic || params.topic };
  try {
    localStorage.setItem(userKey("gen-params"), JSON.stringify(params));
  } catch (_) {}
}

function chatMessagesForTopic() {
  return (state.generateMessages || [])
    .filter(
      (m) =>
        (m.role === "user" || m.role === "assistant") &&
        !m.thinking &&
        !m.streaming &&
        !m.progress &&
        !m.thinkOnly &&
        m.content?.trim()
    )
    .slice(-20)
    .map((m) => ({ role: m.role, content: m.content }));
}

function heuristicTopicFromChat() {
  const trivial = /^(hi|hello|hey|thanks|thank you|ok|okay|yes|no|你好|嗨|谢谢|好的)[\s!.?，。]*$/i;
  const users = chatMessagesForTopic()
    .filter((m) => m.role === "user")
    .map((m) => m.content.trim())
    .filter((t) => t.length >= 8 && !trivial.test(t));
  return users.length ? users[users.length - 1].slice(0, 120) : "";
}

async function inferTopicFromSession() {
  const chat = currentChat();
  const saved = { ...(chat?.lastGenParams || {}) };
  try {
    const local = JSON.parse(localStorage.getItem(userKey("gen-params")) || "{}");
    Object.assign(saved, local);
  } catch (_) {}
  if (state.topic && state.topic.length >= 3) return state.topic;
  if (saved.topic && saved.topic.length >= 3) return saved.topic;
  const msgs = chatMessagesForTopic();
  if (!msgs.length) return heuristicTopicFromChat();
  try {
    const data = await apiJson("/api/summarize-topic", {
      method: "POST",
      body: JSON.stringify({
        messages: msgs,
        paper_context: state.paper || "",
        ...(window.JoekuFeatures ? window.JoekuFeatures.localPayload() : {}),
      }),
    });
    const topic = (data.topic || "").trim();
    if (topic.length >= 3) return topic;
  } catch (err) {
    console.warn("Topic summarize:", err);
  }
  return heuristicTopicFromChat();
}

function inferParamsFromSession() {
  const chat = currentChat();
  const saved = { ...(chat?.lastGenParams || {}) };
  try {
    const local = JSON.parse(localStorage.getItem(userKey("gen-params")) || "{}");
    Object.assign(saved, local);
  } catch (_) {}
  return { ...saved, topic: state.topic || saved.topic || "" };
}

function applyGenParamsToForm(params) {
  if (params.target_words) $("#genWords").value = String(params.target_words);
  if (params.citation_limit) $("#genCites").value = String(params.citation_limit);
  if (params.language && $("#genLanguage")) $("#genLanguage").value = params.language;
  if (params.citation_format && $("#genCitationFormat")) {
    $("#genCitationFormat").value = params.citation_format;
  }
  if ($("#genWebSearch")) $("#genWebSearch").checked = params.web_search !== false;
  if ($("#genDeAi")) $("#genDeAi").checked = !!params.de_ai;
  if ($("#genDeepQuality")) $("#genDeepQuality").checked = !!params.deep_quality;
}

function dismissParamsDialog() {
  if (!confirm("Exit parameters for now? Your chat history is kept — reopen anytime from the bar above.")) return;
  closeModal("paramsDialog");
  state.paramsPending = true;
  setParamsReopenBar(true);
}

function reopenParamsDialog() {
  if (state.topic) $("#genTopic").value = state.topic;
  state.paramsPending = true;
  setParamsReopenBar(false);
  openParamsDialog();
}

function exitParamsMode() {
  state.paramsPending = false;
  setParamsReopenBar(false);
  closeModal("paramsDialog");
  applyWorkspaceMode("chatbot");
}

async function openParamsDialog() {
  const inferred = inferParamsFromSession();
  const topicInput = $("#genTopic");
  if (topicInput) {
    topicInput.value = "";
    topicInput.placeholder = "Summarizing topic from conversation…";
  }
  state.paramsPending = true;
  applyGenParamsToForm(inferred);
  $("#paramsHint").textContent = state.requirementsName
    ? `Requirements file "${state.requirementsName}" attached — defaults from this chat (body word count excludes references)`
    : "Topic inferred from your whole conversation — adjust before generating";
  $("#saveFolder").value = state.saveFolder;
  applyExportFormatToForm();
  setParamsReopenBar(false);
  openModal("paramsDialog");
  const topic =
    (await inferTopicFromSession()) ||
    inferred.topic ||
    (state.requirementsName ? `Based on requirements: ${state.requirementsName}` : "");
  if (topicInput) {
    topicInput.placeholder = "";
    topicInput.value = topic;
  }
  state.topic = topic;
}

function updateReqAttachUI() {
  const btn = $("#attachReqBtn");
  if (!btn) return;
  if (state.requirementsName) {
    btn.classList.add("has-file");
    btn.title = `已附加：${state.requirementsName}（点击更换，Alt+点击清除）`;
  } else {
    btn.classList.remove("has-file");
    btn.title = "上传要求文档";
  }
}

function updateReviseAttachUI() {
  const btn = $("#reviseAttachBtn");
  if (!btn) return;
  if (state.reviseDocName) {
    btn.classList.add("has-file");
    btn.title = `已附加：${state.reviseDocName}（点击更换，Alt+点击清除）`;
  } else {
    btn.classList.remove("has-file");
    btn.title = "上传文档";
  }
}

function clearPendingReq() {
  state.requirementsText = "";
  state.requirementsName = "";
  updateReqAttachUI();
}

function clearReviseAttach() {
  state.reviseDocText = "";
  state.reviseDocName = "";
  $("#reviseDocText").value = "";
  updateReviseAttachUI();
}

// --- Generation ---
async function startGeneration(e) {
  e?.preventDefault();
  if (!requireLogin()) return;

  const topic = $("#genTopic")?.value?.trim();
  if (!topic || topic.length < 3) {
    alert("Topic must be at least 3 characters");
    return;
  }

  state.topic = topic;
  const targetWords = parseInt($("#genWords")?.value, 10) || 6000;
  const citationLimit = parseInt($("#genCites")?.value, 10) || 15;

  saveGenParamsToChat({ ...readGenParamsFromForm(), topic });
  readExportFormatFromForm();
  state.paramsPending = false;
  setParamsReopenBar(false);
  closeModal("paramsDialog");
  addTurn("user", topic, { mode: "generate" });
  setGeneratingLayout(true);
  state.paper = "";
  state.genProgressId = null;
  renderDocPreview();
  updateProgressTurn("Starting generation…", 5, "init");

  const body = {
    topic,
    target_words: targetWords,
    search_limit: Math.max(citationLimit, $("#genDeepQuality")?.checked === true ? 12 : 8),
    citation_limit: citationLimit,
    language: $("#genLanguage")?.value || "zh",
    citation_format: $("#genCitationFormat")?.value || "apa7",
    requirements: state.requirementsText || "",
    fast_mode: $("#genDeepQuality")?.checked !== true,
    web_search: $("#genWebSearch")?.checked !== false,
    de_ai: $("#genDeAi")?.checked === true,
    deep_quality: $("#genDeepQuality")?.checked === true,
    chat_mode: state.chatMode || "default",
    ...(window.JoekuFeatures ? window.JoekuFeatures.localPayload() : {}),
  };

  try {
    const { job_id } = await apiJson("/api/generate/start", { method: "POST", body: JSON.stringify(body) });
    pollGeneration(job_id);
  } catch (err) {
    clearProgressTurn();
    setGeneratingLayout(false);
    addTurn("agent", `Generation failed: ${err.message}`, { mode: "generate" });
  }
}

const POLL_INTERVAL_MS = 800;
const MAX_POLL_ERRORS = 60;
const POLL_REQUEST_TIMEOUT_MS = 90000;

async function fetchJobStatus(jobId) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), POLL_REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`/api/generate/status/${jobId}`, { signal: ctrl.signal });
    const data = await res.json().catch(() => ({}));
    if (res.status === 404) {
      const err = new Error("任务不存在或已过期");
      err.code = "missing";
      throw err;
    }
    if (!res.ok) throw new Error(data.detail || data.message || res.statusText);
    return data;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJobResult(jobId) {
  const res = await fetch(`/api/generate/result/${jobId}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || res.statusText);
  return data;
}

function finishGeneration(st, doc) {
  state.paper = doc || state.paper;
  state.topic = st.result?.topic || state.topic;
  if (state.userId) localStorage.removeItem(userKey("active-job"));
  persistCurrentProject();
  saveProjects();
  renderChatList();
  renderDocPreview();
  clearProgressTurn();
  const wc = st.result?.body_word_count ?? st.result?.word_count;
  addTurn("agent", `Paper generated${wc ? ` (~${wc} body words, references excluded)` : ""}. Preview on the right and export in your chosen format.`, {
    mode: "generate",
    markdown: false,
  });
  setGeneratingLayout(false);
  setDocOpenLayout(true);
  clearPendingReq();
  $("#composerInput").value = "";
  openCoverPageDialog();
}

function openCoverPageDialog() {
  const today = new Date();
  const dateStr = `${today.getFullYear()} 年 ${today.getMonth() + 1} 月`;
  if ($("#coverTitle")) $("#coverTitle").value = state.topic || "";
  if ($("#coverSubtitle")) $("#coverSubtitle").value = state.coverPage?.subtitle || "";
  if ($("#coverAuthor")) $("#coverAuthor").value = state.coverPage?.author || state.displayName || "";
  if ($("#coverInstitution")) $("#coverInstitution").value = state.coverPage?.institution || "";
  if ($("#coverCourse")) $("#coverCourse").value = state.coverPage?.course || "";
  if ($("#coverInstructor")) $("#coverInstructor").value = state.coverPage?.instructor || "";
  if ($("#coverDate")) $("#coverDate").value = state.coverPage?.date || dateStr;
  openModal("coverDialog");
}

function skipCoverPage() {
  closeModal("coverDialog");
}

function submitCoverPage(e) {
  e?.preventDefault();
  state.coverPage = {
    title: $("#coverTitle")?.value?.trim() || state.topic || "论文",
    subtitle: $("#coverSubtitle")?.value?.trim() || "",
    author: $("#coverAuthor")?.value?.trim() || "",
    institution: $("#coverInstitution")?.value?.trim() || "",
    course: $("#coverCourse")?.value?.trim() || "",
    instructor: $("#coverInstructor")?.value?.trim() || "",
    date: $("#coverDate")?.value?.trim() || "",
  };
  state.exportFormat.cover_page = state.coverPage;
  localStorage.setItem(STORAGE.exportFormat, JSON.stringify(state.exportFormat));
  closeModal("coverDialog");
  addTurn("assistant", "Cover page saved — it will be included in Word/PDF exports.", { mode: "generate", markdown: false });
}

function pollGeneration(jobId) {
  if (state.pollTimer) clearInterval(state.pollTimer);
  state.activeJobId = jobId;
  state.pollErrors = 0;
  if (state.userId) localStorage.setItem(userKey("active-job"), jobId);

  const tick = async () => {
    try {
      const st = await fetchJobStatus(jobId);
      state.pollErrors = 0;
      const progExtra = {
        sectionCurrent: st.section_current || "",
        sectionsPlan: st.sections_plan || [],
      };
      if (st.preview) applyGenerationPreview(st.preview, st.step, st.message, st.percent, progExtra);
      else if (st.message) updateProgressTurn(st.message, st.percent || 10, st.step, null, progExtra);
      else if (st.step) updateProgressTurn(null, st.percent || 10, st.step, null, progExtra);

      if (st.status === "done") {
        clearInterval(state.pollTimer);
        state.pollTimer = null;
        state.activeJobId = null;
        let doc = state.paper;
        if (st.result?.has_document) {
          try {
            const full = await fetchJobResult(jobId);
            doc = full.document || doc;
          } catch (e) {
            updateProgressTurn(`获取完整文稿失败，使用预览版本：${e.message}`, 99);
          }
        }
        finishGeneration(st, doc);
        return;
      }
      if (st.status === "error") {
        clearInterval(state.pollTimer);
        state.pollTimer = null;
        state.activeJobId = null;
        if (state.userId) localStorage.removeItem(userKey("active-job"));
        clearProgressTurn();
        setGeneratingLayout(false);
        addTurn("agent", `生成失败：${st.error || "未知错误"}`, { mode: "generate" });
      }
    } catch (err) {
      if (err.code === "missing" && state.paper) {
        clearInterval(state.pollTimer);
        state.pollTimer = null;
        state.activeJobId = null;
        if (state.userId) localStorage.removeItem(userKey("active-job"));
        clearProgressTurn();
        setGeneratingLayout(false);
        addTurn("agent", "服务端任务记录已丢失，但预览文稿已保留。可继续导出或重新生成。", {
          mode: "generate",
          markdown: false,
        });
        setDocOpenLayout(true);
        return;
      }
      state.pollErrors += 1;
      updateProgressTurn(`连接中断，重试中 (${state.pollErrors}/${MAX_POLL_ERRORS})…`, 8);
      if (state.pollErrors >= MAX_POLL_ERRORS) {
        clearInterval(state.pollTimer);
        state.pollTimer = null;
        clearProgressTurn();
        setGeneratingLayout(false);
        addTurn("agent", `轮询失败：${err.message}。任务 ID：${jobId}，刷新页面将自动恢复进度。`, {
          mode: "generate",
        });
      }
    }
  };
  tick();
  state.pollTimer = setInterval(tick, POLL_INTERVAL_MS);
}

async function resumeActiveJob() {
  const jobId = state.userId ? localStorage.getItem(userKey("active-job")) : null;
  if (!jobId || state.isGenerating) return;
  try {
    const st = await fetchJobStatus(jobId);
    if (st.status === "running" || st.status === "pending") {
      setGeneratingLayout(true);
      updateProgressTurn(`恢复生成任务… ${st.message || ""}`, st.percent || 5, st.step);
      pollGeneration(jobId);
    } else if (st.status === "done") {
      if (state.userId) localStorage.removeItem(userKey("active-job"));
      if (st.result?.has_document) {
        try {
          const full = await fetchJobResult(jobId);
          if (full.document) {
            applyGenerationPreview(full.document, st.step || "done", st.message, st.percent);
          }
        } catch (_) {}
      }
    }
  } catch (_) {
    if (state.userId) localStorage.removeItem(userKey("active-job"));
  }
}

function buildChatHistory(latestUserMsg) {
  const history = state.generateMessages
    .filter(
      (m) =>
        (m.role === "user" || m.role === "assistant") &&
        !m.thinking &&
        !m.streaming &&
        !m.progress &&
        !m.thinkOnly &&
        m.content?.trim()
    )
    .slice(-18)
    .map((m) => ({ role: m.role, content: m.content }));
  const last = history[history.length - 1];
  if (!last || last.role !== "user" || last.content !== latestUserMsg) {
    history.push({ role: "user", content: latestUserMsg });
  }
  return history.slice(-20);
}

async function fetchChatReplyFallback(history) {
  const data = await apiJson("/api/chat", {
    method: "POST",
    body: JSON.stringify({
      messages: history,
      paper_context: state.paper || "",
      chat_mode: state.chatMode || "default",
      agent_tool: state.workspaceMode || "chatbot",
      ...(window.JoekuFeatures ? window.JoekuFeatures.localPayload() : {}),
    }),
  });
  return (data.reply || "").trim();
}

// --- Chat (during / after generation) ---
async function submitComposerChat(text, opts = {}) {
  const msg = (text || $("#composerInput")?.value || "").trim();
  if (!msg) return;
  if (window.JoekuFeatures?.syncPaperFromEditor) window.JoekuFeatures.syncPaperFromEditor();
  if (!opts.skipUserTurn && !opts.userTurnAdded) addTurn("user", msg, { mode: "generate" });
  if (!opts.skipUserTurn) {
    $("#composerInput").value = "";
    autoResizeTextarea($("#composerInput"));
  }

  const history = buildChatHistory(msg);
  const chatPayload = {
    messages: history,
    paper_context: state.paper || "",
    chat_mode: state.chatMode || "default",
    agent_tool: state.workspaceMode || "chatbot",
    ...(window.JoekuFeatures ? window.JoekuFeatures.localPayload() : {}),
  };

  ensureCurrentChat();
  const showTrace = shouldShowThinkingTrace(msg, state.workspaceMode, state.chatMode);
  const streamId = addStreamingTurn("generate", showTrace
    ? { withTrace: true, steps: [], label: thinkingLabelForMode(state.chatMode), thinkCollapsed: false }
    : { answerOnly: true });

  let answerAcc = "";

  const TYPE_PHASE = {
    parse: "understand",
    context: "understand",
    mode: "understand",
    process: "understand",
    read: "investigate",
    grep: "investigate",
    tool: "investigate",
    search: "investigate",
    analyze: "investigate",
    plan: "reason",
    write: "respond",
  };

  const NOISE_STEP_TYPES = new Set(["write", "process", "status"]);

  function appendTraceStep(entry, step) {
    if (!step) return;
    const type = step.type === "reasoning" ? "plan" : step.type || "process";
    if (NOISE_STEP_TYPES.has(type) || step.phase === "respond") return;
    const normalized = {
      type,
      label: step.label || "",
      detail: step.detail || "",
      url: step.url || "",
      phase: step.phase || TYPE_PHASE[type] || "understand",
    };
    if (!normalized.label) return;
    const key = `${normalized.label}|${normalized.detail}`;
    const existing = (entry.thinkSteps || []).some(
      (s) => `${s.label}|${s.detail || ""}` === key
    );
    if (existing) return;
    entry.thinkSteps = [...(entry.thinkSteps || []), normalized].slice(-6);
    entry.thinkLiveAction = stepTickerLabel(normalized);
  }

  try {
    if (window.JoekuFeatures?.fetchStream) {
      await window.JoekuFeatures.fetchStream(
        "/api/chat/stream",
        chatPayload,
        (event, tok) => {
          const entry = state.generateMessages.find((m) => m.streamId === streamId);
          if (!entry) return;
          if (event === "think" || event === "reasoning") {
            if (!showTrace) return;
            const wasReasoning = !!entry.thinkReasoning;
            entry.thinkReasoning = true;
            entry.thinking = true;
            if (!wasReasoning) entry.thinkLiveAction = reasoningPhaseLabel(entry);
            patchStreamingBubble(streamId, "generate");
          } else if (event === "think_done") {
            if (!showTrace) return;
            entry.thinkReasoning = false;
            entry.thinkDone = true;
            entry.thinking = false;
            patchStreamingBubble(streamId, "generate");
          } else if (event === "step") {
            let step = null;
            try {
              step = JSON.parse(tok);
            } catch (_) {
              step = { type: "tool", label: tok, detail: "", url: "" };
            }
            if (step?.type !== "write" && step?.phase !== "respond") {
              appendTraceStep(entry, step);
            }
            if (step?.label) entry.thinkLiveAction = stepTickerLabel(step);
            patchStreamingBubble(streamId, "generate");
          } else if (event === "answer") {
            entry.thinkReasoning = false;
            if (entry.thinking) {
              entry.thinking = false;
              entry.thinkCollapsed = true;
              entry.thinkDone = true;
            }
            answerAcc += tok;
            updateStreamingTurn(streamId, answerAcc, "generate");
          }
        },
        { typed: true, trackPhase: true }
      );
      if (!answerAcc.trim()) {
        try {
          answerAcc = await fetchChatReplyFallback(history);
          updateStreamingTurn(streamId, answerAcc, "generate");
        } catch (fallbackErr) {
          console.warn("Chat stream fallback:", fallbackErr);
        }
      }
      finalizeStreamingTurn(
        streamId,
        answerAcc.trim() || "I could not generate a reply. Please try again.",
        "generate",
        { revisionAnnId: opts.revisionAnnId }
      );
    } else {
      const answerStreamId = addStreamingTurn("generate", { answerOnly: true });
      const data = await apiJson("/api/chat", {
        method: "POST",
        body: JSON.stringify({
          messages: history,
          paper_context: state.paper || "",
          chat_mode: state.chatMode || "default",
          ...(window.JoekuFeatures ? window.JoekuFeatures.localPayload() : {}),
        }),
      });
      finalizeStreamingTurn(answerStreamId, data.reply || "I could not generate a reply. Please try again.", "generate");
    }
  } catch (err) {
    const entry = state.generateMessages.find((m) => m.streamId === streamId);
    if (entry) finalizeStreamingTurn(streamId, `Chat failed: ${err.message}`, "generate");
    else addTurn("assistant", `Chat failed: ${err.message}`, { mode: "generate" });
  }
}

function resetPickerMenuStyle(menu) {
  if (!menu) return;
  menu.style.position = "";
  menu.style.top = "";
  menu.style.left = "";
  menu.style.right = "";
  menu.style.bottom = "";
  menu.style.zIndex = "";
  menu.style.minWidth = "";
  menu.style.maxHeight = "";
}

function positionPickerMenu(wrap, menu) {
  if (!wrap || !menu) return;
  const rect = wrap.getBoundingClientRect();
  const gap = 8;
  const mw = Math.max(menu.offsetWidth || 168, rect.width);
  const mh = menu.offsetHeight || 120;
  let top = rect.top - mh - gap;
  let left = rect.right - mw;
  if (top < 12) top = rect.bottom + gap;
  left = Math.max(12, Math.min(left, window.innerWidth - mw - 12));
  const maxH = Math.min(320, top < rect.top ? rect.top - 16 : window.innerHeight - top - 16);
  Object.assign(menu.style, {
    position: "fixed",
    top: `${top}px`,
    left: `${left}px`,
    right: "auto",
    bottom: "auto",
    zIndex: "10050",
    minWidth: `${mw}px`,
    maxHeight: `${Math.max(120, maxH)}px`,
    overflowY: "auto",
  });
}

function setPickerAria(which, open) {
  const map = {
    workspace: "#workspacePickerBtn",
    model: "#modelPickerBtn",
    mode: "#modePickerBtn",
  };
  const btn = $(map[which] || "#modePickerBtn");
  if (btn) btn.setAttribute("aria-expanded", open ? "true" : "false");
}

function closeAllPickers() {
  const prev = state.openPicker;
  state.openPicker = null;
  resetPickerMenuStyle($("#workspacePickerMenu"));
  resetPickerMenuStyle($("#modelPickerMenu"));
  resetPickerMenuStyle($("#modePickerMenu"));
  $("#workspacePickerMenu")?.setAttribute("hidden", "");
  $("#modelPickerMenu")?.setAttribute("hidden", "");
  $("#modePickerMenu")?.setAttribute("hidden", "");
  $("#workspacePicker")?.classList.remove("open");
  $("#modelPicker")?.classList.remove("open");
  $("#modePicker")?.classList.remove("open");
  $("#pickerPortal")?.setAttribute("aria-hidden", "true");
  if (prev) setPickerAria(prev, false);
}

function togglePicker(which, e) {
  e?.preventDefault?.();
  e?.stopPropagation?.();
  const menu =
    which === "workspace" ? $("#workspacePickerMenu") : which === "model" ? $("#modelPickerMenu") : $("#modePickerMenu");
  const wrap =
    which === "workspace" ? $("#workspacePicker") : which === "model" ? $("#modelPicker") : $("#modePicker");
  const btn =
    which === "workspace" ? $("#workspacePickerBtn") : which === "model" ? $("#modelPickerBtn") : $("#modePickerBtn");
  if (!menu || !wrap || !btn) return;

  const wasOpen = state.openPicker === which;
  closeAllPickers();
  if (wasOpen) return;

  state.openPicker = which;
  menu.removeAttribute("hidden");
  wrap.classList.add("open");
  setPickerAria(which, true);
  $("#pickerPortal")?.removeAttribute("aria-hidden");
  requestAnimationFrame(() => {
    positionPickerMenu(btn, menu);
    requestAnimationFrame(() => positionPickerMenu(btn, menu));
  });
}

function repositionOpenPickers() {
  if (!state.openPicker) return;
  const btnMap = {
    workspace: ["#workspacePickerBtn", "#workspacePickerMenu"],
    model: ["#modelPickerBtn", "#modelPickerMenu"],
    mode: ["#modePickerBtn", "#modePickerMenu"],
  };
  const [btnSel, menuSel] = btnMap[state.openPicker] || btnMap.mode;
  positionPickerMenu($(btnSel), $(menuSel));
}

function bindComposerPickers() {
  $("#workspacePickerBtn")?.addEventListener("click", (e) => togglePicker("workspace", e));
  $("#modelPickerBtn")?.addEventListener("click", (e) => togglePicker("model", e));
  $("#modePickerBtn")?.addEventListener("click", (e) => togglePicker("mode", e));
  $("#workspacePickerMenu")?.addEventListener("click", (e) => e.stopPropagation());
  $("#modelPickerMenu")?.addEventListener("click", (e) => e.stopPropagation());
  $("#modePickerMenu")?.addEventListener("click", (e) => e.stopPropagation());
}

function applyWorkspaceMode(mode) {
  if (!WORKSPACE_MODES.some((m) => m.id === mode)) return;
  state.workspaceMode = mode;
  localStorage.setItem("joeku-workspace-mode", mode === "docgen" ? "chatbot" : mode);
  renderComposerPickers();
  const input = $("#composerInput");
  if (input) input.placeholder = composerPlaceholder();
}

async function requestWorkspaceMode(mode) {
  if (!WORKSPACE_MODES.some((m) => m.id === mode)) return;
  if (mode === state.workspaceMode) return;

  if (mode === "docgen") {
    const ok = confirm(
      "Switch to Generate mode?\n\nYour chat history will be preserved. Open the parameters panel now?"
    );
    if (!ok) return;
    applyWorkspaceMode("docgen");
    const hasChat = chatMessagesForTopic().length > 0;
    if (hasChat || state.requirementsName) {
      openParamsDialog();
    } else {
      state.paramsPending = true;
      setParamsReopenBar(true);
      const barText = $("#paramsReopenBar")?.querySelector(".params-reopen-text");
      if (barText) {
        barText.textContent = "Generate mode — discuss your paper topic in chat, then reopen parameters";
      }
    }
    return;
  }

  if (state.workspaceMode === "docgen") {
    state.paramsPending = false;
    setParamsReopenBar(false);
    closeModal("paramsDialog");
  }
  applyWorkspaceMode(mode);
}

function initSidebarCollapseState() {
  const visited = localStorage.getItem("joeku-sidebar-visited");
  if (!visited) {
    state.sidebarPanelCollapsed = false;
    localStorage.setItem("joeku-sidebar-visited", "1");
  } else {
    state.sidebarPanelCollapsed = localStorage.getItem("joeku-sidebar-collapsed") !== "0";
  }
  $("#appShell")?.classList.toggle("sidebar-panel-collapsed", state.sidebarPanelCollapsed);
}

function expandSidebarPanel() {
  const narrow = window.matchMedia("(max-width: 900px)").matches;
  if (narrow) {
    openSidebarDrawer();
    return;
  }
  state.sidebarPanelCollapsed = false;
  $("#appShell")?.classList.remove("sidebar-panel-collapsed");
  localStorage.setItem("joeku-sidebar-collapsed", "0");
}

function toggleSidebarPanel() {
  const narrow = window.matchMedia("(max-width: 900px)").matches;
  if (narrow) {
    if ($("#appShell")?.classList.contains("sidebar-drawer-open")) closeSidebarDrawer();
    else openSidebarDrawer();
    return;
  }
  state.sidebarPanelCollapsed = !state.sidebarPanelCollapsed;
  $("#appShell")?.classList.toggle("sidebar-panel-collapsed", state.sidebarPanelCollapsed);
  localStorage.setItem("joeku-sidebar-collapsed", state.sidebarPanelCollapsed ? "1" : "0");
}

function renderComposerPickers() {
  const workspaceMenu = $("#workspacePickerMenu");
  const workspaceValue = $("#workspacePickerValue");
  const modelMenu = $("#modelPickerMenu");
  const modeMenu = $("#modePickerMenu");
  const modelValue = $("#modelPickerValue");
  const modeValue = $("#modePickerValue");
  const sel = $("#composerModel");
  const currentModel = state.config.model || "deepseek-chat";

  if (sel) {
    sel.innerHTML = MODEL_OPTIONS.map((m) => `<option value="${m.value}">${m.label}</option>`).join("");
    selectModelValue(sel, currentModel);
  }

  if (modelMenu) {
    modelMenu.innerHTML = MODEL_OPTIONS.map(
      (m) =>
        `<button type="button" class="glass-picker-item${m.value === currentModel ? " active" : ""}" data-model="${m.value}">${esc(m.label)}</button>`
    ).join("");
    modelMenu.querySelectorAll("[data-model]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const next = btn.dataset.model;
        if (sel) sel.value = next;
        if (modelValue) modelValue.textContent = btn.textContent;
        closeAllPickers();
        onComposerModelChange();
        renderComposerPickers();
      });
    });
  }
  if (modelValue) {
    modelValue.textContent = MODEL_OPTIONS.find((m) => m.value === currentModel)?.label || currentModel;
  }

  const activeWorkspace = WORKSPACE_MODES.find((m) => m.id === state.workspaceMode) || WORKSPACE_MODES[0];
  if (workspaceValue) workspaceValue.textContent = activeWorkspace.label;
  if (workspaceMenu) {
    workspaceMenu.innerHTML = WORKSPACE_MODES.map(
      (m) =>
        `<button type="button" class="glass-picker-item${state.workspaceMode === m.id ? " active" : ""}" data-workspace="${m.id}" title="${esc(m.hint)}">${esc(m.label)}</button>`
    ).join("");
    workspaceMenu.querySelectorAll("[data-workspace]").forEach((btn) => {
      btn.addEventListener("click", () => {
        requestWorkspaceMode(btn.dataset.workspace);
        closeAllPickers();
      });
    });
  }

  const activeMode = CHAT_MODES.find((m) => m.id === state.chatMode) || CHAT_MODES[0];
  if (modeValue) modeValue.textContent = activeMode.label;

  if (modeMenu) {
    modeMenu.innerHTML = CHAT_MODES.map(
      (m) =>
        `<button type="button" class="glass-picker-item${state.chatMode === m.id ? " active" : ""}" data-mode="${m.id}" title="${esc(m.hint)}">${esc(m.label)}</button>`
    ).join("");
    modeMenu.querySelectorAll("[data-mode]").forEach((btn) => {
      btn.addEventListener("click", () => {
        setChatMode(btn.dataset.mode);
        closeAllPickers();
      });
    });
  }
}

function fillComposerModelSelect() {
  renderComposerPickers();
}

function onComposerModelChange() {
  const sel = $("#composerModel");
  const next = sel?.value?.trim();
  if (!next || next === state.config.model) {
    $("#composerApiReauth")?.setAttribute("hidden", "");
    return;
  }
  state.pendingModel = next;
  state.config.api_key = "";
  $("#composerApiReauth")?.removeAttribute("hidden");
  $("#composerApiKey")?.focus();
}

async function confirmComposerApiKey() {
  const key = $("#composerApiKey")?.value?.trim();
  if (!key) {
    alert("请输入 API Key");
    return;
  }
  const model = state.pendingModel || $("#composerModel")?.value || state.config.model;
  state.config.api_key = key;
  state.config.model = model;
  state.pendingModel = null;
  saveConfig();
  updateSidebarStatus();
  fillComposerModelSelect();
  $("#composerApiReauth")?.setAttribute("hidden", "");
  $("#composerApiKey").value = "";
  const ok = await testConnection(false);
  if (!ok) {
    state.config.api_key = "";
    $("#composerApiReauth")?.removeAttribute("hidden");
  }
}

function setChatMode(mode) {
  if (!CHAT_MODES.some((m) => m.id === mode)) return;
  state.chatMode = mode;
  localStorage.setItem("joeku-chat-mode", mode);
  renderComposerPickers();
}

function collectRecentTopics() {
  const topics = [];
  (state.projects || []).forEach((p) => {
    if (p.topic) topics.push(p.topic);
    (p.chats || []).forEach((c) => {
      if (c.topic) topics.push(c.topic);
      const first = (c.generateMessages || []).find((m) => m.role === "user" && m.content?.trim());
      if (first?.content) topics.push(first.content.slice(0, 80));
    });
  });
  return [...new Set(topics)].slice(0, 8);
}

async function refreshSuggestions() {
  if (!state.loggedIn || !state.config.api_key) return;
  const chipsEl = $("#promptChips");
  const heroSub = $("#heroGreeting");
  if (!chipsEl) return;
  chipsEl.innerHTML = '<span class="chip-loading">Preparing suggestions…</span>';
  try {
    const data = await apiJson("/api/suggestions", {
      method: "POST",
      body: JSON.stringify({
        recent_topics: collectRecentTopics(),
        persona_hint: state.personaHint || "",
      }),
    });
    if (heroSub && data.greeting) heroSub.textContent = data.greeting;
    const list = data.chips || [];
    chipsEl.innerHTML = list
      .map(
        (c) =>
          `<button type="button" class="prompt-chip" data-prompt="${esc(c.prompt)}" onclick="Joeku.chip(this)">${esc(c.label || c.prompt)}</button>`
      )
      .join("");
  } catch (_) {
    chipsEl.innerHTML = `
      <button type="button" class="prompt-chip" data-prompt="Outline a literature review on transformer efficiency — cite only sources from my library" onclick="Joeku.chip(this)">Library-grounded review</button>
      <button type="button" class="prompt-chip" data-prompt="Draft an IMRaD structure for a paper on AI in higher education, with section goals" onclick="Joeku.chip(this)">IMRaD outline</button>
      <button type="button" class="prompt-chip" data-prompt="Check my draft for unsupported claims and suggest where citations are needed" onclick="Joeku.chip(this)">Citation gaps</button>`;
  }
}

// --- Revise ---
async function submitRevise(e) {
  e.preventDefault();
  if (!requireLogin()) return;
  const feedback = $("#reviseInput")?.value?.trim();
  const paper = state.reviseDocText || state.paper;
  if (!feedback) return;

  addTurn("user", feedback, { mode: "revise" });
  $("#reviseInput").value = "";

  if (paper && paper.length >= 50) {
    const streamId = addStreamingTurn("revise", {
      label: "Revision",
      answerOnly: true,
    });
    let acc = "";
    try {
      if (window.JoekuFeatures?.fetchStream) {
        await window.JoekuFeatures.fetchStream(
          "/api/improve-paper/stream",
          { paper, feedback },
          (tok) => {
            acc += tok;
            updateStreamingTurn(streamId, acc, "revise");
          }
        );
        finalizeStreamingTurn(streamId, acc || "(No content)", "revise");
      } else {
        const data = await apiJson("/api/improve-paper", {
          method: "POST",
          body: JSON.stringify({ paper, feedback }),
        });
        finalizeStreamingTurn(streamId, data.document || "(No content)", "revise");
      }
    } catch (err) {
      finalizeStreamingTurn(streamId, `Request failed: ${err.message}`, "revise");
    }
  } else {
    const streamId = addStreamingTurn("revise", { label: "Analysis", answerOnly: true });
    let acc = "";
    try {
      const data = await apiJson("/api/analyze", { method: "POST", body: JSON.stringify({ text: feedback }) });
      const text = typeof data.analysis === "string" ? data.analysis : JSON.stringify(data.analysis, null, 2);
      finalizeStreamingTurn(streamId, text, "revise");
    } catch (err) {
      finalizeStreamingTurn(streamId, `Analysis failed: ${err.message}`, "revise");
    }
  }
}

// --- Upload ---
async function uploadFile(file, kind) {
  const fd = new FormData();
  fd.append("file", file);
  const res = await fetch("/api/upload", { method: "POST", body: fd });
  const data = await readApiResponse(res);
  if (kind === "req") {
    state.requirementsText = data.text;
    state.requirementsName = data.filename || file.name;
    updateReqAttachUI();
    addTurn("assistant", `已上传要求文档「${state.requirementsName}」。准备好写作时告诉我主题即可。`, {
      mode: "generate",
    });
  } else {
    state.reviseDocText = data.text;
    state.reviseDocName = data.filename || file.name;
    $("#reviseDocText").value = data.text;
    updateReviseAttachUI();
    addTurn("system", `已加载文档「${state.reviseDocName}」`, { mode: "revise", markdown: false });
  }
}

// --- Folder / docx ---
async function pickFolder() {
  try {
    const data = await apiJson("/api/pick-folder");
    state.saveFolder = data.path;
    saveProjects();
    $("#saveFolder").value = state.saveFolder;
  } catch (e) {
    alert(e.message);
  }
}

async function pickExportFolder() {
  if (!requireLogin()) return;
  try {
    const data = await apiJson("/api/pick-folder");
    state.saveFolder = data.path;
    saveProjects();
    $("#saveFolder").value = state.saveFolder;
    alert(`导出目录已设为：\n${state.saveFolder}`);
  } catch (e) {
    alert(e.message);
  }
}

async function ensureExportFolder() {
  if (state.saveFolder) return state.saveFolder;
  if (!confirm("尚未设置导出目录。是否现在选择保存路径？")) return "";
  await pickExportFolder();
  return state.saveFolder;
}

function safeFilename(topic) {
  const slug = (topic || "paper").replace(/[<>:"/\\|?*]/g, "-").slice(0, 60);
  return `${slug || "paper"}.docx`;
}

async function downloadBlob(path, body, fallbackName) {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.detail || res.statusText);
  }
  const blob = await res.blob();
  const cd = res.headers.get("Content-Disposition") || "";
  const match = cd.match(/filename="?([^"]+)"?/);
  const name = match?.[1] || fallbackName;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

function exportPayload(extra = {}) {
  return {
    document: state.paper,
    topic: state.topic || "论文",
    format_options: state.exportFormat,
    ...extra,
  };
}

async function exportDocx() {
  if (!state.paper) return;
  readExportFormatFromForm();
  const filename = safeFilename(state.topic);
  if (!state.saveFolder) {
    const folder = await ensureExportFolder();
    if (!folder) return;
  }
  if (state.saveFolder) {
    try {
      const data = await fetch("/api/save-docx", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(exportPayload({ output_dir: state.saveFolder, filename })),
      });
      const rd = await readApiResponse(data);
      state.lastSavedPath = rd.path;
      persistCurrentProject();
      saveProjects();
      alert(`已按自定义格式保存 Word：${rd.filename}\n${rd.path}`);
      return;
    } catch (e) {
      alert(`本地保存失败：${e.message}，将改为下载。`);
    }
  }
  try {
    await downloadBlob("/api/export/docx", exportPayload({ filename }), filename);
  } catch (e) {
    try {
      const { downloadDocx } = await import("./docx-client.js");
      await downloadDocx(state.paper, state.topic, filename);
    } catch (e2) {
      alert(`导出失败：${e2.message}`);
    }
  }
}

async function exportPdf() {
  if (!state.paper) return;
  readExportFormatFromForm();
  const name = safeFilename(state.topic).replace(/\.docx$/i, ".pdf");
  if (!state.saveFolder) {
    const folder = await ensureExportFolder();
    if (!folder) return;
  }
  if (state.saveFolder) {
    try {
      const data = await fetch("/api/save-pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(exportPayload({ output_dir: state.saveFolder, filename: name })),
      });
      const rd = await readApiResponse(data);
      alert(`已按自定义格式保存 PDF：${rd.filename}\n${rd.path}`);
      return;
    } catch (e) {
      alert(`本地保存失败：${e.message}，将改为下载。`);
    }
  }
  await downloadBlob("/api/export/pdf", exportPayload({ filename: name }), name);
}

// --- Defaults (language / citation) ---
async function loadDefaults() {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch("/api/config/defaults", { signal: ctrl.signal });
    clearTimeout(timer);
    state.defaults = await res.json();
    const lang = $("#genLanguage");
    const cite = $("#genCitationFormat");
    if (lang && state.defaults.languages) {
      lang.innerHTML = state.defaults.languages.map((l) => `<option value="${l.code}">${l.label}</option>`).join("");
    }
    if (cite && state.defaults.citation_formats) {
      cite.innerHTML = state.defaults.citation_formats.map((c) => `<option value="${c.code}">${c.label}</option>`).join("");
    }
    const ff = $("#genFontFamily");
    const fs = $("#genFontSize");
    const ls = $("#genLineSpacing");
    if (ff && state.defaults.font_families) {
      ff.innerHTML = state.defaults.font_families.map((f) => `<option value="${f.code}">${f.label}</option>`).join("");
    }
    if (fs && state.defaults.font_sizes) {
      fs.innerHTML = state.defaults.font_sizes.map((s) => `<option value="${s}">${s} pt</option>`).join("");
    }
    if (ls && state.defaults.line_spacings) {
      ls.innerHTML = state.defaults.line_spacings
        .map((l) => `<option value="${l.value}">${l.label}</option>`)
        .join("");
    }
    const ind = $("#genFirstLineIndent");
    if (ind && state.defaults.first_line_indents) {
      ind.innerHTML = state.defaults.first_line_indents
        .map((i) => `<option value="${i.value}">${i.label}</option>`)
        .join("");
    }
    applyExportFormatToForm();
    if (!state.config.base_url && state.defaults.base_url) state.config.base_url = state.defaults.base_url;
    if (!state.config.model && state.defaults.model) state.config.model = state.defaults.model;
  } catch (_) {}
}

// --- Perm ---
function updatePermUI() {
  const btn = $("#settingsPermBtn");
  if (state.permGranted) btn?.classList.add("granted");
}

function shouldComposerChat() {
  return state.isGenerating || !!state.paper;
}

function looksLikePaperWriteRequest(text) {
  const t = String(text || "").trim();
  if (t.length < 6) return false;
  return (
    /写(一|个|篇|份|出)?|撰写|生成|创作|起草|帮我写|帮忙写|论文|综述|开题|文献综述/i.test(t) ||
    /\b(write|draft|compose|generate)\b.{0,24}\b(paper|essay|thesis|article|review)\b/i.test(t)
  );
}

async function detectComposeIntent(message) {
  try {
    return await apiJson("/api/intent", {
      method: "POST",
      body: JSON.stringify({
        message,
        paper_context: state.paper || "",
        chat_mode: state.chatMode || "default",
        persona_hint: state.personaHint || "",
      }),
    });
  } catch (_) {
    return { intent: "chat", topic: "", reply: "" };
  }
}

function acceptGenerateOffer(topic) {
  const t = String(topic || "").trim();
  if (!t) return;
  state.topic = t;
  const topicInput = $("#genTopic");
  if (topicInput) topicInput.value = t;
  applyWorkspaceMode("docgen");
  openParamsDialog();
}

async function offerGenerateMode(userMsg, intent) {
  const topic = (intent.topic || userMsg || "").trim().slice(0, 120);
  const reply =
    intent.reply?.trim() ||
    `看起来你想开始创作「${topic}」。建议切换到 **Generate 模式**：我会检索文献、规划章节，并逐步撰写全文。`;
  addTurn("assistant", reply, {
    mode: "generate",
    writeOffer: { topic },
    markdown: true,
  });
}

function appendGenStepLog(entry, step, message, percent) {
  const label = (message || GEN_STEP_LABELS[step] || step || "").trim();
  if (!label) return;
  const key = `${step || ""}|${label}`;
  const log = entry.genStepLog || [];
  const prev = log[log.length - 1];
  if (prev && `${prev.step}|${prev.label}` === key) {
    prev.percent = typeof percent === "number" ? percent : prev.percent;
    prev.active = true;
    log.slice(0, -1).forEach((s) => {
      s.active = false;
    });
    entry.genStepLog = log;
    return;
  }
  log.forEach((s) => {
    s.active = false;
    s.done = true;
  });
  log.push({
    step: step || "",
    label,
    percent: typeof percent === "number" ? percent : null,
    active: true,
    done: false,
    ts: Date.now(),
  });
  entry.genStepLog = log.slice(-16);
}

async function handleComposerSubmit(e, opts = {}) {
  if (e) e.preventDefault();
  if (!requireLogin()) return false;
  const text = $("#composerInput")?.value?.trim();
  if (!text && !state.requirementsText) return false;

  if (shouldComposerChat() || isChatAgentMode()) {
    if (!text) return false;
    if (
      state.workspaceMode === "chatbot" &&
      !state.isGenerating &&
      !opts.skipIntentCheck &&
      looksLikePaperWriteRequest(text)
    ) {
      addTurn("user", text, { mode: "generate" });
      $("#composerInput").value = "";
      autoResizeTextarea($("#composerInput"));
      const intent = await detectComposeIntent(text);
      if (intent.intent === "write") {
        if (!intent.topic?.trim()) intent.topic = text.trim().slice(0, 100);
        await offerGenerateMode(text, intent);
        return false;
      }
    }
    await submitComposerChat(text, opts);
    return false;
  }

  if (!text) return false;
  if (!opts.explicit) return false;

  $("#composerInput").value = "";
  autoResizeTextarea($("#composerInput"));
  addTurn("user", text, { mode: "generate" });

  state.topic = text;
  $("#genTopic").value = text;
  openParamsDialog();
  return false;
}

function bindUiApi() {
  window.Joeku = {
    ready: true,
    composerSubmit: (e) => handleComposerSubmit(e, { explicit: true }),
    composerSend: () => handleComposerSubmit(null, { explicit: true }),
    reviseSend: () => {},
    rail(mode) {
      setMode(mode === "settings" ? "settings" : "generate");
      if (mode === "generate") expandSidebarPanel();
      else if (mode !== "settings") closeSidebarDrawer();
    },
    newChat: () => createChat(),
    newProject: () => openNewProjectDialog(),
    closeNewProject: () => closeModal("newProjectDialog"),
    openLogin: () => openLoginGate(),
    login: () => testConnection(true),
    logout: () => logout(),
    applyModel: () => applyModel(),
    pickExportFolder: () => pickExportFolder(),
    chip(el) {
      const input = $("#composerInput");
      if (!input || !el) return;
      input.value = el.dataset.prompt || "";
      input.dispatchEvent(new Event("input"));
      input.focus();
    },
    switchToGenerate: (topic) => acceptGenerateOffer(topic),
    attachReq: (e) => {
      if (e?.altKey && state.requirementsName) {
        clearPendingReq();
        return;
      }
      $("#reqFileInput")?.click();
    },
    clearReq: () => clearPendingReq(),
    toggleDoc: () => toggleDocPanel(),
    expandDoc: () => setDocCollapsed(false),
    exportDocx: () => exportDocx(),
    exportPdf: () => exportPdf().catch((err) => alert(err.message)),
    attachRevise: (e) => {
      if (e?.altKey && state.reviseDocName) {
        clearReviseAttach();
        return;
      }
      $("#reviseFileInput")?.click();
    },
    clearRevise: () => clearReviseAttach(),
    testSettings: () => testConnection(false),
    perm: () => {
      if (!state.permGranted) openModal("permDialog");
    },
    permGrant: () => {
      state.permGranted = true;
      localStorage.setItem(STORAGE.perm, "1");
      updatePermUI();
      closeModal("permDialog");
    },
    permDeny: () => closeModal("permDialog"),
    pickFolder: () => pickFolder(),
    dismissParams: () => dismissParamsDialog(),
    reopenParams: () => reopenParamsDialog(),
    exitParamsMode: () => exitParamsMode(),
    togglePicker: (which, e) => togglePicker(which, e),
    skipCoverPage: () => skipCoverPage(),
    editCoverPage: () => openCoverPageDialog(),
    pickDataRoot: async () => {
      try {
        setLoginStatus("正在打开文件夹选择器…");
        const folder = await window.JoekuFeatures?.pickDataRoot();
        if (folder) setLoginStatus(`已选择：${folder}`, "ok");
        else setLoginStatus("未选择文件夹（可直接输入路径后登录）", "err");
      } catch (e) {
        setLoginStatus(`选择文件夹失败：${e.message}（可直接输入路径）`, "err");
      }
    },
    setDocView: (mode) => window.JoekuFeatures?.setDocView(mode),
    submitAnnotation: () => window.JoekuFeatures?.submitAnnotation(),
    toggleAnnotationsPanel: () => window.JoekuFeatures?.toggleAnnotationsPanel(),
    onIdentityChange: () => window.JoekuFeatures?.onIdentityChange(),
    setLoginMode: (mode) => window.JoekuFeatures?.setLoginMode(mode),
    setChatMode: (mode) => setChatMode(mode),
    setWorkspaceMode: (mode) => requestWorkspaceMode(mode),
    setSettingsTab: (tab) => setSettingsTab(tab),
    toggleSidebarPanel: () => toggleSidebarPanel(),
    closeSidebarDrawer: () => closeSidebarDrawer(),
    onComposerModelChange: () => onComposerModelChange(),
    confirmComposerApiKey: () => confirmComposerApiKey(),
    refreshSuggestions: () => refreshSuggestions(),
    deleteProject: (id) => {
      const p = state.projects.find((x) => x.id === id);
      if (p && confirm(`删除项目「${p.name}」及其对话记录？`)) deleteProject(id);
    },
    deleteChat: (chatId) => {
      const p = currentProject();
      const c = (p.chats || []).find((x) => x.id === chatId);
      const title = c?.title || "New chat";
      if (confirm(`Delete chat "${title}"?`)) deleteChat(chatId);
    },
  };
}

function bindEvents() {
  document.querySelectorAll("[data-close-modal]").forEach((btn) => {
    btn.addEventListener("click", () => closeModal(btn.dataset.closeModal));
  });

  $("#settingsForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    state.displayName = $("#displayNameInput")?.value?.trim() || state.displayName;
    state.config.tavily_key = $("#tavilyKeyInput")?.value?.trim() || "";
    saveConfig();
    await testConnection(false);
  });

  $("#composerForm")?.addEventListener("submit", (e) => {
    e.preventDefault();
    return false;
  });

  $("#composerSendBtn")?.addEventListener("click", () => handleComposerSubmit(null, { explicit: true }));


  $("#reqFileInput")?.addEventListener("change", async (e) => {
    const f = e.target.files?.[0];
    if (f) await uploadFile(f, "req");
    e.target.value = "";
  });

  $("#paramsForm")?.addEventListener("submit", startGeneration);
  $("#coverForm")?.addEventListener("submit", submitCoverPage);
  $("#newProjectForm")?.addEventListener("submit", submitNewProject);

  bindComposerPickers();

  const gearBtn = $("#settingsRailBtn");
  if (gearBtn) {
    const pulseGear = () => {
      gearBtn.classList.remove("gear-tap");
      void gearBtn.offsetWidth;
      gearBtn.classList.add("gear-tap");
    };
    gearBtn.addEventListener("pointerdown", pulseGear);
    gearBtn.addEventListener("click", pulseGear);
  }

  document.addEventListener("click", (e) => {
    if (!state.openPicker) return;
    if (
      e.target.closest("#workspacePickerBtn") ||
      e.target.closest("#modelPickerBtn") ||
      e.target.closest("#modePickerBtn") ||
      e.target.closest("#workspacePickerMenu") ||
      e.target.closest("#modelPickerMenu") ||
      e.target.closest("#modePickerMenu")
    ) {
      return;
    }
    closeAllPickers();
  });
  window.addEventListener("resize", () => {
    repositionOpenPickers();
    if (!window.matchMedia("(max-width: 900px)").matches) closeSidebarDrawer();
  });
  window.addEventListener("scroll", repositionOpenPickers, true);



  $("#sidebarToggle")?.addEventListener("click", () => $("#sidebar")?.classList.toggle("open"));

  bindTextareaAutoResize();

  $("#docEditor")?.addEventListener("input", () => {
    state.paper = $("#docEditor").value;
    persistCurrentProject();
    saveProjects();
    updateExportButtons();
  });
}

function autoResizeTextarea(ta) {
  if (!ta) return;
  ta.style.height = "auto";
  const max = 240;
  ta.style.height = `${Math.min(ta.scrollHeight, max)}px`;
}

function bindComposerKeys(ta, onSend) {
  if (!ta) return;
  let composing = false;
  ta.addEventListener("compositionstart", () => {
    composing = true;
  });
  ta.addEventListener("compositionend", () => {
    composing = false;
  });
  ta.addEventListener("keydown", (e) => {
    if (composing) return;
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      onSend();
    }
  });
  ta.addEventListener("input", () => autoResizeTextarea(ta));
  autoResizeTextarea(ta);
}

function bindTextareaAutoResize() {
  bindComposerKeys($("#composerInput"), () => handleComposerSubmit(null, { explicit: true }));

}

function closeAllDialogs() {
  document.querySelectorAll(".modal-layer").forEach((el) => {
    el.hidden = true;
  });
  closeLoginGate();
  unlockPage();
}

async function init() {
  initDesktopTitlebar();   // must be early so layout adjusts for titlebar
  unlockPage();
  bindEvents();
  bindUiApi();

  try {
    loadStorage();
  } catch (err) {
    showFatal("Storage load failed: " + err.message);
  }
  state.chatMode = localStorage.getItem("joeku-chat-mode") || "default";
  if (!CHAT_MODES.some((m) => m.id === state.chatMode)) state.chatMode = "default";
  const savedWorkspace = localStorage.getItem("joeku-workspace-mode") || "chatbot";
  state.workspaceMode = savedWorkspace === "docgen" ? "chatbot" : savedWorkspace;
  if (!WORKSPACE_MODES.some((m) => m.id === state.workspaceMode)) state.workspaceMode = "chatbot";
  state.paramsPending = false;
  setParamsReopenBar(false);
  initSidebarCollapseState();
  renderComposerPickers();
  state.loggedIn = false;
  state.config.api_key = "";

  updateSidebarStatus();
  updatePermUI();
  renderProjectList();
  renderChatList();
  renderThread("generate");
  renderThread("revise");
  renderDocPreview();
  setDocOpenLayout(!!state.paper);
  if (localStorage.getItem(STORAGE.docCollapsed) === "1") setDocCollapsed(true);
  updateDocPanelChrome();
  if (state.saveFolder) $("#saveFolder").value = state.saveFolder;
  setMode("generate");

  if (window.JoekuFeatures) {
    window.JoekuFeatures.initExtendedState();
    window.JoekuFeatures.bindLibraryDropzone();
    window.JoekuFeatures.bindLoginDataRootInput();
  }
  window.__JOEKU_STATE = state;
  window.__JOEKU_persistCurrentProject = persistCurrentProject;
  window.__JOEKU_saveProjects = saveProjects;
  window.__JOEKU_renderDocPreview = renderDocPreview;
  window.__JOEKU_renderMarkdown = renderMarkdown;
  window.__JOEKU_addTurn = addTurn;
  window.__JOEKU_addThinkingTurn = addThinkingTurn;
  window.__JOEKU_finishThinkingTurn = finishThinkingTurn;
  window.__JOEKU_addStreamingTurn = addStreamingTurn;
  window.__JOEKU_updateStreamingTurn = updateStreamingTurn;
  window.__JOEKU_finalizeStreamingTurn = finalizeStreamingTurn;
  window.__JOEKU_submitComposerChat = submitComposerChat;
  window.__JOEKU_expandChatPanel = expandSidebarPanel;
  window.__JOEKU_setDocOpenLayout = setDocOpenLayout;
  window.__JOEKU_expandDoc = () => setDocCollapsed(false);

  try {
    await loadDefaults();
    await resumeActiveJob();
  } catch (err) {
    console.warn("Background init:", err);
  }

  openLoginGate();

  window.__JOEKU_READY = true;
  console.info("[Joeku] v20260831 ready");
}

function initDesktopTitlebar() {
  const bar = document.getElementById("appTitlebar");
  if (!bar) return;

  const hasPywebview = !!(window.pywebview && (window.pywebview.window || window.pywebview.api));

  if (hasPywebview) {
    document.body.classList.add("desktop-mode");
    bar.hidden = false;

    // Make desktop feel less like "a webpage"
    document.addEventListener("contextmenu", (e) => {
      const tag = (e.target.tagName || "").toUpperCase();
      if (tag !== "INPUT" && tag !== "TEXTAREA" && tag !== "SELECT") {
        e.preventDefault();
      }
    });

    bar.addEventListener("click", (e) => {
      const btn = e.target.closest(".titlebar-btn");
      if (!btn) return;

      const action = btn.dataset.action;
      const pv = window.pywebview;

      try {
        if (action === "minimize") {
          if (pv.api && pv.api.minimize) pv.api.minimize();
          else if (pv.window && pv.window.minimize) pv.window.minimize();
        } else if (action === "maximize") {
          if (pv.api && pv.api.toggle_maximize) {
            pv.api.toggle_maximize();
          } else if (pv.window) {
            if (pv.window.maximized) {
              pv.window.restore && pv.window.restore();
            } else {
              pv.window.maximize && pv.window.maximize();
            }
          }
        } else if (action === "close") {
          if (pv.api && pv.api.close) pv.api.close();
          else if (pv.window && pv.window.destroy) pv.window.destroy();
          else window.close();
        }
      } catch (err) {
        console.warn("Window control failed", err);
      }
    });

    // Double-click drag area to toggle maximize
    const dragRegion = bar.querySelector(".titlebar-drag-region");
    if (dragRegion) {
      // Explicit drag support (more reliable than CSS region in pywebview)
      if (window.pywebview?.window?.drag) {
        dragRegion.addEventListener("mousedown", (ev) => {
          // Only start drag on primary button
          if (ev.button === 0) {
            window.pywebview.window.drag();
          }
        });
      }

      dragRegion.addEventListener("dblclick", () => {
        const w = window.pywebview && window.pywebview.window;
        if (!w) return;
        if (w.maximized) {
          w.restore && w.restore();
        } else {
          w.maximize && w.maximize();
        }
      });
    }
  } else {
    bar.hidden = true;
  }
}

try {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => init().catch((e) => showFatal(e.message)));
  } else {
    init().catch((e) => showFatal(e.message));
  }
} catch (err) {
  showFatal(err.message);
}