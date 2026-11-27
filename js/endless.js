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
//   - v33: score is earned only (kills, outposts by tier, bounties, the treasure ship, combos); distance is a
//     stat (best distance) and has milestones. Outposts are tougher (more ships, smarter from tier 2),
//     patrols roam between outposts, a treasure ship sometimes flees past, kills drop credit pickups.
//     Cleared outposts offer 3 upgrade cards from a big pool (Common / Rare / Epic / Legendary), each paid
//     with credits. A destroyed ship is gone (unless rebuilt); lose them all and it's over.
//   - v34: a goal. Past the tier-9 outposts the ENEMY HOMEWORLD appears far out: a huge red star in a wide
//     clearing, defended by three waves of a big fleet. Destroy it and you win. A WARP DRIVE (friendly
//     outposts, after your first outpost win) flies your ships 5x faster in a straight line; it steers round
//     stars and drops out near any outpost. Gentler difficulty curve, cheaper ships, wireframe credits,
//     the outpost panel shows as soon as you head in to land, always drawn over the stars, and much less text.
// Only the sites and stars near you exist; meshes are pooled. G is the game API from main.js.
import * as THREE from '../vendor/three.module.js';
import { Panel, UI } from './ui.js?v=36';

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
const LAND_KEEP = 4.5;          // v35: landed anywhere, enemies are held at least this far off (patrols leave)
const DIE_T = 1.0;              // outpost destruction animation (s); then the ships glide onto the star
const LAND_GLIDE = 1.0;         // glide onto a cleared outpost (s)
const DOCK_GLIDE = 0.7;         // ...and onto a green star
const TIER_D = 36;              // distance per difficulty / reward tier (v30: 45, so about 25% steeper)
const PATROL_T = [38, 62];      // a patrol turns up every 38 - 62 s while you are between outposts
const TREASURE_T = [70, 120];   // a treasure ship flees past every 70 - 120 s
const MILESTONE = 100;          // distance milestone every 100 units (1,000 shown)
const COMBO_T = 2.5;            // kills within this many seconds chain into a combo
const WARP_STOP = 4.5;          // v35: warp drops out this close to the outpost dead ahead (45 shown; v34: 130 from any)
const WARP_MIN = WARP_STOP;     // (v34: no warp within 150 of any outpost - gone; only one dead ahead blocks)
const WARP_CONE_W = 1.6;        // the "dead ahead" cone: this wide at your ship ...
const WARP_CONE_TAN = Math.tan(10 * Math.PI / 180);   // ... opening at 10 degrees
const WARP_IGNORE = PAD_R + 1.2;   // the star you are on / taking off from never counts
const WARP_COST = 2000;
const HOME_UNLOCK = 9 * 36;     // the enemy homeworld appears once you are past the tier-9 outposts
const HOME_AHEAD = 120;         // ... this far beyond where you are (1,200 shown)
const HOME_R = 3.2;             // much bigger than a star (0.6)
const HOME_CLEAR = 24;          // the clearing round it: no stars, outposts or asteroid fields
const HOME_WAKE = 14;           // its fleet launches when you come this close
const HOME_LEAVE = 40;          // ... and pulls back if you get this far away
const HOME_WAVES = 1;            // v35: one massive swarm (v34: three waves)
const THREAT_T = 150;           // the threat rises one level every 2.5 minutes of a run (v33: 2)
const TREASURE_COL = new THREE.Color(0xffe066);
// Upgrades (v33): a pool of cards in four rarities. A cleared outpost offers 5 (v35; was 3); buy any with credits.
const OFFER_N = 5;
const RARITY = {
  common: { name: 'COMMON', col: '#8fa3b5' }, rare: { name: 'RARE', col: '#6f9cc4' },
  epic: { name: 'EPIC', col: '#9a86b8' }, legendary: { name: 'LEGENDARY', col: '#c4a36e' },
};
const POOL = [
  { id: 'hull', name: '+HULL', rar: 'common', cost: 800, max: 6, desc: '+1 hull, repaired', code: 'HUL' },
  { id: 'fire', name: '+FIRE RATE', rar: 'common', cost: 900, max: 6, desc: '+15% fire rate', code: 'FIR' },
  { id: 'engine', name: 'ENGINE BOOST', rar: 'common', cost: 700, max: 4, desc: '+12% speed', code: 'ENG' },
  { id: 'bspeed', name: 'BULLET SPEED', rar: 'common', cost: 600, max: 3, desc: '+25% shot speed', code: 'BLT' },
  { id: 'credits', name: 'CREDIT BONUS', rar: 'common', cost: 700, max: 5, desc: '+20% credits', code: 'CR' },
  { id: 'magnet', name: 'MAGNET', rar: 'rare', cost: 2200, max: 2, desc: 'Pulls in credits', code: 'MAG' },
  { id: 'damage', name: '+DAMAGE', rar: 'rare', cost: 2600, max: 4, desc: '+40% damage', code: 'DMG' },
  { id: 'wingman', name: '+1 WINGMAN', rar: 'common', cost: 1200, max: 8, desc: '+1 fighter', code: 'WNG' },
  { id: 'drone', name: 'REPAIR DRONE', rar: 'rare', cost: 3000, max: 3, desc: 'Slow repairs', code: 'DRN' },
  { id: 'spread', name: 'SPREAD SHOT', rar: 'epic', cost: 6500, max: 1, desc: 'Fans of 3 shots', code: 'SPR' },
  { id: 'pierce', name: 'PIERCING SHOTS', rar: 'epic', cost: 6000, max: 2, desc: 'Shots pierce', code: 'PRC' },
  { id: 'shield', name: 'SHIELDS', rar: 'epic', cost: 7000, max: 2, desc: 'Blocks a hit', code: 'SHD' },
  { id: 'homing', name: 'HOMING MISSILES', rar: 'legendary', cost: 14000, max: 2, desc: 'Auto missiles', code: 'MSL' },
  { id: 'rebuild', name: 'REBUILD', rar: 'legendary', cost: 16000, max: 3, desc: 'A lost ship returns', code: 'REB' },
];
const POOL_BY = Object.fromEntries(POOL.map((u) => [u.id, u]));
const STAR_SEP = 3.0;           // stars never closer than this (centre to centre): they never overlap
const SITE_CLEAR = 5;           // ...and keep this far from red / green outposts (8 from asteroid fields)

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
      // v33: asteroid fields are much commoner (about 1 site in 5 near home, more further out).
      let kind = u < pDock ? 'dock' : u < pDock + 0.5 ? 'outpost' : r() < 0.92 ? 'field' : 'none';   // (v35: 0.92, v34: 0.55 - 0.9)
      if (I === 0 && K === -1) kind = 'outpost';     // always one straight ahead of the start
      if (I === 1 && K === 0) kind = 'dock';         // and a friendly one close by
      if (I === -1 && K === -1) kind = 'field';      // and an asteroid field you can see early on
      s = { id: key, kind, pos, r: kind === 'outpost' || kind === 'dock' ? STAR_R : 0, tier: Math.min(12, 1 + Math.floor(d / TIER_D)), dock: kind === 'dock' };
      // About 1 outpost in 7 is a gold BOUNTY outpost: tougher, double rewards, rarer cards.
      s.bounty = kind === 'outpost' && !(I === 0 && K === -1) && hash(I, 5, K, 23) % 100 < 14;
      if (kind === 'field') makeRocks(s, r, d, 5);
    }
    sites.set(key, s);
    return s;
  }
  function makeRocks(s, r, d, rad0) {
    const n = Math.min(36, 16 + Math.floor(d / 16));
    s.rocks = [];
    s.drift = new V(r() - 0.5, (r() - 0.5) * 0.3, r() - 0.5).normalize();
    s.phase = r() * 6.28;
    for (let i = 0; i < n; i++) {
      const a = r() * 6.28, rad = Math.sqrt(r()) * rad0;
      s.rocks.push({ off: new V(Math.cos(a) * rad, (r() - 0.5) * 4, Math.sin(a) * rad), r: 0.2 + r() * r() * 0.4, geo: Math.floor(r() * 3), spin: (r() < 0.5 ? -1 : 1) * (0.25 + r() * 0.5), pos: new V() });
    }
  }
  // v35: a lot more asteroid fields - besides the one-per-region sites, most region corners (between four
  // sites) hold a field of their own. Seeded like everything else, so the map is the same every run.
  const corners = new Map();
  function cornerField(I, K) {
    const key = 'f' + I + ',' + K;
    let s = corners.get(key);
    if (s !== undefined) return s;
    const r = rng(hash(I, 3, K, 41));
    s = null;
    if (r() < 0.72) {
      const pos = new V((I + 0.5 + (r() - 0.5) * 0.3) * REG, (r() - 0.5) * 6, (K + 0.5 + (r() - 0.5) * 0.3) * REG);
      const d = pos.length();
      let clear = d > 14;
      for (let x = 0; x <= 1 && clear; x++) for (let z = 0; z <= 1 && clear; z++) { const o = site(I + x, K + z); if (o.r > 0 && o.pos.distanceTo(pos) < 10) clear = false; }
      if (clear) { s = { id: key, kind: 'field', pos, r: 0, tier: Math.min(12, 1 + Math.floor(d / TIER_D)), dock: false, bounty: false, corner: true }; makeRocks(s, r, d, 3.5 + r() * 2); }
    }
    corners.set(key, s);
    return s;
  }
  // Star candidates of a cell: a pure function of the cell (seeded), each with its own priority.
  const raws = new Map();
  function rawCell(i, j, k) {
    const key = i + ',' + j + ',' + k;
    let list = raws.get(key);
    if (list) return list;
    list = [];
    const r = rng(hash(i, j, k, 3));
    const n = r() < 0.3 ? 0 : r() < 0.6 ? 1 : 2;      // (v32: more candidates, as spacing drops some)
    for (let q = 0; q < n; q++) {
      const p = new V((i + r()) * CELL, (j + r()) * CELL, (k + r()) * CELL);
      list.push({ p, prio: r() + hash(i, j, k, 11 + q) * 1e-12 });   // (the hash breaks exact ties)
    }
    raws.set(key, list);
    return list;
  }
  // v32: no two stars ever overlap. A candidate is kept only if it clears every red / green outpost,
  // asteroid field and the start near it, and no (site-clear) candidate within STAR_SEP outranks it. That
  // only looks at the seeded candidates themselves, so the result never depends on where you flew first.
  function siteClear(p) {
    if (p.length() < 5) return false;                 // the start
    const I = Math.round(p.x / REG), K = Math.round(p.z / REG);
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
      const s = site(I + a, K + b);
      if (s.kind === 'none' || s.kind === 'start') continue;
      if (p.distanceTo(s.pos) < (s.kind === 'field' ? 8 : SITE_CLEAR)) return false;
    }
    return true;
  }
  function cellStars(i, j, k) {
    const key = i + ',' + j + ',' + k;
    let list = cells.get(key);
    if (list) return list;
    list = [];
    for (const c of rawCell(i, j, k)) {
      if (!siteClear(c.p)) continue;
      let ok = true;
      for (let a = -1; a <= 1 && ok; a++) for (let b = -1; b <= 1 && ok; b++) for (let d = -1; d <= 1 && ok; d++) {
        for (const o of rawCell(i + a, j + b, k + d)) {
          if (o === c || o.prio <= c.prio || o.p.distanceTo(c.p) >= STAR_SEP) continue;
          if (siteClear(o.p)) { ok = false; break; }
        }
      }
      if (ok) list.push({ pos: c.p, r: STAR_R, kind: 'star' });
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
  const starPool = pool(64, ico, 0x9fb8dd), rockPool = pool(150, rockGeos, 0xc49a70);
  // v35: every star / rock keeps the same pooled mesh for as long as it is drawn (v34 handed the pool out in
  // list order each frame, so when the near list changed, visible meshes swapped from one star to another -
  // invisible live, but recordings interpolated them across the sky for a frame). A mesh goes back to the
  // pool only after a frame hidden, so it never moves while visible.
  function slots(list) {
    const by = new Map(), free = [...list].reverse();
    let used = new Set();
    return {
      begin() { used = new Set(); },
      get(key) { let m = by.get(key); if (!m) { m = free.pop(); if (!m) return null; by.set(key, m); m.userData.fresh = true; } used.add(key); return m; },
      end() { for (const [k, m] of by) if (!used.has(k)) { m.visible = false; by.delete(k); free.push(m); } },
      clear() { for (const m of by.values()) { m.visible = false; free.push(m); } by.clear(); },
    };
  }
  const starSlots = slots(starPool), rockSlots = slots(rockPool);
  // The enemy homeworld (v34): a big red star with two slowly turning rings round it.
  const homeObj = new THREE.Group();
  homeObj.visible = false;
  world.add(homeObj);
  const homeBall = new THREE.LineSegments(new THREE.WireframeGeometry(new THREE.IcosahedronGeometry(1, 2)), lineMat(0xff3344));
  homeObj.add(homeBall);
  // Shockwaves (destroyed outposts): two flat rings, one tilted.
  const ringPts = [];
  for (let i = 0; i < 48; i++) { const a = (i / 48) * Math.PI * 2, b = ((i + 1) / 48) * Math.PI * 2; ringPts.push(new V(Math.cos(a), 0, Math.sin(a)), new V(Math.cos(b), 0, Math.sin(b))); }
  const ringGeo = new THREE.BufferGeometry().setFromPoints(ringPts);
  const shockPool = pool(1, ringGeo, 0xffb08a);
  const homeRings = [0, 1].map((i) => { const m = new THREE.LineSegments(ringGeo, lineMat(0xff7766)); m.rotation.set(0.5 + i * 0.6, i * 1.3, 0.2); homeObj.add(m); return m; });
  const STAR_COL = { star: 0x9fb8dd, outpost: 0xff5544, dock: 0x55ff88, dead: 0xb8c2cc, bounty: 0xffcc33 };
  // Credit pickups (v33): little gold credits that drift out of destroyed ships; fly through them (or have a
  // magnet) to collect. v34: small spinning wireframe diamonds (an octahedron's 12 edges), like everything else.
  const PICK_N = 120, PICK_S = 0.055;
  const PICK_E = (() => {                            // the 12 edges of an octahedron, as 24 unit-length vertices
    const v = [[1, 0, 0], [-1, 0, 0], [0, 1.35, 0], [0, -1.35, 0], [0, 0, 1], [0, 0, -1]];
    const e = [[0, 2], [0, 3], [0, 4], [0, 5], [1, 2], [1, 3], [1, 4], [1, 5], [2, 4], [4, 3], [3, 5], [5, 2]];
    return e.flatMap(([a, b]) => [v[a], v[b]]);
  })();
  const pickGeo = new THREE.BufferGeometry();
  const pickArr = new Float32Array(PICK_N * 24 * 3);
  pickGeo.setAttribute('position', new THREE.BufferAttribute(pickArr, 3).setUsage(THREE.DynamicDrawUsage));
  pickGeo.setDrawRange(0, 0);
  const pickMesh = new THREE.LineSegments(pickGeo, new THREE.LineBasicMaterial({ color: 0xffd54a, transparent: true, opacity: 0.95, depthWrite: false }));
  pickMesh.frustumCulled = false;
  world.add(pickMesh);
  let picks = [];
  // Direction hints: an arrow (long shaft, two short prongs at the head) slowly turning about its own axis,
  // at the edge of the view: red to the next outpost, green to the nearest friendly outpost when a ship is
  // hurt.
  const hintGeo = new THREE.BufferGeometry().setFromPoints([
    new V(0, 0, -0.75), new V(0, 0, 0.75),                  // shaft (1.5)
    new V(0, 0, 0.75), new V(-0.2, 0, 0.47),                // prongs (about 0.34 each)
    new V(0, 0, 0.75), new V(0.2, 0, 0.47),
  ]);
  const hints = [0xff6655, 0x66ff99, 0xff3388].map((c) => { const m = new THREE.LineSegments(hintGeo, new THREE.LineBasicMaterial({ color: c, transparent: true, opacity: 0.7, depthWrite: false })); m.visible = false; board.add(m); return m; });

  // ---------------------------------------------------------------- run state
  // landed: the site you are sitting on (a green star, or a cleared outpost with an upgrade waiting).
  // latch: a site you just took off from (no re-landing until you have flown clear of it).
  const run = { on: false, credits: 0, maxDist: 0, outposts: 0, hullUps: 0, fireUps: 0, bought: 0, destroyed: new Set(), reward: new Set(), active: null, landed: null, latch: null, t: 0, dying: [],
    ups: {}, offers: new Map(), patrolT: 0, treasureT: 0, combo: 0, comboT: 0, mile: 0, droneT: 0, mslT: 0, rebuild: 0, landT: 0, bounties: 0, treasures: 0, patrols: 0 };
  const lv = (id) => run.ups[id] || 0;
  let near = { stars: [], sites: [], at: new V(1e9, 0, 0), t: 0 };
  const obstPool = [];
  function obst(i) { if (!obstPool[i]) obstPool[i] = { type: 'sphere', c: new V(), r: 0, R: 0, hazard: false, ref: null }; return obstPool[i]; }

  // The homeworld's clearing: nothing else exists there (stars, outposts, fields) once it has appeared.
  const inClearing = (p, pad = 0) => !!run.home && p.distanceTo(run.home.pos) < HOME_CLEAR + pad;
  function refreshNear() {
    const c = G.VC;
    near.at.copy(c); near.t = 0;
    near.stars = [];
    const ci = Math.floor(c.x / CELL), cj = Math.floor(c.y / CELL), ck = Math.floor(c.z / CELL), R = Math.ceil(OBST_R / CELL);
    for (let i = ci - R; i <= ci + R; i++) for (let j = cj - R; j <= cj + R; j++) for (let k = ck - R; k <= ck + R; k++) {
      for (const s of cellStars(i, j, k)) if (s.pos.distanceTo(c) < OBST_R + s.r && !inClearing(s.pos)) near.stars.push(s);
    }
    near.sites = [];
    const I = Math.round(c.x / REG), K = Math.round(c.z / REG);
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) { const s = site(I + a, K + b); if (s.kind !== 'none' && !inClearing(s.pos, 6)) near.sites.push(s); }
    for (let a = -2; a <= 1; a++) for (let b = -2; b <= 1; b++) { const s = cornerField(I + a, K + b); if (s && s.pos.distanceTo(c) < REG * 1.2 && !inClearing(s.pos, 6)) near.sites.push(s); }
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
    if (run.home && run.home.pos.distanceTo(c) < OBST_R + HOME_R && run.home.state !== 'dead') { const o = obst(n++); o.c.copy(run.home.pos); o.r = o.R = HOME_R; o.hazard = false; o.ref = run.home; list.push(o); }
    for (const s of near.sites) {
      if (s.r > 0) { const o = obst(n++); o.c.copy(s.pos); o.r = o.R = s.r; o.hazard = false; o.ref = s; list.push(o); }
      if (s.kind === 'field') for (const rk of s.rocks) { if (rk.pos.distanceTo(c) > OBST_R) continue; const o = obst(n++); o.c.copy(rk.pos); o.r = o.R = rk.r; o.hazard = true; o.ref = rk; list.push(o); }
    }
  }

  // ---------------------------------------------------------------- landing: upgrades and the friendly shop
  function fleet() { return G.gameMode() === 'squadron' ? G.bots.filter((b) => b.alive).length : 1; }
  function hurt() { return G.gameMode() === 'squadron' ? G.bots.some((b) => b.alive && b.hp < G.botMax()) : G.player.hp < G.playerMax(); }
  // v34: ships are cheaper (v33: 1,500 x 1.3 per ship bought).
  const cost = { repair: () => 300, fighter: () => Math.round((800 * Math.pow(1.15, run.bought)) / 50) * 50, hull: () => Math.round(1200 * (1 + 0.5 * run.hullUps)), warp: () => WARP_COST };
  // The choices shown on the ring while you are landed (ids are the ring buttons).
  function options() {
    const s = run.landed;
    if (!s) return null;
    if (s.kind === 'outpost') {
      if (!run.reward.has(s.id)) return { kind: 'cleared', title: 'CLEARED', sub: '', opts: [] };
      const of = run.offers.get(s.id) || { ids: [], bought: new Set() };
      return { kind: 'reward', title: s.bounty ? 'BOUNTY CLEARED' : 'OUTPOST CLEARED', sub: `Credits ${N(run.credits)}`, opts: of.ids.map((id) => {
        const u = POOL_BY[id], c = upCost(u), owned = of.bought.has(id);
        return { id: 'up:' + id, label: u.name, sub: u.desc, rar: u.rar, cost: c, owned, ok: !owned && run.credits >= c };
      }) };
    }
    const row = (id, label, c, can, why) => ({ id, label, sub: can ? N(c) : why, ok: can && run.credits >= c });
    const opts = [
      row('repair', 'REPAIR ALL', cost.repair(), hurt(), 'OK'),
      row('fighter', 'NEW FIGHTER', cost.fighter(), true, ''),
      row('hull', 'HULL +1', cost.hull(), true, ''),
    ];
    if (warpForSale()) opts.push(row('warp', 'WARP DRIVE', cost.warp(), true, ''));
    return { kind: 'dock', title: 'FRIENDLY OUTPOST', sub: `Credits ${N(run.credits)}   Fleet ${fleet()}`, opts };
  }
  const warpForSale = () => false;                 // v35: no longer sold - every run has it from the start
  // ---------------------------------------------------------------- upgrades (v33)
  function upCost(u) { return Math.round((u.cost * (1 + 0.5 * lv(u.id))) / 50) * 50; }
  function available(u) { return lv(u.id) < u.max; }
  function rollOffers(s) {
    // Rarer cards roll less often, but more often at higher tiers (and bounty outposts count as +2 tiers).
    const t = s.tier + (s.bounty ? 2 : 0);
    const w = { common: Math.max(20, 70 - 7 * t), rare: 22 + 3 * t, epic: 6 + 2.5 * t, legendary: 1 + 1.2 * t };
    const ids = [];
    for (let k = 0; k < OFFER_N; k++) {
      const left = POOL.filter((u) => available(u) && !ids.includes(u.id));
      if (!left.length) break;
      const rars = Object.keys(w).filter((r) => left.some((u) => u.rar === r));
      let x = Math.random() * rars.reduce((a, r) => a + w[r], 0), rar = rars[0];
      for (const r of rars) { x -= w[r]; if (x <= 0) { rar = r; break; } }
      const cand = left.filter((u) => u.rar === rar);
      ids.push(cand[Math.floor(Math.random() * cand.length)].id);
    }
    run.offers.set(s.id, { ids, bought: new Set() });
  }
  // What the upgrades do (main.js reads G.mods: damage, bullet speed, spread, piercing, speed, shields, magnet).
  function applyMods() {
    const m = G.mods;
    m.dmg = 1 + 0.4 * lv('damage'); m.bspeed = 1 + 0.25 * lv('bspeed'); m.spread = lv('spread') > 0;
    m.pierce = lv('pierce'); m.speed = 1 + 0.12 * lv('engine'); m.shield = lv('shield'); m.magnet = lv('magnet');
    G.setUpgrades(run.hullUps, Math.pow(0.85, run.fireUps));
  }
  function buyUp(id) {
    run.ups[id] = lv(id) + 1;
    if (id === 'hull') hullUp();
    else if (id === 'fire') run.fireUps++;
    else if (id === 'wingman') addWingman();
    else if (id === 'rebuild') run.rebuild++;
    applyMods();
  }
  const credit = (n) => Math.round(n * (1 + 0.2 * lv('credits')));
  function upgradeLine() {
    const parts = [];
    for (const u of POOL) { const n = lv(u.id); if (n && u.id !== 'wingman' && u.id !== 'rebuild') parts.push(u.code + (u.max > 1 ? n : '')); }
    if (run.rebuild) parts.push('REB' + run.rebuild);
    return parts.join(' ');
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
      const b = G.bots.find((x) => !x.alive) || G.newBot();   // (Endless: no fleet limit)
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
  function hullUp() { run.hullUps++; applyMods(); repairAll(); }
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
      const uid = id.slice(3), of = run.offers.get(s.id);
      run.credits -= opt.cost;
      of.bought.add(uid);
      buyUp(uid);
      if (of.bought.size >= of.ids.length) run.reward.delete(s.id);
      G.chime(); G.log(`endless upgrade ${uid} cost=${opt.cost}`);
      G.showMessage(POOL_BY[uid].name, '', 1.6);
      drawPopup();
      return;
    }
    G.click();
    const c = cost[id]();
    if (id === 'repair') { run.credits -= c; repairAll(); }
    else if (id === 'fighter') { run.credits -= c; run.bought++; addWingman(); G.landSlots(); }
    else if (id === 'hull') { run.credits -= c; hullUp(); }
    else if (id === 'warp') { run.credits -= c; run.warp = true; G.showMessage('WARP DRIVE', 'B: warp', 2.4); }
    G.log('endless buy ' + id);
    drawPopup();
  }

  // The popup: a small panel in the world beside the star you are sitting on (pointer + trigger). It lists
  // the upgrade choice or the repair / buy rows, and LAUNCH, the only way to take off again.
  const POP_W = 0.3;
  const POP_PX = 812;                                // v35: taller, for 5 cards and the big credits (v34: 640)
  const popup = new Panel(POP_W, 760, POP_PX);
  const POP_H = POP_W * POP_PX / 760;
  G.rig.add(popup.mesh);
  // v34: always drawn over everything in the world (stars, rocks, ships): no depth test, drawn last.
  popup.mesh.material.depthTest = false; popup.mesh.material.depthWrite = false;
  popup.mesh.renderOrder = 40;
  popup.onClick = (id) => click(id);
  function drawPopup() {
    const P = popup, W = P.W, o = options();
    P.begin();
    P.g.fillStyle = 'rgba(0,10,22,0.75)'; P.g.fillRect(5, 5, W - 10, P.H - 10);   // (v34: nearly opaque - nothing shows through)
    if (o) {
      const col = o.kind === 'dock' ? '#a8dcc0' : UI.title;
      P.text(o.title, W / 2, 50, { size: 34, bold: true, color: col, align: 'center', maxW: W - 40 });
      // v35: your credits, big - and when you buy something the number counts down with a gold flash.
      const fl = popAnim.flash, g = P.g, size = Math.round(66 + 10 * fl);
      const str = N(popAnim.shown);
      g.font = `bold ${size}px monospace`;
      const tw = Math.min(W - 160, g.measureText(str).width), cx = W / 2 + 22, cy = 116;
      // a wireframe credit diamond in front of the number (like the ones you pick up)
      const dx = cx - tw / 2 - 40, dr = 20 + 3 * fl;
      g.strokeStyle = fl > 0.05 ? '#fff2c0' : UI.gold; g.lineWidth = 3;
      g.beginPath(); g.moveTo(dx, cy - 24 - dr * 0.35); g.lineTo(dx + dr * 0.75, cy - 24); g.lineTo(dx, cy - 24 + dr * 1.05); g.lineTo(dx - dr * 0.75, cy - 24); g.closePath();
      g.moveTo(dx - dr * 0.75, cy - 24); g.lineTo(dx + dr * 0.75, cy - 24); g.stroke();
      const cr = Math.round(255), cg = Math.round(213 + 42 * fl), cb = Math.round(74 + 150 * fl);
      P.text(str, cx, cy, { size, bold: true, color: `rgb(${cr},${cg},${cb})`, align: 'center', maxW: W - 160 });
      o.opts.forEach((r, i) => {
        if (o.kind === 'reward') {
          // A card per upgrade (v34: calmer - the rarity is a thin coloured edge and a small tag; the name and
          // price in the panel's own colours).
          // (v35: five cards, a little shorter: 92 px every 100, v34: 114 every 124.)
          const y = 146 + i * 100, R = RARITY[r.rar], ch = 92;
          if (r.ok) P.button(r.id, 30, y, W - 60, ch, '', {});
          else { P.g.strokeStyle = UI.faint; P.g.lineWidth = 2; P.g.strokeRect(31, y + 1, W - 62, ch - 2); }
          P.g.fillStyle = R.col; P.g.globalAlpha = r.owned ? 0.3 : 0.85; P.g.fillRect(36, y + 9, 5, ch - 18); P.g.globalAlpha = 1;
          P.text(R.name, 56, y + 26, { size: 18, bold: true, color: r.owned ? UI.dim : R.col, maxW: 300 });
          P.text(r.label, 56, y + 58, { size: 32, bold: true, color: r.owned ? UI.dim : UI.title, maxW: 420 });
          P.text(r.sub, 56, y + 82, { size: 20, color: UI.dim, maxW: 440 });
          P.text(r.owned ? 'OWNED' : N(r.cost), W - 54, y + 58, { size: 30, bold: true, color: r.owned || !r.ok ? UI.dim : UI.gold, align: 'right', maxW: 180 });
        } else {
          const n = o.opts.length, rh = n > 3 ? 82 : 88, y = 150 + i * (n > 3 ? 94 : 104);
          if (r.ok) P.button(r.id, 30, y, W - 60, rh, '', {});
          else { P.g.strokeStyle = UI.faint; P.g.lineWidth = 2; P.g.strokeRect(31, y + 1, W - 62, rh - 2); }
          P.text(r.label, 60, y + rh / 2 + 12, { size: 34, bold: true, color: r.ok ? UI.title : UI.dim, maxW: 400 });
          P.text(r.sub, W - 60, y + rh / 2 + 12, { size: 32, color: r.ok ? UI.gold : UI.dim, align: 'right', maxW: 260 });
        }
      });
    }
    P.button('launch', 30, POP_PX - 150, W - 60, 100, 'LAUNCH', { big: true, size: 50 });
    P.end();
  }
  popup.redraw = drawPopup;                          // hover highlight (main.js)
  // The credits counter on the panel: counts toward run.credits (down after a purchase) over ~0.6 s with a flash.
  const popAnim = { shown: 0, from: 0, target: 0, t: 1, flash: 0 };
  function animatePopup(dt) {
    if (!popup.visible) return;
    let dirty = false;
    if (popAnim.target !== run.credits) { popAnim.from = popAnim.shown; popAnim.target = run.credits; popAnim.t = 0; popAnim.flash = 1; }
    if (popAnim.t < 1) {
      popAnim.t = Math.min(1, popAnim.t + dt / 0.6);
      const e = 1 - Math.pow(1 - popAnim.t, 3);
      popAnim.shown = Math.round(popAnim.from + (popAnim.target - popAnim.from) * e);
      dirty = true;
    }
    if (popAnim.flash > 0) { popAnim.flash = Math.max(0, popAnim.flash - dt / 0.5); dirty = true; }
    if (dirty) drawPopup();
  }
  let popKey = '';
  function showPopup(on) {
    if (on) { popAnim.shown = popAnim.from = popAnim.target = run.credits; popAnim.t = 1; popAnim.flash = 0; drawPopup(); run.popSide = null; placePopup(); }
    popup.visible = on;
    popKey = '';
  }
  // Beside the star, facing you: on its right as seen from your seat - or (v32) on its left, or above it, if
  // that side has a clearer view (no star or rock between you and the panel). Chosen when it opens.
  const _sw = new V(), _sr = new V(), _pp = new V(), _ls = new V(), _lp = new V(), _ax = new V(), _ay = new V();
  const SIDES = ['right', 'left', 'up'];
  function popPos(side, out) {
    const s = run.landed, sc = G.board.scale.x;
    if (side === 'up') return out.copy(_sw).add(_pp.set(0, s.r * sc + 0.04 + POP_H / 2, 0));
    return out.copy(_sw).addScaledVector(_sr, (side === 'left' ? -1 : 1) * (s.r * sc + 0.05 + POP_W / 2)).add(_pp.set(0, 0.04, 0));
  }
  function segBlocked(a, b, skip) {                  // a, b in world-group coordinates
    const d = new V().subVectors(b, a), L2 = Math.max(d.lengthSq(), 1e-9);
    const hit = (c, r) => {
      const t = clamp(_ax.subVectors(c, a).dot(d) / L2, 0, 1);
      return _ay.copy(a).addScaledVector(d, t).distanceTo(c) < r * 1.08;
    };
    for (const s of near.stars) if (hit(s.pos, s.r)) return true;
    for (const s of near.sites) {
      if (s.r > 0 && s !== skip && hit(s.pos, s.r)) return true;
      if (s.kind === 'field') for (const rk of s.rocks) if (hit(rk.pos, rk.r)) return true;
    }
    return false;
  }
  const toWorldLocal = (pRig, out) => G.world.worldToLocal(G.rig.localToWorld(out.copy(pRig)));
  const _c0 = new V(), _c1 = new V(), _q0 = new V();
  function sideScore(side) {
    // How much of the panel would be hidden: rays from the seat to a grid of points over it.
    const s = run.landed;
    popPos(side, _c0);
    G.world.updateMatrixWorld(true);
    toWorldLocal(G.seat, _ls);
    const right = _q0.set(G.seat.z - _c0.z, 0, _c0.x - G.seat.x).normalize();
    let n = 0;
    for (const u of [-0.45, -0.15, 0.15, 0.45]) for (const v of [-0.45, 0, 0.45]) {   // a 4 x 3 grid over it
      _c1.copy(_c0).addScaledVector(right, u * POP_W).add(_pp.set(0, v * POP_H, 0));
      toWorldLocal(_c1, _lp);
      if (segBlocked(_ls, _lp, s)) n++;
    }
    return n;
  }
  function placePopup() {
    const s = run.landed;
    if (!s) return;
    const k = JSON.stringify(options()) + run.credits;
    if (k !== popKey) { popKey = k; drawPopup(); }
    G.board.updateMatrixWorld(true);
    _sw.copy(s.pos).sub(G.VC);                       // (the world group is shifted by -VC)
    G.board.localToWorld(_sw);
    G.rig.worldToLocal(_sw);
    const seat = G.seat;
    _sr.set(seat.z - _sw.z, 0, _sw.x - seat.x).normalize();   // right of the line from the seat to the star
    if (_sr.lengthSq() < 0.5) _sr.set(1, 0, 0);
    if (!run.popSide) {
      let best = 'right', bs = Infinity;
      for (const side of SIDES) { const n = sideScore(side); if (n < bs) { bs = n; best = side; } if (!n) break; }
      run.popSide = best; run.popBlocked = bs;
      G.log(`endless popup side ${best} (blocked ${bs})`);
    }
    popPos(run.popSide, popup.mesh.position);
    G.faceSeat(popup.mesh);
  }
  function landAt(pad, glide) {
    run.landed = pad;
    G.land(pad.pos, pad.r, glide);
    G.chime();
    G.log('endless landed ' + pad.id);
  }

  // ---------------------------------------------------------------- outposts
  // v33: the enemy level of an outpost - higher than its tier (more ships, smarter tactics from tier 2).
  // Plus the THREAT: one more level for every 2 minutes of the run (and more hull, more ships), so even a fully
  // upgraded fleet is worn down.
  // v34: a gentler curve (v33: x * 1.4 + 0.6, +1 every 2 minutes).
  // v35: the first tiers are their own tier number (v34: x * 1.2 + 0.4, so tier 1 was level 2); the steeper
  // curve blends in from tier 4 and is back to the v34 levels from tier 7 on.
  function level(t, bounty) {
    const x = t + (bounty ? 1 : 0);
    if (G.easy) return x;
    const ramp = Math.min(1, Math.max(0, (x - 3) / 4));
    return Math.max(1, Math.round(x + (0.2 * x + 0.4) * ramp)) + threat();
  }
  const threat = () => Math.floor(run.t / THREAT_T);
  const threatHp = () => 1 + 0.15 * threat();   // and 15% more hull per threat step, so no fleet holds out for ever
  const hitDmg = () => (G.easy ? 1 : 1 + Math.floor(threat() / 4));   // from 10 minutes in, hits cost 2 hull (3 from 20)
  const tierAt = (c) => Math.min(12, 1 + Math.floor(c.length() / TIER_D));
  function tagNew(tag) { for (const e of G.enemies) if (!e.home && !e.patrol && !e.treasure) Object.assign(e, tag); }
  function activate(s) {
    run.active = s;
    G.setArena(s.pos, ROAM);
    const sq = G.gameMode() === 'squadron';
    if (run.demo) { G.setAI(2); G.spawnGroup('pincer', 2, 1); G.spawnGroup('flank', 1, 1); tagNew({ home: s }); return; }   // lobby: a small outpost
    const L = level(s.tier, s.bounty);
    G.setAI(L);
    G.setWave(L);
    for (const [role, count] of G.roster(L, sq)) G.spawnGroup(role, count, L);
    // A bigger fleet meets a bigger defence: an extra pair for every 3 ships past 2 (so the fleet never snowballs).
    // The THREAT adds more on top as the run goes on (one more pair every 5 minutes).
    const extra = G.easy ? 0 : Math.min(5, Math.floor(Math.max(0, fleet() - 2) / 3)) + Math.min(5, Math.floor(threat() / 2));
    for (let i = 0; i < extra; i++) G.spawnGroup(i % 3 === 2 ? 'hunter' : i % 2 ? 'pincer' : 'flank', 2, L);
    if (!G.easy) for (const e of G.enemies) if (!e.home && !e.patrol && !e.treasure) { e.hp = e.maxHp = Math.ceil(e.maxHp * (1 + 0.1 * (s.tier - 1) + (s.bounty ? 0.25 : 0)) * threatHp()); }
    tagNew({ home: s });
    const n = G.enemies.filter((e) => e.home === s).length;
    G.showMessage(s.bounty ? `BOUNTY - TIER ${s.tier}` : `OUTPOST - TIER ${s.tier}`, `${n} hostiles`, 2.2);
    G.log(`endless outpost ${s.id} tier=${s.tier} level=${L} bounty=${!!s.bounty} enemies=${n}`);
  }
  function deactivate() {
    for (const e of G.enemies) if (e.home === run.active) { e.hp = 0; e.escaped = true; }
    run.active = null;
  }
  // ---------------------------------------------------------------- the enemy homeworld (v34)
  // Once you are past the tier-9 outposts it appears far ahead (HOME_AHEAD beyond you, in the direction you
  // have come out), in a wide clearing. Come close and its fleet launches in three waves; destroy the last
  // wave and the homeworld blows up: you win.
  function spawnHome(c) {
    const dir = new V(c.x, 0, c.z);
    if (dir.lengthSq() < 1e-6) dir.set(0, 0, -1);
    dir.normalize();
    const pos = dir.multiplyScalar(c.length() + HOME_AHEAD);
    pos.y = 0;
    run.home = { id: 'home', kind: 'home', pos, r: HOME_R, tier: 12, bounty: false, state: 'waiting', wave: 0, t: 0 };
    near.t = 1e9;                                    // (refresh: the clearing empties now)
    G.showMessage('ENEMY HOMEWORLD', 'Destroy it to win', 3);
    G.chime();
    G.log(`endless home spawned at ${pos.toArray().map((v) => v.toFixed(0))} (${Math.round(pos.distanceTo(c) * DIST_K)} away)`);
  }
  // v35: ONE massive swarm instead of three waves - cruisers, leaders with escorts, hunters, snipers and a
  // cloud of fighters, about 70 ships (more for a big fleet of yours). It arrives between you and the planet,
  // spread across your view (v34's waves entered on the far side of the planet, out of sight).
  const homeLevel = () => 8 + Math.min(2, threat());
  const HOME_SWARM = () => 56 + 2 * Math.min(10, fleet());
  const _hs = new V(), _hd = new V(), _hr = new V(), _hu = new V();
  function homeSwarm(c) {
    const h = run.home, sq = G.gameMode() === 'squadron', L = homeLevel();
    h.wave = 1; h.state = 'active';
    // From you toward the planet.
    _hd.copy(h.pos).sub(c); _hd.y = 0; if (_hd.lengthSq() < 1e-6) _hd.set(0, 0, -1); _hd.normalize();
    _hr.set(-_hd.z, 0, _hd.x); _hu.set(0, 1, 0);
    G.setArena(c.clone().lerp(h.pos, 0.4), new V(10, 5, 10));
    G.setAI(L); G.setWave(L);
    const groups = [['heavy', 4], ['heavy', 4], ['heavy', 4], ['leader', 4], ['leader', 4], ['hunter', 3], ['hunter', 3], ['sniper', sq ? 3 : 2], ['pincer', 3], ['pincer', 3]];
    const want = HOME_SWARM();
    let n = groups.reduce((a, g) => a + g[1], 0);
    for (let i = 0; n < want; i++) { const k = Math.min(4, want - n); groups.push([i % 3 === 2 ? 'hunter' : i % 2 ? 'pincer' : 'flank', k]); n += k; }
    // Shuffle so the cruisers are spread through the swarm, not all on one side.
    for (let i = groups.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [groups[i], groups[j]] = [groups[j], groups[i]]; }
    groups.forEach(([role, count], i) => {
      // An arc across your view, 4.2 - 5 ahead (inside the window, so you see it come), +-55 degrees either
      // side and a little above / below; cruisers in the back row.
      const th = ((i + 0.5) / groups.length * 2 - 1) * 0.96 + (Math.random() - 0.5) * 0.12;
      const rr = (role === 'heavy' ? 4.8 : 4.2) + Math.random() * 0.5;
      _hs.copy(c).addScaledVector(_hd, Math.cos(th) * rr).addScaledVector(_hr, Math.sin(th) * rr).addScaledVector(_hu, (Math.random() - 0.5) * 2.6);
      G.spawnGroup(role, count, L, _hs);
    });
    tagNew({ home: h });
    const mine = G.enemies.filter((e) => e.home === h);
    // (Lighter models for the swarm's fighters: no vertex dots - one draw call each.)
    for (const e of mine) if (e.type === 'fighter' && e.obj.children[1]) e.obj.children[1].visible = false;
    h.total = mine.length;
    G.showMessage('HOMEWORLD', `${mine.length} hostiles`, 2.4);
    G.log(`endless home swarm level=${L} enemies=${mine.length}`);
  }
  // The break-up (v35): the planet's wireframe flies apart edge by edge, three shock shells sweep out, the
  // rings spin away; time slows for a moment, the view glides over, then the VICTORY screen.
  let debris = null;
  const HOME_DIE_T = 4.2;
  function breakHome(h) {
    const src = homeBall.geometry.attributes.position, n = src.count / 2;
    const arr = new Float32Array(n * 6), col = new Float32Array(n * 6);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(arr, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3).setUsage(THREE.DynamicDrawUsage));
    const mesh = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 1, depthWrite: false, blending: THREE.AdditiveBlending }));
    mesh.frustumCulled = false;
    world.add(mesh);
    const frags = [];
    const R = HOME_R;
    for (let i = 0; i < n; i++) {
      const a = new V().fromBufferAttribute(src, i * 2).multiplyScalar(R), b = new V().fromBufferAttribute(src, i * 2 + 1).multiplyScalar(R);
      const c = a.clone().add(b).multiplyScalar(0.5);
      const out = c.clone().normalize();
      frags.push({ c: c.add(h.pos), half: b.sub(a).multiplyScalar(0.5), v: out.multiplyScalar(1.2 + Math.random() * 3.2).add(new V().randomDirection().multiplyScalar(0.6)), axis: new V().randomDirection(), spin: 0.5 + Math.random() * 2.5, hot: Math.random() });
    }
    const shells = [0, 1, 2].map((i) => {
      const m = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.IcosahedronGeometry(1, 1)), new THREE.LineBasicMaterial({ color: i === 1 ? 0xffd9a0 : 0xff6a50, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
      m.position.copy(h.pos); m.rotation.set(i * 0.7, i * 1.1, 0); world.add(m); return m;
    });
    debris = { mesh, arr, col, frags, shells, t: 0, _q: new THREE.Quaternion(), _v: new V() };
  }
  function clearDebris() {
    if (!debris) return;
    world.remove(debris.mesh); debris.mesh.geometry.dispose();
    debris.shells.forEach((m) => world.remove(m));
    debris = null;
  }
  function updateDebris(dt, c) {
    if (!debris) return;
    const D = debris, W = WIN();
    D.t += dt;
    const life = clamp(1 - (D.t - 1.2) / 3.0, 0, 1);
    for (let i = 0; i < D.frags.length; i++) {
      const f = D.frags[i];
      f.c.addScaledVector(f.v, dt); f.v.multiplyScalar(Math.exp(-dt * 0.25));
      D._q.setFromAxisAngle(f.axis, f.spin * D.t);
      D._v.copy(f.half).applyQuaternion(D._q);
      D.arr[i * 6] = f.c.x - D._v.x; D.arr[i * 6 + 1] = f.c.y - D._v.y; D.arr[i * 6 + 2] = f.c.z - D._v.z;
      D.arr[i * 6 + 3] = f.c.x + D._v.x; D.arr[i * 6 + 4] = f.c.y + D._v.y; D.arr[i * 6 + 5] = f.c.z + D._v.z;
      // Hot white-gold at first, cooling to red, fading out; and gone before the window's edge.
      const fade = 1 - smooth(W * 0.75, W * 1.05, WD(f.c, c));
      const k = life * fade, heat = clamp(1 - D.t / (1.2 + f.hot), 0, 1);
      const r = k, g = k * (0.35 + 0.55 * heat), b = k * (0.25 + 0.6 * heat * heat);
      D.col[i * 6] = r; D.col[i * 6 + 1] = g; D.col[i * 6 + 2] = b; D.col[i * 6 + 3] = r; D.col[i * 6 + 4] = g; D.col[i * 6 + 5] = b;
    }
    D.mesh.geometry.attributes.position.needsUpdate = true;
    D.mesh.geometry.attributes.color.needsUpdate = true;
    D.shells.forEach((m, i) => {
      const q = clamp((D.t - i * 0.25) / 2.4, 0, 1);
      m.scale.setScalar(HOME_R * (1 + q * (1.2 + i * 0.5)));
      m.material.opacity = q > 0 && q < 1 ? (1 - q) * (0.7 - i * 0.15) * (1 - smooth(W * 0.75, W * 1.05, WD(m.position, c) + m.scale.x * 0.5)) : 0;
    });
    if (D.t > HOME_DIE_T + 3) clearDebris();
  }
  const homeFocus = new V();
  function updateHome(c, dt) {
    const h = run.home;
    updateDebris(dt, c);
    if (!h) { if (!run.demo && run.maxDist >= HOME_UNLOCK) spawnHome(c); return; }
    h.t += dt;
    const d = h.pos.distanceTo(c);
    if (h.state === 'waiting') {
      if (d < HOME_WAKE && !run.landed && !G.warping()) homeSwarm(c);
    } else if (h.state === 'active') {
      const mine = G.enemies.filter((e) => e.home === h && e.hp > 0);
      if (d > HOME_LEAVE) {                          // you ran: the swarm pulls back (and comes again in full)
        for (const e of mine) { e.hp = 0; e.escaped = true; }
        h.state = 'waiting';
      } else if (!mine.length) {                     // the whole swarm is down: the planet breaks apart, you win
        h.state = 'dying'; h.dieT = 0;
        homeFocus.copy(c).sub(h.pos).setLength(HOME_R + 4.5).add(h.pos);
        if (G.slowMo) G.slowMo(0.25, 1.4);
        G.blast(h.pos); G.blast(h.pos.clone().add(new V(HOME_R, 0, 0))); G.blast(h.pos.clone().add(new V(-HOME_R, 1, 0)));
        G.addScore(50000);
        G.log('endless home destroyed');
      } else for (const e of mine) if (e.obj.position.distanceTo(h.pos) > HOME_LEAVE * 0.5) { e.scatterT = 1; e.goal.copy(h.pos); }
    } else if (h.state === 'dying') {
      h.dieT += dt;
      if (h.dieT > 0.35 && !h.broken) { h.broken = true; breakHome(h); if (G.bigBoom) G.bigBoom(h.pos); }
      if (h.dieT > HOME_DIE_T) { h.state = 'dead'; G.win(); }
    }
  }
  // While the planet breaks apart the view glides over to it (eased), so you see it happen.
  function homeViewPull() {
    const h = run.home;
    if (!h || h.state === 'waiting' || h.state === 'active') return 0;
    return smooth(0, 1.4, h.state === 'dying' ? h.dieT : HOME_DIE_T);
  }
  // Warp (v34): may it be engaged here? ('' = yes, else why not)
  // v35: only a stop straight ahead counts - leaving an outpost, or one beside or behind you, never blocks.
  function warpBlock(c, dir) {
    if (!run.warp) return 'NO WARP DRIVE';
    if (run.landed) return 'LANDED';
    if (warpStopAhead(c, dir, WARP_STOP + 1.5)) return 'OUTPOST AHEAD';
    return '';
  }
  // v35: the first stop (an enemy outpost not yet destroyed, a friendly outpost, the homeworld) in a narrow
  // cone along the warp heading, at most R ahead. The one you are on / just left is ignored.
  const _wd = new V(), _wp = new V();
  function inWarpCone(c, dir, p, R, r = 0) {
    _wp.copy(p).sub(c);
    const along = _wp.dot(dir);
    if (along <= 0 || along - r > R) return false;
    const lat = Math.sqrt(Math.max(0, _wp.lengthSq() - along * along));
    return lat < r + WARP_CONE_W + along * WARP_CONE_TAN;
  }
  function warpStopAhead(c, dir, R) {
    _wd.copy(dir); if (_wd.lengthSq() < 1e-9) return null; _wd.normalize();
    if (run.home && run.home.state !== 'dead' && inWarpCone(c, _wd, run.home.pos, R + 2, HOME_R)) return run.home;
    const I = Math.round(c.x / REG), K = Math.round(c.z / REG);
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
      const s = site(I + a, K + b);
      if (inClearing(s.pos, 6)) continue;
      if (!(s.dock || (s.kind === 'outpost' && !run.destroyed.has(s.id)))) continue;
      if (s.pos.distanceTo(c) < WARP_IGNORE) continue;
      if (inWarpCone(c, _wd, s.pos, R)) return s;
    }
    return null;
  }
  // (v34 name, kept for tests: any stop within R ahead along dir.)
  function nearWarpStop(c, R, dir = G.warpDir()) { return !!warpStopAhead(c, dir, R); }
  // Patrols (v33): a few ships that roam between outposts and come after you.
  function spawnPatrol(c) {
    const t = tierAt(c), L = level(t, false), sq = G.gameMode() === 'squadron';
    const n = Math.min(10, 2 + Math.floor(t / 2) + (sq ? 1 : 0) + Math.floor(fleet() / 3));
    G.setArena(c, PATROL_ROAM);
    G.setAI(Math.max(L, 2)); G.setWave(L);
    if (t >= 3) { G.spawnGroup('pincer', 2, L); if (n > 2) G.spawnGroup(t >= 5 ? 'hunter' : 'flank', n - 2, L); } else G.spawnGroup('flank', n, L);
    if (!G.easy) for (const e of G.enemies) if (!e.home && !e.patrol && !e.treasure) e.hp = e.maxHp = Math.ceil(e.maxHp * threatHp());
    tagNew({ patrol: true });
    run.patrols++;
    G.showMessage('PATROL', `${n} hostiles`, 1.6);
    G.log(`endless patrol tier=${t} n=${n}`);
  }
  function spawnTreasure(c) {
    const t = tierAt(c), L = level(t, false);
    G.setArena(c, PATROL_ROAM);
    const g = G.spawnGroup('flank', 1, L);
    const e = g.members[0];
    Object.assign(e, { treasure: true, color: TREASURE_COL.clone(), points: 0 });
    e.hp = e.maxHp = 4 + t; e.speed *= 1.6; e.fireInterval = 99;
    // It flees *past* you: it sets off sideways (round the view) and spirals slowly outward, so there is a
    // few seconds' chase before it gets away.
    const rad = e.obj.position.clone().sub(c); rad.y = 0; if (rad.lengthSq() < 1e-6) rad.set(1, 0, 0);
    e.obj.position.copy(c).addScaledVector(rad.normalize(), WIN() * 0.5);   // starts half-way out, in view
    e.fleeDir = new V(0, 1, 0).cross(rad).normalize().multiplyScalar(Math.random() < 0.5 ? 1 : -1);
    e.fwd.copy(e.fleeDir); e.orbR = WIN() * 0.5;
    run.treasures++;
    G.showMessage('TREASURE SHIP', '', 2);
    G.log(`endless treasure tier=${t}`);
  }
  // Pickups
  function dropCredits(p, total, n) {
    for (let i = 0; i < n && picks.length < PICK_N; i++) {
      const v = new V(Math.random() - 0.5, (Math.random() - 0.5) * 0.6, Math.random() - 0.5).normalize().multiplyScalar(0.6 + Math.random() * 0.9);
      picks.push({ pos: p.clone(), vel: v, t: 14, v: Math.max(1, Math.round(total / n)), ph: Math.random() * 6.28 });
    }
  }
  const ships = () => (G.gameMode() === 'squadron' ? G.bots.filter((b) => b.alive) : G.player.alive ? [G.player] : []);
  function updatePicks(dt) {
    const S = ships(), R = 0.9 + 2.5 * lv('magnet');
    let n = 0;
    for (const k of picks) {
      k.t -= dt;
      let best = null, bd = R;
      for (const sh of S) { const d = sh.obj.position.distanceTo(k.pos); if (d < bd) { bd = d; best = sh; } }
      if (run.landed && run.landed.pos.distanceTo(k.pos) < 6) { best = S[0]; bd = best ? best.obj.position.distanceTo(k.pos) : 1e9; }
      if (best) {
        _a.subVectors(best.obj.position, k.pos).normalize();
        k.vel.addScaledVector(_a, dt * (10 + 6 * lv('magnet')));
        if (bd < 0.3) { run.credits += credit(k.v); k.t = -1; G.pickup && G.pickup(k.pos); continue; }
      }
      k.vel.multiplyScalar(Math.exp(-dt * 1.2));
      k.pos.addScaledVector(k.vel, dt);
    }
    picks = picks.filter((k) => k.t > 0);
    for (const k of picks) {
      const a = run.t * 2.2 + k.ph, ca = Math.cos(a) * PICK_S, sa = Math.sin(a) * PICK_S;
      for (const q of PICK_E) {                        // spinning about its upright axis
        pickArr[n++] = k.pos.x + q[0] * ca - q[2] * sa; pickArr[n++] = k.pos.y + q[1] * PICK_S; pickArr[n++] = k.pos.z + q[0] * sa + q[2] * ca;
      }
    }
    pickGeo.setDrawRange(0, n / 3);
    pickGeo.attributes.position.needsUpdate = true;
  }
  // Ship-side upgrades over time: shields recharge, the repair drone, homing missiles.
  function updateUps(dt) {
    const S = ships();
    for (const sh of S) if (sh.shieldT > 0) sh.shieldT -= dt;
    if (lv('drone')) {
      run.droneT -= dt;
      if (run.droneT <= 0) {
        run.droneT = 20 / lv('drone');
        const max = G.gameMode() === 'squadron' ? G.botMax() : G.playerMax();
        let w = null; for (const sh of S) if (sh.hp < max && (!w || sh.hp < w.hp)) w = sh;
        if (w) { w.hp++; G.healFx && G.healFx(w); }
      }
    }
    if (lv('homing') && !run.landed) {
      run.mslT -= dt;
      if (run.mslT <= 0) {
        run.mslT = 3.2 / lv('homing');
        let tgt = null, td = 7;
        const from = S[Math.floor(Math.random() * S.length)];
        if (from) for (const e of G.enemies) { const d = e.obj.position.distanceTo(from.obj.position); if (e.hp > 0 && d < td) { td = d; tgt = e; } }
        if (tgt) G.fireMissile(from, tgt);
      }
    }
  }
  // Outpost destroyed: shockwave, debris, the star flickers and collapses, then turns grey. Big boom + hit-stop.
  function destroyOutpost(s) {
    run.destroyed.add(s.id); run.active = null;
    run.dying.push({ s, t: 0 });
    G.blast(s.pos);
    if (run.demo) { run.demoCleared = true; return; }
    const bonus = 1000 * s.tier * (s.bounty ? 2 : 1);
    run.outposts++;
    if (s.bounty) run.bounties++;
    run.reward.add(s.id);
    rollOffers(s);
    run.autoLand = s;
    G.addScore(bonus); run.credits += credit(bonus);
    G.showMessage(s.bounty ? 'BOUNTY CLAIMED' : 'OUTPOST DESTROYED', `+${N(bonus)}`, 2.4);
    G.log(`endless outpost destroyed ${s.id} bonus=${bonus} offers=${run.offers.get(s.id).ids.join(',')}`);
  }
  function nearestOf(c, test, maxR = 3) {
    let best = null, bd = Infinity;
    const I = Math.round(c.x / REG), K = Math.round(c.z / REG);
    for (let a = -maxR; a <= maxR; a++) for (let b = -maxR; b <= maxR; b++) {
      const s = site(I + a, K + b);
      if (!test(s) || inClearing(s.pos, 6)) continue;
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
  const W_ESC = () => WIN() * 1.3;
  const PATROL_ROAM = new V(5, 3, 5);
  const _a = new V(), _vt = new V(), vcOff = new V();
  function fadeShip(obj, d) {
    const a = clamp((WIN() * 1.02 - d) / (WIN() * 0.22), 0, 1);
    for (const m of obj.userData.mats) m.opacity = a;
    obj.userData.winA = a;
  }
  function update(dt) {
    if (!run.on) return;
    run.t += dt;
    // The view centre (v32): your ship / command point, or - split - 60 / 40 between the blue and gold pairs,
    // or the landing glide. Any sudden change of that target (split, rejoin) is eased out (about 0.35 s).
    G.viewTarget(_vt);
    if (run.rebase) { vcOff.subVectors(G.VC, _vt); run.rebase = false; }
    vcOff.multiplyScalar(Math.exp(-dt / 0.35));
    if (vcOff.lengthSq() < 1e-8) vcOff.set(0, 0, 0);
    const c = G.VC.copy(_vt).add(vcOff);
    { const w = homeViewPull(); if (w > 0) c.lerp(homeFocus, w); }
    near.t += dt;
    if (near.at.distanceTo(c) > 1 || near.t > 0.5) refreshNear();
    rockPositions(run.t);
    buildObstacles();
    // Distance is a stat (best distance) with milestones - it scores nothing (v33: score is earned).
    const d = c.length();
    if (d > run.maxDist && !run.demo) {
      run.maxDist = d;
      const m = Math.floor(d / MILESTONE);
      if (m > run.mile) { run.mile = m; G.showMessage(`${N(m * MILESTONE * DIST_K)} REACHED`, '', 1.8); G.chime(); G.milestone && G.milestone(); }
    }
    if (run.comboT > 0) { run.comboT -= dt; if (run.comboT <= 0) run.combo = 0; }
    // Outposts: wake the nearest one when you come close; its ships go home if you leave.
    if (run.active) {
      const sd = run.active.pos.distanceTo(c);
      const mine = G.enemies.filter((e) => e.home === run.active && e.hp > 0);
      if (mine.length === 0) destroyOutpost(run.active);
      else if (sd > DEACT_R) deactivate();
      else for (const e of mine) if (e.obj.position.distanceTo(run.active.pos) > ENEMY_LEASH) { e.scatterT = 1; e.goal.copy(run.active.pos); }
    } else {
      const s = nearestOutpost(c, 1);
      if (s && s.pos.distanceTo(c) < ACT_R && !G.warping()) activate(s);   // (v35: not while flying past at warp)
    }
    if (!run.demo) {
      // Patrols and the treasure ship turn up between outposts; they keep to the area round you.
      const roamers = G.enemies.filter((e) => (e.patrol || e.treasure) && e.hp > 0);
      if (!run.active && roamers.length) G.setArena(c, PATROL_ROAM);
      for (const e of roamers) {
        if (WD(e.obj.position, c) > W_ESC()) { e.hp = 0; e.escaped = true; if (e.treasure) G.showMessage('TREASURE ESCAPED', '', 1.4); continue; }
        if (e.treasure) {
          // It circles round the view on a slowly widening orbit (out past the edge in about 6 - 10 s), so
          // there is a real chase before it gets away.
          e.orbR += dt * WIN() * 0.13;
          _a.copy(e.obj.position).sub(c); _a.y = 0; if (_a.lengthSq() < 1e-6) _a.set(1, 0, 0); _a.normalize();
          e.fleeDir.addScaledVector(_a, -e.fleeDir.dot(_a)); e.fleeDir.y = 0; e.fleeDir.normalize();
          e.scatterT = 1;
          e.goal.copy(c).addScaledVector(_a, e.orbR * 1.2 * Math.cos(0.6)).addScaledVector(e.fleeDir, e.orbR * 1.2 * Math.sin(0.6));
          e.goal.y = c.y + (e.obj.position.y - c.y) * 0.8;
        }
      }
      updateHome(c, dt);
      // Warp drops out just before the outpost (or the homeworld) straight ahead.
      if (G.warping() && warpStopAhead(c, G.warpDir(), WARP_STOP)) G.warpOff('drop');
      if (!G.easy && !run.active && !run.landed && !(run.home && (run.home.state === 'active' || run.home.state === 'between')) && !G.warping()) {
        run.patrolT -= dt; run.treasureT -= dt;
        if (run.patrolT <= 0) { run.patrolT = (PATROL_T[0] + Math.random() * (PATROL_T[1] - PATROL_T[0])) * Math.max(0.45, 1 - run.t / 900); if (!roamers.some((e) => e.patrol)) spawnPatrol(c); }
        if (run.treasureT <= 0) { run.treasureT = TREASURE_T[0] + Math.random() * (TREASURE_T[1] - TREASURE_T[0]); if (!roamers.some((e) => e.treasure)) spawnTreasure(c); }
      }
      updatePicks(dt);
      updateUps(dt);
      if (G.demo) autopilot(dt);
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
    // v35: landed (a green star or a cleared outpost): everyone breaks off - no attack runs, no ramming.
    // Patrols turn round and leave for good (they escape off the edge); anything else keeps its distance.
    if (run.landed) {
      const lp = run.landed.pos;
      for (const e of G.enemies) {
        if (e.hp <= 0) continue;
        _a.copy(e.obj.position).sub(lp);
        const ed = _a.length();
        if (ed < 1e-6) _a.set(1, 0, 0); else _a.multiplyScalar(1 / ed);
        if (e.patrol || ed < LAND_KEEP + 3) {
          e.scatterT = Math.max(e.scatterT || 0, 1);
          e.goal.copy(lp).addScaledVector(_a, e.patrol ? W_ESC() * 1.8 : LAND_KEEP + 4);
          e.disengaged = true;
        }
        if (ed < LAND_KEEP) e.obj.position.copy(lp).addScaledVector(_a, LAND_KEEP);
      }
      for (const b of G.enemyBullets()) if (!b.dead && b.pos.distanceTo(lp) < LAND_KEEP + 2) b.dead = true;
    }
    // Landing: fly onto a green star, or onto a cleared outpost with an upgrade waiting. Steer away to leave.
    if (!run.demo) {
      if (run.landed && !G.landed()) { run.latch = run.landed; run.landed = null; showPopup(false); }
      if (run.latch && run.latch.pos.distanceTo(c) > PAD_R + 1.5) run.latch = null;
      if (!run.landed && !run.autoLand) {
        const pad = nearestOf(c, (s) => s.dock || run.reward.has(s.id), 1);
        if (pad && pad !== run.latch && pad.pos.distanceTo(c) < PAD_R) landAt(pad, pad.dock ? DOCK_GLIDE : LAND_GLIDE);
      }
      // v34: the panel shows as soon as the ships head in to land (v33: once they had settled).
      if (run.landed && !popup.visible) showPopup(true);
      if (popup.visible) { placePopup(); animatePopup(dt); }
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
  // Autopilot (test runs, ?demo): lands, buys what it can afford (rarest first), repairs, launches.
  function autopilot(dt) {
    if (!run.landed || !popup.visible) { run.landT = 0; return; }
    run.landT += dt;
    if (run.landT < 1.2) return;
    const o = options();
    if (o.kind === 'reward') {
      const order = ['legendary', 'epic', 'rare', 'common'];
      const buy = o.opts.filter((x) => x.ok).sort((a, b) => order.indexOf(a.rar) - order.indexOf(b.rar))[0];
      if (buy) { click(buy.id); run.landT = 0.8; return; }
    } else if (o.kind === 'dock') {
      const r = o.opts.find((x) => x.id === 'repair'), f = o.opts.find((x) => x.id === 'fighter'), h = o.opts.find((x) => x.id === 'hull');
      if (r.ok) { click('repair'); run.landT = 0.8; return; }
      if (f.ok && run.credits > cost.fighter() + 1500 && fleet() < 8) { click('fighter'); run.landT = 0.8; return; }
      if (h.ok && run.credits > cost.hull() + 3000) { click('hull'); run.landT = 0.8; return; }
      run.autoDockT = run.t;   // (test autopilot: don't fly straight back to a dock it just left)
    }
    click('launch');
  }
  // Where the autopilot flies when nothing is attacking: a friendly outpost when hurt, else the next outpost.
  function autoTarget(out) {
    const c = G.VC;
    const max = G.gameMode() === 'squadron' ? G.botMax() : G.playerMax();
    const S = ships(), hp = S.reduce((a, s2) => a + s2.hp, 0) / Math.max(1, S.length * max);
    const dk = hp < 0.6 && run.credits >= 300 && !(run.t - (run.autoDockT ?? -99) < 30) ? nearestDock(c, 3) : null;
    if (!dk && run.home && run.home.state === 'active') {   // the homeworld fight: go after its nearest ship
      let best = null, bd = Infinity;
      for (const e of G.enemies) if (e.home === run.home && e.hp > 0) { const d2 = e.obj.position.distanceTo(c); if (d2 < bd) { bd = d2; best = e; } }
      if (best) return out.copy(best.obj.position);
    }
    const t = dk || (run.home && run.home.state !== 'dead' ? run.home : null) || nearestOutpost(c, 3);
    return t ? out.copy(t.pos) : out.copy(c).add(new V(0, 0, -10));
  }
  // Pooled meshes for what is inside the view window. Far things fade gradually over a long band (from 30%
  // of the window's radius out to its edge), so nothing pops in or out.
  function draw(c) {
    const W = WIN();
    const fade = (p, r) => 1 - smooth(W * 0.3, W, WD(p, c) - r);
    let ki = 0;
    starSlots.begin(); rockSlots.begin();
    const putStar = (key, p, r, col, a0 = 0.65, scale = r) => {
      const a = fade(p, r);
      if (a <= 0.01) return;
      const m = starSlots.get(key);
      if (!m) return;
      m.position.copy(p); m.scale.setScalar(scale); m.rotation.set(0, run.t * 0.05, 0); m.material.color.setHex(col); m.material.opacity = a0 * a; m.visible = true;
    };
    for (const s of near.stars) putStar(s, s.pos, s.r, STAR_COL.star);
    for (const s of near.sites) {
      if (s.r > 0) {
        const die = run.dying.find((x) => x.s === s);
        if (die) {
          // Flicker red / white while collapsing, then swell back as a grey star.
          const t = die.t, k = t / DIE_T;
          // A gentle flicker (red / soft pink) while it shrinks, then back as a grey star; one faint ring.
          const col = k < 0.6 ? (Math.floor(t * 12) % 2 ? 0xffb3a8 : STAR_COL.outpost) : STAR_COL.dead;
          const sc = k < 0.6 ? s.r * (1 - 0.5 * (k / 0.6)) : s.r * (0.5 + 0.5 * smooth(0.6, 1, k));
          putStar(s, s.pos, s.r, col, 0.8, sc);
          if (ki < shockPool.length) {
            const m = shockPool[ki++], q = clamp(t / 0.8, 0, 1);
            m.position.copy(s.pos); m.rotation.set(0, 0, 0); m.scale.setScalar(0.5 + q * 3.5);
            m.material.opacity = (1 - q) * 0.45 * fade(s.pos, 0); m.visible = q < 1;
          }
        } else {
          const col = s.dock ? STAR_COL.dock : s.kind === 'outpost' ? (run.destroyed.has(s.id) ? STAR_COL.dead : s.bounty ? STAR_COL.bounty : STAR_COL.outpost) : STAR_COL.star;
          // A cleared outpost with an upgrade waiting pulses gently.
          const pulse = run.reward.has(s.id) ? 0.55 + 0.35 * Math.sin(run.t * 4) : 0.75;
          putStar(s, s.pos, s.r, col, s.kind === 'start' ? 0.65 : pulse);
        }
      }
      if (s.kind === 'field') for (const rk of s.rocks) {
        const a = 1 - smooth(W * 0.65, W, WD(rk.pos, c) - rk.r);   // (v33: rocks stay clear until near the edge)
        if (a <= 0.01) continue;
        const m = rockSlots.get(rk);
        if (!m) continue;
        m.geometry = rockGeos[rk.geo];
        m.position.copy(rk.pos); m.scale.setScalar(rk.r); m.rotation.set(run.t * rk.spin, run.t * rk.spin * 0.7, 0);
        m.material.opacity = 0.95 * a; m.visible = true;
      }
    }
    starSlots.end(); rockSlots.end();
    const h = run.home;
    if (h && h.state !== 'dead' && !h.broken) {
      const a = 1 - smooth(W * 0.7, W * 1.05, WD(h.pos, c) - HOME_R);   // (clear right out to the window's edge)
      const k = h.state === 'dying' ? clamp(1 - h.dieT / 2.2, 0, 1) : 1;
      homeObj.visible = a > 0.01;
      homeObj.position.copy(h.pos);
      homeObj.scale.setScalar(HOME_R * (h.state === 'dying' ? 0.4 + 0.6 * k : 1));
      homeBall.rotation.set(0, run.t * 0.04, 0);
      homeBall.material.opacity = a * 0.85 * k * (h.state === 'dying' ? (Math.floor(h.dieT * 10) % 2 ? 0.5 : 1) : 1);
      homeRings.forEach((m, i) => { m.scale.setScalar(1.55 + i * 0.3); m.rotation.y = run.t * (0.15 + i * 0.1); m.material.opacity = a * 0.5 * k; });
    } else homeObj.visible = false;
    for (let i = ki; i < shockPool.length; i++) shockPool[i].visible = false;
    // Hints: next outpost (red), and the nearest friendly outpost (green) when a ship is damaged.
    const targets = [run.active ? null : nearestOutpost(c), !run.demo && hurt() && !run.landed ? nearestDock(c) : null, run.home && run.home.state !== 'dead' ? run.home : null];
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
      run.rebase = false; vcOff.set(0, 0, 0);
      run.ups = {}; run.offers = new Map(); run.combo = 0; run.comboT = 0; run.mile = 0; run.droneT = 8; run.mslT = 2; run.rebuild = 0; run.landT = 0;
      run.patrolT = 30; run.treasureT = 55 + Math.random() * 30; run.bounties = 0; run.treasures = 0; run.patrols = 0;
      run.warp = true; run.home = null; homeObj.visible = false;   // (v35: warp from the start; v34 sold it)
      picks = []; pickGeo.setDrawRange(0, 0);
      G.resetMods(); applyMods();
      showPopup(false);
      G.setUpgrades(0, 1);
      near = { stars: [], sites: [], at: new V(1e9, 0, 0), t: 0 };
      G.viewTarget(G.VC);
      refreshNear(); rockPositions(0); buildObstacles(); draw(G.VC);
    },
    stop() {
      run.on = false; run.landed = null; run.autoLand = null; showPopup(false);
      starSlots.clear(); rockSlots.clear(); clearDebris();
      for (const m of [...starPool, ...rockPool, ...shockPool, ...hints]) m.visible = false;
      homeObj.visible = false;
      picks = []; pickGeo.setDrawRange(0, 0);
      for (const b of G.bots) for (const m of b.obj.userData.mats) m.opacity = 1;
    },
    update,
    paused: () => false,                             // Endless never pauses (Settings still does)
    panels: () => (run.on && popup.visible ? [popup] : []),
    place() { if (popup.visible) placePopup(); },
    rebaseView() { run.rebase = true; },
    click,
    // A kill: credits drift out as pickups (a treasure ship: lots), and kills in quick succession chain combos.
    onKill(e) {
      if (run.demo) return;
      const t = e.home ? e.home.tier : tierAt(G.VC), bounty = e.home && e.home.bounty ? 2 : 1;
      if (e.treasure) {
        const v = 2500 * t;
        dropCredits(e.obj.position, v, 14); G.addScore(1500 * t);
        G.showMessage('TREASURE SHIP!', `+${N(1500 * t)}`, 2); G.chime();
      } else dropCredits(e.obj.position, e.points * t * bounty, 3 + Math.floor(Math.random() * 3));
      run.combo = run.comboT > 0 ? run.combo + 1 : 1; run.comboT = COMBO_T;
      if (run.combo >= 3) { const b = 100 * run.combo * t; G.addScore(b); G.showMessage(`COMBO x${run.combo}`, `+${N(b)}`, 1.2); }
      if (e.patrol && !G.enemies.some((x) => x !== e && x.patrol && x.hp > 0)) { const b = 400 * t; G.addScore(b); G.showMessage('PATROL DESTROYED', `+${N(b)}`, 1.6); }
    },
    tryRebuild() { if (run.rebuild <= 0 || run.demo) return false; run.rebuild--; G.showMessage('SHIP REBUILT', '', 1.6); return true; },
    upgradeLine, autoTarget,
    hitDmg,
    warpBlock: () => warpBlock(G.VC, G.warpDir()), warpStopAhead, get hasWarp() { return !!run.warp; },
    musicBoost() { return (G.enemies.some((e) => e.treasure && e.hp > 0) ? 0.25 : 0) + Math.min(0.3, run.combo * 0.06) + (run.active && run.active.bounty ? 0.2 : 0); },
    info() {
      const c = G.VC, o = run.active ? null : nearestOutpost(c);
      const hl = run.home && run.home.state === 'active' ? G.enemies.filter((e) => e.home === run.home && e.hp > 0).length : 0;
      return {
        homeLeft: hl,
        dist: Math.round(c.length() * DIST_K), maxDist: Math.round(run.maxDist * DIST_K), credits: run.credits, fleet: fleet(), outposts: run.outposts,
        active: run.active ? run.active.tier : 0, hostiles: G.enemies.length,
        next: o ? { dist: Math.round(o.pos.distanceTo(c) * DIST_K), tier: o.tier, bounty: !!o.bounty } : null, landed: !!run.landed, combo: run.combo,
        home: run.home && run.home.state !== 'dead' ? { dist: Math.round(Math.max(0, run.home.pos.distanceTo(c) - HOME_R) * DIST_K), wave: run.home.state === 'active' ? 1 : 0, total: run.home.total || 0 } : null,
        time: run.t, kills: G.kills(), won: !!(run.home && run.home.state === 'dead'),
        warp: G.warping(),
      };
    },
    saveBest() {
      const m = G.stats.modes.endless;
      m.bestScore = Math.max(m.bestScore, G.score());
      m.bestDist = Math.max(m.bestDist, Math.round(run.maxDist * DIST_K));
    },
    record() { G.recordEndless(Math.round(run.maxDist * DIST_K), G.score(), G.kills(), run.outposts); },
    endLine() { return `Distance ${N(Math.round(run.maxDist * DIST_K))} - ${N(run.outposts)} outpost${run.outposts === 1 ? '' : 's'}`; },
    demoRoute,
    // tests
    get run() { return run; }, get vcOff() { return vcOff; }, site, cellStars, rawCell, nearestOutpost, nearestDock, hash, get near() { return near; }, options, hints, shockPool, starPool, popup,
    consts: { REG, STAR_R, PAD_R, SAFE_R, LAND_KEEP, WARP_CONE_W, WARP_CONE_TAN, WARP_IGNORE, DIE_T, TIER_D, LAND_GLIDE, STAR_SEP, CELL, WARP_STOP, WARP_MIN, WARP_COST, HOME_UNLOCK, HOME_AHEAD, HOME_R, HOME_CLEAR, HOME_WAKE, HOME_WAVES, DIST_K },
    nearWarpStop, cornerField, starSlots, homeSwarm, get debris() { return debris; }, spawnHome, homeObj, pickMesh, inClearing, POOL, RARITY, rollOffers, buyUp, get picks() { return picks; }, dropCredits, spawnPatrol, spawnTreasure, level,
  };
}
