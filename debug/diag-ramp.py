"""Ramp corner wedge: drive diagonally onto Mission 11's bottom-left ramp from its open corner, then see if the tank can still move."""
import os, sys, json, time, subprocess, socket
sys.path.insert(0, r"C:\Users\JesusFam\slayerfiles-debug")
import harness
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE)
s = socket.socket(); s.bind(("127.0.0.1", 0)); port = s.getsockname()[1]; s.close()
srv = subprocess.Popen(["node", "server.js"], cwd=ROOT, env={**os.environ, "PORT": str(port)}, stdout=subprocess.DEVNULL)
time.sleep(0.8)
proc, cdp = harness.launch_chrome("chrome-tankfiles-diag")
E = cdp.eval; D = "Game.debug"; T = 40
try:
    cdp.send("Emulation.setDeviceMetricsOverride", {"width": 960, "height": 540, "deviceScaleFactor": 1, "mobile": False})
    cdp.send("Page.navigate", {"url": f"http://127.0.0.1:{port}/"}); cdp.pump(1.5)
    E("localStorage.clear()")
    E("Game.start(Object.assign(Store.newSave(), {level: 11}))"); cdp.pump(0.3)
    E(f"{D}.skipIntro(); {D}.tanks.slice(1).forEach(t => {{ t.ai.fireT = 999; t.ai.mineT = 999; t.ai.restT = 99; t.ai.path = []; }})")
    for sx, sy, keys, label in [(8.3, 8.7, ("KeyD",), "ramp, low side, drive E onto the slab"), (8.3, 8.5, ("KeyW",), "ramp, west side, drive N onto the slab"),
                                (8.7, 8.5, ("KeyS",), "ramp, east side, drive S onto the grass"), (7.3, 9.3, ("KeyD", "KeyW"), "grass SW corner, drive NE")]:
        E(f"{D}.player.x = {sx*T}; {D}.player.y = {sy*T}")
        for k in keys: E(f"{D}.key('{k}', true)")
        cdp.pump(1.5)
        for k in keys: E(f"{D}.key('{k}', false)")
        pos = json.loads(E(f"JSON.stringify([{D}.player.x/40, {D}.player.y/40, {D}.player.h])"))
        moved = {}
        for k in ("KeyW", "KeyA", "KeyS", "KeyD"):
            before = json.loads(E(f"JSON.stringify([{D}.player.x, {D}.player.y])"))
            E(f"{D}.key('{k}', true)"); cdp.pump(0.4); E(f"{D}.key('{k}', false)")
            after = json.loads(E(f"JSON.stringify([{D}.player.x, {D}.player.y])"))
            moved[k] = round(((after[0]-before[0])**2 + (after[1]-before[1])**2) ** 0.5, 1)
        print(label, "-> at", [round(v, 2) for v in pos], "moves:", moved, "STUCK" if max(moved.values()) < 4 else "free")
finally:
    harness.kill_chrome(proc); srv.terminate()
