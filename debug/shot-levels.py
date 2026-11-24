"""Screenshot the level select page (top rows, then scrolled to the bottom). Run: python -I debug/shot-levels.py"""
import os, sys, time, base64, subprocess, socket
sys.path.insert(0, r"C:\Users\JesusFam\slayerfiles-debug")
import harness
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE)
s = socket.socket(); s.bind(("127.0.0.1", 0)); port = s.getsockname()[1]; s.close()
srv = subprocess.Popen(["node", "server.js"], cwd=ROOT, env={**os.environ, "PORT": str(port)}, stdout=subprocess.DEVNULL)
time.sleep(0.8)
proc, cdp = harness.launch_chrome("chrome-tankfiles")
def shot(name):
    r = cdp.send("Page.captureScreenshot", {"format": "png"})
    open(os.path.join(HERE, "shots", name + ".png"), "wb").write(base64.b64decode(r["result"]["data"]))
try:
    cdp.send("Emulation.setDeviceMetricsOverride", {"width": 960, "height": 540, "deviceScaleFactor": 1, "mobile": False})
    cdp.send("Page.navigate", {"url": f"http://127.0.0.1:{port}/"}); cdp.pump(1.5)
    cdp.eval("document.querySelector('[data-go=levels]').click()"); cdp.pump(0.4)
    shot("01b-levels")
    cdp.eval("document.getElementById('levelGrid').scrollTop = 99999"); cdp.pump(0.3)
    shot("01c-levels-bottom")
finally:
    harness.kill_chrome(proc); srv.terminate()
