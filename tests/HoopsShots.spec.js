// Basketball shot charts: modules/hoops-shots.js.
//
// What it must get right: each team's attempts folded onto ONE basket though
// teams change ends at half; free throws left out; one billable call per
// game, only for games with a drafted team, never again once complete; a
// game CBBD has not posted yet tried again, but not forever; and the page
// reading it without calling CBBD.
//
// cbbd.cbbdGet is always stubbed — jest loads the real .env, so an unstubbed
// call would bill the shared pool.

const { useMongo } = require('./helpers/mongo');
const shots = require('../modules/hoops-shots');
const cbbd = require('../modules/cbbd-client');
const franchiseRepo = require('../modules/franchise-repo');
const scoresJob = require('../modules/hoops-scores-job');
const gamePage = require('../modules/hoops-game-page');
const HoopsGame = require('../models/hoopsGame');
const HoopsShots = require('../models/hoopsShots');
const HoopsBoxScore = require('../models/hoopsBoxScore');

useMongo();

const SEASON = 2027;
const NOW = Date.UTC(2026, 10, 20, 12);
const HOME = 8, AWAY = 9;                     // Arkansas at home to someone

const game = (id, o = {}) => Object.assign({
    id, season: SEASON, week: 3, seasonType: 'regular', status: 'final', startTimeTbd: false,
    startDate: new Date(NOW - 20 * 3600e3), homeTeamId: HOME, homeTeam: 'Arkansas', awayTeamId: AWAY, awayTeam: 'Away U',
    homePoints: 80, awayPoints: 70, neutralSite: false, conferenceGame: false
}, o);

// A CBBD play: a field-goal attempt at full-court tenths-of-a-foot x/y.
const shot = (teamId, period, x, y, o = {}) => Object.assign({
    teamId, period, clock: '10:00', shootingPlay: true, scoringPlay: !!o.made,
    shotInfo: { shooter: { id: 1, name: 'Boogie Fland' }, made: false, range: 'jumper', assisted: false, location: { x, y } }
}, o.play || {}, { shotInfo: Object.assign({ shooter: { id: 1, name: 'Boogie Fland' }, made: !!o.made, range: o.range || 'jumper',
    assisted: !!o.assisted, location: o.location === undefined ? { x, y } : o.location }) });
const freeThrow = (teamId) => ({ teamId, period: 1, shootingPlay: true, shotInfo: { range: 'free_throw', made: true, location: { x: null, y: null } } });

// The box the chart is checked against: field-goal attempts per side.
const boxFor = (gameId, home, away) => HoopsBoxScore.create({ gameId, season: SEASON,
    home: { teamId: HOME, fgAtt: home }, away: { teamId: AWAY, fgAtt: away } });

function stubPlays(byGame) {
    return jest.spyOn(cbbd, 'cbbdGet').mockImplementation(async (path) => {
        const id = Number(path.split('/').pop());
        const answer = byGame[id];
        if (answer instanceof Error) throw answer;
        return { data: answer || [], remainingCalls: 1 };
    });
}

beforeEach(() => jest.spyOn(console, 'log').mockImplementation(() => {}));
afterEach(() => jest.restoreAllMocks());

describe('chartFrom: one half court, in feet', () => {
    test('a team attacking the FAR basket is turned round onto the near one', () => {
        const { shots: s } = shots.chartFrom([
            shot(HOME, 1, 52.5, 250, { range: 'rim', made: true }),     // home, near basket, 1st half
            shot(AWAY, 1, 887.5, 250, { range: 'rim' })                // away, far basket, 1st half
        ], game(1));
        expect(s.map(x => [x.teamId, x.x, x.y])).toEqual([[HOME, 25, 5.3], [AWAY, 25, 5.3]]);
    });

    test('teams change ends at half: both halves land on the same basket', () => {
        const { shots: s } = shots.chartFrom([
            shot(HOME, 1, 100, 300), shot(HOME, 1, 120, 280),
            shot(HOME, 2, 840, 200), shot(HOME, 2, 820, 220)
        ], game(1));
        expect(s.map(x => [x.x, x.y])).toEqual([[30, 10], [28, 12], [30, 10], [28, 12]]);
    });

    test('it is a turn, not a mirror: the shooter\'s left corner stays left', () => {
        // Far-end left corner (from the shooter) is high x, high y; turned round it is low x… low y.
        const { shots: s } = shots.chartFrom([shot(HOME, 2, 900, 470), shot(HOME, 2, 860, 250)], game(1));
        expect(s[0]).toMatchObject({ x: 3, y: 4 });
    });

    test('a heave from the far end stays with its team\'s end, pinned to the half line', () => {
        const { shots: s } = shots.chartFrom([
            shot(HOME, 1, 60, 250), shot(HOME, 1, 90, 250), shot(HOME, 1, 900, 250)   // two near, one from the far baseline
        ], game(1));
        expect(s[2]).toMatchObject({ y: 47 });
    });

    test('overtime is played toward the second half\'s end, even on one shot plus a heave', async () => {
        const { shots: s } = shots.chartFrom([
            shot(HOME, 2, 860, 250), shot(HOME, 2, 870, 240), shot(HOME, 2, 850, 260),        // 2nd half: far end
            shot(HOME, 3, 880, 250, { range: 'rim' }), shot(HOME, 3, 40, 250)                // OT: a rim shot and a heave
        ], game(1));
        expect(s[3]).toMatchObject({ y: 6 });                                                // the rim shot stays at the rim
        expect(s[4]).toMatchObject({ y: 47 });                                               // the heave is the long one
    });

    test('a half with too few attempts takes the opposite of the other half\'s end', async () => {
        const { shots: s } = shots.chartFrom([
            shot(AWAY, 1, 60, 250, { range: 'rim' }), shot(AWAY, 1, 900, 250),               // 1st half: 2 attempts, median mid-court
            shot(AWAY, 2, 860, 250), shot(AWAY, 2, 870, 240), shot(AWAY, 2, 850, 260)        // 2nd half: far end, so 1st was near
        ], game(1));
        expect(s[0]).toMatchObject({ y: 6 });
        expect(s[1]).toMatchObject({ y: 47 });
    });

    test('free throws are left out; unlocated attempts count but are not drawn; other games\' plays ignored', () => {
        const out = shots.chartFrom([
            shot(HOME, 1, 60, 250), shot(HOME, 1, 0, 0, { location: { x: null, y: null } }),
            freeThrow(HOME), shot(777, 1, 60, 250), { teamId: HOME, shootingPlay: false }
        ], game(1));
        expect(out.attempts).toEqual({ home: 2, away: 0 });
        expect(out.shots).toHaveLength(1);
    });

    test('keeps what the chart shows: shooter, made, zone, assisted, half and clock', () => {
        const { shots: s } = shots.chartFrom([shot(HOME, 2, 60, 250, { made: true, range: 'three_pointer', assisted: true, play: { clock: '4:12' } })], game(1));
        expect(s[0]).toEqual({ teamId: HOME, athleteId: 1, shooter: 'Boogie Fland', made: true, range: 'three_pointer',
            assisted: true, period: 2, clock: '4:12', x: 25, y: 6 });
    });
});

describe('ingestShots: what gets fetched', () => {
    const drafted = { teamIds: [HOME] };

    test('a final with a drafted team: one call, stored complete', async () => {
        await HoopsGame.create(game(1));
        await boxFor(1, 1, 1);
        const get = stubPlays({ 1: [shot(HOME, 1, 60, 250, { made: true }), shot(AWAY, 1, 880, 250)] });

        const out = await shots.ingestShots(SEASON, Object.assign({ now: NOW }, drafted));

        expect(get).toHaveBeenCalledTimes(1);
        expect(get).toHaveBeenCalledWith('/plays/game/1');
        expect(out).toMatchObject({ games: 1, stored: 1, calls: 1 });
        expect(await HoopsShots.findOne({ gameId: 1 }).lean()).toMatchObject({ complete: true, fetches: 1, attempts: { home: 1, away: 1 } });
    });

    test('no drafted team in the game: no call', async () => {
        await HoopsGame.create(game(1, { homeTeamId: 50, awayTeamId: 51 }));
        const get = stubPlays({});

        expect((await shots.ingestShots(SEASON, Object.assign({ now: NOW }, drafted))).skippedReason).toBe('no drafted team played');
        expect(get).not.toHaveBeenCalled();
    });

    test('complete once: never fetched again', async () => {
        await HoopsGame.create(game(1));
        await boxFor(1, 1, 0);
        const get = stubPlays({ 1: [shot(HOME, 1, 60, 250)] });
        await shots.ingestShots(SEASON, Object.assign({ now: NOW }, drafted));
        await shots.ingestShots(SEASON, Object.assign({ now: NOW }, drafted));

        expect(get).toHaveBeenCalledTimes(1);
    });

    test('not posted yet (empty): tried again, up to MAX_FETCHES, then left alone', async () => {
        await HoopsGame.create(game(1));
        const get = stubPlays({ 1: [] });
        for (let i = 0; i < shots.MAX_FETCHES + 2; i++) await shots.ingestShots(SEASON, Object.assign({ now: NOW }, drafted));

        expect(get).toHaveBeenCalledTimes(shots.MAX_FETCHES);
        expect(await HoopsShots.findOne({ gameId: 1 }).lean()).toMatchObject({ complete: false, fetches: shots.MAX_FETCHES });
    });

    test('no box score yet: stored and shown, but NOT complete — part-posted plays must not freeze', async () => {
        await HoopsGame.create(game(1));
        const get = stubPlays({ 1: [shot(HOME, 1, 60, 250)] });

        expect((await shots.ingestShots(SEASON, Object.assign({ now: NOW }, drafted))).partial).toBe(1);
        expect(await HoopsShots.findOne({ gameId: 1 }).lean()).toMatchObject({ complete: false, fetches: 1 });
        await boxFor(1, 1, 0);
        expect((await shots.ingestShots(SEASON, Object.assign({ now: NOW }, drafted))).stored).toBe(1);
        expect(get).toHaveBeenCalledTimes(2);
    });

    test('a CBBD error still uses one of the game\'s fetches: no endless re-billing', async () => {
        await HoopsGame.create(game(1));
        const get = stubPlays({ 1: Object.assign(new Error('CBBD /plays/game/1 503'), { status: 503 }) });
        for (let i = 0; i < shots.MAX_FETCHES + 2; i++) await shots.ingestShots(SEASON, Object.assign({ now: NOW }, drafted));

        expect(get).toHaveBeenCalledTimes(shots.MAX_FETCHES);
        expect(await HoopsShots.findOne({ gameId: 1 }).lean()).toMatchObject({ complete: false, fetches: shots.MAX_FETCHES });
    });

    test('fewer attempts than the box score: stored, but incomplete and tried again', async () => {
        await HoopsGame.create(game(1));
        await HoopsBoxScore.create({ gameId: 1, season: SEASON, home: { teamId: HOME, fgAtt: 2 }, away: { teamId: AWAY, fgAtt: 0 } });
        const get = stubPlays({ 1: [shot(HOME, 1, 60, 250)] });

        expect((await shots.ingestShots(SEASON, Object.assign({ now: NOW }, drafted))).partial).toBe(1);
        expect(await HoopsShots.findOne({ gameId: 1 }).lean()).toMatchObject({ complete: false, shots: [expect.any(Object)] });
        await shots.ingestShots(SEASON, Object.assign({ now: NOW }, drafted));
        expect(get).toHaveBeenCalledTimes(2);
    });

    test('not final, or older than the lookback: not fetched', async () => {
        await HoopsGame.create([
            game(1, { status: 'in_progress' }),
            game(2, { startDate: new Date(NOW - shots.LOOKBACK_MS - 3600e3) })
        ]);
        const get = stubPlays({});

        await shots.ingestShots(SEASON, Object.assign({ now: NOW }, drafted));
        expect(get).not.toHaveBeenCalled();
    });

    test('gameIds narrows it to the batch that just went final', async () => {
        await HoopsGame.create([game(1), game(2)]);
        const get = stubPlays({ 1: [shot(HOME, 1, 60, 250)], 2: [shot(HOME, 1, 60, 250)] });

        await shots.ingestShots(SEASON, Object.assign({ now: NOW, gameIds: [2] }, drafted));
        expect(get.mock.calls).toEqual([['/plays/game/2']]);
    });

    test('a run is capped at MAX_PER_RUN calls; the rest wait', async () => {
        const n = shots.MAX_PER_RUN + 3;
        await HoopsGame.create(Array.from({ length: n }, (_, i) => game(i + 1)));
        const get = stubPlays({});

        const out = await shots.ingestShots(SEASON, Object.assign({ now: NOW }, drafted));
        expect(get).toHaveBeenCalledTimes(shots.MAX_PER_RUN);
        expect(out.deferred).toBe(3);
    });

    test('CBBD refusing one game does not cost the others', async () => {
        await HoopsGame.create([game(1), game(2)]);
        await boxFor(2, 1, 0);
        stubPlays({ 1: Object.assign(new Error('CBBD /plays/game/1 500'), { status: 500 }), 2: [shot(HOME, 1, 60, 250)] });

        const out = await shots.ingestShots(SEASON, Object.assign({ now: NOW }, drafted));
        expect(out).toMatchObject({ failed: 1, stored: 1, error: 'CBBD /plays/game/1 500' });
    });

    test('CBBD unreachable: thrown, so the job records it', async () => {
        await HoopsGame.create([game(1), game(2)]);
        const get = stubPlays({ 1: Object.assign(new Error('Could not reach CBBD'), { unreachable: true }) });

        await expect(shots.ingestShots(SEASON, Object.assign({ now: NOW }, drafted))).rejects.toThrow('Could not reach CBBD');
        expect(get).toHaveBeenCalledTimes(1);
    });
});

describe('rosteredTeamIds: every basketball roster this season', () => {
    test('across leagues, deduplicated, this season only', async () => {
        jest.spyOn(scoresJob, 'basketballLeagues').mockResolvedValue([{ league: 'a', season: SEASON }, { league: 'b', season: SEASON }, { league: 'old', season: 2026 }]);
        const ref = (id) => ({ id, sport: 'basketball' });
        const by = jest.spyOn(franchiseRepo, 'byLeagueAndSeason').mockImplementation(async (league) => ({
            a: [{ seasons: [{ season: SEASON, teamRefs: [ref(8), ref(9)] }] }],
            b: [{ seasons: [{ season: SEASON, teamRefs: [ref(9), ref(10)] }] }]
        })[league] || []);

        expect([...(await shots.rosteredTeamIds(SEASON))].sort()).toEqual([10, 8, 9]);
        expect(by.mock.calls.map(c => c[0])).toEqual(['a', 'b']);
    });
});

describe('the game page', () => {
    test('a final carries its chart, split by side, without calling CBBD', async () => {
        await HoopsGame.create(game(1));
        await HoopsShots.create({ gameId: 1, season: SEASON, complete: true, attempts: { home: 1, away: 1 },
            shots: [{ teamId: HOME, made: true, x: 25, y: 6, range: 'rim' }, { teamId: AWAY, made: false, x: 3, y: 4, range: 'three_pointer' }] });
        const get = jest.spyOn(cbbd, 'cbbdGet');

        const page = await gamePage.build(1);
        expect(page.shots).toMatchObject({ complete: true, attempts: { home: 1, away: 1 },
            home: [{ made: true, x: 25, y: 6 }], away: [{ made: false, range: 'three_pointer' }] });
        expect(page.shots.home[0].teamId).toBeUndefined();
        expect(get).not.toHaveBeenCalled();
    });

    test('no chart stored, or a game still to play: shots is null', async () => {
        await HoopsGame.create([game(1), game(2, { status: 'scheduled', homePoints: null, awayPoints: null })]);
        await HoopsShots.create({ gameId: 2, season: SEASON, shots: [{ teamId: HOME, made: true, x: 1, y: 1 }] });

        expect((await gamePage.build(1)).shots).toBeNull();
        expect((await gamePage.build(2)).shots).toBeNull();
    });
});

describe('the game page: points by half before any box score', () => {
    test('a live game carries the scoreboard\'s half scores', async () => {
        await HoopsGame.create(game(1, { status: 'in_progress', homePoints: 58, awayPoints: 41, period: 2, clock: '11:42',
            homePeriodPoints: [39, 19], awayPeriodPoints: [27, 14] }));
        const page = await gamePage.build(1);
        expect(page.game).toMatchObject({ live: true, lines: { home: [39, 19], away: [27, 14] } });
    });

    test('a game still to play, or a side with none: null', async () => {
        await HoopsGame.create([
            game(1, { status: 'scheduled', homePoints: null, awayPoints: null, homePeriodPoints: [0], awayPeriodPoints: [0] }),
            game(2, { status: 'in_progress', homePeriodPoints: [12], awayPeriodPoints: [] })
        ]);
        expect((await gamePage.build(1)).game.lines).toBeNull();
        expect((await gamePage.build(2)).game.lines).toBeNull();
    });
});
