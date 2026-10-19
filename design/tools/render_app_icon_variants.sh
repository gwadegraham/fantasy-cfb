#!/bin/sh
# Rasterise the home-screen icon choices (/install's picker) from
# design/app-icon/variants.html, one headless-Chrome screenshot per icon per
# size, so each PNG is drawn from the vector at its own size.
#
#     sh design/tools/render_app_icon_variants.sh
#
# 'classic' is not rendered here: it is the existing images/app-icon-*.png set
# (render_app_icon.py), kept at those names so installed copies see no change.
# Keep --disable-gpu: without it the pixels differ run to run.
set -e
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
CHROME=${CHROME:-"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"}
OUT="$ROOT/images/app-icons"
mkdir -p "$OUT"
for id in football hoops red cream gold violet laces dribbles; do
    for px in 180 192 512; do
        # Chrome will not open a window under ~500px wide, so shoot 600 with
        # the icon centred at its real size, then centre-crop to it.
        "$CHROME" --headless --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
            --allow-file-access-from-files --window-size=600,600 \
            --screenshot="$OUT/$id-$px.png" \
            "file://$ROOT/design/app-icon/variants.html?id=$id&px=$px" >/dev/null 2>&1
        sips -c $px $px "$OUT/$id-$px.png" >/dev/null
        echo "images/app-icons/$id-$px.png"
    done
done
