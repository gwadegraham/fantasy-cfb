#!/usr/bin/env python3
"""Rasterize the Campus Clash Hardwood basketball favicon at true 1x, no deps.

    python3 design/tools/render_hardwood_icon.py

Sibling to render.py, which does the same for the Gridiron football. Geometry
mirrors images/favicon-hardwood.svg exactly: a disc of radius 14.6 in a 32-unit
box, a centred 2-unit navy outline, and four seams -- vertical, horizontal, and
two mirrored cubics -- clipped to the disc.

SEAM COLOUR IS NAVY, NOT CREAM, and that is deliberate even though the crest's
basketball uses cream seams and this file's football sibling uses cream laces.
Cream reads fine on the crest's red at crest scale; on Hardwood orange at 16px
it washes out, because orange is the lighter fill (contrast 7.05 against the
page ground versus red's 5.39). Navy seams are also what a real basketball has.
Rendering all six candidate seam treatments at 16px and comparing was the only
way to settle this -- cream lost clearly, and dropping seams to reduce clutter
made the ball read as a beach ball (vertical + curves) or a globe
(vertical + horizontal). All four seams survive at 16px; do not "simplify" them.

Note the asymmetry with render.py, which DROPS the football's laces at 16px.
That is not an inconsistency: the football's silhouette carries recognition on
its own, so detail is expendable. A disc's silhouette carries nothing, so the
seams are the only thing identifying the sport and have to stay.

Antialiasing comes from an analytic signed-distance field rather than
supersampling, so a 16px raster here is what a browser would produce. The
outline is a CENTRED stroke, so the drawn disc extends STROKE/2 beyond radius
and the alpha ramp keys to that, not to the radius itself.
"""
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pngio

VIEW = 32.0
CX = CY = 16.0
R = 14.6
STROKE = 2.0
SEAM_W = 1.6
ORANGE = (0xF0, 0x83, 0x3F)
NAVY = (0x10, 0x13, 0x22)


def _cubic(p0, p1, p2, p3, n=40):
    out = []
    for i in range(n + 1):
        t = i / n
        u = 1 - t
        out.append((u ** 3 * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t ** 3 * p3[0],
                    u ** 3 * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t ** 3 * p3[1]))
    return out


def seams():
    """The four seams as polylines. Endpoints sit exactly on the disc edge."""
    k, yb, c, m = 0.72 * R, 0.695 * R, 0.52 * R, 0.36 * R
    return [
        [(CX, CY - R), (CX, CY + R)],
        [(CX - R, CY), (CX + R, CY)],
        _cubic((CX - k, CY - yb), (CX - c, CY - m), (CX - c, CY + m), (CX - k, CY + yb)),
        _cubic((CX + k, CY - yb), (CX + c, CY - m), (CX + c, CY + m), (CX + k, CY + yb)),
    ]


def _seg_dist(px, py, a, b):
    vx, vy = b[0] - a[0], b[1] - a[1]
    wx, wy = px - a[0], py - a[1]
    L2 = vx * vx + vy * vy
    t = 0.0 if L2 == 0 else max(0.0, min(1.0, (wx * vx + wy * vy) / L2))
    return math.hypot(px - (a[0] + t * vx), py - (a[1] + t * vy))


def render(size, opaque=False):
    """`opaque` renders the home-screen variant: navy plate, no outline.

    iOS ignores alpha on home-screen icons and squares off the corners itself,
    so a transparent export gets composited onto whatever the OS picks. The
    outline is dropped with it -- navy-on-navy draws nothing, and keeping it
    only eats radius. This mirrors the football's apple-touch-icon.
    """
    curves = seams()
    scale = VIEW / size
    half = 0.0 if opaque else STROKE / 2.0
    rows = []
    for y in range(size):
        row = []
        for x in range(size):
            px, py = (x + 0.5) * scale, (y + 0.5) * scale
            d = R - math.hypot(px - CX, py - CY)          # positive inside the disc
            alpha = max(0.0, min(1.0, (d + half) / scale + 0.5))
            if alpha <= 0.0:
                row.append(NAVY + (255,) if opaque else (0, 0, 0, 0))
                continue
            fill_t = max(0.0, min(1.0, (d - half) / scale + 0.5))   # 0 = outline, 1 = fill
            col = [NAVY[i] + (ORANGE[i] - NAVY[i]) * fill_t for i in range(3)]
            if fill_t > 0.0:                                         # seams only inside the fill
                sd = min(min(_seg_dist(px, py, c[i], c[i + 1]) for i in range(len(c) - 1))
                         for c in curves)
                seam_t = max(0.0, min(1.0, (sd - SEAM_W / 2.0) / scale + 0.5))
                col = [NAVY[i] + (col[i] - NAVY[i]) * seam_t for i in range(3)]
            if opaque:
                # composite the antialiased disc edge onto the navy plate
                col = [NAVY[i] + (col[i] - NAVY[i]) * alpha for i in range(3)]
                alpha = 1.0
            row.append((round(col[0]), round(col[1]), round(col[2]), round(alpha * 255)))
        rows.append(row)
    return rows


def main():
    root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    out = os.path.join(root, 'images')
    for size, name, opaque in [(16, 'favicon-hardwood-16.png', False),
                               (32, 'favicon-hardwood-32.png', False),
                               (180, 'apple-touch-icon-hardwood.png', True)]:
        path = os.path.join(out, name)
        pngio.write_png(path, render(size, opaque))
        print(f'{name:<34} {size}x{size}  {os.path.getsize(path):,} bytes'
              f'{"  (opaque navy plate)" if opaque else ""}')


if __name__ == '__main__':
    main()
