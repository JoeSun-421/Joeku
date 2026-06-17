/* Joeku — projects · modal params · split doc stream (no ES module — avoids load failures) */

function renderMarkdown(md) {
  if (!md) return "";
  const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const inline = (text) =>
    text
      .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/\*(.+?)\*/g, "<em>$1</em>")
      .replace(/`([^`]+)`/g, "<code>$1</code>");
  const lines = md.split(/\r?\n/);
  const out = [];
  let inP = false;
  const closeP = () => {
    if (inP) {
      out.push("</p>");
      inP = false;
    }
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      closeP();
      continue;
    }
    if (line.startsWith("# ")) {
      closeP();
      out.push(`<h1>${inline(esc(line.slice(2)))}</h1>`);
      continue;
    }
    if (line.startsWith("## ")) {
      closeP();
      out.push(`<h2>${inline(esc(line.slice(3)))}</h2>`);
      continue;
    }
    if (line.startsWith("### ")) {
      closeP();
      out.push(`<h3>${inline(esc(line.slice(4)))}</h3>`);
      continue;
    }
    if (line.startsWith("- ") || line.startsWith("* ")) {
      closeP();
      out.push(`<li>${inline(esc(line.slice(2)))}</li>`);
      continue;
    }
    if (!inP) {
      out.push("<p>");
      inP = true;
    } else {
      out.push("<br/>");
    }
    out.push(inline(esc(line)));
  }
  closeP();
  return out.join("");
}

const STORAGE = {
  config: "joeku-llm-config",
  folder: "joeku-save-folder",
  perm: "joeku-local-perm",
  projects: "joeku-projects",
  currentProject: "joeku-current-project",
  tavily: "joeku-tavily-key",
  exportFormat: "joeku-export-format",
  activeJob: "joeku-active-job",
  docCollapsed: "joeku-doc-collapsed",
};

const state = {
  mode: "generate",
  loggedIn: false,
  config: { api_key: "", base_url: "https://api.deepseek.com/v1", model: "deepseek-chat", tavily_key: "" },
  pollErrors: 0,
  activeJobId: null,
  saveFolder: "",
  permGranted: false,
  projects: [],
  currentProjectId: null,
  generateMessages: [],
  reviseMessages: [],
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
  },
};

const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);

function uid() {
  return "p_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
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
function loadStorage() {
  try {
    const cfg = localStorage.getItem(STORAGE.config);
    if (cfg) state.config = { ...state.config, ...JSON.parse(cfg) };
  } catch (_) {}
  state.saveFolder = localStorage.getItem(STORAGE.folder) || "";
  state.permGranted = localStorage.getItem(STORAGE.perm) === "1";
  state.config.tavily_key = localStorage.getItem(STORAGE.tavily) || state.config.tavily_key || "";
  try {
    const fmt = localStorage.getItem(STORAGE.exportFormat);
    if (fmt) state.exportFormat = { ...state.exportFormat, ...JSON.parse(fmt) };
  } catch (_) {}
  try {
    state.projects = JSON.parse(localStorage.getItem(STORAGE.projects) || "[]");
  } catch (_) {
    state.projects = [];
  }
  if (!state.projects.length) {
    const id = uid();
    const chatId = uid();
    state.projects = [{
      id,
      name: "默认项目",
      chats: [{ id: chatId, title: "新对话", generateMessages: [], paper: "", topic: "", lastSavedPath: "", updatedAt: Date.now() }],
      currentChatId: chatId,
      generateMessages: [],
      reviseMessages: [],
      paper: "",
      topic: "",
      lastSavedPath: "",
      createdAt: Date.now(),
    }];
  }
  migrateProjectsChats();
  const cur = localStorage.getItem(STORAGE.currentProject);
  state.currentProjectId = state.projects.some((p) => p.id === cur) ? cur : state.projects[0].id;
  loadCurrentProjectData();
}

function saveConfig() {
  localStorage.setItem(STORAGE.config, JSON.stringify(state.config));
  if (state.config.tavily_key) localStorage.setItem(STORAGE.tavily, state.config.tavily_key);
}

function saveProjects() {
  persistCurrentProject();
  localStorage.setItem(STORAGE.projects, JSON.stringify(state.projects));
  localStorage.setItem(STORAGE.currentProject, state.currentProjectId);
}

function migrateProjectsChats() {
  state.projects.forEach((p) => {
    if (p.chats?.length) return;
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
  const raw = first?.content?.trim() || topic?.trim() || "新对话";
  return raw.length > 28 ? `${raw.slice(0, 28)}…` : raw;
}

function currentProject() {
  return state.projects.find((p) => p.id === state.currentProjectId) || state.projects[0];
}

function currentChat() {
  const p = currentProject();
  if (!p?.chats?.length) return null;
  return p.chats.find((c) => c.id === p.currentChatId) || p.chats[0];
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
    p.currentChatId = chat.id;
  } else {
    state.generateMessages = p.generateMessages ? [...p.generateMessages] : [];
    state.paper = p.paper || "";
    state.topic = p.topic || "";
    state.lastSavedPath = p.lastSavedPath || "";
  }
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
    chat.updatedAt = Date.now();
    chat.title = chatTitleFromMessages(chat.generateMessages, chat.topic);
  } else {
    p.generateMessages = state.generateMessages;
    p.paper = state.paper;
    p.topic = state.topic;
    p.lastSavedPath = state.lastSavedPath;
  }
}

// --- Projects ---
function renderProjectList() {
  const el = $("#projectList");
  if (!el) return;
  el.innerHTML = "";
  state.projects.forEach((p) => {
    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "project-item" + (p.id === state.currentProjectId ? " active" : "");
    btn.textContent = p.name;
    btn.addEventListener("click", () => switchProject(p.id));
    btn.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      if (state.projects.length <= 1) {
        alert("至少保留一个项目");
        return;
      }
      if (confirm(`删除项目「${p.name}」及其对话记录？`)) deleteProject(p.id);
    });
    li.appendChild(btn);
    el.appendChild(li);
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
}

function createProject() {
  const name = prompt("项目名称", "新项目");
  if (!name?.trim()) return;
  persistCurrentProject();
  const id = uid();
  const chatId = uid();
  state.projects.unshift({
    id,
    name: name.trim(),
    chats: [{ id: chatId, title: "新对话", generateMessages: [], paper: "", topic: "", lastSavedPath: "", updatedAt: Date.now() }],
    currentChatId: chatId,
    generateMessages: [],
    reviseMessages: [],
    paper: "",
    topic: "",
    lastSavedPath: "",
    createdAt: Date.now(),
  });
  switchProject(id);
}

function renderChatList() {
  const el = $("#chatList");
  if (!el) return;
  const p = currentProject();
  el.innerHTML = "";
  const chats = [...(p.chats || [])].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  chats.forEach((c) => {
    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "chat-item" + (c.id === p.currentChatId ? " active" : "");
    btn.textContent = c.title || "新对话";
    btn.title = c.title || "新对话";
    btn.addEventListener("click", () => switchChat(c.id));
    btn.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      if ((p.chats || []).length <= 1) {
        alert("至少保留一条对话");
        return;
      }
      if (confirm(`删除对话「${c.title || "新对话"}」？`)) deleteChat(c.id);
    });
    li.appendChild(btn);
    el.appendChild(li);
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

function createChat() {
  if (state.isGenerating) {
    if (!confirm("论文正在生成中。新建对话不会停止当前任务，确定继续？")) return;
  }
  persistCurrentProject();
  const p = currentProject();
  const id = uid();
  const chat = { id, title: "新对话", generateMessages: [], paper: "", topic: "", lastSavedPath: "", updatedAt: Date.now() };
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
  if (p.currentChatId === chatId) p.currentChatId = p.chats[0]?.id;
  loadCurrentProjectData();
  saveProjects();
  renderChatList();
  renderThread("generate");
  renderDocPreview();
  setDocOpenLayout(!!state.paper);
}

function deleteProject(id) {
  state.projects = state.projects.filter((p) => p.id !== id);
  if (state.currentProjectId === id) state.currentProjectId = state.projects[0].id;
  loadCurrentProjectData();
  saveProjects();
  renderProjectList();
  renderThread("generate");
  renderThread("revise");
  renderDocPreview();
}

// --- API ---
function llmHeaders() {
  const h = {
    "Content-Type": "application/json",
    "X-API-Key": state.config.api_key,
    "X-Base-Url": state.config.base_url,
    "X-Model": state.config.model,
  };
  if (state.config.tavily_key) h["X-Tavily-Key"] = state.config.tavily_key;
  return h;
}

async function readApiResponse(res) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || data.message || res.statusText);
  return data;
}

async function apiJson(path, opts = {}) {
  const res = await fetch(path, { ...opts, headers: { ...llmHeaders(), ...(opts.headers || {}) } });
  return readApiResponse(res);
}

// --- Auth / settings ---
function updateSidebarStatus() {
  const el = $("#sidebarStatus");
  if (!el) return;
  if (state.loggedIn) {
    el.textContent = state.config.model || "已连接";
    el.classList.add("on");
  } else {
    el.textContent = "未登录";
    el.classList.remove("on");
  }
}

function fillSettingsForm() {
  $("#apiKeyInput").value = state.config.api_key;
  $("#baseUrlInput").value = state.config.base_url;
  const mi = $("#modelInput");
  const model = state.config.model || "deepseek-chat";
  if (mi?.options?.length) {
    const has = [...mi.options].some((o) => o.value === model);
    mi.value = has ? model : "deepseek-chat";
  }
  $("#tavilyKeyInput").value = state.config.tavily_key || "";
}

function fillLoginForm() {
  $("#loginApiKey").value = state.config.api_key || "";
  $("#loginBaseUrl").value = state.config.base_url || "https://api.deepseek.com/v1";
  const sel = $("#loginModel");
  const model = state.config.model || "deepseek-chat";
  if (sel) {
    const has = [...sel.options].some((o) => o.value === model);
    sel.value = has ? model : "deepseek-chat";
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
  const baseUrl = (fromLogin ? $("#loginBaseUrl") : $("#baseUrlInput"))?.value?.trim() || "https://api.deepseek.com/v1";
  const model = (fromLogin ? $("#loginModel") : $("#modelInput"))?.value?.trim() || "deepseek-chat";
  const statusEl = fromLogin ? null : $("#settingsResult");

  if (!apiKey) {
    const msg = "请输入 API Key";
    if (fromLogin) setLoginStatus(msg, "err");
    else if (statusEl) statusEl.textContent = msg;
    else alert(msg);
    return false;
  }
  if (fromLogin) setLoginStatus("正在测试连接…");
  else if (statusEl) statusEl.textContent = "正在测试连接…";

  try {
    const res = await fetch("/api/config/test", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...llmHeaders() },
      body: JSON.stringify({ api_key: apiKey, base_url: baseUrl, model }),
    });
    const data = await readApiResponse(res);
    const tavilyKey = $("#tavilyKeyInput")?.value?.trim() || state.config.tavily_key || "";
    state.config = { api_key: apiKey, base_url: baseUrl, model, tavily_key: tavilyKey };
    state.loggedIn = true;
    saveConfig();
    updateSidebarStatus();
    fillSettingsForm();
    if (statusEl) statusEl.textContent = data.message || "连接成功";
    if (fromLogin) {
      setLoginStatus(data.message || "连接成功", "ok");
      closeLoginGate();
      hideLoginBanner();
      setMode("generate");
    }
    return true;
  } catch (e) {
    state.loggedIn = false;
    updateSidebarStatus();
    const msg = "连接失败: " + e.message;
    if (fromLogin) setLoginStatus(msg, "err");
    else if (statusEl) statusEl.textContent = msg;
    else alert(msg);
    return false;
  }
}

function logout() {
  state.config.api_key = "";
  state.loggedIn = false;
  saveConfig();
  updateSidebarStatus();
  $("#settingsResult").textContent = "已退出";
  openLoginGate();
}

function showLoginBanner() {
  let b = $("#loginBanner");
  if (!b) return;
  b.hidden = false;
}

function hideLoginBanner() {
  const b = $("#loginBanner");
  if (b) b.hidden = true;
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

function openLoginGate() {
  unlockPage();
  fillLoginForm();
  setLoginStatus("");
  const gate = $("#loginGate");
  if (gate) gate.hidden = false;
}

function closeLoginGate() {
  const gate = $("#loginGate");
  if (gate) gate.hidden = true;
  unlockPage();
}

function requireLogin() {
  if (state.loggedIn && state.config.api_key) return true;
  openLoginGate();
  return false;
}

// --- Mode / layout ---
function setMode(mode) {
  state.mode = mode;
  $$(".rail-btn").forEach((el) => el.classList.toggle("active", el.dataset.mode === mode));
  $$(".workspace").forEach((ws) => ws.classList.toggle("active", ws.dataset.mode === mode));
  $("#workspace-settings")?.classList.toggle("open", mode === "settings");
  if (mode === "settings") fillSettingsForm();
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
    btn.title = collapsed ? "展开文稿" : "收起文稿";
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
  if (st) st.textContent = on ? "生成中…" : state.paper ? "已完成" : "等待生成";
  const input = $("#composerInput");
  if (input) input.placeholder = on ? "生成中，可继续与 Joeku 对话…" : "Message Joeku…";
  if (on) setDocOpenLayout(true);
  updateDocPanelChrome();
}

function updateExportButtons() {
  const has = !!state.paper;
  $("#exportDocxBtn").disabled = !has;
  $("#exportPdfBtn").disabled = !has;
}

function showGenProgress(message, percent) {
  if (!state.isGenerating) return;
  const box = $("#composerProgress");
  if (!box) return;
  box.hidden = false;
  const fill = $("#genProgressFill");
  const text = $("#genProgressText");
  if (fill) fill.style.width = `${percent || 0}%`;
  if (text) text.textContent = message || "";
}

function hideGenProgress() {
  const box = $("#composerProgress");
  if (box) box.hidden = true;
  const fill = $("#genProgressFill");
  if (fill) fill.style.width = "0%";
  const text = $("#genProgressText");
  if (text) text.textContent = "";
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
  const entry = { role: normalizeRole(role), content, ts: Date.now(), ...opts };
  if (mode === "revise") state.reviseMessages.push(entry);
  else state.generateMessages.push(entry);
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
  const msgs = messagesFor(mode).filter((m) => !m.progress && m.role !== "system");
  const empty = emptyEl(mode);
  if (empty) empty.hidden = msgs.length > 0;
  thread.innerHTML = "";

  msgs.forEach((m, i) => {
    const role = normalizeRole(m.role);
    const isUser = role === "user";
    const row = document.createElement("div");
    const isNew = i === msgs.length - 1;
    row.className = `msg-row ${isUser ? "user" : "assistant"}${isNew ? " is-new" : ""}`;
    const avatar = document.createElement("div");
    avatar.className = "msg-avatar";
    avatar.textContent = isUser ? "你" : "J";
    const bubble = document.createElement("div");
    bubble.className = "msg-bubble";
    if (isUser) {
      bubble.textContent = m.content;
    } else {
      bubble.innerHTML = m.markdown !== false ? renderMarkdown(m.content) : esc(m.content);
    }
    row.appendChild(avatar);
    row.appendChild(bubble);
    thread.appendChild(row);
  });
  const scroller = thread.closest(".chat-scroll");
  if (scroller) scroller.scrollTo({ top: scroller.scrollHeight, behavior: "smooth" });
}

function updateProgressTurn(message, percent) {
  showGenProgress(message, percent);
}

function clearProgressTurn() {
  hideGenProgress();
}

// --- Doc preview ---
function renderDocPreview() {
  const el = $("#docPreview");
  if (!el) return;
  if (!state.paper) {
    el.innerHTML = '<p class="doc-placeholder">生成开始后，论文将在此实时预览</p>';
    return;
  }
  el.innerHTML = renderMarkdown(state.paper);
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
}

function openParamsDialog() {
  const topic =
    $("#composerInput")?.value?.trim() ||
    state.topic ||
    (state.requirementsName ? `根据要求文档：${state.requirementsName}` : "");
  $("#genTopic").value = topic;
  $("#paramsHint").textContent = state.requirementsName
    ? `已上传要求文档「${state.requirementsName}」，请确认参数`
    : "确认以下参数后开始生成";
  $("#saveFolder").value = state.saveFolder;
  applyExportFormatToForm();
  openModal("paramsDialog");
}

function clearPendingReq() {
  state.requirementsText = "";
  state.requirementsName = "";
  $("#attachRow")?.setAttribute("hidden", "");
  $("#reqChip").textContent = "";
}

// --- Generation ---
async function startGeneration(e) {
  e?.preventDefault();
  if (!requireLogin()) return;

  const topic = $("#genTopic")?.value?.trim();
  if (!topic || topic.length < 3) {
    alert("论文主题至少 3 个字符");
    return;
  }

  state.topic = topic;
  const targetWords = parseInt($("#genWords")?.value, 10) || 6000;
  const citationLimit = parseInt($("#genCites")?.value, 10) || 15;

  readExportFormatFromForm();
  closeModal("paramsDialog");
  addTurn("user", topic, { mode: "generate" });
  setGeneratingLayout(true);
  state.paper = "";
  renderDocPreview();
  updateProgressTurn("正在启动生成任务…", 5);

  const body = {
    topic,
    target_words: targetWords,
    search_limit: Math.max(citationLimit, 12),
    citation_limit: citationLimit,
    language: $("#genLanguage")?.value || "zh",
    citation_format: $("#genCitationFormat")?.value || "apa7",
    requirements: state.requirementsText || "",
    fast_mode: false,
    web_search: $("#genWebSearch")?.checked !== false,
    de_ai: $("#genDeAi")?.checked === true,
    deep_quality: $("#genDeepQuality")?.checked === true,
  };

  try {
    const { job_id } = await apiJson("/api/generate/start", { method: "POST", body: JSON.stringify(body) });
    pollGeneration(job_id);
  } catch (err) {
    clearProgressTurn();
    setGeneratingLayout(false);
    addTurn("agent", `生成失败：${err.message}`, { mode: "generate" });
  }
}

const POLL_INTERVAL_MS = 2500;
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
  localStorage.removeItem(STORAGE.activeJob);
  persistCurrentProject();
  saveProjects();
  renderChatList();
  renderDocPreview();
  clearProgressTurn();
  const wc = st.result?.word_count;
  addTurn("agent", `论文生成完成${wc ? `（约 ${wc} 词）` : ""}。右侧可预览并按所选格式导出。`, {
    mode: "generate",
    markdown: false,
  });
  setGeneratingLayout(false);
  setDocOpenLayout(true);
  clearPendingReq();
  $("#composerInput").value = "";
}

function pollGeneration(jobId) {
  if (state.pollTimer) clearInterval(state.pollTimer);
  state.activeJobId = jobId;
  state.pollErrors = 0;
  localStorage.setItem(STORAGE.activeJob, jobId);

  const tick = async () => {
    try {
      const st = await fetchJobStatus(jobId);
      state.pollErrors = 0;
      if (st.preview) {
        state.paper = st.preview;
        persistCurrentProject();
        renderDocPreview();
        setDocOpenLayout(true);
      }
      if (st.message) updateProgressTurn(st.message, st.percent || 10);

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
        localStorage.removeItem(STORAGE.activeJob);
        clearProgressTurn();
        setGeneratingLayout(false);
        addTurn("agent", `生成失败：${st.error || "未知错误"}`, { mode: "generate" });
      }
    } catch (err) {
      if (err.code === "missing" && state.paper) {
        clearInterval(state.pollTimer);
        state.pollTimer = null;
        state.activeJobId = null;
        localStorage.removeItem(STORAGE.activeJob);
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
  const jobId = localStorage.getItem(STORAGE.activeJob);
  if (!jobId || state.isGenerating) return;
  try {
    const st = await fetchJobStatus(jobId);
    if (st.status === "running" || st.status === "pending") {
      setGeneratingLayout(true);
      updateProgressTurn(`恢复生成任务… ${st.message || ""}`, st.percent || 5);
      pollGeneration(jobId);
    } else if (st.status === "done") {
      localStorage.removeItem(STORAGE.activeJob);
      if (st.result?.has_document) {
        try {
          const full = await fetchJobResult(jobId);
          if (full.document) {
            state.paper = full.document;
            renderDocPreview();
            setDocOpenLayout(true);
          }
        } catch (_) {}
      }
    }
  } catch (_) {
    localStorage.removeItem(STORAGE.activeJob);
  }
}

// --- Chat (during / after generation) ---
async function submitComposerChat(text) {
  const msg = (text || $("#composerInput")?.value || "").trim();
  if (!msg) return;
  addTurn("user", msg, { mode: "generate" });
  $("#composerInput").value = "";
  autoResizeTextarea($("#composerInput"));

  const history = state.generateMessages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .slice(-18)
    .map((m) => ({ role: m.role, content: m.content }));

  try {
    const data = await apiJson("/api/chat", {
      method: "POST",
      body: JSON.stringify({
        messages: history,
        paper_context: state.paper || "",
      }),
    });
    addTurn("assistant", data.reply || "（无回复）", { mode: "generate" });
  } catch (err) {
    addTurn("assistant", `对话失败：${err.message}`, { mode: "generate" });
  }
}

function hasGenerateThread() {
  return state.generateMessages.some((m) => m.role === "user" || m.role === "assistant");
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
    addTurn("system", "正在分析并生成修改建议…", { mode: "revise" });
    try {
      const data = await apiJson("/api/improve-paper", {
        method: "POST",
        body: JSON.stringify({ paper, feedback }),
      });
      state.reviseMessages = state.reviseMessages.filter((m) => m.role !== "system" || !m.content.includes("正在分析"));
      addTurn("agent", data.document || "（无返回内容）", { mode: "revise" });
    } catch (err) {
      state.reviseMessages = state.reviseMessages.filter((m) => m.role !== "system" || !m.content.includes("正在分析"));
      addTurn("agent", `请求失败：${err.message}`, { mode: "revise" });
    }
  } else {
    try {
      const data = await apiJson("/api/analyze", { method: "POST", body: JSON.stringify({ text: feedback }) });
      addTurn("agent", typeof data.analysis === "string" ? data.analysis : JSON.stringify(data.analysis, null, 2), { mode: "revise" });
    } catch (err) {
      addTurn("agent", `分析失败：${err.message}`, { mode: "revise" });
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
    $("#attachRow")?.removeAttribute("hidden");
    $("#reqChip").textContent = state.requirementsName;
    openParamsDialog();
  } else {
    state.reviseDocText = data.text;
    state.reviseDocName = data.filename || file.name;
    $("#reviseAttachRow")?.removeAttribute("hidden");
    $("#reviseChip").textContent = state.reviseDocName;
    $("#reviseDocText").value = data.text;
    addTurn("system", `已加载文档「${state.reviseDocName}」`, { mode: "revise", markdown: false });
  }
}

// --- Folder / docx ---
async function pickFolder() {
  try {
    const data = await apiJson("/api/pick-folder");
    state.saveFolder = data.path;
    localStorage.setItem(STORAGE.folder, state.saveFolder);
    $("#saveFolder").value = state.saveFolder;
    $("#openFolderBtn").disabled = false;
  } catch (e) {
    alert(e.message);
  }
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
    applyExportFormatToForm();
    if (!state.config.base_url && state.defaults.base_url) state.config.base_url = state.defaults.base_url;
    if (!state.config.model && state.defaults.model) state.config.model = state.defaults.model;
  } catch (_) {}
}

// --- Perm ---
function updatePermUI() {
  const btn = $("#permBtn");
  if (state.permGranted) btn?.classList.add("granted");
}

async function handleComposerSubmit(e) {
  if (e) e.preventDefault();
  if (!requireLogin()) return false;
  const text = $("#composerInput")?.value?.trim();
  if (!text && !state.requirementsText) {
    alert("请输入内容或上传要求文档");
    return false;
  }
  if (state.isGenerating || state.paper || hasGenerateThread()) {
    await submitComposerChat(text);
    return false;
  }
  openParamsDialog();
  return false;
}

function bindUiApi() {
  window.Joeku = {
    ready: true,
    composerSubmit: (e) => handleComposerSubmit(e),
    rail(mode) {
      setMode(mode === "settings" ? "settings" : mode);
    },
    newChat: () => createChat(),
    newProject: () => createProject(),
    openLogin: () => openLoginGate(),
    skipLogin: () => {
      closeLoginGate();
      showLoginBanner();
    },
    login: () => testConnection(true),
    logout: () => logout(),
    chip(el) {
      const input = $("#composerInput");
      if (!input || !el) return;
      input.value = el.dataset.prompt || "";
      input.dispatchEvent(new Event("input"));
      input.focus();
    },
    attachReq: () => $("#reqFileInput")?.click(),
    clearReq: () => clearPendingReq(),
    toggleDoc: () => toggleDocPanel(),
    expandDoc: () => setDocCollapsed(false),
    exportDocx: () => exportDocx(),
    exportPdf: () => exportPdf().catch((err) => alert(err.message)),
    attachRevise: () => $("#reviseFileInput")?.click(),
    clearRevise: () => {
      state.reviseDocText = "";
      state.reviseDocName = "";
      $("#reviseAttachRow")?.setAttribute("hidden", "");
      $("#reviseDocText").value = "";
    },
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
    closeParams: () => closeModal("paramsDialog"),
  };
}

function bindEvents() {
  document.querySelectorAll("[data-close-modal]").forEach((btn) => {
    btn.addEventListener("click", () => closeModal(btn.dataset.closeModal));
  });

  $("#settingsForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    state.config.tavily_key = $("#tavilyKeyInput")?.value?.trim() || "";
    saveConfig();
    await testConnection(false);
  });

  $("#composerForm")?.addEventListener("submit", handleComposerSubmit);

  $("#reqFileInput")?.addEventListener("change", async (e) => {
    const f = e.target.files?.[0];
    if (f) await uploadFile(f, "req");
    e.target.value = "";
  });

  $("#paramsForm")?.addEventListener("submit", startGeneration);

  $("#reviseForm")?.addEventListener("submit", submitRevise);
  $("#reviseFileInput")?.addEventListener("change", async (e) => {
    const f = e.target.files?.[0];
    if (f) await uploadFile(f, "revise");
    e.target.value = "";
  });

  $("#sidebarToggle")?.addEventListener("click", () => $("#sidebar")?.classList.toggle("open"));

  bindTextareaAutoResize();
}

function autoResizeTextarea(ta) {
  if (!ta) return;
  ta.style.height = "auto";
  const max = 240;
  ta.style.height = `${Math.min(ta.scrollHeight, max)}px`;
}

function bindTextareaAutoResize() {
  ["#composerInput", "#reviseInput"].forEach((sel) => {
    const ta = $(sel);
    if (!ta) return;
    ta.addEventListener("input", () => autoResizeTextarea(ta));
    autoResizeTextarea(ta);
  });
}

function closeAllDialogs() {
  document.querySelectorAll(".modal-layer").forEach((el) => {
    el.hidden = true;
  });
  closeLoginGate();
  unlockPage();
}

async function init() {
  unlockPage();
  bindEvents();
  bindUiApi();

  try {
    loadStorage();
  } catch (err) {
    showFatal("Storage load failed: " + err.message);
  }

  hideGenProgress();
  state.loggedIn = !!state.config.api_key;

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

  try {
    await loadDefaults();
    await resumeActiveJob();
  } catch (err) {
    console.warn("Background init:", err);
  }

  if (state.loggedIn) {
    closeLoginGate();
    hideLoginBanner();
  } else {
    openLoginGate();
  }

  window.__JOEKU_READY = true;
  console.info("[Joeku] v20260702 ready");
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