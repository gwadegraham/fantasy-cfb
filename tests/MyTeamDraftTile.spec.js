/**
 * @jest-environment jsdom
 *
 * My Team's Draft grade tile (public/userHome.js), #636.
 *
 * On basketball's opening day a new player saw "496 PROJ PTS" here and
 * "0 → 611" on Standings → Projected Finish for the same team, with nothing
 * saying why. They are different numbers on purpose: the grade is the roster
 * as drafted (frozen inputs, base scoring), Projected Finish is banked plus
 * remaining on today's inputs with Captain and H2H projected forward. The tile
 * now labels its own stats and quotes the live number with what it adds.
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
    (0, eval)(read('userHome.js'));
});

const user = { _id: 'u1', league: 'gghoops', seasons: [{ season: 2027 }] };
const grade = {
    sport: 'basketball',
    managers: [{ userId: 'u1', grade: 'B+', projPoints: 496, projWins: 18.2, ncaaCount: 4.5 }]
};

function mockFetch(projections) {
    window.fetch = jest.fn((url) => Promise.resolve({
        json: () => Promise.resolve(url.indexOf('/draft/grades/') === 0 ? grade : projections)
    }));
}

async function hydrate(projections, { own = true } = {}) {
    window.localStorage.setItem('userId', own ? 'u1' : 'someone-else');
    document.body.innerHTML = '<div id="uh-tile-draft"><div id="uh-glance-draft"></div></div>';
    mockFetch(projections);
    await hydrateDraft(user, 2027);
    await flush();
    return document.getElementById('uh-glance-draft');
}
const stats = (g) => Array.from(g.querySelectorAll('.uh-ds')).map(s => s.textContent);
const live = () => document.getElementById('uh-draft-live');

test('each stat says what it counts', async () => {
    const g = await hydrate({ managers: [] });
    expect(stats(g)).toEqual(['496pts from your draft', '18.2avg wins per team', '4–5teams in the NCAA field']);
});

test('quotes the live Projected Finish number and the bonuses it adds', async () => {
    await hydrate({ managers: [
        { userId: 'u2', projectedFinal: 700, expCaptain: 40, expH2H: 30 },
        { userId: 'u1', projectedFinal: 611, expCaptain: 48.2, expH2H: 21.5 }
    ] });
    expect(live().hidden).toBe(false);
    expect(live().textContent).toBe('Your full projection is 611 with Captain and head-to-head bonuses, updated as games are played');
});

test('a league without the modes names no bonuses', async () => {
    await hydrate({ managers: [{ userId: 'u1', projectedFinal: 530, expCaptain: 0, expH2H: 0 }] });
    expect(live().textContent).toBe('Your full projection is 530, updated as games are played');
});

test("someone else's team reads as theirs", async () => {
    const g = await hydrate({ managers: [{ userId: 'u1', projectedFinal: 611, expCaptain: 48, expH2H: 0 }] }, { own: false });
    expect(stats(g)[0]).toBe('496pts from their draft');
    expect(live().textContent).toBe('Their full projection is 611 with Captain bonuses, updated as games are played');
});

test('the line stays hidden when there is no live number', async () => {
    await hydrate({ managers: [] });   // season over: the route returns no rows
    expect(live().hidden).toBe(true);
    expect(live().textContent).toBe('');
});

test('whole-number field counts stay whole', () => {
    expect(uhFieldRange(3)).toBe('3');
    expect(uhFieldRange(0.3)).toBe('0–1');
    expect(uhFieldRange(4.5)).toBe('4–5');
});
