// v16 Fleet ship classes, for both sides. A squadron (yours) or an enemy group is all one class.
//   fighter     - the all-rounder (the original ship)
//   interceptor - fast and fragile, rapid fire: shreds fighters and bombers, useless against capital ships
//   bomber      - slow and tough, heavy shots: wrecks capital ships (and breaks shields), weak against small ships
//   shield      - projects a shield bubble that soaks shots aimed at nearby friends; light guns
//   capital     - the big ship: lots of hull, turrets all round
// Damage per hit depends on what is hit: 'small' (fighter, interceptor), 'heavy' (bomber, shield, enemy
// cruiser) or 'cap' (capital ships). A shield bubble loses energy for every shot it soaks (heavy shots
// from bombers drain it 3x, from capital ships 2x).
export const CLASSES = {
  fighter: {
    key: 'fighter', name: 'FIGHTER', short: 'FTR', glyph: 'F', cost: 4, role: 'All-rounder',
    hp: 3, speed: 1.0, turn: 1.0, fire: 0.3, dmg: { small: 1, heavy: 1, cap: 1 },
  },
  interceptor: {
    key: 'interceptor', name: 'INTERCEPTOR', short: 'INT', glyph: 'I', cost: 4, role: 'Fast. Hunts fighters + bombers',
    hp: 2.5, speed: 1.4, turn: 1.35, fire: 0.17, dmg: { small: 1.3, heavy: 1.0, cap: 0.2 }, hunter: true, evade: 0.4,
  },
  bomber: {
    key: 'bomber', name: 'BOMBER', short: 'BMB', glyph: 'B', cost: 5, role: 'Slow. Wrecks capital ships',
    hp: 4, speed: 0.72, turn: 0.8, fire: 0.6, dmg: { small: 0.4, heavy: 1.3, cap: 4 }, heavy: true, drain: 3, capHunter: true,
  },
  shield: {
    key: 'shield', name: 'SHIELD', short: 'SHD', glyph: 'S', cost: 5, role: 'Soaks shots for ships nearby',
    hp: 3.5, speed: 0.95, turn: 0.9, fire: 0.5, dmg: { small: 0.5, heavy: 0.5, cap: 0.5 }, heavy: true,
    shield: { max: 12, regen: 1.5, r: 1.6 },          // energy (hits soaked), per second, radius (x S)
  },
  capital: {
    key: 'capital', name: 'CAPITAL', short: 'CAP', glyph: 'C', cost: 10, role: 'Big, tough, guns all round',
    dmg: { small: 1, heavy: 1.5, cap: 1 }, drain: 2,
  },
  cruiser: { key: 'cruiser', name: 'CRUISER', short: 'CRU', glyph: 'H', dmg: { small: 1, heavy: 1, cap: 1.5 }, heavy: true },
};
export const SQUAD_CLASSES = ['fighter', 'interceptor', 'bomber', 'shield'];
export const DEPLOY_CLASSES = ['fighter', 'interceptor', 'bomber', 'shield', 'capital'];

export function clsOf(k) { return CLASSES[k] || CLASSES.fighter; }
// Damage a shot from class `from` does to a target of category 'small' | 'heavy' | 'cap'.
export function shotDamage(from, cat) { const c = CLASSES[from]; return c && c.dmg ? c.dmg[cat] : 1; }
export function shotDrain(from) { const c = CLASSES[from]; return (c && c.drain) || 1; }

// A small top-down silhouette of a class (nose to the right), for panels, icons and unit tags.
export function drawClassGlyph(g, cls, x, y, s, col, ang = 0) {
  g.save();
  g.translate(x, y); g.rotate(ang);
  g.strokeStyle = col; g.fillStyle = col.startsWith('#') ? col + '44' : col;
  g.lineWidth = Math.max(2, s * 0.07); g.lineJoin = 'round';
  g.beginPath();
  switch (cls) {
    case 'interceptor':
      g.moveTo(s * 0.6, 0); g.lineTo(-s * 0.05, -s * 0.07); g.lineTo(s * 0.12, -s * 0.36); g.lineTo(-s * 0.3, -s * 0.1);
      g.lineTo(-s * 0.45, 0); g.lineTo(-s * 0.3, s * 0.1); g.lineTo(s * 0.12, s * 0.36); g.lineTo(-s * 0.05, s * 0.07); g.closePath();
      break;
    case 'bomber':
      g.moveTo(s * 0.32, 0); g.lineTo(-s * 0.2, -s * 0.5); g.lineTo(-s * 0.32, -s * 0.36); g.lineTo(-s * 0.26, 0);
      g.lineTo(-s * 0.32, s * 0.36); g.lineTo(-s * 0.2, s * 0.5); g.closePath();
      g.fill(); g.stroke();
      g.beginPath(); g.rect(-s * 0.25, -s * 0.3, s * 0.38, s * 0.1); g.rect(-s * 0.25, s * 0.2, s * 0.38, s * 0.1);
      break;
    case 'shield':
      g.moveTo(s * 0.3, 0); g.lineTo(0, -s * 0.18); g.lineTo(-s * 0.24, 0); g.lineTo(0, s * 0.18); g.closePath();
      g.fill(); g.stroke();
      g.beginPath(); g.arc(0, 0, s * 0.42, 0, Math.PI * 2);
      g.stroke();
      g.restore();
      return;
    case 'capital':
      g.moveTo(s * 0.55, 0); g.lineTo(s * 0.3, -s * 0.16); g.lineTo(-s * 0.5, -s * 0.2); g.lineTo(-s * 0.5, s * 0.2); g.lineTo(s * 0.3, s * 0.16); g.closePath();
      g.fill(); g.stroke();
      g.beginPath(); g.rect(-s * 0.2, -s * 0.08, s * 0.24, s * 0.16);
      break;
    default:                                         // fighter: the classic dart
      g.moveTo(s * 0.5, 0); g.lineTo(-s * 0.38, -s * 0.36); g.lineTo(-s * 0.16, 0); g.lineTo(-s * 0.38, s * 0.36); g.closePath();
  }
  g.fill(); g.stroke();
  g.restore();
}
