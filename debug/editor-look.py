"""Screenshots of the level creator and tank creator. Run: python -I debug/editor-look.py"""
import os, sys, time, base64, subprocess, socket
sys.path.insert(0, r"C:\Users\JesusFam\slayerfiles-debug")
import harness
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE)
s = socket.socket(); s.bind(("127.0.0.1", 0)); port = s.getsockname()[1]; s.close()
srv = subprocess.Popen(["node", "server.js"], cwd=ROOT, env={**os.environ, "PORT": str(port)}, stdout=subprocess.DEVNULL)
time.sleep(0.8)
proc, cdp = harness.launch_chrome("chrome-tankfiles")
E = cdp.eval
def shot(name):
    r = cdp.send("Page.captureScreenshot", {"format": "png"})
    open(os.path.join(HERE, "shots", name + ".png"), "wb").write(base64.b64decode(r["result"]["data"]))
try:
    cdp.send("Emulation.setDeviceMetricsOverride", {"width": 1280, "height": 720, "deviceScaleFactor": 1, "mobile": False})
    cdp.send("Page.navigate", {"url": f"http://127.0.0.1:{port}/"}); cdp.pump(1.2)
    E("window.__errs = []; window.addEventListener('error', e => window.__errs.push(e.message))")
    E("localStorage.clear()"); cdp.send("Page.reload", {}); cdp.pump(1.2)
    E("window.__errs = []; window.addEventListener('error', e => window.__errs.push(e.message))")
    shot("20a-title")
    E("document.getElementById('editorBtn').click()"); cdp.pump(0.5)
    # draw a little level through the real click handler path
    E("""(() => { const L = Editor.level; const t = (c, r, v) => L.tiles[r * L.cols + c] = v;
      for (let r = 3; r < 13; r++) t(11, r, 1); t(11, 7, 2); t(11, 8, 2); for (let c = 15; c < 19; c++) t(c, 4, 7); t(5, 3, 11); t(18, 12, 11); t(6, 12, 6); t(7, 12, 6); t(15, 10, 3);
      L.enemies.push(['red', 20.5, 3.5], ['pine', 20.5, 12.5], ['bomber', 14.5, 8.5]); Editor.refresh(); })()""")
    cdp.pump(0.3); shot("20b-editor-blocks")
    E("document.querySelector('#edTabs [data-tab=tanks]').click()"); cdp.pump(0.3); shot("20c-editor-tanks")
    E("document.querySelector('#edTabs [data-tab=style]').click()"); cdp.pump(0.3)
    E("document.querySelectorAll('.ed-style')[8].click()"); cdp.pump(0.2)
    E("document.querySelector('[data-color=wall]').click()"); cdp.pump(0.2)
    E("document.querySelectorAll('#palGrid .pal-sw')[4].click()"); cdp.pump(0.3); shot("20d-editor-style")
    E("document.querySelector('#edTabs [data-tab=tanks]').click()"); cdp.pump(0.2)
    E("document.getElementById('edCreateTank').click()"); cdp.pump(0.4)
    for p in ['bouncy', 'multi2', 'enchanter', 'resist']: E(f"document.querySelector('#tmPowers [data-power={p}]').click()"); cdp.pump(0.05)
    E("Editor.color = '#d63a3a'; Editor.paint('body'); Editor.paint('cap'); Editor.color = '#ffd040'; Editor.paint('ring'); Editor.paint('lamp')"); cdp.pump(0.2)
    E("document.getElementById('tmHp').value = 4; document.getElementById('tmHp').dispatchEvent(new Event('input'))"); cdp.pump(0.2)
    shot("20e-tankmaker")
    E("Editor.close()")
    E("""(() => { const sp = (id, powers, more) => { const s = Object.assign({ id, name: id, col: {}, powers, speed: 40, hp: 1, enchantRange: 16 }, more || {}); Store.saveTank(s); registerCustomTank(s); return 'c_' + id; };
      const L = Editor.blank(24, 14); for (const [c, r] of [[11,2],[11,3],[11,4],[11,5]]) L.tiles[r * 24 + c] = 1; L.tiles[6 * 24 + 4] = 11; L.tiles[10 * 24 + 19] = 11;
      L.player = [3.5, 11.5];
      L.enemies = [[sp('trn', ['train', 'bouncy'], { col: { body: '#c83c30', cap: '#c83c30' } }), 9.5, 8.5], [sp('ld', ['load', 'resist'], { col: { body: '#8a6038', cap: '#c9a26a', barrel: '#5a3a1e' } }), 8.5, 8.5], ['c_ld', 7.5, 8.5], ['c_ld', 6.5, 8.5],
        [sp('enc', ['enchanter', 'still'], { col: { body: '#ff7ad0', cap: '#ffd0f0' } }), 17.5, 4.5], ['red', 15.5, 4.5], ['silver', 19.5, 6.5],
        [sp('tank', ['multi2', 'still'], { hp: 6, col: { body: '#3a9a44', cap: '#7ed38a' } }), 20.5, 11.5], [sp('las', ['laser', 'still'], { col: { body: '#30303a', cap: '#ff3c78', barrel: '#ff3c78' } }), 14.5, 1.5], ['c_tank', 4.5, 2.5]];
      UI.page(null); Game.playCustom(L, () => {}); Game.debug.skipIntro(); Game.debug.tanks.slice(1).forEach(t => { t.ai.fireT = 999; t.ai.charge = 999; });
      const D = Game.debug; for (let i = 0; i < 90; i++) D.tick(1 / 60);
      const las = D.tanks[9]; las.turret = Math.atan2(D.player.y - las.y, D.player.x - las.x) + 0.25; las.beamT = 1.5; las.beamHits = new Map();
      D.tanks[10].frozen = 14; D.player.frozen = 0; D.hitTank(D.tanks[8], { owner: D.player, kind: 'shell' });
      D.tanks[1].shells = 0; D.fire(D.tanks[1]);
    })()""")
    cdp.pump(0.05); shot("20f-powers-play")
    print("errors:", E("window.__errs"))
finally:
    harness.kill_chrome(proc); srv.terminate()
