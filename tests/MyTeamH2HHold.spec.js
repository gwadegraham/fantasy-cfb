/**
 * @jest-environment jsdom
 *
 * My Team's H2H tiles over a football weekend.
 *
 * Week 8 settles overnight Saturday, so the server's `currentWeek` moves to 9
 * while people are still reading week 8's result on Sunday. /standings/h2h
 * holds `featuredWeek` on 8 until Monday 07:00 CT. The MATCHUP tile follows
 * that hold; the SCHEDULE tile's "Up next" must not — next week's opponent is
 * still who's up next. The first version of this fix read featuredWeek for
 * both, and the schedule tile said "Up next · vs" last week's opponent.
 */

const fs = require('fs');
const path = require('path');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', 'public', f), 'utf8');
const flush = async () => { for (let i = 0; i < 6; i++) await new Promise(r => setTimeout(r, 0)); };

function loadUserHome() {
    const node = new Proxy(function () { return node; }, {
        get(t, k) { return k === 'length' ? 0 : node; }, apply() { return node; }
    });
    global.$ = window.$ = function () { return node; };
    window.ccLeague = { code: () => 'x', sport: () => 'football', title: (s) => s, name: () => 'L' };
    window.ccH2H = { matchupCard: () => '', wire: () => {}, avatar: () => '' };
    (0, eval)(read('logo.js'));
    (0, eval)(read('userHome.js'));
    document.body.innerHTML = '<div id="uh-tile-matchup"><div id="uh-glance-matchup"></div></div>'
        + '<div id="uh-tile-schedule"><div id="uh-glance-schedule"></div></div>';
}

const managers = [
    { userId: 'u1', name: 'Me', franchise: 'Me FC' },
    { userId: 'u2', name: 'Last', franchise: 'Last Week Opp' },
    { userId: 'u3', name: 'Next', franchise: 'Next Week Opp' }
];
const week = (w, opp, extra) => Object.assign({ week: w, games: [{ aId: 'u1', bId: opp, aScore: 0, bScore: 0 }] }, extra);

function payload(featuredWeek) {
    return {
        managers, currentWeek: 9, featuredWeek,
        schedule: [
            week(8, 'u2', { final: true, upcoming: false, games: [{ aId: 'u1', bId: 'u2', aScore: 41, bScore: 30, winner: 'a' }] }),
            week(9, 'u3', { final: false, upcoming: true })
        ]
    };
}

function mockFetch(body) {
    window.fetch = jest.fn((url) => Promise.resolve({
        ok: true, status: 200,
        json: () => Promise.resolve(/scoring-config/.test(url) ? { engagement: { h2hEnabled: true } } : body)
    }));
}

const user = { _id: 'u1', league: 'graham-league', seasons: [{ season: 2026, teams: [], weeklyScore: [] }] };
const text = (id) => document.getElementById(id).textContent.replace(/\s+/g, ' ');

beforeEach(() => loadUserHome());
afterEach(() => { delete window.ccH2H; delete window.ccLeague; });

test('during the hold: matchup tile shows the finished week, Up next still names next week', async () => {
    mockFetch(payload(8));
    await hydrateH2H(user, '2026');
    await flush();
    expect(text('uh-glance-matchup')).toContain('Last Week Opp');
    expect(text('uh-glance-matchup')).toContain('41');
    expect(text('uh-glance-schedule')).toContain('Up next');
    expect(text('uh-glance-schedule')).toContain('Next Week Opp');
});

test('after Monday 07:00 (featuredWeek = currentWeek): both tiles are on next week', async () => {
    mockFetch(payload(9));
    await hydrateH2H(user, '2026');
    await flush();
    expect(text('uh-glance-matchup')).toContain('Next Week Opp');
    expect(text('uh-glance-schedule')).toContain('Next Week Opp');
});
