const express = require('express');
const router = express.Router();
const Game = require('../models/game');
const BettingLine = require('../models/bettingLine');
const Ranking = require('../models/ranking');
const Record = require('../models/record');
const TeamSeasonStat = require('../models/teamSeasonStat');
const PlayerSeasonLeader = require('../models/playerSeasonLeader');
const User = require('../models/user');
const Team = require('../models/team');
const { massCreateInputError, gamesResponseError } = require('../modules/retrieve-games');
const { pickLogo } = require('../public/logo.js');
const {
    ownersByTeam, pointsByTeamGame, weekWindows, defaultWeek,
    conferenceList, fbsConferenceNames, weekRangeOf, weekList, recordsByTeam,
    shapeGames
} = require('../modules/league-scoreboard');

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

// Get a single game by its CFBD id (used by the game detail page).
router.get('/detail/:gameId', async (req, res) => {
    try {
        const gameId = Number(req.params.gameId);
        const [game, bl] = await Promise.all([
            Game.findOne({ id: gameId }),
            BettingLine.findOne({ id: gameId })
        ]);
        if (!game) return res.status(404).json({ message: 'Game not found' });

        const [homeRec, awayRec, homeSeasonStats, awaySeasonStats, homeLeaders, awayLeaders] = await Promise.all([
            Record.findOne({ teamId: game.homeId, year: game.season }).lean(),
            Record.findOne({ teamId: game.awayId, year: game.season }).lean(),
            TeamSeasonStat.findOne({ season: game.season, team: game.homeTeam }).lean(),
            TeamSeasonStat.findOne({ season: game.season, team: game.awayTeam }).lean(),
            PlayerSeasonLeader.findOne({ season: game.season, team: game.homeTeam }).lean(),
            PlayerSeasonLeader.findOne({ season: game.season, team: game.awayTeam }).lean()
        ]);

        const obj = game.toObject({ flattenMaps: true });

        if (homeRec && homeRec.total) obj.homeRecord = homeRec.total.wins + '-' + homeRec.total.losses;
        if (awayRec && awayRec.total) obj.awayRecord = awayRec.total.wins + '-' + awayRec.total.losses;

        // Look up AP rankings for this game's week
        const ranking = await Ranking.findOne({
            season: game.season,
            seasonType: game.seasonType || 'regular',
            week: game.week
        }).lean();
        if (ranking) {
            const ap = ranking.polls.find(p => p.poll === 'AP Top 25');
            if (ap) {
                const homeRank = ap.ranks.find(r => r.school === game.homeTeam);
                const awayRank = ap.ranks.find(r => r.school === game.awayTeam);
                if (homeRank) obj.homeRanking = homeRank.rank;
                if (awayRank) obj.awayRanking = awayRank.rank;
            }
        }
        if (homeSeasonStats || awaySeasonStats) {
            const toPlain = (doc) => {
                if (!doc) return null;
                const s = doc.stats instanceof Map ? Object.fromEntries(doc.stats) : (doc.stats || {});
                return { team: doc.team, conference: doc.conference, games: doc.games, stats: s };
            };
            obj.seasonStats = { home: toPlain(homeSeasonStats), away: toPlain(awaySeasonStats) };
        }
        if (homeLeaders || awayLeaders) {
            obj.playerLeaders = {
                home: homeLeaders ? homeLeaders.leaders : null,
                away: awayLeaders ? awayLeaders.leaders : null
            };
        }
        if (bl && bl.lines && bl.lines.length) {
            const ranked = bl.lines.slice().sort((a, b) => {
                const pri = p => {
                    if (!p) return 9;
                    const lc = p.toLowerCase();
                    if (lc.includes('draftkings')) return 0;
                    if (lc.includes('consensus')) return 1;
                    return 2;
                };
                return pri(a.provider) - pri(b.provider);
            });
            const best = ranked[0];
            const merged = {
                provider: best.provider,
                spread: best.spread,
                spreadOpen: best.spreadOpen,
                formattedSpread: best.formattedSpread,
                overUnder: best.overUnder,
                overUnderOpen: best.overUnderOpen,
                homeMoneyline: best.homeMoneyline,
                awayMoneyline: best.awayMoneyline
            };
            for (const line of ranked) {
                if (merged.overUnder == null && line.overUnder != null) {
                    merged.overUnder = line.overUnder;
                    merged.overUnderOpen = line.overUnderOpen;
                }
                if (merged.homeMoneyline == null && line.homeMoneyline != null) {
                    merged.homeMoneyline = line.homeMoneyline;
                    merged.awayMoneyline = line.awayMoneyline;
                }
            }
            obj.bettingLines = merged;
        }
        res.status(200).json(obj);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// The poll to show against a week's games: that week's if it exists, otherwise
// the most recent one before it.
//
// A poll is only published for weeks that have been played, so an exact-week
// lookup returns nothing for every upcoming week — which left the AP rank off
// every future game and made the Top 25 filter match zero games rather than
// none-yet-ranked. The current poll is also the honest answer to "is this a
// ranked matchup" for a game that hasn't kicked off.
//
// Postseason falls back to the final regular-season poll, since bowl and CFP
// weeks carry no polls of their own.
async function latestRanking(season, seasonType, week) {
    const found = await Ranking.findOne(
        { season, seasonType, week: { $lte: week } }, null, { sort: { week: -1 } }
    ).lean();
    if (found || seasonType !== 'postseason') return found;

    return Ranking.findOne(
        { season, seasonType: 'regular' }, null, { sort: { week: -1 } }
    ).lean();
}

// League scoreboard — the whole FBS slate for one week, with the league's
// drafted teams marked up with owner + live fantasy points.
//
// Zero CFBD calls: the schedule, the live scores (live poller -> /scoreboard)
// and the fantasy points (re-scored every tick) are all already in Mongo. This
// is one indexed Game read plus the league's users.
//
// Two modes:
//   full  — the slate, the week list, and the conference filter options
//   ?live=1 — only games in progress, for the client's refresh loop. A week is
//             ~90 games; polling that every 30s to watch ~12 of them change is
//             most of the payload wasted, so the refresh asks for the live ones
//             and patches those rows in place.
//
// Week is optional: omitted, it resolves to the week you'd want on a Saturday
// (see defaultWeek). The league is a path param to match the other league-
// scoped reads (/standings/:league/..., /users/league/:league/...).
router.get('/scoreboard/:league/:season/:week?', async (req, res) => {
    try {
        const league = req.params.league;
        const season = Number(req.params.season);
        if (!Number.isFinite(season)) {
            return res.status(400).json({ message: 'Invalid season' });
        }
        const seasonType = req.query.seasonType === 'postseason' ? 'postseason' : 'regular';
        const liveOnly = req.query.live === '1' || req.query.live === 'true';
        const nowMs = Date.now();

        // Week windows drive both the week picker and the default week. Skipped
        // when the caller already named a week AND only wants the live rows —
        // the refresh loop shouldn't re-read the season's start dates every 30s.
        let windows = null;
        let week = req.params.week != null ? Number(req.params.week) : NaN;
        if (!Number.isFinite(week) || !liveOnly) {
            const weekRows = await Game.find(
                { season, seasonType },
                { week: 1, startDate: 1, _id: 0 }
            ).lean();
            windows = weekWindows(weekRows);
            if (!Number.isFinite(week)) week = defaultWeek(windows, nowMs);
        }

        if (week == null || !Number.isFinite(week)) {
            return res.json({
                league, season, seasonType, week: null,
                weeks: [], conferences: [], games: [], liveCount: 0
            });
        }

        const [games, users] = await Promise.all([
            Game.find(
                { season, seasonType, week },
                {
                    id: 1, week: 1, seasonType: 1, startDate: 1, startTimeTbd: 1,
                    completed: 1, neutralSite: 1, period: 1, clock: 1, possession: 1,
                    situation: 1, lastPlay: 1,
                    homeId: 1, homeTeam: 1, homeConference: 1, homePoints: 1,
                    awayId: 1, awayTeam: 1, awayConference: 1, awayPoints: 1,
                    outlet: 1, weather: 1, notes: 1, venue: 1, _id: 0
                }
            ).lean(),
            User.find(
                { league, 'seasons.season': season },
                {
                    firstName: 1, lastName: 1, color: 1, avatarUrl: 1,
                    seasons: { $elemMatch: { season } }
                }
            ).lean()
        ]);

        const owners = ownersByTeam(users, season);
        const points = pointsByTeamGame(users, season, week);

        // Logos and abbreviations for everyone on the slate. One read of ~130
        // unique teams rather than the two-per-game the Game docs would imply.
        const teamIds = [...new Set(games.flatMap(g => [g.homeId, g.awayId]))];
        const [teamDocs, ranking, lines, recordDocs] = await Promise.all([
            Team.find({ id: { $in: teamIds } },
                { id: 1, abbreviation: 1, logos: 1, conference: 1, classification: 1, _id: 0 }).lean(),
            latestRanking(season, seasonType, week),
            BettingLine.find({ season, seasonType, week: week }, { id: 1, lines: 1, _id: 0 }).lean(),
            Record.find({ year: season, teamId: { $in: teamIds } },
                { teamId: 1, total: 1, _id: 0 }).lean()
        ]);

        const teams = {};
        teamDocs.forEach(t => {
            teams[t.id] = { abbr: t.abbreviation || null, logo: pickLogo(t.logos) || null };
        });

        const ranks = {};
        if (ranking && ranking.polls) {
            const ap = ranking.polls.find(p => p.poll === 'AP Top 25');
            (ap && ap.ranks ? ap.ranks : []).forEach(r => { ranks[r.school] = r.rank; });
        }

        // DraftKings when they have a line, else whoever does — the game cards
        // on My Team already prefer DK, and disagreeing here would show two
        // different spreads for the same game on two pages.
        const lineMap = {};
        lines.forEach(bl => {
            const all = bl.lines || [];
            const chosen = all.find(l => l.provider === 'DraftKings') || all[0];
            if (chosen) lineMap[bl.id] = chosen;
        });

        const ctx = {
            owners, points, teams, ranks, lines: lineMap, nowMs,
            records: recordsByTeam(recordDocs)
        };
        let shaped = shapeGames(games, ctx);
        const liveCount = shaped.filter(g => g.state === 'live').length;
        if (liveOnly) shaped = shaped.filter(g => g.state === 'live');

        res.json({
            league, season, seasonType, week,
            weeks: windows ? weekList(windows) : undefined,
            weekRange: windows ? weekRangeOf(windows, week) : undefined,
            conferences: liveOnly ? undefined : conferenceList(games, fbsConferenceNames(teamDocs)),
            liveCount,
            games: shaped
        });
    } catch (err) {
        res.status(500).json({ message: err.message });
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
        game.homePostWinProb = game.homePostgameWinProbability;
        game.homePregameElo = game.homePregameElo;
        game.homePostgameElo = game.homePostgameElo;
        game.awayId = game.awayId;
        game.awayTeam = game.awayTeam;
        game.awayConference = game.awayConference;
        game.awayDivision = game.awayDivision;
        game.awayPoints = game.awayPoints;
        game.awayLineScores = game.awayLineScores;
        game.awayPostWinProb = game.awayPostgameWinProbability;
        game.awayPregameElo = game.awayPregameElo;
        game.awayPostgameElo = game.awayPostgameElo;
        game.excitementIndex = game.excitementIndex;

        var date = new Date();
        var centralTime = date.toLocaleString("en-US", {timeZone: "America/Chicago"});
        game.lastUpdated = centralTime;

        // This route is a SECOND path to completed:true — CFBD's /games carries
        // the flag, and `$set: game` writes it. modules/scoreboard.js nulls the
        // live-only fields on its own completion tick, but it cannot be relied
        // on to get there first: /scoreboard only returns games in its current
        // window, and the poller's games-live gate stops firing the moment the
        // last live game reads final. Set completed here and the poller may
        // never run again for that game, leaving a stale "3rd & 7" on a final
        // card. So clear them here too.
        //
        // Only on a completed game — doing it unconditionally would wipe the
        // fresh situation the poller just wrote for a game still in progress.
        if (game.completed) {
            game.situation = null;
            game.lastPlay = null;
        }

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
        g.homePostWinProb = g.homePostgameWinProbability;
        g.awayPostWinProb = g.awayPostgameWinProbability;
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

// Fetch CFBD pregame win probabilities for a given season/week and store them
// on Game docs. Called by the weekly enrichment job after ratings refresh.
// body: { week: Number, seasonType?: 'regular'|'postseason' }
const { updatePregameWP } = require('../modules/pregame-wp');
const { updateWeather } = require('../modules/game-weather');
const { ingestPlayerStats } = require('../modules/player-box-scores');

router.post('/:season/pregame-wp', async (req, res) => {
    if (!/^\d{4}$/.test(req.params.season)) {
        return res.status(400).json({ message: 'Invalid season' });
    }
    const season = Number(req.params.season);
    const week = req.body && req.body.week;
    if (week == null || isNaN(Number(week))) {
        return res.status(400).json({ message: 'week is required' });
    }
    try {
        const result = await updatePregameWP(season, Number(week), req.body.seasonType);
        res.status(200).json({ season, week: Number(week), ...result });
    } catch (err) {
        console.log('Error updating pregame WP:', err.message);
        res.status(400).json({ message: err.message });
    }
});

router.post('/:season/weather', async (req, res) => {
    if (!/^\d{4}$/.test(req.params.season)) {
        return res.status(400).json({ message: 'Invalid season' });
    }
    const season = Number(req.params.season);
    const week = req.body && req.body.week;
    if (week == null || isNaN(Number(week))) {
        return res.status(400).json({ message: 'week is required' });
    }
    try {
        const result = await updateWeather(season, Number(week), req.body.seasonType);
        res.status(200).json({ season, week: Number(week), ...result });
    } catch (err) {
        console.log('Error updating weather:', err.message);
        res.status(400).json({ message: err.message });
    }
});

// Ingest player-level box scores from CFBD /games/players for a given week.
// Called by the enrichment job for weekly backfill, or manually.
// body: { week: Number, seasonType?: 'regular'|'postseason' }
router.post('/:season/player-stats', async (req, res) => {
    if (!/^\d{4}$/.test(req.params.season)) {
        return res.status(400).json({ message: 'Invalid season' });
    }
    const season = Number(req.params.season);
    const week = req.body && req.body.week;
    if (week == null || isNaN(Number(week))) {
        return res.status(400).json({ message: 'week is required' });
    }
    try {
        const result = await ingestPlayerStats(season, Number(week), req.body.seasonType);
        res.status(200).json({ season, week: Number(week), ...result });
    } catch (err) {
        console.log('Error ingesting player stats:', err.message);
        res.status(400).json({ message: err.message });
    }
});

module.exports = router;