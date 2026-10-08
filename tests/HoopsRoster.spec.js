// Basketball jersey numbers: the once-a-season roster import
// (modules/hoops-roster.js), its two doors — riding along with the schedule
// ingest, and the admin's re-run — and the join onto the game and team pages.
//
// /teams/roster is BILLABLE and numbers do not change once the season
// starts, so what matters most is that the schedule ingest spends the call
// once per season and never again on its own.
//
// The CBBD shape is the live /teams/roster?season=2026 payload, cut down:
// one row per team with its players nested, `jersey` a nullable STRING.

const express = require('express');
const request = require('supertest');
const { useMongo } = require('./helpers/mongo');
const cbbd = require('../modules/cbbd-client');
const roster = require('../modules/hoops-roster');
const gamePage = require('../modules/hoops-game-page');
const teamPage = require('../modules/hoops-team-page');
const gamesRouter = require('../routes/hoopsGames');
const teamsRouter = require('../routes/hoopsTeams');
const HoopsRoster = require('../models/hoopsRoster');
const HoopsGame = require('../models/hoopsGame');
const HoopsTeam = require('../models/hoopsTeam');
const HoopsBoxScore = require('../models/hoopsBoxScore');
const HoopsTeamStats = require('../models/hoopsTeamStats');
const SportSeason = require('../models/sportSeason');
const seasons = require('../modules/active-season');

const app = express();
app.use(express.json());
app.use('/hoops/games', gamesRouter);
app.use('/hoops/teams', teamsRouter);

useMongo();
const SEASON = 2027;

const rosterPlayer = (id, name, jersey) => ({ id, sourceId: String(5000000 + id), name, jersey, position: 'Forward' });
const DUKE = { teamId: 1, teamSourceId: '150', team: 'Duke', conference: 'ACC', season: SEASON,
    players: [rosterPlayer(198977, 'Cameron Boozer', '12'), rosterPlayer(208, 'Caleb Foster', '1'), rosterPlayer(77, 'Walk On', null)] };
const TEXAS = { teamId: 2, teamSourceId: '251', team: 'Texas', conference: 'SEC', season: SEASON,
    players: [rosterPlayer(301, 'Dailyn Swain', '00'), rosterPlayer(302, 'Zero Guy', '0')] };

// A roster as CBBD publishes it once complete: every D-I team numbered.
// Duke and Texas plus enough filler teams to reach the gate's threshold.
const fullRoster = () => [DUKE, TEXAS].concat(Array.from({ length: roster.FULL_ROSTER_TEAMS }, (_, i) => (
    { teamId: 1000 + i, team: `Team ${i}`, players: [rosterPlayer(100000 + i, `Player ${i}`, String(i % 50))] })));

// Stubs the client, not the network. Anything other than /teams/roster is a
// call this feature must not make.
function stubRoster(data = [DUKE, TEXAS]) {
    return jest.spyOn(cbbd, 'cbbdGet').mockImplementation(async (path) => {
        if (path !== '/teams/roster') throw new Error(`unexpected CBBD call ${path}`);
        return { data, remainingCalls: 29700 };
    });
}
const rosterCalls = (spy) => spy.mock.calls.filter(c => c[0] === '/teams/roster');

beforeEach(async () => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    seasons._reset();
    await SportSeason.create([{ sport: 'football', season: 2026, status: 'in-season' },
                              { sport: 'basketball', season: SEASON, status: 'in-season' }]);
    await seasons.prime();
});
afterEach(() => { seasons._reset(); jest.restoreAllMocks(); });

describe('buildOps', () => {
    test('one upsert per numbered player, keyed by season and athlete id', () => {
        const ops = roster.buildOps(SEASON, [DUKE, TEXAS]);
        expect(ops).toHaveLength(4);                                  // the walk-on has no number
        expect(ops[0].updateOne.filter).toEqual({ season: SEASON, athleteId: 198977 });
        expect(ops[0].updateOne.update.$set).toMatchObject({ season: SEASON, athleteId: 198977, teamId: 1, name: 'Cameron Boozer', jersey: '12' });
        expect(ops[0].updateOne.upsert).toBe(true);
    });

    test('"00" and "0" stay different jerseys — never coerced to a number', () => {
        const byId = new Map(roster.buildOps(SEASON, [TEXAS]).map(o => [o.updateOne.filter.athleteId, o.updateOne.update.$set.jersey]));
        expect(byId.get(301)).toBe('00');
        expect(byId.get(302)).toBe('0');
    });

    test('blank numbers, missing ids and missing players are skipped; a repeat keeps the last row', () => {
        const ops = roster.buildOps(SEASON, [
            { teamId: 9, players: [rosterPlayer(1, 'Blank', '  '), { name: 'No id', jersey: '3' }, rosterPlayer(2, 'Padded', ' 4 ')] },
            { teamId: 10 },
            null,
            { teamId: 11, players: [rosterPlayer(2, 'Padded', '5'), null, rosterPlayer('abc', 'Bad id', '6')] },
            { players: [rosterPlayer(3, 'No team id', '7')] },
            { teamId: null, players: [rosterPlayer(4, 'Null team id', '8')] }
        ]);
        expect(ops.map(o => o.updateOne.update.$set)).toEqual([
            expect.objectContaining({ athleteId: 2, jersey: '5', teamId: 11 }),
            expect.objectContaining({ athleteId: 3, jersey: '7', teamId: undefined }),
            expect.objectContaining({ athleteId: 4, jersey: '8', teamId: undefined })     // not team 0
        ]);
        expect(roster.buildOps(SEASON, null)).toEqual([]);
    });
});

describe('importSeason', () => {
    test('ONE call for every team, by season — and stores each numbered player', async () => {
        const get = stubRoster();
        const out = await roster.importSeason(SEASON);
        expect(get).toHaveBeenCalledTimes(1);
        expect(get).toHaveBeenCalledWith('/teams/roster', { season: SEASON });
        expect(out).toEqual({ season: SEASON, teams: 2, players: 4, remainingCalls: 29700 });
        expect(await HoopsRoster.countDocuments({ season: SEASON })).toBe(4);
    });

    test('the season counts as imported only once the roster is COMPLETE, not on the first rows', async () => {
        // CBBD caught half-published: two teams numbered. Closing the gate
        // here would leave every other team without numbers for the season.
        stubRoster();
        await roster.importSeason(SEASON);
        expect(await roster.hasSeason(SEASON)).toBe(false);
        stubRoster(fullRoster());
        await roster.importSeason(SEASON);
        expect(await roster.hasSeason(SEASON)).toBe(true);
        expect(await roster.hasSeason(SEASON + 1)).toBe(false);
    });

    test('a re-run updates numbers in place rather than duplicating', async () => {
        stubRoster();
        await roster.importSeason(SEASON);
        stubRoster([Object.assign({}, DUKE, { players: [rosterPlayer(198977, 'Cameron Boozer', '2')] })]);
        await roster.importSeason(SEASON);
        expect(await HoopsRoster.countDocuments({ season: SEASON, athleteId: 198977 })).toBe(1);
        expect((await HoopsRoster.findOne({ season: SEASON, athleteId: 198977 }).lean()).jersey).toBe('2');
    });

    test('nothing numbered yet writes nothing, so the season is NOT marked imported', async () => {
        stubRoster([Object.assign({}, DUKE, { players: [] })]);
        const out = await roster.importSeason(SEASON);
        expect(out).toMatchObject({ players: 0, skippedReason: expect.any(String) });
        expect(await roster.hasSeason(SEASON)).toBe(false);
    });

    test('a bad season is refused before any call; a CBBD failure throws', async () => {
        const get = stubRoster();
        await expect(roster.importSeason('next')).rejects.toThrow(/season must be a year/);
        expect(get).not.toHaveBeenCalled();
        get.mockRejectedValue(Object.assign(new Error('CBBD /teams/roster 503'), { status: 503 }));
        await expect(roster.importSeason(SEASON)).rejects.toThrow(/503/);
    });
});

describe('withJerseys', () => {
    beforeEach(async () => {
        await HoopsRoster.create([
            { season: SEASON, athleteId: 198977, jersey: '12' },
            // A transfer: the same athlete id, a different number LAST season.
            { season: SEASON - 1, athleteId: 301, jersey: '3' },
            // Number(null) is 0: a player with no id must not pick this up.
            { season: SEASON, athleteId: 0, jersey: '99' }
        ]);
    });

    test('attaches the season\'s number; a player with none on file is untouched', async () => {
        const out = await roster.withJerseys(SEASON, [{ athleteId: 198977, name: 'Cameron Boozer' }, { athleteId: 301, name: 'Dailyn Swain' }, { name: 'No id' }, { athleteId: null, name: 'Null id' }]);
        expect(out[0]).toEqual({ athleteId: 198977, name: 'Cameron Boozer', jersey: '12' });
        expect(out[1]).toEqual({ athleteId: 301, name: 'Dailyn Swain' });          // last season's number is not this season's
        expect(out[2]).toEqual({ name: 'No id' });
        expect(out[3]).toEqual({ athleteId: null, name: 'Null id' });
    });

    test('nothing to look up: the list comes back as is', async () => {
        expect(await roster.withJerseys(SEASON, [])).toEqual([]);
        expect(await roster.withJerseys(SEASON, null)).toEqual([]);
    });
});

// ---- the schedule ingest: once a season ----------------------------------

const scheduleGame = (id) => ({
    id, season: SEASON, seasonType: 'regular', startDate: '2026-11-03T00:00:00.000Z', startTimeTbd: false,
    neutralSite: false, conferenceGame: false, status: 'scheduled', homePoints: 0, awayPoints: 0,
    homeTeamId: 1, homeTeam: 'Duke', awayTeamId: 2, awayTeam: 'Texas'
});
const stubSchedule = () => jest.spyOn(cbbd, 'fetchGamesInRange').mockResolvedValue(
    { games: [scheduleGame(1), scheduleGame(2)], windows: 8, remainingCalls: 29000, capHits: [] });

describe('POST /hoops/games/:season/schedule', () => {
    test('the first ingest of a season imports the roster alongside the games', async () => {
        stubSchedule();
        const get = stubRoster();
        const res = await request(app).post(`/hoops/games/${SEASON}/schedule`).send({});
        expect(res.status).toBe(200);
        expect(res.body.roster).toMatchObject({ season: SEASON, players: 4 });
        expect(rosterCalls(get)).toHaveLength(1);
        expect(await HoopsRoster.countDocuments({ season: SEASON })).toBe(4);
    });

    test('every later ingest skips it — the call is spent ONCE a season, not per run', async () => {
        stubSchedule();
        const get = stubRoster(fullRoster());
        await request(app).post(`/hoops/games/${SEASON}/schedule`).send({});
        const res = await request(app).post(`/hoops/games/${SEASON}/schedule`).send({ seasonType: 'postseason' });
        expect(res.status).toBe(200);
        expect(res.body.roster).toEqual({ skippedReason: 'already imported' });
        expect(rosterCalls(get)).toHaveLength(1);
    });

    test('a roster caught half-published is tried again on the next ingest', async () => {
        stubSchedule();
        const get = stubRoster();                                             // two teams so far
        await request(app).post(`/hoops/games/${SEASON}/schedule`).send({});
        get.mockResolvedValue({ data: fullRoster(), remainingCalls: 29600 });
        const res = await request(app).post(`/hoops/games/${SEASON}/schedule`).send({});
        expect(res.body.roster).toMatchObject({ players: fullRoster().reduce((n, t) => n + t.players.filter(p => p.jersey).length, 0) });
        expect(rosterCalls(get)).toHaveLength(2);
    });

    test('a roster failure does not fail the schedule — the games still land', async () => {
        stubSchedule();
        jest.spyOn(cbbd, 'cbbdGet').mockRejectedValue(Object.assign(new Error('Could not reach CBBD: reset'), { unreachable: true }));
        const res = await request(app).post(`/hoops/games/${SEASON}/schedule`).send({});
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ created: 2, roster: null, rosterError: expect.stringMatching(/reach CBBD/) });
        expect(await HoopsGame.countDocuments({})).toBe(2);
    });

    test('a schedule that fails never reaches the roster call', async () => {
        jest.spyOn(cbbd, 'fetchGamesInRange').mockResolvedValue({ games: [], windows: 8, remainingCalls: 1, capHits: [] });
        const get = stubRoster();
        const res = await request(app).post(`/hoops/games/${SEASON}/schedule`).send({});
        expect(res.status).toBe(422);
        expect(get).not.toHaveBeenCalled();
    });
});

// ---- the admin's re-run --------------------------------------------------

describe('POST /hoops/teams/:season/roster', () => {
    test('re-imports even when the season already has a roster — the late-addition door', async () => {
        const get = stubRoster();
        await roster.importSeason(SEASON);
        const res = await request(app).post(`/hoops/teams/${SEASON}/roster`);
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ season: SEASON, teams: 2, players: 4, remainingCalls: 29700 });
        expect(rosterCalls(get)).toHaveLength(2);
    });

    test('a season other than the stored one is refused unless forced', async () => {
        const get = stubRoster();
        const res = await request(app).post(`/hoops/teams/${SEASON - 1}/roster`);
        expect(res.status).toBe(422);
        expect(res.body).toMatchObject({ requested: SEASON - 1, expected: SEASON });
        expect(get).not.toHaveBeenCalled();
        const forced = await request(app).post(`/hoops/teams/${SEASON - 1}/roster?force=1`);
        expect(forced.status).toBe(200);
        expect(get).toHaveBeenCalledWith('/teams/roster', { season: SEASON - 1 });
    });

    test('bad input is 400; CBBD down or out of quota is 502, a CBBD 4xx is 400', async () => {
        expect((await request(app).post('/hoops/teams/twenty/roster')).status).toBe(400);
        const get = jest.spyOn(cbbd, 'cbbdGet');
        get.mockRejectedValueOnce(Object.assign(new Error('Could not reach CBBD'), { unreachable: true }));
        expect((await request(app).post(`/hoops/teams/${SEASON}/roster`)).status).toBe(502);
        get.mockRejectedValueOnce(Object.assign(new Error('CBBD 429'), { status: 429 }));
        expect((await request(app).post(`/hoops/teams/${SEASON}/roster`)).status).toBe(502);
        get.mockRejectedValueOnce(Object.assign(new Error('CBBD 400'), { status: 400 }));
        const res = await request(app).post(`/hoops/teams/${SEASON}/roster`);
        expect(res.status).toBe(400);
        expect(res.body.upstreamStatus).toBe(400);
    });
});

// ---- the pages -------------------------------------------------------------

describe('the pages carry the number', () => {
    const GAME = {
        id: 500, season: SEASON, week: 3, seasonType: 'regular', status: 'final',
        startDate: new Date(Date.UTC(2026, 10, 18, 0, 30)), homeTeamId: 1, homeTeam: 'Duke', awayTeamId: 2, awayTeam: 'Texas',
        homePoints: 75, awayPoints: 60, neutralSite: true
    };
    const statLine = (athleteId, name, points) => ({ athleteId, name, position: 'F', games: 10, starts: 10, minutes: 300, points, rebounds: 50, assists: 20 });

    beforeEach(async () => {
        teamPage.clearRankCache();
        await HoopsTeam.create([
            { id: 1, season: SEASON, school: 'Duke', abbreviation: 'DUKE', preseason: { rank: 4 } },
            { id: 2, season: SEASON, school: 'Texas', abbreviation: 'TEX', preseason: { rank: 37 } }
        ]);
        await HoopsRoster.create([
            { season: SEASON, athleteId: 198977, jersey: '12' },
            { season: SEASON, athleteId: 301, jersey: '00' }
        ]);
        await HoopsTeamStats.create({ season: SEASON, teamId: 1, games: 10,
            players: [statLine(198977, 'Cameron Boozer', 225), statLine(208, 'Caleb Foster', 120)] });
    });

    test('box score: each side\'s players carry their number; no number, no field', async () => {
        await HoopsGame.create(GAME);
        await HoopsBoxScore.create({ gameId: 500, season: SEASON,
            home: { teamId: 1, players: [{ athleteId: 198977, name: 'Cameron Boozer' }, { athleteId: 208, name: 'Caleb Foster' }] },
            away: { teamId: 2, players: [{ athleteId: 301, name: 'Dailyn Swain' }] } });
        const get = jest.spyOn(cbbd, 'cbbdGet');
        const p = await gamePage.build(500);
        expect(get).not.toHaveBeenCalled();                                  // still never calls CBBD
        expect(p.box.home.players.map(x => x.jersey)).toEqual(['12', undefined]);
        expect(p.box.away.players[0].jersey).toBe('00');
    });

    test('key players in a preview carry their number, or null', async () => {
        await HoopsGame.create(Object.assign({}, GAME, { status: 'scheduled', homePoints: null, awayPoints: null }));
        const p = await gamePage.build(500);
        expect(p.preview.home.topScorers.map(x => [x.name, x.jersey])).toEqual([['Cameron Boozer', '12'], ['Caleb Foster', null]]);
    });

    test('team page: the season\'s players carry their number', async () => {
        const p = await teamPage.build(1, { season: SEASON });
        expect(p.stats.players.map(x => x.jersey)).toEqual(['12', undefined]);
    });
});
