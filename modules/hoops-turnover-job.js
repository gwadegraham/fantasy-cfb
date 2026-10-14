// Basketball roster turnover (#541): transfer portal moves and recruiting
// class rank per team, for the draft pool line ("Portal +4 / −3 · Class #12")
// and the team page's Roster turnover panel.
//
// ---- why weekly, then never ----
//
// What it reads is history by the time anyone drafts. The portal window
// closes in April and nearly every commitment lands by summer; the class
// signs in the spring. Measured 14 Oct 2026, CBBD year 2026: 1,579 portal
// rows (~470 KB) and 147 ranked classes (~14 KB) — one call each, both
// billable against the shared 30k pool. So the job, which the scheduler runs
// every morning, spends:
//
//   before the season's first game     2 calls a WEEK (stragglers who commit
//                                      late, CBBD's own corrections)
//   on/after the first game            2 calls ONCE, if the stored copy
//                                      predates tip-off — then frozen
//   every other day                    0
//
// A whole preseason from July is ~40 calls; from October, ~10.
//
// The year asked for is season - 1, not season: see modules/hoops-turnover.js.
//
// ---- refusing a bad response ----
//
// A short portal list, or one whose team ids mostly match no team of ours,
// would write a board of +0 / −0 that looks exactly like a quiet offseason.
// Both throw instead, keeping what is stored, and the failure is mailed.
// A failure is retried the next morning, so one that persists costs 2 calls
// and an email a day until someone looks — ~60 calls a month, deliberately
// not backed off: the email is the point, and the likeliest cause (a season
// rolled over before the portal window filled) clears itself.

const jobLogger = require('./job-logger');
const jobMailer = require('./job-mailer');
const cbbd = require('./cbbd-client');
const { basketballLeagues } = require('./hoops-scores-job');
const { portalYear, summarize } = require('./hoops-turnover');
const HoopsGame = require('./../models/hoopsGame');
const HoopsTeam = require('./../models/hoopsTeam');
const HoopsTeamTurnover = require('./../models/hoopsTeamTurnover');

const JOB_NAME = 'hoops-turnover';
const LABEL = 'Hoops Roster Turnover';
const PORTAL_PATH = '/recruiting/portal';
const CLASS_PATH = '/recruiting/teams';

const DAY_MS = 86400000;
// How stale a preseason copy may get before it is refetched.
const REFRESH_MS = 7 * DAY_MS;
// The smallest believable portal: 1,579 moves measured for 2026.
const MIN_PORTAL = 500;
// Share of moves touching at least one of our teams: 98% measured (the rest
// are Division II and NAIA schools). Well under that means CBBD's ids no
// longer match ours.
const MIN_MATCH = 0.9;
// Share of moves whose DESTINATION is one of ours: 1,292 of 1,308
// destinations measured (the 236 with none count against it, so ~84% of
// moves overall).
const MIN_DEST_MATCH = 0.5;
// Ranked classes that match our teams: 146 of 147 measured.
const MIN_CLASSES = 50;

// How a season's stored rows stand: whether they are one whole fetch for the
// right year, and when it was taken. "Whole" is one row per team the season
// has — a fixed floor would never be met by a season with fewer teams on
// file, and the job would then spend its two calls every single day.
async function storedFor(season, teamCount) {
    const groups = await HoopsTeamTurnover.aggregate([
        { $match: { season } },
        { $group: { _id: '$fromYear', n: { $sum: 1 }, oldest: { $min: '$fetchedAt' } } }
    ]);
    const whole = groups.length === 1 && groups[0]._id === portalYear(season) && groups[0].n >= Math.max(1, teamCount);
    return { whole, oldest: groups.length ? new Date(groups[0].oldest) : null };
}

async function fetchAll(year) {
    const [portal, classes] = await Promise.all([
        cbbd.cbbdGet(PORTAL_PATH, { year }),
        cbbd.cbbdGet(CLASS_PATH, { year })
    ]);
    return { portal: portal.data, classes: classes.data };
}

// Replace a season's rows wholesale, so a page never mixes two fetches.
async function writeSeason(season, year, byTeam, fetchedAt) {
    const rows = [...byTeam.values()];
    await HoopsTeamTurnover.bulkWrite(rows.map(r => ({
        updateOne: {
            filter: { season, teamId: r.teamId },
            update: { $set: Object.assign({}, r, { season, fromYear: year, fetchedAt }) },
            upsert: true
        }
    })), { ordered: false });
    await HoopsTeamTurnover.deleteMany({ season, teamId: { $nin: rows.map(r => r.teamId) } });
}

// One season: { written } | { skip } — throws on a CBBD, validation or write
// failure.
async function refreshSeason(season, now) {
    const year = portalYear(season);
    const [first, teams] = await Promise.all([
        HoopsGame.findOne({ season }, { startDate: 1, _id: 0 }).sort({ startDate: 1 }).lean(),
        HoopsTeam.find({ season }, { id: 1, school: 1, _id: 0 }).lean()
    ]);
    if (!teams.length) return { skip: `${season}: no teams ingested — nothing to attach turnover to` };
    const stored = await storedFor(season, teams.length);

    const tip = first ? new Date(first.startDate).getTime() : null;
    if (tip != null && now.getTime() >= tip) {
        if (stored.whole && stored.oldest.getTime() >= tip) {
            return { skip: `${season}: tipped off, and the ${year} portal was fetched after — frozen, not fetched` };
        }
    } else if (stored.whole && now.getTime() - stored.oldest.getTime() < REFRESH_MS) {
        const days = Math.floor((now.getTime() - stored.oldest.getTime()) / DAY_MS);
        return { skip: `${season}: the ${year} portal was fetched ${days} day(s) ago — weekly before tip-off, not fetched` };
    }

    const { portal, classes } = await fetchAll(year);
    if (portal.length < MIN_PORTAL) {
        throw new Error(`CBBD returned ${portal.length} portal row(s) for ${year}, expected ${MIN_PORTAL}+ — stored turnover kept`);
    }
    const sum = summarize(portal, classes, teams);
    if (!sum.rows || sum.matched / sum.rows < MIN_MATCH) {
        throw new Error(`only ${sum.matched} of ${sum.rows} ${year} portal move(s) match a ${season} team id — CBBD's ids changed? Stored turnover kept`);
    }
    // Checked on its own: the share above counts a move if EITHER end is
    // ours, so a destination-only id change would pass it while every team
    // showed +0 arrivals. 98.8% measured.
    if (sum.toKnown / sum.rows < MIN_DEST_MATCH) {
        throw new Error(`only ${sum.toKnown} of ${sum.rows} ${year} portal move(s) land on a ${season} team id — CBBD's destination ids changed? Stored turnover kept`);
    }
    if (sum.classes < MIN_CLASSES) {
        throw new Error(`only ${sum.classes} ${year} recruiting class(es) match a ${season} team, expected ${MIN_CLASSES}+ — stored turnover kept`);
    }

    try {
        await writeSeason(season, year, sum.byTeam, now);
    } catch (writeErr) {
        console.error(`[${JOB_NAME}] ${season} write failed, retrying once: ${writeErr.message}`);
        await writeSeason(season, year, sum.byTeam, now);
    }
    const pct = Math.round(sum.matched / sum.rows * 100);
    return { written: `${season}: ${teams.length} team(s) from CBBD ${year} — ${sum.rows} portal move(s), ${pct}% matched; ${sum.classes} ranked class(es)` };
}

async function run({ now = new Date() } = {}) {
    const leagues = await basketballLeagues();
    // No basketball at all: silent, no JobRun, like the other hoops jobs.
    if (!leagues.length) return { skippedReason: 'no basketball leagues' };

    const startMs = Date.now();
    const when = now.toLocaleString('en-US', { timeZone: 'America/Chicago' });
    const written = [];
    const skipped = [];
    const failures = [];
    for (const season of [...new Set(leagues.map(l => Number(l.season)))]) {
        try {
            const out = await refreshSeason(season, now);
            if (out.written) written.push(out.written);
            else skipped.push(out.skip);
        } catch (err) {
            failures.push({ season, err });
        }
    }

    const status = failures.length ? 'error' : (written.length ? 'success' : 'skipped');
    const secs = Math.round((Date.now() - startMs) / 1000);
    const summary = [
        ...written,
        ...skipped,
        ...failures.map(f => `${f.season}: FAILED ${(f.err && f.err.message) || f.err}`)
    ].join(' | ') + ` (${secs}s)`;

    const id = await jobLogger.startRun(JOB_NAME);
    await jobLogger.finishRun(id, status, summary);
    (failures.length ? console.error : console.log)(`[${JOB_NAME}] ${summary}`);

    // Mailed: a failure leaves the draft pool on stale or missing turnover,
    // and a board of zeros looks like a quiet offseason, not a fault.
    if (failures.length) {
        await jobMailer.sendJobEmail({
            label: LABEL, when, ok: false,
            rows: [['Seasons failed', failures.map(f => String(f.season)).join(', ')], ['Failed after', `${secs}s`]],
            error: failures.map(f => (f.err && f.err.stack) || String(f.err)).join('\n\n')
        });
    }
    return { status, written, skipped, failed: failures.length ? summary : null, summary };
}

module.exports = {
    run, refreshSeason, storedFor, writeSeason,
    JOB_NAME, LABEL, PORTAL_PATH, CLASS_PATH, REFRESH_MS, MIN_PORTAL, MIN_MATCH, MIN_DEST_MATCH, MIN_CLASSES
};
