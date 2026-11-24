"""Level creator + tank creator + every custom power, in a real browser. Run: python -I debug/creator.py"""
import os, sys, time, base64, subprocess, socket, json
sys.path.insert(0, r"C:\Users\JesusFam\slayerfiles-debug")
import harness
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE)
s = socket.socket(); s.bind(("127.0.0.1", 0)); port = s.getsockname()[1]; s.close()
srv = subprocess.Popen(["node", "server.js"], cwd=ROOT, env={**os.environ, "PORT": str(port)}, stdout=subprocess.DEVNULL)
time.sleep(0.8)
proc, cdp = harness.launch_chrome("chrome-tankfiles")
fails = []
def check(name, ok, info=""):
    print(("ok   " if ok else "FAIL ") + name + (f"  ({info})" if not ok and info != "" else "")); ok or fails.append(name)
E = cdp.eval
D = "Game.debug"; T = 40
def shot(name):
    r = cdp.send("Page.captureScreenshot", {"format": "png"})
    open(os.path.join(HERE, "shots", name + ".png"), "wb").write(base64.b64decode(r["result"]["data"]))
def mouse(kind, x, y, button="left", buttons=1):
    cdp.send("Input.dispatchMouseEvent", {"type": kind, "x": x, "y": y, "button": button, "buttons": buttons if kind != "mouseReleased" else 0, "clickCount": 1})
def tile_xy(c, r):
    p = E(f"{D}.screenOf({(c + 0.5) * T}, {(r + 0.5) * T})"); return p["x"], p["y"]
def click_tile(c, r, button="left"):
    x, y = tile_xy(c, r); mouse("mousePressed", x, y, button, 1 if button == "left" else 2); mouse("mouseReleased", x, y, button); cdp.pump(0.05)
def click(sel):
    E(f"document.querySelector({json.dumps(sel)}).click()"); cdp.pump(0.08)
tile = lambda c, r: E(f"Editor.level.tiles[{r} * Editor.level.cols + {c}]")

HELPERS = r"""
window.mk = (cols, rows, tiles, player, enemies, extra) => {
  const L = Editor.blank(cols, rows); for (const [c, r, v] of tiles) L.tiles[r * cols + c] = v;
  L.player = player; L.enemies = enemies; Object.assign(L, extra || {});
  window.__done = false; Game.playCustom(L, () => { window.__done = true; });
  Game.debug.skipIntro();
  Game.debug.tanks.slice(1).forEach(t => { t.ai.fireT = 999; if (t.ai.mineT) t.ai.mineT = 999; t.ai.charge = 999; });
};
window.spec = (id, powers, more) => { const s = Object.assign({ id, name: id, col: {}, powers, speed: 50, hp: 1, dropLiquid: 'oil', dropSize: 3, enchantRange: 16 }, more || {}); Store.saveTank(s); registerCustomTank(s); return 'c_' + id; };
window.step = sec => { for (let i = 0; i < sec * 60; i++) Game.debug.tick(1 / 60); };
window.en = i => Game.debug.tanks[i];
"""
try:
    cdp.send("Emulation.setDeviceMetricsOverride", {"width": 1280, "height": 720, "deviceScaleFactor": 1, "mobile": False})
    cdp.send("Page.navigate", {"url": f"http://127.0.0.1:{port}/"}); cdp.pump(1.0)
    E("localStorage.clear()"); cdp.send("Page.reload", {}); cdp.pump(1.2)
    E("window.__errs = []; window.addEventListener('error', e => window.__errs.push(e.message + ' @' + e.lineno))")
    E(HELPERS)

    # ================= level creator UI =================
    click("#editorBtn")
    check("LEVEL CREATOR opens an empty 24 x 16 map", E("[Game.state, Editor.level.cols, Editor.level.rows, Editor.level.enemies.length, Editor.level.tiles.filter((v, i) => v && i % 24 && i % 24 !== 23 && i > 24 && i < 24 * 15).length]") == ["edit", 24, 16, 0, 0])
    click("#edBlocks [data-block=wall]"); click_tile(5, 5)
    check("clicking a square with WALL places a wall", tile(5, 5) == 1)
    x0, y0 = tile_xy(6, 9); x1, y1 = tile_xy(9, 9)
    mouse("mousePressed", x0, y0)
    for k in range(1, 9): mouse("mouseMoved", x0 + (x1 - x0) * k / 8, y0)
    mouse("mouseReleased", x1, y0); cdp.pump(0.05)
    check("dragging paints a line of walls", [tile(c, 9) for c in range(6, 10)] == [1, 1, 1, 1])
    click_tile(5, 5, "right")
    check("right-click erases a square", tile(5, 5) == 0)
    click("#edBlocks [data-block=crate]"); click_tile(7, 3)
    click("#edBlocks [data-block=lava]"); click_tile(12, 3)
    click("#edBlocks [data-block=hole]"); click_tile(13, 3)
    check("breakable, lava and hole squares", [tile(7, 3), tile(12, 3), tile(13, 3)] == [2, 7, 3])
    click("#edBlocks [data-block=tele]")
    for c in range(1, 12): click_tile(c, 13)
    check("only 10 teleport squares can be placed", E("Editor.level.tiles.filter(v => v === 11).length") == 10 and tile(11, 13) == 0)
    click("#edTabs [data-tab=tanks]"); click("#edTanks [data-tank=red]"); click_tile(18, 4)
    check("a red tank is placed from the TANKS tab", E("JSON.stringify(Editor.level.enemies)") == '[["red",18.5,4.5]]')
    click_tile(18, 4)
    check("tapping the same tank again takes it away", E("Editor.level.enemies.length") == 0)
    click("#edTanks [data-tank=player]"); click_tile(3, 7)
    check("the player tank can be moved", E("Editor.level.player") == [3.5, 7.5])
    click("#edTanks [data-tank=red]"); click_tile(7, 3)
    check("no tank on a breakable block", E("Editor.level.enemies.length") == 0)
    click_tile(18, 4)
    click("[data-size='c+']"); click("[data-size='r-']")
    check("the size buttons resize the map and keep what is on it", E("[Editor.level.cols, Editor.level.rows, Game.debug.consts.COLS, Game.debug.consts.ROWS]") == [25, 15, 25, 15] and tile(7, 3) == 2)
    click("#edTabs [data-tab=style]"); E("document.querySelectorAll('.ed-style')[5].click()"); cdp.pump(0.1)
    click("[data-color=floor]"); E("document.querySelector('#palGrid [data-c]').click()"); cdp.pump(0.1)
    check("map style and a floor colour are set", E("[Editor.level.floor, !!Editor.level.colors.floor, Game.debug.level.floor]") == ["volcano", True, "volcano"])
    click("[data-color=floor]"); click("#palDefault")
    check("DEFAULT takes a colour off again", E("Editor.level.colors.floor") is None)
    E("document.getElementById('edName').value = 'TEST YARD'; document.getElementById('edName').dispatchEvent(new Event('input'))")
    click("#edSave")
    check("SAVE keeps the level", E("Store.customLevels.map(l => l.name)") == ["TEST YARD"])
    click("#edNew"); click("#confirmYes")
    check("NEW clears the map", E("Editor.level.enemies.length + Editor.level.tiles.filter(v => v === 11).length") == 0)
    click("#edLoad"); E("document.querySelector('#edLoadList .sbtn').click()"); cdp.pump(0.1)
    check("LOAD brings it back", E("[Editor.level.name, Editor.level.enemies.length, Editor.level.tiles.filter(v => v === 11).length]") == ["TEST YARD", 1, 10])
    shot("21a-creator")

    # ================= tank creator UI =================
    click("#edTabs [data-tab=tanks]"); click("#edCreateTank")
    check("+ CREATE TANK opens the painter with a black and white tank", E("[document.getElementById('tankmaker').classList.contains('active'), Editor.spec.col.body, Editor.spec.col.tread]") == [True, "#f2f2f2", "#1c1c20"])
    E("document.querySelectorAll('#tmPalette .pal-sw')[0].click()"); cdp.pump(0.05)
    picked = E("Editor.spec ? document.querySelector('#tmPalette .pal-sw.on').dataset.c : ''")
    r = E("(() => { const b = document.getElementById('tmCanvas').getBoundingClientRect(); return [b.left, b.top, b.width / 360]; })()")
    hx, hy = r[0] + (180 - 0.72 * 16 * 5.2) * r[2], r[1] + (140 + 0.1 * 16 * 5.2) * r[2]
    mouse("mousePressed", hx, hy); mouse("mouseReleased", hx, hy); cdp.pump(0.1)
    check("tapping the hull on the picture paints the hull", E("Editor.spec.col.body") == picked, E("Editor.spec.col.body"))
    click("#tmParts [data-part=tread]")
    check("tapping a part's name paints it", E("Editor.spec.col.tread") == picked)
    pw = lambda: E("Editor.spec.powers")
    for p in ["rocket", "multi2", "mines"]: click(f"#tmPowers [data-power={p}]")
    click("#tmPowers [data-power=bouncy]")
    check("a second weapon swaps the first", pw() == ["multi2", "mines", "bouncy"])
    click("#tmPowers [data-power=multi5]")
    check("multi shots replace each other", pw() == ["mines", "bouncy", "multi5"])
    click("#tmSelected [data-power=mines]")
    check("tapping a selected power takes it off", pw() == ["bouncy", "multi5"])
    click("#tmPowers [data-power=suicide]")
    check("Suicide takes away the other powers", pw() == ["suicide"])
    click("#tmPowers [data-power=rocket]")
    check("a suicide tank refuses other powers", pw() == ["suicide"])
    click("#tmPowers [data-power=dropper]")
    check("... except Suicide Dropper", pw() == ["suicide", "dropper"] and E("document.getElementById('tmDropOpts').classList.contains('hidden')") is False)
    click("#tmSelected [data-power=suicide]"); click("#tmSelected [data-power=dropper]")
    for p in ["homing", "multi1", "invis", "enchanter", "resist", "teleport", "immLava", "immMines", "immFF"]: click(f"#tmPowers [data-power={p}]")
    E("document.getElementById('tmSpeed').value = 120; document.getElementById('tmSpeed').dispatchEvent(new Event('input'))")
    E("document.getElementById('tmHp').value = 7; document.getElementById('tmHp').dispatchEvent(new Event('input'))")
    shot("21b-tankmaker")
    E("document.getElementById('tmName').value = 'Boss'"); click("#tmSave")
    ct = E("'c_' + Editor.spec.id")
    check("SAVE TANK returns to the creator with the tank on the list", E("Game.state") == "edit" and E(f"!!document.querySelector('#edTanks [data-tank={ct}]')") is True)
    check("the saved tank has its dials and powers", E(f"(() => {{ const t = TANK_TYPES['{ct}']; return [t.move, t.hp, t.shells, !!t.homing, !!t.invisible, t.enchanter, !!t.resist, !!t.teleport, !!t.lavaProof, !!t.mineProof, !!t.ffProof]; }})()") == [1.2, 7, 2, True, True, 16, True, True, True, True, True])
    click_tile(16, 10)
    check("the new tank goes on the map", E("Editor.level.enemies.map(e => e[0])") == ["red", ct])

    # ================= TEST, pause, quit, win =================
    click("#edTest")
    check("TEST plays the level", E("[Game.state, Game.isCustom, Game.debug.tanks.length]") == ["intro", True, 3])
    E(f"{D}.skipIntro()"); E("window.dispatchEvent(new KeyboardEvent('keydown', {code: 'Escape'}))"); cdp.pump(0.1)
    check("the pause menu has no SAVE GAME in a test", E("document.getElementById('pauseSave').classList.contains('hidden')") is True and E("Game.state") == "paused")
    click("#pauseQuit")
    check("QUIT GAME goes straight back to the level creator", E("[Game.state, document.getElementById('editor').classList.contains('active')]") == ["edit", True])
    click("#edTest"); E(f"{D}.skipIntro()"); E(f"{D}.tanks.slice(1).forEach(t => {D}.kill(t))"); cdp.pump(2.6)
    check("clearing a test says LEVEL COMPLETE", E("Game.state") == "won")
    E("Game.advance()"); cdp.pump(0.1)
    check("... and goes back to the creator", E("[Game.state, document.getElementById('editor').classList.contains('active')]") == ["edit", True])
    click("#edTabs [data-tab=tanks]"); E(f"document.querySelector('#edTanks [data-tank={ct}] .ed-edit').click()"); cdp.pump(0.1)
    check("the pencil re-opens a tank to edit it", E("[document.getElementById('tankmaker').classList.contains('active'), Editor.spec.name, Editor.spec.hp]") == [True, "Boss", 7])
    click("#tmDelete"); click("#confirmYes")
    check("DELETE removes the tank from the list and the level", E(f"[!!TANK_TYPES['{ct}'], Store.customTanks.length, Editor.level.enemies.map(e => e[0]).join()]") == [False, 0, "red"])

    # ================= the powers =================
    E("Editor.close()")
    # hit points + hearts
    E("mk(16, 10, [], [2.5, 5.5], [[spec('hp3', ['still'], { hp: 3 }), 12.5, 5.5]])")
    check("HP: three hits to kill a 3 HP tank", E(f"[1, 2, 3].map(() => {D}.hitTank(en(1), {{ owner: {D}.player, kind: 'shell' }}))") == ["hurt", "hurt", "dead"])
    # resistance
    E("mk(20, 10, [], [2.5, 5.5], [[spec('res', ['resist', 'still']), 12.5, 2.5], [spec('res', ['resist', 'still']), 12.5, 7.5], ['brown', 17.5, 5.5], [spec('res', ['resist', 'still']), 8.5, 5.5]])")
    check("Resistance: the player's shells bounce off", E(f"[{D}.hitTank(en(1), {{ owner: {D}.player, kind: 'shell' }}), en(1).alive]") == ["resist", True])
    check("... its own team's shots hurt it", E(f"[{D}.hitTank(en(1), {{ owner: en(3), kind: 'shell' }}), en(1).alive]") == ["dead", False])
    E(f"{D}.explode(en(2).x, en(2).y, 30, false, {D}.player)")
    check("... and blasts kill it", E("en(2).alive") is False)
    E(f"{D}.mines.push({{ x: 10.5 * {T}, y: 5.5 * {T}, t: 5, owner: null, boomAt: Infinity, lit: false, gray: true }})")
    check("... it plans routes straight past mines (others will not)", E(f"(() => {{ const i = 5 * 20 + 11; return [{D}.bfs(8, 5, null, 'none', en(4)).dist[i] >= 0, {D}.bfs(8, 5, null, 'none', en(3)).dist[i] >= 0]; }})()") == [True, False])
    # enchanter
    E("mk(24, 10, [], [2.5, 1.5], [[spec('ench', ['enchanter', 'still'], { enchantRange: 6 }), 12.5, 5.5], ['brown', 14.5, 5.5], ['brown', 10.5, 5.5], ['brown', 16.5, 5.5]])")
    E("step(0.1)")
    sh = lambda: E("Game.debug.tanks.slice(2).map(t => t.shield ? t.shield.hp : 0)")
    check("Enchanter: a 2 HP barrier on the 2 nearest tanks", sh() == [2, 2, 0])
    res = E(f"[{D}.hitTank(en(2), {{ owner: {D}.player, kind: 'shell' }}), {D}.hitTank(en(2), {{ owner: {D}.player, kind: 'shell' }}), en(2).alive]")
    E("step(0.1)")
    check("... two hits break it, the tank lives, and the next tank in range gets one", res == ["shield", "shield", True] and sh() == [0, 2, 2], f"{res} {sh()}")
    E(f"en(1).x = 2.5 * {T}"); E("step(0.1)")
    check("... out of range every barrier goes", sh() == [0, 0, 0])
    E(f"en(1).x = 12.5 * {T}"); E("step(0.1)")
    check("... back in range they return, but never on the tank whose barrier broke", sh() == [0, 2, 2])
    # war train
    E("mk(26, 10, [], [23.5, 5.5], [[spec('train', ['train'], { speed: 60 }), 6.5, 5.5], [spec('load', ['load']), 5.5, 5.5], ['c_load', 4.5, 5.5], ['c_load', 3.5, 5.5]])")
    check("War Train: picks up the 3 load tanks behind it", E("en(1).cars.length") == 3)
    x0 = E("en(1).x"); E("step(3)")
    gaps = E("(() => { const e = en(1), p = [e].concat(e.cars); return p.slice(1).map((c, i) => Math.round(Math.hypot(c.x - p[i].x, c.y - p[i].y))); })()")
    check("... drives and pulls them along like a caterpillar", E("en(1).x") > x0 + 40 and all(30 <= g <= 46 for g in gaps), f"moved {E('en(1).x') - x0:.0f} gaps {gaps}")
    E(f"{D}.hitTank(en(3), {{ owner: {D}.player, kind: 'shell' }})")
    check("... shooting the middle car cuts loose the one behind it", E("[en(1).cars.length, en(4).train === null, en(2).train === en(1)]") == [1, True, True])
    lx = E("en(4).x"); E("step(1.5)")
    check("... the loose car stays put and still counts as an enemy", abs(E("en(4).x") - lx) < 0.5 and E("Game.debug.tanks.slice(1).filter(t => t.alive).length") == 3)
    E(f"{D}.kill(en(1))")
    check("... when the train dies its cars come loose", E("en(2).train") is None)
    # suicide load tank
    E("mk(20, 10, [], [3.5, 5.5], [[spec('lsui', ['load', 'suicide'], { speed: 90 }), 14.5, 5.5]])")
    E("step(5)")
    check("Load + Suicide: sits still for its first 10 seconds loose", abs(E(f"en(1).x") - 14.5 * T) < 1)
    E("step(5.4)"); E("step(0.6)")
    moved = E(f"en(1).x") < 14.5 * T - 10
    E("step(6)")
    check("... then wakes, chases the player and blows them up", moved and E(f"[{D}.player.alive, en(1).alive]") == [False, False])
    # suicide tank
    E("mk(20, 10, [], [3.5, 5.5], [[spec('sui', ['suicide'], { speed: 100 }), 14.5, 5.5]])")
    E("step(6)")
    check("Suicide: chases down the player and blows up on contact", E(f"[{D}.player.alive, en(1).alive]") == [False, False])
    # heat seeking rocket round a wall
    E(f"mk(20, 12, [[10,1,1],[10,2,1],[10,3,1],[10,4,1],[10,5,1],[10,6,1],[10,7,1],[10,8,1]], [5.5, 3.5], [[spec('hom', ['homing', 'still']), 15.5, 3.5]])")
    check("Heat seeker: the tank has no straight line to the player", E(f"{D}.los(en(1).x, en(1).y, {D}.player.x, {D}.player.y)") is False)
    E(f"(() => {{ const t = en(1), g = {D}.homingAim(t.x, t.y); t.turret = Math.atan2(g.y - t.y, g.x - t.x); t.shells = 0; {D}.fire(t); }})()")
    check("... fires a bright orange heat seeker", E(f"{D}.shells.map(s => s.homing)") == [True])
    E("step(7)")
    check("... it finds its way round the wall and gets the player", E(f"{D}.player.alive") is False)
    E(f"mk(20, 12, [[10,1,1],[10,2,1],[10,3,1],[10,4,1],[10,5,1],[10,6,1],[10,7,1],[10,8,1]], [5.5, 3.5], [[spec('hom', ['homing', 'still']), 15.5, 3.5]])")
    E(f"(() => {{ const t = en(1), g = {D}.homingAim(t.x, t.y); t.turret = Math.atan2(g.y - t.y, g.x - t.x); t.shells = 0; {D}.fire(t); }})()")
    E("step(1.6)")
    E(f"(() => {{ const s = {D}.shells[0], p = {D}.player; {D}.aim(Math.atan2(s.y - p.y, s.x - p.x)); p.fireCD = 0; {D}.fire(); }})()")
    for _ in range(40):
        if not E(f"{D}.shells.some(s => s.homing)"): break
        E("step(0.1)")
        E(f"(() => {{ const s = {D}.shells.find(s => s.homing), p = {D}.player; if (s && p.shells === 0) {{ {D}.aim(Math.atan2(s.y - p.y, s.x - p.x)); p.fireCD = 0; {D}.fire(); }} }})()")
    check("... and it can be shot down", E(f"[{D}.shells.some(s => s.homing), {D}.player.alive]") == [False, True])
    # frost shot
    E(f"mk(20, 10, [[4,1,1],[4,2,1],[4,3,1],[4,4,1],[4,5,1],[4,6,1],[4,7,1],[4,8,1]], [5.5, 4.5], [[spec('frost', ['frost', 'still']), 15.5, 5.5]])")
    E(f"(() => {{ const t = en(1); t.turret = Math.PI; t.shells = 0; {D}.fire(t); }})()"); E("step(1)")
    check("Frost Shot: ice on 3x3 squares where it hits, the player frozen for 20 s", 18 < E(f"{D}.player.frozen || 0") <= 20 and E(f"{D}.player.alive") is True and E(f"{D}.ices.length") == 9)
    px = E(f"{D}.player.x"); E(f"{D}.key('KeyA', true)"); E("step(0.5)"); E(f"{D}.key('KeyA', false)")
    check("... frozen tanks cannot drive", E(f"{D}.player.x") == px)
    check("... but can still shoot", E(f"(() => {{ {D}.player.fireCD = 0; {D}.aim(0); return {D}.fire(); }})()") is True)
    # super laser through a wall
    E(f"mk(20, 10, [[8,1,1],[8,2,1],[8,3,1],[8,4,1],[8,5,1],[8,6,1],[8,7,1],[8,8,1]], [4.5, 5.5], [[spec('las', ['laser', 'still']), 15.5, 5.5]])")
    E("en(1).turret = Math.PI; en(1).ai.charge = 0"); E("step(0.3)")
    check("Super Laser: the beam goes straight through a wall", E(f"[en(1).beamT > 2, {D}.player.alive, {D}.map[5 * 20 + 8]]") == [True, False, 1])
    E("step(3)")
    check("... lasts 3 s then charges for 6 s (even after the player is gone)", E("[en(1).beamT, Math.round(en(1).ai.charge)]") == [0, 6], E("[en(1).beamT, en(1).ai.charge]"))
    # teleport
    E(f"mk(20, 10, [[5,5,11],[15,5,11]], [2.5, 1.5], [[spec('tel', ['teleport', 'still']), 5.5, 5.5]])")
    check("Teleportation: the two pads are one step apart for it", E(f"{D}.bfs(5, 5, null, 'none', en(1)).dist[5 * 20 + 15]") == 1)
    E(f"(() => {{ const p = {D}.player, t = en(1); {D}.aim(Math.atan2(t.y - p.y, t.x - p.x)); p.fireCD = 0; {D}.fire(); }})()"); E("step(0.25)")
    check("... with a shell coming it jumps to the other pad", E(f"[Math.round(en(1).x / {T} * 2) / 2, en(1).alive]") == [15.5, True])
    # dropper
    E("mk(16, 10, [], [2.5, 5.5], [[spec('drp', ['dropper', 'still'], { dropLiquid: 'lava', dropSize: 3 }), 10.5, 5.5]])")
    E(f"{D}.kill(en(1))")
    check("Suicide Dropper: a 3x3 pool of the liquid picked when it dies", E(f"Array.from({D}.map).filter(v => v === 7).length") == 9)
    E("mk(16, 10, [], [2.5, 5.5], [[spec('drp5', ['dropper', 'still'], { dropLiquid: 'acid', dropSize: 5 }), 8.5, 5.5]])")
    E(f"{D}.kill(en(1))")
    check("... up to 5x5", E(f"Array.from({D}.map).filter(v => v === 8).length") == 25)
    # invisibility
    E("mk(16, 10, [], [2.5, 5.5], [[spec('inv', ['invis', 'still']), 10.5, 5.5]])")
    vis = E(f"{D}.visible(en(1))")
    E(f"{D}.map[5 * 16 + 10] = 10")
    check("Invisibility: unseen on the floor, seen in any liquid (oil here)", vis is False and E(f"{D}.visible(en(1))") is True)
    # immunities
    E(f"mk(16, 10, [[10,5,7],[12,5,7]], [2.5, 5.5], [[spec('iml', ['immLava', 'still']), 10.5, 5.5], ['brown', 12.5, 5.5], [spec('imm', ['immMines', 'still']), 6.5, 2.5], [spec('iff', ['immFF', 'still']), 6.5, 8.5]])")
    E("step(0.3)")
    check("Lava Immunity: sits in lava (a normal tank burns)", E("[en(1).alive, en(2).alive]") == [True, False])
    E(f"{D}.explode(en(3).x, en(3).y, 50, false, {D}.player)")
    check("Mine Immunity: blasts do not hurt it", E("en(3).alive") is True)
    check("Friendly Fire Immunity: its team's shots pass through", E(f"[{D}.hitTank(en(4), {{ owner: en(1), kind: 'shell' }}), en(4).alive]") == [False, True])
    # dials and the simple powers
    st = E("(() => { const t = customType({ powers: ['multi5', 'mines', 'flame'], speed: 120 }), s = customType({ powers: ['still', 'rocket'] }); return [t.shells, !!t.mines, !!t.flame, t.move, s.move, !!s.rocket]; })()")
    check("Multi Shot 5 = 6 shells, Mines, Flame Thrower, speed dial, Stand Still, Rocket", st == [6, True, True, 1.2, 0, True], str(st))
    # colours
    E("Editor.open()"); E("Editor.level.colors = { floor: '#ff2020', wall: '#20c020', water: '#2050ff' }; Editor.refresh()"); cdp.pump(0.3)
    px = E("(() => { const p = Game.debug.screenOf(3.5 * 40, 1.5 * 40), d = document.getElementById('game').getContext('2d').getImageData(p.x, p.y, 1, 1).data; return [d[0], d[1], d[2]]; })()")
    check("colours: the floor turns red", px[0] > px[1] + 40 and px[0] > px[2] + 40, str(px))
    shot("21c-colours")
    check("no JS errors", E("window.__errs") == [], str(E("window.__errs")))
finally:
    harness.kill_chrome(proc); srv.terminate()
print()
print("ALL PASS" if not fails else f"{len(fails)} FAILED: " + ", ".join(fails))
sys.exit(1 if fails else 0)
