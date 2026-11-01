# 애드인 아이콘 생성: 왼쪽 Claude풍 주황 별꽃, 오른쪽 Codex풍 검은 터미널(>_) 타일을 나란히 배치
import math, sys
from PIL import Image, ImageDraw

OUT = sys.argv[1]
S = 8  # 8배로 그린 뒤 줄여서 계단 현상을 없앤다

def spark(d, cx, cy, r, color, rays=12):
    for i in range(rays):
        a = math.pi * 2 * i / rays
        w = r * 0.13
        tip = (cx + math.cos(a) * r, cy + math.sin(a) * r)
        l = (cx + math.cos(a + math.pi / 2) * w, cy + math.sin(a + math.pi / 2) * w)
        rr = (cx + math.cos(a - math.pi / 2) * w, cy + math.sin(a - math.pi / 2) * w)
        d.polygon([l, tip, rr], fill=color)
    d.ellipse([cx - r * 0.22, cy - r * 0.22, cx + r * 0.22, cy + r * 0.22], fill=color)

def icon(px):
    n = px * S
    im = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    gap = n * 0.04
    tile = (n - gap) / 2
    top = (n - tile) / 2
    rad = tile * 0.24
    # 왼쪽: 크림 바탕 + 주황 별꽃
    d.rounded_rectangle([0, top, tile, top + tile], rad, fill=(250, 240, 230, 255))
    spark(d, tile / 2, top + tile / 2, tile * 0.40, (217, 119, 87, 255))
    # 오른쪽: 검은 바탕 + 흰 >_
    x0 = tile + gap
    d.rounded_rectangle([x0, top, n, top + tile], rad, fill=(17, 17, 17, 255))
    lw = max(S, int(tile * 0.11))
    cx, cy = x0 + tile * 0.30, top + tile * 0.5
    d.line([(cx, cy - tile * 0.17), (cx + tile * 0.17, cy), (cx, cy + tile * 0.17)], fill="white", width=lw, joint="curve")
    d.line([(x0 + tile * 0.52, cy + tile * 0.17), (x0 + tile * 0.76, cy + tile * 0.17)], fill="white", width=lw)
    return im.resize((px, px), Image.LANCZOS)

for px in (16, 32, 64, 80, 128):
    icon(px).save(f"{OUT}/icon-{px}.png")
print("ok")
