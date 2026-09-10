// Shapes a CFBD /live/plays payload into the play-by-play log the game detail
// page renders: a flat, ordered play list where each play knows whether it
// scored, which quarter it belongs to, and — for scoring plays — the drive it
// capped.
//
// Pure and server-side on purpose. The same shaping has to serve two different
// sources — a live payload straight from CFBD and a trimmed one read back from
// Mongo — and having one tested function do it is what keeps a finished game
// rendering identically to a live one. The client only groups and draws.

// How a scoring play is identified: the score CHANGED on this play.
//
// The alternative is matching playType against a list ('Passing Touchdown',
// 'Field Goal Good', 'Rushing Touchdown', 'Safety', 'Pass Interception Return'
// when returned for a score, …) or parsing playText, and both are guesses about
// CFBD's vocabulary that fail silently when it adds a case. The score is the
// definition of a scoring play, so it is what gets checked.
//
// CFBD reports homeScore/awayScore as the score AFTER the play, verified
// against a real game: the nine score changes in FSU–SMU reconcile exactly to
// the 27–24 final. A missing score is treated as no change rather than as 0,
// so a gap in the feed can't invent a scoring play or wipe the running total.
function isScoringPlay(play, prev) {
    if (!play) return false;
    const h = play.homeScore, a = play.awayScore;
    if (h == null || a == null) return false;
    if (!prev) return h > 0 || a > 0;
    const ph = prev.homeScore, pa = prev.awayScore;
    if (ph == null || pa == null) return false;
    return h !== ph || a !== pa;
}

// Quarter heading. Periods past 4 are overtime — CFBD keeps counting (5, 6, …)
// so the label counts OT periods rather than showing "5TH QUARTER".
function periodLabel(period) {
    if (period == null) return 'PREGAME';
    if (period <= 0) return 'PREGAME';
    if (period === 1) return '1ST QUARTER';
    if (period === 2) return '2ND QUARTER';
    if (period === 3) return '3RD QUARTER';
    if (period === 4) return '4TH QUARTER';
    if (period === 5) return 'OVERTIME';
    return `${period - 4}OT`;
}

// The drive summary shown under a scoring play ("4 plays, 77 yards, 1:40").
// Assembled from whichever parts are present so a drive missing its duration
// still reads correctly instead of rendering "4 plays, 77 yards, null".
function driveSummary(drive) {
    if (!drive) return null;
    const parts = [];
    if (drive.playCount != null) parts.push(`${drive.playCount} play${drive.playCount === 1 ? '' : 's'}`);
    if (drive.yards != null) parts.push(`${drive.yards} yard${drive.yards === 1 ? '' : 's'}`);
    if (drive.duration) parts.push(drive.duration);
    return parts.length ? parts.join(', ') : null;
}

// Flatten drives into one ordered play list.
//
// Order comes from the payload — drives in sequence, plays in sequence within a
// drive — deliberately NOT from sorting by clock. A clock sort would be wrong
// twice over: it counts down within a period, and CFBD emits "End Period" and
// timeout rows whose clocks repeat. The feed's own order is the game's order.
function buildPlayByPlay(payload) {
    const drives = (payload && payload.drives) || [];
    const out = [];
    let prev = null;

    drives.forEach((drive, driveIndex) => {
        const plays = drive && drive.plays ? drive.plays : [];
        plays.forEach((play, playIndex) => {
            const scoring = isScoringPlay(play, prev);
            const isLastOfDrive = playIndex === plays.length - 1;

            out.push({
                period: play.period != null ? play.period : null,
                periodLabel: periodLabel(play.period),
                clock: play.clock || null,
                team: play.team || null,
                teamId: play.teamId != null ? play.teamId : null,
                playType: play.playType || null,
                playText: play.playText || null,
                down: play.down != null ? play.down : null,
                distance: play.distance != null ? play.distance : null,
                yardsToGoal: play.yardsToGoal != null ? play.yardsToGoal : null,
                yardsGained: play.yardsGained != null ? play.yardsGained : null,
                homeScore: play.homeScore != null ? play.homeScore : null,
                awayScore: play.awayScore != null ? play.awayScore : null,
                scoring,
                driveIndex,
                // Only attached to a scoring play, and only when it ends the
                // drive — a defensive score happens on the OTHER team's drive,
                // where that drive's "4 plays, 77 yards" would describe the
                // wrong team's possession.
                driveSummary: scoring && isLastOfDrive ? driveSummary(drive) : null
            });

            // Advance the running score on every play with a score, scoring or
            // not, so a gap in one row doesn't shift every later comparison.
            if (play.homeScore != null && play.awayScore != null) prev = play;
        });
    });

    return out;
}

// Group an ordered play list into quarters for rendering. Groups in encounter
// order rather than by sorting on period, so a feed that revisits a period
// (it happens around period boundaries) doesn't scatter plays into two headings.
function groupByPeriod(plays) {
    const groups = [];
    let current = null;
    for (const play of plays || []) {
        if (!current || current.period !== play.period) {
            current = { period: play.period, label: play.periodLabel, plays: [] };
            groups.push(current);
        }
        current.plays.push(play);
    }
    return groups;
}

// Scoring plays only, still ordered. The default tab: nine rows for a whole
// game against ~173 for every play.
function scoringPlays(plays) {
    return (plays || []).filter(p => p.scoring);
}

module.exports = {
    buildPlayByPlay, groupByPeriod, scoringPlays,
    isScoringPlay, periodLabel, driveSummary
};
