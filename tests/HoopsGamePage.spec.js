// The basketball game page's data (#503): the on-demand box score
// (modules/hoops-box-score.js), the page payload (modules/hoops-game-page.js)
// and GET /hoops/games/:id/page.
//
// The box score is BILLABLE — 3 CBBD calls — so most of what is tested here
// is when it is NOT fetched: a stored box, a game not yet final, a game asked
// about inside the retry window, and an old game CBBD will never box.

const express = require('express');
const request = require('supertest');
const { useMongo } = require('./helpers/mongo');
const boxScore = require('../modules/hoops-box-score');
const gamePage = require('../modules/hoops-game-page');
const teamPage = require('../modules/hoops-team-page');
const cbbd = require('../modules/cbbd-client');
const leagueSelection = require('../modules/league-selection');
const HoopsGame = require('../models/hoopsGame');
const HoopsTeam = require('../models/hoopsTeam');
const HoopsBoxScore = require('../models/hoopsBoxScore');
const Franchise = require('../models/franchise');
const Account = require('../models/account');
const League = require('../models/league');
const SportSeason = require('../models/sportSeason');
const seasons = require('../modules/active-season');

useMongo();

const LEAGUE = 'hoops-league';
const SEASON = 2027;
const NOW = Date.UTC(2026, 10, 20);

const GAME = {
    id: 500, season: SEASON, week: 3, seasonType: 'regular', status: 'final',
    startDate: new Date(Date.UTC(2026, 10, 18, 0, 30)), startTimeTbd: false,
    homeTeamId: 1, homeTeam: 'Duke', awayTeamId: 2, awayTeam: 'Texas',
    homePoints: 75, awayPoints: 60, neutralSite: true, conferenceGame: false,
    gameNotes: 'Dick Vitale Invitational', venue: 'Spectrum Center', city: 'Charlotte', state: 'NC'
};

// CBBD's per-game shapes, cut down to what the import reads.
const sideStats = (total, byPeriod, o = {}) => Object.assign({
    possessions: 66, assists: 13, steals: 8, blocks: 2,
    points: { total, byPeriod, largestLead: 17, fastBreak: 11, inPaint: 24, offTurnovers: 8 },
    fieldGoals: { made: 22, attempted: 52 }, threePointFieldGoals: { made: 9, attempted: 23 },
    freeThrows: { made: 22, attempted: 30 }, turnovers: { total: 10 }, rebounds: { total: 37 },
    fourFactors: { effectiveFieldGoalPct: 51, freeThrowRate: 57.7, turnoverRatio: 15.2, offensiveReboundPct: 29.7 }
}, o);
const teamRow = (gameId, teamId, opponentId, team, opp) => ({
    gameId, teamId, opponentId, pace: 66, teamStats: team, opponentStats: opp
});
const playerRow = (gameId, teamId, names) => ({
    gameId, teamId, players: names.map((n, i) => ({
        athleteId: i + 1, name: n, position: 'G', starter: i < 5, minutes: 30 - i, points: 20 - i,
        rebounds: { total: 5 }, assists: 3, steals: 1, blocks: 0, turnovers: 1, fouls: 2,
        fieldGoals: { made: 7, attempted: 13 }, threePointFieldGoals: { made: 4, attempted: 8 }, freeThrows: { made: 5, attempted: 6 }
    }))
});

function stubCbbd({ fail = false } = {}) {
    return jest.spyOn(cbbd, 'cbbdGet').mockImplementation(async (path, params) => {
        if (fail) throw new Error('CBBD 503');
        if (path === '/games/teams') {
            return { data: [
                teamRow(999, 1, 7, sideStats(80, [40, 40]), sideStats(70, [35, 35])),        // another game that window
                teamRow(500, 1, 2, sideStats(75, [32, 43]), sideStats(60, [33, 27]))
            ] };
        }
        return { data: [playerRow(500, params.team === 'Duke' ? 1 : 2, params.team === 'Duke' ? ['Isaiah Evans', 'Cameron Boozer'] : ['Dailyn Swain'])] };
    });
}

beforeEach(async () => {
    boxScore.clearRetryCache();
    teamPage.clearRankCache();
    await League.create({ code: LEAGUE, name: 'Hardwood Heroes', sport: 'basketball' });
    await SportSeason.create([{ sport: 'football', season: 2026, status: 'in-season' }, { sport: 'basketball', season: SEASON, status: 'in-season' }]);
    await seasons.prime();
    await HoopsTeam.create([
        { id: 1, season: SEASON, school: 'Duke', abbreviation: 'DUKE', color: '#013088', preseason: { rank: 4 } },
        { id: 2, season: SEASON, school: 'Texas', abbreviation: 'TEX', color: '#bf5700', preseason: { rank: 37 } }
    ]);
});
afterEach(() => { seasons._reset(); jest.restoreAllMocks(); });

describe('buildBox', () => {
    test('picks THIS game out of the window, both sides, in per-game units', () => {
        const box = boxScore.buildBox(GAME,
            [teamRow(999, 1, 7, sideStats(80, [40, 40]), sideStats(70, [35, 35])), teamRow(500, 1, 2, sideStats(75, [32, 43]), sideStats(60, [33, 27]))],
            [playerRow(500, 1, ['Isaiah Evans'])], [playerRow(500, 2, ['Dailyn Swain'])]);
        expect(box).toMatchObject({ gameId: 500, pace: 66,
            home: { teamId: 1, points: 75, byPeriod: [32, 43], tovPct: 15.2, threeMade: 9, threeAtt: 23 },
            away: { teamId: 2, points: 60, byPeriod: [33, 27] } });
        expect(box.home.players[0]).toMatchObject({ name: 'Isaiah Evans', starter: true, rebounds: 5, threeMade: 4, threeAtt: 8 });
        expect(box.away.players[0].name).toBe('Dailyn Swain');
    });

    test('a row from the AWAY team\'s point of view still lands each side right', () => {
        const box = boxScore.buildBox(GAME, [teamRow(500, 2, 1, sideStats(60, [33, 27]), sideStats(75, [32, 43]))], [], []);
        expect(box.home).toMatchObject({ teamId: 1, points: 75 });
        expect(box.away).toMatchObject({ teamId: 2, points: 60 });
    });

    test('no row for this game: null, so nothing half-built is stored', () => {
        expect(boxScore.buildBox(GAME, [teamRow(999, 1, 7, sideStats(1, []), sideStats(0, []))], [], [])).toBeNull();
    });
});

describe('getBox', () => {
    test('a final game: 3 calls, by TEAM and a date window (CBBD ignores gameId), then stored', async () => {
        const get = stubCbbd();
        const out = await boxScore.getBox(GAME, NOW);
        expect(out.box.home.points).toBe(75);
        expect(get).toHaveBeenCalledTimes(3);
        const [path, params] = get.mock.calls[0];
        expect(path).toBe('/games/teams');
        expect(params).toEqual({ team: 'Duke', season: SEASON, startDateRange: '2026-11-17', endDateRange: '2026-11-19' });
        expect(params.gameId).toBeUndefined();
        expect(await HoopsBoxScore.countDocuments({ gameId: 500 })).toBe(1);
    });

    test('a stored box costs nothing', async () => {
        const get = stubCbbd();
        await boxScore.getBox(GAME, NOW);
        get.mockClear();
        boxScore.clearRetryCache();
        expect((await boxScore.getBox(GAME, NOW)).box.home.points).toBe(75);
        expect(get).not.toHaveBeenCalled();
    });

    test('a game not yet final is never fetched', async () => {
        const get = stubCbbd();
        expect(await boxScore.getBox(Object.assign({}, GAME, { status: 'scheduled', homePoints: null }), NOW)).toEqual({ box: null });
        expect(get).not.toHaveBeenCalled();
    });

    test('no box yet: asked once, then not again inside the retry window, then again after it', async () => {
        const get = jest.spyOn(cbbd, 'cbbdGet').mockResolvedValue({ data: [] });
        const recent = Object.assign({}, GAME, { startDate: new Date(NOW - 60 * 60 * 1000) });
        await boxScore.getBox(recent, NOW);
        await boxScore.getBox(recent, NOW + 60 * 1000);
        expect(get).toHaveBeenCalledTimes(3);
        await boxScore.getBox(recent, NOW + boxScore.RETRY_MS + 1);
        expect(get).toHaveBeenCalledTimes(6);
        expect(await HoopsBoxScore.countDocuments({})).toBe(0);           // recent: not given up on
    });

    test('an old game CBBD never boxed is stored as missing and never asked again', async () => {
        const get = jest.spyOn(cbbd, 'cbbdGet').mockResolvedValue({ data: [] });
        const old = Object.assign({}, GAME, { startDate: new Date(NOW - boxScore.MISSING_AFTER_MS - 1) });
        expect(await boxScore.getBox(old, NOW)).toEqual({ box: null, missing: true });
        boxScore.clearRetryCache();
        expect(await boxScore.getBox(old, NOW)).toEqual({ box: null, missing: true });
        expect(get).toHaveBeenCalledTimes(3);
        expect(await HoopsBoxScore.findOne({ gameId: 500 }).lean()).toMatchObject({ missing: true });
    });

    // CBBD can post the team line before the player lines; a stored box is
    // never fetched again, so storing it then would lose the players for good.
    test('a recent box missing player lines is shown but not stored; an old one is stored as is', async () => {
        jest.spyOn(cbbd, 'cbbdGet').mockImplementation(async (path) => (path === '/games/teams'
            ? { data: [teamRow(500, 1, 2, sideStats(75, [32, 43]), sideStats(60, [33, 27]))] }
            : { data: [] }));
        const recent = Object.assign({}, GAME, { startDate: new Date(NOW - 60 * 60 * 1000) });
        expect((await boxScore.getBox(recent, NOW)).box.home.points).toBe(75);
        expect(await HoopsBoxScore.countDocuments({})).toBe(0);
        boxScore.clearRetryCache();
        const old = Object.assign({}, GAME, { startDate: new Date(NOW - boxScore.MISSING_AFTER_MS - 1) });
        await boxScore.getBox(old, NOW);
        expect(await HoopsBoxScore.countDocuments({ gameId: 500, missing: false })).toBe(1);
    });

    test('CBBD down: unavailable, not stored, and tried again later', async () => {
        jest.spyOn(console, 'error').mockImplementation(() => {});
        stubCbbd({ fail: true });
        expect(await boxScore.getBox(GAME, NOW)).toEqual({ box: null, unavailable: true });
        expect(await HoopsBoxScore.countDocuments({})).toBe(0);
    });

    test('no game: no box', async () => {
        expect(await boxScore.getBox(null)).toEqual({ box: null });
    });
});

describe('the team page and the game page agree on a game still to play', () => {
    // Ranks are blended by week, so the week an unplayed game is rated
    // against decides its quadrant. Both pages must use the SAME week — the
    // season's latest played one — or they show the manager two answers.
    test('both rate it against the season\'s current week', async () => {
        const HoopsRating = require('../models/hoopsRating');
        await HoopsTeam.create([
            { id: 3, season: SEASON, school: 'Other A', preseason: { rank: 100 } },
            { id: 4, season: SEASON, school: 'Other B', preseason: { rank: 101 } }
        ]);
        // Texas: #37 preseason, #300 by the week-5 live rating. Week 5 is
        // mid-BLEND (hoops-ranks blendWeight), so ranks rated at week 5 and at
        // week 12 (fully live, falling back to week 5's rows) differ — which is
        // what makes the choice of week visible.
        await HoopsRating.create([[1, 1], [2, 300], [3, 2], [4, 3]].map(([teamId, rank]) =>
            ({ season: SEASON, week: 5, teamId, rank, source: 'cbbd-adjusted' })));
        await HoopsGame.create([
            Object.assign({}, GAME, { id: 701, week: 1, awayTeamId: 3, awayTeam: 'Other A', neutralSite: false }),     // Duke's last game: week 1
            Object.assign({}, GAME, { id: 702, week: 5, homeTeamId: 3, awayTeamId: 4, neutralSite: false }),          // the season is at week 5
            Object.assign({}, GAME, { id: 700, week: 12, status: 'scheduled', homePoints: null, awayPoints: null, neutralSite: false })
        ]);
        expect(await teamPage.currentWeek(SEASON)).toBe(5);
        const fromTeam = (await teamPage.build(1, { season: SEASON })).games.find(g => g.id === 700);
        const fromGame = (await gamePage.build(700));
        expect(fromGame.home.quadrant).toBe(fromTeam.quadrant);
        expect(fromGame.away.rank).toBe(fromTeam.opponent.rank);
        // And it is the week-5 blend, not week 12's pure live #300 (Q4).
        expect(fromTeam.opponent.rank).not.toBe(300);
    });
});

describe('build', () => {
    beforeEach(async () => {
        await HoopsGame.create([
            GAME,
            Object.assign({}, GAME, { id: 400, startDate: new Date(Date.UTC(2026, 10, 10)), homeTeamId: 1, awayTeamId: 9, homePoints: 50, awayPoints: 70, neutralSite: false }),
            Object.assign({}, GAME, { id: 600, startDate: new Date(Date.UTC(2026, 10, 25)), homeTeamId: 2, awayTeamId: 1, homePoints: 90, awayPoints: 60 })
        ]);
    });

    test('each side reads the game from its OWN point of view', async () => {
        stubCbbd();
        const p = await gamePage.build(500);
        // Neutral site: Texas (#37) is Q1 for Duke; Duke (#4) is Q1 for Texas too.
        expect(p.home).toMatchObject({ id: 1, school: 'Duke', abbreviation: 'DUKE', rank: 4, points: 75, quadrant: 1, hasPage: true });
        expect(p.away).toMatchObject({ id: 2, school: 'Texas', rank: 37, points: 60, quadrant: 1 });
        expect(p.game).toMatchObject({ final: true, neutralSite: true, notes: 'Dick Vitale Invitational', venue: 'Spectrum Center' });
        expect(p.box.home.points).toBe(75);
    });

    test('records are through THIS game, not today', async () => {
        stubCbbd();
        const p = await gamePage.build(500);
        expect(p.home.record).toEqual({ w: 1, l: 1 });       // lost game 400, won this; game 600 is later
        expect(p.away.record).toEqual({ w: 0, l: 1 });
    });

    test('in a league: owners, banked points and this league\'s values', async () => {
        stubCbbd();
        const a = await Account.create({ firstName: 'Garrett', lastName: 'G', email: 'g@example.invalid' });
        await Franchise.create({ accountId: a._id, league: LEAGUE, seasons: [{ season: SEASON, franchiseName: 'Hoop Dreams',
            teamRefs: [{ id: 1, sport: 'basketball' }], weeklyScore: [{ week: 3, score: 5, scoreByTeam: [{ teamId: 1, gameId: 500, score: 5 }] }] }] });
        const p = await gamePage.build(500, { league: LEAGUE });
        expect(p.home).toMatchObject({ owner: { franchiseName: 'Hoop Dreams' }, banked: 5 });
        expect(p.away.owner).toBeNull();
        expect(p.quadrantValues).toMatchObject({ 1: 5 });
    });

    test('a postseason game has no quadrant on either side', async () => {
        await HoopsGame.updateOne({ id: 500 }, { $set: { seasonType: 'postseason', tournament: 'NCAA' } });
        stubCbbd();
        const p = await gamePage.build(500);
        expect([p.home.quadrant, p.away.quadrant]).toEqual([null, null]);
        expect(p.game).toMatchObject({ postseason: true, tournament: 'NCAA' });
    });

    test('a game still to play: no score, no record, no box fetch', async () => {
        const get = stubCbbd();
        await HoopsGame.updateOne({ id: 500 }, { $set: { status: 'scheduled', homePoints: null, awayPoints: null } });
        const p = await gamePage.build(500);
        expect(p.game.final).toBe(false);
        expect([p.home.points, p.home.record, p.box]).toEqual([null, null, null]);
        expect(get).not.toHaveBeenCalled();
    });

    test('a non-D-I opponent is named from the schedule and has no page', async () => {
        stubCbbd();
        await HoopsGame.updateOne({ id: 500 }, { $set: { awayTeamId: 9999, awayTeam: 'Division II College' } });
        const p = await gamePage.build(500);
        expect(p.away).toMatchObject({ id: 9999, school: 'Division II College', hasPage: false, logo: null });
    });

    test('unknown or unusable id: null', async () => {
        expect(await gamePage.build(12345)).toBeNull();
        expect(await gamePage.build('abc')).toBeNull();
    });
});

describe('GET /hoops/games/:id/page', () => {
    const app = express();
    app.use('/hoops/games', require('../routes/hoopsGames'));
    beforeEach(async () => {
        await HoopsGame.create(GAME);
        jest.spyOn(leagueSelection, 'viewableBy').mockResolvedValue([LEAGUE]);
        jest.spyOn(leagueSelection, 'selectedLeague').mockResolvedValue(LEAGUE);
        stubCbbd();
    });

    test('serves the page', async () => {
        const res = await request(app).get('/hoops/games/500/page');
        expect(res.status).toBe(200);
        expect(res.body.home.school).toBe('Duke');
    });

    test('basketball stays hidden: someone in no basketball league gets a plain 404', async () => {
        leagueSelection.viewableBy.mockResolvedValue(['graham-league']);
        const res = await request(app).get('/hoops/games/500/page');
        expect(res.status).toBe(404);
        expect(res.body).toEqual({ message: 'Not found' });
    });

    test('a football selection gets the game without anyone\'s roster', async () => {
        leagueSelection.selectedLeague.mockResolvedValue('graham-league');
        const res = await request(app).get('/hoops/games/500/page');
        expect(res.body.quadrantValues).toBeNull();
    });

    test('a failed league lookup still serves the game', async () => {
        jest.spyOn(console, 'error').mockImplementation(() => {});
        leagueSelection.selectedLeague.mockRejectedValue(new Error('M0'));
        expect((await request(app).get('/hoops/games/500/page')).status).toBe(200);
    });

    test('400 for a bad id, 404 for an unknown game, 500 when the build throws', async () => {
        expect((await request(app).get('/hoops/games/abc/page')).status).toBe(400);
        expect((await request(app).get('/hoops/games/1/page')).status).toBe(404);
        jest.spyOn(console, 'error').mockImplementation(() => {});
        jest.spyOn(gamePage, 'build').mockRejectedValue(new Error('boom'));
        const res = await request(app).get('/hoops/games/500/page');
        expect(res.status).toBe(500);
        expect(res.body.message).toBe('Could not load this game');
    });
});

describe('seesBasketball', () => {
    const { seesBasketball } = require('../modules/hoops-visibility');
    test('true only with a basketball league in view; fails closed', async () => {
        jest.spyOn(leagueSelection, 'viewableBy').mockResolvedValue([LEAGUE]);
        expect(await seesBasketball({})).toBe(true);
        leagueSelection.viewableBy.mockResolvedValue(['graham-league']);
        expect(await seesBasketball({})).toBe(false);
        leagueSelection.viewableBy.mockResolvedValue(null);
        expect(await seesBasketball({})).toBe(false);
        jest.spyOn(console, 'error').mockImplementation(() => {});
        leagueSelection.viewableBy.mockRejectedValue(new Error('M0'));
        expect(await seesBasketball({})).toBe(false);
    });
});
