// The basketball H2H win-probability bar (#310, PR 4 of the projection plan).
//
// #553 switched the bar OFF for basketball (winP null): with no projection, a
// live bar was built from final games alone and a side with one finished
// game against a side yet to play read 100% / 0%. These pin what replaced it:
//   - mid-week, an unplayed game is priced by the basketball engine (log5 on
//     barthag, home court 1.55, points from the real scoring engine on the
//     CURRENT ranks), so the bar is calibrated, not 100/0
//   - a finished week still shows its settled bar (from `winner`)
//   - Captain multiplies the captained team's games in the odds
//   - the opt-in bad-loss penalty reaches the odds (pointsIfLoss), including
//     a final game that banked negative points
//   - football's odds are untouched (matchupWinProb without pointsIfLoss)

const express = require('express');
const request = require('supertest');
const { useMongo } = require('./helpers/mongo');
const { scoreHoopsWeek } = require('../modules/hoops-scoring-pass');
const { matchupWinProb } = require('../modules/h2h');
const { hoopsProjByWeek, fallbackEntry, currentRankWeek } = require('../modules/hoops-h2h-odds');
const { buildHoopsPoolContext, NON_D1_WIN_RATE, HOME_ODDS } = require('../modules/hoops-projection');
const { resolveConfig } = require('../modules/scoring-defaults');
const HoopsGame = require('../models/hoopsGame');
const HoopsTeam = require('../models/hoopsTeam');
const Game = require('../models/game');
const Team = require('../models/team');
const Franchise = require('../models/franchise');
const Account = require('../models/account');
const League = require('../models/league');
const SportSeason = require('../models/sportSeason');
const ScoringConfig = require('../models/scoringConfig');
const seasons = require('../modules/active-season');

useMongo();

const hoopsCfg = (o = {}) => resolveConfig('any-league', Object.assign({ model: 'hoops' }, o));
// P(home side wins) for two barthags, the engine's formula, by hand.
const homeP = (a, b) => {
    const base = (a * (1 - b)) / (a * (1 - b) + b * (1 - a));
    const odds = (base / (1 - base)) * HOME_ODDS;
    return odds / (1 + odds);
};

describe('matchupWinProb reads pointsIfLoss (pure)', () => {
    test('a penalised loss moves the odds; without pointsIfLoss nothing changes', () => {
        const a = [{ winProb: 1, pointsIfWin: 0 }];
        const b = [{ winProb: 0.6, pointsIfWin: 0 }];
        // Both always 0: an even matchup.
        expect(matchupWinProb(a, b).a).toBeCloseTo(0.5, 12);
        // B's loss costs 2: A wins whenever B loses, ties otherwise.
        const bPen = [{ winProb: 0.6, pointsIfWin: 0, pointsIfLoss: -2 }];
        expect(matchupWinProb(a, bPen).a).toBeCloseTo(0.4 + 0.6 / 2, 12);
    });

    test('football-shaped entries give exactly the numbers they always did', () => {
        const a = [{ winProb: 0.7, pointsIfWin: 12 }, { winProb: 0.4, pointsIfWin: 9 }];
        const b = [{ winProb: 0.55, pointsIfWin: 14 }];
        // P(A > B) by enumeration, ties split.
        const pa = [[0.3 * 0.6, 0], [0.7 * 0.6, 12], [0.3 * 0.4, 9], [0.7 * 0.4, 21]];
        const pb = [[0.45, 0], [0.55, 14]];
        let win = 0, tie = 0;
        pa.forEach(([p, s]) => pb.forEach(([q, t]) => { if (s > t) win += p * q; else if (s === t) tie += p * q; }));
        expect(matchupWinProb(a, b).a).toBe(matchupWinProb(a.map(e => Object.assign({}, e)), b).a);
        expect(matchupWinProb(a, b).a).toBeCloseTo(win + tie / 2, 12);
    });
});

describe('hoopsProjByWeek (pure)', () => {
    const cfg = hoopsCfg();
    const teams = [
        { id: 1, school: 'A', conference: 'X', preseason: { rank: 30, barthag: 0.8, projectedRecord: '20-10' } },
        { id: 2, school: 'B', conference: 'X', preseason: { rank: 10, barthag: 0.9, projectedRecord: '25-5' } },
        { id: 3, school: 'C', conference: 'Y', preseason: { rank: 200, barthag: 0.3, projectedRecord: '10-20' } }
        // id 9: a non-D-I opponent, no row at all
    ];
    const g = (id, week, home, away, o = {}) => Object.assign({
        id, week, season: 2027, seasonType: 'regular', status: 'scheduled', startDate: new Date(Date.UTC(2026, 10, week * 7)),
        homeTeamId: home, awayTeamId: away, neutralSite: false, conferenceGame: false
    }, o);
    const final = (id, week, home, away, homeWon) => g(id, week, home, away,
        { status: 'final', homePoints: homeWon ? 80 : 70, awayPoints: homeWon ? 70 : 80 });
    const ranks = { 1: 30, 2: 10, 3: 200 };

    test('a final game keeps its pre-game number; an unplayed one takes the remaining-schedule number', () => {
        // Three meetings with the same opponent, so only the calibration
        // target differs between the two numbers. Weeks 1/3/5: the same host
        // and visitor under 12 days apart is a duplicate listing
        // (dedupeListings) and would collapse into one.
        const games = [final(1, 1, 1, 3, false), g(2, 3, 1, 3), g(3, 5, 1, 3)];
        const out = hoopsProjByWeek({ teams, games, draftedIds: [1], cardGames: [], ranks, cfg });
        // Full season: Torvik's 20-10 rate over three games, 2/3 each.
        expect(out[1][1][1].winProb).toBeCloseTo(2 / 3, 6);
        // Remaining: the 0-1 start blended in at 1 / (1 + 30).
        const pace = (30 / 31) * (2 / 3);
        expect(out[3][1][2].winProb).toBeCloseTo(pace, 6);
        expect(out[5][1][3].winProb).toBeCloseTo(pace, 6);
        expect(out[3][1][2].pointsIfWin).toBe(0);    // over #200 at home: Q4
    });

    test('a card game the engine skipped (non-D-I opponent) still gets an entry', () => {
        const games = [g(5, 1, 1, 9)];
        const out = hoopsProjByWeek({ teams, games, draftedIds: [1],
            cardGames: [{ id: 5, week: 1, homeId: 1, awayId: 9 }], ranks, cfg });
        expect(out[1][1][5]).toEqual({ winProb: NON_D1_WIN_RATE, pointsIfWin: 0, pointsIfLoss: 0 });
    });

    test('no fallback for a dead row or the stale half of a duplicate listing', () => {
        // Two unplayed same-host listings 2 days apart (one game), and a
        // postponed row: the engine skips the stale twin and the dead row on
        // purpose, and the bar must not price them back in.
        // Against a rated opponent (the engine projects the kept twin) and an
        // unrated one (everything would be a fallback): both keep only the
        // newer listing.
        [3, 9].forEach(opp => {
            const twinA = g(11, 1, 1, opp, { startDate: new Date(Date.UTC(2026, 10, 7)) });
            const twinB = g(12, 1, 1, opp, { startDate: new Date(Date.UTC(2026, 10, 9)) });
            const dead = g(13, 1, 1, opp, { status: 'postponed', startDate: new Date(Date.UTC(2026, 11, 20)) });
            const card = [twinA, twinB, dead].map(x => ({ id: x.id, week: 1, homeId: 1, awayId: x.awayTeamId }));
            const out = hoopsProjByWeek({ teams, games: [twinA, twinB, dead], draftedIds: [1], cardGames: card, ranks, cfg });
            expect(Object.keys(out[1][1]).map(Number)).toEqual([12]);
        });
    });

    test('fallbackEntry: both rated uses log5; our own team unrated is a coin flip', () => {
        const ctx = buildHoopsPoolContext(teams, { ranks, cfg });
        expect(fallbackEntry(1, g(6, 1, 1, 2), ctx).winProb).toBeCloseTo(homeP(0.8, 0.9), 12);
        expect(fallbackEntry(9, g(7, 1, 9, 2), ctx).winProb).toBe(0.5);
    });

    test('bad-loss penalty on: an unplayed Q4 game carries a negative pointsIfLoss', () => {
        const on = hoopsCfg({ enabled: ['badLoss'] });
        const out = hoopsProjByWeek({ teams, games: [g(8, 1, 1, 3)], draftedIds: [1], cardGames: [], ranks, cfg: on });
        expect(out[1][1][8].pointsIfLoss).toBe(on.values.badLoss);
    });

    test('a drafted id with no HoopsTeam row is skipped, not thrown on', () => {
        expect(hoopsProjByWeek({ teams, games: [g(9, 1, 4, 1)], draftedIds: [4], cardGames: [], ranks, cfg })).toEqual({});
    });

    test('currentRankWeek: the first week with a game to play, else the last week', () => {
        expect(currentRankWeek([{ week: 1, completed: true }, { week: 3, completed: false }, { week: 2, completed: false }])).toBe(2);
        expect(currentRankWeek([{ week: 1, completed: true }, { week: 4, completed: true }])).toBe(4);
        expect(currentRankWeek([])).toBeNull();
        expect(currentRankWeek([{ week: null, completed: false }])).toBeNull();
    });
});

describe('GET /standings/h2h on a basketball league', () => {
    const LEAGUE = 'hoops-league';
    const SEASON = 2027;
    const ELITE = 50, NOBODY = 60;
    const app = express();
    app.use('/standings', require('../routes/standings'));

    let gameId = 1000;
    function game(week, homeId, awayId, { homeWon = true, status = 'final', startDate, ...o } = {}) {
        gameId += 1;
        return Object.assign({
            id: gameId, season: SEASON, week, seasonType: 'regular', status,
            startDate: startDate || new Date(Date.UTC(2026, 10, 2 + (week - 1) * 7 + 1, 0, 0)),
            homeTeamId: homeId, awayTeamId: awayId,
            homePoints: status === 'final' ? (homeWon ? 80 : 70) : null,
            awayPoints: status === 'final' ? (homeWon ? 70 : 80) : null,
            neutralSite: false, conferenceGame: false
        }, o);
    }
    const later = { status: 'scheduled', startDate: new Date('2099-01-01') };

    async function manager(name, teamIds, extra = {}) {
        const a = await Account.create({ firstName: name, lastName: 'M', email: `${name}@example.invalid` });
        await Franchise.create({
            accountId: a._id, league: LEAGUE,
            seasons: [Object.assign({ season: SEASON, franchiseName: name, teamRefs: teamIds.map(id => ({ id, sport: 'basketball' })) }, extra)]
        });
        return a;
    }
    async function modes({ captain = false, enabled } = {}) {
        const set = {
            league: LEAGUE,
            [`engagementBySeason.${SEASON}`]: { captainEnabled: captain, captainMultiplier: 2, h2hEnabled: true, h2hWinBonus: 3, h2hTieBonus: 0 }
        };
        if (enabled) set.enabled = enabled;
        await ScoringConfig.updateOne({ league: LEAGUE }, { $set: set }, { upsert: true });
    }
    // The matchup card for `week`, oriented so Ann is side A.
    async function annCard(annId, week) {
        const res = await request(app).get(`/standings/h2h/${LEAGUE}/${SEASON}`);
        expect(res.status).toBe(200);
        const wk = res.body.schedule.find(s => s.week === week);
        const c = wk.games[0];
        const flip = c.aId !== String(annId);
        return { wk, c, annP: c.winP == null ? null : (flip ? c.winP.b : c.winP.a) };
    }

    beforeEach(async () => {
        await League.create({ code: LEAGUE, name: 'Hardwood Heroes', sport: 'basketball' });
        await SportSeason.create([
            { sport: 'football', season: 2026, status: 'in-season' },
            { sport: 'basketball', season: SEASON, status: 'in-season' }
        ]);
        await seasons.prime();
        // Team 2 is an average side (barthag 0.5) with no projected record,
        // so nothing calibrates it and its odds are raw log5 + home court.
        await HoopsTeam.create([
            { id: 1, season: SEASON, school: 'Team 1', abbreviation: 'T1', preseason: { rank: 101, barthag: 0.5 } },
            { id: 2, season: SEASON, school: 'Team 2', abbreviation: 'T2', preseason: { rank: 102, barthag: 0.5 } },
            { id: ELITE, season: SEASON, school: 'Elite', abbreviation: 'ELT', preseason: { rank: 5, barthag: 0.9 } },
            { id: NOBODY, season: SEASON, school: 'Nobody', abbreviation: 'NOB', preseason: { rank: 340, barthag: 0.5 } }
        ]);
        // 130 basketball ids are football ids too. A football Team 2 that
        // always wins, playing in week 1: if anything here read football,
        // these rows would move the odds.
        await Team.create({ id: 2, school: 'Football Two', mascot: 'M', abbreviation: 'FB2', conference: 'SEC', color: '#000', logos: ['x'],
            location: { venue_id: 2, name: 'S', city: 'C', state: 'ST', zip: '0', latitude: 1, longitude: 1, capacity: 1, grass: true, dome: false } });
        await Game.create({ id: 77, season: SEASON, week: 1, seasonType: 'regular', startDate: '2099-01-01T00:00:00Z', startTimeTbd: false,
            neutralSite: false, conferenceGame: false, homeId: 2, homeTeam: 'Football Two', awayId: 1, awayTeam: 'Football One',
            homePoints: null, awayPoints: null, completed: false });
        jest.spyOn(console, 'log').mockImplementation(() => {});
    });
    afterEach(() => { seasons._reset(); jest.restoreAllMocks(); });

    test('mid-week, one side final and the other still to play: calibrated odds, not 100/0', async () => {
        await modes();
        const ann = await manager('Ann', [1]);
        await manager('Bo', [2]);
        // Ann banked a Q1 win (5). Bo hosts #5 later: 5 points if he wins it.
        await HoopsGame.create([game(1, 1, ELITE), game(1, 2, ELITE, later)]);
        await scoreHoopsWeek(LEAGUE, { season: SEASON, week: 1 });

        const { wk, annP } = await annCard(ann._id, 1);
        expect(wk.final).toBe(false);
        // Bo ties Ann (5-5) if he wins, else loses: Ann's chance is
        // 1 - p + p/2, p = P(a 0.5 side beats a 0.9 side at home).
        const p = homeP(0.5, 0.9);
        expect(annP).toBe(Math.round((1 - p / 2) * 100));
        expect(annP).toBeLessThan(100);
    });

    test('a pre-tip week shows pre-game odds from the engine', async () => {
        await modes();
        const ann = await manager('Ann', [1]);
        await manager('Bo', [2]);
        // Week 1 settled so the season has started; week 2 is all to play.
        await HoopsGame.create([game(1, 1, NOBODY), game(1, 2, NOBODY),
            game(2, 1, ELITE, later), game(2, 2, NOBODY, later)]);
        await scoreHoopsWeek(LEAGUE, { season: SEASON, week: 1 });
        const { wk, annP } = await annCard(ann._id, 2);
        expect(wk.upcoming).toBe(true);
        // Ann: 5 w.p. pE; Bo: 0 either way (a Q4 win). Ann wins when she
        // wins, ties otherwise.
        const pE = homeP(0.5, 0.9);
        expect(annP).toBe(Math.round((pE + (1 - pE) / 2) * 100));
    });

    test('a finished week still shows its settled result, with the pre-game line beside it', async () => {
        await modes();
        const ann = await manager('Ann', [1]);
        await manager('Bo', [2]);
        await HoopsGame.create([game(1, 1, ELITE), game(1, 2, NOBODY)]);
        await scoreHoopsWeek(LEAGUE, { season: SEASON, week: 1 });
        const { wk, c, annP } = await annCard(ann._id, 1);
        expect(wk.final).toBe(true);
        expect(c.winner).toBe(c.aId === String(ann._id) ? 'a' : 'b');   // the bar reads 100/0 from this
        // The retrospective pre-game odds: Ann hosted #5 (5 if won, p=pE),
        // Bo hosted a nobody (0 either way).
        const pE = homeP(0.5, 0.9);
        expect(annP).toBe(Math.round((pE + (1 - pE) / 2) * 100));
    });

    test('Captain doubles the captained team in the odds', async () => {
        await modes({ captain: true });
        const ann = await manager('Ann', [1], { captains: [{ week: 1, teamId: 1 }] });
        await manager('Bo', [2], { captains: [{ week: 1, teamId: 2 }] });
        // Ann's final Q1 win is 5, doubled to 10. Bo's unplayed Q1 is 5,
        // doubled to 10.
        await HoopsGame.create([game(1, 1, ELITE), game(1, 2, ELITE, later)]);
        await scoreHoopsWeek(LEAGUE, { season: SEASON, week: 1 });
        const { annP } = await annCard(ann._id, 1);
        const p = homeP(0.5, 0.9);
        // Both doubled: still a tie when Bo wins. If only Ann's were doubled
        // Ann would win outright every time (100); if only Bo's, Bo would
        // win whenever he wins (1 - p).
        expect(annP).toBe(Math.round((1 - p / 2) * 100));
    });

    test('Captain: a manual pick beats a frozen default for the same week', async () => {
        await modes({ captain: true });
        // Ann has two teams; her manual pick is team 3 (unplayed, hosts #5),
        // and a frozen auto row names team 1. Basketball scoring doubles the
        // manual pick, so the bar must too.
        await HoopsTeam.create({ id: 3, season: SEASON, school: 'Team 3', abbreviation: 'T3', preseason: { rank: 103, barthag: 0.5 } });
        const ann = await manager('Ann', [1, 3], { captains: [{ week: 1, teamId: 1, auto: true }, { week: 1, teamId: 3 }] });
        await manager('Bo', [2]);
        await HoopsGame.create([game(1, 1, NOBODY), game(1, 3, ELITE, later), game(1, 2, ELITE)]);
        await scoreHoopsWeek(LEAGUE, { season: SEASON, week: 1 });
        const { annP } = await annCard(ann._id, 1);
        // Bo banked 5, doubled by his auto-captain to 10. Ann: team 3
        // doubled is 10 w.p. p — a tie — else 0. Had the frozen row won,
        // team 3 would be worth 5 and Ann could never catch Bo (0%).
        const p = homeP(0.5, 0.9);
        expect(annP).toBe(Math.round(p / 2 * 100));
        expect(annP).toBeGreaterThan(0);
    });

    test('Captain: with no manual pick, the FROZEN default beats a fresh auto-captain', async () => {
        await modes({ captain: true });
        await HoopsTeam.create({ id: 3, season: SEASON, school: 'Team 3', abbreviation: 'T3', preseason: { rank: 103, barthag: 0.5 } });
        // Frozen at the lock: team 3. A fresh auto-captain (no prior weeks)
        // would be the first rostered team, team 1.
        const ann = await manager('Ann', [1, 3], { captains: [{ week: 1, teamId: 3, auto: true }] });
        await manager('Bo', [2]);
        await HoopsGame.create([game(1, 1, NOBODY), game(1, 3, ELITE, later), game(1, 2, ELITE)]);
        await scoreHoopsWeek(LEAGUE, { season: SEASON, week: 1 });
        const { annP } = await annCard(ann._id, 1);
        // Bo banked 5, doubled to 10. Ann: team 3 doubled is 10 w.p. p (a
        // tie), else 0. With team 1 doubled instead she could never catch Bo.
        const p = homeP(0.5, 0.9);
        expect(annP).toBe(Math.round(p / 2 * 100));
        expect(annP).toBeGreaterThan(0);
    });

    test('bad-loss penalty on: a negative final and a penalised unplayed game both count', async () => {
        await modes({ enabled: ['badLoss'] });
        const ann = await manager('Ann', [1]);
        await manager('Bo', [2]);
        // Ann lost at home to a nobody: -2, banked. Bo hosts the same nobody
        // later: 0 if he wins (Q4), -2 if he loses.
        await HoopsGame.create([game(1, 1, NOBODY, { homeWon: false }), game(1, 2, NOBODY, later)]);
        await scoreHoopsWeek(LEAGUE, { season: SEASON, week: 1 });
        const { annP } = await annCard(ann._id, 1);
        const p = homeP(0.5, 0.5);
        // Ann is certain at -2; she only draws level when Bo loses.
        expect(annP).toBe(Math.round((1 - p) / 2 * 100));
    });

    test('bad-loss penalty with Captain: a captained negative final is doubled too', async () => {
        await modes({ captain: true, enabled: ['badLoss'] });
        await HoopsTeam.create({ id: 4, season: SEASON, school: 'Team 4', abbreviation: 'T4', preseason: { rank: 104, barthag: 0.5 } });
        const ann = await manager('Ann', [1], { captains: [{ week: 1, teamId: 1 }] });
        // Bo captains team 4 (a 0-point Q4 win), so his team 2 is undoubled.
        await manager('Bo', [2, 4], { captains: [{ week: 1, teamId: 4 }] });
        await HoopsGame.create([game(1, 1, NOBODY, { homeWon: false }), game(1, 2, NOBODY, later), game(1, 4, NOBODY)]);
        await scoreHoopsWeek(LEAGUE, { season: SEASON, week: 1 });
        const { annP } = await annCard(ann._id, 1);
        const p = homeP(0.5, 0.5);
        // Ann is certain at -4; Bo is 0 if he wins, -2 if he loses: Ann can
        // never catch him. Undoubled, Ann's -2 would tie Bo's loss.
        expect(annP).toBe(0);
        expect(Math.round((1 - p) / 2 * 100)).toBeGreaterThan(0);
    });

    test('Captain on an unplayed penalised game doubles its loss too', async () => {
        await modes({ captain: true, enabled: ['badLoss'] });
        await HoopsTeam.create({ id: 4, season: SEASON, school: 'Team 4', abbreviation: 'T4', preseason: { rank: 104, barthag: 0.5 } });
        const ann = await manager('Ann', [1], { captains: [{ week: 1, teamId: 1 }] });
        // Bo captains team 4 (a 0-point Q4 win), so his -2 is NOT doubled.
        await manager('Bo', [2, 4], { captains: [{ week: 1, teamId: 4 }] });
        await HoopsGame.create([game(1, 1, NOBODY, later), game(1, 2, NOBODY, { homeWon: false }), game(1, 4, NOBODY)]);
        await scoreHoopsWeek(LEAGUE, { season: SEASON, week: 1 });
        const { annP } = await annCard(ann._id, 1);
        const p = homeP(0.5, 0.5);
        // Bo is certain at -2. Ann: 0 if she wins, -4 (doubled) if she
        // loses — so she wins exactly when her team does. Undoubled, a loss
        // would only tie (-2) and she would read p + (1 - p) / 2.
        expect(annP).toBe(Math.round(p * 100));
    });

    test('the dev-only in-progress preview answers odds on basketball too', async () => {
        await modes();
        const ann = await manager('Ann', [1]);
        await manager('Bo', [2]);
        // Both games are each side's first row, which the preview keeps
        // final: Ann's 5 against Bo's 0. Its live odds therefore read 100/0
        // — where the pre-game line it replaces is an even 50 (both host #5).
        await HoopsGame.create([game(1, 1, ELITE), game(1, 2, ELITE, { homeWon: false })]);
        await scoreHoopsWeek(LEAGUE, { season: SEASON, week: 1 });
        const res = await request(app).get(`/standings/h2h/${LEAGUE}/${SEASON}?h2hSim=mixed`);
        const c = res.body.schedule.find(s => s.week === res.body.featuredWeek).games[0];
        expect(c.aId === String(ann._id) ? c.winP.a : c.winP.b).toBe(100);
    });

    test('a neutral-site game gets no home court', async () => {
        await modes();
        const ann = await manager('Ann', [1]);
        await manager('Bo', [2]);
        await HoopsGame.create([game(1, 1, ELITE), game(1, 2, ELITE, Object.assign({ neutralSite: true }, later))]);
        await scoreHoopsWeek(LEAGUE, { season: SEASON, week: 1 });
        const { annP } = await annCard(ann._id, 1);
        // Plain log5, 0.5 against 0.9: 0.1. Neutral is Q1 against #5 too.
        expect(annP).toBe(Math.round((1 - 0.1 / 2) * 100));
    });

    test('a rank read that fails grades Q4 instead of failing the payload', async () => {
        await modes();
        const ann = await manager('Ann', [1]);
        await manager('Bo', [2]);
        await HoopsGame.create([game(1, 1, ELITE), game(1, 2, ELITE, later)]);
        await scoreHoopsWeek(LEAGUE, { season: SEASON, week: 1 });
        const ranks = require('../modules/hoops-ranks');
        jest.spyOn(ranks, 'ranksFor').mockRejectedValue(new Error('down'));
        jest.spyOn(console, 'error').mockImplementation(() => {});
        const { annP } = await annCard(ann._id, 1);
        // Unranked opponents: Bo's win is a Q4 0, so Ann's 5 stands.
        expect(annP).toBe(100);
    });

    test("a finished week's pre-game line keeps to the games on the card", async () => {
        await modes();
        const ann = await manager('Ann', [1]);
        await manager('Bo', [2]);
        // An unplayed listing a week overdue is off the card but still in the
        // projection's rows; it must not count.
        await HoopsGame.create([game(1, 1, NOBODY), game(1, 2, NOBODY),
            game(1, 1, ELITE, { status: 'scheduled', startDate: new Date('2026-01-01T00:00:00Z') })]);
        await scoreHoopsWeek(LEAGUE, { season: SEASON, week: 1 });
        const { wk, annP } = await annCard(ann._id, 1);
        expect(wk.final).toBe(true);
        expect(annP).toBe(50);   // both hosted a nobody: 0 either way
    });

    test('the fast standings-only payload still answers no odds', async () => {
        await modes();
        await manager('Ann', [1]);
        await manager('Bo', [2]);
        await HoopsGame.create([game(1, 1, ELITE), game(1, 2, ELITE, later)]);
        await scoreHoopsWeek(LEAGUE, { season: SEASON, week: 1 });
        const res = await request(app).get(`/standings/h2h/${LEAGUE}/${SEASON}?standingsOnly=1`);
        res.body.schedule.forEach(w => w.games.forEach(c => expect(c.winP).toBeNull()));
    });
});
