// Panel layouts (Settings > Layout): where the lobby menu, stats, Settings, tutorial card and the in-game
// score / announcements live. Three layouts, switchable live:
//   table   - a low holo command table between you and the room; its cards stand up (turn to face you)
//             when pointed at or in use. Everything on it stays below the line from your eye to the room's
//             front-bottom edge, so it never covers the battle.
//   ring    - a curved holo band above the room: menu in the lobby, score + announcements in a game.
//   pillars - two totems beside the room: menu on the left, stats / score + announcements on the right.
// Every panel is a ui.js Panel (canvas + buttons, picked by the ray's UV), so pointing, clicking and the
// beam / cursor work the same on flat and curved panels.
import * as THREE from '../vendor/three.module.js';
import { Panel, UI } from './ui.js?v=26';

export const LAYOUT_OPTS = [['table', 'Command table'], ['ring', 'Holo ring'], ['pillars', 'Twin pillars']];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// A curved band: an open cylinder segment around its own origin, centred on local -z, readable from inside.
function arcGeometry(R, H, A) {
  const g = new THREE.CylinderGeometry(R, R, H, 72, 1, true, Math.PI - A / 2, A);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setX(i, 1 - uv.getX(i));
  return g;
}
function makeArcPanel(rig, R, A, cw, ch) {
  const P = new Panel(1, cw, ch);
  const H = (R * A * ch) / cw;
  P.mesh.geometry.dispose();
  P.mesh.geometry = arcGeometry(R, H, A);
  P.mesh.userData.arc = true;
  P.arc = { R, A, H };
  // Button centre on the curve (the settings slide starts there; tests aim at it).
  P.buttonWorld = (id, out = new THREE.Vector3()) => {
    const b = P.buttons.find((k) => k.id === id);
    if (!b) return null;
    const th = Math.PI - A / 2 + (1 - (b.x + b.w / 2) / cw) * A;
    out.set(R * Math.sin(th), H / 2 - ((b.y + b.h / 2) / ch) * H, R * Math.cos(th));
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

export function createLayoutUI(G) {
  // G: { rig, seat, boxDims(), settings, stats, MODES, MODE_INFO, fmtNum, fmtTime, best(), screen(),
  //      lobbyClick(id), game(), menuPanel, menuAspect, tutorial, infoPanel, infoAspect, uiHit, menuOpen(),
  //      faceSeat(mesh) }
  const { rig, seat } = G;
  const lay = () => G.settings.layout;

  // ------------------------------------------------------------ table
  const tMenu = new Panel(0.42, 900, 520), tStats = new Panel(0.34, 760, 520);
  rig.add(tMenu.mesh, tStats.mesh);
  const table = new THREE.Group();
  const tableTop = new THREE.Mesh(new THREE.BoxGeometry(1, 0.008, 1), new THREE.MeshBasicMaterial({ color: 0x06304a, transparent: true, opacity: 0.42, depthTest: false, depthWrite: false, fog: false }));
  tableTop.renderOrder = 5;
  const tableGrid = new THREE.GridHelper(1, 12, 0x50dcff, 0x1d6b80);
  tableGrid.material.transparent = true; tableGrid.material.opacity = 0.28; tableGrid.material.depthTest = false; tableGrid.material.fog = false;
  tableGrid.renderOrder = 6; tableGrid.position.y = 0.0045;
  const tableEdge = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 0.008, 1)),
    new THREE.LineBasicMaterial({ color: 0x50dcff, transparent: true, opacity: 0.85, depthTest: false, fog: false }));
  tableEdge.renderOrder = 6;
  table.add(tableTop, tableGrid, tableEdge);
  table.visible = false;
  rig.add(table);
  // The score board's canvas is see-through (it floats over space in the other layouts): on the table it
  // gets the same dark glass + cyan frame as the cards, so the grid never runs through the numbers.
  { const plate = new THREE.Mesh(G.infoPanel.geometry, new THREE.MeshBasicMaterial({ color: 0x000a16, transparent: true, opacity: 0.88, depthTest: false, depthWrite: false, fog: false }));
    plate.renderOrder = 10;
    const rim = new THREE.LineSegments(new THREE.EdgesGeometry(G.infoPanel.geometry), new THREE.LineBasicMaterial({ color: 0x50dcff, transparent: true, opacity: 0.8, depthTest: false, fog: false }));
    rim.renderOrder = 10;
    G.infoPanel.add(plate, rim); }
  // Table geometry from the seat and the room (forward = -z, as the room is placed in front of you).
  const T = { x: 0, ty: 0.5, zNear: -0.03, zFar: -0.3, w: 1.2, slope: 0, yB: 0.5 };
  function tableGeom() {
    const s = seat, b = G.boxDims();
    const zN = b.z + b.hz, yB = b.y - b.hy;
    const D = Math.max(0.12, s.z - zN);                       // seat to the room's near face
    const dNear = 0.03, dFar = Math.max(dNear + 0.18, Math.min(D - 0.04, 0.6));
    T.slope = s.y > yB ? (s.y - yB) / D : 0;                  // the eye -> front-bottom-edge plane drops this much per metre
    T.ySight = (z) => (T.slope > 0 ? s.y - T.slope * (s.z - z) : Infinity);
    T.zNear = s.z - dNear; T.zFar = s.z - dFar;
    T.ty = clamp(Math.min(s.y - 0.5, T.ySight(T.zFar) - 0.05), 0.2, 2);
    // The room reaches over the table (very close room): drop the table below the room's floor.
    if (T.zFar < zN + 0.02 && T.ty > yB - 0.03) T.ty = yB - 0.03;
    T.x = clamp(b.x, s.x - 0.35, s.x + 0.35);
    T.w = Math.max(1.2, 2 * b.hx + 0.2);
    table.position.set(T.x, T.ty, (T.zNear + T.zFar) / 2);
    table.scale.set(T.w, 1, T.zNear - T.zFar);
  }
  const _r = new THREE.Vector3(), _fq = new THREE.Quaternion(), _e = new THREE.Vector3(), _u = new THREE.Vector3(), _c = new THREE.Vector3();
  const FLAT = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
  const _o = new THREE.Object3D();
  // Put a card on the table: centred at x (table-relative), lying flat (k = 0) or turned to face your eye
  // (k = 1), resting on the table and lifted a little when raised. The raise is cut back if the card's far
  // edge would come above the eye -> front-bottom-edge plane (so it never covers the room).
  function putCard(mesh, widthM, aspect, dx, wantW, k) {
    const avail = T.zNear - T.zFar - 0.03;
    const sc = Math.min(wantW / widthM, avail / (widthM * aspect));
    const h = widthM * aspect * sc;
    const cz = (T.zNear + T.zFar) / 2, cx = T.x + dx;
    mesh.scale.setScalar(sc);
    const w = widthM * sc;
    for (let kk = k; ; kk = Math.max(0, kk - 0.1)) {
      _o.position.set(cx, T.ty + 0.05, cz);
      _o.up.set(0, 1, 0);
      // Turn toward the eye; side cards only half-way sideways (less yaw keeps their corners back).
      _o.lookAt(seat.x + (cx - seat.x) * 0.5, seat.y, seat.z);
      _fq.copy(FLAT).slerp(_o.quaternion, kk);
      _u.set(0, 1, 0).applyQuaternion(_fq);                   // the card's "up" (toward its far edge)
      _r.set(1, 0, 0).applyQuaternion(_fq);
      const low = Math.min((-h / 2) * _u.y - (w / 2) * Math.abs(_r.y), (h / 2) * _u.y - (w / 2) * Math.abs(_r.y));
      mesh.quaternion.copy(_fq);
      mesh.position.set(cx, T.ty + 0.006 - low + kk * 0.012, cz);
      // every corner stays under the sight line
      let over = -1;
      for (const a of [-0.5, 0.5]) for (const bb of [-0.5, 0.5]) {
        _c.copy(mesh.position).addScaledVector(_r, a * w).addScaledVector(_u, bb * h);
        over = Math.max(over, _c.y - (T.ySight(_c.z) - 0.008));
      }
      if (over <= 0 || kk <= 0) break;
    }
  }
  const rise = new Map();                                     // per-card raise 0..1 (animated)
  function riseTo(P, target, dt) { const r = rise.get(P) ?? target; const n = r + clamp(target - r, -dt * 5, dt * 5); rise.set(P, n); return n; }

  // ------------------------------------------------------------ ring
  const RR = 1.2, RA = 1.45;
  const rLobby = makeArcPanel(rig, RR, RA, 3000, 240), rStats = makeArcPanel(rig, RR, RA, 3000, 104), rGame = makeArcPanel(rig, RR, RA, 3000, 240);
  function ringGeom() {
    const s = seat, b = G.boxDims();
    const y = Math.max(s.y + RR * Math.tan(0.4), b.y + b.hy + 0.1);
    const yaw = Math.atan2(-(b.x - s.x), -(b.z - s.z));
    for (const P of [rLobby, rGame]) { P.mesh.position.set(s.x, y, s.z); P.mesh.rotation.set(0, yaw, 0); }
    rStats.mesh.position.set(s.x, y + rLobby.arc.H / 2 + 0.012 + rStats.arc.H / 2, s.z); rStats.mesh.rotation.set(0, yaw, 0);
  }

  // ------------------------------------------------------------ pillars
  const pL = new Panel(0.3, 600, 1800), pR = new Panel(0.3, 600, 1800);
  rig.add(pL.mesh, pR.mesh);
  function pillarGeom() {
    const s = seat, b = G.boxDims(), h = 0.9;
    const y = Math.max(b.y, 0.2 + h / 2);
    [[pL, -1], [pR, 1]].forEach(([P, side]) => {
      P.mesh.position.set(b.x + side * (b.hx + 0.2), y, b.z + b.hz * 0.4);
      P.mesh.lookAt(s.x, y, s.z);
    });
  }

  for (const P of [tMenu, rLobby, pL]) { P.onClick = (id) => G.lobbyClick(id); P.isLobby = true; }
  for (const P of [tStats, rStats, pR]) { P.onClick = () => {}; P.isLobby = true; }

  // ------------------------------------------------------------ drawing
  const MODES = G.MODES, N = G.fmtNum, Tm = G.fmtTime;
  function drawTable() {
    const st = G.stats, mode = G.settings.mode;
    { const P = tMenu, W = P.W;
      P.begin();
      P.text('BATTLE ROOM', W / 2, 54, { size: 40, bold: true, color: UI.title, align: 'center' });
      MODES.forEach((m, i) => P.button('mode:' + m, 24 + i * 432, 78, 420, 84, m.toUpperCase(), { active: mode === m, size: 36 }));
      P.text(G.MODE_INFO[mode], W / 2, 200, { size: 26, align: 'center', maxW: W - 48 });
      P.button('start', 24, 222, W - 48, 132, 'START', { big: true, size: 70 });
      P.button('settings', 24, 376, 420, 82, 'SETTINGS', { size: 34 });
      P.button('tutorial', W - 444, 376, 420, 82, 'TUTORIAL', { size: 34 });
      P.text('GRIP: move the room   GRIP + STICK: resize', W / 2, 496, { size: 22, color: UI.dim, align: 'center', maxW: W - 40 });
      P.end(); }
    { const P = tStats, W = P.W;
      P.begin();
      P.text('STATS', 28, 50, { size: 34, bold: true, color: UI.title });
      P.text('BEST', 470, 50, { size: 22, color: UI.dim, align: 'center' }); P.text('GAMES', 650, 50, { size: 22, color: UI.dim, align: 'center' });
      MODES.forEach((m, i) => {
        const y = 96 + i * 44, s2 = st.modes[m];
        P.text(m.toUpperCase(), 28, y, { size: 30, color: mode === m ? UI.gold : UI.text });
        P.text(N(s2.best), 470, y, { size: 32, bold: true, color: UI.title, align: 'center' });
        P.text(N(s2.games), 650, y, { size: 30, color: UI.text, align: 'center' });
      });
      const rows = [['Win streak', `${st.streak} (best ${st.bestStreak})`], ['Total kills', N(st.kills)], ['Time in battle', Tm(st.time)],
        ['Screen time', G.screen()], ['Best score', N(G.best())]];
      rows.forEach(([l, v], i) => { const y = 214 + i * 64; P.text(l, 28, y, { size: 32, color: UI.text, maxW: 360 }); P.text(v, W - 28, y, { size: 34, bold: true, color: UI.title, align: 'right', maxW: 340 }); });
      P.end(); }
  }
  function drawRingLobby() {
    const st = G.stats, mode = G.settings.mode;
    { const P = rLobby;
      P.begin();
      MODES.forEach((m, i) => P.button('mode:' + m, 430 + i * 330, 40, 310, 160, m.toUpperCase(), { active: mode === m, size: 52 }));
      P.button('start', 1130, 22, 740, 196, 'START', { big: true, size: 104 });
      P.button('settings', 1910, 40, 330, 160, 'SETTINGS', { size: 50 });
      P.button('tutorial', 2260, 40, 330, 160, 'TUTORIAL', { size: 50 });
      P.end(); }
    { const P = rStats;
      P.begin();
      const s = `BEST ROUND  F ${st.modes.fighter.best} / S ${st.modes.squadron.best}      KILLS ${N(st.kills)}      GAMES ${N(st.games)}      SCREEN ${G.screen()}      BEST SCORE ${N(G.best())}`;
      P.text(s, 1500, 70, { size: 46, color: UI.text, align: 'center', maxW: 2200 });
      P.end(); }
  }
  function drawPillarsLobby() {
    const st = G.stats, mode = G.settings.mode;
    { const P = pL, W = P.W;
      P.begin();
      P.text('MENU', W / 2, 92, { size: 60, bold: true, color: UI.title, align: 'center' });
      MODES.forEach((m, i) => P.button('mode:' + m, 30, 150 + i * 180, W - 60, 160, m === 'fighter' ? 'FIGHTER' : 'SQUAD', { active: mode === m, size: 58 }));
      P.text(mode === 'fighter' ? 'fly one ship' : 'lead 4 bots', W / 2, 545, { size: 36, color: UI.text, align: 'center', maxW: W - 40 });
      P.button('start', 30, 600, W - 60, 420, 'START', { big: true, size: 100 });
      P.button('settings', 30, 1080, W - 60, 170, 'SETTINGS', { size: 52 });
      P.button('tutorial', 30, 1280, W - 60, 170, 'TUTORIAL', { size: 52 });
      P.text('GRIP: move room', W / 2, 1620, { size: 34, color: UI.dim, align: 'center' });
      P.text('+ STICK: resize', W / 2, 1670, { size: 34, color: UI.dim, align: 'center' });
      P.end(); }
    { const P = pR, W = P.W;
      P.begin();
      P.text('STATS', W / 2, 92, { size: 60, bold: true, color: UI.title, align: 'center' });
      const rows = [['Best Fighter', N(st.modes.fighter.best)], ['Best Squad', N(st.modes.squadron.best)], ['Win streak', N(st.streak)], ['Kills', N(st.kills)],
        ['Games', N(st.games)], ['In battle', Tm(st.time)], ['Screen time', G.screen()], ['Best score', N(G.best())]];
      rows.forEach(([l, v], i) => { const y = 200 + i * 196; P.text(l, W / 2, y, { size: 40, color: UI.dim, align: 'center' }); P.text(v, W / 2, y + 70, { size: 66, bold: true, color: UI.title, align: 'center', maxW: W - 40 }); });
      P.end(); }
  }
  function drawLobby() {
    if (lay() === 'table') drawTable(); else if (lay() === 'ring') drawRingLobby(); else drawPillarsLobby();
  }
  // In-game score + announcements (the table uses the side board canvas itself).
  let gameKey = '';
  function drawGame(force = false) {
    const d = G.game();
    if (lay() === 'table' || (d.state !== 'playing' && d.state !== 'gameover')) return;   // the lobby owns the pillars there
    const key = [lay(), d.score, d.wave, d.hostiles, d.state, d.msgOn, d.msgTitle, d.msgSub, d.intermission, d.mode].join('|');
    if (!force && key === gameKey) return;
    gameKey = key;
    const sub = d.state === 'gameover' ? `ROUND ${d.wave}` : d.intermission ? `ROUND ${d.wave} CLEARED` : `ROUND ${d.wave}`;
    if (lay() === 'ring') {
      const P = rGame, g = P.g;
      P.begin();
      P.text(sub, 760, 112, { size: 72, bold: true, color: UI.title, align: 'center', maxW: 600 });
      if (d.state === 'playing' && !d.intermission) P.text(`${d.hostiles} HOSTILE${d.hostiles === 1 ? '' : 'S'}`, 760, 186, { size: 50, color: UI.text, align: 'center' });
      g.fillStyle = UI.faint; g.fillRect(1090, 30, 3, 180); g.fillRect(1908, 30, 3, 180);
      P.text('SCORE', 1500, 62, { size: 40, bold: true, color: UI.dim, align: 'center' });
      P.text(N(d.score), 1500, 200, { size: 140, bold: true, color: '#7fe9ff', align: 'center', maxW: 780 });
      if (d.msgOn) {
        P.text(d.msgTitle, 2240, 100, { size: 64, bold: true, color: UI.title, align: 'center', maxW: 640 });
        const lines = wrap(g, d.msgSub, 640, '40px monospace', 2);
        lines.forEach((l, i) => P.text(l, 2240, 158 + i * 46, { size: 40, color: UI.gold, align: 'center', maxW: 640 }));
      }
      P.end();
    } else {
      { const P = pR, W = P.W, g = P.g;
        P.begin();
        if (d.msgOn) {
          g.fillStyle = 'rgba(80,220,255,0.14)'; g.fillRect(8, 30, W - 16, 600);
          const tl = wrap(g, d.msgTitle, W - 50, 'bold 60px monospace', 2);
          tl.forEach((l, i) => P.text(l, W / 2, 110 + i * 70, { size: 60, bold: true, color: UI.title, align: 'center', maxW: W - 40 }));
          const sl = wrap(g, d.msgSub, W - 50, '40px monospace', 6);
          sl.forEach((l, i) => P.text(l, W / 2, 140 + tl.length * 70 + i * 52, { size: 40, color: UI.gold, align: 'center', maxW: W - 40 }));
        }
        P.text('SCORE', W / 2, 780, { size: 52, bold: true, color: UI.dim, align: 'center' });
        P.text(N(d.score), W / 2, 900, { size: 104, bold: true, color: '#7fe9ff', align: 'center', maxW: W - 30 });
        P.text(sub, W / 2, 1100, { size: 58, bold: true, color: UI.title, align: 'center', maxW: W - 40 });
        if (d.state === 'playing' && !d.intermission) P.text(`${d.hostiles} HOSTILE${d.hostiles === 1 ? '' : 'S'}`, W / 2, 1190, { size: 44, color: UI.text, align: 'center' });
        P.end(); }
      { const P = pL, W = P.W;
        P.begin();
        P.text(d.mode === 'squadron' ? 'SQUADRON' : 'FIGHTER', W / 2, 92, { size: 54, bold: true, color: UI.title, align: 'center', maxW: W - 40 });
        P.text(sub, W / 2, 200, { size: 46, color: UI.text, align: 'center', maxW: W - 40 });
        P.text('BEST SCORE', W / 2, 760, { size: 44, color: UI.dim, align: 'center' });
        P.text(N(Math.max(G.best(), d.score)), W / 2, 850, { size: 76, bold: true, color: UI.title, align: 'center', maxW: W - 40 });
        P.text('BEST ROUND', W / 2, 1010, { size: 44, color: UI.dim, align: 'center' });
        P.text(String(G.stats.modes[d.mode] ? G.stats.modes[d.mode].best : 0), W / 2, 1100, { size: 76, bold: true, color: UI.title, align: 'center' });
        P.text('SETTINGS', W / 2, 1600, { size: 46, bold: true, color: UI.dim, align: 'center' });
        P.text('X + Y', W / 2, 1670, { size: 44, color: UI.dim, align: 'center' });
        P.end(); }
    }
  }

  // ------------------------------------------------------------ placement + per-frame
  const menuHomeQ = new THREE.Quaternion();
  let menuScale = 1;
  // After the default placement (main.js), move what this layout owns. Called when the room / seat /
  // layout changes. Returns nothing; menuPanel / tutorial card / side board transforms are set here.
  function place() {
    tableGeom(); ringGeom(); pillarGeom();
    const L = lay();
    if (L === 'table') {
      putCard(G.menuPanel, 0.46, G.menuAspect, -0.42, 0.34, 1);
      menuHomeQ.copy(G.menuPanel.quaternion); menuScale = G.menuPanel.scale.x;
    } else if (L === 'pillars') {
      const s = seat, p = pL.mesh.position;
      G.menuPanel.position.set(p.x - 0.02, p.y + 0.12, p.z).lerp(_e.set(s.x, p.y + 0.12, s.z), 0.22);
      G.menuPanel.scale.setScalar(1); menuScale = 1;
    } else { menuScale = 1; G.menuPanel.scale.setScalar(1); }
    frame(0, true);
  }
  // Settings panel orientation (called by the settings animation every frame).
  function orientMenu(mesh) {
    if (lay() === 'table') { mesh.quaternion.copy(menuHomeQ); mesh.scale.setScalar(menuScale); } else G.faceSeat(mesh);
  }
  const pointedAt = (P) => (G.uiHit.right && G.uiHit.right.panel === P) || (G.uiHit.left && G.uiHit.left.panel === P);
  function frame(dt, snap = false) {
    const L = lay(), st = G.game().state;
    const lobby = st === 'lobby', game = st === 'playing' || st === 'gameover', tut = st === 'tutorial';
    table.visible = L === 'table';
    tMenu.visible = L === 'table' && lobby; tStats.visible = L === 'table' && lobby;
    rLobby.visible = rStats.visible = L === 'ring' && lobby; rGame.visible = L === 'ring' && game;
    // Pillars: Settings opens in place of the menu pillar (it slides out of its SETTINGS button), so the
    // pillar's buttons never show through the settings glass.
    pR.visible = L === 'pillars' && (lobby || game);
    pL.visible = pR.visible && !(lobby && G.menuPanel.visible);
    if (L === 'table') {
      const step = snap ? 99 : dt;
      if (tMenu.visible) putCard(tMenu.mesh, tMenu.widthM, tMenu.H / tMenu.W, 0, 0.42, riseTo(tMenu, 1, step));
      if (tStats.visible) putCard(tStats.mesh, tStats.widthM, tStats.H / tStats.W, 0.42, 0.34, riseTo(tStats, pointedAt(tStats) ? 1 : 0, step));
      const card = G.tutorial.card;
      if (tut || card.visible) putCard(card.mesh, card.widthM, card.H / card.W, 0, 0.34, riseTo(card, 1, step));
      if (game || G.infoPanel.visible) putCard(G.infoPanel, 0.44, G.infoAspect, 0, 0.36, riseTo(G.infoPanel, 1, step));
    }
  }
  function menuFrom(out) {
    const P = mainPanel();
    return (P && P.visible && P.buttonWorld('settings', out)) || out.copy(G.menuPanel.position);
  }
  function mainPanel() { return lay() === 'table' ? tMenu : lay() === 'ring' ? rLobby : pL; }
  // Pickable lobby panels (only in the lobby, so nothing catches the ray during a battle).
  function lobbyPanels() { return G.game().state === 'lobby' ? [tMenu, tStats, rLobby, rStats, pL, pR] : []; }
  return {
    tMenu, tStats, rLobby, rStats, rGame, pL, pR, table, T,
    drawLobby, drawGame, place, frame, orientMenu, menuFrom, mainPanel, lobbyPanels,
    get layout() { return lay(); },
  };
}
