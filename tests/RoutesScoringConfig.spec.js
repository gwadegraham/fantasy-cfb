// HTTP-level tests for the powerConferences override in routes/scoringConfig.js.
//
// Why at the route level: modules/scoring.js getScoringConfig loads the LIVE
// scoring config through GET /scoring-config/:league, so the route's overrides
// object is a whitelist — a field that isn't listed there never reaches the
// scorer no matter how faithfully it is stored. That gap is invisible to the
// unit tests (which mock the HTTP layer) and to the model tests (which never
// call the route), so it gets its own round-trip test here.
//
// The router is mounted on a bare Express app backed by in-memory Mongo.

const express = require('express');
const request = require('supertest');
const { useMongo } = require('./helpers/mongo');
const ScoringConfig = require('../models/scoringConfig');
const scoringConfigRouter = require('../routes/scoringConfig');

const LEAGUE = 'graham-league';
const POWER_PLUS = ['ACC', 'Big 12', 'Big Ten', 'SEC', 'FBS Independents'];
// Saving is commissioner-gated; authorize via the internal-token path in
// modules/league-access.js (the auth tiers themselves live in Permissions.spec.js).
const TOKEN = 'scoring-config-spec-token';

const app = express();
app.use(express.json());
app.use('/scoring-config', scoringConfigRouter);

useMongo();

// YEAR is read by the save route's season lock (hasScoredGames) and the audit
// entry; without it the lookup casts NaN and the save 400s.
let prevToken, prevYear;
beforeAll(() => {
    prevToken = process.env.INTERNAL_API_TOKEN; process.env.INTERNAL_API_TOKEN = TOKEN;
    prevYear = process.env.YEAR; process.env.YEAR = '2026';
});
afterAll(() => { process.env.INTERNAL_API_TOKEN = prevToken; process.env.YEAR = prevYear; });

function seed(extra) {
    return ScoringConfig.create(Object.assign({
        league: LEAGUE, model: 'graham', values: {}, disabled: [], enabled: []
    }, extra || {}));
}

describe('GET /scoring-config/:league — powerConferences round trip', () => {
    it('surfaces a stored power list so the engine actually sees it', async () => {
        await seed({ powerConferences: POWER_PLUS });
        const res = await request(app).get(`/scoring-config/${LEAGUE}`);
        expect(res.status).toBe(200);
        expect(res.body.powerConferences).toEqual(POWER_PLUS);
    });

    it('omits it when unset, so an unconfigured league keeps the engine default', async () => {
        await seed();
        const res = await request(app).get(`/scoring-config/${LEAGUE}`);
        expect(res.status).toBe(200);
        expect(res.body.powerConferences).toBeUndefined();
    });

    it('a league with no saved doc at all resolves without one (Claunts today)', async () => {
        const res = await request(app).get('/scoring-config/claunts-league');
        expect(res.status).toBe(200);
        expect(res.body.model).toBe('claunts');
        expect(res.body.powerConferences).toBeUndefined();
    });

    it('ships the base list and an upset-rule flag so the admin can render the control', async () => {
        await seed();
        const graham = await request(app).get(`/scoring-config/${LEAGUE}`);
        expect(graham.body.powerConferencesBase).toEqual(['ACC', 'Big 12', 'Big Ten', 'SEC']);
        expect(graham.body.hasUpsetRule).toBe(true);
        // Claunts has no upset rule, so the admin hides the control entirely.
        const claunts = await request(app).get('/scoring-config/claunts-league');
        expect(claunts.body.hasUpsetRule).toBe(false);
    });

    it('survives a commissioner saving point values from the admin form', async () => {
        await seed({ powerConferences: POWER_PLUS });
        // The save route $sets only the fields the form owns; the power list is
        // not one of them and must not be collateral damage.
        await ScoringConfig.findOneAndUpdate(
            { league: LEAGUE },
            { $set: { values: { baseWin: 2 }, disabled: [], enabled: [] } }
        );
        const res = await request(app).get(`/scoring-config/${LEAGUE}`);
        expect(res.body.values.baseWin).toBe(2);
        expect(res.body.powerConferences).toEqual(POWER_PLUS);
    });
});

describe('POST /scoring-config — saving the power list', () => {
    const save = (body) => request(app).post('/scoring-config')
        .set('X-Internal-Token', TOKEN)
        .send(Object.assign({ league: LEAGUE, model: 'graham', values: {}, disabled: [], enabled: [] }, body));

    it('persists a list sent by the admin form', async () => {
        const res = await save({ powerConferences: POWER_PLUS });
        expect(res.status).toBe(200);
        expect(res.body.powerConferences).toEqual(POWER_PLUS);
        expect((await ScoringConfig.findOne({ league: LEAGUE })).powerConferences).toEqual(POWER_PLUS);
    });

    // The failure this guards: Mongoose strips an undefined from a $set, so
    // without the explicit $unset, un-ticking the box would appear to save while
    // leaving the old list — and the league would keep scoring the old way.
    it('clears back to the engine default when the box is un-ticked', async () => {
        await save({ powerConferences: POWER_PLUS });
        const res = await save({ powerConferences: null });
        expect(res.status).toBe(200);
        expect(res.body.powerConferences).toBeUndefined();
        const doc = await ScoringConfig.findOne({ league: LEAGUE });
        expect(doc.powerConferences).toBeUndefined();
        expect(await request(app).get(`/scoring-config/${LEAGUE}`)
            .then(r => r.body.powerConferences)).toBeUndefined();
    });

    it('refuses a malformed list rather than scoring against half of one', async () => {
        const res = await save({ powerConferences: ['', 42] });
        expect(res.status).toBe(200);
        expect(res.body.powerConferences).toBeUndefined();
        expect((await ScoringConfig.findOne({ league: LEAGUE })).powerConferences).toBeUndefined();
    });

    it('records the list in the audit trail alongside the other scoring changes', async () => {
        await save({ powerConferences: POWER_PLUS });
        const AuditLog = require('../models/auditLog');
        const entry = await AuditLog.findOne({ action: 'scoring.config' }).sort({ _id: -1 });
        expect(entry.meta.powerConferences).toEqual(POWER_PLUS);
    });
});
