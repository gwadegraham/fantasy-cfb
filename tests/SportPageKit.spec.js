/**
 * @jest-environment jsdom
 *
 * public/sport-page.js — the shared kit behind the sport pages (#506).
 * Every team and game page leans on these, so each helper is pinned here
 * on its own rather than only through one page's rendering.
 */
window.ccKickoff = require('../public/kickoff-day.js');
const kit = require('../public/sport-page.js');

afterEach(() => { jest.restoreAllMocks(); });

test('registers itself on window, the way the page scripts reach it', () => {
    expect(window.ccSportPage).toBe(kit);
});

test('esc escapes all five HTML specials, and null is empty', () => {
    expect(kit.esc('<a href="x">\'&\'</a>')).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
    expect(kit.esc(null)).toBe('');
    expect(kit.esc(0)).toBe('0');
});

test('fixed rounds, and a missing or non-finite number is a dash', () => {
    expect(kit.fixed(51.25, 1)).toBe('51.3');
    expect(kit.fixed(0, 1)).toBe('0.0');
    expect(kit.fixed(null, 1)).toBe('—');
    expect(kit.fixed(NaN, 1)).toBe('—');
    expect(kit.pct(0.614)).toBe(61);
});

test('record counts wins from us/them', () => {
    expect(kit.record([{ us: 80, them: 70 }, { us: 60, them: 61 }, { us: 75, them: 74 }])).toBe('2–1');
    expect(kit.record([])).toBe('0–0');
});

test('short names, except where two players would collide', () => {
    expect(kit.shortName('Cameron Boozer')).toBe('C. Boozer');
    expect(kit.shortName('Madonna')).toBe('Madonna');
    expect(kit.shortName('Isaiah Evans Jr.')).toBe('I. Evans Jr.');
    expect(kit.shortNames([{ name: 'Cameron Boozer' }, { name: 'Cayden Boozer' }, { name: 'Isaiah Evans' }]))
        .toEqual({ 'Cameron Boozer': 'Cameron Boozer', 'Cayden Boozer': 'Cayden Boozer', 'Isaiah Evans': 'I. Evans' });
});

test('dayOf reads the day through ccKickoff, so a TBD tip keeps its real day', () => {
    // CBBD's TBD placeholder: midnight EASTERN, which is the previous day in Central.
    expect(kit.dayOf({ startDate: '2026-11-14T05:00:00.000Z', startTimeTbd: true })).toBe('Nov 14');
    expect(kit.dayOf({ startDate: '2026-11-14T23:00:00.000Z', startTimeTbd: false })).toBe('Nov 14');
});

test('dayOf without ccKickoff falls back to the browser, and a bad date is blank', () => {
    const k = window.ccKickoff;
    delete window.ccKickoff;
    try {
        expect(kit.dayOf({ startDate: '2026-11-14T18:00:00.000Z' })).toBe('Nov 14');
        expect(kit.dayOf({ startDate: 'not a date' })).toBe('');
        expect(kit.countdown({ startDate: '2026-11-14T18:00:00.000Z' })).toBe('Upcoming');
    } finally { window.ccKickoff = k; }
});

describe('countdown', () => {
    const at = (iso) => new Date(iso).getTime();
    const tip = { startDate: '2026-11-14T01:00:00.000Z', startTimeTbd: false };    // Fri Nov 13, 7 PM Central

    test('same day: Tonight', () => {
        expect(kit.countdown(tip, at('2026-11-13T15:00:00.000Z'))).toMatch(/^Tonight · 7:00 PM/);
    });
    test('the day before: Tomorrow', () => {
        expect(kit.countdown(tip, at('2026-11-12T15:00:00.000Z'))).toMatch(/^Tomorrow · 7:00 PM/);
    });
    test('further out: weekday and date', () => {
        expect(kit.countdown(tip, at('2026-11-01T15:00:00.000Z'))).toMatch(/^Fri, Nov 13 · 7:00 PM/);
    });
    test('past tip with no result: says so instead of counting down to the past', () => {
        expect(kit.countdown(tip, at('2026-11-14T02:00:00.000Z'))).toBe('Awaiting the result');
    });
    test('a TBD tip keeps its day and never claims to be under way', () => {
        const tbd = { startDate: '2026-11-14T05:00:00.000Z', startTimeTbd: true };
        expect(kit.countdown(tbd, at('2026-11-14T12:00:00.000Z'))).toBe('Tonight · time TBD');
    });
});

test('tabs: one button per entry, the active one marked, labels escaped', () => {
    document.body.innerHTML = kit.tabs([['a', 'One'], ['b', '<Two>']], 'b');
    const btns = Array.from(document.querySelectorAll('.sp-tabs .sp-tab'));
    expect(btns.map(b => b.getAttribute('data-tab'))).toEqual(['a', 'b']);
    expect(btns.map(b => b.getAttribute('aria-selected'))).toEqual(['false', 'true']);
    expect(document.querySelector('.sp-tab.on').textContent).toBe('<Two>');
});

describe('fitNames', () => {
    function row(full, abbr) {
        document.body.innerHTML = '<div id="r"><span class="nm"><span class="n" title="' + full + '" data-abbr="' + abbr + '">' + full + '</span></span></div>';
        return document.querySelector('.n');
    }
    test('a name that clips becomes its abbreviation (measured against its parent)', () => {
        const n = row('Michigan State', 'MSU');
        jest.spyOn(document, 'createRange').mockReturnValue({ selectNodeContents() {}, getBoundingClientRect: () => ({ width: 120.4 }) });
        jest.spyOn(n.parentNode, 'getBoundingClientRect').mockReturnValue({ width: 120 });
        kit.fitNames(document, '.n[data-abbr]');
        expect(n.textContent).toBe('MSU');
    });
    test('a name that fits is restored to full, even after being shortened', () => {
        const n = row('Duke', 'DUKE');
        n.textContent = 'DUKE';
        jest.spyOn(document, 'createRange').mockReturnValue({ selectNodeContents() {}, getBoundingClientRect: () => ({ width: 40 }) });
        jest.spyOn(n.parentNode, 'getBoundingClientRect').mockReturnValue({ width: 120 });
        kit.fitNames(document, '.n[data-abbr]');
        expect(n.textContent).toBe('Duke');
    });
    test('without Range measurement it falls back to whole pixels, never a crash', () => {
        const n = row('Michigan State', 'MSU');
        jest.spyOn(document, 'createRange').mockReturnValue(null);
        Object.defineProperty(n.parentNode, 'scrollWidth', { value: 130, configurable: true });
        Object.defineProperty(n.parentNode, 'clientWidth', { value: 120, configurable: true });
        kit.fitNames(document, '.n[data-abbr]');
        expect(n.textContent).toBe('MSU');
    });
});

describe('load', () => {
    const root = () => { document.body.innerHTML = '<main id="m"></main>'; return document.getElementById('m'); };
    test('a 2xx body goes to render, with the JSON Accept header', async () => {
        const render = jest.fn();
        window.fetch = jest.fn(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ a: 1 }) }));
        await kit.load('/x', render, root(), 'team');
        expect(render).toHaveBeenCalledWith({ a: 1 });
        expect(window.fetch.mock.calls[0][1].headers.Accept).toBe('application/json');
    });
    test('an error status shows the server\'s message', async () => {
        const m = root();
        window.fetch = jest.fn(() => Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({ message: 'No <such> team' }) }));
        await kit.load('/x', jest.fn(), m, 'team');
        expect(m.querySelector('.sp-error').textContent).toBe('No <such> team');
    });
    test('an error with no JSON body names the noun and the status', async () => {
        const m = root();
        window.fetch = jest.fn(() => Promise.resolve({ ok: false, status: 502, json: () => Promise.reject(new Error('html')) }));
        await kit.load('/x', jest.fn(), m, 'game');
        expect(m.querySelector('.sp-error').textContent).toBe('Could not load this game (502)');
    });
    test('a network failure is an error state too', async () => {
        const m = root();
        window.fetch = jest.fn(() => Promise.reject(new Error('offline')));
        await kit.load('/x', jest.fn(), m, 'game');
        expect(m.querySelector('.sp-error').textContent).toBe('offline');
    });
});

test('the sticky tabs sit exactly under the navbar, re-measured on resize', () => {
    document.body.innerHTML = '<nav id="navbar"></nav>';
    const nav = document.getElementById('navbar');
    jest.spyOn(nav, 'getBoundingClientRect').mockReturnValue({ height: 64.7 });
    window.dispatchEvent(new Event('resize'));
    expect(document.documentElement.style.getPropertyValue('--sp-sticky-top')).toBe('64px');
    document.body.innerHTML = '';
    kit.syncStickyTop();
    expect(document.documentElement.style.getPropertyValue('--sp-sticky-top')).toBe('0px');
});

describe('team colours', () => {
    test('readable eases a dark colour toward white, leaves a bright one, refuses junk', () => {
        expect(kit.readable('#013088')).toBe('#738dbd');                 // Duke navy, lifted
        expect(kit.readable('#000000')).toBe('#8c8c8c');
        expect(kit.readable('#fa4616')).toBe('#fa4616');                 // already reads
        expect(kit.readable('#fff')).toBe('#ffffff');                     // short form
        expect(kit.readable('navy')).toBeNull();
        expect(kit.readable(null)).toBeNull();
    });
    test('two distinct primaries are kept', () => {
        expect(kit.matchColors({ color: '#bf5700' }, { color: '#013088' })).toEqual({ away: '#cb752e', home: '#738dbd' });
    });
    test('two navies: home takes its alternate', () => {
        expect(kit.matchColors({ color: '#013088' }, { color: '#0021A5', altColor: '#fa4616' }))
            .toEqual({ away: '#738dbd', home: '#fa4616' });
    });
    test('home has no usable alternate: away takes its own', () => {
        expect(kit.matchColors({ color: '#013088', altColor: '#ffd200' }, { color: '#0021A5', altColor: '#0021A5' }))
            .toEqual({ away: '#ffd200', home: kit.readable('#0021A5') });
    });
    test('no alternates at all: home falls back to the neutral grey', () => {
        // Two reds: grey is far enough from the away red, so home goes grey.
        expect(kit.matchColors({ color: '#c8102e' }, { color: '#ba0c2f' })).toEqual({ away: kit.readable('#c8102e'), home: '#8A90A8' });
        // …unless away is itself near that grey, when home goes white.
        expect(kit.matchColors({ color: '#8A90A8' }, { color: '#8a8fa6' }).home).toBe('#F4F6FB');
    });
    test('missing colours on either side are the neutral fill, never undefined', () => {
        const c = kit.matchColors({}, null);
        expect(c.away).toBe('#8A90A8');
        expect(c.home).toBe('#F4F6FB');
    });
});

describe('countUp', () => {
    const el = (to, sign) => {
        document.body.innerHTML = '<div id="r"><b data-countup="' + to + '"' + (sign ? ' data-sign="+"' : '') + '>' + (sign && to > 0 ? '+' : '') + to + '</b></div>';
        return document.querySelector('b');
    };
    let frames;
    beforeEach(() => {
        frames = [];
        window.requestAnimationFrame = (fn) => { frames.push(fn); return frames.length; };
        Object.defineProperty(document, 'hidden', { value: false, configurable: true });
        window.matchMedia = () => ({ matches: false });
    });
    afterEach(() => { delete window.matchMedia; delete document.hidden; });
    const run = (ts) => { const f = frames.splice(0); f.forEach(fn => fn(ts)); };

    test('ticks up from zero to the value, keeping the plus sign', () => {
        const b = el(12, true);
        kit.countUp(document);
        expect(b.textContent).toBe('0');
        run(0); run(425);
        const mid = Number(b.textContent.replace('+', ''));
        expect(mid).toBeGreaterThan(0);
        expect(mid).toBeLessThan(12);
        run(900);
        expect(b.textContent).toBe('+12');
        expect(frames).toHaveLength(0);                                   // stops at the end
    });
    test('a negative value counts down, with no plus', () => {
        const b = el(-3, true);
        kit.countUp(document);
        run(0); run(900);
        expect(b.textContent).toBe('-3');
    });
    test('reduced motion: the number at once, no frames', () => {
        window.matchMedia = (q) => ({ matches: /reduce/.test(q) });
        const b = el(7, true);
        kit.countUp(document);
        expect(b.textContent).toBe('+7');
        expect(frames).toHaveLength(0);
    });
    test('a hidden tab: the number at once', () => {
        Object.defineProperty(document, 'hidden', { value: true, configurable: true });
        const b = el(7);
        kit.countUp(document);
        expect(b.textContent).toBe('7');
        expect(frames).toHaveLength(0);
    });
    test('a value that is not a number is left alone', () => {
        document.body.innerHTML = '<b data-countup="abc">—</b>';
        kit.countUp(document);
        expect(document.querySelector('b').textContent).toBe('—');
    });
});
