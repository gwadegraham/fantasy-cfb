if (process.env.NODE_ENV !== 'production') {
    require('dotenv').config();
}

const { internalFetch } = require('./modules/internal-api');
const { startRun, finishRun } = require('./modules/job-logger');
const { sendJobEmail, emailOnSuccess } = require('./modules/job-mailer');
const { getCalendar } = require('./modules/cfbd-calendar');
const { resolveCurrentWeek } = require('./modules/score-update');

// Pulls opponent-agnostic CFBD data onto each team's season, plus broadcast
// outlets onto games. Every run pulls all 5 team endpoints (SP+, FPI, talent,
// returning production, coaches) = ~5 CFBD calls for the enrich leg. With the
// 5k/mo Tier 1 budget this is cheap enough to run weekly.
//
// The 'preseason' flag now only controls whether pregame WP / weather / stat
// retries are skipped (no games to score yet).
//
// Timing for the weekly run is owned by modules/scheduler.js; running this file
// directly is a manual fallback:
//   node update-enrichment-job.js 2026
//   node update-enrichment-job.js 2026 preseason  (skips WP/weather/stat-retry)
//
// Like the scoring jobs, every run is recorded as a JobRun (start -> success/
// error) and a failure emails the run report.
const JOB_NAME = 'enrichment';

async function run(opts = {}) {
    const startMs = Date.now();
    const when = new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' });
    const season = parseInt(process.argv[2], 10) || parseInt(process.env.YEAR, 10);
    const preseason = opts.preseason || process.argv[3] === 'preseason';
    const label = `Enrichment${preseason ? ' (preseason)' : ''}`;
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

    // Resolve the current CFBD week so SP+ snapshots and pregame WP are tagged.
    let currentWeek = null;
    try {
        const calendar = await getCalendar(season);
        const resolved = resolveCurrentWeek(calendar, new Date());
        if (resolved && !resolved.skip) currentWeek = resolved.week;
    } catch (e) {
        console.log(`[${JOB_NAME}] could not resolve current week: ${e.message}`);
    }

    const id = await startRun(JOB_NAME, { season: String(season) });
    try {
        const enrichBody = { scope: 'all' };
        if (currentWeek != null) enrichBody.week = currentWeek;
        results.teams = await post(`/teams/${season}/enrich`, enrichBody);
        results.media = await post(`/games/${season}/media`);

        // Pregame win probabilities: fetch for the current week (weekly runs).
        // Preseason runs skip this — no games to project yet.
        if (!preseason && currentWeek != null) {
            results.pregameWP = await post(`/games/${season}/pregame-wp`, { week: currentWeek });
            results.weather = await post(`/games/${season}/weather`, { week: currentWeek });
        }

        // Retry stat-based parlay legs whose box scores weren't available on
        // first resolution (1 CFBD call max, non-fatal).
        if (!preseason) {
            try {
                results.statRetry = await post('/betting/retry-stat-legs', { season });
            } catch (e) {
                console.log(`[${JOB_NAME}] stat-leg retry warning:`, e.message);
            }
        }

        // A non-200 from a core leg means the data did NOT land.
        const coreLeg = [results.teams, results.media].filter(r => r.status !== 200);
        if (coreLeg.length) {
            throw new Error(coreLeg.map(r => `${r.path} -> ${r.status}`
                + (r.body && r.body.message ? ` (${r.body.message})` : '')).join('; '));
        }
        // Pregame WP / weather failures are non-fatal — log but don't fail.
        if (results.pregameWP && results.pregameWP.status !== 200) {
            console.log(`[${JOB_NAME}] pregame WP warning:`, results.pregameWP.body.message || results.pregameWP.status);
        }
        if (results.weather && results.weather.status !== 200) {
            console.log(`[${JOB_NAME}] weather warning:`, results.weather.body.message || results.weather.status);
        }

        const wpUpdated = results.pregameWP ? (results.pregameWP.body.updated || 0) : 0;
        const wxUpdated = results.weather ? (results.weather.body.updated || 0) : 0;
        const statRetried = results.statRetry ? (results.statRetry.body.retried || 0) : 0;
        const statResolved = results.statRetry ? (results.statRetry.body.resolved || 0) : 0;
        const secs = Math.round((Date.now() - startMs) / 1000);
        const summary = `${results.teams.body.updated} teams enriched · `
            + `${results.media.body.updated} games given media`
            + (wpUpdated ? ` · ${wpUpdated} games given pregame WP` : '')
            + (wxUpdated ? ` · ${wxUpdated} games given weather` : '')
            + (statRetried ? ` · ${statRetried} box score retries → ${statResolved} parlays resolved` : '')
            + ` (${secs}s)`;
        console.log(`[${JOB_NAME}] season ${season} (scope=all):`,
            `teams enriched=${results.teams.body.updated}`,
            `media updated=${results.media.body.updated}`,
            wpUpdated ? `pregameWP updated=${wpUpdated}` : '',
            wxUpdated ? `weather updated=${wxUpdated}` : '',
            statRetried ? `statRetry=${statRetried} resolved=${statResolved}` : '');
        await finishRun(id, 'success', summary);

        if (emailOnSuccess()) {
            await sendJobEmail({
                label, when, ok: true,
                rows: [
                    ['Season', String(season)],
                    ['Scope', 'all'],
                    ['Week', currentWeek != null ? String(currentWeek) : 'n/a'],
                    ['Teams enriched', String(results.teams.body.updated)],
                    ['Games w/ media', String(results.media.body.updated)],
                    ['Pregame WP', String(wpUpdated)],
                    ['Weather', String(wxUpdated)],
                    ['Stat leg retries', statRetried ? `${statRetried} box scores → ${statResolved} parlays` : '0'],
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
            rows: [['Season', String(season)], ['Scope', 'all'], ['Failed after', `${secs}s`]],
            error: (err && err.stack) ? err.stack : msg
        });
        throw err;
    }
}

module.exports = { run, JOB_NAME };
if (require.main === module) { run(); }
