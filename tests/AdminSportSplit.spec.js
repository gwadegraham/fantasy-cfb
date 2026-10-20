/**
 * @jest-environment jsdom
 *
 * public/admin.js after the admin split (#518): football's admin page and the
 * basketball admin page share this script. Football's status strip must not
 * list basketball's jobs (League Managers see that strip, and basketball stays
 * hidden from them), and the basketball page must not pull football's 1 MB
 * team list it has no use for.
 */
const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'admin.js'), 'utf8');

function loadAdmin({ sport, routes }) {
    const jq = () => new Proxy(function () {}, { get: () => jq, apply: () => jq });
    global.$ = global.jQuery = Object.assign(jq, { fn: {}, ajax: () => {}, each: () => {} });
    global.Toastify = () => ({ showToast: () => {}, options: {} });
    global.ccIcon = () => '';
    global.ccLogo = () => '';
    global.ccSeasonOf = { payloadSeasonEntry: (u) => u.seasons[0] };
    window.ccManageLeagueCode = () => 'graham-league';
    window.APP_YEAR = '2026';
    if (sport) window.ADMIN_SPORT = sport; else delete window.ADMIN_SPORT;
    document.body.innerHTML = '<table><tbody user-table-body></tbody></table>';
    global.fetch = jest.fn((url) => {
        const body = Object.keys(routes || {}).find(k => String(url).indexOf(k) === 0);
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body ? routes[body] : []) });
    });
    (0, eval)(SRC);
}
const flush = async () => { for (let i = 0; i < 6; i++) await new Promise(r => setTimeout(r, 0)); };
const urls = () => global.fetch.mock.calls.map(c => String(c[0]));

afterEach(() => { delete window.ADMIN_SPORT; delete window.ccManageLeagueCode; });

// Football's status strip retired with the Clipboard (#609); "football's page
// shows no basketball job" is now pinned on the shared jobs list in
// tests/AdminClipboardView.spec.js.

test("the basketball page does not fetch football's team list", async () => {
    loadAdmin({ sport: 'basketball', routes: { '/profile': {} } });
    await window.onload();
    await flush();
    expect(urls()).not.toContain('/teams');
});

test('football still does — its tools need the names', async () => {
    loadAdmin({ routes: { '/profile': {} } });
    await window.onload();
    await flush();
    expect(urls()).toContain('/teams');
});

test('a basketball league names its scoring shape', () => {
    loadAdmin({});
    expect(SHAPE_LABEL.hoops).toBe('Quadrant win values');
});

// Basketball plays Captain too (#553), and its picks are audited the same
// way (#569). Its Activity is its own league's.
test('basketball Activity: one league, with the Captain picks tab', async () => {
    loadAdmin({ sport: 'basketball', routes: { '/audit-log': { entries: [], scope: ['hoops-league'] } } });
    window.ccManageLeagueCode = () => 'hoops-league';
    document.body.innerHTML += '<div audit-log-body></div>';
    await loadAuditLog();
    expect(urls().find(u => u.indexOf('/audit-log') === 0)).toContain('league=hoops-league');
    expect(document.querySelector('[data-audit-kind="captain"]')).not.toBeNull();
});

// The Captain Override card (#569): weeks come from the league's own season,
// names off the roster, and the write names the league it is about.
test('basketball Captain Override: mode weeks, roster names, and the league in the write', async () => {
    loadAdmin({ sport: 'basketball', routes: {
        '/users/league/hoops-league/captain-weeks': { sport: 'basketball', season: 2027, weeks: [1, 2, 3] },
        '/users/a1/captain': { ok: true }
    } });
    window.ccManageLeagueCode = () => 'hoops-league';
    document.body.innerHTML += '<form id="captain-override-form"><select id="captain-override-user"></select>'
        + '<select id="captain-override-week"></select><select id="captain-override-team"></select></form>'
        + '<div id="captain-override-current"></div>';
    document.dispatchEvent(new Event('DOMContentLoaded'));
    await flush();   // other DOMContentLoaded handlers re-read the (empty) user list
    setUserOptions([{ _id: 'a1', firstName: 'Ann', lastName: 'Two', seasons: [{ season: 2027,
        teams: [{ id: 1, school: 'Hoops One' }, { id: 2, school: 'Hoops Two' }],
        captains: [{ week: 1, teamId: 2, auto: true }] }] }]);
    loadCaptainOverride();
    await flush();

    const weeks = [...document.querySelectorAll('#captain-override-week option')].map(o => o.value).filter(Boolean);
    expect(weeks).toEqual(['1', '2', '3']);

    const user = document.getElementById('captain-override-user');
    user.value = 'a1';
    user.onchange();
    const teams = [...document.querySelectorAll('#captain-override-team option')].map(o => o.textContent);
    expect(teams).toEqual(['Select A Team', 'Hoops One', 'Hoops Two']);
    expect(document.getElementById('captain-override-current').textContent).toBe('Current picks: W1: Hoops Two (default)');

    global.successToast = { options: {}, showToast: jest.fn() };
    global.failToast = { options: {}, showToast: jest.fn() };
    document.getElementById('captain-override-week').value = '2';
    document.getElementById('captain-override-team').value = '1';
    document.getElementById('captain-override-form').dispatchEvent(new Event('submit'));
    await flush();
    const call = global.fetch.mock.calls.find(c => String(c[0]) === '/users/a1/captain');
    expect(JSON.parse(call[1].body)).toEqual({ league: 'hoops-league', week: 2, teamId: 1 });
    expect(global.failToast.showToast).not.toHaveBeenCalled();
    delete global.successToast; delete global.failToast;
});

// Football's Activity is the managed football league's, so an Admin there never
// sees the basketball league's changes.
test('football Activity: its own league, with the Captain tab', async () => {
    loadAdmin({ routes: { '/audit-log': { entries: [], scope: ['graham-league'] } } });
    document.body.innerHTML += '<div audit-log-body></div>';
    await loadAuditLog();
    expect(urls().find(u => u.indexOf('/audit-log') === 0)).toContain('league=graham-league');
    expect(document.querySelector('[data-audit-kind="captain"]')).not.toBeNull();
});

// Correct a Roster (#561): the write names the league this page manages, and
// basketball's stale-scores note describes ITS rescore — the nightly pass,
// not football's Score All Weeks, which the basketball page does not have.
test('basketball Correct a Roster: the league in the write, and the nightly-rescore note', async () => {
    loadAdmin({ sport: 'basketball', routes: {
        '/users/a1/roster-team': { from: { school: 'Hoops One' }, to: { school: 'Hoops Four' }, sport: 'basketball', rescoreNeeded: true },
        '/users/league/hoops-league/roster-teams': { managers: [], available: [], season: '2027', sport: 'basketball' }
    } });
    window.ccManageLeagueCode = () => 'hoops-league';
    global.successToast = { options: {}, showToast: jest.fn() };
    global.failToast = { options: {}, showToast: jest.fn() };
    rosterFix.data = { season: '2027', sport: 'basketball', managers: [], available: [] };
    await applyRosterCorrection(document.createElement('button'), 'a1', 1, 4);
    const call = global.fetch.mock.calls.find(c => String(c[0]) === '/users/a1/roster-team');
    expect(JSON.parse(call[1].body)).toEqual({ league: 'hoops-league', season: '2027', fromTeamId: 1, toTeamId: 4 });
    expect(global.failToast.options.text).toMatch(/any week with a result in the last 3 days/);
    expect(global.failToast.options.text).not.toMatch(/Score All Weeks/);
    delete global.successToast; delete global.failToast;
});
