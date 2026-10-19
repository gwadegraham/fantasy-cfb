// Public announcement pages (modules/announcement-page.js): /season-preview
// and /hardwood, served with no login so a link sent to a friend opens.

const path = require('path');
const express = require('express');
const request = require('supertest');
const page = require('../modules/announcement-page');

const ROOT = path.join(__dirname, '..');
const app = express();
page.mount(app, ROOT);

describe('/hardwood — the basketball launch page', () => {
    test('answers with no session at all, as a whole document', async () => {
        const res = await request(app).get('/hardwood');
        expect(res.status).toBe(200);
        expect(res.headers['content-type']).toMatch(/text\/html/);
        expect(res.text.startsWith('<!DOCTYPE html>')).toBe(true);
        expect(res.text).toContain('Fantasy college basketball.');
    });

    test('one <title>, the basketball favicon, and kept out of search', async () => {
        const { text } = await request(app).get('/hardwood');
        expect(text.match(/<title>/g)).toHaveLength(1);
        expect(text).toContain('<title>Campus Clash Hardwood</title>');
        expect(text).toContain('href="/images/favicon-hardwood.svg"');
        expect(text).toContain('<meta name="robots" content="noindex">');
    });

    test('link previews point at absolute URLs on our domain', async () => {
        const { text } = await request(app).get('/hardwood');
        expect(text).toContain('<meta property="og:url" content="https://campusclash.io/hardwood">');
        expect(text).toContain('<meta property="og:image" content="https://campusclash.io/images/hardwood-og.png">');
    });

    // The tags promise 1200x630; a card of another size gets letterboxed or
    // cropped differently by every app. Read from the PNG header.
    test('every preview card is really 1200x630', () => {
        const fs = require('fs');
        Object.values(page.PAGES).forEach(p => {
            const png = fs.readFileSync(path.join(ROOT, p.image));
            expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1200, 630]);
        });
    });

    test('every image a preview or the page names exists in the repo', () => {
        const fs = require('fs');
        Object.values(page.PAGES).forEach(p => {
            expect(fs.existsSync(path.join(ROOT, p.image))).toBe(true);
            const html = typeof p.icons === 'function' ? p.icons({}) : (p.icons || '');
            const icons = html.match(/href="([^"]+)"/g) || [];
            // /images is served from the repo root, everything else from public/.
            icons.map(h => h.slice(6, -1)).forEach(href => expect(
                fs.existsSync(path.join(ROOT, href)) || fs.existsSync(path.join(ROOT, 'public', href))
            ).toBe(true));
        });
    });
});

describe('/season-preview — the football page, unchanged by the move', () => {
    test('still served, with its own title and preview card and no favicon override', async () => {
        const res = await request(app).get('/season-preview');
        expect(res.status).toBe(200);
        expect(res.text).toContain('<title>Campus Clash — The 2026 Season Is Loaded</title>');
        expect(res.text).toContain('content="https://campusclash.io/images/season-preview-og.png"');
        expect(res.text).not.toContain('favicon-hardwood');
    });
});

describe('/install — the add-to-home-screen guide', () => {
    test('answers with no session, with a way back to the app', async () => {
        const res = await request(app).get('/install');
        expect(res.status).toBe(200);
        expect(res.text).toContain('<title>Install Campus Clash</title>');
        expect(res.text).toContain('Add to Home Screen');
        expect(res.text).toMatch(/<a class="back" href="\/">/);
    });

    // Without the manifest, Add to Home Screen from this page saves a
    // bookmark to /install rather than installing the app.
    test('carries the app manifest and home-screen icon', async () => {
        const { text } = await request(app).get('/install');
        expect(text).toContain('<link rel="manifest" href="/manifest.json">');
        expect(text).toContain('href="/images/app-icon-180.png"');
        expect(text).toContain('<meta name="apple-mobile-web-app-capable" content="yes">');
    });

    test('the home-screen icon follows the visitor\'s pick', async () => {
        const { text } = await request(app).get('/install').set('Cookie', 'cc_app_icon=laces');
        expect(text).toContain('<link rel="apple-touch-icon" sizes="180x180" href="/images/app-icons/laces-180.png">');
    });

    test('the other pages do not claim to be the app', async () => {
        const { text } = await request(app).get('/hardwood');
        expect(text).not.toContain('rel="manifest"');
    });
});

test('a missing fragment is a plain 404, not a crash', async () => {
    const broken = express();
    page.mount(broken, '/nowhere');
    const res = await request(broken).get('/hardwood');
    expect(res.status).toBe(404);
    expect(res.text).toBe('Announcement not found.');
});
