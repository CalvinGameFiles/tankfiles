"""iPhone: the Add to Home Screen sheet, the turn-sideways screen, sound unlock. Run: python -I debug/iphone.py [url]
With a url (the live site) it also checks the game opens with the internet switched off."""
import os, sys, time, base64, subprocess, socket
sys.path.insert(0, r"C:\Users\JesusFam\slayerfiles-debug")
import harness
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE)
LIVE = sys.argv[1] if len(sys.argv) > 1 else None
srv = None
if not LIVE:
    s = socket.socket(); s.bind(("127.0.0.1", 0)); port = s.getsockname()[1]; s.close()
    srv = subprocess.Popen(["node", "server.js"], cwd=ROOT, env={**os.environ, "PORT": str(port), "HOST": "127.0.0.1"}, stdout=subprocess.DEVNULL)
    time.sleep(0.8)
URL = LIVE or f"http://127.0.0.1:{port}/"
proc, cdp = harness.launch_chrome("chrome-tankfiles")
fails = []
def check(name, ok, info=""):
    print(("ok   " if ok else "FAIL ") + name + (f"  ({info})" if not ok and info != "" else ""), flush=True); ok or fails.append(name)
E = cdp.eval
def shot(name):
    r = cdp.send("Page.captureScreenshot", {"format": "png"}); open(os.path.join(HERE, "shots", name + ".png"), "wb").write(base64.b64decode(r["result"]["data"]))
IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1"
def phone(w, h):
    cdp.send("Emulation.setDeviceMetricsOverride", {"width": w, "height": h, "deviceScaleFactor": 3, "mobile": True})
def go(url):
    cdp.send("Page.navigate", {"url": url}); cdp.pump(1.5)
vis = lambda i: E(f"(() => {{ const e = document.getElementById('{i}'); return !!e && getComputedStyle(e).display !== 'none'; }})()")
try:
    cdp.send("Emulation.setUserAgentOverride", {"userAgent": IPHONE, "platform": "iPhone"})
    cdp.send("Emulation.setTouchEmulationEnabled", {"enabled": True, "maxTouchPoints": 5})
    cdp.send("Emulation.setEmitTouchEventsForMouse", {"enabled": True, "configuration": "mobile"})
    phone(844, 390)
    go(URL); E("localStorage.clear()"); go(URL)
    check("iPhone in Safari: the Add to Home Screen sheet shows", vis("iosInstall"))
    check("...with the iPhone icon", E("document.querySelector('link[rel=apple-touch-icon]').href").endswith("icon-180.png"))
    shot("46-iphone-sheet")
    E("document.getElementById('iosOk').click()"); cdp.pump(0.2)
    check("GOT IT closes it", not vis("iosInstall"))
    go(URL)
    check("...and it doesn't nag again", not vis("iosInstall"))
    go(URL + "?iphone=1")
    check("the website's iPhone button (?iphone=1) always shows it", vis("iosInstall"))
    E("document.getElementById('iosLater').click()"); cdp.pump(0.2)
    # sound unlock on the first tap
    E("document.getElementById('title').dispatchEvent(new Event('click', { bubbles: true }))"); cdp.pump(0.5)
    check("first tap: music player unlocked, silent and stopped on the title", E("Music._el.paused") is True and E("Music._el.muted") is False and E("Music.track") is None)
    check("no viewport-fit=cover (the iPhone keeps the game clear of the notch)", "viewport-fit" not in E("document.querySelector('meta[name=viewport]').content"))
    phone(390, 844); cdp.pump(0.3)
    check("phone held upright: 'turn your phone sideways'", vis("rotate"))
    shot("47-iphone-rotate")
    phone(844, 390); cdp.pump(0.3)
    check("sideways: the game", not vis("rotate"))
    if LIVE:
        cdp.send("Network.enable", {})
        for _ in range(20):
            if E("!!(navigator.serviceWorker && navigator.serviceWorker.controller)"): break
            go(URL); cdp.pump(0.5)
        check("live: the offline helper is running", E("!!navigator.serviceWorker.controller"))
        cdp.send("Network.emulateNetworkConditions", {"offline": True, "latency": 0, "downloadThroughput": -1, "uploadThroughput": -1})
        go(URL)
        check("live: with NO internet the game still opens", E("typeof Game === 'object' && !!document.getElementById('title')") is True)
        E("document.getElementById('iosLater') && document.getElementById('iosLater').click()")
        shot("48-iphone-offline")
        cdp.send("Network.emulateNetworkConditions", {"offline": False, "latency": 0, "downloadThroughput": -1, "uploadThroughput": -1})
    else:
        check("the PC test server doesn't start the offline helper", E("navigator.serviceWorker ? navigator.serviceWorker.getRegistrations().then(r => r.length) : 0") == 0)
finally:
    proc.kill()
    if srv: srv.kill()
print("ALL PASS" if not fails else f"{len(fails)} FAILED: {fails}", flush=True)
