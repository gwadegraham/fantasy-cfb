const schedule = require('node-schedule');

// All schedules are Central time. node-schedule honors the tz (DST-aware),
// unlike a UTC-only cron. Specs are data so tests can assert them.
const TZ = 'America/Chicago';

const JOB_SCHEDULES = [
    { job: 'daily-scores', modulePath: '../update-daily-scores-job', rule: { hour: 23, minute: 0 } },
    { job: 'saturday-scores', modulePath: '../update-saturday-scores-job', rule: { dayOfWeek: 6, hour: [10, 15, 18, 22], minute: 0 } },
    { job: 'sunday-scores', modulePath: '../update-sunday-scores-job', rule: { dayOfWeek: 0, hour: [3, 6], minute: 0 } },
    // Weekly enrichment (all 5 team endpoints, the full season schedule, and
    // broadcast outlets). Tuesday morning, after the weekend's ratings have
    // refreshed and after the week's kickoff times are announced. ~9 CFBD calls.
    { job: 'enrichment', modulePath: '../update-enrichment-job', rule: { dayOfWeek: 2, hour: 5, minute: 30 } },
    // Weekly season stats (CFBD /stats/season). 1 API call, all FBS teams.
    { job: 'season-stats', modulePath: '../update-season-stats-job', rule: { dayOfWeek: 2, hour: 6, minute: 0 } },
    // Weekly player season leaders (CFBD /stats/player/season). 1 API call, all FBS teams.
    { job: 'player-season-leaders', modulePath: '../update-player-season-leaders-job', rule: { dayOfWeek: 2, hour: 6, minute: 30 } }
];

// Opt-in game-day live poller (modules/live-poll.js). Fires every 10 seconds;
// the module's own games-live gate (a local DB check, 0 CFBD calls) skips
// immediately when no game is in progress, so non-game times cost nothing.
// Kept OUT of the always-on JOB_SCHEDULES and gated behind LIVE_POLL_ENABLED=true
// so it can be switched on/off independently of the core scoring jobs.
//
// The cadence is a product choice, not a budget one. CFBD does not bill
// /scoreboard, so a poll is free however often it runs, and the debounce in
// modules/completion-flush.js means a tighter cadence no longer multiplies the
// heavy per-final pass — that used to run once per tick containing a final, so
// halving the interval bought the same finals at twice the cost.
//
// Why 10s and not 30s. CFBD's /scoreboard only publishes a new clock every
// ~40s, so a tighter poll does NOT fetch more distinct values — measured on
// OU/Michigan, 2026 wk 3: the feed held "01:22" from 18:46:39 to 18:47:23,
// situation string included. What it fixes is PHASE. At 30s we landed up to
// 30s after each CFBD update regardless of how granular the feed is; the same
// game showed CFBD flipping to "01:16" at 18:47:32 and our API not serving it
// until 18:48:01 — 29 seconds of pure waiting. 10s caps that wait at 10s.
//
// The remaining lag is CFBD's own: its feed ran ~40s behind the broadcast in
// that sample. No cadence here touches that.
const LIVE_POLL_SCHEDULE = {
    job: 'live-scores', modulePath: '../modules/live-poll',
    rule: { second: [0, 10, 20, 30, 40, 50] }
};

function livePollEnabled() { return process.env.LIVE_POLL_ENABLED === 'true'; }

function toRule(spec) {
    const r = new schedule.RecurrenceRule();
    if (spec.dayOfWeek != null) r.dayOfWeek = spec.dayOfWeek;
    // Leave hour unset for jobs that run every hour (e.g. the live poller); an
    // unset field means "any" in node-schedule.
    if (spec.hour != null) r.hour = spec.hour;
    if (spec.minute != null) r.minute = spec.minute;
    // Left unset, node-schedule's own default is second 0 — which is what every
    // job but the live poller wants, and why an unset second doesn't fire 60
    // times a minute.
    if (spec.second != null) r.second = spec.second;
    r.tz = TZ;
    return r;
}

// Registers the recurring jobs. Each job's own run() already logs and emails;
// we just guard against an unhandled rejection here. The live poller is included
// only when LIVE_POLL_ENABLED=true.
function start() {
    const schedules = JOB_SCHEDULES.slice();
    if (livePollEnabled()) schedules.push(LIVE_POLL_SCHEDULE);

    schedules.forEach(function (s) {
        const mod = require(s.modulePath);
        schedule.scheduleJob(toRule(s.rule), function () {
            Promise.resolve().then(function () { return mod.run(); })
                .catch(function (err) { console.error(`Scheduled ${s.job} failed:`, err); });
        });
        console.log(`Scheduled ${s.job}:`, JSON.stringify(s.rule), TZ);
    });
}

module.exports = { start, JOB_SCHEDULES, LIVE_POLL_SCHEDULE, livePollEnabled, TZ, toRule };
