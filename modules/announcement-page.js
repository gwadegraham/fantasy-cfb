// Public, no-login announcement pages: an HTML fragment from
// docs/announcements/ wrapped in a standalone shell with link-preview tags.
//
// Served from our own domain because a claude.ai artifact is private
// (owner-only) and 404s for anyone it is sent to. authRequired is false and
// these handlers do not gate on auth, so they need no login — which is also
// why each path is on modules/identity-guard.js's ALLOW_PATH list.
//
// Two pages so far: /season-preview (football, Jul 2026) and /hardwood
// (basketball, Oct 2026).

const fs = require('fs');
const path = require('path');

// Canonical, absolute URLs so link previews (iMessage, Slack, etc.) resolve
// the image no matter where the page is opened from.
const SITE = 'https://campusclash.io';

const PAGES = {
    '/season-preview': {
        file: 'docs/announcements/offseason-2026.html',
        docTitle: 'Campus Clash — The 2026 Season Is Loaded',
        title: 'The 2026 Season Is Loaded — Campus Clash',
        desc: 'We rebuilt the league from the turf up — new ways to play, '
            + 'new places to go, and a home screen that feels like game day. '
            + "Here's everything worth knowing before kickoff.",
        image: '/images/season-preview-og.png',
        imageType: 'image/png',
        imageAlt: 'Campus Clash — The 2026 Season Is Loaded'
    },
    // Basketball's launch. Its preview card is the Hardwood badge on navy
    // (#321): design/tools/make_badge_og.py.
    '/hardwood': {
        file: 'docs/announcements/hardwood-2026.html',
        docTitle: 'Campus Clash Hardwood',
        title: 'Campus Clash Hardwood — fantasy college basketball',
        desc: 'Draft ten teams and ride them from November tip-off to the Final Four. '
            + 'How the draft, the scoring, the weekly Captain and head-to-head games, '
            + 'and March work, and how to join.',
        image: '/images/hardwood-og.png',
        imageType: 'image/png',
        imageAlt: 'The Campus Clash Hardwood badge',
        icons: '<link rel="icon" type="image/svg+xml" href="/images/favicon-hardwood.svg">'
            + '<link rel="icon" type="image/png" sizes="32x32" href="/images/favicon-hardwood-32.png">'
            + '<link rel="apple-touch-icon" href="/images/apple-touch-icon-hardwood.png">'
    }
};

// The whole document for one page, given its fragment. Pure.
function shell(urlPath, page, fragment) {
    const og = SITE + page.image;
    return '<!DOCTYPE html><html lang="en"><head>'
        + '<meta charset="utf-8">'
        + '<meta name="viewport" content="width=device-width, initial-scale=1">'
        + '<meta name="robots" content="noindex">'
        + '<title>' + page.docTitle + '</title>'
        + (page.icons || '')
        + '<meta name="description" content="' + page.desc + '">'
        // Open Graph (iMessage, Facebook, Slack, LinkedIn, …)
        + '<meta property="og:type" content="website">'
        + '<meta property="og:site_name" content="Campus Clash">'
        + '<meta property="og:url" content="' + SITE + urlPath + '">'
        + '<meta property="og:title" content="' + page.title + '">'
        + '<meta property="og:description" content="' + page.desc + '">'
        + '<meta property="og:image" content="' + og + '">'
        + '<meta property="og:image:secure_url" content="' + og + '">'
        + '<meta property="og:image:type" content="' + page.imageType + '">'
        + '<meta property="og:image:width" content="1200">'
        + '<meta property="og:image:height" content="630">'
        + '<meta property="og:image:alt" content="' + page.imageAlt + '">'
        // Twitter/X large-image card
        + '<meta name="twitter:card" content="summary_large_image">'
        + '<meta name="twitter:title" content="' + page.title + '">'
        + '<meta name="twitter:description" content="' + page.desc + '">'
        + '<meta name="twitter:image" content="' + og + '">'
        + '<style>html,body{margin:0;background:#101322}</style>'
        + '</head><body>' + fragment + '</body></html>';
}

// Mounts every page on `app`. `root` is the repo root the fragments are read
// from, on each request, so editing one needs no restart.
function mount(app, root) {
    Object.entries(PAGES).forEach(([urlPath, page]) => {
        app.get(urlPath, (req, res) => {
            try {
                const fragment = fs.readFileSync(path.join(root, page.file), 'utf8');
                res.type('html').send(shell(urlPath, page, fragment));
            } catch (err) {
                res.status(404).send('Announcement not found.');
            }
        });
    });
}

module.exports = { mount, shell, PAGES, SITE };
