// My Team's Games tile on a basketball league (#501): the two routes it reads.
//
//   GET /hoops/games/current-week/:season   — basketball's "what week is it",
//       which public/current-week.js asks instead of football's calendar
//   GET /hoops/games/teams/:season/:week     — some teams' games for one week,
//       from hoopsgames, never football's games (the id spaces overlap, #489)

const express = require('express');
const request = require('supertest');
const { useMongo } = require('./helpers/mongo');
const leagueSelection = require('../modules/league-selection');
const HoopsGame = require('../models/hoopsGame');
const HoopsTeam = require('../models/hoopsTeam');
const Game = require('../models/game');
const League = require('../models/league');
const SportSeason = require('../models/sportSeason');
const seasons = require('../modules/active-season');
const { GRACE_MS } = require('../modules/hoops-stale-duplicates');

const LEAGUE = 'hoops-league';
const SEASON = 2027;
const H = 3600e3;
const DAY = 24 * H;

useMongo();
const app = express();
app.use('/hoops/games', require('../routes/hoopsGames'));
const at = (days) => new Date(Date.now() + days * DAY);

const base = { season: SEASON, seasonType: 'regular', status: 'scheduled', neutralSite: false };
const game = (id, week, startDate, home, away, o) => Object.assign({}, base, {
    id, week, startDate, homeTeamId: home, homeTeam: 'T' + home, awayTeamId: away, awayTeam: 'T' + away
}, o || {});

beforeEach(async () => {
    await League.create({ code: LEAGUE, name: 'Hardwood Heroes', sport: 'basketball' });
    await SportSeason.create([{ sport: 'football', season: 2026, status: 'in-season' }, { sport: 'basketball', season: SEASON, status: 'in-season' }]);
    await seasons.prime();
    jest.spyOn(leagueSelection, 'viewableBy').mockResolvedValue([LEAGUE]);
    await HoopsTeam.create([
        { id: 1, season: SEASON, school: 'Duke', abbreviation: 'DUKE', logos: ['https://x/duke.png'] },
        { id: 2, season: SEASON, school: 'Texas', abbreviation: 'TEX', logos: ['https://x/tex.png'] },
        { id: 3, season: SEASON, school: 'Kansas', abbreviation: 'KU' }
    ]);
});
afterEach(() => { seasons._reset(); jest.restoreAllMocks(); });

describe('GET /hoops/games/current-week/:season', () => {
    test('the week being played, named as live', async () => {
        await HoopsGame.create([
            game(10, 1, at(-9), 1, 2, { status: 'final', homePoints: 80, awayPoints: 70 }),
            game(11, 2, at(-1), 1, 3),
            game(12, 2, at(2), 2, 3),
            game(13, 3, at(6), 1, 2)
        ]);
        const res = await request(app).get(`/hoops/games/current-week/${SEASON}`);
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ season: SEASON, week: 2, liveNow: { week: 2, seasonType: 'regular' } });
    });

    test('before tip-off: week 1, and nothing live', async () => {
        await HoopsGame.create([game(10, 1, at(20), 1, 2), game(11, 2, at(27), 1, 3)]);
        const res = await request(app).get(`/hoops/games/current-week/${SEASON}`);
        expect(res.body).toMatchObject({ week: 1, liveNow: null });
    });

    test('no basketball schedule: null rather than a guess', async () => {
        const res = await request(app).get(`/hoops/games/current-week/${SEASON}`);
        expect(res.body).toMatchObject({ week: null, liveNow: null });
    });

    test('reads basketball only — a football slate in the same season is not a week', async () => {
        await Game.create({ id: 99, season: SEASON, week: 7, seasonType: 'regular', startDate: at(0).toISOString(),
            homeId: 1, homeTeam: 'A', awayId: 2, awayTeam: 'B', conferenceGame: false, neutralSite: false, startTimeTbd: false });
        const res = await request(app).get(`/hoops/games/current-week/${SEASON}`);
        expect(res.body.week).toBeNull();
    });

    test('hidden from someone in no basketball league; 400 for a bad season', async () => {
        expect((await request(app).get(`/hoops/games/current-week/abc`)).status).toBe(400);
        leagueSelection.viewableBy.mockResolvedValue(['graham-league']);
        expect((await request(app).get(`/hoops/games/current-week/${SEASON}`)).status).toBe(404);
    });
});

describe('GET /hoops/games/teams/:season/:week', () => {
    beforeEach(async () => {
        await HoopsGame.create([
            game(10, 1, at(-9), 1, 2, { status: 'final', homePoints: 80, awayPoints: 70 }),
            game(20, 2, at(1), 1, 3),
            game(21, 2, at(2), 2, 3),          // neither side asked for below
            game(22, 2, at(3), 3, 1, { neutralSite: true })
        ]);
    });

    test("only the asked teams' games for that week, shaped, with the season's weeks", async () => {
        const res = await request(app).get(`/hoops/games/teams/${SEASON}/2?ids=1`);
        expect(res.status).toBe(200);
        expect(res.body.week).toBe(2);
        expect(res.body.games.map(g => g.id)).toEqual([20, 22]);
        expect(res.body.weeks.map(w => w.week)).toEqual([1, 2]);
        expect(res.body.games[0]).toMatchObject({ state: 'pre', home: { id: 1, team: 'Duke', logo: 'https://x/duke.png' }, away: { id: 3, team: 'Kansas' } });
        expect(res.body.games[1].neutralSite).toBe(true);
    });

    test('a final carries its score', async () => {
        const res = await request(app).get(`/hoops/games/teams/${SEASON}/1?ids=1,2`);
        expect(res.body.games).toHaveLength(1);
        expect(res.body.games[0]).toMatchObject({ id: 10, state: 'final', home: { points: 80 }, away: { points: 70 } });
    });

    // The bug in #501: the tile asked FOOTBALL's games collection with
    // basketball ids. A football game between the same ids must never show.
    test('never reads football games, even with the same ids and week', async () => {
        await Game.create({ id: 777, season: SEASON, week: 2, seasonType: 'regular', startDate: at(1).toISOString(),
            homeId: 1, homeTeam: 'Football A', awayId: 2, awayTeam: 'Football B', conferenceGame: false, neutralSite: false, startTimeTbd: false });
        const res = await request(app).get(`/hoops/games/teams/${SEASON}/2?ids=1,2`);
        expect(res.body.games.map(g => g.id)).toEqual([20, 21, 22]);
    });

    // A rescheduled game's old listing (#498) — its played twin is in a
    // DIFFERENT week, which an in-week check alone cannot see.
    test('drops a stale listing whose played twin sits in another week', async () => {
        await HoopsGame.deleteMany({});
        await HoopsGame.create([
            game(30, 1, new Date(Date.now() - GRACE_MS - 5 * DAY), 1, 2),
            game(31, 2, new Date(Date.now() - GRACE_MS + DAY), 1, 2, { status: 'final', homePoints: 70, awayPoints: 60 }),
            game(32, 1, new Date(Date.now() - GRACE_MS - 4 * DAY), 3, 1)   // overdue, no twin: kept
        ]);
        const res = await request(app).get(`/hoops/games/teams/${SEASON}/1?ids=1`);
        expect(res.body.games.map(g => g.id)).toEqual([32]);
    });

    test('no ids: no games, but still the week list', async () => {
        const res = await request(app).get(`/hoops/games/teams/${SEASON}/2`);
        expect(res.body).toMatchObject({ games: [], weeks: [{ week: 1 }, { week: 2 }] });
    });

    test('400 for a bad season, week or too many ids; hidden from non-members', async () => {
        expect((await request(app).get(`/hoops/games/teams/abc/2?ids=1`)).status).toBe(400);
        expect((await request(app).get(`/hoops/games/teams/${SEASON}/0?ids=1`)).status).toBe(400);
        expect((await request(app).get(`/hoops/games/teams/${SEASON}/x?ids=1`)).status).toBe(400);
        const many = Array.from({ length: 41 }, (_, i) => i + 1).join(',');
        expect((await request(app).get(`/hoops/games/teams/${SEASON}/2?ids=${many}`)).status).toBe(400);
        leagueSelection.viewableBy.mockResolvedValue(['graham-league']);
        expect((await request(app).get(`/hoops/games/teams/${SEASON}/2?ids=1`)).status).toBe(404);
    });
});
