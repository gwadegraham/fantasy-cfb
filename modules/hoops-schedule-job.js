// The basketball schedule, kept current going FORWARD.
//
// The nightly hoops-scores refresh only looks BACK (LOOKBACK_MS), so a game
// is created, and its tip time corrected, only once it has been played.
// Scoring never minded; everything that reads the schedule ahead of time
// did — tip-off pushes, the draft pool's schedule flags, the team and game
// pages. Before this job only the admin Schedule button pulled ahead, and
// nobody presses it: on 21 Oct 2026 CBBD had 759 games we did not (the
// whole Pac-12 conference slate among them) and 1,777 tip times we still
// had as TBD.
//
// Same upsert as the nightly refresh (routes/hoopsGames refreshResults), so
// a stored final keeps its result and a re-run is harmless. It only adds
// and updates: a game CBBD drops stays stored (#512 hides those).
//
// 1 CBBD call a day per season type in the window — a LOOKAHEAD_DAYS window
// is one /games window — so ~30 a month, ~60 from February to April while
// the postseason is pulled too. Silent and free with no basketball league,
// or nothing scheduled in the window.
//
// After the CBBD pull, tip times CBBD still has as TBD are filled from ESPN's
// scoreboard (modules/hoops-espn-tip-times.js) — free, about one call per
// Eastern day in the window that has a TBD game. ESPN being down is reported
// in the summary but is not a failure: those games simply stay TBD.
//
// It does NOT replace the admin Schedule button: regular games are only
// asked for when some are already stored in the window, so a new season's
// first ingest is still the button's job.

const jobLogger = require('./job-logger');
const jobMailer = require('./job-mailer');
const { guardJob } = require('./job-guard');
const { basketballLeagues, POSTSEASON_DISCOVERY_MS } = require('./hoops-scores-job');
const HoopsGame = require('../models/hoopsGame');
// A namespace, so a test can stand in for the CBBD-backed refresh.
const hoopsGames = require('../routes/hoopsGames');
const espnTipTimes = require('./hoops-espn-tip-times');
const calendar = require('./hoops-calendar');

const JOB_NAME = 'hoops-schedule';
const LABEL = 'Hoops Schedule';

// Four weeks: far enough that a newly announced tip time lands before
// anyone needs it, and still inside one /games window (WINDOW_DAYS), so
// the job costs one call per season type, not two.
const LOOKAHEAD_DAYS = 28;
const DAY_MS = 24 * 60 * 60 * 1000;

// Which season types to ask CBBD for, looking ahead. NOT the nightly
// refresh's seasonTypesToRefresh: that one measures "the regular season
// ended within 45 days" from the window's END, which pointed 28 days
// forward stops asking ~17 days after the last regular game — on 2027's
// calendar (last regular game 8 Mar) about 25 Mar, before the Final Four
// matchups exist. So, measured from NOW:
//   - regular, while regular games are stored in the window;
//   - postseason, while postseason games are stored in the window, or from
//     LOOKAHEAD_DAYS before the last regular game to POSTSEASON_DISCOVERY_MS
//     after it — bracket games are not stored until something pulls them.
async function seasonTypesAhead(season, start, end) {
    const types = [];
    const inWindow = (seasonType) => HoopsGame.exists({ season, seasonType, startDate: { $gte: start, $lte: end } });
    if (await inWindow('regular')) types.push('regular');
    let post = await inWindow('postseason');
    if (!post) {
        const last = await HoopsGame.findOne({ season, seasonType: 'regular' }, { startDate: 1, _id: 0 }).sort({ startDate: -1 }).lean();
        const t = last && new Date(last.startDate).getTime();
        post = !!t && start.getTime() >= t - LOOKAHEAD_DAYS * DAY_MS && start.getTime() <= t + POSTSEASON_DISCOVERY_MS;
    }
    if (post) types.push('postseason');
    return types;
}

// Wrapped so a failure BEFORE the per-season loop mails too (#574); the
// silent skips below are returns, so they stay silent.
async function run({ now = new Date() } = {}) {
    return guardJob({ jobName: JOB_NAME, label: LABEL, now }, state => runOnce(now, state));
}

async function runOnce(now, state) {
    const leagues = await basketballLeagues();
    if (!leagues.length) return { skippedReason: 'no basketball leagues' };

    const start = now;
    const end = new Date(now.getTime() + LOOKAHEAD_DAYS * DAY_MS);

    const done = [];
    let failed = null;
    const years = [...new Set(leagues.map(l => l.season))];
    for (const season of years) {
        const types = await seasonTypesAhead(season, start, end);
        for (const seasonType of types) {
            try {
                const out = await hoopsGames.refreshResults({ season, seasonType, start, end });
                if (out.code === 200) {
                    done.push(`${season} ${seasonType}: ${out.body.created} new, ${out.body.updated} updated`);
                } else {
                    failed = `${season} ${seasonType} ${out.code}: ${out.body.message}`;
                    done.push(`${season} ${seasonType}: FAILED ${out.code} ${out.body.message}`);
                }
            } catch (err) {
                failed = String((err && err.message) || err);
                done.push(`${season} ${seasonType}: FAILED ${failed}`);
            }
        }
        if (!types.length) continue;
        try {
            // From the start of TODAY's Eastern day: at 06:40 CT `now` is
            // already past today's midnight-ET placeholders.
            const today = calendar.easternMidnight(calendar.easternDay(now));
            const t = await espnTipTimes.fillTipTimes({ season, start: today, end });
            if (!t.candidates) continue;
            const note = t.failedDays ? `, ESPN unreachable for ${t.failedDays} of ${t.calls} day(s)` : '';
            done.push(`${season} ESPN tip times: ${t.filled} filled, ${t.updated} updated, ${t.reverted} reverted, `
                + `${t.espnTbd + t.notOnEspn + t.dayMismatch} still TBD${note}`);
        } catch (err) {
            failed = String((err && err.message) || err);
            done.push(`${season} ESPN tip times: FAILED ${failed}`);
        }
    }
    if (!done.length) return { skippedReason: 'nothing scheduled' };

    const summary = done.join(' | ');
    const id = await jobLogger.startRun(JOB_NAME);
    state.id = id;
    await jobLogger.finishRun(id, failed ? 'error' : 'success', summary);
    console.log(`[${JOB_NAME}] ${summary}`);

    if (failed) {
        await jobMailer.sendJobEmail({
            label: LABEL, when: now.toLocaleString('en-US', { timeZone: 'America/Chicago' }), ok: false,
            rows: [['Seasons', years.map(String).join(', ')], ['Window', `${LOOKAHEAD_DAYS} days ahead`]],
            error: summary
        });
    }
    return { done, failed, summary };
}

module.exports = { run, JOB_NAME, LABEL, LOOKAHEAD_DAYS, seasonTypesAhead };
