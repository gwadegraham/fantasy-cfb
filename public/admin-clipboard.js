// The admin page's Clipboard: which phase of the season a league is in, and
// the short checklist that phase calls for. Pure — no DOM, no fetch — so the
// phase rules and every row's wording are tested directly
// (tests/AdminClipboard.spec.js). UMD: the page loads it as
// window.ccAdminClipboard, Jest requires it.
//
// A commissioner's job changes completely between August, draft night, Week 8
// and bowl season, and the old page listed every tool at all times. The
// Clipboard shows only what the current phase needs, and each open item names
// the ONE tool that fixes it (`fix`, a key the page maps to a tool card).
//
// Everything here is read from routes the admin pages already call — nothing
// on the server was added for it:
//
//   seasonStatus  GET /seasons/:sport            preseason | in-season | complete
//   readiness     GET /scores/readiness/:season  football; platform + league checks
//   status        GET /scores/status/:season     football scoring progress
//   jobs          GET /job-runs                  latest run per job
//   cfpOdds       GET /teams/:season/cfp-odds/status
//   hoops         GET /hoops/admin/status        basketball, Admins only
//   preseason     GET /hoops/admin/preseason     basketball ratings, Admins only
//   members       GET /users/league/:league/roster  players[].inSeason, counted
//   draft         GET /draft/:league/:season
//   engagement    GET /scoring-config/:league    .engagement
//
// Any input may be null: a fetch that failed, or one the viewer may not make
// (a commissioner never gets `hoops`). A missing input drops its rows rather
// than inventing a state.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.ccAdminClipboard = factory();
}(typeof self !== 'undefined' ? self : this, function () {

    var DAY = 24 * 60 * 60 * 1000;

    // A CFP odds board older than this is flagged. Nothing refreshes the odds
    // on a schedule, so age is the only staleness signal there is.
    var ODDS_STALE_DAYS = 14;

    var PHASES = {
        football: [
            { key: 'offseason', label: 'Offseason' },
            { key: 'data', label: 'Data in' },
            { key: 'draft', label: 'Draft night' },
            { key: 'season', label: 'In season' },
            { key: 'postseason', label: 'Bowls & CFP' }
        ],
        basketball: [
            { key: 'offseason', label: 'Offseason' },
            { key: 'data', label: 'Data in' },
            { key: 'draft', label: 'Draft night' },
            { key: 'season', label: 'In season' },
            { key: 'postseason', label: 'Tourney' }
        ]
    };

    // Every job the scheduler runs, per sport, in the order the admin page
    // lists them (modules/scheduler.js JOB_SCHEDULES + the two live pollers;
    // tests/Scheduler.spec.js fails if one is missing here). Both sports'
    // admin pages draw the same list from this, so a job that needs you looks
    // the same on either.
    //
    //   when    the schedule, in words
    //   stale   hours after which a job that should run every night is
    //           overdue IN SEASON. Only football's daily-scores carries one:
    //           it is the one job that writes a run every night, whatever it
    //           found (modules/score-job.js). Every other job is weekly,
    //           event-driven, or writes a run only when it did something.
    //           Its silence is not a fault.
    var JOBS = {
        football: [
            { name: 'daily-scores', label: 'Daily scores', when: 'Nightly 23:00', stale: 36 },
            { name: 'saturday-scores', label: 'Saturday scores', when: 'Saturdays, 4 runs' },
            { name: 'sunday-scores', label: 'Sunday scores', when: 'Sundays 03:00 + 06:00' },
            { name: 'live-scores', label: 'Live scores', when: 'During games · logs on changes' },
            { name: 'enrichment', label: 'Schedule / SP+ / media', when: 'Tuesdays 05:30' },
            { name: 'season-stats', label: 'Team stats', when: 'Tuesdays 06:00' },
            { name: 'player-season-leaders', label: 'Player stats', when: 'Tuesdays 06:30' },
            { name: 'captain-reminder', label: 'Captain alerts', when: 'Every 30 min · logs when it sends' },
            { name: 'recap-notice', label: 'Recap alerts', when: 'Mondays 07:05' }
        ],
        basketball: [
            // No stale check: unlike football's daily-scores (which writes a
            // run every night, "nothing to score" included), hoops-scores
            // writes NO JobRun on its quiet paths — no league, preseason, or
            // after the last week closes — so silence is not a fault.
            { name: 'hoops-scores', label: 'Scores', when: 'Nightly 23:30' },
            { name: 'hoops-live', label: 'Live scores', when: 'During games · logs on finals' },
            { name: 'hoops-stats', label: 'Stats + box scores', when: 'Daily 05:00' },
            { name: 'hoops-media', label: 'TV listings', when: 'Mondays 06:00' },
            { name: 'hoops-ratings', label: 'Ratings', when: 'Daily 06:15 + 22:15' },
            { name: 'hoops-torvik', label: 'Torvik T-Rank', when: 'Daily 06:20 + 22:20' },
            { name: 'hoops-schedule', label: 'Schedule, 4 weeks ahead', when: 'Daily 06:40' },
            { name: 'hoops-net', label: 'NCAA NET', when: 'Daily 11:30, from mid-November' },
            { name: 'hoops-ap', label: 'AP poll', when: 'Daily 12:45' },
            { name: 'hoops-styles', label: 'Style tags', when: 'Daily 07:00' },
            { name: 'hoops-turnover', label: 'Portal + recruits', when: 'Daily 07:10, preseason' }
        ]
    };
    var JOB_LABELS = {};
    Object.keys(JOBS).forEach(function (sport) {
        JOBS[sport].forEach(function (j) { JOB_LABELS[j.name] = j.label; });
    });

    // When automation will score what is outstanding, for a viewer who cannot
    // run scoring by hand (modules/scheduler.js).
    var AUTO_SCORES = { football: 'Auto · 23:00', basketball: 'Auto · 23:30' };

    function plural(n, word) { return n + ' ' + word + (n === 1 ? '' : 's'); }
    function num(n) { return Number(n).toLocaleString('en-US'); }
    function ms(t) {
        if (t == null) return NaN;
        return t instanceof Date ? t.getTime() : new Date(t).getTime();
    }
    // Calendar days in the viewer's zone, not elapsed hours: a draft at 10:00
    // tomorrow is "tomorrow" at 15:00 today, though only 19 hours away.
    // Rounded, so a DST change (a 23- or 25-hour day) still counts as one.
    function startOfDay(t) { var d = new Date(ms(t)); d.setHours(0, 0, 0, 0); return d.getTime(); }
    function daysBetween(from, to) { return Math.round((startOfDay(to) - startOfDay(from)) / DAY); }

    // ---- phase ------------------------------------------------------------

    // The football platform data a draft depends on. Only REQUIRED rows count:
    // SP+ lags CFBD's publishing and is optional by design
    // (modules/season-readiness.js), so it must not hold the phase back.
    function footballDataMissing(readiness) {
        if (!readiness || !readiness.platform) return false;
        return readiness.platform.some(function (c) { return c.required && c.status !== 'ready'; });
    }

    function hoopsDataMissing(hoops) {
        if (!hoops || !hoops.onFile) return false;
        var f = hoops.onFile;
        return !(f.teams && f.teams.teams) || !(f.games && f.games.games) || !(f.roster && f.roster.players);
    }

    // The phase the league is in. Derived, never chosen: the stepper on the
    // page is read-only (a tap previews another phase's list; see build()).
    // null when nothing says where the season is — no season status and no
    // readiness payload — rather than guessing "draft".
    //
    // Preseason "data" needs the platform payload, which a commissioner never
    // gets (/hoops/admin/status is Admin-only), so a basketball commissioner
    // goes straight to "draft": the data gap is not theirs to close.
    function phaseOf(input) {
        var sport = input.sport === 'basketball' ? 'basketball' : 'football';
        var status = input.seasonStatus;
        if (!status && input.readiness) status = input.readiness.seasonUnderway ? 'in-season' : 'preseason';
        if (!status) return null;
        if (status === 'complete') return 'offseason';
        if (status === 'in-season') {
            // Basketball has no tournament signal on the client yet, so its
            // last step stays ahead of it all season.
            return sport === 'football' && input.postseason ? 'postseason' : 'season';
        }
        var missing = sport === 'football' ? footballDataMissing(input.readiness) : hoopsDataMissing(input.hoops);
        return missing ? 'data' : 'draft';
    }

    // ---- rows -------------------------------------------------------------
    //
    // A row: { key, state, label, detail, fix, auto }
    //   state  ok | warn | info | off
    //   fix    the tool that closes it, or null. The page drops the button when
    //          that tool is not on the page (a commissioner has no data tools).
    //   auto   for a gap automation closes on its own: when it will.

    function row(key, state, label, detail, fix, auto) {
        return { key: key, state: state, label: label, detail: detail || '', fix: fix || null, auto: auto || null };
    }

    // A readiness check (modules/season-readiness.js) as a row. Its keys are
    // already the tool keys the Clipboard's FIX map (public/admin-clipboard-view.js) understands.
    function fromReadiness(c) {
        // Only a REQUIRED gap is work. An optional row that is partial — a
        // draft in progress (actionLabel 'Open') — is a state to report, and
        // its tool cannot help: Configure Draft 409s while a draft is active.
        var state = c.status === 'ready' ? 'ok'
            : c.status === 'off' ? 'off'
            : c.noAction ? 'info'
            : c.required ? 'warn' : 'info';
        var fix = state === 'ok' || c.noAction || c.actionLabel === 'Open' ? null : c.key;
        return row(c.key, state, c.label, c.note || c.detail, fix);
    }

    function leagueReadiness(readiness, league) {
        var leagues = (readiness && readiness.leagues) || [];
        var mine = leagues.filter(function (l) { return l.league === league; })[0];
        return mine ? mine.checks : [];
    }

    // The draft, read off the Draft document. Football gets the same answer
    // from readiness; basketball has no readiness endpoint, so this mirrors
    // leagueChecks' draft rules in modules/season-readiness.js.
    function draftRow(draft, now) {
        if (!draft) return row('draft', 'warn', 'No draft configured', 'Set the date, rounds and pool', 'draft');
        var order = draft.draftOrder || [];
        var picks = draft.picks || [];
        var rounds = draft.totalRounds || 10;
        if (draft.status === 'complete') return row('draft', 'ok', 'Draft complete', plural(picks.length, 'pick'));
        if (draft.status === 'active' && picks.length) {
            return row('draft', 'info', 'Draft in progress', picks.length + ' of ' + (order.length * rounds) + ' picks made');
        }
        var shape = plural(order.length, 'manager') + ' · ' + rounds + ' rounds' + (draft.poolSize ? ' · ' + draft.poolSize + ' pool' : '');
        if (order.length < 2) return row('draft', 'warn', 'Pick order not set', shape, 'draft');
        if (!draft.scheduledAt) return row('draft', 'warn', 'Draft date not set', shape, 'draft');
        var days = daysBetween(now, draft.scheduledAt);
        // A past date on a draft that never started is reported, not flagged:
        // readiness calls any dated draft ready, and the commissioner may just
        // be about to open the room.
        if (days < 0) return row('draft', 'info', 'Draft date has passed', shape + ' · not started', 'draft');
        var when = days > 1 ? 'in ' + days + ' days' : days === 1 ? 'tomorrow' : 'today';
        return row('draft', 'ok', 'Draft scheduled ' + when, shape);
    }

    function modesRow(engagement) {
        var e = engagement || {};
        var modes = [];
        if (e.captainEnabled) modes.push('Captain ' + (e.captainMultiplier || 2) + '×');
        if (e.h2hEnabled) modes.push('H2H +' + (e.h2hWinBonus != null ? e.h2hWinBonus : 3) + (e.h2hTieBonus ? '/+' + e.h2hTieBonus + ' tie' : ''));
        return modes.length
            ? row('gameModes', 'ok', modes.join(' · '), 'Game modes this season')
            : row('gameModes', 'off', 'Classic scoring', 'No game modes this season');
    }

    function latestJobs(jobs, test) {
        var latest = {};
        (jobs || []).forEach(function (j) {
            // /hoops/admin/status lists never-run jobs as { jobName, status: null }.
            if (!j || !j.jobName || !j.status || !test(j.jobName)) return;
            var prev = latest[j.jobName];
            if (!prev || ms(j.startedAt) > ms(prev.startedAt)) latest[j.jobName] = j;
        });
        return Object.keys(latest).sort().map(function (k) { return latest[k]; });
    }

    // The automated jobs, one entry per scheduled job — including those with
    // no run on file, which a list built from the runs alone would leave out.
    //
    //   state  warn  failed on its last run, or a nightly job overdue in season
    //          info  running right now
    //          ok    last run succeeded (or skipped: nothing to do)
    //          off   no run on file, and none expected yet
    //   status the last run's own status, null when there is none
    //   at     when that run started
    //
    // Unrecognised job names in the runs are ignored: the list is the schedule.
    function jobList(sport, runs, opts) {
        var o = opts || {};
        var now = o.now != null ? o.now : Date.now();
        var specs = JOBS[sport === 'basketball' ? 'basketball' : 'football'];
        var mine = {};
        latestJobs(runs, function (n) { return specs.some(function (s) { return s.name === n; }); })
            .forEach(function (j) { mine[j.jobName] = j; });
        return specs.map(function (spec) {
            var run = mine[spec.name] || null;
            var at = run ? run.startedAt : null;
            var hours = at ? (ms(now) - ms(at)) / 3600000 : null;
            var overdue = !!(o.inSeason && spec.stale && (hours == null || hours > spec.stale));
            var state = run && run.status === 'error' ? 'warn'
                : overdue ? 'warn'
                : run && run.status === 'running' ? 'info'
                : run ? 'ok' : 'off';
            return { name: spec.name, label: spec.label, when: spec.when, state: state,
                status: run ? run.status : null, at: at, overdue: overdue, message: (run && run.message) || '' };
        });
    }

    // The Clipboard's view of the same list: a row per job that needs you,
    // else one row saying how many have run and how many have not yet.
    function jobRows(jobs, sport, now, inSeason) {
        if (!jobs) return [];
        var list = jobList(sport, jobs, { now: now, inSeason: inSeason });
        var bad = list.filter(function (j) { return j.state === 'warn'; });
        if (bad.length) {
            return bad.map(function (j) {
                var scoring = /scores$/.test(j.name);
                if (j.status === 'error') {
                    return row('job:' + j.name, 'warn', j.label + ' failed', j.message || 'Last run errored', scoring ? 'scores' : 'jobs');
                }
                return row('job:' + j.name, 'warn', j.label + (j.at ? ' is overdue' : ' has not run'),
                    j.at ? 'Last ran ' + plural(Math.floor((ms(now) - ms(j.at)) / 3600000), 'hour') + ' ago · ' + j.when : j.when, 'jobs');
            });
        }
        var ran = list.filter(function (j) { return j.status; }).length;
        var never = list.length - ran;
        return [row('jobs', 'ok', 'Jobs running fine',
            ran + ' of ' + list.length + ' have run' + (never ? ' · ' + never + ' no runs yet' : ''), 'jobs')];
    }

    function recapRow(jobs) {
        var run = latestJobs(jobs, function (n) { return n === 'recap-notice'; })[0];
        if (!run || run.status !== 'success') return null;
        return row('recap', 'ok', 'Recap alert sent', 'Latest Monday push');
    }

    // Football scoring progress. /scores/status counts EVERY league's
    // franchises, so its numbers are platform-wide: an Admin sees them as
    // such, and a commissioner gets no count that would read as their own
    // league's — only that a scoring run is due, and when.
    function footballScoringRow(status, isAdmin) {
        if (!status) return null;
        var through = status.scoredThroughWeek;
        if (!status.unscoredResults) {
            return row('scores', 'ok', through ? 'Scored through Week ' + through : 'Nothing to score yet', 'Automation is current');
        }
        if (!isAdmin) return row('scores', 'info', 'New results to score', 'Automatic scoring run tonight', null, AUTO_SCORES.football);
        return row('scores', 'warn', plural(status.unscoredResults, 'final') + ' not scored yet',
            'Every league' + (status.gamesLoadedThroughWeek ? ' · games loaded through Week ' + status.gamesLoadedThroughWeek : ''), 'scores');
    }

    function cfpOddsRow(odds, now) {
        if (!odds) return null;
        if (!odds.makeCount && !odds.champCount) return row('cfpOdds', 'warn', 'No CFP odds on file', 'The playoff term falls back to an SP+ proxy', 'cfpOdds');
        if (!odds.updatedAt) return row('cfpOdds', 'info', 'CFP odds on file', 'Pasted before dates were tracked', 'cfpOdds');
        var age = daysBetween(odds.updatedAt, now);
        return age > ODDS_STALE_DAYS
            ? row('cfpOdds', 'warn', 'CFP odds board is ' + age + ' days old', 'Feeds the playoff term in projections', 'cfpOdds')
            : row('cfpOdds', 'ok', 'CFP odds current', 'Pasted ' + plural(Math.max(age, 0), 'day') + ' ago');
    }

    function hoopsDataRows(hoops) {
        if (!hoops || !hoops.onFile) return [];
        var f = hoops.onFile;
        var teams = (f.teams && f.teams.teams) || 0;
        var logos = (f.teams && f.teams.withLogos) || 0;
        var games = (f.games && f.games.games) || 0;
        var players = (f.roster && f.roster.players) || 0;
        return [
            !teams ? row('hoops-ingest', 'warn', 'No teams on file', 'Every D-I team, logos and colours', 'hoops-ingest')
                : logos < teams ? row('hoops-ingest', 'warn', num(teams) + ' teams, ' + num(logos) + ' with logos', 'Re-run the team import', 'hoops-ingest')
                : row('hoops-ingest', 'ok', num(teams) + ' teams, all with logos', ''),
            games ? row('hoops-schedule', 'ok', num(games) + ' games scheduled', '')
                : row('hoops-schedule', 'warn', 'No schedule on file', 'Fetched a month at a time', 'hoops-schedule'),
            players ? row('hoops-roster', 'ok', num(players) + ' numbered players', '')
                : row('hoops-roster', 'warn', 'No rosters on file', 'Jersey numbers for the box scores', 'hoops-roster')
        ];
    }

    // The preseason ratings (Torvik import, #544) order the basketball draft
    // pool until NET is published. Two sources side by side means a partial
    // import left an old set behind.
    function preseasonRow(pre, now) {
        if (!pre || !pre.current) return null;
        var c = pre.current;
        if (!c.ranked) return row('hoops-preseason', 'warn', 'No preseason ratings', 'They order the draft pool until NET is out', 'hoops-preseason');
        if (c.sources > 1) return row('hoops-preseason', 'warn', 'Two rating imports on file', 'Re-import to replace the older set', 'hoops-preseason');
        var age = c.importedAt ? daysBetween(c.importedAt, now) : null;
        return row('hoops-preseason', 'ok', num(c.ranked) + ' teams ranked',
            age == null ? 'Preseason ratings' : 'Imported ' + (age === 0 ? 'today' : plural(age, 'day') + ' ago'));
    }

    function hoopsResultsRow(hoops, isAdmin) {
        if (!hoops || !hoops.onFile || !hoops.onFile.games) return null;
        var g = hoops.onFile.games;
        var finals = g.finals || 0;
        return row('hoops-refresh', 'ok', num(finals) + ' final' + (finals === 1 ? '' : 's') + ' on file',
            g.lastFinal ? 'Latest ' + new Date(g.lastFinal).toISOString().slice(0, 10) : 'None yet',
            null, isAdmin ? null : AUTO_SCORES.basketball);
    }

    // ---- the checklist for one phase ----------------------------------------

    function compact(rows) { return rows.filter(Boolean); }

    function checklist(phase, input, now) {
        var sport = input.sport === 'basketball' ? 'basketball' : 'football';
        var isAdmin = !!input.isAdmin;
        var platform = [];
        var league = [];

        if (phase === 'offseason') return { platform: [], league: [] };

        if (phase === 'data' || phase === 'draft') {
            if (sport === 'football') {
                if (isAdmin) platform = ((input.readiness && input.readiness.platform) || []).map(fromReadiness);
                league = leagueReadiness(input.readiness, input.league).map(fromReadiness);
                // No readiness row for this league (a fetch failed, or a
                // league readiness does not list): read the documents.
                if (!league.length) league = compact([input.draft !== undefined ? draftRow(input.draft, now) : null,
                    input.engagement !== undefined ? modesRow(input.engagement) : null]);
            } else {
                if (isAdmin) platform = compact(hoopsDataRows(input.hoops).concat([preseasonRow(input.preseason, now)]));
                league = compact([
                    input.members != null ? (input.members >= 2
                        ? row('roster', 'ok', plural(input.members, 'manager'), 'On this season\'s roster')
                        : row('roster', 'warn', input.members ? 'Only 1 manager' : 'Nobody added yet', 'Add managers before the draft', 'roster')) : null,
                    input.draft !== undefined ? draftRow(input.draft, now) : null,
                    input.engagement !== undefined ? modesRow(input.engagement) : null
                ]);
            }
            return { platform: platform, league: league };
        }

        // In season, and the postseason that follows it.
        if (sport === 'football') {
            var scoring = footballScoringRow(input.status, isAdmin);
            if (isAdmin) {
                platform = compact([scoring].concat(jobRows(input.jobs, 'football', now, true), [cfpOddsRow(input.cfpOdds, now)]));
            } else {
                league.push(scoring);
            }
            league = league.concat([recapRow(input.jobs)]);
        } else {
            if (isAdmin) platform = compact([hoopsResultsRow(input.hoops, true)].concat(jobRows(input.jobs, 'basketball', now, true)));
            else league.push(hoopsResultsRow(input.hoops, false));
        }
        if (input.draft !== undefined) league.push(draftRow(input.draft, now));
        if (input.engagement !== undefined) league.push(modesRow(input.engagement));
        return { platform: platform, league: compact(league) };
    }

    function title(phase, input) {
        var sport = input.sport === 'basketball' ? 'basketball' : 'football';
        if (phase === 'season') {
            var week = input.week || (input.status && input.status.gamesLoadedThroughWeek);
            return sport === 'football' && week ? 'Week ' + week : 'In season';
        }
        return {
            offseason: 'Offseason', data: 'Data in', draft: 'Draft prep',
            postseason: sport === 'football' ? 'Bowls & CFP' : 'Tourney'
        }[phase];
    }

    // What the NEXT phase adds, so the commissioner knows what is coming.
    var NEXT = {
        offseason: 'The data checklist opens when the new season is set.',
        data: 'Once the data is in, the draft checklist takes over.',
        draft: 'After the draft, scoring and the job health check move onto this list.',
        season: { football: 'Bracket ingest and postseason scoring move onto this list.', basketball: 'Tournament scoring moves onto this list.' },
        postseason: 'The season closes and the list clears.'
    };

    // build(input, opts) -> the whole Clipboard.
    //
    //   input.sport      'football' | 'basketball'
    //   input.isAdmin    platform rows and hand-run fixes are Admin-only
    //   input.league     the league code this page manages
    //   input.now        injectable clock (Date or ms); defaults to now
    //   opts.phase       preview another phase's list (the read-only stepper)
    function build(input, opts) {
        input = input || {};
        var sport = input.sport === 'basketball' ? 'basketball' : 'football';
        var now = input.now != null ? input.now : Date.now();
        var current = phaseOf(input);
        var order = PHASES[sport].map(function (p) { return p.key; });
        // Unknown: no list, no "now". The page leaves the Clipboard hidden.
        if (!current) {
            return {
                sport: sport, phase: null, shown: null, preview: false,
                phases: PHASES[sport].map(function (p) { return { key: p.key, label: p.label, state: 'next' }; }),
                title: '', summary: 'Season status unavailable', open: 0, groups: [], next: null
            };
        }
        var shown = (opts && opts.phase) || current;
        var at = order.indexOf(current);

        var lists = checklist(shown, input, now);
        var groups = [];
        if (lists.platform.length) groups.push({ key: 'platform', label: 'Platform · every league', items: lists.platform });
        if (lists.league.length) groups.push({ key: 'league', label: input.leagueName || input.league || 'This league', items: lists.league });

        var all = lists.platform.concat(lists.league);
        var open = all.filter(function (r) { return r.state === 'warn'; }).length;
        var counted = all.filter(function (r) { return r.state === 'ok' || r.state === 'warn'; }).length;

        var nextIdx = order.indexOf(shown) + 1;
        var next = nextIdx < order.length ? PHASES[sport][nextIdx] : null;
        var nextText = NEXT[shown];
        if (nextText && typeof nextText === 'object') nextText = nextText[sport];

        return {
            sport: sport,
            phase: current,
            shown: shown,
            preview: shown !== current,
            phases: PHASES[sport].map(function (p, i) {
                return { key: p.key, label: p.label, state: i < at ? 'done' : i === at ? 'now' : 'next' };
            }),
            title: title(shown, input),
            summary: !all.length ? 'Nothing to check in this phase'
                : !open ? 'Nothing needs you'
                : (counted - open) + ' of ' + counted + ' done',
            open: open,
            groups: groups,
            next: next ? { key: next.key, label: next.label, text: nextText } : null
        };
    }

    return { build: build, phaseOf: phaseOf, jobList: jobList, JOBS: JOBS, JOB_LABELS: JOB_LABELS, PHASES: PHASES, ODDS_STALE_DAYS: ODDS_STALE_DAYS };
}));
