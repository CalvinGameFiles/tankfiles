"""Multiplayer round 2: two weapons each, 10 tank models, X colour, BATTLE / SLAYER / SLAUGHTER, TEAMS, the leaderboard.
python -I debug/versus2.py   (screenshots in debug/shots/v2-*.png)"""
import os, sys, time, base64, subprocess, socket, json
sys.path.insert(0, r"C:\Users\JesusFam\slayerfiles-debug")
import harness
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE)
s = socket.socket(); s.bind(("127.0.0.1", 0)); port = s.getsockname()[1]; s.close()
srv = subprocess.Popen(["node", "server.js"], cwd=ROOT, env={**os.environ, "PORT": str(port), "HOST": "127.0.0.1"}, stdout=subprocess.DEVNULL)
time.sleep(0.8)
proc, cdp = harness.launch_chrome("chrome-tankfiles-v2")
E = cdp.eval
fails = 0
def check(name, ok, extra=''):
    global fails
    print(('PASS ' if ok else 'FAIL ') + name + (('  ' + str(extra)) if extra != '' else ''))
    if not ok: fails += 1
def shot(name):
    r = cdp.send("Page.captureScreenshot", {"format": "png"})
    open(os.path.join(HERE, "shots", name + ".png"), "wb").write(base64.b64decode(r["result"]["data"]))
def J(x): return json.loads(E(f"JSON.stringify({x})"))
try:
    cdp.send("Emulation.setDeviceMetricsOverride", {"width": 915, "height": 412, "deviceScaleFactor": 1, "mobile": False})
    cdp.send("Page.navigate", {"url": f"http://127.0.0.1:{port}/"}); cdp.pump(1.2)
    E("localStorage.clear()"); cdp.send("Page.reload", {}); cdp.pump(1.2)
    E("window.__errs = []; window.addEventListener('error', e => window.__errs.push(e.message + ' @' + e.lineno))")

    # ---- PREPARE: models, weapons, X colour
    E("document.getElementById('multiBtn').click()"); cdp.pump(0.4)
    E("document.getElementById('mpSplit').click()"); cdp.pump(0.6)
    check('10 model buttons', E("document.querySelectorAll('#ppModels .pp-model').length") == 10)
    check('7 weapons in each slot', E("[document.querySelectorAll('#ppW1 .tm-pow').length, document.querySelectorAll('#ppW2 .tm-pow').length].join()") == '7,7')
    E("document.querySelector('#ppModels [data-model=\"3\"]').click()"); cdp.pump(0.2)
    E("document.querySelector('#ppW1 [data-weapon=\"flame\"]').click()"); cdp.pump(0.1)
    E("document.querySelector('#ppW2 [data-weapon=\"laser\"]').click()"); cdp.pump(0.1)
    E("document.querySelector('#ppX [data-x=\"#3ad15a\"]').click()"); cdp.pump(0.2)
    sp = J("Versus.pp.spec")
    check('spec model/weapons/xcol', sp['model'] == 3 and sp['weapons'] == ['flame', 'laser'] and sp['xcol'] == '#3ad15a', sp)
    E("document.querySelector('#ppW2 [data-weapon=\"flame\"]').click()"); cdp.pump(0.1)
    check('picking the other slot swaps', J("Versus.pp.spec.weapons") == ['laser', 'flame'])
    E("document.querySelector('#ppW1 [data-weapon=\"flame\"]').click()"); E("document.querySelector('#ppW2 [data-weapon=\"bouncy\"]').click()"); cdp.pump(0.2)
    shot('v2-prepare')
    E("document.querySelector('#ppPowers').scrollIntoView()"); cdp.pump(0.2); shot('v2-prepare2')
    # old saved tank with a weapon in its powers migrates
    old = J("Versus.cleanSpec({ name: 'OLD', powers: ['homing', 'mines', 'life'] })")
    check('old spec migrates', old['weapons'][0] == 'homing' and old['powers'] == ['mines'] and old['model'] == 0, old)
    E("document.getElementById('ppReady').click()"); cdp.pump(0.3)
    E("document.querySelector('#ppModels [data-model=\"7\"]').click()"); E("document.querySelector('#ppW1 [data-weapon=\"bouncy\"]').click()"); E("document.querySelector('#ppW2 [data-weapon=\"homing\"]').click()"); cdp.pump(0.1)
    E("document.getElementById('ppReady').click()"); cdp.pump(0.5)
    check('split page shows rules', 'BATTLE' in E("document.getElementById('ssRulesText').textContent"))

    # ---- rules popup (split: no teams)
    E("document.getElementById('ssRules').click()"); cdp.pump(0.3)
    E("document.querySelector('[data-rule=\"mode-slayer\"]').click()"); cdp.pump(0.1)
    for _ in range(30): E("document.querySelector('[data-rule=\"kills\"] [data-step=\"+\"]').click()")
    check('kills capped at 100', J("Versus.rp.rules.kills") == 100)
    for _ in range(19): E("document.querySelector('[data-rule=\"kills\"] [data-step=\"-\"]').click()")
    check('kills floor 10, steps of 5', J("Versus.rp.rules.kills") == 10)
    for _ in range(9): E("document.querySelector('[data-rule=\"stime\"] [data-step=\"+\"]').click()")
    check('slayer time goes to NO LIMIT', J("Versus.rp.rules.slayerTime") == 0)
    E("document.querySelector('[data-rule=\"mode-battle\"]').click()")
    for _ in range(12): E("document.querySelector('[data-rule=\"lives\"] [data-step=\"+\"]').click()")
    check('lives capped at 10', J("Versus.rp.rules.lives") == 10)
    shot('v2-rules')
    E("document.querySelector('[data-rule=\"mode-slaughter\"]').click()"); cdp.pump(0.1)
    for _ in range(4): E("document.querySelector('[data-rule=\"ttime\"] [data-step=\"-\"]').click()")
    check('slaughter time floor 1', J("Versus.rp.rules.slaughterTime") == 1)
    E("document.getElementById('rulesDone').click()"); cdp.pump(0.3)
    check('split rules saved', 'SLAUGHTER' in E("document.getElementById('ssRulesText').textContent"))

    # ---- split battle: SLAUGHTER 1 min, two weapons each
    E("document.getElementById('ssGo').click()"); cdp.pump(3.0)
    vi = J("Game.vsInfo")
    check('split started slaughter', vi['state'] == 'playing' and vi['rules']['mode'] == 'slaughter' and 50 < vi['timeLeft'] <= 60, (vi['state'], vi['timeLeft']))
    check('models + weapons in game', vi['players'][0]['model'] == 3 and vi['players'][0]['weapons'] == ['flame', 'bouncy'] and vi['players'][1]['weapons'] == ['bouncy', 'homing'], [p['weapons'] for p in vi['players']])
    # red: bouncy rockets, only 2 flying at once
    E("(() => { const t = Game.debug.tanks[1]; t.turret = Math.PI; })()")
    n = J("(() => { const P = Game.debug.vs.players[1]; let n = 0; for (let i = 0; i < 6; i++) { P.tank.fireCD = 0; if (Game.debug.act(P, 'fire')) n++; } return n; })()")
    check('only 2 bouncy rockets at once', n == 2, n)
    n2 = J("(() => { const P = Game.debug.vs.players[1]; let n = 0; for (let i = 0; i < 6; i++) { P.tank.fireCD = 0; if (Game.debug.act(P, 'fire2')) n++; } return n; })()")
    check('weapon 2 (heat seekers) has its own count', n2 == 3, n2)
    check('shells tagged by slot', J("Game.debug.shells.filter(s => s.owner === Game.debug.tanks[1]).map(s => s.slot).sort().join()") == '0,0,1,1,1')
    # blue: flame (weapon 1) + bouncy (weapon 2) via keys
    E("Game.debug.tanks[0].fireCD = 0")
    cdp.send("Input.dispatchKeyEvent", {"type": "keyDown", "code": "KeyF", "key": "f"}); cdp.send("Input.dispatchKeyEvent", {"type": "keyUp", "code": "KeyF", "key": "f"}); cdp.pump(0.2)
    cdp.send("Input.dispatchKeyEvent", {"type": "keyDown", "code": "KeyR", "key": "r"}); cdp.send("Input.dispatchKeyEvent", {"type": "keyUp", "code": "KeyR", "key": "r"}); cdp.pump(0.05)
    fl = J("Game.debug.shells.filter(s => s.owner === Game.debug.tanks[0]).map(s => s.flame ? 'f' : s.rocket ? 'r' : 's').sort().join('')")
    check('blue F = flame, R = bouncy', 'f' in fl and 'r' in fl, fl)
    shot('v2-split')
    # leaderboard: Tab opens, Tab closes
    E("Game.debug.vs.players[1].kills = 4; Game.debug.vs.players[0].kills = 2")
    cdp.send("Input.dispatchKeyEvent", {"type": "keyDown", "code": "Tab", "key": "Tab"}); cdp.send("Input.dispatchKeyEvent", {"type": "keyUp", "code": "Tab", "key": "Tab"}); cdp.pump(0.6)
    check('leaderboard slides out', J("Game.vsInfo.lb.k") > 0.95)
    check('ranking by kills', J("Game.debug.ranking()")[0] == 'PLAYER 2', J("Game.debug.ranking()"))
    shot('v2-board-split')
    # tap the tab to close (mouse is allowed on the tab even in split screen)
    tab = J("Game.debug.vsRects().lbTab")
    x, y = tab['x'] + tab['w'] / 2, tab['y'] + tab['h'] / 2
    cdp.send("Input.dispatchMouseEvent", {"type": "mousePressed", "x": x, "y": y, "button": "left", "clickCount": 1}); cdp.send("Input.dispatchMouseEvent", {"type": "mouseReleased", "x": x, "y": y, "button": "left", "clickCount": 1}); cdp.pump(0.6)
    check('tapping the tab closes it', J("Game.vsInfo.lb.k") < 0.05)
    # time runs out -> most kills wins
    E("Game.debug.vs.timeLeft = 0.2"); cdp.pump(0.8)
    vi = J("Game.vsInfo")
    check('slaughter: time up, most kills wins', vi['state'] == 'over' and vi['winnerName'] == 'PLAYER 2', (vi['state'], vi['winnerName']))
    cdp.pump(5.0)
    check('back to split page', E("document.getElementById('splitset').classList.contains('active')"))

    # ---- engine: SLAYER with 4 players in 2 teams (team kills add up, no friendly fire, X colour)
    L = "LEVELS[2]"
    E(f"""Game.stop(); UI.page(null); Game.versus({{ role: 'local', L: {L}, rules: {{ mode: 'slayer', kills: 10, slayerTime: 0, teams: 2 }},
        players: [0,1,2,3].map(i => ({{ id: 'p' + i, name: 'P' + i, slot: i, team: i % 2, spec: {{ model: i * 2, weapons: ['shell', 'rocket'], xcol: '#ff00ff', col: {{}} }} }})) }})""")
    cdp.pump(3.0)
    T = "Game.debug.tanks"
    ff = J(f"(() => {{ const a = {T}[0], b = {T}[2]; b.spawnT = 0; b.x = a.x + 60; b.y = a.y; return [Game.debug.hitTank ? 1 : 0, b.alive]; }})()")
    # a team mate's shell passes straight through
    E(f"(() => {{ const a = {T}[0], b = {T}[2]; b.spawnT = 0; Game.debug.shells.push({{ id: 9999, x: b.x, y: b.y, h: b.h, vx: 1, vy: 0, bounces: 0, maxB: 1, owner: a, age: 1, slot: 0 }}); a.out[0]++; a.shells++; }})()")
    cdp.pump(0.15)
    check('no friendly fire', J(f"{T}[2].alive"))
    E(f"(() => {{ for (let i = 0; i < 9; i++) {{ const v = {T}[1]; v.alive = true; v.spawnT = 0; Game.debug.killTank(v, {T}[0]); }} }})()")
    vi = J("Game.vsInfo")
    check('kills counted, nobody has lives in slayer', vi['players'][0]['kills'] == 9 and vi['state'] == 'playing', [p['kills'] for p in vi['players']])
    E(f"(() => {{ const v = {T}[3]; v.alive = true; v.spawnT = 0; Game.debug.killTank(v, {T}[2]); }})()")
    vi = J("Game.vsInfo")
    check('team total reaches 10 -> BLUE TEAM wins', vi['state'] == 'over' and vi['winnerName'] == 'BLUE TEAM', (vi['state'], vi['winnerName']))
    check('X mark in the chosen colour', J("Game.debug.xmarks.length") > 0 and J("Game.debug.xmarks[0].color") == '#ff00ff')
    E("Game.debug.lb.open = true"); cdp.pump(0.6); shot('v2-board-teams')
    E("Game.debug.lb.open = false")

    # ---- BATTLE 2 lives: out after 2 deaths, respawns once
    E(f"""Game.stop(); Game.versus({{ role: 'local', L: {L}, rules: {{ mode: 'battle', lives: 2 }},
        players: [0,1,2].map(i => ({{ id: 'p' + i, name: 'P' + i, slot: i, spec: {{ model: 5 + i, weapons: ['laser', 'frost'] }} }})) }})""")
    cdp.pump(3.0)
    check('battle lives from the rules', J("Game.vsInfo.players.map(p => p.lives).join()") == '2,2,2')
    E(f"Game.debug.killTank({T}[1], {T}[0])"); cdp.pump(3.0)
    check('respawned with 1 life left', J(f"{T}[1].alive") and J("Game.vsInfo.players[1].lives") == 1)
    E(f"{T}[1].spawnT = 0; Game.debug.killTank({T}[1], {T}[0])"); cdp.pump(3.0)
    check('out of lives stays dead', not J(f"{T}[1].alive"))
    E(f"Game.debug.killTank({T}[2], {T}[0])"); cdp.pump(3.0); E(f"{T}[2].spawnT = 0; Game.debug.killTank({T}[2], {T}[0])"); cdp.pump(0.3)
    check('last tank standing wins', J("Game.vsInfo.winnerName") == 'P0')
    # all 10 models on the field for a picture
    E(f"""Game.stop(); Game.versus({{ role: 'local', L: LEVELS[87], rules: {{ mode: 'slaughter', slaughterTime: 3 }},
        players: [...Array(10)].map((_, i) => ({{ id: 'p' + i, name: TANK_MODELS[i].label, slot: i, spec: {{ model: i, weapons: i % 2 ? ['laser', 'flame'] : ['shell', 'rocket'], col: Object.assign({{}}, BLANK_TANK_COLS, {{ body: FLAG_COLORS[i][1], cap: FLAG_COLORS[i][1] }}) }} }})) }})""")
    cdp.pump(3.0)
    E("Game.debug.tanks.forEach((t, i) => { t.x = 120 + (i % 5) * 120; t.y = 140 + Math.floor(i / 5) * 140; t.hull = 0.3; t.turret = -0.5; })"); cdp.pump(0.3)
    shot('v2-models')
    E("Game.debug.vs.players.forEach((P, i) => P.kills = 10 - i); Game.debug.lb.open = true"); cdp.pump(0.6); shot('v2-board-10')
    E("Game.stop()")

    # ---- LOCAL lobby with teams (network stubbed)
    E("Net.host = async () => {}; Net.broadcast = () => {}; Net.send = () => {}; Net.kick = () => {}; Store.setNet('name', 'HOST'); Store.setNet('tank', Versus.newSpec(0))")
    E("Versus.hostGame()"); cdp.pump(0.6)
    for i in range(7): E(f"Net.onMessage('g{i}', {{ t: 'joined', name: 'GUEST{i}', spec: {{ model: {i}, weapons: ['rocket', 'laser'] }} }})")
    cdp.pump(0.3)
    check('8 in the lobby', J("Versus.lobby.players.length") == 8)
    E("Versus.lobby.rules.teams = 4; Versus.lobby.players.forEach(p => p.team = 0); document.getElementById('lbRules').click()"); cdp.pump(0.3)
    check('4 TEAMS allowed with 8', not E("document.querySelector('[data-rule=\"teams-4\"]').classList.contains('off')"))
    check('5 TEAMS not allowed with 8', E("document.querySelector('[data-rule=\"teams-5\"]').classList.contains('off')"))
    E("document.getElementById('rulesDone').click()"); cdp.pump(0.3)
    check('uneven teams lock START', E("document.getElementById('lbStart').classList.contains('locked')"), E("document.getElementById('lbWait').textContent"))
    E("Versus.lobby.players.forEach((p, i) => p.team = i % 4); Versus.openLobby()"); cdp.pump(0.3)
    check('even teams unlock START', not E("document.getElementById('lbStart').classList.contains('locked')"), E("document.getElementById('lbWait').textContent"))
    check('team buttons shown', E("document.querySelectorAll('#lbTeams .lb-team').length") == 4)
    E("Net.onMessage('g0', { t: 'team', team: 2 })"); cdp.pump(0.2)
    check('full team refuses a switch', J("Versus.lobby.players.find(p => p.id === 'g0').team") == 1)
    shot('v2-lobby')
    E("document.getElementById('lbStart').click()"); cdp.pump(3.0)
    vi = J("Game.vsInfo")
    check('team battle started', vi and vi['rules']['teams'] == 4 and sorted(set(p['team'] for p in vi['players'])) == [0, 1, 2, 3], vi and vi['rules'])
    shot('v2-team-battle')
    E("Game.debug.lb.open = true"); cdp.pump(0.6); shot('v2-team-board')
    errs = J("window.__errs")
    check('no JS errors', not errs, errs)
finally:
    print('FAILS', fails)
    try: cdp.close()
    except Exception: pass
    proc.kill(); srv.kill()
