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
                + '<div class="hof-champ-trophy">' + (window.ccIcon ? window.ccIcon('trophy', { size: 30 }) : '') + '</div>'
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

    // --- Records book --------------------------------------------------------
    // League bests, each with the manager who owns it. Records set in the
    // in-progress season are excluded server-side, so nothing here is provisional.
    function recordsHtml(records) {
        if (!records || !records.length) return '';
        var cards = records.map(function (r) {
            var face = '<div class="hof-rec-label">' + esc(r.label)
                +   (r.breakdown ? '<i class="fa-solid fa-chevron-down hof-chev" aria-hidden="true"></i>' : '') + '</div>'
                + '<div class="hof-rec-value">' + esc(String(r.value)) + '<small>' + esc(r.suffix || '') + '</small></div>'
                + '<div class="hof-rec-who">' + avatar(r.holder, 40)
                +   '<span class="hof-rec-names"><b>' + esc(r.holder.franchise || r.holder.name) + '</b>'
                +   (r.holder.franchise ? '<small>' + esc(r.holder.name) + '</small>' : '') + '</span>'
                + '</div>'
                + '<div class="hof-rec-when">' + esc(r.season + (r.detail ? ' · ' + r.detail : '')) + '</div>';

            // Only a record with something left to reveal becomes a control —
            // "best single game" already states its whole fact in one line, so it
            // stays a plain card rather than an affordance that pays nothing off.
            if (!r.breakdown) return '<div class="hof-rec">' + face + '</div>';

            var rows = r.breakdown.rows.map(function (row) {
                return '<div class="hof-recrow">'
                    + '<span class="hof-recrow-label">' + esc(row.label) + '</span>'
                    + (row.sub ? '<span class="hof-recrow-sub">' + esc(row.sub) + '</span>' : '<span></span>')
                    + '<span class="hof-recrow-val">' + esc(String(row.value)) + '</span>'
                    + '</div>';
            }).join('');
            return '<div class="hof-rec hof-rec-x">'
                + '<button type="button" class="hof-rec-head" aria-expanded="false">' + face + '</button>'
                + '<div class="hof-rec-body"><div class="hof-recrows">' + rows + '</div></div>'
                + '</div>';
        }).join('');
        return '<section class="hof-section">'
            + '<h2 class="hof-h2">Record book</h2>'
            + '<p class="hof-note">Week and single-game records cover the regular season. '
            + 'Postseason games score on a much higher scale and all land in one bucket, so they get their own record.</p>'
            + '<div class="hof-recs">' + cards + '</div>'
            + '</section>';
    }

    // --- Draft retrospective -------------------------------------------------
    // Steal and bust are draft slot vs. where the pick actually finished in
    // points that season — taken 45th, finished 3rd is +42.
    function draftPick(p, kind) {
        if (!p) return '';
        // Always occupies its grid cell — a conditionally-absent child shifts
        // every later cell a column left (the bug that put the league chip on
        // top of the summary in the admin Activity log).
        var logo = (window.ccLogo && p.logos && p.logos.length)
            ? '<img class="hof-dr-logo" src="' + esc(ccLogo(p.logos)) + '" alt="">'
            : '<span class="hof-dr-logo"></span>';
        var move = kind === 'steal'
            ? '<span class="hof-dr-delta up">+' + p.delta + ' vs slot</span>'
            : kind === 'bust' ? '<span class="hof-dr-delta down">' + p.delta + ' vs slot</span>' : '';
        return '<div class="hof-dr-pick ' + esc(kind) + '">'
            + '<span class="hof-dr-kind">' + (kind === 'steal' ? 'Steal' : kind === 'bust' ? 'Bust' : '1.01') + '</span>'
            + logo
            + '<span class="hof-dr-team">' + esc(p.team) + '</span>'
            + '<span class="hof-dr-meta">' + esc(p.manager) + ' · pick ' + p.overall + ' · ' + p.points + ' pts</span>'
            + move
            + '</div>';
    }

    function draftHistoryHtml(seasons) {
        var withPicks = (seasons || []).filter(function (s) { return s.picks; });
        if (!withPicks.length) return '';
        var blocks = withPicks.map(function (s) {
            return '<div class="hof-draft">'
                + '<div class="hof-draft-head"><b>' + s.season + '</b>'
                +   '<span>' + s.picks + ' picks · ' + s.rounds + ' rounds</span></div>'
                + draftPick(s.firstOverall, 'first')
                + draftPick(s.steal, 'steal')
                + draftPick(s.bust, 'bust')
                + '</div>';
        }).join('');
        return '<section class="hof-section">'
            + '<h2 class="hof-h2">Draft room</h2>'
            + '<p class="hof-note">Steal and bust compare where a team was taken with where it finished in points that season.</p>'
            + '<div class="hof-drafts">' + blocks + '</div>'
            + '</section>';
    }

    function historyRows(m) {
        return m.history.map(function (h) {
            return '<div class="hof-hist">'
                + '<span class="hof-hist-season">' + h.season + '</span>'
                + '<span class="hof-hist-finish">' + (h.champion ? (window.ccIcon ? window.ccIcon('trophy', { size: 14 }) + ' ' : '') : '') + ordinal(h.rank) + ' of ' + h.of + '</span>'
                + '<span class="hof-hist-franchise">' + esc(h.franchise || '—') + '</span>'
                + '<span class="hof-hist-score">' + h.score + ' pts</span>'
                + '</div>';
        }).join('');
    }

    function leaderboardHtml(managers, meId) {
        var cards = managers.map(function (m, i) {
            var you = meId && String(m.userId) === String(meId);
            var titles = m.titles > 0 ? (window.ccIcon ? window.ccIcon('trophy', { size: 15 }).repeat(Math.min(m.titles, 5)) : '') : '<span class="hof-none">—</span>';
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
        el.innerHTML = championsHtml(data.seasons)
            + recordsHtml(data.records)
            + leaderboardHtml(data.managers, meId)
            + draftHistoryHtml(data.draftHistory);
        // Expand/collapse record cards — same interaction as the manager cards
        // below, so the page has one expand vocabulary rather than two.
        el.querySelectorAll('.hof-rec-head').forEach(function (btn) {
            btn.addEventListener('click', function () {
                var card = btn.closest('.hof-rec');
                var open = card.classList.toggle('is-open');
                btn.setAttribute('aria-expanded', String(open));
            });
        });

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
