// The basketball team page's data (#494): modules/hoops-team-page.js, the
// GET /hoops/teams/:id/page route over it, and the nightly stats import.
//
// The interesting behaviour is the quadrant each game carries — it must be
// the one the scoring engine BANKED (the opponent's rank in that week,
// crossed with the venue), or the team sheet and the manager's points tell
// two different stories.

const express = require('express');
const request = require('supertest');
const { useMongo } = require('./helpers/mongo');
const teamPage = require('../modules/hoops-team-page');
const hoopsStats = require('../modules/hoops-stats');
const statsJob = require('../modules/hoops-stats-job');
const cbbd = require('../modules/cbbd-client');
const jobLogger = require('../modules/job-logger');
const leagueSelection = require('../modules/league-selection');
const HoopsGame = require('../models/hoopsGame');
const HoopsTeam = require('../models/hoopsTeam');
const HoopsTeamStats = require('../models/hoopsTeamStats');
const Franchise = require('../models/franchise');
const Account = require('../models/account');
const League = require('../models/league');
const SportSeason = require('../models/sportSeason');
const ScoringConfig = require('../models/scoringConfig');
const seasons = require('../modules/active-season');

useMongo();

const LEAGUE = 'hoops-league';
const SEASON = 2027;

// Duke (1) and three opponents. Florida is #4, so a road win there is Q1;
// Army is #358, Q4 anywhere. UNC shares Duke's conference.
const TEAMS = [
    { id: 1, school: 'Duke', conference: 'ACC', color: '#013088', logos: ['https://x/duke.png'],
        preseason: { rank: 1, adjOE: 120, adjDE: 90, barthag: 0.96, projectedRecord: '26-6' } },
    { id: 2, school: 'Florida', abbreviation: 'FLA', conference: 'SEC', preseason: { rank: 4, adjOE: 118, adjDE: 92 } },
    { id: 3, school: 'Army', conference: 'Patriot', preseason: { rank: 358, adjOE: 95, adjDE: 110 } },
    { id: 4, school: 'North Carolina', conference: 'ACC', preseason: { rank: 44, adjOE: 121, adjDE: 100 } }
];

const game = (id, week, homeId, awayId, o = {}) => Object.assign({
    id, season: SEASON, week, seasonType: 'regular', status: 'final',
    startDate: new Date(Date.UTC(2026, 10, 3 + week * 7)),
    homeTeamId: homeId, awayTeamId: awayId, homePoints: 80, awayPoints: 70,
    neutralSite: false, conferenceGame: false
}, o);

beforeEach(async () => {
    teamPage.clearRankCache();
    await League.create({ code: LEAGUE, name: 'Hardwood Heroes', sport: 'basketball' });
    await SportSeason.create([
        { sport: 'football', season: 2026, status: 'in-season' },
        { sport: 'basketball', season: SEASON, status: 'in-season' }
    ]);
    await seasons.prime();
    await HoopsTeam.create(TEAMS.map(t => Object.assign({ season: SEASON }, t)));
});
afterEach(() => { seasons._reset(); jest.restoreAllMocks(); });

async function owner(teamIds, weeklyScore = []) {
    const a = await Account.create({ firstName: 'Garrett', lastName: 'G', email: 'g@example.invalid' });
    await Franchise.create({
        accountId: a._id, league: LEAGUE,
        seasons: [{ season: SEASON, franchiseName: 'Hoop Dreams',
            teamRefs: teamIds.map(id => ({ id, sport: 'basketball' })), weeklyScore }]
    });
}

describe('build', () => {
    test('each game carries the quadrant scoring banked: that week\'s rank, crossed with the venue', async () => {
        await HoopsGame.create([
            game(10, 1, 2, 1, { homePoints: 62, awayPoints: 74 }),   // Duke WINS AT #4 Florida: road Q1
            game(11, 1, 1, 3),                                         // Duke hosts #358 Army: Q4
            game(12, 2, 1, 2, { neutralSite: true })                   // neutral vs #4: Q1
        ]);
        const p = await teamPage.build(1, { season: SEASON });
        const byId = Object.fromEntries(p.games.map(g => [g.id, g]));
        expect(byId[10]).toMatchObject({ venue: 'away', quadrant: 1, us: 74, them: 62, final: true });
        expect(byId[10].opponent).toMatchObject({ id: 2, school: 'Florida', abbreviation: 'FLA', rank: 4, hasPage: true });
        expect(byId[11]).toMatchObject({ venue: 'home', quadrant: 4 });
        expect(byId[12]).toMatchObject({ venue: 'neutral', quadrant: 1 });
    });

    test('rank is the opponent\'s in THAT week — a team that has since fallen keeps its banked quadrant', async () => {
        const HoopsRating = require('../models/hoopsRating');
        // Florida is #4 preseason but a dreadful #300 by the live week-9
        // rating. Week 1 must still read the preseason rank.
        await HoopsRating.create([
            ...TEAMS.map(t => ({ season: SEASON, week: 9, teamId: t.id, rank: t.id === 2 ? 300 : t.preseason.rank, source: 'cbbd-adjusted' }))
        ]);
        await HoopsGame.create([game(10, 1, 2, 1, { homePoints: 62, awayPoints: 74 })]);
        const p = await teamPage.build(1, { season: SEASON });
        expect(p.games[0].quadrant).toBe(1);
    });

    test('a game still to play is quadranted against the latest PLAYED week, not a future one', async () => {
        await HoopsGame.create([
            game(10, 1, 1, 3),
            game(20, 9, 2, 1, { status: 'scheduled', homePoints: null, awayPoints: null })
        ]);
        const p = await teamPage.build(1, { season: SEASON });
        const up = p.games.find(g => g.id === 20);
        expect(up).toMatchObject({ final: false, us: null, them: null, points: null, quadrant: 1 });
    });

    // Scoring pays an NCAA/NIT game on the tournament ladder and never as a
    // quadrant win (isRegular in hoops-detectors). The page must not put it
    // on the team sheet as if it were one.
    test('a postseason game has no quadrant; a conference tournament game keeps one', async () => {
        await HoopsGame.create([
            game(10, 20, 1, 2, { seasonType: 'postseason', neutralSite: true, tournament: 'NCAA', gameNotes: "Men's Basketball Championship - 1st Round" }),
            game(11, 19, 1, 4, { neutralSite: true, gameNotes: 'ACC Tournament - Final' })
        ]);
        const p = await teamPage.build(1, { season: SEASON });
        const byId = Object.fromEntries(p.games.map(g => [g.id, g]));
        expect(byId[10]).toMatchObject({ quadrant: null, postseason: true, tournament: 'NCAA' });
        expect(byId[11]).toMatchObject({ quadrant: 1, postseason: false, tournament: null });   // #44 at a neutral site
    });

    test('a tie or a missing score is not a result', async () => {
        await HoopsGame.create([
            game(10, 1, 1, 3, { homePoints: 70, awayPoints: 70 }),
            game(11, 1, 1, 2, { homePoints: null })
        ]);
        const p = await teamPage.build(1, { season: SEASON });
        expect(p.games.every(g => !g.final)).toBe(true);
    });

    test('preseason efficiency ranks: offense higher-is-better, defense lower-is-better', async () => {
        const p = await teamPage.build(1, { season: SEASON });
        // adjOE 120 is behind UNC's 121; adjDE 90 is the best of the four.
        expect(p.preseason).toMatchObject({ rank: 1, oeRank: 2, deRank: 1, ratedTeams: 4, projectedRecord: '26-6' });
    });

    test('a team with no preseason numbers has no preseason block', async () => {
        await HoopsTeam.create({ id: 9, season: SEASON, school: 'Nowhere', conference: 'X' });
        expect((await teamPage.build(9, { season: SEASON })).preseason).toBeNull();
    });

    test('conference standings: conference record first, overall from the same games', async () => {
        await HoopsGame.create([
            game(10, 1, 1, 4, { conferenceGame: true }),                           // Duke beats UNC (conf)
            game(11, 1, 4, 3),                                                     // UNC beats Army (non-conf)
            game(12, 2, 4, 1, { conferenceGame: true, status: 'scheduled' })      // not played
        ]);
        const p = await teamPage.build(1, { season: SEASON });
        expect(p.standings.map(r => [r.school, r.confW, r.confL, r.w, r.l])).toEqual([
            ['Duke', 1, 0, 1, 0],
            ['North Carolina', 0, 1, 1, 1]
        ]);
    });

    test('a 0-1 conference team sorts BELOW the teams yet to play one', async () => {
        await HoopsTeam.create({ id: 5, season: SEASON, school: 'Boston College', conference: 'ACC' });
        await HoopsGame.create([
            game(10, 1, 1, 5, { conferenceGame: true }),                           // Duke beats BC
            game(11, 1, 5, 3), game(12, 1, 5, 2)                                   // BC 2-0 out of conference
        ]);
        const p = await teamPage.build(1, { season: SEASON });
        expect(p.standings.map(r => r.school)).toEqual(['Duke', 'North Carolina', 'Boston College']);
    });

    // CBBD files conference tournament games as regular-season conference
    // games. Counting them would add a team's tournament run to its league
    // record every March.
    test('conference TOURNAMENT games are not conference record', async () => {
        await HoopsGame.create([
            game(10, 1, 1, 4, { conferenceGame: true }),                                                      // league game
            game(11, 18, 4, 1, { conferenceGame: true, neutralSite: true, gameNotes: 'ACC Tournament - Quarterfinal', homePoints: 90, awayPoints: 60 }),
            game(12, 19, 4, 1, { conferenceGame: true, neutralSite: true, gameNotes: "ACC Men's Basketball Championship - Final", homePoints: 90, awayPoints: 60 })
        ]);
        const p = await teamPage.build(1, { season: SEASON });
        const row = (school) => p.standings.find(r => r.school === school);
        expect(row('Duke')).toMatchObject({ confW: 1, confL: 0, w: 1, l: 2 });        // tournament losses count overall only
        expect(row('North Carolina')).toMatchObject({ confW: 0, confL: 1, w: 2, l: 1 });
        const byId = Object.fromEntries(p.games.map(g => [g.id, g]));
        expect(byId[10]).toMatchObject({ conferenceGame: true, conferenceTournament: false });
        expect(byId[12]).toMatchObject({ conferenceGame: false, conferenceTournament: true, quadrant: 1 });
    });

    test('isConfTournament: a named tournament (NCAA/NIT) is never a conference tournament', () => {
        expect(teamPage.isConfTournament({ conferenceGame: true, gameNotes: 'America East Playoffs - Final' })).toBe(true);
        expect(teamPage.isConfTournament({ conferenceGame: true, tournament: 'NIT', gameNotes: 'NIT - Championship' })).toBe(false);
        expect(teamPage.isConfTournament({ conferenceGame: false, gameNotes: 'Tournament' })).toBe(false);
        expect(teamPage.isConfTournament({ conferenceGame: true })).toBe(false);
    });

    // Scoring's rosterIds falls back to embedded teams when a season has no
    // refs; the page must name the owner whenever scoring pays one.
    test('an owner whose roster is embedded teams (no refs) is still found', async () => {
        const a = await Account.create({ firstName: 'Ann', lastName: 'A', email: 'a@example.invalid' });
        await Franchise.collection.insertOne({
            accountId: a._id, league: LEAGUE,
            seasons: [{ season: SEASON, franchiseName: 'Old Shape', teams: [{ id: 1, school: 'Duke' }], weeklyScore: [] }]
        });
        expect((await teamPage.build(1, { season: SEASON, league: LEAGUE })).owner).toMatchObject({ franchiseName: 'Old Shape' });
    });

    test('an opponent with no basketball team row is marked as having no page', async () => {
        await HoopsGame.create([game(10, 1, 1, 9999, { awayTeam: 'Division II College' })]);
        const p = await teamPage.build(1, { season: SEASON });
        expect(p.games[0].opponent).toMatchObject({ id: 9999, school: 'Division II College', hasPage: false });
    });

    test('no league: no owner, no point values — the page still renders', async () => {
        const p = await teamPage.build(1, { season: SEASON });
        expect(p.owner).toBeNull();
        expect(p.quadrantValues).toBeNull();
    });

    test('in a league: who rosters the team, what each game banked, and this league\'s point values', async () => {
        await owner([1], [{ week: 1, score: 5, scoreByTeam: [{ teamId: 1, gameId: 10, score: 5 }, { teamId: 3, gameId: 10, score: 9 }] }]);
        // Raw insert: the ScoringConfig schema's model enum is football-only
        // ('claunts'/'graham'), so a basketball config cannot go through create().
        await ScoringConfig.collection.insertOne({ league: LEAGUE, model: 'hoops', values: { q1Win: 7 }, disabled: [], enabled: [] });
        await HoopsGame.create([game(10, 1, 2, 1, { homePoints: 62, awayPoints: 74 })]);
        const p = await teamPage.build(1, { season: SEASON, league: LEAGUE });
        expect(p.owner).toEqual({ franchiseName: 'Hoop Dreams', firstName: 'Garrett' });
        expect(p.games[0].points).toBe(5);              // its own row, not team 3's
        expect(p.quadrantValues).toMatchObject({ 1: 7, 2: 3, 3: 1, 4: 0 });
    });

    test('a team nobody rosters has no owner', async () => {
        await owner([3]);
        expect((await teamPage.build(1, { season: SEASON, league: LEAGUE })).owner).toBeNull();
    });

    test('a rescheduled game\'s stale listing drops off the schedule once the real one is final (#498)', async () => {
        await HoopsGame.create([
            game(10, 1, 1, 3),                                                        // played
            game(11, 1, 1, 3, { status: 'scheduled', homePoints: null, awayPoints: null,
                startDate: new Date(Date.UTC(2026, 10, 11)) }),                       // old listing, never tips
            game(12, 9, 1, 2, { status: 'scheduled', homePoints: null, awayPoints: null })   // a real game to come
        ]);
        const p = await teamPage.build(1, { season: SEASON, now: Date.UTC(2026, 10, 30) });
        expect(p.games.map(x => x.id)).toEqual([10, 12]);
    });

    // #502: score a week, then the ratings move (a late weekly row, a
    // re-imported preseason). The page shows what was PAID.
    test('a scored game shows the quadrant it was banked at, not today\'s', async () => {
        await HoopsGame.create([game(11, 1, 1, 3)]);                  // vs #358 Army at home: Q4 by today's ranks
        // Stored quadrant and rank deliberately disagree (#60 at home is Q2):
        // the page must read the stored quadrant, not re-derive it from the
        // stored rank, or this test could not tell the two apart.
        await owner([1], [{ week: 1, score: 5, scoreByTeam: [{ teamId: 1, gameId: 11, score: 5, quadrant: 1, oppRank: 60 }] }]);
        const g = (await teamPage.build(1, { season: SEASON, league: LEAGUE })).games.find(x => x.id === 11);
        expect(g.quadrant).toBe(1);
        expect(g.opponent.rank).toBe(60);
        expect(g.points).toBe(5);
    });

    test('a row scored before quadrants were stored is worked out as before', async () => {
        await HoopsGame.create([game(11, 1, 1, 3)]);
        await owner([1], [{ week: 1, score: 0, scoreByTeam: [{ teamId: 1, gameId: 11, score: 0 }] }]);
        const g = (await teamPage.build(1, { season: SEASON, league: LEAGUE })).games.find(x => x.id === 11);
        expect(g.quadrant).toBe(4);
        expect(g.opponent.rank).toBe(358);
    });

    test('a banked postseason game keeps its null quadrant', async () => {
        await HoopsGame.create([game(11, 1, 1, 3, { seasonType: 'postseason', tournament: 'NIT' })]);
        await owner([1], [{ week: 1, score: 7, scoreByTeam: [{ teamId: 1, gameId: 11, score: 7, quadrant: null, oppRank: 358 }] }]);
        const g = (await teamPage.build(1, { season: SEASON, league: LEAGUE })).games.find(x => x.id === 11);
        expect(g.quadrant).toBeNull();
    });

    test('unknown team, or no season: null', async () => {
        expect(await teamPage.build(999, { season: SEASON })).toBeNull();
        expect(await teamPage.build(1, {})).toBeNull();
    });

    test('a week\'s ranks are read once and then served from the cache', async () => {
        const HoopsRating = require('../models/hoopsRating');
        await HoopsGame.create([game(10, 1, 1, 3)]);
        await teamPage.build(1, { season: SEASON });
        const find = jest.spyOn(HoopsRating, 'find');
        await teamPage.build(1, { season: SEASON });
        expect(find).not.toHaveBeenCalled();
        teamPage.clearRankCache();
        await teamPage.build(1, { season: SEASON });
        expect(find).toHaveBeenCalled();
    });
});

describe('GET /hoops/teams/:id/page', () => {
    const app = express();
    app.use('/hoops/teams', require('../routes/hoopsTeams'));
    // Most of these are about the page; the viewer is in the basketball
    // league unless a test says otherwise.
    beforeEach(() => { jest.spyOn(leagueSelection, 'viewableBy').mockResolvedValue([LEAGUE, 'graham-league']); });

    // The league is unannounced, and EXISTENCE counts: someone in no
    // basketball league must not learn there is any basketball at all.
    test('a viewer in no basketball league gets a plain 404', async () => {
        leagueSelection.viewableBy.mockResolvedValue(['graham-league']);
        jest.spyOn(leagueSelection, 'selectedLeague').mockResolvedValue('graham-league');
        const res = await request(app).get('/hoops/teams/1/page');
        expect(res.status).toBe(404);
        expect(res.body).toEqual({ message: 'Not found' });
    });

    test('a failed visibility check refuses rather than reveals', async () => {
        leagueSelection.viewableBy.mockRejectedValue(new Error('M0 hiccup'));
        jest.spyOn(console, 'error').mockImplementation(() => {});
        expect((await request(app).get('/hoops/teams/1/page')).status).toBe(404);
    });

    test('uses the SERVER\'s league selection for ownership — a ?league= is ignored', async () => {
        await owner([1]);
        await HoopsGame.create([game(10, 1, 1, 3)]);
        jest.spyOn(leagueSelection, 'selectedLeague').mockResolvedValue(LEAGUE);
        const res = await request(app).get('/hoops/teams/1/page?league=someone-elses');
        expect(res.status).toBe(200);
        expect(res.body.owner).toMatchObject({ franchiseName: 'Hoop Dreams' });
        expect(res.body.team.school).toBe('Duke');
    });

    test('a basketball member VIEWING a football league gets the page without anyone\'s roster', async () => {
        await owner([1]);
        jest.spyOn(leagueSelection, 'selectedLeague').mockResolvedValue('graham-league');
        const res = await request(app).get('/hoops/teams/1/page');
        expect(res.status).toBe(200);
        expect(res.body.owner).toBeNull();
        expect(res.body.season).toBe(SEASON);
    });

    test('a failed league lookup still serves the page', async () => {
        jest.spyOn(leagueSelection, 'selectedLeague').mockRejectedValue(new Error('M0 hiccup'));
        jest.spyOn(console, 'error').mockImplementation(() => {});
        const res = await request(app).get('/hoops/teams/1/page');
        expect(res.status).toBe(200);
        expect(res.body.owner).toBeNull();
    });

    test('400 for a non-numeric id, 404 for an unknown team', async () => {
        jest.spyOn(leagueSelection, 'selectedLeague').mockResolvedValue('');
        expect((await request(app).get('/hoops/teams/duke/page')).status).toBe(400);
        expect((await request(app).get('/hoops/teams/999/page')).status).toBe(404);
    });

    test('404 when no basketball season is active', async () => {
        jest.spyOn(leagueSelection, 'selectedLeague').mockResolvedValue('');
        jest.spyOn(seasons, 'activeSeason').mockReturnValue(null);
        expect((await request(app).get('/hoops/teams/1/page')).status).toBe(404);
    });

    test('500 with a plain message when the build throws', async () => {
        jest.spyOn(leagueSelection, 'selectedLeague').mockResolvedValue('');
        jest.spyOn(teamPage, 'build').mockRejectedValue(new Error('boom'));
        jest.spyOn(console, 'error').mockImplementation(() => {});
        const res = await request(app).get('/hoops/teams/1/page');
        expect(res.status).toBe(500);
        expect(res.body.message).toBe('Could not load this team');
    });
});

// ---- stats import ---------------------------------------------------------

const teamRow = (teamId, o = {}) => Object.assign({
    teamId, games: 10, wins: 8, losses: 2, pace: 68.2,
    teamStats: { possessions: 680, rating: 118.4, trueShooting: 58.1, assists: 150, steals: 70, blocks: 40,
        fieldGoals: { pct: 48.2, attempted: 600 }, threePointFieldGoals: { pct: 36.0, attempted: 240 },
        freeThrows: { pct: 74.0 }, rebounds: { total: 380 }, points: { total: 800, inPaint: 320, fastBreak: 90 },
        fourFactors: { effectiveFieldGoalPct: 55.1, turnoverRatio: 0.15, offensiveReboundPct: 31.2, freeThrowRate: 34.0 } },
    opponentStats: { rating: 96.0, fieldGoals: { attempted: 0 }, fourFactors: { effectiveFieldGoalPct: 46.0 } }
}, o);
const playerRow = (teamId, name, points, o = {}) => Object.assign({
    teamId, athleteId: points, name, position: 'G', games: 10, starts: 10, minutes: 300, points,
    rebounds: { total: 40 }, assists: 30, steals: 10, blocks: 2,
    threePointFieldGoals: { made: 20, pct: 40.0 }, trueShootingPct: 0.596, usage: 22, netRating: 15,
    winShares: { total: 1.5 }
}, o);

describe('hoops-stats', () => {
    test('keeps only D-I teams, slims the payload, and sorts players by points', () => {
        const ops = hoopsStats.buildOps(SEASON,
            [teamRow(1), teamRow(9999)],                                   // 9999 is not D-I
            [playerRow(1, 'Role Player', 60), playerRow(1, 'Star', 200), playerRow(9999, 'D-II', 300), playerRow(1, '', 10)],
            [1, 2], new Date('2027-01-01'));
        expect(ops).toHaveLength(1);
        const doc = ops[0].updateOne.update.$set;
        expect(ops[0].updateOne.filter).toEqual({ season: SEASON, teamId: 1 });
        expect(doc.players.map(p => p.name)).toEqual(['Star', 'Role Player']);   // nameless row dropped
        expect(doc.team).toMatchObject({ efgPct: 55.1, tovRatio: 0.15, threeRate: 40, rating: 118.4, paintPoints: 320 });
        expect(doc.opponent.threeRate).toBeUndefined();                         // 0 attempts: no rate, not NaN
        expect(doc.players[0]).toMatchObject({ trueShootingPct: 59.6, rebounds: 40, threeMade: 20, winShares: 1.5 });
    });

    // Converted by which field it is, not by size: a player's fraction can
    // pass 1 on a tiny sample, and a "<= 1 is a fraction" guess stored 1.5
    // as 1.5% instead of 150%.
    test('player true shooting is a fraction, ALWAYS converted — even above 1', () => {
        expect(hoopsStats.fractionToPercent(0.546)).toBe(54.6);
        expect(hoopsStats.fractionToPercent(1.5)).toBe(150);
        expect(hoopsStats.fractionToPercent(null)).toBeUndefined();
        expect(hoopsStats.fractionToPercent('n/a')).toBeUndefined();
        expect(hoopsStats.slimPlayer({ name: 'X', trueShootingPct: 1.5 }).trueShootingPct).toBe(150);
    });

    test('team true shooting is already a percent and is left alone', () => {
        expect(hoopsStats.slimTeam({ teamStats: { trueShooting: 0.9 } }).team.trueShooting).toBe(0.9);
    });

    test('a team with players but no team row still gets a document', () => {
        const ops = hoopsStats.buildOps(SEASON, [], [playerRow(2, 'Solo', 50)], [2]);
        expect(ops[0].updateOne.update.$set).toMatchObject({ teamId: 2, players: [expect.objectContaining({ name: 'Solo' })] });
    });

    test('importSeason: two CBBD calls, upserts by (season, team), and a re-run replaces', async () => {
        const get = jest.spyOn(cbbd, 'cbbdGet').mockImplementation(async (path) => (
            path === '/stats/team/season'
                ? { data: [teamRow(1)], remainingCalls: 100 }
                : { data: [playerRow(1, 'Star', 200)], remainingCalls: 99 }));
        const out = await hoopsStats.importSeason(SEASON);
        expect(out).toMatchObject({ season: SEASON, teams: 1, players: 1, remainingCalls: 99 });
        expect(get.mock.calls.map(c => c[0]).sort()).toEqual(['/stats/player/season', '/stats/team/season']);
        expect(get.mock.calls[0][1]).toEqual({ season: SEASON });

        get.mockImplementation(async (path) => (
            path === '/stats/team/season'
                ? { data: [teamRow(1, { wins: 9 })], remainingCalls: null }
                : { data: [], remainingCalls: null }));
        await hoopsStats.importSeason(SEASON);
        const rows = await HoopsTeamStats.find({ season: SEASON }).lean();
        expect(rows).toHaveLength(1);
        expect(rows[0].wins).toBe(9);
    });

    test('importSeason spends no calls when no teams are ingested, and refuses a non-year', async () => {
        const get = jest.spyOn(cbbd, 'cbbdGet');
        expect(await hoopsStats.importSeason(2031)).toMatchObject({ skippedReason: 'no hoops teams ingested' });
        expect(get).not.toHaveBeenCalled();
        await expect(hoopsStats.importSeason('soon')).rejects.toThrow('must be a year');
    });

    test('the page carries the imported stats', async () => {
        jest.spyOn(cbbd, 'cbbdGet').mockImplementation(async (path) => (
            path === '/stats/team/season' ? { data: [teamRow(1)] } : { data: [playerRow(1, 'Star', 200)] }));
        await hoopsStats.importSeason(SEASON);
        const p = await teamPage.build(1, { season: SEASON });
        expect(p.stats).toMatchObject({ games: 10, pace: 68.2, players: [expect.objectContaining({ name: 'Star' })] });
    });
});

describe('hoops-stats job', () => {
    const NOW = new Date(Date.UTC(2026, 10, 12));
    const boxScore = require('../modules/hoops-box-score');

    beforeEach(() => {
        // The box batch has its own tests (HoopsGamePage.spec.js); here it
        // must simply never reach CBBD.
        jest.spyOn(boxScore, 'ingestRecent').mockResolvedValue({ season: SEASON, games: 3, stored: 3 });
        jest.spyOn(jobLogger, 'startRun').mockResolvedValue('run-1');
        jest.spyOn(jobLogger, 'finishRun').mockResolvedValue();
        jest.spyOn(console, 'log').mockImplementation(() => {});
    });

    test('skips, free and silent, when nothing has gone final in three days', async () => {
        const imp = jest.spyOn(hoopsStats, 'importSeason');
        await HoopsGame.create(game(10, 1, 1, 3, { startDate: new Date(Date.UTC(2026, 9, 1)) }));
        expect(await statsJob.run({ now: NOW })).toEqual({ skippedReason: 'no recent results' });
        expect(imp).not.toHaveBeenCalled();
        expect(jobLogger.startRun).not.toHaveBeenCalled();
    });

    test('skips with no basketball league at all', async () => {
        await League.deleteMany({});
        await seasons.prime();
        expect(await statsJob.run({ now: NOW })).toEqual({ skippedReason: 'no basketball leagues' });
    });

    test('imports after recent results, and records the run', async () => {
        jest.spyOn(hoopsStats, 'importSeason').mockResolvedValue({ season: SEASON, teams: 365, players: 5000 });
        await HoopsGame.create(game(10, 1, 1, 3, { startDate: new Date(Date.UTC(2026, 10, 11)) }));
        const out = await statsJob.run({ now: NOW });
        expect(out.summary).toBe(`${SEASON}: 365 team(s), 5000 player(s) | ${SEASON} boxes: 3/3 stored`);
        expect(jobLogger.finishRun).toHaveBeenCalledWith('run-1', 'success', out.summary);
    });

    test('a failed import is recorded as an error, not swallowed', async () => {
        jest.spyOn(hoopsStats, 'importSeason').mockRejectedValue(new Error('CBBD 503'));
        await HoopsGame.create(game(10, 1, 1, 3, { startDate: new Date(Date.UTC(2026, 10, 11)) }));
        const out = await statsJob.run({ now: NOW });
        expect(out.failed).toBe('CBBD 503');
        expect(jobLogger.finishRun).toHaveBeenCalledWith('run-1', 'error', `${SEASON}: FAILED CBBD 503 | ${SEASON} boxes: 3/3 stored`);
    });

    test('a skipped import (no teams) is reported in the summary', async () => {
        jest.spyOn(hoopsStats, 'importSeason').mockResolvedValue({ season: SEASON, skippedReason: 'no hoops teams ingested' });
        await HoopsGame.create(game(10, 1, 1, 3, { startDate: new Date(Date.UTC(2026, 10, 11)) }));
        expect((await statsJob.run({ now: NOW })).summary).toBe(`${SEASON}: no hoops teams ingested | ${SEASON} boxes: 3/3 stored`);
    });

    test('a box window at the row cap is recorded as an ERROR, not a quiet success', async () => {
        jest.spyOn(hoopsStats, 'importSeason').mockResolvedValue({ season: SEASON, teams: 1, players: 1 });
        boxScore.ingestRecent.mockResolvedValue({ season: SEASON, games: 9, stored: 4, capped: true });
        await HoopsGame.create(game(10, 1, 1, 3, { startDate: new Date(Date.UTC(2026, 10, 11)) }));
        const out = await statsJob.run({ now: NOW });
        expect(jobLogger.finishRun).toHaveBeenCalledWith('run-1', 'error', out.summary);
    });

    test('the box batch runs on its own: a box failure is recorded, and the stats still import', async () => {
        jest.spyOn(hoopsStats, 'importSeason').mockResolvedValue({ season: SEASON, teams: 365, players: 5000 });
        boxScore.ingestRecent.mockRejectedValue(new Error('CBBD 429'));
        await HoopsGame.create(game(10, 1, 1, 3, { startDate: new Date(Date.UTC(2026, 10, 11)) }));
        const out = await statsJob.run({ now: NOW });
        expect(out.summary).toBe(`${SEASON}: 365 team(s), 5000 player(s) | ${SEASON} boxes: FAILED CBBD 429`);
        expect(jobLogger.finishRun).toHaveBeenCalledWith('run-1', 'error', out.summary);
    });

    test('a capped box window says so in the summary', async () => {
        jest.spyOn(hoopsStats, 'importSeason').mockResolvedValue({ season: SEASON, teams: 1, players: 1 });
        boxScore.ingestRecent.mockResolvedValue({ season: SEASON, games: 9, stored: 4, capped: true });
        await HoopsGame.create(game(10, 1, 1, 3, { startDate: new Date(Date.UTC(2026, 10, 11)) }));
        expect((await statsJob.run({ now: NOW })).summary).toContain('boxes: 4/9 stored (HIT THE 3000-ROW CAP');
    });

    test('nothing final in the window: the box batch says so', async () => {
        jest.spyOn(hoopsStats, 'importSeason').mockResolvedValue({ season: SEASON, teams: 1, players: 1 });
        boxScore.ingestRecent.mockResolvedValue({ season: SEASON, games: 0, stored: 0, skippedReason: 'nothing final' });
        await HoopsGame.create(game(10, 1, 1, 3, { startDate: new Date(Date.UTC(2026, 10, 11)) }));
        expect((await statsJob.run({ now: NOW })).summary).toContain('boxes: nothing final');
    });
});
