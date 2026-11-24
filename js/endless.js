// Endless mode: no room walls. Your ship (or your squadron's command point) stays in the middle of the view
// and the world moves round it. Space is seeded: the same spot always has the same stars, outposts and
// asteroid fields.
//   - Every star is the same size (the size stars are in Squadron mode next to the ships). You start beside
//     an ordinary star.
//   - Regions (REG units apart) each hold one site: an enemy outpost (a red star with its ships huddled round
//     it), a friendly outpost (a green star: repair and buy, a safe zone enemies keep out of), a drifting
//     asteroid field, or nothing. Enemy outposts get harder (and pay more) the further from home; friendly
//     ones are commoner near home, asteroid fields further out.
//   - Destroying an outpost (every ship round it): shockwave, debris, the red star flickers, collapses and
//     turns grey; then your ships glide onto it and land, and a small panel beside the star offers an
//     upgrade: +1 wingman, +hull, +fire rate. Friendly (green) stars: fly onto one to land; the panel offers
//     repair / buy. The game never pauses; landed ships can't be hurt; only LAUNCH takes off.
//   - Score: kills + outposts + distance reached. A destroyed ship is gone; lose them all and it's over.
// Only the sites and stars near you exist; meshes are pooled. G is the game API from main.js.
import * as THREE from '../vendor/three.module.js';
import { Panel, UI } from './ui.js?v=31';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
const REG = 26;                 // region size (one site per region)
const CELL = 4;                 // star cell size
const SEED = 1337;
const STAR_R = 0.6;             // every star (Squadron-mode star size)
const ACT_R = 11;               // an outpost wakes up when you come this close
const DEACT_R = 22;             // ...and its ships go home if you get this far away
const ENEMY_LEASH = 10;         // outpost ships never chase further than this from their star
const ROAM = new THREE.Vector3(4, 2.5, 4);   // the area round an outpost its ships keep to
const OBST_R = 12;              // stars / rocks within this range are solid (AI, collisions)
const DIST_K = 10;              // shown distance = world units x 10
const PAD_R = STAR_R + 1.8;     // fly this close to a green star (or a cleared outpost) to land on it
const SAFE_R = 5.5;             // green stars: enemies keep out, their shots fizzle
const DIE_T = 1.0;              // outpost destruction animation (s); then the ships glide onto the star
const LAND_GLIDE = 1.0;         // glide onto a cleared outpost (s)
const DOCK_GLIDE = 0.7;         // ...and onto a green star
const TIER_D = 36;              // distance per difficulty / reward tier (v30: 45, so about 25% steeper)

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
    if (I === 0 && K === 0) s = { id: key, kind: 'start', pos: new V(0, 0, 0), r: STAR_R, tier: 0, dock: false };   // an ordinary star
    else {
      const r = rng(hash(I, 0, K, 7));
      const pos = new V((I + (r() - 0.5) * 0.5) * REG, (r() - 0.5) * 8, (K + (r() - 0.5) * 0.5) * REG);
      const d = pos.length();
      const pDock = clamp(0.32 - d / 350, 0.06, 0.32);
      const u = r();
      let kind = u < pDock ? 'dock' : u < pDock + 0.55 ? 'outpost' : r() < clamp(0.25 + d / 200, 0.25, 0.8) ? 'field' : 'none';
      if (I === 0 && K === -1) kind = 'outpost';     // always one straight ahead of the start
      if (I === 1 && K === 0) kind = 'dock';         // and a friendly one close by
      s = { id: key, kind, pos, r: kind === 'outpost' || kind === 'dock' ? STAR_R : 0, tier: Math.min(9, 1 + Math.floor(d / TIER_D)), dock: kind === 'dock' };
      if (kind === 'field') {
        const n = Math.min(34, 12 + Math.floor(d / 18));
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
    const n = r() < 0.5 ? 0 : r() < 0.85 ? 1 : 2;
    for (let q = 0; q < n; q++) {
      const p = new V((i + r()) * CELL, (j + r()) * CELL, (k + r()) * CELL);
      r();                                              // (was the star's size: the layout stays the same)
      const s = site(Math.round(p.x / REG), Math.round(p.z / REG));
      if (s.kind !== 'none' && p.distanceTo(s.pos) < (s.kind === 'field' ? 8 : 5)) continue;   // keep sites clear
      if (p.length() < 5) continue;                     // and the start
      list.push({ pos: p, r: STAR_R, kind: 'star' });
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
  const lineMat = (c) => new THREE.LineBasicMaterial({ color: c, transparent: true, opacity: 0, depthWrite: false });
  function pool(n, geo, color) {
    const list = [];
    for (let i = 0; i < n; i++) { const m = new THREE.LineSegments(Array.isArray(geo) ? geo[0] : geo, lineMat(color)); m.visible = false; world.add(m); list.push(m); }
    return list;
  }
  const starPool = pool(64, ico, 0x9fb8dd), rockPool = pool(64, rockGeos, 0xb08a66);
  // Shockwaves (destroyed outposts): two flat rings, one tilted.
  const ringPts = [];
  for (let i = 0; i < 48; i++) { const a = (i / 48) * Math.PI * 2, b = ((i + 1) / 48) * Math.PI * 2; ringPts.push(new V(Math.cos(a), 0, Math.sin(a)), new V(Math.cos(b), 0, Math.sin(b))); }
  const ringGeo = new THREE.BufferGeometry().setFromPoints(ringPts);
  const shockPool = pool(1, ringGeo, 0xffb08a);
  const STAR_COL = { star: 0x9fb8dd, outpost: 0xff5544, dock: 0x55ff88, dead: 0xb8c2cc };
  // Direction hints: an arrow (long shaft, two short prongs at the head) slowly turning about its own axis,
  // at the edge of the view: red to the next outpost, green to the nearest friendly outpost when a ship is
  // hurt.
  const hintGeo = new THREE.BufferGeometry().setFromPoints([
    new V(0, 0, -0.75), new V(0, 0, 0.75),                  // shaft (1.5)
    new V(0, 0, 0.75), new V(-0.2, 0, 0.47),                // prongs (about 0.34 each)
    new V(0, 0, 0.75), new V(0.2, 0, 0.47),
  ]);
  const hints = [0xff6655, 0x66ff99].map((c) => { const m = new THREE.LineSegments(hintGeo, new THREE.LineBasicMaterial({ color: c, transparent: true, opacity: 0.7, depthWrite: false })); m.visible = false; board.add(m); return m; });

  // ---------------------------------------------------------------- run state
  // landed: the site you are sitting on (a green star, or a cleared outpost with an upgrade waiting).
  // latch: a site you just took off from (no re-landing until you have flown clear of it).
  const run = { on: false, credits: 0, maxDist: 0, outposts: 0, hullUps: 0, fireUps: 0, bought: 0, destroyed: new Set(), reward: new Set(), active: null, landed: null, latch: null, t: 0, dying: [] };
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

  // ---------------------------------------------------------------- landing: upgrades and the friendly shop
  function fleet() { return G.gameMode() === 'squadron' ? G.bots.filter((b) => b.alive).length : 1; }
  function hurt() { return G.gameMode() === 'squadron' ? G.bots.some((b) => b.alive && b.hp < G.botMax()) : G.player.hp < G.playerMax(); }
  const cost = { repair: () => 300, fighter: () => 1500 + 500 * run.bought, hull: () => Math.round(1200 * (1 + 0.5 * run.hullUps)) };
  // The choices shown on the ring while you are landed (ids are the ring buttons).
  function options() {
    const s = run.landed;
    if (!s) return null;
    if (s.kind === 'outpost') {
      if (!run.reward.has(s.id)) return { kind: 'cleared', title: 'CLEARED OUTPOST', sub: 'Upgrade taken - LAUNCH when ready', opts: [] };
      const full = fleet() >= 4;
      return { kind: 'reward', title: 'OUTPOST DESTROYED', sub: 'Pick an upgrade', opts: [
        full ? { id: 'credits', label: '+1,000 CREDITS', sub: 'Your fleet is full (4 ships)', ok: true } : { id: 'wingman', label: '+1 WINGMAN', sub: fleet() === 1 ? 'A wingman joins: Squadron controls' : 'Another fighter joins the squadron', ok: true },
        { id: 'hull', label: '+HULL', sub: 'Every ship +1 hull, fully repaired', ok: true },
        { id: 'fire', label: '+FIRE RATE', sub: 'Every ship fires 15% faster', ok: true },
      ] };
    }
    const row = (id, label, c, can, why) => ({ id, label, sub: can ? N(c) : why, ok: can && run.credits >= c });
    return { kind: 'dock', title: 'FRIENDLY OUTPOST', sub: `Credits ${N(run.credits)}   Fleet ${fleet()} / 4`, opts: [
      row('repair', 'REPAIR ALL', cost.repair(), hurt(), 'all fine'),
      row('fighter', 'NEW FIGHTER', cost.fighter(), fleet() < 4, 'fleet full'),
      row('hull', 'HULL +1', cost.hull(), true, ''),
    ] };
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
    const s = run.landed, o = options();
    if (!s || !o) return;
    if (id === 'launch') {
      G.click(); G.takeOff();
      run.latch = s; run.landed = null; showPopup(false);
      G.log('endless launch');
      return;
    }
    const opt = o.opts.find((x) => x.id === id);
    if (!opt || !opt.ok) return;
    if (o.kind === 'reward') {
      if (id === 'wingman') addWingman();
      else if (id === 'credits') run.credits += 1000;
      else if (id === 'hull') hullUp();
      else if (id === 'fire') { run.fireUps++; G.setUpgrades(run.hullUps, Math.pow(0.85, run.fireUps)); }
      run.reward.delete(s.id);
      G.chime(); G.log('endless upgrade ' + id);
      G.showMessage('UPGRADE', { wingman: 'A new fighter joins you', credits: '+1,000 credits', hull: 'Hull +1, all ships repaired', fire: 'Fire rate +15%' }[id], 2.2);
      drawPopup();
      return;
    }
    G.click();
    const c = cost[id]();
    if (id === 'repair') { run.credits -= c; repairAll(); }
    else if (id === 'fighter') { run.credits -= c; run.bought++; addWingman(); G.landSlots(); }
    else if (id === 'hull') { run.credits -= c; hullUp(); }
    G.log('endless buy ' + id);
    drawPopup();
  }

  // The popup: a small panel in the world beside the star you are sitting on (pointer + trigger). It lists
  // the upgrade choice or the repair / buy rows, and LAUNCH, the only way to take off again.
  const POP_W = 0.3;
  const popup = new Panel(POP_W, 760, 640);
  G.rig.add(popup.mesh);
  popup.onClick = (id) => click(id);
  function drawPopup() {
    const P = popup, W = P.W, o = options();
    P.begin();
    if (o) {
      const col = o.kind === 'dock' ? '#9fffc8' : o.kind === 'reward' ? UI.gold : UI.title;
      P.text(o.title, W / 2, 62, { size: 44, bold: true, color: col, align: 'center', maxW: W - 40 });
      P.text(o.sub, W / 2, 110, { size: 28, color: UI.text, align: 'center', maxW: W - 40 });
      o.opts.forEach((r, i) => {
        if (o.kind === 'reward') {
          const y = 136 + i * 122;
          P.button(r.id, 30, y, W - 60, 108, '', {});
          P.text(r.label, W / 2, y + 48, { size: 40, bold: true, color: UI.gold, align: 'center', maxW: W - 100 });
          P.text(r.sub, W / 2, y + 88, { size: 26, color: UI.text, align: 'center', maxW: W - 100 });
        } else {
          const y = 140 + i * 104;
          if (r.ok) P.button(r.id, 30, y, W - 60, 88, '', {});
          else { P.g.strokeStyle = UI.faint; P.g.lineWidth = 2; P.g.strokeRect(31, y + 1, W - 62, 86); }
          P.text(r.label, 60, y + 56, { size: 36, bold: true, color: r.ok ? UI.title : UI.dim, maxW: 400 });
          P.text(r.sub, W - 60, y + 56, { size: 34, color: r.ok ? UI.gold : UI.dim, align: 'right', maxW: 260 });
        }
      });
    }
    P.button('launch', 30, 512, W - 60, 104, 'LAUNCH', { big: true, size: 50 });
    P.end();
  }
  popup.redraw = drawPopup;                          // hover highlight (main.js)
  let popKey = '';
  function showPopup(on) {
    if (on) { drawPopup(); placePopup(); }
    popup.visible = on;
    popKey = '';
  }
  // Beside the star (to its right as seen from your seat), facing you.
  const _sw = new V(), _sr = new V();
  function placePopup() {
    const s = run.landed;
    if (!s) return;
    const k = JSON.stringify(options()) + run.credits;
    if (k !== popKey) { popKey = k; drawPopup(); }
    G.board.updateMatrixWorld(true);
    _sw.copy(s.pos).sub(G.VC);                       // (the world group is shifted by -VC)
    G.board.localToWorld(_sw);
    G.rig.worldToLocal(_sw);
    const seat = G.seat, sc = G.board.scale.x;
    _sr.set(seat.z - _sw.z, 0, _sw.x - seat.x).normalize();   // right of the line from the seat to the star
    if (_sr.lengthSq() < 0.5) _sr.set(1, 0, 0);
    popup.mesh.position.copy(_sw).addScaledVector(_sr, s.r * sc + 0.05 + POP_W / 2);
    popup.mesh.position.y += 0.04;
    G.faceSeat(popup.mesh);
  }
  function landAt(pad, glide) {
    run.landed = pad;
    G.land(pad.pos, pad.r, glide);
    G.chime();
    G.log('endless landed ' + pad.id);
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
  // Outpost destroyed: shockwave, debris, the star flickers and collapses, then turns grey. Big boom + hit-stop.
  function destroyOutpost(s) {
    run.destroyed.add(s.id); run.active = null;
    run.dying.push({ s, t: 0 });
    G.blast(s.pos);
    if (run.demo) { run.demoCleared = true; return; }
    const bonus = 1000 * s.tier;
    run.outposts++;
    run.reward.add(s.id);
    run.autoLand = s;
    G.addScore(bonus); run.credits += bonus;
    G.showMessage('OUTPOST DESTROYED', `+${N(bonus)} - pick an upgrade`, 3);
    G.log(`endless outpost destroyed ${s.id} bonus=${bonus}`);
  }
  function nearestOf(c, test, maxR = 3) {
    let best = null, bd = Infinity;
    const I = Math.round(c.x / REG), K = Math.round(c.z / REG);
    for (let a = -maxR; a <= maxR; a++) for (let b = -maxR; b <= maxR; b++) {
      const s = site(I + a, K + b);
      if (!test(s)) continue;
      const d = s.pos.distanceTo(c);
      if (d < bd) { bd = d; best = s; }
    }
    return best;
  }
  const nearestOutpost = (c, maxR = 3) => nearestOf(c, (s) => s.kind === 'outpost' && !run.destroyed.has(s.id), maxR);
  const nearestDock = (c, maxR = 3) => nearestOf(c, (s) => s.dock, maxR);

  // ---------------------------------------------------------------- lobby preview routes
  // Seeded routes for the lobby's Endless preview: start a little before an asteroid field, pass beside it,
  // then on to a nearby outpost.
  let routes = null;
  function demoRoute(i) {
    if (!routes) {
      routes = [];
      for (let I = -4; I <= 4; I++) for (let K = -4; K <= 4; K++) {
        const f = site(I, K);
        if (f.kind !== 'field') continue;
        for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
          const o = site(I + a, K + b);
          const d = o.kind === 'outpost' ? o.pos.distanceTo(f.pos) : 0;
          if (d > 14 && d < 32) routes.push({ f, o, d });
        }
      }
      routes.sort((x, y) => x.f.pos.length() + x.d - (y.f.pos.length() + y.d));
    }
    const out = { start: new V(), pass: new V(), outpost: new V() };
    if (!routes.length) {                            // (never with this seed) start -> the first outpost
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
      if (G.enemies.length === 0) destroyOutpost(run.active);
      else if (sd > DEACT_R) deactivate();
      else for (const e of G.enemies) if (e.obj.position.distanceTo(run.active.pos) > ENEMY_LEASH) { e.scatterT = 1; e.goal.copy(run.active.pos); }
    } else {
      const s = nearestOutpost(c, 1);
      if (s && s.pos.distanceTo(c) < ACT_R) activate(s);
    }
    for (const a of run.dying) a.t += dt;
    run.dying = run.dying.filter((a) => a.t < DIE_T + 0.2);
    // Just cleared: once the short effect is over, your ships glide onto the star and land.
    if (run.autoLand && !run.demo) {
      const a = run.dying.find((x) => x.s === run.autoLand);
      if (!a || a.t >= DIE_T) { landAt(run.autoLand, LAND_GLIDE); run.autoLand = null; }
    }
    // Green stars are safe zones: enemies turn away, their shots fizzle out.
    for (const s of near.sites) {
      if (!s.dock) continue;
      for (const e of G.enemies) {
        const ed = e.obj.position.distanceTo(s.pos);
        if (ed < SAFE_R + 1) { e.scatterT = 1; e.goal.copy(e.obj.position).sub(s.pos).setLength(SAFE_R + 4).add(s.pos); }
        if (ed < SAFE_R * 0.8) e.obj.position.sub(s.pos).setLength(SAFE_R * 0.8).add(s.pos);
      }
      for (const b of G.enemyBullets()) if (!b.dead && b.pos.distanceTo(s.pos) < SAFE_R) b.dead = true;
    }
    // Landing: fly onto a green star, or onto a cleared outpost with an upgrade waiting. Steer away to leave.
    if (!run.demo) {
      if (run.landed && !G.landed()) { run.latch = run.landed; run.landed = null; showPopup(false); }
      if (run.latch && run.latch.pos.distanceTo(c) > PAD_R + 1.5) run.latch = null;
      if (!run.landed && !run.autoLand) {
        const pad = nearestOf(c, (s) => s.dock || run.reward.has(s.id), 1);
        if (pad && pad !== run.latch && pad.pos.distanceTo(c) < PAD_R) landAt(pad, pad.dock ? DOCK_GLIDE : LAND_GLIDE);
      }
      // The panel shows once the ships have settled on the star.
      if (run.landed && G.settled() && !popup.visible) showPopup(true);
      if (popup.visible) placePopup();
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
  // Pooled meshes for what is inside the view window. Far things fade gradually over a long band (from 30%
  // of the window's radius out to its edge), so nothing pops in or out.
  function draw(c) {
    const W = WIN();
    const fade = (p, r) => 1 - smooth(W * 0.3, W, WD(p, c) - r);
    let si = 0, ri = 0, ki = 0;
    const putStar = (p, r, col, a0 = 0.65, scale = r) => {
      const a = fade(p, r);
      if (a <= 0.01 || si >= starPool.length) return;
      const m = starPool[si++];
      m.position.copy(p); m.scale.setScalar(scale); m.rotation.set(0, run.t * 0.05, 0); m.material.color.setHex(col); m.material.opacity = a0 * a; m.visible = true;
    };
    for (const s of near.stars) putStar(s.pos, s.r, STAR_COL.star);
    for (const s of near.sites) {
      if (s.r > 0) {
        const die = run.dying.find((x) => x.s === s);
        if (die) {
          // Flicker red / white while collapsing, then swell back as a grey star.
          const t = die.t, k = t / DIE_T;
          // A gentle flicker (red / soft pink) while it shrinks, then back as a grey star; one faint ring.
          const col = k < 0.6 ? (Math.floor(t * 12) % 2 ? 0xffb3a8 : STAR_COL.outpost) : STAR_COL.dead;
          const sc = k < 0.6 ? s.r * (1 - 0.5 * (k / 0.6)) : s.r * (0.5 + 0.5 * smooth(0.6, 1, k));
          putStar(s.pos, s.r, col, 0.8, sc);
          if (ki < shockPool.length) {
            const m = shockPool[ki++], q = clamp(t / 0.8, 0, 1);
            m.position.copy(s.pos); m.rotation.set(0, 0, 0); m.scale.setScalar(0.5 + q * 3.5);
            m.material.opacity = (1 - q) * 0.45 * fade(s.pos, 0); m.visible = q < 1;
          }
        } else {
          const col = s.dock ? STAR_COL.dock : s.kind === 'outpost' ? (run.destroyed.has(s.id) ? STAR_COL.dead : STAR_COL.outpost) : STAR_COL.star;
          // A cleared outpost with an upgrade waiting pulses gently.
          const pulse = run.reward.has(s.id) ? 0.55 + 0.35 * Math.sin(run.t * 4) : 0.75;
          putStar(s.pos, s.r, col, s.kind === 'start' ? 0.65 : pulse);
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
    for (let i = ki; i < shockPool.length; i++) shockPool[i].visible = false;
    // Hints: next outpost (red), and the nearest friendly outpost (green) when a ship is damaged.
    const targets = [run.active ? null : nearestOutpost(c), !run.demo && hurt() && !run.landed ? nearestDock(c) : null];
    hints.forEach((h, i) => {
      const t = targets[i];
      if (!t || t.pos.distanceTo(c) < W * 0.8) { h.visible = false; return; }
      _a.subVectors(t.pos, c).normalize();
      h.position.copy(_a).multiplyScalar(W * 0.72);
      h.lookAt(_a.multiplyScalar(W * 2));
      h.rotateZ(run.t * 0.7 + i * 1.6);               // slowly turns about the way it points
      h.scale.setScalar(0.9);
      h.material.opacity = 0.8 + 0.2 * Math.sin(run.t * 2.5);
      h.visible = true;
    });
  }

  return {
    start(opts = {}) {
      run.demo = !!opts.demo; run.demoCleared = false;   // demo: the lobby preview (no score, landing or messages)
      run.on = true; run.credits = 0; run.maxDist = 0; run.outposts = 0; run.hullUps = 0; run.fireUps = 0; run.bought = 0;
      run.destroyed = new Set(); run.reward = new Set(); run.active = null; run.landed = null; run.latch = null; run.t = 0; run.dying = []; run.autoLand = null;
      showPopup(false);
      G.setUpgrades(0, 1);
      near = { stars: [], sites: [], at: new V(1e9, 0, 0), t: 0 };
      G.VC.copy(G.player.obj.position);
      refreshNear(); rockPositions(0); buildObstacles(); draw(G.VC);
    },
    stop() {
      run.on = false; run.landed = null; run.autoLand = null; showPopup(false);
      for (const m of [...starPool, ...rockPool, ...shockPool, ...hints]) m.visible = false;
      for (const b of G.bots) for (const m of b.obj.userData.mats) m.opacity = 1;
    },
    update,
    paused: () => false,                             // Endless never pauses (Settings still does)
    panels: () => (run.on && popup.visible ? [popup] : []),
    place() { if (popup.visible) placePopup(); },
    click,
    onKill(e) { run.credits += e.points * Math.max(1, run.active ? run.active.tier : 1); },
    info() {
      const c = G.VC, o = run.active ? null : nearestOutpost(c);
      return {
        dist: Math.round(c.length() * DIST_K), maxDist: Math.round(run.maxDist * DIST_K), credits: run.credits, fleet: fleet(), outposts: run.outposts,
        active: run.active ? run.active.tier : 0, hostiles: G.enemies.length,
        next: o ? { dist: Math.round(o.pos.distanceTo(c) * DIST_K), tier: o.tier } : null, landed: !!run.landed,
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
    get run() { return run; }, site, cellStars, nearestOutpost, nearestDock, hash, get near() { return near; }, options, hints, shockPool, starPool, popup,
    consts: { REG, STAR_R, PAD_R, SAFE_R, DIE_T, TIER_D, LAND_GLIDE },
  };
}
