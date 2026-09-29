// The CFP bracket link is Admin-only, so the gate IS the feature — a partial
// that renders it for everyone is not a cosmetic slip, it puts a page showing a
// projected twelve-team field in front of the whole league in September.
//
// Rendered through ejs against the real views/partials/navbar.ejs rather than
// asserted on a string, so a later refactor of the surrounding markup can't
// quietly drop the `_role` check while a substring test still passes.

const ejs = require('ejs');
const fs = require('fs');
const path = require('path');

const NAVBAR = path.join(__dirname, '..', 'views', 'partials', 'navbar.ejs');
const template = fs.readFileSync(NAVBAR, 'utf8');

// Only `user` is required; everything else the partial reads is typeof-guarded.
const render = (role) => ejs.render(template, {
    user: { userId: 'u1', firstName: 'Garrett', role: role }
}, { filename: NAVBAR });

const ROLES = ['Admin', 'League Manager', 'Member', ''];

describe('the CFP bracket nav link', () => {
    test('is there for an Admin', () => {
        expect(render('Admin')).toContain('href="/cfp-bracket"');
    });

    test.each(ROLES.filter(r => r !== 'Admin'))('is not there for %s', (role) => {
        expect(render(role)).not.toContain('/cfp-bracket');
    });

    // A missing/!== comparison that happened to hide the link from everyone
    // would pass every negative case above on its own.
    test('exactly one role sees it', () => {
        const seen = ROLES.filter(r => render(r).includes('/cfp-bracket'));
        expect(seen).toEqual(['Admin']);
    });

    // The gate is Admin-only, tighter than the League Management link beside it,
    // so a copy-paste of the wrong condition is the likely way to break this.
    test('League Manager still gets its own link but not this one', () => {
        const html = render('League Manager');
        expect(html).toContain('href="/admin"');
        expect(html).not.toContain('/cfp-bracket');
    });
});
