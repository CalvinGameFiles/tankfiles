"""Phone controls: the turret follows your finger, a tap fires, and the zoom camera follows your tank. Run: python -I debug/touchaim.py"""
import os, sys, time, base64, subprocess, socket, math
sys.path.insert(0, r"C:\Users\JesusFam\slayerfiles-debug")
import harness
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE)
s = socket.socket(); s.bind(("127.0.0.1", 0)); port = s.getsockname()[1]; s.close()
srv = subprocess.Popen(["node", "server.js"], cwd=ROOT, env={**os.environ, "PORT": str(port), "HOST": "127.0.0.1"}, stdout=subprocess.DEVNULL)
time.sleep(0.8)
proc, cdp = harness.launch_chrome("chrome-tankfiles")
fails = []
def check(name, ok, info=""):
    print(("ok   " if ok else "FAIL ") + name + (f"  ({info})" if not ok and info != "" else ""), flush=True); ok or fails.append(name)
E = cdp.eval
D = "Game.debug"
def shot(name):
    r = cdp.send("Page.captureScreenshot", {"format": "png"}); open(os.path.join(HERE, "shots", name + ".png"), "wb").write(base64.b64decode(r["result"]["data"]))
def touch(t, pts):
    cdp.send("Input.dispatchTouchEvent", {"type": t, "touchPoints": [{"x": x, "y": y, "id": i} for i, (x, y) in enumerate(pts)]})
def tap(x, y):
    touch("touchStart", [(x, y)]); cdp.pump(0.05); touch("touchEnd", []); cdp.pump(0.05)
def ang(a, b): return abs((a - b + math.pi) % (2 * math.pi) - math.pi)
try:
    cdp.send("Emulation.setDeviceMetricsOverride", {"width": 800, "height": 360, "deviceScaleFactor": 2, "mobile": True})
    cdp.send("Emulation.setTouchEmulationEnabled", {"enabled": True})
    cdp.send("Page.navigate", {"url": f"http://127.0.0.1:{port}/"}); cdp.pump(1.2)
    E("localStorage.clear()"); cdp.send("Page.reload", {}); cdp.pump(1.2)
    E("window.__errs = []; window.addEventListener('error', e => window.__errs.push(e.message + ' @' + e.lineno))")
    E("UI.page(null); Game.start({ level: 30, lives: 3 })"); cdp.pump(0.2)
    E(f"{D}.skipIntro && {D}.skipIntro()"); E(f"for (let i = 0; i < 200 && Game.state !== 'playing'; i++) {D}.tick(1 / 60)")
    E(f"{D}.tanks.forEach(t => {{ if (t !== {D}.player) t.alive = false; }})")    # nobody shooting back
    E(f"{D}.player.fireCD = 0"); tap(500, 180)
    E("(() => { const d = Game.debug, t = d.player, T = 40, C = d.consts.COLS; for (let r = 7; r < 10; r++) for (let c = 10; c < 14; c++) if (!d.map[r * C + c]) { t.x = (c + .5) * T; t.y = (r + .5) * T; return; } })()")   # middle of the map
    for _ in range(30): E(f"{D}.tick(1/60)")
    cdp.pump(0.6)
    check("on a phone the map is zoomed in (a square is at least 1/6.5 of the screen tall)", E("Game.debug.screenOf(0, 40).y - Game.debug.screenOf(0, 0).y") >= 360 / 6.5 - 0.5, E("Game.debug.screenOf(0, 40).y - Game.debug.screenOf(0, 0).y"))
    p = E(f"{D}.screenOf({D}.player.x, {D}.player.y)")
    check("the camera is on your tank", abs(p["x"] - 400) < 60 or abs(p["y"] - 180) < 60, p)
    # a tap: turret turns to the tapped spot and fires
    E(f"{D}.shells.length = 0; {D}.player.shells = 0; {D}.player.fireCD = 0")
    tx, ty = p["x"] + 150, p["y"] - 80
    tap(tx, ty)
    check("a tap fires one shell", E(f"{D}.shells.length") == 1, E(f"{D}.shells.length"))
    want = math.atan2(-80, 150)
    check("...toward the tapped spot", ang(E(f"{D}.player.turret"), want) < 0.05, (E(f"{D}.player.turret"), want))
    # a drag: the turret follows the finger, no shot
    E(f"{D}.shells.length = 0; {D}.player.shells = 0; {D}.player.fireCD = 0")
    p = E(f"{D}.screenOf({D}.player.x, {D}.player.y)")
    touch("touchStart", [(p["x"] + 150, p["y"])]); cdp.pump(0.1)
    touch("touchMove", [(p["x"] + 100, p["y"] + 100)]); cdp.pump(0.1)
    check("dragging: the turret follows the finger", ang(E(f"{D}.player.turret"), math.atan2(100, 100)) < 0.08, E(f"{D}.player.turret"))
    touch("touchMove", [(p["x"] - 100, p["y"] + 60)]); cdp.pump(0.1)
    check("...wherever it goes", ang(E(f"{D}.player.turret"), math.atan2(60, -100)) < 0.08, E(f"{D}.player.turret"))
    shot("42-finger-aim")
    touch("touchEnd", []); cdp.pump(0.05)
    check("...and letting go of a drag does not fire", E(f"{D}.shells.length") == 0)
    # drive with the left thumb while tapping to fire on the left side of the screen
    x0 = E(f"{D}.player.x")
    touch("touchStart", [(120, 260)]); touch("touchMove", [(180, 260)]); cdp.pump(0.5)
    check("left thumb drives (and the camera follows)", E(f"{D}.player.x") > x0 + 20)
    E(f"{D}.player.fireCD = 0; {D}.player.shells = 0; {D}.shells.length = 0")
    q = E(f"{D}.screenOf({D}.player.x, {D}.player.y)")
    touch("touchStart", [(180, 260), (q["x"] - 140, q["y"])]); cdp.pump(0.05)
    cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": [{"x": q["x"] - 140, "y": q["y"], "id": 1}]}); cdp.pump(0.05)   # lift only the tapping finger
    check("while driving, a tap on the left side still fires", E(f"{D}.shells.length") == 1 or E(f"{D}.player.fireCD") > 0)   # (a shot right against a wall puffs out, but it was fired)
    touch("touchEnd", [])
    # zoom: Options > Map zoom slider, and the in-game button flips between ALL and that zoom
    sq = lambda: E("Game.debug.screenOf(0, 40).y - Game.debug.screenOf(0, 0).y")
    allOn = lambda: E("Game.debug.screenOf(Game.debug.consts.W, Game.debug.consts.H).y") <= 361 and E("Game.debug.screenOf(0, 0).y") >= -1
    z80 = sq()
    E("Store.setOpt('zoom', 1)"); cdp.pump(0.1)
    check("zoom 100%: 5 squares fill the screen height", abs(sq() - 72) < 1, sq())
    shot("43-zoom-max")
    E("Store.setOpt('zoom', 0.4)"); cdp.pump(0.1)
    check("zoom 40%: further out than 80%", sq() < z80 - 5, (sq(), z80))
    E("Store.setOpt('zoom', 0)"); cdp.pump(0.1)
    check("zoom ALL: the whole map", allOn())
    E("Store.setOpt('zoom', 0.6)"); cdp.pump(0.1)
    r = 360 * 0.085; btn = (800 - 28 - 360 * 0.17 + r / 2, 14 + r / 2)
    tap(*btn); cdp.pump(0.1)
    check("button: whole map for now", allOn())
    tap(*btn); cdp.pump(0.1)
    check("...and back to your zoom", not allOn() and E("Store.opts.zoom") == 0.6)
    # the Options page slider
    E("Game.pause()"); E("document.getElementById('pauseOptions').click()"); cdp.pump(0.2)
    check("Options shows the Map zoom slider at 60%", E("document.getElementById('optZoomV').textContent") == "60%")
    E("const z = document.getElementById('optZoom'); z.value = 0; z.dispatchEvent(new Event('input'))")
    check("slider all the way left = ALL", E("document.getElementById('optZoomV').textContent") == "ALL" and E("Store.opts.zoom") == 0)
    shot("44-options-zoom")
    check("no script errors", E("window.__errs") == [], E("window.__errs"))
finally:
    proc.kill(); srv.kill()
print("ALL PASS" if not fails else f"{len(fails)} FAILED: {fails}", flush=True)
