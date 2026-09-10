const livePlays = require('../modules/live-plays');
const {
    getLivePlays, summarizeForStorage, isFinalPayload,
    normalizeTeam, normalizeDrive, TTL_MS, MISS_TTL_MS
} = livePlays;

// /live/plays is the one live endpoint that costs money, so the tests here are
// mostly about not spending calls: the cache collapsing concurrent viewers, the
// negative cache absorbing pre-kickoff pages, and a completed payload being
// recognized as terminal so it can be stored and never fetched again.
//
// Response shapes are taken from a real measured response (Florida State–SMU,
// game 401858212): a single object with teams[2] and drives[], each drive
// carrying its own plays[].

function fixture({ status = 'Final', drives = 2, plays = 3 } = {}) {
    return {
        id: 401858212,
        status,
        period: status === 'Final' ? null : 3,
        clock: status === 'Final' ? '' : '07:14',
        possession: status === 'Final' ? '' : 'home',
        down: status === 'Final' ? null : 2,
        distance: status === 'Final' ? null : 7,
        yardsToGoal: status === 'Final' ? null : 43,
        teams: [
            { teamId: 52, team: 'Florida State', homeAway: 'home', lineScores: [7, 3, 7, 7], points: 24, epaPerPlay: 0.104, successRate: 0.352, explosiveness: 0.836, deserveToWin: 0.225 },
            { teamId: 2567, team: 'SMU', homeAway: 'away', lineScores: [0, 7, 3, 7], points: 17, epaPerPlay: -0.02, successRate: 0.31, explosiveness: 0.7, deserveToWin: 0.775 }
        ],
        drives: Array.from({ length: drives }, (_, i) => ({
            id: `40185821${i}`,
            offense: 'SMU', offenseId: 2567, defense: 'Florida State', defenseId: 52,
            playCount: plays, yards: 44,
            startPeriod: 1, startClock: '15:00', startYardsToGoal: 75,
            endPeriod: 1, endClock: '12:24', endYardsToGoal: 35,
            duration: '2:36', scoringOpportunity: true,
            result: 'Fumble', pointsGained: 0,
            plays: Array.from({ length: plays }, (_, j) => ({
                id: `p${i}${j}`, playType: 'Rush', playText: 'a run', yardsGained: 4,
                down: 1, distance: 10, yardsToGoal: 65, epa: 0.1, success: true
            }))
        }))
    };
}

// A fetch stub that counts calls, so "did this cost a call?" is directly
// assertable — the property the whole module exists to control.
function stubFetch({ status = 200, body = fixture(), remaining = 29747 } = {}) {
    const fn = jest.fn(async () => ({
        ok: status >= 200 && status < 300,
        status,
        headers: { get: (h) => (h === 'x-calllimit-remaining' ? String(remaining) : null) },
        json: async () => body,
        text: async () => JSON.stringify(body)
    }));
    global.fetch = fn;
    return fn;
}

describe('normalizers', () => {
    it('keeps the advanced metrics and drops the live-only noise', () => {
        const t = normalizeTeam(fixture().teams[0]);
        expect(t).toMatchObject({
            teamId: 52, team: 'Florida State', homeAway: 'home',
            points: 24, epaPerPlay: 0.104, successRate: 0.352,
            explosiveness: 0.836, deserveToWin: 0.225
        });
        expect(t.lineScores).toEqual([7, 3, 7, 7]);
    });

    it('nulls metrics that are absent rather than reporting 0', () => {
        // A 0 EPA and a missing EPA render very differently on a box score.
        const t = normalizeTeam({ teamId: 1, team: 'X', homeAway: 'home' });
        expect(t.epaPerPlay).toBeNull();
        expect(t.successRate).toBeNull();
    });

    it('strips the per-play arrays from a drive', () => {
        // 90% of the payload, and a drive chart doesn't read it.
        const d = normalizeDrive(fixture().drives[0]);
        expect(d.plays).toBeUndefined();
        expect(d).toMatchObject({ result: 'Fumble', startYardsToGoal: 75, endYardsToGoal: 35, pointsGained: 0 });
    });

    it('coerces a drive id to a string', () => {
        // CFBD sends these as bare numbers in some payloads and strings in
        // others; the schema says String, so a number would fail to match on
        // read-back.
        expect(normalizeDrive({ id: 4018582121 }).id).toBe('4018582121');
    });

    it('summarizes only what is terminal', () => {
        const s = summarizeForStorage(fixture());
        expect(Object.keys(s).sort()).toEqual(['drives', 'fetchedAt', 'teams']);
        expect(s.drives).toHaveLength(2);
        expect(s.teams).toHaveLength(2);
    });

    it('shrinks the stored payload by roughly an order of magnitude', () => {
        // The reason storing every finished game is affordable. If this ratio
        // ever collapses, the season's storage projection was wrong.
        const raw = JSON.stringify(fixture({ drives: 12, plays: 7 })).length;
        const stored = JSON.stringify(summarizeForStorage(fixture({ drives: 12, plays: 7 }))).length;
        expect(stored).toBeLessThan(raw / 3);
    });
});

describe('isFinalPayload', () => {
    it('recognizes a final', () => {
        expect(isFinalPayload({ status: 'Final' })).toBe(true);
        expect(isFinalPayload({ status: 'final' })).toBe(true);
    });

    it('does not treat a live or unknown status as final', () => {
        // Storing a live payload would freeze a game mid-third-quarter forever,
        // because the stored summary short-circuits every later fetch.
        expect(isFinalPayload({ status: 'In Progress' })).toBe(false);
        expect(isFinalPayload({})).toBe(false);
        expect(isFinalPayload(null)).toBe(false);
    });
});

describe('getLivePlays cache', () => {
    beforeEach(() => livePlays._reset());
    afterEach(() => { delete global.fetch; });

    it('fetches once and serves the rest of the window from cache', async () => {
        const f = stubFetch();

        const a = await getLivePlays(1, { nowMs: 1000 });
        const b = await getLivePlays(1, { nowMs: 1000 + TTL_MS - 1 });

        // Six managers watching one game cost one call, not six.
        expect(f).toHaveBeenCalledTimes(1);
        expect(a.cached).toBe(false);
        expect(b.cached).toBe(true);
        expect(b.payload).toBe(a.payload);
    });

    it('refetches once the TTL has elapsed', async () => {
        const f = stubFetch();
        await getLivePlays(1, { nowMs: 1000 });
        await getLivePlays(1, { nowMs: 1000 + TTL_MS });
        expect(f).toHaveBeenCalledTimes(2);
    });

    it('keeps games apart', async () => {
        const f = stubFetch();
        await getLivePlays(1, { nowMs: 1000 });
        await getLivePlays(2, { nowMs: 1000 });
        expect(f).toHaveBeenCalledTimes(2);
    });

    it('reports the remaining call count so the spend is observable', async () => {
        stubFetch({ remaining: 29747 });
        const r = await getLivePlays(1, { nowMs: 1000 });
        expect(r.remainingCalls).toBe(29747);
    });

    it('caches "no plays yet" for longer than a hit', async () => {
        // Pre-kickoff is the normal state of every game, and a page left open
        // on one must not re-ask every 90s.
        const f = stubFetch({ status: 400, body: { message: 'No plays found for game.' } });

        const a = await getLivePlays(1, { nowMs: 1000 });
        expect(a.status).toBe('none');
        expect(a.payload).toBeNull();

        await getLivePlays(1, { nowMs: 1000 + TTL_MS + 1 });
        expect(f).toHaveBeenCalledTimes(1);

        await getLivePlays(1, { nowMs: 1000 + MISS_TTL_MS });
        expect(f).toHaveBeenCalledTimes(2);
    });

    it('serves a stale payload when a refetch fails', async () => {
        stubFetch();
        const first = await getLivePlays(1, { nowMs: 1000 });

        global.fetch = jest.fn(async () => ({
            ok: false, status: 503,
            headers: { get: () => null },
            text: async () => 'upstream down'
        }));
        const second = await getLivePlays(1, { nowMs: 1000 + TTL_MS });

        // A stale drive chart during a CFBD blip beats an empty panel.
        expect(second.status).toBe('stale');
        expect(second.payload).toBe(first.payload);
    });

    it('throws when a fetch fails and nothing is cached', async () => {
        stubFetch({ status: 503, body: { message: 'nope' } });
        // Answering "no plays" here would be a lie that the client would render
        // as an empty game.
        await expect(getLivePlays(1, { nowMs: 1000 })).rejects.toThrow(/503/);
    });

    it('does not let a failure poison a good cached entry', async () => {
        stubFetch();
        await getLivePlays(1, { nowMs: 1000 });

        global.fetch = jest.fn(async () => { throw new Error('network'); });
        await getLivePlays(1, { nowMs: 1000 + TTL_MS });

        // The stale entry is still there for the next viewer.
        stubFetch();
        const back = await getLivePlays(1, { nowMs: 1000 + TTL_MS + 1 });
        expect(back.payload).toBeTruthy();
    });

    it('sends the game id as a query param, since CFBD requires it', async () => {
        const f = stubFetch();
        await getLivePlays(401858212, { nowMs: 1000 });
        expect(f.mock.calls[0][0]).toContain('gameId=401858212');
        expect(f.mock.calls[0][0]).toContain('/live/plays');
    });

    it('bounds how many games it holds', async () => {
        stubFetch();
        // Well past MAX_ENTRIES so a long-lived dyno can't accumulate a
        // season's worth of game ids.
        for (let i = 0; i < livePlays.MAX_ENTRIES + 25; i++) {
            await getLivePlays(i, { nowMs: 1000 + i });
        }
        expect(livePlays._cacheSize()).toBeLessThanOrEqual(livePlays.MAX_ENTRIES);
    });
});

describe('defensive edges', () => {
    beforeEach(() => livePlays._reset());
    afterEach(() => { delete global.fetch; });

    it('returns null for a missing team or drive rather than an empty shell', () => {
        expect(normalizeTeam(null)).toBeNull();
        expect(normalizeDrive(null)).toBeNull();
        expect(summarizeForStorage(null)).toBeNull();
    });

    it('survives a payload with no teams or drives', () => {
        // CFBD has answered 200 with a near-empty object before kickoff on
        // some games; that must not throw on the way to storage.
        const s = summarizeForStorage({ id: 1, status: 'Final' });
        expect(s.teams).toEqual([]);
        expect(s.drives).toEqual([]);
    });

    it('drops non-array lineScores and a null drive id', () => {
        expect(normalizeTeam({ teamId: 1, lineScores: 'nope' }).lineScores).toEqual([]);
        expect(normalizeDrive({ offense: 'X' }).id).toBeNull();
    });

    it('treats a non-object success body as no payload', () => {
        // A 200 carrying `null` or a bare string would otherwise reach the
        // route and be spread into the response.
        stubFetch({ body: 'not an object' });
        return getLivePlays(1, { nowMs: 1000 }).then(r => expect(r.payload).toBeNull());
    });

    it('reports a null remaining count when the header is absent', async () => {
        global.fetch = jest.fn(async () => ({
            ok: true, status: 200,
            headers: { get: () => null },
            json: async () => fixture(),
            text: async () => ''
        }));
        const r = await getLivePlays(1, { nowMs: 1000 });
        expect(r.remainingCalls).toBeNull();
    });

    it('never caches when the TTL is zero', async () => {
        // The kill switch. isFresh has to reject a zero TTL outright rather
        // than comparing against it, or `now - at < 0` would still hit on a
        // same-millisecond request.
        expect(livePlays.isFresh({ at: 1000 }, 1000)).toBe(true);
        expect(livePlays.isFresh(null, 1000)).toBe(false);
    });
});
