/**
 * @jest-environment jsdom
 *
 * The matchup card's labels (#639), in public/h2h-card.js and on My Team's
 * H2H tiles (public/userHome.js).
 *
 * - LIVE means one of the matchup's games is being played. It used to mean
 *   "the week is in progress", so the card said LIVE overnight and between
 *   tip-offs with neither side playing. Otherwise it reads "This week".
 * - Basketball tips off: the footer says "tip-offs Central"; football keeps
 *   "kickoffs".
 * - The separator sits on the card's true centre line, the one the expanded
 *   columns divide on. The caret on the right was unbalanced on the left, so
 *   LIVE sat ~10px left of the divider below it.
 * - My Team's Schedule tile calls the matchup already under way "Now", not
 *   "Up next".
 */

const fs = require('fs');
const path = require('path');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', 'public', f), 'utf8');
const loadCard = () => { (0, eval)(read('h2h-card.js')); return window.ccH2H; };

const BY_ID = {
    u1: { userId: 'u1', name: 'Ann T.', franchise: 'Big Mac', initials: 'AT', color: '#111' },
    u2: { userId: 'u2', name: 'Bob R.', franchise: 'Always Next Year', initials: 'BR', color: '#222' }
};
const team = (school, status, o) => Object.assign({ teamId: school.length, school, abbr: school.slice(0, 3).toUpperCase(), logo: '',
    score: status === 'final' ? 5 : null, status, kickoff: status === 'scheduled' ? '2026-11-05T01:00:00.000Z' : null,
    opp: 'OPP', ha: 'vs', gameScore: null, captain: false }, o);
// A week under way (some game has tipped): not final, not upcoming.
const inProgress = (aTeams, bTeams) => ({ aId: 'u1', bId: 'u2', aScore: 5, bScore: 0, aTeams, bTeams,
    winner: null, winP: { a: 60, b: 40 }, final: false, upcoming: false });
function render(g, opts) {
    document.body.innerHTML = loadCard().matchupCard(g, Object.assign({ byId: BY_ID }, opts));
    return document.querySelector('.h2h-mcard');
}
const sep = (c) => c.querySelector('.h2h-msep').textContent;

describe('LIVE means a game is on', () => {
    test('a game being played: LIVE', () => {
        expect(sep(render(inProgress([team('Duke', 'live')], [team('Iowa', 'scheduled')])))).toBe('LIVE');
        expect(sep(render(inProgress([team('Duke', 'final')], [team('Iowa', 'live')])))).toBe('LIVE');
    });

    test('a week under way with nothing being played: "This week", not LIVE', () => {
        const c = render(inProgress([team('Duke', 'final')], [team('Iowa', 'scheduled')]));
        expect(sep(c)).toBe('This week');
        expect(c.querySelector('.h2h-mlive')).toBeNull();
        // It is still the in-progress card: the footer says so.
        expect(c.querySelector('.h2h-mfoot').textContent).toContain('In progress');
    });

    test('liveNow reads both sides', () => {
        const { liveNow } = loadCard();
        expect(liveNow(inProgress([team('Duke', 'final')], [team('Iowa', 'live')]))).toBe(true);
        expect(liveNow(inProgress([team('Duke', 'final')], [team('Iowa', 'scheduled')]))).toBe(false);
        expect(liveNow(null)).toBe(false);
    });
});

describe('the footer says how the sport starts', () => {
    const foot = (g, sport) => render(g, { sport }).querySelector('.h2h-mfoot').textContent;
    const live = () => inProgress([team('Duke', 'live')], [team('Iowa', 'scheduled')]);
    const upcoming = () => Object.assign(inProgress([team('Duke', 'scheduled')], [team('Iowa', 'scheduled')]), { upcoming: true });

    test('basketball: tip-offs', () => {
        expect(foot(live(), 'basketball')).toContain('tip-offs Central');
        expect(foot(upcoming(), 'basketball')).toContain('tip-offs Central');
        expect(foot(live(), 'basketball')).not.toContain('kickoffs');
    });

    test('football (or no sport given): kickoffs, as before', () => {
        expect(foot(live(), 'football')).toContain('kickoffs Central');
        expect(foot(upcoming(), undefined)).toContain('kickoffs Central');
    });
});

// jsdom does no layout, so the balance is checked where it is decided: the
// markup puts a mirror on the left, and the stylesheet makes it exactly as
// wide as what it mirrors.
describe('the separator is centred', () => {
    const css = read('h2h-card.css');
    const rule = (sel) => {
        const m = css.match(new RegExp(sel.replace(/[.]/g, '\\.') + '\\s*\\{([^}]*)\\}'));
        return m ? m[1] : '';
    };
    const rem = (decl, prop) => {
        const m = decl.match(new RegExp('(?:^|;)\\s*' + prop + ':\\s*([\\d.]+)rem'));
        return m ? Number(m[1]) : null;
    };

    test('no week tag: an empty spacer as wide as the caret leads the row', () => {
        const sum = render(inProgress([team('Duke', 'live')], [team('Iowa', 'live')])).querySelector('.h2h-msum');
        expect(sum.firstElementChild.className).toBe('h2h-mpad');
        expect(sum.lastElementChild.classList.contains('h2h-mcaret')).toBe(true);
        expect(rem(rule('.h2h-mpad'), 'width')).toBe(rem(rule('.h2h-mcaret'), 'width'));
        expect(rem(rule('.h2h-mpad'), 'width')).toBeGreaterThan(0);
    });

    test('with a week tag: the caret is pushed in to the tag\'s width', () => {
        const sum = render(inProgress([team('Duke', 'live')], [team('Iowa', 'live')]), { week: 3 }).querySelector('.h2h-msum');
        expect(sum.classList.contains('wk')).toBe(true);
        expect(sum.firstElementChild.className).toBe('h2h-mwk');
        expect(sum.querySelector('.h2h-mpad')).toBeNull();
        const wk = rem(rule('.h2h-mwk'), 'width');
        expect(wk).toBeGreaterThan(0);
        expect(rem(rule('.h2h-msum.wk .h2h-mcaret'), 'margin-left') + rem(rule('.h2h-mcaret'), 'width')).toBeCloseTo(wk, 5);
    });
});

describe('My Team tiles', () => {
    const flush = async () => { for (let i = 0; i < 6; i++) await new Promise(r => setTimeout(r, 0)); };
    function loadUserHome() {
        const node = new Proxy(function () { return node; }, {
            get(t, k) { return k === 'length' ? 0 : node; }, apply() { return node; }
        });
        global.$ = window.$ = function () { return node; };
        window.ccLeague = { code: () => 'x', sport: () => 'basketball', title: (s) => s, name: () => 'L' };
        loadCard();
        (0, eval)(read('logo.js'));
        (0, eval)(read('userhome-target.js'));   // the page loads it ahead of userHome.js (#641)
        (0, eval)(read('userHome.js'));
        document.body.innerHTML = '<div id="uh-tile-matchup"><div id="uh-glance-matchup"></div></div>'
            + '<div id="uh-tile-schedule"><div id="uh-glance-schedule"></div></div>';
    }
    const managers = [{ userId: 'u1', name: 'Me', franchise: 'Me FC' }, { userId: 'u2', name: 'Opp', franchise: 'ArkyBearIllini' }];
    const payload = (aTeams, upcoming) => ({
        sport: 'basketball', managers, currentWeek: 1, featuredWeek: 1,
        schedule: [{ week: 1, final: false, upcoming, games: [Object.assign(inProgress(aTeams, [team('Iowa', 'scheduled')]),
            { aId: 'u1', bId: 'u2', upcoming })] }]
    });
    function mockFetch(body) {
        window.fetch = jest.fn((url) => Promise.resolve({
            ok: true, status: 200,
            json: () => Promise.resolve(/scoring-config/.test(url) ? { engagement: { h2hEnabled: true } } : body)
        }));
    }
    const user = { _id: 'u1', league: 'x', seasons: [{ season: 2027, teams: [], weeklyScore: [] }] };
    const label = () => document.querySelector('.uh-sched-lbl').textContent;
    const opp = () => document.querySelector('.uh-sched-opp').textContent;

    beforeEach(() => loadUserHome());
    afterEach(() => { delete window.ccH2H; delete window.ccLeague; });

    test('the matchup under way: Schedule says "Now"; LIVE only while a game is on', async () => {
        mockFetch(payload([team('Duke', 'live')], false));
        await hydrateH2H(user, '2027');
        await flush();
        expect([label(), opp()]).toEqual(['Now', 'vs ArkyBearIllini']);
        expect(document.querySelector('.uh-mug-vs').textContent).toBe('LIVE');

        loadUserHome();
        mockFetch(payload([team('Duke', 'final')], false));
        await hydrateH2H(user, '2027');
        await flush();
        expect([label(), opp()]).toEqual(['Now', 'vs ArkyBearIllini']);
        expect(document.querySelector('.uh-mug-vs').textContent).toBe('vs');
    });

    test('a week not yet started: still "Up next"', async () => {
        mockFetch(payload([team('Duke', 'scheduled')], true));
        await hydrateH2H(user, '2027');
        await flush();
        expect([label(), opp()]).toEqual(['Up next', 'vs ArkyBearIllini']);
    });
});
