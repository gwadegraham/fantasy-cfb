// make-pick, through the real socket handler (#320).
//
// WHY THIS FILE EXISTS: the pool gate shipped with no coverage at all. Deleting
// the whole block from modules/draft-socket.js left 143 suites and 2,959 tests
// green, because only the pure resolver was tested and nothing exercised the
// plumbing around it. That plumbing is where both of its bugs were — an
// un-normalised id, and the client's own object being stored.
//
// Driven through registerDraftSockets with real socket.io clients rather than
// by calling a function: the handler IS the thing under test, and a unit test
// of its parts is what missed this.

const http = require('http');
const { Server } = require('socket.io');
const Client = require('socket.io-client');
const draftToken = require('../modules/draft-token');
const mongoose = require('mongoose');
const { useMongo } = require('./helpers/mongo');
const Team = require('../models/team');
const HoopsTeam = require('../models/hoopsTeam');
const League = require('../models/league');
const SportSeason = require('../models/sportSeason');
const Draft = require('../models/draft');
const activeSeason = require('../modules/active-season');

useMongo();

const SEASON = 2026;
const LEAGUE = 'graham-league';
const HOOPS = 'hoops-league';
const HOOPS_SEASON = 2027;

const ANN = new mongoose.Types.ObjectId();
const BOB = new mongoose.Types.ObjectId();

let io, server, port, registerDraftSockets;

const LOC = { venue_id: 7, name: 'Stadium', city: 'C', state: 'ST', zip: '1',
              latitude: 1, longitude: 1, capacity: 100, grass: true, dome: false };
const fbs = (id, school, over = {}) => Object.assign({
    id, school, mascot: 'M', abbreviation: school.slice(0, 3).toUpperCase(),
    conference: 'SEC', color: '#000', logos: ['a.png'], location: LOC
}, over);
const hoops = (id, school, rank) => ({
    id, season: HOOPS_SEASON, school, mascot: 'M', abbreviation: school.slice(0, 3).toUpperCase(),
    conference: 'Test', color: '#000', logos: ['a.png'],
    ...(rank == null ? {} : { preseason: { rank } })
});

beforeAll(async () => {
    process.env.AUTH_SECRET = process.env.AUTH_SECRET || 'test-auth-secret';
    registerDraftSockets = require('../modules/draft-socket');
    server = http.createServer();
    io = new Server(server);
    registerDraftSockets(io);
    await new Promise(resolve => server.listen(0, resolve));
    port = server.address().port;
});

afterAll(async () => {
    if (io) io.close();
    if (server) await new Promise(resolve => server.close(resolve));
});

beforeEach(async () => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
    activeSeason._reset();
    await League.create([
        { code: LEAGUE, name: 'Graham', sport: 'football', season: SEASON },
        { code: HOOPS, name: 'Hoops', sport: 'basketball', season: HOOPS_SEASON }
    ]);
    await SportSeason.create([
        { sport: 'football', season: SEASON, status: 'in-season' },
        { sport: 'basketball', season: HOOPS_SEASON, status: 'in-season' }
    ]);
    await activeSeason.prime();
});
afterEach(() => jest.restoreAllMocks());

// A socket authenticated as one manager. The handler reads its identity off
// the handshake token, so this is the only way in.
// pick-made is broadcast to the ROOM, so a client that never joined hears
// nothing and every acceptance reads as a timeout. join-draft first.
async function joinedClient(userId, league, season, over = {}) {
    const socket = await connect(userId, over);
    await new Promise((resolve) => {
        socket.once('draft-state', resolve);
        socket.emit('join-draft', { league, season });
        setTimeout(resolve, 1500);
    });
    return socket;
}

function connect(userId, over = {}) {
    const token = draftToken.sign(
        Object.assign({ userId: String(userId), role: 'Manager', name: 'Test', league: LEAGUE }, over),
        process.env.AUTH_SECRET
    );
    const socket = Client(`http://localhost:${port}`, { auth: { token }, transports: ['websocket'] });
    return new Promise((resolve, reject) => {
        socket.on('connect', () => resolve(socket));
        socket.on('connect_error', reject);
    });
}

// Emit and settle: a pick either lands (pick-made) or is refused
// (draft-error), and both are broadcast asynchronously.
function pick(socket, payload) {
    return new Promise((resolve) => {
        const done = (outcome) => resolve(outcome);
        socket.once('pick-made', (p) => done({ ok: true, pick: p.pick }));
        socket.once('draft-error', (e) => done({ ok: false, message: e.message }));
        socket.emit('make-pick', payload);
        setTimeout(() => done({ ok: false, message: 'timeout' }), 2500);
    });
}

const activeDraft = (over = {}) => Draft.create(Object.assign({
    league: LEAGUE, season: SEASON, status: 'active',
    draftOrder: [ANN, BOB], totalRounds: 2, snake: true, currentOverall: 1
}, over));

describe('make-pick enforces the pool', () => {
    test('a team in the pool is accepted', async () => {
        await Team.create([fbs(1, 'Alabama')]);
        await activeDraft();
        const ann = await joinedClient(ANN, LEAGUE, SEASON);
        const res = await pick(ann, { league: LEAGUE, season: SEASON, team: { id: 1 } });
        ann.close();
        expect(res.ok).toBe(true);
        expect(res.pick.team.school).toBe('Alabama');
    });

    test('an FCS team is refused — it is reference data, not draftable', async () => {
        await Team.create([fbs(1, 'Alabama'), fbs(2, 'Reference', { classification: 'fcs' })]);
        await activeDraft();
        const ann = await joinedClient(ANN, LEAGUE, SEASON);
        const res = await pick(ann, { league: LEAGUE, season: SEASON, team: { id: 2 } });
        ann.close();
        expect(res).toMatchObject({ ok: false, message: 'That team is not in the draft pool' });
    });

    test('a team id that exists nowhere is refused', async () => {
        await Team.create([fbs(1, 'Alabama')]);
        await activeDraft();
        const ann = await joinedClient(ANN, LEAGUE, SEASON);
        const res = await pick(ann, { league: LEAGUE, season: SEASON, team: { id: 999 } });
        ann.close();
        expect(res.ok).toBe(false);
    });

    // THE BUG THIS FILE WAS WRITTEN FOR.
    //
    // Number("1") validated as team 1, and the raw "1" was then stored. The
    // duplicate guard compares 'picks.team.id' against stored NUMBERS, and
    // "1" !== 1 in BSON — so the second manager got the same team.
    test('a STRING team id cannot take a team that is already drafted', async () => {
        await Team.create([fbs(1, 'Alabama'), fbs(2, 'Auburn')]);
        await activeDraft();

        const ann = await joinedClient(ANN, LEAGUE, SEASON);
        const first = await pick(ann, { league: LEAGUE, season: SEASON, team: { id: 1 } });
        ann.close();
        expect(first.ok).toBe(true);

        const bob = await joinedClient(BOB, LEAGUE, SEASON);
        const second = await pick(bob, { league: LEAGUE, season: SEASON, team: { id: '1' } });
        bob.close();

        expect(second.ok).toBe(false);
        const stored = await Draft.findOne({ league: LEAGUE, season: SEASON }).lean();
        expect(stored.picks).toHaveLength(1);
    });

    test('and an id that is not a plain integer is refused outright', async () => {
        await Team.create([fbs(1, 'Alabama')]);
        await activeDraft();
        const ann = await joinedClient(ANN, LEAGUE, SEASON);
        for (const id of [' 1 ', [1], true, '1e0']) {
            const res = await pick(ann, { league: LEAGUE, season: SEASON, team: { id } });
            expect(res.ok).toBe(false);
        }
        ann.close();
        const stored = await Draft.findOne({ league: LEAGUE, season: SEASON }).lean();
        expect(stored.picks).toEqual([]);
    });

    // The other half of trusting the client: a valid id with a fabricated body
    // used to be stored verbatim and reach the roster, the board and grades.
    test('the STORED team is ours, not the one the client sent', async () => {
        await Team.create([fbs(1, 'Alabama')]);
        await activeDraft();
        const ann = await joinedClient(ANN, LEAGUE, SEASON);
        const res = await pick(ann, {
            league: LEAGUE, season: SEASON,
            team: { id: 1, school: 'TOTALLY NOT ALABAMA', logos: ['http://evil.example/x.png'], injected: true }
        });
        ann.close();

        expect(res.ok).toBe(true);
        const stored = await Draft.findOne({ league: LEAGUE, season: SEASON }).lean();
        expect(stored.picks[0].team.school).toBe('Alabama');
        expect(stored.picks[0].team.logos).toEqual(['a.png']);
        expect(stored.picks[0].team.injected).toBeUndefined();
    });

    // And it has to be the WHOLE row, because the roster schema requires
    // fields the pool projection does not carry — location above all. Storing
    // a projected row would 400 every roster write at the end of the draft.
    test('the stored team carries what a roster requires', async () => {
        await Team.create([fbs(1, 'Alabama')]);
        await activeDraft();
        const ann = await joinedClient(ANN, LEAGUE, SEASON);
        await pick(ann, { league: LEAGUE, season: SEASON, team: { id: 1 } });
        ann.close();

        const stored = await Draft.findOne({ league: LEAGUE, season: SEASON }).lean();
        expect(stored.picks[0].team.location).toMatchObject({ name: 'Stadium', capacity: 100 });
        expect(stored.picks[0].team.mascot).toBe('M');
    });
});

describe('make-pick enforces the cap, for basketball', () => {
    const hoopsDraft = (over = {}) => Draft.create(Object.assign({
        league: HOOPS, season: HOOPS_SEASON, status: 'active',
        draftOrder: [ANN, BOB], totalRounds: 2, snake: true, currentOverall: 1
    }, over));

    test('a team inside the cap is accepted', async () => {
        await HoopsTeam.create([hoops(1, 'Best', 1), hoops(2, 'Next', 2), hoops(3, 'Out', 3)]);
        await hoopsDraft({ poolSize: 2 });
        const ann = await joinedClient(ANN, HOOPS, HOOPS_SEASON);
        const res = await pick(ann, { league: HOOPS, season: HOOPS_SEASON, team: { id: 1 } });
        ann.close();
        expect(res.ok).toBe(true);
    });

    test('a team OUTSIDE the cap is refused — this is what made the cap real', async () => {
        await HoopsTeam.create([hoops(1, 'Best', 1), hoops(2, 'Next', 2), hoops(3, 'Out', 3)]);
        await hoopsDraft({ poolSize: 2 });
        const ann = await joinedClient(ANN, HOOPS, HOOPS_SEASON);
        const res = await pick(ann, { league: HOOPS, season: HOOPS_SEASON, team: { id: 3 } });
        ann.close();
        expect(res).toMatchObject({ ok: false, message: 'That team is not in the draft pool' });
    });

    test('an unranked team is refused even with no cap at all', async () => {
        await HoopsTeam.create([hoops(1, 'Ranked', 1), hoops(2, 'Unranked', null)]);
        await hoopsDraft({ poolSize: null });
        const ann = await joinedClient(ANN, HOOPS, HOOPS_SEASON);
        const res = await pick(ann, { league: HOOPS, season: HOOPS_SEASON, team: { id: 2 } });
        ann.close();
        expect(res.ok).toBe(false);
    });

    test('a FOOTBALL team id is not draftable in a basketball league', async () => {
        // Same id, two collections. The sport decides which one is consulted,
        // and an unprimed cache answering "football" for everything is why
        // draftableTeam refuses rather than guessing.
        await Team.create([fbs(1, 'Alabama')]);
        await HoopsTeam.create([hoops(2, 'Best', 1)]);
        await hoopsDraft({ poolSize: null });
        const ann = await joinedClient(ANN, HOOPS, HOOPS_SEASON);
        const res = await pick(ann, { league: HOOPS, season: HOOPS_SEASON, team: { id: 1 } });
        ann.close();
        expect(res.ok).toBe(false);
    });
});
