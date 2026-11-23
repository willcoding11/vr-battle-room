// First-run tutorial: one instruction at a time, animated icons, minimal text.
// Each step waits for the player to do the thing (or press a button). G is the game API from main.js.
import { Panel, drawIcon, UI } from './ui.js?v=13';

export function createTutorial(G) {
  const card = new Panel(0.36, 720, 640);   // instruction card, right of the room
  const big = new Panel(0.3, 600, 130);     // big CONTINUE button, centred under the room
  let idx = -1, t = 0, done = false, doneT = 0, acc = 0, shots0 = 0, redraw = 0;
  let lastFwd = null, turned = 0;
  const selHint = () => (G.selected.size ? '' : 'Select first: LEFT trigger or stick click');
  const held = (dt, cond) => { acc = cond ? acc + dt : 0; return acc; };
  const steps = [
    { id: 'room', stage: 'box', text: 'YOUR BATTLE ROOM', icons: [['gripMove', 'GRIP + MOVE'], ['gripResize', 'GRIP + STICK']], next: 'big' },
    { id: 'steer', stage: 'fly', text: 'STEER YOUR SHIP', sub: 'Try each style, then NEXT', steerList: true, next: 'button' },
    { id: 'shoot', text: 'TRIGGER: SHOOT', icon: 'trigger', check: () => G.shots - shots0 >= 8 },
    { id: 'boost', text: 'GRIP: BOOST', icon: 'boost', check: (dt) => held(dt, G.input.boost) > 1.2 },
    { id: 'target', stage: 'enemy', text: 'DESTROY THE TARGET', icon: 'trigger', enter: () => G.spawnTut('practice', 1), check: () => t > 1 && G.enemyCount() === 0 },
    { id: 'three', text: '3 MORE - THEY SHOOT BACK', icon: 'trigger', enter: () => G.spawnTut('easy', 3), check: () => t > 1 && G.enemyCount() === 0 },
    { id: 'sqSteer', stage: 'squadron', text: 'YOU LEAD 4 FIGHTERS', sub: 'Turn the controller: their heading', icon: 'mirror', check: () => turned > 1.6 },
    { id: 'sqEngage', text: 'HOLD TRIGGER: ENGAGE', icon: 'engage', enter: () => G.spawnTut('easy', 2), check: (dt) => held(dt, G.input.fire) > 1.5 },
    { id: 'sqRegroup', text: 'RELEASE: REGROUP', icon: 'regroup', check: (dt) => held(dt, !G.input.fire) > 1.2 },
    { id: 'sqBoost', text: 'GRIP: BOOST', icon: 'boost', check: (dt) => held(dt, G.input.boost && !G.input.fire) > 1.0 },
    { id: 'sqClear', text: 'FINISH THEM', sub: 'Hold trigger to engage', icon: 'engage', enter: () => { if (!G.enemyCount()) G.spawnTut('easy', 2); }, check: () => t > 1 && G.enemyCount() === 0 },
    { id: 'fleet', stage: 'fleet', text: 'YOUR FLEET', sub: '3 squadrons + 2 capital ships', icon: 'capital', next: 'button' },
    { id: 'select', text: 'LEFT: POINT + TRIGGER', sub: 'Select one unit', icon: 'selectRay', check: () => G.selected.size === 1 },
    { id: 'all', text: 'LEFT STICK CLICK', sub: 'Select everything', icon: 'selectAll', check: () => G.selected.size >= G.unitsAlive() },
    { id: 'command', text: 'RIGHT HAND: STEER THEM', sub: 'Turn the controller', icon: 'mirror', check: () => G.selected.size > 0 && turned > 1.0, hint: selHint },
    { id: 'hold', text: 'POINT AT SPACE + LEFT GRIP', sub: 'Order: hold there', icon: 'orderHold', check: () => G.lastOrder === 'HOLD POSITION', hint: selHint },
    { id: 'guard', text: 'POINT AT A STAR + GRIP', sub: 'Order: guard the star', icon: 'orderGuard', check: () => G.lastOrder === 'GUARD STAR', hint: selHint },
    { id: 'follow', text: 'POINT AT YOUR SHIP + GRIP', sub: 'Order: follow it', icon: 'orderFollow', check: () => G.lastOrder.startsWith('FOLLOW'), hint: selHint },
    { id: 'attack', text: 'POINT AT THE ENEMY + GRIP', sub: 'Order: attack', icon: 'orderAttack', enter: () => G.spawnTut('easy', 3), check: () => G.lastOrder.startsWith('ATTACK'), hint: selHint },
    { id: 'engage', text: 'HOLD RIGHT TRIGGER', sub: 'Selected units engage', icon: 'engage', check: (dt) => held(dt, G.input.fire && G.selected.size > 0) > 1.2, hint: selHint },
    { id: 'flagship', text: 'DESTROY THE FLAGSHIP', sub: 'Capital ships fire on their own', icon: 'capital', enter: () => G.spawnTut('flagship', 1), check: () => t > 1 && G.enemyCount() === 0 },
    { id: 'done', text: 'TRAINING COMPLETE', sub: 'On to the lobby', icon: 'check', next: 'button' },
  ];

  function go(i) {
    idx = i; t = 0; done = false; doneT = 0; acc = 0; turned = 0; lastFwd = null;
    shots0 = G.shots;
    G.lastOrder = '';
    const st = steps[i];
    if (!st) { finish(); return; }
    if (st.stage) G.stage(st.stage);
    if (st.enter) st.enter();
    card.visible = true;
    big.visible = st.next === 'big';
    card.hover = null; big.hover = null;
    draw();
    G.log('tutorial step ' + (i + 1) + ' ' + st.id);
  }
  function finish() {
    card.visible = false; big.visible = false; idx = -1;
    G.finishTutorial();
  }
  function complete() { if (!done) { done = true; doneT = 0.6; G.ping(); } }
  card.onClick = (id) => {
    if (id === 'next') complete();
    else if (id === 'skip') finish();
    else if (id.startsWith('steer:')) G.setSetting('steer', id.slice(6));
  };
  big.onClick = (id) => { if (id === 'continue') complete(); };

  function draw() {
    const st = steps[idx];
    if (!st) return;
    const g = card.g, W = card.W;
    card.begin();
    card.text(`TRAINING ${idx + 1}/${steps.length}`, 28, 46, { size: 22, color: UI.dim });
    card.button('skip', W - 150, 16, 130, 46, 'SKIP', { size: 22 });
    card.text(st.text, W / 2, 122, { size: 44, bold: true, color: UI.title, align: 'center', maxW: W - 48 });
    if (st.sub) card.text(st.sub, W / 2, 166, { size: 26, color: UI.text, align: 'center', maxW: W - 48 });
    const tt = performance.now() / 1000;
    if (st.icons) {
      st.icons.forEach(([k, label], n) => {
        const x = W * (n ? 0.74 : 0.26);
        drawIcon(g, k, x, 340, 200, tt);
        card.text(label, x, 490, { size: 28, bold: true, color: UI.gold, align: 'center', maxW: W / 2 - 30 });
      });
    } else if (st.steerList) {
      const modes = [['mirror', 'MIRROR'], ['relative', 'RELATIVE'], ['point', 'POINT'], ['stick', 'THUMBSTICK']];
      modes.forEach(([k, l], n) => card.button('steer:' + k, 28, 200 + n * 78, 300, 64, l, { active: G.settings.steer === k, size: 28 }));
      drawIcon(g, G.settings.steer, W * 0.72, 340, 220, tt);
    } else if (st.icon) drawIcon(g, done ? 'check' : st.icon, W / 2, 335, 240, tt);
    if (done && (st.icons || st.steerList)) drawIcon(g, 'check', W - 70, 120, 60, tt);
    const hint = st.hint ? st.hint() : '';
    if (hint) card.text(hint, W / 2, 530, { size: 24, color: UI.gold, align: 'center', maxW: W - 40 });
    if (st.next === 'button') card.button('next', W / 2 - 150, 548, 300, 74, idx === steps.length - 1 ? 'LOBBY' : 'NEXT', { big: true, size: 34 });
    card.end();
    if (big.visible) {
      big.begin();
      big.button('continue', 10, 10, big.W - 20, big.H - 20, 'CONTINUE', { big: true, size: 48 });
      big.end();
    }
  }

  function update(dt) {
    const st = steps[idx];
    if (!st) return;
    t += dt;
    // How far the commanded heading has turned (for the steering steps).
    if (lastFwd) turned += lastFwd.angleTo(G.player.fwd);
    lastFwd = (lastFwd || G.player.fwd.clone()).copy(G.player.fwd);
    if (!done && st.check && st.check(dt)) { done = true; doneT = 0; G.ping(); }   // a moment to show the tick
    if (done) { doneT += dt; if (doneT > 1.0) go(idx + 1); }
    redraw -= dt;
    if (redraw <= 0) { redraw = 1 / 15; draw(); }
  }

  return {
    card, big, steps,
    start() { go(0); },
    update,
    stop() { card.visible = false; big.visible = false; idx = -1; },
    get step() { return steps[idx] ? steps[idx].id : null; },
    get index() { return idx; },
    get active() { return idx >= 0; },
    redraw: draw,
  };
}
