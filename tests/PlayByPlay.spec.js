const {
    buildPlayByPlay, groupByPeriod, scoringPlays,
    isScoringPlay, periodLabel, driveSummary
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
