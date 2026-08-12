// Direct coverage for the closed condition vocabulary in
// modules/scoring-detectors.js. The scoring engine tests exercise these
// indirectly through evaluate(); this pins the predicates on their own so a
// detector regression surfaces here instead of hiding inside an aggregate
// scoring assertion.

const {
    CONDITIONS, buildContext,
    isConference, findPoll, rankValue, isPowerFiveUpset, POWER_CONFERENCES,
    isConferenceChampion, isBowlGame, isFirstRound,
    isQuarterFinalist, isSemiFinalist, isFinalist, isTop4Seed,
    bracketRound
} = require('../modules/scoring-detectors');

// Home team (id 1) beats the away team (id 2) in a regular-season game.
function game(o) {
    return Object.assign({
        id: 1, season: 2025, week: 5, seasonType: 'regular',
        neutralSite: false, conferenceGame: false, notes: '',
        homeId: 1, homeTeam: 'Oregon', homeConference: 'Big Ten', homePoints: 30,
        awayId: 2, awayTeam: 'Duke', awayConference: 'ACC', awayPoints: 10
    }, o);
}
const apPoll = (school, rank) => ({ polls: [{ poll: 'AP Top 25', ranks: [{ school, rank }] }] });
const cfpPoll = (school, rank) => ({ polls: [{ poll: 'Playoff Committee Rankings', ranks: [{ school, rank }] }] });

describe('low-level game predicates', () => {
    describe('isConference', () => {
        test('true only for a flagged conference game', () => {
            expect(isConference(game({ conferenceGame: true }))).toBe(true);
            expect(isConference(game({ conferenceGame: false }))).toBe(false);
        });
        test('an FBS Independent on either side is never a conference game', () => {
            expect(isConference(game({ conferenceGame: true, homeConference: 'FBS Independents' }))).toBe(false);
            expect(isConference(game({ conferenceGame: true, awayConference: 'FBS Independents' }))).toBe(false);
        });
    });

    describe('findPoll', () => {
        test('prefers the CFP committee poll over AP when both exist', () => {
            const rankings = { polls: [
                { poll: 'AP Top 25', ranks: [{ school: 'A', rank: 1 }] },
                { poll: 'Playoff Committee Rankings', ranks: [{ school: 'B', rank: 1 }] }
            ] };
            expect(findPoll(rankings).poll).toBe('Playoff Committee Rankings');
        });
        test('falls back to AP when no committee poll', () => {
            expect(findPoll(apPoll('A', 1)).poll).toBe('AP Top 25');
        });
        test('degrades to null on missing/malformed rankings', () => {
            expect(findPoll(null)).toBeNull();
            expect(findPoll({})).toBeNull();
            expect(findPoll({ polls: [] })).toBeNull();
            expect(findPoll({ polls: [{ poll: 'AP Top 25' }] })).toBeNull(); // no ranks array
            expect(findPoll({ polls: [{ poll: 'Coaches Poll', ranks: [] }] })).toBeNull();
        });
    });

    describe('rankValue', () => {
        test('2 for top-10, 1 for 11-25, 0 for unranked or no poll', () => {
            expect(rankValue('A', apPoll('A', 1))).toBe(2);
            expect(rankValue('A', apPoll('A', 10))).toBe(2);   // inclusive boundary
            expect(rankValue('A', apPoll('A', 11))).toBe(1);
            expect(rankValue('A', apPoll('A', 25))).toBe(1);
            expect(rankValue('B', apPoll('A', 1))).toBe(0);    // not in poll
            expect(rankValue('A', null)).toBe(0);
        });
        test('reads from the committee poll when present', () => {
            expect(rankValue('A', cfpPoll('A', 3))).toBe(2);
        });
    });

    describe('isPowerFiveUpset', () => {
        test('true only when a non-P5 team beats a P5 team', () => {
            expect(isPowerFiveUpset('Mountain West', 'SEC')).toBe(true);
            expect(isPowerFiveUpset('SEC', 'Big Ten')).toBe(false);        // P5 vs P5
            expect(isPowerFiveUpset('Mountain West', 'Sun Belt')).toBe(false); // both non-P5
            expect(isPowerFiveUpset('ACC', 'Mountain West')).toBe(false);  // P5 vs non-P5
        });
        test('each of the four power conferences counts as P5', () => {
            ['ACC', 'Big 12', 'Big Ten', 'SEC'].forEach(conf => {
                expect(isPowerFiveUpset('Conference USA', conf)).toBe(true);
            });
        });

        // The default list is load-bearing: tests/ScoringParity.spec.js proves the
        // engine matches the frozen pre-Phase-2 oracle, and that oracle hardcodes
        // these four. Widening the DEFAULT (rather than a league's config) would
        // silently void the parity guarantee.
        test('the default power list is exactly the four P4 conferences', () => {
            expect(POWER_CONFERENCES).toEqual(['ACC', 'Big 12', 'Big Ten', 'SEC']);
        });

        test('a caller-supplied power list overrides the default', () => {
            const withIndependents = ['ACC', 'Big 12', 'Big Ten', 'SEC', 'FBS Independents'];
            // Notre Dame's case: an independent beating a P4 team stops being an upset...
            expect(isPowerFiveUpset('FBS Independents', 'ACC', withIndependents)).toBe(false);
            expect(isPowerFiveUpset('FBS Independents', 'ACC')).toBe(true);   // ...but only for that league
            // ...while a genuine Group-of-5 upset is untouched...
            expect(isPowerFiveUpset('Mid-American', 'Big Ten', withIndependents)).toBe(true);
            // ...and beating an independent now counts, which it didn't before.
            expect(isPowerFiveUpset('Mid-American', 'FBS Independents', withIndependents)).toBe(true);
            expect(isPowerFiveUpset('Mid-American', 'FBS Independents')).toBe(false);
        });
    });

    describe('postseason / titled-game predicates (case-insensitive, note-driven)', () => {
        test('isConferenceChampion needs "championship" in notes AND a regular seasonType', () => {
            expect(isConferenceChampion(game({ notes: 'SEC Championship' }))).toBe(true);
            expect(isConferenceChampion(game({ notes: 'sec championship game' }))).toBe(true); // lowercased
            expect(isConferenceChampion(game({ notes: 'Rivalry Game' }))).toBe(false);
            // A national championship is postseason, so it must NOT read as a conf title.
            expect(isConferenceChampion(game({ notes: 'CFP National Championship', seasonType: 'postseason' }))).toBe(false);
        });
        test('isBowlGame excludes playoff games and requires postseason', () => {
            expect(isBowlGame(game({ notes: 'Las Vegas Bowl', seasonType: 'postseason' }))).toBe(true);
            expect(isBowlGame(game({ notes: 'Playoff Bowl', seasonType: 'postseason' }))).toBe(false); // "playoff" excluded
            expect(isBowlGame(game({ notes: 'Las Vegas Bowl', seasonType: 'regular' }))).toBe(false);
        });
        test('bracket-round predicates key off notes + postseason', () => {
            expect(isFirstRound(game({ notes: 'CFP First Round', seasonType: 'postseason' }))).toBe(true);
            expect(isQuarterFinalist(game({ notes: 'CFP Quarterfinal', seasonType: 'postseason' }))).toBe(true);
            expect(isSemiFinalist(game({ notes: 'CFP Semifinal', seasonType: 'postseason' }))).toBe(true);
            expect(isFinalist(game({ notes: 'CFP National Championship', seasonType: 'postseason' }))).toBe(true);
            // Wrong seasonType kills them all.
            expect(isFirstRound(game({ notes: 'CFP First Round', seasonType: 'regular' }))).toBe(false);
        });
        test('isTop4Seed = a quarterfinalist hosting as the home team (the bye seed)', () => {
            const qf = game({ notes: 'CFP Quarterfinal', seasonType: 'postseason' });
            expect(isTop4Seed(qf, 1)).toBe(true);    // homeId === teamId
            expect(isTop4Seed(qf, 2)).toBe(false);   // away side is not the top-4 seed
            expect(isTop4Seed(game({ notes: 'CFP Semifinal', seasonType: 'postseason' }), 1)).toBe(false);
        });
    });
});

describe('buildContext', () => {
    test('normalizes the home team perspective (win, opponent, conf flags)', () => {
        const ctx = buildContext(1, game(), null);
        expect(ctx.won).toBe(true);
        expect(ctx.opponent).toBe('Duke');
        expect(ctx.isRegular).toBe(true);
        expect(ctx.isConference).toBe(false);
    });

    test('normalizes the away team perspective', () => {
        const ctx = buildContext(2, game({ homePoints: 10, awayPoints: 30 }), null);
        expect(ctx.won).toBe(true);            // away outscored home
        expect(ctx.opponent).toBe('Oregon');
    });

    test('a team not in the game did not win and has no opponent', () => {
        const ctx = buildContext(999, game(), null);
        expect(ctx.won).toBe(false);
        expect(ctx.opponent).toBeNull();
        expect(ctx.rankVal).toBe(0);
    });

    test('rankVal is looked up against the opponent, not the team', () => {
        // Oregon (home) beats a #4 Duke → opponent-rank bonus tier 2.
        const ctx = buildContext(1, game(), apPoll('Duke', 4));
        expect(ctx.rankVal).toBe(2);
    });

    test('a non-P5 host beating a P5 visitor flags a power-five upset', () => {
        const ctx = buildContext(1, game({ homeConference: 'Sun Belt', awayConference: 'SEC' }), null);
        expect(ctx.isPowerFiveUpset).toBe(true);
    });
});

describe('CONDITIONS vocabulary', () => {
    const ctxFor = (teamId, g, rankings) => buildContext(teamId, g, rankings);

    test('baseWin fires on any regular-season win but not on a conf title or a loss', () => {
        expect(CONDITIONS.baseWin(ctxFor(1, game()))).toBe(true);
        expect(CONDITIONS.baseWin(ctxFor(2, game()))).toBe(false);                       // loser
        expect(CONDITIONS.baseWin(ctxFor(1, game({ notes: 'SEC Championship' })))).toBe(false); // title game excluded
        expect(CONDITIONS.baseWin(ctxFor(1, game({ seasonType: 'postseason' })))).toBe(false);  // not regular
    });

    test('conferenceWin / confBonus require a conference win', () => {
        const conf = game({ conferenceGame: true, awayConference: 'Big Ten' });
        expect(CONDITIONS.conferenceWin(ctxFor(1, conf))).toBe(true);
        expect(CONDITIONS.confBonus(ctxFor(1, conf))).toBe(true);
        expect(CONDITIONS.conferenceWin(ctxFor(1, game()))).toBe(false);                 // non-conf
    });

    test('ranked-opponent win tiers are mutually exclusive by opponent rank', () => {
        const top10 = ctxFor(1, game(), apPoll('Duke', 5));
        const top25 = ctxFor(1, game(), apPoll('Duke', 20));
        expect(CONDITIONS.rankedTop10Bonus(top10)).toBe(true);
        expect(CONDITIONS.rankedTop25Bonus(top10)).toBe(false);
        expect(CONDITIONS.rankedTop25Bonus(top25)).toBe(true);
        expect(CONDITIONS.rankedTop10Bonus(top25)).toBe(false);
        expect(CONDITIONS.nonConfRankedWin(top25)).toBe(true);   // non-conf + ranked
    });

    test('split conf/non-conf ranked categories gate on both conference and rank tier', () => {
        const confTop10 = ctxFor(1, game({ conferenceGame: true, awayConference: 'Big Ten' }), apPoll('Duke', 3));
        expect(CONDITIONS.confWinTop10(confTop10)).toBe(true);
        expect(CONDITIONS.confRankedWin(confTop10)).toBe(true);
        expect(CONDITIONS.nonConfWinTop10(confTop10)).toBe(false);  // it IS a conference game

        const nonConfTop25 = ctxFor(1, game(), apPoll('Duke', 18));
        expect(CONDITIONS.nonConfWinTop25(nonConfTop25)).toBe(true);
        expect(CONDITIONS.confWinTop25(nonConfTop25)).toBe(false);
    });

    test('nonP5UpsetBonus needs the win to be a genuine non-P5-over-P5 upset', () => {
        const upset = ctxFor(1, game({ homeConference: 'Sun Belt', awayConference: 'SEC' }));
        expect(CONDITIONS.nonP5UpsetBonus(upset)).toBe(true);
        expect(CONDITIONS.nonP5UpsetBonus(ctxFor(1, game()))).toBe(false); // Big Ten host, no upset
    });

    // Graham's league counts independents as power, so Notre Dame stops drawing
    // the underdog bonus on its ~10 power-conference games a year. The list
    // reaches the detector through buildContext's last argument.
    test('nonP5UpsetBonus honours a league power list that includes independents', () => {
        const POWER_PLUS = ['ACC', 'Big 12', 'Big Ten', 'SEC', 'FBS Independents'];
        const ndBeatsAcc = game({ homeConference: 'FBS Independents', awayConference: 'ACC' });
        expect(CONDITIONS.nonP5UpsetBonus(buildContext(1, ndBeatsAcc, null, null))).toBe(true);
        expect(CONDITIONS.nonP5UpsetBonus(buildContext(1, ndBeatsAcc, null, null, POWER_PLUS))).toBe(false);

        // A real Group-of-5 upset still pays under the widened list.
        const macBeatsBigTen = game({ homeConference: 'Mid-American', awayConference: 'Big Ten' });
        expect(CONDITIONS.nonP5UpsetBonus(buildContext(1, macBeatsBigTen, null, null, POWER_PLUS))).toBe(true);
    });

    test('confChampionship fires only on a won conference-title game', () => {
        const title = game({ notes: 'Big Ten Championship' });
        expect(CONDITIONS.confChampionship(ctxFor(1, title))).toBe(true);
        expect(CONDITIONS.confChampionship(ctxFor(2, title))).toBe(false);  // lost the title
        expect(CONDITIONS.confChampionship(ctxFor(1, game()))).toBe(false); // not a title game
    });

    test('bowl conditions: appearance fires win-or-lose, bowlWin only on a win', () => {
        const bowl = game({ notes: 'Las Vegas Bowl', seasonType: 'postseason' });
        expect(CONDITIONS.bowlAppearance(ctxFor(2, bowl))).toBe(true);   // loser still "appeared"
        expect(CONDITIONS.bowlWin(ctxFor(1, bowl))).toBe(true);
        expect(CONDITIONS.bowlWin(ctxFor(2, bowl))).toBe(false);
    });

    test('CFP bracket: appearance conditions fire regardless of result; *Loss/*Win are gated', () => {
        const fr = game({ notes: 'CFP First Round', seasonType: 'postseason' });
        expect(CONDITIONS.cfpFirstRound(ctxFor(2, fr))).toBe(true);          // appearance, even as loser
        expect(CONDITIONS.cfpFirstRoundLoss(ctxFor(2, fr))).toBe(true);      // loser
        expect(CONDITIONS.cfpFirstRoundLoss(ctxFor(1, fr))).toBe(false);     // winner didn't lose

        const qf = game({ notes: 'CFP Quarterfinal', seasonType: 'postseason' });
        expect(CONDITIONS.cfpQuarterfinal(ctxFor(2, qf))).toBe(true);
        expect(CONDITIONS.cfpQuarterfinalTop4Bonus(ctxFor(1, qf))).toBe(true);  // home = top-4 seed
        expect(CONDITIONS.cfpQuarterfinalTop4Bonus(ctxFor(2, qf))).toBe(false);
    });

    test('national title: appearance (Claunts) vs win-only (Graham) split', () => {
        const final = game({ notes: 'CFP National Championship', seasonType: 'postseason' });
        expect(CONDITIONS.nationalChampionship(ctxFor(2, final))).toBe(true);      // appearance
        expect(CONDITIONS.nationalChampionshipWin(ctxFor(2, final))).toBe(false);  // lost
        expect(CONDITIONS.nationalChampionshipWin(ctxFor(1, final))).toBe(true);   // won
    });
});

// When a CFP bracket is on file for a game, its stated round replaces the notes
// substring guess. Fixture-backed end-to-end coverage (real CFBD payload ->
// points) lives in tests/CfpBracket.spec.js; this pins the predicate contract.
describe('bracket-aware bracket-round predicates', () => {
    const facts = (round, teams) => ({ gameId: 1, round: round, teams: teams || [] });
    // A postseason game whose notes say nothing useful about the round.
    const mute = game({ notes: 'Rose Bowl', seasonType: 'postseason' });

    test('bracketRound reads a round only from a well-formed bracket', () => {
        expect(bracketRound(facts('quarterfinal'))).toBe('quarterfinal');
        expect(bracketRound(null)).toBeNull();
        expect(bracketRound(undefined)).toBeNull();
        expect(bracketRound({})).toBeNull();
        expect(bracketRound({ round: 42 })).toBeNull();
    });

    test('the bracket names the round the notes failed to', () => {
        expect(isFirstRound(mute, facts('first_round'))).toBe(true);
        expect(isQuarterFinalist(mute, facts('quarterfinal'))).toBe(true);
        expect(isSemiFinalist(mute, facts('semifinal'))).toBe(true);
        expect(isFinalist(mute, facts('championship'))).toBe(true);
    });

    test('each predicate answers only for its own round', () => {
        const qf = facts('quarterfinal');
        expect(isFirstRound(mute, qf)).toBe(false);
        expect(isSemiFinalist(mute, qf)).toBe(false);
        expect(isFinalist(mute, qf)).toBe(false);
    });

    test('the bracket overrides notes that claim a DIFFERENT round', () => {
        // Notes and bracket disagreeing is the drift case: the bracket wins.
        const mislabeled = game({ notes: 'CFP Semifinal', seasonType: 'postseason' });
        expect(isSemiFinalist(mislabeled, facts('quarterfinal'))).toBe(false);
        expect(isQuarterFinalist(mislabeled, facts('quarterfinal'))).toBe(true);
    });

    test('a bracket game is never a bowl, whatever the venue is called', () => {
        expect(isBowlGame(mute, null)).toBe(true);                  // notes path: reads as a bowl
        expect(isBowlGame(mute, facts('quarterfinal'))).toBe(false);
        expect(isBowlGame(mute, facts('championship'))).toBe(false);
        // A genuine non-playoff bowl isn't in the bracket, so it keeps scoring.
        expect(isBowlGame(game({ notes: 'Las Vegas Bowl', seasonType: 'postseason' }), null)).toBe(true);
    });

    test('the bye bonus follows firstRoundBye, not who is listed at home', () => {
        // Away team (id 2) holds the bye; the home team (id 1) played its way in.
        const qf = facts('quarterfinal', [
            { teamId: 1, seed: 9, firstRoundBye: false },
            { teamId: 2, seed: 1, firstRoundBye: true }
        ]);
        expect(isTop4Seed(mute, 2, qf)).toBe(true);
        expect(isTop4Seed(mute, 1, qf)).toBe(false);
        // The notes heuristic would have paid the home team instead.
        expect(isTop4Seed(game({ notes: 'CFP Quarterfinal', seasonType: 'postseason' }), 1)).toBe(true);
    });

    test('no bye bonus outside the quarterfinal, or for a team not in the game', () => {
        const byeTeams = [{ teamId: 2, seed: 1, firstRoundBye: true }];
        expect(isTop4Seed(mute, 2, facts('first_round', byeTeams))).toBe(false);
        expect(isTop4Seed(mute, 2, facts('semifinal', byeTeams))).toBe(false);
        expect(isTop4Seed(mute, 999, facts('quarterfinal', byeTeams))).toBe(false);
        expect(isTop4Seed(mute, 2, facts('quarterfinal', []))).toBe(false);
    });

    test('buildContext carries the game\'s bracket facts, defaulting to null', () => {
        const qf = facts('quarterfinal', [{ teamId: 1, seed: 1, firstRoundBye: true }]);
        expect(buildContext(1, mute, null, qf).bracket).toBe(qf);
        expect(buildContext(1, mute, null).bracket).toBeNull();
        // ...and the conditions read it off the context.
        expect(CONDITIONS.cfpQuarterfinal(buildContext(1, mute, null, qf))).toBe(true);
        expect(CONDITIONS.cfpQuarterfinalTop4Bonus(buildContext(1, mute, null, qf))).toBe(true);
        expect(CONDITIONS.bowlAppearance(buildContext(1, mute, null, qf))).toBe(false);
        expect(CONDITIONS.bowlAppearance(buildContext(1, mute, null))).toBe(true);
    });
});
