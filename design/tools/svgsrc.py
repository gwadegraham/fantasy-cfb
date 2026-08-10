"""Single source of truth for the candidate SVG markup."""

BALL = "M-15.6 0C-6.55-12.8 6.55-12.8 15.6 0C6.55 12.8-6.55 12.8-15.6 0Z"
OUTLINE = ' stroke="#101322" stroke-width="2" stroke-linejoin="round"'
SPINE_SOLO = '<rect x="-7.6" y="-1.7" width="15.2" height="3.4" rx="1.7"/>'
SPINE = '<rect x="-7.6" y="-1.4" width="15.2" height="2.8" rx="1.4"/>'
BARS = ''.join(
    f'<rect x="{c - 0.9}" y="-4" width="1.8" height="8" rx="0.9"/>'
    for c in (-6.0, -3.0, 0.0, 3.0, 6.0)
)


def svg(outlined, bars, size=None):
    dim = f' width="{size}" height="{size}"' if size else ''
    laces = (SPINE + BARS) if bars else SPINE_SOLO
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"{dim}'
        f' role="img" aria-label="Campus Clash">'
        f'<g transform="translate(16 16) rotate(-35)">'
        f'<path d="{BALL}" fill="#ED5858"{OUTLINE if outlined else ""}/>'
        f'<g fill="#F4F6FB">{laces}</g>'
        f'</g></svg>'
    )


CANDS = [('a', True, False, 'A — spine only, outlined'),
         ('b', True, True, 'B — full laces, outlined'),
         ('c', False, True, 'C — full laces, no outline')]
