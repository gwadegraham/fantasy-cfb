// The icon set and the accent follow the sport (#319).
//
// This is view plumbing, which is exactly the kind that rots quietly: the
// hardwood assets shipped in #308 and went nowhere for a month because adding
// a sport meant editing the same four <link> tags in fourteen files. Nobody
// notices a wrong favicon until two leagues are open in two tabs.
//
// So the partial is rendered for real and the markup asserted, and the views
// are checked for having actually adopted it.

const fs = require('fs');
const path = require('path');
const ejs = require('ejs');

const VIEWS = path.join(__dirname, '..', 'views');
const render = (locals) =>
    ejs.render(fs.readFileSync(path.join(VIEWS, 'partials', 'favicons.ejs'), 'utf8'), locals);

describe('the favicon partial', () => {
    test('football gets the football set', () => {
        const html = render({ viewerSport: 'football' });
        expect(html).toContain('href="/images/favicon.svg"');
        expect(html).toContain('href="/images/favicon-32.png"');
        expect(html).toContain('href="/images/favicon-16.png"');
        expect(html).toContain('href="/images/apple-touch-icon.png"');
        expect(html).not.toContain('hardwood');
    });

    test('basketball gets the hardwood set', () => {
        const html = render({ viewerSport: 'basketball' });
        expect(html).toContain('href="/images/favicon-hardwood.svg"');
        expect(html).toContain('href="/images/favicon-hardwood-32.png"');
        expect(html).toContain('href="/images/favicon-hardwood-16.png"');
        expect(html).toContain('href="/images/apple-touch-icon-hardwood.png"');
    });

    test('a signed-out page falls back to football, not to nothing', () => {
        // The invite and error pages render with no viewer. A missing icon is
        // a broken tab; the football mark is the right default.
        expect(render({})).toContain('href="/images/favicon.svg"');
        expect(render({ viewerSport: undefined })).toContain('href="/images/favicon.svg"');
        expect(render({ viewerSport: '' })).toContain('href="/images/favicon.svg"');
    });

    test('an unknown sport falls back rather than 404ing every icon', () => {
        expect(render({ viewerSport: 'curling' })).toContain('href="/images/favicon.svg"');
    });

    // Absolute, not relative. Ten views used `images/...` and four used
    // `/images/...`; the relative form resolves against the current path and
    // breaks on any nested route.
    test('every path is absolute', () => {
        for (const sport of ['football', 'basketball']) {
            expect(render({ viewerSport: sport })).not.toMatch(/href="images\//);
        }
    });
});

describe('every asset the partial can name exists on disk', () => {
    // A typo here is a broken icon on every page of that sport, and nothing
    // else would catch it.
    test.each([['football'], ['basketball']])('%s', (sport) => {
        const hrefs = [...render({ viewerSport: sport }).matchAll(/href="([^"]+)"/g)].map(m => m[1]);
        expect(hrefs).toHaveLength(4);
        for (const href of hrefs) {
            const file = path.join(__dirname, '..', href.replace(/^\//, ''));
            expect(fs.existsSync(file)).toBe(true);
        }
    });
});

describe('the views adopted it', () => {
    const views = fs.readdirSync(VIEWS).filter(f => f.endsWith('.ejs'));

    test('no view hardcodes an icon link any more', () => {
        const offenders = views.filter(f =>
            fs.readFileSync(path.join(VIEWS, f), 'utf8').includes('rel="icon"'));
        expect(offenders).toEqual([]);
    });

    test('and every view that includes the partial also carries data-sport', () => {
        // The accent rule keys off the body attribute. A view with the right
        // favicon and no data-sport is a page that half-changes sport, which
        // reads as a bug rather than a theme.
        const missing = views.filter(f => {
            const s = fs.readFileSync(path.join(VIEWS, f), 'utf8');
            return s.includes('partials/favicons') && !s.includes('data-sport');
        });
        expect(missing).toEqual([]);
    });
});

describe('the accent token', () => {
    const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'styles.css'), 'utf8');

    test('basketball overrides --cc-accent and nothing else', () => {
        const block = /\[data-sport="basketball"\]\s*\{([^}]*)\}/.exec(css);
        expect(block).not.toBeNull();
        const declared = [...block[1].matchAll(/(--[\w-]+)\s*:/g)].map(m => m[1]);
        expect(declared).toEqual(['--cc-accent']);
    });

    test('football keeps the brand red, untouched', () => {
        expect(/:root\s*\{[\s\S]*?--cc-accent:\s*#ed5858/.test(css)).toBe(true);
    });

    test('the stylesheet still balances', () => {
        // The first attempt at this rule closed :root early and swallowed the
        // radius scale into the sport block.
        let depth = 0;
        for (const ch of css) {
            if (ch === '{') depth++;
            else if (ch === '}') depth--;
            expect(depth).toBeGreaterThanOrEqual(0);
        }
        expect(depth).toBe(0);
    });

    test('and the radius scale is still on :root, not inside the sport rule', () => {
        const root = /:root\s*\{([\s\S]*?)\}/.exec(css);
        expect(root[1]).toContain('--cc-r-pill');
    });
});
