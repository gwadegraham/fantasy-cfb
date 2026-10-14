/**
 * @jest-environment jsdom
 *
 * public/mascots.js draws Laces (football) and Dribbles (basketball). The rule
 * that matters most: basketball stays invisible to managers outside a basketball
 * league, so Dribbles may only appear when the page itself is about basketball.
 * A page pinned to football (data-page-sport, e.g. the game detail page) gets
 * Laces even inside a basketball league.
 */
const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'mascots.js'), 'utf8');

function load({ leagueSport, body = '' } = {}) {
    document.body.innerHTML = body;
    document.body.removeAttribute('data-page-sport');
    delete window.ccMascot;
    window.ccLeague = leagueSport ? { sport: () => leagueSport } : undefined;
    // Run it the way the navbar does: a plain script on the page.
    new Function(SRC)();
    return window.ccMascot;
}

const isDribbles = html => /data-mascot="Dribbles"/.test(html);
const isLaces = html => /data-mascot="Laces"/.test(html);

describe('which mascot a page gets', () => {
    test('a football league gets Laces', () => {
        expect(isLaces(load({ leagueSport: 'football' }).html())).toBe(true);
    });

    test('no league info at all defaults to Laces, never Dribbles', () => {
        expect(isLaces(load({}).html())).toBe(true);
    });

    test('a basketball league gets Dribbles', () => {
        expect(isDribbles(load({ leagueSport: 'basketball' }).html())).toBe(true);
    });

    test('a page pinned to football gets Laces even inside a basketball league', () => {
        const m = load({ leagueSport: 'basketball', body: '<main data-page-sport="football"><span id="slot"></span></main>' });
        expect(m.sport(document.getElementById('slot'))).toBe('football');
    });

    test('a throwing ccLeague falls back to Laces', () => {
        const m = load({});
        window.ccLeague = { sport: () => { throw new Error('seed missing'); } };
        expect(m.sport()).toBe('football');
    });
});

describe('placeholders and state', () => {
    test('hydrate fills [data-ccm] once, honouring size, sport and busy', () => {
        load({ leagueSport: 'football', body: '<span id="a" data-ccm="head" data-ccm-sport="basketball" data-ccm-busy></span><span id="b" data-ccm="full"></span>' });
        const a = document.getElementById('a');
        const b = document.getElementById('b');
        expect(isDribbles(a.innerHTML)).toBe(true);
        expect(a.querySelector('.ccm-wrap').classList.contains('is-busy')).toBe(true);
        expect(a.querySelector('svg').classList.contains('ccm-head')).toBe(true);
        expect(isLaces(b.innerHTML)).toBe(true);
        expect(b.querySelector('.ccm-wrap').classList.contains('is-busy')).toBe(false);
        const before = a.innerHTML;
        window.ccMascot.hydrate(document);
        expect(a.innerHTML).toBe(before);   // not redrawn (ids would churn)
    });

    test('setBusy starts and stops the loop', () => {
        const m = load({});
        document.body.innerHTML = `<div id="x">${m.html()}</div>`;
        const x = document.getElementById('x');
        m.setBusy(x, true);
        expect(x.querySelector('.ccm-wrap').classList.contains('is-busy')).toBe(true);
        m.setBusy(x, false);
        expect(x.querySelector('.ccm-wrap').classList.contains('is-busy')).toBe(false);
    });

    test('every drawing gets its own clip-path ids, including the two-mascot ties', () => {
        const m = load({});
        const html = [m.html(), m.html({ sport: 'basketball' }),
            m.html({ pose: 'tugduo' }), m.html({ sport: 'basketball', pose: 'jumpball' })].join('');
        const ids = html.match(/clipPath id="([^"]+)"/g);
        expect(new Set(ids).size).toBe(ids.length);
    });

    // Every placement sits beside text that already says what's happening; a
    // screen reader announcing "Laces, image" on each loader is noise.
    test('decorative by default; a label makes it a real image', () => {
        const m = load({});
        const plain = m.html();
        expect(plain).toContain('aria-hidden="true"');
        expect(plain).not.toContain('role="img"');
        const named = m.html({ label: 'Laces <celebrating>' });
        expect(named).toContain('role="img"');
        expect(named).toContain('aria-label="Laces &lt;celebrating&gt;"');
        expect(named).not.toContain('aria-hidden');
    });

    test('a pinned football page hydrates Laces even inside a basketball league', () => {
        load({ leagueSport: 'basketball', body: '<main data-page-sport="football"><span id="s" data-ccm="head"></span></main>' });
        expect(isLaces(document.getElementById('s').innerHTML)).toBe(true);
    });

    test('the ice-pack pose frowns instead of smiling', () => {
        const m = load({});
        expect(m.html({ pose: 'icepack' })).toContain('ccm-frown');
        expect(m.html({ pose: 'icepack' })).not.toContain('ccm-f-tongue');
        expect(m.html({ pose: 'trophy' })).toContain('ccm-f-tongue');
    });
});
