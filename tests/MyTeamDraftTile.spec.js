/**
 * @jest-environment jsdom
 *
 * My Team's Draft grade tile (public/userHome.js), #636.
 *
 * On basketball's opening day a new player saw "496 PROJ PTS" here and
 * "0 → 611" on Standings → Projected Finish for the same team, with nothing
 * saying why. They are different numbers on purpose: the grade is the roster
 * as drafted with base scoring, Projected Finish is banked plus remaining with
 * Captain and H2H projected forward. The tile now labels its own stats and
 * quotes the live number with the bonus modes the league has on.
 */

const fs = require('fs');
const path = require('path');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', 'public', f), 'utf8');
const flush = async () => { for (let i = 0; i < 6; i++) await new Promise(r => setTimeout(r, 0)); };

beforeAll(() => {
    const node = new Proxy(function () { return node; }, {
        get(t, k) { return k === 'length' ? 0 : node; }, apply() { return node; }
    });
    global.$ = window.$ = function () { return node; };
    (0, eval)(read('draftGrades.js'));   // the page loads it ahead of userHome.js
    (0, eval)(read('userHome.js'));
});

const hoopsUser = { _id: 'u1', league: 'gghoops', seasons: [{ season: 2027 }] };
const hoopsGrade = {
    sport: 'basketball',
    managers: [{ userId: 'u1', grade: 'B+', projPoints: 496, projWins: 18.2, ncaaCount: 4.5 }]
};
const BOTH = { captainEnabled: true, h2hEnabled: true };

const ok = (body) => Promise.resolve({ ok: true, json: () => Promise.resolve(body) });

// Answers only the exact URLs the tile should call; anything else rejects, so
// a wrong URL fails the test instead of quietly getting the grade back.
// `projections` may be a body or a function returning the fetch result.
function mockFetch({ user, grade, engagement, projections }) {
    const season = 2027;
    const routes = {
        [`/draft/grades/${user.league}/${season}`]: () => ok(grade),
        [`/scoring-config/${user.league}?season=${season}`]: () => ok({ engagement }),
        [`/standings/projections/${user.league}/${season}`]: () =>
            (typeof projections === 'function' ? projections() : ok(projections))
    };
    window.fetch = jest.fn((url) => {
        if (routes[url]) return routes[url]();
        // The page's own boot (window.onload → /profile) fires once under
        // jsdom; leave it pending rather than fail an unrelated test.
        if (url === '/profile') return new Promise(() => {});
        return Promise.reject(new Error('unexpected ' + url));
    });
}

async function hydrate({ user = hoopsUser, grade = hoopsGrade, engagement = BOTH, projections = { managers: [] },
    own = true, live } = {}) {
    window.localStorage.setItem('userId', own ? 'u1' : 'someone-else');
    document.body.innerHTML = '<div id="uh-tile-draft"><div id="uh-glance-draft"></div></div>';
    mockFetch({ user, grade, engagement, projections });
    await hydrateDraft(user, 2027, live === undefined ? undefined : { live });
    await flush();
    return document.getElementById('uh-glance-draft');
}
const stats = (g) => Array.from(g.querySelectorAll('.uh-ds')).map(s => s.textContent);
const live = () => document.getElementById('uh-draft-live');
const projectionsCalled = () => window.fetch.mock.calls.some(([u]) => u.indexOf('/standings/projections/') === 0);
const drawerNote = () => {
    const body = document.createElement('div');
    uhDrawer.draft(body);
    return body.querySelector('.grades-note').textContent;
};

test('each stat says what it counts', async () => {
    const g = await hydrate();
    expect(stats(g)).toEqual(['496pts from your draft', '18.2avg wins per team', '~4.5expected in the NCAA field']);
});

test('a football grade counts the CFP', async () => {
    const g = await hydrate({
        user: { _id: 'u1', league: 'gg', seasons: [{ season: 2027 }] },
        grade: { managers: [{ userId: 'u1', grade: 'B', projPoints: 610, projWins: 8.1, cfpCount: 2 }] }
    });
    expect(stats(g)[2]).toBe('2expected in the CFP');
});

test('quotes the live Projected Finish number and the modes the league has on', async () => {
    await hydrate({ projections: { managers: [
        { userId: 'u2', projectedFinal: 700, expCaptain: 40, expH2H: 30 },
        { userId: 'u1', projectedFinal: 611, expCaptain: 48.2, expH2H: 21.5 }
    ] } });
    expect(live().hidden).toBe(false);
    expect(live().textContent).toBe('Your full projection is 611 with Captain and head-to-head bonuses, updated as games are played');
});

// projectedFinal includes banked points that already carry past bonuses, so
// a forward term of 0 late in a season must not drop the mode from the line.
test('modes come from the league settings, not the forward terms', async () => {
    await hydrate({ projections: { managers: [{ userId: 'u1', projectedFinal: 980, expCaptain: 0, expH2H: 0 }] } });
    expect(live().textContent).toBe('Your full projection is 980 with Captain and head-to-head bonuses, updated as games are played');
});

test('a classic league names no bonuses, on the tile or in the drawer', async () => {
    await hydrate({ engagement: { captainEnabled: false, h2hEnabled: false },
        projections: { managers: [{ userId: 'u1', projectedFinal: 530 }] } });
    expect(live().textContent).toBe('Your full projection is 530, updated as games are played');
    expect(drawerNote()).not.toMatch(/bonus|Captain|head-to-head/);
});

test('the drawer note names only the modes that are on', async () => {
    await hydrate({ engagement: { captainEnabled: true, h2hEnabled: false } });
    expect(drawerNote()).toContain('before Captain bonuses.');
    expect(drawerNote()).not.toContain('head-to-head');
});

test("someone else's team reads as theirs", async () => {
    const g = await hydrate({ own: false, engagement: { captainEnabled: true },
        projections: { managers: [{ userId: 'u1', projectedFinal: 611 }] } });
    expect(stats(g)[0]).toBe('496pts from their draft');
    expect(live().textContent).toBe('Their full projection is 611 with Captain bonuses, updated as games are played');
});

describe('the line stays hidden when there is no live number', () => {
    test.each([
        ['no row for this team', () => ok({ managers: [] })],
        ['the fetch rejects', () => Promise.reject(new Error('offline'))],
        ['a 500', () => Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({ message: 'boom' }) })],
        ['non-JSON', () => Promise.resolve({ ok: true, json: () => Promise.reject(new SyntaxError('Unexpected token <')) })]
    ])('%s', async (_, projections) => {
        const g = await hydrate({ projections });
        expect(live().hidden).toBe(true);
        expect(live().textContent).toBe('');
        expect(stats(g)).toHaveLength(3);   // the grade itself still shows
    });
});

test('a past season does not ask for a live projection', async () => {
    await hydrate({ live: false, projections: { managers: [{ userId: 'u1', projectedFinal: 611 }] } });
    expect(projectionsCalled()).toBe(false);
    expect(live().hidden).toBe(true);
});
