// The March Madness bracket (routes/hoopsBracket.js): who may see it, and
// whose points it shows.
//
// The gate IS the feature for now. The site Admin wants to look at the page
// before the league does, so everyone else — a League Manager, a commissioner
// appointed on the league (#600), an ordinary member and a signed-out visitor
// — must get the app's plain 404 for both the page and its data. A copy of
// hoopsAdmin's gate (which lets a basketball commissioner in) would pass a
// test that only tried a member, so every one of them is tried.
//
// The points must be what the league BANKED, not a recomputation: the games
// are scored by the real scoring pass, then the league's config is changed
// without rescoring. A page that re-ran the rules would follow the new config;
// the page must not.

const express = require('express');
const path = require('path');
const request = require('supertest');
const { useMongo } = require('./helpers/mongo');
const hoopsBracket = require('../routes/hoopsBracket');
const HoopsGame = require('../models/hoopsGame');
const HoopsTeam = require('../models/hoopsTeam');
const Franchise = require('../models/franchise');
const Account = require('../models/account');
const League = require('../models/league');
const SportSeason = require('../models/sportSeason');
const ScoringConfig = require('../models/scoringConfig');
const seasons = require('../modules/active-season');
const { scoreHoopsWeek } = require('../modules/hoops-scoring-pass');

useMongo();

const HOOPS = 'hoops-league';
const SEASON = 2027;
const refs = (...ids) => ids.map(id => ({ id, sport: 'basketball' }));

// roles: null = signed out; [] = a member; ['League Manager']; ['Admin'].
function appAs(roles, { accountId = null, viewing = HOOPS } = {}) {
    const a = express();
    a.set('views', path.join(__dirname, '..', 'views'));
    a.set('view engine', 'ejs');
    a.use((req, res, next) => {
        const user = roles === null ? null
            : { user_metadata: { roles, metadata: { userId: accountId ? String(accountId) : undefined } } };
        req.oidc = { isAuthenticated: () => roles !== null, user };
        req.effUser = user;
        if (viewing) req.headers.cookie = `cc_league=${viewing}`;
        next();
    });
    a.use('/hoops/bracket', hoopsBracket.build({
        pageLocals: () => ({ user: { userId: 'u1', firstName: 'Garrett', role: (roles || [])[0] || '' }, userState: '{}' })
    }));
    // What server.js does with a request no route answered.
    a.use((req, res) => res.status(404).send('Not found'));
    return a;
}

const NOTES = (region, round) => `NCAA Men's Basketball Championship - ${region} Region - ${round}`;
let gid = 1000;
function game(round, region, home, away, { week = 20, final = true, homePts = 70, awayPts = 60, day = '2027-03-19' } = {}) {
    gid += 1;
    return {
        id: gid, season: SEASON, seasonType: 'postseason', tournament: 'NCAA', week,
        startDate: new Date(`${day}T18:00:00Z`), status: final ? 'final' : 'scheduled',
        gameNotes: region ? NOTES(region, round) : `NCAA Men's Basketball Championship - ${round}`,
        neutralSite: true,
        homeTeamId: home[0], homeSeed: home[1], homeTeam: `Team ${home[0]}`,
        awayTeamId: away[0], awaySeed: away[1], awayTeam: `Team ${away[0]}`,
        ...(final ? { homePoints: homePts, awayPoints: awayPts } : {})
    };
}

let ann, bob, cal;

beforeEach(async () => {
    gid = 1000;
    seasons._reset();
    await SportSeason.create([{ sport: 'football', season: 2026, status: 'in-season' },
                              { sport: 'basketball', season: SEASON, status: 'in-season' }]);
    await League.create([{ code: 'graham-league', name: 'Graham League', sport: 'football' },
                         { code: HOOPS, name: 'Hardwood Heroes', sport: 'basketball' }]);
    await seasons.prime();
    ann = await Account.create({ firstName: 'Ann', lastName: 'Two', email: 'ann@example.invalid' });
    bob = await Account.create({ firstName: 'Bob', lastName: 'One', email: 'bob@example.invalid' });
    cal = await Account.create({ firstName: 'Cal', lastName: 'Three', email: 'cal@example.invalid' });
    // Ann has the 1 seed (team 1) and the 9 (team 9); Bob has the 12 (team 12).
    await Franchise.create([
        { accountId: ann._id, league: HOOPS, seasons: [{ season: SEASON, franchiseName: 'Ann Arbor', teamRefs: refs(1, 9) }] },
        { accountId: bob._id, league: HOOPS, seasons: [{ season: SEASON, franchiseName: 'Bob Squad', teamRefs: refs(12) }] }
    ]);
    await HoopsTeam.create([1, 16, 8, 9, 5, 12].map(id => ({
        id, season: SEASON, school: `School ${id}`, conference: 'Big East', logos: [`logo${id}.png`], preseason: { rank: id * 5 }
    })));
    jest.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

async function seedTournament() {
    await HoopsGame.create([
        // Round of 64, South: 1 beats 16, 9 beats 8 (an upset by one seed line),
        // 12 beats 5 (by seven).
        game('1st Round', 'South', [1, 1], [16, 16], { homePts: 80, awayPts: 50 }),
        game('1st Round', 'South', [8, 8], [9, 9], { homePts: 60, awayPts: 64 }),
        game('1st Round', 'South', [5, 5], [12, 12], { homePts: 61, awayPts: 70 }),
        // Round of 32: 1 beats 9, a week later.
        game('2nd Round', 'South', [1, 1], [9, 9], { week: 21, homePts: 77, awayPts: 70, day: '2027-03-21' })
    ]);
    // The real scoring pass banks both weeks onto the rosters.
    await scoreHoopsWeek(HOOPS, { season: SEASON, week: 20 });
    await scoreHoopsWeek(HOOPS, { season: SEASON, week: 21 });
}

const bankedFor = async (accountId, teamId) => {
    const f = await Franchise.findOne({ accountId, league: HOOPS }).lean();
    const s = f.seasons.find(x => x.season === SEASON);
    return s.weeklyScore.flatMap(w => w.scoreByTeam).filter(r => r.teamId === teamId).reduce((sum, r) => sum + r.score, 0);
};

describe('who sees it', () => {
    test('an Admin gets the page', async () => {
        const res = await request(appAs(['Admin'], { accountId: ann._id })).get('/hoops/bracket');
        expect(res.status).toBe(200);
        expect(res.text).toContain('id="march-bracket"');
        expect(res.text).toContain('/hoopsBracket.js');
    });

    test('an Admin gets the data', async () => {
        const res = await request(appAs(['Admin'], { accountId: ann._id })).get('/hoops/bracket/data');
        expect(res.status).toBe(200);
        expect(res.body.season).toBe(SEASON);
    });

    test('signed out: the page goes to login, the data is a 404', async () => {
        const page = await request(appAs(null)).get('/hoops/bracket');
        expect(page.status).toBe(302);
        expect(page.headers.location).toBe('/login');
        const data = await request(appAs(null)).get('/hoops/bracket/data');
        expect(data.status).toBe(404);
        expect(data.body).not.toHaveProperty('season');
    });

    // 404, not 403 and not a redirect home: either of those says the page exists.
    test.each([
        ['a League Manager', ['League Manager']],
        ['a member', []]
    ])('%s gets a plain 404 for both', async (_, roles) => {
        await seedTournament();
        const page = await request(appAs(roles, { accountId: ann._id })).get('/hoops/bracket');
        expect(page.status).toBe(404);
        expect(page.text).not.toContain('march-bracket');
        const data = await request(appAs(roles, { accountId: ann._id })).get('/hoops/bracket/data');
        expect(data.status).toBe(404);
        expect(data.body).not.toHaveProperty('teams');
    });

    // The gate hoopsAdmin uses lets this person in. This one must not.
    test("the basketball league's own commissioner gets a plain 404 for both", async () => {
        await League.updateOne({ code: HOOPS }, { $set: { commissioners: [String(cal._id)] } });
        await seasons.prime();
        expect(seasons.commissionersOf(HOOPS)).toEqual([String(cal._id)]);
        for (const roles of [[], ['League Manager']]) {
            const page = await request(appAs(roles, { accountId: cal._id })).get('/hoops/bracket');
            expect(page.status).toBe(404);
            const data = await request(appAs(roles, { accountId: cal._id })).get('/hoops/bracket/data');
            expect(data.status).toBe(404);
        }
    });
});

describe('before Selection Sunday', () => {
    test('no NCAA rows: the bracket date, the outlook and the league\'s own pay table', async () => {
        await ScoringConfig.create({ league: HOOPS, model: 'hoops', values: { ncaaR64: 11, seedUpsetBonus: 2 } });
        const res = await request(appAs(['Admin'], { accountId: ann._id })).get('/hoops/bracket/data');
        expect(res.status).toBe(200);
        expect(res.body.state).toBe('pre');
        expect(res.body.dates.selection).toBe('2027-03-14');
        // The league's config, not the defaults.
        expect(res.body.pay.rungs.find(r => r.key === 'r64').points).toBe(11);
        expect(res.body.pay.upsetPerSeed).toBe(2);
        // Ann's own teams, best chance first, each a probability.
        expect(res.body.outlook.mine).toBe(true);
        expect(res.body.outlook.teams.map(t => t.id)).toEqual([1, 9]);
        res.body.outlook.teams.forEach(t => { expect(t.field).toBeGreaterThan(0); expect(t.field).toBeLessThanOrEqual(1); });
    });

    test('an Admin with no team in the league sees the league\'s teams with owners', async () => {
        const res = await request(appAs(['Admin'], { accountId: cal._id })).get('/hoops/bracket/data');
        expect(res.body.outlook.mine).toBe(false);
        expect(res.body.outlook.teams.map(t => t.id).sort((a, b) => a - b)).toEqual([1, 9, 12]);
        expect(res.body.outlook.teams.find(t => t.id === 12).owner.name).toBe('Bob Squad');
    });
});

describe('the points are the banked ones', () => {
    test("each owned team's points are its owner's banked rows for those games", async () => {
        await seedTournament();
        const res = await request(appAs(['Admin'], { accountId: ann._id })).get('/hoops/bracket/data');
        expect(res.status).toBe(200);
        const t = res.body.teams;
        expect(t[1].points).toBe(await bankedFor(ann._id, 1));
        expect(t[9].points).toBe(await bankedFor(ann._id, 9));
        expect(t[12].points).toBe(await bankedFor(bob._id, 12));
        // And those are the default ladder: 1 seed played r64 + r32; the 9
        // played r64 (+1 upset) and r32; the 12 played r64 (+7 upset).
        expect(t[1].points).toBe(7 + 9);
        expect(t[9].points).toBe(7 + 1 + 9);
        expect(t[12].points).toBe(7 + 7);
        // Unowned teams carry no points.
        expect(t[5].points).toBeNull();
        // The viewer's March.
        expect(res.body.summary).toEqual({ field: 2, alive: 1, points: 16 + 17 });
        expect(t[1].owner.isMe).toBe(true);
        expect(t[12].owner.isMe).toBe(false);
    });

    test('a config changed after the games were banked does not move them', async () => {
        await seedTournament();
        await ScoringConfig.create({ league: HOOPS, model: 'hoops', values: { ncaaR64: 100 } });
        const res = await request(appAs(['Admin'], { accountId: ann._id })).get('/hoops/bracket/data');
        const one = res.body.teams[1];
        expect(one.points).toBe(16);
        expect(one.points).toBe(await bankedFor(ann._id, 1));
        // The sheet shows what the rules say now beside what was paid.
        const r64 = one.games.find(g => g.round === 'r64');
        expect(r64.banked).toBe(7);
        expect(r64.rulesTotal).toBe(100);
        // And the pay table is the league's current config.
        expect(res.body.pay.rungs.find(r => r.key === 'r64').points).toBe(100);
    });

    // Only the CURRENT owner's rows count. A team dropped by Ann and picked
    // up by Bob after its games were banked keeps those rows on Ann, and the
    // page must neither credit Bob with them nor call them unbanked.
    test("a team's rows banked to a former owner are not the new owner's", async () => {
        await seedTournament();
        await Franchise.updateOne({ accountId: ann._id, league: HOOPS, 'seasons.season': SEASON }, { $set: { 'seasons.$.teamRefs': refs(1) } });
        await Franchise.updateOne({ accountId: bob._id, league: HOOPS, 'seasons.season': SEASON }, { $set: { 'seasons.$.teamRefs': refs(12, 9) } });
        expect(await bankedFor(ann._id, 9)).toBe(17);
        const res = await request(appAs(['Admin'], { accountId: ann._id })).get('/hoops/bracket/data');
        const nine = res.body.teams[9];
        expect(nine.owner.franchise).toBe('Bob Squad');
        expect(nine.points).toBe(0);
        expect(nine.games.every(g => g.banked === null && g.bankedElsewhere)).toBe(true);
        expect(res.body.summary).toEqual({ field: 1, alive: 1, points: 16 });
    });

    test('the region view puts each game in its seed slot', async () => {
        await seedTournament();
        const res = await request(appAs(['Admin'], { accountId: ann._id })).get('/hoops/bracket/data');
        const south = res.body.regions.South;
        expect(south.r64).toHaveLength(8);
        expect(south.r64[0].winner).toBe(1);   // 1 v 16
        expect(south.r64[1].winner).toBe(9);   // 8 v 9
        expect(south.r64[2].winner).toBe(12);  // 5 v 12
        expect(south.r32[0].winner).toBe(1);
        // 12's next game is not on file yet: its slot names the 12 and leaves
        // the other side to come.
        expect(south.r32[1].a).toEqual({ id: 12, seed: 12, score: null });
        expect(south.r32[1].b).toBeNull();
    });

    test('a season with no league franchise shows the bracket without owners', async () => {
        await seedTournament();
        await HoopsGame.create({ ...game('1st Round', 'East', [1, 1], [16, 16]), id: 9999, season: 2026 });
        const res = await request(appAs(['Admin'], { accountId: ann._id })).get('/hoops/bracket/data?season=2026');
        expect(res.body.season).toBe(2026);
        expect(res.body.seasons).toEqual([2027, 2026]);
        expect(res.body.teams[1].owner).toBeNull();
        expect(res.body.summary.points).toBe(0);
    });
});

// The nav link, rendered through the real partial. Admin only, and only on a
// basketball league — the slot the CFP bracket link takes on football.
describe('the March Madness nav link', () => {
    const ejs = require('ejs');
    const fs = require('fs');
    const NAVBAR = path.join(__dirname, '..', 'views', 'partials', 'navbar.ejs');
    const template = fs.readFileSync(NAVBAR, 'utf8');
    const render = (role, viewerSport) => ejs.render(template, {
        user: { userId: 'u1', firstName: 'Garrett', role }, viewerSport
    }, { filename: NAVBAR });
    const ROLES = ['Admin', 'League Manager', 'Member', ''];

    test('exactly one role sees it, and only on basketball', () => {
        expect(ROLES.filter(r => render(r, 'basketball').includes('href="/hoops/bracket"'))).toEqual(['Admin']);
        expect(ROLES.filter(r => render(r, 'football').includes('/hoops/bracket'))).toEqual([]);
        expect(render('Admin', undefined)).not.toContain('/hoops/bracket');
    });
});
