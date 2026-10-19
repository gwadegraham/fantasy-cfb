// The logged-out root (server.js, app.get('/')) is the only place a link
// preview for campusclash.io itself can come from. Its card is named inline
// there rather than in a module, so read the path out of the source and check
// the file it points at: a renamed or deleted card would otherwise unfurl as
// a broken image with every test still green.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

test('the root share card exists and is really 1200x630', () => {
    const src = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
    const m = src.match(/const OG_IMAGE = SITE \+ '([^']+)'/);
    expect(m).not.toBeNull();
    expect(m[1]).toBe('/images/campus-clash-parent-og.png');

    const png = fs.readFileSync(path.join(ROOT, m[1]));
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1200, 630]);
});
