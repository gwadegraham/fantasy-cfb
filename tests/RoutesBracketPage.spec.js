// HTTP-level tests for GET /playoffs/bracket/:season/:league — the CFP bracket
// page's data route, which had no coverage at all.
//
// The bracket fixture is the REAL 2025 CFBD payload run through deriveBracket,
// so the stored document has the shape production stores: `bidType: 'automatic'`
// rather than 'auto', a `committeeRank` and no `rank`, seeds that diverge from
// committee rank (Tulane is the 11 seed at rank 20). Hand-rolling a bracket here
// would have let every one of the bugs below through — each of them is a field
// that only a real bracket carries, or only a played game reveals.
//
// The route has two shapes behind one URL: a stored bracket, and, before
// selection day, a bracket projected from the polls. They took different code
// paths through the same enrichment, and only the projected one was ever
// exercised by hand — so the stored-bracket cases carry most of the weight, and
// a projection case guards against fixing them by breaking it.

const express = require('express');
const request = require('supertest');
const { useMongo } = require('./helpers/mongo');
const CfpBracket = require('../models/cfpBracket');
const Game = require('../models/game');
const Team = require('../models/team');
const Ranking = require('../models/ranking');
const ScoringConfig = require('../models/scoringConfig');
const User = require('../models/user');
const { deriveBracket } = require('../modules/cfp-bracket');
const playoffsRouter = require('../routes/playoffs');

const raw2025 = require('./fixtures/cfp-bracket-2025.json');

const app = express();
app.use(express.json());
app.use('/playoffs', playoffsRouter);

useMongo();

const SEASON = 2025;
const GRAHAM = 'graham-league';
const CLAUNTS = 'claunts-league';

// Graham's CFP values, matching modules/scoring-defaults.js: every round is an
// APPEARANCE worth 6 (top-4 seeds bank another 6 for the bye), and only the
// national championship pays for winning.
const FIRST_ROUND = 6, QUARTER = 6, BYE_BONUS = 6, SEMI = 6, TITLE = 10;

const derived = deriveBracket(raw2025);
const seedOf = {};
derived.participants.forEach(p => { seedOf[p.school] = p.seed; });
const idOf = {};
derived.participants.forEach(p => { idOf[p.school] = p.teamId; });

// Who actually beat whom in 2025, by bracket slot. Scores are stand-ins; only
// the winner matters, and a one-point margin makes an accidental comparison
// flip loudly rather than quietly.
const RESULTS = {
    FR1: 'Oregon', FR2: 'Ole Miss', FR3: 'Miami', FR4: 'Alabama',
    QF1: 'Indiana', QF2: 'Oregon', QF3: 'Miami', QF4: 'Ole Miss',
    SF1: 'Indiana', SF2: 'Miami',
    CH: 'Indiana'
};

function teamDoc(p) {
    return {
        id: p.teamId, school: p.school, mascot: 'Mascot',
        abbreviation: p.school.slice(0, 3).toUpperCase(), conference: p.conference,
        classification: 'fbs', color: '#123456', alt_color: '#654321',
        logos: [`http://x/${p.teamId}.png`],
        location: { venue_id: p.teamId, name: `${p.school} Stadium`, city: 'City', state: 'ST',
                    zip: '00000', latitude: 1, longitude: 1, capacity: 100, grass: true, dome: false }
    };
}

// `through` caps how far the bracket has been played, so a test can ask for a
// half-finished bracket as easily as a finished one.
function gameDocsThrough(through) {
    const ROUNDS = ['first_round', 'quarterfinal', 'semifinal', 'championship'];
    const limit = ROUNDS.indexOf(through);
    return derived.games
        .filter(g => ROUNDS.indexOf(g.round) <= limit)
        .map(g => {
            const winner = RESULTS[g.bracketSlot];
            const [home, away] = g.teams;
            return {
                id: g.gameId, season: SEASON, seasonType: 'postseason', week: 1,
                startDate: '2025-12-20T17:00:00.000Z', startTimeTbd: false,
                neutralSite: true, conferenceGame: false, completed: true,
                venue: 'Some Stadium',
                homeId: home.teamId, homeTeam: home.school, homeConference: 'Big Ten',
                homePoints: home.school === winner ? 21 : 20,
                awayId: away.teamId, awayTeam: away.school, awayConference: 'SEC',
                awayPoints: away.school === winner ? 21 : 20
            };
        });
}

async function seedCommon() {
    await Team.insertMany(derived.participants.map(teamDoc));
    await ScoringConfig.create({ league: GRAHAM, model: 'graham', values: {} });
    await ScoringConfig.create({ league: CLAUNTS, model: 'claunts', values: {} });
}

// One manager owning the named schools. `franchiseName` is what the page keys
// its summary on. A roster subdocument is a FULL team object, not a reference,
// so the roster entries are built from the same fixture as the Team docs.
async function seedManager(league, franchiseName, schools, extra) {
    const bySchool = {};
    derived.participants.forEach(p => { bySchool[p.school] = p; });
    return User.create(Object.assign({
        firstName: franchiseName, lastName: 'Manager',
        email: `${franchiseName.replace(/\W/g, '')}@example.com`,
        league: league, color: '#ed5858',
        seasons: [{
            season: SEASON, franchiseName: franchiseName,
            teams: schools.map(s => teamDoc(bySchool[s]))
        }]
    }, extra || {}));
}

const get = (league, season = SEASON) =>
    request(app).get(`/playoffs/bracket/${season}/${league}`);
const bySeed = (body, seed) => body.participants.find(p => p.seed === seed);
const bySlot = (body, slot) => body.games.find(g => g.bracketSlot === slot);

beforeEach(() => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe('a stored bracket survives enrichment', () => {
    beforeEach(async () => {
        await seedCommon();
        await CfpBracket.create(Object.assign({}, derived, { season: SEASON }));
        await Game.insertMany(gameDocsThrough('championship'));
    });

    // The enrichment spreads each participant and game. Spreading a Mongoose
    // subdocument copies its internals ($__parent, _doc, __parentArray) and NOT
    // its schema fields, so every school, seed and round came back undefined —
    // which the client turns into four empty bracket columns, because it groups
    // the games by g.round.
    test('participants keep the fields the page renders', async () => {
        const res = await get(GRAHAM);
        expect(res.status).toBe(200);
        expect(res.body.projected).toBe(false);

        const one = bySeed(res.body, 1);
        expect(one.school).toBe('Indiana');
        expect(one.teamId).toBe(idOf['Indiana']);
        expect(one.firstRoundBye).toBe(true);
        expect(res.body.participants.map(p => p.seed).sort((a, b) => a - b))
            .toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
        expect(res.body.participants.every(p => p.school)).toBe(true);
    });

    test('games keep their round, slot and id', async () => {
        const res = await get(GRAHAM);
        const rounds = res.body.games.map(g => g.round);
        expect(rounds.filter(r => r === 'first_round')).toHaveLength(4);
        expect(rounds.filter(r => r === 'quarterfinal')).toHaveLength(4);
        expect(rounds.filter(r => r === 'semifinal')).toHaveLength(2);
        expect(rounds.filter(r => r === 'championship')).toHaveLength(1);

        const ch = bySlot(res.body, 'CH');
        expect(ch.gameId).toBe(401769076);
        expect(ch.teams.map(t => t.school).sort()).toEqual(['Indiana', 'Miami']);
        expect(ch.teams.every(t => t.seed != null)).toBe(true);
        expect(ch.game.completed).toBe(true);
    });

    // Mongoose's internals are not just missing fields, they are big ones:
    // __parentArray is the whole participants array, re-serialized under every
    // participant and every game.
    test('no Mongoose internals reach the client', async () => {
        const res = await get(GRAHAM);
        for (const p of res.body.participants) {
            expect(Object.keys(p)).not.toContain('__parentArray');
            expect(Object.keys(p)).not.toContain('_doc');
        }
        expect(Buffer.byteLength(JSON.stringify(res.body))).toBeLessThan(120 * 1024);
    });

    // CFBD writes 'automatic'/'at_large'; the projection writes 'auto'/
    // 'at-large'; the page only renders one of them, so every automatic
    // qualifier in a real bracket was labelled At-Large.
    test('bidType is normalized to the spelling the page renders', async () => {
        const res = await get(GRAHAM);
        expect(bySeed(res.body, 1).bidType).toBe('auto');       // stored 'automatic'
        expect(bySeed(res.body, 2).bidType).toBe('at-large');   // stored 'at_large'
        expect(res.body.participants.every(p => ['auto', 'at-large'].includes(p.bidType))).toBe(true);
    });

    // A real bracket has no `rank` — only the committee's. Without the fallback
    // the Field table showed NR for all twelve, hiding exactly the interesting
    // rows: Tulane is the 11 seed at committee rank 20.
    test('rank falls back to the committee rank', async () => {
        const res = await get(GRAHAM);
        expect(bySeed(res.body, 11).school).toBe('Tulane');
        expect(bySeed(res.body, 11).rank).toBe(20);
        expect(bySeed(res.body, 12).rank).toBe(24);
        expect(bySeed(res.body, 1).rank).toBe(1);
    });
});

describe('points reflect what has already been played', () => {
    beforeEach(async () => {
        await seedCommon();
        await CfpBracket.create(Object.assign({}, derived, { season: SEASON }));
    });

    test('a finished bracket pays each team what it actually earned', async () => {
        await Game.insertMany(gameDocsThrough('championship'));
        const res = await get(GRAHAM);

        // Indiana ran the table from a bye.
        expect(bySeed(res.body, seedOf['Indiana']).maxPoints)
            .toBe(QUARTER + BYE_BONUS + SEMI + TITLE);
        // Ohio State had a bye and lost its quarterfinal: it still banked the
        // quarterfinal appearance and the bye bonus. Crediting round points to
        // the winner instead scored this 0.
        expect(bySeed(res.body, seedOf['Ohio State']).maxPoints).toBe(QUARTER + BYE_BONUS);
        // Alabama won its opener and went out in the quarterfinal — two
        // appearances, no bye bonus.
        expect(bySeed(res.body, seedOf['Alabama']).maxPoints).toBe(FIRST_ROUND + QUARTER);
        // Miami lost the title game: three appearances, and nothing for the
        // championship, which is Graham's one win-only rule.
        expect(bySeed(res.body, seedOf['Miami']).maxPoints).toBe(FIRST_ROUND + QUARTER + SEMI);
        // Out in the first round.
        expect(bySeed(res.body, seedOf['Tulane']).maxPoints).toBe(FIRST_ROUND);
    });

    test('an eliminated team is marked, a surviving one is not', async () => {
        await Game.insertMany(gameDocsThrough('championship'));
        const res = await get(GRAHAM);
        expect(bySeed(res.body, seedOf['Indiana']).eliminatedIn).toBeNull();
        expect(bySeed(res.body, seedOf['Ohio State']).eliminatedIn).toBe('quarterfinal');
        expect(bySeed(res.body, seedOf['Tulane']).eliminatedIn).toBe('first_round');
        expect(bySeed(res.body, seedOf['Miami']).eliminatedIn).toBe('championship');
    });

    // The half-played case is the one the page is actually for. A team still
    // alive keeps its whole remaining ceiling; one already out does not.
    test('mid-bracket, survivors keep their ceiling and losers do not', async () => {
        await Game.insertMany(gameDocsThrough('first_round'));
        const res = await get(GRAHAM);

        // Oregon won its opener and can still win three more.
        expect(bySeed(res.body, seedOf['Oregon']).maxPoints)
            .toBe(FIRST_ROUND + QUARTER + SEMI + TITLE);
        // Texas A&M lost its opener and is done.
        expect(bySeed(res.body, seedOf['Texas A&M']).maxPoints).toBe(FIRST_ROUND);
        expect(bySeed(res.body, seedOf['Texas A&M']).eliminatedIn).toBe('first_round');
        // A bye team hasn't played yet, so nothing is settled for it.
        expect(bySeed(res.body, seedOf['Georgia']).maxPoints)
            .toBe(QUARTER + BYE_BONUS + SEMI + TITLE);
        expect(bySeed(res.body, seedOf['Georgia']).eliminatedIn).toBeNull();
    });

    // Claunts pays cfpAppearance for a first-round EXIT and nothing for winning
    // the opener, so losing round one is worth more at that node than winning
    // it. The search has to weigh that against what winning unlocks.
    test('the Claunts first-round exit bonus is paid to the team that went out', async () => {
        await seedManager(CLAUNTS, 'Goofball', ['Tulane']);
        await Game.insertMany(gameDocsThrough('first_round'));
        const res = await get(CLAUNTS);

        const cfpAppearance = 7, cfpQuarterfinal = 8, cfpSemifinal = 9, natty = 10;
        expect(res.body.pointsByRound.first_round_loss).toBe(cfpAppearance);
        expect(bySeed(res.body, seedOf['Tulane']).maxPoints).toBe(cfpAppearance);
        // Ole Miss won the same game, so it forfeits the exit bonus but keeps
        // everything still ahead of it.
        expect(bySeed(res.body, seedOf['Ole Miss']).maxPoints)
            .toBe(cfpQuarterfinal + cfpSemifinal + natty);
    });
});

describe('the franchise summary', () => {
    beforeEach(async () => {
        await seedCommon();
        await CfpBracket.create(Object.assign({}, derived, { season: SEASON }));
    });

    // Both of these were described as losing a round earlier than the bracket
    // allows: the sentence printed the last round the team WON, so "reaches the
    // Semis before being knocked out by Ohio State" for two teams that can only
    // ever meet in the championship.
    test('a narrative names the round a team went out in', async () => {
        // Alabama is the 9 seed and Ole Miss the 6: opposite halves, so the
        // only game they can ever play each other is the final. The sentence
        // used to print the last round the loser WON — "reaches the Semis" —
        // which reads as a semifinal meeting the bracket forbids.
        await seedManager(GRAHAM, 'Two Sides', ['Alabama', 'Ole Miss']);
        const res = await get(GRAHAM);
        const f = res.body.franchiseSummary.find(x => x.franchise === 'Two Sides');

        expect(f.narrative).toMatch(/reaches the National Championship before/);
        expect(f.narrative).not.toMatch(/reaches the Semis before/);
    });

    test('a finished bracket stops promising a run that already failed', async () => {
        await seedManager(GRAHAM, 'Beaten', ['Oregon']);
        await Game.insertMany(gameDocsThrough('championship'));
        const res = await get(GRAHAM);
        const f = res.body.franchiseSummary.find(x => x.franchise === 'Beaten');

        // Oregon lost the semifinal. It must not be crowned anything.
        expect(f.maxPoints).toBe(FIRST_ROUND + QUARTER + SEMI);
        expect(f.narrative).not.toMatch(/champion|trophy|National Championship/i);
        expect(f.narrative).toContain('Oregon');
    });

    // Once every team a franchise owns is out there is no run left to narrate,
    // and the card would otherwise carry no sentence at all — which reads as a
    // page that failed to load rather than a season that ended.
    test('a franchise with nothing left still gets a sentence', async () => {
        await seedManager(GRAHAM, 'All Out', ['Ohio State', 'Tulane']);
        await Game.insertMany(gameDocsThrough('championship'));
        const res = await get(GRAHAM);
        const f = res.body.franchiseSummary.find(x => x.franchise === 'All Out');

        expect(f.narrative).toMatch(/Ohio State went out in the Quarterfinals to Miami/);
        expect(f.narrative).toMatch(/Tulane went out in the First Round to Ole Miss/);
        expect(f.maxPoints).toBe((QUARTER + BYE_BONUS) + FIRST_ROUND);
    });

    // Two teams of the same franchise meeting costs the franchise the rounds
    // after that game, not the round they meet in — both were there.
    test('two franchise teams in one game both bank the appearance', async () => {
        await seedManager(GRAHAM, 'Both Sides', ['Indiana', 'Alabama']);
        await Game.insertMany(gameDocsThrough('championship'));
        const res = await get(GRAHAM);
        const f = res.body.franchiseSummary.find(x => x.franchise === 'Both Sides');

        // Indiana: QF + bye + SF + title. Alabama: first round + the
        // quarterfinal it lost to Indiana.
        expect(f.maxPoints).toBe((QUARTER + BYE_BONUS + SEMI + TITLE) + (FIRST_ROUND + QUARTER));
    });
});

describe('the projected bracket', () => {
    // No stored bracket: the route builds a 12-team field from the polls. This
    // is the path that was live all along, so it is here to catch a fix to the
    // stored path that breaks it.
    beforeEach(async () => {
        await seedCommon();
        await Ranking.create({
            season: SEASON, seasonType: 'regular', week: 12,
            polls: [{
                poll: 'AP Top 25',
                ranks: derived.participants
                    .slice()
                    .sort((a, b) => a.seed - b.seed)
                    .map((p, i) => ({ rank: i + 1, school: p.school }))
            }]
        });
    });

    test('projects from the poll and leaves every team its full ceiling', async () => {
        const res = await get(GRAHAM);
        expect(res.status).toBe(200);
        expect(res.body.projected).toBe(true);
        expect(res.body.pollSource).toBe('AP Top 25');
        expect(res.body.pollWeek).toBe(12);

        // Nothing has been played, so nobody is out and a bye team and a
        // non-bye team have the same ceiling under Graham's values.
        expect(res.body.participants.every(p => p.eliminatedIn === null)).toBe(true);
        expect(bySeed(res.body, 1).maxPoints).toBe(QUARTER + BYE_BONUS + SEMI + TITLE);
        expect(bySeed(res.body, 9).maxPoints).toBe(FIRST_ROUND + QUARTER + SEMI + TITLE);
    });

    test('the projection spells bidType the same way a stored bracket does', async () => {
        const res = await get(GRAHAM);
        expect(res.body.participants.every(p => ['auto', 'at-large'].includes(p.bidType))).toBe(true);
    });

    test('404s when there is neither a bracket nor a poll to project from', async () => {
        const res = await get(GRAHAM, 2019);
        expect(res.status).toBe(404);
        expect(res.body.message).toMatch(/No rankings available/);
    });

    test('a malformed season is a 400', async () => {
        const res = await get(GRAHAM, 'latest');
        expect(res.status).toBe(400);
        expect(res.body.message).toBe('Invalid season');
    });
});
