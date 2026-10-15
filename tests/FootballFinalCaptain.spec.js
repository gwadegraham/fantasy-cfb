// Football's final alert names the Captain bonus (#557, asked for alongside the
// basketball one): modules/push-notify.js notifyFinals. The Captain is resolved
// the way modules/scoring.js resolves it — the pick, else the auto-captain from
// earlier regular-season weeks — and only in the regular season, in a league
// playing Captain that season.

// Mocked: the real VAPID keys are in .env and jest loads it — an unmocked
// send would fire a real HTTPS request.
jest.mock('web-push', () => ({
    setVapidDetails: jest.fn(),
    sendNotification: jest.fn(() => Promise.resolve({ statusCode: 201 }))
}));
// The three scoring lookups go over HTTP; the explanation is fixed so the
// bonus arithmetic is what is under test.
jest.mock('../modules/scoring', () => {
    const actual = jest.requireActual('../modules/scoring');
    return Object.assign({}, actual, {
        getScoringConfig: jest.fn(),
        getRankingsForGame: jest.fn(async () => ({})),
        getBracketForGame: jest.fn(async () => null),
        explainGame: jest.fn(() => ({ total: 6, matched: [{ label: 'Win' }] }))
    });
});

process.env.VAPID_PUBLIC_KEY = 'test-public-key';
process.env.VAPID_PRIVATE_KEY = 'test-private-key';

const webpush = require('web-push');
const { useMongo } = require('./helpers/mongo');
const Account = require('../models/account');
const Franchise = require('../models/franchise');
const League = require('../models/league');
const SportSeason = require('../models/sportSeason');
const Game = require('../models/game');
const scoring = require('../modules/scoring');
const seasons = require('../modules/active-season');
const push = require('../modules/push-notify');

useMongo();

const LEAGUE = 'graham-league';
const SEASON = 2026;
const GAME_ID = 401628319;
const GEORGIA = 61, BAMA = 333, OREGON = 2483;

const bodies = () => webpush.sendNotification.mock.calls.map(c => JSON.parse(c[1]).body);
const team = (id) => ({ id, school: `Team${id}`, mascot: 'M', abbreviation: 'T', conference: 'SEC', color: '#000' });

async function manager(seasonExtra = {}) {
    const a = await Account.create({ firstName: 'Ann', lastName: 'M', email: 'ann@example.invalid',
        pushSubscriptions: [{ endpoint: 'https://web.push.apple.com/ann', keys: { p256dh: 'k', auth: 'a' }, createdAt: new Date() }] });
    await Franchise.create({ accountId: a._id, league: LEAGUE,
        seasons: [Object.assign({ season: SEASON, teams: [team(OREGON), team(GEORGIA)] }, seasonExtra)] });
    return a;
}

const captainMode = (on = true, multiplier = 2) => scoring.getScoringConfig.mockResolvedValue({
    model: 'graham', engagementBySeason: { [String(SEASON)]: { captainEnabled: on, captainMultiplier: multiplier } } });

beforeEach(async () => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    webpush.sendNotification.mockClear();
    delete process.env.PUSH_RECIPIENT_IDS;
    await League.create({ code: LEAGUE, name: 'Graham League', sport: 'football' });
    await SportSeason.create({ sport: 'football', season: SEASON, status: 'in-season' });
    await seasons.prime();
    // Straight to the collection: the schema requires a dozen fields this
    // alert never reads.
    await Game.collection.insertOne({ id: GAME_ID, season: SEASON, week: 5, seasonType: 'regular', completed: true,
        homeId: GEORGIA, homeTeam: 'Georgia', awayId: BAMA, awayTeam: 'Alabama', homePoints: 24, awayPoints: 21 });
});
afterEach(() => { seasons._reset(); jest.restoreAllMocks(); });

test('the picked Captain: the bonus is named and the headline includes it', async () => {
    captainMode();
    // The default would be Oregon, so only the pick makes it Georgia.
    await manager({ captains: [{ week: 5, teamId: GEORGIA }],
        weeklyScore: [{ week: 4, score: 9, scoreByTeam: [{ teamId: OREGON, score: 9 }, { teamId: GEORGIA, score: 0 }] }] });
    await push.notifyFinals([GAME_ID]);
    expect(bodies()).toEqual(['+12 pts — Win · 👑 Captain bonus +6 · Alabama 21 – Georgia 24']);
});

test('the multiplier is the league\'s: ×3 adds twice the base', async () => {
    captainMode(true, 3);
    await manager({ captains: [{ week: 5, teamId: GEORGIA }] });
    await push.notifyFinals([GAME_ID]);
    expect(bodies()[0]).toBe('+18 pts — Win · 👑 Captain bonus +12 · Alabama 21 – Georgia 24');
});

test('no pick: the auto-captain from earlier weeks is the one doubled', async () => {
    captainMode();
    // Georgia has the better prior average, so it is the default.
    await manager({ weeklyScore: [{ week: 4, score: 10, scoreByTeam: [{ teamId: GEORGIA, score: 9 }, { teamId: OREGON, score: 1 }] }] });
    await push.notifyFinals([GAME_ID]);
    expect(bodies()[0]).toContain('👑 Captain bonus +6');
});

test('a postseason week does not count toward the auto-captain', async () => {
    captainMode();
    // Week 4's regular row favours Georgia; a postseason row (which must be
    // ignored) would have tipped it to Oregon.
    await manager({ weeklyScore: [
        { week: 4, score: 9, scoreByTeam: [{ teamId: GEORGIA, score: 5 }, { teamId: OREGON, score: 4 }] },
        { week: 1, season: 'postseason', score: 40, scoreByTeam: [{ teamId: OREGON, score: 40 }] }
    ] });
    await push.notifyFinals([GAME_ID]);
    expect(bodies()[0]).toContain('👑 Captain bonus +6');
});

test('only weeks BEFORE this one pick the auto-captain', async () => {
    captainMode();
    // Week 4 favours Georgia; week 6 (not played yet as of this final) would
    // tip it to Oregon.
    await manager({ weeklyScore: [
        { week: 4, score: 9, scoreByTeam: [{ teamId: GEORGIA, score: 5 }, { teamId: OREGON, score: 4 }] },
        { week: 6, score: 40, scoreByTeam: [{ teamId: OREGON, score: 40 }] }
    ] });
    await push.notifyFinals([GAME_ID]);
    expect(bodies()[0]).toContain('👑 Captain bonus +6');
});

test('a different Captain: no bonus note', async () => {
    captainMode();
    await manager({ captains: [{ week: 5, teamId: OREGON }] });
    await push.notifyFinals([GAME_ID]);
    expect(bodies()).toEqual(['+6 pts — Win · Alabama 21 – Georgia 24']);
});

test('Captain off in the league: no bonus note', async () => {
    captainMode(false);
    await manager({ captains: [{ week: 5, teamId: GEORGIA }] });
    await push.notifyFinals([GAME_ID]);
    expect(bodies()[0]).not.toContain('Captain');
});

test('a postseason game is not doubled', async () => {
    captainMode();
    await Game.collection.updateOne({ id: GAME_ID }, { $set: { seasonType: 'postseason' } });
    await manager({ captains: [{ week: 5, teamId: GEORGIA }] });
    await push.notifyFinals([GAME_ID]);
    expect(bodies()[0]).not.toContain('Captain');
});

test('a Captain pick for a different week is not this week\'s', async () => {
    captainMode();
    await manager({ captains: [{ week: 4, teamId: OREGON }, { week: 5, teamId: OREGON }, { week: 6, teamId: GEORGIA }] });
    await push.notifyFinals([GAME_ID]);
    expect(bodies()[0]).not.toContain('Captain');
});
