/**
 * modules/team-news.js and the two routes over it: a team's ESPN headlines.
 * What matters is what a manager would see wrong: league-wide roundups
 * crowding out the team's own stories, the same story twice, an ESPN outage
 * breaking the page, and a game's preview not finding its game.
 */

const express = require('express');
const request = require('supertest');
const mongoose = require('mongoose');
const { useMongo } = require('./helpers/mongo');
const news = require('../modules/team-news');
const HoopsTeam = require('../models/hoopsTeam');
const visibility = require('../modules/hoops-visibility');

useMongo();

// One ESPN feed article; `teams` is how many teams it is tagged with.
const article = (o = {}) => {
    const teams = o.teams || [2390];
    return {
        headline: o.headline || 'Miami routs Pitt',
        description: 'No. 1 Miami rolled.',
        published: o.published || '2026-10-24T20:00:00Z',
        type: o.type || 'Story',
        premium: o.premium || false,
        images: o.images || [{ url: 'https://a.espncdn.com/photo/1.jpg' }],
        links: { web: { href: o.link || 'https://www.espn.com/college-football/story/_/id/1/x' } },
        categories: [
            { type: 'league', description: 'NCAA Football' },
            // ESPN tags each team twice: the team and its university.
            ...teams.flatMap(id => [{ type: 'team', teamId: id }, { type: 'team', teamId: id }]),
            ...(o.eventId ? [{ type: 'event', eventId: o.eventId }] : [])
        ]
    };
};

const feed = (articles, status = 200) => jest.fn(() => Promise.resolve({
    ok: status === 200, status, json: () => Promise.resolve({ articles })
}));

const realFetch = global.fetch;
beforeEach(() => {
    news._cache.clear();
    jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
    global.fetch = realFetch;
    jest.restoreAllMocks();
});

describe('which articles are kept', () => {
    test('a roundup tagging many teams is dropped; a game between two teams is kept', () => {
        const out = news.shape([
            article({ headline: 'CFP Bubble Watch', teams: [2390, 52, 25, 152] }),
            article({ headline: 'North Carolina hosts No. 1 Miami', teams: [2390, 153] }),
            article({ headline: 'Inside Toney\'s day' })
        ]);
        expect(out.map(x => x.headline)).toEqual(['North Carolina hosts No. 1 Miami', 'Inside Toney\'s day']);
    });

    test('newest first, whatever order ESPN sends', () => {
        const out = news.shape([
            article({ headline: 'old', published: '2026-10-18T10:00:00Z' }),
            article({ headline: 'new', published: '2026-10-25T10:00:00Z' }),
            article({ headline: 'mid', published: '2026-10-22T10:00:00Z' })
        ]);
        expect(out.map(x => x.headline)).toEqual(['new', 'mid', 'old']);
    });

    test('one story under one headline twice (clip and story) appears once', () => {
        const out = news.shape([
            article({ headline: 'Pitt vs. Miami: Full Highlights', type: 'Media', published: '2026-10-24T21:00:00Z' }),
            article({ headline: 'Pitt vs. Miami: Full Highlights', type: 'Media', published: '2026-10-24T20:00:00Z' })
        ]);
        expect(out).toHaveLength(1);
        expect(out[0].published).toBe('2026-10-24T21:00:00.000Z');
    });

    test('an http link (ESPN\'s previews and recaps) is kept, upgraded to https', () => {
        const [pv] = news.shape([article({ type: 'Preview', link: 'http://www.espn.com/ncf/preview?gameId=401858282', eventId: 401858282 })]);
        expect(pv.link).toBe('https://www.espn.com/ncf/preview?gameId=401858282');
        expect(pv.eventId).toBe('401858282');
    });

    test('a newer clip under the same headline does not replace the game\'s preview', () => {
        const out = news.shape([
            article({ headline: 'UNC hosts Miami', type: 'Preview', eventId: 401858282, published: '2026-10-25T10:00:00Z' }),
            article({ headline: 'UNC hosts Miami', type: 'Media', published: '2026-10-26T10:00:00Z' })
        ]);
        expect(out).toHaveLength(1);
        expect(out[0]).toMatchObject({ kind: 'preview', eventId: '401858282' });
        const flipped = news.shape([
            article({ headline: 'UNC hosts Miami', type: 'Media', published: '2026-10-26T10:00:00Z' }),
            article({ headline: 'UNC hosts Miami', type: 'Preview', eventId: 401858282, published: '2026-10-25T10:00:00Z' })
        ]);
        expect(flipped[0].kind).toBe('preview');
    });

    test('an article with no headline, no web link, or no date is skipped', () => {
        const out = news.shape([
            article({ headline: '  ' }),
            article({ link: 'javascript:alert(1)' }),
            article({ published: 'not a date' }),
            article({ headline: 'kept' })
        ]);
        expect(out.map(x => x.headline)).toEqual(['kept']);
        expect(news.normalize(null)).toBeNull();
    });

    test('at most 25', () => {
        const many = Array.from({ length: 40 }, (_, i) => article({ headline: 'h' + i }));
        expect(news.shape(many)).toHaveLength(25);
    });
});

describe('what an article carries', () => {
    test('the kind, the game it is about, and only an https image', () => {
        const [pv] = news.shape([article({ type: 'Preview', eventId: 401858282, premium: true })]);
        expect(pv).toEqual({
            headline: 'Miami routs Pitt',
            description: 'No. 1 Miami rolled.',
            published: '2026-10-24T20:00:00.000Z',
            kind: 'preview',
            image: 'https://a.espncdn.com/photo/1.jpg',
            link: 'https://www.espn.com/college-football/story/_/id/1/x',
            premium: true,
            eventId: '401858282'
        });
        const [noImg] = news.shape([article({ images: [{ url: 'http://insecure/1.jpg' }] })]);
        expect(noImg.image).toBeNull();
        expect(noImg.eventId).toBeNull();
    });

    test.each([['Recap', 'recap'], ['Media', 'video'], ['HeadlineNews', 'story'], ['Story', 'story']])('%s is a %s', (type, kind) => {
        expect(news.shape([article({ type })])[0].kind).toBe(kind);
    });

    test('the feed URL for each sport', () => {
        expect(news.feedUrl('football', '2390')).toBe('https://site.api.espn.com/apis/site/v2/sports/football/college-football/news?team=2390&limit=50');
        expect(news.feedUrl('basketball', '150')).toContain('/basketball/mens-college-basketball/news?team=150');
    });
});

describe('newsFor: one ESPN call per team per half hour, and never throws', () => {
    test('a second ask inside the TTL is the cache; after it, ESPN again', async () => {
        global.fetch = feed([article()]);
        const t0 = Date.parse('2026-10-28T12:00:00Z');
        expect((await news.newsFor('football', 2390, t0)).items).toHaveLength(1);
        await news.newsFor('football', 2390, t0 + 60 * 1000);
        expect(global.fetch).toHaveBeenCalledTimes(1);
        await news.newsFor('football', 2390, t0 + news.TTL_MS + 1);
        expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    test('two page views at once share one request', async () => {
        global.fetch = feed([article()]);
        const [a, b] = await Promise.all([news.newsFor('football', 2390), news.newsFor('football', 2390)]);
        expect(a).toBe(b);
        expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    test('football and basketball are cached apart', async () => {
        global.fetch = feed([article()]);
        await news.newsFor('football', 2390);
        await news.newsFor('basketball', 2390);
        expect(global.fetch.mock.calls.map(c => c[0])).toEqual([
            expect.stringContaining('/football/'), expect.stringContaining('/basketball/')
        ]);
    });

    test.each([
        ['an HTTP error', () => feed([], 503)],
        ['a network failure', () => jest.fn(() => Promise.reject(new Error('socket hang up')))],
        ['a changed response shape', () => jest.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ headlines: [] }) }))]
    ])('%s answers an empty list with an error, and is not retried for five minutes', async (_, make) => {
        global.fetch = make();
        const t0 = Date.parse('2026-10-28T12:00:00Z');
        expect(await news.newsFor('football', 2390, t0)).toEqual({ items: [], error: 'ESPN news is unavailable right now' });
        await news.newsFor('football', 2390, t0 + news.FAIL_TTL_MS - 1);
        expect(global.fetch).toHaveBeenCalledTimes(1);
        await news.newsFor('football', 2390, t0 + news.FAIL_TTL_MS + 1);
        expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    test('the cache is bounded: when full, the oldest team is dropped', async () => {
        for (let i = 0; i < 500; i++) news._cache.set('football:' + i, { value: { items: [], error: null }, expires: Infinity });
        global.fetch = feed([article()]);
        await news.newsFor('football', 2390);
        expect(news._cache.size).toBe(500);
        expect(news._cache.has('football:0')).toBe(false);
        expect(news._cache.has('football:2390')).toBe(true);
    });

    test('an article missing its optional parts is still shown', () => {
        const [x] = news.shape([{ headline: 'Bare', published: '2026-10-24T20:00:00Z', links: { web: { href: 'https://www.espn.com/1' } } }]);
        expect(x).toMatchObject({ headline: 'Bare', description: '', image: null, eventId: null, premium: false, kind: 'story' });
    });

    test('an unknown sport or a missing id never reaches ESPN', async () => {
        global.fetch = jest.fn();
        expect((await news.newsFor('hockey', 1)).error).toMatch(/unknown sport/);
        expect((await news.newsFor('basketball', null)).error).toMatch(/no ESPN id/);
        expect((await news.newsFor('basketball', '12a')).error).toMatch(/no ESPN id/);
        expect(global.fetch).not.toHaveBeenCalled();
    });
});

describe('GET /teams/:id/news (football)', () => {
    const app = express();
    app.use('/teams', require('../routes/teams'));

    test('a team we have: its ESPN id is its own id', async () => {
        await mongoose.connection.collection('teams').insertOne({ id: 2390, school: 'Miami' });
        global.fetch = feed([article()]);
        const res = await request(app).get('/teams/2390/news');
        expect(res.status).toBe(200);
        expect(res.body.items[0].headline).toBe('Miami routs Pitt');
        expect(global.fetch.mock.calls[0][0]).toContain('/football/college-football/news?team=2390');
    });

    test('an id we have no team for is not passed on to ESPN', async () => {
        global.fetch = jest.fn();
        expect((await request(app).get('/teams/999999/news')).status).toBe(404);
        expect((await request(app).get('/teams/abc/news')).status).toBe(400);
        expect(global.fetch).not.toHaveBeenCalled();
    });

    test('ESPN down is still a 200: an empty tab, not a broken page', async () => {
        await mongoose.connection.collection('teams').insertOne({ id: 2390, school: 'Miami' });
        global.fetch = feed([], 500);
        const res = await request(app).get('/teams/2390/news');
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ items: [], error: expect.any(String) });
    });
});

describe('GET /hoops/teams/:id/news (basketball)', () => {
    const app = express();
    app.use('/hoops/teams', require('../routes/hoopsTeams'));
    const duke = (o) => HoopsTeam.create(Object.assign({ id: 72, season: 2027, school: 'Duke', sourceId: '150' }, o));

    beforeEach(() => { jest.spyOn(visibility, 'seesBasketball').mockResolvedValue(true); });

    test('asks ESPN by the team\'s ESPN id (sourceId), not CBBD\'s id', async () => {
        await duke();
        global.fetch = feed([article({ teams: [150] })]);
        const res = await request(app).get('/hoops/teams/72/news');
        expect(res.status).toBe(200);
        expect(res.body.items).toHaveLength(1);
        expect(global.fetch.mock.calls[0][0]).toContain('/basketball/mens-college-basketball/news?team=150');
    });

    test('an unknown team, a team with no ESPN id, or a bad id: no ESPN call', async () => {
        await duke({ id: 73, sourceId: '' });
        global.fetch = jest.fn();
        expect((await request(app).get('/hoops/teams/72/news')).status).toBe(404);
        expect((await request(app).get('/hoops/teams/73/news')).status).toBe(404);
        expect((await request(app).get('/hoops/teams/x/news')).status).toBe(400);
        expect(global.fetch).not.toHaveBeenCalled();
    });

    test('hidden basketball stays hidden', async () => {
        visibility.seesBasketball.mockResolvedValue(false);
        await duke();
        expect((await request(app).get('/hoops/teams/72/news')).status).toBe(404);
    });

    test('a database failure is a 500 with a plain message', async () => {
        jest.spyOn(HoopsTeam, 'findOne').mockImplementation(() => { throw new Error('boom'); });
        const res = await request(app).get('/hoops/teams/72/news');
        expect(res.status).toBe(500);
        expect(res.body.message).toBe('Could not load this team\'s news');
    });
});
