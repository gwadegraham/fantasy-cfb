/**
 * @jest-environment jsdom
 *
 * The league switcher on the phone tab bar (#319 part 2) — driven, not
 * matched as a string.
 *
 * tests/NavbarSwitcher.spec.js asserts the MARKUP the partial emits. Nothing
 * asserted the BEHAVIOUR, and a review found three bugs living in that gap:
 * a tap compared against the wrong league on a pinned page, a refused switch
 * was completely silent, and the sessionStorage label got the sport word
 * instead of the league name. So this renders the real partial, evaluates the
 * real public/league.js over it, and clicks things.
 */

const fs = require('fs');
const path = require('path');
const ejs = require('ejs');

const NAVBAR = path.join(__dirname, '..', 'views', 'partials', 'navbar.ejs');
const LEAGUE_JS = fs.readFileSync(path.join(__dirname, '..', 'public', 'league.js'), 'utf8');

const BALL = { code: 'graham-league', name: 'The Polar Depressed', sport: 'football' };
const OTHER = { code: 'claunts-league', name: 'Goofballers', sport: 'football' };
const HOOPS = { code: 'hoops-league', name: 'Hardwood Heroes', sport: 'basketball' };

let posts, reload;

// Renders the partial for a viewer, then wires league.js to it exactly as a
// page does: the seed, then the script, then DOMContentLoaded.
function page({ leagues, here, isAdmin = false, pinned = null, seedAll } = {}) {
    const html = ejs.render(fs.readFileSync(NAVBAR, 'utf8'), {
        user: { role: isAdmin ? 'Admin' : '', userId: 'u1' },
        leagues: [OTHER, BALL, HOOPS],
        viewerLeagues: leagues,
        viewerCanSwitch: leagues.length > 1 || isAdmin,
        viewerLeagueCode: here,
        sportIcon: 'fa-football'
    }, { filename: NAVBAR });

    document.body.innerHTML = html;
    if (pinned) document.body.setAttribute('data-league-code', pinned);
    else document.body.removeAttribute('data-league-code');

    window.CC_LEAGUE = { code: here, canSwitch: leagues.length > 1 || isAdmin, isAdmin, all: seedAll || leagues };
    (0, eval)(LEAGUE_JS);
    document.dispatchEvent(new window.Event('DOMContentLoaded'));
    return window.ccLeague;
}

const tapTab = () => document.querySelector('.tab-league').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
const rows = () => [...document.querySelectorAll('.league-sheet-row')];
const tapRow = (code) =>
    rows().find(r => r.getAttribute('data-league-go') === code)
        .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
const settle = () => new Promise(r => setTimeout(r, 0));

beforeEach(() => {
    posts = []; reload = 0;
    window.localStorage.clear();
    window.sessionStorage.clear();
    jest.spyOn(console, 'error').mockImplementation(() => {});
    global.fetch = jest.fn(async (url, opts) => {
        posts.push(JSON.parse(opts.body));
        return { ok: true, json: async () => ({ ok: true }) };
    });
    // jsdom's reload is read-only and cannot be replaced, so the observable
    // difference between the accepted and refused paths is what gets checked.
});
afterEach(() => { delete global.fetch; jest.restoreAllMocks(); });

describe('two leagues: the tab IS the other one', () => {
    test('one tap switches, with no sheet involved', async () => {
        page({ leagues: [BALL, HOOPS], here: BALL.code });
        tapTab();
        await settle();
        expect(posts).toEqual([{ league: HOOPS.code }]);
        expect(window.localStorage.getItem('leagueCode')).toBe(HOOPS.code);
    });

    test('sessionStorage gets the league NAME, not the sport word', async () => {
        // The tab's only <span> is the sport ("Hoops"); every other writer of
        // this key stores the display name, so scraping the button put a
        // different kind of value in a shared key.
        page({ leagues: [BALL, HOOPS], here: BALL.code });
        tapTab();
        await settle();
        expect(window.sessionStorage.getItem('league')).toBe('Hardwood Heroes');
    });

    test('and it switches back from the other side', async () => {
        page({ leagues: [BALL, HOOPS], here: HOOPS.code });
        tapTab();
        await settle();
        expect(posts).toEqual([{ league: BALL.code }]);
    });
});

describe('three leagues: the sheet', () => {
    const three = { leagues: [OTHER, BALL, HOOPS], here: BALL.code, isAdmin: true };

    test('the tab opens it, Escape closes it', () => {
        const cc = page(three);
        expect(document.querySelector('[data-league-sheet-panel]').hidden).toBe(true);
        tapTab();
        expect(document.querySelector('[data-league-sheet-panel]').hidden).toBe(false);
        expect(document.body.classList.contains('league-sheet-open')).toBe(true);
        document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        expect(document.querySelector('[data-league-sheet-panel]').hidden).toBe(true);
        expect(document.body.classList.contains('league-sheet-open')).toBe(false);
        expect(cc).toBeTruthy();
    });

    test('picking a league switches to it', async () => {
        page(three);
        tapTab();
        tapRow(HOOPS.code);
        await settle();
        expect(posts).toEqual([{ league: HOOPS.code }]);
        expect(window.sessionStorage.getItem('league')).toBe('Hardwood Heroes');
    });

    test('picking the one you are already in just closes', async () => {
        page(three);
        tapTab();
        tapRow(BALL.code);
        await settle();
        expect(posts).toEqual([]);
        expect(document.querySelector('[data-league-sheet-panel]').hidden).toBe(true);
    });

    test('focus moves into the sheet and comes back out', () => {
        page(three);
        const tab = document.querySelector('.tab-league');
        tab.focus();
        tapTab();
        // aria-modal="true" tells a screen reader the rest of the page is
        // gone, so focus has to actually be in there.
        expect(document.activeElement).toBe(rows()[0]);
        document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        expect(document.activeElement).toBe(tab);
    });
});

describe('a PINNED page', () => {
    // /rules and /draft-board set <body data-league-code>, carrying an
    // Admin's ?league=. code() follows the pin; the sheet's check mark is
    // rendered from the cookie. Comparing a tap against code() made the row
    // you wanted a dead no-op and the row marked current the only live one.
    const pinnedPage = () => page({
        leagues: [OTHER, BALL, HOOPS], here: BALL.code, isAdmin: true, pinned: OTHER.code
    });

    test('the pin still decides what the PAGE is about', () => {
        const cc = pinnedPage();
        expect(cc.code()).toBe(OTHER.code);
        expect(cc.selected()).toBe(BALL.code);        // the cookie
    });

    test('tapping the pinned league actually switches to it', async () => {
        pinnedPage();
        tapTab();
        tapRow(OTHER.code);
        await settle();
        expect(posts).toEqual([{ league: OTHER.code }]);
    });

    test('and the row marked current is the one that does nothing', async () => {
        pinnedPage();
        tapTab();
        tapRow(BALL.code);                             // the cookie's league
        await settle();
        expect(posts).toEqual([]);
    });
});

describe('a refused switch', () => {
    test('says so rather than looking like a dead button', async () => {
        // The <select> path calls syncSwitcher() on a 403 precisely so it
        // does not "look like nothing happened"; the tab path had nothing.
        global.fetch = jest.fn(async () => ({ ok: false, status: 403, json: async () => ({}) }));
        const errors = [];
        window.ccToast = { error: (m) => errors.push(m) };

        page({ leagues: [BALL, HOOPS], here: BALL.code });
        tapTab();
        await settle();

        expect(errors).toHaveLength(1);
        expect(window.localStorage.getItem('leagueCode')).not.toBe(HOOPS.code);
        delete window.ccToast;
    });

    test('and closes the sheet rather than leaving the page unscrollable', async () => {
        // body.league-sheet-open sets overflow:hidden.
        global.fetch = jest.fn(async () => ({ ok: false, status: 403, json: async () => ({}) }));
        page({ leagues: [OTHER, BALL, HOOPS], here: BALL.code, isAdmin: true });
        tapTab();
        tapRow(HOOPS.code);
        await settle();
        expect(document.body.classList.contains('league-sheet-open')).toBe(false);
    });
});

describe('ccLeagueCode — what every page loads data for', () => {
    test('is the server’s answer', () => {
        page({ leagues: [BALL, HOOPS], here: HOOPS.code });
        expect(window.ccLeagueCode()).toBe(HOOPS.code);
    });

    test('a pinned page overrides it, because the pin is the page', () => {
        page({ leagues: [OTHER, BALL], here: BALL.code, isAdmin: true, pinned: OTHER.code });
        expect(window.ccLeagueCode()).toBe(OTHER.code);
    });

    test('falls back to the Auth0 flag only with no seed at all', () => {
        page({ leagues: [BALL], here: '' });
        window.userState = { user_metadata: { metadata: { league: 'cl' } } };
        expect(window.ccLeagueCode()).toBe('claunts-league');
        delete window.userState;
    });
});

describe('ccManageLeagueCode — what the Admin page WRITES to', () => {
    // canManageLeague answers a League Manager on their Auth0 league. Routing
    // the admin page's writes by the viewed league meant a League Manager who
    // switched got a 403 on everything: roster blank, create-user refused,
    // rename refused, with only a generic toast.
    test('an Admin manages the league they are viewing', () => {
        page({ leagues: [OTHER, BALL, HOOPS], here: HOOPS.code, isAdmin: true });
        window.userState = { user_metadata: { metadata: { league: 'gg' } } };
        expect(window.ccManageLeagueCode()).toBe(HOOPS.code);
        delete window.userState;
    });

    // The basketball admin page (#518) names its league outright: it manages
    // the basketball league while an Admin is still viewing football, and a
    // League Manager's Auth0 flag never overrides it.
    test('a page that names its league manages that one, for anyone', () => {
        window.ADMIN_LEAGUE = HOOPS.code;
        try {
            page({ leagues: [OTHER, BALL, HOOPS], here: BALL.code, isAdmin: true });
            expect(window.ccManageLeagueCode()).toBe(HOOPS.code);
            page({ leagues: [BALL, HOOPS], here: BALL.code, isAdmin: false });
            window.userState = { user_metadata: { metadata: { league: 'gg' } } };
            expect(window.ccManageLeagueCode()).toBe(HOOPS.code);
        } finally { delete window.ADMIN_LEAGUE; delete window.userState; }
    });

    test('a League Manager manages their OWN, whatever they are viewing', () => {
        page({ leagues: [BALL, HOOPS], here: HOOPS.code, isAdmin: false });
        window.userState = { user_metadata: { metadata: { league: 'gg' } } };
        expect(window.ccManageLeagueCode()).toBe('graham-league');
        expect(window.ccLeagueCode()).toBe(HOOPS.code);     // viewing still moves
        delete window.userState;
    });
});

describe('nothing re-derives the league from the Auth0 flag any more', () => {
    // Eleven call sites across seven files did
    // `metadata.league == 'gg' ? 'graham-league' : 'claunts-league'`,
    // honouring the stored choice only for an Admin. The consequences were a
    // member's switch changing nothing but the chrome, and a basketball
    // league being unreachable from every one of those pages — the flag has
    // exactly two values.
    //
    // Six of the eleven have no behavioural test (their pages have no jsdom
    // harness), and a review proved it: all six could be reverted at once
    // with the whole suite green. This is the guard that makes that loud.
    // It is a weaker test than driving the page, and deliberately kept
    // alongside the ones that do.
    const PUBLIC = require('path').join(__dirname, '..', 'public');

    // league.js owns the fallback — twice, once for viewing and once for
    // managing — and weekly-recap keeps one for a page rendered without the
    // seed. Comments are stripped first, or the explanation of the old shape
    // counts as an instance of it.
    const ALLOWED = { 'league.js': 2, 'weekly-recap.js': 1 };
    const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

    test.each(
        require('fs').readdirSync(PUBLIC).filter(f => f.endsWith('.js'))
    )('%s', (file) => {
        const src = stripComments(require('fs').readFileSync(require('path').join(PUBLIC, file), 'utf8'));
        const hits = [...src.matchAll(/=== *['"]gg['"]|== *['"]gg['"]/g)].length;
        expect(hits).toBe(ALLOWED[file] || 0);
    });

    test('and the Admin-only localStorage override is gone from all of them', () => {
        const fs = require('fs');
        const offenders = fs.readdirSync(PUBLIC).filter(f => f.endsWith('.js')).filter(f => {
            const src = fs.readFileSync(require('path').join(PUBLIC, f), 'utf8');
            // "if you are an Admin, read leagueCode from storage" — the shape
            // that made every member's switch cosmetic.
            return /roles\?*\.?at\(-1\)\s*==.*Admin[\s\S]{0,160}localStorage\.getItem\(["']leagueCode/.test(src);
        });
        expect(offenders).toEqual([]);
    });
});

describe('the Admin page writes to the league it may MANAGE', () => {
    // public/admin.js has no jsdom harness, so this is structural. The
    // behaviour it guards is tested above on ccManageLeagueCode itself; what
    // can still regress is admin.js calling the wrong one of the two, and
    // the symptom is bad: a League Manager who holds two franchises switches
    // league and every write on the page 403s — roster blank, create-user
    // refused, rename refused — behind a generic toast.
    const src = require('fs').readFileSync(
        require('path').join(__dirname, '..', 'public', 'admin.js'), 'utf8');

    test('admin.js resolves its league through ccManageLeagueCode', () => {
        expect(src).toMatch(/ccManageLeagueCode\(\)/);
    });

    test('and never through the viewing one', () => {
        // ccManageLeagueCode contains ccLeagueCode as a substring, so the
        // check has to exclude the call that is part of the longer name.
        const viewing = [...src.matchAll(/(?<!Manage)\bccLeagueCode\(\)/g)];
        expect(viewing).toEqual([]);
    });
});

describe('the recap popup is remembered per LEAGUE', () => {
    // The popup follows the league being viewed now. With one global key a
    // two-league member got a single recap a week — for whichever league
    // they happened to open on Monday — and the other was suppressed.
    const SRC = require('fs').readFileSync(
        require('path').join(__dirname, '..', 'public', 'weekly-recap.js'), 'utf8');

    test('each league has its own key, and no league still has one', () => {
        (0, eval)(SRC);
        const k = window.ccRecap.seenKeyFor;
        expect(k('graham-league')).not.toBe(k('hoops-league'));
        expect(k('graham-league')).toContain('graham-league');
        expect(k(undefined)).toBe('ccRecapPopupSeen');
    });

    test('the gate and the write use the same key', () => {
        // A read and a write that disagree is a popup every single load, or
        // one that never shows again.
        const reads = [...SRC.matchAll(/getItem\(seenKeyFor\(/g)].length;
        const writes = [...SRC.matchAll(/setItem\(seenKeyFor\(/g)].length;
        expect({ reads, writes }).toEqual({ reads: 1, writes: 1 });
        expect(SRC).not.toMatch(/(get|set)Item\(SEEN_KEY\)/);
    });
});
