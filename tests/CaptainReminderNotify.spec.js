// The fan-out half of the Captain lock reminder: modules/push-notify.js
// notifyCaptainLocks, against an in-memory Mongo.
//
// This is the part that can wake up the wrong phone, or the right phone five
// times, so the properties pinned here are the ones a manager would notice:
// only leagues that play Captain, only managers who haven't muted it, only
// inside their own two-hour window, and exactly once per week.

// web-push is mocked because the real VAPID keys are in .env and jest loads it
// for any worker that has touched a job file — an unmocked send would fire a
// genuine HTTPS request at the fake endpoints below.
jest.mock('web-push', () => ({
    setVapidDetails: jest.fn(),
    sendNotification: jest.fn(() => Promise.resolve({ statusCode: 201 }))
}));

// getScoringConfig reads a league's saved config from Mongo. Stubbed so these
// tests state the league's Captain setting directly instead of reconstructing a
// whole scoring document to express one boolean.
jest.mock('../modules/scoring', () => {
    const actual = jest.requireActual('../modules/scoring');
    return Object.assign({}, actual, { getScoringConfig: jest.fn() });
});

process.env.YEAR = '2026';
process.env.VAPID_PUBLIC_KEY = 'test-public-key';
process.env.VAPID_PRIVATE_KEY = 'test-private-key';

const webpush = require('web-push');
const { useMongo } = require('./helpers/mongo');
const User = require('../models/user');
const Game = require('../models/game');
const scoring = require('../modules/scoring');
const push = require('../modules/push-notify');

useMongo();

const SEASON = 2026;
const LEAGUE = 'graham-league';
const MIAMI = 2390, GEORGIA = 61, OREGON = 2483;

// A manager's earliest kickoff that week IS the lock, so these two games give
// the roster below a lock at 23:30Z on the Saturday.
const LOCK = Date.parse('2026-09-26T23:30:00Z');
const H = 3600 * 1000;

function fullTeam(id, school) {
    return {
        id, school, mascot: 'M', abbreviation: school.slice(0, 3).toUpperCase(),
        conference: 'ACC', color: '#000', logos: [`${school}.png`],
        location: { venue_id: id, name: 'V', city: 'C', state: 'ST', zip: '1', latitude: 1, longitude: 1, capacity: 100, grass: true, dome: false }
    };
}

const device = (tag) => ({
    endpoint: `https://web.push.apple.com/${tag}`,
    keys: { p256dh: 'BPublicKeyBytes', auth: 'AuthSecret' },
    userAgent: 'iPhone', createdAt: new Date()
});

function manager(first, teams, extra = {}) {
    const season = Object.assign(
        { season: SEASON, teams: teams.map(t => fullTeam(t, `Team${t}`)) },
        extra.season || {}
    );
    return User.create(Object.assign({
        firstName: first, lastName: 'Test', league: LEAGUE,
        pushSubscriptions: [device(first)],
        seasons: [season]
    }, extra.user || {}));
}

// A week-4 slate: Miami kicks at 23:30Z, Georgia later, Oregon on the Friday.
function seedGames() {
    const g = (id, week, homeId, awayId, startDate) => ({
        id, season: SEASON, week, seasonType: 'regular', startDate, startTimeTbd: false,
        neutralSite: false, conferenceGame: false,
        homeId, homeTeam: `Team${homeId}`, awayId, awayTeam: `Team${awayId}`
    });
    return Game.create([
        g(1, 4, MIAMI, 999, '2026-09-26T23:30:00.000Z'),
        g(2, 4, GEORGIA, 998, '2026-09-27T03:00:00.000Z'),
        g(3, 4, OREGON, 997, '2026-09-25T23:00:00.000Z'),
        // A later week, so captainFocusWeek has somewhere to advance to.
        g(4, 5, MIAMI, 996, '2026-10-03T23:30:00.000Z')
    ]);
}

const payloads = () => webpush.sendNotification.mock.calls.map(c => JSON.parse(c[1]));

beforeEach(async () => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    webpush.sendNotification.mockClear();
    scoring.getScoringConfig.mockResolvedValue({ engagementBySeason: { '2026': { captainEnabled: true } } });
    await seedGames();
});
afterEach(() => jest.restoreAllMocks());

describe('notifyCaptainLocks — who gets one', () => {
    it('reminds a manager inside their own two-hour window', async () => {
        await manager('Ann', [MIAMI]);

        const res = await push.notifyCaptainLocks(LOCK - 1 * H);

        expect(res).toMatchObject({ due: 1, sent: 1 });
        expect(payloads()[0].type).toBe('captainLock');
    });

    it('stays silent while the lock is still more than two hours out', async () => {
        await manager('Ann', [MIAMI]);
        expect(await push.notifyCaptainLocks(LOCK - 3 * H)).toMatchObject({ due: 0, sent: 0 });
        expect(await push.notifyCaptainLocks(LOCK - 8 * H)).toMatchObject({ due: 0, sent: 0 });
    });

    it('stays silent once the pick has locked', async () => {
        await manager('Ann', [MIAMI]);
        const res = await push.notifyCaptainLocks(LOCK + H);
        expect(res.sent).toBe(0);
    });

    // The lock is the manager's OWN earliest kickoff, so two managers in one
    // league are due at different instants. Oregon plays Friday; an hour before
    // the Saturday lock, Oregon's manager is a day past theirs.
    it('uses each manager\'s own earliest kickoff, not a league-wide deadline', async () => {
        await manager('Ann', [MIAMI]);
        await manager('Bob', [OREGON]);

        const res = await push.notifyCaptainLocks(LOCK - 1 * H);

        expect(res.due).toBe(1);
        expect(payloads()).toHaveLength(1);
        expect(payloads()[0].body).toContain('Team2390');   // Ann's roster, not Bob's
    });

    // Captain is a per-league opt-in. A league playing the classic game has no
    // pick to lock, and telling its managers otherwise advertises a mechanic
    // they do not have.
    it('skips leagues that have not turned Captain on', async () => {
        scoring.getScoringConfig.mockResolvedValue({ engagementBySeason: { '2026': { captainEnabled: false } } });
        await manager('Ann', [MIAMI]);

        const res = await push.notifyCaptainLocks(LOCK - 1 * H);

        expect(res).toMatchObject({ due: 0, sent: 0 });
    });

    it('skips a manager who muted this alert type', async () => {
        await manager('Ann', [MIAMI], { user: { pushPrefs: { captainLock: false } } });
        const res = await push.notifyCaptainLocks(LOCK - 1 * H);
        expect(res.sent).toBe(0);
    });

    it('still reminds a manager who muted only the noisy in-game alerts', async () => {
        await manager('Ann', [MIAMI], { user: { pushPrefs: { score: false, leadChange: false } } });
        const res = await push.notifyCaptainLocks(LOCK - 1 * H);
        expect(res.sent).toBe(1);
    });

    it('skips a manager with no registered device', async () => {
        await manager('Ann', [MIAMI], { user: { pushSubscriptions: [] } });
        const res = await push.notifyCaptainLocks(LOCK - 1 * H);
        expect(res).toMatchObject({ due: 0, sent: 0 });
    });

    it('skips a manager with no roster for the active season', async () => {
        await manager('Ann', [], { season: { teams: [] } });
        const res = await push.notifyCaptainLocks(LOCK - 1 * H);
        expect(res.sent).toBe(0);
    });
});

// The reminder goes to everyone with a game that week, set or unset — the body
// is what differs.
describe('notifyCaptainLocks — what it says', () => {
    // Verified against the running app: this exact path opens the Captain drawer.
    it('deep links to the recipient\'s own profile, not the app root', async () => {
        const ann = await manager('Ann', [MIAMI]);

        await push.notifyCaptainLocks(LOCK - 1 * H);

        expect(payloads()[0].url).toBe(`/userHome?user=${ann._id}#captain`);
    });

    it('names an existing pick', async () => {
        await manager('Ann', [MIAMI, GEORGIA], { season: { captains: [{ week: 4, teamId: GEORGIA }] } });

        await push.notifyCaptainLocks(LOCK - 1 * H);

        expect(payloads()[0].body).toContain('Team61');
        expect(payloads()[0].body).toContain('Change it');
    });

    it('names the auto-captain default when nothing is set', async () => {
        await manager('Ann', [MIAMI, GEORGIA], {
            season: {
                weeklyScore: [{ week: 3, score: 45, scoreByTeam: [{ teamId: GEORGIA, score: 40 }, { teamId: MIAMI, score: 5 }] }]
            }
        });

        await push.notifyCaptainLocks(LOCK - 1 * H);

        expect(payloads()[0].body).toContain('No pick yet');
        expect(payloads()[0].body).toContain('Team61');   // the hot hand
    });

    it('quotes the time actually left, not the two-hour lead', async () => {
        await manager('Ann', [MIAMI]);
        await push.notifyCaptainLocks(LOCK - 40 * 60000);
        expect(payloads()[0].body).toContain('40 minutes');
    });
});

// The lead is per manager, so two people with the same lock are due at very
// different moments. This is the half that a global window would get wrong.
describe('notifyCaptainLocks — each manager\'s own lead', () => {
    it('reminds a manager who asked for a day\'s notice, a day out', async () => {
        await manager('Ann', [MIAMI], { user: { pushPrefs: { captainLockLeadMinutes: 1440 } } });

        expect(await push.notifyCaptainLocks(LOCK - 20 * H)).toMatchObject({ due: 1, sent: 1 });
    });

    it('keeps a default-lead manager quiet at the same instant', async () => {
        await manager('Ann', [MIAMI]);                       // no pref: 2 hours
        expect(await push.notifyCaptainLocks(LOCK - 20 * H)).toMatchObject({ due: 0, sent: 0 });
    });

    it('holds a manager who asked for 30 minutes until 30 minutes out', async () => {
        await manager('Ann', [MIAMI], { user: { pushPrefs: { captainLockLeadMinutes: 30 } } });

        expect(await push.notifyCaptainLocks(LOCK - 1 * H)).toMatchObject({ due: 0, sent: 0 });
        expect(await push.notifyCaptainLocks(LOCK - 20 * 60000)).toMatchObject({ due: 1, sent: 1 });
    });

    it('sends two managers with one lock at the moment each of them chose', async () => {
        await manager('Ann', [MIAMI], { user: { pushPrefs: { captainLockLeadMinutes: 360 } } });
        await manager('Bob', [MIAMI], { user: { pushPrefs: { captainLockLeadMinutes: 60 } } });

        const early = await push.notifyCaptainLocks(LOCK - 5 * H);
        expect(early).toMatchObject({ due: 1, sent: 1 });     // Ann only

        webpush.sendNotification.mockClear();
        const late = await push.notifyCaptainLocks(LOCK - 30 * 60000);
        expect(late).toMatchObject({ due: 1, sent: 1 });      // Bob only
    });

    // A value that predates the allowlist, or was written around the schema, must
    // not silence the alert. Written through the raw driver precisely because
    // the model's enum refuses it — which is the guard working, not a reason to
    // assume no such document can exist.
    it('falls back to the default when the stored lead is unusable', async () => {
        const ann = await manager('Ann', [MIAMI]);
        await User.collection.updateOne({ _id: ann._id }, { $set: { 'pushPrefs.captainLockLeadMinutes': 0 } });

        expect(await push.notifyCaptainLocks(LOCK - 1 * H)).toMatchObject({ due: 1, sent: 1 });
    });
});

// The same property as the recap ledger, and the same reason it needs its own
// block: everything else here runs with FRANCHISE_READS unset, where the account
// and the franchise are one document and a misrouted write cannot be seen.
//
// captainReminders is read from the franchise. Written to the account instead,
// the dedupe never sees its own writes and every eligible manager is reminded
// again on every tick — and those sends cannot be recalled by flipping back.
describe('the reminder ledger dedupes from either source (#313 phase 3)', () => {
    const migration = require('../modules/account-migration');
    const Franchise = require('../models/franchise');
    const ORIGINAL = process.env.FRANCHISE_READS;
    afterEach(() => {
        if (ORIGINAL === undefined) delete process.env.FRANCHISE_READS;
        else process.env.FRANCHISE_READS = ORIGINAL;
    });

    it.each([['false'], ['true']])('a second tick reminds nobody, with the flag %s', async (flag) => {
        await manager('Ann', [MIAMI]);
        await migration.migrate({ apply: true });
        process.env.FRANCHISE_READS = flag;

        const first = await push.notifyCaptainLocks(LOCK - 1 * H);
        const second = await push.notifyCaptainLocks(LOCK - 30 * 60000);

        expect(first.sent).toBe(1);
        expect(second).toMatchObject({ due: 0, sent: 0 });
        expect(payloads()).toHaveLength(1);
    });

    it('flag ON records the send on the FRANCHISE, where the read looks', async () => {
        const ann = await manager('Ann', [MIAMI]);
        await migration.migrate({ apply: true });
        process.env.FRANCHISE_READS = 'true';

        await push.notifyCaptainLocks(LOCK - 1 * H);

        const fr = await Franchise.findOne({ accountId: ann._id }).lean();
        expect(fr.captainReminders).toHaveLength(1);
        expect(fr.captainReminders[0]).toMatchObject({ season: SEASON, week: 4 });
        expect((await require('../models/account').findById(ann._id).lean()).captainReminders).toBeUndefined();
    });
});

describe('notifyCaptainLocks — exactly once per week', () => {
    it('does not remind the same manager twice for the same week', async () => {
        await manager('Ann', [MIAMI]);

        const first = await push.notifyCaptainLocks(LOCK - 1 * H);
        const second = await push.notifyCaptainLocks(LOCK - 30 * 60000);

        expect(first.sent).toBe(1);
        expect(second).toMatchObject({ due: 0, sent: 0 });
        expect(payloads()).toHaveLength(1);
    });

    it('records the send against the season and week', async () => {
        const ann = await manager('Ann', [MIAMI]);
        await push.notifyCaptainLocks(LOCK - 1 * H);

        const saved = await User.findById(ann._id).lean();
        expect(saved.captainReminders).toHaveLength(1);
        expect(saved.captainReminders[0]).toMatchObject({ season: SEASON, week: 4 });
    });

    it('reminds again the following week', async () => {
        await manager('Ann', [MIAMI]);
        await push.notifyCaptainLocks(LOCK - 1 * H);
        webpush.sendNotification.mockClear();

        const wk5 = Date.parse('2026-10-03T23:30:00.000Z');
        const res = await push.notifyCaptainLocks(wk5 - 1 * H);

        expect(res.sent).toBe(1);
        expect(payloads()[0].body).toContain('week 5');
    });

    // A manager whose only device was pruned mid-send has NOT been reminded.
    // Logging the row anyway would mean they never are.
    it('does not log a reminder that reached no device', async () => {
        const ann = await manager('Ann', [MIAMI]);
        webpush.sendNotification.mockRejectedValueOnce(Object.assign(new Error('gone'), { statusCode: 410 }));

        const res = await push.notifyCaptainLocks(LOCK - 1 * H);

        expect(res.sent).toBe(0);
        const saved = await User.findById(ann._id).lean();
        expect(saved.captainReminders || []).toHaveLength(0);
    });
});

describe('notifyCaptainLocks — degrading', () => {
    it('never throws when the scoring config cannot be read', async () => {
        scoring.getScoringConfig.mockRejectedValue(new Error('config blew up'));
        await manager('Ann', [MIAMI]);

        await expect(push.notifyCaptainLocks(LOCK - 1 * H)).resolves.toMatchObject({ sent: 0 });
    });

    it('reports a reason rather than a silent zero when no games are stored', async () => {
        await Game.deleteMany({});
        await manager('Ann', [MIAMI]);

        const res = await push.notifyCaptainLocks(LOCK - 1 * H);

        expect(res.skipped).toBe('no games stored');
    });
});
