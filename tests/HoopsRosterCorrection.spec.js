// Correct a Roster on a basketball league (#561), and the football bug the
// issue's comment found on the way: the PATCH loaded the manager's franchise
// unscoped.
//
// One ACCOUNT, two franchises with separate ids: football (2026), created
// FIRST, and basketball (2027). Team ids collide across sports — football 4
// is "Football Four", basketball 4 is "Hoops Four" — so a correction that
// reads the wrong collection writes a real, wrong team rather than failing.
//
// The Admin views their own football league; the card names the league it
// manages in the body.

jest.mock('web-push', () => ({ setVapidDetails: jest.fn(), sendNotification: jest.fn() }));

const express = require('express');
const request = require('supertest');
const { useMongo } = require('./helpers/mongo');
const Account = require('../models/account');
const Franchise = require('../models/franchise');
const League = require('../models/league');
const SportSeason = require('../models/sportSeason');
const Team = require('../models/team');
const HoopsTeam = require('../models/hoopsTeam');
const HoopsGame = require('../models/hoopsGame');
const Draft = require('../models/draft');
const AuditLog = require('../models/auditLog');
const seasons = require('../modules/active-season');
const usersRouter = require('../routes/users');
const { scoreHoopsWeek } = require('../modules/hoops-scoring-pass');

useMongo();

const HOOPS = 'hoops-league';
const FOOTBALL = 'graham-league';
const HOOPS_SEASON = 2027;
const FOOTBALL_SEASON = 2026;

function fullTeam(id, school) {
    return {
        id, school, mascot: 'M', abbreviation: school.slice(0, 3).toUpperCase(),
        conference: 'Big Ten', color: '#000', logos: [`${school}.png`],
        location: { venue_id: id, name: 'V', city: 'C', state: 'ST', zip: '1', latitude: 1, longitude: 1, capacity: 100, grass: true, dome: false }
    };
}
const refs = (...ids) => ids.map(id => ({ id, sport: 'basketball' }));

let ann, bob, annFootball, annHoops;

function appAs(roles, league = 'gg') {
    const app = express();
    app.use(express.json());
    app.use((req, res, next) => {
        req.oidc = { isAuthenticated: () => true, user: { user_metadata: { roles, metadata: { league } } } };
        next();
    });
    app.use('/users', usersRouter);
    return app;
}
const correct = (body, { viewing = FOOTBALL, roles = ['Admin'], id = ann._id } = {}) => request(appAs(roles))
    .patch(`/users/${id}/roster-team`).set('Cookie', `cc_league=${viewing}`).send(body);
const doc = (f) => Franchise.findById(f._id).lean();

async function createFootballFranchise() {
    return Franchise.create({ accountId: ann._id, league: FOOTBALL,
        seasons: [{ season: FOOTBALL_SEASON, teams: [fullTeam(1, 'Football One'), fullTeam(2, 'Football Two')] }] });
}

beforeEach(async () => {
    await League.create([
        { code: FOOTBALL, name: 'Graham League', sport: 'football' },
        { code: HOOPS, name: 'Hardwood Heroes', sport: 'basketball' }
    ]);
    await SportSeason.create([
        { sport: 'football', season: FOOTBALL_SEASON, status: 'in-season' },
        { sport: 'basketball', season: HOOPS_SEASON, status: 'in-season' }
    ]);
    await seasons.prime();

    ann = await Account.create({ firstName: 'Ann', lastName: 'Two', email: 'ann@example.invalid' });
    bob = await Account.create({ firstName: 'Bob', lastName: 'One', email: 'bob@example.invalid' });
    // Football FIRST — see the header.
    annFootball = await createFootballFranchise();
    annHoops = await Franchise.create({ accountId: ann._id, league: HOOPS,
        seasons: [{ season: HOOPS_SEASON, teamRefs: refs(1, 2) }] });
    await Franchise.create({ accountId: bob._id, league: HOOPS, seasons: [{ season: HOOPS_SEASON, teamRefs: refs(3) }] });

    await Team.create([fullTeam(1, 'Football One'), fullTeam(2, 'Football Two'), fullTeam(4, 'Football Four'),
        fullTeam(6, 'Football Six'), fullTeam(9, 'Football Nine')]);
    await HoopsTeam.create([1, 2, 3, 4, 5].map(id => ({
        id, season: HOOPS_SEASON, school: ['', 'Hoops One', 'Hoops Two', 'Hoops Three', 'Hoops Four', 'Hoops Five'][id],
        conference: 'Big East', logos: [`hoops${id}.png`], preseason: { rank: id * 10 }
    })));
    // A basketball draft pick holds the HoopsTeam row, as the draft room stores it.
    // The pool is capped at 4: team 5 (ranked 50th) was never on the board.
    await Draft.create({ league: HOOPS, season: HOOPS_SEASON, poolSize: 4, draftOrder: [ann._id, bob._id], picks: [
        { round: 1, overall: 1, userId: ann._id, team: { id: 1, season: HOOPS_SEASON, school: 'Hoops One' } },
        { round: 1, overall: 2, userId: bob._id, team: { id: 3, season: HOOPS_SEASON, school: 'Hoops Three' } },
        { round: 2, overall: 3, userId: ann._id, team: { id: 2, season: HOOPS_SEASON, school: 'Hoops Two' } }
    ] });
    jest.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => { seasons._reset(); jest.restoreAllMocks(); });

describe('PATCH /users/:id/roster-team on a basketball league', () => {
    test("swaps the REF on the basketball franchise, in the league's own season", async () => {
        // No season sent: football's would be 2026, which this franchise lacks.
        const res = await correct({ league: HOOPS, fromTeamId: 1, toTeamId: 4 });
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ season: String(HOOPS_SEASON), sport: 'basketball',
            from: { id: 1, school: 'Hoops One' }, to: { id: 4, school: 'Hoops Four', logo: 'hoops4.png' } });

        // Still refs, in roster order — no team copy written onto the roster.
        const season = (await doc(annHoops)).seasons[0];
        expect(season.teamRefs).toEqual(refs(4, 2));
        expect(season.teams || []).toEqual([]);
        // The football franchise is untouched.
        expect((await doc(annFootball)).seasons[0].teams.map(t => t.school)).toEqual(['Football One', 'Football Two']);
    });

    test("rewrites the draft pick with basketball's team, not football's same-numbered one", async () => {
        const res = await correct({ league: HOOPS, fromTeamId: 1, toTeamId: 4 });
        expect(res.body.draftUpdated).toBe(true);
        const draft = await Draft.findOne({ league: HOOPS }).lean();
        expect(draft.picks.map(p => p.team.school)).toEqual(['Hoops Four', 'Hoops Three', 'Hoops Two']);
        expect(draft.picks[0].team).toMatchObject({ id: 4, season: HOOPS_SEASON, conference: 'Big East' });
        expect(draft.picks[0].team._id).toBeUndefined();

        const row = await AuditLog.findOne({ action: 'roster.correct' }).lean();
        expect(row).toMatchObject({ league: HOOPS, season: String(HOOPS_SEASON), summary: 'Ann Two: Hoops One → Hoops Four (draft record too)' });
    });

    test('a team only football has is not a basketball replacement', async () => {
        const res = await correct({ league: HOOPS, fromTeamId: 1, toTeamId: 6 });
        expect(res.status).toBe(404);
        expect(res.body.message).toBe('Could not find the replacement team.');
        expect((await doc(annHoops)).seasons[0].teamRefs).toEqual(refs(1, 2));
    });

    test("a team outside the league's draft pool is refused, by name", async () => {
        const res = await correct({ league: HOOPS, fromTeamId: 1, toTeamId: 5 });
        expect(res.status).toBe(422);
        expect(res.body.message).toBe("Hoops Five isn't in this league's draft pool.");
        expect((await doc(annHoops)).seasons[0].teamRefs).toEqual(refs(1, 2));
    });

    test("another basketball manager's team is taken", async () => {
        const res = await correct({ league: HOOPS, fromTeamId: 1, toTeamId: 3 });
        expect(res.status).toBe(409);
        expect(res.body.message).toBe('Hoops Three is already on Bob One\'s roster.');
    });

    test("a team on the manager's own basketball roster is a duplicate", async () => {
        const res = await correct({ league: HOOPS, fromTeamId: 1, toTeamId: 2 });
        expect(res.status).toBe(409);
        // Named off the basketball roster — football's team 2 is someone else.
        expect(res.body.message).toBe('That manager already has Hoops Two.');
    });

    test('with no league sent, the viewed basketball league decides', async () => {
        const res = await correct({ fromTeamId: 1, toTeamId: 4 }, { viewing: HOOPS });
        expect(res.status).toBe(200);
        expect((await doc(annHoops)).seasons[0].teamRefs).toEqual(refs(4, 2));
    });

    test("viewing a league is not authority over it: football's League Manager can't correct basketball", async () => {
        const res = await correct({ league: HOOPS, fromTeamId: 1, toTeamId: 4 },
            { viewing: HOOPS, roles: ['League Manager'] });
        expect(res.status).toBe(403);
        expect((await doc(annHoops)).seasons[0].teamRefs).toEqual(refs(1, 2));
        expect((await doc(annFootball)).seasons[0].teams.map(t => t.id)).toEqual([1, 2]);
    });

    test("the next scoring pass scores the corrected roster", async () => {
        // Week 3: team 1 (corrected away) and team 4 (corrected in) both win
        // at home. The pass re-reads rosters, so only team 4 should score.
        const final = (id, homeId) => ({
            id, season: HOOPS_SEASON, week: 3, seasonType: 'regular', status: 'final',
            startDate: new Date('2026-11-20'), homeTeamId: homeId, awayTeamId: 5,
            homePoints: 80, awayPoints: 70, homeWinner: true, awayWinner: false,
            neutralSite: false, conferenceGame: false
        });
        await HoopsGame.create([final(901, 1), final(902, 4)]);
        expect((await correct({ league: HOOPS, fromTeamId: 1, toTeamId: 4 })).status).toBe(200);

        await scoreHoopsWeek(HOOPS, { season: HOOPS_SEASON, week: 3 });
        const wk = (await doc(annHoops)).seasons[0].weeklyScore.find(w => w.week === 3);
        expect(wk.scoreByTeam.map(s => s.teamId)).toEqual([4]);
    });
});

describe('PATCH /users/:id/roster-team on football, for a manager in both sports', () => {
    beforeEach(async () => {
        // Basketball first in natural order this time: what an unscoped
        // findOne({ accountId }) hands back is then the WRONG franchise.
        await Franchise.deleteOne({ _id: annFootball._id });
        annFootball = await createFootballFranchise();
    });

    test('a football correction loads the football franchise', async () => {
        const res = await correct({ league: FOOTBALL, fromTeamId: 2, toTeamId: 9 }, { viewing: HOOPS });
        expect(res.status).toBe(200);
        expect(res.body.season).toBe(String(FOOTBALL_SEASON));
        expect((await doc(annFootball)).seasons[0].teams.map(t => t.school)).toEqual(['Football One', 'Football Nine']);
        expect((await doc(annHoops)).seasons[0].teamRefs).toEqual(refs(1, 2));
    });

    test('two franchises and no league to tell them apart: refused, nothing written', async () => {
        await League.create({ code: 'claunts-league', name: 'Claunts', sport: 'football' });
        const res = await correct({ fromTeamId: 2, toTeamId: 9 }, { viewing: 'claunts-league' });
        expect(res.status).toBe(400);
        expect((await doc(annFootball)).seasons[0].teams.map(t => t.id)).toEqual([1, 2]);
    });
});

describe('GET /users/league/:league/roster-teams on a basketball league', () => {
    test("rosters and replacements come from hoopsteams, in the league's own season", async () => {
        const res = await request(appAs(['Admin'])).get(`/users/league/${HOOPS}/roster-teams`);
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ league: HOOPS, sport: 'basketball', season: String(HOOPS_SEASON) });
        const annRow = res.body.managers.find(m => m.name === 'Ann Two');
        expect(annRow.teams).toEqual([
            { id: 1, school: 'Hoops One', logo: 'hoops1.png' },
            { id: 2, school: 'Hoops Two', logo: 'hoops2.png' }
        ]);
        // The draft pool (capped at 4) minus what is held — none of football's,
        // and not team 5, which was never on the board.
        expect(res.body.available.map(t => t.school)).toEqual(['Hoops Four']);
    });

    test("commissioners only — and viewing basketball doesn't make football's League Manager one", async () => {
        const lm = await request(appAs(['League Manager'])).get(`/users/league/${HOOPS}/roster-teams`)
            .set('Cookie', `cc_league=${HOOPS}`);
        expect(lm.status).toBe(403);
        const member = await request(appAs([])).get(`/users/league/${FOOTBALL}/roster-teams`);
        expect(member.status).toBe(403);
        // Their own league, they may.
        const own = await request(appAs(['League Manager'])).get(`/users/league/${FOOTBALL}/roster-teams`);
        expect(own.status).toBe(200);
    });

    test('football is unchanged: its rosters and the FBS pool', async () => {
        const res = await request(appAs(['Admin'])).get(`/users/league/${FOOTBALL}/roster-teams`);
        expect(res.body).toMatchObject({ sport: 'football', season: String(FOOTBALL_SEASON) });
        expect(res.body.managers[0].teams.map(t => t.school)).toEqual(['Football One', 'Football Two']);
        expect(res.body.available.map(t => t.school)).toEqual(['Football Four', 'Football Nine', 'Football Six']);
    });
});
