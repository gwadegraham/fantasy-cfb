// Commissioner roster correction — the pure rules plus the two endpoints.
//
// A completed draft used to be final: the only write path bulk-overwrote all ten
// teams and had no UI, so a draft-night misclick was permanent. The correction
// rewrites BOTH the roster and the matching draft pick, since draft grades, the
// draft board and the Draft Steal highlight all read the pick.

process.env.YEAR = '2026';
process.env.INTERNAL_API_TOKEN = 'test-internal-token';

const {
    normalizeLocation, rosterTeamFrom, missingLocationFields,
    validateCorrection, replaceRosterTeam, replaceDraftPick
} = require('../modules/roster-correction');

// A complete location, as the user roster schema demands.
const LOC = { venue_id: 7, name: 'Autzen', city: 'Eugene', state: 'OR', zip: '97401', latitude: 44, longitude: -123, capacity: 54000, grass: true, dome: false };
const teamDoc = (o) => Object.assign({
    id: 2483, school: 'Oregon', mascot: 'Ducks', abbreviation: 'ORE',
    conference: 'Big Ten', color: '#154733', logos: ['a.png', 'b.png'], location: LOC
}, o);

describe('normalizeLocation', () => {
    // CFBD sends `id`; the user schema requires `venue_id`. draft-socket does the
    // same remap when persisting a draft, so a corrected team has to match.
    test('maps CFBD id -> venue_id and drops id', () => {
        const out = normalizeLocation({ id: 42, name: 'V' });
        expect(out).toEqual({ venue_id: 42, name: 'V' });
    });
    test('leaves an existing venue_id alone', () => {
        expect(normalizeLocation({ id: 42, venue_id: 7 })).toEqual({ venue_id: 7 });
    });
    test('does not mutate its input', () => {
        const src = { id: 42 };
        normalizeLocation(src);
        expect(src).toEqual({ id: 42 });
    });
    test('passes through a missing location', () => {
        expect(normalizeLocation(null)).toBeNull();
    });
});

describe('rosterTeamFrom', () => {
    test('copies the roster fields and normalizes the location', () => {
        const t = rosterTeamFrom(teamDoc({ location: { id: 7, name: 'Autzen' } }));
        expect(t).toMatchObject({ id: 2483, school: 'Oregon', mascot: 'Ducks', abbreviation: 'ORE', conference: 'Big Ten' });
        expect(t.location).toEqual({ venue_id: 7, name: 'Autzen' });
    });
    // Team docs carry per-season ratings and scores that have no business on a
    // roster entry.
    test('drops fields that are not part of a roster team', () => {
        const t = rosterTeamFrom(teamDoc({ seasons: [{ season: 2026, spRating: 18 }], _id: 'abc' }));
        expect(t.seasons).toBeUndefined();
        expect(t._id).toBeUndefined();
    });
});

describe('missingLocationFields', () => {
    test('a complete location is missing nothing', () => {
        expect(missingLocationFields(rosterTeamFrom(teamDoc()))).toEqual([]);
    });
    test('names each field the roster schema would reject', () => {
        const thin = rosterTeamFrom(teamDoc({ location: { venue_id: 1, name: 'V', city: 'C', state: 'S' } }));
        expect(missingLocationFields(thin)).toEqual(['zip', 'latitude', 'longitude', 'capacity']);
    });
    test('no location at all', () => {
        expect(missingLocationFields({})).toEqual(['location']);
    });
});

describe('validateCorrection', () => {
    const roster = [{ id: 1, school: 'Iowa' }, { id: 2, school: 'Duke' }];
    const base = { roster, fromTeamId: 1, toTeamId: 2483, targetTeam: teamDoc(), takenBy: null, seasonUnderway: false, isAdmin: false };
    const run = (o) => validateCorrection(Object.assign({}, base, o));

    test('a clean swap passes and reports the outgoing team', () => {
        const r = run();
        expect(r.ok).toBe(true);
        expect(r.current).toMatchObject({ id: 1, school: 'Iowa' });
    });
    test('missing ids are rejected', () => {
        expect(run({ fromTeamId: null })).toMatchObject({ ok: false, status: 400 });
        expect(run({ toTeamId: null })).toMatchObject({ ok: false, status: 400 });
    });
    test('swapping a team for itself is a no-op, not a write', () => {
        expect(run({ fromTeamId: 2483, toTeamId: 2483 })).toMatchObject({ ok: false, status: 400 });
    });
    test('the outgoing team must actually be on the roster', () => {
        expect(run({ fromTeamId: 999 })).toMatchObject({ ok: false, status: 404 });
    });
    test('an unknown replacement is rejected', () => {
        expect(run({ targetTeam: null })).toMatchObject({ ok: false, status: 404 });
    });
    // Two managers holding the same team would double-count it in scoring.
    test('a team already rostered in the league is a conflict', () => {
        const r = run({ takenBy: { name: 'Bob Smith' } });
        expect(r).toMatchObject({ ok: false, status: 409 });
        expect(r.message).toBe("Oregon is already on Bob Smith's roster.");
    });
    // The "taken by someone else" lookup excludes this manager, so their own
    // roster has to be checked here or the same team lands on it twice.
    test('a team the manager already holds is a conflict, not a duplicate', () => {
        const r = run({ toTeamId: 2, takenBy: null });
        expect(r).toMatchObject({ ok: false, status: 409 });
        expect(r.message).toBe('That manager already has Duke.');
    });
    // The user schema's location is stricter than the team schema's, so this
    // would otherwise surface as an opaque validation error on save.
    test('a team with a thin venue record is refused by name', () => {
        const r = run({ targetTeam: teamDoc({ location: { venue_id: 1, name: 'V', city: 'C', state: 'S' } }) });
        expect(r).toMatchObject({ ok: false, status: 422 });
        expect(r.message).toMatch(/Oregon is missing venue details \(zip, latitude/);
    });

    describe('the season-underway lock', () => {
        test('a League Manager is stopped once results exist', () => {
            expect(run({ seasonUnderway: true })).toMatchObject({ ok: false, status: 423 });
        });
        test('an Admin may still proceed — they can run the re-score', () => {
            expect(run({ seasonUnderway: true, isAdmin: true }).ok).toBe(true);
        });
        // The lock is checked before roster membership so a locked league gets
        // the lock message rather than leaking whether a team is rostered.
        test('the lock outranks the other failures', () => {
            expect(run({ seasonUnderway: true, fromTeamId: 999 })).toMatchObject({ status: 423 });
        });
    });
});

describe('replaceRosterTeam', () => {
    const roster = [{ id: 1, school: 'Iowa' }, { id: 2, school: 'Duke' }, { id: 3, school: 'Utah' }];
    test('swaps in place, preserving draft order', () => {
        const r = replaceRosterTeam(roster, 2, { id: 9, school: 'Oregon' });
        expect(r.changed).toBe(true);
        expect(r.teams.map(t => t.school)).toEqual(['Iowa', 'Oregon', 'Utah']);
    });
    test('reports no change when the team is not there', () => {
        expect(replaceRosterTeam(roster, 99, { id: 9 }).changed).toBe(false);
    });
    test('does not mutate the original roster', () => {
        replaceRosterTeam(roster, 2, { id: 9, school: 'Oregon' });
        expect(roster[1].school).toBe('Duke');
    });
});

describe('replaceDraftPick', () => {
    const picks = [
        { round: 1, overall: 1, userId: 'a', team: { id: 1, school: 'Iowa' }, pickedAt: new Date('2026-08-15') },
        { round: 1, overall: 2, userId: 'b', team: { id: 2, school: 'Duke' } },
        { round: 2, overall: 3, userId: 'a', team: { id: 3, school: 'Utah' } }
    ];
    test('replaces only that manager\'s pick of that team', () => {
        const r = replaceDraftPick(picks, 'a', 3, { id: 9, school: 'Oregon' });
        expect(r.changed).toBe(true);
        expect(r.picks.map(p => p.team.school)).toEqual(['Iowa', 'Duke', 'Oregon']);
    });
    // The slot was right; only the team in it was wrong.
    test('keeps round, overall and pickedAt, and stamps correctedAt', () => {
        const r = replaceDraftPick(picks, 'a', 1, { id: 9, school: 'Oregon' });
        expect(r.picks[0]).toMatchObject({ round: 1, overall: 1, userId: 'a' });
        expect(r.picks[0].pickedAt).toEqual(new Date('2026-08-15'));
        expect(r.picks[0].correctedAt).toBeInstanceOf(Date);
    });
    test('does not touch another manager who holds the same team id', () => {
        const shared = [{ userId: 'b', team: { id: 5, school: 'X' } }, { userId: 'a', team: { id: 5, school: 'X' } }];
        const r = replaceDraftPick(shared, 'a', 5, { id: 9, school: 'Oregon' });
        expect(r.picks[0].team.school).toBe('X');
        expect(r.picks[1].team.school).toBe('Oregon');
    });
    test('no matching pick is not a change', () => {
        expect(replaceDraftPick(picks, 'a', 2, { id: 9 }).changed).toBe(false);
        expect(replaceDraftPick([], 'a', 1, { id: 9 }).changed).toBe(false);
    });
});

// --- endpoints ---------------------------------------------------------------
// The whole point is that the roster and the draft record move together, so
// these run both writes against real documents.

const express = require('express');
const request = require('supertest');
const { useMongo } = require('./helpers/mongo');
const User = require('../models/user');
const Team = require('../models/team');
const Draft = require('../models/draft');
const usersRouter = require('../routes/users');

const app = express();
app.use(express.json());
app.use('/users', usersRouter);

// The internal token clears canManageLeague but is NOT an Admin session —
// effectiveRoles() reads Auth0 roles, so a token-only caller is treated as a
// plain commissioner. That matches the season-membership lock next door, and it
// means the Admin override needs a real session to exercise.
const adminApp = express();
adminApp.use(express.json());
adminApp.use((req, res, next) => {
    req.oidc = { isAuthenticated: () => true, user: { user_metadata: { roles: ['Admin'] } } };
    next();
});
adminApp.use('/users', usersRouter);

useMongo();

const LEAGUE = 'graham-league';
const SEASON = 2026;

function fullTeam(id, school, o) {
    return Object.assign({
        id, school, mascot: 'M', abbreviation: school.slice(0, 3).toUpperCase(),
        conference: 'Big Ten', color: '#000', logos: [`${school}.png`],
        location: { venue_id: id, name: 'V', city: 'C', state: 'ST', zip: '1', latitude: 1, longitude: 1, capacity: 100, grass: true, dome: false }
    }, o);
}
const manager = (first, teams, extra) => User.create(Object.assign({
    firstName: first, lastName: 'Test', league: LEAGUE,
    seasons: [{ season: SEASON, teams }]
}, extra || {}));

// The internal token clears canManageLeague and reads as a commissioner.
const patch = (id, body) => request(app)
    .patch(`/users/${id}/roster-team`)
    .set('X-Internal-Token', 'test-internal-token')
    .send(body);

beforeEach(() => { jest.spyOn(console, 'log').mockImplementation(() => {}); });
afterEach(() => { jest.restoreAllMocks(); });

describe('PATCH /users/:id/roster-team', () => {
    test('swaps the roster team and the matching draft pick together', async () => {
        await Team.create([fullTeam(1, 'Iowa'), fullTeam(2, 'Duke'), fullTeam(9, 'Oregon')]);
        const u = await manager('Ann', [fullTeam(1, 'Iowa'), fullTeam(2, 'Duke')]);
        await Draft.create({
            league: LEAGUE, season: SEASON, draftOrder: [u._id],
            picks: [
                { round: 1, overall: 1, userId: u._id, team: { id: 1, school: 'Iowa' } },
                { round: 2, overall: 2, userId: u._id, team: { id: 2, school: 'Duke' } }
            ]
        });

        const res = await patch(u._id, { fromTeamId: 2, toTeamId: 9 });
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ draftUpdated: true, rescoreNeeded: false });
        expect(res.body.from).toMatchObject({ id: 2, school: 'Duke' });
        expect(res.body.to).toMatchObject({ id: 9, school: 'Oregon' });

        const after = await User.findById(u._id).lean();
        expect(after.seasons[0].teams.map(t => t.school)).toEqual(['Iowa', 'Oregon']);
        const draft = await Draft.findOne({ league: LEAGUE, season: SEASON }).lean();
        expect(draft.picks.map(p => p.team.school)).toEqual(['Iowa', 'Oregon']);
        expect(draft.picks[1]).toMatchObject({ round: 2, overall: 2 });
        expect(draft.picks[1].correctedAt).toBeInstanceOf(Date);
    });

    test('refuses a team another manager in the league already holds', async () => {
        await Team.create([fullTeam(1, 'Iowa'), fullTeam(2, 'Duke')]);
        const ann = await manager('Ann', [fullTeam(1, 'Iowa')]);
        await manager('Bob', [fullTeam(2, 'Duke')]);

        const res = await patch(ann._id, { fromTeamId: 1, toTeamId: 2 });
        expect(res.status).toBe(409);
        expect(res.body.message).toBe("Duke is already on Bob Test's roster.");
        const after = await User.findById(ann._id).lean();
        expect(after.seasons[0].teams[0].school).toBe('Iowa');   // untouched
    });

    test('a team the manager already holds themselves is rejected, not duplicated', async () => {
        await Team.create([fullTeam(1, 'Iowa'), fullTeam(2, 'Duke')]);
        const u = await manager('Ann', [fullTeam(1, 'Iowa'), fullTeam(2, 'Duke')]);
        const res = await patch(u._id, { fromTeamId: 1, toTeamId: 2 });
        expect(res.status).toBe(409);
    });

    test('succeeds without a draft doc — nothing to correct there', async () => {
        await Team.create([fullTeam(1, 'Iowa'), fullTeam(9, 'Oregon')]);
        const u = await manager('Ann', [fullTeam(1, 'Iowa')]);
        const res = await patch(u._id, { fromTeamId: 1, toTeamId: 9 });
        expect(res.status).toBe(200);
        expect(res.body.draftUpdated).toBe(false);
        expect((await User.findById(u._id).lean()).seasons[0].teams[0].school).toBe('Oregon');
    });

    test('leaves other managers\' picks alone', async () => {
        await Team.create([fullTeam(1, 'Iowa'), fullTeam(9, 'Oregon')]);
        const ann = await manager('Ann', [fullTeam(1, 'Iowa')]);
        const bob = await manager('Bob', [fullTeam(9, 'Oregon')]);
        await Draft.create({
            league: LEAGUE, season: SEASON, draftOrder: [ann._id, bob._id],
            picks: [
                { round: 1, overall: 1, userId: ann._id, team: { id: 1, school: 'Iowa' } },
                { round: 1, overall: 2, userId: bob._id, team: { id: 9, school: 'Oregon' } }
            ]
        });
        // Free Oregon up first, then hand it to Ann.
        await Team.create([fullTeam(3, 'Utah')]);
        await patch(bob._id, { fromTeamId: 9, toTeamId: 3 });
        const res = await patch(ann._id, { fromTeamId: 1, toTeamId: 9 });
        expect(res.status).toBe(200);

        const draft = await Draft.findOne({ league: LEAGUE, season: SEASON }).lean();
        const byUser = (id) => draft.picks.filter(p => String(p.userId) === String(id)).map(p => p.team.school);
        expect(byUser(ann._id)).toEqual(['Oregon']);
        expect(byUser(bob._id)).toEqual(['Utah']);
    });

    test('a season the manager does not have is a 404', async () => {
        await Team.create([fullTeam(9, 'Oregon')]);
        const u = await manager('Ann', [fullTeam(1, 'Iowa')]);
        const res = await patch(u._id, { season: 2099, fromTeamId: 1, toTeamId: 9 });
        expect(res.status).toBe(404);
    });

    describe('once the season is underway', () => {
        // hasScoredGames keys off a scoreByTeam entry, so seed one.
        async function scored() {
            await Team.create([fullTeam(1, 'Iowa'), fullTeam(9, 'Oregon')]);
            return manager('Ann', [fullTeam(1, 'Iowa')], {
                seasons: [{ season: SEASON, teams: [fullTeam(1, 'Iowa')],
                    weeklyScore: [{ week: 1, score: 5, scoreByTeam: [{ team: 'Iowa', teamId: 1, gameId: 100, score: 5 }] }] }]
            });
        }

        test('a commissioner without Admin is locked out', async () => {
            const u = await scored();
            const res = await request(app).patch(`/users/${u._id}/roster-team`)
                .send({ fromTeamId: 1, toTeamId: 9 });
            expect([403, 423]).toContain(res.status);
            expect((await User.findById(u._id).lean()).seasons[0].teams[0].school).toBe('Iowa');
        });

        test('an Admin may proceed and is told a re-score is needed', async () => {
            const u = await scored();
            const res = await request(adminApp).patch(`/users/${u._id}/roster-team`)
                .set('X-Internal-Token', 'test-internal-token')
                .send({ fromTeamId: 1, toTeamId: 9 });
            expect(res.status).toBe(200);
            // Every scored week was computed against the old roster.
            expect(res.body.rescoreNeeded).toBe(true);
            expect((await User.findById(u._id).lean()).seasons[0].teams[0].school).toBe('Oregon');
        });
    });
});

describe('GET /users/league/:league/roster-teams', () => {
    test('returns each manager\'s teams and the undrafted pool', async () => {
        await Team.create([fullTeam(1, 'Iowa'), fullTeam(2, 'Duke'), fullTeam(9, 'Oregon'), fullTeam(3, 'Utah')]);
        await manager('Ann', [fullTeam(1, 'Iowa')]);
        await manager('Bob', [fullTeam(2, 'Duke')]);

        const res = await request(app).get(`/users/league/${LEAGUE}/roster-teams?season=${SEASON}`)
            .set('X-Internal-Token', 'test-internal-token');
        expect(res.status).toBe(200);
        expect(res.body.managers.map(m => m.name)).toEqual(['Ann Test', 'Bob Test']);
        expect(res.body.managers[0].teams[0]).toMatchObject({ id: 1, school: 'Iowa', logo: 'Iowa.png' });
        // Drafted teams are excluded from the replacement pool.
        expect(res.body.available.map(t => t.school)).toEqual(['Oregon', 'Utah']);
        expect(res.body.seasonUnderway).toBe(false);
        expect(res.body.locked).toBe(false);
    });

    test('reports the lock once the season is underway', async () => {
        await Team.create([fullTeam(1, 'Iowa')]);
        await manager('Ann', [fullTeam(1, 'Iowa')], {
            seasons: [{ season: SEASON, teams: [fullTeam(1, 'Iowa')],
                weeklyScore: [{ week: 1, score: 5, scoreByTeam: [{ team: 'Iowa', teamId: 1, gameId: 1, score: 5 }] }] }]
        });
        // No token and no session -> not an Admin, so the lock applies.
        const res = await request(app).get(`/users/league/${LEAGUE}/roster-teams?season=${SEASON}`);
        expect(res.body).toMatchObject({ seasonUnderway: true, locked: true });
    });

    test('a league with nobody in the season still returns the full pool', async () => {
        await Team.create([fullTeam(1, 'Iowa')]);
        const res = await request(app).get(`/users/league/${LEAGUE}/roster-teams?season=${SEASON}`);
        expect(res.body.managers).toEqual([]);
        expect(res.body.available).toHaveLength(1);
    });
});
