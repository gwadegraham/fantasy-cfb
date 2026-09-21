// The fan-out half of the "your weekly recap is ready" push:
// modules/push-notify.js notifyRecapReady, against an in-memory Mongo.
//
// The recap itself comes from GET /standings/recap, which needs the whole
// league's season plus games, spreads, rankings and weather to place one
// manager's week in context. That endpoint has its own coverage; here it is
// stubbed at the network seam so these tests are about WHO gets told and
// WHETHER they get told twice.

jest.mock('web-push', () => ({
    setVapidDetails: jest.fn(),
    sendNotification: jest.fn(() => Promise.resolve({ statusCode: 201 }))
}));

process.env.YEAR = '2026';
process.env.URL = 'http://test.local';
process.env.VAPID_PUBLIC_KEY = 'test-public-key';
process.env.VAPID_PRIVATE_KEY = 'test-private-key';

const webpush = require('web-push');
const { useMongo } = require('./helpers/mongo');
const User = require('../models/user');
const push = require('../modules/push-notify');

useMongo();

const SEASON = 2026;
const LEAGUE = 'graham-league';
// A Monday in September — inside the Aug–Jan recap season the in-app popup uses.
const MONDAY = Date.parse('2026-09-28T12:05:00Z');
// July: the offseason, when the popup stays quiet and so should this.
const OFFSEASON = Date.parse('2026-07-13T12:05:00Z');

const device = (tag) => ({
    endpoint: `https://web.push.apple.com/${tag}`,
    keys: { p256dh: 'BPublicKeyBytes', auth: 'AuthSecret' },
    userAgent: 'iPhone', createdAt: new Date()
});

function manager(first, extra = {}) {
    return User.create(Object.assign({
        firstName: first, lastName: 'Test', league: LEAGUE,
        pushSubscriptions: [device(first)],
        seasons: [{ season: SEASON, teams: [] }]
    }, extra));
}

const recap = (o) => Object.assign({ week: 4, effWeek: 4, label: 'Week 4', score: 26, rank: 2 }, o);

// Route every recap lookup to one payload, or to a per-user map keyed by id.
function stubRecap(payloadOrFn, status = 200) {
    global.fetch = jest.fn((url) => {
        const id = String(url).split('/').pop();
        const body = typeof payloadOrFn === 'function' ? payloadOrFn(id) : payloadOrFn;
        return Promise.resolve({ status, json: () => Promise.resolve(body) });
    });
}

const payloads = () => webpush.sendNotification.mock.calls.map(c => JSON.parse(c[1]));

beforeEach(() => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    webpush.sendNotification.mockClear();
    stubRecap({ recaps: [recap()] });
});
afterEach(() => jest.restoreAllMocks());

describe('notifyRecapReady — who gets one', () => {
    it('tells a subscribed manager their week is written up', async () => {
        await manager('Ann');

        const res = await push.notifyRecapReady(MONDAY);

        expect(res).toMatchObject({ due: 1, sent: 1 });
        expect(payloads()[0].type).toBe('recapReady');
        expect(payloads()[0].title).toBe('📖 Week 4 recap is ready');
    });

    it('skips a manager who muted this alert type', async () => {
        await manager('Ann', { pushPrefs: { recapReady: false } });
        expect(await push.notifyRecapReady(MONDAY)).toMatchObject({ due: 0, sent: 0 });
    });

    it('still tells a manager who muted the noisy in-game alerts', async () => {
        await manager('Ann', { pushPrefs: { score: false, leadChange: false, final: false } });
        expect(await push.notifyRecapReady(MONDAY)).toMatchObject({ sent: 1 });
    });

    it('skips a manager with no registered device', async () => {
        await manager('Ann', { pushSubscriptions: [] });
        expect(await push.notifyRecapReady(MONDAY)).toMatchObject({ due: 0, sent: 0 });
    });

    // Unlike the Captain lock there is no per-league gate — both leagues get
    // recaps — so a manager in the classic league is told too.
    it('is not gated on a league opting into Captain or H2H', async () => {
        await manager('Ann', { league: 'claunts-league' });
        expect(await push.notifyRecapReady(MONDAY)).toMatchObject({ sent: 1 });
    });

    // An empty recap list is the preseason answering honestly.
    it('says nothing when the season has not been played', async () => {
        stubRecap({ recaps: [] });
        await manager('Ann');
        expect(await push.notifyRecapReady(MONDAY)).toMatchObject({ due: 0, sent: 0 });
    });

    it('stays quiet in the offseason, like the in-app popup', async () => {
        await manager('Ann');
        expect(await push.notifyRecapReady(OFFSEASON)).toMatchObject({ skipped: 'offseason', sent: 0 });
    });

    it('sends each manager their own recap, not the first one it loaded', async () => {
        const ann = await manager('Ann');
        const bob = await manager('Bob');
        stubRecap(id => ({
            recaps: [recap(String(ann._id) === id ? { score: 26, rank: 2 } : { score: 11, rank: 6 })]
        }));

        await push.notifyRecapReady(MONDAY);

        const bodies = payloads().map(p => p.body).sort();
        expect(bodies[0]).toContain('11 points · 6th');
        expect(bodies[1]).toContain('26 points · 2nd');
        expect(payloads().map(p => p.url).sort())
            .toEqual([`/userHome?user=${ann._id}#recap`, `/userHome?user=${bob._id}#recap`].sort());
    });
});

describe('notifyRecapReady — exactly once per week', () => {
    it('does not tell the same manager twice about one recap', async () => {
        await manager('Ann');

        const first = await push.notifyRecapReady(MONDAY);
        const second = await push.notifyRecapReady(MONDAY + 12 * 3600 * 1000);   // the evening retry

        expect(first.sent).toBe(1);
        expect(second).toMatchObject({ due: 0, sent: 0 });
        expect(payloads()).toHaveLength(1);
    });

    it('records the notice against the season and week', async () => {
        const ann = await manager('Ann');
        await push.notifyRecapReady(MONDAY);

        const saved = await User.findById(ann._id).lean();
        expect(saved.recapNotices).toHaveLength(1);
        expect(saved.recapNotices[0]).toMatchObject({ season: SEASON, week: 4 });
    });

    // Dedupe is on the recap's WEEK, not on when the job ran — so a week whose
    // scoring was late is still announced by the retry rather than skipped.
    it('announces the next week when one arrives', async () => {
        await manager('Ann');
        await push.notifyRecapReady(MONDAY);
        webpush.sendNotification.mockClear();

        stubRecap({ recaps: [recap(), recap({ week: 5, effWeek: 5, label: 'Week 5' })] });
        const res = await push.notifyRecapReady(MONDAY + 7 * 24 * 3600 * 1000);

        expect(res.sent).toBe(1);
        expect(payloads()[0].title).toBe('📖 Week 5 recap is ready');
    });

    it('does not log a notice that reached no device', async () => {
        const ann = await manager('Ann');
        webpush.sendNotification.mockRejectedValueOnce(Object.assign(new Error('gone'), { statusCode: 410 }));

        const res = await push.notifyRecapReady(MONDAY);

        expect(res.sent).toBe(0);
        const saved = await User.findById(ann._id).lean();
        expect(saved.recapNotices || []).toHaveLength(0);
    });
});

describe('notifyRecapReady — degrading', () => {
    // One manager's recap failing must not cost everyone else theirs.
    it('skips a manager whose recap lookup fails and carries on', async () => {
        const ann = await manager('Ann');
        await manager('Bob');
        global.fetch = jest.fn((url) => String(url).endsWith(String(ann._id))
            ? Promise.resolve({ status: 500, json: () => Promise.resolve({ message: 'boom' }) })
            : Promise.resolve({ status: 200, json: () => Promise.resolve({ recaps: [recap()] }) }));

        const res = await push.notifyRecapReady(MONDAY);

        expect(res).toMatchObject({ due: 1, sent: 1 });
    });

    it('never throws when the recap endpoint is unreachable', async () => {
        global.fetch = jest.fn(() => Promise.reject(new Error('ECONNREFUSED')));
        await manager('Ann');

        await expect(push.notifyRecapReady(MONDAY)).resolves.toMatchObject({ sent: 0 });
    });
});
