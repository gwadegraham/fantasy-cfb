// GET /scores/pending-regular/:season — the signal the postseason pipeline uses
// to catch a trailing regular-season week.
//
// CFBD's postseason calendar window opens BEFORE the regular season's last game
// kicks off: in 2026 the week-15 window closes 2026-12-12T07:59Z while Army–Navy
// (a week-15 regular-season game) kicks off at 20:00Z the same day. From then on
// the pipeline resolves to the postseason and pulls `seasonType=postseason`,
// which never contains that game — so week 15 would keep the 0 it was seeded
// with. This endpoint is what tells the pipeline to pull week 15 anyway.
//
// Runs against an in-memory Mongo with the real models and the real route.

process.env.YEAR = '2026';

const express = require('express');
const request = require('supertest');
const { useMongo } = require('./helpers/mongo');
const User = require('../models/user');
const Game = require('../models/game');
const scoresRouter = require('../routes/scores');

const app = express();
app.use(express.json());
app.use('/scores', scoresRouter);

useMongo();

const SEASON = 2026;

function team(id, school) {
    return {
        id, school, mascot: 'Mascot', abbreviation: school.slice(0, 3).toUpperCase(),
        conference: 'American Athletic', color: '#000', logos: ['http://x/logo.png'],
        location: {
            venue_id: id, name: 'Stadium', city: 'City', state: 'ST', zip: '00000',
            latitude: 1, longitude: 1, capacity: 100, grass: true, dome: false
        }
    };
}

// Army is drafted; nobody has team 99.
async function manager() {
    return User.create({
        firstName: 'Ann', lastName: 'Test', league: 'graham-league',
        seasons: [{ season: SEASON, teams: [team(2, 'Army')], weeklyScore: [] }]
    });
}

const hoursAgo = (h) => new Date(Date.now() - h * 3600 * 1000).toISOString();

async function game(overrides) {
    return Game.create(Object.assign({
        id: 900001, season: SEASON, week: 15, seasonType: 'regular',
        startDate: hoursAgo(9), startTimeTbd: false, completed: false,
        neutralSite: true, conferenceGame: false,
        homeId: 2, homeTeam: 'Army', awayId: 99, awayTeam: 'Navy'
    }, overrides));
}

const ask = () => request(app).get(`/scores/pending-regular/${SEASON}`);

describe('GET /scores/pending-regular/:season', () => {
    test('names the week when a drafted team has kicked off and is not final', async () => {
        await manager();
        await game();
        const res = await ask();
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ season: '2026', week: 15 });
    });

    test('answers null once the game is complete — so the extra pull stops', async () => {
        await manager();
        await game({ completed: true, homePoints: 24, awayPoints: 17 });
        const res = await ask();
        expect(res.body.week).toBeNull();
    });

    test('answers null with nothing on file at all', async () => {
        const res = await ask();
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ season: '2026', week: null });
    });

    test('ignores a game no manager drafted', async () => {
        await manager();
        await game({ id: 900002, homeId: 98, homeTeam: 'Somebody', awayId: 99 });
        const res = await ask();
        expect(res.body.week).toBeNull();
    });

    test('ignores a game that has not kicked off', async () => {
        await manager();
        await game({ startDate: new Date(Date.now() + 3 * 3600 * 1000).toISOString() });
        const res = await ask();
        expect(res.body.week).toBeNull();
    });

    test('ignores another season entirely', async () => {
        await manager();
        await game({ id: 900003, season: 2025 });
        const res = await ask();
        expect(res.body.week).toBeNull();
    });
});
