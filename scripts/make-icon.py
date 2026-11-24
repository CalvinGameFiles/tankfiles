"""TankFiles app icon: a manila "Files" folder with a top-down blue tank parked on it.
Writes www/img/icon-512.png, icon-192.png, icon.ico and the title tank www/img/title-tank.png.
Run:  python scripts/make-icon.py
"""
import os, math
from PIL import Image, ImageDraw, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
IMG = os.path.join(os.path.dirname(HERE), "www", "img")
os.makedirs(IMG, exist_ok=True)
S = 1024  # draw big, shrink for smooth edges


def rounded(draw, box, r, fill):
    draw.rounded_rectangle(box, r, fill=fill)


def tank(size, body="#2f7df6", dark="#1b4fb0", light="#6aa6ff", angle_deg=-28):
    """Top-down tank on a transparent square. Turret points up before rotation."""
    s = size
    im = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    cx = cy = s / 2
    hw, hh = s * 0.30, s * 0.36          # hull half size
    tw = s * 0.11                          # tread width
    # treads
    for sx in (-1, 1):
        x0 = cx + sx * hw - (tw if sx > 0 else 0)
        d.rounded_rectangle([x0, cy - hh - s * 0.02, x0 + tw, cy + hh + s * 0.02], s * 0.04, fill="#2a2a30")
        for i in range(9):
            y = cy - hh + s * 0.03 + i * (2 * hh / 9)
            d.rectangle([x0 + s * 0.015, y, x0 + tw - s * 0.015, y + s * 0.025], fill="#55555f")
    # hull
    d.rounded_rectangle([cx - hw + tw * 0.6, cy - hh, cx + hw - tw * 0.6, cy + hh], s * 0.06, fill=body)
    d.rounded_rectangle([cx - hw + tw * 0.6, cy - hh, cx + hw - tw * 0.6, cy - hh + s * 0.08], s * 0.03, fill=light)
    d.rounded_rectangle([cx - hw + tw * 0.6, cy + hh - s * 0.10, cx + hw - tw * 0.6, cy + hh], s * 0.03, fill=dark)
    # barrel
    bw = s * 0.07
    d.rounded_rectangle([cx - bw / 2, cy - s * 0.50, cx + bw / 2, cy], bw * 0.3, fill=dark)
    d.rounded_rectangle([cx - bw / 2 - s * 0.012, cy - s * 0.50, cx + bw / 2 + s * 0.012, cy - s * 0.44], bw * 0.3, fill="#2a2a30")
    # turret
    tr = s * 0.17
    d.ellipse([cx - tr, cy - tr, cx + tr, cy + tr], fill=light)
    d.ellipse([cx - tr * 0.75, cy - tr * 0.75, cx + tr * 0.75, cy + tr * 0.75], fill=body)
    d.ellipse([cx - tr * 0.3, cy - tr * 0.5, cx + tr * 0.3, cy + tr * 0.1], fill=light)
    return im.rotate(angle_deg, resample=Image.BICUBIC)


def icon():
    im = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    # background tile with a gradient
    bg = Image.new("RGBA", (S, S))
    bd = ImageDraw.Draw(bg)
    for y in range(S):
        t = y / S
        r = int(22 + (10 - 22) * t); g = int(60 + (28 - 60) * t); b = int(92 + (60 - 92) * t)
        bd.line([(0, y), (S, y)], fill=(r, g, b, 255))
    mask = Image.new("L", (S, S), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, S - 1, S - 1], int(S * 0.22), fill=255)
    im.paste(bg, (0, 0), mask)
    d = ImageDraw.Draw(im)
    # faint arena grid
    for i in range(1, 8):
        p = int(S * i / 8)
        d.line([(p, 0), (p, S)], fill=(255, 255, 255, 14), width=3)
        d.line([(0, p), (S, p)], fill=(255, 255, 255, 14), width=3)
    im.paste(im, (0, 0), mask)
    # folder: back panel + tab, then front panel
    fx0, fy0, fx1, fy1 = S * 0.12, S * 0.30, S * 0.88, S * 0.86
    shadow = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    ImageDraw.Draw(shadow).rounded_rectangle([fx0 + 10, fy0 + 26, fx1 + 10, fy1 + 26], 40, fill=(0, 0, 0, 120))
    shadow = shadow.filter(ImageFilter.GaussianBlur(22))
    im.alpha_composite(shadow)
    d = ImageDraw.Draw(im)
    d.rounded_rectangle([fx0, fy0 - S * 0.07, fx0 + S * 0.30, fy0 + S * 0.10], 30, fill="#c99a3a")   # tab
    d.rounded_rectangle([fx0, fy0, fx1, fy1], 36, fill="#d8a94a")                                   # back
    d.rounded_rectangle([fx0, fy0 + S * 0.10, fx1, fy1], 36, fill="#f0c25c")                        # front
    d.rounded_rectangle([fx0, fy0 + S * 0.10, fx1, fy0 + S * 0.16], 20, fill="#f7d684")              # highlight
    # ricochet shell trail
    pts = [(S * 0.80, S * 0.22), (S * 0.62, S * 0.50), (S * 0.78, S * 0.72)]
    d.line(pts, fill=(255, 255, 255, 170), width=14, joint="curve")
    d.ellipse([pts[2][0] - 26, pts[2][1] - 26, pts[2][0] + 26, pts[2][1] + 26], fill="#ffffff")
    d.ellipse([pts[2][0] - 16, pts[2][1] - 16, pts[2][0] + 16, pts[2][1] + 16], fill="#ffd36a")
    # tank
    t = tank(int(S * 0.62))
    im.alpha_composite(t, (int(S * 0.17), int(S * 0.26)))
    return im


ic = icon()
ic.resize((512, 512), Image.LANCZOS).save(os.path.join(IMG, "icon-512.png"))
ic.resize((192, 192), Image.LANCZOS).save(os.path.join(IMG, "icon-192.png"))
ic.resize((256, 256), Image.LANCZOS).save(os.path.join(IMG, "icon.ico"), sizes=[(256, 256), (128, 128), (64, 64), (48, 48), (32, 32), (16, 16)])
tank(600, angle_deg=0).save(os.path.join(IMG, "title-tank.png"))
print("icons written to", IMG)
