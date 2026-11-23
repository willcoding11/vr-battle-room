// Wireframe ship models: vertices (points) joined by lines.
// Every model faces +Z (nose at +Z), up is +Y.
import * as THREE from '../vendor/three.module.js';

let dotTexture = null;
function getDotTexture() {
  if (dotTexture) return dotTexture;
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.8)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 32, 32);
  dotTexture = new THREE.CanvasTexture(c);
  return dotTexture;
}

function makeWire(verts, edges, color, { scale = 1, pointSize = 0.03 } = {}) {
  const pos = [];
  for (const [a, b] of edges) {
    pos.push(verts[a][0] * scale, verts[a][1] * scale, verts[a][2] * scale);
    pos.push(verts[b][0] * scale, verts[b][1] * scale, verts[b][2] * scale);
  }
  const lineGeo = new THREE.BufferGeometry();
  lineGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  const lineMat = new THREE.LineBasicMaterial({
    color, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const lines = new THREE.LineSegments(lineGeo, lineMat);

  const ptsGeo = new THREE.BufferGeometry();
  const vp = [];
  for (const v of verts) vp.push(v[0] * scale, v[1] * scale, v[2] * scale);
  ptsGeo.setAttribute('position', new THREE.Float32BufferAttribute(vp, 3));
  const ptsMat = new THREE.PointsMaterial({
    color, size: pointSize * scale, sizeAttenuation: true, map: getDotTexture(),
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const pts = new THREE.Points(ptsGeo, ptsMat);

  const group = new THREE.Group();
  group.add(lines, pts);
  group.userData.lines = lines;
  group.userData.mats = [lineMat, ptsMat];
  group.userData.baseColor = new THREE.Color(color);
  return group;
}

// Set the colour of a ship (used for hit flashes).
export function tintShip(group, color) {
  for (const m of group.userData.mats) m.color.copy(color);
}

export function buildPlayerShip(color = 0x33ddff) {
  const v = [
    [0, 0, 0.20],      // 0 nose
    [-0.15, 0, -0.10], // 1 left wing tip
    [0.15, 0, -0.10],  // 2 right wing tip
    [0, 0, -0.06],     // 3 rear centre
    [0, 0.06, -0.08],  // 4 fin top
    [0, -0.035, -0.03],// 5 belly
    [-0.05, 0, -0.12], // 6 left engine
    [0.05, 0, -0.12],  // 7 right engine
    [0, 0.025, 0.06],  // 8 canopy
  ];
  const e = [
    [0, 1], [0, 2], [1, 6], [2, 7], [6, 3], [7, 3],
    [0, 8], [8, 4], [4, 3], [0, 5], [5, 3], [1, 4], [2, 4], [4, 6], [4, 7], [5, 1], [5, 2],
  ];
  return makeWire(v, e, color);
}

export function buildFighter(color = 0xff3344) {
  const v = [
    [0, 0, 0.14],        // 0 nose
    [-0.16, 0.07, -0.05],// 1
    [0.16, 0.07, -0.05], // 2
    [-0.16, -0.07, -0.05],//3
    [0.16, -0.07, -0.05],// 4
    [0, 0, -0.10],       // 5 rear
    [-0.05, 0, 0.02],    // 6
    [0.05, 0, 0.02],     // 7
  ];
  const e = [
    [0, 6], [0, 7], [6, 1], [6, 3], [7, 2], [7, 4], [1, 3], [2, 4],
    [1, 5], [3, 5], [2, 5], [4, 5], [6, 7],
  ];
  return makeWire(v, e, color);
}

export function buildCruiser(color = 0xff2233) {
  // Box hull + forward prongs + bridge tower, scaled up.
  const x = 0.08, y = 0.05, z0 = -0.2, z1 = 0.12;
  const v = [
    [-x, -y, z0], [x, -y, z0], [x, y, z0], [-x, y, z0],   // 0-3 back face
    [-x, -y, z1], [x, -y, z1], [x, y, z1], [-x, y, z1],   // 4-7 front face
    [-x * 1.4, 0, 0.32], [x * 1.4, 0, 0.32],              // 8-9 prong tips
    [0, y + 0.07, -0.08], [0, y + 0.07, 0.0],             // 10-11 tower
    [-x * 2.2, 0, -0.14], [x * 2.2, 0, -0.14],            // 12-13 side pods
  ];
  const e = [
    [0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4],
    [0, 4], [1, 5], [2, 6], [3, 7],
    [4, 8], [7, 8], [5, 9], [6, 9],
    [3, 10], [2, 10], [10, 11], [11, 7], [11, 6],
    [0, 12], [3, 12], [12, 4], [1, 13], [2, 13], [13, 5],
  ];
  return makeWire(v, e, color, { scale: 1.6, pointSize: 0.025 });
}

// v16 Fleet ship classes (both sides, in the side's colour). Each has its own silhouette.
// Interceptor: a long thin needle with small forward-swept wings (fast, fragile).
export function buildInterceptor(color = 0x33ddff) {
  const v = [
    [0, 0, 0.27],          // 0 nose
    [0, 0.03, -0.12],      // 1 tail top
    [0, -0.025, -0.12],    // 2 tail bottom
    [-0.12, 0, 0.04],      // 3 left wing tip (swept forward)
    [0.12, 0, 0.04],       // 4 right wing tip
    [-0.03, 0, -0.08],     // 5 left wing root
    [0.03, 0, -0.08],      // 6 right wing root
    [0, 0.065, -0.13],     // 7 fin tip
  ];
  const e = [[0, 1], [0, 2], [1, 2], [0, 5], [0, 6], [5, 3], [6, 4], [3, 0], [4, 0], [5, 1], [6, 1], [5, 2], [6, 2], [1, 7]];
  return makeWire(v, e, color);
}
// Bomber: a wide, heavy flying wing with two engine pods underneath (slow, big punch).
export function buildBomber(color = 0x33ddff) {
  const v = [
    [0, 0.02, 0.14],       // 0 nose
    [-0.22, 0, -0.08],     // 1 left tip
    [0.22, 0, -0.08],      // 2 right tip
    [-0.08, 0.04, -0.12],  // 3 rear left top
    [0.08, 0.04, -0.12],   // 4 rear right top
    [0, -0.04, -0.06],     // 5 belly
    [-0.1, -0.06, 0.06],   // 6 left pod front
    [-0.1, -0.06, -0.14],  // 7 left pod back
    [0.1, -0.06, 0.06],    // 8 right pod front
    [0.1, -0.06, -0.14],   // 9 right pod back
  ];
  const e = [[0, 1], [0, 2], [1, 3], [2, 4], [3, 4], [0, 3], [0, 4], [0, 5], [5, 1], [5, 2], [5, 3], [5, 4],
    [6, 7], [8, 9], [6, 1], [7, 1], [8, 2], [9, 2], [6, 5], [8, 5]];
  return makeWire(v, e, color, { scale: 1.1 });
}
// Shield ship: a compact diamond hull inside a ring (the shield emitter).
export function buildShieldShip(color = 0x33ddff) {
  const v = [[0, 0, 0.16], [0, 0, -0.12], [-0.08, 0, 0], [0.08, 0, 0], [0, 0.08, 0], [0, -0.08, 0]];
  const e = [[0, 2], [0, 3], [0, 4], [0, 5], [1, 2], [1, 3], [1, 4], [1, 5], [2, 4], [4, 3], [3, 5], [5, 2]];
  const n = 10, r = 0.17, base = v.length;
  for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; v.push([Math.cos(a) * r, Math.sin(a) * r, -0.02]); e.push([base + i, base + ((i + 1) % n)]); }
  e.push([2, base + 5], [3, base], [4, base + 3], [5, base + 8]);
  return makeWire(v, e, color);
}

// Small wireframe gizmo drawn at a controller.
export function buildControllerGizmo(color) {
  const v = [
    [-0.015, -0.015, 0.03], [0.015, -0.015, 0.03], [0.015, 0.015, 0.03], [-0.015, 0.015, 0.03],
    [-0.01, -0.01, -0.06], [0.01, -0.01, -0.06], [0.01, 0.01, -0.06], [-0.01, 0.01, -0.06],
  ];
  const e = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]];
  return makeWire(v, e, color, { pointSize: 0.004 });
}
