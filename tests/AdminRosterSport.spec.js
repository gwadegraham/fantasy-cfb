/**
 * @jest-environment jsdom
 *
 * Admin's roster table shows the MANAGED league, which for a League Manager
 * viewing basketball is still their football league. It must say which sport
 * its team ids are, or public/league.js sends a football id to the
 * basketball team page — Minnesota's link opening Kentucky (#489 in reverse).
 */
const fs = require('fs');
const path = require('path');

function loadAdmin({ managed, sportOf }) {
    const jq = () => new Proxy(function () {}, { get: () => jq, apply: () => jq });
    global.$ = global.jQuery = Object.assign(jq, { fn: {}, ajax: () => {}, each: () => {} });
    global.Toastify = () => ({ showToast: () => {}, options: {} });
    global.ccIcon = () => '';
    global.ccLogo = () => '';
    global.io = () => ({ on: () => {}, emit: () => {} });
    global.ccSeasonOf = { payloadSeasonEntry: (u) => u.seasons[0] };
    window.ccManageLeagueCode = () => managed;
    window.ccLeague = sportOf ? { sportOf } : undefined;
    document.body.innerHTML = '<table><tbody user-table-body></tbody></table>';
    (0, eval)(fs.readFileSync(path.join(__dirname, '..', 'public', 'admin.js'), 'utf8'));
}

const USERS = [{ _id: 'u1', firstName: 'Ann', lastName: 'Adams', seasons: [{ teams: [{ id: 135, logos: [], mascot: 'Gophers' }] }] }];
const body = () => document.querySelector('[user-table-body]');

afterEach(() => { delete window.ccLeague; delete window.ccManageLeagueCode; });

test('a football league\'s rosters are marked football', () => {
    loadAdmin({ managed: 'graham-league', sportOf: (c) => (c === 'hoops-league' ? 'basketball' : 'football') });
    displayUsers(USERS);
    expect(body().getAttribute('data-page-sport')).toBe('football');
    expect(body().querySelector('a[href="/team?team=135"]')).not.toBeNull();
});

test('a basketball league\'s rosters are marked basketball, so they DO go to the basketball page', () => {
    loadAdmin({ managed: 'hoops-league', sportOf: (c) => (c === 'hoops-league' ? 'basketball' : 'football') });
    displayUsers(USERS);
    expect(body().getAttribute('data-page-sport')).toBe('basketball');
});

test('without the league helper (an old cached league.js) nothing is marked and nothing breaks', () => {
    loadAdmin({ managed: 'graham-league', sportOf: null });
    expect(() => displayUsers(USERS)).not.toThrow();
    expect(body().hasAttribute('data-page-sport')).toBe(false);
});
