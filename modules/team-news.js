// A team's news, from ESPN's public news feed: headlines and links only.
//
// ---- the API ----
//
// site.api.espn.com/.../news?team=<espnId> is ESPN's public, UNDOCUMENTED
// feed (the same family as the scoreboard modules/hoops-espn-tip-times.js
// reads): no key, no quota, no promise it stays put. Anything that goes wrong
// answers an empty list with `error` set; nothing here throws for ESPN.
//
// The id is ESPN's own team id. Football's `team.id` already IS it (CFBD keys
// teams on ESPN ids: Miami 2390, Alabama 333); basketball's is
// HoopsTeam.sourceId, because CBBD has ids of its own.
//
// ---- what is kept ----
//
// The feed for a team is every article TAGGED with it, and for a top-25 team
// most of those are league-wide roundups: on 28 Oct 2026 Miami's 50 included
// Bubble Watch (70 teams tagged), bowl projections (43) and power rankings
// (25). An article tagging more than MAX_TEAMS teams is dropped; that left
// 17 real Miami stories (game recaps, previews, features). Small schools'
// feeds are already all their own and lose nothing.
//
// The same story often appears twice (a Media clip and a story with one
// headline), so headlines are de-duplicated. ESPN does not answer strictly
// newest first, so the list is sorted here.
//
// Only headline, summary, image and link leave this module: the app links
// out to espn.com, it never republishes an article's text.
//
// ---- previews ----
//
// Previews and recaps carry an `event` category whose id is ESPN's game id —
// the same id football's games are keyed on (401858282 = Miami @ North
// Carolina, 31 Oct 2026), and basketball's HoopsGame.sourceId. `eventId` is
// carried so a page can put a game's preview beside that game.
//
// ---- cache ----
//
// One ESPN call per (sport, team) per TTL_MS, in memory, per dyno. A failure
// is cached for FAIL_TTL_MS so a broken feed is not hammered by every page
// view. Concurrent misses share one request.

const TIMEOUT_MS = 8000;
const TTL_MS = 30 * 60 * 1000;
const FAIL_TTL_MS = 5 * 60 * 1000;
const LIMIT = 50;
const MAX_TEAMS = 2;
const MAX_ITEMS = 25;
const MAX_CACHED = 500;

const PATHS = {
    football: 'football/college-football',
    basketball: 'basketball/mens-college-basketball'
};

const cache = new Map();

function feedUrl(sport, espnId) {
    return `https://site.api.espn.com/apis/site/v2/sports/${PATHS[sport]}/news?team=${encodeURIComponent(espnId)}&limit=${LIMIT}`;
}

// ESPN's article types, as the app labels them. Anything else is a story.
function kindOf(type) {
    if (type === 'Recap') return 'recap';
    if (type === 'Preview') return 'preview';
    if (type === 'Media') return 'video';
    return 'story';
}

// One feed article as the app shows it, or null when it is not one to show.
function normalize(a) {
    if (!a || typeof a.headline !== 'string' || !a.headline.trim()) return null;
    // Previews and recaps link as http://www.espn.com/ncf/preview?gameId=…
    // (4 of Miami's 50); ESPN answers the https version the same way.
    const href = a.links && a.links.web && a.links.web.href;
    if (typeof href !== 'string' || !/^https?:\/\//.test(href)) return null;
    const link = href.replace(/^http:\/\//, 'https://');
    const published = new Date(a.published);
    if (Number.isNaN(published.getTime())) return null;
    const cats = Array.isArray(a.categories) ? a.categories : [];
    const teams = new Set(cats.filter(c => c && c.type === 'team' && c.teamId != null).map(c => String(c.teamId)));
    if (teams.size > MAX_TEAMS) return null;
    const event = cats.find(c => c && c.type === 'event' && c.eventId != null);
    const image = (Array.isArray(a.images) ? a.images : []).find(i => i && typeof i.url === 'string' && /^https:\/\//.test(i.url));
    return {
        headline: a.headline.trim(),
        description: typeof a.description === 'string' ? a.description.trim() : '',
        published: published.toISOString(),
        kind: kindOf(a.type),
        image: image ? image.url : null,
        link,
        premium: a.premium === true,
        eventId: event ? String(event.eventId) : null
    };
}

// The feed's articles, filtered, de-duplicated and newest first. Of two
// with one headline the newer is kept, unless the other is the game's preview
// or recap: a newer clip must not take the preview row away from Next up.
function shape(articles) {
    const byHeadline = new Map();
    for (const x of articles.map(normalize).filter(Boolean)) {
        const key = x.headline.toLowerCase();
        const had = byHeadline.get(key);
        const gameStory = (i) => i.kind === 'preview' || i.kind === 'recap';
        if (!had || (gameStory(x) && !gameStory(had)) || (gameStory(x) === gameStory(had) && x.published > had.published)) {
            byHeadline.set(key, x);
        }
    }
    return [...byHeadline.values()]
        .sort((x, y) => (x.published < y.published ? 1 : x.published > y.published ? -1 : 0))
        .slice(0, MAX_ITEMS);
}

async function fetchFeed(sport, espnId) {
    const res = await fetch(feedUrl(sport, espnId), { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) throw new Error(`ESPN news ${sport} ${espnId}: ${res.status}`);
    const body = await res.json();
    if (!body || !Array.isArray(body.articles)) throw new Error(`ESPN news ${sport} ${espnId}: no articles array — the response shape changed`);
    return shape(body.articles);
}

// { items, error } for one team. Never throws.
async function newsFor(sport, espnId, now = Date.now()) {
    if (!PATHS[sport]) return { items: [], error: `unknown sport ${sport}` };
    if (espnId == null || !/^\d+$/.test(String(espnId))) return { items: [], error: 'no ESPN id for this team' };
    const key = `${sport}:${espnId}`;
    const hit = cache.get(key);
    if (hit && hit.expires > now) return hit.value;
    if (hit && hit.pending) return hit.pending;

    const pending = fetchFeed(sport, String(espnId))
        .then(items => ({ value: { items, error: null }, ttl: TTL_MS }))
        .catch((e) => {
            console.error(`team news: ${e.message}`);
            return { value: { items: [], error: 'ESPN news is unavailable right now' }, ttl: FAIL_TTL_MS };
        })
        .then(({ value, ttl }) => {
            if (cache.size >= MAX_CACHED) cache.delete(cache.keys().next().value);
            cache.set(key, { value, expires: now + ttl });
            return value;
        });
    cache.set(key, { pending, expires: 0 });
    return pending;
}

module.exports = { newsFor, shape, normalize, feedUrl, _cache: cache, TTL_MS, FAIL_TTL_MS };
