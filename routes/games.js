const express = require('express');
const { activeSeason } = require('../modules/active-season');
const router = express.Router();
const Game = require('../models/game');
const BettingLine = require('../models/bettingLine');
const Ranking = require('../models/ranking');
const Record = require('../models/record');
const TeamSeasonStat = require('../models/teamSeasonStat');
const PlayerSeasonLeader = require('../models/playerSeasonLeader');
const User = require('../models/user');
const Team = require('../models/team');
const { massCreateInputError, gamesResponseError, stripAbsentScores } = require('../modules/retrieve-games');
const { pickLogo } = require('../public/logo.js');
const { getLivePlays, summarizeForStorage, isFinalPayload } = require('../modules/live-plays');
const { buildPlayByPlay, buildDriveChart } = require('../modules/play-by-play');
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

// The field set GET /games/seasonType/:type/week/:week/team/:team answers with.
//
// Exported so a test can check it — though note the response test keeps its own
// explicit list, because driving the assertion off this object would delete the
// assertion along with the field.
//
// FOUR callers read these documents. A field dropped here goes silently
// undefined in all of them:
//   public/userHome.js         buildGameCard, batchTeamLogos, the 30s live patch
//   public/standings.js        displaySchedule
//   modules/scoring.js         updateScores — no UI. It reads these documents
//                              over HTTP from the BATCHED route below (one
//                              request per week, not one per rostered team) and
//                              hands each raw document to calculateScoreV1/V2, which
//                              feeds evaluate() -> buildContext() in
//                              modules/scoring-detectors.js. That reads
//                              conferenceGame / homeConference / awayConference.
//                              Drop them and nothing throws: isConference()
//                              answers undefined, so a conference win banks the
//                              NON-conference rule in the claunts model and
//                              silently loses confBonus in the graham model, and
//                              isPowerFiveUpset(undefined, undefined) is false —
//                              re-opening the non-P5 upset loophole. Wrong weekly
//                              totals, clean job logs.
//   modules/retrieve-games.js  retrieveGameBySeasonWeekTeam — no callers today,
//                              but exported, and it returns the array verbatim
//
// conferenceGame / homeConference / awayConference exist solely for that third
// consumer: modules/scoring-detectors.js reads them to decide conference wins
// and non-P5 upsets. They have no UI.
// The most team ids the batched week lookup accepts in one request.
// modules/scoring.js chunks to match; see the note at that route.
const MAX_TEAM_IDS = 200;

const GAME_READ_FIELDS = {
    id: 1, season: 1, week: 1, seasonType: 1,
    startDate: 1, startTimeTbd: 1, completed: 1, status: 1,
    homeId: 1, homeTeam: 1, homePoints: 1,
    awayId: 1, awayTeam: 1, awayPoints: 1,
    period: 1, clock: 1, possession: 1, situation: 1,
    notes: 1, outlet: 1, weather: 1, highlights: 1, lastUpdated: 1,
    // scoring only — no UI reads these; see the note above
    conferenceGame: 1, homeConference: 1, awayConference: 1
};

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
    var year = req.query.season || activeSeason('football');
    try {
        // PROJECT. This route answers raw game documents to the browser, and
        // My Team calls it ONCE PER ROSTERED TEAM from three places — so the
        // set runs 2-3 times a load. Unprojected that meant every field of
        // every game, including wpSnapshots (the live poller appends a row per
        // tick) and livePlays (~50KB a game once the gamecast has run):
        //
        //   week 1: 10 requests, 191KB, 2637ms
        //   week 2: 10 requests, 410KB, 5325ms   <- first weekend polled at 10s
        //   week 4: 10 requests,   6KB,  636ms   <- not played yet
        //
        // Worst for weeks already played, and it grows every game weekend.
        //
        // Which fields, and why each one is there, lives with the constant —
        // see GAME_READ_FIELDS at the top of this file. It is stated once on
        // purpose: this block and that one drifted apart the first time they
        // both described the callers, and the one here was the stale copy.
        //
        // 410KB -> 5KB, 5325ms -> 675ms.
        const game = await Game.find({$and: [ { $or: [{"homeId":teamId}, {"awayId":teamId}]}, {"season":year}, {seasonType: seasonType}, {week: week}]}, GAME_READ_FIELDS);

        // "This team had no game that week" is an empty result, not a client
        // error. It used to 400, which put one console error per rostered team
        // on every Standings load in the postseason (most drafted teams play no
        // bowl game) and buried real failures in the noise.
        res.status(200).json(game);

    } catch (err) {
        res.status(500).json({message: err.message});
    }
});

// The same week's games for MANY teams, in one request.
//
// The single-team route above is an N+1 by construction: every caller loops a
// roster and asks per team. Standings for a classic league loops EVERY
// manager's roster — 6 managers x 10 teams — and made 60 requests taking 8918ms
// measured in the browser. One query over the same 60 ids takes 568ms.
//
// Firing them in parallel does not rescue it: they queue behind the M0 tier's
// throughput and op-rate ceiling, so 10 concurrent requests measured 863ms
// against 1026ms for the same 10 run one at a time.
//
// Answers the union, deduplicated by Mongo — a game between two rostered teams
// appears once. Callers that need it per team group it themselves; see
// gamesByTeam in public/standings.js and public/userHome.js, which map a game to
// BOTH its rostered sides, matching what the per-team route returned.
//
// modules/scoring.js reads this route too — updateScores used to fetch per
// rostered team, sequentially, which measured 120 round trips and 7.98s for the
// 2026 season against 0.44s here for the same 69 distinct teams.
//
// The per-team route stays: it still answers the browser, and
// modules/retrieve-games.js still exports a caller for it.
router.get('/seasonType/:seasonType/week/:weekNum/teams', async (req, res) => {
    const week = req.params.weekNum;
    const seasonType = req.params.seasonType;
    const year = req.query.season || activeSeason('football');

    // Ids arrive as a comma list. Only digit strings are accepted — team ids are
    // positive integers — and everything else is dropped before it can reach the
    // $in.
    //
    // Number()+Number.isFinite was not enough, and failed quietly: Number('') is
    // 0 and finite, so a missing or blank `ids` produced [0] rather than [], the
    // 400 below was unreachable, and `ids=1,2,` silently queried for team 0.
    // Number.isFinite also admits 1.5, -3, 0x10 and 1e3.
    const raw = String(req.query.ids || '')
        .split(',')
        .map(v => v.trim())
        .filter(v => v !== '');
    const ids = raw.filter(v => /^\d+$/.test(v)).map(Number);

    // A PARTIAL drop is silent otherwise, and modules/scoring.js is now a caller:
    // a team whose id does not survive this filter is simply absent from the
    // response, so it scores 0 for the week with a clean job log. A total drop
    // 400s below and scoring throws; only the partial case needs saying out loud.
    if (ids.length !== raw.length) {
        const dropped = raw.filter(v => !/^\d+$/.test(v));
        console.error(`Ignored ${dropped.length} non-numeric team id(s) on the batched week lookup: ${dropped.join(', ')}`);
    }

    if (!ids.length) {
        return res.status(400).json({ message: 'ids is required — a comma-separated list of team ids' });
    }
    // A roster is 10 and a league is 60; this is a sanity bound, not a limit
    // anyone should reach.
    //
    // modules/scoring.js chunks its requests at exactly 200 to stay under this.
    // The two constants are not shared, so LOWERING this number 400s every
    // scoring run. tests/RoutesGames.spec.js pins 200-accepted / 201-rejected and
    // tests/ScoringAggregation.spec.js pins that scoring splits at the same
    // point; changing one without the other reds both.
    if (ids.length > MAX_TEAM_IDS) {
        return res.status(400).json({ message: `too many ids (max ${MAX_TEAM_IDS})` });
    }

    try {
        const games = await Game.find({
            season: year, seasonType, week,
            $or: [{ homeId: { $in: ids } }, { awayId: { $in: ids } }]
        }, GAME_READ_FIELDS);

        // Same contract as the per-team route: no games is an empty array, not
        // a client error. Most drafted teams play no bowl game.
        res.status(200).json(games);
    } catch (err) {
        res.status(500).json({ message: err.message });
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
// Points for / against across a team's played games.
//
// CFBD's season-stats payload carries no scoring of any kind, so the only place
// points exist is the games themselves. Regular season only, to match the
// denominator the rest of the season averages are built on, and only games with
// a score — an unplayed schedule must not drag an average down.
async function seasonScoring(season, teamId) {
    const rows = await Game.aggregate([
        {
            $match: {
                season,
                seasonType: 'regular',
                homePoints: { $ne: null },
                awayPoints: { $ne: null },
                $or: [{ homeId: teamId }, { awayId: teamId }]
            }
        },
        {
            $group: {
                _id: null,
                games: { $sum: 1 },
                pointsFor: { $sum: { $cond: [{ $eq: ['$homeId', teamId] }, '$homePoints', '$awayPoints'] } },
                pointsAgainst: { $sum: { $cond: [{ $eq: ['$homeId', teamId] }, '$awayPoints', '$homePoints'] } }
            }
        }
    ]);
    const r = rows[0];
    return {
        games: r ? r.games : 0,
        pointsFor: r ? r.pointsFor : 0,
        pointsAgainst: r ? r.pointsAgainst : 0
    };
}

router.get('/detail/:gameId', async (req, res) => {
    try {
        const gameId = Number(req.params.gameId);
        const [game, bl] = await Promise.all([
            Game.findOne({ id: gameId }),
            BettingLine.findOne({ id: gameId })
        ]);
        if (!game) return res.status(404).json({ message: 'Game not found' });

        const [homeRec, awayRec, homeSeasonStats, awaySeasonStats, homeLeaders, awayLeaders,
               homeScoring, awayScoring] = await Promise.all([
            Record.findOne({ teamId: game.homeId, year: game.season }).lean(),
            Record.findOne({ teamId: game.awayId, year: game.season }).lean(),
            TeamSeasonStat.findOne({ season: game.season, team: game.homeTeam }).lean(),
            TeamSeasonStat.findOne({ season: game.season, team: game.awayTeam }).lean(),
            PlayerSeasonLeader.findOne({ season: game.season, team: game.homeTeam }).lean(),
            PlayerSeasonLeader.findOne({ season: game.season, team: game.awayTeam }).lean(),
            seasonScoring(game.season, game.homeId),
            seasonScoring(game.season, game.awayId)
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
            const toPlain = (doc, scoring) => {
                if (!doc) return null;
                const s = doc.stats instanceof Map ? Object.fromEntries(doc.stats) : (doc.stats || {});
                // `scoring` carries its own games count: it comes from the games
                // collection, not from CFBD's aggregate, so it must not be divided
                // by a denominator it wasn't summed over.
                return { team: doc.team, conference: doc.conference, games: doc.games, stats: s, scoring };
            };
            obj.seasonStats = {
                home: toPlain(homeSeasonStats, homeScoring),
                away: toPlain(awaySeasonStats, awayScoring)
            };
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
// Just the current week number, and nothing else.
//
// public/current-week.js is the app's single source for "what week is it", and
// it was reading the number off the FULL scoreboard payload — a 4.3s response
// against the M0 tier — to take one integer from it. Every page that asks the
// question paid that: the betting page awaits it before it can fetch anything
// (it decides WHICH week's games to load), and the standings page awaited it
// ahead of its entire first paint until PR #436.
//
// The week itself is cheap. It comes from a projected week+startDate scan and
// the same weekWindows/defaultWeek pair the scoreboard route uses — deliberately
// the same two functions, so this can never drift from the week the scoreboard
// lands on.
//
// No :league param: weekWindows keys off season + seasonType only. The scoreboard
// route takes a league for the rest of its payload, not for this.
router.get('/current-week/:season', async (req, res) => {
    try {
        const season = Number(req.params.season);
        if (!Number.isFinite(season)) {
            return res.status(400).json({ message: 'Invalid season' });
        }
        const seasonType = req.query.seasonType === 'postseason' ? 'postseason' : 'regular';
        const weekRows = await Game.find(
            { season, seasonType },
            { week: 1, startDate: 1, _id: 0 }
        ).lean();
        const windows = weekWindows(weekRows);
        const week = defaultWeek(windows, Date.now());
        // Same shape the scoreboard answers with for these two fields, so a
        // caller can read `week` off either.
        res.json({ season, seasonType, week: Number.isFinite(week) ? week : null });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

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

// Turn a CFBD /games row into a bulkWrite upsert op, or null if the row is
// malformed. Shared by the two ingest routes below (/week/mass-create pulls one
// week, /:season/schedule pulls the whole season) so a field mapping or a guard
// added for one is never silently missing from the other — which is exactly how
// the season-wide route ended up being the only one that could refresh a future
// week's kickoff time, and the only one that wasn't batched.
function buildGameUpsertOp(game) {
    // CFBD's casing for these three differs from the schema's.
    game.startTimeTbd = game.startTimeTBD;
    game.homePostWinProb = game.homePostgameWinProbability;
    game.awayPostWinProb = game.awayPostgameWinProbability;

    // Keep the live poller's in-progress score from being overwritten by the
    // nulls CFBD's /games sends for a game that isn't final yet.
    stripAbsentScores(game);

    var date = new Date();
    game.lastUpdated = date.toLocaleString("en-US", { timeZone: "America/Chicago" });

    // These routes are a SECOND path to completed:true — CFBD's /games carries
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

    // bulkWrite's updateOne does not run validators, and the `required`
    // validator doesn't fire for a merely-absent path on upsert — so
    // validate the candidate up front. insertMany used to do this for new
    // games; doing it for updates too means a malformed CFBD row is skipped
    // rather than written over a good doc.
    var invalid = new Game(game).validateSync();
    if (invalid) {
        console.log("Skipping invalid game with id:", game.id, "|", invalid.message);
        return null;
    }

    // `id` stays in the $set (same value the filter matches on), so an insert
    // seeds it and the read-back below can still name the game.
    return {
        updateOne: {
            filter: { id: game.id },
            update: { $set: game },
            upsert: true
        }
    };
}


//Creating Many By Week
router.post('/week/mass-create', async (req, res) => {

    var allNewGames = [];
    var allExistingGames = [];
    var year = activeSeason('football');

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
    // Guarded for the same reason as /:season/schedule below: a rejected fetch
    // (DNS, TLS reset, socket hangup) is an unhandled rejection in an Express 4
    // async handler, and with no process-level handler that kills the dyno
    // mid-slate. This route runs on every scoring job, three times a Saturday.
    // massRetrieveGames already degrades on a non-201, so a 502 costs one run's
    // ingest instead of the process.
    let response, gameData;
    try {
        response = await fetch(`https://api.collegefootballdata.com/games?year=${year}${weekParam}&seasonType=${req.body.seasonType}&classification=fbs`, {
            method: 'GET',
            headers: {
            'Accept': 'application/json',
            'Authorization': process.env.CFBD_API_KEY
            }
        });

        gameData = await response.json();
    } catch (err) {
        console.log('Game ingest could not reach CFBD:', err.message);
        return res.status(502).json({ message: `Could not reach CFBD: ${err.message}` });
    }

    var responseError = gamesResponseError(response.ok, response.status, gameData);
    if (responseError) {
        return res.status(400).json({ message: responseError });
    }

    // CFBD reports remaining monthly calls on every response — surface it so the
    // live poller's ceiling can read it for free instead of a separate /info hit.
    const remHeader = response.headers.get('x-calllimit-remaining');
    const remainingCalls = remHeader != null ? Number(remHeader) : undefined;

    // UPSERT the whole slate in ONE bulkWrite, rather than a round trip (or two)
    // per game.
    //
    // This route used to do `Game.find({ id })` and then `findOneAndUpdate` for
    // every game in the loop — 172 sequential Atlas round trips for an 86-game
    // week. That crossed Heroku's 30s request ceiling in Sep 2026: the router
    // returned its H12 error PAGE, the calling job tried to JSON.parse the HTML,
    // and doFullUpdate died before it ever reached scoring. The games were
    // saved (the handler ran on to completion at 75s) but standings sat stale
    // for two days. Three round trips now: one $in lookup, one bulkWrite, one
    // read-back.
    //
    // Still an upsert, not find-then-insertMany, and for the same reason: two
    // runs of this route overlap by construction (the Saturday job fires at
    // 15:00/18:00/22:00 on the minute and the live poller fires on every :00
    // mark, so they collide three times a Saturday). Under find-then-insert both
    // runs could decide the same game was new and insert it twice — and a second
    // doc with the same CFBD id makes the per-team week lookup return the game
    // twice, which modules/scoring.js scores twice, DOUBLING that team's points
    // for the week. The unique index on Game.id backs this up.
    const ids = gameData.map(g => g.id);
    const preExisting = new Set(
        (await Game.find({ id: { $in: ids } }, { id: 1 }).lean()).map(g => g.id)
    );

    const ops = [];
    for (const game of gameData) {
        const op = buildGameUpsertOp(game);
        if (op) ops.push(op);
    }

    if (ops.length) {
        try {
            // Unordered so one bad row doesn't abandon the rest of the slate,
            // the way the per-game try/catch used to guarantee.
            await Game.bulkWrite(ops, { ordered: false });
        } catch (err) {
            // A concurrent run of this route can win the upsert race and leave
            // us an E11000 against the unique index on Game.id. That game is
            // written — by the other run — so it is not worth failing the slate
            // over. It IS worth saying out loud: if the poller and the Saturday
            // job collide (three times a Saturday by construction) the loser can
            // drop every write it meant to make, and without this line a run that
            // wrote nothing looks exactly like a clean one in the job report.
            const writeErrors = (err && err.writeErrors) || [];
            const duplicates = writeErrors.filter(e => (e.err ? e.err.code : e.code) === 11000);
            const unexpected = writeErrors.filter(e => (e.err ? e.err.code : e.code) !== 11000);
            const applied = (err && err.result)
                ? (err.result.upsertedCount || 0) + (err.result.modifiedCount || 0)
                : 0;
            if (duplicates.length) {
                console.log(`Lost ${duplicates.length} of ${ops.length} upserts to a concurrent run `
                    + `(duplicate key); ${applied} written by this one`);
            }
            if (!writeErrors.length || unexpected.length) {
                console.log("Bulk save error:", err.message);
            }
        }
    }

    // One read-back to answer with the saved games, split the way the callers
    // expect: anything that wasn't in the DB before this run is new.
    //
    // Projected and lean deliberately. A hydrated Game carries livePlays (~50KB
    // of drives and plays once the gamecast has run) and wpSnapshots (one entry
    // per poller tick), so answering with whole docs would put ~4MB through
    // res.json() and back through JSON.parse in massRetrieveGames — on the wrong
    // side of the 30s ceiling this whole change exists to stay under. Every
    // consumer reads `week` or `.length` and nothing else: see
    // postseasonWeeksToScore and the count lines in modules/score-update.js.
    const savedIds = ops.map(o => o.updateOne.filter.id);
    const saved = savedIds.length
        ? await Game.find({ id: { $in: savedIds } },
            { id: 1, season: 1, seasonType: 1, week: 1, _id: 0 }).lean()
        : [];
    for (const doc of saved) {
        if (preExisting.has(doc.id)) {
            allExistingGames.push(doc);
        } else {
            allNewGames.push(doc);
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

// Bulk-ingest a full FBS schedule in one CFBD call. Upserts by game id, so it's
// safe to re-run and future games (no scores yet) store fine. One shot instead
// of looping /week/mass-create over the weeks.
//
// Preseason it's a prerequisite for draft grades (the projection reads each
// team's schedule) and for the live poller's games-live gate (it needs kickoff
// times in the DB ahead of time).
//
// IN SEASON it is the only thing that refreshes a FUTURE week. The scoring jobs
// mass-create the CURRENT week and nothing else, so a game more than a week out
// kept whatever kickoff it was first stored with. Real kickoffs are TBD until
// ~12 days before the game, which meant weeks 5-15 of 2026 sat on their August
// placeholder dates (midnight ET) all season and showed managers the wrong day.
// update-enrichment-job.js now posts this weekly — 1 CFBD call for every week
// at once, so the fix costs the same whether one game moved or fifty did.
// Defaults to the regular season; pass { seasonType: 'postseason' } to preload
// the bowl/CFP schedule once the bracket is published (so day-1 postseason games
// are live-pollable). `postseason` omits the week param to pull every round.
router.post('/:season/schedule', async (req, res) => {
    if (!/^\d{4}$/.test(req.params.season)) {
        return res.status(400).json({ message: 'Invalid season' });
    }
    const season = req.params.season;
    const seasonType = req.body && req.body.seasonType === 'postseason' ? 'postseason' : 'regular';

    // fetch REJECTS on a network-layer failure (DNS, TLS reset, socket hangup)
    // rather than resolving to a non-ok response, so gamesResponseError never
    // sees it. Express 4 does not route an async handler's rejection to error
    // middleware and there is no process-level unhandledRejection handler (see
    // modules/internal-api.js), which means an unguarded throw here takes the
    // whole dyno down — and this route is on a weekly cron now, so it will
    // eventually meet a flaky CFBD.
    let response, gameData;
    try {
        response = await fetch(`https://api.collegefootballdata.com/games?year=${season}&seasonType=${seasonType}&classification=fbs`, {
            method: 'GET',
            headers: { 'Accept': 'application/json', 'Authorization': process.env.CFBD_API_KEY }
        });
        gameData = await response.json();
    } catch (err) {
        console.log('Schedule ingest could not reach CFBD:', err.message);
        return res.status(502).json({ message: `Could not reach CFBD: ${err.message}` });
    }
    const responseError = gamesResponseError(response.ok, response.status, gameData);
    if (responseError) return res.status(400).json({ message: responseError });

    // ONE bulkWrite for the whole season, for the reason /week/mass-create was
    // batched in Sep 2026: this used to do a findOne plus a findOneAndUpdate per
    // game — ~1600 sequential Atlas round trips for an 800-game season, which on
    // the M0 tier is comfortably past Heroku's 30s request ceiling. It only ever
    // got away with it because nothing called it on a schedule. Something does
    // now (update-enrichment-job.js), so it has to finish inside the ceiling.
    const ops = [];
    for (const g of gameData) {
        const op = buildGameUpsertOp(g);
        if (op) ops.push(op);
    }

    // The counts come off the WRITE RESULT, never off the ops we assembled.
    // Counting the ops would mean a bulkWrite that wrote nothing at all still
    // answered "888 updated" — and this route's only caller is a cron job that
    // reads the status and the counts to decide whether the run was healthy, so
    // an optimistic count is a week of stale kickoff dates with a green job
    // report over it. The per-game try/catch this batching replaced got that
    // right by accident: a failed save simply never reached its counter.
    //
    // matchedCount, not modifiedCount: a game whose CFBD row is byte-identical
    // to what we stored modifies nothing, and reporting it as untouched would
    // read as a partial failure on every quiet week.
    let created = 0, updated = 0;
    let writeFailure = null;

    if (ops.length) {
        try {
            const result = await Game.bulkWrite(ops, { ordered: false });
            created = result.upsertedCount || 0;
            updated = result.matchedCount || 0;
        } catch (err) {
            // Whatever DID land before the error still counts.
            const partial = (err && err.result) || null;
            created = partial ? (partial.upsertedCount || 0) : 0;
            updated = partial ? (partial.matchedCount || 0) : 0;

            // Same concurrency story as mass-create: a duplicate-key loss means
            // the other run wrote that game, so it is not worth failing over.
            // Anything else is a genuine loss and has to surface as a non-2xx —
            // the caller only distinguishes healthy from not by the status.
            const writeErrors = (err && err.writeErrors) || [];
            const duplicates = writeErrors.filter(e => (e.err ? e.err.code : e.code) === 11000);
            const unexpected = writeErrors.filter(e => (e.err ? e.err.code : e.code) !== 11000);
            if (duplicates.length) {
                console.log(`Schedule ingest lost ${duplicates.length} of ${ops.length} upserts to a concurrent run`);
            }
            if (!writeErrors.length || unexpected.length) {
                console.log('Schedule bulk save error:', err.message);
                writeFailure = err.message;
            }
        }
    }

    const body = { season: Number(season), seasonType, created, updated, total: gameData.length };
    if (writeFailure) {
        return res.status(500).json(Object.assign(body, { message: `Schedule write failed: ${writeFailure}` }));
    }
    return res.status(201).json(body);
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
const { ingestBoxScores } = require('../modules/box-scores');

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
// Ingest team-level box scores from CFBD /games/teams for a given week.
// Called by the enrichment job to backfill any game the live poller's
// completion hook missed (a poller outage, a CFBD 502, a game that reached
// completed:true through routes/games.js instead). Idempotent — re-running a
// week just rewrites the same stats.
// body: { week: Number, seasonType?: 'regular'|'postseason' }
router.post('/:season/team-stats', async (req, res) => {
    if (!/^\d{4}$/.test(req.params.season)) {
        return res.status(400).json({ message: 'Invalid season' });
    }
    const season = Number(req.params.season);
    const week = req.body && req.body.week;
    if (week == null || isNaN(Number(week))) {
        return res.status(400).json({ message: 'week is required' });
    }
    try {
        const result = await ingestBoxScores(season, Number(week), req.body.seasonType);
        res.status(200).json({ season, week: Number(week), ...result });
    } catch (err) {
        console.log('Error ingesting team stats:', err.message);
        res.status(400).json({ message: err.message });
    }
});

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

// Drive chart + advanced box score for one game, from CFBD /live/plays.
//
// Split out from /detail/:gameId rather than folded into it on purpose: the
// detail payload is served on every 30s live tick and reads only local data,
// while this one can cost a billable CFBD call. Keeping them separate means the
// client asks for plays on its own terms — and stops asking the moment a game
// is final and persisted — instead of every detail refresh dragging a
// potentially billable fetch along with it.
//
// Three ways this answers, in increasing cost:
//   - `source: 'db'`     the game is final and was stored on a previous view. Free.
//   - `source: 'cache'`  another viewer fetched it within the TTL. Free.
//   - `source: 'cfbd'`   a real call. Persisted immediately if the game is final,
//                        so it is the last one this game will ever need.
//
// A fourth answer costs nothing and is not a success: `status: 'budget'` means
// the module is at its remaining-calls floor and declined to fetch. 200, not an
// error — the game page is fine and only the play log is paused.
router.get('/plays/:gameId', async (req, res) => {
    try {
        const gameId = Number(req.params.gameId);
        if (!Number.isInteger(gameId)) {
            return res.status(400).json({ message: 'A numeric game id is required' });
        }

        // The stored summary is checked first and short-circuits everything
        // else. A finished game's plays never change, so this is the branch
        // that makes looking at last week's games free.
        //
        // Gated on `completed` as well as on the summary existing. A summary is
        // written whenever CFBD's payload says Final, and CFBD says Final at
        // halftime and on transient glitches — so a game can be persisted
        // mid-game. Without this gate that stored snapshot is served for the
        // rest of the game AND after it, permanently freezing the log at
        // halftime with no way to correct it. With it, a game our own ingest
        // has not marked complete is re-fetched and the summary overwritten,
        // which self-heals a premature write. A genuinely completed game still
        // short-circuits, so it still costs at most one call for its life.
        const game = await Game.findOne({ id: gameId }, { livePlays: 1, completed: 1 }).lean();
        if (!game) return res.status(404).json({ message: 'Game not found' });
        if (game.completed && game.livePlays && (game.livePlays.drives || []).length) {
            return res.json({
                source: 'db',
                status: 'final',
                teams: game.livePlays.teams || [],
                // A stored summary is only ever written for a completed
                // game, so tell the shaper so: livePlays carries no status of
                // its own, and without it the last drive keeps CFBD's
                // 'End of Half' at the end of the fourth quarter.
                drives: buildDriveChart({ ...game.livePlays, status: 'Final' }),
                plays: buildPlayByPlay(game.livePlays)
            });
        }

        const result = await getLivePlays(gameId);

        if (result.status === 'budget') {
            // At the remaining-calls floor with nothing cached. The client
            // stops asking for the rest of the session rather than retrying
            // every tick into a guard that will keep saying no.
            return res.json({
                source: 'none', status: 'budget', teams: [], drives: [], plays: [],
                message: 'Play-by-play is paused to preserve the scoring budget'
            });
        }

        if (result.status === 'none') {
            // Pre-kickoff. A 200 with an explicit empty answer, because this is
            // the normal state of every game before it starts and the client
            // should render "no plays yet", not an error.
            return res.json({ source: result.cached ? 'cache' : 'cfbd', status: 'none', teams: [], drives: [], plays: [] });
        }

        const payload = result.payload;
        const final = isFinalPayload(payload);

        // Persist on the first view after a game ends. Fire-and-forget would be
        // tempting, but a failed write means paying for this call again on the
        // next view, so it is awaited and its failure is logged rather than
        // swallowed silently.
        if (final && !result.cached) {
            try {
                await Game.updateOne({ id: gameId }, { $set: { livePlays: summarizeForStorage(payload) } });
            } catch (err) {
                console.log(`live-plays: storing summary for ${gameId} failed: ${err.message}`);
            }
        }

        res.json({
            source: result.cached ? 'cache' : 'cfbd',
            status: result.status === 'stale' ? 'stale' : (final ? 'final' : 'live'),
            teams: payload && payload.teams ? payload.teams : [],
            // Shaped, not raw: the page needs field spans and an outcome
            // bucket, and a live game has to match a stored one exactly.
            drives: buildDriveChart(payload),
            // Shaped server-side so a live game and a stored one render
            // identically — see modules/play-by-play.js.
            plays: buildPlayByPlay(payload),
            period: payload ? payload.period : null,
            clock: payload ? payload.clock : null,
            possession: payload ? payload.possession : null,
            down: payload ? payload.down : null,
            distance: payload ? payload.distance : null,
            yardsToGoal: payload ? payload.yardsToGoal : null
        });
    } catch (err) {
        // A CFBD failure with nothing cached. 502 rather than 500: the game
        // page itself is fine, the upstream isn't, and the client treats it as
        // "try again next tick" rather than as a broken game.
        console.log(`live-plays: ${req.params.gameId} failed: ${err.message}`);
        res.status(502).json({ message: 'Play data is temporarily unavailable' });
    }
});

module.exports = router;
module.exports.GAME_READ_FIELDS = GAME_READ_FIELDS;
module.exports.MAX_TEAM_IDS = MAX_TEAM_IDS;
