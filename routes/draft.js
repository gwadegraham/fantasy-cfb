const express = require('express');
const router = express.Router();
const audit = require('../modules/audit-log');
const Draft = require('../models/draft');
const User = require('../models/user');
const Team = require('../models/team');
const Game = require('../models/game');
const Ranking = require('../models/ranking');
const ScoringConfig = require('../models/scoringConfig');
const { resolveConfig, overridesFromDoc, engagementForSeason } = require('../modules/scoring-defaults');
const draftBoard = require('../modules/draft-board');
const { buildRankingProxy, buildPoolContext, projectTeamPoints } = require('../modules/draft-projection');
const { computeGrades } = require('../modules/draft-grades');
const { canManageLeague } = require('../modules/league-access');
const { sanitizeCallUrl } = require('../modules/draft-call-link');
const { pickLogo } = require('../public/logo.js');

// Post-draft grades for a league + season — immediate preseason feedback. Each
// roster is projected to EXPECTED FANTASY POINTS under that league's own scoring
// config (schedule + SP+ win probs + market CFP odds), graded on absolute
// per-league bands. Read-only; available as soon as the draft is complete.
router.get('/grades/:league/:season', async (req, res) => {
    try {
        const league = req.params.league;
        const season = Number(req.params.season);
        const draft = await Draft.findOne({ league, season }).lean();
        if (!draft || !Array.isArray(draft.picks) || draft.picks.length === 0) {
            return res.json({ league, season, managers: [] });
        }
        const users = await User.find({ league },
            { firstName: 1, lastName: 1, league: 1, avatarUrl: 1, seasons: 1 }).lean();
        const usersById = {};
        users.forEach(u => { usersById[String(u._id)] = u; });

        // SP+ / expected wins / CFP odds / conference live on the Team docs.
        const teams = await Team.find({}, { id: 1, school: 1, alternateNames: 1, seasons: 1 }).lean();
        const teamsById = {};
        teams.forEach(t => { teamsById[String(t.id)] = t; });

        // Inputs the projection needs: the season's regular schedule, the
        // league's resolved scoring config, and a preseason AP poll if ingested
        // (else the projection synthesizes one from SP+).
        const games = await Game.find({ season, seasonType: 'regular' },
            { id: 1, season: 1, seasonType: 1, week: 1, neutralSite: 1, conferenceGame: 1,
              notes: 1, homeId: 1, homeTeam: 1, homeConference: 1,
              awayId: 1, awayTeam: 1, awayConference: 1 }).lean();

        const cfgDoc = await ScoringConfig.findOne({ league }).lean();
        const config = resolveConfig(league, overridesFromDoc(cfgDoc));

        const apDoc = await Ranking.findOne({ season, seasonType: 'regular' }).sort({ week: 1 }).lean();
        const apPoll = apDoc && Array.isArray(apDoc.polls)
            ? apDoc.polls.find(p => p.poll === 'AP Top 25') : null;

        const managers = computeGrades(draft, usersById, teamsById, { games, config, apPoll });
        res.json({ league, season, managers });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// Live draft board: every team's projected points for THIS league's scoring,
// plus who's still on the board and what this manager's next pick is worth.
//
// Commissioner-gated (canManageLeague) — it's a draft-night advantage, not a
// member feature, so it is not exposed to the league at large.
//
// The projections are the expensive half and never change during a draft (they
// depend on the schedule and ratings, not on who has been picked), so they are
// computed once per league+season and cached. The cheap half — available teams,
// pick schedule, advice — is recomputed per request against the live draft, and
// the client also recomputes it locally on each socket pick so the page reacts
// without a round trip.
const boardCache = new Map();     // `${league}:${season}` -> { projections, rankedSource }

router.get('/board/:league/:season', async (req, res) => {
    try {
        const league = req.params.league;
        const season = Number(req.params.season);
        if (!canManageLeague(req, league)) {
            return res.status(403).json({ message: 'Forbidden: not your league' });
        }
        const draft = await Draft.findOne({ league, season }).lean();
        if (!draft) return res.status(404).json({ message: 'No draft configured' });

        const key = `${league}:${season}`;
        if (req.query.refresh === '1') boardCache.delete(key);
        let cached = boardCache.get(key);
        if (!cached) {
            const teams = await Team.find({}, { id: 1, school: 1, alternateNames: 1, logos: 1, seasons: 1 }).lean();
            const teamsById = {};
            teams.forEach(t => { if (t.id != null) teamsById[String(t.id)] = t; });

            const games = await Game.find({ season, seasonType: 'regular' },
                { id: 1, season: 1, seasonType: 1, week: 1, neutralSite: 1, conferenceGame: 1,
                  notes: 1, homeId: 1, homeTeam: 1, homeConference: 1,
                  awayId: 1, awayTeam: 1, awayConference: 1 }).lean();

            const cfgDoc = await ScoringConfig.findOne({ league }).lean();
            const config = resolveConfig(league, overridesFromDoc(cfgDoc));

            const apDoc = await Ranking.findOne({ season, seasonType: 'regular' }).sort({ week: 1 }).lean();
            const apPoll = apDoc && Array.isArray(apDoc.polls)
                ? apDoc.polls.find(p => p.poll === 'AP Top 25') : null;

            cached = {
                projections: projectPool(teamsById, games, config, apPoll, season),
                rankedSource: apPollName(apDoc)
            };
            boardCache.set(key, cached);
        }
        const projections = cached.projections;

        // req.effUser is the OIDC profile, so the app user id is in its nested
        // metadata (see buildUserContext in server.js) — never a top-level _id.
        const meta = (req.effUser && req.effUser.user_metadata) || {};
        const userId = String(req.query.userId || (meta.metadata && meta.metadata.userId) || '');
        const schedule = draftBoard.pickSchedule(draft, userId);
        const avail = draftBoard.available(projections, draft);
        const roster = draftBoard.rosterFor(draft, userId, projections);

        // Captain settings are PER SEASON, so a league running the mode in 2026
        // and not in 2027 prices picks differently in each. Off => the advice is
        // pure board value, which is what Claunts gets.
        const cfgDocForSeason = await ScoringConfig.findOne({ league }).lean();
        const eng = engagementForSeason(cfgDocForSeason && cfgDocForSeason.engagementBySeason, season);
        const anchorRegular = draftBoard.captainAnchor(roster);
        const anchor = roster.reduce((b, r) =>
            (r.regular != null && (!b || r.regular > b.regular)) ? r : b, null);
        const captain = {
            enabled: !!eng.captainEnabled,
            multiplier: eng.captainMultiplier,
            anchorRegular,
            anchorSchool: anchor ? anchor.school : null
        };

        res.json({
            league, season,
            // Whether the ranked-win bonuses in these projections came from a real
            // poll or an SP+ stand-in — the numbers move if a preseason AP poll
            // lands mid-draft-prep, and the page says so rather than pretending.
            rankedSource: cached.rankedSource,
            projections, draft: publicDraft(draft), schedule, captain,
            advice: draftBoard.advise(avail, schedule, { captain }),
            roster
        });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// Project every FBS team in the pool through this league's real scoring engine.
function projectPool(teamsById, games, config, apPoll, season) {
    const rankings = buildRankingProxy(season, teamsById, apPoll);
    const poolCtx = buildPoolContext(teamsById, season);
    const byTeam = {};
    games.forEach(g => {
        const h = String(g.homeId), a = String(g.awayId);
        if (teamsById[h]) (byTeam[h] = byTeam[h] || []).push(g);
        if (teamsById[a]) (byTeam[a] = byTeam[a] || []).push(g);
    });
    return Object.keys(teamsById).map(id => {
        const t = teamsById[id];
        const g = byTeam[id] || [];
        if (!g.length) return null;
        const p = projectTeamPoints(t, g, poolCtx, rankings, config, season);
        const s = (t.seasons || []).find(x => Number(x.season) === season) || {};
        return {
            id: t.id, school: t.school, conference: s.conference || null,
            // Dark-variant logo at the best resolution — the page is dark-themed.
            logo: pickLogo(t.logos) || null,
            total: Math.round(p.total * 10) / 10,
            regular: Math.round(p.regular * 10) / 10,
            post: Math.round((p.cfp + p.confChamp + p.bowl) * 10) / 10,
            // Captain value: this league doubles one team a week, so the points
            // a team is expected to bank in a single week is its own metric.
            perWeek: g.length ? Math.round((p.regular / g.length) * 100) / 100 : 0,
            wins: Math.round(p.projWins * 10) / 10,
            expectedWins: s.expectedWins != null ? s.expectedWins : null,
            sp: s.spRating != null ? s.spRating : null
        };
    }).filter(Boolean).sort((a, b) => b.total - a.total);
}

function apPollName(doc) {
    const polls = (doc && doc.polls) || [];
    if (polls.some(p => p.poll === 'AP Top 25')) return 'AP Top 25';
    if (polls.length) return `SP+ stand-in (stored poll is "${polls.map(p => p.poll).join('", "')}")`;
    return 'SP+ stand-in (no poll stored)';
}

// Only the draft fields the board needs — picks, order, and where we are.
function publicDraft(d) {
    return {
        status: d.status, snake: d.snake, totalRounds: d.totalRounds,
        currentOverall: d.currentOverall,
        draftOrder: (d.draftOrder || []).map(String),
        picks: (d.picks || []).map(p => ({
            overall: p.overall, round: p.round, userId: String(p.userId),
            teamId: p.team && p.team.id, school: (p.team && p.team.school) || '?'
        }))
    };
}

// Get the draft for a league + season (returns null if none configured yet).
router.get('/:league/:season', async (req, res) => {
    try {
        const draft = await Draft.findOne({ league: req.params.league, season: req.params.season });
        res.json(draft);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// Create or update a draft's configuration (upsert on league+season).
// Settings are locked once the draft is active or complete.
router.post('/', async (req, res) => {
    try {
        const { league, season } = req.body;
        if (!league || season == null) {
            return res.status(400).json({ message: 'league and season are required' });
        }
        if (!canManageLeague(req, league)) {
            return res.status(403).json({ message: 'Forbidden: not your league' });
        }

        const existing = await Draft.findOne({ league, season });
        if (existing && (existing.status === 'active' || existing.status === 'complete')) {
            return res.status(409).json({ message: `Draft is ${existing.status}; settings are locked` });
        }

        // Throws on a non-http(s) link; the catch below turns that into a 400
        // with the message the admin form shows.
        const callUrl = sanitizeCallUrl(req.body.callUrl);

        const update = {
            league,
            season,
            scheduledAt: req.body.scheduledAt || null,
            autoOpen: !!req.body.autoOpen,
            callUrl,
            snake: req.body.snake !== false,
            totalRounds: req.body.totalRounds || 10,
            orderMethod: req.body.orderMethod || 'manual',
            draftOrder: Array.isArray(req.body.draftOrder) ? req.body.draftOrder : [],
            status: req.body.scheduledAt ? 'scheduled' : 'pending',
            updatedAt: new Date()
        };

        const draft = await Draft.findOneAndUpdate(
            { league, season },
            { $set: update, $setOnInsert: { picks: [], currentOverall: 1 } },
            { new: true, upsert: true, setDefaultsOnInsert: true }
        );

        const when = draft.scheduledAt
            ? new Date(draft.scheduledAt).toLocaleString('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
            : 'no date';
        await audit.record(req, {
            action: 'draft.config', league, season: String(season),
            summary: `Draft settings saved — ${when}, ${draft.snake ? 'snake' : 'linear'}, ${draft.totalRounds} rounds, ${(draft.draftOrder || []).length} managers${draft.callUrl ? ', call link set' : ''}`,
            // The link itself stays out of the trail — a meeting URL can carry an
            // embedded passcode, and "set or not" is all the log needs to show.
            meta: { draftId: String(draft._id), scheduledAt: draft.scheduledAt, snake: draft.snake, totalRounds: draft.totalRounds, orderSize: (draft.draftOrder || []).length, callLink: draft.callUrl ? 'set' : 'none' }
        });
        res.status(200).json(draft);
    } catch (err) {
        res.status(400).json({ message: err.message });
    }
});

// Start a draft: flip it to active so picks can be made. Requires a configured
// order of at least 2 participants.
router.post('/:id/start', async (req, res) => {
    try {
        const draft = await Draft.findById(req.params.id);
        if (draft == null) {
            return res.status(404).json({ message: 'Draft not found' });
        }
        if (!canManageLeague(req, draft.league)) {
            return res.status(403).json({ message: 'Forbidden: not your league' });
        }
        if (draft.status === 'complete') {
            return res.status(409).json({ message: 'Draft is already complete' });
        }
        if (!Array.isArray(draft.draftOrder) || draft.draftOrder.length < 2) {
            return res.status(400).json({ message: 'Draft needs at least 2 participants' });
        }
        draft.status = 'active';
        if (!draft.currentOverall || draft.currentOverall < 1) {
            draft.currentOverall = 1;
        }
        draft.updatedAt = new Date();
        await draft.save();
        res.json(draft);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// Reset a draft: clear picks and return it to pending. Used to re-run a draft
// or wipe a mistaken start.
router.post('/:id/reset', async (req, res) => {
    try {
        const existing = await Draft.findById(req.params.id);
        if (existing == null) {
            return res.status(404).json({ message: 'Draft not found' });
        }
        if (!canManageLeague(req, existing.league)) {
            return res.status(403).json({ message: 'Forbidden: not your league' });
        }
        const draft = await Draft.findByIdAndUpdate(
            req.params.id,
            { $set: { status: 'pending', picks: [], currentOverall: 1, updatedAt: new Date() } },
            { new: true }
        );
        // Wipes every pick. Rosters written by a previous completion are NOT
        // rolled back (see the runbook), so this one especially wants a trail.
        await audit.record(req, {
            action: 'draft.reset', league: existing.league, season: String(existing.season),
            summary: `Draft reset (${(existing.picks || []).length} picks cleared)`,
            meta: { draftId: String(existing._id), picksCleared: (existing.picks || []).length }
        });
        res.json(draft);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

module.exports = router;
