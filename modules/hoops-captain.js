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
const { captainLockMs, autoCaptainTeamId } = require('./captain');
const { seasonModeWeeks, captainGames, captainFocus, lockedWeek } = require('./hoops-modes');
const { ranksFor } = require('./hoops-ranks');

const Franchise = require('../models/franchise');
const League = require('../models/league');
const seasons = require('./active-season');
const { engagementForSeason } = require('./scoring-defaults');
const ScoringConfig = require('../models/scoringConfig');

const scoringPass = () => require('./hoops-scoring-pass');

// ---- the frozen default ------------------------------------------------------
//
// A manager who never picks is doubled on the auto-captain: their best team
// over the weeks BEFORE this one (modules/captain.js). Football resolves that
// at scoring time and it never moves, because its weeks have gaps. Basketball
// weeks run back to back: last week's late Sunday game can finish — and move
// the averages — after this week has locked, so the default named in the lock
// reminder could differ from the team actually doubled.
//
// So on basketball the default is FROZEN, as a captains entry marked
// `auto: true`, at the earlier of: the lock reminder that names it
// (modules/push-notify.js), or the lock itself (freezeLockedWeeks, swept by
// the 30-minute captain-reminder job, for managers with no push device).
// Scoring then reads it like any pick (captainForWeek). A manual pick before
// the lock replaces it — PATCH drops the week's entry, auto or not — and
// after the lock nothing does.

// The pick for a week split into what the manager chose and the frozen
// default, so the picker can show a default as a default.
//
// A manual entry wins over an auto one for the same week, should both ever
// exist (a freeze racing a pick — see captainWrite).
function pickParts(captains, week) {
    const mine = (captains || []).filter(x => Number(x.week) === Number(week) && x.teamId != null);
    const manual = mine.find(x => !x.auto);
    if (manual) return { picked: Number(manual.teamId), frozenAuto: null };
    return mine.length ? { picked: null, frozenAuto: Number(mine[0].teamId) } : { picked: null, frozenAuto: null };
}

// The default as it stands now, from the weeks before `week`.
function autoNow(entry, teamIds, week) {
    const prior = ((entry && entry.weeklyScore) || []).filter(w => Number(w.week) < Number(week));
    return autoCaptainTeamId(teamIds.map(id => ({ id })), prior);
}

// Persist the default for one week — ONLY if the week has no entry at all.
// Atomic: the condition is in the filter, so a manual pick written a moment
// earlier, or a second freeze, is never overwritten. Returns true if written.
async function freezeAutoCaptain({ accountId, league, season, week, teamId }) {
    if (teamId == null) return false;
    const res = await Franchise.updateOne(
        { accountId, league, seasons: { $elemMatch: { season: Number(season), 'captains.week': { $ne: Number(week) } } } },
        { $push: { 'seasons.$.captains': { week: Number(week), teamId: Number(teamId), auto: true } } }
    );
    return !!res.modifiedCount;
}

// The lock sweep: every basketball league playing Captain, every manager,
// every mode week whose lock has passed with no entry — freeze the default.
// Runs from the captain-reminder job whether or not push is configured.
// Returns the number of defaults written.
async function freezeLockedWeeks(nowMs = Date.now()) {
    let frozen = 0;
    // Which leagues play basketball is the season cache's answer; with it
    // unprimed every league reads as football, so there is nothing to do
    // (and no query worth making).
    if (!seasons.primed()) return 0;
    const leagues = (await League.find({}, { code: 1, status: 1, _id: 0 }).lean())
        .filter(l => l.status !== 'archived' && seasons.sportForLeague(l.code) === 'basketball');
    for (const { code: league } of leagues) {
        const season = seasons.seasonForLeague(league);
        if (!Number.isFinite(season)) continue;
        const cfg = await ScoringConfig.findOne({ league }, { engagementBySeason: 1 }).lean();
        if (!engagementForSeason(cfg && cfg.engagementBySeason, season).captainEnabled) continue;
        const weeks = await seasonModeWeeks(season);
        const managers = await franchiseRepo.byLeagueAndSeason(league, season, { fields: ['league', 'seasons'] });
        for (const m of managers) {
            const entry = entryFor(m, season);
            const teamIds = scoringPass().rosterIds(entry);
            if (!teamIds.length) continue;
            const games = await captainGames(season, teamIds, weeks);
            for (const w of [...new Set(games.map(g => g.week))]) {
                const lock = captainLockMs(games.filter(g => g.week === w), teamIds);
                if (lock == null || nowMs < lock) continue;
                if ((entry.captains || []).some(c => Number(c.week) === Number(w))) continue;
                if (await freezeAutoCaptain({ accountId: m._id, league, season, week: w, teamId: autoNow(entry, teamIds, w) })) frozen++;
            }
        }
    }
    return frozen;
}

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

    const parts = pickParts(entry.captains, target.week);
    const pick = parts.picked;
    const body = {
        season, sport: 'basketball',
        week: target.week,
        lockAt: new Date(target.first).toISOString(),
        teamId: pick,
        locked: nowMs >= target.first,
        slate, lockTeamIds,
        // The default that will be doubled if nothing is picked: frozen if
        // it has been (reminder sent, or locked), else as it stands now.
        autoTeamId: pick == null ? (parts.frozenAuto != null ? parts.frozenAuto : autoNow(entry, teamIds, target.week)) : null
    };
    // The week already being played, when the picker has moved on to the
    // next one: what is riding on it, pick or default.
    if (focus && current) {
        const cur = pickParts(entry.captains, current.week);
        body.current = {
            week: current.week,
            teamId: cur.picked,
            autoTeamId: cur.picked == null ? (cur.frozenAuto != null ? cur.frozenAuto : autoNow(entry, teamIds, current.week)) : null
        };
    }
    return { status: 200, body };
}

// Validate and apply a pick. Returns { status, body } for a refusal, or
// { status: 200, body, audit } after saving — the route records the audit
// row (its recordCaptain owns the wording).
//
// `via: 'admin'` is the commissioner's Captain Override (PATCH
// /users/:id/captain). It skips the tip-off lock — fixing a pick after a
// disputed lock is what the override is for, and football's skips its
// kickoff lock the same way — and nothing else: the week must still be a
// mode week, the team still on the roster, and the write is the same atomic
// one, so a pick still replaces a frozen default and never a default frozen
// for another week.
async function captainWrite({ userId, league, season, week, teamId, via = 'self', nowMs = Date.now() }) {
    const admin = via === 'admin';
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
        return { status: 400, body: { message: admin ? 'That team is not on their roster.' : 'That team is not on your roster.' } };
    }
    // A frozen default is not the manager's pick: the audit says "was no one".
    const prevTeamId = pickParts(entry.captains, week).picked;
    const names = await teamNames(season, [teamId, prevTeamId]);
    // recordCaptain names teams off `season.teams`; a basketball roster is
    // refs, so it gets the two names it needs.
    const auditSeason = { teams: Object.values(names).map(t => ({ id: t.id, school: t.school })) };
    const auditBase = { user, season: auditSeason, seasonYear: season, week, teamId, prevTeamId, via: admin ? 'admin' : 'self' };

    if (!admin) {
        const weekGames = await captainGames(season, teamIds, [week]);
        const lockMs = captainLockMs(weekGames, teamIds);
        if (lockMs != null && nowMs >= lockMs) {
            return {
                status: 409,
                body: { message: "That week's captain is locked — your first team has tipped off." },
                audit: Object.assign({ action: 'captain.locked', note: `locked at ${new Date(lockMs).toISOString()}` }, auditBase)
            };
        }
    }
    // No backstop like football's "no kickoff time but a game is already
    // final": a basketball game always carries a startDate (the model
    // requires it), so a null lock means the manager has no game that week —
    // and then there is no result to pick after.
    //
    // ATOMIC, per week — not the loaded array saved back whole. The lock
    // sweep and the reminder freeze other weeks' defaults concurrently
    // (freezeAutoCaptain), and a whole-array save from this request's
    // snapshot would drop one written in between; a later sweep would then
    // freeze that week again, possibly on a different team.
    //
    // Pull this week, push the pick, then pull any AUTO entry for this week
    // that a freeze slipped in between the two — pickParts prefers a manual
    // entry anyway, so even that window cannot double the default.
    const where = { accountId: ctx.account._id, league, 'seasons.season': Number(season) };
    await Franchise.updateOne(where, { $pull: { 'seasons.$.captains': { week } } });
    if (teamId != null) {
        await Franchise.updateOne(where, { $push: { 'seasons.$.captains': { week, teamId } } });
        await Franchise.updateOne(where, { $pull: { 'seasons.$.captains': { week, auto: true } } });
    }
    const after = await Franchise.findOne(where, { seasons: { $elemMatch: { season: Number(season) } } }).lean();
    return {
        status: 200,
        body: { season, week, teamId, captains: (after.seasons[0].captains || []).map(c => ({ week: c.week, teamId: c.teamId, auto: c.auto })) },
        audit: Object.assign({ action: 'captain.set' }, auditBase)
    };
}

module.exports = { captainState, captainWrite, freezeAutoCaptain, freezeLockedWeeks, pickParts, autoNow, RANK_SHOWN };
