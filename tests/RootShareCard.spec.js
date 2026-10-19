// The logged-out root (app.get('/') in server.js) is the only place a link
// preview for campusclash.io itself can come from. Its document is built by
// modules/root-share-page.js; these check what is actually served, and that
// the card it names is a real 1200x630 file, since a renamed or deleted card
// would otherwise unfurl as a broken image with every test still green.

const fs = require('fs');
const path = require('path');
const express = require('express');
const request = require('supertest');
const page = require('../modules/root-share-page');

const ROOT = path.join(__dirname, '..');
const app = express();
app.get('/', (req, res) => res.type('html').send(page.html()));

const meta = (text, attr, name) => {
    const m = text.match(new RegExp('<meta ' + attr + '="' + name + '" content="([^"]*)">'));
    return m && m[1];
};

test('server.js serves this document on the logged-out root', () => {
    const src = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
    expect(src).toContain("require('./modules/root-share-page')");
    expect(src).toContain('res.type(\'html\').send(rootSharePage.html())');
});

test('the preview names the parent-crest card, absolute, on our domain', async () => {
    const { text } = await request(app).get('/');
    const url = 'https://campusclash.io/images/campus-clash-parent-og.png';
    expect(meta(text, 'property', 'og:image')).toBe(url);
    expect(meta(text, 'property', 'og:image:secure_url')).toBe(url);
    expect(meta(text, 'name', 'twitter:image')).toBe(url);
});

test('the card it names exists and is really 1200x630', async () => {
    const { text } = await request(app).get('/');
    const src = meta(text, 'property', 'og:image').replace('https://campusclash.io', '');
    const png = fs.readFileSync(path.join(ROOT, src));
    expect(png.subarray(1, 4).toString()).toBe('PNG');
    expect(meta(text, 'property', 'og:image:type')).toBe('image/png');
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1200, 630]);
    expect([meta(text, 'property', 'og:image:width'), meta(text, 'property', 'og:image:height')])
        .toEqual(['1200', '630']);
});

// The site is football AND basketball; the card is sport-neutral, so the
// copy must be too, and every place that repeats it must agree.
test('title and description are sport-neutral and consistent', async () => {
    const { text } = await request(app).get('/');
    const title = 'Campus Clash — College Fantasy Sports';
    expect(text).toContain('<title>' + title + '</title>');
    expect(meta(text, 'property', 'og:title')).toBe(title);
    expect(meta(text, 'name', 'twitter:title')).toBe(title);

    const desc = meta(text, 'name', 'description');
    expect(desc).toMatch(/football and basketball/);
    expect(meta(text, 'property', 'og:description')).toBe(desc);
    expect(meta(text, 'name', 'twitter:description')).toBe(desc);
    expect(text).not.toMatch(/College Football Fantasy|Every Saturday/);
});
