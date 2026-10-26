// Freezing a basketball draft's grade input (HoopsGradeSnapshot).
//
// Lives here, not in routes/draft.js, because it has two callers: the draft
// socket freezes AUTOMATICALLY the moment the last pick lands, and the
// commissioner route stays as the escape hatch for the two cases the
// automatic freeze will not decide on its own — a flagged schedule, and
// replacing a freeze that already exists. Nobody has to remember a manual
// step on draft night any more.
//
// freezeHoopsGrades answers { status, body } rather than writing a response,
// so the socket can log the answer and the route can send it unchanged.
const Draft = require('../models/draft');
const HoopsTeam = require('../models/hoopsTeam');
const HoopsGame = require('../models/hoopsGame');
const HoopsGradeSnapshot = require('../models/hoopsGradeSnapshot');
const ScoringConfig = require('../models/scoringConfig');
const draftPool = require('./draft-pool');
const hoopsDraft = require('./hoops-draft-projection');
const audit = require('./audit-log');
const { resolveConfig, overridesFromDoc } = require('./scoring-defaults');

// The season's teams and the regular-season games touching the pool (and any
// drafted team), read live from the basketball collections. The fields are
// the projection's own (hoops-draft-projection TEAM_FIELDS / GAME_FIELDS),
// and only the pool's games are read: Atlas latency tracks bytes.
async function liveHoopsInputs(season, draft) {
    const teams = await HoopsTeam.find({ season }, hoopsDraft.TEAM_FIELDS).lean();
    const ids = hoopsDraft.poolOf(teams, draft.poolSize).map(t => t.id)
        .concat((draft.picks || []).map(p => p.team && Number(p.team.id)).filter(Number.isFinite));
    const uniq = Array.from(new Set(ids));
    const games = await HoopsGame.find({
        season, seasonType: 'regular',
        $or: [{ homeTeamId: { $in: uniq } }, { awayTeamId: { $in: uniq } }]
    }, hoopsDraft.GAME_FIELDS).lean();
    return { teams, games };
}

// The pool's schedule flags (hoops-draft-projection scheduleFlags): teams
// whose stored slate is too short or too long to project honestly.
function poolScheduleFlags(teams, games, config, poolSize) {
    const proj = hoopsDraft.projectHoopsTeams(teams, games, {
        cfg: config, projectIds: hoopsDraft.poolOf(teams, poolSize).map(t => t.id)
    });
    return hoopsDraft.scheduleFlags(proj, teams);
}

// How a flagged team reads in a refusal: "Gonzaga (11 games, short)".
function flagList(flags) {
    return flags.map(f => `${f.school || f.id} (${f.games} games)`).join(', ');
}

// The flag refusal, with the advice each kind actually needs: a SHORT
// schedule is a conference slate not published yet, a PADDED one is most
// likely duplicate listings CBBD has not cleared.
function refusalFor(flags, how) {
    const thin = flags.filter(f => f.kind === 'thin'), thick = flags.filter(f => f.kind === 'thick');
    const parts = [];
    if (thin.length) parts.push(`${thin.length} with a short schedule — ${flagList(thin)}: a conference slate is probably not published yet, so wait for it and re-ingest the basketball schedule`);
    if (thick.length) parts.push(`${thick.length} with a padded schedule — ${flagList(thick)}: most likely duplicate listings of rescheduled games, so check those teams' games for stale copies`);
    return `Not frozen: pool teams whose schedules cannot be projected honestly. ${parts.join('. ')}. Then freeze again, or ${how}.`;
}

const HOW = 'POST /draft/grades/:league/:season/freeze with {"force": true, "reason": "<why>"} to freeze anyway; the override is recorded in the audit log';

// Freeze a basketball draft's grade input: every team's preseason rating and
// rank, and the pool's schedule, into a HoopsGradeSnapshot pinned on the
// draft. No spWeek: the preseason Torvik numbers are a single paste with no
// weekly history to reconstruct from, so a freeze copies what is stored now —
// which is why it happens on the last pick, before any re-import.
//
// REFUSED, unless the commissioner overrides with { force, reason }, when:
//   - the ratings import is half-finished (no override: re-run the import);
//   - any pool team's schedule is flagged thin or thick — a frozen grade
//     would carry that error all season, while a live one heals as the
//     schedule is filled in;
//   - the draft is ALREADY frozen. Replacing a freeze moves every letter in
//     the league, so it is never silent. The old snapshot is KEPT, not
//     deleted: the new one names it in `replaces`, so what the league was
//     graded on before stays recoverable.
// Every freeze is written to the audit log, with the override reason. `req`
// is the commissioner's request, or null for the automatic freeze (the audit
// row then reads 'system').
async function freezeHoopsGrades({ league, season, req = null, force = false, reason = '', note } = {}) {
    const draft = await Draft.findOne({ league, season });
    if (!draft) return { status: 404, body: { message: 'No draft for that league and season' } };
    try {
        await draftPool.assertRatedSeason(season, draft.poolSize);
    } catch (err) {
        return { status: err.status || 409, body: { message: `Not frozen: ${err.message}` } };
    }
    reason = typeof reason === 'string' ? reason.trim() : '';
    const override = force === true && !!reason;

    const previous = draft.hoopsGradeSnapshot
        ? await HoopsGradeSnapshot.findById(draft.hoopsGradeSnapshot, { takenAt: 1 }).lean()
        : null;
    if (draft.hoopsGradeSnapshot && !override) {
        return { status: 409, body: {
            message: `${league} ${season} grades are already frozen${previous ? ` (since ${new Date(previous.takenAt).toISOString()})` : ''}. Replacing the freeze moves every manager's grade — ${HOW}.`,
            frozenAt: previous ? previous.takenAt : null, snapshotId: String(draft.hoopsGradeSnapshot)
        } };
    }

    const { teams, games } = await liveHoopsInputs(season, draft);
    const cfgDoc = await ScoringConfig.findOne({ league }).lean();
    const flags = poolScheduleFlags(teams, games, resolveConfig(league, overridesFromDoc(cfgDoc)), draft.poolSize);
    if (flags.length && !override) {
        return { status: 409, body: { message: refusalFor(flags, HOW), scheduleFlags: flags } };
    }

    const previousId = draft.hoopsGradeSnapshot || null;
    const replacing = !!previousId;
    const forced = override && (replacing || flags.length > 0);
    const snap = await HoopsGradeSnapshot.create({
        league, season, reason: 'draft-baseline', rankSource: hoopsDraft.RANK_SOURCE,
        poolSize: draft.poolSize || null,
        note: note || `Draft-grade baseline for ${league}`,
        scheduleFlags: flags,
        forced,
        forceReason: forced ? reason : undefined,
        replaces: replacing ? previousId : undefined,
        teams: hoopsDraft.snapshotTeams(teams), games: hoopsDraft.snapshotGames(games)
    });
    // Pinned only if the draft still holds the freeze this call read. Two
    // freezes racing past the checks above would otherwise both save — the
    // last one winning, the first orphaned, and the survivor's `replaces`
    // naming the wrong snapshot. The loser takes its snapshot back out.
    const pinned = await Draft.updateOne(
        { _id: draft._id, hoopsGradeSnapshot: previousId ? previousId : { $in: [null] } },
        { $set: { hoopsGradeSnapshot: snap._id, updatedAt: new Date() } });
    if (!pinned.matchedCount) {
        await HoopsGradeSnapshot.deleteOne({ _id: snap._id });
        return { status: 409, body: { message: `${league} ${season} grades were frozen by another request while this one ran — reload and check the freeze before trying again.` } };
    }

    await audit.record(req, {
        action: 'draft.grades.freeze', league, season: String(season),
        summary: `Draft grades ${replacing ? 're-frozen (replacing the earlier freeze)' : 'frozen'}`
            + (req ? '' : ' automatically at the last pick')
            + (flags.length ? ` with ${flags.length} flagged schedule${flags.length === 1 ? '' : 's'}` : '')
            + (snap.forced ? ` — override: ${reason}` : ''),
        meta: { snapshotId: String(snap._id), replaces: replacing ? String(snap.replaces) : null,
                forced: snap.forced, reason: forced ? reason : null, scheduleFlags: flags }
    });

    return { status: 200, body: {
        league, season, sport: 'basketball', snapshotId: String(snap._id), takenAt: snap.takenAt,
        teamCount: snap.teams.length, gameCount: snap.games.length, rankSource: snap.rankSource,
        scheduleFlags: flags, forced: snap.forced,
        replaced: replacing ? String(snap.replaces) : null
    } };
}

module.exports = { freezeHoopsGrades, liveHoopsInputs, poolScheduleFlags, refusalFor };
