// The pure half of the "your weekly recap is ready" push: which recap is the
// new one, whether it has already been announced, and the fixed copy that
// announces it without giving any of it away. modules/push-notify.js does the
// fan-out (tests/RecapNoticeNotify.spec.js).

const {
    alreadyNoticed, latestRecap, buildRecapNoticePayload
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

describe('buildRecapNoticePayload', () => {
    const built = (o) => buildRecapNoticePayload({ userId: 'u1', recap: recap(o) });

    it('names which week is ready and says to tap', () => {
        const p = built();
        expect(p.title).toBe('📖 Week 4 recap is ready');
        expect(p.body).toBe('See how your week went — tap to read it.');
    });

    // THE POINT OF THIS ALERT. It announces that a recap exists; it does not
    // abridge it. A lock screen that reports the score has given the manager
    // the week's result without them ever opening the app the recap lives in —
    // which was the first cut, with points and rank in the body as a "hook".
    it('carries nothing from the recap itself', () => {
        const p = built({
            score: 26, rank: 2, rankDelta: 1, rankTie: true, cumTotal: 71,
            narrative: 'A statement win powered by Texas.',
            mvpTeam: { school: 'Texas', score: 4 },
            weekHigh: true, isSeasonHigh: true,
            upset: { team: 'Texas', loser: 'Georgia', margin: 14 }
        });
        const text = `${p.title} ${p.body}`;
        ['26', 'points', '2nd', 'up 1', '71', 'statement', 'Texas', 'Georgia', 'high']
            .forEach(leak => expect(text).not.toContain(leak));
    });

    // The body is a constant, so no future field on the recap can leak into it.
    it('says the same thing whatever the week held', () => {
        const great = built({ score: 60, rank: 1, rankDelta: 4, isSeasonHigh: true });
        const awful = built({ score: 0, rank: 6, rankDelta: -3, weekLow: true });
        expect(great.body).toBe(awful.body);
    });

    it('falls back to a week label when the recap has none', () => {
        const p = buildRecapNoticePayload({ userId: 'u1', recap: { week: 4 } });
        expect(p.title).toBe('📖 Week 4 recap is ready');
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
