if (process.env.NODE_ENV !== 'production') {
    require('dotenv').config();
}

const { internalFetch } = require('./modules/internal-api');

// Pulls opponent-agnostic CFBD data (SP+/FPI ratings, talent, returning
// production, coaches) onto each team's season, and broadcast outlets onto
// games. Cheap on the CFBD budget: ~6 calls total per run (each endpoint
// returns the whole season), so it's safe to run weekly. Timing is owned by
// modules/scheduler.js; running this file directly is a manual fallback:
//   node update-enrichment-job.js 2025
const JOB_NAME = 'enrichment';

async function run() {
    const season = parseInt(process.argv[2], 10) || parseInt(process.env.YEAR, 10);
    const results = {};

    async function post(path) {
        const res = await internalFetch(`${process.env.URL}${path}`, {
            method: 'POST',
            headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' }
        });
        const body = await res.json().catch(() => ({}));
        if (res.status !== 200) console.log(`${path} -> ${res.status}:`, body.message || body);
        return { status: res.status, body };
    }

    results.teams = await post(`/teams/${season}/enrich`);
    results.media = await post(`/games/${season}/media`);

    console.log(`[${JOB_NAME}] season ${season}:`,
        `teams enriched=${results.teams.body.updated}`,
        `media updated=${results.media.body.updated}`);
    return results;
}

module.exports = { run, JOB_NAME };
if (require.main === module) { run(); }
