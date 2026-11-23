// v16 "Command School": a campaign of hand-designed battles, from Launchie to Commander.
// Fighter battles first, then Squadron, then Fleet. Each battle is one round and earns 1-3 stars:
//   1 star  = win
//   2nd star = few losses (Fighter: lose at most 2 hull, Squadron: at most 1 ship, Fleet: at most a third
//              of the fleet's points)
//   3rd star = win inside the par time
// Every new star is worth 100 XP and every win 50 XP more. XP sets your rank; ranks unlock ship types,
// a bigger Fleet budget and more deployment slots (in the campaign AND in free play).
// Progress lives in localStorage.
const KEY = 'battleRoomCampaign1';

export const RANKS = [
  { name: 'LAUNCHIE', xp: 0, types: ['fighter', 'capital'], budget: 0, squads: 3, caps: 2 },
  { name: 'CADET', xp: 300, types: ['fighter', 'capital'], budget: 2, squads: 3, caps: 2 },
  { name: 'TOON MEMBER', xp: 800, types: ['fighter', 'interceptor', 'capital'], budget: 4, squads: 4, caps: 2 },
  { name: 'TOON LEADER', xp: 1400, types: ['fighter', 'interceptor', 'bomber', 'capital'], budget: 6, squads: 4, caps: 2 },
  { name: 'SQUAD COMMANDER', xp: 2100, types: ['fighter', 'interceptor', 'bomber', 'shield', 'capital'], budget: 8, squads: 5, caps: 2 },
  { name: 'FLEET CAPTAIN', xp: 3000, types: ['fighter', 'interceptor', 'bomber', 'shield', 'capital'], budget: 12, squads: 5, caps: 3 },
  { name: 'COMMANDER', xp: 4200, types: ['fighter', 'interceptor', 'bomber', 'shield', 'capital'], budget: 16, squads: 6, caps: 3 },
];

// groups: { role, n, cls, heavy } - role = enemy tactic, cls = ship class (Fleet), heavy = cruisers in the group.
// Fleet battles: caps = enemy flagships, capHp, budget = your deployment points before rank bonuses.
export const BATTLES = [
  // FIGHTER
  { id: 1, name: 'FIRST FLIGHT', mode: 'fighter', wave: 1, par: 45, brief: 'Two slow raiders. Get the feel of it.', groups: [{ role: 'flank', n: 2 }] },
  { id: 2, name: 'PINCER', mode: 'fighter', wave: 1, par: 55, brief: 'They split up and come from both sides.', groups: [{ role: 'pincer', n: 2 }, { role: 'flank', n: 1 }] },
  { id: 3, name: 'LONG GUNS', mode: 'fighter', wave: 2, par: 65, brief: 'Snipers hold back. Close the gap.', groups: [{ role: 'sniper', n: 2 }, { role: 'pincer', n: 2 }] },
  { id: 4, name: 'HEAVY METAL', mode: 'fighter', wave: 3, par: 80, brief: 'A cruiser with escorts. Spread shots hurt.', groups: [{ role: 'heavy', n: 1 }, { role: 'flank', n: 2 }, { role: 'pincer', n: 2 }] },
  { id: 5, name: 'ACE TEST', mode: 'fighter', wave: 4, par: 95, brief: 'Everything at once. Prove you can fly.', groups: [{ role: 'pincer', n: 2 }, { role: 'flank', n: 3 }, { role: 'sniper', n: 2 }, { role: 'heavy', n: 1 }] },
  // SQUADRON
  { id: 6, name: 'TOON UP', mode: 'squadron', wave: 1, par: 55, brief: 'Your first squadron. Lead them in.', groups: [{ role: 'flank', n: 3 }, { role: 'pincer', n: 2 }] },
  { id: 7, name: 'THE BAIT', mode: 'squadron', wave: 2, par: 75, brief: 'One ship runs. Its friends wait behind a star.', groups: [{ role: 'bait', n: 3 }, { role: 'flank', n: 2 }] },
  { id: 8, name: 'BEHIND THE STARS', mode: 'squadron', wave: 3, par: 85, brief: 'Snipers hide behind stars. Flush them out.', groups: [{ role: 'sniper', n: 3 }, { role: 'pincer', n: 2 }, { role: 'flank', n: 2 }] },
  { id: 9, name: 'HUNTED', mode: 'squadron', wave: 4, par: 95, brief: 'Hunters chase your damaged ships.', groups: [{ role: 'hunter', n: 3 }, { role: 'flank', n: 3 }, { role: 'heavy', n: 1 }] },
  { id: 10, name: 'SWARM', mode: 'squadron', wave: 5, par: 120, brief: 'A big swarm with cruiser support.', groups: [{ role: 'pincer', n: 4 }, { role: 'flank', n: 4 }, { role: 'bait', n: 3 }, { role: 'heavy', n: 2 }] },
  // FLEET
  { id: 11, name: 'FIRST COMMAND', mode: 'fleet', wave: 1, par: 150, budget: 32, caps: 1, capHp: 60, brief: 'One flagship, two fighter groups. Place your fleet, then sink it.',
    groups: [{ role: 'flank', n: 3, cls: 'fighter' }, { role: 'pincer', n: 4, cls: 'fighter' }] },
  { id: 12, name: 'FAST MOVERS', mode: 'fleet', wave: 2, par: 160, budget: 32, caps: 1, capHp: 70, brief: 'Interceptors hunt your fighters. Capital guns shred them.',
    groups: [{ role: 'hunter', n: 5, cls: 'interceptor' }, { role: 'pincer', n: 4, cls: 'fighter' }] },
  { id: 13, name: 'BOMBER RUN', mode: 'fleet', wave: 2, par: 170, budget: 34, caps: 1, capHp: 70, brief: 'Bombers go for your capital ships. Intercept them.',
    groups: [{ role: 'pincer', n: 4, cls: 'bomber' }, { role: 'flank', n: 4, cls: 'fighter' }] },
  { id: 14, name: 'SHIELD WALL', mode: 'fleet', wave: 3, par: 180, budget: 36, caps: 1, capHp: 80, brief: 'Shields protect their fleet. Heavy shots break shields.',
    groups: [{ role: 'pincer', n: 4, cls: 'shield' }, { role: 'flank', n: 4, cls: 'fighter' }, { role: 'sniper', n: 3, cls: 'bomber' }] },
  { id: 15, name: 'TWIN FLAGSHIPS', mode: 'fleet', wave: 3, par: 210, budget: 40, caps: 2, capHp: 70, brief: 'Two flagships. Bombers sink them fastest.',
    groups: [{ role: 'pincer', n: 4, cls: 'fighter' }, { role: 'flank', n: 4, cls: 'interceptor' }, { role: 'bait', n: 3, cls: 'fighter' }] },
  { id: 16, name: 'AMBUSH FIELD', mode: 'fleet', wave: 4, par: 210, budget: 42, caps: 1, capHp: 90, brief: 'Lots of stars, lots of hiding places. Scout first.',
    groups: [{ role: 'bait', n: 4, cls: 'interceptor' }, { role: 'sniper', n: 4, cls: 'bomber' }, { role: 'flank', n: 5, cls: 'fighter' }] },
  { id: 17, name: 'THE GAUNTLET', mode: 'fleet', wave: 5, par: 240, budget: 46, caps: 2, capHp: 85, brief: 'Every enemy type. Pick your counters.',
    groups: [{ role: 'pincer', n: 5, cls: 'interceptor' }, { role: 'flank', n: 5, cls: 'bomber' }, { role: 'pincer', n: 4, cls: 'shield' }, { role: 'hunter', n: 4, cls: 'fighter' }] },
  { id: 18, name: 'GRADUATION', mode: 'fleet', wave: 6, par: 270, budget: 50, caps: 2, capHp: 100, brief: 'The final exam. Win it to make Commander.',
    groups: [{ role: 'pincer', n: 6, cls: 'fighter', heavy: 1 }, { role: 'flank', n: 5, cls: 'interceptor' }, { role: 'sniper', n: 5, cls: 'bomber' }, { role: 'pincer', n: 5, cls: 'shield' }] },
];
export const LOSS_LIMIT = { fighter: 2, squadron: 1, fleet: 0.34 };   // most you can lose and still get the 2nd star

function fresh() { return { xp: 0, stars: {}, best: {}, wins: {} }; }
export const progress = fresh();
try {
  const s = JSON.parse(localStorage.getItem(KEY) || 'null');
  if (s && typeof s === 'object') {
    if (typeof s.xp === 'number' && isFinite(s.xp)) progress.xp = s.xp;
    for (const k of ['stars', 'best', 'wins']) if (s[k] && typeof s[k] === 'object') Object.assign(progress[k], s[k]);
  }
} catch (e) { /* ignore */ }
let unlockAllFlag = false;                       // test only: everything unlocked
export function setUnlockAll(v) { unlockAllFlag = v; }
function save() { try { localStorage.setItem(KEY, JSON.stringify(progress)); } catch (e) { /* ignore */ } }

export function rankIndex(xp = progress.xp) { let r = 0; RANKS.forEach((k, i) => { if (xp >= k.xp) r = i; }); return unlockAllFlag ? RANKS.length - 1 : r; }
export function rank() { return RANKS[rankIndex()]; }
export function nextRank() { return RANKS[rankIndex() + 1] || null; }
export function totalStars() { return Object.values(progress.stars).reduce((a, b) => a + b, 0); }
export function maxStars() { return BATTLES.length * 3; }
export function starsOf(id) { return progress.stars[id] || 0; }
// A battle is open once the one before it has been won (the first is always open).
export function unlocked(id) { return unlockAllFlag || id === 1 || starsOf(id - 1) > 0; }
export function battle(id) { return BATTLES.find((b) => b.id === id) || null; }
export function nextBattle() { return BATTLES.find((b) => !starsOf(b.id) && unlocked(b.id)) || BATTLES[BATTLES.length - 1]; }
// What you may deploy: your rank's ship types, budget bonus and slots.
export function deployLimits() { const r = rank(); return { types: r.types.slice(), bonus: r.budget, squads: r.squads, caps: r.caps }; }
export function typeUnlockRank(cls) { const i = RANKS.findIndex((r) => r.types.includes(cls)); return i >= 0 ? RANKS[i] : null; }

// Score a finished battle; save it. Returns what happened (for the result message).
export function finishBattle(b, won, lossFrac, lossCount, time) {
  const r0 = rankIndex();
  let stars = 0;
  if (won) {
    stars = 1;
    const lossOk = b.mode === 'fleet' ? lossFrac <= LOSS_LIMIT.fleet : lossCount <= LOSS_LIMIT[b.mode];
    if (lossOk) stars++;
    if (time <= b.par) stars++;
  }
  const old = starsOf(b.id);
  let xp = 0;
  if (stars > old) { xp += (stars - old) * 100; progress.stars[b.id] = stars; }
  if (won) { xp += 50; progress.wins[b.id] = (progress.wins[b.id] || 0) + 1; progress.best[b.id] = Math.min(progress.best[b.id] || 1e9, Math.round(time)); }
  progress.xp += xp;
  save();
  const r1 = rankIndex();
  return { stars, old, xp, rankUp: r1 > r0 ? RANKS[r1] : null, newTypes: r1 > r0 ? RANKS[r1].types.filter((t) => !RANKS[r0].types.includes(t)) : [] };
}
export function resetProgress() { Object.assign(progress, fresh()); save(); }
export function starText(n, max = 3) { return '★'.repeat(n) + '☆'.repeat(Math.max(0, max - n)); }
