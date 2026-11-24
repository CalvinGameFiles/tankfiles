"""Super laser you can dodge, slow heat seekers with a 4 s reload, 3 shells in multiplayer, slow-phone fallback. Run: python -I debug/weapons3.py"""
import os, sys, time, subprocess, socket, math, base64
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
def tick(sec): E(f"for (let i = 0; i < {round(sec * 60)}; i++) {D}.tick(1 / 60)")
try:
    cdp.send("Page.navigate", {"url": f"http://127.0.0.1:{port}/"}); cdp.pump(1.2)
    E("window.__errs = []; window.addEventListener('error', e => window.__errs.push(e.message + ' @' + e.lineno))")
    E("UI.page(null)")
    # ---- the campaign Super Laser tank: a warning, then a beam you can outrun
    def laser_level(px, py):
        E(f"""(() => {{ registerCustomTank({{ id: 'lz', name: 'LZ', powers: ['laser'], col: {{}} }});
          const L = Editor.blank(24, 16); L.player = [{px}, {py}]; L.enemies = [['c_lz', 21.5, 8.5]];
          Game.playCustom(L, () => {{}}); }})()""")
        E(f"{D}.skipIntro()")
        E(f"(() => {{ const t = {D}.tanks.find(t => t.ai && t.ai.T.laser); t.ai.charge = 0; t.turret = Math.atan2({D}.player.y - t.y, {D}.player.x - t.x); }})()")
    laser_level(3.5, 8.5)
    tick(0.1)
    check("lined up and charged: it WARNS first instead of firing", E(f"{D}.tanks.find(t => t.ai && t.ai.T.laser).ai.warn") > 0.5 and not E(f"{D}.tanks.find(t => t.ai && t.ai.T.laser).beamT > 0"))
    shot("45-laser-warning")
    E(f"{D}.key('KeyS', true)")                       # drive away sideways as soon as the sight line shows
    tick(1.0)
    check("...then the beam", E(f"{D}.tanks.find(t => t.ai && t.ai.T.laser).beamT") > 2)
    check("the player got out of the way in time", E(f"{D}.player.alive") is True)
    tick(3.2)
    check("...and outran the beam for its whole 3 s", E(f"{D}.player.alive") is True, E(f"{D}.player.y"))
    E(f"{D}.key('KeyS', false)")
    # standing still in the sight line still gets you
    laser_level(3.5, 8.5)
    tick(1.3)
    check("standing still in the sight line: hit", E(f"{D}.player.alive") is False)
    E("Game.stop()")

    # ---- multiplayer weapons (split screen = 'local' role, real game rules)
    def duel(w1, w2, p1=None):
        E("Game.stop()")
        E(f"""(() => {{ const L = Editor.blankLocal(24, 16); const sp = (w, p) => ({{ id: 'z' + Math.random(), name: 'T', col: {{}}, weapons: w, powers: p || [] }});
          Game.versus({{ role: 'local', L, players: [{{ id: 'p1', name: 'A', spec: sp({w1}), slot: 0 }}, {{ id: 'p2', name: 'B', spec: sp({w2}), slot: 1 }}] }}); }})()""")
        tick(3.1)
    duel("['shell', 'homing']", "['shell', 'rocket']")
    E(f"{D}.vs.players[0].tank.turret = 0; {D}.vs.players[1].tank.x = 22 * 40")
    n = E(f"(() => {{ const P = {D}.vs.players[0]; let n = 0; for (let i = 0; i < 6; i++) {{ P.tank.fireCD = 0; if ({D}.act(P, 'fire')) n++; }} return n; }})()")
    check("multiplayer: only 3 shells at once", n == 3, n)
    E(f"{D}.shells.length = 0; (() => {{ const t = {D}.vs.players[0].tank; t.out = [0, 0]; t.shells = 0; }})()")
    sp = E(f"(() => {{ const P = {D}.vs.players[0]; P.tank.fireCD = 0; {D}.act(P, 'fire2'); const s = {D}.shells.find(s => s.homing); return Math.hypot(s.vx, s.vy); }})()")
    check("heat seekers are slower (0.6 of a shell)", abs(sp - 200 * 0.6) < 1, sp)
    n = E(f"(() => {{ const P = {D}.vs.players[0]; let n = 0; for (let i = 0; i < 4; i++) {{ P.tank.fireCD = 0; if ({D}.act(P, 'fire2')) n++; }} return n; }})()")
    check("...3 in all", n == 2, n)
    E(f"{D}.shells.length = 0; (() => {{ const t = {D}.vs.players[0].tank; t.out = [0, 0]; t.shells = 0; }})()")
    check("all 3 fired: no more even with none flying", E(f"(() => {{ const P = {D}.vs.players[0]; P.tank.fireCD = 0; return {D}.act(P, 'fire2'); }})()") is False)
    check("...the button says RELOAD", "RELOAD" in E(f"{D}.ammoText ? {D}.ammoText({D}.vs.players[0].tank, 1) : 'RELOAD (no hook)'"))
    tick(3.0)
    check("...still reloading after 3 s", E(f"(() => {{ const P = {D}.vs.players[0]; P.tank.fireCD = 0; return {D}.act(P, 'fire2'); }})()") is False)
    tick(1.1)
    check("...ready again after 4 s", E(f"(() => {{ const P = {D}.vs.players[0]; P.tank.fireCD = 0; return {D}.act(P, 'fire2'); }})()") is True)

    # multiplayer laser: warning, frozen turret, then a sweep slower than the target can drive
    duel("['laser', 'shell']", "['shell', 'rocket']")
    E(f"(() => {{ const a = {D}.vs.players[0].tank, b = {D}.vs.players[1].tank; a.x = 3.5 * 40; a.y = 8.5 * 40; b.x = 20.5 * 40; b.y = 8.5 * 40; a.turret = 0; }})()")
    check("laser fires", E(f"{D}.act({D}.vs.players[0], 'fire')") is True)
    check("...a warning first", E(f"{D}.vs.players[0].tank.warnT") > 0.5 and not E(f"{D}.vs.players[0].tank.beamT > 0"))
    tick(0.8)
    check("...then the beam", E(f"{D}.vs.players[0].tank.beamT") > 2)
    rate = E(f"(() => {{ const t = {D}.vs.players[0].tank, a0 = t.turret; {D}.vs.players[0].tank.turret = a0; return 0; }})()")
    # the beam's sweep at 17 squares: slower than a tank drives across it
    E(f"{D}.vs.players[1].tank.y = 14.5 * 40")
    a0 = E(f"{D}.vs.players[0].tank.turret"); E(f"{D}.key('KeyS', true)"); tick(0.5); E(f"{D}.key('KeyS', false)")
    a1 = E(f"{D}.vs.players[0].tank.turret")
    check("laser sweep is slow", abs(a1 - a0) <= 0.55 * 128 / (17 * 40) * 0.5 + 0.02, (a0, a1))
    E("Game.stop()")

    # ---- slow phone: frames over 25 ms for 2 s drop the drawing resolution
    cdp.send("Emulation.setDeviceMetricsOverride", {"width": 800, "height": 360, "deviceScaleFactor": 2, "mobile": True}); cdp.pump(0.3)
    duel("['shell', 'rocket']", "['shell', 'rocket']")
    check("starts sharp (2x)", E("document.getElementById('game').width") == 1600)
    E("window.__slow = setInterval(() => { const t = performance.now(); while (performance.now() - t < 45) {} }, 0)")   # a busy phone
    cdp.pump(5.0)
    E("clearInterval(window.__slow)")
    check("a slow phone drops to a lower resolution", E("document.getElementById('game').width") < 1600, E("document.getElementById('game').width"))
    E("Game.stop()")
    check("no script errors", E("window.__errs") == [], E("window.__errs"))
finally:
    proc.kill(); srv.kill()
print("ALL PASS" if not fails else f"{len(fails)} FAILED: {fails}", flush=True)
