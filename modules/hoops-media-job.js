// Weekly TV listings for the basketball game page (#506).
//
// ONE CBBD call a week per basketball season, Monday morning — see
// modules/hoops-media.js for the window. Weekly, not nightly: networks set
// basketball TV days to weeks ahead, so a two-week look-ahead refreshed
// once a week catches it. Monday also follows Selection Sunday, so the
// NCAA first round is in the window the morning after the bracket.
// What weekly misses: a conference-tournament game whose matchup is set
// the night before shows no TV until the next run. Accepted, at ~4 calls
// a month instead of ~30.
//
// Silent and free with no basketball league, or nothing stored in the
// window — the off-season costs nothing and writes no JobRun.

const jobLogger = require('./job-logger');
const hoopsMedia = require('./hoops-media');
const { basketballLeagues } = require('./hoops-scores-job');

const JOB_NAME = 'hoops-media';

async function run({ now = new Date() } = {}) {
    const leagues = await basketballLeagues();
    if (!leagues.length) return { skippedReason: 'no basketball leagues' };

    const done = [];
    let failed = null;
    for (const season of [...new Set(leagues.map(l => l.season))]) {
        try {
            const tv = await hoopsMedia.ingestWindow(season, { now: now.getTime() });
            if (tv.skippedReason) continue;
            // At the cap the window cannot be trusted to be whole; red on
            // the admin strip rather than a quiet "success".
            if (tv.capped) failed = 'media window hit the 3000-row cap';
            done.push(`${season} tv: ${tv.stored}/${tv.games} stored${tv.capped ? ' (HIT THE 3000-ROW CAP)' : ''}`);
        } catch (err) {
            failed = String((err && err.message) || err);
            done.push(`${season} tv: FAILED ${failed}`);
        }
    }
    if (!done.length) return { skippedReason: 'nothing scheduled' };

    const summary = done.join(' | ');
    const id = await jobLogger.startRun(JOB_NAME);
    await jobLogger.finishRun(id, failed ? 'error' : 'success', summary);
    console.log(`[${JOB_NAME}] ${summary}`);
    return { done, failed, summary };
}

module.exports = { run, JOB_NAME };
