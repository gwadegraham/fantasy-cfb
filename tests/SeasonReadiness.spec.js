const { computeSeasonReadiness, platformChecks, leagueChecks } = require('../modules/season-readiness');

const TEAMS = 134;
const byKey = (checks) => checks.reduce((m, c) => (m[c.key] = c, m), {});

// A fully-loaded season: every platform check satisfied.
function loaded(over) {
    return Object.assign({
        season: 2026,
        teamTotal: TEAMS,
        teamsWith: { talent: TEAMS, spRating: TEAMS, expectedWins: TEAMS, cfpOdds: 30 },
        scheduledTeams: TEAMS,
        gameCount: 870
    }, over || {});
}
function leagueReady(over) {
    return Object.assign({
        code: 'graham-league', name: 'Graham',
        members: 10,
        draft: { draftOrder: ['a', 'b', 'c'], scheduledAt: new Date('2026-08-15'), snake: true, totalRounds: 10 },
        engagement: { h2hEnabled: true, h2hWinBonus: 3, h2hTieBonus: 1, captainEnabled: true, captainMultiplier: 2 }
    }, over || {});
}

describe('platformChecks', () => {
    test('a fully loaded season is all-ready', () => {
        const c = byKey(platformChecks(loaded()));
        ['schedule', 'enrichment', 'expectedWins', 'cfpOdds', 'spPlus'].forEach(k => {
            expect(c[k].status).toBe('ready');
        });
    });

    // The runbook's headline failure: no schedule means grades compute from
    // postseason points only, with no error and no empty state.
    test('a missing schedule is flagged as a required miss, with the game count', () => {
        const c = byKey(platformChecks(loaded({ scheduledTeams: 0, gameCount: 0 })));
        expect(c.schedule).toMatchObject({ status: 'missing', required: true });
        expect(c.schedule.detail).toBe('No games loaded');
        expect(c.schedule.whyItMatters).toMatch(/no error shown/);
    });

    test('a partially ingested schedule is partial, not ready', () => {
        const c = byKey(platformChecks(loaded({ scheduledTeams: 40, gameCount: 120 })));
        expect(c.schedule.status).toBe('partial');
        expect(c.schedule.detail).toBe('120 games · 40 of 134 teams');
    });

    test('coverage just under the bar is partial; at the bar is ready', () => {
        expect(byKey(platformChecks(loaded({ teamsWith: { talent: 120 } }))).enrichment.status).toBe('partial');
        expect(byKey(platformChecks(loaded({ teamsWith: { talent: 121 } }))).enrichment.status).toBe('ready');
    });

    // Odds boards only price contenders, so coverage would be the wrong lens.
    test('CFP odds are judged on absolute count, not team coverage', () => {
        expect(byKey(platformChecks(loaded({ teamsWith: { cfpOdds: 30 } }))).cfpOdds.status).toBe('ready');
        expect(byKey(platformChecks(loaded({ teamsWith: { cfpOdds: 4 } }))).cfpOdds.status).toBe('partial');
        expect(byKey(platformChecks(loaded({ teamsWith: { cfpOdds: 0 } }))).cfpOdds.status).toBe('missing');
    });

    // CFBD publishes SP+ close to kickoff and the engine falls back to the prior
    // year, so an empty SP+ in early August is expected — never a blocker.
    test('missing SP+ is reported but never required', () => {
        const c = byKey(platformChecks(loaded({ teamsWith: { spRating: 0 } })));
        expect(c.spPlus).toMatchObject({ status: 'missing', required: false });
        expect(c.spPlus.note).toMatch(/Not published yet/);
    });

    test('SP+ carries the season in its label, so a stale year is obvious', () => {
        expect(byKey(platformChecks(loaded())).spPlus.label).toBe('SP+ ratings (2026)');
    });

    test('no teams on file at all degrades to missing rather than dividing by zero', () => {
        const c = byKey(platformChecks(loaded({ teamTotal: 0, teamsWith: {}, scheduledTeams: 0, gameCount: 0 })));
        expect(c.enrichment.status).toBe('missing');
        expect(c.enrichment.detail).toBe('No teams loaded');
    });
});

describe('leagueChecks', () => {
    test('a configured league is all-ready', () => {
        const c = byKey(leagueChecks(leagueReady()));
        expect(c.roster.status).toBe('ready');
        expect(c.draft.status).toBe('ready');
        expect(c.draft.detail).toBe('3 managers · snake · 10 rounds');
        expect(c.gameModes.detail).toBe('H2H +3/+1 tie · Captain ×2');
    });

    test('an empty season roster is a required miss', () => {
        const c = byKey(leagueChecks(leagueReady({ members: 0 })));
        expect(c.roster).toMatchObject({ status: 'missing', required: true });
        expect(c.roster.whyItMatters).toMatch(/after YEAR is flipped/);
    });

    // Found on live 2026 data: a draft left ACTIVE mid-run (a test run nobody
    // reset) read as "ready". It is the opposite — settings are locked while
    // active, the room resumes at the next pick with those teams gone, and
    // rosters stay empty because teams only persist on completion.
    test('a draft abandoned mid-run is flagged, not called ready', () => {
        const c = byKey(leagueChecks(leagueReady({
            draft: { draftOrder: ['a','b','c','d','e','f'], scheduledAt: new Date('2026-08-18'),
                     snake: true, totalRounds: 10, status: 'active',
                     picks: Array.from({ length: 36 }, (_, i) => ({ overall: i + 1 })) }
        })));
        expect(c.draft.status).toBe('partial');
        expect(c.draft.detail).toBe('In progress — 36 of 60 picks made');
        expect(c.draft.note).toMatch(/Reset it before draft night/);
    });

    test('a completed draft is ready and says so', () => {
        const c = byKey(leagueChecks(leagueReady({
            draft: { draftOrder: ['a','b'], scheduledAt: new Date('2026-08-18'), status: 'complete',
                     totalRounds: 10, picks: Array.from({ length: 20 }, () => ({})) }
        })));
        expect(c.draft).toMatchObject({ status: 'ready', detail: 'Drafted — 20 picks' });
    });

    // An active draft with nothing picked yet is just a started room, not a mess.
    test('an active draft with no picks is not flagged as abandoned', () => {
        const c = byKey(leagueChecks(leagueReady({
            draft: { draftOrder: ['a','b'], scheduledAt: new Date('2026-08-18'), status: 'active',
                     snake: true, totalRounds: 10, picks: [] }
        })));
        expect(c.draft.status).toBe('ready');
    });

    test('a draft with no doc, no order, or no date is distinguished', () => {
        expect(byKey(leagueChecks(leagueReady({ draft: null }))).draft)
            .toMatchObject({ status: 'missing', detail: 'No draft configured' });
        expect(byKey(leagueChecks(leagueReady({ draft: { draftOrder: [] } }))).draft)
            .toMatchObject({ status: 'partial', detail: 'Configured, but no pick order set' });
        expect(byKey(leagueChecks(leagueReady({ draft: { draftOrder: ['a', 'b'] } }))).draft)
            .toMatchObject({ status: 'partial', detail: '2 managers in order · no date set' });
    });

    // Claunts stays classic — no game modes is a valid resting state, not a gap.
    test('a classic league reads as off, never as a failure', () => {
        const c = byKey(leagueChecks(leagueReady({ engagement: { h2hEnabled: false, captainEnabled: false } })));
        expect(c.gameModes).toMatchObject({ status: 'off', required: false });
        expect(c.gameModes.detail).toBe('Classic scoring (no game modes)');
    });

    test('one mode on is described on its own', () => {
        const c = byKey(leagueChecks(leagueReady({ engagement: { h2hEnabled: true, h2hWinBonus: 3, h2hTieBonus: 0, captainEnabled: false } })));
        expect(c.gameModes.detail).toBe('H2H +3');
    });
});

describe('computeSeasonReadiness', () => {
    test('everything loaded and configured → ready, nothing blocking', () => {
        const r = computeSeasonReadiness(Object.assign(loaded(), { leagues: [leagueReady()] }));
        expect(r.ready).toBe(true);
        expect(r.blocking).toEqual([]);
        expect(r.season).toBe('2026');
    });

    test('blocking lists every required miss across platform and leagues', () => {
        const r = computeSeasonReadiness(Object.assign(
            loaded({ scheduledTeams: 0, gameCount: 0, teamsWith: { talent: TEAMS, expectedWins: TEAMS, cfpOdds: 0 } }),
            { leagues: [leagueReady({ draft: null })] }
        ));
        expect(r.ready).toBe(false);
        expect(r.blocking).toEqual(['schedule', 'cfpOdds', 'draft']);
    });

    // The two never-required checks must not be able to hold a season back.
    test('missing SP+ and a classic league alone still read as ready', () => {
        const r = computeSeasonReadiness(Object.assign(
            loaded({ teamsWith: { talent: TEAMS, spRating: 0, expectedWins: TEAMS, cfpOdds: 30 } }),
            { leagues: [leagueReady({ engagement: { h2hEnabled: false, captainEnabled: false } })] }
        ));
        expect(r.ready).toBe(true);
    });

    test('each league gets its own row, keyed and named', () => {
        const r = computeSeasonReadiness(Object.assign(loaded(), {
            leagues: [leagueReady(), leagueReady({ code: 'claunts-league', name: 'Claunts', members: 0 })]
        }));
        expect(r.leagues.map(l => l.league)).toEqual(['graham-league', 'claunts-league']);
        expect(r.leagues[1].name).toBe('Claunts');
        expect(r.blocking).toContain('roster');
    });

    // The client retires the panel on this, so it must reflect real results
    // rather than the mere existence of a weeklyScore row.
    test('seasonUnderway is echoed back, defaulting to false', () => {
        expect(computeSeasonReadiness(Object.assign(loaded(), { leagues: [] })).seasonUnderway).toBe(false);
        expect(computeSeasonReadiness(Object.assign(loaded(), { leagues: [], seasonUnderway: true })).seasonUnderway).toBe(true);
    });

    test('blocking repeats a key when several leagues miss the same step', () => {
        const r = computeSeasonReadiness(Object.assign(loaded(), {
            leagues: [leagueReady({ members: 0 }), leagueReady({ code: 'claunts-league', members: 0 })]
        }));
        expect(r.blocking).toEqual(['roster', 'roster']);   // two leagues, two steps
    });

    test('no visible leagues still reports the platform data', () => {
        const r = computeSeasonReadiness(Object.assign(loaded(), { leagues: [] }));
        expect(r.leagues).toEqual([]);
        expect(r.platform).toHaveLength(5);
        expect(r.ready).toBe(true);
    });
});

// --- route wiring ------------------------------------------------------------
// The pure module is only as good as the fields the route reads. A renamed or
// mistyped field would report "missing" forever — a silent failure inside the
// panel built to catch silent failures. So this exercises GET
// /scores/readiness/:season against real documents.

process.env.INTERNAL_API_TOKEN = 'test-internal-token';

const express = require('express');
const request = require('supertest');
const { useMongo } = require('./helpers/mongo');
const Team = require('../models/team');
const Game = require('../models/game');
const User = require('../models/user');
const Draft = require('../models/draft');
const ScoringConfig = require('../models/scoringConfig');
const League = require('../models/league');
const scoresRouter = require('../routes/scores');

const app = express();
app.use(express.json());
app.use('/scores', scoresRouter);

useMongo();

// The internal token is what makes every league visible (canManageLeague),
// matching how a server-to-server caller sees the whole picture.
const get = (season) => request(app)
    .get(`/scores/readiness/${season}`)
    .set('X-Internal-Token', 'test-internal-token');

function teamDoc(id, seasonFields) {
    return {
        id, school: 'School' + id, mascot: 'M', abbreviation: 'S' + id,
        conference: 'SEC', color: '#000', logos: ['l.png'],
        location: { venue_id: id, name: 'V', city: 'C', state: 'ST', zip: '1', latitude: 1, longitude: 1, capacity: 1, grass: true, dome: false },
        seasons: seasonFields ? [Object.assign({ season: 2026 }, seasonFields)] : []
    };
}

describe('GET /scores/readiness/:season', () => {
    test('reads enrichment, expected wins and CFP odds off the season subdoc', async () => {
        await Team.create([
            teamDoc(1, { talent: 900, spRating: 18.4, expectedWins: 9.1, cfpMakeOdds: -200 }),
            teamDoc(2, { talent: 800, spRating: 12.0, expectedWins: 7.5 })
        ]);
        const body = (await get(2026)).body;
        const c = byKey(body.platform);
        expect(c.enrichment.detail).toBe('2 of 2 teams');
        expect(c.expectedWins.detail).toBe('2 of 2 teams');
        expect(c.spPlus.detail).toBe('2 of 2 teams');
        expect(c.cfpOdds.detail).toBe('1 teams priced');
    });

    test('a season subdoc for another year does not count', async () => {
        await Team.create([{ ...teamDoc(1), seasons: [{ season: 2025, talent: 900, expectedWins: 9 }] }]);
        const c = byKey((await get(2026)).body.platform);
        expect(c.enrichment.status).toBe('missing');
        expect(c.enrichment.detail).toBe('0 of 1 teams');
    });

    test('schedule coverage counts distinct teams across home and away', async () => {
        await Team.create([teamDoc(1), teamDoc(2), teamDoc(3)]);
        await Game.create([{
            id: 1, season: 2026, week: 1, seasonType: 'regular',
            startDate: '2026-09-05T00:00:00.000Z', startTimeTbd: false,
            neutralSite: false, conferenceGame: false,
            homeId: 1, homeTeam: 'A', awayId: 2, awayTeam: 'B'
        }]);
        const c = byKey((await get(2026)).body.platform);
        expect(c.schedule.detail).toBe('1 games · 2 of 3 teams');
        expect(c.schedule.status).toBe('partial');
    });

    // Real 2026 data reported "350 of 138 teams" before this: the schedule is
    // full of FCS opponents whose ids aren't in the Team collection, so counting
    // them raw broke the ratio and would have hidden a partial ingest.
    test('non-FBS opponents do not inflate schedule coverage', async () => {
        await Team.create([teamDoc(1), teamDoc(2)]);
        await Game.create([{
            id: 1, season: 2026, week: 1, seasonType: 'regular',
            startDate: '2026-09-05T00:00:00.000Z', startTimeTbd: false,
            neutralSite: false, conferenceGame: false,
            homeId: 1, homeTeam: 'FBS', awayId: 99999, awayTeam: 'Some FCS School'
        }]);
        const c = byKey((await get(2026)).body.platform);
        expect(c.schedule.detail).toBe('1 games · 1 of 2 teams');
        expect(c.schedule.status).toBe('partial');
    });

    // Drives whether the panel shows at all, so it has to key off a real result.
    describe('seasonUnderway', () => {
        const g = (o) => Object.assign({
            id: 1, season: 2026, week: 1, seasonType: 'regular',
            startDate: '2026-09-05T00:00:00.000Z', startTimeTbd: false,
            neutralSite: false, conferenceGame: false,
            homeId: 1, homeTeam: 'A', awayId: 2, awayTeam: 'B'
        }, o);

        test('false when the schedule is loaded but nothing has been played', async () => {
            await Team.create([teamDoc(1), teamDoc(2)]);
            await Game.create([g({ completed: false })]);
            expect((await get(2026)).body.seasonUnderway).toBe(false);
        });

        test('true once a completed game has points on it', async () => {
            await Team.create([teamDoc(1), teamDoc(2)]);
            await Game.create([g({ completed: true, homePoints: 31, awayPoints: 20 })]);
            expect((await get(2026)).body.seasonUnderway).toBe(true);
        });

        test('a completed game with no points recorded does not count', async () => {
            await Team.create([teamDoc(1), teamDoc(2)]);
            await Game.create([g({ completed: true })]);
            expect((await get(2026)).body.seasonUnderway).toBe(false);
        });
    });

    test('postseason games do not count toward the regular-season schedule', async () => {
        await Team.create([teamDoc(1), teamDoc(2)]);
        await Game.create([{
            id: 1, season: 2026, week: 1, seasonType: 'postseason',
            startDate: '2026-12-20T00:00:00.000Z', startTimeTbd: false,
            neutralSite: true, conferenceGame: false,
            homeId: 1, homeTeam: 'A', awayId: 2, awayTeam: 'B'
        }]);
        expect(byKey((await get(2026)).body.platform).schedule.status).toBe('missing');
    });

    test('counts season members per league and picks up the draft + game modes', async () => {
        await Team.create([teamDoc(1)]);
        await User.create([
            { firstName: 'A', lastName: 'A', league: 'graham-league', seasons: [{ season: 2026 }] },
            { firstName: 'B', lastName: 'B', league: 'graham-league', seasons: [{ season: 2026 }] },
            { firstName: 'C', lastName: 'C', league: 'claunts-league', seasons: [{ season: 2025 }] }
        ]);
        await Draft.create({
            league: 'graham-league', season: 2026,
            draftOrder: [], scheduledAt: new Date('2026-08-15'), totalRounds: 10
        });
        await ScoringConfig.create({
            league: 'graham-league', model: 'graham',
            engagementBySeason: { '2026': { h2hEnabled: true, h2hWinBonus: 3, captainEnabled: true, captainMultiplier: 2 } }
        });

        const body = (await get(2026)).body;
        const graham = body.leagues.find(l => l.league === 'graham-league');
        const claunts = body.leagues.find(l => l.league === 'claunts-league');
        const g = byKey(graham.checks), cl = byKey(claunts.checks);

        expect(g.roster.detail).toBe('2 managers');
        expect(g.draft.status).toBe('partial');          // no pick order yet
        expect(g.gameModes.detail).toBe('H2H +3 · Captain ×2');
        expect(cl.roster.status).toBe('missing');        // C is on 2025, not 2026
        expect(cl.gameModes.status).toBe('off');
    });

    test('uses the commissioner-set league display name when present', async () => {
        await League.create({ code: 'graham-league', name: 'The Gauntlet' });
        const body = (await get(2026)).body;
        expect(body.leagues.find(l => l.league === 'graham-league').name).toBe('The Gauntlet');
    });

    test('an empty database reports every required step as outstanding', async () => {
        const body = (await get(2026)).body;
        expect(body.ready).toBe(false);
        expect(body.blocking).toEqual(
            expect.arrayContaining(['schedule', 'enrichment', 'expectedWins', 'cfpOdds', 'roster', 'draft'])
        );
        expect(body.blocking).not.toContain('spPlus');
        expect(body.blocking).not.toContain('gameModes');
    });

    // Without the token and without an Admin session, canManageLeague denies
    // every league — the platform rows still render, the league rows don't.
    test('league rows are scoped to what the caller may manage', async () => {
        await Team.create([teamDoc(1)]);
        const body = (await request(app).get('/scores/readiness/2026')).body;
        expect(body.leagues).toEqual([]);
        expect(body.platform).toHaveLength(5);
    });
});
