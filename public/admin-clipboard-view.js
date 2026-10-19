// The Clipboard on the admin page: fetches what public/admin-clipboard.js
// needs, renders its answer into [admin-clipboard], and wires the stepper,
// the fix buttons and the Toolbox drawer. The rules live in the model; this
// file only gathers inputs and draws.
//
// Every fetch is one the admin page already makes somewhere (see the model's
// header). A fetch that fails leaves its input undefined, which the model
// reads as "drop those rows", never as a state it should invent.
(function () {
    var root = document.querySelector('[admin-clipboard]');
    var model = window.ccAdminClipboard;
    if (!root || !model) return;

    var sport = window.ADMIN_SPORT === 'basketball' ? 'basketball' : 'football';
    var isAdmin = !!window.ADMIN_IS_ADMIN;
    var TOOLBOX_KEY = 'ccAdminToolboxOpen';

    // Model fix key -> [container attribute, opener's global name]. Openers
    // are named, not referenced: they are admin.js's function declarations,
    // looked up at click time so load order never matters.
    var FIX = {
        scores: ['scores-container', 'displayScoresContainer'],
        schedule: ['schedule-container', 'displayScheduleContainer'],
        enrichment: ['enrichment-container', 'displayEnrichmentContainer'],
        spPlus: ['enrichment-container', 'displayEnrichmentContainer'],
        expectedWins: ['expected-wins-container', 'displayExpectedWinsContainer'],
        cfpOdds: ['cfp-odds-container', 'displayCfpOddsContainer'],
        roster: ['season-roster-container', 'displaySeasonRosterContainer'],
        draft: ['draft-config-container', 'displayDraftConfigContainer'],
        gameModes: ['engagement-container', 'displayEngagementContainer']
    };
    var FIX_LABEL = {
        scores: 'Score now', cfpOdds: 'Paste board', draft: 'Set up', roster: 'Add',
        gameModes: 'Set up'
    };

    function esc(v) {
        return String(v == null ? '' : v)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    // { ok, body }: ok false on a network error or a non-2xx, so a missing
    // draft (200 + null) is told apart from a failed read.
    function getJSON(url) {
        return fetch(url, { headers: { Accept: 'application/json' } })
            .then(function (r) { return r.ok ? r.json().then(function (b) { return { ok: true, body: b }; }) : { ok: false }; })
            .catch(function () { return { ok: false }; });
    }
    function bodyOr(res, fallback) { return res && res.ok ? res.body : fallback; }

    function leagueCode() {
        try { if (window.ccManageLeagueCode) return window.ccManageLeagueCode(); } catch (e) { /* fall through */ }
        return window.ADMIN_LEAGUE || '';
    }
    function leagueName(code) {
        try { return (window.ccLeague && window.ccLeague.name && window.ccLeague.name(code)) || code; } catch (e) { return code; }
    }

    function gather() {
        var season = window.APP_YEAR || String(new Date().getFullYear());
        var league = leagueCode();
        var enc = encodeURIComponent;
        var weekState = (window.ccCurrentWeek && window.ccCurrentWeek.state)
            ? window.ccCurrentWeek.state(season).catch(function () { return null; })
            : Promise.resolve(null);
        return Promise.all([
            getJSON('/seasons/' + sport),
            getJSON('/scores/readiness/' + enc(season)),
            getJSON('/scores/status/' + enc(season)),
            getJSON('/job-runs'),
            // Platform data: not asked for on a commissioner's behalf.
            isAdmin ? getJSON('/teams/' + enc(season) + '/cfp-odds/status') : Promise.resolve(null),
            league ? getJSON('/draft/' + enc(league) + '/' + enc(season)) : Promise.resolve(null),
            league ? getJSON('/scoring-config/' + enc(league) + '?season=' + enc(season)) : Promise.resolve(null),
            weekState
        ]).then(function (r) {
            var cfg = bodyOr(r[6], undefined);
            var week = r[7];
            return {
                sport: sport,
                isAdmin: isAdmin,
                league: league,
                leagueName: leagueName(league),
                seasonStatus: (bodyOr(r[0], {}) || {}).status || null,
                readiness: bodyOr(r[1], null),
                status: bodyOr(r[2], null),
                jobs: bodyOr(r[3], null),
                cfpOdds: bodyOr(r[4], null),
                draft: r[5] && r[5].ok ? r[5].body : undefined,
                engagement: cfg === undefined ? undefined : ((cfg && cfg.engagement) || null),
                week: week && week.week,
                // The only postseason signal the client has: a bowl slate being
                // played right now. Between bowl slates this reads "In season".
                postseason: !!(week && week.liveNow && week.liveNow.seasonType === 'postseason')
            };
        });
    }

    // ---- drawing ------------------------------------------------------------

    var BOX = {
        ok: '<i class="fa-solid fa-check" aria-hidden="true"></i>',
        warn: '!',
        info: '<i class="fa-solid fa-info" aria-hidden="true"></i>',
        off: '–'
    };
    var STATE_WORD = { ok: 'Done', warn: 'Needs attention', info: 'For information', off: 'Off' };

    function toolOnPage(key) {
        var t = FIX[key];
        return !!(t && document.querySelector('[' + t[0] + ']'));
    }

    function itemHtml(r) {
        var right = '';
        if (r.fix && r.state !== 'ok' && toolOnPage(r.fix)) {
            right = '<button type="button" class="cb-fix" data-cb-fix="' + esc(r.fix) + '">' + esc(FIX_LABEL[r.fix] || 'Fix') + '</button>';
        } else if (r.auto) {
            right = '<span class="cb-auto"><i class="fa-solid fa-bolt" aria-hidden="true"></i>' + esc(r.auto) + '</span>';
        }
        return '<li class="cb-item cb-' + esc(r.state) + '">'
            + '<span class="cb-box" role="img" aria-label="' + esc(STATE_WORD[r.state] || '') + '">' + (BOX[r.state] || '') + '</span>'
            + '<span class="cb-what"><span class="cb-label">' + esc(r.label) + '</span>'
            + (r.detail ? '<small>' + esc(r.detail) + '</small>' : '') + '</span>'
            + right + '</li>';
    }

    function today() {
        return new Date().toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
    }

    function render(cb) {
        // No phase means nothing said where the season is: stay hidden and
        // leave the page to the panels below rather than guess.
        if (!cb.phase) { root.hidden = true; return; }
        var current = cb.phases.filter(function (p) { return p.state === 'now'; })[0];
        var steps = cb.phases.map(function (p) {
            var shown = p.key === cb.shown;
            return '<li><button type="button" class="cb-ph cb-ph-' + p.state + (shown ? ' is-shown' : '') + '" data-cb-phase="' + esc(p.key) + '"'
                + (p.state === 'now' ? ' aria-current="step"' : '') + ' aria-pressed="' + (shown ? 'true' : 'false') + '">'
                + '<span class="cb-knob">' + (p.state === 'done' ? BOX.ok : '') + '</span>'
                + '<b>' + esc(p.label) + '</b>'
                + (p.state === 'now' ? '<small>Now</small>' : '')
                + '</button></li>';
        }).join('');

        var groups = cb.groups.map(function (g) {
            var icon = g.key === 'platform' ? 'fa-server' : 'fa-flag';
            return '<div class="cb-grp"><i class="fa-solid ' + icon + '" aria-hidden="true"></i>' + esc(g.label) + '</div>'
                + '<ul class="cb-items">' + g.items.map(itemHtml).join('') + '</ul>';
        }).join('');

        var preview = cb.preview && current
            ? '<p class="cb-preview">Previewing ' + esc(cb.phases.filter(function (p) { return p.key === cb.shown; })[0].label)
                + ' · <button type="button" class="cb-back" data-cb-phase="' + esc(current.key) + '">Back to ' + esc(current.label) + '</button></p>'
            : '';

        var next = cb.next && cb.next.text
            ? '<p class="cb-next"><i class="fa-solid fa-forward" aria-hidden="true"></i><span><b>Next: ' + esc(cb.next.label) + '.</b> ' + esc(cb.next.text) + '</span></p>'
            : '';

        root.innerHTML = '<div class="cb">'
            + '<ol class="cb-phases" aria-label="Season phase">' + steps + '</ol>'
            + '<div class="cb-main">'
            + '<div class="cb-card' + (cb.preview ? ' is-preview' : '') + '">'
            + '<div class="cb-head"><h2>' + esc(cb.title) + '</h2><span>' + esc(cb.preview ? 'Preview' : today()) + '</span></div>'
            + '<p class="cb-sub">' + esc(cb.summary) + '</p>'
            + preview + groups
            + '</div>' + next
            + '</div></div>';
        root.hidden = false;
    }

    // ---- behaviour ----------------------------------------------------------

    var input = null;

    // Redrawing replaces the stepper, so the button a keyboard user just
    // pressed is gone; put focus back on its replacement (or on Back's
    // target) instead of letting it fall to <body>.
    function draw(phase, focusPhase) {
        render(model.build(input, phase ? { phase: phase } : null));
        if (focusPhase) {
            var again = root.querySelector('.cb-ph[data-cb-phase="' + focusPhase + '"]');
            if (again) again.focus();
        }
    }

    function openFix(key) {
        var t = FIX[key];
        if (!t) return;
        if (typeof window.openTool === 'function') window.openTool(t[0], window[t[1]]);
    }

    root.addEventListener('click', function (e) {
        var fix = e.target.closest('[data-cb-fix]');
        if (fix) { openFix(fix.getAttribute('data-cb-fix')); return; }
        var ph = e.target.closest('[data-cb-phase]');
        if (ph && input) {
            var key = ph.getAttribute('data-cb-phase');
            draw(key === model.phaseOf(input) ? null : key, key);
        }
    });

    // The Toolbox drawer: a count and group names on its bar, and its
    // open/closed state remembered in this browser (a convenience only —
    // storage can be missing or throw).
    function initToolbox() {
        var box = document.querySelector('[admin-toolbox]');
        if (!box) return;
        var meta = box.querySelector('[admin-toolbox-meta]');
        if (meta) {
            var tools = box.querySelectorAll('.function-container').length;
            var names = Array.prototype.map.call(box.querySelectorAll('.group-head h2'), function (h) {
                return h.textContent.split(/\s+[—·]\s+/)[0].trim();
            });
            meta.textContent = tools + ' tool' + (tools === 1 ? '' : 's') + (names.length ? ' · ' + names.join(', ') : '');
        }
        try { if (window.localStorage.getItem(TOOLBOX_KEY) === '1') box.open = true; } catch (e) { /* convenience */ }
        box.addEventListener('toggle', function () {
            try { window.localStorage.setItem(TOOLBOX_KEY, box.open ? '1' : '0'); } catch (e) { /* convenience */ }
        });
    }

    function load() {
        return gather().then(function (got) {
            input = got;
            draw(null);
        }).catch(function () { /* leave the Clipboard hidden; the old panels still stand */ });
    }

    initToolbox();
    window.ccAdminClipboardView = { load: load, gather: gather, render: render, FIX: FIX };
    load();
}());
