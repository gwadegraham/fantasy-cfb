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
    // ASSERTED POSITIVELY, over every full-document view.
    //
    // The first version checked "no view hardcodes an icon" and "any view that
    // includes the partial has data-sport" — both of which a view that
    // includes NEITHER satisfies. Stripping the include and the attribute from
    // admin.ejs left all thirteen tests green, which is the one failure the
    // block exists to catch.
    //
    // valentine.ejs is excluded on purpose: a joke page with its own icon
    // (`rel="shortcut icon"`, images/hello.png) and its own relative paths.
    // Named here so the exclusion is a decision rather than an oversight — and
    // so that a NEW view cannot join it by accident.
    const EXCLUDED = ['valentine.ejs'];
    const docs = fs.readdirSync(VIEWS)
        .filter(f => f.endsWith('.ejs'))
        .filter(f => fs.readFileSync(path.join(VIEWS, f), 'utf8').includes('<html'))
        .filter(f => !EXCLUDED.includes(f));

    test('there are the views we think there are', () => {
        // A new full-document view has to be considered rather than silently
        // skipped by the two assertions below.
        expect(docs).toHaveLength(15);
    });

    test('every one includes the favicon partial', () => {
        const missing = docs.filter(f =>
            !fs.readFileSync(path.join(VIEWS, f), 'utf8').includes("include('partials/favicons')"));
        expect(missing).toEqual([]);
    });

    test('every one carries data-sport, and on <html>', () => {
        // On <html>, not <body>: public/team.css resolves
        // `--team-accent: var(--cc-accent)` at :root, so a body-scoped
        // override never reaches it and the Team page keeps the football red.
        const wrong = docs.filter(f => {
            const s = fs.readFileSync(path.join(VIEWS, f), 'utf8');
            return !/<html\b[^>]*\sdata-sport=/.test(s) || /<body\b[^>]*\sdata-sport=/.test(s);
        });
        expect(wrong).toEqual([]);
    });

    test('and none hardcodes an icon link any more', () => {
        const offenders = docs.filter(f =>
            /rel="(icon|shortcut icon|apple-touch-icon)"/.test(fs.readFileSync(path.join(VIEWS, f), 'utf8')));
        expect(offenders).toEqual([]);
    });
});

describe('a tint follows its accent', () => {
    // Twenty rules hardcoded rgba(237, 88, 88, …) beside a tokenised
    // foreground, so a basketball page would render orange glyphs on red
    // washes — "everything recolours together" was not true as written.
    const css = fs.readdirSync(path.join(__dirname, '..', 'public'))
        .filter(f => f.endsWith('.css'))
        .map(f => [f, fs.readFileSync(path.join(__dirname, '..', 'public', f), 'utf8')]);

    test('the brand red is written down exactly once, anywhere', () => {
        // The literal, in ANY form — not just rgba(...). The first version of
        // this missed `--team-accent-rgb: 237, 88, 88` in team.css, which is
        // the declaration that actually kept the Team page red.
        const hits = css.flatMap(([f, s]) =>
            [...s.matchAll(/237\s*,\s*88\s*,\s*88/g)].map(() => f));
        expect(hits).toEqual(['styles.css']);
    });

    test('and basketball redefines it alongside the accent', () => {
        const styles = css.find(([f]) => f === 'styles.css')[1];
        const block = /:root\[data-sport="basketball"\]\s*\{([^}]*)\}/.exec(styles);
        expect(block[1]).toMatch(/--cc-accent\s*:/);
        expect(block[1]).toMatch(/--cc-accent-rgb\s*:/);
    });
});

describe('the accent token', () => {
    const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'styles.css'), 'utf8');

    test('basketball overrides --cc-accent and nothing else', () => {
        const block = /:root\[data-sport="basketball"\]\s*\{([^}]*)\}/.exec(css);
        expect(block).not.toBeNull();
        const declared = [...block[1].matchAll(/(--[\w-]+)\s*:/g)].map(m => m[1]);
        // The accent and its rgb companion, and nothing else — the tempting
        // next step is to start theming individual components in here.
        expect(declared).toEqual(['--cc-accent', '--cc-accent-rgb']);
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
