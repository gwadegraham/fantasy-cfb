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

const app = express();
app.use(express.json());
app.use('/scoring-config', scoringConfigRouter);

useMongo();

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
