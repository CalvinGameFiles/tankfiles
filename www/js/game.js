'use strict';
// TANKFILES core: rooms built from LEVELS, the player's tank, enemy tanks with simple brains, ricochet shells,
// mines, tread tracks, smoke and the X mark where a tank died. Mission intro / clear / game over flow.
const Game = (() => {
  const TILE = 40;
  const FLOOR = 0, SOLID = 1, CRATE = 2, WHITE = 3;   // WHITE: shells fly over it, tanks cannot cross it
  const PLATFORM = 4, RAMP = 5, WATER = 6, LAVA = 7, ACID = 8, TAR = 9, OIL = 10, TELE = 11;   // TELE: purple teleport liquid (level creator)   // factory spills: acid burns like lava, tar halves speed, oil slows the player only
  const LAVA_R = TILE * 0.22;           // a tank whose centre comes this close to a lava square's centre burns                       // silver squares sit a level up: on/off only by a ramp, ground shells stop at their side
  const TANK_R = TILE * 0.40, TANK_SPEED = TILE * 3.2;        // px / s
  const SHELL_SPEED = TILE * 5.0, SHELL_R = 5, MAX_SHELLS = 5, MAX_BOUNCE = 1;
  const MINE_R = 14, MAX_MINES = 2, MINE_FUSE = 10, MINE_ARM = 1.0, MINE_TRIGGER = TILE * 1.3, BLAST_R = TILE * 1.7;
  const MINE_SAFE = BLAST_R + TILE * 0.8;                     // movers never plan a route inside this ring round a mine
  const INTRO_T = 2.0, CLEAR_T = 2.2;
  const FREEZE_T = 20, CAR_GAP = TANK_R * 2 + 5, DIR4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  const LIQ = { water: WATER, lava: LAVA, acid: ACID, tar: TAR, oil: OIL };
  const SPILL_OVER = { [ACID]: [FLOOR, TAR, OIL], [TAR]: [FLOOR, OIL], [OIL]: [FLOOR], [WATER]: [FLOOR, TAR, OIL], [LAVA]: [FLOOR, TAR, OIL, WATER, ACID] };
  const FLAME_OFFS = [-32, -16, 0, 16, 32], FLAME_R = 9;      // a flame wave: five fire cells side by side, about two squares wide

  let canvas, ctx, dpr = 1, view = { scale: 1, ox: 0, oy: 0, cw: 0, ch: 0 };
  let COLS = 13, ROWS = 8, W = COLS * TILE, H = ROWS * TILE;
  let state = 'idle';                 // idle | intro | playing | paused | dead | dead-paused | clear | over | won
  let save = null, level = null, stateT = 0, shake = 0, flashAlpha = 0;
  let map, barrels, tanks, player, shells, mines, tracks, smoke, xmarks, rings, bits;   // barrels: per square 0 none, 1 blue, 2 green (acid), 3 black (tar)
  let touchMode = false;
  let beams = [], ices = [], pads = [], clock = 0, simHit = null;
  let vs = null, shellId = 0, mineId = 0;                // vs: a MULTIPLAYER battle (split screen on this device, or Local over Wi-Fi)
  const ss = [null, null];                               // split screen: the blue (left) and red (right) joysticks
  const lb = { open: false, k: 0 };                      // multiplayer LEADERBOARD: open or not, and how far it has slid out (0-1)
  let customLevel = null, customDone = null, editHover = null, inset = { l: 0, t: 0, r: 0, b: 0 };   // level creator: the level being edited / tested
  const keys = {}, mouse = { x: 0, y: 0, inside: false };
  const sticks = { move: null, aim: null };    // move: a thumb stick {id, ox, oy, x, y, dx, dy, len}; aim: the finger the turret follows {id, ox, oy, x, y, t0, moved}
  // ZOOM CAMERA: Options > Map zoom (0 = the whole map ... 1 = 5 squares tall) zooms in and follows your tank.
  // Not set yet: phones start at 80% (about 6-7 squares tall), PCs on the whole map. The in-game button flips between ALL and your zoom.
  const coarse = !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
  let zoomAll = false;                         // the in-game button: show the whole map for now
  const MAX_ZOOM_ROWS = 5;                     // fully zoomed in, the screen is this many squares tall
  const zoomPref = () => { const z = Store.opts.zoom; return typeof z === 'number' ? Math.max(0, Math.min(1, z)) : coarse ? 0.8 : 0; };
  const zoomAmt = () => zoomAll ? 0 : zoomPref();
  let onPause = () => {}, onLeave = () => {};

  // ---------- rooms ----------
  // Drawn maps: rows of characters (# stone, W wood, w white, . floor, P player, letters = tank types) become walls + spawns.
  const GRID_TANKS = { D: 'darkbrown', B: 'brown', C: 'cyan', Y: 'yellow', R: 'red', G: 'green', U: 'purple', H: 'white', K: 'black', T: 'silver', O: 'bomber', F: 'orange', N: 'pine' };
  function fromGrid(L) {
    if (!L.grid || L._parsed) return L;
    const rows = L.grid, out = Object.assign({}, L, { cols: rows[0].length, rows: rows.length, walls: [], enemies: [], _parsed: true });
    const at = (c, r) => (rows[r] || '')[c] || '#';
    const wet = (c, r) => [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dc, dr]) => at(c + dc, r + dr) === '~').length >= 3;   // a tank letter out in the sea
    rows.forEach((row, r) => [...row].forEach((ch, c) => {
      if (r === 0 || c === 0 || r === rows.length - 1 || c === row.length - 1) return;      // the border is drawn by buildLevel
      if (ch === '#') out.walls.push(['solid', c, r, 1, 1]);
      else if (ch === 'W') out.walls.push(['wood', c, r, 1, 1]);
      else if (ch === 'w') out.walls.push(['white', c, r, 1, 1]);
      else if (ch === 'S') out.walls.push(['silver', c, r, 1, 1]);
      else if (ch === '/') out.walls.push(['ramp', c, r, 1, 1]);
      else if (ch === '~') out.walls.push(['water', c, r, 1, 1]);
      else if (ch === 'L') out.walls.push(['lava', c, r, 1, 1]);
      else if (ch === 'P' || ch === 'p') { out.player = [c + 0.5, r + 0.5]; if (ch === 'p') out.walls.push(['silver', c, r, 1, 1]); else if (wet(c, r)) out.walls.push(['water', c, r, 1, 1]); }
      else if (GRID_TANKS[ch.toUpperCase()]) {                                             // lowercase = standing on a platform
        out.enemies.push([GRID_TANKS[ch.toUpperCase()], c + 0.5, r + 0.5]);
        if (ch !== ch.toUpperCase()) out.walls.push(['silver', c, r, 1, 1]);
        else if (wet(c, r)) out.walls.push(['water', c, r, 1, 1]);
      }
    }));
    return out;
  }
  function buildLevel(L) {
    COLS = L.cols; ROWS = L.rows; W = COLS * TILE; H = ROWS * TILE;
    if (L.tiles) {                                                           // a level creator map: one tile number per square
      const m = Uint8Array.from(L.tiles);
      for (let c = 0; c < COLS; c++) { m[c] = SOLID; m[(ROWS - 1) * COLS + c] = SOLID; }
      for (let r = 0; r < ROWS; r++) { m[r * COLS] = SOLID; m[r * COLS + COLS - 1] = SOLID; }
      return m;
    }
    const m = new Uint8Array(COLS * ROWS);
    for (let c = 0; c < COLS; c++) { m[c] = SOLID; m[(ROWS - 1) * COLS + c] = SOLID; }
    for (let r = 0; r < ROWS; r++) { m[r * COLS] = SOLID; m[r * COLS + COLS - 1] = SOLID; }
    for (const [type, c, r, w, h] of L.walls || []) {
      const v = type === 'wood' ? CRATE : type === 'white' ? WHITE : type === 'silver' ? PLATFORM : type === 'ramp' ? RAMP : type === 'water' ? WATER : type === 'lava' ? LAVA : SOLID;
      for (let y = r; y < r + (h || 1); y++) for (let x = c; x < c + (w || 1); x++) if (x >= 0 && y >= 0 && x < COLS && y < ROWS) m[y * COLS + x] = v;
    }
    return m;
  }
  const tileAt = (c, r) => (c < 0 || r < 0 || c >= COLS || r >= ROWS) ? SOLID : map[r * COLS + c];
  // Heights: 0 = ground, 1 = up on a platform, 2 = on a ramp (either level within reach). A tank's h follows the square under it.
  const hAt = (x, y) => { const v = tileAt(Math.floor(x / TILE), Math.floor(y / TILE)); return v === PLATFORM ? 1 : v === RAMP ? 2 : 0; };
  const liftAt = (x, y) => { const v = tileAt(Math.floor(x / TILE), Math.floor(y / TILE)); return (v === PLATFORM || v === RAMP) ? 1 : 0; };   // a shell's height after crossing this square
  const ground = v => v === FLOOR || v === WATER || v === LAVA || v === ACID || v === TAR || v === OIL || v === TELE;   // all ground level: water/tar/oil slow, lava/acid deadly
  const HOT = v => v === LAVA || v === ACID;                                     // the middle of these squares burns a tank
  const onLava = (x, y) => HOT(tileAt(Math.floor(x / TILE), Math.floor(y / TILE)));
  const TOf = t => t.ai ? t.ai.T : (t.pw || null);          // what a tank can do: an enemy's type, or a multiplayer tank's powers
  const lavaProof = t => !!(TOf(t) && TOf(t).lavaProof);
  const walkable = v => ground(v) || v === PLATFORM || v === RAMP;
  const canStep = (a, b) => walkable(b) && !((ground(a) && b === PLATFORM) || (a === PLATFORM && ground(b)));   // between neighbouring squares
  const blocked = (c, r, h) => { const v = tileAt(c, r); return ground(v) ? h === 1 : v === PLATFORM ? h === 0 : v !== RAMP; };   // for a tank at height h
  const inWater = (x, y) => tileAt(Math.floor(x / TILE), Math.floor(y / TILE)) === WATER;
  // drive speed factor for the square a tank is on: 30% slower in water, half speed in tar, the player 40% slower in oil (enemies not at all)
  const slowAt = t => { const v = tileAt(Math.floor(t.x / TILE), Math.floor(t.y / TILE)); return v === WATER ? 0.7 : v === TAR ? 0.5 : (v === OIL && (t === player || t.pw)) ? 0.6 : 1; };
  const LIQUID = v => v === WATER || v === LAVA || v === ACID || v === TAR || v === OIL || v === TELE;
  const inLiquid = (x, y) => LIQUID(tileAt(Math.floor(x / TILE), Math.floor(y / TILE)));
  // the white tank shows only while wading; a custom invisible tank shows in any liquid
  const tankVisible = t => { const T = TOf(t); return !(T && T.invisible) || t.revealT > 0 || (T.revealAny ? inLiquid(t.x, t.y) : inWater(t.x, t.y)); };   // revealT: a multiplayer tank just fired
  const charger = T => !!(T.oil || T.charge);                   // rams the player and blows up (oil bomber, custom suicide)
  const ignoresMines = T => !!(T.resist || T.mineProof);         // no mine safety logic at all
  const blocksShell = (c, r, h) => { const v = tileAt(c, r); return v === SOLID || v === CRATE || (v === PLATFORM && h === 0); };   // shells cross white; a ground shell stops at a platform's side

  function circleHitsWall(x, y, rad, forShell, h) {
    const c0 = Math.floor((x - rad) / TILE), c1 = Math.floor((x + rad) / TILE), r0 = Math.floor((y - rad) / TILE), r1 = Math.floor((y + rad) / TILE);
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
      if (!(forShell ? blocksShell(c, r, h) : blocked(c, r, h))) continue;
      const nx = Math.max(c * TILE, Math.min(x, c * TILE + TILE)), ny = Math.max(r * TILE, Math.min(y, r * TILE + TILE));
      if ((x - nx) ** 2 + (y - ny) ** 2 < rad * rad) return true;
    }
    return false;
  }

  // ---------- setup ----------
  function playerColor() { return PLAYER_COLORS[Store.opts.color] || PLAYER_COLORS.blue; }
  function makeTank(x, y, col, type) {
    return { x, y, r: TANK_R, h: 0, hull: 0, turret: 0, col, type, alive: true, moving: false,
      trackDist: 0, recoil: 0, shells: 0, mines: 0, fireCD: 0, maxShells: MAX_SHELLS, bounces: MAX_BOUNCE, shellSpeed: 1, hp: 1, maxHp: 1 };
  }
  function makeEnemy(kind, x, y) {
    const T = TANK_TYPES[kind] || TANK_TYPES.brown;
    const t = makeTank(x, y, T.col, kind);
    t.maxShells = T.shells; t.bounces = T.bounces; t.shellSpeed = T.speed; t.hull = Math.PI; t.turret = Math.PI;
    t.ai = { T, fireT: T.fire[0] + Math.random() * (T.fire[1] - T.fire[0]), want: null, pick: null, path: [], planT: 0, stuck: 0, mode: '',
      mineT: T.mines ? T.mines[0] + Math.random() * (T.mines[1] - T.mines[0]) : 0 };
    t.hp = t.maxHp = T.hp || 1;
    if (T.laser) t.ai.charge = 2.5 + Math.random() * 2;
    if (T.load) t.freeT = 10;
    return t;
  }
  // editMode: the level creator's view (no game running; barrels keep the same colours between redraws)
  function loadLevel(editMode) {
    if (customLevel) level = fromGrid(customLevel);
    else { if (!(save.level >= 1)) save.level = 1; level = fromGrid(LEVELS[Math.min(save.level, LEVELS.length) - 1]); }
    map = buildLevel(level);
    barrels = new Uint8Array(COLS * ROWS);                                   // factory crates are barrels: 60% blue, 20% green (acid), 20% black (tar)
    fillBarrels(editMode);
    pads = []; for (let i = 0; i < map.length; i++) if (map[i] === TELE) pads.push(i);
    const ps = level.player || [-5, -5];
    player = makeTank(ps[0] * TILE, ps[1] * TILE, playerColor(), 'player');
    if (!level.player) player.alive = false;
    tanks = [player];
    for (const [kind, c, r] of level.enemies || []) tanks.push(makeEnemy(kind, c * TILE, r * TILE));
    for (const t of tanks) t.h = hAt(t.x, t.y);
    linkTrains();
    shells = []; mines = []; tracks = []; smoke = []; xmarks = []; rings = []; bits = []; beams = []; ices = []; homeCache.clear();
    shake = 0; flashAlpha = 0; stateT = 0;
    if (level.floor === 'battle' && !customLevel) seedMines();
    resize();
  }
  // factory crates are barrels: 60% blue, 20% green (acid), 20% black (tar). fixed = the same colours every time (editor, multiplayer)
  function fillBarrels(fixed) {
    barrels = new Uint8Array(COLS * ROWS);
    if (level.floor === 'factory') for (let i = 0; i < map.length; i++) if (map[i] === CRATE) { const k = fixed ? ((i * 2654435761) >>> 0) % 1000 / 1000 : Math.random(); barrels[i] = k < 0.6 ? 1 : k < 0.8 ? 2 : 3; }
  }
  // War trains: each train grabs up to 5 load tanks, the nearest one within 2.6 squares of the last link each time, so
  // load tanks are placed in a line behind it. The cars ride the train's trail (a list of points it drove through).
  function linkTrains() {
    const loads = tanks.filter(t => t.ai && t.ai.T.load);
    for (const t of loads) { t.train = null; t.freeT = 10; }
    for (const e of tanks) {
      if (!e.ai || !e.ai.T.train) continue;
      e.cars = []; e.trail = [{ x: e.x, y: e.y }];
      let last = e;
      while (e.cars.length < 5) {
        let best = null, bd = TILE * 2.6;
        for (const c of loads) { const d = Math.hypot(c.x - last.x, c.y - last.y); if (!c.train && d < bd) { bd = d; best = c; } }
        if (!best) break;
        best.train = e; e.cars.push(best); e.trail.push({ x: best.x, y: best.y }); last = best;
      }
      let arc = 0;
      e.cars.forEach((c, i) => { arc += Math.hypot(e.trail[i + 1].x - e.trail[i].x, e.trail[i + 1].y - e.trail[i].y); c.arc = arc; });
    }
  }
  // Battlefield: 1-6 grey landmines on random open squares each time the mission loads. No timer: they wait until a tank
  // comes near or something shoots them. Never within 4 squares of a tank or each other, never cutting a mover off from the player.
  function seedMines(n) {
    const want = n || 1 + Math.floor(Math.random() * 6), movers = tanks.filter(t => t.ai && t.ai.T.move > 0);
    const pi = tileC(player.y) * COLS + tileC(player.x), reach = t => bfs(tileC(t.x), tileC(t.y)).dist[pi] >= 0, base = movers.map(reach);
    for (let tries = 0; tries < 500 && mines.length < want; tries++) {
      const c = 1 + Math.floor(Math.random() * (COLS - 2)), r = 1 + Math.floor(Math.random() * (ROWS - 2));
      if (tileAt(c, r) !== FLOOR) continue;
      const x = center(c), y = center(r);
      if (tanks.some(t => Math.hypot(t.x - x, t.y - y) < TILE * 4) || mines.some(m => Math.hypot(m.x - x, m.y - y) < TILE * 4)) continue;
      mines.push({ x, y, t: MINE_ARM + 1, owner: null, boomAt: Infinity, lit: false, gray: true });
      if (movers.some((t, i) => base[i] && !reach(t))) mines.pop();
    }
  }
  const enemiesLeft = () => tanks.filter(t => t !== player && t.alive).length;

  // ---------- actions ----------
  function fire(t, slot) {
    if (t.pw && t.pw.wp) return firePvp(t, slot | 0);
    const TT = TOf(t);
    if (!t.alive || t.fireCD > 0) return false;
    if (TT && TT.laser && !t.ai) return fireLaser(t);
    if (t.shells >= t.maxShells) return false;
    if (TT && TT.flame) { if (!t.ai && shells.some(s => s.flame && s.owner === t && !s.dead)) return false; return fireWave(t); }   // multiplayer: one wave in the air at a time
    if (TT && TT.frost && !t.ai && t.shells + ices.filter(i => i.spot && i.owner === t).length >= 3) return false;   // multiplayer: 3 frost shots or ice spots until they melt
    const a = t.turret, bx = t.x + Math.cos(a) * (t.r + 10), by = t.y + Math.sin(a) * (t.r + 10);
    const h0 = t.h === 2 ? liftAt(bx, by) : t.h;
    if (circleHitsWall(bx, by, SHELL_R, true, h0)) {                        // muzzle is against a wall: the shell pops right there
      t.recoil = 1; t.fireCD = 0.12; smoke.push(puff(bx, by, 8, 0.4, 'rgba(230,230,240,')); Sfx.hit(); return false;
    }
    const sp = SHELL_SPEED * t.shellSpeed;
    shells.push({ id: ++shellId, x: bx, y: by, h: h0, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, bounces: 0, maxB: t.bounces, owner: t, age: 0, rocket: !!(TT && TT.rocket),
      homing: !!(TT && TT.homing), frost: !!(TT && TT.frost), life: 10, target: vs && TT && TT.homing ? pickTarget(t, t.x, t.y) : null });
    t.shells++; t.recoil = 1; t.fireCD = 0.12; if (vs) t.revealT = 3;
    smoke.push(puff(bx, by, 6, 0.35, 'rgba(255,230,160,'));
    Sfx.fire();
    return true;
  }
  // a multiplayer tank fires weapon 1 (slot 0) or weapon 2 (slot 1); each weapon keeps its own count of shots in the air (t.out)
  function firePvp(t, slot) {
    const W = t.pw.wp[slot];
    if (!W || !t.alive || t.fireCD > 0) return false;
    if (W.laser) return fireLaser(t);
    if (!t.out) t.out = [0, 0];
    if (W.flame) { if (shells.some(s => s.flame && s.owner === t && s.slot === slot && !s.dead)) return false; return fireWave(t, SHELL_SPEED * W.speed, slot); }
    if (t.out[slot] >= W.shells) return false;
    if (!t.wcd) t.wcd = [0, 0];
    if (t.wcd[slot] > 0) return false;
    if (W.frost && t.out[slot] + ices.filter(i => i.spot && i.owner === t).length >= 3) return false;
    const a = t.turret, bx = t.x + Math.cos(a) * (t.r + 10), by = t.y + Math.sin(a) * (t.r + 10);
    const h0 = t.h === 2 ? liftAt(bx, by) : t.h;
    if (circleHitsWall(bx, by, SHELL_R, true, h0)) { t.recoil = 1; t.fireCD = 0.12; smoke.push(puff(bx, by, 8, 0.4, 'rgba(230,230,240,')); Sfx.hit(); return false; }
    const sp = SHELL_SPEED * W.speed;
    shells.push({ id: ++shellId, x: bx, y: by, h: h0, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, bounces: 0, maxB: W.bounces, owner: t, age: 0, rocket: !!W.rocket,
      homing: !!W.homing, frost: !!W.frost, life: 10, slot, target: W.homing ? pickTarget(t, t.x, t.y) : null });
    t.out[slot]++; t.shells++; t.recoil = 1; t.fireCD = 0.12; t.revealT = 3;
    if (W.homing) { t.seekN = (t.seekN || 0) + 1; if (t.seekN >= W.shells) { t.seekN = 0; t.wcd[slot] = SEEK_RELOAD; } }   // all 3 fired: 4 s to reload
    smoke.push(puff(bx, by, 6, 0.35, 'rgba(255,230,160,'));
    Sfx.fire();
    return true;
  }
  const SEEK_RELOAD = 4;
  // a shell is gone: its owner may fire another (multiplayer tanks count per weapon)
  function shellGone(s) {
    const o = s.owner; if (!o) return;
    o.shells = Math.max(0, o.shells - 1);
    if (o.out && s.slot != null) o.out[s.slot] = Math.max(0, o.out[s.slot] - 1);
  }
  // team mates (multiplayer TEAMS): their shots, blasts and mines never hurt each other
  const sameTeam = (a, b) => !!(vs && vs.teams && a && b && a !== b && a.P && b.P && a.P.team === b.P.team);
  // The orange tank's flame wave: five fire cells abreast (about two squares wide) flying straight; each cell dies on the
  // first wall it meets, so a wave pours through gaps and round corners in pieces. A shell that hits a cell takes that cell out with it.
  function fireWave(t, sp0, slot) {
    const a = t.turret, sp = sp0 || SHELL_SPEED * t.shellSpeed, bx = t.x + Math.cos(a) * (t.r + 10), by = t.y + Math.sin(a) * (t.r + 10);
    let n = 0;
    for (const off of FLAME_OFFS) {
      const x = bx - Math.sin(a) * off, y = by + Math.cos(a) * off, h0 = t.h === 2 ? liftAt(x, y) : t.h;
      if (circleHitsWall(x, y, SHELL_R, true, h0)) continue;
      shells.push({ id: ++shellId, x, y, h: h0, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, bounces: 0, maxB: 0, owner: t, age: 0, rocket: false, flame: true, r: FLAME_R, seed: Math.random() * 9, slot });
      n++;
    }
    t.recoil = 1; t.fireCD = 0.12; if (vs) t.revealT = 3;
    for (let i = 0; i < 5; i++) smoke.push(puff(bx, by, 7, 0.35, 'rgba(255,170,60,'));
    Sfx.fire();
    return n > 0;
  }
  // a multiplayer Super Laser: 3 s beam, then 6 s to charge (the countdown runs in update)
  // It warns first (LASER_WARN s, the turret held still and a red sight line showing) so whoever is in the way can get out.
  const LASER_WARN = 0.7;
  function fireLaser(t) {
    if (t.beamT > 0 || t.warnT > 0 || t.charge > 0) return false;
    t.warnT = LASER_WARN; t.revealT = 3;
    return true;
  }
  function startBeam(t) { t.beamT = 3; t.beamHits = new Map(); t.recoil = 1; t.revealT = 3; Sfx.laser(); }
  // how fast a laser's turret may sweep: slower than a tank can drive across it at that distance, so you can always outrun the beam
  const beamSweep = (dist, cap) => Math.min(cap, 0.55 * TANK_SPEED / Math.max(TILE, dist));
  // the nearest other tank: what a multiplayer heat seeker chases (a tank still in its spawn shield only if nobody else is about)
  function pickTarget(owner, x, y) {
    let best = null, bd = Infinity;
    for (const o of tanks) { if (o === owner || !o.alive || sameTeam(o, owner)) continue; const d = Math.hypot(o.x - x, o.y - y) + (o.spawnT > 0 ? 5000 : 0); if (d < bd) { bd = d; best = o; } }
    return best;
  }
  function layMine(t) {
    if (!t.alive || t.mines >= MAX_MINES) return false;
    if (vs && !(t.pw && t.pw.mines)) return false;                          // multiplayer: mines are a power
    mines.push({ id: ++mineId, x: t.x, y: t.y, t: 0, owner: t, boomAt: MINE_FUSE, lit: false });
    t.mines++; Sfx.mine();
    return true;
  }
  function puff(x, y, r, life, rgba) {
    return { x, y, vx: (Math.random() - 0.5) * 30, vy: (Math.random() - 0.5) * 30 - 10, r, age: 0, life, rgba: rgba || 'rgba(120,120,130,' };
  }
  // wet = the mine sat in water: the blast still breaks wood and pops shells but hurts no tank (TNT in water)
  function explode(x, y, rad, wet, by) {
    emit('boom', x, y, rad, wet ? 1 : 0);
    const c0 = Math.floor((x - rad) / TILE), c1 = Math.floor((x + rad) / TILE), r0 = Math.floor((y - rad) / TILE), r1 = Math.floor((y + rad) / TILE);
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
      if (tileAt(c, r) !== CRATE) continue;
      const cx = c * TILE + TILE / 2, cy = r * TILE + TILE / 2;
      if ((cx - x) ** 2 + (cy - y) ** 2 <= (rad + TILE * 0.4) ** 2) breakCrate(c, r);
    }
    shells = shells.filter(s => { const hit = (s.x - x) ** 2 + (s.y - y) ** 2 <= rad * rad; if (hit && !s.flame) shellGone(s); return !hit; });
    for (const m of mines) if (!m.lit && (m.x - x) ** 2 + (m.y - y) ** 2 <= rad * rad) { m.lit = true; m.boomAt = Math.min(m.boomAt, m.t + 0.12); }
    if (!wet) for (const t of tanks) if (t.alive && (t.x - x) ** 2 + (t.y - y) ** 2 <= (rad + t.r * 0.6) ** 2) hitTank(t, { owner: by || null, kind: 'blast' });
  }
  function breakCrate(c, r) {
    map[r * COLS + c] = FLOOR;
    const kind = barrels[r * COLS + c]; barrels[r * COLS + c] = 0;
    if (kind === 2) spill(c, r, 1, ACID); else if (kind === 3) spill(c, r, 1, TAR);   // a green barrel floods the 3x3 round it with acid, a black one with tar
    emit('crate', c, r, kind === 2 ? '#2f8f2a' : kind === 3 ? '#1c1c20' : kind === 1 ? '#2f63c8' : level.floor === 'grave' ? '#8a8d96' : '#b07a3a');
  }
  // ---------- effects ----------
  // Everything you SEE when something happens (smoke, sparks, sounds). In a Local game the host runs the battle and sends
  // these to the other phones as events, so every screen shows the same explosions.
  const FX = {
    boom(x, y, rad, wet) {
      rings.push({ x, y, age: 0, life: 0.45, r: rad });
      for (let i = 0; i < 26; i++) {
        const p = puff(x, y, 8 + Math.random() * 14, 0.9 + Math.random() * 0.7, i < 8 ? (wet ? 'rgba(210,235,255,' : 'rgba(255,170,60,') : (wet ? 'rgba(110,165,220,' : 'rgba(90,90,100,'));
        const a = Math.random() * Math.PI * 2, s = 40 + Math.random() * 140;
        p.vx = Math.cos(a) * s; p.vy = Math.sin(a) * s; smoke.push(p);
      }
      if (Store.opts.shake) shake = Math.max(shake, 9);
      flashAlpha = 0.35;
      Sfx.boom();
    },
    death(x, y, color) {
      for (let i = 0; i < 34; i++) {
        const p = puff(x, y, 10 + Math.random() * 16, 1.2 + Math.random() * 0.9, i < 10 ? 'rgba(255,150,50,' : 'rgba(70,70,80,');
        const a = Math.random() * Math.PI * 2, s = 20 + Math.random() * 120;
        p.vx = Math.cos(a) * s; p.vy = Math.sin(a) * s - 20; smoke.push(p);
      }
      rings.push({ x, y, age: 0, life: 0.5, r: TANK_R * 2.6 });
      if (Store.opts.shake) shake = Math.max(shake, 12);
      flashAlpha = 0.45;
      Sfx.boom();
      xmarks.push({ x, y, color, alpha: 0, delay: 1.3 });   // the X appears once the smoke has cleared
    },
    lava(x, y, acid) { for (let i = 0; i < 14; i++) { const p = puff(x, y, 8 + Math.random() * 10, 0.8, i < 8 ? (acid ? 'rgba(110,230,40,' : 'rgba(255,120,20,') : (acid ? 'rgba(220,255,140,' : 'rgba(255,220,90,')); p.vy -= 40; smoke.push(p); } },
    crate(c, r, col) {
      const cx = c * TILE + TILE / 2, cy = r * TILE + TILE / 2;
      for (let i = 0; i < 10; i++) {
        const a = Math.random() * Math.PI * 2, s = 60 + Math.random() * 120;
        bits.push({ x: cx, y: cy, vx: Math.cos(a) * s, vy: Math.sin(a) * s, rot: Math.random() * 6, vr: (Math.random() - 0.5) * 14, age: 0, life: 0.8 + Math.random() * 0.5, w: 6 + Math.random() * 8, h: 3 + Math.random() * 4, col });
      }
      Sfx.crate();
    },
    hurt(x, y) { for (let i = 0; i < 6; i++) smoke.push(puff(x, y, 6, 0.4, 'rgba(255,230,180,')); Sfx.hit(); },
    // ice 3x3 round (c0, r0). In multiplayer it takes the whole 20 s to melt, and its middle square is a "spot" that counts against its owner's 3 frost shots
    freeze(c0, r0, oi) {
      const owner = vs && oi >= 0 && vs.players[oi] ? vs.players[oi].tank : null, life = vs ? FREEZE_T : 1.8;
      for (let r = r0 - 1; r <= r0 + 1; r++) for (let c = c0 - 1; c <= c0 + 1; c++) if (c >= 0 && r >= 0 && c < COLS && r < ROWS) ices.push({ c, r, age: 0, life, spot: c === c0 && r === r0, owner });
      for (let i = 0; i < 16; i++) { const p = puff(center(c0), center(r0), 8 + Math.random() * 8, 0.8, i % 2 ? 'rgba(200,240,255,' : 'rgba(140,210,255,'); p.vx *= 2.5; p.vy *= 2.5; smoke.push(p); }
      Sfx.freeze();
    },
    tele(x1, y1, x2, y2) { for (let i = 0; i < 12; i++) { smoke.push(puff(x1, y1, 7, 0.5, 'rgba(190,120,255,')); smoke.push(puff(x2, y2, 7, 0.5, 'rgba(230,190,255,')); } Sfx.tele(); },
    spawn(x, y) { rings.push({ x, y, age: 0, life: 0.5, r: TANK_R * 2 }); for (let i = 0; i < 10; i++) smoke.push(puff(x, y, 7, 0.5, 'rgba(255,255,255,')); },
  };
  function emit(name, ...a) {
    FX[name](...a);
    if (vs && vs.role === 'host') vs.events.push([name, ...a.map(v => typeof v === 'number' ? Math.round(v * 10) / 10 : v)]);
  }
  // A spill covers the squares within rad of (c, r): acid takes any open ground, tar anything but acid, oil only bare floor. Walls and barrels stay.
  function spill(c0, r0, rad, v) {
    const over = SPILL_OVER[v] || [FLOOR];
    for (let r = r0 - rad; r <= r0 + rad; r++) for (let c = c0 - rad; c <= c0 + rad; c++)
      if (c > 0 && r > 0 && c < COLS - 1 && r < ROWS - 1 && over.includes(tileAt(c, r))) map[r * COLS + c] = v;
  }
  // a size x size pool (1x1 up to 5x5) centred on (c0, r0); even sizes reach one square further right and down
  function spillBox(c0, r0, size, v) {
    const a = Math.floor((size - 1) / 2), over = SPILL_OVER[v] || [FLOOR];
    for (let r = r0 - a; r < r0 - a + size; r++) for (let c = c0 - a; c < c0 - a + size; c++)
      if (c > 0 && r > 0 && c < COLS - 1 && r < ROWS - 1 && over.includes(tileAt(c, r))) map[r * COLS + c] = v;
  }
  // Something hits a tank: a shell / rocket / flame / laser (kind) or a blast. Checks resistance, immunities, the pink
  // barrier and hit points. Returns false when it passes straight through, else what happened ('resist', 'shield', 'hurt', 'dead').
  function hitTank(t, src) {
    if (!t.alive) return false;
    const T = TOf(t), by = src.owner, enemyFire = !!(by && by.ai);
    if (t.spawnT > 0) return false;                                          // multiplayer: just respawned, shots pass through for 2 s
    if (sameTeam(t, by)) return false;                                       // multiplayer teams: no friendly fire
    if (T) {
      if (src.kind === 'blast' && T.mineProof) return false;
      if (enemyFire && by !== t && T.ffProof) return false;
      if (T.resist && src.kind !== 'blast' && !enemyFire) { smoke.push(puff(t.x, t.y, 6, 0.3, 'rgba(255,255,255,')); Sfx.ping(); return 'resist'; }
    }
    if (t.shield) {
      const sh = t.shield, e = sh.by; sh.hp--;
      rings.push({ x: t.x, y: t.y, age: 0, life: 0.35, r: t.r + 12 }); Sfx.shield();
      if (e.ench) e.ench.hp.set(t, sh.hp);
      if (sh.hp <= 0) {                                                     // broken for good: this enchanter can never give it back
        t.shield = null; if (e.ench) { e.ench.broken.add(t); e.ench.given.delete(t); }
        for (let i = 0; i < 10; i++) smoke.push(puff(t.x, t.y, 6, 0.5, 'rgba(255,120,210,'));
      }
      return 'shield';
    }
    t.hp = (t.hp || 1) - 1;
    if (t.hp > 0) { t.hurtT = 0.35; emit('hurt', t.x, t.y); return 'hurt'; }
    killTank(t, by); return 'dead';
  }
  function killTank(t, by) {
    if (!t.alive) return;
    t.alive = false;
    emit('death', t.x, t.y, t.col.x);
    const T = t.ai && t.ai.T;
    const drop = T && (T.drop || (T.oil ? { liquid: 'oil', size: 5 } : null));   // an oil bomber bursts into a 5x5 slick; a custom dropper into its own pool
    if (drop) spillBox(tileC(t.x), tileC(t.y), drop.size, LIQ[drop.liquid] || OIL);
    if (t.train) cutTrain(t);
    if (t.cars) { for (const c of t.cars) { c.train = null; c.freeT = 10; c.moving = false; } t.cars = []; }
    t.beamT = 0; t.warnT = 0; t.shield = null;
    if (vs) { vsKilled(t, by); return; }
    if (t === player) {
      save.deaths++; save.lives--;
      if (state === 'playing') { state = save.lives > 0 ? 'dead' : 'over'; stateT = 0; }
    } else {
      save.kills++;
      if (state === 'playing' && enemiesLeft() === 0) { state = 'clear'; stateT = 0; }
    }
  }
  // a load tank is destroyed: the cars behind it come loose and stop where they are
  function cutTrain(car) {
    const e = car.train; car.train = null;
    if (!e || !e.cars) return;
    const i = e.cars.indexOf(car);
    if (i < 0) return;
    for (const c of e.cars.slice(i + 1)) { c.train = null; c.freeT = 10; c.moving = false; }
    e.cars = e.cars.slice(0, i);
  }
  // the ice of a frost shot: 3x3 squares round where it hit; every tank in there is frozen in place
  function freezeAt(x, y, owner) {
    const c0 = tileC(x), r0 = tileC(y);
    emit('freeze', c0, r0, owner && owner.P ? owner.P.idx : -1);
    for (const t of tanks) if (t.alive && Math.abs(tileC(t.x) - c0) <= 1 && Math.abs(tileC(t.y) - r0) <= 1) { t.frozen = FREEZE_T; t.moving = false; }
  }
  function teleport(t, c, r) {
    const x = center(c), y = center(r), A = t.ai || t;
    if ((A.teleCD || 0) > 0 || hitsTank(t, x, y)) return false;
    emit('tele', t.x, t.y, x, y);
    t.x = x; t.y = y; t.h = hAt(x, y); t.lastTrack = null; A.teleCD = 1.0; t.warp = (t.warp || 0) + 1;
    return true;
  }
  // Enchanters: each one keeps a pink 2 HP barrier on up to 2 other tanks within range. Out of range (or the enchanter
  // dead) and the barrier goes; back in range it returns with whatever HP it had. Once broken it never comes back from that enchanter.
  function updateEnchanters() {
    for (const e of tanks) {
      const T = e.ai && e.ai.T; if (!T || !T.enchanter) continue;
      const E = e.ench || (e.ench = { given: new Set(), broken: new Set(), hp: new Map() }), range = T.enchanter * TILE;
      for (const o of [...E.given]) if (!e.alive || !o.alive || Math.hypot(o.x - e.x, o.y - e.y) > range) { if (o.shield && o.shield.by === e) o.shield = null; E.given.delete(o); }
      if (!e.alive) continue;
      while (E.given.size < 2) {
        let best = null, bd = range;
        for (const o of tanks) {
          if (o === e || o === player || !o.alive || o.shield || E.broken.has(o)) continue;
          const d = Math.hypot(o.x - e.x, o.y - e.y); if (d <= bd) { bd = d; best = o; }
        }
        if (!best) break;
        best.shield = { by: e, hp: E.hp.has(best) ? E.hp.get(best) : 2 }; E.given.add(best);
      }
    }
  }
  // the point d px back along a trail (trail[0] = the train), and which way the trail runs there
  function pointAlong(trail, d) {
    for (let i = 0; i < trail.length - 1; i++) {
      const a = trail[i], b = trail[i + 1], l = Math.hypot(b.x - a.x, b.y - a.y);
      if (d <= l || i === trail.length - 2) { const k = l ? Math.min(1, d / l) : 0; return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, ang: Math.atan2(a.y - b.y, a.x - b.x) }; }
      d -= l;
    }
    return { x: trail[0].x, y: trail[0].y, ang: 0 };
  }
  function updateTrains(dt) {
    for (const e of tanks) {
      if (!e.alive || !e.cars || !e.cars.length) continue;
      if (Math.hypot(e.x - e.trail[1].x, e.y - e.trail[1].y) > 4) e.trail.unshift({ x: e.x, y: e.y }); else e.trail[0] = { x: e.x, y: e.y };
      let need = 0;
      e.cars.forEach((c, i) => {
        c.arc = Math.max((i + 1) * CAR_GAP, c.arc - 60 * dt);                // the couplings pull the cars up to their gap
        const p = pointAlong(e.trail, c.arc), mv = Math.hypot(p.x - c.x, p.y - c.y);
        c.moving = mv > 0.05;
        if (c.moving) {
          c.x = p.x; c.y = p.y; c.h = hAt(c.x, c.y); c.hull = p.ang; c.trackDist += mv;
          if (!c.lastTrack || Math.hypot(c.x - c.lastTrack.x, c.y - c.lastTrack.y) > 7) { tracks.push({ x: c.x, y: c.y, a: c.hull, age: 0 }); c.lastTrack = { x: c.x, y: c.y }; }
        }
        need = c.arc;
      });
      let acc = 0;                                                          // forget the trail past the last car
      for (let i = 1; i < e.trail.length; i++) { acc += Math.hypot(e.trail[i].x - e.trail[i - 1].x, e.trail[i].y - e.trail[i - 1].y); if (acc > need + 80) { e.trail.length = i + 1; break; } }
    }
  }
  // Super lasers: while a beam is on it kills (or takes 1 HP every half second from) every tank it touches, through walls,
  // pops shells and sets off mines.
  const onBeam = (t, px, py, w) => {
    const a = t.turret, x0 = t.x + Math.cos(a) * (t.r + 14), y0 = t.y + Math.sin(a) * (t.r + 14), dx = Math.cos(a), dy = Math.sin(a);
    const k = (px - x0) * dx + (py - y0) * dy; if (k < -w) return false;
    const qx = x0 + dx * Math.max(0, k), qy = y0 + dy * Math.max(0, k); return (px - qx) ** 2 + (py - qy) ** 2 < w * w;
  };
  function updateBeams(dt) {
    for (const t of tanks) {
      if (!(t.beamT > 0)) continue;
      if (!t.alive) { t.beamT = 0; continue; }
      for (const o of tanks) if (o !== t && o.alive && onBeam(t, o.x, o.y, o.r + 5)) {
        const last = t.beamHits.has(o) ? t.beamHits.get(o) : -9;
        if (clock - last >= 0.5) { t.beamHits.set(o, clock); hitTank(o, { owner: t, kind: 'laser' }); }
      }
      for (const sh of shells) if (!sh.dead && onBeam(t, sh.x, sh.y, 9)) sh.dead = true;
      for (const m of mines) if (!m.lit && !(vs && m.owner && m.owner !== t) && onBeam(t, m.x, m.y, MINE_R + 5)) { m.lit = true; m.boomAt = m.t + 0.1; }
    }
  }
  // ---------- update ----------
  function update(dt) {
    stateT += dt; clock += dt;
    if (vs) lb.k += ((lb.open ? 1 : 0) - lb.k) * Math.min(1, dt * 12);
    if (vs && vs.role === 'client') { clientUpdate(dt); updateFx(dt); return; }    // a Local game on a guest phone: the host runs the battle
    for (const t of tanks) {
      const A = t.ai || t;
      if (t.frozen > 0) t.frozen -= dt; if (t.hurtT > 0) t.hurtT -= dt; if (A.teleCD > 0) A.teleCD -= dt;
      if (t.revealT > 0) t.revealT -= dt; if (t.spawnT > 0) t.spawnT -= dt; if (!t.ai && t.charge > 0 && !(t.beamT > 0)) t.charge -= dt;
      if (t.beamT > 0 && (t.beamT -= dt) <= 0) { t.beamT = 0; A.charge = 6; }     // a super laser fires for 3 s, then charges for 6
      if (t.warnT > 0 && (t.warnT -= dt) <= 0) { t.warnT = 0; if (t.alive) startBeam(t); }
      if (t.wcd) for (let k = 0; k < 2; k++) if (t.wcd[k] > 0) t.wcd[k] -= dt;    // heat seekers reloading
    }
    for (const t of tanks) if (t.alive) t.h = hAt(t.x, t.y);
    for (const t of tanks) if (t.alive && !lavaProof(t) && onLava(t.x, t.y)) {                      // the middle of a lava square is death
      const cx = center(tileC(t.x)), cy = center(tileC(t.y));
      if ((t.x - cx) ** 2 + (t.y - cy) ** 2 < LAVA_R ** 2) {
        emit('lava', t.x, t.y, tileAt(tileC(t.x), tileC(t.y)) === ACID ? 1 : 0);
        killTank(t);
      }
    }
    if (vs) versusTick(dt);
    else if (state === 'playing') { save.time += dt; updatePlayer(dt); for (const t of tanks) if (t.ai && t.alive) updateEnemy(t, dt); updateTrains(dt); updateEnchanters(); }
    else for (const t of tanks) { t.moving = false; t.recoil = Math.max(0, t.recoil - dt * 6); }
    if (vs ? (state === 'playing' || state === 'over') : (state === 'playing' || state === 'dead' || state === 'clear' || state === 'over')) { updateBeams(dt); updateShells(dt); updateMines(dt); }
    updateFx(dt);
    if (vs) return versusFlow();
    // flow
    if (state === 'intro' && stateT >= INTRO_T) { state = 'playing'; stateT = 0; }
    if (state === 'clear' && stateT >= CLEAR_T && customLevel) { state = 'won'; stateT = 0; }   // a level creator test: back to the editor
    if (state === 'clear' && stateT >= CLEAR_T) {
      save.level++;
      if (save.level > LEVELS.length) { state = 'won'; stateT = 0; Store.setProgress('allClear', true); }
      else { loadLevel(); state = 'intro'; }
    }
  }
  // smoke, sparks, tracks, X marks, ice melting: the parts of a frame that are only for show
  const MAX_SMOKE = 350;
  function updateFx(dt) {
    for (const i of ices) i.age += dt;
    ices = ices.filter(i => i.age < i.life);
    for (const p of smoke) { p.age += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.96; p.vy *= 0.96; p.r += 12 * dt; }
    smoke = smoke.filter(p => p.age < p.life);
    if (smoke.length > MAX_SMOKE) smoke.splice(0, smoke.length - MAX_SMOKE);     // lots of rockets at once: drop the oldest puffs
    for (const b of bits) { b.age += dt; b.x += b.vx * dt; b.y += b.vy * dt; b.vx *= 0.93; b.vy *= 0.93; b.rot += b.vr * dt; }
    bits = bits.filter(b => b.age < b.life);
    if (bits.length > 300) bits.splice(0, bits.length - 300);
    for (const r of rings) r.age += dt;
    rings = rings.filter(r => r.age < r.life);
    for (const t of tracks) t.age += dt;
    if (tracks.length > 700) tracks.splice(0, tracks.length - 700);
    for (const m of xmarks) { if (m.delay > 0) m.delay -= dt; else m.alpha = Math.min(1, m.alpha + dt * 2); }
    shake = Math.max(0, shake - dt * 30);
    flashAlpha = Math.max(0, flashAlpha - dt * 1.6);
  }

  function moveInput() {
    let dx = 0, dy = 0;
    if (keys.KeyW || keys.ArrowUp) dy -= 1;
    if (keys.KeyS || keys.ArrowDown) dy += 1;
    if (keys.KeyA || keys.ArrowLeft) dx -= 1;
    if (keys.KeyD || keys.ArrowRight) dx += 1;
    if (sticks.move) { dx += sticks.move.dx; dy += sticks.move.dy; }
    const l = Math.hypot(dx, dy);
    if (l > 1) { dx /= l; dy /= l; }
    return { dx, dy, l: Math.min(1, l) };
  }
  function driveTank(t, mv, dt) { driveTankAt(t, mv, dt, TANK_SPEED); }
  function driveTankAt(t, mv, dt, speed) {
    const l = mv.l == null ? Math.hypot(mv.dx, mv.dy) : mv.l;
    t.moving = l > 0.1 && !(t.frozen > 0);                                  // frozen in ice: aim and shoot, no driving
    if (!t.moving) return;
    // the hull turns toward the drive direction (or straight back, if that is the shorter turn, so the tank reverses)
    let want = Math.atan2(mv.dy, mv.dx), d = angDiff(t.hull, want), rev = false;
    if (Math.abs(d) > Math.PI / 2) { want += Math.PI; d = angDiff(t.hull, want); rev = true; }
    const turn = 7 * dt;
    t.hull += Math.abs(d) < turn ? d : Math.sign(d) * turn;
    const push = (1 - Math.min(1, Math.abs(d) / Math.PI) * 0.6) * Math.min(1, l) * speed * dt * slowAt(t);   // water, tar and (for the player) oil slow the tank
    const sx = Math.cos(t.hull) * push * (rev ? -1 : 1), sy = Math.sin(t.hull) * push * (rev ? -1 : 1);
    const ox = t.x, oy = t.y;
    // Each axis move is judged at the height the tank will HAVE there (a ramp's edge changes it); when only the height
    // change blocks the way, slide toward the middle of the lane so the tank lines up with the ramp instead of jamming.
    if (!tryMove(t, t.x + sx, t.y) && sx && !circleHitsWall(t.x + sx, t.y, t.r, false, t.h)) {
      const cy = center(tileC(t.y)); tryMove(t, t.x, t.y + Math.sign(cy - t.y) * Math.min(Math.abs(sx), Math.abs(cy - t.y)));
    }
    if (!tryMove(t, t.x, t.y + sy) && sy && !circleHitsWall(t.x, t.y + sy, t.r, false, t.h)) {
      const cx = center(tileC(t.x)); tryMove(t, t.x + Math.sign(cx - t.x) * Math.min(Math.abs(sy), Math.abs(cx - t.x)), t.y);
    }
    t.trackDist += Math.hypot(t.x - ox, t.y - oy);
    if (!t.lastTrack || Math.hypot(t.x - t.lastTrack.x, t.y - t.lastTrack.y) > 7) { tracks.push({ x: t.x, y: t.y, a: t.hull, age: 0 }); t.lastTrack = { x: t.x, y: t.y }; }
  }
  function tryMove(t, nx, ny) {
    const h = hAt(nx, ny);
    if (hitsTank(t, nx, ny)) return false;
    if (circleHitsWall(nx, ny, t.r, false, h)) {
      // already wedged in an edge somehow: only let it creep toward the centre of its own square, which is always clear
      if (!circleHitsWall(t.x, t.y, t.r, false, t.h)) return false;
      const cx = center(tileC(t.x)), cy = center(tileC(t.y));
      if (Math.hypot(nx - cx, ny - cy) >= Math.hypot(t.x - cx, t.y - cy)) return false;
    }
    t.x = nx; t.y = ny; t.h = h; return true;
  }
  function hitsTank(me, x, y) {
    for (const o of tanks) if (o !== me && o.alive && o.train !== me && (o.h === 2 || me.h === 2 || o.h === me.h) && (o.x - x) ** 2 + (o.y - y) ** 2 < (o.r + me.r) ** 2) return true;
    return false;
  }
  function updatePlayer(dt) {
    const t = player;
    t.fireCD = Math.max(0, t.fireCD - dt);
    t.recoil = Math.max(0, t.recoil - dt * 6);
    if (!t.alive) { t.moving = false; return; }
    const ox = t.x, oy = t.y;
    driveTank(t, moveInput(), dt);
    t.vx = (t.x - ox) / dt; t.vy = (t.y - oy) / dt;
    if (sticks.aim) t.turret = fingerAim(t);
    else if (!touchMode) t.turret = Math.atan2(mouse.y - t.y, mouse.x - t.x);
  }
  // Where would a shell fired by t at angle a end up? Walks the shell's path with the real bounce rule and reports the
  // first thing it meets: 'self' (it comes back to the tank that fired it), 'ally' (another enemy), 'player', or 'wall'
  // (it dies on its last bounce without hitting anyone). Used by every tank before it pulls the trigger.
  function simShot(t, a, maxB, off = 0) {
    let x = t.x + Math.cos(a) * (t.r + 10) - Math.sin(a) * off, y = t.y + Math.sin(a) * (t.r + 10) + Math.cos(a) * off, vx = Math.cos(a), vy = Math.sin(a);
    let h = t.h === 2 ? liftAt(x, y) : t.h;
    if (circleHitsWall(x, y, SHELL_R, true, h)) return 'wall';
    const step = 4, maxD = (W + H) * 2.5, lim = maxB == null ? t.bounces : maxB;
    let b = 0, left = false;
    for (let d = 0; d < maxD; d += step) {
      const nx = x + vx * step, ny = y + vy * step;
      if (circleHitsWall(nx, ny, SHELL_R, true, h)) {
        const hx = circleHitsWall(nx, y, SHELL_R, true, h), hy = circleHitsWall(x, ny, SHELL_R, true, h);
        if (hx || (!hx && !hy)) vx = -vx;
        if (hy || (!hx && !hy)) vy = -vy;
        if (++b > lim) { simHit = { x, y }; return 'wall'; }
        continue;
      }
      x = nx; y = ny; h = liftAt(x, y);
      const own = (x - t.x) ** 2 + (y - t.y) ** 2 < (t.r + SHELL_R + 6) ** 2;
      if (!own) left = true; else if (left && (t.h === 2 || t.h === h)) return 'self';
      for (const o of tanks) {
        if (o === t || !o.alive || !(o.h === 2 || o.h === h)) continue;
        if ((x - o.x) ** 2 + (y - o.y) ** 2 < (o.r + SHELL_R) ** 2) return o === player ? 'player' : 'ally';
      }
    }
    return 'wall';
  }
  // Pick the angle to fire at. Priority one: never a shot that comes back on itself (or a friend). Goal: hit the player,
  // straight if possible, off a wall if the tank is in the mood (T.ricochet), else a safe straight shot with its usual error.
  // A flame wave is five shots abreast: a friend in any lane spoils it, the player in any lane makes it a hit.
  function simWave(t, a) {
    let res = 'wall';
    for (const off of FLAME_OFFS) { const r = simShot(t, a, 0, off); if (r === 'ally') return 'ally'; if (r === 'player') res = 'player'; }
    return res;
  }
  function chooseShot(t) {
    const T = t.ai.T, direct = Math.atan2(player.y - t.y, player.x - t.x);
    if (T.homing) {                                                         // heat seekers: fire whenever a way round the walls to the player exists
      const f = homingField(), i = tileC(t.y) * COLS + tileC(t.x);
      if (!(f[i] >= 0) || f[i] > 40) return null;
      const g = homingAim(t.x, t.y); return g ? Math.atan2(g.y - t.y, g.x - t.x) : null;
    }
    if (T.frost) {                                                          // frost: a straight hit, else a wall close enough to the player to freeze them
      if (simShot(t, direct) === 'player') return direct + (Math.random() - 0.5) * T.aim;
      let best = null, bd = Infinity;
      for (let k = 0; k < 90; k++) {
        const a = k / 90 * Math.PI * 2; if (simShot(t, a, 0) !== 'wall' || !simHit) continue;
        const hx = simHit.x, hy = simHit.y, dp = Math.hypot(hx - player.x, hy - player.y);
        if (Math.hypot(hx - t.x, hy - t.y) < TILE * 2.5 || tanks.some(o => o !== player && o.alive && Math.hypot(o.x - hx, o.y - hy) < TILE * 1.6)) continue;
        if (dp < TILE * 1.3 && dp < bd) { bd = dp; best = a; }
      }
      return best;
    }
    if (T.flame) {                                                          // flame tanks only fire with the player in view, leading them a little
      if (!los(t.x, t.y, player.x, player.y)) return null;
      const d = Math.hypot(player.x - t.x, player.y - t.y), k = 0.5 * d / (SHELL_SPEED * T.speed);
      const a = Math.atan2(player.y + (player.vy || 0) * k - t.y, player.x + (player.vx || 0) * k - t.x) + (Math.random() - 0.5) * T.aim;
      return simWave(t, a) === 'ally' ? (simWave(t, direct) === 'ally' ? null : direct) : a;
    }
    if (simShot(t, direct) === 'player') {
      const a = direct + (Math.random() - 0.5) * T.aim, r = simShot(t, a);
      return (r === 'self' || r === 'ally') ? direct : a;
    }
    if (Math.random() < T.ricochet) {
      const best = [];
      for (let i = 0; i < 120; i++) { const a = i / 120 * Math.PI * 2; if (simShot(t, a) === 'player') best.push(a); }
      if (best.length) return best[Math.floor(Math.random() * best.length)];
    }
    for (let tries = 0; tries < 4; tries++) {
      const a = direct + (Math.random() - 0.5) * 2 * T.aim, r = simShot(t, a);
      if (r !== 'self' && r !== 'ally') return a;
    }
    return null;
  }
  // Enemy brain: swing the turret onto the chosen shot and fire when lined up; movers wander toward the player.
  function updateEnemy(t, dt) {
    const A = t.ai, T = A.T;
    t.fireCD = Math.max(0, t.fireCD - dt);
    t.recoil = Math.max(0, t.recoil - dt * 6);
    if (!player.alive) { t.moving = false; return; }
    if (T.load) {                                                           // a load tank: pulled by its war train, or sitting loose
      if (t.train || !T.charge) return;
      if ((t.freeT -= dt) > 0) { t.moving = false; return; }                // a suicide load wakes up 10 s after it comes loose
    }
    if (T.teleport && !(t.frozen > 0) && !(A.teleCD > 0) && tileAt(tileC(t.x), tileC(t.y)) === TELE) {   // on a pad and in danger: jump away
      const threat = shellThreat(t);
      if ((threat || (!ignoresMines(T) && mineDist(t.x, t.y) < MINE_SAFE)) && escapeByPad(t, threat)) return;
    }
    if (T.move > 0 && !(t.frozen > 0)) moveEnemy(t, dt); else t.moving = false;
    if (charger(T)) {                                                       // no gun: it rams the player and goes off like a mine
      if ((t.h === 2 || player.h === 2 || t.h === player.h) && (player.x - t.x) ** 2 + (player.y - t.y) ** 2 < (t.r + player.r + 8) ** 2) { explode(t.x, t.y, BLAST_R, false, t); killTank(t); }
      return;
    }
    if (T.mines) layerBrain(t, dt);
    if (T.laser) return laserBrain(t, dt);
    if (A.want == null) A.want = Math.atan2(player.y - t.y, player.x - t.x);
    const d = angDiff(t.turret, A.want), turn = T.turn * dt;
    t.turret += Math.abs(d) < turn ? d : Math.sign(d) * turn;
    if (t.shells < t.maxShells) {
      A.fireT -= dt;
      if (A.fireT <= 0) {
        if (A.pick == null) { A.pick = chooseShot(t); if (A.pick != null) A.want = A.pick; else A.fireT = 0.5; }
        if (A.pick != null && Math.abs(angDiff(t.turret, A.pick)) < 0.06) {
          const r = T.flame ? simWave(t, t.turret) : T.homing ? 'seek' : simShot(t, t.turret);   // last look: things may have moved
          if (r !== 'self' && r !== 'ally') fire(t);
          A.pick = null; A.fireT = T.fire[0] + Math.random() * (T.fire[1] - T.fire[0]);
          if (T.flame) {                                                    // one or two waves every three seconds
            if (A.burst) { A.burst = 0; A.fireT = 2.5; } else if (Math.random() < 0.5) { A.burst = 1; A.fireT = 0.5; } else A.fireT = 3;
          }
        }
      } else if (A.pick == null) A.want = Math.atan2(player.y - t.y, player.x - t.x);   // idle tracking
    }
  }
  // Super laser: the slow turret tracks the player (walls do not matter); once charged and lined up, a 3 s beam,
  // then 6 s to charge again. It holds fire while a friend stands in the beam's path.
  // Lined up and charged, it WARNS for 1 s (turret frozen, red sight line) before the beam, and its turret always sweeps
  // slower than you can drive at that distance - so you can dodge it, and outrun it while it fires.
  function laserBrain(t, dt) {
    const A = t.ai, T = A.T, want = Math.atan2(player.y - t.y, player.x - t.x), d = angDiff(t.turret, want);
    if (A.warn > 0) { if ((A.warn -= dt) <= 0) { A.warn = 0; startBeam(t); } return; }
    const turn = beamSweep(Math.hypot(player.x - t.x, player.y - t.y), T.turn * (t.beamT > 0 ? 0.6 : 0.75)) * dt;
    t.turret += Math.abs(d) < turn ? d : Math.sign(d) * turn;
    if (t.beamT > 0) return;                                               // the beam runs its 3 s in update()
    A.charge -= dt;
    if (A.charge <= 0 && Math.abs(d) < 0.08 && !tanks.some(o => o !== t && o !== player && o.alive && onBeam(t, o.x, o.y, o.r + 8))) A.warn = 1.0;
  }
  // Heat seekers: distances from the player's square over everything a shell can cross (rebuilt at most once a frame)
  // (multiplayer: from whichever tank the rocket chases)
  const homeCache = new Map(); let homeClock = -1;
  function homingField(tg) {
    tg = tg || player;
    if (homeClock !== clock) { homeCache.clear(); homeClock = clock; }
    if (homeCache.has(tg)) return homeCache.get(tg);
    const dist = new Int16Array(COLS * ROWS).fill(-1), s0 = tileC(tg.y) * COLS + tileC(tg.x), q = [s0];
    if (s0 >= 0 && s0 < dist.length) dist[s0] = 0;
    for (let h = 0; h < q.length; h++) {
      const i = q[h], c = i % COLS, r = (i / COLS) | 0;
      for (const [dc, dr] of DIR4) {
        const nc = c + dc, nr = r + dr, j = nr * COLS + nc;
        if (nc < 0 || nr < 0 || nc >= COLS || nr >= ROWS || dist[j] >= 0 || blocksShell(nc, nr, 0)) continue;
        dist[j] = dist[i] + 1; q.push(j);
      }
    }
    homeCache.set(tg, dist); return dist;
  }
  const fatClear = (x1, y1, x2, y2) => { const n = Math.ceil(Math.hypot(x2 - x1, y2 - y1) / 5); for (let i = 1; i <= n; i++) if (circleHitsWall(x1 + (x2 - x1) * i / n, y1 + (y2 - y1) * i / n, SHELL_R + 1, true, 0)) return false; return true; };
  // where a heat seeker at (x, y) heads next: straight at the player when it can see them, else the farthest square
  // down the way round the walls that it can reach in a straight line
  function homingAim(x, y, tg) {
    tg = tg || player;
    if (fatClear(x, y, tg.x, tg.y)) return { x: tg.x, y: tg.y };
    const f = homingField(tg); let c = tileC(x), r = tileC(y);
    if (!(f[r * COLS + c] >= 0)) return null;
    let best = { x: center(c), y: center(r) };
    for (let k = 0; k < 8; k++) {
      let nx = -1, ny = -1, nd = f[r * COLS + c];
      for (const [dc, dr] of DIR4) {
        const cc = c + dc, rr2 = r + dr; if (cc < 0 || rr2 < 0 || cc >= COLS || rr2 >= ROWS) continue;
        const v = f[rr2 * COLS + cc]; if (v >= 0 && v < nd) { nd = v; nx = cc; ny = rr2; }
      }
      if (nx < 0 || !fatClear(x, y, center(nx), center(ny))) break;
      c = nx; r = ny; best = { x: center(c), y: center(r) };
    }
    return best;
  }
  // Mine layers (the yellow tanks). Rule one: never die to your own mine. A mine is only dropped when the tank is on the
  // move, no friend is parked in the blast, the player is not close enough to set it off at once, and a route out of the
  // danger ring exists (checked with bfs as if the mine were already there). Then it runs that route before anything else.
  function layerBrain(t, dt) {
    const A = t.ai, T = A.T;
    A.mineT -= dt;
    if (A.mineT > 0 || t.mines >= MAX_MINES || A.mode === 'flee' || A.mode === 'dodge' || !A.path.length) return;
    const dp = Math.hypot(player.x - t.x, player.y - t.y);
    const ok = !inWater(t.x, t.y) && dp > MINE_SAFE + TILE && (dp > TILE * 6 || !los(t.x, t.y, player.x, player.y))
      && !tanks.some(o => o !== t && o !== player && o.alive && Math.hypot(o.x - t.x, o.y - t.y) < MINE_SAFE + TANK_R);
    if (ok) {
      const here = { x: t.x, y: t.y }, nav = bfs(tileC(t.x), tileC(t.y), here, 'none', t);
      let best = -1, bd = Infinity;
      for (let i = 0; i < COLS * ROWS; i++) if (nav.dist[i] > 0 && nav.dist[i] <= 5 && nav.dist[i] < bd && Math.hypot(center(i % COLS) - here.x, center((i / COLS) | 0) - here.y) >= MINE_SAFE) { bd = nav.dist[i]; best = i; }
      if (best >= 0 && layMine(t)) {
        A.mode = 'flee'; A.path = pathFrom(nav, best); A.planT = 0.3; A.restT = 0;
        A.mineT = T.mines[0] + Math.random() * (T.mines[1] - T.mines[0]);
        return;
      }
    }
    A.mineT = 0.8;                                             // not now; look again shortly
  }
  // ---------- navigation for the moving tanks ----------
  const tileC = v => Math.floor(v / TILE), center = i => i * TILE + TILE / 2;
  // Breadth-first distances from a tile over open floor; tiles near a mine count as blocked.
  // extra = a mine that is not laid yet (a yellow tank asking "could I get away from here?").
  // lava: 'none' = never step in, 'edge' = may END a path on a lava square (it will stop at its edge), 'proof' = plain ground
  function bfs(sc, sr, extra, lava = 'none', who = null) {
    const n = COLS * ROWS, dist = new Int16Array(n).fill(-1), prev = new Int16Array(n).fill(-1), q = [sr * COLS + sc];
    const bad = new Uint8Array(n), sx = center(sc), sy = center(sr), WT = who && who.ai && who.ai.T, tele = WT && WT.teleport && pads.length > 1;
    for (const m of (WT && ignoresMines(WT)) ? (extra ? [extra] : []) : extra ? mines.concat([extra]) : mines) {
      if (inWater(m.x, m.y)) continue;
      const sd = (sx - m.x) ** 2 + (sy - m.y) ** 2, inside = sd < MINE_SAFE ** 2;
      for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
        const d2 = (center(c) - m.x) ** 2 + (center(r) - m.y) ** 2;
        if (d2 < MINE_SAFE ** 2 && !(inside && d2 > sd)) bad[r * COLS + c] = 1;    // escaping outward is allowed
      }
    }
    // nearby tanks are obstacles (no shoving in corridors); far ones are not, they will most likely have moved by the time we get there
    for (const o of tanks) if (o.alive && Math.hypot(o.x - sx, o.y - sy) < TILE * 4) { const i = tileC(o.y) * COLS + tileC(o.x); if (i !== q[0]) bad[i] = 1; }
    dist[q[0]] = 0;
    for (let h = 0; h < q.length; h++) {
      const i = q[h], c = i % COLS, r = (i / COLS) | 0;
      for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nc = c + dc, nr = r + dr, j = nr * COLS + nc;
        if (nc < 0 || nr < 0 || nc >= COLS || nr >= ROWS || !canStep(tileAt(c, r), tileAt(nc, nr)) || dist[j] >= 0 || (bad[j] && j !== q[0])) continue;
        const hot = HOT(tileAt(nc, nr)) && lava !== 'proof';
        if (hot && lava === 'none') continue;
        dist[j] = dist[i] + 1; prev[j] = i; if (!hot) q.push(j);                 // a lava square is a dead end, never a step on the way
      }
      if (tele && map[i] === TELE) for (const j of pads) if (dist[j] < 0 && !bad[j]) { dist[j] = dist[i] + 1; prev[j] = i; q.push(j); }
    }
    return { dist, prev };
  }
  function pathFrom(nav, goal) {
    const out = []; let i = goal;
    while (i >= 0 && nav.dist[i] > 0) { out.push([i % COLS, (i / COLS) | 0]); i = nav.prev[i]; }
    return out.reverse();
  }
  // Clear straight line between two points (no wall squares in the way)?
  function los(x1, y1, x2, y2) {
    const d = Math.hypot(x2 - x1, y2 - y1), n = Math.ceil(d / 6);
    let h = liftAt(x1, y1);
    for (let i = 1; i < n; i++) {
      const x = x1 + (x2 - x1) * i / n, y = y1 + (y2 - y1) * i / n;
      if (blocksShell(tileC(x), tileC(y), h)) return false;
      h = liftAt(x, y);
    }
    const th = hAt(x2, y2); return th === 2 || th === h;
  }
  // Points a shell will pass through over the next while (same bounce rule as the real thing).
  function tracePath(x, y, vx, vy, maxB, maxD, h) {
    const pts = [], step = 8, sp = Math.hypot(vx, vy); vx /= sp; vy /= sp;
    let b = 0;
    for (let d = 0; d < maxD; d += step) {
      const nx = x + vx * step, ny = y + vy * step;
      if (circleHitsWall(nx, ny, SHELL_R, true, h)) {
        const hx = circleHitsWall(nx, y, SHELL_R, true, h), hy = circleHitsWall(x, ny, SHELL_R, true, h);
        if (hx || (!hx && !hy)) vx = -vx;
        if (hy || (!hx && !hy)) vy = -vy;
        if (++b > maxB) break;
        continue;
      }
      x = nx; y = ny; h = liftAt(x, y); pts.push([x, y]);
    }
    return pts;
  }
  // Any shell about to pass close to this tank in the next ~1.3 s?
  function shellThreat(t) {
    let pts = [];
    for (const s of shells) {
      if (s.owner === t && s.age < 0.3) continue;
      const p = tracePath(s.x, s.y, s.vx, s.vy, s.maxB - s.bounces, Math.hypot(s.vx, s.vy) * 1.3, s.h);
      if (p.some(([x, y]) => (x - t.x) ** 2 + (y - t.y) ** 2 < (TILE * 1.2) ** 2)) pts = pts.concat(p);
    }
    return pts.length ? pts : null;
  }
  const mineDist = (x, y) => mines.reduce((d, m) => inWater(m.x, m.y) ? d : Math.min(d, Math.hypot(x - m.x, y - m.y)), Infinity);   // water mines are harmless
  // Choose where to go for the current mood; returns a tile index or -1 to stay put.
  function pickGoal(t, mode, nav, threat) {
    const T = t.ai.T, here = tileC(t.y) * COLS + tileC(t.x), [rMin, rMax] = T.range || [3, 7];
    let best = -1, bestScore = Infinity;
    const consider = (i, ok, score) => { if (ok && nav.dist[i] >= 0 && score < bestScore) { best = i; bestScore = score; } };
    for (let r = 1; r < ROWS - 1; r++) for (let c = 1; c < COLS - 1; c++) {
      const i = r * COLS + c; if (!walkable(tileAt(c, r))) continue;
      const cx = center(c), cy = center(r), dp = Math.hypot(player.x - cx, player.y - cy) / TILE;
      const seen = los(cx, cy, player.x, player.y), noise = Math.random() * 1.5;
      if (mode === 'hunt') consider(i, seen && dp >= rMin && dp <= rMax, nav.dist[i] + noise + (i === here ? -2 : 0));
      else if (mode === 'cover') consider(i, !seen && dp > 1.5, nav.dist[i] + noise);
      else if (mode === 'dodge') consider(i, nav.dist[i] <= 4 && !threat.some(([x, y]) => (x - cx) ** 2 + (y - cy) ** 2 < (TILE * 1.3) ** 2), nav.dist[i] + (seen ? 1.5 : 0) + noise + (HOT(tileAt(c, r)) && !lavaProof(t) ? 3 : 0));   // a lava (or acid) edge beats a shell, but only just
      else if (mode === 'roam') consider(i, nav.dist[i] >= 3 && nav.dist[i] <= 9, noise * 4);
      else if (mode === 'flee') consider(i, mineDist(cx, cy) >= MINE_SAFE, nav.dist[i] + noise * 0.3);
    }
    if (mode === 'flee' && best < 0) {                          // boxed in: at least get as far from the mine as it can
      let bd = -1; for (let i = 0; i < COLS * ROWS; i++) if (nav.dist[i] >= 0) { const d = mineDist(center(i % COLS), center((i / COLS) | 0)); if (d > bd) { bd = d; best = i; } }
    }
    if (mode === 'hunt' && best < 0) {                          // nowhere with a view: close in on the player's square
      const pi = tileC(player.y) * COLS + tileC(player.x);
      if (nav.dist[pi] >= 0) best = pi;
      else { let bd = Infinity; for (let i = 0; i < COLS * ROWS; i++) if (nav.dist[i] >= 0) { const d = Math.hypot(center(i % COLS) - player.x, center((i / COLS) | 0) - player.y); if (d < bd) { bd = d; best = i; } } }
    }
    return best;
  }
  // Movers: hunt a spot with a line of sight at a comfortable range, duck into cover while the shell is out,
  // dodge incoming shells, and wander when the player has been out of sight for a while.
  function moveEnemy(t, dt) {
    const A = t.ai, T = A.T;
    A.planT -= dt; A.restT = Math.max(0, (A.restT || 0) - dt);
    const seen = los(t.x, t.y, player.x, player.y);
    A.hiddenT = seen || (A.path && A.path.length) ? 0 : (A.hiddenT || 0) + dt;   // only idle time out of sight counts
    const threat = shellThreat(t);
    const mode = !ignoresMines(T) && mineDist(t.x, t.y) < MINE_SAFE ? 'flee' : charger(T) ? 'hunt' : threat ? 'dodge' : t.shells >= t.maxShells ? 'cover' : A.hiddenT > 3 ? 'roam' : 'hunt';   // a bomber only ever charges
    const replan = mode === 'flee' ? (mode !== A.mode || !A.path.length || A.stuck > 0.3)
      : (mode !== A.mode || A.planT <= 0 || A.stuck > 0.3 || (A.path && !A.path.length && mode !== 'hunt'));
    if (replan) {
      A.mode = mode; A.stuck = 0; A.planT = mode === 'dodge' ? 0.25 : mode === 'flee' ? 0.3 : mode === 'hunt' ? (charger(T) ? 0.3 : 0.7) : 1.2;
      const nav = bfs(tileC(t.x), tileC(t.y), null, T.lavaProof ? 'proof' : mode === 'dodge' ? 'edge' : 'none', t);
      const goal = pickGoal(t, mode, nav, threat || []);
      A.path = goal >= 0 ? pathFrom(nav, goal) : [];
      // standing on a lava edge: leave the way it came in, never across the middle
      const tc = tileC(t.x), tr = tileC(t.y);
      if (!T.lavaProof && HOT(tileAt(tc, tr)) && A.path.length) {
        const ddx = t.x - center(tc), ddy = t.y - center(tr), esc = Math.abs(ddx) > Math.abs(ddy) ? [tc + Math.sign(ddx), tr] : [tc, tr + Math.sign(ddy)];
        if (A.path[0][0] !== esc[0] || A.path[0][1] !== esc[1]) A.path.unshift(esc);
      }
      if (mode === 'hunt' && !charger(T) && !A.path.length && Math.random() < 0.3) A.restT = 0.4 + Math.random() * 0.8;   // a breather at a good spot
    }
    if (charger(T) && mode === 'hunt' && Math.hypot(player.x - t.x, player.y - t.y) < TILE * 3 && los(t.x, t.y, player.x, player.y) && !hotBetween(t.x, t.y, player.x, player.y)) {
      const dx = player.x - t.x, dy = player.y - t.y, d = Math.hypot(dx, dy) || 1;   // close and clear: straight at the player
      driveTankAt(t, { dx: dx / d, dy: dy / d }, dt, TANK_SPEED * T.move); return;
    }
    if (!A.path.length || A.restT > 0) { t.moving = false; return; }
    const [c, r] = A.path[0]; let gx = center(c), gy = center(r);
    if (T.teleport && tileAt(c, r) === TELE && tileAt(tileC(t.x), tileC(t.y)) === TELE && Math.abs(c - tileC(t.x)) + Math.abs(r - tileC(t.y)) > 1) {
      if (teleport(t, c, r)) A.path.shift();                                // the route jumps between two pads
      t.moving = false; return;
    }
    if (HOT(tileAt(c, r)) && !T.lavaProof) {                                  // retreating onto lava: stop at its near edge
      const fc = tileC(t.x), fr = tileC(t.y);
      if (fc !== c) gx -= Math.sign(c - fc) * TILE * 0.42; if (fr !== r) gy -= Math.sign(r - fr) * TILE * 0.42;
    }
    const dx = gx - t.x, dy = gy - t.y, d = Math.hypot(dx, dy);
    if (d < 6) { A.path.shift(); return; }
    const ox = t.x, oy = t.y;
    driveTankAt(t, { dx: dx / d, dy: dy / d }, dt, TANK_SPEED * T.move);
    if (Math.hypot(t.x - ox, t.y - oy) < TANK_SPEED * T.move * dt * 0.3) A.stuck += dt; else A.stuck = 0;
  }
  // Standing on a teleport pad with a shell coming (or a mine too close): jump to the safest other pad.
  function escapeByPad(t, threat) {
    const here = tileC(t.y) * COLS + tileC(t.x); let best = -1, bs = -Infinity;
    for (const j of pads) {
      if (j === here) continue;
      const cx = center(j % COLS), cy = center((j / COLS) | 0);
      const near = (threat || []).reduce((m, [x, y]) => Math.min(m, Math.hypot(x - cx, y - cy)), TILE * 6);
      const sc = Math.min(near, ignoresMines(t.ai.T) ? Infinity : mineDist(cx, cy)) + (los(cx, cy, player.x, player.y) ? 0 : TILE);
      if (sc > bs) { bs = sc; best = j; }
    }
    if (best >= 0 && teleport(t, best % COLS, (best / COLS) | 0)) { t.ai.path = []; t.ai.planT = 0; return true; }
    return false;
  }
  const hotBetween = (x1, y1, x2, y2) => { const n = Math.ceil(Math.hypot(x2 - x1, y2 - y1) / 8); for (let i = 1; i < n; i++) if (onLava(x1 + (x2 - x1) * i / n, y1 + (y2 - y1) * i / n)) return true; return false; };
  function angDiff(a, b) { let d = (b - a) % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2; return d; }

  function updateShells(dt) {
    const steps = 3, sdt = dt / steps;
    for (let step = 0; step < steps; step++) {
      for (const s of shells) {
        if (s.dead) continue;
        s.age += sdt;
        if (s.homing && step === 0) {                                       // heat seeker: steer for the player round the walls
          s.life -= dt;
          if (s.life <= 0) { s.dead = true; smoke.push(puff(s.x, s.y, 8, 0.4, 'rgba(255,150,40,')); continue; }
          let tg = s.target || (vs ? null : player);
          if (vs && !(tg && tg.alive)) tg = s.target = pickTarget(s.owner, s.x, s.y);
          const g = tg && tg.alive ? homingAim(s.x, s.y, tg) : null;
          if (g) {
            const want = Math.atan2(g.y - s.y, g.x - s.x), cur = Math.atan2(s.vy, s.vx), d = angDiff(cur, want), turn = 16 * dt, sp = Math.hypot(s.vx, s.vy);
            const a = cur + (Math.abs(d) < turn ? d : Math.sign(d) * turn); s.vx = Math.cos(a) * sp; s.vy = Math.sin(a) * sp;
          }
        }
        const nx = s.x + s.vx * sdt, ny = s.y + s.vy * sdt;
        if (circleHitsWall(nx, ny, SHELL_R, true, s.h)) {
          const hx = circleHitsWall(nx, s.y, SHELL_R, true, s.h), hy = circleHitsWall(s.x, ny, SHELL_R, true, s.h);
          if (hx || (!hx && !hy)) s.vx = -s.vx;
          if (hy || (!hx && !hy)) s.vy = -s.vy;
          s.bounces++;
          if (s.bounces > s.maxB) {
            s.dead = true; if (!s.flame) Sfx.hit();
            if (s.flame) smoke.push(puff(s.x, s.y, 9, 0.4, 'rgba(255,140,40,'));
            else if (s.frost) freezeAt(s.x, s.y, s.owner);
            else if (s.rocket || s.homing) { rings.push({ x: s.x, y: s.y, age: 0, life: 0.3, r: 22 }); for (let i = 0; i < 6; i++) smoke.push(puff(s.x, s.y, 6 + Math.random() * 6, 0.5, 'rgba(255,160,60,')); }
            else smoke.push(puff(s.x, s.y, 7, 0.4, 'rgba(200,200,210,'));
            continue;
          }
          Sfx.bounce();
          smoke.push(puff(s.x, s.y, 4, 0.3, 'rgba(255,255,255,'));
        } else {
          s.x = nx; s.y = ny; s.h = liftAt(nx, ny);
          if (s.flame && step === 0 && Math.random() < 0.35) { const p = puff(s.x, s.y, 5, 0.3, Math.random() < 0.5 ? 'rgba(255,120,30,' : 'rgba(90,80,80,'); p.vx *= 0.4; p.vy *= 0.4; smoke.push(p); }
          if ((s.homing || s.frost) && step === 0) { const p = puff(s.x - s.vx * 0.03, s.y - s.vy * 0.03, 4, 0.25, s.frost ? (Math.random() < 0.5 ? 'rgba(170,230,255,' : 'rgba(240,250,255,') : (Math.random() < 0.5 ? 'rgba(255,140,30,' : 'rgba(255,210,90,')); p.vx *= 0.3; p.vy *= 0.3; smoke.push(p); }
          if (s.rocket && step === 0) { const p = puff(s.x - s.vx * 0.03, s.y - s.vy * 0.03, 4, 0.22, Math.random() < 0.5 ? 'rgba(255,170,50,' : 'rgba(255,230,120,'); p.vx *= 0.3; p.vy *= 0.3; smoke.push(p); }
        }
        for (const t of tanks) {
          if (!t.alive || (t === s.owner && s.age < 0.08) || !(t.h === 2 || t.h === s.h)) continue;
          if ((s.x - t.x) ** 2 + (s.y - t.y) ** 2 < (t.r + (s.r || SHELL_R)) ** 2) {
            if (!hitTank(t, { owner: s.owner, kind: s.flame ? 'flame' : 'shell' })) continue;   // friendly-fire immune: it passes through
            s.dead = true; if (s.frost) freezeAt(s.x, s.y, s.owner); break;
          }
        }
        for (const m of mines) if (!m.lit && !(vs && m.owner && m.owner !== s.owner) && (s.x - m.x) ** 2 + (s.y - m.y) ** 2 < (MINE_R + SHELL_R) ** 2) { s.dead = true; m.lit = true; m.boomAt = m.t; }   // multiplayer: only your own shots set off your mines
      }
      for (let i = 0; i < shells.length; i++) for (let j = i + 1; j < shells.length; j++) {
        const a = shells[i], b = shells[j];
        if (a.dead || b.dead || (a.flame && b.flame)) continue;
        if (a.flame || b.flame) {                                           // a shell snuffs out the one fire cell it hits: five hits and the wave is gone
          if ((a.x - b.x) ** 2 + (a.y - b.y) ** 2 < (SHELL_R + FLAME_R) ** 2) { a.dead = b.dead = true; smoke.push(puff((a.x + b.x) / 2, (a.y + b.y) / 2, 9, 0.4, 'rgba(255,200,120,')); Sfx.hit(); }
          continue;
        }
        if ((a.x - b.x) ** 2 + (a.y - b.y) ** 2 < (SHELL_R * 2) ** 2) { a.dead = b.dead = true; smoke.push(puff((a.x + b.x) / 2, (a.y + b.y) / 2, 9, 0.4, 'rgba(255,240,200,')); Sfx.hit(); }
      }
    }
    shells = shells.filter(s => { if (s.dead && !s.flame) shellGone(s); return !s.dead; });
  }
  function updateMines(dt) {
    for (const m of mines) {
      m.t += dt;
      if (!m.lit && m.t > MINE_ARM) for (const t of tanks) if (t.alive && t !== m.owner && !sameTeam(t, m.owner) && (t.x - m.x) ** 2 + (t.y - m.y) ** 2 < MINE_TRIGGER ** 2) { m.lit = true; m.boomAt = m.t + 0.35; break; }
      if (!m.lit && !m.gray && m.t > MINE_FUSE - 2 && Math.floor(m.t * 8) !== Math.floor((m.t - dt) * 8)) Sfx.beep();
      if (m.t >= m.boomAt) { m.dead = true; if (m.owner) m.owner.mines = Math.max(0, m.owner.mines - 1); explode(m.x, m.y, BLAST_R, inWater(m.x, m.y), m.owner); }
    }
    mines = mines.filter(m => !m.dead);
  }

  // ---------- drawing ----------
  function resize() {
    if (!canvas) return;
    dpr = Math.min(2, window.devicePixelRatio || 1, perf.maxDpr);
    view.cw = window.innerWidth; view.ch = window.innerHeight;
    canvas.width = Math.round(view.cw * dpr); canvas.height = Math.round(view.ch * dpr);
    applyCam(0);
  }
  const touchDev = () => touchMode || coarse;
  // the camera is on for your own tank on a phone: the campaign, a level-creator test and Local games (not split screen, the level creator or teleport placing)
  function camOn() { return zoomAmt() > 0 && state !== 'edit' && state !== 'idle' && state !== 'place' && !(vs && vs.role === 'local'); }
  function camTarget() { if (vs) { const P = vs.players.find(q => q.ctl === 'me'); return P ? P.tank : null; } return player; }
  function applyCam(dt) {
    const aw = Math.max(50, view.cw - inset.l - inset.r), ah = Math.max(50, view.ch - inset.t - inset.b);   // the level creator's panels take some of the screen
    const fit = Math.min(aw / W, ah / H);
    let s = fit, ox, oy;
    if (camOn()) { const max = Math.max(fit, ah / MAX_ZOOM_ROWS / TILE); s = fit * Math.pow(max / fit, zoomAmt()); }   // even steps from the whole map to close up
    const vw = W * s, vh = H * s, t = camTarget();
    ox = inset.l + (aw - vw) / 2; oy = inset.t + (ah - vh) / 2;
    if (t && vw > aw) ox = Math.max(inset.l + aw - vw, Math.min(inset.l, inset.l + aw / 2 - t.x * s));
    if (t && vh > ah) oy = Math.max(inset.t + ah - vh, Math.min(inset.t, inset.t + ah / 2 - t.y * s));
    if (!dt || Math.abs(s - view.scale) > 1e-6) { view.scale = s; view.ox = ox; view.oy = oy; return; }
    const k = Math.min(1, dt * 7);                                          // glide after the tank (a teleport swoops across)
    view.ox += (ox - view.ox) * k; view.oy += (oy - view.oy) * k;
  }
  function cycleZoom() {
    if (zoomPref() === 0) { Store.setOpt('zoom', 0.8); zoomAll = false; }   // zoom set to ALL in Options: the button zooms to 80%
    else zoomAll = !zoomAll;
    Sfx.click && Sfx.click(); applyCam(0);
  }
  // the turret follows the finger: the world point under it, every frame (so it keeps pointing there while you drive)
  function fingerAim(t) { const s = sticks.aim; if (!s) return null; const w = toWorld(s.x, s.y); return Math.atan2(w.y - t.y, w.x - t.x); }
  const isTap = s => s.moved < 24 && performance.now() - s.t0 < 350;
  function drawFinger(s) {
    ctx.strokeStyle = 'rgba(255,230,140,0.9)'; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.arc(s.x, s.y, 16, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(s.x - 26, s.y); ctx.lineTo(s.x - 10, s.y); ctx.moveTo(s.x + 10, s.y); ctx.lineTo(s.x + 26, s.y);
    ctx.moveTo(s.x, s.y - 26); ctx.lineTo(s.x, s.y - 10); ctx.moveTo(s.x, s.y + 10); ctx.lineTo(s.x, s.y + 26); ctx.stroke();
  }
  function drawZoomBtn(r) {
    if (!touchDev() || (vs && vs.role === 'local')) return;
    roundBtn(r, 'rgba(20,40,70,0.85)');
    const cx = r.x + r.w * 0.42, cy = r.y + r.h * 0.4, rad = r.w * 0.17;
    ctx.strokeStyle = '#fff3cf'; ctx.lineWidth = Math.max(2, r.w * 0.06); ctx.lineCap = 'round';
    ctx.beginPath(); ctx.arc(cx, cy, rad, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx + rad * 0.75, cy + rad * 0.75); ctx.lineTo(cx + rad * 1.6, cy + rad * 1.6); ctx.stroke(); ctx.lineCap = 'butt';
    ctx.fillStyle = '#f0c25c'; ctx.font = font(r.w * 0.26); ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    ctx.fillText(zoomAmt() > 0 ? 'ZOOM' : 'ALL', r.x + r.w / 2, r.y + r.h - 2);
  }
  const toWorld = (sx, sy) => ({ x: (sx - view.ox) / view.scale, y: (sy - view.oy) / view.scale });

  function draw() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#0b1a2c'; ctx.fillRect(0, 0, view.cw, view.ch);
    if (state === 'idle') return;
    ctx.save();
    const sh = shake > 0 ? shake : 0;
    ctx.translate(view.ox + (Math.random() - 0.5) * sh, view.oy + (Math.random() - 0.5) * sh);
    ctx.scale(view.scale, view.scale);
    drawFloor();
    if (level.colors && level.colors.floor) tintFill(ctx, level.colors.floor, W, H);
    drawWallsTinted();
    if (state === 'edit' && level.flags) for (const [k, fx, fy] of level.flags) drawFlag(fx * TILE, fy * TILE, FLAG_COLORS[k][1], k + 1, 1);   // a Local map's spawn flags
    if (vs) for (const P of vs.players) drawFlag(P.spawn[0], P.spawn[1], P.color, P.idx + 1, 0.35);
    drawTracks();
    for (const i of ices) drawIce(i);
    for (const m of xmarks) drawX(m);
    for (const m of mines) drawMine(m);
    for (const b of bits) { ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(b.rot); ctx.globalAlpha = 1 - b.age / b.life; ctx.fillStyle = b.col || '#b07a3a'; ctx.fillRect(-b.w / 2, -b.h / 2, b.w, b.h); ctx.restore(); }
    if (vs) { if (state === 'playing') for (const P of vs.players) if (isLocal(P.tank) && P.tank.alive) drawAim(P.tank); }
    else if (player.alive && state === 'playing') drawAim(player);
    drawCouplings();
    for (const t of tanks) if (t.alive) {
      if (state === 'edit' && !tankVisible(t)) { ctx.globalAlpha = 0.45; drawTank(t, true); ctx.globalAlpha = 1; }
      else if (vs) drawVsTank(t);
      else drawTank(t);
    }
    if (level.floor === 'grave') drawNight();
    if (vs) drawNames();
    for (const s of shells) drawShell(s);
    drawBeams();
    for (const p of smoke) { ctx.globalAlpha = Math.max(0, 1 - p.age / p.life) * 0.85; ctx.fillStyle = p.rgba + '1)'; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill(); }
    ctx.globalAlpha = 1;
    for (const r of rings) { const k = r.age / r.life; ctx.globalAlpha = 1 - k; ctx.lineWidth = 6 * (1 - k) + 1; ctx.strokeStyle = '#ffd36a'; ctx.beginPath(); ctx.arc(r.x, r.y, r.r * (0.3 + 0.7 * k), 0, Math.PI * 2); ctx.stroke(); }
    ctx.globalAlpha = 1;
    if (state === 'edit') drawEditGrid();
    ctx.restore();
    if (flashAlpha > 0) { ctx.fillStyle = `rgba(255,240,200,${flashAlpha})`; ctx.fillRect(0, 0, view.cw, view.ch); }
    if (state !== 'edit') drawHud();
  }
  function drawEditGrid() {
    ctx.strokeStyle = 'rgba(255,255,255,0.13)'; ctx.lineWidth = 1; ctx.beginPath();
    for (let c = 1; c < COLS; c++) { ctx.moveTo(c * TILE, TILE); ctx.lineTo(c * TILE, H - TILE); }
    for (let r = 1; r < ROWS; r++) { ctx.moveTo(TILE, r * TILE); ctx.lineTo(W - TILE, r * TILE); }
    ctx.stroke();
    if (editHover && editHover.c > 0 && editHover.r > 0 && editHover.c < COLS - 1 && editHover.r < ROWS - 1) {
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 3; ctx.strokeRect(editHover.c * TILE + 1.5, editHover.r * TILE + 1.5, TILE - 3, TILE - 3);
    }
  }
  // Level creator colours: any piece of the map can be recoloured. The floor is tinted in place; each recoloured kind of
  // square is drawn on its own layer, tinted, and laid on top, so the texture and shading of the map style stay.
  const TINT_KEY = v => v === SOLID ? 'wall' : v === CRATE ? 'crate' : v === WHITE ? 'hole' : v === WATER ? 'water' : v === LAVA ? 'lava' : v === ACID ? 'acid' :
    v === TAR ? 'tar' : v === OIL ? 'oil' : v === TELE ? 'tele' : (v === PLATFORM || v === RAMP) ? 'platform' : null;
  let layerCv = null, maskCv = null;
  function tintFill(g, col, w, h) {
    const n = parseInt(String(col).slice(1), 16); if (isNaN(n)) return;
    const L = (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
    g.save(); g.fillStyle = col;
    g.globalCompositeOperation = 'color'; g.fillRect(0, 0, w, h);
    if (L < 0.4) { g.globalCompositeOperation = 'multiply'; g.globalAlpha = Math.min(0.85, (0.4 - L) * 2.2); g.fillRect(0, 0, w, h); }
    else if (L > 0.55) { g.globalCompositeOperation = 'screen'; g.globalAlpha = Math.min(0.85, (L - 0.55) * 2.6); g.fillRect(0, 0, w, h); }
    g.restore();
  }
  function drawWallsTinted() {
    const cols = level.colors || {}, keys = Object.keys(cols).filter(k => k !== 'floor' && cols[k]);
    if (!keys.length) return drawWalls();
    drawWalls(v => !keys.includes(TINT_KEY(v)));
    if (!layerCv) { layerCv = document.createElement('canvas'); maskCv = document.createElement('canvas'); }
    if (layerCv.width !== canvas.width || layerCv.height !== canvas.height) { layerCv.width = maskCv.width = canvas.width; layerCv.height = maskCv.height = canvas.height; }
    const main = ctx, tf = ctx.getTransform(), g = layerCv.getContext('2d'), m = maskCv.getContext('2d'), w = layerCv.width, h = layerCv.height;
    for (const k of keys) {
      g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, w, h); g.setTransform(tf);
      ctx = g; try { drawWalls(v => TINT_KEY(v) === k); } finally { ctx = main; }
      g.setTransform(1, 0, 0, 1, 0, 0);
      m.setTransform(1, 0, 0, 1, 0, 0); m.clearRect(0, 0, w, h); m.drawImage(layerCv, 0, 0);
      tintFill(g, cols[k], w, h);
      g.globalCompositeOperation = 'destination-in'; g.drawImage(maskCv, 0, 0); g.globalCompositeOperation = 'source-over';
      ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(layerCv, 0, 0); ctx.restore();
    }
  }
  function drawIce(i) {
    const k = 1 - i.age / i.life, x = i.c * TILE, y = i.r * TILE;
    ctx.globalAlpha = Math.min(1, k * 1.5) * 0.75;
    ctx.fillStyle = '#bfeaff'; ctx.fillRect(x + 2, y + 2, TILE - 4, TILE - 4);
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2; ctx.beginPath();
    ctx.moveTo(x + 8, y + 10); ctx.lineTo(x + 18, y + 20); ctx.lineTo(x + 30, y + 12); ctx.moveTo(x + 14, y + 30); ctx.lineTo(x + 26, y + 26); ctx.stroke();
    ctx.globalAlpha = 1;
  }
  function drawCouplings() {
    ctx.strokeStyle = '#2a2a30'; ctx.lineWidth = 5; ctx.lineCap = 'round';
    for (const e of tanks) if (e.alive && e.cars && e.cars.length) { ctx.beginPath(); ctx.moveTo(e.x, e.y); for (const c of e.cars) ctx.lineTo(c.x, c.y); ctx.stroke(); }
  }
  function drawBeams() {
    for (const t of tanks) {
      const warn = t.alive && !(t.beamT > 0) && (t.warnT > 0 || (t.ai && t.ai.warn > 0));
      if (warn) {
        const a = t.turret, x0 = t.x + Math.cos(a) * (t.r + 16), y0 = t.y + Math.sin(a) * (t.r + 16), L = (W + H) * 2;
        ctx.save(); ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.clip();
        ctx.strokeStyle = Math.floor(clock * 14) % 2 ? 'rgba(255,20,70,0.95)' : 'rgba(255,90,140,0.85)'; ctx.lineWidth = 3.5; ctx.setLineDash([12, 7]);
        ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x0 + Math.cos(a) * L, y0 + Math.sin(a) * L); ctx.stroke(); ctx.restore();
        continue;
      }
      if (!t.alive || !(t.beamT > 0)) continue;
      const a = t.turret, x0 = t.x + Math.cos(a) * (t.r + 16), y0 = t.y + Math.sin(a) * (t.r + 16), L = (W + H) * 2, x1 = x0 + Math.cos(a) * L, y1 = y0 + Math.sin(a) * L;
      const f = 0.8 + 0.2 * Math.sin(clock * 60);
      ctx.save(); ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.clip(); ctx.lineCap = 'round';
      for (const [col, w] of [['rgba(255,40,120,0.25)', 24 * f], ['rgba(255,70,150,0.75)', 11], ['#ffffff', 4]]) { ctx.strokeStyle = col; ctx.lineWidth = w; ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke(); }
      ctx.restore();
    }
  }
  // Graveyard: night. A dark blue wash over the ground and the tanks, lighter round the player like a lantern;
  // shells, fire and explosions are drawn after it so they glow.
  function drawNight() {
    ctx.fillStyle = 'rgba(10,8,46,0.36)'; ctx.fillRect(0, 0, W, H);
    const g = ctx.createRadialGradient(player.x, player.y, TILE * 3, player.x, player.y, TILE * 15);
    g.addColorStop(0, 'rgba(0,0,18,0)'); g.addColorStop(1, 'rgba(0,0,18,0.38)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  }
  // A tombstone (the graveyard's breakable block): a round-topped slab with a cross, on a low plinth.
  function drawTomb(x, y) {
    ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.beginPath(); ctx.ellipse(x + 23, y + 35, 16, 5, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#4a4c58'; ctx.fillRect(x + 5, y + 31, 30, 6);
    ctx.fillStyle = '#5d606c'; ctx.beginPath(); ctx.moveTo(x + 8, y + 32); ctx.lineTo(x + 8, y + 16); ctx.arc(x + 20, y + 16, 12, Math.PI, 0); ctx.lineTo(x + 32, y + 32); ctx.fill();
    ctx.fillStyle = '#8f93a0'; ctx.beginPath(); ctx.moveTo(x + 10, y + 32); ctx.lineTo(x + 10, y + 16); ctx.arc(x + 20, y + 16, 10, Math.PI, 0); ctx.lineTo(x + 30, y + 32); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.18)'; ctx.beginPath(); ctx.arc(x + 20, y + 16, 10, Math.PI, Math.PI * 1.5); ctx.lineTo(x + 20, y + 16); ctx.fill();
    ctx.strokeStyle = '#4a4c58'; ctx.lineWidth = 2.5; ctx.lineCap = 'butt'; ctx.beginPath(); ctx.moveTo(x + 20, y + 11); ctx.lineTo(x + 20, y + 26); ctx.moveTo(x + 15, y + 16); ctx.lineTo(x + 25, y + 16); ctx.stroke();
  }
  function drawFloor() {
    if (level.floor === 'grass') return drawGrass();
    if (level.floor === 'snow') return drawSnow();
    if (level.floor === 'sand') return drawSand();
    if (level.floor === 'beach') return drawSand('#efd9a6', 'rgba(170,130,70,0.22)');
    if (level.floor === 'volcano') return drawRock();
    if (level.floor === 'factory') return drawMetal();
    if (level.floor === 'battle') return drawBattle();
    if (level.floor === 'grave') return drawGrass('#5b3f80', '#3d2860');
    ctx.fillStyle = '#d9c7a3'; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = 'rgba(90,70,40,0.18)'; ctx.lineWidth = 1;
    for (let c = 0; c <= COLS; c++) { ctx.beginPath(); ctx.moveTo(c * TILE, 0); ctx.lineTo(c * TILE, H); ctx.stroke(); }
    for (let r = 0; r <= ROWS; r++) { ctx.beginPath(); ctx.moveTo(0, r * TILE); ctx.lineTo(W, r * TILE); ctx.stroke(); }
  }
  // Outdoors: a lawn with faint mown stripes and tufts (fixed per square so it does not flicker).
  // Battlefield: dead yellow-brown grass, with scorch marks and churned mud here and there (fixed per square).
  function drawBattle() {
    drawGrass('#a8924a', '#7c6a2c');
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      const h = ((c * 83492791) ^ (r * 2971215073)) >>> 0, x = c * TILE, y = r * TILE;
      if (h % 9 === 0) { ctx.fillStyle = 'rgba(60,45,20,0.28)'; ctx.beginPath(); ctx.ellipse(x + 12 + (h >> 4) % 16, y + 12 + (h >> 9) % 16, 13, 9, (h >> 13) % 6, 0, Math.PI * 2); ctx.fill(); }
      else if (h % 14 === 1) {
        const cx = x + 14 + (h >> 5) % 12, cy = y + 14 + (h >> 10) % 12;
        ctx.fillStyle = 'rgba(25,20,12,0.4)'; ctx.beginPath(); ctx.arc(cx, cy, 11, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = 'rgba(15,12,8,0.45)'; ctx.beginPath(); ctx.arc(cx + 1, cy + 1, 6, 0, Math.PI * 2); ctx.fill();
      }
    }
  }
  function drawGrass(base = '#6aa84f', tuft = '#4f8a38') {
    ctx.fillStyle = base; ctx.fillRect(0, 0, W, H);
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      const h = ((c * 73856093) ^ (r * 19349663)) >>> 0, x = c * TILE, y = r * TILE;
      ctx.fillStyle = (c + r) % 2 ? 'rgba(0,0,0,0.045)' : 'rgba(255,255,255,0.035)'; ctx.fillRect(x, y, TILE, TILE);
      ctx.strokeStyle = tuft; ctx.lineWidth = 2; ctx.lineCap = 'round';
      for (let k = 0; k < 3; k++) {
        const gx = x + 6 + ((h >> (k * 5)) & 31) * (TILE - 12) / 31, gy = y + 8 + ((h >> (k * 5 + 11)) & 31) * (TILE - 14) / 31;
        ctx.beginPath(); ctx.moveTo(gx, gy + 4); ctx.lineTo(gx - 3, gy - 3); ctx.moveTo(gx, gy + 4); ctx.lineTo(gx + 3, gy - 4); ctx.stroke();
      }
    }
  }
  // Snowy mountain: bare rock with cracks, and a scatter of squares buried in snow (fixed per square).
  // Volcanic island: reddish-brown rock with cracks, some of them glowing.
  function drawRock() {
    ctx.fillStyle = '#6b3b2b'; ctx.fillRect(0, 0, W, H);
    ctx.lineCap = 'round';
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      const h = ((c * 73856093) ^ (r * 19349663)) >>> 0, x = c * TILE, y = r * TILE;
      ctx.fillStyle = (c + r) % 2 ? 'rgba(0,0,0,0.07)' : 'rgba(255,200,150,0.04)'; ctx.fillRect(x, y, TILE, TILE);
      const glow = (h % 9) === 0;
      ctx.strokeStyle = glow ? 'rgba(255,120,40,0.55)' : 'rgba(30,12,8,0.4)'; ctx.lineWidth = glow ? 2 : 1.5;
      const cx = x + 6 + ((h >> 3) & 31) * (TILE - 12) / 31, cy = y + 6 + ((h >> 9) & 31) * (TILE - 12) / 31, dx = ((h >> 15) & 7) - 3, dy = ((h >> 18) & 7) - 3;
      ctx.beginPath(); ctx.moveTo(cx - dx * 2, cy - dy * 2); ctx.lineTo(cx, cy); ctx.lineTo(cx + dy * 2, cy + dx * 1.5); ctx.stroke();
    }
  }
  // Factory: grey steel plates with seams, rivets and the odd scratch; a few squares have a hazard-striped edge.
  function drawMetal() {
    ctx.fillStyle = '#868b93'; ctx.fillRect(0, 0, W, H);
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      const h = ((c * 73856093) ^ (r * 19349663)) >>> 0, x = c * TILE, y = r * TILE;
      ctx.fillStyle = (h & 3) === 0 ? 'rgba(255,255,255,0.05)' : (h & 3) === 1 ? 'rgba(0,0,0,0.07)' : 'rgba(0,0,0,0.025)'; ctx.fillRect(x, y, TILE, TILE);
      ctx.strokeStyle = 'rgba(30,32,38,0.5)'; ctx.lineWidth = 1; ctx.strokeRect(x + 0.5, y + 0.5, TILE - 1, TILE - 1);                     // plate seams
      ctx.fillStyle = 'rgba(40,42,48,0.6)';
      for (const [px, py] of [[5, 5], [TILE - 5, 5], [5, TILE - 5], [TILE - 5, TILE - 5]]) { ctx.beginPath(); ctx.arc(x + px, y + py, 1.6, 0, Math.PI * 2); ctx.fill(); }   // rivets
      if (h % 7 === 0) { ctx.strokeStyle = 'rgba(255,255,255,0.14)'; const sx = x + 8 + ((h >> 4) & 15), sy = y + 8 + ((h >> 9) & 15); ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx + 10, sy + 3); ctx.stroke(); }   // a scratch
      if (h % 11 === 0) for (let k = 0; k < 4; k++) { ctx.fillStyle = k & 1 ? '#1a1a1e' : '#d8b21e'; ctx.fillRect(x + 4 + k * 8, y + TILE - 6, 8, 3); }   // hazard stripe
    }
  }
  // A barrel stands in for a crate in the factory: blue is just a barrel, green floods acid when it breaks, black floods tar.
  function drawBarrel(x, y, kind) {
    const k = kind === 2 ? ['#2f9a2a', '#1a5a16', '#8be070'] : kind === 3 ? ['#1d1d22', '#070709', '#56565f'] : ['#2f63c8', '#183a80', '#86aef2'];
    ctx.fillStyle = 'rgba(0,0,0,0.22)'; ctx.beginPath(); ctx.ellipse(x + TILE / 2 + 2, y + TILE - 5, 15, 5, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = k[1]; rr(x + 6, y + 8, TILE - 12, TILE - 11, 5); ctx.fill();                       // the drum
    ctx.fillStyle = k[0]; rr(x + 8, y + 9, TILE - 16, TILE - 14, 4); ctx.fill();
    ctx.fillStyle = k[2]; ctx.fillRect(x + 10, y + 12, 3, TILE - 20);                                   // a shine down one side
    ctx.fillStyle = '#a3a7b0'; ctx.fillRect(x + 6, y + 15, TILE - 12, 3); ctx.fillRect(x + 6, y + 26, TILE - 12, 3);   // two steel hoops
    ctx.fillStyle = k[2]; ctx.beginPath(); ctx.ellipse(x + TILE / 2, y + 8, TILE / 2 - 6, 4, 0, 0, Math.PI * 2); ctx.fill();   // the lid
    ctx.fillStyle = k[1]; ctx.beginPath(); ctx.arc(x + TILE / 2 + 5, y + 8, 2, 0, Math.PI * 2); ctx.fill();   // the bung
    if (kind === 2) { ctx.fillStyle = '#eaffd0'; ctx.beginPath(); ctx.moveTo(x + 23, y + 18); ctx.lineTo(x + 27, y + 26); ctx.lineTo(x + 19, y + 26); ctx.closePath(); ctx.fill(); ctx.fillStyle = k[0]; ctx.fillRect(x + 22, y + 21, 2, 3); }   // acid warning
    if (kind === 3) { ctx.fillStyle = '#d8b21e'; ctx.fillRect(x + 8, y + 20, TILE - 16, 3); }   // tar stripe
  }
  // Acid: a green lava. Same churn, same white-hot core marking the deadly middle, dark edges where it meets the floor.
  function drawAcid(c, r) {
    const x = c * TILE, y = r * TILE, h = ((c * 73856093) ^ (r * 19349663)) >>> 0, tm = performance.now() / 1000;
    ctx.fillStyle = (c + r) % 2 ? '#62cc24' : '#6fd62c'; ctx.fillRect(x, y, TILE, TILE);
    ctx.fillStyle = 'rgba(20,80,10,0.35)';
    for (let k = 0; k < 2; k++) { const bx = x + 6 + ((h >> (k * 6)) & 15) + Math.sin(tm * 0.9 + k + (h & 7)) * 3, by = y + 6 + ((h >> (k * 6 + 12)) & 15); ctx.beginPath(); ctx.ellipse(bx, by, 6, 4, 0, 0, Math.PI * 2); ctx.fill(); }
    const g = ctx.createRadialGradient(x + TILE / 2, y + TILE / 2, 1, x + TILE / 2, y + TILE / 2, LAVA_R + 4 + Math.sin(tm * 3 + (h & 15)) * 1.5);
    g.addColorStop(0, 'rgba(245,255,210,0.95)'); g.addColorStop(0.6, 'rgba(200,255,120,0.6)'); g.addColorStop(1, 'rgba(150,240,80,0)');
    ctx.fillStyle = g; ctx.fillRect(x, y, TILE, TILE);
    ctx.fillStyle = '#1e4a12';
    if (tileAt(c, r - 1) !== ACID) ctx.fillRect(x, y, TILE, 3);
    if (tileAt(c, r + 1) !== ACID) ctx.fillRect(x, y + TILE - 3, TILE, 3);
    if (tileAt(c - 1, r) !== ACID) ctx.fillRect(x, y, 3, TILE);
    if (tileAt(c + 1, r) !== ACID) ctx.fillRect(x + TILE - 3, y, 3, TILE);
  }
  // Tar: a black, glossy, sticky pool. Every tank drives through it at half speed.
  function drawTar(c, r) {
    const x = c * TILE, y = r * TILE, h = ((c * 73856093) ^ (r * 19349663)) >>> 0;
    ctx.fillStyle = (c + r) % 2 ? '#17161b' : '#1c1b21'; ctx.fillRect(x, y, TILE, TILE);
    ctx.fillStyle = 'rgba(90,90,110,0.35)';
    for (let k = 0; k < 2; k++) { const bx = x + 8 + ((h >> (k * 5)) & 15), by = y + 8 + ((h >> (k * 5 + 10)) & 15); ctx.beginPath(); ctx.ellipse(bx, by, 7, 3, -0.4, 0, Math.PI * 2); ctx.fill(); }
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    if (tileAt(c, r - 1) !== TAR) ctx.fillRect(x, y, TILE, 3);
    if (tileAt(c, r + 1) !== TAR) ctx.fillRect(x, y + TILE - 3, TILE, 3);
    if (tileAt(c - 1, r) !== TAR) ctx.fillRect(x, y, 3, TILE);
    if (tileAt(c + 1, r) !== TAR) ctx.fillRect(x + TILE - 3, y, 3, TILE);
  }
  // Oil: a yellow slick left by a dead oil bomber. Enemies drive through it as usual, the player slows by 40%.
  function drawOil(c, r) {
    const x = c * TILE, y = r * TILE, h = ((c * 73856093) ^ (r * 19349663)) >>> 0;
    ctx.fillStyle = (c + r) % 2 ? '#e3bd17' : '#ecc722'; ctx.fillRect(x, y, TILE, TILE);
    ctx.fillStyle = 'rgba(160,115,0,0.35)';
    for (let k = 0; k < 2; k++) { const bx = x + 8 + ((h >> (k * 5)) & 15), by = y + 8 + ((h >> (k * 5 + 10)) & 15); ctx.beginPath(); ctx.ellipse(bx, by, 7, 4, 0.5, 0, Math.PI * 2); ctx.fill(); }
    ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.fillRect(x + 6 + ((h >> 3) & 7), y + 6 + ((h >> 7) & 7), 9, 2);
    ctx.fillStyle = '#a8850a';
    if (tileAt(c, r - 1) !== OIL) ctx.fillRect(x, y, TILE, 3);
    if (tileAt(c, r + 1) !== OIL) ctx.fillRect(x, y + TILE - 3, TILE, 3);
    if (tileAt(c - 1, r) !== OIL) ctx.fillRect(x, y, 3, TILE);
    if (tileAt(c + 1, r) !== OIL) ctx.fillRect(x + TILE - 3, y, 3, TILE);
  }
  // Lava: bright, slowly churning, a dark crust along any edge that meets rock, and a white-hot core marking the deadly middle.
  function drawLava(c, r) {
    const x = c * TILE, y = r * TILE, h = ((c * 73856093) ^ (r * 19349663)) >>> 0, tm = performance.now() / 1000;
    ctx.fillStyle = (c + r) % 2 ? '#f0641c' : '#f76f22'; ctx.fillRect(x, y, TILE, TILE);
    ctx.fillStyle = 'rgba(120,20,10,0.35)';
    for (let k = 0; k < 2; k++) { const bx = x + 6 + ((h >> (k * 6)) & 15) + Math.sin(tm * 0.7 + k + (h & 7)) * 3, by = y + 6 + ((h >> (k * 6 + 12)) & 15); ctx.beginPath(); ctx.ellipse(bx, by, 7, 4, 0, 0, Math.PI * 2); ctx.fill(); }
    const g = ctx.createRadialGradient(x + TILE / 2, y + TILE / 2, 1, x + TILE / 2, y + TILE / 2, LAVA_R + 4 + Math.sin(tm * 3 + (h & 15)) * 1.5);
    g.addColorStop(0, 'rgba(255,250,200,0.95)'); g.addColorStop(0.6, 'rgba(255,200,80,0.6)'); g.addColorStop(1, 'rgba(255,160,40,0)');
    ctx.fillStyle = g; ctx.fillRect(x, y, TILE, TILE);
    ctx.fillStyle = '#3a1810';
    if (tileAt(c, r - 1) !== LAVA) ctx.fillRect(x, y, TILE, 3);
    if (tileAt(c, r + 1) !== LAVA) ctx.fillRect(x, y + TILE - 3, TILE, 3);
    if (tileAt(c - 1, r) !== LAVA) ctx.fillRect(x, y, 3, TILE);
    if (tileAt(c + 1, r) !== LAVA) ctx.fillRect(x + TILE - 3, y, 3, TILE);
  }
  // A heap of dirt stands in for a crate on the volcano: shells bounce off it, mines blow it apart.
  function drawDirt(x, y) {
    ctx.fillStyle = 'rgba(0,0,0,0.2)'; ctx.beginPath(); ctx.ellipse(x + TILE / 2 + 2, y + TILE - 7, 16, 5, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#6e4a24'; ctx.beginPath(); ctx.moveTo(x + 3, y + TILE - 5); ctx.quadraticCurveTo(x + 8, y + 10, x + TILE / 2, y + 6); ctx.quadraticCurveTo(x + TILE - 8, y + 10, x + TILE - 3, y + TILE - 5); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#8a6030'; ctx.beginPath(); ctx.moveTo(x + 9, y + TILE - 8); ctx.quadraticCurveTo(x + 12, y + 14, x + TILE / 2, y + 10); ctx.quadraticCurveTo(x + TILE - 14, y + 13, x + TILE - 11, y + TILE - 9); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#4a2f14'; for (const [px, py, s] of [[12, 22, 4], [22, 17, 3], [27, 26, 4], [17, 29, 3], [8, 29, 3]]) ctx.fillRect(x + px, y + py, s, s);
  }
  function drawSnow() {
    ctx.fillStyle = '#7d7a76'; ctx.fillRect(0, 0, W, H);
    ctx.lineCap = 'round';
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      const h = ((c * 73856093) ^ (r * 19349663)) >>> 0, x = c * TILE, y = r * TILE;
      if (h % 100 < 42) {                                                       // a snow-covered square
        ctx.fillStyle = (h >> 8) & 1 ? '#eef2f7' : '#e4e9f0'; ctx.fillRect(x, y, TILE, TILE);
        ctx.fillStyle = 'rgba(255,255,255,0.8)';
        for (let k = 0; k < 2; k++) { const sx = x + 5 + ((h >> (k * 6)) & 31), sy = y + 5 + ((h >> (k * 6 + 13)) & 31); ctx.fillRect(sx, sy, 2, 2); }
      } else {
        ctx.fillStyle = (c + r) % 2 ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.04)'; ctx.fillRect(x, y, TILE, TILE);
        ctx.strokeStyle = 'rgba(40,36,32,0.35)'; ctx.lineWidth = 1.5;
        const cx = x + 6 + ((h >> 3) & 31) * (TILE - 12) / 31, cy = y + 6 + ((h >> 9) & 31) * (TILE - 12) / 31, dx = ((h >> 15) & 7) - 3, dy = ((h >> 18) & 7) - 3;
        ctx.beginPath(); ctx.moveTo(cx - dx * 2, cy - dy * 2); ctx.lineTo(cx, cy); ctx.lineTo(cx + dy * 2, cy + dx * 1.5); ctx.stroke();
      }
    }
  }
  // Desert: warm sand with wind ripples (fixed per square).
  function drawSand(base = '#e4c47e', ripple = 'rgba(150,105,45,0.28)') {
    ctx.fillStyle = base; ctx.fillRect(0, 0, W, H);
    ctx.lineCap = 'round'; ctx.lineWidth = 1.5;
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      const h = ((c * 73856093) ^ (r * 19349663)) >>> 0, x = c * TILE, y = r * TILE;
      ctx.fillStyle = (c + r) % 2 ? 'rgba(120,80,20,0.05)' : 'rgba(255,255,255,0.05)'; ctx.fillRect(x, y, TILE, TILE);
      ctx.strokeStyle = ripple;
      for (let k = 0; k < 2; k++) {
        const rx = x + 4 + ((h >> (k * 7)) & 15), ry = y + 8 + ((h >> (k * 7 + 4)) & 15) + k * 10, len = 12 + ((h >> (k * 3 + 20)) & 7);
        ctx.beginPath(); ctx.moveTo(rx, ry); ctx.quadraticCurveTo(rx + len / 2, ry - 4, rx + len, ry); ctx.stroke();
      }
    }
  }
  // A cactus stands in for a crate on the sand: shells bounce off it, mines blow it up.
  function drawCactus(x, y) {
    ctx.fillStyle = 'rgba(0,0,0,0.15)'; ctx.beginPath(); ctx.ellipse(x + TILE / 2 + 3, y + TILE - 6, 13, 5, 0, 0, Math.PI * 2); ctx.fill();
    const arm = (ax, ay, w, hh) => { ctx.fillStyle = '#3f8a3a'; ctx.beginPath(); ctx.roundRect(ax, ay, w, hh, 4); ctx.fill(); };
    arm(x + 5, y + 16, 6, 10); arm(x + 5, y + 16, 14, 6);                          // left arm
    arm(x + TILE - 11, y + 10, 6, 12); arm(x + TILE - 19, y + 10, 14, 6);           // right arm
    ctx.fillStyle = '#4e9f45'; ctx.beginPath(); ctx.roundRect(x + 14, y + 5, 12, TILE - 10, 6); ctx.fill();
    ctx.fillStyle = '#6cbf5c'; ctx.fillRect(x + 17, y + 8, 2, TILE - 16);
    ctx.fillStyle = '#2f6a2c'; ctx.fillRect(x + 22, y + 8, 2, TILE - 16);
    ctx.fillStyle = '#e8f0c0'; for (let k = 0; k < 4; k++) { ctx.fillRect(x + 15, y + 9 + k * 7, 1.5, 1.5); ctx.fillRect(x + 24, y + 12 + k * 7, 1.5, 1.5); }
  }
  const WALL_COLS = { sand: ['#5a3416', '#8a5a2c', '#a06a36', '#6e4420'],       // sandstone in the desert
                      volcano: ['#070708', '#1f1f24', '#2f2f36', '#141417'],   // black stone on the volcano
                      factory: ['#22252b', '#4a4f58', '#646b76', '#33373e'],
                      battle: ['#35372a', '#66684f', '#7f8163', '#484a38'],
                      grave: ['#1c1828', '#403a56', '#585072', '#2b2640'] };   // dark crypt stone in the graveyard  // olive bunker concrete on the battlefield  // steel panels in the factory
  function drawWalls(only) {
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      const v = map[r * COLS + c]; if (v === FLOOR || (only && !only(v))) continue;
      const x = c * TILE, y = r * TILE;
      if (v === SOLID) {
        const k = WALL_COLS[level.floor] || ['#4a4a55', '#6a6a78', '#7d7d8c', '#56566a'];
        ctx.fillStyle = k[0]; ctx.fillRect(x, y, TILE, TILE);
        ctx.fillStyle = k[1]; ctx.fillRect(x + 3, y + 3, TILE - 6, TILE - 6);
        ctx.fillStyle = k[2]; ctx.fillRect(x + 3, y + 3, TILE - 6, 5);
        ctx.fillStyle = k[3]; ctx.fillRect(x + 3, y + TILE - 9, TILE - 6, 6);
      } else if (v === PLATFORM || v === RAMP) {
        drawPlatform(c, r, v);
      } else if (v === WATER) {
        drawWater(c, r);
      } else if (v === LAVA) {
        drawLava(c, r);
      } else if (v === ACID) {
        drawAcid(c, r);
      } else if (v === TAR) {
        drawTar(c, r);
      } else if (v === OIL) {
        drawOil(c, r);
      } else if (v === TELE) {
        drawTele(c, r);
      } else if (v === WHITE) {                                                // a hole, like the Wii: shells fly over it, tanks cannot drive in
        ctx.fillStyle = '#1b1713'; ctx.fillRect(x, y, TILE, TILE);
        const edge = (dc, dr, x0, y0, x1, y1, col, depth) => {                  // shade inward from any side that meets ground
          if (tileAt(c + dc, r + dr) === WHITE) return;
          const g = ctx.createLinearGradient(x0, y0, x1, y1); g.addColorStop(0, col); g.addColorStop(1, 'rgba(0,0,0,0)');
          ctx.fillStyle = g; ctx.fillRect(x, y, TILE, TILE);
        };
        edge(0, -1, 0, y, 0, y + 14, 'rgba(0,0,0,0.75)');                        // near walls of the pit in shadow
        edge(-1, 0, x, 0, x + 14, 0, 'rgba(0,0,0,0.75)');
        edge(0, 1, 0, y + TILE, 0, y + TILE - 8, 'rgba(120,100,80,0.35)');       // far walls catch a little light
        edge(1, 0, x + TILE, 0, x + TILE - 8, 0, 'rgba(120,100,80,0.35)');
        ctx.strokeStyle = 'rgba(0,0,0,0.4)'; ctx.lineWidth = 2; ctx.beginPath();  // a cracked lip on the ground around it
        if (tileAt(c, r - 1) !== WHITE) { ctx.moveTo(x, y + 0.5); ctx.lineTo(x + TILE, y + 0.5); }
        if (tileAt(c - 1, r) !== WHITE) { ctx.moveTo(x + 0.5, y); ctx.lineTo(x + 0.5, y + TILE); }
        ctx.stroke();
      } else if (level.floor === 'sand') {
        drawCactus(x, y);
      } else if (level.floor === 'volcano') {
        drawDirt(x, y);
      } else if (level.floor === 'factory') {
        drawBarrel(x, y, barrels[r * COLS + c]);
      } else if (level.floor === 'grave') {
        drawTomb(x, y);
      } else {
        ctx.fillStyle = '#8a5a26'; ctx.fillRect(x, y, TILE, TILE);
        ctx.fillStyle = '#c48a44'; ctx.fillRect(x + 3, y + 3, TILE - 6, TILE - 6);
        ctx.strokeStyle = '#8a5a26'; ctx.lineWidth = 4; ctx.beginPath();
        ctx.moveTo(x + 5, y + 5); ctx.lineTo(x + TILE - 5, y + TILE - 5); ctx.moveTo(x + TILE - 5, y + 5); ctx.lineTo(x + 5, y + TILE - 5); ctx.stroke();
      }
    }
  }
  // Sea water: blue with drifting glints, foam along any edge that meets sand or rock.
  // Teleport liquid: a swirling purple pool.
  function drawTele(c, r) {
    const x = c * TILE, y = r * TILE, cx = x + TILE / 2, cy = y + TILE / 2, now = performance.now() / 1000;
    const g = ctx.createRadialGradient(cx, cy, 2, cx, cy, TILE * 0.7); g.addColorStop(0, '#d9a8ff'); g.addColorStop(0.5, '#8a3fe0'); g.addColorStop(1, '#4a1890');
    ctx.fillStyle = g; ctx.fillRect(x, y, TILE, TILE);
    ctx.strokeStyle = 'rgba(245,225,255,0.7)'; ctx.lineWidth = 2;
    for (let k = 0; k < 3; k++) { ctx.beginPath(); ctx.arc(cx, cy, 5 + k * 5, now * 2.5 + k * 2, now * 2.5 + k * 2 + 3.6); ctx.stroke(); }
    ctx.fillStyle = 'rgba(40,10,70,0.5)';
    if (tileAt(c, r - 1) !== TELE) ctx.fillRect(x, y, TILE, 3); if (tileAt(c - 1, r) !== TELE) ctx.fillRect(x, y, 3, TILE);
  }
  function drawWater(c, r) {
    const x = c * TILE, y = r * TILE, h = ((c * 73856093) ^ (r * 19349663)) >>> 0, tm = performance.now() / 1000;
    ctx.fillStyle = (c + r) % 2 ? '#3f8fd2' : '#4496d8'; ctx.fillRect(x, y, TILE, TILE);
    ctx.strokeStyle = 'rgba(255,255,255,0.45)'; ctx.lineWidth = 2; ctx.lineCap = 'round';
    for (let k = 0; k < 2; k++) {
      const ph = tm * 0.8 + (h >> (k * 9)) % 7, gx = x + 6 + (((h >> (k * 5)) & 15) + Math.sin(ph) * 4), gy = y + 10 + k * 18 + ((h >> (k * 4 + 11)) & 7);
      ctx.beginPath(); ctx.moveTo(gx, gy); ctx.lineTo(gx + 10 + Math.cos(ph) * 3, gy); ctx.stroke();
    }
    ctx.fillStyle = 'rgba(230,245,255,0.75)';
    if (tileAt(c, r - 1) !== WATER) ctx.fillRect(x, y, TILE, 4);
    if (tileAt(c, r + 1) !== WATER) ctx.fillRect(x, y + TILE - 4, TILE, 4);
    if (tileAt(c - 1, r) !== WATER) ctx.fillRect(x, y, 4, TILE);
    if (tileAt(c + 1, r) !== WATER) ctx.fillRect(x + TILE - 4, y, 4, TILE);
  }
  // Silver platforms: a raised slab with a dark cliff on every side that meets the ground; ramps slope up toward their platform.
  function drawPlatform(c, r, v) {
    const x = c * TILE, y = r * TILE, up = (cc, rr2) => { const t = tileAt(cc, rr2); return t === PLATFORM || t === RAMP; };
    if (v === RAMP) {
      const d = [[0, -1], [1, 0], [0, 1], [-1, 0]].find(([dc, dr]) => tileAt(c + dc, r + dr) === PLATFORM) || [0, -1];
      const mx = x + TILE / 2, my = y + TILE / 2;
      const g = ctx.createLinearGradient(mx - d[0] * TILE / 2, my - d[1] * TILE / 2, mx + d[0] * TILE / 2, my + d[1] * TILE / 2);
      g.addColorStop(0, level.floor === 'grass' ? '#7fb765' : level.floor === 'snow' ? '#8e8b87' : level.floor === 'sand' ? '#e4c47e' : level.floor === 'beach' ? '#efd9a6' : level.floor === 'volcano' ? '#6b3b2b' : level.floor === 'factory' ? '#868b93' : '#d9c7a3'); g.addColorStop(1, '#c3c7cf');
      ctx.fillStyle = g; ctx.fillRect(x, y, TILE, TILE);
      ctx.strokeStyle = 'rgba(50,50,60,0.4)'; ctx.lineWidth = 2; ctx.lineCap = 'round';
      for (let k = 0; k < 3; k++) {                                            // chevrons pointing up the slope
        const px = mx + d[0] * (k * 10 - 10), py = my + d[1] * (k * 10 - 10);
        ctx.beginPath(); ctx.moveTo(px - d[0] * 5 - d[1] * 9, py - d[1] * 5 + d[0] * 9); ctx.lineTo(px, py); ctx.lineTo(px - d[0] * 5 + d[1] * 9, py - d[1] * 5 - d[0] * 9); ctx.stroke();
      }
      ctx.fillStyle = '#5c5f69';                                              // the ramp's open sides are cliffs too
      for (const [dc, dr] of [[-d[1], d[0]], [d[1], -d[0]]]) if (!up(c + dc, r + dr)) ctx.fillRect(x + (dc > 0 ? TILE - 4 : 0), y + (dr > 0 ? TILE - 4 : 0), dc ? 4 : TILE, dr ? 4 : TILE);
      return;
    }
    ctx.fillStyle = '#9a9ea8'; ctx.fillRect(x, y, TILE, TILE);
    ctx.fillStyle = '#c3c7cf'; ctx.fillRect(x + 2, y + 2, TILE - 4, TILE - 4);
    ctx.fillStyle = '#d8dbe2'; ctx.fillRect(x + 2, y + 2, TILE - 4, 4);
    ctx.fillStyle = '#5c5f69';
    if (!up(c, r + 1)) ctx.fillRect(x, y + TILE - 7, TILE, 7);
    if (!up(c, r - 1)) ctx.fillRect(x, y, TILE, 3);
    if (!up(c - 1, r)) ctx.fillRect(x, y, 4, TILE);
    if (!up(c + 1, r)) ctx.fillRect(x + TILE - 4, y, 4, TILE);
  }
  function drawTracks() {
    for (const t of tracks) {
      const a = Math.max(0, 1 - t.age / 25) * 0.35; if (a <= 0) continue;
      ctx.save(); ctx.translate(t.x, t.y); ctx.rotate(t.a); ctx.fillStyle = `rgba(70,50,30,${a})`;
      ctx.fillRect(-3, -TANK_R * 0.95, 6, 5); ctx.fillRect(-3, TANK_R * 0.95 - 5, 6, 5); ctx.restore();
    }
  }
  function drawX(m) {
    if (m.alpha <= 0) return;
    ctx.save(); ctx.translate(m.x, m.y); ctx.globalAlpha = m.alpha; ctx.strokeStyle = m.color; ctx.lineWidth = 7; ctx.lineCap = 'round';
    const s = TANK_R * 0.8; ctx.beginPath(); ctx.moveTo(-s, -s); ctx.lineTo(s, s); ctx.moveTo(s, -s); ctx.lineTo(-s, s); ctx.stroke();
    ctx.restore();
  }
  function drawMine(m) {
    if (m.gray) {                                                            // a grey landmine: steel disc with prongs, no timer; its lamp only blinks once it is set off
      const red = m.lit && Math.floor(m.t * 12) % 2 === 0;
      ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.beginPath(); ctx.arc(m.x + 2, m.y + 3, MINE_R, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#3a3d44'; ctx.lineWidth = 4; ctx.lineCap = 'round'; ctx.beginPath();
      for (let k = 0; k < 6; k++) { const a = k * Math.PI / 3; ctx.moveTo(m.x + Math.cos(a) * (MINE_R - 3), m.y + Math.sin(a) * (MINE_R - 3)); ctx.lineTo(m.x + Math.cos(a) * (MINE_R + 3), m.y + Math.sin(a) * (MINE_R + 3)); }
      ctx.stroke();
      ctx.fillStyle = '#8b9099'; ctx.beginPath(); ctx.arc(m.x, m.y, MINE_R - 1, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#4b4f58'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(m.x, m.y, MINE_R - 2.5, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = '#b9bec8'; ctx.beginPath(); ctx.arc(m.x - 3, m.y - 4, 3.5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = red ? '#ff3b3b' : '#3a3d44'; ctx.beginPath(); ctx.arc(m.x, m.y, 4, 0, Math.PI * 2); ctx.fill();
      return;
    }
    const left = m.boomAt - m.t, hot = m.lit || left < 2, red = hot && Math.floor(m.t * 8) % 2 === 0;
    ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.beginPath(); ctx.arc(m.x + 2, m.y + 3, MINE_R, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = red ? '#ff3b3b' : '#f6d13a'; ctx.beginPath(); ctx.arc(m.x, m.y, MINE_R, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = red ? '#9a1515' : '#9a7a1a'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(m.x, m.y, MINE_R - 1.5, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = red ? '#ffb0b0' : '#fff1a8'; ctx.beginPath(); ctx.arc(m.x - MINE_R * 0.3, m.y - MINE_R * 0.3, MINE_R * 0.25, 0, Math.PI * 2); ctx.fill();
  }
  function drawShell(s) {
    if (s.homing || s.frost) {                                               // heat seeker: bright orange; frost: light blue
      ctx.save(); ctx.translate(s.x, s.y); ctx.rotate(Math.atan2(s.vy, s.vx));
      ctx.fillStyle = s.frost ? 'rgba(160,225,255,0.7)' : 'rgba(255,150,30,0.75)'; ctx.beginPath(); ctx.moveTo(-6, -3); ctx.lineTo(-20 - Math.random() * 8, 0); ctx.lineTo(-6, 3); ctx.fill();
      ctx.fillStyle = s.frost ? '#7fd8ff' : '#ff8c1a'; ctx.beginPath(); ctx.ellipse(0, 0, SHELL_R + 4, SHELL_R - 1, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = s.frost ? '#ffffff' : '#ffe08a'; ctx.beginPath(); ctx.ellipse(3, 0, SHELL_R - 1, SHELL_R - 3, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = s.frost ? '#3a8ac0' : '#a04a00'; ctx.fillRect(-8, -5, 4, 10);
      ctx.restore(); return;
    }
    if (s.flame) {                                                           // one cell of a flame wave: a flickering fireball that overlaps its neighbours
      const f = 0.85 + 0.25 * Math.sin(s.age * 40 + s.seed), g = ctx.createRadialGradient(s.x, s.y, 1, s.x, s.y, 17 * f);
      g.addColorStop(0, 'rgba(255,250,200,0.95)'); g.addColorStop(0.35, 'rgba(255,190,50,0.9)'); g.addColorStop(0.75, 'rgba(240,90,20,0.6)'); g.addColorStop(1, 'rgba(200,40,10,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(s.x, s.y, 17 * f, 0, Math.PI * 2); ctx.fill();
      return;
    }
    ctx.save(); ctx.translate(s.x, s.y); ctx.rotate(Math.atan2(s.vy, s.vx));
    if (s.rocket) {
      ctx.fillStyle = 'rgba(255,140,40,0.7)'; ctx.beginPath(); ctx.moveTo(-6, -3); ctx.lineTo(-20 - Math.random() * 8, 0); ctx.lineTo(-6, 3); ctx.fill();
      ctx.fillStyle = '#ff5a3a'; ctx.beginPath(); ctx.ellipse(0, 0, SHELL_R + 4, SHELL_R - 1, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#ffd6c0'; ctx.beginPath(); ctx.ellipse(3, 0, SHELL_R - 1, SHELL_R - 3, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#7a2a1a'; ctx.fillRect(-8, -5, 4, 10);
      ctx.restore(); return;
    }
    ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.fillRect(-22, -2, 18, 4);
    ctx.fillStyle = '#eee'; ctx.beginPath(); ctx.ellipse(0, 0, SHELL_R + 2, SHELL_R, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#888'; ctx.beginPath(); ctx.ellipse(-2, 0, SHELL_R - 1, SHELL_R - 2, 0, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
  function drawAim(t) {
    if (!Store.opts.aimLine) return;
    let x = t.x + Math.cos(t.turret) * (t.r + 10), y = t.y + Math.sin(t.turret) * (t.r + 10), vx = Math.cos(t.turret), vy = Math.sin(t.turret);
    let h = t.h === 2 ? liftAt(x, y) : t.h;
    ctx.save(); ctx.setLineDash([4, 8]); ctx.lineWidth = 2;
    for (let leg = 0; leg < 2; leg++) {
      ctx.strokeStyle = leg ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.6)';
      ctx.beginPath(); ctx.moveTo(x, y);
      let n = 0, max = leg ? 90 : 400;
      while (n++ < max && !circleHitsWall(x + vx * 3, y + vy * 3, SHELL_R, true, h)) { x += vx * 3; y += vy * 3; h = liftAt(x, y); }
      ctx.lineTo(x, y); ctx.stroke();
      if (n >= max) break;
      const hx = circleHitsWall(x + vx * 3, y, SHELL_R, true, h), hy = circleHitsWall(x, y + vy * 3, SHELL_R, true, h);
      if (hx || (!hx && !hy)) vx = -vx; if (hy || (!hx && !hy)) vy = -vy;
    }
    ctx.restore();
  }
  // the colour of one paintable part (custom tanks set them all; campaign tanks fall back to their body / dark / light)
  const part = (c, k) => c[k] || (k === 'tread' || k === 'tip' ? '#2a2a30' : k === 'pad' ? '#5a5a66' : k === 'edge' || k === 'barrel' ? c.dark : k === 'lamp' || k === 'ring' ? c.light : c.body);
  // force: draw even an invisible tank (the level creator); t.plain: no shadow, lights or overlays (the tank painter's pick map)
  function drawTank(t, force) {
    if (!force && !tankVisible(t)) return;                                     // the white tank: tracks, smoke and shells only
    const r = t.r, c = t.col, T = TOf(t);
    ctx.save(); ctx.translate(t.x, t.y);
    if (!t.plain) { ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.beginPath(); ctx.ellipse(t.h === 1 ? 6 : 3, t.h === 1 ? 7 : 4, r * 1.05, r * 0.95, 0, 0, Math.PI * 2); ctx.fill(); }
    if (T && T.model > 0) drawModel(t, T);                                     // a multiplayer tank model
    else {
    ctx.save(); ctx.rotate(t.hull);
    for (const side of [-1, 1]) {
      const ty = side * r * 0.72;
      ctx.fillStyle = part(c, 'tread'); rr(-r * 1.05, ty - r * 0.3, r * 2.1, r * 0.6, 4); ctx.fill();
      ctx.fillStyle = part(c, 'pad');
      const off = t.trackDist % 8;
      for (let i = -r; i < r; i += 8) { const px = i + off - 4; if (px > -r * 0.98 && px < r * 0.98 - 3) ctx.fillRect(px, ty - r * 0.22, 3, r * 0.44); }
    }
    ctx.fillStyle = part(c, 'edge'); rr(-r * 0.95, -r * 0.55, r * 1.9, r * 1.1, 6); ctx.fill();
    ctx.fillStyle = part(c, 'body'); rr(-r * 0.9, -r * 0.5, r * 1.8, r, 5); ctx.fill();
    ctx.fillStyle = part(c, 'lamp'); rr(r * 0.45, -r * 0.42, r * 0.38, r * 0.84, 3); ctx.fill();
    if (T && T.load) {                                                       // a load tank: a cargo crate strapped on, no turret
      ctx.fillStyle = part(c, 'barrel'); rr(-r * 0.62, -r * 0.5, r * 1.1, r, 3); ctx.fill();
      ctx.fillStyle = part(c, 'cap'); rr(-r * 0.52, -r * 0.4, r * 0.9, r * 0.8, 2); ctx.fill();
      ctx.strokeStyle = part(c, 'barrel'); ctx.lineWidth = 2.5; ctx.beginPath();
      ctx.moveTo(-r * 0.52, -r * 0.4); ctx.lineTo(r * 0.38, r * 0.4); ctx.moveTo(r * 0.38, -r * 0.4); ctx.lineTo(-r * 0.52, r * 0.4); ctx.stroke();
      if (T.charge && !t.train && !t.plain && (t.freeT < 3 ? Math.floor(clock * 8) % 2 === 0 : t.freeT <= 0)) { ctx.fillStyle = '#ff3030'; ctx.beginPath(); ctx.arc(-r * 0.07, 0, 4, 0, Math.PI * 2); ctx.fill(); }
    }
    ctx.restore();
    if (T && T.oil) {                                                          // the oil bomber: no gun, just a filler cap on a bare hull
      ctx.fillStyle = '#0a0a0c'; ctx.beginPath(); ctx.arc(0, 0, r * 0.4, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#d8b21e'; ctx.beginPath(); ctx.arc(0, 0, r * 0.22, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#5a4a08'; ctx.fillRect(-r * 0.18, -1.5, r * 0.36, 3);
    } else if (T && T.noTurret && !T.load) {                                   // a custom suicide tank: a cap and a fuse
      ctx.fillStyle = part(c, 'ring'); ctx.beginPath(); ctx.arc(0, 0, r * 0.42, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = part(c, 'cap'); ctx.beginPath(); ctx.arc(0, 0, r * 0.26, 0, Math.PI * 2); ctx.fill();
      if (!t.plain) { ctx.fillStyle = Math.floor(clock * 6) % 2 ? '#ff3030' : '#ffd040'; ctx.beginPath(); ctx.arc(0, 0, 3, 0, Math.PI * 2); ctx.fill(); }
    } else if (!(T && T.load)) {
      ctx.save(); ctx.rotate(t.turret);
      const rec = t.recoil * 6, long = T && T.laser ? 1.3 : 1;
      ctx.fillStyle = part(c, 'tip'); rr(r * 0.1 - rec, -4.5, r * 1.45 * long, 9, 3); ctx.fill();
      ctx.fillStyle = part(c, 'barrel'); rr(r * 0.1 - rec, -3.5, r * 1.4 * long, 7, 3); ctx.fill();
      if (T && T.flame) {                                                      // flame thrower: a flared nozzle with a pilot light
        ctx.fillStyle = part(c, 'tip'); ctx.beginPath(); ctx.moveTo(r * 1.2 - rec, -4.5); ctx.lineTo(r * 1.75 - rec, -9); ctx.lineTo(r * 1.75 - rec, 9); ctx.lineTo(r * 1.2 - rec, 4.5); ctx.fill();
        if (!t.plain) { ctx.fillStyle = '#ffd24a'; ctx.beginPath(); ctx.arc(r * 1.75 - rec, 0, 2.5 + Math.random(), 0, Math.PI * 2); ctx.fill(); }
      } else { ctx.fillStyle = part(c, 'tip'); rr(r * 1.3 * long - rec, -5, 8, 10, 2); ctx.fill(); }
      if (T && T.laser && !t.plain && (t.beamT > 0 || ((t.ai ? t.ai.charge : t.charge) < 1.5))) {   // the laser glows as it finishes charging
        const k = t.beamT > 0 ? 1 : 1 - Math.max(0, t.ai ? t.ai.charge : t.charge) / 1.5;
        ctx.fillStyle = `rgba(255,80,160,${0.4 + 0.5 * k})`; ctx.beginPath(); ctx.arc(r * 1.3 * long + 4 - rec, 0, 4 + 5 * k, 0, Math.PI * 2); ctx.fill();
      }
      ctx.fillStyle = part(c, 'ring'); ctx.beginPath(); ctx.arc(0, 0, r * 0.52, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = part(c, 'cap'); ctx.beginPath(); ctx.arc(0, 0, r * 0.4, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = part(c, 'ring'); ctx.beginPath(); ctx.arc(-r * 0.08, -r * 0.1, r * 0.14, 0, Math.PI * 2); ctx.fill();
      if (T && T.enchanter && !t.plain) { ctx.fillStyle = '#ff7ad0'; ctx.beginPath(); ctx.moveTo(-r * 0.2, 0); ctx.lineTo(0, -r * 0.22); ctx.lineTo(r * 0.2, 0); ctx.lineTo(0, r * 0.22); ctx.fill(); }
      ctx.restore();
    }
    }
    ctx.restore();
    if (t.plain) return;
    if (t.hurtT > 0) { ctx.globalAlpha = Math.min(1, t.hurtT / 0.35) * 0.6; ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(t.x, t.y, r, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1; }
    if (t.frozen > 0) {                                                        // frozen: an ice block round the tank and the seconds left
      ctx.fillStyle = 'rgba(170,225,255,0.55)'; rr(t.x - r * 1.25, t.y - r * 1.25, r * 2.5, r * 2.5, 6); ctx.fill();
      ctx.strokeStyle = 'rgba(240,252,255,0.95)'; ctx.lineWidth = 2; ctx.stroke();
      ctx.beginPath(); ctx.moveTo(t.x - r * 0.9, t.y - r * 0.5); ctx.lineTo(t.x - r * 0.4, t.y - r * 1.0); ctx.moveTo(t.x + r * 0.5, t.y + r * 0.9); ctx.lineTo(t.x + r * 0.95, t.y + r * 0.4); ctx.stroke();
      ctx.fillStyle = '#ffffff'; ctx.font = font(11); ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(Math.ceil(t.frozen), t.x, t.y + r * 1.55);
    }
    if (t.shield) {                                                            // the enchanter's pink barrier
      ctx.fillStyle = 'rgba(255,120,210,0.13)'; ctx.beginPath(); ctx.arc(t.x, t.y, r + 9, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = t.shield.hp >= 2 ? 'rgba(255,110,205,0.95)' : 'rgba(255,110,205,0.5)'; ctx.lineWidth = 3;
      if (t.shield.hp < 2) ctx.setLineDash([6, 5]);
      ctx.beginPath(); ctx.arc(t.x, t.y, r + 9, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
    }
    if (t.maxHp > 1 && t.hp > 0) {                                             // hearts over a tank with more than 1 HP
      const per = 5, sz = 7;
      for (let i = 0; i < t.hp; i++) {
        const row = Math.floor(i / per), n = Math.min(per, t.hp - row * per), col = i % per;
        drawHeart(t.x + (col - (n - 1) / 2) * (sz + 2), t.y - r - 10 - row * (sz + 2), sz);
      }
    }
  }
  // ---------- the 10 multiplayer TANK MODELS (TANK_MODELS in custom.js; 0 = the standard tank above) ----------
  // Every model paints with the same 9 parts (tread, pad, edge, body, lamp, barrel, tip, ring, cap) so the PREPARE
  // painter works on all of them. Extras that are not a part (shine, glow, smoke) are skipped when t.plain (the pick map).
  // The hitbox never changes: only the look.
  function poly(pts) { ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath(); }
  function drawModel(t, T) {
    const r = t.r, c = t.col, P = k => part(c, k), m = T.model, rec = t.recoil * 6, plain = t.plain, roll = t.trackDist || 0;
    const tread = (x0, x1, y, h, step) => {                                  // a track: belt + moving pads
      ctx.fillStyle = P('tread'); rr(x0, y - h / 2, x1 - x0, h, 4); ctx.fill();
      ctx.fillStyle = P('pad'); const off = roll % step;
      for (let i = x0; i < x1; i += step) { const px = i + off - step / 2; if (px > x0 + 1 && px < x1 - 4) ctx.fillRect(px, y - h * 0.36, 3, h * 0.72); }
    };
    const shine = (x, y, w, h) => { if (plain) return; ctx.fillStyle = 'rgba(255,255,255,0.18)'; rr(x, y, w, h, 3); ctx.fill(); };
    const muzzleFx = len => {                                               // flame nozzle / laser glow at the end of the barrel
      if (T.flame) {
        ctx.fillStyle = P('tip'); ctx.beginPath(); ctx.moveTo(len - 4 - rec, -4.5); ctx.lineTo(len + 6 - rec, -9); ctx.lineTo(len + 6 - rec, 9); ctx.lineTo(len - 4 - rec, 4.5); ctx.fill();
        if (!plain) { ctx.fillStyle = '#ffd24a'; ctx.beginPath(); ctx.arc(len + 6 - rec, 0, 2.5 + Math.random(), 0, Math.PI * 2); ctx.fill(); }
      }
      const chg = t.ai ? t.ai.charge : t.charge || 0;
      if (T.laser && !plain && (t.beamT > 0 || chg < 1.5)) {
        const k = t.beamT > 0 ? 1 : 1 - Math.max(0, chg) / 1.5;
        ctx.fillStyle = `rgba(255,80,160,${0.4 + 0.5 * k})`; ctx.beginPath(); ctx.arc(len + 4 - rec, 0, 4 + 5 * k, 0, Math.PI * 2); ctx.fill();
      }
    };
    const barrel = (len, wd, y) => {                                         // a barrel along +x (recoils back)
      y = y || 0;
      ctx.fillStyle = P('tip'); rr(r * 0.1 - rec, y - wd / 2 - 1, len + 1, wd + 2, 3); ctx.fill();
      ctx.fillStyle = P('barrel'); rr(r * 0.1 - rec, y - wd / 2, len, wd, 3); ctx.fill();
      ctx.fillStyle = P('tip'); rr(len - 3 - rec, y - wd / 2 - 1.5, 7, wd + 3, 2); ctx.fill();
    };
    const L = T.laser ? 1.15 : 1;                                            // a laser carrier gets a longer gun
    // ---- hull (turns with the tank)
    ctx.save(); ctx.rotate(t.hull);
    if (m === 1) {                                                           // BUGGY: six tyres, slim body, roll bar, headlights
      ctx.fillStyle = P('edge'); for (const ax of [-0.72, 0, 0.72]) ctx.fillRect(ax * r - 1.5, -r * 0.8, 3, r * 1.6);
      for (const ax of [-0.72, 0, 0.72]) for (const sd of [-1, 1]) {
        const cx = ax * r, cy = sd * r * 0.8, w = r * 0.56, h = r * 0.4;
        ctx.fillStyle = P('tread'); rr(cx - w / 2, cy - h / 2, w, h, 5); ctx.fill();
        ctx.fillStyle = P('pad'); const off = roll % 5;
        for (let i = -w / 2 + off; i < w / 2 - 1; i += 5) ctx.fillRect(cx + i, cy - h * 0.4, 1.6, h * 0.8);
      }
      ctx.fillStyle = P('edge'); rr(-r * 0.92, -r * 0.48, r * 1.84, r * 0.96, 8); ctx.fill();
      ctx.fillStyle = P('body'); rr(-r * 0.85, -r * 0.41, r * 1.7, r * 0.82, 7); ctx.fill();
      ctx.fillStyle = P('edge'); rr(-r * 0.62, -r * 0.44, r * 0.16, r * 0.88, 3); ctx.fill();   // roll bar
      ctx.fillStyle = P('lamp'); for (const sd of [-1, 1]) { ctx.beginPath(); ctx.arc(r * 0.76, sd * r * 0.27, r * 0.12, 0, Math.PI * 2); ctx.fill(); }
      ctx.fillStyle = P('edge'); rr(-r * 1.02, -r * 0.55, r * 0.14, r * 1.1, 2); ctx.fill();   // rear spoiler
      shine(-r * 0.4, -r * 0.36, r * 0.9, r * 0.16);
    } else if (m === 2) {                                                    // GOLIATH: huge hull, wide treads, side skirts, rivets
      for (const sd of [-1, 1]) tread(-r * 1.18, r * 1.18, sd * r * 0.8, r * 0.56, 7);
      ctx.fillStyle = P('edge'); for (const sd of [-1, 1]) rr(-r * 1.14, sd < 0 ? -r * 1.1 : r * 0.84, r * 2.28, r * 0.26, 3), ctx.fill();   // side skirts
      ctx.fillStyle = P('edge'); rr(-r * 1.1, -r * 0.66, r * 2.22, r * 1.32, 7); ctx.fill();
      ctx.fillStyle = P('body'); rr(-r * 1.02, -r * 0.58, r * 2.04, r * 1.16, 6); ctx.fill();
      ctx.fillStyle = P('lamp'); poly([[r * 0.7, -r * 0.55], [r * 1.08, -r * 0.4], [r * 1.08, r * 0.4], [r * 0.7, r * 0.55]]); ctx.fill();   // front armour plate
      ctx.fillStyle = P('edge'); for (let i = 0; i < 4; i++) ctx.fillRect(-r * 0.98 + i * 4, -r * 0.4, 2, r * 0.8);                 // engine grille
      ctx.fillStyle = P('ring'); for (const sd of [-1, 1]) for (let i = 0; i < 5; i++) { ctx.beginPath(); ctx.arc(-r * 0.85 + i * r * 0.42, sd * r * 0.5, 1.6, 0, Math.PI * 2); ctx.fill(); }
      shine(-r * 0.6, -r * 0.5, r * 1.2, r * 0.18);
    } else if (m === 3) {                                                    // SPIKER: spikes down both sides, hexagon hull, slit eyes
      ctx.fillStyle = P('tip');
      for (const sd of [-1, 1]) for (let i = 0; i < 5; i++) {
        const x = -r * 0.84 + i * r * 0.42; poly([[x - r * 0.17, sd * r * 0.86], [x, sd * r * 1.42], [x + r * 0.17, sd * r * 0.86]]); ctx.fill();
      }
      for (const sd of [-1, 1]) tread(-r * 1.0, r * 1.0, sd * r * 0.7, r * 0.48, 8);
      ctx.fillStyle = P('edge'); poly([[r * 1.02, 0], [r * 0.62, -r * 0.6], [-r * 0.78, -r * 0.6], [-r * 1.02, 0], [-r * 0.78, r * 0.6], [r * 0.62, r * 0.6]]); ctx.fill();
      ctx.fillStyle = P('body'); poly([[r * 0.9, 0], [r * 0.56, -r * 0.5], [-r * 0.72, -r * 0.5], [-r * 0.9, 0], [-r * 0.72, r * 0.5], [r * 0.56, r * 0.5]]); ctx.fill();
      ctx.fillStyle = P('lamp'); for (const sd of [-1, 1]) { poly([[r * 0.48, sd * r * 0.1], [r * 0.82, sd * r * 0.16], [r * 0.62, sd * r * 0.34]]); ctx.fill(); }
      ctx.fillStyle = P('tip'); poly([[r * 1.02, -r * 0.14], [r * 1.3, 0], [r * 1.02, r * 0.14]]); ctx.fill();   // ram spike
    } else if (m === 4) {                                                    // TWIN GUN: sloped hull, vents
      for (const sd of [-1, 1]) tread(-r * 1.05, r * 1.05, sd * r * 0.72, r * 0.58, 8);
      ctx.fillStyle = P('edge'); poly([[-r * 0.98, -r * 0.6], [r * 0.55, -r * 0.6], [r * 1.02, -r * 0.28], [r * 1.02, r * 0.28], [r * 0.55, r * 0.6], [-r * 0.98, r * 0.6]]); ctx.fill();
      ctx.fillStyle = P('body'); poly([[-r * 0.9, -r * 0.52], [r * 0.5, -r * 0.52], [r * 0.92, -r * 0.24], [r * 0.92, r * 0.24], [r * 0.5, r * 0.52], [-r * 0.9, r * 0.52]]); ctx.fill();
      ctx.fillStyle = P('lamp'); for (const sd of [-1, 1]) for (let i = 0; i < 3; i++) rr(-r * 0.85 + i * 5, sd * r * 0.38 - 2, 3, 4, 1), ctx.fill();
      ctx.fillStyle = P('lamp'); rr(r * 0.78, -r * 0.18, r * 0.12, r * 0.36, 2); ctx.fill();
      shine(-r * 0.5, -r * 0.46, r * 0.9, r * 0.14);
    } else if (m === 5) {                                                    // HOVER: an air skirt, spinning fans, glowing rim, tail fins
      if (!plain) { const g = 0.35 + 0.25 * Math.sin(clock * 6); ctx.fillStyle = `rgba(160,230,255,${g})`; ctx.beginPath(); ctx.ellipse(0, 0, r * 1.18, r * 1.06, 0, 0, Math.PI * 2); ctx.fill(); }
      ctx.fillStyle = P('tread'); ctx.beginPath(); ctx.ellipse(0, 0, r * 1.06, r * 0.96, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = P('lamp'); ctx.lineWidth = 2.5; ctx.beginPath(); ctx.ellipse(0, 0, r * 0.97, r * 0.87, 0, 0, Math.PI * 2); ctx.stroke();
      for (const [fx, fy] of [[r * 0.55, -r * 0.62], [r * 0.55, r * 0.62], [-r * 0.55, -r * 0.62], [-r * 0.55, r * 0.62]]) {
        ctx.save(); ctx.translate(fx, fy); ctx.rotate((t.moving ? clock * 18 : clock * 4) + fx); ctx.fillStyle = P('pad');
        for (let k = 0; k < 3; k++) { ctx.rotate(Math.PI * 2 / 3); rr(-1.2, 0, 2.4, r * 0.24, 1); ctx.fill(); }
        ctx.restore();
      }
      ctx.fillStyle = P('edge'); ctx.beginPath(); ctx.ellipse(0, 0, r * 0.78, r * 0.66, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = P('body'); ctx.beginPath(); ctx.ellipse(0, 0, r * 0.7, r * 0.58, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = P('edge'); for (const sd of [-1, 1]) { poly([[-r * 0.5, sd * r * 0.4], [-r * 1.12, sd * r * 0.72], [-r * 0.92, sd * r * 0.3]]); ctx.fill(); }
      shine(-r * 0.3, -r * 0.5, r * 0.6, r * 0.14);
    } else if (m === 6) {                                                    // STINGER: arrowhead hull, racing stripe, tail fins
      for (const sd of [-1, 1]) tread(-r * 0.85, r * 0.55, sd * r * 0.62, r * 0.42, 7);
      ctx.fillStyle = P('pad'); for (const sd of [-1, 1]) { poly([[-r * 0.7, sd * r * 0.5], [-r * 1.2, sd * r * 1.02], [-r * 1.05, sd * r * 0.42]]); ctx.fill(); }
      ctx.fillStyle = P('edge'); poly([[r * 1.2, 0], [-r * 0.15, -r * 0.98], [-r * 0.98, -r * 0.82], [-r * 0.7, 0], [-r * 0.98, r * 0.82], [-r * 0.15, r * 0.98]]); ctx.fill();
      ctx.fillStyle = P('body'); poly([[r * 1.0, 0], [-r * 0.15, -r * 0.82], [-r * 0.84, -r * 0.7], [-r * 0.58, 0], [-r * 0.84, r * 0.7], [-r * 0.15, r * 0.82]]); ctx.fill();
      ctx.fillStyle = P('lamp'); poly([[r * 0.95, 0], [-r * 0.2, -r * 0.16], [-r * 0.6, -r * 0.12], [-r * 0.6, r * 0.12], [-r * 0.2, r * 0.16]]); ctx.fill();
    } else if (m === 7) {                                                    // GATLING: boxy hull with hazard stripes
      for (const sd of [-1, 1]) tread(-r * 1.05, r * 1.05, sd * r * 0.72, r * 0.6, 6);
      ctx.fillStyle = P('edge'); rr(-r * 0.98, -r * 0.6, r * 1.96, r * 1.2, 3); ctx.fill();
      ctx.save(); rr(-r * 0.9, -r * 0.52, r * 1.8, r * 1.04, 2); ctx.fillStyle = P('body'); ctx.fill(); ctx.clip();
      ctx.fillStyle = P('lamp'); for (let i = -4; i < 6; i++) poly([[i * r * 0.4, -r * 0.6], [i * r * 0.4 + r * 0.18, -r * 0.6], [i * r * 0.4 - r * 0.5, r * 0.6], [i * r * 0.4 - r * 0.68, r * 0.6]]), ctx.fill();
      ctx.restore();
      ctx.fillStyle = P('edge'); rr(-r * 0.9, -r * 0.08, r * 1.8, r * 0.16, 1); ctx.fill();
    } else if (m === 8) {                                                    // DOZER: plough blade on arms, smoke stacks, headlights
      ctx.fillStyle = P('tread'); for (const sd of [-1, 1]) rr(r * 0.6, sd * r * 0.5 - 2, r * 0.5, 4, 1), ctx.fill();   // blade arms
      ctx.fillStyle = P('edge'); ctx.beginPath(); ctx.moveTo(r * 0.9, -r * 1.1); ctx.quadraticCurveTo(r * 1.32, 0, r * 0.9, r * 1.1); ctx.lineTo(r * 1.1, r * 1.1); ctx.quadraticCurveTo(r * 1.52, 0, r * 1.1, -r * 1.1); ctx.closePath(); ctx.fill();
      for (const sd of [-1, 1]) tread(-r * 1.0, r * 0.95, sd * r * 0.72, r * 0.6, 9);
      ctx.fillStyle = P('edge'); rr(-r * 0.92, -r * 0.56, r * 1.8, r * 1.12, 4); ctx.fill();
      ctx.fillStyle = P('body'); rr(-r * 0.85, -r * 0.49, r * 1.66, r * 0.98, 3); ctx.fill();
      ctx.fillStyle = P('lamp'); for (const sd of [-1, 1]) rr(r * 0.66, sd * r * 0.3 - 3, r * 0.14, 6, 1), ctx.fill();
      for (const sd of [-1, 1]) {
        ctx.fillStyle = P('pad'); ctx.beginPath(); ctx.arc(-r * 0.66, sd * r * 0.3, r * 0.17, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = P('tread'); ctx.beginPath(); ctx.arc(-r * 0.66, sd * r * 0.3, r * 0.09, 0, Math.PI * 2); ctx.fill();
      }
      if (!plain && t.moving) for (let k = 0; k < 2; k++) { const ph = (clock * 1.6 + k * 0.5) % 1; ctx.fillStyle = `rgba(90,90,100,${0.45 * (1 - ph)})`; ctx.beginPath(); ctx.arc(-r * 0.66 - ph * r * 0.9, (k ? 1 : -1) * r * 0.3, r * (0.14 + ph * 0.3), 0, Math.PI * 2); ctx.fill(); }
    } else if (m === 9) {                                                    // BEETLE: shell with spots, wing split, pincers, walking legs
      ctx.strokeStyle = P('tread'); ctx.lineWidth = 2.5; ctx.lineCap = 'round';
      for (let i = 0; i < 3; i++) for (const sd of [-1, 1]) {
        const bx = -r * 0.45 + i * r * 0.45, sw = Math.sin(roll * 0.25 + i * 2 + (sd > 0 ? Math.PI : 0)) * r * 0.22;
        ctx.beginPath(); ctx.moveTo(bx, sd * r * 0.5); ctx.lineTo(bx + sw * 0.5, sd * r * 0.88); ctx.lineTo(bx + sw, sd * r * 1.04); ctx.stroke();
      }
      ctx.fillStyle = P('tip'); for (const sd of [-1, 1]) { ctx.beginPath(); ctx.moveTo(r * 0.8, sd * r * 0.32); ctx.quadraticCurveTo(r * 1.45, sd * r * 0.5, r * 1.32, sd * r * 0.04); ctx.quadraticCurveTo(r * 1.2, sd * r * 0.3, r * 0.78, sd * r * 0.14); ctx.closePath(); ctx.fill(); }
      ctx.fillStyle = P('edge'); ctx.beginPath(); ctx.ellipse(0, 0, r * 1.0, r * 0.84, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = P('body'); for (const sd of [-1, 1]) { ctx.beginPath(); ctx.ellipse(-r * 0.06, sd * r * 0.4, r * 0.86, r * 0.38, 0, 0, Math.PI * 2); ctx.fill(); }
      ctx.fillStyle = P('edge'); ctx.fillRect(-r * 0.95, -1, r * 1.8, 2);
      ctx.fillStyle = P('lamp'); for (const [sx, sy, sr] of [[-0.5, 0.42, 0.14], [0.05, 0.55, 0.11], [0.35, 0.3, 0.09], [-0.2, 0.2, 0.08]]) for (const sd of [-1, 1]) { ctx.beginPath(); ctx.arc(sx * r, sd * sy * r, sr * r, 0, Math.PI * 2); ctx.fill(); }
      ctx.fillStyle = P('pad'); for (const sd of [-1, 1]) { ctx.beginPath(); ctx.arc(r * 0.82, sd * r * 0.24, r * 0.1, 0, Math.PI * 2); ctx.fill(); }
    }
    ctx.restore();
    // ---- turret (turns with the aim)
    ctx.save(); ctx.rotate(t.turret);
    if (m === 1) {                                                           // small dome, thin gun
      barrel(r * 1.4 * L, 5);
      ctx.fillStyle = P('ring'); ctx.beginPath(); ctx.arc(0, 0, r * 0.4, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = P('cap'); ctx.beginPath(); ctx.arc(-r * 0.04, 0, r * 0.3, 0, Math.PI * 2); ctx.fill();
      muzzleFx(r * 1.4 * L);
    } else if (m === 2) {                                                    // box turret, fat gun with a muzzle brake
      barrel(r * 1.38 * L, 10);
      ctx.fillStyle = P('tip'); rr(r * 1.12 * L - rec, -7, 4, 14, 1); ctx.fill();
      ctx.fillStyle = P('ring'); rr(-r * 0.62, -r * 0.55, r * 1.12, r * 1.1, 5); ctx.fill();
      ctx.fillStyle = P('cap'); rr(-r * 0.54, -r * 0.47, r * 0.96, r * 0.94, 4); ctx.fill();
      ctx.fillStyle = P('ring'); ctx.beginPath(); ctx.arc(-r * 0.18, -r * 0.16, r * 0.17, 0, Math.PI * 2); ctx.fill();
      muzzleFx(r * 1.38 * L);
    } else if (m === 3) {                                                    // spiked ring turret
      barrel(r * 1.4 * L, 7);
      ctx.fillStyle = P('tip'); for (let k = 0; k < 6; k++) { const a = k * Math.PI / 3 + Math.PI / 6; poly([[Math.cos(a - 0.3) * r * 0.48, Math.sin(a - 0.3) * r * 0.48], [Math.cos(a) * r * 0.74, Math.sin(a) * r * 0.74], [Math.cos(a + 0.3) * r * 0.48, Math.sin(a + 0.3) * r * 0.48]]); ctx.fill(); }
      ctx.fillStyle = P('ring'); ctx.beginPath(); ctx.arc(0, 0, r * 0.52, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = P('cap'); ctx.beginPath(); ctx.arc(0, 0, r * 0.38, 0, Math.PI * 2); ctx.fill();
      muzzleFx(r * 1.4 * L);
    } else if (m === 4) {                                                    // oval turret, two guns side by side
      barrel(r * 1.42 * L, 5, -4.5); barrel(r * 1.42 * L, 5, 4.5);
      ctx.fillStyle = P('ring'); ctx.beginPath(); ctx.ellipse(0, 0, r * 0.6, r * 0.5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = P('cap'); ctx.beginPath(); ctx.ellipse(-r * 0.05, 0, r * 0.47, r * 0.38, 0, 0, Math.PI * 2); ctx.fill();
      muzzleFx(r * 1.42 * L);
    } else if (m === 5) {                                                    // sleek tapered gun on a teardrop
      ctx.fillStyle = P('tip'); poly([[r * 0.1 - rec, -5], [r * 1.5 * L - rec, -2.5], [r * 1.5 * L - rec, 2.5], [r * 0.1 - rec, 5]]); ctx.fill();
      ctx.fillStyle = P('barrel'); poly([[r * 0.1 - rec, -4], [r * 1.46 * L - rec, -1.6], [r * 1.46 * L - rec, 1.6], [r * 0.1 - rec, 4]]); ctx.fill();
      ctx.fillStyle = P('ring'); ctx.beginPath(); ctx.ellipse(-r * 0.05, 0, r * 0.5, r * 0.38, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = P('cap'); ctx.beginPath(); ctx.moveTo(r * 0.36, 0); ctx.quadraticCurveTo(-r * 0.05, -r * 0.42, -r * 0.4, 0); ctx.quadraticCurveTo(-r * 0.05, r * 0.42, r * 0.36, 0); ctx.fill();
      muzzleFx(r * 1.5 * L);
    } else if (m === 6) {                                                    // low triangle turret, long thin gun
      barrel(r * 1.55 * L, 4.5);
      ctx.fillStyle = P('ring'); poly([[r * 0.55, 0], [-r * 0.45, -r * 0.48], [-r * 0.45, r * 0.48]]); ctx.fill();
      ctx.fillStyle = P('cap'); poly([[r * 0.34, 0], [-r * 0.32, -r * 0.3], [-r * 0.32, r * 0.3]]); ctx.fill();
      muzzleFx(r * 1.55 * L);
    } else if (m === 7) {                                                    // three spinning barrels
      t.spin = (t.spin || 0) + t.recoil * 0.6 + (t.beamT > 0 ? 0.4 : 0);
      const bs = [0, 1, 2].map(k => ({ y: Math.sin(t.spin + k * 2.094) * 4.2, z: Math.cos(t.spin + k * 2.094) })).sort((a, b) => a.z - b.z);
      for (const b of bs) barrel(r * 1.4 * L, 4, b.y);
      ctx.fillStyle = P('ring'); rr(r * 0.4 - rec, -7, 5, 14, 2); ctx.fill();
      ctx.fillStyle = P('ring'); ctx.beginPath(); ctx.arc(0, 0, r * 0.5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = P('cap'); ctx.beginPath(); ctx.arc(0, 0, r * 0.36, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = P('ring'); ctx.beginPath(); ctx.arc(0, 0, r * 0.12, 0, Math.PI * 2); ctx.fill();
      muzzleFx(r * 1.4 * L);
    } else if (m === 8) {                                                    // octagon turret, short fat mortar
      barrel(r * 1.1 * L, 9);
      ctx.fillStyle = P('ring'); poly([...Array(8)].map((_, k) => [Math.cos(k * Math.PI / 4 + Math.PI / 8) * r * 0.55, Math.sin(k * Math.PI / 4 + Math.PI / 8) * r * 0.55])); ctx.fill();
      ctx.fillStyle = P('cap'); poly([...Array(8)].map((_, k) => [Math.cos(k * Math.PI / 4 + Math.PI / 8) * r * 0.42, Math.sin(k * Math.PI / 4 + Math.PI / 8) * r * 0.42])); ctx.fill();
      muzzleFx(r * 1.1 * L);
    } else if (m === 9) {                                                    // little head turret with a stinger gun
      barrel(r * 1.35 * L, 4.5);
      ctx.fillStyle = P('ring'); ctx.beginPath(); ctx.arc(0, 0, r * 0.4, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = P('cap'); ctx.beginPath(); ctx.arc(0, 0, r * 0.28, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = P('ring'); ctx.beginPath(); ctx.arc(r * 0.06, 0, r * 0.09, 0, Math.PI * 2); ctx.fill();
      muzzleFx(r * 1.35 * L);
    }
    ctx.restore();
  }
  function drawHeart(x, y, s) {
    ctx.fillStyle = '#ff3b5c'; ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x, y + s * 0.45);
    ctx.bezierCurveTo(x - s * 0.9, y - s * 0.15, x - s * 0.35, y - s * 0.75, x, y - s * 0.25);
    ctx.bezierCurveTo(x + s * 0.35, y - s * 0.75, x + s * 0.9, y - s * 0.15, x, y + s * 0.45);
    ctx.fill(); ctx.stroke();
  }
  // Draw a tank type on any canvas (the level creator's buttons and the tank painter). o: { x, y, scale, turret, plain, col }
  function drawTankPreview(g, T, o) {
    const t = { x: 0, y: 0, r: TANK_R, h: 0, hull: o.hull || 0, turret: o.turret || 0, col: o.col || T.col, ai: { T, charge: 9 }, alive: true, trackDist: 0, recoil: 0,
      plain: !!o.plain, hp: T.hp || 1, maxHp: o.plain || o.noHearts ? 1 : T.hp || 1 };
    const main = ctx; ctx = g;
    try { g.save(); g.translate(o.x, o.y); g.scale(o.scale || 1, o.scale || 1); drawTank(t, true); g.restore(); } finally { ctx = main; }
  }
  function rr(x, y, w, h, rad) { ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x, y, w, h, rad) : ctx.rect(x, y, w, h); }

  function hudRects() {
    const s = Math.min(view.cw, view.ch);
    return {
      pause: { x: view.cw - 16 - s * 0.085, y: 14, w: s * 0.085, h: s * 0.085 },
      zoom: { x: view.cw - 28 - s * 0.17, y: 14, w: s * 0.085, h: s * 0.085 },
      mine: { x: view.cw - 28 - s * 0.14, y: view.ch - 28 - s * 0.14, w: s * 0.14, h: s * 0.14 },
    };
  }
  function font(px) { return `bold ${Math.round(px)}px Impact, 'Arial Black', sans-serif`; }
  function drawHud() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (vs) return drawVsHud();
    const R = hudRects(), k = Math.min(1.4, view.scale + 0.3);
    ctx.font = font(16 * k); ctx.textBaseline = 'top'; ctx.textAlign = 'left';
    const label = `${level.name}   ENEMIES ${enemiesLeft()}`;
    const hx = Math.max(0, view.ox), hy = Math.max(0, view.oy), hb = Math.min(view.ch, view.oy + H * view.scale);
    ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.fillRect(hx + 8, hy + 8, ctx.measureText(label).width + 16, 30);
    ctx.fillStyle = '#fff3cf'; ctx.fillText(label, hx + 16, hy + 14);
    const ammo = `SHELLS ${MAX_SHELLS - player.shells}/${MAX_SHELLS}   MINES ${MAX_MINES - player.mines}/${MAX_MINES}   LIVES ${save.lives}`;
    ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.fillRect(hx + 8, hb - 38, ctx.measureText(ammo).width + 16, 30);
    ctx.fillStyle = '#fff3cf'; ctx.fillText(ammo, hx + 16, hb - 32);
    drawZoomBtn(R.zoom);
    roundBtn(R.pause, 'rgba(20,40,70,0.85)');
    ctx.fillStyle = '#fff3cf';
    ctx.fillRect(R.pause.x + R.pause.w * 0.3, R.pause.y + R.pause.h * 0.25, R.pause.w * 0.14, R.pause.h * 0.5);
    ctx.fillRect(R.pause.x + R.pause.w * 0.56, R.pause.y + R.pause.h * 0.25, R.pause.w * 0.14, R.pause.h * 0.5);
    if (touchMode && state === 'playing') {
      roundBtn(R.mine, player.mines < MAX_MINES ? 'rgba(240,194,92,0.85)' : 'rgba(120,100,60,0.6)', true);
      ctx.fillStyle = '#1a1a1a'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = font(R.mine.w * 0.22);
      ctx.fillText('MINE', R.mine.x + R.mine.w / 2, R.mine.y + R.mine.h / 2);
      for (const kk of ['move', 'aim']) {
        const s = sticks[kk]; if (!s) continue;
        if (kk === 'aim') { drawFinger(s); continue; }
        ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(s.ox, s.oy, 60, 0, Math.PI * 2); ctx.stroke();
        ctx.fillStyle = 'rgba(61,139,255,0.7)'; ctx.beginPath(); ctx.arc(s.x, s.y, 28, 0, Math.PI * 2); ctx.fill();
      }
    }
    if (!touchMode && state === 'playing' && mouse.inside) {
      const sx = view.ox + mouse.x * view.scale, sy = view.oy + mouse.y * view.scale;
      ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(sx, sy, 9, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(sx - 14, sy); ctx.lineTo(sx - 5, sy); ctx.moveTo(sx + 5, sy); ctx.lineTo(sx + 14, sy); ctx.moveTo(sx, sy - 14); ctx.lineTo(sx, sy - 5); ctx.moveTo(sx, sy + 5); ctx.lineTo(sx, sy + 14); ctx.stroke();
    }
    // banners
    const banner = (big, small, y) => {
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(0, y - 52, view.cw, small ? 104 : 84);
      ctx.fillStyle = '#fff3cf'; ctx.font = font(38 * Math.min(1.6, view.scale + 0.4)); ctx.fillText(big, view.cw / 2, small ? y - 12 : y);
      if (small) { ctx.font = font(18 * Math.min(1.6, view.scale + 0.4)); ctx.fillStyle = '#f0c25c'; ctx.fillText(small, view.cw / 2, y + 28); }
    };
    const tap = touchMode ? 'TAP' : 'CLICK OR PRESS R';
    if (state === 'intro') banner(level.name, `ENEMY TANKS: ${enemiesLeft()}     LIVES: ${save.lives}`, view.ch / 2);
    else if (state === 'dead' && stateT > 1.6) banner(`${tap} TO TRY AGAIN`, `LIVES LEFT: ${save.lives}`, view.ch * 0.8);
    else if (state === 'clear' && stateT > 0.6) banner('MISSION CLEAR!', null, view.ch / 2);
    else if (state === 'over' && stateT > 1.6) banner('GAME OVER', `${tap} TO RETURN TO THE TITLE`, view.ch / 2);
    else if (state === 'won' && customLevel) banner('LEVEL COMPLETE!', `${tap} TO GO BACK TO THE LEVEL CREATOR`, view.ch / 2);
    else if (state === 'over' && customLevel && stateT > 1.6) banner('GAME OVER', `${tap} TO GO BACK TO THE LEVEL CREATOR`, view.ch / 2);
    else if (state === 'won') banner('ALL MISSIONS CLEARED!', `MORE ON THE WAY   -   ${tap} TO RETURN TO THE TITLE`, view.ch / 2);
  }
  function roundBtn(r, fill, circle) {
    ctx.fillStyle = fill; ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.lineWidth = 2;
    if (circle) { ctx.beginPath(); ctx.arc(r.x + r.w / 2, r.y + r.h / 2, r.w / 2, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); }
    else { rr(r.x, r.y, r.w, r.h, 10); ctx.fill(); ctx.stroke(); }
  }
  const inRect = (p, r) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;

  // ---------- input ----------
  function bindInput() {
    window.addEventListener('keydown', e => {
      if (e.repeat) return;
      keys[e.code] = true;
      if (vs) { vsKey(e); return; }
      if (state === 'playing') { if (e.code === 'Space') { layMine(player); e.preventDefault(); } }
      else if (e.code === 'KeyR' || e.code === 'Enter' || e.code === 'Space') advance();
      // Escape / P are handled by the menus (ui.js) so one press cannot pause and resume at once
    });
    window.addEventListener('keyup', e => { keys[e.code] = false; });
    window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; });
    canvas.addEventListener('contextmenu', e => e.preventDefault());
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);
    canvas.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') mouse.inside = false; });
  }
  // the "tap to continue" moments: retry after a death, leave after game over / all clear
  function advance() {
    if (state === 'dead' && stateT > 1.6) { loadLevel(); state = 'intro'; }
    else if ((state === 'over' && stateT > 1.6) || state === 'won') { const done = customLevel && customDone; stop(); if (done) done(); else onLeave(); }
  }
  function onDown(e) {
    if (state === 'idle' || state === 'paused' || state === 'dead-paused' || state === 'edit') return;
    if (vs) { vsDown(e); return; }
    Sfx.unlock();
    const p = { x: e.clientX, y: e.clientY }, R = hudRects();
    if (inRect(p, R.pause) && (state === 'playing' || state === 'dead' || state === 'intro')) { pause(); return; }
    if (e.pointerType === 'touch') touchMode = true;
    if (touchDev() && inRect(p, R.zoom)) { cycleZoom(); return; }
    if (e.pointerType === 'touch') {
      touchMode = true;
      if (state !== 'playing') { advance(); return; }
      if (inRect(p, R.mine)) { layMine(player); return; }
      startTouch(e, p);
      return;
    }
    touchMode = false;
    const w = toWorld(p.x, p.y); mouse.x = w.x; mouse.y = w.y; mouse.inside = true;
    if (state !== 'playing') { advance(); return; }
    if (e.button === 2) layMine(player);
    else if (e.button === 0) { player.turret = Math.atan2(mouse.y - player.y, mouse.x - player.x); fire(player); }
  }
  // a new finger: the drive stick if it lands on the left 40% while you are not driving yet, otherwise the aim finger
  function startTouch(e, p) {
    const now = performance.now();
    if (!sticks.move && p.x < view.cw * 0.4) sticks.move = { id: e.pointerId, ox: p.x, oy: p.y, x: p.x, y: p.y, dx: 0, dy: 0, len: 0, t0: now, moved: 0 };
    else if (!sticks.aim) sticks.aim = { id: e.pointerId, ox: p.x, oy: p.y, x: p.x, y: p.y, t0: now, moved: 0 };
    else return;
    try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
  }
  function onMove(e) {
    if (e.pointerType === 'touch') {
      for (const s of ss) if (s && s.id === e.pointerId) dragStick(s, e);
      for (const k of ['move', 'aim']) {
        const s = sticks[k]; if (!s || s.id !== e.pointerId) continue;
        s.moved = Math.max(s.moved || 0, Math.hypot(e.clientX - s.ox, e.clientY - s.oy));
        if (k === 'aim') { s.x = e.clientX; s.y = e.clientY; continue; }
        let dx = e.clientX - s.ox, dy = e.clientY - s.oy; const len = Math.hypot(dx, dy);
        if (len > 60) { dx *= 60 / len; dy *= 60 / len; }
        s.x = s.ox + dx; s.y = s.oy + dy; s.dx = dx / 60; s.dy = dy / 60; s.len = Math.min(len, 60);
      }
      return;
    }
    const w = toWorld(e.clientX, e.clientY); mouse.x = w.x; mouse.y = w.y; mouse.inside = true;
  }
  function onUp(e) {
    if (e.pointerType !== 'touch') return;
    for (let k = 0; k < 2; k++) if (ss[k] && ss[k].id === e.pointerId) ss[k] = null;
    for (const k of ['move', 'aim']) {
      const s = sticks[k]; if (!s || s.id !== e.pointerId) continue;
      // a quick TAP (on either side) turns the turret to that spot and fires; a drag only aims (or drives)
      if (isTap(s) && state === 'playing') {
        if (vs) { const P = vs.players.find(q => q.ctl === 'me'); if (P) { const w = toWorld(s.ox, s.oy); snapAim(P.tank, 0, Math.atan2(w.y - P.tank.y, w.x - P.tank.x)); act(P, 'fire'); } }
        else { const w = toWorld(s.ox, s.oy); player.turret = Math.atan2(w.y - player.y, w.x - player.x); fire(player); }
      }
      sticks[k] = null;
    }
  }

  // ---------- flow ----------
  function start(saveData) {
    vs = null; customLevel = null; customDone = null; inset = { l: 0, t: 0, r: 0, b: 0 };
    save = saveData;
    if (save.lives <= 0) save.lives = 3;
    loadLevel();
    state = 'intro';
    sticks.move = sticks.aim = null;
  }
  function pause() {
    if (vs) {                                     // split screen really pauses; a Local game carries on while your menu is open
      if (vs.role === 'local' && (state === 'playing' || state === 'intro')) { vs.pausedFrom = state; state = 'paused'; ss[0] = ss[1] = null; for (const k in keys) keys[k] = false; }
      onPause(); return;
    }
    if (state === 'intro') { state = 'playing'; stateT = 0; }
    if (state !== 'playing' && state !== 'dead') return;
    state = state === 'dead' ? 'dead-paused' : 'paused'; sticks.move = sticks.aim = null; for (const k in keys) keys[k] = false; onPause();
  }
  function resume() { if (vs) { if (state === 'paused') state = vs.pausedFrom || 'playing'; return; } if (state === 'paused') state = 'playing'; else if (state === 'dead-paused') state = 'dead'; }
  function stop() {
    state = 'idle'; save = null; customLevel = null; customDone = null;
    if (vs) { vs = null; ss[0] = ss[1] = null; inset = { l: 0, t: 0, r: 0, b: 0 }; resize(); }
  }
  // ---- level creator ----
  // show a level being edited (nothing moves); call again after every change
  function edit(L) { vs = null; customLevel = L; customDone = null; save = null; state = 'edit'; loadLevel(true); }
  // play the level being edited; done() runs after it is cleared or lost, or the player quits
  function playCustom(L, done) {
    vs = null; customLevel = L; customDone = done; inset = { l: 0, t: 0, r: 0, b: 0 };
    save = Object.assign(Store.newSave(), { level: 1 });
    loadLevel(); state = 'intro'; sticks.move = sticks.aim = null;
  }
  function setInset(o) { inset = Object.assign({ l: 0, t: 0, r: 0, b: 0 }, o || {}); resize(); }
  function pickTile(sx, sy) { const w = toWorld(sx, sy); return { c: Math.floor(w.x / TILE), r: Math.floor(w.y / TILE), x: w.x, y: w.y }; }
  function recolor() { if (player) player.col = playerColor(); }

  // ======================= MULTIPLAYER =======================
  // A battle between player tanks: SPLIT SCREEN (two players on this device, role 'local') or LOCAL over Wi-Fi. In a Local
  // game the HOST's device runs the battle: each guest drives its own tank on its own screen and reports where it is
  // (30 times a second), asks the host to fire / lay a mine / teleport, and draws the snapshots the host sends back
  // (20 a second: every tank, shell and mine, map changes and effects). Last tank standing wins.
  const VS_INTRO = 2.5, VS_OVER = 4.5, RESPAWN_T = 2.5, SPAWN_SHIELD = 2;
  const r1 = v => Math.round(v * 10) / 10, r2 = v => Math.round(v * 100) / 100;
  const SPLIT_KEYS = [
    { up: 'KeyW', down: 'KeyS', left: 'KeyA', right: 'KeyD', ccw: 'KeyQ', cw: 'KeyE', fire: ['KeyF', 'Space'], fire2: ['KeyR'], mine: ['KeyG'], tele: ['KeyH'] },
    { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight', ccw: 'Semicolon', cw: 'Quote', fire: ['Slash', 'Enter', 'NumpadEnter', 'Numpad0'], fire2: ['ShiftRight', 'Numpad1'], mine: ['Period'], tele: ['Comma'] },
  ];
  // where players start: a Local map's flags in order (blue, red, yellow...), or a campaign map's player square then its enemy squares
  function spawnsOf(L) {
    L = fromGrid(L);
    if (L.flags) return L.flags.slice().sort((a, b) => a[0] - b[0]).map(f => [f[1], f[2]]);
    return (L.player ? [L.player] : []).concat((L.enemies || []).map(e => [e[1], e[2]]));
  }
  const faceMiddle = (x, y) => Math.atan2(H / 2 - y, W / 2 - x);
  const isLocal = t => !!(t.P && (t.P.ctl === 'me' || t.P.ctl === 'p0' || t.P.ctl === 'p1'));
  // o: { role: 'local' | 'host' | 'client', L, rules, players: [{ id, name, spec, slot, team }], me, send(msg), onEnd(result) }
  function startVersus(o) {
    const RU = cleanRules(o.rules);
    customLevel = null; customDone = null; save = null;
    level = fromGrid(o.L); COLS = level.cols; ROWS = level.rows; map = buildLevel(level); fillBarrels(true);
    pads = []; for (let i = 0; i < map.length; i++) if (map[i] === TELE) pads.push(i);
    const sp = spawnsOf(level);
    vs = { role: o.role, me: o.me, players: [], events: [], send: o.send || (() => {}), onEnd: o.onEnd || (() => {}), snapT: 0, sendT: 0, winner: null, winTeam: -1, ended: false,
      prevMap: Uint8Array.from(map), shellMap: new Map(), mineMap: new Map(), rules: RU, teams: RU.teams, timeLeft: rulesTime(RU) };
    lb.open = false; lb.k = 0;
    tanks = [];
    o.players.forEach((p, i) => {
      const T = pvpType(p.spec || {}), s = sp[i % Math.max(1, sp.length)] || [2.5, 2.5], x = s[0] * TILE, y = s[1] * TILE;
      const t = makeTank(x, y, T.col, 'pvp');
      Object.assign(t, { pw: T, out: [0, 0], charge: 0, warp: 0, h: hAt(x, y) });
      t.hull = t.turret = faceMiddle(x, y);
      const slot = p.slot != null ? p.slot : i;
      const ctl = o.role === 'local' ? (i === 0 ? 'p0' : 'p1') : p.id === o.me ? 'me' : o.role === 'host' ? 'net' : 'remote';
      const team = RU.teams ? Math.max(0, Math.min(RU.teams - 1, p.team | 0)) : -1;
      const P = { idx: i, id: p.id, name: String(p.name || 'PLAYER ' + (i + 1)).slice(0, 14), slot, team, color: team >= 0 ? TEAM_COLORS[team][1] : FLAG_COLORS[slot % FLAG_COLORS.length][1],
        lives: RU.mode === 'battle' ? RU.lives : 0, kills: 0, deaths: 0, tank: t, spawn: [x, y], respawnT: 0, ctl, left: false };
      t.P = P; vs.players.push(P); tanks.push(t);
    });
    const mine = vs.players.find(P => P.ctl === 'me' || P.ctl === 'p0') || vs.players[0];
    player = mine.tank;
    shells = []; mines = []; tracks = []; smoke = []; xmarks = []; rings = []; bits = []; beams = []; ices = []; homeCache.clear();
    shake = 0; flashAlpha = 0; stateT = 0; state = 'intro';
    // TELEPORTATION: before the round, every teleporter places up to 5 teleport squares of their own (split screen: blue first, then red)
    vs.padOwner = new Map(); vs.placers = vs.players.filter(P => P.tank.pw.teleport).map(P => P.idx); vs.placeTurn = 0;
    if (vs.placers.length) state = 'place';
    sticks.move = sticks.aim = null; ss[0] = ss[1] = null; for (const k in keys) keys[k] = false;
    const b = Math.min(window.innerWidth, window.innerHeight) * 0.17;
    inset = o.role === 'local' ? { l: b + 26, t: 0, r: b + 26, b: 0 } : { l: 0, t: 0, r: 0, b: 0 };   // split screen: room for the buttons down each side
    resize();
  }
  // what a player on THIS device is asking for: a drive direction and where the turret should point
  function controlOf(P) {
    const t = P.tank;
    if (P.ctl === 'me') {
      let aim = null;
      if (sticks.aim) aim = fingerAim(t);
      else if (!touchMode) aim = Math.atan2(mouse.y - t.y, mouse.x - t.x);
      return { mv: moveInput(), aim, rate: turnRate(t) };
    }
    // split screen: one joystick (or WASD / arrows) each. The turret turns to face the way you drive; Q/E (blue) or ; and ' (red) turn it by hand
    const k = P.ctl === 'p1' ? 1 : 0, K = SPLIT_KEYS[k], s = ss[k];
    let dx = (keys[K.right] ? 1 : 0) - (keys[K.left] ? 1 : 0), dy = (keys[K.down] ? 1 : 0) - (keys[K.up] ? 1 : 0);
    if (s) { dx += s.dx; dy += s.dy; }
    let l = Math.hypot(dx, dy); if (l > 1) { dx /= l; dy /= l; l = 1; }
    const mv = { dx, dy, l }, rot = (keys[K.cw] ? 1 : 0) - (keys[K.ccw] ? 1 : 0);
    if (rot) return { mv, aim: t.turret + rot, rate: Math.min(3, turnRate(t)) };
    return { mv, aim: l > 0.25 ? Math.atan2(dy, dx) : null, rate: Math.min(7, turnRate(t)) };
  }
  // a Super Laser holds still while it warns, then drags the turret round slower than the nearest enemy can drive
  const turnRate = t => {
    if (t.warnT > 0) return 0;
    if (!(t.beamT > 0)) return 99;
    let d = Infinity; for (const o of tanks) if (o !== t && o.alive && !sameTeam(o, t)) d = Math.min(d, Math.hypot(o.x - t.x, o.y - t.y));
    return beamSweep(d, 0.6);
  };
  const keepsLives = () => vs.rules.mode === 'battle';                         // SLAYER / SLAUGHTER: no lives, respawn forever
  const canRespawn = P => !P.left && (!keepsLives() || P.lives > 0);
  function turnTurret(t, want, rate, dt) { const d = angDiff(t.turret, want), turn = rate * dt; t.turret += Math.abs(d) < turn ? d : Math.sign(d) * turn; }
  function addTrack(t) { if (!t.lastTrack || Math.hypot(t.x - t.lastTrack.x, t.y - t.lastTrack.y) > 7) { tracks.push({ x: t.x, y: t.y, a: t.hull, age: 0 }); t.lastTrack = { x: t.x, y: t.y }; } }
  function versusTick(dt) {
    for (const P of vs.players) {
      const t = P.tank;
      t.fireCD = Math.max(0, t.fireCD - dt); t.recoil = Math.max(0, t.recoil - dt * 6);
      if (!t.alive) { t.moving = false; if (state === 'playing' && canRespawn(P) && (P.respawnT -= dt) <= 0) respawn(P); continue; }
      if (P.ctl === 'net') continue;                                          // a guest's own phone drives its tank (vsMessage)
      if (state !== 'playing') { t.moving = false; continue; }
      const ox = t.x, oy = t.y, c = controlOf(P);
      driveTankAt(t, c.mv, dt, TANK_SPEED * t.pw.move);
      t.vx = (t.x - ox) / dt; t.vy = (t.y - oy) / dt;
      if (c.aim != null) turnTurret(t, c.aim, c.rate, dt);
    }
    if (state === 'playing' && vs.timeLeft > 0 && (vs.timeLeft -= dt) <= 0) { vs.timeLeft = 0; checkWinner(true); }   // SLAYER / SLAUGHTER clock
    if (vs.role === 'host') hostSend(dt);
  }
  function respawn(P) {
    const t = P.tank; let [x, y] = P.spawn;
    if (hitsTank(t, x, y)) {                                                  // someone is parked on the flag: the nearest free square
      let best = null, bd = Infinity;
      for (let r = 1; r < ROWS - 1; r++) for (let c = 1; c < COLS - 1; c++) {
        const v = tileAt(c, r); if (!(v === FLOOR || v === WATER)) continue;
        const cx = center(c), cy = center(r), d = Math.hypot(cx - x, cy - y);
        if (d < bd && !hitsTank(t, cx, cy) && !circleHitsWall(cx, cy, t.r, false, 0)) { bd = d; best = [cx, cy]; }
      }
      if (best) [x, y] = best;
    }
    Object.assign(t, { x, y, h: hAt(x, y), alive: true, spawnT: SPAWN_SHIELD, frozen: 0, beamT: 0, warnT: 0, wcd: [0, 0], charge: 0, moving: false, lastTrack: null, hurtT: 0, revealT: 0 });
    t.hull = t.turret = faceMiddle(x, y); t.warp++;
    emit('spawn', x, y);
  }
  function vsKilled(t, by) {
    const P = t.P; if (!P) return;
    if (keepsLives()) P.lives = Math.max(0, P.lives - 1);
    P.deaths++;
    if (by && by.P && by !== t && !sameTeam(by, t)) by.P.kills++;               // your own shot or a team mate's: nobody scores
    P.respawnT = RESPAWN_T;
    checkWinner();
  }
  // the sides of the battle: one per player, or one per team that has anyone in it. score = kills
  function vsSides() {
    if (!vs.teams) return vs.players.map(P => ({ team: -1, idx: P.idx, members: [P] }));
    const out = [];
    for (let k = 0; k < vs.teams; k++) { const m = vs.players.filter(P => P.team === k); if (m.length) out.push({ team: k, idx: -1, members: m }); }
    return out;
  }
  const sideScore = s => s.members.reduce((n, P) => n + P.kills, 0);
  function checkWinner(timeUp) {
    if (!vs || vs.role === 'client' || (state !== 'playing' && state !== 'intro')) return;
    const R = vs.rules, sides = vsSides();
    const live = sides.filter(s => s.members.some(P => !P.left && (P.tank.alive || canRespawn(P))));
    let win = null, done = false;
    if (live.length <= 1 && vs.players.length > 1) { win = live[0] || null; done = true; }
    else if (R.mode === 'slayer' && sides.some(s => sideScore(s) >= R.kills)) { win = sides.find(s => sideScore(s) >= R.kills); done = true; }
    else if (timeUp) {
      const best = Math.max(...live.map(sideScore)), top = live.filter(s => sideScore(s) === best);
      win = top.length === 1 ? top[0] : null; done = true;                    // a tie on kills when the time runs out is a draw
    }
    if (!done) return;
    state = 'over'; stateT = 0;
    vs.winner = win && win.idx >= 0 ? win.idx : -1; vs.winTeam = win && win.team >= 0 ? win.team : -1;
  }
  const winnerName = () => (vs.winTeam >= 0 ? TEAM_COLORS[vs.winTeam][2] + ' TEAM' : vs.winner >= 0 && vs.players[vs.winner] ? vs.players[vs.winner].name : null);
  function versusFlow() {
    if (state === 'place') {
      const turns = vs.role === 'local' && vs.placers.length > 1;             // split screen takes turns (one screen to tap)
      const allDone = vs.placers.every(i => padsOf(i).length >= MAX_PADS);
      if (turns && vs.placeTurn === 0 && (stateT >= PLACE_T || padsOf(vs.placers[0]).length >= MAX_PADS)) { vs.placeTurn = 1; stateT = 0; }
      else if (allDone || stateT >= PLACE_T) { state = 'intro'; stateT = 0; }
    }
    if (state === 'intro' && stateT >= VS_INTRO) { state = 'playing'; stateT = 0; }
    if (state === 'over' && stateT >= VS_OVER && !vs.ended) { vs.ended = true; vs.onEnd(vsResult()); }
  }
  function vsResult() {
    const w = vs.winner >= 0 ? vs.players[vs.winner] : null;
    return { winner: winnerName(), winnerId: w ? w.id : null, winTeam: vs.winTeam, players: vs.players.map(P => ({ id: P.id, name: P.name, team: P.team, kills: P.kills, deaths: P.deaths, lives: P.lives, left: P.left })) };
  }
  // teleport squares: the map's own (anyone with Teleportation may use them) plus each teleporter's own 5 (only theirs)
  const PLACE_T = 12, MAX_PADS = 5;
  const padsOf = i => [...vs.padOwner].filter(([, o]) => o === i).map(([j]) => j);
  const usablePads = t => pads.filter(j => !vs.padOwner.has(j) || vs.padOwner.get(j) === t.P.idx);
  function playerTeleport(t) {
    if (!t.alive || !(t.pw && t.pw.teleport)) return false;
    const list = usablePads(t), here = tileC(t.y) * COLS + tileC(t.x), k = list.indexOf(here);
    if (k < 0 || list.length < 2) return false;                              // you have to be standing on one of your teleport squares
    for (let n = 1; n < list.length; n++) { const j = list[(k + n) % list.length]; if (teleport(t, j % COLS, (j / COLS) | 0)) return true; }
    return false;
  }
  // tap a square during the placing time: put one of your teleport squares there (tap it again to take it back)
  function placePad(P, c, r) {
    if (!vs || state !== 'place' || !P || !P.tank.pw.teleport) return false;
    if (vs.role === 'local' && vs.placers.length > 1 && vs.placers[vs.placeTurn] !== P.idx) return false;
    const i = r * COLS + c;
    if (c <= 0 || r <= 0 || c >= COLS - 1 || r >= ROWS - 1) return false;
    if (vs.padOwner.get(i) === P.idx) { map[i] = FLOOR; vs.padOwner.delete(i); }
    else {
      if (map[i] !== FLOOR || padsOf(P.idx).length >= MAX_PADS) return false;
      if (vs.players.some(Q => tileC(Q.spawn[0]) === c && tileC(Q.spawn[1]) === r)) return false;   // never on a spawn flag
      map[i] = TELE; vs.padOwner.set(i, P.idx);
    }
    pads = []; for (let j = 0; j < map.length; j++) if (map[j] === TELE) pads.push(j);
    Sfx.tele();
    return true;
  }
  function padTap(sx, sy) {
    const w = toWorld(sx, sy), c = tileC(w.x), r = tileC(w.y);
    const P = vs.role === 'local' ? vs.players[vs.placers[vs.placeTurn]] : vs.players.find(q => q.ctl === 'me');
    if (!P || !P.tank.pw.teleport) return;
    if (vs.role === 'client') vs.send({ t: 'act', a: 'pad', c, r });
    else placePad(P, c, r);
  }
  function doAct(t, a) { return a === 'fire' ? fire(t, 0) : a === 'fire2' ? fire2(t) : a === 'mine' ? layMine(t) : a === 'tele' ? playerTeleport(t) : false; }
  function act(P, a) {
    if (!vs || state !== 'playing' || !P || !P.tank.alive) return false;
    if (vs.role === 'client') { vs.send({ t: 'act', a, tu: r2(P.tank.turret) }); return true; }
    return doAct(P.tank, a);
  }
  // the second fire button: weapon 2, or a mine (Mines picked), or nothing (another power picked)
  function fire2(t) { const s = t.pw && t.pw.slot2; return s === 'mine' ? layMine(t) : s === 'weapon' ? fire(t, 1) : false; }
  function vsLeave(id) {
    if (!vs || vs.role === 'client') return;
    const P = vs.players.find(p => p.id === id); if (!P || P.left) return;
    P.left = true; if (keepsLives()) P.lives = 0;
    if (P.tank.alive) killTank(P.tank); else checkWinner();
  }
  // ---- the host: snapshots out, guests' reports in
  function hostSend(dt) {
    if ((vs.snapT -= dt) > 0) return;
    vs.snapT = 0.05;
    const idx = t => (t && t.P ? t.P.idx : -1), md = [];
    for (let i = 0; i < map.length; i++) if (map[i] !== vs.prevMap[i]) { md.push(i, map[i]); vs.prevMap[i] = map[i]; }
    vs.send({ t: 'snap', s: state, st: r1(stateT), w: vs.winner, wt: vs.winTeam, tl: r1(vs.timeLeft),
      tk: vs.players.map(P => { const t = P.tank; return [r1(t.x), r1(t.y), r2(t.hull), r2(t.turret), t.alive ? 1 : 0, r1(t.frozen > 0 ? t.frozen : 0), r1(t.spawnT > 0 ? t.spawnT : 0), t.warp,
        P.lives, P.kills, r1(t.revealT > 0 ? t.revealT : 0), r1(t.beamT > 0 ? t.beamT : 0), r1(t.charge > 0 ? t.charge : 0), t.moving ? 1 : 0, t.shells, t.mines, P.left ? 1 : 0, t.out[0], t.out[1], P.deaths,
        r1(t.warnT > 0 ? t.warnT : 0), r1(t.wcd && t.wcd[0] > 0 ? t.wcd[0] : 0), r1(t.wcd && t.wcd[1] > 0 ? t.wcd[1] : 0)]; }),
      sh: shells.filter(s => !s.dead).map(s => [s.id, r1(s.x), r1(s.y), r1(s.vx), r1(s.vy), s.h, (s.rocket ? 1 : 0) | (s.homing ? 2 : 0) | (s.frost ? 4 : 0) | (s.flame ? 8 : 0), idx(s.owner), s.maxB - s.bounces, r1(s.seed || 0)]),
      mn: mines.map(m => [m.id, r1(m.x), r1(m.y), r2(m.t), m.lit ? 1 : 0, r2(Math.min(m.boomAt, 999)), idx(m.owner)]),
      md, ev: vs.events, po: [...vs.padOwner] });
    vs.events = [];
  }
  function vsMessage(id, m) {
    if (!vs || !m) return;
    if (vs.role === 'client') { if (m.t === 'snap') applySnap(m); return; }
    const P = vs.players.find(p => p.id === id); if (!P || P.ctl !== 'net') return;
    const t = P.tank;
    if (m.t === 'st') {
      if (!t.alive || m.w !== t.warp || state !== 'playing' || !isFinite(m.x) || !isFinite(m.y)) return;
      t.turret = +m.tu || 0;
      if (t.frozen > 0) { t.moving = false; return; }
      const ox = t.x, oy = t.y;
      t.x = +m.x; t.y = +m.y; t.hull = +m.hu || 0; t.h = hAt(t.x, t.y); t.moving = !!m.mv;
      t.trackDist += Math.hypot(t.x - ox, t.y - oy); t.vx = (t.x - ox) * 30; t.vy = (t.y - oy) * 30;
      addTrack(t);
    } else if (m.t === 'act') {
      if (m.a === 'pad') { placePad(P, m.c | 0, m.r | 0); return; }
      if (state !== 'playing' || !t.alive) return;
      if (isFinite(m.tu)) t.turret = +m.tu;
      doAct(t, m.a);
    }
  }
  // ---- a guest: draw what the host says, drive our own tank here
  function applySnap(m) {
    if (m.s !== state) { state = m.s; stateT = m.st || 0; }
    vs.winner = m.w; vs.winTeam = m.wt != null ? m.wt : -1; if (m.tl != null) vs.timeLeft = m.tl;
    (m.tk || []).forEach((a, i) => {
      const P = vs.players[i]; if (!P) return;
      const t = P.tank, [x, y, hull, tur, alive, fr, sp, warp, lives, kills, rv, beam, charge, moving, shN, mnN, left, o0, o1, deaths, warn, wc0, wc1] = a, was = t.alive;
      t.warnT = warn || 0; t.wcd = [wc0 || 0, wc1 || 0];
      P.lives = lives; P.kills = kills; P.left = !!left; P.deaths = deaths | 0;
      t.frozen = fr; t.spawnT = sp; t.revealT = rv; t.charge = charge; t.shells = shN; t.mines = mnN; t.out = [o0 | 0, o1 | 0];
      if (beam > 0 && !(t.beamT > 0)) { Sfx.laser(); t.recoil = 1; }
      t.beamT = beam; t.alive = !!alive;
      const jump = warp !== t.warp || (!was && t.alive);                       // respawned or teleported: snap straight there
      if (jump) { t.x = x; t.y = y; t.hull = hull; t.turret = tur; t.warp = warp; t.lastTrack = null; t.h = hAt(x, y); }
      if (P.ctl === 'me') return;
      t.nx = x; t.ny = y; t.nh = hull; t.nt = tur; t.moving = !!moving;
    });
    const seen = new Set(); let fired = false;
    for (const a of m.sh || []) {
      const [id, x, y, vx, vy, h, f, oi, bl, seed] = a; seen.add(id);
      let s = vs.shellMap.get(id);
      if (!s) {
        s = { id, age: 0, owner: vs.players[oi] ? vs.players[oi].tank : null, rocket: !!(f & 1), homing: !!(f & 2), frost: !!(f & 4), flame: !!(f & 8), seed, bounces: 0, maxB: bl };
        if (s.flame) s.r = FLAME_R;
        vs.shellMap.set(id, s); shells.push(s); fired = true;
        if (s.owner) s.owner.recoil = 1;
      }
      Object.assign(s, { x, y, vx, vy, h, maxB: bl, bounces: 0 });
    }
    if (fired) Sfx.fire();
    for (const s of shells) if (!seen.has(s.id)) {                              // gone on the host: a puff where it was
      s.dead = true; vs.shellMap.delete(s.id);
      if (s.flame) smoke.push(puff(s.x, s.y, 9, 0.4, 'rgba(255,140,40,'));
      else if (s.rocket || s.homing) { rings.push({ x: s.x, y: s.y, age: 0, life: 0.3, r: 22 }); for (let i = 0; i < 6; i++) smoke.push(puff(s.x, s.y, 6 + Math.random() * 6, 0.5, 'rgba(255,160,60,')); }
      else { smoke.push(puff(s.x, s.y, 7, 0.4, 'rgba(200,200,210,')); Sfx.hit(); }
    }
    shells = shells.filter(s => !s.dead);
    const mseen = new Set();
    for (const a of m.mn || []) {
      const [id, x, y, mt, lit, boomAt, oi] = a; mseen.add(id);
      let q = vs.mineMap.get(id);
      if (!q) { q = { id, x, y, owner: vs.players[oi] ? vs.players[oi].tank : null }; vs.mineMap.set(id, q); mines.push(q); Sfx.mine(); }
      Object.assign(q, { t: mt, lit: !!lit, boomAt });
    }
    mines = mines.filter(q => { if (mseen.has(q.id)) return true; vs.mineMap.delete(q.id); return false; });
    const md = m.md || []; for (let k = 0; k + 1 < md.length; k += 2) map[md[k]] = md[k + 1];
    if (md.length) { pads = []; for (let j = 0; j < map.length; j++) if (map[j] === TELE) pads.push(j); }
    if (m.po) vs.padOwner = new Map(m.po);
    for (const e of m.ev || []) if (FX[e[0]]) FX[e[0]](...e.slice(1));
  }
  function clientUpdate(dt) {
    const me = vs.players.find(P => P.ctl === 'me');
    if (state === 'playing' && vs.timeLeft > 0) vs.timeLeft = Math.max(0, vs.timeLeft - dt);
    for (const t of tanks) {
      if (t.frozen > 0) t.frozen -= dt; if (t.revealT > 0) t.revealT -= dt; if (t.spawnT > 0) t.spawnT -= dt; if (t.beamT > 0) t.beamT -= dt;
      if (t.warnT > 0) t.warnT -= dt; if (t.wcd) for (let k = 0; k < 2; k++) if (t.wcd[k] > 0) t.wcd[k] -= dt;
      t.recoil = Math.max(0, t.recoil - dt * 6);
    }
    for (const P of vs.players) {
      const t = P.tank;
      if (!t.alive) { t.moving = false; continue; }
      if (P === me) {
        if (state !== 'playing') { t.moving = false; continue; }
        const c = controlOf(P), ox = t.x, oy = t.y;
        driveTankAt(t, c.mv, dt, TANK_SPEED * t.pw.move);
        t.vx = (t.x - ox) / dt; t.vy = (t.y - oy) / dt;
        if (c.aim != null) turnTurret(t, c.aim, c.rate, dt);
        continue;
      }
      if (t.nx == null) continue;                                             // the others glide to where the host last saw them
      const k = Math.min(1, dt * 16), ox = t.x, oy = t.y;
      t.x += (t.nx - t.x) * k; t.y += (t.ny - t.y) * k; t.hull += angDiff(t.hull, t.nh) * k; t.turret += angDiff(t.turret, t.nt) * k; t.h = hAt(t.x, t.y);
      const mv = Math.hypot(t.x - ox, t.y - oy); t.trackDist += mv; if (mv > 0.05) addTrack(t);
    }
    for (const s of shells) {                                                 // shells fly on between snapshots (the host decides what they hit)
      s.age += dt;
      for (let k = 0, sdt = dt / 3; k < 3; k++) {
        const nx = s.x + s.vx * sdt, ny = s.y + s.vy * sdt;
        if (circleHitsWall(nx, ny, SHELL_R, true, s.h)) {
          if (s.bounces >= s.maxB) { s.vx = s.vy = 0; break; }
          const hx = circleHitsWall(nx, s.y, SHELL_R, true, s.h), hy = circleHitsWall(s.x, ny, SHELL_R, true, s.h);
          if (hx || (!hx && !hy)) s.vx = -s.vx; if (hy || (!hx && !hy)) s.vy = -s.vy;
          s.bounces++; Sfx.bounce(); smoke.push(puff(s.x, s.y, 4, 0.3, 'rgba(255,255,255,'));
        } else { s.x = nx; s.y = ny; s.h = liftAt(nx, ny); }
      }
      if (s.flame && Math.random() < 0.35) { const p = puff(s.x, s.y, 5, 0.3, Math.random() < 0.5 ? 'rgba(255,120,30,' : 'rgba(90,80,80,'); p.vx *= 0.4; p.vy *= 0.4; smoke.push(p); }
      else if (s.rocket || s.homing || s.frost) { const p = puff(s.x - s.vx * 0.03, s.y - s.vy * 0.03, 4, 0.22, s.frost ? 'rgba(170,230,255,' : 'rgba(255,170,50,'); p.vx *= 0.3; p.vy *= 0.3; smoke.push(p); }
    }
    for (const q of mines) { q.t += dt; if (!q.lit && q.t > MINE_FUSE - 2 && Math.floor(q.t * 8) !== Math.floor((q.t - dt) * 8)) Sfx.beep(); }
    if (me && (vs.sendT -= dt) <= 0) {
      vs.sendT = 1 / 30; const t = me.tank;
      if (t.alive && state === 'playing') vs.send({ t: 'st', w: t.warp, x: r1(t.x), y: r1(t.y), hu: r2(t.hull), tu: r2(t.turret), mv: t.moving ? 1 : 0 });
    }
  }
  // ---- input
  // Local PC: left click / F = weapon 1, right click / Q = weapon 2, space = mine, E or shift = teleport, Tab = leaderboard.
  // Split screen: BLUE F (or space) / R, RED / (or Enter) / right shift; Tab opens the leaderboard.
  const WSHORT = { shell: 'SHELL', rocket: 'ROCKET', bouncy: 'BOUNCY', homing: 'SEEKER', frost: 'FROST', flame: 'FLAME', laser: 'LASER' };
  const wName = (t, k) => (k === 1 && t.pw.slot2 === 'mine' ? 'MINE' : k === 1 && !t.pw.slot2 ? 'OFF' : t.pw.wp[k] ? WSHORT[t.pw.wp[k].id] || 'FIRE' : 'FIRE');
  // aiming with the mouse / a touch: snap the turret to the aim unless that weapon is the laser (it drags round)
  const snapAim = (t, k, a) => { if (!(t.pw.wp[k] && t.pw.wp[k].laser) && !(t.beamT > 0) && !(t.warnT > 0)) t.turret = a; };
  function vsKey(e) {
    if (e.code === 'Tab') { lb.open = !lb.open; e.preventDefault(); return; }
    if (state !== 'playing') return;
    if (vs.role === 'local') {
      for (let k = 0; k < 2; k++) {
        const K = SPLIT_KEYS[k], P = vs.players[k]; if (!P) continue;
        if (K.fire.includes(e.code)) { act(P, 'fire'); e.preventDefault(); }
        else if (K.fire2.includes(e.code)) { act(P, 'fire2'); e.preventDefault(); }
        else if (K.mine.includes(e.code)) act(P, 'mine');
        else if (K.tele.includes(e.code)) act(P, 'tele');
      }
      return;
    }
    const P = vs.players.find(p => p.ctl === 'me'); if (!P) return;
    if (e.code === 'Space') { act(P, 'mine'); e.preventDefault(); }
    else if (e.code === 'KeyE' || e.code === 'ShiftLeft' || e.code === 'ShiftRight') act(P, 'tele');
    else if (e.code === 'KeyF') act(P, 'fire');
    else if (e.code === 'KeyQ') act(P, 'fire2');
  }
  function dragStick(s, e) {
    let dx = e.clientX - s.ox, dy = e.clientY - s.oy; const len = Math.hypot(dx, dy);
    if (len > 60) { dx *= 60 / len; dy *= 60 / len; }
    s.x = s.ox + dx; s.y = s.oy + dy; s.dx = dx / 60; s.dy = dy / 60; s.len = Math.min(len, 60);
  }
  function vsRects() {
    const s = Math.min(view.cw, view.ch), R = { pause: { x: view.cw - 16 - s * 0.085, y: 14, w: s * 0.085, h: s * 0.085 }, zoom: { x: view.cw - 28 - s * 0.17, y: 14, w: s * 0.085, h: s * 0.085 } };
    if (vs.role === 'local') {
      // each player's buttons in a column down their edge: TELEPORT, FIRE (weapon 1), FIRE 2 (weapon 2), MINE
      const b = s * 0.17, g = 8, tall = b * 0.7 + b + b * 0.85 + b * 0.7 + g * 3, y0 = Math.max(s * 0.24, view.ch - 14 - tall);
      for (const k of [0, 1]) {
        const x = k ? view.cw - 14 - b : 14;
        let y = y0;
        R['tele' + k] = { x: x + b * 0.15, y, w: b * 0.7, h: b * 0.7 }; y += b * 0.7 + g;
        R['fire' + k] = { x, y, w: b, h: b }; y += b + g;
        R['fire2' + k] = { x: x + b * 0.075, y, w: b * 0.85, h: b * 0.85 }; y += b * 0.85 + g;
        R['mine' + k] = { x: x + b * 0.15, y, w: b * 0.7, h: b * 0.7 };
      }
      R.pause = { x: view.cw / 2 - s * 0.0425, y: 10, w: s * 0.085, h: s * 0.085 };      // between the two players
    } else {
      const b = s * 0.14;
      R.fire2 = { x: view.cw - 28 - b * 1.15, y: view.ch - 28 - b * 1.15, w: b * 1.15, h: b * 1.15 };   // the second weapon's button
      R.mine = { x: R.fire2.x - 14 - b, y: view.ch - 28 - b, w: b, h: b };
      R.tele = { x: view.cw - 28 - b * 1.075, y: R.fire2.y - 12 - b, w: b, h: b };
    }
    // the leaderboard: a little arrow tab on the right edge; open, the board covers the right half of the screen
    const pw = view.cw * 0.5, px = view.cw - pw * lb.k, th = Math.max(56, s * 0.15), ty = vs.role === 'local' ? Math.max(8, R.pause.y + R.pause.h + 6) : view.ch * 0.5 - th / 2;
    R.lbTab = { x: px - 30, y: ty, w: 30, h: th };
    R.lbPanel = { x: px, y: 0, w: pw, h: view.ch };
    if (vs.role === 'local') R.lbTab.x = Math.min(R.lbTab.x, view.cw - 30);
    return R;
  }
  function vsDown(e) {
    Sfx.unlock();
    const p = { x: e.clientX, y: e.clientY }, R = vsRects();
    if (inRect(p, R.lbTab)) { lb.open = !lb.open; Sfx.click && Sfx.click(); return; }
    if (lb.k > 0.05 && inRect(p, R.lbPanel)) return;                         // taps on the open board do nothing else
    if (inRect(p, R.pause)) { pause(); return; }
    if (vs.role !== 'local' && touchDev() && inRect(p, R.zoom)) { cycleZoom(); return; }
    if (state === 'place') { padTap(p.x, p.y); return; }                    // placing teleport squares before the round
    if (vs.role === 'local') {
      if (e.pointerType === 'mouse') return;                                  // split screen on a PC: keyboard only
      touchMode = true;
      const k = p.x < view.cw / 2 ? 0 : 1, P = vs.players[k]; if (!P) return;
      if (inRect(p, R['fire' + k])) { act(P, 'fire'); return; }
      if (inRect(p, R['fire2' + k])) { act(P, 'fire2'); return; }
      if (P.tank.pw.mines && inRect(p, R['mine' + k])) { act(P, 'mine'); return; }
      if (P.tank.pw.teleport && inRect(p, R['tele' + k])) { act(P, 'tele'); return; }
      if (!ss[k]) ss[k] = { id: e.pointerId, ox: p.x, oy: p.y, x: p.x, y: p.y, dx: 0, dy: 0, len: 0 };
      try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
      return;
    }
    const P = vs.players.find(q => q.ctl === 'me'); if (!P) return;
    if (e.pointerType === 'touch') {
      touchMode = true;
      if (inRect(p, R.fire2)) { act(P, 'fire2'); return; }
      if (P.tank.pw.mines && inRect(p, R.mine)) { act(P, 'mine'); return; }
      if (P.tank.pw.teleport && inRect(p, R.tele)) { act(P, 'tele'); return; }
      startTouch(e, p);
      return;
    }
    touchMode = false;
    const w = toWorld(p.x, p.y); mouse.x = w.x; mouse.y = w.y; mouse.inside = true;
    const k = e.button === 2 ? 1 : e.button === 0 ? 0 : -1; if (k < 0) return;
    snapAim(P.tank, k, Math.atan2(mouse.y - P.tank.y, mouse.x - P.tank.x));
    act(P, k ? 'fire2' : 'fire');
  }
  // ---- drawing
  function drawVsTank(t) {
    let a = 1;
    if (!tankVisible(t)) { if (!isLocal(t)) return; a = vs.role === 'local' ? 0.16 : 0.4; }   // invisible: you still see yourself, faintly
    if (t.spawnT > 0 && Math.floor(clock * 10) % 2) a *= 0.35;               // just respawned: blinking, and shots pass through
    ctx.globalAlpha = a; drawTank(t, true); ctx.globalAlpha = 1;
  }
  function drawNames() {
    ctx.textAlign = 'center'; ctx.textBaseline = 'bottom'; ctx.font = font(12); ctx.lineJoin = 'round';
    for (const P of vs.players) {
      const t = P.tank; if (!t.alive || (!tankVisible(t) && !isLocal(t))) continue;
      const y = t.y - t.r - 6;
      ctx.lineWidth = 3.5; ctx.strokeStyle = 'rgba(0,0,0,0.75)'; ctx.strokeText(P.name, t.x, y);
      ctx.fillStyle = P.color; ctx.fillText(P.name, t.x, y);
      if (t.pw.laser && isLocal(t)) {                                         // your laser's charge, under your tank
        const k = t.beamT > 0 ? 1 : 1 - Math.max(0, Math.min(6, t.charge || 0)) / 6;
        ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(t.x - 16, t.y + t.r + 6, 32, 5);
        ctx.fillStyle = k >= 1 ? '#ff5aa8' : '#9a4a70'; ctx.fillRect(t.x - 16, t.y + t.r + 6, 32 * k, 5);
      }
    }
  }
  // a spawn flag: pole, pennant in its colour, the spawn number
  function drawFlag(x, y, col, num, alpha) {
    ctx.save(); ctx.globalAlpha = alpha;
    ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.beginPath(); ctx.ellipse(x - 5, y + 13, 7, 3, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#3a2a1a'; ctx.lineWidth = 3; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(x - 6, y + 13); ctx.lineTo(x - 6, y - 15); ctx.stroke();
    ctx.fillStyle = col; ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(x - 5, y - 15); ctx.lineTo(x + 15, y - 8); ctx.lineTo(x - 5, y - 1); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.font = font(9); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.strokeStyle = 'rgba(0,0,0,0.7)'; ctx.lineWidth = 2.5; ctx.strokeText(num, x + 1.5, y - 8); ctx.fillText(num, x + 1.5, y - 8);
    ctx.restore();
  }
  // a weapon's state for its button: how many more it can fire right now (the laser: READY or charging)
  function ammoText(t, k) {
    if (k === 1 && t.pw.slot2 === 'mine') return Math.max(0, MAX_MINES - t.mines) + '/' + MAX_MINES;
    const W = t.pw.wp[k]; if (!W) return '';
    if (W.laser) return t.beamT > 0 || t.warnT > 0 ? 'FIRING' : t.charge > 0 ? Math.ceil(t.charge) + 's' : 'READY';
    if (t.wcd && t.wcd[k] > 0) return 'RELOAD ' + Math.ceil(t.wcd[k]) + 's';
    if (W.flame) return shells.some(s => s.flame && s.owner === t && s.slot === k) ? '...' : 'READY';
    return Math.max(0, W.shells - ((t.out && t.out[k]) || 0)) + '/' + W.shells;
  }
  // the players in order for the leaderboard: most kills first, then fewest deaths
  function ranking() { return vs.players.slice().sort((a, b) => b.kills - a.kills || (a.deaths || 0) - (b.deaths || 0) || a.idx - b.idx); }
  const ORD = n => n + (n % 100 >= 11 && n % 100 <= 13 ? 'TH' : ['TH', 'ST', 'ND', 'RD'][n % 10] || 'TH');
  function drawLeaderboard(R) {
    const tab = R.lbTab, P0 = R.lbPanel;
    if (lb.k > 0.01) {
      ctx.save();
      ctx.fillStyle = 'rgba(10,16,30,0.9)'; ctx.fillRect(P0.x, 0, P0.w, view.ch);
      ctx.fillStyle = 'rgba(255,255,255,0.15)'; ctx.fillRect(P0.x, 0, 2, view.ch);
      const pad = 12, w = P0.w - pad * 2, x = P0.x + pad;
      ctx.beginPath(); ctx.rect(P0.x, 0, P0.w, view.ch); ctx.clip();
      ctx.textBaseline = 'middle'; ctx.textAlign = 'left'; ctx.fillStyle = '#f0c25c';
      const hk = Math.min(1.3, Math.max(0.75, view.ch / 420));
      ctx.font = font(20 * hk); ctx.fillText('LEADERBOARD', x, 22 * hk);
      ctx.font = font(11 * hk); ctx.fillStyle = '#cfd8e6'; ctx.fillText(rulesText(vs.rules), x, 42 * hk);
      let y = 54 * hk;
      if (vs.teams) {                                                          // team totals across the top
        const sides = vsSides().sort((a, b) => sideScore(b) - sideScore(a)), cw = (w - (sides.length - 1) * 6) / Math.max(1, sides.length), ch = 22 * hk;
        sides.forEach((sd, i) => {
          const cx = x + i * (cw + 6);
          ctx.fillStyle = TEAM_COLORS[sd.team][1]; rr(cx, y, cw, ch, 5); ctx.fill();
          ctx.fillStyle = sd.team === 3 ? '#1a1a1a' : '#fff'; ctx.textAlign = 'center'; ctx.font = font(12 * hk);
          ctx.fillText(`${TEAM_COLORS[sd.team][2]} ${sideScore(sd)}`, cx + cw / 2, y + ch / 2);
        });
        ctx.textAlign = 'left'; y += ch + 8;
      }
      const list = ranking(), rh = Math.max(18, Math.min(34 * hk, (view.ch - y - 8) / Math.max(1, list.length) - 4));
      const SLOT = [['#ffe27a', '#c99a1c', '#3a2a00'], ['#f2f4f8', '#9ea6b4', '#1e2430'], ['#f0b07a', '#a8602a', '#2e1606']];
      list.forEach((P, i) => {
        const ry = y + i * (rh + 4), top = SLOT[i];
        if (top) { const gr = ctx.createLinearGradient(x, ry, x, ry + rh); gr.addColorStop(0, top[0]); gr.addColorStop(1, top[1]); ctx.fillStyle = gr; }
        else ctx.fillStyle = 'rgba(255,255,255,0.08)';
        rr(x, ry, w, rh, 6); ctx.fill();
        ctx.fillStyle = P.color; rr(x + 4, ry + 4, 6, rh - 8, 3); ctx.fill();     // their colour (team colour in TEAMS)
        const ink = top ? top[2] : '#fff3cf', fs = Math.min(16 * hk, rh * 0.55);
        ctx.font = font(fs); ctx.fillStyle = ink; ctx.textAlign = 'left';
        const last = i === list.length - 1 && list.length > 3;
        ctx.fillText(last ? 'LAST' : ORD(i + 1), x + 16, ry + rh / 2);
        const nx = x + 16 + ctx.measureText('LAST').width + 10;
        ctx.globalAlpha = P.left ? 0.5 : 1;
        let name = P.name + (P.left ? ' (LEFT)' : ''); const room = w - (nx - x) - 70;
        while (name.length > 3 && ctx.measureText(name).width > room) name = name.slice(0, -1);
        ctx.fillText(name, nx, ry + rh / 2);
        ctx.textAlign = 'right'; ctx.fillText(P.kills + (P.kills === 1 ? ' KILL' : ' KILLS'), x + w - 10, ry + rh / 2);
        ctx.globalAlpha = 1;
      });
      ctx.restore();
    }
    // the tab: an arrow pointing the way the board will slide
    ctx.fillStyle = 'rgba(20,40,70,0.88)'; ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.lineWidth = 2;
    rr(tab.x, tab.y, tab.w + 8, tab.h, 8); ctx.fill(); ctx.stroke();
    const ax = tab.x + tab.w / 2, ay = tab.y + tab.h / 2, d = lb.open ? 1 : -1;
    ctx.fillStyle = '#f0c25c'; ctx.beginPath(); ctx.moveTo(ax - 5 * d, ay - 9); ctx.lineTo(ax + 6 * d, ay); ctx.lineTo(ax - 5 * d, ay + 9); ctx.closePath(); ctx.fill();
  }
  function drawVsHud() {
    const R = vsRects(), k = Math.min(1.3, view.scale + 0.35), battle = vs.rules.mode === 'battle';
    // the scoreboard: a chip per player with their colour (team colour in TEAMS), name, lives (BATTLE) and kills
    ctx.font = font(12 * k); ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
    let x = 8, y = 8;
    const hh = 22 * k, right = vs.role === 'local' ? R.pause.x - 8 : R.pause.x - 8;
    for (const P of vs.players) {
      const out = P.left || (battle && !P.tank.alive && P.lives <= 0), tag = P.left ? 'LEFT' : out ? 'OUT' : '', hearts = battle && !tag ? P.lives : 0;
      const w = 14 * k + ctx.measureText(P.name).width + (tag ? ctx.measureText(' ' + tag).width : hearts * 11 * k) + 40 * k;
      if (x + w > right && x > 8) { x = 8; y += hh + 4; }
      ctx.fillStyle = 'rgba(0,0,0,0.55)'; rr(x, y, w, hh, 6); ctx.fill();
      ctx.fillStyle = P.color; rr(x, y, 6 * k, hh, 3); ctx.fill();
      ctx.globalAlpha = out ? 0.5 : 1;
      ctx.fillStyle = '#fff3cf'; ctx.fillText(P.name, x + 10 * k, y + hh / 2);
      let hx = x + 14 * k + ctx.measureText(P.name).width;
      if (tag) { ctx.fillStyle = '#ff8a8a'; ctx.fillText(tag, hx, y + hh / 2); hx += ctx.measureText(tag).width; }
      else for (let i = 0; i < hearts; i++) drawHeart(hx + i * 11 * k + 4, y + hh / 2, 8 * k);
      hx += hearts * 11 * k;
      ctx.fillStyle = '#f0c25c'; ctx.fillText('★' + P.kills, hx + 4 * k, y + hh / 2);
      ctx.globalAlpha = 1;
      x += w + 6;
    }
    // SLAYER / SLAUGHTER: the clock (and the kill target) at the top
    if (!battle) {
      const tl = vs.rules.mode === 'slayer' && !vs.rules.slayerTime ? 'NO TIME LIMIT' : Store.fmtTime(Math.ceil(vs.timeLeft));
      const txt = vs.rules.mode === 'slayer' ? `${tl}  ·  FIRST TO ${vs.rules.kills}` : tl;
      ctx.font = font(16 * k); ctx.textAlign = 'center';
      const tw = ctx.measureText(txt).width + 24, cx = view.cw / 2, cy = vs.role === 'local' ? R.pause.y + R.pause.h + 8 : y + hh + 8;
      ctx.fillStyle = 'rgba(0,0,0,0.6)'; rr(cx - tw / 2, cy, tw, 26 * k, 7); ctx.fill();
      ctx.fillStyle = vs.timeLeft > 0 && vs.timeLeft <= 10 && Math.floor(clock * 4) % 2 ? '#ff6a6a' : '#fff3cf';
      ctx.fillText(txt, cx, cy + 13 * k);
    }
    drawZoomBtn(R.zoom); roundBtn(R.pause, 'rgba(20,40,70,0.85)');
    ctx.fillStyle = '#fff3cf';
    ctx.fillRect(R.pause.x + R.pause.w * 0.3, R.pause.y + R.pause.h * 0.25, R.pause.w * 0.14, R.pause.h * 0.5);
    ctx.fillRect(R.pause.x + R.pause.w * 0.56, R.pause.y + R.pause.h * 0.25, R.pause.w * 0.14, R.pause.h * 0.5);
    const label = (r, text, fill, sub) => {
      ctx.fillStyle = fill; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.font = font(r.w * (text.length > 5 ? 0.19 : 0.24)); ctx.fillText(text, r.x + r.w / 2, r.y + r.h / 2 - (sub ? r.h * 0.1 : 0));
      if (sub) { ctx.font = font(r.w * 0.16); ctx.fillText(sub, r.x + r.w / 2, r.y + r.h / 2 + r.h * 0.2); }
    };
    if (vs.role === 'local') {                                               // split screen: blue controls down the left, red down the right
      for (let s = 0; s < 2; s++) {
        const P = vs.players[s]; if (!P) continue;
        const t = P.tank, col = s ? 'rgba(240,58,58,0.85)' : 'rgba(47,125,246,0.85)', col2 = s ? 'rgba(160,30,30,0.85)' : 'rgba(25,70,160,0.85)', on = t.alive && state === 'playing';
        ctx.globalAlpha = on ? 1 : 0.45;
        roundBtn(R['fire' + s], col, true); label(R['fire' + s], wName(t, 0), '#fff', ammoText(t, 0));
        ctx.globalAlpha = on && t.pw.slot2 ? 1 : 0.3;                                         // switched off: a power was picked
        roundBtn(R['fire2' + s], t.pw.slot2 === 'mine' ? 'rgba(240,194,92,0.85)' : col2, true); label(R['fire2' + s], wName(t, 1), t.pw.slot2 === 'mine' ? '#1a1a1a' : '#fff', ammoText(t, 1));
        ctx.globalAlpha = on ? 1 : 0.45;
        if (t.pw.mines && t.pw.slot2 !== 'mine') { roundBtn(R['mine' + s], 'rgba(240,194,92,0.85)', true); label(R['mine' + s], 'MINE', '#1a1a1a'); }
        if (t.pw.teleport) { roundBtn(R['tele' + s], 'rgba(150,70,230,0.85)', true); label(R['tele' + s], 'TELE', '#fff'); }
        ctx.globalAlpha = 1;
        const st = ss[s];
        if (st) {
          ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(st.ox, st.oy, 60, 0, Math.PI * 2); ctx.stroke();
          ctx.fillStyle = col; ctx.beginPath(); ctx.arc(st.x, st.y, 28, 0, Math.PI * 2); ctx.fill();
        }
      }
    } else {
      const P = vs.players.find(q => q.ctl === 'me');
      if (P && touchMode && state === 'playing') {
        const t = P.tank;
        ctx.globalAlpha = t.alive ? 1 : 0.45;
        if (!t.pw.slot2) ctx.globalAlpha = 0.3;
        roundBtn(R.fire2, t.pw.slot2 === 'mine' ? 'rgba(240,194,92,0.88)' : 'rgba(25,70,160,0.88)', true); label(R.fire2, wName(t, 1), t.pw.slot2 === 'mine' ? '#1a1a1a' : '#fff', ammoText(t, 1));
        ctx.globalAlpha = 1;
        if (t.pw.mines && t.pw.slot2 !== 'mine') { roundBtn(R.mine, t.mines < MAX_MINES ? 'rgba(240,194,92,0.85)' : 'rgba(120,100,60,0.6)', true); label(R.mine, 'MINE', '#1a1a1a'); }
        if (t.pw.teleport) { roundBtn(R.tele, 'rgba(150,70,230,0.85)', true); label(R.tele, 'TELE', '#fff'); }
        for (const kk of ['move', 'aim']) {
          const s = sticks[kk]; if (!s) continue;
          if (kk === 'aim') { drawFinger(s); continue; }
          ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(s.ox, s.oy, 60, 0, Math.PI * 2); ctx.stroke();
          ctx.fillStyle = 'rgba(61,139,255,0.7)'; ctx.beginPath(); ctx.arc(s.x, s.y, 28, 0, Math.PI * 2); ctx.fill();
        }
        // a tap fires weapon 1: say which
        ctx.font = font(12 * k); ctx.textAlign = 'right'; ctx.textBaseline = 'middle'; ctx.fillStyle = 'rgba(255,243,207,0.85)';
        ctx.fillText(`TAP: ${wName(t, 0)} ${ammoText(t, 0)}`, R.mine.x - 12, R.fire2.y + R.fire2.h / 2);
      }
      if (P && !touchMode && state === 'playing') {                         // PC: what each mouse button fires
        const t = P.tank, txt = `LEFT CLICK / F: ${wName(t, 0)} ${ammoText(t, 0)}     RIGHT CLICK / Q: ${wName(t, 1)} ${ammoText(t, 1)}`;
        ctx.font = font(13 * k); ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
        const tw = ctx.measureText(txt).width + 20;
        ctx.fillStyle = 'rgba(0,0,0,0.55)'; rr(8, view.ch - 34 * k, tw, 26 * k, 6); ctx.fill();
        ctx.fillStyle = '#fff3cf'; ctx.fillText(txt, 18, view.ch - 21 * k);
      }
      if (P && !touchMode && state === 'playing' && mouse.inside) {
        const sx = view.ox + mouse.x * view.scale, sy = view.oy + mouse.y * view.scale;
        ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(sx, sy, 9, 0, Math.PI * 2); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(sx - 14, sy); ctx.lineTo(sx - 5, sy); ctx.moveTo(sx + 5, sy); ctx.lineTo(sx + 14, sy); ctx.moveTo(sx, sy - 14); ctx.lineTo(sx, sy - 5); ctx.moveTo(sx, sy + 5); ctx.lineTo(sx, sy + 14); ctx.stroke();
      }
      if (P && state === 'playing' && !P.tank.alive) {
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = font(20 * k);
        ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(0, view.ch - 64, view.cw, 40);
        ctx.fillStyle = '#fff3cf'; ctx.fillText(canRespawn(P) ? 'RESPAWNING...' : "YOU'RE OUT - WATCHING THE REST", view.cw / 2, view.ch - 44);
      }
    }
    const banner = (big, small, y) => {
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(0, y - 52, view.cw, small ? 104 : 84);
      ctx.fillStyle = '#fff3cf'; ctx.font = font(38 * Math.min(1.6, view.scale + 0.4)); ctx.fillText(big, view.cw / 2, small ? y - 12 : y);
      if (small) { ctx.font = font(18 * Math.min(1.6, view.scale + 0.4)); ctx.fillStyle = '#f0c25c'; ctx.fillText(small, view.cw / 2, y + 28); }
    };
    const goal = { battle: vs.teams ? 'LAST TEAM STANDING WINS' : 'LAST TANK STANDING WINS', slayer: `FIRST TO ${vs.rules.kills} KILLS WINS`, slaughter: 'MOST KILLS WHEN THE TIME RUNS OUT WINS' }[vs.rules.mode];
    if (state === 'place') {
      const left = Math.max(0, Math.ceil(PLACE_T - stateT)), turnP = vs.role === 'local' ? vs.players[vs.placers[vs.placeTurn]] : vs.players.find(q => q.ctl === 'me');
      if (turnP && turnP.tank.pw.teleport) banner(`${vs.role === 'local' ? turnP.name + ': ' : ''}PLACE YOUR TELEPORT SQUARES`, `TAP A SQUARE  -  ${padsOf(turnP.idx).length} / ${MAX_PADS}  -  ${left}s`, view.ch * 0.82);
      else banner('GET READY!', `TELEPORTERS ARE PLACING THEIR SQUARES  -  ${left}s`, view.ch * 0.82);
    }
    else if (state === 'intro') banner('GET READY!', `${MODES.find(m => m.id === vs.rules.mode).label}  -  ${goal}`, view.ch / 2);
    else if (state === 'over' && stateT > 0.6) {
      const w = winnerName();
      banner(w ? `${w} WINS!` : 'DRAW!', vs.role === 'local' ? 'BACK TO THE MAP CHOICE...' : 'BACK TO THE LOBBY...', view.ch / 2);
    }
    drawLeaderboard(R);
  }
  // a map's picture for the lobby and the map lists (drawn into any canvas, the game itself untouched)
  function renderMap(g, L0, w, h) {
    const keep = [COLS, ROWS, W, H, map, barrels, level, ctx, pads];
    try {
      level = fromGrid(L0); COLS = level.cols; ROWS = level.rows; W = COLS * TILE; H = ROWS * TILE; map = buildLevel(level); fillBarrels(true);
      const sc = Math.min(w / W, h / H);
      ctx = g; g.save(); g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, w, h);
      g.translate((w - W * sc) / 2, (h - H * sc) / 2); g.scale(sc, sc);
      drawFloor(); if (level.colors && level.colors.floor) tintFill(g, level.colors.floor, W, H);
      drawWallsTinted();
      spawnsOf(level).forEach((s, i) => drawFlag(s[0] * TILE, s[1] * TILE, FLAG_COLORS[i % FLAG_COLORS.length][1], i + 1, 1));
      g.restore();
    } finally { [COLS, ROWS, W, H, map, barrels, level, ctx, pads] = keep; }
  }

  let last = 0;
  // A phone that can't keep up (under ~40 frames a second for 2 s of play) draws at a lower resolution: 2x -> 1.5x -> 1x.
  const perf = { maxDpr: 2, slow: 0 };
  function watchSpeed(raw) {
    if (!(state === 'playing' || state === 'intro') || raw > 0.25 || document.hidden) { perf.slow = 0; return; }   // a pause / tab switch is not lag
    perf.slow = raw > 0.025 ? perf.slow + raw : Math.max(0, perf.slow - raw);
    if (perf.slow > 2 && dpr > 1) { perf.maxDpr = dpr > 1.5 ? 1.5 : 1; perf.slow = 0; resize(); }
  }
  function frame(now) {
    const raw = (now - last) / 1000 || 0, dt = Math.min(0.05, raw); last = now;
    watchSpeed(raw);
    if (state !== 'idle' && state !== 'paused' && state !== 'dead-paused' && state !== 'edit') update(dt);
    if (state !== 'idle') applyCam(dt);
    // music: plays through the mission card and the fight, holds while paused, stops (and rewinds) on death, a cleared mission, or the menus
    Music.want(state === 'intro' || state === 'playing' || state === 'place' ? (level.floor || 'indoor') : state === 'paused' ? 'pause' : null);
    draw();
    requestAnimationFrame(frame);
  }
  function init() {
    canvas = document.getElementById('game'); ctx = canvas.getContext('2d');
    resize(); window.addEventListener('resize', resize);
    bindInput();
    requestAnimationFrame(frame);
  }

  return {
    init, start, pause, resume, stop, recolor, advance, edit, playCustom, setInset, pickTile, drawTankPreview,
    versus: startVersus, vsMessage, vsLeave, spawnsOf, renderMap, get isVersus() { return !!vs; },
    get vsInfo() { return vs ? { role: vs.role, state, winner: vs.winner, winTeam: vs.winTeam, winnerName: winnerName(), rules: vs.rules, timeLeft: vs.timeLeft, lb: { open: lb.open, k: lb.k },
      players: vs.players.map(P => ({ id: P.id, name: P.name, team: P.team, lives: P.lives, kills: P.kills, deaths: P.deaths, alive: P.tank.alive, x: P.tank.x, y: P.tank.y, ctl: P.ctl, left: P.left, out: P.tank.out, model: P.tank.pw.model, weapons: P.tank.pw.weapons })) } : null; },
    get isCustom() { return !!customLevel && state !== 'edit'; }, set editHover(v) { editHover = v; },
    get state() { return state; },
    get save() { return save; },
    set onPause(fn) { onPause = fn; },
    set onLeave(fn) { onLeave = fn; },
    debug: {
      get player() { return player; }, get tanks() { return tanks; }, get shells() { return shells; }, get mines() { return mines; }, get xmarks() { return xmarks; },
      get vs() { return vs; }, act, playerTeleport, get ss() { return ss; }, lb, vsRects: () => vsRects(), ranking: () => ranking().map(P => P.name), checkWinner, killTank,
      get map() { return map; }, get barrels() { return barrels; }, get level() { return level; }, get stateT() { return stateT; },
      screenOf: (x, y) => ({ x: view.ox + x * view.scale, y: view.oy + y * view.scale }), spill, slow: slowAt, explode, seedMines, simWave, hitTank, freezeAt, homingAim, teleport, get pads() { return pads; }, get ices() { return ices; }, get clock() { return clock; },
      fire: t => fire(t || player), mine: () => layMine(player), visible: tankVisible, onLava, simShot, chooseShot, los, bfs, kill: t => killTank(t || player), tick: dt => update(dt), skipIntro: () => { if (state === 'intro') { state = 'playing'; stateT = 0; } },
      key: (code, down) => { keys[code] = down; }, aim: a => { player.turret = a; touchMode = true; }, get sticks() { return sticks; }, ammoText, get consts() { return { TILE, COLS, ROWS, W, H }; },
    },
  };
})();
