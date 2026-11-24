'use strict';
// Menus: title -> save slots -> game; pause -> save to a slot (Donkey Kong style) / options / quit; the armed DELETE SAVE button.
const UI = (() => {
  const $ = id => document.getElementById(id);
  const PAGES = ['title', 'slots', 'levels', 'options', 'editor', 'tankmaker', 'multi', 'prepare', 'lan', 'lobby', 'splitset'];
  // Level select stays locked until every mission has been cleared once. Set to false while the game is being built;
  // flip to true before publishing (the user asked for this).
  const LEVEL_SELECT_LOCKED = true;
  let slotMode = 'load';          // 'load' (from PLAY) or 'save' (from the pause menu)
  let deleting = false;           // the DELETE SAVE button is armed
  let optionsFrom = 'title';      // where BACK on the options page goes
  let confirmYes = null;
  let toastT = 0;

  function page(id) {
    for (const p of PAGES) $(p).classList.toggle('active', p === id);
    if (id !== 'slots' && deleting) setDeleting(false);
  }
  function overlay(id, on) { $(id).classList.toggle('active', on); }
  function toast(msg, ms) {
    const t = $('toast'); t.textContent = msg; t.classList.remove('hidden');
    clearTimeout(toastT); toastT = setTimeout(() => t.classList.add('hidden'), ms || 1600);
  }
  function confirm(text, onYes) {
    $('confirmText').textContent = text; confirmYes = onYes; overlay('confirm', true);
  }

  // ---------- level select ----------
  const THEME = { grass: 'green', snow: 'white', sand: 'yellow', beach: 'aqua', volcano: 'red', factory: 'gray', battle: 'orange', grave: 'purple' };   // level select button colour per map style (indoor = blue)
  const levelSelectOpen = () => !LEVEL_SELECT_LOCKED || Store.progress.allClear;
  function refreshLevelButton() {
    const b = $('levelSelectBtn'); b.classList.toggle('locked', !levelSelectOpen());
    b.textContent = levelSelectOpen() ? 'LEVEL SELECT' : 'LEVEL SELECT (LOCKED)';
  }
  function openLevels() {
    if (!levelSelectOpen()) { toast('Clear every mission to unlock level select', 2200); return; }
    const grid = $('levelGrid'); grid.innerHTML = '';
    LEVELS.forEach((L, i) => {
      const b = document.createElement('button'); b.className = 'lbtn t-' + (THEME[L.floor] || 'blue'); b.textContent = i + 1; b.dataset.level = i + 1; b.title = L.name;
      b.addEventListener('click', () => { Sfx.click(); page(null); Game.start(Object.assign(Store.newSave(), { level: i + 1 })); toast(L.name); });
      grid.appendChild(b);
    });
    page('levels');
  }

  // ---------- save slots ----------
  function openSlots(mode) {
    slotMode = mode;
    $('slotsTitle').textContent = mode === 'save' ? 'SAVE TO WHICH FILE?' : 'SELECT FILE';
    renderSlots();
    page('slots');
  }
  function renderSlots() {
    const list = $('slotList'); list.innerHTML = '';
    for (let i = 0; i < 3; i++) {
      const s = Store.slot(i), b = document.createElement('button');
      b.type = 'button'; b.className = 'slot' + (s ? '' : ' empty'); b.dataset.slot = i;
      const pc = PLAYER_COLORS[Store.opts.color] || PLAYER_COLORS.blue;
      const ico = s ? `style="background: radial-gradient(circle at 40% 35%, ${pc.light}, ${pc.body} 55%, ${pc.dark})"` : '';
      b.innerHTML = `<div class="num">${i + 1}</div><div class="tank-ico" ${ico}></div><div class="body">` +
        (s ? `<div class="lvl">LEVEL ${s.level}</div><div class="meta">${s.lives} lives &middot; ${Store.fmtTime(s.time)} played &middot; ${Store.fmtDate(s.date)}</div>`
           : `<div class="lvl">EMPTY</div><div class="meta">${slotMode === 'save' ? 'Save here' : 'Start a new game'}</div>`) + '</div>';
      b.addEventListener('click', () => onSlot(i));
      list.appendChild(b);
    }
  }
  function onSlot(i) {
    Sfx.click();
    const s = Store.slot(i);
    if (deleting) {
      if (!s) { toast('That file is already empty'); return; }
      confirm('Are you sure you want to delete this save?', () => { Store.deleteSlot(i); renderSlots(); toast(`File ${i + 1} deleted`); });
      return;
    }
    if (slotMode === 'load') {
      const data = s ? JSON.parse(JSON.stringify(s)) : Store.newSave();
      page(null);
      Game.start(data);
      toast(s ? `File ${i + 1} loaded` : 'New game');
      return;
    }
    // saving from the pause menu
    const doSave = () => {
      Store.writeSlot(i, Game.save);
      page(null); overlay('pause', true);
      $('pauseNote').textContent = `Saved to File ${i + 1}`;
      toast(`Saved to File ${i + 1}`);
    };
    if (s) confirm(`Overwrite File ${i + 1} with your current game?`, doSave); else doSave();
  }
  function setDeleting(on) {
    deleting = on;
    $('deleteBtn').classList.toggle('armed', on);
    $('slotList').classList.toggle('slots-deleting', on);
    $('deleteBtn').textContent = on ? 'DELETE SAVE: ON' : 'DELETE SAVE';
  }

  // ---------- options ----------
  function renderSwatches() {
    const box = $('optColors'); box.innerHTML = '';
    for (const name in PLAYER_COLORS) {
      const c = PLAYER_COLORS[name], b = document.createElement('button');
      b.type = 'button'; b.className = 'swatch' + (Store.opts.color === name ? ' on' : ''); b.title = name[0].toUpperCase() + name.slice(1);
      b.style.setProperty('--b', c.body); b.style.setProperty('--d', c.dark); b.style.setProperty('--l', c.light);
      b.addEventListener('click', () => { Sfx.click(); Store.setOpt('color', name); Game.recolor(); renderSwatches(); });
      box.appendChild(b);
    }
  }
  function loadOptions() {
    const o = Store.opts;
    renderSwatches();
    $('optSfx').value = o.sfx; $('optSfxV').textContent = Math.round(o.sfx * 100) + '%';
    $('optMusic').value = o.music; $('optMusicV').textContent = Math.round(o.music * 100) + '%';
    $('optShake').checked = !!o.shake; $('optAim').checked = !!o.aimLine;
    const z = typeof o.zoom === 'number' ? o.zoom : (window.matchMedia && matchMedia('(pointer: coarse)').matches ? 0.8 : 0);
    $('optZoom').value = z; $('optZoomV').textContent = zoomText(z);
  }
  const zoomText = z => z <= 0 ? 'ALL' : Math.round(z * 100) + '%';
  function openOptions(from) { optionsFrom = from; loadOptions(); overlay('pause', false); page('options'); }
  function closeOptions() {
    if (optionsFrom === 'pause') { page(null); overlay('pause', true); } else page('title');
  }

  // ---------- wiring ----------
  function init() {
    Game.init();
    Game.onPause = () => {
      if (Game.isVersus) { Versus.onPause(); return; }                     // multiplayer has its own pause menu
      $('pauseNote').textContent = ''; $('pauseSave').classList.toggle('hidden', Game.isCustom); overlay('pause', true);   // no saving a level creator test
    };
    Game.onLeave = () => page('title');

    document.querySelectorAll('[data-go]').forEach(b => b.addEventListener('click', () => {
      Sfx.unlock(); Sfx.click();
      const go = b.dataset.go;
      if (go === 'slots-load') openSlots('load');
      else if (go === 'levels') openLevels();
      else if (go === 'options') openOptions('title');
      else if (go === 'editor') Editor.open();
      else if (go === 'multi') Versus.openMulti();
      else page(go);
    }));
    $('levelsBack').addEventListener('click', () => { Sfx.click(); page('title'); });
    refreshLevelButton();
    Game.onLeave = () => { refreshLevelButton(); page('title'); };
    $('slotsBack').addEventListener('click', () => { Sfx.click(); if (slotMode === 'save') { page(null); overlay('pause', true); } else page('title'); });
    $('deleteBtn').addEventListener('click', () => { Sfx.click(); setDeleting(!deleting); });

    $('confirmYes').addEventListener('click', () => { Sfx.click(); overlay('confirm', false); const f = confirmYes; confirmYes = null; if (f) f(); });
    $('confirmNo').addEventListener('click', () => { Sfx.click(); overlay('confirm', false); confirmYes = null; });

    $('pauseContinue').addEventListener('click', () => { Sfx.click(); overlay('pause', false); Game.resume(); });
    $('pauseSave').addEventListener('click', () => { Sfx.click(); overlay('pause', false); openSlots('save'); });
    $('pauseOptions').addEventListener('click', () => { Sfx.click(); openOptions('pause'); });
    $('pauseQuit').addEventListener('click', () => {
      Sfx.click();
      if (Game.isCustom) { overlay('pause', false); Game.stop(); Editor.resume(); return; }    // a level creator test goes straight back to the editor
      confirm("Quit to the title screen? Anything you haven't saved will be lost.", () => { overlay('pause', false); Game.stop(); page('title'); });
    });
    // Escape / P: close a confirm, else leave the pause menu, else pause the game
    window.addEventListener('keydown', e => {
      if (e.repeat || (e.code !== 'Escape' && e.code !== 'KeyP')) return;
      if ($('confirm').classList.contains('active')) { overlay('confirm', false); confirmYes = null; }
      else if (!$('mapPick').classList.contains('hidden')) Versus.closePicker();
      else if ($('vsPause').classList.contains('active')) { $('vsPause').classList.remove('active'); Game.resume(); }
      else if (!$('ppLoadBox').classList.contains('hidden')) $('ppLoadBox').classList.add('hidden');
      else if (Game.isVersus && (Game.state === 'playing' || Game.state === 'intro')) Game.pause();
      else if ($('editor').classList.contains('active')) { $('palBox').classList.add('hidden'); $('edLoadBox').classList.add('hidden'); }
      else if ($('tankmaker').classList.contains('active')) Editor.resume();
      else if ($('pause').classList.contains('active')) { overlay('pause', false); Game.resume(); }
      else if ($('options').classList.contains('active') && optionsFrom === 'pause') closeOptions();
      else if ($('slots').classList.contains('active') && slotMode === 'save') { page(null); overlay('pause', true); }
      else if (Game.state === 'playing' || Game.state === 'dead') Game.pause();
    });

    $('optSfx').addEventListener('input', e => { Store.setOpt('sfx', +e.target.value); $('optSfxV').textContent = Math.round(e.target.value * 100) + '%'; });
    $('optSfx').addEventListener('change', () => Sfx.fire());
    $('optMusic').addEventListener('input', e => { Store.setOpt('music', +e.target.value); $('optMusicV').textContent = Math.round(e.target.value * 100) + '%'; });
    $('optShake').addEventListener('change', e => Store.setOpt('shake', e.target.checked));
    $('optZoom').addEventListener('input', e => { Store.setOpt('zoom', +e.target.value); $('optZoomV').textContent = zoomText(+e.target.value); });
    $('optAim').addEventListener('change', e => Store.setOpt('aimLine', e.target.checked));
    $('optReset').addEventListener('click', () => { Store.resetOpts(); loadOptions(); toast('Options reset'); });
    $('optBack').addEventListener('click', () => { Sfx.click(); closeOptions(); });

    // stop the browser's own gestures (pinch, double-tap zoom, back swipe) inside the game
    document.addEventListener('gesturestart', e => e.preventDefault());
    document.addEventListener('dblclick', e => e.preventDefault());
  }

  // the Android app's BACK button: the same as Esc (close a pop-up, step out of a menu, pause a match)
  window.onBackButton = () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape', key: 'Escape' }));
    const back = ['levelsBack', 'slotsBack', 'optBack', 'mpBack', 'lanBack', 'ssBack', 'ppBack'].map(id => $(id)).find(b => b && b.closest('.screen.active'));
    if (back && !$('confirm').classList.contains('active')) back.click();
  };
  // phones on the website: the first touch goes full screen and holds the phone sideways (the app is already like that)
  function goFull() {
    if (window.AndroidApp || document.fullscreenElement || !document.documentElement.requestFullscreen) return;
    if (!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches)) return;
    document.documentElement.requestFullscreen({ navigationUI: 'hide' })
      .then(() => screen.orientation && screen.orientation.lock && screen.orientation.lock('landscape').catch(() => {}))
      .catch(() => {});
  }
  document.addEventListener('pointerup', goFull, true);
  document.addEventListener('DOMContentLoaded', init);
  return { page, openSlots, confirm, toast, get deleting() { return deleting; }, get slotMode() { return slotMode; } };
})();
