"""Palette-remap flat 3-colour logo art onto exact design tokens.

Each pixel is decomposed into weights over the three SOURCE colours (least
squares, so antialiased edges and grain resolve into real blends), then
recomposed with the TARGET colours. Nothing is redrawn -- shapes, spacing and
antialiasing are untouched.
"""
import pngio

APP_BG = (0x10, 0x13, 0x22)          # --cc-bg, the page behind the lockup


def remap(rows, src, dst, cache=None):
    c1, c2, c3 = src['red'], src['navy'], src['cream']
    t1, t2, t3 = dst['red'], dst['navy'], dst['cream']
    u = tuple(c1[i] - c3[i] for i in range(3))
    v = tuple(c2[i] - c3[i] for i in range(3))
    uu = sum(x * x for x in u)
    vv = sum(x * x for x in v)
    uv = sum(u[i] * v[i] for i in range(3))
    det = uu * vv - uv * uv
    cache = {} if cache is None else cache

    out = []
    for row in rows:
        line = []
        for r, g, b, a in row:
            if a == 0:
                line.append((0, 0, 0, 0))
                continue
            key = (r, g, b)
            hit = cache.get(key)
            if hit is None:
                d = (r - c3[0], g - c3[1], b - c3[2])
                ud = sum(u[i] * d[i] for i in range(3))
                vd = sum(v[i] * d[i] for i in range(3))
                if det:
                    w1 = (ud * vv - vd * uv) / det
                    w2 = (vd * uu - ud * uv) / det
                else:
                    w1 = w2 = 0.0
                w3 = 1.0 - w1 - w2
                w1, w2, w3 = max(w1, 0.0), max(w2, 0.0), max(w3, 0.0)
                s = w1 + w2 + w3
                if s <= 0:
                    w1, w2, w3, s = 0.0, 0.0, 1.0, 1.0
                w1, w2, w3 = w1 / s, w2 / s, w3 / s
                hit = tuple(int(round(max(0, min(255, w1 * t1[i] + w2 * t2[i] + w3 * t3[i]))))
                            for i in range(3))
                cache[key] = hit
            line.append((hit[0], hit[1], hit[2], a))
        out.append(line)
    return out


def bbox(rows, thresh=8):
    ys = [y for y, row in enumerate(rows) if any(p[3] > thresh for p in row)]
    xs = [x for x in range(len(rows[0])) if any(rows[y][x][3] > thresh for y in ys)]
    return min(xs), min(ys), max(xs), max(ys)


def crop(rows, box, pad, w, h):
    x0, y0, x1, y1 = box
    x0, y0 = max(0, x0 - pad), max(0, y0 - pad)
    x1, y1 = min(w - 1, x1 + pad), min(h - 1, y1 + pad)
    return [row[x0:x1 + 1] for row in rows[y0:y1 + 1]]


def flatten(rows, bg):
    return [[(round(p[0] * p[3] / 255 + bg[0] * (1 - p[3] / 255)),
              round(p[1] * p[3] / 255 + bg[1] * (1 - p[3] / 255)),
              round(p[2] * p[3] / 255 + bg[2] * (1 - p[3] / 255)), 255)
             for p in row] for row in rows]


def halve(rows):
    h, w = len(rows) // 2 * 2, len(rows[0]) // 2 * 2
    out = []
    for y in range(0, h, 2):
        line = []
        for x in range(0, w, 2):
            q = (rows[y][x], rows[y][x + 1], rows[y + 1][x], rows[y + 1][x + 1])
            line.append(tuple(round(sum(p[i] for p in q) / 4) for i in range(4)))
        out.append(line)
    return out
