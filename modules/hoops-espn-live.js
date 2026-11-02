// A basketball game's box score and shot chart from ESPN, for the window CBBD
// cannot fill: while the game is on, and after the final until CBBD's own
// post-game data is stored (modules/hoops-box-score.js, hoops-shots.js). The
// game page prefers what is stored the moment it exists; this is only ever a
// stand-in, and nothing in scoring reads it.
//
// Both shapes are the ones the page already draws from CBBD, marked
// `source: 'espn'`. The event id is HoopsGame.sourceId (CBBD copies ESPN's
// schedule, so a game's sourceId IS ESPN's event id).
//
// ---- measured against CBBD ----
//
// Notre Dame @ Villanova (CBBD 377909 / ESPN 401920982) and Murray State @
// Tennessee State (372663 / 401911707), 1-2 Nov 2026, matched shot for shot
// on period + clock + result: 234 of 234 attempts found.
//   - ESPN's shots are already on ONE half court, in whole feet: x across the
//     floor (0-50), y out from the RIM, not the baseline. Mapped as
//     x -> 50 - x, y -> y + 5.25 (the chart's basket), they sat a mean
//     0.25-0.62 ft from CBBD's. Unmirrored x missed by 16-17 ft.
//   - Ranges: a three is pointsAttempted 3; LayUpShot, DunkShot and TipShot
//     are at the rim; any other two is a jumper. Agreed with CBBD's
//     `range` on 233 of 234.
//   - Free throws carry a placeholder (25, 0), so they are dropped, as the
//     CBBD chart drops them.
//   - Player lines and team totals matched CBBD's on both games, bar a
//     minute either way on a few players (rounding).
//
// ---- traps ----
//
// - Mid-game the player box and the score update apart: on 2 Nov NKU's
//   players summed to 59 while the header said 60, then 63 against 62. A
//   side's `points` is the header's score, never the players' sum, and
//   `byPeriod` is left empty so the line score keeps the live poller's.
// - ESPN athlete ids are not CBBD's. They go out as `espnId`, never
//   `athleteId`, which roster.withJerseys would look up in CBBD's roster; the
//   jersey comes straight from ESPN.
// - No CBBD advanced lines (ratings, usage, four factors) exist here. eFG%
//   and TS% are worked out from the counts; the rest stay absent.

// The chart's basket, in feet from the baseline (public/hoopsGame.js).
const RIM_Y = 5.25;
const RIM_TYPES = /^(LayUpShot|DunkShot|TipShot)$/;

const int = (v) => {
    if (v === null || v === undefined || v === '') return undefined;
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
};
// "21-53" -> [21, 53]
const pair = (v) => {
    const m = /^(\d+)-(\d+)$/.exec(String(v == null ? '' : v).trim());
    return m ? [Number(m[1]), Number(m[2])] : [undefined, undefined];
};
const round1 = (n) => Math.round(n * 10) / 10;
const efg = (fgm, threes, fga) => (fga ? round1(((fgm + 0.5 * threes) / fga) * 100) : undefined);
const ts = (pts, fga, fta) => (fga || fta ? round1((pts / (2 * (fga + 0.44 * fta))) * 100) : undefined);

function competitors(body) {
    const c = body && body.header && Array.isArray(body.header.competitions) ? body.header.competitions[0] : null;
    return c && Array.isArray(c.competitors) ? c.competitors : [];
}

// ESPN team id of each side, from the header ESPN keys everything else on.
function sides(body) {
    const comps = competitors(body);
    const of = (ha) => comps.find(c => c && c.homeAway === ha);
    const home = of('home'), away = of('away');
    if (!home || !away || !home.team || !away.team) return null;
    return {
        home: { espnTeam: String(home.team.id), score: int(home.score) },
        away: { espnTeam: String(away.team.id), score: int(away.score) }
    };
}

function teamLine(stats) {
    const by = new Map((Array.isArray(stats) ? stats : []).map(s => [s && s.name, s && s.displayValue]));
    const [fgMade, fgAtt] = pair(by.get('fieldGoalsMade-fieldGoalsAttempted'));
    const [threeMade, threeAtt] = pair(by.get('threePointFieldGoalsMade-threePointFieldGoalsAttempted'));
    const [ftMade, ftAtt] = pair(by.get('freeThrowsMade-freeThrowsAttempted'));
    return {
        fgMade, fgAtt, threeMade, threeAtt, ftMade, ftAtt,
        twoMade: fgMade != null && threeMade != null ? fgMade - threeMade : undefined,
        twoAtt: fgAtt != null && threeAtt != null ? fgAtt - threeAtt : undefined,
        efgPct: fgMade != null && threeMade != null ? efg(fgMade, threeMade, fgAtt) : undefined,
        rebounds: int(by.get('totalRebounds')),
        offRebounds: int(by.get('offensiveRebounds')), defRebounds: int(by.get('defensiveRebounds')),
        assists: int(by.get('assists')), steals: int(by.get('steals')), blocks: int(by.get('blocks')),
        turnovers: int(by.get('totalTurnovers')), fouls: int(by.get('fouls')),
        technicals: int(by.get('totalTechnicalFouls')),
        paintPoints: int(by.get('pointsInPaint')), fastBreakPoints: int(by.get('fastBreakPoints')),
        pointsOffTurnovers: int(by.get('turnoverPoints')), largestLead: int(by.get('largestLead'))
    };
}

// One side's player lines. ESPN lists the whole roster; a player with no
// stats did not play, and is left out as CBBD leaves them out.
function playerLines(group) {
    const g = group && Array.isArray(group.statistics) ? group.statistics[0] : null;
    if (!g || !Array.isArray(g.athletes) || !Array.isArray(g.keys)) return [];
    const at = (stats, key) => stats[g.keys.indexOf(key)];
    return g.athletes.filter(a => a && a.athlete && a.athlete.displayName && Array.isArray(a.stats) && a.stats.length)
        .map(a => {
            const s = a.stats;
            const [fgMade, fgAtt] = pair(at(s, 'fieldGoalsMade-fieldGoalsAttempted'));
            const [threeMade, threeAtt] = pair(at(s, 'threePointFieldGoalsMade-threePointFieldGoalsAttempted'));
            const [ftMade, ftAtt] = pair(at(s, 'freeThrowsMade-freeThrowsAttempted'));
            const points = int(at(s, 'points'));
            const pos = a.athlete.position;
            return {
                espnId: a.athlete.id != null ? String(a.athlete.id) : undefined,
                name: a.athlete.displayName,
                jersey: a.athlete.jersey != null && a.athlete.jersey !== '' ? String(a.athlete.jersey) : undefined,
                position: (pos && pos.abbreviation) || undefined,
                starter: !!a.starter, ejected: a.ejected ? true : undefined,
                minutes: int(at(s, 'minutes')), points,
                rebounds: int(at(s, 'rebounds')),
                offRebounds: int(at(s, 'offensiveRebounds')), defRebounds: int(at(s, 'defensiveRebounds')),
                assists: int(at(s, 'assists')), steals: int(at(s, 'steals')), blocks: int(at(s, 'blocks')),
                turnovers: int(at(s, 'turnovers')), fouls: int(at(s, 'fouls')),
                fgMade, fgAtt, threeMade, threeAtt, ftMade, ftAtt,
                twoMade: fgMade != null && threeMade != null ? fgMade - threeMade : undefined,
                twoAtt: fgAtt != null && threeAtt != null ? fgAtt - threeAtt : undefined,
                efgPct: fgMade != null && threeMade != null ? efg(fgMade, threeMade, fgAtt) : undefined,
                tsPct: points != null && fgAtt != null && ftAtt != null ? ts(points, fgAtt, ftAtt) : undefined
            };
        });
}

// The box score, in HoopsBoxScore's shape, or null when ESPN has no player
// lines yet (before tip-off, or a game it does not cover). Pure.
function boxFrom(body, game) {
    const s = sides(body);
    const bs = body && body.boxscore;
    if (!s || !bs || !Array.isArray(bs.teams) || !Array.isArray(bs.players)) return null;
    const side = (k, teamId) => {
        const espnTeam = s[k].espnTeam;
        const t = bs.teams.find(x => x && x.team && String(x.team.id) === espnTeam);
        const p = bs.players.find(x => x && x.team && String(x.team.id) === espnTeam);
        return Object.assign({ teamId, byPeriod: [], points: s[k].score }, teamLine(t && t.statistics), { players: playerLines(p) });
    };
    const home = side('home', Number(game.homeTeamId)), away = side('away', Number(game.awayTeamId));
    if (!home.players.length && !away.players.length) return null;
    return { gameId: Number(game.id), season: Number(game.season), source: 'espn', home, away };
}

function rangeOf(p) {
    if (Number(p.pointsAttempted) === 3) return 'three_pointer';
    return RIM_TYPES.test(String(p.type && p.type.text)) ? 'rim' : 'jumper';
}

// The shot chart, in hoops-shots.forGame's shape, or null when no attempt is
// located yet. Pure.
function shotsFrom(body, game) {
    const s = sides(body);
    if (!s || !body || !Array.isArray(body.plays)) return null;
    // The shooter's name: plays carry only an athlete id.
    const names = new Map();
    const bs = body.boxscore;
    ((bs && bs.players) || []).forEach(t => ((t.statistics && t.statistics[0] && t.statistics[0].athletes) || [])
        .forEach(a => { if (a && a.athlete && a.athlete.id != null) names.set(String(a.athlete.id), a.athlete.displayName); }));

    const out = { home: [], away: [] };
    const attempts = { home: 0, away: 0 };
    for (const p of body.plays) {
        if (!p || !p.shootingPlay || Number(p.pointsAttempted) === 1 || /FreeThrow/i.test(String(p.type && p.type.text))) continue;
        const team = p.team && String(p.team.id);
        const k = team === s.home.espnTeam ? 'home' : team === s.away.espnTeam ? 'away' : null;
        if (!k) continue;
        attempts[k]++;
        const c = p.coordinate || {};
        const x = Number(c.x), y = Number(c.y);
        // Off the floor is ESPN's "no location": not drawn, still counted.
        // A small negative y is real: a corner shot level with or behind
        // the rim (4 of 234 measured, down to -2).
        if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 50 || y < -RIM_Y) continue;
        const parts = Array.isArray(p.participants) ? p.participants : [];
        const shooterId = parts[0] && parts[0].athlete && parts[0].athlete.id != null ? String(parts[0].athlete.id) : null;
        const made = !!p.scoringPlay;
        out[k].push({
            espnId: shooterId || undefined,
            shooter: (shooterId && names.get(shooterId)) || undefined,
            made,
            range: rangeOf(p),
            // A second participant on a made shot is the passer.
            assisted: made && parts.length > 1,
            period: int(p.period && p.period.number),
            clock: (p.clock && p.clock.displayValue) || undefined,
            x: round1(50 - x),
            // A heave from past half court is pinned to the half line, as
            // the CBBD chart pins it.
            y: round1(Math.min(Math.max(y + RIM_Y, 0), 47))
        });
    }
    if (!out.home.length && !out.away.length) return null;
    return { home: out.home, away: out.away, attempts, complete: false, source: 'espn' };
}

// Both at once, for espn-summary's one-shape-per-sport cache.
function shape(game) {
    return (body) => ({ box: boxFrom(body, game), shots: shotsFrom(body, game) });
}

module.exports = { boxFrom, shotsFrom, shape, rangeOf };
