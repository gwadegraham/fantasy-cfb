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

const member = { code: 'graham-league', canSwitch: false, isAdmin: false, all: ALL };
const admin = { code: 'graham-league', canSwitch: true, isAdmin: true, all: ALL };
// #319: a member holding two franchises is OFFERED a switcher, but is not an
// Admin — the two were one flag and had to be split.
const twoFranchise = { code: 'graham-league', canSwitch: true, isAdmin: false, all: ALL };

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

    it('follows the SERVER for an Admin, not their sticky selection', () => {
        // Was "follows an Admin's sticky selection". #319 gave the server a
        // validated answer (the cookie), so the client no longer patches it
        // up on read — see the block at the bottom of this file.
        const cc = load({ seed: { code: 'claunts-league', canSwitch: true, isAdmin: true, all: ALL } });
        expect(cc.code()).toBe('claunts-league');
        expect(cc.name()).toBe('Claunts League');
    });

    it('an unknown stored code cannot drag the page anywhere', () => {
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

// The navbar switcher. Its <option>s render in LEAGUES order with no `selected`,
// so a browser lands on the first one (Claunts) whatever the page is showing —
// an Admin on a fresh browser saw "Claunts" above Graham League data and had to
// select their own league and re-select Claunts to get the two to agree.
describe('the navbar switcher', () => {
    const SWITCHER = '<select league-select>'
        + '<option value="claunts-league">Claunts League</option>'
        + '<option value="graham-league">CFB Sickos</option>'
        + '</select>';
    const sel = () => document.querySelector('[league-select]');

    it('points at the viewer’s own league, not whichever renders first', () => {
        const cc = load({ seed: admin, html: SWITCHER });
        expect(sel().value).toBe('claunts-league');   // the browser's default
        cc.paint();
        expect(sel().value).toBe('graham-league');
    });

    it('points at the league the SERVER rendered', () => {
        // Was driven by the sticky selection; the cookie is the source now,
        // and the dropdown must agree with the page it sits on.
        const cc = load({
            seed: { code: 'claunts-league', canSwitch: true, isAdmin: true, all: ALL },
            html: SWITCHER, stored: 'graham-league'
        });
        cc.paint();
        expect(sel().value).toBe('claunts-league');
    });

    it('follows a server-pinned league over the sticky one', () => {
        // /rules and /draft-board pin the league they rendered for, which can
        // carry an Admin's ?league= that storage knows nothing about.
        const cc = load({ seed: admin, html: SWITCHER, stored: 'claunts-league', pinned: 'graham-league' });
        cc.paint();
        expect(sel().value).toBe('graham-league');
    });

    it('is set on DOMContentLoaded, so no page has to wire it', () => {
        load({ seed: admin, html: SWITCHER });
        document.dispatchEvent(new window.Event('DOMContentLoaded'));
        expect(sel().value).toBe('graham-league');
    });

    it('leaves an unknown league alone rather than picking someone else’s', () => {
        const cc = load({ seed: { code: 'retired-league', canSwitch: true, all: ALL }, html: SWITCHER });
        cc.paint();
        expect(sel().value).toBe('claunts-league');   // untouched, not silently reassigned
    });

    it('does nothing on a page with no switcher', () => {
        const cc = load({ seed: member, html: '<span league-label hidden></span>' });
        expect(() => cc.paint()).not.toThrow();
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

// Switching league — the handler that used to be copy-pasted into eight pages.
//
// Every copy wrote localStorage and reloaded, and the SERVER never heard about
// any of it, so a server-rendered page kept showing the viewer's own league
// however the dropdown looked. That is the bug #319 exists to fix, and the
// reason the handler now lives here and nowhere else: one place to tell the
// server, instead of eight chances to forget. These tests were lifted out of
// StandingsPage.spec.js when the copy there was deleted.
describe('switching league', () => {
    let posts;

    // The reload itself is NOT asserted: jsdom's location.reload is read-only
    // and cannot be replaced or spied on (`delete`, defineProperty and
    // jest.spyOn all refuse), and jsdom only logs "Not implemented: navigation"
    // when it is called — hence the console.error mute below. What the tests
    // check instead is the difference the user actually experiences between
    // the accepted and refused paths: whether the choice was written down and
    // whether the dropdown stayed moved.
    beforeEach(() => {
        posts = [];
        window.sessionStorage.clear();
        jest.spyOn(console, 'error').mockImplementation(() => {});
        global.fetch = jest.fn(async (url, opts) => {
            posts.push({ url, body: JSON.parse(opts.body) });
            return { ok: true, json: async () => ({ ok: true }) };
        });
    });
    afterEach(() => { delete global.fetch; jest.restoreAllMocks(); });

    const SELECT = '<select league-select>'
        + '<option value="graham-league">CFB Sickos</option>'
        + '<option value="claunts-league">Claunts League</option>'
        + '</select>';

    const pick = async (value) => {
        const sel = document.querySelector('[league-select]');
        sel.value = value;
        sel.dispatchEvent(new window.Event('change'));
        await new Promise(r => setTimeout(r, 0));     // the handler awaits the POST
        return sel;
    };

    it('tells the SERVER, and stores the choice', async () => {
        load({ seed: admin, html: SELECT });
        document.dispatchEvent(new window.Event('DOMContentLoaded'));
        await pick('claunts-league');

        // The POST is the whole point: without it the next server render is
        // still the viewer's own league, however the dropdown looks.
        expect(posts).toHaveLength(1);
        expect(posts[0].url).toBe('/league/select');
        expect(posts[0].body).toEqual({ league: 'claunts-league' });

        // localStorage is still written, because the client helpers above and
        // several by-league fetches read it.
        expect(window.localStorage.getItem('leagueCode')).toBe('claunts-league');
        expect(window.sessionStorage.getItem('league')).toBe('Claunts League');
    });

    it('a REFUSED league puts the dropdown back and records nothing', async () => {
        // 403 means it is not one of your leagues. Writing the choice anyway
        // would leave the client reading one league while the server renders
        // another — the exact split #319 is closing.
        global.fetch = jest.fn(async () => ({ ok: false, status: 403, json: async () => ({}) }));
        load({ seed: admin, html: SELECT });
        document.dispatchEvent(new window.Event('DOMContentLoaded'));
        const sel = await pick('claunts-league');

        expect(sel.value).toBe('graham-league');                 // syncSwitcher put it back
        expect(window.localStorage.getItem('leagueCode')).not.toBe('claunts-league');
        expect(window.sessionStorage.getItem('league')).toBeNull();
    });

    it('offline still applies the choice locally', async () => {
        // The cookie is the server's authority, but a failed POST should not
        // strand the client helpers on the old league.
        global.fetch = jest.fn(async () => { throw new Error('offline'); });
        load({ seed: admin, html: SELECT });
        document.dispatchEvent(new window.Event('DOMContentLoaded'));
        const sel = await pick('claunts-league');

        expect(window.localStorage.getItem('leagueCode')).toBe('claunts-league');
        expect(sel.value).toBe('claunts-league');                // NOT reverted
    });

    it('binds once, however many times it is called', async () => {
        // paint() calls bindSwitcher, and pages that render a header late call
        // paint repeatedly. A second listener would double-POST.
        const cc = load({ seed: admin, html: SELECT });
        document.dispatchEvent(new window.Event('DOMContentLoaded'));
        cc.paint();
        cc.bindSwitcher();
        await pick('claunts-league');
        expect(posts).toHaveLength(1);
    });

    it('a page that renders its navbar late gets a WORKING switcher', async () => {
        // The gap this closes: paint() used to populate the dropdown without
        // binding it, so the header arrived looking right and doing nothing.
        const cc = load({ seed: admin, html: '' });
        document.dispatchEvent(new window.Event('DOMContentLoaded'));   // nothing to bind yet
        document.body.innerHTML = SELECT;
        cc.paint();
        await pick('claunts-league');
        expect(posts).toHaveLength(1);
    });
});

describe('the SERVER decides which league a page is about', () => {
    // There used to be a third source: an Admin's sticky localStorage.
    // Before #319 the server could not know which league an Admin had
    // picked — the switcher wrote localStorage and reloaded — so the client
    // patched it up on read. Now the server's answer IS the validated
    // cookie, and keeping the override left the two able to disagree in the
    // other direction.
    //
    // Caught in dev: a hoops-league cookie rendered the basketball accent and
    // favicon server-side while every league label still read "The Polar
    // Depressed", because a stale localStorage won.
    it('ignores a stale sticky selection, even for an Admin', () => {
        const cc = load({ seed: admin, stored: 'claunts-league' });
        expect(cc.code()).toBe('graham-league');
        expect(cc.name()).toBe('CFB Sickos');
    });

    it('and for a two-franchise member', () => {
        expect(load({ seed: twoFranchise, stored: 'claunts-league' }).code()).toBe('graham-league');
    });

    it('and for a plain member on a shared browser', () => {
        // The original reason the override was Admin-gated at all.
        expect(load({ seed: member, stored: 'claunts-league' }).code()).toBe('graham-league');
    });

    it('a server-PINNED page still wins — that is the one thing storage cannot carry', () => {
        // /rules and /draft-board pin the league on <body>, carrying an
        // Admin's ?league=, which the cookie knows nothing about.
        const cc = load({ seed: admin, stored: 'graham-league', pinned: 'claunts-league' });
        expect(cc.code()).toBe('claunts-league');
    });

    it('the switcher still WRITES localStorage, because pages fetch by it', () => {
        // It is a mirror of the choice now, not a source of it — removing the
        // write would break every page that reads leagueCode directly.
        const src = require('fs').readFileSync(
            require('path').join(__dirname, '..', 'public', 'league.js'), 'utf8');
        expect(src).toContain("localStorage.setItem('leagueCode'");
    });
});

// Team and game pages are FOOTBALL-ONLY, and their URLs do not say so.
//
// /team?team=135 and /game/:id look their id up in the football
// collections. The two sports number teams independently — 130 of the 365
// basketball teams share an id with a football team — so on a basketball
// league those links do not 404, they render somebody else. Clicking
// Kentucky on a hoops roster showed MINNESOTA's football page: its record,
// its coach, its stadium, under the basketball league's header.
describe('a basketball league does not link to football team pages', () => {
    const hoops = { code: 'hoops-league', canSwitch: false, isAdmin: false, all: [
        { code: 'hoops-league', name: 'Hardwood Heroes', sport: 'basketball' },
        { code: 'graham-league', name: 'CFB Sickos', sport: 'football' }
    ] };
    const football = { code: 'graham-league', canSwitch: false, isAdmin: false, all: hoops.all };

    const LINKS = '<a id="t" href="/team?team=135">Kentucky</a>'
        + '<a id="g" href="/game/372997">Duke at Florida</a>'
        + '<a id="ok" href="/standings">Standings</a>';

    const clickOn = (id) => {
        const e = new window.MouseEvent('click', { bubbles: true, cancelable: true });
        document.getElementById(id).dispatchEvent(e);
        return e.defaultPrevented;
    };

    // Each load() re-evaluates league.js, so the guard must replace the
    // one the previous test left on document — a first-wins registration
    // keeps a listener closed over the WRONG league's seed, which is the
    // trap bindTab already hit once in this file.
    test('the sport comes off the seed', () => {
        expect(load({ seed: hoops }).sport()).toBe('basketball');
        expect(load({ seed: football }).sport()).toBe('football');
    });

    // #494: there IS a basketball team page now, so a team link goes there
    // rather than nowhere. Games still have no basketball page.
    test('team links go to the basketball team page; game links are stripped', () => {
        const cc = load({ seed: hoops, html: LINKS });
        cc.paint();
        expect(document.getElementById('t').getAttribute('href')).toBe('/hoops/team/135');
        expect(document.getElementById('g').hasAttribute('href')).toBe(false);
        // Everything else is left alone.
        expect(document.getElementById('ok').getAttribute('href')).toBe('/standings');
    });

    test('and the original href is kept', () => {
        const cc = load({ seed: hoops, html: LINKS });
        cc.paint();
        expect(document.getElementById('t').dataset.ccHref).toBe('/team?team=135');
    });

    test('football is untouched', () => {
        const cc = load({ seed: football, html: LINKS });
        cc.paint();
        expect(document.getElementById('t').getAttribute('href')).toBe('/team?team=135');
        expect(document.getElementById('g').getAttribute('href')).toBe('/game/372997');
    });

    test('a link built AFTER the sweep is still caught', () => {
        // Most of these links are built when a fetch resolves, long after
        // paint. The capture-phase guard is the net that actually closes
        // the bug — the sweep alone would miss nearly all of them.
        load({ seed: hoops, html: '' });
        document.dispatchEvent(new window.Event('DOMContentLoaded'));
        document.body.innerHTML = LINKS;
        expect(clickOn('t')).toBe(false);    // allowed to navigate...
        expect(document.getElementById('t').getAttribute('href')).toBe('/hoops/team/135');   // ...to basketball
        expect(clickOn('g')).toBe(true);     // a game is refused
        expect(clickOn('ok')).toBe(false);   // ordinary links still work
    });

    // Middle-click fires auxclick, and "open in new tab" / "copy link"
    // fire neither click nor auxclick — but all of them start with a
    // mousedown, which is why the rewrite happens there too.
    // #489 in reverse: a football id sent to /hoops/team/ opens whichever
    // basketball team shares the number. A CONTAINER of football ids — admin's
    // roster table for a football league it manages — opts out on its own.
    test('links inside a football container are left alone, on the sweep and on click', () => {
        const cc = load({ seed: hoops, html: '<div data-page-sport="football"><a id="ft" href="/team?team=135">Minnesota</a><a id="fg" href="/game/9">G</a></div>' + LINKS });
        cc.paint();
        expect(document.getElementById('ft').getAttribute('href')).toBe('/team?team=135');
        expect(document.getElementById('fg').getAttribute('href')).toBe('/game/9');
        expect(document.getElementById('t').getAttribute('href')).toBe('/hoops/team/135');   // outside: rewritten
        document.dispatchEvent(new window.Event('DOMContentLoaded'));
        document.getElementById('ft').dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true }));
        expect(clickOn('ft')).toBe(false);
        expect(clickOn('fg')).toBe(false);
        expect(document.getElementById('ft').getAttribute('href')).toBe('/team?team=135');
    });

    test('a container marked basketball is rewritten like the rest', () => {
        const cc = load({ seed: hoops, html: '<div data-page-sport="basketball"><a id="bt" href="/team?team=96">Kentucky</a></div>' });
        cc.paint();
        expect(document.getElementById('bt').getAttribute('href')).toBe('/hoops/team/96');
    });

    test('sportOf names the sport of any league in the seed', () => {
        const cc = load({ seed: hoops });
        expect(cc.sportOf('hoops-league')).toBe('basketball');
        expect(cc.sportOf('graham-league')).toBe('football');
        expect(cc.sportOf('nobody')).toBe('football');
    });

    test('a team link is rewritten on MOUSEDOWN, before a middle-click or a copy', () => {
        load({ seed: hoops, html: '' });
        document.dispatchEvent(new window.Event('DOMContentLoaded'));
        document.body.innerHTML = LINKS;
        document.getElementById('t').dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true, button: 1 }));
        expect(document.getElementById('t').getAttribute('href')).toBe('/hoops/team/135');
    });

    // The football team page, a football game and the CFP bracket are
    // football whatever league is selected: their ids ARE football ids.
    test('a football-only page keeps its links, even on a basketball league', () => {
        const cc = load({ seed: hoops, html: LINKS });
        document.body.setAttribute('data-page-sport', 'football');
        try {
            cc.paint();
            expect(document.getElementById('t').getAttribute('href')).toBe('/team?team=135');
            expect(document.getElementById('g').getAttribute('href')).toBe('/game/372997');
            expect(clickOn('g')).toBe(false);
            expect(cc.refusesHref('/game/372997')).toBe(false);
        } finally {
            document.body.removeAttribute('data-page-sport');
        }
    });

    test('and on football the guard lets everything through', () => {
        load({ seed: football, html: '' });
        document.dispatchEvent(new window.Event('DOMContentLoaded'));
        document.body.innerHTML = LINKS;
        expect(clickOn('t')).toBe(false);
        expect(clickOn('g')).toBe(false);
    });

    test('a click on something INSIDE the link is caught too', () => {
        // Most of these wrap a logo or a span, so the target is never the
        // anchor itself.
        load({ seed: hoops, html: '' });
        document.dispatchEvent(new window.Event('DOMContentLoaded'));
        document.body.innerHTML = '<a id="t" href="/team?team=135"><img id="logo"></a><a id="g" href="/game/1"><img id="glogo"></a>';
        document.getElementById('logo').dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
        expect(document.getElementById('t').getAttribute('href')).toBe('/hoops/team/135');
        const e = new window.MouseEvent('click', { bubbles: true, cancelable: true });
        document.getElementById('glogo').dispatchEvent(e);
        expect(e.defaultPrevented).toBe(true);
    });

    test('a control NESTED in a refused link still gets its click', () => {
        // My Team's "+N" breakdown button lives inside the game card's <a>,
        // and its handler is a bubble listener on document. A guard that
        // stops propagation runs first (capture, on document) and the
        // button goes dead — only the navigation should be refused.
        load({ seed: hoops, html: '' });
        document.dispatchEvent(new window.Event('DOMContentLoaded'));
        document.body.innerHTML = '<a href="/game/372997" class="game-card"><button id="b" class="score-explain">+12</button></a>';
        const seen = jest.fn();
        document.addEventListener('click', seen);
        try {
            const e = new window.MouseEvent('click', { bubbles: true, cancelable: true });
            document.getElementById('b').dispatchEvent(e);
            expect(e.defaultPrevented).toBe(true);
            expect(seen).toHaveBeenCalled();
        } finally {
            document.removeEventListener('click', seen);
        }
    });

    test('script navigation goes through open(), which refuses the same URLs', () => {
        // Standings and Scoreboard cards set location.href from a handler —
        // no anchor, so the guard above never sees them.
        const cc = load({ seed: hoops });
        expect(cc.open('/game/372997')).toBe(false);
        expect(cc.basketballHref('/team?team=135')).toBe('/hoops/team/135');
        expect(cc.refusesHref('/team?team=135')).toBe(false);
        expect(cc.refusesHref('/standings')).toBe(false);
        expect(load({ seed: football }).basketballHref('/team?team=135')).toBeNull();
        expect(load({ seed: football }).refusesHref('/game/372997')).toBe(false);
    });
});
