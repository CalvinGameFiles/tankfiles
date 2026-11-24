"""Smoke test for TankFiles: starts server.js, drives the real page in headless Chrome.
Title -> save slots (new game, delete toggle + confirm) -> test arena (drive, fire, ricochet, mine, death X) -> pause -> save to a slot -> quit.
Run:  python debug/smoke.py      (screenshots land in debug/shots/)
"""
import os, sys, json, time, base64, subprocess, socket
sys.path.insert(0, r"C:\Users\JesusFam\slayerfiles-debug")
import harness

HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE)
SHOTS = os.path.join(HERE, "shots"); os.makedirs(SHOTS, exist_ok=True)
fails = []
def check(name, ok, extra=""):
    print(("PASS " if ok else "FAIL ") + name + (f"  ({extra})" if extra else ""))
    if not ok: fails.append(name)
def shot(cdp, name):
    r = cdp.send("Page.captureScreenshot", {"format": "png"})
    open(os.path.join(SHOTS, name + ".png"), "wb").write(base64.b64decode(r["result"]["data"]))

s = socket.socket(); s.bind(("127.0.0.1", 0)); port = s.getsockname()[1]; s.close()
srv = subprocess.Popen(["node", "server.js"], cwd=ROOT, env={**os.environ, "PORT": str(port)}, stdout=subprocess.DEVNULL)
time.sleep(0.8)
proc, cdp = harness.launch_chrome("chrome-tankfiles")
E = cdp.eval; D = "Game.debug"
def active(id): return E(f"document.getElementById('{id}').classList.contains('active')")
def click(sel): E("document.querySelector(" + json.dumps(sel) + ").click()"); cdp.pump(0.25)
def mouse(t, x, y, button="left"):
    cdp.send("Input.dispatchMouseEvent", {"type": t, "x": x, "y": y, "button": button, "buttons": 0 if t == "mouseReleased" else (2 if button == "right" else 1), "clickCount": 1})
try:
    cdp.send("Emulation.setDeviceMetricsOverride", {"width": 960, "height": 540, "deviceScaleFactor": 1, "mobile": False})
    cdp.send("Page.navigate", {"url": f"http://127.0.0.1:{port}/"}); cdp.pump(1.5)
    E("localStorage.clear(); location.reload()"); cdp.pump(1.5)
    errs = E("(() => { const e = []; window.addEventListener('error', ev => e.push(ev.message)); window.__errs = e; return 0; })()")
    shot(cdp, "01-title")
    check("title visible", active("title"))
    check("title has PLAY + MULTIPLAYER + LEVEL SELECT + LEVEL CREATOR + OPTIONS in that order", E("[...document.querySelectorAll('#title .mbtn')].map(b => b.textContent)") == ["PLAY", "MULTIPLAYER", "LEVEL SELECT", "LEVEL CREATOR", "OPTIONS"])
    click("[data-go=levels]")
    check("level select lists every mission", active("levels") and E("document.querySelectorAll('#levelGrid .lbtn').length") == E("LEVELS.length"))
    shot(cdp, "01b-levels")
    check("level buttons are coloured by map style", E("['blue','green','white','yellow','aqua','red','gray','orange','purple'].map(c => document.querySelectorAll('#levelGrid .lbtn.t-' + c).length)") == [9, 11, 10, 10, 13, 11, 16, 10, 10])
    click("#levelGrid .lbtn[data-level='7']"); cdp.pump(0.2)
    check("picking mission 7 starts a fresh game there", E("Game.state") == "intro" and E("Game.save.level") == 7 and E("Game.save.lives") == 3)
    E("Game.stop()"); E("UI.page('title')") if E("typeof UI.page") == "function" else None
    click("[data-go=levels]"); click("#levelsBack")
    check("BACK leaves level select for the title", active("title"))

    # ---- options
    click("[data-go=options]")
    check("options page", active("options"))
    E("const r=document.getElementById('optShake'); r.checked=false; r.dispatchEvent(new Event('change'))")
    check("option saved", E("Store.opts.shake") is False)
    click("#optBack"); check("back to title", active("title"))

    # ---- slots: all empty, new game
    click("[data-go=slots-load]")
    check("slots page", active("slots"))
    check("3 empty slots", E("document.querySelectorAll('#slotList .slot.empty').length") == 3)
    shot(cdp, "02-slots")
    click("#slotList .slot[data-slot='1']")
    check("new game started with the mission intro", E("Game.state") == "intro" and E("Game.save.level") == 1)
    check("no page over the game", not active("slots") and not active("title"))
    check("mission 1 is 13x8 with one brown tank", E(f"[{D}.consts.COLS, {D}.consts.ROWS, {D}.tanks.length, {D}.tanks[1].type]") == [13, 8, 2, "brown"])
    cdp.pump(0.4); shot(cdp, "03-intro")
    cdp.pump(1.8)
    check("intro ends by itself", E("Game.state") == "playing")
    shot(cdp, "03-arena")
    # the brown tank sits still and fires one shell at a time (forced to shoot now, then told to hold fire for the rest)
    HOLD = f"{D}.tanks[1].ai.fireT = 999"
    bx0 = E(f"{D}.tanks[1].x")
    # shot simulator: straight right from the brown tank hits the wall beside it and comes straight back = 'self'
    check("sim: muzzle against the wall beside it = pops on the wall", E(f"{D}.simShot({D}.tanks[1], 0)") == "wall")
    check("sim: a shot straight up bounces back on itself", E(f"{D}.simShot({D}.tanks[1], -Math.PI/2)") == "self")
    check("sim: a shot up-left dies on the walls", E(f"{D}.simShot({D}.tanks[1], -Math.PI*0.6)") == "wall")
    # move the player into the open on the brown tank's side so a straight line exists
    E(f"{D}.player.x = 8.5*40; {D}.player.y = 2.0*40")
    check("sim: straight line to the player", E(f"{D}.simShot({D}.tanks[1], Math.atan2({D}.player.y-{D}.tanks[1].y, {D}.player.x-{D}.tanks[1].x))") == "player")
    pick = E(f"{D}.chooseShot({D}.tanks[1])")
    check("brain picks a shot that hits the player", pick is not None and E(f"{D}.simShot({D}.tanks[1], {pick})") == "player", pick)
    # behind the middle wall: no straight line; whatever it picks must never be a self-hit (run it many times)
    E(f"{D}.player.x = 1.5*40; {D}.player.y = 4.0*40")
    bad = E(f"(() => {{ let bad = 0; for (let i = 0; i < 200; i++) {{ const a = {D}.chooseShot({D}.tanks[1]); if (a != null && {D}.simShot({D}.tanks[1], a) === 'self') bad++; }} return bad; }})()")
    check("brain never picks a self-killing shot (200 tries)", bad == 0, bad)
    # line the turret up on whatever the brain picks (a bank shot can need a long swing), then let it fire
    E(f"(() => {{ const t = {D}.tanks[1], a = {D}.chooseShot(t); t.ai.pick = a; t.ai.want = a; t.turret = a; t.ai.fireT = 0; }})()")
    cdp.pump(0.6)
    check("brown tank fired", E(f"{D}.tanks[1].shells") == 1 and E(f"{D}.shells.length") == 1)
    E(f"{D}.tanks[1].ai.fireT = 0"); cdp.pump(0.3)
    check("brown never has more than one shell out", E(f"{D}.tanks[1].shells") == 1 and E(f"{D}.shells.length") == 1)
    check("brown tank never moved", E(f"{D}.tanks[1].x") == bx0)
    E(HOLD); E(f"{D}.shells.length = 0; {D}.tanks[1].shells = 0")
    check("player still alive", E(f"{D}.player.alive") is True and E("Game.state") == "playing")

    # ---- drive with the keyboard and fire with the mouse
    x0 = E(f"{D}.player.x")
    E(f"{D}.key('KeyD', true)"); cdp.pump(0.6); E(f"{D}.key('KeyD', false)")
    check("tank drove right", E(f"{D}.player.x") > x0 + 40, f"{x0} -> {E(f'{D}.player.x')}")
    check("tracks left behind", E("Game.debug.player.trackDist") > 40)
    px, py = E(f"[{D}.player.x, {D}.player.y]")
    # screen coords of a point to the upper-right of the tank
    sx, sy = E(f"(() => {{ const v = {{ }}; const c = document.getElementById('game'); const s = Math.min(innerWidth/{D}.consts.W, innerHeight/{D}.consts.H); return [(innerWidth - {D}.consts.W*s)/2 + ({px}+120)*s, (innerHeight - {D}.consts.H*s)/2 + ({py}-80)*s]; }})()")
    mouse("mouseMoved", sx, sy); mouse("mousePressed", sx, sy); mouse("mouseReleased", sx, sy); cdp.pump(0.05)
    check("a shell is flying", E(f"{D}.shells.length") == 1 and E(f"{D}.player.shells") == 1)
    for _ in range(6):
        mouse("mousePressed", sx, sy); mouse("mouseReleased", sx, sy); cdp.pump(0.15)
    check("shell cap of 5", E(f"{D}.player.shells") <= 5)
    cdp.pump(0.3); shot(cdp, "04-shells")
    bounced = E(f"{D}.shells.some(s => s.bounces > 0)")
    cdp.pump(6.5)
    check("shells bounced once then vanished", bounced and E(f"{D}.shells.length") == 0 and E(f"{D}.player.shells") == 0, f"left {E(f'{D}.shells.length')}")

    # ---- mine, then stand on it: death, smoke, blue X
    mouse("mousePressed", sx, sy, "right"); mouse("mouseReleased", sx, sy, "right"); cdp.pump(0.1)
    check("mine laid", E(f"{D}.mines.length") == 1)
    cdp.pump(1.6)
    check("your own mine does not trip on you", E(f"{D}.mines.length") == 1 and E(f"{D}.player.alive") is True)
    E(f"{D}.mines[0].t = 9.9"); cdp.pump(0.4)   # the fuse runs out while we stand on it -> boom
    check("mine went off and the tank died", E(f"{D}.mines.length") == 0 and E(f"{D}.player.alive") is False and E("Game.state") == "dead")
    check("death counted on the save and a life lost", E("Game.save.deaths") == 1 and E("Game.save.lives") == 2)
    cdp.pump(0.4); shot(cdp, "05-smoke")
    cdp.pump(1.6)
    check("blue X on the floor", E(f"{D}.xmarks.length") == 1 and E(f"{D}.xmarks[0].alpha") > 0.9 and E(f"{D}.xmarks[0].color") == "#3d8bff")
    shot(cdp, "06-xmark")
    E("window.dispatchEvent(new KeyboardEvent('keydown', {code: 'KeyR'}))"); cdp.pump(0.1)
    check("retry reloads the mission", E("Game.state") == "intro" and E(f"{D}.player.alive") is True and E(f"{D}.xmarks.length") == 0)
    E(f"{D}.skipIntro()"); E(HOLD)

    # ---- pause -> save to slot 1 -> back to the paused game
    E("window.dispatchEvent(new KeyboardEvent('keydown', {code: 'Escape'}))"); cdp.pump(0.2)
    check("paused with the pause menu", E("Game.state") == "paused" and active("pause"))
    shot(cdp, "07-pause")
    click("#pauseSave")
    check("save picker shows", active("slots") and E("document.getElementById('slotsTitle').textContent") == "SAVE TO WHICH FILE?" and not active("pause"))
    click("#slotList .slot[data-slot='0']")
    check("saved into slot 1", E("Store.slot(0) && Store.slot(0).deaths") == 1 and E("Store.slot(1)") is None)
    check("back in the paused game", active("pause") and not active("slots") and E("Game.state") == "paused")
    check("pause note says where it saved", "File 1" in E("document.getElementById('pauseNote').textContent"))
    # overwrite asks first
    E("Game.save.deaths = 7")
    click("#pauseSave"); click("#slotList .slot[data-slot='0']")
    check("overwrite asks for confirmation", active("confirm"))
    click("#confirmNo"); check("NO keeps the old save", E("Store.slot(0).deaths") == 1 and active("slots"))
    click("#slotList .slot[data-slot='0']"); click("#confirmYes")
    check("YES overwrites", E("Store.slot(0).deaths") == 7 and active("pause"))
    click("#pauseContinue"); check("continue resumes", E("Game.state") == "playing" and not active("pause"))

    # ---- kill the brown tank: white X, MISSION CLEAR, then (only one level so far) ALL CLEAR -> title
    E(f"{D}.kill({D}.tanks[1])"); cdp.pump(0.1)
    check("kill counted and mission clear", E("Game.save.kills") == 1 and E("Game.state") == "clear")
    cdp.pump(1.6); check("enemy X is white", E(f"{D}.xmarks[0].color") == "#f4f4f4" and E(f"{D}.xmarks[0].alpha") > 0)
    shot(cdp, "06b-clear")
    cdp.pump(1.0)
    check("mission 2 intro follows", E("Game.state") == "intro" and E("Game.save.level") == 2)
    check("mission 2 is 19x14 with a dark brown tank", E(f"[{D}.consts.COLS, {D}.consts.ROWS, {D}.tanks[1].type]") == [19, 14, "darkbrown"])
    check("the 1x10 wall leaves a gap at each end", E(f"[{D}.map[1*19+9], {D}.map[2*19+9], {D}.map[11*19+9], {D}.map[12*19+9]]") == [0, 1, 1, 0])
    E(f"{D}.skipIntro()"); E(HOLD)
    dx0 = E(f"{D}.tanks[1].x"); dy0 = E(f"{D}.tanks[1].y")
    check("dark brown has no line of sight at the start (wall between)", E(f"{D}.los({D}.tanks[1].x, {D}.tanks[1].y, {D}.player.x, {D}.player.y)") is False)
    cdp.pump(8.0)
    dy = E(f"Math.abs({D}.tanks[1].y - {dy0})"); dxp = E(f"{D}.tanks[1].x")
    check("dark brown heads for a gap round the wall instead of pushing into it", dy > 100 or dxp < 9 * 40, f"dy {dy:.0f} x {dxp:.0f}")
    check("dark brown is hunting, not roaming", E(f"{D}.tanks[1].ai.mode") == "hunt", E(f"{D}.tanks[1].ai.mode"))
    check("its path never pushed it into the wall column", E(f"{D}.tanks[1].ai.path.every(([c, r]) => {D}.map[r * 19 + c] === 0)"))
    shot(cdp, "06c-mission2")
    E(f"{D}.kill({D}.tanks[1])"); cdp.pump(2.6)
    check("mission 3 intro follows", E("Game.state") == "intro" and E("Game.save.level") == 3)
    check("mission 3 is full size with two dark browns", E(f"[{D}.consts.COLS, {D}.consts.ROWS, {D}.tanks.length, {D}.tanks[1].type, {D}.tanks[2].type]") == [24, 16, 3, "darkbrown", "darkbrown"])
    check("18x1 walls with 4 wood in the middle", E(f"[{D}.map[5*24+3], {D}.map[5*24+9], {D}.map[5*24+10], {D}.map[5*24+13], {D}.map[5*24+14], {D}.map[5*24+20], {D}.map[5*24+21], {D}.map[10*24+11]]") == [1, 1, 2, 2, 1, 1, 0, 2])
    check("mission 3 has its four 2x2 cover boxes", E(f"[{D}.map[2*24+7], {D}.map[3*24+8], {D}.map[2*24+16], {D}.map[13*24+7], {D}.map[12*24+16], {D}.map[2*24+9]]") == [1, 1, 1, 1, 1, 0])
    E(f"{D}.skipIntro()"); E(HOLD); E(f"{D}.tanks[2].ai.fireT = 999")
    cdp.pump(0.6); shot(cdp, "06d-mission3")
    E(f"{D}.kill({D}.tanks[1])"); E(f"{D}.kill({D}.tanks[2])"); cdp.pump(2.6)
    check("mission 4 intro follows", E("Game.state") == "intro" and E("Game.save.level") == 4)
    check("mission 4 = brown + 2 dark browns", E(f"{D}.tanks.slice(1).map(t => t.type).sort().join()") == "brown,darkbrown,darkbrown")
    check("the S wall: top 10x1, middle 1x10, bottom 9x1, with 3x1 wood in each arm",
          E(f"[{D}.map[3*24+11], {D}.map[3*24+20], {D}.map[3*24+21], {D}.map[7*24+11], {D}.map[12*24+11], {D}.map[12*24+3], {D}.map[12*24+2], {D}.map[3*24+16], {D}.map[12*24+6]]") == [1, 1, 0, 1, 1, 1, 0, 2, 2])
    E(f"{D}.skipIntro()"); E(f"{D}.tanks.slice(1).forEach(t => t.ai.fireT = 999)")
    cdp.pump(0.6); shot(cdp, "06e-mission4")
    E(f"{D}.tanks.slice(1).forEach(t => {D}.kill(t))"); cdp.pump(3.0)
    # ---- mission 5: white walls (shells cross, tanks don't)
    check("mission 5 intro follows", E("Game.state") == "intro" and E("Game.save.level") == 5)
    check("mission 5 = 2 brown + 2 dark brown, only white walls", E(f"{D}.tanks.slice(1).map(t => t.type).sort().join()") == "brown,brown,darkbrown,darkbrown"
          and E(f"(() => {{ const m = {D}.map, C = {D}.consts.COLS, R = {D}.consts.ROWS; for (let r = 1; r < R - 1; r++) for (let c = 1; c < C - 1; c++) if (m[r*C+c] === 1 || m[r*C+c] === 2) return false; return true; }})()"))
    E(f"{D}.skipIntro()"); E(f"{D}.tanks.slice(1).forEach(t => t.ai.fireT = 999)")
    # a white wall at col 7 rows 1-4: a shell flies over it, the tank cannot drive through it
    E(f"{D}.player.x = 6.5*40; {D}.player.y = 2.5*40")
    check("line of sight passes over white walls", E(f"{D}.los({D}.player.x, {D}.player.y, 9.5*40, 2.5*40)") is True)
    E(f"{D}.player.turret = 0; {D}.fire()"); cdp.pump(0.35)   # aim + fire in one go (the mouse re-aims the turret every frame)
    check("shell crossed the white wall", E(f"{D}.shells.length") == 1 and E(f"{D}.shells[0].x") > 8 * 40, E(f"JSON.stringify([{D}.shells.map(s => [s.x, s.y, s.h, s.bounces]), {D}.tanks.map(t => [t.type, t.x, t.y, t.h, t.alive, t.shells]), Game.state, {D}.xmarks.length])"))
    E(f"{D}.shells.length = 0; {D}.player.shells = 0")
    E(f"{D}.key('KeyD', true)"); cdp.pump(0.8); E(f"{D}.key('KeyD', false)")
    check("tank stopped at the white wall", E(f"{D}.player.x") < 7 * 40 - 10, E(f"{D}.player.x"))
    check("pathfinding treats white as a wall", E(f"{D}.bfs(6, 2).dist[2*20+8]") > 2)
    cdp.pump(0.3); shot(cdp, "06f-mission5")
    E(f"{D}.tanks.slice(1).forEach(t => {D}.kill(t))"); cdp.pump(3.0)
    # ---- mission 6: cyan rockets
    check("mission 6 intro follows", E("Game.state") == "intro" and E("Game.save.level") == 6)
    check("mission 6 has two cyan tanks and nothing else", E(f"{D}.tanks.slice(1).map(t => t.type).join()") == "cyan,cyan")
    E(f"{D}.skipIntro()"); E(f"{D}.tanks.slice(1).forEach(t => t.ai.fireT = 999)")
    cy = E(f"{D}.tanks.findIndex(t => t.type === 'cyan')")
    E(f"{D}.player.x = 10*40; {D}.player.y = 12.5*40 - 40")   # stand in the open lane so the cyan has a straight line
    E(f"const t = {D}.tanks[{cy}]; t.turret = Math.atan2({D}.player.y - t.y, {D}.player.x - t.x); t.ai.fireT = 0")
    cdp.pump(0.5)
    rk = E(f"{D}.shells.find(s => s.rocket)")
    check("cyan fired a rocket at double speed with no bounce", rk is not None and abs(abs(rk["vx"]) + abs(rk["vy"])) > 300 and rk["maxB"] == 0, rk)
    cdp.pump(0.15); shot(cdp, "06g-mission6")
    E(f"{D}.player.alive = true; Game.save.lives = 3")
    E(f"{D}.shells.length = 0; {D}.tanks.forEach(t => t.shells = 0)")
    E(f"{D}.tanks.slice(1).forEach(t => {D}.kill(t))"); cdp.pump(3.0)
    # ---- mission 7
    check("mission 7 intro follows", E("Game.state") == "intro" and E("Game.save.level") == 7)
    check("mission 7 = 2 brown, 2 dark brown, 1 cyan", E(f"{D}.tanks.slice(1).map(t => t.type).sort().join()") == "brown,brown,cyan,darkbrown,darkbrown")
    E(f"{D}.skipIntro()"); E(f"{D}.tanks.slice(1).forEach(t => t.ai.fireT = 999)")
    cdp.pump(0.4); shot(cdp, "06h-mission7")
    E(f"{D}.tanks.slice(1).forEach(t => {D}.kill(t))"); cdp.pump(3.0)
    # ---- mission 8: the drawn maze
    check("mission 8 intro follows", E("Game.state") == "intro" and E("Game.save.level") == 8)
    check("maze is 24x16 with 6 dark browns", E(f"[{D}.consts.COLS, {D}.consts.ROWS, {D}.tanks.slice(1).filter(t => t.type === 'darkbrown').length, {D}.tanks.length]") == [24, 16, 6, 7])
    check("player spawned at the drawn P (square 1,1)", E(f"[{D}.player.x, {D}.player.y]") == [60, 60])
    check("wood squares came through the drawing", E(f"[{D}.map[5*24+22], {D}.map[6*24+16], {D}.map[10*24+6], {D}.map[12*24+2], {D}.map[14*24+15]]") == [2, 2, 2, 2, 2])
    # each tank plans from its own square (other tanks' squares count as blocked), so ask from the tank's side: can it reach a square next to the player?
    reach = E(f"{D}.tanks.slice(1).map(t => {{ const nav = {D}.bfs(Math.floor(t.x/40), Math.floor(t.y/40)); return Math.max(...[[1,0],[-1,0],[0,1],[0,-1]].map(([dc, dr]) => nav.dist[(1+dr)*24 + 1+dc])); }})")
    check("every maze tank can drive to the player", all(d > 0 for d in reach), reach)
    E(f"{D}.skipIntro()"); E(f"{D}.tanks.slice(1).forEach(t => t.ai.fireT = 999)")
    cdp.pump(0.4); shot(cdp, "06i-mission8")
    E(f"{D}.tanks.slice(1).forEach(t => {D}.kill(t))"); cdp.pump(3.0)
    # ---- mission 9: the staircase
    check("mission 9 intro follows", E("Game.state") == "intro" and E("Game.save.level") == 9)
    check("mission 9 = 3 brown, 3 cyan, 1 dark brown on a 24x16 map", E(f"[{D}.consts.COLS, {D}.consts.ROWS, {D}.tanks.slice(1).map(t => t.type).sort().join()]") == [24, 16, "brown,brown,brown,cyan,cyan,cyan,darkbrown"])
    E(f"{D}.skipIntro()"); E(f"{D}.tanks.slice(1).forEach(t => t.ai.fireT = 999)")
    cdp.pump(0.4); shot(cdp, "06j-mission9")
    E(f"{D}.tanks.slice(1).forEach(t => {D}.kill(t))"); cdp.pump(3.0)
    # ---- mission 10: grass, two yellow mine layers + a brown
    check("mission 10 intro follows", E("Game.state") == "intro" and E("Game.save.level") == 10)
    check("mission 10 = brown + 2 yellow on grass", E(f"[{D}.level.floor, {D}.tanks.slice(1).map(t => t.type).sort().join()]") == ["grass", "brown,yellow,yellow"])
    E(f"{D}.skipIntro()"); E(f"{D}.tanks.slice(1).forEach(t => t.ai.fireT = 999)")
    E(f"{D}.tanks.slice(1).forEach(t => {{ if (t.ai.mineT) t.ai.mineT = 0.05; }})")
    cdp.pump(0.35)
    laid = E(f"{D}.mines.filter(m => m.owner.type === 'yellow').length")
    check("yellow tanks lay mines", laid >= 1, laid)
    check("a yellow that just laid a mine is running clear", E(f"{D}.tanks.slice(1).some(t => t.type === 'yellow' && t.ai.mode === 'flee')"))
    cdp.pump(0.85); shot(cdp, "06k-mission10")
    cdp.pump(12.5)
    check("the mines have gone off", E(f"{D}.mines.filter(m => m.t > 9.5).length") == 0)
    check("no yellow died to its own mine", E(f"{D}.tanks.slice(1).filter(t => t.type === 'yellow' && t.alive).length") == 2 and E(f"{D}.player.alive") is True)
    dist = E(f"{D}.tanks.slice(1).filter(t => t.type === 'yellow').map(t => Math.min(...{D}.mines.map(m => Math.hypot(m.x - t.x, m.y - t.y)), 9999))")
    check("yellows stay outside the blast ring of every live mine", all(d > 40 * 1.7 for d in dist), dist)
    E(f"{D}.tanks.slice(1).forEach(t => {D}.kill(t))"); cdp.pump(3.0)
    # ---- mission 11: silver platforms + ramps
    check("mission 11 intro follows", E("Game.state") == "intro" and E("Game.save.level") == 11)
    check("mission 11 = 2 cyan + 2 yellow on grass", E(f"[{D}.level.floor, {D}.tanks.slice(1).map(t => t.type).sort().join()]") == ["grass", "cyan,cyan,yellow,yellow"])
    check("the cyans start up on the platform", E(f"[{D}.tanks[1].h, {D}.tanks[2].h, {D}.tanks[3].h]") == [1, 1, 0])
    E(f"{D}.skipIntro()"); E(f"{D}.tanks.slice(1).forEach(t => {{ t.ai.fireT = 999; if (t.ai.mineT) t.ai.mineT = 999; }})")
    T = 40
    check("no line of sight from the ground into a platform's side", E(f"{D}.los({12.5*T}, {2.5*T}, {14.5*T}, {2.5*T})") is False)
    check("line of sight down off a platform", E(f"{D}.los({14.5*T}, {2.5*T}, {12.5*T}, {2.5*T})") is True)
    check("line of sight up a ramp", E(f"{D}.los({18.5*T}, {3.5*T}, {14.5*T}, {3.5*T})") is True)
    E(f"{D}.player.x = {13.2*T}; {D}.player.y = {2.5*T}")
    E(f"{D}.key('KeyD', true)"); cdp.pump(0.5); E(f"{D}.key('KeyD', false)")
    check("cannot drive straight onto a platform from the side", E(f"{D}.player.x") < 14 * T - 15 and E(f"{D}.player.h") == 0, E(f"{D}.player.x"))
    E(f"{D}.player.x = {18.5*T}; {D}.player.y = {3.5*T}")
    E(f"{D}.key('KeyA', true)"); cdp.pump(1.5); E(f"{D}.key('KeyA', false)")
    check("drives up the ramp onto the platform", E(f"{D}.player.h") == 1 and E(f"{D}.player.x") < 16 * T, E(f"[{D}.player.x, {D}.player.h]"))
    E(f"{D}.key('KeyA', true)"); cdp.pump(0.5); E(f"{D}.key('KeyA', false)")
    check("cannot drive off the platform's edge", E(f"{D}.player.h") == 1 and E(f"{D}.player.x") > 14 * T + 14, E(f"{D}.player.x"))
    # the ramp-corner wedge (user bug): from the low side of a ramp, drive onto the slab, then make sure you can still move
    E(f"{D}.player.x = {8.3*T}; {D}.player.y = {8.7*T}")
    E(f"{D}.key('KeyD', true)"); cdp.pump(0.6); E(f"{D}.key('KeyD', false)")
    px0 = E(f"[{D}.player.x, {D}.player.y, {D}.player.h]")
    E(f"{D}.key('KeyW', true)"); cdp.pump(0.4); E(f"{D}.key('KeyW', false)")
    px1 = E(f"[{D}.player.x, {D}.player.y, {D}.player.h]")
    check("no wedge on the ramp's corner: up the ramp and still free to move", px0[2] == 1 and px0[1] - px1[1] > 8, f"{px0} -> {px1}")
    E(f"{D}.player.x = {14.5*T}; {D}.player.y = {2.5*T}; {D}.aim(Math.PI); {D}.fire()"); cdp.pump(0.2)
    check("a shell fired from the platform drops to the ground", E(f"{D}.shells.length") == 1 and E(f"{D}.shells[0].h") == 0 and E(f"{D}.shells[0].x") < 14 * T, E(f"JSON.stringify({D}.shells)"))
    E(f"{D}.shells.length = 0; {D}.player.shells = 0")
    E(f"{D}.player.x = {12.5*T}; {D}.player.y = {2.5*T}; {D}.aim(0); {D}.fire()"); cdp.pump(0.25)
    check("a ground shell bounces off a platform's side", E(f"{D}.shells.every(s => s.x < 14 * {T}) && ({D}.shells.length === 0 || {D}.shells[0].bounces >= 1)"), E(f"JSON.stringify({D}.shells)"))
    E(f"{D}.shells.length = 0; {D}.player.shells = 0; {D}.mines.length = 0")
    # park the cyan at the platform's left edge (it roams), lay a mine on the grass just below the cliff, get clear, let the fuse run out
    E(f"{D}.tanks[1].x = {9.5*T}; {D}.tanks[1].y = {6.5*T}; {D}.tanks[1].ai.path = []; {D}.tanks[1].ai.restT = 2; "
      f"{D}.player.x = {7.6*T}; {D}.player.y = {6.5*T}; {D}.mine(); {D}.mines[0].t = 9.9; {D}.player.x = {2.5*T}; {D}.player.y = {2.5*T}"); cdp.pump(0.3)
    check("a ground mine blasts the tank up on the platform", E(f"{D}.tanks[1].alive") is False and E(f"{D}.player.alive") is True)
    check("routes climb platforms only by their ramps", E(f"[{D}.bfs(17, 3).dist[2*22+14] >= 0, {D}.bfs(12, 2).dist[2*22+14] > 2]") == [True, True])
    cdp.pump(0.6); shot(cdp, "06l-mission11")
    E(f"{D}.tanks.slice(1).forEach(t => {D}.kill(t))"); cdp.pump(3.0)
    # ---- mission 12: the crate yard
    check("mission 12 intro follows", E("Game.state") == "intro" and E("Game.save.level") == 12)
    check("mission 12 = 2 dark brown + 3 yellow with 44 crates", E(f"[{D}.tanks.slice(1).map(t => t.type).sort().join(), Array.from({D}.map).filter(v => v === 2).length]") == ["darkbrown,darkbrown,yellow,yellow,yellow", 44])
    E(f"{D}.skipIntro()"); E(f"{D}.tanks.slice(1).forEach(t => {{ t.ai.fireT = 999; if (t.ai.mineT) t.ai.mineT = 999; }})")
    cdp.pump(0.4); shot(cdp, "06m-mission12")
    E(f"{D}.tanks.slice(1).forEach(t => {D}.kill(t))"); cdp.pump(3.0)
    # ---- mission 13: the works
    check("mission 13 intro follows", E("Game.state") == "intro" and E("Game.save.level") == 13)
    check("mission 13 = brown, 2 cyan, 2 dark brown, 2 yellow", E(f"{D}.tanks.slice(1).map(t => t.type).sort().join()") == "brown,cyan,cyan,darkbrown,darkbrown,yellow,yellow")
    check("the light brown sits up on the silver deck", E(f"{D}.tanks.find(t => t.type === 'brown').h") == 1)
    E(f"{D}.skipIntro()"); E(f"{D}.tanks.slice(1).forEach(t => {{ t.ai.fireT = 999; if (t.ai.mineT) t.ai.mineT = 999; }})")
    cdp.pump(0.4); shot(cdp, "06n-mission13")
    E(f"{D}.tanks.slice(1).forEach(t => {D}.kill(t))"); cdp.pump(3.0)
    # ---- missions 14-20: the red tanks, all on grass
    ROSTERS = { 14: "red,red", 15: "brown,brown,darkbrown,darkbrown,red", 16: "cyan,cyan,red,red", 17: "darkbrown,red,red,yellow,yellow",
                18: "brown,cyan,darkbrown,red,yellow", 19: "brown,brown,brown,brown,brown,red", 20: "red,red,red,red" }
    # ---- missions 21-30: the snowy mountain and the lime green rocket tanks
    ROSTERS.update({ 21: "darkbrown,darkbrown,green", 22: "brown,brown,brown,green,green", 23: "yellow,yellow,yellow,yellow,yellow,yellow,yellow",
                     24: "green,green,red,red,red", 25: "brown,brown,brown,brown,brown,red,red", 26: "cyan,cyan,cyan,green",
                     27: "brown,brown,brown,brown,red,red,yellow,yellow", 28: "brown,cyan,darkbrown,green,red,yellow",
                     29: "darkbrown,darkbrown,green,green,green", 30: "brown,brown,brown,cyan,cyan,green,red,red" })
    # ---- missions 31-40: the desert and the purple tanks
    ROSTERS.update({ 31: "green,purple,purple", 32: "purple,yellow,yellow", 33: "brown,brown,brown,brown,brown,brown,brown", 34: "purple,purple,red,red",
                     35: "darkbrown,darkbrown,darkbrown,green,green,green", 36: "brown,brown,cyan,green,purple", 37: "brown,brown,purple,purple,red,red,red",
                     38: "brown,cyan,darkbrown,green,purple,red,yellow", 39: "darkbrown,darkbrown,darkbrown,darkbrown,darkbrown,darkbrown,darkbrown",
                     40: "cyan,cyan,green,purple,purple,purple" })
    # ---- missions 41-53: the beach, water and the white tanks
    ROSTERS.update({ 41: "brown,darkbrown,darkbrown,white,white", 42: "purple,white,yellow,yellow,yellow", 43: "white,white,white", 44: "green,red,red,white,white",
                     45: "cyan,cyan,cyan,cyan,cyan,cyan,cyan", 46: "brown,brown,purple,purple,red,yellow,yellow", 47: "cyan,cyan,white,white,yellow",
                     48: "darkbrown,green,white,white", 49: "white,white,white,yellow,yellow,yellow", 50: "brown,cyan,darkbrown,green,purple,red,white,yellow",
                     51: "green,green,green,purple,purple,white", 52: "darkbrown,darkbrown,darkbrown,red,red,white", 53: "purple,white,white,white,white" })
    # ---- missions 54-64: the volcano, lava and the black tanks
    ROSTERS.update({ 54: "black,darkbrown", 55: "black,brown,brown,brown", 56: "black,red,red", 57: "black,cyan,cyan", 58: "black,black",
                     59: "red,red,red,red,red,red,red", 60: "black,cyan,cyan,green,green", 61: "brown,brown,brown,brown,red,red,red,red",
                     62: "black,black,black", 63: "black,black,purple,purple", 64: "brown,brown,brown,brown,yellow,yellow,yellow,yellow" })
    # ---- missions 65-80: the factory, barrels, auto turrets (silver) and oil bombers
    ROSTERS.update({ 65: "brown,brown,silver,silver", 66: "darkbrown,darkbrown,silver,silver", 67: "red,red,silver,silver", 68: "darkbrown,silver,yellow,yellow,yellow",
                     69: "cyan,cyan,purple,silver,silver,silver", 70: "brown,brown,brown,green,green,silver,silver", 71: "black,silver,silver,yellow,yellow",
                     72: "bomber,bomber,darkbrown,darkbrown,silver", 73: "bomber,bomber,darkbrown,darkbrown,yellow,yellow,yellow",
                     74: "bomber,bomber,cyan,cyan,cyan,purple,silver,silver", 75: "bomber,darkbrown,darkbrown,green,green,red,red",
                     76: "black,black,bomber,bomber,darkbrown,silver", 77: "black,bomber,bomber,bomber,brown,brown,darkbrown,darkbrown,darkbrown",
                     78: "bomber,cyan,cyan,silver,silver,yellow,yellow,yellow", 79: "green,green,purple,silver,silver,silver",
                     80: "purple,purple,purple,purple,purple,purple,purple" })
    # ---- missions 81-90: the battlefield, grey landmines and orange flame throwers; 88 and 90 are bigger fields
    ROSTERS.update({ 81: "orange,orange", 82: "darkbrown,darkbrown,darkbrown,orange,yellow,yellow", 83: "cyan,cyan,orange,orange,red",
                     84: "orange,orange,silver,silver,yellow,yellow,yellow,yellow", 85: "orange,orange,orange,orange", 86: "cyan,green,green,orange,purple,purple",
                     87: "black,black,brown,orange,orange,orange", 88: "brown,brown,brown,darkbrown,darkbrown,darkbrown,darkbrown,orange,orange,yellow,yellow",
                     89: "green,green,green,green,green,green,green", 90: "black,black,brown,brown,darkbrown,darkbrown,darkbrown,orange,orange,orange,silver,silver" })
    # ---- missions 91-100: the graveyard at night, tombstones, dark pine green (DPG) tanks; 94, 97, 98 and 100 are extra large
    ROSTERS.update({ 91: "pine,pine", 92: "darkbrown,darkbrown,green,green,pine", 93: "black,cyan,cyan,pine,silver,silver", 94: "cyan,cyan,darkbrown,darkbrown,darkbrown,darkbrown,green,green,pine,pine", 95: "black,black,pine,purple,purple,purple", 96: "pine,pine,pine,pine", 97: "brown,brown,brown,brown,brown,orange,orange,pine,pine", 98: "cyan,cyan,green,green,pine,purple,purple,yellow,yellow,yellow,yellow,yellow", 99: "black,black,black,black,black,black,black", 100: "brown,brown,cyan,cyan,cyan,darkbrown,darkbrown,green,orange,orange,pine,pine,pine" })
    for n, roster in ROSTERS.items():
        floor = "grass" if n <= 20 else "snow" if n <= 30 else "sand" if n <= 40 else "beach" if n <= 53 else "volcano" if n <= 64 else "factory" if n <= 80 else "battle" if n <= 90 else "grave"
        check(f"mission {n} intro follows", E("Game.state") == "intro" and E("Game.save.level") == n, E("Game.save.level"))
        check(f"mission {n} = {roster} on {floor}", E(f"[{D}.level.floor, {D}.tanks.slice(1).map(t => t.type).sort().join()]") == [floor, roster])
        E(f"{D}.skipIntro()"); E(f"{D}.tanks.slice(1).forEach(t => {{ t.ai.fireT = 999; if (t.ai.mineT) t.ai.mineT = 999; }})")
        if n == 21:
            check("a lime green never moves and has two double-bounce rockets", E(f"(() => {{ const t = {D}.tanks.find(t => t.type === 'green'); return [t.maxShells, t.bounces, t.shellSpeed, t.ai.T.move, !!t.ai.T.rocket]; }})()") == [2, 2, 2, 0, True])
        if n == 22:
            # the lower green fires straight up across the lake: a rocket that bounces instead of bursting on the first wall
            E(f"(() => {{ const t = {D}.tanks.find(t => t.type === 'green' && t.y > 10 * {T}); t.turret = -Math.PI / 2; {D}.fire(t); }})()"); cdp.pump(1.6)
            check("a green rocket bounces off the far wall and keeps going", E(f"{D}.shells.length") == 1 and E(f"{D}.shells[0].bounces") == 1 and E(f"{D}.shells[0].rocket") is True, E(f"JSON.stringify({D}.shells)"))
            E(f"{D}.shells.length = 0; {D}.tanks.forEach(t => t.shells = 0)")
        if n == 28:
            check("the lime green sits on the summit", E(f"{D}.tanks.find(t => t.type === 'green').h") == 1)
        if n == 31:
            check("a purple has five shells, a mine timer and nearly the player's speed", E(f"(() => {{ const t = {D}.tanks.find(t => t.type === 'purple'); return [t.maxShells, t.ai.mineT > 0, t.ai.T.move]; }})()") == [5, True, 0.95])
            check("desert crates (cacti) are on the map", E(f"Array.from({D}.map).filter(v => v === 2).length") == 7)
        if n == 32:
            check("the purple starts up on its mesa", E(f"{D}.tanks.find(t => t.type === 'purple').h") == 1)
            # let it off the leash: it must find its way down the ramp onto the sand within a few seconds
            E(f"(() => {{ const t = {D}.tanks.find(t => t.type === 'purple'); t.ai.mineT = 999; }})()"); cdp.pump(5)
            check("the purple drives down off the mesa to hunt", E(f"{D}.tanks.find(t => t.type === 'purple').h") == 0 and E(f"{D}.player.alive") is True, E(f"JSON.stringify([{D}.tanks.find(t => t.type === 'purple').x / 40, {D}.tanks.find(t => t.type === 'purple').y / 40])"))
        if n == 40:
            check("the fort's cyans stand on the rampart and the green in the courtyard", E(f"[{D}.tanks.filter(t => t.type === 'cyan' && t.h === 1).length, {D}.tanks.find(t => t.type === 'green').h]") == [2, 0])
        if n == 41:
            check("a white is a slower purple flagged invisible", E(f"(() => {{ const t = {D}.tanks.find(t => t.type === 'white'); return [t.maxShells, t.ai.T.move, !!t.ai.T.invisible, !t.ai.T.mines]; }})()") == [5, 0.8, True, True])
            check("the sea strip is on the map", E(f"Array.from({D}.map).filter(v => v === 6).length") == 22)
            check("a white on the sand is hidden", E(f"{D}.visible({D}.tanks.find(t => t.type === 'white'))") is False)
            E(f"(() => {{ const t = {D}.tanks.find(t => t.type === 'white'); t.x = {5.5*T}; t.y = {14.5*T}; t.ai.path = []; t.ai.restT = 99; }})()")
            check("a white wading in the water is visible", E(f"{D}.visible({D}.tanks.find(t => t.type === 'white'))") is True)
            # driving: the same half second of throttle on sand and in the water
            E(f"{D}.player.x = {3.5*T}; {D}.player.y = {5.5*T}; {D}.player.hull = 0")
            E(f"{D}.key('KeyD', true)"); cdp.pump(0.5); E(f"{D}.key('KeyD', false)")
            dry = E(f"{D}.player.x") - 3.5 * T
            E(f"{D}.player.x = {3.5*T}; {D}.player.y = {14.5*T}; {D}.player.hull = 0")
            E(f"{D}.key('KeyD', true)"); cdp.pump(0.5); E(f"{D}.key('KeyD', false)")
            wet = E(f"{D}.player.x") - 3.5 * T
            check("water slows a tank by about 30%", dry > 40 and 0.62 < wet / dry < 0.78, f"dry {dry:.1f} wet {wet:.1f} ratio {wet / dry:.2f}")
            # a mine in the water: park a dark brown one square away in the sea, blow it, the tank lives and the driftwood crate above goes
            E(f"(() => {{ const t = {D}.tanks.find(t => t.type === 'darkbrown'); t.x = {16.5*T}; t.y = {14.5*T}; t.ai.path = []; t.ai.restT = 99; "
              f"{D}.player.x = {17.5*T}; {D}.player.y = {14.5*T}; {D}.mine(); {D}.mines[0].t = 9.9; {D}.player.x = {2.5*T}; {D}.player.y = {1.5*T}; }})()"); cdp.pump(0.4)
            check("a mine going off in the water hurts no tank but still breaks the crate", E(f"[{D}.tanks.find(t => t.type === 'darkbrown').alive, {D}.map[13 * 24 + 17], {D}.mines.length]") == [True, 0, 0])
        if n == 53:
            check("three of the four whites start out in the sea, visible", E(f"{D}.tanks.filter(t => t.type === 'white' && {D}.visible(t)).length") == 3)
        if n == 54:
            check("a black is a fast lava-proof rocket tank with no mines", E(f"(() => {{ const t = {D}.tanks.find(t => t.type === 'black'); return [t.maxShells, t.bounces, t.shellSpeed, t.ai.T.move, !!t.ai.T.rocket, !!t.ai.T.lavaProof, !t.ai.T.mines]; }})()") == [2, 0, 2, 1, True, True, True])
            check("the lava river is on the map", E(f"Array.from({D}.map).filter(v => v === 7).length") == 15)
            check("routes avoid lava unless the tank is lava-proof or dodging onto its edge", E(f"[{D}.bfs(2, 2).dist[2 * 22 + 11], {D}.bfs(2, 2, null, 'proof').dist[2 * 22 + 11] > 0, {D}.bfs(10, 2, null, 'edge').dist[2 * 22 + 11], {D}.bfs(10, 2, null, 'edge').dist[2 * 22 + 12] > 2]") == [-1, True, 1, True])
            # lava: a dark brown grazing the edge of the river lives, one over the middle burns, a black over the middle does not care
            E(f"(() => {{ const t = {D}.tanks.find(t => t.type === 'darkbrown'); t.ai.path = []; t.ai.restT = 99; t.x = {11.5*T} + 15; t.y = {1.5*T}; }})()"); cdp.pump(0.15)
            check("grazing the edge of a lava square is survivable", E(f"{D}.tanks.find(t => t.type === 'darkbrown').alive") is True)
            E(f"(() => {{ const t = {D}.tanks.find(t => t.type === 'darkbrown'); t.x = {11.5*T}; t.y = {1.5*T}; }})()"); cdp.pump(0.15)
            check("the middle of a lava square burns a tank", E(f"{D}.tanks.find(t => t.type === 'darkbrown').alive") is False)
            E(f"(() => {{ const t = {D}.tanks.find(t => t.type === 'black'); t.ai.path = []; t.ai.restT = 99; t.x = {11.5*T}; t.y = {2.5*T}; }})()"); cdp.pump(0.15)
            check("a black tank drives through lava", E(f"{D}.tanks.find(t => t.type === 'black').alive") is True)
            E(f"{D}.player.x = {2.5*T}; {D}.player.y = {1.5*T}")
        if n == 65:
            check("a silver is a red tank that cannot move", E(f"(() => {{ const t = {D}.tanks.find(t => t.type === 'silver'); return [t.maxShells, t.bounces, t.ai.T.move, t.ai.T.fire]; }})()") == [3, 1, 0, [0.5, 1.0]])
            check("every barrel has a colour and nothing else does", E(f"(() => {{ const b = Array.from({D}.barrels), m = Array.from({D}.map); return [b.filter(k => k > 0).length === m.filter(v => v === 2).length, b.every((k, i) => (k > 0) === (m[i] === 2) && k <= 3)]; }})()") == [True, True])
            # a green barrel at (11,4): pop it alone (small blast) -> acid on it and the three open squares to its left; the barrel column beside it stays
            E(f"{D}.barrels[4 * 24 + 11] = 2; {D}.explode({11.5*T}, {4.5*T}, 20, false)"); cdp.pump(0.1)
            check("a green barrel floods acid round itself", E(f"[Array.from({D}.map).filter(v => v === 8).length, {D}.map[4 * 24 + 10], {D}.map[4 * 24 + 12]]") == [4, 8, 2])
            E(f"{D}.barrels[10 * 24 + 11] = 3; {D}.explode({11.5*T}, {10.5*T}, 20, false)"); cdp.pump(0.1)
            check("a black barrel floods tar round itself", E(f"Array.from({D}.map).filter(v => v === 9).length") == 6)
            # tar halves a tank's speed: the same throttle on bare steel, then after a tar spill under the same start
            E(f"{D}.player.x = {3.0*T}; {D}.player.y = {13.5*T}; {D}.player.hull = 0")
            E(f"{D}.key('KeyD', true)"); cdp.pump(0.4); E(f"{D}.key('KeyD', false)")
            dry = E(f"{D}.player.x") - 3.0 * T
            E(f"{D}.spill(4, 13, 1, 9); {D}.player.x = {3.0*T}; {D}.player.y = {13.5*T}; {D}.player.hull = 0")
            E(f"{D}.key('KeyD', true)"); cdp.pump(0.4); E(f"{D}.key('KeyD', false)")
            tar = E(f"{D}.player.x") - 3.0 * T
            check("tar halves a tank's speed", dry > 30 and 0.4 < tar / dry < 0.6, f"dry {dry:.1f} tar {tar:.1f} ratio {tar / dry:.2f}")
            # acid burns like lava, and the black barrel's tar does not
            E(f"(() => {{ const t = {D}.tanks.find(t => t.type === 'brown'); t.x = {10.5*T}; t.y = {4.5*T}; }})()"); cdp.pump(0.15)
            check("the middle of an acid square burns a tank", E(f"{D}.tanks.find(t => t.type === 'brown').alive") is False)
            E(f"{D}.player.x = {2.5*T}; {D}.player.y = {1.5*T}")
        if n == 72:
            check("an oil bomber has no gun, no turret and the black tank's speed", E(f"(() => {{ const t = {D}.tanks.find(t => t.type === 'bomber'); return [t.maxShells, !!t.ai.T.noTurret, !!t.ai.T.oil, t.ai.T.move, !t.ai.T.mines]; }})()") == [0, True, True, 1, True])
            E(f"{D}.kill({D}.tanks.find(t => t.type === 'bomber'))"); cdp.pump(0.1)
            check("a dead bomber leaves a 5x5 oil slick", E(f"Array.from({D}.map).filter(v => v === 10).length") == 25)
            check("oil slows the player but not the enemies", E(f"(() => {{ const d = {D}.tanks.find(t => t.type === 'darkbrown'); d.x = {20.5*T}; d.y = {5.5*T}; d.ai.path = []; d.ai.restT = 99; {D}.player.x = {19.5*T}; {D}.player.y = {5.5*T}; return [{D}.slow(d), {D}.slow({D}.player)]; }})()") == [1, 0.6])
            E(f"{D}.player.x = {3.0*T}; {D}.player.y = {8.5*T}; {D}.player.hull = 0")
            E(f"{D}.key('KeyD', true)"); cdp.pump(0.4); E(f"{D}.key('KeyD', false)")
            dry = E(f"{D}.player.x") - 3.0 * T
            E(f"{D}.player.x = {18.0*T}; {D}.player.y = {4.5*T}; {D}.player.hull = 0")
            E(f"{D}.key('KeyD', true)"); cdp.pump(0.4); E(f"{D}.key('KeyD', false)")
            oily = E(f"{D}.player.x") - 18.0 * T
            check("the player drives 40% slower through oil", dry > 30 and 0.5 < oily / dry < 0.7, f"dry {dry:.1f} oil {oily:.1f} ratio {oily / dry:.2f}")
            # the other bomber reaches the player: it goes off like a mine and takes the player with it
            E(f"(() => {{ {D}.player.x = {3.5*T}; {D}.player.y = {8.5*T}; const b = {D}.tanks.find(t => t.type === 'bomber' && t.alive); b.x = {3.5*T} + 36; b.y = {8.5*T}; b.ai.path = []; }})()"); cdp.pump(0.15)
            check("the music stops when the player dies", E("Music.track") is None)
            check("a bomber that reaches the player blows up like a mine", E(f"[{D}.player.alive, {D}.tanks.filter(t => t.type === 'bomber' && t.alive).length, Game.state]") == [False, 0, "dead"])
            cdp.pump(1.7); E("Game.advance()"); cdp.pump(0.2)
            check("retry puts mission 72 back with a life gone", E("[Game.state, Game.save.level, Game.save.lives]") == ["intro", 72, 2])
            E(f"{D}.skipIntro()"); E(f"{D}.tanks.slice(1).forEach(t => {{ t.ai.fireT = 999; if (t.ai.mineT) t.ai.mineT = 999; }})")
        if n in (14, 21, 31, 41, 54, 65, 81, 91):
            check(f"mission {n} plays its map's music", E("Music.track") == floor, E("Music.track"))
        if n == 91:
            check("a DPG is a lime green that drives at half speed", E(f"(() => {{ const t = {D}.tanks.find(t => t.type === 'pine'); return [t.maxShells, t.bounces, t.shellSpeed, t.ai.T.move, !!t.ai.T.rocket, {D}.mines.length]; }})()") == [2, 2, 2, 0.5, True, 0])
        if n in (94, 97, 98, 100):
            check(f"mission {n} is extra large", E(f"[{D}.consts.COLS, {D}.consts.ROWS]") == [36, 24])
        if 81 <= n <= 90:
            ms = E(f"(() => {{ const m = {D}.mines, t = {D}.tanks; return [m.length, m.every(x => x.gray && x.boomAt === Infinity && !x.lit), Math.min(...m.map(x => Math.min(...t.map(k => Math.hypot(k.x - x.x, k.y - x.y))))) / {T}]; }})()")
            check(f"mission {n} has 1-6 grey landmines, none near a tank", 1 <= ms[0] <= 6 and ms[1] is True and ms[2] >= 3.9, str(ms))
        if n == 81:
            E(f"{D}.tanks.slice(1).forEach(t => {{ t.ai.path = []; t.ai.restT = 99; }})")
            check("an orange has a flame thrower, the yellow's speed and no mines", E(f"(() => {{ const t = {D}.tanks.find(t => t.type === 'orange'); return [!!t.ai.T.flame, t.ai.T.move, !t.ai.T.mines, t.ai.T.fire]; }})()") == [True, 0.8, True, [3, 3]])
            # grey mines have no timer
            E(f"{D}.mines.forEach(m => m.t += 60)"); n0 = E(f"{D}.mines.length"); cdp.pump(0.3)
            check("a grey mine never goes off on its own", E(f"{D}.mines.length") == n0)
            # the top orange fires straight down: five cells about two squares wide, and the one that meets the bunker dies alone
            w = E(f"(() => {{ const t = {D}.tanks.find(t => t.type === 'orange' && t.y < 5 * {T}); t.x = {16.5*T} + 8; t.turret = Math.PI / 2; t.fireCD = 0; {D}.fire(t); const f = {D}.shells.filter(s => s.flame).map(s => s.x); return [f.length, Math.max(...f) - Math.min(...f), t.shells]; }})()")
            check("a flame wave is five cells about two squares wide", w[0] == 5 and 60 <= w[1] <= 68 and w[2] == 0, str(w))
            cdp.pump(0.5)
            check("a wall stops only the part of the wave that hits it", E(f"{D}.shells.filter(s => s.flame).length") == 4, E(f"JSON.stringify({D}.shells.map(s => [s.x, s.y]))"))
            E(f"{D}.shells.length = 0")
            # a mine that is shot goes off
            E(f"{D}.mines.length = 0; {D}.mines.push({{ x: {10.5*T}, y: {6.5*T}, t: 5, owner: null, boomAt: Infinity, lit: false, gray: true }}); {D}.player.x = {5.5*T}; {D}.player.y = {6.5*T}; {D}.player.fireCD = 0; {D}.aim(0); {D}.fire()")
            cdp.pump(1.3)
            check("a grey mine explodes when it is shot", E(f"[{D}.mines.length, {D}.player.alive]") == [0, True])
            # ... and when any tank comes near
            E(f"{D}.mines.push({{ x: {10.5*T}, y: {6.5*T}, t: 5, owner: null, boomAt: Infinity, lit: false, gray: true }}); (() => {{ const t = {D}.tanks.find(t => t.type === 'orange' && t.y > 5 * {T}); t.x = {11.5*T}; t.y = {6.5*T}; }})()")
            cdp.pump(0.7)
            check("a grey mine explodes when an enemy comes near, and kills it", E(f"[{D}.mines.length, {D}.tanks.filter(t => t.type === 'orange' && t.alive).length, {D}.player.alive]") == [0, 1, True])
            E(f"{D}.player.x = {2.5*T}; {D}.player.y = {2.5*T}")
        if n == 85:
            E(f"{D}.mines.length = 0; {D}.tanks.slice(1).forEach(t => {{ t.ai.path = []; t.ai.restT = 99; }})")
            E(f"(() => {{ const o = {D}.tanks.filter(t => t.type === 'orange'); o[1].x = o[0].x - 3 * {T}; o[1].y = o[0].y; o[0].turret = Math.PI; o[0].fireCD = 0; {D}.fire(o[0]); }})()"); cdp.pump(1.0)
            check("fire kills any tank it washes over", E(f"{D}.tanks.filter(t => t.type === 'orange' && t.alive).length") == 3)
            # a shell fired into a wave takes one cell out of it
            E(f"{D}.shells.length = 0; (() => {{ const o = {D}.tanks.find(t => t.type === 'orange' && t.alive && t.y > 10 * {T}); o.x = {20.5*T}; o.y = {9.5*T}; {D}.player.x = o.x - 5 * {T}; {D}.player.y = o.y; o.turret = Math.PI; o.fireCD = 0; {D}.fire(o); {D}.player.fireCD = 0; {D}.aim(0); {D}.fire(); }})()")
            cdp.pump(0.6)
            check("a shell knocks one cell out of a flame wave", E(f"[{D}.shells.filter(s => !s.flame).length, {D}.shells.filter(s => s.flame).length, {D}.player.shells]") == [0, 4, 0], E(f"JSON.stringify({D}.shells.map(s => [s.x, s.y, !!s.flame]))"))
            E(f"{D}.shells.length = 0; {D}.player.x = {2.5*T}; {D}.player.y = {8.5*T}")
        if n == 88:
            check("mission 88 is the larger 30 x 20 field", E(f"[{D}.consts.COLS, {D}.consts.ROWS]") == [30, 20])
        if n == 90:
            check("mission 90 is the extra large 36 x 24 field", E(f"[{D}.consts.COLS, {D}.consts.ROWS]") == [36, 24])
        if n == 76:
            check("the reactor turret starts sealed in barrels", E(f"[[1,0],[-1,0],[0,1],[0,-1]].every(([dc, dr]) => {D}.map[(6 + dr) * 24 + 12 + dc] === 2)") is True)
        if n == 14:
            check("a red can have three shells out", E(f"(() => {{ const t = {D}.tanks[1], out = [t.maxShells]; for (let i = 0; i < 4; i++) {{ t.fireCD = 0; out.push({D}.fire(t)); }} return out; }})()") == [3, True, True, True, False])
            E(f"{D}.shells.length = 0; {D}.tanks[1].shells = 0; {D}.tanks[1].fireCD = 0")
            check("a red drives at 85-90% of the player's speed", 0.85 <= E(f"{D}.tanks[1].ai.T.move") <= 0.9)
        if n == 19:
            check("two light browns sit up on silver towers", E(f"{D}.tanks.filter(t => t.type === 'brown' && t.h === 1).length") == 2)
        if n == 20:
            # park the top-right red, stand far away across the river and let it open up: rapid fire = 2+ shells out inside 2.2 s
            E(f"(() => {{ {D}.player.x = {1.5*T}; {D}.player.y = {2.5*T}; const r = {D}.tanks.find(t => t.type === 'red' && t.y < 3 * {T}); r.ai.fireT = 0; r.ai.restT = 5; r.ai.path = []; }})()")
            cdp.pump(2.2)
            check("a red fires rapidly", E(f"{D}.tanks.find(t => t.type === 'red' && t.y < 3 * {T}).shells") >= 2 and E(f"{D}.player.alive") is True, E(f"JSON.stringify({D}.shells.map(s => [s.x, s.y]))"))
            E(f"{D}.shells.length = 0; {D}.tanks.forEach(t => t.shells = 0)")
        cdp.pump(0.4); shot(cdp, f"06{'nopqrstu'[n - 13]}-mission{n}" if n <= 20 else f"07{'abcdefghij'[n - 21]}-mission{n}" if n <= 30 else f"08{'abcdefghij'[n - 31]}-mission{n}" if n <= 40 else f"09{'abcdefghijklm'[n - 41]}-mission{n}" if n <= 53 else f"10{'abcdefghijk'[n - 54]}-mission{n}" if n <= 64 else f"11{'abcdefghijklmnop'[n - 65]}-mission{n}" if n <= 80 else f"12{'abcdefghij'[n - 81]}-mission{n}" if n <= 90 else f"13{'abcdefghij'[n - 91]}-mission{n}")
        E(f"{D}.tanks.slice(1).forEach(t => {D}.kill(t))"); cdp.pump(3.0)
    check("all missions cleared banner", E("Game.state") == "won" and E("Game.save.level") == 101)
    E("Game.advance()"); cdp.pump(0.2)
    check("back on the title after the win", active("title") and E("Game.state") == "idle")
    click("[data-go=slots-load]"); click("#slotList .slot[data-slot='2']"); E(f"{D}.skipIntro()"); E(HOLD)
    E("window.dispatchEvent(new KeyboardEvent('keydown', {code: 'Escape'}))"); cdp.pump(0.1)
    click("#pauseSave"); click("#slotList .slot[data-slot='0']"); click("#confirmYes")
    check("fresh game saved over file 1", E("Store.slot(0).level") == 1 and E("Store.slot(0).kills") == 0 and active("pause"))
    click("#pauseContinue")

    # ---- pause -> options -> back lands on the pause menu
    E("window.dispatchEvent(new KeyboardEvent('keydown', {code: 'Escape'}))"); cdp.pump(0.2)
    click("#pauseOptions"); check("options over the game", active("options") and not active("pause"))
    click("#optBack"); check("back returns to pause", active("pause") and E("Game.state") == "paused")

    # ---- quit -> confirm -> title
    click("#pauseQuit"); check("quit asks", active("confirm"))
    click("#confirmYes"); check("quit to title", active("title") and E("Game.state") == "idle")

    # ---- load the saved file, then delete it with the armed button
    click("[data-go=slots-load]")
    check("slot 1 shows the save", E("document.querySelector('#slotList .slot[data-slot=\"0\"]').classList.contains('empty')") is False)
    click("#slotList .slot[data-slot='0']")
    check("loaded file 1", E("Game.state") == "intro" and E("Game.save.level") == 1)
    E("window.dispatchEvent(new KeyboardEvent('keydown', {code: 'Escape'}))"); cdp.pump(0.1)
    click("#pauseQuit"); click("#confirmYes")
    click("[data-go=slots-load]")
    click("#deleteBtn")
    check("delete button armed and glowing", E("UI.deleting") is True and E("document.getElementById('deleteBtn').classList.contains('armed')"))
    shot(cdp, "08-delete-armed")
    click("#slotList .slot[data-slot='2']")
    check("empty slot in delete mode does nothing", not active("confirm") and E("Store.slot(0)") is not None)
    click("#slotList .slot[data-slot='0']")
    check("asks before deleting", active("confirm") and "delete this save" in E("document.getElementById('confirmText').textContent"))
    click("#confirmNo"); check("NO cancels the delete", E("Store.slot(0)") is not None and not active("confirm"))
    click("#slotList .slot[data-slot='0']"); click("#confirmYes")
    check("YES deletes the save", E("Store.slot(0)") is None and E("document.querySelectorAll('#slotList .slot.empty').length") == 3)
    check("delete mode still armed until tapped again", E("UI.deleting") is True)
    click("#deleteBtn"); check("tap again disarms", E("UI.deleting") is False)
    click("#slotsBack"); check("back to title", active("title"))
    click("[data-go=slots-load]"); check("delete mode is off after leaving the page", E("UI.deleting") is False and not E("document.getElementById('deleteBtn').classList.contains('armed')"))

    # ---- tank colour option
    click("#slotsBack"); click("[data-go=options]")
    check("7 colour swatches, blue on", E("document.querySelectorAll('#optColors .swatch').length") == 7 and E("document.querySelector('#optColors .swatch.on').title") == "Blue")
    E("document.querySelectorAll('#optColors .swatch')[5].click()"); cdp.pump(0.1)
    check("purple picked and saved", E("Store.opts.color") == "purple" and E("document.querySelector('#optColors .swatch.on').title") == "Purple")
    shot(cdp, "08b-options")
    click("#optBack"); click("[data-go=slots-load]")

    # ---- touch: a phone-shaped screen, thumb sticks and the MINE button
    cdp.send("Emulation.setDeviceMetricsOverride", {"width": 800, "height": 360, "deviceScaleFactor": 2, "mobile": True}); cdp.pump(0.3)
    click("#slotList .slot[data-slot='1']"); E(f"{D}.skipIntro()"); E(HOLD)
    check("player tank is purple now", E(f"{D}.player.col.body") == "#a24ff0")
    def touch(t, pts):
        cdp.send("Input.dispatchTouchEvent", {"type": t, "touchPoints": [{"x": x, "y": y, "id": i} for i, (x, y) in enumerate(pts)]})
    px0 = E(f"{D}.player.x")
    touch("touchStart", [(150, 250)]); touch("touchMove", [(210, 250)]); cdp.pump(0.6)
    check("left thumb drives the tank", E(f"{D}.player.x") > px0 + 30)
    touch("touchEnd", [])
    touch("touchStart", [(600, 200)]); touch("touchMove", [(650, 150)]); cdp.pump(0.1); touch("touchEnd", [])
    cdp.pump(0.05)
    check("right thumb aims and fires on release", E(f"{D}.shells.length") == 1)
    shot(cdp, "09-touch")
    # every mission: no tank may start inside a wall square
    bad = E("""(() => { const out = []; LEVELS.forEach((L, i) => { const g = L.grid; const cols = g ? g[0].length : L.cols; const rows = g ? g.length : L.rows;
      const m = new Uint8Array(cols * rows); for (let c = 0; c < cols; c++) { m[c] = 1; m[(rows-1)*cols+c] = 1; } for (let r = 0; r < rows; r++) { m[r*cols] = 1; m[r*cols+cols-1] = 1; }
      if (g) g.forEach((row, r) => [...row].forEach((ch, c) => { if ('#Ww'.includes(ch)) m[r*cols+c] = 1; }));
      if (g) g.forEach((row, r) => [...row].forEach((ch, c) => { if (ch !== '.' && !'#WwS/'.includes(ch) && ch === ch.toLowerCase() && ch !== ch.toUpperCase()) {
        const onP = [[1,0],[-1,0],[0,1],[0,-1]].some(([dc, dr]) => 'S/'.includes(g[r+dr][c+dc]) || (g[r+dr][c+dc] !== '.' && g[r+dr][c+dc] === g[r+dr][c+dc].toLowerCase() && g[r+dr][c+dc] !== 'w'));
        if (!onP) out.push(`mission ${i+1} platform tank at ${c},${r} has no platform beside it`); } }));
      else for (const [t, c, r, w, h] of L.walls) for (let y = r; y < r + (h||1); y++) for (let x = c; x < c + (w||1); x++) m[y*cols+x] = 1;
      const spots = g ? [] : [L.player, ...L.enemies.map(e => [e[1], e[2]])];
      for (const [x, y] of spots) for (const dx of [-0.39, 0.39]) for (const dy of [-0.39, 0.39]) if (m[Math.floor(y+dy)*cols + Math.floor(x+dx)]) out.push(`mission ${i+1} tank at ${x},${y}`);
    }); return out; })()""")
    check("no tank starts inside a wall on any mission", bad == [], str(bad))
    check("no JS errors", E("window.__errs.length") == 0, str(E("window.__errs")))
finally:
    harness.kill_chrome(proc)
    srv.terminate()

print()
print("ALL PASS" if not fails else f"{len(fails)} FAILED: " + ", ".join(fails))
sys.exit(1 if fails else 0)
