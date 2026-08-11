#!/usr/bin/env python3
"""Export a web-sized, transparent crest from a badge master.

    python3 design/tools/make_crest.py design/brand/campus-clash-badge.png \
        /tmp/crest-720.png 720
    cwebp -q 88 -alpha_q 100 -m 6 /tmp/crest-720.png -o images/campus-clash-badge-720.webp

Two steps because this file stays dependency-free like the rest of design/tools,
while the shipped asset wants WebP. The badge's grain defeats PNG -- 720px wide
lands at ~333KB, barely under the 1024px master -- where lossy WebP at q88 is
~82KB and visually identical on flat art. Only the .webp goes in images/; the
PNG is a throwaway intermediate. (Lossless WebP is ~202KB, not worth 2.5x.)

The login screen sits the crest on a panel that already carries a gradient
wash, so unlike make_og.py this CANNOT flatten onto a background colour -- the
alpha has to survive. That rules out remap.halve() too: it averages straight
RGBA, and remap() writes (0,0,0,0) for transparent pixels, so every antialiased
edge would pull black in and rim the art. Averaging happens in PREMULTIPLIED
space instead, then unpremultiplies, which is the only way edge pixels keep
their colour as they fade out.
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pngio


def resize_rgba(rows, tw, th):
    """Area-average downscale preserving alpha. Colour is averaged weighted by
    alpha (premultiplied), so fully transparent pixels contribute no colour."""
    sh, sw = len(rows), len(rows[0])
    out = []
    for y in range(th):
        y0, y1 = y * sh / th, (y + 1) * sh / th
        iy0, iy1 = int(y0), min(sh, int(y1 - 1e-9) + 1)
        line = []
        for x in range(tw):
            x0, x1 = x * sw / tw, (x + 1) * sw / tw
            ix0, ix1 = int(x0), min(sw, int(x1 - 1e-9) + 1)
            ar = ag = ab = aa = tot = 0.0
            for sy in range(iy0, iy1):
                wy = min(sy + 1, y1) - max(sy, y0)
                if wy <= 0:
                    continue
                srow = rows[sy]
                for sx in range(ix0, ix1):
                    wx = min(sx + 1, x1) - max(sx, x0)
                    if wx <= 0:
                        continue
                    w = wx * wy
                    r, g, b, a = srow[sx]
                    af = a / 255.0
                    ar += r * af * w
                    ag += g * af * w
                    ab += b * af * w
                    aa += af * w
                    tot += w
            if aa <= 0:
                line.append((0, 0, 0, 0))
                continue
            line.append((
                max(0, min(255, int(round(ar / aa)))),
                max(0, min(255, int(round(ag / aa)))),
                max(0, min(255, int(round(ab / aa)))),
                max(0, min(255, int(round(aa / tot * 255)))),
            ))
        out.append(line)
    return out


def build(src, dst, tw):
    w, h, art = pngio.read_png(src)
    th = round(h * tw / w)
    pngio.write_png(dst, resize_rgba(art, tw, th))
    return w, h, tw, th


if __name__ == '__main__':
    if len(sys.argv) != 4:
        sys.exit(__doc__)
    sw, sh, tw, th = build(sys.argv[1], sys.argv[2], int(sys.argv[3]))
    print('%s (%dx%d) -> %s (%dx%d)' % (sys.argv[1], sw, sh, sys.argv[2], tw, th))
