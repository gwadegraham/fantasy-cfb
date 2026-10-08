// Everything the basketball team page shows, in one payload (#494).
//
// Not football's team page with the nouns swapped. College basketball reads
// a team through its RESUME — the selection committee's team sheet, wins
// and losses by quadrant — and through where it won: road wins are the
// currency. So the centre of this payload is each game's quadrant, worked
// out the way the scoring engine banks it: the opponent's rank in THAT
// week, crossed with the venue (modules/hoops-quadrants.js).
//
// No CBBD calls. Games, ranks, rosters and the nightly stats import are all
// local.

const HoopsTeam = require('../models/hoopsTeam');
const HoopsGame = require('../models/hoopsGame');
const { dropStale } = require('./hoops-stale-duplicates');
const HoopsTeamStats = require('../models/hoopsTeamStats');
const roster = require('./hoops-roster');
const franchiseRepo = require('./franchise-repo');
const { ranksFor } = require('./hoops-ranks');
const { quadrantFor, venueFor } = require('./hoops-quadrants');
const { entryFor } = require('./roster-teams');
const { pickLogo } = require('../public/logo.js');
const ScoringConfig = require('../models/scoringConfig');
const { resolveConfig, overridesFromDoc } = require('./scoring-defaults');

// A week's ranks are fixed once the week is rated, and a team page reads up
// to ~20 of them, each a full-league read. Cached briefly per process so a
// busy night of page views is not a busy night for the free-tier cluster.
const RANK_TTL_MS = 10 * 60 * 1000;
const rankCache = new Map();
async function cachedRanks(season, week, now = Date.now()) {
    const key = `${season}:${week}`;
    const hit = rankCache.get(key);
    if (hit && now - hit.at < RANK_TTL_MS) return hit.ranks;
    const { ranks } = await ranksFor(season, week);
    rankCache.set(key, { at: now, ranks });
    return ranks;
}
function clearRankCache() { rankCache.clear(); weekCache.clear(); }

// THE week a game still to play is quadranted against: the latest week of
// the season in which ANY game has gone final. Season-wide, not per team —
// a per-team "latest played" week differs between two opponents, and ranks
// are blended by week (hoops-ranks blendWeight), so the team page and the
// game page would rate the same future game against different ranks and
// could disagree on its quadrant. Cached with the ranks.
const weekCache = new Map();
async function currentWeek(season, now = Date.now()) {
    const hit = weekCache.get(season);
    if (hit && now - hit.at < RANK_TTL_MS) return hit.week;
    // homePoints/awayPoints required too: the scoring pass's isFinal refuses a
    // "final" row with no score, and so must this, or one bad row moves the week.
    const last = await HoopsGame.findOne({ season, status: 'final', week: { $type: 'number' },
        homePoints: { $type: 'number' }, awayPoints: { $type: 'number' } }, { week: 1, _id: 0 })
        .sort({ week: -1 }).lean();
    const week = last ? Number(last.week) : null;
    weekCache.set(season, { at: now, week });
    return week;
}

// The scoring pass's own test of "is this a result", reused so the page and
// the points can never disagree about which games count. (A local copy read
// Number(null) as 0, so a game with a missing score passed as final.)
const { isFinal, rosterIds } = require('./hoops-scoring-pass');

// The rank an efficiency number holds among every rated team, best first.
function rankAmong(values, value, higherIsBetter) {
    if (!Number.isFinite(value)) return null;
    const better = values.filter(v => (higherIsBetter ? v > value : v < value)).length;
    return better + 1;
}

// A conference TOURNAMENT game. CBBD files these as regular-season
// conference games (see isConfTournamentFinal in hoops-detectors), so
// conferenceGame alone would add a team's tournament run to its league
// record and re-sort the standings every March. Same test as the detector:
// no named tournament, and notes that say tournament/championship/playoffs.
function isConfTournament(g) {
    if (!g || !g.conferenceGame) return false;
    if (String(g.tournament || '').trim()) return false;
    return /\b(championship|tournament|playoffs?)\b/i.test(String(g.gameNotes || ''));
}
const isLeagueGame = (g) => !!g.conferenceGame && !isConfTournament(g);

// Conference standings from the season's games: conference record first,
// overall second, the way every conference office prints them.
function standingsFrom(teams, games) {
    const row = new Map(teams.map(t => [Number(t.id), {
        teamId: Number(t.id), school: t.school, logo: pickLogo(t.logos) || null,
        confW: 0, confL: 0, w: 0, l: 0
    }]));
    for (const g of games) {
        if (!isFinal(g)) continue;
        const homeWon = Number(g.homePoints) > Number(g.awayPoints);
        for (const [id, won] of [[g.homeTeamId, homeWon], [g.awayTeamId, !homeWon]]) {
            const r = row.get(Number(id));
            if (!r) continue;
            if (won) r.w++; else r.l++;
            if (isLeagueGame(g)) { if (won) r.confW++; else r.confL++; }
        }
    }
    // Games over .500 in conference first, not win percentage: a 0-1 team
    // and a 0-0 team both read 0% and a 0-1 sorted ABOVE teams yet to play.
    const pct = (w, l) => (w + l ? w / (w + l) : 0);
    return [...row.values()].sort((a, b) =>
        ((b.confW - b.confL) - (a.confW - a.confL))
        || (b.confW - a.confW)
        || (pct(b.w, b.l) - pct(a.w, a.l))
        || a.school.localeCompare(b.school));
}

// What a win in each quadrant pays in THIS league — a commissioner can
// change them, so the page reads the config rather than the defaults.
async function quadrantValues(league) {
    if (!league) return null;
    const doc = await ScoringConfig.findOne({ league }).lean();
    const v = resolveConfig(league, overridesFromDoc(doc)).values || {};
    return { 1: v.q1Win ?? null, 2: v.q2Win ?? null, 3: v.q3Win ?? null, 4: v.q4Win ?? null };
}

// Which franchise in `league` rosters this team, and what it has banked.
async function ownership(league, season, teamId) {
    if (!league) return null;
    const managers = await franchiseRepo.byLeagueAndSeason(league, season, {
        fields: ['firstName', 'lastName', 'league', 'seasons']
    });
    for (const m of managers) {
        const entry = entryFor(m, season);
        if (!entry) continue;
        // The scoring pass's own roster reader, fallback and all, so the page
        // names an owner exactly when scoring pays one.
        if (!rosterIds(entry).includes(teamId)) continue;
        const points = {};
        for (const wk of entry.weeklyScore || []) {
            for (const s of wk.scoreByTeam || []) {
                if (Number(s.teamId) === teamId) points[String(s.gameId)] = Number(s.score) || 0;
            }
        }
        return {
            franchiseName: entry.franchiseName || null,
            firstName: m.firstName || null,
            // The ACCOUNT id (franchise-repo puts it on _id) — what Auth0's
            // metadata.userId names — so a page can tell the viewer's own
            // team. Never sent to the client; only a `mine` flag is.
            accountId: m._id != null ? String(m._id) : null,
            points
        };
    }
    return null;
}

async function build(teamId, { season, league = null, now = Date.now() } = {}) {
    const id = Number(teamId);
    const yr = Number(season);
    if (!Number.isFinite(id) || !Number.isFinite(yr)) return null;

    const team = await HoopsTeam.findOne({ id, season: yr }).lean();
    if (!team) return null;

    const [listed, rated, confTeams, stats, owner, values] = await Promise.all([
        HoopsGame.find({ season: yr, $or: [{ homeTeamId: id }, { awayTeamId: id }] }).sort({ startDate: 1 }).lean(),
        HoopsTeam.find({ season: yr, 'preseason.adjOE': { $type: 'number' } },
            { 'preseason.adjOE': 1, 'preseason.adjDE': 1, _id: 0 }).lean(),
        team.conference
            ? HoopsTeam.find({ season: yr, conference: team.conference }, { id: 1, school: 1, logos: 1, _id: 0 }).lean()
            : [],
        HoopsTeamStats.findOne({ season: yr, teamId: id }, { _id: 0, __v: 0 }).lean(),
        ownership(league, yr, id),
        quadrantValues(league)
    ]);

    // Jersey numbers, joined on athleteId from the once-a-season roster
    // import. A player with none on file keeps just a name.
    if (stats && Array.isArray(stats.players)) stats.players = await roster.withJerseys(yr, stats.players);

    // A rescheduled game's old listing never gets played (#498).
    const games = dropStale(listed, now);

    // Opponent names and logos in one read.
    const oppIds = [...new Set(games.map(g => Number(g.homeTeamId) === id ? g.awayTeamId : g.homeTeamId))];
    const opps = await HoopsTeam.find({ season: yr, id: { $in: oppIds } }, { id: 1, school: 1, abbreviation: 1, logos: 1, _id: 0 }).lean();
    const oppById = new Map(opps.map(o => [Number(o.id), o]));

    // A game still to play is quadranted against the latest week that HAS
    // been played — "what it would be worth tonight" — rather than against
    // a future week nobody has rated.
    const nowWeek = await currentWeek(yr);
    const ranksByWeek = new Map();
    for (const g of games) {
        const wk = isFinal(g) || nowWeek === null ? Number(g.week) : nowWeek;
        if (Number.isFinite(wk) && !ranksByWeek.has(wk)) ranksByWeek.set(wk, null);
    }
    await Promise.all([...ranksByWeek.keys()].map(async wk => {
        ranksByWeek.set(wk, await cachedRanks(yr, wk));
    }));

    const points = (owner && owner.points) || {};
    const out = games.map(g => {
        const home = Number(g.homeTeamId) === id;
        const oppId = Number(home ? g.awayTeamId : g.homeTeamId);
        const final = isFinal(g);
        const postseason = String(g.seasonType || '').toLowerCase() === 'postseason';
        const wk = final || nowWeek === null ? Number(g.week) : nowWeek;
        const ranks = ranksByWeek.get(wk) || {};
        const oppRank = ranks[String(oppId)];
        const venue = venueFor(id, { homeId: g.homeTeamId, awayId: g.awayTeamId, neutralSite: g.neutralSite });
        const opp = oppById.get(oppId);
        return {
            id: g.id,
            startDate: g.startDate,
            startTimeTbd: !!g.startTimeTbd,
            week: g.week,
            venue,
            conferenceGame: isLeagueGame(g),
            conferenceTournament: isConfTournament(g),
            notes: g.gameNotes || null,
            opponent: {
                id: oppId,
                school: (opp && opp.school) || (home ? g.awayTeam : g.homeTeam),
                abbreviation: (opp && opp.abbreviation) || null,
                logo: opp ? pickLogo(opp.logos) || null : null,
                rank: Number.isFinite(oppRank) ? oppRank : null,
                // A non-D-I opponent has no basketball team page to link to.
                hasPage: !!opp
            },
            // Postseason games (NCAA, NIT, the Crown) are not quadrant games:
            // scoring pays them on the tournament ladder and only fires a
            // quadrant win when the game is regular season (isRegular in
            // modules/hoops-detectors.js). Conference tournaments are
            // 'regular' to CBBD and do get a quadrant, exactly as scored.
            quadrant: postseason ? null : quadrantFor(oppRank, venue),
            postseason,
            tournament: postseason ? (String(g.tournament || '').trim() || 'Postseason') : null,
            final,
            us: final ? Number(home ? g.homePoints : g.awayPoints) : null,
            them: final ? Number(home ? g.awayPoints : g.homePoints) : null,
            points: final && Object.prototype.hasOwnProperty.call(points, String(g.id)) ? points[String(g.id)] : null
        };
    });

    // Conference standings need every game the conference's teams played,
    // not just this team's: ~15 teams x ~31 games, slim-projected, ~40 KB at
    // season's end. Overall records come from the same read, so the table
    // never waits on the stats import.
    const confIds = confTeams.map(t => Number(t.id));
    const confGames = confIds.length
        ? await HoopsGame.find({ season: yr, status: 'final',
            $or: [{ homeTeamId: { $in: confIds } }, { awayTeamId: { $in: confIds } }] },
            { homeTeamId: 1, awayTeamId: 1, homePoints: 1, awayPoints: 1, status: 1, conferenceGame: 1, gameNotes: 1, tournament: 1, _id: 0 }).lean()
        : [];
    const standings = standingsFrom(confTeams, confGames);

    const pre = team.preseason || {};
    const oes = rated.map(t => t.preseason.adjOE);
    const des = rated.map(t => t.preseason.adjDE);

    return {
        season: yr,
        team: {
            id, school: team.school, mascot: team.mascot || null,
            conference: team.conference || null, color: team.color || null,
            logo: pickLogo(team.logos) || null, venue: team.currentVenue || null
        },
        preseason: pre.rank != null ? {
            rank: pre.rank, adjOE: pre.adjOE ?? null, adjDE: pre.adjDE ?? null,
            barthag: pre.barthag ?? null, projectedRecord: pre.projectedRecord || null,
            oeRank: rankAmong(oes, pre.adjOE, true),
            deRank: rankAmong(des, pre.adjDE, false),
            ratedTeams: rated.length
        } : null,
        owner: owner ? { franchiseName: owner.franchiseName, firstName: owner.firstName } : null,
        quadrantValues: values,
        games: out,
        standings,
        stats: stats || null
    };
}

module.exports = { build, standingsFrom, rankAmong, isConfTournament, clearRankCache, RANK_TTL_MS,
    // Shared with the game page (#503), so the two read ranks and owners the same way.
    cachedRanks, ownership, quadrantValues, currentWeek };
