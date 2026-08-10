#!/usr/bin/env python3
"""Build the 1200x630 social share image from a horizontal lockup master.

    python3 design/tools/make_og.py design/brand/<lockup>.png images/campus-clash-og.png

The lockup arrives with its navy knocked out to transparency, so it is
composited onto the page navy BEFORE downscaling -- resampling straight RGBA
would pull the transparent background into the edge pixels and fringe every
letter. Area-average downscale, then centred on the canvas.
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pngio, remap

W, H = 1200, 630            # the size every unfurler expects
LOCKUP_W = 880              # ~73% of canvas width: reads at preview scale
NAVY = (0x10, 0x13, 0x22)   # --cc-bg


def resize(rows, tw, th):
    """Area-average downscale. Input must be opaque."""
    sh, sw = len(rows), len(rows[0])
    out = []
    for y in range(th):
        y0, y1 = y * sh / th, (y + 1) * sh / th
        iy0, iy1 = int(y0), min(sh, int(y1 - 1e-9) + 1)
        line = []
        for x in range(tw):
            x0, x1 = x * sw / tw, (x + 1) * sw / tw
            ix0, ix1 = int(x0), min(sw, int(x1 - 1e-9) + 1)
            acc = [0.0, 0.0, 0.0]
            tot = 0.0
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
                    p = srow[sx]
                    acc[0] += p[0] * w
                    acc[1] += p[1] * w
                    acc[2] += p[2] * w
                    tot += w
            line.append(tuple(int(round(c / tot)) for c in acc) + (255,))
        out.append(line)
    return out


def build(src, dst):
    w, h, art = pngio.read_png(src)
    tw = LOCKUP_W
    th = round(h * tw / w)
    small = resize(remap.flatten(art, NAVY), tw, th)

    canvas = [[(NAVY[0], NAVY[1], NAVY[2], 255)] * W for _ in range(H)]
    ox, oy = (W - tw) // 2, (H - th) // 2
    for y, row in enumerate(small):
        canvas[oy + y][ox:ox + tw] = row
    pngio.write_png(dst, canvas)
    return tw, th, ox, oy


if __name__ == '__main__':
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    tw, th, ox, oy = build(sys.argv[1], sys.argv[2])
    print('%s -> %s  (%dx%d canvas, lockup %dx%d at %d,%d)'
          % (sys.argv[1], sys.argv[2], W, H, tw, th, ox, oy))
