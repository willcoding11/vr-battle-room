// Player stats, kept in localStorage: per-mode best round and games, plus overall totals.
const KEY = 'battleRoomStats1';
const MODES = ['fighter', 'squadron'];

function fresh() {
  const s = { games: 0, kills: 0, time: 0, screen: 0, roundsCleared: 0, bestScore: 0, streak: 0, bestStreak: 0, modes: {} };
  for (const m of MODES) s.modes[m] = { best: 0, games: 0, last: 0 };
  return s;
}

export const stats = fresh();
try {
  const saved = JSON.parse(localStorage.getItem(KEY) || 'null');
  if (saved) {
    for (const k of Object.keys(stats)) if (k !== 'modes' && typeof saved[k] === 'number' && isFinite(saved[k])) stats[k] = saved[k];
    for (const m of MODES) if (saved.modes && saved.modes[m]) Object.assign(stats.modes[m], saved.modes[m]);
  }
  // Carry over the v12 per-mode best round.
  const old = JSON.parse(localStorage.getItem('battleRoomBestRound') || '{}');
  for (const m of MODES) if (old[m] > stats.modes[m].best) stats.modes[m].best = old[m];
} catch (e) { /* ignore */ }

export function saveStats() { try { localStorage.setItem(KEY, JSON.stringify(stats)); } catch (e) { /* ignore */ } }

// A game is a "win" if you cleared at least one round; the win streak counts wins in a row.
export function recordGame(mode, round, score, kills) {
  const m = stats.modes[mode];
  stats.games++;
  m.games++;
  m.last = round;
  m.best = Math.max(m.best, round);
  stats.kills += kills;
  stats.roundsCleared += Math.max(0, round - 1);
  stats.bestScore = Math.max(stats.bestScore, score);
  if (round >= 2) { stats.streak++; stats.bestStreak = Math.max(stats.bestStreak, stats.streak); } else stats.streak = 0;
  saveStats();
}

// Scores and other counts with thousands separators: 18450 -> "18,450" (shared by every display).
export function fmtNum(n) { return Math.round(n).toLocaleString('en-US'); }

export function fmtTime(sec) {
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60);
  return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`;
}
