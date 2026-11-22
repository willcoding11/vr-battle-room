// BATTLE ROOM - a seated, 360-degree wireframe space battle for WebXR (Meta Quest)
// with a mouse + keyboard fallback for desktop browsers.
import * as THREE from '../vendor/three.module.js';
import { VRButton } from '../vendor/VRButton.js';
import { buildPlayerShip, buildFighter, buildCruiser, buildControllerGizmo, tintShip } from './models.js';
import { Sfx } from './audio.js';

const TEST = /[?&]test/.test(location.search);
const DEMO = /[?&]demo/.test(location.search);          // autopilot (attract mode / testing)
const START_WAVE = Math.max(1, parseInt(new URLSearchParams(location.search).get('wave'), 10) || 1);
const log = (m) => { if (TEST && window.__log) window.__log(m); };

// ---------------------------------------------------------------- constants
const HEAD_H = 1.2;                               // seated eye height (desktop)
const ARENA_C = new THREE.Vector3(0, 1.2, 0);     // battle centre = around your head
const ARENA_RH = 6.5;                             // horizontal radius (m)
const ARENA_RV = 3.6;                             // vertical radius (m)
const PLAYER_COLOR = new THREE.Color(0x33ddff);
const ENEMY_COLOR = new THREE.Color(0xff3344);
const WHITE = new THREE.Color(0xffffff);
const MAX_HP = 5;
const CRUISE = 1.6, BOOST = 3.2, BRAKE = 0.5;     // player speeds (m/s)
const LEAD = 0.9;                                 // how far past the ship the steering target sits
const CAM_SPEED = 2.2;                            // viewpoint move speed (m/s)

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
scene.fog = new THREE.Fog(0x000004, 5, 17);

// The rig is "you in your chair". It only ever TRANSLATES - never rotates -
// so up is always up and your facing is always your own head.
const rig = new THREE.Group();
scene.add(rig);
const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.03, 300);
camera.position.set(0, HEAD_H, 0);
camera.rotation.order = 'YXZ';
rig.add(camera);

// Stars: far points for depth/orientation.
{
  const n = 1800, p = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    _v1.randomDirection().multiplyScalar(rand(90, 140));
    p.set([_v1.x, _v1.y, _v1.z], i * 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(p, 3));
  const stars = new THREE.Points(g, new THREE.PointsMaterial({ color: 0x8899bb, size: 1.6, sizeAttenuation: false, fog: false }));
  scene.add(stars);
}
// Faint polar grid far below: a constant "down" reference.
{
  const grid = new THREE.PolarGridHelper(14, 16, 10, 64, 0x0f3550, 0x0a2233);
  grid.position.y = ARENA_C.y - ARENA_RV - 0.6;
  grid.material.transparent = true;
  grid.material.opacity = 0.6;
  scene.add(grid);
  // A faint ring at your own height marks the "horizon" of the arena.
  const ringPts = [];
  for (let i = 0; i <= 96; i++) {
    const a = (i / 96) * Math.PI * 2;
    ringPts.push(new THREE.Vector3(Math.cos(a) * ARENA_RH, ARENA_C.y, Math.sin(a) * ARENA_RH));
  }
  const ring = new THREE.Line(new THREE.BufferGeometry().setFromPoints(ringPts),
    new THREE.LineBasicMaterial({ color: 0x113344, transparent: true, opacity: 0.7 }));
  scene.add(ring);
}

const sfx = new Sfx();

// ---------------------------------------------------------------- helpers
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
    scene.add(this.mesh);
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
      if (b.life <= 0 || arenaNorm(b.pos) > 1.6) b.dead = true;
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
const playerBullets = new Bullets(0x88f4ff, 200, 0.16);
const enemyBullets = new Bullets(0xff6655, 300, 0.10);

// ---------------------------------------------------------------- effects
const effects = [];
// Shatter a ship into its individual line segments, which tumble apart and fade.
function explode(obj, color, vel, big = false) {
  obj.updateMatrixWorld(true);
  const src = obj.userData.lines.geometry.attributes.position;
  const n = src.count / 2;
  const center = obj.getWorldPosition(new THREE.Vector3());
  const frags = [];
  for (let s = 0; s < n; s++) {
    const a = new THREE.Vector3().fromBufferAttribute(src, s * 2).applyMatrix4(obj.matrixWorld);
    const b = new THREE.Vector3().fromBufferAttribute(src, s * 2 + 1).applyMatrix4(obj.matrixWorld);
    const c = a.clone().add(b).multiplyScalar(0.5);
    const out = c.clone().sub(center);
    if (out.lengthSq() < 1e-6) out.randomDirection();
    out.normalize().multiplyScalar(rand(0.4, big ? 2.2 : 1.6)).add(_v1.randomDirection().multiplyScalar(0.3));
    if (vel) out.addScaledVector(vel, 0.4);
    frags.push({ c, half: b.clone().sub(a).multiplyScalar(0.5), v: out, axis: new THREE.Vector3().randomDirection(), spin: rand(3, 10) });
  }
  const arr = new Float32Array(n * 6);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(arr, 3).setUsage(THREE.DynamicDrawUsage));
  const mat = new THREE.LineBasicMaterial({ color: color.clone().lerp(WHITE, 0.4), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
  const mesh = new THREE.LineSegments(g, mat);
  mesh.frustumCulled = false;
  scene.add(mesh);
  // Expanding wireframe shock-sphere.
  const shock = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.IcosahedronGeometry(1, 1)),
    new THREE.LineBasicMaterial({ color: color.clone().lerp(WHITE, 0.6), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  shock.position.copy(center);
  shock.scale.setScalar(0.02);
  scene.add(shock);
  effects.push({ type: 'frags', mesh, frags, arr, life: big ? 2.2 : 1.5, max: big ? 2.2 : 1.5 });
  effects.push({ type: 'shock', mesh: shock, life: 0.4, max: 0.4, size: big ? 1.2 : 0.55 });
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
      scene.remove(effects[i].mesh);
      effects[i].mesh.geometry.dispose();
      effects[i].mesh.material.dispose();
      effects.splice(i, 1);
    }
  }
}

// ---------------------------------------------------------------- player ship
const player = {
  obj: buildPlayerShip(PLAYER_COLOR.getHex()),
  fwd: new THREE.Vector3(0, 0, -1), bank: 0, turn: 2.8,
  speed: CRUISE, vel: new THREE.Vector3(), hp: MAX_HP, invuln: 0, flash: 0, fireCd: 0, alive: true,
};
scene.add(player.obj);
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
scene.add(trail);
let trailTimer = 0;
function resetTrail() {
  for (let i = 0; i < TRAIL_N; i++) trailArr.set([player.obj.position.x, player.obj.position.y, player.obj.position.z], i * 3);
  trail.geometry.attributes.position.needsUpdate = true;
}

function resetPlayer() {
  // Start 1.3 m in front of wherever the viewpoint currently is, at chest height.
  camera.getWorldPosition(_v1);
  getCamForwardFlat(_v2);
  player.obj.position.copy(_v1).addScaledVector(_v2, 1.3).add(_v3.set(0, -0.15, 0));
  player.fwd.copy(_v2);
  player.bank = 0; player.speed = CRUISE; player.hp = MAX_HP; player.invuln = 1.5; player.flash = 0;
  player.alive = true; player.obj.visible = true; trail.visible = true;
  quatFromDir(player.fwd, player.obj.quaternion);
  resetTrail();
}

// ---------------------------------------------------------------- enemies
const enemies = [];
function spawnEnemy(type, wave) {
  const cruiser = type === 'cruiser';
  const obj = cruiser ? buildCruiser(ENEMY_COLOR.getHex()) : buildFighter(ENEMY_COLOR.getHex());
  let pos;
  for (let tries = 0; tries < 20; tries++) {
    _v1.randomDirection();
    pos = new THREE.Vector3(ARENA_C.x + _v1.x * ARENA_RH * 0.92, ARENA_C.y + _v1.y * ARENA_RV * 0.85, ARENA_C.z + _v1.z * ARENA_RH * 0.92);
    if (pos.distanceTo(player.obj.position) > 3.5) break;
  }
  obj.position.copy(pos);
  const e = {
    type, obj, hp: cruiser ? 4 : 1, radius: cruiser ? 0.34 : 0.2,
    fwd: _v1.copy(ARENA_C).sub(pos).normalize().clone(), bank: 0,
    turn: cruiser ? 0.9 : 1.7 + wave * 0.08,
    speed: (cruiser ? 0.7 : 1.15) * (1 + wave * 0.06),
    fireInterval: Math.max(cruiser ? 1.6 : 0.9, (cruiser ? 3.2 : 2.6) - wave * 0.15),
    fireCd: rand(1.5, 3.5), retarget: 0, waypoint: new THREE.Vector3(), flash: 0,
    points: cruiser ? 300 : 100, spawnFade: 0,
  };
  quatFromDir(e.fwd, obj.quaternion);
  tintShip(obj, _c.setRGB(0, 0, 0)); // fades in
  scene.add(obj);
  enemies.push(e);
  return e;
}
function pickWaypoint(e) {
  if (player.alive && Math.random() < 0.65) {
    // Attack run: aim for a point near the player's ship.
    e.waypoint.copy(player.obj.position).add(_v1.randomDirection().multiplyScalar(rand(0.8, 2.5)));
  } else {
    e.waypoint.copy(randomArenaPoint(0.85));
  }
  e.retarget = rand(2, 4.5);
}
function updateEnemies(dt) {
  for (const e of enemies) {
    e.retarget -= dt;
    if (e.retarget <= 0 || e.obj.position.distanceTo(e.waypoint) < 0.6) pickWaypoint(e);
    const desired = _v2.subVectors(e.waypoint, e.obj.position).normalize();
    // Keep a little space from other enemies.
    for (const o of enemies) {
      if (o === e) continue;
      const d = e.obj.position.distanceTo(o.obj.position);
      if (d < 0.6 && d > 1e-4) desired.addScaledVector(_v1.subVectors(e.obj.position, o.obj.position).normalize(), (0.6 - d) * 2);
    }
    const n = arenaNorm(e.obj.position);
    if (n > 0.95) desired.addScaledVector(_v1.subVectors(ARENA_C, e.obj.position).normalize(), (n - 0.95) * 6);
    desired.normalize();
    steer(e, desired.clone(), dt);
    e.obj.position.addScaledVector(e.fwd, e.speed * dt);

    // Fade in on spawn, flash white when hit.
    e.spawnFade = Math.min(1, e.spawnFade + dt * 1.5);
    if (e.flash > 0) { e.flash -= dt; tintShip(e.obj, WHITE); }
    else tintShip(e.obj, _c.copy(ENEMY_COLOR).multiplyScalar(e.spawnFade));

    // Fire at the player when roughly facing them.
    e.fireCd -= dt;
    if (player.alive && state === 'playing' && e.fireCd <= 0 && e.spawnFade >= 1) {
      const to = _v1.subVectors(player.obj.position, e.obj.position);
      const dist = to.length();
      if (dist < 5.5 && e.fwd.angleTo(to) < 0.6) {
        const bulletSpeed = 3.0 + wave * 0.12;
        const t = dist / bulletSpeed;
        const aim = _v2.copy(player.obj.position).addScaledVector(player.fwd, player.speed * t * 0.7)
          .add(_v3.randomDirection().multiplyScalar(0.25)).sub(e.obj.position).normalize();
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
    if (player.alive && e.obj.position.distanceTo(player.obj.position) < e.radius + 0.1) {
      damagePlayer();
      damageEnemy(e, 2);
    }
  }
  for (let i = enemies.length - 1; i >= 0; i--) {
    if (enemies[i].hp <= 0) { scene.remove(enemies[i].obj); enemies.splice(i, 1); }
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
  for (const e of enemies) scene.remove(e.obj);
  enemies.length = 0;
  playerBullets.clear();
  enemyBullets.clear();
  score = 0; kills = 0;
  resetPlayer();
  state = 'playing';
  stateTimer = 0;
  intermission = 0;
  hideTitle();
  startWave(START_WAVE);
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
  hctx.fillText(state === 'playing' && intermission > 0 ? 'NEXT WAVE...' : '', 20, 232);

  // Radar: top-down around your viewpoint, your facing is up.
  const cx = W - 128, cy = H / 2, R = 108, range = 9;
  hctx.strokeStyle = 'rgba(80,220,255,0.5)';
  hctx.lineWidth = 2;
  hctx.beginPath(); hctx.arc(cx, cy, R, 0, Math.PI * 2); hctx.stroke();
  hctx.beginPath(); hctx.arc(cx, cy, R / 2, 0, Math.PI * 2); hctx.stroke();
  hctx.beginPath(); hctx.moveTo(cx, cy); hctx.lineTo(cx, cy - R); hctx.stroke();
  const f = getCamForwardFlat(_v1);
  const rx = -f.z, rz = f.x; // right vector (flat)
  const plot = (p, color, size) => {
    const dx = p.x - camPos.x, dz = p.z - camPos.z, dy = p.y - camPos.y;
    let sx = (dx * rx + dz * rz) / range * R;
    let sy = -(dx * f.x + dz * f.z) / range * R;
    const len = Math.hypot(sx, sy);
    if (len > R - 4) { sx *= (R - 4) / len; sy *= (R - 4) / len; }
    hctx.fillStyle = color;
    hctx.beginPath();
    if (dy > 0.6) { hctx.moveTo(cx + sx, cy + sy - size); hctx.lineTo(cx + sx - size, cy + sy + size); hctx.lineTo(cx + sx + size, cy + sy + size); }
    else if (dy < -0.6) { hctx.moveTo(cx + sx, cy + sy + size); hctx.lineTo(cx + sx - size, cy + sy - size); hctx.lineTo(cx + sx + size, cy + sy - size); }
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
    else c.add(pointer);
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
  if (state === 'title') showMessage('BATTLE ROOM', 'Pull the RIGHT TRIGGER to start', 9999);
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

// ---------------------------------------------------------------- desktop input
const keys = new Set();
const mouse = new THREE.Vector2(0, 0);
let mouseDown = false, lookDrag = false, lastMX = 0, lastMY = 0;
let yaw = 0, pitch = 0;
const raycaster = new THREE.Raycaster();

window.addEventListener('keydown', (e) => {
  keys.add(e.code);
  if (e.code === 'KeyR' && state !== 'title') startGame();
  if (e.code === 'Enter' && state !== 'playing' && !renderer.xr.isPresenting) startGame();
  if (e.code === 'KeyC') rig.position.set(0, 0, 0);
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
};
let prevRestartBtn = false;
const dragLast = new THREE.Vector3();
let dragging = false;

function gatherInputVR(dt) {
  input.hasSteer = false; input.fire = false; input.boost = false; input.brake = false; input.restart = false;
  input.move.set(0, 0, 0);
  const R = hands.right, L = hands.left;
  rig.updateMatrixWorld(true);

  if (R && R.userData.source && R.userData.source.gamepad) {
    const gp = R.userData.source.gamepad;
    R.getWorldPosition(input.origin);
    input.dir.set(0, 0, -1).applyQuaternion(R.getWorldQuaternion(_q)).normalize();
    input.hasSteer = true;
    const trig = gp.buttons[0] && gp.buttons[0].pressed;
    input.fire = trig;
    input.boost = gp.buttons[1] && gp.buttons[1].pressed;
    const sy = gp.axes.length >= 4 ? gp.axes[3] : 0;
    if (sy > 0.5) input.brake = true;       // stick back = brake
    if (sy < -0.5) input.boost = true;      // stick forward = boost
    const restartBtn = trig || (gp.buttons[4] && gp.buttons[4].pressed) || (gp.buttons[5] && gp.buttons[5].pressed);
    input.restart = restartBtn && !prevRestartBtn;
    prevRestartBtn = restartBtn;
  }

  if (L && L.userData.source && L.userData.source.gamepad) {
    const gp = L.userData.source.gamepad;
    const sx = gp.axes.length >= 4 ? gp.axes[2] : 0, sy = gp.axes.length >= 4 ? gp.axes[3] : 0;
    const f = getCamForwardFlat(_v1);
    const r = _v2.set(-f.z, 0, f.x);
    const dead = (a) => (Math.abs(a) < 0.15 ? 0 : a);
    input.move.addScaledVector(f, -dead(sy) * CAM_SPEED).addScaledVector(r, dead(sx) * CAM_SPEED);
    if (gp.buttons[5] && gp.buttons[5].pressed) input.move.y += CAM_SPEED;  // Y = up
    if (gp.buttons[4] && gp.buttons[4].pressed) input.move.y -= CAM_SPEED;  // X = down
    if (gp.buttons[3] && gp.buttons[3].pressed) rig.position.set(0, 0, 0); // stick click = recentre
    // Grip + drag: grab space and pull yourself through it (translation only).
    const grip = gp.buttons[1] && gp.buttons[1].pressed;
    if (grip) {
      if (dragging) {
        _v3.subVectors(L.position, dragLast);
        rig.position.addScaledVector(_v3, -3);
      }
      dragLast.copy(L.position);
      dragging = true;
    } else dragging = false;
  }
}

function gatherInputDesktop() {
  // Look (head substitute): right-drag or arrow keys.
  const lookSpeed = 1.6 / 60;
  if (keys.has('ArrowLeft')) yaw += lookSpeed;
  if (keys.has('ArrowRight')) yaw -= lookSpeed;
  if (keys.has('ArrowUp')) pitch = clamp(pitch + lookSpeed, -1.45, 1.45);
  if (keys.has('ArrowDown')) pitch = clamp(pitch - lookSpeed, -1.45, 1.45);
  camera.position.set(0, HEAD_H, 0);
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
  if (input.move.lengthSq() > 0) input.move.normalize().multiplyScalar(CAM_SPEED);

  raycaster.setFromCamera(mouse, camera);
  input.origin.copy(raycaster.ray.origin);
  input.dir.copy(raycaster.ray.direction);
  input.hasSteer = true;
  input.fire = mouseDown || keys.has('Space');
  input.boost = keys.has('ShiftLeft') || keys.has('ShiftRight');
  input.brake = keys.has('ControlLeft') || keys.has('KeyF');
  input.restart = false;

  if (DEMO && player.alive) {
    // Autopilot: chase the nearest enemy and shoot when lined up.
    let near = null, nd = Infinity;
    for (const e of enemies) { const d = e.obj.position.distanceTo(player.obj.position); if (d < nd) { nd = d; near = e; } }
    if (near) {
      input.origin.copy(player.obj.position);
      input.dir.subVectors(near.obj.position, player.obj.position).normalize();
      input.fire = player.fwd.angleTo(input.dir) < 0.3 && nd < 6;
      input.boost = nd > 3;
    }
  }
  if (DEMO && state === 'gameover' && stateTimer > 3) startGame();
}

// ---------------------------------------------------------------- update
function updatePlayer(dt) {
  if (!player.alive) return;
  const p = player.obj.position;
  const desired = _v1.copy(player.fwd);
  if (input.hasSteer) {
    const d = input.origin.distanceTo(p) + LEAD;
    const target = _v2.copy(input.origin).addScaledVector(input.dir, d);
    reticle.position.copy(target);
    reticle.visible = true;
    desired.subVectors(target, p).normalize();
    if (renderer.xr.isPresenting && hands.right) pointer.scale.set(1, 1, d);
  }
  const n = arenaNorm(p);
  if (n > 0.92) desired.lerp(_v3.subVectors(ARENA_C, p).normalize(), clamp((n - 0.92) * 5, 0, 1)).normalize();
  steer(player, desired.clone(), dt);
  const targetSpeed = input.boost ? BOOST : input.brake ? BRAKE : CRUISE;
  player.speed += (targetSpeed - player.speed) * Math.min(1, dt * 3);
  player.vel.copy(player.fwd).multiplyScalar(player.speed);
  p.addScaledVector(player.vel, dt);

  // Shooting, with gentle aim assist toward an enemy inside a narrow cone.
  player.fireCd -= dt;
  if (input.fire && player.fireCd <= 0 && state === 'playing') {
    const dir = player.fwd.clone();
    let bestE = null, bestA = 0.2;
    for (const e of enemies) {
      const to = _v3.subVectors(e.obj.position, p);
      const a = player.fwd.angleTo(to);
      if (a < bestA && to.length() < 7) { bestA = a; bestE = e; }
    }
    if (bestE) {
      const t = bestE.obj.position.distanceTo(p) / 7;
      const lead = _v3.copy(bestE.obj.position).addScaledVector(bestE.fwd, bestE.speed * t).sub(p).normalize();
      dir.lerp(lead, 0.6).normalize();
    }
    playerBullets.spawn(_v3.copy(p).addScaledVector(player.fwd, 0.2), dir.multiplyScalar(7).addScaledVector(player.vel, 0.5), 1.6);
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
    _v3.copy(p).addScaledVector(player.fwd, -0.1);
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
      if (segPointDist(b.prev, b.pos, player.obj.position) < 0.14) {
        b.dead = true;
        damagePlayer();
      }
    }
  }
  playerBullets.list = playerBullets.list.filter((b) => !b.dead);
  enemyBullets.list = enemyBullets.list.filter((b) => !b.dead);
}

function updateCameraRig(dt) {
  rig.position.addScaledVector(input.move, dt);
  // Keep the viewpoint within a generous bubble around the arena.
  camera.getWorldPosition(camPos);
  const n = arenaNorm(camPos);
  if (n > 1.6) {
    _v1.subVectors(camPos, ARENA_C);
    rig.position.sub(_v1.multiplyScalar(1 - 1.6 / n));
  }
}

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

  if (state === 'title') {
    // Idle demo: ship circles in front of you.
    const t = stateTimer * 0.6;
    player.obj.position.set(Math.sin(t) * 1.2, HEAD_H - 0.1 + Math.sin(t * 2) * 0.2, -1.8 + Math.cos(t) * 0.6);
    player.fwd.set(Math.cos(t), Math.cos(t * 2) * 0.33, -Math.sin(t) * 0.5).normalize();
    quatFromDir(player.fwd, player.obj.quaternion);
    reticle.visible = false;
    if (xr && input.restart) startGame();
  } else {
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
  if (msgTime > 0 && msgTime < 9000) { msgTime -= dt; if (msgTime <= 0) hideMessage(); }
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

drawHud();
renderer.setAnimationLoop(loop);
log('READY three r' + THREE.REVISION);

// Hooks for automated testing / tinkering from the console.
window.__game = {
  get state() { return state; }, get score() { return score; }, get wave() { return wave; },
  get hp() { return player.hp; }, get enemies() { return enemies.length; },
  player, enemiesList: enemies, startGame, rig, camera, renderer, scene,
};
