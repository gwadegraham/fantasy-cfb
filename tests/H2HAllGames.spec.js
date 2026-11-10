/**
 * @jest-environment node
 */
// "Show all games" on a settled H2H matchup card.
//
// A final week's card lists only the games that scored, so a manager whose
// team lost (0 points) had no way to see that game on the card at all. The
// card now has a button that swaps in EVERY game each side's teams played that
// week. The lists load on demand (GET /standings/h2h/...?allGames=<week>) —
// shipping them for every week would add over a thousand rows a basketball
// season to a payload almost nobody opens them from.
//
// Pinned here:
//   - ?allGames=<week> answers aAll/bAll for that settled week: every game, in
//     tip order, 0-point games included, with opponent / H-@-N / score / Captain
//   - it builds only that week and carries no odds (the fast path)
//   - the default and fast payloads carry no aAll (the payload stays lean)
//   - an unplayed week answers no aAll: live and upcoming cards are unchanged
//   - the same on a basketball league (hoopsgames, "N" at a neutral floor)
//   - the card draws the button only on a final card, and the lists only when
//     asked (public/h2h-card.js)

process.env.YEAR = '2026';

const fs = require('fs');
const path = require('path');
const express = require('express');
const request = require('supertest');
const { useMongo, mirrorUsers } = require('./helpers/mongo');
const User = require('../models/user');
const Game = require('../models/game');
const Team = require('../models/team');
const ScoringConfig = require('../models/scoringConfig');

// The card is browser code; run it against a minimal window.
const loadCard = () => {
    const window = {};
    new Function('window', fs.readFileSync(path.join(__dirname, '..', 'public', 'h2h-card.js'), 'utf8'))(window);
    return window.ccH2H;
};

const app = express();
app.use('/standings', require('../routes/standings'));

useMongo();

describe('GET /standings/h2h ?allGames on a football league', () => {
    const SEASON = 2026;
    const LEAGUE = 'graham-league';
    const OREGON = 1, USC = 2, DUKE = 3, MIAMI = 4;

    function rosterTeam(id, school) {
        return {
            id, school, mascot: 'Mascot', abbreviation: school.slice(0, 3).toUpperCase(),
            conference: 'SEC', color: '#000', logos: ['http://x/logo.png'],
            location: { venue_id: id, name: 'Stadium', city: 'City', state: 'ST', zip: '00000', latitude: 1, longitude: 1, capacity: 100, grass: true, dome: false }
        };
    }
    function game(id, week, homeId, awayId, startDate, { completed = true, homeWon = true } = {}) {
        return {
            id, season: SEASON, week, seasonType: 'regular',
            startDate, startTimeTbd: false, neutralSite: false, conferenceGame: false,
            homeId, homeTeam: 'Home' + homeId, awayId, awayTeam: 'Away' + awayId,
            homePoints: completed ? (homeWon ? 40 : 3) : null, awayPoints: completed ? (homeWon ? 3 : 40) : null, completed
        };
    }

    let ann;
    beforeEach(async () => {
        await ScoringConfig.create({
            league: LEAGUE, model: 'graham', values: {},
            engagementBySeason: { '2026': { h2hEnabled: true, h2hWinBonus: 3, h2hTieBonus: 0, captainEnabled: true, captainMultiplier: 2 } }
        });
        await Team.create([[OREGON, 'Oregon'], [USC, 'USC'], [DUKE, 'Duke'], [MIAMI, 'Miami'], [97, 'Opp97'], [98, 'Opp98'], [99, 'Opp99'], [96, 'Opp96']]
            .map(([id, school]) => Object.assign(rosterTeam(id, school), {
                seasons: [{ season: SEASON, conference: 'SEC', spRating: 5, expectedWins: 6 }]
            })));
        // Week 1 is settled. Only Oregon scored; USC lost at home and Duke
        // lost on the road — both 0 points, so the default card leaves them
        // off. USC is Ann's Captain that week. Week 2 is still to play.
        ann = await User.create({
            firstName: 'Ann', lastName: 'Test', league: LEAGUE,
            seasons: [{
                season: SEASON,
                teams: [rosterTeam(OREGON, 'Oregon'), rosterTeam(USC, 'USC'), rosterTeam(DUKE, 'Duke')],
                captains: [{ week: 1, teamId: USC }],
                weeklyScore: [{ week: 1, season: 'regular', score: 8, scoreByTeam: [{ teamId: OREGON, team: 'Oregon', gameId: 101, score: 8 }] }],
                cumulativeScore: 8
            }]
        });
        await User.create({
            firstName: 'Bob', lastName: 'Test', league: LEAGUE,
            seasons: [{ season: SEASON, teams: [rosterTeam(MIAMI, 'Miami')],
                weeklyScore: [{ week: 1, season: 'regular', score: 0, scoreByTeam: [] }], cumulativeScore: 0 }]
        });
        await mirrorUsers();
        await Game.create([
            game(101, 1, OREGON, 99, '2026-09-05T23:30:00.000Z'),
            game(102, 1, USC, 98, '2026-09-03T23:00:00.000Z', { homeWon: false }),
            game(103, 1, 97, DUKE, '2026-09-04T23:00:00.000Z'),
            game(104, 1, MIAMI, 96, '2026-09-05T23:30:00.000Z', { homeWon: false }),
            game(201, 2, OREGON, 99, '2099-09-12T23:30:00.000Z', { completed: false }),
            game(202, 2, MIAMI, 96, '2099-09-12T23:30:00.000Z', { completed: false })
        ]);
    });

    const annSide = (c, key) => (String(c.aId) === String(ann._id) ? c['a' + key] : c['b' + key]);

    test('a settled week answers every game each side played, in tip order', async () => {
        const res = await request(app).get(`/standings/h2h/${LEAGUE}/${SEASON}?allGames=1`);
        expect(res.status).toBe(200);
        // Only the week asked for, with no odds.
        expect(res.body.schedule.map(s => s.week)).toEqual([1]);
        const c = res.body.schedule[0].games[0];
        expect(c.final).toBe(true);
        expect(c.winP).toBeNull();
        // The default list is untouched: only the scoring game.
        expect(annSide(c, 'Teams').map(t => t.school)).toEqual(['Oregon']);

        const all = annSide(c, 'All');
        expect(all.map(t => t.school)).toEqual(['USC', 'Duke', 'Oregon']);
        const usc = all[0], duke = all[1], oregon = all[2];
        expect(usc).toMatchObject({ score: 0, status: 'final', ha: 'vs', opp: 'OPP', gameScore: '3–40', gameId: 102, captain: true });
        expect(duke).toMatchObject({ score: 0, status: 'final', ha: '@', opp: 'OPP', gameScore: '3–40', gameId: 103, captain: false });
        expect(oregon).toMatchObject({ score: 8, status: 'final', ha: 'vs', gameScore: '40–3', gameId: 101 });
        all.forEach(t => expect(t).not.toHaveProperty('tip'));
        // The other side too: Bob's one game, a 0-point loss.
        const bob = String(c.aId) === String(ann._id) ? c.bAll : c.aAll;
        expect(bob.map(t => [t.school, t.score, t.ha])).toEqual([['Miami', 0, 'vs']]);
    });

    test('the default and fast payloads carry no all-games lists', async () => {
        for (const q of ['', '?standingsOnly=1']) {
            const res = await request(app).get(`/standings/h2h/${LEAGUE}/${SEASON}${q}`);
            res.body.schedule.forEach(w => w.games.forEach(c => {
                expect(c).not.toHaveProperty('aAll');
                expect(c).not.toHaveProperty('bAll');
            }));
        }
    });

    test('an unplayed week answers no all-games lists (live and upcoming cards are unchanged)', async () => {
        const res = await request(app).get(`/standings/h2h/${LEAGUE}/${SEASON}?allGames=2`);
        expect(res.body.schedule.map(s => s.week)).toEqual([2]);
        const c = res.body.schedule[0].games[0];
        expect(c.upcoming).toBe(true);
        expect(c).not.toHaveProperty('aAll');
        expect(annSide(c, 'Teams').map(t => t.status)).toEqual(['scheduled']);
    });

    test('a junk week is ignored, not an error', async () => {
        const res = await request(app).get(`/standings/h2h/${LEAGUE}/${SEASON}?allGames=abc`);
        expect(res.status).toBe(200);
        res.body.schedule.forEach(w => w.games.forEach(c => expect(c).not.toHaveProperty('aAll')));
    });
});

describe('GET /standings/h2h ?allGames on a basketball league', () => {
    const { scoreHoopsWeek } = require('../modules/hoops-scoring-pass');
    const HoopsGame = require('../models/hoopsGame');
    const HoopsTeam = require('../models/hoopsTeam');
    const Franchise = require('../models/franchise');
    const Account = require('../models/account');
    const League = require('../models/league');
    const SportSeason = require('../models/sportSeason');
    const seasons = require('../modules/active-season');

    const LEAGUE = 'hoops-league';
    const SEASON = 2027;
    const ELITE = 50, NOBODY = 60;
    let gameId = 1000;
    function game(week, homeId, awayId, day, { homeWon = true, ...o } = {}) {
        gameId += 1;
        return Object.assign({
            id: gameId, season: SEASON, week, seasonType: 'regular', status: 'final',
            startDate: new Date(Date.UTC(2026, 10, 2 + day, 0, 0)),
            homeTeamId: homeId, awayTeamId: awayId,
            homePoints: homeWon ? 80 : 70, awayPoints: homeWon ? 70 : 80,
            neutralSite: false, conferenceGame: false
        }, o);
    }
    async function manager(name, teamIds) {
        const a = await Account.create({ firstName: name, lastName: 'M', email: `${name}@example.invalid` });
        await Franchise.create({
            accountId: a._id, league: LEAGUE,
            seasons: [{ season: SEASON, franchiseName: name, teamRefs: teamIds.map(id => ({ id, sport: 'basketball' })) }]
        });
        return a;
    }

    beforeEach(async () => {
        await League.create({ code: LEAGUE, name: 'Hardwood Heroes', sport: 'basketball' });
        await SportSeason.create([
            { sport: 'football', season: 2026, status: 'in-season' },
            { sport: 'basketball', season: SEASON, status: 'in-season' }
        ]);
        await seasons.prime();
        await HoopsTeam.create([
            { id: 1, season: SEASON, school: 'Team 1', abbreviation: 'T1', preseason: { rank: 101, barthag: 0.5 } },
            { id: 2, season: SEASON, school: 'Team 2', abbreviation: 'T2', preseason: { rank: 102, barthag: 0.5 } },
            { id: 3, season: SEASON, school: 'Team 3', abbreviation: 'T3', preseason: { rank: 103, barthag: 0.5 } },
            { id: ELITE, season: SEASON, school: 'Elite', abbreviation: 'ELT', preseason: { rank: 5, barthag: 0.9 } },
            { id: NOBODY, season: SEASON, school: 'Nobody', abbreviation: 'NOB', preseason: { rank: 340, barthag: 0.5 } }
        ]);
        await ScoringConfig.updateOne({ league: LEAGUE }, { $set: {
            league: LEAGUE, enabled: ['badLoss'], [`engagementBySeason.${SEASON}`]: { h2hEnabled: true, h2hWinBonus: 5, h2hTieBonus: 0 }
        } }, { upsert: true });
        jest.spyOn(console, 'log').mockImplementation(() => {});
    });
    afterEach(() => { seasons._reset(); jest.restoreAllMocks(); });

    test('every game, 0-point ones included, in tip order with N at a neutral floor', async () => {
        const ann = await manager('Ann', [1]);
        await manager('Bo', [2]);
        // Ann: a Q1 win over #5 (scores), then a Q4 win over a nobody at a
        // neutral floor (0), listed out of tip order on purpose.
        await HoopsGame.create([
            game(1, 1, NOBODY, 4, { neutralSite: true }),
            game(1, 1, ELITE, 1),
            game(1, 2, NOBODY, 2)
        ]);
        await scoreHoopsWeek(LEAGUE, { season: SEASON, week: 1 });

        const res = await request(app).get(`/standings/h2h/${LEAGUE}/${SEASON}?allGames=1`);
        expect(res.body.sport).toBe('basketball');
        const c = res.body.schedule.find(s => s.week === 1).games[0];
        expect(c.final).toBe(true);
        const mine = String(c.aId) === String(ann._id);
        const annTeams = mine ? c.aTeams : c.bTeams;
        const annAll = mine ? c.aAll : c.bAll;
        expect(annTeams.filter(t => t.score > 0).map(t => t.opp)).toEqual(['ELT']);
        expect(annAll.map(t => [t.ha, t.opp, t.score > 0])).toEqual([['vs', 'ELT', true], ['N', 'NOB', false]]);
        expect(annAll[1].score).toBe(0);
        const boAll = mine ? c.bAll : c.aAll;
        expect(boAll.map(t => [t.ha, t.opp, t.score])).toEqual([['vs', 'NOB', 0]]);
    });

    // full-court-depressed, 2027 week 1: a -1 week whose expanded card showed
    // one +1 row, because the card kept only score > 0. A penalised loss is
    // part of the total, so it is on the card by default; the rows the card
    // DRAWS add up to the score in its header.
    test('a negative game shows by default, and the drawn rows sum to the week score', async () => {
        const ann = await manager('Ann', [1, 3]);
        await manager('Bo', [2]);
        await HoopsGame.create([
            game(1, 1, ELITE, 1),                         // Q1 win: scores
            game(1, 3, NOBODY, 2, { homeWon: false }),    // home loss to a nobody: penalised
            game(1, 1, NOBODY, 3),                        // Q4 win: 0
            game(1, 2, NOBODY, 2)
        ]);
        await scoreHoopsWeek(LEAGUE, { season: SEASON, week: 1 });

        const res = await request(app).get(`/standings/h2h/${LEAGUE}/${SEASON}`);
        const c = res.body.schedule.find(s => s.week === 1).games[0];
        const mine = String(c.aId) === String(ann._id);
        const annScore = mine ? c.aScore : c.bScore;
        const annTeams = mine ? c.aTeams : c.bTeams;
        expect(annTeams.some(t => t.score < 0)).toBe(true);

        // Ann on the left, as My Team draws it; read her column's values.
        const byId = { [c.aId]: { franchise: 'A' }, [c.bId]: { franchise: 'B' } };
        const html = loadCard().matchupCard(c, { byId, youId: String(ann._id) });
        const leftCol = html.split('<div class="h2h-mdcol right">')[0].split('<div class="h2h-mdcol">')[1];
        const drawn = [...leftCol.matchAll(/<span class="h2h-tv">(-?[\d.]+)<\/span>/g)].map(m => Number(m[1]));
        expect(drawn.some(v => v < 0)).toBe(true);
        expect(drawn).not.toContain(0);
        expect(drawn.reduce((a, b) => a + b, 0)).toBeCloseTo(annScore, 5);
    });
});

describe('the card\'s "Show all games" button (public/h2h-card.js)', () => {
    const BY_ID = { u1: { franchise: 'Big Mac', initials: 'AT' }, u2: { franchise: 'Next Year', initials: 'BR' } };
    const row = (school, score, o) => Object.assign({ teamId: school.length, school, abbr: school.slice(0, 3).toUpperCase(), logo: '',
        score, status: 'final', opp: 'OPP', ha: 'vs', gameScore: '3–40', captain: false }, o);
    const finalCard = (o) => Object.assign({ aId: 'u1', bId: 'u2', aScore: 8, bScore: 0,
        aTeams: [row('Oregon', 8)], bTeams: [], winner: 'a', winP: null, final: true, upcoming: false }, o);
    const ALL = { aAll: [row('USC', 0, { captain: true, ha: '@' }), row('Oregon', 8)], bAll: [row('Miami', 0)] };
    const schools = (html) => [...html.matchAll(/class="tnm-full">([^<]*)</g)].map(m => m[1]);
    const btn = (html) => (html.match(/<button[^>]*data-all-toggle[^>]*>([^<]*)<\/button>/) || [])[1];

    test('a final card shows the scored games and a "Show all games" button', () => {
        const html = loadCard().matchupCard(finalCard(ALL), { byId: BY_ID, allGames: true });
        expect(btn(html)).toBe('Show all games');
        expect(html).toContain('aria-pressed="false"');
        expect(schools(html)).toEqual(['Oregon']);
        expect(html).toContain('no points');
    });

    test('switched on, it draws every game for both sides, 0s and Captain included', () => {
        const html = loadCard().matchupCard(finalCard(ALL), { byId: BY_ID, allGames: true, showAll: true });
        expect(btn(html)).toBe('Show scored only');
        expect(html).toContain('aria-pressed="true"');
        expect(schools(html)).toEqual(['USC', 'Oregon', 'Miami']);
        expect(html).toContain('<span class="h2h-tv">0</span>');
        expect(html).toContain('h2h-capx');
        expect(html).toContain('@ OPP');
        expect(html).not.toContain('no points');
    });

    test('a negative game is on the card by default; only 0-point games wait for the button', () => {
        const html = loadCard().matchupCard(finalCard({ aScore: -1,
            aTeams: [row('UNCW', 1), row('Duke', -2), row('Iowa', 0)] }), { byId: BY_ID, allGames: true });
        expect(schools(html)).toEqual(['UNCW', 'Duke']);
        expect(html).toContain('<span class="h2h-tv">-2</span>');
    });

    test('switched on before the lists arrive, it keeps the scored view', () => {
        const html = loadCard().matchupCard(finalCard(), { byId: BY_ID, allGames: true, showAll: true });
        expect(schools(html)).toEqual(['Oregon']);
        expect(btn(html)).toBe('Show all games');
    });

    test('no button on a live or upcoming card, or where the caller did not ask (My Team)', () => {
        const card = loadCard();
        const live = finalCard({ final: false, winner: null, aTeams: [row('Oregon', null, { status: 'live' })] });
        expect(btn(card.matchupCard(live, { byId: BY_ID, allGames: true }))).toBeUndefined();
        expect(btn(card.matchupCard(Object.assign({}, live, { upcoming: true }), { byId: BY_ID, allGames: true }))).toBeUndefined();
        expect(btn(card.matchupCard(finalCard(ALL), { byId: BY_ID }))).toBeUndefined();
    });

    test('a flipped card (You on the left) flips the all-games lists with it', () => {
        const html = loadCard().matchupCard(finalCard(ALL), { byId: BY_ID, youId: 'u2', allGames: true, showAll: true });
        expect(schools(html)).toEqual(['Miami', 'USC', 'Oregon']);
    });
});
