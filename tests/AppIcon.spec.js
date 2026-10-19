// The home-screen icon picker (modules/app-icon.js): a cookie decides the
// apple-touch-icon and /manifest.json for every page.

const fs = require('fs');
const path = require('path');
const express = require('express');
const request = require('supertest');
const appIcon = require('../modules/app-icon');

const ROOT = path.join(__dirname, '..');
const app = express();
appIcon.mount(app);
app.get('/probe', (req, res) => res.json({ touch: res.locals.appIconTouch }));
// No express.static(public) here: it would answer /manifest.json with the same
// JSON, so the default-manifest test could not tell the route was missing.

const pngSize = file => {
    const png = fs.readFileSync(path.join(ROOT, file));
    return [png.readUInt32BE(16), png.readUInt32BE(20)];
};

describe('choosing', () => {
    test('no cookie is the classic icon', () => {
        expect(appIcon.fromReq({ headers: {} })).toBe('classic');
    });

    test('the cookie picks, among other cookies', () => {
        expect(appIcon.fromReq({ headers: { cookie: 'a=1; cc_app_icon=laces; b=2' } })).toBe('laces');
    });

    test('a hand-written cookie cannot name a file', () => {
        expect(appIcon.fromReq({ headers: { cookie: 'cc_app_icon=../../server' } })).toBe('classic');
    });

    test('?icon= overrides the cookie, but only with a real id', () => {
        const cookie = { cookie: 'cc_app_icon=gold' };
        expect(appIcon.fromReq({ headers: cookie, query: { icon: 'hoops' } })).toBe('hoops');
        expect(appIcon.fromReq({ headers: cookie, query: { icon: 'nope' } })).toBe('gold');
    });
});

describe('the files', () => {
    test.each(appIcon.ICONS.map(i => [i.id]))('%s exists at 180, 192 and 512', id => {
        [180, 192, 512].forEach(px => expect(pngSize(appIcon.src(id, px))).toEqual([px, px]));
    });

    // Renaming the classic files would change the icon URL under everyone who
    // installed before the picker existed.
    test('classic keeps its original names', () => {
        expect(appIcon.src('classic', 180)).toBe('/images/app-icon-180.png');
    });

    test('/install offers exactly the known icons', () => {
        const html = fs.readFileSync(path.join(ROOT, 'docs/announcements/install.html'), 'utf8');
        const offered = [...html.matchAll(/name="icon" value="([a-z]+)"/g)].map(m => m[1]);
        expect(offered.sort()).toEqual(appIcon.ICONS.map(i => i.id).sort());
    });
});

describe('/manifest.json', () => {
    test('the default is public/manifest.json, unchanged', async () => {
        const res = await request(app).get('/manifest.json');
        expect(res.status).toBe(200);
        expect(JSON.parse(res.text)).toEqual(require('../public/manifest.json'));
    });

    test('a picked icon swaps every icon and nothing else', async () => {
        const res = await request(app).get('/manifest.json').set('Cookie', 'cc_app_icon=dribbles');
        const m = JSON.parse(res.text);
        expect(m.icons.map(i => i.src)).toEqual([
            '/images/app-icons/dribbles-192.png', '/images/app-icons/dribbles-512.png', '/images/app-icons/dribbles-512.png'
        ]);
        expect(m.icons[2].purpose).toBe('maskable');
        expect(m.start_url).toBe('/standings');
    });

    test('is never shared between visitors by a cache', async () => {
        const res = await request(app).get('/manifest.json');
        expect(res.headers['cache-control']).toMatch(/private/);
        expect(res.headers.vary).toMatch(/Cookie/);
    });
});

test('every page gets the picked apple-touch-icon', async () => {
    const res = await request(app).get('/probe').set('Cookie', 'cc_app_icon=red');
    expect(res.body.touch).toBe('/images/app-icons/red-180.png');
});
