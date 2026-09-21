// The pure half of the "your weekly recap is ready" push: which recap is the
// new one, whether it has already been announced, and what the one-line hook
// says. modules/push-notify.js does the fan-out (tests/RecapNoticeNotify.spec.js).

const {
    alreadyNoticed, latestRecap, recapHook, ordinal, buildRecapNoticePayload
} = require('../modules/recap-notice');

const recap = (o) => Object.assign({ week: 4, effWeek: 4, label: 'Week 4', score: 26, rank: 2 }, o);

describe('latestRecap', () => {
    it('picks the newest week, not the last array element', () => {
        const payload = { recaps: [recap({ week: 4, effWeek: 4 }), recap({ week: 2, effWeek: 2 })] };
        expect(latestRecap(payload).week).toBe(4);
    });

    // The postseason sorts after week 16 via effWeek — a bare `week` compare
    // would announce week 16 over the bowl slate.
    it('treats the postseason as newer than week 16', () => {
        const payload = { recaps: [recap({ week: 16, effWeek: 16 }), recap({ week: 1, effWeek: 17, label: 'Postseason' })] };
        expect(latestRecap(payload).label).toBe('Postseason');
    });

    // An empty list is the preseason answering honestly, not a failure.
    it('answers null when there is nothing to announce', () => {
        expect(latestRecap({ recaps: [] })).toBeNull();
        expect(latestRecap({})).toBeNull();
        expect(latestRecap(null)).toBeNull();
    });
});

describe('alreadyNoticed', () => {
    const log = [{ season: 2026, week: 4 }];

    it('matches on season AND week', () => {
        expect(alreadyNoticed(log, 2026, 4)).toBe(true);
        expect(alreadyNoticed(log, 2026, 5)).toBe(false);
        expect(alreadyNoticed(log, 2025, 4)).toBe(false);
    });

    it('handles an empty or absent log', () => {
        expect(alreadyNoticed([], 2026, 4)).toBe(false);
        expect(alreadyNoticed(undefined, 2026, 4)).toBe(false);
        expect(alreadyNoticed([null], 2026, 4)).toBe(false);
    });
});

describe('ordinal', () => {
    it('handles the teens, which are the ones that go wrong', () => {
        expect([1, 2, 3, 4, 11, 12, 13, 21, 22].map(ordinal))
            .toEqual(['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd']);
    });
});

describe('recapHook', () => {
    it('leads with points, then rank, then movement', () => {
        expect(recapHook(recap({ score: 26, rank: 2, rankDelta: 1 }))).toBe('26 points · 2nd · up 1');
    });

    it('says which way they moved', () => {
        expect(recapHook(recap({ rankDelta: -3 }))).toContain('down 3');
    });

    // A week where nobody moved should not claim movement.
    it('leaves movement out when the rank held', () => {
        expect(recapHook(recap({ rankDelta: 0 }))).toBe('26 points · 2nd');
        expect(recapHook(recap({ rankDelta: null }))).toBe('26 points · 2nd');
    });

    it('marks a shared rank as a tie', () => {
        expect(recapHook(recap({ rank: 2, rankTie: true }))).toContain('T-2nd');
    });

    it('degrades to whatever it has', () => {
        expect(recapHook({ score: 12 })).toBe('12 points');
        expect(recapHook({})).toBe('');
    });

    // A zero week is still a week. Dropping it because it is falsy would make
    // the worst Saturday of someone's season the one with no numbers on it.
    it('reports a zero score rather than omitting it', () => {
        expect(recapHook({ score: 0, rank: 6 })).toBe('0 points · 6th');
    });
});

describe('buildRecapNoticePayload', () => {
    const built = (o) => buildRecapNoticePayload({ userId: 'u1', recap: recap(o) });

    it('names the week and carries the hook', () => {
        const p = built({ rankDelta: 1 });
        expect(p.title).toBe('📖 Week 4 recap is ready');
        expect(p.body).toBe('26 points · 2nd · up 1. Tap to read your week.');
    });

    // The push is a POINTER. The narrative, MVP, upset and weather beats stay in
    // the app — a push carrying the recap would be a recap by email.
    it('does not carry the recap itself', () => {
        const p = built({ narrative: 'A statement win powered by Texas.', mvpTeam: { school: 'Texas', score: 4 } });
        expect(p.body).not.toContain('statement win');
        expect(p.body).not.toContain('Texas');
        expect(p.body.length).toBeLessThan(70);
    });

    it('still says something when there are no numbers', () => {
        const p = buildRecapNoticePayload({ userId: 'u1', recap: { week: 4, label: 'Week 4' } });
        expect(p.body).toBe('Tap to read your week.');
    });

    it('carries the type the mute switch reads and a per-week tag', () => {
        const p = built();
        expect(p.type).toBe('recapReady');
        expect(p.tag).toBe('recap-w4');
    });

    // Same path the Captain reminder got wrong: `/` is Standings, and /userHome
    // without `?user=` renders a blank page.
    it('deep links to the recap drawer on the recipient\'s own profile', () => {
        expect(built().url).toBe('/userHome?user=u1#recap');
    });
});
