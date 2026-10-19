// The Leagues page and Create league (#536): routes/leagueAdmin.js and the
// franchise-repo function step 2 is built on.
//
// What this file is for, in the order it matters:
//
//   1. Putting an existing manager in a new league never makes a second
//      Account. Their login resolves through metadata.userId to ONE account
//      _id, so a duplicate is a franchise nobody can log in as — exactly what
//      "Add a Player" did for someone already in the app.
//   2. That manager, with the session they already had, can switch to the
//      new league. The identity guard still lets them in.
//   3. Nobody but an Admin or a League Manager can reach any of it, a League
//      Manager only for leagues they run (#600), and a 404 is the answer
//      wherever a 403 would say the thing exists.
//   4. Creating a basketball league tells nobody else it is there.
//
// The app below is wired the way server.js wires it — the same commissioner
// gate on non-GETs, this router in front of routes/leagues.js — because the
// page and the old JSON list share GET /leagues, and the gate is the reason
// a League Manager's POST reaches this router at all.

process.env.AUTH_SECRET = process.env.AUTH_SECRET || 'test-auth-secret';
process.env.URL = process.env.URL || 'https://campusclash.io';

const express = require('express');
const path = require('path');
const request = require('supertest');
const mongoose = require('mongoose');
const { useMongo } = require('./helpers/mongo');
const Account = require('../models/account');
const Franchise = require('../models/franchise');
const League = require('../models/league');
const Draft = require('../models/draft');
const AuditLog = require('../models/auditLog');
const SportSeason = require('../models/sportSeason');
const seasons = require('../modules/active-season');
const repo = require('../modules/franchise-repo');
const selection = require('../modules/league-selection');
const { seesBasketball } = require('../modules/hoops-visibility');
const identityGuard = require('../modules/identity-guard');
const requireCommissioner = require('../modules/require-commissioner');
const leagueAdmin = require('../routes/leagueAdmin');
const leaguesRouter = require('../routes/leagues');
const usersRouter = require('../routes/users');
const draftRouter = require('../routes/draft');

useMongo();

const FOOTBALL = 2026;
const HOOPS = 2027;

// who: null = signed out; otherwise { roles, accountId, email, league }.
function appAs(who) {
    const a = express();
    a.set('views', path.join(__dirname, '..', 'views'));
    a.set('view engine', 'ejs');
    a.use(express.json());
    a.use((req, res, next) => {
        const user = who && {
            email: who.email,
            user_metadata: { roles: who.roles || [], metadata: { userId: who.accountId ? String(who.accountId) : undefined, league: who.league || 'gg' } }
        };
        req.oidc = { isAuthenticated: () => !!who, user };
        req.effUser = user;
        next();
    });
    a.use(['/users', '/draft', '/leagues'], (req, res, next) => (req.method === 'GET' ? next() : requireCommissioner(req, res, next)));
    a.use('/leagues', leagueAdmin.build({
        pageLocals: () => ({ user: { userId: 'u1', firstName: 'G', role: (who && who.roles && who.roles[0]) || '' }, userState: '{}', draftDefaults: '{}' })
    }));
    a.use('/leagues', leaguesRouter);
    a.use('/users', usersRouter);
    a.use('/draft', draftRouter);
    a.post('/league/select', selection.selectHandler);
    // The real guard, on a route of its own: the Admin here is a made-up
    // account with no record, which the guard would rightly block.
    a.get('/whoami', identityGuard({ repo }), (req, res) => res.json({ ok: true }));
    a.use((req, res) => res.status(404).send('Not found'));
    return a;
}

const ADMIN = { roles: ['Admin'], accountId: new mongoose.Types.ObjectId(), email: 'admin@example.com' };
const LM = { roles: ['League Manager'], accountId: new mongoose.Types.ObjectId(), email: 'lm@example.com' };

async function person(first, league, extra = {}) {
    const a = await Account.create({ firstName: first, lastName: 'Lee', email: `${first.toLowerCase()}@example.com` });
    await Franchise.create(Object.assign({ accountId: a._id, league, seasons: [{ season: FOOTBALL }] }, extra));
    return a;
}

let ann, bob;
beforeEach(async () => {
    seasons._reset();
    await SportSeason.create([{ sport: 'football', season: FOOTBALL, status: 'in-season' },
                              { sport: 'basketball', season: HOOPS, status: 'preseason' }]);
    await League.create([{ code: 'graham-league', name: 'The Polar Depressed', sport: 'football' },
                         { code: 'claunts-league', name: 'Goofballers', sport: 'football' }]);
    await seasons.prime();
    ann = await person('Ann', 'graham-league');
    bob = await person('Bob', 'claunts-league');
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => { jest.restoreAllMocks(); seasons._reset(); });

const as = (who) => request(appAs(who));
const create = (body, who = ADMIN) => as(who).post('/leagues/admin').send(body);

// A manager added after the draft order was saved goes LAST in it, through
// every door that adds one. Without this they get no slots in the draft room
// (it builds every pick from draftOrder) and nothing says so on draft night.
describe('late joiners go last in a saved draft order', () => {
    const { pickOrder } = require('../modules/draft-engine');
    const orderOf = async (league, season = FOOTBALL) =>
        ((await Draft.findOne({ league, season }).lean()).draftOrder || []).map(String);
    let cal;
    beforeEach(async () => {
        cal = await person('Cal', 'graham-league');
        await Draft.create({ league: 'graham-league', season: FOOTBALL, status: 'scheduled', draftOrder: [cal._id, ann._id] });
    });

    test('the Leagues page step 2 adds them last, and they get picks', async () => {
        const res = await as(ADMIN).post('/leagues/admin/graham-league/members').send({ accountIds: [String(bob._id)] });
        expect(res.body.added).toEqual([String(bob._id)]);
        expect(await orderOf('graham-league')).toEqual([String(cal._id), String(ann._id), String(bob._id)]);
        const draft = await Draft.findOne({ league: 'graham-league', season: FOOTBALL }).lean();
        expect(pickOrder(draft).filter(p => p.userId === String(bob._id))).toHaveLength(draft.totalRounds);
    });

    test('Add a Player adds the new account last', async () => {
        const res = await as(ADMIN).post('/users').send({ firstName: 'Dee', lastName: 'Lee', email: 'dee@example.com', league: 'graham-league' });
        expect(res.status).toBe(201);
        expect((await orderOf('graham-league')).slice(-1)).toEqual([String(res.body._id)]);
    });

    test('someone rejoining for this season goes last too', async () => {
        await Draft.create({ league: 'graham-league', season: 2030, status: 'pending', draftOrder: [cal._id] });
        await repo.addFranchise(ann._id, 'graham-league', { season: 2030 });
        expect(await orderOf('graham-league', 2030)).toEqual([String(cal._id), String(ann._id)]);
    });

    test('a pending draft (saved with no date) takes them too', async () => {
        await Draft.updateOne({ league: 'graham-league' }, { $set: { status: 'pending' } });
        await repo.addFranchise(bob._id, 'graham-league', { season: FOOTBALL });
        expect((await orderOf('graham-league')).slice(-1)).toEqual([String(bob._id)]);
    });

    test.each(['active', 'complete'])('a draft that is %s is left alone', async (status) => {
        await Draft.updateOne({ league: 'graham-league' }, { $set: { status } });
        await repo.addFranchise(bob._id, 'graham-league', { season: FOOTBALL });
        expect(await orderOf('graham-league')).toEqual([String(cal._id), String(ann._id)]);
    });

    test('an order never set stays empty — setup fills it from everyone', async () => {
        await Draft.updateOne({ league: 'graham-league' }, { $set: { draftOrder: [] } });
        await repo.addFranchise(bob._id, 'graham-league', { season: FOOTBALL });
        expect(await orderOf('graham-league')).toEqual([]);
    });

    test('only that season\'s draft, and nobody twice', async () => {
        await Draft.create({ league: 'graham-league', season: 2025, status: 'pending', draftOrder: [cal._id] });
        const draftOrder = require('../modules/draft-order');
        await repo.addFranchise(bob._id, 'graham-league', { season: FOOTBALL });
        await draftOrder.appendManager('graham-league', FOOTBALL, bob._id);
        expect(await orderOf('graham-league')).toEqual([String(cal._id), String(ann._id), String(bob._id)]);
        expect(await orderOf('graham-league', 2025)).toEqual([String(cal._id)]);
    });

    test('a failed append never fails the add', async () => {
        jest.spyOn(Draft, 'updateOne').mockRejectedValueOnce(new Error('mongo down'));
        const res = await as(ADMIN).post('/leagues/admin/graham-league/members').send({ accountIds: [String(bob._id)] });
        expect(res.status).toBe(200);
        expect(res.body.added).toEqual([String(bob._id)]);
        expect(console.error).toHaveBeenCalledWith(expect.stringMatching(/draft order: could not add/));
    });
});

describe('franchiseRepo.addFranchise', () => {
    test('a franchise under the SAME account, and no new account', async () => {
        const before = await Account.countDocuments({});
        const out = await repo.addFranchise(ann._id, 'hoops', { season: HOOPS, lastUpdated: 'now' });
        expect(out.created).toBe(true);
        expect(await Account.countDocuments({})).toBe(before);
        const mine = await Franchise.find({ accountId: ann._id }).lean();
        expect(mine.map(f => f.league).sort()).toEqual(['graham-league', 'hoops']);
        const added = mine.find(f => f.league === 'hoops');
        expect(added.seasons.map(s => s.season)).toEqual([HOOPS]);
        expect(added.lastUpdated).toBe('now');
    });

    test('a second time for the SAME season is a no-op that leaves the first one alone', async () => {
        const out = await repo.addFranchise(ann._id, 'graham-league', { season: FOOTBALL });
        const f = await Franchise.findOne({ accountId: ann._id, league: 'graham-league' }).lean();
        expect(out).toEqual({ created: false, franchiseId: f._id });
        expect(f.seasons.map(s => s.season)).toEqual([FOOTBALL]);
        expect(await Franchise.countDocuments({ accountId: ann._id })).toBe(1);
    });

    test('someone who sat a season out is brought back: the season added, their history kept, still one franchise', async () => {
        const out = await repo.addFranchise(ann._id, 'graham-league', { season: 2030 });
        const f = await Franchise.findOne({ accountId: ann._id, league: 'graham-league' }).lean();
        expect(out).toEqual({ created: true, rejoined: true, franchiseId: f._id });
        expect(f.seasons.map(s => s.season)).toEqual([FOOTBALL, 2030]);
        expect(await Franchise.countDocuments({ accountId: ann._id })).toBe(1);
        // and a repeat is then the no-op
        expect((await repo.addFranchise(ann._id, 'graham-league', { season: 2030 })).created).toBe(false);
    });

    test('an unknown account is an error, never a new account', async () => {
        const ghost = new mongoose.Types.ObjectId();
        await expect(repo.addFranchise(ghost, 'hoops', { season: HOOPS })).rejects.toThrow(/no account/);
        expect(await Account.exists({ _id: ghost })).toBeNull();
        expect(await Franchise.countDocuments({ league: 'hoops' })).toBe(0);
    });

    test('no league is an error', async () => {
        await expect(repo.addFranchise(ann._id, '')).rejects.toThrow(/league is required/);
    });

    test('no season means no season entry', async () => {
        await repo.addFranchise(ann._id, 'hoops');
        expect((await Franchise.findOne({ accountId: ann._id, league: 'hoops' }).lean()).seasons).toEqual([]);
    });

    test('losing a race to the same tick is the same answer', async () => {
        const dup = Object.assign(new Error('E11000 duplicate key'), { code: 11000 });
        jest.spyOn(Franchise, 'create').mockRejectedValueOnce(dup);
        await expect(repo.addFranchise(ann._id, 'hoops', { season: HOOPS })).resolves.toEqual({ created: false, franchiseId: null });
    });

    test('any other write failure is thrown', async () => {
        jest.spyOn(Franchise, 'create').mockRejectedValueOnce(new Error('disk full'));
        await expect(repo.addFranchise(ann._id, 'hoops', { season: HOOPS })).rejects.toThrow('disk full');
    });
});

describe('step 1: create', () => {
    test('writes the League with the sport, and the season is the sport\'s', async () => {
        const res = await create({ sport: 'basketball', name: '  Hardwood Heroes ' });
        expect(res.status).toBe(201);
        // creatorJoined false here: this Admin is a made-up identity with no
        // account on file (see the next describe for a real one).
        expect(res.body).toEqual({ code: 'hardwood-heroes', name: 'Hardwood Heroes', sport: 'basketball', season: HOOPS, creatorJoined: false });
        const doc = await League.findOne({ code: 'hardwood-heroes' }).lean();
        expect(doc.sport).toBe('basketball');
        // Unset, so it follows its sport when the sport rolls over.
        expect(doc.season).toBeUndefined();
        // This dyno knows its sport at once — the admin page and the draft
        // read the cache.
        expect(seasons.sportForLeague('hardwood-heroes')).toBe('basketball');
        expect(seasons.seasonForLeague('hardwood-heroes')).toBe(HOOPS);
        expect(await AuditLog.countDocuments({ action: 'league.create', league: 'hardwood-heroes' })).toBe(1);
    });

    test('the creator plays in it: a team under their OWN account, no second account', async () => {
        const me = await person('Gar', 'graham-league');
        const ME = { roles: ['Admin'], accountId: me._id, email: 'gar@example.com' };
        const accounts = await Account.countDocuments({});
        const res = await create({ sport: 'basketball', name: 'Bracket Busters' }, ME);
        expect(res.status).toBe(201);
        expect(res.body.creatorJoined).toBe(true);
        const mine = await Franchise.findOne({ accountId: me._id, league: res.body.code }).lean();
        expect(mine.seasons.map(x => x.season)).toEqual([HOOPS]);
        expect(await Account.countDocuments({})).toBe(accounts);
        expect((await AuditLog.findOne({ action: 'league.create', league: res.body.code }).lean()).summary).toMatch(/and joined it$/);
        // …and their football team is untouched.
        expect(await Franchise.countDocuments({ accountId: me._id })).toBe(2);
    });

    test('a creator with no account on file still gets the league — the join is not fatal', async () => {
        const res = await create({ sport: 'football', name: 'Lonely League' });
        expect(res.status).toBe(201);
        expect(res.body.creatorJoined).toBe(false);
        expect(await League.countDocuments({ code: res.body.code })).toBe(1);
    });

    test('creates no account and no franchise', async () => {
        const [a, f] = [await Account.countDocuments({}), await Franchise.countDocuments({})];
        await create({ sport: 'football', name: 'Third League' });
        expect(await Account.countDocuments({})).toBe(a);
        expect(await Franchise.countDocuments({})).toBe(f);
    });

    test('a taken code gets a suffix; a taken name is refused', async () => {
        await League.create({ code: 'hoops', name: 'Old Hoops', sport: 'basketball', status: 'archived' });
        expect((await create({ sport: 'basketball', name: 'Hoops!' })).body.code).toBe('hoops-2');
        const dup = await create({ sport: 'football', name: 'the polar depressed' });
        expect(dup.status).toBe(409);
    });

    test('a code taken between the read and the write is retried', async () => {
        const real = League.create.bind(League);
        jest.spyOn(League, 'create')
            .mockRejectedValueOnce(Object.assign(new Error('E11000'), { code: 11000 }))
            .mockImplementation(real);
        const res = await create({ sport: 'football', name: 'Racy' });
        expect(res.status).toBe(201);
        expect(res.body.code).toBe('racy-2');
    });

    test.each([
        [{ sport: 'hockey', name: 'Ice' }, 400],
        [{ sport: 'football', name: '   ' }, 400],
        [{ sport: 'football', name: 'x'.repeat(41) }, 400],
        [{}, 400]
    ])('%j is refused (%i)', async (body, code) => {
        expect((await create(body)).status).toBe(code);
        expect(await League.countDocuments({})).toBe(2);
    });

    test('a sport with no season cannot have a league', async () => {
        await SportSeason.deleteOne({ sport: 'basketball' });
        await seasons.prime();
        const res = await create({ sport: 'basketball', name: 'Too Early' });
        expect(res.status).toBe(409);
        expect(await League.exists({ name: 'Too Early' })).toBeNull();
    });

    test('a failed re-prime does not report a league that WAS made as failed', async () => {
        jest.spyOn(seasons, 'prime').mockRejectedValueOnce(new Error('blip'));
        const res = await create({ sport: 'football', name: 'Blip' });
        expect(res.status).toBe(201);
        expect(await League.exists({ code: 'blip' })).not.toBeNull();
    });

    test('a database failure is a 500, not a half-made league', async () => {
        jest.spyOn(League, 'create').mockRejectedValueOnce(new Error('down'));
        expect((await create({ sport: 'football', name: 'Down' })).status).toBe(500);
    });
});

describe('step 2: existing managers', () => {
    let code;
    beforeEach(async () => { code = (await create({ sport: 'basketball', name: 'Hardwood Heroes' })).body.code; });
    const add = (ids, who = ADMIN) => as(who).post(`/leagues/admin/${code}/members`).send({ accountIds: ids });

    test('the candidates are everyone in another league, once, with where they play', async () => {
        await Franchise.create({ accountId: ann._id, league: 'claunts-league', seasons: [{ season: FOOTBALL }] });
        const res = await as(ADMIN).get(`/leagues/admin/candidates?league=${code}`);
        expect(res.status).toBe(200);
        expect(res.body.map(c => c.firstName)).toEqual(['Ann', 'Bob']);
        expect(res.body[0].leagues).toEqual(['Goofballers', 'The Polar Depressed']);
        // Nothing an Admin page does not need.
        expect(Object.keys(res.body[0]).sort()).toEqual(['_id', 'avatarUrl', 'color', 'firstName', 'lastName', 'leagues']);
    });

    test('a league they are not playing this season is marked past', async () => {
        await Franchise.updateOne({ accountId: bob._id, league: 'claunts-league' }, { $set: { seasons: [{ season: 2024 }] } });
        const res = await as(ADMIN).get(`/leagues/admin/candidates?league=${code}`);
        expect(res.body.find(c => c.firstName === 'Bob').leagues).toEqual(['Goofballers (past)']);
        expect(res.body.find(c => c.firstName === 'Ann').leagues).toEqual(['The Polar Depressed']);
    });

    test('someone already in the league is not a candidate', async () => {
        await add([String(ann._id)]);
        const res = await as(ADMIN).get(`/leagues/admin/candidates?league=${code}`);
        expect(res.body.map(c => c.firstName)).toEqual(['Bob']);
    });

    test('THE FEATURE: they join under their own account, and no account is created', async () => {
        const accounts = await Account.countDocuments({});
        const res = await add([String(ann._id), String(bob._id)]);
        expect(res.status).toBe(200);
        expect(res.body.added.sort()).toEqual([String(ann._id), String(bob._id)].sort());
        expect(await Account.countDocuments({})).toBe(accounts);
        for (const who of [ann, bob]) {
            const f = await Franchise.findOne({ accountId: who._id, league: code }).lean();
            expect(f.seasons.map(s => s.season)).toEqual([HOOPS]);
        }
        expect(await AuditLog.countDocuments({ action: 'league.members', league: code })).toBe(1);
    });

    test('ticking someone twice adds them once', async () => {
        await add([String(ann._id)]);
        const again = await add([String(ann._id), String(ann._id)]);
        expect(again.body).toMatchObject({ added: [], already: [String(ann._id)] });
        expect(await Franchise.countDocuments({ accountId: ann._id, league: code })).toBe(1);
    });

    test('someone who only ever played THIS league, in a past season, is brought back', async () => {
        const cole = await Account.create({ firstName: 'Cole', lastName: 'Old', email: 'cole@example.com' });
        await Franchise.create({ accountId: cole._id, league: code, seasons: [{ season: 2020 }] });
        expect((await as(ADMIN).get(`/leagues/admin/account?email=cole@example.com&league=${code}`)).body)
            .toMatchObject({ inLeague: false, joined: true });
        const res = await add([String(cole._id)]);
        expect(res.body).toMatchObject({ added: [String(cole._id)], refused: [] });
        expect(await Franchise.countDocuments({ accountId: cole._id })).toBe(1);
    });

    test('someone with no team anywhere is refused, not added', async () => {
        const loner = await Account.create({ firstName: 'Lo', lastName: 'Ner', email: 'lo@example.com' });
        expect((await as(ADMIN).get(`/leagues/admin/account?email=lo@example.com&league=${code}`)).body.joined).toBe(false);
        const res = await add([String(loner._id)]);
        expect(res.body.refused).toEqual([String(loner._id)]);
        expect(await Franchise.countDocuments({ league: code })).toBe(0);
    });

    test.each([[[]], [['nope']], [Array.from({ length: 31 }, () => String(new mongoose.Types.ObjectId()))]])('a bad list is a 400', async (ids) => {
        expect((await add(ids)).status).toBe(400);
    });

    test('an unknown or archived league is a 404', async () => {
        await League.updateOne({ code }, { status: 'archived' });
        expect((await add([String(ann._id)])).status).toBe(404);
        expect((await as(ADMIN).post('/leagues/admin/nope/members').send({ accountIds: [String(ann._id)] })).status).toBe(404);
    });

    test('a failure is a 500', async () => {
        jest.spyOn(repo, 'addFranchise').mockRejectedValueOnce(new Error('down'));
        expect((await add([String(ann._id)])).status).toBe(500);
    });

    test('candidates need a league, and a failure is a 500', async () => {
        expect((await as(ADMIN).get('/leagues/admin/candidates')).status).toBe(400);
        jest.spyOn(Franchise, 'find').mockImplementationOnce(() => { throw new Error('down'); });
        expect((await as(ADMIN).get(`/leagues/admin/candidates?league=${code}`)).status).toBe(500);
    });

    test('nobody anywhere else: an empty list', async () => {
        await Franchise.deleteMany({ league: { $ne: code } });
        expect((await as(ADMIN).get(`/leagues/admin/candidates?league=${code}`)).body).toEqual([]);
    });
});

describe('a former member is offered again (#538 QA)', () => {
    test('candidates and the email check treat someone with no team THIS season as not in the league', async () => {
        // Ann played graham-league in an older season only.
        await Franchise.updateOne({ accountId: ann._id, league: 'graham-league' }, { $set: { seasons: [{ season: 2024 }] } });
        await League.create({ code: 'hoops-x', name: 'Hoops X', sport: 'basketball' });
        await seasons.prime();
        await Franchise.create({ accountId: ann._id, league: 'hoops-x', seasons: [{ season: 2020 }] });   // sat out since
        const cands = (await as(ADMIN).get('/leagues/admin/candidates?league=hoops-x')).body;
        expect(cands.map(c => c.firstName)).toContain('Ann');
        const look = (await as(ADMIN).get('/leagues/admin/account?email=ann@example.com&league=hoops-x')).body;
        expect(look.inLeague).toBe(false);
        const add = (await as(ADMIN).post('/leagues/admin/hoops-x/members').send({ accountIds: [String(ann._id)] })).body;
        expect(add.added).toEqual([String(ann._id)]);
        const f = await Franchise.findOne({ accountId: ann._id, league: 'hoops-x' }).lean();
        expect(f.seasons.map(x => x.season)).toEqual([2020, HOOPS]);
    });
});

describe("step 2's email check", () => {
    let code;
    beforeEach(async () => { code = (await create({ sport: 'basketball', name: 'Hardwood Heroes' })).body.code; });
    const look = (email, who = ADMIN) => as(who).get(`/leagues/admin/account?email=${encodeURIComponent(email)}&league=${code}`);

    test('an existing email, in any case, is found — with where they play', async () => {
        const res = await look('  ANN@Example.com ');
        expect(res.body).toEqual({ found: true, _id: String(ann._id), firstName: 'Ann', lastName: 'Lee', inLeague: false, joined: true });
        await repo.addFranchise(ann._id, code, { season: HOOPS });
        expect((await look('ann@example.com')).body.inLeague).toBe(true);
    });

    test('a new email is not found, and a regex in it is just text', async () => {
        expect((await look('cy@example.com')).body).toEqual({ found: false });
        expect((await look('.*')).body).toEqual({ found: false });
    });

    test('needs both, is Admin-only, and a failure is a 500', async () => {
        expect((await as(ADMIN).get('/leagues/admin/account?email=a@b.c')).status).toBe(400);
        expect((await look('ann@example.com', LM)).status).toBe(404);
        jest.spyOn(Account, 'findOne').mockImplementationOnce(() => { throw new Error('down'); });
        expect((await look('ann@example.com')).status).toBe(500);
    });
});

describe('the whole flow, end to end', () => {
    test('create, add an existing manager and a new one, set the draft — one new account only', async () => {
        const accounts = await Account.countDocuments({});
        const made = (await create({ sport: 'basketball', name: 'Hardwood Heroes' })).body;

        await as(ADMIN).post(`/leagues/admin/${made.code}/members`).send({ accountIds: [String(ann._id)] });

        // Someone new: Add a Player, then the invite link — what the page does.
        const newbie = await as(ADMIN).post('/users').send({
            firstName: 'Cy', lastName: 'New', email: 'cy@example.com', league: made.code, seasons: [{ season: made.season }]
        });
        expect(newbie.status).toBe(201);
        const invite = await as(ADMIN).post(`/users/${newbie.body._id}/invite-link`);
        expect(invite.status).toBe(200);
        expect(invite.body.link).toContain('https://campusclash.io/invite/');

        // Exactly one account more: Cy's. Ann is the same Ann.
        expect(await Account.countDocuments({})).toBe(accounts + 1);
        expect(await Account.countDocuments({ firstName: 'Ann' })).toBe(1);

        const draft = await as(ADMIN).post('/draft').send({
            league: made.code, season: made.season, draftOrder: [String(newbie.body._id), String(ann._id)],
            orderMethod: 'manual', snake: true, totalRounds: 10, poolSize: 120, scheduledAt: null, autoOpen: false
        });
        expect(draft.status).toBe(200);
        const saved = await Draft.findOne({ league: made.code, season: HOOPS }).lean();
        expect(saved.draftOrder.map(String)).toEqual([String(newbie.body._id), String(ann._id)]);
        expect(saved.poolSize).toBe(120);

        // Then "Manage" lands on the basketball admin page with it selected.
        const open = await as(ADMIN).get(`/leagues/admin/${made.code}/open`);
        expect(open.status).toBe(302);
        expect(open.headers.location).toBe('/hoops/admin');
        expect(open.headers['set-cookie'].join(';')).toContain(`${selection.COOKIE}=${made.code}`);
    });
});

describe('the added manager, with the session they already had', () => {
    let code;
    beforeEach(async () => {
        code = (await create({ sport: 'basketball', name: 'Hardwood Heroes' })).body.code;
        await as(ADMIN).post(`/leagues/admin/${code}/members`).send({ accountIds: [String(ann._id)] });
    });
    const annLogin = () => ({ roles: [], accountId: ann._id, email: 'ann@example.com', league: 'gg' });

    test('still gets past the identity guard', async () => {
        const res = await as(annLogin()).get('/whoami');
        expect(res.status).toBe(200);
    });

    test('can switch to the new league, and is then viewing it', async () => {
        const res = await as(annLogin()).post('/league/select').send({ league: code });
        expect(res.status).toBe(200);
        const cookie = res.headers['set-cookie'].join(';');
        expect(cookie).toContain(`${selection.COOKIE}=${code}`);

        const user = { user_metadata: { roles: [], metadata: { userId: String(ann._id), league: 'gg' } } };
        const req = { oidc: { isAuthenticated: () => true, user }, headers: { cookie: `${selection.COOKIE}=${code}` } };
        expect(await selection.selectedLeague(req)).toBe(code);
        const ctx = await selection.viewerContext(req, [{ code, name: 'Hardwood Heroes' }]);
        expect(ctx.leagues.map(l => l.code)).toContain(code);
        expect(ctx.canSwitch).toBe(true);
        // And basketball is now theirs to see.
        expect(await seesBasketball(req)).toBe(true);
    });

    test('and lands on their own league until they switch', async () => {
        const user = { user_metadata: { roles: [], metadata: { userId: String(ann._id), league: 'gg' } } };
        expect(await selection.selectedLeague({ oidc: { isAuthenticated: () => true, user }, headers: {} })).toBe('graham-league');
    });
});

describe('basketball stays invisible to everyone else', () => {
    let code;
    beforeEach(async () => { code = (await create({ sport: 'basketball', name: 'Hardwood Heroes' })).body.code; });
    const bobLogin = () => ({ roles: [], accountId: bob._id, email: 'bob@example.com', league: 'cl' });

    test('a football member is not told it exists', async () => {
        const list = await as(bobLogin()).get('/leagues').set('Accept', 'application/json');
        expect(list.status).toBe(200);
        expect(JSON.stringify(list.body)).not.toContain('Hardwood');
        const user = { user_metadata: { roles: [], metadata: { userId: String(bob._id), league: 'cl' } } };
        const req = { oidc: { isAuthenticated: () => true, user }, headers: {} };
        expect(await seesBasketball(req)).toBe(false);
        const ctx = await selection.viewerContext(req, [{ code, name: 'Hardwood Heroes' }]);
        expect(JSON.stringify(ctx.seed)).not.toContain(code);
        expect((await as(bobLogin()).post('/league/select').send({ league: code })).status).toBe(403);
    });

    test('nor is a League Manager', async () => {
        const res = await as(LM).get(`/leagues/admin/candidates?league=${code}`);
        expect(res.status).toBe(404);
        expect(res.text).not.toContain('Hardwood');
    });
});

describe('who gets in', () => {
    const MEMBER = () => ({ roles: [], accountId: bob._id, email: 'bob@example.com', league: 'cl' });
    const routes = (code) => [
        ['GET', `/leagues/admin/candidates?league=${code}`],
        ['GET', `/leagues/admin/account?email=ann@example.com&league=${code}`],
        ['POST', `/leagues/admin/${code}/members`, { accountIds: [String(ann._id)] }],
        ['GET', `/leagues/admin/${code}/open`],
        ['GET', `/leagues/admin/${code}/commissioners`],
        ['PUT', `/leagues/admin/${code}/commissioners`, { accountIds: [String(LM.accountId)] }]
    ];
    const call = (who, [method, url, body]) => {
        const r = as(who)[method.toLowerCase()](url);
        return body ? r.send(body) : r;
    };

    test('a member gets 404 or 403 on every route, and learns nothing', async () => {
        const code = (await create({ sport: 'basketball', name: 'Hardwood Heroes' })).body.code;
        for (const r of [['GET', '/leagues/admin/rows'], ['POST', '/leagues/admin', { sport: 'football', name: 'Sneaky' }]].concat(routes(code))) {
            const res = await call(MEMBER(), r);
            expect([403, 404]).toContain(res.status);
            expect(res.text).not.toContain('Hardwood');
        }
        expect(await League.exists({ name: 'Sneaky' })).toBeNull();
        expect((await League.findOne({ code }).lean()).commissioners).toEqual([]);
    });

    // A League Manager may now open the page and create a league (#600), but
    // a league someone ELSE runs is as invisible to them as before: a 404 on
    // every route that names it, and no row.
    test("a League Manager gets a 404 on every route for a league they don't run, and learns nothing", async () => {
        const code = (await create({ sport: 'basketball', name: 'Hardwood Heroes' })).body.code;
        for (const r of routes(code)) {
            const res = await call(LM, r);
            expect(res.status).toBe(404);
            expect(res.text).not.toContain('Hardwood');
        }
        const list = await as(LM).get('/leagues/admin/rows');
        expect(list.status).toBe(200);
        expect(list.text).not.toContain('Hardwood');
        expect(await Franchise.exists({ league: code, accountId: ann._id })).toBeNull();
        expect((await League.findOne({ code }).lean()).commissioners).toEqual([]);
    });

    test('a member asking for the page gets a plain 404', async () => {
        const res = await as(MEMBER()).get('/leagues').set('Accept', 'text/html');
        expect(res.status).toBe(404);
        expect(res.text).not.toContain('leagues-page');
    });

    test('a League Manager gets the page, without the Admin view', async () => {
        const res = await as(LM).get('/leagues').set('Accept', 'text/html');
        expect(res.status).toBe(200);
        expect(res.text).toContain('id="leagues-page"');
        expect(res.text).toContain('window.LEAGUES_IS_ADMIN = false');
    });

    // Running a league is not being trusted to start new ones: someone made a
    // commissioner without the Auth0 role gets no page and cannot create.
    test('an appointed commissioner without the role cannot create a league', async () => {
        const code = (await create({ sport: 'basketball', name: 'Hardwood Heroes' })).body.code;
        await League.updateOne({ code }, { $set: { commissioners: [bob._id] } });
        await seasons.prime();
        expect((await as(MEMBER()).get('/leagues').set('Accept', 'text/html')).status).toBe(404);
        // Passes the commissioner gate (they run a league), so the router answers.
        expect((await as(MEMBER()).post('/leagues/admin').send({ sport: 'football', name: 'Mine' })).status).toBe(404);
        expect(await League.exists({ name: 'Mine' })).toBeNull();
    });

    test('signed out: the page goes to login, the API is not reachable', async () => {
        const res = await as(null).get('/leagues').set('Accept', 'text/html');
        expect(res.status).toBe(302);
        expect(res.headers.location).toBe('/login');
        expect((await as(null).get('/leagues/admin/rows')).status).toBe(404);
    });
});

describe('the page and the list', () => {
    test('an Admin gets the page; a JSON request still gets the old league list', async () => {
        const page = await as(ADMIN).get('/leagues').set('Accept', 'text/html');
        expect(page.status).toBe(200);
        expect(page.text).toContain('id="leagues-page"');
        expect(page.text).toContain('/leagues.js');
        expect(page.text).toContain(`window.LEAGUE_SEASONS = {"football":${FOOTBALL},"basketball":${HOOPS}}`);

        const json = await as(ADMIN).get('/leagues').set('Accept', 'application/json');
        expect(json.status).toBe(200);
        expect(json.body.map(l => l.code).sort()).toEqual(['claunts-league', 'graham-league']);
        // One URL, two types: both say so, or a cache could swap them.
        expect(page.headers.vary).toMatch(/Accept/);
        expect(json.headers.vary).toMatch(/Accept/);
    });

    test('rows: one per league, with sport, season, managers and status', async () => {
        const hoops = (await create({ sport: 'basketball', name: 'Hardwood Heroes' })).body.code;
        await as(ADMIN).post(`/leagues/admin/${hoops}/members`).send({ accountIds: [String(ann._id), String(bob._id)] });
        await League.create({ code: 'old', name: 'Old Days', sport: 'football', status: 'archived' });
        // Graham League is underway: someone holds a team this season.
        await Franchise.updateOne({ accountId: ann._id, league: 'graham-league' },
            { $set: { 'seasons.0.teams': [{ id: 1, school: 'Texas' }] } });
        // Claunts has started its draft but nobody holds a team yet.
        await Draft.create({ league: 'claunts-league', season: FOOTBALL, status: 'active' });

        const res = await as(ADMIN).get('/leagues/admin/rows');
        expect(res.status).toBe(200);
        const by = Object.fromEntries(res.body.map(r => [r.code, r]));
        expect(by['graham-league']).toMatchObject({ name: 'The Polar Depressed', sport: 'football', season: FOOTBALL, managers: 1, state: 'live' });
        expect(by['claunts-league']).toMatchObject({ state: 'live' });
        expect(by[hoops]).toMatchObject({ name: 'Hardwood Heroes', sport: 'basketball', season: HOOPS, managers: 2, state: 'setup' });
        expect(by.old).toMatchObject({ state: 'archived' });
    });

    test('rows: managers in and a draft saved reads ready', async () => {
        const hoops = (await create({ sport: 'basketball', name: 'Dunkaroos' })).body.code;
        await as(ADMIN).post(`/leagues/admin/${hoops}/members`).send({ accountIds: [String(ann._id), String(bob._id)] });
        await Draft.create({ league: hoops, season: HOOPS, status: 'scheduled' });

        const res = await as(ADMIN).get('/leagues/admin/rows');
        expect(res.body.find(r => r.code === hoops)).toMatchObject({ managers: 2, state: 'ready' });
    });

    test('rows: a failure is a 500', async () => {
        jest.spyOn(Franchise, 'countDocuments').mockRejectedValue(new Error('down'));
        expect((await as(ADMIN).get('/leagues/admin/rows')).status).toBe(500);
    });
});

describe('Manage', () => {
    test('a football league selects it and opens /admin', async () => {
        const res = await as(ADMIN).get('/leagues/admin/claunts-league/open');
        expect(res.status).toBe(302);
        expect(res.headers.location).toBe('/admin');
        expect(res.headers['set-cookie'].join(';')).toContain(`${selection.COOKIE}=claunts-league`);
    });

    test('a league this dyno has not primed yet is read from its document', async () => {
        // Made on "another dyno": the document exists, this cache has never
        // seen it, so the cache would call it football.
        await League.create({ code: 'fresh', name: 'Fresh', sport: 'basketball' });
        expect(seasons.sportForLeague('fresh')).toBe('football');
        const res = await as(ADMIN).get('/leagues/admin/fresh/open');
        expect(res.headers.location).toBe('/hoops/admin');
        expect(seasons.sportForLeague('fresh')).toBe('basketball');
    });

    test('an unknown or archived league is a 404', async () => {
        await League.create({ code: 'old', name: 'Old', sport: 'football', status: 'archived' });
        expect((await as(ADMIN).get('/leagues/admin/old/open')).status).toBe(404);
        expect((await as(ADMIN).get('/leagues/admin/nope/open')).status).toBe(404);
    });

    test('a failure is a 500', async () => {
        jest.spyOn(League, 'findOne').mockImplementationOnce(() => { throw new Error('down'); });
        expect((await as(ADMIN).get('/leagues/admin/claunts-league/open')).status).toBe(500);
    });
});

describe('pure helpers', () => {
    test('slugFor', () => {
        expect(leagueAdmin.slugFor('Hardwood Heroes')).toBe('hardwood-heroes');
        expect(leagueAdmin.slugFor('  Café — Crew!! ')).toBe('cafe-crew');
        expect(leagueAdmin.slugFor('🏀🏀')).toBe('league');
        expect(leagueAdmin.slugFor('x'.repeat(50))).toHaveLength(32);
    });

    test('codeFor skips taken and reserved codes', () => {
        expect(leagueAdmin.codeFor('Admin', new Set())).toBe('admin-2');
        expect(leagueAdmin.codeFor('Hoops', new Set(['hoops', 'hoops-2']))).toBe('hoops-3');
    });

    test('seasonOf: the league\'s own season wins, else its sport\'s', async () => {
        expect(leagueAdmin.seasonOf({ sport: 'basketball', season: 2031 })).toBe(2031);
        expect(leagueAdmin.seasonOf({ sport: 'basketball' })).toBe(HOOPS);
        expect(leagueAdmin.seasonOf(null)).toBe(FOOTBALL);
    });

    test('stateOf', () => {
        expect(leagueAdmin.stateOf({ status: 'archived', rostered: true })).toBe('archived');
        expect(leagueAdmin.stateOf({ rostered: true })).toBe('live');
        expect(leagueAdmin.stateOf({ draftStatus: 'complete' })).toBe('live');
        // A saved draft with too few managers is still setup…
        expect(leagueAdmin.stateOf({ draftStatus: 'scheduled' })).toBe('setup');
        expect(leagueAdmin.stateOf({ draftStatus: 'scheduled', managers: 1 })).toBe('setup');
        // …with 2+ it is Ready to draft; managers alone (no draft saved) are not.
        expect(leagueAdmin.stateOf({ draftStatus: 'scheduled', managers: 8 })).toBe('ready');
        expect(leagueAdmin.stateOf({ draftStatus: 'pending', managers: 2 })).toBe('ready'); // saved with no date
        expect(leagueAdmin.stateOf({ managers: 8 })).toBe('setup');
        expect(leagueAdmin.stateOf({ draftStatus: 'active', managers: 8 })).toBe('live');
        expect(leagueAdmin.stateOf({})).toBe('setup');
    });
});

// #600: a League Manager creates a league and runs it. Jeff's case — the
// commissioner of a football league starting a basketball one — end to end
// through the real routes, so each step proves the previous one's write is
// what the next one's permission check reads.
describe('a League Manager creates and runs their own league (#600)', () => {
    let jeff, cara;
    // Jeff: League Manager of Claunts, by the Auth0 flag; plays in Claunts.
    // Cara: plays in Claunts with him. Ann: Graham league only — not his.
    const JEFF = () => ({ roles: ['League Manager'], accountId: jeff._id, email: 'jeff@example.com', league: 'cl' });
    beforeEach(async () => {
        jeff = await person('Jeff', 'claunts-league');
        cara = await person('Cara', 'claunts-league');
    });
    const make = async () => {
        const res = await create({ sport: 'basketball', name: 'Claunts Hoops' }, JEFF());
        expect(res.status).toBe(201);
        return res.body.code;
    };

    test('an Admin who creates one is not put on its list: the role already runs it', async () => {
        const code = (await create({ sport: 'basketball', name: 'Hardwood Heroes' })).body.code;
        expect((await League.findOne({ code }).lean()).commissioners).toEqual([]);
    });

    test('creating one makes him its commissioner, and he joins it', async () => {
        const code = await make();
        const doc = await League.findOne({ code }).lean();
        expect(doc.commissioners.map(String)).toEqual([String(jeff._id)]);
        expect(await Franchise.exists({ accountId: jeff._id, league: code, 'seasons.season': HOOPS })).not.toBeNull();
        const row = await AuditLog.findOne({ action: 'league.create', league: code }).lean();
        expect(row.meta.commissioners).toEqual([String(jeff._id)]);
    });

    test('his list shows the leagues he runs: his own, and the new one — not Graham league', async () => {
        const code = await make();
        const rows = (await as(JEFF()).get('/leagues/admin/rows')).body;
        expect(rows.map(r => r.code).sort()).toEqual(['claunts-league', code].sort());
        // The Commissioners control is the Admin's, and so is the data for it.
        expect(rows.every(r => r.commissioners === undefined)).toBe(true);
    });

    test("step 2 offers only people he shares a league with, and refuses anyone else's id", async () => {
        const code = await make();
        const offered = (await as(JEFF()).get(`/leagues/admin/candidates?league=${code}`)).body;
        expect(offered.map(c => c.firstName)).toEqual(['Bob', 'Cara']);
        const out = (await as(JEFF()).post(`/leagues/admin/${code}/members`)
            .send({ accountIds: [String(cara._id), String(ann._id)] })).body;
        expect(out.added).toEqual([String(cara._id)]);
        expect(out.refused).toEqual([String(ann._id)]);
        expect(await Franchise.exists({ accountId: ann._id, league: code })).toBeNull();
    });

    test('the email lookup says someone outside his leagues HAS a login, never who', async () => {
        const code = await make();
        const res = await as(JEFF()).get(`/leagues/admin/account?email=ann@example.com&league=${code}`);
        expect(res.body).toEqual({ found: true, outside: true });
        expect(res.text).not.toContain('Ann');
        expect(res.text).not.toContain(String(ann._id));
        // Inside his leagues the lookup works as it does for an Admin.
        const known = (await as(JEFF()).get(`/leagues/admin/account?email=cara@example.com&league=${code}`)).body;
        expect(known).toMatchObject({ found: true, _id: String(cara._id), inLeague: false, joined: true });
    });

    // The point of the list: what he could not do before, he now can, for
    // this league only. POST /draft and POST /users are canManageLeague-gated,
    // so they read the cache the create re-primed.
    test('he can set up its draft and add someone new — and still not touch Graham league', async () => {
        const code = await make();
        await as(JEFF()).post(`/leagues/admin/${code}/members`).send({ accountIds: [String(cara._id)] });
        const draft = await as(JEFF()).post('/draft').send({
            league: code, season: HOOPS, draftOrder: [String(jeff._id), String(cara._id)],
            orderMethod: 'manual', snake: true, totalRounds: 10, poolSize: 120
        });
        expect(draft.status).toBeLessThan(300);
        expect(await Draft.exists({ league: code, season: HOOPS })).not.toBeNull();

        const added = await as(JEFF()).post('/users').send({
            firstName: 'Dee', lastName: 'Lee', email: 'dee@example.com', league: code, seasons: [{ season: HOOPS }]
        });
        expect(added.status).toBeLessThan(300);

        const elsewhere = await as(JEFF()).post('/users').send({
            firstName: 'Eve', lastName: 'Lee', email: 'eve@example.com', league: 'graham-league', seasons: [{ season: FOOTBALL }]
        });
        expect(elsewhere.status).toBe(403);
    });

    // The name check runs against every league; only an Admin is told the
    // name belongs to one.
    test("a taken name is refused without saying it is someone's league", async () => {
        await create({ sport: 'basketball', name: 'Hardwood Heroes' });
        const res = await create({ sport: 'basketball', name: 'Hardwood Heroes' }, JEFF());
        expect(res.status).toBe(409);
        expect(res.text).not.toContain('Hardwood');
        expect(res.text).not.toContain('already a league');
    });

    test('opening it lands on the basketball admin page', async () => {
        const code = await make();
        const res = await as(JEFF()).get(`/leagues/admin/${code}/open`);
        expect(res.status).toBe(302);
        expect(res.headers.location).toBe('/hoops/admin');
    });

    test('a League Manager with no linked account is refused rather than left with a league nobody runs', async () => {
        const res = await create({ sport: 'basketball', name: 'Orphan' }, { roles: ['League Manager'], email: 'x@example.com', league: 'cl' });
        expect(res.status).toBe(409);
        expect(await League.exists({ name: 'Orphan' })).toBeNull();
    });
});

describe('the Commissioners control (#600, Admin only)', () => {
    test('an Admin appoints a member; the change is live at once, and audited', async () => {
        const code = (await create({ sport: 'basketball', name: 'Hardwood Heroes' })).body.code;
        await as(ADMIN).post(`/leagues/admin/${code}/members`).send({ accountIds: [String(ann._id), String(bob._id)] });

        const before = (await as(ADMIN).get(`/leagues/admin/${code}/commissioners`)).body;
        expect(before.members.map(m => m.name)).toEqual(['Ann Lee', 'Bob Lee']);

        const BOB = { roles: [], accountId: bob._id, email: 'bob@example.com', league: 'cl' };
        const tryDraft = () => as(BOB).post('/draft').send({
            league: code, season: HOOPS, draftOrder: [String(ann._id), String(bob._id)],
            orderMethod: 'manual', snake: true, totalRounds: 10, poolSize: 120
        });
        expect((await tryDraft()).status).toBe(403);

        const put = await as(ADMIN).put(`/leagues/admin/${code}/commissioners`).send({ accountIds: [String(bob._id)] });
        expect(put.status).toBe(200);
        expect(put.body.commissioners).toEqual([{ _id: String(bob._id), name: 'Bob Lee' }]);
        // No re-prime by the test: the route's own is what makes it live.
        expect((await tryDraft()).status).toBeLessThan(300);

        const row = await AuditLog.findOne({ action: 'league.commissioners', league: code }).lean();
        expect(row.summary).toContain('Bob Lee');
        expect(row.meta.after).toEqual([String(bob._id)]);

        // Emptied: back to Admins only, and Bob loses it at once.
        await as(ADMIN).put(`/leagues/admin/${code}/commissioners`).send({ accountIds: [] });
        expect((await tryDraft()).status).toBe(403);
    });

    test('an unknown account is refused, not stored', async () => {
        const code = (await create({ sport: 'basketball', name: 'Hardwood Heroes' })).body.code;
        const res = await as(ADMIN).put(`/leagues/admin/${code}/commissioners`)
            .send({ accountIds: [String(new mongoose.Types.ObjectId())] });
        expect(res.status).toBe(400);
        expect((await League.findOne({ code }).lean()).commissioners).toEqual([]);
    });

    test('the Admin rows carry who runs each league', async () => {
        const code = (await create({ sport: 'basketball', name: 'Hardwood Heroes' })).body.code;
        await as(ADMIN).put(`/leagues/admin/${code}/commissioners`).send({ accountIds: [String(ann._id)] });
        const rows = (await as(ADMIN).get('/leagues/admin/rows')).body;
        expect(rows.find(r => r.code === code).commissioners).toEqual([{ _id: String(ann._id), name: 'Ann Lee' }]);
        expect(rows.find(r => r.code === 'graham-league').commissioners).toEqual([]);
    });
});
