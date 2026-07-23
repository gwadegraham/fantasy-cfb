// Hall of Fame page. Fetches the league history aggregation (GET /history/:league)
// and renders a champions strip + an all-time leaderboard of expandable manager
// cards (year-by-year history inside). No new data — see routes/history.js.

(function () {
    function esc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }
    function ordinal(n) {
        var s = ['th', 'st', 'nd', 'rd'], v = n % 100;
        return n + (s[(v - 20) % 10] || s[v] || s[0]);
    }
    function avatar(m, size) {
        if (m.avatarUrl) {
            var src = m.avatarUrl.indexOf('/upload/') !== -1
                ? m.avatarUrl.replace('/upload/', '/upload/c_fill,g_face,w_' + size + ',h_' + size + ',q_auto,f_auto/')
                : m.avatarUrl;
            return '<span class="hof-avatar"><img src="' + esc(src) + '" alt=""></span>';
        }
        var init = m.initials || (m.name || '?').split(' ').map(function (p) { return p[0]; }).join('').slice(0, 2).toUpperCase();
        return '<span class="hof-avatar hof-avatar-initials" style="background:' + esc(m.color || '#333') + '">' + esc(init) + '</span>';
    }
    function currentUserId() {
        try { return String(userState.user_metadata.metadata.userId); }
        catch (e) { return window.localStorage.getItem('userId') || null; }
    }
    function resolveLeague() {
        var code = window.localStorage.getItem('leagueCode');
        if (code && code !== 'undefined') return code;
        try {
            code = userState.user_metadata.metadata.league === 'gg' ? 'graham-league' : 'claunts-league';
            window.localStorage.setItem('leagueCode', code);
            return code;
        } catch (e) { return 'claunts-league'; }
    }

    function championsHtml(seasons) {
        if (!seasons.length) return '';
        var cards = seasons.map(function (s) {
            var c = s.champion;
            return '<div class="hof-champ">'
                + '<div class="hof-champ-season">' + s.season + '</div>'
                + '<div class="hof-champ-trophy">🏆</div>'
                + avatar(c, 96)
                + '<div class="hof-champ-name">' + esc(c.franchise || c.name) + '</div>'
                + (c.franchise ? '<div class="hof-champ-sub">' + esc(c.name) + '</div>' : '')
                + '<div class="hof-champ-score">' + c.score + ' pts</div>'
                + '</div>';
        }).join('');
        return '<section class="hof-section">'
            + '<h2 class="hof-h2">Champions</h2>'
            + '<div class="hof-champs">' + cards + '</div>'
            + '</section>';
    }

    function historyRows(m) {
        return m.history.map(function (h) {
            return '<div class="hof-hist">'
                + '<span class="hof-hist-season">' + h.season + '</span>'
                + '<span class="hof-hist-finish">' + (h.champion ? '🏆 ' : '') + ordinal(h.rank) + ' of ' + h.of + '</span>'
                + '<span class="hof-hist-franchise">' + esc(h.franchise || '—') + '</span>'
                + '<span class="hof-hist-score">' + h.score + ' pts</span>'
                + '</div>';
        }).join('');
    }

    function leaderboardHtml(managers, meId) {
        var cards = managers.map(function (m, i) {
            var you = meId && String(m.userId) === String(meId);
            var titles = m.titles > 0 ? '🏆'.repeat(Math.min(m.titles, 5)) : '<span class="hof-none">—</span>';
            return '<div class="hof-mgr' + (you ? ' hof-you' : '') + '">'
                + '<button class="hof-mgr-head" type="button" aria-expanded="false">'
                + '<span class="hof-rank">' + (i + 1) + '</span>'
                + avatar(m, 72)
                + '<span class="hof-mgr-id"><span class="hof-mgr-nameline">'
                + '<span class="hof-mgr-name">' + esc(m.name) + '</span>'
                + (you ? '<span class="hof-youtag">you</span>' : '') + '</span>'
                + (m.franchise ? '<span class="hof-mgr-sub">' + esc(m.franchise) + '</span>' : '') + '</span>'
                + '<span class="hof-mgr-titles" title="Titles">' + titles + '</span>'
                + '<span class="hof-stat"><b>' + m.totalPoints + '</b><small>total pts</small></span>'
                + '<span class="hof-stat"><b>' + m.avgFinish + '</b><small>avg finish</small></span>'
                + '<i class="fa-solid fa-chevron-down hof-chev" aria-hidden="true"></i>'
                + '</button>'
                + '<div class="hof-mgr-body">'
                + '<div class="hof-mgr-summary">'
                +   '<span>' + m.seasonsPlayed + (m.seasonsPlayed === 1 ? ' season' : ' seasons') + '</span>'
                +   (m.bestSeason ? '<span>Best <b>' + m.bestSeason.score + '</b> (' + m.bestSeason.season + ')</span>' : '')
                +   (m.worstSeason ? '<span>Worst <b>' + m.worstSeason.score + '</b> (' + m.worstSeason.season + ')</span>' : '')
                + '</div>'
                + '<div class="hof-hist-head">'
                + '<span>Season</span><span>Finish</span><span>Franchise</span><span>Points</span></div>'
                + historyRows(m) + '</div>'
                + '</div>';
        }).join('');
        return '<section class="hof-section">'
            + '<h2 class="hof-h2">All-time</h2>'
            + '<div class="hof-board">' + cards + '</div>'
            + '</section>';
    }

    function render(el, data, meId) {
        if (!data.managers || !data.managers.length) {
            el.innerHTML = '<p class="hof-empty">No completed seasons yet — check back once a season wraps.</p>';
            return;
        }
        el.innerHTML = championsHtml(data.seasons) + leaderboardHtml(data.managers, meId);
        // Expand/collapse manager cards.
        el.querySelectorAll('.hof-mgr-head').forEach(function (btn) {
            btn.addEventListener('click', function () {
                var card = btn.closest('.hof-mgr');
                var open = card.classList.toggle('is-open');
                btn.setAttribute('aria-expanded', String(open));
            });
        });
    }

    window.addEventListener('DOMContentLoaded', async function () {
        var el = document.getElementById('hof');
        var league = resolveLeague();
        try {
            var res = await fetch('/history/' + encodeURIComponent(league), { headers: { Accept: 'application/json' } });
            var data = await res.json();
            render(el, data, currentUserId());
        } catch (e) {
            el.innerHTML = '<p class="hof-empty">Couldn’t load league history. Please refresh.</p>';
        }

        // Admin league switch (mirrors the other pages): reload on selection.
        if (window.jQuery) {
            jQuery('[league-selector] a').on('click', function () {
                var $b = jQuery(this).parents('.dropdown').find('.btn');
                $b.html(jQuery(this).text()).val(jQuery(this).attr('value'));
                window.sessionStorage.setItem('league', jQuery('#dropdownMenuButton').text());
                window.localStorage.setItem('leagueCode', jQuery(this).attr('value'));
                window.location.reload();
            });
        }
    });
})();
