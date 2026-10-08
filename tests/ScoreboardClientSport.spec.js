// public/scoreboard.js on a basketball league (#490): it reads the
// basketball slate and labels the clock in halves. Loaded into jsdom with
// the globals the view sets, and its two functions called directly.

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM, VirtualConsole } = require('jsdom');

function page(sport) {
    // The page's own init runs on load and wants the full view's DOM; it is
    // not what this tests, so its errors go to a console nobody reads.
    const dom = new JSDOM('<!doctype html><body></body>', { runScripts: 'outside-only', url: 'http://localhost/scoreboard',
        virtualConsole: new VirtualConsole() });
    const ctx = dom.getInternalVMContext();
    vm.runInContext(`var APP_YEAR = '2027'; var LEAGUE_CODE = 'hoops-league';`
        + (sport ? ` var SPORT = '${sport}';` : ''), ctx);
    const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'scoreboard.js'), 'utf8');
    vm.runInContext(src, ctx, { filename: 'scoreboard.js' });
    return (code) => vm.runInContext(code, ctx);
}

describe('basketball', () => {
    const run = page('basketball');
    test('reads the basketball slate', () => {
        expect(run(`sbUrl(3, false)`)).toBe('/hoops/games/scoreboard/hoops-league/2027/3');
        expect(run(`sbUrl(null, true)`)).toBe('/hoops/games/scoreboard/hoops-league/2027?live=1');
    });
    test('halves, then overtimes', () => {
        const label = (p, c) => run(`clockLabel(${JSON.stringify({ period: p, clock: c })})`);
        expect(label(1, '14:02')).toBe('1st 14:02');
        expect(label(2, '0:41')).toBe('2nd 0:41');
        expect(label(3, '2:10')).toBe('OT 2:10');
        expect(label(4, null)).toBe('2OT');
    });
});

describe('football is unchanged', () => {
    const run = page('football');
    test('its own slate and quarters', () => {
        expect(run(`sbUrl(3, false)`)).toBe('/games/scoreboard/hoops-league/2027/3');
        expect(run(`clockLabel({ period: 3, clock: '8:42' })`)).toBe('Q3 8:42');
        expect(run(`clockLabel({ period: 5, clock: null })`)).toBe('OT');
    });
    test('a page without SPORT (an older view) is football', () => {
        expect(page(null)(`sbUrl(3, false)`)).toBe('/games/scoreboard/hoops-league/2027/3');
    });
});
