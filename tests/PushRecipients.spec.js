// Who a game-day alert actually goes to (modules/push-notify.js recipientsFor).
//
// This is the half of the push feature that can wake up the wrong phone, and it
// changed meaning: during the initial rollout PUSH_RECIPIENT_IDS was the gate
// and empty meant nobody. Now the manager's own subscription is the gate — they
// installed the app and turned alerts on — and the env var is a narrowing
// override for an emergency.
//
// So the property to pin is no longer "fails closed". It is that the three
// things that must ALL hold still do: a registered device, a rostered team in
// this game, and the active season.

process.env.YEAR = '2026';

const express = require('express');
const request = require('supertest');
const { useMongo } = require('./helpers/mongo');
const User = require('../models/user');
const push = require('../modules/push-notify');
const usersRouter = require('../routes/users');

useMongo();

const SEASON = 2026;
const LEAGUE = 'graham-league';
const BAMA = 333, GEORGIA = 61, OREGON = 2483;
const GAME = { id: 401628319, homeTeam: 'Georgia', awayTeam: 'Alabama', homeId: GEORGIA, awayId: BAMA };

function fullTeam(id, school) {
    return {
        id, school, mascot: 'M', abbreviation: school.slice(0, 3).toUpperCase(),
        conference: 'SEC', color: '#000', logos: [`${school}.png`],
        location: { venue_id: id, name: 'V', city: 'C', state: 'ST', zip: '1', latitude: 1, longitude: 1, capacity: 100, grass: true, dome: false }
    };
}

const device = (tag) => ({
    endpoint: `https://web.push.apple.com/${tag}`,
    keys: { p256dh: 'BPublicKeyBytes', auth: 'AuthSecret' },
    userAgent: 'iPhone', createdAt: new Date()
});

// `subscribed` false = never turned alerts on, which is the normal state.
const manager = (first, teams, { subscribed = true, season = SEASON } = {}) => User.create(Object.assign({
    firstName: first, lastName: 'Test', league: LEAGUE,
    seasons: [{ season, teams: teams.map(t => fullTeam(t, `Team${t}`)) }]
}, subscribed ? { pushSubscriptions: [device(first)] } : {}));

const withAllowlist = async (value, fn) => {
    const before = process.env.PUSH_RECIPIENT_IDS;
    if (value === undefined) delete process.env.PUSH_RECIPIENT_IDS;
    else process.env.PUSH_RECIPIENT_IDS = value;
    try { return await fn(); }
    finally {
        if (before === undefined) delete process.env.PUSH_RECIPIENT_IDS;
        else process.env.PUSH_RECIPIENT_IDS = before;
    }
};

const names = (list) => list.map(r => r.user.firstName).sort();

describe('with no narrowing list set (the normal state)', () => {
    it('notifies every subscribed manager who rosters a team in the game', async () => {
        await manager('Brock', [BAMA]);
        await manager('Trevor', [GEORGIA, OREGON]);
        await withAllowlist(undefined, async () => {
            const out = await push.recipientsFor(GAME, SEASON);
            expect(names(out)).toEqual(['Brock', 'Trevor']);
        });
    });

    // The subscription IS the opt-in. No device, no alert — that is the only
    // thing standing between a manager and a phone buzzing 40 times a Saturday.
    it('skips a manager who never turned alerts on', async () => {
        await manager('Brock', [BAMA]);
        await manager('Quiet', [GEORGIA], { subscribed: false });
        await withAllowlist(undefined, async () => {
            expect(names(await push.recipientsFor(GAME, SEASON))).toEqual(['Brock']);
        });
    });

    it('skips a subscribed manager who rosters neither team', async () => {
        await manager('Elsewhere', [OREGON]);
        await withAllowlist(undefined, async () => {
            expect(await push.recipientsFor(GAME, SEASON)).toEqual([]);
        });
    });

    it('skips a roster from another season', async () => {
        await manager('LastYear', [BAMA], { season: SEASON - 1 });
        await withAllowlist(undefined, async () => {
            expect(await push.recipientsFor(GAME, SEASON)).toEqual([]);
        });
    });

    // The projection was slimmed to seasons.season + seasons.teams.id because
    // seasons[].teams carries a full team object each — 108,610 bytes per
    // matched manager against the prod copy, versus 1,208 here. If that
    // projection ever drops a field recipientsFor reads, these go red.
    it('still resolves the rostered teams from the slimmed projection', async () => {
        await manager('Brock', [BAMA]);
        await withAllowlist(undefined, async () => {
            const [row] = await push.recipientsFor(GAME, SEASON);
            expect(row.teamIds).toEqual([BAMA]);
            expect(row.user.league).toBe(LEAGUE);
            expect((row.user.pushSubscriptions || []).length).toBe(1);
        });
    });

    // A manager can hold both sides; the alert names the teams they actually own.
    it('reports both rostered teams when a manager holds both sides', async () => {
        await manager('Both', [BAMA, GEORGIA]);
        await withAllowlist(undefined, async () => {
            const [row] = await push.recipientsFor(GAME, SEASON);
            expect(row.teamIds.sort((a, b) => a - b)).toEqual([GEORGIA, BAMA].sort((a, b) => a - b));
        });
    });
});

describe('with a narrowing list set', () => {
    // A value Mongo cannot cast to an ObjectId used to throw inside the send
    // wrappers, which swallow it — silence with no decision behind it.
    it('sends to nobody, without throwing, when every entry is junk', async () => {
        await manager('Brock', [BAMA]);
        await withAllowlist('none', async () => {
            expect(await push.recipientsFor(GAME, SEASON)).toEqual([]);
        });
    });

    it('notifies only the listed ids, even though the others opted in', async () => {
        const brock = await manager('Brock', [BAMA]);
        await manager('Trevor', [GEORGIA]);
        await withAllowlist(String(brock._id), async () => {
            expect(names(await push.recipientsFor(GAME, SEASON))).toEqual(['Brock']);
        });
    });

    it('still requires a subscription — being listed is not opting in', async () => {
        const quiet = await manager('Quiet', [BAMA], { subscribed: false });
        await withAllowlist(String(quiet._id), async () => {
            expect(await push.recipientsFor(GAME, SEASON)).toEqual([]);
        });
    });
});

// GET /users/me/push reports `allowed`, which the profile modal uses to warn a
// manager that their device is registered but will stay quiet.
describe('what the Alerts panel is told', () => {
    const appFor = (user) => {
        const a = express();
        a.use(express.json());
        a.use((req, res, next) => {
            req.oidc = { isAuthenticated: () => true, user: { user_metadata: { metadata: { userId: String(user._id) } } } };
            next();
        });
        a.use('/users', usersRouter);
        return a;
    };

    it('tells a manager playing this season that alerts will reach them', async () => {
        const u = await manager('Brock', [BAMA]);
        await withAllowlist(undefined, async () => {
            const res = await request(appFor(u)).get('/users/me/push');
            expect(res.body.allowed).toBe(true);
            expect(res.body.deviceCount).toBe(1);
        });
    });

    // Every alert is triggered by a game one of your teams is playing, so a
    // manager with no roster this season will never hear one — saying "alerts
    // are on" to them is the exact confusion `allowed` exists to prevent.
    it('warns a manager with no roster this season, even unrestricted', async () => {
        const u = await manager('LastYear', [BAMA], { season: SEASON - 1 });
        await withAllowlist(undefined, async () => {
            const res = await request(appFor(u)).get('/users/me/push');
            expect(res.body.deviceCount).toBe(1);
            expect(res.body.allowed).toBe(false);
        });
    });

    it('warns a manager that a narrowing list is excluding them', async () => {
        const u = await manager('Brock', [BAMA]);
        await withAllowlist('64b1f00000000000000000aa', async () => {
            expect((await request(appFor(u)).get('/users/me/push')).body.allowed).toBe(false);
        });
    });
});
