// HTTP-level tests for routes/betting-lines.js. The router is mounted on a bare
// Express app backed by an in-memory Mongo, matching tests/RoutesGames.spec.js.
//
// What these are really guarding is BYTES. The cluster is a free-tier M0 capped
// near 85KB/s, so the payload is the latency. Unprojected, measured against a
// dev copy of prod:
//
//   season 2026:  994 docs,  518KB, 6050ms   ->  115KB, 1747ms
//   season 2025: 1597 docs, 1196KB, 12833ms  ->  290KB, 4236ms
//
// Over the wire through the real route: 529,956 -> 118,221 bytes for 2026.

const express = require('express');
const request = require('supertest');
const { useMongo } = require('./helpers/mongo');
const BettingLine = require('../models/bettingLine');
const bettingLinesRouter = require('../routes/betting-lines');

const app = express();
app.use(express.json());
app.use('/betting-lines', bettingLinesRouter);

useMongo();

// Every field the model can carry, so a projection that leaks is visible.
const FULL = {
    id: 401, season: 2026, seasonType: 'regular', week: 3,
    startDate: '2026-09-12T23:00:00.000Z',
    homeTeam: 'Purdue', homeConference: 'Big Ten', homeClassification: 'fbs', homeScore: 24,
    awayTeam: 'Indiana', awayConference: 'Big Ten', awayClassification: 'fbs', awayScore: 31,
    lines: [{
        provider: 'DraftKings', formattedSpread: 'Indiana -7.5',
        spread: -7.5, spreadOpen: -6.5, overUnder: 52.5, overUnderOpen: 51,
        homeMoneyline: 260, awayMoneyline: -320
    }]
};

// The only fields any consumer reads: public/standings.js displaySchedule,
// public/userHome.js buildGameCard, public/team.js renderTeamScheduleInfo.
const READ = ['homeTeam', 'awayTeam', 'lines'];
// Everything they never touch. Each one is dead weight on every request.
const UNREAD = [
    '_id', 'id', 'season', 'seasonType', 'week', 'startDate',
    'homeConference', 'homeClassification', 'homeScore',
    'awayConference', 'awayClassification', 'awayScore'
];
const LINE_UNREAD = ['spread', 'spreadOpen', 'overUnder', 'overUnderOpen', 'homeMoneyline', 'awayMoneyline'];

beforeEach(async () => { await BettingLine.create(FULL); });

describe('GET /betting-lines/:year', () => {
    test('answers only the fields the page actually reads', async () => {
        const res = await request(app).get('/betting-lines/2026');

        expect(res.status).toBe(200);
        expect(res.body).toHaveLength(1);
        expect(Object.keys(res.body[0]).sort()).toEqual(READ.slice().sort());
        UNREAD.forEach(f => expect(res.body[0]).not.toHaveProperty(f));
    });

    test('trims the nested lines[] to provider and formattedSpread', async () => {
        const res = await request(app).get('/betting-lines/2026');

        expect(res.body[0].lines).toEqual([{ provider: 'DraftKings', formattedSpread: 'Indiana -7.5' }]);
        // Mongoose leaves lines[]._id out when the projection names nested
        // fields — worth pinning, because nested _id CANNOT be excluded
        // explicitly alongside an inclusion projection.
        expect(res.body[0].lines[0]).not.toHaveProperty('_id');
        LINE_UNREAD.forEach(f => expect(res.body[0].lines[0]).not.toHaveProperty(f));
    });

    test('still carries what the page matches a game on', async () => {
        const res = await request(app).get('/betting-lines/2026');

        // displaySchedule finds a line by homeTeam + awayTeam, then splits
        // formattedSpread. Drop any of these and the spread renders blank with
        // nothing in the log.
        expect(res.body[0].homeTeam).toBe('Purdue');
        expect(res.body[0].awayTeam).toBe('Indiana');
        expect(res.body[0].lines[0].formattedSpread).toBe('Indiana -7.5');
    });

    test('a season with no lines is a 400, unchanged', async () => {
        const res = await request(app).get('/betting-lines/2019');
        expect(res.status).toBe(400);
    });

    test('names the year it could not find, rather than "undefined"', async () => {
        // The message read req.body.year on a GET, so it always said
        // "for year undefined". Harmless while standings never reached this
        // route; it lands in the log on every preseason render now that it does.
        const res = await request(app).get('/betting-lines/2019');

        expect(res.body.message).toContain('2019');
        expect(res.body.message).not.toContain('undefined');
    });
});

describe('GET /betting-lines', () => {
    // No caller in the app reaches this, but GET is open to any authenticated
    // member, and unprojected it returns every stored line for every season.
    test('is projected the same way', async () => {
        const res = await request(app).get('/betting-lines');

        expect(res.status).toBe(200);
        expect(Object.keys(res.body[0]).sort()).toEqual(READ.slice().sort());
        UNREAD.forEach(f => expect(res.body[0]).not.toHaveProperty(f));
        LINE_UNREAD.forEach(f => expect(res.body[0].lines[0]).not.toHaveProperty(f));
    });
});
