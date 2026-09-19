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

const express = require('express');
const { useMongo } = require('./helpers/mongo');
const User = require('../models/user');
const push = require('../modules/push-notify');

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
