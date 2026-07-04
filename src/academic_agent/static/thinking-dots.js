/* Grok-style dynamic agent trace — live ticker, collapsible thought */
(function () {
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const LIVE_VISIBLE = 3;
  const MAX_DISPLAY_STEPS = 4;

  const PHASES = [
    { id: "understand", label: "Understand", verb: "Understanding" },
    { id: "investigate", label: "Investigate", verb: "Investigating" },
    { id: "reason", label: "Reason", verb: "Reasoning" },
    { id: "respond", label: "Respond", verb: "Responding" },
  ];

  const PHASE_LABELS = Object.fromEntries(PHASES.map((p) => [p.id, p.label]));
  const PHASE_VERBS = Object.fromEntries(PHASES.map((p) => [p.id, p.verb]));

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
    status: "understand",
  };

  const STYLE = `
.thinking-dots{display:inline-grid;grid-template-columns:repeat(3,5px);grid-template-rows:repeat(3,5px);gap:2.5px;width:19px;height:19px;padding:0;vertical-align:middle;flex-shrink:0}
.thinking-dots span{width:5px;height:5px;border-radius:1.5px;background:rgba(147,197,253,.42);animation:think-cell 1.45s ease-in-out infinite}
.thinking-dots span:nth-child(1){animation-delay:0s}
.thinking-dots span:nth-child(2){animation-delay:.1s}
.thinking-dots span:nth-child(3){animation-delay:.2s}
.thinking-dots span:nth-child(4){animation-delay:.1s}
.thinking-dots span:nth-child(5){animation-delay:.2s}
.thinking-dots span:nth-child(6){animation-delay:.3s}
.thinking-dots span:nth-child(7){animation-delay:.2s}
.thinking-dots span:nth-child(8){animation-delay:.3s}
.thinking-dots span:nth-child(9){animation-delay:.4s}
@keyframes think-cell{0%,100%{opacity:.22;transform:scale(.82);background:rgba(120,170,240,.28)}50%{opacity:1;transform:scale(1);background:rgba(186,230,253,.98)}}
.thinking-row .msg-bubble{min-height:28px;padding:10px 14px;max-width:min(94%,54rem)}
.think-panel{display:flex;flex-direction:column;gap:0}
.think-header{display:flex;align-items:center;gap:8px;width:100%;padding:0;margin:0;border:none;background:none;font:inherit;text-align:left;cursor:pointer;color:inherit}
.think-header:disabled{cursor:default}
.think-header-title{font-size:12px;font-weight:600;color:rgba(186,230,253,.95);flex-shrink:0}
.think-header-title.is-live{background:linear-gradient(90deg,rgba(186,230,253,.55),rgba(147,197,253,1),rgba(186,230,253,.55));background-size:200% 100%;-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;animation:think-shimmer 2.2s ease-in-out infinite}
@keyframes think-shimmer{0%{background-position:100% 0}100%{background-position:-100% 0}}
.think-live-action{flex:1;min-width:0;font-size:12px;color:var(--text-2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;transition:opacity .2s var(--ease-fluid)}
.think-live-action.is-changing{opacity:.45}
.think-meta{font-size:11px;color:var(--text-3);font-variant-numeric:tabular-nums;flex-shrink:0}
.think-chevron{font-size:10px;color:var(--text-3);transition:transform .22s var(--ease-fluid);flex-shrink:0}
.think-panel.is-collapsed .think-chevron{transform:rotate(-90deg)}
.think-details{display:flex;flex-direction:column;gap:8px;margin-top:8px;overflow:hidden;max-height:32rem;opacity:1;transition:max-height .3s var(--ease-fluid),opacity .22s,margin-top .22s}
.think-panel.is-collapsed .think-details{max-height:0;opacity:0;margin-top:0;pointer-events:none}
.think-panel:not(.done) .think-details{display:none}
.think-feed-label{font-size:10px;font-weight:600;letter-spacing:.04em;color:var(--text-3);margin-top:4px}
.think-feed{display:flex;flex-direction:column;gap:2px;max-height:6.5rem;overflow:auto}
.think-panel .think-feed{max-height:5.5rem}
.think-panel:not(.done) .think-feed,.think-panel:not(.done) .think-feed-label{display:none}
.think-panel.done:not(.expanded-trace) .think-feed,.think-panel.done:not(.expanded-trace) .think-feed-label{display:none}
.think-panel.done.expanded-trace .think-details{max-height:40rem}
.think-feed-item{display:flex;align-items:baseline;gap:7px;font-size:11.5px;line-height:1.4;color:var(--text-3);opacity:.78}
.think-feed-item.is-active{color:var(--text);opacity:1}
.think-feed-item.is-active .think-feed-text{font-weight:500}
.think-feed-icon{flex-shrink:0;width:14px;text-align:center;font-size:9px;font-weight:700;opacity:.85;font-family:ui-monospace,monospace}
.think-feed-text{flex:1;min-width:0}
.think-feed-detail{font-size:11px;color:var(--text-3)}
.think-feed-link{font-size:11px;color:rgba(147,197,253,.95);text-decoration:none;margin-left:4px}
.think-feed-link:hover{text-decoration:underline}
.think-answer{margin-top:12px;padding-top:12px;border-top:1px solid rgba(255,255,255,.08)}
.think-answer:empty{display:none}
.think-panel.done .think-header-title.is-live{-webkit-text-fill-color:rgba(186,230,253,.85);background:none;animation:none}
.think-panel.done .thinking-dots,.think-panel.done .thinking-dots span{animation:none!important;opacity:0!important;transform:scale(.7)!important}
.ds-turn{display:flex;flex-direction:column;gap:10px;width:100%}
.ds-reasoning{border-radius:12px;background:rgba(15,23,42,.42);border:1px solid rgba(148,163,184,.14);overflow:hidden}
.ds-reasoning .think-panel{padding:10px 12px 12px}
.ds-answer{width:100%}
.ds-answer .msg-prose,.ds-answer-body{font-size:14.5px;line-height:1.72}
.msg-row.assistant .msg-bubble:has(.ds-turn){max-width:min(94%,54rem)}
.gen-progress-panel{display:flex;flex-direction:column;gap:10px;padding:10px 12px;border-radius:12px;background:rgba(15,23,42,.5);border:1px solid rgba(96,165,250,.18)}
.gen-progress-head{display:flex;align-items:center;gap:8px}
.gen-progress-title{flex:1;min-width:0;font-size:12.5px;font-weight:600;color:rgba(186,230,253,.96);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.gen-progress-pct{font-size:11px;font-weight:600;font-variant-numeric:tabular-nums;color:rgba(148,163,184,.95)}
.gen-section-now{font-size:13px;color:var(--text);line-height:1.45}
.gen-section-now strong{color:rgba(224,242,254,.98);font-weight:650}
.gen-progress-bar{height:4px;border-radius:999px;background:rgba(255,255,255,.08);overflow:hidden}
.gen-progress-fill{height:100%;border-radius:999px;background:linear-gradient(90deg,rgba(56,189,248,.75),rgba(129,140,248,.9));transition:width .35s var(--ease-fluid)}
.gen-section-outline{display:flex;flex-direction:column;gap:4px;margin:0;padding:0;list-style:none;max-height:11rem;overflow:auto}
.gen-sec{display:flex;align-items:center;gap:8px;font-size:12px;line-height:1.4;color:var(--text-3);padding:3px 0}
.gen-sec-dot{width:7px;height:7px;border-radius:2px;background:rgba(148,163,184,.35);flex-shrink:0}
.gen-sec.is-writing .gen-sec-dot{background:rgba(96,165,250,.95);box-shadow:0 0 8px rgba(96,165,250,.55);animation:think-cell 1.2s ease-in-out infinite}
.gen-sec.is-done .gen-sec-dot{background:rgba(52,211,153,.85)}
.gen-sec.is-done .gen-sec-name{color:var(--text-2)}
.gen-sec.is-writing .gen-sec-name{color:rgba(224,242,254,.96);font-weight:550}
.gen-step-log{display:flex;flex-direction:column;gap:2px;margin:0;padding:0;list-style:none;max-height:10rem;overflow:auto}
.gen-step-log li{display:flex;align-items:baseline;gap:8px;font-size:11.5px;line-height:1.45;color:var(--text-3);padding:2px 0}
.gen-step-log li::before{content:"";width:6px;height:6px;border-radius:2px;background:rgba(148,163,184,.35);flex-shrink:0}
.gen-step-log li.is-active{color:rgba(224,242,254,.95);font-weight:550}
.gen-step-log li.is-active::before{background:rgba(96,165,250,.95);box-shadow:0 0 6px rgba(96,165,250,.5)}
.gen-step-log li.is-done::before{background:rgba(52,211,153,.8)}
.gen-step-log li.is-done{color:var(--text-2)}
`;

  const style = document.createElement("style");
  style.textContent = STYLE;
  document.head.appendChild(style);

  function escapeText(s) {
    const d = document.createElement("div");
    d.textContent = String(s ?? "");
    return d.innerHTML;
  }

  function normalizeStep(raw) {
    if (!raw) return null;
    if (typeof raw === "string") return { type: "status", label: raw, detail: "", url: "", phase: "understand" };
    const type = raw.type === "reasoning" ? "plan" : raw.type || "status";
    const phase = raw.phase || TYPE_PHASE[type] || "understand";
    return {
      type,
      label: raw.label || raw.text || String(raw),
      detail: raw.detail || "",
      url: raw.url || "",
      phase,
    };
  }

  function stepIcon(type) {
    const map = {
      parse: "◎",
      context: "≡",
      mode: "◉",
      read: "R",
      grep: "⌕",
      tool: "⚙",
      search: "⌁",
      analyze: "◈",
      plan: "◆",
      write: "✎",
      process: "◎",
      status: "·",
    };
    return map[type] || "·";
  }

  function stepKey(s) {
    return `${s.phase}|${s.type}|${s.label}|${s.detail}|${s.url}`;
  }

  function dotsHtml() {
    return `<span class="thinking-dots" aria-hidden="true">${"<span></span>".repeat(9)}</span>`;
  }

  function currentPhaseId(steps, done, opts = {}) {
    if (opts.streaming && !done) return "reason";
    if (!steps.length) return done ? "" : "understand";
    const last = steps[steps.length - 1];
    return last.phase || TYPE_PHASE[last.type] || "understand";
  }

  function displaySteps(opts = {}) {
    const steps = (opts.steps || []).map(normalizeStep).filter(Boolean);
    const seen = new Set();
    const out = [];
    for (const s of steps) {
      if (s.type === "write" || s.phase === "respond") continue;
      const key = `${s.label}|${s.detail}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(s);
    }
    return out.slice(-MAX_DISPLAY_STEPS);
  }

  function detailsHtml(opts = {}) {
    if (!opts.done) return "";
    const steps = displaySteps(opts);
    const feed = steps.length ? feedHtml({ ...opts, steps }) : "";
    const feedLabel = feed ? '<div class="think-feed-label">关键步骤</div>' : "";
    if (!feed) return "";
    return `<div class="think-details" data-think-details>${feedLabel}${feed}</div>`;
  }

  function formatElapsed(ms) {
    if (!ms || ms < 0) return "";
    const s = ms / 1000;
    return s < 10 ? `${s.toFixed(1)}s` : `${Math.round(s)}s`;
  }

  function feedItemHtml(step, { active = false, animate = false } = {}) {
    const s = normalizeStep(step);
    if (!s) return "";
    const cls = [
      "think-feed-item",
      active ? "is-active" : "",
      animate && !reducedMotion ? "is-new" : "",
      reducedMotion ? "reduced" : "",
    ]
      .filter(Boolean)
      .join(" ");
    const detail = s.detail && !s.url ? `<span class="think-feed-detail"> · ${escapeText(s.detail)}</span>` : "";
    const link = s.url
      ? `<a class="think-feed-link" href="${escapeText(s.url)}" target="_blank" rel="noopener">${escapeText(s.detail || s.url)}</a>`
      : "";
    return `<div class="${cls}" data-step-key="${escapeText(stepKey(s))}" data-phase="${escapeText(s.phase)}">
      <span class="think-feed-icon" aria-hidden="true">${stepIcon(s.type)}</span>
      <span class="think-feed-text">${escapeText(s.label)}${link || detail}</span>
    </div>`;
  }

  function visibleSteps(steps, live) {
    if (!live) return steps;
    return steps.slice(-LIVE_VISIBLE);
  }

  function clipLiveAction(text, max = 44) {
    const t = String(text || "").replace(/\s+/g, " ").trim();
    if (!t) return "";
    if (t.length > max) return "推理中…";
    return t;
  }

  function headerHtml(opts, steps) {
    const done = !!opts.done;
    const live = !!opts.showDots && !done;
    const collapsed = !!opts.collapsed && done;
    const phaseId = currentPhaseId(steps, done, opts);
    const last = steps[steps.length - 1];
    const liveAction = clipLiveAction(
      opts.liveAction || last?.label || PHASE_VERBS[phaseId] || "处理中…"
    );
    const stepCount = steps.length;
    const elapsed = formatElapsed(opts.elapsedMs);

    if (done) {
      const parts = [];
      if (elapsed) parts.push(elapsed);
      const meta = parts.join(" · ");
      return `<button type="button" class="think-header" data-think-toggle aria-expanded="${!collapsed}">
        <span class="think-header-title">思考过程</span>
        ${meta ? `<span class="think-meta">${escapeText(meta)}</span>` : ""}
        <span class="think-chevron" aria-hidden="true">⌄</span>
      </button>`;
    }

    return `<div class="think-header" aria-live="polite">
      ${dotsHtml()}
      <span class="think-header-title${live ? " is-live" : ""}">思考中</span>
      <span class="think-live-action" data-live-action>${escapeText(liveAction)}</span>
    </div>`;
  }

  function feedHtml(opts = {}) {
    const steps = (opts.steps || []).map(normalizeStep).filter(Boolean);
    if (!steps.length) return "";
    const done = !!opts.done;
    const live = !done && !!opts.showDots;
    const shown = visibleSteps(steps, live);
    const lastKey = steps.length ? stepKey(steps[steps.length - 1]) : "";
    return `<div class="think-feed" data-think-feed>
      ${shown.map((s) => feedItemHtml(s, { active: stepKey(s) === lastKey, animate: false })).join("")}
    </div>`;
  }

  function genStepLogHtml(opts = {}) {
    const log = Array.isArray(opts.genStepLog) ? opts.genStepLog : [];
    if (!log.length) return "";
    return `<ol class="gen-step-log">${log
      .map((s) => {
        const cls = s.active ? "is-active" : s.done ? "is-done" : "";
        const pct = typeof s.percent === "number" ? ` · ${s.percent}%` : "";
        return `<li class="${cls}">${escapeText((s.label || "") + pct)}</li>`;
      })
      .join("")}</ol>`;
  }

  function genProgressHtml(opts = {}) {
    const pct = typeof opts.percent === "number" ? Math.max(0, Math.min(100, opts.percent)) : 0;
    const current = (opts.sectionCurrent || "").trim();
    const plan = Array.isArray(opts.sectionsPlan) ? opts.sectionsPlan : [];
    const title = (opts.genStepLabel || opts.liveAction || "撰写中").trim();
    const stepLog = genStepLogHtml(opts);
    const list = plan
      .map((s) => {
        const st = s.status || "pending";
        const cls = st === "done" ? "is-done" : st === "writing" ? "is-writing" : "is-pending";
        return `<li class="gen-sec ${cls}"><span class="gen-sec-dot" aria-hidden="true"></span><span class="gen-sec-name">${escapeText(s.heading || "")}</span></li>`;
      })
      .join("");
    return `<div class="gen-progress-panel" data-gen-panel>
      <div class="gen-progress-head">
        ${dotsHtml()}
        <span class="gen-progress-title">${escapeText(title)}</span>
        <span class="gen-progress-pct">${pct}%</span>
      </div>
      ${current ? `<div class="gen-section-now">正在撰写：<strong>${escapeText(current)}</strong></div>` : ""}
      <div class="gen-progress-bar" aria-hidden="true"><div class="gen-progress-fill" style="width:${pct}%"></div></div>
      ${stepLog}
      ${list ? `<ol class="gen-section-outline">${list}</ol>` : ""}
    </div>`;
  }

  function syncGenPanel(bubble, opts) {
    let panel = bubble.querySelector("[data-gen-panel]");
    if (!opts.progress) {
      panel?.remove();
      return;
    }
    const html = genProgressHtml(opts);
    if (!panel) {
      bubble.insertAdjacentHTML("afterbegin", html);
      return;
    }
    const pct = typeof opts.percent === "number" ? opts.percent : 0;
    const title = panel.querySelector(".gen-progress-title");
    const pctEl = panel.querySelector(".gen-progress-pct");
    const fill = panel.querySelector(".gen-progress-fill");
    const now = panel.querySelector(".gen-section-now");
    const outline = panel.querySelector(".gen-section-outline");
    let stepLog = panel.querySelector(".gen-step-log");
    if (title) title.textContent = (opts.genStepLabel || opts.liveAction || "撰写中").trim();
    if (pctEl) pctEl.textContent = `${pct}%`;
    if (fill) fill.style.width = `${Math.max(0, Math.min(100, pct))}%`;
    const current = (opts.sectionCurrent || "").trim();
    if (current) {
      if (!now) {
        panel.querySelector(".gen-progress-bar")?.insertAdjacentHTML(
          "beforebegin",
          `<div class="gen-section-now">正在撰写：<strong>${escapeText(current)}</strong></div>`
        );
      } else {
        now.innerHTML = `正在撰写：<strong>${escapeText(current)}</strong>`;
      }
    } else if (now) {
      now.remove();
    }
    const logHtml = genStepLogHtml(opts);
    if (logHtml) {
      if (!stepLog) {
        panel.querySelector(".gen-progress-bar")?.insertAdjacentHTML("afterend", logHtml);
        stepLog = panel.querySelector(".gen-step-log");
      } else {
        stepLog.outerHTML = logHtml;
        stepLog = panel.querySelector(".gen-step-log");
      }
    } else if (stepLog) {
      stepLog.remove();
    }
    const plan = Array.isArray(opts.sectionsPlan) ? opts.sectionsPlan : [];
    if (plan.length) {
      const listHtml = plan
        .map((s) => {
          const st = s.status || "pending";
          const cls = st === "done" ? "is-done" : st === "writing" ? "is-writing" : "is-pending";
          return `<li class="gen-sec ${cls}"><span class="gen-sec-dot"></span><span class="gen-sec-name">${escapeText(s.heading || "")}</span></li>`;
        })
        .join("");
      if (!outline) {
        panel.insertAdjacentHTML("beforeend", `<ol class="gen-section-outline">${listHtml}</ol>`);
      } else {
        outline.innerHTML = listHtml;
      }
    } else if (outline) {
      outline.remove();
    }
  }

  function panelHtml(opts = {}) {
    if (opts.progress) return genProgressHtml(opts);
    const steps = displaySteps(opts);
    const done = !!opts.done;
    const collapsed = !!opts.collapsed && done;
    return `<div class="think-panel${done ? " done" : ""}${collapsed ? " is-collapsed" : ""}${opts.tickerExpanded ? " expanded-trace" : ""}" data-think-panel>
      ${headerHtml(opts, steps)}
      ${detailsHtml(opts)}
    </div>`;
  }

  function bindToggle(root) {
    root.querySelectorAll("[data-think-toggle]").forEach((btn) => {
      if (btn.dataset.bound) return;
      btn.dataset.bound = "1";
      btn.addEventListener("click", () => {
        const panel = btn.closest("[data-think-panel]");
        if (!panel) return;
        const collapsed = panel.classList.toggle("is-collapsed");
        panel.classList.toggle("expanded-trace", !collapsed);
        btn.setAttribute("aria-expanded", String(!collapsed));
      });
    });
  }

  function ensureAnswerBlock(bubble, answerHtml) {
    let block = bubble.querySelector(".ds-answer,.think-answer");
    if (!answerHtml) {
      block?.remove();
      return;
    }
    if (!block) {
      block = document.createElement("div");
      block.className = "ds-answer";
      bubble.appendChild(block);
    } else if (!block.classList.contains("ds-answer")) {
      block.className = "ds-answer";
    }
    if (block.innerHTML !== answerHtml) block.innerHTML = answerHtml;
  }

  function syncHeader(panel, opts, steps) {
    const done = !!opts.done;
    const collapsed = !!opts.collapsed && done;
    const phaseId = currentPhaseId(steps, done, opts);
    const last = steps[steps.length - 1];
    const liveAction = clipLiveAction(opts.liveAction || last?.label || "处理中…");

    panel.classList.toggle("done", done);
    panel.classList.toggle("is-collapsed", collapsed);
    panel.classList.toggle("expanded-trace", (!collapsed && (done || opts.tickerExpanded)));

    let head = panel.querySelector(".think-header,[data-think-toggle]");
    if (!head) {
      panel.insertAdjacentHTML("afterbegin", headerHtml(opts, steps));
      bindToggle(panel.closest(".msg-bubble") || panel);
      return;
    }

    if (done) {
      if (!head.matches("[data-think-toggle]")) {
        head.outerHTML = headerHtml(opts, steps);
        bindToggle(panel.closest(".msg-bubble") || panel);
        return;
      }
      const meta = head.querySelector(".think-meta");
      const stepCount = steps.length;
      const elapsed = formatElapsed(opts.elapsedMs);
      const parts = [];
      if (elapsed) parts.push(elapsed);
      const metaText = parts.join(" · ");
      if (meta) meta.textContent = metaText;
      head.setAttribute("aria-expanded", String(!collapsed));
      return;
    }

    const dots = head.querySelector(".thinking-dots");
    if (opts.showDots && !dots) {
      head.insertAdjacentHTML("afterbegin", dotsHtml());
    } else if (!opts.showDots && dots) {
      dots.remove();
    }

    const actionEl = head.querySelector("[data-live-action]");
    if (actionEl && liveAction && actionEl.textContent !== liveAction) {
      actionEl.classList.add("is-changing");
      actionEl.textContent = liveAction;
      window.setTimeout(() => actionEl.classList.remove("is-changing"), 180);
    }
  }

  function syncDetails(panel, opts, steps) {
    panel.querySelector("[data-think-prose]")?.remove();
    if (!opts.done) {
      panel.querySelector("[data-think-details]")?.remove();
      return;
    }
    const display = displaySteps({ ...opts, steps });
    let details = panel.querySelector("[data-think-details]");
    if (!display.length) {
      details?.remove();
      return;
    }
    if (!details) {
      panel.insertAdjacentHTML("beforeend", detailsHtml({ ...opts, steps: display }));
      details = panel.querySelector("[data-think-details]");
      bindToggle(panel.closest(".msg-bubble") || panel);
    }
    let feed = panel.querySelector("[data-think-feed]");
    let label = panel.querySelector(".think-feed-label");
    if (!feed) {
      const wrap = details || panel;
      wrap.insertAdjacentHTML("beforeend", '<div class="think-feed-label">关键步骤</div>' + feedHtml({ ...opts, steps: display }));
      feed = panel.querySelector("[data-think-feed]");
    } else if (!label) {
      feed.insertAdjacentHTML("beforebegin", '<div class="think-feed-label">关键步骤</div>');
    }
    if (feed) syncFeed(feed, display, opts);
  }

  function syncFeed(feed, steps, opts) {
    const normalized = steps.map(normalizeStep).filter(Boolean);
    const done = !!opts.done;
    const live = !done && !!opts.showDots;
    const shown = visibleSteps(normalized, live);
    const lastKey = normalized.length ? stepKey(normalized[normalized.length - 1]) : "";

    const lineByKey = new Map();
    feed.querySelectorAll(".think-feed-item").forEach((el) => {
      lineByKey.set(el.dataset.stepKey || "", el);
    });

    const wantKeys = new Set(shown.map((s) => stepKey(s)));
    lineByKey.forEach((el, key) => {
      if (!wantKeys.has(key)) el.remove();
    });

    shown.forEach((s) => {
      const key = stepKey(s);
      const safeKey = (window.CSS && CSS.escape ? CSS.escape(key) : key.replace(/\\/g, "\\\\").replace(/"/g, '\\"'));
      let line = feed.querySelector(`[data-step-key="${safeKey}"]`);
      const isActive = key === lastKey;
      if (!line) {
        const wrap = document.createElement("div");
        wrap.innerHTML = feedItemHtml(s, { active: isActive, animate: true });
        line = wrap.firstElementChild;
        feed.appendChild(line);
      } else {
        line.classList.toggle("is-active", isActive);
      }
    });

    if (live && feed.lastElementChild) {
      feed.lastElementChild.scrollIntoView({ block: "nearest", behavior: reducedMotion ? "auto" : "smooth" });
    }
  }

  function renderBubble(bubble, opts = {}, answerHtml = "") {
    if (!bubble) return;
    const reasoning = opts.progress ? panelHtml(opts) : `<div class="ds-reasoning">${panelHtml(opts)}</div>`;
    bubble.innerHTML = `<div class="ds-turn">${reasoning}${answerHtml ? `<div class="ds-answer">${answerHtml}</div>` : ""}</div>`;
    bindToggle(bubble);
  }

  function patchBubble(bubble, opts = {}, answerHtml = "") {
    if (!bubble) return false;
    if (opts.progress) {
      if (!bubble.querySelector(".ds-turn")) {
        renderBubble(bubble, opts, answerHtml);
        return true;
      }
      syncGenPanel(bubble, opts);
      ensureAnswerBlock(bubble, answerHtml);
      return true;
    }
    let panel = bubble.querySelector("[data-think-panel]");
    if (!panel) {
      renderBubble(bubble, opts, answerHtml);
      return true;
    }
    const steps = displaySteps(opts);
    syncHeader(panel, opts, steps);
    syncDetails(panel, opts, steps);
    ensureAnswerBlock(bubble, answerHtml);
    return true;
  }

  window.JoekuThinking = {
    dotsHtml,
    panelHtml,
    renderBubble,
    patchBubble,
    currentPhaseId,
    PHASE_LABELS,
    updateAnswerOnly(bubble, answerHtml) {
      if (!bubble) return;
      ensureAnswerBlock(bubble, answerHtml || "");
    },
    attach(bubble, opts) {
      renderBubble(bubble, { label: "Agent", ...(opts || {}) });
    },
    updateBubble(bubble, opts, answerHtml) {
      if (!patchBubble(bubble, opts, answerHtml)) renderBubble(bubble, opts, answerHtml);
    },
  };
})();