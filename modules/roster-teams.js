// A manager's rostered teams, as full team objects, whichever sport (#478).
//
// Two storage shapes exist and this is the ONLY place that knows it:
//
//   football   seasons[].teams     — a full copy of each team document
//   basketball seasons[].teamRefs  — { id, sport }, resolved here
//
// Everything above this sees the same thing either way, which is the point.
// Basketball's readers — scoring (#316), its My Team, its standings — are all
// still unwritten, so they get written against one function and never learn
// that a roster can be stored two ways. Football's existing dozen callers are
// untouched; moving them over is #478, for an offseason.
//
// ---- the season is not optional, and history is why ----
//
// A reference resolves against THAT SEASON's team row, not today's. A team
// that moves conference between seasons — the hoopsTeam model records 27 of
// them between 2026 and 2027 — must still read as its old conference on an old
// roster. `hoopsteams` is one row per (season, id) and football keeps
// `seasons[].conference`, so both sports can answer it; this has to ask.
//
// It is also why a reference beats the copy it replaces: the copy is frozen at
// DRAFT time, before the season starts, so a correction made in November never
// reaches it.

const Team = require('../models/team');
const HoopsTeam = require('../models/hoopsTeam');

// One season's entry off a franchise, whatever shape it is in.
function entryFor(franchise, season) {
    const seasons = (franchise && franchise.seasons) || [];
    return seasons.find(s => Number(s.season) === Number(season)) || null;
}

// The rostered teams for one season, in roster order.
//
// Roster ORDER is preserved deliberately: the draft wrote these in pick order,
// and several surfaces show "first pick" without saying so. A find-by-id per
// ref would be N queries, so one query fetches the set and the refs put it
// back in order.
async function rosterTeams(franchise, season) {
    const entry = entryFor(franchise, season);
    if (!entry) return [];

    // Football, and anything written before refs existed. Already whole.
    if (entry.teams && entry.teams.length) return entry.teams;

    const refs = entry.teamRefs || [];
    if (!refs.length) return [];

    const year = Number(season);
    // GROUPED BY SPORT, not `refs.some(...)`. The sport is on each REF, which
    // is what lets a roster be read without the season cache being primed —
    // the failure that let a basketball pick match a football team in #476 —
    // and an all-or-nothing branch threw that away: one basketball ref sent
    // the whole list to HoopsTeam and silently dropped every football one,
    // logging it as a missing basketball team.
    //
    // No mixed roster exists today. It is the shape the per-ref field promises
    // and the shape #478 produces while football is half migrated.
    const hoopsIds = refs.filter(r => r.sport === 'basketball').map(r => Number(r.id));
    const otherIds = refs.filter(r => r.sport !== 'basketball').map(r => Number(r.id));

    const [hoopsRows, footballRows] = await Promise.all([
        hoopsIds.length ? HoopsTeam.find({ season: year, id: { $in: hoopsIds } }).lean() : [],
        otherIds.length ? Team.find({ id: { $in: otherIds } }).lean() : []
    ]);

    // Keyed by sport as well as id: the two collections number teams
    // independently, so football 1 and basketball 1 are different programs.
    const key = (sport, id) => `${sport === 'basketball' ? 'b' : 'f'}:${Number(id)}`;
    const byId = new Map([
        ...hoopsRows.map(t => [key('basketball', t.id), t]),
        ...footballRows.map(t => [key('football', t.id), t])
    ]);
    // A ref that resolves to nothing is DROPPED, not left as a hole. A null in
    // a roster array reaches every renderer as a crash; a team that is simply
    // absent reads as what it is. It is logged because it should not happen —
    // the rows are per-season and never deleted.
    const out = [];
    for (const ref of refs) {
        const team = byId.get(key(ref.sport, ref.id));
        if (team) out.push(team);
        else console.log(`roster: ${ref.sport} team ${ref.id} has no ${year} row — dropped from the roster`);
    }
    return out;
}

// How many teams this manager holds, without fetching any of them.
//
// Several places only need the count — "has this manager drafted?" — and
// resolving a roster to answer it is the kind of read that made these
// documents expensive in the first place.
function rosterSize(franchise, season) {
    const entry = entryFor(franchise, season);
    if (!entry) return 0;
    return (entry.teams || []).length || (entry.teamRefs || []).length;
}

// What to STORE for a drafted team, given the sport.
//
// Basketball writes a reference; football keeps writing the whole document
// until #478 moves it. One function so the decision lives in one place rather
// than being re-made at each call site.
function rosterEntryFor(team, sport) {
    if (sport !== 'basketball') return team;
    const id = Number(team && team.id);
    // A ref carrying NaN fails validation for the WHOLE manager, and
    // persistTeamsToUsers only logs that — so one unusable pick costs someone
    // their entire roster. Refuse to build it; the caller drops the pick.
    if (!Number.isInteger(id)) return null;
    return { id, sport: 'basketball' };
}

module.exports = { rosterTeams, rosterSize, rosterEntryFor, entryFor };
