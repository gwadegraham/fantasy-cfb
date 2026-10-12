// Every EJS view compiles. A syntax error inside <% %> (a stray backslash
// escape in #490's scoreboard line) breaks res.render for EVERY request to
// that page, and nothing else catches it: most view tests read the file as
// text, and client tests set the page's globals themselves.

const fs = require('fs');
const path = require('path');
const ejs = require('ejs');

const VIEWS = path.join(__dirname, '..', 'views');
const all = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap(d =>
    d.isDirectory() ? all(path.join(dir, d.name)) : d.name.endsWith('.ejs') ? [path.join(dir, d.name)] : []);

test.each(all(VIEWS).map(f => [path.relative(VIEWS, f), f]))('%s compiles', (_, file) => {
    expect(() => ejs.compile(fs.readFileSync(file, 'utf8'), { filename: file })).not.toThrow();
});

test('the scoreboard tells its script which sport it is showing', () => {
    const file = path.join(VIEWS, 'scoreboard.ejs');
    const line = fs.readFileSync(file, 'utf8').split('\n').find(l => l.includes('var SPORT'));
    const render = (locals) => ejs.render(line, locals);
    expect(render({ viewerSport: 'basketball' }).trim()).toBe("var SPORT = 'basketball';");
    expect(render({}).trim()).toBe("var SPORT = 'football';");
});

// #501: basketball's Games tile scripts load on a basketball league only —
// a football manager's My Team page must not even name them (basketball
// stays invisible, and football's page is unchanged).
test('My Team loads the basketball Games tile only on a basketball league', () => {
    const file = path.join(VIEWS, 'userHome.ejs');
    const src = fs.readFileSync(file, 'utf8');
    const block = src.slice(src.indexOf('<% if (typeof viewerSport'), src.indexOf('<% } %>') + 7);
    expect(block).toContain('hoops-week-games.js');
    const render = (locals) => ejs.render(block, locals);
    expect(render({ viewerSport: 'basketball' })).toMatch(/hoops-week-games\.js[\s\S]*sport-page\.css|sport-page\.css[\s\S]*hoops-week-games\.js/);
    expect(render({ viewerSport: 'football' })).not.toMatch(/hoops|sport-page/);
    expect(render({})).not.toMatch(/hoops|sport-page/);
});
