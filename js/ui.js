// VR UI: canvas-textured panels with pointer-ray buttons, and small animated controller icons.
// Same look as the wrist HUD: dark navy glass, cyan frame, monospace text, gold highlights.
import * as THREE from '../vendor/three.module.js';

export const UI = {
  bg: 'rgba(0,10,22,0.88)', frame: 'rgba(80,220,255,0.8)', faint: 'rgba(80,220,255,0.35)',
  title: '#9ff', text: '#bfefff', dim: '#5fa9bf', gold: '#ffcc66', hover: 'rgba(60,200,255,0.25)',
  active: 'rgba(255,204,102,0.18)', red: '#ff5566',
};

// A flat panel: one canvas texture on a plane, plus a list of rectangular buttons in canvas pixels.
export class Panel {
  constructor(widthM, cw, ch) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = cw; this.canvas.height = ch;
    this.g = this.canvas.getContext('2d');
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(widthM, (widthM * ch) / cw),
      new THREE.MeshBasicMaterial({ map: this.tex, transparent: true, depthTest: false, fog: false, side: THREE.DoubleSide }));
    this.mesh.renderOrder = 30;
    this.mesh.visible = false;
    this.mesh.userData.panel = this;
    this.W = cw; this.H = ch; this.widthM = widthM;
    this.buttons = [];
    this.hover = null;
    this.onClick = null;
  }
  get visible() { return this.mesh.visible; }
  set visible(v) { this.mesh.visible = v; }
  // Start a redraw: background + frame, and forget the old buttons.
  begin(title) {
    const g = this.g;
    g.clearRect(0, 0, this.W, this.H);
    g.fillStyle = UI.bg; g.fillRect(0, 0, this.W, this.H);
    g.strokeStyle = UI.frame; g.lineWidth = 3; g.strokeRect(2, 2, this.W - 4, this.H - 4);
    this.buttons = [];
    this.boxes = [];                                   // text extents (the tests check nothing overlaps)
    if (title) this.text(title, this.W / 2, 62, { size: 46, bold: true, color: UI.title, align: 'center', maxW: this.W - 40 });
  }
  end() { this.tex.needsUpdate = true; }
  // Text that is shrunk (never overlapped or clipped) to fit maxW.
  text(str, x, y, o = {}) {
    const g = this.g;
    let size = o.size || 28;
    const font = (s) => `${o.bold ? 'bold ' : ''}${s}px monospace`;
    g.font = font(size);
    if (o.maxW) while (size > 10 && g.measureText(str).width > o.maxW) { size -= 1; g.font = font(size); }
    g.textAlign = o.align || 'left';
    g.textBaseline = 'alphabetic';
    g.fillStyle = o.color || UI.text;
    g.fillText(str, x, y);
    const w = g.measureText(str).width, al = o.align || 'left';
    const x0 = al === 'center' ? x - w / 2 : al === 'right' ? x - w : x;
    if (this.boxes) this.boxes.push({ str, x0, x1: x0 + w, y0: y - size * 0.78, y1: y + size * 0.22 });
    return size;
  }
  // A button: frame, hover / active fill, centred label that always fits.
  button(id, x, y, w, h, label, o = {}) {
    const g = this.g;
    this.buttons.push({ id, x, y, w, h });
    const hov = this.hover === id;
    if (o.active) { g.fillStyle = UI.active; g.fillRect(x, y, w, h); }
    if (hov) { g.fillStyle = UI.hover; g.fillRect(x, y, w, h); }
    // Subtle buttons (e.g. "skip") only show a frame when you point at them.
    if (!o.subtle || hov) {
      g.strokeStyle = o.active ? UI.gold : hov ? UI.title : UI.faint;
      g.lineWidth = o.big || hov || o.active ? 3 : 2;
      g.strokeRect(x + 1, y + 1, w - 2, h - 2);
    }
    const size = o.size || Math.min(34, Math.floor(h * 0.45));
    const col = o.active ? UI.gold : o.subtle && !hov ? UI.dim : o.color || UI.title;
    this.text(label, x + w / 2, y + h / 2 + size * 0.36, { size, bold: !!(o.big || o.active), color: col, align: 'center', maxW: w - 20 });
  }
  // Ray test: returns the button id under the ray (or '' on the panel, null off it) and the distance.
  pick(raycaster) {
    if (!this.mesh.visible) return null;
    const hit = raycaster.intersectObject(this.mesh, false)[0];
    if (!hit || !hit.uv) return null;
    const px = hit.uv.x * this.W, py = (1 - hit.uv.y) * this.H;
    const b = this.buttons.find((k) => px >= k.x && px <= k.x + k.w && py >= k.y && py <= k.y + k.h);
    return { id: b ? b.id : '', dist: hit.distance };
  }
  // World position of a button's centre (used by the tests to aim a controller at it).
  buttonWorld(id, out = new THREE.Vector3()) {
    const b = this.buttons.find((k) => k.id === id);
    if (!b) return null;
    const hM = (this.widthM * this.H) / this.W;
    out.set(((b.x + b.w / 2) / this.W - 0.5) * this.widthM, (0.5 - (b.y + b.h / 2) / this.H) * hM, 0);
    this.mesh.updateMatrixWorld(true);
    return this.mesh.localToWorld(out);
  }
}

// Face a panel toward a point, upright (yaw only).
export function faceYaw(mesh, target) {
  mesh.rotation.set(0, Math.atan2(target.x - mesh.position.x, target.z - mesh.position.z), 0);
}

// ---------------------------------------------------------------- animated icons
// A side view of a Quest Touch Plus controller (front to the right): the head with the thumbstick and
// two face buttons on top, the index trigger under the front of the head, and the grip on the front of
// the handle. Drawn in the hand's colour (right = cyan, left = gold); the part to use pulses green,
// exactly like the glowing part on the controller you hold in VR.
export const HAND_COLOR = { right: '#33ddff', left: '#ffcc66', either: '#bfefff' };
export const HI = '#55ff99';
const pulse = (t, f = 5) => 0.5 + 0.5 * Math.sin(t * f);
const hiCol = (t) => `rgba(85,255,153,${0.55 + 0.45 * pulse(t)})`;
// hi: 'trigger' | 'grip' | 'stick' | 'stickUp' | 'stickDown' | 'stickUpDown' | 'stickCircle' | 'stickClick' | 'release' | 'btn1' | 'btn2'
function controller(g, x, y, s, rot, hi, t, hand = 'right', ray = 0) {
  const col = HAND_COLOR[hand] || HAND_COLOR.right;
  const has = (k) => hi.includes(k);
  g.save();
  g.translate(x, y); g.rotate(rot);
  g.lineWidth = Math.max(2, s * 0.035);
  g.lineJoin = 'round';
  if (ray) {
    g.strokeStyle = 'rgba(255,255,255,0.75)'; g.setLineDash([s * 0.06, s * 0.05]);
    g.beginPath(); g.moveTo(s * 0.3, -s * 0.2); g.lineTo(s * 0.3 + ray, -s * 0.2); g.stroke(); g.setLineDash([]);
  }
  // Handle (down and back), then the head on top of it.
  g.save(); g.translate(-s * 0.06, -s * 0.12); g.rotate(0.38);
  g.fillStyle = 'rgba(0,10,22,0.9)'; g.strokeStyle = col;
  g.beginPath(); g.roundRect(-s * 0.11, 0, s * 0.22, s * 0.6, s * 0.1); g.fill(); g.stroke();
  // Grip button on the front of the handle.
  const gh = has('grip');
  g.fillStyle = gh ? hiCol(t) : 'rgba(127,233,255,0.22)'; g.strokeStyle = gh ? HI : col;
  g.beginPath(); g.roundRect(s * 0.05, s * 0.1, s * 0.09, s * 0.28, s * 0.04); g.fill(); g.stroke();
  if (gh) { g.strokeStyle = `rgba(85,255,153,${0.5 * pulse(t)})`; g.lineWidth = Math.max(2, s * 0.025); g.beginPath(); g.roundRect(s * 0.0, s * 0.05, s * 0.19, s * 0.38, s * 0.08); g.stroke(); g.lineWidth = Math.max(2, s * 0.035); }
  g.restore();
  // Trigger under the front of the head.
  const th = has('trigger');
  g.fillStyle = th ? hiCol(t) : 'rgba(127,233,255,0.22)'; g.strokeStyle = th ? HI : col;
  g.beginPath(); g.roundRect(s * 0.12, -s * 0.13, s * 0.1, s * 0.2, s * 0.05); g.fill(); g.stroke();
  if (th) { g.strokeStyle = `rgba(85,255,153,${0.5 * pulse(t)})`; g.beginPath(); g.arc(s * 0.17, -s * 0.03, s * 0.17, 0, Math.PI * 2); g.stroke(); }
  if (has('release')) {
    const k = (t * 1.2) % 1;
    g.strokeStyle = `rgba(255,255,255,${1 - k})`; g.beginPath(); g.moveTo(s * (0.3 + k * 0.12), -s * 0.03); g.lineTo(s * (0.42 + k * 0.12), -s * 0.03); g.stroke();
  }
  // Head.
  g.fillStyle = 'rgba(0,10,22,0.95)'; g.strokeStyle = col;
  g.beginPath(); g.roundRect(-s * 0.3, -s * 0.3, s * 0.6, s * 0.2, s * 0.09); g.fill(); g.stroke();
  // Face buttons (behind the stick) with their letters: A / X nearer your thumb, B / Y further forward.
  const letters = hand === 'left' ? ['X', 'Y'] : ['A', 'B'];
  g.fillStyle = col; g.strokeStyle = col;
  [-0.21, -0.1].forEach((bx, i) => {
    const bh = has(i ? 'btn2' : 'btn1');
    g.fillStyle = bh ? hiCol(t) : col;
    g.beginPath(); g.arc(s * bx, -s * 0.3, s * (bh ? 0.045 : 0.035), Math.PI, 0); g.fill();
    g.font = `bold ${Math.round(s * (bh ? 0.1 : 0.075))}px monospace`; g.textAlign = 'center';
    g.fillText(letters[i], s * bx, -s * 0.36);
    if (bh) { g.strokeStyle = `rgba(85,255,153,${0.5 * pulse(t)})`; g.beginPath(); g.arc(s * bx, -s * 0.32, s * 0.09, 0, Math.PI * 2); g.stroke(); }
  });
  g.fillStyle = col; g.strokeStyle = col;
  // Thumbstick (stem + cap), tilted / clicked when highlighted.
  const sh = hi.some((k) => k.startsWith('stick'));
  let tilt = 0;
  if (has('stickUp')) tilt = -Math.abs(Math.sin(t * 2.5)) * 0.5;
  if (has('stickDown')) tilt = Math.abs(Math.sin(t * 2.5)) * 0.5;
  if (has('stickUpDown')) tilt = Math.sin(t * 2.2) * 0.5;
  if (has('stickCircle')) tilt = Math.sin(t * 2) * 0.5;
  const click = has('stickClick') ? Math.max(0, Math.sin(t * 5)) * s * 0.025 : 0;
  g.save(); g.translate(s * 0.08, -s * 0.3 + click); g.rotate(tilt);
  g.strokeStyle = sh ? HI : col; g.fillStyle = sh ? hiCol(t) : col;
  g.beginPath(); g.moveTo(0, 0); g.lineTo(0, -s * 0.07); g.stroke();
  g.beginPath(); g.ellipse(0, -s * 0.085, s * 0.08, s * 0.03, 0, 0, Math.PI * 2); g.fill();
  g.restore();
  if (has('stickClick')) { g.strokeStyle = `rgba(85,255,153,${0.8 * (1 - pulse(t, 5))})`; g.beginPath(); g.ellipse(s * 0.08, -s * 0.39, s * (0.1 + 0.05 * pulse(t, 5)), s * (0.04 + 0.02 * pulse(t, 5)), 0, 0, Math.PI * 2); g.stroke(); }
  if (sh && !has('stickClick')) { g.strokeStyle = `rgba(85,255,153,${0.5 * pulse(t)})`; g.beginPath(); g.arc(s * 0.08, -s * 0.37, s * 0.13, 0, Math.PI * 2); g.stroke(); }
  g.restore();
}
function ship(g, x, y, s, ang, col = '#33ddff') {
  g.save(); g.translate(x, y); g.rotate(ang);
  g.strokeStyle = col; g.lineWidth = Math.max(2, s * 0.08);
  g.beginPath(); g.moveTo(s * 0.5, 0); g.lineTo(-s * 0.35, -s * 0.3); g.lineTo(-s * 0.15, 0); g.lineTo(-s * 0.35, s * 0.3); g.closePath(); g.stroke();
  g.restore();
}
function dart(g, x, y, s, ang, col = '#33ddff') {
  g.save(); g.translate(x, y); g.rotate(ang);
  g.fillStyle = 'rgba(51,221,255,0.35)'; g.strokeStyle = col; g.lineWidth = Math.max(2, s * 0.1); g.lineJoin = 'round';
  g.beginPath(); g.moveTo(s * 0.6, 0); g.lineTo(-s * 0.4, -s * 0.38); g.lineTo(-s * 0.15, 0); g.lineTo(-s * 0.4, s * 0.38); g.closePath(); g.fill(); g.stroke();
  g.restore();
}
function arrow(g, x0, y0, x1, y1, col = 'rgba(255,255,255,0.8)') {
  g.strokeStyle = col; g.fillStyle = col; g.lineWidth = 3;
  g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
  const a = Math.atan2(y1 - y0, x1 - x0);
  g.beginPath(); g.moveTo(x1, y1); g.lineTo(x1 - 14 * Math.cos(a - 0.45), y1 - 14 * Math.sin(a - 0.45)); g.lineTo(x1 - 14 * Math.cos(a + 0.45), y1 - 14 * Math.sin(a + 0.45)); g.closePath(); g.fill();
}
function cube(g, x, y, r, col = 'rgba(80,220,255,0.85)') {
  g.strokeStyle = col; g.lineWidth = 3;
  const o = r * 0.45;
  g.strokeRect(x - r, y - r + o * 0.5, 2 * r - o, 2 * r - o);
  g.strokeRect(x - r + o, y - r - o * 0.5, 2 * r - o, 2 * r - o);
  g.beginPath();
  g.moveTo(x - r, y - r + o * 0.5); g.lineTo(x - r + o, y - r - o * 0.5);
  g.moveTo(x + r - o, y - r + o * 0.5); g.lineTo(x + r, y - r - o * 0.5);
  g.moveTo(x - r, y + r - o * 0.5); g.lineTo(x - r + o, y + r - o * 1.5);
  g.moveTo(x + r - o, y + r - o * 0.5); g.lineTo(x + r, y + r - o * 1.5);
  g.stroke();
}
function ring(g, x, y, r, col, w = 3) { g.strokeStyle = col; g.lineWidth = w; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.stroke(); }
// Four ships side by side, all heading `ang` (default: to the right, toward the target).
function formation(g, x, y, s, spread, col = '#33ddff', ang = 0) {
  const px = -Math.sin(ang), py = Math.cos(ang), ax = Math.cos(ang), ay = Math.sin(ang);
  for (let i = 0; i < 4; i++) {
    const o = (i - 1.5) * s * (0.3 + spread), b = (i % 2) * spread * s * 0.5;
    dart(g, x + px * o - ax * b, y + py * o - ay * b, s * 0.26, ang, col);
  }
}
function bullets(g, x0, y0, x1, y1, t, n = 3, col = '136,244,255') {
  for (let i = 0; i < n; i++) {
    const f = (t * 1.5 + i / n) % 1;
    g.fillStyle = `rgba(${col},${1 - f * 0.7})`;
    g.beginPath(); g.arc(x0 + (x1 - x0) * f, y0 + (y1 - y0) * f, 4, 0, Math.PI * 2); g.fill();
  }
}
// Draw icon `kind` centred at (x, y), about `s` pixels tall, at animation time t (seconds), for `hand`.
// Layout is the same for every icon: the controller on the left, what it does on the right.
export function drawIcon(g, kind, x, y, s, t, hand = 'right') {
  g.save();
  const cx = x - s * 0.3, cy = y + s * 0.12, cs = s * 0.8;      // controller
  const ex = x + s * 0.38, ey = y;                               // effect
  switch (kind) {
    case 'room': {
      const k = Math.sin(t * 0.8);
      cube(g, x, y, s * 0.34);
      ship(g, x + k * s * 0.08, y + s * 0.02, s * 0.14, k * 0.6, '#33ddff');
      break;
    }
    case 'gripMove': {
      const dx = Math.sin(t * 1.4) * s * 0.12;
      controller(g, cx + dx, cy, cs, 0, ['grip'], t, hand);
      cube(g, ex + dx, ey, s * 0.16);
      arrow(g, ex - s * 0.05, ey + s * 0.3, ex + s * 0.18, ey + s * 0.3);
      arrow(g, ex + s * 0.05, ey + s * 0.3, ex - s * 0.18, ey + s * 0.3);
      break;
    }
    case 'gripResize': {
      const k = 1 + 0.4 * Math.sin(t * 2.2);
      controller(g, cx, cy, cs, 0, ['grip', 'stickUpDown'], t, hand);
      cube(g, ex, ey, s * 0.14 * k);
      break;
    }
    case 'mirror': case 'steerHand': {
      const a = Math.sin(t * 1.2) * 0.4;
      controller(g, cx, cy, cs, a, [], t, hand);
      arrow(g, x - s * 0.02, y, x + s * 0.12, y);
      ship(g, ex + s * 0.05, ey, s * 0.32, a * 2);
      break;
    }
    case 'relative': {
      const a = Math.sin(t * 1.2) * 0.35;
      controller(g, cx, cy, cs, a, [], t, hand);
      ring(g, ex, ey, s * 0.18, 'rgba(127,233,255,0.6)');
      g.fillStyle = '#ffffff'; g.beginPath(); g.arc(ex + a * s * 0.4, ey, s * 0.04, 0, Math.PI * 2); g.fill();
      break;
    }
    case 'point': {
      const a = Math.sin(t * 1.2) * 0.3;
      controller(g, cx, cy, cs, a, [], t, hand, s * 0.35);
      ship(g, ex + s * 0.05, ey + Math.sin(a) * s * 0.5 - s * 0.05, s * 0.26, a);
      break;
    }
    case 'stick': {
      controller(g, cx, cy, cs, 0, ['stickCircle'], t, hand);
      ship(g, ex + s * 0.05, ey, s * 0.32, Math.sin(t * 2) * 0.6);
      break;
    }
    case 'trigger': {
      controller(g, cx, cy, cs, 0, ['trigger'], t, hand);
      ship(g, ex - s * 0.08, ey, s * 0.24, 0);
      bullets(g, ex + s * 0.06, ey, ex + s * 0.4, ey, t);
      break;
    }
    case 'boost': {
      controller(g, cx, cy, cs, 0, ['grip'], t, hand);
      ship(g, ex + s * 0.12, ey, s * 0.28, 0);
      for (let i = 0; i < 4; i++) {
        const f = (t * 2 + i / 4) % 1;
        g.strokeStyle = `rgba(255,204,102,${0.8 * (1 - f)})`; g.lineWidth = 3;
        const yy = ey - s * 0.1 + i * s * 0.065;
        g.beginPath(); g.moveTo(ex - s * (0.02 + f * 0.25), yy); g.lineTo(ex - s * (0.14 + f * 0.25), yy); g.stroke();
      }
      break;
    }
    case 'target': {
      controller(g, cx, cy, cs, 0, ['trigger'], t, hand);
      ship(g, ex - s * 0.12, ey + s * 0.05, s * 0.2, -0.3);
      const tx = ex + s * 0.3, ty = ey - s * 0.12;
      ship(g, tx, ty, s * 0.18, Math.PI, '#ff4455');
      ring(g, tx, ty, s * (0.12 + 0.02 * pulse(t, 6)), 'rgba(255,68,85,0.8)', 2);
      bullets(g, ex - s * 0.02, ey + s * 0.02, tx, ty, t);
      break;
    }
    case 'squad': {
      // Four filled darts in a V, all heading the same way (up), with the heading arrow ahead.
      const V = [[-0.28, -0.3], [-0.12, -0.1], [-0.12, 0.1], [-0.28, 0.3]];
      const k = Math.sin(t * 1.5) * s * 0.02;
      for (const [vx, vy] of V) dart(g, x + vx * s + k, y + vy * s, s * 0.17, 0);
      arrow(g, x + s * 0.02, y, x + s * 0.36, y, 'rgba(127,233,255,0.8)');
      break;
    }
    case 'engage': {
      controller(g, cx, cy, cs, 0, ['trigger'], t, hand);
      const sp = 0.05 + 0.2 * pulse(t, 2);
      formation(g, ex - s * 0.08, ey, s * 0.45, sp);
      ship(g, ex + s * 0.32, ey, s * 0.18, Math.PI, '#ff4455');
      bullets(g, ex + s * 0.02, ey, ex + s * 0.28, ey, t);
      break;
    }
    case 'regroup': {
      controller(g, cx, cy, cs, 0, ['release'], t, hand);
      const sp = 0.3 * (0.5 + 0.5 * Math.cos(t * 1.5));
      formation(g, ex + s * 0.05, ey, s * 0.45, sp);
      break;
    }
    case 'roll': {
      // A quick wrist twist, and the ship snap-rolls sideways.
      const k = (t * 0.9) % 1, tw = k < 0.25 ? Math.sin((k / 0.25) * Math.PI) * 0.6 : 0;
      controller(g, cx, cy, cs, 0, [], t, hand);
      g.strokeStyle = HI; g.lineWidth = 3;
      g.beginPath(); g.arc(cx + cs * 0.02, cy - cs * 0.2, cs * 0.34, -Math.PI * 0.8, -Math.PI * 0.8 + Math.PI * 0.6 * (0.3 + tw)); g.stroke();
      const u = k < 0.5 ? k / 0.5 : 1, dx = Math.sin(u * Math.PI / 2) * s * 0.22;
      g.save(); g.translate(ex - s * 0.12 + dx, ey); g.scale(1, Math.cos(u * Math.PI * 2)); ship(g, 0, 0, s * 0.3, -Math.PI / 2); g.restore();
      arrow(g, ex - s * 0.12, ey + s * 0.25, ex + s * 0.14, ey + s * 0.25, 'rgba(255,255,255,0.6)');
      break;
    }
    case 'split': {
      // Four ships part into a cyan pair (right hand) and a gold pair (left hand).
      controller(g, cx, cy, cs, 0, ['stickClick'], t, hand);
      const k = 0.5 + 0.5 * Math.sin(t * 1.6), off = s * 0.18 * k;
      for (let i = 0; i < 2; i++) dart(g, ex + (i - 0.5) * s * 0.14, ey - off - s * 0.02, s * 0.15, -Math.PI / 2 - 0.25 * k, '#33ddff');
      for (let i = 0; i < 2; i++) dart(g, ex + (i - 0.5) * s * 0.14, ey + off + s * 0.02, s * 0.15, -Math.PI / 2 + 0.25 * k, '#ffbb44');
      break;
    }
    case 'leadGold': {
      const a = Math.sin(t * 1.2) * 0.4;
      controller(g, cx, cy, cs, a, [], t, hand);
      arrow(g, x - s * 0.02, y, x + s * 0.1, y);
      formation(g, ex + s * 0.08, ey, s * 0.3, 0.1, '#ffbb44', a * 2);
      break;
    }
    case 'rejoin': {
      controller(g, cx, cy, cs, 0, ['stickClick'], t, hand);
      const k = 0.5 + 0.5 * Math.sin(t * 1.6), off = s * 0.18 * (1 - k);
      dart(g, ex - s * 0.21, ey - off, s * 0.15, 0, '#33ddff'); dart(g, ex - s * 0.07, ey - off, s * 0.15, 0, '#33ddff');
      dart(g, ex + s * 0.07, ey + off, s * 0.15, 0, '#ffbb44'); dart(g, ex + s * 0.21, ey + off, s * 0.15, 0, '#ffbb44');
      break;
    }
    case 'formation': {
      // B cycles line -> wedge -> ring.
      controller(g, cx, cy, cs, 0, ['btn2'], t, hand);
      const which = Math.floor(t * 0.8) % 3, sz = s * 0.13;
      const pts = which === 0 ? [[-1.5, 0], [-0.5, 0], [0.5, 0], [1.5, 0]]
        : which === 1 ? [[-1.2, 0.9], [-0.4, 0.3], [0.4, 0.3], [1.2, 0.9]]
          : [[0, -1], [1, 0], [0, 1], [-1, 0]];
      for (const [px, py] of pts) dart(g, ex + s * 0.05 + px * s * 0.1, ey + py * s * 0.1, sz, -Math.PI / 2);
      g.fillStyle = '#ffcc66'; g.font = `bold ${Math.round(s * 0.08)}px monospace`; g.textAlign = 'center';
      g.fillText(['LINE', 'WEDGE', 'RING'][which], ex + s * 0.05, ey + s * 0.3);
      break;
    }
    case 'check': {
      g.strokeStyle = '#66ff99'; g.lineWidth = Math.max(8, s * 0.06); g.lineCap = 'round'; g.beginPath();
      g.moveTo(x - s * 0.25, y); g.lineTo(x - s * 0.05, y + s * 0.2); g.lineTo(x + s * 0.3, y - s * 0.22); g.stroke();
      break;
    }
    default: break;
  }
  g.restore();
}
