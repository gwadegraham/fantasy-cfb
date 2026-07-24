const express = require('express');
const router = express.Router();
const scoringModule = require('../modules/scoring.js');
const User = require('../models/user');
const Game = require('../models/game');
const { computeAdminStatus } = require('../modules/admin-status');
const { internalFetch } = require('../modules/internal-api');

// Read-only status summary for the admin console: how far scoring/games have
// progressed and whether any completed results are still unscored. Derived from
// existing data — no new job instrumentation.
router.get('/status/:season', async (req, res) => {
    try {
        const season = req.params.season;
        const users = await User.find({ "seasons.season": season });
        const games = await Game.find(
            { season: Number(season) },
            { id: 1, week: 1, seasonType: 1, completed: 1, homeId: 1, awayId: 1, homePoints: 1, awayPoints: 1, _id: 0 }
        );
        res.json(computeAdminStatus(users, games, season));
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// Recalculating & Updating Scores
router.post('/update', async (req, res) => {
    try {
        var seasonType = req.body.seasonType;
        var weekNumber = req.body.week;

        await scoringModule.updateScores(seasonType, weekNumber);
        await scoringModule.updateCumulativeScores();

        res.status(200).json({"seasonType": seasonType, "weekNumber": weekNumber});
    } catch (err) {
        res.status(500).json({message: err.message});
    }
});

// Full-season recompute in one request: user weekly scores for every regular
// week + postseason, then every team's team-doc scores, then cumulative totals
// once at the end. Reuses the exact per-week / per-team engine, so it's just an
// orchestration of existing logic (and idempotent — safe to re-run). This is
// what backfills a whole season after ingestion, replacing 17 clicks of Update
// Scores + Calculate Scores for all teams. One ranking cache is shared across
// the whole run, so each week's poll is read once, not once per game per team.
router.post('/update-all', async (req, res) => {
    try {
        const season = process.env.YEAR;
        const cache = new Map();

        // 1. User weekly scores: each regular week, then postseason.
        let weeksScored = 0;
        for (let w = 1; w <= 16; w++) {
            await scoringModule.updateScores('regular', String(w), cache);
            weeksScored++;
        }
        await scoringModule.updateScores('postseason', '1', cache);
        weeksScored++;

        // 2. Team-doc scores for every team.
        const { scored, failed } = await calculateAllTeams(season, cache);

        // 3. Cumulative totals once, after everything is scored.
        await scoringModule.updateCumulativeScores();

        res.status(200).json({ season, weeksScored, teamsScored: scored, teamsFailed: failed });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// Score every team's team-doc in one request (server-side loop) — replaces the
// browser firing one request per team. Rankings are cached across the whole run.
router.post('/calculate-all/:season', async (req, res) => {
    try {
        const { scored, failed } = await calculateAllTeams(req.params.season, new Map());
        res.status(200).json({ season: req.params.season, scored, failed });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// Loop every team through the team-doc scorer, sharing one ranking cache across
// all teams. Never throws for a single team — a bad team is counted and skipped
// so one failure can't abort a whole-season run.
async function calculateAllTeams(season, cache) {
    const teamsRes = await internalFetch(`${process.env.URL}/teams`, {
        method: 'GET',
        headers: { 'Accept': 'application/json' }
    });
    const teams = await teamsRes.json();
    let scored = 0, failed = 0;
    for (const team of (Array.isArray(teams) ? teams : [])) {
        try {
            await scoringModule.calculateTeamScores(season, team.id, team.school, cache);
            scored++;
        } catch (e) {
            failed++;
        }
    }
    return { scored, failed };
}

module.exports = router;