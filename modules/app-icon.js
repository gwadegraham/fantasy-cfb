// The home-screen icon a visitor picked on /install.
//
// A web app cannot change its icon once installed: iOS copies the
// apple-touch-icon at Add to Home Screen and never looks again, and Android
// re-reads the manifest only on its own schedule. So the choice has to be made
// BEFORE installing, and every page has to agree on it — Android's periodic
// manifest check would otherwise "update" a picked icon back to the default.
//
// Hence a cookie, read on every request: the apple-touch-icon link
// (views/partials/favicons.ejs, /install's shell) and /manifest.json both come
// from it. The cookie is client-written and untrusted; anything not in ICONS
// is the default. No login involved, so it works on the public /install page.
//
// The PNGs are design/tools/render_app_icon_variants.sh's output; the drawings
// are design/app-icon/variants.html. An id is a contract with every browser
// that has the cookie — renaming one quietly resets those people to classic.

const fs = require('fs');
const path = require('path');

const COOKIE = 'cc_app_icon';
const DEFAULT = 'classic';

const ICONS = [
    { id: 'classic',  label: 'Classic',  group: 'Campus Clash' },
    { id: 'red',      label: 'Red',      group: 'Campus Clash' },
    { id: 'cream',    label: 'Cream',    group: 'Campus Clash' },
    { id: 'gold',     label: 'Gold',     group: 'Campus Clash' },
    { id: 'violet',   label: 'Violet',   group: 'Campus Clash' },
    { id: 'football', label: 'Football', group: 'Sports' },
    { id: 'hoops',    label: 'Hoops',    group: 'Sports' },
    { id: 'laces',    label: 'Laces',    group: 'Mascots' },
    { id: 'dribbles', label: 'Dribbles', group: 'Mascots' }
];
const IDS = new Set(ICONS.map(i => i.id));

// 'classic' is the original set at its original names, so nobody who
// installed before this existed sees a changed icon URL.
function src(id, px) {
    return id === DEFAULT ? `/images/app-icon-${px}.png` : `/images/app-icons/${id}-${px}.png`;
}

function valid(id) {
    return IDS.has(id) ? id : DEFAULT;
}

// ?icon= wins over the cookie so /install's manifest link reflects a choice
// the moment it is made. It does NOT replace the cookie: app pages link a bare
// /manifest.json, so without the cookie Android's later re-check of the
// manifest drifts an installed app back to classic.
function fromReq(req) {
    const q = req && req.query && req.query.icon;
    if (typeof q === 'string' && IDS.has(q)) return q;
    const raw = (req && req.headers && req.headers.cookie) || '';
    for (const part of raw.split(';')) {
        const [k, ...v] = part.trim().split('=');
        if (k === COOKIE) return valid(v.join('='));
    }
    return DEFAULT;
}

// The manifest with its icons swapped. Everything else is public/manifest.json,
// read once — it is a deploy-time file.
let base = null;
function manifest(id) {
    if (!base) base = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'public', 'manifest.json'), 'utf8'));
    const icon = valid(id);
    return Object.assign({}, base, {
        icons: [
            { src: src(icon, 192), sizes: '192x192', type: 'image/png' },
            { src: src(icon, 512), sizes: '512x512', type: 'image/png' },
            // Every variant keeps its ink in the inner-80% circle, so the 512
            // doubles as the maskable icon, as the classic one always has.
            { src: src(icon, 512), sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ]
    });
}

// res.locals.appIconTouch for the favicons partial, and the dynamic manifest.
// Mount ABOVE express.static so this, not public/manifest.json, answers.
function mount(app) {
    app.use((req, res, next) => {
        res.locals.appIconTouch = src(fromReq(req), 180);
        next();
    });
    app.get('/manifest.json', (req, res) => {
        // Varies per visitor: never let a cache hand one person's icon to another.
        res.set('Cache-Control', 'private, no-cache');
        res.set('Vary', 'Cookie');
        res.type('application/manifest+json').send(JSON.stringify(manifest(fromReq(req))));
    });
}

module.exports = { COOKIE, DEFAULT, ICONS, src, valid, fromReq, manifest, mount };
