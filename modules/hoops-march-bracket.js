// The March Madness bracket page's data: the NCAA tournament for one season,
// laid out by region and round, marked up with one league's owners and the
// points those owners BANKED.
//
// ---- where the points come from ----
//
// The number beside a team is the sum of its banked rows — the scoreByTeam
// entries the scoring pass (modules/hoops-scoring-pass.js) wrote on its
// owner's weeklyScore, matched by game id. Never recomputed here: a page that
// re-ran the rules could disagree with the standings the moment a config
// changed after a game was banked.
//
// The per-round lines in a team's sheet are scoring's own explainGame — the
// same walk evaluate() runs, with its total locked to evaluate's by a parity
// test. NCAA games always match a postseason rule, so the walk never reaches
// the quadrant rules and needs no ranks. If a line's total ever differs from
// what was banked (a config edited after the game), the banked figure is the
// one shown and the sheet says so.
//
// ---- the layout ----
//
// Rounds come from hoops-detectors ncaaRoundFor (the scoring detector);
// regions from gameNotes ("NCAA Men's Basketball Championship - Midwest
// Region - 1st Round"); a game's slot in its region from its seeds, which
// CBBD carries on every NCAA game. A slot with no row yet is filled from the
// games that feed it, so tomorrow's matchups show as soon as today's finish.
//
// Pure: the route feeds it query results.

const { ncaaRoundFor, seedOf, OPENING_ROUND_SEASON } = require('./hoops-detectors');
const { gameState } = require('./hoops-league-scoreboard');
const { explainGame } = require('./scoring');
const { valueOf, POINTS_KEY } = require('./hoops-march');
const { dropStale } = require('./hoops-stale-duplicates');

const REGION_ROUNDS = ['r64', 'r32', 's16', 'e8'];
const SHIFT = { r64: 0, r32: 1, s16: 2, e8: 3 };
// Round-of-64 pairings, top of the region to the bottom.
const PAIRS = [[1, 16], [8, 9], [5, 12], [4, 13], [6, 11], [3, 14], [7, 10], [2, 15]];
// The order the tabs fall back to before the Final Four pairing is on file.
const CANONICAL_REGIONS = ['South', 'West', 'Midwest', 'East'];

const isNcaa = (g) => String((g && g.tournament) || '').trim().toUpperCase() === 'NCAA';

function regionOf(game) {
    const m = String((game && game.gameNotes) || '').match(/ - ([^-]+?) Region\b/i);
    return m ? m[1].trim() : null;
}

// The Round-of-64 slot (0..7) a seed plays in.
function pairIndex(seed) {
    return PAIRS.findIndex(p => p.includes(seed));
}

// An Opening Round game between automatic qualifiers or at-large teams. The
// NCAA's play-in is the lowest auto-bids (the 15 and 16 lines) and the last
// at-large teams (the 11 and 12 lines) and never mixes them, so the line says
// which; 13 and below is an auto-bid line in any field.
function openingKind(seed) {
    return seed != null && seed >= 13 ? 'aq' : 'al';
}

// A team id, or null. Not Number(x): Number(null) is 0, and a later-round
// row with one side still unknown would put a phantom team 0 in the field.
function teamIdOf(v) {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(v);
    return Number.isInteger(n) && n > 0 ? n : null;
}

function finalScore(v) {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
}

function periodLabel(period) {
    const p = Number(period);
    if (!Number.isFinite(p) || p < 1) return null;
    if (p === 1) return '1st';
    if (p === 2) return '2nd';
    return p === 3 ? 'OT' : `${p - 2}OT`;
}

// Selection Sunday and the Final Four, by the rule every recent tournament
// has kept: the Final Four is the first Saturday of April and the bracket is
// named 20 days before it (2022 Mar 13 / Apr 2 through 2027 Mar 14 / Apr 3).
function keyDates(season) {
    const yr = Number(season);
    const apr1 = new Date(Date.UTC(yr, 3, 1));
    const ff = new Date(apr1.getTime() + ((6 - apr1.getUTCDay() + 7) % 7) * 86400000);
    const day = (base, n) => new Date(base.getTime() + n * 86400000).toISOString().slice(0, 10);
    const selection = day(ff, -20);
    return {
        selection, openingStart: day(ff, -18), openingEnd: day(ff, -17),
        r64Start: day(ff, -16), r64End: day(ff, -15), finalFour: day(ff, 0), title: day(ff, 2)
    };
}

// What March pays in this league: every NCAA rung and the upset bonus,
// through the league's resolved config (0 for a rule it has switched off).
function payTable(cfg, season) {
    const opening = Number(season) >= OPENING_ROUND_SEASON ? 'Opening Round' : 'First Four';
    const label = {
        ff: `Play in the ${opening}`, r64: 'Reach the Round of 64', r32: 'Reach the Round of 32',
        s16: 'Reach the Sweet 16', e8: 'Reach the Elite Eight', f4: 'Reach the Final Four',
        title: 'Reach the title game', champ: 'Win the title'
    };
    return {
        rungs: Object.keys(POINTS_KEY).map(k => ({ key: k, label: label[k], points: valueOf(cfg, POINTS_KEY[k]) })),
        upsetPerSeed: valueOf(cfg, 'seedUpsetBonus')
    };
}

// One NCAA row as the page draws it.
function shapeGame(g, round, nowMs) {
    const state = gameState(g, nowMs);
    const side = (which) => ({
        id: teamIdOf(which === 'home' ? g.homeTeamId : g.awayTeamId),
        seed: seedOf(which === 'home' ? g.homeSeed : g.awaySeed),
        score: state === 'pre' ? null : finalScore(which === 'home' ? g.homePoints : g.awayPoints)
    });
    const a = side('away'), b = side('home');
    let winner = null;
    if (state === 'final' && a.id !== null && b.id !== null && a.score !== null && b.score !== null) winner = a.score > b.score ? a.id : b.id;
    return {
        id: g.id, round, region: regionOf(g), state,
        startDate: g.startDate || null, startTimeTbd: !!g.startTimeTbd,
        clock: state === 'live' ? [periodLabel(g.period), g.clock].filter(Boolean).join(' ') || null : null,
        // A side with no team on file yet is TBD, not a team.
        a: a.id === null ? null : a, b: b.id === null ? null : b, winner
    };
}

// A slot with no game on file: who will be in it, from the games feeding it.
// A feeder that is final sends its winner; one that is not sends both names
// as a "Team A / Team B" placeholder; nothing known is null (TBD).
function fromFeeder(feeder) {
    if (!feeder) return null;
    if (feeder.winner != null) {
        const w = feeder.a.id === feeder.winner ? feeder.a : feeder.b;
        return { id: w.id, seed: w.seed, score: null };
    }
    const ids = [feeder.a, feeder.b].filter(s => s && s.id != null).map(s => s.id);
    // One seed only when both share it (an Opening Round pair): a pending
    // 1-v-2 must not show either number beside both names.
    if (ids.length === 2) return { tbd: ids, seed: feeder.a.seed === feeder.b.seed ? feeder.a.seed : null };
    return null;
}
// Either side's seed: what places a game in its region's column.
function seedLineOf(game) {
    const s = [game.a, game.b].find(x => x && x.seed != null);
    return s ? s.seed : null;
}
function placeholder(round, region, a, b) {
    return { id: null, round, region, state: 'pre', startDate: null, startTimeTbd: false, clock: null, a, b, winner: null };
}

// Owners: { teamId: { userId, name, franchise, initials, color, avatarUrl } }.
// banked: { 'teamId:gameId': points } from the owners' weeklyScore rows;
// elsewhere: the same keys banked to a franchise that no longer has the team.
function bankedPoints(franchises, season, owners) {
    const out = {}, elsewhere = new Set();
    (franchises || []).forEach(u => {
        const s = (u.seasons || []).find(x => Number(x.season) === Number(season));
        if (!s) return;
        (s.weeklyScore || []).forEach(w => (w.scoreByTeam || []).forEach(r => {
            if (r.teamId == null || r.gameId == null) return;
            // Only the team's CURRENT owner's rows: a team traded off a
            // roster keeps its old rows on the old franchise, and the page
            // shows the league as it stands.
            const owner = owners[Number(r.teamId)];
            const key = `${Number(r.teamId)}:${Number(r.gameId)}`;
            if (!owner || owner.userId !== String(u._id)) { elsewhere.add(key); return; }
            out[key] = (out[key] || 0) + (Number(r.score) || 0);
        }));
    });
    return { banked: out, elsewhere };
}

// The sheet's lines for one team's game: scoring's own explanation, with the
// upset line spelled out in seeds.
function linesFor(teamId, raw, game, cfg) {
    const ex = explainGame('hoops', teamId, raw, {}, cfg);
    const mine = game.a.id === teamId ? game.a : game.b;
    const theirs = game.a.id === teamId ? game.b : game.a;
    return {
        total: ex.total,
        lines: ex.matched.map(m => ({
            key: m.key,
            label: m.key === 'seedUpsetBonus' ? `Upset bonus: a ${mine.seed} seed beat a ${theirs.seed}` : m.label,
            points: m.points
        }))
    };
}

// The whole page payload. `games` are the season's NCAA HoopsGame rows (lean);
// `teams` is { id: { school, logo, abbr } }; `franchises` the league's
// (empty without a basketball league); `viewerId` the viewer's account id.
function buildBracket({ season, games, teams = {}, franchises = [], owners = {}, cfg, viewerId = null, nowMs = Date.now() }) {
    // A rescheduled game's stale listing never tips (#498): dropped, or it
    // could take its slot ahead of the real final.
    const rows = dropStale((games || []).filter(isNcaa), nowMs);
    const me = viewerId != null ? String(viewerId) : null;
    const pay = payTable(cfg, season);
    const base = { season: Number(season), dates: keyDates(season), pay, openingLabel: Number(season) >= OPENING_ROUND_SEASON ? 'Opening Round' : 'First Four' };
    if (!rows.length) return Object.assign(base, { state: 'pre' });

    const { banked, elsewhere } = bankedPoints(franchises, season, owners);
    const shaped = rows.map(g => ({ raw: g, game: shapeGame(g, ncaaRoundFor(g), nowMs) }))
        .filter(x => x.game.round)
        .sort((x, y) => (Date.parse(x.game.startDate) || 0) - (Date.parse(y.game.startDate) || 0) || x.game.id - y.game.id);

    // Every team in the field, and where it plays.
    const teamOut = {};
    const teamRow = (id, seed, region) => {
        if (id == null || !Number.isFinite(id)) return;
        if (!teamOut[id]) {
            const meta = teams[id] || {};
            const owner = owners[id] || null;
            teamOut[id] = {
                id, name: meta.school || null, abbr: meta.abbr || null, logo: meta.logo || null,
                seed: seed != null ? seed : null, region: region || null,
                owner: owner ? Object.assign({}, owner, { isMe: me !== null && owner.userId === me }) : null,
                points: owner ? 0 : null, games: [], alive: true
            };
        }
        const t = teamOut[id];
        if (t.seed == null && seed != null) t.seed = seed;
        if (!t.region && region) t.region = region;
    };
    shaped.forEach(({ raw, game }) => {
        // A name the HoopsTeam rows lack still has the game's own.
        [['away', game.a], ['home', game.b]].forEach(([which, s]) => {
            if (!s) return;
            teamRow(s.id, s.seed, game.region);
            if (teamOut[s.id] && !teamOut[s.id].name) teamOut[s.id].name = which === 'home' ? raw.homeTeam : raw.awayTeam;
        });
        if (game.state !== 'final' || !game.a || !game.b) return;
        [game.a, game.b].forEach(s => {
            const t = teamOut[s.id];
            if (!t) return;
            const won = game.winner === s.id;
            if (!won) t.alive = false;
            const ex = linesFor(s.id, raw, game, cfg);
            const key = `${s.id}:${game.id}`;
            const got = t.owner ? (banked[key] != null ? banked[key] : null) : null;
            if (got != null) t.points += got;
            const opp = game.a.id === s.id ? game.b : game.a;
            t.games.push({
                gameId: game.id, round: game.round, won, oppId: opp.id,
                score: [s.score, opp.score], lines: ex.lines, rulesTotal: ex.total, banked: got,
                // Banked, but to a franchise that has since dropped the team.
                bankedElsewhere: got == null && elsewhere.has(key)
            });
        });
    });

    // Opening Round: the play-in games, auto-bids first.
    const opening = shaped.filter(x => x.game.round === 'ff').map(x => Object.assign(x.game, {
        kind: openingKind(seedLineOf(x.game)),
        seedLine: seedLineOf(x.game)
    }));

    // Regions: one column per round, fixed slots, filled by seed.
    const regionNames = [];
    shaped.forEach(x => { if (x.game.region && !regionNames.includes(x.game.region)) regionNames.push(x.game.region); });
    const regions = {};
    regionNames.forEach(r => { regions[r] = { r64: Array(8).fill(null), r32: Array(4).fill(null), s16: Array(2).fill(null), e8: [null] }; });
    shaped.forEach(({ game }) => {
        if (!REGION_ROUNDS.includes(game.round) || !regions[game.region]) return;
        const idx = pairIndex(seedLineOf(game));
        if (idx < 0) return;
        const col = regions[game.region][game.round];
        const pos = idx >> SHIFT[game.round];
        // First come by date, except that a played or live game beats an
        // unplayed one: a stale listing inside dropStale's grace week must not
        // hide the real result.
        if (!col[pos] || (col[pos].state === 'pre' && game.state !== 'pre')) col[pos] = game;
    });
    // The empty slots, from their feeders. Round of 64 slots hold a seeded
    // team on one side and, until it is played, an Opening Round pair on
    // the other.
    regionNames.forEach(r => {
        const reg = regions[r];
        reg.r64 = reg.r64.map((g, i) => {
            if (g) return g;
            const side = (seed) => {
                const or = opening.find(o => o.region === r && o.seedLine === seed);
                return or ? fromFeeder(or) : null;
            };
            return placeholder('r64', r, side(PAIRS[i][0]), side(PAIRS[i][1]));
        });
        ['r32', 's16', 'e8'].forEach((rd, j) => {
            const prev = reg[REGION_ROUNDS[j]];
            reg[rd] = reg[rd].map((g, i) => g || placeholder(rd, r, fromFeeder(prev[2 * i]), fromFeeder(prev[2 * i + 1])));
        });
    });

    // Final Four: in the order the rows give, which also says which regions
    // meet; before then, the canonical pairing.
    const f4Rows = shaped.filter(x => x.game.round === 'f4').map(x => x.game);
    const champOf = (reg) => regions[reg] && fromFeeder(regions[reg].e8[0]);
    const regionOfTeam = (s) => (s && s.id != null && teamOut[s.id] ? teamOut[s.id].region : null);
    f4Rows.forEach(g => { g.label = [regionOfTeam(g.a), regionOfTeam(g.b)].filter(Boolean).join(' v ') || null; });
    const ordered = [];
    f4Rows.forEach(g => [regionOfTeam(g.a), regionOfTeam(g.b)].forEach(r => { if (r && !ordered.includes(r)) ordered.push(r); }));
    CANONICAL_REGIONS.concat(regionNames).forEach(r => { if (regionNames.includes(r) && !ordered.includes(r)) ordered.push(r); });
    const finalFour = f4Rows.slice(0, 2);
    for (let i = finalFour.length; i < 2; i++) {
        const [r1, r2] = [ordered[2 * i], ordered[2 * i + 1]];
        const g = placeholder('f4', null, champOf(r1), champOf(r2));
        g.label = [r1, r2].filter(Boolean).join(' v ') || null;
        finalFour.push(g);
    }
    const titleRow = shaped.find(x => x.game.round === 'title');
    const title = titleRow ? titleRow.game : placeholder('title', null, fromFeeder(finalFour[0]), fromFeeder(finalFour[1]));
    const champion = title.winner != null ? title.winner : null;

    // The viewer's March at a glance.
    const mine = Object.values(teamOut).filter(t => t.owner && t.owner.isMe);
    const summary = {
        field: mine.length,
        alive: mine.filter(t => t.alive).length,
        points: mine.reduce((s, t) => s + (t.points || 0), 0)
    };

    return Object.assign(base, {
        state: 'bracket',
        regionOrder: ordered,
        opening, regions, finalFour, title, champion,
        teams: teamOut, summary
    });
}

module.exports = { buildBracket, keyDates, payTable, regionOf, pairIndex, openingKind, PAIRS, CANONICAL_REGIONS };
