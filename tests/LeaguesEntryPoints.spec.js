// The ways in to the Leagues page (#536): a "Leagues" link on both sports'
// admin pages, and "Manage leagues" at the bottom of the league switcher —
// all of them for Admins only. A League Manager manages their own league on
// /admin and cannot open /leagues, so a link would be a door to a 404.
//
// The templates are rendered for real: the gates are template logic and
// nothing else exercises them.

const fs = require('fs');
const path = require('path');
const ejs = require('ejs');

const VIEWS = path.join(__dirname, '..', 'views');
const NAVBAR = path.join(VIEWS, 'partials', 'navbar.ejs');

const BALL = { code: 'graham-league', name: 'The Polar Depressed', sport: 'football' };
const OTHER = { code: 'claunts-league', name: 'Goofballers', sport: 'football' };
const HOOPS = { code: 'hoops-league', name: 'Hardwood Heroes', sport: 'basketball' };

function navbar(role, leagues) {
    return ejs.render(fs.readFileSync(NAVBAR, 'utf8'), {
        user: { role }, leagues: [OTHER, BALL, HOOPS], viewerLeagues: leagues,
        viewerCanSwitch: true, viewerLeagueCode: BALL.code, sportIcon: 'fa-football'
    }, { filename: NAVBAR });
}
const select = (html) => (/<select[^>]*league-select[\s\S]*?<\/select>/.exec(html) || [''])[0];
const sheet = (html) => (/<div class="league-sheet"[\s\S]*?<\/div>\s*<\/div>/.exec(html) || [''])[0];

describe('the league switcher', () => {
    test('an Admin gets "Manage leagues" as its LAST option, with no league value', () => {
        const opts = [...select(navbar('Admin', [OTHER, BALL, HOOPS])).matchAll(/<option([^>]*)>([^<]*)<\/option>/g)];
        const last = opts[opts.length - 1];
        expect(last[2]).toBe('Manage leagues…');
        expect(last[1]).toContain('data-href="/leagues"');
        // Empty, so nothing that reads the options as leagues takes it for one.
        expect(last[1]).toContain('value=""');
        // The separator before it cannot be chosen.
        expect(opts[opts.length - 2][1]).toContain('disabled');
    });

    test.each([['a member', ''], ['a League Manager', 'League Manager']])('%s does not', (_, role) => {
        const html = navbar(role, [BALL, HOOPS]);
        expect(select(html)).not.toBe('');
        expect(html).not.toContain('Manage leagues');
        expect(html).not.toContain('href="/leagues"');
    });

    test('the phone sheet ends with it too, for an Admin only', () => {
        const admin = sheet(navbar('Admin', [OTHER, BALL, HOOPS]));
        expect(admin).toContain('<a class="league-sheet-row league-sheet-manage" href="/leagues">');
        const rows = [...admin.matchAll(/class="league-sheet-row[^"]*"/g)];
        expect(rows[rows.length - 1][0]).toContain('league-sheet-manage');
        expect(sheet(navbar('', [OTHER, BALL, HOOPS]))).not.toContain('Manage leagues');
    });
});

describe('the admin pages', () => {
    const ADMIN = path.join(VIEWS, 'admin.ejs');
    const admin = (isAdmin) => ejs.render(fs.readFileSync(ADMIN, 'utf8'), {
        user: { userId: 'u1', firstName: 'Garrett', role: isAdmin ? 'Admin' : 'League Manager' },
        userState: '{}', year: 2026, isAdmin, draftDefaults: '{}'
    }, { filename: ADMIN });
    // The page body: the navbar above it carries its own Admin-only link.
    const body = (html) => html.slice(html.indexOf('<div class="header">'));

    test("football's /admin links to it for an Admin", () => {
        expect(body(admin(true))).toContain('<nav class="admin-leagues-link"><a href="/leagues">');
    });

    // #600: a League Manager may create a league, so they get the link; an
    // appointed commissioner without the role (canCreateLeague false) not.
    test('for a League Manager who may create one, and not for anyone who may not', () => {
        const as = (canCreateLeague) => ejs.render(fs.readFileSync(ADMIN, 'utf8'), {
            user: { userId: 'u1', firstName: 'Jeff', role: 'League Manager' },
            userState: '{}', year: 2026, isAdmin: false, canCreateLeague, draftDefaults: '{}'
        }, { filename: ADMIN });
        expect(body(as(true))).toContain('<nav class="admin-leagues-link"><a href="/leagues">');
        expect(body(as(false))).not.toContain('/leagues"');
        expect(body(admin(false))).not.toContain('/leagues"');
    });

    const HOOPS_ADMIN = path.join(VIEWS, 'hoopsAdmin.ejs');
    const hoops = (locals) => ejs.render(fs.readFileSync(HOOPS_ADMIN, 'utf8'), Object.assign({
        user: { userId: 'u1', firstName: 'Garrett', role: 'Admin' }, userState: '{}', year: 2027,
        draftDefaults: '{}', manageLeague: null, manageLeagueName: null
    }, locals), { filename: HOOPS_ADMIN });

    test('/hoops/admin links to it for whoever may create a league', () => {
        expect(hoops({ isAdmin: true, canCreateLeague: true })).toContain('<nav class="admin-leagues-link"><a href="/leagues">');
        expect(hoops({ isAdmin: false, canCreateLeague: false })).not.toContain('<nav class="admin-leagues-link">');
    });
});
