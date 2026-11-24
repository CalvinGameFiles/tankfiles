'use strict';
// Tiny synthesized sounds so the tank feels alive before real audio exists. Volume comes from Store.opts.sfx.
const Sfx = (() => {
  let ctx = null;
  function ac() {
    if (!ctx) { try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return null; } }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }
  function vol() { return Store.opts.sfx; }
  function noise(dur, freq, gain, type) {
    const c = ac(); if (!c || vol() <= 0) return;
    const n = Math.floor(c.sampleRate * dur), buf = c.createBuffer(1, n, c.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const src = c.createBufferSource(); src.buffer = buf;
    const f = c.createBiquadFilter(); f.type = type || 'lowpass'; f.frequency.value = freq;
    const g = c.createGain(); g.gain.value = gain * vol();
    src.connect(f).connect(g).connect(c.destination); src.start();
  }
  function tone(freq, dur, gain, type, slide) {
    const c = ac(); if (!c || vol() <= 0) return;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type || 'square'; o.frequency.setValueAtTime(freq, c.currentTime);
    if (slide) o.frequency.exponentialRampToValueAtTime(slide, c.currentTime + dur);
    g.gain.setValueAtTime(gain * vol(), c.currentTime); g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + dur);
    o.connect(g).connect(c.destination); o.start(); o.stop(c.currentTime + dur);
  }
  return {
    unlock() { ac(); },
    fire() { noise(0.12, 1800, 0.5); tone(220, 0.08, 0.15, 'triangle', 90); },
    bounce() { tone(900, 0.05, 0.12, 'square', 500); },
    hit() { noise(0.08, 3000, 0.3, 'highpass'); },
    mine() { tone(1200, 0.06, 0.1, 'sine'); },
    beep() { tone(1600, 0.05, 0.08, 'sine'); },
    boom() { noise(0.6, 500, 0.9); tone(90, 0.5, 0.4, 'sine', 30); },
    crate() { noise(0.25, 900, 0.5); },
    click() { tone(700, 0.04, 0.06, 'square'); },
    laser() { tone(140, 0.6, 0.14, 'sawtooth', 700); noise(0.4, 4000, 0.15, 'highpass'); },
    freeze() { tone(2200, 0.3, 0.08, 'sine', 900); noise(0.35, 6000, 0.25, 'highpass'); },
    tele() { tone(500, 0.25, 0.1, 'sine', 1500); },
    shield() { tone(1300, 0.12, 0.1, 'triangle', 700); },
    ping() { tone(2400, 0.06, 0.08, 'square', 1800); },
  };
})();

// Background music: one track per map style (audio/music/<style>.mp3, indoor for the first missions). The game calls
// Music.want() every frame: a track name plays (looping, from the top whenever it starts), 'pause' holds it where it is,
// null stops it and rewinds. Volume follows Store.opts.music live.
const Music = (() => {
  const el = new Audio(); el.loop = true; el.preload = 'auto';
  let track = null;
  function want(name) {
    el.volume = Math.max(0, Math.min(1, Store.opts.music));
    if (name === 'pause') { if (!el.paused) el.pause(); return; }
    if (name !== track) {
      el.pause(); track = name;
      if (!name) return;
      el.src = 'audio/music/' + name + '.mp3'; el.currentTime = 0;
    }
    if (name && el.paused) { const p = el.play(); if (p && p.catch) p.catch(() => {}); }
  }
  return { want, get track() { return track; }, get playing() { return !el.paused; }, _el: el };
})();
