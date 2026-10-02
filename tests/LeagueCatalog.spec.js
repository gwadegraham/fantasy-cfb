// Which leagues the app knows about (#319 part 2).
//
// This replaced `LEAGUES.map(...)` in server.js — a MAP over the hardcoded
// scoring-defaults array, with names overridden from Mongo. The consequence
// was quiet and total: a league that existed only in the database was dropped
// on the floor. No name, no switcher entry, and no code an Admin could select.
//
// That was survivable while the only two leagues were the two in the array. It
// stops being survivable the moment a basketball league exists, because that
// league is created in Mongo and will never be in scoring-defaults — the
// hardcoded list is tied to the SCORING MODELS, which is a different question
// from "which leagues exist".

const { useMongo } = require('./helpers/mongo');
const League = require('../models/league');
const catalog = require('../modules/league-catalog');

useMongo();

const BALL = 'graham-league';
const OTHER = 'claunts-league';

const codes = async (req) => (await catalog.catalog(req)).map(l => l.code);
const named = async (req) => {
    const list = await catalog.catalog(req);
    return Object.fromEntries(list.map(l => [l.code, l.name]));
};

beforeEach(() => jest.spyOn(console, 'error').mockImplementation(() => {}));
afterEach(() => jest.restoreAllMocks());

describe('the merged list', () => {
    test('an empty collection still yields the hardcoded leagues', async () => {
        // An empty or unreachable database must not empty the navbar.
        expect(await codes()).toEqual([OTHER, BALL]);
    });

    test('a league that exists ONLY in Mongo is included', async () => {
        // The whole reason this module exists.
        await League.create({ code: 'hoops-league', name: 'Hardwood Heroes', sport: 'basketball' });
        expect(await codes()).toContain('hoops-league');
        expect((await named())['hoops-league']).toBe('Hardwood Heroes');
    });

    test('it does NOT carry the league’s sport', async () => {
        // active-season's primed cache answers that, and draft-pool and
        // draft-socket already read it. A copy here would be a second source
        // that can disagree with the draft — and stale in the other
        // direction, since this reads per request and that refreshes on an
        // interval. An earlier version carried `sport` and nothing read it.
        await League.create({ code: 'hoops-league', name: 'Hoops', sport: 'basketball' });
        const hoops = (await catalog.catalog()).find(l => l.code === 'hoops-league');
        expect(hoops.name).toBe('Hoops');
        expect(hoops.sport).toBeUndefined();
        expect((await catalog.catalog()).every(l => !('sport' in l))).toBe(true);
    });

    test('a rename in Mongo wins over the hardcoded name', async () => {
        await League.create({ code: BALL, name: 'The Polar Depressed' });
        expect((await named())[BALL]).toBe('The Polar Depressed');
    });

    test('the hardcoded leagues keep their display order, new ones follow', async () => {
        // The two football leagues have always rendered in this order; adding
        // a league should not reshuffle the navbar.
        await League.create([
            { code: 'aaa-league', name: 'Aaa' },
            { code: BALL, name: 'Renamed' }
        ]);
        expect(await codes()).toEqual([OTHER, BALL, 'aaa-league']);
    });
});

describe('documents missing fields', () => {
    // Not hypothetical: the two league documents in the real database were
    // written before #312 added `sport`, so neither has the field at all.
    // A `.lean()` read does NOT apply schema defaults, so these come back
    // undefined rather than 'football'.
    test('a document written before #312 added `sport` still resolves', async () => {
        // Not hypothetical: both league documents in the real database were
        // written by direct insert and have no `sport` field at all, and a
        // `.lean()` read does not apply schema defaults.
        await League.collection.insertOne({ code: BALL, name: 'The Polar Depressed' });
        expect((await catalog.catalog()).find(l => l.code === BALL).name).toBe('The Polar Depressed');
    });

    test('an empty name falls back rather than rendering a blank option', async () => {
        // A blank <option> is invisible and unclickable. `name` is required
        // by the schema, so this only happens via a direct write — which is
        // how both of these documents were created in the first place.
        await League.collection.insertOne({ code: BALL, name: '' });
        await League.collection.insertOne({ code: 'raw-league', name: '' });
        const list = await catalog.catalog();
        expect(list.find(l => l.code === BALL).name).toBe('Graham League');   // the default
        expect(list.find(l => l.code === 'raw-league').name).toBe('raw-league');
    });
});

describe('archived leagues', () => {
    // The field has been on the schema since #312 and nothing has ever read
    // it — models/league.js calls it "stored but INERT". Honouring it is what
    // makes retiring a league possible without deleting anyone's history.
    test('an archived Mongo-only league is not offered', async () => {
        await League.create({ code: 'old-league', name: 'Retired', status: 'archived' });
        expect(await codes()).not.toContain('old-league');
    });

    test('an archived HARDCODED league drops out too', async () => {
        // Otherwise a league could never be retired, because the array would
        // keep putting it back.
        await League.create({ code: OTHER, name: 'Goofballers', status: 'archived' });
        expect(await codes()).toEqual([BALL]);
    });

    test('and an active one is kept', async () => {
        await League.create({ code: 'new-league', name: 'New', status: 'active' });
        expect(await codes()).toContain('new-league');
    });
});

describe('named() — resolving a code someone already holds', () => {
    // Archiving must not degrade the people still IN that league. They keep
    // their franchise, so they keep seeing the league's name; what archiving
    // does is stop it being OFFERED to anyone else.
    test('an archived league keeps its name here, but is not offered', async () => {
        await League.create({ code: 'old-league', name: 'Retired Rovers', status: 'archived' });
        expect((await catalog.catalog()).map(l => l.code)).not.toContain('old-league');
        const entry = (await catalog.named()).find(l => l.code === 'old-league');
        expect(entry.name).toBe('Retired Rovers');
    });

    test('and so does an archived HARDCODED league', async () => {
        // Without this a member still in it sees a raw slug where the league
        // name used to be, on a league they are actively playing in.
        await League.create({ code: OTHER, name: 'Goofballers', status: 'archived' });
        expect((await catalog.codes())).not.toContain(OTHER);
        expect((await catalog.named()).find(l => l.code === OTHER).name).toBe('Goofballers');
    });

    test('named() is otherwise the same list', async () => {
        await League.create({ code: 'hoops-league', name: 'Hoops' });
        expect((await catalog.named()).map(l => l.code)).toEqual([OTHER, BALL, 'hoops-league']);
    });
});

describe('malformed documents', () => {
    test('a league with no code is ignored, not rendered as a blank option', async () => {
        // Both real documents were created by direct insert, so the schema's
        // `required` is not a guarantee. A blank <option value=""> is
        // invisible and unselectable.
        await League.collection.insertOne({ name: 'Nameless' });
        await League.collection.insertOne({ code: '   ', name: 'Spaces' });
        const list = await catalog.catalog();
        expect(list.map(l => l.code)).toEqual([OTHER, BALL]);
        expect(list.every(l => l.code.trim() !== '')).toBe(true);
    });
});

describe('failure and caching', () => {
    test('an unreachable collection falls back to the defaults', async () => {
        const boom = jest.spyOn(League, 'find').mockImplementationOnce(() => { throw new Error('mongo down'); });
        expect(await codes()).toEqual([OTHER, BALL]);
        boom.mockRestore();
    });

    test('the read happens ONCE per request', async () => {
        // server.js needs the names and league-selection needs the codes, on
        // the same render, on a free tier where latency tracks bytes.
        const req = {};
        const spy = jest.spyOn(League, 'find');
        await catalog.catalog(req);
        await catalog.catalog(req);
        await catalog.codes(req);
        expect(spy).toHaveBeenCalledTimes(1);
        spy.mockRestore();
    });

    test('and a rename lands on the NEXT request, not eventually', async () => {
        // The cache is per-request on purpose: names are edited via /leagues
        // and a commissioner renaming their league should see it immediately.
        await League.create({ code: BALL, name: 'First' });
        expect((await named({}))[BALL]).toBe('First');
        await League.updateOne({ code: BALL }, { $set: { name: 'Second' } });
        expect((await named({}))[BALL]).toBe('Second');
    });

    test('DEFAULTS cannot be mutated by a caller', async () => {
        // The merged array is built from DEFAULTS, and an entry is returned
        // BY IDENTITY when Mongo has nothing to say about that code — so a
        // caller renaming what it got back would corrupt the fallback for
        // every later request. Frozen, not merely copied.
        await League.create({ code: 'hoops-league', name: 'Hoops' });
        const list = await catalog.catalog();
        expect(catalog.DEFAULTS.map(l => l.code)).toEqual([OTHER, BALL]);

        expect(Object.isFrozen(catalog.DEFAULTS)).toBe(true);
        expect(catalog.DEFAULTS.every(Object.isFrozen)).toBe(true);
        const shared = list.find(l => l.code === BALL);
        expect(() => { 'use strict'; shared.name = 'hijacked'; }).toThrow();
        expect(catalog.DEFAULTS.find(l => l.code === BALL).name).toBe('Graham League');
    });

    test('both views share ONE read', async () => {
        const req = {};
        const spy = jest.spyOn(League, 'find');
        await catalog.catalog(req);
        await catalog.named(req);
        await catalog.codes(req);
        expect(spy).toHaveBeenCalledTimes(1);
        spy.mockRestore();
    });
});
