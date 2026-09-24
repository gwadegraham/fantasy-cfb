// The three reads that are NOT plain finds must answer identically with
// FRANCHISE_READS off and on (#313 phase 2).
//
// tests/RoutesUsersFranchiseSwap.spec.js holds this property for the /users
// endpoints, which the repo answers by assembling a document from two finds.
// These three are different in kind: two run a $lookup, and the third feeds a
// WRITE. A $lookup can differ from an assembly in ways a find-based comparison
// never reaches — a franchise whose account is missing survives it, and
// $mergeObjects can let a stray account key win — so they get their own file
// rather than a row in that one.
//
// The H2H case is the one worth the length. Its read is not rendered; it is
// edited and written back. So asserting the response matched would prove
// nothing: what has to match is the weeklyScore left in the database.

process.env.YEAR = '2026';

const mongoose = require('mongoose');
const express = require('express');
const request = require('supertest');
const { useMongo, clear } = require('./helpers/mongo');
const User = require('../models/user');
const Game = require('../models/game');
const Team = require('../models/team');
const Ranking = require('../models/ranking');
const ScoringConfig = require('../models/scoringConfig');
const SportSeason = require('../models/sportSeason');
const activeSeason = require('../modules/active-season');
const migration = require('../modules/account-migration');
const standingsRouter = require('../routes/standings');
const gamesRouter = require('../routes/games');
const scoresRouter = require('../routes/scores');

const app = express();
app.use(express.json());
app.use('/standings', standingsRouter);
app.use('/games', gamesRouter);
app.use('/scores', scoresRouter);

useMongo();

const SEASON = 2026;
const LEAGUE = 'graham-league';
const MINE = 1, YOURS = 2;

// FIXED ids, so the two runs of the H2H pass below seed identical documents.
//
// Not just tidiness. applyH2HBonuses stores h2hOpponentId — the OTHER manager's
// _id — on each weekly entry, so that field is a live assertion that the read
// returned account ids rather than franchise ids. With generated ids the two
// runs would differ for a reason that has nothing to do with the flag, and the
// only way to get the comparison passing would be to stop comparing the field.
const GARRETT = new mongoose.Types.ObjectId('000000000000000000000001');
const BROCK = new mongoose.Types.ObjectId('000000000000000000000002');

const ORIGINAL = process.env.FRANCHISE_READS;

beforeEach(async () => {
    delete process.env.FRANCHISE_READS;
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
    activeSeason._reset();
    await SportSeason.create({ sport: 'football', season: SEASON, status: 'in-season' });
    await activeSeason.prime();
});

afterEach(() => {
    jest.restoreAllMocks();
    if (ORIGINAL === undefined) delete process.env.FRANCHISE_READS;
    else process.env.FRANCHISE_READS = ORIGINAL;
});

function fullTeam(id, school, extra) {
    return Object.assign({
        id, school, mascot: 'Mascot', abbreviation: school.slice(0, 3).toUpperCase(),
        conference: 'Big Ten', classification: 'fbs', color: '#000',
        logos: [`http://x/${id}.png`],
        location: { venue_id: id, name: 'Stadium', city: 'City', state: 'ST', zip: '00000',
                    latitude: 1, longitude: 1, capacity: 100, grass: true, dome: false }
    }, extra);
}

const HOUR = 3600 * 1000, DAY = 24 * HOUR;
const at = (ms) => new Date(Date.now() + ms).toISOString();

// Two managers, because the H2H pass pairs them — one manager awards nothing at
// all, so a single-manager fixture would pass whatever the read returned.
async function seed() {
    await Team.insertMany([
        Object.assign(fullTeam(MINE, 'Mine U'), { seasons: [{ season: SEASON, conference: 'Big Ten', spRating: 10, expectedWins: 8 }] }),
        Object.assign(fullTeam(YOURS, 'Yours U'), { seasons: [{ season: SEASON, conference: 'Big Ten', spRating: 0, expectedWins: 6 }] })
    ]);

    await Game.insertMany([
        // Week 1 is settled for both rosters, so the H2H pass can award.
        { id: 401, season: SEASON, seasonType: 'regular', week: 1, startDate: at(-7 * DAY),
          startTimeTbd: false, neutralSite: false, conferenceGame: true, completed: true,
          homeId: MINE, homeTeam: 'Mine U', homeConference: 'Big Ten', homePoints: 31,
          awayId: YOURS, awayTeam: 'Yours U', awayConference: 'Big Ten', awayPoints: 17,
          pregameWinProb: 0.62 },
        // Ahead, so the projection engine has a remaining schedule to work on.
        { id: 402, season: SEASON, seasonType: 'regular', week: 2, startDate: at(3 * DAY),
          startTimeTbd: false, neutralSite: false, conferenceGame: true, completed: false,
          homeId: YOURS, homeTeam: 'Yours U', homeConference: 'Big Ten',
          awayId: MINE, awayTeam: 'Mine U', awayConference: 'Big Ten',
          pregameWinProb: 0.44 }
    ]);

    await Ranking.create({
        season: SEASON, seasonType: 'regular', week: 1,
        polls: [{ poll: 'AP Top 25', ranks: [{ rank: 3, school: 'Mine U' }] }]
    });

    await ScoringConfig.create({
        league: LEAGUE, model: 'graham', values: {},
        engagementBySeason: { [String(SEASON)]: { h2hEnabled: true, h2hWinBonus: 5, h2hTieBonus: 2 } }
    });

    await User.create([
        { _id: GARRETT,
          firstName: 'Garrett', lastName: 'Graham', email: 'g@example.com', league: LEAGUE,
          color: '#ed5858', avatarUrl: 'https://example.com/a.jpg', authSub: 'auth0|1',
          seasons: [
              { season: 2025, cumulativeScore: 163, franchiseName: 'Last Year' },
              { season: SEASON, cumulativeScore: 18, franchiseName: 'Gridiron Gang',
                teams: [fullTeam(MINE, 'Mine U')],
                weeklyScore: [{ week: 1, score: 18, season: 'regular',
                                scoreByTeam: [{ team: 'Mine U', teamId: MINE, gameId: 401, score: 18 }] }] }
          ] },
        { _id: BROCK,
          firstName: 'Brock', lastName: 'McCord', email: 'b@example.com', league: LEAGUE,
          color: '#71d28d',
          seasons: [
              { season: SEASON, cumulativeScore: 6, franchiseName: 'Second Best',
                teams: [fullTeam(YOURS, 'Yours U')],
                weeklyScore: [{ week: 1, score: 6, season: 'regular',
                                scoreByTeam: [{ team: 'Yours U', teamId: YOURS, gameId: 401, score: 6 }] }] }
          ] }
    ]);

    await migration.migrate({ apply: true });
}

// Subdocument ids differ between the two copies and are referenced nowhere.
const strip = (v) => JSON.parse(JSON.stringify(v, (k, val) => (k === '_id' || k === '__v' ? undefined : val)));

// The same, minus the Monte-Carlo field. See the note at its one use.
const stripOdds = (v) => JSON.parse(JSON.stringify(v, (k, val) =>
    (k === '_id' || k === '__v' || k === 'titleOdds' ? undefined : val)));

async function bothWays(path) {
    await seed();
    process.env.FRANCHISE_READS = 'false';
    const off = await request(app).get(path);
    process.env.FRANCHISE_READS = 'true';
    const on = await request(app).get(path);
    return { off, on };
}

describe('GET /standings/projections — the projectionManagers pipeline', () => {
    test('the response is identical with the flag off and on', async () => {
        const { off, on } = await bothWays(`/standings/projections/${LEAGUE}/${SEASON}`);
        expect(off.status).toBe(200);
        expect(on.status).toBe(200);
        // titleOdds excluded, and ONLY titleOdds: it is a 20,000-run Monte Carlo
        // off Math.random, so the two calls disagree by a point or so whatever
        // the read returned. Measured, not assumed — this comparison failed
        // three times in five runs on identical data, which is a flake that
        // someone would eventually "fix" by deleting the assertion. Its inputs
        // (banked, projectedFinal, perGame, byWeek) are all still compared, so a
        // read regression still has to get past this.
        expect(stripOdds(on.body)).toEqual(stripOdds(off.body));
        // But it must still be THERE, and be a real number, on both sides.
        for (const body of [off.body, on.body]) {
            body.managers.forEach(m => {
                expect(typeof m.titleOdds).toBe('number');
                expect(m.titleOdds).toBeGreaterThanOrEqual(0);
            });
        }
        // Neither side trivially empty: the comparison above is satisfied by two
        // blank pages, which is exactly the failure it is meant to catch.
        expect(on.body.managers).toHaveLength(2);
        expect(on.body.managers[0].projectedFinal).toBeGreaterThan(0);
    });

    test('the franchise name and avatar survive the join', async () => {
        // These come from OPPOSITE documents now — franchiseName off the season
        // on the Franchise, avatarUrl off the Account — so a join that dropped
        // either would still render a manager row and lose the identity on it.
        const { on } = await bothWays(`/standings/projections/${LEAGUE}/${SEASON}`);
        const mine = on.body.managers.find(m => m.franchise === 'Gridiron Gang');
        expect(mine).toBeDefined();
        expect(mine.avatarUrl).toBe('https://example.com/a.jpg');
        expect(mine.name).toBe('Garrett G.');
        expect(mine.color).toBe('#ed5858');
        // userId is what the page links and keys on, and the client holds
        // account ids. A franchise id here would render a row that goes nowhere.
        expect(mine.userId).toBe(String(GARRETT));
    });
});

describe('GET /games/scoreboard — the owners read', () => {
    test('the response is identical with the flag off and on', async () => {
        const { off, on } = await bothWays(`/games/scoreboard/${LEAGUE}/${SEASON}/1`);
        expect(off.status).toBe(200);
        expect(on.status).toBe(200);
        expect(strip(on.body)).toEqual(strip(off.body));
        expect(on.body.games.length).toBeGreaterThan(0);
    });

    test('both rostered teams still resolve to an owner', async () => {
        // What this actually guards: that the join still produces a manager the
        // scoreboard can attribute a team to. It does NOT guard the season
        // narrowing, despite that being the obvious worry — modules/league-
        // scoreboard.js resolves the entry by value rather than by position, so
        // this surface survives a lost $elemMatch. The narrowing is covered in
        // tests/FranchiseRepo.spec.js, on the shared projection where it lives.
        const { on } = await bothWays(`/games/scoreboard/${LEAGUE}/${SEASON}/1`);
        const game = on.body.games.find(g => g.id === 401);
        expect(game.home.owner).toBeTruthy();
        expect(game.away.owner).toBeTruthy();
    });
});

describe('POST /scores/h2h-bonus — a read that feeds a write', () => {
    // Run the pass under one flag position, then throw the database away and do
    // it again under the other. Comparing the STORED result, not the response:
    // the response is a summary, and a read that returned the wrong managers
    // would still report a tidy count while awarding the bonus to nobody.
    async function storedAfterPass(flag) {
        await clear();
        activeSeason._reset();
        await SportSeason.create({ sport: 'football', season: SEASON, status: 'in-season' });
        await activeSeason.prime();
        await seed();

        process.env.FRANCHISE_READS = flag;
        const res = await request(app).post('/scores/h2h-bonus').send({ season: SEASON });
        expect(res.status).toBe(200);

        const users = await User.find({ league: LEAGUE }, { firstName: 1, 'seasons.season': 1, 'seasons.weeklyScore': 1 }).lean();
        return strip(users)
            .map(u => ({ firstName: u.firstName, seasons: u.seasons }))
            .sort((a, b) => a.firstName.localeCompare(b.firstName));
    }

    test('the stored weekly scores are identical with the flag off and on', async () => {
        const off = await storedAfterPass('false');
        const on = await storedAfterPass('true');
        expect(on).toEqual(off);
    });

    test('and the bonus was actually awarded — otherwise the above compares two no-ops', async () => {
        const stored = await storedAfterPass('true');
        const garrett = stored.find(u => u.firstName === 'Garrett');
        const brock = stored.find(u => u.firstName === 'Brock');
        const week1 = (u) => u.seasons.find(s => s.season === SEASON).weeklyScore.find(w => w.week === 1);
        // Garrett outscored Brock 18-6 in week 1, so he takes the 5-point win
        // bonus and Brock takes none.
        expect(week1(garrett)).toMatchObject({ h2hBonus: 5, h2hResult: 'W', score: 23 });
        expect(week1(brock).h2hBonus).toBeFalsy();
        expect(week1(brock).h2hResult).toBe('L');

        // The opponent pointer is the OTHER manager's ACCOUNT id. This is the
        // field that would catch h2hManagers returning franchise ids: the pass
        // would still award, still report a tidy count, and still store a
        // plausible-looking ObjectId that points at nothing.
        expect(String(week1(garrett).h2hOpponentId)).toBe(String(BROCK));
        expect(String(week1(brock).h2hOpponentId)).toBe(String(GARRETT));
    });

    test('scoreByTeam survives the pass — the read must not trim what the write puts back', async () => {
        // applyH2HBonuses copies each weeklyScore entry and edits four fields,
        // then $sets the whole array. A read that trimmed the entry would delete
        // everything else on it. This is why h2hManagers keeps weeklyScore whole.
        const stored = await storedAfterPass('true');
        const garrett = stored.find(u => u.firstName === 'Garrett');
        const week1 = garrett.seasons.find(s => s.season === SEASON).weeklyScore.find(w => w.week === 1);
        expect(week1.scoreByTeam).toEqual([{ team: 'Mine U', teamId: MINE, gameId: 401, score: 18 }]);
    });
});
