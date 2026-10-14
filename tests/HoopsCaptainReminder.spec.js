// The Captain lock reminder on a basketball league (modules/push-notify.js
// notifyHoopsCaptainLocks): the lock is the manager's first TIP-OFF from
// `hoopsgames`, the link opens the basketball league, and the ledger is the
// basketball franchise's own.

// Mocked: the real VAPID keys are in .env and jest loads it — an unmocked
// send would fire a real HTTPS request.
jest.mock('web-push', () => ({
    setVapidDetails: jest.fn(),
    sendNotification: jest.fn(() => Promise.resolve({ statusCode: 201 }))
}));
jest.mock('../modules/scoring', () => {
    const actual = jest.requireActual('../modules/scoring');
    return Object.assign({}, actual, { getScoringConfig: jest.fn() });
});

process.env.VAPID_PUBLIC_KEY = 'test-public-key';
process.env.VAPID_PRIVATE_KEY = 'test-private-key';

const webpush = require('web-push');
const { useMongo } = require('./helpers/mongo');
const Account = require('../models/account');
const Franchise = require('../models/franchise');
const League = require('../models/league');
const SportSeason = require('../models/sportSeason');
const HoopsGame = require('../models/hoopsGame');
const HoopsTeam = require('../models/hoopsTeam');
const scoring = require('../modules/scoring');
const seasons = require('../modules/active-season');
const push = require('../modules/push-notify');

useMongo();

const LEAGUE = 'hoops-league';
const SEASON = 2027;
const H = 3600 * 1000;
// Team 1's TBD Tuesday game locks at midnight Eastern: 05:00Z.
const LOCK = Date.parse('2026-11-03T05:00:00Z');

const payloads = () => webpush.sendNotification.mock.calls.map(c => JSON.parse(c[1]));

async function manager(first, teamIds, extra = {}) {
    const a = await Account.create({
        firstName: first, lastName: 'M', email: `${first}@example.invalid`,
        pushSubscriptions: [{ endpoint: `https://web.push.apple.com/${first}`, keys: { p256dh: 'k', auth: 'a' }, createdAt: new Date() }]
    });
    await Franchise.create({ accountId: a._id, league: LEAGUE,
        seasons: [Object.assign({ season: SEASON, teamRefs: teamIds.map(id => ({ id, sport: 'basketball' })) }, extra)] });
    return a;
}

beforeEach(async () => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    webpush.sendNotification.mockClear();
    scoring.getScoringConfig.mockResolvedValue({ engagementBySeason: { [String(SEASON)]: { captainEnabled: true } } });
    await League.create({ code: LEAGUE, name: 'Hardwood Heroes', sport: 'basketball' });
    await SportSeason.create([
        { sport: 'football', season: 2026, status: 'in-season' },
        { sport: 'basketball', season: SEASON, status: 'in-season' }
    ]);
    await seasons.prime();
    await HoopsTeam.create([{ id: 1, season: SEASON, school: 'Hoops One' }, { id: 2, season: SEASON, school: 'Hoops Two' }]);
    const g = (id, week, home, startDate, tbd) => ({ id, season: SEASON, week, seasonType: 'regular', status: 'scheduled',
        startDate, startTimeTbd: !!tbd, homeTeamId: home, awayTeamId: 90 });
    await HoopsGame.create([
        g(1, 1, 1, '2026-11-03T05:00:00Z', true),
        g(2, 1, 2, '2026-11-06T00:30:00Z'),
        g(3, 2, 1, '2026-11-10T00:30:00Z')
    ]);
});
afterEach(() => { seasons._reset(); jest.restoreAllMocks(); });

test('reminds before the first tip-off, a TBD one included, and links to the league', async () => {
    const ann = await manager('Ann', [1, 2], { captains: [{ week: 1, teamId: 2 }] });
    const res = await push.notifyCaptainLocks(LOCK - 1 * H);
    expect(res).toMatchObject({ due: 1, sent: 1 });
    const p = payloads()[0];
    expect(p.url).toBe(`/userHome?user=${ann._id}&league=${LEAGUE}#captain`);
    expect(p.tag).toBe('captain-lock-hoops-w1');
    expect(p.body).toContain('Hoops Two');
    const f = await Franchise.findOne({ accountId: ann._id, league: LEAGUE }).lean();
    expect(f.captainReminders.map(r => [r.season, r.week])).toEqual([[SEASON, 1]]);
});

test('once only per week', async () => {
    await manager('Ann', [1, 2]);
    await push.notifyCaptainLocks(LOCK - 1 * H);
    const again = await push.notifyCaptainLocks(LOCK - 0.5 * H);
    expect(again.sent).toBe(0);
});

test('no pick names the default team', async () => {
    await manager('Ann', [1, 2]);
    await push.notifyCaptainLocks(LOCK - 1 * H);
    expect(payloads()[0].body).toContain('Hoops One goes in by default');
});

test('a league with Captain off is never reminded', async () => {
    scoring.getScoringConfig.mockResolvedValue({ engagementBySeason: {} });
    await manager('Ann', [1, 2]);
    expect(await push.notifyCaptainLocks(LOCK - 1 * H)).toMatchObject({ due: 0, sent: 0 });
});

test('outside the window, nothing', async () => {
    await manager('Ann', [1, 2]);
    expect((await push.notifyCaptainLocks(LOCK - 5 * H)).sent).toBe(0);
});
