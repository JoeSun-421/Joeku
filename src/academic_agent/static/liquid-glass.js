/* iOS-style liquid glass — frosted shimmer + tactile press feedback */
(function () {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  const panels = () => document.querySelectorAll(".panel-liquid:not([data-liquid-bound])");

  function bindTactile(el) {
    if (!el || el.dataset.touchBound) return;
    el.dataset.touchBound = "1";
    const press = () => {
      el.classList.add("glass-pressed");
      if (navigator.vibrate) {
        try {
          navigator.vibrate(10);
        } catch (_) {}
      }
    };
    const release = () => el.classList.remove("glass-pressed");
    el.addEventListener("pointerdown", press);
    el.addEventListener("pointerup", release);
    el.addEventListener("pointercancel", release);
    el.addEventListener("pointerleave", release);
  }

  function scanTactile() {
    document.querySelectorAll(".glass-touch, .panel-liquid, .composer-card, .codex-action, .glass-picker-btn").forEach(bindTactile);
  }

  function bindPanel(el) {
    el.dataset.liquidBound = "1";
    bindTactile(el);
    const canvas = document.createElement("canvas");
    canvas.className = "liquid-glass-canvas";
    canvas.setAttribute("aria-hidden", "true");
    el.insertBefore(canvas, el.firstChild);
    const ctx = canvas.getContext("2d", { alpha: true });
    let w = 0;
    let h = 0;
    let dpr = 1;
    let raf = 0;
    let t0 = performance.now();
    let visible = true;

    function resize() {
      dpr = Math.min(devicePixelRatio || 1, 2);
      const rect = el.getBoundingClientRect();
      w = Math.max(1, Math.floor(rect.width * dpr));
      h = Math.max(1, Math.floor(rect.height * dpr));
      canvas.width = w;
      canvas.height = h;
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
    }

    function draw(now) {
      if (!visible) {
        raf = requestAnimationFrame(draw);
        return;
      }
      const t = (now - t0) * 0.00015;
      ctx.clearRect(0, 0, w, h);

      const border = Math.max(1.5 * dpr, 2);
      const inset = border / 2;
      const innerW = w - border;
      const innerH = h - border;
      if (innerW <= 2 || innerH <= 2) {
        raf = requestAnimationFrame(draw);
        return;
      }

      const rad = borderRadiusPx(el, dpr);

      const topGlow = ctx.createLinearGradient(0, 0, 0, h * 0.35);
      topGlow.addColorStop(0, "rgba(255, 255, 255, 0.18)");
      topGlow.addColorStop(1, "rgba(255, 255, 255, 0)");
      ctx.fillStyle = topGlow;
      roundRect(ctx, inset, inset, innerW, innerH, rad);
      ctx.fill();

      const sweep = (Math.sin(t) + 1) * 0.5;
      const edgeGrad = ctx.createLinearGradient(0, 0, w, h);
      edgeGrad.addColorStop(0, `rgba(255, 255, 255, ${0.12 + sweep * 0.08})`);
      edgeGrad.addColorStop(sweep, `rgba(255, 255, 255, ${0.28 + sweep * 0.06})`);
      edgeGrad.addColorStop(1, `rgba(255, 255, 255, ${0.1 + (1 - sweep) * 0.06})`);
      ctx.strokeStyle = edgeGrad;
      ctx.lineWidth = border;
      roundRect(ctx, inset, inset, innerW, innerH, rad);
      ctx.stroke();

      ctx.strokeStyle = `rgba(255, 255, 255, ${0.04 + Math.sin(t * 0.7) * 0.02})`;
      ctx.lineWidth = border * 0.5;
      roundRect(ctx, inset + border, inset + border, innerW - border * 2, innerH - border * 2, Math.max(0, rad - border));
      ctx.stroke();

      raf = requestAnimationFrame(draw);
    }

    function borderRadiusPx(node, scale) {
      const br = getComputedStyle(node).borderRadius || "16px";
      const token = br.split(/\s+/).find((t) => t && t !== "0" && t !== "0px") || "16px";
      if (token.endsWith("%")) {
        const rect = node.getBoundingClientRect();
        const pct = parseFloat(token) / 100;
        return Math.max(0, Math.min(rect.width, rect.height) * pct * scale);
      }
      const px = parseFloat(token);
      return Number.isFinite(px) ? Math.max(0, px * scale) : 16 * scale;
    }

    function roundRect(c, x, y, width, height, radius) {
      if (width <= 0 || height <= 0) return;
      const r = Math.max(0, Math.min(radius, width / 2, height / 2));
      c.beginPath();
      if (r < 0.5) {
        c.rect(x, y, width, height);
        c.closePath();
        return;
      }
      c.moveTo(x + r, y);
      c.arcTo(x + width, y, x + width, y + height, r);
      c.arcTo(x + width, y + height, x, y + height, r);
      c.arcTo(x, y + height, x, y, r);
      c.arcTo(x, y, x + width, y, r);
      c.closePath();
    }

    let resizeQueued = 0;
    function scheduleResize() {
      if (resizeQueued) return;
      resizeQueued = requestAnimationFrame(() => {
        resizeQueued = 0;
        resize();
      });
    }
    const ro = new ResizeObserver(scheduleResize);
    ro.observe(el);
    scheduleResize();
    raf = requestAnimationFrame(draw);

    const io = new IntersectionObserver((entries) => {
      visible = entries[0]?.isIntersecting !== false;
    });
    io.observe(el);

    return () => {
      cancelAnimationFrame(raf);
      if (resizeQueued) cancelAnimationFrame(resizeQueued);
      ro.disconnect();
      io.disconnect();
      canvas.remove();
      delete el.dataset.liquidBound;
    };
  }

  function scan() {
    panels().forEach(bindPanel);
    scanTactile();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", scan);
  } else {
    scan();
  }

  const mo = new MutationObserver(scan);
  mo.observe(document.documentElement, { childList: true, subtree: true });
})();