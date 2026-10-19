// The logged-out root's document: link-preview tags, then a hand-off to
// /login. campusclash.io itself is shared around, and every app page is
// auth-gated, so this is the only place its preview can come from.
//
// Sport-neutral on purpose (#321): the site is football AND basketball, so the
// card is the parent crest and the copy names neither sport alone.

const SITE = 'https://campusclash.io';
const TITLE = 'Campus Clash — College Fantasy Sports';
const DESC = 'Fantasy college football and basketball where you draft entire programs, not players.';
const OG_IMAGE = SITE + '/images/campus-clash-parent-og.png';

// Pure. Humans are sent on via location.replace (not a 302 or meta-refresh) so
// the hop leaves no history entry and Back still works.
function html() {
    return '<!DOCTYPE html><html lang="en"><head>'
        + '<meta charset="utf-8">'
        + '<meta name="viewport" content="width=device-width, initial-scale=1">'
        + '<meta name="robots" content="noindex">'
        + '<title>' + TITLE + '</title>'
        + '<meta name="description" content="' + DESC + '">'
        // Open Graph (iMessage, Facebook, Slack, LinkedIn, …)
        + '<meta property="og:type" content="website">'
        + '<meta property="og:site_name" content="Campus Clash">'
        + '<meta property="og:url" content="' + SITE + '/">'
        + '<meta property="og:title" content="' + TITLE + '">'
        + '<meta property="og:description" content="' + DESC + '">'
        + '<meta property="og:image" content="' + OG_IMAGE + '">'
        + '<meta property="og:image:secure_url" content="' + OG_IMAGE + '">'
        + '<meta property="og:image:type" content="image/png">'
        + '<meta property="og:image:width" content="1200">'
        + '<meta property="og:image:height" content="630">'
        + '<meta property="og:image:alt" content="Campus Clash">'
        // Twitter/X large-image card
        + '<meta name="twitter:card" content="summary_large_image">'
        + '<meta name="twitter:title" content="' + TITLE + '">'
        + '<meta name="twitter:description" content="' + DESC + '">'
        + '<meta name="twitter:image" content="' + OG_IMAGE + '">'
        + '<style>html,body{margin:0;background:#101322;color:#F4F6FB;'
        + 'font-family:sans-serif}a{color:#ED5858}</style>'
        + '</head><body>'
        + '<script>location.replace("/login");</script>'
        + '<noscript><p style="padding:24px"><a href="/login">Continue to Campus Clash</a></p></noscript>'
        + '</body></html>';
}

module.exports = { html, SITE, TITLE, DESC, OG_IMAGE };
