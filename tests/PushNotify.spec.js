// Notification text and the rollout gate (modules/push-notify.js).
//
// Two things are worth locking down here. The wording, because a notification is
// the only surface in this app with no room to explain itself — it is one line
// on a lock screen. And the allowlist, because it is the entire safety mechanism
// for the initial deploy: if it ever fails OPEN, the whole league gets woken up
// by a feature that has not been watched through a live Saturday yet.

const push = require('../modules/push-notify');

const GAME = {
    id: 401628319,
    homeTeam: 'Georgia', awayTeam: 'Alabama',
    homeId: 61, awayId: 333
};

const withAllowlist = async (value, fn) => {
    const before = process.env.PUSH_RECIPIENT_IDS;
    process.env.PUSH_RECIPIENT_IDS = value;
    try { return await fn(); }
    finally {
        if (before === undefined) delete process.env.PUSH_RECIPIENT_IDS;
        else process.env.PUSH_RECIPIENT_IDS = before;
    }
};

describe('buildPayload — live events', () => {
    it('names the team that scored and shows the scoreline away-at-home', () => {
        const p = push.buildPayload(
            { type: 'score', side: 'home', delta: 7, homePoints: 14, awayPoints: 7, period: 2, clock: '8:31' }, GAME);
        expect(p.title).toBe('🏈 Georgia touchdown');
        expect(p.body).toBe('Alabama 7 – Georgia 14 · Q2 · 8:31');
        expect(p.url).toBe('/game/401628319');
    });

    it('names the team that took the lead', () => {
        const p = push.buildPayload(
            { type: 'leadChange', side: 'away', homePoints: 14, awayPoints: 17, period: 3, clock: '4:12' }, GAME);
        expect(p.title).toBe('⚡ Alabama takes the lead');
    });

    it('labels crunch time without naming a side', () => {
        const p = push.buildPayload(
            { type: 'closeGame', homePoints: 24, awayPoints: 21, period: 4, clock: '1:42' }, GAME);
        expect(p.title).toBe('⏰ Crunch time');
        expect(p.body).toContain('Q4 · 1:42');
    });

    // Same tag = the device replaces the banner instead of stacking one per
    // touchdown. Without it a busy game leaves six notifications on a lock screen.
    it('tags every live event with its game so banners collapse', () => {
        const score = push.buildPayload({ type: 'score', side: 'home', homePoints: 7, awayPoints: 0 }, GAME);
        const close = push.buildPayload({ type: 'closeGame', homePoints: 7, awayPoints: 0 }, GAME);
        expect(score.tag).toBe('game-401628319');
        expect(close.tag).toBe(score.tag);
    });

    // Emoji are the only visual these notifications can rely on: body text is
    // plain text, and iOS substitutes its own app icon for the `icon` slot.
    it('leads every alert type with an emoji', () => {
        const titles = [
            push.buildPayload({ type: 'score', side: 'home', delta: 7, homePoints: 7, awayPoints: 0 }, GAME).title,
            push.buildPayload({ type: 'leadChange', side: 'home', homePoints: 7, awayPoints: 0 }, GAME).title,
            push.buildPayload({ type: 'closeGame', homePoints: 7, awayPoints: 0 }, GAME).title,
            push.buildFinalPayload(Object.assign({}, GAME, { homePoints: 24, awayPoints: 21 }), 'Georgia', null).title,
            push.buildFinalPayload(Object.assign({}, GAME, { homePoints: 21, awayPoints: 24 }), 'Georgia', null).title,
            push.buildFinalPayload(Object.assign({}, GAME, { homePoints: 21, awayPoints: 21 }), 'Georgia', null).title
        ];
        titles.forEach(t => expect(t).toMatch(/^[^\w\s]/u));
    });

    it('returns nothing for an event type it does not know', () => {
        expect(push.buildPayload({ type: 'kickoff' }, GAME)).toBeNull();
    });
});

describe('scoreLabel — inferring the play from the score delta', () => {
    // CFBD gives a delta, not a play type. 7 is a touchdown with the PAT already
    // counted, 6 one whose PAT has not landed yet, 8 a two-point conversion.
    it('reads 6, 7 and 8 as touchdowns', () => {
        [6, 7, 8].forEach(d => expect(push.scoreLabel(d)).toEqual({ emoji: '🏈', verb: 'touchdown' }));
    });

    it('reads 3 as a field goal, 2 as a safety, 1 as an extra point', () => {
        expect(push.scoreLabel(3).verb).toBe('field goal');
        expect(push.scoreLabel(2).verb).toBe('safety');
        expect(push.scoreLabel(1).verb).toBe('extra point');
    });

    // Two scores inside one 10-second tick produce a delta no play can explain.
    // Falling back to "scored" keeps the alert honest rather than confidently
    // announcing a play that never happened.
    it('falls back to generic wording for a delta no single play explains', () => {
        expect(push.scoreLabel(14).verb).toBe('scored');
        expect(push.scoreLabel(undefined).verb).toBe('scored');
        expect(push.scoreLabel(0).verb).toBe('scored');
    });

    it('always supplies an emoji, whatever the delta', () => {
        [undefined, 0, 1, 2, 3, 6, 7, 8, 14, 99].forEach(d => {
            expect(push.scoreLabel(d).emoji).toBeTruthy();
        });
    });
});

describe('clockLabel', () => {
    it('renders regulation quarters and overtime', () => {
        expect(push.clockLabel(3, '4:12')).toBe('Q3 · 4:12');
        expect(push.clockLabel(5, '1:00')).toBe('OT1 · 1:00');
        expect(push.clockLabel(6, '1:00')).toBe('OT2 · 1:00');
    });

    // CFBD withholds the clock between periods. Inventing "0:00" there would put
    // a wrong time on a lock screen, which is worse than putting none.
    it('omits the clock rather than inventing one', () => {
        expect(push.clockLabel(3, null)).toBe('Q3');
        expect(push.clockLabel(null, '4:12')).toBe('');
    });
});

describe('buildFinalPayload', () => {
    // Both leagues score on WINS (modules/scoring-defaults.js), so this is the
    // only alert of the four that reports a real change to a manager's total.
    it('reports a win with the points it banked and why', () => {
        const p = push.buildFinalPayload(
            Object.assign({}, GAME, { homePoints: 24, awayPoints: 21 }),
            'Georgia',
            { matched: [{ label: 'Win' }, { label: 'Ranked Top 25' }], total: 4 });
        expect(p.title).toBe('✅ Georgia won');
        expect(p.body).toContain('+4 pts');
        expect(p.body).toContain('Win + Ranked Top 25');
    });

    it('says so plainly when a loss banked nothing', () => {
        const p = push.buildFinalPayload(
            Object.assign({}, GAME, { homePoints: 21, awayPoints: 24 }),
            'Georgia',
            { matched: [], total: 0 });
        expect(p.title).toBe('❌ Georgia lost');
        expect(p.body).toContain('No points');
    });

    it('reads the result from the rostered team, not from the home side', () => {
        const final = Object.assign({}, GAME, { homePoints: 21, awayPoints: 24 });
        expect(push.buildFinalPayload(final, 'Alabama', { matched: [], total: 3 }).title).toBe('✅ Alabama won');
        expect(push.buildFinalPayload(final, 'Georgia', { matched: [], total: 0 }).title).toBe('❌ Georgia lost');
    });

    // A breakdown we could not compute must not become a confident "+0" claim
    // about a game that was actually won.
    it('falls back to the scoreline when the breakdown is missing', () => {
        const p = push.buildFinalPayload(Object.assign({}, GAME, { homePoints: 24, awayPoints: 21 }), 'Georgia', null);
        expect(p.body).toContain('Alabama 21 – Georgia 24');
    });

    it('does not declare a winner in a tie', () => {
        const p = push.buildFinalPayload(Object.assign({}, GAME, { homePoints: 21, awayPoints: 21 }), 'Georgia', { matched: [], total: 0 });
        expect(p.title).not.toMatch(/won|lost/);
    });

    it('tags finals apart from live events so a result is not swallowed', () => {
        const final = push.buildFinalPayload(Object.assign({}, GAME, { homePoints: 24, awayPoints: 21 }), 'Georgia', null);
        const live = push.buildPayload({ type: 'score', side: 'home', homePoints: 24, awayPoints: 21 }, GAME);
        expect(final.tag).not.toBe(live.tag);
    });
});

describe('the rollout allowlist', () => {
    // FAIL CLOSED. Unset must mean "nobody", never "everybody" — this is the one
    // property protecting the league from an untested feature.
    it('allows nobody when it is unset or empty', async () => {
        await withAllowlist('', () => {
            expect(push.allowlist().size).toBe(0);
            expect(push.isAllowedRecipient('64b1f00000000000000000aa')).toBe(false);
        });
        await withAllowlist('   ', () => {
            expect(push.allowlist().size).toBe(0);
        });
    });

    it('allows exactly the ids listed, and no one else', async () => {
        await withAllowlist('64b1f00000000000000000aa', () => {
            expect(push.isAllowedRecipient('64b1f00000000000000000aa')).toBe(true);
            expect(push.isAllowedRecipient('64b1f00000000000000000bb')).toBe(false);
        });
    });

    it('tolerates whitespace and trailing commas in the env var', async () => {
        await withAllowlist(' 64b1f00000000000000000aa , 64b1f00000000000000000bb , ', () => {
            expect(push.allowlist().size).toBe(2);
            expect(push.isAllowedRecipient('64b1f00000000000000000bb')).toBe(true);
        });
    });

    it('compares ids as strings, so an ObjectId from Mongo matches', async () => {
        await withAllowlist('64b1f00000000000000000aa', () => {
            expect(push.isAllowedRecipient({ toString: () => '64b1f00000000000000000aa' })).toBe(true);
        });
    });

    // The gate is checked before any DB work, so an empty allowlist costs
    // nothing on every one of the 10-second ticks it runs on.
    it('makes notifyEvents and notifyFinals no-ops while closed', async () => {
        await withAllowlist('', async () => {
            expect(await push.notifyEvents({ 401628319: [{ type: 'score', side: 'home' }] })).toEqual({ sent: 0 });
            expect(await push.notifyFinals([401628319])).toEqual({ sent: 0 });
        });
    });
});

describe('wantsType', () => {
    it('treats unset preferences as everything on', () => {
        expect(push.wantsType({}, 'score')).toBe(true);
        expect(push.wantsType({ pushPrefs: null }, 'final')).toBe(true);
    });

    it('honours an explicit mute', () => {
        expect(push.wantsType({ pushPrefs: { score: false } }, 'score')).toBe(false);
        expect(push.wantsType({ pushPrefs: { score: false } }, 'final')).toBe(true);
    });
});
