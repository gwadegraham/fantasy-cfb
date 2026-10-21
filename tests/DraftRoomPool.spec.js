// The HTML the draft room's pool table actually emits (#320).
//
// WHY THIS FILE EXISTS: everything else about this refactor was tested —
// buildPool was diffed against its predecessor over 582 input shapes — and a
// football regression shipped anyway, because the RENDERING had no tests. The
// `draft` column lost its `num` class, which is what right-aligns every Draft
// button and Drafted chip, and nothing noticed.
//
// So this asserts the markup, not the data. public/draftRoom.js is a browser
// global with no exports, so it is loaded into jsdom with the page it expects
// — the same approach tests/helpers/standings-dom.js takes for standings.js.

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM } = require('jsdom');

// The hooks renderPool queries in views/draftRoom.ejs.
const FIXTURE = `
<input id="poolSearch" value="">
<select id="poolConf"><option value=""></option></select>
<input type="checkbox" id="showDrafted">
<table class="pool-table"><thead><tr id="pool-head"></tr></thead><tbody user-table-body></tbody></table>
<div id="pool-cards"></div>
<span id="poolCount"></span>
`;

// Load draft-pool-view.js then draftRoom.js into one window, as the view's two
// deferred script tags do.
function room({ sport = 'football', pool = [], draft = null } = {}) {
    // `url` so jsdom provides a real localStorage; without an origin it is
    // undefined and setUserContext throws on load.
    // No `load` event: jsdom would fire window.onload, which runs the whole
    // init — fetch, socket, toasts. This test is about the pool table, so the
    // page is built and the render called directly.
    const dom = new JSDOM(`<!doctype html><body>${FIXTURE}</body>`,
        { runScripts: 'outside-only', url: 'http://localhost/draft-room' });
    const win = dom.window;

    // The chrome the navbar partial supplies. Stubbed as no-ops: a missing
    // one is a ReferenceError that reads as a rendering failure.
    for (const name of ['failToast', 'successToast']) {
        win[name] = { options: {}, showToast() {} };
    }

    // The globals the page's partials supply: userState from the navbar,
    // ccLogo from logo.js. Stubbed rather than loaded — this test is about
    // the pool table, not the chrome around it.
    win.userState = { user_metadata: {} };
    win.APP_YEAR = 2026;
    win.ccLogo = (logos) => (logos && logos[0]) || '';
    win.matchMedia = () => ({ matches: false });
    win.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
    win.io = () => ({ on() {}, emit() {}, close() {} });
    try { win.localStorage.setItem('leagueCode', 'graham-league'); } catch (e) { /* not needed to render */ }
    // The league the server rendered the room for. draftRoom.js asks
    // ccLeague for it now rather than re-deriving it from the Auth0 flag,
    // which is binary and so could never name a basketball league (#319
    // part 2) — league.js is loaded for real here so the page resolves it
    // exactly as it does in the browser.
    win.CC_LEAGUE = { code: 'graham-league', canSwitch: false, isAdmin: false, all: [
        { code: 'graham-league', name: 'Graham League', sport: 'football' }
    ] };

    for (const file of ['league.js', 'draft-pool-view.js', 'draftRoom.js']) {
        const src = fs.readFileSync(path.join(__dirname, '..', 'public', file), 'utf8');
        vm.runInContext(src, dom.getInternalVMContext(), { filename: file });
    }

    // Reach into the loaded script's own scope and render.
    const ctx = dom.getInternalVMContext();
    vm.runInContext(`
        poolSport = ${JSON.stringify(sport)};
        pool = ${JSON.stringify(pool)};
        draft = ${JSON.stringify(draft)};
        poolSort = ccDraftPool.defaultSort(poolSport, pool);
        renderPool();
    `, ctx);

    return {
        head: () => win.document.getElementById('pool-head').innerHTML,
        body: () => win.document.querySelector('[user-table-body]').innerHTML,
        cards: () => win.document.getElementById('pool-cards').innerHTML,
        run: (code) => vm.runInContext(code, ctx)
    };
}

const fbRow = (over = {}) => Object.assign({
    id: 333, name: 'Alabama', logo: 'a.png', conf: 'SEC',
    score: 180, xwins: 9.4, rank: 4, sp: 14.1, spRank: 7, scoreYear: 2025
}, over);

const hoopsRow = (over = {}) => Object.assign({
    id: 10, name: 'Duke', logo: 'd.png', conf: 'ACC',
    rank: 1, barthag: 0.9629, adjOE: 120.8, adjDE: 91, projectedRecord: '26-6'
}, over);

describe('football — the markup that has always rendered', () => {
    // THE REGRESSION THIS FILE WAS WRITTEN FOR. `.pool-table tbody td.num` is
    // what right-aligns a cell, so the action column needs it even though it
    // holds a button rather than a number.
    test('the Draft button cell is right-aligned', () => {
        const page = room({ pool: [fbRow()] });
        const cells = page.body().match(/<td[^>]*>/g);
        expect(cells[cells.length - 1]).toContain('num');
    });

    test('the Drafted chip is too', () => {
        const page = room({
            pool: [fbRow()],
            draft: { status: 'active', picks: [{ team: { id: 333 } }], onTheClock: {} }
        });
        // A drafted team is hidden unless "show drafted" is on, which is how
        // the board is normally read.
        page.run("document.getElementById('showDrafted').checked = true; renderPool();");
        expect(page.body()).toContain('drafted-chip');
        const cells = page.body().match(/<td[^>]*>/g);
        expect(cells[cells.length - 1]).toContain('num');
    });

    test('the numeric columns carry num and the text ones do not', () => {
        const page = room({ pool: [fbRow()] });
        const classes = [...page.body().matchAll(/<td class="([^"]*)"/g)].map(m => m[1].trim());
        // name, conf, sp, rank, score, xwins, draft
        expect(classes).toEqual(['', '', 'num', 'num', 'num', 'num', 'num']);
    });

    test('the SP+ badge keeps its rating in the title', () => {
        expect(room({ pool: [fbRow()] }).body())
            .toContain('<span class="sp-badge" title="SP+ rating 14.1">#7</span>');
    });

    test('a top-10 recruiting class keeps its highlight class', () => {
        expect(room({ pool: [fbRow({ rank: 4 })] }).body()).toContain('rank-badge top10');
        expect(room({ pool: [fbRow({ rank: 20 })] }).body()).toContain('rank-badge top25');
        expect(room({ pool: [fbRow({ rank: 90 })] }).body()).toMatch(/rank-badge\s*"/);
    });

    test('missing values render the em dash, not "null"', () => {
        const page = room({ pool: [fbRow({ spRank: null, rank: null, score: null })] });
        expect(page.body()).toContain('<span class="muted">—</span>');
        expect(page.body()).not.toContain('null');
    });

    test('the xWins bar keeps its wrapper, fill and inline width', () => {
        const html = room({ pool: [fbRow({ xwins: 9.4 }), fbRow({ id: 2, xwins: 2 })] }).body();
        expect(html).toContain('xwins-wrap');
        expect(html).toContain('xwins-bar');
        expect(html).toMatch(/xwins-fill" style="width:\d/);
    });

    test('the team name is escaped', () => {
        // Asserted on the angle brackets and ampersand rather than the whole
        // string: innerHTML round-trips a bare " in text as a ", so matching
        // the literal &quot; tests jsdom's serialiser, not the escaping.
        const html = room({ pool: [fbRow({ name: 'Auburn <&>"' })] }).body();
        expect(html).toContain('Auburn &lt;&amp;&gt;');
        expect(html).not.toContain('<span class="team-cell"><img src="a.png" alt="Auburn <&>');
    });

    test('the header is the football column set, in order', () => {
        const labels = [...room({ pool: [fbRow()] }).head().matchAll(/>([^<]*)<span class="arrow"/g)].map(m => m[1]);
        expect(labels).toEqual(['Team', 'Conference', 'SP+', 'Recruiting', 'Last Season', 'xWins']);
    });
});

describe('basketball', () => {
    test('the header is its own column set', () => {
        const labels = [...room({ sport: 'basketball', pool: [hoopsRow()] }).head()
            .matchAll(/>([^<]*)<span class="arrow"/g)].map(m => m[1]);
        expect(labels).toEqual(['Team', 'Conference', 'T-Rank', 'Power', 'Offense', 'Defense', 'Proj.']);
    });

    test('power is a percentage, not a four-decimal probability', () => {
        // 0.9629 on a draft board is noise; 96% is the thing being compared.
        expect(room({ sport: 'basketball', pool: [hoopsRow()] }).body()).toContain('96%');
    });

    test('the efficiencies and the projected record render', () => {
        const html = room({ sport: 'basketball', pool: [hoopsRow()] }).body();
        expect(html).toContain('120.8');
        expect(html).toContain('91');
        expect(html).toContain('26-6');
    });

    test('no football metric leaks into a basketball row', () => {
        const html = room({ sport: 'basketball', pool: [hoopsRow()] }).body();
        expect(html).not.toContain('sp-badge');
        expect(html).not.toContain('xwins');
    });

    test('its action cell is right-aligned too', () => {
        const cells = room({ sport: 'basketball', pool: [hoopsRow()] }).body().match(/<td[^>]*>/g);
        expect(cells[cells.length - 1]).toContain('num');
    });

    // Style tags (#542): under the name in the table AND on the phone card.
    test('style tags render under the name, in the table and on the card', () => {
        const tags = [{ key: 'slow', label: 'Slow pace', detail: 'Bottom 3% in pace' }, { key: 'elite-defense', label: 'Elite defense', detail: '#1 adjusted defense' }];
        const r = room({ sport: 'basketball', pool: [hoopsRow({ tags })] });
        const nameCell = r.body().match(/<td[^>]*>(.*?)<\/td>/)[1];
        expect(nameCell).toContain('class="dp-tags"');
        expect(nameCell).toContain('title="Bottom 3% in pace">Slow pace</span>');
        expect(nameCell).toContain('>Elite defense</span>');
        expect(r.cards()).toContain('>Slow pace</span>');
    });

    // Roster turnover (#541): the line under the name, table and card.
    test('the portal line renders under the name, in the table and on the card', () => {
        const turnover = { in: 4, out: 3, inTop: 1, outTop: 0, classRank: 12 };
        const r = room({ sport: 'basketball', pool: [hoopsRow({ turnover })] });
        const nameCell = r.body().match(/<td[^>]*>(.*?)<\/td>/)[1];
        expect(nameCell).toContain('class="dp-turnover"');
        expect(nameCell).toContain('>Portal +4 / \u22123 \u00b7 Class #12</span>');
        expect(r.cards()).toContain('>Portal +4 / \u22123 \u00b7 Class #12</span>');
    });

    test('no turnover on file, no portal line', () => {
        const r = room({ sport: 'basketball', pool: [hoopsRow({ turnover: null })] });
        expect(r.body()).not.toContain('dp-turnover');
        expect(r.cards()).not.toContain('dp-turnover');
    });

    test('a team with no tags renders no empty tag row', () => {
        const r = room({ sport: 'basketball', pool: [hoopsRow({ tags: [] })] });
        expect(r.body()).not.toContain('dp-tags');
        expect(r.cards()).not.toContain('dp-tags');
    });

    test('a missing metric is a dash rather than undefined', () => {
        const html = room({ sport: 'basketball', pool: [hoopsRow({ barthag: null, adjOE: null, projectedRecord: null })] }).body();
        expect(html).not.toContain('undefined');
        expect(html).not.toContain('null');
    });
});

describe('basketball — sorting and search', () => {
    const records = (r) => [...r.body().matchAll(/<td[^>]*>(\d+-\d+)<\/td>/g)].map(m => m[1]);

    test('Proj. opens best record first', () => {
        const r = room({ sport: 'basketball', pool: [
            hoopsRow({ id: 1, projectedRecord: '9-23' }),
            hoopsRow({ id: 2, projectedRecord: '25-7' }),
            hoopsRow({ id: 3, projectedRecord: '28-4' }),
            hoopsRow({ id: 4, projectedRecord: '25-6' })
        ] });
        r.run("sortPool('proj')");
        expect(records(r)).toEqual(['28-4', '25-6', '25-7', '9-23']);
    });

    // The reveal and its renderAll run after a timer; the search is cleared
    // before it, so the timer is stubbed out rather than waited on.
    const pickArrives = (r, teamId, userId) => r.run(`
        setTimeout = function () { return 0; };
        onPickMade({ pick: { userId: ${JSON.stringify(userId)}, round: 1, team: { id: ${teamId} } }, state: draft });
        document.getElementById('poolSearch').value;
    `);

    // Through makePick, with no stinger loaded: the id that marks the pick as
    // this client's must not depend on the sound effect being available.
    const clickDraft = (r, teamId) => r.run(`
        socket = { emit: function () {} };
        teamsById[${JSON.stringify(String(teamId))}] = { id: ${teamId}, school: 'X' };
        makePick(${teamId});
    `);

    test('a pick this client made clears the search', () => {
        const r = room({ sport: 'basketball', pool: [hoopsRow()] });
        r.run(`document.getElementById('poolSearch').value = 'duke';`);
        clickDraft(r, 10);
        expect(pickArrives(r, 10, 'me')).toBe('');
    });

    test("someone else's pick leaves a half-typed search alone", () => {
        // Even while this client's own Draft click is still in flight.
        const r = room({ sport: 'basketball', pool: [hoopsRow()] });
        clickDraft(r, 10);
        r.run(`document.getElementById('poolSearch').value = 'gonz';`);
        expect(pickArrives(r, 22, 'someone-else')).toBe('gonz');
    });
});

describe('a pool that could not be built', () => {
    // The message used to be painted once and then wiped by the first socket
    // update, because renderPool rewrites the table unconditionally. The
    // commissioner saw it flash and was left with the empty table it exists
    // to prevent.
    test('the message survives a re-render', () => {
        const page = room({ pool: [] });
        page.run(`showPoolError('None of the 365 teams carry a preseason rank');`);
        expect(page.body()).toContain('preseason rank');

        page.run('renderPool();');
        expect(page.body()).toContain('preseason rank');
        expect(page.cards()).toContain('preseason rank');
    });

    test('it spans the table rather than guessing a column count', () => {
        const page = room({ sport: 'basketball', pool: [] });
        page.run(`showPoolError('nope');`);
        expect(page.body()).toContain('colspan="8"');     // basketball has 8 columns

        const fb = room({ pool: [] });
        fb.run(`showPoolError('nope');`);
        expect(fb.body()).toContain('colspan="7"');       // football has 7
    });

    test('and the header is cleared, so no sortable columns remain', () => {
        const page = room({ pool: [] });
        page.run(`showPoolError('nope');`);
        expect(page.head()).toBe('');
    });
});

// The grades panel, for both sports. Basketball was hidden until it had a
// projection of its own (#482); now it renders, and its note names
// basketball's inputs — not SP+ and CFP odds.
describe('the draft grades panel', () => {
    async function grades(payload) {
        const page = room({ draft: { status: 'complete', picks: [] } });
        page.run(`
            document.body.insertAdjacentHTML('beforeend', '<div id="draft-grades-panel"></div>');
            renderDraftGrades = function (el, data, opts) { el.innerHTML = 'GRADES ' + opts.note; };
            fetch = function (url) {
                var body = String(url).indexOf('/draft/grades/') !== -1 ? ${JSON.stringify(payload)} : [];
                return Promise.resolve({ ok: true, json: function () { return Promise.resolve(body); } });
            };
            renderGrades();
        `);
        await new Promise(r => setTimeout(r, 0));
        await new Promise(r => setTimeout(r, 0));
        return page.run(`(function () { var el = document.getElementById('draft-grades-panel'); return el.style.display + '|' + el.innerHTML; })()`);
    }
    test('a basketball draft renders it, naming basketball\'s inputs', async () => {
        const out = await grades({ managers: [{ userId: 'x' }], sport: 'basketball' });
        expect(out).toMatch(/^\|GRADES /);
        expect(out).toContain('Torvik preseason ratings + NCAA tournament odds');
        expect(out).not.toContain('SP+');
        expect(out).not.toContain('CFP');
    });
    test('a football draft renders it, as before', async () => {
        const out = await grades({ managers: [{ userId: 'x' }] });
        expect(out).toMatch(/^\|GRADES /);
        expect(out).toContain('schedule + SP+ win odds + market CFP odds');
    });
});
