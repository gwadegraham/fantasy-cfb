/**
 * @jest-environment jsdom
 *
 * public/hoopsPreseason.js — the Preseason ratings card (#544). Asserts what
 * the commissioner reads (what is on file, the lock, the comparison) and what
 * each tap sends: nothing is written on Preview, Apply needs a second tap, and
 * Apply sends back exactly the rows the preview checked.
 */

const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'hoopsPreseason.js'), 'utf8');
const KIT = fs.readFileSync(path.join(__dirname, '..', 'public', 'sport-page.js'), 'utf8');
beforeAll(() => { (0, eval)(KIT); });

const info = (o) => Object.assign({
    season: 2027, locked: false, url: 'https://barttorvik.com/2027_team_results.json',
    current: { teams: 365, ranked: 365, sources: 1, importedAt: '2026-09-30T12:00:00.000Z',
        source: 'barttorvik.com T-Rank preseason projections, pasted 30 Sep 2026',
        top: [{ rank: 1, school: 'Duke' }, { rank: 2, school: 'Arizona' }] }
}, o || {});

const ROWS = [{ rank: 1, school: 'Duke' }, { rank: 2, school: 'Kansas' }];
const PREVIEW = {
    ok: true, origin: 'fetch', locked: false, problems: [],
    counts: { ratings: 365, teams: 365, matched: 365 },
    source: 'barttorvik.com T-Rank preseason, fetched from barttorvik.com (2027_team_results.json), 2026-10-14',
    compare: {
        pool: 120,
        currentTop: [{ rank: 1, school: 'Duke' }, { rank: 2, school: 'Arizona' }],
        newTop: [{ rank: 1, school: 'Duke', was: 1 }, { rank: 2, school: 'Kansas', was: 11 }],
        joinsPool: [{ school: 'Southern Utah', rank: 119, was: 199 }],
        leavesPool: [{ school: 'UC Davis', rank: 124, was: 118 }],
        movers: [{ school: 'Kansas', rank: 2, was: 11 }, { school: 'Iowa State', rank: 30, was: 9 }]
    },
    rows: ROWS
};

const json = (body, code = 200) => Promise.resolve({
    ok: code < 400, status: code,
    json: () => Promise.resolve(body), text: () => Promise.resolve(JSON.stringify(body))
});
const flush = async () => { for (let i = 0; i < 8; i++) await new Promise(r => setTimeout(r, 0)); };

async function render(body, routes = {}) {
    document.body.innerHTML = '<section id="hoops-preseason"></section>';
    global.fetch = jest.fn((url, opts) => {
        const key = ((opts && opts.method) || 'GET') + ' ' + url;
        if (routes[key]) return routes[key](opts);
        if (url === '/hoops/admin/preseason') return json(typeof body === 'function' ? body() : body);
        return Promise.reject(new Error('unexpected ' + key));
    });
    (0, eval)(SRC);
    await flush();
    return document.getElementById('hoops-preseason');
}
const click = async (sel) => { document.querySelector(sel).click(); await flush(); };
const posts = () => global.fetch.mock.calls.filter(c => c[1] && c[1].method === 'POST');

test('shows what is on file, and when and from what it was imported', async () => {
    const root = await render(info());
    const text = root.textContent;
    expect(text).toContain('365 / 365 teams ranked');
    expect(text).toMatch(/Imported Sep 30, 2026 — barttorvik\.com T-Rank preseason projections, pasted 30 Sep 2026/);
    expect(text).toContain('barttorvik.com/2027_team_results.json');
    expect(text).not.toContain('Locked');
});

test('never imported, and a mixed set, both say so', async () => {
    let root = await render(info({ current: { teams: 365, ranked: 0, sources: 0, source: null, importedAt: null, top: [] } }));
    expect(root.textContent).toContain('Never imported');
    root = await render(info({ current: { teams: 365, ranked: 365, sources: 2, source: 'b', importedAt: '2026-10-01T00:00:00Z', top: [] } }));
    expect(root.textContent).toContain('2 different imports are mixed on file');
});

test('Fetch previews and writes nothing; the comparison is shown', async () => {
    const root = await render(info(), { 'POST /hoops/admin/preseason/preview': () => json(PREVIEW) });
    await click('[data-pre-fetch]');
    expect(posts()).toHaveLength(1);
    expect(JSON.parse(posts()[0][1].body)).toEqual({ fetch: true });
    const text = root.textContent;
    expect(text).toContain('All checks passed: 365 ratings, 365 / 365 teams matched.');
    expect(text).toContain('Will be stamped: ' + PREVIEW.source);
    expect(text).toContain('Joins the top 120: Southern Utah (199→119)');
    expect(text).toContain('Leaves the top 120: UC Davis (118→124)');
    const lists = root.querySelectorAll('.ha-pre-list');
    expect(lists[0].textContent).toContain('Arizona');            // now
    expect(lists[1].textContent).toMatch(/Kansas\s*▲9/);         // new, with its move
    expect(lists[2].textContent).toMatch(/Iowa State\s*▼21/);     // movers
});

test('Preview paste sends the textarea as text/plain', async () => {
    await render(info(), { 'POST /hoops/admin/preseason/preview': () => json(PREVIEW) });
    document.querySelector('[data-pre-text]').value = '[[1,"Duke"]]';
    await click('[data-pre-preview]');
    expect(posts()[0][1].headers['Content-Type']).toBe('text/plain');
    expect(posts()[0][1].body).toBe('[[1,"Duke"]]');
});

test('Apply takes two taps and sends back exactly the previewed rows', async () => {
    let applied = false;
    const root = await render(() => info(applied ? { current: { teams: 365, ranked: 365, sources: 1,
        source: PREVIEW.source, importedAt: '2026-10-14T12:00:00Z', top: [] } } : {}), {
        'POST /hoops/admin/preseason/preview': () => json(PREVIEW),
        'POST /hoops/admin/preseason/apply': () => { applied = true; return json({ ok: true, stamped: 365, teams: 365 }); }
    });
    await click('[data-pre-fetch]');
    await click('[data-pre-apply]');
    expect(posts()).toHaveLength(1);                                // armed, not sent
    expect(root.querySelector('[data-pre-confirm]').textContent).toBe('Write 365 teams');
    await click('[data-pre-confirm]');
    expect(posts()).toHaveLength(2);
    expect(JSON.parse(posts()[1][1].body)).toEqual({ rows: ROWS, origin: 'fetch' });
    expect(root.textContent).toContain('Imported: 365 / 365 teams now carry a preseason rank.');
    // What is on file is re-read after the write.
    expect(root.textContent).toMatch(/Imported Oct 14, 2026/);
});

test('Cancel disarms Apply', async () => {
    await render(info(), { 'POST /hoops/admin/preseason/preview': () => json(PREVIEW) });
    await click('[data-pre-fetch]');
    await click('[data-pre-apply]');
    await click('[data-pre-cancel]');
    expect(document.querySelector('[data-pre-apply]')).not.toBeNull();
    expect(document.querySelector('[data-pre-confirm]')).toBeNull();
});

test('a failed check lists the problems and offers no Apply', async () => {
    const root = await render(info(), { 'POST /hoops/admin/preseason/preview': () => json({ ok: false, problems: ['UNMATCHED  Foo', 'NO RATING  Bar'] }, 200) });
    await click('[data-pre-fetch]');
    expect(root.textContent).toContain('Not imported.');
    expect(root.textContent).toContain('UNMATCHED  Foo');
    expect(root.querySelector('[data-pre-apply]')).toBeNull();
});

test('a server error with only a message still says why', async () => {
    const root = await render(info(), { 'POST /hoops/admin/preseason/preview': () => json({ message: 'No active basketball season' }, 409) });
    await click('[data-pre-fetch]');
    expect(root.textContent).toContain('No active basketball season');
});

test('locked: the lock is explained and Apply is not offered', async () => {
    const root = await render(info({ locked: true }), { 'POST /hoops/admin/preseason/preview': () => json(Object.assign({}, PREVIEW, { locked: true })) });
    expect(root.textContent).toMatch(/Locked: basketball 2027 has scored games/);
    await click('[data-pre-fetch]');
    expect(root.querySelector('[data-pre-apply]')).toBeNull();
    expect(root.querySelector('.ha-actions button[disabled]').textContent).toBe('Locked');
});

test('Apply refused by the server (e.g. locked in between) shows why and re-reads what is on file', async () => {
    const root = await render(info(), {
        'POST /hoops/admin/preseason/preview': () => json(PREVIEW),
        'POST /hoops/admin/preseason/apply': () => json({ message: 'Locked: basketball 2027 already has scored games.' }, 423)
    });
    await click('[data-pre-fetch]');
    await click('[data-pre-apply]');
    const reads = global.fetch.mock.calls.filter(c => c[0] === '/hoops/admin/preseason').length;
    await click('[data-pre-confirm]');
    expect(root.textContent).toContain('Locked: basketball 2027 already has scored games.');
    expect(global.fetch.mock.calls.filter(c => c[0] === '/hoops/admin/preseason').length).toBe(reads + 1);
});

test('an unreadable reply (Heroku\'s HTML timeout page) is reported, not thrown', async () => {
    const root = await render(info(), {
        'POST /hoops/admin/preseason/preview': () => Promise.resolve({ ok: false, status: 503, text: () => Promise.resolve('<html>') })
    });
    await click('[data-pre-fetch]');
    expect(root.textContent).toContain('No reply the page could read (HTTP 503)');
});
