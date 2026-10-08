// Basketball jersey numbers, imported once a season from CBBD /teams/roster.
//
// ONE billable call answers for every team (season is required, team is
// optional): measured for 2026, 1,535 teams and 5,643 players in ~2 MB — D-I
// plus the lower divisions CBBD tracks. Only players with a number are kept.
//
// NOT a nightly job. Numbers do not change once the season starts, so the
// import runs alongside the schedule ingest (POST /hoops/games/:season/schedule)
// the first time that ingest finds no roster on file, and never again on its
// own. A late addition is picked up by the admin re-run,
// POST /hoops/teams/:season/roster. Cost: one call a season, plus one per
// manual re-run.

const cbbd = require('./cbbd-client');
const HoopsRoster = require('../models/hoopsRoster');

// One upsert per numbered player. Pure, so the shape is testable without CBBD
// or Mongo. A player CBBD lists twice keeps the last row it sent.
function buildOps(season, rows, now = new Date()) {
    const byId = new Map();
    for (const team of rows || []) {
        // null, not 0 — Number(null) is a valid-looking team id.
        const teamId = team && team.teamId != null ? Number(team.teamId) : NaN;
        for (const p of (team && team.players) || []) {
            // Checked for null BEFORE Number(): Number(null) is 0, a valid id.
            if (!p || p.id == null) continue;
            const athleteId = Number(p.id);
            if (!Number.isInteger(athleteId)) continue;
            // Trimmed, never coerced: "00" and "0" are different jerseys.
            const jersey = p.jersey == null ? '' : String(p.jersey).trim();
            if (!jersey) continue;
            byId.set(athleteId, {
                updateOne: {
                    filter: { season, athleteId },
                    update: { $set: { season, athleteId, teamId: Number.isFinite(teamId) ? teamId : undefined,
                        name: p.name, jersey, fetchedAt: now } },
                    upsert: true
                }
            });
        }
    }
    return [...byId.values()];
}

// The import. Throws on a CBBD failure so the caller can say which side broke.
async function importSeason(season, { now = new Date() } = {}) {
    const yr = Number(season);
    if (!Number.isInteger(yr)) throw new Error(`hoops-roster: season must be a year, got ${JSON.stringify(season)}`);
    const { data, remainingCalls } = await cbbd.cbbdGet('/teams/roster', { season: yr });
    const ops = buildOps(yr, data, now);
    // Nothing numbered yet (rosters not published for a season that has not
    // started) writes nothing, so hasSeason stays false and the next schedule
    // ingest tries again rather than this season being marked done.
    if (!ops.length) {
        return { season: yr, teams: data.length, players: 0, remainingCalls,
            skippedReason: 'CBBD has no numbered players for this season yet' };
    }
    await HoopsRoster.bulkWrite(ops, { ordered: false });
    return { season: yr, teams: data.length, players: ops.length, remainingCalls };
}

// A full roster numbers every D-I team: measured for 2026, 365 teams (CBBD
// lists 1,535, but only D-I ones carry players). Fewer than this is a roster
// CBBD is still publishing, so the gate stays open for the next ingest.
const FULL_ROSTER_TEAMS = 300;

// Has this season's roster been imported IN FULL? The schedule ingest's
// once-a-season gate — a read, never a CBBD call. "Any row" was not enough:
// a roster caught half-published would have closed the gate on 40 teams.
async function hasSeason(season) {
    const teams = await HoopsRoster.distinct('teamId', { season: Number(season) });
    return teams.filter(t => t != null).length >= FULL_ROSTER_TEAMS;
}

// Copies of `players` with `jersey` set where one is on file for the season.
// Never calls CBBD. A player with no number on file comes back untouched, and
// the page shows just the name.
async function withJerseys(season, players) {
    const list = Array.isArray(players) ? players : [];
    // null, not 0, for a player with no id — the Number(null) trap above.
    const idOf = (p) => (p && p.athleteId != null && Number.isInteger(Number(p.athleteId)) ? Number(p.athleteId) : null);
    const ids = [...new Set(list.map(idOf).filter(id => id !== null))];
    if (!ids.length) return list;
    const rows = await HoopsRoster.find({ season: Number(season), athleteId: { $in: ids } },
        { athleteId: 1, jersey: 1, _id: 0 }).lean();
    const byId = new Map(rows.map(r => [r.athleteId, r.jersey]));
    return list.map(p => (byId.has(idOf(p)) ? Object.assign({}, p, { jersey: byId.get(idOf(p)) }) : p));
}

module.exports = { importSeason, hasSeason, withJerseys, buildOps, FULL_ROSTER_TEAMS };
