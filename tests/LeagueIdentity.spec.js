/**
 * @jest-environment jsdom
 *
 * Coverage for public/league.js — ccLeague, the one place the client answers
 * "which league is this page about, and what is it called".
 *
 * The names are commissioner-editable, so every surface that shows one reads
 * them from here; the interesting behavior is which league wins. In particular
 * the sticky `leagueCode` in localStorage outlives a logout, so it may only be
 * honored for someone who can actually switch leagues — otherwise a member
 * signing in on a shared browser is told they're in the last Admin's league.
 *
 * public/league.js is a classic script that wires itself to window on load, so
 * it's evaluated into the global scope rather than required.
 */

const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'league.js'), 'utf8');

const ALL = [
    { code: 'claunts-league', name: 'Claunts League' },
    { code: 'graham-league', name: 'CFB Sickos' }   // renamed, as prod's is
];

// Stand up a page and (re-)evaluate the helper against it. `seed` is what
// views/partials/navbar.ejs emits; `html` is the page it paints.
function load({ seed, html = '', pinned = null, stored = null } = {}) {
    window.localStorage.clear();
    if (stored) window.localStorage.setItem('leagueCode', stored);
    document.body.innerHTML = html;
    if (pinned) document.body.setAttribute('data-league-code', pinned);
    else document.body.removeAttribute('data-league-code');
    window.CC_LEAGUE = seed;
    (0, eval)(SRC);                                   // indirect eval → global scope
    return window.ccLeague;
}

const member = { code: 'graham-league', canSwitch: false, all: ALL };
const admin = { code: 'graham-league', canSwitch: true, all: ALL };

describe('which league a page is about', () => {
    it('is the viewer’s own league for a member', () => {
        const cc = load({ seed: member });
        expect(cc.code()).toBe('graham-league');
        expect(cc.name()).toBe('CFB Sickos');
    });

    it('ignores a stale sticky selection for anyone who can’t switch', () => {
        // The shared-browser case: an Admin left Claunts selected and logged
        // out; the member who logs in next is still shown their own league.
        const cc = load({ seed: member, stored: 'claunts-league' });
        expect(cc.code()).toBe('graham-league');
    });

    it('follows an Admin’s sticky selection', () => {
        const cc = load({ seed: admin, stored: 'claunts-league' });
        expect(cc.code()).toBe('claunts-league');
        expect(cc.name()).toBe('Claunts League');
    });

    it('falls back to the Admin’s own league when the stored code is unknown', () => {
        const cc = load({ seed: admin, stored: 'retired-league' });
        expect(cc.code()).toBe('graham-league');
    });

    it('lets a server-pinned league win over both (/rules with ?league=)', () => {
        const cc = load({ seed: admin, stored: 'graham-league', pinned: 'claunts-league' });
        expect(cc.code()).toBe('claunts-league');
        expect(cc.name()).toBe('Claunts League');
    });

    it('names any league on request, not just the current one', () => {
        const cc = load({ seed: member });
        expect(cc.name('claunts-league')).toBe('Claunts League');
    });
});

describe('an unresolvable league', () => {
    it('yields an empty name rather than a raw code', () => {
        expect(load({ seed: { code: 'ghost-league', canSwitch: false, all: ALL } }).name()).toBe('');
        expect(load({ seed: {} }).name()).toBe('');
        expect(load({ seed: undefined }).name()).toBe('');
    });

    it('leaves the label hidden and the title league-free', () => {
        const cc = load({
            seed: {},
            html: '<span class="header-league" league-label hidden></span>'
        });
        cc.paint();
        expect(document.querySelector('[league-label]').hidden).toBe(true);
        expect(cc.title('Standings')).toBe('Standings · Campus Clash');
    });
});

describe('painting', () => {
    it('fills every label and reveals it', () => {
        const cc = load({
            seed: member,
            html: '<span league-label hidden></span><span league-label hidden></span>'
        });
        cc.paint();
        const labels = [...document.querySelectorAll('[league-label]')];
        expect(labels.map(el => el.textContent)).toEqual(['CFB Sickos', 'CFB Sickos']);
        expect(labels.every(el => el.hidden)).toBe(false);
    });

    it('builds the page title from the view’s page name', () => {
        const cc = load({ seed: member });
        expect(cc.title('Standings')).toBe('Standings · CFB Sickos · Campus Clash');
        // Pages that title themselves (My Team, Team) pass their own subject.
        expect(cc.title('Sicko Squad')).toBe('Sicko Squad · CFB Sickos · Campus Clash');
    });

    it('runs itself on DOMContentLoaded, so views need no wiring', () => {
        load({
            seed: member,
            html: '<span league-label hidden></span>'
        });
        document.title = 'Standings · Campus Clash';   // creates the element in jsdom
        document.querySelector('title').setAttribute('data-league-title', 'Standings');
        document.dispatchEvent(new window.Event('DOMContentLoaded'));
        expect(document.querySelector('[league-label]').textContent).toBe('CFB Sickos');
        expect(document.title).toBe('Standings · CFB Sickos · Campus Clash');
    });
});
