// The basketball admin page (#518) and the one read it makes.
//
// Football and basketball admin are SEPARATE PAGES (Graham's call, on #518),
// not a section on football's /admin. This page is only buttons for the four
// basketball data tasks, each of which already exists as an admin-gated POST:
//
//   POST /hoops/teams/:season/ingest     teams           1 CBBD call
//   POST /hoops/games/:season/schedule   schedule        1 per 30-day window, +1 roster the first time
//   POST /hoops/games/refresh            results         1 per 30-day window (default: the last day)
//   POST /hoops/teams/:season/roster     jersey numbers  1 CBBD call
//
// Every one of them is billable against the shared 30k CBBD/CFBD pool, which
// is why the page shows the call count before it runs anything.
//
// ---- who sees it ----
//
// Admins only — the same answer requireAdmin gives the POSTs the buttons
// call. NOT League Managers, which football's /admin lets in: a football
// commissioner is not in on basketball, and basketball stays invisible to
// everyone who is not (see modules/hoops-visibility.js). So a signed-in
// non-Admin gets a plain 404, never a 403 — a 403 says the page exists.
//
// The gate is in THIS router, not the path list in server.js. That list gates
// non-GETs only, and both routes here are GETs.

const express = require('express');
const HoopsTeam = require('../models/hoopsTeam');
const HoopsGame = require('../models/hoopsGame');
const HoopsRoster = require('../models/hoopsRoster');
const JobRun = require('../models/jobRun');
const seasons = require('../modules/active-season');
const cbbd = require('../modules/cbbd-client');
const roster = require('../modules/hoops-roster');
const { effectiveRoles } = require('../modules/dev-role');
// A namespace, read at call time, so a test can widen the default and see
// the quote follow it.
const hoopsGames = require('./hoopsGames');

const DAY = 24 * 3600 * 1000;

function isAdmin(req) {
    return !!(req.oidc && req.oidc.isAuthenticated() && effectiveRoles(req).includes('Admin'));
}

// How many /games calls fetchGamesInRange makes for a range: one per window of
// WINDOW_DAYS, inclusive on both ends. The same stepping, so the number the
// confirm step quotes is the number the ingest spends.
function windowsFor(start, end) {
    const days = Math.floor((end.getTime() - start.getTime()) / DAY) + 1;
    return days > 0 ? Math.ceil(days / cbbd.WINDOW_DAYS) : 0;
}

// The jobs the scheduler runs for basketball. Only hoops-scores does one of
// this page's tasks (it calls the same refresh as POST /hoops/games/refresh,
// nightly); the rest are shown because "did last night's run work?" is the
// question an admin opens this page with.
const HOOPS_JOBS = ['hoops-scores', 'hoops-live', 'hoops-stats', 'hoops-media'];

// What is on file for the season, per task, plus the latest scheduled run of
// each basketball job. Free: Mongo reads only, never a CBBD call — this runs
// on every page load.
async function status() {
    const season = seasons.activeSeason('basketball');
    if (!Number.isFinite(season)) return { season: null };

    const { start, end } = cbbd.seasonRange(season);
    const [teams, withLogos, games, finals, lastFinal, numbered, rosterTeams, lastFetch, fullRoster, runs] = await Promise.all([
        HoopsTeam.countDocuments({ season }),
        HoopsTeam.countDocuments({ season, 'logos.0': { $exists: true } }),
        HoopsGame.countDocuments({ season }),
        HoopsGame.countDocuments({ season, status: 'final' }),
        HoopsGame.findOne({ season, status: 'final' }, { startDate: 1, _id: 0 }).sort({ startDate: -1 }).lean(),
        HoopsRoster.countDocuments({ season }),
        HoopsRoster.distinct('teamId', { season }),
        HoopsRoster.findOne({ season }, { fetchedAt: 1, _id: 0 }).sort({ fetchedAt: -1 }).lean(),
        roster.hasSeason(season),
        JobRun.aggregate([
            { $match: { jobName: { $in: HOOPS_JOBS } } },
            { $sort: { jobName: 1, startedAt: -1 } },
            { $group: { _id: '$jobName', doc: { $first: '$$ROOT' } } },
            { $replaceRoot: { newRoot: '$doc' } },
            { $project: { _id: 0, jobName: 1, status: 1, startedAt: 1, finishedAt: 1, message: 1 } }
        ])
    ]);

    const scheduleWindows = windowsFor(start, end);
    return {
        season,
        seasonStatus: seasons.sportStatus('basketball'),
        onFile: {
            teams: { teams, withLogos },
            games: { games, finals, lastFinal: lastFinal ? lastFinal.startDate : null },
            roster: { players: numbered, teams: rosterTeams.filter(t => t != null).length,
                fetchedAt: lastFetch ? lastFetch.fetchedAt : null }
        },
        // The confirm step's numbers. The schedule ingest also imports the
        // roster when none is on file in full — one more call.
        calls: {
            ingest: 1,
            schedule: scheduleWindows + (fullRoster ? 0 : 1),
            // The refresh's own default window, so a wider default changes
            // the quote rather than leaving it at 1.
            refresh: windowsFor(new Date(Date.now() - hoopsGames.DEFAULT_REFRESH_MS), new Date()),
            roster: 1
        },
        jobs: HOOPS_JOBS.map(name => runs.find(r => r.jobName === name) || { jobName: name, status: null })
    };
}

// pageLocals builds what the navbar partial needs (user, userState). It lives
// in server.js with the rest of the session plumbing and is injected, so a
// test can mount the real router without the whole app.
function build({ pageLocals = () => ({}) } = {}) {
    const router = express.Router();

    router.get('/', (req, res, next) => {
        if (!(req.oidc && req.oidc.isAuthenticated())) return res.redirect('/login');
        if (!isAdmin(req)) return next();
        res.render('hoopsAdmin', Object.assign({ user: null, userState: null }, pageLocals(req, res)));
    });

    router.get('/status', async (req, res) => {
        if (!isAdmin(req)) return res.status(404).json({ message: 'Not found' });
        try {
            return res.json(await status());
        } catch (err) {
            console.error(`hoops admin status: ${err && err.message}`);
            return res.status(500).json({ message: 'Could not read the basketball status' });
        }
    });

    return router;
}

module.exports = { build, status, windowsFor, HOOPS_JOBS };
