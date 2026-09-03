// HTTP tests for GET /games/scoreboard/:league/:season/:week against an
// in-memory Mongo. No CFBD seam here at all — the endpoint is a pure DB read by
// design, which is the property most worth pinning down: it must stay free to
// call every 30 seconds.

process.env.YEAR = '2026';

const express = require('express');
const request = require('supertest');
const { useMongo } = require('./helpers/mongo');
const Game = require('../models/game');
const User = require('../models/user');
const Team = require('../models/team');
const Ranking = require('../models/ranking');
const BettingLine = require('../models/bettingLine');
const Record = require('../models/record');
const gamesRouter = require('../routes/games');

const SEASON = 2026;
const LEAGUE = 'graham-league';
const OSU = 1, TEX = 2, BAMA = 3, WISC = 4;

const app = express();
app.use(express.json());
app.use('/games', gamesRouter);

useMongo();

function fullTeam(id, school, conference, classification) {
    return {
        id, school, mascot: 'Mascot', abbreviation: school.slice(0, 3).toUpperCase(),
        conference, classification: classification || 'fbs', color: '#000',
        logos: ['http://x/' + id + '-dark.png'],
        location: { venue_id: id, name: 'Stadium', city: 'City', state: 'ST', zip: '00000', latitude: 1, longitude: 1, capacity: 100, grass: true, dome: false }
    };
}

// Dates are anchored on the wall clock, not literals: whether a game reads as
// live is a function of "now", so a fixed date would make these tests pass in
// one week and fail in the next. Week 2 is deliberately the slate in progress.
const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;
const at = (ms) => new Date(Date.now() + ms).toISOString();
const W1 = at(-7 * DAY);
const W2_FINAL = at(-3 * HOUR);
const W2_LIVE = at(-1 * HOUR);
const W3 = at(7 * DAY);

function gameDoc(o) {
    return Object.assign({
        season: SEASON, week: 2, seasonType: 'regular',
        startDate: W2_FINAL, startTimeTbd: false,
        neutralSite: false, conferenceGame: false
    }, o);
}

// Week 1 in the past, week 2 the slate under test, week 3 ahead.
async function seed() {
    await Game.insertMany([
        gameDoc({ id: 300, week: 1, startDate: W1, completed: true,
            homeId: OSU, homeTeam: 'Ohio State', homeConference: 'Big Ten', homePoints: 40,
            awayId: WISC, awayTeam: 'Wisconsin', awayConference: 'Big Ten', awayPoints: 3 }),
        gameDoc({ id: 401, startDate: W2_FINAL, completed: true,
            homeId: OSU, homeTeam: 'Ohio State', homeConference: 'Big Ten', homePoints: 31,
            awayId: TEX, awayTeam: 'Texas', awayConference: 'SEC', awayPoints: 17,
            outlet: 'FOX' }),
        gameDoc({ id: 402, startDate: W2_LIVE, completed: false,
            homeId: BAMA, homeTeam: 'Alabama', homeConference: 'SEC', homePoints: 14,
            awayId: WISC, awayTeam: 'Wisconsin', awayConference: 'Big Ten', awayPoints: 10,
            period: 3, clock: '08:42', possession: 'Alabama' }),
        gameDoc({ id: 500, week: 3, startDate: W3,
            homeId: TEX, homeTeam: 'Texas', homeConference: 'SEC',
            awayId: BAMA, awayTeam: 'Alabama', awayConference: 'SEC' })
    ]);

    await Team.insertMany([
        fullTeam(OSU, 'Ohio State', 'Big Ten'), fullTeam(TEX, 'Texas', 'SEC'),
        fullTeam(BAMA, 'Alabama', 'SEC'), fullTeam(WISC, 'Wisconsin', 'Big Ten')
    ]);

    await Ranking.create({
        season: SEASON, seasonType: 'regular', week: 2,
        polls: [{ poll: 'AP Top 25', ranks: [{ rank: 3, school: 'Ohio State' }, { rank: 7, school: 'Texas' }] }]
    });

    await Record.insertMany([
        { year: SEASON, teamId: OSU, team: 'Ohio State', total: { wins: 3, losses: 1 } },
        { year: SEASON, teamId: BAMA, team: 'Alabama', total: { wins: 0, losses: 0 } }
    ]);

    await BettingLine.create({
        id: 402, season: SEASON, seasonType: 'regular', week: 2,
        homeTeam: 'Alabama', awayTeam: 'Wisconsin',
        lines: [
            { provider: 'Bovada', formattedSpread: 'Alabama -10', overUnder: 50 },
            { provider: 'DraftKings', formattedSpread: 'Alabama -9.5', overUnder: 51.5 }
        ]
    });

    await User.create({
        firstName: 'Garrett', lastName: 'Graham', league: LEAGUE, color: '#ed5858',
        seasons: [{
            season: SEASON, franchiseName: 'Gridiron Gang',
            teams: [fullTeam(OSU, 'Ohio State', 'Big Ten'), fullTeam(BAMA, 'Alabama', 'SEC')],
            weeklyScore: [{
                week: 2, score: 32,
                scoreByTeam: [
                    { team: 'Ohio State', teamId: OSU, gameId: 401, score: 18 },
                    { team: 'Alabama', teamId: BAMA, gameId: 402, score: 14 }
                ]
            }]
        }]
    });

    // A second league's manager owns Texas. Nothing of theirs may appear.
    await User.create({
        firstName: 'Other', lastName: 'Person', league: 'claunts-league', color: '#fff',
        seasons: [{
            season: SEASON, teams: [fullTeam(TEX, 'Texas', 'SEC')],
            weeklyScore: [{ week: 2, score: 9, scoreByTeam: [{ team: 'Texas', teamId: TEX, gameId: 401, score: 9 }] }]
        }]
    });
}

beforeEach(seed);

function get(path) {
    return request(app).get(path);
}

describe('week resolution', () => {
    test('an explicit week returns that slate, kickoff-ordered', async () => {
        const res = await get(`/games/scoreboard/${LEAGUE}/${SEASON}/2`);
        expect(res.status).toBe(200);
        expect(res.body.week).toBe(2);
        expect(res.body.games.map(g => g.id)).toEqual([401, 402]);
    });

    test('the week list spans the season so the picker can page', async () => {
        const res = await get(`/games/scoreboard/${LEAGUE}/${SEASON}/2`);
        expect(res.body.weeks).toEqual([1, 2, 3]);
    });

    test('omitting the week resolves one instead of erroring', async () => {
        const res = await get(`/games/scoreboard/${LEAGUE}/${SEASON}`);
        expect(res.status).toBe(200);
        expect([1, 2, 3]).toContain(res.body.week);
        expect(res.body.games.length).toBeGreaterThan(0);
    });

    test('a season with no games answers empty rather than 500', async () => {
        const res = await get(`/games/scoreboard/${LEAGUE}/1999`);
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ week: null, games: [], weeks: [], liveCount: 0 });
    });

    test('a non-numeric season is a 400', async () => {
        const res = await get(`/games/scoreboard/${LEAGUE}/nope`);
        expect(res.status).toBe(400);
    });
});

describe('league overlay', () => {
    test('drafted teams carry their owner and that game\'s points', async () => {
        const res = await get(`/games/scoreboard/${LEAGUE}/${SEASON}/2`);
        const g401 = res.body.games.find(g => g.id === 401);
        expect(g401.home.owner).toMatchObject({
            name: 'Garrett Graham', franchise: 'Gridiron Gang', initials: 'GG', points: 18
        });
        expect(g401.leagueGame).toBe(true);
    });

    test('another league\'s roster never leaks in', async () => {
        const res = await get(`/games/scoreboard/${LEAGUE}/${SEASON}/2`);
        const g401 = res.body.games.find(g => g.id === 401);
        expect(g401.away.owner).toBe(null);
    });

    test('the other league sees its own overlay on the same slate', async () => {
        const res = await get(`/games/scoreboard/claunts-league/${SEASON}/2`);
        const g401 = res.body.games.find(g => g.id === 401);
        expect(g401.home.owner).toBe(null);
        expect(g401.away.owner).toMatchObject({ name: 'Other Person', points: 9 });
    });

    test('the full slate is returned, not just the league\'s games', async () => {
        await Game.create(gameDoc({ id: 403, startDate: at(1 * HOUR),
            homeId: 90, homeTeam: 'Rice', homeConference: 'American',
            awayId: 91, awayTeam: 'Tulane', awayConference: 'American' }));
        const res = await get(`/games/scoreboard/${LEAGUE}/${SEASON}/2`);
        const g403 = res.body.games.find(g => g.id === 403);
        expect(g403).toBeDefined();
        expect(g403.leagueGame).toBe(false);
    });
});

describe('enrichment', () => {
    // Logos go through the shared pickLogo, which https-upgrades them — the
    // scoreboard must not be the one page that serves mixed content.
    test('AP ranks, logos and abbreviations are joined on', async () => {
        const res = await get(`/games/scoreboard/${LEAGUE}/${SEASON}/2`);
        const g401 = res.body.games.find(g => g.id === 401);
        expect(g401.home).toMatchObject({ rank: 3, abbr: 'OHI', logo: 'https://x/1-dark.png' });
        expect(g401.away.rank).toBe(7);
        expect(g401.ranked).toBe(true);
    });

    test('DraftKings wins when several books have a line', async () => {
        const res = await get(`/games/scoreboard/${LEAGUE}/${SEASON}/2`);
        const g402 = res.body.games.find(g => g.id === 402);
        expect(g402.spread).toBe('Alabama -9.5');
        expect(g402.overUnder).toBe(51.5);
    });

    test('conference options come from the week\'s own slate, with short labels', async () => {
        const res = await get(`/games/scoreboard/${LEAGUE}/${SEASON}/2`);
        expect(res.body.conferences).toEqual([
            { name: 'Big Ten', label: 'Big Ten' },
            { name: 'SEC', label: 'SEC' }
        ]);
    });

    test('a long conference name arrives abbreviated', async () => {
        await Team.insertMany([
            fullTeam(92, 'Boise State', 'Mountain West'),
            fullTeam(93, 'Memphis', 'American Athletic')
        ]);
        await Game.create(gameDoc({ id: 404, startDate: at(2 * HOUR),
            homeId: 92, homeTeam: 'Boise State', homeConference: 'Mountain West',
            awayId: 93, awayTeam: 'Memphis', awayConference: 'American Athletic' }));
        const res = await get(`/games/scoreboard/${LEAGUE}/${SEASON}/2`);
        const byName = Object.fromEntries(res.body.conferences.map(c => [c.name, c.label]));
        expect(byName['American Athletic']).toBe('AAC');
        expect(byName['Mountain West']).toBe('MWC');
    });

    // Week 1 puts a dozen FCS conferences on the slate because FCS teams are
    // the paid opponents. They are opponents, not part of the league's universe,
    // so they must not become something you can filter the slate down to.
    test('FCS conferences are kept out of the filter', async () => {
        await Team.create(fullTeam(94, 'Mercer', 'Southern', 'fcs'));
        await Game.create(gameDoc({ id: 405, startDate: at(3 * HOUR),
            homeId: OSU, homeTeam: 'Ohio State', homeConference: 'Big Ten',
            awayId: 94, awayTeam: 'Mercer', awayConference: 'Southern' }));
        const res = await get(`/games/scoreboard/${LEAGUE}/${SEASON}/2`);
        expect(res.body.conferences.map(c => c.name)).not.toContain('Southern');
        expect(res.body.conferences.map(c => c.name)).toContain('Big Ten');
    });

    // The FCS side still renders on its card — it just isn't a filter option.
    test('the FCS opponent still appears on the slate', async () => {
        await Team.create(fullTeam(94, 'Mercer', 'Southern', 'fcs'));
        await Game.create(gameDoc({ id: 405, startDate: at(3 * HOUR),
            homeId: OSU, homeTeam: 'Ohio State', homeConference: 'Big Ten',
            awayId: 94, awayTeam: 'Mercer', awayConference: 'Southern' }));
        const res = await get(`/games/scoreboard/${LEAGUE}/${SEASON}/2`);
        const g = res.body.games.find(x => x.id === 405);
        expect(g.away).toMatchObject({ team: 'Mercer', conference: 'Southern' });
    });

    test('the week carries its date range for the label', async () => {
        const res = await get(`/games/scoreboard/${LEAGUE}/${SEASON}/2`);
        expect(res.body.weekRange.first).toBe(W2_FINAL);
        expect(res.body.weekRange.last).toBe(W2_LIVE);
    });

    test('?live=1 skips the date range with the rest of the week chrome', async () => {
        const res = await get(`/games/scoreboard/${LEAGUE}/${SEASON}/2?live=1`);
        expect(res.body.weekRange).toBeUndefined();
    });
});

describe('records and spread', () => {
    test('a team record rides on the side it belongs to', async () => {
        const res = await get(`/games/scoreboard/${LEAGUE}/${SEASON}/2`);
        const g401 = res.body.games.find(g => g.id === 401);
        expect(g401.home.record).toBe('3-1');
        expect(g401.away.record).toBe(null);
    });

    test('a team with no games played yet reports 0-0', async () => {
        const res = await get(`/games/scoreboard/${LEAGUE}/${SEASON}/2`);
        const g402 = res.body.games.find(g => g.id === 402);
        expect(g402.home.record).toBe('0-0');
    });

    // The line belongs to one row, not to the card's meta line.
    test('the spread is attributed to the favoured side only', async () => {
        const res = await get(`/games/scoreboard/${LEAGUE}/${SEASON}/2`);
        const g402 = res.body.games.find(g => g.id === 402);
        expect(g402.home.line).toBe('-9.5');
        expect(g402.away.line).toBe(null);
    });

    test('a game with no line leaves both sides clear', async () => {
        const res = await get(`/games/scoreboard/${LEAGUE}/${SEASON}/2`);
        const g401 = res.body.games.find(g => g.id === 401);
        expect(g401.home.line).toBe(null);
        expect(g401.away.line).toBe(null);
    });
});

describe('live mode', () => {
    test('the full payload counts live games and keeps the finals', async () => {
        const res = await get(`/games/scoreboard/${LEAGUE}/${SEASON}/2`);
        expect(res.body.liveCount).toBe(1);
        expect(res.body.games).toHaveLength(2);
        const live = res.body.games.find(g => g.state === 'live');
        expect(live).toMatchObject({ id: 402, period: 3, clock: '08:42' });
        expect(live.home.possession).toBe(true);
    });

    test('?live=1 returns only the in-progress games', async () => {
        const res = await get(`/games/scoreboard/${LEAGUE}/${SEASON}/2?live=1`);
        expect(res.body.games.map(g => g.id)).toEqual([402]);
        expect(res.body.liveCount).toBe(1);
    });

    test('?live=1 still carries the owner overlay so a patch can repaint points', async () => {
        const res = await get(`/games/scoreboard/${LEAGUE}/${SEASON}/2?live=1`);
        expect(res.body.games[0].home.owner).toMatchObject({ initials: 'GG', points: 14 });
    });

    test('?live=1 skips the week list — the refresh loop never needs it', async () => {
        const res = await get(`/games/scoreboard/${LEAGUE}/${SEASON}/2?live=1`);
        expect(res.body.weeks).toBeUndefined();
        expect(res.body.conferences).toBeUndefined();
    });
});

describe('postseason', () => {
    test('seasonType selects the postseason slate', async () => {
        await Game.create(gameDoc({ id: 900, week: 1, seasonType: 'postseason',
            startDate: '2026-12-20T18:00:00.000Z',
            homeId: OSU, homeTeam: 'Ohio State', homeConference: 'Big Ten',
            awayId: TEX, awayTeam: 'Texas', awayConference: 'SEC' }));
        const res = await get(`/games/scoreboard/${LEAGUE}/${SEASON}/1?seasonType=postseason`);
        expect(res.body.games.map(g => g.id)).toEqual([900]);
        expect(res.body.seasonType).toBe('postseason');
    });
});
