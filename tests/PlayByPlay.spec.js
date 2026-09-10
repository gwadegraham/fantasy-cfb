const {
    buildPlayByPlay, buildDriveChart, groupByPeriod, scoringPlays,
    isScoringPlay, classifyScore, sideTeamIds, periodLabel, driveSummary,
    cleanPlayText, driveOutcome, driveFieldSpan, driveLabel,
    playResult, playResultLabel
} = require('../modules/play-by-play');

// Shaping for the play-by-play log. The load-bearing decision here is that a
// scoring play is identified by the score CHANGING, not by matching playType
// against a vocabulary — so the tests lean on that: an unfamiliar play type
// that scores must be caught, and a familiar-looking one that doesn't score
// must not be.

function play(over = {}) {
    return {
        period: 1, clock: '12:07', teamId: 52, team: 'Florida State',
        down: 1, distance: 10, yardsToGoal: 65, yardsGained: 4,
        playType: 'Rush', playText: 'a run',
        homeScore: 0, awayScore: 0,
        ...over
    };
}

function drive(plays, over = {}) {
    return { id: 'd1', playCount: 4, yards: 77, duration: '1:40', result: 'Touchdown', plays, ...over };
}

describe('isScoringPlay', () => {
    it('catches a change in either score', () => {
        expect(isScoringPlay(play({ homeScore: 7 }), play())).toBe(true);
        expect(isScoringPlay(play({ awayScore: 3 }), play())).toBe(true);
    });

    it('ignores a play that changes nothing', () => {
        expect(isScoringPlay(play({ homeScore: 7 }), play({ homeScore: 7 }))).toBe(false);
    });

    it('catches a scoring play type it has never heard of', () => {
        // The reason this is a score comparison and not a playType list: CFBD
        // can add 'Defensive 2pt Conversion' tomorrow and this still works.
        const scored = play({ playType: 'Some New Scoring Play', homeScore: 2 });
        expect(isScoringPlay(scored, play())).toBe(true);
    });

    it('does not trust a scoring-sounding play type that scored nothing', () => {
        // A missed or reversed touchdown keeps the label but not the points.
        const nope = play({ playType: 'Passing Touchdown', homeScore: 0, awayScore: 0 });
        expect(isScoringPlay(nope, play())).toBe(false);
    });

    it('treats the first play as scoring only if the board is not 0-0', () => {
        expect(isScoringPlay(play({ homeScore: 7 }), null)).toBe(true);
        expect(isScoringPlay(play(), null)).toBe(false);
    });

    it('treats a missing score as no change rather than as zero', () => {
        // A gap in the feed must not invent a scoring play, nor read as the
        // score being wiped back to 0.
        expect(isScoringPlay(play({ homeScore: null }), play({ homeScore: 7 }))).toBe(false);
        expect(isScoringPlay(play({ homeScore: 7 }), play({ homeScore: null }))).toBe(false);
        expect(isScoringPlay(null, play())).toBe(false);
    });
});

// Both of these are measured bugs from LSU–Clemson (game 401856660), not
// hypotheticals. The feed is the source of truth for order and for scores, and
// it is occasionally wrong about the second one.
describe('corrupt score rows', () => {
    it('rejects a row where both teams gained points', () => {
        // Play 156 of 401856660: an ordinary 4th-quarter rush stamped with the
        // game's FINAL 51-10 while the score was 44-3. A single play cannot
        // score for both teams, so the row is corrupt rather than a 14-point
        // play, and rendering it put a score from the future in the log.
        const bad = play({ playType: 'Rush', homeScore: 51, awayScore: 10 });
        expect(isScoringPlay(bad, play({ homeScore: 44, awayScore: 3 }))).toBe(false);
        expect(classifyScore(bad, play({ homeScore: 44, awayScore: 3 }))).toBe('invalid');
    });

    it('rejects a row where the score went backwards', () => {
        const backwards = play({ playType: 'Punt', homeScore: 44, awayScore: 3 });
        expect(classifyScore(backwards, play({ homeScore: 51, awayScore: 10 }))).toBe('invalid');
    });

    it('rejects a feed that opens mid-game rather than reading it as one score', () => {
        // CFBD opens at 0-0, so a first row already showing 44-3 is a truncated
        // or corrupt payload — not a 47-point play. This is the one case the
        // arithmetic reads differently from the old "did it change" test, which
        // would have flagged it.
        expect(classifyScore(play({ homeScore: 44, awayScore: 3 }), null)).toBe('invalid');
        expect(classifyScore(play({ homeScore: 7 }), null)).toEqual({ side: 'home', points: 7 });
    });

    it('rejects a change too large for one play', () => {
        // A touchdown plus a two-point try is 8. Nothing scores 9.
        expect(classifyScore(play({ homeScore: 8 }), play())).toEqual({ side: 'home', points: 8 });
        expect(classifyScore(play({ homeScore: 9 }), play())).toBe('invalid');
    });

    it('does not let a corrupt row become the baseline for the next one', () => {
        // This is the half that made ONE bad row produce TWO phantom scoring
        // plays: the punt after it looked like a change only because the
        // corrupt score had been adopted as the running total.
        const payload = {
            drives: [drive([
                play({ clock: '13:00' }),                                               // 0-0
                play({ clock: '11:30', playType: 'Rushing Touchdown', homeScore: 7 }),  // real
                play({ clock: '11:19', playType: 'Rush', homeScore: 51, awayScore: 10 }),  // corrupt
                play({ clock: '10:43', playType: 'Punt', homeScore: 7 }),               // reverts
                play({ clock: '6:43', playType: 'Passing Touchdown', homeScore: 14 })   // real
            ])]
        };
        const out = buildPlayByPlay(payload);
        expect(out.map(p => p.scoring)).toEqual([false, true, false, false, true]);
        expect(out[4].points).toBe(7);
    });

    it('keeps the real scoring plays of 401856660 and drops the two phantoms', () => {
        // The whole sequence, in feed order, with the deltas measured from the
        // stored payload: ten real changes, two corrupt rows.
        const scores = [
            [0, 3], [3, 3], [10, 3], [17, 3], [24, 3], [31, 3], [38, 3], [44, 3],
            [51, 10],  // corrupt: the final score, mid-game
            [44, 3],   // corrupt: reverts
            [51, 3], [51, 10]
        ];
        const payload = {
            drives: [drive(scores.map(([h, a], i) => play({ clock: `${i}:00`, homeScore: h, awayScore: a })))]
        };
        const flagged = scoringPlays(buildPlayByPlay(payload));
        expect(flagged).toHaveLength(10);
        expect(flagged.map(p => p.points)).toEqual([3, 3, 7, 7, 7, 7, 7, 6, 7, 7]);
    });
});

describe('scoring attribution', () => {
    const teams = [
        { teamId: 99, team: 'LSU', homeAway: 'home' },
        { teamId: 228, team: 'Clemson', homeAway: 'away' }
    ];

    it('credits a pick-six to the defense, not to the team that threw it', () => {
        // Play 40 of 401856660. CFBD's teamId on the play is the OFFENSE —
        // Clemson, who threw the interception — while the points went to LSU.
        // Attributing by teamId put the Clemson logo on an LSU touchdown.
        const payload = {
            teams,
            drives: [drive([
                play({ teamId: 228, team: 'Clemson' }),
                play({
                    teamId: 228, team: 'Clemson',
                    playType: 'Interception Return Touchdown',
                    homeScore: 7, awayScore: 0
                })
            ])]
        };
        const out = buildPlayByPlay(payload);
        expect(out[1].scoring).toBe(true);
        expect(out[1].teamId).toBe(228);          // the offense, unchanged
        expect(out[1].scoringSide).toBe('home');
        expect(out[1].scoringTeamId).toBe(99);    // LSU, who scored
    });

    it('agrees with teamId on an ordinary offensive score', () => {
        const payload = {
            teams,
            drives: [drive([play({
                teamId: 228, team: 'Clemson', playType: 'Rushing Touchdown',
                homeScore: 0, awayScore: 7
            })])]
        };
        expect(buildPlayByPlay(payload)[0].scoringTeamId).toBe(228);
    });

    it('leaves attribution null on a non-scoring play, so the client falls back', () => {
        const out = buildPlayByPlay({ teams, drives: [drive([play()])] });
        expect(out[0].scoringTeamId).toBeNull();
        expect(out[0].scoringSide).toBeNull();
        expect(out[0].points).toBeNull();
    });

    it('survives a payload with no teams block', () => {
        // A stored summary predating this, or a feed that omits teams: the
        // score is still identified, there is just no id to draw a logo from.
        const out = buildPlayByPlay({ drives: [drive([play({ homeScore: 7 })])] });
        expect(out[0].scoring).toBe(true);
        expect(out[0].scoringSide).toBe('home');
        expect(out[0].scoringTeamId).toBeNull();
    });

    it('maps sides from the teams block and ignores a malformed entry', () => {
        expect(sideTeamIds({ teams })).toEqual({ home: 99, away: 228 });
        expect(sideTeamIds({ teams: [{ team: 'no id', homeAway: 'home' }] })).toEqual({ home: null, away: null });
        expect(sideTeamIds(null)).toEqual({ home: null, away: null });
    });
});

// Trimming CFBD's playText. The property that matters more than any single
// rule: nothing is reworded or parsed, so an unmatched pattern leaves the text
// exactly as it arrived. Every input below is a real string from a stored game.
describe('cleanPlayText', () => {
    it('trims a touchdown down to what a reader needs', () => {
        const raw = '(08:26) No Huddle-Shotgun #10 S.Leavitt pass complete deep left to '
            + '#6 W.Watkins Jr. caught at CLEM05, for 32 yards to the CLEM00 TOUCHDOWN, '
            + 'clock 08:21, 1ST DOWN #80 S.Starzyk kick attempt good (H: #90 G.Chadwick, LS: #43 S.Hall)';
        expect(cleanPlayText(raw)).toBe(
            '#10 S.Leavitt pass complete deep left to #6 W.Watkins Jr. caught at CLEM05, '
            + 'for 32 yards TOUCHDOWN, 1ST DOWN #80 S.Starzyk kick attempt good'
        );
    });

    it('drops the clock at the snap, which disagreed with the card', () => {
        // The card shows play.clock, the clock AFTER the play. Leaving the
        // text's snap clock in put two different times on one row.
        expect(cleanPlayText('(08:26) #10 S.Leavitt rush')).toBe('#10 S.Leavitt rush');
        expect(cleanPlayText('#10 S.Leavitt rush at (08:26)')).toBe('#10 S.Leavitt rush at (08:26)');
    });

    it('drops a formation prefix it knows and keeps one it does not', () => {
        expect(cleanPlayText('No Huddle-Shotgun #10 rush')).toBe('#10 rush');
        expect(cleanPlayText('Shotgun #10 rush')).toBe('#10 rush');
        // The safe-failure case: a formation CFBD adds tomorrow just stays.
        expect(cleanPlayText('Diamond Wing #10 rush')).toBe('Diamond Wing #10 rush');
    });

    it('drops the goal line next to a touchdown, but only the goal line', () => {
        expect(cleanPlayText('for 32 yards to the CLEM00 TOUCHDOWN')).toBe('for 32 yards TOUCHDOWN');
        expect(cleanPlayText('for 1 yard gain to the LSU00 TOUCHDOWN')).toBe('for 1 yard gain TOUCHDOWN');
        // Not a touchdown: the yard line is the whole point of the sentence.
        expect(cleanPlayText('rush middle for 11 yards loss to the CLEM39, End Of Play'))
            .toBe('rush middle for 11 yards loss to the CLEM39, End Of Play');
    });

    it('drops the holder and long snapper', () => {
        expect(cleanPlayText('#80 S.Starzyk kick attempt good (H: #90 G.Chadwick, LS: #43 S.Hall)'))
            .toBe('#80 S.Starzyk kick attempt good');
    });

    it('keeps jersey numbers', () => {
        // Deliberate: Graham wants them. They are the biggest single saving
        // available and were left on the table on purpose.
        expect(cleanPlayText('#10 S.Leavitt pass to #6 W.Watkins Jr.'))
            .toBe('#10 S.Leavitt pass to #6 W.Watkins Jr.');
    });

    it('leaves a differently-formatted game completely alone', () => {
        // Real text from FSU–SMU (401858212), which CFBD writes in another
        // style entirely — no snap clock, no formation, no jersey numbers.
        // 168 of 360 stored plays pass through untouched, and that is correct.
        const raw = 'Conor McAneney kickoff for 65 yds for a touchback';
        expect(cleanPlayText(raw)).toBe(raw);
    });

    it('never leaves the seams showing', () => {
        // Cutting mid-sentence is where this would look broken: doubled
        // spaces, a space before a comma, a dangling comma at the end. Checked
        // as artifacts rather than as one exact string, because the point is
        // that no combination of cuts produces them — verified across all 360
        // stored plays, none of which come out mangled.
        const inputs = [
            '(01:00) Shotgun #1 A.B pass, clock 01:00, to the LSU00 TOUCHDOWN, clock 00:59',
            '(08:26) No Huddle #2 C.D rush (H: #9 E.F, LS: #3 G.H)',
            '(00:04) Shotgun #5 I.J kick attempt good, clock 00:02',
            'Pistol #7 K.L pass incomplete, clock 12:00, 1ST DOWN'
        ];
        for (const raw of inputs) {
            const out = cleanPlayText(raw);
            expect(out).not.toMatch(/\s{2,}/);   // doubled space
            expect(out).not.toMatch(/\s[,.]/);   // space before punctuation
            expect(out).not.toMatch(/[,\s]$/);   // dangling comma or space
            expect(out).not.toMatch(/^[,\s]/);   // leading comma or space
            expect(out).not.toMatch(/clock \d/);  // every clock copy gone
        }
    });

    it('passes through nothing at all', () => {
        expect(cleanPlayText(null)).toBeNull();
        expect(cleanPlayText('')).toBeNull();
        expect(cleanPlayText('(08:26)')).toBeNull();
        expect(cleanPlayText(42)).toBe(42);
    });

    it('is applied by buildPlayByPlay, so a stored game gets it on read', () => {
        // Not at ingest: the raw text stays in Mongo, so this improves a game
        // that was persisted before the rules existed, with no refetch.
        const payload = { drives: [drive([play({ playText: '(08:26) Shotgun #10 rush' })])] };
        expect(buildPlayByPlay(payload)[0].playText).toBe('#10 rush');
    });
});

describe('periodLabel', () => {
    it('names the four quarters', () => {
        expect(periodLabel(1)).toBe('1ST QUARTER');
        expect(periodLabel(2)).toBe('2ND QUARTER');
        expect(periodLabel(3)).toBe('3RD QUARTER');
        expect(periodLabel(4)).toBe('4TH QUARTER');
    });

    it('counts overtimes instead of saying 5TH QUARTER', () => {
        expect(periodLabel(5)).toBe('OVERTIME');
        expect(periodLabel(6)).toBe('2OT');
        expect(periodLabel(7)).toBe('3OT');
    });

    it('handles a missing period', () => {
        expect(periodLabel(null)).toBe('PREGAME');
        expect(periodLabel(0)).toBe('PREGAME');
    });
});

describe('driveSummary', () => {
    it('reads like the ESPN line', () => {
        expect(driveSummary({ playCount: 4, yards: 77, duration: '1:40' })).toBe('4 plays, 77 yards, 1:40');
    });

    it('singularizes one play and one yard', () => {
        expect(driveSummary({ playCount: 1, yards: 1, duration: '0:05' })).toBe('1 play, 1 yard, 0:05');
    });

    it('drops the parts it does not have instead of printing null', () => {
        expect(driveSummary({ playCount: 4, yards: 77 })).toBe('4 plays, 77 yards');
        expect(driveSummary({ duration: '1:40' })).toBe('1:40');
        expect(driveSummary({})).toBeNull();
        expect(driveSummary(null)).toBeNull();
    });

    it('keeps a zero-yard drive rather than treating 0 as absent', () => {
        expect(driveSummary({ playCount: 3, yards: 0, duration: '1:12' })).toBe('3 plays, 0 yards, 1:12');
    });
});

describe('buildPlayByPlay', () => {
    it('flattens drives in feed order, not clock order', () => {
        // The clock counts DOWN within a period and repeats across periods, so
        // sorting by it would scramble the game.
        const payload = {
            drives: [
                drive([play({ clock: '15:00' }), play({ clock: '12:24' })]),
                drive([play({ clock: '11:58', period: 1 })])
            ]
        };
        const out = buildPlayByPlay(payload);
        expect(out.map(p => p.clock)).toEqual(['15:00', '12:24', '11:58']);
        expect(out.map(p => p.driveIndex)).toEqual([0, 0, 1]);
    });

    it('flags the scoring play and attaches its drive summary', () => {
        const payload = {
            drives: [drive([
                play({ clock: '14:00' }),
                play({ clock: '12:07', playType: 'Passing Touchdown', homeScore: 7 })
            ])]
        };
        const out = buildPlayByPlay(payload);
        expect(out[0].scoring).toBe(false);
        expect(out[0].driveSummary).toBeNull();
        expect(out[1].scoring).toBe(true);
        expect(out[1].driveSummary).toBe('4 plays, 77 yards, 1:40');
    });

    it('does not attach a drive summary to a mid-drive score', () => {
        // A defensive score happens on the other team's drive, where the drive
        // line would describe the wrong team's possession.
        const payload = {
            drives: [drive([
                play({ playType: 'Pass Interception Return', awayScore: 7 }),
                play({ clock: '11:00' })
            ])]
        };
        const out = buildPlayByPlay(payload);
        expect(out[0].scoring).toBe(true);
        expect(out[0].driveSummary).toBeNull();
    });

    it('carries the running score across drives', () => {
        const payload = {
            drives: [
                drive([play({ homeScore: 7 })]),
                drive([play({ homeScore: 7 }), play({ homeScore: 14 })])
            ]
        };
        const out = buildPlayByPlay(payload);
        // Only the two plays that actually moved the board.
        expect(out.filter(p => p.scoring)).toHaveLength(2);
        expect(out[1].scoring).toBe(false);
    });

    it('does not shift later comparisons when one play has no score', () => {
        const payload = {
            drives: [drive([
                play({ homeScore: 7 }),
                play({ homeScore: null, awayScore: null }),
                play({ homeScore: 7 })
            ])]
        };
        const out = buildPlayByPlay(payload);
        // The gap is not scoring, and the play after it is compared against the
        // last known score (7), not against the gap.
        expect(out.map(p => p.scoring)).toEqual([true, false, false]);
    });

    it('labels each play with its quarter', () => {
        const payload = { drives: [drive([play({ period: 3 })])] };
        expect(buildPlayByPlay(payload)[0].periodLabel).toBe('3RD QUARTER');
    });

    it('survives an empty or absent payload', () => {
        expect(buildPlayByPlay(null)).toEqual([]);
        expect(buildPlayByPlay({})).toEqual([]);
        expect(buildPlayByPlay({ drives: [] })).toEqual([]);
        expect(buildPlayByPlay({ drives: [drive(null)] })).toEqual([]);
        expect(buildPlayByPlay({ drives: [{}] })).toEqual([]);
    });
});

// The drive chart. All fixtures are real rows from LSU-Clemson (401856660).
describe('playResult', () => {
    it('separates a complete pass from an incomplete one', () => {
        // The distinction the badge exists for: an incomplete pass leaves the
        // ball where it was, so a stationary field needs explaining.
        expect(playResult('Pass Reception')).toBe('complete');
        expect(playResult('Pass Incompletion')).toBe('incomplete');
    });

    it('buckets the rest of the vocabulary a real game produced', () => {
        expect(playResult('Sack')).toBe('sack');
        expect(playResult('Pass Interception Return')).toBe('turnover');
        expect(playResult('Passing Touchdown')).toBe('score');
        expect(playResult('Field Goal Good')).toBe('score');
        // A rush's result is already in its own text, so no badge.
        expect(playResult('Rush')).toBe('other');
        expect(playResult('Kickoff')).toBe('other');
        expect(playResult('Punt')).toBe('other');
        expect(playResult('Penalty')).toBe('other');
        expect(playResult('Field Goal Missed')).toBe('other');
    });

    it('reads an interception as a turnover, not as the touchdown it became', () => {
        expect(playResult('Interception Return Touchdown')).toBe('turnover');
    });

    it('gives an unknown play type no badge rather than a wrong one', () => {
        // Safe direction to fail: this only decides whether to draw a badge.
        expect(playResult('Some New CFBD Play')).toBe('other');
        expect(playResult(null)).toBe('other');
        expect(playResultLabel('other')).toBeNull();
        expect(playResultLabel(playResult('Rush'))).toBeNull();
    });

    it('is attached to every shaped play', () => {
        const payload = { drives: [drive([
            play({ playType: 'Pass Incompletion' }),
            play({ playType: 'Rush' })
        ])] };
        const out = buildPlayByPlay(payload);
        expect(out[0]).toMatchObject({ outcome: 'incomplete', outcomeLabel: 'Incomplete' });
        expect(out[1]).toMatchObject({ outcome: 'other', outcomeLabel: null });
    });
});

describe('driveOutcome', () => {
    it('buckets the results a real game produced', () => {
        expect(driveOutcome('Touchdown')).toBe('touchdown');
        expect(driveOutcome('Field Goal')).toBe('field-goal');
        expect(driveOutcome('Punt')).toBe('punt');
        expect(driveOutcome('Interception')).toBe('turnover');
        expect(driveOutcome('Missed FG')).toBe('other');
    });

    it('reads a defensive score as a turnover, not a touchdown', () => {
        // 'Interception Touchdown' is the offense's disaster. Checking
        // touchdown first would have painted it as a scoring drive for them.
        expect(driveOutcome('Interception Touchdown')).toBe('turnover');
        expect(driveOutcome('Fumble Return Touchdown')).toBe('turnover');
    });

    it('survives CFBD disagreeing with itself about capitalization', () => {
        // Both spellings appear in ONE game's payload.
        expect(driveOutcome('End Of Half')).toBe('other');
        expect(driveOutcome('End of Half')).toBe('other');
        expect(driveOutcome('END OF HALF')).toBe('other');
    });

    it('buckets the two results neither stored game happened to contain', () => {
        // Not in either LSU-Clemson or FSU-SMU, but both are ordinary football:
        // a safety and a turnover on downs are losses of possession, so they
        // read as turnovers rather than as a punt or a nothing.
        expect(driveOutcome('Safety')).toBe('turnover');
        expect(driveOutcome('Turnover on Downs')).toBe('turnover');
        expect(driveOutcome('Downs')).toBe('turnover');
    });

    it('puts an unknown result somewhere sane', () => {
        expect(driveOutcome('Some New CFBD Result')).toBe('other');
        expect(driveOutcome(null)).toBe('other');
        expect(driveOutcome('')).toBe('other');
    });
});

describe('driveFieldSpan', () => {
    it('converts yards-to-goal into yards from the offense own goal', () => {
        // Real drive: LSU started at their own 11 and scored. 89 to go, 89
        // gained, so the bar runs from 11 to the goal line.
        expect(driveFieldSpan({ startYardsToGoal: 89, yards: 89 })).toEqual({ start: 11, end: 100 });
        expect(driveFieldSpan({ startYardsToGoal: 75, yards: 8 })).toEqual({ start: 25, end: 33 });
    });

    it('clamps a drive that reports past either goal line', () => {
        // A drive ending in a defensive score reports an end position behind
        // where it started, and CFBD's own numbers can overshoot.
        expect(driveFieldSpan({ startYardsToGoal: 79, yards: 40 }).end).toBe(61);
        expect(driveFieldSpan({ startYardsToGoal: 5, yards: 40 }).end).toBe(100);
        expect(driveFieldSpan({ startYardsToGoal: 95, yards: -40 }).end).toBe(0);
    });

    it('says nothing when there is no start position', () => {
        expect(driveFieldSpan({ yards: 20 })).toEqual({ start: null, end: null });
    });

    it('treats missing yards as no gain rather than as a broken bar', () => {
        expect(driveFieldSpan({ startYardsToGoal: 60 })).toEqual({ start: 40, end: 40 });
    });
});

describe('buildDriveChart', () => {
    const teams = [
        { teamId: 99, team: 'LSU', homeAway: 'home' },
        { teamId: 228, team: 'Clemson', homeAway: 'away' }
    ];
    const realDrive = {
        id: '4018566602', offense: 'LSU', offenseId: 99,
        defense: 'Clemson', defenseId: 228,
        playCount: 2, yards: 8,
        startPeriod: 1, startClock: '15:00', startYardsToGoal: 75,
        endPeriod: 1, endClock: '14:30', endYardsToGoal: 67,
        duration: '0:30', scoringOpportunity: true,
        result: 'Interception', pointsGained: 0, plays: []
    };

    it('shapes a real drive', () => {
        const [d] = buildDriveChart({ teams, drives: [realDrive] });
        expect(d).toMatchObject({
            driveIndex: 0, offense: 'LSU', side: 'home',
            startClock: '15:00', periodLabel: '1ST QUARTER',
            summary: '2 plays, 8 yards, 0:30',
            result: 'Interception', outcome: 'turnover',
            fieldStart: 25, fieldEnd: 33,
            scoredAgainst: false
        });
    });

    it('flags a drive the defence scored on, off the sign of pointsGained', () => {
        // Clemson's pick-six drive: -7 points, from THEIR point of view.
        const picked = { ...realDrive, offense: 'Clemson', offenseId: 228,
            result: 'Interception Touchdown', pointsGained: -7 };
        const [d] = buildDriveChart({ teams, drives: [picked] });
        expect(d.side).toBe('away');
        expect(d.points).toBe(-7);
        expect(d.scoredAgainst).toBe(true);
        expect(d.outcome).toBe('turnover');
    });

    it('does not call a scoreless drive "scored against"', () => {
        const [d] = buildDriveChart({ teams, drives: [{ ...realDrive, pointsGained: 0 }] });
        expect(d.scoredAgainst).toBe(false);
        // Nor one that is simply missing the field.
        const [e] = buildDriveChart({ teams, drives: [{ ...realDrive, pointsGained: null }] });
        expect(e.scoredAgainst).toBe(false);
    });

    it('leaves side null when the offense matches neither team', () => {
        const [d] = buildDriveChart({ teams, drives: [{ ...realDrive, offenseId: 4242 }] });
        expect(d.side).toBeNull();
    });

    it('handles an empty or absent payload', () => {
        expect(buildDriveChart({ teams, drives: [] })).toEqual([]);
        expect(buildDriveChart({})).toEqual([]);
        expect(buildDriveChart(null)).toEqual([]);
    });
});

describe('driveLabel', () => {
    it('renames only the last drive of a finished game', () => {
        expect(driveLabel('End of Half', true)).toBe('End of Game');
        expect(driveLabel('End Of Half', true)).toBe('End of Game');
        // Halftime, and any drive mid-game, keeps CFBD's wording.
        expect(driveLabel('End of Half', false)).toBe('End of Half');
    });

    it('leaves every other result alone', () => {
        expect(driveLabel('Touchdown', true)).toBe('Touchdown');
        expect(driveLabel('Punt', true)).toBe('Punt');
        expect(driveLabel(null, true)).toBeNull();
    });

    it('is applied by buildDriveChart only when the payload is final', () => {
        const drives = [{ result: 'End Of Half', startPeriod: 2 }, { result: 'End of Half', startPeriod: 4 }];
        const fin = buildDriveChart({ status: 'Final', drives });
        expect(fin.map(d => d.label)).toEqual(['End Of Half', 'End of Game']);
        // Mid-game the last drive is not the end of anything.
        const live = buildDriveChart({ status: 'In Progress', drives });
        expect(live.map(d => d.label)).toEqual(['End Of Half', 'End of Half']);
        // result stays raw either way.
        expect(fin[1].result).toBe('End of Half');
    });
});

describe('groupByPeriod', () => {
    it('groups consecutive plays under one heading', () => {
        const plays = buildPlayByPlay({
            drives: [drive([
                play({ period: 1 }), play({ period: 1 }),
                play({ period: 2 }), play({ period: 2 }), play({ period: 2 })
            ])]
        });
        const groups = groupByPeriod(plays);
        expect(groups.map(g => [g.label, g.plays.length])).toEqual([
            ['1ST QUARTER', 2],
            ['2ND QUARTER', 3]
        ]);
    });

    it('does not scatter a period that the feed revisits', () => {
        // Around a period boundary CFBD can emit an End Period row and then a
        // straggler. Sorting by period would merge them; grouping in encounter
        // order keeps the log readable and honest about the order received.
        const plays = buildPlayByPlay({
            drives: [drive([play({ period: 1 }), play({ period: 2 }), play({ period: 1 })])]
        });
        expect(groupByPeriod(plays).map(g => g.label)).toEqual(['1ST QUARTER', '2ND QUARTER', '1ST QUARTER']);
    });

    it('handles nothing', () => {
        expect(groupByPeriod([])).toEqual([]);
        expect(groupByPeriod(null)).toEqual([]);
    });
});

describe('scoringPlays', () => {
    it('keeps only the scoring plays, in order', () => {
        const plays = buildPlayByPlay({
            drives: [drive([
                play({ clock: '14:00' }),
                play({ clock: '12:07', homeScore: 7 }),
                play({ clock: '9:32', homeScore: 7 }),
                play({ clock: '7:57', homeScore: 7, awayScore: 3 })
            ])]
        });
        const scored = scoringPlays(plays);
        expect(scored.map(p => p.clock)).toEqual(['12:07', '7:57']);
    });

    it('handles nothing', () => {
        expect(scoringPlays([])).toEqual([]);
        expect(scoringPlays(null)).toEqual([]);
    });
});
