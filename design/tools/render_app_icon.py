#!/usr/bin/env python3
"""Rasterise the app icon (#571) from its vector master.

design/brand/app-icon.svg is option A ("Collision") from
design/app-icon/app-icon-options.html: the navbar's varsity C and script C,
on an opaque navy plate (iOS ignores alpha), with all the ink inside the
inner-80% circle Android keeps when it crops a maskable icon. So one 512
serves as both the "any" and the "maskable" manifest icon.

Each size is rendered from the vector at that size, never downscaled from a
big bitmap (see favicon-set). Needs cairosvg (pip install cairosvg; on macOS
with Homebrew cairo, run with DYLD_FALLBACK_LIBRARY_PATH=/opt/homebrew/lib).

    python3 design/tools/render_app_icon.py
"""
import os
import cairosvg

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
MASTER = os.path.join(ROOT, 'design', 'brand', 'app-icon.svg')

# Served file -> pixel size. New names rather than overwriting icon-192.png
# and apple-touch-icon.png, so installed copies see a changed icon URL.
OUT = {
    'app-icon-192.png': 192,    # manifest
    'app-icon-512.png': 512,    # manifest, "any" and "maskable"
    'app-icon-180.png': 180,    # apple-touch-icon (iOS home screen)
}

for name, px in OUT.items():
    cairosvg.svg2png(url=MASTER, write_to=os.path.join(ROOT, 'images', name),
                     output_width=px, output_height=px)
    print(f'images/{name} ({px}px)')
