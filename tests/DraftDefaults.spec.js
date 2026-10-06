// What a NEW draft starts at, per sport (#320).
//
// The numbers are not arbitrary and the comments in modules/draft-defaults.js
// carry the measurement. What is tested here is that they REACH a new draft,
// and — more importantly — that they never overwrite a draft that already
// exists, because a commissioner who deliberately uncapped a pool must keep
// it.

const express = require('express');
const request = require('supertest');
const { useMongo } = require('./helpers/mongo');
const { draftDefaultsFor, BY_SPORT } = require('../modules/draft-defaults');
const Draft = require('../models/draft');
const League = require('../models/league');
const SportSeason = require('../models/sportSeason');
const seasons = require('../modules/active-season');

const HOOPS = 'hoops-league';
const BALL = 'graham-league';
const HOOPS_SEASON = 2027;
const BALL_SEASON = 2026;

describe('the defaults themselves', () => {
    test('basketball starts capped, football does not', () => {
        expect(draftDefaultsFor('basketball')).toEqual({ totalRounds: 10, poolSize: 120 });
        expect(draftDefaultsFor('football')).toEqual({ totalRounds: 10, poolSize: null });
    });

    test('there is no `snake` default, because nothing would read it', () => {
        // The route takes snake straight off the request. A default here
        // was asserted only against itself — setting it to false left every
        // route test green.
        expect(draftDefaultsFor('basketball').snake).toBeUndefined();
    });

    test('an unknown sport gets football’s', () => {
        expect(draftDefaultsFor('curling')).toEqual(draftDefaultsFor('football'));
        expect(draftDefaultsFor(undefined)).toEqual(draftDefaultsFor('football'));
    });

    test('a caller cannot mutate them for everyone else', () => {
        const a = draftDefaultsFor('basketball');
        a.poolSize = 1;
        expect(draftDefaultsFor('basketball').poolSize).toBe(120);
        expect(BY_SPORT.basketball.poolSize).toBe(120);
    });

    test('the pool is big enough that no round is forced', () => {
        // #320's actual worry: 10 managers x 12 rounds is exactly 120 and
        // empties the pool on the final pick. At the sizes in play — 6 or 8
        // managers, 10 rounds — there are 40+ teams still on the board.
        const { totalRounds, poolSize } = draftDefaultsFor('basketball');
        for (const managers of [6, 8]) {
            expect(poolSize - managers * totalRounds).toBeGreaterThanOrEqual(40);
        }
        // And it would still hold if the league went to 12 rounds.
        expect(poolSize - 8 * 12).toBeGreaterThan(0);
    });
});

describe('POST /draft applies them', () => {
    useMongo();

    const app = (() => {
        const a = express();
        a.use(express.json());
        a.use((req, res, next) => {
            const user = { user_metadata: { roles: ['Admin'], metadata: { league: 'gg', userId: 'a' } } };
            req.oidc = { isAuthenticated: () => true, user };
            req.effUser = user;
            next();
        });
        a.use('/draft', require('../routes/draft'));
        return a;
    })();

    beforeEach(async () => {
        await League.create([
            { code: HOOPS, name: 'Hardwood Heroes', sport: 'basketball' },
            { code: BALL, name: 'Football', sport: 'football' }
        ]);
        await SportSeason.create([
            { sport: 'football', season: BALL_SEASON, status: 'in-season' },
            { sport: 'basketball', season: HOOPS_SEASON, status: 'preseason' }
        ]);
        await seasons.prime();
    });
    afterEach(() => seasons._reset());

    // POST /draft, not /draft/settings — the route the admin form uses.
    const save = (league, season, body = {}) =>
        request(app).post('/draft').send(Object.assign({ league, season, draftOrder: [] }, body));

    test('a NEW basketball draft is capped at 120 and 10 rounds', async () => {
        const res = await save(HOOPS, HOOPS_SEASON);
        expect(res.status).toBe(200);
        const d = await Draft.findOne({ league: HOOPS, season: HOOPS_SEASON }).lean();
        expect(d.poolSize).toBe(120);
        expect(d.totalRounds).toBe(10);
        expect(d.snake).toBe(true);
    });

    test('a NEW football draft is left uncapped', async () => {
        await save(BALL, BALL_SEASON);
        const d = await Draft.findOne({ league: BALL, season: BALL_SEASON }).lean();
        expect(d.poolSize).toBeNull();
    });

    test('an explicit pool size wins over the default', async () => {
        await save(HOOPS, HOOPS_SEASON, { poolSize: 90 });
        expect((await Draft.findOne({ league: HOOPS }).lean()).poolSize).toBe(90);
    });

    test('and an explicit UNCAP is honoured, not re-defaulted', async () => {
        // The distinction the route is built around: an absent poolSize and
        // a deliberately empty one are different inputs.
        await save(HOOPS, HOOPS_SEASON, { poolSize: '' });
        expect((await Draft.findOne({ league: HOOPS }).lean()).poolSize).toBeNull();
    });

    test('re-saving an uncapped draft does NOT put the cap back', async () => {
        // $setOnInsert, so the default only ever reaches a draft that did
        // not exist. A commissioner who uncapped a pool keeps it, however
        // many times the settings form is saved afterwards.
        await save(HOOPS, HOOPS_SEASON, { poolSize: '' });
        await save(HOOPS, HOOPS_SEASON);                  // no poolSize key at all
        expect((await Draft.findOne({ league: HOOPS }).lean()).poolSize).toBeNull();
    });

    test('re-saving WITHOUT the rounds key resets them — documented, not endorsed', async () => {
        // The first version of this sent totalRounds BOTH times, so it
        // could not fail, and its name claimed a guarantee the code does
        // not give: unlike poolSize, totalRounds is written on every save,
        // so a caller omitting it resets to the default. That is
        // pre-existing behaviour on main, not something this PR changed —
        // recorded here so the asymmetry with poolSize is deliberate and
        // visible rather than a surprise later.
        await save(HOOPS, HOOPS_SEASON, { totalRounds: 12 });
        expect((await Draft.findOne({ league: HOOPS }).lean()).totalRounds).toBe(12);
        await save(HOOPS, HOOPS_SEASON);                      // key absent
        expect((await Draft.findOne({ league: HOOPS }).lean()).totalRounds).toBe(10);
    });

    test('but re-saving never puts a pool cap back on an uncapped draft', async () => {
        // The asymmetry above, from the other side: poolSize is written
        // only when the caller mentions it.
        await save(HOOPS, HOOPS_SEASON, { poolSize: '' });
        await save(HOOPS, HOOPS_SEASON, { totalRounds: 10 });
        expect((await Draft.findOne({ league: HOOPS }).lean()).poolSize).toBeNull();
    });
});

describe('the admin form shows the default', () => {
    // THE BUG THIS EXISTS FOR.
    //
    // The route's default applies only when the caller omits `poolSize`
    // entirely — and the admin form ALWAYS sends the key: a blank field
    // becomes `null`, and JSON.stringify keeps a null. So the default was
    // dead on the only path that creates a draft in production, and every
    // hoops draft configured with the pool field left blank would have been
    // created uncapped, from all 365 teams.
    //
    // The fix is to pre-fill the field instead, where an admin can see the
    // number and change it. These tests drive the real function out of
    // public/admin.js rather than grepping for it.
    const fs = require('fs');
    const path = require('path');
    const SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'admin.js'), 'utf8');

    // admin.js is one large classic script with side effects on load, so
    // the two functions under test are lifted out by name. Fragile by
    // nature; the structural test below fails loudly if either is renamed.
    const lift = (name) => {
        // Plain string scanning, not a regex — escaping a regex through
        // two layers of quoting produced an invalid one.
        const start = SRC.indexOf('\nfunction ' + name + '(');
        expect(start).toBeGreaterThan(-1);
        const end = SRC.indexOf('\n}\n', start);
        expect(end).toBeGreaterThan(start);
        return SRC.slice(start, end + 3);
    };

    // `window` is injected rather than using jsdom: this file is a node
    // suite (it talks to Mongo), and a @jest-environment docblock only
    // applies at the top of a file.
    const pick = (leagueCode, seed, defaults) => {
        const fakeWindow = { CC_LEAGUE: seed, DRAFT_DEFAULTS: defaults };
        const fn = new Function('window', 'getDraftLeagueCode',
            lift('draftSportDefaults') + '; return draftSportDefaults;')(fakeWindow, () => leagueCode);
        return fn();
    };

    const DEFAULTS = { football: { totalRounds: 10, poolSize: null }, basketball: { totalRounds: 10, poolSize: 120 } };
    const SEED = { all: [
        { code: 'graham-league', name: 'Football', sport: 'football' },
        { code: 'hoops-league', name: 'Hoops', sport: 'basketball' }
    ] };

    test('a basketball league gets the capped defaults', () => {
        expect(pick('hoops-league', SEED, DEFAULTS)).toEqual({ totalRounds: 10, poolSize: 120 });
    });

    test('a football league gets the uncapped ones', () => {
        expect(pick('graham-league', SEED, DEFAULTS)).toEqual({ totalRounds: 10, poolSize: null });
    });

    test('a league the seed does not know falls back to football', () => {
        expect(pick('mystery-league', SEED, DEFAULTS).poolSize).toBeNull();
    });

    test('and a page served without the defaults behaves as it did before', () => {
        // Degrades to blank, not to a crash on the admin screen.
        expect(pick('hoops-league', SEED, undefined)).toEqual({});
        expect(pick('hoops-league', undefined, DEFAULTS)).toEqual({ totalRounds: 10, poolSize: null });
    });

    test('the pre-fill only applies to a draft that does not exist yet', () => {
        // An existing uncapped draft must keep showing blank, or saving the
        // form would silently re-cap it.
        const src = lift('populateDraftFormFields');
        expect(src).toContain('sportDefaults');
        expect(src).toMatch(/currentDraft \? '' :/);
    });

    test('the page is actually given the defaults', () => {
        const view = fs.readFileSync(path.join(__dirname, '..', 'views', 'admin.ejs'), 'utf8');
        expect(view).toContain('window.DRAFT_DEFAULTS');
        const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
        expect(server).toMatch(/draftDefaults:\s*safeJson\(draftDefaults\.BY_SPORT\)/);
    });
});
