// Wireframe Quest Touch Plus controller drawn at each hand (target-ray space: -Z = pointing direction).
// The tutorial can make a part glow (pulsing green) with a small label next to it, so you can see
// exactly which button on which hand to use.
import * as THREE from '../vendor/three.module.js';

export const HI_COLOR = 0x55ff99;
const LABELS = { trigger: 'TRIGGER', grip: 'GRIP', stick: 'STICK', stickClick: 'CLICK STICK', btn1: 'A', btn2: 'B', body: 'TURN' };

function wire(geo, color, opacity) {
  return new THREE.LineSegments(new THREE.EdgesGeometry(geo, 20),
    new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthWrite: false, fog: false }));
}
function part(geo, color) {
  const g = new THREE.Group();
  const fill = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.3, depthWrite: false, fog: false }));
  const edge = wire(geo, color, 0.9);
  g.add(fill, edge);
  g.userData = { fill, edge };
  return g;
}
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

export function createTouchController(hand, color) {
  const side = hand === 'left' ? -1 : 1;           // outer side of the hand (+X for the right hand)
  const root = new THREE.Group();
  root.name = 'touch-' + hand;
  // Head (the rounded top with the stick and buttons) and the handle, angled down and back.
  const headGeo = new THREE.CylinderGeometry(0.026, 0.024, 0.02, 14);
  const head = wire(headGeo, color, 0.6);
  head.scale.set(1, 1, 1.25);
  head.position.set(0, 0, 0.012);
  root.add(head);
  const handle = new THREE.Group();
  handle.rotation.x = -0.7;
  handle.position.set(0, -0.046, 0.05);
  const handleBody = wire(new THREE.CylinderGeometry(0.015, 0.013, 0.09, 10), color, 0.6);
  handle.add(handleBody);
  root.add(handle);
  const parts = {};
  // Thumbstick (inner side of the face), face buttons (outer side).
  parts.stick = part(new THREE.CylinderGeometry(0.0065, 0.0065, 0.007, 12), color);
  parts.stick.position.set(-side * 0.009, 0.014, 0.006);
  parts.btn1 = part(new THREE.CylinderGeometry(0.0048, 0.0048, 0.004, 10), color);
  parts.btn1.position.set(side * 0.01, 0.012, 0.018);
  parts.btn2 = part(new THREE.CylinderGeometry(0.0048, 0.0048, 0.004, 10), color);
  parts.btn2.position.set(side * 0.012, 0.012, 0.002);
  // Index trigger under the front of the head; grip on the inner side of the handle.
  parts.trigger = part(new THREE.BoxGeometry(0.012, 0.009, 0.018), color);
  parts.trigger.position.set(0, -0.017, -0.008);
  parts.trigger.rotation.x = -0.4;
  parts.grip = part(new THREE.BoxGeometry(0.007, 0.034, 0.016), color);
  parts.grip.position.set(-side * 0.014, 0.008, -0.004);
  handle.add(parts.grip);
  for (const k of ['stick', 'btn1', 'btn2', 'trigger']) root.add(parts[k]);
  parts.stickClick = parts.stick;
  const body = [head, handleBody];
  // Labels (created on demand) and their leader lines.
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
  const _p = new THREE.Vector3();
  function setHighlight(list) {
    hi = (list || []).slice();
    for (const k in labels) { labels[k].s.visible = false; labels[k].line.visible = false; }
    const all = new Set(Object.values(parts));
    for (const p of all) { p.scale.setScalar(1); p.userData.fill.material.color.setHex(color); p.userData.edge.material.color.setHex(color); p.userData.fill.material.opacity = 0.3; }
    for (const b of body) { b.material.color.setHex(color); b.material.opacity = 0.6; }
    // Stack the labels on the outer side of the hand, top to bottom.
    hi.forEach((k, i) => {
      const L = label(k);
      L.s.visible = true; L.line.visible = true;
      L.s.position.set(side * 0.065, 0.03 - i * 0.02, 0.0);
    });
  }
  function update(t) {
    if (!hi.length) return;
    const pulse = 0.5 + 0.5 * Math.sin(t * 6);
    root.updateMatrixWorld(true);
    hi.forEach((k) => {
      const L = labels[k];
      if (k === 'body') {
        for (const b of body) { b.material.color.setHex(HI_COLOR); b.material.opacity = 0.5 + 0.5 * pulse; }
        _p.set(0, 0, 0.012);
      } else {
        const p = parts[k];
        if (!p) return;
        p.scale.setScalar(1.15 + 0.3 * pulse);
        p.userData.fill.material.color.setHex(HI_COLOR); p.userData.edge.material.color.setHex(HI_COLOR);
        p.userData.fill.material.opacity = 0.45 + 0.5 * pulse;
        p.getWorldPosition(_p); root.worldToLocal(_p);
      }
      const a = L.line.geometry.attributes.position;
      a.setXYZ(0, _p.x, _p.y, _p.z);
      a.setXYZ(1, L.s.position.x - side * 0.03, L.s.position.y, L.s.position.z);
      a.needsUpdate = true;
    });
  }
  setHighlight([]);
  return { root, parts, setHighlight, update, get highlight() { return hi; } };
}
