// Coverage for publicState() in modules/draft-socket.js — the shape broadcast to
// every draft-room client.
//
// It's a hand-written field WHITELIST, which makes it quietly lossy: a new field
// on the Draft model reaches the admin form and the DB, and then simply never
// arrives in the draft room. That's exactly how the video call link shipped
// invisible there. These tests assert the contract so the next added field fails
// here instead of on draft night.

const { publicState } = require('../modules/draft-socket');

const baseDraft = (extra = {}) => Object.assign({
    _id: 'draft-1',
    league: 'graham-league',
    season: 2026,
    status: 'scheduled',
    snake: true,
    totalRounds: 10,
    scheduledAt: new Date('2026-08-17T21:00:00Z'),
    callUrl: 'https://zoom.us/j/123456789',
    draftOrder: ['aaaaaaaaaaaaaaaaaaaaaaa1', 'aaaaaaaaaaaaaaaaaaaaaaa2'],
    picks: [],
    currentOverall: 1
}, extra);

describe('publicState', () => {
    // The whitelist, pinned exhaustively. toMatchObject below cannot see a
    // field that is MISSING, which is the failure this file was written for —
    // the call link reached the admin form and the database and then simply
    // never arrived in the room. A new Draft setting now fails HERE.
    it('carries every field the room is given, and no more', () => {
        expect(Object.keys(publicState(baseDraft())).sort()).toEqual([
            '_id', 'callUrl', 'currentOverall', 'draftOrder', 'league',
            'onTheClock', 'picks', 'poolSize', 'scheduledAt', 'season',
            'snake', 'status', 'totalRounds'
        ]);
    });

    it('carries the pool cap, so the room can say what it is drafting from', () => {
        expect(publicState(baseDraft({ poolSize: 120 })).poolSize).toBe(120);
        // Absent on every football draft, and null is what "all teams" means
        // on the wire — undefined would drop out of the JSON entirely.
        expect(publicState(baseDraft()).poolSize).toBeNull();
    });

    it('broadcasts every commissioner-configured setting the room renders', () => {
        const state = publicState(baseDraft());
        expect(state).toMatchObject({
            league: 'graham-league',
            season: 2026,
            status: 'scheduled',
            snake: true,
            totalRounds: 10,
            callUrl: 'https://zoom.us/j/123456789'
        });
        expect(state.scheduledAt).toEqual(new Date('2026-08-17T21:00:00Z'));
    });

    it('sends the call link as null rather than undefined when none is set', () => {
        expect(publicState(baseDraft({ callUrl: null })).callUrl).toBeNull();
        expect(publicState(baseDraft({ callUrl: undefined })).callUrl).toBeNull();
    });

    it('derives who is on the clock', () => {
        const state = publicState(baseDraft({ status: 'active' }));
        expect(state.onTheClock).toMatchObject({ round: 1, userId: 'aaaaaaaaaaaaaaaaaaaaaaa1' });
    });

    it('stringifies the draft order so client-side id comparisons line up', () => {
        const state = publicState(baseDraft({ draftOrder: [{ toString: () => 'oid-1' }] }));
        expect(state.draftOrder).toEqual(['oid-1']);
    });

    it('unwraps a mongoose document via toObject', () => {
        const doc = { toObject: () => baseDraft() };
        expect(publicState(doc).callUrl).toBe('https://zoom.us/j/123456789');
    });
});
