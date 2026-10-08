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
