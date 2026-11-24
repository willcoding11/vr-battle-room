// First-run tutorial: one idea per step, on one plain card: title, one short line, a picture of the
// controller (the button to use is lit on the picture), and NEXT (plus a subtle "skip tutorial").
// Each step waits for you to do it, shows a check mark for a moment, then fades into the next.
// Info steps go on with NEXT. Three parts: the room, flying, the squadron; then the lobby.
// G is the game API from main.js.
import { Panel, drawIcon, UI } from './ui.js?v=24';

const READ = 1.2;          // seconds before an action counts (time to read the card)
const NICE = 1.5;          // the "NICE!" beat
const FADE = 0.45;         // fade out / in between steps

export function createTutorial(G) {
  const card = new Panel(0.5, 760, 660);
  const big = new Panel(0.42, 640, 128);
  // Drawn early with depth testing: ships and stars in front of the card always show over it.
  for (const P of [card, big]) { P.mesh.material.depthTest = true; P.mesh.renderOrder = -1; }
  let idx = -1, t = 0, phase = 'in', pt = 0, acc = 0, shots0 = 0, redraw = 0, n0 = 0;
  let lastFwd = null, turned = 0, box0 = null, form0 = 0;
  const held = (dt, cond) => { acc = cond ? acc + dt : 0; return acc; };
  const moved = () => (box0 ? Math.hypot(G.box.x - box0.x, G.box.y - box0.y, G.box.z - box0.z) : 0);
  const steps = [
    // The room
    { id: 'welcome', stage: 'box', title: 'YOUR BATTLE ROOM', line: 'Your battles happen in this box', icon: 'room', info: true },
    { id: 'move', hand: 'either', title: 'MOVE THE ROOM', line: 'Hold grip + move hand', icon: 'gripMove', manual: true,
      enter: () => { box0 = { ...G.box }; }, check: () => moved() > 0.08 },
    { id: 'resize', hand: 'either', title: 'RESIZE THE ROOM', line: 'Hold grip + push stick', icon: 'gripResize', manual: true,
      enter: () => { box0 = { ...G.box }; }, check: () => Math.abs(G.box.size - box0.size) > 0.12 },
    // Flying
    { id: 'steer', stage: 'fly', hand: 'right', title: 'STEER YOUR SHIP', line: 'Point right hand where to fly', icon: 'mirror',
      check: () => turned > 2.0 },
    { id: 'shoot', hand: 'right', title: 'SHOOT', line: 'Pull right trigger', icon: 'trigger',
      enter: () => { shots0 = G.shots; }, check: () => G.shots - shots0 >= 8 },
    { id: 'boost', hand: 'right', title: 'BOOST', line: 'Hold right grip', icon: 'boost',
      check: (dt) => held(dt, G.input.boost) > 1.5 },
    { id: 'target', stage: 'enemy', hand: 'right', title: 'DESTROY THE TARGET', line: 'Steer at it + pull trigger', icon: 'target',
      enter: () => G.spawnTut('practice', 1), check: () => G.enemyCount() === 0 },
    { id: 'three', hand: 'right', title: 'THREE MORE', line: "Same again. They can't hurt you", icon: 'target',
      enter: () => G.spawnTut('practice', 3), check: () => G.enemyCount() === 0 },
    // The squadron
    { id: 'squad', stage: 'squadron', title: 'YOUR SQUADRON', line: '4 fighters follow where you point', icon: 'squad', info: true },
    { id: 'sqSteer', hand: 'right', title: 'LEAD THEM', line: 'Point right hand where to go', icon: 'mirror',
      check: () => turned > 1.8 },
    { id: 'sqEngage', hand: 'right', title: 'ATTACK', line: 'Hold right trigger', icon: 'engage',
      enter: () => G.spawnTut('squad', 3), check: (dt) => held(dt, G.input.fire) > 2.0 },
    { id: 'sqRegroup', hand: 'right', title: 'REGROUP', line: 'Let go of the trigger', icon: 'regroup',
      check: (dt) => held(dt, !G.input.fire) > 1.5 },
    { id: 'sqClear', hand: 'right', title: 'FINISH THEM', line: 'Hold trigger until all are gone', icon: 'engage',
      enter: () => { if (!G.enemyCount()) G.spawnTut('squad', 2); }, check: () => G.enemyCount() === 0 },
    { id: 'split', hand: 'left', title: 'SPLIT', line: 'Press X: two pairs', icon: 'split',
      check: () => G.split },
    { id: 'leadB', hand: 'left', title: 'LEAD THE GOLD PAIR', line: 'Point left hand where to go', icon: 'leadGold',
      track: () => G.cmdB.fwd, check: () => G.split && turned > 1.5,
      hint: () => (G.split ? '' : 'Press X to split again') },
    { id: 'rejoin', hand: 'left', title: 'REJOIN', line: 'Press X again', icon: 'rejoin',
      check: () => !G.split },
    { id: 'formation', hand: 'right', title: 'FORMATION', line: 'Press A: line, wedge or ring', icon: 'formation',
      enter: () => { form0 = G.formChanges; }, check: () => G.formChanges > form0 },
    { id: 'done', title: 'TRAINING COMPLETE', line: 'Press TO LOBBY to pick a mode', icon: 'check', info: true, last: true },
  ];
  const val = (v) => (typeof v === 'function' ? v() : v);

  function go(i) {
    idx = i; t = 0; pt = 0; phase = 'in'; acc = 0; turned = 0; lastFwd = null;
    const st = steps[i];
    if (!st) { finish(); return; }
    if (st.stage) G.stage(st.stage);
    if (st.enter) st.enter();
    card.visible = true;
    big.visible = false;
    card.hover = null; big.hover = null;
    G.cue();
    draw();
    G.log('tutorial step ' + (i + 1) + ' ' + st.id);
  }
  function finish() {
    card.visible = false; big.visible = false; idx = -1;
    G.finishTutorial();
  }
  function complete() {
    if (phase !== 'show' && phase !== 'in') return;
    const st = steps[idx];
    phase = st.info ? 'out' : 'done'; pt = 0;      // info steps: no check mark, just move on
    if (!st.info) G.good(); else G.ping();
    draw();
  }
  // NEXT on the card: works on info steps, and once an action step is done (skips the rest of the pause).
  const nextReady = () => { const st = steps[idx]; return st && (st.info ? phase === 'show' && t > 0.6 : phase === 'done'); };
  card.onClick = (id) => {
    if (id === 'next' && nextReady()) { const st = steps[idx]; if (st.info) complete(); else { phase = 'out'; pt = 0; G.ping(); } }
    else if (id === 'skip') finish();
  };
  big.onClick = (id) => { if (id === 'continue') complete(); };

  function draw() {
    const st = steps[idx];
    if (!st) return;
    const g = card.g, W = card.W, H = card.H;
    const tt = performance.now() / 1000;
    const finished = phase === 'done' || (phase === 'out' && !st.info);
    card.begin();
    card.text(st.title, W / 2, 92, { size: 56, bold: true, color: UI.title, align: 'center', maxW: W - 60 });
    card.text(val(st.line), W / 2, 150, { size: 38, color: '#e6fbff', align: 'center', maxW: W - 60 });
    drawIcon(g, finished && !st.manual ? 'check' : val(st.icon), W / 2, 335, 280, tt, st.hand === 'left' ? 'left' : 'right');
    const h = !finished && st.hint ? st.hint() : '';
    if (h) card.text(h, W / 2, 500, { size: 30, color: UI.gold, align: 'center', maxW: W - 60 });
    // NEXT: always in the same spot; lit when you can press it, dim while the step waits for you.
    const nx = W / 2 - 160, ny = 520, nw = 320, nh = 84;
    const label = st.last ? 'TO LOBBY' : 'NEXT';
    if (nextReady()) card.button('next', nx, ny, nw, nh, label, { big: true, active: true, size: 42 });
    else {
      g.strokeStyle = 'rgba(80,220,255,0.3)'; g.lineWidth = 2; g.strokeRect(nx + 1, ny + 1, nw - 2, nh - 2);
      card.text(label, W / 2, ny + nh / 2 + 14, { size: 38, color: 'rgba(95,169,191,0.6)', align: 'center' });
    }
    card.button('skip', 12, H - 50, 186, 42, 'skip tutorial', { size: 22, subtle: true });
    card.end();
  }

  function update(dt) {
    const st = steps[idx];
    if (!st) return;
    t += dt; pt += dt;
    // How far the commanded heading has turned (for the steering steps).
    const tv = st.track ? st.track() : G.player.fwd;
    if (lastFwd) turned += lastFwd.angleTo(tv);
    lastFwd = (lastFwd || tv.clone()).copy(tv);
    let op = 1;
    if (phase === 'in') { op = Math.min(1, pt / FADE); if (pt >= FADE) { phase = 'show'; pt = 0; } }
    if (phase === 'show') {
      // Actions only count once you've had a moment to read the card.
      if (!st.info && st.check) { const ok = st.check(dt); if (ok && t > READ + FADE) complete(); }
    } else if (phase === 'done') {
      if (pt > NICE && !st.manual) { phase = 'out'; pt = 0; }   // room steps wait for NEXT so you can keep adjusting
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
    stop() { card.visible = false; big.visible = false; idx = -1; },
    get step() { return steps[idx] ? steps[idx].id : null; },
    get index() { return idx; },
    get phase() { return idx >= 0 ? phase : null; },
    get active() { return idx >= 0; },
    redraw: draw,
  };
}
