/**
 * @jest-environment jsdom
 */
// public/history.js labels seasons by the league's sport (#562): basketball
// names a season by its ENDING year, so 2027 reads "2026–27", as /leagues does.
// Football must render exactly as before.
//
// The module is an IIFE bound to DOMContentLoaded, so the page and its globals
// exist before the require and the event is fired by hand.

const person = (id, name, extra) => Object.assign({ userId: id, name, franchise: null, avatarUrl: null,
    initials: name[0], color: '#123' }, extra || {});

function payload(sport, season, overrides) {
    const champ = Object.assign(person('a', 'Ann Test'), { score: 30, rank: 1, of: 2 });
    return Object.assign({
        league: sport === 'basketball' ? 'hoops-league' : 'graham-league',
        sport, activeSeason: season + 1,
        seasons: [{ season, champion: champ, standings: [champ] }],
        managers: [Object.assign(person('a', 'Ann Test'), {
            titles: 1, titleSeasons: [season], totalPoints: 30, seasonsPlayed: 1, avgFinish: 1,
            bestSeason: { season, score: 30 }, worstSeason: { season, score: 30 },
            history: [{ season, score: 30, rank: 1, of: 2, franchise: null, champion: true }]
        })],
        records: [{ key: 'bestSeason', label: 'Highest season', value: 30, suffix: 'pts', season,
            holder: person('a', 'Ann Test') }],
        draftHistory: [{ season, picks: 2, rounds: 1, firstOverall: null }]
    }, overrides || {});
}

async function renderPage(body) {
    jest.resetModules();
    document.body.innerHTML = '<main class="hof" id="hof"><p class="hof-loading">Loading…</p></main>';
    global.userState = { user_metadata: { metadata: { userId: 'a' } } };
    global.ccLeagueCode = () => body.league;
    global.fetch = jest.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve(body) }));
    require('../public/history.js');
    window.dispatchEvent(new Event('DOMContentLoaded'));
    await new Promise(r => setTimeout(r, 0));
    return document.getElementById('hof');
}

const texts = (el, sel) => Array.from(el.querySelectorAll(sel)).map(n => n.textContent.trim());

afterEach(() => {
    delete global.fetch;
    delete global.userState;
    delete global.ccLeagueCode;
});

describe('Hall of Fame season labels', () => {
    test('basketball seasons read as the academic year', async () => {
        const el = await renderPage(payload('basketball', 2027));
        expect(global.fetch).toHaveBeenCalledWith('/history/hoops-league', expect.anything());
        expect(texts(el, '.hof-champ-season')).toEqual(['2026–27']);
        expect(texts(el, '.hof-hist-season')).toEqual(['2026–27']);
        expect(texts(el, '.hof-rec-when')).toEqual(['2026–27']);
        expect(texts(el, '.hof-draft-head b')).toEqual(['2026–27']);
        expect(el.querySelector('.hof-mgr-summary').textContent).toContain('Best 30 (2026–27)');
        expect(el.querySelector('.hof-mgr-summary').textContent).toContain('Worst 30 (2026–27)');
        // The hook history.css widens the season column on.
        expect(el.classList.contains('hof-basketball')).toBe(true);
    });

    test('football seasons are unchanged', async () => {
        const el = await renderPage(payload('football', 2025));
        expect(texts(el, '.hof-champ-season')).toEqual(['2025']);
        expect(texts(el, '.hof-hist-season')).toEqual(['2025']);
        expect(texts(el, '.hof-rec-when')).toEqual(['2025']);
        expect(el.querySelector('.hof-mgr-summary').textContent).toContain('Best 30 (2025)');
        expect(el.querySelector('.hof-note').textContent).toContain('all land in one bucket');
        expect(el.className).toBe('hof');
    });

    test('a response with no sport renders as football', async () => {
        const body = payload('football', 2025);
        delete body.sport;
        const el = await renderPage(body);
        expect(texts(el, '.hof-champ-season')).toEqual(['2025']);
    });

    test('the record-book note describes basketball’s postseason, not the football bucket', async () => {
        const el = await renderPage(payload('basketball', 2027));
        const note = el.querySelector('.hof-note').textContent;
        expect(note).toContain('Conference tournaments and March');
        expect(note).not.toContain('one bucket');
    });
});

describe('Hall of Fame empty state', () => {
    const empty = { seasons: [], managers: [], records: [], draftHistory: [] };

    test('basketball names the season still being played', async () => {
        const el = await renderPage(Object.assign(payload('basketball', 2026), empty, { activeSeason: 2027 }));
        expect(el.querySelector('.hof-empty').textContent).toContain('The 2026–27 season hasn’t finished yet');
    });

    test('basketball with no season set falls back to the generic message', async () => {
        const el = await renderPage(Object.assign(payload('basketball', 2026), empty, { activeSeason: null }));
        expect(el.querySelector('.hof-empty').textContent).toBe('No completed seasons yet — check back once a season wraps.');
    });

    test('football keeps its message', async () => {
        const el = await renderPage(Object.assign(payload('football', 2025), empty, { activeSeason: 2026 }));
        expect(el.querySelector('.hof-empty').textContent).toBe('No completed seasons yet — check back once a season wraps.');
    });
});
