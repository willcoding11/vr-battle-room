// COMMAND ROOM - a seated, tabletop (diorama) wireframe space battle for WebXR (Meta Quest). VR only:
// the page shows one ENTER VR button. In VR you land in the lobby (after the first-run tutorial).
// A hidden desktop mode (mouse + keyboard, autopilot) remains for automated testing: ?test.
import * as THREE from '../vendor/three.module.js';
import { createSteer, steerStep } from './steer.js?v=38';
import { buildPlayerShip, buildFighter, buildCruiser, tintShip, getDotTexture } from './models.js?v=38';
import { createTouchController } from './controller.js?v=38';
import { Sfx } from './audio.js?v=38';
import { UI } from './ui.js?v=38';
import { stats, saveStats, recordGame, recordEndless, addPlayTime, fmtTime, fmtNum } from './stats.js?v=38';
import { createTutorial } from './tutorial.js?v=38';
import { createRingUI } from './ring.js?v=38';
import { createEndless } from './endless.js?v=38';

const URLQ = new URLSearchParams(location.search);
const TEST = URLQ.has('test');                           // test hooks + hidden desktop controls
const DEMO = TEST && URLQ.has('demo');                   // autopilot
const BENCH = TEST && URLQ.has('bench');                 // a test script drives the games (no auto start)
const START_WAVE = Math.max(1, parseInt(URLQ.get('wave'), 10) || 1);
const SIM = TEST ? Math.max(1, Math.min(12, parseInt(URLQ.get('sim'), 10) || 1)) : 1;   // test: sim steps per frame
const AUTO_MODE = TEST ? URLQ.get('mode') : null;        // test: start this mode right away
const EASY = TEST && URLQ.has('easy');                   // test: Endless at the v32 balance (for comparisons)
const log = (m) => { if (TEST && window.__log) window.__log(m); };
if (TEST) document.body.classList.add('test');
if (DEMO) document.body.classList.add('demo');

// ---------------------------------------------------------------- constants
const S = 0.5;                                    // world scale: everything is "zoomed out" to half size
const HEAD_H = 1.2;                               // seated eye height (desktop)
const ARENA_C = new THREE.Vector3(0, 0, 0);       // battle centre = centre of the box (game units)
// Battle box half-size in game units. The box keeps its physical size in front of you, so a bigger
// BOX_B = more room relative to the ships. Fighter: 2.8 (was 1.75). Squadron: zoomed out much further.
const MODE_BOX = { fighter: 2.8, squadron: 5.0, endless: 6.5 };   // Endless: the view window round your ship (v30: wider)
let BOX_B = MODE_BOX.fighter;                     // base half-size: sets the scale (ship size) for the mode
// The room's actual half-extents per axis. Width, height and depth vary independently (long, flat,
// tall or cube) with roughly the same volume as a BOX_B cube; they change each game and each wave.
const HB = new THREE.Vector3(BOX_B, BOX_B, BOX_B);
// Endless mode (endless.js): no walls, the world moves round your ship. VC = the view centre (your ship or
// command point) in world coordinates; AH = the half-size of the area enemies keep to (the room in the
// other modes; round their outpost in Endless, centred on ARENA_C).
let endless = false, E = null, AH = HB;
const VC = new THREE.Vector3();
const FRIEND_COLOR = new THREE.Color(0x33ddff);
const PLAYER_COLOR = new THREE.Color(0x33ddff);
const ENEMY_COLOR = new THREE.Color(0xff3344);
const LEADER_COLOR = new THREE.Color(0xff8833);   // enemy squadron leaders
const ACE_COLOR = new THREE.Color(0xffc22e);      // named enemy aces
const WHITE = new THREE.Color(0xffffff);
const MAX_HP = 5;
let playerMax = MAX_HP, botMax = 3, fireMul = 1;   // hull / fire-rate upgrades (Endless)
// v33 Endless upgrades (endless.js sets them; always neutral in Fighter / Squadron).
const MODS = { dmg: 1, bspeed: 1, spread: false, pierce: 0, speed: 1, shield: 0, magnet: 0 };
function resetMods() { Object.assign(MODS, { dmg: 1, bspeed: 1, spread: false, pierce: 0, speed: 1, shield: 0, magnet: 0 }); }
const CRUISE = 1.6 * S, BOOST = 3.2 * S, BRAKE = 0.5 * S; // player speeds (m/s)
const LEAD = 0.9 * S;                             // how far past the ship the steering target sits
const FOLLOW_H = 0.3;                             // follow view height = distance * this

// ---------------------------------------------------------------- settings (saved in localStorage)
const GAIN_OPTS = [['1', '1x'], ['1.5', '1.5x'], ['2', '2x'], ['2.5', '2.5x'], ['3', '3x'], ['3.5', '3.5x']];
const VOL_OPTS = Array.from({ length: 11 }, (_, i) => [String(i), String(i)]);   // 0..10 (sliders)
const SETTINGS_DEF = [
  { key: 'mode', label: 'Game mode', opts: [['fighter', 'Fighter'], ['squadron', 'Squadron'], ['endless', 'Endless']] },
  { key: 'steerGain', label: 'Steering gain (Fighter)', opts: GAIN_OPTS },
  { key: 'steerGainSq', label: 'Steering gain (Squadron)', opts: GAIN_OPTS },
  { key: 'boxSize', label: 'Box size', opts: [['small', 'Small'], ['medium', 'Medium'], ['large', 'Large']] },
  { key: 'musicVol', label: 'Music volume', opts: VOL_OPTS, slider: true },
  { key: 'sfxVol', label: 'Sound volume', opts: VOL_OPTS, slider: true },
  { key: '_box', label: 'Box position', opts: [], action: 'RESET' },     // actions, not stored settings
  { key: '_lobby', label: 'Leave game', opts: [], action: 'TO LOBBY' },
];
const SETTINGS_DEFAULT = { mode: 'fighter', boxSize: 'small', steerGain: '2', steerGainSq: '3', musicVol: '6', sfxVol: '8' };
const BOX_SIZES = { small: 0.7, medium: 1.0, large: 1.3 };     // box width in metres
const TURN_RATE = 2.8 * 2.6;                                   // turn rate of command points / autopilot (rad/s scale)
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
// Everything that moves lives in `world` (inside the board). In Endless it is shifted so your ship stays
// in the middle of the view; in the other modes it sits at the board's origin.
const world = new THREE.Group();
board.add(world);
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
const FRAME_COLOR = new THREE.Color(0x2a86a8);
{
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(2, 2, 2)),
    new THREE.LineBasicMaterial({ color: FRAME_COLOR, transparent: true, opacity: 0.7, depthWrite: false }));
  boxFrame.userData.edges = edges;
  const floor = new THREE.GridHelper(2, 10, 0x15506a, 0x0d3344);
  floor.position.y = -1;
  floor.material.transparent = true;
  floor.material.opacity = 0.5;
  floor.material.depthWrite = false;
  // Drawn before the holo ring (ring.js), which then sits cleanly over the frame lines behind it.
  edges.renderOrder = floor.renderOrder = -2;
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
  if (endless) return out;                          // no walls, no wrap-around
  for (const k of ['x', 'y', 'z']) {
    if (out[k] > HB[k]) out[k] -= 2 * HB[k]; else if (out[k] < -HB[k]) out[k] += 2 * HB[k];
  }
  return out;
}
function outsideBox(p, m = 1) {
  if (endless) return winDist(p, VC) > BOX_B * (state === 'lobby' ? 1 : 1.15) * m;   // past the edge of the view window
  return Math.abs(p.x) > HB.x * m || Math.abs(p.y) > HB.y * m || Math.abs(p.z) > HB.z * m;
}
// Distance from the view centre for the Endless window: a sphere in a run; in the lobby preview, the
// room's cube (the room's frame is hidden but the action stays in the same volume).
function winDist(p, c) {
  if (state === 'lobby') return Math.max(Math.abs(p.x - c.x), Math.abs(p.y - c.y), Math.abs(p.z - c.z));
  return p.distanceTo(c);
}
// Wrap-around: leave through one face, come back in through the opposite face.
function wrapBox(p) {
  if (endless) return false;
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
sfx.toWorld = (v) => world.localToWorld(v.clone());

// ---------------------------------------------------------------- helpers
function shrink(obj) { obj.scale.setScalar(S); obj.userData.ptBase = obj.userData.mats[1].size; obj.userData.mats[1].size *= S * board.scale.x; return obj; }
function randomArenaPoint(scale = 0.8) {
  _v1.randomDirection().multiplyScalar(Math.cbrt(Math.random()) * scale * 0.9);
  return new THREE.Vector3(ARENA_C.x + _v1.x * AH.x, ARENA_C.y + _v1.y * AH.y, ARENA_C.z + _v1.z * AH.z);
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
    world.add(this.mesh);
  }
  spawn(pos, vel, life, src) {
    if (this.list.length >= this.max) return null;
    const b = { pos: pos.clone(), prev: pos.clone(), vel: vel.clone(), life, dead: false, src, dmg: 1, pierce: 0, hit: null, home: null };
    this.list.push(b);
    return b;
  }
  update(dt) {
    for (const b of this.list) {
      if (b.home && b.home.hp > 0) {                 // (Endless homing missile)
        const sp = b.vel.length();
        _v2.subVectors(b.home.obj.position, b.pos).setLength(sp);
        b.vel.lerp(_v2, Math.min(1, dt * 4)).setLength(sp);
      }
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
const playerBullets = new Bullets(0x88f4ff, 260, 0.16 * S);
// Our side's shots go through here: in Endless the upgrades change them (speed, damage, piercing, a fan of 3).
const _fs = new THREE.Vector3(), _fa = new THREE.Vector3();
function friendlyShot(pos, vel, life, src) {
  if (!endless) return playerBullets.spawn(pos, vel, life, src);
  const n = MODS.spread ? 3 : 1;
  for (let i = 0; i < n; i++) {
    _fs.copy(vel).multiplyScalar(MODS.bspeed);
    if (i) {
      _fa.crossVectors(_fs, UP); if (_fa.lengthSq() < 1e-8) _fa.set(1, 0, 0);
      _fa.crossVectors(_fa, _fs).normalize();                        // the shot's own "up": fan out sideways
      _fs.applyAxisAngle(_fa, i === 1 ? 0.1 : -0.1);
    }
    const b = playerBullets.spawn(pos, _fs, life, src);
    if (b) { b.dmg = MODS.dmg * (i ? 0.7 : 1); b.pierce = MODS.pierce; }
  }
  return null;
}
// Endless homing missile (an upgrade): a slower, longer, harder-hitting shot that steers to its target.
function fireMissile(from, target) {
  const p = from.obj.position;
  const b = playerBullets.spawn(_v3.copy(p).addScaledVector(from.fwd, 0.2 * S), _v1.copy(from.fwd).multiplyScalar(4.5 * S), 3.0, 'missile');
  if (b) { b.home = target; b.dmg = 3 * MODS.dmg; }
  sfx.whoosh(0.5);
}
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
  world.add(mesh);
  // Expanding wireframe shock-sphere.
  const shock = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.IcosahedronGeometry(1, 1)),
    new THREE.LineBasicMaterial({ color: color.clone().lerp(WHITE, 0.6), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  shock.position.copy(center);
  shock.scale.setScalar(0.02);
  world.add(shock);
  effects.push({ type: 'frags', mesh, frags, arr, life: big ? 2.2 : 1.5, max: big ? 2.2 : 1.5 });
  effects.push({ type: 'shock', mesh: shock, life: 0.4, max: 0.4, size: (big ? 1.2 : 0.55) * S });
  // v18: a spark burst, a flash ring and a bright core.
  burst(center, big ? 70 : 34, color, (big ? 2.6 : 1.9) * S, big ? 0.95 : 0.65, vel);
  flashRing(center, color, (big ? 1.7 : 1.0) * S, big ? 0.45 : 0.32);
  coreFlash(center, color, (big ? 1.1 : 0.65) * S);
}
// The homeworld blowing up (v35): a huge spark burst, rings and a core flash, a deep boom, the room frame lit.
function bigBoom(pos) {
  const red = new THREE.Color(0xff5544), gold = new THREE.Color(0xffd27a);
  burst(pos, 220, red, 6.5 * S, 2.4);
  burst(pos, 120, gold, 4.5 * S, 1.8);
  flashRing(pos, gold, 9 * S, 1.2);
  flashRing(pos, red, 6 * S, 0.9);
  coreFlash(pos, gold, 5 * S);
  sfx.boom(pos, true); sfx.blast(pos);
  pulseFrame(gold, 1);
  haptic('right', 1, 400); haptic('left', 1, 400);
}
function blink(pos, color) {
  const shock = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.IcosahedronGeometry(1, 1)),
    new THREE.LineBasicMaterial({ color: color.clone().lerp(WHITE, 0.5), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  shock.position.copy(pos);
  shock.scale.setScalar(0.02);
  world.add(shock);
  effects.push({ type: 'shock', mesh: shock, life: 0.3, max: 0.3, size: 0.3 * S });
}
// v18 juice. One shared point cloud for every spark and explosion burst (cheap: a single draw call).
const PMAX = 900;
const parts = {
  pos: new Float32Array(PMAX * 3), vel: new Float32Array(PMAX * 3), col: new Float32Array(PMAX * 3),
  base: new Float32Array(PMAX * 3), life: new Float32Array(PMAX), max: new Float32Array(PMAX), next: 0,
};
const partMat = new THREE.PointsMaterial({ size: 0.1, vertexColors: true, map: getDotTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
const partCloud = new THREE.Points(new THREE.BufferGeometry(), partMat);
partCloud.geometry.setAttribute('position', new THREE.BufferAttribute(parts.pos, 3).setUsage(THREE.DynamicDrawUsage));
partCloud.geometry.setAttribute('color', new THREE.BufferAttribute(parts.col, 3).setUsage(THREE.DynamicDrawUsage));
partCloud.frustumCulled = false;
partCloud.userData.ptBase = 0.075; partCloud.userData.mats = [null, partMat];   // re-fitted with the board scale
partMat.size = 0.075 * S * board.scale.x;
world.add(partCloud);
const HOT = new THREE.Color(1, 0.92, 0.75);
// n sparks flying out of pos (speed in game units / s), fading over `life` seconds.
function burst(pos, n, color, speed, life, vel = null) {
  for (let i = 0; i < n; i++) {
    const k = parts.next, j = k * 3;
    parts.next = (k + 1) % PMAX;
    _v1.randomDirection().multiplyScalar(speed * rand(0.25, 1));
    if (vel) _v1.addScaledVector(vel, 0.4);
    parts.pos[j] = pos.x; parts.pos[j + 1] = pos.y; parts.pos[j + 2] = pos.z;
    parts.vel[j] = _v1.x; parts.vel[j + 1] = _v1.y; parts.vel[j + 2] = _v1.z;
    const c = Math.random() < 0.35 ? HOT : color;                    // some white-hot sparks
    parts.base[j] = c.r; parts.base[j + 1] = c.g; parts.base[j + 2] = c.b;
    parts.life[k] = parts.max[k] = life * rand(0.55, 1);
  }
}
function sparks(pos, color, n = 6) { burst(pos, n, color, 1.3 * S, 0.28); }
function updateParticles(dt) {
  const drag = Math.exp(-dt * 2.4);
  for (let k = 0; k < PMAX; k++) {
    if (parts.life[k] <= 0) continue;
    const j = k * 3;
    parts.life[k] -= dt;
    if (parts.life[k] <= 0) { parts.col[j] = parts.col[j + 1] = parts.col[j + 2] = 0; continue; }
    for (let a = 0; a < 3; a++) { parts.vel[j + a] *= drag; parts.pos[j + a] += parts.vel[j + a] * dt; }
    const f = parts.life[k] / parts.max[k], b = f * f;
    parts.col[j] = parts.base[j] * b; parts.col[j + 1] = parts.base[j + 1] * b; parts.col[j + 2] = parts.base[j + 2] * b;
  }
  partCloud.geometry.attributes.position.needsUpdate = true;
  partCloud.geometry.attributes.color.needsUpdate = true;
}
function liveParticles() { let n = 0; for (let k = 0; k < PMAX; k++) if (parts.life[k] > 0) n++; return n; }
// A flat ring that expands and fades (always turned to face you), and a bright core flash.
const RING_GEO = new THREE.BufferGeometry().setFromPoints(Array.from({ length: 40 }, (_, i) => new THREE.Vector3(Math.cos(i / 40 * Math.PI * 2), Math.sin(i / 40 * Math.PI * 2), 0)));
const camQ = new THREE.Quaternion();
function flashRing(pos, color, size, life = 0.3) {
  const m = new THREE.LineLoop(RING_GEO, new THREE.LineBasicMaterial({ color: color.clone().lerp(WHITE, 0.55), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  m.position.copy(pos);
  m.scale.setScalar(0.02);
  world.add(m);
  effects.push({ type: 'ring', mesh: m, life, max: life, size, shared: true });
}
function coreFlash(pos, color, size) {
  const m = new THREE.Sprite(new THREE.SpriteMaterial({ map: getDotTexture(), color: color.clone().lerp(WHITE, 0.7), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  m.position.copy(pos);
  m.scale.setScalar(0.01);
  world.add(m);
  effects.push({ type: 'core', mesh: m, life: 0.16, max: 0.16, size, sprite: true });
}
// Camera-free feedback: the room's frame lights up briefly (kills: cyan; you're hit: red; aces: gold).
let framePulse = 0;
const framePulseCol = new THREE.Color();
function pulseFrame(color, amt) { if (amt >= framePulse) { framePulse = amt; framePulseCol.copy(color); } }
// Hit stop: a tiny freeze-frame on kills (the view keeps tracking your head; only the battle pauses).
let hitStopT = 0, hitStopCd = 0, hitStops = 0;
// Slow motion (v35: the homeworld's break-up): the simulation runs at `k` for `sec` real seconds, easing back.
let slowT = 0, slowK = 1, slowEase = 0.6;
function slowMo(k, sec) { slowK = k; slowT = sec; }
function timeScale() { if (slowT <= 0) return 1; return slowT > slowEase ? slowK : slowK + (1 - slowK) * (1 - slowT / slowEase); }
function hitStop(sec) {
  if (state !== 'playing' && state !== 'tutorial') return;
  if (hitStopCd > 0 && sec < 0.08) return;          // no stutter when kills come in quick succession
  hitStopT = Math.max(hitStopT, sec);
  hitStopCd = 0.3;
  hitStops++;
}
function updateEffects(dt) {
  for (const e of effects) {
    e.life -= dt;
    const k = Math.max(0, e.life / e.max);
    if (e.type === 'ring') {
      e.mesh.quaternion.copy(camQ);
      e.mesh.scale.setScalar(0.02 + (1 - k * k) * e.size);
      e.mesh.material.opacity = k;
    } else if (e.type === 'core') {
      e.mesh.scale.setScalar(e.size * (0.4 + 0.6 * (1 - k)));
      e.mesh.material.opacity = k;
    } else if (e.type === 'frags') {
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
      world.remove(effects[i].mesh);
      if (!effects[i].shared && !effects[i].sprite) effects[i].mesh.geometry.dispose();
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
world.add(player.obj);
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
world.add(trail);
let trailTimer = 0;
function resetTrail() {
  for (let i = 0; i < TRAIL_N; i++) trailArr.set([player.obj.position.x, player.obj.position.y, player.obj.position.z], i * 3);
  trail.geometry.attributes.position.needsUpdate = true;
}

function resetPlayer() {
  // Start near the front-centre of the box, flying away from you.
  player.obj.position.set(0, 0, HB.z * 0.4);
  player.fwd.set(0, 0, -1);
  player.bank = 0; player.yawRate = 0; player.pitchRate = 0; player.speed = CRUISE; player.hp = playerMax; player.invuln = 1.5; player.flash = 0;
  player.alive = true; player.obj.visible = true; trail.visible = settings.mode === 'fighter';
  quatFromDir(player.fwd, player.obj.quaternion);
  player.mq.copy(player.obj.quaternion);
  resetTrail();
}

// ---------------------------------------------------------------- game mode
// 'fighter'  = you fly one ship.
// 'squadron' = you command 4 bot fighters (the right controller sets their heading), in a bigger,
//              zoomed-out battlefield with Ender's Game "stars" (big fixed obstacles) to use as cover.
let gameMode = settings.mode === 'squadron' ? 'squadron' : 'fighter';   // the controls in use (Endless switches between them)

// ---------------------------------------------------------------- "stars": big fixed obstacles (Squadron)
// Ships can't pass through them and bullets are blocked, so both sides use them as cover.
const obstacles = [];
const obstacleGroup = new THREE.Group();
world.add(obstacleGroup);
const obstacleMat = new THREE.LineBasicMaterial({ color: 0x9fb8dd, transparent: true, opacity: 0 });
// v12: stars get new random spots every round. They fade out when a round is cleared (and stop
// counting as obstacles once gone), then fade back in at their new spots when the next round starts.
let starsOn = true, starAlpha = 0, starTarget = 1;
function starsActive() { return endless || (teamMode() && starsOn); }
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
  if (endless) return;                              // Endless fills `obstacles` with the world's stars and rocks
  for (const o of obstacles) { o.r = o.R = o.r0; o.c.copy(o.n).multiply(HB); o.g.position.copy(o.c); }
}
OBST_READY = true;
layoutObstacles();
const BASE_OBSTACLES = obstacles.slice();          // the room's 8 stars (Endless swaps in its own list)
// Where your side starts this round: stars are kept well clear of this spot.
function starAvoidPoints() { return [new THREE.Vector3(0, 0, HB.z * 0.4)]; }
// New random star positions for the current room shape: inside the walls, apart from each other,
// and clear of both sides' start areas (best of many random tries for each star).
function randomizeStars() {
  if (endless) return;                              // (Endless has its own seeded stars)
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
  obstacleGroup.visible = !endless && teamMode() && starAlpha > 0.005;
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
  const c = ARENA_C;
  p.x = clamp(p.x, c.x - AH.x * m, c.x + AH.x * m); p.y = clamp(p.y, c.y - AH.y * m, c.y + AH.y * m); p.z = clamp(p.z, c.z - AH.z * m, c.z + AH.z * m);
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
//   leader - (round 3+, v18) an orange squadron leader that hangs back at mid range behind its ESCORTS;
//   escort - fly in formation round their leader and pounce on anything that comes near it; when the
//            leader dies they scatter, then fight on as flankers
//   screen - (round 4+, v18) holds the line between you and a sniper / leader / cruiser, intercepts
//            anything that comes close
//   ace    - (v18) an occasional named ace in gold: fast, dodges, boom-and-zoom attack runs; badly hurt
//            it escapes through a wall and comes back in a later round
// Numbers grow only slowly from round to round; difficulty comes from more roles and smarter tactics.
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
  { n: 3, key: null, txt: 'leaders with escorts', modes: 'Fs' },
  { n: 4, key: null, txt: 'screens shield their snipers', modes: 'Fs' },
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
  leader: { hp: 4, speed: 1.0, turn: 1.8, fire: 2.0, range: 4.6, acc: 0.12 },
  escort: { hp: 2, speed: 1.25, turn: 2.1, fire: 2.0, range: 3.8, acc: 0.18 },
  screen: { hp: 3, speed: 1.15, turn: 2.0, fire: 2.2, range: 3.6, acc: 0.2 },
  ace: { hp: 6, speed: 1.6, turn: 3.0, fire: 1.2, range: 4.6, acc: 0.07 },
};
const ROLE_POINTS = { heavy: 300, sniper: 150, leader: 250, screen: 120, ace: 0 };
// Aces: an ace that escapes is back (tougher) in the next round.
const aces = { pending: null, downed: 0, forceNext: false };
function makeLabel(text, color) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const g = c.getContext('2d');
  g.font = 'bold 44px monospace'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = '#' + color.getHexString(); g.fillText(text, 128, 34);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, fog: false }));
  s.scale.set(1.0, 0.25, 1);
  return s;
}
function liveTargets() {
  if (teamMode()) return friends;
  return player.alive ? [player] : [];
}
function spawnGroup(role, n, wave, at = null) {
  const g = { role, members: [], t: rand(0, 1.5), focus: null, focusT: 0, ambushPt: null, sprung: false, lureDone: false, leader: null };
  // The group enters together through one face, well away from you. (v35: or at a given point - the
  // Endless homeworld swarm, which must arrive where you can see it.)
  const ref = player.obj.position;
  let best = at ? at.clone() : null, bestD = -1;
  for (let k = 0; k < 8 && !at; k++) {
    const p = new THREE.Vector3(rand(-0.7, 0.7), rand(-0.7, 0.7), rand(-0.7, 0.7)).multiply(AH);
    const ax = ['x', 'y', 'z'][k % 3];
    p[ax] = (Math.random() < 0.5 ? -1 : 1) * AH[ax] * 0.95;
    p.add(ARENA_C);
    if (obstInside(p, 0.4 * S)) continue;
    const d = p.distanceTo(ref) + rand(0, BOX_B * 0.6);
    if (d > bestD) { bestD = d; best = p; }
  }
  if (!best) best = new THREE.Vector3(0, 0, -AH.z * 0.95).add(ARENA_C);
  if (role === 'bait') g.ambushPt = coverPoint(ref, best, new THREE.Vector3()) || best.clone().multiplyScalar(0.8);
  for (let i = 0; i < n; i++) {
    const pos = best.clone().add(_v1.randomDirection().multiplyScalar(0.4 * S * Math.sqrt(Math.max(1, n / 3))));
    clampIn(pos, 0.98);
    obstPushOut(pos, 0.3 * S);
    const r = role === 'bait' && i > 0 ? 'ambush' : role === 'leader' && i > 0 ? 'escort' : role;
    const e = spawnEnemy(r, wave, pos, g);
    e.side = i % 2 ? 1 : -1;
    e.slot = i;
    if (r === 'leader') g.leader = e;
    g.members.push(e);
  }
  groups.push(g);
  return g;
}
function spawnEnemy(role, wave, pos, group) {
  const heavy = role === 'heavy';
  const st = ROLE_STATS[role];
  const color = role === 'leader' ? LEADER_COLOR : role === 'ace' ? ACE_COLOR : ENEMY_COLOR;
  const obj = shrink(heavy ? buildCruiser(color.getHex()) : buildFighter(color.getHex()));
  const big = role === 'leader' ? 1.3 : role === 'ace' ? 1.2 : 1;
  if (big !== 1) { obj.scale.setScalar(S * big); obj.userData.ptBase *= big; obj.userData.mats[1].size *= big; }
  obj.position.copy(pos);
  const e = {
    type: heavy ? 'cruiser' : 'fighter', role, group, obj, color, hp: st.hp, maxHp: st.hp, radius: (heavy ? 0.34 : 0.2) * S * big,
    fwd: _v1.copy(ARENA_C).sub(pos).normalize().clone(), bank: 0,
    turn: st.turn + wave * 0.06, speed: st.speed * S * (1 + wave * 0.05),
    fireInterval: Math.max(st.fire * 0.45, st.fire - wave * 0.12), range: st.range * S,
    acc: st.acc * S * Math.max(0.25, 1 - (wave - 1) * 0.08),
    dodger: Math.random() < 0.6,
    fireCd: rand(1.5, 3.0), flash: 0, points: ROLE_POINTS[role] ?? 100, spawnFade: 0,
    retreatT: 0, retreatCd: 0, outnumT: rand(0, 0.5), breakT: 0, side: 1, target: null, mode: 'move',
    goal: randomArenaPoint(0.6),
  };
  quatFromDir(e.fwd, obj.quaternion);
  tintShip(obj, _c.setRGB(0, 0, 0)); // fades in
  world.add(obj);
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
    const v = (b.hp || 1) / (b === player ? playerMax : botMax);
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
      if (g.role === 'hunter' || g.role === 'ace') g.focus = weakest;
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
    if (e.hp <= 0) continue;                         // killed outside this loop; removed below
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
    if (e.scatterT > 0) e.scatterT -= dt;
    // Aces: badly hurt, run for the nearest wall and escape (only while it isn't the last one left).
    if (e.role === 'ace' && !e.escaping && e.hp <= 2 && state === 'playing' && enemies.length > 1) {
      e.escaping = true;
      e.escAx = ['x', 'y', 'z'].reduce((a, k) => (Math.abs(p[k]) / HB[k] > Math.abs(p[a]) / HB[a] ? k : a), 'x');
      e.escSign = p[e.escAx] >= 0 ? 1 : -1;
      showMessage('ACE IS RUNNING', 'Finish it before it escapes!', 1.8);
    }
    if (e.escaping) { goal.copy(p); goal[e.escAx] = e.escSign * HB[e.escAx] * 1.3; }
    else if (e.scatterT > 0) { /* scatter: keep going to the scatter point */ }
    else if (!T) {
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
            goal.copy(Tp).addScaledVector(Tf, -1.9 * S).addScaledVector(_es, e.side * 2.0 * S);     // v18: wider
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
        case 'leader': {
          // Hang back at mid range (escorts in front), drifting round the target; shoot when lined up.
          _ed.subVectors(p, Tp);
          if (_ed.lengthSq() < 1e-6) _ed.set(0, 0, 1);
          _ed.normalize();
          sideOf(_ed, _es);
          goal.copy(Tp).addScaledVector(_ed, 3.4 * S).addScaledVector(_es, Math.sin(g.t * 0.35) * 1.3 * S);
          clampIn(goal);
          if (dist < 2.0 * S || p.distanceTo(goal) < 0.7 * S) mode = 'aim';
          break;
        }
        case 'escort': {
          // Formation round the leader; pounce on anything that comes near it.
          const L = g.leader;
          if (!L || L.hp <= 0) { mode = 'attack'; break; }
          if (Tp.distanceTo(L.obj.position) < 2.6 * S || dist < 1.3 * S) mode = 'attack';
          else {
            sideOf(L.fwd, _es);
            goal.copy(L.obj.position).addScaledVector(L.fwd, 0.6 * S).addScaledVector(_es, e.side * 0.7 * S)
              .addScaledVector(UP, (e.slot > 2 ? 0.45 : 0) * S);
            clampIn(goal, 0.95);
          }
          break;
        }
        case 'screen': {
          // Hold the line between the target and a ward (sniper, leader or cruiser); intercept up close.
          if ((e.wardT = (e.wardT || 0) - dt) <= 0 || !e.ward || e.ward.hp <= 0) {
            e.wardT = 2;
            e.ward = nearestTo(p, enemies.filter((o) => o.hp > 0 && (o.role === 'sniper' || o.role === 'leader' || o.role === 'heavy')));
          }
          if (dist < 2.0 * S || (e.ward && Tp.distanceTo(e.ward.obj.position) < 2.4 * S)) mode = 'attack';
          else if (e.ward) {
            const W = e.ward.obj.position;
            _ed.subVectors(Tp, W);
            const dw = _ed.length();
            _ed.normalize();
            sideOf(_ed, _es);
            goal.copy(W).addScaledVector(_ed, Math.min(1.6 * S, dw * 0.45)).addScaledVector(_es, e.side * 0.4 * S);
            clampIn(goal);
            if (p.distanceTo(goal) < 0.5 * S) mode = 'aim';
          } else {
            sideOf(Tf, _es);
            goal.copy(Tp).addScaledVector(Tf, 1.5 * S).addScaledVector(_es, e.side * 1.2 * S);   // nothing to guard: cut you off
            clampIn(goal);
            if (dist < 2.4 * S) mode = 'attack';
          }
          break;
        }
        case 'ace': {
          // Boom-and-zoom: an attack run until close (or 2.6 s), then extend away fast, then again.
          if (e.escaping) break;
          e.aceT -= dt;
          if (e.acePhase === 'run') {
            mode = 'attack';
            if (dist < 1.1 * S || e.aceT <= 0) {
              // Break off before it gets close (an ace never rams): away from the target and to one side.
              e.acePhase = 'extend'; e.aceT = 1.5;
              sideOf(e.fwd, _es);
              _ed.subVectors(p, Tp).normalize();
              goal.copy(p).addScaledVector(_ed, 1.8 * S).addScaledVector(_es, e.side * 1.8 * S);
              clampIn(goal);
            }
          } else if (e.aceT <= 0) { e.acePhase = 'run'; e.aceT = 2.6; }
          break;
        }
        case 'ambush': {
          if (g.sprung) mode = 'attack';
          else { goal.copy(g.ambushPt); if (p.distanceTo(goal) < 0.6 * S) mode = 'aim'; }
          break;
        }
      }
    }
    const bulletSpeed = (e.role === 'sniper' ? 4.4 + wave * 0.08 : 3.0 + wave * 0.12) * S;
    const desired = _v2;
    if (e.escaping || e.scatterT > 0) mode = 'move';
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
      if (d < 0.75 * S && d > 1e-4) desired.addScaledVector(_v1.subVectors(p, o.obj.position).normalize(), (0.75 * S - d) * 4);   // v18: spread out a bit more
    }
    // Round 5+: dodge your shots (side-step bullets that would hit).
    if (((AI.dodge && e.dodger) || e.role === 'ace') && e.spawnFade >= 1) {
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
    const spd = e.speed * (mode === 'aim' ? 0.35 : 1) * (e.retreatT > 0 || e.scatterT > 0 || e.escaping || e.acePhase === 'extend' ? 1.25 : 1);
    p.addScaledVector(e.fwd, spd * dt);
    if (e.escaping && Math.abs(p[e.escAx]) > HB[e.escAx] * 0.96) { aceEscaped(e); continue; }
    wrapBox(p);
    obstPushOut(p, e.radius);
    e.mode = mode;

    // Fade in on spawn, flash white when hit.
    e.spawnFade = Math.min(1, e.spawnFade + dt * 1.5);
    if (e.flash > 0) { e.flash -= dt; tintShip(e.obj, WHITE); }
    else tintShip(e.obj, _c.copy(e.color).multiplyScalar(e.spawnFade));

    // Fire (with lead) when the target is in range, roughly ahead, and not behind a star.
    e.fireCd -= dt;
    if (T && combat() && e.fireCd <= 0 && e.spawnFade >= 1 && e.retreatT <= 0 && !e.escaping && !(e.scatterT > 0)) {
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
    // (An ace only takes one ram hit per contact, so a single brush can't grind it down frame by frame.)
    e.ramCd = (e.ramCd || 0) - dt;
    for (const t of tg) {
      if (t.alive && p.distanceTo(t.obj.position) < e.radius + (t.radius || 0.1 * S)) {
        if (e.role === 'ace') { if (e.ramCd > 0) continue; e.ramCd = 0.8; }
        damageTarget(t); damageEnemy(e, 2);
      }
    }
  }
  for (let i = enemies.length - 1; i >= 0; i--) {
    if (enemies[i].hp <= 0) { world.remove(enemies[i].obj); enemies.splice(i, 1); }
  }
}
function damageEnemy(e, amount) {
  if (e.hp <= 0) return;
  e.hp -= amount;
  e.flash = 0.1;
  if (e.hp <= 0) {
    const big = e.type === 'cruiser' || e.role === 'leader' || e.role === 'ace';
    explode(e.obj, e.color, _v1.copy(e.fwd).multiplyScalar(e.speed), big);
    sfx.boom(e.obj.position, big);
    if (state === 'playing') { score += e.points * wave; kills++; killHeat++; if (endless) E.onKill(e); }
    if (state !== 'lobby') {
      // Kill juice: a rumble pulse, a tiny freeze-frame and the room's frame lights up.
      haptic('right', 0.7, 70);
      hitStop(gameMode === 'fighter' ? 0.055 : 0.04);
      pulseFrame(PLAYER_COLOR, 0.55);
    }
    if (e.role === 'leader') leaderDown(e);
    if (e.role === 'ace') aceDown(e);
  } else {
    // Damaged: pull back for a moment before coming in again.
    if (e.retreatCd <= 0) { e.retreatT = 2.0; e.retreatCd = 4; }
    if (state !== 'lobby') sfx.ping(e.obj.position);
    if (gameMode === 'fighter' && state !== 'lobby') haptic('right', 0.3, 25);
  }
}
function damageTarget(t, bullet) { if (t === player) damagePlayer(bullet); else damageBot(t, bullet); }
// The leader is down: its escorts scatter for a moment, then fight on as flankers.
function leaderDown(L) {
  for (const e of L.group.members) {
    if (e === L || e.hp <= 0) continue;
    e.role = 'flank';
    e.scatterT = 2.2;
    e.goal.copy(e.obj.position).add(_v1.randomDirection().multiplyScalar(2.6 * S));
    clampIn(e.goal);
  }
  L.group.leader = null;
  L.group.role = 'flank';
  if (state === 'playing') showMessage('LEADER DOWN', 'Its escorts scatter', 1.6);
}
function spawnAce(n) {
  let back = 0;
  if (aces.pending) { back = aces.pending.back; aces.pending = null; }
  const g = spawnGroup('ace', 1, n);
  const e = g.members[0];
  e.back = back;
  e.hp = e.maxHp = ROLE_STATS.ace.hp + back;            // tougher every time it comes back
  e.acePhase = 'run'; e.aceT = 2.6;
  const lab = makeLabel('ACE', ACE_COLOR);
  lab.position.set(0, 0.32, 0);
  e.obj.add(lab);
  sfx.aceIn();
  log(`ace back=${back}`);
  return e;
}
function aceEscaped(e) {
  e.hp = 0; e.escaped = true;                          // removed without an explosion or points
  aces.pending = { back: e.back + 1 };
  blink(e.obj.position, ACE_COLOR);
  showMessage('ACE ESCAPED', 'It will be back next round', 2.2);
  log('ace escaped');
}
function aceDown(e) {
  if (state === 'lobby') return;
  const bonus = 1500 * Math.max(1, wave) * (1 + e.back);
  if (state === 'playing') score += bonus;
  aces.downed++;
  sfx.aceDown();
  hitStop(0.11);
  haptic('right', 1.0, 200); haptic('left', 1.0, 200);
  pulseFrame(ACE_COLOR, 1);
  burst(e.obj.position, 60, ACE_COLOR, 3.2 * S, 1.2);
  showMessage('ACE DOWN!', `+${fmtNum(bonus)} ace bonus`, 2.8);
  log(`ace down bonus=${bonus}`);
}

// ---------------------------------------------------------------- friendly squadron (Squadron mode)
// A squad = 4 bot fighters that fly around an invisible ANCHOR (the squad's command point). The
// anchor's heading is the order; the bots fly their own ships: formation, engage, dodge, separation.
// The anchor is the (invisible) player ship.
// v18: the squadron can SPLIT into two pairs: group A (cyan) follows the right controller through the
// player command point, group B (gold) the left controller through a second command point (cmdB).
// FORMATIONS change how the bots fly and fight:
//   line  - side by side; when engaging, pairs pick targets ahead of you (two bots per target)
//   wedge - an arrowhead; all bots on the one best target, longer leash, faster
//   ring  - a tight ring round the command point; short leash, each bot takes the threat nearest the centre
const BOT_N = 4, BOT_HP = 3, BOT_SPACING = 0.6 * S, LEASH = 2.2 * S, BOT_RANGE = 4.5 * S;
const FORMATIONS = ['line', 'wedge', 'ring'];
const FORM = { line: { leash: 1, spd: 1.25 }, wedge: { leash: 1.25, spd: 1.4 }, ring: { leash: 0.65, spd: 1.15 } };
const FORM_INFO = { line: 'Pairs take the targets ahead', wedge: 'All on one target, hard and fast', ring: 'Tight ring, guards the centre' };
let formation = 'line', formChanges = 0, split = false;
function teamMode() { return gameMode === 'squadron'; }
function makeSquad(name, color) {
  const sq = {
    name, kind: 'squad', color: new THREE.Color(color), bots: [], anchor: new THREE.Vector3(), fwd: new THREE.Vector3(0, 0, -1),
    q: new THREE.Quaternion(), right: new THREE.Vector3(1, 0, 0), speed: CRUISE, engaged: false, tgtT: 0,
  };
  for (let i = 0; i < BOT_N; i++) makeBot(sq);
  return sq;
}
function makeBot(sq) {
  const i = sq.bots.length;
  const obj = shrink(buildPlayerShip(sq.color.getHex()));
  obj.visible = false;
  world.add(obj);
  const b = { i, unit: sq, grp: sq, obj, fwd: new THREE.Vector3(0, 0, -1), bank: 0, turn: 3.4, speed: CRUISE, hp: BOT_HP, alive: false, flash: 0, invuln: 0, fireCd: rand(0, 0.3), target: null, aim: null, side: i % 2 ? 1 : -1, radius: 0 };
  sq.bots.push(b);
  return b;
}
// Endless: a fleet can grow past 4 (each extra ship is made once and then reused).
function newBot() { const b = makeBot(SQUAD); b.grp = split ? GA : SQUAD; if (split) GA.bots.push(b); return b; }
const SQUAD = makeSquad('SQUAD', 0x33ddff);          // Squadron mode
const bots = SQUAD.bots;
function makeGroup(name, color) {
  return { name, kind: 'squad', color: new THREE.Color(color), bots: [], anchor: new THREE.Vector3(), fwd: new THREE.Vector3(0, 0, -1), right: new THREE.Vector3(1, 0, 0), speed: CRUISE, engaged: false, tgtT: 0 };
}
const GA = makeGroup('A', 0x33ddff), GB = makeGroup('B', 0xffbb44);
// Group B's command point (steered by the left controller while split), with a gold aim line.
const cmdB = { obj: new THREE.Group(), fwd: new THREE.Vector3(0, 0, -1), mq: new THREE.Quaternion(), speed: CRUISE, bank: 0, turn: 2.8 };
cmdB.obj.scale.setScalar(S);
cmdB.obj.visible = false;
world.add(cmdB.obj);

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
function syncSquadToPlayer(sq = SQUAD) {
  sq.anchor.copy(player.obj.position);
  sq.fwd.copy(player.fwd);
  cmdRight(sq.right);
  sq.speed = player.speed;
}
function syncGroupB() {
  GB.anchor.copy(cmdB.obj.position);
  GB.fwd.copy(cmdB.fwd);
  if (activeSteer() === 'mirror') GB.right.set(1, 0, 0).applyQuaternion(cmdB.mq);
  else GB.right.set(1, 0, 0).applyQuaternion(quatFromDir(cmdB.fwd, _bQ));
  GB.speed = cmdB.speed;
}
// Split the squadron into two pairs (the two ships on the right go with your right hand), or rejoin.
function setSplit(on, quiet = false) {
  if (on === split) return;
  if (on) {
    const alive = bots.filter((b) => b.alive);
    if (gameMode !== 'squadron' || alive.length < 2) { if (!quiet) showMessage('CAN\'T SPLIT', 'You need at least 2 ships', 1.4); return; }
    syncSquadToPlayer();
    // v32: by each ship's side of the heading. (SQUAD.right is the ship's local +X, which points to the LEFT
    // of the way it flies - v31 and before handed the blue pair the LEFT ships, so the pairs crossed over.)
    const side = (b) => -_bS.subVectors(b.obj.position, SQUAD.anchor).dot(SQUAD.right);   // + = right of the heading
    alive.sort((a, b) => side(b) - side(a));
    const h = Math.ceil(alive.length / 2);                // an odd one goes to the blue (right) side
    GA.bots = alive.slice(0, h); GB.bots = alive.slice(h);
    for (const b of GA.bots) b.grp = GA;
    for (const b of GB.bots) b.grp = GB;
    // Each pair's command point starts at the pair, with the current heading.
    centroid(GB.bots, cmdB.obj.position);
    centroid(GA.bots, player.obj.position);
    cmdB.fwd.copy(player.fwd);
    if (activeSteer() === 'mirror') cmdB.mq.copy(player.mq); else quatFromDir(cmdB.fwd, cmdB.mq);
    cmdB.obj.quaternion.copy(cmdB.mq);
    cmdB.speed = player.speed;
    mirrorQB.copy(cmdB.mq);
    cmdB.obj.visible = true;
    GA.tgtT = GB.tgtT = 0;
    split = true;
    if (endless) E.rebaseView();
    sfx.split();
    haptic('left', 0.5, 50); haptic('right', 0.5, 50);
    const w = alive.length > 4 ? 'group' : 'pair';
    if (!quiet) showMessage('SQUADRON SPLIT', `Right hand: cyan ${w} - left hand: gold ${w}`, 2.2);
  } else {
    for (const b of bots) b.grp = SQUAD;
    split = false;
    if (endless) E.rebaseView();
    cmdB.obj.visible = false;
    SQUAD.tgtT = 0;
    if (!quiet) { sfx.join(); haptic('left', 0.4, 40); showMessage('SQUADRON REJOINED', 'One formation again', 1.6); }
  }
  log('split ' + split);
}
function cycleFormation() {
  formation = FORMATIONS[(FORMATIONS.indexOf(formation) + 1) % FORMATIONS.length];
  formChanges++;
  SQUAD.tgtT = GA.tgtT = GB.tgtT = 0;
  sfx.formation();
  haptic('right', 0.3, 30);
  showMessage('FORMATION: ' + formation.toUpperCase(), FORM_INFO[formation], 1.8);
  log('formation ' + formation);
}
// Formation slot k of m around the group's command point.
const _bU = new THREE.Vector3();
// v32: any number of ships - a line is rows of up to 6 (more rows behind), a wedge is chevrons of up to 7
// (one behind the other), and a ring grows so the ships keep their spacing. Up to 6 / 7 ships: as before.
const LINE_ROW = 6, WEDGE_ROW = 7;
function slotPos(sq, k, m, out) {
  out.copy(sq.anchor);
  if (formation === 'wedge') {
    const row = Math.floor(k / WEDGE_ROW), mm = Math.min(WEDGE_ROW, m - row * WEDGE_ROW), c = (k % WEDGE_ROW) - (mm - 1) / 2;
    out.addScaledVector(sq.right, c * BOT_SPACING * 0.9).addScaledVector(sq.fwd, -(Math.abs(c) * 0.9 + row * 1.7) * BOT_SPACING);
  } else if (formation === 'ring' && m > 1) {
    const a = (k / m) * Math.PI * 2, r = Math.max(BOT_SPACING * (m > 2 ? 0.95 : 0.6), (m * BOT_SPACING * 0.8) / (Math.PI * 2));
    _bU.crossVectors(sq.right, sq.fwd).normalize();
    out.addScaledVector(sq.right, Math.cos(a) * r).addScaledVector(_bU, Math.sin(a) * r);
  } else {
    const row = Math.floor(k / LINE_ROW), mm = Math.min(LINE_ROW, m - row * LINE_ROW), c = (k % LINE_ROW) - (mm - 1) / 2;
    out.addScaledVector(sq.right, c * BOT_SPACING).addScaledVector(sq.fwd, -row * BOT_SPACING * 1.1);
  }
  return out;
}
// v18 smart targets: enemies near the group, ranked by distance but favouring the ones ahead of the
// command heading (a cone) and damaged ones (finish them off). Ring: the nearest to the centre first.
function rankTargets(sq, foes, leash) {
  const list = [];
  for (const e of foes) {
    if (e.spawnFade < 0.5) continue;
    const da = e.obj.position.distanceTo(sq.anchor);
    if (da > leash + BOT_RANGE) continue;
    let w = 1;
    if (formation !== 'ring') {
      const ang = sq.fwd.angleTo(_bS.subVectors(e.obj.position, sq.anchor));
      w = ang < 0.6 ? 0.55 : 0.55 + (ang - 0.6) * 0.45;
    }
    if (e.hp < e.maxHp) w *= e.hp <= 1 ? 0.6 : 0.8;
    if (sq.bots.some((b) => b.aim === e)) w *= 0.8;     // stick with the current target
    list.push({ e, s: da * w });
  }
  list.sort((a, b) => a.s - b.s);
  return list.map((x) => x.e);
}
// A badly damaged bot (1 hull) pulls back into the formation while a healthier wingman can fight.
function hurtBack(b, alive) { return b.hp <= 1 && state !== 'tutorial' && alive.some((o) => o.hp > 1); }
function assignTargets(sq, alive, foes, leash, dt) {
  sq.tgtT -= dt;
  const valid = (e) => e && e.hp > 0 && e.obj.position.distanceTo(sq.anchor) < leash + BOT_RANGE;
  if (sq.tgtT > 0 && !alive.some((b) => b.aim && !valid(b.aim))) return;
  sq.tgtT = 0.5;
  const ranked = rankTargets(sq, foes, leash), n = ranked.length;
  let j = 0;
  for (const b of alive) {
    if (!n || hurtBack(b, alive)) { b.aim = null; continue; }
    if (formation === 'wedge') b.aim = ranked[0];                         // everyone on one target
    else if (formation === 'ring') b.aim = ranked[j % n];                 // spread over the threats
    else b.aim = ranked[Math.min(Math.floor(j / 2), n - 1)];             // two bots per target
    j++;
  }
}
function resetSquad(sq, on) {
  sq.bots.forEach((b, k) => {
    b.alive = on && k < BOT_N;                         // (extra Endless ships stay parked)
    b.hp = botMax; b.flash = 0; b.invuln = 0; b.speed = CRUISE; b.bank = 0;
    b.obj.visible = b.alive;
    placeBot(sq, b, k, BOT_N);
  });
}
function resetBots() {
  setSplit(false, true);
  syncSquadToPlayer();
  resetSquad(SQUAD, gameMode === 'squadron');
  for (const b of bots) b.aim = null;
}
let squadEngaged = false;
function updateSquad(sq, dt) {
  const engaged = sq.engaged;
  const anchor = sq.anchor, cmd = sq.fwd;
  const alive = sq.bots.filter((b) => b.alive);
  const m = alive.length;
  const foes = foesList();
  const fm = FORM[formation], leash = LEASH * fm.leash;
  if (engaged) assignTargets(sq, alive, foes, leash, dt);
  alive.forEach((b, k) => {
    const p = b.obj.position;
    const desired = _bD.set(0, 0, 0);
    let spdT, homing = false;
    const hurt = engaged && hurtBack(b, alive);
    b.target = null;
    if (engaged && !hurt) {
      // ENGAGE: the target picked for this bot (see assignTargets)...
      const best = b.aim && b.aim.hp > 0 ? b.aim : null;
      const bd = best ? best.obj.position.distanceTo(p) : Infinity;
      b.target = best;
      if (best) {
        leadPoint(p, best, 7 * S, _bT);
        desired.subVectors(_bT, p).normalize();
        // Don't fly straight down its guns: while it points at us (and can reach us), come in at an angle.
        if (bd > 1.3 * S && bd < best.range * 1.1 && best.fwd.dot(_bS.subVectors(p, best.obj.position).normalize()) > 0.8) {
          sideOf(desired, _bS);
          desired.addScaledVector(_bS, b.side * 0.7).normalize();
        }
        if (bd < 0.7 * S) { sideOf(b.fwd, _bS); desired.addScaledVector(_bS, b.side * 1.5); }   // don't ram it
      } else desired.copy(cmd);
      // ...but stays on a leash around the group centre.
      wrapDelta(p, anchor, _bS);
      const off = _bS.length();
      spdT = CRUISE * fm.spd;
      if (off > leash * 0.7) { desired.copy(_bS).normalize(); spdT = CRUISE * 0.9; homing = true; }   // at the leash: tight turn straight back
      else if (off > leash * 0.4) desired.addScaledVector(_bS, (((off - leash * 0.4) / leash) * 4) / off);
    } else {
      // FORMATION: hold the slot across the commanded heading, catching up / easing off to keep it.
      // A hurt bot tucks in behind the formation (it still shoots at anything right in front of it).
      slotPos(sq, k, m, _bT);
      if (hurt) _bT.addScaledVector(cmd, -0.6 * S);
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
    b.turn = engaged && !hurt ? 4.6 : 3.4;         // dogfighting = tighter turns
    steer(b, desired.clone(), dt);
    spdT *= MODS.speed;
    b.speed += (spdT - b.speed) * Math.min(1, dt * (b.speed > spdT ? 4 : 2.5));
    p.addScaledVector(b.fwd, b.speed * dt);
    wrapBox(p);
    obstPushOut(p, 0.12 * S);
    // A hurt bot only takes shots of opportunity (an enemy right in front of it).
    if (hurt) {
      let bo = null, ba = 0.35;
      for (const e of foes) {
        const to = _bS.subVectors(e.obj.position, p);
        const a = b.fwd.angleTo(to);
        if (a < ba && to.length() < BOT_RANGE * 0.8) { ba = a; bo = e; }
      }
      b.target = bo;
    }
    // Shoot only with a clear line: never through a friendly ship or a star.
    b.fireCd -= dt;
    if (engaged && b.target && b.fireCd <= 0 && combat()) {
      leadPoint(p, b.target, 7 * S, _bT);
      _bS.subVectors(_bT, p);
      if (_bS.length() < BOT_RANGE && b.fwd.angleTo(_bS) < 0.22 && !friendsInLine(b, _bT) && !obstBlocks(p, b.target.obj.position)) {
        friendlyShot(_v3.copy(p).addScaledVector(b.fwd, 0.2 * S), _v1.copy(_bS).normalize().multiplyScalar(7 * S), 1.2, 'bot');
        sfx.laser(p, 0.55);
        b.fireCd = 0.3 * fireMul;
      } else b.fireCd = 0.05;
    }
    b.invuln = Math.max(0, b.invuln - dt);
    b.flash = Math.max(0, b.flash - dt);
    if (b.flash > 0) tintShip(b.obj, WHITE);
    else tintShip(b.obj, _c.copy(sq.color).multiplyScalar(b.invuln > 0 && Math.floor(b.invuln * 12) % 2 ? 0.35 : 1));
  });
}
// Hard minimum gap between friendly ships (both pairs), in case steering alone wasn't enough.
function separateFriends() {
  for (const b of friends) {
    for (const o of friends) {
      if (o === b || o.i < b.i) continue;
      const a = b.obj.position, c = o.obj.position;
      wrapDelta(c, a, _bS);
      const d = _bS.length(), min = 0.22 * S + (o.radius || 0);
      if (d >= min || d < 1e-5) continue;
      _bS.multiplyScalar((min - d) / (2 * d)); a.add(_bS); c.sub(_bS);
    }
  }
}
// Squadron mode: one squad commanded through the player ship, or (split) two pairs.
let prevEngaged = false;
function updateBots(dt) {
  if (split) {
    const aA = GA.bots.some((b) => b.alive), aB = GB.bots.some((b) => b.alive);
    if (!aA || !aB) {
      if (!aA) player.obj.position.copy(cmdB.obj.position);   // the survivors keep their spot
      setSplit(false, true);
      showMessage('PAIR LOST', 'The squadron flies as one again', 1.6);
    }
  }
  if (!split) {
    syncSquadToPlayer();
    SQUAD.engaged = squadEngaged = input.fire && combat();
    updateSquad(SQUAD, dt);
  } else {
    syncSquadToPlayer(GA);
    syncGroupB();
    GA.engaged = input.fire && combat();
    GB.engaged = inputB.fire && combat();
    updateSquad(GA, dt);
    updateSquad(GB, dt);
    squadEngaged = GA.engaged || GB.engaged;
  }
  separateFriends();
  if (prevEngaged && !squadEngaged && state === 'playing') sfx.regroup();
  prevEngaged = squadEngaged;
}
// Endless shields (an upgrade): a ship's shield blocks one hit, then recharges.
const SHIELD_T = 15;
function shieldBlock(ship) {
  if (!endless || state !== 'playing' || !MODS.shield || ship.shieldT > 0) return false;
  ship.shieldT = SHIELD_T / MODS.shield;
  ship.invuln = 0.4;
  sparks(ship.obj.position, PLAYER_COLOR, 12);
  sfx.ping(ship.obj.position);
  return true;
}
// A hit costs 1 hull - more late in an Endless run (the THREAT, v33). Fighter / Squadron: always 1.
function hitDmg() { return endless && state === 'playing' ? E.hitDmg() : 1; }
function damageBot(b, bullet) {
  if (landing.on && state === 'playing') return;      // Endless: landed ships can't be hurt
  if (!b.alive || b.invuln > 0 || !combat()) return;
  if (shieldBlock(b)) return;
  const sq = b.unit;
  if (state !== 'lobby') {
    sparks(b.obj.position, b.grp.color, 8);
    pulseFrame(ENEMY_COLOR, 0.35);
    if (bullet && bullet.vel.dot(b.fwd) > 0.3 * bullet.vel.length()) edgeFlash(0.35);   // hit from behind
  }
  if (state === 'tutorial') { b.hp = Math.max(1, b.hp - 1); b.invuln = 0.6; b.flash = 0.2; return; }   // nobody dies in training
  b.hp = Math.max(0, b.hp - hitDmg());
  b.invuln = 0.6;
  b.flash = 0.2;
  if (state === 'lobby') {
    if (b.hp <= 0) { b.alive = false; b.obj.visible = false; explode(b.obj, b.grp.color, _v1.copy(b.fwd).multiplyScalar(b.speed), true); }
    return;
  }
  sfx.ping(b.obj.position);
  haptic('left', 0.4, 40);
  if (b.hp > 0) return;
  if (endless && E.tryRebuild(b)) {                   // Endless: REBUILD upgrade - the ship comes straight back
    explode(b.obj, b.grp.color, _v1.copy(b.fwd).multiplyScalar(b.speed), true);
    sfx.boom(b.obj.position, true);
    b.hp = botMax; b.invuln = 2; b.flash = 0.3;
    return;
  }
  b.alive = false;
  b.obj.visible = false;
  explode(b.obj, b.grp.color, _v1.copy(b.fwd).multiplyScalar(b.speed), true);
  sfx.boom(b.obj.position, true);
  haptic('right', 1.0, 160);
  screenFlash = 0.25;
  const left = sq.bots.filter((x) => x.alive).length;
  // Endless (v35): down to one ship - it becomes your fighter again (Fighter controls, as at the start).
  if (left === 1 && endless && state === 'playing' && gameMode === 'squadron') { squadToFighter(sq.bots.find((x) => x.alive)); return; }
  if (left > 0) { showMessage('WINGMAN DOWN', `${left} ship${left > 1 ? 's' : ''} left`, 1.6); return; }
  gameOver('SQUADRON LOST');
}
// Endless (v34): the enemy homeworld is destroyed - you win. A longer end screen, then back to the lobby.
function winGame() {
  if (state !== 'playing' || !endless) return;
  warpOff('win');
  state = 'gameover';
  stateTimer = -8;                                   // (12.5 s on screen, v35; was 9)
  won = true;
  saveBest();
  E.record();
  stats.modes.endless.wins = (stats.modes.endless.wins || 0) + 1;
  saveStats();
  sfx.chime(true);
  pulseFrame(new THREE.Color(0xffcc66), 1);
  haptic('right', 0.8, 200); haptic('left', 0.8, 200);
  showMessage('VICTORY', '', 9999, true);             // (v35: the ring shows the run's stats round it)
  log(`victory score=${score} kills=${kills}`);
}
let won = false;
function gameOver(title) {
  player.alive = false;
  player.obj.visible = false;
  sfx.chime(false);
  state = 'gameover';
  stateTimer = 0;
  saveBest();
  if (endless) E.record(); else recordGame(gameMode, wave, score, kills);
  showMessage(title, endLine(), 9999, true);
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
function damagePlayer(bullet) {
  if (landing.on && state === 'playing') return;      // Endless: landed ships can't be hurt
  if (!player.alive || player.invuln > 0 || !combat()) return;
  if (state === 'lobby') {                           // the Fighter backdrop's autopilot ship: hit, never destroyed
    player.invuln = 0.6; player.flash = 0.25;
    sparks(player.obj.position, PLAYER_COLOR, 6);
    return;
  }
  sparks(player.obj.position, PLAYER_COLOR, 10);
  pulseFrame(ENEMY_COLOR, 0.6);
  if (bullet && bullet.vel.dot(player.fwd) > 0.3 * bullet.vel.length()) edgeFlash(0.7);   // hit from behind
  if (state === 'tutorial') { player.invuln = 1.0; player.flash = 0.25; sfx.hit(); haptic('right', 0.6, 80); return; }   // can't die in training
  if (shieldBlock(player)) return;
  player.hp = Math.max(0, player.hp - hitDmg());
  player.invuln = 1.0;
  player.flash = 0.25;
  sfx.hit();
  haptic('right', 1.0, 160);
  haptic('left', 0.7, 120);
  screenFlash = 0.25;
  if (player.hp <= 0 && endless && E.tryRebuild(player)) {
    explode(player.obj, PLAYER_COLOR, _v1.copy(player.fwd).multiplyScalar(player.speed), true);
    sfx.boom(player.obj.position, true);
    player.hp = playerMax; player.invuln = 2.5;
    return;
  }
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
let killHeat = 0;                                  // recent kills (decays): drives the music intensity
let best = 0;
try { best = Number(localStorage.getItem('battleRoomBest')) || 0; } catch (e) { /* ignore */ }
// The goal is the highest round: the best round reached is kept per mode (in stats.js).
const bestRound = { get fighter() { return stats.modes.fighter.best; }, get squadron() { return stats.modes.squadron.best; } };
function saveBest() {
  best = Math.max(best, score);
  if (endless) E.saveBest(); else stats.modes[gameMode].best = Math.max(stats.modes[gameMode].best, wave);
  try { localStorage.setItem('battleRoomBest', String(best)); } catch (e) { /* ignore */ }
  saveStats();
}
function endLine() { return endless ? E.endLine() : `Reached round ${wave}  (best ${bestRound[gameMode] || 0})\n${restartHint()}`; }

function startWave(n) {
  wave = n;
  const unlocked = setAI(n);
  for (const [role, count] of roster(n, gameMode === 'squadron')) spawnGroup(role, count, n);
  // An occasional ace (from round 3); one that escaped earlier always comes back.
  let ace = null;
  if (state === 'playing' && (aces.pending || aces.forceNext || (n >= 3 && Math.random() < 0.3))) { aces.forceNext = false; ace = spawnAce(n); }
  let what = `${enemies.length} hostiles inbound`;
  if (ace) what += ace.back ? '\nTHE ACE IS BACK' : '\nACE INBOUND';
  showMessage(`ROUND ${n}`, unlocked.length ? `${what}\nNEW: ${unlocked.join(', ')}` : what, unlocked.length ? 3.6 : 2.4);
  sfx.chime(true);
  log(`wave ${n} started with ${enemies.length} enemies; AI lead=${AI.lead.toFixed(2)} ${Object.keys(AI).filter((k) => AI[k] === true).join(',')}`);
}
// v18: which groups a round brings. Variety grows fast, numbers only slowly.
function roster(n, sq) {
  const r = [['pincer', 2], ['flank', sq ? 2 : 1]];
  if (n >= 2) r.push(['sniper', sq && n >= 4 ? 2 : 1]);
  if (sq && n >= 2) r.push(['bait', 3]);                      // 1 bait + 2 hidden ambushers
  if (n >= 3) r.push(['leader', n >= 6 ? 4 : 3]);             // a leader + its escorts
  if (n >= 4) r.push(['screen', n >= 8 ? 2 : 1]);
  if (n >= 5) r.push(['heavy', n >= 9 ? 2 : 1]);
  if (n >= 6) r.push(['hunter', 2]);
  for (let i = 0; i < Math.min(3, Math.floor((n - 6) / 3)); i++) r.push([i % 2 ? 'pincer' : 'flank', 2]);
  return r;
}
// v12: every round is a fresh battle. Your side comes back at full strength in its start positions,
// the enemy spawns fresh, and the stars get new random spots for the (reshaped) room.
function startRound(n) {
  for (const e of enemies) world.remove(e.obj);
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
  if (settings.mode === 'endless') { startEndless(); return; }
  exitEndless();
  tutorial.stop();
  tutFreeze = false;
  for (const e of enemies) world.remove(e.obj);
  enemies.length = 0;
  groups.length = 0;
  playerBullets.clear();
  enemyBullets.clear();
  score = 0; kills = 0; killHeat = 0;
  formation = 'line';
  aces.pending = null;
  applyMode();
  setShape(pickShape(_shapeTmp));                  // a new room shape for every game
  state = 'playing';
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
  if (state === 'playing' || state === 'gameover') { if (state === 'playing') { saveBest(); if (endless) E.record(); else recordGame(gameMode, wave, score, kills); } enterLobby(); }
  else if (state === 'tutorial') finishTutorial();
}

// ---------------------------------------------------------------- lobby
// Where you land after entering VR (once the tutorial is done) and a few seconds after each game.
// The backdrop follows the selected mode: Squadron shows a blue squad skirmishing with red raiders round
// the stars; Fighter shows a normal Fighter battle played bot-on-bots (one blue fighter on autopilot against
// red ships with the real Fighter-mode behaviours, in a Fighter room, wave after wave). Changing the mode
// cross-fades between them. You can grab and resize the room; the holo ring (ring.js) picks the mode,
// starts the game and opens Settings / Stats.
let lobbyT = 0, lobbySpawnT = 0, lobbyReviveT = 0, screenShown = '';
let lobbySim = 'squadron', lobbyWave = 0, lobbyGap = false;
let ringUI = null;                                    // the holo ring (created once the panels exist)
const MODE_INFO = { fighter: 'Fly one ship yourself', squadron: 'Lead 4 bot fighters - or split them into 2 pairs', endless: 'Fly free, raid outposts, grow a squadron' };
function drawLobby() {
  screenShown = fmtTime(stats.screen);
  if (ringUI) ringUI.drawLobby();
}
function lobbyClick(id) {
  if (id.startsWith('mode:')) { setSetting('mode', id.slice(5)); sfx.click(); }
  else if (id === 'start') {
    // START with Settings / Stats open: both close with their normal fade, and the game starts.
    if (menuOpen) toggleSettings(false);
    if (ringUI.statsOpen) ringUI.toggleStats(false);
    startGame();
  }
  else if (id === 'tutorial') startTutorial();
  else if (id === 'settings') toggleSettings();
  else if (id === 'stats') ringUI.toggleStats();
  if (!id.startsWith('mode:')) sfx.click();
  log('lobby click ' + id);
}
function clearBattle() {
  for (const e of enemies) world.remove(e.obj);
  enemies.length = 0;
  groups.length = 0;
  playerBullets.clear();
  enemyBullets.clear();
}
function enterLobby() {
  exitEndless();
  state = 'lobby';
  stateTimer = 0;
  tutorial.stop();
  tutFreeze = false;
  setupLobbySim(simFor(settings.mode));
  simFade.v = 1; simFade.dir = 0; simFade.restart = false;
  simFade.frame = true; setSimOpacity(1); simFade.frame = false;
  hideMessage();
  drawLobby();
  log('lobby');
}
// Set up the lobby backdrop for a mode. The room is always the cube at the size you set (grip-resize):
// no backdrop and no switch between them ever changes its size or shape. (Each mode's ship scale differs,
// but the board scale makes up for it, so the room itself stays exactly where and how big it is.)
const _lobbyDir = new THREE.Vector3();
function simFor(mode) { return mode === 'squadron' || mode === 'endless' ? mode : 'fighter'; }
function setupLobbySim(mode) {
  lobbySim = mode;
  clearBattle();
  if (mode !== 'endless') exitEndless();
  wave = mode === 'fighter' ? LOBBY_FIGHTER_WAVE : 1; lobbyWave = 0; lobbyGap = false;
  setAI(2);
  applyMode(mode === 'endless' ? 'squadron' : mode);  // (sets the cube room for the mode's scale)
  if (mode === 'endless') setBoxB(MODE_BOX.endless);  // ships at their Endless size; same room size
  freshStars();
  resetPlayer();
  if (mode !== 'fighter') { player.obj.visible = false; trail.visible = false; }   // just the command point
  resetBots();
  lobbyT = 0; lobbySpawnT = 1.0; lobbyReviveT = 0;
  if (mode === 'endless') startLobbyEndless();
  log('lobby sim ' + mode);
}
// Mode change in the lobby: fade the battle out, swap the sim, fade it back in (about 0.65 s in all).
// The room's frame stays; everything inside it fades (material opacity, so the stars dim too).
// The Endless preview has no walls, so going to or from it the room's frame fades too (`frame`).
// `restart`: the Endless preview fades out and back in with a fresh group on its next route.
const simFade = { v: 1, dir: 0, frame: false, restart: false };
const SIM_FADE_HALF = 0.32;
function updateLobbyFade(dt) {
  if (state !== 'lobby') { if (simFade.v < 1 || simFade.dir) { simFade.v = 1; simFade.dir = 0; simFade.frame = true; setSimOpacity(1); simFade.frame = false; } return; }
  const want = simFor(settings.mode);
  if ((want !== lobbySim || simFade.restart) && simFade.dir >= 0) {
    simFade.dir = -1;
    if ((want === 'endless') !== (lobbySim === 'endless')) simFade.frame = true;
  }
  if (!simFade.dir) return;
  simFade.v = clamp(simFade.v + (simFade.dir * dt) / SIM_FADE_HALF, 0, 1);
  if (simFade.dir < 0 && simFade.v <= 0) { simFade.restart = false; setupLobbySim(want); simFade.dir = 1; }
  else if (simFade.dir > 0 && simFade.v >= 1) simFade.dir = 0;
  setSimOpacity(simFade.v);
  if (!simFade.dir) simFade.frame = false;
}
// Scale the opacity of everything in the room except its frame. Each material's own opacity (which the game
// may change every frame, e.g. explosions) is re-read whenever it is not the value set here last time.
function setSimOpacity(v) {
  for (const o of board.children) {
    if (o === boxFrame && !simFade.frame) continue;
    o.traverse((m) => {
      const mt = m.material;
      if (!mt || Array.isArray(mt)) return;
      const u = mt.userData;
      if (u.fadeSet !== mt.opacity) u.fadeBase = mt.opacity;
      mt.opacity = u.fadeBase * v;
      u.fadeSet = mt.opacity;
    });
  }
}
function updateLobby(dt) {
  if (lobbySim === 'fighter') updateLobbyFighter(dt); else if (lobbySim === 'endless') updateLobbyEndless(dt); else updateLobbySquadron(dt);
}
// Fighter backdrop: one blue fighter on autopilot (chases the nearest red ship, leads it, fires when lined
// up; it can't be destroyed) against a Fighter-mode enemy group. No rounds: when the group is shot down a
// fresh one comes in a moment later, in the same room.
function updateLobbyFighter(dt) {
  lobbyT += dt;
  const p = player.obj.position;
  if (player.alive) {
    let near = null, nd = Infinity;
    for (const e of enemies) { if (e.hp <= 0) continue; const d = e.obj.position.distanceTo(p); if (d < nd) { nd = d; near = e; } }
    if (near) {
      _lobbyDir.copy(near.obj.position).addScaledVector(near.fwd, near.speed * Math.min(1, nd / (7 * S)) * 0.6).sub(p).normalize();
    } else {                                           // between waves: a lazy loop round the room
      const t = lobbyT * 0.3;
      _lobbyDir.set(Math.sin(t) * HB.x * 0.5, Math.sin(t * 1.7) * HB.y * 0.3, Math.cos(t * 0.8) * HB.z * 0.5).sub(p);
      if (_lobbyDir.lengthSq() < 1e-6) _lobbyDir.copy(player.fwd); else _lobbyDir.normalize();
    }
    const turn = player.turn;
    player.turn = 2.6;                                 // about an enemy fighter's agility: a fair fight
    steer(player, _lobbyDir, dt);
    player.turn = turn;
    const targetSpeed = near && nd > 3 * S ? BOOST * 0.8 : CRUISE;
    player.speed += (targetSpeed - player.speed) * Math.min(1, dt * 3);
    player.vel.copy(player.fwd).multiplyScalar(player.speed);
    p.addScaledVector(player.vel, dt);
    if (wrapBox(p)) { resetTrail(); blink(p, PLAYER_COLOR); }
    player.fireCd -= dt;
    if (near && player.fireCd <= 0 && nd < 6 * S && player.fwd.angleTo(_v1.subVectors(near.obj.position, p)) < 0.3) {
      fireShot(p);
      player.fireCd = 0.2;
    }
    playerFx(dt);
  } else if ((lobbyReviveT += dt) > 2.5) { resetPlayer(); lobbyReviveT = 0; }
  updateEnemies(dt);
  playerBullets.update(dt);
  enemyBullets.update(dt);
  updateCollisions();
  if (!enemies.length) {
    if (!lobbyGap) {
      lobbyGap = true;
      lobbySpawnT = lobbyWave ? 2.0 : 1.0;
    } else if ((lobbySpawnT -= dt) <= 0) {
      lobbyWave++;                                     // (counts groups; the round never changes)
      wave = LOBBY_FIGHTER_WAVE;
      setAI(LOBBY_FIGHTER_WAVE);
      for (const [role, count] of roster(LOBBY_FIGHTER_WAVE, false)) spawnGroup(role, count, LOBBY_FIGHTER_WAVE);
      lobbyGap = false;
    }
  }
}
const LOBBY_FIGHTER_WAVE = 2;                       // the Fighter backdrop's enemy mix (round 2's)

// Endless backdrop: no walls (the same room-sized window, invisible). A small blue group (3 fighters)
// flies a seeded route: past an asteroid field, through the stars, to a red outpost, and fights it.
// The ships can be lost; when the outpost is cleared or the group is gone, the preview fades to a fresh
// group on the next route.
const lobbyEnd = { route: 0, start: new THREE.Vector3(), pass: new THREE.Vector3(), outpost: new THREE.Vector3(), leg: 0, orbit: 0, doneT: 0 };
function startLobbyEndless() {
  endless = true;
  boxFrame.visible = false;
  obstacles.length = 0;
  playerMax = MAX_HP; botMax = BOT_HP; fireMul = 1;
  const r = E.demoRoute(lobbyEnd.route++);
  lobbyEnd.start.copy(r.start); lobbyEnd.pass.copy(r.pass); lobbyEnd.outpost.copy(r.outpost);
  lobbyEnd.leg = 0; lobbyEnd.orbit = 0; lobbyEnd.doneT = 0;
  player.obj.position.copy(r.start);
  player.fwd.subVectors(r.pass, r.start).normalize();
  quatFromDir(player.fwd, player.obj.quaternion);
  player.speed = CRUISE;
  VC.copy(r.start);
  resetBots();
  const b3 = bots[BOT_N - 1]; b3.alive = false; b3.obj.visible = false;   // a small group: 3 fighters
  refreshFriends();
  E.start({ demo: true });
}
function updateLobbyEndless(dt) {
  lobbyT += dt;
  const p = player.obj.position, L = lobbyEnd, run = E.run;
  let goal, spd = CRUISE * 1.5;
  if (L.leg === 0 && p.distanceTo(L.pass) < 1.5) L.leg = 1;
  if (L.leg === 1 && (run.active || p.distanceTo(L.outpost) < 5)) {
    // At the outpost: circle it while the group fights.
    L.orbit += dt * 0.3;
    goal = _v2.set(Math.cos(L.orbit) * 2.6, Math.sin(L.orbit * 1.3) * 0.6, Math.sin(L.orbit) * 2.6).add(L.outpost);
    spd = CRUISE;
  } else goal = L.leg === 0 ? L.pass : L.outpost;
  _lobbyDir.subVectors(goal, p);
  if (_lobbyDir.lengthSq() > 1e-6) player.fwd.lerp(_lobbyDir.normalize(), Math.min(1, dt * 1.2)).normalize();
  quatFromDir(player.fwd, player.obj.quaternion);
  player.speed += (spd - player.speed) * Math.min(1, dt * 2);
  p.addScaledVector(player.fwd, player.speed * dt);
  refreshFriends();
  syncSquadToPlayer();
  SQUAD.engaged = squadEngaged = enemies.some((e) => e.obj.position.distanceTo(p) < 6);
  updateSquad(SQUAD, dt);
  separateFriends();
  updateEnemies(dt);
  playerBullets.update(dt);
  enemyBullets.update(dt);
  updateCollisions();
  E.update(dt);
  const lost = !bots.some((b) => b.alive);
  if ((run.demoCleared || lost) && (L.doneT += dt) > (lost ? 2.5 : 3)) simFade.restart = true;
}
// Squadron backdrop: the blue squadron's leader wanders round the room and engages anything near.
function updateLobbySquadron(dt) {
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
  separateFriends();
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
  exitEndless();
  state = 'tutorial';
  stateTimer = 0;
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
  spawnTut, stage: tutStage, finishTutorial, ping: () => sfx.click(), log,
  get split() { return split; }, get cmdB() { return cmdB; }, get formChanges() { return formChanges; },
  get box() { return box; },
  cue: () => sfx.click(),
  good: () => { sfx.chime(true); haptic('right', 0.25, 40); haptic('left', 0.25, 40); },
});
rig.add(tutorial.card.mesh, tutorial.big.mesh);

// ---------------------------------------------------------------- HUD (one canvas: DOM on desktop, texture on the VR wrist)
const hudCanvas = document.getElementById('hud');
const hctx = hudCanvas.getContext('2d');
const hudTex = new THREE.CanvasTexture(hudCanvas);
hudTex.colorSpace = THREE.SRGBColorSpace;
// ---------------------------------------------------------------- announcements
// In VR they show on the holo ring (ring.js) with the score; on the desktop test page in a DOM overlay.
const msgEl = document.getElementById('message');
let msgTitle = '', msgSub = '', msgTime = 0;

// v34: in Endless, notices are just their title (endless.js and the end screen pass keep = true for the few
// short lines worth keeping, e.g. "+2,000" or "7 hostiles").
function showMessage(title, sub = '', dur = 2, keep = false) {
  if (state === 'lobby') return;                     // the lobby backdrops never announce anything
  if (endless && !keep) sub = '';
  msgTitle = title; msgSub = sub; msgTime = dur;
  msgEl.querySelector('.t').textContent = title;
  msgEl.querySelector('.s').textContent = sub;
  msgEl.classList.add('show');
  if (ringUI) ringUI.drawGame(true);
}
function hideMessage() {
  msgTime = 0;
  msgEl.classList.remove('show');
  if (ringUI) ringUI.drawGame(true);
}

const camFwd = new THREE.Vector3(), camPos = new THREE.Vector3();
function getCamForwardFlat(out) {
  camera.getWorldDirection(out);
  out.y = 0;
  if (out.lengthSq() < 1e-6) out.set(0, 0, -1);
  return out.normalize();
}
let hudLayout = 'row', hudMinBox = 0;              // (tests)
function drawHud() {
  // The wrist keeps only your status; score and announcements are on the board right of the room.
  const W = hudCanvas.width, H = hudCanvas.height;
  hctx.clearRect(0, 0, W, H);
  hctx.fillStyle = 'rgba(0,10,22,0.62)';
  hctx.fillRect(0, 0, W, H);
  hctx.strokeStyle = 'rgba(80,220,255,0.7)';
  hctx.lineWidth = 3;
  hctx.strokeRect(2, 2, W - 4, H - 4);
  hctx.textAlign = 'left';
  hctx.fillStyle = '#7fe9ff';
  hctx.font = 'bold 34px monospace';
  if (gameMode === 'squadron') {
    // One box per ship, filled by its hull, in its pair's colour; lost ships are crossed out.
    hctx.fillText(split ? 'SPLIT' : 'SQUAD', 20, 64);
    const shown = bots.filter((b, i) => i < BOT_N || b.alive);
    // One box per ship (filled by its hull) while they fit at a readable size. v34: 7 - 16 ships wrap into
    // two rows; more than that, one bar for the whole fleet's hull plus boxes for the 8 weakest ships.
    const box = (b, x, y, bw, bh) => {
      const col = '#' + b.grp.color.getHexString();
      hctx.strokeStyle = b.alive ? col : '#ff5566';
      hctx.lineWidth = 3;
      hctx.strokeRect(x, y, bw, bh);
      if (b.alive) {
        hctx.fillStyle = b.hp <= 1 ? '#ff5566' : col;
        hctx.fillRect(x + 4, y + 4, ((bw - 8) * Math.min(b.hp, botMax)) / botMax, bh - 8);
      } else {
        hctx.beginPath(); hctx.moveTo(x + 5, y + 5); hctx.lineTo(x + bw - 5, y + bh - 5); hctx.moveTo(x + bw - 5, y + 5); hctx.lineTo(x + 5, y + bh - 5); hctx.stroke();
      }
    };
    const n = shown.length, X0 = 150, AW = W - X0 - 16;
    hudLayout = n <= 6 ? 'row' : n <= 16 ? 'rows' : 'fleet';
    if (n <= 6) {
      const step = Math.min(78, AW / Math.max(1, n)), bw = Math.max(8, step - 14);
      shown.forEach((b, i) => box(b, X0 + i * step + (split && b.grp === GB ? 18 : 0), 30, bw, 42));
    } else if (n <= 16) {
      const per = Math.ceil(n / 2), step = AW / per, bw = Math.max(20, step - 8);
      hudMinBox = bw;
      shown.forEach((b, i) => box(b, X0 + (i % per) * step, i < per ? 20 : 56, bw, 30));
    } else {
      const alive = shown.filter((b) => b.alive), tot = alive.reduce((a, b) => a + Math.min(b.hp, botMax), 0) / Math.max(1, alive.length * botMax);
      hctx.strokeStyle = '#7fe9ff'; hctx.lineWidth = 3; hctx.strokeRect(X0, 18, AW, 28);
      hctx.fillStyle = tot < 0.35 ? '#ff5566' : '#33ddff'; hctx.fillRect(X0 + 4, 22, (AW - 8) * tot, 20);
      hctx.font = 'bold 22px monospace'; hctx.fillStyle = '#021018'; hctx.textAlign = 'left';
      hctx.fillText(`${alive.length} SHIPS`, X0 + 10, 40);
      const weak = alive.slice().sort((a, b) => a.hp - b.hp).slice(0, 8), step = AW / 8, bw = step - 8;
      hudMinBox = bw;
      weak.forEach((b, i) => box(b, X0 + i * step, 54, bw, 28));
      hctx.font = 'bold 34px monospace'; hctx.fillStyle = '#7fe9ff';
    }
    const f = formation.toUpperCase();
    const line = !split ? `${f} - ${squadEngaged ? 'ATTACK' : 'HOLD'}`
      : `${f}  R:${GA.engaged ? 'ATTACK' : 'HOLD'}  L:${GB.engaged ? 'ATTACK' : 'HOLD'}`;
    hctx.font = '28px monospace';
    hctx.fillStyle = '#5fa9bf';
    hctx.fillText(line, 20, 126, W - 40);
  } else {
    hctx.fillText('HULL', 20, 64);
    const step = Math.min(72, 400 / playerMax), bw = step - 14;
    for (let i = 0; i < playerMax; i++) {
      hctx.strokeStyle = '#7fe9ff';
      hctx.strokeRect(130 + i * step, 30, bw, 42);
      if (i < player.hp) {
        hctx.fillStyle = player.hp <= 2 ? '#ff5566' : '#33ddff';
        hctx.fillRect(134 + i * step, 34, bw - 8, 34);
      }
    }
    hctx.font = '28px monospace';
    hctx.fillStyle = '#5fa9bf';
    hctx.fillText('FIGHTER', 20, 126);
  }
  if (endless && state !== 'lobby') {                 // v33: your Endless upgrades, compact (v34: + warp)
    const ups = E.upgradeLine();
    hctx.font = 'bold 20px monospace';
    hctx.fillStyle = '#ffcc66';
    hctx.textAlign = 'left';
    hctx.fillText(ups ? 'UPG ' + ups : 'UPG -', 20, 153, W - 280);
    // v35: warp is yours from the start - the button is always shown, top right of the wrist panel.
    hctx.font = 'bold 30px monospace'; hctx.textAlign = 'right';
    hctx.fillStyle = warp.on ? '#7fe9ff' : '#ffcc66';
    hctx.fillText(warp.on ? 'B: DROP' : 'B: WARP', W - 18, 153);
    hctx.textAlign = 'left';
  }
  hudTex.needsUpdate = true;
}

// VR panels.
const hudPanel = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.05),
  new THREE.MeshBasicMaterial({ map: hudTex, transparent: true, depthTest: false, fog: false }));
hudPanel.renderOrder = 10;
// Screen-edge flash when you're hit from behind: a red vignette locked to your view (no camera motion).
const vignette = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(128, 128, 60, 128, 128, 128);
  grad.addColorStop(0, 'rgba(255,40,50,0)');
  grad.addColorStop(0.6, 'rgba(255,40,50,0.25)');
  grad.addColorStop(1, 'rgba(255,40,50,0.95)');
  g.fillStyle = grad; g.fillRect(0, 0, 256, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.9), new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0, depthTest: false, depthWrite: false, fog: false }));
  m.position.set(0, 0, -0.25);
  m.renderOrder = 60;
  m.visible = false;
  camera.add(m);
  return m;
})();
let vigAmt = 0, edgeFlashes = 0;
function edgeFlash(amt) { vigAmt = Math.max(vigAmt, amt); screenFlash = Math.max(screenFlash, amt * 0.5); edgeFlashes++; haptic('left', 0.6, 60); }

// Steering reticle + right-hand pointer.
const reticle = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(
  Array.from({ length: 24 }, (_, i) => new THREE.Vector3(Math.cos(i / 24 * Math.PI * 2) * 0.04, Math.sin(i / 24 * Math.PI * 2) * 0.04, 0))),
new THREE.LineBasicMaterial({ color: 0x66eeff, transparent: true, opacity: 0.8, depthTest: false, fog: false }));
reticle.renderOrder = 5;
scene.add(reticle);
const pointer = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1)]),
  new THREE.LineBasicMaterial({ color: 0x33ddff, transparent: true, opacity: 0.25, fog: false }));
// UI rays: subtle lines; over a panel a slightly thicker, brighter beam fades in (~0.15 s) with a small ring
// cursor where the ray meets the panel.
const RAY_BASE = { right: 0.25, left: 0.35 }, RAY_FADE = 0.15;
const BEAM_GEO = new THREE.BoxGeometry(0.0032, 0.0032, 1).translate(0, 0, -0.5);
const CURSOR_GEO = new THREE.RingGeometry(0.0055, 0.0085, 32);
const CURSOR_DOT = new THREE.CircleGeometry(0.0018, 12);
function makeRayFx(line, color) {
  // Draw order: panels (renderOrder 30, no depth test) -> ray line + beam (31) -> cursor (32). The rays skip the
  // depth test too and end exactly at the hit point, so no part is ever hidden by or drawn under a panel.
  line.material.depthTest = false; line.material.depthWrite = false;
  line.renderOrder = 31;
  const beam = new THREE.Mesh(BEAM_GEO, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false, fog: false }));
  beam.renderOrder = 31;
  beam.visible = false;
  line.add(beam);                                  // scales with the line's length (= the hit distance)
  const cursor = new THREE.Group();
  const cm = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthTest: false, depthWrite: false, fog: false });
  const ring = new THREE.Mesh(CURSOR_GEO, cm), dot = new THREE.Mesh(CURSOR_DOT, cm);
  ring.renderOrder = dot.renderOrder = 32;
  cursor.add(ring, dot);
  cursor.visible = false;
  rig.add(cursor);
  return { line, beam, cursor, cm, glow: 0, hit: false, point: new THREE.Vector3(), quat: new THREE.Quaternion(), color: new THREE.Color(color) };
}

// ---------------------------------------------------------------- steering
// Mirror steering only. (The hidden test autopilot, ?demo, flies by pointing the ship at a target.)
function activeSteer() { return DEMO ? 'point' : 'mirror'; }

// Aim line + crosshair out of the ship's nose: where you're heading and where shots go.
function addAimLine(obj, c0, c1, crossCol) {
  const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0.22), new THREE.Vector3(0, 0, 1.9)]);
  g.setAttribute('color', new THREE.Float32BufferAttribute([...c0, ...c1], 3));
  const aimLine = new THREE.Line(g, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  const pts = [];
  for (let i = 0; i < 20; i++) {
    const a0 = (i / 20) * Math.PI * 2, a1 = ((i + 1) / 20) * Math.PI * 2;
    pts.push(new THREE.Vector3(Math.cos(a0) * 0.05, Math.sin(a0) * 0.05, 1.9), new THREE.Vector3(Math.cos(a1) * 0.05, Math.sin(a1) * 0.05, 1.9));
  }
  for (const [x, y] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) pts.push(new THREE.Vector3(x * 0.03, y * 0.03, 1.9), new THREE.Vector3(x * 0.075, y * 0.075, 1.9));
  const cross = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts),
    new THREE.LineBasicMaterial({ color: crossCol, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }));
  obj.add(aimLine, cross);
}
addAimLine(player.obj, [0.3, 0.9, 1.0], [0.0, 0.1, 0.15], 0x66eeff);
addAimLine(cmdB.obj, [1.0, 0.75, 0.25], [0.15, 0.1, 0.0], 0xffcc66);

// Off-screen arrow: a small cyan chevron at the edge of your view pointing toward your ship.
const shipArrow = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints([
  new THREE.Vector3(0, 0.022, 0), new THREE.Vector3(-0.016, -0.012, 0), new THREE.Vector3(0, -0.004, 0), new THREE.Vector3(0.016, -0.012, 0),
]), new THREE.LineBasicMaterial({ color: 0x33ddff, transparent: true, depthTest: false, fog: false }));
shipArrow.renderOrder = 20;
shipArrow.visible = false;
camera.add(shipArrow);
function updateShipArrow(xr) {
  if (!player.alive || state === 'lobby' || tutFreeze) { shipArrow.visible = false; return; }
  player.obj.getWorldPosition(_v1);
  camera.worldToLocal(_v1);
  let visibleOnScreen;
  if (xr) visibleOnScreen = _v1.angleTo(_v2.set(0, 0, -1)) < 0.6;
  else {
    player.obj.getWorldPosition(_v2).project(camera);
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

// Mirror steering (v31). Everything is measured in the battle room's own frame: its front axis (-Z, level)
// is the fixed neutral, so pointing the controller (its targetRay / pointer pose) along the room's front
// always flies straight away into the room - whether the room is moved to the side, your head moves, the
// seat is re-captured or you re-centre (the room and the controllers share one reference space).
// (v30 and before used the direction from the seat to the room, which drifted when the room was off-centre.)
//   The controller's pointing direction, in the room frame, is split into yaw (left / right) and pitch
//   (up / down). Yaw is UNWRAPPED frame to frame, so it is continuous: turn the controller round past
//   straight back and the ship keeps turning round, smoothly (no 180-degree clamp, no snap). Pitch is
//   continuous over the top as well (pointing up and over the head is tracked as pitch past 90 degrees,
//   not as a sudden half-turn of yaw). Both are scaled by the gain separately:
//     ship = Ry(gain * yaw) * Rx(gain * pitch) * shipNeutral
//   Wrist roll is ignored. Whole extra turns are dropped again whenever that can't move the ship (whole-number
//   gains), so after a full spin, pointing forward is straight ahead again.
//   v35: that split is only used away from straight up / down. The tracker (steer.js) moves the ship by the
//   controller's own frame-to-frame turn, scaled by the gain, so near the vertical (where yaw / pitch blow up)
//   the fleet no longer spins or flips; it is eased back onto the map above without any jump.
const mNeutralQ = new THREE.Quaternion();                  // the room's front, level (see updateNeutral)
const SHIP_NEUTRAL_Q = new THREE.Quaternion();             // ship orientation at neutral: into the box
quatFromDir(new THREE.Vector3(0, 0, -1), SHIP_NEUTRAL_Q);
const mirrorQ = SHIP_NEUTRAL_Q.clone();                    // target ship orientation (before cosmetic bank)
const _mi = new THREE.Quaternion(), _mf = new THREE.Vector3();
const mirrorQB = new THREE.Quaternion();                    // group B (left hand) target orientation
// Steering trackers, one per hand (right: main / group A; left: group B when split). v35: delta based,
// see steer.js (no yaw / pitch wrap or flip near straight up / down).
const steerA = createSteer();
const steerB = createSteer();
function setMirrorTarget(ctrlQ) { mirrorInto(ctrlQ, mNeutralQ, SHIP_NEUTRAL_Q, mirrorQ, steerA); }
const YAXIS = new THREE.Vector3(0, 1, 0);
function updateNeutral() {
  // The battle room's front axis (-Z), level. (The room only translates and scales, so this is its own
  // facing in the shared reference space; it does not depend on where you sit or where the room is.)
  board.getWorldQuaternion(_mi);
  _mf.set(0, 0, -1).applyQuaternion(_mi);
  const yawN = Math.hypot(_mf.x, _mf.z) > 1e-6 ? Math.atan2(-_mf.x, -_mf.z) : 0;
  mNeutralQ.setFromAxisAngle(YAXIS, yawN);
  SHIP_NEUTRAL_Q.copy(BOX_FWD_Q);
}
function steerGain() { return Number(teamMode() ? settings.steerGainSq : settings.steerGain) || 2; }
function mirrorInto(ctrlQ, nQ, shipN, out, tr = steerA) {
  const now = performance.now() / 1000, dt = tr.t ? Math.min(0.1, Math.max(0, now - tr.t)) : 1 / 72;
  if (tr.t && now - tr.t > 0.25) tr.init = false;      // not steered for a while (e.g. the left hand before a split): start fresh
  tr.t = now;
  const rq = steerStep(tr, ctrlQ, nQ, steerGain(), dt);
  // world = neutral * R(room frame) * neutral^-1 * shipNeutral
  out.copy(nQ).multiply(rq).multiply(_mi.copy(nQ).invert()).multiply(shipN);
}
// ---------------------------------------------------------------- XR controllers
const hands = { left: null, right: null }; // controller groups by handedness
// Wireframe Touch Plus models (one per hand). Plain: nothing glows on them (the tutorial card shows the buttons).
const touch = { left: createTouchController('left', 0xffcc66), right: createTouchController('right', 0x33ddff) };
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
    if (hand === 'left') c.add(hudPanel, lPointer);
    else c.add(pointer);
    const gpd = ev.data.gamepad;
    log(`controller connected: ${hand} gamepad=${!!gpd} buttons=${gpd ? gpd.buttons.length : 0} profiles=${(ev.data.profiles || []).join(',')}`);
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

function haptic(hand, intensity, ms) {
  const c = hands[hand];
  const gp = c && c.userData.source && c.userData.source.gamepad;
  const act = gp && gp.hapticActuators && gp.hapticActuators[0];
  if (act && act.pulse) { try { act.pulse(intensity, ms); } catch (e) { /* ignore */ } }
}

renderer.xr.addEventListener('sessionstart', () => {
  document.body.classList.add('in-vr');
  rig.position.set(0, 0, 0);
  seatPending = true; seatWait = 10;
  const rs = renderer.xr.getReferenceSpace && renderer.xr.getReferenceSpace();
  if (rs && rs.addEventListener) rs.addEventListener('reset', () => { seatPending = true; seatWait = 3; log('reference space reset'); });
  if (state !== 'playing') { if (tutorialDone()) enterLobby(); else startTutorial(); }
  log('xr sessionstart');
});
renderer.xr.addEventListener('sessionend', () => {
  document.body.classList.remove('in-vr');
  saveStats();   // keep the last seconds of screen time
  camera.position.set(0, HEAD_H, 0);
  log('xr sessionend');
});

// ---------------------------------------------------------------- settings application
function applySettings(changed) {
  player.turn = cmdB.turn = TURN_RATE;
  sfx.setVolumes(Number(settings.musicVol) / 10, Number(settings.sfxVol) / 10);
  if (changed === 'boxSize') { box.size = BOX_SIZES[settings.boxSize]; applyBoard(); saveBox(); }
  if (changed === 'mode' && settings.mode !== runMode() && (state === 'playing' || state === 'gameover')) startGame();
  if (changed === 'mode' && state === 'lobby') drawLobby();
}

// ---------------------------------------------------------------- settings menu (VR panel + desktop overlay)
let menuOpen = false, menuHover = -1;
const MENU_W = 760, MENU_TOP = 84, MENU_ROW = 66, MENU_ROWS = SETTINGS_DEF.length + 1, MENU_M = 0.46;
const SL_X0 = 330, SL_X1 = 690;                       // volume slider bar (canvas px)
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
    if (i < SETTINGS_DEF.length && SETTINGS_DEF[i].slider) {
      // Volume slider: 10 segments; point at a spot on the bar and pull the trigger to set it.
      const d = SETTINGS_DEF[i], v = Number(settings[d.key]);
      g.textAlign = 'left'; g.fillStyle = '#bfefff'; fitText(g, d.label, 28, y + 39, SL_X0 - 50, 27);
      const sw = (SL_X1 - SL_X0) / 10;
      for (let s = 0; s < 10; s++) {
        g.fillStyle = s < v ? '#ffcc66' : 'rgba(255,204,102,0.15)';
        g.fillRect(SL_X0 + s * sw + 2, y + 16, sw - 4, 26);
      }
      g.textAlign = 'right'; g.fillStyle = '#ffcc66'; fitText(g, String(v), W - 26, y + 39, 50, 27, true);
    } else if (i < SETTINGS_DEF.length) {
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
function cycleSetting(i, px = null) {
  if (i >= SETTINGS_DEF.length) { toggleSettings(false); return; }
  const d = SETTINGS_DEF[i];
  if (d.key === '_lobby') { toggleSettings(false); leaveGame(); sfx.click(); return; }
  if (d.action) { resetBox(); showMessage('BOX RESET', 'Back in front of you', 1.0); sfx.click(); return; }
  if (d.slider && px !== null && px > SL_X0 - 20) {
    setSetting(d.key, String(clamp(Math.round(((px - SL_X0) / (SL_X1 - SL_X0)) * 10), 0, 10)));
    sfx.click();
    return;
  }
  const k = d.opts.findIndex((o) => o[0] === settings[d.key]);
  setSetting(d.key, d.opts[(k + 1) % d.opts.length][0]);
  sfx.click();
}
function toggleSettings(open = !menuOpen) {
  if (open === menuOpen) return;
  menuOpen = open;
  menuHover = -1;
  if (renderer.xr.isPresenting) {
    if (open) {
      // Left of the room (never over the battle). From the lobby it slides out of the ring's SETTINGS button.
      panelKey = ''; placePanels();
      menuAnim.slide = !!ringUI.menuFrom(menuFrom);
      menuAnim.t = 0; menuAnim.dur = menuAnim.slide ? 0.3 : 0.15; menuAnim.closing = false;
      menuPanel.material.opacity = 0;
      menuPanel.position.copy(menuAnim.slide ? menuFrom : menuHome);
      menuPanel.visible = true;
      pointer.visible = true;
    } else if (menuPanel.visible) { menuAnim.t = 0; menuAnim.dur = 0.15; menuAnim.closing = true; }
  }
  document.getElementById('settings').classList.toggle('hidden', !(open && !renderer.xr.isPresenting));
  drawMenu();
  if (state === 'lobby') drawLobby();                // the ring's SETTINGS button is lit while open
  log('settings ' + (open ? 'open' : 'closed'));
}
function updateMenuPointer(trigEdge) {
  const prev = menuHover;
  menuHover = -1;
  raycaster.set(input.origin, input.dir);
  const hit = menuPanel.visible ? raycaster.intersectObject(menuPanel, false)[0] : null;
  let px = null;
  if (hit && hit.uv) {
    const row = Math.floor(((1 - hit.uv.y) * menuCanvas.height - MENU_TOP) / MENU_ROW);
    if (row >= 0 && row < MENU_ROWS) menuHover = row;
    px = hit.uv.x * MENU_W;
    pointer.scale.set(1, 1, hit.distance);
    pointer.visible = true;
    rayOnUi('right', input.origin, input.dir, hit.distance, menuPanel);
  } else pointer.scale.set(1, 1, 0.5);
  if (trigEdge && menuHover >= 0) cycleSetting(menuHover, px);
  if (prev !== menuHover) drawMenu();
  return !!(hit && hit.uv);
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
    if (d.slider) {
      const r = document.createElement('input');
      r.type = 'range'; r.min = '0'; r.max = '10'; r.step = '1'; r.id = 'set-' + d.key;
      r.addEventListener('input', () => setSetting(d.key, r.value));
      row.appendChild(r); box.appendChild(row);
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
  if (e.code === 'KeyN' && !e.repeat) setSetting('mode', nextMode());
  if (e.code === 'KeyG' && !e.repeat && gameMode === 'squadron' && (state === 'playing' || state === 'tutorial') && !landing.on && !warp.on) setSplit(!split);
  if (e.code === 'KeyV' && !e.repeat) warpToggle();
  if (e.code === 'KeyB' && !e.repeat && gameMode === 'squadron' && (state === 'playing' || state === 'tutorial')) cycleFormation();
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
  fire: false, boost: false, brake: false, move: new THREE.Vector3(),
};
let prevB = false;
let prevA = false, prevLStick = false, prevXY = false, prevMenuBtn = false, prevTrigMenu = false, prevLTrig = false;
let xDown = false, xWithY = false;                 // X tap (released without Y) = split / rejoin
// Group B's orders (left controller, while the squadron is split).
const inputB = { fire: false, boost: false, brake: false, hasSteer: false, dir: new THREE.Vector3(0, 0, -1) };
const MODES = ['fighter', 'squadron', 'endless'];
function nextMode() { return MODES[(MODES.indexOf(settings.mode) + 1) % MODES.length]; }

function gatherInputVR(dt) {
  input.hasSteer = false; input.fire = false; input.boost = false; input.brake = false;
  inputB.fire = false; inputB.boost = false; inputB.brake = false; inputB.hasSteer = false;
  input.move.set(0, 0, 0);
  const R = hands.right, L = hands.left;
  rig.updateMatrixWorld(true);
  updateNeutral();
  const live = (state === 'playing' || state === 'tutorial') && !tutFreeze && !menuOpen;

  if (R && R.userData.source && R.userData.source.gamepad) {
    const gp = R.userData.source.gamepad;
    const btn = (k) => !!(gp.buttons[k] && gp.buttons[k].pressed);
    R.getWorldPosition(input.origin);
    R.getWorldQuaternion(_q);
    input.dir.set(0, 0, -1).applyQuaternion(_q).normalize();
    input.hasSteer = true;
    const sy = gp.axes.length >= 4 ? gp.axes[3] : 0;
    const trig = btn(0);
    input.fire = trig;
    input.boost = btn(1);                     // grip = boost
    // A: Squadron = next formation (line / wedge / ring); Fighter = brake.
    if (gameMode === 'squadron') { if (btn(4) && !prevA && live) cycleFormation(); }
    else input.brake = btn(4);
    prevA = btn(4);
    // B: warp on / off (Endless, v34).
    if (btn(5) && !prevB && live) warpToggle();
    prevB = btn(5);
    setMirrorTarget(_q);                      // absolute: no re-centre, the stick click does nothing
    const trigEdge = trig && !prevTrigMenu;
    prevTrigMenu = trig;
    if (menuOpen && updateMenuPointer(trigEdge)) input.fire = false;
    else if (uiRay('right', R, trig, trigEdge)) input.fire = false;
    if (menuOpen) input.fire = false;
    boxGrab('right', R, btn(1), sy, dt);
    if (state === 'lobby' || tutFreeze) input.boost = false;
  }

  if (L && L.userData.source && L.userData.source.gamepad) {
    const gp = L.userData.source.gamepad;
    const btn = (k) => !!(gp.buttons[k] && gp.buttons[k].pressed);
    const sy = gp.axes.length >= 4 ? gp.axes[3] : 0;
    // X+Y together = open/close settings.
    const bx = btn(4), by = btn(5);
    const xy = bx && by;
    if (xy && !prevXY) toggleSettings();
    prevXY = xy;
    const menuBtn = gp.buttons.length > 7 && btn(7);       // a 'menu' button at index 7, where a browser exposes one
    if (menuBtn && !prevMenuBtn) toggleSettings();
    prevMenuBtn = menuBtn;
    // X alone (pressed and released without Y) = split / rejoin the squadron.
    if (bx && !xDown) { xDown = true; xWithY = by || menuOpen; }
    if (xDown && (by || menuOpen)) xWithY = true;
    if (!bx && xDown) {
      xDown = false;
      if (!xWithY && !by && gameMode === 'squadron' && live && !landing.on && !warp.on) setSplit(!split);   // (landed / at warp: X does nothing)
    }
    const lt = btn(0);
    const onUi = uiRay('left', L, lt, lt && !prevLTrig);
    boxGrab('left', L, btn(1), sy, dt);
    if (onUi || state === 'lobby') { prevLStick = btn(3); prevLTrig = lt; return; }
    // Stick click: put the box back in its default spot.
    if (btn(3) && !prevLStick && !tutFreeze) { resetBox(); showMessage('BOX RESET', 'Back in front of you', 1.0); }
    if (split && gameMode === 'squadron') {
      // SPLIT: the left hand commands the gold pair: its own mirror steering, trigger = engage, grip / stick = boost.
      L.getWorldQuaternion(_q);
      mirrorInto(_q, mNeutralQ, SHIP_NEUTRAL_Q, mirrorQB, steerB);
      inputB.dir.set(0, 0, -1).applyQuaternion(_q);
      inputB.hasSteer = true;
      if (!menuOpen) inputB.fire = lt;
      inputB.boost = btn(1) || sy < -0.5;
      inputB.brake = sy > 0.5;
    } else {
      // LEFT TRIGGER = shoot / engage.
      if (!menuOpen && lt) input.fire = true;
      // LEFT GRIP = boost; stick forward = boost, back = brake.
      if (btn(1)) input.boost = true;
      if (sy < -0.5) input.boost = true;
      if (sy > 0.5) input.brake = true;
    }
    prevLStick = btn(3); prevLTrig = lt;
  }
}

// ---------------------------------------------------------------- VR panels: pointer rays + box grab
// Both controllers can point at the lobby / tutorial panels; the trigger presses the button you point at.
const lPointer = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1)]),
  new THREE.LineBasicMaterial({ color: 0xffcc66, transparent: true, opacity: 0.35, fog: false }));
lPointer.visible = false;
const rayFx = { right: makeRayFx(pointer, 0x66eeff), left: makeRayFx(lPointer, 0xffd480) };
// Called wherever a ray meets a panel this frame: where, and the panel's orientation (for the cursor).
const _rn = new THREE.Vector3(), _rp = new THREE.Vector3();
function rayOnUi(hand, origin, dir, dist, mesh) {
  const f = rayFx[hand];
  f.hit = true;
  if (mesh.userData.arc) {
    // Curved band: the normal points from the hit point to the band's vertical axis.
    mesh.getWorldPosition(_rn).sub(_rp.copy(origin).addScaledVector(dir, dist));
    _rn.y = 0; _rn.normalize();
    f.quat.setFromUnitVectors(ZAXIS, _rn);
  } else {
    mesh.getWorldQuaternion(f.quat);
    _rn.set(0, 0, 1).applyQuaternion(f.quat);
  }
  // On the surface, lifted 2 mm along the panel's normal (toward the side the ray came from).
  if (_rn.dot(dir) > 0) _rn.negate();
  f.point.copy(origin).addScaledVector(dir, dist).addScaledVector(_rn, 0.002);
  f.line.scale.set(1, 1, dist);                     // the beam stops exactly at the hit point
}
function updateRays(dt) {
  for (const hand of ['right', 'left']) {
    const f = rayFx[hand], k = dt / RAY_FADE;
    f.glow = f.hit ? Math.min(1, f.glow + k) : Math.max(0, f.glow - k);
    const g = f.glow * f.glow * (3 - 2 * f.glow);          // smoothstep: soft in and out
    if (g > 0 && hands[hand]) f.line.visible = true;
    f.line.material.opacity = RAY_BASE[hand] + 0.4 * g;
    f.beam.visible = g > 0.01;
    f.beam.material.opacity = 0.5 * g;
    f.cursor.visible = g > 0.01 && f.line.visible && !!hands[hand];
    if (f.cursor.visible) {
      if (f.hit) { f.cursor.position.copy(f.point); f.cursor.quaternion.copy(f.quat); }
      f.cm.opacity = 0.9 * g;
      f.cursor.scale.setScalar(0.85 + 0.15 * g);
    }
    f.hit = false;                                         // set again by next frame's ray tests
  }
}
const uiHit = { left: null, right: null };
const uiHeld = { left: false, right: false };          // a trigger press that clicked a button (not a shot)
function activePanels() { return [...ringUI.lobbyPanels(), tutorial.card, tutorial.big, ...(E ? E.panels() : [])].filter((p) => p.visible); }
function uiRay(hand, ctrl, trig, edge) {
  const line = hand === 'right' ? pointer : lPointer;
  ctrl.getWorldPosition(_v3);
  _v2.set(0, 0, -1).applyQuaternion(ctrl.getWorldQuaternion(_q));
  raycaster.set(_v3, _v2);
  let best = null, bp = null;
  for (const P of activePanels()) { const h = P.pick(raycaster); if (h && (!best || h.dist < best.dist)) { best = h; bp = P; } }
  uiHit[hand] = best ? { panel: bp, id: best.id } : null;
  if (best) rayOnUi(hand, _v3, _v2, best.dist, bp.mesh);
  for (const P of activePanels()) {
    const hov = (uiHit.right && uiHit.right.panel === P && uiHit.right.id) || (uiHit.left && uiHit.left.panel === P && uiHit.left.id) || null;
    if (P.hover !== hov) { P.hover = hov; if (P.isLobby) drawLobby(); else if (P.redraw) P.redraw(); else tutorial.redraw(); }
  }
  // The tutorial card only takes over the controller while you point at one of its buttons, so it
  // never blocks shooting, selecting or ordering at ships seen past it.
  const capture = !!best && (!!best.id || bp !== tutorial.card);
  const showRay = capture || state === 'lobby';
  if (hand === 'left') line.visible = showRay;
  else if (showRay) line.visible = true;
  line.scale.set(1, 1, best ? best.dist : 0.5);
  if (edge && best && best.id) { uiHeld[hand] = true; haptic(hand, 0.3, 25); bp.onClick(best.id); }
  if (!trig) uiHeld[hand] = false;
  return capture || uiHeld[hand];
}
// Lobby and the first tutorial step: hold a grip to move the room; push that hand's stick to resize it.
// The room moves by the hand's movement times a gentle size-based gain (a bigger room moves a bit more,
// a smaller one less): sqrt(size / medium), kept to 0.7 - 1.6. It is applied frame by frame to the hand's
// movement, so starting a grab (or resizing during one) never makes the room jump.
const GRAB_GAIN_MIN = 0.7, GRAB_GAIN_MAX = 1.6;
const grabGain = (size) => clamp(Math.sqrt(size / BOX_SIZES.medium), GRAB_GAIN_MIN, GRAB_GAIN_MAX);
const grab = { hand: null, start: new THREE.Vector3(), prev: new THREE.Vector3(), x: 0, y: 0, z: 0, moved: 0 };
function boxGrab(hand, ctrl, grip, sy, dt) {
  const allowed = state === 'lobby' || tutFreeze || menuOpen;
  if (!allowed || !grip) { if (grab.hand === hand) { grab.hand = null; saveBox(); } return; }
  ctrl.getWorldPosition(_v3);
  if (grab.hand === null) { grab.hand = hand; grab.start.copy(_v3); grab.prev.copy(_v3); grab.x = box.x; grab.y = box.y; grab.z = box.z; }
  if (grab.hand !== hand) return;
  const k = grabGain(box.size);
  box.x += (_v3.x - grab.prev.x) * k; box.y += (_v3.y - grab.prev.y) * k; box.z += (_v3.z - grab.prev.z) * k;
  grab.prev.copy(_v3);
  if (Math.abs(sy) > 0.15) box.size = clamp(box.size * Math.exp(-sy * dt * 0.9), 0.3, 2.0);
  grab.moved += _v3.distanceTo(grab.start) * dt;
  applyBoard();
}
// Panels sit beside the room (and are re-placed when you move or resize it). They are turned (about the
// vertical axis only) toward a fixed SEAT point - where your head was when you entered VR - and never
// follow your head after that. The seat is captured again only if you re-centre the view (Meta button).
const seat = new THREE.Vector3(0, HEAD_H, 0);
let seatPending = true, seatWait = 0;
function updateSeat() {
  if (!renderer.xr.isPresenting) { if (seatPending) { camera.getWorldPosition(seat); seatPending = false; } return; }
  if (!seatPending) return;
  if (--seatWait > 0) return;                          // let a few XR frames pass: the head pose is real by then
  camera.getWorldPosition(_v1);
  if (_v1.y < 0.2) return;                             // no head pose yet
  rig.worldToLocal(seat.copy(_v1));
  seatPending = false;
  panelKey = '';
  log(`seat ${seat.x.toFixed(2)},${seat.y.toFixed(2)},${seat.z.toFixed(2)}`);
}
// Side panels turn toward the seat on a smooth curve that approaches a maximum (no hard cap, no snap):
// yaw = PANEL_MAX_YAW * tanh(angle to the seat / PANEL_YAW_S). At the usual spots beside the room (about
// 40 degrees off) that is about 32 degrees; small angles face you almost fully. Vertical axis only, and
// still fixed in place (no head tracking). (v22 - v30: half the angle, capped at 22 degrees.)
const PANEL_MAX_YAW = 42 * Math.PI / 180, PANEL_YAW_S = 0.72;
let panelYawLegacy = false;                          // (tests: the old curve, for before / after shots)
function panelYaw(full) {
  if (panelYawLegacy) return clamp(full * 0.5, -22 * Math.PI / 180, 22 * Math.PI / 180);
  return PANEL_MAX_YAW * Math.tanh(full / PANEL_YAW_S);
}
function faceSeat(mesh) {
  const full = Math.atan2(seat.x - mesh.position.x, seat.z - mesh.position.z);
  mesh.rotation.set(0, panelYaw(full), 0);
}
ringUI = createRingUI({
  rig, seat, settings, stats, MODES, MODE_INFO, fmtNum, fmtTime, uiHit, faceSeat, lobbyClick, log, menuOpen: () => menuOpen,
  placeSide: (mesh, side, w) => placeSide(mesh, side, w), click: () => sfx.click(),
  boxDims: () => { const sc = board.scale.x; return { x: board.position.x, y: board.position.y, z: board.position.z, hx: HB.x * sc, hy: HB.y * sc, hz: HB.z * sc, cube: BOX_B * sc }; },
  best: () => Math.max(stats.bestScore, best), screen: () => fmtTime(stats.screen),
  game: () => ({ state, score, wave, hostiles: enemies.length, msgOn: msgTime > 0, msgTitle, msgSub, intermission: intermission > 0, endless: endless ? E.info() : null }),
});

// ---------------------------------------------------------------- Endless (world, outposts, docks: endless.js)
function runMode() { return endless ? 'endless' : gameMode; }
// Endless controls: one fighter (Fighter controls) until you have wingmen, then Squadron controls.
function setEndlessControls(m) {
  gameMode = m;
  const sq = m === 'squadron';
  player.obj.userData.lines.visible = !sq;
  player.obj.children[1].visible = !sq;
  trail.visible = !sq && player.alive;
  setSplit(false, true);
  refreshFriends();
}
// The last ship of an Endless squadron turns back into the single fighter: same spot, heading and share of hull.
function squadToFighter(b) {
  const k = b.hp / botMax;
  player.obj.position.copy(b.obj.position);
  player.fwd.copy(b.fwd).normalize();
  player.speed = b.speed;
  player.hp = Math.max(1, Math.ceil(k * playerMax));
  player.invuln = 1; player.flash = 0; player.alive = true; player.obj.visible = true;
  b.alive = false; b.obj.visible = false;
  setEndlessControls('fighter');
  resetTrail();
  showMessage('LAST SHIP', 'Fighter controls', 1.6, true);
  log('endless: last ship -> fighter controls');
}
// ---------------------------------------------------------------- Endless warp (v34)
// B (desktop: V) engages the warp drive (bought at a friendly outpost): your ships fly 5x faster in a straight
// line - no steering - and swerve smoothly round stars and rocks on the way. It drops out by itself near any
// outpost (endless.js) and can't be engaged near one. B again drops out. No shooting while at warp.
const WARP_K = 5;
const warp = { on: false, dir: new THREE.Vector3(), cur: new THREE.Vector3(), t: 0 };
const _w1 = new THREE.Vector3(), _w2 = new THREE.Vector3(), _w3 = new THREE.Vector3(), _w4 = new THREE.Vector3();
function warpToggle() {
  if (!endless || state !== 'playing') return;
  if (warp.on) { warpOff('manual'); return; }
  const why = E.warpBlock();
  if (why) { showMessage(why, '', 1.2, true); sfx.click(); log('warp blocked ' + why); return; }
  if (split) setSplit(false, true);
  warp.on = true; warp.t = 0;
  warp.dir.copy(player.fwd).normalize();
  warp.cur.copy(warp.dir);
  warpFxStart(true); haptic('right', 0.5, 80); haptic('left', 0.5, 80);
  showMessage('WARP', '', 1.2, true);
  log('warp on');
}
function warpOff(why) {
  if (!warp.on) return;
  warp.on = false;
  player.speed = CRUISE * MODS.speed;
  if (gameMode !== 'squadron') quatFromDir(player.fwd, player.mq);
  for (const b of bots) if (b.alive) b.speed = CRUISE;
  if (why === 'drop') showMessage('WARP DROP', '', 1.2, true);
  if (why !== 'win' && why !== 'reset') warpFxStart(false);
  else { wfx.mode = 'off'; wfx.k = 0; wfxGroup.visible = false; }   // (win / reset: gone at once)
  log('warp off ' + why);
}
// The warp flight of your ship / the command point: straight on, swerving round obstacles ahead.
function warpMove(dt) {
  const p = player.obj.position;
  warp.t += dt;
  const des = _w1.copy(warp.dir), LOOK = 7;
  for (const o of obstacles) {
    _w2.subVectors(o.c, p);
    const along = _w2.dot(warp.cur);
    if (along < -o.r || along > LOOK) continue;
    _w3.copy(p).addScaledVector(warp.cur, along);   // the closest point of the path to it
    _w4.subVectors(_w3, o.c);
    const clear = o.r + 0.9, dl = _w4.length();
    if (dl > clear) continue;
    if (dl < 1e-4) _w4.set(-warp.cur.z, 0, warp.cur.x);
    des.addScaledVector(_w4.normalize(), (1 - dl / clear) * 2.2 * (1 - Math.max(0, along) / LOOK * 0.6));
  }
  des.normalize();
  warp.cur.lerp(des, 1 - Math.exp(-dt * 4)).normalize();
  const sp = CRUISE * WARP_K * MODS.speed;
  player.speed = sp;
  player.fwd.copy(warp.cur);
  player.vel.copy(warp.cur).multiplyScalar(sp);
  p.addScaledVector(player.vel, dt);
  obstPushOut(p, 0.15 * S);
  quatFromDir(player.fwd, player.mq);
  player.obj.quaternion.copy(player.mq);
}
// The squadron at warp: every ship holds its formation slot round the command point.
const _w5 = new THREE.Vector3();
function warpBots(dt) {
  syncSquadToPlayer();
  const alive = bots.filter((b) => b.alive);
  alive.forEach((b, k) => {
    slotPos(SQUAD, k, alive.length, _w5);
    b.obj.position.addScaledVector(player.vel, dt).lerp(_w5, 1 - Math.exp(-dt * 5));
    b.fwd.copy(warp.cur);
    quatFromDir(b.fwd, b.obj.quaternion);
    b.speed = player.speed;
    b.invuln = Math.max(0, b.invuln - dt);
  });
}
// Warp flow (v37 from the user's sketch; v38: fewer, shorter, closer, smoother): thin light lines streaming past
// the fleet, opposite to the warp heading, round an invisible smooth body that sits just outside the formation.
// Each line comes in straight a little ahead of the fleet, eases outward in one long gentle S-curve (smootherstep,
// so there is no corner anywhere) and then runs on alongside the ships and a little past them. A line that comes in
// rho0 off the axis ends up at sqrt(rho0^2 + b^2) (the same flow between neighbouring lines everywhere), so lines
// farther out bend less. The axis runs through the middle of the formation (seen across the heading); the body's
// width and nose follow the formation's real extent. Nothing is drawn on the ships. Bright dashes scroll backward
// along the lines so the speed reads. No entry / exit animation: it fades in and out in 0.2 s.
const WFX_LINES = 20, WFX_SEG = 40;
const wfx = { k: 0, b: 0.35, f: 0, bk: 0, c: new THREE.Vector3(), mode: 'off', t: 0, lines: [] };
const wfxArr = new Float32Array(WFX_LINES * WFX_SEG * 6), wfxCol = new Float32Array(WFX_LINES * WFX_SEG * 6);
const wfxLines = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({
  vertexColors: true, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
}));
wfxLines.geometry.setAttribute('position', new THREE.BufferAttribute(wfxArr, 3).setUsage(THREE.DynamicDrawUsage));
wfxLines.geometry.setAttribute('color', new THREE.BufferAttribute(wfxCol, 3).setUsage(THREE.DynamicDrawUsage));
wfxLines.frustumCulled = false;
const wfxGroup = new THREE.Group();
wfxGroup.add(wfxLines);
wfxGroup.visible = false;
world.add(wfxGroup);
for (let i = 0; i < WFX_LINES; i++) {
  // Azimuth evenly round the axis (golden angle, jittered); lead-in radius as a fraction of the body's width:
  // stratified so they spread evenly from close to the axis out to about 0.65 b.
  const u = (i + 0.2 + 0.6 * Math.random()) / WFX_LINES;
  wfx.lines.push({ phi: i * 2.39996 + (Math.random() - 0.5) * 0.4, r0: 0.05 + 0.6 * Math.pow(u, 1.3), ph: Math.random() * 10, v: 0.85 + Math.random() * 0.3, b: 0.6 + 0.4 * Math.random() });
}
wfx.lines.sort(() => Math.random() - 0.5);
const _wfxQ = new THREE.Quaternion(), _wfxZ = new THREE.Vector3(0, 0, 1), _wfxV = new THREE.Vector3(), _wfxR = new THREE.Vector3(), _wfxC = new THREE.Vector3();
function warpFxStart(entering) {
  wfx.mode = entering ? 'in' : 'out';
  wfx.t = 0;
  if (entering) { wfxGroup.visible = true; sfx.warpIn(); } else sfx.warpOut();
}
function wfxShips() { return gameMode === 'squadron' ? bots.filter((b) => b.alive).map((b) => b.obj) : [player.obj]; }
const smoother = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * t * (t * (t * 6 - 15) + 10));
function updateWarpFx(dt) {
  if (wfx.mode === 'off') return;
  wfx.t += dt;
  if (wfx.mode === 'in') { wfx.k = Math.min(1, wfx.k + dt / 0.2); if (!warp.on) warpFxStart(false); }
  else { wfx.k = Math.max(0, wfx.k - dt / 0.2); if (wfx.k <= 0) { wfx.mode = 'off'; wfxGroup.visible = false; return; } }
  _wfxV.copy(warp.cur.lengthSq() > 0.5 ? warp.cur : player.fwd).normalize();
  // The formation in the flow's frame: its middle across the heading, how far it reaches across (radial), and
  // how far ahead / behind the view centre its ships sit.
  const ships = wfxShips();
  _wfxC.set(0, 0, 0);
  for (const o of ships) { _wfxR.copy(o.position).sub(VC); _wfxC.add(_wfxR.addScaledVector(_wfxV, -_wfxR.dot(_wfxV))); }
  if (ships.length) _wfxC.multiplyScalar(1 / ships.length);
  let rad = 0, front = 0, back = 0;
  for (const o of ships) {
    _wfxR.copy(o.position).sub(VC);
    const al = _wfxR.dot(_wfxV);
    front = Math.max(front, al); back = Math.min(back, al);
    rad = Math.max(rad, _wfxR.addScaledVector(_wfxV, -al).sub(_wfxC).length());
  }
  const first = wfx.t < dt * 1.5, e = first ? 1 : 1 - Math.exp(-dt * 3);
  if (first) wfx.c.copy(_wfxC); else wfx.c.lerp(_wfxC, e);
  // The invisible body: just outside the formation (a ship is about 0.2 long at this scale).
  const bw = (wfx.b += (Math.min(3.2, rad + 0.28) - wfx.b) * e);
  const fr = (wfx.f += (front - wfx.f) * e), bk = (wfx.bk += (back - wfx.bk) * e);
  const Lo = 1.1 + bw * 1.4;                            // the long, gentle opening (straight -> alongside)
  const nose = fr + 0.15 + Lo;                          // fully open just ahead of the leading ship
  const zF = nose + 0.5, zB = bk - (0.9 + bw * 0.6);    // short: a little ahead of the bend, a little past the fleet
  wfxGroup.position.copy(VC).add(wfx.c);
  _wfxQ.setFromUnitVectors(_wfxZ, _wfxV);
  wfxGroup.quaternion.slerp(_wfxQ, first ? 1 : 1 - Math.exp(-dt * 8));
  const W = BOX_B, flow = 6, len = zF - zB;            // dash scroll speed (units / s, backward)
  let o = 0;
  for (let i = 0; i < WFX_LINES; i++) {
    const ln = wfx.lines[i], cp = Math.cos(ln.phi), sp = Math.sin(ln.phi), r0 = ln.r0 * bw;
    const r1 = Math.sqrt(r0 * r0 + bw * bw);
    const scroll = wfx.t * flow * ln.v + ln.ph;
    let px = 0, py = 0, pz = 0, pc = 0;
    for (let j = 0; j <= WFX_SEG; j++) {
      const z = zF - len * (j / WFX_SEG);
      const rho = r0 + (r1 - r0) * smoother((nose - z) / Lo);
      const cx = rho * cp, cy = rho * sp;
      // brightness: scrolling dashes, soft fades at both ends of the line and before the window's edge
      const s = (zF - z) + scroll, d = s - Math.floor(s / 1.5) * 1.5;
      const dash = 0.3 + 0.7 * Math.exp(-((d - 0.4) * (d - 0.4)) / 0.06);
      const ends = smoother(Math.min((zF - z) / (len * 0.18), (z - zB) / (len * 0.3)));
      const wr = Math.hypot(cx, cy, z);
      const win = 1 - Math.min(1, Math.max(0, (wr - W * 0.75) / (W * 0.25)));
      const c = ends * win * dash * ln.b * wfx.k;
      if (j > 0) {
        wfxArr[o] = px; wfxArr[o + 1] = py; wfxArr[o + 2] = pz; wfxArr[o + 3] = cx; wfxArr[o + 4] = cy; wfxArr[o + 5] = z;
        wfxCol[o] = 0.35 * pc; wfxCol[o + 1] = 0.75 * pc; wfxCol[o + 2] = 1.0 * pc;
        wfxCol[o + 3] = 0.35 * c; wfxCol[o + 4] = 0.75 * c; wfxCol[o + 5] = 1.0 * c;
        o += 6;
      }
      px = cx; py = cy; pz = z; pc = c;
    }
  }
  wfxLines.geometry.attributes.position.needsUpdate = true;
  wfxLines.geometry.attributes.color.needsUpdate = true;
}
// ---------------------------------------------------------------- Endless landing (endless.js decides when)
// Fly onto a green star (or a cleared outpost) and you land: the view glides over to the star (eased, `glide`
// seconds) while every ship flies a real approach (v32): from where it is, along its own heading, it curves
// in, lines up with the squadron's approach and comes down onto its spot on the star at a shallow angle,
// slowing as it touches down, then levels out. A split squadron rejoins first. Only LAUNCH takes off.
const landing = { on: false, at: new THREE.Vector3(), c: new THREE.Vector3(), r: 0, from: new THREE.Vector3(), view: new THREE.Vector3(), t: 0, glide: 1, shipT: 0, flights: new Map(), h: new THREE.Vector3() };
const LAND_SLOPE = 0.5;                  // the final approach comes down at about 27 degrees
function landSlot(k, n, out) {
  // Spots on the star's upper side, tilted toward the side you come in from, spread evenly (any number).
  if (n <= 1) return out.set(0, 1, 0);
  const cap = Math.min(1.15, 0.45 + 0.07 * n);
  const z = 1 - ((k + 0.5) / n) * (1 - Math.cos(cap)), rr = Math.sqrt(Math.max(0, 1 - z * z)), a = k * 2.39996;
  return out.set(rr * Math.cos(a), z, rr * Math.sin(a));
}
function planFlight(obj, fwd, speed, slot, k) {
  const f = landing.flights.get(obj) || { p0: new THREE.Vector3(), b1: new THREE.Vector3(), b2: new THREE.Vector3(), p3: new THREE.Vector3(), d1: new THREE.Vector3(), T: 1, bank: 0, fwd: null };
  f.fwd = fwd; f.p0.copy(obj.position); f.p3.copy(slot);
  const dist = f.p0.distanceTo(f.p3);
  const v = Math.max(speed, CRUISE);
  f.T = clamp(0.8 + dist / (v * 1.6), 1.3, 3.2) + k * 0.06;          // (a slight stagger, nobody lands at once)
  // Final approach: along the squadron's heading to the star, coming down.
  f.d1.copy(landing.h).multiplyScalar(1).add(_v1.set(0, -LAND_SLOPE, 0)).normalize();
  const L1 = clamp(dist * 0.4, 0.6, 3.5);
  f.b2.copy(f.p3).addScaledVector(f.d1, -L1);
  // Leave along its own heading (time is eased, so the start speed is 2x the handle / T x 3).
  f.b1.copy(f.p0).addScaledVector(fwd, Math.min((v * f.T) / 6, dist * 0.6 + 0.3));
  // Keep clear of the star: if the way to the line-up point cuts through it, go over the top.
  const cl = landing.r + 0.5;
  if (segPointDist(f.b1, f.b2, landing.c) < cl) f.b1.y = Math.max(f.b1.y, landing.c.y + cl + 0.4);
  if (segPointDist(f.p0, f.b1, landing.c) < cl) f.b1.y = Math.max(f.b1.y, landing.c.y + cl + 0.4);
  f.bank = 0;
  landing.flights.set(obj, f);
  landing.shipT = Math.max(landing.shipT, f.T + 0.35);
}
const _lb = new THREE.Vector3(), _lt = new THREE.Vector3(), _lq = new THREE.Quaternion();
function bez(f, u, out, tan) {
  const a = 1 - u;
  out.copy(f.p0).multiplyScalar(a * a * a).addScaledVector(f.b1, 3 * a * a * u).addScaledVector(f.b2, 3 * a * u * u).addScaledVector(f.p3, u * u * u);
  tan.copy(f.b1).sub(f.p0).multiplyScalar(3 * a * a).addScaledVector(_v3.subVectors(f.b2, f.b1), 6 * a * u).addScaledVector(_v2.subVectors(f.p3, f.b2), 3 * u * u);
  return out;
}
// One ship along its flight at landing time t.
function flyFlight(obj, f, t, dt) {
  const tau = clamp(t / f.T, 0, 1), u = 1 - (1 - tau) * (1 - tau);    // eased: slows to a stop at the spot
  bez(f, u, obj.position, _lt);
  if (_lt.lengthSq() < 1e-10) _lt.copy(f.d1);
  _lt.normalize();
  // Level out over the last part (touch-down), facing along the approach.
  const lev = smoothstep(0.7, 1, tau);
  _lb.copy(landing.h).lerp(_lt, 1 - lev).normalize();
  const prev = _v2.copy(f.fwd);
  f.fwd.copy(_lb);
  const yawRate = (prev.z * f.fwd.x - prev.x * f.fwd.z) / Math.max(dt, 1e-4);
  f.bank += (clamp(-yawRate * 0.35, -0.9, 0.9) * (1 - lev) - f.bank) * Math.min(1, dt * 6);
  quatFromDir(f.fwd, obj.quaternion);
  obj.quaternion.multiply(_lq.setFromAxisAngle(ZAXIS, f.bank));
}
function smoothstep(a, b, x) { const k = clamp((x - a) / (b - a), 0, 1); return k * k * (3 - 2 * k); }
function landOn(c, r, glide = 1) {
  warpOff('land');
  if (split) { setSplit(false, true); showMessage('SQUADRON REJOINED', 'Landing together', 1.4); }
  landing.on = true; landing.c.copy(c); landing.r = r;
  landing.at.copy(c).add(_v1.set(0, r + 0.3, 0));
  landing.from.copy(endless ? VC : player.obj.position); landing.view.copy(landing.from);
  landing.t = 0; landing.glide = Math.max(0.05, glide); landing.shipT = 0;
  landing.flights.clear();
  // The approach heading: from the ships to the star, level.
  const ships = gameMode === 'squadron' ? bots.filter((b) => b.alive) : [player];
  centroid(ships.map((b) => b === player ? player : b), _v2);
  landing.h.subVectors(c, _v2).setY(0);
  if (landing.h.lengthSq() < 1e-6) landing.h.copy(player.fwd).setY(0);
  if (landing.h.lengthSq() < 1e-6) landing.h.set(0, 0, -1);
  landing.h.normalize();
  // Spots: the cap tilts toward the side you come in from (rotate "up" back toward -h).
  _lq.setFromUnitVectors(UP, _v1.copy(UP).addScaledVector(landing.h, -0.45).normalize());
  if (gameMode === 'squadron') {
    ships.forEach((b, k) => {
      landSlot(k, ships.length, _v1).applyQuaternion(_lq).multiplyScalar(r + 0.12).add(c);
      planFlight(b.obj, b.fwd, b.speed, _v1, k);
    });
  } else planFlight(player.obj, player.fwd, player.speed, landing.at, 0);
  log('landed');
}
const landEase = () => { const k = clamp(landing.t / landing.glide, 0, 1); return k * k * (3 - 2 * k); };
const landSettled = () => landing.on && landing.t >= Math.max(landing.glide, landing.shipT);
function takeOff() {
  if (!landing.on) return;
  landing.on = false;
  player.speed = CRUISE;
  // Leave along the way the ships are facing (level), the controller then takes over again.
  if (gameMode !== 'squadron') { quatFromDir(player.fwd, player.mq); player.bank = 0; }
  for (const b of bots) if (b.alive) { b.speed = CRUISE; b.bank = 0; }
  log('take off');
}
// The view (and the invisible command point) glides onto the star; a fighter flies its approach.
function landedMove(p, dt) {
  landing.t += dt;
  landing.view.lerpVectors(landing.from, landing.at, landEase());
  if (gameMode === 'squadron') p.copy(landing.view);
  else {
    const f = landing.flights.get(player.obj);
    if (f) flyFlight(player.obj, f, landing.t, dt);
  }
  player.speed = 0; player.vel.set(0, 0, 0);
  return true;
}
// The squadron's ships fly their approach, then sit on their spots on the star.
const _ls1 = new THREE.Vector3();
function holdLanded(dt) {
  const alive = bots.filter((b) => b.alive);
  for (const b of alive) {
    let f = landing.flights.get(b.obj);
    if (!f) {
      // A ship bought while landed: it flies in to a free spot as well.
      const k = landing.flights.size, n = Math.max(k + 1, alive.length);
      _lq.setFromUnitVectors(UP, _v1.copy(UP).addScaledVector(landing.h, -0.45).normalize());
      landSlot(k, n, _ls1).applyQuaternion(_lq).multiplyScalar(landing.r + 0.12).add(landing.c);
      const t0 = landing.t;
      planFlight(b.obj, b.fwd, CRUISE, _ls1, 0);
      f = landing.flights.get(b.obj); f.t0 = t0;
      landing.shipT = Math.max(landing.shipT, t0 + f.T + 0.35);
    }
    flyFlight(b.obj, f, landing.t - (f.t0 || 0), dt);
    b.speed = 0;
  }
}
// An outpost blows up: debris and sparks, a big boom and a short hit-stop.
const BLAST_RED = new THREE.Color(0xff5544), BLAST_GREY = new THREE.Color(0xc8d0da);
// (v31: toned down - fewer, slower sparks, a quieter boom, a very short hit-stop.)
function outpostBlast(pos) {
  burst(pos, 34, BLAST_RED, 2.0 * S, 0.9);
  burst(pos, 14, BLAST_GREY, 1.1 * S, 1.1);
  if (state === 'lobby') { sfx.boom(pos, false); return; }   // (the lobby preview: a plain boom)
  sfx.blast(pos);
  hitStop(0.05);
  haptic('right', 0.6, 100); haptic('left', 0.6, 100);
}
function startEndless() {
  tutorial.stop();
  tutFreeze = false;
  clearBattle();
  score = 0; kills = 0; killHeat = 0;
  formation = 'line';
  aces.pending = null;
  endless = true;
  gameMode = 'fighter';
  setBoxB(MODE_BOX.endless);                         // the view window: same size as the room, no walls
  boxFrame.visible = false;
  obstacles.length = 0;
  playerMax = MAX_HP; botMax = BOT_HP; fireMul = 1;
  resetBots();
  resetPlayer();
  player.obj.position.set(0, 0, -2.4);               // just off the home star, flying out
  resetTrail();
  setEndlessControls('fighter');
  state = 'playing';
  stateTimer = 0;
  intermission = 0;
  wave = 1;
  landing.on = false;
  warp.on = false; won = false;
  E.start();
  showMessage('ENDLESS', 'Raid the red stars', 3, true);
  log('game start mode=endless');
}
function exitEndless() {
  landing.on = false;
  warpOff('reset');
  if (!endless) return;
  E.stop();
  endless = false;
  AH = HB; ARENA_C.set(0, 0, 0); VC.set(0, 0, 0);
  obstacles.length = 0;
  obstacles.push(...BASE_OBSTACLES);
  boxFrame.visible = true;
  playerMax = MAX_HP; botMax = BOT_HP; fireMul = 1;
  resetMods();                                       // (Endless upgrades never carry over)
  world.position.set(0, 0, 0);
}
E = createEndless({
  world, board, rig, seat, VC, obstacles, bots, player, enemies, stats, fmtNum, S, log, winDist,
  BOX_B: () => BOX_B, gameMode: () => gameMode, playerMax: () => playerMax, botMax: () => botMax,
  score: () => score, kills: () => kills, addScore: (n) => { score += n; },
  setControls: setEndlessControls, syncSquad: () => syncSquadToPlayer(), placeBot: (b, k, m) => placeBot(SQUAD, b, k, m), refreshFriends,
  setUpgrades: (hull, fire) => { playerMax = MAX_HP + 2 * hull; botMax = BOT_HP + hull; fireMul = fire; },
  setArena: (c, half) => { ARENA_C.copy(c); AH = half; }, setAI, setWave: (n) => { wave = n; }, roster, spawnGroup,
  clearEnemies: () => { clearBattle(); }, showMessage: (t, sub, d) => showMessage(t, sub, d, true), damagePlayer, damageBot, damageEnemy, obstInside,
  warping: () => warp.on, warpOff: (why) => warpOff(why), win: () => winGame(), slowMo, bigBoom, warpDir: () => (warp.on ? warp.dir : player.fwd),
  land: landOn, landed: () => landing.on, settled: landSettled, takeOff, newBot, viewTarget,
  easy: EASY, demo: DEMO, mods: MODS, resetMods, fireMissile,
  pickup: (p) => { sfx.ping(p, 0.3); }, healFx: (sh) => { sparks(sh.obj.position, new THREE.Color(0x55ff99), 8); },
  milestone: () => { pulseFrame(new THREE.Color(0xffcc66), 0.8); burst(player.obj.position, 30, new THREE.Color(0xffcc66), 2 * S, 1.2); }, landSlots: () => {}, blast: outpostBlast,
  playerBullets: () => playerBullets.list, enemyBullets: () => enemyBullets.list,
  recordEndless, chime: () => sfx.chime(true), click: () => sfx.click(), faceSeat, placeSide: (m, side, w) => placeSide(m, side, w),
});
// Endless view centre: your ship / command point; split, 60 / 40 between the blue and gold command points;
// landed, the glide onto the star.
function viewTarget(out) {
  if (landing.on) return out.copy(landing.view);
  if (split && gameMode === 'squadron') return out.copy(player.obj.position).multiplyScalar(0.6).addScaledVector(cmdB.obj.position, 0.4);
  return out.copy(player.obj.position);
}
function placeSide(mesh, side, widthM) {
  const sc = board.scale.x;
  mesh.position.set(board.position.x + side * (HB.x * sc + 0.07 + widthM / 2), board.position.y + 0.03, board.position.z + HB.z * sc * 0.55);
  faceSeat(mesh);
}
function placeTutCard(mesh, widthM) {
  const sc = board.scale.x;
  _v1.copy(seat);
  const x = board.position.x + HB.x * sc + 0.04 + widthM / 2;
  const near = board.position.z + HB.z * sc, far = board.position.z - HB.z * sc;
  const z = clamp(_v1.z - Math.max(0.2, x - _v1.x) / Math.tan(0.56), far, near);
  mesh.position.set(x, Math.min(board.position.y, _v1.y - 0.12), z);
  faceSeat(mesh);
  mesh.scale.setScalar(clamp(mesh.position.distanceTo(_v1) / 1.05, 0.8, 2.4));
}
function placeTutBelow(mesh, heightM) {
  const sc = board.scale.x;
  const near = board.position.z + HB.z * sc;
  _v1.copy(seat);
  const z = near - 0.5 * 2 * HB.z * sc;
  const k = clamp(Math.hypot(_v1.z - z, _v1.y - (board.position.y - HB.y * sc)) / 1.0, 0.8, 2.2);
  mesh.scale.setScalar(k);
  mesh.position.set(board.position.x, board.position.y - HB.y * sc - 0.03 - (heightM * k) / 2, z);
  faceSeat(mesh);
  // Tilt it back so it faces your eyes.
  mesh.rotateX(-Math.atan2(_v1.y - mesh.position.y, Math.hypot(_v1.x - mesh.position.x, _v1.z - mesh.position.z)));
}
// Re-placed only when the room (position, size, shape) or the seat changes - not every frame.
let panelKey = '';
const menuHome = new THREE.Vector3(), menuFrom = new THREE.Vector3();
const menuAnim = { t: 1, dur: 0.3, slide: false, closing: false };
function placePanels() {
  const sc = board.scale.x, f = (v) => v.toFixed(4);
  const key = [board.position.x, board.position.y, board.position.z, sc, HB.x, HB.y, HB.z, seat.x, seat.y, seat.z].map(f).join(',') + (state === 'lobby');
  if (key !== panelKey) {
    panelKey = key;
    placeTutCard(tutorial.card.mesh, tutorial.card.widthM);
    placeTutBelow(tutorial.big.mesh, (tutorial.big.widthM * tutorial.big.H) / tutorial.big.W);
    placeSide(menuPanel, -1, MENU_M);
    ringUI.place();                                  // the ring, and the stats panel on the right
    E.place();                                       // the Endless dock / upgrade panel (right)
    menuHome.copy(menuPanel.position);
    panelMoves++;
  }
}
let panelMoves = 0;
// Settings panel: opening from the lobby slides it out of the ring's SETTINGS button to its spot on the left
// with a quick fade-in (0.3 s), so you see where it went; in a game it just fades in. Closing fades out.
function animateMenu(dt) {
  if (menuAnim.t >= 1 && !menuAnim.closing) { if (menuPanel.visible) { menuPanel.position.copy(menuHome); faceSeat(menuPanel); menuPanel.material.opacity = 1; } return; }
  menuAnim.t = Math.min(1, menuAnim.t + dt / menuAnim.dur);
  const u = menuAnim.t, e = 1 - Math.pow(1 - u, 3);          // ease-out
  if (menuAnim.closing) {
    menuPanel.material.opacity = 1 - u;
    if (u >= 1) { menuPanel.visible = false; menuAnim.closing = false; menuPanel.material.opacity = 1; }
    return;
  }
  if (menuAnim.slide) {
    menuPanel.position.lerpVectors(menuFrom, menuHome, e);
    menuPanel.position.z += Math.sin(u * Math.PI) * 0.12;      // a slight arc toward you, past the room
  } else menuPanel.position.copy(menuHome);
  faceSeat(menuPanel);
  menuPanel.material.opacity = Math.min(1, u * 1.6);
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
  // Split on desktop (tests): group B follows the same mouse orders.
  inputB.fire = input.fire; inputB.boost = input.boost; inputB.brake = input.brake;
  inputB.dir.copy(input.dir); inputB.hasSteer = true; mirrorQB.copy(mirrorQ);
  // +/- scale the box.
  if (keys.has('Equal')) { box.size *= 1.01; applyBoard(); }
  if (keys.has('Minus')) { box.size /= 1.01; applyBoard(); }

  if (DEMO && player.alive) {
    // Autopilot: chase the nearest enemy and shoot when lined up.
    let near = null, nd = Infinity;
    for (const e of enemies) { const d = e.obj.position.distanceTo(player.obj.position); if (d < nd) { nd = d; near = e; } }
    if (endless && state === 'playing' && (!near || nd > 7)) {
      // Endless: nothing close - fly to the next outpost (or a friendly one when hurt).
      E.autoTarget(_v2);
      input.origin.copy(player.obj.position);
      input.dir.subVectors(_v2, player.obj.position).normalize();
      input.fire = false; input.boost = _v2.distanceTo(player.obj.position) > 8;
    } else if (near) {
      input.origin.copy(player.obj.position);
      input.dir.subVectors(near.obj.position, player.obj.position).normalize();
      input.fire = gameMode === 'squadron' ? nd < 3.5 * S : player.fwd.angleTo(input.dir) < 0.3 && nd < 6 * S;
      input.boost = nd > 3 * S;
    }
  }
}

// ---------------------------------------------------------------- update
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

let prevBoostA = false, prevBoostB = false;
function updatePlayer(dt) {
  if (!player.alive || tutFreeze) return;
  const p = player.obj.position;
  const boosting = input.boost && !(gameMode === 'squadron' && input.fire);
  if (boosting && !prevBoostA && (state === 'playing' || state === 'tutorial')) sfx.whoosh();
  prevBoostA = boosting;
  const mode = activeSteer();
  pointer.visible = mode === 'point' || !!uiHit.right;
  if (mode === 'mirror' && lastFlyMode !== 'mirror') quatFromDir(player.fwd, player.mq);   // coming from another mode
  lastFlyMode = mode;
  if (mode === 'mirror') {
    reticle.visible = false;
    if (input.hasSteer && !landing.on) flyMirror(dt);   // (landed: steering does nothing until LAUNCH)
  } else {
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
    if (!landing.on) steer(player, desired.clone(), dt);
  }
  if (warp.on && !landing.on) { warpMove(dt); if (gameMode !== 'squadron') playerFx(dt); return; }   // (v34)
  if (landing.on && landedMove(p, dt)) {                    // Endless: sitting on a star
    if (gameMode === 'squadron') return;
  } else if (gameMode === 'squadron') {
    // The command point: boost only while NOT engaging (the bots all boost with it); slow while engaged.
    const targetSpeed = (input.fire ? CRUISE * 0.55 : input.boost ? BOOST : input.brake ? BRAKE : CRUISE) * MODS.speed;
    player.speed += (targetSpeed - player.speed) * Math.min(1, dt * 3);
    player.vel.copy(player.fwd).multiplyScalar(player.speed);
    p.addScaledVector(player.vel, dt);
    wrapBox(p);
    obstPushOut(p, 0.15 * S);
    return;
  }
  if (!landing.on) {
    const targetSpeed = (input.boost ? BOOST : input.brake ? BRAKE : CRUISE) * MODS.speed;
    player.speed += (targetSpeed - player.speed) * Math.min(1, dt * 3);
    player.vel.copy(player.fwd).multiplyScalar(player.speed);
    p.addScaledVector(player.vel, dt);
    if (wrapBox(p)) { resetTrail(); blink(p, PLAYER_COLOR); }
    if (endless) obstPushOut(p, 0.12 * S);            // stars and rocks are solid
  }

  // Shooting, with gentle aim assist toward an enemy inside a narrow cone.
  player.fireCd -= dt;
  if (input.fire && player.fireCd <= 0 && combat() && !tutFreeze && !landing.on) {
    shotsFired++;
    fireShot(p);
    sfx.laser(p);
    haptic('right', 0.25, 20);
    player.fireCd = 0.14 * fireMul;
  }
  playerFx(dt);
}
// One shot from the player's ship, with gentle aim assist toward an enemy inside a narrow cone.
function fireShot(p) {
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
  friendlyShot(_v3.copy(p).addScaledVector(player.fwd, 0.2 * S), dir.multiplyScalar(7 * S).addScaledVector(player.vel, 0.5), 1.6);
}
// The ship's invulnerability blink, hit flash and engine trail.
function playerFx(dt) {
  const p = player.obj.position;
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

// Group B's command point (split squadron): the left hand's mirror steering (or pointing in the other modes).
function updateCmdB(dt) {
  if (!split) return;
  const c = cmdB, p = c.obj.position;
  if (activeSteer() === 'mirror') {
    c.mq.slerp(mirrorQB, 1 - Math.exp(-dt / 0.065)).normalize();
    c.fwd.set(0, 0, 1).applyQuaternion(c.mq);
    c.obj.quaternion.copy(c.mq);
  } else if (inputB.hasSteer) {
    steer(c, inputB.dir.clone(), dt);
    c.mq.copy(c.obj.quaternion);
  }
  const boosting = inputB.boost && !inputB.fire;
  if (boosting && !prevBoostB && state === 'playing') sfx.whoosh(0.7);
  prevBoostB = boosting;
  const ts = (inputB.fire ? CRUISE * 0.55 : inputB.boost ? BOOST : inputB.brake ? BRAKE : CRUISE) * MODS.speed;
  c.speed += (ts - c.speed) * Math.min(1, dt * 3);
  p.addScaledVector(c.fwd, c.speed * dt);
  wrapBox(p);
  obstPushOut(p, 0.15 * S);
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
        if (t.alive && segPointDist(b.prev, b.pos, t.obj.position) < (t.radius || 0.14 * S)) { b.dead = true; damageTarget(t, b); break; }
      }
    }
  }
  for (const b of playerBullets.list) {
    if (b.dead) continue;
    for (const e of enemies) {
      if (e.hp > 0 && !(b.hit && b.hit.has(e)) && segPointDist(b.prev, b.pos, e.obj.position) < e.radius) {
        if (b.pierce > 0) { b.pierce--; (b.hit || (b.hit = new Set())).add(e); } else b.dead = true;   // (Endless piercing)
        if (state !== 'lobby') sparks(b.pos, e.color, 6);
        damageEnemy(e, b.dmg || 1);
        if (b.dead) break;
      }
    }
  }
  if (player.alive && !sq) {
    for (const b of enemyBullets.list) {
      if (segPointDist(b.prev, b.pos, player.obj.position) < 0.14 * S) {
        b.dead = true;
        damagePlayer(b);
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
  } else if (!menuOpen && !(endless && E.paused())) {
    updateMorph(dt);
    updateStars(dt);
    updatePlayer(dt);
    if (gameMode === 'squadron') updateCmdB(dt);
    refreshFriends();
    if (gameMode === 'squadron') { if (landing.on) holdLanded(dt); else if (warp.on) warpBots(dt); else updateBots(dt); }
    updateEnemies(dt);
    playerBullets.update(dt);
    enemyBullets.update(dt);
    updateCollisions();
    if (endless) E.update(dt);
    if (state === 'tutorial') tutorial.update(dt);
    else if (state === 'playing') {
      addPlayTime(endless ? 'endless' : gameMode, dt);
      if ((statsSaveT += dt) > 15) { statsSaveT = 0; saveStats(); }
      if (enemies.length === 0 && !endless) {
        if (intermission <= 0) {
          // Round cleared: bonus, the stars fade out and the room reshapes; then a fresh battle starts.
          intermission = 3.2;
          morphTo(pickShape(_shapeTmp), 2.4);
          starTarget = 0;
          const bonus = 500 * wave;
          score += bonus;
          saveBest();
          showMessage(`ROUND ${wave} CLEARED`, `+${fmtNum(bonus)} round bonus - next: a fresh battle, full strength`, 2.8);
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
  updateWarpFx(dt);
  updateParticles(dt);
  killHeat *= Math.exp(-dt / 7);
  if (msgTime > 0 && msgTime < 9000) { msgTime -= dt; if (msgTime <= 0) hideMessage(); }
}
// Music: calm pad in the lobby / tutorial / game over; the battle track while playing, louder and busier
// with more enemies alive and with a kill streak going.
function updateMusic() {
  const m = sfx.music;
  if (!m) return;
  m.setMode(state === 'playing' ? 'battle' : 'lobby');
  const busy = intermission > 0 ? 0 : Math.min(1, enemies.length / 12);
  m.setIntensity(intermission > 0 ? 0.1 : 0.12 + busy * 0.55 + Math.min(1, killHeat / 5) * 0.4 + (endless && state === 'playing' ? E.musicBoost() : 0));
  if (sfx.ctx.state === 'running') m.update();
}

let hudTimer = 0, statusTimer = 0, frames = 0;
let lastT = performance.now();
const perf = { cpu: 0, render: 0, n: 0, fps: 0, cpuMs: 0, renderMs: 0 };
let screenSaveT = 0;
function loop() {
  const now = performance.now();
  const dt = Math.min((now - lastT) / 1000, 0.05);
  lastT = now;
  frames++;
  const xr = renderer.xr.isPresenting;

  if (xr) gatherInputVR(dt); else gatherInputDesktop();
  if (xr) {   // screen time: every second spent in the headset, lobby and tutorial included
    stats.screen += dt;
    if ((screenSaveT += dt) > 15) { screenSaveT = 0; saveStats(); }
    if (state === 'lobby' && fmtTime(stats.screen) !== screenShown) drawLobby();   // tick the lobby's Screen time row
  }
  updateCameraRig(dt);
  camera.getWorldPosition(camPos);
  camera.getWorldDirection(camFwd);
  sfx.setListener(camPos, camFwd, UP);
  stars.position.copy(camPos);
  grid.position.x = Math.round(camPos.x / GRID_STEP) * GRID_STEP;
  grid.position.z = Math.round(camPos.z / GRID_STEP) * GRID_STEP;

  camera.getWorldQuaternion(camQ);
  hitStopCd = Math.max(0, hitStopCd - dt);
  if (hitStopT > 0) hitStopT -= dt;                 // freeze-frame: the battle pauses for a moment
  else { const ts = timeScale(); for (let k = 0; k < SIM; k++) simStep(dt * ts); }
  slowT = Math.max(0, slowT - dt);
  updateMusic();
  if (endless) world.position.set(-VC.x, -VC.y, -VC.z); else world.position.set(0, 0, 0);
  playerBullets.sync();
  enemyBullets.sync();
  updateSeat();
  placePanels();
  ringUI.frame(dt);
  updateLobbyFade(dt);
  animateMenu(dt);
  if (xr) updateRays(dt);
  { const tn = performance.now() / 1000; touch.left.update(tn); touch.right.update(tn); }
  touch.right.setTag('btn2', endless && state === 'playing' && !tutFreeze ? (warp.on ? 'B DROP' : 'B WARP') : null);   // (v35)
  reticle.lookAt(camPos);
  hudPanel.visible = state !== 'lobby' && state !== 'tutorial';

  // Red screen flash on hit (desktop overlay); in VR the edge vignette (hits from behind).
  screenFlash = Math.max(0, screenFlash - dt);
  document.getElementById('flash').style.opacity = String(screenFlash * 2);
  vigAmt = Math.max(0, vigAmt - dt * 2.2);
  vignette.visible = xr && vigAmt > 0.01;
  vignette.material.opacity = Math.min(0.85, vigAmt);
  // The room frame pulse.
  framePulse = Math.max(0, framePulse - dt * 2.5);
  const fe = boxFrame.userData.edges.material;
  fe.color.copy(FRAME_COLOR).lerp(framePulseCol, Math.min(1, framePulse));
  fe.opacity = (0.7 + 0.3 * Math.min(1, framePulse)) * (simFade.frame ? simFade.v : 1);   // (fades with the lobby backdrop to / from Endless)

  hudTimer -= dt;
  if (hudTimer <= 0) { hudTimer = 0.1; drawHud(); ringUI.drawGame(); }

  if (TEST) {
    statusTimer -= dt;
    if (statusTimer <= 0) {
      statusTimer = 3;
      perf.fps = frames / 3;
      perf.cpuMs = perf.cpu / Math.max(1, perf.n); perf.renderMs = perf.render / Math.max(1, perf.n);
      log(`status mode=${gameMode} state=${state} wave=${wave} score=${score} kills=${kills} hp=${player.hp} bots=${bots.filter((b) => b.alive).map((b) => b.hp).join('')} enemies=${enemies.length} fps~${Math.round(perf.fps)} cpu=${perf.cpuMs.toFixed(2)}ms render=${perf.renderMs.toFixed(2)}ms xr=${xr}`);
      frames = 0; perf.cpu = perf.render = perf.n = 0;
    }
  }
  const t1 = performance.now();
  renderer.render(scene, camera);
  if (TEST) { perf.cpu += t1 - now; perf.render += performance.now() - t1; perf.n++; }
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
  get steerMode() { return activeSteer(); },
  settings, setSetting, input, board, box, mirrorQ, bots, obstacles, groups,
  get mode() { return gameMode; }, get boxB() { return BOX_B; }, HB, get morphing() { return morphT < 1; }, AI, bestRound, damageBot, get msgTitle() { return msgTitle; }, get msgOn() { return msgTime > 0; }, get msgSub() { return msgSub; }, get starsOn() { return starsOn; }, get starAlpha() { return starAlpha; }, startRound, hudPanel, get friends() { return friends; }, get squadEngaged() { return squadEngaged; },
  get lobbyPanel() { return ringUI.lobby; }, get ring() { return ringUI; }, get lobbySim() { return lobbySim; }, simFade, lobbyEnd, boxFrame, landing, takeOff, setPanelYawLegacy: (v) => { panelYawLegacy = v; panelKey = ''; placePanels(); }, panelYaw, seatPos: seat, resetBox, BOX_DEFAULT, viewTarget, MODS, fireMissile, friendlyShot, get playerBulletsList() { return playerBullets.list; }, newBot, slotPos, get formationName() { return formation; }, setFormation: (f) => { formation = f; }, get trailVisible() { return trail.visible; }, gameOver, get msgTime() { return msgTime; }, SETTINGS_DEF, tutorial, enterLobby, startTutorial, finishTutorial, stats, recordGame, leaveGame, grab, uiHit, placePanels, grabGain,
  get simTime() { return simTime; }, menuLayout, get kills() { return kills; },
  get tutStage() { return tutStageName; }, get tutFreeze() { return tutFreeze; }, get shots() { return shotsFired; },
  tutorialDone, spawnTut, setTutStage: tutStage, applyBoard, drawMenu, touch, get hudVisible() { return hudPanel.visible; }, get menuCanvas() { return menuCanvas; }, MENU_TOP, MENU_ROW, MENU_ROWS,
  startGameAt(mode, round) { settings.mode = mode; startGame(round); }, damagePlayer, world, VC, get endless() { return endless; }, get E() { return E; }, get playerMax() { return playerMax; }, get botMax() { return botMax; }, get fireMul() { return fireMul; }, damageBot, setControls: (m) => setEndlessControls(m),
  get enemyBullets() { return enemyBullets.list.length; }, get bullets() { return playerBullets.list.length; }, toggleSettings, get menuOpen() { return menuOpen; }, get menuHover() { return menuHover; }, menuPanel, seat, rayFx, get panelMoves() { return panelMoves; }, menuAnim,
  // v18
  get warp() { return warp; }, sfx, mirrorQ, touch, slowMo, timeScale, wfx, wfxGroup, wfxLines, squadToFighter, warpToggle, warpOff, winGame, get won() { return won; }, get hudLayout() { return hudLayout; }, get hudMinBox() { return hudMinBox; }, drawHud,
  get split() { return split; }, setSplit, get formation() { return formation; }, cycleFormation, cmdB, GA, GB, SQUAD, inputB,
  aces, spawnAce, sfx, perf, get hitStops() { return hitStops; }, get edgeFlashes() { return edgeFlashes; }, liveParticles,
  get killHeat() { return killHeat; }, roster, eb: enemyBullets, pb: playerBullets, SL_X0, SL_X1, cycleSetting, mNeutralQ, mirrorQB, steerA, steerB, get xSplitPending() { return xDown; }, damageEnemy, get framePulse() { return framePulse; },
};
