// End-to-end cover for the H2H win bonus reaching the season total of record.
//
// The bonus used to be computed only at read time inside GET /standings/h2h, so
// cumulativeScore — the number the Hall of Fame crowns a champion by, My Team
// ranks by, and the projections bank from — silently excluded it. POST
// /scores/h2h-bonus folds it into the stored weekly scores instead, exactly the
// way the Captain bonus already rode along, so summing weeklyScore[].score picks
// it up for free.
//
// Runs against an in-memory Mongo with the real models and the real route.

process.env.YEAR = '2026';

const express = require('express');
const request = require('supertest');
const { useMongo } = require('./helpers/mongo');
const User = require('../models/user');
const Game = require('../models/game');
const ScoringConfig = require('../models/scoringConfig');
const scoresRouter = require('../routes/scores');
const standingsRouter = require('../routes/standings');
const { pinnedH2HIds } = require('../modules/h2h');

const app = express();
app.use(express.json());
app.use('/scores', scoresRouter);
app.use('/standings', standingsRouter);

useMongo();

const SEASON = 2026;
const LEAGUE = 'graham-league';

// Two rostered teams per manager so a week only settles once BOTH play out.
function team(id, school) {
    return {
        id, school, mascot: 'Mascot', abbreviation: school.slice(0, 3).toUpperCase(),
        conference: 'SEC', color: '#000', logos: ['http://x/logo.png'],
        location: { venue_id: id, name: 'Stadium', city: 'City', state: 'ST', zip: '00000', latitude: 1, longitude: 1, capacity: 100, grass: true, dome: false }
    };
}

// A manager with one weekly entry per (week, score) pair given.
async function manager(firstName, teams, weeks) {
    return User.create({
        firstName, lastName: 'Test', league: LEAGUE,
        seasons: [{
            season: SEASON,
            teams,
            weeklyScore: weeks.map(([week, score]) => ({ week, score })),
            cumulativeScore: weeks.reduce((s, [, score]) => s + score, 0)
        }]
    });
}

function game(id, week, homeId, awayId, completed) {
    return {
        id, season: SEASON, week, seasonType: 'regular',
        startDate: '2026-09-05T00:00:00.000Z', startTimeTbd: false,
        neutralSite: false, conferenceGame: false,
        homeId, homeTeam: 'Home', awayId, awayTeam: 'Away',
        homePoints: completed ? 30 : null, awayPoints: completed ? 10 : null,
        completed
    };
}

async function enableH2H({ winBonus = 3, tieBonus = 0 } = {}) {
    await ScoringConfig.create({
        league: LEAGUE, model: 'graham', values: {},
        engagementBySeason: { '2026': { h2hEnabled: true, h2hWinBonus: winBonus, h2hTieBonus: tieBonus } }
    });
}

// Recompute cumulativeScore the way modules/scoring.js updateCumulativeScores
// does — sum weeklyScore[].score. This is the seam the whole fix relies on.
async function sumCumulative(userId) {
    const u = await User.findById(userId).lean();
    return (u.seasons[0].weeklyScore || []).reduce((s, e) => s + (e.score || 0), 0);
}

beforeEach(() => { jest.spyOn(console, 'log').mockImplementation(() => {}); });
afterEach(() => { jest.restoreAllMocks(); });

describe('POST /scores/h2h-bonus', () => {
    test('folds the win bonus into the weekly score, so cumulativeScore picks it up', async () => {
        await enableH2H();
        const a = await manager('Ann', [team(1, 'Oregon')], [[1, 20]]);
        const b = await manager('Bob', [team(2, 'Duke')], [[1, 14]]);
        await Game.create([game(101, 1, 1, 99, true), game(102, 1, 2, 98, true)]);

        const res = await request(app).post('/scores/h2h-bonus').send({ season: SEASON });
        expect(res.status).toBe(200);

        const winner = await User.findById(a._id).lean();
        const loser = await User.findById(b._id).lean();
        const wk = (u) => u.seasons[0].weeklyScore[0];

        expect(wk(winner)).toMatchObject({ score: 23, h2hBonus: 3, h2hResult: 'W' });
        expect(String(wk(winner).h2hOpponentId)).toBe(String(b._id));
        expect(wk(loser).score).toBe(14);
        expect(wk(loser).h2hBonus).toBeUndefined();

        // The whole point: the season total of record now includes the bonus.
        expect(await sumCumulative(a._id)).toBe(23);
        expect(await sumCumulative(b._id)).toBe(14);
    });

    // The 14 Sep 2026 bug, as a test.
    //
    // A scoring pass rewrote week-2 weekly rows and died before re-running
    // applyH2HBonuses + updateCumulativeScores, leaving cumulativeScore holding
    // a win bonus the weekly row no longer carried. The standings read model was
    // `cumulative + liveBonus - persistedBonus`: with persistedBonus back at 0 it
    // added the same win a SECOND time and rendered three managers 3 points high,
    // while the weekly recap — which sums the rows — rendered them 3 low. Two
    // screens, two different wrong answers, no error anywhere.
    test('a stale cumulativeScore does not double-count a win in the standings', async () => {
        await enableH2H();
        const a = await manager('Ann', [team(1, 'Oregon')], [[1, 20]]);
        const b = await manager('Bob', [team(2, 'Duke')], [[1, 14]]);
        await Game.create([game(101, 1, 1, 99, true), game(102, 1, 2, 98, true)]);

        await request(app).post('/scores/h2h-bonus').send({ season: SEASON });
        expect(await sumCumulative(a._id)).toBe(23);       // 20 base + 3 bonus, banked

        // Now reproduce the drift: strip the bonus off the weekly row (what a
        // rescore does) but leave cumulativeScore at the post-bonus value (what
        // the aborted pass left behind).
        await User.updateOne(
            { _id: a._id },
            { $set: { 'seasons.0.weeklyScore.0.score': 20, 'seasons.0.cumulativeScore': 23 },
              $unset: { 'seasons.0.weeklyScore.0.h2hBonus': '' } });

        jest.spyOn(console, 'warn').mockImplementation(() => {});
        const res = await request(app).get(`/standings/h2h/${LEAGUE}/${SEASON}`);
        expect(res.status).toBe(200);

        const ann = res.body.managers.find(m => m.name.startsWith('Ann'));
        const bob = res.body.managers.find(m => m.name.startsWith('Bob'));
        // 20 base + one 3-point win = 23. Not 26.
        expect(ann.adjustedTotal).toBe(23);
        expect(bob.adjustedTotal).toBe(14);
        expect(ann.rank).toBe(1);

        // And the drift itself is reported, because the database is still wrong
        // even though the page now renders correctly.
        expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('cumulativeScore drift'));
    });

    test('a healthy season renders the same total it always did', async () => {
        await enableH2H();
        const a = await manager('Ann', [team(1, 'Oregon')], [[1, 20]]);
        await manager('Bob', [team(2, 'Duke')], [[1, 14]]);
        await Game.create([game(101, 1, 1, 99, true), game(102, 1, 2, 98, true)]);
        await request(app).post('/scores/h2h-bonus').send({ season: SEASON });

        jest.spyOn(console, 'warn').mockImplementation(() => {});
        const res = await request(app).get(`/standings/h2h/${LEAGUE}/${SEASON}`);
        const ann = res.body.managers.find(m => m.name.startsWith('Ann'));

        expect(ann.adjustedTotal).toBe(23);
        expect(await sumCumulative(a._id)).toBe(23);
        // cumulativeScore still reads 20 here — /scores/h2h-bonus raises the
        // weekly rows and updateCumulativeScores re-sums them afterwards. That
        // direction is ordinary and self-correcting, so it must NOT warn;
        // only a stored total ABOVE the rows means damage.
        expect(console.warn).not.toHaveBeenCalled();
    });

    // The Standings page paints matchup cards from the fast (standingsOnly)
    // response so they arrive with the table instead of ~6s later, then swaps in
    // real odds when the projection payload lands. The fast payload must answer
    // NO odds — not merely "whatever falls out with no projections loaded".
    //
    // liveEntriesFor builds entries straight from scored results: a FINAL game
    // contributes { winProb: 1, pointsIfWin: <points> } without consulting a
    // projection at all. So on a Saturday where one manager's teams have
    // finished and the other's have not kicked off, the fast payload would
    // answer a confident, wrong 100%/0% bar and flip to the truth seconds later.
    test('the fast payload answers no odds for a half-played week', async () => {
        await enableH2H();
        await manager('Ann', [team(1, 'Oregon')], [[1, 20]]);
        await manager('Bob', [team(2, 'Duke')], [[1, 0]]);
        // Ann's game is over; Bob's hasn't kicked off. The exact split that used
        // to produce 100/0 with no projections in the payload.
        await Game.create([
            game(101, 1, 1, 99, true),
            Object.assign(game(102, 1, 2, 98, false), { startDate: '2099-01-01T00:00:00.000Z' })
        ]);

        const fast = await request(app).get(`/standings/h2h/${LEAGUE}/${SEASON}?standingsOnly=1`);
        expect(fast.status).toBe(200);
        expect(fast.body.partial).toBe(true);

        const cards = (fast.body.schedule || []).flatMap(w => w.games || []);
        expect(cards.length).toBeGreaterThan(0);
        // Every card: no odds at all, so the client draws a skeleton.
        cards.forEach(g => expect(g.winP).toBeNull());

        // ...while the full payload still answers real odds for the same week.
        const full = await request(app).get(`/standings/h2h/${LEAGUE}/${SEASON}`);
        expect(full.status).toBe(200);
        const fullCards = (full.body.schedule || []).flatMap(w => w.games || []);
        expect(fullCards.length).toBeGreaterThan(0);
    });

    test('the fast payload carries only the featured week, and the whole week list', async () => {
        await enableH2H();
        await manager('Ann', [team(1, 'Oregon')], [[1, 20]]);
        await manager('Bob', [team(2, 'Duke')], [[1, 14]]);
        await Game.create([game(101, 1, 1, 99, true), game(102, 1, 2, 98, true)]);

        const fast = await request(app).get(`/standings/h2h/${LEAGUE}/${SEASON}?standingsOnly=1`);
        const full = await request(app).get(`/standings/h2h/${LEAGUE}/${SEASON}`);

        // One week of cards on the fast path...
        expect((fast.body.schedule || []).length).toBe(1);
        expect(fast.body.schedule[0].week).toBe(fast.body.featuredWeek);
        // ...but the complete week list, so the picker is whole from first paint.
        expect(fast.body.weeks).toEqual(full.body.weeks);
        expect(fast.body.featuredWeek).toBe(full.body.featuredWeek);
        // The full payload is not marked partial, so it never renders skeletons.
        expect(full.body.partial).toBeUndefined();
    });

    test('a week is not awarded until every drafted team has played', async () => {
        await enableH2H();
        const a = await manager('Ann', [team(1, 'Oregon'), team(3, 'Iowa')], [[1, 20]]);
        await manager('Bob', [team(2, 'Duke')], [[1, 14]]);
        // Ann's second team hasn't finished.
        await Game.create([game(101, 1, 1, 99, true), game(102, 1, 2, 98, true), game(103, 1, 3, 97, false)]);

        await request(app).post('/scores/h2h-bonus').send({ season: SEASON });

        const winner = await User.findById(a._id).lean();
        expect(winner.seasons[0].weeklyScore[0].score).toBe(20);
        expect(winner.seasons[0].weeklyScore[0].h2hBonus).toBeUndefined();
    });

    test('running it repeatedly does not compound the bonus', async () => {
        await enableH2H();
        const a = await manager('Ann', [team(1, 'Oregon')], [[1, 20]]);
        await manager('Bob', [team(2, 'Duke')], [[1, 14]]);
        await Game.create([game(101, 1, 1, 99, true), game(102, 1, 2, 98, true)]);

        await request(app).post('/scores/h2h-bonus').send({ season: SEASON });
        await request(app).post('/scores/h2h-bonus').send({ season: SEASON });
        const third = await request(app).post('/scores/h2h-bonus').send({ season: SEASON });

        expect(await sumCumulative(a._id)).toBe(23);
        // Third pass had nothing left to write.
        expect(third.body.leagues[0].managersUpdated).toBe(0);
    });

    test('a rescore that flips the weekly result moves the bonus to the other manager', async () => {
        await enableH2H();
        const a = await manager('Ann', [team(1, 'Oregon')], [[1, 20]]);
        const b = await manager('Bob', [team(2, 'Duke')], [[1, 14]]);
        await Game.create([game(101, 1, 1, 99, true), game(102, 1, 2, 98, true)]);
        await request(app).post('/scores/h2h-bonus').send({ season: SEASON });
        expect(await sumCumulative(a._id)).toBe(23);

        // A rescore lands: Bob's week is corrected upward past Ann's.
        await User.updateOne({ _id: b._id }, { $set: { 'seasons.0.weeklyScore.0.score': 40 } });
        await request(app).post('/scores/h2h-bonus').send({ season: SEASON });

        expect(await sumCumulative(a._id)).toBe(20);   // bonus removed
        expect(await sumCumulative(b._id)).toBe(43);   // bonus awarded
    });

    test('raising the configured win bonus re-bases instead of stacking', async () => {
        await enableH2H({ winBonus: 3 });
        const a = await manager('Ann', [team(1, 'Oregon')], [[1, 20]]);
        await manager('Bob', [team(2, 'Duke')], [[1, 14]]);
        await Game.create([game(101, 1, 1, 99, true), game(102, 1, 2, 98, true)]);
        await request(app).post('/scores/h2h-bonus').send({ season: SEASON });

        await ScoringConfig.updateOne({ league: LEAGUE },
            { $set: { 'engagementBySeason.2026.h2hWinBonus': 5 } });
        await request(app).post('/scores/h2h-bonus').send({ season: SEASON });

        expect(await sumCumulative(a._id)).toBe(25);
    });

    test('turning H2H off strips previously banked bonuses back out', async () => {
        await enableH2H();
        const a = await manager('Ann', [team(1, 'Oregon')], [[1, 20]]);
        await manager('Bob', [team(2, 'Duke')], [[1, 14]]);
        await Game.create([game(101, 1, 1, 99, true), game(102, 1, 2, 98, true)]);
        await request(app).post('/scores/h2h-bonus').send({ season: SEASON });
        expect(await sumCumulative(a._id)).toBe(23);

        await ScoringConfig.updateOne({ league: LEAGUE },
            { $set: { 'engagementBySeason.2026.h2hEnabled': false } });
        await request(app).post('/scores/h2h-bonus').send({ season: SEASON });

        const back = await User.findById(a._id).lean();
        expect(back.seasons[0].weeklyScore[0].score).toBe(20);
        expect(back.seasons[0].weeklyScore[0].h2hBonus).toBeUndefined();
    });

    test('a classic league with no config is left completely untouched', async () => {
        const a = await manager('Ann', [team(1, 'Oregon')], [[1, 20]]);
        await manager('Bob', [team(2, 'Duke')], [[1, 14]]);
        await Game.create([game(101, 1, 1, 99, true), game(102, 1, 2, 98, true)]);

        const res = await request(app).post('/scores/h2h-bonus').send({ season: SEASON });
        expect(res.body.leagues[0]).toMatchObject({ enabled: false, managersUpdated: 0 });
        expect(await sumCumulative(a._id)).toBe(20);
    });

    test('the Captain bonus already in the weekly score is preserved', async () => {
        await enableH2H();
        const a = await User.create({
            firstName: 'Ann', lastName: 'Test', league: LEAGUE,
            seasons: [{ season: SEASON, teams: [team(1, 'Oregon')],
                weeklyScore: [{ week: 1, score: 26, captainTeamId: 1, captainBonus: 6 }] }]
        });
        await manager('Bob', [team(2, 'Duke')], [[1, 14]]);
        await Game.create([game(101, 1, 1, 99, true), game(102, 1, 2, 98, true)]);

        await request(app).post('/scores/h2h-bonus').send({ season: SEASON });

        const wk = (await User.findById(a._id).lean()).seasons[0].weeklyScore[0];
        expect(wk).toMatchObject({ score: 29, captainBonus: 6, h2hBonus: 3 });
    });
});

describe('GET /standings/h2h agrees with what was persisted', () => {
    // The read model subtracts the bonus already banked into cumulativeScore, so
    // the ranked total is the same before and after the scoring pass runs — and
    // never double-counts once it has.
    async function seed() {
        await enableH2H();
        const a = await manager('Ann', [team(1, 'Oregon')], [[1, 20]]);
        const b = await manager('Bob', [team(2, 'Duke')], [[1, 14]]);
        await Game.create([game(101, 1, 1, 99, true), game(102, 1, 2, 98, true)]);
        return { a, b };
    }
    const totalsOf = (body) => body.managers.reduce((m, x) => (m[x.name.split(' ')[0]] = x.adjustedTotal, m), {});

    test('the ranked total is identical before and after the bonus is banked', async () => {
        const { a } = await seed();

        const before = await request(app).get(`/standings/h2h/${LEAGUE}/${SEASON}?standingsOnly=1`);
        expect(totalsOf(before.body)).toEqual({ Ann: 23, Bob: 14 });

        await request(app).post('/scores/h2h-bonus').send({ season: SEASON });
        // Mirror updateCumulativeScores, which runs right after the pass.
        await User.updateOne({ _id: a._id }, { $set: { 'seasons.0.cumulativeScore': await sumCumulative(a._id) } });

        const after = await request(app).get(`/standings/h2h/${LEAGUE}/${SEASON}?standingsOnly=1`);
        expect(totalsOf(after.body)).toEqual({ Ann: 23, Bob: 14 });
        expect(after.body.managers.find(m => m.name.startsWith('Ann'))).toMatchObject({ record: '1-0-0', h2hBonus: 3 });
    });
});

// The pairing schedule is positional, so the manager list decides who plays whom
// in every week. Deriving it fresh on each pass meant a mid-season membership
// change restructured the round robin and re-decided already-settled weeks —
// applyAwards, which rebuilds each week's bonus from base, then moved the banked
// points to whoever now "won". Pinning the list on the first settled week is what
// makes a decided week stay decided.
describe('the H2H roster is pinned once a week settles', () => {
    async function settledWeekOne() {
        await enableH2H();
        const a = await manager('Ann', [team(1, 'Oregon')], [[1, 20]]);
        const b = await manager('Bob', [team(2, 'Duke')], [[1, 14]]);
        await Game.create([game(101, 1, 1, 99, true), game(102, 1, 2, 98, true)]);
        return { a, b };
    }

    test('pins the manager list and reports it', async () => {
        const { a, b } = await settledWeekOne();
        const res = await request(app).post('/scores/h2h-bonus').send({ season: SEASON });

        expect(res.body.leagues[0].rosterPinned).toBe(true);
        const cfg = await ScoringConfig.findOne({ league: LEAGUE }).lean();
        const pin = cfg.h2hScheduleBySeason[String(SEASON)];
        expect(pin.ids.map(String).sort()).toEqual([String(a._id), String(b._id)].sort());
        expect(pin.pinnedAt).toBeInstanceOf(Date);
    });

    test('does not pin before any week has settled', async () => {
        await enableH2H();
        await manager('Ann', [team(1, 'Oregon')], [[1, 20]]);
        await manager('Bob', [team(2, 'Duke')], [[1, 14]]);
        await Game.create([game(101, 1, 1, 99, false)]);   // still in progress

        const res = await request(app).post('/scores/h2h-bonus').send({ season: SEASON });
        expect(res.body.leagues[0].rosterPinned).toBe(false);
        // Mongoose `minimize` strips an empty object on save, so the field is
        // absent rather than {} — pinnedH2HIds tolerates both.
        const cfg = await ScoringConfig.findOne({ league: LEAGUE }).lean();
        expect(pinnedH2HIds(cfg, SEASON)).toBeNull();
    });

    test('pins once — a second pass does not re-pin', async () => {
        await settledWeekOne();
        await request(app).post('/scores/h2h-bonus').send({ season: SEASON });
        const first = (await ScoringConfig.findOne({ league: LEAGUE }).lean())
            .h2hScheduleBySeason[String(SEASON)].pinnedAt;

        const res = await request(app).post('/scores/h2h-bonus').send({ season: SEASON });
        expect(res.body.leagues[0].rosterPinned).toBe(false);
        const after = (await ScoringConfig.findOne({ league: LEAGUE }).lean())
            .h2hScheduleBySeason[String(SEASON)].pinnedAt;
        expect(after).toEqual(first);
    });

    // The regression. A third manager joins after week 1 has paid out; week 1's
    // result and banked bonus must not move.
    test('a manager joining mid-season cannot re-decide a settled week', async () => {
        const { a, b } = await settledWeekOne();
        await request(app).post('/scores/h2h-bonus').send({ season: SEASON });
        expect(await sumCumulative(a._id)).toBe(23);
        expect(await sumCumulative(b._id)).toBe(14);

        // Cal joins and gets scored for week 1 too.
        await manager('Cal', [team(4, 'Iowa')], [[1, 30]]);
        await Game.create(game(104, 1, 4, 97, true));

        await request(app).post('/scores/h2h-bonus').send({ season: SEASON });

        const wk = (u) => u.seasons[0].weeklyScore[0];
        expect(wk(await User.findById(a._id).lean())).toMatchObject({ score: 23, h2hBonus: 3, h2hResult: 'W' });
        expect(wk(await User.findById(b._id).lean()).h2hBonus).toBeUndefined();
        expect(await sumCumulative(a._id)).toBe(23);
        expect(await sumCumulative(b._id)).toBe(14);
    });

    test('the late joiner gets no H2H for the pinned season', async () => {
        await settledWeekOne();
        await request(app).post('/scores/h2h-bonus').send({ season: SEASON });

        const c = await manager('Cal', [team(4, 'Iowa')], [[1, 30]]);
        await Game.create(game(104, 1, 4, 97, true));
        await request(app).post('/scores/h2h-bonus').send({ season: SEASON });

        const cal = await User.findById(c._id).lean();
        expect(cal.seasons[0].weeklyScore[0].h2hBonus).toBeUndefined();
        expect(cal.seasons[0].weeklyScore[0].h2hResult).toBeUndefined();
    });
});

// The H2H pass reads its managers through an AGGREGATE now, so that it can slim
// seasons[].teams — a plain projection and $elemMatch both return a subdocument
// whole, and a manager carries four seasons of full team objects. Measured
// against a dev copy of prod: 1059KB/11325ms unprojected, 40KB/608ms here.
//
// The aggregate brings two hazards a find() did not have, and these pin both.
describe('POST /scores/h2h-bonus — the aggregate read', () => {
    // THE TRAP. models/user.js declares seasonSchema.season as Number, and every
    // caller in the app passes the season as a STRING — which works only because
    // Mongoose casts it against the schema on a find(). An aggregate pipeline
    // gets no casting at all: $match on '2026' matches nothing, the pass sees
    // zero managers, skips the league, and logs "0 manager(s) updated". No error,
    // no bonuses, and the standings quietly disagree with every other surface.
    test('awards the bonus when the season arrives as a string', async () => {
        await enableH2H();
        const a = await manager('Ann', [team(1, 'Oregon')], [[1, 20]]);
        const b = await manager('Bob', [team(2, 'Duke')], [[1, 14]]);
        await Game.create([game(101, 1, 1, 99, true), game(102, 1, 2, 98, true)]);

        // String, exactly as modules/scoring.js and the job paths send it.
        const res = await request(app).post('/scores/h2h-bonus').send({ season: String(SEASON) });

        expect(res.status).toBe(200);
        const gl = res.body.leagues.find(l => l.league === LEAGUE);
        expect(gl.managersUpdated).toBe(2);
        expect(gl.bonusAwarded).toBe(3);

        const winner = await User.findById(a._id).lean();
        expect(winner.seasons[0].weeklyScore[0]).toMatchObject({ score: 23, h2hBonus: 3, h2hResult: 'W' });
        const loser = await User.findById(b._id).lean();
        expect(loser.seasons[0].weeklyScore[0].score).toBe(14);
    });

    // The write is a positional $set of ONE season's weeklyScore, not a save() of
    // the whole document. A manager's OTHER seasons must come through untouched —
    // a pass that rewrote them would silently rewrite banked history.
    test('leaves the manager\'s other seasons exactly as they were', async () => {
        await enableH2H();
        const a = await manager('Ann', [team(1, 'Oregon')], [[1, 20]]);
        const b = await manager('Bob', [team(2, 'Duke')], [[1, 14]]);
        // A prior season, with its own roster and banked scores.
        await User.updateOne({ _id: a._id }, { $push: { seasons: {
            season: 2025, teams: [team(7, 'Texas')],
            weeklyScore: [{ week: 1, score: 40, h2hBonus: 3, h2hResult: 'W' }],
            cumulativeScore: 40
        } } });
        const before = (await User.findById(a._id).lean()).seasons.find(s => s.season === 2025);
        await Game.create([game(101, 1, 1, 99, true), game(102, 1, 2, 98, true)]);

        await request(app).post('/scores/h2h-bonus').send({ season: SEASON });

        const after = (await User.findById(a._id).lean()).seasons.find(s => s.season === 2025);
        expect(after).toEqual(before);
        // ...and the scored season really was written.
        const scored = (await User.findById(a._id).lean()).seasons.find(s => s.season === SEASON);
        expect(scored.weeklyScore[0]).toMatchObject({ score: 23, h2hBonus: 3 });
    });

    // weeklyScore is read WHOLE rather than trimmed to the six fields the
    // computation uses, precisely because the caller writes the array back.
    // Trimming the read would make this write drop scoreByTeam and the Captain
    // fields off every entry — silently, and only for managers who earned a bonus.
    test('preserves scoreByTeam and the Captain fields on a rewritten entry', async () => {
        await enableH2H();
        const a = await manager('Ann', [team(1, 'Oregon')], [[1, 20]]);
        const b = await manager('Bob', [team(2, 'Duke')], [[1, 14]]);
        await User.updateOne({ _id: a._id, 'seasons.season': SEASON }, { $set: {
            'seasons.$.weeklyScore': [{
                week: 1, score: 20,
                scoreByTeam: [{ team: 'Oregon', teamId: 1, gameId: 101, score: 20 }],
                captainTeamId: 1, captainBonus: 5
            }]
        } });
        await Game.create([game(101, 1, 1, 99, true), game(102, 1, 2, 98, true)]);

        await request(app).post('/scores/h2h-bonus').send({ season: SEASON });

        const wk = (await User.findById(a._id).lean()).seasons.find(s => s.season === SEASON).weeklyScore[0];
        expect(wk.h2hBonus).toBe(3);
        expect(wk.score).toBe(23);
        // Untouched by the bonus write.
        expect(wk.scoreByTeam).toHaveLength(1);
        expect(wk.scoreByTeam[0]).toMatchObject({ team: 'Oregon', teamId: 1, gameId: 101, score: 20 });
        expect(wk.captainTeamId).toBe(1);
        expect(wk.captainBonus).toBe(5);
    });
});
