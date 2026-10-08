/**
 * @jest-environment jsdom
 *
 * public/hoopsAdmin.js — the basketball admin page (#518). Asserts what the
 * admin reads and what a tap actually sends: the season each task runs
 * against, that no billable call goes out on the first tap, what a run
 * reports back, and the last-run lines.
 */

const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'hoopsAdmin.js'), 'utf8');
const KIT = fs.readFileSync(path.join(__dirname, '..', 'public', 'sport-page.js'), 'utf8');
beforeAll(() => { (0, eval)(KIT); });

function status(o) {
    return Object.assign({
        season: 2027, seasonStatus: 'preseason',
        onFile: {
            teams: { teams: 365, withLogos: 264 },
            games: { games: 5286, finals: 12, lastFinal: '2026-11-04T01:00:00.000Z' },
            roster: { players: 0, teams: 0, fetchedAt: null }
        },
        calls: { ingest: 1, schedule: 9, refresh: 1, roster: 1 },
        jobs: [
            { jobName: 'hoops-scores', status: 'error', startedAt: new Date().toISOString(), message: 'CBBD 500' },
            { jobName: 'hoops-live', status: null }
        ]
    }, o || {});
}

const json = (body, code = 200) => Promise.resolve({
    ok: code < 400, status: code,
    json: () => Promise.resolve(body), text: () => Promise.resolve(JSON.stringify(body))
});
const flush = async () => { for (let i = 0; i < 6; i++) await new Promise(r => setTimeout(r, 0)); };

// routes: { 'POST /hoops/teams/2027/ingest': () => json(...) }
async function render(body, routes = {}) {
    document.body.innerHTML = '<main id="hoops-admin"></main>';
    global.fetch = jest.fn((url, opts) => {
        const key = ((opts && opts.method) || 'GET') + ' ' + url;
        if (routes[key]) return routes[key](opts);
        if (url === '/hoops/admin/status') return json(body);
        if (url === '/games/info') return json({ remainingCalls: 28123 });
        return Promise.reject(new Error('unexpected ' + key));
    });
    (0, eval)(SRC);
    await flush();
    return document.getElementById('hoops-admin');
}
const task = (k) => document.querySelector('[data-task="' + k + '"]');
const posts = () => global.fetch.mock.calls.filter(c => c[1] && c[1].method === 'POST');

beforeEach(() => window.localStorage.clear());
afterEach(() => { delete window.ccHoopsAdmin; });

test('the season, in both spellings, and the pool', async () => {
    const root = await render(status());
    const season = root.querySelector('.ha-season').textContent;
    expect(season).toContain('2026–27');
    expect(season).toContain('CBBD season 2027');
    expect(season).toContain('preseason');
    expect(season).toContain('28,123 API calls left');
});

test('one card per task, each naming the endpoint it calls with the active season', async () => {
    await render(status());
    expect(Array.from(document.querySelectorAll('[data-task]')).map(n => n.getAttribute('data-task')))
        .toEqual(['ingest', 'schedule', 'refresh', 'roster']);
    expect(task('ingest').textContent).toContain('POST /hoops/teams/2027/ingest');
    expect(task('schedule').textContent).toContain('POST /hoops/games/2027/schedule');
    expect(task('refresh').textContent).toContain('POST /hoops/games/refresh');
    expect(task('roster').textContent).toContain('POST /hoops/teams/2027/roster');
});

test('what is on file for each task', async () => {
    await render(status());
    expect(task('ingest').textContent).toContain('365 teams, 264 with logos');
    expect(task('schedule').textContent).toContain('5,286 games on file');
    expect(task('refresh').textContent).toContain('12 finals');
    expect(task('roster').textContent).toContain('0 numbered players on 0 teams');
});

test('the first tap costs nothing: it shows the call count and waits', async () => {
    await render(status());
    task('schedule').querySelector('[data-arm]').click();
    expect(posts()).toHaveLength(0);
    expect(task('schedule').textContent).toContain('Run — 9 CBBD calls');
    expect(task('schedule').querySelector('.ha-warn').textContent).toContain('28,123 left');
    // Cancel backs out without a call.
    task('schedule').querySelector('[data-cancel]').click();
    expect(task('schedule').querySelector('[data-confirm]')).toBeNull();
    expect(posts()).toHaveLength(0);
});

test('the second tap runs it, against the active season, and reports the reply', async () => {
    const ingest = jest.fn(() => json({ season: 2027, created: 3, updated: 362, teams: 365, withLogos: 264, remainingCalls: 28100 }));
    await render(status(), { 'POST /hoops/teams/2027/ingest': ingest });
    task('ingest').querySelector('[data-arm]').click();
    task('ingest').querySelector('[data-confirm]').click();
    await flush();
    expect(ingest).toHaveBeenCalledTimes(1);
    expect(task('ingest').textContent).toContain('3 created, 362 updated · 365 teams, 264 with logos');
    // The reply's remainingCalls replaces the stale /info figure.
    expect(document.querySelector('.ha-season').textContent).toContain('28,100 API calls left');
    // The counts are re-read after a run.
    expect(global.fetch.mock.calls.filter(c => c[0] === '/hoops/admin/status')).toHaveLength(2);
});

test('refresh and schedule send the season type chosen; refresh sends the season in the body', async () => {
    const refresh = jest.fn(() => json({ season: 2027, seasonType: 'postseason', games: 4, finals: 4, created: 0, updated: 4 }));
    await render(status(), { 'POST /hoops/games/refresh': refresh });
    const sel = task('refresh').querySelector('[data-type]');
    sel.value = 'postseason';
    task('refresh').querySelector('[data-arm]').click();
    // The choice survives the re-render the first tap causes.
    expect(task('refresh').querySelector('[data-type]').value).toBe('postseason');
    task('refresh').querySelector('[data-confirm]').click();
    await flush();
    expect(JSON.parse(refresh.mock.calls[0][0].body)).toEqual({ season: 2027, seasonType: 'postseason' });
    expect(task('refresh').textContent).toContain('4 games, 4 final');
});

test('a refused run says why, with the status', async () => {
    await render(status(), {
        'POST /hoops/teams/2027/roster': () => json({ message: 'Season 2026 is not the stored basketball season (2027).' }, 422)
    });
    task('roster').querySelector('[data-arm]').click();
    task('roster').querySelector('[data-confirm]').click();
    await flush();
    const last = task('roster').textContent;
    expect(last).toContain('Season 2026 is not the stored basketball season');
    expect(last).toContain('HTTP 422');
    expect(task('roster').querySelector('.ha-dot.ha-error')).not.toBeNull();
});

// Heroku's 30s ceiling answers with an HTML page while the handler keeps
// running — "failed" would be wrong, and a re-run would spend the calls twice.
test('an HTML reply is reported as unreadable and possibly still running, not as a failure message', async () => {
    await render(status(), {
        'POST /hoops/games/2027/schedule': () => Promise.resolve({ ok: false, status: 503, text: () => Promise.resolve('<html>Application error</html>') })
    });
    task('schedule').querySelector('[data-arm]').click();
    task('schedule').querySelector('[data-confirm]').click();
    await flush();
    expect(task('schedule').textContent).toContain('may still be running on the server');
    // ...and its button stays off, so a second tap cannot spend the calls again.
    expect(task('schedule').querySelector('[data-arm]')).toBeNull();
    expect(task('schedule').querySelector('.ha-run').disabled).toBe(true);
    expect(task('ingest').querySelector('[data-arm]').disabled).toBe(false);
});

test('while one task runs, no other can be started', async () => {
    let release;
    await render(status(), {
        'POST /hoops/teams/2027/roster': () => new Promise(r => { release = () => r(json({ season: 2027, teams: 1535, players: 5643 })); })
    });
    task('roster').querySelector('[data-arm]').click();
    task('roster').querySelector('[data-confirm]').click();
    await flush();
    expect(task('roster').textContent).toContain('Running');
    expect(task('ingest').querySelector('[data-arm]').disabled).toBe(true);
    task('ingest').querySelector('[data-arm]').click();
    expect(task('ingest').querySelector('[data-confirm]')).toBeNull();
    release();
    await flush();
    expect(task('roster').textContent).toContain('5,643 numbered players imported (CBBD listed 1,535 teams)');
    expect(posts()).toHaveLength(1);
});

test('the last result run here survives a reload', async () => {
    await render(status(), { 'POST /hoops/teams/2027/roster': () => json({ season: 2027, teams: 1535, players: 0, skippedReason: 'CBBD has no numbered players for this season yet' }) });
    task('roster').querySelector('[data-arm]').click();
    task('roster').querySelector('[data-confirm]').click();
    await flush();
    await render(status());
    expect(task('roster').textContent).toContain('Run here just now — CBBD has no numbered players for this season yet');
    expect(task('ingest').textContent).toContain('Not run from this page');
});

test('Results shows the nightly job, which does the same refresh', async () => {
    await render(status());
    const r = task('refresh').textContent;
    expect(r).toContain('Nightly job error just now — CBBD 500');
    expect(document.querySelector('.ha-jobs').textContent).toContain('hoops-live');
    expect(document.querySelector('.ha-jobs').textContent).toContain('no runs yet');
});

test('says nothing about football: no link to its admin page', async () => {
    await render(status());
    expect(document.querySelector('a[href="/admin"]')).toBeNull();
    expect(document.getElementById('hoops-admin').innerHTML).not.toMatch(/football/i);
});

test('no basketball season: no buttons, a plain sentence', async () => {
    await render({ season: null });
    expect(document.querySelector('[data-arm]')).toBeNull();
    expect(document.querySelector('.sp-error').textContent).toContain('No basketball season is set');
});

test('a status the server refuses becomes the error state', async () => {
    document.body.innerHTML = '<main id="hoops-admin"></main>';
    global.fetch = jest.fn((url) => url === '/hoops/admin/status' ? json({ message: 'Not found' }, 404) : json({}));
    (0, eval)(SRC);
    await flush();
    expect(document.querySelector('.sp-error').textContent).toBe('Not found');
});
