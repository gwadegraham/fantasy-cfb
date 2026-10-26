// The basketball AP Top 25, for the rank shown beside team names.
//
// ONE CBBD call a day per basketball season (it returns every poll so far),
// ~30 a month while a basketball league exists — 0.1% of the 30k monthly
// quota. Daily rather than Monday-only: the poll lands Monday
// late morning Eastern, and every later day is a free retry if that run
// missed it. Display only — see modules/hoops-ap.js.
//
// Silent and free with no basketball league.

const jobLogger = require('./job-logger');
const jobMailer = require('./job-mailer');
const { guardJob } = require('./job-guard');
const hoopsAp = require('./hoops-ap');
const { basketballLeagues } = require('./hoops-scores-job');

const JOB_NAME = 'hoops-ap';
const LABEL = 'Hoops AP Poll';

// Wrapped so a failure BEFORE the per-season loop mails too (#574).
async function run({ now = new Date() } = {}) {
    return guardJob({ jobName: JOB_NAME, label: LABEL, now }, state => runOnce(now, state));
}

const day = (d) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

async function runOnce(now, state) {
    const leagues = await basketballLeagues();
    if (!leagues.length) return { skippedReason: 'no basketball leagues' };

    const done = [];
    let failed = null;
    const years = [...new Set(leagues.map(l => l.season))];
    for (const season of years) {
        try {
            const r = await hoopsAp.ingest(season);
            done.push(`${season}: ${r.polls} poll${r.polls === 1 ? '' : 's'}, ${r.rows} rows`
                + (r.latest ? `, latest ${day(r.latest)}` : ''));
        } catch (err) {
            failed = String((err && err.message) || err);
            done.push(`${season}: FAILED ${failed}`);
        }
    }

    const summary = done.join(' | ');
    const id = await jobLogger.startRun(JOB_NAME);
    state.id = id;
    await jobLogger.finishRun(id, failed ? 'error' : 'success', summary);
    console.log(`[${JOB_NAME}] ${summary}`);

    if (failed) {
        await jobMailer.sendJobEmail({
            label: LABEL, when: now.toLocaleString('en-US', { timeZone: 'America/Chicago' }), ok: false,
            rows: [['Seasons', years.map(String).join(', ')]],
            error: summary
        });
    }
    return { done, failed, summary };
}

module.exports = { run, JOB_NAME, LABEL };
