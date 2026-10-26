// Coverage for public/admin-clipboard.js — the admin page's season-phase
// checklist. Pure, so every rule is driven with plain payloads shaped like
// the routes the page reads (see the module header for which route is which).
//
// The two things that matter most:
//   - the PHASE, because it picks the whole list, and
//   - the ROLE split: an Admin gets platform rows and hand-run fixes; a
//     commissioner gets their league's rows, and a gap automation closes
//     says when, instead of offering a button for a tool they do not have.

const { build, phaseOf, PHASES, ODDS_STALE_DAYS } = require('../public/admin-clipboard');

const NOW = new Date('2026-10-19T15:00:00Z');
const daysAgo = n => new Date(NOW.getTime() - n * 864e5).toISOString();
const daysAhead = n => new Date(NOW.getTime() + n * 864e5).toISOString();

const check = (key, status, extra) => Object.assign({ key, label: key, status, detail: key + ' detail', required: true }, extra);

const readyPlatform = [
    check('schedule', 'ready'), check('enrichment', 'ready'), check('expectedWins', 'ready'),
    check('cfpOdds', 'ready'), check('spPlus', 'missing', { required: false })
];
const readiness = (platform, leagueChecks, extra) => Object.assign({
    season: '2026',
    platform,
    leagues: [{ league: 'graham-league', name: 'gg', checks: leagueChecks || [] },
        { league: 'claunts-league', name: 'Claunts', checks: [check('draft', 'missing')] }]
}, extra);

const hoopsFull = {
    onFile: {
        teams: { teams: 365, withLogos: 365 },
        games: { games: 5266, finals: 1715, lastFinal: '2026-10-06T23:00:00Z' },
        roster: { players: 5264, teams: 365 }
    }
};

const draftReady = { draftOrder: ['a', 'b', 'c'], picks: [], totalRounds: 10, poolSize: 120, scheduledAt: daysAhead(13) };

const rows = cb => cb.groups.reduce((all, g) => all.concat(g.items), []);
const byKey = (cb, key) => rows(cb).find(r => r.key === key);
const group = (cb, key) => cb.groups.find(g => g.key === key);

describe('phaseOf', () => {
    test('a complete season is the offseason, for both sports', () => {
        expect(phaseOf({ sport: 'football', seasonStatus: 'complete' })).toBe('offseason');
        expect(phaseOf({ sport: 'basketball', seasonStatus: 'complete' })).toBe('offseason');
    });

    test('preseason with a required platform row outstanding is "data"', () => {
        const r = readiness([check('schedule', 'missing')].concat(readyPlatform.slice(1)));
        expect(phaseOf({ sport: 'football', seasonStatus: 'preseason', readiness: r })).toBe('data');
    });

    test('preseason with the data in is "draft" — an optional row (SP+) never holds it back', () => {
        expect(phaseOf({ sport: 'football', seasonStatus: 'preseason', readiness: readiness(readyPlatform) })).toBe('draft');
    });

    test('a partial required row still counts as missing', () => {
        const r = readiness([check('schedule', 'partial')]);
        expect(phaseOf({ sport: 'football', seasonStatus: 'preseason', readiness: r })).toBe('data');
    });

    test('basketball preseason: any empty data set is "data", all three on file is "draft"', () => {
        expect(phaseOf({ sport: 'basketball', seasonStatus: 'preseason', hoops: hoopsFull })).toBe('draft');
        ['teams', 'games', 'roster'].forEach(k => {
            const onFile = Object.assign({}, hoopsFull.onFile, { [k]: {} });
            expect(phaseOf({ sport: 'basketball', seasonStatus: 'preseason', hoops: { onFile } })).toBe('data');
        });
    });

    test('readiness alone (no season status) still places preseason', () => {
        expect(phaseOf({ sport: 'football', readiness: readiness([check('schedule', 'missing')]) })).toBe('data');
    });

    test('without the platform payload (a commissioner) preseason is "draft"', () => {
        expect(phaseOf({ sport: 'basketball', seasonStatus: 'preseason' })).toBe('draft');
        expect(phaseOf({ sport: 'football', seasonStatus: 'preseason' })).toBe('draft');
    });

    test('in season; football postseason only when the week says so', () => {
        expect(phaseOf({ sport: 'football', seasonStatus: 'in-season' })).toBe('season');
        expect(phaseOf({ sport: 'football', seasonStatus: 'in-season', postseason: true })).toBe('postseason');
    });

    test('basketball has no tournament signal yet, so it stays "season"', () => {
        expect(phaseOf({ sport: 'basketball', seasonStatus: 'in-season', postseason: true })).toBe('season');
    });

    test('no season status: readiness.seasonUnderway decides', () => {
        expect(phaseOf({ sport: 'football', readiness: readiness(readyPlatform, [], { seasonUnderway: true }) })).toBe('season');
        expect(phaseOf({ sport: 'football', readiness: readiness(readyPlatform) })).toBe('draft');
    });

    test('an unknown sport is treated as football', () => {
        expect(phaseOf({ sport: 'curling', seasonStatus: 'in-season', postseason: true })).toBe('postseason');
    });
});

describe('the stepper', () => {
    test('phases before the current one are done, after it next', () => {
        const cb = build({ sport: 'football', seasonStatus: 'in-season', now: NOW });
        expect(cb.phases.map(p => p.state)).toEqual(['done', 'done', 'done', 'now', 'next']);
    });

    test('each sport names its last phase', () => {
        expect(PHASES.football[4].label).toBe('Bowls & CFP');
        expect(PHASES.basketball[4].label).toBe('Tourney');
        expect(build({ sport: 'basketball', seasonStatus: 'complete', now: NOW }).phases[4].label).toBe('Tourney');
    });

    test('opts.phase previews another list without moving the current phase', () => {
        const input = { sport: 'football', isAdmin: true, seasonStatus: 'in-season', league: 'graham-league',
            readiness: readiness(readyPlatform, [check('draft', 'ready')]), now: NOW };
        const cb = build(input, { phase: 'draft' });
        expect(cb.phase).toBe('season');
        expect(cb.shown).toBe('draft');
        expect(cb.preview).toBe(true);
        expect(cb.title).toBe('Draft prep');
        expect(cb.phases.find(p => p.state === 'now').key).toBe('season');
        expect(build(input).preview).toBe(false);
    });

    test('the next phase is named, with what it adds', () => {
        const fb = build({ sport: 'football', seasonStatus: 'in-season', now: NOW });
        expect(fb.next).toEqual({ key: 'postseason', label: 'Bowls & CFP', text: expect.stringMatching(/Bracket/) });
        const bb = build({ sport: 'basketball', seasonStatus: 'in-season', now: NOW });
        expect(bb.next.text).toMatch(/Tournament/);
        expect(build({ sport: 'football', seasonStatus: 'in-season', postseason: true, now: NOW }).next).toBeNull();
    });
});

describe('football, draft prep', () => {
    const base = {
        sport: 'football', seasonStatus: 'preseason', league: 'graham-league', leagueName: 'gg', now: NOW,
        readiness: readiness(readyPlatform, [check('roster', 'ready'), check('draft', 'partial'), check('gameModes', 'off', { required: false })])
    };

    test('an Admin sees platform rows, then their league — never another league', () => {
        const cb = build(Object.assign({ isAdmin: true }, base));
        expect(cb.groups.map(g => g.key)).toEqual(['platform', 'league']);
        expect(group(cb, 'league').label).toBe('gg');
        expect(group(cb, 'league').items.map(r => r.key)).toEqual(['roster', 'draft', 'gameModes']);
    });

    test('a commissioner gets no platform group', () => {
        const cb = build(Object.assign({ isAdmin: false }, base));
        expect(cb.groups.map(g => g.key)).toEqual(['league']);
    });

    test('readiness states map to rows; ready rows carry no fix', () => {
        const cb = build(Object.assign({ isAdmin: true }, base));
        expect(byKey(cb, 'schedule')).toMatchObject({ state: 'ok', fix: null });
        expect(byKey(cb, 'draft')).toMatchObject({ state: 'warn', fix: 'draft' });
        expect(byKey(cb, 'gameModes')).toMatchObject({ state: 'off', fix: 'gameModes' });
        // Optional and missing (SP+ not published) is information, not a gap.
        expect(byKey(cb, 'spPlus')).toMatchObject({ state: 'info', fix: 'spPlus' });
    });

    test('a row the commissioner cannot close (noAction) has no button', () => {
        const r = readiness([check('enrichment', 'partial', { noAction: true, note: 'talent not published' })]);
        const cb = build(Object.assign({}, base, { isAdmin: true, readiness: r }));
        expect(byKey(cb, 'enrichment')).toMatchObject({ state: 'info', fix: null, detail: 'talent not published' });
    });

    test('summary counts ok/warn only; info and off are not tasks', () => {
        const cb = build(Object.assign({ isAdmin: true }, base));
        // ok: schedule, enrichment, expectedWins, cfpOdds, roster · warn: draft
        expect(cb.summary).toBe('5 of 6 done');
        expect(cb.open).toBe(1);
    });

    test('no readiness row for the league falls back to the draft and mode documents', () => {
        const cb = build(Object.assign({}, base, { isAdmin: false, league: 'new-league', draft: null, engagement: { captainEnabled: true } }));
        expect(group(cb, 'league').items.map(r => r.key)).toEqual(['draft', 'gameModes']);
        expect(byKey(cb, 'draft')).toMatchObject({ state: 'warn', label: 'No draft configured' });
    });

    test('nothing at all to show reads as such', () => {
        const cb = build({ sport: 'football', seasonStatus: 'preseason', now: NOW });
        expect(cb.groups).toEqual([]);
        expect(cb.summary).toBe('Nothing to check in this phase');
    });
});

describe('football, in season', () => {
    const base = {
        sport: 'football', seasonStatus: 'in-season', league: 'graham-league', now: NOW, week: 8,
        status: { scoredThroughWeek: 7, gamesLoadedThroughWeek: 8, unscoredResults: 3 },
        jobs: [
            { jobName: 'daily-scores', status: 'success', startedAt: daysAgo(1) },
            { jobName: 'recap-notice', status: 'success', startedAt: daysAgo(0) },
            { jobName: 'hoops-scores', status: 'error', startedAt: daysAgo(0) }
        ],
        cfpOdds: { makeCount: 25, champCount: 40, updatedAt: daysAgo(23) },
        engagement: { captainEnabled: true, captainMultiplier: 2, h2hEnabled: true, h2hWinBonus: 3 },
        draft: { status: 'complete', picks: new Array(48).fill({}) }
    };

    test('the title is the week', () => {
        expect(build(base).title).toBe('Week 8');
        expect(build(Object.assign({}, base, { week: null })).title).toBe('Week 8');
        expect(build(Object.assign({}, base, { week: null, status: null })).title).toBe('In season');
    });

    test('Admin: unscored finals are a gap with a Score button', () => {
        const cb = build(Object.assign({ isAdmin: true }, base));
        // /scores/status counts every league, so the Admin row says so.
        expect(byKey(cb, 'scores')).toMatchObject({ state: 'warn', fix: 'scores', label: '3 finals not scored yet',
            detail: 'Every league · games loaded through Week 8' });
        expect(group(cb, 'platform').items.map(r => r.key)).toContain('scores');
    });

    test('commissioner: no platform-wide count, just that a run is due and when', () => {
        const cb = build(Object.assign({ isAdmin: false }, base));
        expect(byKey(cb, 'scores')).toMatchObject({ state: 'info', fix: null, auto: 'Auto · 23:00', label: 'New results to score' });
        expect(JSON.stringify(rows(cb))).not.toMatch(/\b3 finals?\b/);
        expect(group(cb, 'platform')).toBeUndefined();
        expect(group(cb, 'league').items.map(r => r.key)).toEqual(['scores', 'recap', 'draft', 'gameModes']);
    });

    test('scoring current reads as done', () => {
        const cb = build(Object.assign({}, base, { status: { scoredThroughWeek: 8, unscoredResults: 0 } }));
        expect(byKey(cb, 'scores')).toMatchObject({ state: 'ok', label: 'Scored through Week 8' });
        const empty = build(Object.assign({}, base, { status: { unscoredResults: 0 } }));
        expect(byKey(empty, 'scores').label).toBe('Nothing to score yet');
    });

    test('unscored finals with no loaded week still name the count', () => {
        const cb = build(Object.assign({ isAdmin: true }, base, { status: { unscoredResults: 1 } }));
        expect(byKey(cb, 'scores')).toMatchObject({ label: '1 final not scored yet', detail: 'Every league' });
    });

    test('a stale CFP odds board is flagged past the threshold, and only for an Admin', () => {
        expect(byKey(build(Object.assign({ isAdmin: true }, base)), 'cfpOdds'))
            .toMatchObject({ state: 'warn', label: 'CFP odds board is 23 days old', fix: 'cfpOdds' });
        const fresh = Object.assign({}, base, { isAdmin: true, cfpOdds: { makeCount: 1, updatedAt: daysAgo(ODDS_STALE_DAYS) } });
        expect(byKey(build(fresh), 'cfpOdds')).toMatchObject({ state: 'ok', detail: 'Pasted 14 days ago' });
        expect(byKey(build(Object.assign({ isAdmin: false }, base)), 'cfpOdds')).toBeUndefined();
    });

    test('CFP odds: none on file, and undated', () => {
        const none = build(Object.assign({}, base, { isAdmin: true, cfpOdds: { makeCount: 0, champCount: 0 } }));
        expect(byKey(none, 'cfpOdds')).toMatchObject({ state: 'warn', label: 'No CFP odds on file' });
        const undated = build(Object.assign({}, base, { isAdmin: true, cfpOdds: { champCount: 3 } }));
        expect(byKey(undated, 'cfpOdds')).toMatchObject({ state: 'info' });
        expect(byKey(build(Object.assign({}, base, { isAdmin: true, cfpOdds: null })), 'cfpOdds')).toBeUndefined();
    });

    test('football never reports a basketball job, and healthy jobs collapse to one row', () => {
        const cb = build(Object.assign({ isAdmin: true }, base));
        // 9 football jobs scheduled; daily-scores and recap-notice have run.
        expect(byKey(cb, 'jobs')).toMatchObject({ state: 'ok', label: 'Jobs running fine', detail: '2 of 9 have run · 7 no runs yet' });
        expect(rows(cb).some(r => /hoops/.test(r.key))).toBe(false);
    });

    test('a failed job gets its own row; only the LATEST run per job counts', () => {
        const jobs = base.jobs.concat([
            { jobName: 'sunday-scores', status: 'error', startedAt: daysAgo(1), message: 'H12 timeout' },
            { jobName: 'enrichment', status: 'error', startedAt: daysAgo(6) },
            { jobName: 'enrichment', status: 'success', startedAt: daysAgo(5) },
            { jobName: 'mystery-job', status: 'error', startedAt: daysAgo(2) },
            null, { status: 'error' }
        ]);
        const cb = build(Object.assign({}, base, { isAdmin: true, jobs }));
        expect(byKey(cb, 'job:sunday-scores')).toMatchObject({ state: 'warn', label: 'Sunday scores failed', detail: 'H12 timeout', fix: 'scores' });
        // Not on the schedule: ignored, the list is the schedule.
        expect(byKey(cb, 'job:mystery-job')).toBeUndefined();
        expect(byKey(cb, 'job:enrichment')).toBeUndefined();
        expect(byKey(cb, 'jobs')).toBeUndefined();
    });

    test('a recap that did not succeed is not reported as sent', () => {
        const jobs = [{ jobName: 'recap-notice', status: 'running', startedAt: daysAgo(0) }];
        expect(byKey(build(Object.assign({}, base, { jobs })), 'recap')).toBeUndefined();
        expect(byKey(build(Object.assign({}, base, { jobs: null })), 'jobs')).toBeUndefined();
    });

    test('game modes: on, and classic', () => {
        expect(byKey(build(base), 'gameModes')).toMatchObject({ state: 'ok', label: 'Captain 2× · H2H +3' });
        expect(byKey(build(Object.assign({}, base, { engagement: { h2hEnabled: true } })), 'gameModes').label).toBe('H2H +3');
        expect(byKey(build(Object.assign({}, base, { engagement: null })), 'gameModes')).toMatchObject({ state: 'off', label: 'Classic scoring' });
    });

    test('postseason uses the in-season list under its own title', () => {
        const cb = build(Object.assign({ isAdmin: true, postseason: true }, base));
        expect(cb.title).toBe('Bowls & CFP');
        expect(byKey(cb, 'scores')).toBeDefined();
    });
});

describe('basketball', () => {
    const base = {
        sport: 'basketball', seasonStatus: 'preseason', league: 'hoops-league', leagueName: 'Hardwood Heroes', now: NOW,
        hoops: hoopsFull, members: 6, draft: draftReady, engagement: { captainEnabled: true, h2hEnabled: true }
    };

    test('Admin draft prep: the three data sets, then the league', () => {
        const cb = build(Object.assign({ isAdmin: true }, base));
        expect(cb.title).toBe('Draft prep');
        expect(group(cb, 'platform').items.map(r => r.label)).toEqual([
            '365 teams, all with logos', '5,266 games scheduled', '5,264 numbered players'
        ]);
        expect(group(cb, 'league').items.map(r => r.key)).toEqual(['roster', 'draft', 'gameModes']);
        expect(byKey(cb, 'draft')).toMatchObject({ state: 'ok', label: 'Draft scheduled in 13 days', detail: '3 managers · 10 rounds · 120 pool' });
        expect(cb.summary).toBe('Nothing needs you');
    });

    test('a commissioner never gets the CBBD data rows', () => {
        const cb = build(Object.assign({ isAdmin: false }, base, { hoops: null }));
        expect(cb.groups.map(g => g.key)).toEqual(['league']);
    });

    test('missing data sets each point at their own task', () => {
        const onFile = { teams: { teams: 365, withLogos: 300 }, games: {}, roster: {} };
        const cb = build(Object.assign({ isAdmin: true }, base, { hoops: { onFile } }));
        expect(cb.phase).toBe('data');
        expect(cb.title).toBe('Data in');
        expect(group(cb, 'platform').items.map(r => [r.fix, r.state])).toEqual([
            ['hoops-ingest', 'warn'], ['hoops-schedule', 'warn'], ['hoops-roster', 'warn']
        ]);
        const none = build(Object.assign({ isAdmin: true }, base, { hoops: { onFile: { teams: {}, games: {}, roster: {} } } }));
        expect(byKey(none, 'hoops-ingest').label).toBe('No teams on file');
    });

    test('roster: one manager, and nobody', () => {
        expect(byKey(build(Object.assign({}, base, { members: 1 })), 'roster')).toMatchObject({ state: 'warn', label: 'Only 1 manager', fix: 'roster' });
        expect(byKey(build(Object.assign({}, base, { members: 0 })), 'roster').label).toBe('Nobody added yet');
        expect(byKey(build(Object.assign({}, base, { members: null })), 'roster')).toBeUndefined();
    });

    test('in season: results, jobs (basketball only) and the league', () => {
        const jobs = [
            { jobName: 'hoops-net', status: 'success', startedAt: daysAgo(0) },
            { jobName: 'daily-scores', status: 'error', startedAt: daysAgo(0) }
        ];
        const cb = build(Object.assign({}, base, { isAdmin: true, seasonStatus: 'in-season', jobs, draft: { status: 'complete', picks: [] } }));
        expect(cb.title).toBe('In season');
        // hoops-scores is quiet by design (no JobRun on idle nights), so never
        // having run is not a fault: only daily-scores carries a stale check.
        expect(group(cb, 'platform').items.map(r => r.key)).toEqual(['hoops-refresh', 'jobs']);
        expect(byKey(cb, 'jobs')).toMatchObject({ state: 'ok', detail: '1 of 10 have run · 9 no runs yet' });
        expect(byKey(cb, 'hoops-refresh')).toMatchObject({ label: '1,715 finals on file', detail: 'Latest 2026-10-06', auto: null });
    });

    test('in season, commissioner: results say automation scores them', () => {
        const cb = build(Object.assign({}, base, { isAdmin: false, seasonStatus: 'in-season' }));
        expect(byKey(cb, 'hoops-refresh')).toMatchObject({ auto: 'Auto · 23:30', fix: null });
        const none = build(Object.assign({}, base, { isAdmin: false, seasonStatus: 'in-season',
            hoops: { onFile: { games: { finals: 0 } } } }));
        expect(byKey(none, 'hoops-refresh')).toMatchObject({ label: '0 finals on file', detail: 'None yet' });
        expect(byKey(build(Object.assign({}, base, { seasonStatus: 'in-season', hoops: null })), 'hoops-refresh')).toBeUndefined();
    });
});

describe('basketball preseason ratings', () => {
    const base = { sport: 'basketball', isAdmin: true, seasonStatus: 'preseason', now: NOW, hoops: hoopsFull };
    const pre = c => ({ season: 2027, current: Object.assign({ teams: 365, ranked: 365, sources: 1, importedAt: daysAgo(6) }, c) });

    test('on file: a count and how old', () => {
        expect(byKey(build(Object.assign({ preseason: pre() }, base)), 'hoops-preseason'))
            .toMatchObject({ state: 'ok', label: '365 teams ranked', detail: 'Imported 6 days ago', fix: null });
        expect(byKey(build(Object.assign({ preseason: pre({ importedAt: NOW.toISOString() }) }, base)), 'hoops-preseason').detail).toBe('Imported today');
        expect(byKey(build(Object.assign({ preseason: pre({ importedAt: null }) }, base)), 'hoops-preseason').detail).toBe('Preseason ratings');
    });

    test('none, or two imports side by side, is a gap with the import tool', () => {
        expect(byKey(build(Object.assign({ preseason: pre({ ranked: 0 }) }, base)), 'hoops-preseason'))
            .toMatchObject({ state: 'warn', label: 'No preseason ratings', fix: 'hoops-preseason' });
        expect(byKey(build(Object.assign({ preseason: pre({ sources: 2 }) }, base)), 'hoops-preseason'))
            .toMatchObject({ state: 'warn', label: 'Two rating imports on file' });
    });

    test('a commissioner never gets it, even when handed the payload', () => {
        expect(byKey(build(Object.assign({}, base, { isAdmin: false, preseason: pre({ ranked: 0 }) })), 'hoops-preseason')).toBeUndefined();
    });

    test('no payload, no row', () => {
        expect(byKey(build(base), 'hoops-preseason')).toBeUndefined();
        expect(byKey(build(Object.assign({ preseason: { season: null } }, base)), 'hoops-preseason')).toBeUndefined();
    });
});

describe('jobList: the same job list for both sports', () => {
    const { jobList, JOBS } = require('../public/admin-clipboard');
    const run = (name, status, hoursAgo, extra) => Object.assign({ jobName: name, status, startedAt: new Date(NOW.getTime() - hoursAgo * 36e5).toISOString() }, extra);

    test('one entry per scheduled job, in schedule order, never-run included', () => {
        const fb = jobList('football', [], { now: NOW });
        expect(fb.map(j => j.name)).toEqual(JOBS.football.map(j => j.name));
        expect(fb.every(j => j.state === 'off' && j.status === null)).toBe(true);
        expect(jobList('basketball', null, { now: NOW })).toHaveLength(10);
    });

    test('states: failed warns, running is info, success and skipped are ok', () => {
        const list = jobList('football', [
            run('daily-scores', 'error', 2, { message: 'H12' }), run('saturday-scores', 'running', 0),
            run('sunday-scores', 'skipped', 30), run('enrichment', 'success', 100)
        ], { now: NOW });
        const by = n => list.find(j => j.name === n);
        expect(by('daily-scores')).toMatchObject({ state: 'warn', message: 'H12' });
        expect(by('saturday-scores').state).toBe('info');
        expect(by('sunday-scores').state).toBe('ok');
        expect(by('enrichment').state).toBe('ok');
    });

    test('a nightly scoring job is overdue past 36 hours, only in season', () => {
        const late = [run('daily-scores', 'success', 37)];
        expect(jobList('football', late, { now: NOW, inSeason: true })[0]).toMatchObject({ state: 'warn', overdue: true });
        expect(jobList('football', [run('daily-scores', 'success', 35)], { now: NOW, inSeason: true })[0].state).toBe('ok');
        expect(jobList('football', late, { now: NOW, inSeason: false })[0].state).toBe('ok');
        // Weekly / event-driven jobs never go overdue.
        expect(jobList('football', [run('enrichment', 'success', 24 * 20)], { now: NOW, inSeason: true })
            .find(j => j.name === 'enrichment').state).toBe('ok');
    });

    test('only daily-scores goes overdue; hoops-scores is quiet by design and never does', () => {
        expect(JOBS.football.filter(j => j.stale).map(j => j.name)).toEqual(['daily-scores']);
        expect(JOBS.basketball.filter(j => j.stale)).toEqual([]);
        expect(jobList('basketball', [], { now: NOW, inSeason: true }).find(j => j.name === 'hoops-scores').state).toBe('off');
    });

    test('each sport lists only its own jobs', () => {
        const runs = [run('hoops-scores', 'error', 1), run('daily-scores', 'error', 1)];
        expect(jobList('football', runs, { now: NOW }).some(j => /^hoops-/.test(j.name))).toBe(false);
        expect(jobList('basketball', runs, { now: NOW }).find(j => j.name === 'hoops-scores').state).toBe('warn');
        expect(jobList('basketball', runs, { now: NOW }).some(j => j.name === 'daily-scores')).toBe(false);
    });

    test('defaults: no options means now and not in season', () => {
        const list = jobList('football', [run('daily-scores', 'success', 100)]);
        expect(list[0]).toMatchObject({ state: 'ok', overdue: false });
    });

    test('every job has run: no "no runs yet" tail', () => {
        const all = JOBS.basketball.map(j => run(j.name, 'success', 1));
        const cb = build({ sport: 'basketball', isAdmin: true, seasonStatus: 'in-season', now: NOW, jobs: all });
        expect(byKey(cb, 'jobs').detail).toBe('10 of 10 have run');
    });

    test('a nightly job never run in season: "has not run", with its schedule', () => {
        const cb = build({ sport: 'football', isAdmin: true, seasonStatus: 'in-season', now: NOW, jobs: [] });
        expect(byKey(cb, 'job:daily-scores')).toMatchObject({ state: 'warn', label: 'Daily scores has not run', detail: 'Nightly 23:00' });
    });

    test('the Clipboard row for an overdue job says when it last ran', () => {
        const cb = build({ sport: 'football', isAdmin: true, seasonStatus: 'in-season', now: NOW,
            jobs: [run('daily-scores', 'success', 50)] });
        expect(byKey(cb, 'job:daily-scores')).toMatchObject({ state: 'warn', label: 'Daily scores is overdue',
            detail: 'Last ran 50 hours ago · Nightly 23:00', fix: 'jobs' });
    });
});

describe('the draft row', () => {
    const draftOf = (d, extra) => build(Object.assign({ sport: 'basketball', seasonStatus: 'preseason', now: NOW, draft: d }, extra));

    test.each([
        [null, 'warn', 'No draft configured'],
        [{ draftOrder: ['a'], totalRounds: 8 }, 'warn', 'Pick order not set'],
        [{ draftOrder: ['a', 'b'] }, 'warn', 'Draft date not set'],
        [{ draftOrder: ['a', 'b'], scheduledAt: daysAhead(1) }, 'ok', 'Draft scheduled tomorrow'],
        [{ draftOrder: ['a', 'b'], scheduledAt: NOW.toISOString() }, 'ok', 'Draft scheduled today'],
        [{ draftOrder: ['a', 'b'], scheduledAt: daysAgo(2) }, 'info', 'Draft date has passed'],
        [{ status: 'active', draftOrder: ['a', 'b'], picks: [{}], totalRounds: 5 }, 'info', 'Draft in progress'],
        [{ status: 'complete', picks: [{}] }, 'ok', 'Draft complete']
    ])('%j -> %s %s', (d, state, label) => {
        expect(byKey(draftOf(d), 'draft')).toMatchObject({ state, label });
    });

    test('an in-progress draft reports its pick count', () => {
        const r = byKey(draftOf({ status: 'active', draftOrder: ['a', 'b'], picks: [{}], totalRounds: 5 }), 'draft');
        expect(r.detail).toBe('1 of 10 picks made');
    });

    test('a draft with no rounds set assumes 10, and leaves out an unset pool', () => {
        expect(byKey(draftOf({ draftOrder: ['a'] }), 'draft').detail).toBe('1 manager · 10 rounds');
    });
});

describe('review fixes', () => {
    test('a football draft in progress is reported, not a gap, and offers no Fix (Configure Draft 409s)', () => {
        const active = check('draft', 'partial', { required: false, actionLabel: 'Open', detail: 'In progress — 3 of 60 picks made' });
        const cb = build({ sport: 'football', seasonStatus: 'preseason', league: 'graham-league', now: NOW,
            readiness: readiness(readyPlatform, [active]) });
        expect(byKey(cb, 'draft')).toMatchObject({ state: 'info', fix: null });
        expect(cb.open).toBe(0);
        expect(cb.summary).toBe('Nothing needs you');
    });

    test('draft days are calendar days, not elapsed hours', () => {
        // 15:00 now, draft 10:00 tomorrow: 19 hours away, but tomorrow.
        const now = new Date(2026, 9, 19, 15, 0);
        const tomorrow = new Date(2026, 9, 20, 10, 0);
        const earlierToday = new Date(2026, 9, 19, 14, 0);
        const d = at => byKey(build({ sport: 'basketball', seasonStatus: 'preseason', now,
            draft: { draftOrder: ['a', 'b'], scheduledAt: at } }), 'draft').label;
        expect(d(tomorrow)).toBe('Draft scheduled tomorrow');
        // An hour ago, still not started: today, not "date passed".
        expect(d(earlierToday)).toBe('Draft scheduled today');
    });

    test('a commissioner given the real basketball payload still gets no platform rows', () => {
        const cb = build({ sport: 'basketball', isAdmin: false, seasonStatus: 'preseason', now: NOW, hoops: hoopsFull,
            jobs: [{ jobName: 'hoops-net', status: 'error', startedAt: daysAgo(0) }] });
        expect(cb.groups.map(g => g.key)).not.toContain('platform');
        const season = build({ sport: 'basketball', isAdmin: false, seasonStatus: 'in-season', now: NOW, hoops: hoopsFull,
            jobs: [{ jobName: 'hoops-net', status: 'error', startedAt: daysAgo(0) }] });
        expect(rows(season).some(r => /job/.test(r.key))).toBe(false);
    });

    test('a football commissioner never gets job or CFP rows, even when handed them', () => {
        const cb = build({ sport: 'football', isAdmin: false, seasonStatus: 'in-season', now: NOW,
            jobs: [{ jobName: 'daily-scores', status: 'error', startedAt: daysAgo(0) }],
            cfpOdds: { makeCount: 0, champCount: 0 } });
        expect(rows(cb).map(r => r.key)).toEqual([]);
    });

    test('never-run jobs are counted as such, not as healthy runs', () => {
        const cb = build({ sport: 'basketball', isAdmin: true, seasonStatus: 'in-season', now: NOW,
            jobs: [{ jobName: 'hoops-scores', status: 'success', startedAt: daysAgo(0.5) },
                { jobName: 'hoops-net', status: null }] });
        expect(byKey(cb, 'jobs')).toMatchObject({ label: 'Jobs running fine', detail: '1 of 10 have run · 9 no runs yet' });
    });

    test('the H2H tie bonus is shown when set, as readiness shows it', () => {
        const cb = build({ sport: 'basketball', seasonStatus: 'preseason', now: NOW, engagement: { h2hEnabled: true, h2hWinBonus: 3, h2hTieBonus: 1 } });
        expect(byKey(cb, 'gameModes').label).toBe('H2H +3/+1 tie');
    });
});

describe('edges', () => {
    test('the offseason has no list', () => {
        const cb = build({ sport: 'football', isAdmin: true, seasonStatus: 'complete', now: NOW, status: { unscoredResults: 2 } });
        expect(cb.groups).toEqual([]);
        expect(cb.title).toBe('Offseason');
        expect(cb.next.text).toMatch(/new season/);
    });

    test('nothing says where the season is: no phase, no list — never a guessed "draft"', () => {
        const cb = build();
        expect(cb.sport).toBe('football');
        expect(cb.phase).toBeNull();
        expect(cb.groups).toEqual([]);
        expect(cb.phases.every(p => p.state === 'next')).toBe(true);
        expect(phaseOf({ sport: 'football', status: { unscoredResults: 3 } })).toBeNull();
    });

    test('the clock defaults to now', () => {
        const cb = build({ sport: 'basketball', seasonStatus: 'preseason', draft: { draftOrder: ['a', 'b'], scheduledAt: new Date(Date.now() + 3 * 864e5 + 6e4) } });
        expect(byKey(cb, 'draft').label).toBe('Draft scheduled in 3 days');
    });

    test('a league with no name or code is labelled generically', () => {
        const cb = build({ sport: 'basketball', seasonStatus: 'preseason', now: NOW, engagement: null });
        expect(cb.groups[0].label).toBe('This league');
    });
});
