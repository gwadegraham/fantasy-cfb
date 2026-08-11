// Coverage for modules/cfp-bracket.js — the CFBD /playoffs/cfp normalizer that
// lets postseason scoring read bracket facts instead of substring-matching
// CFBD's `notes` prose.
//
// The two fixtures are the REAL, unedited CFBD payloads for the only two
// brackets that have ever been published in this format (tests/fixtures). Every
// rejection case below is a mutation of one of them, so the thing under test is
// always one step from production data rather than an invented shape.

process.env.URL = 'http://test.local';

// getBracketForGame's only seam is the internal API read.
jest.mock('../modules/internal-api', () => ({ internalFetch: jest.fn() }));

const {
    ROUNDS, BracketRejected,
    deriveBracket, factsForGame, teamInGame
} = require('../modules/cfp-bracket');
const scoring = require('../modules/scoring');
const { resolveConfig } = require('../modules/scoring-defaults');

const raw2025 = require('./fixtures/cfp-bracket-2025.json');
const raw2024 = require('./fixtures/cfp-bracket-2024.json');
const raw2023 = require('./fixtures/cfp-bracket-2023.json');
const clone = (o) => JSON.parse(JSON.stringify(o));

// 2025 landmarks, read off the fixture.
const QF1 = 401769072;          // Rose Bowl: Indiana (1, bye) vs Alabama (9, via FR4)
const FR1 = 401779843;          // Oregon (5) vs James Madison (12)
const CHAMP = 401769076;        // Indiana vs Miami
const INDIANA = 84, ALABAMA = 333, OREGON = 2483, TEXAS_AM = 245;

describe('deriveBracket on the real 2025 payload', () => {
    const derived = deriveBracket(raw2025);

    test('carries the season, format and completion status', () => {
        expect(derived.season).toBe(2025);
        expect(derived.format).toBe('twelve_team_2025');
        expect(derived.teamCount).toBe(12);
        expect(derived.status).toBe('completed');
        expect(derived.champion).toEqual({ teamId: INDIANA, school: 'Indiana' });
    });

    test('maps every scheduled matchup to its game id and round', () => {
        expect(derived.games).toHaveLength(11);   // 4 + 4 + 2 + 1
        const byRound = derived.games.reduce((acc, g) => {
            acc[g.round] = (acc[g.round] || 0) + 1;
            return acc;
        }, {});
        expect(byRound).toEqual({ first_round: 4, quarterfinal: 4, semifinal: 2, championship: 1 });
        expect(factsForGame(derived, QF1).round).toBe(ROUNDS.QUARTERFINAL);
        expect(factsForGame(derived, FR1).round).toBe(ROUNDS.FIRST_ROUND);
        expect(factsForGame(derived, CHAMP).round).toBe(ROUNDS.CHAMPIONSHIP);
    });

    test('the bowl name that names the round is NOT how the round is decided', () => {
        // The Fiesta was a quarterfinal in 2024 and a semifinal in 2025 — the
        // exact drift the notes path can't survive.
        const fiesta2025 = derived.games.find(g => g.bowlName === 'Fiesta Bowl');
        const fiesta2024 = deriveBracket(raw2024).games.find(g => g.bowlName === 'Fiesta Bowl');
        expect(fiesta2025.round).toBe(ROUNDS.SEMIFINAL);
        expect(fiesta2024.round).toBe(ROUNDS.QUARTERFINAL);
    });

    test('seeds come from the participant record, not the matchup slot', () => {
        // Alabama's QF1 slot carries seed: null (it arrived by winning FR4).
        const slotSeed = raw2025.rounds
            .flatMap(r => r.matchups).find(m => m.game && m.game.id === QF1)
            .slots.find(s => s.participant.id === ALABAMA).seed;
        expect(slotSeed).toBeNull();
        expect(teamInGame(factsForGame(derived, QF1), ALABAMA).seed).toBe(9);
    });

    test('the bye is a stated fact per team in the quarterfinal', () => {
        const qf1 = factsForGame(derived, QF1);
        expect(teamInGame(qf1, INDIANA).firstRoundBye).toBe(true);
        expect(teamInGame(qf1, ALABAMA).firstRoundBye).toBe(false);
    });

    test('a first-round team is never flagged as a bye, sourceless slot or not', () => {
        // Oregon holds a first-round slot with source: null. Reading "sourceless"
        // without scoping it to the quarterfinal would make it a bye team.
        expect(teamInGame(factsForGame(derived, FR1), OREGON).firstRoundBye).toBe(false);
        derived.games.filter(g => g.round === ROUNDS.FIRST_ROUND).forEach(g => {
            g.teams.forEach(t => expect(t.firstRoundBye).toBe(false));
        });
    });

    test('participants keep seed and committee rank separately (they diverge)', () => {
        const tulane = derived.participants.find(p => p.school === 'Tulane');
        expect(tulane.seed).toBe(11);
        expect(tulane.committeeRank).toBe(20);
        expect(tulane.firstRoundBye).toBe(false);
        expect(derived.participants).toHaveLength(12);
        expect(derived.participants.filter(p => p.firstRoundBye)).toHaveLength(4);
    });

    test('records how far each team got', () => {
        const indiana = derived.participants.find(p => p.teamId === INDIANA);
        expect(indiana.outcome).toBe('champion');
        expect(derived.participants.find(p => p.teamId === TEXAS_AM).eliminatedRound).toBe('first_round');
    });
});

describe('deriveBracket on the real 2024 payload', () => {
    test('the same round vocabulary covers the other published bracket', () => {
        const derived = deriveBracket(raw2024);
        expect(derived.season).toBe(2024);
        expect(derived.games).toHaveLength(11);
        expect(new Set(derived.games.map(g => g.round)))
            .toEqual(new Set(['first_round', 'quarterfinal', 'semifinal', 'championship']));
        expect(derived.participants.filter(p => p.firstRoundBye).map(p => p.school).sort())
            .toEqual(['Arizona State', 'Boise State', 'Georgia', 'Oregon']);
    });
});

// The app still shows 2023, which ran the four-team format. It shares the round
// vocabulary and claims no byes — and with no quarterfinal round there is
// nothing for the bye cross-check to compare, which it has to survive rather
// than read as a contradiction.
describe('deriveBracket on the real 2023 payload (four-team format)', () => {
    const derived = deriveBracket(raw2023);

    test('ingests the older format without a quarterfinal round', () => {
        expect(derived.format).toBe('four_team');
        expect(derived.teamCount).toBe(4);
        expect(derived.games.map(g => g.round)).toEqual(['semifinal', 'semifinal', 'championship']);
        expect(derived.participants.filter(p => p.firstRoundBye)).toHaveLength(0);
    });

    test('its sourceless semifinal seeds are not mistaken for byes', () => {
        // Michigan is the 1 seed in a sourceless slot — but of a SEMIfinal, and
        // in a format with no byes at all.
        const sf1 = derived.games.find(g => g.bracketSlot === 'SF1');
        expect(teamInGame(sf1, 130).seed).toBe(1);
        expect(sf1.teams.every(t => t.firstRoundBye === false)).toBe(true);
    });
});

// Two independent CFBD signals name the bye teams. Scoring pays for the bye, so
// a disagreement is refused outright rather than resolved by picking one.
describe('bye cross-check refuses a self-contradictory bracket', () => {
    test('a sourceless quarterfinal team that is not flagged as a bye', () => {
        const bad = clone(raw2025);
        bad.participants.find(p => p.team.id === INDIANA).firstRoundBye = false;
        expect(() => deriveBracket(bad)).toThrow(BracketRejected);
        expect(() => deriveBracket(bad)).toThrow(/Indiana \(84\).*not flagged firstRoundBye/);
    });

    test('a flagged bye team that reached the quarterfinal by winning a game', () => {
        const bad = clone(raw2025);
        bad.participants.find(p => p.team.id === ALABAMA).firstRoundBye = true;
        expect(() => deriveBracket(bad)).toThrow(/Alabama \(333\).*reaches the quarterfinal via FR4/);
    });

    test('a flagged bye team with no quarterfinal slot at all', () => {
        const bad = clone(raw2025);
        // Texas A&M lost in the first round, so nothing else contradicts this.
        bad.participants.find(p => p.team.id === TEXAS_AM).firstRoundBye = true;
        expect(() => deriveBracket(bad)).toThrow(/5 teams flagged firstRoundBye but 4 sourceless/);
    });

    test('but stays quiet before the quarterfinal slots are populated', () => {
        // Nothing to cross-check yet, and no quarterfinal facts are usable
        // either — the games still ingest so the first round can score.
        const early = clone(raw2025);
        early.rounds.find(r => r.code === 'quarterfinal').matchups
            .forEach(m => m.slots.forEach(s => { s.participant = null; }));
        const derived = deriveBracket(early);
        expect(derived.games).toHaveLength(11);
        expect(factsForGame(derived, QF1).teams).toEqual([]);
        expect(teamInGame(factsForGame(derived, QF1), INDIANA)).toBeNull();
    });
});

describe('deriveBracket refuses payloads it cannot score off', () => {
    test('an unrecognized round code fails the whole bracket, not just that round', () => {
        const bad = clone(raw2025);
        bad.rounds[1].matchups[0].round = 'quarter-final';
        expect(() => deriveBracket(bad)).toThrow(/Unrecognized CFP round "quarter-final"/);
    });

    test('a bracket with no scheduled games (before selection day)', () => {
        const empty = clone(raw2025);
        empty.rounds.forEach(r => r.matchups.forEach(m => { m.game = null; }));
        expect(() => deriveBracket(empty)).toThrow(/no scheduled games yet/);
    });

    test('a missing or malformed payload', () => {
        expect(() => deriveBracket(null)).toThrow(/not an object/);
        expect(() => deriveBracket([])).toThrow(/not an object/);
        expect(() => deriveBracket({ rounds: [] })).toThrow(/no season/);
    });

    test('tolerates a payload with pieces missing rather than throwing on it', () => {
        // Every array CFBD sends is treated as optional, and a slot team with no
        // participant record still lands in the game with no seed claimed.
        const odd = {
            season: 2026,
            format: 'twelve_team_2026',
            champion: {},                                     // no id yet
            participants: [null, { team: null }, { team: { id: 1, school: 'A' }, seed: 3 }],
            rounds: [
                { code: 'first_round' },                       // no matchups array
                { code: 'championship', order: 4, matchups: [
                    { game: { id: 5 } },                       // no slots
                    { game: null },                            // not scheduled
                    { bracketSlot: 'CH', game: { id: 6 }, slots: [
                        { participant: { id: 1, school: 'A' } },
                        { participant: null },
                        { participant: { id: 77, school: 'Unlisted' } }
                    ] }
                ] }
            ]
        };
        const derived = deriveBracket(odd);
        expect(derived.champion).toBeUndefined();
        expect(derived.participants).toHaveLength(1);
        expect(derived.games.map(g => g.gameId)).toEqual([5, 6]);
        expect(derived.games[0].teams).toEqual([]);
        expect(derived.games[0].roundOrder).toBe(4);           // fell back to the round's order
        expect(derived.games[1].teams).toEqual([
            { teamId: 1, school: 'A', seed: 3, firstRoundBye: false },
            { teamId: 77, school: 'Unlisted', seed: null, firstRoundBye: false }
        ]);
    });

    test('a payload with no rounds at all reads as unpublished', () => {
        expect(() => deriveBracket({ season: 2026, rounds: 'nope', participants: 'nope' }))
            .toThrow(/no scheduled games yet/);
    });

    test('a matchup with no round at all falls back to the round code', () => {
        const noMatchupRound = clone(raw2025);
        noMatchupRound.rounds.forEach(r => r.matchups.forEach(m => { delete m.round; }));
        expect(deriveBracket(noMatchupRound).games.filter(g => g.round === ROUNDS.QUARTERFINAL))
            .toHaveLength(4);
    });
});

describe('lookups degrade to null rather than throwing', () => {
    const derived = deriveBracket(raw2025);
    test('factsForGame', () => {
        expect(factsForGame(null, QF1)).toBeNull();
        expect(factsForGame({}, QF1)).toBeNull();
        expect(factsForGame(derived, null)).toBeNull();
        expect(factsForGame(derived, 999999)).toBeNull();   // a non-playoff bowl
    });
    test('teamInGame', () => {
        expect(teamInGame(null, INDIANA)).toBeNull();
        expect(teamInGame({}, INDIANA)).toBeNull();
        expect(teamInGame(factsForGame(derived, QF1), null)).toBeNull();
        expect(teamInGame(factsForGame(derived, QF1), 999)).toBeNull();
    });
});

// The read side of scoring: one Mongo-backed lookup per season, shared across
// every game in a run, and never fatal.
describe('getBracketForGame', () => {
    const { internalFetch } = require('../modules/internal-api');
    const stored = deriveBracket(raw2025);

    const postGame = (id) => ({ id: id, seasonType: 'postseason' });
    const found = () => ({ status: 200, json: async () => stored });

    beforeEach(() => {
        internalFetch.mockReset();
        jest.spyOn(console, 'log').mockImplementation(() => {});
    });
    afterEach(() => { jest.restoreAllMocks(); });

    test('resolves a postseason game to its bracket facts', async () => {
        internalFetch.mockImplementation(async () => found());
        const facts = await scoring.getBracketForGame(postGame(QF1), 2025);
        expect(facts.round).toBe(ROUNDS.QUARTERFINAL);
        expect(internalFetch.mock.calls[0][0]).toBe('http://test.local/playoffs/cfp/2025');
    });

    test('a regular-season game never reads the bracket at all', async () => {
        internalFetch.mockImplementation(async () => found());
        expect(await scoring.getBracketForGame({ id: 1, seasonType: 'regular' }, 2025)).toBeNull();
        expect(await scoring.getBracketForGame(null, 2025)).toBeNull();
        expect(internalFetch).not.toHaveBeenCalled();
    });

    test('a postseason game outside the bracket resolves to null', async () => {
        internalFetch.mockImplementation(async () => found());
        expect(await scoring.getBracketForGame(postGame(999001), 2025)).toBeNull();
    });

    test('one read serves every game in a run', async () => {
        internalFetch.mockImplementation(async () => found());
        const cache = new Map();
        await scoring.getBracketForGame(postGame(QF1), 2025, cache);
        await scoring.getBracketForGame(postGame(FR1), 2025, cache);
        const facts = await scoring.getBracketForGame(postGame(CHAMP), 2025, cache);
        expect(internalFetch).toHaveBeenCalledTimes(1);
        expect(facts.round).toBe(ROUNDS.CHAMPIONSHIP);
    });

    test('the cache key does not collide with the rankings sharing that Map', async () => {
        internalFetch.mockImplementation(async () => found());
        // The key a postseason rankings lookup puts in this same Map (see
        // getRankingsForGame — postseason reads the LATEST regular poll).
        const cache = new Map([['2025|latest|regular', { polls: [] }]]);
        expect((await scoring.getBracketForGame(postGame(QF1), 2025, cache)).round).toBe(ROUNDS.QUARTERFINAL);
        expect(cache.get('2025|latest|regular')).toEqual({ polls: [] });
        expect(cache.get('bracket|2025')).toBeDefined();
    });

    test('a season with no bracket on file degrades to null, and caches that', async () => {
        internalFetch.mockImplementation(async () => ({ status: 404, json: async () => ({ message: 'nope' }) }));
        const cache = new Map();
        expect(await scoring.getBracketForGame(postGame(QF1), 2023, cache)).toBeNull();
        expect(await scoring.getBracketForGame(postGame(FR1), 2023, cache)).toBeNull();
        expect(internalFetch).toHaveBeenCalledTimes(1);   // the miss is cached too
    });

    test('a failed read degrades to null instead of breaking the run', async () => {
        internalFetch.mockImplementation(async () => { throw new Error('ECONNREFUSED'); });
        expect(await scoring.getBracketForGame(postGame(QF1), 2025)).toBeNull();
    });
});

// The payoff: the same game, scored with and without the bracket, when CFBD's
// notes string has drifted to something the detectors can't read.
describe('scoring a bracket game whose notes no longer say "quarterfinal"', () => {
    const bracket2025 = deriveBracket(raw2025);
    const claunts = resolveConfig('claunts-league', null);
    const graham = resolveConfig('graham-league', null);

    // Indiana beats Alabama in the Rose Bowl quarterfinal — but the notes read
    // only "Rose Bowl", as if it were an ordinary bowl game.
    const driftedQF = {
        id: QF1, season: 2025, week: 1, seasonType: 'postseason',
        notes: 'Rose Bowl', neutralSite: true, conferenceGame: false,
        homeId: INDIANA, homeTeam: 'Indiana', homeConference: 'Big Ten', homePoints: 38,
        awayId: ALABAMA, awayTeam: 'Alabama', awayConference: 'SEC', awayPoints: 3
    };
    const facts = factsForGame(bracket2025, QF1);

    test('without the bracket it scores as a plain bowl', () => {
        // Claunts stacks bowl appearance (4) + bowl win (5); Graham pays the win (6).
        expect(scoring.evaluate('claunts', INDIANA, driftedQF, null, claunts)).toBe(9);
        expect(scoring.evaluate('graham', INDIANA, driftedQF, null, graham)).toBe(6);
    });

    test('with the bracket it scores as the quarterfinal it was', () => {
        expect(scoring.evaluate('claunts', INDIANA, driftedQF, null, claunts, facts)).toBe(8);
        // Quarterfinal appearance (6) + top-4 seed bye bonus (6).
        expect(scoring.evaluate('graham', INDIANA, driftedQF, null, graham, facts)).toBe(12);
    });

    test('the bye bonus goes to the seed that had the bye, not the home team', () => {
        // Alabama is the 9 seed and played its way in: quarterfinal only.
        expect(scoring.evaluate('graham', ALABAMA, driftedQF, null, graham, facts)).toBe(6);
    });

    test('a first-round game never collects the bye bonus', () => {
        const fr = Object.assign({}, driftedQF, {
            id: FR1, notes: 'College Football Playoff First Round Game',
            homeId: OREGON, homeTeam: 'Oregon', homePoints: 42,
            awayId: 256, awayTeam: 'James Madison', awayPoints: 10
        });
        expect(scoring.evaluate('graham', OREGON, fr, null, graham, factsForGame(bracket2025, FR1)))
            .toBe(6);   // cfpFirstRound only
    });

    test('a real bowl game is untouched — it is not in the bracket', () => {
        const bowl = Object.assign({}, driftedQF, { id: 999001, notes: 'Las Vegas Bowl' });
        expect(factsForGame(bracket2025, 999001)).toBeNull();
        expect(scoring.evaluate('claunts', INDIANA, bowl, null, claunts, factsForGame(bracket2025, 999001)))
            .toBe(9);   // bowl appearance + bowl win, exactly as before the ingest
    });
});
