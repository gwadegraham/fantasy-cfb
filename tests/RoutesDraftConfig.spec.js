// HTTP-level tests for the draft-config save in routes/draft.js, focused on the
// commissioner's video call link: it persists, blank clears it, a non-http(s)
// value is refused, and it inherits the same settings lock as every other draft
// setting — by design the link is NOT editable once the draft is live.
//
// The router is mounted on a bare Express app backed by in-memory Mongo, and
// authorized via the internal-token path in modules/league-access.js (the
// server's auth tiers are unit-tested separately in Permissions.spec.js).

const express = require('express');
const request = require('supertest');
const mongoose = require('mongoose');
const { useMongo } = require('./helpers/mongo');
const Draft = require('../models/draft');
const AuditLog = require('../models/auditLog');
const draftRouter = require('../routes/draft');

const TOKEN = 'draft-config-spec-token';
const LEAGUE = 'graham-league';
const SEASON = 2026;

const app = express();
app.use(express.json());
app.use('/draft', draftRouter);

useMongo();

let prevToken;
beforeAll(() => { prevToken = process.env.INTERNAL_API_TOKEN; process.env.INTERNAL_API_TOKEN = TOKEN; });
afterAll(() => { process.env.INTERNAL_API_TOKEN = prevToken; });

const order = [String(new mongoose.Types.ObjectId()), String(new mongoose.Types.ObjectId())];

function saveConfig(body) {
    return request(app)
        .post('/draft')
        .set('X-Internal-Token', TOKEN)
        .send(Object.assign({
            league: LEAGUE, season: SEASON,
            scheduledAt: '2026-08-20T00:00:00.000Z',
            totalRounds: 10, snake: true, draftOrder: order
        }, body));
}

describe('POST /draft — video call link', () => {
    test('saves the link and persists it on the draft', async () => {
        const res = await saveConfig({ callUrl: 'https://zoom.us/j/123456789' });
        expect(res.status).toBe(200);
        expect(res.body.callUrl).toBe('https://zoom.us/j/123456789');

        const saved = await Draft.findOne({ league: LEAGUE, season: SEASON }).lean();
        expect(saved.callUrl).toBe('https://zoom.us/j/123456789');
    });

    test('a blank link clears a previously saved one', async () => {
        await saveConfig({ callUrl: 'https://meet.google.com/abc-defg-hij' });
        const res = await saveConfig({ callUrl: '' });
        expect(res.status).toBe(200);
        expect(res.body.callUrl).toBeNull();
    });

    test('omitting the field leaves no link rather than erroring', async () => {
        const res = await saveConfig({});
        expect(res.status).toBe(200);
        expect(res.body.callUrl).toBeNull();
    });

    test('refuses a javascript: link (400) and saves nothing', async () => {
        const res = await saveConfig({ callUrl: 'javascript:alert(1)' });
        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/http:\/\/ or https:\/\//);
        expect(await Draft.countDocuments()).toBe(0);
    });

    test('refuses text that is not a URL (400)', async () => {
        const res = await saveConfig({ callUrl: 'zoom.us/j/123' });
        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/must be a full URL/);
    });

    test('is locked once the draft is active, like every other setting', async () => {
        await Draft.create({
            league: LEAGUE, season: SEASON, status: 'active',
            draftOrder: order, totalRounds: 10, callUrl: 'https://zoom.us/j/original'
        });
        const res = await saveConfig({ callUrl: 'https://zoom.us/j/replacement' });
        expect(res.status).toBe(409);
        expect(res.body.message).toMatch(/settings are locked/);

        const saved = await Draft.findOne({ league: LEAGUE, season: SEASON }).lean();
        expect(saved.callUrl).toBe('https://zoom.us/j/original');   // untouched
    });

    test('audit trail records that a link was set without storing the URL', async () => {
        await saveConfig({ callUrl: 'https://us02web.zoom.us/j/8675309?pwd=secret' });
        const entry = await AuditLog.findOne({ action: 'draft.config' }).lean();
        expect(entry.summary).toMatch(/call link set/);
        expect(entry.meta.callLink).toBe('set');
        expect(JSON.stringify(entry)).not.toMatch(/pwd=secret/);   // no passcode in the log
    });

    test('audit trail says nothing about a link when there is none', async () => {
        await saveConfig({});
        const entry = await AuditLog.findOne({ action: 'draft.config' }).lean();
        expect(entry.summary).not.toMatch(/call link/);
        expect(entry.meta.callLink).toBe('none');
    });
});
