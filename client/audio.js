// All sound is synthesized with WebAudio: underwater ambience, a slow generative score, and effects.

export class Audio {
  constructor() {
    this.ctx = null;
    this.muted = false;
    try { this.muted = localStorage.getItem('fih-muted') === '1'; } catch {}
    this.depth = 0;
  }

  start() {
    if (this.ctx) { this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC();
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.8;
    // muffled underwater bus
    this.lp = ctx.createBiquadFilter();
    this.lp.type = 'lowpass'; this.lp.frequency.value = 2600;
    this.lp.connect(this.master);
    this.master.connect(ctx.destination);

    // noise buffer shared by many sounds
    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; }
    this.white = ctx.createBuffer(1, len, ctx.sampleRate);
    const w = this.white.getChannelData(0);
    for (let i = 0; i < len; i++) w[i] = Math.random() * 2 - 1;

    // ambience: brown-noise rumble + low drone
    const amb = ctx.createBufferSource(); amb.buffer = this.noise; amb.loop = true;
    const ambF = ctx.createBiquadFilter(); ambF.type = 'lowpass'; ambF.frequency.value = 380;
    this.ambGain = ctx.createGain(); this.ambGain.gain.value = 0.32;
    amb.connect(ambF).connect(this.ambGain).connect(this.lp); amb.start();
    this.drone = [];
    for (const f of [55, 55.4, 82.4]) {
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f;
      const g = ctx.createGain(); g.gain.value = 0.0;
      o.connect(g).connect(this.lp); o.start();
      this.drone.push(g);
    }
    this.musicGain = ctx.createGain(); this.musicGain.gain.value = 0.12;
    const verb = this.makeReverb();
    this.musicGain.connect(verb).connect(this.lp);
    this.musicGain.connect(this.lp);
    this.nextChord = ctx.currentTime + 1;
    this.chordIdx = 0;
    setInterval(() => this.music(), 500);
  }

  makeReverb() {
    const ctx = this.ctx;
    const len = ctx.sampleRate * 3.5;
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6);
    }
    const conv = ctx.createConvolver(); conv.buffer = buf;
    return conv;
  }

  music() {
    const ctx = this.ctx;
    if (!ctx || ctx.currentTime < this.nextChord - 0.5) return;
    // slow minor progression; darker voicings in the deep
    const prog = [[57, 60, 64], [53, 57, 60], [55, 58, 62], [52, 55, 59], [50, 53, 57], [53, 56, 60]];
    const shift = this.depth > 130 ? -12 : this.depth > 50 ? -5 : 0;
    const chord = prog[this.chordIdx++ % prog.length];
    const t = this.nextChord;
    const dur = 7.5;
    chord.forEach((n, i) => {
      const o = ctx.createOscillator();
      o.type = i === 0 ? 'triangle' : 'sine';
      o.frequency.value = 440 * Math.pow(2, (n + shift - 69) / 12);
      o.detune.value = (Math.random() - 0.5) * 12;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.18 / (i + 1), t + 2.5);
      g.gain.linearRampToValueAtTime(0, t + dur);
      o.connect(g).connect(this.musicGain);
      o.start(t); o.stop(t + dur + 0.1);
    });
    // occasional high ping, like distant sonar or whale-ish call
    if (Math.random() < 0.35) {
      const o = ctx.createOscillator(); o.type = 'sine';
      const n = chord[Math.floor(Math.random() * 3)] + 24 + shift;
      o.frequency.setValueAtTime(440 * Math.pow(2, (n - 69) / 12), t + 3);
      o.frequency.exponentialRampToValueAtTime(440 * Math.pow(2, (n - 71) / 12), t + 5);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t + 3); g.gain.linearRampToValueAtTime(0.05, t + 3.2); g.gain.exponentialRampToValueAtTime(0.0001, t + 6);
      o.connect(g).connect(this.musicGain); o.start(t + 3); o.stop(t + 6.2);
    }
    this.nextChord = t + dur - 1.5;
  }

  setDepth(depth) {
    this.depth = depth;
    if (!this.ctx) return;
    const k = Math.min(1, depth / 200);
    const t = this.ctx.currentTime;
    this.drone.forEach((g) => g.gain.setTargetAtTime(0.03 + 0.07 * k, t, 1));
    this.lp.frequency.setTargetAtTime(2600 - 1500 * k, t, 1);
  }

  toggleMute() {
    this.muted = !this.muted;
    try { localStorage.setItem('fih-muted', this.muted ? '1' : '0'); } catch {}
    if (this.master) this.master.gain.setTargetAtTime(this.muted ? 0 : 0.8, this.ctx.currentTime, 0.05);
    return this.muted;
  }

  // ---- effects. vol = 0..1 for distance attenuation
  noiseHit(dur, f0, f1, q, vol, type = 'bandpass', src = 'white') {
    const ctx = this.ctx; if (!ctx || vol <= 0.01) return;
    const t = ctx.currentTime;
    const s = ctx.createBufferSource(); s.buffer = src === 'white' ? this.white : this.noise;
    const f = ctx.createBiquadFilter(); f.type = type; f.Q.value = q;
    f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(this.lp);
    s.start(t, Math.random()); s.stop(t + dur + 0.05);
  }
  tone(type, f0, f1, dur, vol, delay = 0) {
    const ctx = this.ctx; if (!ctx || vol <= 0.01) return;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.lp); o.start(t); o.stop(t + dur + 0.05);
  }

  bite(vol = 1, size = 1) {
    const p = Math.max(0.4, 1.4 - size * 0.08);
    this.noiseHit(0.09, 3000 * p, 600 * p, 2, 0.5 * vol);
    this.tone('square', 220 * p, 90 * p, 0.08, 0.12 * vol);
  }
  hit(vol = 1, size = 1) {
    this.noiseHit(0.25, 900, 150, 1, 0.6 * vol, 'lowpass', 'brown');
    this.tone('sine', 140 / Math.sqrt(size + 0.5), 50, 0.25, 0.4 * vol);
  }
  hurt() { this.hit(1.2, 2); this.tone('sawtooth', 90, 45, 0.3, 0.12); }
  eat(meat) {
    if (meat) { this.noiseHit(0.12, 700, 250, 1.5, 0.35, 'lowpass', 'brown'); this.tone('sine', 300, 180, 0.1, 0.15); }
    else this.tone('sine', 700 + Math.random() * 300, 1300, 0.07, 0.12);
  }
  bubble(vol = 0.5) {
    for (let i = 0; i < 4; i++) this.tone('sine', 400 + Math.random() * 600, 1200 + Math.random() * 800, 0.05, 0.07 * vol, i * 0.04 + Math.random() * 0.03);
  }
  dash() { this.noiseHit(0.35, 400, 2400, 0.8, 0.35, 'bandpass', 'white'); this.bubble(0.8); }
  levelUp() { [0, 4, 7, 12].forEach((n, i) => this.tone('triangle', 330 * Math.pow(2, n / 12), 330 * Math.pow(2, n / 12), 0.35, 0.16, i * 0.08)); }
  evolve() {
    [0, 3, 7, 10, 15].forEach((n, i) => this.tone('sawtooth', 110 * Math.pow(2, n / 12), 110 * Math.pow(2, n / 12) * 1.01, 1.4, 0.07, i * 0.1));
    this.noiseHit(1.5, 200, 3000, 0.5, 0.25, 'bandpass', 'white');
  }
  death() { this.tone('sawtooth', 200, 30, 1.6, 0.25); this.noiseHit(1.2, 1200, 80, 1, 0.5, 'lowpass', 'brown'); }
  ability(type, vol = 1) {
    switch (type) {
      case 'lunge': case 'ram': case 'snap': this.noiseHit(0.3, 300, 1800, 1, 0.4 * vol); this.bubble(vol); break;
      case 'spikes': case 'shell': this.tone('square', 120, 260, 0.25, 0.12 * vol); this.noiseHit(0.2, 2000, 4000, 3, 0.2 * vol); break;
      case 'venom': case 'pulse': this.tone('sawtooth', 600, 200, 0.4, 0.08 * vol); this.noiseHit(0.4, 3000, 800, 4, 0.2 * vol); break;
      case 'ambush': this.tone('sine', 400, 100, 0.8, 0.12 * vol); break;
      case 'ink': this.noiseHit(0.8, 150, 600, 0.6, 0.6 * vol, 'lowpass', 'brown'); this.bubble(vol); break;
      case 'slash': this.noiseHit(0.18, 5000, 1200, 2, 0.4 * vol); break;
    }
  }
}
