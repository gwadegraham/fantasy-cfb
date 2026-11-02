// public/scoreboard.js — "which ones are mine?" (#638): the viewer's own
// ownership badges carry .is-me, and the "My teams" chip keeps only games
// one of their teams plays in. Loaded into jsdom with the globals the view
// sets, and its functions called directly (as ScoreboardClientSport does).

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM, VirtualConsole } = require('jsdom');

function page(me) {
    const dom = new JSDOM('<!doctype html><body></body>', { runScripts: 'outside-only', url: 'http://localhost/scoreboard',
        virtualConsole: new VirtualConsole() });
    const ctx = dom.getInternalVMContext();
    vm.runInContext(`var APP_YEAR = '2027'; var LEAGUE_CODE = 'hoops-league'; var SPORT = 'basketball';`
        + ` var userState = ${JSON.stringify(me ? { user_metadata: { metadata: { userId: me } } } : {})};`, ctx);
    const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'scoreboard.js'), 'utf8');
    vm.runInContext(src, ctx, { filename: 'scoreboard.js' });
    return (code) => vm.runInContext(code, ctx);
}

const owner = (userId) => ({ userId, name: 'M ' + userId, initials: 'M', color: '#333' });
const side = (id, o) => ({ id, team: 'T' + id, conference: 'X', owner: o || null });
const GAMES = [
    { id: 1, leagueGame: true, ranked: false, home: side(1, owner('me')), away: side(2) },
    { id: 2, leagueGame: true, ranked: false, home: side(3, owner('other')), away: side(4) },
    { id: 3, leagueGame: true, ranked: false, home: side(5, owner('other')), away: side(6, owner('me')) },
    { id: 4, leagueGame: false, ranked: true, home: side(7), away: side(8) }
];

test('"My teams" keeps only games one of the viewer\'s teams plays in', () => {
    const run = page('me');
    run(`sbState.games = ${JSON.stringify(GAMES)}; sbState.conf = ''; sbState.filter = 'mine';`);
    expect(run('visibleGames().map(g => g.id)')).toEqual([1, 3]);
    run(`sbState.filter = 'league';`);
    expect(run('visibleGames().map(g => g.id)')).toEqual([1, 2, 3]);
});

test('"My teams" is empty, not everything, without a viewer', () => {
    const run = page(null);
    run(`sbState.games = ${JSON.stringify(GAMES)}; sbState.conf = ''; sbState.filter = 'mine';`);
    expect(run('visibleGames().length')).toBe(0);
});

test('only the viewer\'s own badges are marked', () => {
    const run = page('me');
    expect(run(`ownerHtml(${JSON.stringify(side(1, owner('me')))})`)).toContain('class="sb-owner is-me"');
    expect(run(`ownerHtml(${JSON.stringify(side(3, owner('other')))})`)).toContain('class="sb-owner"');
});

test('the view offers the chip', () => {
    const view = fs.readFileSync(path.join(__dirname, '..', 'views', 'scoreboard.ejs'), 'utf8');
    expect(view).toMatch(/data-filter="mine"[^>]*>My teams</);
});
