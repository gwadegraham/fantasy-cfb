#!/usr/bin/env python3
"""Derive the sport-neutral parent crest from a traced sport crest.

    python3 design/tools/make_parent_crest.py \
        design/brand/crest-gridiron.svg design/brand/crest-parent.svg

Campus Clash is the parent brand; Gridiron and Hardwood are leagues inside it.
The parent mark therefore carries no ball and no sport's colour -- otherwise a
second sport reads as a theme applied to a football app rather than a peer.

Two edits, both mechanical now that the crest is vector:

  1. DROP the football. Its red body and cream laces/stripes are deleted; the
     navy silhouette underneath is already the shield fill, so the taper closes
     up cleanly with no hole to patch.

  2. MOVE the ESTD pennant into the vacated taper, scaled up. A shield composed
     around a ball leaves a visible void when you remove one -- the point needs
     an anchor, and the founding date is the one device that belongs to the
     platform rather than to either sport. (Sport crests keep their ball and
     carry no date, so nobody has to decide what year Hardwood was founded.)

Then the accent layer is repainted in --cc-muted-bright, leaving the parent
chromatically neutral: navy and off-white only.

Regions are matched by BOUNDING-BOX CONTAINMENT, not intersection. That is what
lets the shield's red border survive -- it is a single path spanning the whole
crest, so it is never contained by the football box even though it passes
straight through it.
"""
import sys, re

H = 1414                      # master height; potrace space is 10x and y-flipped
FOOTBALL_BOX = (270, 1015, 880, 1310)
PENNANT_BOX = (370, 715, 665, 855)
PENNANT_FROM = (515.5, 778.0)     # current centre, px
PENNANT_TO = (512.0, 1178.0)      # target centre in the taper, px
PENNANT_SCALE = 1.45
PARENT_ACCENT = '#C9CEE6'         # --cc-muted-bright


def bbox(d):
    """Bounding box of one path's control points, in master pixel space.

    Control-point extents slightly over-estimate a curve's true bounds, which is
    the safe direction here: containment tests stay conservative.
    """
    toks = re.findall(r'[MmCcLlHhVvZz]|-?\d*\.?\d+', d)
    x = y = sx = sy = 0.0
    cmd = None
    xs, ys = [], []
    i = 0
    while i < len(toks):
        t = toks[i]
        if re.match(r'[A-Za-z]', t):
            cmd = t; i += 1; continue
        rel = cmd.islower()
        if cmd in 'Mm':
            nx, ny = float(toks[i]), float(toks[i + 1]); i += 2
            x, y = (x + nx, y + ny) if rel else (nx, ny)
            sx, sy = x, y
            cmd = 'l' if cmd == 'm' else 'L'
        elif cmd in 'Cc':
            v = [float(toks[i + k]) for k in range(6)]; i += 6
            for k in (0, 2, 4):
                cx, cy = (x + v[k], y + v[k + 1]) if rel else (v[k], v[k + 1])
                xs.append(cx); ys.append(cy)
            x, y = (x + v[4], y + v[5]) if rel else (v[4], v[5])
        elif cmd in 'Ll':
            nx, ny = float(toks[i]), float(toks[i + 1]); i += 2
            x, y = (x + nx, y + ny) if rel else (nx, ny)
        elif cmd in 'Hh':
            nx = float(toks[i]); i += 1; x = x + nx if rel else nx
        elif cmd in 'Vv':
            ny = float(toks[i]); i += 1; y = y + ny if rel else ny
        elif cmd in 'Zz':
            x, y = sx, sy; i += 1; continue
        else:
            i += 1; continue
        xs.append(x); ys.append(y)
    return min(xs) * 0.1, H - max(ys) * 0.1, max(xs) * 0.1, H - min(ys) * 0.1


def contained(b, box):
    return b[0] >= box[0] and b[1] >= box[1] and b[2] <= box[2] and b[3] <= box[3]


def build(src_svg):
    s = open(src_svg).read()
    tf = re.search(r'<g class="cc-navy" transform="([^"]+)"', s).group(1)

    to_pc = lambda x, y: (x * 10.0, (H - y) * 10.0)
    tcx, tcy = to_pc(*PENNANT_TO)
    scx, scy = to_pc(*PENNANT_FROM)
    pennant_tf = (f'translate({tcx:.1f},{tcy:.1f}) scale({PENNANT_SCALE}) '
                  f'translate({-scx:.1f},{-scy:.1f})')

    out = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 {H}" '
           f'width="1024" height="{H}" role="img" aria-label="Campus Clash crest">']
    stats = {}
    for cls, fill in [('cc-navy', '#101322'), ('cc-accent', PARENT_ACCENT),
                      ('cc-cream', '#F4F6FB')]:
        g = re.search(rf'<g class="{cls}".*?>(.*?)</g>', s, re.S).group(1)
        paths = re.findall(r'<path\b[^>]*/?>', g)
        keep, pennant, dropped = [], [], 0
        for p in paths:
            b = bbox(re.search(r'\bd="([^"]+)"', p).group(1))
            if contained(b, FOOTBALL_BOX):
                dropped += 1
            elif contained(b, PENNANT_BOX):
                pennant.append(p)
            else:
                keep.append(p)
        stats[cls] = (len(paths), dropped, len(pennant))
        body = ''.join(keep)
        if pennant:
            body += f'<g class="cc-pennant" transform="{pennant_tf}">' + ''.join(pennant) + '</g>'
        out.append(f'<g class="{cls}" transform="{tf}" fill="{fill}" stroke="none">{body}</g>')
    out.append('</svg>')
    return '\n'.join(out) + '\n', stats


def main(argv):
    if len(argv) < 3:
        raise SystemExit(__doc__)
    svg, stats = build(argv[1])
    with open(argv[2], 'w') as f:
        f.write(svg)
    print(f'{argv[2]}  {len(svg):,} bytes')
    for cls, (total, dropped, moved) in stats.items():
        print(f'  {cls:10s} {total:>3} paths  -{dropped} football  ~{moved} pennant moved')


if __name__ == '__main__':
    main(sys.argv)
