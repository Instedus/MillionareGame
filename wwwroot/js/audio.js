/* ============================================================
   Звук — всё синтезируется через WebAudio, внешних файлов нет.
   ============================================================ */
const AudioSfx = (() => {
  let ctx = null;
  let master = null;
  let muted = false;
  try { muted = localStorage.getItem('mm_muted') === '1'; } catch (e) { /* private mode */ }
  let heartbeatTimer = null;

  function ensure() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.5;
      master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return ctx;
  }

  function tone({ freq = 440, type = 'sine', dur = 0.18, vol = 0.3, delay = 0, glide = null }) {
    if (muted) return;
    const c = ensure();
    if (!c) return;
    const t0 = c.currentTime + delay;
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (glide) osc.frequency.exponentialRampToValueAtTime(Math.max(glide, 1), t0 + dur);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(vol, t0 + Math.min(0.03, dur * 0.2));
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain).connect(master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }

  function noise({ dur = 0.4, vol = 0.2, delay = 0, freq = 900, q = 0.8 }) {
    if (muted) return;
    const c = ensure();
    if (!c) return;
    const t0 = c.currentTime + delay;
    const len = Math.max(1, Math.floor(c.sampleRate * dur));
    const buf = c.createBuffer(1, len, c.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    const src = c.createBufferSource();
    src.buffer = buf;
    const filter = c.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(freq, t0);
    filter.Q.value = q;
    const gain = c.createGain();
    gain.gain.setValueAtTime(vol, t0);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(filter).connect(gain).connect(master);
    src.start(t0);
    src.stop(t0 + dur + 0.05);
  }

  const api = {
    unlock() { ensure(); },

    isMuted: () => muted,
    setMuted(v) {
      muted = v;
      try { localStorage.setItem('mm_muted', v ? '1' : '0'); } catch (e) {}
      if (v) api.suspenseStop();
    },

    click() { tone({ freq: 760, type: 'triangle', dur: 0.07, vol: 0.16 }); },

    tick() { tone({ freq: 1150, type: 'square', dur: 0.025, vol: 0.07 }); },

    whoosh() {
      noise({ dur: 0.7, vol: 0.16, freq: 500, q: 0.5 });
      noise({ dur: 0.7, vol: 0.1, delay: 0.15, freq: 1400, q: 0.5 });
    },

    reelStop() {
      tone({ freq: 520, type: 'triangle', dur: 0.12, vol: 0.3 });
      tone({ freq: 780, type: 'triangle', dur: 0.16, vol: 0.3, delay: 0.1 });
      tone({ freq: 1040, type: 'triangle', dur: 0.3, vol: 0.32, delay: 0.2 });
    },

    suspenseStart() {
      api.suspenseStop();
      const beat = () => {
        tone({ freq: 78, type: 'sine', dur: 0.14, vol: 0.5 });
        tone({ freq: 62, type: 'sine', dur: 0.16, vol: 0.42, delay: 0.22 });
      };
      beat();
      heartbeatTimer = setInterval(beat, 950);
    },
    suspenseStop() {
      if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
    },

    correct() {
      api.suspenseStop();
      const notes = [523.25, 659.25, 783.99, 1046.5];
      notes.forEach((f, i) => tone({ freq: f, type: 'triangle', dur: 0.4, vol: 0.3, delay: i * 0.11 }));
      tone({ freq: 1318.5, type: 'sine', dur: 0.8, vol: 0.22, delay: 0.5 });
      noise({ dur: 0.5, vol: 0.06, freq: 3000, q: 0.4, delay: 0.45 });
    },

    wrong() {
      api.suspenseStop();
      tone({ freq: 220, type: 'sawtooth', dur: 0.65, vol: 0.3, glide: 90 });
      tone({ freq: 110, type: 'square', dur: 0.65, vol: 0.18, glide: 55, delay: 0.05 });
      noise({ dur: 0.4, vol: 0.08, freq: 200, q: 0.4 });
    },

    eliminate() {
      tone({ freq: 400, type: 'square', dur: 0.1, vol: 0.2, glide: 180 });
      noise({ dur: 0.25, vol: 0.1, freq: 700, q: 0.6, delay: 0.05 });
    },

    bell() {
      tone({ freq: 880, type: 'sine', dur: 1.4, vol: 0.32 });
      tone({ freq: 1320, type: 'sine', dur: 1.2, vol: 0.2, delay: 0.02 });
      tone({ freq: 1760, type: 'sine', dur: 0.9, vol: 0.1, delay: 0.04 });
      tone({ freq: 880, type: 'sine', dur: 1.4, vol: 0.3, delay: 0.7 });
    },

    timerTick(last) {
      tone({ freq: last ? 1400 : 1000, type: 'sine', dur: 0.05, vol: last ? 0.2 : 0.1 });
    },

    win() {
      const melody = [523.25, 523.25, 523.25, 659.25, 783.99, 659.25, 783.99, 1046.5];
      const durs = [0.14, 0.14, 0.14, 0.3, 0.16, 0.16, 0.16, 0.75];
      let t = 0;
      melody.forEach((f, i) => {
        tone({ freq: f, type: 'triangle', dur: durs[i] + 0.12, vol: 0.28, delay: t });
        t += durs[i];
      });
      [1046.5, 1318.5, 1567.98].forEach((f, i) =>
        tone({ freq: f, type: 'sine', dur: 1.2, vol: 0.14, delay: t + i * 0.02 }));
    },

    fanfareShort() {
      tone({ freq: 392, type: 'triangle', dur: 0.35, vol: 0.22 });
      tone({ freq: 523.25, type: 'triangle', dur: 0.5, vol: 0.22, delay: 0.12 });
    }
  };

  return api;
})();
