const { runFullUpdate } = require('./score-update');
const { startRun, finishRun } = require('./job-logger');
const { sendJobEmail } = require('./job-mailer');

// Builds a job's run(): logs the run (start -> success/error), executes the
// shared pipeline, and emails a run report. The three score jobs differ only in
// name/label and whether they refresh betting lines, so they share this.
function makeJob({ jobName, label, withBetting }) {
    return async function run() {
        const startMs = Date.now();
        const when = new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' });
        console.log(`${label} starting`, when);
        const id = await startRun(jobName, { season: process.env.YEAR });
        try {
            const r = await runFullUpdate({ withBetting: !!withBetting });
            const secs = Math.round((Date.now() - startMs) / 1000);
            const summary = `Updated ${r.seasonType} week ${r.week} · ${r.gamesNew} new / ${r.gamesUpdated} updated games · ${r.teams} teams (${secs}s)`;
            await finishRun(id, 'success', summary, { week: r.week, seasonType: r.seasonType });
            await sendJobEmail({
                label: label,
                when: when,
                ok: true,
                rows: [
                    ['Season', `${r.seasonType} ${process.env.YEAR}`],
                    ['Week', String(r.week)],
                    ['Games', `${r.gamesNew} new · ${r.gamesUpdated} updated`],
                    ['Teams', String(r.teams)],
                    ['Duration', `${secs}s`]
                ]
            });
            return r;
        } catch (err) {
            const secs = Math.round((Date.now() - startMs) / 1000);
            const msg = (err && err.message) ? err.message : String(err);
            console.error(`❌ ${label} failed:`, err);
            await finishRun(id, 'error', msg);
            await sendJobEmail({
                label: label,
                when: when,
                ok: false,
                rows: [['Failed after', `${secs}s`]],
                error: (err && err.stack) ? err.stack : msg
            });
            throw err;
        }
    };
}

module.exports = { makeJob };
