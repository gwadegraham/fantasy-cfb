// The matchup card shows the Captain's team DOUBLED.
//
// scoring.js never folds the captain bonus into the per-team scores — it banks
// it as a separate `captainBonus` on the week — so `scoreByTeam` holds raw,
// un-doubled values. The card meanwhile stamps a "★2×" badge on the captain
// (public/h2h-card.js), whose own comment says it marks the row "so the
// inflated score reads". The score beside it was never inflated, so the badge
// asserted something false and the team rows summed short of the matchup total
// printed above them.
//
// The reconciliation is exact, which is what makes it testable: the card's
// headline is baseWeekScore — the week total INCLUDING captainBonus and
// EXCLUDING the H2H win bonus — so
//
//     sum(team rows, captain doubled) === headline
//
// That identity is the real assertion here. It also means no H2H bonus line
// belongs on this card: that bonus is deliberately not in the number it totals
// to, and adding it would break the card in the other direction.
//
// Runs against an in-memory Mongo with the real models and the real route.

process.env.YEAR = '2026';

const express = require('express');
const request = require('supertest');
const { useMongo } = require('./helpers/mongo');
const User = require('../models/user');
const Game = require('../models/game');
const Team = require('../models/team');
const ScoringConfig = require('../models/scoringConfig');
const standingsRouter = require('../routes/standings');

const app = express();
app.use(express.json());
app.use('/standings', standingsRouter);

useMongo();

const SEASON = 2026;
const LEAGUE = 'graham-league';
const OREGON = 1, USC = 2, DUKE = 3, MIAMI = 4;

function fullTeam(id, school) {
    return {
        id, school, mascot: 'Mascot', abbreviation: school.slice(0, 3).toUpperCase(),
        conference: 'SEC', color: '#000', logos: ['http://x/logo.png'],
        location: { venue_id: id, name: 'Stadium', city: 'City', state: 'ST', zip: '00000', latitude: 1, longitude: 1, capacity: 100, grass: true, dome: false }
    };
}
function finishedGame(id, homeId, awayId) {
    return {
        id, season: SEASON, week: 1, seasonType: 'regular',
        startDate: '2026-09-05T23:30:00.000Z', startTimeTbd: false, neutralSite: false, conferenceGame: false,
        homeId, homeTeam: 'Home', awayId, awayTeam: 'Away',
        homePoints: 40, awayPoints: 3, completed: true
    };
}

// Ann captains Oregon. Oregon scored 4 raw, USC 2 raw, so the week banks
// 4 + 2 + 4 (the captain bonus) = 10.
const OREGON_RAW = 4, USC_RAW = 2, CAPTAIN_BONUS = OREGON_RAW;
const WEEK_TOTAL = OREGON_RAW + USC_RAW + CAPTAIN_BONUS;

async function seed({ captainEnabled = true, h2hBonus = 0 } = {}) {
    await ScoringConfig.create({
        league: LEAGUE, model: 'graham', values: {},
        engagementBySeason: { '2026': { h2hEnabled: true, h2hWinBonus: 3, h2hTieBonus: 0, captainEnabled, captainMultiplier: 2 } }
    });
    await Team.create([[OREGON, 'Oregon'], [USC, 'USC'], [DUKE, 'Duke'], [MIAMI, 'Miami'], [98, 'Opp98'], [99, 'Opp99'], [97, 'Opp97'], [96, 'Opp96']]
        .map(([id, school]) => Object.assign(fullTeam(id, school), {
            seasons: [{ season: SEASON, conference: 'SEC', spRating: 5, expectedWins: 0.5 }]
        })));

    const ann = await User.create({
        firstName: 'Ann', lastName: 'Test', league: LEAGUE,
        seasons: [{
            season: SEASON,
            teams: [fullTeam(OREGON, 'Oregon'), fullTeam(USC, 'USC')],
            captains: [{ week: 1, teamId: OREGON }],
            weeklyScore: [{
                week: 1, season: 'regular',
                score: WEEK_TOTAL + h2hBonus,
                h2hBonus,
                captainTeamId: OREGON, captainBonus: CAPTAIN_BONUS,
                scoreByTeam: [
                    { teamId: OREGON, school: 'Oregon', score: OREGON_RAW },
                    { teamId: USC, school: 'USC', score: USC_RAW }
                ]
            }],
            cumulativeScore: WEEK_TOTAL + h2hBonus
        }]
    });
    await User.create({
        firstName: 'Bob', lastName: 'Test', league: LEAGUE,
        seasons: [{
            season: SEASON, teams: [fullTeam(DUKE, 'Duke'), fullTeam(MIAMI, 'Miami')],
            weeklyScore: [{ week: 1, season: 'regular', score: 1, scoreByTeam: [{ teamId: DUKE, school: 'Duke', score: 1 }] }],
            cumulativeScore: 1
        }]
    });
    await Game.create([finishedGame(101, OREGON, 99), finishedGame(102, USC, 98), finishedGame(103, DUKE, 97), finishedGame(104, MIAMI, 96)]);
    return ann;
}

async function cardFor(ann) {
    const res = await request(app).get(`/standings/h2h/${LEAGUE}/${SEASON}`);
    const g = res.body.schedule.find(s => s.week === 1).games[0];
    const iAmA = String(g.aId) === String(ann._id);
    return { teams: iAmA ? g.aTeams : g.bTeams, headline: iAmA ? g.aScore : g.bScore };
}

describe('the matchup card shows the Captain doubled', () => {
    test('the captained team reads doubled, and its team-mate is untouched', async () => {
        const ann = await seed();
        const { teams } = await cardFor(ann);

        const oregon = teams.find(t => t.teamId === OREGON);
        const usc = teams.find(t => t.teamId === USC);

        expect(oregon.captain).toBe(true);
        expect(oregon.score).toBe(OREGON_RAW * 2);
        expect(usc.captain).toBe(false);
        expect(usc.score).toBe(USC_RAW);
    });

    // The identity the whole fix rests on. If this breaks, the card is printing
    // a total its own rows contradict — which is the bug that was reported.
    test('the team rows now sum to the matchup total above them', async () => {
        const ann = await seed();
        const { teams, headline } = await cardFor(ann);

        const rows = teams.reduce((sum, t) => sum + (t.score || 0), 0);
        expect(rows).toBe(headline);
        expect(rows).toBe(WEEK_TOTAL);
    });

    // The H2H win bonus is deliberately NOT in the card's headline (h2h.js
    // subtracts it to keep the pass idempotent), so it must not be added to the
    // rows either — the identity has to hold with a bonus banked.
    test('an awarded H2H bonus changes neither the rows nor the headline', async () => {
        const ann = await seed({ h2hBonus: 3 });
        const { teams, headline } = await cardFor(ann);

        const rows = teams.reduce((sum, t) => sum + (t.score || 0), 0);
        expect(headline).toBe(WEEK_TOTAL);
        expect(rows).toBe(headline);
    });

    // Doubling is applied before the route sorts, so the captain ranks by what
    // the card actually shows. Oregon's raw 4 already leads USC's 2, so this
    // pins ordering by the displayed number rather than the stored one.
    test('rows are ordered by the displayed score', async () => {
        const ann = await seed();
        const { teams } = await cardFor(ann);
        const scores = teams.map(t => t.score);
        expect(scores).toEqual([...scores].sort((a, b) => b - a));
    });

    test('a league with the captain off shows raw scores and no badge', async () => {
        const ann = await seed({ captainEnabled: false });
        const { teams } = await cardFor(ann);

        const oregon = teams.find(t => t.teamId === OREGON);
        expect(oregon.captain).toBe(false);
        expect(oregon.score).toBe(OREGON_RAW);
    });
});
