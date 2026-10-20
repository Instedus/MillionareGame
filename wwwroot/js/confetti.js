/* ============================================================
   Конфетти — лёгкая частицевая система на canvas.
   ============================================================ */
const Confetti = (() => {
  const canvas = document.getElementById('confetti-canvas');
  const ctx2d = canvas.getContext('2d');
  let parts = [];
  let raf = null;
  let dpr = 1;

  const COLORS = ['#ffd76a', '#f0b429', '#ffffff', '#4d7cff', '#2dd16a', '#ff4d5e', '#b96bff'];

  function resize() {
    dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(window.innerWidth * dpr);
    canvas.height = Math.floor(window.innerHeight * dpr);
    canvas.style.width = window.innerWidth + 'px';
    canvas.style.height = window.innerHeight + 'px';
    ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  window.addEventListener('resize', resize);
  resize();

  function makePart(x, y, opts = {}) {
    const angle = opts.angle !== undefined ? opts.angle : Math.random() * Math.PI * 2;
    const speed = opts.speed !== undefined ? opts.speed : 4 + Math.random() * 8;
    return {
      x, y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - (opts.lift || 0),
      w: 5 + Math.random() * 7,
      h: 8 + Math.random() * 8,
      rot: Math.random() * Math.PI * 2,
      vr: (Math.random() - 0.5) * 0.3,
      color: opts.colors ? opts.colors[(Math.random() * opts.colors.length) | 0] : COLORS[(Math.random() * COLORS.length) | 0],
      life: 1,
      decay: 0.006 + Math.random() * 0.008,
      gravity: opts.gravity !== undefined ? opts.gravity : 0.16,
      shape: Math.random() < 0.5 ? 'rect' : 'circle'
    };
  }

  function loop() {
    ctx2d.clearRect(0, 0, window.innerWidth, window.innerHeight);
    parts = parts.filter(p => p.life > 0 && p.y < window.innerHeight + 60);
    for (const p of parts) {
      p.vy += p.gravity;
      p.vx *= 0.985;
      p.x += p.vx;
      p.y += p.vy;
      p.rot += p.vr;
      p.life -= p.decay;
      ctx2d.save();
      ctx2d.globalAlpha = Math.max(0, Math.min(1, p.life * 1.4));
      ctx2d.translate(p.x, p.y);
      ctx2d.rotate(p.rot);
      ctx2d.fillStyle = p.color;
      if (p.shape === 'rect') ctx2d.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      else { ctx2d.beginPath(); ctx2d.arc(0, 0, p.w / 2, 0, Math.PI * 2); ctx2d.fill(); }
      ctx2d.restore();
    }
    if (parts.length > 0) raf = requestAnimationFrame(loop);
    else { raf = null; ctx2d.clearRect(0, 0, window.innerWidth, window.innerHeight); }
  }

  function kick() { if (!raf) raf = requestAnimationFrame(loop); }

  return {
    /** Взрыв из точки (x, y) — например, из правильного ответа. */
    burst(x, y, count = 90, colors) {
      for (let i = 0; i < count; i++) {
        parts.push(makePart(x, y, { angle: Math.random() * Math.PI * 2, speed: 3 + Math.random() * 10, lift: 3, colors, gravity: 0.18 }));
      }
      kick();
    },

    /** Дождь конфетти сверху — для финала/победителя. */
    rain(durationMs = 3200, perTick = 9) {
      const t0 = performance.now();
      const timer = setInterval(() => {
        if (performance.now() - t0 > durationMs) { clearInterval(timer); return; }
        for (let i = 0; i < perTick; i++) {
          const x = Math.random() * window.innerWidth;
          parts.push(makePart(x, -20, { angle: Math.PI / 2 + (Math.random() - 0.5), speed: 2 + Math.random() * 3, gravity: 0.08, decay: 0.0035 }));
        }
      }, 60);
      kick();
    },

    /** Двойной салют по бокам экрана — «правильный ответ». */
    celebrate() {
      const w = window.innerWidth, h = window.innerHeight;
      Confetti.burst(w * 0.18, h * 0.62, 70);
      Confetti.burst(w * 0.82, h * 0.62, 70);
      setTimeout(() => {
        Confetti.burst(w * 0.5, h * 0.42, 80, ['#ffd76a', '#ffffff', '#2dd16a']);
      }, 320);
    }
  };
})();
