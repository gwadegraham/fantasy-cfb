// Head-to-head on a basketball league.
//
// Football's H2H, fed by basketball. The matchups, the schedule, the award
// rule, the write and the roster pin are modules/h2h.js and
// modules/h2h-settle.js — the same code that banks football's bonus. What is
// different, and lives here, is the input:
//
//   - the GAMES that gate a week come from `hoopsgames`. Football's pass reads
//     `games`, and 130 of the 365 basketball team ids are also football ids,
//     so the football query returns real, wrong games rather than none.
//   - the WEEKS are the basketball mode weeks (modules/hoops-modes.js): every
//     regular-season week through the last one, Christmas included, with no
//     16-week cap.
//   - the matchup TOTAL leaves out conference-tournament points, which still
//     score but are not part of the matchup ("the conference tournaments and
//     March are scored without them"). The scoring pass flags those rows
//     `noModes`.
//
// A week settles when every mode game a drafted team plays in it is final.
// A game still unplayed a week after its scheduled tip is treated as not
// happening (a postponement, or the stale half of a rescheduled pair — see
// modules/hoops-stale-duplicates.js), so one cancellation cannot hold a week
// open for the rest of the season.

const HoopsGame = require('../models/hoopsGame');
const ScoringConfig = require('../models/scoringConfig');
const franchiseRepo = require('./franchise-repo');
const { engagementForSeason } = require('./scoring-defaults');
const { computeH2HAwards, pinnedH2HIds, baseWeekScore, H2H_MAX_WEEK } = require('./h2h');
const { bankLeague } = require('./h2h-settle');
const { isModeGame, seasonModeWeeks } = require('./hoops-modes');
const { overdue } = require('./hoops-stale-duplicates');

// hoops-scoring-pass requires THIS module, so its helpers are read at call
// time rather than destructured at load — a load-time destructure of a
// half-initialised module is undefined.
const scoringPass = () => require('./hoops-scoring-pass');

// The matchup total for one stored week: the base (score less any H2H bonus
// already folded in), less the points from games the modes do not cover.
// The Captain bonus stays in — it is only ever earned on mode games.
function modeWeekBase(entry) {
    if (!entry) return 0;
    const exempt = (entry.scoreByTeam || [])
        .filter(r => r && r.noModes)
        .reduce((sum, r) => sum + (Number(r.score) || 0), 0);
    return baseWeekScore(entry) - exempt;
}

// Basketball rosters are refs; computeH2HAwards reads `teams`. Hand it a copy
// with `teams` filled from the scorer's own roster reader.
function withTeams(users, season) {
    const { rosterIds } = scoringPass();
    return (users || []).map(u => Object.assign({}, u, {
        seasons: (u.seasons || []).map(s => Number(s.season) === Number(season)
            ? Object.assign({}, s, { teams: rosterIds(s).map(id => ({ id })) })
            : s)
    }));
}

// The mode games that gate a week, in the shape modules/h2h.js reads, plus
// the display fields the standings card wants. Overdue unplayed games are
// dropped (see the header).
function gateGames(rows, nowMs) {
    const { isFinal } = scoringPass();
    return (rows || [])
        .filter(isModeGame)
        .filter(g => isFinal(g) || !overdue(g, nowMs))
        .map(g => ({
            id: g.id, week: g.week, seasonType: 'regular',
            completed: isFinal(g),
            homeId: g.homeTeamId, awayId: g.awayTeamId,
            homeTeam: g.homeTeam, awayTeam: g.awayTeam,
            homePoints: g.homePoints, awayPoints: g.awayPoints,
            startDate: g.startDate ? new Date(g.startDate).toISOString() : null,
            startTimeTbd: !!g.startTimeTbd,
            status: g.status
        }));
}

// Everything computeH2HAwards needs for a basketball league, read once.
// Shared by the banking pass below and the standings read model
// (routes/standings.js), so the table and the banked bonus are decided from
// the same inputs.
//
// `withProjection` (the standings read model's full payload only) widens the
// SAME read to what the win-probability bar's projection needs: the venue
// and conference fields the engine reads, and the whole regular season
// rather than the mode weeks — the engine calibrates a team over its whole
// schedule, so a game in a trailing non-mode week still belongs in it. The
// raw rows come back as `rows`; `games` (the card and award input) is the
// same either way. The banking pass never asks for it, so its read is
// unchanged.
const PROJECTION_FIELDS = { neutralSite: 1, homeConference: 1, awayConference: 1, season: 1 };
async function h2hInputs({ users, season, weeks, nowMs = Date.now(), withProjection = false }) {
    const modeWeeks = weeks || await seasonModeWeeks(season);
    const shaped = withTeams(users, season);
    const drafted = new Set();
    shaped.forEach(u => (u.seasons || []).forEach(s => {
        if (Number(s.season) === Number(season)) (s.teams || []).forEach(t => drafted.add(Number(t.id)));
    }));
    const ids = [...drafted];
    const last = modeWeeks.length ? modeWeeks[modeWeeks.length - 1] : 0;
    const fields = {
        id: 1, week: 1, seasonType: 1, conferenceGame: 1, tournament: 1, gameNotes: 1,
        homeTeamId: 1, awayTeamId: 1, homeTeam: 1, awayTeam: 1, homePoints: 1, awayPoints: 1,
        status: 1, startDate: 1, startTimeTbd: 1, _id: 0
    };
    const rows = ids.length && last ? await HoopsGame.find({
        season: Number(season), seasonType: 'regular',
        week: withProjection ? { $gte: 1 } : { $gte: 1, $lte: last },
        $or: [{ homeTeamId: { $in: ids } }, { awayTeamId: { $in: ids } }]
    }, withProjection ? Object.assign({}, fields, PROJECTION_FIELDS) : fields).lean() : [];
    const games = gateGames(withProjection ? rows.filter(g => g.week <= last) : rows, nowMs);
    const out = { users: shaped, games, weeks: modeWeeks, maxWeek: last, drafted };
    if (withProjection) out.rows = rows;
    return out;
}

// Decide and bank one basketball league's H2H for a season.
//
// Safe to run at any time, as often as wanted — it is the football pass's
// guarantees, inherited: only settled weeks award, every entry is rebuilt
// from its base, and with H2H off any stored bonus is stripped.
//
// `cfgDoc` may be passed by a caller that already read it.
async function applyHoopsH2H(league, season, { nowMs = Date.now(), weeks, cfgDoc } = {}) {
    const seasonNum = Number(season);
    const seasonStr = String(season);
    const users = await franchiseRepo.h2hManagers(league, seasonNum);
    if (!users.length) return { league, enabled: false, managersUpdated: 0, bonusAwarded: 0, rosterPinned: false };

    const doc = cfgDoc !== undefined ? cfgDoc : await ScoringConfig.findOne({ league }).lean();
    const eng = engagementForSeason(doc && doc.engagementBySeason, seasonStr);
    const pinnedIds = pinnedH2HIds(doc, seasonStr);

    let computed = null, maxWeek = H2H_MAX_WEEK;
    if (eng.h2hEnabled) {
        const inputs = await h2hInputs({ users, season: seasonNum, weeks, nowMs });
        maxWeek = inputs.maxWeek;
        computed = computeH2HAwards({
            users: inputs.users, games: inputs.games, season: seasonStr, pinnedIds,
            winBonus: eng.h2hWinBonus, tieBonus: eng.h2hTieBonus,
            maxWeek, weeks: inputs.weeks, weekBase: modeWeekBase
        });
    }
    const banked = await bankLeague({ league, seasonNum, seasonStr, users, eng, pinnedIds, computed, maxWeek });
    return Object.assign({ league, enabled: !!eng.h2hEnabled }, banked);
}

module.exports = { applyHoopsH2H, h2hInputs, modeWeekBase, gateGames, withTeams };
