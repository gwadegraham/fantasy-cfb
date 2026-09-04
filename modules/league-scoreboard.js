// Shaping helpers for the league scoreboard — the WHOLE FBS slate for a week,
// with the league's drafted teams marked up with their owner and the fantasy
// points that team has banked in that game.
//
// The slate itself is not league-specific: the ingest pulls every FBS game
// (`classification=fbs`, see routes/games.js), so a scoreboard is one indexed
// Game read plus an overlay. That overlay is the only part that differs per
// league, and it is what separates this page from any generic scores app —
// roughly a quarter of a week's games have somebody's name on them.
//
// Everything here is pure (no DB, no req/res) so the week/owner/points logic
// can be unit-tested without a Mongo harness. The route feeds it query results.

// The one exception to "pure": a shared constant, so the live/final cutoff
// here cannot drift from the one the live poller gates on.
const { MAX_GAME_MS } = require('./game-window');

// Fantasy points are re-scored on every live-poll tick with no `completed`
// gate (see modules/score-update.js doLiveUpdate), so a team's points for an
// in-progress game are already correct in weeklyScore — nothing here has to
// wait for a final, or recompute anything.

// { '<teamId>:<gameId>': points } for one league season+week. Keyed by BOTH ids
// because a team can appear in more than one week's entry and we only ever want
// the points earned in the game we're rendering.
function pointsByTeamGame(users, season, week) {
    const out = {};
    (users || []).forEach(u => {
        const s = (u.seasons || []).find(x => Number(x.season) === Number(season));
        if (!s) return;
        (s.weeklyScore || [])
            .filter(w => Number(w.week) === Number(week))
            .forEach(w => {
                (w.scoreByTeam || []).forEach(t => {
                    if (t.teamId == null || t.gameId == null) return;
                    out[`${t.teamId}:${t.gameId}`] = t.score || 0;
                });
            });
    });
    return out;
}

function initialsOf(first, last) {
    const a = (first || '').trim().charAt(0);
    const b = (last || '').trim().charAt(0);
    return (a + b).toUpperCase() || '?';
}

// { <teamId>: owner } for one league season. A team is drafted by at most one
// manager, so a flat map is enough — no per-league nesting.
function ownersByTeam(users, season) {
    const out = {};
    (users || []).forEach(u => {
        const s = (u.seasons || []).find(x => Number(x.season) === Number(season));
        if (!s) return;
        const owner = {
            userId: String(u._id),
            name: `${u.firstName || ''} ${u.lastName || ''}`.trim(),
            firstName: u.firstName || '',
            franchise: s.franchiseName || null,
            color: u.color || null,
            avatarUrl: u.avatarUrl || null,
            initials: initialsOf(u.firstName, u.lastName)
        };
        (s.teams || []).forEach(t => { if (t && t.id != null) out[t.id] = owner; });
    });
    return out;
}

// Windows of a week's slate: [{ week, first, last }] in epoch ms, sorted.
// Built from the games themselves rather than the CFBD calendar so this costs
// no API call and can't disagree with what we'd actually render.
function weekWindows(games) {
    const by = new Map();
    (games || []).forEach(g => {
        const t = Date.parse(g.startDate);
        if (Number.isNaN(t) || g.week == null) return;
        const cur = by.get(g.week);
        if (!cur) by.set(g.week, { week: g.week, first: t, last: t });
        else { if (t < cur.first) cur.first = t; if (t > cur.last) cur.last = t; }
    });
    return [...by.values()].sort((a, b) => a.week - b.week);
}

// The scoreboard's own tail, for picking a default week only — deliberately
// NOT the game-window ceiling. "Is this slate still the current one" and "is
// this game still being played" are different questions, and widening the
// second to cover weather delays should not also change which week the page
// opens on.
const WEEK_TAIL_MS = 6 * 3600 * 1000;

// Which week should the page open on? "The one you'd want on a Saturday":
//   1. a week currently in progress (first kickoff .. last kickoff + 6h)
//   2. otherwise the next week to come  — Tue-Thu sits between slates and
//      should look forward, not back at a settled week
//   3. otherwise the last week that happened (season over)
// The tail here is WEEK_TAIL_MS, not the game window — a slate stops being the
// current one on a schedule of its own, independent of how long one delayed
// game inside it is still being played.
function defaultWeek(windows, nowMs) {
    if (!windows || !windows.length) return null;
    const live = windows.find(w => nowMs >= w.first && nowMs <= w.last + WEEK_TAIL_MS);
    if (live) return live.week;
    const next = windows.find(w => w.first > nowMs);
    if (next) return next.week;
    return windows[windows.length - 1].week;
}

// A game's display state. `completed` is authoritative for finals; anything
// kicked off and not final reads as live. The game window keeps a stuck
// `completed` flag (CFBD occasionally never flips one) from showing a Tuesday
// game as live all week — it falls back to "final" once the window passes.
//
// Shared with the live poller on purpose: past this same ceiling the poller
// stops fetching, so a card that stayed "live" any longer would be showing a
// running clock over a score that had quietly stopped moving.
function gameState(game, nowMs) {
    if (game.completed) return 'final';
    const start = Date.parse(game.startDate);
    if (Number.isNaN(start) || start > nowMs) return 'pre';
    return (nowMs - start) <= MAX_GAME_MS ? 'live' : 'final';
}

// Short labels for the conference filter. CFBD gives us only full names — there
// is no abbreviation on Game or Team, and no conferences collection — and the
// long ones ("American Athletic", "FCS Independents") push the dropdown past
// the edge of a phone.
//
// A map rather than a CFBD /conferences fetch on purpose: the scoreboard route
// is a pure DB read that a browser hits every 30 seconds, and a network call
// behind it would buy a dropdown label at the cost of a new failure mode. Only
// names too long for the control are listed; everything shorter (ACC, SEC,
// Big 12, Pac-12, MEAC…) is already its own best label and falls through
// unchanged — including any conference a realignment invents.
const CONFERENCE_ABBR = Object.freeze({
    'American Athletic': 'AAC',
    'Coastal Athletic': 'CAA',
    'Conference USA': 'CUSA',
    'FBS Independents': 'FBS Ind',
    'FCS Independents': 'FCS Ind',
    'Mid-American': 'MAC',
    'Mountain West': 'MWC'
});

function conferenceLabel(name) {
    return CONFERENCE_ABBR[name] || name;
}

// The conferences that belong to the league's universe, from the Team docs on
// the slate. `!== 'fcs'` rather than `=== 'fbs'` for the same reason
// modules/team-scope.js does it: docs predating the classification field all
// came from CFBD's /teams/fbs endpoint, so an absent value means FBS.
// { <teamId>: 'W-L' } from the Record docs for the season. 0-0 is a real record
// and is reported as one — every team on a slate has a Record doc, so this never
// leaves one row badged and its opponent bare.
//
// This is the season record AS OF NOW, not as it stood in the week being viewed.
// That is only correct for a game that hasn't finished, which is why the card
// shows the record on upcoming and in-progress games and the final score on
// everything else (see sideHtml in public/scoreboard.js). A finished game's
// story is its score; the record that mattered going into it is history we don't
// store.
function recordsByTeam(recordDocs) {
    const out = {};
    (recordDocs || []).forEach(r => {
        if (!r || r.teamId == null || !r.total) return;
        const w = r.total.wins || 0;
        const l = r.total.losses || 0;
        const t = r.total.ties || 0;
        out[r.teamId] = t ? `${w}-${l}-${t}` : `${w}-${l}`;
    });
    return out;
}

function fbsConferenceNames(teamDocs) {
    const set = new Set();
    (teamDocs || []).forEach(t => {
        if (t && t.conference && t.classification !== 'fcs') set.add(t.conference);
    });
    return set;
}

// Conferences present in a slate, for the filter dropdown. Derived from the
// games rather than a static list so it can never offer a conference with no
// games that week (or miss one after realignment). Sorted by the label the
// dropdown actually shows, so the list reads in the order it displays.
//
// `fbsConferences` narrows the list to the league's own universe. Week 1 puts a
// dozen FCS conferences on the slate purely because FCS teams are the paid
// opponents — filtering by "Patriot" would surface the single game a Patriot
// League team travelled to lose, which is not a cut anyone wants. Omit the
// argument to keep every conference (the FCS side of a game still renders; it
// just isn't something you can filter the slate down to).
function conferenceList(games, fbsConferences) {
    const set = new Set();
    (games || []).forEach(g => {
        if (g.homeConference) set.add(g.homeConference);
        if (g.awayConference) set.add(g.awayConference);
    });
    let names = [...set];
    if (fbsConferences) names = names.filter(n => fbsConferences.has(n));
    return names
        .map(name => ({ name, label: conferenceLabel(name) }))
        .sort((a, b) => a.label.localeCompare(b.label));
}

// First and last kickoff of one week, for the date range under the week label.
// Read off the same windows the week picker uses, so the dates can never
// describe a different slate than the one on screen.
function weekRangeOf(windows, week) {
    const w = (windows || []).find(x => x.week === week);
    if (!w) return null;
    return { first: new Date(w.first).toISOString(), last: new Date(w.last).toISOString() };
}

// Every week with its dates, for the week picker. The strip labels each button
// with its own range, so the client needs all of them rather than just the one
// being viewed.
function weekList(windows) {
    return (windows || []).map(w => ({
        week: w.week,
        first: new Date(w.first).toISOString(),
        last: new Date(w.last).toISOString()
    }));
}

// "Georgia Tech -7" -> which side is laying the points, and the number itself.
//
// Parsed from the END rather than split on '-': plenty of teams carry a hyphen
// in their name (Bethune-Cookman, Arkansas-Pine Bluff), and splitting on the
// separator attributes the line to "Bethune". CFBD always formats this as
// "<team> <signed number>", so anchoring on the trailing number is exact.
//
// The number is normalised through parseFloat so "Troy -16.0" renders as -16
// while "-16.5" keeps its half point.
function spreadSideOf(formattedSpread, game) {
    if (!formattedSpread) return null;
    const m = /^(.*?)\s+([+-]?\d+(?:\.\d+)?)$/.exec(String(formattedSpread).trim());
    if (!m) return null;

    const named = m[1].trim().toLowerCase();
    const line = String(parseFloat(m[2]));
    if (named === String(game.homeTeam || '').toLowerCase()) return { side: 'home', line };
    if (named === String(game.awayTeam || '').toLowerCase()) return { side: 'away', line };
    // A book naming a team differently from CFBD is a line we can't attribute to
    // a row, and a spread on the wrong team is worse than no spread at all.
    return null;
}

// Does `which` side ('home' | 'away') have the ball?
//
// CFBD's /scoreboard reports possession as the SIDE — literally "home" or
// "away" — not a team name. The original check here was
// `game.possession === team`, comparing that against a school name, so it was
// never true and the possession marker never rendered on any surface. Verified
// against a live game: { possession: "away", home: "Buffalo Bulls", ... }.
//
// A team-name match is still accepted as a fallback, so a future payload that
// does send a name keeps working rather than silently going blank again.
function hasPossession(possession, which, team) {
    if (!possession) return false;
    const p = String(possession).toLowerCase();
    if (p === 'home' || p === 'away') return p === which;
    return possession === team;
}

function sideOf(game, which, ctx) {
    const id = which === 'home' ? game.homeId : game.awayId;
    const team = which === 'home' ? game.homeTeam : game.awayTeam;
    const conference = which === 'home' ? game.homeConference : game.awayConference;
    const points = which === 'home' ? game.homePoints : game.awayPoints;
    const meta = ctx.teams[id] || {};
    const owner = ctx.owners[id] || null;

    return {
        id,
        team,
        conference: conference || null,
        abbr: meta.abbr || null,
        logo: meta.logo || null,
        rank: ctx.ranks[team] || null,
        record: ctx.records[id] || null,
        line: ctx.spread && ctx.spread.side === which ? ctx.spread.line : null,
        points: points != null ? points : null,
        possession: hasPossession(game.possession, which, team),
        owner: owner ? {
            userId: owner.userId,
            name: owner.name,
            firstName: owner.firstName,
            franchise: owner.franchise,
            color: owner.color,
            avatarUrl: owner.avatarUrl,
            initials: owner.initials,
            points: ctx.points[`${id}:${game.id}`] != null ? ctx.points[`${id}:${game.id}`] : null
        } : null
    };
}

// One game, shaped for the client. Deliberately narrow — the full Game doc
// carries box scores, ELO and player stats that a scoreboard row never shows,
// and a 90-game slate is not the place to ship them.
function shapeGame(game, ctx) {
    const state = gameState(game, ctx.nowMs);
    const line = ctx.lines[game.id] || null;
    // Resolved once and handed to both sides, so only the favoured row carries
    // the number.
    const sideCtx = Object.assign({}, ctx, {
        spread: line ? spreadSideOf(line.formattedSpread, game) : null
    });
    const home = sideOf(game, 'home', sideCtx);
    const away = sideOf(game, 'away', sideCtx);

    return {
        id: game.id,
        week: game.week,
        seasonType: game.seasonType,
        startDate: game.startDate,
        startTimeTbd: !!game.startTimeTbd,
        neutralSite: !!game.neutralSite,
        state,
        period: state === 'live' ? (game.period != null ? game.period : null) : null,
        clock: state === 'live' ? (game.clock || null) : null,
        // Gated on `live` like period/clock: a card that is pre or final has no
        // use for down-and-distance, and shipping it would only give the client
        // something it has to remember not to draw.
        //
        // `lastPlay` is deliberately NOT shipped here. The situation alone is
        // what reads at a glance in a forty-card grid; the full play description
        // belongs on the game detail page, which has the room for it.
        situation: state === 'live' ? (game.situation || null) : null,
        outlet: game.outlet || null,
        weather: game.weather && game.weather.emoji ? {
            emoji: game.weather.emoji,
            condition: game.weather.condition || null,
            temp: game.weather.temp != null ? game.weather.temp : null
        } : null,
        notes: game.notes || null,
        venue: game.venue || null,
        home,
        away,
        spread: line ? (line.formattedSpread || null) : null,
        overUnder: line ? (line.overUnder != null ? line.overUnder : null) : null,
        ranked: !!(home.rank || away.rank),
        leagueGame: !!(home.owner || away.owner)
    };
}

// The slate, kickoff-ordered. Ties broken by game id so two servers rendering
// the same slate can't disagree on row order (an unstable sort would make the
// client's diff-and-patch refresh reshuffle rows that didn't change).
function shapeGames(games, ctx) {
    return (games || [])
        .map(g => shapeGame(g, ctx))
        .sort((a, b) => {
            const ta = Date.parse(a.startDate) || 0;
            const tb = Date.parse(b.startDate) || 0;
            return ta - tb || a.id - b.id;
        });
}

module.exports = {
    pointsByTeamGame, ownersByTeam, weekWindows, defaultWeek,
    gameState, conferenceList, conferenceLabel, fbsConferenceNames, weekRangeOf,
    recordsByTeam, spreadSideOf, weekList, shapeGame, shapeGames, initialsOf, hasPossession,
    CONFERENCE_ABBR, WEEK_TAIL_MS, MAX_GAME_MS
};
