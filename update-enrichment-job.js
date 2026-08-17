if (process.env.NODE_ENV !== 'production') {
    require('dotenv').config();
}

const { internalFetch } = require('./modules/internal-api');
const { startRun, finishRun } = require('./modules/job-logger');
const { sendJobEmail, emailOnSuccess } = require('./modules/job-mailer');

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
//
// Like the scoring jobs, every run is recorded as a JobRun (start -> success/
// error) and a failure emails the run report. Without that this job was the one
// piece of automation with NO outward sign it had run: a broken weekly pull just
// left last week's SP+ sitting on the team docs, and the only symptom was
// standings projections that quietly stopped responding to results.
const JOB_NAME = 'enrichment';

async function run(opts = {}) {
    const startMs = Date.now();
    const when = new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' });
    const season = parseInt(process.argv[2], 10) || parseInt(process.env.YEAR, 10);
    // Weekly by default; 'preseason' (via opts or CLI arg) pulls everything.
    const preseason = opts.preseason || process.argv[3] === 'preseason';
    const scope = preseason ? 'all' : 'weekly';
    const label = `Enrichment (${scope})`;
    const results = {};

    async function post(path, body) {
        const res = await internalFetch(`${process.env.URL}${path}`, {
            method: 'POST',
            headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
            body: body ? JSON.stringify(body) : undefined
        });
        const resBody = await res.json().catch(() => ({}));
        if (res.status !== 200) console.log(`${path} -> ${res.status}:`, resBody.message || resBody);
        return { status: res.status, path, body: resBody };
    }

    const id = await startRun(JOB_NAME, { season: String(season) });
    try {
        results.teams = await post(`/teams/${season}/enrich`, { scope });
        results.media = await post(`/games/${season}/media`);

        // A non-200 from either leg means the data did NOT land. Recording that
        // as a success would reproduce the exact blind spot this logging exists
        // to close, so surface it as an error the same way a thrown one is.
        const failed = [results.teams, results.media].filter(r => r.status !== 200);
        if (failed.length) {
            throw new Error(failed.map(r => `${r.path} -> ${r.status}`
                + (r.body && r.body.message ? ` (${r.body.message})` : '')).join('; '));
        }

        const secs = Math.round((Date.now() - startMs) / 1000);
        const summary = `${scope} · ${results.teams.body.updated} teams enriched · `
            + `${results.media.body.updated} games given media (${secs}s)`;
        console.log(`[${JOB_NAME}] season ${season} (scope=${scope}):`,
            `teams enriched=${results.teams.body.updated}`,
            `media updated=${results.media.body.updated}`);
        await finishRun(id, 'success', summary);

        if (emailOnSuccess()) {
            await sendJobEmail({
                label, when, ok: true,
                rows: [
                    ['Season', String(season)],
                    ['Scope', scope],
                    ['Teams enriched', String(results.teams.body.updated)],
                    ['Games w/ media', String(results.media.body.updated)],
                    ['Duration', `${secs}s`]
                ]
            });
        }
        return results;
    } catch (err) {
        const secs = Math.round((Date.now() - startMs) / 1000);
        const msg = (err && err.message) ? err.message : String(err);
        console.error(`❌ ${label} failed:`, err);
        await finishRun(id, 'error', msg);
        await sendJobEmail({
            label, when, ok: false,
            rows: [['Season', String(season)], ['Scope', scope], ['Failed after', `${secs}s`]],
            error: (err && err.stack) ? err.stack : msg
        });
        throw err;
    }
}

module.exports = { run, JOB_NAME };
if (require.main === module) { run(); }
