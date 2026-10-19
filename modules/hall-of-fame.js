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
    const schoolById = schoolsById(season);

    const acc = {};
    ((season && season.weeklyScore) || []).forEach(w => {
        (w.scoreByTeam || []).forEach(st => {
            const id = st.teamId != null ? Number(st.teamId)
                : (st.team != null && idBySchool[st.team] != null ? Number(idBySchool[st.team]) : null);
            const key = id != null ? 'id:' + id : 'nm:' + (st.team || '?');
            const row = acc[key] || (acc[key] = { teamId: id, school: st.team || null, points: 0 });
            if (!row.school && st.team) row.school = st.team;
            // Basketball rows carry only a teamId, so the name comes from the
            // roster (hydrated from teamRefs by the route).
            if (!row.school && id != null && schoolById[id]) row.school = schoolById[id];
            row.points = round1(row.points + (st.score || 0));
        });
    });
    return Object.values(acc);
}

// { teamId: school } off a season's roster.
function schoolsById(season) {
    const out = {};
    ((season && season.teams) || []).forEach(t => {
        if (t && t.id != null && t.school != null) out[Number(t.id)] = t.school;
    });
    return out;
}

// A scoreByTeam row's school: its own name (football), else the roster's
// (basketball rows are id-only).
function teamName(season, st) {
    if (st && st.team) return st.team;
    if (st && st.teamId != null) return schoolsById(season)[Number(st.teamId)] || null;
    return null;
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
// A weeklyScore entry that belongs to the postseason bucket rather than a real
// week. `season` is overloaded as a type tag; some rows only have week > 16.
function isPostseason(w) {
    return !!w && (w.season === 'postseason' || w.week > 16);
}

// Where the postseason lives differs by sport, and the records book needs it
// kept apart either way — it scores on a much bigger scale in both.
//
//   football    one weeklyScore entry holds every bowl and CFP game (the
//               bucket above), so a whole WEEK is postseason or not.
//   basketball  weeks are real calendar weeks all the way to April (~22 of
//               them, so `week > 16` would misfile March). Postseason games —
//               conference tournaments, the NCAA, the NIT — sit inside those
//               weeks, flagged per ROW with `noModes` by the scoring pass
//               (modules/hoops-scoring-pass.js). A week can hold both kinds.
function postseasonRules(sport) {
    if (sport === 'basketball') {
        return { weekIsPost: () => false, rowIsPost: (st) => !!(st && st.noModes) };
    }
    return { weekIsPost: isPostseason, rowIsPost: () => false };
}

const weekLabel = (w, rules) => ((rules || postseasonRules()).weekIsPost(w) ? 'Postseason' : `Week ${w.week}`);

// What a record expands to show. A bare "76 pts · 16 games" says nothing; the
// teams behind it are the whole story (Brock's 2024 postseason reads as Ohio
// State's title run — 6, 6, 6, 10 — once you can see it).
//
// Built ONLY for the records that actually won, from the season already in hand,
// so it costs one pass over one manager rather than one per candidate.
//
// `rows` are { label, value, sub? }. `bestTeamGame` gets none: its one line
// already states the whole fact, and the opponent can't be recovered — 2023
// scoreByTeam entries carry no gameId (the same legacy gap as teamId).
function breakdownFor(key, ctx) {
    if (!ctx) return null;
    const s = ctx.season;
    const rules = ctx.rules || postseasonRules();

    // Which teams made up a season's points.
    if (key === 'bestSeason' || key === 'worstSeason') {
        const rows = teamPointsFor(s)
            .filter(r => r.school)
            .sort((a, b) => b.points - a.points)
            .map(r => ({ label: r.school, value: r.points }));
        return rows.length ? { kind: 'teams', rows } : null;
    }

    // Which teams scored in that one week. Zeroes are kept — "eight of nine won"
    // is as much the story as the total.
    if (key === 'bestWeek') {
        const acc = {};
        (ctx.entry.scoreByTeam || []).forEach(st => {
            const k = teamName(s, st) || 'Unknown';
            acc[k] = round1((acc[k] || 0) + (st.score || 0));
        });
        const rows = Object.keys(acc).map(k => ({ label: k, value: acc[k] }))
            .sort((a, b) => b.value - a.value);
        return rows.length ? { kind: 'teams', rows } : null;
    }

    // Every bowl/CFP game, grouped by team — a run shows up as a game count.
    if (key === 'bestPostseason') {
        const acc = {};
        (s.weeklyScore || []).forEach(w => {
            const wholeWeek = rules.weekIsPost(w);
            (w.scoreByTeam || []).forEach(st => {
                if (!wholeWeek && !rules.rowIsPost(st)) return;
                const k = teamName(s, st) || 'Unknown';
                const row = acc[k] || (acc[k] = { label: k, value: 0, games: 0 });
                row.value = round1(row.value + (st.score || 0));
                row.games++;
            });
        });
        const rows = Object.values(acc)
            .sort((a, b) => b.value - a.value || b.games - a.games)
            .map(r => ({ label: r.label, value: r.value, sub: `${r.games} game${r.games === 1 ? '' : 's'}` }));
        return rows.length ? { kind: 'teams', rows } : null;
    }

    // One team's season, week by week — only the weeks it actually played.
    if (key === 'bestTeamSeason') {
        const rows = [];
        (s.weeklyScore || []).forEach(w => {
            const pts = (w.scoreByTeam || [])
                .filter(st => (ctx.teamId != null && Number(st.teamId) === Number(ctx.teamId)) || st.team === ctx.school)
                .reduce((sum, st) => sum + (st.score || 0), 0);
            if ((w.scoreByTeam || []).some(st => (ctx.teamId != null && Number(st.teamId) === Number(ctx.teamId)) || st.team === ctx.school)) {
                rows.push({ label: weekLabel(w, rules), value: round1(pts) });
            }
        });
        return rows.length ? { kind: 'weeks', rows } : null;
    }

    return null;
}

// `opts.sport` picks the postseason rules above; football is the default.
function buildRecords(users, isFinished, opts) {
    const rules = postseasonRules(opts && opts.sport);
    let bestSeason = null, worstSeason = null, bestWeek = null, bestTeamGame = null,
        bestTeamSeason = null, bestPostseason = null;

    (users || []).forEach(u => {
        (u.seasons || []).forEach(s => {
            if (!isFinished(s.season)) return;
            if (s.cumulativeScore == null) return;

            const total = s.cumulativeScore;
            if (!bestSeason || total > bestSeason.value) {
                bestSeason = { value: round1(total), season: s.season, holder: holder(u, s), _ctx: { season: s, rules } };
            }
            // Only counts a season the manager actually played — a 0 from an
            // entry created but never scored isn't a "worst season".
            if ((s.weeklyScore || []).length && (!worstSeason || total < worstSeason.value)) {
                worstSeason = { value: round1(total), season: s.season, holder: holder(u, s), _ctx: { season: s, rules } };
            }

            // The week and single-game records are REGULAR SEASON only, on two
            // counts. Postseason games score on a different scale entirely
            // (Claunts: 4-10 a game vs a regular max of 4; Graham: 5-12 vs 1-3),
            // so a regular-season game can never win "best single game" — the
            // record would be a foregone conclusion. And the postseason isn't a
            // week at all: every bowl and CFP game collapses into ONE weeklyScore
            // entry, so it carries more games than a Saturday as well as more
            // points each. Comparing that to a real week is meaningless — it made
            // both records read "who had the best postseason", twice.
            //
            // The postseason gets its own record below instead, where every
            // manager is measured against the same thing.
            let postTotal = 0, postGames = 0;
            (s.weeklyScore || []).forEach(w => {
                if (rules.weekIsPost(w)) {
                    postTotal += (w.score || 0);
                    postGames += (w.scoreByTeam || []).length;
                    return;
                }
                // Basketball: postseason games inside an ordinary week. They
                // count toward the postseason record, and the week they sit in
                // is no longer a pure regular-season week, so it can't hold
                // "biggest week" — its total carries the bigger-scale games.
                const postRows = (w.scoreByTeam || []).filter(rules.rowIsPost);
                postRows.forEach(st => { postTotal += (st.score || 0); postGames++; });
                if (!postRows.length && (w.score || 0) > 0 && (!bestWeek || w.score > bestWeek.value)) {
                    bestWeek = { value: round1(w.score), season: s.season, detail: `Week ${w.week}`, holder: holder(u, s), _ctx: { season: s, entry: w, rules } };
                }
                (w.scoreByTeam || []).forEach(st => {
                    if (rules.rowIsPost(st)) return;
                    if ((st.score || 0) > 0 && (!bestTeamGame || st.score > bestTeamGame.value)) {
                        bestTeamGame = {
                            value: round1(st.score), season: s.season,
                            detail: `${teamName(s, st) || 'A team'} · Week ${w.week}`, holder: holder(u, s)
                        };
                    }
                });
            });
            if (postTotal > 0 && (!bestPostseason || postTotal > bestPostseason.value)) {
                bestPostseason = {
                    value: round1(postTotal), season: s.season,
                    detail: `${postGames} game${postGames === 1 ? '' : 's'}`, holder: holder(u, s),
                    _ctx: { season: s, rules }
                };
            }

            // The single team that carried a season hardest.
            teamPointsFor(s).forEach(row => {
                if (row.points > 0 && (!bestTeamSeason || row.points > bestTeamSeason.value)) {
                    bestTeamSeason = {
                        value: row.points, season: s.season,
                        detail: row.school || `Team ${row.teamId}`, holder: holder(u, s),
                        _ctx: { season: s, teamId: row.teamId, school: row.school, rules }
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
        bestPostseason && { key: 'bestPostseason', label: 'Best postseason', ...bestPostseason, suffix: 'pts' },
        worstSeason && { key: 'worstSeason', label: 'Worst season', ...worstSeason, suffix: 'pts' }
    ].filter(Boolean);

    // Attach the expansion only to the winners, then drop the internal context so
    // it never reaches the client.
    return rows.map(r => {
        const breakdown = breakdownFor(r.key, r._ctx);
        const out = Object.assign({}, r, breakdown ? { breakdown } : {});
        delete out._ctx;
        return out;
    });
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

// Which seasons are finished — crownable, record-eligible, draft-reviewable.
// Per SPORT, because the two run on different calendars: basketball 2027 is
// the 2026–27 season and is being played while football 2026 is.
//
//   football    any season before the active one, or one whose postseason
//               bucket has been scored (it wraps before the YEAR flip).
//   basketball  any season before the active one, or the active one once its
//               SportSeason status is 'complete'. Basketball writes no
//               postseason bucket, so football's second test can't apply.
//
// A basketball league before its sport has a season row (activeYear null)
// has nothing finished — the normal state until April 2027.
function seasonFinishedFor({ sport, activeYear, status, users }) {
    if (sport === 'basketball') {
        // Number(null) is 0, so a missing row compares below every real year.
        const active = Number(activeYear);
        return (yr) => Number(yr) < active || (Number(yr) === active && status === 'complete');
    }
    const postseasonScored = {};
    (users || []).forEach(u => (u.seasons || []).forEach(s => {
        if ((s.weeklyScore || []).some(w => w && w.season === 'postseason' && w.score != null)) {
            postseasonScored[s.season] = true;
        }
    }));
    return (yr) => Number(yr) < activeYear || !!postseasonScored[yr];
}

module.exports = { seasonFinishedFor, postseasonRules, teamName, buildRecords, buildDraftHistory, teamPointsFor, pointsForTeam, breakdownFor, isPostseason };
