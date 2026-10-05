// Scoring a week of basketball onto rosters (#316, final slice).
//
// The engine is tested in HoopsScoring.spec.js. What is tested here is the
// PASS: which games it picks up, which it refuses, and what it writes —
// including that re-running a week replaces it rather than appending, which
// is the difference between a correction and doubling everyone's season.

const { useMongo } = require('./helpers/mongo');
const { scoreHoopsWeek, isFinal, rosterIds } = require('../modules/hoops-scoring-pass');
const HoopsGame = require('../models/hoopsGame');
const HoopsTeam = require('../models/hoopsTeam');
const Franchise = require('../models/franchise');
const Account = require('../models/account');
const League = require('../models/league');
const SportSeason = require('../models/sportSeason');
const seasons = require('../modules/active-season');

useMongo();

const LEAGUE = 'hoops-league';
const SEASON = 2027;
const WEEK = 3;

// Team 1 is elite, team 2 is awful, team 3 is in between.
const RANKS = { 1: 5, 2: 300, 3: 90 };

const finalGame = (id, homeId, awayId, homeWon, o = {}) => Object.assign({
    id, season: SEASON, week: WEEK, seasonType: 'regular', status: 'final',
    startDate: new Date('2026-11-20'),
    homeTeamId: homeId, awayTeamId: awayId,
    homePoints: homeWon ? 80 : 70, awayPoints: homeWon ? 70 : 80,
    homeWinner: homeWon, awayWinner: !homeWon,
    neutralSite: false, conferenceGame: false
}, o);

async function manager(name, teamIds) {
    const a = await Account.create({ firstName: name, lastName: 'M', email: `${name}@example.invalid` });
    await Franchise.create({
        accountId: a._id, league: LEAGUE,
        seasons: [{ season: SEASON, franchiseName: name, teamRefs: teamIds.map(id => ({ id, sport: 'basketball' })) }]
    });
    return a;
}

const weekOf = async (accountId) => {
    const f = await Franchise.findOne({ accountId, league: LEAGUE }).lean();
    const s = (f.seasons || []).find(x => x.season === SEASON);
    return (s.weeklyScore || []).find(w => w.week === WEEK);
};

beforeEach(async () => {
    await League.create({ code: LEAGUE, name: 'Hardwood Heroes', sport: 'basketball' });
    await SportSeason.create([
        { sport: 'football', season: 2026, status: 'in-season' },
        { sport: 'basketball', season: SEASON, status: 'in-season' }
    ]);
    await seasons.prime();
    await HoopsTeam.create([
        { id: 1, season: SEASON, school: 'Elite', preseason: { rank: RANKS[1] } },
        { id: 2, season: SEASON, school: 'Awful', preseason: { rank: RANKS[2] } },
        { id: 3, season: SEASON, school: 'Middling', preseason: { rank: RANKS[3] } }
    ]);
});
afterEach(() => seasons._reset());

describe('what the pass scores', () => {
    test('a win is worth its quadrant, and lands on the roster', async () => {
        const me = await manager('Ann', [2]);
        // Team 2 (awful) hosts team 1 (#5) and wins: a home Q1.
        await HoopsGame.create(finalGame(100, 2, 1, true));

        const out = await scoreHoopsWeek(LEAGUE, { season: SEASON, week: WEEK });
        expect(out.managers).toBe(1);
        expect(out.games).toBe(1);

        const wk = await weekOf(me._id);
        expect(wk.score).toBe(5);
        expect(wk.scoreByTeam).toHaveLength(1);
        expect(wk.scoreByTeam[0]).toMatchObject({ teamId: 2, gameId: 100, score: 5 });
    });

    test('every rostered team in the week adds up', async () => {
        const me = await manager('Bo', [1, 2, 3]);
        await HoopsGame.create([
            finalGame(101, 1, 99, true),    // beat an unrostered, unranked team at home: Q4, 0
            finalGame(102, 2, 3, true),     // awful beats #90 at home: Q3, 1
            finalGame(103, 99, 3, false)    // middling wins away at an unranked team: Q4, 0
        ]);
        const out = await scoreHoopsWeek(LEAGUE, { season: SEASON, week: WEEK });
        const wk = await weekOf(me._id);
        expect(wk.score).toBe(1);
        // FOUR entries from three games: game 102 is team 2 against team 3
        // and this manager rosters both, so it is listed once per team.
        // That is the breakdown a manager wants — "what did each of my
        // teams do" — and the total is still right.
        expect(wk.scoreByTeam).toHaveLength(4);
        expect(wk.scoreByTeam.filter(e => e.gameId === 102).map(e => e.teamId).sort()).toEqual([2, 3]);
        expect(out.games).toBe(3);
    });

    test('two managers who both roster a team in the same game each score it', async () => {
        // The one game is fetched once; both rosters are paid from it.
        const a = await manager('Cy', [1]);
        const b = await manager('Di', [2]);
        await HoopsGame.create(finalGame(104, 2, 1, true));   // 2 beats 1 at home

        await scoreHoopsWeek(LEAGUE, { season: SEASON, week: WEEK });
        expect((await weekOf(a._id)).score).toBe(0);          // the loser banks nothing
        expect((await weekOf(b._id)).score).toBe(5);          // Q1 win
    });

    test('a manager with no games that week is written down as zero', async () => {
        // Not skipped. An absent week and a zero week look identical in a
        // total but not in a weekly table, and H2H settles per week.
        const me = await manager('Eve', [1]);
        const out = await scoreHoopsWeek(LEAGUE, { season: SEASON, week: WEEK });
        expect(out.managers).toBe(1);
        expect((await weekOf(me._id)).score).toBe(0);
    });
});

describe('which games it refuses', () => {
    test('a scheduled game is not scored', async () => {
        const me = await manager('Fay', [2]);
        await HoopsGame.create(finalGame(105, 2, 1, true, { status: 'scheduled' }));
        const out = await scoreHoopsWeek(LEAGUE, { season: SEASON, week: WEEK });
        expect(out.games).toBe(0);
        expect(out.skipped).toBe(1);
        expect((await weekOf(me._id)).score).toBe(0);
    });

    test('an IN-PROGRESS game with points is not scored', async () => {
        // The dangerous one. A live game has points, and a score banked at
        // time of play is never revisited — a half-time lead would be
        // permanent.
        const me = await manager('Gus', [2]);
        await HoopsGame.create(finalGame(106, 2, 1, true, { status: 'in_progress' }));
        const out = await scoreHoopsWeek(LEAGUE, { season: SEASON, week: WEEK });
        expect(out.games).toBe(0);
        expect((await weekOf(me._id)).score).toBe(0);
    });

    test('a final with no points is not scored either', async () => {
        const me = await manager('Hal', [2]);
        await HoopsGame.create(finalGame(107, 2, 1, true, { homePoints: null, awayPoints: null }));
        expect((await scoreHoopsWeek(LEAGUE, { season: SEASON, week: WEEK })).games).toBe(0);
        expect((await weekOf(me._id)).score).toBe(0);
    });

    test('another week’s game is not scored into this one', async () => {
        const me = await manager('Ivy', [2]);
        await HoopsGame.create(finalGame(108, 2, 1, true, { week: WEEK + 1 }));
        expect((await scoreHoopsWeek(LEAGUE, { season: SEASON, week: WEEK })).games).toBe(0);
        expect((await weekOf(me._id)).score).toBe(0);
    });

    test('another season’s game is not scored either', async () => {
        const me = await manager('Jon', [2]);
        await HoopsGame.create(finalGame(109, 2, 1, true, { season: SEASON - 1 }));
        expect((await scoreHoopsWeek(LEAGUE, { season: SEASON, week: WEEK })).games).toBe(0);
    });

    test('a game between two UNROSTERED teams is not even fetched', async () => {
        await manager('Kim', [1]);
        await HoopsGame.create(finalGame(110, 50, 51, true));
        expect((await scoreHoopsWeek(LEAGUE, { season: SEASON, week: WEEK })).games).toBe(0);
    });

    test('isFinal on its own', () => {
        expect(isFinal({ status: 'final', homePoints: 70, awayPoints: 60 })).toBe(true);
        // Number(null) is 0 and 0 is finite — so the obvious check read
        // this as a completed 0-0 game and banked a loss for both teams.
        expect(isFinal({ status: 'final', homePoints: null, awayPoints: null })).toBe(false);
        expect(isFinal({ status: 'final', homePoints: '', awayPoints: '' })).toBe(false);
        // A real 0-0 cannot happen in basketball, but it is still a number
        // and must not be rejected by a guard aimed at nulls.
        expect(isFinal({ status: 'final', homePoints: 0, awayPoints: 0 })).toBe(true);
        expect(isFinal({ status: 'final', homePoints: 'abandoned', awayPoints: 60 })).toBe(false);
        expect(isFinal({ status: 'FINAL', homePoints: 70, awayPoints: 60 })).toBe(true);
        expect(isFinal({ status: 'scheduled', homePoints: 70, awayPoints: 60 })).toBe(false);
        expect(isFinal({ status: 'final', homePoints: 70 })).toBe(false);
        expect(isFinal({ homePoints: 70, awayPoints: 60 })).toBe(false);
        expect(isFinal(null)).toBe(false);
    });
});

describe('re-running a week', () => {
    // A second pass over the same week is NORMAL — a late final, a
    // corrected roster. Appending instead of replacing would double every
    // score in the season total.
    test('replaces the week rather than appending it', async () => {
        const me = await manager('Lee', [2]);
        await HoopsGame.create(finalGame(111, 2, 1, true));

        await scoreHoopsWeek(LEAGUE, { season: SEASON, week: WEEK });
        await scoreHoopsWeek(LEAGUE, { season: SEASON, week: WEEK });
        await scoreHoopsWeek(LEAGUE, { season: SEASON, week: WEEK });

        const f = await Franchise.findOne({ accountId: me._id }).lean();
        const weeks = f.seasons.find(s => s.season === SEASON).weeklyScore;
        expect(weeks.filter(w => w.week === WEEK)).toHaveLength(1);
        expect(weeks.find(w => w.week === WEEK).score).toBe(5);
    });

    test('and picks up a result that arrived late', async () => {
        const me = await manager('Moe', [2]);
        const g = await HoopsGame.create(finalGame(112, 2, 1, true, { status: 'scheduled' }));
        await scoreHoopsWeek(LEAGUE, { season: SEASON, week: WEEK });
        expect((await weekOf(me._id)).score).toBe(0);

        await HoopsGame.updateOne({ id: 112 }, { $set: { status: 'final' } });
        await scoreHoopsWeek(LEAGUE, { season: SEASON, week: WEEK });
        expect((await weekOf(me._id)).score).toBe(5);
        expect(g).toBeTruthy();
    });

    test('other weeks are left alone', async () => {
        const me = await manager('Nan', [2]);
        await HoopsGame.create([
            finalGame(113, 2, 1, true),
            finalGame(114, 2, 3, true, { id: 114, week: WEEK + 1 })
        ]);
        await scoreHoopsWeek(LEAGUE, { season: SEASON, week: WEEK });
        await scoreHoopsWeek(LEAGUE, { season: SEASON, week: WEEK + 1 });
        await scoreHoopsWeek(LEAGUE, { season: SEASON, week: WEEK });

        const f = await Franchise.findOne({ accountId: me._id }).lean();
        const weeks = f.seasons.find(s => s.season === SEASON).weeklyScore;
        expect(weeks.map(w => w.week).sort()).toEqual([WEEK, WEEK + 1]);
    });
});

describe('it does not touch anyone else', () => {
    test('a manager in another league is not scored', async () => {
        const mine = await manager('Oli', [2]);
        const other = await Account.create({ firstName: 'Pat', lastName: 'X', email: 'pat@example.invalid' });
        await Franchise.create({
            accountId: other._id, league: 'graham-league',
            seasons: [{ season: SEASON, franchiseName: 'Football', teamRefs: [{ id: 2, sport: 'basketball' }] }]
        });
        await HoopsGame.create(finalGame(115, 2, 1, true));

        const out = await scoreHoopsWeek(LEAGUE, { season: SEASON, week: WEEK });
        expect(out.managers).toBe(1);
        expect((await weekOf(mine._id)).score).toBe(5);

        const f = await Franchise.findOne({ accountId: other._id }).lean();
        expect((f.seasons[0].weeklyScore || [])).toHaveLength(0);
    });

    test('a league where nobody has a roster asks for no games at all', async () => {
        // Preseason, before the draft. The games query is skipped entirely
        // rather than run with an empty id list.
        const a = await Account.create({ firstName: 'Rae', lastName: 'M', email: 'rae@example.invalid' });
        await Franchise.create({ accountId: a._id, league: LEAGUE, seasons: [{ season: SEASON, franchiseName: 'Undrafted' }] });
        await HoopsGame.create(finalGame(117, 2, 1, true));
        const spy = jest.spyOn(HoopsGame, 'find');
        const out = await scoreHoopsWeek(LEAGUE, { season: SEASON, week: WEEK });
        expect(spy).not.toHaveBeenCalled();
        expect(out.games).toBe(0);
        expect(out.managers).toBe(1);
        spy.mockRestore();
    });

    test('an unresolvable week is a SKIP, not a crash', async () => {
        // Number(undefined) is NaN, which Mongoose rejects with a cast
        // error — thrown from inside a scheduled job, where the useful
        // outcome is "nothing to do tonight" rather than a stack trace and
        // no JobRun at all.
        await manager('Sam', [2]);
        for (const opts of [undefined, {}, { season: SEASON }, { week: WEEK }, { season: SEASON, week: 'x' }]) {
            const out = await scoreHoopsWeek(LEAGUE, opts);
            expect(out.skippedReason).toBe('no season or week to score');
            expect(out.managers).toBe(0);
        }
    });

    test('apply:false scores without writing anything', async () => {
        const me = await manager('Quy', [2]);
        await HoopsGame.create(finalGame(116, 2, 1, true));
        const out = await scoreHoopsWeek(LEAGUE, { season: SEASON, week: WEEK, apply: false });
        expect(out.results[0].score).toBe(5);
        expect(await weekOf(me._id)).toBeUndefined();
    });
});

describe('rosterIds', () => {
    test('prefers basketball refs, in roster order', () => {
        expect(rosterIds({ teamRefs: [{ id: 7, sport: 'basketball' }, { id: 3, sport: 'basketball' }] }))
            .toEqual([7, 3]);
    });

    test('ignores football refs on a basketball roster', () => {
        expect(rosterIds({ teamRefs: [{ id: 7, sport: 'basketball' }, { id: 9, sport: 'football' }] }))
            .toEqual([7]);
    });

    test('falls back to embedded teams, so a corrected roster still scores', () => {
        expect(rosterIds({ teams: [{ id: 4 }, { id: 5 }] })).toEqual([4, 5]);
    });

    test('and an empty entry is an empty roster', () => {
        expect(rosterIds(null)).toEqual([]);
        expect(rosterIds({})).toEqual([]);
    });
});

// The nightly job around the pass (#316).
describe('the nightly basketball job', () => {
    const job = require('../modules/hoops-scores-job');
    const jobLogger = require('../modules/job-logger');

    // job-logger writes over HTTP, so in a test the row never lands. What
    // IS observable is whether the job asked for one and with what status.
    const watchLogger = () => {
        const calls = [];
        jest.spyOn(jobLogger, 'startRun').mockImplementation(async () => 'run-id');
        jest.spyOn(jobLogger, 'finishRun').mockImplementation(async (id, status, msg) => calls.push({ status, msg }));
        return calls;
    };
    afterEach(() => jest.restoreAllMocks());

    test('scores only BASKETBALL leagues', async () => {
        await League.create({ code: 'graham-league', name: 'Football', sport: 'football' });
        expect(await job.basketballLeagues()).toEqual([{ league: LEAGUE, season: SEASON }]);
    });

    test('and skips an archived one', async () => {
        await League.create({ code: 'old-hoops', name: 'Retired', sport: 'basketball', status: 'archived' });
        expect((await job.basketballLeagues()).map(l => l.league)).toEqual([LEAGUE]);
    });

    test('with no basketball league at all it is a silent no-op', async () => {
        // The normal state for most of this app's life. No JobRun: a nightly
        // "nothing to do" row is noise on the admin strip.
        await League.deleteOne({ code: LEAGUE });
        const logged = watchLogger();
        const out = await job.run();
        expect(out.skippedReason).toBe('no basketball leagues');
        expect(logged).toEqual([]);
    });

    test('a season with no schedule ingested is skipped, not failed', async () => {
        await manager('Tam', [2]);
        const out = await job.run({ now: new Date('2026-12-20') });
        expect(out.skippedReason).toMatch(/no schedule ingested/);
    });

    test('something thrown that is not an Error is still reported', async () => {
        // Libraries throw strings. The summary must still name it rather
        // than reading "undefined".
        const ScoringConfig = require('../models/scoringConfig');
        watchLogger();
        await manager('Zed', [2]);
        await HoopsGame.create([
            finalGame(220, 50, 51, true, { week: 1, startDate: new Date('2026-11-02'), status: 'scheduled' }),
            finalGame(221, 52, 53, true, { week: 18, startDate: new Date('2027-03-01'), status: 'scheduled' })
        ]);
        const boom = jest.spyOn(ScoringConfig, 'findOne')
            .mockImplementationOnce(() => { throw 'exploded'; });
        const out = await job.run({ now: new Date('2026-12-20') });
        boom.mockRestore();
        expect(out.failed).toBe('exploded');
    });

    test('a season whose schedule has run out is skipped', async () => {
        // Past the last game on file: there is no current week, and that is
        // a skip rather than a week-zero pass that writes zeros over
        // everyone's season.
        await manager('Wes', [2]);
        await HoopsGame.create(finalGame(210, 50, 51, true, {
            week: 1, startDate: new Date('2026-11-02'), status: 'scheduled'
        }));
        const out = await job.run({ now: new Date('2027-08-01') });
        expect(out.done).toEqual([]);
        expect(out.skippedReason).toMatch(/hoops-league:/);
    });

    test('it scores the current week and logs a run', async () => {
        await manager('Uma', [2]);
        const NOW = new Date('2026-12-20');
        // The calendar needs a season START to count weeks from and a LAST
        // game to know the season is still running — with only the opener
        // on file it reads as already over.
        await HoopsGame.create([
            finalGame(201, 50, 51, true, { week: 1, startDate: new Date('2026-11-02'), status: 'scheduled' }),
            finalGame(299, 52, 53, true, { week: 18, startDate: new Date('2027-03-01'), status: 'scheduled' })
        ]);
        // ASK the calendar rather than hardcoding a week. Hardcoding 7
        // assumed a boundary the calendar does not draw, and the test
        // failed on an off-by-one that was never the job's.
        const when = await job.weekFor(SEASON, NOW);
        expect(Number.isFinite(when.week)).toBe(true);
        await HoopsGame.create(finalGame(200, 2, 1, true, {
            week: when.week, startDate: new Date('2026-12-16')
        }));

        const logged = watchLogger();
        const out = await job.run({ now: NOW });
        expect(out.done.join(' ')).toContain(`hoops-league wk${when.week}: 1 manager(s), 1 game(s)`);
        expect(logged).toHaveLength(1);
        expect(logged[0].status).toBe('success');
    });

    test('a league that blows up is recorded, not swallowed', async () => {
        // NOT by spying on scoreHoopsWeek: the job destructures it at
        // require time, so a spy on the module object never reaches the
        // call — the same trap that made a seasonForLeague spy useless
        // earlier in this branch. Breaking something the pass really reads
        // is both simpler and a truer failure.
        const ScoringConfig = require('../models/scoringConfig');
        await manager('Vic', [2]);
        await HoopsGame.create([
            finalGame(203, 50, 51, true, { week: 1, startDate: new Date('2026-11-02'), status: 'scheduled' }),
            finalGame(298, 52, 53, true, { week: 18, startDate: new Date('2027-03-01'), status: 'scheduled' })
        ]);

        const logged = watchLogger();
        const boom = jest.spyOn(ScoringConfig, 'findOne')
            .mockImplementationOnce(() => { throw new Error('mongo down'); });
        const out = await job.run({ now: new Date('2026-12-20') });
        boom.mockRestore();

        // Recorded rather than swallowed — the failure shape this repo
        // keeps meeting.
        expect(`${out.failed} ${out.skipped.join(' ')}`).toMatch(/mongo down/);
        expect(logged).toHaveLength(1);
        expect(logged[0].status).toBe('error');
        expect(logged[0].msg).toMatch(/mongo down/);
    });
});
