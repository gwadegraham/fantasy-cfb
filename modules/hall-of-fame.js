// Hall of Fame depth: a league records book and a per-season draft retrospective.
//
// The page already crowns champions and ranks managers all-time. What it lacked
// was the stuff people actually argue about — the biggest week anyone has ever
// put up, the team that carried a season, who stole whom in the third round.
//
// Everything here comes from data already on file: user.seasons carries
// weeklyScore[].scoreByTeam (so per-team season points are derivable without
// touching the Team collection), and the drafts collection is backfilled to
// 2023. Nothing needs a new job or a new write.
//
// Deliberately NOT here: all-time head-to-head. H2H only started in 2026, so
// those records would be an empty shell until that season wraps. The route adds
// an H2H section only once a season has actually produced the data.
//
// Pure and DB-free so it's unit-testable; routes/history.js loads the documents.

const round1 = (v) => Math.round(v * 10) / 10;

// Sum a manager's points per rostered team for one season, from the per-game
// entries the scoring engine already writes.
//
// scoreByTeam only started carrying teamId in 2024 — 2023 entries have the
// school name and nothing else. Keying purely on teamId silently drops that
// whole season (every 2023 team reads 0). So names are resolved against the
// season's roster, and kept as a fallback when they can't be: the same
// id-then-name matching modules/weekly-recap.js and public/userHome.js use.
//
// Returns [{ teamId, school, points }] — one row per distinct team, so callers
// can iterate without risking a double count across the two keying schemes.
function teamPointsFor(season) {
    const idBySchool = {};
    ((season && season.teams) || []).forEach(t => {
        if (t && t.school != null) idBySchool[t.school] = t.id;
    });

    const acc = {};
    ((season && season.weeklyScore) || []).forEach(w => {
        (w.scoreByTeam || []).forEach(st => {
            const id = st.teamId != null ? Number(st.teamId)
                : (st.team != null && idBySchool[st.team] != null ? Number(idBySchool[st.team]) : null);
            const key = id != null ? 'id:' + id : 'nm:' + (st.team || '?');
            const row = acc[key] || (acc[key] = { teamId: id, school: st.team || null, points: 0 });
            if (!row.school && st.team) row.school = st.team;
            row.points = round1(row.points + (st.score || 0));
        });
    });
    return Object.values(acc);
}

// A team's points from the rows above — by id, falling back to school name for
// the legacy entries that have no id.
function pointsForTeam(rows, team) {
    if (!rows || !team) return 0;
    if (team.id != null) {
        const hit = rows.find(r => r.teamId != null && Number(r.teamId) === Number(team.id));
        if (hit) return hit.points;
    }
    if (team.school) {
        const hit = rows.find(r => r.school === team.school);
        if (hit) return hit.points;
    }
    return 0;
}

// A record holder, shaped for rendering.
function holder(user, season) {
    return {
        userId: String(user._id),
        name: `${user.firstName || ''} ${user.lastName || ''}`.trim(),
        franchise: (season && season.franchiseName) || null,
        avatarUrl: user.avatarUrl || null,
        initials: (((user.firstName || '')[0] || '') + ((user.lastName || '')[0] || '')).toUpperCase(),
        color: user.color || null
    };
}

// The league records book. `isFinished(year)` gates out the in-progress season —
// a record set in a season still being played isn't a record yet, and the rest
// of the page already works that way.
//
// Returns an ordered list of { key, label, value, suffix, holder, detail, season }.
// Records with no data are omitted rather than rendered empty.
function buildRecords(users, isFinished) {
    let bestSeason = null, worstSeason = null, bestWeek = null, bestTeamGame = null, bestTeamSeason = null;

    (users || []).forEach(u => {
        (u.seasons || []).forEach(s => {
            if (!isFinished(s.season)) return;
            if (s.cumulativeScore == null) return;

            const total = s.cumulativeScore;
            if (!bestSeason || total > bestSeason.value) {
                bestSeason = { value: round1(total), season: s.season, holder: holder(u, s) };
            }
            // Only counts a season the manager actually played — a 0 from an
            // entry created but never scored isn't a "worst season".
            if ((s.weeklyScore || []).length && (!worstSeason || total < worstSeason.value)) {
                worstSeason = { value: round1(total), season: s.season, holder: holder(u, s) };
            }

            (s.weeklyScore || []).forEach(w => {
                const label = w.season === 'postseason' || w.week > 16 ? 'Postseason' : `Week ${w.week}`;
                if ((w.score || 0) > 0 && (!bestWeek || w.score > bestWeek.value)) {
                    bestWeek = { value: round1(w.score), season: s.season, detail: label, holder: holder(u, s) };
                }
                (w.scoreByTeam || []).forEach(st => {
                    if ((st.score || 0) > 0 && (!bestTeamGame || st.score > bestTeamGame.value)) {
                        bestTeamGame = {
                            value: round1(st.score), season: s.season,
                            detail: `${st.team || 'A team'} · ${label}`, holder: holder(u, s)
                        };
                    }
                });
            });

            // The single team that carried a season hardest.
            teamPointsFor(s).forEach(row => {
                if (row.points > 0 && (!bestTeamSeason || row.points > bestTeamSeason.value)) {
                    bestTeamSeason = {
                        value: row.points, season: s.season,
                        detail: row.school || `Team ${row.teamId}`, holder: holder(u, s)
                    };
                }
            });
        });
    });

    const rows = [
        bestSeason && { key: 'bestSeason', label: 'Highest season', ...bestSeason, suffix: 'pts' },
        bestWeek && { key: 'bestWeek', label: 'Biggest week', ...bestWeek, suffix: 'pts' },
        bestTeamSeason && { key: 'bestTeamSeason', label: 'Best team, full season', ...bestTeamSeason, suffix: 'pts' },
        bestTeamGame && { key: 'bestTeamGame', label: 'Best single game', ...bestTeamGame, suffix: 'pts' },
        worstSeason && { key: 'worstSeason', label: 'Leanest season', ...worstSeason, suffix: 'pts' }
    ].filter(Boolean);

    return rows;
}

// Per-season draft retrospective.
//
// The steal/bust measure is draft slot vs. where that pick actually finished in
// points among every pick that season. Taken 45th and finished 3rd is +42 — the
// thing worth bragging about. Both are computed from the manager's OWN scoring
// of that team, so a team that two leagues drafted is judged on what it did for
// this one.
//
// `draftsBySeason` is { [season]: pickList }, `usersById` is { [id]: user }.
function buildDraftHistory(draftsBySeason, usersById, isFinished) {
    const seasons = Object.keys(draftsBySeason || {})
        .map(Number)
        .filter(yr => isFinished(yr))
        .sort((a, b) => b - a);

    // Cache per (user, season) so a 60-pick draft doesn't re-sum the same rosters.
    const cache = {};
    const pointsFor = (userId, season) => {
        const key = userId + '|' + season;
        if (!cache[key]) {
            const u = usersById[userId];
            const s = u && (u.seasons || []).find(x => Number(x.season) === Number(season));
            cache[key] = s ? teamPointsFor(s) : [];
        }
        return cache[key];
    };

    return seasons.map(season => {
        const picks = (draftsBySeason[season] || [])
            .filter(p => p && p.team && p.team.id != null && p.overall != null)
            .map(p => {
                const uid = String(p.userId);
                const u = usersById[uid];
                const s = u && (u.seasons || []).find(x => Number(x.season) === Number(season));
                return {
                    overall: p.overall,
                    round: p.round,
                    userId: uid,
                    manager: u ? `${u.firstName || ''} ${u.lastName || ''}`.trim() : 'Unknown',
                    team: p.team.school || 'Unknown',
                    teamId: p.team.id,
                    logos: p.team.logos || [],
                    points: pointsForTeam(pointsFor(uid, season), p.team),
                    franchise: (s && s.franchiseName) || null
                };
            })
            .sort((a, b) => a.overall - b.overall);

        if (!picks.length) return { season, picks: 0 };

        // Where each pick actually finished, in points.
        const byPoints = picks.slice().sort((a, b) => b.points - a.points);
        const finishRank = {};
        byPoints.forEach((p, i) => { finishRank[p.overall] = i + 1; });

        // Only meaningful once somebody scored — an unscored season has every
        // pick tied at 0 and would crown an arbitrary "steal".
        const scored = picks.some(p => p.points > 0);
        let steal = null, bust = null;
        if (scored) {
            const withDelta = picks.map(p => ({ ...p, finish: finishRank[p.overall], delta: p.overall - finishRank[p.overall] }));
            steal = withDelta.reduce((best, p) => (!best || p.delta > best.delta ? p : best), null);
            bust = withDelta.reduce((worst, p) => (!worst || p.delta < worst.delta ? p : worst), null);
            // A "steal" that gained nothing, or a "bust" that lost nothing, is
            // just a pick that went where it should have. Don't dress it up.
            if (steal && steal.delta <= 0) steal = null;
            if (bust && bust.delta >= 0) bust = null;
        }

        return {
            season,
            picks: picks.length,
            rounds: Math.max(...picks.map(p => p.round || 1)),
            firstOverall: picks[0],
            topScorer: scored ? byPoints[0] : null,
            steal,
            bust
        };
    });
}

module.exports = { buildRecords, buildDraftHistory, teamPointsFor, pointsForTeam };
