"""Validate a drawn level grid: every row the same width, a border of stone, one P, and every enemy can reach the player
by driving (wood and white count as walls; ~ water is slow ground; silver platforms only join the ground through a / ramp; light browns, greens and T turrets never move so they may be sealed in; O = oil bomber, F = orange flame tank, N = dark pine green). Prints the grid with unreachable squares marked.
Usage: python scripts/check-maze.py  (edits the GRID below, or import check(grid))"""
from collections import deque
TANKS = 'DBCYRGUHKTOFN'

def check(grid):
    w = len(grid[0]); problems = []
    for i, row in enumerate(grid):
        if len(row) != w: problems.append(f"row {i} is {len(row)} wide, not {w}")
    h = len(grid)
    for c in range(w):
        if grid[0][c] != '#' or grid[h - 1][c] != '#': problems.append(f"border open at col {c}")
    for r in range(h):
        if grid[r][0] != '#' or grid[r][-1] != '#': problems.append(f"border open at row {r}")
    P = [(c, r) for r in range(h) for c in range(w) if grid[r][c] in 'Pp']
    if len(P) != 1: problems.append(f"{len(P)} players")
    # levels: F = ground (floor and tanks on it), U = up on a silver platform (S, or a lowercase tank letter), R = ramp (joins both)
    def kind(ch):
        if ch in '#WwL': return None           # L = lava: a wall to every tank but the black, which never needs a path
        if ch == '/': return 'R'
        if ch == 'S' or (ch.islower() and ch != 'w'): return 'U'
        return 'F'
    drive = lambda c, r: kind(grid[r][c]) is not None
    step = lambda a, b: kind(b) is not None and {kind(a), kind(b)} != {'F', 'U'}
    seen = set(); q = deque(P)
    while q:
        c, r = q.popleft()
        if (c, r) in seen: continue
        seen.add((c, r))
        for dc, dr in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            nc, nr = c + dc, r + dr
            if 0 <= nc < w and 0 <= nr < h and step(grid[r][c], grid[nr][nc]) and (nc, nr) not in seen: q.append((nc, nr))
    enemies = [(c, r) for r in range(h) for c in range(w) if grid[r][c].upper() in TANKS and grid[r][c] != 'w']
    for e in enemies:
        if e not in seen and grid[e[1]][e[0]].upper() not in 'BGKT': problems.append(f"enemy {grid[e[1]][e[0]]} at {e} cannot reach the player")
    floor = [(c, r) for r in range(h) for c in range(w) if drive(c, r)]
    dead = [f for f in floor if f not in seen]
    print(f"{w}x{h}, {len(enemies)} enemies, {len(floor)} drivable squares, {len(dead)} unreachable")
    for r in range(h): print(''.join('?' if (c, r) in dead else grid[r][c] for c in range(w)))
    for p in problems: print("PROBLEM:", p)
    return not problems

if __name__ == '__main__':
    import sys, re, json
    src = open('www/js/levels.js', encoding='utf-8').read()
    for m in re.finditer(r"grid:\s*\[([^\]]*)\]", src):
        rows = re.findall(r"'([^']*)'", m.group(1))
        check(rows); print()
