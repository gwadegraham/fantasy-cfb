const express = require('express');
const router = express.Router();
const User = require('../models/user');
const scoring = require('../modules/scoring');
const { sanitizeProfileUpdate, cloudinaryConfig } = require('../modules/profile-update');
const { canManageLeague } = require('../modules/league-access');

// Self-service profile edit: a signed-in user updates THEIR OWN franchise name
// / avatar / onboarding flag. The identity comes from the Auth0 session (never
// from the client), so a user can only edit their own record. This route is
// exempted from the commissioner gate in server.js precisely because it's
// self-scoped. franchiseName is stored on the current season; the rest are
// account-level.
router.patch('/me/profile', async (req, res) => {
    const oidcUser = req.oidc && req.oidc.user;
    const meta = oidcUser && oidcUser.user_metadata && oidcUser.user_metadata.metadata;
    const userId = meta && meta.userId;
    if (!userId) {
        return res.status(401).json({ message: 'No profile in session.' });
    }

    let clean;
    try {
        clean = sanitizeProfileUpdate(req.body, cloudinaryConfig().cloudName);
    } catch (err) {
        return res.status(400).json({ message: err.message });
    }

    try {
        const user = await User.findById(userId);
        if (!user) return res.status(404).json({ message: 'User not found.' });

        if (clean.avatarUrl !== undefined) user.avatarUrl = clean.avatarUrl;
        if (clean.prompted !== undefined) user.profilePrompted = clean.prompted;

        if (clean.franchiseName !== undefined) {
            // Only name the active season — never fall back to a prior season.
            // Before the league drafts the active year there's no entry to name,
            // so the update is ignored (the client locks the field to match).
            const year = Number(process.env.YEAR);
            const season = (user.seasons || []).find(s => Number(s.season) === year);
            if (season) season.franchiseName = clean.franchiseName;
        }

        await user.save();
        const current = (user.seasons || []).find(s => Number(s.season) === Number(process.env.YEAR))
            || (user.seasons && user.seasons[user.seasons.length - 1]);
        res.json({
            avatarUrl: user.avatarUrl || null,
            profilePrompted: user.profilePrompted,
            franchiseName: (current && current.franchiseName) || null
        });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// Self-service Captain pick (#230): the logged-in manager sets/clears their
// captained team for a regular-season week. Locks once the week is scored.
router.patch('/me/captain', async (req, res) => {
    const oidcUser = req.oidc && req.oidc.user;
    const meta = oidcUser && oidcUser.user_metadata && oidcUser.user_metadata.metadata;
    const userId = meta && meta.userId;
    if (!userId) return res.status(401).json({ message: 'No profile in session.' });

    const week = parseInt(req.body.week, 10);
    const teamId = req.body.teamId == null ? null : Number(req.body.teamId);
    const seasonYear = Number(req.body.season) || Number(process.env.YEAR);
    if (!Number.isInteger(week) || week < 1 || week > 16) {
        return res.status(400).json({ message: 'Captain applies to regular-season weeks 1–16 only.' });
    }
    try {
        const user = await User.findById(userId);
        if (!user) return res.status(404).json({ message: 'User not found.' });
        const season = (user.seasons || []).find(s => Number(s.season) === seasonYear);
        if (!season) return res.status(404).json({ message: 'No roster for that season.' });
        if (teamId != null && !(season.teams || []).some(t => Number(t.id) === teamId)) {
            return res.status(400).json({ message: 'That team is not on your roster.' });
        }
        // Lock: once a week has been scored, its captain can't change.
        if ((season.weeklyScore || []).some(e => e.season !== 'postseason' && Number(e.week) === week)) {
            return res.status(409).json({ message: 'That week is already scored — captain is locked.' });
        }
        if (!Array.isArray(season.captains)) season.captains = [];
        season.captains = season.captains.filter(c => Number(c.week) !== week);   // drop any existing pick for the week
        if (teamId != null) season.captains.push({ week, teamId });
        await user.save();
        res.json({ season: seasonYear, week, teamId, captains: season.captains });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

//Getting All
router.get('/', async (req, res) => {
    try {
        const users = await User.find();
        res.json(users);
    } catch (err) {
        res.status(500).json({message: err.message});
    }
});

//Getting All By Season
router.get('/season/:seasonYear', async (req, res) => {
    try {
        const users = await User.find({"seasons.season": {"$eq": req.params.seasonYear}},
                    {"firstName": 1, "lastName": 1, "league": 1, "lastUpdated": 1, "color": 1, "seasons": {"$elemMatch": {"season": {"$eq": req.params.seasonYear}}}});
        res.json(users);
    } catch (err) {
        res.status(500).json({message: err.message});
    }
});

//Getting All By League
router.get('/league/:leagueCodeReq/all', async (req, res) => {
    var leagueCode = req.params.leagueCodeReq;
    try {
        console.log("finding all users in league", leagueCode);
        const users = await User.find({"league": leagueCode});
        res.json(users);
    } catch (err) {
        res.status(500).json({message: err.message});
    }
});

//Getting All By League & Current Year
router.get('/league/:leagueCodeReq', async (req, res) => {
    var leagueCode = req.params.leagueCodeReq;
    try {
        console.log("finding all users in league", leagueCode);
        const users = await User.find({"seasons.season": {"$eq": process.env.YEAR}, "league": leagueCode},
                    {"firstName": 1, "lastName": 1, "email": 1, "league": 1, "lastUpdated": 1, "color": 1, "avatarUrl": 1, "profilePrompted": 1, "seasons": {"$elemMatch": {"season": {"$eq": process.env.YEAR}}}});
        res.json(users);
    } catch (err) {
        res.status(500).json({message: err.message});
    }
});

//Getting All By League & Previous Year
router.get('/league/:leagueCodeReq/previous', async (req, res) => {
    var leagueCode = req.params.leagueCodeReq;
    try {
        console.log("finding user in league", leagueCode);
        const users = await User.find({"seasons.season": {"$eq": (process.env.YEAR - 1)}, "league": leagueCode},
                    {"firstName": 1, "lastName": 1, "league": 1, "lastUpdated": 1, "color": 1, "seasons": {"$elemMatch": {"season": {"$eq": (process.env.YEAR - 1)}}}});
        res.json(users);
    } catch (err) {
        res.status(500).json({message: err.message});
    }
});

//Getting One By Id
router.get('/:id', async (req, res) => {
    var userId = req.params.id;

    try {
        const user = await User.find({_id: userId});
        res.json(user);
    } catch (err) {
        res.status(500).json({message: err.message});
    }
});

//Getting One By Season
router.get('/:id/season', async (req, res) => {
    var userId = req.params.id;
    var year = process.env.YEAR;

    try {
        const user = await User.find({_id: userId, "seasons.season": {"$eq": year}},
                    {"firstName": 1, "lastName": 1, "league": 1, "lastUpdated": 1, "color": 1, "seasons": {"$elemMatch": {"season": {"$eq": year}}}});
        res.json(user);
    } catch (err) {
        res.status(500).json({message: err.message});
    }
});

//Creating One
router.post('/', async (req, res) => {

    // A League Manager may only add players to their own league (Admins: any).
    if (!canManageLeague(req, req.body.league)) {
        return res.status(403).json({ message: 'Forbidden: not your league' });
    }

    var date = new Date();
    var centralTime = date.toLocaleString("en-US", {timeZone: "America/Chicago"});

    const user = new User({
        firstName: req.body.firstName,
        lastName: req.body.lastName,
        seasons: req.body.seasons,
        color: req.body.color,
        league: req.body.league,
        lastUpdated: centralTime
    });

    try {
        const newUser = await user.save();
        res.status(201).json(newUser);
    } catch (err) {
        res.status(400).json({message: err.message});
    }
});

//Updating One
router.patch('/:id', getUser, async (req, res) => {

    var date = new Date();
    var centralTime = date.toLocaleString("en-US", {timeZone: "America/Chicago"});
    res.user.lastUpdated = centralTime;

    if (req.body.cumulativeScore != null) {
        res.user.seasons[0].cumulativeScore = req.body.cumulativeScore;
    } 

    else {
        res.user.seasons[0].weeklyScore = req.body.weeklyScore;
    }
    if (req.body.isUpdated != null) {
        res.user.isUpdated = req.body.isUpdated;
    }
    try {
        const updatedUser = await res.user.save();
        res.status(200).json(updatedUser);
    } catch (err) {
        res.status(400).json({message: err.message});
    }
});

//Updating new Season & Teams for One
router.patch('/draft/:id', getUserNewSeason, async (req, res) => {

    var newSeason = {
        "season": req.body.season,
        "teams": req.body.teams
    };

    var date = new Date();
    var centralTime = date.toLocaleString("en-US", {timeZone: "America/Chicago"});
    res.user.lastUpdated = centralTime;

    console.log("res.user", res.user)

    if (req.body.season != null && req.body.teams != null) {
        var seasonExist = res.user.seasons.findIndex(x => x.season == newSeason.season);

        if (seasonExist > -1) {
            res.user.seasons[seasonExist] = newSeason;
        } else {
            res.user.seasons.push(newSeason);
        }
    }

    try {
        const updatedUser = await res.user.save();
        res.status(200).json(updatedUser);
    } catch (err) {
        res.status(400).json({message: err.message});
    }
});

//Deleting One
router.delete('/:id', getUser, async (req, res) => {
    // A League Manager may only remove players from their own league.
    if (!canManageLeague(req, res.user.league)) {
        return res.status(403).json({ message: 'Forbidden: not your league' });
    }
    try {
        await res.user.deleteOne();
        res.json({message: 'Deleted User'});
    } catch (err) {
        res.status(500).json({message: err.message});
    }
});

async function getUser(req, res, next) {
    let user;
    try {
        user = await User.findOne({_id: req.params.id, "seasons.season": {"$eq": process.env.YEAR}},
                    {"firstName": 1, "lastName": 1, "league": 1, "lastUpdated": 1, "color": 1, "seasons": {"$elemMatch": {"season": {"$eq": process.env.YEAR}}}});
        if (user == null) {
            return res.status(404).json({message: 'Cannot find user'});
        }
    } catch (err) {
        return res.status(500).json({message: err.message});
    }
    res.user = user;
    next();
}

async function getUserNewSeason(req, res, next) {
    let user;
    try {
        user = await User.findOne({_id: req.params.id},
                    {"firstName": 1, "lastName": 1, "league": 1, "lastUpdated": 1, "color": 1, "seasons": 1});
        if (user == null) {
            return res.status(404).json({message: 'Cannot find user'});
        }
    } catch (err) {
        return res.status(500).json({message: err.message});
    }
    res.user = user;
    next();
}

module.exports = router;