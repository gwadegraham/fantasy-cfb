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
    // Per sport: opening football's drawer should not open basketball's.
    var TOOLBOX_KEY = 'ccAdminToolboxOpen' + (sport === 'basketball' ? ':basketball' : '');

    // Model fix key -> [container attribute, opener's global name, present].
    // Openers are named, not referenced: they are admin.js's function
    // declarations, looked up at click time so load order never matters.
    //
    // Basketball's data tasks are cards public/hoopsAdmin.js draws after its
    // own fetch, so they may not exist yet when the Clipboard renders; their
    // `present` selector is the container that is there from the start (and
    // only on an Admin's page). They have no opener: the cards are never
    // collapsed.
    var FIX = {
        jobs: ['admin-jobs', null],
        'hoops-ingest': ['data-task="ingest"', null, '#hoops-admin'],
        'hoops-schedule': ['data-task="schedule"', null, '#hoops-admin'],
        'hoops-roster': ['data-task="roster"', null, '#hoops-admin'],
        'hoops-preseason': ['id="hoops-preseason"', null, '#hoops-preseason'],
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
        gameModes: 'Set up', 'hoops-ingest': 'Import', 'hoops-schedule': 'Import',
        'hoops-roster': 'Import', 'hoops-preseason': 'Import', jobs: 'View jobs'
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
        return sport === 'basketball' ? gatherBasketball() : gatherFootball();
    }

    // Basketball: no readiness or scoring-status endpoints (both football's).
    // The platform reads (/hoops/admin/status, /preseason) 404 for anyone but
    // an Admin, so a commissioner never asks. No week either: ccCurrentWeek
    // follows the VIEWED league, which on this page may be football.
    function gatherBasketball() {
        var season = window.APP_YEAR || String(new Date().getFullYear());
        var league = leagueCode();
        var enc = encodeURIComponent;
        return Promise.all([
            getJSON('/seasons/basketball'),
            isAdmin ? getJSON('/hoops/admin/status') : Promise.resolve(null),
            isAdmin ? getJSON('/hoops/admin/preseason') : Promise.resolve(null),
            // Everyone: the Automated jobs list is on every admin page.
            // /job-runs shows hoops-* jobs only to someone who sees basketball,
            // which a basketball league's commissioner does.
            getJSON('/job-runs'),
            league ? getJSON('/draft/' + enc(league) + '/' + enc(season)) : Promise.resolve(null),
            league ? getJSON('/scoring-config/' + enc(league) + '?season=' + enc(season)) : Promise.resolve(null),
            league ? getJSON('/users/league/' + enc(league) + '/roster') : Promise.resolve(null)
        ]).then(function (r) {
            var hoops = bodyOr(r[1], null);
            var cfg = bodyOr(r[5], undefined);
            var roster = bodyOr(r[6], null);
            return {
                sport: sport,
                isAdmin: isAdmin,
                league: league,
                leagueName: leagueName(league),
                seasonStatus: (bodyOr(r[0], {}) || {}).status || (hoops && hoops.seasonStatus) || null,
                hoops: hoops,
                preseason: bodyOr(r[2], null),
                jobs: bodyOr(r[3], null),
                draft: r[4] && r[4].ok ? r[4].body : undefined,
                engagement: cfg === undefined ? undefined : ((cfg && cfg.engagement) || null),
                members: roster && Array.isArray(roster.players)
                    ? roster.players.filter(function (p) { return p && p.inSeason; }).length : null
            };
        });
    }

    function gatherFootball() {
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
        return !!(t && document.querySelector(t[2] || '[' + t[0] + ']'));
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
        // leave the page to the Toolbox below rather than guess.
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

    // ---- the Automated jobs list (in the Toolbox, both sports) ----------
    // The same list on football's and basketball's page: every scheduled job,
    // including never-run ones, the ones that need you first.
    var JOB_WORD = { error: 'Failed', running: 'Running', skipped: 'Nothing to do', success: 'Ran' };
    var STATE_ORDER = { warn: 0, info: 1, ok: 2, off: 3 };

    function ago(iso) {
        var mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
        if (!isFinite(mins)) return '';
        if (mins < 1) return 'just now';
        if (mins < 60) return mins + 'm ago';
        var hrs = Math.round(mins / 60);
        return hrs < 48 ? hrs + 'h ago' : Math.round(hrs / 24) + 'd ago';
    }

    function renderJobs(phase) {
        var el = document.querySelector('[admin-jobs]');
        if (!el) return;
        var list = el.querySelector('[admin-jobs-list]');
        if (!input || input.jobs == null) {
            list.innerHTML = '<li class="cb-job-none">Could not read the job history.</li>';
            return;
        }
        var jobs = model.jobList(sport, input.jobs, { inSeason: phase === 'season' || phase === 'postseason' })
            .map(function (j, i) { j.i = i; return j; })
            .sort(function (a, b) { return (STATE_ORDER[a.state] - STATE_ORDER[b.state]) || (a.i - b.i); });
        list.innerHTML = jobs.map(function (j) {
            var word = j.overdue && j.status !== 'error' ? (j.at ? 'Overdue' : 'Has not run') : (JOB_WORD[j.status] || 'No runs yet');
            var last = word + (j.at ? ' · ' + ago(j.at) : '');
            return '<li class="cb-job cb-job-' + esc(j.state) + '">'
                + '<span class="cb-job-dot" aria-hidden="true"></span>'
                + '<span class="cb-job-name"><b>' + esc(j.label) + '</b><small>' + esc(j.when) + '</small></span>'
                + '<span class="cb-job-last">' + esc(last)
                + (j.status === 'error' && j.message ? '<small>' + esc(j.message) + '</small>' : '') + '</span></li>';
        }).join('');
        var bad = jobs.filter(function (j) { return j.state === 'warn'; }).length;
        var head = el.querySelector('[admin-jobs-count]');
        if (head) head.textContent = bad ? bad + ' need' + (bad === 1 ? 's' : '') + ' you' : 'All clear';
        el.classList.toggle('cb-jobs-attn', bad > 0);
    }

    // Redrawing replaces the stepper, so the button a keyboard user just
    // pressed is gone; put focus back on its replacement (or on Back's
    // target) instead of letting it fall to <body>.
    function draw(phase, focusPhase) {
        var cb = model.build(input, phase ? { phase: phase } : null);
        render(cb);
        // The jobs list follows the CURRENT phase (cb.phase), never the one
        // being previewed (cb.shown): overdue only counts in season.
        renderJobs(cb.phase);
        if (focusPhase) {
            var again = root.querySelector('.cb-ph[data-cb-phase="' + focusPhase + '"]');
            if (again) again.focus();
        }
    }

    function openFix(key) {
        var t = FIX[key];
        if (!t) return;
        var opened = typeof window.openTool === 'function' && window.openTool(t[0], t[1] ? window[t[1]] : null);
        // A section with no button of its own (the jobs list) takes focus itself.
        if (opened && !t[1]) {
            var target = document.querySelector('[' + t[0] + ']');
            if (target && target.hasAttribute('tabindex') && !target.contains(document.activeElement)) target.focus({ preventScroll: true });
        }
        if (opened || !t[2]) return;
        // The card is not there (hoopsAdmin.js has not drawn it yet, or drew
        // its error state): open the drawer on the area it lives in, so the
        // tap is never silent.
        var area = document.querySelector(t[2]);
        if (!area) return;
        var drawer = area.closest('details');
        if (drawer && !drawer.open) drawer.open = true;
        area.scrollIntoView({ behavior: 'smooth', block: 'start' });
        if (!area.hasAttribute('tabindex')) area.setAttribute('tabindex', '-1');
        area.focus({ preventScroll: true });
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
        // Counted again whenever the drawer's contents change: basketball's
        // data-task cards are drawn by hoopsAdmin.js after its own fetch.
        function count() {
            if (!meta) return;
            var tools = box.querySelectorAll('.function-container, .ha-task').length;
            var names = Array.prototype.map.call(box.querySelectorAll('[data-toolbox-group], .group-head h2'), function (h) {
                return (h.getAttribute('data-toolbox-group') || h.textContent.split(/\s+[—·]\s+/)[0]).trim();
            });
            var text = tools + ' tool' + (tools === 1 ? '' : 's') + (names.length ? ' · ' + names.join(', ') : '');
            if (meta.textContent !== text) meta.textContent = text;
        }
        count();
        if (window.MutationObserver) new MutationObserver(count).observe(box, { childList: true, subtree: true });
        try { if (window.localStorage.getItem(TOOLBOX_KEY) === '1') box.open = true; } catch (e) { /* convenience */ }
        box.addEventListener('toggle', function () {
            try { window.localStorage.setItem(TOOLBOX_KEY, box.open ? '1' : '0'); } catch (e) { /* convenience */ }
        });
    }

    function load() {
        // Through a promise, so a throw INSIDE gather lands in the catch too.
        return Promise.resolve().then(gather).then(function (got) {
            input = got;
            draw(null);
        }).catch(function () {
            // Leave the Clipboard hidden, but never leave the jobs list on
            // "Loading…": it says it could not read the history.
            input = null;
            renderJobs(null);
        });
    }

    initToolbox();
    window.ccAdminClipboardView = { load: load, gather: gather, render: render, FIX: FIX };
    load();
}());
