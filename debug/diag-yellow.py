"""Watch the yellow mine layers on Mission 10: fine-grained log of each yellow for the 2 s after it drops a mine, and any death."""
import os, sys, json, time, subprocess, socket
sys.path.insert(0, r"C:\Users\JesusFam\slayerfiles-debug")
import harness
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE)
RUNS = int(sys.argv[1]) if len(sys.argv) > 1 else 3
s = socket.socket(); s.bind(("127.0.0.1", 0)); port = s.getsockname()[1]; s.close()
srv = subprocess.Popen(["node", "server.js"], cwd=ROOT, env={**os.environ, "PORT": str(port)}, stdout=subprocess.DEVNULL)
time.sleep(0.8)
proc, cdp = harness.launch_chrome("chrome-tankfiles-diag")
E = cdp.eval; D = "Game.debug"
try:
    cdp.send("Emulation.setDeviceMetricsOverride", {"width": 960, "height": 540, "deviceScaleFactor": 1, "mobile": False})
    cdp.send("Page.navigate", {"url": f"http://127.0.0.1:{port}/"}); cdp.pump(1.5)
    E("localStorage.clear()")
    for run in range(RUNS):
        print("== run", run + 1)
        E("Game.start(Object.assign(Store.newSave(), {level: 10}))"); cdp.pump(0.3)
        E(f"{D}.skipIntro(); {D}.tanks.slice(1).forEach(t => {{ t.ai.fireT = 999; if (t.ai.mineT) t.ai.mineT = 0.05; }})")
        dead = False
        for i in range(200):
            cdp.pump(0.1)
            row = json.loads(E(f"""(() => {{ const ys = {D}.tanks.slice(1).filter(t => t.type === 'yellow').map(t => {{
                const my = {D}.mines.filter(m => m.owner === t).map(m => [(m.x/40).toFixed(2), (m.y/40).toFixed(2), +m.t.toFixed(2), m.lit]);
                return {{ alive: t.alive, x: +(t.x/40).toFixed(2), y: +(t.y/40).toFixed(2), hull: +t.hull.toFixed(2), mode: t.ai.mode, path: t.ai.path.slice(0, 3), stuck: +t.ai.stuck.toFixed(2), rest: +(t.ai.restT||0).toFixed(2), moving: t.moving, planT: +t.ai.planT.toFixed(2), my }}; }});
              return JSON.stringify({{ ys, n: {D}.mines.length, p: {D}.player.alive }}); }})()"""))
            for k, y in enumerate(row["ys"]):
                fresh = [m for m in y["my"] if m[2] < 2.2]
                if fresh or not y["alive"]:
                    print(f"{(i+1)*0.1:5.1f} Y{k} {'A' if y['alive'] else 'DEAD'} at ({y['x']},{y['y']}) hull {y['hull']} {y['mode']} path {y['path']} stuck {y['stuck']} rest {y['rest']} moving {y['moving']} planT {y['planT']} mines {y['my']}")
            if any(not y["alive"] for y in row["ys"]) or not row["p"]:
                print("DEATH", row); dead = True; break
        if dead: break
        E("Game.stop()")
finally:
    harness.kill_chrome(proc); srv.terminate()
