// HTTP-level tests for modules/http-errors.js — the terminal 404 / 500 handlers.
// Mounted on a bare Express app configured with the real EJS view directory, so
// these exercise the actual content negotiation and the actual error.ejs render.

const path = require('path');
const express = require('express');
const request = require('supertest');
const { notFound, errorHandler, isApiPath, prefersJson } = require('../modules/http-errors');

// Mirrors server.js: view engine + views dir, one real route, then the two
// terminal handlers. `auth` fakes an Auth0 session when ?signedIn=1 is present.
function buildApp(opts) {
    const options = opts || {};
    const app = express();
    app.set('view engine', 'ejs');
    app.set('views', options.views || path.join(__dirname, '..', 'views'));

    app.use((req, res, next) => {
        if (req.query.signedIn === '1') req.oidc = { isAuthenticated: () => true };
        if (req.query.brokenAuth === '1') {
            req.oidc = { isAuthenticated: () => { throw new Error('session decrypt failed'); } };
        }
        next();
    });

    app.get('/standings', (req, res) => res.send('ok'));
    app.get('/boom', () => { throw new Error('DATABASE_URL=mongodb://secret@host failed'); });
    app.get('/forbidden', () => {
        const err = new Error('nope');
        err.status = 403;
        throw err;
    });
    app.get('/late', (req, res, next) => {
        res.status(200).send('already sent');
        next(new Error('too late'));
    });

    app.use(notFound);
    app.use(errorHandler);
    return app;
}

let consoleError;
beforeEach(() => { consoleError = jest.spyOn(console, 'error').mockImplementation(() => {}); });
afterEach(() => { consoleError.mockRestore(); });

describe('prefersJson / isApiPath', () => {
    test('recognizes mounted router prefixes, and only on a path boundary', () => {
        expect(isApiPath('/users')).toBe(true);
        expect(isApiPath('/users/123/roster')).toBe(true);
        expect(isApiPath('/draft/2026')).toBe(true);
        // /draft-room is a page, not the /draft router
        expect(isApiPath('/draft-room')).toBe(false);
        expect(isApiPath('/userHome')).toBe(false);
        expect(isApiPath('/')).toBe(false);
    });

    test('explicit signals outrank the path heuristic', () => {
        // fetch() with no Accept header on an API path
        expect(prefersJson({ headers: {}, path: '/users/1' })).toBe(true);
        expect(prefersJson({ headers: {}, path: '/typo' })).toBe(false);
        // someone typing an API path into the address bar gets the page
        expect(prefersJson({ headers: { accept: 'text/html' }, path: '/users/1' })).toBe(false);
        expect(prefersJson({ headers: { accept: 'application/json' }, path: '/typo' })).toBe(true);
        expect(prefersJson({ headers: {}, path: '/typo', xhr: true })).toBe(true);
    });
});

describe('404 for unmatched paths', () => {
    test('renders the branded page for a browser navigation', async () => {
        const res = await request(buildApp()).get('/no-such-page').set('Accept', 'text/html');
        expect(res.status).toBe(404);
        expect(res.headers['content-type']).toMatch(/html/);
        expect(res.text).toContain('Page not found');
        expect(res.text).toContain('CAMPUS');           // wordmark rendered
        expect(res.text).not.toContain('Cannot GET');   // not Express's default
    });

    test('references every asset absolutely, so it survives a nested path', async () => {
        const res = await request(buildApp()).get('/foo/bar/baz').set('Accept', 'text/html');
        expect(res.status).toBe(404);
        expect(res.text).toContain('href="/styles.css"');
        expect(res.text).toContain('href="/images/favicon.svg"');
        // a relative asset here would resolve against /foo/bar/ and 404 too
        expect(res.text).not.toMatch(/href="(styles\.css|images\/)/);
    });

    test('answers JSON under an API prefix even with no Accept header', async () => {
        const res = await request(buildApp()).get('/users/nope');
        expect(res.status).toBe(404);
        expect(res.headers['content-type']).toMatch(/json/);
        // names the path that missed, so a mistyped fetch is obvious in the console
        expect(res.body).toEqual({ status: 404, message: 'No route matches GET /users/nope' });
    });

    test('does not put the page wording in an API response', async () => {
        const res = await request(buildApp()).post('/leagues/typo');
        expect(res.status).toBe(404);
        expect(res.body.message).toBe('No route matches POST /leagues/typo');
        expect(res.body.message).not.toMatch(/page/);
    });

    test('answers JSON for an XHR on a non-API path', async () => {
        const res = await request(buildApp()).get('/typo').set('X-Requested-With', 'XMLHttpRequest');
        expect(res.status).toBe(404);
        expect(res.body.status).toBe(404);
    });

    test('offers Sign in when logged out and Standings when signed in', async () => {
        const app = buildApp();
        const out = await request(app).get('/nope').set('Accept', 'text/html');
        expect(out.text).toContain('href="/login"');
        expect(out.text).not.toContain('href="/standings"');

        const inn = await request(app).get('/nope?signedIn=1').set('Accept', 'text/html');
        expect(inn.text).toContain('href="/standings"');
        expect(inn.text).not.toContain('href="/login"');
    });

    test('treats a session that throws as logged out instead of 500ing', async () => {
        const res = await request(buildApp()).get('/nope?brokenAuth=1').set('Accept', 'text/html');
        expect(res.status).toBe(404);
        expect(res.text).toContain('href="/login"');
    });

    test('degrades to plain text when the view itself cannot render', async () => {
        const app = buildApp({ views: path.join(__dirname, 'no-views-here') });
        const res = await request(app).get('/nope').set('Accept', 'text/html');
        expect(res.status).toBe(404);
        expect(res.headers['content-type']).toMatch(/text\/plain/);
        expect(res.text).toBe('404 Page not found');
    });

    test('leaves real routes alone', async () => {
        const res = await request(buildApp()).get('/standings');
        expect(res.status).toBe(200);
        expect(res.text).toBe('ok');
    });
});

describe('error handler', () => {
    test('turns a thrown error into a 500 page without leaking the message', async () => {
        const res = await request(buildApp()).get('/boom').set('Accept', 'text/html');
        expect(res.status).toBe(500);
        expect(res.text).toContain('Something went wrong');
        expect(res.text).not.toContain('mongodb://');
        expect(res.text).not.toContain('DATABASE_URL');
        expect(consoleError).toHaveBeenCalled();          // but it is logged server-side
    });

    test('returns JSON for an API caller, also without the message', async () => {
        const res = await request(buildApp()).get('/boom').set('Accept', 'application/json');
        expect(res.status).toBe(500);
        expect(res.body.status).toBe(500);
        expect(JSON.stringify(res.body)).not.toContain('mongodb://');
    });

    test('honors an explicit err.status and stays quiet in the log for 4xx', async () => {
        const res = await request(buildApp()).get('/forbidden').set('Accept', 'text/html');
        expect(res.status).toBe(403);
        expect(res.text).toContain('403');
        expect(consoleError).not.toHaveBeenCalled();
    });

    test('does not try to re-send once headers are out', async () => {
        const res = await request(buildApp()).get('/late');
        expect(res.status).toBe(200);
        expect(res.text).toBe('already sent');
    });
});
