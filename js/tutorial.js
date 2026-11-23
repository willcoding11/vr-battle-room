// First-run tutorial: one idea per step, on one card that always looks the same:
//   section + progress bar / which hand / short title / one line / big animated icon / status.
// The button to use also glows on the controller you hold. Each step waits for you to do it, shows a
// short "NICE!" beat, then fades calmly into the next. Info steps use the CONTINUE button centred below
// the room. G is the game API from main.js.
import { Panel, drawIcon, HAND_COLOR, HI, UI } from './ui.js?v=14';

const READ = 1.2;          // seconds before an action counts (time to read the card)
const NICE = 1.5;          // the "NICE!" beat
const NICE_FLEET = 2.0;    // a little longer in the Fleet part
const FADE = 0.45;         // fade out / in between steps
const SECTIONS = ['ROOM', 'FLY', 'SQUADRON', 'FLEET'];

export function createTutorial(G) {
  const card = new Panel(0.5, 760, 700);
  const big = new Panel(0.42, 640, 128);
  // Drawn early with depth testing: ships and stars in front of the card always show over it.
  for (const P of [card, big]) { P.mesh.material.depthTest = true; P.mesh.renderOrder = -1; }
  let idx = -1, t = 0, phase = 'in', pt = 0, acc = 0, shots0 = 0, redraw = 0, n0 = 0;
  let lastFwd = null, turned = 0, box0 = null;
  const held = (dt, cond) => { acc = cond ? acc + dt : 0; return acc; };
  const steerName = () => G.settings.steer;
  // Steering instructions follow the steering style you picked.
  const steerLine = () => ({ mirror: 'Turn your right hand', relative: 'Tilt your right hand', point: 'Point your right hand', stick: 'Push the right stick' })[steerName()] || 'Turn your right hand';
  const steerIcon = () => ({ mirror: 'mirror', relative: 'relative', point: 'point', stick: 'stick' })[steerName()] || 'mirror';
  const steerHi = () => (steerName() === 'stick' ? ['stick'] : ['body']);
  const moved = () => (box0 ? Math.hypot(G.box.x - box0.x, G.box.y - box0.y, G.box.z - box0.z) : 0);
  const kills = (n) => () => [Math.max(0, n - G.enemyCount()), n];
  const selHint = () => (G.selected.size ? '' : 'Select first: click the left stick');
  // Order steps: if a different order went out (or the units got deselected), say how to fix it.
  const orderHint = (ok, where) => () => {
    if (ok()) return '';
    if (!G.selected.size) return 'Select all: click the left stick';
    return G.lastOrder ? 'Not quite: point at ' + where : '';
  };
  const steps = [
    // ROOM
    { id: 'welcome', sect: 'ROOM', stage: 'box', title: 'YOUR BATTLE ROOM', line: 'Battles happen in this box', icon: 'room', info: true },
    { id: 'move', sect: 'ROOM', hand: 'either', title: 'MOVE THE ROOM', line: 'Hold grip, move your hand', icon: 'gripMove', hi: { right: ['grip'], left: ['grip'] },
      enter: () => { box0 = { ...G.box }; }, check: () => moved() > 0.08, meter: () => [Math.min(1, moved() / 0.08), 1] },
    { id: 'resize', sect: 'ROOM', hand: 'either', title: 'RESIZE THE ROOM', line: 'Hold grip, push stick up/down', icon: 'gripResize', hi: { right: ['grip', 'stick'], left: ['grip', 'stick'] },
      enter: () => { box0 = { ...G.box }; }, check: () => Math.abs(G.box.size - box0.size) > 0.12, meter: () => [Math.min(1, Math.abs(G.box.size - box0.size) / 0.12), 1] },
    // FLY
    { id: 'steer', sect: 'FLY', stage: 'fly', hand: 'right', title: 'STEER YOUR SHIP', line: steerLine, icon: steerIcon, hi: () => ({ right: steerHi() }),
      check: () => turned > 2.0, meter: () => [Math.min(1, turned / 2.0), 1] },
    { id: 'styles', sect: 'FLY', hand: 'right', title: 'STEERING STYLE', line: 'Mirror is easiest. Try one.', choice: true, info: true },
    { id: 'shoot', sect: 'FLY', hand: 'right', title: 'SHOOT', line: 'Pull the right trigger', icon: 'trigger', hi: { right: ['trigger'] },
      enter: () => { shots0 = G.shots; }, check: () => G.shots - shots0 >= 8, meter: () => [Math.min(8, G.shots - shots0), 8] },
    { id: 'boost', sect: 'FLY', hand: 'right', title: 'BOOST', line: 'Hold the right grip', icon: 'boost', hi: { right: ['grip'] },
      check: (dt) => held(dt, G.input.boost) > 1.5, meter: () => [Math.min(1.5, acc), 1.5] },
    { id: 'target', sect: 'FLY', stage: 'enemy', hand: 'right', title: 'DESTROY THE TARGET', line: 'Steer at it and shoot', icon: 'target', hi: { right: ['trigger'] },
      enter: () => G.spawnTut('practice', 1), check: () => G.enemyCount() === 0, meter: kills(1) },
    { id: 'three', sect: 'FLY', hand: 'right', title: 'THREE MORE', line: "Practice ships can't hurt you", icon: 'target', hi: { right: ['trigger'] },
      enter: () => G.spawnTut('practice', 3), check: () => G.enemyCount() === 0, meter: kills(3) },
    // SQUADRON
    { id: 'squad', sect: 'SQUADRON', stage: 'squadron', title: 'YOUR SQUADRON', line: '4 fighters fly where you lead', icon: 'squad', info: true },
    { id: 'sqSteer', sect: 'SQUADRON', hand: 'right', title: 'LEAD THEM', line: steerLine, icon: steerIcon, hi: () => ({ right: steerHi() }),
      check: () => turned > 1.8, meter: () => [Math.min(1, turned / 1.8), 1] },
    { id: 'sqEngage', sect: 'SQUADRON', hand: 'right', title: 'ATTACK', line: 'Hold the right trigger', icon: 'engage', hi: { right: ['trigger'] },
      enter: () => G.spawnTut('squad', 3), check: (dt) => held(dt, G.input.fire) > 2.0, meter: () => [Math.min(2, acc), 2] },
    { id: 'sqRegroup', sect: 'SQUADRON', hand: 'right', title: 'REGROUP', line: 'Let go of the trigger', icon: 'regroup', hi: { right: ['trigger'] },
      check: (dt) => held(dt, !G.input.fire) > 1.5, meter: () => [Math.min(1.5, acc), 1.5] },
    { id: 'sqClear', sect: 'SQUADRON', hand: 'right', title: 'FINISH THEM', line: 'Hold the trigger until done', icon: 'engage', hi: { right: ['trigger'] },
      enter: () => { if (!G.enemyCount()) G.spawnTut('squad', 2); n0 = G.enemyCount(); }, check: () => G.enemyCount() === 0, meter: () => [n0 - G.enemyCount(), n0] },
    // FLEET
    { id: 'fleet', sect: 'FLEET', stage: 'fleet', title: 'YOUR FLEET', line: '3 squadrons, 2 capital ships', icon: 'fleet', info: true },
    { id: 'select', sect: 'FLEET', hand: 'left', title: 'SELECT A SQUADRON', line: 'Point left hand, pull trigger', icon: 'selectRay', hi: { left: ['trigger'] },
      check: () => G.selected.size >= 1, hint: () => (G.selectMissed() ? 'Missed: point right at the ships' : '') },
    { id: 'all', sect: 'FLEET', hand: 'left', title: 'SELECT EVERYTHING', line: 'Click the left stick', icon: 'selectAll', hi: { left: ['stickClick'] },
      check: () => G.selected.size >= G.unitsAlive() },
    { id: 'command', sect: 'FLEET', hand: 'right', title: 'STEER THE FLEET', line: steerLine, icon: steerIcon, hi: () => ({ right: steerHi() }),
      check: () => G.selected.size > 0 && turned > 1.2, meter: () => [Math.min(1, turned / 1.2), 1], hint: selHint },
    { id: 'orders', sect: 'FLEET', hand: 'left', title: 'GIVING ORDERS', line: 'Point left hand, squeeze grip', icon: 'orders', info: true },
    { id: 'hold', sect: 'FLEET', hand: 'left', title: 'ORDER: HOLD', line: 'Point at empty space, grip', icon: 'orderHold', hi: { left: ['grip'] },
      enter: () => G.selectAll(), check: () => G.lastOrder === 'HOLD POSITION', hint: orderHint(() => G.lastOrder === 'HOLD POSITION', 'empty space') },
    { id: 'guard', sect: 'FLEET', hand: 'left', title: 'ORDER: GUARD', line: 'Point at a star, grip', icon: 'orderGuard', hi: { left: ['grip'] },
      enter: () => G.selectAll(), check: () => G.lastOrder === 'GUARD STAR', hint: orderHint(() => G.lastOrder === 'GUARD STAR', 'a star') },
    { id: 'follow', sect: 'FLEET', hand: 'left', title: 'ORDER: FOLLOW', line: 'Point at a capital ship, grip', icon: 'orderFollow', hi: { left: ['grip'] },
      enter: () => G.selectSquads(), check: () => G.lastOrder.startsWith('FOLLOW'),
      hint: () => (G.selected.size < 2 && !G.lastOrder.startsWith('FOLLOW') ? 'Select all first: click the left stick' : orderHint(() => G.lastOrder.startsWith('FOLLOW'), 'a capital ship')()) },
    { id: 'attack', sect: 'FLEET', hand: 'left', title: 'ORDER: ATTACK', line: 'Point at an enemy, grip', icon: 'orderAttack', hi: { left: ['grip'] },
      enter: () => { G.selectAll(); G.spawnTut('weak', 3); n0 = 3; }, check: () => G.lastOrder.startsWith('ATTACK'), hint: orderHint(() => G.lastOrder.startsWith('ATTACK'), 'a red enemy') },
    { id: 'watch', sect: 'FLEET', title: 'WATCH THEM GO', line: 'Your fleet attacks on its own', icon: 'watch', hand: null,
      check: () => G.enemyCount() === 0, meter: () => [n0 - G.enemyCount(), n0] },
    { id: 'flagship', sect: 'FLEET', hand: 'left', title: 'SINK THE FLAGSHIP', line: 'Order an attack on it', icon: 'flagship', hi: { left: ['grip'] },
      enter: () => { G.selectAll(); G.spawnTut('flagship', 1); }, check: () => G.enemyCount() === 0, meter: () => [G.flagshipDamage(), 1],
      hint: orderHint(() => G.lastOrder.startsWith('ATTACK'), 'the red flagship') },
    { id: 'done', sect: 'FLEET', title: 'TRAINING COMPLETE', line: 'Good luck, commander', icon: 'check', info: true, last: true },
  ];
  const val = (v) => (typeof v === 'function' ? v() : v);

  function go(i) {
    idx = i; t = 0; pt = 0; phase = 'in'; acc = 0; turned = 0; lastFwd = null;
    G.lastOrder = '';
    const st = steps[i];
    if (!st) { finish(); return; }
    if (st.stage) G.stage(st.stage);
    if (st.enter) st.enter();
    card.visible = true;
    big.visible = false;
    card.hover = null; big.hover = null;
    G.highlight(val(st.hi) || {});
    G.cue();
    draw();
    G.log('tutorial step ' + (i + 1) + ' ' + st.id);
  }
  function finish() {
    card.visible = false; big.visible = false; idx = -1;
    G.highlight({});
    G.finishTutorial();
  }
  function complete() {
    if (phase !== 'show' && phase !== 'in') return;
    const st = steps[idx];
    phase = st.info ? 'out' : 'done'; pt = 0;      // info steps: no "nice", just move on
    big.visible = false;
    G.highlight({});
    if (!st.info) G.good(); else G.ping();
    draw();
  }
  card.onClick = (id) => {
    if (id === 'skip') finish();
    else if (id.startsWith('steer:')) { G.setSetting('steer', id.slice(6)); draw(); }
  };
  big.onClick = (id) => { if (id === 'continue') complete(); };

  function header(st) {
    const W = card.W;
    card.text(st.sect, 30, 46, { size: 30, bold: true, color: UI.text });
    card.text(`${idx + 1} / ${steps.length}`, W - 30, 46, { size: 30, color: UI.text, align: 'right' });
    const g = card.g, x0 = 30, w = W - 60;
    g.fillStyle = 'rgba(80,220,255,0.15)'; g.fillRect(x0, 64, w, 8);
    g.fillStyle = 'rgba(80,220,255,0.85)'; g.fillRect(x0, 64, w * ((idx + (phase === 'done' || phase === 'out' ? 1 : 0)) / steps.length), 8);
    // Section ticks.
    let k = 0;
    for (const s of SECTIONS) {
      const first = steps.findIndex((x) => x.sect === s);
      if (first > 0) { g.fillStyle = 'rgba(0,10,22,1)'; g.fillRect(x0 + (w * first) / steps.length - 2, 62, 4, 12); }
      k++;
    }
  }
  function draw() {
    const st = steps[idx];
    if (!st) return;
    const g = card.g, W = card.W, H = card.H;
    const tt = performance.now() / 1000;
    const finished = phase === 'done' || (phase === 'out' && !st.info);
    card.begin();
    header(st);
    // Which hand (always the same spot, in that hand's colour).
    if (st.hand) {
      const lab = { right: 'RIGHT HAND', left: 'LEFT HAND', either: 'EITHER HAND' }[st.hand];
      const col = HAND_COLOR[st.hand];
      g.strokeStyle = col; g.lineWidth = 3;
      g.beginPath(); g.roundRect(W / 2 - 170, 88, 340, 56, 28); g.stroke();
      card.text(lab, W / 2, 127, { size: 32, bold: true, color: col, align: 'center', maxW: 310 });
    }
    card.text(st.title, W / 2, 212, { size: 58, bold: true, color: UI.title, align: 'center', maxW: W - 50 });
    card.text(val(st.line), W / 2, 266, { size: 38, color: '#e6fbff', align: 'center', maxW: W - 40 });
    if (finished) drawIcon(g, 'check', W / 2, 440, 300, tt);
    else if (st.choice) {
      drawIcon(g, steerIcon(), W / 2, 345, 150, tt, 'right');
      const modes = [['mirror', 'MIRROR'], ['relative', 'RELATIVE'], ['point', 'POINT'], ['stick', 'STICK']];
      modes.forEach(([k, l], n) => card.button('steer:' + k, n % 2 ? W / 2 + 8 : W / 2 - 348, 420 + Math.floor(n / 2) * 92, 340, 80, l, { active: steerName() === k, size: 36 }));
    } else drawIcon(g, val(st.icon), W / 2, 445, 300, tt, st.hand === 'left' ? 'left' : 'right');
    // Status line: NICE! / progress / continue / hint.
    if (finished) card.text('NICE!', W / 2, 640, { size: 56, bold: true, color: HI, align: 'center' });
    else if (st.info) {
      if (big.visible) {
        const bob = Math.sin(tt * 4) * 4;
        card.text('▼  CONTINUE below the room  ▼', W / 2, 640 + bob, { size: 32, color: UI.gold, bold: true, align: 'center', maxW: W - 60 });
      }
    } else {
      const h = st.hint ? st.hint() : '';
      if (h) card.text(h, W / 2, 640, { size: 32, color: UI.gold, align: 'center', maxW: W - 60 });
      else if (st.meter) {
        const [a, b] = st.meter();
        const f = b ? Math.max(0, Math.min(1, a / b)) : 0;
        g.strokeStyle = 'rgba(80,220,255,0.5)'; g.lineWidth = 2; g.strokeRect(150, 606, W - 300, 26);
        g.fillStyle = HI; g.fillRect(153, 609, (W - 306) * f, 20);
        if (b > 1 && Number.isInteger(b)) card.text(`${Math.floor(a)} / ${b}`, W - 140, 628, { size: 24, color: UI.dim });
      }
    }
    card.button('skip', W - 190, H - 50, 170, 38, 'skip tutorial', { size: 20, subtle: true });
    card.end();
    if (big.visible) {
      big.begin();
      big.button('continue', 8, 8, big.W - 16, big.H - 16, st.last ? 'TO THE LOBBY' : 'CONTINUE', { big: true, size: 48 });
      big.end();
    }
  }

  function update(dt) {
    const st = steps[idx];
    if (!st) return;
    t += dt; pt += dt;
    // How far the commanded heading has turned (for the steering steps).
    if (lastFwd) turned += lastFwd.angleTo(G.player.fwd);
    lastFwd = (lastFwd || G.player.fwd.clone()).copy(G.player.fwd);
    let op = 1;
    if (phase === 'in') { op = Math.min(1, pt / FADE); if (pt >= FADE) { phase = 'show'; pt = 0; } }
    if (phase === 'show') {
      if (st.info && !big.visible && t > 0.8) { big.visible = true; draw(); }
      // Actions only count once you've had a moment to read the card.
      if (!st.info && st.check) { const ok = st.check(dt); if (ok && t > READ + FADE) complete(); }
    } else if (phase === 'done') {
      if (pt > (st.sect === 'FLEET' ? NICE_FLEET : NICE)) { phase = 'out'; pt = 0; }
    } else if (phase === 'out') {
      op = Math.max(0, 1 - pt / FADE);
      if (pt > FADE + 0.25) { go(idx + 1); return; }
    }
    card.mesh.material.opacity = op;
    big.mesh.material.opacity = op;
    redraw -= dt;
    if (redraw <= 0) { redraw = 1 / 20; draw(); }
  }

  return {
    card, big, steps,
    start() { go(0); },
    update,
    stop() { card.visible = false; big.visible = false; idx = -1; G.highlight({}); },
    get step() { return steps[idx] ? steps[idx].id : null; },
    get index() { return idx; },
    get phase() { return idx >= 0 ? phase : null; },
    get active() { return idx >= 0; },
    redraw: draw,
  };
}
