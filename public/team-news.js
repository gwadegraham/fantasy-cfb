// A team's ESPN headlines on the team pages, football and basketball: the
// News tab, and the next game's preview as one row under the Next up card.
// The data is GET /teams/:id/news or /hoops/teams/:id/news
// (modules/team-news.js): headline, summary, image and an espn.com link.
//
//   window.ccTeamNews.paint(root, url)       fill whatever news slots root has now
//   window.ccTeamNews.panel()                the News tab's slot, painted later
//   window.ccTeamNews.nextWrap(card, espnId) the Next up card, with a slot for its preview
//
// A page renders the slots synchronously and calls paint() after every
// render; the feed is fetched once per page and the slots are filled when it
// lands, so switching tabs never waits on ESPN twice.
//
// Links are plain, no target=_blank: in the installed app iOS opens an
// out-of-scope link in a sheet over the app (Done comes back), while
// _blank hands it to Safari and leaves the app.
// Works in the browser and under Node (module.exports) for tests.

(function (global) {
    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }

    var LABEL = { recap: 'Recap', preview: 'Preview', video: 'Video' };

    // "3h ago", "4d ago", then the date once it is over a week old.
    function ago(iso, now) {
        var t = new Date(iso).getTime();
        var h = Math.floor((now - t) / 36e5);
        if (h < 1) return 'Just now';
        if (h < 24) return h + 'h ago';
        var d = Math.floor(h / 24);
        if (d < 7) return d + 'd ago';
        return new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    }

    function kind(item) {
        var l = LABEL[item.kind];
        return l ? '<span class="sp-news-kind ' + esc(item.kind) + '">' + l + '</span>' : '';
    }

    // ESPN+ stories stay in the list, marked, so the paywall is no surprise.
    function plus(item) {
        return item.premium ? '<span class="sp-news-plus" title="An ESPN+ story: needs a subscription to read">ESPN+</span>' : '';
    }

    function row(item, now) {
        return '<a class="sp-news-row" href="' + esc(item.link) + '" rel="noopener">'
            + (item.image ? '<img src="' + esc(item.image) + '" alt="" loading="lazy" onerror="this.remove()">' : '<span class="sp-news-noimg"></span>')
            + '<span class="sp-news-txt"><span class="sp-news-hl">' + esc(item.headline) + '</span>'
            + '<span class="sp-news-meta">' + kind(item) + plus(item) + '<span>' + (item.premium ? '' : 'ESPN · ') + esc(ago(item.published, now)) + '</span></span>'
            + '</span></a>';
    }

    function list(data, now) {
        var items = (data && data.items) || [];
        if (!items.length) {
            return '<div class="sp-card sp-empty">' + (data && data.error ? 'News could not be loaded right now. Try again later.' : 'No recent ESPN stories about this team.') + '</div>';
        }
        return '<div class="sp-card sp-news">' + items.map(function (x) { return row(x, now); }).join('') + '</div>'
            + '<p class="sp-news-src">Headlines from ESPN. Stories open on espn.com.</p>';
    }

    // The newest preview of one game, by ESPN's game id.
    function previewFor(items, espnId) {
        if (espnId == null || espnId === '') return null;
        var id = String(espnId);
        return (items || []).filter(function (x) { return x.kind === 'preview' && x.eventId === id; })[0] || null;
    }

    function previewRow(item) {
        return '<a class="sp-next-pv" href="' + esc(item.link) + '" rel="noopener">'
            + '<span class="sp-news-kind preview">Preview</span>' + plus(item)
            + '<span class="sp-next-pv-hl">' + esc(item.headline) + '</span><span class="sp-next-pv-ar" aria-hidden="true">›</span></a>';
    }

    function panel() {
        return '<h2 class="sp-h">Latest news</h2><div class="sp-news-slot"><div class="sp-loading">Loading news…</div></div>';
    }

    function nextWrap(card, espnId) {
        if (!card) return '';
        return '<div class="sp-next-wrap"' + (espnId != null && espnId !== '' ? ' data-espn-game="' + esc(espnId) + '"' : '') + '>' + card + '</div>';
    }

    var loads = {};
    function load(url) {
        if (!loads[url]) {
            loads[url] = Promise.resolve()
                .then(function () { return global.fetch(url, { headers: { Accept: 'application/json' } }); })
                .then(function (r) { return r.ok ? r.json() : { items: [], error: 'HTTP ' + r.status }; })
                .catch(function (e) { return { items: [], error: e.message }; })
                .then(function (data) {
                    // A failure is not kept: the next tab tap asks again, so
                    // one network blip does not last the whole visit.
                    if (!data || data.error) delete loads[url];
                    return data;
                });
        }
        return loads[url];
    }

    // Fill the slots root holds when the feed lands. Only fetches when there
    // is a slot to fill, so a page with no next game and the News tab shut
    // never calls ESPN.
    function paint(root, url, now) {
        if (!root) return Promise.resolve();
        var slot = root.querySelector('.sp-news-slot');
        var wrap = root.querySelector('.sp-next-wrap[data-espn-game]:not(.has-pv)');
        if (!slot && !wrap) return Promise.resolve();
        return load(url).then(function (data) {
            var t = now == null ? Date.now() : now;
            var s = root.querySelector('.sp-news-slot');
            if (s) s.outerHTML = list(data, t);
            var w = root.querySelector('.sp-next-wrap[data-espn-game]:not(.has-pv)');
            var pv = w && previewFor(data && data.items, w.getAttribute('data-espn-game'));
            if (pv) {
                w.classList.add('has-pv');
                w.insertAdjacentHTML('beforeend', previewRow(pv));
            }
        });
    }

    var api = { paint: paint, panel: panel, nextWrap: nextWrap, list: list, previewFor: previewFor, ago: ago, _loads: loads };
    global.ccTeamNews = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
