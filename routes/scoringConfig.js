const express = require('express');
const router = express.Router();
const ScoringConfig = require('../models/scoringConfig');
const User = require('../models/user');
const Game = require('../models/game');
const { resolveConfig, fieldsForModel, engagementForSeason } = require('../modules/scoring-defaults');
const { explainRegularWin, explainGame, getScoringConfig, getRankingsForGame } = require('../modules/scoring');
const { canManageLeague } = require('../modules/league-access');
const { effectiveRoles } = require('../modules/dev-role');

// True once at least one drafted-team game has been scored in `season` for this
// league — used to lock scoring edits for League Managers mid-season.
async function hasScoredGames(league, season) {
    const hit = await User.exists({
        league,
        seasons: { $elemMatch: { season: Number(season), 'weeklyScore.scoreByTeam.0': { $exists: true } } }
    });
    return !!hit;
}

// Attaches the ordered field metadata (for the admin form + rules page) and a
// plain-language combine-mode `example` to a resolved config. `fields` reflect
// the resolved `disabled` set via each field's `enabled` flag; `example` is
// computed from the live point values so it tracks edits.
function withFields(cfg) {
    return Object.assign({}, cfg, {
        fields: fieldsForModel(cfg.model, cfg.disabled, cfg.enabled),
        example: explainRegularWin(cfg.model, cfg.values, cfg.disabled, cfg.enabled)
    });
}

// Resolved config (defaults-merged) for a league — always returns usable
// values, combine mode, disabled events, and field metadata, even if the
// commissioner hasn't saved a config yet.
router.get('/:league', async (req, res) => {
    try {
        const doc = await ScoringConfig.findOne({ league: req.params.league });
        const bySeason = (doc && doc.engagementBySeason) || {};
        let overrides = doc
            ? { model: doc.model, values: doc.values, combineMode: doc.combineMode, disabled: doc.disabled, enabled: doc.enabled, engagement: doc.engagement, engagementBySeason: bySeason }
            : null;
        // `?model=` lets the admin preview a different rule shape (Fixed =
        // claunts, Stacking = graham): force that model and drop the saved
        // combineMode so the shape's own default combine behavior applies,
        // never a stale one from the other shape.
        const requestedModel = req.query.model;
        if (requestedModel === 'claunts' || requestedModel === 'graham') {
            overrides = Object.assign({}, overrides, { model: requestedModel, combineMode: undefined });
        }
        // `engagement` is resolved for the requested season (default: the active
        // YEAR) so callers get the right game-mode state without knowing the
        // per-season storage. `engagementBySeason` is the full map for the admin.
        const season = req.query.season || process.env.YEAR;
        const cfg = withFields(resolveConfig(req.params.league, overrides));
        cfg.engagement = engagementForSeason(bySeason, season);
        cfg.engagementBySeason = bySeason;
        cfg.season = String(season);
        // Whether this caller may still edit scoring. Admins always can (they can
        // trigger a rescore). League Managers are locked out once the season has a
        // scored game — they must ask an admin. Only computed for a signed-in
        // manager (skipped for regular members and internal token calls).
        cfg.editable = false;
        cfg.locked = false;
        cfg.isAdmin = false;
        if (req.oidc && req.oidc.isAuthenticated && req.oidc.isAuthenticated() && canManageLeague(req, req.params.league)) {
            cfg.isAdmin = effectiveRoles(req).includes('Admin');
            if (cfg.isAdmin) {
                cfg.editable = true;
            } else {
                const scored = await hasScoredGames(req.params.league, season);
                cfg.editable = !scored;
                cfg.locked = scored;
            }
        }
        res.json(cfg);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// Per-game scoring breakdown: which rule(s) earned a rostered team its points
// for one game. Reuses the EXACT engine inputs (resolved config + the game's
// week rankings) the scoring jobs use, so the breakdown reconciles with the
// banked per-game score (barring rankings/rules changing after it was scored).
router.get('/:league/explain', async (req, res) => {
    try {
        const teamId = Number(req.query.teamId);
        const gameId = Number(req.query.gameId);
        if (!Number.isFinite(teamId) || !Number.isFinite(gameId)) {
            return res.status(400).json({ message: 'teamId and gameId are required' });
        }
        const game = await Game.findOne({ id: gameId }).lean();
        if (!game) return res.status(404).json({ message: 'Game not found' });
        const cfg = await getScoringConfig(req.params.league);
        const rankings = await getRankingsForGame(game, game.week, game.season);
        res.json(explainGame(cfg.model, teamId, game, rankings, cfg));
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// Upsert a league's scoring config (commissioner-gated via the mutation gate).
// Accepts a rule-shape `model` (Fixed = claunts, Stacking = graham), point
// `values`, a `disabled` list (default-on rules turned off), and an `enabled`
// list (default-off finer win categories turned on). The combine behavior is
// derived from the model's default — it is NOT a separate setting, so a
// nonsensical shape/mode combo can't be saved.
router.post('/', async (req, res) => {
    try {
        const { league, model, values, disabled, enabled } = req.body;
        if (!league) {
            return res.status(400).json({ message: 'league is required' });
        }
        if (!canManageLeague(req, league)) {
            return res.status(403).json({ message: 'Forbidden: not your league' });
        }
        // League Managers can't change scoring once the season is underway — a
        // change would need a full-season rescore, which only an admin can run.
        // Admins are exempt (they can rescore).
        if (!effectiveRoles(req).includes('Admin') && await hasScoredGames(league, process.env.YEAR)) {
            return res.status(423).json({ message: 'Scoring is locked once the season is underway. Ask an admin to change it — the change needs a re-score.' });
        }
        const resolved = resolveConfig(league, { model, values, disabled, enabled });
        const doc = await ScoringConfig.findOneAndUpdate(
            { league },
            { $set: {
                league,
                model: resolved.model,
                values: resolved.values,
                combineMode: resolved.combineMode,
                disabled: resolved.disabled,
                enabled: resolved.enabled,
                updatedAt: new Date()
            } },
            { new: true, upsert: true, setDefaultsOnInsert: true }
        );
        res.json(withFields(resolveConfig(league, {
            model: doc.model, values: doc.values, combineMode: doc.combineMode, disabled: doc.disabled, enabled: doc.enabled
        })));
    } catch (err) {
        res.status(400).json({ message: err.message });
    }
});

// Toggle the weekly-engagement layer (#230) for a league, PER SEASON, without
// touching the scoring values. Commissioner-gated + scoped to the caller's own
// league. The `season` (body, default active YEAR) selects which season's game
// modes are being set — other seasons are untouched.
router.patch('/:league/engagement', async (req, res) => {
    try {
        const league = req.params.league;
        if (!canManageLeague(req, league)) {
            return res.status(403).json({ message: 'Forbidden: not your league' });
        }
        const b = req.body || {};
        const season = String(b.season || process.env.YEAR);
        if (!/^\d{4}$/.test(season)) {
            return res.status(400).json({ message: 'A four-digit season is required.' });
        }
        const clamp = (v, lo, hi, dflt) => {
            const n = Number(v);
            return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt;
        };
        const engagement = {
            h2hEnabled: !!b.h2hEnabled,
            h2hWinBonus: clamp(b.h2hWinBonus, 0, 20, 3),
            captainEnabled: !!b.captainEnabled,
            captainMultiplier: clamp(b.captainMultiplier, 1.5, 5, 2)
        };
        // Set only this season's slot in the map (dot-path) so the other seasons'
        // settings are preserved.
        const doc = await ScoringConfig.findOneAndUpdate(
            { league },
            { $set: { league, ['engagementBySeason.' + season]: engagement, updatedAt: new Date() } },
            { new: true, upsert: true, setDefaultsOnInsert: true }
        );
        const saved = engagementForSeason(doc.engagementBySeason, season);
        res.json(Object.assign({ season }, saved));
    } catch (err) {
        res.status(400).json({ message: err.message });
    }
});

module.exports = router;
