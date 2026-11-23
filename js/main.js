// BATTLE ROOM - a seated, tabletop (diorama) wireframe space battle for WebXR (Meta Quest). VR only:
// the page shows one ENTER VR button. In VR you land in the lobby (after the first-run tutorial).
// A hidden desktop mode (mouse + keyboard, autopilot) remains for automated testing: ?test.
import * as THREE from '../vendor/three.module.js';
import { buildPlayerShip, buildFighter, buildCruiser, tintShip } from './models.js?v=17';
import { createTouchController } from './controller.js?v=17';
import { Sfx } from './audio.js?v=17';
import { Panel, faceYaw, UI } from './ui.js?v=17';
import { stats, saveStats, recordGame, fmtTime } from './stats.js?v=17';
import { createTutorial } from './tutorial.js?v=17';

const URLQ = new URLSearchParams(location.search);
const TEST = URLQ.has('test');                           // test hooks + hidden desktop controls
const DEMO = TEST && URLQ.has('demo');                   // autopilot
const BENCH = TEST && URLQ.has('bench');                 // a test script drives the games (no auto start)
const START_WAVE = Math.max(1, parseInt(URLQ.get('wave'), 10) || 1);
const SIM = TEST ? Math.max(1, Math.min(12, parseInt(URLQ.get('sim'), 10) || 1)) : 1;   // test: sim steps per frame
const AUTO_MODE = TEST ? URLQ.get('mode') : null;        // test: start this mode right away
const log = (m) => { if (TEST && window.__log) window.__log(m); };
if (TEST) document.body.classList.add('test');
if (DEMO) document.body.classList.add('demo');

// ---------------------------------------------------------------- constants
const S = 0.5;                                    // world scale: everything is "zoomed out" to half size
const HEAD_H = 1.2;                               // seated eye height (desktop)
const ARENA_C = new THREE.Vector3(0, 0, 0);       // battle centre = centre of the box (game units)
// Battle box half-size in game units. The box keeps its physical size in front of you, so a bigger
// BOX_B = more room relative to the ships. Fighter: 2.8 (was 1.75). Squadron: zoomed out much further.
const MODE_BOX = { fighter: 2.8, squadron: 5.0 };
let BOX_B = MODE_BOX.fighter;                     // base half-size: sets the scale (ship size) for the mode
// The room's actual half-extents per axis. Width, height and depth vary independently (long, flat,
// tall or cube) with roughly the same volume as a BOX_B cube; they change each game and each wave.
const HB = new THREE.Vector3(BOX_B, BOX_B, BOX_B);
const FRIEND_COLOR = new THREE.Color(0x33ddff);
const PLAYER_COLOR = new THREE.Color(0x33ddff);
const ENEMY_COLOR = new THREE.Color(0xff3344);
const WHITE = new THREE.Color(0xffffff);
const MAX_HP = 5;
const CRUISE = 1.6 * S, BOOST = 3.2 * S, BRAKE = 0.5 * S; // player speeds (m/s)
const LEAD = 0.9 * S;                             // how far past the ship the steering target sits
const MAX_YAW = 2.2, MAX_PITCH = 1.7;             // stick steering base turn rates (rad/s)
const MAX_ELEV = 1.3;                             // max nose up/down angle (rad, ~75 deg)
const FOLLOW_H = 0.3;                             // follow view height = distance * this

// ---------------------------------------------------------------- settings (saved in localStorage)
const GAIN_OPTS = [['1', '1x'], ['1.5', '1.5x'], ['2', '2x'], ['2.5', '2.5x'], ['3', '3x'], ['3.5', '3.5x']];
const SETTINGS_DEF = [
  { key: 'mode', label: 'Game mode', opts: [['fighter', 'Fighter'], ['squadron', 'Squadron']] },
  { key: 'steer', label: 'Steering', opts: [['mirror', 'Mirror (ship = controller)'], ['relative', 'Relative (hand stick)'], ['point', 'Point'], ['stick', 'Thumbstick']] },
  { key: 'steerGain', label: 'Mirror gain (Fighter)', opts: GAIN_OPTS },
  { key: 'steerGainSq', label: 'Mirror gain (Squadron)', opts: GAIN_OPTS },
  { key: 'turnSpeed', label: 'Ship turn speed', opts: [['normal', 'Normal'], ['fast', 'Fast'], ['veryfast', 'Very fast']] },
  { key: 'boxSize', label: 'Box size', opts: [['small', 'Small'], ['medium', 'Medium'], ['large', 'Large']] },
  { key: '_box', label: 'Box position', opts: [], action: 'RESET' },     // actions, not stored settings
  { key: '_lobby', label: 'Leave game', opts: [], action: 'TO LOBBY' },
];
const SETTINGS_DEFAULT = { mode: 'fighter', turnSpeed: 'fast', steer: 'mirror', boxSize: 'medium', steerGain: '2', steerGainSq: '3' };
const BOX_SIZES = { small: 0.7, medium: 1.0, large: 1.3 };     // box width in metres
const TURN_MULS = { normal: 2.0, fast: 2.6, veryfast: 3.4 };   // x the original turn rate
const settings = { ...SETTINGS_DEFAULT };
try {
  let saved = JSON.parse(localStorage.getItem('battleRoomSettings6') || 'null');
  if (!saved) { saved = JSON.parse(localStorage.getItem('battleRoomSettings5') || '{}'); delete saved.steer; }
  for (const d of SETTINGS_DEF) if (d.opts.some((o) => o[0] === saved[d.key])) settings[d.key] = saved[d.key];
} catch (e) { /* ignore */ }
function saveSettings() { try { localStorage.setItem('battleRoomSettings6', JSON.stringify(settings)); } catch (e) { /* ignore */ } }

// ---------------------------------------------------------------- scratch
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const _q = new THREE.Quaternion(), _m = new THREE.Matrix4(), _c = new THREE.Color();
const ZERO = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0), ZAXIS = new THREE.Vector3(0, 0, 1);
const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

// ---------------------------------------------------------------- renderer / scene
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType('local-floor');
document.getElementById('app').appendChild(renderer.domElement);
// VR only: one big ENTER VR button (the lobby battle runs behind it). No WebXR: a short note below.
const vrButton = document.getElementById('vrbutton');
const xrNote = document.getElementById('xrnote');
let xrSession = null;
{
  const no = (msg) => { vrButton.disabled = true; xrNote.textContent = msg; };
  if (!navigator.xr) no(window.isSecureContext === false ? 'VR needs a secure (https) page.' : 'No WebXR in this browser - open this page in the Meta Quest browser.');
  else {
    navigator.xr.isSessionSupported('immersive-vr').then((ok) => {
      if (ok) { vrButton.disabled = false; xrNote.textContent = ''; } else no('No VR headset found - open this page in the Meta Quest browser.');
    }).catch(() => no('VR is not allowed on this page.'));
  }
  vrButton.addEventListener('click', () => {
    if (xrSession) { xrSession.end(); return; }
    sfx.init();
    navigator.xr.requestSession('immersive-vr', { optionalFeatures: ['local-floor', 'bounded-floor'] }).then(async (sess) => {
      xrSession = sess;
      sess.addEventListener('end', () => { xrSession = null; vrButton.textContent = 'ENTER VR'; });
      await renderer.xr.setSession(sess);
      vrButton.textContent = 'EXIT VR';
    }).catch((e) => { xrNote.textContent = 'Could not start VR: ' + ((e && e.message) || e); });
  });
}

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000004);

// The rig is "you in your chair". It never moves or turns: you sit still and look at the
// battle box in front of you. Up is always up.
const rig = new THREE.Group();
scene.add(rig);
const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.03, 300);
camera.position.set(0, HEAD_H, 0);
camera.rotation.order = 'YXZ';
rig.add(camera);

// The battle box (diorama): everything in the game lives inside this group, in "game units".
// It only translates + scales uniformly (never rotates), so directions are the same as in the world.
const board = new THREE.Group();
scene.add(board);
const BOX_DEFAULT = { x: 0, y: 1.0, z: -0.85, size: BOX_SIZES[settings.boxSize] };
const box = { ...BOX_DEFAULT };
try {
  const b = JSON.parse(localStorage.getItem('battleRoomBox5') || 'null');
  if (b && [b.x, b.y, b.z, b.size].every((v) => typeof v === 'number' && isFinite(v))) Object.assign(box, b);
} catch (e) { /* ignore */ }
function placeBoard() {
  // A deeper room grows away from you: the near face stays where the cube's near face would be.
  const sc = box.size / (2 * BOX_B);
  board.position.set(box.x, box.y, box.z - (HB.z - BOX_B) * sc);
}
function applyBoard() {
  box.size = clamp(box.size, 0.3, 2.0);
  board.scale.setScalar(box.size / (2 * BOX_B));
  placeBoard();
  // Point sprites are sized in world units, so re-fit them to the new board scale.
  board.traverse((o) => { if (o.userData.ptBase) o.userData.mats[1].size = o.userData.ptBase * S * board.scale.x; });
}
function saveBox() { try { localStorage.setItem('battleRoomBox5', JSON.stringify(box)); } catch (e) { /* ignore */ } }
function resetBox() { Object.assign(box, BOX_DEFAULT, { size: BOX_SIZES[settings.boxSize] }); applyBoard(); saveBox(); }
// Faint wireframe box edges + a floor grid inside the box as a "down" reference (unit box, scaled by BOX_B).
const boxFrame = new THREE.Group();
{
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(2, 2, 2)),
    new THREE.LineBasicMaterial({ color: 0x2a86a8, transparent: true, opacity: 0.7 }));
  const floor = new THREE.GridHelper(2, 10, 0x15506a, 0x0d3344);
  floor.position.y = -1;
  floor.material.transparent = true;
  floor.material.opacity = 0.5;
  boxFrame.add(edges, floor);
  board.add(boxFrame);
}
// Room shape. Factors multiply BOX_B per axis; product ~1 keeps the volume (and difficulty) about the
// same. Caps keep it comfortable in front of you: up to ~1.5x wide / deep, ~1.35x tall.
const SHAPE_PRESETS = [
  [1, 1, 1], [0.8, 0.8, 1.55], [1.5, 0.8, 0.85], [1.3, 0.6, 1.3], [0.85, 1.35, 0.85], [1.45, 1.0, 0.7], [0.7, 1.3, 1.1],
];
var OBST_READY = false;                           // var: read before the obstacle section runs
const SHAPE_MIN = 0.6, SHAPE_MAX = { x: 1.5, y: 1.35, z: 1.55 };
function pickShape(out) {
  let f;
  if (Math.random() < 0.5) f = SHAPE_PRESETS[Math.floor(Math.random() * SHAPE_PRESETS.length)].slice();
  else f = [Math.exp(rand(-0.45, 0.45)), Math.exp(rand(-0.45, 0.45)), Math.exp(rand(-0.45, 0.45))];
  const k = Math.cbrt(f[0] * f[1] * f[2]);
  out.set(
    clamp(f[0] / k, SHAPE_MIN, SHAPE_MAX.x), clamp(f[1] / k, SHAPE_MIN, SHAPE_MAX.y), clamp(f[2] / k, SHAPE_MIN, SHAPE_MAX.z),
  );
  return out.multiplyScalar(BOX_B);
}
// Apply the current HB: frame, board placement, star positions.
function applyShape() {
  boxFrame.scale.copy(HB);
  placeBoard();
  if (OBST_READY) layoutObstacles();             // (the stars are built further down)
}
// Smooth change of shape between waves.
const HB_FROM = new THREE.Vector3(), HB_TO = new THREE.Vector3();
let morphT = 1, morphDur = 2.4;
const _shapeTmp = new THREE.Vector3();
// Each frame while the room changes shape: ease the half-extents and keep every ship inside.
function updateMorph(dt) {
  if (morphT >= 1) return;
  morphT = Math.min(1, morphT + dt / morphDur);
  const s = morphT * morphT * (3 - 2 * morphT);
  HB.lerpVectors(HB_FROM, HB_TO, s);
  applyShape();
  const keep = (p) => { p.x = clamp(p.x, -HB.x * 0.97, HB.x * 0.97); p.y = clamp(p.y, -HB.y * 0.97, HB.y * 0.97); p.z = clamp(p.z, -HB.z * 0.97, HB.z * 0.97); };
  keep(player.obj.position);
  for (const e of enemies) keep(e.obj.position);
  for (const b of bots) keep(b.obj.position);
}
function morphTo(target, dur) { HB_FROM.copy(HB); HB_TO.copy(target); morphT = 0; morphDur = dur; }
function setShape(target) { HB.copy(target); morphT = 1; applyShape(); }
function setBoxB(b) {
  BOX_B = b;
  HB.set(b, b, b);
  morphT = 1;
  applyBoard();
  applyShape();
}
setBoxB(MODE_BOX[settings.mode] || MODE_BOX.fighter);
// Shortest vector from a to b in the wrap-around box (each axis wraps).
function wrapDelta(a, b, out) {
  out.subVectors(b, a);
  for (const k of ['x', 'y', 'z']) {
    if (out[k] > HB[k]) out[k] -= 2 * HB[k]; else if (out[k] < -HB[k]) out[k] += 2 * HB[k];
  }
  return out;
}
function outsideBox(p, m = 1) { return Math.abs(p.x) > HB.x * m || Math.abs(p.y) > HB.y * m || Math.abs(p.z) > HB.z * m; }
// Wrap-around: leave through one face, come back in through the opposite face.
function wrapBox(p) {
  let w = false;
  for (const k of ['x', 'y', 'z']) {
    if (p[k] > HB[k]) { p[k] -= 2 * HB[k]; w = true; } else if (p[k] < -HB[k]) { p[k] += 2 * HB[k]; w = true; }
  }
  return w;
}

// Stars: far points for depth/orientation (they travel with you, like real distant stars).
let stars;
{
  const n = 1800, p = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    _v1.randomDirection().multiplyScalar(rand(90, 140));
    p.set([_v1.x, _v1.y, _v1.z], i * 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(p, 3));
  stars = new THREE.Points(g, new THREE.PointsMaterial({ color: 0x8899bb, size: 1.6, sizeAttenuation: false, fog: false }));
  scene.add(stars);
}
// Faint grid far below: a constant "down" reference that also shows your motion.
const GRID_STEP = 0.5;
const grid = new THREE.GridHelper(40, 80, 0x0f3550, 0x0a2233);
grid.position.y = -1.2;
grid.material.transparent = true;
grid.material.opacity = 0.6;
scene.add(grid);
grid.visible = false;

const sfx = new Sfx();
sfx.toWorld = (v) => board.localToWorld(v.clone());

// ---------------------------------------------------------------- helpers
function shrink(obj) { obj.scale.setScalar(S); obj.userData.ptBase = obj.userData.mats[1].size; obj.userData.mats[1].size *= S * board.scale.x; return obj; }
function randomArenaPoint(scale = 0.8) {
  _v1.randomDirection().multiplyScalar(Math.cbrt(Math.random()) * scale * 0.9);
  return new THREE.Vector3(ARENA_C.x + _v1.x * HB.x, ARENA_C.y + _v1.y * HB.y, ARENA_C.z + _v1.z * HB.z);
}
// Orient a +Z-forward object along dir, keeping world up as up.
function quatFromDir(dir, out) {
  const up = Math.abs(dir.y) > 0.9995 ? ZAXIS : UP;
  _m.lookAt(dir, ZERO, up);
  return out.setFromRotationMatrix(_m);
}
// Turn an entity's heading toward `desired` at a limited rate, and bank into turns.
function steer(e, desired, dt) {
  const prev = _v3.copy(e.fwd);
  let ang = e.fwd.angleTo(desired);
  if (ang > 3.0) { desired = _v2.copy(desired).addScaledVector(UP, 0.3).normalize(); ang = e.fwd.angleTo(desired); }
  if (ang > 1e-4) e.fwd.lerp(desired, Math.min(1, (e.turn * dt) / ang)).normalize();
  const yawRate = (prev.z * e.fwd.x - prev.x * e.fwd.z) / Math.max(dt, 1e-4); // cross(prev,fwd).y: + = left turn
  const bankTarget = clamp(-yawRate * 0.35, -1.0, 1.0); // dip the inside wing
  e.bank += (bankTarget - e.bank) * Math.min(1, dt * 5);
  quatFromDir(e.fwd, e.obj.quaternion);
  _q.setFromAxisAngle(ZAXIS, e.bank);
  e.obj.quaternion.multiply(_q);
}
function segPointDist(a, b, p) {
  _v1.subVectors(b, a);
  const l2 = _v1.lengthSq();
  let t = l2 > 0 ? _v2.subVectors(p, a).dot(_v1) / l2 : 0;
  t = clamp(t, 0, 1);
  return _v2.copy(a).addScaledVector(_v1, t).distanceTo(p);
}

// ---------------------------------------------------------------- bullets
class Bullets {
  constructor(color, max = 300, len = 0.12) {
    this.max = max; this.len = len; this.list = [];
    this.arr = new Float32Array(max * 6);
    const g = new THREE.BufferGeometry();
    this.attr = new THREE.BufferAttribute(this.arr, 3).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.attr);
    g.setDrawRange(0, 0);
    this.mesh = new THREE.LineSegments(g, new THREE.LineBasicMaterial({
      color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    this.mesh.frustumCulled = false;
    board.add(this.mesh);
  }
  spawn(pos, vel, life, src) {
    if (this.list.length >= this.max) return;
    this.list.push({ pos: pos.clone(), prev: pos.clone(), vel: vel.clone(), life, dead: false, src });
  }
  update(dt) {
    for (const b of this.list) {
      b.prev.copy(b.pos);
      b.pos.addScaledVector(b.vel, dt);
      b.life -= dt;
      if (b.life <= 0 || outsideBox(b.pos, 1.02)) b.dead = true;
    }
    this.list = this.list.filter((b) => !b.dead);
  }
  sync() {
    let i = 0;
    for (const b of this.list) {
      _v1.copy(b.vel).normalize().multiplyScalar(-this.len).add(b.pos);
      this.arr[i++] = b.pos.x; this.arr[i++] = b.pos.y; this.arr[i++] = b.pos.z;
      this.arr[i++] = _v1.x; this.arr[i++] = _v1.y; this.arr[i++] = _v1.z;
    }
    this.mesh.geometry.setDrawRange(0, this.list.length * 2);
    this.attr.needsUpdate = true;
  }
  clear() { this.list.length = 0; }
}
const playerBullets = new Bullets(0x88f4ff, 200, 0.16 * S);
const enemyBullets = new Bullets(0xff6655, 300, 0.10 * S);

// ---------------------------------------------------------------- effects
const effects = [];
// Shatter a ship into its individual line segments, which tumble apart and fade.
function explode(obj, color, vel, big = false) {
  obj.updateMatrix();
  const src = obj.userData.lines.geometry.attributes.position;
  const n = src.count / 2;
  const center = obj.position.clone();
  const frags = [];
  for (let s = 0; s < n; s++) {
    const a = new THREE.Vector3().fromBufferAttribute(src, s * 2).applyMatrix4(obj.matrix);
    const b = new THREE.Vector3().fromBufferAttribute(src, s * 2 + 1).applyMatrix4(obj.matrix);
    const c = a.clone().add(b).multiplyScalar(0.5);
    const out = c.clone().sub(center);
    if (out.lengthSq() < 1e-6) out.randomDirection();
    out.normalize().multiplyScalar(rand(0.4, big ? 2.2 : 1.6) * S).add(_v1.randomDirection().multiplyScalar(0.3 * S));
    if (vel) out.addScaledVector(vel, 0.4);
    frags.push({ c, half: b.clone().sub(a).multiplyScalar(0.5), v: out, axis: new THREE.Vector3().randomDirection(), spin: rand(3, 10) });
  }
  const arr = new Float32Array(n * 6);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(arr, 3).setUsage(THREE.DynamicDrawUsage));
  const mat = new THREE.LineBasicMaterial({ color: color.clone().lerp(WHITE, 0.4), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
  const mesh = new THREE.LineSegments(g, mat);
  mesh.frustumCulled = false;
  board.add(mesh);
  // Expanding wireframe shock-sphere.
  const shock = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.IcosahedronGeometry(1, 1)),
    new THREE.LineBasicMaterial({ color: color.clone().lerp(WHITE, 0.6), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  shock.position.copy(center);
  shock.scale.setScalar(0.02);
  board.add(shock);
  effects.push({ type: 'frags', mesh, frags, arr, life: big ? 2.2 : 1.5, max: big ? 2.2 : 1.5 });
  effects.push({ type: 'shock', mesh: shock, life: 0.4, max: 0.4, size: (big ? 1.2 : 0.55) * S });
}
function blink(pos, color) {
  const shock = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.IcosahedronGeometry(1, 1)),
    new THREE.LineBasicMaterial({ color: color.clone().lerp(WHITE, 0.5), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  shock.position.copy(pos);
  shock.scale.setScalar(0.02);
  board.add(shock);
  effects.push({ type: 'shock', mesh: shock, life: 0.3, max: 0.3, size: 0.3 * S });
}
function updateEffects(dt) {
  for (const e of effects) {
    e.life -= dt;
    const k = Math.max(0, e.life / e.max);
    if (e.type === 'frags') {
      let i = 0;
      for (const f of e.frags) {
        f.c.addScaledVector(f.v, dt);
        f.v.multiplyScalar(1 - dt * 0.6);
        f.half.applyAxisAngle(f.axis, f.spin * dt);
        e.arr[i++] = f.c.x + f.half.x; e.arr[i++] = f.c.y + f.half.y; e.arr[i++] = f.c.z + f.half.z;
        e.arr[i++] = f.c.x - f.half.x; e.arr[i++] = f.c.y - f.half.y; e.arr[i++] = f.c.z - f.half.z;
      }
      e.mesh.geometry.attributes.position.needsUpdate = true;
      e.mesh.material.opacity = k;
    } else {
      e.mesh.scale.setScalar(0.02 + (1 - k) * e.size);
      e.mesh.material.opacity = k * k;
    }
  }
  for (let i = effects.length - 1; i >= 0; i--) {
    if (effects[i].life <= 0) {
      board.remove(effects[i].mesh);
      effects[i].mesh.geometry.dispose();
      effects[i].mesh.material.dispose();
      effects.splice(i, 1);
    }
  }
}

// ---------------------------------------------------------------- player ship
const player = {
  obj: shrink(buildPlayerShip(PLAYER_COLOR.getHex())),
  fwd: new THREE.Vector3(0, 0, -1), mq: new THREE.Quaternion(), bank: 0, turn: 2.8,
  speed: CRUISE, vel: new THREE.Vector3(), hp: MAX_HP, invuln: 0, flash: 0, fireCd: 0, alive: true,
  yawRate: 0, pitchRate: 0,
};
board.add(player.obj);
// Engine trail: short fading line behind the ship.
const TRAIL_N = 24;
const trailArr = new Float32Array(TRAIL_N * 3);
const trailCol = new Float32Array(TRAIL_N * 3);
const trail = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({
  vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
}));
trail.geometry.setAttribute('position', new THREE.BufferAttribute(trailArr, 3).setUsage(THREE.DynamicDrawUsage));
trail.geometry.setAttribute('color', new THREE.BufferAttribute(trailCol, 3));
for (let i = 0; i < TRAIL_N; i++) {
  const k = 1 - i / TRAIL_N;
  trailCol.set([0.2 * k, 0.8 * k, 1.0 * k], i * 3);
}
trail.frustumCulled = false;
board.add(trail);
let trailTimer = 0;
function resetTrail() {
  for (let i = 0; i < TRAIL_N; i++) trailArr.set([player.obj.position.x, player.obj.position.y, player.obj.position.z], i * 3);
  trail.geometry.attributes.position.needsUpdate = true;
}

function resetPlayer() {
  // Start near the front-centre of the box, flying away from you.
  player.obj.position.set(0, 0, HB.z * 0.4);
  player.fwd.set(0, 0, -1);
  player.bank = 0; player.yawRate = 0; player.pitchRate = 0; player.speed = CRUISE; player.hp = MAX_HP; player.invuln = 1.5; player.flash = 0;
  player.alive = true; player.obj.visible = true; trail.visible = settings.mode === 'fighter';
  quatFromDir(player.fwd, player.obj.quaternion);
  player.mq.copy(player.obj.quaternion);
  resetTrail();
}

// ---------------------------------------------------------------- game mode
// 'fighter'  = you fly one ship.
// 'squadron' = you command 4 bot fighters (the right controller sets their heading), in a bigger,
//              zoomed-out battlefield with Ender's Game "stars" (big fixed obstacles) to use as cover.
let gameMode = settings.mode;

// ---------------------------------------------------------------- "stars": big fixed obstacles (Squadron)
// Ships can't pass through them and bullets are blocked, so both sides use them as cover.
const obstacles = [];
const obstacleGroup = new THREE.Group();
board.add(obstacleGroup);
const obstacleMat = new THREE.LineBasicMaterial({ color: 0x9fb8dd, transparent: true, opacity: 0 });
// v12: stars get new random spots every round. They fade out when a round is cleared (and stop
// counting as obstacles once gone), then fade back in at their new spots when the next round starts.
let starsOn = true, starAlpha = 0, starTarget = 1;
function starsActive() { return teamMode() && starsOn; }
{
  // All spheres. Positions are FRACTIONS of the room's half-extents, so the stars spread out or
  // squeeze together with the room's shape (and glide with it when it changes between waves).
  const layout = [
    [-0.44, 0.16, -0.3, 0.6], [0.48, -0.2, -0.44, 0.7], [0.04, 0.4, 0.12, 0.55],
    [-0.32, -0.38, 0.26, 0.6], [0.42, 0.28, 0.4, 0.55], [0.24, -0.18, -0.68, 0.6],
    [-0.62, 0.44, 0.52, 0.5], [-0.6, -0.24, -0.64, 0.55],
  ];
  const mat = obstacleMat;
  for (const [x, y, z, r] of layout) {
    const g = new THREE.LineSegments(new THREE.WireframeGeometry(new THREE.IcosahedronGeometry(r, 1)), mat);
    obstacleGroup.add(g);
    obstacles.push({ type: 'sphere', n: new THREE.Vector3(x, y, z), c: new THREE.Vector3(), r, R: r, r0: r, g });
  }
  obstacleGroup.visible = false;
}
function layoutObstacles() {
  for (const o of obstacles) { o.r = o.R = o.r0; o.c.copy(o.n).multiply(HB); o.g.position.copy(o.c); }
}
OBST_READY = true;
layoutObstacles();
// Where your side starts this round: stars are kept well clear of this spot.
function starAvoidPoints() { return [new THREE.Vector3(0, 0, HB.z * 0.4)]; }
// New random star positions for the current room shape: inside the walls, apart from each other,
// and clear of both sides' start areas (best of many random tries for each star).
function randomizeStars() {
  const avoid = starAvoidPoints(), placed = [];
  const n = new THREE.Vector3(), c = new THREE.Vector3(), bestN = new THREE.Vector3();
  for (const o of obstacles) {
    const r = o.r0;
    let bestScore = -Infinity;
    for (let k = 0; k < 80; k++) {
      n.set(rand(-0.75, 0.75), rand(-0.7, 0.7), rand(-0.75, 0.75));
      c.copy(n).multiply(HB);
      let sc = Infinity;
      for (const ax of ['x', 'y', 'z']) sc = Math.min(sc, (HB[ax] - Math.abs(c[ax]) - r) / (0.5 * S));
      for (const q of avoid) sc = Math.min(sc, (c.distanceTo(q) - r - 1.2 * S) / S);
      for (const q of placed) sc = Math.min(sc, (c.distanceTo(q.c) - r - q.r - 0.9 * S) / S);
      if (sc > bestScore) { bestScore = sc; bestN.copy(n); }
      if (sc > 0.6 && k > 10) break;
    }
    o.n.copy(bestN);
    placed.push({ c: bestN.clone().multiply(HB), r });
  }
  layoutObstacles();
}
function updateStars(dt) {
  starAlpha += clamp(starTarget - starAlpha, -dt * 1.6, dt * 1.1);
  if (starTarget === 0 && starAlpha <= 0.001) starsOn = false;   // faded out: no longer solid
  obstacleMat.opacity = 0.6 * starAlpha;
  obstacleGroup.visible = teamMode() && starAlpha > 0.005;
}
// Make sure no ship sits inside a star (after new star positions).
function pushAllOutOfStars() {
  obstPushOut(player.obj.position, 0.1 * S);
  for (const b of bots) obstPushOut(b.obj.position, 0.15 * S);
  for (const e of enemies) obstPushOut(e.obj.position, e.radius);
}
function freshStars() { randomizeStars(); starsOn = true; starAlpha = 0; starTarget = 1; pushAllOutOfStars(); }
const _ob = new THREE.Vector3(), _ob2 = new THREE.Vector3(), _ob3 = new THREE.Vector3();
function inObst(o, p, pad = 0) {
  if (o.type === 'cube') return Math.abs(p.x - o.c.x) < o.r + pad && Math.abs(p.y - o.c.y) < o.r + pad && Math.abs(p.z - o.c.z) < o.r + pad;
  return p.distanceTo(o.c) < o.r + pad;
}
function obstInside(p, pad = 0) {
  if (!starsActive()) return null;
  for (const o of obstacles) if (inObst(o, p, pad)) return o;
  return null;
}
// Push a ship (radius rad) out of any obstacle it has run into.
function obstPushOut(p, rad) {
  if (!starsActive()) return false;
  let hit = false;
  for (const o of obstacles) {
    if (o.type === 'cube') {
      _ob.set(clamp(p.x, o.c.x - o.r, o.c.x + o.r), clamp(p.y, o.c.y - o.r, o.c.y + o.r), clamp(p.z, o.c.z - o.r, o.c.z + o.r));
      _ob2.subVectors(p, _ob);
      const d = _ob2.length();
      if (d >= rad) continue;
      hit = true;
      if (d > 1e-6) p.copy(_ob).addScaledVector(_ob2, rad / d);
      else {
        // Centre inside the cube: leave through the nearest face.
        _ob2.subVectors(p, o.c);
        let ax = 'x';
        for (const k of ['y', 'z']) if (Math.abs(_ob2[k]) > Math.abs(_ob2[ax])) ax = k;
        p[ax] = o.c[ax] + (_ob2[ax] >= 0 ? 1 : -1) * (o.r + rad);
      }
    } else {
      _ob2.subVectors(p, o.c);
      const d = _ob2.length();
      if (d >= o.r + rad) continue;
      hit = true;
      if (d < 1e-6) _ob2.set(0, 1, 0); else _ob2.divideScalar(d);
      p.copy(o.c).addScaledVector(_ob2, o.r + rad);
    }
  }
  return hit;
}
// Is the straight line a -> b blocked by an obstacle?
function obstBlocks(a, b) {
  if (!starsActive()) return false;
  for (const o of obstacles) {
    if (segPointDist(a, b, o.c) > o.R) continue;
    const n = Math.max(2, Math.ceil(a.distanceTo(b) / 0.1));
    for (let i = 0; i <= n; i++) if (inObst(o, _ob3.lerpVectors(a, b, i / n))) return true;
  }
  return false;
}
// Steer around obstacles ahead (adds a push to `desired`).
function obstAvoid(p, fwd, speed, desired) {
  if (!starsActive()) return;
  const look = 0.8 * S + speed * 1.2;
  for (const o of obstacles) {
    _ob.subVectors(o.c, p);
    const dist = _ob.length();
    const clear = o.R + 0.3 * S;
    if (dist < clear) desired.addScaledVector(_ob, -1.5 / Math.max(dist, 1e-3));
    const along = _ob.dot(fwd);
    if (along <= 0 || along > look + o.R) continue;
    _ob2.copy(p).addScaledVector(fwd, along).sub(o.c);         // closest-approach offset from the centre
    let lat = _ob2.length();
    if (lat >= clear) continue;
    if (lat < 1e-3) { _ob2.crossVectors(fwd, UP); if (_ob2.lengthSq() < 1e-6) _ob2.set(1, 0, 0); lat = _ob2.length(); }
    desired.addScaledVector(_ob2, (3 * (clear - lat) / clear) * (1 - along / (look + o.R)) / lat);
  }
}
// A spot hidden behind the obstacle nearest `near`, as seen from `threat`.
function coverPoint(threat, near, out) {
  if (!starsActive()) return null;
  let best = null, bd = Infinity;
  for (const o of obstacles) { const d = o.c.distanceTo(near); if (d < bd) { bd = d; best = o; } }
  if (!best) return null;
  _ob.subVectors(best.c, threat);
  if (_ob.lengthSq() < 1e-6) _ob.set(0, 0, -1);
  out.copy(best.c).addScaledVector(_ob.normalize(), best.R + 0.35 * S);
  return clampIn(out);
}
function clampIn(p, m = 0.88) {
  p.x = clamp(p.x, -HB.x * m, HB.x * m); p.y = clamp(p.y, -HB.y * m, HB.y * m); p.z = clamp(p.z, -HB.z * m, HB.z * m);
  return p;
}
function sideOf(fwd, out) {
  out.crossVectors(fwd, UP);
  if (out.lengthSq() < 1e-4) out.set(1, 0, 0);
  return out.normalize();
}
function nearestTo(p, list) {
  let best = null, bd = Infinity;
  for (const t of list) { const d = t.obj.position.distanceTo(p); if (d < bd) { bd = d; best = t; } }
  return best;
}
// Where to aim so a bullet at `speed` meets target t (simple two-step lead).
function leadPoint(from, t, speed, out) {
  const tp = t.obj.position, sp = t.speed || 0;
  let time = from.distanceTo(tp) / speed;
  for (let k = 0; k < 2; k++) {
    out.copy(tp).addScaledVector(t.fwd, sp * time);
    time = from.distanceTo(out) / speed;
  }
  return out;
}

// ---------------------------------------------------------------- enemies
// Every enemy belongs to a GROUP that shares a target and a timed plan, and has a ROLE:
//   pincer - a pair that swings out to opposite sides of the target, then attacks together
//   flank  - circles round to come at the target from the side / behind, attacks, swings out again
//   sniper - holds long range (Squadron: hides behind a star, steps out to shoot), accurate lead shots
//   heavy  - slow cruiser that holds medium range and fires 3-shot spreads
//   bait   - (Squadron) flies in close to draw fire, then runs back to its hidden ambush group
//   ambush - (Squadron) waits behind a star until the squadron comes near or the bait gets home
//   hunter - (round 6+) chases whichever of your ships is most damaged
// Everyone leads their shots and pulls back for a moment when damaged. v12: aim, lead and tactics
// improve round by round (see AI / AI_UNLOCKS below). In Squadron the attack
// groups focus fire on the most exposed bot, and enemies fall back to cover when outnumbered.
const enemies = [];
const groups = [];
// v12: the enemy gets smarter every round. Tactics unlock as the rounds go up (see AI_UNLOCKS).
const AI = { lead: 0.5, focus: false, cover: false, regroup: false, sync: false, dodge: false, hunters: false };
const AI_UNLOCKS = [
  { n: 2, key: 'focus', txt: 'focus fire on your most exposed ship', modes: 's' },
  { n: 2, key: null, txt: 'bait & ambush', modes: 's' },
  { n: 3, key: 'cover', txt: 'hiding behind stars', modes: 's' },
  { n: 3, key: 'regroup', txt: 'retreat & regroup', modes: 'Fs' },
  { n: 5, key: 'sync', txt: 'synchronized strikes', modes: 'Fs' },
  { n: 5, key: 'dodge', txt: 'dodging your shots', modes: 'Fs' },
  { n: 6, key: 'hunters', txt: 'hunter-killers chase damaged ships', modes: 'Fs' },
];
function setAI(n) {
  AI.lead = Math.min(1, 0.45 + 0.11 * n);          // how well they lead their shots: 56% in round 1, perfect from round 5
  for (const u of AI_UNLOCKS) if (u.key) AI[u.key] = n >= u.n;
  const m = { fighter: 'F', squadron: 's' }[gameMode];
  return AI_UNLOCKS.filter((u) => u.n === n && u.modes.includes(m)).map((u) => u.txt);
}
let strikeClock = 0;                                 // shared attack timer for synchronized strikes
const ROLE_STATS = {
  pincer: { hp: 2, speed: 1.2, turn: 1.9, fire: 2.2, range: 4.0, acc: 0.2 },
  flank: { hp: 2, speed: 1.3, turn: 2.0, fire: 2.0, range: 4.0, acc: 0.2 },
  sniper: { hp: 2, speed: 0.95, turn: 1.8, fire: 2.6, range: 7.0, acc: 0.06 },
  heavy: { hp: 5, speed: 0.7, turn: 0.9, fire: 3.0, range: 5.5, acc: 0.15 },
  bait: { hp: 2, speed: 1.4, turn: 2.2, fire: 2.6, range: 3.5, acc: 0.3 },
  ambush: { hp: 2, speed: 1.3, turn: 2.0, fire: 1.8, range: 4.0, acc: 0.15 },
  hunter: { hp: 2, speed: 1.45, turn: 2.3, fire: 1.8, range: 4.0, acc: 0.12 },
};
function liveTargets() {
  if (teamMode()) return friends;
  return player.alive ? [player] : [];
}
function spawnGroup(role, n, wave) {
  const g = { role, members: [], t: rand(0, 1.5), focus: null, focusT: 0, ambushPt: null, sprung: false, lureDone: false };
  // The group enters together through one face, well away from you.
  const ref = player.obj.position;
  let best = null, bestD = -1;
  for (let k = 0; k < 8; k++) {
    const p = new THREE.Vector3(rand(-0.7, 0.7), rand(-0.7, 0.7), rand(-0.7, 0.7)).multiply(HB);
    const ax = ['x', 'y', 'z'][k % 3];
    p[ax] = (Math.random() < 0.5 ? -1 : 1) * HB[ax] * 0.95;
    if (obstInside(p, 0.4 * S)) continue;
    const d = p.distanceTo(ref) + rand(0, BOX_B * 0.6);
    if (d > bestD) { bestD = d; best = p; }
  }
  if (!best) best = new THREE.Vector3(0, 0, -HB.z * 0.95);
  if (role === 'bait') g.ambushPt = coverPoint(ref, best, new THREE.Vector3()) || best.clone().multiplyScalar(0.8);
  for (let i = 0; i < n; i++) {
    const pos = best.clone().add(_v1.randomDirection().multiplyScalar(0.4 * S * Math.sqrt(Math.max(1, n / 3))));
    clampIn(pos, 0.98);
    obstPushOut(pos, 0.3 * S);
    const e = spawnEnemy(role === 'bait' && i > 0 ? 'ambush' : role, wave, pos, g);
    e.side = i % 2 ? 1 : -1;
    g.members.push(e);
  }
  groups.push(g);
  return g;
}
function spawnEnemy(role, wave, pos, group) {
  const heavy = role === 'heavy';
  const st = ROLE_STATS[role];
  const obj = shrink(heavy ? buildCruiser(ENEMY_COLOR.getHex()) : buildFighter(ENEMY_COLOR.getHex()));
  obj.position.copy(pos);
  const e = {
    type: heavy ? 'cruiser' : 'fighter', role, group, obj, hp: st.hp, maxHp: st.hp, radius: (heavy ? 0.34 : 0.2) * S,
    fwd: _v1.copy(ARENA_C).sub(pos).normalize().clone(), bank: 0,
    turn: st.turn + wave * 0.06, speed: st.speed * S * (1 + wave * 0.05),
    fireInterval: Math.max(st.fire * 0.45, st.fire - wave * 0.12), range: st.range * S,
    acc: st.acc * S * Math.max(0.25, 1 - (wave - 1) * 0.08),
    dodger: Math.random() < 0.6,
    fireCd: rand(1.5, 3.0), flash: 0, points: heavy ? 300 : role === 'sniper' ? 150 : 100, spawnFade: 0,
    retreatT: 0, retreatCd: 0, outnumT: rand(0, 0.5), breakT: 0, side: 1, target: null, mode: 'move',
    goal: randomArenaPoint(0.6),
  };
  quatFromDir(e.fwd, obj.quaternion);
  tintShip(obj, _c.setRGB(0, 0, 0)); // fades in
  board.add(obj);
  enemies.push(e);
  return e;
}
function centroid(list, out) {
  out.set(0, 0, 0);
  for (const e of list) out.add(e.obj.position);
  return list.length ? out.divideScalar(list.length) : out;
}
function updateGroups(dt, tg) {
  // Squadron: the most exposed bot (furthest from its wingmen, then weakest) is the shared focus target.
  let exposed = tg[0] || null;
  if (teamMode() && tg.length > 1) {
    let bestS = -Infinity;
    for (const b of tg) {
      let near = Infinity;
      for (const o of tg) if (o !== b) near = Math.min(near, b.obj.position.distanceTo(o.obj.position));
      const s = near - b.hp * 0.3 * S;
      if (s > bestS) { bestS = s; exposed = b; }
    }
  }
  strikeClock += dt;
  // Hunter-killers go for the most damaged ship you have.
  let weakest = null, wv = Infinity;
  for (const b of tg) {
    const v = (b.hp || 1) / (b === player ? MAX_HP : BOT_HP);
    if (v < wv) { wv = v; weakest = b; }
  }
  for (let i = groups.length - 1; i >= 0; i--) {
    const g = groups[i];
    g.members = g.members.filter((e) => e.hp > 0);
    if (!g.members.length) { groups.splice(i, 1); continue; }
    g.t += dt;
    g.focusT -= dt;
    if (g.focusT <= 0 || !g.focus || !g.focus.alive) {
      g.focusT = 3;
      if (g.role === 'hunter') g.focus = weakest;
      else if (g.role === 'sniper' || g.role === 'heavy' || g.role === 'bait' || !AI.focus) g.focus = nearestTo(centroid(g.members, _v3), tg);
      else g.focus = exposed;                       // focus fire
    }
    if (g.role === 'bait' && !g.sprung) {
      const bait = g.members.find((e) => e.role === 'bait');
      let near = false;
      for (const b of tg) if (b.obj.position.distanceTo(g.ambushPt) < 2.8 * S) near = true;
      if (near || !bait || g.t > 25 || (g.lureDone && bait.obj.position.distanceTo(g.ambushPt) < 0.8 * S)) g.sprung = true;
    }
  }
}
const _es = new THREE.Vector3(), _ed = new THREE.Vector3(), _ea = new THREE.Vector3();
function updateEnemies(dt) {
  const sq = teamMode();
  const tg = liveTargets();
  updateGroups(dt, tg);
  for (const e of enemies) {
    const g = e.group, p = e.obj.position, goal = e.goal;
    let T = g.focus && g.focus.alive ? g.focus : nearestTo(p, tg);
    e.target = T;
    e.retreatT -= dt; e.retreatCd -= dt; e.breakT -= dt;
    // Squadron: fall back to cover when locally outnumbered.
    if (sq && AI.regroup && (e.outnumT -= dt) <= 0) {
      e.outnumT = 0.5;
      let nb = 0, na = 0;
      for (const b of tg) if (b.obj.position.distanceTo(p) < 2.4 * S) nb++;
      for (const o of enemies) if (o.obj.position.distanceTo(p) < 2.4 * S) na++;
      if (nb >= na + 2 && e.retreatT <= 0 && e.retreatCd <= 0) { e.retreatT = 2.5; e.retreatCd = 5; }
    }
    let mode = 'move';                               // move | attack | aim
    if (!T) {
      if (p.distanceTo(goal) < 0.5 * S) goal.copy(randomArenaPoint(0.7));
    } else if (e.retreatT > 0) {
      // Retreat: behind the nearest star (round 3+), back to the wingmen to regroup (round 3+),
      // or straight away from the threat.
      if (!(AI.cover && coverPoint(T.obj.position, p, goal))) {
        if (AI.regroup && g.members.length > 1) {
          centroid(g.members, goal);
          _es.subVectors(goal, T.obj.position);
          if (_es.lengthSq() < 1e-6) _es.set(0, 0, -1);
          goal.addScaledVector(_es.normalize(), 1.0 * S);
        } else goal.copy(p).addScaledVector(_es.subVectors(p, T.obj.position).normalize(), 2.5 * S);
        clampIn(goal);
      }
    } else {
      const Tp = T.obj.position, Tf = T.fwd;
      const dist = p.distanceTo(Tp);
      const gt = AI.sync ? strikeClock : g.t;          // synchronized strikes: every group attacks at once
      switch (e.role) {
        case 'pincer': {
          // Swing wide to opposite sides of the target, then both attack at once.
          if (gt % 7 < 4) {
            sideOf(Tf, _es);
            goal.copy(Tp).addScaledVector(_es, e.side * 2.0 * S).addScaledVector(Tf, 0.8 * S);
            clampIn(goal);
          } else mode = 'attack';
          break;
        }
        case 'flank': {
          // Circle round to the side / rear, then attack; members are staggered.
          if ((gt + (e.side > 0 ? 0 : 1.2)) % (AI.sync ? 7 : 7.5) < (AI.sync ? 4 : 4.5) && dist > 0.9 * S) {
            sideOf(Tf, _es);
            goal.copy(Tp).addScaledVector(Tf, -1.6 * S).addScaledVector(_es, e.side * 1.3 * S);
            clampIn(goal);
          } else mode = 'attack';
          break;
        }
        case 'sniper':
        case 'heavy': {
          const peek = Math.floor((g.t + (e.side > 0 ? 0 : 1.5)) / 3) % 2 === 1;
          if (e.role === 'sniper' && AI.cover && coverPoint(Tp, p, goal)) {
            // Behind cover; every few seconds step out to the side to take a shot.
            if (peek) { _ed.subVectors(goal, Tp).normalize(); sideOf(_ed, _es); goal.addScaledVector(_es, e.side * 0.7 * S); }
          } else {
            // Hold range, drifting round the target.
            const hold = (e.role === 'sniper' ? 4.2 : 3.0) * S;
            _ed.subVectors(p, Tp);
            if (_ed.lengthSq() < 1e-6) _ed.set(0, 0, 1);
            _ed.normalize();
            sideOf(_ed, _es);
            goal.copy(Tp).addScaledVector(_ed, hold).addScaledVector(_es, e.side * 1.0 * S);
            clampIn(goal);
          }
          if (p.distanceTo(goal) < 0.6 * S) mode = 'aim';
          break;
        }
        case 'bait': {
          if (g.sprung) mode = 'attack';
          else if (!g.lureDone) { if (dist > 2.0 * S) mode = 'attack'; else g.lureDone = true; }
          else goal.copy(g.ambushPt);                // run home, drawing them toward the ambush
          break;
        }
        case 'hunter': mode = 'attack'; break;
        case 'ambush': {
          if (g.sprung) mode = 'attack';
          else { goal.copy(g.ambushPt); if (p.distanceTo(goal) < 0.6 * S) mode = 'aim'; }
          break;
        }
      }
    }
    const bulletSpeed = (e.role === 'sniper' ? 4.4 + wave * 0.08 : 3.0 + wave * 0.12) * S;
    const desired = _v2;
    if (mode !== 'move' && T) {
      leadPoint(p, T, bulletSpeed, _ea);
      desired.subVectors(_ea, p).normalize();
      if (mode === 'attack' && p.distanceTo(T.obj.position) < 0.8 * S) e.breakT = 1.0;
      if (e.breakT > 0) { sideOf(e.fwd, _es); desired.copy(e.fwd).addScaledVector(_es, e.side * 1.5).normalize(); }
    } else {
      desired.subVectors(goal, p);
      if (desired.lengthSq() < 1e-6) desired.copy(e.fwd);
      desired.normalize();
    }
    // Keep a little space from other enemies.
    for (const o of enemies) {
      if (o === e) continue;
      const d = p.distanceTo(o.obj.position);
      if (d < 0.6 * S && d > 1e-4) desired.addScaledVector(_v1.subVectors(p, o.obj.position).normalize(), (0.6 * S - d) * 4);
    }
    // Round 5+: dodge your shots (side-step bullets that would hit).
    if (AI.dodge && e.dodger && e.spawnFade >= 1) {
      for (const pb of playerBullets.list) {
        _es.subVectors(p, pb.pos);
        const tca = _es.dot(pb.vel) / Math.max(pb.vel.lengthSq(), 1e-6);
        if (tca < 0 || tca > 0.6) continue;
        _es.addScaledVector(pb.vel, -tca);
        const miss = _es.length();
        if (miss > 0.3 * S) continue;
        if (miss < 1e-4) sideOf(_ed.copy(pb.vel).normalize(), _es);
        desired.addScaledVector(_es.normalize(), 1.3 * (1 - miss / (0.3 * S)));
      }
    }
    obstAvoid(p, e.fwd, e.speed, desired);
    desired.normalize();
    steer(e, desired.clone(), dt);
    const spd = e.speed * (mode === 'aim' ? 0.35 : 1) * (e.retreatT > 0 ? 1.25 : 1);
    p.addScaledVector(e.fwd, spd * dt);
    wrapBox(p);
    obstPushOut(p, e.radius);
    e.mode = mode;

    // Fade in on spawn, flash white when hit.
    e.spawnFade = Math.min(1, e.spawnFade + dt * 1.5);
    if (e.flash > 0) { e.flash -= dt; tintShip(e.obj, WHITE); }
    else tintShip(e.obj, _c.copy(ENEMY_COLOR).multiplyScalar(e.spawnFade));

    // Fire (with lead) when the target is in range, roughly ahead, and not behind a star.
    e.fireCd -= dt;
    if (T && combat() && e.fireCd <= 0 && e.spawnFade >= 1 && e.retreatT <= 0) {
      leadPoint(p, T, bulletSpeed, _ea).lerp(T.obj.position, 1 - AI.lead).add(_v3.randomDirection().multiplyScalar(e.acc));
      const to = _es.subVectors(_ea, p);
      const dist = to.length();
      if (dist < e.range && e.fwd.angleTo(to) < (e.role === 'sniper' ? 0.35 : 0.6) && !obstBlocks(p, T.obj.position)) {
        to.normalize();
        const shots = e.type === 'cruiser' ? [-0.12, 0, 0.12] : [0];
        for (const s of shots) {
          const d = to.clone();
          if (s) d.applyAxisAngle(UP, s);
          enemyBullets.spawn(_v3.copy(p).addScaledVector(e.fwd, e.radius), d.multiplyScalar(bulletSpeed), 4);
        }
        sfx.enemyLaser(p);
        e.fireCd = e.fireInterval * rand(0.8, 1.3);
      } else e.fireCd = 0.2;
    }

    // Ramming hurts both.
    for (const t of tg) {
      if (t.alive && p.distanceTo(t.obj.position) < e.radius + (t.radius || 0.1 * S)) { damageTarget(t); damageEnemy(e, 2); }
    }
  }
  for (let i = enemies.length - 1; i >= 0; i--) {
    if (enemies[i].hp <= 0) { board.remove(enemies[i].obj); enemies.splice(i, 1); }
  }
}
function damageEnemy(e, amount) {
  if (e.hp <= 0) return;
  e.hp -= amount;
  e.flash = 0.08;
  if (e.hp <= 0) {
    explode(e.obj, ENEMY_COLOR, _v1.copy(e.fwd).multiplyScalar(e.speed), e.type === 'cruiser');
    sfx.boom(e.obj.position, e.type === 'cruiser');
    if (state === 'playing') { score += e.points * wave; kills++; }
    if (state !== 'lobby') haptic('right', 0.6, 60);
  } else {
    // Damaged: pull back for a moment before coming in again.
    if (e.retreatCd <= 0) { e.retreatT = 2.0; e.retreatCd = 4; }
    if (state !== 'lobby') sfx.ping(e.obj.position);
    if (gameMode === 'fighter' && state !== 'lobby') haptic('right', 0.3, 25);
  }
}
function damageTarget(t) { if (t === player) damagePlayer(); else damageBot(t); }

// ---------------------------------------------------------------- friendly squadron (Squadron mode)
// A squad = 4 bot fighters that fly around an invisible ANCHOR (the squad's command point). The
// anchor's heading is the order; the bots fly their own ships: formation, engage, dodge, separation.
// The anchor is the (invisible) player ship.
const BOT_N = 4, BOT_HP = 3, BOT_SPACING = 0.6 * S, LEASH = 2.2 * S, BOT_RANGE = 4.5 * S;
function teamMode() { return gameMode === 'squadron'; }
function makeSquad(name, color) {
  const sq = {
    name, kind: 'squad', color: new THREE.Color(color), bots: [], anchor: new THREE.Vector3(), fwd: new THREE.Vector3(0, 0, -1),
    q: new THREE.Quaternion(), right: new THREE.Vector3(1, 0, 0), speed: CRUISE, engaged: false,
  };
  for (let i = 0; i < BOT_N; i++) {
    const obj = shrink(buildPlayerShip(sq.color.getHex()));
    obj.visible = false;
    board.add(obj);
    sq.bots.push({ i, unit: sq, obj, fwd: new THREE.Vector3(0, 0, -1), bank: 0, turn: 3.4, speed: CRUISE, hp: BOT_HP, alive: false, flash: 0, invuln: 0, fireCd: rand(0, 0.3), target: null, side: i % 2 ? 1 : -1, radius: 0 });
  }
  return sq;
}
const SQUAD = makeSquad('SQUAD', 0x33ddff);          // Squadron mode
const bots = SQUAD.bots;

// Everything on our side that is alive this frame (for targeting, friendly-fire and collision checks).
let friends = [];
function refreshFriends() {
  friends = [];
  if (gameMode === 'squadron') { for (const b of bots) if (b.alive) friends.push(b); }
}
function foesList() { return enemies.filter((e) => e.hp > 0); }
function friendsInLine(self, aim) {
  for (const o of friends) {
    if (o === self) continue;
    if (segPointDist(self.obj.position, aim, o.obj.position) < 0.25 * S + (o.radius || 0)) return true;
  }
  return false;
}

const _bS = new THREE.Vector3(), _bD = new THREE.Vector3(), _bT = new THREE.Vector3(), _bQ = new THREE.Quaternion();
function cmdRight(out) {
  // Formation "right" from the command orientation (quaternion in Mirror mode, so it never flips).
  if (activeSteer() === 'mirror') return out.set(1, 0, 0).applyQuaternion(player.mq);
  return out.set(1, 0, 0).applyQuaternion(quatFromDir(player.fwd, _bQ));
}
function placeBot(sq, b, k, m) {
  b.obj.position.copy(sq.anchor).addScaledVector(sq.right, (k - (m - 1) / 2) * BOT_SPACING);
  b.fwd.copy(sq.fwd);
  quatFromDir(b.fwd, b.obj.quaternion);
  wrapBox(b.obj.position);
}
function syncSquadToPlayer() {
  SQUAD.anchor.copy(player.obj.position);
  SQUAD.fwd.copy(player.fwd);
  cmdRight(SQUAD.right);
  SQUAD.speed = player.speed;
}
function resetSquad(sq, on) {
  sq.bots.forEach((b, k) => {
    b.alive = on; b.hp = BOT_HP; b.flash = 0; b.invuln = 0; b.speed = CRUISE; b.bank = 0;
    b.obj.visible = on;
    placeBot(sq, b, k, BOT_N);
  });
}
function resetBots() {
  syncSquadToPlayer();
  resetSquad(SQUAD, gameMode === 'squadron');
}
let squadEngaged = false;
function updateSquad(sq, dt) {
  const engaged = sq.engaged;
  const anchor = sq.anchor, cmd = sq.fwd;
  const alive = sq.bots.filter((b) => b.alive);
  const m = alive.length;
  const foes = foesList();
  alive.forEach((b, k) => {
    const p = b.obj.position;
    const desired = _bD.set(0, 0, 0);
    let spdT, homing = false;
    b.target = null;
    if (engaged) {
      // ENGAGE: the nearest enemy near the group...
      let best = null, bd = Infinity;
      for (const e of foes) {
        if (e.spawnFade < 0.5) continue;
        const d = e.obj.position.distanceTo(p);
        if (e.obj.position.distanceTo(anchor) < LEASH + BOT_RANGE && d < bd) { bd = d; best = e; }
      }
      b.target = best;
      if (best) {
        leadPoint(p, best, 7 * S, _bT);
        desired.subVectors(_bT, p).normalize();
        if (bd < 0.7 * S) { sideOf(b.fwd, _bS); desired.addScaledVector(_bS, b.side * 1.5); }   // don't ram it
      } else desired.copy(cmd);
      // ...but stays on a leash around the group centre.
      wrapDelta(p, anchor, _bS);
      const off = _bS.length();
      spdT = CRUISE * 1.25;
      if (off > LEASH * 0.7) { desired.copy(_bS).normalize(); spdT = CRUISE * 0.9; homing = true; }   // at the leash: tight turn straight back
      else if (off > LEASH * 0.4) desired.addScaledVector(_bS, (((off - LEASH * 0.4) / LEASH) * 4) / off);
    } else {
      // FORMATION: line abreast across the commanded heading, catching up / easing off to hold the slot.
      _bT.copy(anchor).addScaledVector(sq.right, (k - (m - 1) / 2) * BOT_SPACING);
      wrapDelta(p, _bT, _bS);
      const along = _bS.dot(cmd);
      // Close the sideways gap by steering, the front/back gap mostly by speed (never turn back).
      desired.copy(_bS).addScaledVector(cmd, -along + Math.max(0.8 * S, along + 0.8 * S)).normalize();
      spdT = clamp(sq.speed + along * 2.5, 0.3 * CRUISE, BOOST * 1.3);
    }
    // Separation: never run into a wingman.
    for (const o of friends) {
      if (o === b) continue;
      wrapDelta(o.obj.position, p, _bS);
      const d = _bS.length(), min = 0.55 * S + (o.radius || 0);
      if (d < min && d > 1e-4) desired.addScaledVector(_bS, (((min - d) / min) * 3) / d);
    }
    // Dodge incoming enemy bullets: side-step away from each bullet's path.
    for (const eb of enemyBullets.list) {
      _bS.subVectors(p, eb.pos);
      const tca = _bS.dot(eb.vel) / Math.max(eb.vel.lengthSq(), 1e-6);
      if (tca < 0 || tca > 0.8) continue;
      _bS.addScaledVector(eb.vel, -tca);
      const miss = _bS.length();
      if (miss > 0.35 * S) continue;
      if (miss < 1e-4) sideOf(_v1.copy(eb.vel).normalize(), _bS);
      desired.addScaledVector(_bS.normalize(), 1.6 * (1 - miss / (0.35 * S)));
    }
    if (homing) {
      // The leash wins over dodging / spacing nudges (only stars can still push the path aside).
      wrapDelta(p, anchor, _bS);
      desired.multiplyScalar(0.25).addScaledVector(_bS.normalize(), 3);
    }
    obstAvoid(p, b.fwd, b.speed, desired);
    if (desired.lengthSq() < 1e-6) desired.copy(b.fwd);
    desired.normalize();
    b.turn = engaged ? 4.6 : 3.4;                 // dogfighting = tighter turns
    steer(b, desired.clone(), dt);
    b.speed += (spdT - b.speed) * Math.min(1, dt * (b.speed > spdT ? 4 : 2.5));
    p.addScaledVector(b.fwd, b.speed * dt);
    wrapBox(p);
    obstPushOut(p, 0.12 * S);
    // Shoot only with a clear line: never through a friendly ship or a star.
    b.fireCd -= dt;
    if (engaged && b.target && b.fireCd <= 0 && combat()) {
      _bS.subVectors(_bT, p);
      if (_bS.length() < BOT_RANGE && b.fwd.angleTo(_bS) < 0.22 && !friendsInLine(b, _bT) && !obstBlocks(p, b.target.obj.position)) {
        playerBullets.spawn(_v3.copy(p).addScaledVector(b.fwd, 0.2 * S), _v1.copy(_bS).normalize().multiplyScalar(7 * S), 1.2);
        if (Math.random() < 0.4) sfx.laser(p);
        b.fireCd = 0.3;
      } else b.fireCd = 0.05;
    }
    b.invuln = Math.max(0, b.invuln - dt);
    b.flash = Math.max(0, b.flash - dt);
    if (b.flash > 0) tintShip(b.obj, WHITE);
    else tintShip(b.obj, _c.copy(sq.color).multiplyScalar(b.invuln > 0 && Math.floor(b.invuln * 12) % 2 ? 0.35 : 1));
  });
  // Hard minimum gap from every friendly ship, in case steering alone wasn't enough.
  for (const b of alive) {
    for (const o of friends) {
      if (o === b || (o.unit === sq && o.i < b.i)) continue;
      const a = b.obj.position, c = o.obj.position;
      wrapDelta(c, a, _bS);
      const d = _bS.length(), min = 0.22 * S + (o.radius || 0);
      if (d >= min || d < 1e-5) continue;
      _bS.multiplyScalar((min - d) / (2 * d)); a.add(_bS); c.sub(_bS);
    }
  }
}
// Squadron mode: one squad, commanded through the player ship.
function updateBots(dt) {
  syncSquadToPlayer();
  SQUAD.engaged = squadEngaged = input.fire && combat();
  updateSquad(SQUAD, dt);
}
function damageBot(b) {
  if (!b.alive || b.invuln > 0 || !combat()) return;
  const sq = b.unit;
  if (state === 'tutorial') { b.hp = Math.max(1, b.hp - 1); b.invuln = 0.6; b.flash = 0.2; return; }   // nobody dies in training
  b.hp--;
  b.invuln = 0.6;
  b.flash = 0.2;
  if (state === 'lobby') {
    if (b.hp <= 0) { b.alive = false; b.obj.visible = false; explode(b.obj, sq.color, _v1.copy(b.fwd).multiplyScalar(b.speed), true); }
    return;
  }
  sfx.ping(b.obj.position);
  haptic('left', 0.4, 40);
  if (b.hp > 0) return;
  b.alive = false;
  b.obj.visible = false;
  explode(b.obj, sq.color, _v1.copy(b.fwd).multiplyScalar(b.speed), true);
  sfx.boom(b.obj.position, true);
  haptic('right', 1.0, 160);
  screenFlash = 0.25;
  const left = sq.bots.filter((x) => x.alive).length;
  if (left > 0) { showMessage('WINGMAN DOWN', `${left} ship${left > 1 ? 's' : ''} left`, 1.6); return; }
  gameOver('SQUADRON LOST');
}
function gameOver(title) {
  player.alive = false;
  player.obj.visible = false;
  sfx.chime(false);
  state = 'gameover';
  stateTimer = 0;
  saveBest();
  recordGame(gameMode, wave, score, kills);
  showMessage(title, endLine(), 9999);
  log(`gameover mode=${gameMode} round=${wave} score=${score} kills=${kills}`);
}
// Everything that fights: real games, the ambient lobby skirmish and the tutorial.
function combat() { return state === 'playing' || state === 'lobby' || state === 'tutorial'; }

// The battle box's forward orientation (Mirror steering re-centres to it).
const BOX_FWD_Q = new THREE.Quaternion();
quatFromDir(new THREE.Vector3(0, 0, -1), BOX_FWD_Q);

// ---------------------------------------------------------------- mode switching
function applyMode(mode = settings.mode) {
  gameMode = mode;
  const sq = teamMode();
  setBoxB(MODE_BOX[gameMode]);
  freshStars();
  // In Squadron the player "ship" is just the command point: hide the hull, keep the aim line.
  player.obj.userData.lines.visible = !sq;
  player.obj.children[1].visible = !sq;
  trail.visible = !sq && player.alive;
  SHIP_NEUTRAL_Q.copy(BOX_FWD_Q);
  resetBots();
}
function damagePlayer() {
  if (!player.alive || player.invuln > 0 || !combat()) return;
  if (state === 'tutorial') { player.invuln = 1.0; player.flash = 0.25; sfx.hit(); haptic('right', 0.6, 80); return; }   // can't die in training
  player.hp--;
  player.invuln = 1.0;
  player.flash = 0.25;
  sfx.hit();
  haptic('right', 1.0, 160);
  haptic('left', 0.7, 120);
  screenFlash = 0.25;
  if (player.hp <= 0) {
    player.alive = false;
    player.obj.visible = false;
    trail.visible = false;
    explode(player.obj, PLAYER_COLOR, _v1.copy(player.fwd).multiplyScalar(player.speed), true);
    sfx.boom(player.obj.position, true);
    gameOver('SHIP DESTROYED');
  }
}

// ---------------------------------------------------------------- game state
let state = 'lobby';   // lobby | tutorial | playing | gameover
let simTime = 0;
let stateTimer = 0;
let wave = 0, score = 0, kills = 0, intermission = 0, screenFlash = 0;
let best = 0;
try { best = Number(localStorage.getItem('battleRoomBest')) || 0; } catch (e) { /* ignore */ }
// The goal is the highest round: the best round reached is kept per mode (in stats.js).
const bestRound = { get fighter() { return stats.modes.fighter.best; }, get squadron() { return stats.modes.squadron.best; } };
function saveBest() {
  best = Math.max(best, score);
  stats.modes[gameMode].best = Math.max(stats.modes[gameMode].best, wave);
  try { localStorage.setItem('battleRoomBest', String(best)); } catch (e) { /* ignore */ }
  saveStats();
}
function endLine() { return `Reached round ${wave}  (best ${bestRound[gameMode] || 0})   Score ${score}\n${restartHint()}`; }

function startWave(n) {
  wave = n;
  const unlocked = setAI(n);
  const heavies = Math.floor((n - 1) / 2);
  if (gameMode === 'squadron') {
    // Coordinated groups; more of them, and more varied, as the waves go on.
    spawnGroup('pincer', 2, n);
    spawnGroup('flank', 2 + Math.floor(n / 2), n);
    spawnGroup('sniper', 1 + Math.floor(n / 2), n);
    if (n >= 2) spawnGroup('bait', 3, n);        // 1 bait + 2 hidden ambushers
    if (n >= 4) spawnGroup('pincer', 2, n);
    if (n >= 5) spawnGroup('bait', 3, n);
    if (heavies) spawnGroup('heavy', heavies, n);
  } else {
    spawnGroup('pincer', 2, n);
    spawnGroup('flank', 1 + Math.floor(n / 2), n);
    if (n >= 2) spawnGroup('sniper', Math.min(3, 1 + Math.floor((n - 2) / 2)), n);
    if (n >= 4) spawnGroup('pincer', 2, n);
    if (heavies) spawnGroup('heavy', heavies, n);
  }
  if (AI.hunters) spawnGroup('hunter', 2 + Math.floor((n - 6) / 3), n);
  const what = `${enemies.length} hostiles inbound`;
  showMessage(`ROUND ${n}`, unlocked.length ? `${what}\nNEW: ${unlocked.join(', ')}` : what, unlocked.length ? 3.6 : 2.4);
  sfx.chime(true);
  log(`wave ${n} started with ${enemies.length} enemies; AI lead=${AI.lead.toFixed(2)} ${Object.keys(AI).filter((k) => AI[k] === true).join(',')}`);
}
// v12: every round is a fresh battle. Your side comes back at full strength in its start positions,
// the enemy spawns fresh, and the stars get new random spots for the (reshaped) room.
function startRound(n) {
  for (const e of enemies) board.remove(e.obj);
  enemies.length = 0;
  groups.length = 0;
  playerBullets.clear();
  enemyBullets.clear();
  resetPlayer();
  resetBots();
  freshStars();
  startWave(n);
}
function startGame(round = START_WAVE) {
  sfx.init();
  tutorial.stop();
  lobbyPanel.visible = false;
  tutFreeze = false;
  for (const e of enemies) board.remove(e.obj);
  enemies.length = 0;
  groups.length = 0;
  playerBullets.clear();
  enemyBullets.clear();
  score = 0; kills = 0;
  applyMode();
  setShape(pickShape(_shapeTmp));                  // a new room shape for every game
  state = 'playing';
  needNeutral = true;
  stateTimer = 0;
  intermission = 0;
  startRound(round);
  log(`game start mode=${gameMode} round=${round}`);
}
function restartHint() {
  return 'Back to the lobby in a moment';
}
// Leave a running game for the lobby (Settings > Leave game); it still counts as a game played.
function leaveGame() {
  if (state === 'playing' || state === 'gameover') { if (state === 'playing') { saveBest(); recordGame(gameMode, wave, score, kills); } enterLobby(); }
  else if (state === 'tutorial') finishTutorial();
}

// ---------------------------------------------------------------- lobby
// Where you land after entering VR (once the tutorial is done) and a few seconds after each game.
// A small blue squadron and red raiders skirmish round the stars; you can grab and resize the room;
// the panel on the right picks the mode, starts the game and shows your stats.
let lobbyT = 0, lobbySpawnT = 0, lobbyReviveT = 0;
const lobbyPanel = new Panel(0.44, 880, 1040);
rig.add(lobbyPanel.mesh);
const MODE_INFO = { fighter: 'Fly one ship yourself', squadron: 'Lead a squadron of 4 bot fighters' };
function drawLobby() {
  const P = lobbyPanel, W = P.W;
  P.begin('BATTLE ROOM');
  P.text('GAME MODE', 36, 128, { size: 26, color: UI.dim });
  MODES.forEach((m, i) => P.button('mode:' + m, 30 + i * 418, 142, 402, 84, m.toUpperCase(), { active: settings.mode === m, size: 30 }));
  P.text(MODE_INFO[settings.mode], W / 2, 270, { size: 26, align: 'center', maxW: W - 60 });
  P.button('start', 30, 296, W - 60, 118, 'START', { big: true, size: 56 });
  P.text('STATS', 36, 470, { size: 26, color: UI.dim });
  const cols = [400, 590, 780];
  ['BEST ROUND', 'GAMES', 'LAST'].forEach((h, i) => P.text(h, cols[i], 470, { size: 20, color: UI.dim, align: 'center', maxW: 180 }));
  MODES.forEach((m, i) => {
    const y = 512 + i * 42, st = stats.modes[m];
    P.text(m.toUpperCase(), 36, y, { size: 26, color: settings.mode === m ? UI.gold : UI.text, maxW: 250 });
    [st.best, st.games, st.last].forEach((v, k) => P.text(String(v), cols[k], y, { size: 28, bold: k === 0, color: k === 0 ? UI.title : UI.text, align: 'center', maxW: 170 }));
  });
  const rows = [
    ['Win streak', `${stats.streak}   (best ${stats.bestStreak})`], ['Total kills', String(stats.kills)],
    ['Games played', String(stats.games)], ['Time played', fmtTime(stats.time)], ['Best score', String(Math.max(stats.bestScore, best))],
  ];
  rows.forEach(([l, v], i) => {
    const y = 632 + i * 44;
    P.text(l, 36, y, { size: 25, color: UI.text, maxW: 380 });
    P.text(v, W - 36, y, { size: 25, color: UI.title, align: 'right', maxW: 400 });
  });
  P.button('tutorial', 30, 884, 400, 78, 'REDO TUTORIAL', { size: 28 });
  P.button('settings', W - 430, 884, 400, 78, 'SETTINGS', { size: 28 });
  P.text('GRIP: move the room     GRIP + STICK: resize', W / 2, 1012, { size: 22, color: UI.dim, align: 'center', maxW: W - 40 });
  P.end();
}
lobbyPanel.onClick = (id) => {
  if (id.startsWith('mode:')) { setSetting('mode', id.slice(5)); sfx.ping(null); }
  else if (id === 'start') startGame();
  else if (id === 'tutorial') startTutorial();
  else if (id === 'settings') toggleSettings(true);
  log('lobby click ' + id);
};
function clearBattle() {
  for (const e of enemies) board.remove(e.obj);
  enemies.length = 0;
  groups.length = 0;
  playerBullets.clear();
  enemyBullets.clear();
}
function enterLobby() {
  state = 'lobby';
  stateTimer = 0;
  tutorial.stop();
  tutFreeze = false;
  clearBattle();
  wave = 1;
  setAI(2);
  applyMode('squadron');
  setShape(pickShape(_shapeTmp));
  freshStars();
  resetPlayer();
  player.obj.visible = false;
  trail.visible = false;
  resetBots();
  lobbyT = 0; lobbySpawnT = 1.0; lobbyReviveT = 0;
  hideMessage();
  lobbyPanel.visible = true;
  drawLobby();
  log('lobby');
}
// The ambient skirmish: the blue squadron's leader wanders round the room and engages anything near.
function updateLobby(dt) {
  lobbyT += dt;
  const t = lobbyT * 0.22, p = player.obj.position;
  const at = (k, out) => out.set(Math.sin(k) * HB.x * 0.55, Math.sin(k * 1.7) * HB.y * 0.35, Math.cos(k * 0.8) * HB.z * 0.5);
  at(t, p);
  at(t + 0.05, _v1).sub(p);
  if (_v1.lengthSq() > 1e-8) player.fwd.copy(_v1.normalize());
  quatFromDir(player.fwd, player.obj.quaternion);
  player.speed = CRUISE;
  refreshFriends();
  syncSquadToPlayer();
  SQUAD.engaged = squadEngaged = enemies.some((e) => e.obj.position.distanceTo(p) < 4 * S);
  updateSquad(SQUAD, dt);
  updateEnemies(dt);
  playerBullets.update(dt);
  enemyBullets.update(dt);
  updateCollisions();
  if (!enemies.length && (lobbySpawnT -= dt) <= 0) { spawnGroup(Math.random() < 0.5 ? 'pincer' : 'flank', 3, 1); lobbySpawnT = 3; }
  if (!bots.some((b) => b.alive) && (lobbyReviveT += dt) > 2.5) { resetSquad(SQUAD, true); lobbyReviveT = 0; }
}

// ---------------------------------------------------------------- tutorial (steps live in tutorial.js)
const TUT_KEY = 'battleRoomTutorialDone';
let tutFreeze = false, tutStageName = '', shotsFired = 0;
function tutorialDone() { try { return localStorage.getItem(TUT_KEY) === '1'; } catch (e) { return false; } }
function startTutorial() {
  state = 'tutorial';
  stateTimer = 0;
  lobbyPanel.visible = false;
  hideMessage();
  score = 0; kills = 0; wave = 1;
  setAI(1);
  tutStageName = '';
  tutorial.start();
  log('tutorial start');
}
function finishTutorial() {
  try { localStorage.setItem(TUT_KEY, '1'); } catch (e) { /* ignore */ }
  log('tutorial done');
  enterLobby();
}
// Set the scene for a group of tutorial steps.
function tutStage(name) {
  clearBattle();
  tutStageName = name;
  const cube = () => setShape(_v1.set(BOX_B, BOX_B, BOX_B));
  if (name === 'box' || name === 'fly' || name === 'enemy') {
    if (gameMode !== 'fighter' || name === 'box') { applyMode('fighter'); cube(); }
    if (name === 'box' || tutFreeze) resetPlayer();
    tutFreeze = name === 'box';
    if (tutFreeze) player.obj.position.set(0, 0, 0);       // just your ship, in the middle of the room
  } else {
    tutFreeze = false;
    applyMode(name);
    cube();
    freshStars();
    resetPlayer();
    resetBots();
  }
  needNeutral = true;
}
// Practice ships never shoot (nothing can hurt you in training); single-shot, slow targets in the FLY part.
function spawnTut(kind, n) {
  const g = spawnGroup(kind === 'practice' ? 'flank' : 'pincer', n, 1);
  g.members.forEach((e, i) => {
    e.fireInterval = 1e9; e.fireCd = 1e9; e.tut = true;
    if (kind === 'weak') e.hp = e.maxHp = 1;
    if (kind === 'practice') {
      e.speed *= 0.3; e.hp = e.maxHp = 1;
      // In front of your ship, spread side by side.
      e.obj.position.copy(player.obj.position).addScaledVector(player.fwd, 1.6 * S).addScaledVector(sideOf(player.fwd, _v2), (i - (n - 1) / 2) * 0.9 * S);
      clampIn(e.obj.position, 0.8);
    }
  });
}
const tutorial = createTutorial({
  get input() { return input; }, get player() { return player; }, get settings() { return settings; }, setSetting,
  get shots() { return shotsFired; }, enemyCount: () => enemies.length,
  spawnTut, stage: tutStage, finishTutorial, ping: () => sfx.ping(null), log,
  get box() { return box; },
  highlight: setTouchHighlight,
  cue: () => sfx.ping(null),
  good: () => { sfx.chime(true); haptic('right', 0.25, 40); haptic('left', 0.25, 40); },
});
rig.add(tutorial.card.mesh, tutorial.big.mesh);

// ---------------------------------------------------------------- HUD (one canvas: DOM on desktop, texture on the VR wrist)
const hudCanvas = document.getElementById('hud');
const hctx = hudCanvas.getContext('2d');
const hudTex = new THREE.CanvasTexture(hudCanvas);
hudTex.colorSpace = THREE.SRGBColorSpace;
const msgCanvas = document.createElement('canvas');
msgCanvas.width = 1024; msgCanvas.height = 256;
const mctx = msgCanvas.getContext('2d');
const msgTex = new THREE.CanvasTexture(msgCanvas);
msgTex.colorSpace = THREE.SRGBColorSpace;
const msgEl = document.getElementById('message');
let msgTitle = '', msgSub = '', msgTime = 0;

function showMessage(title, sub = '', dur = 2) {
  msgTitle = title; msgSub = sub; msgTime = dur;
  msgEl.querySelector('.t').textContent = title;
  msgEl.querySelector('.s').textContent = sub;
  msgEl.classList.add('show');
  mctx.clearRect(0, 0, 1024, 256);
  mctx.fillStyle = 'rgba(0,12,24,0.55)';
  mctx.fillRect(0, 0, 1024, 256);
  mctx.strokeStyle = 'rgba(80,220,255,0.8)';
  mctx.lineWidth = 3;
  mctx.strokeRect(4, 4, 1016, 248);
  mctx.textAlign = 'center';
  mctx.fillStyle = '#7fe9ff';
  mctx.font = 'bold 84px monospace';
  mctx.fillText(title, 512, 105);
  mctx.font = '36px monospace';
  mctx.fillStyle = '#bfefff';
  sub.split('\n').forEach((line, i) => mctx.fillText(line, 512, 165 + i * 44));
  msgTex.needsUpdate = true;
  // In VR, messages go on a small panel on the LEFT wrist (right of the score panel) so nothing
  // covers the battle. Only the title-screen prompt uses the big floating panel.
  const xr = renderer.xr.isPresenting;
  const big = xr && state === 'gameover';
  msgPanel.visible = big;
  wristMsg.visible = xr && !big && state !== 'tutorial';
}
function hideMessage() {
  msgTime = 0;
  msgEl.classList.remove('show');
  msgPanel.visible = false;
  wristMsg.visible = false;
}

const camFwd = new THREE.Vector3(), camPos = new THREE.Vector3();
function getCamForwardFlat(out) {
  camera.getWorldDirection(out);
  out.y = 0;
  if (out.lengthSq() < 1e-6) out.set(0, 0, -1);
  return out.normalize();
}
function drawHud() {
  const W = hudCanvas.width, H = hudCanvas.height;
  hctx.clearRect(0, 0, W, H);
  hctx.fillStyle = 'rgba(0,10,22,0.62)';
  hctx.fillRect(0, 0, W, H);
  hctx.strokeStyle = 'rgba(80,220,255,0.7)';
  hctx.lineWidth = 3;
  hctx.strokeRect(2, 2, W - 4, H - 4);
  hctx.fillStyle = '#7fe9ff';
  hctx.font = 'bold 30px monospace';
  hctx.textAlign = 'left';
  hctx.fillText(`SCORE ${score}`, 20, 44);
  hctx.font = '24px monospace';
  hctx.fillText(`ROUND ${wave}`, 20, 84);
  hctx.fillText(`HOSTILES ${enemies.length}`, 20, 118);
  if (gameMode === 'squadron') {
    // Squadron status: one box per ship, filled by its hull; lost ships are crossed out.
    hctx.fillText('SQUAD', 20, 160);
    bots.forEach((b, i) => {
      const x = 104 + i * 40;
      hctx.strokeStyle = b.alive ? '#7fe9ff' : '#ff5566';
      hctx.strokeRect(x, 140, 32, 24);
      if (b.alive) {
        hctx.fillStyle = b.hp <= 1 ? '#ff5566' : '#33ddff';
        hctx.fillRect(x + 3, 143, (26 * b.hp) / BOT_HP, 18);
      } else {
        hctx.beginPath(); hctx.moveTo(x + 4, 144); hctx.lineTo(x + 28, 160); hctx.moveTo(x + 28, 144); hctx.lineTo(x + 4, 160); hctx.stroke();
      }
    });
  } else {
    hctx.fillText('HULL', 20, 160);
    for (let i = 0; i < MAX_HP; i++) {
      hctx.strokeStyle = '#7fe9ff';
      hctx.strokeRect(92 + i * 34, 140, 26, 24);
      if (i < player.hp) {
        hctx.fillStyle = player.hp <= 2 ? '#ff5566' : '#33ddff';
        hctx.fillRect(95 + i * 34, 143, 20, 18);
      }
    }
  }
  hctx.fillStyle = '#5fa9bf';
  hctx.font = '18px monospace';
  hctx.fillText(`BEST ROUND ${bestRound[gameMode] || 0}`, 20, 200);
  const sm = activeSteer();
  hctx.fillText(state === 'playing' && intermission > 0 ? 'NEXT ROUND...'
    : `${gameMode === 'squadron' ? (squadEngaged ? 'ENGAGING' : 'FORMATION') : 'FIGHTER'} - ${STEER_NAMES[sm]}${sm === 'stick' && invertY ? ' INV' : ''}`, 20, 232);

  // Radar: top-down view of the box (far side up).
  const cx = W - 128, cy = H / 2, R = 108, range = Math.max(HB.x, HB.z) * 1.15;
  hctx.strokeStyle = 'rgba(80,220,255,0.5)';
  hctx.lineWidth = 2;
  hctx.strokeRect(cx - HB.x / range * R, cy - HB.z / range * R, 2 * HB.x / range * R, 2 * HB.z / range * R);
  const plot = (p, color, size) => {
    const dy = p.y;
    const sx = (p.x / range) * R;
    const sy = (p.z / range) * R;
    hctx.fillStyle = color;
    hctx.beginPath();
    if (dy > HB.y / 3) { hctx.moveTo(cx + sx, cy + sy - size); hctx.lineTo(cx + sx - size, cy + sy + size); hctx.lineTo(cx + sx + size, cy + sy + size); }
    else if (dy < -HB.y / 3) { hctx.moveTo(cx + sx, cy + sy + size); hctx.lineTo(cx + sx - size, cy + sy - size); hctx.lineTo(cx + sx + size, cy + sy - size); }
    else hctx.arc(cx + sx, cy + sy, size, 0, Math.PI * 2);
    hctx.fill();
  };
  if (teamMode()) {
    hctx.strokeStyle = 'rgba(160,185,220,0.7)';
    for (const o of obstacles) {
      const r = (o.r / range) * R;
      const sx = cx + (o.c.x / range) * R, sy = cy + (o.c.z / range) * R;
      hctx.beginPath();
      if (o.type === 'cube') hctx.rect(sx - r, sy - r, 2 * r, 2 * r); else hctx.arc(sx, sy, r, 0, Math.PI * 2);
      hctx.stroke();
    }
  }
  for (const e of enemies) plot(e.obj.position, '#ff4455', e.type === 'cruiser' ? 7 : 5);
  if (gameMode === 'squadron') { for (const b of bots) if (b.alive) plot(b.obj.position, '#33ddff', 5); }
  else if (player.alive) plot(player.obj.position, '#33ddff', 6);
  hctx.fillStyle = '#ffffff';
  hctx.fillRect(cx - 2, cy - 2, 4, 4);
  hudTex.needsUpdate = true;
}

// VR panels.
const hudPanel = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.1),
  new THREE.MeshBasicMaterial({ map: hudTex, transparent: true, depthTest: false, fog: false }));
hudPanel.renderOrder = 10;
const msgPanel = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.3),
  new THREE.MeshBasicMaterial({ map: msgTex, transparent: true, depthTest: false, fog: false }));
msgPanel.renderOrder = 11;
msgPanel.visible = false;
scene.add(msgPanel);
// Wrist message panel: same texture, small, next to the wrist HUD (attached to the left controller).
const wristMsg = new THREE.Mesh(new THREE.PlaneGeometry(0.15, 0.0375),
  new THREE.MeshBasicMaterial({ map: msgTex, transparent: true, depthTest: false, fog: false }));
wristMsg.renderOrder = 11;
wristMsg.visible = false;

// Steering reticle + right-hand pointer.
const reticle = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(
  Array.from({ length: 24 }, (_, i) => new THREE.Vector3(Math.cos(i / 24 * Math.PI * 2) * 0.04, Math.sin(i / 24 * Math.PI * 2) * 0.04, 0))),
new THREE.LineBasicMaterial({ color: 0x66eeff, transparent: true, opacity: 0.8, depthTest: false, fog: false }));
reticle.renderOrder = 5;
scene.add(reticle);
const pointer = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1)]),
  new THREE.LineBasicMaterial({ color: 0x33ddff, transparent: true, opacity: 0.25, fog: false }));

// ---------------------------------------------------------------- steering settings
// 'point' = the ship flies toward where you point the right controller (default).
// 'stick' = right thumbstick flies the ship like a flight stick (alternative).
let invertY = false;
try { invertY = localStorage.getItem('battleRoomInvert') === '1'; } catch (e) { /* ignore */ }
function activeSteer() { return DEMO ? 'point' : settings.steer; }
function steerHelp(mode) {
  const xr = renderer.xr.isPresenting;
  if (gameMode === 'squadron') {
    return xr ? 'Right controller sets the squadron heading - hold trigger: engage, grip: boost, stick click = re-center'
      : 'Mouse sets the squadron heading - hold click: engage, Shift: boost';
  }
  if (mode === 'mirror') return xr ? 'Ship points where the right controller points (x gain) - trigger shoots, grip boosts, stick click = re-center' : 'The ship points where the mouse points - M to switch';
  if (mode === 'relative') return xr ? 'Tilt the right controller like a flight stick - stick click re-centers' : 'Mouse offset from screen centre steers - M to switch';
  if (mode === 'stick') return xr ? 'Right thumbstick flies the ship' : 'I/K nose up/down, J/L turn - M to switch';
  return xr ? 'Point the right controller' : 'Ship flies toward the mouse - M to switch';
}
const STEER_NAMES = { mirror: 'MIRROR', relative: 'RELATIVE', point: 'POINT', stick: 'THUMBSTICK' };
function toggleSteer() {
  const order = ['mirror', 'relative', 'point', 'stick'];
  settings.steer = order[(order.indexOf(settings.steer) + 1) % order.length];
  saveSettings(); syncDesktopSettings(); drawMenu();
  if (settings.steer === 'relative' || settings.steer === 'mirror') needNeutral = true;
  const m = activeSteer();
  showMessage('STEERING: ' + STEER_NAMES[m], steerHelp(m), 2.2);
  sfx.ping(null);
  log('steer mode -> ' + m);
}
function toggleInvert() {
  invertY = !invertY;
  try { localStorage.setItem('battleRoomInvert', invertY ? '1' : '0'); } catch (e) { /* ignore */ }
  showMessage(invertY ? 'UP/DOWN INVERTED' : 'UP/DOWN NORMAL', invertY ? 'Stick up = nose down' : 'Stick up = nose up', 1.8);
  sfx.ping(null);
  log('invertY -> ' + invertY);
}

// Aim line + crosshair out of the ship's nose: where you're heading and where shots go.
{
  const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0.22), new THREE.Vector3(0, 0, 1.9)]);
  g.setAttribute('color', new THREE.Float32BufferAttribute([0.3, 0.9, 1.0, 0.0, 0.1, 0.15], 3));
  const aimLine = new THREE.Line(g, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  const pts = [];
  for (let i = 0; i < 20; i++) {
    const a0 = (i / 20) * Math.PI * 2, a1 = ((i + 1) / 20) * Math.PI * 2;
    pts.push(new THREE.Vector3(Math.cos(a0) * 0.05, Math.sin(a0) * 0.05, 1.9), new THREE.Vector3(Math.cos(a1) * 0.05, Math.sin(a1) * 0.05, 1.9));
  }
  for (const [x, y] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) pts.push(new THREE.Vector3(x * 0.03, y * 0.03, 1.9), new THREE.Vector3(x * 0.075, y * 0.075, 1.9));
  const cross = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts),
    new THREE.LineBasicMaterial({ color: 0x66eeff, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }));
  player.obj.add(aimLine, cross);
}

// Off-screen arrow: a small cyan chevron at the edge of your view pointing toward your ship.
const shipArrow = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints([
  new THREE.Vector3(0, 0.022, 0), new THREE.Vector3(-0.016, -0.012, 0), new THREE.Vector3(0, -0.004, 0), new THREE.Vector3(0.016, -0.012, 0),
]), new THREE.LineBasicMaterial({ color: 0x33ddff, transparent: true, depthTest: false, fog: false }));
shipArrow.renderOrder = 20;
shipArrow.visible = false;
camera.add(shipArrow);
function updateShipArrow(xr) {
  if (!player.alive || state === 'lobby' || tutFreeze) { shipArrow.visible = false; return; }
  _v1.copy(player.obj.position);
  camera.worldToLocal(_v1);
  let visibleOnScreen;
  if (xr) visibleOnScreen = _v1.angleTo(_v2.set(0, 0, -1)) < 0.6;
  else {
    _v2.copy(player.obj.position).project(camera);
    visibleOnScreen = _v2.z < 1 && Math.abs(_v2.x) < 0.95 && Math.abs(_v2.y) < 0.95;
  }
  if (visibleOnScreen) { shipArrow.visible = false; return; }
  let dx = _v1.x, dy = _v1.y;
  const l = Math.hypot(dx, dy);
  if (l < 1e-4) { dx = 0; dy = -1; } else { dx /= l; dy /= l; }
  const rad = xr ? 0.17 : 0.24;
  shipArrow.position.set(dx * rad, dy * rad, -0.5);
  shipArrow.rotation.set(0, 0, Math.atan2(dy, dx) - Math.PI / 2);
  shipArrow.material.opacity = 0.6 + 0.4 * Math.sin(performance.now() * 0.008);
  shipArrow.visible = true;
}

// ---------------------------------------------------------------- relative "hand stick" steering
// The right controller's orientation is captured as NEUTRAL (game start, while grip is held,
// or right-stick click). Tilting away from neutral turns the ship relative to its own heading.
const neutralQ = new THREE.Quaternion();
let needNeutral = true;
// Mirror steering, all in quaternions (no Euler angles, so no pitch limit and no flip at vertical):
//   rel   = neutral^-1 * controller            (controller rotation since re-center, in its own frame)
//   swing = rel with the twist about the controller's forward axis removed (wrist roll is ignored)
//   swing -> axis-angle, angle x gain (capped at 180 deg), axis taken back to world space
//   target ship orientation = scaledSwing * shipNeutral
// The ship's up vector comes from that rotation, so it can loop over the top without snapping.
const mNeutralQ = new THREE.Quaternion();                  // controller orientation at re-center
const SHIP_NEUTRAL_Q = new THREE.Quaternion();             // ship orientation at re-center: into the box
quatFromDir(new THREE.Vector3(0, 0, -1), SHIP_NEUTRAL_Q);
const mirrorQ = SHIP_NEUTRAL_Q.clone();                    // target ship orientation (before cosmetic bank)
const _mq = new THREE.Quaternion(), _mt = new THREE.Quaternion(), _ma = new THREE.Vector3();
function setMirrorTarget(ctrlQ) {
  const g = Number(teamMode() ? settings.steerGainSq : settings.steerGain) || 2;
  _mq.copy(mNeutralQ).invert().multiply(ctrlQ);
  // Swing-twist decomposition about local Z (the controller points down -Z): rel = swing * twist.
  const tl = Math.hypot(_mq.z, _mq.w);
  if (tl > 1e-6) {
    _mt.set(0, 0, _mq.z / tl, _mq.w / tl).invert();
    _mq.multiply(_mt);                                    // swing = rel * twist^-1
  }
  if (_mq.w < 0) _mq.set(-_mq.x, -_mq.y, -_mq.z, -_mq.w); // shortest-arc form: angle in [0, 180]
  const s = Math.hypot(_mq.x, _mq.y, _mq.z);
  if (s < 1e-7) { mirrorQ.copy(SHIP_NEUTRAL_Q); return; }
  const angle = Math.min(Math.PI, 2 * Math.atan2(s, _mq.w) * g);
  _ma.set(_mq.x / s, _mq.y / s, _mq.z / s).applyQuaternion(mNeutralQ);  // axis in world space
  mirrorQ.setFromAxisAngle(_ma, angle).multiply(SHIP_NEUTRAL_Q);
}
const REL_DEAD = 5 * Math.PI / 180, REL_FULL = 35 * Math.PI / 180;
const _qr = new THREE.Quaternion(), _fr = new THREE.Vector3(), _ur = new THREE.Vector3();
function relNorm(a) {
  const m = Math.abs(a);
  if (m < REL_DEAD) return 0;
  return Math.sign(a) * Math.min(1, (m - REL_DEAD) / (REL_FULL - REL_DEAD));
}
// Small gimbal on the controller: outer ring = full deflection, dot = current deflection.
const gimbal = new THREE.Group();
{
  const ringPts = [];
  for (let i = 0; i < 32; i++) { const a = (i / 32) * Math.PI * 2; ringPts.push(new THREE.Vector3(Math.cos(a) * 0.022, Math.sin(a) * 0.022, 0)); }
  const ring = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(ringPts), new THREE.LineBasicMaterial({ color: 0x33ddff, transparent: true, opacity: 0.6 }));
  const deadPts = ringPts.map((v) => v.clone().multiplyScalar(0.12));
  const dead = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(deadPts), new THREE.LineBasicMaterial({ color: 0x1a6680, transparent: true, opacity: 0.6 }));
  const dotPts = ringPts.map((v) => v.clone().multiplyScalar(0.22));
  const dot = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(dotPts), new THREE.LineBasicMaterial({ color: 0xffffff }));
  gimbal.add(ring, dead, dot);
  gimbal.userData.dot = dot;
  gimbal.position.set(0, 0.035, 0.01);
  gimbal.rotation.x = -0.6;
}

// ---------------------------------------------------------------- XR controllers
const hands = { left: null, right: null }; // controller groups by handedness
// Wireframe Touch Plus models (one per hand); the tutorial makes the button to use glow on them.
const touch = { left: createTouchController('left', 0xffcc66), right: createTouchController('right', 0x33ddff) };
let touchHi = {};
function setTouchHighlight(spec) {
  touchHi = spec || {};
  for (const h of ['left', 'right']) touch[h].setHighlight(touchHi[h] || []);
}
for (let i = 0; i < 2; i++) {
  const c = renderer.xr.getController(i);
  rig.add(c);
  c.addEventListener('connected', (ev) => {
    const hand = ev.data.handedness;
    c.userData.source = ev.data;
    c.userData.hand = hand;
    if (hand !== 'left' && hand !== 'right') return;
    hands[hand] = c;
    c.add(touch[hand].root);
    if (hand === 'left') c.add(hudPanel, wristMsg, lPointer);
    else c.add(pointer, gimbal);
    log(`controller connected: ${hand} gamepad=${!!ev.data.gamepad}`);
  });
  c.addEventListener('disconnected', () => {
    const hand = c.userData.hand;
    if (hands[hand] === c) hands[hand] = null;
    while (c.children.length) c.remove(c.children[0]);
    c.userData.source = null;
  });
}
hudPanel.position.set(0, 0.05, 0.03);
hudPanel.rotation.x = -0.75;
// Messages sit just right of the wrist HUD (toward your other hand), at the same tilt, top-aligned.
wristMsg.position.set(0.1 + 0.005 + 0.075, 0.05 + (0.05 - 0.0375 / 2) * Math.cos(0.75), 0.03 - (0.05 - 0.0375 / 2) * Math.sin(0.75));
wristMsg.rotation.x = -0.75;

function haptic(hand, intensity, ms) {
  const c = hands[hand];
  const gp = c && c.userData.source && c.userData.source.gamepad;
  const act = gp && gp.hapticActuators && gp.hapticActuators[0];
  if (act && act.pulse) { try { act.pulse(intensity, ms); } catch (e) { /* ignore */ } }
}

renderer.xr.addEventListener('sessionstart', () => {
  document.body.classList.add('in-vr');
  rig.position.set(0, 0, 0);
  needNeutral = true;
  msgPanel.position.set(0, HEAD_H, -1.8);
  if (state !== 'playing') { if (tutorialDone()) enterLobby(); else startTutorial(); }
  log('xr sessionstart');
});
renderer.xr.addEventListener('sessionend', () => {
  document.body.classList.remove('in-vr');
  msgPanel.visible = false;
  wristMsg.visible = false;
  camera.position.set(0, HEAD_H, 0);
  log('xr sessionend');
});

// ---------------------------------------------------------------- settings application
function applySettings(changed) {
  player.turn = 2.8 * TURN_MULS[settings.turnSpeed];
  if (changed === 'boxSize') { box.size = BOX_SIZES[settings.boxSize]; applyBoard(); saveBox(); }
  if (changed === 'mode' && settings.mode !== gameMode && (state === 'playing' || state === 'gameover')) { startGame(); needNeutral = true; }
  if (changed === 'mode' && state === 'lobby') drawLobby();
}

// ---------------------------------------------------------------- settings menu (VR panel + desktop overlay)
let menuOpen = false, menuHover = -1;
const MENU_W = 760, MENU_TOP = 84, MENU_ROW = 66, MENU_ROWS = SETTINGS_DEF.length + 1, MENU_M = 0.46;
const menuCanvas = document.createElement('canvas');
menuCanvas.width = MENU_W; menuCanvas.height = MENU_TOP + MENU_ROWS * MENU_ROW + 44;
const mnctx = menuCanvas.getContext('2d');
const menuTex = new THREE.CanvasTexture(menuCanvas);
menuTex.colorSpace = THREE.SRGBColorSpace;
const menuPanel = new THREE.Mesh(new THREE.PlaneGeometry(MENU_M, (MENU_M * menuCanvas.height) / MENU_W),
  new THREE.MeshBasicMaterial({ map: menuTex, transparent: true, depthTest: false, fog: false, side: THREE.DoubleSide }));
menuPanel.renderOrder = 30;
menuPanel.visible = false;
rig.add(menuPanel);
function optLabel(d) { const o = d.opts.find((x) => x[0] === settings[d.key]); return o ? o[1] : ''; }
// Every label and value is shrunk to fit its own column, so nothing overlaps.
const menuLayout = [];                               // drawn text extents per row (checked by the tests)
function fitText(g, str, x, y, maxW, size, bold) {
  let sz = size;
  g.font = `${bold ? 'bold ' : ''}${sz}px monospace`;
  while (sz > 12 && g.measureText(str).width > maxW) { sz--; g.font = `${bold ? 'bold ' : ''}${sz}px monospace`; }
  g.fillText(str, x, y);
  const w = g.measureText(str).width;
  const x0 = g.textAlign === 'center' ? x - w / 2 : g.textAlign === 'right' ? x - w : x;
  menuLayout.push({ str, x0, x1: x0 + w, y0: y - sz * 0.78, y1: y + sz * 0.22 });
}
function drawMenu() {
  const g = mnctx, W = MENU_W, H = menuCanvas.height;
  menuLayout.length = 0;
  g.clearRect(0, 0, W, H);
  g.fillStyle = 'rgba(0,10,22,0.92)'; g.fillRect(0, 0, W, H);
  g.strokeStyle = 'rgba(80,220,255,0.8)'; g.lineWidth = 3; g.strokeRect(2, 2, W - 4, H - 4);
  g.fillStyle = '#9ff'; g.textAlign = 'center';
  fitText(g, 'SETTINGS', W / 2, 58, W - 40, 42, true);
  const colL = W * 0.47 - 30, colR = W * 0.47 - 30;
  for (let i = 0; i < MENU_ROWS; i++) {
    const y = MENU_TOP + i * MENU_ROW;
    if (i === menuHover) { g.fillStyle = 'rgba(60,200,255,0.25)'; g.fillRect(12, y, W - 24, MENU_ROW - 8); }
    g.strokeStyle = 'rgba(80,220,255,0.35)'; g.lineWidth = 2; g.strokeRect(12, y, W - 24, MENU_ROW - 8);
    if (i < SETTINGS_DEF.length) {
      const d = SETTINGS_DEF[i];
      g.textAlign = 'left'; g.fillStyle = '#bfefff'; fitText(g, d.label, 28, y + 39, colL, 27);
      g.textAlign = 'right'; g.fillStyle = '#ffcc66'; fitText(g, (d.action || optLabel(d)) + ' >', W - 28, y + 39, colR, 27, true);
    } else {
      g.textAlign = 'center'; g.fillStyle = '#9ff'; fitText(g, 'CLOSE', W / 2, y + 39, W - 60, 28, true);
    }
  }
  g.textAlign = 'center'; g.fillStyle = '#5fa9bf';
  fitText(g, renderer.xr.isPresenting ? 'Point + trigger to change - X+Y closes' : 'Tab closes', W / 2, H - 18, W - 40, 22);
  menuTex.needsUpdate = true;
}
function setSetting(key, val) {
  settings[key] = val;
  saveSettings();
  applySettings(key);
  drawMenu();
  syncDesktopSettings();
  log('setting ' + key + ' = ' + val);
}
function cycleSetting(i) {
  if (i >= SETTINGS_DEF.length) { toggleSettings(false); return; }
  const d = SETTINGS_DEF[i];
  if (d.key === '_lobby') { toggleSettings(false); leaveGame(); sfx.ping(null); return; }
  if (d.action) { resetBox(); showMessage('BOX RESET', 'Back in front of you', 1.0); sfx.ping(null); return; }
  const k = d.opts.findIndex((o) => o[0] === settings[d.key]);
  setSetting(d.key, d.opts[(k + 1) % d.opts.length][0]);
  sfx.ping(null);
}
function toggleSettings(open = !menuOpen) {
  menuOpen = open;
  menuHover = -1;
  if (renderer.xr.isPresenting) {
    menuPanel.visible = open;
    if (open) { placeSide(menuPanel, -1, MENU_M); pointer.visible = true; }   // left of the room, so it never covers the battle
  }
  document.getElementById('settings').classList.toggle('hidden', !(open && !renderer.xr.isPresenting));
  drawMenu();
  log('settings ' + (open ? 'open' : 'closed'));
}
function updateMenuPointer(trigEdge) {
  const prev = menuHover;
  menuHover = -1;
  raycaster.set(input.origin, input.dir);
  const hit = raycaster.intersectObject(menuPanel, false)[0];
  if (hit && hit.uv) {
    const row = Math.floor(((1 - hit.uv.y) * menuCanvas.height - MENU_TOP) / MENU_ROW);
    if (row >= 0 && row < MENU_ROWS) menuHover = row;
    pointer.scale.set(1, 1, hit.distance);
  } else pointer.scale.set(1, 1, 0.5);
  if (trigEdge && menuHover >= 0) cycleSetting(menuHover);
  if (prev !== menuHover) drawMenu();
}
// Desktop overlay: one <select> per setting.
function buildDesktopSettings() {
  const box = document.getElementById('settings-rows');
  for (const d of SETTINGS_DEF) {
    const row = document.createElement('label');
    row.textContent = d.label + ' ';
    if (d.action) {
      const btn = document.createElement('button');
      btn.textContent = d.action; btn.style.marginTop = '0';
      btn.addEventListener('click', () => { if (d.key === '_lobby') leaveGame(); else { resetBox(); showMessage('BOX RESET', 'Back in front of you', 1.0); } });
      row.appendChild(btn); box.appendChild(row);
      continue;
    }
    const sel = document.createElement('select');
    sel.id = 'set-' + d.key;
    for (const [v, l] of d.opts) { const o = document.createElement('option'); o.value = v; o.textContent = l; sel.appendChild(o); }
    sel.addEventListener('change', () => setSetting(d.key, sel.value));
    row.appendChild(sel);
    box.appendChild(row);
  }
  document.getElementById('gear').addEventListener('click', (e) => { e.stopPropagation(); toggleSettings(); });
  document.getElementById('settings-close').addEventListener('click', () => toggleSettings(false));
  syncDesktopSettings();
}
function syncDesktopSettings() {
  for (const d of SETTINGS_DEF) { const el = document.getElementById('set-' + d.key); if (el) el.value = settings[d.key]; }
}

// ---------------------------------------------------------------- desktop input
const keys = new Set();
const mouse = new THREE.Vector2(0, 0);
let mouseDown = false, lookDrag = false, lastMX = 0, lastMY = 0;
let yaw = 0, pitch = -0.12;
const raycaster = new THREE.Raycaster();

window.addEventListener('keydown', (e) => {
  if (!TEST) return;                                 // VR only: the keyboard is a hidden test control
  keys.add(e.code);
  if (e.code === 'KeyR') startGame();
  if (e.code === 'Enter' && state !== 'playing' && !renderer.xr.isPresenting) startGame();
  if (e.code === 'KeyL') enterLobby();
  if (e.code === 'KeyT') startTutorial();
  if (e.code === 'KeyC') resetBox();
  if ((e.code === 'Equal' || e.code === 'Minus')) setTimeout(saveBox, 0);
  if (e.code === 'Tab') { e.preventDefault(); if (!e.repeat) toggleSettings(); }
  if (e.code === 'Escape' && menuOpen) toggleSettings(false);
  if (e.code === 'KeyM' && !e.repeat) toggleSteer();
  if (e.code === 'KeyN' && !e.repeat) setSetting('mode', nextMode());
  if (e.code === 'KeyV' && !e.repeat) toggleInvert();
  if (e.code === 'Space') e.preventDefault();
});
window.addEventListener('keyup', (e) => keys.delete(e.code));
window.addEventListener('blur', () => { keys.clear(); mouseDown = false; lookDrag = false; });
const canvasEl = renderer.domElement;
canvasEl.addEventListener('contextmenu', (e) => e.preventDefault());
canvasEl.addEventListener('pointermove', (e) => {
  mouse.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
  if (lookDrag) {
    yaw -= (e.clientX - lastMX) * 0.005;
    pitch = clamp(pitch - (e.clientY - lastMY) * 0.005, -1.45, 1.45);
  }
  lastMX = e.clientX; lastMY = e.clientY;
});
canvasEl.addEventListener('pointerdown', (e) => {
  lastMX = e.clientX; lastMY = e.clientY;
  sfx.init();
  if (e.button === 2) { lookDrag = true; return; }
  if (e.button === 0 && TEST) mouseDown = true;
});
window.addEventListener('pointerup', (e) => {
  if (e.button === 2) lookDrag = false;
  if (e.button === 0) mouseDown = false;
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---------------------------------------------------------------- per-frame input gathering
const input = {
  hasSteer: false, origin: new THREE.Vector3(), dir: new THREE.Vector3(),
  fire: false, boost: false, brake: false, restart: false, move: new THREE.Vector3(),
  stickX: 0, stickY: 0, relX: 0, relY: 0, leftFire: false,
};
let prevRestartBtn = false, prevB = false, prevStickBtn = false, prevLStick = false, prevXY = false, prevTrigMenu = false, prevLTrig = false, prevLGrip = false;
const MODES = ['fighter', 'squadron'];
function nextMode() { return MODES[(MODES.indexOf(settings.mode) + 1) % MODES.length]; }

function gatherInputVR(dt) {
  input.hasSteer = false; input.fire = false; input.boost = false; input.brake = false; input.restart = false;
  input.move.set(0, 0, 0);
  const R = hands.right, L = hands.left;
  rig.updateMatrixWorld(true);

  input.stickX = 0; input.stickY = 0;
  if (R && R.userData.source && R.userData.source.gamepad) {
    const gp = R.userData.source.gamepad;
    const btn = (k) => !!(gp.buttons[k] && gp.buttons[k].pressed);
    R.getWorldPosition(input.origin);
    input.dir.set(0, 0, -1).applyQuaternion(R.getWorldQuaternion(_q)).normalize();
    input.hasSteer = true;
    const sx = gp.axes.length >= 4 ? gp.axes[2] : 0, sy = gp.axes.length >= 4 ? gp.axes[3] : 0;
    input.stickX = sx; input.stickY = sy;
    const trig = btn(0);
    input.fire = trig;
    const rel = settings.steer === 'relative', mir = settings.steer === 'mirror';
    input.boost = btn(1);                     // grip = boost (every mode)
    input.brake = btn(4);                     // A = brake
    if (settings.steer === 'relative' || settings.steer === 'point') {   // stick forward/back = boost/brake
      if (sy > 0.5) input.brake = true;
      if (sy < -0.5) input.boost = true;
    }
    if (btn(5) && !prevB && !menuOpen && state === 'playing' && settings.steer === 'stick') toggleInvert();   // B = invert (thumbstick mode)
    input.relX = 0; input.relY = 0;
    if (rel) {
      // Stick click = re-center.
      if (btn(3) && !prevStickBtn) { needNeutral = true; haptic('right', 0.4, 40); }
      if (needNeutral) { neutralQ.copy(R.quaternion); needNeutral = false; }
      _qr.copy(neutralQ).invert().multiply(R.quaternion);
      _fr.set(0, 0, -1).applyQuaternion(_qr);
      _ur.set(0, 1, 0).applyQuaternion(_qr);
      const yawL = Math.atan2(-_fr.x, -_fr.z);               // + = pointed left of neutral
      const pitchU = Math.asin(clamp(_fr.y, -1, 1));          // + = tilted up
      const rollL = Math.atan2(-_ur.x, _ur.y);                // + = rolled left
      input.relX = clamp(relNorm(yawL) + relNorm(rollL), -1, 1);
      input.relY = relNorm(pitchU);
    }
    if (mir) {
      R.getWorldQuaternion(_q);
      if ((btn(3) && !prevStickBtn) || needNeutral) {
        // Re-center: the controller's current orientation = ship straight into the box.
        if (btn(3) && !prevStickBtn) SHIP_NEUTRAL_Q.copy(BOX_FWD_Q);
        mNeutralQ.copy(_q);
        needNeutral = false;
        haptic('right', 0.4, 40);
      }
      setMirrorTarget(_q);
    }
    gimbal.visible = rel;
    gimbal.userData.dot.position.set(-input.relX * 0.022, input.relY * 0.022, 0);
    prevB = btn(5); prevStickBtn = btn(3);
    const restartBtn = trig || btn(4);
    input.restart = restartBtn && !prevRestartBtn;
    prevRestartBtn = restartBtn;
    const trigEdge = trig && !prevTrigMenu;
    prevTrigMenu = trig;
    if (menuOpen) { input.fire = false; input.restart = false; updateMenuPointer(trigEdge); }
    else if (uiRay('right', R, trig, trigEdge)) { input.fire = false; input.restart = false; }
    boxGrab('right', R, btn(1), sy, dt);
    if (state === 'lobby' || tutFreeze) input.boost = false;
  }

  if (L && L.userData.source && L.userData.source.gamepad) {
    const gp = L.userData.source.gamepad;
    const btn = (k) => !!(gp.buttons[k] && gp.buttons[k].pressed);
    const sx = gp.axes.length >= 4 ? gp.axes[2] : 0, sy = gp.axes.length >= 4 ? gp.axes[3] : 0;
    const dead = (a) => (Math.abs(a) < 0.15 ? 0 : a);
    // X+Y together = open/close settings.
    const xy = btn(4) && btn(5);
    if (xy && !prevXY) toggleSettings();
    prevXY = xy;
    const lt = btn(0);
    const onUi = !menuOpen && uiRay('left', L, lt, lt && !prevLTrig);
    boxGrab('left', L, btn(1), sy, dt);
    if (onUi || state === 'lobby') { prevLStick = btn(3); prevLTrig = lt; prevLGrip = btn(1); return; }
    // Stick click = put the box back in its default spot (also in Settings).
    if (btn(3) && !prevLStick && !tutFreeze) { resetBox(); showMessage('BOX RESET', 'Back in front of you', 1.0); }
    // LEFT TRIGGER = shoot (and start / restart).
    if (!menuOpen) {
      if (lt) input.fire = true;
      if (lt && !prevLTrig) input.restart = true;
    }
    // LEFT GRIP = boost.
    if (btn(1)) input.boost = true;
    prevLStick = btn(3); prevLTrig = lt; prevLGrip = btn(1);
    // Stick forward = boost, back = brake.
    if (sy < -0.5) input.boost = true;
    if (sy > 0.5) input.brake = true;
  }
}

// ---------------------------------------------------------------- VR panels: pointer rays + box grab
// Both controllers can point at the lobby / tutorial panels; the trigger presses the button you point at.
const lPointer = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1)]),
  new THREE.LineBasicMaterial({ color: 0xffcc66, transparent: true, opacity: 0.35, fog: false }));
lPointer.visible = false;
const uiHit = { left: null, right: null };
const uiHeld = { left: false, right: false };          // a trigger press that clicked a button (not a shot)
function activePanels() { return [lobbyPanel, tutorial.card, tutorial.big].filter((p) => p.visible); }
function uiRay(hand, ctrl, trig, edge) {
  const line = hand === 'right' ? pointer : lPointer;
  ctrl.getWorldPosition(_v3);
  _v2.set(0, 0, -1).applyQuaternion(ctrl.getWorldQuaternion(_q));
  raycaster.set(_v3, _v2);
  let best = null, bp = null;
  for (const P of activePanels()) { const h = P.pick(raycaster); if (h && (!best || h.dist < best.dist)) { best = h; bp = P; } }
  uiHit[hand] = best ? { panel: bp, id: best.id } : null;
  for (const P of activePanels()) {
    const hov = (uiHit.right && uiHit.right.panel === P && uiHit.right.id) || (uiHit.left && uiHit.left.panel === P && uiHit.left.id) || null;
    if (P.hover !== hov) { P.hover = hov; if (P === lobbyPanel) drawLobby(); else tutorial.redraw(); }
  }
  // The tutorial card only takes over the controller while you point at one of its buttons, so it
  // never blocks shooting, selecting or ordering at ships seen past it.
  const capture = !!best && (!!best.id || bp !== tutorial.card);
  const showRay = capture || state === 'lobby';
  if (hand === 'left') line.visible = showRay;
  else if (showRay) line.visible = true;
  line.scale.set(1, 1, capture ? best.dist : 0.5);
  if (edge && best && best.id) { uiHeld[hand] = true; haptic(hand, 0.3, 25); sfx.ping(null); bp.onClick(best.id); }
  if (!trig) uiHeld[hand] = false;
  return capture || uiHeld[hand];
}
// Lobby and the first tutorial step: hold a grip to move the room; push that hand's stick to resize it.
const grab = { hand: null, start: new THREE.Vector3(), x: 0, y: 0, z: 0, moved: 0 };
function boxGrab(hand, ctrl, grip, sy, dt) {
  const allowed = (state === 'lobby' || tutFreeze) && !menuOpen;
  if (!allowed || !grip) { if (grab.hand === hand) { grab.hand = null; saveBox(); } return; }
  ctrl.getWorldPosition(_v3);
  if (grab.hand === null) { grab.hand = hand; grab.start.copy(_v3); grab.x = box.x; grab.y = box.y; grab.z = box.z; }
  if (grab.hand !== hand) return;
  box.x = grab.x + _v3.x - grab.start.x; box.y = grab.y + _v3.y - grab.start.y; box.z = grab.z + _v3.z - grab.start.z;
  if (Math.abs(sy) > 0.15) box.size = clamp(box.size * Math.exp(-sy * dt * 0.9), 0.3, 2.0);
  grab.moved += _v3.distanceTo(grab.start) * dt;
  applyBoard();
}
// Panels sit beside the room (and follow it when you move it), turned to face you.
function placeSide(mesh, side, widthM) {
  const sc = board.scale.x;
  mesh.position.set(board.position.x + side * (HB.x * sc + 0.07 + widthM / 2), board.position.y + 0.03, board.position.z + HB.z * sc * 0.55);
  camera.getWorldPosition(_v1);
  faceYaw(mesh, _v1);
}
function placeTutCard(mesh, widthM) {
  const sc = board.scale.x;
  camera.getWorldPosition(_v1);
  const x = board.position.x + HB.x * sc + 0.04 + widthM / 2;
  const near = board.position.z + HB.z * sc, far = board.position.z - HB.z * sc;
  const z = clamp(_v1.z - Math.max(0.2, x - _v1.x) / Math.tan(0.56), far, near);
  mesh.position.set(x, Math.min(board.position.y, _v1.y - 0.12), z);
  faceYaw(mesh, _v1);
  mesh.scale.setScalar(clamp(mesh.position.distanceTo(_v1) / 1.05, 0.8, 2.4));
}
function placeTutBelow(mesh, heightM) {
  const sc = board.scale.x;
  const near = board.position.z + HB.z * sc;
  camera.getWorldPosition(_v1);
  const z = near - 0.5 * 2 * HB.z * sc;
  const k = clamp(Math.hypot(_v1.z - z, _v1.y - (board.position.y - HB.y * sc)) / 1.0, 0.8, 2.2);
  mesh.scale.setScalar(k);
  mesh.position.set(board.position.x, board.position.y - HB.y * sc - 0.03 - (heightM * k) / 2, z);
  faceYaw(mesh, _v1);
  // Tilt it back so it faces your eyes.
  mesh.rotateX(-Math.atan2(_v1.y - mesh.position.y, Math.hypot(_v1.x - mesh.position.x, _v1.z - mesh.position.z)));
}
function placePanels() {
  if (lobbyPanel.visible) placeSide(lobbyPanel.mesh, 1, lobbyPanel.widthM);
  if (tutorial.card.visible) placeTutCard(tutorial.card.mesh, tutorial.card.widthM);
  if (tutorial.big.visible) placeTutBelow(tutorial.big.mesh, (tutorial.big.widthM * tutorial.big.H) / tutorial.big.W);
  if (menuPanel.visible) placeSide(menuPanel, -1, MENU_M);
}

function gatherInputDesktop() {
  // Look (head substitute): right-drag or arrow keys.
  const lookSpeed = 1.6 / 60;
  if (keys.has('ArrowLeft')) yaw += lookSpeed;
  if (keys.has('ArrowRight')) yaw -= lookSpeed;
  if (keys.has('ArrowUp')) pitch = clamp(pitch + lookSpeed, -1.45, 1.45);
  if (keys.has('ArrowDown')) pitch = clamp(pitch - lookSpeed, -1.45, 1.45);
  camera.position.set(0, HEAD_H + 0.05, 0.45);
  camera.rotation.set(pitch, yaw, 0, 'YXZ');
  camera.updateMatrixWorld(true);

  input.move.set(0, 0, 0);
  const f = getCamForwardFlat(_v1);
  const r = _v2.set(-f.z, 0, f.x);
  if (keys.has('KeyW')) input.move.add(f);
  if (keys.has('KeyS')) input.move.sub(f);
  if (keys.has('KeyD')) input.move.add(r);
  if (keys.has('KeyA')) input.move.sub(r);
  if (keys.has('KeyE')) input.move.y += 1;
  if (keys.has('KeyQ')) input.move.y -= 1;
  const speed = 0;                               // the view never moves
  if (input.move.lengthSq() > 0) input.move.normalize().multiplyScalar(speed);

  raycaster.setFromCamera(mouse, camera);
  input.origin.copy(raycaster.ray.origin);
  input.dir.copy(raycaster.ray.direction);
  // Mirror on desktop: neutral = the camera, "controller" = the camera turned onto the mouse ray.
  camera.getWorldQuaternion(mNeutralQ);
  camera.getWorldDirection(_v3);
  setMirrorTarget(_q.setFromUnitVectors(_v3, input.dir).multiply(mNeutralQ));
  input.hasSteer = true;
  input.fire = (mouseDown || keys.has('Space')) && !menuOpen;
  input.boost = keys.has('ShiftLeft') || keys.has('ShiftRight');
  input.brake = keys.has('ControlLeft') || keys.has('KeyF');
  input.restart = false;
  input.stickX = (keys.has('KeyL') ? 1 : 0) - (keys.has('KeyJ') ? 1 : 0);
  input.stickY = (keys.has('KeyK') ? 1 : 0) - (keys.has('KeyI') ? 1 : 0);
  // Relative mode on desktop: cursor offset from screen centre = stick deflection.
  const dn = (a) => { const m = Math.abs(a); return m < 0.05 ? 0 : Math.sign(a) * Math.min(1, (m - 0.05) / 0.55); };
  input.relX = dn(-mouse.x); input.relY = dn(mouse.y);
  // +/- scale the box.
  if (keys.has('Equal')) { box.size *= 1.01; applyBoard(); }
  if (keys.has('Minus')) { box.size /= 1.01; applyBoard(); }

  if (DEMO && player.alive) {
    // Autopilot: chase the nearest enemy and shoot when lined up.
    let near = null, nd = Infinity;
    for (const e of enemies) { const d = e.obj.position.distanceTo(player.obj.position); if (d < nd) { nd = d; near = e; } }
    if (near) {
      input.origin.copy(player.obj.position);
      input.dir.subVectors(near.obj.position, player.obj.position).normalize();
      input.fire = gameMode === 'squadron' ? nd < 3.5 * S : player.fwd.angleTo(input.dir) < 0.3 && nd < 6 * S;
      input.boost = nd > 3 * S;
    }
  }
}

// ---------------------------------------------------------------- update
// Flight-stick steering: stick X = turn (yaw), stick Y = nose up/down (pitch).
// Turn rates ease in/out; roll only banks into turns and always levels back out,
// so the ship stays upright relative to the world.
function flyByStick(dt, rx, ry) {
  const p = player.obj.position;
  const shape = (a) => {
    const m = Math.abs(a);
    if (m < 0.12) return 0;                     // deadzone
    const t = Math.min(1, (m - 0.12) / 0.88);
    return Math.sign(a) * t * Math.sqrt(t);     // gentle near centre, full at the edge
  };
  const direct = rx !== undefined;                 // relative mode passes ready-made deflections
  const sx = direct ? rx : shape(input.stickX);
  const sy = direct ? ry : shape(input.stickY) * (invertY ? -1 : 1);
  const k = 1 - Math.exp(-dt * 7);
  const tm = TURN_MULS[settings.turnSpeed] / 1.6;
  player.yawRate += (-sx * MAX_YAW * tm - player.yawRate) * k;       // stick right = turn right
  player.pitchRate += (-sy * MAX_PITCH * tm - player.pitchRate) * k; // stick up (-1) = nose up
  let az = Math.atan2(player.fwd.x, player.fwd.z);
  let el = Math.asin(clamp(player.fwd.y, -1, 1));
  az += player.yawRate * dt;
  el = clamp(el + player.pitchRate * dt, -MAX_ELEV, MAX_ELEV);
  const desired = _v1.set(Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az));
  if (Math.abs(desired.y) > Math.sin(MAX_ELEV)) {
    const h = Math.hypot(desired.x, desired.z) || 1;
    const c = Math.cos(MAX_ELEV) / h;
    desired.set(desired.x * c, Math.sign(desired.y) * Math.sin(MAX_ELEV), desired.z * c);
  }
  const prev = _v3.copy(player.fwd);
  player.fwd.copy(desired).normalize();
  const turn = (prev.z * player.fwd.x - prev.x * player.fwd.z) / Math.max(dt, 1e-4);
  player.bank += (clamp(-turn * 0.35, -0.9, 0.9) - player.bank) * Math.min(1, dt * 5);
  quatFromDir(player.fwd, player.obj.quaternion);
  _q.setFromAxisAngle(ZAXIS, player.bank);
  player.obj.quaternion.multiply(_q);
}

// Mirror steering: the ship's full orientation slerps toward mirrorQ (~65 ms smoothing).
// Its up vector comes from that orientation, so it never flips at vertical or upside down.
// A small cosmetic bank (about the ship's own up axis turn rate) goes on top.
function flyMirror(dt) {
  const prev = _v3.copy(player.fwd);
  player.mq.slerp(mirrorQ, 1 - Math.exp(-dt / 0.065)).normalize();
  player.fwd.set(0, 0, 1).applyQuaternion(player.mq);
  const up = _v2.set(0, 1, 0).applyQuaternion(player.mq);
  const turn = _v1.crossVectors(prev, player.fwd).dot(up) / Math.max(dt, 1e-4);   // + = turning left
  player.bank += (clamp(-turn * 0.2, -0.6, 0.6) - player.bank) * Math.min(1, dt * 6);
  player.obj.quaternion.copy(player.mq).multiply(_q.setFromAxisAngle(ZAXIS, player.bank));
}
let lastFlyMode = '';

function updatePlayer(dt) {
  if (!player.alive || tutFreeze) return;
  const p = player.obj.position;
  const mode = activeSteer();
  pointer.visible = mode === 'point' || !!uiHit.right;
  if (mode === 'mirror' && lastFlyMode !== 'mirror') quatFromDir(player.fwd, player.mq);   // coming from another mode
  lastFlyMode = mode;
  if (mode === 'mirror') {
    reticle.visible = false;
    if (input.hasSteer) flyMirror(dt);
  } else if (mode === 'relative') {
    reticle.visible = false;
    flyByStick(dt, -input.relX, -input.relY);
  } else if (mode === 'point') {
    const desired = _v1.copy(player.fwd);
    if (input.hasSteer) {
      if (!DEMO) {
        // Fly in the direction you point.
        desired.copy(input.dir);
      } else {
        const d = input.origin.distanceTo(p) + LEAD;
        desired.subVectors(_v2.copy(input.origin).addScaledVector(input.dir, d), p).normalize();
      }
      // Short "steering stick": the laser + ring sit 0.5 m out from your hand.
      reticle.position.copy(input.origin).addScaledVector(input.dir, 0.5);
      reticle.visible = true;
      if (renderer.xr.isPresenting && hands.right) pointer.scale.set(1, 1, 0.5);
    }
    steer(player, desired.clone(), dt);
  } else {
    reticle.visible = false;
    flyByStick(dt);
  }
  if (gameMode === 'squadron') {
    // The command point: boost only while NOT engaging (the bots all boost with it); slow while engaged.
    const targetSpeed = input.fire ? CRUISE * 0.55 : input.boost ? BOOST : input.brake ? BRAKE : CRUISE;
    player.speed += (targetSpeed - player.speed) * Math.min(1, dt * 3);
    player.vel.copy(player.fwd).multiplyScalar(player.speed);
    p.addScaledVector(player.vel, dt);
    wrapBox(p);
    obstPushOut(p, 0.15 * S);
    return;
  }
  const targetSpeed = input.boost ? BOOST : input.brake ? BRAKE : CRUISE;
  player.speed += (targetSpeed - player.speed) * Math.min(1, dt * 3);
  player.vel.copy(player.fwd).multiplyScalar(player.speed);
  p.addScaledVector(player.vel, dt);
  if (wrapBox(p)) { resetTrail(); blink(p, PLAYER_COLOR); }

  // Shooting, with gentle aim assist toward an enemy inside a narrow cone.
  player.fireCd -= dt;
  if (input.fire && player.fireCd <= 0 && combat() && !tutFreeze) {
    shotsFired++;
    const dir = player.fwd.clone();
    let bestE = null, bestA = 0.2;
    for (const e of enemies) {
      const to = _v3.subVectors(e.obj.position, p);
      const a = player.fwd.angleTo(to);
      if (a < bestA && to.length() < 7 * S) { bestA = a; bestE = e; }
    }
    if (bestE) {
      const t = bestE.obj.position.distanceTo(p) / (7 * S);
      const lead = _v3.copy(bestE.obj.position).addScaledVector(bestE.fwd, bestE.speed * t).sub(p).normalize();
      dir.lerp(lead, 0.6).normalize();
    }
    playerBullets.spawn(_v3.copy(p).addScaledVector(player.fwd, 0.2 * S), dir.multiplyScalar(7 * S).addScaledVector(player.vel, 0.5), 1.6);
    sfx.laser(p);
    haptic('right', 0.25, 20);
    player.fireCd = 0.14;
  }

  // Invulnerability blink + hit flash.
  player.invuln = Math.max(0, player.invuln - dt);
  player.flash = Math.max(0, player.flash - dt);
  if (player.flash > 0) tintShip(player.obj, WHITE);
  else tintShip(player.obj, _c.copy(PLAYER_COLOR).multiplyScalar(player.invuln > 0 && Math.floor(player.invuln * 12) % 2 ? 0.35 : 1));

  trailTimer -= dt;
  if (trailTimer <= 0) {
    trailTimer = 0.03;
    trailArr.copyWithin(3, 0, (TRAIL_N - 1) * 3);
    _v3.copy(p).addScaledVector(player.fwd, -0.1 * S);
    trailArr[0] = _v3.x; trailArr[1] = _v3.y; trailArr[2] = _v3.z;
    trail.geometry.attributes.position.needsUpdate = true;
  }
}

function updateCollisions() {
  const sq = teamMode();
  if (sq) {
    // Stars block bullets from both sides.
    for (const b of playerBullets.list) if (obstInside(b.pos)) b.dead = true;
    for (const b of enemyBullets.list) if (obstInside(b.pos)) b.dead = true;
    for (const b of enemyBullets.list) {
      if (b.dead) continue;
      for (const t of friends) {
        if (t.alive && segPointDist(b.prev, b.pos, t.obj.position) < (t.radius || 0.14 * S)) { b.dead = true; damageTarget(t); break; }
      }
    }
  }
  for (const b of playerBullets.list) {
    if (b.dead) continue;
    for (const e of enemies) {
      if (e.hp > 0 && segPointDist(b.prev, b.pos, e.obj.position) < e.radius) {
        b.dead = true;
        damageEnemy(e, 1);
        break;
      }
    }
  }
  if (player.alive && !sq) {
    for (const b of enemyBullets.list) {
      if (segPointDist(b.prev, b.pos, player.obj.position) < 0.14 * S) {
        b.dead = true;
        damagePlayer();
      }
    }
  }
  playerBullets.list = playerBullets.list.filter((b) => !b.dead);
  enemyBullets.list = enemyBullets.list.filter((b) => !b.dead);
}

function updateCameraRig() { /* the view never moves */ }

// One simulation step. Rounds, the lobby skirmish, the tutorial and game over -> lobby.
let statsSaveT = 0;
function simStep(dt) {
  stateTimer += dt;
  simTime += dt;
  if (state === 'lobby') {
    updateMorph(dt);
    updateStars(dt);
    updateLobby(dt);
    if (DEMO && !BENCH && stateTimer > 2) startGame();
  } else if (!menuOpen) {
    updateMorph(dt);
    updateStars(dt);
    updatePlayer(dt);
    refreshFriends();
    if (gameMode === 'squadron') updateBots(dt);
    updateEnemies(dt);
    playerBullets.update(dt);
    enemyBullets.update(dt);
    updateCollisions();
    if (state === 'tutorial') tutorial.update(dt);
    else if (state === 'playing') {
      stats.time += dt;
      if ((statsSaveT += dt) > 15) { statsSaveT = 0; saveStats(); }
      if (enemies.length === 0) {
        if (intermission <= 0) {
          // Round cleared: bonus, the stars fade out and the room reshapes; then a fresh battle starts.
          intermission = 3.2;
          morphTo(pickShape(_shapeTmp), 2.4);
          starTarget = 0;
          const bonus = 500 * wave;
          score += bonus;
          saveBest();
          showMessage(`ROUND ${wave} CLEARED`, `+${bonus} round bonus - next: a fresh battle, full strength`, 2.8);
          log(`round cleared mode=${gameMode} round=${wave} t=${simTime.toFixed(1)}`);
        } else {
          intermission -= dt;
          if (intermission <= 0) startRound(wave + 1);
        }
      }
    } else if (state === 'gameover') {
      reticle.visible = false;
      if (stateTimer > 4.5 && !BENCH) enterLobby();
    }
  }
  updateEffects(dt);
  if (msgTime > 0 && msgTime < 9000) { msgTime -= dt; if (msgTime <= 0) hideMessage(); }
}

let hudTimer = 0, statusTimer = 0, frames = 0;
let lastT = performance.now();
function loop() {
  const now = performance.now();
  const dt = Math.min((now - lastT) / 1000, 0.05);
  lastT = now;
  frames++;
  const xr = renderer.xr.isPresenting;

  if (xr) gatherInputVR(dt); else gatherInputDesktop();
  updateCameraRig(dt);
  camera.getWorldPosition(camPos);
  camera.getWorldDirection(camFwd);
  sfx.setListener(camPos, camFwd, UP);
  stars.position.copy(camPos);
  grid.position.x = Math.round(camPos.x / GRID_STEP) * GRID_STEP;
  grid.position.z = Math.round(camPos.z / GRID_STEP) * GRID_STEP;

  for (let k = 0; k < SIM; k++) simStep(dt);
  playerBullets.sync();
  enemyBullets.sync();
  placePanels();
  { const tn = performance.now() / 1000; touch.left.update(tn); touch.right.update(tn); }
  if (xr && msgPanel.visible) {
    _v1.copy(camPos).addScaledVector(camFwd, 1.8);
    msgPanel.position.lerp(_v1, 1 - Math.exp(-3 * dt));
    msgPanel.lookAt(camPos);
  }
  reticle.lookAt(camPos);
  hudPanel.visible = state !== 'lobby' && state !== 'tutorial';

  // Red screen flash on hit (desktop overlay; in VR the ship flash + haptics carry it).
  screenFlash = Math.max(0, screenFlash - dt);
  document.getElementById('flash').style.opacity = String(screenFlash * 2);

  hudTimer -= dt;
  if (hudTimer <= 0) { hudTimer = 0.1; drawHud(); }

  if (TEST) {
    statusTimer -= dt;
    if (statusTimer <= 0) {
      statusTimer = 3;
      log(`status mode=${gameMode} state=${state} wave=${wave} score=${score} kills=${kills} hp=${player.hp} bots=${bots.filter((b) => b.alive).map((b) => b.hp).join('')} enemies=${enemies.length} fps~${Math.round(frames / 3)} xr=${xr}`);
      frames = 0;
    }
  }
  renderer.render(scene, camera);
}

applySettings();
buildDesktopSettings();
if (AUTO_MODE && MODES.includes(AUTO_MODE)) settings.mode = AUTO_MODE;   // test: this mode (not saved)
enterLobby();
drawMenu();
drawHud();
renderer.setAnimationLoop(loop);
if (AUTO_MODE && !DEMO && !BENCH) startGame();
log('READY three r' + THREE.REVISION);

// Hooks for automated testing / tinkering from the console.
window.__game = {
  get state() { return state; }, get score() { return score; }, get wave() { return wave; },
  get hp() { return player.hp; }, get enemies() { return enemies.length; },
  player, enemiesList: enemies, startGame, rig, camera, renderer, scene, shipArrow, pointer, reticle,
  get steerMode() { return activeSteer(); }, get invertY() { return invertY; },
  settings, setSetting, neutralQ, input, gimbal, board, box, mirrorQ, bots, obstacles, groups,
  get mode() { return gameMode; }, get boxB() { return BOX_B; }, HB, get morphing() { return morphT < 1; }, AI, bestRound, damageBot, get msgTitle() { return msgTitle; }, get msgSub() { return msgSub; }, get starsOn() { return starsOn; }, get starAlpha() { return starAlpha; }, startRound, wristMsg, msgPanel, hudPanel, get friends() { return friends; }, get squadEngaged() { return squadEngaged; },
  lobbyPanel, tutorial, enterLobby, startTutorial, finishTutorial, stats, recordGame, leaveGame, grab, uiHit, placePanels,
  get simTime() { return simTime; }, menuLayout, get kills() { return kills; },
  get tutStage() { return tutStageName; }, get tutFreeze() { return tutFreeze; }, get shots() { return shotsFired; },
  tutorialDone, spawnTut, setTutStage: tutStage, applyBoard, drawMenu, touch, get hudVisible() { return hudPanel.visible; }, get menuCanvas() { return menuCanvas; }, MENU_TOP, MENU_ROW, MENU_ROWS,
  startGameAt(mode, round) { settings.mode = mode; startGame(round); },
  get enemyBullets() { return enemyBullets.list.length; }, get bullets() { return playerBullets.list.length; }, toggleSettings, get menuOpen() { return menuOpen; }, get menuHover() { return menuHover; }, menuPanel,
};
