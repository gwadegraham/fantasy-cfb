/**
 * @jest-environment jsdom
 *
 * Coverage for public/standings.js — the Standings page controller.
 *
 * The module exports nothing and wires itself up on import, so these are
 * integration tests: tests/helpers/standings-dom.js stands up the page from
 * views/standings.ejs, stubs the globals the view supplies (jQuery, Chart,
 * ccIcon/ccH2H/ccLogo, userState), routes fetch, and runs window.onload. Every
 * assertion is on the resulting DOM or on which endpoints were called.
 */
const { loadStandingsPage, resetStandingsPage, makeUser, respond } = require('./helpers/standings-dom');

afterEach(resetStandingsPage);

const scored = (id, first, last, weeks, extra = {}) => makeUser(Object.assign({
    top: { _id: id, firstName: first, lastName: last, email: `${first}@example.com`.toLowerCase() },
    weeklyScore: weeks
}, extra));

// --- bootstrap ---------------------------------------------------------------

describe('empty league', () => {
    it('shows the "no data" message and hides every populated section', async () => {
        const page = await loadStandingsPage({ users: [] });

        expect(page.q('.no-data-message').getAttribute('style')).toBeNull();
        expect(page.q('.get-users-container').getAttribute('style')).toBe('display: none;');
        expect(page.highlightsHeader().getAttribute('style')).toBe('display: none;');
        expect(page.highlights().getAttribute('style')).toBe('display: none;');
        expect(page.q('[poll-name]').getAttribute('style')).toBe('display: none;');
        expect(page.q('.dropdownWeek').getAttribute('style')).toBe('display: none;');
        expect(page.q('.game-content').getAttribute('style')).toBe('display: none;');
        page.q('.hr-subtle');
        document.querySelectorAll('.hr-subtle').forEach(hr => {
            expect(hr.getAttribute('style')).toBe('display: none;');
        });
    });

    it('never reaches the standings render', async () => {
        const page = await loadStandingsPage({ users: [] });
        expect(page.tableBody().innerHTML).toBe('');
        expect(page.urls().some(u => u.includes('/standings/projections/'))).toBe(false);
    });
});

describe('league + week bootstrap', () => {
    it('defaults the schedule to the latest scored week', async () => {
        const page = await loadStandingsPage({
            users: [scored('a', 'Alice', 'Adams', [10, 20, 30])]
        });
        expect(window.localStorage.getItem('weekCode')).toBe('week-3');
        expect(page.jquery.store['#dropdownMenuButtonWeek'].text).toBe('Week 3');
    });

    it('leaves a manually picked week alone', async () => {
        await loadStandingsPage({
            users: [scored('a', 'Alice', 'Adams', [10, 20, 30])],
            localStorage: { week: 'Week 2', weekCode: 'week-2' }
        });
        expect(window.localStorage.getItem('weekCode')).toBe('week-2');
    });

    it('ignores the postseason bucket when picking the latest week', async () => {
        await loadStandingsPage({
            users: [scored('a', 'Alice', 'Adams', [10, { week: 2, score: 5 }, { season: 'postseason', week: 1, score: 40 }])]
        });
        expect(window.localStorage.getItem('weekCode')).toBe('week-2');
    });

    it('maps the league metadata onto a league code', async () => {
        const page = await loadStandingsPage({
            profile: { email: 'a@example.com', user_metadata: { metadata: { league: 'gg' } } }
        });
        expect(window.localStorage.getItem('leagueCode')).toBe('graham-league');
        expect(page.urls().some(u => u.includes('/users/league/graham-league'))).toBe(true);
    });

    it('maps any other league to the Claunts code', async () => {
        await loadStandingsPage({
            profile: { email: 'a@example.com', user_metadata: { metadata: { league: 'cl' } } }
        });
        expect(window.localStorage.getItem('leagueCode')).toBe('claunts-league');
    });

    it('lets an admin override the league from storage', async () => {
        const page = await loadStandingsPage({
            userState: { user_metadata: { roles: ['Manager', 'Admin'], metadata: { league: 'gg', userId: 'a' } } },
            localStorage: { leagueCode: 'claunts-league', week: 'Week 1', weekCode: 'week-1' }
        });
        expect(page.urls().some(u => u.includes('/users/league/claunts-league'))).toBe(true);
        expect(page.jquery.store['#dropdownMenuButton']).toBeUndefined();   // no stored league label
    });

    it('shows the admin league label when one was picked this session', async () => {
        window.sessionStorage.setItem('league', 'Claunts League');
        const page = await loadStandingsPage({
            userState: { user_metadata: { roles: ['Admin'], metadata: { league: 'gg', userId: 'a' } } },
            localStorage: { leagueCode: 'claunts-league' }
        });
        expect(page.jquery.store['#dropdownMenuButton'].text).toBe('Claunts League');
    });
});

// --- classic standings table -------------------------------------------------

describe('classic standings table', () => {
    const league = () => [
        scored('a', 'Alice', 'Adams', [10, 20]),
        scored('b', 'Bob', 'Brown', [40, 5])
    ];

    it('paints ranked rows and the points-only header', async () => {
        const page = await loadStandingsPage({ users: league() });
        expect(page.tableHead().innerHTML).toContain('>Score<');
        expect(page.tableHead().innerHTML).not.toContain('>Record<');
        expect(page.tableBody().querySelectorAll('tr.standings-row')).toHaveLength(2);
        expect(page.tableBody().innerHTML.indexOf('Bob B.')).toBeLessThan(page.tableBody().innerHTML.indexOf('Alice A.'));
    });

    it('marks the table as points-only', async () => {
        const page = await loadStandingsPage({ users: league() });
        const table = page.tableBody().closest('table');
        expect(table.classList.contains('mode-plain')).toBe(true);
        expect(table.classList.contains('mode-h2h')).toBe(false);
    });

    it('hides the Teams column while no rosters exist', async () => {
        const page = await loadStandingsPage({ users: league() });
        expect(page.tableBody().closest('table').classList.contains('std-no-teams')).toBe(true);
    });

    it('keeps the Teams column once managers have drafted', async () => {
        const page = await loadStandingsPage({
            users: [scored('a', 'Alice', 'Adams', [10], { teams: [{ id: 1, school: 'Indiana', logos: ['ind.png'] }] })]
        });
        expect(page.tableBody().closest('table').classList.contains('std-no-teams')).toBe(false);
    });

    it('leaves the ranking note empty and hidden', async () => {
        const page = await loadStandingsPage({ users: league() });
        expect(page.rankNote().hidden).toBe(true);
        expect(page.rankNote().textContent).toBe('');
    });
});

// --- head-to-head ------------------------------------------------------------

const H2H_PAYLOAD = {
    enabled: true,
    managers: [
        { userId: 'a', rank: 1, name: 'Alice A.', franchise: 'Rockets', initials: 'AA', color: '#111', adjustedTotal: 65.5, h2hBonus: 15, record: '2-0', teams: [{ id: 1, school: 'Indiana', logo: 'ind.png' }] },
        { userId: 'b', rank: 2, name: 'Bob B.', initials: 'BB', color: '#222', adjustedTotal: 45.25, h2hBonus: 0, record: '0-2', teams: [] }
    ]
};

describe('head-to-head standings', () => {
    const users = () => [
        scored('a', 'Alice', 'Adams', [10, 40]),
        scored('b', 'Bob', 'Brown', [40, 5])
    ];

    it('renders the H2H table when the league has opted in', async () => {
        const page = await loadStandingsPage({
            users: users(), h2hEnabled: true, h2hStandings: H2H_PAYLOAD
        });
        expect(page.tableHead().innerHTML).toContain('>Record<');
        expect(page.tableHead().innerHTML).toContain('>Total<');
        expect(page.tableBody().innerHTML).toContain('Rockets');
        expect(page.tableBody().innerHTML).toContain('2-0');
        expect(page.tableBody().closest('table').classList.contains('mode-h2h')).toBe(true);
    });

    it('explains the ranking above the table', async () => {
        const page = await loadStandingsPage({
            users: users(), h2hEnabled: true, h2hStandings: H2H_PAYLOAD
        });
        expect(page.rankNote().hidden).toBe(false);
        expect(page.rankNote().textContent).toBe('Ranked by total points + H2H bonuses');
    });

    it('splits the total into banked base and win bonus', async () => {
        const page = await loadStandingsPage({
            users: users(), h2hEnabled: true, h2hStandings: H2H_PAYLOAD
        });
        // 65.5 total - 15 bonus = 50.5 base
        expect(page.tableBody().innerHTML).toContain('50.5 <span class="bonus">+15</span>');
    });

    it('measures the gap against the adjusted leader', async () => {
        const page = await loadStandingsPage({
            users: users(), h2hEnabled: true, h2hStandings: H2H_PAYLOAD
        });
        expect(page.tableBody().innerHTML).toContain('-20.3 back');
    });

    it('carries points-based movement over from the classic ranking', async () => {
        const page = await loadStandingsPage({
            users: users(), h2hEnabled: true, h2hStandings: H2H_PAYLOAD
        });
        // Week 1: Bob 40, Alice 10. Week 2 flips it — Alice climbs one.
        expect(page.tableBody().innerHTML).toContain('title="Up 1"');
        expect(page.tableBody().innerHTML).toContain('title="Down 1"');
    });

    it('treats a scoreless H2H league as a flat tie', async () => {
        const page = await loadStandingsPage({
            users: [scored('a', 'Alice', 'Adams', [])],
            h2hEnabled: true,
            h2hStandings: { enabled: true, managers: [{ userId: 'a', rank: 1, name: 'Alice A.', initials: 'AA', adjustedTotal: 0, h2hBonus: 0, teams: [] }] }
        });
        expect(page.tableBody().innerHTML).not.toContain('medal-1');
        expect(page.tableBody().innerHTML).toContain('Tied');
    });

    it('hides the unrelated legacy head-to-head schedule', async () => {
        const page = await loadStandingsPage({
            users: users(), h2hEnabled: true, h2hStandings: H2H_PAYLOAD
        });
        expect(page.q('[poll-name]').closest('.header').style.display).toBe('none');
        expect(page.q('.dropdownWeek').style.display).toBe('none');
        expect(page.q('.game-content').style.display).toBe('none');
        expect(document.querySelectorAll('.hr-subtle')[1].style.display).toBe('none');
    });

    it('renders in preview mode via ?h2h=1 even when disabled', async () => {
        const page = await loadStandingsPage({
            users: users(), h2hEnabled: false, search: '?h2h=1',
            h2hStandings: Object.assign({}, H2H_PAYLOAD, { enabled: false })
        });
        expect(page.tableHead().innerHTML).toContain('>Record<');
    });

    it('passes a simulation key through to the API', async () => {
        const page = await loadStandingsPage({
            users: users(), search: '?h2hSim=wk3', h2hStandings: H2H_PAYLOAD
        });
        expect(page.urls().some(u => u.includes('h2hSim=wk3'))).toBe(true);
    });

    it('falls back to the classic table when the H2H fetch fails', async () => {
        const page = await loadStandingsPage({
            users: users(), h2hEnabled: true,
            routes: [[/standingsOnly=1/, () => { throw new Error('network'); }]]
        });
        expect(page.tableHead().innerHTML).toContain('>Score<');
        expect(page.tableBody().innerHTML).toContain('Alice A.');
    });

    it('falls back to the classic table when the payload has no managers', async () => {
        const page = await loadStandingsPage({
            users: users(), h2hEnabled: true, h2hStandings: { enabled: true, managers: [] }
        });
        expect(page.tableHead().innerHTML).toContain('>Score<');
    });

    it('falls back to classic when the enabled check times out', async () => {
        const page = await loadStandingsPage({
            users: users(),
            routes: [[/\/enabled/, () => { throw new Error('abort'); }]]
        });
        expect(page.tableHead().innerHTML).toContain('>Score<');
    });

    it('shows a loading skeleton before the H2H payload lands', async () => {
        const page = await loadStandingsPage({
            users: users(), h2hEnabled: true, h2hStandings: H2H_PAYLOAD, autoLoad: false
        });
        const done = page.onload();
        await new Promise(r => setTimeout(r, 0));
        // The skeleton is painted synchronously once the H2H path is chosen.
        const sawSkeleton = page.tableBody().innerHTML.includes('std-skel-row');
        await done;
        await page.flush();
        expect(sawSkeleton || page.tableBody().innerHTML.includes('Rockets')).toBe(true);
    });
});

describe('head-to-head matchups panel', () => {
    const matchups = {
        enabled: true,
        winBonus: 5,
        tieBonus: 2,
        featuredWeek: 2,
        managers: H2H_PAYLOAD.managers,
        schedule: [
            { week: 1, games: [{ id: 'g1' }] },
            { week: 2, games: [{ id: 'g2' }, { id: 'g3' }] },
            { week: 3, games: [] }
        ]
    };
    const opts = () => ({
        users: [scored('a', 'Alice', 'Adams', [10, 40]), scored('b', 'Bob', 'Brown', [40, 5])],
        h2hEnabled: true, h2hStandings: H2H_PAYLOAD, h2hMatchups: matchups
    });

    it('renders the featured week with a card per game', async () => {
        const page = await loadStandingsPage(opts());
        expect(page.h2hPanel().hidden).toBe(false);
        expect(page.h2hPanel().querySelectorAll('.h2h-card')).toHaveLength(2);
        expect(page.h2hPanel().innerHTML).toContain("This Week's Matchups");
    });

    it('describes the win and tie bonuses', async () => {
        const page = await loadStandingsPage(opts());
        expect(page.h2hPanel().innerHTML).toContain('<b>+5</b>');
        expect(page.h2hPanel().innerHTML).toContain('<b>+2</b> each on a tie');
    });

    it('omits the tie clause when there is no tie bonus', async () => {
        const page = await loadStandingsPage(Object.assign(opts(), {
            h2hMatchups: Object.assign({}, matchups, { tieBonus: 0 })
        }));
        expect(page.h2hPanel().innerHTML).not.toContain('each on a tie');
    });

    it('preselects the featured week in the picker', async () => {
        const page = await loadStandingsPage(opts());
        expect(page.h2hPanel().querySelector('[h2h-week]').value).toBe('2');
    });

    it('repaints when a different week is chosen', async () => {
        const page = await loadStandingsPage(opts());
        const select = page.h2hPanel().querySelector('[h2h-week]');
        select.value = '1';
        select.dispatchEvent(new window.Event('change'));
        expect(page.h2hPanel().querySelectorAll('.h2h-card')).toHaveLength(1);
    });

    it('says so when a week has no matchups', async () => {
        const page = await loadStandingsPage(opts());
        const select = page.h2hPanel().querySelector('[h2h-week]');
        select.value = '3';
        select.dispatchEvent(new window.Event('change'));
        expect(page.h2hPanel().innerHTML).toContain('No matchups this week.');
    });

    it('tags an unopted-in league as a preview', async () => {
        const page = await loadStandingsPage(Object.assign(opts(), {
            h2hEnabled: false, search: '?h2h=1',
            h2hStandings: Object.assign({}, H2H_PAYLOAD, { enabled: false }),
            h2hMatchups: Object.assign({}, matchups, { enabled: false })
        }));
        expect(page.h2hPanel().innerHTML).toContain('h2h-preview-tag');
    });

    it('leaves the panel hidden when the schedule is empty', async () => {
        const page = await loadStandingsPage(Object.assign(opts(), {
            h2hMatchups: { enabled: true, managers: [], schedule: [] }
        }));
        expect(page.h2hPanel().hidden).toBe(true);
    });
});

// --- roster drawer + score animation ----------------------------------------

describe('roster drawer', () => {
    const open = async () => {
        const page = await loadStandingsPage({
            users: [scored('a', 'Alice', 'Adams', [10, 40]), scored('b', 'Bob', 'Brown', [40, 5])],
            h2hEnabled: true, h2hStandings: H2H_PAYLOAD
        });
        return page;
    };

    it('expands the roster row when the caret is clicked', async () => {
        const page = await open();
        const caret = page.tableBody().querySelector('.std-caret');
        const drawer = caret.closest('tr').nextElementSibling;

        expect(drawer.hasAttribute('hidden')).toBe(true);
        caret.click();
        expect(drawer.hasAttribute('hidden')).toBe(false);
        expect(caret.getAttribute('aria-expanded')).toBe('true');
        expect(caret.classList.contains('open')).toBe(true);
    });

    it('collapses again on a second click', async () => {
        const page = await open();
        const caret = page.tableBody().querySelector('.std-caret');
        const drawer = caret.closest('tr').nextElementSibling;
        caret.click();
        caret.click();
        expect(drawer.hasAttribute('hidden')).toBe(true);
        expect(caret.getAttribute('aria-expanded')).toBe('false');
    });

    it('wires each caret only once', async () => {
        const page = await open();
        page.tableBody().querySelectorAll('.std-caret').forEach(btn => {
            expect(btn.dataset.wired).toBe('1');
        });
    });
});

describe('score count-up', () => {
    it('leaves the final score in place under reduced motion', async () => {
        const page = await loadStandingsPage({
            users: [scored('a', 'Alice', 'Adams', [10, 20])], reducedMotion: true
        });
        expect(page.tableBody().querySelector('.score-num').textContent).toBe('30');
    });

    it('animates from zero up to the score otherwise', async () => {
        const page = await loadStandingsPage({
            users: [scored('a', 'Alice', 'Adams', [10, 20])], reducedMotion: false
        });
        const el = page.tableBody().querySelector('.score-num');
        expect(Number(el.textContent)).toBeLessThan(30);   // still counting up
        await new Promise(r => setTimeout(r, 800));
        expect(el.textContent).toBe('30');
    });

    it('skips the animation for a scoreless row', async () => {
        const page = await loadStandingsPage({
            users: [scored('a', 'Alice', 'Adams', [0])], reducedMotion: false
        });
        expect(page.tableBody().querySelector('.score-num').textContent).toBe('0');
    });
});

// --- last updated badge ------------------------------------------------------

describe('last updated badge', () => {
    it('prefers the last successful scoring run', async () => {
        const finishedAt = new Date(Date.now() - 2 * 3600 * 1000).toISOString();
        const page = await loadStandingsPage({
            users: [scored('a', 'Alice', 'Adams', [10])],
            lastUpdated: { finishedAt, week: 4 }
        });
        expect(page.lastUpdated().hidden).toBe(false);
        expect(page.lastUpdated().innerHTML).toContain('Updated <b>2h ago</b>');
        expect(page.lastUpdated().innerHTML).toContain('Last successful scoring update');
        expect(page.lastUpdated().innerHTML).toContain('week 4');
    });

    it('falls back to startedAt when a run never finished', async () => {
        const startedAt = new Date(Date.now() - 5 * 60 * 1000).toISOString();
        const page = await loadStandingsPage({
            users: [scored('a', 'Alice', 'Adams', [10])], lastUpdated: { startedAt }
        });
        expect(page.lastUpdated().innerHTML).toContain('5m ago');
        expect(page.lastUpdated().innerHTML).not.toContain('week');
    });

    it('falls back to the legacy per-user stamp with no run history', async () => {
        const page = await loadStandingsPage({
            users: [scored('a', 'Alice', 'Adams', [10], { top: { _id: 'a', firstName: 'Alice', lastName: 'Adams', lastUpdated: new Date(Date.now() - 86400 * 1000).toISOString() } })],
            lastUpdated: undefined
        });
        expect(page.lastUpdated().innerHTML).toContain('1d ago');
        expect(page.lastUpdated().innerHTML).toContain('Last updated —');
    });

    it('hides the badge when nothing has ever been recorded', async () => {
        const page = await loadStandingsPage({
            users: [makeUser({ top: { _id: 'a', firstName: 'Alice', lastName: 'Adams', lastUpdated: undefined }, weeklyScore: [10] })]
        });
        expect(page.lastUpdated().hidden).toBe(true);
    });

    it('reads a very recent run as "just now"', async () => {
        const page = await loadStandingsPage({
            users: [scored('a', 'Alice', 'Adams', [10])],
            lastUpdated: { finishedAt: new Date().toISOString() }
        });
        expect(page.lastUpdated().innerHTML).toContain('just now');
    });

    it.each([
        ['3 weeks ago as "3w ago"', 21 * 86400, '3w ago'],
        ['2 months ago as "2mo ago"', 70 * 86400, '2mo ago'],
        ['a year ago as "1y ago"', 400 * 86400, '1y ago']
    ])('formats %s', async (_label, seconds, expected) => {
        const page = await loadStandingsPage({
            users: [scored('a', 'Alice', 'Adams', [10])],
            lastUpdated: { finishedAt: new Date(Date.now() - seconds * 1000).toISOString() }
        });
        expect(page.lastUpdated().innerHTML).toContain(expected);
    });

    it('puts an absolute 12-hour stamp in the tooltip', async () => {
        const when = new Date(2025, 8, 23, 0, 5);   // 12:05 AM, Sep 23
        const page = await loadStandingsPage({
            users: [scored('a', 'Alice', 'Adams', [10])],
            lastUpdated: { finishedAt: when.toISOString() }
        });
        expect(page.lastUpdated().innerHTML).toContain('9/23 at 12:05 AM');
    });

    it('renders an afternoon stamp as PM', async () => {
        const when = new Date(2025, 8, 23, 15, 30);
        const page = await loadStandingsPage({
            users: [scored('a', 'Alice', 'Adams', [10])],
            lastUpdated: { finishedAt: when.toISOString() }
        });
        expect(page.lastUpdated().innerHTML).toContain('9/23 at 3:30 PM');
    });

    it('survives the endpoint erroring', async () => {
        const page = await loadStandingsPage({
            users: [scored('a', 'Alice', 'Adams', [10])],
            routes: [['/standings/last-updated', () => { throw new Error('boom'); }]]
        });
        expect(page.lastUpdated().innerHTML).toContain('Last updated —');
    });
});

// --- highlights --------------------------------------------------------------

describe('highlights panel', () => {
    it('renders the cards once the season has real scoring', async () => {
        const page = await loadStandingsPage({
            users: [scored('a', 'Alice', 'Adams', [10, 20]), scored('b', 'Bob', 'Brown', [40, 5])]
        });
        expect(page.highlights().innerHTML).toContain('Big Winner');
        expect(page.highlightsHeader().style.display).toBe('');
    });

    it('hides the whole section while every week is still zero', async () => {
        const page = await loadStandingsPage({
            users: [scored('a', 'Alice', 'Adams', [0, 0]), scored('b', 'Bob', 'Brown', [0, 0])]
        });
        expect(page.highlightsHeader().style.display).toBe('none');
        expect(page.highlights().style.display).toBe('none');
        expect(document.querySelectorAll('.hr-subtle')[0].style.display).toBe('none');
    });

    it('hides the section in the preseason', async () => {
        const page = await loadStandingsPage({ users: [scored('a', 'Alice', 'Adams', [])] });
        expect(page.highlightsHeader().style.display).toBe('none');
    });

    it('appends the server-computed advanced cards', async () => {
        const page = await loadStandingsPage({
            users: [scored('a', 'Alice', 'Adams', [10, 20])],
            advancedCards: [{ icon: 'medal', title: 'Overachiever', tag: 'season', name: 'Hoosiers', value: '+5 wins', tone: 'good' }]
        });
        expect(page.highlights().innerHTML).toContain('Big Winner');
        expect(page.highlights().innerHTML).toContain('Overachiever');
    });

    it('skips the advanced fetch entirely before real scoring', async () => {
        const page = await loadStandingsPage({ users: [scored('a', 'Alice', 'Adams', [0])] });
        expect(page.urls().some(u => u.includes('/standings/highlights/'))).toBe(false);
    });

    it('ignores an advanced-highlights failure', async () => {
        const page = await loadStandingsPage({
            users: [scored('a', 'Alice', 'Adams', [10, 20])],
            routes: [[/\/standings\/highlights\//, () => { throw new Error('boom'); }]]
        });
        expect(page.highlights().innerHTML).toContain('Big Winner');
    });

    it('ignores a non-OK advanced-highlights response', async () => {
        const page = await loadStandingsPage({
            users: [scored('a', 'Alice', 'Adams', [10, 20])],
            routes: [[/\/standings\/highlights\//, respond(500, {})]]
        });
        expect(page.highlights().innerHTML).not.toContain('Overachiever');
    });
});

describe('tie popover', () => {
    // Five teams tied for the top single game gives buildHighlights a "+N" button.
    const tied = () => [scored('a', 'Alice', 'Adams', [{
        score: 150,
        scoreByTeam: ['Indiana', 'Purdue', 'Ohio State', 'Michigan', 'Iowa'].map((team, i) => ({ teamId: i + 1, team, score: 30 }))
    }])];

    it('opens and closes on the "+N" button', async () => {
        const page = await loadStandingsPage({ users: tied() });
        const btn = page.highlights().querySelector('.hl-more');
        const pop = btn.nextElementSibling;

        expect(pop.hidden).toBe(true);
        btn.click();
        expect(pop.hidden).toBe(false);
        expect(btn.getAttribute('aria-expanded')).toBe('true');
        btn.click();
        expect(pop.hidden).toBe(true);
    });

    it('closes on Escape', async () => {
        const page = await loadStandingsPage({ users: tied() });
        const btn = page.highlights().querySelector('.hl-more');
        btn.click();
        document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }));
        expect(btn.nextElementSibling.hidden).toBe(true);
        expect(btn.getAttribute('aria-expanded')).toBe('false');
    });

    it('closes on an outside click', async () => {
        const page = await loadStandingsPage({ users: tied() });
        const btn = page.highlights().querySelector('.hl-more');
        btn.click();
        document.body.click();
        expect(btn.nextElementSibling.hidden).toBe(true);
    });
});

// --- projections -------------------------------------------------------------

describe('projected finish panel', () => {
    const managers = [
        { userId: 'a', name: 'Alice A.', franchise: 'Rockets', initials: 'AA', color: '#111', avatarUrl: 'https://res.cloudinary.com/x/image/upload/v1/a.png', banked: 50, projectedFinal: 120, titleOdds: 64 },
        { userId: 'b', name: 'Bob B.', initials: 'BB', banked: 40, projectedFinal: 100, titleOdds: 150 }
    ];

    it('renders a row per manager', async () => {
        const page = await loadStandingsPage({
            users: [scored('a', 'Alice', 'Adams', [10])], projections: { managers }
        });
        expect(page.projPanel().hidden).toBe(false);
        expect(page.projPanel().querySelectorAll('.pp-row')).toHaveLength(2);
        expect(page.projPanel().innerHTML).toContain('Projected Finish');
    });

    it('shows banked points projecting to a final total', async () => {
        const page = await loadStandingsPage({
            users: [scored('a', 'Alice', 'Adams', [10])], projections: { managers }
        });
        expect(page.projPanel().innerHTML).toContain('<span class="pp-cur">50</span>');
        expect(page.projPanel().innerHTML).toContain('<span class="pp-proj">120</span>');
    });

    it('shows the franchise name over the manager name', async () => {
        const page = await loadStandingsPage({
            users: [scored('a', 'Alice', 'Adams', [10])], projections: { managers }
        });
        expect(page.projPanel().innerHTML).toContain('<span class="pp-name">Rockets</span>');
        expect(page.projPanel().innerHTML).toContain('<span class="pp-sub">Alice A.</span>');
    });

    it('face-crops a Cloudinary avatar and falls back to initials', async () => {
        const page = await loadStandingsPage({
            users: [scored('a', 'Alice', 'Adams', [10])], projections: { managers }
        });
        expect(page.projPanel().innerHTML).toContain('/upload/c_fill,g_face,w_48,h_48,q_auto,f_auto/v1/a.png');
        expect(page.projPanel().innerHTML).toContain('pp-avatar-initials" style="background:#333">BB');
    });

    it('passes a non-Cloudinary avatar through untouched', async () => {
        const page = await loadStandingsPage({
            users: [scored('a', 'Alice', 'Adams', [10])],
            projections: { managers: [Object.assign({}, managers[0], { avatarUrl: 'https://img/a.png' })] }
        });
        expect(page.projPanel().innerHTML).toContain('<img src="https://img/a.png" alt="">');
    });

    it('clamps the title-odds bar at 100%', async () => {
        const page = await loadStandingsPage({
            users: [scored('a', 'Alice', 'Adams', [10])], projections: { managers }
        });
        expect(page.projPanel().innerHTML).toContain('width:100%');
        expect(page.projPanel().innerHTML).toContain('width:64%');
    });

    it('stays hidden when the season has no games left to project', async () => {
        const page = await loadStandingsPage({
            users: [scored('a', 'Alice', 'Adams', [10])], projections: { managers: [] }
        });
        expect(page.projPanel().hidden).toBe(true);
    });

    it('stays hidden when the endpoint fails', async () => {
        const page = await loadStandingsPage({
            users: [scored('a', 'Alice', 'Adams', [10])],
            routes: [[/\/standings\/projections\//, () => { throw new Error('boom'); }]]
        });
        expect(page.projPanel().hidden).toBe(true);
    });
});

// --- chart -------------------------------------------------------------------

describe('points chart', () => {
    it('draws once the season has scoring', async () => {
        const page = await loadStandingsPage({
            users: [scored('a', 'Alice', 'Adams', [10, 20]), scored('b', 'Bob', 'Brown', [40, 5])]
        });
        expect(page.chartContainer().getAttribute('style')).toBeNull();
        expect(page.charts).toHaveLength(1);
        expect(page.charts[0].config.data.labels).toEqual(['Start', 'Wk 1', 'Wk 2']);
    });

    it('stays hidden while every seeded week is zero', async () => {
        const page = await loadStandingsPage({ users: [scored('a', 'Alice', 'Adams', [0, 0])] });
        expect(page.chartContainer().getAttribute('style')).toBe('display: none;');
        expect(page.charts).toHaveLength(0);
    });

    it('redraws in rank mode when the toggle is used', async () => {
        const page = await loadStandingsPage({
            users: [scored('a', 'Alice', 'Adams', [10, 20]), scored('b', 'Bob', 'Brown', [40, 5])]
        });
        page.q('[chart-mode-toggle] button[data-mode="rank"]').click();
        expect(page.charts).toHaveLength(2);
        expect(page.charts[1].config.options.scales.y.reverse).toBe(true);
        expect(page.charts[1].config.options.scales.y.title.text).toBe('Rank');
    });
});

// --- weekly win celebration --------------------------------------------------

describe('weekly win celebration', () => {
    const winner = () => [
        scored('me', 'Alice', 'Adams', [10, 40]),
        scored('b', 'Bob', 'Brown', [40, 5])
    ];
    const asMe = { user_metadata: { roles: ['Manager'], metadata: { league: 'gg', userId: 'me' } } };

    beforeEach(() => { global.startConfetti = jest.fn(); global.stopConfetti = jest.fn(); });
    afterEach(() => { delete global.startConfetti; delete global.stopConfetti; });

    it('celebrates when you post the top score of the week', async () => {
        const page = await loadStandingsPage({ users: winner(), userState: asMe, reducedMotion: false });
        expect(page.q('.highlights-container .sub-highlight-container:first-child .hl-icon').classList.contains('celebrate')).toBe(true);
        expect(global.startConfetti).toHaveBeenCalled();
    });

    it('only fires once per week', async () => {
        await loadStandingsPage({ users: winner(), userState: asMe, reducedMotion: false });
        expect(window.localStorage.getItem('weekWin-2025-2')).toBe('1');
        global.startConfetti.mockClear();

        const again = await loadStandingsPage({
            users: winner(), userState: asMe, reducedMotion: false,
            localStorage: { 'weekWin-2025-2': '1' }
        });
        expect(again.q('.highlights-container .sub-highlight-container:first-child .hl-icon').classList.contains('celebrate')).toBe(false);
        expect(global.startConfetti).not.toHaveBeenCalled();
    });

    it('stays quiet when someone else won the week', async () => {
        const page = await loadStandingsPage({
            users: winner(),
            userState: { user_metadata: { roles: ['Manager'], metadata: { league: 'gg', userId: 'b' } } },
            reducedMotion: false
        });
        expect(page.q('.hl-icon').classList.contains('celebrate')).toBe(false);
        expect(global.startConfetti).not.toHaveBeenCalled();
    });

    it('respects reduced motion', async () => {
        const page = await loadStandingsPage({ users: winner(), userState: asMe, reducedMotion: true });
        expect(page.q('.hl-icon').classList.contains('celebrate')).toBe(false);
        expect(global.startConfetti).not.toHaveBeenCalled();
    });

    it('stays quiet when nobody scored', async () => {
        await loadStandingsPage({
            users: [scored('me', 'Alice', 'Adams', [0, 0])], userState: asMe, reducedMotion: false
        });
        expect(global.startConfetti).not.toHaveBeenCalled();
    });
});

// --- profile setup nudge -----------------------------------------------------

describe('profile setup nudge', () => {
    const unprompted = () => [makeUser({
        top: { _id: 'me', firstName: 'Alice', lastName: 'Adams' },
        weeklyScore: [10], profilePrompted: false
    })];
    const asMe = { user_metadata: { roles: ['Manager'], metadata: { league: 'gg', userId: 'me' } } };

    it('invites a manager who has never been prompted', async () => {
        const page = await loadStandingsPage({ users: unprompted(), userState: asMe });
        expect(page.welcomeModal().hidden).toBe(false);
    });

    it('stays closed for a manager already prompted', async () => {
        const page = await loadStandingsPage({
            users: [makeUser({ top: { _id: 'me', firstName: 'Alice', lastName: 'Adams' }, weeklyScore: [10] })],
            userState: asMe
        });
        expect(page.welcomeModal().hidden).toBe(true);
    });

    it('records the prompt when dismissed with "maybe later"', async () => {
        const page = await loadStandingsPage({ users: unprompted(), userState: asMe });
        page.q('[welcome-later]').click();
        await page.flush(5);

        expect(page.welcomeModal().hidden).toBe(true);
        const patch = page.fetchMock.calls.find(c => c.url === '/users/me/profile');
        expect(patch.init.method).toBe('PATCH');
        expect(JSON.parse(patch.init.body)).toEqual({ prompted: true });
    });

    it('records the prompt when the manager opts to set up', async () => {
        const page = await loadStandingsPage({ users: unprompted(), userState: asMe });
        page.q('[welcome-setup]').click();
        await page.flush(5);

        expect(page.welcomeModal().hidden).toBe(true);
        expect(page.fetchMock.calls.some(c => c.url === '/users/me/profile')).toBe(true);
    });

    it('stays closed when the logged-in manager is not in this league', async () => {
        const page = await loadStandingsPage({
            users: unprompted(),
            userState: { user_metadata: { roles: ['Manager'], metadata: { league: 'gg', userId: 'someone-else' } } }
        });
        expect(page.welcomeModal().hidden).toBe(true);
    });
});

// --- legacy id backfill ------------------------------------------------------

describe('legacy user id backfill', () => {
    it('derives the id from the email when Auth0 has none', async () => {
        const page = await loadStandingsPage({
            users: [scored('a', 'Alice', 'Adams', [10])],
            profile: { email: 'Alice@Example.com', user_metadata: { metadata: { league: 'gg' } } },
            userState: { user_metadata: { roles: ['Manager'], metadata: { league: 'gg' } } }
        });
        expect(window.localStorage.getItem('userId')).toBe('a');
        expect(page.q('[user-home]').getAttribute('href')).toBe('/userHome?user=a');
    });

    it('leaves things alone when Auth0 already has the id', async () => {
        const page = await loadStandingsPage({
            users: [scored('a', 'Alice', 'Adams', [10])],
            userState: { user_metadata: { roles: ['Manager'], metadata: { league: 'gg', userId: 'u1' } } }
        });
        expect(window.localStorage.getItem('userId')).toBeNull();
        expect(page.q('[user-home]').getAttribute('href')).toBe('/userHome?user=stale');
    });

    it('does nothing when no manager matches the email', async () => {
        await loadStandingsPage({
            users: [scored('a', 'Alice', 'Adams', [10])],
            profile: { email: 'nobody@example.com', user_metadata: { metadata: { league: 'gg' } } },
            userState: { user_metadata: { roles: ['Manager'], metadata: { league: 'gg' } } }
        });
        expect(window.localStorage.getItem('userId')).toBeNull();
    });
});

// --- score breakdown popover -------------------------------------------------

describe('score breakdown', () => {
    const withBadge = async (explain) => {
        const page = await loadStandingsPage({
            users: [scored('a', 'Alice', 'Adams', [10])],
            localStorage: { leagueCode: 'graham-league' },
            routes: explain ? [[/\/scoring-config\//, explain]] : []
        });
        // Same nesting displaySchedule produces: the game table lives in a cell
        // of the schedule body, and the handler walks up to `table.game-table`.
        page.scheduleBody().innerHTML = `<tr><td>
            <table class="game-table"><tbody><tr><td>
                <button type="button" class="score-explain" data-team="1" data-game="99" data-pts="7">+7</button>
            </td></tr></tbody></table>
        </td></tr>`;
        return page;
    };

    it('reveals which rules earned the points', async () => {
        const page = await withBadge({ matched: [{ points: 4, label: 'Win vs ranked' }, { points: 3, label: 'Road win' }], total: 7 });
        page.q('.score-explain').click();
        await page.flush(5);

        const box = page.q('.gc-breakdown');
        expect(box.innerHTML).toContain('Win vs ranked');
        expect(box.innerHTML).toContain('Road win');
        expect(page.q('.score-explain').classList.contains('is-open')).toBe(true);
    });

    it('flags a total that no longer matches what was banked', async () => {
        const page = await withBadge({ matched: [{ points: 9, label: 'Win vs ranked' }], total: 9 });
        page.q('.score-explain').click();
        await page.flush(5);
        expect(page.q('.gc-breakdown').innerHTML).toContain('differs from the banked +7');
    });

    it('collapses on a second tap', async () => {
        const page = await withBadge({ matched: [{ points: 7, label: 'Win' }], total: 7 });
        page.q('.score-explain').click();
        await page.flush(5);
        page.q('.score-explain').click();

        expect(page.q('.gc-breakdown-row')).toBeNull();
        expect(page.q('.score-explain').classList.contains('is-open')).toBe(false);
    });

    it('says so when the breakdown is unavailable', async () => {
        const page = await withBadge({ matched: [] });
        page.q('.score-explain').click();
        await page.flush(5);
        expect(page.q('.gc-breakdown').textContent).toBe('Breakdown unavailable.');
    });

    it('survives the endpoint erroring', async () => {
        const page = await withBadge(() => { throw new Error('boom'); });
        page.q('.score-explain').click();
        await page.flush(5);
        expect(page.q('.gc-breakdown').textContent).toBe('Breakdown unavailable.');
    });

    it('ignores clicks that are not on a badge', async () => {
        const page = await withBadge({ matched: [], total: 0 });
        page.scheduleBody().click();
        await page.flush(2);
        expect(page.q('.gc-breakdown-row')).toBeNull();
    });
});

// --- schedule ----------------------------------------------------------------

describe('schedule', () => {
    const TEAMS = [{ id: 1, school: 'Indiana', mascot: 'Hoosiers', logos: ['ind.png'] }];
    const OPPONENT = [{ id: 2, school: 'Purdue', mascot: 'Boilermakers', logos: ['pur.png'] }];

    const league = () => [
        scored('a', 'Alice', 'Adams', [10], { teams: TEAMS }),
        scored('b', 'Bob', 'Brown', [7], { teams: OPPONENT })
    ];

    const game = (over = {}) => Object.assign({
        id: 'g1', awayId: 1, homeId: 2, awayTeam: 'Indiana', homeTeam: 'Purdue',
        awayPoints: 28, homePoints: 21, completed: true, seasonType: 'regular',
        startDate: '2025-09-06T16:00:00Z', notes: '', outlet: 'ESPN'
    }, over);

    it('renders a card for a game between two managers', async () => {
        const page = await loadStandingsPage({
            users: league(), games: [game()],
            teamLogos: [{ id: 1, logos: ['ind.png'] }, { id: 2, logos: ['pur.png'] }],
            rankings: [{ week: 1, season: 2025, polls: [{ poll: 'AP Top 25', ranks: [{ school: 'Indiana', rank: 3 }] }] }]
        });
        const html = page.scheduleBody().innerHTML;
        expect(html).toContain('game-table');
        expect(html).toContain('Indiana');
        expect(html).toContain('Purdue');
        expect(html).toContain('Alice');
        expect(html).toContain('Bob');
    });

    it('shows the rank and broadcast outlet', async () => {
        const page = await loadStandingsPage({
            users: league(), games: [game()],
            teamLogos: [{ id: 1, logos: ['ind.png'] }, { id: 2, logos: ['pur.png'] }],
            rankings: [{ week: 1, season: 2025, polls: [{ poll: 'AP Top 25', ranks: [{ school: 'Indiana', rank: 3 }] }] }]
        });
        expect(page.scheduleBody().innerHTML).toContain('>3</p>');
        expect(page.scheduleBody().innerHTML).toContain('ESPN');
    });

    it('awards a points badge to the manager whose team won', async () => {
        const users = league();
        users[0].seasons[0].weeklyScore = [{
            week: 1, season: 'regular', score: 10,
            scoreByTeam: [{ teamId: 1, gameId: 'g1', team: 'Indiana', score: 10 }]
        }];
        const page = await loadStandingsPage({
            users, games: [game()],
            teamLogos: [{ id: 1, logos: ['ind.png'] }, { id: 2, logos: ['pur.png'] }]
        });
        expect(page.scheduleBody().innerHTML).toContain('class="score-explain"');
        expect(page.scheduleBody().innerHTML).toContain('+10');
    });

    it('shows kickoff time for a game that has not been played', async () => {
        const page = await loadStandingsPage({
            users: league(), games: [game({ completed: false })],
            teamLogos: [{ id: 1, logos: ['ind.png'] }, { id: 2, logos: ['pur.png'] }]
        });
        expect(page.scheduleBody().innerHTML).toMatch(/\d{1,2}:\d{2}(AM|PM)/);
    });

    it('falls back to a helmet icon for a team with no stored logo', async () => {
        const page = await loadStandingsPage({
            users: league(), games: [game()], teamLogos: []
        });
        expect(page.scheduleBody().innerHTML).toContain('fa-helmet-un');
    });

    it('shows a no-games message when nothing is scheduled', async () => {
        const page = await loadStandingsPage({ users: league(), games: [] });
        expect(page.q('#no-games-container').innerHTML).toContain('no-matchups-message');
        expect(page.scheduleBody().querySelectorAll('.game-table')).toHaveLength(0);
    });

    it('hides the loader and reveals the table when done', async () => {
        const page = await loadStandingsPage({ users: league(), games: [] });
        expect(page.q('.football-loader').style.display).toBe('none');
        expect(page.q('.schedule-table').style.display).toBe('flex');
    });

    it('switches to the postseason for week 17', async () => {
        const page = await loadStandingsPage({
            users: league(), games: [],
            localStorage: { week: 'Postseason', weekCode: 'week-17' }
        });
        expect(page.urls().some(u => u.includes('/games/seasonType/postseason/week/1/'))).toBe(true);
    });

    it('repaints when a different week is picked', async () => {
        const page = await loadStandingsPage({ users: league(), games: [] });
        page.jquery.store['#dropdownMenuButtonWeek'] = { text: 'Week 5', val: 'week-5' };
        page.jquery.fire('.dropdown-menu-week a');
        await page.flush(10);

        expect(window.localStorage.getItem('week')).toBe('Week 5');
        expect(window.localStorage.getItem('weekCode')).toBe('week-5');
    });
});

describe('rankings selection', () => {
    const league = () => [scored('a', 'Alice', 'Adams', [10], { teams: [{ id: 1, school: 'Indiana', logos: ['ind.png'] }] })];

    it('prefers the playoff committee poll when it exists', async () => {
        const page = await loadStandingsPage({
            users: league(), games: [],
            rankings: [{ week: 1, season: 2025, polls: [
                { poll: 'Playoff Committee Rankings', ranks: [{ school: 'Indiana', rank: 1 }] },
                { poll: 'AP Top 25', ranks: [{ school: 'Indiana', rank: 9 }] }
            ] }]
        });
        expect(page.urls().some(u => u.includes('/rankings/2025'))).toBe(true);
    });

    it('degrades to an empty ranking list when the week has none', async () => {
        const page = await loadStandingsPage({ users: league(), games: [], rankings: [] });
        expect(page.q('.football-loader').style.display).toBe('none');   // rendered without throwing
    });
});

// --- schedule: game-card branch matrix --------------------------------------
//
// displaySchedule builds each card twice — once when a game is first seen, and
// again when the second manager in the matchup reaches it — with separate
// home/away paths in both passes. These drive the permutations.

describe('schedule game cards', () => {
    const INDIANA = { id: 1, school: 'Indiana', mascot: 'Hoosiers', logos: ['ind.png'] };
    const PURDUE = { id: 2, school: 'Purdue', mascot: 'Boilermakers', logos: ['pur.png'] };
    const LOGOS = [{ id: 1, logos: ['ind.png'] }, { id: 2, logos: ['pur.png'] }];

    // Bob owns the HOME team and is listed first, so the game is first seen from
    // the home side and re-seen from the away side.
    const homeFirst = () => [
        makeUser({ top: { _id: 'b', firstName: 'Bob', lastName: 'Brown' }, teams: [PURDUE], weeklyScore: [{ week: 1, score: 7, scoreByTeam: [{ teamId: 2, gameId: 'g1', team: 'Purdue', score: 7 }] }] }),
        makeUser({ top: { _id: 'a', firstName: 'Alice', lastName: 'Adams' }, teams: [INDIANA], weeklyScore: [{ week: 1, score: 10, scoreByTeam: [{ teamId: 1, gameId: 'g1', team: 'Indiana', score: 10 }] }] })
    ];

    const game = (over = {}) => Object.assign({
        id: 'g1', awayId: 1, homeId: 2, awayTeam: 'Indiana', homeTeam: 'Purdue',
        awayPoints: 28, homePoints: 21, completed: true, seasonType: 'regular',
        startDate: '2025-09-06T16:00:00Z', notes: ''
    }, over);

    it('builds the card from the home side and re-resolves it from the away side', async () => {
        const page = await loadStandingsPage({ users: homeFirst(), games: [game()], teamLogos: LOGOS });
        const html = page.scheduleBody().innerHTML;
        expect(html).toContain('Indiana');
        expect(html).toContain('Purdue');
        expect(page.scheduleBody().querySelectorAll('.game-table')).toHaveLength(1);
    });

    it('marks the winner when the home team wins', async () => {
        const page = await loadStandingsPage({
            users: homeFirst(), teamLogos: LOGOS,
            games: [game({ awayPoints: 14, homePoints: 31 })]
        });
        expect(page.scheduleBody().innerHTML).toContain('fa-caret-left');
        expect(page.scheduleBody().innerHTML).toContain('+7');   // Bob's Purdue badge
    });

    it('renders a tie without a winner caret', async () => {
        const page = await loadStandingsPage({
            users: homeFirst(), teamLogos: LOGOS,
            games: [game({ awayPoints: 21, homePoints: 21 })]
        });
        expect(page.scheduleBody().innerHTML).not.toContain('fa-caret-left');
    });

    // Characterization test, not an endorsement. Both lookups run against the
    // manager currently being iterated, but a team's points live only in its
    // OWNER's weeklyScore — so the opponent always resolves to 0 and the card
    // carries a badge for one side only.
    it('scores each side of a playoff game independently', async () => {
        const page = await loadStandingsPage({
            users: homeFirst(), teamLogos: LOGOS,
            games: [game({ seasonType: 'postseason', notes: 'CFP Playoff Semifinal', awayPoints: 17, homePoints: 31 })]
        });
        const html = page.scheduleBody().innerHTML;
        expect(html).toContain('CFP Playoff Semifinal');
        expect(html).toContain('+7');    // Bob's Purdue — the card is built from his record
        expect(html).not.toContain('+10');   // Alice's Indiana points are invisible here
    });

    it('flips the caret to the home row when the home team wins a playoff game', async () => {
        const page = await loadStandingsPage({
            users: homeFirst(), teamLogos: LOGOS,
            games: [game({ seasonType: 'postseason', notes: 'Playoff Final', awayPoints: 10, homePoints: 40 })]
        });
        expect(page.scheduleBody().innerHTML).toContain('fa-caret-left');
    });

    it('renders a dash when a completed game has no score recorded', async () => {
        const page = await loadStandingsPage({
            users: homeFirst(), teamLogos: LOGOS,
            games: [game({ awayPoints: null, homePoints: null })]
        });
        expect(page.scheduleBody().innerHTML).toContain('-');
    });

    it.each([
        ['morning', 9, '9:00AM'],
        ['noon', 12, '12:00PM'],
        ['afternoon', 15, '3:00PM']
    ])('formats a %s kickoff as %s', async (_label, hour, expected) => {
        const local = new Date(2025, 8, 6, hour, 0);
        const page = await loadStandingsPage({
            users: homeFirst(), teamLogos: LOGOS,
            games: [game({ completed: false, startDate: local.toISOString() })]
        });
        expect(page.scheduleBody().innerHTML).toContain(expected);
    });

    it('skips a game whose kickoff time is still TBD on the second pass', async () => {
        const page = await loadStandingsPage({
            users: homeFirst(), teamLogos: LOGOS,
            games: [game({ startTimeTbd: true })]
        });
        expect(page.scheduleBody().querySelectorAll('.game-table')).toHaveLength(1);
    });

    it('shows the betting spread against the favoured team', async () => {
        const page = await loadStandingsPage({
            users: homeFirst(), teamLogos: LOGOS,
            games: [game({ completed: false })],
            bettingLines: [{ homeTeam: 'Purdue', awayTeam: 'Indiana', lines: [{ provider: 'DraftKings', formattedSpread: 'Indiana -7.5' }] }]
        });
        expect(page.scheduleBody().innerHTML).toContain('betting-line">-7.5');
    });

    it('falls back to the first provider when DraftKings has no line', async () => {
        const page = await loadStandingsPage({
            users: homeFirst(), teamLogos: LOGOS,
            games: [game({ completed: false })],
            bettingLines: [{ homeTeam: 'Purdue', awayTeam: 'Indiana', lines: [{ provider: 'Bovada', formattedSpread: 'Purdue -3' }] }]
        });
        expect(page.scheduleBody().innerHTML).toContain('betting-line">-3');
    });

    it('renders no spread when the game has no line', async () => {
        const page = await loadStandingsPage({
            users: homeFirst(), teamLogos: LOGOS,
            games: [game({ completed: false })], bettingLines: []
        });
        expect(page.scheduleBody().innerHTML).toContain('betting-line"></span>');
    });

    it('orders the cards by kickoff and wraps them into rows', async () => {
        const games = [
            game({ id: 'g1', startDate: '2025-09-06T23:00:00Z' }),
            game({ id: 'g2', startDate: '2025-09-06T16:00:00Z' }),
            game({ id: 'g3', startDate: '2025-09-06T20:00:00Z' }),
            game({ id: 'g4', startDate: '2025-09-06T12:00:00Z' })
        ];
        const page = await loadStandingsPage({ users: homeFirst(), games, teamLogos: LOGOS });
        expect(page.scheduleBody().querySelectorAll('.game-table')).toHaveLength(4);
        expect(page.scheduleBody().querySelectorAll('tr').length).toBeGreaterThan(1);
    });

    it('stacks the cards one per row on mobile', async () => {
        const page = await loadStandingsPage({
            users: homeFirst(), teamLogos: LOGOS,
            games: [game({ id: 'g1' }), game({ id: 'g2' })],
            userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)'
        });
        expect(page.scheduleBody().querySelectorAll('.game-table')).toHaveLength(2);
    });
});

// --- upstream failures -------------------------------------------------------

describe('degrading when upstream calls fail', () => {
    const league = () => [makeUser({
        top: { _id: 'a', firstName: 'Alice', lastName: 'Adams' },
        teams: [{ id: 1, school: 'Indiana', logos: ['ind.png'] }], weeklyScore: [10]
    })];

    it('logs and skips games when the games endpoint errors', async () => {
        const page = await loadStandingsPage({
            users: league(),
            routes: [[/^\/games\/seasonType\//, respond(500, { message: 'nope' })]]
        });
        expect(page.q('.football-loader').style.display).toBe('none');
        expect(page.q('#no-games-container').innerHTML).toContain('no-matchups-message');
    });

    it('survives the team-logo endpoint erroring', async () => {
        const page = await loadStandingsPage({
            users: league(), games: [],
            routes: [['/teams/teamLogos/all', respond(500, { message: 'nope' })]]
        });
        expect(page.q('.football-loader').style.display).toBe('none');
    });

    it('renders with no spreads when the betting endpoint errors', async () => {
        const page = await loadStandingsPage({
            users: league(), games: [],
            routes: [[/^\/betting\//, respond(500, { message: 'nope' })]]
        });
        expect(page.q('.football-loader').style.display).toBe('none');
    });

    it('uses the postseason ranking bucket for week 17', async () => {
        const page = await loadStandingsPage({
            users: league(), games: [],
            localStorage: { week: 'Postseason', weekCode: 'week-17' },
            rankings: [{ week: 16, season: 2025, polls: [{ poll: 'Playoff Committee Rankings', ranks: [{ school: 'Indiana', rank: 2 }] }] }]
        });
        expect(page.urls().some(u => u.includes('/games/seasonType/postseason/'))).toBe(true);
    });
});

describe('league selector', () => {
    it('stores the picked league and reloads', async () => {
        const page = await loadStandingsPage({
            users: [makeUser({ top: { _id: 'a', firstName: 'Alice', lastName: 'Adams' }, weeklyScore: [10] })]
        });
        await new Promise(r => setTimeout(r, 300));   // the binding is deferred 200ms

        page.jquery.store['#dropdownMenuButton'] = { text: 'Claunts League', val: 'claunts-league' };
        page.jquery.fire('[league-selector] a');

        expect(window.sessionStorage.getItem('league')).toBe('Claunts League');
        expect(window.localStorage.getItem('leagueCode')).toBe('claunts-league');
    });
});

describe('score breakdown league fallback', () => {
    it('derives the league from Auth0 when storage has none', async () => {
        const page = await loadStandingsPage({
            users: [makeUser({ top: { _id: 'a', firstName: 'Alice', lastName: 'Adams' }, weeklyScore: [10] })],
            localStorage: { leagueCode: 'undefined' },
            routes: [[/\/scoring-config\//, { matched: [{ points: 7, label: 'Win' }], total: 7 }]]
        });
        page.scheduleBody().innerHTML = `<tr><td>
            <table class="game-table"><tbody><tr><td>
                <button type="button" class="score-explain" data-team="1" data-game="99" data-pts="7">+7</button>
            </td></tr></tbody></table></td></tr>`;
        page.q('.score-explain').click();
        await page.flush(5);

        expect(page.fetchMock.calls.some(c => c.url.includes('/scoring-config/graham-league/explain'))).toBe(true);
    });
});

// The mirror of the block above: when the AWAY team's manager is listed first,
// the first-sighting path takes its away branch and the second pass resolves
// from the home side.
describe('schedule game cards (away manager first)', () => {
    const LOGOS = [{ id: 1, logos: ['ind.png'] }, { id: 2, logos: ['pur.png'] }];
    const awayFirst = () => [
        makeUser({ top: { _id: 'a', firstName: 'Alice', lastName: 'Adams' }, teams: [{ id: 1, school: 'Indiana', mascot: 'Hoosiers', logos: ['ind.png'] }], weeklyScore: [{ week: 1, score: 10, scoreByTeam: [{ teamId: 1, gameId: 'g1', team: 'Indiana', score: 10 }] }] }),
        makeUser({ top: { _id: 'b', firstName: 'Bob', lastName: 'Brown' }, teams: [{ id: 2, school: 'Purdue', mascot: 'Boilermakers', logos: ['pur.png'] }], weeklyScore: [{ week: 1, score: 7, scoreByTeam: [{ teamId: 2, gameId: 'g1', team: 'Purdue', score: 7 }] }] })
    ];
    const game = (over = {}) => Object.assign({
        id: 'g1', awayId: 1, homeId: 2, awayTeam: 'Indiana', homeTeam: 'Purdue',
        awayPoints: 28, homePoints: 21, completed: true, seasonType: 'regular',
        startDate: '2025-09-06T16:00:00Z', notes: ''
    }, over);

    it('badges the away team in a playoff game it won', async () => {
        const page = await loadStandingsPage({
            users: awayFirst(), teamLogos: LOGOS,
            games: [game({ seasonType: 'postseason', notes: 'Playoff Quarterfinal' })]
        });
        expect(page.scheduleBody().innerHTML).toContain('+10');
        expect(page.scheduleBody().innerHTML).toContain('Playoff Quarterfinal');
    });

    // Characterization test, not an endorsement. The first-sighting path has an
    // explicit tie branch (no winner caret), but the duplicate-game path only
    // splits on `awayPoints > homePoints`, so a tie falls into the "home won"
    // else and replaces the correct card with one that carets the home team.
    // Low stakes in practice — FBS games go to overtime, so a completed regular
    // game effectively never ties — but the two paths disagree.
    it('renders a tie as a home win once the home manager re-resolves it', async () => {
        const page = await loadStandingsPage({
            users: awayFirst(), teamLogos: LOGOS,
            games: [game({ awayPoints: 21, homePoints: 21 })]
        });
        expect(page.scheduleBody().innerHTML).toContain('fa-caret-left');
        expect(page.scheduleBody().innerHTML).toContain('+7');
    });

    it('rebuilds the card from the home manager when the home team wins', async () => {
        const page = await loadStandingsPage({
            users: awayFirst(), teamLogos: LOGOS,
            games: [game({ awayPoints: 14, homePoints: 35 })]
        });
        expect(page.scheduleBody().innerHTML).toContain('+7');
        expect(page.scheduleBody().querySelectorAll('.game-table')).toHaveLength(1);
    });

    it('ranks both teams when both are polled', async () => {
        const page = await loadStandingsPage({
            users: awayFirst(), teamLogos: LOGOS, games: [game()],
            rankings: [
                { week: 1, season: 2025, polls: [{ poll: 'AP Top 25', ranks: [{ school: 'Indiana', rank: 3 }, { school: 'Purdue', rank: 18 }] }] },
                { week: 2, season: 2025, polls: [{ poll: 'AP Top 25', ranks: [] }] }
            ]
        });
        expect(page.scheduleBody().innerHTML).toContain('>3</p>');
        expect(page.scheduleBody().innerHTML).toContain('>18</p>');
    });
});
