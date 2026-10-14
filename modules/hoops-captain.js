// The Captain pick on a basketball league: what the picker shows, and whether
// a pick may be written. The routes (GET/PATCH /users/me/captain) branch here
// on a basketball league and keep their own auth, audit and response code.
//
// Football's lock rule, basketball's games: a pick locks when the manager's
// FIRST team of the week tips off (modules/captain.js captainLockMs), read
// from `hoopsgames` — never `games`, whose ids collide with basketball's for
// 130 teams. The TBD tip-off rule and the choice of focus week are explained
// in modules/hoops-modes.js.

const franchiseRepo = require('./franchise-repo');
const HoopsTeam = require('../models/hoopsTeam');
const { entryFor } = require('./roster-teams');
const { captainForWeek, captainLockMs, autoCaptainTeamId } = require('./captain');
const { seasonModeWeeks, captainGames, captainFocus, lockedWeek } = require('./hoops-modes');
const { ranksFor } = require('./hoops-ranks');

const scoringPass = () => require('./hoops-scoring-pass');

// Opponent ranks shown on the picker are capped where football's are: a
// "#40" tag beside every other opponent stops meaning anything.
const RANK_SHOWN = 25;

async function teamNames(season, ids) {
    const list = [...new Set((ids || []).filter(id => id != null).map(Number))];
    if (!list.length) return {};
    const rows = await HoopsTeam.find({ season: Number(season), id: { $in: list } },
        { id: 1, school: 1, abbreviation: 1, _id: 0 }).lean();
    const out = {};
    rows.forEach(r => { out[r.id] = r; });
    return out;
}

// The picker's state for the manager's basketball franchise in `league`.
// Returns { status, body } — the route sends it as is.
async function captainState({ userId, league, season, nowMs = Date.now() }) {
    const none = { season, sport: 'basketball', week: null, lockAt: null, teamId: null, locked: true };
    const user = await franchiseRepo.byAccountId(userId, { league });
    if (!user) return { status: 404, body: { message: 'User not found.' } };
    const entry = entryFor(user, season);
    const teamIds = entry ? scoringPass().rosterIds(entry) : [];
    if (!teamIds.length) return { status: 200, body: none };

    const weeks = await seasonModeWeeks(season);
    const games = await captainGames(season, teamIds, weeks);
    const focus = captainFocus(games, teamIds, nowMs);
    const current = lockedWeek(games, teamIds, nowMs);
    // Nothing left to pick: show the week being played, locked, the way
    // football's tile does.
    const target = focus || current;
    if (!target) return { status: 200, body: none };

    const weekGames = games.filter(g => Number(g.week) === target.week)
        .sort((a, b) => String(a.startDate).localeCompare(String(b.startDate)));
    const mine = new Set(teamIds);
    const oppIds = weekGames.flatMap(g => [g.homeId, g.awayId]).filter(id => id != null && !mine.has(Number(id)));
    const [names, ranked] = await Promise.all([
        teamNames(season, oppIds),
        ranksFor(season, target.week).catch(() => ({ ranks: {} }))
    ]);
    const rankOf = (id) => {
        const r = Number(ranked && ranked.ranks && ranked.ranks[String(id)]);
        return Number.isInteger(r) && r >= 1 && r <= RANK_SHOWN ? r : null;
    };
    const slate = teamIds.map(tid => ({
        teamId: tid,
        games: weekGames
            .filter(g => Number(g.homeId) === tid || Number(g.awayId) === tid)
            .map(g => {
                const isHome = Number(g.homeId) === tid;
                const oppId = isHome ? g.awayId : g.homeId;
                const opp = names[oppId];
                return {
                    gameId: g.id,
                    opp: (opp && (opp.abbreviation || opp.school)) || (isHome ? g.awayTeam : g.homeTeam) || '',
                    oppRank: rankOf(oppId),
                    ha: isHome ? 'vs' : '@',
                    // The real tip, or null when TBD. `day` is the instant the
                    // game locks a pick (its Eastern day's start when TBD), so
                    // the picker can still say WHICH day an untimed game is.
                    kickoff: g.tipoff,
                    day: g.startDate
                };
            })
    }));
    // Which teams close the pick — named by the server, because a TBD tip
    // has no kickoff for the client to match the lock against.
    const lockTeamIds = teamIds.filter(tid => weekGames.some(g =>
        (Number(g.homeId) === tid || Number(g.awayId) === tid) && Date.parse(g.startDate) === target.first));

    const pick = captainForWeek(entry.captains, target.week);
    const body = {
        season, sport: 'basketball',
        week: target.week,
        lockAt: new Date(target.first).toISOString(),
        teamId: pick,
        locked: nowMs >= target.first,
        slate, lockTeamIds
    };
    // The week already being played, when the picker has moved on to the
    // next one: what is riding on it, pick or default.
    if (focus && current) {
        const curPick = captainForWeek(entry.captains, current.week);
        const prior = (entry.weeklyScore || []).filter(w => Number(w.week) < current.week);
        body.current = {
            week: current.week,
            teamId: curPick,
            autoTeamId: curPick == null ? autoCaptainTeamId(teamIds.map(id => ({ id })), prior) : null
        };
    }
    return { status: 200, body };
}

// Validate and apply a pick. Returns { status, body } for a refusal, or
// { status: 200, body, audit } after saving — the route records the audit
// row (its recordCaptain owns the wording).
async function captainWrite({ userId, league, season, week, teamId, nowMs = Date.now() }) {
    const weeks = await seasonModeWeeks(season);
    if (!Number.isInteger(week) || !weeks.includes(week)) {
        const span = weeks.length ? `weeks 1–${weeks[weeks.length - 1]}` : 'its scheduled weeks';
        return { status: 400, body: { message: `Captain applies to regular-season ${span} only.` } };
    }
    const ctx = await franchiseRepo.loadForWrite(userId, { league });
    if (!ctx || !ctx.franchise) return { status: 404, body: { message: 'User not found.' } };
    const franchise = ctx.franchise;
    const user = { _id: ctx.account._id, firstName: ctx.account.firstName,
                   lastName: ctx.account.lastName, league: franchise.league };
    const entry = (franchise.seasons || []).find(s => Number(s.season) === Number(season));
    if (!entry) return { status: 404, body: { message: 'No roster for that season.' } };
    const teamIds = scoringPass().rosterIds(entry);
    if (teamId != null && !teamIds.includes(teamId)) {
        return { status: 400, body: { message: 'That team is not on your roster.' } };
    }
    const prevTeamId = captainForWeek(entry.captains, week);
    const names = await teamNames(season, [teamId, prevTeamId]);
    // recordCaptain names teams off `season.teams`; a basketball roster is
    // refs, so it gets the two names it needs.
    const auditSeason = { teams: Object.values(names).map(t => ({ id: t.id, school: t.school })) };
    const auditBase = { user, season: auditSeason, seasonYear: season, week, teamId, prevTeamId, via: 'self' };

    const weekGames = await captainGames(season, teamIds, [week]);
    const lockMs = captainLockMs(weekGames, teamIds);
    if (lockMs != null && nowMs >= lockMs) {
        return {
            status: 409,
            body: { message: "That week's captain is locked — your first team has tipped off." },
            audit: Object.assign({ action: 'captain.locked', note: `locked at ${new Date(lockMs).toISOString()}` }, auditBase)
        };
    }
    // No backstop like football's "no kickoff time but a game is already
    // final": a basketball game always carries a startDate (the model
    // requires it), so a null lock means the manager has no game that week —
    // and then there is no result to pick after.
    const kept = (entry.captains || []).filter(c => Number(c.week) !== week);
    if (teamId != null) kept.push({ week, teamId });
    entry.captains = kept;
    await franchiseRepo.saveBoth(ctx);
    return {
        status: 200,
        body: { season, week, teamId, captains: entry.captains },
        audit: Object.assign({ action: 'captain.set' }, auditBase)
    };
}

module.exports = { captainState, captainWrite, RANK_SHOWN };
