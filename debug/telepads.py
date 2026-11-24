"""Teleporters place up to 5 teleport squares of their own before a multiplayer round. Run: python -I debug/telepads.py"""
import os, sys, time, base64, subprocess, socket, json
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
def shot(name):
    r = cdp.send("Page.captureScreenshot", {"format": "png"}); open(os.path.join(HERE, "shots", name + ".png"), "wb").write(base64.b64decode(r["result"]["data"]))
def tap(c, r):
    p = E(f"Game.debug.screenOf({(c + 0.5) * 40}, {(r + 0.5) * 40})")
    for t in ("touchStart", "touchEnd"):
        cdp.send("Input.dispatchTouchEvent", {"type": t, "touchPoints": [{"x": p["x"], "y": p["y"]}] if t == "touchStart" else []})
    cdp.pump(0.05)
try:
    cdp.send("Emulation.setDeviceMetricsOverride", {"width": 1280, "height": 720, "deviceScaleFactor": 1, "mobile": True})
    cdp.send("Emulation.setTouchEmulationEnabled", {"enabled": True})
    cdp.send("Page.navigate", {"url": f"http://127.0.0.1:{port}/"}); cdp.pump(1.2)
    E("window.__errs = []; window.addEventListener('error', e => window.__errs.push(e.message + ' @' + e.lineno))")
    E("UI.page(null)")
    E("""(() => {
      const L = Editor.blankLocal(16, 10);
      const sp = p => ({ id: 'x' + Math.random(), name: 'T', col: {}, powers: p });
      Game.versus({ role: 'local', L, players: [{ id: 'p1', name: 'BLUE', spec: sp(['teleport']), slot: 0 }, { id: 'p2', name: 'RED', spec: sp(['teleport']), slot: 1 }] });
    })()""")
    cdp.pump(0.3)
    check("a round with teleporters starts with the placing time", E("Game.state") == "place")
    for c in (4, 5, 6, 7, 8): tap(c, 2)
    check("blue places 5 squares", E("Game.debug.map.filter(v => v === 11).length") == 5, E("Game.debug.map.filter(v => v === 11).length"))
    check("5 squares end blue's turn: red's turn now", E("Game.debug.vs.placeTurn") == 1)
    shot("40-telepads-place")
    tap(4, 7); tap(10, 7); tap(10, 7)
    check("red places, and tapping its own square again takes it back", E("Game.debug.map.filter(v => v === 11).length") == 6)
    tap(4, 2)
    check("red can't take blue's square", E("Game.debug.map[2 * 16 + 4]") == 11)
    E("for (let i = 0; i < 13 * 60; i++) Game.debug.tick(1 / 60)")
    check("time runs out: GET READY, then the battle", E("Game.state") == "intro")
    E("for (let i = 0; i < 3 * 60; i++) Game.debug.tick(1 / 60)")
    check("...playing", E("Game.state") == "playing")
    # blue drives onto its own square and teleports to its next one
    E("const t = Game.debug.vs.players[0].tank; t.x = 4.5 * 40; t.y = 2.5 * 40;")
    ok = E("Game.debug.act(Game.debug.vs.players[0], 'tele')")
    check("blue teleports from its square to its next one", ok and E("Math.floor(Game.debug.vs.players[0].tank.x / 40)") == 5, E("Game.debug.vs.players[0].tank.x"))
    E("const r = Game.debug.vs.players[1].tank; r.x = 6.5 * 40; r.y = 2.5 * 40;")
    check("red can't use blue's squares", E("Game.debug.act(Game.debug.vs.players[1], 'tele')") is False)
    E("Game.stop()")
    E("""(() => { const L = Editor.blankLocal(16, 10); const sp = p => ({ id: 'y', name: 'T', col: {}, powers: p });
      Game.versus({ role: 'local', L, players: [{ id: 'p1', name: 'A', spec: sp(['rocket']), slot: 0 }, { id: 'p2', name: 'B', spec: sp([]), slot: 1 }] }); })()""")
    check("no teleporters: no placing time", E("Game.state") == "intro")
    E("Game.stop()")

    # the second fire button: weapon 2 with no powers, OFF with a power, MINE with Mines
    def duel(powers):
        E("Game.stop()")
        E("(() => { const L = Editor.blankLocal(16, 10); const sp = p => ({ id: 'z', name: 'T', col: {}, weapons: ['shell', 'rocket'], powers: p });"
          f"Game.versus({{ role: 'local', L, players: [{{ id: 'p1', name: 'A', spec: sp({json.dumps(powers)}), slot: 0 }}, {{ id: 'p2', name: 'B', spec: sp([]), slot: 1 }}] }}); }})()")
        E("for (let i = 0; i < 3 * 60; i++) Game.debug.tick(1 / 60)")
    duel([])
    check("no powers: the second button fires weapon 2", E("Game.debug.act(Game.debug.vs.players[0], 'fire2')") is True and E("Game.debug.shells.some(s => s.rocket)"))
    duel(["speed"])
    check("a power picked: the second button does nothing", E("Game.debug.act(Game.debug.vs.players[0], 'fire2')") is False and E("Game.debug.shells.length") == 0)
    check("...and weapon 1 still fires", E("Game.debug.act(Game.debug.vs.players[0], 'fire')") is True)
    duel(["mines", "speed"])
    check("Mines picked: the second button lays a mine", E("Game.debug.act(Game.debug.vs.players[0], 'fire2')") is True and E("Game.debug.mines.length") == 1)
    shot("41-fire2-mine")
    E("Game.stop()")
    check("no script errors", E("window.__errs") == [], E("window.__errs"))
finally:
    proc.kill(); srv.kill()
print("ALL PASS" if not fails else f"{len(fails)} FAILED: {fails}", flush=True)
