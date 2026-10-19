#!/usr/bin/env python3
"""Build a 1200x630 social share image from a tall crest (#321).

The masters are the vector crests in design/brand/. Nothing in design/tools
rasterizes SVG, so render one at 2x with headless Chrome first, on a
transparent background at the SVG's own width/height (crest-hardwood.svg is
1095x1437, crest-parent.svg 1024x1414 -- set --window-size to match), then fit
it here:

    echo "<style>html,body{margin:0;background:transparent}img{display:block}</style>\
<img src='file://$PWD/design/brand/crest-hardwood.svg'>" \
        > /tmp/crest.html
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new \
        --allow-file-access-from-files --default-background-color=00000000 \
        --force-device-scale-factor=2 --window-size=1095,1437 \
        --screenshot=/tmp/crest-2x.png file:///tmp/crest.html

    python3 design/tools/make_badge_og.py /tmp/crest-2x.png images/hardwood-og.png F0833F

Two cards ship from this: images/hardwood-og.png (crest-hardwood.svg, glow
F0833F, for /hardwood) and images/campus-clash-parent-og.png (crest-parent.svg,
glow C9CEE6 = --cc-muted-bright, for the logged-out root at server.js).

make_og.py centres a horizontal lockup, and only football has one (#321
deliberately skipped a Hardwood one). The badge is tall, so it is fitted to the
canvas HEIGHT instead and centred, over the page navy with a soft glow in the
sport's accent. No text on the image: every unfurler prints the page's
og:title and og:description beside it, and a centred badge survives the
square crop some apps (WhatsApp, some Slack layouts) apply.

The badge keeps its alpha through the downscale (premultiplied average, from
make_crest.py) and is composited over the glow, rather than flattened onto
plain navy first, which would leave a navy box around it.
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pngio
from make_crest import resize_rgba

W, H = 1200, 630            # the size every unfurler expects
BADGE_H = 560               # ~89% of the height, a 35px margin top and bottom
NAVY = (0x10, 0x13, 0x22)   # --cc-bg
GLOW = 0.30                 # accent strength at the centre of the glow


def hex_rgb(s):
    s = s.lstrip('#')
    return tuple(int(s[i:i + 2], 16) for i in (0, 2, 4))


def background(accent):
    """Navy, warmed toward the accent in a soft ellipse behind the badge."""
    cx, cy = W / 2, H / 2
    rx, ry = W * 0.42, H * 0.62
    rows = []
    for y in range(H):
        line = []
        dy = (y - cy) / ry
        for x in range(W):
            dx = (x - cx) / rx
            d = (dx * dx + dy * dy) ** 0.5
            t = GLOW * max(0.0, 1.0 - d) ** 2
            line.append(tuple(int(round(NAVY[i] + (accent[i] - NAVY[i]) * t)) for i in range(3)) + (255,))
        rows.append(line)
    return rows


def build(src, dst, accent_hex):
    w, h, art = pngio.read_png(src)
    th = BADGE_H
    tw = round(w * th / h)
    small = resize_rgba(art, tw, th)
    canvas = background(hex_rgb(accent_hex))
    ox, oy = (W - tw) // 2, (H - th) // 2
    for y, row in enumerate(small):
        out = canvas[oy + y]
        for x, (r, g, b, a) in enumerate(row):
            if a == 0:
                continue
            br, bg, bb, _ = out[ox + x]
            f = a / 255.0
            out[ox + x] = (int(round(r * f + br * (1 - f))), int(round(g * f + bg * (1 - f))),
                           int(round(b * f + bb * (1 - f))), 255)
    pngio.write_png(dst, canvas)
    return tw, th, ox, oy


if __name__ == '__main__':
    if len(sys.argv) != 4:
        sys.exit(__doc__)
    tw, th, ox, oy = build(sys.argv[1], sys.argv[2], sys.argv[3])
    print('%s -> %s  (%dx%d canvas, badge %dx%d at %d,%d)'
          % (sys.argv[1], sys.argv[2], W, H, tw, th, ox, oy))
