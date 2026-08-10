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
