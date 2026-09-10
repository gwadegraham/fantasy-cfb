// Shapes a CFBD /live/plays payload into the play-by-play log the game detail
// page renders: a flat, ordered play list where each play knows whether it
// scored, which quarter it belongs to, and — for scoring plays — the drive it
// capped.
//
// Pure and server-side on purpose. The same shaping has to serve two different
// sources — a live payload straight from CFBD and a trimmed one read back from
// Mongo — and having one tested function do it is what keeps a finished game
// rendering identically to a live one. The client only groups and draws.

// How a scoring play is identified: the score CHANGED on this play, by an
// amount football allows.
//
// The alternative is matching playType against a list ('Passing Touchdown',
// 'Field Goal Good', 'Rushing Touchdown', 'Safety', 'Pass Interception Return'
// when returned for a score, …) or parsing playText, and both are guesses about
// CFBD's vocabulary that fail silently when it adds a case. The score is the
// definition of a scoring play, so it is what gets checked.
//
// CFBD reports homeScore/awayScore as the score AFTER the play, verified
// against a real game: the nine score changes in FSU–SMU reconcile exactly to
// the 27–24 final.
//
// But a raw delta is not enough, because CFBD emits occasional rows with the
// WRONG score stamped on them. Measured in LSU–Clemson (401856660): play 156,
// an ordinary 4th-quarter rush, carried the game's FINAL 51–10 while the score
// was 44–3, and the punt on the next row carried 44–3 again. A plain
// "did it change" test called both of those scoring plays and rendered them in
// the log carrying a score from the future, which reads as plays out of order.
//
// So a change is only believed when it is arithmetically possible:
//   - exactly one side's score went up, because a single play cannot score for
//     both teams;
//   - by 1 to 8, the range from a lone PAT to a touchdown plus a two-point try;
//   - and neither side went down, because scores do not.
// A row that fails those is corrupt, not scoring — and, importantly, it is not
// a trustworthy baseline either, so buildPlayByPlay does not advance the
// running score onto it. That is what stops one bad row from creating a second
// phantom change on the row after it.
const MAX_POINTS_ON_ONE_PLAY = 8;

// Classify a row's score against the running baseline. Returns one of:
//   'unknown'         the row carries no score, so it says nothing either way
//   'same'            a valid row with no points on this play
//   'invalid'         impossible arithmetic — a corrupt row
//   { side, points }  a real score, for 'home' or 'away'
//
// A missing baseline is read as 0–0 rather than as "anything goes": CFBD's feed
// opens at 0–0, so the first row is held to the same arithmetic as the rest,
// and a truncated feed that starts mid-game is rejected instead of announcing
// its opening score as a touchdown.
function classifyScore(play, prev) {
    if (!play) return 'unknown';
    const h = play.homeScore, a = play.awayScore;
    if (h == null || a == null) return 'unknown';

    // No baseline at all means the start of the feed, which CFBD opens at 0-0.
    // A baseline that EXISTS but carries a missing score is different: there is
    // nothing to compare against, and reading the gap as 0 would announce the
    // running total as this play's points.
    if (prev && (prev.homeScore == null || prev.awayScore == null)) return 'unknown';

    const ph = prev ? prev.homeScore : 0;
    const pa = prev ? prev.awayScore : 0;
    const dh = h - ph, da = a - pa;

    if (dh === 0 && da === 0) return 'same';
    if (dh < 0 || da < 0) return 'invalid';
    if (dh > 0 && da > 0) return 'invalid';

    const points = dh > 0 ? dh : da;
    if (points > MAX_POINTS_ON_ONE_PLAY) return 'invalid';
    return { side: dh > 0 ? 'home' : 'away', points };
}

function isScoringPlay(play, prev) {
    const c = classifyScore(play, prev);
    return c !== 'unknown' && c !== 'same' && c !== 'invalid';
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

// home/away -> teamId, from the payload's own teams block. Needed because a
// score is identified by which SIDE it landed on, while the page draws logos by
// team id.
function sideTeamIds(payload) {
    const out = { home: null, away: null };
    for (const t of (payload && payload.teams) || []) {
        if (t && t.homeAway && t.teamId != null && out[t.homeAway] === null) {
            out[t.homeAway] = t.teamId;
        }
    }
    return out;
}

// ---- play text -------------------------------------------------------------
//
// CFBD's playText is written for a box score, not for reading: a median play is
// ~110 characters and the worst are over 300, most of it repeated on every row.
// This trims it.
//
// Every rule here is SUBTRACTIVE and ANCHORED, which is what makes the whole
// thing safe. Nothing is reworded, reordered, or parsed into fields — a rule
// either matches a fixed shape and removes it, or does not match and the text
// survives verbatim. So the worst case of a CFBD wording change is the raw text
// we were already showing, never a wrong one. (Contrast the scoring-play
// detection above, where guessing at CFBD's vocabulary would fail silently and
// get the answer wrong. That is why that one reads the score instead.)
//
// Applied at shape time rather than at ingest, so the raw text stays in Mongo
// and a stored game picks up any later improvement without being refetched.

// Formations CFBD prefixes to the text. A list is a vocabulary guess, but it is
// a safe one: an unrecognized formation is simply left in place.
const FORMATION_PREFIXES = ['No Huddle-Shotgun', 'No Huddle', 'Shotgun', 'Pistol', 'Wildcat'];

const TEXT_RULES = [
    // The clock at the snap, always the first thing in the text. The card
    // already shows a clock — CFBD's play.clock, which is the clock AFTER the
    // play — so leaving this in put two different times on one row.
    [/^\(\d{1,2}:\d{2}\)\s*/, ''],

    // Formation, once the clock is out of the way.
    [new RegExp('^(?:' + FORMATION_PREFIXES.join('|') + ')\\s+'), ''],

    // A second copy of the clock, mid-sentence.
    [/,?\s*clock \d{1,2}:\d{2}/g, ''],

    // Holder and long snapper on a kick. Nobody reading a fantasy league's
    // play log needs the long snapper.
    [/\s*\((?:H|HOLD|LS):[^)]*\)/g, ''],

    // "for 32 yards to the CLEM00 TOUCHDOWN" — the goal line is where a
    // touchdown is, by definition. Matched only on `00` so a yard line that
    // somehow isn't the goal line is left alone.
    [/\s+to the [A-Z]{2,10}00 TOUCHDOWN/g, ' TOUCHDOWN']
];

function cleanPlayText(text) {
    if (!text || typeof text !== 'string') return text || null;
    let out = text;
    for (const [re, to] of TEXT_RULES) out = out.replace(re, to);
    // Tidy up after the cuts: doubled spaces, a space before punctuation, and a
    // dangling comma at the end.
    return out.replace(/\s{2,}/g, ' ').replace(/\s+([,.])/g, '$1').replace(/[,\s]+$/, '').trim() || null;
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
    const sides = sideTeamIds(payload);
    const out = [];
    let prev = null;

    drives.forEach((drive, driveIndex) => {
        const plays = drive && drive.plays ? drive.plays : [];
        plays.forEach((play, playIndex) => {
            const change = classifyScore(play, prev);
            const scoring = change !== 'unknown' && change !== 'same' && change !== 'invalid';
            const isLastOfDrive = playIndex === plays.length - 1;

            out.push({
                period: play.period != null ? play.period : null,
                periodLabel: periodLabel(play.period),
                clock: play.clock || null,
                team: play.team || null,
                teamId: play.teamId != null ? play.teamId : null,
                playType: play.playType || null,
                playText: cleanPlayText(play.playText),
                down: play.down != null ? play.down : null,
                distance: play.distance != null ? play.distance : null,
                yardsToGoal: play.yardsToGoal != null ? play.yardsToGoal : null,
                yardsGained: play.yardsGained != null ? play.yardsGained : null,
                homeScore: play.homeScore != null ? play.homeScore : null,
                awayScore: play.awayScore != null ? play.awayScore : null,
                scoring,
                // Who the points went to, and how many. NOT play.teamId, which
                // is the team on offense: on a pick-six or a fumble return the
                // offense is the team that gave the ball away, and attributing
                // the score to it put the wrong logo on the card. The side whose
                // score went up is the side that scored, by definition.
                scoringSide: scoring ? change.side : null,
                scoringTeamId: scoring ? sides[change.side] : null,
                points: scoring ? change.points : null,
                driveIndex,
                // Only attached to a scoring play, and only when it ends the
                // drive — a defensive score happens on the OTHER team's drive,
                // where that drive's "4 plays, 77 yards" would describe the
                // wrong team's possession.
                driveSummary: scoring && isLastOfDrive ? driveSummary(drive) : null
            });

            // Advance the running score on every believable row, scoring or
            // not, so a gap in one row doesn't shift every later comparison.
            // A row classified 'invalid' is skipped: its score is wrong, and
            // adopting it as the baseline is what turns one corrupt row into a
            // second phantom scoring play on the row after it.
            if (change === 'same' || scoring) prev = play;
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
    isScoringPlay, classifyScore, sideTeamIds, periodLabel, driveSummary,
    cleanPlayText, MAX_POINTS_ON_ONE_PLAY, FORMATION_PREFIXES
};
