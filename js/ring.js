// The holo ring: a curved band above the battle room, facing you.
//   Lobby: FIGHTER / SQUADRON / ENDLESS, START, SETTINGS, STATS and TUTORIAL on one row (all within about 35 degrees
//          of straight ahead), with your best score and best round on a short line above.
//   Game:  round and hostiles, the score in the middle, announcements on the right.
// STATS opens a stats panel to the RIGHT of the room (Settings opens on the left): it slides out of the
// ring's STATS button with a quick fade, like Settings.
//
// The band never covers the battle: its bottom edge is kept above the room's top, so every sight line to it
// passes over the room (nothing in the room is behind it), and it is drawn early with depth testing, so any
// ship or shot between you and the band shows in front of it.
// Panels are ui.js Panels (canvas + buttons picked by the ray's UV), so pointing, clicking and the beam /
// cursor work the same on the curved band.
import * as THREE from '../vendor/three.module.js';
import { Panel, UI } from './ui.js?v=34';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const RR = 1.2;                    // ring radius around your seat (m)
const RA = 1.45;                   // ring arc (radians, about 83 degrees)
const PX_PER_RAD = 3000 / RA;      // canvas density shared by all ring panels

// A curved band: an open cylinder segment around its own origin, centred on local -z, readable from inside.
function arcGeometry(R, H, A) {
  const g = new THREE.CylinderGeometry(R, R, H, 72, 1, true, Math.PI - A / 2, A);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setX(i, 1 - uv.getX(i));
  return g;
}
function makeArcPanel(rig, A, ch) {
  const cw = Math.round(A * PX_PER_RAD);
  const P = new Panel(1, cw, ch);
  const H = (RR * A * ch) / cw;
  P.mesh.geometry.dispose();
  P.mesh.geometry = arcGeometry(RR, H, A);
  P.mesh.userData.arc = true;
  // Drawn first, with depth: ships and shots in front of the band show over it.
  P.mesh.material.depthTest = true; P.mesh.material.depthWrite = true; P.mesh.renderOrder = -1;
  P.arc = { R: RR, A, H };
  // Button centre on the curve (the panel slides start there; tests aim at it).
  P.buttonWorld = (id, out = new THREE.Vector3()) => {
    const b = P.buttons.find((k) => k.id === id);
    if (!b) return null;
    const th = Math.PI - A / 2 + (1 - (b.x + b.w / 2) / cw) * A;
    out.set(RR * Math.sin(th), H / 2 - ((b.y + b.h / 2) / ch) * H, RR * Math.cos(th));
    P.mesh.updateMatrixWorld(true);
    return P.mesh.localToWorld(out);
  };
  rig.add(P.mesh);
  return P;
}
// Word-wrap into at most `max` lines that fit maxW at the given font.
function wrap(g, str, maxW, font, max = 3) {
  g.font = font;
  const words = String(str).split(' '), lines = [];
  let cur = '';
  for (const w of words) {
    const t = cur ? cur + ' ' + w : w;
    if (g.measureText(t).width <= maxW || !cur) cur = t; else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  return lines.slice(0, max);
}

export function createRingUI(G) {
  // G: { rig, seat, settings, stats, MODES, MODE_INFO, fmtNum, fmtTime, best(), screen(), boxDims(), game(),
  //      lobbyClick(id), faceSeat(mesh), placeSide(mesh, side, widthM), uiHit }
  const { rig, seat } = G;
  const N = G.fmtNum, Tm = G.fmtTime;
  const lobby = makeArcPanel(rig, RA, 240);         // the menu row
  const key = makeArcPanel(rig, 0.62, 96);          // best score / best round, above START
  const game = makeArcPanel(rig, RA, 240);          // score + announcements in a game
  lobby.onClick = (id) => G.lobbyClick(id);

  // ---------------------------------------------------------------- stats panel (right of the room)
  const STATS_M = 0.46;
  const statsP = new Panel(STATS_M, 760, 872);
  rig.add(statsP.mesh);
  statsP.onClick = (id) => { if (id === 'close') toggleStats(false); G.click(); };
  for (const P of [lobby, statsP]) P.isLobby = true;   // hover redraws go through drawLobby()

  // ---------------------------------------------------------------- drawing
  // One section per mode, each with that mode's own numbers; overall totals in the header line.
  const DASH = '—';
  function modeRows(m) {
    const s = G.stats.modes[m];
    return [[['BEST ROUND', N(s.best)], ['GAMES', N(s.games)], ['LAST ROUND', N(s.last)], ['BEST SCORE', N(s.bestScore)]],
      [['KILLS', N(s.kills)], ['TIME PLAYED', Tm(s.time)], ['WIN STREAK', `${N(s.streak)} (best ${N(s.bestStreak)})`]]];
  }
  function endlessRows() {
    const s = G.stats.modes.endless;
    const v = (f) => (s ? f(s) : DASH);              // Endless arrives in v28
    return [[['BEST DISTANCE', v((e) => N(e.bestDist))], ['BEST SCORE', v((e) => N(e.bestScore))], ['OUTPOSTS', v((e) => N(e.outposts))]],
      [['GAMES', v((e) => N(e.games))], ['TIME PLAYED', v((e) => Tm(e.time))]]];
  }
  function drawStats() {
    const P = statsP, W = P.W, g = P.g, st = G.stats, mode = G.settings.mode;
    P.begin();
    P.text('STATS', W / 2, 56, { size: 40, bold: true, color: UI.title, align: 'center' });
    P.text(`Screen time ${G.screen()}    Total kills ${N(st.kills)}    Games ${N(st.games)}`, W / 2, 98, { size: 22, color: UI.text, align: 'center', maxW: W - 40 });
    const sections = [['FIGHTER', 'fighter', modeRows('fighter')], ['SQUADRON', 'squadron', modeRows('squadron')], ['ENDLESS', 'endless', endlessRows()]];
    sections.forEach(([title, m, rows], k) => {
      const y0 = 116 + k * 214;
      g.fillStyle = UI.faint; g.fillRect(20, y0, W - 40, 2);
      if (m === mode) { g.fillStyle = UI.active; g.fillRect(20, y0 + 2, W - 40, 210); }
      P.text(title, 32, y0 + 38, { size: 30, bold: true, color: m === mode ? UI.gold : UI.title });
      rows.forEach((row, r) => {
        const cw = (W - 56) / row.length;
        row.forEach(([l, v], i) => {
          const x = 28 + cw * (i + 0.5), y = y0 + 76 + r * 76;
          P.text(l, x, y, { size: 22, color: UI.dim, align: 'center', maxW: cw - 8 });
          P.text(v, x, y + 36, { size: 34, bold: true, color: v === DASH ? UI.dim : UI.title, align: 'center', maxW: cw - 12 });
        });
      });
    });
    g.fillStyle = UI.faint; g.fillRect(20, 758, W - 40, 2);
    P.button('close', 12, 772, W - 24, 56, 'CLOSE', { size: 28 });
    P.text('Press STATS again to close', W / 2, 858, { size: 20, color: UI.dim, align: 'center' });
    P.end();
  }
  function drawLobby() {
    const mode = G.settings.mode;
    { const P = lobby;
      P.begin();
      G.MODES.forEach((m, i) => P.button('mode:' + m, 220 + i * 310, 40, 295, 160, m.toUpperCase(), { active: mode === m, size: 46 }));
      P.button('start', 1160, 22, 680, 196, 'START', { big: true, size: 104 });
      [['settings', 'SETTINGS'], ['stats', 'STATS'], ['tutorial', 'TUTORIAL']].forEach(([id, l], i) =>
        P.button(id, 1870 + i * 310, 40, 290, 160, l, { size: 46, active: (id === 'stats' && statsOpen()) || (id === 'settings' && G.menuOpen()) }));
      P.end(); }
    { const P = key, W = P.W;
      P.begin();
      const sec = mode === 'endless' ? `BEST DISTANCE ${N(G.stats.modes.endless.bestDist)}` : `BEST ROUND ${N(G.stats.modes[mode].best)}`;
      P.text(`BEST SCORE ${N(G.best())}      ${sec}`, W / 2, 64, { size: 44, color: UI.text, align: 'center', maxW: W - 60 });
      P.end(); }
    if (statsP.visible) drawStats();
  }
  // In-game score + announcements.
  let gameKey = '';
  function drawGame(force = false) {
    const d = G.game();
    if (d.state !== 'playing' && d.state !== 'gameover') return;
    const k = [d.score, d.wave, d.hostiles, d.state, d.msgOn, d.msgTitle, d.msgSub, d.intermission, JSON.stringify(d.endless), game.hover].join('|');
    if (!force && k === gameKey) return;
    gameKey = k;
    const sub = d.state === 'gameover' ? `ROUND ${d.wave}` : d.intermission ? `ROUND ${d.wave} CLEARED` : `ROUND ${d.wave}`;
    const P = game, g = P.g;
    if (d.endless) { drawEndless(d); return; }
    P.begin();
    P.text(sub, 760, 112, { size: 72, bold: true, color: UI.title, align: 'center', maxW: 600 });
    if (d.state === 'playing' && !d.intermission) P.text(`${d.hostiles} HOSTILE${d.hostiles === 1 ? '' : 'S'}`, 760, 186, { size: 50, color: UI.text, align: 'center' });
    g.fillStyle = UI.faint; g.fillRect(1090, 30, 3, 180); g.fillRect(1908, 30, 3, 180);
    P.text('SCORE', 1500, 62, { size: 40, bold: true, color: UI.dim, align: 'center' });
    P.text(N(d.score), 1500, 200, { size: 140, bold: true, color: '#7fe9ff', align: 'center', maxW: 780 });
    if (d.msgOn) {
      P.text(d.msgTitle, 2240, 100, { size: 64, bold: true, color: UI.title, align: 'center', maxW: 640 });
      const lines = wrap(g, d.msgSub.split('\n')[0], 640, '40px monospace', 2);
      lines.forEach((l, i) => P.text(l, 2240, 158 + i * 46, { size: 40, color: UI.gold, align: 'center', maxW: 640 }));
    }
    P.end();
  }

  // Endless: distance, fleet and credits on the left, score in the middle, announcements (or the distance
  // to the next outpost) on the right.
  function drawEndless(d) {
    const P = game, g = P.g, e = d.endless;
    P.begin();
    P.text(`DISTANCE ${N(e.dist)}`, 760, 100, { size: 60, bold: true, color: UI.title, align: 'center', maxW: 620 });
    const left = e.home && e.home.wave ? `HOMEWORLD ${e.home.wave}/3  ${e.homeLeft} LEFT` : e.active ? `TIER ${e.active} OUTPOST  ${e.hostiles} LEFT` : e.warp ? 'WARP' : `FLEET ${e.fleet}   CREDITS ${N(e.credits)}`;
    P.text(left, 760, 172, { size: 42, color: e.active || e.warp || (e.home && e.home.wave) ? UI.gold : UI.text, align: 'center', maxW: 620 });
    g.fillStyle = UI.faint; g.fillRect(1090, 30, 3, 180); g.fillRect(1908, 30, 3, 180);
    P.text('SCORE', 1500, 62, { size: 40, bold: true, color: UI.dim, align: 'center' });
    P.text(N(d.score), 1500, 200, { size: 140, bold: true, color: '#7fe9ff', align: 'center', maxW: 780 });
    if (d.msgOn) {
      P.text(d.msgTitle, 2240, 100, { size: 64, bold: true, color: UI.title, align: 'center', maxW: 640 });
      const lines = wrap(g, d.msgSub.split('\n')[0], 640, '40px monospace', 2);
      lines.forEach((l, i) => P.text(l, 2240, 158 + i * 46, { size: 40, color: UI.gold, align: 'center', maxW: 640 }));
    } else if (e.home) {                             // v34: the goal, once it has appeared
      P.text('HOMEWORLD', 2240, 92, { size: 40, bold: true, color: UI.dim, align: 'center' });
      P.text(N(e.home.dist), 2240, 160, { size: 54, bold: true, color: '#ff6688', align: 'center', maxW: 640 });
    } else if (e.next) {
      P.text('NEXT OUTPOST', 2240, 92, { size: 40, bold: true, color: UI.dim, align: 'center' });
      P.text(`${N(e.next.dist)}   TIER ${e.next.tier}`, 2240, 160, { size: 54, bold: true, color: '#ff8877', align: 'center', maxW: 640 });
    }
    P.end();
  }

  // ---------------------------------------------------------------- placement
  // Lower than before (v26) but the band's bottom edge always stays above the room's top. In the lobby the
  // rooms are never taller than the cube, so the ring sits just above the cube's top and stays still.
  function place() {
    const s = seat, b = G.boxDims();
    const top = b.y + (G.game().state === 'lobby' ? Math.max(b.hy, b.cube) : b.hy);
    const y = Math.max(s.y + RR * Math.tan(0.2), top + lobby.arc.H / 2 + 0.03);
    const yaw = Math.atan2(-(b.x - s.x), -(b.z - s.z));
    for (const P of [lobby, game]) { P.mesh.position.set(s.x, y, s.z); P.mesh.rotation.set(0, yaw, 0); }
    key.mesh.position.set(s.x, y + lobby.arc.H / 2 + 0.01 + key.arc.H / 2, s.z); key.mesh.rotation.set(0, yaw, 0);
    G.placeSide(statsP.mesh, 1, STATS_M);
    statsHome.copy(statsP.mesh.position);
  }

  // ---------------------------------------------------------------- stats open / close (mirrors Settings)
  const statsHome = new THREE.Vector3(), statsFrom = new THREE.Vector3();
  const anim = { open: false, t: 1, dur: 0.3, closing: false };
  function statsOpen() { return anim.open; }
  function toggleStats(open = !anim.open) {
    if (open === anim.open) return;
    anim.open = open;
    if (open) {
      drawStats();
      if (!lobby.buttonWorld('stats', statsFrom)) statsFrom.copy(statsHome);
      anim.t = 0; anim.dur = 0.3; anim.closing = false;
      statsP.mesh.material.opacity = 0;
      statsP.mesh.position.copy(statsFrom);
      statsP.visible = true;
    } else if (statsP.visible) { anim.t = 0; anim.dur = 0.15; anim.closing = true; }
    drawLobby();                                       // the STATS button shows whether it is open
    G.log('stats ' + (open ? 'open' : 'closed'));
  }
  function animateStats(dt) {
    const m = statsP.mesh;
    if (!statsP.visible) return;
    if (anim.t >= 1 && !anim.closing) { m.position.copy(statsHome); G.faceSeat(m); m.material.opacity = 1; return; }
    anim.t = Math.min(1, anim.t + dt / anim.dur);
    const u = anim.t, e = 1 - Math.pow(1 - u, 3);    // ease-out
    if (anim.closing) {
      m.material.opacity = 1 - u;
      if (u >= 1) { statsP.visible = false; anim.closing = false; m.material.opacity = 1; }
      return;
    }
    m.position.lerpVectors(statsFrom, statsHome, e);
    m.position.z += Math.sin(u * Math.PI) * 0.12;     // a slight arc toward you, past the room
    G.faceSeat(m);
    m.material.opacity = Math.min(1, u * 1.6);
  }

  function frame(dt) {
    const st = G.game().state;
    const inLobby = st === 'lobby';
    lobby.visible = key.visible = inLobby;
    game.visible = st === 'playing' || st === 'gameover';
    // Leaving the lobby (START) closes the stats panel with its normal fade-out.
    if (!inLobby && anim.open) toggleStats(false);
    animateStats(dt);
  }
  // The settings panel slides out of the ring's SETTINGS button (lobby only).
  function menuFrom(out) { return lobby.visible ? lobby.buttonWorld('settings', out) : null; }
  // Pickable panels (only in the lobby, so nothing catches the ray during a battle).
  function lobbyPanels() { return G.game().state === 'lobby' ? [lobby, statsP] : []; }
  return {
    lobby, key, game, statsPanel: statsP,
    drawLobby, drawGame, place, frame, menuFrom, lobbyPanels, toggleStats,
    get statsOpen() { return anim.open; },
  };
}
