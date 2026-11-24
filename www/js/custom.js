'use strict';
// Custom tanks made in the TANK CREATOR. A saved tank is a "spec" (name, painted part colours, chosen powers, speed and HP
// dials); customType() turns it into the same kind of entry as the campaign tanks in TANK_TYPES, under the key 'c_<id>'.

// Paintable parts of a tank, in the order the painter lists them. Each is a key on the colour object drawTank reads.
const TANK_PARTS = [
  { k: 'tread', label: 'Treads' }, { k: 'pad', label: 'Track pads' }, { k: 'edge', label: 'Hull edge' }, { k: 'body', label: 'Hull' },
  { k: 'lamp', label: 'Hull lamp' }, { k: 'barrel', label: 'Barrel' }, { k: 'tip', label: 'Muzzle' }, { k: 'ring', label: 'Turret ring' }, { k: 'cap', label: 'Turret top' },
];
// The blank black-and-white tank the painter starts from.
const BLANK_TANK_COLS = { tread: '#1c1c20', pad: '#e8e8e8', edge: '#1c1c20', body: '#f2f2f2', lamp: '#1c1c20', barrel: '#1c1c20', tip: '#f2f2f2', ring: '#1c1c20', cap: '#f2f2f2' };

const POWERS = [
  { id: 'rocket', label: 'Rocket', desc: 'Fires fast rockets that burst on the first wall.' },
  { id: 'bouncy', label: 'Bouncy Rocket', desc: 'Fast rockets that bounce off two walls, like the lime green tank.' },
  { id: 'multi1', label: 'Multi Shot', desc: 'Up to 2 shots in the air at once.' },
  { id: 'multi2', label: 'Multi Shot 2', desc: 'Up to 3 shots in the air at once.' },
  { id: 'multi3', label: 'Multi Shot 3', desc: 'Up to 4 shots in the air at once.' },
  { id: 'multi4', label: 'Multi Shot 4', desc: 'Up to 5 shots in the air at once.' },
  { id: 'multi5', label: 'Multi Shot 5', desc: 'Up to 6 shots in the air at once.' },
  { id: 'flame', label: 'Flame Thrower', desc: 'Throws two-square-wide waves of fire, like the orange tank.' },
  { id: 'homing', label: 'Heat Seeking Rocket', desc: 'A bright orange rocket at bullet speed that follows the player round walls. It can be shot down.' },
  { id: 'frost', label: 'Frost Shot', desc: 'A light blue rocket, faster than a normal one. Where it hits, ice covers 3x3 squares and freezes every tank there for 20 seconds (they can still aim and shoot).' },
  { id: 'laser', label: 'Super Laser', desc: 'A beam for 3 seconds that goes through walls. Slow turret, 6 seconds to charge between shots.' },
  { id: 'mines', label: 'Mines', desc: 'Lays mines, and runs clear of them.' },
  { id: 'suicide', label: 'Suicide', desc: 'No gun. Chases the player down and blows itself up on contact. No other powers except Suicide Dropper.' },
  { id: 'dropper', label: 'Suicide Dropper', desc: 'When it dies it leaves a pool of the liquid you pick, 1x1 up to 5x5 squares.' },
  { id: 'still', label: 'Stand Still', desc: 'Never moves.' },
  { id: 'invis', label: 'Invisibility', desc: 'Only its tracks can be seen. Any liquid it drives through shows it.' },
  { id: 'enchanter', label: 'Enchanter', desc: 'Gives up to 2 nearby tanks a pink 2 HP barrier. It vanishes when the enchanter moves out of range. A broken barrier never comes back from the same enchanter.' },
  { id: 'train', label: 'War Train', desc: 'Pulls up to 5 load tanks behind it. Place the load tanks in a line right behind it.' },
  { id: 'load', label: 'Load Tank', desc: 'No turret, does nothing; pulled by a war train. Shoot one in the middle and the ones behind come loose. Can also have Suicide (wakes 10 s after coming loose), Resistance, immunities, invisibility.' },
  { id: 'resist', label: 'Resistance', desc: "The player's bullets bounce off. Only mines, blasts and its own team's shots can hurt it. It ignores mines completely." },
  { id: 'teleport', label: 'Teleportation', desc: 'Jumps between the purple teleport squares on the map (place 1 to 10 in the level creator), and uses them to escape danger.' },
  { id: 'immLava', label: 'Lava Immunity', desc: 'Drives through lava and acid.' },
  { id: 'immMines', label: 'Mine Immunity', desc: 'Mines and blasts do not hurt it.' },
  { id: 'immFF', label: 'Friendly Fire Immunity', desc: "Its own team's shots pass straight through it." },
];
const POWER = Object.fromEntries(POWERS.map(p => [p.id, p]));
const WEAPON_POWERS = ['rocket', 'bouncy', 'flame', 'homing', 'frost', 'laser'];
const MULTI_POWERS = ['multi1', 'multi2', 'multi3', 'multi4', 'multi5'];
const LOAD_OK = ['load', 'suicide', 'dropper', 'resist', 'immLava', 'immMines', 'immFF', 'invis'];
const DROP_LIQUIDS = ['oil', 'water', 'lava', 'acid', 'tar'];

// Add a power to a list, keeping the rules. Returns { powers, msg } (msg explains anything that was swapped out or refused).
function addPower(list, id) {
  let p = list.filter(x => x !== id), msg = '';
  const has = x => p.includes(x);
  if (has('load') && !LOAD_OK.includes(id)) return { powers: list, msg: 'A load tank can only add Suicide, Suicide Dropper, Resistance, immunities or Invisibility' };
  if (has('suicide') && !has('load') && id !== 'dropper' && id !== 'load') return { powers: list, msg: 'A suicide tank can only add Suicide Dropper' };
  if (WEAPON_POWERS.includes(id) && p.some(x => WEAPON_POWERS.includes(x))) { p = p.filter(x => !WEAPON_POWERS.includes(x)); msg = 'Swapped the old weapon for ' + POWER[id].label; }
  if (MULTI_POWERS.includes(id)) p = p.filter(x => !MULTI_POWERS.includes(x));
  if (id === 'still') p = p.filter(x => x !== 'train');
  if (id === 'train') p = p.filter(x => x !== 'still');
  if (id === 'suicide') {
    const keep = p.includes('load') ? LOAD_OK : ['dropper', 'load'], gone = p.filter(x => !keep.includes(x));
    if (gone.length) { p = p.filter(x => keep.includes(x)); msg = 'Suicide took away the other powers'; }
  }
  if (id === 'load') {
    const gone = p.filter(x => !LOAD_OK.includes(x));
    if (gone.length) { p = p.filter(x => LOAD_OK.includes(x)); msg = 'A load tank cannot keep its other powers'; }
  }
  p.push(id);
  return { powers: p, msg };
}

function customType(spec) {
  const P = new Set(spec.powers || []), sp = Math.max(1, Math.min(120, spec.speed || 50)) / 100;
  const c = Object.assign({}, BLANK_TANK_COLS, spec.col || {});
  const T = { col: Object.assign({ dark: c.edge, light: c.lamp, x: c.body }, c), shells: 1, bounces: 1, speed: 1.0, fire: [1.4, 2.8], aim: 0.12, turn: 2.2,
    move: sp, ricochet: 0.4, range: [3, 7], hp: Math.max(1, Math.min(10, spec.hp || 1)), custom: true, name: spec.name || 'Custom tank' };
  const multi = [1, 2, 3, 4, 5].find(n => P.has('multi' + n));
  if (multi) { T.shells = multi + 1; T.fire = [0.5, 1.0]; }
  if (P.has('rocket')) Object.assign(T, { rocket: true, bounces: 0, speed: 2.0, aim: 0.08, ricochet: 0 });
  if (P.has('bouncy')) Object.assign(T, { rocket: true, bounces: 2, speed: 2.0, aim: 0.04, ricochet: 0.9 });
  if (P.has('flame')) Object.assign(T, { flame: true, bounces: 0, speed: 0.8, fire: [3, 3], ricochet: 0, shells: multi ? multi + 1 : 2 });
  if (P.has('homing')) Object.assign(T, { homing: true, bounces: 3, speed: 1.0, fire: [2.0, 3.5], ricochet: 0 });
  if (P.has('frost')) Object.assign(T, { frost: true, bounces: 0, speed: 2.6, fire: [1.8, 3.2], ricochet: 0, aim: 0.06 });
  if (P.has('laser')) Object.assign(T, { laser: true, shells: 0, turn: 0.6, range: [4, 9] });
  if (P.has('mines')) T.mines = [4, 8];
  if (P.has('still')) T.move = 0;
  if (P.has('invis')) Object.assign(T, { invisible: true, revealAny: true });
  if (P.has('enchanter')) T.enchanter = Math.max(2, Math.min(16, spec.enchantRange || 16));
  if (P.has('train')) T.train = true;
  if (P.has('resist')) T.resist = true;
  if (P.has('teleport')) T.teleport = true;
  if (P.has('immLava')) T.lavaProof = true;
  if (P.has('immMines')) T.mineProof = true;
  if (P.has('immFF')) T.ffProof = true;
  if (P.has('dropper')) T.drop = { liquid: DROP_LIQUIDS.includes(spec.dropLiquid) ? spec.dropLiquid : 'oil', size: Math.max(1, Math.min(5, spec.dropSize || 3)) };
  if (P.has('suicide')) Object.assign(T, { charge: true, noTurret: true, shells: 0, fire: [99, 99], range: [0, 2] });
  if (P.has('load')) Object.assign(T, { load: true, noTurret: true, shells: 0, fire: [99, 99] });
  return T;
}
function registerCustomTank(spec) { TANK_TYPES['c_' + spec.id] = customType(spec); }
function registerCustomTanks() { for (const s of Store.customTanks) registerCustomTank(s); }
registerCustomTanks();

// ---------- MULTIPLAYER (Local and Split Screen) ----------
// A player's battle tank: one of 10 MODELS, painted like a custom tank, its own X mark colour, TWO WEAPONS of the
// player's choice (each on its own fire button) and at most TWO picks from PVP_POWERS. Everyone drives at 100%; the
// lives come from the game rules (BATTLE mode, set by the host).
const TANK_MODELS = [
  { id: 'standard', label: 'STANDARD', desc: 'The classic: two treads, round turret.' },
  { id: 'buggy', label: 'BUGGY', desc: 'Six big tyres and a slim body.' },
  { id: 'goliath', label: 'GOLIATH', desc: 'A huge armoured hull with a box turret.' },
  { id: 'spiker', label: 'SPIKER', desc: 'Spikes all down both sides.' },
  { id: 'twin', label: 'TWIN GUN', desc: 'Sloped hull, two barrels side by side.' },
  { id: 'hover', label: 'HOVER', desc: 'A saucer on a glowing air skirt.' },
  { id: 'stinger', label: 'STINGER', desc: 'An arrowhead hull with tail fins.' },
  { id: 'gatling', label: 'GATLING', desc: 'Striped hull, spinning three-barrel gun.' },
  { id: 'dozer', label: 'DOZER', desc: 'A plough blade up front and smoke stacks.' },
  { id: 'beetle', label: 'BEETLE', desc: 'A spotted shell, pincers and little legs.' },
];
// The weapons a player can carry (any two different ones). shells = how many can be flying at once.
const PVP_WEAPON_LIST = [
  { id: 'shell', label: 'Shell', desc: 'The normal shell: bounces once. Up to 5 flying at once.' },
  { id: 'rocket', label: 'Rocket', desc: 'Fast rockets that burst on the first wall. Up to 2 flying at once.' },
  { id: 'bouncy', label: 'Bouncy Rocket', desc: 'Fast rockets that bounce off two walls. Only 2 flying at once.' },
  { id: 'homing', label: 'Heat Seeking Rocket', desc: 'Bright orange rockets that chase the nearest enemy round the walls. Up to 3 at once. They can be shot down.' },
  { id: 'frost', label: 'Frost Shot', desc: 'Light blue shots: where one hits, 3x3 squares ice over and freeze every tank there for 20 s (they can still aim and shoot). Up to 3 shots or ice spots until they melt.' },
  { id: 'flame', label: 'Flame Thrower', desc: 'Throws a two-square-wide wave of fire. One wave flying at a time.' },
  { id: 'laser', label: 'Super Laser', desc: 'A 3 second beam that goes through walls. The turret turns slowly while it fires, then 6 seconds to charge.' },
];
const PVP_WEAPON = Object.fromEntries(PVP_WEAPON_LIST.map(w => [w.id, w]));
const PVP_WEAPONS = PVP_WEAPON_LIST.map(w => w.id);
const WEAPON_STATS = {
  shell: { shells: 5, bounces: 1, speed: 1.0 },
  rocket: { rocket: true, shells: 2, bounces: 0, speed: 2.0 },
  bouncy: { rocket: true, shells: 2, bounces: 2, speed: 2.0 },          // the user's rule: only 2 bouncy rockets flying at once
  homing: { homing: true, shells: 3, bounces: 3, speed: 1.0 },
  frost: { frost: true, shells: 3, bounces: 0, speed: 2.6 },
  flame: { flame: true, shells: 1, bounces: 0, speed: 0.8 },
  laser: { laser: true, shells: 0, bounces: 0, speed: 1.0 },
};
const DEFAULT_WEAPONS = ['shell', 'rocket'];
const PVP_POWERS = [
  { id: 'mines', label: 'Mines', desc: 'Lay up to 2 mines at once. Only YOUR shots can set off your mines (anyone driving close still does).' },
  { id: 'immLava', label: 'Lava Immunity', desc: 'Drive through lava and acid.' },
  { id: 'immMines', label: 'Mine Immunity', desc: 'Mines and blasts do not hurt you.' },
  { id: 'teleport', label: 'Teleportation', desc: 'Stand on a purple teleport square and press TELEPORT to jump to the next one.' },
  { id: 'invis', label: 'Invisibility', desc: 'Only your tracks show. Liquids show you, and every shot shows you for 3 seconds.' },
  { id: 'speed', label: 'Speed 120%', desc: 'Drive at 120% speed.' },
];
const PVP_POWER = Object.fromEntries(PVP_POWERS.map(p => [p.id, p]));
const PVP_MAX = 2;
// the 10 spawn flags of a Local map, in order: player 1 starts on blue, player 2 on red, ...
const FLAG_COLORS = [['blue', '#2f7df6', 'BLUE'], ['red', '#f03a3a', 'RED'], ['yellow', '#f5d327', 'YELLOW'], ['green', '#3ad15a', 'GREEN'], ['orange', '#ff8a2a', 'ORANGE'],
  ['purple', '#a24ff0', 'PURPLE'], ['lightpink', '#ffb3d9', 'LIGHT PINK'], ['brown', '#8a5a2b', 'BROWN'], ['cyan', '#5fe0f0', 'LIGHT BLUE'], ['magenta', '#e81fd0', 'MAGENTA PINK']];
// TEAMS: blue and red; green and yellow join with 8 players; purple with 10
const TEAM_COLORS = [['blue', '#2f7df6', 'BLUE'], ['red', '#f03a3a', 'RED'], ['green', '#3ad15a', 'GREEN'], ['yellow', '#f5d327', 'YELLOW'], ['purple', '#a24ff0', 'PURPLE']];
// the X mark colours offered on the PREPARE screen (any colour works too)
const X_COLORS = ['#2f7df6', '#f03a3a', '#3ad15a', '#f5d327', '#ff8a2a', '#a24ff0', '#ff6fb5', '#5fe0f0', '#ffffff', '#1c1c20', '#8a5a2b', '#9aa0aa'];

// GAME RULES. mode: 'battle' (lives, last one standing), 'slayer' (first to N kills, optional time limit),
// 'slaughter' (time limit only, most kills wins). teams: 0 = free for all, else 2 / 4 / 5 teams.
const MODES = [
  { id: 'battle', label: 'BATTLE', desc: 'Everyone has lives. Last tank (or team) standing wins.' },
  { id: 'slayer', label: 'SLAYER', desc: 'No lives: respawn forever. First to the kill target wins (most kills if the time runs out).' },
  { id: 'slaughter', label: 'SLAUGHTER', desc: 'Only a time limit. Most kills when the time runs out wins.' },
];
const SLAYER_TIMES = [5, 10, 15, 20, 25, 30, 0];                     // minutes; 0 = no time limit
const DEFAULT_RULES = { mode: 'battle', lives: 3, kills: 25, slayerTime: 10, slaughterTime: 5, teams: 0 };
// how many teams a lobby of n players may use (they must come out even)
function teamOptions(n) { const o = [0]; if (n >= 2 && n % 2 === 0) o.push(2); if (n === 8) o.push(4); if (n === 10) o.push(5); return o; }
function cleanRules(r) {
  r = Object.assign({}, DEFAULT_RULES, r && typeof r === 'object' ? r : {});
  const int = (v, a, b, d) => { v = Math.round(+v); return isFinite(v) ? Math.max(a, Math.min(b, v)) : d; };
  return {
    mode: MODES.some(m => m.id === r.mode) ? r.mode : 'battle',
    lives: int(r.lives, 1, 10, 3),
    kills: Math.round(int(r.kills, 10, 100, 25) / 5) * 5,
    slayerTime: SLAYER_TIMES.includes(+r.slayerTime) ? +r.slayerTime : 10,
    slaughterTime: int(r.slaughterTime, 1, 30, 5),
    teams: [0, 2, 4, 5].includes(+r.teams) ? +r.teams : 0,
  };
}
// the time limit in seconds (0 = none)
function rulesTime(r) { return r.mode === 'slayer' ? r.slayerTime * 60 : r.mode === 'slaughter' ? r.slaughterTime * 60 : 0; }
function rulesText(r) {
  const m = MODES.find(x => x.id === r.mode).label;
  const bits = [m];
  if (r.mode === 'battle') bits.push(`${r.lives} ${r.lives === 1 ? 'LIFE' : 'LIVES'}`);
  if (r.mode === 'slayer') bits.push(`FIRST TO ${r.kills} KILLS`, r.slayerTime ? `${r.slayerTime} MIN` : 'NO TIME LIMIT');
  if (r.mode === 'slaughter') bits.push(`${r.slaughterTime} MIN`);
  bits.push(r.teams ? `${r.teams} TEAMS` : 'FREE FOR ALL');
  return bits.join(' · ');
}

// Add a power pick: never more than 2.
function addPvpPower(list, id) {
  if (!PVP_POWER[id] || list.includes(id)) return { powers: list, msg: '' };
  if (list.length >= PVP_MAX) return { powers: list, msg: 'Only 2 powers - tap a selected power to take it off first' };
  return { powers: list.concat(id), msg: '' };
}
// a player's spec -> what the game needs to know about the tank
function pvpType(spec) {
  const P = (spec.powers || []).filter(id => PVP_POWER[id]).slice(0, PVP_MAX), has = id => P.includes(id);
  let wl = (Array.isArray(spec.weapons) ? spec.weapons : []).filter(id => WEAPON_STATS[id]);
  wl = [...new Set(wl)].slice(0, 2); for (const d of PVP_WEAPONS) if (wl.length < 2 && !wl.includes(d)) wl.push(d);
  // the SECOND FIRE BUTTON: weapon 2 only while no power is picked. With a power it is switched off - unless that power
  // is Mines, then it lays a mine.
  if (P.length) wl = wl.slice(0, 1);
  const slot2 = !P.length ? 'weapon' : has('mines') ? 'mine' : null;
  const model = Math.max(0, Math.min(TANK_MODELS.length - 1, spec.model | 0));
  const T = { col: Object.assign({}, BLANK_TANK_COLS, spec.col || {}), move: has('speed') ? 1.2 : 1.0, lives: 3, turn: 99, model, weapons: wl, slot2,
    wp: wl.map(id => Object.assign({ id, label: PVP_WEAPON[id].label }, WEAPON_STATS[id])) };
  T.col = Object.assign({ dark: T.col.edge, light: T.col.lamp }, T.col, { x: /^#[0-9a-f]{6}$/i.test(spec.xcol || '') ? spec.xcol : T.col.body });
  // drawing hints: a laser makes the barrel longer, a flame thrower gives it a nozzle
  if (wl.includes('laser')) T.laser = true;
  if (wl.includes('flame')) T.flame = true;
  if (wl.includes('homing')) T.homing = true;
  if (has('mines')) T.mines = true;
  if (has('immLava')) T.lavaProof = true;
  if (has('immMines')) T.mineProof = true;
  if (has('teleport')) T.teleport = true;
  if (has('invis')) Object.assign(T, { invisible: true, revealAny: true });
  return T;
}
