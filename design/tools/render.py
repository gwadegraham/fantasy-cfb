#!/usr/bin/env python3
"""Rasterize the Campus Clash football icon candidates at true 1x, no deps.

Geometry mirrors the SVG exactly: a lens (two mirrored cubics) centred in a
32-unit viewBox, rotated -35 degrees, with capsule laces. Antialiasing comes
from analytic signed-distance fields rather than supersampling, so a 16px
raster here is what a browser would produce.
"""
import math, zlib, struct, bisect, base64, os

L, Q, CX = 15.6, 12.8, 6.55          # lens: half-length, y-control, x-control
H = 0.75 * Q                          # belly half-height (9.6)
STROKE_HALF = 1.0                     # stroke-width 2, centred
THETA = -35.0

RED   = (0xED, 0x58, 0x58)
NAVY  = (0x10, 0x13, 0x22)
CREAM = (0xF4, 0xF6, 0xFB)

SPINE_SOLO = (0.0, 0.0, 7.6, 1.7, 1.7)   # cx, cy, half-w, half-h, radius
SPINE      = (0.0, 0.0, 7.6, 1.4, 1.4)
BARS       = [(x, 0.0, 0.9, 4.0, 0.9) for x in (-6.0, -3.0, 0.0, 3.0, 6.0)]

# ---------------------------------------------------------------- lens profile
# x(t) = (2t-1)[L(1-m) + 3*CX*m],  |y|(t) = 3Q*m,  where m = t(1-t)
_NT, _NG = 40000, 16384
_xs, _ys = [], []
for i in range(_NT + 1):
    t = i / _NT
    m = t * (1.0 - t)
    _xs.append((2.0 * t - 1.0) * (L * (1.0 - m) + 3.0 * CX * m))
    _ys.append(3.0 * Q * m)

_grid = []                            # f(x) sampled uniformly on [-L, L]
for i in range(_NG + 1):
    x = -L + 2.0 * L * i / _NG
    j = min(max(bisect.bisect_left(_xs, x), 1), _NT)
    x0, x1 = _xs[j - 1], _xs[j]
    w = 0.0 if x1 == x0 else (x - x0) / (x1 - x0)
    _grid.append(_ys[j - 1] + w * (_ys[j] - _ys[j - 1]))

_dx = 2.0 * L / _NG

# True distance needs the outline as segments. Flatten both halves, then bucket
# by x so a query only tests the handful of segments near its own column --
# the earlier vertical-offset approximation left lumps at the two tips.
_NS, _NB = 900, 64
_seg = []
for i in range(_NS):
    t0, t1 = i / _NS, (i + 1) / _NS
    m0, m1 = t0 * (1 - t0), t1 * (1 - t1)
    ax = (2 * t0 - 1) * (L * (1 - m0) + 3 * CX * m0)
    bx = (2 * t1 - 1) * (L * (1 - m1) + 3 * CX * m1)
    ay, by = 3 * Q * m0, 3 * Q * m1
    _seg.append((ax, ay, bx, by))     # top half
    _seg.append((ax, -ay, bx, -by))   # bottom half

_buckets = [[] for _ in range(_NB)]
for s in _seg:
    lo = min(s[0], s[2])
    hi = max(s[0], s[2])
    i0 = max(0, min(_NB - 1, int((lo + L) / (2 * L) * _NB)))
    i1 = max(0, min(_NB - 1, int((hi + L) / (2 * L) * _NB)))
    for i in range(i0, i1 + 1):
        _buckets[i].append(s)


def _seg_dist(px, py, s):
    ax, ay, bx, by = s
    vx, vy = bx - ax, by - ay
    wx, wy = px - ax, py - ay
    d2 = vx * vx + vy * vy
    t = 0.0 if d2 == 0.0 else max(0.0, min(1.0, (wx * vx + wy * vy) / d2))
    return math.hypot(wx - t * vx, wy - t * vy)


_slope = []                           # f'(x), for the cheap far-field prefilter
for i in range(_NG + 1):
    a, b = _grid[max(i - 1, 0)], _grid[min(i + 1, _NG)]
    span = (min(i + 1, _NG) - max(i - 1, 0)) * _dx
    _slope.append(max(-40.0, min(40.0, (b - a) / span)) if span else 0.0)

_BW = 2.0 * L / _NB                   # bucket width in x units
_WIN = int(math.ceil(3.5 / _BW))      # cover every segment within 3.5 units of x


def lens_sd(x, y):
    """Signed distance to the lens outline; positive inside.

    Exact near the outline (where coverage is not saturated); away from it the
    perpendicular distance is approximated from the vertical gap, which is only
    used where the sign is all that matters.
    """
    inside = False
    approx = None
    if -L <= x <= L:
        u = (x + L) / _dx
        i = min(int(u), _NG - 1)
        w = u - i
        f = _grid[i] + w * (_grid[i + 1] - _grid[i])
        fp = _slope[i] + w * (_slope[i + 1] - _slope[i])
        inside = abs(y) <= f
        approx = (f - abs(y)) / math.sqrt(1.0 + fp * fp)
        if abs(approx) > 3.5:         # saturated: sign is all that matters
            return approx

    bi = max(0, min(_NB - 1, int((x + L) / (2 * L) * _NB)))
    best = float('inf')
    for k in range(max(0, bi - _WIN), min(_NB, bi + _WIN + 1)):
        for s in _buckets[k]:
            d = _seg_dist(x, y, s)
            if d < best:
                best = d
    if best == float('inf'):          # beyond either tip
        best = min(math.hypot(x - L, y), math.hypot(x + L, y))
    return best if inside else -best


def rrect_sd(x, y, r):
    """Signed distance to a rounded rect (cx, cy, hw, hh, rad); positive inside."""
    cx, cy, hw, hh, rad = r
    qx = abs(x - cx) - (hw - rad)
    qy = abs(y - cy) - (hh - rad)
    outside = math.hypot(max(qx, 0.0), max(qy, 0.0)) + min(max(qx, qy), 0.0) - rad
    return -outside


def cov(sd, scale):
    """Signed distance (viewBox units) -> pixel coverage."""
    return max(0.0, min(1.0, 0.5 + sd * scale))


def over(dst, src):
    """Straight-alpha source-over."""
    sr, sg, sb, sa = src
    dr, dg, db, da = dst
    a = sa + da * (1.0 - sa)
    if a <= 0.0:
        return (0.0, 0.0, 0.0, 0.0)
    f = da * (1.0 - sa)
    return ((sr * sa + dr * f) / a, (sg * sa + dg * f) / a, (sb * sa + db * f) / a, a)


def render(n, outlined, bars):
    """RGBA pixel rows for an n-by-n icon."""
    s = n / 32.0
    ct, st = math.cos(math.radians(THETA)), math.sin(math.radians(THETA))
    laces = ([SPINE] + BARS) if bars else [SPINE_SOLO]
    rows = []
    for py in range(n):
        row = []
        for px in range(n):
            X, Y = (px + 0.5) / s - 16.0, (py + 0.5) / s - 16.0
            xl = ct * X + st * Y                 # inverse of rotate(THETA)
            yl = -st * X + ct * Y
            sd = lens_sd(xl, yl)

            px_rgba = (0.0, 0.0, 0.0, 0.0)
            if outlined:
                a_out = cov(sd + STROKE_HALF, s)
                if a_out > 0.0:
                    px_rgba = over(px_rgba, (NAVY[0], NAVY[1], NAVY[2], a_out))
                a_in = cov(sd - STROKE_HALF, s)
                if a_in > 0.0:
                    px_rgba = over(px_rgba, (RED[0], RED[1], RED[2], a_in))
            else:
                a_in = cov(sd, s)
                if a_in > 0.0:
                    px_rgba = over(px_rgba, (RED[0], RED[1], RED[2], a_in))

            a_lace = 0.0
            for r in laces:
                a_lace = max(a_lace, cov(rrect_sd(xl, yl, r), s))
            if a_lace > 0.0:
                # Laces never bleed past the ball's inner edge.
                a_lace = min(a_lace, cov(sd - (STROKE_HALF if outlined else 0.0), s))
                if a_lace > 0.0:
                    px_rgba = over(px_rgba, (CREAM[0], CREAM[1], CREAM[2], a_lace))
            row.append(px_rgba)
        rows.append(row)
    return rows


def write_png(path, rows):
    n, h = len(rows[0]), len(rows)
    raw = bytearray()
    for row in rows:
        raw.append(0)
        for r, g, b, a in row:
            raw += bytes((int(round(r)), int(round(g)), int(round(b)), int(round(a * 255))))

    def chunk(tag, data):
        return (struct.pack('>I', len(data)) + tag + data
                + struct.pack('>I', zlib.crc32(tag + data) & 0xFFFFFFFF))

    png = (b'\x89PNG\r\n\x1a\n'
           + chunk(b'IHDR', struct.pack('>IIBBBBB', n, h, 8, 6, 0, 0, 0))
           + chunk(b'IDAT', zlib.compress(bytes(raw), 9))
           + chunk(b'IEND', b''))
    with open(path, 'wb') as f:
        f.write(png)
    return len(png)


def magnify(rows, k):
    return [[p for p in row for _ in range(k)] for row in rows for _ in range(k)]


def flatten(rows, bg):
    out = []
    for row in rows:
        out.append([(r * a + bg[0] * (1 - a), g * a + bg[1] * (1 - a),
                     b * a + bg[2] * (1 - a), 1.0) for r, g, b, a in row])
    return out


CANDS = [('a', True, False), ('b', True, True), ('c', False, True)]
OUT = os.path.dirname(os.path.abspath(__file__))
BANDS = {'light': (0xF4, 0xF6, 0xFB), 'chrome': (0x20, 0x21, 0x24), 'navy': (0x10, 0x13, 0x22)}

if __name__ == '__main__':
    b64 = {}
    for cid, outlined, bars in CANDS:
        for n in (16, 32, 48, 180, 512):
            rows = render(n, outlined, bars)
            p = os.path.join(OUT, f'{cid}-{n}.png')
            write_png(p, rows)
            with open(p, 'rb') as f:
                b64[f'{cid}-{n}'] = base64.b64encode(f.read()).decode()
            if n in (16, 32, 48):
                for band, bg in BANDS.items():
                    big = magnify(flatten(rows, bg), 8)
                    p2 = os.path.join(OUT, f'{cid}-{n}-{band}-x8.png')
                    write_png(p2, big)
                    with open(p2, 'rb') as f:
                        b64[f'{cid}-{n}-{band}-x8'] = base64.b64encode(f.read()).decode()
            print(f'  {cid} @ {n}')

    import json
    with open(os.path.join(OUT, 'b64.json'), 'w') as f:
        json.dump(b64, f)
    print('done')
