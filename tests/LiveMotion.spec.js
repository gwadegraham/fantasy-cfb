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
    const play = (playType, playText) => ({ playType, playText });

    it.each([
        ['Passing Touchdown', 'Touchdown'],
        ['Fumble Return Touchdown', 'Touchdown'],
        ['Field Goal Good', 'Field Goal'],
        ['Safety', 'Safety'],
        ['Two Point Conversion', 'Two Points'],
        ['Defensive 2pt Conversion', 'Two Points']
    ])('%s -> %s', (type, label) => {
        expect(lm.stampLabel(play(type, ''))).toBe(label);
    });

    // CFBD types plenty of touchdown passes as a plain "Pass Reception".
    it('reads the play text when the type is generic', () => {
        expect(lm.stampLabel(play('Pass Reception', 'Smith pass complete to Jones for 24 yds for a TD (Ramos KICK)'))).toBe('Touchdown');
        expect(lm.stampLabel(play('Rush', 'Durham run for 3 yds, TOUCHDOWN'))).toBe('Touchdown');
    });

    // The Kentucky at South Carolina case: CFBD put SC's 14 on a fumble out of
    // bounds, two plays before the touchdown. The score change says "scoring",
    // the play does not, and a TOUCHDOWN stamp over a fumble is wrong.
    it.each([
        ['Fumble', '#16 L.Sellers rush right for 9 yards gain to the UKY21 fumbled by #16 L.Sellers at UKY19, out of bounds at UKY21, 1ST DOWN'],
        ['Sack', '#3 C.Hellums sacked for loss of 6 yards to the USF46'],
        ['Kickoff', '#37 L.Thorn kickoff 65 yards to the Army00 fair catch'],
        ['End Period', 'End of 2nd quarter.'],
        ['Rush', '#8 N.Poulos rush right for 5 yards gain to the OHIO50 (#9 J.Carr)']
    ])('gives no stamp to a %s the score was misfiled on', (type, text) => {
        expect(lm.stampLabel(play(type, text))).toBeNull();
    });

    it('does not read "TD" inside another word', () => {
        expect(lm.stampLabel(play('Rush', 'run to the STDN 40'))).toBeNull();
    });

    it('gives an extra point no stamp of its own', () => {
        expect(lm.stampLabel(play('Extra Point Good', 'Ramos extra point GOOD'))).toBeNull();
        expect(lm.stampLabel(null)).toBeNull();
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
