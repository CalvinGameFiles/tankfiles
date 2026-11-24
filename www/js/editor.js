'use strict';
// LEVEL CREATOR (title -> LEVEL CREATOR) and the TANK CREATOR it opens.
// A level here is { id, name, cols, rows, tiles: [tile number per square], player: [x, y], enemies: [[type, x, y]], floor, colors }.
// The game draws it (Game.edit) while the panels around it change it; TEST plays it (Game.playCustom) and comes back.
const Editor = (() => {
  const $ = id => document.getElementById(id);
  const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
  const V = { floor: 0, wall: 1, crate: 2, hole: 3, platform: 4, ramp: 5, water: 6, lava: 7, acid: 8, tar: 9, oil: 10, tele: 11 };
  const SOLIDISH = [V.wall, V.crate, V.hole];                    // no tank can be placed on these
  const MAX_TELE = 10, MIN_COLS = 8, MAX_COLS = 40, MIN_ROWS = 6, MAX_ROWS = 28;
  const BLOCKS = [
    { id: 'erase', label: 'ERASER', chip: 'repeating-conic-gradient(#ddd 0 25%, #999 0 50%) 0 0 / 10px 10px' },
    { id: 'wall', label: 'WALL', v: V.wall, chip: '#6a6a78' },
    { id: 'crate', label: 'BREAKABLE', v: V.crate, chip: '#c48a44' },
    { id: 'hole', label: 'HOLE', v: V.hole, chip: '#1b1713' },
    { id: 'platform', label: 'PLATFORM', v: V.platform, chip: '#c9ced8' },
    { id: 'ramp', label: 'RAMP', v: V.ramp, chip: '#9aa0aa' },
    { id: 'water', label: 'WATER', v: V.water, chip: '#3d8fd8' },
    { id: 'lava', label: 'LAVA', v: V.lava, chip: '#ff6a1a' },
    { id: 'acid', label: 'ACID', v: V.acid, chip: '#6ad62a' },
    { id: 'tar', label: 'TAR', v: V.tar, chip: '#17161b' },
    { id: 'oil', label: 'OIL', v: V.oil, chip: '#e3bd17' },
    { id: 'tele', label: 'TELEPORT', v: V.tele, chip: '#8a3fe0' },
  ];
  const CAMPAIGN = [['brown', 'LIGHT BROWN'], ['darkbrown', 'DARK BROWN'], ['cyan', 'BLUE'], ['yellow', 'YELLOW'], ['red', 'RED'], ['green', 'LIME GREEN'], ['purple', 'PURPLE'],
    ['white', 'WHITE'], ['black', 'BLACK'], ['silver', 'SILVER'], ['bomber', 'OIL BOMBER'], ['orange', 'ORANGE'], ['pine', 'DPG']];
  const STYLES = [[null, 'INDOOR'], ['grass', 'GRASSLAND'], ['snow', 'SNOWY MOUNTAIN'], ['sand', 'DESERT'], ['beach', 'BEACH'], ['volcano', 'VOLCANO'], ['factory', 'FACTORY'], ['battle', 'BATTLEFIELD'], ['grave', 'GRAVEYARD']];
  const COLOR_KEYS = [['floor', 'Floor'], ['wall', 'Walls'], ['crate', 'Breakable blocks'], ['hole', 'Holes'], ['platform', 'Platforms + ramps'], ['water', 'Water'], ['lava', 'Lava'],
    ['acid', 'Acid'], ['tar', 'Tar'], ['oil', 'Oil'], ['tele', 'Teleport']];
  // the colour grid: 12 hues in 4 shades, then 12 greys from white to black
  const PALETTE = (() => {
    const hex = (h, s, l) => { const f = n => { const k = (n + h / 30) % 12, a = s * Math.min(l, 1 - l); return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))).toString(16).padStart(2, '0'); }; return '#' + f(0) + f(8) + f(4); };
    const out = [];
    for (const l of [0.82, 0.62, 0.45, 0.28]) for (let h = 0; h < 360; h += 30) out.push(hex(h, l > 0.7 ? 0.9 : 0.8, l));
    for (let i = 0; i < 12; i++) out.push(hex(0, 0, 1 - i / 11));
    return out;
  })();

  let L = null, tool = { kind: 'tile', id: 'wall', v: V.wall }, tab = 'blocks', painting = null, lastCell = null;

  // ---------- level data ----------
  function blank(cols, rows) {
    const tiles = new Array(cols * rows).fill(0);
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) if (!r || !c || r === rows - 1 || c === cols - 1) tiles[r * cols + c] = V.wall;
    return { id: 'lv_' + Date.now().toString(36), name: 'MY LEVEL', cols, rows, tiles, player: [2.5, Math.floor(rows / 2) + 0.5], enemies: [], floor: null, colors: {} };
  }
  // a LOCAL MAP (for multiplayer): coloured spawn flags instead of tanks; flag 1 (blue) is player 1's start, flag 2 (red) player 2's...
  function blankLocal(cols, rows) {
    const L = blank(cols, rows), mid = Math.floor(rows / 2) + 0.5;
    return Object.assign(L, { id: 'lm_' + Date.now().toString(36), name: 'MY LOCAL MAP', player: null, local: true, flags: [[0, 2.5, mid], [1, cols - 2.5, mid]] });
  }
  const flagAt = (c, r) => (L.flags || []).findIndex(f => Math.floor(f[1]) === c && Math.floor(f[2]) === r);
  const count = v => L.tiles.filter(x => x === v).length;
  const tankAt = (c, r) => L.enemies.findIndex(e => Math.floor(e[1]) === c && Math.floor(e[2]) === r);
  const playerAt = (c, r) => L.player && Math.floor(L.player[0]) === c && Math.floor(L.player[1]) === r;
  function resizeLevel(cols, rows) {
    cols = Math.max(MIN_COLS, Math.min(MAX_COLS, cols)); rows = Math.max(MIN_ROWS, Math.min(MAX_ROWS, rows));
    if (cols === L.cols && rows === L.rows) return;
    const n = blank(cols, rows).tiles;
    for (let r = 1; r < Math.min(rows, L.rows) - 1; r++) for (let c = 1; c < Math.min(cols, L.cols) - 1; c++) n[r * cols + c] = L.tiles[r * L.cols + c];
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) if (!r || !c || r === rows - 1 || c === cols - 1) n[r * cols + c] = V.wall;
    const inside = (x, y) => x > 1 && y > 1 && x < cols - 1 && y < rows - 1;
    L.enemies = L.enemies.filter(e => inside(e[1], e[2]));
    if (L.flags) L.flags = L.flags.filter(f => inside(f[1], f[2]));
    if (L.player && !inside(L.player[0], L.player[1])) L.player = null;
    L.cols = cols; L.rows = rows; L.tiles = n;
  }

  // ---------- painting the map ----------
  function applyAt(c, r, erase, first) {
    if (!L || c <= 0 || r <= 0 || c >= L.cols - 1 || r >= L.rows - 1) return;
    const i = r * L.cols + c, k = erase ? 'erase' : tool.kind;
    if (k === 'erase') {
      const t = tankAt(c, r), f = L.local ? flagAt(c, r) : -1;
      if (f >= 0) L.flags.splice(f, 1); else if (t >= 0) L.enemies.splice(t, 1); else if (playerAt(c, r)) L.player = null; else L.tiles[i] = V.floor;
    } else if (k === 'tile') {
      if (L.tiles[i] === tool.v) return;
      if (tool.v === V.tele && count(V.tele) >= MAX_TELE) { UI.toast(`Up to ${MAX_TELE} teleport squares`); return; }
      L.tiles[i] = tool.v;
      if (SOLIDISH.includes(tool.v)) { const t = tankAt(c, r); if (t >= 0) L.enemies.splice(t, 1); if (playerAt(c, r)) L.player = null; const f = L.local ? flagAt(c, r) : -1; if (f >= 0) L.flags.splice(f, 1); }
    } else if (k === 'flag') {
      if (!first || !L.local) return;
      if (SOLIDISH.includes(L.tiles[i])) { UI.toast("Flags can't go on walls, breakable blocks or holes"); return; }
      const here = flagAt(c, r), mineI = L.flags.findIndex(f => f[0] === tool.k);
      if (here >= 0 && L.flags[here][0] === tool.k) L.flags.splice(here, 1);              // tap the same flag again to take it away
      else {
        if (here >= 0) L.flags.splice(here, 1);
        const j = L.flags.findIndex(f => f[0] === tool.k); if (j >= 0) L.flags.splice(j, 1);  // each colour once: placing it again moves it
        L.flags.push([tool.k, c + 0.5, r + 0.5]); L.flags.sort((a, b) => a[0] - b[0]);
        if (mineI < 0) { const nx = FLAG_COLORS.findIndex((q, n) => !L.flags.some(f => f[0] === n)); if (nx >= 0) tool = { kind: 'flag', k: nx }; renderTanks(); }   // straight on to the next colour
      }
    } else if (k === 'tank') {
      if (!first) return;
      if (SOLIDISH.includes(L.tiles[i])) { UI.toast("Tanks can't go on walls, breakable blocks or holes"); return; }
      const t = tankAt(c, r);
      if (tool.type === 'player') { if (t >= 0) L.enemies.splice(t, 1); L.player = [c + 0.5, r + 0.5]; }
      else if (t >= 0 && L.enemies[t][0] === tool.type) L.enemies.splice(t, 1);          // tap the same tank again to take it away
      else {
        if (playerAt(c, r)) { UI.toast('The player tank is there'); return; }
        if (t >= 0) L.enemies.splice(t, 1);
        if (L.enemies.length >= 40) { UI.toast('That is 40 tanks - the most a level can hold'); return; }
        L.enemies.push([tool.type, c + 0.5, r + 0.5]);
      }
    }
    refresh();
  }
  function bindCanvas() {
    const cv = $('game');
    const on = () => $('editor').classList.contains('active') && Game.state === 'edit';
    cv.addEventListener('pointerdown', e => {
      if (!on()) return;
      const p = Game.pickTile(e.clientX, e.clientY);
      painting = { erase: e.button === 2 }; lastCell = p.c + ',' + p.r;
      applyAt(p.c, p.r, painting.erase, true);
      try { cv.setPointerCapture(e.pointerId); } catch (err) {}
    });
    cv.addEventListener('pointermove', e => {
      if (!on()) return;
      const p = Game.pickTile(e.clientX, e.clientY); Game.editHover = p;
      if (painting && lastCell !== p.c + ',' + p.r) { lastCell = p.c + ',' + p.r; applyAt(p.c, p.r, painting.erase, false); }
    });
    const end = () => { painting = null; lastCell = null; };
    cv.addEventListener('pointerup', end); cv.addEventListener('pointercancel', end);
    cv.addEventListener('pointerleave', () => { if (on()) Game.editHover = null; });
  }

  // ---------- screens ----------
  function open() {
    if (!L) L = Store.draft && Store.draft.tiles ? Store.draft : blank(24, 16);
    UI.page('editor'); renderAll(); layout(); refresh();
  }
  function resume() { UI.page('editor'); renderAll(); layout(); refresh(); }
  function close() { Game.editHover = null; Game.stop(); Game.setInset(null); UI.page('title'); }
  function layout() {
    if (!$('editor').classList.contains('active')) return;
    const top = $('edTop').getBoundingClientRect(); $('edSide').style.top = top.bottom + 'px';   // the top bar may wrap onto two rows on a small screen
    const side = $('edSide').getBoundingClientRect();
    Game.setInset({ l: 6, t: top.bottom + 6, r: window.innerWidth - side.left + 6, b: 6 });
  }
  function refresh() {
    Game.edit(L); Store.setDraft(L);
    $('edCols').textContent = L.cols; $('edRows').textContent = L.rows;
    const tb = document.querySelector('#edBlocks [data-block=tele] small'); if (tb) tb.textContent = `${count(V.tele)}/${MAX_TELE}`;
    $('edHint').textContent = L.local ? `LOCAL MAP: ${L.flags.length} spawn flag${L.flags.length === 1 ? '' : 's'} - up to ${L.flags.length} players`
      : `${L.enemies.length} enemy tank${L.enemies.length === 1 ? '' : 's'}` + (L.player ? '' : ' - no player tank yet!');
    $('edLocal').textContent = L.local ? 'NORMAL LEVEL' : 'LOCAL MAP';
    const tb2 = document.querySelector('#edTabs [data-tab=tanks]'); if (tb2) tb2.textContent = L.local ? 'FLAGS' : 'TANKS';
  }
  function renderAll() {
    $('edName').value = L.name || '';
    document.querySelectorAll('#edTabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
    for (const p of ['blocks', 'tanks', 'style']) $('ed' + p[0].toUpperCase() + p.slice(1)).classList.toggle('hidden', p !== tab);
    renderBlocks(); renderTanks(); renderStyle();
  }
  function renderBlocks() {
    const box = $('edBlocks'); box.innerHTML = '';
    for (const b of BLOCKS) {
      const on = (b.id === 'erase' && tool.kind === 'erase') || (tool.kind === 'tile' && tool.id === b.id);
      const chipCol = b.v != null && L.colors[keyOf(b.id)] ? L.colors[keyOf(b.id)] : b.chip;
      const e = el('button', 'ed-tool' + (on ? ' on' : ''), `<i style="background:${chipCol}"></i><span>${b.label}</span>${b.id === 'tele' ? '<small></small>' : ''}`);
      e.dataset.block = b.id;
      e.addEventListener('click', () => { Sfx.click(); tool = b.id === 'erase' ? { kind: 'erase', id: 'erase' } : { kind: 'tile', id: b.id, v: b.v }; renderBlocks(); refresh(); });
      box.appendChild(e);
    }
    box.appendChild(el('div', 'ed-note', 'Drag to paint. Right-click (or the eraser) clears a square. Teleport squares: 1 to 10, for tanks with Teleportation.'));
  }
  const keyOf = id => id === 'ramp' ? 'platform' : id;
  function tankCanvas(T, size) {
    const cv = el('canvas'); cv.width = cv.height = size * 2; cv.style.width = cv.style.height = size + 'px';
    Game.drawTankPreview(cv.getContext('2d'), T, { x: size, y: size, scale: size / 22, turret: -0.6, noHearts: true });
    return cv;
  }
  function renderTanks() {
    const box = $('edTanks'); box.innerHTML = '';
    if (L.local) {                                                          // a Local map: the 10 spawn flags, in order
      FLAG_COLORS.forEach(([id, col, label], k) => {
        const placed = L.flags.some(f => f[0] === k);
        const b = el('button', 'ed-tank ed-flag' + (tool.kind === 'flag' && tool.k === k ? ' on' : '') + (placed ? ' placed' : ''), `<i style="background:${col}">${k + 1}</i><span>${label}${placed ? ' &#10003;' : ''}</span>`);
        b.dataset.flag = k;
        b.addEventListener('click', () => { Sfx.click(); tool = { kind: 'flag', k }; renderTanks(); });
        box.appendChild(b);
      });
      box.appendChild(el('div', 'ed-note', 'Each flag is a spawn: player 1 starts on BLUE, player 2 on RED, then yellow, green, orange, purple, light pink, brown, light blue, magenta. A map holds as many players as it has flags. Tap a square to place the flag, tap it again to take it away.'));
      return;
    }
    const add = (type, label, T, custom) => {
      const b = el('button', 'ed-tank' + (tool.kind === 'tank' && tool.type === type ? ' on' : ''));
      b.appendChild(tankCanvas(T, 30)); b.appendChild(el('span', '', label)); b.dataset.tank = type;
      b.addEventListener('click', () => { Sfx.click(); tool = { kind: 'tank', type }; renderTanks(); });
      if (custom) {
        const ed = el('span', 'ed-edit', '&#9998;'); ed.title = 'Edit this tank';
        ed.addEventListener('click', ev => { ev.stopPropagation(); Sfx.click(); openTank(custom); });
        b.appendChild(ed);
      }
      box.appendChild(b);
    };
    add('player', 'PLAYER', { col: PLAYER_COLORS[Store.opts.color] || PLAYER_COLORS.blue });
    for (const [k, label] of CAMPAIGN) add(k, label, TANK_TYPES[k]);
    const mk = el('button', 'ed-create', '+ CREATE TANK'); mk.id = 'edCreateTank';
    mk.addEventListener('click', () => { Sfx.click(); openTank(null); });
    box.appendChild(mk);
    for (const s of Store.customTanks) add('c_' + s.id, (s.name || 'CUSTOM').toUpperCase(), TANK_TYPES['c_' + s.id], s);
    box.appendChild(el('div', 'ed-note', 'Tap a square to place the tank, tap it again to take it away. War trains pick up the load tanks placed in a line right behind them (up to 5).'));
  }
  function renderStyle() {
    const box = $('edStyle'); box.innerHTML = '';
    box.appendChild(el('div', 'ed-sub', 'MAP STYLE'));
    const g = el('div', 'ed-styles');
    for (const [k, label] of STYLES) {
      const b = el('button', 'ed-style' + ((L.floor || null) === k ? ' on' : ''), label);
      b.addEventListener('click', () => { Sfx.click(); L.floor = k; renderStyle(); refresh(); });
      g.appendChild(b);
    }
    box.appendChild(g);
    box.appendChild(el('div', 'ed-sub', 'COLOURS'));
    for (const [k, label] of COLOR_KEYS) {
      const row = el('div', 'ed-crow'), cur = L.colors[k];
      row.appendChild(el('span', '', label));
      const chip = el('button', 'ed-chip' + (cur ? '' : ' def'), cur ? '' : 'DEFAULT'); chip.dataset.color = k;
      if (cur) chip.style.background = cur;
      chip.addEventListener('click', () => { Sfx.click(); pickColor(cur, c => { if (c) L.colors[k] = c; else delete L.colors[k]; renderStyle(); renderBlocks(); refresh(); }); });
      row.appendChild(chip);
      box.appendChild(row);
    }
  }
  // the colour grid pop-up: a swatch, any colour from the picker, or DEFAULT (null)
  function pickColor(cur, done) {
    const box = $('palBox'), grid = $('palGrid'); grid.innerHTML = '';
    for (const c of PALETTE) {
      const s = el('button', 'pal-sw' + (c === cur ? ' on' : '')); s.style.background = c; s.dataset.c = c;
      s.addEventListener('click', () => { Sfx.click(); box.classList.add('hidden'); done(c); });
      grid.appendChild(s);
    }
    $('palAny').value = cur || '#ff0000';
    $('palAny').onchange = e => { box.classList.add('hidden'); done(e.target.value); };
    $('palDefault').onclick = () => { Sfx.click(); box.classList.add('hidden'); done(null); };
    $('palClose').onclick = () => { Sfx.click(); box.classList.add('hidden'); };
    box.classList.remove('hidden');
  }

  // ---------- top bar ----------
  function test() {
    if (L.local) {                                                          // a Local map: try it out as a split screen battle
      if (L.flags.length < 2) { UI.toast('Place at least the BLUE and RED flags to test'); return; }
      Store.setDraft(L); Game.editHover = null;
      Versus.startSplit(JSON.parse(JSON.stringify(L)), () => resume());
      return;
    }
    if (!L.player) { UI.toast('Place the player tank first'); return; }
    if (!L.enemies.length) { UI.toast('Place at least one enemy tank'); return; }
    if (L.enemies.some(([k]) => TANK_TYPES[k] && TANK_TYPES[k].teleport) && count(V.tele) < 1) { UI.toast('A teleporting tank needs at least 1 teleport square', 2400); return; }
    Store.setDraft(L);
    Game.editHover = null; UI.page(null);
    Game.playCustom(JSON.parse(JSON.stringify(L)), () => resume());
  }
  function openLoad() {
    const list = $('edLoadList'); list.innerHTML = '';
    const local = !!L.local, saved = local ? Store.localMaps : Store.customLevels;
    $('edLoadBox').querySelector('h3').textContent = local ? 'SAVED LOCAL MAPS' : 'SAVED LEVELS';
    if (!saved.length) list.appendChild(el('div', 'ed-note', local ? 'No saved Local maps yet. Press SAVE to keep the one you are making.' : 'No saved levels yet. Press SAVE to keep the one you are making.'));
    for (const s of saved.slice().sort((a, b) => (b.updated || 0) - (a.updated || 0))) {
      const row = el('div', 'ed-lrow'), go = el('button', 'sbtn', `${s.name || 'LEVEL'} <small>${s.cols}x${s.rows}, ${local ? (s.flags || []).length + ' flags' : s.enemies.length + ' tanks'}</small>`), del = el('button', 'sbtn red', '&#10005;');
      go.addEventListener('click', () => { Sfx.click(); L = JSON.parse(JSON.stringify(s)); if (!L.colors) L.colors = {}; $('edLoadBox').classList.add('hidden'); renderAll(); refresh(); layout(); UI.toast('Loaded ' + L.name); });
      del.addEventListener('click', () => { Sfx.click(); UI.confirm(`Delete "${s.name}"?`, () => { if (local) Store.deleteLocalMap(s.id); else Store.deleteLevel(s.id); openLoad(); }); });
      row.appendChild(go); row.appendChild(del); list.appendChild(row);
    }
    $('edLoadBox').classList.remove('hidden');
  }

  // ---------- tank creator ----------
  const PICK = ['#ff0000', '#00ff00', '#0000ff', '#ffff00', '#ff00ff', '#00ffff', '#800000', '#008000', '#000080'];   // one flat colour per part on the hidden pick map
  let spec = null, selColor = '#e23b3b', isNew = true;
  const tmView = () => ({ x: 180, y: 140, scale: 5.2, turret: -0.6 });
  function openTank(existing) {
    isNew = !existing;
    spec = existing ? JSON.parse(JSON.stringify(existing)) : { id: Date.now().toString(36), name: 'MY TANK', col: Object.assign({}, BLANK_TANK_COLS), powers: [], speed: 50, hp: 1, dropLiquid: 'oil', dropSize: 3, enchantRange: 16 };
    spec.col = Object.assign({}, BLANK_TANK_COLS, spec.col);
    UI.page('tankmaker');
    $('tmName').value = spec.name; $('tmDelete').classList.toggle('hidden', isNew);
    renderTankMaker();
  }
  function drawTankBig() {
    const cv = $('tmCanvas'), g = cv.getContext('2d'), T = customType(spec);
    g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, cv.width, cv.height);
    const k = cv.width / 360; g.setTransform(k, 0, 0, k, 0, 0);
    const bg = g.createRadialGradient(180, 140, 20, 180, 140, 200); bg.addColorStop(0, '#d9c7a3'); bg.addColorStop(1, '#a9946c');
    g.fillStyle = bg; g.fillRect(0, 0, 360, 280);
    Game.drawTankPreview(g, T, Object.assign(tmView(), { noHearts: true }));
    // the hidden pick map: the same tank, each part one flat colour
    const pc = $('tmPick'); pc.width = cv.width; pc.height = cv.height; const p = pc.getContext('2d');
    p.setTransform(k, 0, 0, k, 0, 0); p.clearRect(0, 0, 360, 280);
    Game.drawTankPreview(p, T, Object.assign(tmView(), { plain: true, col: Object.assign({ dark: PICK[2], light: PICK[4], x: PICK[3] }, Object.fromEntries(TANK_PARTS.map((q, i) => [q.k, PICK[i]]))) }));
  }
  function partAt(ev) {
    const cv = $('tmCanvas'), r = cv.getBoundingClientRect(), x = Math.floor((ev.clientX - r.left) * cv.width / r.width), y = Math.floor((ev.clientY - r.top) * cv.height / r.height);
    const d = $('tmPick').getContext('2d').getImageData(x, y, 1, 1).data;
    if (d[3] < 200) return null;
    const i = PICK.findIndex(h => { const n = parseInt(h.slice(1), 16); return Math.abs((n >> 16) - d[0]) < 12 && Math.abs(((n >> 8) & 255) - d[1]) < 12 && Math.abs((n & 255) - d[2]) < 12; });
    return i >= 0 ? TANK_PARTS[i].k : null;
  }
  function paint(k) { spec.col[k] = selColor; Sfx.click(); renderTankMaker(); }
  function renderTankMaker() {
    drawTankBig();
    const parts = $('tmParts'); parts.innerHTML = '';
    for (const q of TANK_PARTS) {
      const b = el('button', 'tm-part', `<i style="background:${spec.col[q.k]}"></i>${q.label}`); b.dataset.part = q.k;
      b.addEventListener('click', () => paint(q.k)); parts.appendChild(b);
    }
    const pal = $('tmPalette'); pal.innerHTML = '';
    for (const c of PALETTE) {
      const s = el('button', 'pal-sw' + (c === selColor ? ' on' : '')); s.style.background = c; s.dataset.c = c;
      s.addEventListener('click', () => { selColor = c; Sfx.click(); renderTankMaker(); }); pal.appendChild(s);
    }
    $('tmCur').style.background = selColor;
    $('tmSpeed').value = spec.speed; $('tmSpeedV').textContent = spec.speed + '%';
    $('tmHp').value = spec.hp; $('tmHpV').textContent = spec.hp;
    const has = id => spec.powers.includes(id);
    $('tmDropOpts').classList.toggle('hidden', !has('dropper'));
    $('tmEnchOpts').classList.toggle('hidden', !has('enchanter'));
    $('tmSpeedRow').classList.toggle('dim', has('still'));
    document.querySelectorAll('#tmDropLiq button').forEach(b => b.classList.toggle('on', b.dataset.liq === spec.dropLiquid));
    $('tmDropSize').value = spec.dropSize; $('tmDropSizeV').textContent = `${spec.dropSize}x${spec.dropSize}`;
    $('tmEnch').value = spec.enchantRange; $('tmEnchV').textContent = spec.enchantRange + ' squares';
    const pw = $('tmPowers'); pw.innerHTML = '';
    for (const p of POWERS) {
      const b = el('button', 'tm-pow' + (has(p.id) ? ' on' : ''), p.label); b.title = p.desc; b.dataset.power = p.id;
      b.addEventListener('click', () => {
        Sfx.click();
        if (has(p.id)) { $('tmDesc').textContent = p.desc; return; }
        const r = addPower(spec.powers, p.id);
        if (r.powers === spec.powers && r.msg) { UI.toast(r.msg, 2400); return; }
        spec.powers = r.powers; if (r.msg) UI.toast(r.msg, 2000);
        $('tmDesc').textContent = p.desc; renderTankMaker();
      });
      pw.appendChild(b);
    }
    const sel = $('tmSelected'); sel.innerHTML = '';
    if (!spec.powers.length) sel.appendChild(el('div', 'ed-note', 'No powers yet: a plain tank with one bouncing shell.'));
    for (const id of spec.powers) {
      const b = el('button', 'tm-chip', POWER[id].label + ' &#10005;'); b.dataset.power = id;
      b.addEventListener('click', () => { Sfx.click(); spec.powers = spec.powers.filter(x => x !== id); renderTankMaker(); });
      sel.appendChild(b);
    }
  }
  function saveTank() {
    spec.name = ($('tmName').value || '').trim().slice(0, 18) || 'MY TANK';
    Store.saveTank(spec); registerCustomTank(spec);
    tool = { kind: 'tank', type: 'c_' + spec.id }; tab = 'tanks';
    UI.toast(`${spec.name} saved`); resume();
  }
  function deleteTank() {
    UI.confirm(`Delete the tank "${spec.name}"? It is taken off this level too.`, () => {
      Store.deleteTank(spec.id); delete TANK_TYPES['c_' + spec.id];
      if (L) L.enemies = L.enemies.filter(e => e[0] !== 'c_' + spec.id);
      if (tool.type === 'c_' + spec.id) tool = { kind: 'tile', id: 'wall', v: V.wall };
      resume();
    });
  }

  // ---------- wiring ----------
  function init() {
    bindCanvas();
    $('edBack').addEventListener('click', () => { Sfx.click(); close(); });
    $('edName').addEventListener('input', e => { L.name = e.target.value.slice(0, 24); Store.setDraft(L); });
    document.querySelectorAll('[data-size]').forEach(b => b.addEventListener('click', () => {
      Sfx.click(); const k = b.dataset.size, d = k[1] === '+' ? 1 : -1;
      resizeLevel(L.cols + (k[0] === 'c' ? d : 0), L.rows + (k[0] === 'r' ? d : 0)); refresh();
    }));
    $('edNew').addEventListener('click', () => { Sfx.click(); UI.confirm('Start a new empty map? Save this one first if you want to keep it.', () => { L = L.local ? blankLocal(L.cols, L.rows) : blank(L.cols, L.rows); renderAll(); refresh(); }); });
    $('edSave').addEventListener('click', () => {
      Sfx.click(); L.name = ($('edName').value || 'MY LEVEL').trim() || 'MY LEVEL';
      if (L.local) { Store.saveLocalMap(L); UI.toast(`Saved "${L.name}" - pick it in multiplayer under CREATED MAPS`, 2600); } else { Store.saveLevel(L); UI.toast(`Saved "${L.name}"`); }
    });
    $('edLocal').addEventListener('click', () => {
      Sfx.click();
      const toLocal = !L.local;
      UI.confirm(toLocal ? 'Start a new LOCAL MAP for multiplayer (spawn flags instead of tanks)? Save this level first if you want to keep it.' : 'Start a new normal level? Save this Local map first if you want to keep it.', () => {
        L = toLocal ? blankLocal(L.cols, L.rows) : blank(L.cols, L.rows);
        tool = toLocal ? { kind: 'flag', k: 2 } : { kind: 'tile', id: 'wall', v: V.wall }; tab = toLocal ? 'tanks' : 'blocks';
        renderAll(); refresh();
      });
    });
    $('edLoad').addEventListener('click', () => { Sfx.click(); openLoad(); });
    $('edLoadClose').addEventListener('click', () => { Sfx.click(); $('edLoadBox').classList.add('hidden'); });
    $('edTest').addEventListener('click', () => { Sfx.click(); test(); });
    document.querySelectorAll('#edTabs button').forEach(b => b.addEventListener('click', () => { Sfx.click(); tab = b.dataset.tab; renderAll(); }));
    window.addEventListener('resize', () => setTimeout(layout, 30));
    // tank creator
    $('tmCanvas').addEventListener('pointerdown', e => { const k = partAt(e); if (k) paint(k); });
    $('tmAny').addEventListener('input', e => { selColor = e.target.value; $('tmCur').style.background = selColor; });
    $('tmAny').addEventListener('change', () => renderTankMaker());
    $('tmSpeed').addEventListener('input', e => { spec.speed = +e.target.value; $('tmSpeedV').textContent = spec.speed + '%'; });
    $('tmHp').addEventListener('input', e => { spec.hp = +e.target.value; $('tmHpV').textContent = spec.hp; drawTankBig(); });
    $('tmDropSize').addEventListener('input', e => { spec.dropSize = +e.target.value; $('tmDropSizeV').textContent = `${spec.dropSize}x${spec.dropSize}`; });
    $('tmEnch').addEventListener('input', e => { spec.enchantRange = +e.target.value; $('tmEnchV').textContent = spec.enchantRange + ' squares'; });
    document.querySelectorAll('#tmDropLiq button').forEach(b => b.addEventListener('click', () => { Sfx.click(); spec.dropLiquid = b.dataset.liq; renderTankMaker(); }));
    $('tmReset').addEventListener('click', () => { Sfx.click(); spec.col = Object.assign({}, BLANK_TANK_COLS); renderTankMaker(); });
    $('tmSave').addEventListener('click', () => { Sfx.click(); saveTank(); });
    $('tmCancel').addEventListener('click', () => { Sfx.click(); resume(); });
    $('tmDelete').addEventListener('click', () => { Sfx.click(); deleteTank(); });
  }
  document.addEventListener('DOMContentLoaded', init);

  return { PALETTE, blankLocal, open, resume, close, get level() { return L; }, set level(v) { L = v; }, applyAt, blank, openTank, get spec() { return spec; }, saveTank, resizeLevel, refresh,
    selectTool(t) { tool = t; }, set color(c) { selColor = c; }, paint };
})();
