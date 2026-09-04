// End-to-end for the win-probability curve: does a sequence of poller ticks
// actually accumulate a usable series on the Game doc?
//
// The pure builders are unit-tested in Scoreboard.spec.js. What matters here is
// the write path — that $push coexists with the $set clears on the completion
// tick, that re-ticks don't duplicate points, and that the series survives the
// completion cleanup that nulls every other live field.

const { useMongo } = require('./helpers/mongo');
const Game = require('../models/game');
const { updateFromScoreboard } = require('../modules/scoreboard');

useMongo();

const GAME_ID = 401628455;

// One /scoreboard entry, in the real nested shape CFBD sends.
function sbGame(over = {}) {
    const { homeWP, awayWP, homePts, awayPts, ...rest } = over;
    return Object.assign({
        id: GAME_ID,
        status: 'in_progress',
        period: 3,
        clock: '7:42',
        situation: '3rd & 7 at LSU 32',
        lastPlay: 'Nussmeier pass complete for 8 yds',
        homeTeam: { id: 99, name: 'LSU', points: homePts != null ? homePts : 21, winProbability: homeWP },
        awayTeam: { id: 333, name: 'Alabama', points: awayPts != null ? awayPts : 17, winProbability: awayWP }
    }, rest);
}

// Stand in for the CFBD response so no test touches the network.
function stubScoreboard(games) {
    global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        headers: { get: () => '29000' },
        json: async () => games
    });
}

async function tick(over) {
    stubScoreboard([sbGame(over)]);
    return updateFromScoreboard();
}

async function snapshots() {
    const g = await Game.findOne({ id: GAME_ID }).lean();
    return g.wpSnapshots || [];
}

beforeEach(async () => {
    await Game.create({
        id: GAME_ID, season: 2026, week: 2, seasonType: 'regular',
        startDate: '2026-09-12T23:30:00.000Z', startTimeTbd: false,
        neutralSite: false, conferenceGame: true, completed: false,
        homeId: 99, homeTeam: 'LSU', awayId: 333, awayTeam: 'Alabama'
    });
});

afterEach(() => { delete global.fetch; });

describe('wpSnapshots accumulation', () => {
    it('appends a point on a live tick', async () => {
        await tick({ homeWP: 0.62, awayWP: 0.38 });

        const series = await snapshots();
        expect(series).toHaveLength(1);
        expect(series[0].homeWinProb).toBeCloseTo(0.62, 3);
        expect(series[0].period).toBe(3);
        expect(series[0].clock).toBe('7:42');
        expect(series[0].homePoints).toBe(21);
        expect(series[0].lastPlay).toBe('Nussmeier pass complete for 8 yds');
    });

    it('builds a series across successive ticks', async () => {
        await tick({ homeWP: 0.62, clock: '7:42' });
        await tick({ homeWP: 0.55, clock: '6:10' });
        await tick({ homeWP: 0.71, clock: '4:02' });

        const series = await snapshots();
        expect(series.map(s => s.clock)).toEqual(['7:42', '6:10', '4:02']);
        expect(series.map(s => Number(s.homeWinProb.toFixed(2)))).toEqual([0.62, 0.55, 0.71]);
    });

    // The poller fires on a wall clock; the game clock does not always move.
    it('does not append a second point for the same stopped-clock moment', async () => {
        await tick({ homeWP: 0.62, clock: '7:42' });
        await tick({ homeWP: 0.62, clock: '7:42' });

        expect(await snapshots()).toHaveLength(1);
    });

    it('does append when the probability moves under a stopped clock', async () => {
        await tick({ homeWP: 0.62, clock: '7:42' });
        await tick({ homeWP: 0.66, clock: '7:42' });

        expect(await snapshots()).toHaveLength(2);
    });

    it('records nothing before kickoff, when CFBD sends no probability', async () => {
        await tick({ status: 'scheduled', homeWP: null, awayWP: null, homePts: null, awayPts: null });

        expect(await snapshots()).toHaveLength(0);
    });
});

describe('wpSnapshots at completion', () => {
    it('closes the curve at 1 for a home win and keeps the earlier points', async () => {
        await tick({ homeWP: 0.62, clock: '7:42' });
        await tick({ status: 'completed', period: 4, homeWP: null, awayWP: null, homePts: 31, awayPts: 24 });

        const series = await snapshots();
        expect(series).toHaveLength(2);
        expect(series[0].homeWinProb).toBeCloseTo(0.62, 3);
        expect(series[1]).toMatchObject({ homeWinProb: 1, clock: '0:00', homePoints: 31, awayPoints: 24 });
    });

    it('closes the curve at 0 for an away win', async () => {
        await tick({ homeWP: 0.48, clock: '2:00' });
        await tick({ status: 'completed', period: 4, homeWP: null, homePts: 10, awayPts: 15 });

        const series = await snapshots();
        expect(series[series.length - 1].homeWinProb).toBe(0);
    });

    // liveHomeWinProb, situation and lastPlay are all nulled on completion. The
    // series must not be caught up in that cleanup — it is the archive.
    it('survives the completion cleanup that clears the other live fields', async () => {
        await tick({ homeWP: 0.62, clock: '7:42' });
        await tick({ status: 'completed', period: 4, homeWP: null, homePts: 31, awayPts: 24 });

        const g = await Game.findOne({ id: GAME_ID }).lean();
        expect(g.completed).toBe(true);
        expect(g.liveHomeWinProb).toBeNull();
        expect(g.lastPlay).toBeNull();
        expect(g.wpSnapshots.length).toBe(2);
    });

    // CFBD keeps returning finished games for the rest of the day, and the
    // poller keeps ticking them. That must not stack terminal points.
    it('does not append again when an already-final game is re-polled', async () => {
        await tick({ homeWP: 0.62, clock: '7:42' });
        await tick({ status: 'completed', period: 4, homeWP: null, homePts: 31, awayPts: 24 });
        await tick({ status: 'completed', period: 4, homeWP: null, homePts: 31, awayPts: 24 });
        await tick({ status: 'completed', period: 4, homeWP: null, homePts: 31, awayPts: 24 });

        expect(await snapshots()).toHaveLength(2);
    });

    it('still reports the game as newly completed on the completion tick', async () => {
        await tick({ homeWP: 0.62 });
        const res = await tick({ status: 'completed', period: 4, homeWP: null, homePts: 31, awayPts: 24 });

        expect(res.newlyCompleted).toEqual([GAME_ID]);
    });
});
