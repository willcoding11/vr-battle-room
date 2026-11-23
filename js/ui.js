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
    g.strokeStyle = o.active ? UI.gold : hov ? UI.title : UI.faint;
    g.lineWidth = o.big || hov || o.active ? 3 : 2;
    g.strokeRect(x + 1, y + 1, w - 2, h - 2);
    const size = o.size || Math.min(34, Math.floor(h * 0.45));
    this.text(label, x + w / 2, y + h / 2 + size * 0.36, { size, bold: !!(o.big || o.active), color: o.active ? UI.gold : o.color || UI.title, align: 'center', maxW: w - 20 });
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
// A side-view sketch of a Touch controller: handle, tracking ring, thumbstick, trigger and grip.
// `hi` lists the parts to highlight (pulsing gold): 'trigger' | 'grip' | 'stick' | 'stickUp' | 'stickDown' | 'stickCircle'.
const pulse = (t, f = 4) => 0.55 + 0.45 * Math.sin(t * f);
function controller(g, x, y, s, rot, hi, t, ray) {
  g.save();
  g.translate(x, y); g.rotate(rot);
  g.lineWidth = Math.max(2, s * 0.05);
  const base = '#7fe9ff';
  const gold = `rgba(255,204,102,${pulse(t)})`;
  if (ray) {
    g.strokeStyle = 'rgba(255,204,102,0.7)'; g.setLineDash([s * 0.08, s * 0.06]);
    g.beginPath(); g.moveTo(0, -s * 0.5); g.lineTo(0, -s * 0.5 - ray); g.stroke(); g.setLineDash([]);
  }
  // Handle.
  g.strokeStyle = base;
  g.beginPath(); g.roundRect(-s * 0.17, -s * 0.1, s * 0.34, s * 0.95, s * 0.14); g.stroke();
  // Tracking ring.
  g.beginPath(); g.arc(0, -s * 0.32, s * 0.36, Math.PI * 0.85, Math.PI * 2.15); g.stroke();
  // Thumbstick (on top).
  let sx = 0, sy = 0;
  if (hi.includes('stickUp')) sy = -Math.abs(Math.sin(t * 2.5)) * s * 0.07;
  if (hi.includes('stickDown')) sy = Math.abs(Math.sin(t * 2.5)) * s * 0.07;
  if (hi.includes('stickCircle')) { sx = Math.cos(t * 2) * s * 0.06; sy = Math.sin(t * 2) * s * 0.06; }
  const stickHi = hi.some((h) => h.startsWith('stick'));
  g.fillStyle = stickHi ? gold : base;
  g.beginPath(); g.arc(sx, -s * 0.12 + sy, s * 0.075, 0, Math.PI * 2); g.fill();
  if (hi.includes('stickClick')) { g.strokeStyle = gold; g.beginPath(); g.arc(0, -s * 0.12, s * (0.12 + 0.06 * pulse(t, 6)), 0, Math.PI * 2); g.stroke(); }
  // Trigger (front, under the ring) and grip (side of the handle).
  g.fillStyle = hi.includes('trigger') ? gold : 'rgba(127,233,255,0.35)';
  g.beginPath(); g.roundRect(-s * 0.32, s * 0.02, s * 0.14, s * 0.2, s * 0.05); g.fill();
  g.fillStyle = hi.includes('grip') ? gold : 'rgba(127,233,255,0.35)';
  g.beginPath(); g.roundRect(s * 0.12, s * 0.28, s * 0.13, s * 0.36, s * 0.05); g.fill();
  g.restore();
}
function ship(g, x, y, s, ang, col = '#33ddff') {
  g.save(); g.translate(x, y); g.rotate(ang);
  g.strokeStyle = col; g.lineWidth = Math.max(2, s * 0.08);
  g.beginPath(); g.moveTo(s * 0.5, 0); g.lineTo(-s * 0.35, -s * 0.3); g.lineTo(-s * 0.15, 0); g.lineTo(-s * 0.35, s * 0.3); g.closePath(); g.stroke();
  g.restore();
}
function arrow(g, x0, y0, x1, y1, col = 'rgba(255,204,102,0.9)') {
  g.strokeStyle = col; g.fillStyle = col; g.lineWidth = 3;
  g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
  const a = Math.atan2(y1 - y0, x1 - x0);
  g.beginPath(); g.moveTo(x1, y1); g.lineTo(x1 - 12 * Math.cos(a - 0.45), y1 - 12 * Math.sin(a - 0.45)); g.lineTo(x1 - 12 * Math.cos(a + 0.45), y1 - 12 * Math.sin(a + 0.45)); g.closePath(); g.fill();
}
function cube(g, x, y, r, col = 'rgba(80,220,255,0.8)') {
  g.strokeStyle = col; g.lineWidth = 2;
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
function ring(g, x, y, r, col) { g.strokeStyle = col; g.lineWidth = 3; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.stroke(); }
function formation(g, x, y, s, spread, col = '#33ddff') {
  for (let i = 0; i < 4; i++) ship(g, x + (i - 1.5) * s * (0.35 + spread), y + (i % 2) * spread * s * 0.5, s * 0.3, -Math.PI / 2, col);
}

// Draw icon `kind` centred at (x, y), about `s` pixels tall, at animation time t (seconds).
export function drawIcon(g, kind, x, y, s, t) {
  g.save();
  switch (kind) {
    case 'gripMove': {
      const dx = Math.sin(t * 1.6) * s * 0.35;
      controller(g, x - s * 0.25 + dx, y + s * 0.1, s * 0.75, -0.25, ['grip'], t);
      cube(g, x + s * 0.45 + dx, y - s * 0.1, s * 0.18);
      arrow(g, x - s * 0.05, y - s * 0.48, x + s * 0.35, y - s * 0.48);
      arrow(g, x - s * 0.05, y - s * 0.48, x - s * 0.45, y - s * 0.48);
      break;
    }
    case 'gripResize': {
      const k = 1 + 0.35 * Math.sin(t * 1.6);
      controller(g, x - s * 0.3, y + s * 0.1, s * 0.75, -0.25, ['grip', Math.sin(t * 1.6) > 0 ? 'stickUp' : 'stickDown'], t);
      cube(g, x + s * 0.4, y, s * 0.16 * k);
      break;
    }
    case 'mirror': {
      const a = Math.sin(t * 1.2) * 0.45;
      controller(g, x - s * 0.3, y + s * 0.15, s * 0.7, a, [], t);
      ship(g, x + s * 0.38, y, s * 0.4, -Math.PI / 2 + a * 2);
      arrow(g, x - s * 0.05, y - s * 0.05, x + s * 0.12, y - s * 0.05, 'rgba(127,233,255,0.6)');
      break;
    }
    case 'relative': {
      const a = Math.sin(t * 1.2) * 0.35;
      controller(g, x - s * 0.3, y + s * 0.15, s * 0.7, a, [], t);
      ring(g, x + s * 0.38, y, s * 0.22, 'rgba(127,233,255,0.6)');
      g.fillStyle = '#ffffff'; g.beginPath(); g.arc(x + s * 0.38 + a * s * 0.5, y, s * 0.05, 0, Math.PI * 2); g.fill();
      break;
    }
    case 'point': {
      const a = Math.sin(t * 1.2) * 0.4;
      controller(g, x - s * 0.15, y + s * 0.3, s * 0.6, a, [], t, s * 0.5);
      ship(g, x - s * 0.15 + Math.sin(a) * s * 0.85, y + s * 0.3 - Math.cos(a) * s * 0.85, s * 0.28, -Math.PI / 2 + a);
      break;
    }
    case 'stick': {
      controller(g, x - s * 0.3, y + s * 0.15, s * 0.75, -0.2, ['stickCircle'], t);
      ship(g, x + s * 0.38, y, s * 0.4, -Math.PI / 2 + Math.cos(t * 2) * 0.6);
      break;
    }
    case 'trigger': {
      controller(g, x - s * 0.3, y + s * 0.15, s * 0.75, -0.3, ['trigger'], t);
      ship(g, x + s * 0.12, y, s * 0.3, 0);
      for (let i = 0; i < 3; i++) {
        const f = (t * 1.5 + i / 3) % 1;
        g.fillStyle = `rgba(136,244,255,${1 - f})`;
        g.fillRect(x + s * (0.3 + f * 0.4), y - 2, s * 0.08, 4);
      }
      break;
    }
    case 'boost': {
      controller(g, x - s * 0.3, y + s * 0.15, s * 0.75, -0.3, ['grip'], t);
      ship(g, x + s * 0.35, y, s * 0.32, 0);
      for (let i = 0; i < 4; i++) {
        const f = (t * 2 + i / 4) % 1;
        g.strokeStyle = `rgba(255,204,102,${0.8 * (1 - f)})`; g.lineWidth = 3;
        g.beginPath(); g.moveTo(x + s * (0.18 - f * 0.25), y - s * 0.12 + i * s * 0.08); g.lineTo(x + s * (0.05 - f * 0.25), y - s * 0.12 + i * s * 0.08); g.stroke();
      }
      break;
    }
    case 'engage': {
      controller(g, x - s * 0.35, y + s * 0.15, s * 0.7, -0.3, ['trigger'], t);
      const sp = 0.25 + 0.2 * (0.5 + 0.5 * Math.sin(t * 2));
      formation(g, x + s * 0.3, y + s * 0.1, s * 0.6, sp);
      ship(g, x + s * 0.3, y - s * 0.35, s * 0.22, Math.PI / 2, '#ff4455');
      break;
    }
    case 'regroup': {
      controller(g, x - s * 0.35, y + s * 0.15, s * 0.7, -0.3, [], t);
      const sp = 0.45 * (0.5 + 0.5 * Math.cos(t * 1.5));
      formation(g, x + s * 0.3, y, s * 0.6, sp);
      break;
    }
    case 'selectRay': {
      controller(g, x - s * 0.25, y + s * 0.35, s * 0.55, 0.45, ['trigger'], t, s * 0.55);
      ring(g, x + s * 0.2, y - s * 0.3, s * (0.15 + 0.03 * pulse(t, 6)), '#ffffff');
      formation(g, x + s * 0.2, y - s * 0.3, s * 0.35, 0.1, '#3d8bff');
      break;
    }
    case 'selectAll': {
      controller(g, x - s * 0.3, y + s * 0.2, s * 0.65, -0.2, ['stickClick'], t);
      const c = ['#3d8bff', '#44ff88', '#ffcc33', '#a8f0ff'];
      for (let i = 0; i < 4; i++) ring(g, x + s * 0.25 + (i % 2) * s * 0.22, y - s * 0.25 + Math.floor(i / 2) * s * 0.3, s * 0.09, c[i]);
      break;
    }
    case 'orderHold': case 'orderGuard': case 'orderFollow': case 'orderAttack': {
      controller(g, x - s * 0.3, y + s * 0.35, s * 0.55, 0.5, ['grip'], t, s * 0.5);
      const tx = x + s * 0.25, ty = y - s * 0.3;
      if (kind === 'orderHold') { g.strokeStyle = UI.gold; g.lineWidth = 3; g.beginPath(); g.moveTo(tx - 12, ty - 12); g.lineTo(tx + 12, ty + 12); g.moveTo(tx + 12, ty - 12); g.lineTo(tx - 12, ty + 12); g.stroke(); }
      if (kind === 'orderGuard') { ring(g, tx, ty, s * 0.16, 'rgba(160,185,220,0.9)'); ship(g, tx + s * 0.22, ty, s * 0.15, -Math.PI / 2); }
      if (kind === 'orderFollow') { ship(g, tx, ty, s * 0.2, 0, '#a8f0ff'); ship(g, tx - s * 0.25 - (t * 20) % 8, ty + s * 0.05, s * 0.14, 0, '#3d8bff'); }
      if (kind === 'orderAttack') { ship(g, tx, ty, s * 0.22, Math.PI, '#ff4455'); ring(g, tx, ty, s * (0.18 + 0.03 * pulse(t, 6)), '#ff4455'); }
      break;
    }
    case 'capital': {
      g.strokeStyle = '#a8f0ff'; g.lineWidth = 3;
      g.beginPath(); g.moveTo(x - s * 0.45, y); g.lineTo(x - s * 0.2, y - s * 0.14); g.lineTo(x + s * 0.4, y - s * 0.08); g.lineTo(x + s * 0.48, y);
      g.lineTo(x + s * 0.4, y + s * 0.08); g.lineTo(x - s * 0.2, y + s * 0.14); g.closePath(); g.stroke();
      for (let i = 0; i < 3; i++) {
        const f = (t * 1.3 + i / 3) % 1;
        g.fillStyle = `rgba(136,244,255,${1 - f})`;
        g.fillRect(x + s * (-0.1 + i * 0.2), y - s * (0.16 + f * 0.35), 3, s * 0.08);
      }
      formation(g, x, y + s * 0.38, s * 0.45, 0.15, '#3d8bff');
      break;
    }
    case 'check': {
      g.strokeStyle = '#66ff99'; g.lineWidth = 8; g.beginPath();
      g.moveTo(x - s * 0.25, y); g.lineTo(x - s * 0.05, y + s * 0.2); g.lineTo(x + s * 0.3, y - s * 0.22); g.stroke();
      break;
    }
    default: break;
  }
  g.restore();
}
