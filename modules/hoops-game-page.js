// Everything the basketball game page shows, in one payload (#503).
//
// The score and the setting come from the local schedule; the fantasy read —
// each side's quadrant and who banked what — is worked out exactly as the
// team page does it (same rank cache, same owner lookup), so the two pages
// cannot tell a manager different stories about one game. The box score is
// read from what the nightly batch stored — the page never calls CBBD.

const HoopsGame = require('../models/hoopsGame');
const HoopsTeam = require('../models/hoopsTeam');
const teamPage = require('./hoops-team-page');
const boxScore = require('./hoops-box-score');
const roster = require('./hoops-roster');
const { isFinal } = require('./hoops-scoring-pass');
const { quadrantFor, venueFor } = require('./hoops-quadrants');
const { pickLogo } = require('../public/logo.js');
const { homeWinProb } = require('./hoops-win-prob');
const stale = require('./hoops-stale-duplicates');
const { outlets } = require('./hoops-media');

// A team's record through this game — what it was walking off the floor,
// not what it is today.
async function recordThrough(teamId, game) {
    const games = await HoopsGame.find({
        season: game.season, status: 'final', startDate: { $lte: game.startDate },
        $or: [{ homeTeamId: teamId }, { awayTeamId: teamId }]
    }, { homeTeamId: 1, awayTeamId: 1, homePoints: 1, awayPoints: 1, status: 1, _id: 0 }).lean();
    let w = 0, l = 0;
    for (const g of games) {
        if (!isFinal(g)) continue;
        const home = Number(g.homeTeamId) === teamId;
        const won = home ? Number(g.homePoints) > Number(g.awayPoints) : Number(g.awayPoints) > Number(g.homePoints);
        if (won) w++; else l++;
    }
    return { w, l };
}

// One side of a game PREVIEW, from that team's own team-page payload — the
// same records, quadrants and stats its team page shows, so a manager never
// reads two versions of one team. Only results BEFORE this game count.
function previewSide(team, before) {
    if (!team) return null;
    const played = team.games.filter(g => g.final && new Date(g.startDate) < before);
    const rec = (list) => {
        const w = list.filter(g => g.us > g.them).length;
        return { w, l: list.length - w };
    };
    const s = team.stats;
    const per = (v) => (s && s.games && Number.isFinite(v) ? Math.round((v / s.games) * 10) / 10 : null);
    const top = s && Array.isArray(s.players)
        ? s.players.filter(p => p.games > 0)
            .map(p => ({ name: p.name, jersey: p.jersey || null, position: p.position || null,
                ppg: Math.round((p.points / p.games) * 10) / 10,
                rpg: Math.round(((p.rebounds || 0) / p.games) * 10) / 10,
                apg: Math.round(((p.assists || 0) / p.games) * 10) / 10 }))
            .sort((a, b) => b.ppg - a.ppg).slice(0, 3)
        : [];
    let streak = null;
    for (let i = played.length - 1; i >= 0; i--) {
        const won = played[i].us > played[i].them;
        if (!streak) streak = { won, n: 0 };
        if (won !== streak.won) break;
        streak.n++;
    }
    return {
        record: rec(played),
        confRecord: rec(played.filter(g => g.conferenceGame)),
        q1Record: rec(played.filter(g => g.quadrant === 1)),
        roadRecord: rec(played.filter(g => g.venue === 'away')),
        streak,
        last5: played.slice(-5).map(g => ({ won: g.us > g.them, us: g.us, them: g.them, venue: g.venue,
            opponent: g.opponent.abbreviation || g.opponent.school })),
        preseason: team.preseason,
        stats: s && s.games ? {
            games: s.games, pace: s.pace ?? null,
            ppg: per(s.team && s.team.points), oppPpg: per(s.opponent && s.opponent.points),
            efgPct: s.team && s.team.efgPct, tovPct: s.team && s.team.tovRatio != null ? s.team.tovRatio * 100 : null,
            orbPct: s.team && s.team.orbPct, ftRate: s.team && s.team.ftRate
        } : null,
        topScorers: top
    };
}

async function build(gameId, { league = null, viewerId = null, now = Date.now() } = {}) {
    const id = Number(gameId);
    if (!Number.isFinite(id)) return null;
    const game = await HoopsGame.findOne({ id }).lean();
    if (!game) return null;
    const yr = Number(game.season);
    const homeId = Number(game.homeTeamId), awayId = Number(game.awayTeamId);
    const final = isFinal(game);
    // In progress: the live poller (#505) writes running points, half and
    // clock. Shown as a live score; nothing is banked until final.
    const live = !final && String(game.status || '').toLowerCase() === 'in_progress';
    const postseason = String(game.seasonType || '').toLowerCase() === 'postseason';
    // An old listing of a game that moved (#498): point at the played one
    // instead of previewing a game that will never tip.
    const replaced = stale.overdue(game, now) ? stale.supersededBy(game, await HoopsGame.find({
        season: game.season, status: 'final', homeTeamId: game.homeTeamId, awayTeamId: game.awayTeamId, id: { $ne: id }
    }, { id: 1, startDate: 1, startTimeTbd: 1, status: 1, homeTeamId: 1, awayTeamId: 1, homePoints: 1, awayPoints: 1, neutralSite: 1, _id: 0 }).lean(), now) : null;

    // The week to rank against: the game's own once it is played; before
    // that, the season's current week — the SAME rule the team page uses,
    // so the two pages give an unplayed game the same quadrant.
    const nowWeek = final ? null : await teamPage.currentWeek(yr);
    const rankWeek = final || nowWeek === null ? Number(game.week) : nowWeek;
    const [teams, ranks, homeRec, awayRec, homeOwner, awayOwner, values, boxed] = await Promise.all([
        HoopsTeam.find({ season: yr, id: { $in: [homeId, awayId] } },
            { id: 1, school: 1, abbreviation: 1, mascot: 1, color: 1, alt_color: 1, logos: 1, _id: 0 }).lean(),
        Number.isFinite(rankWeek) ? teamPage.cachedRanks(yr, rankWeek) : {},
        recordThrough(homeId, game),
        recordThrough(awayId, game),
        teamPage.ownership(league, yr, homeId),
        teamPage.ownership(league, yr, awayId),
        teamPage.quadrantValues(league),
        final ? boxScore.getBox(id) : null
    ]);
    const byId = new Map(teams.map(t => [Number(t.id), t]));
    // Jersey numbers on the box, from the once-a-season roster import (the
    // key players get theirs through the team page's stats below).
    if (boxed) {
        await Promise.all(['home', 'away'].filter(k => boxed[k] && Array.isArray(boxed[k].players)).map(async k => {
            boxed[k].players = await roster.withJerseys(yr, boxed[k].players);
        }));
    }

    // A game still to play gets a PREVIEW: both teams' résumés from their
    // own team pages, earlier meetings, and a pregame win probability.
    let preview = null;
    if (!final && !replaced) {
        const [homeTeam, awayTeam] = await Promise.all([
            byId.has(homeId) ? teamPage.build(homeId, { season: yr }) : null,
            byId.has(awayId) ? teamPage.build(awayId, { season: yr }) : null
        ]);
        const before = new Date(game.startDate);
        const pHome = homeWinProb(homeTeam && homeTeam.preseason && homeTeam.preseason.barthag,
            awayTeam && awayTeam.preseason && awayTeam.preseason.barthag, game.neutralSite);
        preview = {
            home: previewSide(homeTeam, before),
            away: previewSide(awayTeam, before),
            homeWinProb: pHome,
            meetings: homeTeam ? homeTeam.games
                .filter(g => g.final && g.opponent.id === awayId && g.id !== id)
                .map(g => ({ id: g.id, startDate: g.startDate, startTimeTbd: g.startTimeTbd,
                    homeScore: g.us, awayScore: g.them, venue: g.venue, notes: g.notes })) : []
        };
    }

    const side = (teamId, oppId, rec, owner, points) => {
        const t = byId.get(teamId);
        const venue = venueFor(teamId, { homeId: game.homeTeamId, awayId: game.awayTeamId, neutralSite: game.neutralSite });
        const oppRank = ranks[String(oppId)];
        // Paid already: the quadrant it was PAID at (#502), as the team page
        // shows it, not one recomputed from ranks that have moved since. A
        // side's own rank is the rank the OTHER side was paid against, when
        // that side's owner has been paid, so a "#5" never sits beside a Q3
        // that was banked against #120.
        const bankedFor = (o) => (final && o && o.banked ? o.banked[String(id)] : undefined);
        const paid = bankedFor(owner);
        const otherPaid = bankedFor(teamId === homeId ? awayOwner : homeOwner);
        const rank = otherPaid ? otherPaid.oppRank : ranks[String(teamId)];
        return {
            id: teamId,
            school: (t && t.school) || (teamId === homeId ? game.homeTeam : game.awayTeam),
            abbreviation: (t && t.abbreviation) || null,
            color: (t && t.color) || null,
            // The second colour, for when both primaries are navy (#506).
            altColor: (t && t.alt_color) || null,
            logo: t ? pickLogo(t.logos) || null : null,
            hasPage: !!t,
            rank: Number.isFinite(rank) ? rank : null,
            // Through this game when played; going INTO it when not.
            record: rec,
            points: (final || live) && Number.isFinite(Number(points)) && points != null ? Number(points) : null,
            // Postseason games are paid on the tournament ladder, not as a
            // quadrant (isRegular in hoops-detectors) — same rule as the team page.
            quadrant: paid ? paid.quadrant : postseason ? null : quadrantFor(oppRank, venue),
            owner: owner ? { franchiseName: owner.franchiseName, firstName: owner.firstName,
                mine: !!viewerId && owner.accountId === String(viewerId) } : null,
            banked: owner && final && Object.prototype.hasOwnProperty.call(owner.points, String(id)) ? owner.points[String(id)] : null
        };
    };

    return {
        game: {
            id, season: yr, week: game.week, startDate: game.startDate, startTimeTbd: !!game.startTimeTbd,
            status: game.status || null, final, live, postseason,
            period: live && Number.isFinite(Number(game.period)) ? Number(game.period) : null,
            clock: live ? game.clock || null : null,
            tournament: postseason ? (String(game.tournament || '').trim() || 'Postseason') : null,
            notes: game.gameNotes || null, neutralSite: !!game.neutralSite,
            conferenceGame: !!game.conferenceGame && !teamPage.isConfTournament(game),
            venue: game.venue || null, city: game.city || null, state: game.state || null,
            tv: outlets(game.broadcasts)
        },
        home: side(homeId, awayId, homeRec, homeOwner, game.homePoints),
        away: side(awayId, homeId, awayRec, awayOwner, game.awayPoints),
        quadrantValues: values,
        rescheduled: replaced ? { id: replaced.id, startDate: replaced.startDate, startTimeTbd: !!replaced.startTimeTbd } : null,
        box: boxed || null,
        preview
    };
}

module.exports = { build, recordThrough };
