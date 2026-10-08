// The basketball admin page (#518). Renders GET /hoops/admin/status and runs
// the four basketball data tasks.
//
// Every task is a CBBD call, billed to the 30k pool both sports share, so a
// button never runs on the first tap: the first tap shows what it will cost,
// the second runs it.
//
// "Last run" comes from two places. The nightly hoops-scores job writes a
// JobRun and does the same refresh as the Refresh button, so that row is shown
// there. The other three tasks have no scheduled job and no JobRun, so the
// last result run FROM THIS PAGE is kept in this browser, next to what is
// actually on file — the on-file counts are the server's answer and do not
// depend on who pressed what.

(function () {
    var root = document.getElementById('hoops-admin');
    if (!root) return;

    var kit = window.ccSportPage;
    var esc = kit.esc;
    var STORE = 'ccHoopsAdminLast';

    // CBBD numbers a split season by its ENDING year — 2027 is 2026–27.
    function seasonLabel(s) { return (s - 1) + '–' + String(s).slice(-2); }
    function n(x) { return x == null ? '—' : Number(x).toLocaleString(); }
    function plural(k, word) { return n(k) + ' ' + word + (k === 1 ? '' : 's'); }
    function day(iso) {
        if (!iso) return '—';
        var d = new Date(iso);
        return isNaN(d) ? '—' : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    }
    function ago(iso) {
        if (!iso) return '';
        var mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
        if (isNaN(mins)) return '';
        if (mins < 1) return 'just now';
        if (mins < 60) return mins + 'm ago';
        var hrs = Math.round(mins / 60);
        return hrs < 24 ? hrs + 'h ago' : Math.round(hrs / 24) + 'd ago';
    }

    // ---- the four tasks -------------------------------------------------
    // url(season) is the endpoint; body(season, type) what it is sent.
    // summary(json) is the one line a successful reply comes down to.
    var TASKS = [
        {
            key: 'ingest', title: 'Teams', icon: 'fa-people-group',
            what: 'Every D-I team for the season: names, conferences, colours, logos. Safe to re-run.',
            url: function (s) { return '/hoops/teams/' + s + '/ingest'; },
            onFile: function (f) { return plural(f.teams.teams, 'team') + ', ' + n(f.teams.withLogos) + ' with logos'; },
            summary: function (r) {
                return n(r.created) + ' created, ' + n(r.updated) + ' updated · ' + plural(r.teams, 'team') + ', ' + n(r.withLogos) + ' with logos';
            }
        },
        {
            key: 'schedule', title: 'Schedule', icon: 'fa-calendar-days', seasonType: true,
            what: 'The whole season\'s games, fetched a month at a time. Also imports jersey numbers the first time.',
            url: function (s) { return '/hoops/games/' + s + '/schedule'; },
            body: function (s, type) { return { seasonType: type }; },
            onFile: function (f) { return plural(f.games.games, 'game') + ' on file'; },
            summary: function (r) {
                var line = n(r.created) + ' created, ' + n(r.updated) + ' updated · ' + plural(r.games, 'game') + ' in ' + plural(r.windows, 'window');
                if (r.rosterError) line += ' · jersey import failed: ' + r.rosterError;
                else if (r.roster && r.roster.players) line += ' · ' + plural(r.roster.players, 'jersey number') + ' imported';
                if (r.restampError) line += ' · week re-stamp failed: ' + r.restampError;
                return line;
            }
        },
        {
            key: 'refresh', title: 'Results', icon: 'fa-rotate', seasonType: true, job: 'hoops-scores',
            what: 'Scores from the last day. The nightly basketball job does this at 11:30 pm CT; this is for now.',
            url: function () { return '/hoops/games/refresh'; },
            body: function (s, type) { return { season: s, seasonType: type }; },
            onFile: function (f) {
                return plural(f.games.finals, 'final') + (f.games.lastFinal ? ', latest ' + day(f.games.lastFinal) : '');
            },
            summary: function (r) {
                return plural(r.games, 'game') + ', ' + n(r.finals) + ' final · ' + n(r.created) + ' created, ' + n(r.updated) + ' updated';
            }
        },
        {
            key: 'roster', title: 'Jersey numbers', icon: 'fa-shirt',
            what: 'Re-import every team\'s numbers — for a late roster addition. The schedule import does this once on its own.',
            url: function (s) { return '/hoops/teams/' + s + '/roster'; },
            onFile: function (f) {
                return plural(f.roster.players, 'numbered player') + ' on ' + plural(f.roster.teams, 'team')
                    + (f.roster.fetchedAt ? ', fetched ' + day(f.roster.fetchedAt) : '');
            },
            summary: function (r) {
                return r.skippedReason ? r.skippedReason : plural(r.players, 'numbered player') + ' across ' + plural(r.teams, 'team');
            }
        }
    ];

    // ---- this browser's last results ------------------------------------
    // Storage can be missing or throw (private window, blocked site data);
    // the page works without it.
    function readLast() {
        try { return JSON.parse(window.localStorage.getItem(STORE)) || {}; } catch (e) { return {}; }
    }
    function writeLast(key, entry) {
        try {
            var all = readLast();
            all[key] = entry;
            window.localStorage.setItem(STORE, JSON.stringify(all));
        } catch (e) { /* convenience only */ }
    }

    var state = { data: null, armed: null, running: null, callsLeft: null };

    function lastLine(t) {
        var mine = readLast()[t.key];
        var html = '';
        if (t.job) {
            var run = (state.data.jobs || []).filter(function (j) { return j.jobName === t.job; })[0];
            html += '<div class="ha-last"><span class="ha-dot ha-' + esc(run && run.status || 'none') + '"></span>'
                + (run && run.status
                    ? 'Nightly job ' + esc(run.status) + ' ' + esc(ago(run.startedAt)) + (run.message ? ' — ' + esc(run.message) : '')
                    : 'Nightly job has not run yet')
                + '</div>';
        }
        if (mine) {
            html += '<div class="ha-last"><span class="ha-dot ha-' + (mine.ok ? 'success' : 'error') + '"></span>'
                + 'Run here ' + esc(ago(mine.at)) + ' — ' + esc(mine.line) + '</div>';
        } else if (!t.job) {
            html += '<div class="ha-last ha-muted">Not run from this page in this browser</div>';
        }
        return html;
    }

    function card(t) {
        var d = state.data;
        var calls = d.calls[t.key];
        var armed = state.armed === t.key;
        var running = state.running === t.key;
        var type = (root.querySelector('[data-type="' + t.key + '"]') || {}).value || 'regular';
        var btn;
        if (running) {
            btn = '<button class="ha-run" disabled><i class="fa-solid fa-spinner fa-spin"></i> Running…</button>';
        } else if (armed) {
            btn = '<button class="ha-run ha-confirm" data-confirm="' + t.key + '">Run — ' + plural(calls, 'CBBD call') + '</button>'
                + '<button class="ha-cancel" data-cancel>Cancel</button>';
        } else {
            btn = '<button class="ha-run" data-arm="' + t.key + '"' + (state.running ? ' disabled' : '') + '>Run</button>';
        }
        return '<section class="sp-card ha-task" data-task="' + t.key + '">'
            + '<div class="ha-head"><i class="fa-solid ' + t.icon + '"></i><h2>' + esc(t.title) + '</h2>'
            + '<code>' + esc('POST ' + t.url(d.season)) + '</code></div>'
            + '<p class="ha-what">' + esc(t.what) + '</p>'
            + '<div class="ha-onfile"><small>On file for ' + esc(d.season) + '</small> ' + esc(t.onFile(d.onFile)) + '</div>'
            + lastLine(t)
            + (armed
                ? '<div class="ha-warn">Billable: about ' + plural(calls, 'call') + ' against the shared CBBD/CFBD pool'
                    + (state.callsLeft != null ? ' (' + n(state.callsLeft) + ' left this month)' : '') + '.</div>'
                : '')
            + '<div class="ha-actions">'
            + (t.seasonType
                ? '<select class="ha-type" data-type="' + t.key + '"' + (running ? ' disabled' : '') + '>'
                    + '<option value="regular"' + (type === 'regular' ? ' selected' : '') + '>Regular season</option>'
                    + '<option value="postseason"' + (type === 'postseason' ? ' selected' : '') + '>Postseason</option></select>'
                : '')
            + btn + '</div></section>';
    }

    function jobsStrip(jobs) {
        return '<div class="sp-h">Scheduled jobs</div><div class="sp-card ha-jobs">'
            + jobs.map(function (j) {
                return '<div class="ha-job"><span class="ha-dot ha-' + esc(j.status || 'none') + '"></span>'
                    + '<b>' + esc(j.jobName) + '</b><span>' + (j.status ? esc(j.status) + ' ' + esc(ago(j.startedAt)) : 'no runs yet') + '</span></div>';
            }).join('') + '</div>';
    }

    function render() {
        var d = state.data;
        var head = '<header class="ha-top"><a class="ha-back" href="/admin"><i class="fa-solid fa-football"></i> Football admin</a>'
            + '<h1><i class="fa-solid fa-basketball"></i> Basketball admin</h1>';
        if (d.season == null) {
            root.innerHTML = head + '</header><div class="sp-error">No basketball season is set, so there is nothing to run against.</div>';
            return;
        }
        root.innerHTML = head
            + '<div class="ha-season">Season <b>' + esc(seasonLabel(d.season)) + '</b> <span>(CBBD season ' + esc(d.season) + ')</span>'
            + (d.seasonStatus ? ' <span class="sp-chip">' + esc(d.seasonStatus) + '</span>' : '')
            + (state.callsLeft != null ? ' <span class="ha-calls">' + n(state.callsLeft) + ' API calls left</span>' : '')
            + '</div></header>'
            + TASKS.map(card).join('')
            + jobsStrip(d.jobs || []);
    }

    function getJson(url) {
        return fetch(url, { headers: { Accept: 'application/json' } }).then(function (r) {
            return r.json().catch(function () { return {}; }).then(function (b) {
                if (!r.ok) throw new Error(b.message || ('Could not load (' + r.status + ')'));
                return b;
            });
        });
    }

    function refreshStatus() {
        return getJson('/hoops/admin/status').then(function (d) { state.data = d; render(); });
    }

    function run(t) {
        var d = state.data;
        var sel = root.querySelector('[data-type="' + t.key + '"]');
        var type = sel ? sel.value : 'regular';
        state.armed = null;
        state.running = t.key;
        render();
        var opts = { method: 'POST', headers: { Accept: 'application/json' } };
        if (t.body) {
            opts.headers['Content-Type'] = 'application/json';
            opts.body = JSON.stringify(t.body(d.season, type));
        }
        return fetch(t.url(d.season), opts).then(function (r) {
            return r.text().then(function (text) {
                var body = null;
                try { body = JSON.parse(text); } catch (e) { /* not JSON: see below */ }
                if (!body) {
                    // Heroku answers a request past 30s with an HTML page while
                    // the handler keeps running — so this is not a failure yet.
                    return { ok: false, line: 'No reply the page could read (HTTP ' + r.status + '). It may still be running on the server — reload in a minute and check the counts.' };
                }
                if (body.remainingCalls != null) state.callsLeft = body.remainingCalls;
                return r.ok
                    ? { ok: true, line: t.summary(body) }
                    : { ok: false, line: (body.message || 'Failed') + ' (HTTP ' + r.status + ')' };
            });
        }).catch(function (e) {
            return { ok: false, line: 'Request failed: ' + e.message };
        }).then(function (res) {
            writeLast(t.key, { ok: res.ok, line: res.line, at: new Date().toISOString() });
            state.running = null;
            // The counts on file are what changed; re-read them.
            return refreshStatus().catch(function () { render(); });
        });
    }

    root.addEventListener('click', function (e) {
        var arm = e.target.closest('[data-arm]');
        var confirm = e.target.closest('[data-confirm]');
        var cancel = e.target.closest('[data-cancel]');
        if (arm && !state.running) { state.armed = arm.getAttribute('data-arm'); render(); }
        else if (cancel) { state.armed = null; render(); }
        else if (confirm && !state.running) {
            var key = confirm.getAttribute('data-confirm');
            run(TASKS.filter(function (t) { return t.key === key; })[0]);
        }
    });

    window.ccHoopsAdmin = { seasonLabel: seasonLabel, TASKS: TASKS };

    // The pool's remaining calls are a nicety for the confirm step; the page
    // does not wait on them. CFBD /info is quota-free.
    getJson('/games/info').then(function (a) {
        if (a && a.remainingCalls != null) { state.callsLeft = a.remainingCalls; if (state.data) render(); }
    }).catch(function () { /* optional */ });

    refreshStatus().catch(function (e) {
        root.innerHTML = '<div class="sp-error">' + esc(e.message) + '</div>';
    });
})();
