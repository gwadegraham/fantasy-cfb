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

    test('its sport comes through, so the chrome can follow it', async () => {
        await League.create({ code: 'hoops-league', name: 'Hoops', sport: 'basketball' });
        const hoops = (await catalog.catalog()).find(l => l.code === 'hoops-league');
        expect(hoops.sport).toBe('basketball');
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
    test('a hardcoded league with no sport stored keeps its default', async () => {
        await League.create({ code: BALL, name: 'The Polar Depressed' });
        await League.updateOne({ code: BALL }, { $unset: { sport: 1 } });
        const doc = await League.findOne({ code: BALL }).lean();
        expect(doc.sport).toBeUndefined();                 // the real shape

        const entry = (await catalog.catalog()).find(l => l.code === BALL);
        expect(entry.sport).toBe('football');
        expect(entry.name).toBe('The Polar Depressed');
    });

    test('a Mongo-only league with no sport stored defaults to football', async () => {
        await League.create({ code: 'new-league', name: 'New' });
        await League.updateOne({ code: 'new-league' }, { $unset: { sport: 1 } });
        const entry = (await catalog.catalog()).find(l => l.code === 'new-league');
        expect(entry.sport).toBe('football');
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

    test('DEFAULTS is not mutated by a call that adds leagues', async () => {
        // The merged array is built from DEFAULTS; pushing onto it directly
        // would leak one request's leagues into every later fallback.
        await League.create({ code: 'hoops-league', name: 'Hoops' });
        await catalog.catalog();
        expect(catalog.DEFAULTS.map(l => l.code)).toEqual([OTHER, BALL]);
    });
});
