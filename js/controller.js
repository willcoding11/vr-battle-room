// The controllers keep their original look: the small wireframe gizmo at each hand (target-ray space,
// -Z = pointing direction). For the tutorial, the button to use is marked on it with a pulsing green
// marker at roughly where that button sits, plus a small label, so you can see which button on which hand.
import * as THREE from '../vendor/three.module.js';
import { buildControllerGizmo } from './models.js?v=22';

export const HI_COLOR = 0x55ff99;
const LABELS = { trigger: 'TRIGGER', grip: 'GRIP', stick: 'STICK', stickClick: 'CLICK STICK', body: 'TURN' };

function labelSprite(text) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 72;
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(0,14,10,0.85)'; g.fillRect(0, 0, 256, 72);
  g.strokeStyle = '#55ff99'; g.lineWidth = 4; g.strokeRect(2, 2, 252, 68);
  g.fillStyle = '#88ffbb'; g.font = 'bold 40px monospace'; g.textAlign = 'center'; g.textBaseline = 'middle';
  let size = 40;
  while (size > 16 && g.measureText(text).width > 236) { size -= 2; g.font = `bold ${size}px monospace`; }
  g.fillText(text, 128, 38);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false, fog: false }));
  s.scale.set(0.045, 0.045 * 72 / 256, 1);
  s.renderOrder = 41;
  return s;
}
// A glowing marker: a small bright dot inside a wire sphere.
function marker(r) {
  const g = new THREE.Group();
  const halo = new THREE.Mesh(new THREE.SphereGeometry(r, 10, 8),
    new THREE.MeshBasicMaterial({ color: HI_COLOR, wireframe: true, transparent: true, opacity: 0.8, depthTest: false, fog: false }));
  const core = new THREE.Mesh(new THREE.SphereGeometry(r * 0.45, 8, 6),
    new THREE.MeshBasicMaterial({ color: HI_COLOR, transparent: true, opacity: 0.9, depthTest: false, fog: false }));
  halo.renderOrder = core.renderOrder = 40;
  g.add(halo, core);
  g.visible = false;
  return g;
}

export function createTouchController(hand, color) {
  const side = hand === 'left' ? -1 : 1;           // outer side of the hand (+X for the right hand)
  const root = new THREE.Group();
  root.name = 'ctrl-' + hand;
  const gizmo = buildControllerGizmo(color);     // the original look
  root.add(gizmo);
  // Where each button roughly is on a Touch controller held in that hand.
  const spots = {
    trigger: [0, -0.022, -0.035],
    grip: [-side * 0.022, -0.02, 0.01],
    stick: [-side * 0.008, 0.022, -0.005],
    stickClick: [-side * 0.008, 0.022, -0.005],
    btn1: [side * 0.01, 0.022, 0.012],
    btn2: [side * 0.012, 0.022, -0.008],
    body: [0, 0, -0.015],
  };
  const markers = {};
  for (const k in spots) {
    const m = marker(k === 'body' ? 0.05 : 0.009);
    m.position.fromArray(spots[k]);
    root.add(m);
    markers[k] = m;
  }
  const labels = {};
  const leaderMat = new THREE.LineBasicMaterial({ color: HI_COLOR, transparent: true, opacity: 0.9, depthTest: false, fog: false });
  function label(key) {
    if (labels[key]) return labels[key];
    let text = LABELS[key] || key.toUpperCase();
    if (key === 'btn1') text = hand === 'left' ? 'X' : 'A';
    if (key === 'btn2') text = hand === 'left' ? 'Y' : 'B';
    const s = labelSprite(text);
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), leaderMat);
    line.renderOrder = 40;
    root.add(s, line);
    labels[key] = { s, line };
    return labels[key];
  }
  let hi = [];
  function setHighlight(list) {
    hi = (list || []).filter((k) => spots[k]);
    for (const k in labels) { labels[k].s.visible = false; labels[k].line.visible = false; }
    for (const k in markers) markers[k].visible = false;
    for (const m of gizmo.userData.mats) m.color.copy(gizmo.userData.baseColor);
    // Labels stacked on the outer side of the hand, each with a line to its marker.
    hi.forEach((k, i) => {
      markers[k].visible = true;
      const L = label(k);
      L.s.visible = true; L.line.visible = true;
      L.s.position.set(side * 0.065, 0.035 - i * 0.02, -0.01);
      const a = L.line.geometry.attributes.position;
      const p = spots[k];
      a.setXYZ(0, p[0] + (k === 'body' ? side * 0.05 : 0), p[1], p[2]);
      a.setXYZ(1, L.s.position.x - side * 0.022, L.s.position.y, L.s.position.z);
      a.needsUpdate = true;
    });
  }
  const _c = new THREE.Color();
  function update(t) {
    if (!hi.length) return;
    const pulse = 0.5 + 0.5 * Math.sin(t * 6);
    for (const k of hi) {
      const m = markers[k];
      m.scale.setScalar(k === 'body' ? 1 + 0.1 * pulse : 1 + 0.6 * pulse);
      m.children[0].material.opacity = 0.4 + 0.6 * pulse;
      m.children[1].material.opacity = k === 'body' ? 0 : 0.5 + 0.5 * pulse;
      if (k === 'body') for (const mm of gizmo.userData.mats) mm.color.copy(_c.copy(gizmo.userData.baseColor).lerp(_c.set(HI_COLOR), pulse));
    }
  }
  setHighlight([]);
  return { root, setHighlight, update, get highlight() { return hi; } };
}
