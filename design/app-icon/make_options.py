#!/usr/bin/env python3
"""Build the sport-neutral app-icon candidates for #571 and their gallery.

Each candidate is a full-bleed 1024 master: an opaque navy plate (iOS ignores
alpha) with everything that matters inside the inner-80% circle Android keeps
when it crops a maskable icon (r = 409.6 about the centre).

The lettering is real type, converted to outlines so the masters need no fonts:
Graduate (the navbar's "CAMPUS") and Pacifico (the navbar's "Clash"), both OFL,
extracted at 1000 units/em with opentype.js. Never retype these by hand.

    python3 design/app-icon/make_options.py

writes design/app-icon/option-*.svg and design/app-icon/app-icon-options.html.
The gallery rasterises each master in the browser at the exact target size
(vector -> bitmap at 1x, never a downscale) and shows the 1x bitmaps at 8x.
"""
import os

HERE = os.path.dirname(os.path.abspath(__file__))

# --cc-* tokens (public/styles.css) and the mascot/hardwood palette
NAVY, SURFACE = '#101322', '#1A1F33'
RED, CREAM = '#ED5858', '#F4F6FB'
PERI, AMBER, ORANGE = '#8E8CF0', '#E0B341', '#F0833F'

# ---- glyph outlines, font units (y down, baseline 0), with ink bboxes
G_C = ('M172-139L223-86L396-86L460-151L460-236L540-236L540-110L436 0L184 0L80-110'
       'L80-640L184-750L436-750L540-640L540-514L460-514L460-599L397-664L224-664'
       'L172-611L172-139Z', (80, -750, 540, 0))
G_CC = ('M172-139L223-86L396-86L460-151L460-236L540-236L540-110L436 0L184 0L80-110'
        'L80-640L184-750L436-750L540-640L540-514L460-514L460-599L397-664L224-664'
        'L172-611L172-139ZM772-139L823-86L996-86L1060-151L1060-236L1140-236'
        'L1140-110L1036 0L784 0L680-110L680-640L784-750L1036-750L1140-640'
        'L1140-514L1060-514L1060-599L997-664L824-664L772-611L772-139Z',
        (80, -750, 1140, 0))
P_C = ('M453 5Q334 5 246-38.5Q158-82 111-162Q64-242 64-348Q64-495 119.5-609'
       'Q175-723 270-785.5Q365-848 481-848Q589-848 645-792.5Q701-737 701-646'
       'Q701-585 679.5-548Q658-511 618-511Q590-511 574-524Q558-537 558-562'
       'Q558-571 562-595Q568-625 568-643Q568-734 471-734Q405-734 345-691'
       'Q285-648 248-564.5Q211-481 211-366Q211-246 278-180.5Q345-115 476-115'
       'Q541-115 607.5-131.5Q674-148 755-182Q770-188 780-188Q796-188 804-176'
       'Q812-164 812-145Q812-84 746-55Q675-24 598.5-9.5Q522 5 453 5Z',
       (64, -848, 812, 5))


def glyph(g, cx, cy, h, fill, stroke=None, sw=0, extra=''):
    """Place a glyph so its ink box is centred on (cx, cy) at height h px.
    sw is an output-px stroke width; stroke paints under the fill."""
    d, (x0, y0, x1, y1) = g
    s = h / (y1 - y0)
    t = (f'translate({cx:.1f} {cy:.1f}) scale({s:.5f}) '
         f'translate({-(x0 + x1) / 2:.1f} {-(y0 + y1) / 2:.1f})')
    st = (f' stroke="{stroke}" stroke-width="{sw / s:.1f}" stroke-linejoin="round"'
          f' paint-order="stroke"') if stroke else ''
    return f'<path transform="{t}" d="{d}" fill="{fill}"{st}{extra}/>'


def svg(body, label):
    return ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" '
            f'width="1024" height="1024" role="img" aria-label="{label}">'
            f'<rect width="1024" height="1024" fill="{NAVY}"/>{body}</svg>')


# 1 -- the wordmark's collision, distilled to its initials -----------------
def collision():
    block = glyph(G_C, 398, 424, 500, CREAM, CREAM, 36)        # thickened varsity C
    # the script, fattened a touch in its own red, then a navy keyline under it
    key = glyph(P_C, 612, 612, 470, NAVY, NAVY, 84)
    script = glyph(P_C, 612, 612, 470, RED, RED, 18)
    return svg(block + key + script, 'Campus Clash')


# 2 -- the crest, at icon scale -------------------------------------------
SHIELD = 'M268 318H756V560C756 702 642 790 512 850C382 790 268 702 268 560Z'


def crest():
    dome = (f'<path d="M402 330A110 118 0 0 1 622 330Z" fill="{RED}" stroke="{NAVY}" stroke-width="14"/>'
            f'<rect x="490" y="176" width="44" height="42" rx="4" fill="{CREAM}" stroke="{NAVY}" stroke-width="10"/>'
            f'<path d="M482 180A30 30 0 0 1 542 180Z" fill="{RED}" stroke="{NAVY}" stroke-width="10"/>'
            f'<rect x="505" y="140" width="14" height="22" rx="7" fill="{RED}"/>')
    shield = (f'<path d="{SHIELD}" fill="{SURFACE}" stroke="{RED}" stroke-width="34" stroke-linejoin="round"/>'
              f'<path d="{SHIELD}" transform="translate(512 584) scale(.86) translate(-512 -584)" '
              f'fill="none" stroke="{CREAM}" stroke-width="8" stroke-linejoin="round" opacity=".9"/>')
    cc = glyph(G_CC, 512, 548, 196, CREAM, CREAM, 16)
    estd = (f'<path d="M472 672H552V706L512 728L472 706Z" fill="{RED}"/>')
    art = f'<g transform="translate(512 512) scale(1.08) translate(-512 -512)">{dome + shield + cc + estd}</g>'
    return svg(art, 'Campus Clash crest')


# 3 -- Laces' CC pennant, flown on its own ---------------------------------
def pennant():
    flag = 'M318 196C480 236 650 300 852 384C650 456 480 520 318 572Z'
    body = (f'<defs><clipPath id="f"><path d="{flag}"/></clipPath></defs>'
            f'<g transform="rotate(-10 512 512)">'
            f'<line x1="300" y1="196" x2="300" y2="822" stroke="{NAVY}" stroke-width="54" stroke-linecap="round"/>'
            f'<line x1="300" y1="196" x2="300" y2="822" stroke="{AMBER}" stroke-width="26" stroke-linecap="round"/>'
            f'<circle cx="300" cy="182" r="26" fill="{AMBER}" stroke="{NAVY}" stroke-width="12"/>'
            f'<path d="{flag}" fill="{RED}"/>'
            f'<rect x="318" y="180" width="46" height="400" fill="{CREAM}" clip-path="url(#f)"/>'
            + glyph(G_CC, 490, 384, 146, CREAM, CREAM, 16) +
            '</g>')
    return svg(body, 'Campus Clash pennant')


# 4 -- the two existing favicons, colliding --------------------------------
def clash():
    k = 215 / 14.6                       # favicon-hardwood: r 14.6 in a 32 box
    bx, by = 618, 410
    ball = (f'<g transform="translate({bx - 16 * k:.1f} {by - 16 * k:.1f}) scale({k:.4f})">'
            f'<defs><clipPath id="b"><circle cx="16" cy="16" r="14.6"/></clipPath></defs>'
            f'<circle cx="16" cy="16" r="14.6" fill="{ORANGE}" stroke="{NAVY}" stroke-width="2"/>'
            f'<g clip-path="url(#b)" fill="none" stroke="{NAVY}" stroke-width="1.6">'
            '<path d="M16 1.4V30.6"/><path d="M1.4 16H30.6"/>'
            '<path d="M5.49 5.85C8.41 10.74 8.41 21.26 5.49 26.15"/>'
            '<path d="M26.51 5.85C23.59 10.74 23.59 21.26 26.51 26.15"/></g></g>')
    f = 262 / 15.6                       # favicon football: half-length 15.6
    fx, fy = 434, 604
    foot = (f'<g transform="translate({fx} {fy}) scale({f:.4f}) rotate(-35)">'
            f'<path d="M-15.6 0C-6.55-12.8 6.55-12.8 15.6 0C6.55 12.8-6.55 12.8-15.6 0Z" '
            f'fill="{RED}" stroke="{NAVY}" stroke-width="2.6" stroke-linejoin="round" paint-order="stroke"/>'
            f'<g fill="{CREAM}"><rect x="-7.6" y="-1.4" width="15.2" height="2.8" rx="1.4"/>'
            + ''.join(f'<rect x="{c - .9}" y="-4" width="1.8" height="8" rx=".9"/>'
                      for c in (-6.0, -3.0, 0.0, 3.0, 6.0)) +
            '</g></g>')
    return svg(ball + foot, 'Campus Clash')


# 5 -- the campus skyline from the badge, with the pennant on the dome ----
def campus():
    c, n, r = CREAM, NAVY, RED
    p = []
    # flanking towers
    p.append(f'<rect x="214" y="452" width="96" height="300" fill="{r}"/>')
    p.append(f'<path d="M202 460L262 350L322 460Z" fill="{r}"/>')
    p.append(f'<rect x="246" y="500" width="32" height="56" rx="16" fill="{c}"/>')
    p.append(f'<rect x="714" y="420" width="96" height="332" fill="{r}"/>')
    p.append(f'<path d="M702 428L762 290L822 428Z" fill="{r}"/>')
    p.append(f'<rect x="746" y="470" width="32" height="56" rx="16" fill="{c}"/>')
    # rotunda: colonnade, drum, dome, lantern
    p.append(f'<rect x="300" y="612" width="424" height="140" fill="{c}"/>')
    p.append(''.join(f'<rect x="{x}" y="640" width="26" height="112" fill="{n}"/>' for x in (334, 392, 450, 548, 606, 664)))
    p.append(f'<path d="M282 620L512 540L742 620Z" fill="{r}" stroke="{n}" stroke-width="12" stroke-linejoin="round"/>')
    p.append(f'<rect x="372" y="470" width="280" height="72" fill="{c}"/>')
    p.append(''.join(f'<rect x="{x}" y="486" width="20" height="44" rx="10" fill="{n}"/>' for x in (398, 444, 490, 536, 582, 628 - 0)))
    p.append(f'<path d="M376 474A136 150 0 0 1 648 474Z" fill="{r}" stroke="{n}" stroke-width="12"/>')
    p.append(f'<rect x="492" y="292" width="40" height="40" fill="{c}" stroke="{n}" stroke-width="10"/>')
    # the pennant on the spire
    p.append(f'<line x1="512" y1="296" x2="512" y2="168" stroke="{AMBER}" stroke-width="12" stroke-linecap="round"/>')
    p.append(f'<path d="M518 172L626 204L518 236Z" fill="{r}"/>')
    p.append(f'<rect x="200" y="752" width="624" height="16" fill="{c}"/>')
    return svg(''.join(p), 'Campus Clash campus')


OPTIONS = [
    ('collision', 'Collision', collision(),
     'The navbar wordmark’s whole idea in two letters: the varsity C behind, the red script C crashing through it on a navy keyline.'),
    ('crest', 'Crest', crest(),
     'The parent crest at icon scale: shield, campus dome, block CC and the ESTD tag. Already sport-neutral, so it carries over intact.'),
    ('pennant', 'Pennant', pennant(),
     'Laces’ red CC pennant on its gold pole, flown on its own. The brand’s rallying prop, with no ball in sight.'),
    ('clash', 'Head-to-head', clash(),
     'The two tab favicons meeting mid-air: the red football crossing in front of the hardwood ball. Both leagues, one mark.'),
    ('campus', 'Campus', campus(),
     'The badge’s skyline: dome and two towers in brand red, with the CC pennant flying from the spire. Campus, literally.'),
]


def main():
    for key, _, s, _ in OPTIONS:
        with open(os.path.join(HERE, f'option-{key}.svg'), 'w') as fh:
            fh.write(s + '\n')
    import json
    data = json.dumps([{'key': k, 'name': nm, 'svg': s, 'why': w} for k, nm, s, w in OPTIONS])
    with open(os.path.join(HERE, 'gallery.template.html')) as fh:
        tpl = fh.read()
    with open(os.path.join(HERE, 'app-icon-options.html'), 'w') as fh:
        fh.write(tpl.replace('/*OPTIONS*/[]', data))


if __name__ == '__main__':
    main()
