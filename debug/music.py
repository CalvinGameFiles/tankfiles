"""Check the music in a real browser: a track plays, loops past its end, holds on pause, stops on death. Run: python -I debug/music.py"""
import os, sys, time, subprocess, socket
sys.path.insert(0, r"C:\Users\JesusFam\slayerfiles-debug")
import harness
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE)
s = socket.socket(); s.bind(("127.0.0.1", 0)); port = s.getsockname()[1]; s.close()
srv = subprocess.Popen(["node", "server.js"], cwd=ROOT, env={**os.environ, "PORT": str(port)}, stdout=subprocess.DEVNULL)
time.sleep(0.8)
proc, cdp = harness.launch_chrome("chrome-tankfiles")
fails = []
def check(name, ok, info=""):
    print(("ok   " if ok else "FAIL ") + name + (f"  ({info})" if not ok and info else "")); ok or fails.append(name)
E = cdp.eval
try:
    cdp.send("Page.navigate", {"url": f"http://127.0.0.1:{port}/"}); cdp.pump(1.5)
    E("document.querySelector('[data-go=levels]').click()"); cdp.pump(0.3)
    E("document.querySelector('#levelGrid .lbtn[data-level=\"91\"]').click()"); cdp.pump(2.0)
    a = "document.querySelector('audio') || window.__mus"
    st = E("[Music.track, Music.playing]")
    check("mission 91 plays the graveyard track", st == ["grave", True], str(st))
    E("Game.debug.skipIntro()"); E("Game.debug.tanks.slice(1).forEach(t => { t.ai.fireT = 999; t.ai.path = []; t.ai.restT = 999; })")
    # jump to the last second of the song and let it run over the end
    E("Music._el.currentTime = Music._el.duration - 0.5"); cdp.pump(1.5)
    t = E("[Music.playing, Music._el.currentTime, Music._el.duration]")
    check("the song loops back to the start when it ends", t[0] is True and t[1] < 3, str(t))
    E("Game.pause()"); cdp.pump(0.3); t1 = E("Music._el.currentTime"); cdp.pump(0.5)
    check("pausing the game holds the music", E("Music.playing") is False and abs(E("Music._el.currentTime") - t1) < 0.05)
    E("Game.resume()"); cdp.pump(0.5)
    check("resuming carries on from the same spot", E("Music.playing") is True and E("Music._el.currentTime") > t1)
    E("Game.debug.kill()"); cdp.pump(0.2)
    check("the music stops when the player dies", E("[Music.track, Music.playing]") == [None, False])
    cdp.pump(1.8); E("Game.advance()"); cdp.pump(0.6)
    check("retrying starts the track again from the top", E("[Music.track, Music.playing]") == ["grave", True] and E("Music._el.currentTime") < 1.5, str(E("Music._el.currentTime")))
    E("Game.debug.skipIntro()"); E("Game.debug.tanks.slice(1).forEach(t => Game.debug.kill(t))"); cdp.pump(0.3)
    check("the music stops when the mission is won", E("[Music.track, Music.playing]") == [None, False])
    cdp.pump(2.5)
    check("the next mission starts its music again", E("[Game.save.level, Music.track, Music.playing]") == [92, "grave", True])
finally:
    harness.kill_chrome(proc); srv.terminate()
print("ALL PASS" if not fails else f"{len(fails)} FAILED")
