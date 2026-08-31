const { useMongo } = require('./helpers/mongo');
const Game = require('../models/game');
const Parlay = require('../models/parlay');

jest.mock('../modules/box-scores', () => {
    const original = jest.requireActual('../modules/box-scores');
    return {
        ...original,
        ingestBoxScores: jest.fn()
    };
});
const { ingestBoxScores } = require('../modules/box-scores');
const { retryPendingStatLegs } = require('../modules/parlay-resolve');

useMongo();
beforeEach(() => ingestBoxScores.mockClear());

function seedGame(overrides = {}) {
    return Game.create({
        id: 100001, season: 2026, week: 1, seasonType: 'regular',
        homeTeam: 'Alabama', awayTeam: 'LSU', homeId: 333, awayId: 99,
        completed: true, homePoints: 24, awayPoints: 31,
        conferenceGame: false, neutralSite: false, startTimeTbd: false,
        startDate: new Date('2026-09-05T19:00:00Z'),
        ...overrides
    });
}

function seedParlay(legs) {
    return Parlay.create({
        group: '000000000000000000000001',
        season: 2026, seasonType: 'regular', week: 1,
        status: 'pending', legs
    });
}

describe('retryPendingStatLegs', () => {
    it('fetches box scores for completed games missing teamStats and resolves', async () => {
        await seedGame({ teamStats: null });
        await seedParlay([{
            contributor: '000000000000000000000002',
            betType: 'stat_over_under',
            selection: 'LSU Over 350 Total Yards',
            gameId: 100001,
            line: 350,
            statCategory: 'totalYards',
            statTeamSide: 'away',
            result: 'pending'
        }]);

        ingestBoxScores.mockImplementationOnce(async () => {
            await Game.updateOne({ id: 100001 }, {
                $set: {
                    teamStats: {
                        home: { totalYards: 300 },
                        away: { totalYards: 420 }
                    }
                }
            });
            return { ingested: 1, remainingCalls: 4500 };
        });

        const result = await retryPendingStatLegs(2026);
        expect(result.retried).toBe(1);
        expect(result.resolved).toBe(1);

        const parlay = await Parlay.findOne();
        expect(parlay.legs[0].result).toBe('win');
        expect(parlay.status).toBe('won');
    });

    it('skips when no pending stat legs exist', async () => {
        const result = await retryPendingStatLegs(2026);
        expect(result.retried).toBe(0);
        expect(ingestBoxScores).not.toHaveBeenCalled();
    });

    it('skips box score fetch when game already has teamStats', async () => {
        await seedGame({
            teamStats: {
                home: { totalYards: 300 },
                away: { totalYards: 200 }
            }
        });
        await seedParlay([{
            contributor: '000000000000000000000002',
            betType: 'stat_over_under',
            selection: 'LSU Over 350 Total Yards',
            gameId: 100001,
            line: 350,
            statCategory: 'totalYards',
            statTeamSide: 'away',
            result: 'pending'
        }]);

        const result = await retryPendingStatLegs(2026);
        expect(ingestBoxScores).not.toHaveBeenCalled();
        expect(result.resolved).toBe(1);

        const parlay = await Parlay.findOne();
        expect(parlay.legs[0].result).toBe('loss');
    });

    it('reports remainingCalls from the box score fetch', async () => {
        await seedGame({ teamStats: null });
        await seedParlay([{
            contributor: '000000000000000000000002',
            betType: 'stat_over_under',
            selection: 'Alabama Over 300 Total Yards',
            gameId: 100001,
            line: 300,
            statCategory: 'totalYards',
            statTeamSide: 'home',
            result: 'pending'
        }]);

        ingestBoxScores.mockImplementationOnce(async () => {
            await Game.updateOne({ id: 100001 }, {
                $set: { teamStats: { home: { totalYards: 350 }, away: { totalYards: 400 } } }
            });
            return { ingested: 1, remainingCalls: 50 };
        });

        const result = await retryPendingStatLegs(2026);
        expect(result.remainingCalls).toBe(50);
    });
});
