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

// Any week's score for the one manager created most recently.
const weekOf2 = async (season, week) => {
    const f = await Franchise.findOne({ league: LEAGUE, 'seasons.season': season }).sort({ _id: -1 }).lean();
    const s = (f.seasons || []).find(x => x.season === season);
    const w = (s.weeklyScore || []).find(e => e.week === week);
    return w && w.score;
};

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
        // A tie is not a result. Basketball does not have them, so one
        // means the row is wrong — and scoring it would pay BOTH teams a
        // Q4 "win" and shield both from the bad-loss penalty.
        expect(isFinal({ status: 'final', homePoints: 0, awayPoints: 0 })).toBe(false);
        expect(isFinal({ status: 'final', homePoints: 70, awayPoints: 70 })).toBe(false);
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

    test('ONE account with two franchises in the SAME season is not crossed', async () => {
        // The filter the previous cross-league test could never exercise:
        // it gave the other league a different ACCOUNT, so a missing
        // `league` on the write would still have found the right document.
        // A manager who plays basketball and football has two Franchise
        // docs under one accountId, and today only the differing season
        // keeps them apart — which stops being true when football rolls
        // over to 2027.
        const a = await Account.create({ firstName: 'Dual', lastName: 'M', email: 'dual@example.invalid' });
        await Franchise.create([
            { accountId: a._id, league: LEAGUE, seasons: [{ season: SEASON, franchiseName: 'Hoops side', teamRefs: [{ id: 2, sport: 'basketball' }] }] },
            // The football side carries a week-3 entry of its OWN for the
            // same season. Without it the $elemMatch can only ever select
            // the basketball document, so the league filter on the replace
            // path is never the thing doing the work.
            { accountId: a._id, league: 'graham-league', seasons: [{
                season: SEASON, franchiseName: 'Football side',
                weeklyScore: [{ week: WEEK, score: 99, scoreByTeam: [] }]
            }] }
        ]);
        await HoopsGame.create(finalGame(240, 2, 1, true));

        // TWICE: the first pass PUSHes the week, the second REPLACEs it.
        // Both writes carry the league filter and both need exercising —
        // a single pass only ever reached the push.
        await scoreHoopsWeek(LEAGUE, { season: SEASON, week: WEEK });
        await scoreHoopsWeek(LEAGUE, { season: SEASON, week: WEEK });

        const hoops = await Franchise.findOne({ accountId: a._id, league: LEAGUE }).lean();
        const football = await Franchise.findOne({ accountId: a._id, league: 'graham-league' }).lean();
        expect(hoops.seasons[0].weeklyScore.filter(w => w.week === WEEK)).toHaveLength(1);
        expect(hoops.seasons[0].weeklyScore.find(w => w.week === WEEK).score).toBe(5);
        // Untouched: still the 99 it started with, not the basketball score.
        expect(football.seasons[0].weeklyScore).toHaveLength(1);
        expect(football.seasons[0].weeklyScore[0].score).toBe(99);
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
    // The refresh it runs first is a billable CBBD call: never real in a test.
    const hoopsGames = require('../routes/hoopsGames');
    beforeEach(() => {
        jest.spyOn(hoopsGames, 'refreshResults').mockResolvedValue({ code: 200, body: { finals: 0, games: 0 } });
    });
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

    test('it scores the week a result landed in, and logs a run', async () => {
        await manager('Uma', [2]);
        const NOW = new Date('2026-12-20T23:30:00Z');
        await HoopsGame.create([
            finalGame(201, 50, 51, true, { week: 1, startDate: new Date('2026-11-02'), status: 'scheduled' }),
            finalGame(200, 2, 1, true, { week: 7, startDate: new Date('2026-12-19') })
        ]);

        const logged = watchLogger();
        const out = await job.run({ now: NOW });
        expect(out.done.join(' ')).toContain('hoops-league wk7: 1 manager(s), 1 game(s)');
        expect((await weekOf2(SEASON, 7))).toBe(5);
        expect(logged).toHaveLength(1);
        expect(logged[0].status).toBe('success');
    });

    // THE BUG THIS DESIGN EXISTS FOR.
    //
    // The scheduler runs on Central time, so 23:30 CT is 00:30 EASTERN the
    // next day — and the hoops calendar buckets weeks Monday-to-Sunday on
    // the Eastern day. A Sunday game is stamped week N, is played after
    // Saturday night's run, and the Sunday-night run asks for week N+1.
    // Scoring "the current week" meant no run EVER asked for week N again,
    // and scores are banked at time of play.
    //
    // 377 of the 5,286 real 2027 games are Sunday games — 7.1% of the
    // season, plus half the Round of 32 and half the Elite Eight.
    test('a SUNDAY result is still scored by the next night’s run', async () => {
        await manager('Sun', [2]);
        await HoopsGame.create([
            finalGame(230, 50, 51, true, { week: 1, startDate: new Date('2026-11-02'), status: 'scheduled' }),
            // Sunday 10 Jan 2027, Eastern — week 10.
            finalGame(231, 2, 1, true, { week: 10, startDate: new Date('2027-01-10T23:00:00Z') })
        ]);
        // The Sunday-night run: 23:30 CT Sunday = 00:30 ET Monday, which the
        // calendar calls week 11.
        const out = await job.run({ now: new Date('2027-01-11T05:30:00Z') });
        expect(out.done.join(' ')).toContain('wk10');
        expect(await weekOf2(SEASON, 10)).toBe(5);
    });

    test('a late West Coast Saturday tip is scored too', async () => {
        // 22:00 PT Saturday is 01:00 ET Sunday, so the Eastern day is
        // Sunday and the week is N — the same hole.
        await manager('Wst', [2]);
        await HoopsGame.create([
            finalGame(232, 50, 51, true, { week: 1, startDate: new Date('2026-11-02'), status: 'scheduled' }),
            finalGame(233, 2, 1, true, { week: 6, startDate: new Date('2026-12-13T06:00:00Z') })
        ]);
        const out = await job.run({ now: new Date('2026-12-14T05:30:00Z') });
        expect(out.done.join(' ')).toContain('wk6');
        expect(await weekOf2(SEASON, 6)).toBe(5);
    });

    test('a missed night is caught up, not lost', async () => {
        await manager('Mis', [2]);
        await HoopsGame.create([
            finalGame(234, 50, 51, true, { week: 1, startDate: new Date('2026-11-02'), status: 'scheduled' }),
            finalGame(235, 2, 1, true, { week: 5, startDate: new Date('2026-12-05') }),
            finalGame(236, 2, 3, true, { week: 6, startDate: new Date('2026-12-07') })
        ]);
        // Two nights later: both weeks still inside the lookback.
        const out = await job.run({ now: new Date('2026-12-07T23:30:00Z') });
        expect(out.done.join(' ')).toContain('wk5');
        expect(out.done.join(' ')).toContain('wk6');
    });

    test('a result older than the lookback is not rescored every night', async () => {
        await manager('Old', [2]);
        await HoopsGame.create([
            finalGame(237, 50, 51, true, { week: 1, startDate: new Date('2026-11-02'), status: 'scheduled' }),
            finalGame(238, 2, 1, true, { week: 2, startDate: new Date('2026-11-10') })
        ]);
        const out = await job.run({ now: new Date('2026-12-20T23:30:00Z') });
        expect(out.done.join(' ')).not.toContain('wk2');
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

describe('the season total', () => {
    // Standings reads cumulativeScore, NOT the weekly entries. Without it a
    // league with six weeks of real scores rendered every manager on 0 and
    // tied — while League Highlights, which does read the weekly entries,
    // showed the right numbers two inches below it on the same page. Found
    // by clicking, not by a test.
    const totalOf = async (accountId) => {
        const f = await Franchise.findOne({ accountId, league: LEAGUE }).lean();
        return (f.seasons || []).find(s => s.season === SEASON).cumulativeScore;
    };

    test('is written alongside the week', async () => {
        const me = await manager('Cum', [2]);
        await HoopsGame.create(finalGame(300, 2, 1, true));
        await scoreHoopsWeek(LEAGUE, { season: SEASON, week: WEEK });
        expect(await totalOf(me._id)).toBe(5);
    });

    test('and ADDS UP across weeks', async () => {
        const me = await manager('Sum', [2, 3]);
        await HoopsGame.create([
            finalGame(301, 2, 1, true),                                   // Q1 home win: 5
            finalGame(302, 3, 1, true, { id: 302, week: WEEK + 1 })        // another: 5
        ]);
        await scoreHoopsWeek(LEAGUE, { season: SEASON, week: WEEK });
        await scoreHoopsWeek(LEAGUE, { season: SEASON, week: WEEK + 1 });
        expect(await totalOf(me._id)).toBe(10);
    });

    test('re-scoring a week does not inflate it', async () => {
        // Recomputed from what is stored, never accumulated — a delta would
        // drift every time a week is re-run, which is routine.
        const me = await manager('Redo', [2]);
        await HoopsGame.create(finalGame(303, 2, 1, true));
        for (let i = 0; i < 3; i++) await scoreHoopsWeek(LEAGUE, { season: SEASON, week: WEEK });
        expect(await totalOf(me._id)).toBe(5);
    });

    test('and a corrected result moves it DOWN as well as up', async () => {
        const me = await manager('Down', [2]);
        await HoopsGame.create(finalGame(304, 2, 1, true));
        await scoreHoopsWeek(LEAGUE, { season: SEASON, week: WEEK });
        expect(await totalOf(me._id)).toBe(5);

        // The result is corrected to a loss.
        await HoopsGame.updateOne({ id: 304 }, { $set: { homePoints: 60, awayPoints: 70 } });
        await scoreHoopsWeek(LEAGUE, { season: SEASON, week: WEEK });
        expect(await totalOf(me._id)).toBe(0);
    });

    test('a franchise that is not there is a no-op, not a crash', async () => {
        const { writeCumulative } = require('../modules/hoops-scoring-pass');
        const ghost = new (require('mongoose')).Types.ObjectId();
        await expect(writeCumulative(LEAGUE, ghost, SEASON)).resolves.toBeUndefined();

        // A franchise that DOES exist but has no entry for that season:
        // the $elemMatch projection returns a document with no `seasons`
        // key at all, which is a different path from "no document".
        const real = await manager('Noseason', [2]);
        await expect(writeCumulative(LEAGUE, real._id, 1999)).resolves.toBeUndefined();
    });

    test('a season with no weeks yet totals 0 rather than throwing', async () => {
        const { writeCumulative } = require('../modules/hoops-scoring-pass');
        const me = await manager('Fresh', [2]);
        await writeCumulative(LEAGUE, me._id, SEASON);
        const f = await Franchise.findOne({ accountId: me._id, league: LEAGUE }).lean();
        expect(f.seasons.find(s => s.season === SEASON).cumulativeScore).toBe(0);
    });

    test('a week with an unusable score counts as zero, not NaN', async () => {
        // One bad row must not turn the whole season total into NaN, which
        // renders as blank and is impossible to trace back.
        const { writeCumulative } = require('../modules/hoops-scoring-pass');
        const me = await manager('Nan', [2]);
        await Franchise.updateOne(
            { accountId: me._id, league: LEAGUE, 'seasons.season': SEASON },
            { $set: { 'seasons.$.weeklyScore': [
                { week: 1, score: 5, scoreByTeam: [] },
                { week: 2, scoreByTeam: [] },
                { week: 3, score: 3, scoreByTeam: [] }
            ] } });
        await writeCumulative(LEAGUE, me._id, SEASON);
        const f = await Franchise.findOne({ accountId: me._id, league: LEAGUE }).lean();
        expect(f.seasons.find(s => s.season === SEASON).cumulativeScore).toBe(8);
    });

    test('a manager with nothing scored is 0, not absent', async () => {
        const me = await manager('Zero', [1]);
        await scoreHoopsWeek(LEAGUE, { season: SEASON, week: WEEK });
        expect(await totalOf(me._id)).toBe(0);
    });
});
