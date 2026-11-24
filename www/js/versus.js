'use strict';
// MULTIPLAYER menus (title -> MULTIPLAYER):
//   LOCAL: prepare your tank -> the games on this Wi-Fi (or host one) -> the lobby (10 squares round the map, chat,
//          the host picks the map, kicks, starts) -> battle -> back to the lobby.
//   SPLIT SCREEN: prepare player 1's tank, then player 2's -> pick a map -> battle on this device -> back to the map choice.
// The battle itself is Game.versus (game.js); the Wi-Fi link is Net (net.js).
const Versus = (() => {
  const $ = id => document.getElementById(id);
  const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const PICK = ['#ff0000', '#00ff00', '#0000ff', '#ffff00', '#ff00ff', '#00ffff', '#800000', '#008000', '#000080'];   // the painter's hidden pick map
  const THEME = { grass: 'green', snow: 'white', sand: 'yellow', beach: 'aqua', volcano: 'red', factory: 'gray', battle: 'orange', grave: 'purple' };
  const RING = [[1, 1], [1, 2], [1, 3], [1, 4], [2, 4], [3, 4], [3, 3], [3, 2], [3, 1], [2, 1]];   // lobby squares 1-10, clockwise round the map

  let pp = null, selColor = '#2f7df6';                 // the PREPARE screen
  let split = null;                                    // split screen: { tanks: [spec, spec], names: [a, b], map, onDone }
  let lobby = null;                                    // a Local lobby: { host, myId, hostName, players, map, mapAuto, chat, playing }
  let picker = null, pickTab = 'campaign';
  let seen = {}, searching = false, searchTimer = null, lanErr = '';

  // ---------- tank specs ----------
  const colsFrom = c => Object.assign({}, BLANK_TANK_COLS, { tread: '#2a2a30', pad: '#5a5a66', edge: c.dark, body: c.body, lamp: c.light, barrel: c.dark, tip: '#2a2a30', ring: c.light, cap: c.body });
  const newSpec = i => ({ id: 'pt_' + Date.now().toString(36) + i, name: i ? 'RED TANK' : 'BLUE TANK', col: colsFrom(i ? PLAYER_COLORS.red : PLAYER_COLORS.blue), powers: [],
    model: 0, weapons: DEFAULT_WEAPONS.slice(), xcol: (i ? PLAYER_COLORS.red : PLAYER_COLORS.blue).body });
  // anything that came over Wi-Fi (or out of storage) is tidied before use
  function cleanSpec(s) {
    s = s && typeof s === 'object' ? s : {};
    const col = {};
    for (const q of TANK_PARTS) { const v = s.col && s.col[q.k]; col[q.k] = typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v : BLANK_TANK_COLS[q.k]; }
    let powers = [];
    for (const id of Array.isArray(s.powers) ? s.powers : []) if (PVP_POWER[id]) powers = addPvpPower(powers, id).powers;
    // two different weapons (an older tank kept its one weapon among its powers: it becomes weapon 1)
    let weapons = (Array.isArray(s.weapons) ? s.weapons : (s.powers || []).filter(id => WEAPON_STATS[id])).filter(id => WEAPON_STATS[id]);
    weapons = [...new Set(weapons)].slice(0, 2);
    for (const d of DEFAULT_WEAPONS.concat(PVP_WEAPONS)) if (weapons.length < 2 && !weapons.includes(d)) weapons.push(d);
    const model = Math.max(0, Math.min(TANK_MODELS.length - 1, s.model | 0));
    const xcol = typeof s.xcol === 'string' && /^#[0-9a-f]{6}$/i.test(s.xcol) ? s.xcol : col.body;
    return { id: String(s.id || 'pt_' + Date.now().toString(36)).slice(0, 30), name: String(s.name || 'TANK').slice(0, 18), col, powers, model, weapons, xcol };
  }
  const powersText = spec => `${TANK_MODELS[spec.model].label} &middot; ${spec.weapons.slice(0, spec.powers.length ? 1 : 2).map(id => PVP_WEAPON[id].label).join(' + ')}` + (spec.powers.length ? ' &middot; ' + spec.powers.map(id => PVP_POWER[id].label).join(' + ') : '');
  function tankCanvas(spec, size) {
    const cv = el('canvas'); cv.width = cv.height = size * 2; cv.style.width = cv.style.height = size + 'px';
    Game.drawTankPreview(cv.getContext('2d'), pvpType(spec), { x: size, y: size, scale: size / 22, turret: -0.6, noHearts: true });
    return cv;
  }

  // ---------- PREPARE YOUR TANK ----------
  // o: { title, spec, nameRow, name, then(spec, name), back() }
  function openPrepare(o) {
    pp = Object.assign({}, o, { spec: cleanSpec(JSON.parse(JSON.stringify(o.spec || newSpec(0)))) });
    $('ppTitle').textContent = o.title;
    $('ppNameRow').classList.toggle('hidden', !o.nameRow);
    $('ppName').value = o.name || '';
    $('ppTank').value = pp.spec.name;
    $('ppDesc').textContent = '';
    $('ppLoadBox').classList.add('hidden');
    UI.page('prepare');
    renderPrepare();
  }
  const ppView = () => ({ x: 180, y: 140, scale: 5.2, turret: -0.6 });
  function drawPrepare() {
    const cv = $('ppCanvas'), g = cv.getContext('2d'), T = pvpType(pp.spec), k = cv.width / 360;
    g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, cv.width, cv.height); g.setTransform(k, 0, 0, k, 0, 0);
    const bg = g.createRadialGradient(180, 140, 20, 180, 140, 200); bg.addColorStop(0, '#d9c7a3'); bg.addColorStop(1, '#a9946c');
    g.fillStyle = bg; g.fillRect(0, 0, 360, 280);
    Game.drawTankPreview(g, T, Object.assign(ppView(), { noHearts: true }));
    g.save(); g.translate(318, 238); g.strokeStyle = pp.spec.xcol; g.lineWidth = 7; g.lineCap = 'round';                 // the X mark it leaves
    g.beginPath(); g.moveTo(-16, -16); g.lineTo(16, 16); g.moveTo(16, -16); g.lineTo(-16, 16); g.stroke();
    g.fillStyle = 'rgba(0,0,0,0.55)'; g.font = 'bold 11px Impact, sans-serif'; g.textAlign = 'center'; g.fillText('YOUR X', 0, 32); g.restore();
    const pc = $('ppPick'); pc.width = cv.width; pc.height = cv.height; const p = pc.getContext('2d');
    p.setTransform(k, 0, 0, k, 0, 0); p.clearRect(0, 0, 360, 280);
    Game.drawTankPreview(p, T, Object.assign(ppView(), { plain: true, col: Object.assign({ dark: PICK[2], light: PICK[4], x: PICK[3] }, Object.fromEntries(TANK_PARTS.map((q, i) => [q.k, PICK[i]]))) }));
  }
  function partAt(ev) {
    const cv = $('ppCanvas'), r = cv.getBoundingClientRect(), x = Math.floor((ev.clientX - r.left) * cv.width / r.width), y = Math.floor((ev.clientY - r.top) * cv.height / r.height);
    const d = $('ppPick').getContext('2d').getImageData(x, y, 1, 1).data;
    if (d[3] < 200) return null;
    const i = PICK.findIndex(h => { const n = parseInt(h.slice(1), 16); return Math.abs((n >> 16) - d[0]) < 12 && Math.abs(((n >> 8) & 255) - d[1]) < 12 && Math.abs((n & 255) - d[2]) < 12; });
    return i >= 0 ? TANK_PARTS[i].k : null;
  }
  function paint(k) { pp.spec.col[k] = selColor; Sfx.click(); renderPrepare(); }
  function renderPrepare() {
    drawPrepare();
    const parts = $('ppParts'); parts.innerHTML = '';
    for (const q of TANK_PARTS) {
      const b = el('button', 'tm-part', `<i style="background:${pp.spec.col[q.k]}"></i>${q.label}`); b.dataset.part = q.k;
      b.addEventListener('click', () => paint(q.k)); parts.appendChild(b);
    }
    const pal = $('ppPalette'); pal.innerHTML = '';
    for (const c of Editor.PALETTE) {
      const s = el('button', 'pal-sw' + (c === selColor ? ' on' : '')); s.style.background = c; s.dataset.c = c;
      s.addEventListener('click', () => { selColor = c; Sfx.click(); renderPrepare(); }); pal.appendChild(s);
    }
    $('ppCur').style.background = selColor;
    const T = pvpType(pp.spec);
    $('ppFixed').innerHTML = `<span>SPEED <b>${Math.round(T.move * 100)}%</b></span><span>LIVES <b>SET BY THE HOST</b></span><small>Every player drives at 100%. The game rules (BATTLE lives, SLAYER kills, SLAUGHTER time) are picked before the fight.</small>`;
    // TANK MODEL: 10 shapes, each drawn in your colours
    const mb = $('ppModels'); mb.innerHTML = '';
    TANK_MODELS.forEach((M, i) => {
      const b = el('button', 'pp-model' + (pp.spec.model === i ? ' on' : '')); b.dataset.model = i; b.title = M.desc;
      b.appendChild(tankCanvas(Object.assign({}, pp.spec, { model: i }), 26)); b.appendChild(el('span', '', M.label));
      b.addEventListener('click', () => { Sfx.click(); pp.spec.model = i; $('ppDesc').textContent = `${M.label}: ${M.desc}`; renderPrepare(); });
      mb.appendChild(b);
    });
    // WEAPON 1 and WEAPON 2: any two different weapons (picking the other slot's weapon swaps them)
    const w2off = pp.spec.powers.length > 0;                                 // a power picked: no weapon 2 (Mines takes its button)
    $('ppW2').classList.toggle('dim', w2off);
    let w2note = $('ppW2note');
    if (!w2note) { w2note = el('div', 'ed-note'); w2note.id = 'ppW2note'; $('ppW2').after(w2note); }
    w2note.textContent = !w2off ? '' : pp.spec.powers.includes('mines') ? 'You picked a power, so weapon 2 is off - your second fire button lays MINES instead.'
      : 'You picked a power, so weapon 2 and the second fire button are off. Take the powers off to get weapon 2 back (or pick Mines to lay mines with it).';
    for (const k of [0, 1]) {
      const box = $(k ? 'ppW2' : 'ppW1'); box.innerHTML = '';
      for (const w of PVP_WEAPON_LIST) {
        const b = el('button', 'tm-pow' + (pp.spec.weapons[k] === w.id ? ' on' : '') + (pp.spec.weapons[1 - k] === w.id ? ' other' : ''), w.label);
        b.title = w.desc; b.dataset.weapon = w.id; b.dataset.slot = k;
        b.addEventListener('click', () => {
          Sfx.click(); $('ppDesc').textContent = `${w.label}: ${w.desc}`;
          const ws = pp.spec.weapons, o = ws.indexOf(w.id);
          if (o === 1 - k) ws[1 - k] = ws[k];                                    // it was the other weapon: swap them
          ws[k] = w.id; renderPrepare();
        });
        box.appendChild(b);
      }
    }
    // the X mark left where your tank is destroyed
    const xb = $('ppX'); xb.innerHTML = '';
    for (const c of X_COLORS.concat(X_COLORS.includes(pp.spec.xcol) ? [] : [pp.spec.xcol])) {
      const b = el('button', 'pal-sw' + (c === pp.spec.xcol ? ' on' : '')); b.style.background = c; b.dataset.x = c;
      b.addEventListener('click', () => { Sfx.click(); pp.spec.xcol = c; renderPrepare(); }); xb.appendChild(b);
    }
    const pw = $('ppPowers'); pw.innerHTML = '';
    for (const p of PVP_POWERS) {
      const n = pp.spec.powers.includes(p.id);
      const b = el('button', 'tm-pow' + (n ? ' on' : ''), p.label); b.title = p.desc; b.dataset.power = p.id;
      b.addEventListener('click', () => {
        Sfx.click(); $('ppDesc').textContent = p.desc;
        if (n) return;
        const r = addPvpPower(pp.spec.powers, p.id);
        if (r.powers === pp.spec.powers) { if (r.msg) UI.toast(r.msg, 2400); return; }
        pp.spec.powers = r.powers; renderPrepare();
      });
      pw.appendChild(b);
    }
    const sel = $('ppSelected'); sel.innerHTML = '';
    for (let i = 0; i < PVP_MAX; i++) {
      const id = pp.spec.powers[i];
      if (!id) { sel.appendChild(el('div', 'pp-empty', 'EMPTY')); continue; }
      const b = el('button', 'tm-chip', PVP_POWER[id].label + ' &#10005;'); b.dataset.power = id;
      b.addEventListener('click', () => { Sfx.click(); pp.spec.powers.splice(i, 1); renderPrepare(); });
      sel.appendChild(b);
    }
  }
  function openTankList() {
    const list = $('ppLoadList'); list.innerHTML = '';
    if (!Store.playerTanks.length) list.appendChild(el('div', 'ed-note', 'No saved player tanks yet. Paint one and press SAVE TANK.'));
    for (const s of Store.playerTanks) {
      const row = el('div', 'ed-lrow'), go = el('button', 'sbtn pp-row'), del = el('button', 'sbtn red', '&#10005;');
      go.appendChild(tankCanvas(cleanSpec(s), 22)); go.appendChild(el('span', '', `${esc(s.name)} <small>${esc(powersText(cleanSpec(s)))}</small>`));
      go.addEventListener('click', () => { Sfx.click(); pp.spec = cleanSpec(JSON.parse(JSON.stringify(s))); $('ppTank').value = pp.spec.name; $('ppLoadBox').classList.add('hidden'); renderPrepare(); UI.toast('Loaded ' + pp.spec.name); });
      del.addEventListener('click', () => { Sfx.click(); UI.confirm(`Delete the tank "${s.name}"?`, () => { Store.deletePlayerTank(s.id); openTankList(); }); });
      row.appendChild(go); row.appendChild(del); list.appendChild(row);
    }
    $('ppLoadBox').classList.remove('hidden');
  }
  function readSpec() { pp.spec.name = ($('ppTank').value || '').trim().slice(0, 18) || 'MY TANK'; return JSON.parse(JSON.stringify(pp.spec)); }

  // ---------- MULTIPLAYER menu ----------
  function openMulti() {
    UI.page('multi');
    $('mpLan').textContent = '';
    fetch('/api/lan').then(r => r.json()).then(j => {
      if (j && j.urls && j.urls.length) $('mpLan').innerHTML = `Other phones and computers on this Wi-Fi can play too: open <b>${esc(j.urls[0])}</b> in their browser.`;
    }).catch(() => {});
  }
  function goLocal() {
    if (!Net.available()) { UI.toast('Local play needs the internet on (it is how the devices find each other)', 3000); return; }
    openPrepare({ title: 'PREPARE YOUR TANK', spec: Store.net.tank || newSpec(0), nameRow: true, name: Store.net.name || '',
      then: (spec, name) => {
        name = name.trim().toUpperCase().slice(0, 14);
        if (!name) { UI.toast('Type your name - it shows above your tank'); return; }
        Store.setNet('tank', spec); Store.setNet('name', name); openLan();
      },
      back: openMulti });
  }
  function goSplit() {
    const tanks = Store.net.splitTanks || [newSpec(0), newSpec(1)], names = Store.net.splitNames || ['PLAYER 1', 'PLAYER 2'];
    split = { tanks: tanks.map(cleanSpec), names: names.slice(), map: split && split.map, onDone: null, rules: splitRules() };
    prepareSplit(0, () => prepareSplit(1, openSplit, () => prepareSplit(0, null, openMulti)), openMulti);
  }
  function prepareSplit(i, next, back) {
    openPrepare({ title: i ? 'PLAYER 2 (RED) - PREPARE YOUR TANK' : 'PLAYER 1 (BLUE) - PREPARE YOUR TANK', spec: split.tanks[i], nameRow: true, name: split.names[i],
      then: (spec, name) => {
        split.tanks[i] = spec; split.names[i] = name.trim().toUpperCase().slice(0, 14) || (i ? 'PLAYER 2' : 'PLAYER 1');
        Store.setNet('splitTanks', split.tanks); Store.setNet('splitNames', split.names);
        (next || openSplit)();
      },
      back: back || openSplit });
  }

  // ---------- SPLIT SCREEN ----------
  function openSplit() {
    if (!split) { const t = Store.net.splitTanks || [newSpec(0), newSpec(1)]; split = { tanks: t.map(cleanSpec), names: Store.net.splitNames || ['PLAYER 1', 'PLAYER 2'], map: null, rules: splitRules() }; }
    if (!split.map) split.map = defaultMap(2);
    if (!split.rules) split.rules = splitRules();
    $('ssRulesText').textContent = rulesText(split.rules);
    UI.page('splitset');
    for (const i of [0, 1]) {
      const card = $(i ? 'ssP2' : 'ssP1'), s = split.tanks[i], T = pvpType(s);
      card.innerHTML = ''; card.appendChild(el('div', 'ss-who', i ? 'PLAYER 2 - RED' : 'PLAYER 1 - BLUE'));
      card.appendChild(tankCanvas(s, 44));
      card.appendChild(el('div', 'ss-name', esc(split.names[i])));
      card.appendChild(el('div', 'ss-pow', `${powersText(s)}<br>${Math.round(T.move * 100)}% speed`));
      const ed = el('button', 'sbtn', 'EDIT TANK'); ed.addEventListener('click', () => { Sfx.click(); prepareSplit(i); }); card.appendChild(ed);
    }
    showMap($('ssMap'), $('ssMapName'), split.map, 2);
  }
  function startSplit(L, onDone) {
    if (!split) { const t = Store.net.splitTanks || [newSpec(0), newSpec(1)]; split = { tanks: t.map(cleanSpec), names: Store.net.splitNames || ['PLAYER 1', 'PLAYER 2'], map: null, rules: splitRules() }; }
    split.onDone = onDone || null;
    UI.page(null);
    Game.versus({ role: 'local', L, rules: split.rules || splitRules(), players: [0, 1].map(i => ({ id: 'p' + (i + 1), name: split.names[i], spec: split.tanks[i], slot: i })),
      onEnd: r => { Game.stop(); finishSplit(); resultToast(r); } });
  }
  const splitRules = () => Object.assign(cleanRules(Store.net.splitRules), { teams: 0 });   // 2 players: no teams
  function finishSplit() { const f = split && split.onDone; if (split) split.onDone = null; if (f) f(); else openSplit(); }

  // ---------- maps ----------
  function campaignMaps() { return LEVELS.map((L, i) => ({ kind: 'campaign', ref: i + 1, name: `MISSION ${i + 1}`, L, spawns: Game.spawnsOf(L).length, floor: L.floor })); }
  function createdMaps() { return Store.localMaps.map(L => ({ kind: 'created', ref: L.id, name: L.name || 'LOCAL MAP', L, spawns: Game.spawnsOf(L).length, floor: L.floor })); }
  function defaultMap(n) { return campaignMaps().find(m => m.spawns >= Math.max(2, n)) || campaignMaps()[0]; }
  function showMap(cv, label, m, need) {
    const g = cv.getContext('2d'); g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, cv.width, cv.height);
    if (!m) { label.textContent = 'NO MAP CHOSEN'; return; }
    Game.renderMap(g, m.L, cv.width, cv.height);
    label.innerHTML = `${esc(m.name)} <small>${m.L.cols || (m.L.grid ? m.L.grid[0].length : '?')} x ${m.L.rows || (m.L.grid ? m.L.grid.length : '?')} &middot; ${m.spawns} spawns</small>` +
      (need > m.spawns ? `<b class="warn">Only ${m.spawns} spawns for ${need} players - choose a bigger map</b>` : '');
  }
  // the map choice: CREATED MAPS (Local maps from the level creator) or CAMPAIGN MAPS (no enemies). Maps with fewer spawns than players are greyed out.
  function openPicker(need, done) {
    picker = { need, done };
    $('mpNeed').textContent = `${need} players - a map needs ${need} spawns`;
    renderPicker();
    $('mapPick').classList.remove('hidden');
  }
  function closePicker() { picker = null; $('mapPick').classList.add('hidden'); }
  function renderPicker() {
    document.querySelectorAll('#mpTabs button').forEach(b => b.classList.toggle('on', b.dataset.mtab === pickTab));
    const box = $('mpList'); box.innerHTML = ''; box.className = 'mp-list ' + pickTab;
    const choose = m => { if (m.spawns < picker.need) { UI.toast(`That map only has ${m.spawns} spawns - you have ${picker.need} players`, 2600); return; } Sfx.click(); const f = picker.done; closePicker(); f(m); };
    if (pickTab === 'created') {
      const list = createdMaps();
      if (!list.length) box.appendChild(el('div', 'ed-note', 'No Local maps yet. Make one in LEVEL CREATOR with the LOCAL MAP button: place the coloured spawn flags instead of tanks.'));
      for (const m of list) {
        const b = el('button', 'mp-map' + (m.spawns < picker.need ? ' off' : '')), cv = el('canvas'); cv.width = 160; cv.height = 100;
        Game.renderMap(cv.getContext('2d'), m.L, 160, 100);
        b.appendChild(cv); b.appendChild(el('span', '', `${esc(m.name)}<small>${m.spawns} spawn flags</small>`)); b.dataset.map = m.ref;
        b.addEventListener('click', () => choose(m)); box.appendChild(b);
      }
    } else {
      for (const m of campaignMaps()) {
        const b = el('button', 'lbtn t-' + (THEME[m.floor] || 'blue') + (m.spawns < picker.need ? ' off' : ''), `${m.ref}<small>${m.spawns}</small>`);
        b.title = `${m.L.name} - ${m.spawns} spawns`; b.dataset.map = m.ref;
        b.addEventListener('click', () => choose(m)); box.appendChild(b);
      }
      box.appendChild(el('div', 'ed-note', 'The small number is how many players the map holds (its player square plus every enemy square). No enemies are in the battle.'));
    }
  }

  // ---------- GAME RULES ----------
  // the popup: MODE (Battle / Slayer / Slaughter), its numbers, and TEAMS (Local lobbies only). o: { rules, teams: bool, n, done(rules) }
  let rp = null;
  function openRules(o) { rp = Object.assign({}, o, { rules: cleanRules(o.rules) }); renderRules(); $('rulesPop').classList.remove('hidden'); }
  function closeRules(save) { if (!rp) return; const f = rp.done, r = rp.rules; rp = null; $('rulesPop').classList.add('hidden'); if (save && f) f(r); }
  function renderRules() {
    const R = rp.rules, box = $('rulesBody'); box.innerHTML = '';
    const row = (label, kids, note) => { const d = el('div', 'ru-row'); d.appendChild(el('span', 'ru-label', label)); const k = el('div', 'ru-kids'); kids.forEach(x => k.appendChild(x)); d.appendChild(k); if (note) d.appendChild(el('small', 'ru-note', note)); box.appendChild(d); };
    const pick = (label, on, fn, id, off) => { const b = el('button', 'tm-pow' + (on ? ' on' : '') + (off ? ' off' : ''), label); if (id) b.dataset.rule = id; b.addEventListener('click', () => { Sfx.click(); fn(); renderRules(); }); return b; };
    const step = (text, minus, plus, id) => {
      const d = el('div', 'ru-step'); d.dataset.rule = id;
      const m = el('button', 'sbtn', '&minus;'), v = el('b', '', text), p = el('button', 'sbtn', '+');
      m.dataset.step = '-'; p.dataset.step = '+';
      m.addEventListener('click', () => { Sfx.click(); minus(); renderRules(); }); p.addEventListener('click', () => { Sfx.click(); plus(); renderRules(); });
      d.appendChild(m); d.appendChild(v); d.appendChild(p); return d;
    };
    row('MODE', MODES.map(M => pick(M.label, R.mode === M.id, () => { R.mode = M.id; }, 'mode-' + M.id)), MODES.find(M => M.id === R.mode).desc);
    if (R.mode === 'battle') row('LIVES', [step(`${R.lives}`, () => { R.lives = Math.max(1, R.lives - 1); }, () => { R.lives = Math.min(10, R.lives + 1); }, 'lives')], 'Everyone gets the same number of lives, 1 to 10.');
    if (R.mode === 'slayer') {
      row('KILLS TO WIN', [step(`${R.kills}`, () => { R.kills = Math.max(10, R.kills - 5); }, () => { R.kills = Math.min(100, R.kills + 5); }, 'kills')], '10 to 100, in steps of 5.');
      const i = SLAYER_TIMES.indexOf(R.slayerTime);
      row('TIME LIMIT', [step(R.slayerTime ? `${R.slayerTime} MIN` : 'NO LIMIT', () => { R.slayerTime = SLAYER_TIMES[Math.max(0, i - 1)]; }, () => { R.slayerTime = SLAYER_TIMES[Math.min(SLAYER_TIMES.length - 1, i + 1)]; }, 'stime')],
        '5 to 30 minutes, or no time limit. If the time runs out first, the most kills wins.');
    }
    if (R.mode === 'slaughter') row('TIME LIMIT', [step(`${R.slaughterTime} MIN`, () => { R.slaughterTime = Math.max(1, R.slaughterTime - 1); }, () => { R.slaughterTime = Math.min(30, R.slaughterTime + 1); }, 'ttime')], '1 to 30 minutes. Most kills when it runs out wins.');
    if (rp.teams) {
      const ok = teamOptions(rp.n);
      row('TEAMS', [0, 2, 4, 5].map(k => pick(k ? `${k} TEAMS` : 'FREE FOR ALL', R.teams === k, () => { R.teams = k; }, 'teams-' + k, !ok.includes(k))),
        'Blue and red; green and yellow join with 8 players; purple with 10. Everyone picks a team in the lobby and the teams must be even to start.');
    } else row('TEAMS', [el('span', 'ru-off', 'Teams need a Local lobby (more than 2 players).')]);
    $('rulesDone').classList.toggle('hidden', !rp.done);
  }

  // ---------- LOCAL: the games on this Wi-Fi ----------
  function openLan() {
    UI.page('lan'); renderLan(); search();
    Net.networkCode().then(c => { $('lanNote').innerHTML = `Wi-Fi code <b>${esc(c)}</b> &middot; only devices showing the same code can see each other's games. Playing as <b>${esc(Store.net.name)}</b>.`; });
    clearInterval(searchTimer);
    searchTimer = setInterval(() => { if ($('lan').classList.contains('active')) search(); else clearInterval(searchTimer); }, 9000);
  }
  async function search() {
    if (searching) return;
    searching = true; lanErr = ''; $('lanSearch').textContent = 'SEARCHING...';
    try {
      const list = await Net.list();
      for (const g of list) seen[g.id] = { g, miss: 0 };
      for (const id in seen) if (!list.some(g => g.id === id) && ++seen[id].miss >= 3) delete seen[id];   // a game only drops off after 3 empty searches
    } catch (e) { lanErr = 'Could not search: ' + (e && e.message || e); }
    searching = false; $('lanSearch').textContent = 'SEARCH AGAIN';
    if ($('lan').classList.contains('active')) renderLan();
  }
  function renderLan() {
    const box = $('lanList'); box.innerHTML = '';
    const games = Object.values(seen).map(x => x.g);
    if (lanErr) box.appendChild(el('div', 'lan-empty', esc(lanErr)));
    if (!games.length) box.appendChild(el('div', 'lan-empty', searching ? 'Looking for games on this Wi-Fi...' : 'No games found yet. Ask someone to HOST A GAME, or host one yourself.'));
    for (const g of games) {
      const full = g.count >= g.max, b = el('button', 'lan-game' + (full ? ' full' : ''));
      b.innerHTML = `<b>${esc(g.name)}'S LOBBY</b><span>${g.count} / ${g.max} players</span><small>${full ? 'FULL' : g.playing ? 'IN A ROUND - you join the next one' : 'IN THE LOBBY'}${g.map ? ' &middot; ' + esc(g.map) : ''}</small>`;
      b.addEventListener('click', () => { Sfx.click(); if (full) UI.toast('That lobby is full'); else joinGame(g); });
      box.appendChild(b);
    }
  }
  async function joinGame(g) {
    UI.toast(`Joining ${g.name}...`, 4000);
    try {
      const r = await Net.join(g.id, Store.net.name, Store.net.tank, n => { if (n > 1) UI.toast(`Trying again (${n} of 3)...`, 4000); });
      lobby = { host: false, myId: r.id, hostName: r.host, players: [], map: null, chat: [], playing: false, rules: cleanRules(null) };
      Net.onMessage = onNet;
      openLobby();
    } catch (e) { UI.toast(e.message || 'Could not join', 2800); }
  }
  async function hostGame() {
    const name = Store.net.name;
    lobby = { host: true, myId: 'host', hostName: name, players: [{ id: 'host', name, spec: cleanSpec(Store.net.tank), slot: 0, team: 0 }], map: defaultMap(2), mapAuto: true, chat: [], playing: false,
      rules: Object.assign(cleanRules(Store.net.rules), { teams: 0 }) };
    Net.onMessage = onNet;
    UI.toast('Opening your lobby...', 3000);
    try { await Net.host(name, () => ({ playing: !!(lobby && lobby.playing), map: lobby && lobby.map ? lobby.map.name : '' })); }
    catch (e) { lobby = null; UI.toast(e.message || 'Could not open a lobby', 3000); return; }
    sysChat(`${name} opened the lobby. Players on this Wi-Fi can find it under LOCAL.`);
    openLobby();
  }

  // ---------- the LOBBY ----------
  const meP = () => lobby && lobby.players.find(p => p.id === lobby.myId);
  function freeSlot() { for (let s = 0; s < 10; s++) if (!lobby.players.some(p => p.slot === s)) return s; return -1; }
  function uniqueName(n) { n = String(n || 'PLAYER').toUpperCase().slice(0, 14); let out = n, k = 2; while (lobby.players.some(p => p.name === out)) out = n.slice(0, 12) + ' ' + k++; return out; }
  function pushLobby() { if (lobby && lobby.host) Net.broadcast({ t: 'lobby', players: lobby.players, map: lobby.map, playing: lobby.playing, hostName: lobby.hostName, rules: lobby.rules }); }
  // TEAMS: a team holds at most its share of the lobby (players / teams, rounded up); a new player joins the smallest
  const teamCount = k => lobby.players.filter(p => p.team === k).length;
  const teamCap = () => Math.ceil(lobby.players.length / Math.max(1, lobby.rules.teams));
  function smallestTeam(except) { let best = 0, bn = Infinity; for (let k = 0; k < lobby.rules.teams; k++) { const n = lobby.players.filter(p => p.team === k && p !== except).length; if (n < bn) { bn = n; best = k; } } return best; }
  function fixTeams() {                                                       // after the team count changes: anyone on a team that no longer exists moves
    if (!lobby.rules.teams) return;
    for (const p of lobby.players) if (!(p.team >= 0 && p.team < lobby.rules.teams)) p.team = smallestTeam(p);
  }
  // why the teams cannot start yet ('' = fine)
  function teamProblem() {
    const T = lobby.rules.teams, n = lobby.players.length; if (!T) return '';
    if (T === 4 && n !== 8) return '4 TEAMS needs exactly 8 players.';
    if (T === 5 && n !== 10) return '5 TEAMS needs exactly 10 players.';
    if (n % T) return `${n} players cannot make ${T} even teams.`;
    const counts = [...Array(T)].map((_, k) => teamCount(k));
    if (counts.some(c => c !== n / T)) return 'Teams must be even: ' + counts.map((c, k) => `${TEAM_COLORS[k][2]} ${c}`).join(', ') + '.';
    return '';
  }
  function setTeam(id, k) {
    const P = lobby.players.find(p => p.id === id); if (!P || !lobby.rules.teams || !(k >= 0 && k < lobby.rules.teams) || P.team === k) return false;
    if (teamCount(k) >= teamCap()) return false;
    P.team = k; return true;
  }
  function pickTeam(k) {
    if (!lobby || lobby.playing) return;
    if (lobby.host) { if (setTeam(lobby.myId, k)) { pushLobby(); renderLobby(); } else if (teamCount(k) >= teamCap()) UI.toast(`${TEAM_COLORS[k][2]} team is full`); }
    else { if (teamCount(k) >= teamCap()) { UI.toast(`${TEAM_COLORS[k][2]} team is full`); return; } Net.toHost({ t: 'team', team: k }); }
  }
  function addChat(c) { lobby.chat.push(c); if (lobby.chat.length > 80) lobby.chat.shift(); renderChat(); }
  function sysChat(text) { if (!lobby || !lobby.host) return; const c = { sys: true, text }; addChat(c); Net.broadcast({ t: 'chat', c }); }
  function fitAutoMap() { if (lobby.mapAuto && (!lobby.map || lobby.map.spawns < lobby.players.length)) lobby.map = defaultMap(lobby.players.length); }
  function onNet(from, m) {
    if (!lobby || !m) return;
    if (lobby.host) {
      const P = lobby.players.find(p => p.id === from);
      if (m.t === 'joined') {
        const slot = freeSlot(); if (slot < 0) { Net.kick(from); return; }
        const name = uniqueName(m.name);
        lobby.players.push({ id: from, name, spec: cleanSpec(m.spec), slot, team: lobby.rules.teams ? smallestTeam() : 0 });
        Net.send(from, { t: 'history', chat: lobby.chat });
        fitAutoMap(); pushLobby(); sysChat(`${name} joined`); if ($('lobby').classList.contains('active')) renderLobby();
      } else if (m.t === 'left') {
        if (!P) return;
        lobby.players = lobby.players.filter(p => p !== P);
        if (lobby.playing) Game.vsLeave(from);
        pushLobby(); sysChat(`${P.name} ${m.why === 'lost' ? 'lost connection' : 'left the lobby'}`); if ($('lobby').classList.contains('active')) renderLobby();
      } else if (m.t === 'chat' && P) {
        const c = { name: P.name, slot: P.slot, text: String(m.text || '').slice(0, 120) }; if (!c.text.trim()) return;
        addChat(c); Net.broadcast({ t: 'chat', c });
      } else if (m.t === 'tank' && P) { P.spec = cleanSpec(m.spec); pushLobby(); if ($('lobby').classList.contains('active')) renderLobby(); }
      else if (m.t === 'team' && P && !lobby.playing) { if (setTeam(from, m.team | 0)) { pushLobby(); if ($('lobby').classList.contains('active')) renderLobby(); } }
      else if (m.t === 'st' || m.t === 'act') Game.vsMessage(from, m);
      return;
    }
    // a guest
    if (m.t === 'lobby') { Object.assign(lobby, { players: m.players || [], map: m.map, playing: !!m.playing, hostName: m.hostName || lobby.hostName, rules: cleanRules(m.rules) }); if ($('lobby').classList.contains('active')) renderLobby(); }
    else if (m.t === 'history') { lobby.chat = (m.chat || []).slice(-80); renderChat(); }
    else if (m.t === 'chat') addChat(m.c || {});
    else if (m.t === 'start') {
      if (!(m.players || []).some(p => p.id === lobby.myId)) return;           // joined during a round: wait for the next one
      closePicker(); $('ppLoadBox').classList.add('hidden'); UI.page(null);
      Game.versus({ role: 'client', L: m.L, rules: m.rules, players: m.players, me: lobby.myId, send: x => Net.toHost(x) });
    }
    else if (m.t === 'snap') Game.vsMessage('host', m);
    else if (m.t === 'end') { $('vsPause').classList.remove('active'); if (Game.isVersus) { Game.stop(); openLobby(); } resultToast(m.result); }
    else if (m.t === 'kick') leave('The host kicked you out of the lobby. You can join again.');
    else if (m.t === 'gone' || m.t === 'closed') leave('The host closed the lobby.');
  }
  function openLobby() { closePicker(); closeRules(false); UI.page('lobby'); renderLobby(); }
  function renderLobby() {
    if (!lobby) return;
    $('lbTitle').textContent = `${lobby.hostName}'S LOBBY`;
    const ring = $('lbRing'); ring.querySelectorAll('.lb-sq').forEach(e => e.remove());
    for (let s = 0; s < 10; s++) {
      const P = lobby.players.find(p => p.slot === s), [r, c] = RING[s];
      const sq = el('div', 'lb-sq' + (P ? '' : ' empty') + (P && P.id === lobby.myId ? ' me' : '') + (P && lobby.rules.teams ? ' teamed' : '')); sq.style.gridArea = `${r} / ${c}`; sq.dataset.slot = s;
      sq.style.setProperty('--fc', P && lobby.rules.teams ? TEAM_COLORS[(P.team | 0) % 5][1] : FLAG_COLORS[s][1]);
      if (P) {
        const spec = cleanSpec(P.spec);
        sq.appendChild(tankCanvas(spec, 24));
        sq.appendChild(el('div', 'lb-who', `<b>${esc(P.name)}</b>${P.id === 'host' ? '<i>HOST</i>' : ''}${P.id === lobby.myId ? '<i class="you">YOU</i>' : ''}${lobby.rules.teams ? `<i class="team" style="background:${TEAM_COLORS[(P.team | 0) % 5][1]}">${TEAM_COLORS[(P.team | 0) % 5][2]}</i>` : ''}<small>${powersText(spec)}</small>`));
        if (lobby.host && P.id !== 'host') {
          const k = el('button', 'lb-kick', '&#10005;'); k.title = 'Kick ' + P.name; k.dataset.kick = P.id;
          k.addEventListener('click', () => { Sfx.click(); UI.confirm(`Kick ${P.name} out of the lobby? (They can join again.)`, () => kick(P.id)); });
          sq.appendChild(k);
        }
      } else sq.innerHTML = `<span class="lb-num">${s + 1}</span><span>EMPTY</span>`;
      ring.appendChild(sq);
    }
    const n = lobby.players.length;
    showMap($('lbMap'), $('lbMapName'), lobby.map, n);
    $('lbPick').classList.toggle('hidden', !lobby.host); $('lbStart').classList.toggle('hidden', !lobby.host);
    $('lbRulesText').textContent = rulesText(lobby.rules);
    $('lbRules').textContent = lobby.host ? 'GAME RULES' : 'SEE RULES';
    // TEAMS: a button per team, tap yours
    const tb = $('lbTeams'); tb.innerHTML = ''; tb.classList.toggle('hidden', !lobby.rules.teams);
    if (lobby.rules.teams) {
      const me = meP(), cap = teamCap();
      tb.appendChild(el('span', '', 'TEAM:'));
      for (let k = 0; k < lobby.rules.teams; k++) {
        const b = el('button', 'lb-team' + (me && me.team === k ? ' on' : ''), `${TEAM_COLORS[k][2]} ${teamCount(k)}/${cap}`); b.style.setProperty('--tc', TEAM_COLORS[k][1]); b.dataset.team = k;
        b.addEventListener('click', () => { Sfx.click(); pickTeam(k); }); tb.appendChild(b);
      }
    }
    const tp = teamProblem();
    const ok = n >= 2 && lobby.map && lobby.map.spawns >= n && !lobby.playing && !tp;
    $('lbStart').classList.toggle('locked', !ok);
    $('lbWait').textContent = lobby.host
      ? (lobby.playing ? 'A round is on.' : n < 2 ? 'Waiting for players to join... (they find you under MULTIPLAYER > LOCAL)' : !lobby.map || lobby.map.spawns < n ? 'Choose a map with enough spawns.' : tp || `${n} players - press START when everyone is in.`)
      : (lobby.playing ? 'A round is on - you will play in the next one.' : 'Waiting for the host to start. Ask for a map in the chat!');
    renderChat();
  }
  function renderChat() {
    if (!lobby) return;
    const box = $('lbMsgs'), atEnd = box.scrollTop + box.clientHeight >= box.scrollHeight - 8;
    box.innerHTML = '';
    for (const c of lobby.chat) {
      const line = el('div', 'lb-line' + (c.sys ? ' sys' : ''));
      line.innerHTML = c.sys ? esc(c.text) : `<b style="color:${FLAG_COLORS[(c.slot || 0) % 10][1]}">${esc(c.name)}:</b> ${esc(c.text)}`;
      box.appendChild(line);
    }
    if (atEnd || box.scrollHeight < box.clientHeight + 40) box.scrollTop = box.scrollHeight;
  }
  function sendChat(text) {
    text = String(text || '').trim().slice(0, 120); if (!text || !lobby) return;
    if (lobby.host) { const P = meP(), c = { name: P.name, slot: P.slot, text }; addChat(c); Net.broadcast({ t: 'chat', c }); }
    else Net.toHost({ t: 'chat', text });
  }
  function kick(id) {
    const P = lobby.players.find(p => p.id === id); if (!P) return;
    Net.kick(id);
    lobby.players = lobby.players.filter(p => p !== P);
    if (lobby.playing) Game.vsLeave(id);
    pushLobby(); sysChat(`${P.name} was kicked`); renderLobby();
  }
  function startMatch() {
    const n = lobby.players.length;
    if (n < 2) { UI.toast('You need at least 2 players'); return; }
    if (!lobby.map || lobby.map.spawns < n) { UI.toast(`That map only has ${lobby.map ? lobby.map.spawns : 0} spawns - choose a bigger map`, 2600); return; }
    const tp = teamProblem(); if (tp) { UI.toast(tp, 2800); return; }
    lobby.playing = true;
    const players = lobby.players.slice().sort((a, b) => a.slot - b.slot).map(p => ({ id: p.id, name: p.name, spec: cleanSpec(p.spec), slot: p.slot, team: p.team | 0 }));
    Net.broadcast({ t: 'start', L: lobby.map.L, rules: lobby.rules, players });
    pushLobby();
    closePicker(); closeRules(false); UI.page(null);
    Game.versus({ role: 'host', L: lobby.map.L, rules: lobby.rules, players, me: 'host', send: m => Net.broadcast(m), onEnd: endRound });
  }
  function endRound(r) {
    Game.stop(); $('vsPause').classList.remove('active');
    if (!lobby) return;
    lobby.playing = false;
    Net.broadcast({ t: 'end', result: r });
    pushLobby();
    sysChat(r && r.winner ? `${r.winner} won the round!` : 'That round ended with no winner.');
    if (r && r.players) sysChat('Kills: ' + r.players.slice().sort((a, b) => b.kills - a.kills).map(p => `${p.name} ${p.kills}`).join(', '));
    openLobby(); resultToast(r);
  }
  function leave(msg) {
    Game.stop(); Net.close(); lobby = null; closePicker(); $('vsPause').classList.remove('active');
    openLan(); if (msg) UI.toast(msg, 3000);
  }
  function resultToast(r) { if (r) UI.toast(r.winner ? `${r.winner} WINS!` : 'NO WINNER', 2600); }

  // ---------- pause during a battle ----------
  function onPause() {
    const local = !lobby;
    $('vpNote').textContent = local ? '' : 'The battle carries on while this menu is open!';
    $('vpQuit').textContent = local ? 'QUIT TO MAP CHOICE' : lobby.host ? 'END ROUND FOR EVERYONE' : 'LEAVE LOBBY';
    $('vsPause').classList.add('active');
  }
  function pauseQuit() {
    $('vsPause').classList.remove('active');
    if (!lobby) { Game.stop(); finishSplit(); return; }
    if (lobby.host) UI.confirm('End this round for everyone and go back to the lobby?', () => endRound(null));
    else UI.confirm('Leave the lobby?', () => leave(null));
  }

  // ---------- wiring ----------
  function init() {
    $('mpLocal').addEventListener('click', () => { Sfx.click(); goLocal(); });
    $('mpSplit').addEventListener('click', () => { Sfx.click(); goSplit(); });
    $('mpBack').addEventListener('click', () => { Sfx.click(); UI.page('title'); });
    // prepare
    $('ppCanvas').addEventListener('pointerdown', e => { const k = partAt(e); if (k) paint(k); });
    $('ppAny').addEventListener('input', e => { selColor = e.target.value; $('ppCur').style.background = selColor; });
    $('ppAny').addEventListener('change', () => renderPrepare());
    $('ppReset').addEventListener('click', () => { Sfx.click(); pp.spec.col = Object.assign({}, BLANK_TANK_COLS); renderPrepare(); });
    // SAVE TANK goes by the tank's NAME: a new name is a new saved tank, a name already saved asks before replacing it
    $('ppSave').addEventListener('click', () => {
      Sfx.click();
      const s = readSpec(), same = Store.playerTanks.find(x => (x.name || '').toUpperCase() === s.name.toUpperCase());
      const put = id => { s.id = id; pp.spec.id = id; Store.savePlayerTank(s); UI.toast(`${s.name} saved (${Store.playerTanks.length} saved tank${Store.playerTanks.length === 1 ? '' : 's'})`, 2200); };
      if (same) UI.confirm(`You already have a tank called "${s.name}". Replace it? (Change the tank name to save a new one.)`, () => put(same.id));
      else put('pt_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6));
    });
    $('ppLoad').addEventListener('click', () => { Sfx.click(); openTankList(); });
    $('ppLoadClose').addEventListener('click', () => { Sfx.click(); $('ppLoadBox').classList.add('hidden'); });
    $('ppReady').addEventListener('click', () => { Sfx.click(); pp.then(readSpec(), $('ppName').value || ''); });
    $('ppBack').addEventListener('click', () => { Sfx.click(); pp.back(); });
    // local games
    $('lanBack').addEventListener('click', () => { Sfx.click(); clearInterval(searchTimer); openMulti(); });
    $('lanSearch').addEventListener('click', () => { Sfx.click(); search(); });
    $('lanHost').addEventListener('click', () => { Sfx.click(); hostGame(); });
    $('lanTank').addEventListener('click', () => { Sfx.click(); goLocal(); });
    // lobby
    $('lbLeave').addEventListener('click', () => { Sfx.click(); UI.confirm(lobby && lobby.host ? 'Close the lobby? Everyone in it goes back to the games list.' : 'Leave the lobby?', () => leave(null)); });
    $('lbPick').addEventListener('click', () => { Sfx.click(); openPicker(lobby.players.length, m => { lobby.map = m; lobby.mapAuto = false; pushLobby(); sysChat(`Map: ${m.name}`); renderLobby(); }); });
    $('lbStart').addEventListener('click', () => { Sfx.click(); startMatch(); });
    $('lbRules').addEventListener('click', () => {
      Sfx.click(); if (!lobby) return;
      openRules({ rules: lobby.rules, teams: true, n: lobby.players.length, done: lobby.host && !lobby.playing ? r => {
        const before = rulesText(lobby.rules);
        lobby.rules = r; Store.setNet('rules', r); fixTeams(); pushLobby(); renderLobby();
        if (rulesText(r) !== before) sysChat('Rules: ' + rulesText(r));
      } : null });
    });
    $('ssRules').addEventListener('click', () => { Sfx.click(); openRules({ rules: split.rules || splitRules(), teams: false, n: 2, done: r => { split.rules = Object.assign(r, { teams: 0 }); Store.setNet('splitRules', split.rules); openSplit(); } }); });
    $('rulesDone').addEventListener('click', () => { Sfx.click(); closeRules(true); });
    $('rulesClose').addEventListener('click', () => { Sfx.click(); closeRules(false); });
    $('lbTank').addEventListener('click', () => {
      Sfx.click();
      openPrepare({ title: 'CHANGE YOUR TANK', spec: Store.net.tank, nameRow: false,
        then: spec => {
          Store.setNet('tank', spec);
          if (!lobby) return openLan();
          if (lobby.host) { const P = meP(); if (P) P.spec = cleanSpec(spec); pushLobby(); } else Net.toHost({ t: 'tank', spec });
          openLobby();
        },
        back: () => (lobby ? openLobby() : openLan()) });
    });
    $('lbForm').addEventListener('submit', e => { e.preventDefault(); sendChat($('lbText').value); $('lbText').value = ''; });
    $('lbText').addEventListener('keydown', e => e.stopPropagation());       // typing never drives a tank or pauses
    $('ppName').addEventListener('keydown', e => e.stopPropagation()); $('ppTank').addEventListener('keydown', e => e.stopPropagation());
    // split screen
    $('ssPick').addEventListener('click', () => { Sfx.click(); openPicker(2, m => { split.map = m; openSplit(); }); });
    $('ssGo').addEventListener('click', () => { Sfx.click(); startSplit(split.map.L); });
    $('ssBack').addEventListener('click', () => { Sfx.click(); openMulti(); });
    // map picker
    document.querySelectorAll('#mpTabs button').forEach(b => b.addEventListener('click', () => { Sfx.click(); pickTab = b.dataset.mtab; renderPicker(); }));
    $('mpClose').addEventListener('click', () => { Sfx.click(); closePicker(); });
    // pause
    $('vpContinue').addEventListener('click', () => { Sfx.click(); $('vsPause').classList.remove('active'); Game.resume(); });
    $('vpQuit').addEventListener('click', () => { Sfx.click(); pauseQuit(); });
    window.addEventListener('beforeunload', () => { try { Net.close(); } catch (e) {} });
  }
  document.addEventListener('DOMContentLoaded', init);

  return { openMulti, goLocal, goSplit, openSplit, startSplit, openLan, openLobby, onPause, closePicker, openPicker, search, hostGame, joinGame, sendChat, kick, startMatch, leave,
    get lobby() { return lobby; }, get split() { return split; }, get pp() { return pp; }, get seen() { return seen; }, cleanSpec, newSpec, readSpec, renderPrepare,
    get pickerOpen() { return !!picker; }, campaignMaps, createdMaps, openRules, closeRules, pickTeam, setTeam, teamProblem, get rp() { return rp; } };
})();
