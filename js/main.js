// BATTLE ROOM - a seated, tabletop (diorama) wireframe space battle for WebXR (Meta Quest)
// with a mouse + keyboard fallback for desktop browsers.
import * as THREE from '../vendor/three.module.js';
import { VRButton } from '../vendor/VRButton.js';
import { buildPlayerShip, buildFighter, buildCruiser, buildControllerGizmo, tintShip } from './models.js?v=6';
import { Sfx } from './audio.js?v=6';

const TEST = /[?&]test/.test(location.search);
const DEMO = /[?&]demo/.test(location.search);          // autopilot (attract mode / testing)
const START_WAVE = Math.max(1, parseInt(new URLSearchParams(location.search).get('wave'), 10) || 1);
const log = (m) => { if (TEST && window.__log) window.__log(m); };

// ---------------------------------------------------------------- constants
const S = 0.5;                                    // world scale: everything is "zoomed out" to half size
const HEAD_H = 1.2;                               // seated eye height (desktop)
const ARENA_C = new THREE.Vector3(0, 0, 0);       // battle centre = centre of the box (game units)
const BOX_B = 1.75;                               // battle box half-size, in game units (box = 3.5 units)
const ARENA_RH = BOX_B * 0.9;                     // enemy roaming radius (game units)
const ARENA_RV = BOX_B * 0.9;
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
const SETTINGS_DEF = [
  { key: 'steer', label: 'Steering', opts: [['mirror', 'Mirror (ship = controller)'], ['relative', 'Relative (hand stick)'], ['point', 'Point'], ['stick', 'Thumbstick']] },
  { key: 'turnSpeed', label: 'Ship turn speed', opts: [['normal', 'Normal'], ['fast', 'Fast'], ['veryfast', 'Very fast']] },
  { key: 'boxSize', label: 'Box size', opts: [['small', 'Small'], ['medium', 'Medium'], ['large', 'Large']] },
];
const SETTINGS_DEFAULT = { turnSpeed: 'fast', steer: 'mirror', boxSize: 'medium' };
const BOX_SIZES = { small: 0.6, medium: 0.9, large: 1.2 };     // box width in metres
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
function applyBoard() {
  box.size = clamp(box.size, 0.3, 2.0);
  board.position.set(box.x, box.y, box.z);
  board.scale.setScalar(box.size / (2 * BOX_B));
}
function saveBox() { try { localStorage.setItem('battleRoomBox5', JSON.stringify(box)); } catch (e) { /* ignore */ } }
function resetBox() { Object.assign(box, BOX_DEFAULT, { size: BOX_SIZES[settings.boxSize] }); applyBoard(); saveBox(); }
applyBoard();
{
  // Faint wireframe box edges + a floor grid inside the box as a "down" reference.
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(2 * BOX_B, 2 * BOX_B, 2 * BOX_B)),
    new THREE.LineBasicMaterial({ color: 0x2a86a8, transparent: true, opacity: 0.7 }));
  const floor = new THREE.GridHelper(2 * BOX_B, 10, 0x15506a, 0x0d3344);
  floor.position.y = -BOX_B;
  floor.material.transparent = true;
  floor.material.opacity = 0.5;
  board.add(edges, floor);
}
function outsideBox(p, m = 1) { return Math.abs(p.x) > BOX_B * m || Math.abs(p.y) > BOX_B * m || Math.abs(p.z) > BOX_B * m; }
// Wrap-around: leave through one face, come back in through the opposite face.
function wrapBox(p) {
  let w = false;
  for (const k of ['x', 'y', 'z']) {
    if (p[k] > BOX_B) { p[k] -= 2 * BOX_B; w = true; } else if (p[k] < -BOX_B) { p[k] += 2 * BOX_B; w = true; }
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
function shrink(obj) { obj.scale.setScalar(S); obj.userData.mats[1].size *= S * board.scale.x; return obj; }
function arenaNorm(p) {
  const x = (p.x - ARENA_C.x) / ARENA_RH, y = (p.y - ARENA_C.y) / ARENA_RV, z = (p.z - ARENA_C.z) / ARENA_RH;
  return Math.sqrt(x * x + y * y + z * z);
}
function randomArenaPoint(scale = 0.8) {
  _v1.randomDirection().multiplyScalar(Math.cbrt(Math.random()) * scale);
  return new THREE.Vector3(ARENA_C.x + _v1.x * ARENA_RH, ARENA_C.y + _v1.y * ARENA_RV, ARENA_C.z + _v1.z * ARENA_RH);
}
// Orient a +Z-forward object along dir, keeping world up as up.
function quatFromDir(dir, out) {
  const up = Math.abs(dir.y) > 0.985 ? ZAXIS : UP;
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
  fwd: new THREE.Vector3(0, 0, -1), bank: 0, turn: 2.8,
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
  player.obj.position.set(0, 0, BOX_B * 0.4);
  player.fwd.set(0, 0, -1);
  player.bank = 0; player.yawRate = 0; player.pitchRate = 0; player.speed = CRUISE; player.hp = MAX_HP; player.invuln = 1.5; player.flash = 0;
  player.alive = true; player.obj.visible = true; trail.visible = true;
  quatFromDir(player.fwd, player.obj.quaternion);
  resetTrail();
}

// ---------------------------------------------------------------- enemies
const enemies = [];
function spawnEnemy(type, wave) {
  const cruiser = type === 'cruiser';
  const obj = shrink(cruiser ? buildCruiser(ENEMY_COLOR.getHex()) : buildFighter(ENEMY_COLOR.getHex()));
  let pos;
  for (let tries = 0; tries < 20; tries++) {
    // Enter through a random face of the box.
    pos = new THREE.Vector3(rand(-0.9, 0.9), rand(-0.9, 0.9), rand(-0.9, 0.9)).multiplyScalar(BOX_B);
    const ax = ['x', 'y', 'z'][Math.floor(Math.random() * 3)];
    pos[ax] = (Math.random() < 0.5 ? -1 : 1) * BOX_B * 0.98;
    if (pos.distanceTo(player.obj.position) > 1.4) break;
  }
  obj.position.copy(pos);
  const e = {
    type, obj, hp: cruiser ? 4 : 1, radius: (cruiser ? 0.34 : 0.2) * S,
    fwd: _v1.copy(ARENA_C).sub(pos).normalize().clone(), bank: 0,
    turn: cruiser ? 0.9 : 1.7 + wave * 0.08,
    speed: (cruiser ? 0.7 : 1.15) * S * (1 + wave * 0.06),
    fireInterval: Math.max(cruiser ? 1.6 : 0.9, (cruiser ? 3.2 : 2.6) - wave * 0.15),
    fireCd: rand(1.5, 3.5), retarget: 0, waypoint: new THREE.Vector3(), flash: 0,
    points: cruiser ? 300 : 100, spawnFade: 0,
  };
  quatFromDir(e.fwd, obj.quaternion);
  tintShip(obj, _c.setRGB(0, 0, 0)); // fades in
  board.add(obj);
  enemies.push(e);
  return e;
}
function pickWaypoint(e) {
  if (player.alive && Math.random() < 0.65) {
    // Attack run: aim for a point near the player's ship.
    e.waypoint.copy(player.obj.position).add(_v1.randomDirection().multiplyScalar(rand(0.8, 2.5) * S));
  } else {
    e.waypoint.copy(randomArenaPoint(0.85));
  }
  e.retarget = rand(2, 4.5);
}
function updateEnemies(dt) {
  for (const e of enemies) {
    e.retarget -= dt;
    if (e.retarget <= 0 || e.obj.position.distanceTo(e.waypoint) < 0.6 * S) pickWaypoint(e);
    const desired = _v2.subVectors(e.waypoint, e.obj.position).normalize();
    // Keep a little space from other enemies.
    for (const o of enemies) {
      if (o === e) continue;
      const d = e.obj.position.distanceTo(o.obj.position);
      if (d < 0.6 * S && d > 1e-4) desired.addScaledVector(_v1.subVectors(e.obj.position, o.obj.position).normalize(), (0.6 * S - d) * 4);
    }
    desired.normalize();
    steer(e, desired.clone(), dt);
    e.obj.position.addScaledVector(e.fwd, e.speed * dt);
    wrapBox(e.obj.position);

    // Fade in on spawn, flash white when hit.
    e.spawnFade = Math.min(1, e.spawnFade + dt * 1.5);
    if (e.flash > 0) { e.flash -= dt; tintShip(e.obj, WHITE); }
    else tintShip(e.obj, _c.copy(ENEMY_COLOR).multiplyScalar(e.spawnFade));

    // Fire at the player when roughly facing them.
    e.fireCd -= dt;
    if (player.alive && state === 'playing' && e.fireCd <= 0 && e.spawnFade >= 1) {
      const to = _v1.subVectors(player.obj.position, e.obj.position);
      const dist = to.length();
      if (dist < 5.5 * S && e.fwd.angleTo(to) < 0.6) {
        const bulletSpeed = (3.0 + wave * 0.12) * S;
        const t = dist / bulletSpeed;
        const aim = _v2.copy(player.obj.position).addScaledVector(player.fwd, player.speed * t * 0.7)
          .add(_v3.randomDirection().multiplyScalar(0.25 * S)).sub(e.obj.position).normalize();
        const shots = e.type === 'cruiser' ? [-0.12, 0, 0.12] : [0];
        for (const s of shots) {
          const d = aim.clone();
          if (s) d.applyAxisAngle(UP, s);
          enemyBullets.spawn(_v3.copy(e.obj.position).addScaledVector(e.fwd, e.radius), d.multiplyScalar(bulletSpeed), 4);
        }
        sfx.enemyLaser(e.obj.position);
        e.fireCd = e.fireInterval * rand(0.8, 1.3);
      } else {
        e.fireCd = 0.2;
      }
    }

    // Ramming the player hurts both.
    if (player.alive && e.obj.position.distanceTo(player.obj.position) < e.radius + 0.1 * S) {
      damagePlayer();
      damageEnemy(e, 2);
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
    sfx.ping(e.obj.position);
    haptic('right', 0.3, 25);
  }
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

function waveComposition(n) {
  const list = [];
  const fighters = 2 + n;
  const cruisers = Math.floor((n - 1) / 2);
  for (let i = 0; i < fighters; i++) list.push('fighter');
  for (let i = 0; i < cruisers; i++) list.push('cruiser');
  return list;
}
function startWave(n) {
  wave = n;
  for (const t of waveComposition(n)) spawnEnemy(t, n);
  showMessage(`WAVE ${n}`, `${enemies.length} hostiles inbound`, 2.2);
  sfx.chime(true);
  log(`wave ${n} started with ${enemies.length} enemies`);
}
function startGame() {
  sfx.init();
  for (const e of enemies) board.remove(e.obj);
  enemies.length = 0;
  playerBullets.clear();
  enemyBullets.clear();
  score = 0; kills = 0;
  resetPlayer();
  state = 'playing';
  needNeutral = true;
  stateTimer = 0;
  intermission = 0;
  hideTitle();
  startWave(START_WAVE);
}
function showIdlePrompt() {
  if (state === 'title') { if (renderer.xr.isPresenting) showMessage('BATTLE ROOM', 'Pull the RIGHT TRIGGER to start\n' + steerHelp(activeSteer()), 9999); }
  else if (state === 'gameover') showMessage('SHIP DESTROYED', `Score ${score}   Wave ${wave}   Best ${best}\n${restartHint()}`, 9999);
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
  msgPanel.visible = renderer.xr.isPresenting;
}
function hideMessage() {
  msgTime = 0;
  msgEl.classList.remove('show');
  msgPanel.visible = false;
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
  hctx.fillText(`WAVE  ${wave}`, 20, 84);
  hctx.fillText(`HOSTILES ${enemies.length}`, 20, 118);
  hctx.fillText('HULL', 20, 160);
  for (let i = 0; i < MAX_HP; i++) {
    hctx.strokeStyle = '#7fe9ff';
    hctx.strokeRect(92 + i * 34, 140, 26, 24);
    if (i < player.hp) {
      hctx.fillStyle = player.hp <= 2 ? '#ff5566' : '#33ddff';
      hctx.fillRect(95 + i * 34, 143, 20, 18);
    }
  }
  hctx.fillStyle = '#5fa9bf';
  hctx.font = '18px monospace';
  hctx.fillText(`BEST ${best}`, 20, 200);
  const sm = activeSteer();
  hctx.fillText(state === 'playing' && intermission > 0 ? 'NEXT WAVE...' : `STEER ${STEER_NAMES[sm]}${sm === 'stick' && invertY ? ' INV' : ''}`, 20, 232);

  // Radar: top-down view of the box (far side up).
  const cx = W - 128, cy = H / 2, R = 108, range = BOX_B * 1.15;
  hctx.strokeStyle = 'rgba(80,220,255,0.5)';
  hctx.lineWidth = 2;
  hctx.strokeRect(cx - BOX_B / range * R, cy - BOX_B / range * R, 2 * BOX_B / range * R, 2 * BOX_B / range * R);
  const plot = (p, color, size) => {
    const dy = p.y;
    const sx = (p.x / range) * R;
    const sy = (p.z / range) * R;
    hctx.fillStyle = color;
    hctx.beginPath();
    if (dy > BOX_B / 3) { hctx.moveTo(cx + sx, cy + sy - size); hctx.lineTo(cx + sx - size, cy + sy + size); hctx.lineTo(cx + sx + size, cy + sy + size); }
    else if (dy < -BOX_B / 3) { hctx.moveTo(cx + sx, cy + sy + size); hctx.lineTo(cx + sx - size, cy + sy - size); hctx.lineTo(cx + sx + size, cy + sy - size); }
    else hctx.arc(cx + sx, cy + sy, size, 0, Math.PI * 2);
    hctx.fill();
  };
  for (const e of enemies) plot(e.obj.position, '#ff4455', e.type === 'cruiser' ? 8 : 6);
  if (player.alive) plot(player.obj.position, '#33ddff', 6);
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
  if (mode === 'mirror') return xr ? 'The ship points where your right controller points - click the right stick to re-center' : 'The ship points where the mouse points - M to switch';
  if (mode === 'relative') return xr ? 'Tilt the right controller like a flight stick - grip / stick click re-centers' : 'Mouse offset from screen centre steers - M to switch';
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
let mirrorYaw = 0;                                   // yaw offset: controller direction -> box forward
const mirrorDir = new THREE.Vector3(0, 0, -1);
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
    if (hand === 'left') c.add(hudPanel);
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
  if (state === 'title') showIdlePrompt();
  else if (state === 'gameover') showMessage('SHIP DESTROYED', `Score ${score}\n${restartHint()}`, 9999);
  msgPanel.visible = true;
  msgPanel.position.set(0, HEAD_H, -1.8);
  log('xr sessionstart');
});
renderer.xr.addEventListener('sessionend', () => {
  document.body.classList.remove('in-vr');
  msgPanel.visible = false;
  camera.position.set(0, HEAD_H, 0);
  log('xr sessionend');
});

// ---------------------------------------------------------------- settings application
function applySettings(changed) {
  player.turn = 2.8 * TURN_MULS[settings.turnSpeed];
  if (changed === 'boxSize') { box.size = BOX_SIZES[settings.boxSize]; applyBoard(); saveBox(); }
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
      g.textAlign = 'right'; g.fillStyle = '#ffcc66'; g.fillText(optLabel(d) + ' >', W - 24, y + 34);
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
document.getElementById('startbtn').addEventListener('click', (e) => { e.stopPropagation(); startGame(); });
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
  stickX: 0, stickY: 0, relX: 0, relY: 0, clutch: false, leftFire: false,
};
let prevRestartBtn = false, prevB = false, prevStickBtn = false, prevLStick = false, prevXY = false, prevTrigMenu = false, prevLTrig = false;
const dragLast = new THREE.Vector3();
let dragging = false, boxDirty = false;

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
    input.boost = !rel && !mir && btn(1);     // grip = boost (point/thumbstick modes)
    input.brake = btn(4);                     // A = brake
    if (settings.steer === 'relative' || settings.steer === 'point') {   // stick forward/back = boost/brake
      if (sy > 0.5) input.brake = true;
      if (sy < -0.5) input.boost = true;
    }
    if (settings.steer === 'stick' && btn(5) && !prevB) toggleInvert();   // B = invert (thumbstick mode)
    input.relX = 0; input.relY = 0; input.clutch = false;
    if (rel) {
      // Grip held = clutch: ship flies straight and neutral follows your hand. Stick click = re-center.
      if (btn(3) && !prevStickBtn) { needNeutral = true; haptic('right', 0.4, 40); }
      if (needNeutral || btn(1)) { neutralQ.copy(R.quaternion); needNeutral = false; input.clutch = btn(1); }
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
      // Mirror: ship forward = controller forward, with a yaw offset so "straight into the box" is
      // wherever you held the controller at start / at the last right-stick click.
      if ((btn(3) && !prevStickBtn) || needNeutral) {
        mirrorYaw = -Math.atan2(-input.dir.x, -input.dir.z);
        needNeutral = false;
        haptic('right', 0.4, 40);
      }
      mirrorDir.copy(input.dir).applyAxisAngle(UP, mirrorYaw);
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
    // Stick click = put the box back in its default spot.
    if (btn(3) && !prevLStick) { resetBox(); showMessage('BOX RESET', 'Back in front of you', 1.0); }
    prevLStick = btn(3);
    // Grip + drag = move the box.
    if (btn(1)) {
      L.getWorldPosition(_v3);
      if (dragging) { box.x += _v3.x - dragLast.x; box.y += _v3.y - dragLast.y; box.z += _v3.z - dragLast.z; applyBoard(); boxDirty = true; }
      dragLast.copy(_v3);
      dragging = true;
    } else dragging = false;
    // LEFT TRIGGER = shoot (and start / restart). Right hand needs no buttons while flying.
    const lt = btn(0);
    if (!menuOpen) {
      if (lt) input.fire = true;
      if (lt && !prevLTrig) input.restart = true;
    }
    prevLTrig = lt;
    if (btn(1)) {
      // Grip held: stick up/down = grow/shrink the box.
      if (Math.abs(sy) > 0.15) { box.size *= Math.exp(-sy * 0.8 * dt); applyBoard(); boxDirty = true; }
    } else {
      // Stick forward = boost, back = brake.
      if (sy < -0.5) input.boost = true;
      if (sy > 0.5) input.brake = true;
    }
    if (boxDirty && !btn(1) && Math.abs(sy) <= 0.15) { saveBox(); boxDirty = false; }
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
  mirrorDir.copy(input.dir);
  input.hasSteer = true;
  input.fire = (mouseDown || keys.has('Space')) && !menuOpen;
  input.boost = keys.has('ShiftLeft') || keys.has('ShiftRight');
  input.brake = keys.has('ControlLeft') || keys.has('KeyF');
  input.restart = false;
  input.stickX = (keys.has('KeyL') ? 1 : 0) - (keys.has('KeyJ') ? 1 : 0);
  input.stickY = (keys.has('KeyK') ? 1 : 0) - (keys.has('KeyI') ? 1 : 0);
  // Relative mode on desktop: cursor offset from screen centre = stick deflection.
  const dn = (a) => { const m = Math.abs(a); return m < 0.05 ? 0 : Math.sign(a) * Math.min(1, (m - 0.05) / 0.55); };
  input.relX = dn(-mouse.x); input.relY = dn(mouse.y); input.clutch = false;
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
      input.fire = player.fwd.angleTo(input.dir) < 0.3 && nd < 6 * S;
      input.boost = nd > 3 * S;
    }
  }
  if (DEMO && state === 'gameover' && stateTimer > 3) startGame();
}

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

// Mirror steering: ship heading follows the (offset) controller direction with ~65 ms smoothing.
// Only yaw + pitch are copied; roll is just a small cosmetic bank into turns.
function flyMirror(dt, target) {
  const desired = _v1.copy(target).normalize();
  if (Math.abs(desired.y) > Math.sin(MAX_ELEV)) {
    const h = Math.hypot(desired.x, desired.z) || 1;
    const c = Math.cos(MAX_ELEV) / h;
    desired.set(desired.x * c, Math.sign(desired.y) * Math.sin(MAX_ELEV), desired.z * c);
  }
  const prev = _v3.copy(player.fwd);
  let a = player.fwd.angleTo(desired);
  if (a > 3.0) { desired.addScaledVector(UP, 0.3).normalize(); a = player.fwd.angleTo(desired); }
  if (a > 1e-4) turnToward(player.fwd, desired, a * (1 - Math.exp(-dt / 0.065)));
  const turn = (prev.z * player.fwd.x - prev.x * player.fwd.z) / Math.max(dt, 1e-4);
  player.bank += (clamp(-turn * 0.2, -0.6, 0.6) - player.bank) * Math.min(1, dt * 6);
  quatFromDir(player.fwd, player.obj.quaternion);
  _q.setFromAxisAngle(ZAXIS, player.bank);
  player.obj.quaternion.multiply(_q);
}

function updatePlayer(dt) {
  if (!player.alive) return;
  const p = player.obj.position;
  const mode = activeSteer();
  pointer.visible = mode === 'point';
  if (mode === 'mirror') {
    reticle.visible = false;
    if (input.hasSteer) flyMirror(dt, mirrorDir);
  } else if (mode === 'relative') {
    reticle.visible = false;
    flyByStick(dt, input.clutch ? 0 : -input.relX, input.clutch ? 0 : -input.relY);
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
  for (const b of playerBullets.list) {
    for (const e of enemies) {
      if (e.hp > 0 && segPointDist(b.prev, b.pos, e.obj.position) < e.radius) {
        b.dead = true;
        damageEnemy(e, 1);
        break;
      }
    }
  }
  if (player.alive) {
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
    player.obj.position.set(Math.sin(t) * BOX_B * 0.6, Math.sin(t * 2) * BOX_B * 0.25, Math.cos(t) * BOX_B * 0.5);
    player.fwd.set(Math.cos(t), Math.cos(t * 2) * 0.33, -Math.sin(t) * 0.5).normalize();
    quatFromDir(player.fwd, player.obj.quaternion);
    reticle.visible = false;
    if (xr && input.restart) startGame();
  } else if (!menuOpen) {
    updatePlayer(dt);
    updateEnemies(dt);
    playerBullets.update(dt);
    enemyBullets.update(dt);
    updateCollisions();
    if (state === 'playing') {
      if (enemies.length === 0) {
        if (intermission <= 0) {
          intermission = 3;
          const healed = player.hp < MAX_HP;
          player.hp = Math.min(MAX_HP, player.hp + 1);
          showMessage(`WAVE ${wave} CLEARED`, healed ? '+1 hull repaired' : 'Hull at full strength', 2.6);
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
      log(`status state=${state} wave=${wave} score=${score} kills=${kills} hp=${player.hp} enemies=${enemies.length} fps~${Math.round(frames / 3)} xr=${xr}`);
      frames = 0;
    }
  }
  renderer.render(scene, camera);
}

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
  settings, setSetting, neutralQ, input, gimbal, board, box, mirrorDir, get mirrorYaw() { return mirrorYaw; }, get bullets() { return playerBullets.list.length; }, toggleSettings, get menuOpen() { return menuOpen; }, get menuHover() { return menuHover; }, menuPanel,
};
