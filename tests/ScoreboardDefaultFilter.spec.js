// public/scoreboard.js (#640): Scores opens on "My league" instead of ~300
// games under "All", remembers the chip a viewer picks, and says "score
// pending" on a game that reads live before either feed has scored it.
// Loaded into jsdom the way ScoreboardMyTeams.spec.js does it.

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM, VirtualConsole } = require('jsdom');

function page({ sport = 'basketball', storage } = {}) {
    const dom = new JSDOM('<!doctype html><body></body>', { runScripts: 'outside-only', url: 'http://localhost/scoreboard',
        virtualConsole: new VirtualConsole() });
    if (storage) Object.defineProperty(dom.window, 'localStorage', { get: storage, configurable: true });
    const ctx = dom.getInternalVMContext();
    vm.runInContext(`var APP_YEAR = '2027'; var LEAGUE_CODE = 'x'; var SPORT = '${sport}'; var userState = {};`, ctx);
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'scoreboard.js'), 'utf8'), ctx, { filename: 'scoreboard.js' });
    return { run: (code) => vm.runInContext(code, ctx), window: dom.window };
}

const LEAGUE_WEEK = JSON.stringify([{ leagueGame: false }, { leagueGame: true }]);
const NO_LEAGUE_WEEK = JSON.stringify([{ leagueGame: false }, { leagueGame: false }]);

describe('the opening filter', () => {
    test('is "My league" when the week has league games', () => {
        expect(page().run(`defaultFilter(${LEAGUE_WEEK})`)).toBe('league');
    });

    test('falls back to "All" with no league games (no league, or none playing)', () => {
        const { run } = page();
        expect(run(`defaultFilter(${NO_LEAGUE_WEEK})`)).toBe('all');
        expect(run('defaultFilter([])')).toBe('all');
    });

    test('is the chip the viewer picked last time, per sport', () => {
        const hoops = page();
        hoops.run(`saveFilter('top25')`);
        expect(hoops.run(`defaultFilter(${LEAGUE_WEEK})`)).toBe('top25');
        expect(hoops.window.localStorage.getItem('sbFilter:basketball')).toBe('top25');
        // A remembered "All" is honoured too, not overridden by the default.
        hoops.run(`saveFilter('all')`);
        expect(hoops.run(`defaultFilter(${LEAGUE_WEEK})`)).toBe('all');
        expect(page({ sport: 'football' }).run(`defaultFilter(${LEAGUE_WEEK})`)).toBe('league');
    });

    test('a remembered chip that would open on nothing falls back to "All"', () => {
        const p = page();
        p.run(`saveFilter('league')`);
        expect(p.run(`defaultFilter(${NO_LEAGUE_WEEK})`)).toBe('all');
        expect(p.run(`defaultFilter(${LEAGUE_WEEK})`)).toBe('league');
        // "My teams" with none of the viewer's teams playing (no viewer here).
        p.run(`saveFilter('mine')`);
        expect(p.run(`defaultFilter(${LEAGUE_WEEK})`)).toBe('all');
    });

    test('a conference the new week lacks drops back to "All", not the hidden default', () => {
        const p = page();
        p.window.document.body.innerHTML = '<select id="conf-filter"><option value="SEC">SEC</option></select>';
        p.run(`document.getElementById('conf-filter').value = 'SEC'; sbState.filter = 'league'; renderConfOptions([{ name: 'ACC', label: 'ACC' }]);`);
        expect(p.run('[sbState.filter, sbState.conf]')).toEqual(['all', '']);
    });

    test('ignores a stored value that is not a chip', () => {
        const p = page();
        p.window.localStorage.setItem('sbFilter:basketball', 'SEC');
        expect(p.run(`defaultFilter(${LEAGUE_WEEK})`)).toBe('league');
    });

    test('still works when storage throws (private mode, blocked site data)', () => {
        const p = page({ storage: () => { throw new Error('denied'); } });
        expect(() => p.run(`saveFilter('top25')`)).not.toThrow();
        expect(p.run(`defaultFilter(${LEAGUE_WEEK})`)).toBe('league');
    });
});

describe('a live game with no score yet', () => {
    const live = (home, away, extra = {}) => JSON.stringify(Object.assign({
        state: 'live', period: null, clock: null, home: { points: home }, away: { points: away }
    }, extra));

    test('says the score is pending', () => {
        expect(page().run(`stateLabel(${live(null, null)})`)).toBe('Live · score pending');
    });

    test('shows the clock alone once a score is in', () => {
        expect(page().run(`stateLabel(${live(30, 29, { period: 1, clock: '6:09' })})`)).toBe('1st 6:09');
    });

    test('leaves upcoming and final games alone', () => {
        const { run } = page();
        expect(run(`stateLabel(${live(null, null, { state: 'final' })})`)).toBe('Final');
        expect(run(`window.ccKickoff = { time: () => '7:00 PM' }; stateLabel(${live(null, null, { state: 'pre' })})`)).toBe('7:00 PM');
    });
});
