// Basketball game alerts (#557): who hears a tip-off, crunch time or a final,
// and that each fires once per game. modules/push-notify.js
// notifyHoopsEvents / notifyHoopsFinals, fed by modules/hoops-scoreboard.js.

// Mocked: the real VAPID keys are in .env and jest loads it — an unmocked
// send would fire a real HTTPS request.
jest.mock('web-push', () => ({
    setVapidDetails: jest.fn(),
    sendNotification: jest.fn(() => Promise.resolve({ statusCode: 201 }))
}));

process.env.VAPID_PUBLIC_KEY = 'test-public-key';
process.env.VAPID_PRIVATE_KEY = 'test-private-key';

const webpush = require('web-push');
const { useMongo } = require('./helpers/mongo');
const Account = require('../models/account');
const Franchise = require('../models/franchise');
const League = require('../models/league');
const SportSeason = require('../models/sportSeason');
const HoopsGame = require('../models/hoopsGame');
const HoopsTeam = require('../models/hoopsTeam');
const ScoringConfig = require('../models/scoringConfig');
const seasons = require('../modules/active-season');
const scoreboard = require('../modules/hoops-scoreboard');
const scoringPass = require('../modules/hoops-scoring-pass');
const push = require('../modules/push-notify');

useMongo();

const HOOPS = 'hoops-league';
const HOOPS_2 = 'hoops-two';
const FOOTBALL = 'graham-league';
const SEASON = 2027;
const GAME_ID = 500;
const DUKE = 1, TEXAS = 2;

const sends = () => webpush.sendNotification.mock.calls.map(c => ({ to: c[0].endpoint, ...JSON.parse(c[1]) }));
const to = (name) => `https://web.push.apple.com/${name}`;

async function account(name, prefs) {
    return Account.create(Object.assign({
        firstName: name, lastName: 'M', email: `${name}@example.invalid`,
        pushSubscriptions: [{ endpoint: to(name), keys: { p256dh: 'k', auth: 'a' }, createdAt: new Date() }]
    }, prefs ? { pushPrefs: prefs } : {}));
}
const hoopsFranchise = (acct, teamIds, league = HOOPS) => Franchise.create({ accountId: acct._id, league,
    seasons: [{ season: SEASON, teamRefs: teamIds.map(id => ({ id, sport: 'basketball' })) }] });

const tipoff = { type: 'tipoff', homePoints: 2, awayPoints: 0, period: 1, clock: '19:40' };
const close = { type: 'closeGame', homePoints: 70, awayPoints: 66, period: 2, clock: '3:12' };

beforeEach(async () => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    webpush.sendNotification.mockClear();
    delete process.env.PUSH_RECIPIENT_IDS;
    await League.create([
        { code: HOOPS, name: 'Hardwood Heroes', sport: 'basketball' },
        { code: HOOPS_2, name: 'Second Hoops', sport: 'basketball' },
        { code: FOOTBALL, name: 'Graham League', sport: 'football' }
    ]);
    await SportSeason.create([
        { sport: 'football', season: 2026, status: 'in-season' },
        { sport: 'basketball', season: SEASON, status: 'in-season' }
    ]);
    await seasons.prime();
    // Ranked, so a win scores: an unranked opponent is worth nothing.
    await HoopsTeam.create([
        { id: DUKE, season: SEASON, school: 'Duke', preseason: { rank: 40 } },
        { id: TEXAS, season: SEASON, school: 'Texas', preseason: { rank: 10 } }
    ]);
    await HoopsGame.create({ id: GAME_ID, season: SEASON, week: 3, seasonType: 'regular', status: 'in_progress',
        startDate: new Date('2026-11-18T00:00:00Z'), homeTeamId: DUKE, homeTeam: 'Duke', awayTeamId: TEXAS, awayTeam: 'Texas',
        homePoints: 2, awayPoints: 0, period: 1, clock: '19:40' });
});
afterEach(() => { seasons._reset(); jest.restoreAllMocks(); delete process.env.PUSH_RECIPIENT_IDS; });

describe('live alerts', () => {
    test('tip-off reaches a manager rostering either team, dressed for the hoops game page', async () => {
        await hoopsFranchise(await account('Ann'), [DUKE]);
        await hoopsFranchise(await account('Bo'), [TEXAS]);
        const out = await push.notifyHoopsEvents({ [GAME_ID]: [tipoff] });
        expect(out.sent).toBe(2);
        expect(sends().map(s => s.to).sort()).toEqual([to('Ann'), to('Bo')]);
        expect(sends()[0]).toMatchObject({ type: 'hoopsTipoff', title: '🏀 Tip-off', body: 'Texas at Duke · H1 · 19:40',
            url: `/hoops/game/${GAME_ID}`, tag: `hoops-game-${GAME_ID}` });
    });

    test('crunch time reads as a scoreline with the half and clock', async () => {
        await hoopsFranchise(await account('Ann'), [DUKE]);
        await push.notifyHoopsEvents({ [GAME_ID]: [close] });
        expect(sends()[0]).toMatchObject({ type: 'hoopsCloseGame', title: '⏰ Crunch time', body: 'Texas 66 – Duke 70 · H2 · 3:12' });
    });

    // 130 basketball team ids are also football team ids. A football roster
    // holding team 1 must not hear about basketball team 1's game.
    test('a FOOTBALL roster with a colliding team id is never notified', async () => {
        // Football on the SAME season number, so only the sport keeps it out:
        // the two sports' numbers do line up (football 2027 is Aug 2027).
        await SportSeason.updateOne({ sport: 'football' }, { $set: { season: SEASON } });
        seasons._reset();
        await seasons.prime();
        const fb = await account('Fred');
        await Franchise.create({ accountId: fb._id, league: FOOTBALL, seasons: [{ season: SEASON, teams: [{ id: DUKE, school: 'Football One', mascot: 'M', abbreviation: 'F1', conference: 'SEC', color: '#000' }] }] });
        expect((await push.notifyHoopsEvents({ [GAME_ID]: [tipoff] })).sent).toBe(0);
        expect((await push.notifyHoopsFinals([GAME_ID])).sent).toBe(0);
    });

    test('a manager with no roster team in the game, or no device, hears nothing', async () => {
        await hoopsFranchise(await account('Ann'), [99]);
        const quiet = await Account.create({ firstName: 'Q', lastName: 'M', email: 'q@example.invalid' });
        await hoopsFranchise(quiet, [DUKE]);
        // The query matches on the id alone; a ref that is not a BASKETBALL
        // team is not this game's team.
        const odd = await account('Odd');
        await Franchise.create({ accountId: odd._id, league: HOOPS, seasons: [{ season: SEASON, teamRefs: [{ id: DUKE, sport: 'football' }] }] });
        expect((await push.notifyHoopsEvents({ [GAME_ID]: [tipoff] })).sent).toBe(0);
    });

    test('PUSH_RECIPIENT_IDS narrows basketball alerts too', async () => {
        const ann = await account('Ann');
        await hoopsFranchise(ann, [DUKE]);
        await hoopsFranchise(await account('Bo'), [TEXAS]);
        process.env.PUSH_RECIPIENT_IDS = String(ann._id);
        await push.notifyHoopsEvents({ [GAME_ID]: [tipoff] });
        expect(sends().map(s => s.to)).toEqual([to('Ann')]);
    });

    test('a manager in two basketball leagues hears a live alert once', async () => {
        const ann = await account('Ann');
        await hoopsFranchise(ann, [DUKE]);
        await hoopsFranchise(ann, [TEXAS], HOOPS_2);
        expect((await push.notifyHoopsEvents({ [GAME_ID]: [tipoff] })).sent).toBe(1);
    });
});

describe('once per game', () => {
    // A basketball margin crosses 5 more than once in the last four minutes;
    // each crossing is a new transition edge. The claim on the game row is
    // what holds it to one.
    test('crunch time a second time for the same game is not sent', async () => {
        await hoopsFranchise(await account('Ann'), [DUKE]);
        await push.notifyHoopsEvents({ [GAME_ID]: [close] });
        await push.notifyHoopsEvents({ [GAME_ID]: [close] });
        expect(sends()).toHaveLength(1);
        expect((await HoopsGame.findOne({ id: GAME_ID }).lean()).pushAlerts).toEqual(['closeGame']);
    });

    test('each type is its own claim: tip-off does not use up crunch time', async () => {
        await hoopsFranchise(await account('Ann'), [DUKE]);
        await push.notifyHoopsEvents({ [GAME_ID]: [tipoff] });
        await push.notifyHoopsEvents({ [GAME_ID]: [close] });
        expect(sends().map(s => s.type)).toEqual(['hoopsTipoff', 'hoopsCloseGame']);
    });

    test('a final is sent once', async () => {
        await HoopsGame.updateOne({ id: GAME_ID }, { $set: { status: 'final', homePoints: 80, awayPoints: 70 } });
        await hoopsFranchise(await account('Ann'), [DUKE]);
        await push.notifyHoopsFinals([GAME_ID]);
        await push.notifyHoopsFinals([GAME_ID]);
        expect(sends()).toHaveLength(1);
    });
});

describe('prefs', () => {
    test('each basketball toggle mutes only its own alert', async () => {
        await hoopsFranchise(await account('Ann', { hoopsCloseGame: false }), [DUKE]);
        await push.notifyHoopsEvents({ [GAME_ID]: [tipoff, close] });
        expect(sends().map(s => s.type)).toEqual(['hoopsTipoff']);
    });

    test('hoopsTipoff off mutes the tip-off', async () => {
        await hoopsFranchise(await account('Ann', { hoopsTipoff: false }), [DUKE]);
        await push.notifyHoopsEvents({ [GAME_ID]: [tipoff] });
        expect(sends()).toHaveLength(0);
    });

    test('hoopsFinal off mutes the final', async () => {
        await HoopsGame.updateOne({ id: GAME_ID }, { $set: { status: 'final', homePoints: 80, awayPoints: 70 } });
        await hoopsFranchise(await account('Ann', { hoopsFinal: false }), [DUKE]);
        expect((await push.notifyHoopsFinals([GAME_ID])).sent).toBe(0);
    });

    // A two-sport manager who muted FOOTBALL's crunch time and finals still
    // gets basketball's.
    test("football's closeGame/final do not mute basketball", async () => {
        await HoopsGame.updateOne({ id: GAME_ID }, { $set: { status: 'final', homePoints: 80, awayPoints: 70 } });
        await hoopsFranchise(await account('Ann', { closeGame: false, final: false }), [DUKE]);
        await push.notifyHoopsEvents({ [GAME_ID]: [close] });
        await push.notifyHoopsFinals([GAME_ID]);
        expect(sends().map(s => s.type)).toEqual(['hoopsCloseGame', 'hoopsFinal']);
    });
});

describe('finals', () => {
    test('says who won and what it banked — the same points the scorer pays', async () => {
        await HoopsGame.updateOne({ id: GAME_ID }, { $set: { status: 'final', homePoints: 80, awayPoints: 70 } });
        const ann = await account('Ann');
        await hoopsFranchise(ann, [DUKE]);
        await hoopsFranchise(await account('Bo'), [TEXAS]);

        const scored = await scoringPass.scoreHoopsWeek(HOOPS, { season: SEASON, week: 3, apply: false });
        const annPaid = scored.results.find(r => String(r.accountId) === String(ann._id)).scoreByTeam[0].score;
        expect(annPaid).toBeGreaterThan(0);

        await push.notifyHoopsFinals([GAME_ID]);
        const byTo = Object.fromEntries(sends().map(s => [s.to, s]));
        expect(byTo[to('Ann')]).toMatchObject({ type: 'hoopsFinal', title: '✅ Duke won', url: `/hoops/game/${GAME_ID}`, tag: `hoops-final-${GAME_ID}-${DUKE}` });
        expect(byTo[to('Ann')].body).toMatch(new RegExp(`^\\+${annPaid} pts .* · Texas 70 – Duke 80$`));
        expect(byTo[to('Bo')].title).toBe('❌ Texas lost');
    });

    // A read failing after the claim would use the final up for good.
    test('a failed ranks read leaves the final unclaimed, so it can still be sent', async () => {
        await HoopsGame.updateOne({ id: GAME_ID }, { $set: { status: 'final', homePoints: 80, awayPoints: 70 } });
        await hoopsFranchise(await account('Ann'), [DUKE]);
        const ranks = require('../modules/hoops-ranks');
        jest.spyOn(ranks, 'ranksFor').mockRejectedValueOnce(new Error('cluster blip'));
        expect((await push.notifyHoopsFinals([GAME_ID])).sent).toBe(0);
        expect((await HoopsGame.findOne({ id: GAME_ID }).lean()).pushAlerts).toBeUndefined();
        expect((await push.notifyHoopsFinals([GAME_ID])).sent).toBe(1);
    });

    test('a manager rostering both sides gets two finals that do not replace each other', async () => {
        await HoopsGame.updateOne({ id: GAME_ID }, { $set: { status: 'final', homePoints: 80, awayPoints: 70 } });
        await hoopsFranchise(await account('Ann'), [DUKE, TEXAS]);
        await push.notifyHoopsFinals([GAME_ID]);
        expect(sends().map(s => s.tag).sort()).toEqual([`hoops-final-${GAME_ID}-${DUKE}`, `hoops-final-${GAME_ID}-${TEXAS}`]);
    });

    test('a game that is not final is not announced as one', async () => {
        await hoopsFranchise(await account('Ann'), [DUKE]);
        expect((await push.notifyHoopsFinals([GAME_ID])).sent).toBe(0);
        expect((await HoopsGame.findOne({ id: GAME_ID }).lean()).pushAlerts).toBeUndefined();
    });

    test('negative points (the bad-loss penalty) are said as negative, zero as none', () => {
        const g = { id: 9, homeTeam: 'Duke', awayTeam: 'Texas', homePoints: 60, awayPoints: 70 };
        expect(push.buildHoopsFinalPayload(g, 'Duke', { total: -2, matched: [{ label: 'Bad loss' }] }).body)
            .toBe('−2 pts — Bad loss · Texas 70 – Duke 60');
        expect(push.buildHoopsFinalPayload(g, 'Duke', { total: 0, matched: [] }).body).toBe('No points · Texas 70 – Duke 60');
        expect(push.buildHoopsFinalPayload(g, 'Texas', null).title).toBe('✅ Texas won');
    });
});

// Graham asked for it (#557): a captained team's final names the bonus.
describe('a final for the manager\'s Captain', () => {
    const captainMode = (on = true) => ScoringConfig.updateOne({ league: HOOPS }, { $set: { league: HOOPS,
        [`engagementBySeason.${SEASON}`]: { captainEnabled: on, captainMultiplier: 2 } } }, { upsert: true });
    const finalGame = (o = {}) => HoopsGame.updateOne({ id: GAME_ID }, { $set: Object.assign({ status: 'final', homePoints: 80, awayPoints: 70 }, o) });
    const withCaptain = async (name, teamId) => {
        const a = await account(name);
        await Franchise.create({ accountId: a._id, league: HOOPS, seasons: [{ season: SEASON,
            teamRefs: [{ id: DUKE, sport: 'basketball' }, { id: 77, sport: 'basketball' }],
            captains: teamId == null ? [] : [{ week: 3, teamId }] }] });
        return a;
    };
    const scorerFor = async (acct) => (await scoringPass.scoreHoopsWeek(HOOPS, { season: SEASON, week: 3, apply: false }))
        .results.find(r => String(r.accountId) === String(acct._id));

    test('names the bonus, and the headline is base + bonus — the scorer\'s numbers', async () => {
        await captainMode();
        await finalGame();
        const ann = await withCaptain('Ann', DUKE);
        const scored = await scorerFor(ann);
        const base = scored.scoreByTeam[0].score;
        expect(scored.captainBonus).toBe(base);                       // ×2: the bonus is one more base
        await push.notifyHoopsFinals([GAME_ID]);
        expect(sends()[0].body).toMatch(new RegExp(`^\\+${base * 2} pts .* · 👑 Captain bonus \\+${base} · Texas 70 – Duke 80$`));
    });

    test('the default Captain counts when the manager never picked', async () => {
        await captainMode();
        await finalGame();
        const ann = await withCaptain('Ann', null);
        const scored = await scorerFor(ann);
        expect(scored.captainTeamId).toBe(DUKE);                      // the scorer's default here
        await push.notifyHoopsFinals([GAME_ID]);
        expect(sends()[0].body).toContain(`👑 Captain bonus +${scored.captainBonus}`);
    });

    test('a different Captain: no bonus note', async () => {
        await captainMode();
        await finalGame();
        await withCaptain('Ann', 77);
        await push.notifyHoopsFinals([GAME_ID]);
        expect(sends()[0].body).not.toContain('Captain');
    });

    test('Captain off in the league: no bonus note', async () => {
        await captainMode(false);
        await finalGame();
        await withCaptain('Ann', DUKE);
        await push.notifyHoopsFinals([GAME_ID]);
        expect(sends()[0].body).not.toContain('Captain');
    });

    test('a conference tournament game is not doubled', async () => {
        await captainMode();
        await finalGame({ conferenceGame: true, gameNotes: 'Big 12 Tournament - Quarterfinal' });
        // Week 3 stays a mode week on its regular games; only the game's own
        // type keeps it out.
        await HoopsGame.create({ id: 501, season: SEASON, week: 3, seasonType: 'regular', status: 'scheduled',
            startDate: new Date('2026-11-19T00:00:00Z'), homeTeamId: 50, awayTeamId: 51 });
        const ann = await withCaptain('Ann', DUKE);
        // It scores, so a doubled game WOULD show a bonus.
        expect((await scorerFor(ann)).scoreByTeam[0].score).toBeGreaterThan(0);
        await push.notifyHoopsFinals([GAME_ID]);
        expect(sends()[0].body).not.toContain('Captain');
    });

    test('a doubled penalty reads as negative', () => {
        const g = { id: 9, homeTeamId: DUKE, awayTeamId: TEXAS, homeTeam: 'Duke', awayTeam: 'Texas', homePoints: 60, awayPoints: 70 };
        expect(push.buildHoopsFinalPayload(g, 'Duke', { total: -2, matched: [{ label: 'Bad loss' }] }, -2).body)
            .toBe('−4 pts — Bad loss · 👑 Captain bonus −2 · Texas 70 – Duke 60');
    });
});

describe('never throws', () => {
    test('a database failure is logged and answered with nothing sent', async () => {
        jest.spyOn(HoopsGame, 'find').mockImplementation(() => { throw new Error('cluster down'); });
        await expect(push.notifyHoopsEvents({ [GAME_ID]: [tipoff] })).resolves.toEqual({ sent: 0 });
        await expect(push.notifyHoopsFinals([GAME_ID])).resolves.toEqual({ sent: 0 });
    });
});

describe('labels', () => {
    test('halves and overtime', () => {
        expect(push.hoopsClockLabel(1, '12:00')).toBe('H1 · 12:00');
        expect(push.hoopsClockLabel(3, '1:00')).toBe('OT1 · 1:00');
        expect(push.hoopsClockLabel(2, null)).toBe('H2');
        expect(push.hoopsClockLabel(undefined, '1:00')).toBe('');
    });
});

describe('the scoreboard produces the events', () => {
    const row = (o) => Object.assign({ id: GAME_ID, status: 'in_progress', period: 2, clock: '3:30',
        homeTeam: { id: DUKE, points: 70 }, awayTeam: { id: TEXAS, points: 67 } }, o);

    test('a poll moving a game into crunch time reports it, keyed by game id', async () => {
        await HoopsGame.updateOne({ id: GAME_ID }, { $set: { period: 2, clock: '5:00', homePoints: 66, awayPoints: 65 } });
        const applied = await scoreboard.applyScoreboard([row()]);
        expect(applied.events).toEqual({ [GAME_ID]: [{ type: 'closeGame', homePoints: 70, awayPoints: 67, period: 2, clock: '3:30' }] });
    });

    test('a tip-off is reported from a scheduled row', async () => {
        await HoopsGame.updateOne({ id: GAME_ID }, { $set: { status: 'scheduled', homePoints: 0, awayPoints: 0, period: null, clock: null } });
        const applied = await scoreboard.applyScoreboard([row({ period: 1, clock: '19:50', homeTeam: { id: DUKE, points: 0 }, awayTeam: { id: TEXAS, points: 0 } })]);
        expect(applied.events[GAME_ID].map(e => e.type)).toEqual(['tipoff']);
    });

    test('an unchanged game reports nothing', async () => {
        const applied = await scoreboard.applyScoreboard([row({ period: 1, clock: '19:40', homeTeam: { id: DUKE, points: 2 }, awayTeam: { id: TEXAS, points: 0 } })]);
        expect(applied.events).toEqual({});
    });
});
