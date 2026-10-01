// Schema-level tests for the Mongoose models: required fields, enums, defaults,
// and type coercion. These run against an in-memory Mongo so validators and
// defaults behave exactly as they do in production.

const mongoose = require('mongoose');
const { useMongo } = require('./helpers/mongo');
const JobRun = require('../models/jobRun');
const User = require('../models/user');
const Game = require('../models/game');
const CfpBracket = require('../models/cfpBracket');

useMongo();

describe('JobRun schema', () => {
    test('jobName is required', () => {
        const err = new JobRun({}).validateSync();
        expect(err.errors.jobName).toBeDefined();
    });

    test('status is constrained to the running/success/error enum', () => {
        const err = new JobRun({ jobName: 'scoring', status: 'bogus' }).validateSync();
        expect(err.errors.status).toBeDefined();
    });

    test('status defaults to "running" and startedAt to now on save', async () => {
        const before = Date.now();
        const run = await JobRun.create({ jobName: 'scoring' });
        expect(run.status).toBe('running');
        expect(run.startedAt).toBeInstanceOf(Date);
        expect(run.startedAt.getTime()).toBeGreaterThanOrEqual(before - 1000);
    });

    test('season is stored as a String (coerced) while week stays a Number', async () => {
        const run = await JobRun.create({ jobName: 'scoring', season: 2025, week: 3 });
        expect(run.season).toBe('2025');
        expect(typeof run.season).toBe('string');
        expect(run.week).toBe(3);
        expect(typeof run.week).toBe('number');
    });

    test('a valid terminal run persists all fields', async () => {
        const run = await JobRun.create({
            jobName: 'scoring', status: 'success', finishedAt: new Date(),
            message: 'ok', season: '2025', week: 3, seasonType: 'regular'
        });
        const found = await JobRun.findById(run._id).lean();
        expect(found.status).toBe('success');
        expect(found.message).toBe('ok');
        expect(found.finishedAt).toBeInstanceOf(Date);
    });
});

describe('User schema', () => {
    test('firstName and lastName are required', () => {
        const err = new User({}).validateSync();
        expect(err.errors.firstName).toBeDefined();
        expect(err.errors.lastName).toBeDefined();
    });

    test('isUpdated and profilePrompted default to false on save', async () => {
        const u = await User.create({ firstName: 'Ann', lastName: 'Adams' });
        expect(u.isUpdated).toBe(false);
        expect(u.profilePrompted).toBe(false);
    });

    test('a nested weeklyScore requires both week and score', () => {
        const err = new User({
            firstName: 'Ann', lastName: 'Adams',
            seasons: [{ season: 2025, weeklyScore: [{ score: 5 }] }]   // week missing
        }).validateSync();
        expect(err).toBeDefined();
        const paths = Object.keys(err.errors);
        expect(paths.some(p => p.endsWith('week'))).toBe(true);
    });

    test('a well-formed season subdocument round-trips through the DB', async () => {
        const u = await User.create({
            firstName: 'Ann', lastName: 'Adams', league: 'graham-league',
            seasons: [{
                season: 2025, franchiseName: 'Anvils', cumulativeScore: 42,
                weeklyScore: [{ week: 1, score: 20, scoreByTeam: [{ team: 'Oregon', teamId: 1, gameId: 100, score: 20 }] }]
            }]
        });
        const found = await User.findById(u._id).lean();
        expect(found.seasons[0].franchiseName).toBe('Anvils');
        expect(found.seasons[0].weeklyScore[0].score).toBe(20);
        expect(found.seasons[0].weeklyScore[0].scoreByTeam[0].team).toBe('Oregon');
    });

    // The scoring job rewrites the WHOLE weeklyScore array each run (see
    // modules/scoring.js updateUser -> PATCH /users/:id). Any bonus field the
    // schema doesn't declare gets silently stripped on that write, so an earlier
    // week's banked H2H bonus would vanish the next time a later week is scored.
    test('H2H bonus fields survive a full weeklyScore rewrite', async () => {
        const u = await User.create({
            firstName: 'Ann', lastName: 'Adams', league: 'graham-league',
            seasons: [{ season: 2026, weeklyScore: [{ week: 1, score: 23, h2hBonus: 3, h2hResult: 'W', h2hOpponentId: 'abc123' }] }]
        });
        // Rewrite the array the way the job does — week 1 untouched, week 2 added.
        const doc = await User.findById(u._id);
        doc.seasons[0].weeklyScore = [
            doc.seasons[0].weeklyScore[0].toObject(),
            { week: 2, score: 11 }
        ];
        doc.markModified('seasons');
        await doc.save();

        const found = await User.findById(u._id).lean();
        expect(found.seasons[0].weeklyScore[0]).toMatchObject({ score: 23, h2hBonus: 3, h2hResult: 'W', h2hOpponentId: 'abc123' });
        expect(found.seasons[0].weeklyScore[1].h2hBonus).toBeUndefined();
    });

    test('h2hResult is constrained to the W/L/T enum', () => {
        const err = new User({
            firstName: 'Ann', lastName: 'Adams',
            seasons: [{ season: 2026, weeklyScore: [{ week: 1, score: 5, h2hResult: 'X' }] }]
        }).validateSync();
        expect(err.errors['seasons.0.weeklyScore.0.h2hResult']).toBeDefined();
    });
});

describe('a rostered team, across two sports (#320)', () => {
    // A roster entry is a full copy of the team document, and that copy has to
    // satisfy one schema for both sports. Requiring `location` meant it could
    // not: a basketball draft ran to completion and persisted ZERO rosters,
    // because every PATCH 400d on a field no hoopsTeam has.
    const LOC = { venue_id: 7, name: 'Bryant-Denny', city: 'Tuscaloosa', state: 'AL',
                  zip: '35487', latitude: 33.2, longitude: -87.5,
                  capacity: 100077, grass: true, dome: false };
    const base = (over = {}) => Object.assign({
        id: 333, school: 'Alabama', mascot: 'Crimson Tide', abbreviation: 'ALA',
        conference: 'SEC', color: '#9E1B32', logos: ['a.png']
    }, over);
    const roster = (team) => new User({
        firstName: 'Ann', lastName: 'Test', league: 'graham-league',
        seasons: [{ season: 2026, teams: [team] }]
    });

    test('a football team with its venue still validates', async () => {
        await expect(roster(base({ location: LOC })).validate()).resolves.toBeUndefined();
    });

    test('a basketball team with NO venue validates — this is the fix', async () => {
        // hoopsTeam carries currentVenue/currentCity/currentState and nothing
        // resembling lat/long, capacity, grass or dome.
        await expect(roster(base({
            id: 2, school: 'Gonzaga', mascot: 'Bulldogs', abbreviation: 'GON',
            conference: 'Pac-12', color: '#002967', logos: ['b.png']
        })).validate()).resolves.toBeUndefined();
    });

    // OPTIONAL IS NOT LOOSENED, and the difference matters.
    //
    // A half-filled location is a football shape asserted about a basketball
    // arena. Absent says "this sport has no stadium record"; partial says
    // "it has one, and these numbers are it" — which is a lie that something
    // downstream eventually reads.
    test('a PARTIAL venue is still refused', async () => {
        await expect(roster(base({
            location: { name: 'The Kennel', city: 'Spokane', state: 'WA' }
        })).validate()).rejects.toThrow(/location/);
    });

    test('the fields BOTH sports have are still required', async () => {
        for (const missing of ['id', 'school', 'mascot', 'abbreviation', 'conference', 'color']) {
            const team = base({ location: LOC });
            delete team[missing];
            await expect(roster(team).validate()).rejects.toThrow(new RegExp(missing));
        }
    });

    // `logos: { type: [String], required: true }` does NOT require a logo.
    //
    // Mongoose defaults a missing array to [], and `required` is satisfied by
    // an empty one — so the declaration reads as a guarantee and is not.
    // Recorded rather than fixed: tightening it would reject a team that
    // genuinely has no logo, which 101 of the 365 basketball programs were
    // until the ingest moved to the ESPN CDN. Pinned so the next person
    // reading the schema does not trust it the way I did.
    test('logos is declared required and is not enforced', async () => {
        const team = base({ location: LOC });
        delete team.logos;
        await expect(roster(team).validate()).resolves.toBeUndefined();
    });
});

describe('Game schema', () => {
    test('core identity/scheduling fields are required', () => {
        const err = new Game({}).validateSync();
        ['id', 'season', 'week', 'seasonType', 'homeId', 'homeTeam', 'awayId', 'awayTeam']
            .forEach(field => expect(err.errors[field]).toBeDefined());
    });

    test('season is a Number here (contrast with JobRun.season String)', async () => {
        const g = await Game.create({
            id: 401, season: 2025, week: 1, seasonType: 'regular',
            startDate: '2025-08-30', startTimeTbd: false, neutralSite: false, conferenceGame: false,
            homeId: 1, homeTeam: 'Oregon', awayId: 2, awayTeam: 'Duke'
        });
        expect(typeof g.season).toBe('number');
        expect(g.season).toBe(2025);
    });

    // A duplicate id is not cosmetic: the per-team week lookup returns every
    // match and modules/scoring.js adds a team's points once per returned game,
    // so a second doc with the same id doubles that team's score for the week.
    test('CFBD game id is unique — a duplicate cannot be written', async () => {
        const doc = () => ({
            id: 401, season: 2025, week: 1, seasonType: 'regular',
            startDate: '2025-08-30', startTimeTbd: false, neutralSite: false, conferenceGame: false,
            homeId: 1, homeTeam: 'Oregon', awayId: 2, awayTeam: 'Duke'
        });
        await Game.init();          // ensure the index is built before asserting on it
        await Game.create(doc());
        await expect(Game.create(doc())).rejects.toThrow(/duplicate key/i);
        expect(await Game.countDocuments({ id: 401 })).toBe(1);
    });
});

describe('CfpBracket schema', () => {
    test('season is required, and each bracket game needs its join key + round', () => {
        expect(new CfpBracket({}).validateSync().errors.season).toBeDefined();
        const err = new CfpBracket({ season: 2025, games: [{}] }).validateSync();
        expect(err.errors['games.0.gameId']).toBeDefined();
        expect(err.errors['games.0.round']).toBeDefined();
    });

    test('one bracket per season', async () => {
        await CfpBracket.create({ season: 2025 });
        await CfpBracket.init();          // ensure the unique index is built
        await expect(CfpBracket.create({ season: 2025 })).rejects.toThrow(/duplicate key/);
    });
});

describe('harness sanity', () => {
    test('collections are cleared between tests', async () => {
        expect(await JobRun.countDocuments()).toBe(0);
        expect(mongoose.connection.readyState).toBe(1);  // connected
    });
});
