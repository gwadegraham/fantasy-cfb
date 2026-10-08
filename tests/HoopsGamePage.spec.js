// The basketball game page's data (#503): the nightly box-score batch
// (modules/hoops-box-score.js — football's pattern), the page payload
// (modules/hoops-game-page.js) and GET /hoops/games/:id/page.
//
// The batch is BILLABLE, so what matters is that it is two calls for a whole
// window, that it lands each box on the right game and side, and that the
// page itself never calls CBBD.

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
    return jest.spyOn(cbbd, 'cbbdGet').mockImplementation(async (path) => {
        if (fail) throw new Error('CBBD 503');
        if (path === '/games/teams') {
            return { data: [
                teamRow(999, 1, 7, sideStats(80, [40, 40]), sideStats(70, [35, 35])),        // a game that is not ours
                teamRow(500, 1, 2, sideStats(75, [32, 43]), sideStats(60, [33, 27]))
            ] };
        }
        // The whole window's players: a row per side per game, AWAY FIRST, so
        // a match on the game alone would hand Duke Texas's lines.
        return { data: [playerRow(500, 2, ['Dailyn Swain']), playerRow(999, 1, ['Someone Else']), playerRow(500, 1, ['Isaiah Evans', 'Cameron Boozer'])] };
    });
}

beforeEach(async () => {
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
    test('picks THIS game out of the window, each side\'s OWN players, in per-game units', () => {
        const box = boxScore.buildBox(GAME,
            [teamRow(999, 1, 7, sideStats(80, [40, 40]), sideStats(70, [35, 35])), teamRow(500, 1, 2, sideStats(75, [32, 43]), sideStats(60, [33, 27]))],
            [playerRow(500, 2, ['Dailyn Swain']), playerRow(500, 1, ['Isaiah Evans'])]);
        expect(box).toMatchObject({ gameId: 500, pace: 66,
            home: { teamId: 1, points: 75, byPeriod: [32, 43], tovPct: 15.2, threeMade: 9, threeAtt: 23 },
            away: { teamId: 2, points: 60, byPeriod: [33, 27] } });
        expect(box.home.players.map(p => p.name)).toEqual(['Isaiah Evans']);
        expect(box.away.players.map(p => p.name)).toEqual(['Dailyn Swain']);
        expect(box.home.players[0]).toMatchObject({ starter: true, rebounds: 5, threeMade: 4, threeAtt: 8 });
    });

    test('a row from the AWAY team\'s point of view still lands each side right', () => {
        const box = boxScore.buildBox(GAME, [teamRow(500, 2, 1, sideStats(60, [33, 27]), sideStats(75, [32, 43]))], []);
        expect(box.home).toMatchObject({ teamId: 1, points: 75, players: [] });
        expect(box.away).toMatchObject({ teamId: 2, points: 60 });
    });

    test('a side with no stats at all comes out empty, not broken', () => {
        expect(boxScore.slimSide(1, undefined, undefined)).toMatchObject({ teamId: 1, byPeriod: [], points: undefined, players: [] });
        expect(boxScore.slimSide(1, { points: { total: '' } }, [{ name: '' }, null, { name: 'X', rebounds: null }]))
            .toMatchObject({ points: undefined, players: [{ name: 'X', rebounds: undefined, fgMade: undefined }] });
        expect(boxScore.buildBox(GAME, null, null)).toBeNull();
    });

    test('no row for this game: null, so nothing half-built is stored', () => {
        expect(boxScore.buildBox(GAME, [teamRow(999, 1, 7, sideStats(1, []), sideStats(0, []))], [])).toBeNull();
    });
});

describe('ingestRecent (the nightly batch)', () => {
    test('two calls for the whole window — by season and dates, never gameId — and each final game stored', async () => {
        await HoopsGame.create([GAME,
            Object.assign({}, GAME, { id: 501, startDate: new Date(Date.UTC(2026, 10, 19)) })]);    // final, no CBBD row
        const get = stubCbbd();
        const out = await boxScore.ingestRecent(SEASON, { now: NOW });
        expect(out).toMatchObject({ season: SEASON, games: 2, stored: 1, capped: false });
        expect(get).toHaveBeenCalledTimes(2);
        expect(get.mock.calls.map(c => c[0]).sort()).toEqual(['/games/players', '/games/teams']);
        expect(get.mock.calls[0][1]).toEqual({ season: SEASON, startDateRange: '2026-11-17', endDateRange: '2026-11-20' });
        const stored = await HoopsBoxScore.findOne({ gameId: 500 }).lean();
        expect(stored.home.players.map(p => p.name)).toEqual(['Isaiah Evans', 'Cameron Boozer']);
        expect(stored.away.players.map(p => p.name)).toEqual(['Dailyn Swain']);
        expect(await HoopsBoxScore.countDocuments({})).toBe(1);
    });

    test('a re-run refreshes rather than duplicating', async () => {
        await HoopsGame.create(GAME);
        stubCbbd();
        await boxScore.ingestRecent(SEASON, { now: NOW });
        await boxScore.ingestRecent(SEASON, { now: NOW });
        expect(await HoopsBoxScore.countDocuments({ gameId: 500 })).toBe(1);
    });

    test('nothing final in the lookback: no calls at all', async () => {
        await HoopsGame.create([
            Object.assign({}, GAME, { startDate: new Date(NOW - boxScore.LOOKBACK_MS - 1) }),         // too old
            Object.assign({}, GAME, { id: 502, status: 'scheduled', homePoints: null, awayPoints: null })
        ]);
        const get = stubCbbd();
        expect(await boxScore.ingestRecent(SEASON, { now: NOW })).toMatchObject({ games: 0, stored: 0, skippedReason: 'nothing final' });
        expect(get).not.toHaveBeenCalled();
    });

    test('a window at the 3,000-row cap is flagged, not trusted', async () => {
        await HoopsGame.create(GAME);
        jest.spyOn(cbbd, 'cbbdGet').mockImplementation(async (path) => (path === '/games/teams'
            ? { data: Array.from({ length: cbbd.PAGE_CAP }, (_, i) => teamRow(i === 0 ? 500 : 10000 + i, 1, 2, sideStats(75, []), sideStats(60, []))) }
            : { data: [] }));
        expect(await boxScore.ingestRecent(SEASON, { now: NOW })).toMatchObject({ capped: true, stored: 1 });
    });

    test('a CBBD failure throws, so the job records it', async () => {
        await HoopsGame.create(GAME);
        stubCbbd({ fail: true });
        await expect(boxScore.ingestRecent(SEASON, { now: NOW })).rejects.toThrow('CBBD 503');
    });

    test('getBox reads what is stored, and never calls CBBD', async () => {
        const get = stubCbbd();
        expect(await boxScore.getBox(500)).toBeNull();
        await HoopsBoxScore.create({ gameId: 500, season: SEASON, home: { teamId: 1, points: 75 }, away: { teamId: 2, points: 60 } });
        expect((await boxScore.getBox(500)).home.points).toBe(75);
        expect(get).not.toHaveBeenCalled();
    });
});

describe('currentWeek', () => {
    test('a "final" row with no score does not move the season\'s week', async () => {
        await HoopsGame.create([
            Object.assign({}, GAME, { id: 800, week: 3 }),
            Object.assign({}, GAME, { id: 801, week: 11, homePoints: null, awayPoints: null })    // marked final, never scored
        ]);
        expect(await teamPage.currentWeek(SEASON)).toBe(3);
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

    test('each side reads the game from its OWN point of view; the box is the stored one', async () => {
        const get = stubCbbd();
        await HoopsBoxScore.create({ gameId: 500, season: SEASON, home: { teamId: 1, points: 75 }, away: { teamId: 2, points: 60 } });
        const p = await gamePage.build(500);
        expect(get).not.toHaveBeenCalled();                  // the page never calls CBBD
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

    test('the viewer\'s own team is flagged — and no account id reaches the payload', async () => {
        stubCbbd();
        const a = await Account.create({ firstName: 'Garrett', lastName: 'G', email: 'g2@example.invalid' });
        await Franchise.create({ accountId: a._id, league: LEAGUE, seasons: [{ season: SEASON, franchiseName: 'Hoop Dreams', teamRefs: [{ id: 2, sport: 'basketball' }] }] });
        const p = await gamePage.build(500, { league: LEAGUE, viewerId: String(a._id) });
        expect(p.away.owner).toEqual({ franchiseName: 'Hoop Dreams', firstName: 'Garrett', mine: true });
        expect((await gamePage.build(500, { league: LEAGUE, viewerId: 'someone-else' })).away.owner.mine).toBe(false);
        expect((await gamePage.build(500, { league: LEAGUE })).away.owner.mine).toBe(false);
        expect(JSON.stringify(p)).not.toContain(String(a._id));
    });

    test('a postseason game has no quadrant on either side', async () => {
        await HoopsGame.updateOne({ id: 500 }, { $set: { seasonType: 'postseason', tournament: 'NCAA' } });
        stubCbbd();
        const p = await gamePage.build(500);
        expect([p.home.quadrant, p.away.quadrant]).toEqual([null, null]);
        expect(p.game).toMatchObject({ postseason: true, tournament: 'NCAA' });
    });

    test('a game still to play: no score and no box — but the record going in', async () => {
        const get = stubCbbd();
        await HoopsGame.updateOne({ id: 500 }, { $set: { status: 'scheduled', homePoints: null, awayPoints: null } });
        const p = await gamePage.build(500);
        expect(p.game.final).toBe(false);
        expect([p.home.points, p.box]).toEqual([null, null]);
        expect(p.home.record).toEqual({ w: 0, l: 1 });       // lost game 400 before this one
        expect(get).not.toHaveBeenCalled();
    });

    test('in progress: the running score, half and clock — and nothing banked', async () => {
        await HoopsGame.updateOne({ id: 500 }, { $set: { status: 'in_progress', homePoints: 41, awayPoints: 38, period: 2, clock: '8:43' } });
        const p = await gamePage.build(500);
        expect(p.game).toMatchObject({ final: false, live: true, period: 2, clock: '8:43' });
        expect([p.home.points, p.away.points, p.box]).toEqual([41, 38, null]);
        expect(p.preview).not.toBeNull();
    });

    test('a final game with nothing stored yet: no box, and still no CBBD call', async () => {
        const get = stubCbbd();
        const p = await gamePage.build(500);
        expect(p.box).toBeNull();
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

    test('passes the signed-in viewer to the page', async () => {
        const spy = jest.spyOn(gamePage, 'build').mockResolvedValue({ ok: true });
        const asUser = express();
        asUser.use((req, _res, next) => { req.effUser = { user_metadata: { metadata: { userId: 'acct-1' } } }; next(); });
        asUser.use('/hoops/games', require('../routes/hoopsGames'));
        await request(asUser).get('/hoops/games/500/page');
        expect(spy).toHaveBeenCalledWith(500, { league: LEAGUE, viewerId: 'acct-1' });
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

describe('homeWinProb', () => {
    const { homeWinProb, log5 } = require('../modules/hoops-win-prob');
    test('log5 of equals is a coin flip; home court tilts it; neutral does not', () => {
        expect(log5(0.5, 0.5)).toBeCloseTo(0.5);
        expect(homeWinProb(0.5, 0.5, true)).toBeCloseTo(0.5);
        expect(homeWinProb(0.5, 0.5, false)).toBeCloseTo(0.583, 3);
        expect(homeWinProb(0.9629, 0.8793, true)).toBeCloseTo(0.782, 2);   // Duke vs Georgia
    });
    test('a missing or impossible rating gives no number rather than a wrong one', () => {
        expect(homeWinProb(null, 0.5, false)).toBeNull();
        expect(homeWinProb(0.5, 1, false)).toBeNull();
        expect(homeWinProb(0, 0.5, false)).toBeNull();
    });
});

describe('a stale listing of a rescheduled game (#498)', () => {
    const COPY = Object.assign({}, GAME, { id: 501, status: 'scheduled', homePoints: null, awayPoints: null,
        startDate: new Date(Date.UTC(2026, 10, 15)) });

    test('points at the played game instead of previewing one that will never tip', async () => {
        await HoopsGame.create([GAME, COPY]);
        const p = await gamePage.build(501, { now: NOW });
        expect(p.rescheduled).toEqual({ id: 500, startDate: GAME.startDate, startTimeTbd: false });
        expect(p.preview).toBeNull();
    });

    test('a listing still inside the grace window previews as normal', async () => {
        await HoopsGame.create([GAME, COPY]);
        const p = await gamePage.build(501, { now: Date.UTC(2026, 10, 16) });
        expect(p.rescheduled).toBeNull();
        expect(p.preview).not.toBeNull();
    });

    test('the played game itself is not "rescheduled"', async () => {
        await HoopsGame.create([GAME, COPY]);
        expect((await gamePage.build(500, { now: NOW })).rescheduled).toBeNull();
    });
});

describe('preview (a game still to play)', () => {
    beforeEach(async () => {
        await HoopsTeam.updateOne({ id: 1, season: SEASON }, { $set: { 'preseason.barthag': 0.96, 'preseason.adjOE': 120, 'preseason.adjDE': 91 } });
        await HoopsTeam.updateOne({ id: 2, season: SEASON }, { $set: { 'preseason.barthag': 0.80, 'preseason.adjOE': 112, 'preseason.adjDE': 98 } });
        await HoopsGame.create([
            Object.assign({}, GAME, { id: 400, week: 1, startDate: new Date(Date.UTC(2026, 10, 4)), homeTeamId: 2, awayTeamId: 1, homePoints: 70, awayPoints: 80, neutralSite: false }),   // earlier meeting, Duke won at Texas
            Object.assign({}, GAME, { id: 401, week: 1, startDate: new Date(Date.UTC(2026, 10, 6)), homeTeamId: 1, awayTeamId: 9, homePoints: 60, awayPoints: 61, neutralSite: false }),   // Duke loses at home
            Object.assign({}, GAME, { id: 500, status: 'scheduled', homePoints: null, awayPoints: null }),
            Object.assign({}, GAME, { id: 600, week: 9, startDate: new Date(Date.UTC(2026, 11, 20)), homeTeamId: 1, awayTeamId: 9, homePoints: 90, awayPoints: 50, neutralSite: false })     // AFTER this game: must not count
        ]);
    });

    test('records, form and streak going INTO the game — later results do not count', async () => {
        const p = await gamePage.build(500);
        expect(p.home.record).toEqual({ w: 1, l: 1 });
        expect(p.preview.home).toMatchObject({ record: { w: 1, l: 1 }, roadRecord: { w: 1, l: 0 }, streak: { won: false, n: 1 } });
        expect(p.preview.home.last5.map(g => g.won)).toEqual([true, false]);
        expect(p.preview.away.record).toEqual({ w: 0, l: 1 });
    });

    test('win probability from both barthags, neutral floor', async () => {
        const p = await gamePage.build(500);
        expect(p.preview.homeWinProb).toBeCloseTo(require('../modules/hoops-win-prob').homeWinProb(0.96, 0.80, true), 6);
    });

    test('earlier meetings this season, from the home side\'s view', async () => {
        const p = await gamePage.build(500);
        expect(p.preview.meetings).toEqual([expect.objectContaining({ id: 400, homeScore: 80, awayScore: 70, venue: 'away' })]);
    });

    test('season stats and top scorers when imported', async () => {
        const HoopsTeamStats = require('../models/hoopsTeamStats');
        await HoopsTeamStats.create({ season: SEASON, teamId: 1, games: 10, pace: 68, team: { points: 800, efgPct: 55, tovRatio: 0.15 }, opponent: { points: 650 },
            players: [{ name: 'Bench', games: 10, points: 40 }, { name: 'Star', games: 10, points: 200, rebounds: 50, assists: 30 }, { name: 'DNP', games: 0, points: 0 }] });
        const p = await gamePage.build(500);
        expect(p.preview.home.stats).toMatchObject({ games: 10, ppg: 80, oppPpg: 65, efgPct: 55 });
        expect(p.preview.home.stats.tovPct).toBeCloseTo(15);
        expect(p.preview.home.topScorers.map(x => x.name)).toEqual(['Star', 'Bench']);
        expect(p.preview.home.topScorers[0]).toMatchObject({ ppg: 20, rpg: 5, apg: 3 });
        expect(p.preview.away.stats).toBeNull();
    });

    test('a final game has no preview; a non-D-I side has none for its half', async () => {
        expect((await gamePage.build(400)).preview).toBeNull();
        await HoopsGame.updateOne({ id: 500 }, { $set: { awayTeamId: 9999 } });
        const p = await gamePage.build(500);
        expect(p.preview.away).toBeNull();
        expect(p.preview.homeWinProb).toBeNull();
    });
});
