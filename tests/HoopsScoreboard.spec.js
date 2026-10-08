// The basketball league scoreboard (#490): modules/hoops-league-scoreboard.js
// and GET /hoops/games/scoreboard/:league/:season/:week. Same response shape
// as football's, so public/scoreboard.js renders either; what is checked here
// is what is basketball's own — rosters, live/final from the status, the T-Rank
// top 25, and that only a member viewing that basketball league can read it.

const express = require('express');
const request = require('supertest');
const { useMongo } = require('./helpers/mongo');
const board = require('../modules/hoops-league-scoreboard');
const leagueSelection = require('../modules/league-selection');
const teamPage = require('../modules/hoops-team-page');
const HoopsGame = require('../models/hoopsGame');
const HoopsTeam = require('../models/hoopsTeam');
const Franchise = require('../models/franchise');
const Account = require('../models/account');
const League = require('../models/league');
const SportSeason = require('../models/sportSeason');
const seasons = require('../modules/active-season');
const { MAX_GAME_MS } = require('../modules/game-window');

const LEAGUE = 'hoops-league';
const SEASON = 2027;
const H = 3600e3;

describe('gameState', () => {
    const now = Date.UTC(2026, 10, 20, 2);
    const g = (o) => Object.assign({ status: 'scheduled', startDate: new Date(now + H).toISOString() }, o);
    test('a final with points is final', () => {
        expect(board.gameState(g({ status: 'final', homePoints: 70, awayPoints: 60 }), now)).toBe('final');
    });
    test('in progress, as the poller wrote it, is live', () => {
        expect(board.gameState(g({ status: 'in_progress', startDate: new Date(now - H).toISOString() }), now)).toBe('live');
    });
    test('still "scheduled" an hour after tip (poller behind) reads live', () => {
        expect(board.gameState(g({ startDate: new Date(now - H).toISOString() }), now)).toBe('live');
    });
    test('past the game window with no final is NOT "Final" over no score', () => {
        expect(board.gameState(g({ startDate: new Date(now - MAX_GAME_MS - H).toISOString() }), now)).toBe('pre');
    });
    test('postponed, cancelled and TBD never read live', () => {
        const past = new Date(now - H).toISOString();
        expect(board.gameState(g({ status: 'postponed', startDate: past }), now)).toBe('pre');
        expect(board.gameState(g({ status: 'cancelled', startDate: past }), now)).toBe('pre');
        expect(board.gameState(g({ startTimeTbd: true, startDate: past }), now)).toBe('pre');
    });
    test('to come is pre', () => {
        expect(board.gameState(g(), now)).toBe('pre');
    });
});

describe('shapeGame', () => {
    const owner = { userId: 'a', name: 'G G', firstName: 'G', franchise: 'Hoop Dreams', color: null, avatarUrl: null, initials: 'GG' };
    const ctx = (o) => Object.assign({
        nowMs: Date.UTC(2026, 10, 20), teams: { 1: { school: 'Duke', abbr: 'DUKE', logo: 'd.png' } },
        owners: { 1: owner }, points: { '1:500': 5 }, ranks: { 1: 3, 2: 40 }
    }, o);
    const game = { id: 500, week: 3, seasonType: 'regular', status: 'final', homePoints: 75, awayPoints: 60,
        startDate: '2026-11-18T00:30:00.000Z', homeTeamId: 1, homeTeam: 'Duke', awayTeamId: 2, awayTeam: 'Texas',
        broadcasts: [{ name: 'ESPN', type: 'TV' }, { name: 'WDNC', type: 'Radio' }], gameNotes: 'Champions Classic' };

    test('the owner and the points banked ride on the rostered side', () => {
        const s = board.shapeGame(game, ctx());
        expect(s.home.owner).toMatchObject({ franchise: 'Hoop Dreams', points: 5 });
        expect(s.away.owner).toBeNull();
        expect(s.leagueGame).toBe(true);
    });
    test('the rank shows only inside the top 25, and "ranked" follows it', () => {
        const s = board.shapeGame(game, ctx());
        expect(s.home.rank).toBe(3);
        expect(s.away.rank).toBeNull();                       // #40: not shown
        expect(s.ranked).toBe(true);
        expect(board.shapeGame(game, ctx({ ranks: { 1: 26, 2: 40 } })).ranked).toBe(false);
    });
    test('the school comes from the team doc, the TV from the broadcasts, no football fields', () => {
        const s = board.shapeGame(game, ctx());
        expect(s.home.team).toBe('Duke');
        expect(s.away.team).toBe('Texas');                    // no team doc: the game's own name
        expect(s.outlet).toBe('ESPN');
        expect(s).toMatchObject({ spread: null, overUnder: null, weather: null, situation: null, notes: 'Champions Classic' });
        expect(s.home.possession).toBe(false);
    });
    test('a postponement says so in the notes', () => {
        expect(board.shapeGame(Object.assign({}, game, { status: 'postponed' }), ctx()).notes).toBe('Postponed');
    });
    test('period and clock only while live', () => {
        const live = Object.assign({}, game, { status: 'in_progress', period: 2, clock: '8:43', homePoints: 40, awayPoints: 38 });
        expect(board.shapeGame(live, ctx())).toMatchObject({ state: 'live', period: 2, clock: '8:43' });
        expect(board.shapeGame(Object.assign({}, game, { period: 2, clock: '0:00' }), ctx())).toMatchObject({ period: null, clock: null });
    });
    test('the slate is tip-ordered, ties by id', () => {
        const a = Object.assign({}, game, { id: 9, startDate: '2026-11-18T00:30:00.000Z' });
        const b = Object.assign({}, game, { id: 3, startDate: '2026-11-18T00:30:00.000Z' });
        const c = Object.assign({}, game, { id: 1, startDate: '2026-11-19T00:30:00.000Z' });
        expect(board.shapeGames([c, a, b], ctx()).map(x => x.id)).toEqual([3, 9, 1]);
    });
});

describe('ownersByTeam', () => {
    test('reads basketball rosters (teamRefs), for the season asked', () => {
        const out = board.ownersByTeam([
            { _id: 'a1', firstName: 'Gar', lastName: 'G', seasons: [{ season: SEASON, franchiseName: 'Hoop Dreams', teamRefs: [{ id: 7, sport: 'basketball' }] }] },
            { _id: 'a2', firstName: 'Old', lastName: 'O', seasons: [{ season: 2026, teamRefs: [{ id: 8, sport: 'basketball' }] }] }
        ], SEASON);
        expect(Object.keys(out)).toEqual(['7']);
        expect(out[7]).toMatchObject({ franchise: 'Hoop Dreams', initials: 'GG', userId: 'a1' });
    });
});

describe('GET /hoops/games/scoreboard/:league/:season/:week', () => {
    useMongo();
    const app = express();
    app.use('/hoops/games', require('../routes/hoopsGames'));
    const tip = (d) => new Date(Date.now() + d * 24 * H);

    beforeEach(async () => {
        await League.create({ code: LEAGUE, name: 'Hardwood Heroes', sport: 'basketball' });
        await SportSeason.create([{ sport: 'football', season: 2026, status: 'in-season' }, { sport: 'basketball', season: SEASON, status: 'in-season' }]);
        await seasons.prime();
        teamPage.clearRankCache();
        jest.spyOn(leagueSelection, 'viewableBy').mockResolvedValue([LEAGUE]);
        jest.spyOn(leagueSelection, 'selectedLeague').mockResolvedValue(LEAGUE);
        await HoopsTeam.create([
            { id: 1, season: SEASON, school: 'Duke', abbreviation: 'DUKE', conference: 'ACC', preseason: { rank: 2 } },
            { id: 2, season: SEASON, school: 'Texas', abbreviation: 'TEX', conference: 'SEC', preseason: { rank: 40 } }
        ]);
        const base = { season: SEASON, seasonType: 'regular', status: 'scheduled', homeTeamId: 1, homeTeam: 'Duke', homeConference: 'ACC',
            awayTeamId: 2, awayTeam: 'Texas', awayConference: 'SEC', neutralSite: false };
        await HoopsGame.create([
            Object.assign({}, base, { id: 10, week: 1, startDate: tip(-20), status: 'final', homePoints: 80, awayPoints: 70 }),
            Object.assign({}, base, { id: 20, week: 2, startDate: tip(2) }),
            Object.assign({}, base, { id: 21, week: 2, startDate: tip(3), homeTeamId: 2, awayTeamId: 1 })
        ]);
        const a = await Account.create({ firstName: 'Gar', lastName: 'G', email: 'g@example.invalid' });
        await Franchise.create({ accountId: a._id, league: LEAGUE, seasons: [{ season: SEASON, franchiseName: 'Hoop Dreams',
            teamRefs: [{ id: 1, sport: 'basketball' }], weeklyScore: [{ week: 1, score: 3, scoreByTeam: [{ teamId: 1, gameId: 10, score: 3 }] }] }] });
    });
    afterEach(() => { seasons._reset(); jest.restoreAllMocks(); });

    test('opens on the next week to come, with the week list and the slate', async () => {
        const res = await request(app).get(`/hoops/games/scoreboard/${LEAGUE}/${SEASON}`);
        expect(res.status).toBe(200);
        expect(res.body.week).toBe(2);
        expect(res.body.weeks.map(w => w.week)).toEqual([1, 2]);
        expect(res.body.games.map(g => g.id)).toEqual([20, 21]);
        expect(res.body.conferences.map(c => c.name)).toEqual(['ACC', 'SEC']);
        expect(res.body.games[0].home).toMatchObject({ team: 'Duke', rank: 2, owner: { franchise: 'Hoop Dreams' } });
    });

    test('a named week, with the points banked in it', async () => {
        const res = await request(app).get(`/hoops/games/scoreboard/${LEAGUE}/${SEASON}/1`);
        expect(res.body.games[0]).toMatchObject({ id: 10, state: 'final', home: { points: 80, owner: { points: 3 } } });
    });

    test('?live=1 returns only live games and skips the week list', async () => {
        const res = await request(app).get(`/hoops/games/scoreboard/${LEAGUE}/${SEASON}/2?live=1`);
        expect(res.body.games).toEqual([]);
        expect(res.body.weeks).toBeUndefined();
        expect(res.body.liveCount).toBe(0);
    });

    test('no games in the season: an empty board, not an error', async () => {
        await HoopsGame.deleteMany({});
        const res = await request(app).get(`/hoops/games/scoreboard/${LEAGUE}/${SEASON}`);
        expect(res.body).toMatchObject({ week: null, games: [], weeks: [] });
    });

    test('only for the basketball league being viewed: another league in the path is a 404', async () => {
        leagueSelection.selectedLeague.mockResolvedValue('graham-league');
        expect((await request(app).get(`/hoops/games/scoreboard/${LEAGUE}/${SEASON}`)).status).toBe(404);
        leagueSelection.selectedLeague.mockResolvedValue(LEAGUE);
        expect((await request(app).get(`/hoops/games/scoreboard/graham-league/${SEASON}`)).status).toBe(404);
    });

    test('basketball stays hidden from someone in no basketball league', async () => {
        leagueSelection.viewableBy.mockResolvedValue(['graham-league']);
        expect((await request(app).get(`/hoops/games/scoreboard/${LEAGUE}/${SEASON}`)).status).toBe(404);
    });

    test('400 for a bad season', async () => {
        expect((await request(app).get(`/hoops/games/scoreboard/${LEAGUE}/abc`)).status).toBe(400);
    });
});
