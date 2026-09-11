// "What season is it?" for a process that has no database connection.
//
// The four ingest jobs (update-season-stats-job.js and friends) are pure HTTP
// clients — they never mongoose.connect, so modules/active-season.js can only
// ever answer them from process.env.YEAR. Run in-process by the scheduler they
// get the primed cache and the right answer; run standalone with `heroku run`
// they got the env var, which after a rollover is the WRONG season. Same line
// of code, two answers depending on how the process started.
//
// So ask the server, which does have the database. Order of preference:
//
//   1. the primed in-process cache, when there is one (the scheduler path)
//   2. GET /seasons/:sport over the internal API (the standalone path)
//   3. process.env.YEAR, so a job still runs if the API is unreachable
//
// Kept out of active-season.js deliberately: that module stays DB-only and
// synchronous, and this one is async and HTTP-only.

const { internalFetch } = require('./internal-api');
const { activeSeason, primed } = require('./active-season');

async function remoteSeason(sport) {
    if (primed()) {
        const cached = activeSeason(sport);
        if (cached != null) return cached;
    }

    try {
        const res = await internalFetch(`${process.env.URL}/seasons/${sport}`, {
            headers: { Accept: 'application/json' }
        });
        if (res.ok) {
            const body = await res.json();
            const season = Number(body && body.season);
            if (Number.isFinite(season)) return season;
        } else {
            console.error(`remote-season: GET /seasons/${sport} answered ${res.status}`);
        }
    } catch (err) {
        console.error(`remote-season: GET /seasons/${sport} failed:`, err.message);
    }

    // Last resort. Loud, because after a rollover this is the stale answer and
    // the job is about to ingest the wrong season.
    const year = Number(process.env.YEAR);
    if (Number.isFinite(year)) {
        console.error(`remote-season: falling back to process.env.YEAR=${year} for ${sport} — verify this is the current season`);
        return year;
    }
    return null;
}

module.exports = { remoteSeason };
