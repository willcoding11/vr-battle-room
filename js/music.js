// Procedural music (WebAudio), all in D minor, scheduled a little ahead of time.
//   lobby  - a slow ambient pad: Dm9 - Bbmaj7 - Fmaj9 - Cadd9, 8 s per chord, in a big reverb.
//   battle - 112 BPM over Dm - Bb - F - C (one bar each): kick, snare, hats, bass, an arpeggio and a quiet
//            pad. Intensity (0..1, from the game) adds layers at bar lines:
//              always  half-time kick, sparse bass, pad
//              0.15    8th hats
//              0.30    four-on-the-floor kick, 8th bass, 8th arpeggio
//              0.55    snare backbeat, fills
//              0.60    16th arpeggio
//              0.70    16th hats, open hat
//              0.85    octave-jumping bass, brighter arpeggio
// update(t) schedules everything up to t + 0.2 s, so it also works on an OfflineAudioContext (the mix check
// renders a clip by calling update() with increasing times before rendering).
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
const BPM = 112, STEP = 60 / BPM / 4;

// Battle chords: bass root + three close-voiced chord tones (smooth voice leading for the arpeggio).
const PROG = [
  { root: 38, tones: [62, 65, 69] },   // Dm  (D F A)
  { root: 34, tones: [62, 65, 70] },   // Bb  (D F Bb)
  { root: 41, tones: [60, 65, 69] },   // F   (C F A)
  { root: 36, tones: [60, 64, 67] },   // C   (C E G)
];
// Lobby pad chords (wide voicings) and their bass notes.
const PADS = [
  { bass: 38, notes: [50, 57, 60, 64, 65] },   // Dm9
  { bass: 34, notes: [46, 53, 57, 62, 65] },   // Bbmaj7
  { bass: 41, notes: [53, 57, 60, 64, 67] },   // Fmaj9
  { bass: 36, notes: [48, 55, 62, 64, 67] },   // Cadd9
];
const ARP = [0, 1, 2, 3, 4, 3, 2, 1, 0, 1, 2, 3, 4, 5, 4, 2];   // indexes into the chord tones (+12 per 3)
const BASS8 = [0, 0, 12, 0, 0, 0, 12, 7];                        // 8th-note bass offsets from the root

export class Music {
  constructor(ctx, dest, noise) {
    this.ctx = ctx; this.noise = noise;
    this.mode = 'off';
    this.target = 0; this.level = 0;
    this.nextStep = 0; this.step = 0; this.nextChord = 0; this.chord = 0;
    this.steps = 0;                                   // steps scheduled so far (tests: is the music running?)
    this.out = ctx.createGain(); this.out.connect(dest);
    // Reverb: a generated stereo impulse (decaying noise, darker as it decays).
    const len = Math.floor(ctx.sampleRate * 2.6), ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = ir.getChannelData(c);
      let lp = 0;
      for (let i = 0; i < len; i++) {
        const k = i / len, a = 0.6 - 0.5 * k;           // low-pass gets stronger over time
        lp = lp * a + (Math.random() * 2 - 1) * (1 - a);
        d[i] = lp * Math.pow(1 - k, 2.2) * 1.4;
      }
    }
    this.verb = ctx.createConvolver(); this.verb.buffer = ir;
    const verbOut = ctx.createGain(); verbOut.gain.value = 0.55;
    this.verb.connect(verbOut).connect(this.out);
    // Dotted-8th delay for the arpeggio (feedback through a low-pass so the repeats get darker).
    this.delay = ctx.createDelay(1); this.delay.delayTime.value = STEP * 3;
    const fb = ctx.createGain(); fb.gain.value = 0.3;
    const dl = ctx.createBiquadFilter(); dl.type = 'lowpass'; dl.frequency.value = 2200;
    const dOut = ctx.createGain(); dOut.gain.value = 0.32;
    this.delay.connect(dl).connect(fb).connect(this.delay);
    dl.connect(dOut).connect(this.out);
    // Two scenes, cross-faded.
    this.lobbyG = ctx.createGain(); this.lobbyG.gain.value = 0;
    this.lobbyG.connect(this.out);
    const lSend = ctx.createGain(); lSend.gain.value = 0.7; this.lobbyG.connect(lSend).connect(this.verb);
    this.battleG = ctx.createGain(); this.battleG.gain.value = 0;
    this.battleG.connect(this.out);
    const bSend = ctx.createGain(); bSend.gain.value = 0.12; this.battleG.connect(bSend).connect(this.verb);
    this.arpBus = ctx.createGain(); this.arpBus.connect(this.battleG);
    const aDel = ctx.createGain(); aDel.gain.value = 0.6; this.arpBus.connect(aDel).connect(this.delay);
    const aVerb = ctx.createGain(); aVerb.gain.value = 0.25; this.arpBus.connect(aVerb).connect(this.verb);
  }

  setIntensity(x) { this.target = Math.max(0, Math.min(1, x)); }

  setMode(mode, at = this.ctx.currentTime) {
    if (mode === this.mode) return;
    this.mode = mode;
    this.lobbyG.gain.setTargetAtTime(mode === 'lobby' ? 1 : 0, at, mode === 'lobby' ? 1.2 : 0.5);
    this.battleG.gain.setTargetAtTime(mode === 'battle' ? 1 : 0, at, mode === 'battle' ? 0.25 : 0.9);
    if (mode === 'battle') { this.nextStep = at + 0.05; this.step = 0; this.level = Math.min(this.target, 0.3); }
    if (mode === 'lobby') { this.nextChord = at + 0.05; this.chord = 0; }
  }

  update(now = this.ctx.currentTime) {
    const until = now + 0.2;
    if (this.mode === 'battle') {
      if (this.nextStep < now - 0.05) this.nextStep = now + 0.05;    // fell behind (paused): restart cleanly
      while (this.nextStep < until) {
        this._step(this.step, this.nextStep);
        this.nextStep += STEP; this.step = (this.step + 1) % 64; this.steps++;
      }
    } else if (this.mode === 'lobby') {
      if (this.nextChord < now - 0.05) this.nextChord = now + 0.05;
      while (this.nextChord < until) {
        this._padChord(this.chord, this.nextChord);
        this.nextChord += 8; this.chord = (this.chord + 1) % PADS.length; this.steps++;
      }
    }
  }

  // ---------------------------------------------------------------- lobby
  _padChord(i, t) {
    const { bass, notes } = PADS[i], dur = 8, att = 2.4, rel = 3.5;
    notes.forEach((m, k) => this._padVoice(t + k * 0.12, m, dur, att, rel, k === notes.length - 1 ? 0.045 : 0.056, this.lobbyG, 650 + k * 120));
    // Soft sine bass and a faint shimmer an octave over the top note.
    this._sine(t, mtof(bass), dur, att, rel, 0.04, this.lobbyG);
    this._sine(t + 1.5, mtof(notes[notes.length - 1] + 12), dur - 1.5, 2.5, rel, 0.012, this.lobbyG);
  }
  _padVoice(t, m, dur, att, rel, vol, dest, cutoff) {
    const ctx = this.ctx, f = mtof(m);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 0.4;
    lp.frequency.setValueAtTime(cutoff * 0.7, t);
    lp.frequency.linearRampToValueAtTime(cutoff * 1.25, t + dur * 0.55);
    lp.frequency.linearRampToValueAtTime(cutoff * 0.8, t + dur + rel);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + att);
    g.gain.setValueAtTime(vol, t + dur);
    g.gain.linearRampToValueAtTime(0, t + dur + rel);
    lp.connect(g).connect(dest);
    for (const det of [-7, 7]) {
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = det;
      o.connect(lp); o.start(t); o.stop(t + dur + rel + 0.05);
    }
  }
  _sine(t, f, dur, att, rel, vol, dest) {
    const ctx = this.ctx, o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sine'; o.frequency.value = f;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + att);
    g.gain.setValueAtTime(vol, t + dur); g.gain.linearRampToValueAtTime(0, t + dur + rel);
    o.connect(g).connect(dest); o.start(t); o.stop(t + dur + rel + 0.05);
  }

  // ---------------------------------------------------------------- battle
  _step(i, t) {
    const s = i % 16, bar = Math.floor(i / 16), ch = PROG[bar];
    if (s === 0) {
      // New bar: move the level toward the target (at most a layer or so per bar), pad chord.
      this.level += Math.max(-0.35, Math.min(0.35, this.target - this.level));
      for (const m of ch.tones) this._padVoice(t, m - 12, STEP * 16 - 0.05, 0.25, 0.4, 0.026, this.battleG, 1000);
    }
    const L = this.level;
    // Drums.
    if (s === 0 || s === 8 || (L >= 0.3 && (s === 4 || s === 12))) this._kick(t, s === 0 ? 0.5 : 0.42);
    if (L >= 0.55 && (s === 4 || s === 12)) this._snare(t, 0.2);
    if (L >= 0.55 && bar === 3 && s >= 13) this._snare(t, 0.08 + 0.03 * (s - 13));   // fill into the loop
    if (L >= 0.15 && (s % 2 === 0 || L >= 0.7)) this._hat(t, s % 4 === 2 ? 0.05 : 0.032, 0.035);
    if (L >= 0.7 && s === 14) this._hat(t, 0.04, 0.16);
    // Bass: sparse at low intensity, 8ths from 0.3, octave jumps at the top.
    if (L < 0.3) { if (s === 0 || s === 6 || s === 8 || s === 14) this._bass(t, ch.root + (s === 14 ? 12 : 0), 0.16, L); }
    else if (s % 2 === 0) {
      let off = BASS8[s / 2];
      if (L >= 0.85 && s % 4 === 2) off = 12;
      this._bass(t, ch.root + off, s % 4 === 0 ? 0.17 : 0.13, L);
    }
    // Arpeggio.
    if (L >= 0.3 && (L >= 0.6 || s % 2 === 0)) {
      const k = ARP[s], m = ch.tones[k % 3] + 12 * Math.floor(k / 3);
      this._pluck(t, m, L >= 0.6 ? 0.06 : 0.066, 900 + 2400 * L);
    }
  }
  _kick(t, vol) {
    const ctx = this.ctx, o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(52, t + 0.11);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.32);
    o.connect(g).connect(this.battleG); o.start(t); o.stop(t + 0.34);
  }
  _noiseHit(t, type, freq, q, vol, dec, dest = this.battleG) {
    const ctx = this.ctx, src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    src.buffer = this.noise; f.type = type; f.frequency.value = freq; f.Q.value = q;
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dec);
    src.connect(f).connect(g).connect(dest);
    src.start(t, Math.random() * 0.5); src.stop(t + dec + 0.02);
  }
  _snare(t, vol) {
    this._noiseHit(t, 'bandpass', 1900, 0.7, vol, 0.16);
    const ctx = this.ctx, o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'triangle'; o.frequency.setValueAtTime(210, t); o.frequency.exponentialRampToValueAtTime(150, t + 0.08);
    g.gain.setValueAtTime(vol * 0.7, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
    o.connect(g).connect(this.battleG); o.start(t); o.stop(t + 0.1);
  }
  _hat(t, vol, dec) { this._noiseHit(t, 'highpass', 7500, 0.5, vol, dec); }
  _bass(t, m, vol, L) {
    const ctx = this.ctx, o = ctx.createOscillator(), o2 = ctx.createOscillator(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    const dur = STEP * 1.8;
    o.type = 'sawtooth'; o.frequency.value = mtof(m);
    o2.type = 'sine'; o2.frequency.value = mtof(m);              // sine under the saw: weight without fizz
    f.type = 'lowpass'; f.Q.value = 2;
    f.frequency.setValueAtTime(420 + 900 * L, t); f.frequency.exponentialRampToValueAtTime(180, t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.setValueAtTime(vol, t + dur * 0.6); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    const g2 = ctx.createGain(); g2.gain.value = 0.45;
    o.connect(f); o2.connect(g2).connect(f); f.connect(g).connect(this.battleG);
    o.start(t); o2.start(t); o.stop(t + dur + 0.02); o2.stop(t + dur + 0.02);
  }
  _pluck(t, m, vol, cutoff) {
    const ctx = this.ctx, o = ctx.createOscillator(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    o.type = 'square'; o.frequency.value = mtof(m);
    f.type = 'lowpass'; f.Q.value = 1;
    f.frequency.setValueAtTime(cutoff, t); f.frequency.exponentialRampToValueAtTime(cutoff * 0.25, t + 0.2);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
    o.connect(f).connect(g).connect(this.arpBus); o.start(t); o.stop(t + 0.24);
  }
}
