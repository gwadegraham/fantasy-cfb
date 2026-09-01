const express = require('express');
const router = express.Router();
const CfpBracket = require('../models/cfpBracket');
const { deriveBracket, BracketRejected, ROUNDS } = require('../modules/cfp-bracket');
const User = require('../models/user');
const Team = require('../models/team');
const Game = require('../models/game');
const Ranking = require('../models/ranking');
const ScoringConfig = require('../models/scoringConfig');
const { resolveConfig, overridesFromDoc, modelForLeague } = require('../modules/scoring-defaults');

// The CFP bracket, one document per season. Scoring reads it to classify
// postseason rounds by game id instead of parsing CFBD's `notes` prose — see
// modules/cfp-bracket.js for why.
//
// cfb.js v4.3.2 has no PlayoffsApi, so the refresh uses raw fetch, the same way
// routes/games.js and routes/rankings.js call /games and /rankings.

// Getting One By Season
router.get('/cfp/:season', async (req, res) => {
    // Answer garbage input directly instead of letting Mongo's cast failure
    // surface as a 500 in the logs.
    if (!/^\d{4}$/.test(req.params.season)) {
        return res.status(400).json({ message: 'Invalid season' });
    }
    try {
        const bracket = await CfpBracket.findOne({ season: req.params.season });

        if (!bracket) {
            return res.status(404).json({ message: `No CFP bracket found for season ${req.params.season}` });
        }
        res.status(200).json(bracket);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// Pull a season's bracket in one CFBD call and upsert it. Non-destructive and
// safe to re-run: matches on season, replaces the stored snapshot, never
// deletes. Re-run through the postseason as results fill in.
//
// Uses /playoffs/cfp, NOT /playoffs/cfp/games. Same one-call cost, and the
// parent states `firstRoundBye` outright — the flattened form forces deriving
// the bye from `source: null`, which is a trap worth avoiding (see
// crossCheckByes in modules/cfp-bracket.js).
// `maxAgeHours` in the body makes the call conditional: if the stored bracket is
// younger than that, answer 200 and spend NO CFBD call. Scheduled callers pass
// it; a hand-run refresh omits it and always re-pulls, so a manual backfill or a
// "something looks wrong, re-pull it" is never silently skipped.
router.post('/cfp/:season/refresh', async (req, res) => {
    if (!/^\d{4}$/.test(req.params.season)) {
        return res.status(400).json({ message: 'Invalid season' });
    }
    const season = Number(req.params.season);
    try {
        const existing = await CfpBracket.findOne({ season: season });

        const maxAgeHours = Number(req.body && req.body.maxAgeHours);
        if (Number.isFinite(maxAgeHours) && maxAgeHours > 0 && existing && existing.retrievedAt) {
            const ageHours = (Date.now() - existing.retrievedAt.getTime()) / 3600000;
            if (ageHours < maxAgeHours) {
                return res.status(200).json({
                    season: season,
                    skipped: true,
                    reason: 'fresh',
                    ageHours: Math.round(ageHours * 10) / 10,
                    retrievedAt: existing.retrievedAt
                });
            }
        }

        const response = await fetch(`https://api.collegefootballdata.com/playoffs/cfp?year=${season}`, {
            method: 'GET',
            headers: { 'Accept': 'application/json', 'Authorization': process.env.CFBD_API_KEY }
        });
        const data = await response.json();
        if (!response.ok) {
            return res.status(400).json({ message: (data && data.message) || `CFBD request failed (${response.status})` });
        }

        // A refused bracket is a 400, not a 500: the request worked, the payload
        // isn't something we'll score off. The caller keeps the bracket it had
        // (or none), and postseason scoring falls back to the notes path.
        let derived;
        try {
            derived = deriveBracket(data);
        } catch (err) {
            if (err instanceof BracketRejected) {
                console.log(`CFP bracket ${season} rejected:`, err.message);
                return res.status(400).json({ message: err.message, rejected: true });
            }
            throw err;
        }

        // CFBD echoes the requested year, but store the season we asked for so a
        // payload for the wrong season can't land under this one's key.
        derived.season = season;
        derived.retrievedAt = new Date();

        // REPLACE, not update: the doc is a snapshot of one CFBD response, and a
        // merge would leave stale fields behind when the new payload doesn't have
        // them — re-ingesting a completed 2025 bracket over a hypothetical
        // re-opened one would keep the old `champion` forever.
        const bracket = await CfpBracket.findOneAndReplace(
            { season: season }, derived, { upsert: true, new: true });

        console.log(`CFP bracket ${season}: ${derived.games.length} games, ${derived.participants.length} participants (${existing ? 'updated' : 'created'})`);
        return res.status(201).json({
            season: season,
            created: !existing,
            games: derived.games.length,
            participants: derived.participants.length,
            status: derived.status,
            bracket: bracket
        });
    } catch (err) {
        return res.status(500).json({ message: err.message });
    }
});

// ---------------------------------------------------------------------------
// CFP Bracket page data — enriched bracket with franchise ownership, game
// details, venue info, and potential fantasy points per round.
//
// Pre-selection day (no CfpBracket doc, or doc has no games): projects a
// 12-team bracket from the latest CFP Committee rankings (AP Poll fallback).
// Post-selection day: uses the real bracket.
// ---------------------------------------------------------------------------

const AUTO_BID_CONFERENCES = ['ACC', 'Big 12', 'Big Ten', 'SEC', 'Pac-12'];
const GROUP_OF_5_CONFERENCES = [
    'American Athletic', 'Conference USA', 'Mid-American', 'Mountain West',
    'Sun Belt'
];

function projectBracketFromRankings(rankedTeams) {
    // CFP seeding rules (2026-27 format):
    // 1. Conference champions from ACC, Big Ten, Big 12, SEC, Pac-12 get auto bids
    // 2. Highest-ranked Group of 5 conference champion gets an auto bid
    // 3. Next 7 highest-ranked teams fill the field
    // 4. Notre Dame included if ranked top 12
    // Top 4 seeds get first-round byes

    const autoBids = [];
    const seenConferences = new Set();

    // Auto bids: highest-ranked champion from each auto-bid conference
    for (const t of rankedTeams) {
        if (autoBids.length >= 5 && seenConferences.size >= AUTO_BID_CONFERENCES.length) break;
        if (AUTO_BID_CONFERENCES.includes(t.conference) && !seenConferences.has(t.conference)) {
            autoBids.push({ ...t, bidType: 'auto', conferenceChampion: true });
            seenConferences.add(t.conference);
        }
    }

    // Group of 5 auto bid: highest-ranked G5 champion
    let g5Bid = null;
    for (const t of rankedTeams) {
        if (GROUP_OF_5_CONFERENCES.includes(t.conference) &&
            !AUTO_BID_CONFERENCES.includes(t.conference)) {
            g5Bid = { ...t, bidType: 'auto', conferenceChampion: true };
            break;
        }
    }
    if (g5Bid) autoBids.push(g5Bid);

    const autoBidIds = new Set(autoBids.map(t => t.teamId));

    // At-large: next 7 highest-ranked not already in via auto bid
    // (up to 12 total, filling remaining slots)
    const atLarge = [];
    for (const t of rankedTeams) {
        if (autoBids.length + atLarge.length >= 12) break;
        if (!autoBidIds.has(t.teamId)) {
            atLarge.push({ ...t, bidType: 'at-large', conferenceChampion: false });
        }
    }

    // Combine and seed by rank
    const field = [...autoBids, ...atLarge]
        .sort((a, b) => a.rank - b.rank)
        .slice(0, 12)
        .map((t, i) => ({ ...t, seed: i + 1, firstRoundBye: i < 4 }));

    // Build projected matchups (12-team bracket):
    // First round: #5 vs #12, #6 vs #11, #7 vs #10, #8 vs #9
    // QF: #1 vs winner(8/9), #2 vs winner(7/10), #3 vs winner(6/11), #4 vs winner(5/12)
    const firstRoundMatchups = [
        { higher: 8, lower: 9, roundOrder: 1 },
        { higher: 5, lower: 12, roundOrder: 2 },
        { higher: 7, lower: 10, roundOrder: 3 },
        { higher: 6, lower: 11, roundOrder: 4 },
    ];

    const games = firstRoundMatchups.map(m => {
        const high = field.find(t => t.seed === m.higher);
        const low = field.find(t => t.seed === m.lower);
        return {
            gameId: null,
            round: 'first_round',
            bracketSlot: `FR${m.roundOrder}`,
            roundOrder: m.roundOrder,
            bowlName: null,
            teams: [low, high].filter(Boolean).map(t => ({
                teamId: t.teamId, school: t.school, seed: t.seed, firstRoundBye: false
            }))
        };
    });

    // Quarterfinals: bye teams vs first-round winners
    const qfMatchups = [
        { byeSeed: 1, frSlot: 'FR1', roundOrder: 1 },
        { byeSeed: 4, frSlot: 'FR2', roundOrder: 2 },
        { byeSeed: 2, frSlot: 'FR3', roundOrder: 3 },
        { byeSeed: 3, frSlot: 'FR4', roundOrder: 4 },
    ];
    qfMatchups.forEach(m => {
        const bye = field.find(t => t.seed === m.byeSeed);
        games.push({
            gameId: null,
            round: 'quarterfinal',
            bracketSlot: `QF${m.roundOrder}`,
            roundOrder: m.roundOrder,
            bowlName: null,
            feedsFrom: m.frSlot,
            teams: bye ? [null, { teamId: bye.teamId, school: bye.school, seed: bye.seed, firstRoundBye: true }] : []
        });
    });

    // Semifinals
    games.push({ gameId: null, round: 'semifinal', bracketSlot: 'SF1', roundOrder: 1, bowlName: null, feedsFrom: ['QF1', 'QF2'], teams: [] });
    games.push({ gameId: null, round: 'semifinal', bracketSlot: 'SF2', roundOrder: 2, bowlName: null, feedsFrom: ['QF3', 'QF4'], teams: [] });

    // Championship
    games.push({ gameId: null, round: 'championship', bracketSlot: 'CHAMP', roundOrder: 1, bowlName: null, feedsFrom: ['SF1', 'SF2'], teams: [] });

    return {
        season: null,
        projected: true,
        format: 'twelve_team_projected',
        teamCount: 12,
        status: 'projected',
        champion: null,
        participants: field,
        games: games
    };
}

// 12-team CFP bracket tree for max-points DP. Each internal node is a game;
// leaves are seeds. The tree encodes which seeds can meet each other.
const BRACKET_TREE = {
    round: 'championship',
    left: {
        round: 'semifinal',
        left: {
            round: 'quarterfinal',
            left: { seed: 1 },
            right: { round: 'first_round', left: { seed: 8 }, right: { seed: 9 } }
        },
        right: {
            round: 'quarterfinal',
            left: { seed: 4 },
            right: { round: 'first_round', left: { seed: 5 }, right: { seed: 12 } }
        }
    },
    right: {
        round: 'semifinal',
        left: {
            round: 'quarterfinal',
            left: { seed: 2 },
            right: { round: 'first_round', left: { seed: 7 }, right: { seed: 10 } }
        },
        right: {
            round: 'quarterfinal',
            left: { seed: 3 },
            right: { round: 'first_round', left: { seed: 6 }, right: { seed: 11 } }
        }
    }
};

// Compute the maximum fantasy points a franchise can earn from the bracket,
// accounting for mutual exclusivity (if two franchise teams meet, only one advances).
// Returns { points, wins, elims } where:
//   wins  = [{ round, seed }]  — franchise teams winning each round
//   elims = [{ seed, round, by }] — franchise teams eliminated (and by whom)
function computeMaxFranchisePoints(franchiseSeeds, pointsByRound, model) {
    function dp(node) {
        if (node.seed !== undefined) {
            return { points: 0, advancer: franchiseSeeds.has(node.seed) ? node.seed : null, wins: [], elims: [] };
        }
        const L = dp(node.left);
        const R = dp(node.right);
        const winPts = pointsByRound[node.round] || 0;
        const byeBonus = (node.round === 'quarterfinal' && pointsByRound.quarterfinalByeBonus) || 0;
        const baseWins = [...L.wins, ...R.wins];
        const baseElims = [...L.elims, ...R.elims];

        let best = { points: L.points + R.points, advancer: null, wins: baseWins, elims: baseElims };

        const candidates = [];
        if (L.advancer !== null) {
            let pts = L.points + R.points + winPts;
            if (L.advancer <= 4 && node.round === 'quarterfinal') pts += byeBonus;
            const elims = [...baseElims];
            if (R.advancer !== null) elims.push({ seed: R.advancer, round: node.round, by: L.advancer });
            candidates.push({ points: pts, advancer: L.advancer, wins: [...baseWins, { round: node.round, seed: L.advancer }], elims });
        }
        if (R.advancer !== null) {
            let pts = L.points + R.points + winPts;
            if (R.advancer <= 4 && node.round === 'quarterfinal') pts += byeBonus;
            const elims = [...baseElims];
            if (L.advancer !== null) elims.push({ seed: L.advancer, round: node.round, by: R.advancer });
            candidates.push({ points: pts, advancer: R.advancer, wins: [...baseWins, { round: node.round, seed: R.advancer }], elims });
        }
        // Pick highest points; tie-break by higher seed (lower number = more realistic)
        for (const c of candidates) {
            if (c.points > best.points || (c.points === best.points && c.advancer < (best.advancer || Infinity))) {
                best = c;
            }
        }
        return best;
    }
    const result = dp(BRACKET_TREE);
    return { points: result.points, wins: result.wins, elims: result.elims };
}

const ROUND_LABELS_SHORT = {
    first_round: 'the First Round', quarterfinal: 'the Quarterfinals',
    semifinal: 'the Semis', championship: 'the National Championship'
};
const ROUND_ORDER = { first_round: 0, quarterfinal: 1, semifinal: 2, championship: 3 };

function buildNarrative(wins, elims, seedToSchool, variantIdx) {
    if (!wins.length) return '';

    const journeys = {};
    wins.forEach(w => {
        if (!journeys[w.seed]) journeys[w.seed] = [];
        journeys[w.seed].push(w.round);
    });
    Object.values(journeys).forEach(r => r.sort((a, b) => ROUND_ORDER[a] - ROUND_ORDER[b]));

    const elimMap = {};
    (elims || []).forEach(e => { elimMap[e.seed] = e; });

    const seeds = Object.keys(journeys).map(Number);
    const champion = seeds.find(s => journeys[s].includes('championship'));
    const name = s => seedToSchool[s] || `#${s}`;

    seeds.sort((a, b) => {
        if (a === champion) return 1;
        if (b === champion) return -1;
        return ROUND_ORDER[journeys[a][0]] - ROUND_ORDER[journeys[b][0]];
    });

    const parts = [];
    let vi = variantIdx || 0;
    const cycle = arr => arr[(vi++) % arr.length];

    const champPhrases = [
        s => `${s} wins the National Championship`,
        s => `${s} takes home the trophy`,
        s => `${s} captures the gold trophy`,
        s => `${s} is crowned champion`,
    ];
    const champPrefixes = [
        s => `${s} goes all the way and`,
        s => `${s} storms through the bracket and`,
        s => `${s} bulldozes through the field and`,
        s => `${s} powers through and`,
    ];
    const elimPhrases = [
        (by) => `falling to ${by}`,
        (by) => `being knocked out by ${by}`,
        (by) => `running into ${by}`,
        (by) => `bowing out against ${by}`,
    ];
    const frWinPhrases = [
        s => `${s} wins the First Round`,
        s => `${s} handles business in the First Round`,
        s => `${s} survives the First Round`,
    ];

    for (const seed of seeds) {
        const rounds = journeys[seed];
        const last = rounds[rounds.length - 1];
        const school = name(seed);
        const elim = elimMap[seed];

        if (last === 'championship') {
            const finish = cycle(champPhrases)(school);
            if (rounds.length >= 3) {
                parts.push(`${cycle(champPrefixes)(school)} ${finish.slice(school.length + 1)}`);
            } else {
                parts.push(finish);
            }
        } else if (elim) {
            const bySchool = name(elim.by);
            const exitRound = ROUND_LABELS_SHORT[elim.round];
            const elimVerb = cycle(elimPhrases)(bySchool);
            if (rounds.length === 1 && rounds[0] === 'first_round') {
                parts.push(`${cycle(frWinPhrases)(school)} before ${elimVerb} in ${exitRound}`);
            } else {
                parts.push(`${school} reaches ${ROUND_LABELS_SHORT[last]} before ${elimVerb}`);
            }
        } else {
            parts.push(`${school} advances through ${ROUND_LABELS_SHORT[last]}`);
        }
    }

    if (parts.length === 1) return parts[0] + '.';
    if (parts.length === 2) return parts[0] + ', and ' + parts[1] + '.';
    return parts.slice(0, -1).join('. ') + ', and ' + parts[parts.length - 1] + '.';
}

// Points a team earns for reaching/winning each round (per the league's config).
function buildPointsByRound(cfg, model) {
    const v = cfg.values;
    const disabled = new Set(cfg.disabled || []);
    const enabled = new Set(cfg.enabled || []);

    const pts = {
        first_round: 0,
        quarterfinal: 0,
        semifinal: 0,
        championship: 0
    };

    if (model === 'graham') {
        if (!disabled.has('cfpFirstRound'))            pts.first_round = v.cfpFirstRound || 0;
        if (!disabled.has('cfpQuarterfinal'))           pts.quarterfinal = v.cfpQuarterfinal || 0;
        if (!disabled.has('cfpSemifinal'))              pts.semifinal = v.cfpSemifinal || 0;
        if (!disabled.has('nationalChampionshipWin'))   pts.championship = v.nationalChampionship || 0;
        // Top-4 bye bonus stacks on quarterfinal
        if (!disabled.has('cfpQuarterfinalTop4Bonus'))  pts.quarterfinalByeBonus = v.cfpQuarterfinalTop4Bonus || 0;
    } else {
        // Claunts: first-round loss → cfpAppearance, otherwise each round is its own value
        if (!disabled.has('cfpFirstRoundLoss'))         pts.first_round_loss = v.cfpAppearance || 0;
        if (!disabled.has('cfpQuarterfinal'))            pts.quarterfinal = v.cfpQuarterfinal || 0;
        if (!disabled.has('cfpSemifinal'))               pts.semifinal = v.cfpSemifinal || 0;
        if (!disabled.has('nationalChampionship'))       pts.championship = v.nationalChampionship || 0;
    }

    return pts;
}

// Max points a team could earn running the table from a given seed
function maxPointsForSeed(seed, pointsByRound, model) {
    let total = 0;
    const hasBye = seed <= 4;

    if (model === 'graham') {
        if (!hasBye) total += pointsByRound.first_round || 0;
        total += pointsByRound.quarterfinal || 0;
        if (hasBye && pointsByRound.quarterfinalByeBonus) total += pointsByRound.quarterfinalByeBonus;
        total += pointsByRound.semifinal || 0;
        total += pointsByRound.championship || 0;
    } else {
        // Claunts: first-match gives QF/SF/Champ points (not first-round appearance)
        // Non-bye teams: if they win R1 they get QF, not first-round-loss
        total += pointsByRound.quarterfinal || 0;
        total += pointsByRound.semifinal || 0;
        total += pointsByRound.championship || 0;
    }

    return total;
}

router.get('/bracket/:season/:league', async (req, res) => {
    const season = req.params.season;
    const league = req.params.league;

    if (!/^\d{4}$/.test(season)) {
        return res.status(400).json({ message: 'Invalid season' });
    }

    try {
        const seasonNum = Number(season);
        const model = modelForLeague(league);

        // Scoring config for point values
        const cfgDoc = await ScoringConfig.findOne({ league });
        const cfg = resolveConfig(league, overridesFromDoc(cfgDoc));
        const pointsByRound = buildPointsByRound(cfg, model);

        // Users in this league for team-to-franchise mapping
        const users = await User.find({ league, 'seasons.season': season });
        const teamOwnerMap = {};
        users.forEach(u => {
            const s = (u.seasons || []).find(x => String(x.season) === String(season));
            ((s && s.teams) || []).forEach(t => {
                teamOwnerMap[Number(t.id)] = {
                    userId: u._id,
                    firstName: u.firstName,
                    lastName: u.lastName,
                    color: u.color,
                    avatarUrl: u.avatarUrl,
                    franchise: (s && s.franchiseName) || u.firstName
                };
            });
        });

        // Try to load the real bracket
        let bracket = await CfpBracket.findOne({ season: seasonNum });
        let projected = false;

        if (!bracket || !bracket.games || !bracket.games.length) {
            // Project from rankings
            const latestRanking = await Ranking.findOne(
                { season: seasonNum, seasonType: 'regular' },
                {},
                { sort: { week: -1 } }
            );

            if (!latestRanking || !latestRanking.polls || !latestRanking.polls.length) {
                return res.status(404).json({ message: 'No rankings available to project bracket' });
            }

            // Prefer CFP Committee Rankings, fall back to AP
            const cfpPoll = latestRanking.polls.find(p => p.poll === 'Playoff Committee Rankings');
            const apPoll = latestRanking.polls.find(p => p.poll === 'AP Top 25');
            const poll = cfpPoll || apPoll;

            if (!poll || !poll.ranks || !poll.ranks.length) {
                return res.status(404).json({ message: 'No usable poll found for bracket projection' });
            }

            // Match poll teams to Team docs for ids/logos
            const pollSchools = poll.ranks.map(r => r.school);
            const teamDocs = await Team.find(
                { school: { $in: pollSchools } },
                { id: 1, school: 1, mascot: 1, abbreviation: 1, conference: 1, color: 1, alt_color: 1, logos: 1 }
            );
            const teamBySchool = {};
            teamDocs.forEach(t => { teamBySchool[t.school] = t; });

            const rankedTeams = poll.ranks
                .filter(r => teamBySchool[r.school])
                .map(r => {
                    const t = teamBySchool[r.school];
                    return {
                        teamId: t.id,
                        school: t.school,
                        conference: t.conference,
                        rank: r.rank,
                        firstPlaceVotes: r.firstPlaceVotes,
                        points: r.points
                    };
                });

            // If no G5 team is ranked, fall back to SP+ ratings
            const hasG5 = rankedTeams.some(t =>
                GROUP_OF_5_CONFERENCES.includes(t.conference) &&
                !AUTO_BID_CONFERENCES.includes(t.conference));
            if (!hasG5) {
                const g5Candidates = await Team.aggregate([
                    { $match: { conference: { $in: GROUP_OF_5_CONFERENCES, $nin: AUTO_BID_CONFERENCES } } },
                    { $unwind: '$seasons' },
                    { $match: { 'seasons.season': seasonNum, 'seasons.spRating': { $ne: null } } },
                    { $sort: { 'seasons.spRating': -1 } },
                    { $limit: 1 },
                    { $project: { id: 1, school: 1, conference: 1 } }
                ]);
                const g5Doc = g5Candidates[0];
                if (g5Doc && !rankedTeams.some(rt => rt.teamId === g5Doc.id)) {
                    rankedTeams.push({
                        teamId: g5Doc.id,
                        school: g5Doc.school,
                        conference: g5Doc.conference,
                        rank: 26,
                        firstPlaceVotes: 0,
                        points: 0
                    });
                }
            }

            bracket = projectBracketFromRankings(rankedTeams);
            bracket.season = seasonNum;
            bracket.pollSource = cfpPoll ? 'Playoff Committee Rankings' : 'AP Top 25';
            bracket.pollWeek = latestRanking.week;
            projected = true;
        }

        // Enrich bracket teams with logos, colors, and franchise ownership
        const allTeamIds = new Set();
        (bracket.participants || []).forEach(p => allTeamIds.add(p.teamId));
        (bracket.games || []).forEach(g => (g.teams || []).forEach(t => { if (t) allTeamIds.add(t.teamId); }));

        const teamDocs = await Team.find(
            { id: { $in: [...allTeamIds] } },
            { id: 1, school: 1, mascot: 1, abbreviation: 1, conference: 1, color: 1, alt_color: 1, logos: 1, location: 1 }
        );
        const teamMap = {};
        teamDocs.forEach(t => { teamMap[t.id] = t; });

        // Enrich games with Game doc data (scores, venue, date, etc.)
        const gameIds = (bracket.games || []).filter(g => g.gameId).map(g => g.gameId);
        const gameDocs = await Game.find(
            { id: { $in: gameIds } },
            { id: 1, homeId: 1, awayId: 1, homeTeam: 1, awayTeam: 1, homePoints: 1,
              awayPoints: 1, completed: 1, venue: 1, startDate: 1, period: 1, clock: 1,
              outlet: 1, notes: 1, attendance: 1, neutralSite: 1 }
        );
        const gameMap = {};
        gameDocs.forEach(g => { gameMap[g.id] = g; });

        // Build enriched response
        const enrichedParticipants = (bracket.participants || []).map(p => {
            const t = teamMap[p.teamId] || {};
            const owner = teamOwnerMap[p.teamId];
            return {
                ...p,
                mascot: t.mascot,
                abbreviation: t.abbreviation,
                conference: p.conference || t.conference,
                color: t.color,
                altColor: t.alt_color,
                logos: t.logos,
                owner: owner || null,
                maxPoints: maxPointsForSeed(p.seed, pointsByRound, model)
            };
        });

        const enrichedGames = (bracket.games || []).map(g => {
            const gameDoc = g.gameId ? gameMap[g.gameId] : null;
            const teams = (g.teams || []).map(gt => {
                if (!gt) return null;
                const t = teamMap[gt.teamId] || {};
                const owner = teamOwnerMap[gt.teamId];
                return {
                    ...gt,
                    mascot: t.mascot,
                    abbreviation: t.abbreviation,
                    conference: t.conference,
                    color: t.color,
                    altColor: t.alt_color,
                    logos: t.logos,
                    owner: owner || null,
                    score: gameDoc ? (gameDoc.homeId === gt.teamId ? gameDoc.homePoints : gameDoc.awayPoints) : null
                };
            });

            // Projected FR venue: higher seed (last in teams array) hosts
            let projectedVenue = null;
            if (!gameDoc && g.round === 'first_round' && teams.length === 2) {
                const homeTeam = teams[1];
                if (homeTeam) {
                    const homeTDoc = teamMap[homeTeam.teamId];
                    if (homeTDoc && homeTDoc.location && homeTDoc.location.name) {
                        projectedVenue = homeTDoc.location.name;
                    }
                }
            }

            return {
                ...g,
                teams,
                feedsFrom: g.feedsFrom || null,
                projectedVenue,
                game: gameDoc ? {
                    completed: gameDoc.completed,
                    venue: gameDoc.venue,
                    startDate: gameDoc.startDate,
                    period: gameDoc.period,
                    clock: gameDoc.clock,
                    outlet: gameDoc.outlet,
                    notes: gameDoc.notes,
                    attendance: gameDoc.attendance,
                    neutralSite: gameDoc.neutralSite
                } : null
            };
        });

        // Points summary per franchise — uses bracket tree DP to handle
        // mutual exclusivity (two franchise teams can't both win out)
        const franchiseSummary = {};
        enrichedParticipants.forEach(p => {
            if (!p.owner) return;
            const key = p.owner.franchise;
            if (!franchiseSummary[key]) {
                franchiseSummary[key] = {
                    ...p.owner,
                    teams: [],
                    seeds: new Set()
                };
            }
            franchiseSummary[key].teams.push({
                teamId: p.teamId,
                school: p.school,
                seed: p.seed,
                logos: p.logos,
                color: p.color
            });
            franchiseSummary[key].seeds.add(p.seed);
        });

        const seedToSchool = {};
        enrichedParticipants.forEach(p => { seedToSchool[p.seed] = p.school; });

        Object.values(franchiseSummary).forEach((f, idx) => {
            const result = computeMaxFranchisePoints(f.seeds, pointsByRound, model);
            f.maxPoints = result.points;
            f.narrative = buildNarrative(result.wins, result.elims, seedToSchool, idx);
            delete f.seeds;
        });

        res.json({
            season: seasonNum,
            league,
            model,
            projected,
            pollSource: bracket.pollSource || null,
            pollWeek: bracket.pollWeek || null,
            format: bracket.format,
            status: bracket.status,
            champion: bracket.champion,
            pointsByRound,
            participants: enrichedParticipants,
            games: enrichedGames,
            franchiseSummary: Object.values(franchiseSummary)
                .sort((a, b) => b.maxPoints - a.maxPoints)
        });
    } catch (err) {
        console.error('Bracket route error:', err);
        res.status(500).json({ message: err.message });
    }
});

module.exports = router;
