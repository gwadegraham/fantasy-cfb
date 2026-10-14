// Laces (football) and Dribbles (basketball): the Campus Clash mascots.
//
// Rubber-hose style, drawn as inline SVG so there are no image files and they stay
// crisp at any size. Design source and every rejected direction live in
// design/mascots/campus-clash-mascots.html.
//
//   ccMascot.html({ sport, pose, size, busy, label })  → markup string
//   ccMascot.hydrate(root)                             → fills every [data-ccm] placeholder under root
//   ccMascot.setBusy(el, on)                           → start/stop the idle loop on a rendered mascot
//   ccMascot.sport()                                   → the sport this page is about
//
// Decorative by default (aria-hidden): every placement sits next to text that
// already says what's happening, so a screen reader announcing "Laces, image"
// on each loader is noise. Pass a `label` to make one a real image.
//
// size: 'full' (whole body, for heroes and empty states) or 'head' (the same
// drawing cropped to the head with the limbs hidden, for chips and loaders).
// pose: 'cheer' (default: Laces' pennant, Dribbles' foam finger), 'trophy', 'icepack'.
// Laces also has two celebrations: 'griddy' (the dance, looping while busy) and
// 'heisman' (the trophy pose, held), plus 'handL' for a head-to-head loss
// (handing you an L) and 'tugduo' for a tie (two of him in a tug-of-war, on a
// wide canvas). Dribbles answers each with a basketball move: 'dunkhang' (season
// high), 'netcut' (#1, cutting down the net), 'spinL' (H2H loss), 'jumpball' (H2H tie, wide); either
// mascot asked for the other's move gets his own counterpart. Both have
// 'raincloud' for a league-low week:
// drizzle and a slump, then shrugging it off.
//
// Motion means something: the loops only run on a mascot marked busy, and
// mascots.css freezes them under prefers-reduced-motion.
//
// Basketball must stay invisible to managers outside a basketball league, so
// sport() only answers 'basketball' when the page itself is about basketball.
(function () {
    'use strict';

    let uid = 0;
    const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

    // ---------- shapes ----------
    const noodle = d => `<path class="ccm-limb-o" d="${d}"/><path class="ccm-limb" d="${d}"/>`;

    // White cartoon gloves: an open hand or a fist. Never a lone raised digit.
    const glove = (x, y, kind) => {
        const cuff = `<ellipse class="ccm-f-body ccm-o" cx="${x}" cy="${y + 3.4}" rx="3.1" ry="1.5"/>`;
        const palm = `<circle class="ccm-f-body ccm-o" cx="${x}" cy="${y}" r="3.3"/>`;
        if (kind === 'wave') {
            return cuff
                + `<circle class="ccm-f-body ccm-o" cx="${x - 2.3}" cy="${y - 2.6}" r="1.4"/>`
                + `<circle class="ccm-f-body ccm-o" cx="${x}" cy="${y - 3.4}" r="1.4"/>`
                + `<circle class="ccm-f-body ccm-o" cx="${x + 2.3}" cy="${y - 2.6}" r="1.4"/>`
                + `<circle class="ccm-f-body ccm-o" cx="${x + 3.3}" cy="${y + .4}" r="1.3"/>` + palm;
        }
        return cuff + palm;
    };

    const shoe = (x, y, w, cls) =>
        `<rect class="${cls} ccm-o" x="${x}" y="${y}" width="${w}" height="6.5" rx="3.2"/>`
        + `<rect class="ccm-f-body" x="${x + 2}" y="${y + 1.4}" width="${w * .3}" height="1.3" rx=".65" opacity=".55"/>`;

    // Big oval eyes with tall pupils. `lid` (a fill class) draws heavy lids for a rough week.
    const eyes = (x1, x2, y, rx, ry, lid) => {
        const one = x => `<ellipse class="ccm-f-body" cx="${x}" cy="${y}" rx="${rx}" ry="${ry}" stroke="var(--ccm-ink)" stroke-width="1"/>`;
        const pupil = x => `<ellipse class="ccm-f-ink" cx="${x + rx * .12}" cy="${y + ry * .14}" rx="${rx * .5}" ry="${ry * .62}"/>`
            + `<ellipse class="ccm-f-body" cx="${x - rx * .08}" cy="${y - ry * .2}" rx="${rx * .17}" ry="${ry * .24}"/>`;
        let lids = '';
        if (lid) {
            // Lid edge 15% above center; the arc follows the eye's own outline.
            const ly = y - ry * .15, dx = rx * Math.sqrt(1 - .15 * .15);
            lids = [x1, x2].map(x => `<path class="${lid}" d="M${x - dx} ${ly} A ${rx} ${ry} 0 0 1 ${x + dx} ${ly} Z" stroke="var(--ccm-ink)" stroke-width="1"/>`).join('');
        }
        return `<g class="ccm-eyes">${one(x1)}${one(x2)}<g class="ccm-look">${pupil(x1)}${pupil(x2)}</g>${lids}</g>`;
    };

    // Wide open smile with a red tongue, or a small frown.
    const smile = (id, cx, y, w, depth) => {
        const d = `M${cx - w} ${y} Q${cx} ${y + depth * 2} ${cx + w} ${y} Q${cx} ${y + depth * .75} ${cx - w} ${y} Z`;
        return `<clipPath id="${id}"><path d="${d}"/></clipPath>`
            + `<path class="ccm-f-ink" d="${d}" stroke="var(--ccm-ink)" stroke-width=".8" stroke-linejoin="round"/>`
            + `<ellipse class="ccm-f-tongue" clip-path="url(#${id})" cx="${cx}" cy="${y + depth * 1.45}" rx="${w * .42}" ry="${depth * .55}"/>`;
    };
    const frown = (cx, y, w) => `<path class="ccm-frown" d="M${cx - w} ${y + 1.2} Q${cx} ${y - 1.6} ${cx + w} ${y + 1.2}"/>`;

    // Gold cup held up by a glove at (x, y + 15).
    const trophy = (x, y) => `<g class="ccm-prop">
        <circle cx="${x - 5.8}" cy="${y + 3.6}" r="2.2" fill="none" stroke="var(--ccm-ink)" stroke-width="2.6"/>
        <circle cx="${x + 5.8}" cy="${y + 3.6}" r="2.2" fill="none" stroke="var(--ccm-ink)" stroke-width="2.6"/>
        <circle cx="${x - 5.8}" cy="${y + 3.6}" r="2.2" fill="none" stroke="var(--ccm-gold)" stroke-width="1.2"/>
        <circle cx="${x + 5.8}" cy="${y + 3.6}" r="2.2" fill="none" stroke="var(--ccm-gold)" stroke-width="1.2"/>
        <path class="ccm-f-gold ccm-o" d="M${x - 5.5} ${y} H${x + 5.5} V${y + 3.5} A 5.5 5.5 0 0 1 ${x - 5.5} ${y + 3.5} Z"/>
        <rect class="ccm-f-body" x="${x - 3.6}" y="${y + 1}" width="1.4" height="4" rx=".7" opacity=".6"/>
        <rect class="ccm-f-gold ccm-o" x="${x - 1}" y="${y + 8.6}" width="2" height="2.6"/>
        <rect class="ccm-f-gold ccm-o" x="${x - 3.6}" y="${y + 10.8}" width="7.2" height="2.2" rx="1"/></g>`;

    // The plaid ice bag with a red screw cap, standing on his head and slumped
    // under its own weight: a flat, wide base, a low dome, the cap on top. Its
    // base sits at y + 7.2, centered on x + 8. (A plain blue bar read as
    // anything but an ice pack; a round upright bag read as a bottle.)
    const icepack = (x, y) => {
        const cx = x + 8, base = y + 7.2, top = base - 7.2;
        const bag = `M${cx - 7.4} ${base} Q${cx - 8.4} ${base - 4} ${cx - 3.2} ${top + .6} Q${cx} ${top - .5} ${cx + 3.2} ${top + .6} Q${cx + 8.4} ${base - 4} ${cx + 7.4} ${base} Q${cx} ${base + 1.4} ${cx - 7.4} ${base} Z`;
        return `<g class="ccm-prop">
          <rect class="ccm-f-ice ccm-o" x="${cx - 1.4}" y="${top - 2}" width="2.8" height="2.6"/>
          <rect class="ccm-f-red ccm-o" x="${cx - 3}" y="${top - 4.8}" width="6" height="3.2" rx="1"/>
          <g stroke="var(--ccm-ink)" stroke-width=".5" opacity=".45"><line x1="${cx - 1.2}" y1="${top - 4.3}" x2="${cx - 1.2}" y2="${top - 2.1}"/><line x1="${cx + 1.2}" y1="${top - 4.3}" x2="${cx + 1.2}" y2="${top - 2.1}"/></g>
          <path class="ccm-f-ice ccm-o" d="${bag}"/>
          <g stroke="var(--ccm-body)" stroke-width=".8" opacity=".8" stroke-linecap="round">
            <line x1="${cx - 2.6}" y1="${top + 1.6}" x2="${cx - 3}" y2="${base}"/><line x1="${cx + 2.6}" y1="${top + 1.6}" x2="${cx + 3}" y2="${base}"/>
            <line x1="${cx - 6.6}" y1="${base - 3.2}" x2="${cx + 6.6}" y2="${base - 3.2}"/></g>
          <ellipse class="ccm-f-body" cx="${cx - 4.6}" cy="${base - 4.6}" rx=".8" ry="1.2" opacity=".8"/>
        </g>`;
    };

    const pennant = () => `
        <line x1="8" y1="19" x2="8" y2=".8" stroke="var(--ccm-ink)" stroke-width="2.4" stroke-linecap="round"/>
        <line x1="8" y1="19" x2="8" y2=".8" stroke="var(--ccm-gold)" stroke-width="1.1" stroke-linecap="round"/>
        <g class="ccm-flag"><polygon class="ccm-f-red ccm-o" points="8.8,1.2 33,7.4 8.8,13.6"/>
        <rect class="ccm-f-body" x="8.8" y="2" width="2.2" height="10.8"/>
        <text class="ccm-cc" x="18.4" y="9.6">CC</text></g>`;

    // Foam finger after the classic #1 shape: index up on the OUTER edge with the
    // curled fingers stacked beside it, so it can never read as a middle finger.
    // Own 40x60 viewBox via a nested svg, so no transform math.
    const foamFinger = (x, y, w) => {
        const sil = [
            'x="23" y="-4" width="8.5" height="36" rx="4.25"',
            'x="5" y="20" width="29.5" height="28" rx="9"',
            'x="10" y="44" width="20" height="14" rx="3"',
            'x="5.5" y="19" width="7" height="16" rx="3.5"',
            'x="11.5" y="17" width="7" height="16" rx="3.5"',
            'x="17.5" y="16" width="7" height="15" rx="3.5"',
            'x="13" y="27" width="18" height="7.5" rx="3.75"'
        ];
        const layer = st => sil.map(a => `<rect ${a} ${st}/>`).join('');
        const part = n => `<rect ${sil[n]} fill="var(--ccm-violet)" stroke="var(--ccm-body)" stroke-width="1.8"/>`;
        return `<svg x="${x}" y="${y}" width="${w}" height="${w * 1.5}" viewBox="0 0 40 60" overflow="visible">
            ${layer('fill="var(--ccm-ink)" stroke="var(--ccm-ink)" stroke-width="9" stroke-linejoin="round"')}
            ${layer('fill="var(--ccm-body)" stroke="var(--ccm-body)" stroke-width="3.6" stroke-linejoin="round"')}
            ${[0, 1, 2].map(n => `<rect ${sil[n]} fill="var(--ccm-violet)"/>`).join('')}
            ${part(3)}${part(4)}${part(5)}<rect ${sil[6]} fill="var(--ccm-violet)"/>
            <g stroke="var(--ccm-body)" stroke-width="1.6" stroke-linecap="round"><line x1="25.8" y1="11" x2="28.6" y2="11"/><line x1="25.8" y1="13.6" x2="28.6" y2="13.6"/></g>
            <text x="20" y="45" text-anchor="middle" class="ccm-cc-foam">CC</text>
        </svg>`;
    };

    // Laces' body, face and laces, shared by every pose.
    const lacesBall = u => `
          <ellipse class="ccm-f-leather" cx="32" cy="30" rx="20" ry="14"/>
          <g clip-path="url(#${u}c)">
            <rect class="ccm-f-leather-shade" x="12" y="35" width="40" height="14"/>
            <rect class="ccm-f-body" x="15.6" y="16" width="2.2" height="28"/>
            <rect class="ccm-f-body" x="46.2" y="16" width="2.2" height="28"/>
          </g>
          <ellipse class="ccm-o ccm-none" cx="32" cy="30" rx="20" ry="14"/>
          <rect class="ccm-f-body" x="25.5" y="19.3" width="13" height="1.5" rx=".75"/>
          ${[-4.5, -1.5, 1.5, 4.5].map(d => `<line class="ccm-lace" x1="${32 + d}" y1="18.2" x2="${32 + d}" y2="21.9"/>`).join('')}`;

    // A leg with a knee: the thigh pivots at the hip and carries the shin, which
    // pivots at the knee and carries the shoe. Drawn straight and planted; the
    // CSS bends it. `side` is 'L' or 'R' (toes point outward).
    const kneeLeg = (cls, hipX, kneeX, footX, shoeX) => `
        <g class="${cls}-thigh">${noodle(`M${hipX} 42.5 Q${(hipX + kneeX) / 2 + (kneeX < hipX ? -.5 : .5)} 47.5 ${kneeX} 52`)}
          <g class="${cls}-shin">${noodle(`M${kneeX} 52 Q${(kneeX + footX) / 2} 56.5 ${footX} 61`)}${shoe(shoeX, 59, 12, 'ccm-f-red')}</g></g>`;

    // The Griddy: four heel kicks on a skip (left, right, left, right), arms
    // swinging against the legs, then both hands up to the eyes for the goggles.
    // The legs move side-on, toes forward (right): a heel kicking BACK is the
    // whole move, and from straight on it reads as flailing. Each limb is its
    // own group with its own joint pivot (mascots.css, ccm-gr-*).
    const lacesGriddy = u => `
        <defs><clipPath id="${u}c"><ellipse cx="32" cy="30" rx="20" ry="14"/></clipPath></defs>
        <ellipse class="ccm-shadow ccm-gr-shadow ccm-lmb" cx="32" cy="68" rx="15" ry="2"/>
        <g class="ccm-gr-hop">
          <g class="ccm-lmb">${kneeLeg('ccm-gr-l', 29, 29, 29, 25)}${kneeLeg('ccm-gr-r', 35, 35, 35, 31)}</g>
          ${lacesBall(u)}
          ${eyes(26.6, 37.4, 27.2, 3.7, 5)}
          ${smile(u + 'm', 32, 33, 5.8, 2.6)}
          <g class="ccm-gr-goggles" fill="none" stroke="var(--ccm-body)" stroke-width="1.5">
            <circle cx="26.6" cy="27.2" r="5.6"/><circle cx="37.4" cy="27.2" r="5.6"/></g>
          <g class="ccm-gr-armL ccm-lmb">${noodle('M13.5 32 Q8 38 10 44')}${glove(10.5, 45, 'fist')}</g>
          <g class="ccm-gr-armR ccm-lmb">${noodle('M50.5 32 Q56 38 54 44')}${glove(53.5, 45, 'fist')}</g>
        </g>`;

    // The Heisman: stiff arm straight out, other arm tucked, one knee driven up.
    // The arms are drawn IN the pose and the raised leg is a planted kneeLeg
    // that the CSS bends into it, so a still render (or reduced motion) shows the
    // finished statue. While busy he starts standing, strikes it, holds, resets.
    const lacesHeisman = u => `
        <defs><clipPath id="${u}c"><ellipse cx="32" cy="30" rx="20" ry="14"/></clipPath></defs>
        <ellipse class="ccm-shadow ccm-lmb" cx="30" cy="68" rx="13" ry="2"/>
        <g class="ccm-hz-body">
          <g class="ccm-lmb">${noodle('M28 42.5 Q26 52 26.5 61')}${shoe(18.5, 59, 12, 'ccm-f-red')}</g>
          <g class="ccm-lmb">${kneeLeg('ccm-hz-k', 37, 37.5, 37.5, 35.5)}</g>
          <g class="ccm-hz-tuck ccm-lmb">${noodle('M51 31 Q57 36.5 49.5 40')}${glove(49, 40.6, 'fist')}</g>
          <g class="ccm-hz-arm ccm-lmb">${noodle('M12.5 29.5 Q7 29 3.5 28.5')}${glove(1.8, 27.4, 'wave')}</g>
          ${lacesBall(u)}
          ${eyes(25.6, 36.4, 27.2, 3.7, 5)}
          ${smile(u + 'm', 31, 33, 5.4, 2.4)}
        </g>`;

    // Heavy lids on their own, so a pose can fade them (lidsFor) or roll the
    // pupils up under them. Same arc as eyes()'s `lid` option.
    const lidsFor = (x1, x2, y, rx, ry, fill, cls) => {
        const ly = y - ry * .15, dx = rx * Math.sqrt(1 - .15 * .15);
        return `<g class="${cls || ''}">${[x1, x2].map(x => `<path class="${fill}" d="M${x - dx} ${ly} A ${rx} ${ry} 0 0 1 ${x + dx} ${ly} Z" stroke="var(--ccm-ink)" stroke-width="1"/>`).join('')}</g>`;
    };

    // The rain cloud for 'raincloud', drawn with its left lobe at x = 26 + dx so
    // each mascot can hang it clear of his ice pack's cap.
    const rainCloud = (dx) => `
        <g class="ccm-rc-cloud">
          <g class="ccm-rc-drops">
            <ellipse class="ccm-f-ice" cx="${27 + dx}" cy="11" rx=".8" ry="1.4"/>
            <ellipse class="ccm-f-ice" cx="${32.5 + dx}" cy="11" rx=".8" ry="1.4"/>
            <ellipse class="ccm-f-ice" cx="${38 + dx}" cy="11" rx=".8" ry="1.4"/>
          </g>
          ${[[26, 6.6, 3.6], [32.5, 5, 4.6], [38.6, 6.8, 3.4]].map(([cx, cy, r]) => `<circle cx="${cx + dx}" cy="${cy}" r="${r}" fill="var(--ccm-shade)" stroke="var(--ccm-ink)" stroke-width="1.2"/>`).join('')}
          <rect x="${24 + dx}" y="6.4" width="16.6" height="3.8" rx="1.9" fill="var(--ccm-shade)" stroke="var(--ccm-ink)" stroke-width="1.2"/>
          ${[[26, 6.6, 2.9], [32.5, 5, 3.9], [38.6, 6.8, 2.7]].map(([cx, cy, r]) => `<circle cx="${cx + dx}" cy="${cy}" r="${r}" fill="var(--ccm-shade)"/>`).join('')}
          <rect x="${24.6 + dx}" y="7" width="15.4" height="2.6" fill="var(--ccm-shade)"/>
        </g>`;

    // Low score, sympathetic: a little cloud drizzles on his ice pack while he
    // slumps, then he shrugs it off: the lids lift, the frown turns into a
    // smile and the cloud drifts away (mascots.css, ccm-rc-*).
    const lacesRaincloud = u => `
        <defs><clipPath id="${u}c"><ellipse cx="32" cy="30" rx="20" ry="14"/></clipPath></defs>
        <ellipse class="ccm-shadow ccm-lmb" cx="32" cy="68" rx="15" ry="2"/>
        <g class="ccm-rc-body">
          <g class="ccm-lmb">${noodle('M26.5 42.5 Q24 51.75 24.5 61')}${noodle('M37.5 42.5 Q40 51.75 39.5 61')}
            ${shoe(16.5, 59, 12, 'ccm-f-red')}${shoe(35.5, 59, 12, 'ccm-f-red')}</g>
          <g class="ccm-lmb">${noodle('M13.5 31 Q7 24 15 17.5')}${glove(15.6, 16.6, 'fist')}</g>
          <g class="ccm-rc-shrug ccm-lmb">${noodle('M50.5 31 Q55 36 54 43')}${glove(54, 44, 'fist')}</g>
          ${lacesBall(u)}
          ${icepack(17, 9.6)}
          ${eyes(26.6, 37.4, 27.2, 3.7, 5)}
          ${lidsFor(26.6, 37.4, 27.2, 3.7, 5, 'ccm-f-leather', 'ccm-rc-lids')}
          <g class="ccm-rc-frown">${frown(32, 35, 3.4)}</g>
          <g class="ccm-rc-smile">${smile(u + 'm', 32, 33, 5, 2.2)}</g>
        </g>
        ${rainCloud(7.5)}`;

    // Handing you an L: a big red block L held out toward you in both gloves,
    // heavy lids and a smirk. While busy he leans in and pushes it at you
    // ("here, this is yours") on a loop (mascots.css, ccm-hl-*).
    const lacesHandL = u => `
        <defs><clipPath id="${u}c"><ellipse cx="32" cy="30" rx="20" ry="14"/></clipPath></defs>
        <ellipse class="ccm-shadow ccm-lmb" cx="34" cy="68" rx="17" ry="2"/>
        <g class="ccm-hl-body">
          <g class="ccm-lmb">${noodle('M24.5 42.5 Q22 51.75 22.5 61')}${noodle('M35.5 42.5 Q38 51.75 37.5 61')}
            ${shoe(14.5, 59, 12, 'ccm-f-red')}${shoe(33.5, 59, 12, 'ccm-f-red')}</g>
          <g transform="translate(-2 0)">${lacesBall(u)}</g>   <!-- the ball sits 2 left of center to make room for the L -->
          ${eyes(24.6, 35.4, 27.2, 3.7, 5)}${lidsFor(24.6, 35.4, 27.2, 3.7, 5, 'ccm-f-leather')}
          <path class="ccm-frown" d="M25.6 34.4 Q30 36.4 34.6 33"/>
          <g class="ccm-hl-offer">
            <g class="ccm-lmb">${noodle('M11.5 32 Q22 46 43 35')}${noodle('M48.5 32 Q61 33 59.6 39.4')}</g>
            <path class="ccm-f-red ccm-o" d="M42 13 H50 V36 H63 V44 H42 Z"/>
            <path d="M44 15 V41.5 H61" fill="none" stroke="var(--ccm-body)" stroke-width="1" opacity=".55" stroke-linecap="round"/>
            <g class="ccm-lmb">${glove(44.4, 33.6, 'fist')}${glove(59.6, 40, 'fist')}</g>
          </g>
        </g>`;

    // ---------- Ties ----------
    // Tie: two Laces in a tug-of-war with each other, on a wide 128x72
    // drawing (WIDE below). The left one is the tug drawing without its rope;
    // the right one is the same drawing mirrored. One shared rope with a red
    // flag at the middle drifts toward whoever is gaining; they trade the edge
    // and it always comes back to dead center (mascots.css, ccm-tw2-*).
    const tugger = u => `
          <g class="ccm-lmb">${noodle('M26.5 42.5 Q31 52 35 60.5')}${noodle('M37.5 42.5 Q43 51 46.5 59.5')}
            ${shoe(30, 58.6, 12, 'ccm-f-red')}${shoe(41.5, 57.6, 12, 'ccm-f-red')}
            ${noodle('M14 31 Q30 34 48 40.4')}${noodle('M50 32 Q55 34 55.4 39.6')}</g>
          ${lacesBall(u)}  <!-- both copies clip with the same #${u}c: it applies in each copy's own (mirrored) space -->
          <g stroke="var(--ccm-ink)" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" fill="none">
            <path d="M24 24.6 L28.4 27 L24 29.4"/><path d="M40 24.6 L35.6 27 L40 29.4"/></g>
          <rect class="ccm-f-ink" x="27" y="31.6" width="10" height="4.6" rx="1.6"/>
          <rect class="ccm-f-body" x="27.8" y="32.3" width="8.4" height="3.2" rx=".8"/>
          <line x1="27.8" y1="33.9" x2="36.2" y2="33.9" stroke="var(--ccm-ink)" stroke-width=".6"/>
          <ellipse class="ccm-f-ice ccm-tw-sweat" cx="14.6" cy="20" rx="1" ry="1.6"/>`;
    const lacesTugDuo = u => `
        <defs><clipPath id="${u}c"><ellipse cx="32" cy="30" rx="20" ry="14"/></clipPath></defs>
        <ellipse class="ccm-shadow ccm-lmb" cx="38" cy="68" rx="15" ry="2"/>
        <ellipse class="ccm-shadow ccm-lmb" cx="90" cy="68" rx="15" ry="2"/>
        <g class="ccm-tw2-rope ccm-lmb">
          <line x1="44" y1="40.4" x2="84" y2="40.4" stroke="var(--ccm-ink)" stroke-width="3.6" stroke-linecap="round"/>
          <line x1="44" y1="40.4" x2="84" y2="40.4" stroke="#C9A36A" stroke-width="2.2" stroke-linecap="round"/>
          <g stroke="#8B6B3A" stroke-width=".6">${[48, 52, 56, 60, 66, 70, 74, 78].map(x => `<line x1="${x}" y1="39.4" x2="${x + 1.4}" y2="41.4"/>`).join('')}</g>
          <path class="ccm-f-red ccm-o" d="M62.6 40.4 H65.4 L64.8 47 L64 45.4 L63.2 47 Z"/>
        </g>
        <g class="ccm-tw-lean"><g class="ccm-tw2-pull">${tugger(u)}</g>
          <g class="ccm-lmb">${glove(48.4, 40.4, 'fist')}${glove(55.6, 40.4, 'fist')}</g></g>
        <g style="transform-box: view-box" transform="translate(128 0) scale(-1 1)">
          <g class="ccm-tw-lean"><g class="ccm-tw2-pull ccm-tw2-late">${tugger(u)}</g>
            <g class="ccm-lmb">${glove(48.4, 40.4, 'fist')}${glove(55.6, 40.4, 'fist')}</g></g>
        </g>`;

    // ---------- Laces: leather football, red cleats ----------
    const laces = (u, pose) => {
        if (pose === 'tugduo') return lacesTugDuo(u);
        // Dribbles' moves, asked of Laces, map to his football counterparts.
        if (pose === 'dunkhang') pose = 'griddy';
        if (pose === 'netcut') pose = 'heisman';
        if (pose === 'spinL') pose = 'handL';
        if (pose === 'jumpball') pose = 'tugduo';
        if (pose === 'handL') return lacesHandL(u);
        if (pose === 'griddy') return lacesGriddy(u);
        if (pose === 'heisman') return lacesHeisman(u);
        if (pose === 'raincloud') return lacesRaincloud(u);
        const sad = pose === 'icepack';
        const left = pose === 'trophy'
            ? `<g class="ccm-wave ccm-lmb">${noodle('M13.5 31 Q6 27 8 18')}${trophy(8, 1.6)}${glove(8, 15, 'fist')}</g>`
            : sad
                ? `<g class="ccm-lmb">${noodle('M13.5 31 Q7 24 15 17.5')}${glove(15.6, 16.6, 'fist')}</g>`
                : `<g class="ccm-wave ccm-lmb">${noodle('M13.5 31 Q6 27 8 18')}${pennant()}${glove(8, 15, 'fist')}</g>`;
        const right = sad
            ? `<g class="ccm-lmb">${noodle('M50.5 31 Q55 36 54 43')}${glove(54, 44, 'fist')}</g>`
            : `<g class="ccm-pump ccm-lmb">${noodle('M50.5 31 Q58 31 56 22.5')}${glove(56, 19.5, 'wave')}</g>`;
        return `
        <defs><clipPath id="${u}c"><ellipse cx="32" cy="30" rx="20" ry="14"/></clipPath></defs>
        <ellipse class="ccm-shadow ccm-lmb" cx="32" cy="68" rx="15" ry="2"/>
        <g class="ccm-fig">
          <g class="ccm-lmb">${noodle('M26.5 42.5 Q24 51.75 24.5 61')}${noodle('M37.5 42.5 Q40 51.75 39.5 61')}
            ${shoe(16.5, 59, 12, 'ccm-f-red')}${shoe(35.5, 59, 12, 'ccm-f-red')}</g>
          ${left}${right}
          <ellipse class="ccm-f-leather" cx="32" cy="30" rx="20" ry="14"/>
          <g clip-path="url(#${u}c)">
            <rect class="ccm-f-leather-shade" x="12" y="35" width="40" height="14"/>
            <rect class="ccm-f-body" x="15.6" y="16" width="2.2" height="28"/>
            <rect class="ccm-f-body" x="46.2" y="16" width="2.2" height="28"/>
          </g>
          <ellipse class="ccm-o ccm-none" cx="32" cy="30" rx="20" ry="14"/>
          <rect class="ccm-f-body" x="25.5" y="19.3" width="13" height="1.5" rx=".75"/>
          ${[-4.5, -1.5, 1.5, 4.5].map(d => `<line class="ccm-lace" x1="${32 + d}" y1="18.2" x2="${32 + d}" y2="21.9"/>`).join('')}
          ${sad ? icepack(17, 9.6) : ''}
          ${eyes(26.6, 37.4, 27.2, 3.7, 5, sad ? 'ccm-f-leather' : null)}
          ${sad ? frown(32, 35, 3.4) : smile(u + 'm', 32, 33, 5.8, 2.6)}
        </g>`;
    };

    // ---------- Dribbles: orange basketball, violet sneakers ----------
    // ---------- Dribbles' own moves (his answers to Laces' football moves) ----------
    // His orange ball body at (cx, cy, r), clipped by ${u}c (defined by the caller).
    const dBall = (u, cx, cy, r) => {
        const off = r * 1.35, sr = r * .885, sy = cy - r * .15;
        return `<circle class="ccm-f-ball" cx="${cx}" cy="${cy}" r="${r}"/>
          <g clip-path="url(#${u}c)">
            <rect class="ccm-f-ball-shade" x="${cx - r}" y="${cy + r * .42}" width="${r * 2}" height="${r}"/>
            <g class="ccm-seam"><line x1="${cx}" y1="${cy - r}" x2="${cx}" y2="${cy + r}"/><line x1="${cx - r}" y1="${sy}" x2="${cx + r}" y2="${sy}"/>
              <circle cx="${cx - off}" cy="${sy}" r="${sr}"/><circle cx="${cx + off}" cy="${sy}" r="${sr}"/></g>
          </g>
          <circle class="ccm-o ccm-none" cx="${cx}" cy="${cy}" r="${r}"/>`;
    };
    const dDefs = (u, cx, cy, r) => `<defs><clipPath id="${u}c"><circle cx="${cx}" cy="${cy}" r="${r}"/></clipPath></defs>`;
    const smirk = (x1, y1, x2, y2) => `<path class="ccm-frown" d="M${x1} ${y1} Q${(x1 + x2) / 2} ${y1 + 1.6} ${x2} ${y2}"/>`;
    const dLegs = `<g class="ccm-lmb">${noodle('M27 42 Q25.5 52 25.5 61')}${noodle('M37 42 Q38.5 52 38.5 61')}
            ${shoe(17.5, 59, 12, 'ccm-f-violet')}${shoe(34.5, 59, 12, 'ccm-f-violet')}</g>`;
    const dHip = `<g class="ccm-lmb">${noodle('M15.6 31 Q7 34 12.5 40.5')}${glove(13.5, 40, 'fist')}</g>`;

    // Season high: the dunk-and-hang. One hand on the rim, the other pumping,
    // legs dangling; he swings from the rim (ccm-dh-*).
    const dribblesDunk = u => `
        ${dDefs(u, 32, 33, 15)}
        <rect class="ccm-f-body ccm-o" x="14" y=".6" width="36" height="8.4" rx="1.4"/>
        <rect x="25" y="2.6" width="14" height="6.4" fill="none" stroke="var(--ccm-ball)" stroke-width="1.2"/>
        <g class="ccm-lmb net"><g stroke="var(--ccm-shade)" stroke-width="1" fill="none">
          <path d="M20 11 L23 19 M26 11 L27 18 M38 11 L37 18 M44 11 L41 19"/></g></g>
        <rect class="ccm-f-red ccm-o" x="17" y="8.6" width="30" height="2.8" rx="1.4"/>
        <g class="ccm-dh-swing">
          <g class="ccm-lmb">${noodle('M28 47 Q27 54 26.5 61')}${noodle('M36 47 Q37 54 38 60.5')}
            ${shoe(17, 59, 12, 'ccm-f-violet')}${shoe(34, 58.6, 12, 'ccm-f-violet')}
            ${noodle('M44.5 26 Q48 16 41 11.6')}</g>
          <g class="ccm-dh-pump ccm-lmb">${noodle('M18.5 30 Q9 27 11 18')}${glove(11, 15.4, 'fist')}</g>
          ${dBall(u, 32, 33, 15)}
          ${eyes(26.8, 37.2, 31.6, 3.6, 5.2)}
          ${smile(u + 'm', 32, 38.6, 5.4, 2.6)}
          <g class="ccm-lmb">${glove(40.6, 10, 'fist')}</g>
        </g>`;

    // #1: cutting down the net, the college champion's ritual. He stands on a
    // little step ladder under the rim, snipping the net with scissors in one
    // hand and waving a cut piece of it overhead in the other (ccm-nc-*).
    const dribblesNetCut = u => `
        ${dDefs(u, 26, 32, 13)}
        <ellipse class="ccm-shadow ccm-lmb" cx="28" cy="68" rx="16" ry="2"/>
        <rect class="ccm-f-body ccm-o" x="34" y=".6" width="26" height="6.2" rx="1.2"/>
        <rect x="42" y="2.2" width="10" height="4.6" fill="none" stroke="var(--ccm-ball)" stroke-width="1.1"/>
        <g fill="none" stroke="var(--ccm-shade)" stroke-width="1" stroke-linejoin="round">
          <path d="M33 9 L36 18 L41 9 L44 18 L49 9 L52 18 L57 9"/><path d="M36 18 L52 18"/>
          <path d="M57 9 L58.6 15.6"/></g>
        <rect class="ccm-f-red ccm-o" x="31" y="6.8" width="28" height="2.6" rx="1.3"/>
        <g class="ccm-lmb">
          <line x1="17" y1="53" x2="13" y2="66" stroke="var(--ccm-ink)" stroke-width="3" stroke-linecap="round"/>
          <line x1="35" y1="53" x2="39" y2="66" stroke="var(--ccm-ink)" stroke-width="3" stroke-linecap="round"/>
          <line x1="17" y1="53" x2="13" y2="66" stroke="var(--ccm-gold)" stroke-width="1.6" stroke-linecap="round"/>
          <line x1="35" y1="53" x2="39" y2="66" stroke="var(--ccm-gold)" stroke-width="1.6" stroke-linecap="round"/>
          <rect class="ccm-f-gold ccm-o" x="14.4" y="59" width="23.2" height="1.8" rx=".9"/>
          <rect class="ccm-f-gold ccm-o" x="15" y="51.4" width="22" height="2.6" rx="1.2"/>
        </g>
        <g class="ccm-nc-bob">
          <g class="ccm-lmb">${noodle('M22 44 Q21.5 47 21.5 49')}${noodle('M30 44 Q30.5 47 30.5 49')}
            ${shoe(12.5, 46, 11, 'ccm-f-violet')}${shoe(28.5, 46, 11, 'ccm-f-violet')}</g>
          <g class="ccm-nc-wave ccm-lmb">${noodle('M13.6 29 Q7 24 9 14.6')}
            <path d="M5 2.6 H13 L11.4 9.6 H6.6 Z" fill="none" stroke="var(--ccm-body)" stroke-width="1" stroke-linejoin="round"/>
            <path d="M5.6 4.8 L12.4 4.8 M6.2 7.2 L11.8 7.2 M7.6 2.6 L8.4 9.6 M10.4 2.6 L9.6 9.6" stroke="var(--ccm-body)" stroke-width=".7"/>
            ${glove(9, 12.4, 'fist')}</g>
          <g class="ccm-lmb">${noodle('M38 27 Q44 22 45 17.4')}</g>
          ${dBall(u, 26, 32, 13)}
          ${eyes(21.6, 30.4, 30.4, 3.3, 4.8)}
          ${smile(u + 'm', 26, 36.4, 4.8, 2.4)}
          <g class="ccm-nc-snip ccm-lmb">
            <line x1="45.6" y1="15.8" x2="52.6" y2="9.4" stroke="var(--ccm-ink)" stroke-width="1.8" stroke-linecap="round"/>
            <line x1="45.6" y1="15.8" x2="52.6" y2="9.4" stroke="var(--ccm-shade)" stroke-width=".8" stroke-linecap="round"/>
            <g class="ccm-nc-blade"><line x1="45.6" y1="15.8" x2="53.6" y2="12" stroke="var(--ccm-ink)" stroke-width="1.8" stroke-linecap="round"/>
              <line x1="45.6" y1="15.8" x2="53.6" y2="12" stroke="var(--ccm-shade)" stroke-width=".8" stroke-linecap="round"/></g>
            ${glove(45, 17.4, 'fist')}
          </g>
        </g>`;

    // H2H loss: spinning the L. The foam finger up, a red L spinning on its
    // tip like a ball on a fingertip; smug lids and a smirk (ccm-sl-*).
    const dribblesSpinL = u => `
        ${dDefs(u, 32, 27, 17)}
        <ellipse class="ccm-shadow ccm-lmb" cx="32" cy="68" rx="15" ry="2"/>
        <g class="ccm-fig">
          ${dLegs}${dHip}
          <g class="ccm-lmb">${noodle('M48.4 30 Q53 34 53.6 33.4')}${foamFinger(46, 12, 15)}</g>
          ${dBall(u, 32, 27, 17)}
          ${eyes(26.4, 37.6, 25.2, 4, 5.8)}${lidsFor(26.4, 37.6, 25.2, 4, 5.8, 'ccm-f-ball')}
          ${smirk(28.6, 34.2, 36.6, 32.6)}
          <g class="ccm-sl-spin ccm-lmb"><path class="ccm-f-red ccm-o" d="M53.2 .4 H56.4 V7 H60.8 V10 H53.2 Z"/></g>
        </g>`;

    // H2H tie: a jump ball. Two Dribbles (the right one mirrored) take turns
    // leaping for a ball floating between them; it hops a little on each try
    // and neither ever reaches it. Wide 128x72 (ccm-jb-*).
    const jumper = u => `
          <g class="ccm-lmb">${noodle('M27 47 Q22 52 25 58')}${noodle('M36 47 Q38 53 35 58.6')}
            ${shoe(16, 56.4, 12, 'ccm-f-violet')}${shoe(27, 57, 12, 'ccm-f-violet')}
            ${noodle('M18.5 36 Q11 40 12 46')}${noodle('M45 29 Q53 20 56.4 11.4')}</g>
          ${dBall(u, 32, 34, 15)}
          ${eyes(28.6, 38.6, 31, 3.4, 5)}
          ${smile(u + 'm', 33.6, 38, 4.6, 2.2)}
          <g class="ccm-lmb">${glove(12.4, 46.6, 'fist')}${glove(57, 9, 'wave')}</g>`;
    const dribblesJumpBall = u => `
        ${dDefs(u, 32, 34, 15)}
        <ellipse class="ccm-shadow ccm-jb-shadow ccm-lmb" cx="30" cy="68" rx="13" ry="2"/>
        <ellipse class="ccm-shadow ccm-jb-shadow ccm-jb-late ccm-lmb" cx="98" cy="68" rx="13" ry="2"/>
        <g class="ccm-jb-ball ccm-lmb">
          <circle class="ccm-f-ball ccm-o" cx="64" cy="1.8" r="4.2"/>
          <g class="ccm-seam" stroke-width=".8"><line x1="64" y1="-2.4" x2="64" y2="6"/><line x1="59.8" y1="1.2" x2="68.2" y2="1.2"/></g>
        </g>
        <g class="ccm-jb-jump">${jumper(u)}</g>
        <g style="transform-box: view-box" transform="translate(128 0) scale(-1 1)"><g class="ccm-jb-jump ccm-jb-late">${jumper(u)}</g></g>`;

    const dribbles = (u, pose) => {
        if (pose === 'dunkhang' || pose === 'griddy') return dribblesDunk(u);
        if (pose === 'netcut' || pose === 'heisman') return dribblesNetCut(u);
        if (pose === 'spinL' || pose === 'handL') return dribblesSpinL(u);
        if (pose === 'jumpball' || pose === 'tugduo') return dribblesJumpBall(u);
        // 'raincloud' is the ice-pack pose plus the cloud, a shrug from the hip
        // hand, and lids and mouth that can lift (mascots.css, ccm-rc-*).
        const rc = pose === 'raincloud';
        const sad = pose === 'icepack' || rc;
        const off = 17 * 1.35, sr = 17 * .885, sy = 27 - 17 * .15;
        const right = pose === 'trophy'
            ? `<g class="ccm-wag ccm-lmb">${noodle('M48.4 26 Q55 26.5 55 21')}${trophy(55, 3.6)}${glove(55, 18, 'fist')}</g>`
            : sad
                ? `<g class="ccm-lmb">${noodle('M48.4 24 Q55 17 47.6 12')}${glove(47, 11.4, 'fist')}</g>`
                : `<g class="ccm-wag ccm-lmb">${noodle('M48.4 26 Q55 26.5 55 23')}${foamFinger(47, 2, 16)}</g>`;
        const kick = sad
            ? `<g class="ccm-lmb">${noodle('M37 42 Q38.5 52 38.5 61')}${shoe(34.5, 59, 12, 'ccm-f-violet')}</g>`
            : `<g class="ccm-kick ccm-lmb">${noodle('M37 42 Q45 49 46 56.5')}${shoe(41, 55, 12, 'ccm-f-violet')}</g>`;
        return `
        <defs><clipPath id="${u}c"><circle cx="32" cy="27" r="17"/></clipPath></defs>
        <ellipse class="ccm-shadow ccm-lmb" cx="32" cy="68" rx="15" ry="2"/>
        <g class="${rc ? 'ccm-rc-body' : 'ccm-fig'}">
          <g class="ccm-lmb">${noodle('M27 42 Q25.5 52 25.5 61')}${shoe(17.5, 59, 12, 'ccm-f-violet')}</g>
          ${kick}
          <g class="${rc ? 'ccm-rc-shrugL ' : ''}ccm-lmb">${noodle('M15.6 31 Q7 34 12.5 40.5')}${glove(13.5, 40, 'fist')}</g>
          ${right}
          <circle class="ccm-f-ball" cx="32" cy="27" r="17"/>
          <g clip-path="url(#${u}c)">
            <rect class="ccm-f-ball-shade" x="15" y="34.2" width="34" height="17"/>
            <g class="ccm-seam"><line x1="32" y1="9" x2="32" y2="45"/><line x1="14" y1="${sy}" x2="50" y2="${sy}"/>
              <circle cx="${32 - off}" cy="${sy}" r="${sr}"/><circle cx="${32 + off}" cy="${sy}" r="${sr}"/></g>
          </g>
          <circle class="ccm-o ccm-none" cx="32" cy="27" r="17"/>
          ${sad ? icepack(31, 6.2) : ''}
          ${rc
            ? `${eyes(26.4, 37.6, 25.2, 4, 5.8)}${lidsFor(26.4, 37.6, 25.2, 4, 5.8, 'ccm-f-ball', 'ccm-rc-lids')}
               <g class="ccm-rc-frown">${frown(32, 35, 3.6)}</g><g class="ccm-rc-smile">${smile(u + 'm', 32, 33.4, 5.6, 2.6)}</g>`
            : `${eyes(26.4, 37.6, 25.2, 4, 5.8, sad ? 'ccm-f-ball' : null)}
               ${sad ? frown(32, 35, 3.6) : smile(u + 'm', 32, 33.4, 6.4, 3.2)}`}
        </g>
        ${rc ? rainCloud(-9) : ''}`;
    };

    const DRAW = { football: laces, basketball: dribbles };
    // Poses drawn on a wider canvas than one mascot (two of him). Each Laces move
    // has a Dribbles counterpart and the other way round (dribbles() maps them),
    // so a tie is wide for both. One answer for html() and svg(): the viewBox,
    // or null for the 64x72 default.
    const WIDE_POSES = ['tugduo', 'jumpball'];
    const wideBox = (sport, pose, size) => (size !== 'head' && WIDE_POSES.indexOf(pose) !== -1) ? '0 0 128 72' : null;
    const CROP = { football: '10 8 44 44', basketball: '12 7 40 40' };
    const NAME = { football: 'Laces', basketball: 'Dribbles' };

    // The sport this page is about. A page pinned to football (data-page-sport, e.g.
    // the game detail page) gets Laces even inside a basketball league; basketball
    // only when the viewed league is a basketball league.
    function sport(el) {
        const pinned = (el && el.closest && el.closest('[data-page-sport]')) || document.body;
        const fixed = pinned && pinned.getAttribute && pinned.getAttribute('data-page-sport');
        if (fixed === 'football' || fixed === 'basketball') return fixed;
        try {
            return window.ccLeague && window.ccLeague.sport && window.ccLeague.sport() === 'basketball' ? 'basketball' : 'football';
        } catch (e) { return 'football'; }
    }

    function svg(opts) {
        const o = opts || {};
        const sp = o.sport === 'basketball' ? 'basketball' : 'football';
        const head = o.size === 'head';
        const u = 'ccm' + (uid++);
        const wide = wideBox(sp, o.pose, o.size);
        const a11y = o.label ? `role="img" aria-label="${esc(o.label)}"` : 'aria-hidden="true" focusable="false"';
        return `<svg class="ccm ${head ? 'ccm-head' : 'ccm-full'}" viewBox="${head ? CROP[sp] : (wide || '0 0 64 72')}" data-mascot="${NAME[sp]}" ${a11y}>`
            + DRAW[sp](u, o.pose || 'cheer') + '</svg>';
    }

    function html(opts) {
        const o = Object.assign({ size: 'full' }, opts);
        if (!o.sport) o.sport = sport();
        const wide = wideBox(o.sport, o.pose, o.size);
        return `<span class="ccm-wrap ccm-size-${o.size}${wide ? ' ccm-wide' : ''}${o.busy ? ' is-busy' : ''}${o.className ? ' ' + o.className : ''}">${svg(o)}</span>`;
    }

    // <span data-ccm="head|full" data-ccm-sport="football|basketball" data-ccm-pose="…" data-ccm-busy></span>
    // A missing data-ccm-sport means "whatever this page is about".
    function hydrate(root) {
        (root || document).querySelectorAll('[data-ccm]').forEach(el => {
            if (el.dataset.ccmDone) return;
            el.dataset.ccmDone = '1';
            el.innerHTML = html({
                size: el.dataset.ccm === 'head' ? 'head' : 'full',
                sport: el.dataset.ccmSport || sport(el),
                pose: el.dataset.ccmPose,
                busy: el.hasAttribute('data-ccm-busy'),
                label: el.dataset.ccmLabel
            });
        });
    }

    function setBusy(el, on) {
        if (!el) return;
        const wrap = el.classList && el.classList.contains('ccm-wrap') ? el : el.querySelector && el.querySelector('.ccm-wrap');
        if (wrap) wrap.classList.toggle('is-busy', !!on);
    }

    window.ccMascot = { html, svg, hydrate, setBusy, sport };

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => hydrate(document));
    else hydrate(document);
})();
