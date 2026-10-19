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
        expect(byKey(cb, 'scores')).toMatchObject({ state: 'warn', fix: 'scores', label: 'Week 8: 3 finals not scored yet' });
        expect(group(cb, 'platform').items.map(r => r.key)).toContain('scores');
    });

    test('commissioner: the same finals are information, with when automation scores them', () => {
        const cb = build(Object.assign({ isAdmin: false }, base));
        expect(byKey(cb, 'scores')).toMatchObject({ state: 'info', fix: null, auto: 'Auto · 23:00' });
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
        expect(byKey(cb, 'scores').label).toBe('1 final not scored yet');
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
        expect(byKey(cb, 'jobs')).toMatchObject({ state: 'ok', detail: '2 jobs, last runs all fine' });
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
        expect(byKey(cb, 'job:mystery-job')).toMatchObject({ label: 'mystery-job failed', detail: 'Last run errored', fix: null });
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
        expect(group(cb, 'platform').items.map(r => r.key)).toEqual(['hoops-refresh', 'jobs']);
        expect(byKey(cb, 'hoops-refresh')).toMatchObject({ label: '1715 finals on file', detail: 'Latest 2026-10-06', auto: null });
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

describe('the draft row', () => {
    const draftOf = (d, extra) => build(Object.assign({ sport: 'basketball', seasonStatus: 'preseason', now: NOW, draft: d }, extra));

    test.each([
        [null, 'warn', 'No draft configured'],
        [{ draftOrder: ['a'], totalRounds: 8 }, 'warn', 'Pick order not set'],
        [{ draftOrder: ['a', 'b'] }, 'warn', 'Draft date not set'],
        [{ draftOrder: ['a', 'b'], scheduledAt: daysAhead(1) }, 'ok', 'Draft scheduled tomorrow'],
        [{ draftOrder: ['a', 'b'], scheduledAt: NOW.toISOString() }, 'ok', 'Draft scheduled today'],
        [{ draftOrder: ['a', 'b'], scheduledAt: daysAgo(2) }, 'warn', 'Draft scheduled date passed'],
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

describe('edges', () => {
    test('the offseason has no list', () => {
        const cb = build({ sport: 'football', isAdmin: true, seasonStatus: 'complete', now: NOW, status: { unscoredResults: 2 } });
        expect(cb.groups).toEqual([]);
        expect(cb.title).toBe('Offseason');
        expect(cb.next.text).toMatch(/new season/);
    });

    test('no input at all still builds', () => {
        const cb = build();
        expect(cb.sport).toBe('football');
        expect(cb.phase).toBe('draft');
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
