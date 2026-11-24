'use strict';
// Saves and settings. Three save slots (like Donkey Kong) plus one shared options block. Lives in localStorage on each device.
const Store = (() => {
  const OPT_KEY = 'tankfiles_opts_v1', SLOT_KEY = 'tankfiles_slots_v1', PROG_KEY = 'tankfiles_progress_v1';
  const TANK_KEY = 'tankfiles_custom_tanks_v1', LVL_KEY = 'tankfiles_custom_levels_v1', DRAFT_KEY = 'tankfiles_editor_draft_v1';   // the level creator
  const PTANK_KEY = 'tankfiles_player_tanks_v1', LMAP_KEY = 'tankfiles_local_maps_v1', NET_KEY = 'tankfiles_net_v1';   // multiplayer
  const DEF_OPTS = { sfx: 0.8, music: 0.6, shake: true, aimLine: true, stick: 'dynamic', color: 'blue' };

  let opts = Object.assign({}, DEF_OPTS);
  let slots = [null, null, null];
  let progress = { allClear: false };
  let customTanks = [], customLevels = [], draft = null, playerTanks = [], localMaps = [], net = { name: '', tank: null, tank2: null };       // things that outlive any one save file (level select unlock)
  try {
    const p = JSON.parse(localStorage.getItem(PROG_KEY) || 'null');
    if (p && typeof p === 'object') Object.assign(progress, p);
    const o = JSON.parse(localStorage.getItem(OPT_KEY) || 'null');
    if (o && typeof o === 'object') Object.assign(opts, o);
    const s = JSON.parse(localStorage.getItem(SLOT_KEY) || 'null');
    if (Array.isArray(s) && s.length === 3) slots = s.map(x => (x && typeof x === 'object' ? x : null));
  } catch (e) {}
  try {
    const t = JSON.parse(localStorage.getItem(TANK_KEY) || 'null'); if (Array.isArray(t)) customTanks = t.filter(x => x && x.id);
    const l = JSON.parse(localStorage.getItem(LVL_KEY) || 'null'); if (Array.isArray(l)) customLevels = l.filter(x => x && x.id);
    draft = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null');
  } catch (e) {}
  try {
    const t = JSON.parse(localStorage.getItem(PTANK_KEY) || 'null'); if (Array.isArray(t)) playerTanks = t.filter(x => x && x.id);
    const m = JSON.parse(localStorage.getItem(LMAP_KEY) || 'null'); if (Array.isArray(m)) localMaps = m.filter(x => x && x.id);
    const n = JSON.parse(localStorage.getItem(NET_KEY) || 'null'); if (n && typeof n === 'object') Object.assign(net, n);
  } catch (e) {}
  const put = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };
  const upsert = (list, item) => { const i = list.findIndex(x => x.id === item.id); if (i >= 0) list[i] = item; else list.push(item); };

  function saveOpts() { try { localStorage.setItem(OPT_KEY, JSON.stringify(opts)); } catch (e) {} }
  function saveProgress() { try { localStorage.setItem(PROG_KEY, JSON.stringify(progress)); } catch (e) {} }
  function saveSlots() { try { localStorage.setItem(SLOT_KEY, JSON.stringify(slots)); } catch (e) {} }

  // A fresh game: level 1, the standard Wii-style life count, nothing destroyed yet.
  function newSave() {
    return { level: 1, lives: 3, kills: 0, deaths: 0, time: 0, date: new Date().toISOString(), created: Date.now() };
  }

  return {
    get opts() { return opts; },
    setOpt(k, v) { opts[k] = v; saveOpts(); },
    resetOpts() { opts = Object.assign({}, DEF_OPTS); saveOpts(); },
    get progress() { return progress; },
    setProgress(k, v) { progress[k] = v; saveProgress(); },
    get slots() { return slots; },
    slot(i) { return slots[i] || null; },
    writeSlot(i, data) { slots[i] = Object.assign({}, data, { date: new Date().toISOString() }); saveSlots(); return slots[i]; },
    deleteSlot(i) { slots[i] = null; saveSlots(); },
    newSave,
    // level creator: custom tanks, saved levels and the level being worked on
    get customTanks() { return customTanks; },
    saveTank(spec) { upsert(customTanks, JSON.parse(JSON.stringify(spec))); put(TANK_KEY, customTanks); },
    deleteTank(id) { customTanks = customTanks.filter(x => x.id !== id); put(TANK_KEY, customTanks); },
    get customLevels() { return customLevels; },
    saveLevel(L) { upsert(customLevels, Object.assign(JSON.parse(JSON.stringify(L)), { updated: Date.now() })); put(LVL_KEY, customLevels); },
    deleteLevel(id) { customLevels = customLevels.filter(x => x.id !== id); put(LVL_KEY, customLevels); },
    get draft() { return draft; },
    // multiplayer: saved player tanks, Local maps (spawn flags instead of tanks), your name and the tanks last used
    get playerTanks() { return playerTanks; },
    savePlayerTank(spec) { upsert(playerTanks, JSON.parse(JSON.stringify(spec))); put(PTANK_KEY, playerTanks); },
    deletePlayerTank(id) { playerTanks = playerTanks.filter(x => x.id !== id); put(PTANK_KEY, playerTanks); },
    get localMaps() { return localMaps; },
    saveLocalMap(L) { upsert(localMaps, Object.assign(JSON.parse(JSON.stringify(L)), { updated: Date.now() })); put(LMAP_KEY, localMaps); },
    deleteLocalMap(id) { localMaps = localMaps.filter(x => x.id !== id); put(LMAP_KEY, localMaps); },
    get net() { return net; },
    setNet(k, v) { net[k] = v; put(NET_KEY, net); },
    setDraft(L) { draft = L; put(DRAFT_KEY, L); },
    fmtTime(sec) {
      sec = Math.max(0, Math.floor(sec || 0));
      const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
      return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(s).padStart(2, '0');
    },
    fmtDate(iso) {
      const d = new Date(iso); if (isNaN(d)) return '';
      return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    },
  };
})();
