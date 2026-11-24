// Endless mode: no room walls. Your ship (or your squadron's command point) stays in the middle of the view
// and the world moves round it. Space is seeded: the same spot always has the same stars, outposts and
// asteroid fields.
//   - Home: a bigger yellow star at the centre, with a friendly dock.
//   - Regions (REG units apart) each hold one site: an enemy outpost (red star, ships roaming round it),
//     a friendly dock (green ring: repair, buy a fighter or hull), a drifting asteroid field, or nothing.
//     Outposts get harder (and pay more) the further from home; docks are commoner near home, asteroid
//     fields further out.
//   - Destroying an outpost (every ship round it) gives points and an upgrade choice: +1 wingman, +hull,
//     +fire rate. With wingmen you fly with Squadron controls.
//   - Score: kills + outposts + distance reached. A destroyed ship is gone; lose them all and it's over.
// Only the sites and stars near you exist; meshes are pooled. G is the game API from main.js.
import * as THREE from '../vendor/three.module.js';
import { Panel, UI } from './ui.js?v=29';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const REG = 40;                 // region size (one site per region)
const CELL = 4;                 // star cell size
const SEED = 1337;
const ACT_R = 13;               // an outpost wakes up when you come this close
const DEACT_R = 28;             // ...and its ships go home if you get this far away
const ENEMY_LEASH = 13;         // outpost ships never chase further than this from their star
const ROAM = new THREE.Vector3(5, 3, 5);   // the area round an outpost its ships keep to
const OBST_R = 11;              // stars / rocks within this range are solid (AI, collisions)
const DIST_K = 10;              // shown distance = world units x 10

function hash(a, b, c, salt) {
  let h = Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263) ^ Math.imul(c | 0, 1442695041) ^ Math.imul(salt + SEED, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
}
function rng(seed) {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6D2B79F5) | 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

export function createEndless(G) {
  const { world, board } = G;
  const V = THREE.Vector3;
  const N = G.fmtNum;

  // ---------------------------------------------------------------- seeded world
  const sites = new Map(), cells = new Map();
  function site(I, K) {
    const key = I + ',' + K;
    let s = sites.get(key);
    if (s) return s;
    if (I === 0 && K === 0) s = { id: key, kind: 'home', pos: new V(0, 0, 0), r: 1.3, tier: 0, dock: true };
    else {
      const r = rng(hash(I, 0, K, 7));
      const pos = new V((I + (r() - 0.5) * 0.5) * REG, (r() - 0.5) * 10, (K + (r() - 0.5) * 0.5) * REG);
      const d = pos.length();
      const pDock = clamp(0.3 - d / 500, 0.05, 0.3);
      const u = r();
      let kind = u < pDock ? 'dock' : u < pDock + 0.55 ? 'outpost' : r() < clamp(0.25 + d / 300, 0.25, 0.8) ? 'field' : 'none';
      if (I === 0 && K === -1) kind = 'outpost';     // always one straight ahead of home
      s = { id: key, kind, pos, r: kind === 'outpost' ? 0.9 : kind === 'dock' ? 0.7 : 0, tier: Math.min(9, 1 + Math.floor(d / 70)), dock: kind === 'dock' };
      if (kind === 'field') {
        const n = Math.min(34, 12 + Math.floor(d / 25));
        s.rocks = [];
        s.drift = new V(r() - 0.5, (r() - 0.5) * 0.3, r() - 0.5).normalize();
        s.phase = r() * 6.28;
        for (let i = 0; i < n; i++) {
          const a = r() * 6.28, rad = Math.sqrt(r()) * 5;
          s.rocks.push({ off: new V(Math.cos(a) * rad, (r() - 0.5) * 4, Math.sin(a) * rad), r: 0.15 + r() * r() * 0.35, geo: Math.floor(r() * 3), spin: (r() - 0.5) * 0.6, pos: new V() });
        }
      }
    }
    sites.set(key, s);
    return s;
  }
  function cellStars(i, j, k) {
    const key = i + ',' + j + ',' + k;
    let list = cells.get(key);
    if (list) return list;
    list = [];
    const r = rng(hash(i, j, k, 3));
    const n = r() < 0.45 ? 0 : r() < 0.8 ? 1 : 2;
    for (let q = 0; q < n; q++) {
      const p = new V((i + r()) * CELL, (j + r()) * CELL, (k + r()) * CELL);
      const rad = 0.14 + r() * r() * 0.42;
      const s = site(Math.round(p.x / REG), Math.round(p.z / REG));
      if (s.kind !== 'none' && p.distanceTo(s.pos) < (s.kind === 'field' ? 8 : 6)) continue;   // keep sites clear
      list.push({ pos: p, r: rad, kind: 'star' });
    }
    cells.set(key, list);
    return list;
  }

  // ---------------------------------------------------------------- meshes (pooled)
  const ico = new THREE.WireframeGeometry(new THREE.IcosahedronGeometry(1, 1));
  const rockGeos = [new THREE.DodecahedronGeometry(1, 0), new THREE.IcosahedronGeometry(1, 0), new THREE.OctahedronGeometry(1, 0)].map((g) => {
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) p.setXYZ(i, p.getX(i) * (0.8 + ((i * 7) % 5) * 0.09), p.getY(i) * 0.85, p.getZ(i));
    return new THREE.EdgesGeometry(g);
  });
  const ringGeo = new THREE.EdgesGeometry(new THREE.TorusGeometry(1, 0.08, 4, 24));
  const lineMat = (c) => new THREE.LineBasicMaterial({ color: c, transparent: true, opacity: 0, depthWrite: false });
  function pool(n, geo, color) {
    const list = [];
    for (let i = 0; i < n; i++) { const m = new THREE.LineSegments(Array.isArray(geo) ? geo[0] : geo, lineMat(color)); m.visible = false; world.add(m); list.push(m); }
    return list;
  }
  const starPool = pool(28, ico, 0x9fb8dd), rockPool = pool(48, rockGeos, 0xb08a66), ringPool = pool(4, ringGeo, 0x66ff99);
  const STAR_COL = { star: 0x9fb8dd, home: 0xffe07a, outpost: 0xff6655, dock: 0x77ffaa, dead: 0x556070 };
  // Direction hints: a small chevron at the edge of the view pointing at the next outpost (red) and, when
  // you are hurt, the nearest dock (green).
  const hintGeo = new THREE.BufferGeometry().setFromPoints([new V(-0.35, 0, -0.5), new V(0, 0, 0.5), new V(0.35, 0, -0.5), new V(0, 0, 0.5), new V(0, 0.35, -0.5), new V(0, 0, 0.5)]);
  const hints = [0xff6655, 0x66ff99].map((c) => { const m = new THREE.LineSegments(hintGeo, new THREE.LineBasicMaterial({ color: c, transparent: true, opacity: 0.6, depthWrite: false })); m.visible = false; board.add(m); return m; });

  // ---------------------------------------------------------------- run state
  const run = { on: false, credits: 0, maxDist: 0, outposts: 0, hullUps: 0, fireUps: 0, bought: 0, destroyed: new Set(), active: null, latch: true, docked: null, choice: false, t: 0 };
  let near = { stars: [], sites: [], at: new V(1e9, 0, 0), t: 0 };
  const obstPool = [];
  function obst(i) { if (!obstPool[i]) obstPool[i] = { type: 'sphere', c: new V(), r: 0, R: 0, hazard: false, ref: null }; return obstPool[i]; }

  function refreshNear() {
    const c = G.VC;
    near.at.copy(c); near.t = 0;
    near.stars = [];
    const ci = Math.floor(c.x / CELL), cj = Math.floor(c.y / CELL), ck = Math.floor(c.z / CELL), R = Math.ceil(OBST_R / CELL);
    for (let i = ci - R; i <= ci + R; i++) for (let j = cj - R; j <= cj + R; j++) for (let k = ck - R; k <= ck + R; k++) {
      for (const s of cellStars(i, j, k)) if (s.pos.distanceTo(c) < OBST_R + s.r) near.stars.push(s);
    }
    near.sites = [];
    const I = Math.round(c.x / REG), K = Math.round(c.z / REG);
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) { const s = site(I + a, K + b); if (s.kind !== 'none') near.sites.push(s); }
  }
  function rockPositions(t) {
    for (const s of near.sites) {
      if (s.kind !== 'field') continue;
      const k = Math.sin(t * 0.05 + s.phase) * 6;
      for (const rk of s.rocks) rk.pos.copy(s.pos).addScaledVector(s.drift, k).add(rk.off);
    }
  }
  // Solid things near you -> G.obstacles (the AI steers round them, ships bounce off, shots stop).
  function buildObstacles() {
    const list = G.obstacles, c = G.VC;
    list.length = 0;
    let n = 0;
    for (const s of near.stars) { if (s.pos.distanceTo(c) > OBST_R + s.r) continue; const o = obst(n++); o.c.copy(s.pos); o.r = o.R = s.r; o.hazard = false; o.ref = s; list.push(o); }
    for (const s of near.sites) {
      if (s.r > 0) { const o = obst(n++); o.c.copy(s.pos); o.r = o.R = s.r; o.hazard = false; o.ref = s; list.push(o); }
      if (s.kind === 'field') for (const rk of s.rocks) { if (rk.pos.distanceTo(c) > OBST_R) continue; const o = obst(n++); o.c.copy(rk.pos); o.r = o.R = rk.r; o.hazard = true; o.ref = rk; list.push(o); }
    }
  }

  // ---------------------------------------------------------------- the panel (dock / upgrade choice)
  const panel = new Panel(0.46, 760, 600);
  G.rig.add(panel.mesh);
  panel.onClick = (id) => click(id);
  const panelHome = new THREE.Vector3();
  function fleet() { return G.gameMode() === 'squadron' ? G.bots.filter((b) => b.alive).length : 1; }
  function hurt() { return G.gameMode() === 'squadron' ? G.bots.some((b) => b.alive && b.hp < G.botMax()) : G.player.hp < G.playerMax(); }
  const cost = { repair: () => 300, fighter: () => 1500 + 500 * run.bought, hull: () => Math.round(1200 * (1 + 0.5 * run.hullUps)) };
  function drawPanel() {
    const P = panel, W = P.W;
    P.begin();
    if (run.choice) {
      P.text('OUTPOST DESTROYED', W / 2, 62, { size: 42, bold: true, color: UI.title, align: 'center', maxW: W - 40 });
      P.text('Pick an upgrade', W / 2, 108, { size: 28, color: UI.text, align: 'center' });
      const full = fleet() >= 4;
      const opts = [full ? ['credits', '+1,000 CREDITS', 'Your fleet is full (4 ships)'] : ['wingman', '+1 WINGMAN', fleet() === 1 ? 'A wingman joins: Squadron controls' : 'Another fighter joins the squadron'],
        ['hull', '+HULL', 'Every ship +1 hull, fully repaired'], ['fire', '+FIRE RATE', 'Every ship fires 15% faster']];
      opts.forEach(([id, l, d], i) => {
        const y = 140 + i * 146;
        P.button(id, 30, y, W - 60, 120, '', { size: 40 });
        P.text(l, W / 2, y + 52, { size: 42, bold: true, color: UI.gold, align: 'center', maxW: W - 100 });
        P.text(d, W / 2, y + 96, { size: 26, color: UI.text, align: 'center', maxW: W - 100 });
      });
    } else if (run.docked) {
      P.text(run.docked.kind === 'home' ? 'DOCKED - HOME' : 'DOCKED - STATION', W / 2, 62, { size: 42, bold: true, color: '#9fffc8', align: 'center', maxW: W - 40 });
      P.text(`Credits ${N(run.credits)}    Fleet ${fleet()} / 4`, W / 2, 110, { size: 30, color: UI.text, align: 'center', maxW: W - 40 });
      const rows = [['repair', 'REPAIR ALL', cost.repair(), hurt()], ['fighter', 'NEW FIGHTER', cost.fighter(), fleet() < 4], ['hull', 'HULL +1', cost.hull(), true]];
      rows.forEach(([id, l, c, can], i) => {
        const y = 140 + i * 104, ok = can && run.credits >= c;
        if (ok) P.button(id, 30, y, W - 60, 88, '', {});
        else { P.g.strokeStyle = UI.faint; P.g.lineWidth = 2; P.g.strokeRect(31, y + 1, W - 62, 86); }
        P.text(l, 60, y + 56, { size: 36, bold: true, color: ok ? UI.title : UI.dim, maxW: 400 });
        P.text(!can ? (id === 'repair' ? 'all fine' : 'fleet full') : N(c), W - 60, y + 56, { size: 34, color: ok ? UI.gold : UI.dim, align: 'right', maxW: 260 });
      });
      P.button('launch', 30, 470, W - 60, 100, 'LAUNCH', { big: true, size: 48 });
    }
    P.end();
  }
  panel.redraw = drawPanel;                          // hover highlight (main.js) and credit changes redraw it
  function showPanel(on) {
    if (on) { drawPanel(); panel.mesh.position.copy(panelHome); G.faceSeat(panel.mesh); }
    panel.visible = on;
  }
  function addWingman() {
    if (G.gameMode() !== 'squadron') {
      // The fighter becomes the first ship of a squadron; you now command it with Squadron controls.
      const k = G.player.hp / G.playerMax();
      G.setControls('squadron');
      G.syncSquad();
      G.bots.forEach((b, i) => {
        b.alive = i < 2; b.obj.visible = b.alive; b.flash = 0; b.invuln = 1; b.speed = G.player.speed;
        b.hp = i === 0 ? Math.max(1, Math.ceil(k * G.botMax())) : G.botMax();
        G.placeBot(b, i, 2);
      });
    } else {
      const b = G.bots.find((x) => !x.alive);
      if (!b) return;
      b.alive = true; b.obj.visible = true; b.hp = G.botMax(); b.invuln = 1; b.flash = 0;
      b.obj.position.copy(G.player.obj.position).addScaledVector(G.player.fwd, -0.5);
      b.fwd.copy(G.player.fwd);
    }
    G.refreshFriends();
  }
  function repairAll() {
    G.player.hp = Math.max(G.player.hp, G.playerMax());
    for (const b of G.bots) if (b.alive) b.hp = G.botMax();
  }
  function hullUp() { run.hullUps++; G.setUpgrades(run.hullUps, Math.pow(0.85, run.fireUps)); repairAll(); }
  function click(id) {
    if (run.choice) {
      if (id === 'wingman') addWingman();
      else if (id === 'credits') run.credits += 1000;
      else if (id === 'hull') hullUp();
      else if (id === 'fire') { run.fireUps++; G.setUpgrades(run.hullUps, Math.pow(0.85, run.fireUps)); }
      else return;
      run.choice = false;
      G.chime(); G.log('endless upgrade ' + id);
      showPanel(false);
      G.showMessage('UPGRADE', { wingman: 'A new fighter joins you', credits: '+1,000 credits', hull: 'Hull +1, all ships repaired', fire: 'Fire rate +15%' }[id], 2);
      return;
    }
    if (!run.docked) return;
    G.click();
    if (id === 'launch') { run.docked = null; run.latch = true; showPanel(false); G.log('endless launch'); return; }
    const c = cost[id] && cost[id]();
    if (c === undefined || run.credits < c) return;
    if (id === 'repair' && hurt()) { run.credits -= c; repairAll(); }
    else if (id === 'fighter' && fleet() < 4) { run.credits -= c; run.bought++; addWingman(); }
    else if (id === 'hull') { run.credits -= c; hullUp(); }
    G.log('endless buy ' + id);
    drawPanel();
  }

  // ---------------------------------------------------------------- outposts
  function activate(s) {
    run.active = s;
    G.setArena(s.pos, ROAM);
    G.setAI(s.tier);
    G.setWave(s.tier);
    const sq = G.gameMode() === 'squadron';
    if (run.demo) { G.setAI(2); G.spawnGroup('pincer', 2, 1); G.spawnGroup('flank', 1, 1); return; }   // lobby: a small outpost
    for (const [role, count] of G.roster(s.tier, sq)) G.spawnGroup(role, count, s.tier);
    G.showMessage(`OUTPOST - TIER ${s.tier}`, `${G.enemies.length} hostiles defend it`, 2.4);
    G.log(`endless outpost ${s.id} tier=${s.tier} enemies=${G.enemies.length}`);
  }
  function deactivate() {
    G.clearEnemies();
    run.active = null;
  }
  function nearestOutpost(c, maxR = 3) {
    let best = null, bd = Infinity;
    const I = Math.round(c.x / REG), K = Math.round(c.z / REG);
    for (let a = -maxR; a <= maxR; a++) for (let b = -maxR; b <= maxR; b++) {
      const s = site(I + a, K + b);
      if (s.kind !== 'outpost' || run.destroyed.has(s.id)) continue;
      const d = s.pos.distanceTo(c);
      if (d < bd) { bd = d; best = s; }
    }
    return best;
  }
  function nearestDock(c, maxR = 3) {
    let best = null, bd = Infinity;
    const I = Math.round(c.x / REG), K = Math.round(c.z / REG);
    for (let a = -maxR; a <= maxR; a++) for (let b = -maxR; b <= maxR; b++) {
      const s = site(I + a, K + b);
      if (!s.dock) continue;
      const d = s.pos.distanceTo(c);
      if (d < bd) { bd = d; best = s; }
    }
    return best;
  }

  // ---------------------------------------------------------------- lobby preview routes
  // Seeded routes for the lobby's Endless preview: start a little before an asteroid field, pass beside it,
  // then on to a nearby outpost.
  let routes = null;
  function demoRoute(i) {
    if (!routes) {
      routes = [];
      for (let I = -3; I <= 3; I++) for (let K = -3; K <= 3; K++) {
        const f = site(I, K);
        if (f.kind !== 'field') continue;
        for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
          const o = site(I + a, K + b);
          const d = o.kind === 'outpost' ? o.pos.distanceTo(f.pos) : 0;
          if (d > 16 && d < 42) routes.push({ f, o, d });
        }
      }
      routes.sort((x, y) => x.f.pos.length() + x.d - (y.f.pos.length() + y.d));
    }
    const out = { start: new V(), pass: new V(), outpost: new V() };
    if (!routes.length) {                            // (never with this seed) home -> the first outpost
      const o = site(0, -1);
      out.start.set(0, 0, -3); out.pass.set(0, 0, -8); out.outpost.copy(o.pos);
      return out;
    }
    const { f, o } = routes[i % routes.length];
    const dir = new V(o.pos.x - f.pos.x, 0, o.pos.z - f.pos.z).normalize();
    const perp = new V(-dir.z, 0, dir.x);
    out.pass.copy(f.pos).addScaledVector(perp, 4.5);
    out.start.copy(out.pass).addScaledVector(dir, -12);
    out.outpost.copy(o.pos);
    return out;
  }

  // ---------------------------------------------------------------- per frame
  const WIN = () => G.BOX_B();
  const WD = (p, c) => G.winDist(p, c);            // window distance (a cube in the lobby preview)
  const _a = new V();
  function fadeShip(obj, d) {
    const a = clamp((WIN() * 1.02 - d) / (WIN() * 0.22), 0, 1);
    for (const m of obj.userData.mats) m.opacity = a;
    obj.userData.winA = a;
  }
  function update(dt) {
    if (!run.on) return;
    run.t += dt;
    const c = G.VC.copy(G.player.obj.position);
    near.t += dt;
    if (near.at.distanceTo(c) > 1 || near.t > 0.5) refreshNear();
    rockPositions(run.t);
    buildObstacles();
    // Distance: score for every new 0.1 unit further from home than before.
    const d = c.length();
    if (d > run.maxDist && !run.demo) { G.addScore(Math.floor(d * DIST_K) - Math.floor(run.maxDist * DIST_K)); run.maxDist = d; }
    // Outposts: wake the nearest one when you come close; its ships go home if you leave.
    if (run.active) {
      const sd = run.active.pos.distanceTo(c);
      if (G.enemies.length === 0 && run.demo) { run.destroyed.add(run.active.id); run.active = null; run.demoCleared = true; }
      else if (G.enemies.length === 0) {
        const s = run.active, bonus = 1000 * s.tier;
        run.destroyed.add(s.id); run.outposts++; run.active = null;
        G.addScore(bonus); run.credits += bonus;
        run.choice = true; showPanel(true);
        G.chime();
        G.showMessage('OUTPOST DESTROYED', `+${N(bonus)} - pick an upgrade on your right`, 3);
        G.log(`endless outpost destroyed ${s.id} bonus=${bonus}`);
      } else if (sd > DEACT_R) deactivate();
      else for (const e of G.enemies) if (e.obj.position.distanceTo(run.active.pos) > ENEMY_LEASH) { e.scatterT = 1; e.goal.copy(run.active.pos); }
    } else {
      const s = nearestOutpost(c, 1);
      if (s && s.pos.distanceTo(c) < ACT_R) activate(s);
    }
    // Docks: fly into the green ring with no enemy near to dock (the game pauses while you shop).
    const dk = nearestDock(c, 1);
    const dockR = dk ? dk.r + 1.7 : 0;
    if (dk && run.latch && dk.pos.distanceTo(c) > dockR + 1.5) run.latch = false;
    if (dk && !run.demo && !run.latch && !run.docked && !run.choice && dk.pos.distanceTo(c) < dockR && !G.enemies.some((e) => e.obj.position.distanceTo(c) < 10)) {
      run.docked = dk; showPanel(true);
      G.chime();
      G.showMessage('DOCKED', 'Repair and refit on your right', 2.5);
      G.log('endless docked ' + dk.id);
    }
    // Rocks hurt on contact (ships bounce off them: they are solid obstacles too).
    for (const o of G.obstacles) {
      if (!o.hazard) continue;
      if (G.gameMode() !== 'squadron') { if (G.player.alive && G.player.obj.position.distanceTo(o.c) < o.r + 0.12 * G.S + 0.03) G.damagePlayer(null); }
      else for (const b of G.bots) if (b.alive && b.obj.position.distanceTo(o.c) < o.r + 0.12 * G.S + 0.03) G.damageBot(b, null);
      for (const e of G.enemies) {
        if (e.hp > 0 && (e.rockCd = (e.rockCd || 0) - dt) <= 0 && e.obj.position.distanceTo(o.c) < o.r + e.radius + 0.03) { e.rockCd = 1; G.damageEnemy(e, 1); }
      }
    }
    // Shots stop at stars and rocks (Squadron controls already do this in main.js).
    if (G.gameMode() !== 'squadron') for (const L of [G.playerBullets(), G.enemyBullets()]) for (const b of L) if (!b.dead && G.obstInside(b.pos)) b.dead = true;
    // Ships fade out at the edge of the view window.
    for (const e of G.enemies) fadeShip(e.obj, WD(e.obj.position, c));
    for (const b of G.bots) if (b.alive) fadeShip(b.obj, WD(b.obj.position, c));
    draw(c);
  }
  // Pooled meshes for what is inside the view window, faded at its edge.
  function draw(c) {
    const W = WIN();
    const fade = (p, r) => clamp((W - (WD(p, c) - r)) / (W * 0.25), 0, 1);
    let si = 0, ri = 0, gi = 0;
    const putStar = (p, r, col) => {
      const a = fade(p, r);
      if (a <= 0.01 || si >= starPool.length) return;
      const m = starPool[si++];
      m.position.copy(p); m.scale.setScalar(r); m.material.color.setHex(col); m.material.opacity = 0.6 * a; m.visible = true;
    };
    for (const s of near.stars) putStar(s.pos, s.r, STAR_COL.star);
    for (const s of near.sites) {
      if (s.r > 0) {
        const col = s.kind === 'home' ? STAR_COL.home : s.kind === 'dock' ? STAR_COL.dock : run.destroyed.has(s.id) ? STAR_COL.dead : STAR_COL.outpost;
        putStar(s.pos, s.r, col);
        if (s.dock && gi < ringPool.length) {
          const a = fade(s.pos, s.r + 1.7);
          if (a > 0.01) { const m = ringPool[gi++]; m.position.copy(s.pos); m.scale.setScalar(s.r + 1.1); m.rotation.set(Math.PI / 2, 0, run.t * 0.2); m.material.opacity = 0.7 * a; m.visible = true; }
        }
      }
      if (s.kind === 'field') for (const rk of s.rocks) {
        const a = fade(rk.pos, rk.r);
        if (a <= 0.01 || ri >= rockPool.length) continue;
        const m = rockPool[ri++];
        m.geometry = rockGeos[rk.geo];
        m.position.copy(rk.pos); m.scale.setScalar(rk.r); m.rotation.set(run.t * rk.spin, run.t * rk.spin * 0.7, 0);
        m.material.opacity = 0.85 * a; m.visible = true;
      }
    }
    for (let i = si; i < starPool.length; i++) starPool[i].visible = false;
    for (let i = ri; i < rockPool.length; i++) rockPool[i].visible = false;
    for (let i = gi; i < ringPool.length; i++) ringPool[i].visible = false;
    // Hints: next outpost (red), and the nearest dock (green) when a ship is damaged.
    const targets = [run.active ? null : nearestOutpost(c), !run.demo && hurt() ? nearestDock(c) : null];
    hints.forEach((h, i) => {
      const t = targets[i];
      if (!t || t.pos.distanceTo(c) < W * 0.9) { h.visible = false; return; }
      _a.subVectors(t.pos, c).normalize();
      h.position.copy(_a).multiplyScalar(W * 0.92);
      h.lookAt(_a.multiplyScalar(W * 2));
      h.scale.setScalar(0.35);
      h.material.opacity = 0.35 + 0.25 * Math.sin(run.t * 3);
      h.visible = true;
    });
  }

  return {
    start(opts = {}) {
      run.demo = !!opts.demo; run.demoCleared = false;   // demo: the lobby preview (no score, panel or messages)
      run.on = true; run.credits = 0; run.maxDist = 0; run.outposts = 0; run.hullUps = 0; run.fireUps = 0; run.bought = 0;
      run.destroyed = new Set(); run.active = null; run.latch = true; run.docked = null; run.choice = false; run.t = 0;
      G.setUpgrades(0, 1);
      near = { stars: [], sites: [], at: new V(1e9, 0, 0), t: 0 };
      G.VC.copy(G.player.obj.position);
      refreshNear(); rockPositions(0); buildObstacles(); draw(G.VC);
      showPanel(false);
    },
    stop() {
      run.on = false;
      showPanel(false);
      for (const m of [...starPool, ...rockPool, ...ringPool, ...hints]) m.visible = false;
      for (const b of G.bots) for (const m of b.obj.userData.mats) m.opacity = 1;
    },
    update,
    paused: () => run.on && (run.choice || !!run.docked),
    panels: () => (run.on ? [panel] : []),
    place() { G.placeSide(panel.mesh, 1, 0.46); panelHome.copy(panel.mesh.position); },
    onKill(e) { run.credits += e.points * Math.max(1, run.active ? run.active.tier : 1); },
    info() {
      const c = G.VC, o = run.active ? null : nearestOutpost(c);
      return {
        dist: Math.round(c.length() * DIST_K), maxDist: Math.round(run.maxDist * DIST_K), credits: run.credits, fleet: fleet(), outposts: run.outposts,
        active: run.active ? run.active.tier : 0, hostiles: G.enemies.length,
        next: o ? { dist: Math.round(o.pos.distanceTo(c) * DIST_K), tier: o.tier } : null, docked: !!run.docked, choice: run.choice,
      };
    },
    saveBest() {
      const m = G.stats.modes.endless;
      m.bestScore = Math.max(m.bestScore, G.score());
      m.bestDist = Math.max(m.bestDist, Math.round(run.maxDist * DIST_K));
    },
    record() { G.recordEndless(Math.round(run.maxDist * DIST_K), G.score(), G.kills(), run.outposts); },
    endLine() { return `Distance ${N(Math.round(run.maxDist * DIST_K))}, ${N(run.outposts)} outpost${run.outposts === 1 ? '' : 's'}  (best ${N(G.stats.modes.endless.bestDist)})`; },
    demoRoute,
    // tests
    get run() { return run; }, site, cellStars, nearestOutpost, nearestDock, hash, get near() { return near; }, panel, click,
  };
}
