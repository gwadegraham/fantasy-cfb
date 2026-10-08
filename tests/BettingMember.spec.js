// The betting flag behind the navbar entry, the My Team tile and /betting's
// redirect (modules/betting-member.js). Betting is football-only (#491).

const express = require('express');
const request = require('supertest');
const { useMongo } = require('./helpers/mongo');
const BettingGroup = require('../models/bettingGroup');
const { bettingMember } = require('../modules/betting-member');
const { Types } = require('mongoose');
const ME = String(new Types.ObjectId()), OTHER = String(new Types.ObjectId());

useMongo();

function app(sport, userId = ME) {
    const a = express();
    a.use((req, res, next) => {
        res.locals.viewerSport = sport;
        req.oidc = { isAuthenticated: () => true, user: { user_metadata: { metadata: { userId } } } };
        next();
    });
    a.use(bettingMember());
    a.get('/', (req, res) => res.json({ member: res.locals.isBettingGroupMember }));
    return a;
}
const html = (a) => request(a).get('/').set('Accept', 'text/html');

beforeEach(async () => {
    await BettingGroup.create({ name: 'Parlay Pals', active: true, season: 2026, members: [ME] });
});

test('a member viewing a football league sees betting', async () => {
    expect((await html(app('football'))).body.member).toBe(true);
});

test('the same member viewing a basketball league does not', async () => {
    expect((await html(app('basketball'))).body.member).toBe(false);
});

test('a non-member never does', async () => {
    expect((await html(app('football', OTHER))).body.member).toBe(false);
});

test('an API call skips the lookup', async () => {
    expect((await request(app('football')).get('/').set('Accept', 'application/json')).body.member).toBe(false);
});
