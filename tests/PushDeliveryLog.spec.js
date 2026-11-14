// The push evidence trail: every send logged per device, receipts from the
// service worker, the manager's own setting changes, and the two readers
// (the manager's health check and the admin card).
//
// What it exists to prove in a dispute: whether a given alert was refused by
// the push service, accepted but never confirmed by the phone, or arrived —
// and whether the manager had changed their own settings in between.

jest.mock('web-push', () => ({
    setVapidDetails: jest.fn(),
    sendNotification: jest.fn(() => Promise.resolve({ statusCode: 201 }))
}));

process.env.VAPID_PUBLIC_KEY = 'test-public-key';
process.env.VAPID_PRIVATE_KEY = 'test-private-key';

const express = require('express');
const request = require('supertest');
const webpush = require('web-push');
const { useMongo } = require('./helpers/mongo');
const Account = require('../models/account');
const Franchise = require('../models/franchise');
const PushLog = require('../models/pushLog');
const push = require('../modules/push-notify');
const delivery = require('../modules/push-delivery');
const usersRouter = require('../routes/users');
const receiptRoute = require('../routes/push-receipt');
const deliveriesRoute = require('../routes/push-deliveries');

useMongo();

const PHONE = 'https://web.push.apple.com/phone-endpoint';
const LAPTOP = 'https://fcm.googleapis.com/fcm/send/laptop-endpoint';
const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.0.1 Mobile/15E148 Safari/604.1';
const sub = (endpoint, extra = {}) => Object.assign({
    endpoint, keys: { p256dh: 'BPublicKeyBytes', auth: 'AuthSecret' },
    userAgent: IPHONE_UA, createdAt: new Date('2026-11-01T21:34:56Z')
}, extra);

let account;

function appFor(acct) {
    const a = express();
    a.use(express.json());
    a.use((req, res, next) => {
        req.oidc = { isAuthenticated: () => true, user: { user_metadata: { roles: [], metadata: { userId: String(acct._id) } } } };
        next();
    });
    a.use('/users', usersRouter);
    a.use('/push/receipt', receiptRoute.build());
    a.use('/push-deliveries', deliveriesRoute.build());
    return a;
}

const sentPayloads = () => webpush.sendNotification.mock.calls.map(c => JSON.parse(c[1]));

beforeEach(async () => {
    webpush.sendNotification.mockReset();
    webpush.sendNotification.mockImplementation(() => Promise.resolve({ statusCode: 201 }));
    account = await Account.create({ firstName: 'Trevor', lastName: 'Test', email: 't@example.invalid',
        pushSubscriptions: [sub(PHONE), sub(LAPTOP, { userAgent: 'Mozilla/5.0 (Macintosh) Chrome/131.0.0.0 Safari/537.36' })] });
    await Franchise.create({ accountId: account._id, league: 'graham-league', seasons: [{ season: 2026, teams: [] }] });
    jest.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe('sendToUser logs every device', () => {
    test('one accepted row per device, each with its own sid carried in the payload', async () => {
        const out = await push.sendTest(String(account._id));
        expect(out.sent).toBe(2);
        const rows = await PushLog.find({ kind: 'send' }).lean();
        expect(rows).toHaveLength(2);
        expect(rows.every(r => r.status === 'accepted' && r.statusCode === 201 && r.type === 'test')).toBe(true);
        const sids = sentPayloads().map(p => p.sid);
        expect(new Set(sids).size).toBe(2);
        expect(sids.sort()).toEqual(rows.map(r => r.sendId).sort());
        // The endpoint itself is never stored.
        expect(JSON.stringify(rows)).not.toContain('phone-endpoint');
        expect(rows.map(r => r.deviceLabel).sort()).toEqual(['Mac · Chrome 131', 'iPhone · Safari 27.0.1']);
        // Expires on its own.
        expect(rows[0].expireAt.getTime()).toBeGreaterThan(Date.now() + 59 * 24 * 3600 * 1000);
    });

    test('a 410 is logged as gone, a 500 as failed', async () => {
        webpush.sendNotification
            .mockImplementationOnce(() => Promise.reject(Object.assign(new Error('Gone'), { statusCode: 410 })))
            .mockImplementationOnce(() => Promise.reject(Object.assign(new Error('boom'), { statusCode: 500, body: 'upstream' })));
        const out = await push.sendTest(String(account._id));
        expect(out.sent).toBe(0);
        const rows = await PushLog.find({ kind: 'send' }).sort({ statusCode: 1 }).lean();
        expect(rows.map(r => [r.status, r.statusCode])).toEqual([['gone', 410], ['failed', 500]]);
        expect(rows[1].error).toBe('upstream');
    });

    // A phone can answer while we are still sending to the manager's other
    // devices. The row must already exist, or that receipt is lost.
    test('a receipt that lands mid-send is kept', async () => {
        const app = appFor(account);
        webpush.sendNotification.mockImplementationOnce(async (subscription, body) => {
            const { sid } = JSON.parse(body);
            await request(app).post('/push/receipt').send({ sid, event: 'received' });
            return { statusCode: 201 };
        });
        await push.sendTest(String(account._id));
        const sid = sentPayloads()[0].sid;
        const row = await PushLog.findOne({ sendId: sid }).lean();
        expect(row.receivedAt).toBeInstanceOf(Date);
        expect(row.status).toBe('accepted');
    });

    test('a failed log write never costs the notification', async () => {
        jest.spyOn(PushLog, 'insertMany').mockRejectedValueOnce(new Error('db down'));
        jest.spyOn(PushLog, 'bulkWrite').mockRejectedValueOnce(new Error('db down'));
        const out = await push.sendTest(String(account._id));
        expect(out.sent).toBe(2);
    });
});

describe('POST /push/receipt', () => {
    let app, sid;
    beforeEach(async () => {
        app = appFor(account);
        await push.sendTest(String(account._id));
        sid = sentPayloads()[0].sid;
    });

    test('received stamps receivedAt once; a replay does not move it', async () => {
        expect((await request(app).post('/push/receipt').send({ sid, event: 'received' })).status).toBe(204);
        const first = (await PushLog.findOne({ sendId: sid }).lean()).receivedAt;
        expect(first).toBeInstanceOf(Date);
        await new Promise(r => setTimeout(r, 5));
        await request(app).post('/push/receipt').send({ sid, event: 'received' });
        expect((await PushLog.findOne({ sendId: sid }).lean()).receivedAt).toEqual(first);
    });

    test('opened also fills receivedAt when the receive post was lost', async () => {
        await request(app).post('/push/receipt').send({ sid, event: 'opened' });
        const row = await PushLog.findOne({ sendId: sid }).lean();
        expect(row.openedAt).toBeInstanceOf(Date);
        expect(row.receivedAt).toEqual(row.openedAt);
    });

    test('garbage is ignored and still answers 204', async () => {
        for (const body of [{ sid: 'nope', event: 'received' }, { sid, event: 'deleted' }, {}]) {
            expect((await request(app).post('/push/receipt').send(body)).status).toBe(204);
        }
        expect(await PushLog.countDocuments({ receivedAt: { $exists: true } })).toBe(0);
    });

    test('hello stamps receiptsSince on that subscription only, and only the first time', async () => {
        await request(app).post('/push/receipt').send({ event: 'hello', endpoint: PHONE });
        let acct = await Account.findById(account._id).lean();
        const stamp = acct.pushSubscriptions.find(s => s.endpoint === PHONE).receiptsSince;
        expect(stamp).toBeInstanceOf(Date);
        expect(acct.pushSubscriptions.find(s => s.endpoint === LAPTOP).receiptsSince).toBeUndefined();
        await request(app).post('/push/receipt').send({ event: 'hello', endpoint: PHONE });
        acct = await Account.findById(account._id).lean();
        expect(acct.pushSubscriptions.find(s => s.endpoint === PHONE).receiptsSince).toEqual(stamp);
        expect(await delivery.hello('http://not-https')).toBe(false);
    });
});

describe('the manager’s own setting changes are logged', () => {
    let app;
    beforeEach(() => { app = appFor(account); });
    const settings = () => PushLog.find({ kind: 'setting' }).sort({ at: 1 }).lean();

    test('muting Captain lock and changing the lead reads back in words', async () => {
        await request(app).patch('/users/me/push/prefs').send({ captainLock: false, captainLockLeadMinutes: 1440 });
        const [row] = await settings();
        expect(row.action).toBe('prefs');
        expect(row.detail).toBe('Captain lock: off; Captain lead: 120 min → 1440 min');
    });

    test('re-sending a value already in effect leaves no row', async () => {
        await request(app).patch('/users/me/push/prefs').send({ final: true });
        expect(await settings()).toHaveLength(0);
    });

    test('turning alerts off, registering a device, and a test send are each logged', async () => {
        await request(app).delete('/users/me/push').send({});
        await request(app).post('/users/me/push').set('User-Agent', IPHONE_UA)
            .send({ subscription: { endpoint: PHONE, keys: { p256dh: 'BPublicKeyBytes', auth: 'AuthSecret' } }, receipts: true });
        await request(app).post('/users/me/push/test');
        const rows = await settings();
        expect(rows.map(r => r.action)).toEqual(['alerts.off', 'device.registered', 'test']);
        expect(rows[1].deviceLabel).toBe('iPhone · Safari 27.0.1');
        // A client that posts receipts registers as receipt-capable.
        const acct = await Account.findById(account._id).lean();
        expect(acct.pushSubscriptions[0].receiptsSince).toBeInstanceOf(Date);
    });
});

describe('readers', () => {
    const H = 3600 * 1000;
    async function seedSends(endpoint, rows) {
        const device = delivery.deviceKey(endpoint);
        await PushLog.insertMany(rows.map((r, i) => Object.assign({
            kind: 'send', accountId: account._id, device, deviceLabel: 'iPhone · Safari 27.0.1',
            sendId: delivery.newSendId(), status: 'accepted', title: '🧢 Captain locks soon', week: 11,
            expireAt: new Date(Date.now() + 1e9)
        }, r)));
    }

    test('POST /users/me/push/health calls a silent device silent', async () => {
        await Account.updateOne({ _id: account._id, 'pushSubscriptions.endpoint': PHONE },
            { $set: { 'pushSubscriptions.$.receiptsSince': new Date(Date.now() - 48 * H) } });
        await seedSends(PHONE, [1, 2, 3].map(h => ({ at: new Date(Date.now() - h * H) }))
            .concat([{ at: new Date(Date.now() - 30 * H), receivedAt: new Date(Date.now() - 30 * H) }]));
        const res = await request(appFor(account)).post('/users/me/push/health').send({ endpoint: PHONE });
        expect(res.body).toMatchObject({ status: 'silent', silentStreak: 3 });
    });

    test('an endpoint the caller does not hold is unknown', async () => {
        const res = await request(appFor(account)).post('/users/me/push/health').send({ endpoint: 'https://x.invalid/other' });
        expect(res.body).toEqual({ status: 'unknown' });
    });

    test('GET /push-deliveries lists the silent manager first, with their settings', async () => {
        const ok = await Account.create({ firstName: 'Aaron', lastName: 'Fine', email: 'a@example.invalid',
            pushSubscriptions: [sub('https://web.push.apple.com/aaron')] });
        await PushLog.create({ kind: 'send', accountId: ok._id, device: delivery.deviceKey('https://web.push.apple.com/aaron'),
            sendId: delivery.newSendId(), status: 'accepted', at: new Date(Date.now() - 2 * H),
            receivedAt: new Date(), expireAt: new Date(Date.now() + 1e9) });
        await seedSends(PHONE, [1, 2, 3].map(h => ({ at: new Date(Date.now() - h * H) }))
            .concat([{ at: new Date(Date.now() - 30 * H), receivedAt: new Date(Date.now() - 30 * H) }]));
        await Account.updateOne({ _id: account._id, 'pushSubscriptions.endpoint': PHONE },
            { $set: { 'pushSubscriptions.$.receiptsSince': new Date(Date.now() - 48 * H) } });
        await delivery.recordSetting(account._id, 'prefs', { detail: 'Captain lock: off' });

        const res = await request(appFor(account)).get('/push-deliveries');
        expect(res.status).toBe(200);
        expect(res.body.managers.map(m => m.name)).toEqual(['Trevor Test', 'Aaron Fine']);
        const trevor = res.body.managers[0];
        expect(trevor.devices.find(d => d.label === 'iPhone · Safari 27.0.1').health.status).toBe('silent');
        expect(trevor.settings[0].detail).toBe('Captain lock: off');
    });

    test('sends to a device no longer registered still show, as removed', async () => {
        await seedSends('https://web.push.apple.com/old-dead', [{ at: new Date(Date.now() - H) }]);
        const { devices } = await delivery.summarize(account._id, [], {});
        expect(devices).toHaveLength(1);
        expect(devices[0].registered).toBe(false);
    });
});

describe('deviceLabel', () => {
    test.each([
        [IPHONE_UA, 'iPhone · Safari 27.0.1'],
        ['Mozilla/5.0 (Linux; Android 14) Chrome/130.0.1 Mobile', 'Android · Chrome 130'],
        ['Mozilla/5.0 (Windows NT 10.0) Edg/129.0.1', 'Windows · Edge 129'],
        ['Mozilla/5.0 (iPad) CriOS/128.0', 'iPad · Chrome 128'],
        ['Mozilla/5.0 (X11; Linux) Firefox/133.0', 'Browser · Firefox 133'],
        ['curl/8', 'Browser'],
        ['', 'Unknown device']
    ])('%s', (ua, label) => expect(delivery.deviceLabel(ua)).toBe(label));
});
