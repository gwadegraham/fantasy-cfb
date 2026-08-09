// Pure, DB-free "is this season ready to draft?" check.
//
// Sibling of modules/admin-status.js, which answers the IN-SEASON question ("is
// scoring caught up?"). This one answers the PRESEASON question, because that is
// where the dangerous failures live: per docs/season-flip-runbook.md, skipping
// the schedule ingest makes every projection and draft grade compute from
// postseason points only — "a full, convincing-but-wrong payload with no error
// and no empty state". Same for CFP odds (falls back to an SP+-rank proxy) and
// preseason enrichment (silently reuses last year's ratings).
//
// None of those announce themselves. This turns all of them into one screen.
//
// Kept free of Mongoose/Express so it's unit-testable; routes/scores.js gathers
// the counts and hands them here. Reads only — no writes, no CFBD calls.

// Coverage thresholds. A season-wide data load either lands for essentially
// every FBS team or didn't run, so anything short of near-total coverage means
// a partial/failed load worth looking at rather than a healthy state.
const COVERAGE_READY = 0.9;

// Odds boards only list contenders, so coverage is the wrong lens — a couple of
// dozen priced teams is a fully-loaded board.
const ODDS_MIN_TEAMS = 15;

function pct(n, total) {
    if (!total) return 0;
    return n / total;
}

// One check row. `required` marks a check the draft actually depends on;
// informational rows report state but never hold the season back.
function check(key, label, status, detail, opts) {
    return Object.assign({ key, label, status, detail, required: true }, opts || {});
}

// Coverage-style check: ready at >=90% of teams, partial if any, missing at 0.
function coverageCheck(key, label, have, total, opts) {
    const ratio = pct(have, total);
    const status = ratio >= COVERAGE_READY ? 'ready' : (have > 0 ? 'partial' : 'missing');
    const detail = total
        ? `${have} of ${total} teams`
        : 'No teams loaded';
    return check(key, label, status, detail, opts);
}

// Platform-wide data loads — shared by every league.
//
//   teamTotal        FBS teams on file
//   teamsWith        { talent, spRating, expectedWins, cfpOdds } counts for the season
//   scheduledTeams   distinct teams with >=1 regular-season game
//   gameCount        regular-season games loaded
function platformChecks({ season, teamTotal, teamsWith, scheduledTeams, gameCount }) {
    const w = teamsWith || {};
    return [
        // The runbook's most-forgotten step, and the one that fails most quietly.
        Object.assign(
            coverageCheck('schedule', 'Full schedule ingested', scheduledTeams, teamTotal, {
                fix: 'Ingest Full Schedule',
                whyItMatters: 'Without it every projection and draft grade computes from postseason points only — wrong, with no error shown.'
            }),
            { detail: gameCount ? `${gameCount} games · ${scheduledTeams} of ${teamTotal} teams` : 'No games loaded' }
        ),
        coverageCheck('enrichment', 'Preseason enrichment', w.talent || 0, teamTotal, {
            fix: 'Refresh Ratings & Broadcasts',
            whyItMatters: 'Talent, returning production and coaches are pulled once preseason. Missing, the pool and grades silently reuse last season.'
        }),
        coverageCheck('expectedWins', 'Expected wins', w.expectedWins || 0, teamTotal, {
            fix: 'Refresh Expected Wins',
            whyItMatters: 'Feeds the projection engine behind draft grades.'
        }),
        // Only contenders get priced, so this is a presence check, not coverage.
        check('cfpOdds', 'CFP odds',
            (w.cfpOdds || 0) >= ODDS_MIN_TEAMS ? 'ready' : ((w.cfpOdds || 0) > 0 ? 'partial' : 'missing'),
            (w.cfpOdds || 0) ? `${w.cfpOdds} teams priced` : 'No odds loaded',
            {
                fix: 'Update CFP Odds',
                whyItMatters: 'Missing, the CFP factor falls back to an SP+-rank proxy — degraded, and not obviously so.'
            }),
        // SP+ legitimately lags: CFBD doesn't publish the new season's ratings
        // until close to kickoff, and the engine falls back to the prior year in
        // the meantime. So this reports state without ever blocking.
        Object.assign(
            coverageCheck('spPlus', `SP+ ratings (${season})`, w.spRating || 0, teamTotal, {
                required: false,
                fix: 'Refresh Ratings & Broadcasts',
                whyItMatters: 'CFBD publishes these close to kickoff; until then the engine falls back to last season. Not a blocker.'
            }),
            { note: (w.spRating || 0) === 0 ? 'Not published yet — using last season' : null }
        )
    ];
}

// Per-league setup.
//
//   members    managers with an entry for this season
//   draft      the season's Draft doc (or null)
//   engagement resolved game modes for the season (or null)
function leagueChecks({ members, draft, engagement }) {
    const order = (draft && draft.draftOrder) || [];
    const picks = (draft && draft.picks) || [];
    const rounds = (draft && draft.totalRounds) || 10;
    let draftStatus, draftDetail, draftNote = null;
    if (!draft) {
        draftStatus = 'missing';
        draftDetail = 'No draft configured';
    } else if (draft.status === 'active' && picks.length) {
        // A draft left mid-run — a test run that was never reset is the usual
        // cause. It reads as configured but is anything but: settings are LOCKED
        // while active (POST /draft 409s), the room resumes at the next pick with
        // those teams already gone, and rosters stay empty because teams are only
        // written on completion. This row used to call that "ready".
        draftStatus = 'partial';
        draftDetail = `In progress — ${picks.length} of ${order.length * rounds} picks made`;
        draftNote = 'Reset it before draft night if this was a test run.';
    } else if (draft.status === 'complete') {
        draftStatus = 'ready';
        draftDetail = `Drafted — ${picks.length} picks`;
    } else if (order.length < 2) {
        draftStatus = 'partial';
        draftDetail = 'Configured, but no pick order set';
    } else if (!draft.scheduledAt) {
        draftStatus = 'partial';
        draftDetail = `${order.length} managers in order · no date set`;
    } else {
        draftStatus = 'ready';
        draftDetail = `${order.length} managers · ${draft.snake ? 'snake' : 'linear'} · ${rounds} rounds`;
    }

    const modes = [];
    if (engagement && engagement.h2hEnabled) modes.push(`H2H +${engagement.h2hWinBonus}${engagement.h2hTieBonus ? '/+' + engagement.h2hTieBonus + ' tie' : ''}`);
    if (engagement && engagement.captainEnabled) modes.push(`Captain ×${engagement.captainMultiplier}`);

    return [
        check('roster', 'Season roster', members >= 2 ? 'ready' : (members === 1 ? 'partial' : 'missing'),
            members ? `${members} manager${members === 1 ? '' : 's'}` : 'Nobody added yet',
            {
                fix: 'Season Roster',
                whyItMatters: 'Written against the ACTIVE season, so it only works after YEAR is flipped. Missing, Standings and My Team are empty.'
            }),
        check('draft', 'Draft configured', draftStatus, draftDetail, {
            fix: 'Configure Draft',
            whyItMatters: draftNote
                || 'The draft room reads this doc — without it the room shows "no draft scheduled".',
            note: draftNote
        }),
        // Genuinely optional: a classic league runs neither mode. Never a blocker.
        check('gameModes', 'Game modes', modes.length ? 'ready' : 'off',
            modes.length ? modes.join(' · ') : 'Classic scoring (no game modes)',
            {
                required: false,
                fix: 'Game Modes',
                whyItMatters: 'Per season and off by default — a season with no entry runs classic.'
            })
    ];
}

// The whole picture. `leagues` is [{ code, name, members, draft, engagement }].
// `seasonUnderway` (a real result has landed) is echoed back so the client can
// retire the panel without having to consult a second endpoint for the answer.
function computeSeasonReadiness({ season, teamTotal, teamsWith, scheduledTeams, gameCount, leagues, seasonUnderway }) {
    const platform = platformChecks({ season, teamTotal, teamsWith, scheduledTeams, gameCount });
    const leagueRows = (leagues || []).map(l => ({
        league: l.code,
        name: l.name || l.code,
        checks: leagueChecks(l)
    }));

    const all = platform.concat(...leagueRows.map(l => l.checks));
    const blocking = all.filter(c => c.required && c.status !== 'ready');

    return {
        season: String(season),
        seasonUnderway: !!seasonUnderway,
        platform,
        leagues: leagueRows,
        // Every required miss, for the "N steps outstanding" count. Keys repeat
        // when several leagues miss the same thing — two leagues without a
        // roster genuinely is two steps, so the duplication is the point.
        blocking: blocking.map(c => c.key),
        ready: blocking.length === 0
    };
}

module.exports = {
    computeSeasonReadiness, platformChecks, leagueChecks,
    COVERAGE_READY, ODDS_MIN_TEAMS
};
