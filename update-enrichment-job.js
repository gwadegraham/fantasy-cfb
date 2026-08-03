if (process.env.NODE_ENV !== 'production') {
    require('dotenv').config();
}

const { internalFetch } = require('./modules/internal-api');

// Pulls opponent-agnostic CFBD data onto each team's season, plus broadcast
// outlets onto games. Two cadences (the enrich route splits by `scope`):
//   weekly (default)  — SP+/FPI ratings + media = ~3 CFBD calls. Safe to run
//                       every week; this is what modules/scheduler.js fires.
//   preseason         — adds talent, returning production, coaches (all fixed
//                       for the season) = ~6 CFBD calls. Run ONCE before the
//                       season, ideally before the draft.
// Timing for the weekly run is owned by modules/scheduler.js; running this file
// directly is a manual fallback:
//   node update-enrichment-job.js 2026            (weekly: ratings + media)
//   node update-enrichment-job.js 2026 preseason  (full: adds talent/returning/coaches)
const JOB_NAME = 'enrichment';

async function run(opts = {}) {
    const season = parseInt(process.argv[2], 10) || parseInt(process.env.YEAR, 10);
    // Weekly by default; 'preseason' (via opts or CLI arg) pulls everything.
    const preseason = opts.preseason || process.argv[3] === 'preseason';
    const scope = preseason ? 'all' : 'weekly';
    const results = {};

    async function post(path, body) {
        const res = await internalFetch(`${process.env.URL}${path}`, {
            method: 'POST',
            headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
            body: body ? JSON.stringify(body) : undefined
        });
        const resBody = await res.json().catch(() => ({}));
        if (res.status !== 200) console.log(`${path} -> ${res.status}:`, resBody.message || resBody);
        return { status: res.status, body: resBody };
    }

    results.teams = await post(`/teams/${season}/enrich`, { scope });
    results.media = await post(`/games/${season}/media`);

    console.log(`[${JOB_NAME}] season ${season} (scope=${scope}):`,
        `teams enriched=${results.teams.body.updated}`,
        `media updated=${results.media.body.updated}`);
    return results;
}

module.exports = { run, JOB_NAME };
if (require.main === module) { run(); }
