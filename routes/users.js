const express = require('express');
const router = express.Router();
const User = require('../models/user');
const Game = require('../models/game');
const Team = require('../models/team');
const Draft = require('../models/draft');
const scoring = require('../modules/scoring');
const rosterCorrection = require('../modules/roster-correction');
const { pickLogo } = require('../public/logo.js');
const { sanitizeProfileUpdate, cloudinaryConfig } = require('../modules/profile-update');
const { canManageLeague } = require('../modules/league-access');
const { effectiveRoles } = require('../modules/dev-role');
const { hasScoredGames } = require('../modules/season-status');
const { captainLockMs, captainFocusWeek } = require('../modules/captain');

// A week's Captain edits close when the manager's earliest game finishes; the
// tile keeps that week in focus for this long after its last kickoff before
// advancing to the next week.
const CAPTAIN_WEEK_GRACE_MS = 6 * 60 * 60 * 1000;

// The manager's regular-season games for a season, projected to the fields the
// kickoff-lock helpers need. Shared by the GET and PATCH captain handlers.
function captainGamesQuery(season, teamIds) {
    return Game.find(
        { season, seasonType: 'regular', $or: [{ homeId: { $in: teamIds } }, { awayId: { $in: teamIds } }] },
        { week: 1, homeId: 1, awayId: 1, startDate: 1, startTimeTbd: 1, seasonType: 1, completed: 1 }
    ).lean();
}

// Distinct, vibrant avatar/display colors for managers — same family as the
// app's accent palette. A new player gets one not already used in the league.
const USER_COLORS = ['#ED5858', '#E0B341', '#71D28D', '#64B5F6', '#8E8CF0', '#F27E3F', '#4FC3C7', '#EC6FA6', '#9CCC65', '#C97BE0'];

async function pickUnusedColor(league) {
    const users = await User.find({ league }, { color: 1 }).lean();
    const used = new Set(users.map(u => String(u.color || '').toUpperCase()));
    const free = USER_COLORS.filter(c => !used.has(c.toUpperCase()));
    const pool = free.length ? free : USER_COLORS;
    return pool[Math.floor(Math.random() * pool.length)];
}

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

// The Captain state the tile renders from: which regular-season week the manager
// can currently act on, when it locks (their first kickoff, ISO), their current
// pick, and whether that week has already locked. `week` is null once the season
// is out of reach. Single source of truth for the lock rule.
router.get('/me/captain', async (req, res) => {
    const oidcUser = req.oidc && req.oidc.user;
    const meta = oidcUser && oidcUser.user_metadata && oidcUser.user_metadata.metadata;
    const userId = meta && meta.userId;
    if (!userId) return res.status(401).json({ message: 'No profile in session.' });

    const seasonYear = Number(req.query.season) || Number(process.env.YEAR);
    const none = { season: seasonYear, week: null, lockAt: null, teamId: null, locked: true };
    try {
        const user = await User.findById(userId);
        if (!user) return res.status(404).json({ message: 'User not found.' });
        const season = (user.seasons || []).find(s => Number(s.season) === seasonYear);
        if (!season || !(season.teams || []).length) return res.json(none);

        const teamIds = (season.teams || []).map(t => Number(t.id));
        const games = await captainGamesQuery(seasonYear, teamIds);
        const focus = captainFocusWeek(games, teamIds, Date.now(), CAPTAIN_WEEK_GRACE_MS);
        if (!focus) return res.json(none);

        const pick = ((season.captains || []).find(c => Number(c.week) === focus.week) || {}).teamId;
        res.json({
            season: seasonYear,
            week: focus.week,
            lockAt: new Date(focus.first).toISOString(),
            teamId: pick != null ? Number(pick) : null,
            locked: Date.now() >= focus.first
        });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// Self-service Captain pick (#230): the logged-in manager sets/clears their
// captained team for a regular-season week. Locks at the kickoff of their own
// earliest team that week (not the league-wide first game).
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
        const teamIds = (season.teams || []).map(t => Number(t.id));
        if (teamId != null && !teamIds.includes(teamId)) {
            return res.status(400).json({ message: 'That team is not on your roster.' });
        }

        // Lock: the manager's earliest team of the week has kicked off.
        const weekGames = (await captainGamesQuery(seasonYear, teamIds)).filter(g => Number(g.week) === week);
        const lockMs = captainLockMs(weekGames, teamIds);
        if (lockMs != null && Date.now() >= lockMs) {
            return res.status(409).json({ message: "That week's captain is locked — your first team has kicked off." });
        }
        // Safety backstop: if a kickoff can't be determined (schedule missing) but
        // the week already has a completed game, never allow retro-editing it.
        if (lockMs == null && weekGames.some(g => g.completed === true)) {
            return res.status(409).json({ message: 'That week is locked.' });
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

// Full league roster with active-season membership, for the admin "Season
// Roster" toggle. `inSeason` = has an entry for the active season; `scored` =
// that season already has banked points (so removing them would drop this
// year's scores — the UI confirms before doing that).
router.get('/league/:leagueCodeReq/roster', async (req, res) => {
    const leagueCode = req.params.leagueCodeReq;
    if (!canManageLeague(req, leagueCode)) {
        return res.status(403).json({ message: 'Forbidden: not your league' });
    }
    try {
        const year = Number(process.env.YEAR);
        const users = await User.find({ league: leagueCode },
            { firstName: 1, lastName: 1, color: 1, 'seasons.season': 1, 'seasons.weeklyScore.scoreByTeam': 1 }).lean();
        const players = users.map(u => {
            const s = (u.seasons || []).find(x => Number(x.season) === year);
            const scored = !!(s && (s.weeklyScore || []).some(w => (w.scoreByTeam || []).length > 0));
            return { _id: u._id, firstName: u.firstName, lastName: u.lastName, color: u.color, inSeason: !!s, scored };
        }).sort((a, b) => (a.firstName + ' ' + a.lastName).localeCompare(b.firstName + ' ' + b.lastName));
        // Once the season is underway, only an admin can change the roster —
        // removing a scored player would drop that year's data (needs a rescore).
        const isAdmin = effectiveRoles(req).includes('Admin');
        const seasonUnderway = await hasScoredGames(leagueCode, year);
        res.json({ season: String(year), isAdmin, editable: isAdmin || !seasonUnderway, locked: !isAdmin && seasonUnderway, players });
    } catch (err) {
        res.status(500).json({ message: err.message });
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

    // A new player joins the ACTIVE season (process.env.YEAR) with an empty
    // roster — the draft fills it. Server-owned so it can't drift to the wall-
    // clock calendar year. `color` is auto-assigned from the palette when the
    // caller doesn't supply one (the admin form no longer does).
    const seasons = (Array.isArray(req.body.seasons) && req.body.seasons.length)
        ? req.body.seasons
        : [{ season: Number(process.env.YEAR) }];
    const color = req.body.color || await pickUnusedColor(req.body.league);

    const user = new User({
        firstName: req.body.firstName,
        lastName: req.body.lastName,
        seasons: seasons,
        color: color,
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

    // Exactly one score field is written per call, and only when present.
    //
    // The `!= null` guard on weeklyScore is the fix: this was a bare else, so ANY
    // body without cumulativeScore assigned weeklyScore — a body of just
    // { isUpdated: true } set it to undefined and wiped the season's scores. Both
    // scoring callers happen to always send one, so it never fired, but nothing
    // enforced that.
    //
    // They stay mutually exclusive on purpose. getUser projects `seasons` with
    // $elemMatch, and Mongoose REFUSES to save a document that both edits a
    // scalar and replaces an array wholesale under such a projection ("for your
    // own good…") — so a body carrying both would throw and write NOTHING. Either
    // one alone saves cleanly. Don't merge these into two independent ifs; the
    // ScoringWrites spec pins the behavior.
    if (req.body.cumulativeScore != null) {
        res.user.seasons[0].cumulativeScore = req.body.cumulativeScore;
    } else if (req.body.weeklyScore != null) {
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

    var date = new Date();
    var centralTime = date.toLocaleString("en-US", {timeZone: "America/Chicago"});
    res.user.lastUpdated = centralTime;

    if (req.body.season != null && req.body.teams != null) {
        var seasonExist = res.user.seasons.findIndex(x => x.season == req.body.season);

        if (seasonExist > -1) {
            // Merge: replace only the drafted teams and keep the rest of the
            // season (franchiseName, captains, cumulativeScore, weeklyScore,
            // draftPosition). Overwriting the whole subdoc wiped those.
            res.user.seasons[seasonExist].teams = req.body.teams;
            res.user.markModified('seasons');
        } else {
            res.user.seasons.push({ season: req.body.season, teams: req.body.teams });
        }
    }

    try {
        const updatedUser = await res.user.save();
        res.status(200).json(updatedUser);
    } catch (err) {
        res.status(400).json({message: err.message});
    }
});

// Include or exclude a player for the ACTIVE season, without touching any other
// season. This is the non-destructive replacement for hard-deleting a manager:
// unchecking only drops their current-season entry, so all prior seasons,
// scores, and draft history are preserved.
router.post('/:id/season-membership', async (req, res) => {
    try {
        const included = !!(req.body && req.body.included);
        const user = await User.findById(req.params.id);
        if (!user) return res.status(404).json({ message: 'Cannot find user' });
        if (!canManageLeague(req, user.league)) {
            return res.status(403).json({ message: 'Forbidden: not your league' });
        }
        const year = Number(process.env.YEAR);
        // Locked once the season is underway (would drop scored data); admins
        // only, since applying it needs a rescore.
        if (!effectiveRoles(req).includes('Admin') && await hasScoredGames(user.league, year)) {
            return res.status(423).json({ message: 'The roster is locked once the season is underway. Ask an admin to change it.' });
        }
        const has = (user.seasons || []).some(s => Number(s.season) === year);
        if (included && !has) {
            user.seasons.push({ season: year });
        } else if (!included && has) {
            user.seasons = user.seasons.filter(s => Number(s.season) !== year);
        }
        user.lastUpdated = new Date().toLocaleString("en-US", { timeZone: "America/Chicago" });
        await user.save();
        res.json({ inSeason: (user.seasons || []).some(s => Number(s.season) === year) });
    } catch (err) {
        res.status(400).json({ message: err.message });
    }
});

// Everything the Correct a Roster tool needs in one read: each manager's teams
// for the season, plus the FBS teams nobody in the league has. Also reports
// whether the season is underway, so the UI can show the lock before a
// commissioner picks a team and gets refused.
router.get('/league/:league/roster-teams', async (req, res) => {
    try {
        const league = req.params.league;
        const season = Number(req.query.season || process.env.YEAR);

        const users = await User.find(
            { league, 'seasons.season': season },
            { firstName: 1, lastName: 1, color: 1, seasons: { $elemMatch: { season } } }
        ).lean();

        const taken = new Set();
        const managers = users.map(u => {
            const s = (u.seasons && u.seasons[0]) || {};
            const teams = (s.teams || []).map(t => {
                taken.add(Number(t.id));
                return { id: t.id, school: t.school, logo: pickLogo(t.logos) || null };
            });
            return {
                userId: String(u._id),
                name: `${u.firstName || ''} ${u.lastName || ''}`.trim(),
                franchise: s.franchiseName || null,
                teams
            };
        }).sort((a, b) => a.name.localeCompare(b.name));

        const allTeams = await Team.find({}, { id: 1, school: 1, conference: 1, logos: 1 }).lean();
        const available = allTeams
            .filter(t => !taken.has(Number(t.id)))
            .map(t => ({ id: t.id, school: t.school, conference: t.conference || '', logo: pickLogo(t.logos) || null }))
            .sort((a, b) => a.school.localeCompare(b.school));

        const isAdmin = effectiveRoles(req).includes('Admin');
        const seasonUnderway = await hasScoredGames(league, season);
        res.json({
            league, season: String(season), managers, available,
            isAdmin, seasonUnderway,
            locked: seasonUnderway && !isAdmin
        });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// Correct one team on a manager's season roster.
//
// A completed draft used to be final — the only write path bulk-overwrote all
// ten teams and had no UI — so a draft-night misclick was permanent. This
// rewrites BOTH the roster and the matching draft pick, because draft grades,
// the draft board and the Draft Steal highlight all read the pick; correcting
// one without the other would leave them quietly disagreeing.
router.patch('/:id/roster-team', async (req, res) => {
    try {
        const user = await User.findById(req.params.id);
        if (!user) return res.status(404).json({ message: 'Cannot find user' });
        if (!canManageLeague(req, user.league)) {
            return res.status(403).json({ message: 'Forbidden: not your league' });
        }

        const season = Number((req.body && req.body.season) || process.env.YEAR);
        const fromTeamId = req.body && req.body.fromTeamId;
        const toTeamId = req.body && req.body.toTeamId;

        const seasonDoc = (user.seasons || []).find(s => Number(s.season) === season);
        if (!seasonDoc) return res.status(404).json({ message: `No ${season} roster for that manager.` });

        const targetTeam = toTeamId == null ? null : await Team.findOne({ id: Number(toTeamId) }).lean();

        // Is the replacement already spoken for anywhere in this league?
        let takenBy = null;
        if (targetTeam) {
            const holder = await User.findOne(
                { league: user.league, _id: { $ne: user._id }, seasons: { $elemMatch: { season, 'teams.id': Number(toTeamId) } } },
                { firstName: 1, lastName: 1 }
            ).lean();
            if (holder) takenBy = { name: `${holder.firstName || ''} ${holder.lastName || ''}`.trim() };
        }

        const isAdmin = effectiveRoles(req).includes('Admin');
        const seasonUnderway = await hasScoredGames(user.league, season);
        const check = rosterCorrection.validateCorrection({
            roster: seasonDoc.teams, fromTeamId, toTeamId, targetTeam, takenBy, seasonUnderway, isAdmin
        });
        if (!check.ok) return res.status(check.status).json({ message: check.message });

        const nextTeam = rosterCorrection.rosterTeamFrom(targetTeam);
        const applied = rosterCorrection.replaceRosterTeam(seasonDoc.teams, fromTeamId, nextTeam);
        if (!applied.changed) return res.status(404).json({ message: 'That team is not on this manager\'s roster.' });
        seasonDoc.teams = applied.teams;
        user.markModified('seasons');
        user.lastUpdated = new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' });
        try {
            await user.save();
        } catch (err) {
            // Most likely the roster schema rejecting a thin location record.
            return res.status(422).json({ message: `Could not roster ${targetTeam.school}: ${err.message}` });
        }

        // Keep the draft record in step. Absent for a season assembled without a
        // live draft, which is fine — there's no pick to correct.
        let draftUpdated = false;
        const draft = await Draft.findOne({ league: user.league, season });
        if (draft) {
            const nextPicks = rosterCorrection.replaceDraftPick(draft.picks, user._id, fromTeamId, nextTeam);
            if (nextPicks.changed) {
                draft.picks = nextPicks.picks;
                draft.markModified('picks');
                draft.updatedAt = new Date();
                await draft.save();
                draftUpdated = true;
            }
        }

        console.log(`Roster correction · ${user.league} ${season}: ${user.firstName} ${check.current.school} -> ${targetTeam.school}`
            + (draftUpdated ? ' (draft pick updated)' : ' (no draft pick found)'));

        res.json({
            userId: String(user._id), season: String(season),
            from: { id: check.current.id, school: check.current.school },
            to: { id: nextTeam.id, school: nextTeam.school, logo: pickLogo(nextTeam.logos) || null },
            draftUpdated,
            // Every scored week was computed against the old roster, so the
            // numbers are stale until a full-season re-score runs.
            rescoreNeeded: seasonUnderway
        });
    } catch (err) {
        res.status(400).json({ message: err.message });
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