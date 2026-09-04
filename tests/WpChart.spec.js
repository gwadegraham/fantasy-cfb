/**
 * @jest-environment jsdom
 *
 * public/wp-chart.js — the live win-probability card on the game detail page.
 *
 * The design constraint these tests exist to hold: the card reports the game
 * STATE at a snapshot and never claims a play caused a swing. `lastPlay` is
 * only whatever CFBD had reported when we sampled, so at a 2-minute cadence a
 * causal caption would frequently be confidently wrong. See the header comment
 * in the module.
 */

const wp = require('../public/wp-chart.js');

// The scrubber's pinned moment is module state that survives a re-render on
// purpose (see reset()), so each test starts from a clean one.
afterEach(() => wp.reset());

// A snapshot in the shape modules/scoreboard.js writes.
const snap = (period, clock, homeWinProb, over = {}) => Object.assign({
    at: new Date('2026-09-12T23:45:00Z'),
    period, clock, homeWinProb,
    homePoints: 7, awayPoints: 3,
    situation: '2nd & 6 at LSU 41',
    lastPlay: 'Nussmeier pass complete to Anderson for 4 yds'
}, over);

const game = (snapshots, over = {}) => Object.assign({
    homeTeam: 'LSU', awayTeam: 'Alabama',
    pregameWinProb: 0.62,
    wpSnapshots: snapshots
}, over);

describe('clockSeconds', () => {
    it('parses a game clock', () => {
        expect(wp.clockSeconds('7:42')).toBe(462);
        expect(wp.clockSeconds('15:00')).toBe(900);
        expect(wp.clockSeconds('0:00')).toBe(0);
    });

    it('returns null for the clocks CFBD actually sends when there is none', () => {
        expect(wp.clockSeconds(null)).toBeNull();
        expect(wp.clockSeconds('')).toBeNull();
        expect(wp.clockSeconds('halftime')).toBeNull();
        expect(wp.clockSeconds('7:99')).toBeNull();
    });
});

describe('gameSeconds', () => {
    it('measures elapsed game time, not time remaining', () => {
        expect(wp.gameSeconds(1, '15:00')).toBe(0);
        expect(wp.gameSeconds(1, '7:30')).toBe(450);
        expect(wp.gameSeconds(4, '0:00')).toBe(3600);
    });

    it('keeps counting through overtime rather than piling up at the right edge', () => {
        expect(wp.gameSeconds(5, '0:00')).toBe(4500);
        expect(wp.gameSeconds(5, '0:00')).toBeGreaterThan(wp.gameSeconds(4, '0:00'));
    });

    it('returns null when there is no usable clock', () => {
        expect(wp.gameSeconds(null, '7:42')).toBeNull();
        expect(wp.gameSeconds(2, null)).toBeNull();
    });
});

describe('buildSeries', () => {
    it('anchors the front of the curve with the pregame probability', () => {
        const series = wp.buildSeries(game([snap(1, '13:00', 0.58)]));

        expect(series).toHaveLength(2);
        expect(series[0]).toMatchObject({ wp: 0.62, anchor: true });
        expect(series[1]).toMatchObject({ t: 120, wp: 0.58, anchor: false });
    });

    // The anchor sits before kickoff, not on it. At t=0 it stacks on top of a
    // 1st/15:00 snapshot and makes that sample impossible to scrub to.
    it('places the pregame anchor before the opening kickoff', () => {
        const series = wp.buildSeries(game([snap(1, '15:00', 0.6)]));

        expect(series[0].t).toBeLessThan(0);
        expect(series[1].t).toBe(0);
    });

    it('starts at the first snapshot when there is no pregame number', () => {
        const series = wp.buildSeries(game([snap(1, '13:00', 0.58)], { pregameWinProb: null }));

        expect(series).toHaveLength(1);
        expect(series[0].anchor).toBe(false);
    });

    it('skips snapshots with no probability', () => {
        const series = wp.buildSeries(game([
            snap(1, '13:00', 0.58),
            snap(1, '11:00', null),
            snap(1, '9:00', 0.61)
        ]));

        expect(series.map(p => p.wp)).toEqual([0.62, 0.58, 0.61]);
    });

    // A stuck period or a null clock mid-game must not fold the line back on
    // itself — time only ever advances.
    it('keeps the x-axis monotonic when the clock goes backwards or missing', () => {
        const series = wp.buildSeries(game([
            snap(2, '10:00', 0.5),
            snap(1, '2:00', 0.5),   // period regressed
            snap(null, null, 0.5)   // no clock at all
        ]));

        const times = series.map(p => p.t);
        for (let i = 1; i < times.length; i++) {
            expect(times[i]).toBeGreaterThan(times[i - 1]);
        }
    });

    it('survives a game with no snapshots at all', () => {
        expect(wp.buildSeries(game([]))).toHaveLength(1);
        expect(wp.buildSeries({})).toEqual([]);
        expect(wp.buildSeries(undefined)).toEqual([]);
    });
});

describe('buildModel', () => {
    it('refuses to draw a line through fewer than two points', () => {
        expect(wp.buildModel(game([]))).toBeNull();
        expect(wp.buildModel(game([], { pregameWinProb: null }))).toBeNull();
    });

    it('places a higher probability higher on the chart', () => {
        const model = wp.buildModel(game([snap(1, '10:00', 0.9), snap(2, '10:00', 0.1)]));
        const [, high, low] = model.points;

        expect(high.y).toBeLessThan(low.y);
    });

    it('advances x with game time', () => {
        const model = wp.buildModel(game([snap(1, '10:00', 0.5), snap(3, '10:00', 0.5)]));
        const xs = model.points.map(p => p.x);

        expect(xs[1]).toBeGreaterThan(xs[0]);
        expect(xs[2]).toBeGreaterThan(xs[1]);
    });

    it('labels the four quarters and puts a divider between them', () => {
        const model = wp.buildModel(game([snap(1, '10:00', 0.5), snap(4, '2:00', 0.5)]));

        expect(model.segments.map(s => s.label)).toEqual(['1st', '2nd', '3rd', '4th']);
        expect(model.dividers).toHaveLength(3);
    });

    it('extends the axis into overtime once the game gets there', () => {
        const model = wp.buildModel(game([snap(1, '10:00', 0.5), snap(5, '0:00', 0.5)]));

        expect(model.segments.map(s => s.label)).toContain('OT');
        expect(model.span).toBeGreaterThan(3600);
    });
});

describe('splitAtMidline', () => {
    const at = (...probs) => wp.splitAtMidline(
        probs.map((w, i) => ({ x: i * 10, y: 0, wp: w })), 50
    );

    it('leaves a curve that never crosses as a single run', () => {
        const runs = at(0.6, 0.7, 0.8);

        expect(runs).toHaveLength(1);
        expect(runs[0].home).toBe(true);
    });

    it('cuts the line where the lead changes hands', () => {
        const runs = at(0.6, 0.4);

        expect(runs.map(r => r.home)).toEqual([true, false]);
    });

    // The two runs have to meet exactly on the midline, or the join shows as a
    // notch at every lead change.
    it('joins the two runs on the midline, with no gap', () => {
        const [first, second] = at(0.6, 0.4);
        const end = first.pts[first.pts.length - 1];

        expect(end.y).toBe(50);
        expect(second.pts[0]).toBe(end);
    });

    it('puts the crossing where the line actually crosses, not at a sample', () => {
        // 0.6 -> 0.4 crosses exactly halfway between x=0 and x=10.
        const [first] = at(0.6, 0.4);

        expect(first.pts[first.pts.length - 1].x).toBeCloseTo(5, 5);
    });

    it('handles a game that changes hands repeatedly', () => {
        const runs = at(0.6, 0.4, 0.7, 0.3);

        expect(runs.map(r => r.home)).toEqual([true, false, true, false]);
    });

    it('treats a dead-even sample as the home side rather than splitting twice', () => {
        const runs = at(0.5, 0.5);

        expect(runs).toHaveLength(1);
    });
});

describe('indexAt', () => {
    // A swing is drawn as the segment BETWEEN two samples, and it is the later
    // one whose score and lastPlay explain the move. Snapping backwards would
    // caption a drop with the play that came before it.
    it('snaps to the later of the two samples a position falls between', () => {
        const model = wp.buildModel(game([
            snap(1, '15:00', 0.6), snap(1, '13:00', 0.6), snap(1, '11:00', 0.6)
        ]));
        const pts = model.points;
        const between = (pts[1].x + pts[2].x) / 2;

        expect(wp.indexAt(model, between)).toBe(2);
    });

    it('lands on a sample when the position is exactly on it', () => {
        const model = wp.buildModel(game([snap(1, '15:00', 0.6), snap(1, '13:00', 0.6)]));

        expect(wp.indexAt(model, model.points[1].x)).toBe(1);
    });

    it('clamps past either end', () => {
        const model = wp.buildModel(game([snap(1, '15:00', 0.6), snap(1, '13:00', 0.6)]));

        expect(wp.indexAt(model, -500)).toBe(0);
        expect(wp.indexAt(model, 99999)).toBe(model.points.length - 1);
    });
});

describe('swingDots', () => {
    const pts = (...probs) => probs.map((w, i) => ({ i, wp: w }));

    it('marks a large move and ignores drift', () => {
        const dots = wp.swingDots(pts(0.50, 0.51, 0.52, 0.80, 0.81));

        expect(dots).toHaveLength(1);
        expect(dots[0].i).toBe(3);
    });

    it('records the direction of the move', () => {
        expect(wp.swingDots(pts(0.5, 0.8))[0].d).toBeGreaterThan(0);
        expect(wp.swingDots(pts(0.8, 0.5))[0].d).toBeLessThan(0);
    });

    it('does not crowd two dots onto neighbouring samples', () => {
        const dots = wp.swingDots(pts(0.50, 0.75, 0.95));

        expect(dots).toHaveLength(1);
    });

    it('caps how many it draws on a wild game', () => {
        const zigzag = [];
        for (let i = 0; i < 60; i++) zigzag.push({ i, wp: i % 2 ? 0.8 : 0.2 });

        expect(wp.swingDots(zigzag).length).toBeLessThanOrEqual(8);
    });

    it('returns them in chart order, not by size', () => {
        const dots = wp.swingDots(pts(0.50, 0.62, 0.50, 0.50, 0.95));

        expect(dots.map(d => d.i)).toEqual([1, 4]);
    });
});

describe('readoutHtml', () => {
    const ctx = { homeTeam: 'LSU', awayTeam: 'Alabama', homeAbbr: 'LSU', awayAbbr: 'BAMA' };
    const at = (g, i) => wp.readoutHtml(wp.buildModel(g).points[i], ctx);

    it('rests on the pregame anchor — the one point the live strip never shows', () => {
        const html = at(game([snap(1, '13:00', 0.58)]), 0);

        expect(html).toContain('Pregame');
        expect(html).toContain('LSU 62.0%');
    });

    it('reports the clock, the score and the play at a sample', () => {
        const html = at(game([snap(3, '7:42', 0.58, { homePoints: 21, awayPoints: 17 })]), 1);

        expect(html).toContain('Q3');
        expect(html).toContain('7:42');
        expect(html).toContain('BAMA 17 – 21 LSU');
        expect(html).toContain('2nd &amp; 6 at LSU 41');
        expect(html).toContain('Nussmeier pass complete');
    });

    // The headline numbers above the readout carry the scrubbed split, so
    // repeating it down here would show the same figure twice.
    it('leaves the percentage to the headline once past the anchor', () => {
        const html = at(game([snap(3, '7:42', 0.58)]), 1);

        expect(html).not.toContain('58.0%');
    });

    // The whole point of the redesign: state, never causation.
    it('never asserts that a play caused the move', () => {
        const html = at(game([snap(4, '6:02', 0.28, { lastPlay: 'Simpson 34-yd TD run' })]), 1);

        expect(html).not.toMatch(/biggest|swing|because|caused|turning point/i);
    });

    it('leaves out the parts a snapshot does not have', () => {
        const html = at(game([snap(2, '4:00', 0.5, {
            situation: null, lastPlay: null, homePoints: null, awayPoints: null
        })]), 1);

        expect(html).toContain('Q2');
        expect(html).not.toContain('gd-wp-score');
        expect(html).not.toContain('gd-wp-play');
    });

    // CFBD authors lastPlay, so it reaches innerHTML as untrusted prose.
    it('escapes play text rather than injecting it', () => {
        const html = at(game([snap(2, '4:00', 0.5, { lastPlay: '<img src=x onerror=alert(1)>' })]), 1);

        expect(html).not.toContain('<img');
        expect(html).toContain('&lt;img');
    });
});

describe('render', () => {
    const ctx = { homeTeam: 'LSU', awayTeam: 'Alabama' };

    it('returns nothing when there is not yet a curve to draw', () => {
        expect(wp.render(game([], { pregameWinProb: null }), ctx)).toBe('');
    });

    // The complaint that drove this: a game Alabama won rendered as an all-purple
    // LSU-coloured chart, which read as though LSU had won it.
    it('ends a game the away team won in the away colour', () => {
        const html = wp.render(game([
            snap(1, '13:00', 0.62), snap(4, '2:00', 0.30), snap(4, '0:00', 0)
        ], { completed: true }), { homeTeam: 'LSU', awayTeam: 'Alabama',
             homeColor: '#5c388c', awayColor: '#a2243a' });

        // The final point, and the run reaching it, both belong to Alabama.
        expect(html).toContain('class="gd-wp-now"');
        expect(html.slice(html.indexOf('gd-wp-now') - 120, html.indexOf('gd-wp-now'))).toContain('#a2243a');
    });

    it('draws a separate stroke for each side of the midline', () => {
        const html = wp.render(game([
            snap(1, '13:00', 0.62), snap(3, '5:00', 0.30), snap(4, '1:00', 0.66)
        ]), { homeTeam: 'LSU', awayTeam: 'Alabama', homeColor: '#5c388c', awayColor: '#a2243a' });
        const strokes = (html.match(/class="gd-wp-line"/g) || []).length;

        expect(strokes).toBe(3);
        expect(html).toContain('#5c388c');
        expect(html).toContain('#a2243a');
    });

    it('shows the latest sample as the headline probability', () => {
        const html = wp.render(game([snap(1, '13:00', 0.58), snap(3, '5:00', 0.735)]), ctx);

        expect(html).toContain('73.5%');   // home, latest
        expect(html).toContain('26.5%');   // away, the complement
    });

    // The poller closes the series with a terminal 1/0 built from the final
    // score (buildFinalSnapshot in modules/scoreboard.js). The card is shown
    // again below the box score once a game is final, so that point is what a
    // reader lands on.
    it('ends a finished game pinned at certainty', () => {
        const html = wp.render(game([
            snap(1, '13:00', 0.58),
            snap(4, '2:00', 0.71),
            snap(4, '0:00', 1, { homePoints: 31, awayPoints: 24, situation: null, lastPlay: null })
        ], { completed: true }), ctx);

        expect(html).toContain('100.0%');
        expect(html).toContain('0.0%');
    });

    it('has nothing to draw for a game that finished before the series existed', () => {
        expect(wp.render({ homeTeam: 'LSU', awayTeam: 'Alabama', completed: true }, ctx)).toBe('');
    });

    it('keeps the predictor card\'s shape so nothing jumps at kickoff', () => {
        const html = wp.render(game([snap(1, '13:00', 0.58)]), ctx);

        expect(html).toContain('gd-section');
        expect(html).toContain('gd-field-probs');
        expect(html).toContain('gd-field-pct');
    });
});

describe('scrubbing', () => {
    const ctx = { homeTeam: 'LSU', awayTeam: 'Alabama', homeAbbr: 'LSU', awayAbbr: 'BAMA' };

    function mount() {
        const g = game([
            snap(1, '13:00', 0.58, { homePoints: 0, awayPoints: 0, lastPlay: 'Kickoff' }),
            snap(2, '9:00', 0.44, { homePoints: 7, awayPoints: 10, lastPlay: 'Williams 8-yd TD run' }),
            snap(4, '3:00', 0.81, { homePoints: 24, awayPoints: 17, lastPlay: 'Ramos 27-yd FG' })
        ]);
        document.body.innerHTML = wp.render(g, ctx);
        const plot = document.querySelector('.gd-wp-plot');
        // jsdom gives every element a zero-size rect, so pointer maths needs a
        // real box to map clientX into the viewBox.
        plot.querySelector('.gd-wp-svg').getBoundingClientRect = () => ({ left: 0, width: 340 });
        wp.attach(document);
        return { plot, readout: document.querySelector('.gd-wp-readout') };
    }

    afterEach(() => { document.body.innerHTML = ''; });

    it('opens on the pregame anchor, with a hint to scrub', () => {
        const { readout } = mount();

        expect(readout.textContent).toContain('Pregame');
        expect(readout.textContent).toContain('Drag across the chart');
    });

    const headline = () => [...document.querySelectorAll('.gd-wp .gd-field-pct')].map(e => e.textContent);

    it('opens on the latest split, not on the moment under the scrubber', () => {
        mount();

        // 0.81 home at the last sample -> 19.0 away / 81.0 home.
        expect(headline()).toEqual(['19.0%', '81.0%']);
    });

    it('moves the headline percentages with the scrubber', () => {
        const { plot } = mount();

        plot.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
        expect(headline()).toEqual(['38.0%', '62.0%']);   // the pregame anchor

        plot.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
        expect(headline()).toEqual(['42.0%', '58.0%']);

        plot.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
        expect(headline()).toEqual(['56.0%', '44.0%']);   // away ahead
    });

    it('puts the headline back to the latest split when the scrub ends', () => {
        const { plot } = mount();

        plot.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
        expect(headline()).toEqual(['38.0%', '62.0%']);

        plot.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        expect(headline()).toEqual(['19.0%', '81.0%']);
    });

    it('walks the series with the arrow keys', () => {
        const { plot, readout } = mount();

        plot.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
        expect(readout.textContent).toContain('Pregame');

        plot.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
        expect(readout.textContent).toContain('Q1');
        expect(readout.textContent).toContain('Kickoff');

        plot.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
        expect(readout.textContent).toContain('Q2');
        expect(readout.textContent).toContain('BAMA 10 – 7 LSU');
        expect(readout.textContent).toContain('Williams 8-yd TD run');
    });

    it('does not run off either end of the series', () => {
        const { plot, readout } = mount();

        for (let i = 0; i < 20; i++) plot.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
        expect(readout.textContent).toContain('Ramos 27-yd FG');

        for (let i = 0; i < 20; i++) plot.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
        expect(readout.textContent).toContain('Pregame');
    });

    it('shows the cursor and pin only while a moment is selected', () => {
        const { plot } = mount();
        const cursor = () => document.querySelector('.gd-wp-cursor');

        expect(cursor().hasAttribute('hidden')).toBe(true);

        plot.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
        expect(cursor().hasAttribute('hidden')).toBe(false);
        expect(plot.classList.contains('is-scrubbing')).toBe(true);

        plot.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        expect(cursor().hasAttribute('hidden')).toBe(true);
        expect(plot.classList.contains('is-scrubbing')).toBe(false);
    });

    it('scrubs to the sample under a mouse', () => {
        const { plot, readout } = mount();

        plot.dispatchEvent(Object.assign(new Event('pointermove', { bubbles: true }), {
            pointerType: 'mouse', clientX: 339, buttons: 0
        }));

        expect(readout.textContent).toContain('Ramos 27-yd FG');
    });

    it('leaves the reader where they are when the mouse goes away on touch', () => {
        const { plot, readout } = mount();

        plot.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
        plot.dispatchEvent(Object.assign(new Event('pointerleave', { bubbles: true }), { pointerType: 'touch' }));
        expect(readout.textContent).toContain('Ramos 27-yd FG');

        plot.dispatchEvent(Object.assign(new Event('pointerleave', { bubbles: true }), { pointerType: 'mouse' }));
        expect(readout.textContent).toContain('Pregame');
    });
});
