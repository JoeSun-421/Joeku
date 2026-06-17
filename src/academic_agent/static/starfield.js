/* Pure black starfield — white stars only */
(function () {
  const canvas = document.getElementById("starfield");
  if (!canvas) return;

  const ctx = canvas.getContext("2d");
  let stars = [];
  let w = 0;
  let h = 0;
  let mouseX = 0.5;
  let mouseY = 0.5;

  function resize() {
    w = canvas.width = window.innerWidth * devicePixelRatio;
    h = canvas.height = window.innerHeight * devicePixelRatio;
    canvas.style.width = `${window.innerWidth}px`;
    canvas.style.height = `${window.innerHeight}px`;
    const count = Math.floor((w * h) / 12000);
    stars = Array.from({ length: count }, () => ({
      x: Math.random() * w,
      y: Math.random() * h,
      z: Math.random() * 1.2 + 0.2,
      r: Math.random() * 1 + 0.2,
      tw: Math.random() * Math.PI * 2,
      spd: Math.random() * 0.12 + 0.03,
    }));
  }

  function draw(t) {
    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, w, h);

    const driftX = (mouseX - 0.5) * 10 * devicePixelRatio;
    const driftY = (mouseY - 0.5) * 8 * devicePixelRatio;

    for (const s of stars) {
      s.y += s.spd * s.z * devicePixelRatio;
      s.x += Math.sin(t * 0.0003 + s.tw) * 0.05 * devicePixelRatio;
      if (s.y > h) {
        s.y = 0;
        s.x = Math.random() * w;
      }

      const flicker = 0.35 + Math.sin(t * 0.002 + s.tw) * 0.3;
      const alpha = flicker * s.z * 0.5;
      ctx.fillStyle = `rgba(255,255,255,${alpha})`;
      ctx.beginPath();
      ctx.arc(
        s.x + driftX * s.z * 0.08,
        s.y + driftY * s.z * 0.06,
        s.r * devicePixelRatio,
        0,
        Math.PI * 2
      );
      ctx.fill();
    }

    requestAnimationFrame(draw);
  }

  window.addEventListener("resize", resize);
  window.addEventListener("mousemove", (e) => {
    mouseX = e.clientX / window.innerWidth;
    mouseY = e.clientY / window.innerHeight;
  });

  resize();
  requestAnimationFrame(draw);
})();