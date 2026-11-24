"""LOCAL multiplayer over PeerJS: two browsers; A hosts, B finds the lobby, joins, chats, they fight a round, back to the lobby, kick.
Needs internet (PeerJS broker + ipify). Run: python -I debug/lan.py"""
import os, sys, time, subprocess, socket, base64, json, urllib.request
sys.path.insert(0, r"C:\Users\JesusFam\slayerfiles-debug")
import harness, websocket
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE)
fails = []
def check(name, ok, extra=""):
    print(("ok   " if ok else "FAIL ") + name + (f"  ({extra})" if not ok and extra != "" else ""), flush=True)
    if not ok: fails.append(name)
def shot(c, name):
    r = c.send("Page.captureScreenshot", {"format": "png"}); open(os.path.join(HERE, "shots", name + ".png"), "wb").write(base64.b64decode(r["result"]["data"]))
def launch(profile):
    port = harness.free_port()
    proc = subprocess.Popen([harness.CHROME, "--headless=new", "--disable-gpu", "--mute-audio", "--no-first-run", "--no-default-browser-check",
        "--disable-extensions", "--disable-features=WebRtcHideLocalIpsWithMdns", f"--remote-debugging-port={port}",
        f"--user-data-dir={os.path.join(harness.SCRATCH, profile)}", "--remote-allow-origins=*", "--window-size=915,412", "about:blank"],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    for _ in range(120):
        try:
            with urllib.request.urlopen(f"http://127.0.0.1:{port}/json/list", timeout=1) as r:
                pages = [t for t in json.load(r) if t.get("type") == "page"]
            if pages: break
        except Exception: pass
        time.sleep(0.15)
    c = harness.CDP(websocket.create_connection(pages[0]["webSocketDebuggerUrl"], timeout=25))
    c.send("Runtime.enable"); c.send("Page.enable")
    return proc, c

s = socket.socket(); s.bind(("127.0.0.1", 0)); port = s.getsockname()[1]; s.close()
srv = subprocess.Popen(["node", "server.js"], cwd=ROOT, env={**os.environ, "PORT": str(port), "HOST": "127.0.0.1"}, stdout=subprocess.DEVNULL)
time.sleep(0.8)
pa, A = launch("chrome-tankfiles-a"); pb, B = launch("chrome-tankfiles-b")
def pump(t):
    end = time.time() + t
    while time.time() < end: A.pump(0.1); B.pump(0.1)
def until(cond, t=25):
    end = time.time() + t
    while time.time() < end:
        try:
            if cond(): return True
        except Exception: pass
        pump(0.3)
    return False
try:
    for c in (A, B):
        c.send("Emulation.setDeviceMetricsOverride", {"width": 915, "height": 412, "deviceScaleFactor": 1, "mobile": False})
        c.send("Page.navigate", {"url": f"http://127.0.0.1:{port}/"})
    pump(1.5)
    for c, n in ((A, "HOSTY"), (B, "BRO")):
        c.eval("localStorage.clear()"); c.send("Page.reload", {})
    pump(1.5)
    for c, n in ((A, "HOSTY"), (B, "BRO")):
        c.eval("window.__errs = []; window.addEventListener('error', e => window.__errs.push(e.message + ' @' + e.filename + ':' + e.lineno))")
        c.eval("document.getElementById('multiBtn').click()"); pump(0.2)
        c.eval("document.getElementById('mpLocal').click()"); pump(0.3)
        c.eval(f"document.getElementById('ppName').value = '{n}'; document.getElementById('ppReady').click()"); pump(0.3)
    check("both reach the LOCAL GAMES list", A.eval("document.getElementById('lan').classList.contains('active')") and B.eval("document.getElementById('lan').classList.contains('active')"))
    # the host's tank has 2 powers
    A.eval("Store.setNet('tank', Object.assign(Store.net.tank, { powers: ['rocket', 'mines'] }))")
    A.eval("document.getElementById('lanHost').click()")
    check("A opens a lobby", until(lambda: A.eval("document.getElementById('lobby').classList.contains('active') && Net.hosting"), 25))
    shot(A, "30-lobby-host")
    check("B finds A's lobby with the host name and player count", until(lambda: "HOSTY" in B.eval("document.getElementById('lanList').textContent") and "1 / 10" in B.eval("document.getElementById('lanList').textContent"), 40),
          B.eval("document.getElementById('lanList').textContent"))
    shot(B, "31-lan-list")
    B.eval("document.querySelector('#lanList .lan-game').click()")
    check("B joins the lobby", until(lambda: B.eval("document.getElementById('lobby').classList.contains('active') && Versus.lobby.players.length === 2"), 30))
    check("A sees B in square 2", until(lambda: "BRO" in A.eval("document.querySelector('.lb-sq[data-slot=\"1\"]').textContent"), 10))
    B.eval("Versus.sendChat('can we play mission 5')")
    check("chat reaches the host", until(lambda: "mission 5" in A.eval("document.getElementById('lbMsgs').textContent"), 10))
    check("...and comes back to the guest", until(lambda: "mission 5" in B.eval("document.getElementById('lbMsgs').textContent"), 10))
    # host picks mission 5 from the map choice
    A.eval("document.getElementById('lbPick').click()"); pump(0.3)
    A.eval("document.querySelector('#mpTabs [data-mtab=campaign]').click()"); pump(0.2)
    A.eval("document.querySelector('#mpList [data-map=\"5\"]').click()"); pump(0.3)
    check("the map change shows on the guest", until(lambda: "MISSION 5" in B.eval("document.getElementById('lbMapName').textContent"), 10), B.eval("document.getElementById('lbMapName').textContent"))
    shot(B, "32-lobby-guest")
    A.eval("document.getElementById('lbStart').click()")
    check("the round starts on both", until(lambda: A.eval("Game.isVersus") and B.eval("Game.isVersus"), 15))
    check("both see 2 tanks with names", B.eval("Game.vsInfo.players.map(p => p.name).join(',')") == "HOSTY,BRO", B.eval("JSON.stringify(Game.vsInfo)"))
    check("intro becomes playing on the guest", until(lambda: B.eval("Game.state") == "playing", 10))
    # B drives right: the host sees it move
    x0 = A.eval("Game.vsInfo.players[1].x")
    B.eval("Game.debug.key('KeyD', true)"); pump(1.2); B.eval("Game.debug.key('KeyD', false)")
    x1 = A.eval("Game.vsInfo.players[1].x")
    check("the guest drives and the host sees it", abs(x1 - x0) > 20, f"{x0} -> {x1}")
    # the host fires a rocket: the guest sees a shell
    A.eval("Game.debug.act(Game.debug.vs.players[0], 'fire')")
    check("the host's rocket shows on the guest", until(lambda: B.eval("Game.debug.shells.length") > 0, 5))
    # the guest fires: the host gets a shell from player 2
    B.eval("Game.debug.act(Game.debug.vs.players[1], 'fire')")
    check("the guest fires through the host", until(lambda: A.eval("Game.debug.shells.some(s => s.owner && s.owner.P.idx === 1)"), 5))
    shot(B, "33-battle-guest")
    # finish the round: host kills the guest 3 times
    for _ in range(3):
        until(lambda: A.eval("Game.debug.vs.players[1].tank.alive"), 6)
        A.eval("Game.debug.kill(Game.debug.vs.players[1].tank)"); pump(0.3)
    check("the host wins and the guest sees it", until(lambda: B.eval("Game.state") == "over", 10))
    check("everyone goes back to the lobby", until(lambda: A.eval("document.getElementById('lobby').classList.contains('active')") and B.eval("document.getElementById('lobby').classList.contains('active')"), 15))
    check("the win shows in the chat", "HOSTY won" in A.eval("document.getElementById('lbMsgs').textContent"))
    # kick
    A.eval("Versus.kick(Versus.lobby.players[1].id)")
    check("a kicked guest goes back to the games list", until(lambda: B.eval("document.getElementById('lan').classList.contains('active')"), 10))
    check("...and the host's lobby has just the host", A.eval("Versus.lobby.players.length") == 1)
    check("the kicked player can join again", until(lambda: "HOSTY" in B.eval("document.getElementById('lanList').textContent"), 40))
    B.eval("document.querySelector('#lanList .lan-game').click()")
    check("...and does", until(lambda: A.eval("Versus.lobby.players.length") == 2, 30))
    check("no script errors", A.eval("window.__errs") == [] and B.eval("window.__errs") == [], str(A.eval("window.__errs")) + str(B.eval("window.__errs")))
finally:
    for p in (pa, pb): p.kill()
    srv.kill()
print("ALL PASS" if not fails else f"{len(fails)} FAILED: {fails}", flush=True)
