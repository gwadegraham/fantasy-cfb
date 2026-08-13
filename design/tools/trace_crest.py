#!/usr/bin/env python3
"""Vectorize a flat three-colour crest master into a layered SVG.

    python3 design/tools/trace_crest.py design/brand/campus-clash-badge.png \
        design/brand/crest-gridiron.svg --accent ED5858

Why this exists: the badge shipped as a raster, so every variant (a second
sport, a ball swap, a lockup) meant either regenerating it in an image model --
which drifts, badly, and silently re-letters the wordmark -- or pixel surgery.
Vectorised once, every variant is a path-group edit and a fill value.

HOW IT WORKS. The art is a strict three-colour system: ~70% of opaque pixels sit
on exactly navy/cream/accent and the remaining ~30% are antialiasing blends
between them. Each opaque pixel is decomposed into WEIGHTS over the three
colours (least squares, the same math as remap.py) and assigned to its heaviest
weight. That puts a hard edge at the midpoint of every blend -- exactly what
vector art wants, since the renderer regenerates smooth edges on its own.

Do NOT simplify this to nearest-centroid in RGB. It looks equivalent and is not:
a cream->navy blend passes through mid-grey, and mid-grey sits ~128 away from
the red accent but ~194 from navy and ~195 from cream. Nearest-centroid
therefore paints a red speckle along every cream/navy edge -- which is
invisible as red-on-navy in the football crest, and glaringly visible the moment
the accent is a light tone. Decomposition correctly reads that pixel as
cream+navy with a zero red weight.

LAYERING. Three masks are traced but only two are painted on top:

    1. the full silhouette, filled navy
    2. the accent mask
    3. the cream mask

Navy is never traced as its own shape -- it is whatever the silhouette shows
through. That is deliberate: masks are exact and non-overlapping, so painting
them side by side would leave hairline seams where two regions meet. With navy
underneath everything, a seam can only ever reveal navy, which is the outline
colour the artwork already puts there. Reordering these layers, or painting navy
as its own mask on top, reintroduces the seams.

potrace is required (`brew install potrace`). It is a build-time dependency for
a one-time artifact, not a runtime one -- the same standing as cwebp in
make_crest.py.

VERIFY after tracing: render the SVG back to the master's dimensions and diff.
Every differing pixel should sit on a colour boundary (antialiasing); any
difference in the interior of a region means the trace lost a shape.
"""
import sys, os, re, subprocess, tempfile
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pngio

NAVY = (0x10, 0x13, 0x22)
CREAM = (0xF4, 0xF6, 0xFB)

# potrace tuning. turdsize 2 drops single-pixel speckle without eating the
# smallest real details (the ESTD dashes, window slots). alphamax/opttolerance
# are potrace defaults -- raising them softens the architecture's corners.
POTRACE_ARGS = ['-s', '-t', '2', '-a', '1.0', '-O', '0.2', '-u', '10']


def write_pbm(path, w, h, bits):
    """P4 (binary) PBM. 1 = black = the region potrace will trace."""
    rowbytes = (w + 7) // 8
    data = bytearray()
    for row in bits:
        b = bytearray(rowbytes)
        for x, v in enumerate(row):
            if v:
                b[x >> 3] |= 0x80 >> (x & 7)
        data += b
    with open(path, 'wb') as f:
        f.write(b'P4\n%d %d\n' % (w, h))
        f.write(bytes(data))


def classifier(accent):
    """Return f(r,g,b) -> 0 navy / 1 cream / 2 accent, by least-squares weights.

    Solves each pixel as a blend of the three brand colours and returns whichever
    contributes most. See the module docstring for why nearest-centroid is wrong.
    """
    c1, c2, c3 = accent, NAVY, CREAM
    u = tuple(c1[i] - c3[i] for i in range(3))
    v = tuple(c2[i] - c3[i] for i in range(3))
    uu = sum(x * x for x in u)
    vv = sum(x * x for x in v)
    uv = sum(u[i] * v[i] for i in range(3))
    det = uu * vv - uv * uv
    cache = {}

    def f(r, g, b):
        key = (r, g, b)
        hit = cache.get(key)
        if hit is None:
            d = (r - c3[0], g - c3[1], b - c3[2])
            ud = sum(u[i] * d[i] for i in range(3))
            vd = sum(v[i] * d[i] for i in range(3))
            if det:
                w_acc = (ud * vv - vd * uv) / det
                w_navy = (vd * uu - ud * uv) / det
            else:
                w_acc = w_navy = 0.0
            w_cream = 1.0 - w_acc - w_navy
            weights = (max(w_navy, 0.0), max(w_cream, 0.0), max(w_acc, 0.0))
            hit = max(range(3), key=lambda k: weights[k])
            cache[key] = hit
        return hit
    return f


def masks(rows, w, h, accent, alpha_min=128):
    """Silhouette + accent + cream masks."""
    classify = classifier(accent)
    sil, acc, cre = [], [], []
    for row in rows:
        sr, ar, cr = [], [], []
        for p in row:
            on = 1 if p[3] > alpha_min else 0
            sr.append(on)
            i = classify(p[0], p[1], p[2]) if on else -1
            ar.append(1 if i == 2 else 0)
            cr.append(1 if i == 1 else 0)
        sil.append(sr); acc.append(ar); cre.append(cr)
    return sil, acc, cre


def trace(bits, w, h, workdir, name):
    """Run potrace over one mask, returning (transform, path-markup)."""
    pbm = os.path.join(workdir, name + '.pbm')
    svg = os.path.join(workdir, name + '.svg')
    write_pbm(pbm, w, h, bits)
    subprocess.run(['potrace'] + POTRACE_ARGS + ['-o', svg, pbm], check=True)
    m = re.search(r'<g\b[^>]*transform="([^"]+)"[^>]*>(.*?)</g>', open(svg).read(), re.S)
    if not m:
        raise SystemExit(f'potrace produced no path group for {name} '
                         '(is the mask empty?)')
    return m.group(1), m.group(2).strip()


def build(src_png, accent, label='Campus Clash crest'):
    w, h, rows = pngio.read_png(src_png)
    sil, acc, cre = masks(rows, w, h, accent)
    with tempfile.TemporaryDirectory() as tmp:
        tf, d_sil = trace(sil, w, h, tmp, 'sil')
        _, d_acc = trace(acc, w, h, tmp, 'accent')
        _, d_cre = trace(cre, w, h, tmp, 'cream')
    hexa = '#%02X%02X%02X' % accent
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" '
        f'width="{w}" height="{h}" role="img" aria-label="{label}">\n'
        f'<g class="cc-navy" transform="{tf}" fill="#101322" stroke="none">{d_sil}</g>\n'
        f'<g class="cc-accent" transform="{tf}" fill="{hexa}" stroke="none">{d_acc}</g>\n'
        f'<g class="cc-cream" transform="{tf}" fill="#F4F6FB" stroke="none">{d_cre}</g>\n'
        f'</svg>\n'
    )


def main(argv):
    if len(argv) < 3:
        raise SystemExit(__doc__)
    src, out = argv[1], argv[2]
    accent = NAVY
    if '--accent' in argv:
        v = argv[argv.index('--accent') + 1].lstrip('#')
        accent = (int(v[0:2], 16), int(v[2:4], 16), int(v[4:6], 16))
    label = argv[argv.index('--label') + 1] if '--label' in argv else 'Campus Clash crest'
    svg = build(src, accent, label)
    with open(out, 'w') as f:
        f.write(svg)
    print(f'{out}  {len(svg):,} bytes  accent #%02X%02X%02X' % accent)


if __name__ == '__main__':
    main(sys.argv)
