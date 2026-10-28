/**
 * @jest-environment jsdom
 *
 * public/team-news.js — the News tab and the next game's preview row, shared
 * by the football and basketball team pages. Asserts what a manager sees:
 * headlines that link out to ESPN (and stay in the installed app), a plain
 * message when there is no news or ESPN is down, and a preview under the
 * Next up card only when it is THAT game's preview.
 */

const news = require('../public/team-news.js');

const NOW = Date.parse('2026-10-28T16:00:00Z');
const item = (o) => Object.assign({
    headline: 'Miami routs Pitt', description: '', published: '2026-10-24T20:00:00.000Z', kind: 'story',
    image: 'https://a.espncdn.com/1.jpg', link: 'https://www.espn.com/story/1', premium: false, eventId: null
}, o);
const PREVIEW = item({ headline: 'North Carolina hosts No. 1 Miami', kind: 'preview', eventId: '401858282', link: 'https://www.espn.com/pv' });

beforeEach(() => {
    Object.keys(news._loads).forEach(k => delete news._loads[k]);
    document.body.innerHTML = '';
});

const flush = () => new Promise(r => setTimeout(r, 0));
const respond = (body, status = 200) => jest.fn(() => Promise.resolve({ ok: status === 200, status, json: () => Promise.resolve(body) }));

describe('the News tab list', () => {
    test('each headline links out to ESPN, in the same window (the installed app keeps it in a sheet)', () => {
        document.body.innerHTML = news.list({ items: [item(), item({ headline: 'Clip', kind: 'video', image: null })] }, NOW);
        const links = document.querySelectorAll('a.sp-news-row');
        expect(links).toHaveLength(2);
        expect(links[0].getAttribute('href')).toBe('https://www.espn.com/story/1');
        expect(links[0].getAttribute('target')).toBeNull();
        expect(links[0].querySelector('img').getAttribute('src')).toBe('https://a.espncdn.com/1.jpg');
        expect(links[1].querySelector('img')).toBeNull();
        expect(links[1].querySelector('.sp-news-noimg')).not.toBeNull();
        expect(links[1].querySelector('.sp-news-kind.video').textContent).toBe('Video');
        expect(links[0].querySelector('.sp-news-kind')).toBeNull();
        expect(document.querySelector('.sp-news-src').textContent).toMatch(/ESPN/);
    });

    test('an ESPN+ story is kept and marked with an ESPN+ label; a free one is not', () => {
        document.body.innerHTML = news.list({ items: [item({ premium: true, kind: 'recap' }), item()] }, NOW);
        const [paid, free] = document.querySelectorAll('.sp-news-meta');
        expect(paid.querySelector('.sp-news-plus').textContent).toBe('ESPN+');
        expect(paid.textContent).toBe('RecapESPN+3d ago');
        expect(free.querySelector('.sp-news-plus')).toBeNull();
        expect(free.textContent).toBe('ESPN · 3d ago');
    });

    test('an ESPN+ preview is marked under Next up too', async () => {
        global.fetch = respond({ items: [Object.assign({}, PREVIEW, { premium: true })] });
        document.body.innerHTML = news.nextWrap('<a class="sp-card sp-next" href="/game/401858282">x</a>', '401858282');
        const root = document.body;
        await news.paint(root, '/teams/2390/news', NOW);
        expect(root.querySelector('.sp-next-pv .sp-news-plus').textContent).toBe('ESPN+');
    });

    test('a headline is text, never markup', () => {
        document.body.innerHTML = news.list({ items: [item({ headline: '<img src=x onerror=alert(1)>' })] }, NOW);
        expect(document.querySelector('.sp-news-hl').textContent).toBe('<img src=x onerror=alert(1)>');
        expect(document.querySelectorAll('img')).toHaveLength(1);
    });

    test('no news, and ESPN down, each say so plainly', () => {
        document.body.innerHTML = news.list({ items: [], error: null }, NOW);
        expect(document.body.textContent).toBe('No recent ESPN stories about this team.');
        document.body.innerHTML = news.list({ items: [], error: 'down' }, NOW);
        expect(document.body.textContent).toMatch(/could not be loaded/);
        document.body.innerHTML = news.list(null, NOW);
        expect(document.body.textContent).toBe('No recent ESPN stories about this team.');
    });

    test.each([
        ['2026-10-28T15:30:00Z', 'Just now'],
        ['2026-10-28T13:00:00Z', '3h ago'],
        ['2026-10-25T10:00:00Z', '3d ago'],
        ['2026-10-12T10:00:00Z', 'Oct 12']
    ])('published %s reads "%s"', (iso, want) => {
        expect(news.ago(iso, NOW)).toBe(want);
    });
});

describe('previewFor: only this game\'s preview', () => {
    test('matched on ESPN\'s game id; a recap or another game\'s preview is not it', () => {
        const items = [item({ kind: 'recap', eventId: '401858282' }), item({ kind: 'preview', eventId: '401858274' }), PREVIEW];
        expect(news.previewFor(items, 401858282)).toBe(PREVIEW);
        expect(news.previewFor(items, '1')).toBeNull();
        expect(news.previewFor(items, null)).toBeNull();
        expect(news.previewFor(items, '')).toBeNull();
        expect(news.previewFor(undefined, '401858282')).toBeNull();
    });
});

describe('paint: fills the slots a page has open', () => {
    const page = (inner) => { document.body.innerHTML = '<main id="p">' + inner + '</main>'; return document.getElementById('p'); };
    const CARD = '<a class="sp-card sp-next" href="/game/401858282">@ North Carolina</a>';

    test('the preview becomes one row under its game\'s card, a link of its own (not nested in the card\'s)', async () => {
        global.fetch = respond({ items: [item(), PREVIEW] });
        const root = page(news.nextWrap(CARD, 401858282));
        await news.paint(root, '/teams/2390/news', NOW);
        const wrap = root.querySelector('.sp-next-wrap');
        expect(wrap.classList.contains('has-pv')).toBe(true);
        const row = wrap.querySelector('a.sp-next-pv');
        expect(row.getAttribute('href')).toBe('https://www.espn.com/pv');
        expect(row.parentElement).toBe(wrap);
        expect(row.closest('.sp-next')).toBeNull();
        expect(row.textContent).toBe('PreviewNorth Carolina hosts No. 1 Miami›');
        expect(global.fetch).toHaveBeenCalledWith('/teams/2390/news', expect.any(Object));
    });

    test('no preview for this game yet: the card is left exactly as it was', async () => {
        global.fetch = respond({ items: [item({ kind: 'preview', eventId: '9' })] });
        const root = page(news.nextWrap(CARD, 401858282));
        await news.paint(root, '/teams/2390/news', NOW);
        expect(root.querySelector('.has-pv, .sp-next-pv')).toBeNull();
    });

    test('a repaint does not add a second row, nor fetch again', async () => {
        global.fetch = respond({ items: [PREVIEW] });
        const root = page(news.nextWrap(CARD, '401858282') + news.panel());
        await news.paint(root, '/teams/2390/news', NOW);
        await news.paint(root, '/teams/2390/news', NOW);
        root.insertAdjacentHTML('beforeend', news.panel());
        await news.paint(root, '/teams/2390/news', NOW);
        expect(root.querySelectorAll('.sp-next-pv')).toHaveLength(1);
        expect(root.querySelectorAll('.sp-news-row')).toHaveLength(2);
        expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    test('the News tab shows "Loading" until the feed lands, then the list', async () => {
        let answer;
        global.fetch = jest.fn(() => new Promise(r => { answer = r; }));
        const root = page(news.panel());
        const done = news.paint(root, '/hoops/teams/72/news', NOW);
        expect(root.textContent).toMatch(/Loading news/);
        await flush();
        answer({ ok: true, json: () => Promise.resolve({ items: [item()] }) });
        await done;
        expect(root.querySelector('.sp-news-row')).not.toBeNull();
        expect(root.querySelector('.sp-news-slot')).toBeNull();
    });

    test('nothing to fill: ESPN is never asked (no next game, News tab shut)', async () => {
        global.fetch = jest.fn();
        await news.paint(page(news.nextWrap(CARD, null) + '<p>Season</p>'), '/teams/2390/news', NOW);
        await news.paint(null, '/teams/2390/news', NOW);
        expect(global.fetch).not.toHaveBeenCalled();
    });

    test('an HTTP error or a network failure shows the plain message, not a broken tab', async () => {
        global.fetch = respond({}, 500);
        let root = page(news.panel());
        await news.paint(root, '/a', NOW);
        expect(root.textContent).toMatch(/could not be loaded/);
        global.fetch = jest.fn(() => Promise.reject(new Error('offline')));
        root = page(news.panel());
        await news.paint(root, '/b', NOW);
        expect(root.textContent).toMatch(/could not be loaded/);
        delete global.fetch;
        root = page(news.panel());
        await news.paint(root, '/c');
        expect(root.textContent).toMatch(/could not be loaded/);
    });

    test('a failed load is asked again on the next paint; a good one is not', async () => {
        global.fetch = jest.fn(() => Promise.reject(new Error('offline')));
        let root = page(news.panel());
        await news.paint(root, '/teams/2390/news', NOW);
        expect(root.textContent).toMatch(/could not be loaded/);
        global.fetch = respond({ items: [item()] });
        root = page(news.panel());
        await news.paint(root, '/teams/2390/news', NOW);
        expect(root.querySelector('.sp-news-row')).not.toBeNull();
        root = page(news.panel());
        await news.paint(root, '/teams/2390/news', NOW);
        expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    test('nextWrap: no card, no wrapper; no ESPN id, no slot', () => {
        expect(news.nextWrap('', 1)).toBe('');
        expect(news.nextWrap(CARD, null)).not.toContain('data-espn-game');
    });
});
