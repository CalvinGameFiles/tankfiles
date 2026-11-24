"""Draw all 10 multiplayer tank models big (plus each model's paint pick map) -> debug/shots/models-sheet.png"""
import os, sys, time, base64, subprocess, socket
sys.path.insert(0, r"C:\Users\JesusFam\slayerfiles-debug")
import harness
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE)
s = socket.socket(); s.bind(("127.0.0.1", 0)); port = s.getsockname()[1]; s.close()
srv = subprocess.Popen(["node", "server.js"], cwd=ROOT, env={**os.environ, "PORT": str(port), "HOST": "127.0.0.1"}, stdout=subprocess.DEVNULL)
time.sleep(0.8)
proc, cdp = harness.launch_chrome("chrome-tankfiles-sheet")
try:
    cdp.send("Page.navigate", {"url": f"http://127.0.0.1:{port}/"}); cdp.pump(1.5)
    url = cdp.eval("""(() => {
      const cv = document.createElement('canvas'); cv.width = 1500; cv.height = 640; const g = cv.getContext('2d');
      g.fillStyle = '#c9b48c'; g.fillRect(0, 0, 1500, 640);
      const cols = [['#2f7df6','#1b4fb0','#7fb0ff'],['#f03a3a','#a01818','#ff9a9a'],['#3ad15a','#1c7a30','#a8f0b8'],['#f5d327','#a08a10','#fff0a0'],['#a24ff0','#5a1aa0','#d8b0ff']];
      for (let i = 0; i < 10; i++) {
        const c = cols[i % 5], spec = { model: i, weapons: i === 4 ? ['laser','flame'] : ['shell','rocket'], col: Object.assign({}, BLANK_TANK_COLS, { tread: '#2a2a30', pad: '#5a5a66', edge: c[1], body: c[0], lamp: c[2], barrel: c[1], tip: '#2a2a30', ring: c[2], cap: c[0] }) };
        const x = 150 + (i % 5) * 300, y = 160 + Math.floor(i / 5) * 320;
        Game.drawTankPreview(g, pvpType(spec), { x, y, scale: 4.2, turret: -0.6, hull: 0, noHearts: true });
        g.fillStyle = '#1a1a1a'; g.font = 'bold 22px Impact'; g.textAlign = 'center'; g.fillText(TANK_MODELS[i].label, x, y + 140);
      }
      return cv.toDataURL('image/png');
    })()""")
    open(os.path.join(HERE, "shots", "models-sheet.png"), "wb").write(base64.b64decode(url.split(',')[1]))
    print('ok')
finally:
    try: cdp.close()
    except Exception: pass
    proc.kill(); srv.kill()
