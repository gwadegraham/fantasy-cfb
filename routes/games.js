const express = require('express');
const router = express.Router();
const Game = require('../models/game');
const { massCreateInputError, gamesResponseError } = require('../modules/retrieve-games');

// Configure API key authorization: ApiKeyAuth
const CFBD_API_KEY = process.env.CFBD_API_KEY;
var cfb = require('cfb.js');
const { findOneAndUpdate } = require('../models/user');
var defaultClient = cfb.ApiClient.instance;
var ApiKeyAuth = defaultClient.authentications['ApiKeyAuth'];
ApiKeyAuth.apiKey = CFBD_API_KEY;

//Getting All
router.get('/', async (req, res) => {
    try {
        const games = await Game.find();
        res.json(games);
    } catch (err) {
        res.status(500).json({message: err.message});
    }
});

//Getting One By Team & Week
router.get('/seasonType/:seasonType/week/:weekNum/team/:team', async (req, res) => {
    var week = req.params.weekNum;
    var teamId = req.params.team;
    var seasonType = req.params.seasonType;
    var year = req.query.season || process.env.YEAR;
    try {
        const game = await Game.find({$and: [ { $or: [{"homeId":teamId}, {"awayId":teamId}]}, {"season":year}, {seasonType: seasonType}, {week: week}]});

        // "This team had no game that week" is an empty result, not a client
        // error. It used to 400, which put one console error per rostered team
        // on every Standings load in the postseason (most drafted teams play no
        // bowl game) and buried real failures in the noise.
        res.status(200).json(game);

    } catch (err) {
        res.status(500).json({message: err.message});
    }
});

//Getting All By Team
router.get('/season/:season/team/:team', async (req, res) => {
    var team = req.params.team;
    var season = req.params.season;
    try {
        const games = await Game.find({$and: [ { $or: [{"homeTeam":team}, {"awayTeam":team}]}, {"season":season}]});
        res.status(200).json(games);

    } catch (err) {
        res.status(500).json({message: err.message});
    }
});

//Getting All By Team ID
router.get('/season/:season/teamId/:teamId', async (req, res) => {
    var teamId = req.params.teamId;
    var season = req.params.season;
    try {
        const games = await Game.find({$and: [ { $or: [{"homeId":teamId}, {"awayId":teamId}]}, {"season":season}]});
        res.status(200).json(games);

    } catch (err) {
        res.status(500).json({message: err.message});
    }
});

//Getting API Calls Info
router.get('/info', async (req, res) => {
    try {
        const response = await fetch(`https://api.collegefootballdata.com/info`, {
            method: 'GET',
            headers: {
            'Accept': 'application/json',
            'Authorization': process.env.CFBD_API_KEY
            }
        });

        var apiInfo = await response.json();
        res.status(200).json(apiInfo);

    } catch (err) {
        res.status(500).json({message: err.message});
    }
});

//Creating One
router.post('/', async (req, res) => {
    let existingGame;
    try {
        existingGame = await Game.find({ id: req.body.id });

        if (req.body.homePoints == null) {
            return res.status(400).json({message: `Game with id ${req.body.id} is not complete`});
        }
        else if (existingGame.length != 0) {
            return res.status(400).json({message: `Game with id ${existingGame[0]["id"]} already exists`});
        } else {
            const game = new Game(req.body);
        
            try {
                const newGame = await game.save();
                return res.status(201).json(newGame);
            } catch (err) {
                res.status(400).json({message: err.message});
            }
        }
    } catch (err) {
        res.status(400).json({message: err.message});
    }
});

//Creating Many By Week
router.post('/week/mass-create', async (req, res) => {

    var allNewGames = [];
    var allExistingGames = [];
    var year = process.env.YEAR;

    // Reject a missing week/seasonType before hitting CFBD: an empty week makes
    // CFBD return a 400 JSON object instead of an array, and iterating that
    // object below throws "not iterable" — an unhandled rejection in this async
    // handler, which crashes the Node process. (Week is optional for postseason —
    // see massCreateInputError.)
    var inputError = massCreateInputError(req.body.week, req.body.seasonType);
    if (inputError) {
        return res.status(400).json({ message: inputError });
    }

    // Regular season fetches a single week; postseason omits the week to pull
    // the whole slate (every CFP round) in one call. `classification` is the
    // current CFBD param (the old `division` alias still works but is legacy).
    const weekParam = req.body.seasonType === 'postseason' ? '' : `&week=${req.body.week}`;
    const response = await fetch(`https://api.collegefootballdata.com/games?year=${year}${weekParam}&seasonType=${req.body.seasonType}&classification=fbs`, {
        method: 'GET',
        headers: {
        'Accept': 'application/json',
        'Authorization': process.env.CFBD_API_KEY
        }
    });

    var gameData = await response.json();

    var responseError = gamesResponseError(response.ok, response.status, gameData);
    if (responseError) {
        return res.status(400).json({ message: responseError });
    }

    // CFBD reports remaining monthly calls on every response — surface it so the
    // live poller's ceiling can read it for free instead of a separate /info hit.
    const remHeader = response.headers.get('x-calllimit-remaining');
    const remainingCalls = remHeader != null ? Number(remHeader) : undefined;

    // UPSERT, one game at a time, rather than find-then-insertMany.
    //
    // Two runs of this route can overlap by construction: the Saturday job fires
    // at 15:00/18:00/22:00 on the minute and the live poller fires on every :00
    // mark, so they collide three times a Saturday. Under find-then-insert both
    // runs could decide the same game was new and insert it twice — and a second
    // doc with the same CFBD id makes the per-team week lookup return the game
    // twice, which modules/scoring.js scores twice, DOUBLING that team's points
    // for the week. The unique index on Game.id backs this up.
    //
    // Per-game try/catch also means one unsaveable game no longer takes the whole
    // slate down with it, which the batch insertMany did.
    for (const game of gameData) {
        var alreadyExists = await Game.find({ id: game.id });

        game.seasonType = game.seasonType;
        game.startDate = game.startDate;
        game.startTimeTbd = game.startTimeTBD;
        game.neutralSite = game.neutralSite;
        game.conferenceGame = game.conferenceGame;
        game.venueId = game.venueId;
        game.homeId = game.homeId;
        game.homeTeam = game.homeTeam;
        game.homeConference = game.homeConference;
        game.homeDivision = game.homeDivision;
        game.homePoints = game.homePoints;
        game.homeLineScores = game.homeLineScores;
        game.homePostWinProb = game.homePostWinProb;
        game.homePregameElo = game.homePregameElo;
        game.homePostgameElo = game.homePostgameElo;
        game.awayId = game.awayId;
        game.awayTeam = game.awayTeam;
        game.awayConference = game.awayConference;
        game.awayDivision = game.awayDivision;
        game.awayPoints = game.awayPoints;
        game.awayLineScores = game.awayLineScores;
        game.awayPostWinProb = game.awayPostWinProb;
        game.awayPregameElo = game.awayPregameElo;
        game.awayPostgameElo = game.awayPostgameElo;
        game.excitementIndex = game.excitementIndex;

        var date = new Date();
        var centralTime = date.toLocaleString("en-US", {timeZone: "America/Chicago"});
        game.lastUpdated = centralTime;

        // findOneAndUpdate does not run validators, and the `required` validator
        // doesn't fire for a merely-absent path on upsert — so validate the
        // candidate up front. insertMany used to do this for new games; doing it
        // for updates too means a malformed CFBD row is skipped rather than
        // written over a good doc.
        var invalid = new Game(game).validateSync();
        if (invalid) {
            console.log("Skipping invalid game with id:", game.id, "|", invalid.message);
            continue;
        }

        // `id` stays in the $set (same value the filter matches on), so an insert
        // seeds it and the error log below can still name the game.
        try {
            var savedGame = await Game.findOneAndUpdate(
                { id: game.id },
                { $set: game },
                { new: true, upsert: true, setDefaultsOnInsert: true }
            );
            if (alreadyExists.length == 0) {
                allNewGames.push(savedGame);
            } else {
                allExistingGames.push(savedGame);
            }
        } catch (err) {
            console.log("Error saving game with id:", game.id);
            console.log("Save error:", err.message);
        }
    }

    console.log("all new games length", allNewGames.length);
    console.log("Total number of existing games: ", allExistingGames.length);

    var returnedGames = {
        newGames: allNewGames,
        existingGames: allExistingGames,
        remainingCalls: remainingCalls
    };

    return res.status(201).json(returnedGames);
});

// Bulk-ingest a full FBS schedule in one CFBD call. Preseason prerequisite for
// draft grades (the projection reads each team's schedule) and for the live
// poller's games-live gate (it needs kickoff times in the DB ahead of time).
// Upserts by game id, so it's safe to re-run and future games (no scores yet)
// store fine. One shot instead of looping /week/mass-create over the weeks.
// Defaults to the regular season; pass { seasonType: 'postseason' } to preload
// the bowl/CFP schedule once the bracket is published (so day-1 postseason games
// are live-pollable). `postseason` omits the week param to pull every round.
router.post('/:season/schedule', async (req, res) => {
    if (!/^\d{4}$/.test(req.params.season)) {
        return res.status(400).json({ message: 'Invalid season' });
    }
    const season = req.params.season;
    const seasonType = req.body && req.body.seasonType === 'postseason' ? 'postseason' : 'regular';

    const response = await fetch(`https://api.collegefootballdata.com/games?year=${season}&seasonType=${seasonType}&classification=fbs`, {
        method: 'GET',
        headers: { 'Accept': 'application/json', 'Authorization': process.env.CFBD_API_KEY }
    });
    const gameData = await response.json();
    const responseError = gamesResponseError(response.ok, response.status, gameData);
    if (responseError) return res.status(400).json({ message: responseError });

    const centralTime = new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' });
    let created = 0, updated = 0;
    for (const g of gameData) {
        g.startTimeTbd = g.startTimeTBD;
        g.lastUpdated = centralTime;
        const exists = await Game.findOne({ id: g.id });
        if (!exists) {
            try { await new Game(g).save(); created++; }
            catch (err) { console.log('Error saving game', g.id, err.message); }
        } else {
            const filter = { id: g.id };
            delete g.id;
            try { await Game.findOneAndUpdate(filter, g); updated++; }
            catch (err) { console.log('Error updating game', filter.id, err.message); }
        }
    }
    return res.status(201).json({ season: Number(season), seasonType, created, updated, total: gameData.length });
});

// Populate broadcast info (TV/web outlet) onto existing game docs from CFBD
// /games/media. One call covers the whole season; matched by game id.
router.post('/:season/media', async (req, res) => {
    if (!/^\d{4}$/.test(req.params.season)) {
        return res.status(400).json({ message: 'Invalid season' });
    }
    const season = Number(req.params.season);
    try {
        const response = await fetch(`https://api.collegefootballdata.com/games/media?year=${season}&seasonType=both`, {
            method: 'GET',
            headers: { 'Accept': 'application/json', 'Authorization': process.env.CFBD_API_KEY }
        });
        const media = await response.json();
        if (!response.ok || !Array.isArray(media)) {
            return res.status(400).json({ message: (media && media.message) || 'Could not fetch media' });
        }

        // A game can have multiple media rows (tv + web); prefer a TV outlet.
        const byId = new Map();
        media.forEach(m => {
            if (m.id == null) return;
            const existing = byId.get(m.id);
            if (!existing || (m.mediaType === 'tv' && existing.mediaType !== 'tv')) byId.set(m.id, m);
        });

        let updated = 0;
        for (const [id, m] of byId) {
            const result = await Game.updateOne(
                { id: id },
                { $set: { mediaType: m.mediaType || null, outlet: m.outlet || null } }
            );
            if (result.modifiedCount) updated++;
        }
        res.status(200).json({ season, mediaRows: media.length, updated });
    } catch (err) {
        console.log('Error updating game media:', err.message);
        res.status(400).json({ message: err.message });
    }
});

module.exports = router;