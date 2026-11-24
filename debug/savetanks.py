"""Saving several player tanks on the PREPARE screen. Run: python -I debug/savetanks.py"""
import os, sys, time, subprocess, socket
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
def click(i): E(f"document.getElementById('{i}').click()"); cdp.pump(0.1)
def save(name):
    E(f"document.getElementById('ppTank').value = '{name}'"); click("ppSave")
try:
    cdp.send("Page.navigate", {"url": f"http://127.0.0.1:{port}/"}); cdp.pump(1.0)
    E("localStorage.clear()"); cdp.send("Page.reload", {}); cdp.pump(1.2)
    click("multiBtn"); click("mpSplit")
    save("ALPHA"); save("BRAVO"); save("CHARLIE")
    check("three names = three saved tanks", E("Store.playerTanks.map(t => t.name).join(',')") == "ALPHA,BRAVO,CHARLIE", E("Store.playerTanks.map(t => t.name).join(',')"))
    E("Versus.pp.spec.powers = ['speed']"); save("BRAVO")
    check("saving an existing name asks first", E("document.getElementById('confirm').classList.contains('active')") is True)
    click("confirmYes")
    check("...and replaces it instead of adding a 4th", E("Store.playerTanks.length") == 3 and E("Store.playerTanks.find(t => t.name === 'BRAVO').powers.join()") == "speed")
    cdp.send("Page.reload", {}); cdp.pump(1.2)
    check("they are still all there after closing the game", E("Store.playerTanks.length") == 3)
    click("multiBtn"); click("mpSplit"); click("ppLoad")
    check("LOAD PLAYER TANK lists all three", E("document.querySelectorAll('#ppLoadList .ed-lrow').length") == 3)
finally:
    proc.kill(); srv.kill()
print("ALL PASS" if not fails else f"{len(fails)} FAILED: {fails}", flush=True)
