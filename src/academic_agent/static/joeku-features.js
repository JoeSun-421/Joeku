/* Joeku extended features: local store, library, doc editor, streaming */
(function () {
  const STORAGE_DATA_ROOT = "joeku-data-root";
  const STORAGE_LOCAL_UID = "joeku-local-user-id";
  let identityCache = [];

  function $(s) {
    return document.querySelector(s);
  }

  function getState() {
    return (
      window.__JOEKU_STATE || {
        config: { api_key: "", base_url: "https://api.deepseek.com/v1", model: "deepseek-chat", tavily_key: "" },
        dataRoot: "",
        localUserId: "",
        libraryItems: [],
      }
    );
  }

  function formatApiError(data, fallback) {
    const d = data?.detail;
    if (typeof d === "string") return d;
    if (Array.isArray(d)) return d.map((x) => x.msg || JSON.stringify(x)).join("; ");
    return fallback;
  }

  async function apiPublic(path, opts = {}) {
    const res = await fetch(path, {
      ...opts,
      headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(formatApiError(data, res.statusText));
    return data;
  }

  function latin1Header(value) {
    const s = String(value ?? "");
    if (!/[^\u0000-\u00ff]/.test(s)) return s;
    const bytes = new TextEncoder().encode(s);
    let bin = "";
    for (const b of bytes) bin += String.fromCharCode(b);
    return "b64:" + btoa(bin);
  }

  function llmHeaders() {
    const state = getState();
    const h = {
      "Content-Type": "application/json",
      "X-API-Key": latin1Header(state.config.api_key),
      "X-Base-Url": latin1Header((state.config.base_url || "").replace(/[^\x00-\x7F]/g, "")),
      "X-Model": latin1Header(state.config.model),
    };
    if (state.config.tavily_key) h["X-Tavily-Key"] = latin1Header(state.config.tavily_key);
    return h;
  }

  async function apiJson(path, opts = {}) {
    const res = await fetch(path, { ...opts, headers: { ...llmHeaders(), ...(opts.headers || {}) } });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.detail || data.message || res.statusText);
    return data;
  }

  function parseSseDataPayload(line) {
    if (!line || !line.startsWith("data:")) return "";
    const rest = line.slice(5);
    // SSE allows one optional space after "data:" — strip only that, keep token spaces.
    return rest.startsWith(" ") ? rest.slice(1) : rest;
  }

  function parseSseBlock(block) {
    const lines = block.split("\n");
    let event = "data";
    let data = "";
    for (const line of lines) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) data += parseSseDataPayload(line);
    }
    return { event, data };
  }

  function dispatchSseBlock(block, onToken, typed, phaseRef) {
    if (!block.trim()) return "continue";
    const { event, data } = parseSseBlock(block);
    if (event === "error") throw new Error(data || "Stream request failed");
    if (event === "done") {
      if (typed) onToken("done", data);
      return "done";
    }
    if (event === "think_done") {
      if (phaseRef) phaseRef.value = "answer";
      if (typed) onToken("think_done", data);
      return "continue";
    }
    if (event === "step") {
      if (typed) onToken("step", data);
      return "continue";
    }
    if (event === "think" || event === "reasoning") {
      if (phaseRef) phaseRef.value = "think";
      if (typed) onToken(event === "reasoning" ? "reasoning" : "think", data);
      return "continue";
    }
    if (event === "answer") {
      if (phaseRef) phaseRef.value = "answer";
      if (typed) onToken("answer", data);
      return "continue";
    }
    if (!data) return "continue";
    let ev = event;
    if (ev === "data" || ev === "message") {
      ev = phaseRef?.value === "think" ? "think" : "answer";
    }
    if (typed) onToken(ev, data);
    else onToken(data);
    return "continue";
  }

  async function fetchStream(path, body, onToken, opts = {}) {
    const typed = opts.typed || onToken.length >= 2;
    const phaseRef = opts.trackPhase ? { value: "think" } : null;
    const res = await fetch(path, {
      method: "POST",
      headers: llmHeaders(),
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || res.statusText);
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";

    const flush = (text, final) => {
      buf += text;
      buf = buf.replace(/\r\n/g, "\n");
      const parts = buf.split("\n\n");
      if (final) {
        while (parts.length && !parts[parts.length - 1].trim()) parts.pop();
      } else {
        buf = parts.pop() || "";
      }
      for (const block of parts) {
        const status = dispatchSseBlock(block, onToken, typed, phaseRef);
        if (status === "done") return true;
      }
      if (final && buf.trim()) {
        const status = dispatchSseBlock(buf, onToken, typed, phaseRef);
        if (status === "done") return true;
        buf = "";
      }
      return false;
    };

    while (true) {
      const { done, value } = await reader.read();
      if (value) {
        if (flush(decoder.decode(value, { stream: true }), false)) return;
      }
      if (done) {
        flush(decoder.decode(), true);
        return;
      }
    }
  }

  let activeTextSelection = null;
  let annotationsPanelOpen = false;
  let activeAnnotationId = null;

  function escapeHtml(text) {
    return String(text || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function renderMd(text) {
    if (window.__JOEKU_renderMarkdown) return window.__JOEKU_renderMarkdown(text || "");
    return `<p>${escapeHtml(text)}</p>`;
  }

  function parseSuggestedRevision(advice) {
    const raw = String(advice || "").trim();
    if (!raw) return "";
    const patterns = [
      /##\s*(?:Suggested revision|建议修改|修改建议|修订建议)[^\n]*\n+([\s\S]*?)(?=\n##\s|$)/i,
      /##\s*(?:Suggested revision \(paste-ready replacement prose\))[^\n]*\n+([\s\S]*?)(?=\n##\s|$)/i,
    ];
    for (const re of patterns) {
      const m = raw.match(re);
      if (m?.[1]?.trim()) return m[1].trim();
    }
    const blocks = raw.split(/\n##\s+/).filter(Boolean);
    if (blocks.length > 1) return blocks[1].replace(/^[^\n]+\n+/, "").trim();
    return raw.slice(0, 2400).trim();
  }

  function annotationsList() {
    const state = getState();
    if (!Array.isArray(state.docAnnotations)) state.docAnnotations = [];
    return state.docAnnotations;
  }

  function annotationById(id) {
    return annotationsList().find((a) => a.id === id) || null;
  }

  function splitPaperParagraphs(paper) {
    return String(paper || "")
      .split(/\n\s*\n/)
      .map((s) => s.trim())
      .filter(Boolean);
  }

  function normalizeWs(text) {
    return String(text || "").replace(/\s+/g, " ").trim();
  }

  function findTextRange(root, search) {
    const target = String(search || "").trim();
    if (target.length < 2 || !root) return null;
    const nodes = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) nodes.push(node);
    for (const tn of nodes) {
      const idx = tn.textContent.indexOf(target);
      if (idx >= 0) {
        const range = document.createRange();
        range.setStart(tn, idx);
        range.setEnd(tn, idx + target.length);
        return range;
      }
    }
    const normTarget = normalizeWs(target);
    if (normTarget.length < 2) return null;
    let full = "";
    const spans = [];
    for (const tn of nodes) {
      const raw = tn.textContent;
      for (let i = 0; i < raw.length; i++) {
        const ch = raw[i];
        if (/\s/.test(ch)) {
          if (full.length && full[full.length - 1] !== " ") {
            full += " ";
            spans.push({ node: tn, offset: i });
          }
        } else {
          full += ch;
          spans.push({ node: tn, offset: i });
        }
      }
    }
    const normFull = full.trim();
    let idx = normFull.indexOf(normTarget);
    if (idx < 0 && normTarget.length > 24) {
      idx = normFull.indexOf(normTarget.slice(0, 24));
    }
    if (idx < 0) return null;
    const start = spans[idx];
    const end = spans[Math.min(idx + normTarget.length - 1, spans.length - 1)];
    if (!start || !end) return null;
    const range = document.createRange();
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, Math.min(end.offset + 1, end.node.textContent.length));
    return range;
  }

  function captureTextSelection() {
    const preview = $("#docPreview");
    const sel = window.getSelection();
    if (!preview || !sel || sel.isCollapsed || sel.rangeCount < 1) return null;
    const range = sel.getRangeAt(0);
    const text = sel.toString().trim();
    if (text.length < 2) return null;
    const para =
      range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
        ? range.commonAncestorContainer.closest?.(".doc-para")
        : range.commonAncestorContainer.parentElement?.closest?.(".doc-para");
    if (!para || !preview.contains(para)) return null;
    return { text, paraId: para.dataset.paraId || "0" };
  }

  function updateAnnotationChrome() {
    const list = annotationsList();
    const btn = $("#docAnnListBtn");
    const count = $("#docAnnCount");
    if (count) count.textContent = String(list.length);
    if (btn) btn.hidden = list.length < 1;
    renderAnnotationsPanel();
  }

  function positionSelectionToolbar() {
    const toolbar = $("#docSelectionToolbar");
    const preview = $("#docPreview");
    const wrap = $("#docBodyWrap");
    if (!toolbar || toolbar.hidden || !preview || !wrap || !activeTextSelection?.text) return;
    const para = preview.querySelector(`.doc-para[data-para-id="${activeTextSelection.paraId}"]`);
    if (!para) return;
    const range = findTextRange(para, activeTextSelection.text);
    const rect = range
      ? range.getBoundingClientRect()
      : para.getBoundingClientRect();
    const wrapRect = wrap.getBoundingClientRect();
    const top = Math.max(8, Math.min(rect.bottom - wrapRect.top + 8, wrapRect.height - 56));
    toolbar.style.top = `${top}px`;
    toolbar.style.bottom = "auto";
  }

  function updateSelectionToolbar() {
    const toolbar = $("#docSelectionToolbar");
    const countEl = $("#docSelectionCount");
    const text = activeTextSelection?.text || "";
    if (toolbar) toolbar.hidden = !text;
    if (countEl) {
      const words = text ? text.split(/\s+/).filter(Boolean).length : 0;
      const preview = text.length > 48 ? `${text.slice(0, 45)}…` : text;
      countEl.textContent = text
        ? `${words} 词 · 「${preview}」`
        : "未选中";
    }
    if (text) {
      window.__JOEKU_setDocOpenLayout?.(true);
      window.__JOEKU_expandDoc?.();
      positionSelectionToolbar();
      requestAnimationFrame(() => $("#annotationInput")?.focus());
    }
  }

  function clearParagraphSelection() {
    activeTextSelection = null;
    window.getSelection()?.removeAllRanges();
    document.querySelectorAll(".doc-para.has-selection").forEach((el) => el.classList.remove("has-selection"));
    updateSelectionToolbar();
  }

  function markAnnotatedParagraphs(preview) {
    if (!preview) return;
    preview.querySelectorAll(".doc-para").forEach((el) => {
      el.classList.remove("has-annotation", "ann-active");
      delete el.dataset.annId;
    });
    for (const ann of annotationsList()) {
      const para = preview.querySelector(`.doc-para[data-para-id="${ann.paraId}"]`);
      if (!para) continue;
      para.classList.add("has-annotation");
      if (ann.id === activeAnnotationId) para.classList.add("ann-active");
      if (!para.dataset.annId) para.dataset.annId = ann.id;
    }
  }

  function bindDocParagraphSelection() {
    const preview = $("#docPreview");
    const wrap = $("#docBodyWrap");
    if (!preview || preview.dataset.paraBound) return;
    preview.dataset.paraBound = "1";
    preview.addEventListener("mouseup", () => {
      const captured = captureTextSelection();
      if (captured) {
        activeTextSelection = captured;
        preview.querySelectorAll(".doc-para.has-selection").forEach((el) => el.classList.remove("has-selection"));
        const para = preview.querySelector(`.doc-para[data-para-id="${captured.paraId}"]`);
        para?.classList.add("has-selection");
      }
      updateSelectionToolbar();
    });
    preview.addEventListener("scroll", () => renderAnnotationUI(), { passive: true });
    wrap?.addEventListener("scroll", () => renderAnnotationUI(), { passive: true });

    $("#annotationCancelBtn")?.addEventListener("click", () => clearParagraphSelection());
    const annInput = $("#annotationInput");
    annInput?.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        submitAnnotation();
      }
      if (e.key === "Escape") clearParagraphSelection();
    });
    document.addEventListener("click", (e) => {
      const panel = $("#docAnnotationsPanel");
      if (!panel || panel.hidden) return;
      if (panel.contains(e.target) || e.target.closest("#docAnnListBtn")) return;
      annotationsPanelOpen = false;
      panel.hidden = true;
    });
  }

  function focusAnnotation(annId) {
    activeAnnotationId = annId;
    annotationsPanelOpen = true;
    const panel = $("#docAnnotationsPanel");
    if (panel) panel.hidden = false;
    renderAnnotationUI();
    const note = document.querySelector(`.doc-inline-note[data-ann-id="${annId}"]`);
    note?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  function dismissAnnotation(annId) {
    const list = annotationsList();
    const idx = list.findIndex((a) => a.id === annId);
    if (idx >= 0) list.splice(idx, 1);
    if (activeAnnotationId === annId) activeAnnotationId = null;
    if (window.__JOEKU_persistCurrentProject) window.__JOEKU_persistCurrentProject();
    if (window.__JOEKU_saveProjects) window.__JOEKU_saveProjects();
    renderAnnotationUI();
  }

  function toggleAnnotationsPanel() {
    annotationsPanelOpen = !annotationsPanelOpen;
    const panel = $("#docAnnotationsPanel");
    if (panel) panel.hidden = !annotationsPanelOpen;
    renderAnnotationsPanel();
  }

  function renderAnnotationsPanel() {
    const panel = $("#docAnnotationsPanel");
    if (!panel) return;
    const list = annotationsList();
    if (!annotationsPanelOpen || list.length < 1) {
      panel.hidden = true;
      return;
    }
    panel.hidden = false;
    panel.innerHTML = list
      .map((ann, i) => {
        const excerpt = ann.text.length > 56 ? `${ann.text.slice(0, 53)}…` : ann.text;
        const status = ann.streaming ? "生成中…" : ann.advice ? "可应用" : "待处理";
        return `<button type="button" class="doc-ann-panel-item${ann.id === activeAnnotationId ? " active" : ""}" data-ann-id="${escapeHtml(ann.id)}">
          <span class="doc-ann-panel-idx">${i + 1}</span>
          <span class="doc-ann-panel-body">
            <strong>${escapeHtml(ann.comment || "批注")}</strong>
            <span class="doc-ann-panel-excerpt">${escapeHtml(excerpt)}</span>
            <span class="doc-ann-panel-status">${status}</span>
          </span>
        </button>`;
      })
      .join("");
    panel.querySelectorAll("[data-ann-id]").forEach((btn) => {
      btn.addEventListener("click", () => focusAnnotation(btn.dataset.annId));
    });
  }

  function buildInlineNote(ann, wrapRect) {
    const preview = $("#docPreview");
    const para = preview?.querySelector(`.doc-para[data-para-id="${ann.paraId}"]`);
    if (!para) return null;
    const range = findTextRange(para, ann.text);
    const rect = range
      ? (range.getClientRects().length ? range.getClientRects()[range.getClientRects().length - 1] : range.getBoundingClientRect())
      : para.getBoundingClientRect();

    const note = document.createElement("div");
    note.className = "doc-inline-note";
    if (ann.id === activeAnnotationId) note.classList.add("active");
    note.dataset.annId = ann.id;
    note.style.top = `${rect.bottom - wrapRect.top + 6}px`;

    const revision = parseSuggestedRevision(ann.advice);
    const canApply = !ann.streaming && !!revision;

    note.innerHTML = `
      <div class="doc-inline-note-head">
        <span class="doc-inline-note-title">批注</span>
        <div class="doc-inline-note-actions">
          <button type="button" class="doc-inline-note-apply" data-act="apply" ${canApply ? "" : "disabled"}>应用</button>
          <button type="button" class="doc-inline-note-apply ghost" data-act="chat">讨论</button>
          <button type="button" class="doc-inline-note-apply ghost" data-act="dismiss" title="删除">×</button>
        </div>
      </div>
      <p class="doc-inline-note-quote">${escapeHtml(ann.text.length > 120 ? `${ann.text.slice(0, 117)}…` : ann.text)}</p>
      <p class="doc-inline-note-user"><strong>备注：</strong>${escapeHtml(ann.comment || "")}</p>
      <div class="doc-inline-note-body${ann.streaming ? " streaming" : ""}">${ann.advice ? renderMd(ann.advice) : "<p class=\"muted\">正在生成修改建议…</p>"}</div>
    `;

    note.querySelector('[data-act="apply"]')?.addEventListener("click", (e) => {
      e.stopPropagation();
      applyAnnotationDirect(ann.id);
    });
    note.querySelector('[data-act="chat"]')?.addEventListener("click", (e) => {
      e.stopPropagation();
      openAnnotationInChat(ann.id);
    });
    note.querySelector('[data-act="dismiss"]')?.addEventListener("click", (e) => {
      e.stopPropagation();
      dismissAnnotation(ann.id);
    });
    note.addEventListener("click", (e) => {
      e.stopPropagation();
      focusAnnotation(ann.id);
    });
    return note;
  }

  function renderAnnotationUI() {
    renderAnnotationAnchors();
    updateAnnotationChrome();
    const preview = $("#docPreview");
    markAnnotatedParagraphs(preview);
    if (activeTextSelection?.text) positionSelectionToolbar();
  }

  function renderAnnotationAnchors() {
    const layer = $("#docAnnotationLayer");
    const preview = $("#docPreview");
    const wrap = $("#docBodyWrap");
    if (!layer || !preview || !wrap) return;
    layer.innerHTML = "";
    const wrapRect = wrap.getBoundingClientRect();
    for (const ann of annotationsList()) {
      const para = preview.querySelector(`.doc-para[data-para-id="${ann.paraId}"]`);
      if (!para) continue;
      const range = findTextRange(para, ann.text);
      const rect = range
        ? (range.getClientRects().length ? range.getClientRects()[range.getClientRects().length - 1] : range.getBoundingClientRect())
        : para.getBoundingClientRect();

      const link = document.createElement("button");
      link.type = "button";
      link.className = `doc-ann-anchor${ann.id === activeAnnotationId ? " active" : ""}${ann.streaming ? " streaming" : ""}`;
      link.dataset.annId = ann.id;
      link.title = ann.comment || "查看批注";
      link.textContent = ann.streaming ? "…" : "✎";
      link.style.top = `${rect.bottom - wrapRect.top + 2}px`;
      link.style.left = `${rect.right - wrapRect.left + 4}px`;
      link.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        focusAnnotation(ann.id);
      });
      layer.appendChild(link);

      const showNote = ann.id === activeAnnotationId || (!activeAnnotationId && ann.streaming);
      if (showNote) {
        const note = buildInlineNote(ann, wrapRect);
        if (note) layer.appendChild(note);
      }
    }
  }

  async function applyAnnotationDirect(annId) {
    const ann = annotationById(annId);
    if (!ann) return;
    const revision = parseSuggestedRevision(ann.advice);
    if (!revision) {
      alert("修改建议尚未就绪，请稍候或点击「讨论」继续完善。");
      return;
    }
    replaceParagraphsInPaper([ann.text], revision);
    dismissAnnotation(annId);
    if (window.__JOEKU_renderDocPreview) window.__JOEKU_renderDocPreview();
    if (window.__JOEKU_addTurn) {
      window.__JOEKU_addTurn("assistant", "已根据批注建议更新文档段落。", {
        mode: "generate",
        markdown: false,
      });
    }
  }

  async function openAnnotationInChat(annId) {
    const ann = annotationById(annId);
    if (!ann) return;
    const state = getState();
    state.pendingRevision = {
      annId,
      selections: [ann.text],
      advice: ann.advice || "",
      comment: ann.comment || "",
    };
    if (window.__JOEKU_expandChatPanel) window.__JOEKU_expandChatPanel();
    const userMsg =
      `**Document revision request**\n\n` +
      `> ${ann.text}\n\n` +
      `**My note:** ${ann.comment}\n\n` +
      (ann.advice ? `**Draft suggestion:**\n${ann.advice.slice(0, 1200)}\n\n` : "") +
      `Please refine this revision. When ready, I will apply it to the document.`;
    if (window.__JOEKU_submitComposerChat) {
      await window.__JOEKU_submitComposerChat(userMsg, { revisionAnnId: annId });
    }
  }

  async function applyAnnotationRevision(annId) {
    const ann = annotationById(annId);
    const state = getState();
    const pending = state.pendingRevision;
    if (!ann && !pending) return;
    const selection = ann?.text || pending?.selections?.[0] || "";
    const advice = pending?.advice || ann?.advice || "";
    if (!selection || !advice) {
      alert("修改建议尚未就绪。");
      return;
    }
    const direct = parseSuggestedRevision(advice);
    if (direct && annId) {
      replaceParagraphsInPaper([selection], direct);
      dismissAnnotation(annId);
      state.pendingRevision = null;
      if (window.__JOEKU_renderDocPreview) window.__JOEKU_renderDocPreview();
      if (window.__JOEKU_addTurn) {
        window.__JOEKU_addTurn("assistant", "已根据批注建议更新文档段落。", {
          mode: "generate",
          markdown: false,
        });
      }
      return;
    }
    let revised = "";
    try {
      await fetchStream(
        "/api/apply-revision/stream",
        {
          paper: state.paper,
          selection,
          advice,
          ...localPayload(),
        },
        (tok) => {
          revised += tok;
        }
      );
      replaceParagraphsInPaper([selection], revised.trim());
      const list = annotationsList();
      const idx = list.findIndex((a) => a.id === annId);
      if (idx >= 0) list.splice(idx, 1);
      state.pendingRevision = null;
      clearParagraphSelection();
      if (window.__JOEKU_renderDocPreview) window.__JOEKU_renderDocPreview();
      if (window.__JOEKU_addTurn) {
        window.__JOEKU_addTurn("assistant", "Revision applied to the document.", {
          mode: "generate",
          markdown: false,
        });
      }
    } catch (e) {
      alert(`Apply failed: ${e.message}`);
    }
  }

  function replaceParagraphsInPaper(originals, replacement) {
    const state = getState();
    let paper = state.paper || "";
    for (const orig of originals) {
      if (!orig) continue;
      const idx = paper.indexOf(orig);
      if (idx >= 0) paper = paper.slice(0, idx) + replacement + paper.slice(idx + orig.length);
      else paper = paper.replace(orig, replacement);
    }
    state.paper = paper;
    if (window.__JOEKU_persistCurrentProject) window.__JOEKU_persistCurrentProject();
    if (window.__JOEKU_saveProjects) window.__JOEKU_saveProjects();
  }

  function enabledLibraryIds() {
    const state = getState();
    return (state.libraryItems || []).filter((i) => i.enabled !== false).map((i) => i.id);
  }

  function currentProjectId() {
    const state = getState();
    return state.currentProjectId || state.projects?.[0]?.id || "";
  }

  function localPayload() {
    const state = getState();
    return {
      data_root: state.dataRoot || "",
      user_id: state.localUserId || "",
      project_id: currentProjectId(),
      persona_hint: state.personaHint || "",
      library_ids: enabledLibraryIds(),
      use_library: true,
    };
  }

  async function syncStateToDisk() {
    const state = getState();
    if (!state.dataRoot || !state.localUserId || !state.loggedIn) return;
    const fn = window.__JOEKU_persistCurrentProject;
    if (fn) fn();
    await apiPublic("/api/local/state", {
      method: "PUT",
      body: JSON.stringify({
        data_root: state.dataRoot,
        user_id: state.localUserId,
        state: {
          projects: state.projects,
          currentProjectId: state.currentProjectId,
          saveFolder: state.saveFolder,
        },
      }),
    });
  }

  async function loadStateFromDisk() {
    const state = getState();
    if (!state.dataRoot || !state.localUserId) return false;
    const data = await apiPublic(
      `/api/local/state?data_root=${encodeURIComponent(state.dataRoot)}&user_id=${encodeURIComponent(state.localUserId)}`
    );
    if (data.state?.projects?.length) {
      state.projects = data.state.projects;
      state.currentProjectId = data.state.currentProjectId || state.projects[0].id;
      state.saveFolder = data.state.saveFolder || "";
    }
    if (data.profile?.display_name) state.displayName = data.profile.display_name;
    if (data.profile?.persona_hint) state.personaHint = data.profile.persona_hint;
    return true;
  }

  async function loadLibrary() {
    const state = getState();
    const pid = currentProjectId();
    state.libraryItems = [];
    renderLibraryList();
    updateLibraryProjectLabel();
    if (!state.dataRoot || !state.localUserId || !pid) {
      return;
    }
    try {
      const data = await apiPublic(
        `/api/library/list?data_root=${encodeURIComponent(state.dataRoot)}&user_id=${encodeURIComponent(state.localUserId)}&project_id=${encodeURIComponent(pid)}`
      );
      state.libraryItems = data.items || [];
      renderLibraryList();
      updateLibraryProjectLabel();
    } catch (_) {
      state.libraryItems = [];
      renderLibraryList();
      updateLibraryProjectLabel();
    }
  }

  function libraryBadge(filename, sourceUrl) {
    if (sourceUrl) return "WEB";
    const ext = (filename || "").split(".").pop()?.toUpperCase() || "FILE";
    return ext.length > 5 ? "FILE" : ext;
  }

  function formatLibraryStat(it) {
    const wc = it.word_count;
    const cc = it.chunks || it.chunk_count;
    const parts = [];
    if (wc) parts.push(`${wc} words`);
    if (cc) parts.push(`${cc} chunks`);
    return parts.join(" · ") || "Indexed";
  }

  function updateLibraryCount(count) {
    const el = $("#libraryCount");
    if (el) el.textContent = `${count} item${count === 1 ? "" : "s"}`;
  }

  function updateLibraryProjectLabel() {
    const el = $("#libraryProjectName");
    if (!el) return;
    const state = getState();
    const pid = currentProjectId();
    const project = (state.projects || []).find((p) => p.id === pid);
    el.textContent = project?.name ? `for ${project.name}` : pid ? "for this project" : "";
  }

  function renderLibraryList() {
    const el = $("#libraryList");
    if (!el) return;
    const state = getState();
    const items = state.libraryItems || [];
    const panel = $("#projectLibrarySection");
    if (panel) panel.classList.toggle("has-items", items.length > 0);
    updateLibraryCount(items.length);
    if (!items.length) {
      el.innerHTML = '<p class="library-empty">No items in this project — drop files or click +</p>';
      return;
    }
    el.innerHTML = items
      .map((it) => {
        const preview = (it.preview || "").trim();
        return `
      <div class="library-card" data-id="${it.id}">
        <label class="library-card-check" title="参与生成/对话">
          <input type="checkbox" ${it.enabled !== false ? "checked" : ""} data-lib-toggle="${it.id}" />
        </label>
        <div class="library-card-body">
          <strong class="library-card-name" title="${escapeHtml(it.filename)}">${escapeHtml(it.filename)}</strong>
          <div class="library-card-meta">
            <span class="library-badge">${escapeHtml(libraryBadge(it.filename, it.source_url))}</span>
            <span class="library-card-stat">${escapeHtml(formatLibraryStat(it))}</span>
          </div>
          ${preview ? `<p class="library-card-preview">${escapeHtml(preview)}</p>` : ""}
        </div>
        <button type="button" class="library-card-del" data-lib-del="${it.id}" title="删除">×</button>
      </div>`;
      })
      .join("");
    el.querySelectorAll("[data-lib-toggle]").forEach((cb) => {
      cb.addEventListener("change", () => toggleLibraryItem(cb.dataset.libToggle, cb.checked));
    });
    el.querySelectorAll("[data-lib-del]").forEach((btn) => {
      btn.addEventListener("click", () => deleteLibraryItem(btn.dataset.libDel));
    });
  }

  function escapeHtml(s) {
    const d = document.createElement("div");
    d.textContent = s;
    return d.innerHTML;
  }

  async function addLibraryUrls(urls) {
    const state = getState();
    const pid = currentProjectId();
    if (!state.dataRoot || !state.localUserId || !pid) {
      throw new Error("请先登录并选择项目");
    }
    for (const url of urls) {
      await apiPublic("/api/library/add-url", {
        method: "POST",
        body: JSON.stringify({
          data_root: state.dataRoot,
          user_id: state.localUserId,
          project_id: pid,
          url,
        }),
      });
    }
    await loadLibrary();
  }

  async function uploadLibraryFiles(files) {
    const state = getState();
    const pid = currentProjectId();
    if (!state.dataRoot || !state.localUserId || !pid) {
      alert("请先登录并选择项目");
      return;
    }
    for (const file of files) {
      const fd = new FormData();
      fd.append("data_root", state.dataRoot);
      fd.append("user_id", state.localUserId);
      fd.append("project_id", pid);
      fd.append("file", file);
      const res = await fetch("/api/library/upload", { method: "POST", body: fd });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || res.statusText);
      }
    }
    await loadLibrary();
  }

  async function deleteLibraryItem(refId) {
    const state = getState();
    const pid = currentProjectId();
    await apiPublic(
      `/api/library/${refId}?data_root=${encodeURIComponent(state.dataRoot)}&user_id=${encodeURIComponent(state.localUserId)}&project_id=${encodeURIComponent(pid)}`,
      { method: "DELETE" }
    );
    await loadLibrary();
  }

  async function toggleLibraryItem(refId, enabled) {
    const state = getState();
    const pid = currentProjectId();
    await apiPublic("/api/library/toggle", {
      method: "POST",
      body: JSON.stringify({
        data_root: state.dataRoot,
        user_id: state.localUserId,
        project_id: pid,
        ref_id: refId,
        enabled,
      }),
    });
    await loadLibrary();
  }

  function setDocView(mode) {
    const state = getState();
    state.docViewMode = mode;
    const prev = $("#docPreview");
    const edit = $("#docEditor");
    const tabP = $("#docTabPreview");
    const tabE = $("#docTabEdit");
    if (mode === "edit") {
      prev?.setAttribute("hidden", "");
      edit?.removeAttribute("hidden");
      if (edit) edit.value = state.paper || "";
      tabP?.classList.remove("active");
      tabE?.classList.add("active");
    } else {
      edit?.setAttribute("hidden", "");
      prev?.removeAttribute("hidden");
      tabE?.classList.remove("active");
      tabP?.classList.add("active");
      if (window.__JOEKU_renderDocPreview) window.__JOEKU_renderDocPreview();
    }
  }

  function syncPaperFromEditor() {
    const state = getState();
    const edit = $("#docEditor");
    if (edit && state.docViewMode === "edit") {
      state.paper = edit.value;
      if (window.__JOEKU_persistCurrentProject) window.__JOEKU_persistCurrentProject();
      if (window.__JOEKU_saveProjects) window.__JOEKU_saveProjects();
    }
  }

  async function submitAnnotation() {
    const state = getState();
    if (state.docViewMode === "edit") syncPaperFromEditor();
    const comment = $("#annotationInput")?.value?.trim();
    if (!comment) {
      $("#annotationInput")?.focus();
      return;
    }

    let selectionText = activeTextSelection?.text || "";
    let paraId = activeTextSelection?.paraId || "0";
    if (!selectionText && state.docViewMode === "edit") {
      const edit = $("#docEditor");
      selectionText = edit?.value?.slice(edit.selectionStart, edit.selectionEnd).trim() || "";
      paraId = "0";
    }
    if (!selectionText) {
      alert("请先在右侧文档预览中选中一段文字，再写下批注。");
      return;
    }

    const annId = "ann_" + Date.now();
    $("#annotationInput").value = "";
    const submitBtn = $("#annotationSubmitBtn");
    if (submitBtn) submitBtn.disabled = true;

    annotationsList().push({
      id: annId,
      text: selectionText,
      comment,
      advice: "",
      paraId,
      streaming: true,
    });
    activeAnnotationId = annId;
    annotationsPanelOpen = true;
    clearParagraphSelection();
    renderAnnotationUI();

    let acc = "";
    let tick = 0;
    try {
      await fetchStream(
        "/api/revise-selection/stream",
        {
          paper: state.paper,
          selection: selectionText,
          selections: [selectionText],
          comment,
          ...localPayload(),
        },
        (tok) => {
          acc += tok;
          tick += 1;
          const ann = annotationById(annId);
          if (ann) ann.advice = acc;
          if (tick % 4 === 0) renderAnnotationUI();
        }
      );
      const ann = annotationById(annId);
      if (ann) {
        ann.advice = acc;
        ann.streaming = false;
      }
      if (window.__JOEKU_persistCurrentProject) window.__JOEKU_persistCurrentProject();
      if (window.__JOEKU_saveProjects) window.__JOEKU_saveProjects();
      renderAnnotationUI();
      if (window.__JOEKU_addTurn && acc.trim()) {
        const excerpt = parseSuggestedRevision(acc);
        const preview = excerpt.length > 320 ? `${excerpt.slice(0, 317)}…` : excerpt;
        window.__JOEKU_addTurn(
          "assistant",
          `**批注回复** · ${comment}\n\n> ${selectionText.slice(0, 160)}${selectionText.length > 160 ? "…" : ""}\n\n**建议修改：**\n${preview || acc.slice(0, 500)}`,
          { mode: "generate", markdown: true, revisionApply: !!excerpt, revisionAnnId: annId }
        );
      }
    } catch (e) {
      const ann = annotationById(annId);
      if (ann) {
        ann.streaming = false;
        ann.advice = `批注生成失败：${e.message}`;
      }
      renderAnnotationUI();
    } finally {
      if (submitBtn) submitBtn.disabled = false;
    }
  }

  async function streamStructureAnalysis() {
    const state = getState();
    if (!state.paper || state.paper.length < 50) return;
    const streamId = window.__JOEKU_addStreamingTurn?.("generate", {
      label: "Structure analysis",
      steps: ["Mapping sections…", "Checking flow…", "Drafting suggestions…"],
      answerOnly: true,
    });
    let acc = "";
    try {
      await fetchStream(
        "/api/analyze/structure/stream",
        { paper: state.paper, topic: state.topic || "" },
        (tok) => {
          acc += tok;
          if (streamId) window.__JOEKU_updateStreamingTurn?.(streamId, acc, "generate");
        }
      );
      if (streamId) window.__JOEKU_finalizeStreamingTurn?.(streamId, acc, "generate");
    } catch (e) {
      if (streamId) window.__JOEKU_finalizeStreamingTurn?.(streamId, `Analysis failed: ${e.message}`, "generate");
    }
  }

  function applyDataRoot(path) {
    const folder = (path || "").trim();
    if (!folder) return null;
    const state = getState();
    state.dataRoot = folder;
    localStorage.setItem(STORAGE_DATA_ROOT, folder);
    if ($("#loginDataRoot")) $("#loginDataRoot").value = folder;
    if ($("#loginDataRootHint")) $("#loginDataRootHint").textContent = folder;
    if ($("#settingsDataRoot")) $("#settingsDataRoot").value = folder;
    return folder;
  }

  async function validateDataRoot(path) {
    const folder = (path || "").trim();
    if (!folder) throw new Error("请输入或选择数据目录");
    const data = await apiPublic(`/api/local/status?data_root=${encodeURIComponent(folder)}`);
    if (!data.configured) throw new Error("数据目录无效");
    return folder;
  }

  async function pickDataRoot() {
    const data = await apiPublic("/api/pick-folder");
    const folder = data.folder || data.path;
    if (!folder) return null;
    applyDataRoot(folder);
    await renderIdentitySelect();
    return getState().dataRoot;
  }

  async function renderIdentitySelect() {
    const sel = $("#loginIdentity");
    if (!sel) return;
    const dataRoot = ($("#loginDataRoot")?.value || getState().dataRoot || "").trim();
    if (!dataRoot) {
      sel.disabled = true;
      sel.innerHTML = '<option value="">请先选择或输入数据目录</option>';
      onIdentityChange();
      return;
    }
    sel.disabled = false;
    const current = sel.value || getState().localUserId || "";
    sel.innerHTML = '<option value="">正在加载身份…</option>';
    try {
      await validateDataRoot(dataRoot);
      identityCache = await loadIdentities();
    } catch (err) {
      sel.disabled = true;
      sel.innerHTML = `<option value="">无法加载身份：${escapeHtml(err.message)}</option>`;
      throw err;
    }
    if (!identityCache.length) {
      sel.innerHTML = '<option value="">（暂无身份，请注册新身份）</option>';
      setLoginMode("register");
    } else {
      sel.innerHTML = identityCache
        .map(
          (u) =>
            `<option value="${u.user_id}">${escapeHtml(u.identity_name || u.display_name)}</option>`
        )
        .join("");
      if (current && [...sel.options].some((o) => o.value === current)) sel.value = current;
      else sel.selectedIndex = 0;
      setLoginMode("existing");
    }
    onIdentityChange();
  }

  function getLoginMode() {
    const active = document.querySelector(".login-mode-tab.active");
    return active?.dataset?.mode === "register" ? "register" : "existing";
  }

  function setLoginMode(mode) {
    const isRegister = mode === "register";
    document.querySelectorAll(".login-mode-tab").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.mode === (isRegister ? "register" : "existing"));
    });
    const existingBox = $("#loginExistingFields");
    const newBox = $("#loginNewIdentityFields");
    if (existingBox) existingBox.hidden = isRegister;
    if (newBox) {
      if (isRegister) newBox.removeAttribute("hidden");
      else newBox.setAttribute("hidden", "");
    }
    if (isRegister) {
      const sel = $("#loginIdentity");
      if (sel) sel.value = "";
      if ($("#loginDisplayName")) $("#loginDisplayName").value = "";
      if ($("#loginPersonaHint")) $("#loginPersonaHint").value = "";
    } else {
      onIdentityChange();
    }
  }

  function onIdentityChange() {
    if (getLoginMode() === "register") return;
    const sel = $("#loginIdentity");
    if (sel?.value) {
      const found = identityCache.find((u) => u.user_id === sel.value);
      if (found) {
        if ($("#loginDisplayName")) $("#loginDisplayName").value = found.identity_name || found.display_name || "";
        if ($("#loginPersonaHint")) $("#loginPersonaHint").value = found.persona_hint || "";
      }
    }
  }

  async function loadIdentities() {
    return loadExistingUsers();
  }

  async function registerLocalUser(displayName, personaHint) {
    const state = getState();
    const dataRoot = ($("#loginDataRoot")?.value || state.dataRoot || "").trim();
    if (!dataRoot) throw new Error("请先选择或输入本地数据目录");
    await validateDataRoot(dataRoot);
    state.dataRoot = dataRoot;
    localStorage.setItem(STORAGE_DATA_ROOT, dataRoot);
    const data = await apiPublic("/api/local/register", {
      method: "POST",
      body: JSON.stringify({
        data_root: dataRoot,
        display_name: displayName,
        persona_hint: personaHint || "",
      }),
    });
    state.localUserId = data.profile.user_id;
    state.displayName = data.profile.display_name || displayName;
    state.personaHint = data.profile.persona_hint || personaHint || "";
    localStorage.setItem(STORAGE_LOCAL_UID, state.localUserId);
    if (data.state?.projects) {
      state.projects = data.state.projects;
      state.currentProjectId = data.state.currentProjectId;
    }
    return data.profile;
  }

  async function loadExistingUsers() {
    const state = getState();
    const dataRoot = ($("#loginDataRoot")?.value || state.dataRoot || "").trim();
    if (!dataRoot) return [];
    const data = await apiPublic(`/api/local/users?data_root=${encodeURIComponent(dataRoot)}`);
    return data.users || [];
  }

  function bindLoginDataRootInput() {
    const input = $("#loginDataRoot");
    if (!input || input.dataset.bound) return;
    input.dataset.bound = "1";
    let timer = 0;
    input.addEventListener("input", () => {
      clearTimeout(timer);
      timer = setTimeout(async () => {
        const path = input.value.trim();
        if (!path) return;
        try {
          await validateDataRoot(path);
          applyDataRoot(path);
          await renderIdentitySelect();
        } catch (_) {}
      }, 500);
    });
  }

  function bindLibraryDropzone() {
    const zone = $("#sidebarLibraryDrop");
    const input = $("#libraryFileInput");
    if (!zone || zone.dataset.bound) return;
    zone.dataset.bound = "1";
    zone.addEventListener("click", () => input?.click());
    zone.addEventListener("dragover", (e) => {
      e.preventDefault();
      zone.classList.add("drag-over");
    });
    zone.addEventListener("dragleave", () => zone.classList.remove("drag-over"));
    zone.addEventListener("drop", (e) => {
      e.preventDefault();
      zone.classList.remove("drag-over");
      if (e.dataTransfer?.files?.length) uploadLibraryFiles([...e.dataTransfer.files]);
    });
    input?.addEventListener("change", (e) => {
      const files = e.target.files;
      if (files?.length) uploadLibraryFiles([...files]);
      e.target.value = "";
    });
  }

  function initExtendedState() {
    const state = getState();
    if (!state) return;
    state.dataRoot = localStorage.getItem(STORAGE_DATA_ROOT) || "";
    state.localUserId = localStorage.getItem(STORAGE_LOCAL_UID) || "";
    state.libraryItems = state.libraryItems || [];
    state.docViewMode = state.docViewMode || "preview";
  }

  async function tryLoadServerDefaultDataRoot() {
    // For cloud-hosted instances, the server can provide a DEFAULT_DATA_ROOT via env.
    // This lets users use the service without picking a local folder on their machine.
    try {
      const data = await apiPublic("/api/local/status");
      if (data && data.configured && data.data_root) {
        // If server provides a default (or previously set), prefer it over localStorage for hosted use
        if (data.server_default || !localStorage.getItem(STORAGE_DATA_ROOT)) {
          window.__JOEKU_SERVER_DEFAULT = true;
          applyDataRoot(data.data_root);
          return data.data_root;
        }
      }
    } catch (_) {
      // ignore, fall back to client-side picker
    }
    return null;
  }

  async function deleteProjectData(projectId) {
    const state = getState();
    if (!state.dataRoot || !state.localUserId || !projectId) return;
    await apiPublic("/api/local/project/delete", {
      method: "POST",
      body: JSON.stringify({
        data_root: state.dataRoot,
        user_id: state.localUserId,
        project_id: projectId,
      }),
    });
  }

  window.JoekuFeatures = {
    initExtendedState,
    deleteProjectData,
    syncStateToDisk,
    loadStateFromDisk,
    loadLibrary,
    updateLibraryProjectLabel,
    localPayload,
    enabledLibraryIds,
    setDocView,
    syncPaperFromEditor,
    submitAnnotation,
    bindDocParagraphSelection,
    clearParagraphSelection,
    renderAnnotationAnchors,
    renderAnnotationUI,
    toggleAnnotationsPanel,
    dismissAnnotation,
    applyAnnotationDirect,
    openAnnotationInChat,
    applyAnnotationRevision,
    splitPaperParagraphs,
    streamStructureAnalysis,
    pickDataRoot,
    applyDataRoot,
    validateDataRoot,
    tryLoadServerDefaultDataRoot,
    registerLocalUser,
    loadExistingUsers,
    loadIdentities,
    renderIdentitySelect,
    onIdentityChange,
    setLoginMode,
    getLoginMode,
    addLibraryUrls,
    fetchStream,
    renderLibraryList,
    bindLibraryDropzone,
    bindLoginDataRootInput,
  };
})();