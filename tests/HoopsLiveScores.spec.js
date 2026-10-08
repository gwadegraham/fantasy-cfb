// Basketball results refreshing on their own (#505): the scoreboard writer,
// the live poller around it, and the nightly refresh under both.
//
// Before #505 nothing called POST /hoops/games/refresh, so in production no
// basketball game would ever have gone final. Every CBBD call here is stubbed.

const { useMongo } = require('./helpers/mongo');
const scoreboard = require('../modules/hoops-scoreboard');
const livePoll = require('../modules/hoops-live-poll');
const boxScore = require('../modules/hoops-box-score');
const scoringPass = require('../modules/hoops-scoring-pass');
const scoresJob = require('../modules/hoops-scores-job');
const hoopsGames = require('../routes/hoopsGames');
const cbbd = require('../modules/cbbd-client');
const jobLogger = require('../modules/job-logger');
const HoopsGame = require('../models/hoopsGame');
const League = require('../models/league');
const SportSeason = require('../models/sportSeason');
const seasons = require('../modules/active-season');

useMongo();

const LEAGUE = 'hoops-league';
const SEASON = 2027;
const TIP = new Date(Date.UTC(2026, 10, 18, 0, 0));            // 7 PM Eastern
const DURING = new Date(TIP.getTime() + 60 * 60 * 1000);

const game = (id, o = {}) => Object.assign({
    id, season: SEASON, week: 3, seasonType: 'regular', status: 'scheduled',
    startDate: TIP, startTimeTbd: false, homeTeamId: 1, homeTeam: 'Duke', awayTeamId: 2, awayTeam: 'Texas'
}, o);

// A CBBD ScoreboardGame (shape from its published spec).
const row = (id, status, home, away, o = {}) => Object.assign({
    id, status, period: 2, clock: '8:43',
    homeTeam: { id: 1, points: home, lineScores: home == null ? null : [30, home - 30] },
    awayTeam: { id: 2, points: away, lineScores: away == null ? null : [28, away - 28] }
}, o);

let logged;
beforeEach(async () => {
    livePoll._flush._reset();
    livePoll._resetErrors();
    await League.create({ code: LEAGUE, name: 'Hardwood Heroes', sport: 'basketball' });
    await SportSeason.create([{ sport: 'football', season: 2026, status: 'in-season' }, { sport: 'basketball', season: SEASON, status: 'in-season' }]);
    await seasons.prime();
    logged = [];
    jest.spyOn(jobLogger, 'startRun').mockResolvedValue('run-1');
    jest.spyOn(jobLogger, 'finishRun').mockImplementation(async (id, status, msg) => logged.push({ status, msg }));
    jest.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => { seasons._reset(); jest.restoreAllMocks(); delete process.env.LIVE_POLL_ENABLED; });

describe('updateFor (one scoreboard row)', () => {
    test('a scheduled game\'s 0-0 is NOT stored as a score', () => {
        expect(scoreboard.updateFor(row(1, 'scheduled', 0, 0), { status: 'postponed' })).toEqual({ status: 'scheduled' });
        expect(scoreboard.updateFor(row(1, 'scheduled', 0, 0), { status: 'scheduled' })).toBeNull();     // nothing changed
    });

    test('only what CHANGED is written', () => {
        const stored = { status: 'in_progress', homePoints: 55, awayPoints: 50, homePeriodPoints: [30, 25], awayPeriodPoints: [28, 22], period: 2, clock: '8:43' };
        expect(scoreboard.updateFor(row(1, 'in_progress', 55, 50), stored)).toBeNull();
        expect(scoreboard.updateFor(row(1, 'in_progress', 55, 50, { clock: '8:10' }), stored)).toEqual({ clock: '8:10' });
    });

    test('in progress: running points, half scores, half and clock', () => {
        expect(scoreboard.updateFor(row(1, 'in_progress', 55, 50), { status: 'scheduled' })).toEqual({
            status: 'in_progress', homePoints: 55, awayPoints: 50,
            homePeriodPoints: [30, 25], awayPeriodPoints: [28, 22], period: 2, clock: '8:43'
        });
    });

    test('final: winners set; a tie (impossible, so a bad row) sets none', () => {
        expect(scoreboard.updateFor(row(1, 'final', 75, 60), {})).toMatchObject({ status: 'final', homeWinner: true, awayWinner: false });
        expect(scoreboard.updateFor(row(1, 'final', 70, 70), {}).homeWinner).toBeUndefined();
    });

    test('a stored final is never walked back by a lagging scoreboard', () => {
        expect(scoreboard.updateFor(row(1, 'in_progress', 70, 60), { status: 'final' })).toBeNull();
    });

    test('a row with no id or status is ignored', () => {
        expect(scoreboard.updateFor({ status: 'final' })).toBeNull();
        expect(scoreboard.updateFor({ id: 1 })).toBeNull();
    });
});

describe('applyScoreboard', () => {
    test('writes our games, ignores others, and reports a final only on the transition', async () => {
        await HoopsGame.create([game(10), game(11)]);
        const first = await scoreboard.applyScoreboard([row(10, 'final', 75, 60), row(11, 'in_progress', 40, 41), row(999, 'final', 1, 0)]);
        expect(first).toMatchObject({ rows: 3, matched: 2, mismatched: 0, updated: 2 });
        expect(first.newlyFinal).toEqual([{ id: 10, week: 3, season: SEASON, seasonType: 'regular' }]);
        const stored = await HoopsGame.findOne({ id: 10 }).lean();
        expect(stored).toMatchObject({ status: 'final', homePoints: 75, awayPoints: 60, homeWinner: true });
        expect((await HoopsGame.findOne({ id: 11 }).lean())).toMatchObject({ status: 'in_progress', period: 2, clock: '8:43' });
        // The same final again is not new.
        const again = await scoreboard.applyScoreboard([row(10, 'final', 75, 60)]);
        expect(again.newlyFinal).toEqual([]);
    });

    // The id is assumed to be /games' id; the TEAMS are what make it this
    // game. A partial id collision must not finalise somebody else's game.
    test('a row whose teams disagree with the stored game is never written', async () => {
        await HoopsGame.create(game(10));
        const out = await scoreboard.applyScoreboard([row(10, 'final', 75, 60, { homeTeam: { id: 99, points: 75 }, awayTeam: { id: 98, points: 60 } })]);
        expect(out).toMatchObject({ matched: 0, mismatched: 1, updated: 0, newlyFinal: [] });
        expect((await HoopsGame.findOne({ id: 10 }).lean()).status).toBe('scheduled');
    });

    test('nothing to apply', async () => {
        expect(await scoreboard.applyScoreboard([])).toEqual({ rows: 0, matched: 0, mismatched: 0, updated: 0, newlyFinal: [] });
        expect(await scoreboard.applyScoreboard(null)).toMatchObject({ rows: 0 });
    });
});

describe('the live poller', () => {
    const stubBoard = (rows) => jest.spyOn(cbbd, 'cbbdGet').mockImplementation(async (path) => {
        if (path !== '/scoreboard') throw new Error('unexpected billable call ' + path);
        return { data: rows };
    });

    test('off when LIVE_POLL_ENABLED=false; silent with no basketball league', async () => {
        process.env.LIVE_POLL_ENABLED = 'false';
        expect(await livePoll.run({ now: DURING })).toEqual({ skipped: 'disabled' });
        delete process.env.LIVE_POLL_ENABLED;
        await League.deleteMany({});
        await seasons.prime();
        expect(await livePoll.run({ now: DURING })).toEqual({ skipped: 'no basketball leagues' });
    });

    test('no active basketball season: skipped, not "no games"', async () => {
        jest.spyOn(seasons, 'activeSeason').mockReturnValue(null);
        expect(await livePoll.run({ now: DURING })).toEqual({ skipped: 'no active basketball season' });
    });

    test('no game in progress: no CBBD call and no JobRun', async () => {
        await HoopsGame.create(game(10, { startDate: new Date(DURING.getTime() + 3600e3) }));        // not tipped yet
        const get = stubBoard([]);
        expect(await livePoll.run({ now: DURING })).toEqual({ skipped: 'no game in progress' });
        expect(get).not.toHaveBeenCalled();
        expect(logged).toEqual([]);
    });

    test('a TBD tip is never "in progress"', async () => {
        await HoopsGame.create(game(10, { startTimeTbd: true }));
        const get = stubBoard([]);
        expect((await livePoll.run({ now: DURING })).skipped).toBe('no game in progress');
        expect(get).not.toHaveBeenCalled();
    });

    test('a game on: the free scoreboard updates it, a final queues, and the batch waits for quiet', async () => {
        await HoopsGame.create([game(10), game(11)]);
        stubBoard([row(10, 'final', 75, 60), row(11, 'in_progress', 40, 41)]);
        const box = jest.spyOn(boxScore, 'ingestRecent');
        const out = await livePoll.run({ now: DURING });
        expect(out.summary).toBe('2 of 2 scoreboard games matched, 2 updated, 1 final, 1 pending');
        expect(box).not.toHaveBeenCalled();                                  // held for the quiet window
        expect(logged).toEqual([{ status: 'success', msg: out.summary }]);
    });

    test('once quiet, the batch runs: box scores, then every league rescored for the week', async () => {
        await HoopsGame.create([game(10), game(11)]);
        stubBoard([row(10, 'final', 75, 60), row(11, 'in_progress', 40, 41)]);
        jest.spyOn(boxScore, 'ingestRecent').mockResolvedValue({ games: 1, stored: 1 });
        const score = jest.spyOn(scoringPass, 'scoreHoopsWeek').mockResolvedValue({ games: 1 });
        await livePoll.run({ now: DURING });
        const later = new Date(DURING.getTime() + 3 * 60 * 1000);           // past the 2-minute quiet window
        const out = await livePoll.run({ now: later });
        expect(score).toHaveBeenCalledWith(LEAGUE, { season: SEASON, week: 3 });
        expect(out.summary).toContain('settled · boxes 1/1 | hoops-league wk3: 1 game(s)');
    });

    test('the slate ends with finals still queued: it drains', async () => {
        await HoopsGame.create(game(10));
        stubBoard([row(10, 'final', 75, 60)]);
        jest.spyOn(boxScore, 'ingestRecent').mockResolvedValue({ games: 1, stored: 1 });
        jest.spyOn(scoringPass, 'scoreHoopsWeek').mockResolvedValue({ games: 1 });
        await livePoll.run({ now: DURING });                                   // queues the final; nothing live now
        const out = await livePoll.run({ now: new Date(DURING.getTime() + 10e3) });
        expect(out.drained).toBe(true);
        expect(out.summary).toMatch(/^Slate over — settled 1 game\(s\)/);
        expect(livePoll._flush.pendingCount()).toBe(0);
    });

    test('a scoreboard matching NONE of our games is an error, not a quiet night', async () => {
        await HoopsGame.create(game(10, { status: 'in_progress' }));
        stubBoard([row(555, 'in_progress', 10, 8)]);
        const out = await livePoll.run({ now: DURING });
        expect(out.failed).toBe('no scoreboard game matched a stored game');
        expect(logged[0].status).toBe('error');
    });

    // The real case: a busy night where the SAME scoreboard comes back on
    // consecutive ticks. (An empty scoreboard proved nothing — the first
    // version of this test used one, and a JobRun-per-tick bug passed it.)
    test('a tick over an unchanged scoreboard writes nothing and records no JobRun', async () => {
        await HoopsGame.create(game(10));
        const write = jest.spyOn(HoopsGame, 'bulkWrite');
        stubBoard([row(10, 'in_progress', 40, 41)]);
        await livePoll.run({ now: DURING });
        expect(write).toHaveBeenCalledTimes(1);                               // the first tick wrote the score
        write.mockClear();
        const out = await livePoll.run({ now: new Date(DURING.getTime() + 30e3) });
        expect(out.summary).toBe('1 of 1 scoreboard games matched, 0 updated');
        expect(write).not.toHaveBeenCalled();
        expect(logged).toEqual([]);                                           // neither tick is a JobRun
    });

    test('a final whose score an earlier poll already stored is still a NEW final', async () => {
        await HoopsGame.create(game(10));
        stubBoard([row(10, 'in_progress', 75, 60)]);
        await livePoll.run({ now: DURING });
        cbbd.cbbdGet.mockResolvedValue({ data: [row(10, 'final', 75, 60)] });
        const out = await livePoll.run({ now: new Date(DURING.getTime() + 30e3) });
        expect(out.summary).toContain('1 final');
    });

    test('a postseason final is queued as postseason', async () => {
        await HoopsGame.create(game(10, { seasonType: 'postseason' }));
        stubBoard([row(10, 'final', 75, 60)]);
        const add = jest.spyOn(livePoll._flush, 'addPending');
        await livePoll.run({ now: DURING });
        expect(add).toHaveBeenCalledWith([10], { week: 3, seasonType: 'postseason' }, DURING.getTime());
    });

    test('one tick at a time: a tick that starts under a running one is skipped', async () => {
        await HoopsGame.create(game(10));
        let release;
        const get = jest.spyOn(cbbd, 'cbbdGet').mockImplementationOnce(() => new Promise(r => { release = () => r({ data: [] }); }));
        get.mockResolvedValue({ data: [] });                                  // later ticks answer at once
        const first = livePoll.run({ now: DURING });
        // Wait until the first tick is actually inside its scoreboard call.
        for (let i = 0; i < 200 && !release; i++) await new Promise(r => setTimeout(r, 10));
        expect(await livePoll.run({ now: DURING })).toEqual({ skipped: 'previous tick still running' });
        release();
        await first;
        expect((await livePoll.run({ now: new Date(DURING.getTime() + 60e3) })).skipped).not.toBe('previous tick still running');
    });

    test('a team mismatch is an error even when other rows matched', async () => {
        await HoopsGame.create([game(10), game(11)]);
        stubBoard([row(10, 'in_progress', 40, 41), row(11, 'in_progress', 30, 20, { homeTeam: { id: 77, points: 30 } })]);
        const out = await livePoll.run({ now: DURING });
        expect(out.failed).toBe('1 scoreboard game(s) matched an id but not its teams');
        expect(logged[0].status).toBe('error');
    });

    test('the same error is recorded once per 15 minutes, not every tick', async () => {
        await HoopsGame.create(game(10));
        jest.spyOn(cbbd, 'cbbdGet').mockRejectedValue(new Error('Could not reach CBBD'));
        await livePoll.run({ now: DURING });
        await livePoll.run({ now: new Date(DURING.getTime() + 30e3) });
        await livePoll.run({ now: new Date(DURING.getTime() + 60e3) });
        expect(logged).toHaveLength(1);
        await livePoll.run({ now: new Date(DURING.getTime() + livePoll.ERROR_EVERY_MS + 1) });
        expect(logged).toHaveLength(2);
    });

    test('a scoreboard outage is recorded', async () => {
        await HoopsGame.create(game(10));
        jest.spyOn(cbbd, 'cbbdGet').mockRejectedValue(new Error('Could not reach CBBD'));
        expect(await livePoll.run({ now: DURING })).toEqual({ error: 'Could not reach CBBD' });
        expect(logged[0]).toEqual({ status: 'error', msg: 'scoreboard: Could not reach CBBD' });
    });
});

describe('the live poller, after review', () => {
    const stubBoard = (rows) => jest.spyOn(cbbd, 'cbbdGet').mockResolvedValue({ data: rows });

    test('a running score moving is NOT a JobRun; a final is', async () => {
        await HoopsGame.create(game(10));
        stubBoard([row(10, 'in_progress', 40, 41)]);
        await livePoll.run({ now: DURING });
        expect(logged).toEqual([]);                                           // score moved, nothing to record
        cbbd.cbbdGet.mockResolvedValue({ data: [row(10, 'final', 75, 60)] });
        await livePoll.run({ now: new Date(DURING.getTime() + 30e3) });
        expect(logged).toHaveLength(1);
    });

    test('a batch fetches box scores for ITS games only', async () => {
        jest.spyOn(boxScore, 'ingestRecent').mockResolvedValue({ games: 2, stored: 2 });
        jest.spyOn(scoringPass, 'scoreHoopsWeek').mockResolvedValue({ games: 1 });
        await livePoll.completionWork(SEASON, [{ week: 3, gameIds: [10, 11] }, { week: 4, gameIds: [12] }], DURING.getTime());
        expect(boxScore.ingestRecent).toHaveBeenCalledWith(SEASON, { now: DURING.getTime(), gameIds: [10, 11, 12] });
    });

    test('a batch that could not be scored goes back on the queue', async () => {
        await HoopsGame.create(game(10));
        stubBoard([row(10, 'final', 75, 60)]);
        jest.spyOn(boxScore, 'ingestRecent').mockResolvedValue({ games: 1, stored: 1 });
        await livePoll.run({ now: DURING });                                   // queued
        jest.spyOn(scoresJob, 'basketballLeagues')
            .mockResolvedValueOnce([{ league: LEAGUE, season: SEASON }])     // the gate's own lookup
            .mockRejectedValueOnce(new Error('M0 hiccup'));                  // completionWork's
        const out = await livePoll.run({ now: new Date(DURING.getTime() + 10e3) });   // nothing live: drain
        expect(out.failed).toBe('leagues: M0 hiccup');
        expect(livePoll._flush.pendingCount()).toBe(1);                       // kept, not lost
    });
});

describe('the final-guard cannot crash a request', () => {
    test('a failed check fails the write cleanly — a 500, not an escaped rejection', async () => {
        jest.spyOn(cbbd, 'fetchGamesInRange').mockResolvedValue({ games: [{ id: 10, season: SEASON, seasonType: 'regular', startDate: TIP.toISOString(), status: 'final', homeTeamId: 1, awayTeamId: 2, homeTeam: 'Duke', awayTeam: 'Texas', homePoints: 70, awayPoints: 60 }], capHits: [], windows: 1 });
        await HoopsGame.create(game(10));
        jest.spyOn(HoopsGame, 'distinct').mockRejectedValueOnce(new Error('connection reset'));
        const out = await hoopsGames.refreshResults({ season: SEASON, seasonType: 'regular', start: new Date(TIP.getTime() - 3600e3), end: new Date(TIP.getTime() + 3600e3) });
        expect(out.code).toBe(500);
        expect(out.body.message).toMatch(/connection reset/);
    });
});

describe('ingestRecent with gameIds', () => {
    test('narrows the batch to those games', async () => {
        await HoopsGame.create([
            game(10, { status: 'final', homePoints: 75, awayPoints: 60 }),
            game(11, { status: 'final', homePoints: 70, awayPoints: 60 })
        ]);
        const get = jest.spyOn(cbbd, 'cbbdGet').mockResolvedValue({ data: [] });
        const out = await boxScore.ingestRecent(SEASON, { now: DURING.getTime(), gameIds: [11] });
        expect(out.games).toBe(1);
        expect(get).toHaveBeenCalledTimes(2);
    });
});

describe('a stored final is never walked back by a refresh or ingest', () => {
    test('the result fields are kept; the rest of the row still updates', async () => {
        await HoopsGame.create(game(10, { status: 'final', homePoints: 75, awayPoints: 60, homeWinner: true, venue: 'Old' }));
        const ops = [{ updateOne: { filter: { id: 10 }, update: { $set: { id: 10, status: 'in_progress', homePoints: 70, venue: 'New' } }, upsert: true } },
                     { updateOne: { filter: { id: 11 }, update: { $set: { id: 11, status: 'in_progress' } }, upsert: true } }];
        const kept = await hoopsGames.keepStoredFinals(ops);
        expect(kept[0].updateOne.update.$set).toEqual({ id: 10, venue: 'New' });
        expect(kept[1]).toBe(ops[1]);                                          // not stored as final: untouched
    });

    test('a final arriving for a stored final is written as usual', async () => {
        await HoopsGame.create(game(10, { status: 'final', homePoints: 75, awayPoints: 60 }));
        const op = { updateOne: { filter: { id: 10 }, update: { $set: { id: 10, status: 'final', homePoints: 76 } } } };
        expect((await hoopsGames.keepStoredFinals([op]))[0]).toBe(op);         // a corrected final score still lands
    });
});

describe('completionWork', () => {
    test('a box failure does not stop the scoring, and is recorded', async () => {
        jest.spyOn(boxScore, 'ingestRecent').mockRejectedValue(new Error('CBBD 429'));
        const score = jest.spyOn(scoringPass, 'scoreHoopsWeek').mockResolvedValue({ games: 2 });
        const out = await livePoll.completionWork(SEASON, [{ week: 3, gameIds: [1] }], DURING.getTime());
        expect(score).toHaveBeenCalled();
        expect(out.failed).toBe('boxes: CBBD 429');
    });

    test('a capped box window and a failing league are both failures; other leagues still score', async () => {
        await League.create({ code: 'hoops-two', name: 'Two', sport: 'basketball' });
        await seasons.prime();
        jest.spyOn(boxScore, 'ingestRecent').mockResolvedValue({ games: 9, stored: 4, capped: true });
        const score = jest.spyOn(scoringPass, 'scoreHoopsWeek').mockImplementation(async (league) => {
            if (league === LEAGUE) throw new Error('boom');
            return { games: 1 };
        });
        const out = await livePoll.completionWork(SEASON, [{ week: 3, gameIds: [1] }], DURING.getTime());
        expect(score).toHaveBeenCalledTimes(2);
        expect(out.failed).toBe('hoops-league wk3: boom');
        expect(out.notes).toContain('hoops-two wk3: 1 game(s)');
    });
});

describe('the nightly safety net', () => {
    const NIGHT = new Date(Date.UTC(2026, 10, 19, 5, 30));

    test('refreshes the last 3 days of results before scoring — only the season types that can have results', async () => {
        const refresh = jest.spyOn(hoopsGames, 'refreshResults').mockResolvedValue({ code: 200, body: { finals: 4, games: 9 } });
        // Mid-season: a game in the window and more still to come, so the
        // regular season is not "just over".
        await HoopsGame.create([game(10), game(11, { startDate: new Date(NIGHT.getTime() + 30 * 24 * 3600e3) })]);
        await scoresJob.run({ now: NIGHT });
        expect(refresh).toHaveBeenCalledTimes(1);
        expect(refresh.mock.calls[0][0]).toMatchObject({ season: SEASON, seasonType: 'regular' });
        expect(refresh.mock.calls[0][0].end.getTime() - refresh.mock.calls[0][0].start.getTime()).toBe(scoresJob.LOOKBACK_MS);

        refresh.mockClear();
        await HoopsGame.create(game(20, { seasonType: 'postseason', startDate: new Date(NIGHT.getTime() - 3600e3) }));
        await scoresJob.run({ now: NIGHT });
        expect(refresh.mock.calls.map(c => c[0].seasonType)).toEqual(['regular', 'postseason']);
    });

    test('March: only postseason in the window — regular is not asked for (it 422ed every night)', async () => {
        const refresh = jest.spyOn(hoopsGames, 'refreshResults').mockResolvedValue({ code: 200, body: { finals: 1, games: 1 } });
        await HoopsGame.create([
            game(10, { startDate: new Date(NIGHT.getTime() - 10 * 24 * 3600e3) }),                     // regular season over
            game(20, { seasonType: 'postseason', startDate: new Date(NIGHT.getTime() - 3600e3) })
        ]);
        await scoresJob.run({ now: NIGHT });
        expect(refresh.mock.calls.map(c => c[0].seasonType)).toEqual(['postseason']);
    });

    test('just after the regular season, postseason is asked for even before any bracket game is stored', async () => {
        await HoopsGame.create(game(10, { startDate: new Date(NIGHT.getTime() - 5 * 24 * 3600e3) }));
        const t = await scoresJob.seasonTypesToRefresh(SEASON, new Date(NIGHT.getTime() - scoresJob.LOOKBACK_MS), NIGHT);
        expect(t).toEqual(['postseason']);
    });

    test('off-season (nothing scheduled, nothing just ended): no call at all', async () => {
        await HoopsGame.create(game(10, { startDate: new Date(NIGHT.getTime() - 200 * 24 * 3600e3) }));
        const t = await scoresJob.seasonTypesToRefresh(SEASON, new Date(NIGHT.getTime() - scoresJob.LOOKBACK_MS), NIGHT);
        expect(t).toEqual([]);
    });

    test('a failed refresh is a job ERROR — the failure is not swallowed', async () => {
        jest.spyOn(hoopsGames, 'refreshResults').mockResolvedValue({ code: 422, body: { message: 'CBBD returned no games' } });
        await HoopsGame.create(game(10, { status: 'final', homePoints: 70, awayPoints: 60, startDate: new Date(NIGHT.getTime() - 3600e3) }));
        jest.spyOn(scoringPass, 'scoreHoopsWeek');
        await scoresJob.run({ now: NIGHT });
        expect(logged.some(l => l.status === 'error' && l.msg.includes('refresh 422: CBBD returned no games'))).toBe(true);
    });

    test('a refresh that throws is recorded too', async () => {
        jest.spyOn(hoopsGames, 'refreshResults').mockRejectedValue(new Error('socket hang up'));
        await HoopsGame.create(game(10, { status: 'final', homePoints: 70, awayPoints: 60, startDate: new Date(NIGHT.getTime() - 3600e3) }));
        await scoresJob.run({ now: NIGHT });
        expect(logged.some(l => l.status === 'error' && l.msg.includes('refresh: socket hang up'))).toBe(true);
    });
});

describe('scheduling', () => {
    test('the basketball poller rides the same opt-in as football\'s, every 30 seconds', () => {
        const { HOOPS_LIVE_POLL_SCHEDULE, JOB_SCHEDULES } = require('../modules/scheduler');
        expect(HOOPS_LIVE_POLL_SCHEDULE).toMatchObject({ job: 'hoops-live', rule: { second: [0, 30] } });
        expect(JOB_SCHEDULES.find(s => s.job === 'hoops-live')).toBeUndefined();     // not always-on
    });
});

describe('the refresh\'s "games were due" guard', () => {
    // It counted every stored game in the window whatever its season type,
    // so an empty REGULAR fetch in March (only tournament games left) was
    // reported as CBBD failing — every night of the tournament.
    test('counts only the season type that was asked for', async () => {
        jest.spyOn(cbbd, 'fetchGamesInRange').mockResolvedValue({ games: [], capHits: [], windows: 1 });
        const start = new Date(TIP.getTime() - 3600e3), end = new Date(TIP.getTime() + 3600e3);
        await HoopsGame.create(game(20, { seasonType: 'postseason' }));
        expect((await hoopsGames.refreshResults({ season: SEASON, seasonType: 'regular', start, end })).code).toBe(200);
        expect((await hoopsGames.refreshResults({ season: SEASON, seasonType: 'postseason', start, end })).code).toBe(422);
    });
});
