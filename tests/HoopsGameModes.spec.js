// Captain and head-to-head on a basketball league, end to end: the scoring
// pass doubles the captain and banks the H2H bonus, the standings read model
// shows the same matchups, and football's own H2H pass leaves the basketball
// league alone.
//
// What the /hardwood page promised, and what each test below pins:
//   - Captain 2x: every game the captained team plays that week counts double
//     — but not a conference tournament game ("scored without them").
//   - A manager who never picks gets football's auto-captain.
//   - H2H +3: higher weekly total banks +3, a tie pays nothing, decided from
//     BASKETBALL games (130 team ids collide with football's).
//   - Conference tournament points are not part of the matchup.

const express = require('express');
const request = require('supertest');
const { useMongo } = require('./helpers/mongo');
const { scoreHoopsWeek } = require('../modules/hoops-scoring-pass');
const { applyHoopsH2H, modeWeekBase } = require('../modules/hoops-h2h');
const HoopsGame = require('../models/hoopsGame');
const HoopsTeam = require('../models/hoopsTeam');
const Game = require('../models/game');
const Franchise = require('../models/franchise');
const Account = require('../models/account');
const League = require('../models/league');
const SportSeason = require('../models/sportSeason');
const ScoringConfig = require('../models/scoringConfig');
const seasons = require('../modules/active-season');

useMongo();

const LEAGUE = 'hoops-league';
const SEASON = 2027;
// Team 50 is elite (#5): beating it at home is a Q1 win, 5 points. Team 60
// is a nobody: beating it is Q4, 0 points.
const ELITE = 50, NOBODY = 60;

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
// A home win over the elite team: 5 points.
const q1Win = (week, teamId, o) => game(week, teamId, ELITE, o);
// A home loss to a nobody: 0 points.
const loss = (week, teamId, o) => game(week, teamId, NOBODY, Object.assign({ homeWon: false }, o));
// A conference TOURNAMENT game, filed as regular season by CBBD.
const confTourney = (week, teamId) => game(week, teamId, ELITE, {
    conferenceGame: true, gameNotes: 'Big East Tournament - Quarterfinal'
});

async function manager(name, teamIds, extra = {}) {
    const a = await Account.create({ firstName: name, lastName: 'M', email: `${name}@example.invalid` });
    await Franchise.create({
        accountId: a._id, league: LEAGUE,
        seasons: [Object.assign({ season: SEASON, franchiseName: name, teamRefs: teamIds.map(id => ({ id, sport: 'basketball' })) }, extra)]
    });
    return a;
}

// Written the way PATCH /scoring-config/:league/engagement writes it: an
// upsert of one season's slot, with no scoring model on the document.
async function modes({ captain = false, h2h = false, tie = 0 } = {}) {
    await ScoringConfig.updateOne({ league: LEAGUE }, { $set: {
        league: LEAGUE,
        [`engagementBySeason.${SEASON}`]: {
            captainEnabled: captain, captainMultiplier: 2,
            h2hEnabled: h2h, h2hWinBonus: 3, h2hTieBonus: tie
        }
    } }, { upsert: true });
}

async function entry(accountId) {
    const f = await Franchise.findOne({ accountId, league: LEAGUE }).lean();
    return f.seasons.find(s => s.season === SEASON);
}
const weekOf = async (accountId, week) => (await entry(accountId)).weeklyScore.find(w => w.week === week);

beforeEach(async () => {
    await League.create({ code: LEAGUE, name: 'Hardwood Heroes', sport: 'basketball' });
    await SportSeason.create([
        { sport: 'football', season: 2026, status: 'in-season' },
        { sport: 'basketball', season: SEASON, status: 'in-season' }
    ]);
    await seasons.prime();
    await HoopsTeam.create([1, 2, 3, 4].map(id => ({ id, season: SEASON, school: `Team ${id}`, abbreviation: `T${id}`, preseason: { rank: 100 + id } }))
        .concat([
            { id: ELITE, season: SEASON, school: 'Elite', abbreviation: 'ELT', preseason: { rank: 5 } },
            { id: NOBODY, season: SEASON, school: 'Nobody', abbreviation: 'NOB', preseason: { rank: 340 } }
        ]));
    jest.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => { seasons._reset(); jest.restoreAllMocks(); });

describe('Captain on a basketball league', () => {
    test('every mode game the captain plays that week counts double', async () => {
        await modes({ captain: true });
        const ann = await manager('Ann', [1, 2], { captains: [{ week: 1, teamId: 1 }] });
        await HoopsGame.create([q1Win(1, 1), q1Win(1, 1), q1Win(1, 2)]);

        await scoreHoopsWeek(LEAGUE, { season: SEASON, week: 1 });
        const wk = await weekOf(ann._id, 1);
        // Base 15 (team 1 twice, team 2 once); team 1's 10 doubled.
        expect(wk.captainTeamId).toBe(1);
        expect(wk.captainBonus).toBe(10);
        expect(wk.score).toBe(25);
        expect((await entry(ann._id)).cumulativeScore).toBe(25);
    });

    test('a conference tournament game scores, but is NOT doubled', async () => {
        await modes({ captain: true });
        const ann = await manager('Ann', [1], { captains: [{ week: 1, teamId: 1 }] });
        await HoopsGame.create([q1Win(1, 1), confTourney(1, 1)]);

        await scoreHoopsWeek(LEAGUE, { season: SEASON, week: 1 });
        const wk = await weekOf(ann._id, 1);
        expect(wk.captainBonus).toBe(5);       // the regular-season win only
        expect(wk.score).toBe(15);             // 5 + 5 base, + 5 bonus
        const flagged = wk.scoreByTeam.filter(r => r.noModes);
        expect(flagged).toHaveLength(1);
        expect(flagged[0].score).toBe(5);
    });

    test('no pick: the auto-captain is the best team so far', async () => {
        await modes({ captain: true });
        const bo = await manager('Bo', [3, 4]);
        await HoopsGame.create([loss(1, 3), q1Win(1, 4), q1Win(2, 3), q1Win(2, 4)]);

        await scoreHoopsWeek(LEAGUE, { season: SEASON, week: 1 });
        await scoreHoopsWeek(LEAGUE, { season: SEASON, week: 2 });
        // Week 1 has no history: the first rostered team, which scored 0,
        // so there is no bonus to record. Week 2: team 4 led week 1.
        expect((await weekOf(bo._id, 1)).captainTeamId).toBeUndefined();
        const wk2 = await weekOf(bo._id, 2);
        expect(wk2.captainTeamId).toBe(4);
        expect(wk2.score).toBe(15);
    });

    test('an entry with no weeklyScore array at all still scores (a raw-inserted document)', async () => {
        // Lean reads apply no schema defaults; a missing array must not stop
        // the league's scoring.
        await modes({ captain: true });
        const a = await Account.create({ firstName: 'Raw', lastName: 'M', email: 'raw@example.invalid' });
        await Franchise.collection.insertOne({ accountId: a._id, league: LEAGUE,
            seasons: [{ season: SEASON, teamRefs: [{ id: 1, sport: 'basketball' }], captains: [{ week: 1, teamId: 1 }] }] });
        await HoopsGame.create([q1Win(1, 1)]);
        await scoreHoopsWeek(LEAGUE, { season: SEASON, week: 1 });
        expect((await weekOf(a._id, 1)).score).toBe(10);
    });

    test('with Captain off nothing is doubled', async () => {
        await modes({ captain: false });
        const ann = await manager('Ann', [1], { captains: [{ week: 1, teamId: 1 }] });
        await HoopsGame.create([q1Win(1, 1)]);
        await scoreHoopsWeek(LEAGUE, { season: SEASON, week: 1 });
        const wk = await weekOf(ann._id, 1);
        expect(wk.score).toBe(5);
        expect(wk.captainBonus).toBeUndefined();
    });

    test('a week past the regular season is not doubled', async () => {
        // Weeks 1-3 are the regular season, eight games each. Week 4 holds
        // conference tournaments and ONE straggling regular-season game —
        // a makeup — which is a sliver of a normal week, so week 4 is not
        // a mode week and even that game is not doubled.
        await modes({ captain: true });
        const ann = await manager('Ann', [1], { captains: [{ week: 4, teamId: 1 }] });
        const slate = [];
        for (let w = 1; w <= 3; w++) for (let i = 0; i < 8; i++) slate.push(loss(w, 70 + i));
        await HoopsGame.create(slate.concat([q1Win(4, 1), confTourney(4, 1)]));
        await scoreHoopsWeek(LEAGUE, { season: SEASON, week: 4 });
        const wk = await weekOf(ann._id, 4);
        expect(wk.score).toBe(10);
        expect(wk.captainBonus).toBeUndefined();
    });
});

describe('the default Captain is frozen at the lock (basketball)', () => {
    const { freezeLockedWeeks } = require('../modules/hoops-captain');
    // Every lock below is in the past at this instant.
    const LATER = Date.parse('2027-06-01T00:00:00Z');

    test('a late game that shifts the averages after the freeze does not move the doubled team', async () => {
        await modes({ captain: true });
        const bo = await manager('Bo', [1, 2]);
        // Week 1: team 1 averages 2.5 (a win and a loss), team 2 has not played.
        await HoopsGame.create([q1Win(1, 1), loss(1, 1), q1Win(2, 1), q1Win(2, 2)]);
        await scoreHoopsWeek(LEAGUE, { season: SEASON, week: 1 });

        // Week 2 locks: the default — team 1, the only team with history — is frozen.
        expect(await freezeLockedWeeks(LATER)).toBeGreaterThan(0);
        const frozen = (await entry(bo._id)).captains.find(c => c.week === 2);
        expect(frozen).toMatchObject({ teamId: 1, auto: true });

        // Then week 1's late game lands: team 2 wins, averaging 5 — it would
        // now be the default if the default were still computed at scoring.
        await HoopsGame.create(q1Win(1, 2));
        await scoreHoopsWeek(LEAGUE, { season: SEASON, week: 1 });
        await scoreHoopsWeek(LEAGUE, { season: SEASON, week: 2 });
        const wk2 = await weekOf(bo._id, 2);
        expect(wk2.captainTeamId).toBe(1);
        expect(wk2.score).toBe(15);
    });

    test('a manual pick is never replaced, and a second sweep writes nothing', async () => {
        await modes({ captain: true });
        const ann = await manager('Ann', [1, 2], { captains: [{ week: 1, teamId: 2 }] });
        await HoopsGame.create([q1Win(1, 1), q1Win(1, 2)]);
        await freezeLockedWeeks(LATER);
        expect(await freezeLockedWeeks(LATER)).toBe(0);
        expect((await entry(ann._id)).captains.map(c => [c.week, c.teamId, !!c.auto])).toEqual([[1, 2, false]]);
    });

    test('nothing is frozen before the lock, or with Captain off', async () => {
        await modes({ captain: true });
        const ann = await manager('Ann', [1]);
        await HoopsGame.create([q1Win(1, 1, { startDate: new Date('2099-01-05T00:00:00Z') })]);
        expect(await freezeLockedWeeks(Date.parse('2099-01-01'))).toBe(0);
        await modes({ captain: false });
        expect(await freezeLockedWeeks(LATER * 2)).toBe(0);
        expect((await entry(ann._id)).captains).toBeUndefined();
    });
});

describe('head-to-head on a basketball league', () => {
    async function twoManagers() {
        const ann = await manager('Ann', [1]);
        const bo = await manager('Bo', [2]);
        return { ann, bo };
    }

    test('the higher weekly total banks +3, decided from BASKETBALL games', async () => {
        await modes({ h2h: true });
        const { ann, bo } = await twoManagers();
        await HoopsGame.create([q1Win(1, 1), loss(1, 2)]);
        // A FOOTBALL game for team 1 in week 1 of a "2027" season, unplayed.
        // Read by football's H2H query (ids collide), it would hold the week
        // open and nobody would be paid.
        await Game.create({ id: 1, season: SEASON, week: 1, seasonType: 'regular', startDate: '2027-09-05T00:00:00Z',
            homeId: 1, homeTeam: 'Football One', awayId: 2, awayTeam: 'Football Two', completed: false,
            conferenceGame: false, neutralSite: false, startTimeTbd: false });

        await scoreHoopsWeek(LEAGUE, { season: SEASON, week: 1 });
        const a = await weekOf(ann._id, 1), b = await weekOf(bo._id, 1);
        expect(a.h2hResult).toBe('W');
        expect(a.h2hBonus).toBe(3);
        expect(a.score).toBe(8);
        expect(b.h2hResult).toBe('L');
        expect(b.h2hBonus).toBeUndefined();
        // Folded into the season total, like football's.
        expect((await entry(ann._id)).cumulativeScore).toBe(8);
    });

    test('a tie pays nothing', async () => {
        await modes({ h2h: true });
        const { ann, bo } = await twoManagers();
        await HoopsGame.create([q1Win(1, 1), q1Win(1, 2)]);
        await scoreHoopsWeek(LEAGUE, { season: SEASON, week: 1 });
        for (const id of [ann._id, bo._id]) {
            const wk = await weekOf(id, 1);
            expect(wk.h2hResult).toBe('T');
            expect(wk.h2hBonus).toBeUndefined();
            expect(wk.score).toBe(5);
        }
    });

    test('a week with an unplayed game does not settle', async () => {
        await modes({ h2h: true });
        const { ann } = await twoManagers();
        await HoopsGame.create([q1Win(1, 1), loss(1, 2), q1Win(1, 2, { status: 'scheduled', startDate: new Date('2099-01-01') })]);
        await scoreHoopsWeek(LEAGUE, { season: SEASON, week: 1 });
        expect((await weekOf(ann._id, 1)).h2hResult).toBeUndefined();
    });

    test('a game still unplayed a week after its tip does not hold the week open', async () => {
        // A postponement, or the stale half of a rescheduled pair.
        await modes({ h2h: true });
        const { ann } = await twoManagers();
        await HoopsGame.create([q1Win(1, 1), loss(1, 2),
            q1Win(1, 2, { status: 'scheduled', startDate: new Date('2026-11-04T00:00:00Z') })]);
        await scoreHoopsWeek(LEAGUE, { season: SEASON, week: 1 });
        // Before the grace runs out the week is open...
        await applyHoopsH2H(LEAGUE, SEASON, { nowMs: Date.parse('2026-11-05T00:00:00Z') });
        expect((await weekOf(ann._id, 1)).h2hResult).toBeUndefined();
        // ...and settles once the game is a week overdue.
        await applyHoopsH2H(LEAGUE, SEASON, { nowMs: Date.parse('2026-11-20T00:00:00Z') });
        expect((await weekOf(ann._id, 1)).h2hResult).toBe('W');
    });

    test('conference tournament points are not part of the matchup', async () => {
        // Ann loses a regular game; Bo's only win is in his conference
        // tournament. The matchup is 0-0, a tie, and pays nothing — though
        // Bo's 5 points still count toward his season.
        await modes({ h2h: true });
        const { ann, bo } = await twoManagers();
        await HoopsGame.create([loss(1, 1), loss(1, 2), confTourney(1, 2)]);
        await scoreHoopsWeek(LEAGUE, { season: SEASON, week: 1 });
        const b = await weekOf(bo._id, 1);
        expect(b.score).toBe(5);
        expect(b.h2hResult).toBe('T');
        expect((await weekOf(ann._id, 1)).h2hResult).toBe('T');
    });

    test('turning H2H off strips a banked bonus', async () => {
        await modes({ h2h: true });
        const { ann } = await twoManagers();
        await HoopsGame.create([q1Win(1, 1), loss(1, 2)]);
        await scoreHoopsWeek(LEAGUE, { season: SEASON, week: 1 });
        expect((await weekOf(ann._id, 1)).h2hBonus).toBe(3);

        await ScoringConfig.updateOne({ league: LEAGUE }, { $set: { [`engagementBySeason.${SEASON}.h2hEnabled`]: false } });
        await applyHoopsH2H(LEAGUE, SEASON);
        const wk = await weekOf(ann._id, 1);
        expect(wk.h2hBonus).toBeUndefined();
        expect(wk.score).toBe(5);
    });

    test('re-scoring a settled week does not compound the bonus', async () => {
        await modes({ h2h: true });
        const { ann } = await twoManagers();
        await HoopsGame.create([q1Win(1, 1), loss(1, 2)]);
        for (let i = 0; i < 3; i++) await scoreHoopsWeek(LEAGUE, { season: SEASON, week: 1 });
        expect((await weekOf(ann._id, 1)).score).toBe(8);
        expect((await entry(ann._id)).cumulativeScore).toBe(8);
    });

    test('Captain and H2H together: the matchup is decided on the doubled total', async () => {
        await modes({ captain: true, h2h: true });
        const ann = await manager('Ann', [1, 3], { captains: [{ week: 1, teamId: 1 }] });
        const bo = await manager('Bo', [2, 4], { captains: [{ week: 1, teamId: 4 }] });
        // Base: Ann 5 (team 1), Bo 10 (teams 2 and 4). Doubled: Ann 10, Bo 15.
        await HoopsGame.create([q1Win(1, 1), loss(1, 3), q1Win(1, 2), q1Win(1, 4)]);
        await scoreHoopsWeek(LEAGUE, { season: SEASON, week: 1 });
        expect((await weekOf(bo._id, 1)).h2hResult).toBe('W');
        expect((await weekOf(bo._id, 1)).score).toBe(18);
        expect((await weekOf(ann._id, 1)).score).toBe(10);
    });

    test('if H2H fails, the season totals are still re-summed', async () => {
        await modes({ h2h: true });
        const { ann } = await twoManagers();
        await HoopsGame.create([q1Win(1, 1), loss(1, 2)]);
        await scoreHoopsWeek(LEAGUE, { season: SEASON, week: 1 });
        expect((await entry(ann._id)).cumulativeScore).toBe(8);
        // The week's game is corrected to a loss and rescored, and the H2H
        // step blows up: the total must follow the rewritten rows anyway.
        await HoopsGame.updateMany({ homeTeamId: 1 }, { $set: { homePoints: 60 } });
        const hh = require('../modules/hoops-h2h');
        jest.spyOn(hh, 'applyHoopsH2H').mockRejectedValueOnce(new Error('mongo down'));
        await expect(scoreHoopsWeek(LEAGUE, { season: SEASON, week: 1 })).rejects.toThrow('mongo down');
        expect((await entry(ann._id)).cumulativeScore).toBe(0);
    });

    test('two passes over one league at once run one after the other', async () => {
        // The nightly job and the live poller share a dyno. Interleaved, the
        // H2H write (a whole weeklyScore array from an earlier read) could
        // put back a week the other pass had just rescored.
        await modes({ h2h: true });
        const { ann } = await twoManagers();
        await HoopsGame.create([q1Win(1, 1), loss(1, 2), q1Win(2, 1), loss(2, 2)]);
        const hh = require('../modules/hoops-h2h');
        const real = hh.applyHoopsH2H;
        let inFlight = 0, overlapped = false;
        jest.spyOn(hh, 'applyHoopsH2H').mockImplementation(async (...a) => {
            inFlight++; if (inFlight > 1) overlapped = true;
            await new Promise(r => setTimeout(r, 30));
            try { return await real(...a); } finally { inFlight--; }
        });
        await Promise.all([
            scoreHoopsWeek(LEAGUE, { season: SEASON, week: 1 }),
            scoreHoopsWeek(LEAGUE, { season: SEASON, week: 2 })
        ]);
        expect(overlapped).toBe(false);
        expect((await weekOf(ann._id, 1)).score).toBe(8);
        expect((await weekOf(ann._id, 2)).score).toBe(8);
        expect((await entry(ann._id)).cumulativeScore).toBe(16);
    });

    test('modeWeekBase leaves the H2H bonus and conference tournament rows out', () => {
        expect(modeWeekBase({ score: 18, h2hBonus: 3, scoreByTeam: [{ score: 5, noModes: true }, { score: 10 }] })).toBe(10);
        expect(modeWeekBase(null)).toBe(0);
        expect(modeWeekBase({ score: 4 })).toBe(4);
    });
});

describe('the standings read model agrees', () => {
    const app = express();
    app.use('/standings', require('../routes/standings'));

    test('records, weeks and cards come from basketball', async () => {
        await modes({ h2h: true });
        const ann = await manager('Ann', [1]);
        await manager('Bo', [2]);
        await HoopsGame.create([q1Win(1, 1), loss(1, 2), q1Win(2, 2), loss(2, 1),
            // The regular season runs 3 weeks; week 3 is unplayed.
            q1Win(3, 1, { status: 'scheduled', startDate: new Date('2099-01-01') }), loss(3, 2, { status: 'scheduled', startDate: new Date('2099-01-01') })]);
        await scoreHoopsWeek(LEAGUE, { season: SEASON, week: 1 });
        await scoreHoopsWeek(LEAGUE, { season: SEASON, week: 2 });

        const res = await request(app).get(`/standings/h2h/${LEAGUE}/${SEASON}`);
        expect(res.status).toBe(200);
        expect(res.body.enabled).toBe(true);
        expect(res.body.weeks).toEqual([1, 2, 3]);
        const me = res.body.managers.find(m => m.userId === String(ann._id));
        expect(me.record).toBe('1-1-0');
        expect(me.adjustedTotal).toBe(8);
        const wk1 = res.body.schedule.find(s => s.week === 1);
        expect(wk1.final).toBe(true);
        const card = wk1.games[0];
        const annSide = card.aId === String(ann._id) ? card.aTeams : card.bTeams;
        expect(annSide[0]).toMatchObject({ teamId: 1, abbr: 'T1', opp: 'ELT', score: 5 });
        expect(res.body.schedule.find(s => s.week === 3).upcoming).toBe(true);
    });
});

describe('no win-probability bar on a basketball week in progress', () => {
    // Basketball has no projection, so odds built from FINAL games alone read
    // 100% / 0% as soon as one side has a result. The basketball payload
    // answers none; football keeps computing its odds.
    const app = express();
    app.use('/standings', require('../routes/standings'));
    const midWeek = (body) => body.schedule.find(s => s.week === 1);

    test('basketball: one side final, the other still to play — winP is null', async () => {
        await modes({ h2h: true });
        await manager('Ann', [1]);
        await manager('Bo', [2]);
        await HoopsGame.create([q1Win(1, 1), q1Win(1, 2, { status: 'scheduled', startDate: new Date('2099-01-01') })]);
        await scoreHoopsWeek(LEAGUE, { season: SEASON, week: 1 });
        const res = await request(app).get(`/standings/h2h/${LEAGUE}/${SEASON}`);
        const wk = midWeek(res.body);
        expect(wk.final).toBe(false);
        expect(wk.upcoming).toBe(false);
        expect(wk.games[0].winP).toBeNull();
    });

    test('football, same shape of week: still answers odds', async () => {
        const { mirrorUsers } = require('./helpers/mongo');
        const User = require('../models/user');
        const FOOT = 'graham-league';
        const t = (id) => ({ id, school: `F${id}`, mascot: 'M', abbreviation: `F${id}`, conference: 'SEC', color: '#000', logos: ['x'],
            location: { venue_id: id, name: 'S', city: 'C', state: 'ST', zip: '0', latitude: 1, longitude: 1, capacity: 1, grass: true, dome: false } });
        await ScoringConfig.updateOne({ league: FOOT }, { $set: { league: FOOT, 'engagementBySeason.2026': { h2hEnabled: true, h2hWinBonus: 3 } } }, { upsert: true });
        await User.create([
            { firstName: 'Fa', lastName: 'X', league: FOOT, seasons: [{ season: 2026, teams: [t(11)], weeklyScore: [{ week: 1, score: 5, scoreByTeam: [{ teamId: 11, gameId: 1, score: 5 }] }] }] },
            { firstName: 'Fb', lastName: 'X', league: FOOT, seasons: [{ season: 2026, teams: [t(12)], weeklyScore: [{ week: 1, score: 0 }] }] }
        ]);
        await mirrorUsers();
        const fg = (id, homeId, completed, startDate) => ({ id, season: 2026, week: 1, seasonType: 'regular', startDate, startTimeTbd: false,
            neutralSite: false, conferenceGame: false, homeId, homeTeam: `F${homeId}`, awayId: 99, awayTeam: 'Opp',
            homePoints: completed ? 30 : null, awayPoints: completed ? 10 : null, completed });
        await Game.create([fg(1, 11, true, '2026-09-05T19:00:00Z'), fg(2, 12, false, '2099-09-05T19:00:00Z')]);
        const res = await request(app).get(`/standings/h2h/${FOOT}/2026`);
        expect(midWeek(res.body).games[0].winP).not.toBeNull();
    });
});

describe("football's H2H pass leaves a basketball league alone", () => {
    const app = express();
    app.use(express.json());
    app.use('/scores', require('../routes/scores'));

    test('a banked basketball bonus survives a football pass over the same year', async () => {
        // The day football rolls over to 2027, leaguesWithSeason(2027)
        // returns the basketball league too.
        await modes({ h2h: true });
        const { ann } = { ann: await manager('Ann', [1]) };
        await manager('Bo', [2]);
        await HoopsGame.create([q1Win(1, 1), loss(1, 2)]);
        await scoreHoopsWeek(LEAGUE, { season: SEASON, week: 1 });
        expect((await weekOf(ann._id, 1)).h2hBonus).toBe(3);

        const res = await request(app).post('/scores/h2h-bonus').send({ season: SEASON });
        expect(res.status).toBe(200);
        expect(res.body.leagues.map(l => l.league)).not.toContain(LEAGUE);
        expect((await weekOf(ann._id, 1)).h2hBonus).toBe(3);
    });
});
