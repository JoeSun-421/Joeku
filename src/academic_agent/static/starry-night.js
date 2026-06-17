/* The Starry Night (1889) — original painting base + slow sky vortex flow */
(function () {
  const canvas = document.createElement("canvas");
  canvas.id = "starryNight";
  document.body.prepend(canvas);
  const ctx = canvas.getContext("2d");

  const BASE_SRC = "/static/starry-night-base.jpg";
  const baseImg = new Image();
  baseImg.crossOrigin = "anonymous";
  baseImg.src = BASE_SRC;

  let W = 0,
    H = 0,
    dpr = 1,
    t0 = performance.now(),
    baseReady = false;

  /* Sky vortex anchors mapped to the painting composition */
  const VORTICES = [
    { nx: 0.2, ny: 0.26, r: 0.19, speed: 0.000022, phase: 0 },
    { nx: 0.52, ny: 0.2, r: 0.17, speed: -0.000018, phase: 1.4 },
    { nx: 0.74, ny: 0.17, r: 0.13, speed: 0.000016, phase: 2.8 },
    { nx: 0.36, ny: 0.44, r: 0.15, speed: 0.000014, phase: 0.9 },
  ];

  const SKY_CLIP = 0.72;

  function resize() {
    dpr = Math.min(devicePixelRatio || 1, 2);
    W = canvas.width = Math.floor(innerWidth * dpr);
    H = canvas.height = Math.floor(innerHeight * dpr);
    canvas.style.width = `${innerWidth}px`;
    canvas.style.height = `${innerHeight}px`;
  }

  function drawPainting() {
    if (!baseReady) {
      const g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, "#0c1e3a");
      g.addColorStop(1, "#0d1a12");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
      return;
    }

    const iw = baseImg.naturalWidth;
    const ih = baseImg.naturalHeight;
    const scale = Math.max(W / iw, H / ih);
    const dw = iw * scale;
    const dh = ih * scale;
    const dx = (W - dw) / 2;
    const dy = (H - dh) / 2;
    ctx.drawImage(baseImg, dx, dy, dw, dh);
  }

  function drawVortexFlow(v, time) {
    const cx = v.nx * W;
    const cy = v.ny * H;
    const baseR = v.r * Math.min(W, H);
    const rot = time * v.speed * 100 + v.phase;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(rot);
    for (let ring = 0; ring < 10; ring++) {
      ctx.beginPath();
      const rr = baseR * (0.12 + ring * 0.085);
      for (let a = 0; a <= Math.PI * 2; a += 0.03) {
        const wobble =
          Math.sin(a * 3.1 + ring * 0.5 + time * 0.00035) * rr * 0.42 +
          Math.cos(a * 1.7 - time * 0.0002 + v.phase) * rr * 0.18;
        const x = Math.cos(a) * (rr + wobble);
        const y = Math.sin(a) * (rr + wobble) * 0.72;
        if (a === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      const alpha = 0.06 + ring * 0.018;
      const hue = ring % 3;
      const stroke =
        hue === 0
          ? `rgba(28, 72, 128, ${alpha})`
          : hue === 1
            ? `rgba(42, 98, 155, ${alpha})`
            : `rgba(220, 195, 70, ${alpha * 0.55})`;
      ctx.strokeStyle = stroke;
      ctx.lineWidth = (2.2 + ring * 0.35) * dpr;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawStarPulse(time) {
    const stars = [
      { nx: 0.51, ny: 0.19 },
      { nx: 0.34, ny: 0.31 },
      { nx: 0.63, ny: 0.34 },
      { nx: 0.18, ny: 0.4 },
    ];
    for (const s of stars) {
      const sx = s.nx * W;
      const sy = s.ny * H;
      const pulse = 0.55 + Math.sin(time * 0.0012 + s.nx * 12) * 0.25;
      const r = 22 * dpr * pulse;
      const halo = ctx.createRadialGradient(sx, sy, 0, sx, sy, r);
      halo.addColorStop(0, `rgba(255, 244, 180, ${0.22 * pulse})`);
      halo.addColorStop(0.35, `rgba(255, 220, 100, ${0.08 * pulse})`);
      halo.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(sx, sy, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function frame(now) {
    const time = now - t0;
    drawPainting();

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, W, H * SKY_CLIP);
    ctx.clip();
    ctx.globalCompositeOperation = "screen";
    for (const v of VORTICES) drawVortexFlow(v, time);
    drawStarPulse(time);
    ctx.globalCompositeOperation = "source-over";
    ctx.restore();

    requestAnimationFrame(frame);
  }

  baseImg.onload = () => {
    baseReady = true;
  };
  baseImg.onerror = () => {
    baseReady = false;
  };

  addEventListener("resize", resize);
  resize();
  requestAnimationFrame(frame);
})();