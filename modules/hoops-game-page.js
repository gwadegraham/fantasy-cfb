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
const { isFinal } = require('./hoops-scoring-pass');
const { quadrantFor, venueFor } = require('./hoops-quadrants');
const { pickLogo } = require('../public/logo.js');

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

async function build(gameId, { league = null } = {}) {
    const id = Number(gameId);
    if (!Number.isFinite(id)) return null;
    const game = await HoopsGame.findOne({ id }).lean();
    if (!game) return null;
    const yr = Number(game.season);
    const homeId = Number(game.homeTeamId), awayId = Number(game.awayTeamId);
    const final = isFinal(game);
    const postseason = String(game.seasonType || '').toLowerCase() === 'postseason';

    // The week to rank against: the game's own once it is played; before
    // that, the season's current week — the SAME rule the team page uses,
    // so the two pages give an unplayed game the same quadrant.
    const nowWeek = final ? null : await teamPage.currentWeek(yr);
    const rankWeek = final || nowWeek === null ? Number(game.week) : nowWeek;
    const [teams, ranks, homeRec, awayRec, homeOwner, awayOwner, values, boxed] = await Promise.all([
        HoopsTeam.find({ season: yr, id: { $in: [homeId, awayId] } },
            { id: 1, school: 1, abbreviation: 1, mascot: 1, color: 1, logos: 1, _id: 0 }).lean(),
        Number.isFinite(rankWeek) ? teamPage.cachedRanks(yr, rankWeek) : {},
        recordThrough(homeId, game),
        recordThrough(awayId, game),
        teamPage.ownership(league, yr, homeId),
        teamPage.ownership(league, yr, awayId),
        teamPage.quadrantValues(league),
        final ? boxScore.getBox(id) : null
    ]);
    const byId = new Map(teams.map(t => [Number(t.id), t]));

    const side = (teamId, oppId, rec, owner, points) => {
        const t = byId.get(teamId);
        const venue = venueFor(teamId, { homeId: game.homeTeamId, awayId: game.awayTeamId, neutralSite: game.neutralSite });
        const oppRank = ranks[String(oppId)];
        const rank = ranks[String(teamId)];
        return {
            id: teamId,
            school: (t && t.school) || (teamId === homeId ? game.homeTeam : game.awayTeam),
            abbreviation: (t && t.abbreviation) || null,
            color: (t && t.color) || null,
            logo: t ? pickLogo(t.logos) || null : null,
            hasPage: !!t,
            rank: Number.isFinite(rank) ? rank : null,
            record: final ? rec : null,
            points: final ? Number(points) : null,
            // Postseason games are paid on the tournament ladder, not as a
            // quadrant (isRegular in hoops-detectors) — same rule as the team page.
            quadrant: postseason ? null : quadrantFor(oppRank, venue),
            owner: owner ? { franchiseName: owner.franchiseName, firstName: owner.firstName } : null,
            banked: owner && final && Object.prototype.hasOwnProperty.call(owner.points, String(id)) ? owner.points[String(id)] : null
        };
    };

    return {
        game: {
            id, season: yr, week: game.week, startDate: game.startDate, startTimeTbd: !!game.startTimeTbd,
            status: game.status || null, final, postseason,
            tournament: postseason ? (String(game.tournament || '').trim() || 'Postseason') : null,
            notes: game.gameNotes || null, neutralSite: !!game.neutralSite,
            conferenceGame: !!game.conferenceGame && !teamPage.isConfTournament(game),
            venue: game.venue || null, city: game.city || null, state: game.state || null
        },
        home: side(homeId, awayId, homeRec, homeOwner, game.homePoints),
        away: side(awayId, homeId, awayRec, awayOwner, game.awayPoints),
        quadrantValues: values,
        box: boxed || null
    };
}

module.exports = { build, recordThrough };
