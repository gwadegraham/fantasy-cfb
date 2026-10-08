// Scheduled import of basketball season stats for the team page (#494) and
// box scores for the game page (#503).
//
// Four CBBD calls a night, and only while there is something to refresh:
// skipped silently with no basketball league, and with no game gone final
// in the last three days — so the off-season and the gap before November
// cost nothing. Plus one for TV listings (modules/hoops-media.js), gated on
// its own: a game in the window, so the opener's channel is known before
// anything has gone final. Same shape and the same JobRun habits as hoops-scores-job.

const jobLogger = require('./job-logger');
const hoopsStats = require('./hoops-stats');
const boxScore = require('./hoops-box-score');
const hoopsMedia = require('./hoops-media');
const { basketballLeagues, LOOKBACK_MS } = require('./hoops-scores-job');
const HoopsGame = require('./../models/hoopsGame');

const JOB_NAME = 'hoops-stats';

async function run({ now = new Date() } = {}) {
    const leagues = await basketballLeagues();
    if (!leagues.length) return { skippedReason: 'no basketball leagues' };

    // Every basketball league plays the sport's active season today; the
    // set is still taken from the leagues so a league on its own season is
    // not left without stats.
    const years = [...new Set(leagues.map(l => l.season))];
    const since = new Date(now.getTime() - LOOKBACK_MS);
    const done = [];
    let failed = null;
    for (const season of years) {
        // TV listings first, with their own try and their own gate. A quiet
        // window adds nothing to the summary, so the off-season stays silent.
        try {
            const tv = await hoopsMedia.ingestWindow(season, { now: now.getTime() });
            if (tv.capped) failed = 'media window hit the 3000-row cap';
            if (!tv.skippedReason) done.push(`${season} tv: ${tv.stored}/${tv.games} stored${tv.capped ? ' (HIT THE 3000-ROW CAP)' : ''}`);
        } catch (err) {
            failed = String((err && err.message) || err);
            done.push(`${season} tv: FAILED ${failed}`);
        }
        const recent = await HoopsGame.exists({ season, status: 'final', startDate: { $gte: since } });
        if (!recent) continue;
        try {
            const out = await hoopsStats.importSeason(season);
            done.push(out.skippedReason
                ? `${season}: ${out.skippedReason}`
                : `${season}: ${out.teams} team(s), ${out.players} player(s)`);
        } catch (err) {
            failed = String((err && err.message) || err);
            done.push(`${season}: FAILED ${failed}`);
        }
        // Box scores for the game page, football's way: one batch for every
        // game that went final in the lookback, 2 calls. Its own try, so a
        // stats failure does not cost the boxes or the reverse.
        try {
            const box = await boxScore.ingestRecent(season, { now: now.getTime() });
            // A window at CBBD's 3,000-row cap cannot be trusted to be whole;
            // recorded as an ERROR so it shows red on the admin strip rather
            // than hiding in a "success" summary.
            if (box.capped) failed = 'box window hit the 3000-row cap';
            done.push(box.skippedReason
                ? `${season} boxes: ${box.skippedReason}`
                : `${season} boxes: ${box.stored}/${box.games} stored${box.capped ? ' (HIT THE 3000-ROW CAP — window incomplete)' : ''}`);
        } catch (err) {
            failed = String((err && err.message) || err);
            done.push(`${season} boxes: FAILED ${failed}`);
        }
    }
    if (!done.length) return { skippedReason: 'no recent results' };

    const summary = done.join(' | ');
    const id = await jobLogger.startRun(JOB_NAME);
    await jobLogger.finishRun(id, failed ? 'error' : 'success', summary);
    console.log(`[${JOB_NAME}] ${summary}`);
    return { done, failed, summary };
}

module.exports = { run, JOB_NAME };
