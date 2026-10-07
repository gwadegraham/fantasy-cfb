/**
 * @jest-environment jsdom
 *
 * public/live-motion.js — the motion the scoreboard and gamecast play when a
 * live refresh brings news. The rule under test: only a CHANGE animates.
 * Arrivals, corrections and catch-up bursts must stay still.
 */

const lm = require('../public/live-motion.js');

const g = (id, away, home, state = 'live') => ({
    id, state,
    away: { points: away },
    home: { points: home }
});

describe('scoreChanges', () => {
    it('reports the side that scored, with both numbers', () => {
        const out = lm.scoreChanges([g(1, 7, 3)], [g(1, 14, 3)]);
        expect(out.scored).toEqual([{ id: 1, side: 'away', from: 7, to: 14 }]);
    });

    it('reports both sides when both moved between refreshes', () => {
        const out = lm.scoreChanges([g(1, 7, 3)], [g(1, 10, 10)]);
        expect(out.scored.map(c => c.side)).toEqual(['away', 'home']);
    });

    it('ignores a game with no previous copy — an arrival is not news', () => {
        expect(lm.scoreChanges([], [g(1, 7, 3)]).scored).toEqual([]);
        expect(lm.scoreChanges(null, [g(1, 7, 3)]).scored).toEqual([]);
    });

    it('ignores a score that went DOWN (a CFBD correction)', () => {
        expect(lm.scoreChanges([g(1, 14, 3)], [g(1, 7, 3)]).scored).toEqual([]);
    });

    it('ignores a game that had no score yet (kickoff, null -> 0)', () => {
        const pre = { id: 1, state: 'pre', away: { points: null }, home: { points: null } };
        expect(lm.scoreChanges([pre], [g(1, 0, 0)]).scored).toEqual([]);
    });

    it('reports live -> final, and nothing else as a final', () => {
        const out = lm.scoreChanges(
            [g(1, 7, 3), g(2, 0, 0, 'final'), g(3, 0, 0, 'pre')],
            [g(1, 7, 3, 'final'), g(2, 0, 0, 'final'), g(3, 0, 0, 'final')]
        );
        expect(out.finals).toEqual([1]);
    });
});

describe('freshPlays', () => {
    const p = (clock, text) => ({ period: 2, clock, playText: text });

    it('treats the first look at a game as history', () => {
        expect(lm.freshPlays(null, [p('9:00', 'a'), p('8:30', 'b')])).toEqual([]);
    });

    it('returns only the plays not seen before', () => {
        const seen = new Set([lm.playKey(p('9:00', 'a'))]);
        expect(lm.freshPlays(seen, [p('9:00', 'a'), p('8:30', 'b')])).toEqual([lm.playKey(p('8:30', 'b'))]);
    });

    it('treats a big catch-up burst as history', () => {
        const plays = Array.from({ length: 9 }, (_, i) => p('1:0' + i, 'x' + i));
        expect(lm.freshPlays(new Set(), plays)).toEqual([]);
        expect(lm.freshPlays(new Set(), plays.slice(0, 3))).toHaveLength(3);
    });

    it('keeps a play\'s key when CFBD rewords its text, so it does not slide in twice', () => {
        expect(lm.playKey(p('9:00', 'Smith pass to Jones'))).toBe(lm.playKey(p('9:00', 'Smith pass complete to Jones for 9 yds')));
    });

    it('keys two different plays at the same clock apart', () => {
        const timeout = { period: 2, clock: '9:00', playType: 'Timeout' };
        const rush = { period: 2, clock: '9:00', playType: 'Rush' };
        expect(lm.playKey(timeout)).not.toBe(lm.playKey(rush));
    });
});

describe('stampLabel', () => {
    it.each([
        ['Passing Touchdown', 'Touchdown'],
        ['Fumble Return Touchdown', 'Touchdown'],
        ['Field Goal Good', 'Field Goal'],
        ['Safety', 'Safety'],
        ['Two Point Conversion', 'Two Points'],
        ['Defensive 2pt Conversion', 'Two Points'],
        ['Something New', 'Score'],
        [null, 'Score']
    ])('%s -> %s', (type, label) => {
        expect(lm.stampLabel(type)).toBe(label);
    });

    // The points can land on a row whose type says nothing about the score:
    // the extra-point row, or the next kickoff.
    it.each([
        ['Kickoff', 6, 'Touchdown'],
        ['Kickoff', 7, 'Touchdown'],
        ['Kickoff', 3, 'Field Goal'],
        ['Kickoff', 2, 'Two Points'],
        ['Passing Touchdown', 7, 'Touchdown']
    ])('%s worth %i -> %s', (type, points, label) => {
        expect(lm.stampLabel(type, points)).toBe(label);
    });

    it('gives an extra point no stamp of its own', () => {
        expect(lm.stampLabel('Extra Point Good', 1)).toBeNull();
        expect(lm.stampLabel('Kickoff', 1)).toBeNull();
    });
});

describe('DOM helpers', () => {
    let reduce;
    beforeEach(() => {
        reduce = false;
        window.matchMedia = () => ({ matches: reduce });
        jest.useFakeTimers();
    });
    afterEach(() => {
        jest.useRealTimers();
        delete window.matchMedia;
        document.body.innerHTML = '';
    });

    it('countTo leaves the possession icon alone and lands on the real score', () => {
        document.body.innerHTML = '<span class="s"><i class="ball"></i> 21</span>';
        const el = document.querySelector('.s');
        lm.countTo(el, 14, 21, 100);
        expect(el.textContent.trim()).toBe('14');            // rewound to the old score
        jest.advanceTimersByTime(500);
        expect(el.textContent.trim()).toBe('21');
        expect(el.querySelector('i.ball')).not.toBeNull();
    });

    it('countTo still lands on the real score when animation frames never run (hidden tab)', () => {
        const raf = window.requestAnimationFrame;
        window.requestAnimationFrame = () => 0;   // a hidden tab: frames are suspended
        try {
            document.body.innerHTML = '<span class="s">21</span>';
            const el = document.querySelector('.s');
            lm.countTo(el, 14, 21, 100);
            expect(el.textContent).toBe('14');
            jest.advanceTimersByTime(300);
            expect(el.textContent).toBe('21');
        } finally {
            window.requestAnimationFrame = raf;
        }
    });

    it('pulse adds the class and clears it when its animation ends', () => {
        document.body.innerHTML = '<div class="c"></div>';
        const el = document.querySelector('.c');
        lm.pulse(el, 'flash', 'red');
        expect(el.classList.contains('flash')).toBe(true);
        expect(el.style.getPropertyValue('--lm-color')).toBe('red');
        el.dispatchEvent(new Event('animationend'));
        expect(el.classList.contains('flash')).toBe(false);
    });

    it('stamp lays the word over the host after the delay, then removes itself', () => {
        document.body.innerHTML = '<div class="host"></div>';
        const host = document.querySelector('.host');
        lm.stamp(host, 'Touchdown', '#f00', 900);
        expect(host.querySelector('.lm-stamp')).toBeNull();   // waits for the ball
        jest.advanceTimersByTime(900);
        const s = host.querySelector('.lm-stamp');
        expect(s.textContent).toBe('Touchdown');
        expect(s.getAttribute('aria-hidden')).toBe('true');
        s.dispatchEvent(new Event('animationend'));
        expect(host.querySelector('.lm-stamp')).toBeNull();
    });

    it('does nothing at all under prefers-reduced-motion', () => {
        reduce = true;
        document.body.innerHTML = '<div class="host"><span class="s">21</span></div>';
        const host = document.querySelector('.host');
        lm.countTo(host.querySelector('.s'), 14, 21);
        lm.pulse(host, 'flash');
        lm.stamp(host, 'Touchdown');
        jest.advanceTimersByTime(1000);
        expect(host.querySelector('.s').textContent).toBe('21');
        expect(host.classList.contains('flash')).toBe(false);
        expect(host.querySelector('.lm-stamp')).toBeNull();
    });
});
