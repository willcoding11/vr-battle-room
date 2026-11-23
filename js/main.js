// BATTLE ROOM - a seated, tabletop (diorama) wireframe space battle for WebXR (Meta Quest)
// with a mouse + keyboard fallback for desktop browsers.
import * as THREE from '../vendor/three.module.js';
import { VRButton } from '../vendor/VRButton.js';
import { buildPlayerShip, buildFighter, buildCruiser, buildControllerGizmo, tintShip } from './models.js?v=11';
import { Sfx } from './audio.js?v=11';

const TEST = /[?&]test/.test(location.search);
const DEMO = /[?&]demo/.test(location.search);          // autopilot (attract mode / testing)
const START_WAVE = Math.max(1, parseInt(new URLSearchParams(location.search).get('wave'), 10) || 1);
const log = (m) => { if (TEST && window.__log) window.__log(m); };

// ---------------------------------------------------------------- constants
const S = 0.5;                                    // world scale: everything is "zoomed out" to half size
const HEAD_H = 1.2;                               // seated eye height (desktop)
const ARENA_C = new THREE.Vector3(0, 0, 0);       // battle centre = centre of the box (game units)
// Battle box half-size in game units. The box keeps its physical size in front of you, so a bigger
// BOX_B = more room relative to the ships. Fighter: 2.8 (was 1.75). Squadron: zoomed out much further.
const MODE_BOX = { fighter: 2.8, squadron: 5.0, fleet: 7.5 };
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
  { key: 'mode', label: 'Game mode', opts: [['fighter', 'Fighter'], ['squadron', 'Squadron'], ['fleet', 'Fleet']] },
  { key: 'steer', label: 'Steering', opts: [['mirror', 'Mirror (ship = controller)'], ['relative', 'Relative (hand stick)'], ['point', 'Point'], ['stick', 'Thumbstick']] },
  { key: 'steerGain', label: 'Mirror gain (Fighter)', opts: GAIN_OPTS },
  { key: 'steerGainSq', label: 'Mirror gain (Squadron)', opts: GAIN_OPTS },
  { key: 'turnSpeed', label: 'Ship turn speed', opts: [['normal', 'Normal'], ['fast', 'Fast'], ['veryfast', 'Very fast']] },
  { key: 'boxSize', label: 'Box size', opts: [['small', 'Small'], ['medium', 'Medium'], ['large', 'Large']] },
  { key: '_box', label: 'Box position', opts: [], action: 'RESET' },     // an action, not a stored setting
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
const vrButton = VRButton.createButton(renderer);
vrButton.id = 'vrbutton';
document.body.appendChild(vrButton);

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
  spawn(pos, vel, life) {
    if (this.list.length >= this.max) return;
    this.list.push({ pos: pos.clone(), prev: pos.clone(), vel: vel.clone(), life, dead: false });
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
{
  // All spheres. Positions are FRACTIONS of the room's half-extents, so the stars spread out or
  // squeeze together with the room's shape (and glide with it when it changes between waves).
  const layout = [
    [-0.44, 0.16, -0.3, 0.6], [0.48, -0.2, -0.44, 0.7], [0.04, 0.4, 0.12, 0.55],
    [-0.32, -0.38, 0.26, 0.6], [0.42, 0.28, 0.4, 0.55], [0.24, -0.18, -0.68, 0.6],
    [-0.62, 0.44, 0.52, 0.5], [-0.6, -0.24, -0.64, 0.55],
  ];
  const mat = new THREE.LineBasicMaterial({ color: 0x9fb8dd, transparent: true, opacity: 0.6 });
  for (const [x, y, z, r] of layout) {
    const g = new THREE.LineSegments(new THREE.WireframeGeometry(new THREE.IcosahedronGeometry(r, 1)), mat);
    obstacleGroup.add(g);
    obstacles.push({ type: 'sphere', n: new THREE.Vector3(x, y, z), c: new THREE.Vector3(), r, R: r, r0: r, g });
  }
  obstacleGroup.visible = false;
}
function layoutObstacles() {
  const rs = gameMode === 'fleet' ? 1.4 : 1;        // bigger stars in the bigger Fleet room (cover for capital ships)
  for (const o of obstacles) { o.r = o.R = o.r0 * rs; o.g.scale.setScalar(rs); o.c.copy(o.n).multiply(HB); o.g.position.copy(o.c); }
}
OBST_READY = true;
layoutObstacles();
const _ob = new THREE.Vector3(), _ob2 = new THREE.Vector3(), _ob3 = new THREE.Vector3();
function inObst(o, p, pad = 0) {
  if (o.type === 'cube') return Math.abs(p.x - o.c.x) < o.r + pad && Math.abs(p.y - o.c.y) < o.r + pad && Math.abs(p.z - o.c.z) < o.r + pad;
  return p.distanceTo(o.c) < o.r + pad;
}
function obstInside(p, pad = 0) {
  if (!teamMode()) return null;
  for (const o of obstacles) if (inObst(o, p, pad)) return o;
  return null;
}
// Push a ship (radius rad) out of any obstacle it has run into.
function obstPushOut(p, rad) {
  if (!teamMode()) return false;
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
  if (!teamMode()) return false;
  for (const o of obstacles) {
    if (segPointDist(a, b, o.c) > o.R) continue;
    const n = Math.max(2, Math.ceil(a.distanceTo(b) / 0.1));
    for (let i = 0; i <= n; i++) if (inObst(o, _ob3.lerpVectors(a, b, i / n))) return true;
  }
  return false;
}
// Steer around obstacles ahead (adds a push to `desired`).
function obstAvoid(p, fwd, speed, desired) {
  if (!teamMode()) return;
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
  if (!teamMode()) return null;
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
// Everyone leads their shots and pulls back for a moment when damaged. In Squadron the attack
// groups focus fire on the most exposed bot, and enemies fall back to cover when outnumbered.
const enemies = [];
const groups = [];
const ROLE_STATS = {
  pincer: { hp: 2, speed: 1.2, turn: 1.9, fire: 2.2, range: 4.0, acc: 0.2 },
  flank: { hp: 2, speed: 1.3, turn: 2.0, fire: 2.0, range: 4.0, acc: 0.2 },
  sniper: { hp: 2, speed: 0.95, turn: 1.8, fire: 2.6, range: 7.0, acc: 0.06 },
  heavy: { hp: 5, speed: 0.7, turn: 0.9, fire: 3.0, range: 5.5, acc: 0.15 },
  bait: { hp: 2, speed: 1.4, turn: 2.2, fire: 2.6, range: 3.5, acc: 0.3 },
  ambush: { hp: 2, speed: 1.3, turn: 2.0, fire: 1.8, range: 4.0, acc: 0.15 },
  escort: { hp: 2, speed: 1.25, turn: 2.0, fire: 2.0, range: 4.0, acc: 0.18 },
};
function liveTargets() {
  if (teamMode()) return friends;
  return player.alive ? [player] : [];
}
function spawnGroup(role, n, wave, cap = null) {
  const g = { role, members: [], t: rand(0, 1.5), focus: null, focusT: 0, ambushPt: null, sprung: false, lureDone: false, cap };
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
  if (cap) best = cap.obj.position.clone();         // escorts start beside their flagship
  if (role === 'bait') g.ambushPt = coverPoint(ref, best, new THREE.Vector3()) || best.clone().multiplyScalar(0.8);
  for (let i = 0; i < n; i++) {
    const pos = best.clone().add(_v1.randomDirection().multiplyScalar(0.4 * S));
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
    acc: st.acc * S * Math.max(0.4, 1 - wave * 0.06),
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
  for (let i = groups.length - 1; i >= 0; i--) {
    const g = groups[i];
    g.members = g.members.filter((e) => e.hp > 0);
    if (!g.members.length) { groups.splice(i, 1); continue; }
    g.t += dt;
    g.focusT -= dt;
    if (g.focusT <= 0 || !g.focus || !g.focus.alive) {
      g.focusT = 3;
      if (g.role === 'sniper' || g.role === 'heavy' || g.role === 'bait') g.focus = nearestTo(centroid(g.members, _v3), tg);
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
const _eg = new THREE.Vector3(), _es = new THREE.Vector3(), _ed = new THREE.Vector3(), _ea = new THREE.Vector3();
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
    if (sq && (e.outnumT -= dt) <= 0) {
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
      // Retreat: behind the nearest star (Squadron), or straight away from the threat.
      if (!coverPoint(T.obj.position, p, goal)) {
        goal.copy(p).addScaledVector(_es.subVectors(p, T.obj.position).normalize(), 2.5 * S);
        clampIn(goal);
      }
    } else {
      const Tp = T.obj.position, Tf = T.fwd;
      const dist = p.distanceTo(Tp);
      switch (e.role) {
        case 'pincer': {
          // Swing wide to opposite sides of the target, then both attack at once.
          if (g.t % 7 < 4) {
            sideOf(Tf, _es);
            goal.copy(Tp).addScaledVector(_es, e.side * 2.0 * S).addScaledVector(Tf, 0.8 * S);
            clampIn(goal);
          } else mode = 'attack';
          break;
        }
        case 'flank': {
          // Circle round to the side / rear, then attack; members are staggered.
          if ((g.t + (e.side > 0 ? 0 : 1.2)) % 7.5 < 4.5 && dist > 0.9 * S) {
            sideOf(Tf, _es);
            goal.copy(Tp).addScaledVector(Tf, -1.6 * S).addScaledVector(_es, e.side * 1.3 * S);
            clampIn(goal);
          } else mode = 'attack';
          break;
        }
        case 'sniper':
        case 'heavy': {
          const peek = Math.floor((g.t + (e.side > 0 ? 0 : 1.5)) / 3) % 2 === 1;
          if (e.role === 'sniper' && coverPoint(Tp, p, goal)) {
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
        case 'escort': {
          // Guard the flagship: circle it, and pounce on anything of yours that comes close to it.
          const cap = g.cap;
          if (!cap || !cap.alive) { e.role = 'flank'; break; }
          const threat = nearestTo(cap.obj.position, tg);
          if (threat && threat.obj.position.distanceTo(cap.obj.position) < 3.2 * S) { e.target = T = threat; mode = 'attack'; break; }
          const a = g.t * 0.5 + (e.side > 0 ? 0 : Math.PI);
          goal.copy(cap.obj.position).add(_es.set(Math.cos(a), 0.3 * Math.sin(a * 0.7), Math.sin(a)).multiplyScalar(1.3 * S));
          break;
        }
        case 'ambush': {
          if (g.sprung) mode = 'attack';
          else { goal.copy(g.ambushPt); if (p.distanceTo(goal) < 0.6 * S) mode = 'aim'; }
          break;
        }
      }
    }
    const bulletSpeed = (e.role === 'sniper' ? 4.4 : 3.0 + wave * 0.12) * S;
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
    // Fleet: steer clear of capital ships (both sides) instead of flying through them.
    if (gameMode === 'fleet') {
      for (const c of [...FLEET_CAPS, ...enemyCaps]) {
        if (!c.alive) continue;
        const d = p.distanceTo(c.obj.position), min = c.radius + 0.4 * S;
        if (d < min && d > 1e-4) desired.addScaledVector(_v1.subVectors(p, c.obj.position).normalize(), ((min - d) / min) * 4);
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
    if (T && state === 'playing' && e.fireCd <= 0 && e.spawnFade >= 1 && e.retreatT <= 0) {
      leadPoint(p, T, bulletSpeed, _ea).add(_v3.randomDirection().multiplyScalar(e.acc));
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
    score += e.points * wave;
    kills++;
    haptic('right', 0.6, 60);
  } else {
    // Damaged: pull back for a moment before coming in again.
    if (e.retreatCd <= 0) { e.retreatT = 2.0; e.retreatCd = 4; }
    sfx.ping(e.obj.position);
    if (gameMode === 'fighter') haptic('right', 0.3, 25);
  }
}
function damageTarget(t) { if (t === player) damagePlayer(); else if (t.kind === 'capital') damageCapital(t); else damageBot(t); }

// ---------------------------------------------------------------- friendly squadrons (Squadron + Fleet)
// A squad = 4 bot fighters that fly around an invisible ANCHOR (the squad's command point). The
// anchor's heading is the order; the bots fly their own ships: formation, engage, dodge, separation.
// Squadron mode has one squad whose anchor is the (invisible) player ship. Fleet mode has three
// colour-coded squads plus two friendly capital ships, all commandable.
const BOT_N = 4, BOT_HP = 3, BOT_SPACING = 0.6 * S, LEASH = 2.2 * S, BOT_RANGE = 4.5 * S;
const CAP_SCALE = 2.4, CAP_HP = 60, CAP_SPEED = 0.4 * S, CAP_BOOST = 0.7 * S, CAP_RADIUS = 0.75 * S;
function teamMode() { return gameMode === 'squadron' || gameMode === 'fleet'; }
function makeSquad(name, color) {
  const sq = {
    name, kind: 'squad', color: new THREE.Color(color), bots: [], anchor: new THREE.Vector3(), fwd: new THREE.Vector3(0, 0, -1),
    q: new THREE.Quaternion(), right: new THREE.Vector3(1, 0, 0), speed: CRUISE, engaged: false, prefTarget: null,
    order: { type: 'move', point: new THREE.Vector3(), target: null }, radius: 0.9 * S,
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
const FLEET_SQUADS = [makeSquad('BLUE', 0x3d8bff), makeSquad('GREEN', 0x44ff88), makeSquad('GOLD', 0xffcc33)];
const FRIEND_CAP_COLOR = new THREE.Color(0xa8f0ff);

// ---------------------------------------------------------------- capital ships (both sides, Fleet)
// Big, slow, tough; turrets fire automatically at the nearest foe in range (clear line only).
function makeHealthBar(color) {
  const g = new THREE.Group();
  const bg = new THREE.Mesh(new THREE.PlaneGeometry(1, 0.1), new THREE.MeshBasicMaterial({ color: 0x223344, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false }));
  const fill = new THREE.Mesh(new THREE.PlaneGeometry(1, 0.1), new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, depthWrite: false }));
  fill.position.z = 0.001;
  g.add(bg, fill);
  g.userData.fill = fill;
  g.visible = false;
  board.add(g);
  return g;
}
function makeCapital(name, side) {
  const color = side === 'friend' ? FRIEND_CAP_COLOR : ENEMY_COLOR;
  const obj = shrink(buildCruiser(color.getHex()));
  obj.scale.setScalar(S * CAP_SCALE);
  obj.userData.ptBase *= CAP_SCALE;
  obj.userData.mats[1].size *= CAP_SCALE;
  obj.visible = false;
  board.add(obj);
  return {
    name, kind: 'capital', side, color: color.clone(), obj, fwd: new THREE.Vector3(0, 0, -1), q: new THREE.Quaternion(), bank: 0, turn: 0.55,
    speed: CAP_SPEED, hp: CAP_HP, maxHp: CAP_HP, radius: CAP_RADIUS, alive: false, flash: 0, spawnFade: 1, engaged: false, prefTarget: null,
    turrets: [{ off: new THREE.Vector3(0.12, 0.1, 0.1), cd: 1 }, { off: new THREE.Vector3(-0.12, 0.1, -0.1), cd: 1.4 }, { off: new THREE.Vector3(0, 0.12, -0.3), cd: 1.8 }],
    order: { type: 'move', point: new THREE.Vector3(), target: null }, bar: makeHealthBar(side === 'friend' ? 0x66ddff : 0xff4455), t: rand(0, 5),
  };
}
const FLEET_CAPS = [makeCapital('CAPITAL 1', 'friend'), makeCapital('CAPITAL 2', 'friend')];
const UNITS = [...FLEET_SQUADS, ...FLEET_CAPS];
const enemyCaps = [makeCapital('FLAGSHIP', 'enemy'), makeCapital('FLAGSHIP 2', 'enemy')];
function unitAlive(u) { return u.kind === 'capital' ? u.alive : u.bots.some((b) => b.alive); }
function unitCenter(u) { return u.kind === 'capital' ? u.obj.position : u.anchor; }
function unitSpeed(u) { return u.speed; }

// Everything on our side that is alive this frame (for targeting, friendly-fire and collision checks).
let friends = [];
function refreshFriends() {
  friends = [];
  if (gameMode === 'squadron') { for (const b of bots) if (b.alive) friends.push(b); }
  else if (gameMode === 'fleet') {
    for (const sq of FLEET_SQUADS) for (const b of sq.bots) if (b.alive) friends.push(b);
    for (const c of FLEET_CAPS) if (c.alive) friends.push(c);
  }
}
function foesList() {
  const l = enemies.filter((e) => e.hp > 0);
  for (const c of enemyCaps) if (c.alive) l.push(c);
  return l;
}
function friendsInLine(self, aim) {
  for (const o of friends) {
    if (o === self) continue;
    if (segPointDist(self.obj.position, aim, o.obj.position) < 0.25 * S + (o.radius || 0)) return true;
  }
  return false;
}

const _bR = new THREE.Vector3(), _bS = new THREE.Vector3(), _bD = new THREE.Vector3(), _bT = new THREE.Vector3(), _bQ = new THREE.Quaternion();
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
function reviveBot(sq = SQUAD) {
  const b = sq.bots.find((x) => !x.alive);
  if (!b) return false;
  b.alive = true; b.hp = BOT_HP; b.invuln = 1.5; b.obj.visible = true; b.speed = CRUISE;
  placeBot(sq, b, 0, 1);
  b.obj.position.addScaledVector(sq.fwd, -0.6 * S);
  blink(b.obj.position, sq.color);
  return true;
}
// Resolve a squad's preferred target (an enemy ship, an enemy capital, or an enemy group) to a ship.
function resolveTarget(t, near) {
  if (!t) return null;
  if (t.members) { const alive = t.members.filter((e) => e.hp > 0); return alive.length ? nearestTo(near, alive) : null; }
  if (t.kind === 'capital') return t.alive ? t : null;
  return t.hp > 0 ? t : null;
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
      // ENGAGE: the ordered target if it's within reach, otherwise the nearest enemy near the group...
      let best = resolveTarget(sq.prefTarget, p), bd = best ? best.obj.position.distanceTo(p) : Infinity;
      if (best && best.obj.position.distanceTo(anchor) > LEASH + BOT_RANGE) { best = null; bd = Infinity; }
      if (!best) {
        for (const e of foes) {
          if (e.spawnFade < 0.5) continue;
          const d = e.obj.position.distanceTo(p);
          if (e.obj.position.distanceTo(anchor) < LEASH + BOT_RANGE && d < bd) { bd = d; best = e; }
        }
      }
      b.target = best;
      if (best) {
        leadPoint(p, best, 7 * S, _bT);
        desired.subVectors(_bT, p).normalize();
        if (bd < 0.7 * S + (best.kind === 'capital' ? best.radius : 0)) { sideOf(b.fwd, _bS); desired.addScaledVector(_bS, b.side * 1.5); }   // don't ram it
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
    // Separation: never run into a friendly ship (wingmen, other squads, capital ships).
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
    if (engaged && b.target && b.fireCd <= 0 && state === 'playing') {
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
      if (o.kind === 'capital') a.addScaledVector(_bS, (min - d) / d);           // capital ships don't get shoved
      else { _bS.multiplyScalar((min - d) / (2 * d)); a.add(_bS); c.sub(_bS); }
    }
  }
}
// Squadron mode: one squad, commanded through the player ship.
function updateBots(dt) {
  syncSquadToPlayer();
  SQUAD.engaged = squadEngaged = input.fire && state === 'playing';
  updateSquad(SQUAD, dt);
}
function damageBot(b) {
  if (!b.alive || b.invuln > 0 || state !== 'playing') return;
  b.hp--;
  b.invuln = 0.6;
  b.flash = 0.2;
  sfx.ping(b.obj.position);
  haptic('left', 0.4, 40);
  if (b.hp > 0) return;
  const sq = b.unit;
  b.alive = false;
  b.obj.visible = false;
  explode(b.obj, sq.color, _v1.copy(b.fwd).multiplyScalar(b.speed), true);
  sfx.boom(b.obj.position, true);
  haptic('right', 1.0, 160);
  screenFlash = 0.25;
  const left = sq.bots.filter((x) => x.alive).length;
  if (gameMode === 'fleet') {
    showMessage(left ? `${sq.name} SHIP DOWN` : `${sq.name} LOST`, left ? `${left} left in ${sq.name}` : 'Squadron destroyed', 1.6);
    if (!left) selected.delete(sq);
    return;
  }
  if (left > 0) { showMessage('WINGMAN DOWN', `${left} ship${left > 1 ? 's' : ''} left`, 1.6); return; }
  gameOver('SQUADRON LOST');
}
function gameOver(title) {
  player.alive = false;
  player.obj.visible = false;
  sfx.chime(false);
  state = 'gameover';
  stateTimer = 0;
  best = Math.max(best, score);
  try { localStorage.setItem('battleRoomBest', String(best)); } catch (e) { /* ignore */ }
  showMessage(title, `Score ${score}   Wave ${wave}   Best ${best}\n${restartHint()}`, 9999);
}

// ---------------------------------------------------------------- Fleet: units, selection, orders
const selected = new Set();
const BOX_FWD_Q = new THREE.Quaternion();
quatFromDir(new THREE.Vector3(0, 0, -1), BOX_FWD_Q);
// Unit markers: a selection / hover ring (faces you) and a faint order line.
for (const u of UNITS) {
  const pts = [];
  for (let i = 0; i < 40; i++) { const a = (i / 40) * Math.PI * 2; pts.push(new THREE.Vector3(Math.cos(a), Math.sin(a), 0)); }
  u.ring = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: u.color, transparent: true, opacity: 0.9, depthWrite: false }));
  u.ring.scale.setScalar(u.kind === 'capital' ? 1.15 * S : 0.95 * S);
  u.ring.visible = false;
  u.line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
    new THREE.LineBasicMaterial({ color: u.color, transparent: true, opacity: 0.35, depthWrite: false }));
  u.line.frustumCulled = false;
  u.line.visible = false;
  board.add(u.ring, u.line);
}
// Take command of a unit: the controller's current pose now means "the unit's current heading",
// so nothing jumps when you switch between units.
function adoptCommand(u) {
  const q = u.kind === 'capital' ? quatFromDir(u.fwd, _bQ) : u.q;
  player.mq.copy(q); player.obj.quaternion.copy(q);
  player.fwd.set(0, 0, 1).applyQuaternion(q);
  SHIP_NEUTRAL_Q.copy(q); mirrorQ.copy(q);
  needNeutral = true;                                // the next VR frame captures the controller pose
}
function selectUnits(list, quiet) {
  selected.clear();
  for (const u of list) if (unitAlive(u)) { selected.add(u); u.order.type = 'move'; u.prefTarget = null; }
  const first = [...selected][0];
  if (first) adoptCommand(first);
  if (!quiet) showMessage('SELECTED', selected.size === UNITS.filter(unitAlive).length ? 'Whole fleet' : [...selected].map((u) => u.name).join(', '), 1.2);
  haptic('left', 0.3, 30);
}
function resetFleet() {
  const on = gameMode === 'fleet';
  FLEET_SQUADS.forEach((sq, i) => {
    sq.anchor.set((i - 1) * 1.6 * S, (i - 1) * 0.3 * S, HB.z * 0.45);
    sq.fwd.set(0, 0, -1); sq.q.copy(BOX_FWD_Q); sq.right.set(1, 0, 0).applyQuaternion(sq.q);
    sq.speed = CRUISE; sq.engaged = false; sq.prefTarget = null; sq.order.type = 'move';
    resetSquad(sq, on);
  });
  FLEET_CAPS.forEach((c, i) => resetCapital(c, on, new THREE.Vector3((i ? 1 : -1) * 1.4 * S, -0.6 * S, HB.z * 0.65), new THREE.Vector3(0, 0, -1)));
  for (const c of enemyCaps) resetCapital(c, false);
  for (const u of UNITS) { u.ring.visible = false; u.line.visible = false; }
  selected.clear();
  if (on) selectUnits(UNITS, true);
}
function resetCapital(c, on, pos, fwd) {
  c.alive = on; c.obj.visible = on; c.bar.visible = on; c.hp = c.maxHp; c.flash = 0; c.engaged = false; c.prefTarget = null;
  c.order.type = 'move'; c.speed = CAP_SPEED;
  if (pos) c.obj.position.copy(pos);
  if (fwd) c.fwd.copy(fwd);
  quatFromDir(c.fwd, c.obj.quaternion);
  tintShip(c.obj, c.color);
}
function damageCapital(c, amount = 1) {
  if (!c.alive || state !== 'playing') return;
  c.hp -= amount;
  c.flash = 0.06;
  if (c.hp > 0) { if (c.side === 'friend') haptic('left', 0.2, 20); return; }
  c.alive = false; c.obj.visible = false; c.bar.visible = false;
  explode(c.obj, c.color, _v1.copy(c.fwd).multiplyScalar(c.speed), true);
  blink(c.obj.position, c.color);
  sfx.boom(c.obj.position, true);
  if (c.side === 'enemy') {
    score += 1000 * wave; kills++;
    haptic('right', 1.0, 200);
    if (enemyCaps.every((x) => !x.alive)) {
      // Flagship(s) down: the rest of the enemy fleet jumps out. Wave won.
      for (const e of enemies) { blink(e.obj.position, ENEMY_COLOR); e.hp = 0; }
      showMessage('ENEMY FLAGSHIP DOWN', `Wave ${wave} won  +${1000 * wave}`, 2.4);
    } else showMessage('FLAGSHIP DOWN', 'One more to go', 1.6);
    return;
  }
  selected.delete(c);
  screenFlash = 0.3;
  haptic('right', 1.0, 250);
  if (FLEET_CAPS.every((x) => !x.alive)) gameOver('FLEET LOST');
  else showMessage(`${c.name} LOST`, 'One capital ship left', 2.0);
}
// Turrets: each fires at the nearest foe in range with a clear line (never through friends or stars).
function capitalGuns(c, dt, foes, interval, range) {
  for (const t of c.turrets) {
    t.cd -= dt;
    if (t.cd > 0 || state !== 'playing') continue;
    _bS.copy(t.off).applyQuaternion(c.obj.quaternion).multiplyScalar(S * CAP_SCALE).add(c.obj.position);
    let best = null, bd = range;
    for (const f of foes) {
      const d = f.obj.position.distanceTo(_bS);
      if (d < bd && !obstBlocks(_bS, f.obj.position)) { bd = d; best = f; }
    }
    if (!best) { t.cd = 0.25; continue; }
    const speed = 5 * S;
    leadPoint(_bS, best, speed, _bT);
    if (c.side === 'friend' && friendsInLine(c, _bT)) { t.cd = 0.15; continue; }
    _bD.subVectors(_bT, _bS).normalize();
    if (c.side === 'friend') playerBullets.spawn(_bS, _bD.clone().multiplyScalar(speed), 1.6);
    else enemyBullets.spawn(_bS, _bD.clone().multiplyScalar(speed), 2.2);
    if (Math.random() < 0.3) (c.side === 'friend' ? sfx.laser(_bS) : sfx.enemyLaser(_bS));
    t.cd = interval * rand(0.8, 1.25);
  }
}
function updateBar(c) {
  if (!c.alive) { c.bar.visible = false; return; }
  c.bar.visible = true;
  c.bar.position.copy(c.obj.position); c.bar.position.y += 0.75 * S;
  c.bar.scale.setScalar(1.3 * S);
  const f = Math.max(0, c.hp / c.maxHp), fill = c.bar.userData.fill;
  fill.scale.x = Math.max(0.001, f); fill.position.x = -(1 - f) / 2;
  c.bar.lookAt(camPos);
}
const _fu = new THREE.Vector3(), _fd = new THREE.Vector3();
function orderTargetPos(u, out) {
  const o = u.order;
  if (o.type === 'hold') return out.copy(o.point);
  if (o.type === 'follow') {
    const t = o.target;
    if (!unitAlive(t)) return null;
    const tf = t.kind === 'capital' ? t.fwd : t.fwd;
    sideOf(tf, _fd);
    return out.copy(unitCenter(t)).addScaledVector(tf, -1.4 * S).addScaledVector(_fd, 1.0 * S);
  }
  if (o.type === 'attack') {
    const t = o.target;
    if (t.members) { const a = t.members.filter((e) => e.hp > 0); if (!a.length) return null; return centroid(a, out); }
    if (t.kind === 'capital') return t.alive ? out.copy(t.obj.position) : null;
    return t.hp > 0 ? out.copy(t.obj.position) : null;
  }
  return null;
}
function nearestFoeDist(p, foes) {
  let d = Infinity;
  for (const f of foes) d = Math.min(d, f.obj.position.distanceTo(p));
  return d;
}
function updateFleet(dt) {
  const playing = state === 'playing';
  const foes = foesList();
  for (const u of UNITS) {
    if (!unitAlive(u)) { u.ring.visible = false; u.line.visible = false; continue; }
    const sel = selected.has(u);
    const cap = u.kind === 'capital';
    const pos = unitCenter(u);
    // Orders that point somewhere.
    if (u.order.type !== 'move' && !orderTargetPos(u, _fu)) {
      showMessage(`${u.name}`, u.order.type === 'attack' ? 'Target destroyed - holding course' : 'Escort lost - holding course', 1.4);
      u.order.type = 'move'; u.prefTarget = null;
    }
    const near = nearestFoeDist(pos, foes);
    let desired = null, spd = cap ? CAP_SPEED : CRUISE;
    if (u.order.type === 'move') {
      if (sel) {
        desired = _fd.copy(player.fwd);
        u.engaged = playing && input.fire;
        if (!u.engaged) spd = cap ? (input.boost ? CAP_BOOST : input.brake ? CAP_SPEED * 0.4 : CAP_SPEED) : (input.boost ? BOOST : input.brake ? BRAKE : CRUISE);
      } else { desired = _fd.copy(u.fwd); u.engaged = playing && near < 2.6 * S; }   // keep course, defend yourself
      if (u.engaged) spd *= 0.55;
    } else {
      wrapDelta(pos, _fu, _fd);
      const dist = _fd.length();
      const close = u.order.type === 'attack' ? (cap ? 3.5 : 2.2) * S : (u.order.type === 'hold' ? 0.6 : 0.4) * S;
      if (dist > close) { _fd.normalize(); if (u.order.type === 'follow') spd = clamp(unitSpeed(u.order.target) + dist * 1.5, 0.3 * spd, cap ? CAP_BOOST : BOOST); }
      else {
        // At the spot: circle it (bots can't hover; capital ships just slow right down).
        _fd.crossVectors(_fd.lengthSq() > 1e-6 ? _fd.normalize() : u.fwd, UP);
        if (_fd.lengthSq() < 1e-4) _fd.set(1, 0, 0);
        _fd.normalize();
        spd *= u.order.type === 'follow' ? 1 : cap ? 0.3 : 0.6;
        if (u.order.type === 'follow') spd = unitSpeed(u.order.target);
      }
      desired = _fd;
      u.engaged = playing && (u.order.type === 'attack' ? dist < LEASH + BOT_RANGE : near < 3 * S) || (sel && playing && input.fire);
      u.prefTarget = u.order.type === 'attack' ? u.order.target : null;
    }
    if (cap) {
      // Capital ship: turn slowly toward the wanted heading; avoid stars and other big ships.
      const d2 = _fu.copy(desired);
      obstAvoid(pos, u.fwd, u.speed, d2);
      for (const o of [...FLEET_CAPS, ...enemyCaps]) {
        if (o === u || !o.alive) continue;
        wrapDelta(o.obj.position, pos, _bS);
        const d = _bS.length(), min = u.radius + o.radius + 0.6 * S;
        if (d < min && d > 1e-4) d2.addScaledVector(_bS, (2 * (min - d)) / (min * d));
      }
      d2.normalize();
      steer(u, d2.clone(), dt);
      u.speed += (spd - u.speed) * Math.min(1, dt * 1.2);
      pos.addScaledVector(u.fwd, u.speed * dt);
      wrapBox(pos);
      obstPushOut(pos, u.radius);
      for (const o of [...FLEET_CAPS, ...enemyCaps]) {
        if (o === u || !o.alive) continue;
        wrapDelta(o.obj.position, pos, _bS);
        const d = _bS.length(), min = u.radius + o.radius;
        if (d < min && d > 1e-5) pos.addScaledVector(_bS, (min - d) / d);
      }
      capitalGuns(u, dt, foes, u.engaged ? 0.3 : 0.6, (u.engaged ? 6.0 : 4.5) * S);
      u.flash = Math.max(0, u.flash - dt);
      tintShip(u.obj, u.flash > 0 ? WHITE : u.color);
      updateBar(u);
    } else {
      // Squad anchor: selected + move follows the command orientation exactly; otherwise turn toward the order.
      if (sel && u.order.type === 'move') {
        if (activeSteer() === 'mirror') u.q.copy(player.mq); else quatFromDir(player.fwd, u.q);
        u.fwd.copy(player.fwd);
      } else {
        const d2 = _fu.copy(desired);
        obstAvoid(pos, u.fwd, u.speed, d2);
        d2.normalize();
        const a = u.fwd.angleTo(d2);
        if (a > 1e-4) turnToward(u.fwd, d2, Math.min(a, 2.2 * dt));
        quatFromDir(u.fwd, u.q);
      }
      u.right.set(1, 0, 0).applyQuaternion(u.q);
      u.speed += (spd - u.speed) * Math.min(1, dt * 3);
      pos.addScaledVector(u.fwd, u.speed * dt);
      wrapBox(pos);
      obstPushOut(pos, 0.15 * S);
      updateSquad(u, dt);
    }
    // Markers: ring (selected = bright, hovered = dim) and order line (or heading line when selected).
    const hov = fleetHover && fleetHover.unit === u;
    u.ring.visible = sel || hov;
    u.ring.material.opacity = sel ? 0.9 : 0.4;
    u.ring.position.copy(pos);
    u.ring.lookAt(camPos);
    const lp = u.line.geometry.attributes.position;
    if (u.order.type !== 'move' && orderTargetPos(u, _fu)) {
      lp.setXYZ(0, pos.x, pos.y, pos.z); lp.setXYZ(1, _fu.x, _fu.y, _fu.z);
      u.line.material.opacity = 0.35; u.line.visible = true;
    } else if (sel) {
      _fu.copy(pos).addScaledVector(u.fwd, 1.6 * S);
      lp.setXYZ(0, pos.x, pos.y, pos.z); lp.setXYZ(1, _fu.x, _fu.y, _fu.z);
      u.line.material.opacity = 0.6; u.line.visible = true;
    } else u.line.visible = false;
    lp.needsUpdate = true;
  }
  squadEngaged = [...selected].some((u) => u.engaged);
}
// Enemy capital ships ("flagships"): hold range from your fleet, drift round it, fall back to cover
// when badly damaged, and fire their turrets at the nearest of your ships.
function updateEnemyCaps(dt) {
  const tg = friends;
  for (const c of enemyCaps) {
    if (!c.alive) continue;
    const pos = c.obj.position;
    c.t += dt;
    const T = nearestTo(pos, FLEET_CAPS.filter((x) => x.alive)) || nearestTo(pos, tg);
    const goal = _fu;
    if (!T) goal.copy(pos).addScaledVector(c.fwd, 1);
    else if (c.hp < c.maxHp * 0.35 && coverPoint(T.obj.position, pos, goal)) { /* hide behind a star */ }
    else {
      _bS.subVectors(pos, T.obj.position);
      if (_bS.lengthSq() < 1e-6) _bS.set(0, 0, -1);
      _bS.normalize();
      sideOf(_bS, _bT);
      goal.copy(T.obj.position).addScaledVector(_bS, 5 * S).addScaledVector(_bT, Math.sin(c.t * 0.2) * 2 * S);
      clampIn(goal, 0.8);
    }
    const d2 = _fd.subVectors(goal, pos);
    if (d2.lengthSq() < 0.09 * S) d2.copy(c.fwd); else d2.normalize();
    obstAvoid(pos, c.fwd, c.speed, d2);
    for (const o of [...FLEET_CAPS, ...enemyCaps]) {
      if (o === c || !o.alive) continue;
      _bS.subVectors(pos, o.obj.position);
      const d = _bS.length(), min = c.radius + o.radius + 0.6 * S;
      if (d < min && d > 1e-4) d2.addScaledVector(_bS, (2 * (min - d)) / (min * d));
    }
    d2.normalize();
    steer(c, d2.clone(), dt);
    c.speed = CAP_SPEED * 0.8;
    pos.addScaledVector(c.fwd, c.speed * dt);
    wrapBox(pos);
    obstPushOut(pos, c.radius);
    capitalGuns(c, dt, tg, Math.max(0.3, 0.8 - wave * 0.05), 5.2 * S);
    c.flash = Math.max(0, c.flash - dt);
    tintShip(c.obj, c.flash > 0 ? WHITE : c.color);
    updateBar(c);
  }
}
function spawnEnemyCaps(n) {
  enemyCaps.forEach((c, i) => {
    if (i >= (n >= 3 ? 2 : 1)) { resetCapital(c, false); return; }
    c.maxHp = Math.round((70 + 20 * (n - 1)) * (n >= 3 ? 0.75 : 1));
    // Far side of the room from your fleet.
    const p = new THREE.Vector3((i ? 0.5 : -0.5) * HB.x, rand(-0.3, 0.3) * HB.y, -HB.z * 0.75);
    obstPushOut(p, c.radius + 0.2 * S);
    resetCapital(c, true, p, new THREE.Vector3(0, 0, 1));
    c.speed = CAP_SPEED * 0.8;
  });
}

// ---------------------------------------------------------------- Fleet: pointing (left hand / mouse)
// fleetHover = what the selection ray points at: { unit } (ours), { foe, group } (enemy), { star }, or { point }.
let fleetHover = null;
const _po = new THREE.Vector3(), _pd = new THREE.Vector3(), _pv = new THREE.Vector3();
function pickAlongRay(originW, dirW) {
  board.worldToLocal(_po.copy(originW));
  _pd.copy(dirW).normalize();
  let best = null, bestScore = 1, bestT = Infinity;
  const consider = (p, rad, hit) => {
    _pv.subVectors(p, _po);
    const t = _pv.dot(_pd);
    if (t <= 0) return;
    const perp = _pv.addScaledVector(_pd, -t).length();
    const score = perp / (rad + 0.05 * t);
    if (score < bestScore) { bestScore = score; best = hit; bestT = t; }
  };
  for (const u of UNITS) if (unitAlive(u)) consider(unitCenter(u), u.kind === 'capital' ? 0.9 * S : 0.8 * S, { unit: u });
  for (const c of enemyCaps) if (c.alive) consider(c.obj.position, 0.9 * S, { foe: c });
  for (const e of enemies) if (e.hp > 0) consider(e.obj.position, 0.4 * S, { foe: e, group: e.group });
  // Stars: a real ray / sphere hit; they win if they are in front of the ship candidate.
  for (const o of obstacles) {
    _pv.subVectors(o.c, _po);
    const t = _pv.dot(_pd);
    if (t <= 0) continue;
    const perp2 = _pv.lengthSq() - t * t;
    if (perp2 > o.r * o.r) continue;
    const tHit = t - Math.sqrt(o.r * o.r - perp2);
    if (tHit < bestT) { bestT = tHit; best = { star: o }; }
  }
  if (!best) {
    // Empty space: the point on the ray closest to the middle of the room.
    const t = Math.max(0, -_po.dot(_pd));
    best = { point: clampIn(_po.clone().addScaledVector(_pd, t), 0.85) };
  }
  return best;
}
function hoverLabel(h) {
  if (!h) return '';
  if (h.unit) return h.unit.name;
  if (h.foe) return h.foe.kind === 'capital' ? 'ENEMY FLAGSHIP' : 'ENEMY GROUP';
  if (h.star) return 'STAR';
  return 'SPACE';
}
// Left trigger (or keys 1-5 on desktop): select. Left grip (or G): order the selection.
function fleetSelect() {
  if (fleetHover && fleetHover.unit) selectUnits([fleetHover.unit]);
  else showMessage('SELECT', 'Point at a squadron or capital ship', 1.0);
}
function fleetOrder() {
  const h = fleetHover;
  if (!h || !selected.size) return;
  const sel = [...selected];
  let what = '';
  for (const u of sel) {
    if (h.unit) {
      if (h.unit === u) continue;
      u.order.type = 'follow'; u.order.target = h.unit; what = 'FOLLOW ' + h.unit.name;
    } else if (h.foe) {
      u.order.type = 'attack'; u.order.target = h.foe.kind === 'capital' ? h.foe : h.group; what = 'ATTACK ' + hoverLabel(h);
    } else if (h.star) {
      const o = h.star;
      _pv.subVectors(unitCenter(u), o.c);
      if (_pv.lengthSq() < 1e-6) _pv.set(0, 0, 1);
      u.order.type = 'hold'; u.order.point.copy(o.c).addScaledVector(_pv.normalize(), o.r + (u.kind === 'capital' ? 1.2 : 0.7) * S);
      what = 'GUARD STAR';
    } else {
      u.order.type = 'hold'; u.order.point.copy(h.point); what = 'HOLD POSITION';
    }
  }
  if (what) {
    // Ordered units leave direct command; select them again to steer them yourself.
    for (const u of sel) if (u.order.type !== 'move') selected.delete(u);
    showMessage(what, sel.map((u) => u.name).join(', '), 1.4);
    sfx.ping(null);
    haptic('left', 0.4, 40);
  }
}
// The selection ray drawn from the left controller in Fleet mode.
const selRay = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1)]),
  new THREE.LineBasicMaterial({ color: 0xffcc66, transparent: true, opacity: 0.35, fog: false }));
selRay.visible = false;

// ---------------------------------------------------------------- mode switching
function applyMode() {
  gameMode = settings.mode;
  const sq = teamMode();
  setBoxB(MODE_BOX[gameMode]);
  obstacleGroup.visible = sq;
  // In Squadron the player "ship" is just the command point: hide the hull, keep the aim line.
  // In Fleet each unit has its own markers, so the command point is hidden completely.
  player.obj.userData.lines.visible = !sq;
  player.obj.children[1].visible = !sq;
  for (const ch of player.obj.children.slice(2)) ch.visible = gameMode !== 'fleet';
  trail.visible = !sq && player.alive;
  SHIP_NEUTRAL_Q.copy(BOX_FWD_Q);
  selRay.visible = gameMode === 'fleet' && !!hands.left;
  resetBots();
  resetFleet();
}
function damagePlayer() {
  if (!player.alive || player.invuln > 0 || state !== 'playing') return;
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
    sfx.chime(false);
    state = 'gameover';
    stateTimer = 0;
    best = Math.max(best, score);
    try { localStorage.setItem('battleRoomBest', String(best)); } catch (e) { /* ignore */ }
    showMessage('SHIP DESTROYED', `Score ${score}   Wave ${wave}   Best ${best}\n${restartHint()}`, 9999);
  }
}

// ---------------------------------------------------------------- game state
let state = 'title';   // title | playing | gameover
let stateTimer = 0;
let wave = 0, score = 0, kills = 0, intermission = 0, screenFlash = 0;
let best = 0;
try { best = Number(localStorage.getItem('battleRoomBest')) || 0; } catch (e) { /* ignore */ }

function startWave(n) {
  wave = n;
  const heavies = Math.floor((n - 1) / 2);
  if (gameMode === 'fleet') {
    // A flagship (two from wave 3) with escorts, plus the Squadron-style attack groups.
    spawnEnemyCaps(n);
    for (const c of enemyCaps) if (c.alive) spawnGroup('escort', 2 + Math.floor(n / 2), n, c);
    spawnGroup('pincer', 2, n);
    spawnGroup('flank', 2 + Math.floor(n / 2), n);
    spawnGroup('sniper', 1 + Math.floor(n / 3), n);
    if (n >= 2) spawnGroup('bait', 3, n);
    if (n >= 3) spawnGroup('flank', 2 + Math.floor(n / 3), n);
    if (heavies) spawnGroup('heavy', heavies, n);
  } else if (gameMode === 'squadron') {
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
  const nCaps = enemyCaps.filter((c) => c.alive).length;
  showMessage(`WAVE ${n}`, nCaps ? `${nCaps} flagship${nCaps > 1 ? 's' : ''} + ${enemies.length} fighters - destroy the flagship` : `${enemies.length} hostiles inbound`, 2.4);
  sfx.chime(true);
  log(`wave ${n} started with ${enemies.length} enemies`);
}
function startGame() {
  sfx.init();
  for (const e of enemies) board.remove(e.obj);
  enemies.length = 0;
  groups.length = 0;
  for (const c of enemyCaps) resetCapital(c, false);
  playerBullets.clear();
  enemyBullets.clear();
  score = 0; kills = 0;
  applyMode();
  setShape(pickShape(_shapeTmp));                  // a new room shape for every game
  resetPlayer();
  resetBots();
  resetFleet();
  state = 'playing';
  needNeutral = true;
  stateTimer = 0;
  intermission = 0;
  hideTitle();
  startWave(START_WAVE);
}
function showIdlePrompt() {
  if (state === 'title') {
    if (renderer.xr.isPresenting) showMessage('BATTLE ROOM: ' + gameMode.toUpperCase(), 'RIGHT TRIGGER starts - B switches mode (Fighter / Squadron / Fleet)\n' + steerHelp(activeSteer()), 9999);
  } else if (state === 'gameover') showMessage({ squadron: 'SQUADRON LOST', fleet: 'FLEET LOST' }[gameMode] || 'SHIP DESTROYED', `Score ${score}   Wave ${wave}   Best ${best}\n${restartHint()}`, 9999);
}
function restartHint() {
  return renderer.xr.isPresenting ? 'Pull TRIGGER or press A to restart' : 'Click or press R to restart';
}

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
  const big = xr && state === 'title';
  msgPanel.visible = big;
  wristMsg.visible = xr && !big;
  msgEl.classList.toggle('title', state === 'title');
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
// Fleet wrist panel: every unit (selected ones marked), its hull and current order, the enemy flagships.
const ORDER_TAG = { move: 'MOVE', hold: 'HOLD', follow: 'FOLW', attack: 'ATK' };
function drawFleetHud() {
  const g = hctx;
  g.font = '20px monospace';
  g.fillStyle = '#7fe9ff';
  g.fillText(`WAVE ${wave}  HOSTILES ${enemies.length + enemyCaps.filter((c) => c.alive).length}`, 20, 72);
  g.font = '17px monospace';
  UNITS.forEach((u, i) => {
    const y = 98 + i * 22, alive = unitAlive(u), col = '#' + u.color.getHexString();
    g.fillStyle = selected.has(u) ? '#ffffff' : '#5fa9bf';
    g.fillText(selected.has(u) ? '>' : ' ', 8, y);
    g.fillStyle = alive ? col : '#664444';
    g.fillText(u.kind === 'capital' ? (u === FLEET_CAPS[0] ? 'CAP 1' : 'CAP 2') : u.name, 22, y);
    if (u.kind === 'capital') {
      g.strokeStyle = col; g.strokeRect(96, y - 13, 100, 14);
      if (alive) { g.fillStyle = u.hp < u.maxHp * 0.3 ? '#ff5566' : col; g.fillRect(98, y - 11, 96 * Math.max(0, u.hp / u.maxHp), 10); }
    } else {
      u.bots.forEach((b, k) => {
        g.strokeStyle = b.alive ? col : '#664444'; g.strokeRect(96 + k * 25, y - 13, 20, 14);
        if (b.alive) { g.fillStyle = b.hp <= 1 ? '#ff5566' : col; g.fillRect(98 + k * 25, y - 11, (16 * b.hp) / BOT_HP, 10); }
      });
    }
    g.fillStyle = '#bfefff';
    if (alive) g.fillText(u.engaged ? 'FIRE' : ORDER_TAG[u.order.type], 204, y);
  });
  // Enemy flagships.
  let x = 22;
  g.fillStyle = '#ff6677'; g.fillText('FLAG', x, 212);
  for (const c of enemyCaps) {
    if (!c.alive && !c.maxHp) continue;
    if (!c.alive) continue;
    g.strokeStyle = '#ff4455'; g.strokeRect(x + 58, 199, 80, 14);
    g.fillStyle = '#ff4455'; g.fillRect(x + 60, 201, 76 * Math.max(0, c.hp / c.maxHp), 10);
    x += 90;
  }
  g.fillStyle = '#5fa9bf'; g.font = '16px monospace';
  g.fillText(state === 'playing' && intermission > 0 ? 'NEXT WAVE...' : fleetHover ? 'POINTING: ' + hoverLabel(fleetHover) : 'L: point+trig select', 20, 240);
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
  if (gameMode === 'fleet') drawFleetHud();
  else {
    hctx.fillText(`WAVE  ${wave}`, 20, 84);
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
    hctx.fillText(`BEST ${best}`, 20, 200);
    const sm = activeSteer();
    hctx.fillText(state === 'playing' && intermission > 0 ? 'NEXT WAVE...'
      : `${gameMode === 'squadron' ? (squadEngaged ? 'ENGAGING' : 'FORMATION') : 'FIGHTER'} - ${STEER_NAMES[sm]}${sm === 'stick' && invertY ? ' INV' : ''}`, 20, 232);
  }

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
  else if (gameMode === 'fleet') {
    for (const sq of FLEET_SQUADS) for (const b of sq.bots) if (b.alive) plot(b.obj.position, '#' + sq.color.getHexString(), 4);
    const sqr = (c, col) => { const sx = cx + (c.obj.position.x / range) * R, sy = cy + (c.obj.position.z / range) * R; hctx.fillStyle = col; hctx.fillRect(sx - 6, sy - 6, 12, 12); };
    for (const c of FLEET_CAPS) if (c.alive) sqr(c, '#a8f0ff');
    for (const c of enemyCaps) if (c.alive) sqr(c, '#ff4455');
  } else if (player.alive) plot(player.obj.position, '#33ddff', 6);
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
  if (gameMode === 'fleet') {
    return xr ? 'LEFT: point + trigger = select, grip = order, stick click = all. RIGHT: heading, trigger engage, grip boost'
      : '1-5 select, 0 all, G = order at the mouse; mouse = heading, hold click = engage';
  }
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
  if (!player.alive || state === 'title') { shipArrow.visible = false; return; }
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
for (let i = 0; i < 2; i++) {
  const c = renderer.xr.getController(i);
  rig.add(c);
  c.addEventListener('connected', (ev) => {
    const hand = ev.data.handedness;
    c.userData.source = ev.data;
    c.userData.hand = hand;
    if (hand !== 'left' && hand !== 'right') return;
    hands[hand] = c;
    c.add(buildControllerGizmo(hand === 'left' ? 0xffcc66 : 0x33ddff));
    if (hand === 'left') c.add(hudPanel, wristMsg, selRay);
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
  hideTitle();
  rig.position.set(0, 0, 0);
  needNeutral = true;
  msgPanel.position.set(0, HEAD_H, -1.8);
  if (state === 'title' || state === 'gameover') showIdlePrompt();
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
  if (changed === 'mode' && settings.mode !== gameMode) {
    // Switching mode: restart in the new mode (or just rebuild the title scene).
    if (state === 'title') { applyMode(); showIdlePrompt(); } else startGame();
    needNeutral = true;
  }
}

// ---------------------------------------------------------------- settings menu (VR panel + desktop overlay)
let menuOpen = false, menuHover = -1;
const MENU_W = 512, MENU_TOP = 70, MENU_ROW = 56, MENU_ROWS = SETTINGS_DEF.length + 1;
const menuCanvas = document.createElement('canvas');
menuCanvas.width = MENU_W; menuCanvas.height = MENU_TOP + MENU_ROWS * MENU_ROW + 44;
const mnctx = menuCanvas.getContext('2d');
const menuTex = new THREE.CanvasTexture(menuCanvas);
menuTex.colorSpace = THREE.SRGBColorSpace;
const menuPanel = new THREE.Mesh(new THREE.PlaneGeometry(0.5, (0.5 * menuCanvas.height) / MENU_W),
  new THREE.MeshBasicMaterial({ map: menuTex, transparent: true, depthTest: false, fog: false, side: THREE.DoubleSide }));
menuPanel.renderOrder = 30;
menuPanel.visible = false;
rig.add(menuPanel);
function optLabel(d) { const o = d.opts.find((x) => x[0] === settings[d.key]); return o ? o[1] : ''; }
function drawMenu() {
  const g = mnctx, W = MENU_W, H = menuCanvas.height;
  g.clearRect(0, 0, W, H);
  g.fillStyle = 'rgba(0,10,22,0.9)'; g.fillRect(0, 0, W, H);
  g.strokeStyle = 'rgba(80,220,255,0.8)'; g.lineWidth = 3; g.strokeRect(2, 2, W - 4, H - 4);
  g.fillStyle = '#9ff'; g.font = 'bold 34px monospace'; g.textAlign = 'center';
  g.fillText('SETTINGS', W / 2, 48);
  for (let i = 0; i < MENU_ROWS; i++) {
    const y = MENU_TOP + i * MENU_ROW;
    if (i === menuHover) { g.fillStyle = 'rgba(60,200,255,0.25)'; g.fillRect(10, y, W - 20, MENU_ROW - 6); }
    g.strokeStyle = 'rgba(80,220,255,0.35)'; g.lineWidth = 1; g.strokeRect(10, y, W - 20, MENU_ROW - 6);
    g.font = '24px monospace';
    if (i < SETTINGS_DEF.length) {
      const d = SETTINGS_DEF[i];
      g.textAlign = 'left'; g.fillStyle = '#bfefff'; g.fillText(d.label, 24, y + 34);
      g.textAlign = 'right'; g.fillStyle = '#ffcc66'; g.fillText((d.action || optLabel(d)) + ' >', W - 24, y + 34);
    } else {
      g.textAlign = 'center'; g.fillStyle = '#9ff'; g.fillText('CLOSE', W / 2, y + 34);
    }
  }
  g.textAlign = 'center'; g.fillStyle = '#5fa9bf'; g.font = '18px monospace';
  g.fillText(renderer.xr.isPresenting ? 'Point + trigger to change - X+Y closes' : 'Tab closes', W / 2, H - 16);
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
    if (open) {
      // Float it in front of you (rig-local; the rig never rotates), facing you.
      camera.getWorldDirection(_v1); _v1.y = 0;
      if (_v1.lengthSq() < 1e-6) _v1.set(0, 0, -1);
      _v1.normalize();
      menuPanel.position.copy(camera.position).addScaledVector(_v1, 0.5);
      menuPanel.position.y += 0.02;
      menuPanel.rotation.set(0, Math.atan2(-_v1.x, -_v1.z), 0);
      pointer.visible = true;
    }
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
      btn.addEventListener('click', () => { resetBox(); showMessage('BOX RESET', 'Back in front of you', 1.0); });
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
  keys.add(e.code);
  if (e.code === 'KeyR' && state !== 'title') startGame();
  if (e.code === 'Enter' && state !== 'playing' && !renderer.xr.isPresenting) startGame();
  if (e.code === 'KeyC') resetBox();
  if ((e.code === 'Equal' || e.code === 'Minus')) setTimeout(saveBox, 0);
  if (e.code === 'Tab') { e.preventDefault(); if (!e.repeat) toggleSettings(); }
  if (e.code === 'Escape' && menuOpen) toggleSettings(false);
  if (e.code === 'KeyM' && !e.repeat) toggleSteer();
  if (e.code === 'KeyN' && !e.repeat) setSetting('mode', nextMode());
  if (gameMode === 'fleet' && state === 'playing' && !e.repeat) {
    // Fleet on desktop: 1-5 select a unit, 0 (or `) selects all, G orders the selection at the mouse pointer.
    const k = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5'].indexOf(e.code);
    if (k >= 0 && unitAlive(UNITS[k])) selectUnits([UNITS[k]]);
    if (e.code === 'Digit0' || e.code === 'Backquote') selectUnits(UNITS);
    if (e.code === 'KeyG') fleetOrder();
  }
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
  if (e.button === 0) {
    mouseDown = true;
    if (state === 'gameover' && stateTimer > 1.0) startGame();
  }
});
window.addEventListener('pointerup', (e) => {
  if (e.button === 2) lookDrag = false;
  if (e.button === 0) mouseDown = false;
});
document.getElementById('startbtn').addEventListener('click', (e) => { e.stopPropagation(); settings.mode = 'fighter'; saveSettings(); syncDesktopSettings(); startGame(); });
document.getElementById('startsq').addEventListener('click', (e) => { e.stopPropagation(); settings.mode = 'squadron'; saveSettings(); syncDesktopSettings(); startGame(); });
document.getElementById('startfleet').addEventListener('click', (e) => { e.stopPropagation(); settings.mode = 'fleet'; saveSettings(); syncDesktopSettings(); startGame(); });
function hideTitle() { document.getElementById('title').classList.add('hidden'); }

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
const MODES = ['fighter', 'squadron', 'fleet'];
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
    if (btn(5) && !prevB && !menuOpen) {
      if (state === 'title') { setSetting('mode', nextMode()); sfx.ping(null); }   // B on the title = switch mode
      else if (settings.steer === 'stick') toggleInvert();                // B = invert (thumbstick mode)
    }
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
    if (gameMode === 'fleet') {
      // FLEET: the left controller points a selection ray.
      L.getWorldPosition(_v3);
      _v2.set(0, 0, -1).applyQuaternion(L.getWorldQuaternion(_q));
      fleetHover = pickAlongRay(_v3, _v2);
      const hp = fleetHover.unit ? unitCenter(fleetHover.unit) : fleetHover.foe ? fleetHover.foe.obj.position : fleetHover.star ? fleetHover.star.c : fleetHover.point;
      selRay.scale.z = Math.max(0.05, board.localToWorld(_v1.copy(hp)).distanceTo(_v3));
      selRay.visible = !menuOpen;
      const playing = state === 'playing' && !menuOpen;
      // Stick click = select ALL; trigger = select what you point at; grip = order the selection.
      if (btn(3) && !prevLStick && playing) selectUnits(UNITS);
      if (lt && !prevLTrig && !menuOpen) { if (playing) fleetSelect(); else input.restart = true; }
      if (btn(1) && !prevLGrip && playing) fleetOrder();
    } else {
      selRay.visible = false;
      // Stick click = put the box back in its default spot (also in Settings).
      if (btn(3) && !prevLStick) { resetBox(); showMessage('BOX RESET', 'Back in front of you', 1.0); }
      // LEFT TRIGGER = shoot (and start / restart).
      if (!menuOpen) {
        if (lt) input.fire = true;
        if (lt && !prevLTrig) input.restart = true;
      }
      // LEFT GRIP = boost.
      if (btn(1)) input.boost = true;
    }
    prevLStick = btn(3); prevLTrig = lt; prevLGrip = btn(1);
    // Stick forward = boost, back = brake.
    if (sy < -0.5) input.boost = true;
    if (sy > 0.5) input.brake = true;
  }
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
  if (gameMode === 'fleet') fleetHover = pickAlongRay(raycaster.ray.origin, raycaster.ray.direction);
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
  if (DEMO && gameMode === 'fleet' && state === 'playing') {
    // Fleet autopilot: every few seconds, squads hunt the nearest enemy group and capital ships the flagship.
    input.fire = false;
    demoOrderT -= 1 / 60;
    if (demoOrderT <= 0) {
      demoOrderT = 4;
      const flag = enemyCaps.find((c) => c.alive);
      for (const u of UNITS) {
        if (!unitAlive(u)) continue;
        const near = nearestTo(unitCenter(u), enemies.filter((e) => e.hp > 0));
        const tgt = u.kind === 'capital' || !near ? flag : near.group;
        if (tgt) { u.order.type = 'attack'; u.order.target = tgt; selected.delete(u); }
      }
    }
  }
  if (DEMO && state === 'gameover' && stateTimer > 3) startGame();
}
let demoOrderT = 0;

// ---------------------------------------------------------------- update
// Flight-stick steering: stick X = turn (yaw), stick Y = nose up/down (pitch).
// Turn rates ease in/out; roll only banks into turns and always levels back out,
// so the ship stays upright relative to the world.
function turnToward(v, target, maxAngle) {
  const a = v.angleTo(target);
  if (a > 1e-4) v.lerp(target, Math.min(1, maxAngle / a)).normalize();
}
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
  if (!player.alive) return;
  const p = player.obj.position;
  const mode = activeSteer();
  pointer.visible = mode === 'point';
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
  if (gameMode === 'fleet') return;                // Fleet: the player ship is only the command orientation
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
  if (input.fire && player.fireCd <= 0 && state === 'playing') {
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
    for (const c of enemyCaps) {
      if (c.alive && segPointDist(b.prev, b.pos, c.obj.position) < c.radius) { b.dead = true; damageCapital(c, 1); break; }
    }
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

let hudTimer = 0, statusTimer = 0, frames = 0;
let lastT = performance.now();
function loop() {
  const now = performance.now();
  const dt = Math.min((now - lastT) / 1000, 0.05);
  lastT = now;
  stateTimer += dt;
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

  if (state === 'title') {
    // Idle demo: ship circles in front of you.
    const t = stateTimer * 0.6;
    player.obj.position.set(Math.sin(t) * HB.x * 0.6, Math.sin(t * 2) * HB.y * 0.25, Math.cos(t) * HB.z * 0.5);
    player.fwd.set(Math.cos(t), Math.cos(t * 2) * 0.33, -Math.sin(t) * 0.5).normalize();
    quatFromDir(player.fwd, player.obj.quaternion);
    player.mq.copy(player.obj.quaternion);
    refreshFriends();
    if (gameMode === 'squadron') updateBots(dt);   // the squadron flies formation behind the demo path
    if (gameMode === 'fleet') updateFleet(dt);
    reticle.visible = false;
    if (xr && input.restart) startGame();
  } else if (!menuOpen) {
    updateMorph(dt);
    updatePlayer(dt);
    refreshFriends();
    if (gameMode === 'squadron') updateBots(dt);
    if (gameMode === 'fleet') { updateFleet(dt); updateEnemyCaps(dt); }
    updateEnemies(dt);
    playerBullets.update(dt);
    enemyBullets.update(dt);
    updateCollisions();
    if (state === 'playing') {
      if (enemies.length === 0 && enemyCaps.every((c) => !c.alive)) {
        if (intermission <= 0) {
          intermission = 3;
          morphTo(pickShape(_shapeTmp), 2.4);          // the room reshapes before the next wave
          if (gameMode === 'fleet') {
            // Repairs: capital ships +15% hull, every bot +1, and each squad gets one lost ship back.
            let back = 0;
            for (const c of FLEET_CAPS) if (c.alive) c.hp = Math.min(c.maxHp, c.hp + c.maxHp * 0.15);
            for (const sq of FLEET_SQUADS) {
              for (const b of sq.bots) if (b.alive) b.hp = Math.min(BOT_HP, b.hp + 1);
              if (!unitAlive(sq)) {
                const home = FLEET_CAPS.find((c) => c.alive);
                if (home) { sq.anchor.copy(home.obj.position).addScaledVector(home.fwd, -1.2 * S); sq.fwd.copy(home.fwd); quatFromDir(sq.fwd, sq.q); sq.right.set(1, 0, 0).applyQuaternion(sq.q); sq.order.type = 'move'; }
              }
              if (reviveBot(sq)) back++;
            }
            showMessage(`WAVE ${wave} WON`, back ? `Repairs done - ${back} replacement ship${back > 1 ? 's' : ''} launched` : 'Repairs done', 2.6);
          } else if (gameMode === 'squadron') {
            // +1 hull for every surviving bot; every 3rd wave a lost wingman is replaced.
            for (const b of bots) if (b.alive) b.hp = Math.min(BOT_HP, b.hp + 1);
            const back = wave % 3 === 0 && reviveBot();
            showMessage(`WAVE ${wave} CLEARED`, back ? 'Reinforcement: a new wingman joins' : 'Squadron hulls +1', 2.6);
          } else {
            const healed = player.hp < MAX_HP;
            player.hp = Math.min(MAX_HP, player.hp + 1);
            showMessage(`WAVE ${wave} CLEARED`, healed ? '+1 hull repaired' : 'Hull at full strength', 2.6);
          }
        } else {
          intermission -= dt;
          if (intermission <= 0) startWave(wave + 1);
        }
      }
    } else if (state === 'gameover') {
      reticle.visible = false;
      if (input.restart && stateTimer > 1.0) startGame();
    }
  }
  playerBullets.sync();
  enemyBullets.sync();
  updateEffects(dt);

  // Messages.
  if (msgTime > 0 && msgTime < 9000) {
    msgTime -= dt;
    if (msgTime <= 0) { hideMessage(); if (state === 'title' || state === 'gameover') showIdlePrompt(); }
  }
  if (xr && msgPanel.visible) {
    _v1.copy(camPos).addScaledVector(camFwd, 1.8);
    msgPanel.position.lerp(_v1, 1 - Math.exp(-3 * dt));
    msgPanel.lookAt(camPos);
  }
  reticle.lookAt(camPos);

  // Red screen flash on hit (desktop overlay; in VR the ship flash + haptics carry it).
  screenFlash = Math.max(0, screenFlash - dt);
  document.getElementById('flash').style.opacity = String(screenFlash * 2);

  hudTimer -= dt;
  if (hudTimer <= 0) { hudTimer = 0.1; drawHud(); }

  if (TEST) {
    statusTimer -= dt;
    if (statusTimer <= 0) {
      statusTimer = 3;
      log(`status mode=${gameMode} state=${state} wave=${wave} score=${score} kills=${kills} hp=${player.hp} bots=${gameMode === 'fleet' ? FLEET_SQUADS.map((q) => q.name[0] + q.bots.filter((b) => b.alive).length).join('') + ' caps=' + FLEET_CAPS.map((c) => (c.alive ? Math.round(c.hp) : 'x')).join('/') + ' flag=' + enemyCaps.map((c) => (c.alive ? Math.round(c.hp) : 'x')).join('/') : bots.filter((b) => b.alive).map((b) => b.hp).join('')} enemies=${enemies.length} fps~${Math.round(frames / 3)} xr=${xr}`);
      frames = 0;
    }
  }
  renderer.render(scene, camera);
}

applyMode();
applySettings();
buildDesktopSettings();
drawMenu();
drawHud();
renderer.setAnimationLoop(loop);
log('READY three r' + THREE.REVISION);

// Hooks for automated testing / tinkering from the console.
window.__game = {
  get state() { return state; }, get score() { return score; }, get wave() { return wave; },
  get hp() { return player.hp; }, get enemies() { return enemies.length; },
  player, enemiesList: enemies, startGame, rig, camera, renderer, scene, shipArrow, pointer, reticle,
  get steerMode() { return activeSteer(); }, get invertY() { return invertY; },
  settings, setSetting, neutralQ, input, gimbal, board, box, mirrorQ, bots, obstacles, groups,
  get mode() { return gameMode; }, get boxB() { return BOX_B; }, HB, get morphing() { return morphT < 1; }, wristMsg, msgPanel, hudPanel, UNITS, FLEET_SQUADS, FLEET_CAPS, enemyCaps, selected, selectUnits, fleetOrder, fleetSelect, pickAlongRay, damageCapital, get fleetHover() { return fleetHover; }, set fleetHover(v) { fleetHover = v; }, selRay, get friends() { return friends; }, get squadEngaged() { return squadEngaged; },
  get enemyBullets() { return enemyBullets.list.length; }, get bullets() { return playerBullets.list.length; }, toggleSettings, get menuOpen() { return menuOpen; }, get menuHover() { return menuHover; }, menuPanel,
};
