// Synthesized sound (WebAudio, no audio files): 3D-positioned effects, so you hear where shots and
// explosions come from (including behind you), and procedural music (music.js). One mix:
//   effects -> SFX volume ---\
//                             +-> master -> glue compressor -> limiter -> out
//   music -> MUSIC volume -> duck (dips under big explosions) --/
// Volumes are 0..1 from the settings sliders (squared, so the slider feels even).
import { Music } from './music.js?v=30';

export class Sfx {
  constructor() {
    this.ctx = null;
    this.music = null;
    this.vol = { music: 0.6, sfx: 0.8 };
    this.at = null;                     // mix check: schedule at this time instead of "now"
    this.last = {};                     // rate limits per sound
  }

  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.attach(new AC());
  }

  // Build the mix on any context: the real one, or an OfflineAudioContext for the mix check.
  attach(ctx) {
    this.ctx = ctx;
    const glue = ctx.createDynamicsCompressor();
    glue.threshold.value = -16; glue.knee.value = 10; glue.ratio.value = 3; glue.attack.value = 0.008; glue.release.value = 0.2;
    const lim = ctx.createDynamicsCompressor();
    lim.threshold.value = -4; lim.knee.value = 0; lim.ratio.value = 20; lim.attack.value = 0.001; lim.release.value = 0.06;
    const out = ctx.createGain(); out.gain.value = 1.0;
    glue.connect(lim).connect(out).connect(ctx.destination);
    this.master = ctx.createGain();
    this.master.connect(glue);
    this.sfxBus = ctx.createGain(); this.sfxBus.connect(this.master);
    this.musicBus = ctx.createGain();
    this.duck = ctx.createGain();
    this.musicBus.connect(this.duck).connect(this.master);
    const len = ctx.sampleRate;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.music = new Music(ctx, this.musicBus, this.noise);
    this.setVolumes(this.vol.music, this.vol.sfx);
  }

  setVolumes(music, sfx) {
    this.vol = { music, sfx };
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.musicBus.gain.setTargetAtTime(music * music, t, 0.05);
    this.sfxBus.gain.setTargetAtTime(sfx * sfx, t, 0.05);
  }

  now() { return this.at != null ? this.at : this.ctx.currentTime; }
  // Rate limit: true if this sound played less than `gap` seconds ago.
  _limited(key, gap) {
    const t = this.now();
    if (t - (this.last[key] || -1) < gap) return true;
    this.last[key] = t;
    return false;
  }

  setListener(pos, fwd, up) {
    if (!this.ctx) return;
    const l = this.ctx.listener;
    if (l.positionX) {
      const t = this.ctx.currentTime;
      l.positionX.setValueAtTime(pos.x, t); l.positionY.setValueAtTime(pos.y, t); l.positionZ.setValueAtTime(pos.z, t);
      l.forwardX.setValueAtTime(fwd.x, t); l.forwardY.setValueAtTime(fwd.y, t); l.forwardZ.setValueAtTime(fwd.z, t);
      l.upX.setValueAtTime(up.x, t); l.upY.setValueAtTime(up.y, t); l.upZ.setValueAtTime(up.z, t);
    } else if (l.setPosition) {
      l.setPosition(pos.x, pos.y, pos.z);
      l.setOrientation(fwd.x, fwd.y, fwd.z, up.x, up.y, up.z);
    }
  }

  _out(pos) {
    if (!pos) return this.sfxBus;
    if (this.toWorld) pos = this.toWorld(pos);   // game units (battle box) -> world metres
    const p = this.ctx.createPanner();
    p.panningModel = 'HRTF';
    p.distanceModel = 'inverse';
    p.refDistance = 1.5;
    p.rolloffFactor = 0.8;
    if (p.positionX) {
      p.positionX.value = pos.x; p.positionY.value = pos.y; p.positionZ.value = pos.z;
    } else {
      p.setPosition(pos.x, pos.y, pos.z);
    }
    p.connect(this.sfxBus);
    return p;
  }

  // Building blocks.
  _osc(t, type, f0, f1, dur, vol, dest, filt) {
    const ctx = this.ctx, o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + dur * 0.9);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    let n = o;
    if (filt) {
      const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = 0.7;
      f.frequency.setValueAtTime(filt[0], t); f.frequency.exponentialRampToValueAtTime(filt[1], t + dur);
      n = o.connect(f);
    }
    n.connect(g).connect(dest);
    o.start(t); o.stop(t + dur + 0.02);
  }
  _noise(t, type, f0, f1, q, vol, dur, dest, attack = 0) {
    const ctx = this.ctx, src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    src.buffer = this.noise; src.loop = true;
    f.type = type; f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) f.frequency.exponentialRampToValueAtTime(f1, t + dur);
    if (attack) { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + attack); }
    else g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f).connect(g).connect(dest);
    src.start(t, Math.random() * 0.4); src.stop(t + dur + 0.02);
  }
  _duck(depth, rec) {
    const t = this.now(), g = this.duck.gain;
    g.cancelScheduledValues(t);
    g.setTargetAtTime(depth, t, 0.01);
    g.setTargetAtTime(1, t + 0.06, rec);
  }

  // Your shots: a filtered square "pew" with a click on top and a small thump under it.
  // vol < 1 for the squadron bots' shots.
  laser(pos, vol = 1) {
    if (!this.ctx || this._limited(vol < 1 ? 'botLaser' : 'laser', vol < 1 ? 0.05 : 0.03)) return;
    const t = this.now(), out = this._out(pos);
    this._osc(t, 'square', 1250, 280, 0.1, 0.075 * vol, out, [3400, 800]);
    this._noise(t, 'highpass', 3000, 3000, 0.7, 0.05 * vol, 0.018, out);
    this._osc(t, 'sine', 190, 60, 0.07, 0.16 * vol, out);
  }

  enemyLaser(pos) {
    if (!this.ctx || this._limited('enemy', 0.07)) return;   // a big wave must not turn into noise
    const t = this.now(), out = this._out(pos);
    this._osc(t, 'sawtooth', 560, 170, 0.13, 0.07, out, [1700, 500]);
  }

  // Explosions: noise body (low-pass sweep), sub drop, crackle; big ones add a rumble tail and dip the music.
  boom(pos, big = false) {
    if (!this.ctx || this._limited(big ? 'boomBig' : 'boom', 0.04)) return;
    const t = this.now(), out = this._out(pos), dur = big ? 1.1 : 0.65;
    this._noise(t, 'lowpass', big ? 2200 : 3000, 90, 0.6, big ? 0.55 : 0.42, dur, out);
    this._osc(t, 'sine', big ? 120 : 160, 34, dur * 0.55, big ? 0.55 : 0.4, out);
    for (let i = 0; i < (big ? 6 : 4); i++) {
      this._noise(t + 0.02 + Math.random() * (big ? 0.35 : 0.2), 'bandpass', 2600 + Math.random() * 1500, 1800, 1.2, 0.05, 0.05, out);
    }
    if (big) this._noise(t + 0.08, 'lowpass', 380, 120, 0.5, 0.22, 1.6, out, 0.15);
    this._duck(big ? 0.5 : 0.75, big ? 0.35 : 0.2);
  }

  // An outpost destroyed: a big boom, a long sub drop and a rolling second blast.
  blast(pos) {
    if (!this.ctx) return;
    this.boom(pos, true);
    const t = this.now(), out = this._out(pos);
    this._osc(t, 'sine', 90, 22, 2.2, 0.7, out);
    this._noise(t + 0.25, 'lowpass', 900, 80, 0.7, 0.4, 2.4, out, 0.3);
    this._osc(t + 0.3, 'sawtooth', 220, 40, 1.2, 0.12, out);
    this._duck(0.4, 0.6);
  }

  // You are hit: a saw drop and a thump (not positional: it's your ship).
  hit() {
    if (!this.ctx || this._limited('hit', 0.08)) return;
    const t = this.now();
    this._osc(t, 'sawtooth', 200, 55, 0.26, 0.2, this.sfxBus, [1500, 300]);
    this._noise(t, 'lowpass', 900, 200, 0.7, 0.32, 0.14, this.sfxBus);
  }

  // A shot lands on an enemy (or a bot).
  ping(pos) {
    if (!this.ctx || this._limited('ping', 0.03)) return;
    const t = this.now(), out = this._out(pos);
    this._osc(t, 'triangle', 1500, 1100, 0.07, 0.09, out);
    this._noise(t, 'bandpass', 4000, 4000, 1.5, 0.04, 0.03, out);
  }

  // UI click (panel buttons, settings).
  click() {
    if (!this.ctx || this._limited('click', 0.03)) return;
    const t = this.now();
    this._osc(t, 'sine', 1900, 1300, 0.04, 0.09, this.sfxBus);
    this._noise(t, 'highpass', 5000, 5000, 0.7, 0.025, 0.012, this.sfxBus);
  }

  // Boost: a filtered-noise whoosh that rises.
  whoosh(vol = 1) {
    if (!this.ctx || this._limited('whoosh', 0.35)) return;
    const t = this.now();
    this._noise(t, 'bandpass', 380, 2600, 1.4, 0.16 * vol, 0.5, this.sfxBus, 0.07);
  }

  // Little tunes (all in D).
  _notes(notes, gap, vol, type = 'triangle', len = 0.35) {
    if (!this.ctx) return;
    const t0 = this.now();
    notes.forEach((f, i) => {
      const t = t0 + i * gap, o = this.ctx.createOscillator(), g = this.ctx.createGain();
      o.type = type; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol, t + 0.015);
      g.gain.exponentialRampToValueAtTime(0.001, t + len);
      o.connect(g).connect(this.sfxBus);
      o.start(t); o.stop(t + len + 0.02);
    });
  }
  chime(up = true) { this._notes(up ? [587.3, 740, 880] : [440, 349.2, 293.7], 0.12, 0.16); }
  split() { this._notes([587.3, 880], 0.08, 0.14); }
  join() { this._notes([880, 587.3], 0.08, 0.14); }
  regroup() { if (!this._limited('regroup', 0.4)) this._notes([698.5], 0, 0.05, 'triangle', 0.2); }
  formation() { this._notes([659.3, 880, 659.3], 0.06, 0.1, 'triangle', 0.15); }
  aceIn() { this._notes([293.7, 349.2, 440, 587.3], 0.09, 0.1, 'square', 0.25); }
  aceDown() {
    if (!this.ctx) return;
    this._notes([587.3, 740, 880, 1174.7], 0.07, 0.12, 'triangle', 0.5);
    this._duck(0.4, 0.5);
  }
}
