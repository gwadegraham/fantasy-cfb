// Basketball data tasks leave an audit row (#563).
//
// The four /hoops/admin buttons POST to routes in hoopsTeams.js and
// hoopsGames.js. Each spends CBBD calls from the pool both sports share, so
// each answer past the input checks writes a row: who ran it, what came back,
// and the call cost the admin page quotes. CBBD is stubbed throughout.

const express = require('express');
const request = require('supertest');
const { useMongo } = require('./helpers/mongo');
const cbbd = require('../modules/cbbd-client');
const roster = require('../modules/hoops-roster');
const audit = require('../modules/audit-log');
const AuditLog = require('../models/auditLog');
const SportSeason = require('../models/sportSeason');
const seasons = require('../modules/active-season');
const gamesRouter = require('../routes/hoopsGames');
const teamsRouter = require('../routes/hoopsTeams');

const app = express();
app.use(express.json());
app.use((req, res, next) => {
    req.oidc = {
        isAuthenticated: () => true,
        user: { name: 'Dana Commish', email: 'dana@example.com', user_metadata: { roles: ['Admin'] } }
    };
    next();
});
app.use('/hoops/games', gamesRouter);
app.use('/hoops/teams', teamsRouter);

useMongo();
const SEASON = 2027;

beforeEach(async () => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    seasons._reset();
    await SportSeason.create([{ sport: 'football', season: 2026, status: 'in-season' },
                               { sport: 'basketball', season: SEASON, status: 'preseason' }]);
    await seasons.prime();
    jest.spyOn(cbbd, 'logoUrlsThatExist').mockResolvedValue(new Set());
});
afterEach(() => jest.restoreAllMocks());

const rows = () => AuditLog.find({}).lean();

const TEAM = { id: 264, sourceId: '2561', logos: [], school: 'Siena', mascot: 'Saints', abbreviation: 'SIE',
    displayName: 'Siena Saints', shortDisplayName: 'Siena', primaryColor: '037961', secondaryColor: 'eea60f',
    conferenceId: 16, conference: 'Metro' };

const game = (id) => ({
    id, season: SEASON, seasonType: 'regular', startDate: '2026-11-03T00:00:00.000Z', startTimeTbd: false,
    neutralSite: false, conferenceGame: false, status: 'final', homePoints: 70, awayPoints: 60,
    homeTeamId: 1, homeTeam: 'Duke', awayTeamId: 2, awayTeam: 'Texas'
});
const stubGames = () => jest.spyOn(cbbd, 'fetchGamesInRange').mockResolvedValue(
    { games: [game(1), game(2)], windows: 8, remainingCalls: 29000, capHits: [] });

describe('POST /hoops/teams/:season/ingest', () => {
    test('a run records who ran it, what landed and the one call it cost', async () => {
        jest.spyOn(cbbd, 'fetchTeams').mockResolvedValue({ data: [TEAM], remainingCalls: 29500 });
        const res = await request(app).post(`/hoops/teams/${SEASON}/ingest`).send({});
        expect(res.status).toBe(200);
        const [row] = await rows();
        expect(row).toMatchObject({ action: 'hoops.teams', season: String(SEASON), actorName: 'Dana Commish',
            meta: { calls: 1, status: 200, remainingCalls: 29500 } });
        expect(row.summary).toBe(`Basketball team ingest for ${SEASON}: 1 teams, 0 with logos (1 created, 0 updated) · 1 CBBD call`);
        expect(audit.labelFor(row.action)).toBe('Basketball data');
    });

    test('a failed run is recorded too — the call may already be spent', async () => {
        jest.spyOn(cbbd, 'fetchTeams').mockRejectedValue(Object.assign(new Error('quota'), { status: 429 }));
        const res = await request(app).post(`/hoops/teams/${SEASON}/ingest`).send({});
        expect(res.status).toBe(502);
        const [row] = await rows();
        expect(row.summary).toBe(`Basketball team ingest FAILED for ${SEASON} (502): quota · 1 CBBD call`);
    });

    test('a refusal before any call is not', async () => {
        const fetch = jest.spyOn(cbbd, 'fetchTeams');
        const res = await request(app).post('/hoops/teams/2026/ingest').send({});
        expect(res.status).toBe(422);
        expect(fetch).not.toHaveBeenCalled();
        expect(await rows()).toHaveLength(0);
    });
});

describe('POST /hoops/teams/:season/roster', () => {
    test('records the import and its one call', async () => {
        jest.spyOn(roster, 'importSeason').mockResolvedValue({ season: SEASON, teams: 1500, players: 4200, remainingCalls: 29400 });
        const res = await request(app).post(`/hoops/teams/${SEASON}/roster`).send({});
        expect(res.status).toBe(200);
        const [row] = await rows();
        expect(row).toMatchObject({ action: 'hoops.roster', meta: { calls: 1, status: 200 } });
        expect(row.summary).toBe(`Basketball roster import for ${SEASON}: 4200 numbered players · 1 CBBD call`);
    });
});

describe('POST /hoops/games/:season/schedule', () => {
    const { start, end } = cbbd.seasonRange(SEASON);
    const windows = cbbd.windowsFor(start, end);

    test('the first run counts the roster import it made on top of the windows', async () => {
        stubGames();
        jest.spyOn(roster, 'hasSeason').mockResolvedValue(false);
        jest.spyOn(roster, 'importSeason').mockResolvedValue({ season: SEASON, teams: 1500, players: 4200 });
        const res = await request(app).post(`/hoops/games/${SEASON}/schedule`).send({});
        expect(res.status).toBe(200);
        const [row] = await rows();
        expect(row).toMatchObject({ action: 'hoops.schedule', meta: { calls: windows + 1 } });
        expect(row.summary).toBe(`Basketball regular schedule ingest for ${SEASON}: 2 games (2 created, 0 updated) · ${windows + 1} CBBD calls`);
    });

    test('a later run, roster already on file, costs the windows only', async () => {
        stubGames();
        jest.spyOn(roster, 'hasSeason').mockResolvedValue(true);
        await request(app).post(`/hoops/games/${SEASON}/schedule`).send({});
        const [row] = await rows();
        expect(row.meta.calls).toBe(windows);
    });
});

describe('POST /hoops/games/refresh', () => {
    test('records the default window as one call', async () => {
        stubGames();
        const res = await request(app).post('/hoops/games/refresh').send({ season: SEASON });
        expect(res.status).toBe(200);
        const [row] = await rows();
        expect(row).toMatchObject({ action: 'hoops.refresh', meta: { calls: 1, status: 200 } });
        expect(row.summary).toBe(`Basketball regular results refresh for ${SEASON}: 2 games, 2 final (2 created, 0 updated) · 1 CBBD call`);
    });
});

describe('audit.onReply', () => {
    test('a row that cannot be built still lets the reply out', async () => {
        const bare = express();
        bare.get('/', (req, res) => {
            audit.onReply(req, res, () => { throw new Error('bad entry'); });
            res.json({ ok: true });
        });
        const res = await request(bare).get('/');
        expect(res.body).toEqual({ ok: true });
        expect(await rows()).toHaveLength(0);
    });
});

describe('audit.cbbdTaskEntry', () => {
    test('a failure with no message or quota header still reads', () => {
        const entry = audit.cbbdTaskEntry('hoops.refresh', 'results refresh', SEASON, 2, 500, {}, 'unused');
        expect(entry.summary).toBe(`Basketball results refresh FAILED for ${SEASON} (500): no message · 2 CBBD calls`);
        expect(entry.meta).toEqual({ calls: 2, status: 500, remainingCalls: null });
    });
});

test('audit.onReply hands the entry an empty body when the reply has none', async () => {
    const bare = express();
    const seen = [];
    bare.get('/', (req, res) => {
        audit.onReply(req, res, (status, body) => { seen.push(body); return null; });
        res.json();
    });
    await request(bare).get('/');
    expect(seen).toEqual([{}]);
});
