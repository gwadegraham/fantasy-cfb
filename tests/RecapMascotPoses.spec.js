/**
 * @jest-environment jsdom
 *
 * Which pose the mascot strikes on each weekly-recap slide (public/weekly-recap.js).
 * Laces celebrates two beats: a new season high gets the Griddy, and an untied
 * #1 league rank gets the Heisman. Both moves are his alone, so a basketball
 * recap gives Dribbles a cheer or the trophy instead, and Dribbles never shows
 * up on a football recap. Slides come from the real server-side buildSlides.
 */
const fs = require('fs');
const path = require('path');
const { buildSlides } = require('../modules/weekly-recap');

const read = f => fs.readFileSync(path.join(__dirname, '..', 'public', f), 'utf8');
const MASCOTS = read('mascots.js');
const RECAP = read('weekly-recap.js');

function load(leagueSport) {
    document.body.innerHTML = '';
    delete window.ccMascot;
    delete window.ccRecap;
    window.ccLeague = { sport: () => leagueSport, sportOf: () => leagueSport };
    new Function(MASCOTS)();
    new Function(RECAP)();
}

function recap(over) {
    const r = Object.assign({
        label: 'Week 6', score: 88, rank: 3, rankDelta: 1, rankTie: false,
        isSeasonHigh: false, effWeek: 6, narrative: 'A week.'
    }, over);
    r.slides = buildSlides(r);
    return r;
}

// slide id → { mascot, pose } for every slide that drew one, in slide order.
function posesFor(leagueSport, r) {
    load(leagueSport);
    window.ccRecap.closePopup();
    window.ccRecap.showPopup({ league: 'some-league', recaps: [r] }, 'u1');
    const out = {};
    document.querySelectorAll('.recap-slide').forEach(el => {
        const svg = el.querySelector('.recap-slide-mascot svg');
        if (!svg) return;
        out[el.dataset.slideId] = {
            mascot: svg.getAttribute('data-mascot'),
            pose: window.ccRecap.mascotPose({ id: el.dataset.slideId }, r, leagueSport)
        };
    });
    window.ccRecap.closePopup();
    return out;
}

describe('football: Laces celebrates', () => {
    test('a season high gets the Griddy', () => {
        const p = posesFor('football', recap({ isSeasonHigh: true }));
        expect(p.seasonhigh).toEqual({ mascot: 'Laces', pose: 'griddy' });
    });

    test('an untied #1 rank gets the Heisman', () => {
        const p = posesFor('football', recap({ rank: 1 }));
        expect(p.rank).toEqual({ mascot: 'Laces', pose: 'heisman' });
    });

    test('a shared #1 gets no mascot on the rank slide', () => {
        const p = posesFor('football', recap({ rank: 1, rankTie: true }));
        expect(p.rank).toBeUndefined();
    });

    test('any other rank gets no mascot on the rank slide', () => {
        const p = posesFor('football', recap({ rank: 2 }));
        expect(p.rank).toBeUndefined();
    });

    test('the older beats keep their poses', () => {
        expect(posesFor('football', recap({ weekHigh: true }))).toMatchObject({
            hook: { mascot: 'Laces', pose: 'cheer' },
            weekhigh: { mascot: 'Laces', pose: 'trophy' }
        });
        expect(posesFor('football', recap({ weekLow: true })).weeklow)
            .toEqual({ mascot: 'Laces', pose: 'icepack' });
    });

    test('Dribbles never appears on a football recap', () => {
        const p = posesFor('football', recap({ rank: 1, isSeasonHigh: true, weekHigh: true }));
        const mascots = new Set(Object.values(p).map(x => x.mascot));
        expect([...mascots]).toEqual(['Laces']);
    });
});

describe('basketball: Dribbles falls back to his own poses', () => {
    test('a season high gets a cheer, not the Griddy', () => {
        const p = posesFor('basketball', recap({ isSeasonHigh: true }));
        expect(p.seasonhigh).toEqual({ mascot: 'Dribbles', pose: 'cheer' });
    });

    test('an untied #1 rank gets the trophy, not the Heisman', () => {
        const p = posesFor('basketball', recap({ rank: 1 }));
        expect(p.rank).toEqual({ mascot: 'Dribbles', pose: 'trophy' });
    });

    test('no basketball slide is handed a Laces-only move', () => {
        const p = posesFor('basketball', recap({ rank: 1, isSeasonHigh: true, weekHigh: true }));
        for (const x of Object.values(p)) {
            expect(x.mascot).toBe('Dribbles');
            expect(['griddy', 'heisman']).not.toContain(x.pose);
        }
    });
});

describe('the drawing matches the pose', () => {
    // mascotPose deciding 'griddy' is no use if the popup draws something else.
    // Each celebration has its own animated group: the Griddy's hop, the
    // Heisman's body.
    test('the season-high slide draws the Griddy and the #1 slide the Heisman', () => {
        load('football');
        window.ccRecap.showPopup({ league: 'x', recaps: [recap({ rank: 1, isSeasonHigh: true })] }, 'u1');
        const has = (id, cls) => !!document.querySelector(`.recap-slide[data-slide-id="${id}"] .recap-slide-mascot .${cls}`);
        expect([has('seasonhigh', 'ccm-gr-hop'), has('seasonhigh', 'ccm-hz-body')]).toEqual([true, false]);
        expect([has('rank', 'ccm-hz-body'), has('rank', 'ccm-gr-hop')]).toEqual([true, false]);
        expect([has('hook', 'ccm-gr-hop'), has('hook', 'ccm-hz-body')]).toEqual([false, false]);
        window.ccRecap.closePopup();
    });

    test('on basketball, Dribbles holds the trophy at #1 and waves the foam finger on a season high', () => {
        load('basketball');
        window.ccRecap.showPopup({ league: 'x', recaps: [recap({ rank: 1, isSeasonHigh: true })] }, 'u1');
        const has = (id, cls) => !!document.querySelector(`.recap-slide[data-slide-id="${id}"] .recap-slide-mascot .${cls}`);
        expect([has('rank', 'ccm-prop'), has('rank', 'ccm-cc-foam')]).toEqual([true, false]);
        expect([has('seasonhigh', 'ccm-cc-foam'), has('seasonhigh', 'ccm-prop')]).toEqual([true, false]);
        window.ccRecap.closePopup();
    });

    test('the celebration only moves while its own slide is showing', () => {
        load('football');
        window.ccRecap.showPopup({ league: 'x', recaps: [recap({ rank: 1, isSeasonHigh: true })] }, 'u1');
        const busy = id => document.querySelector(`.recap-slide[data-slide-id="${id}"] .ccm-wrap`).classList.contains('is-busy');
        expect([busy('hook'), busy('rank'), busy('seasonhigh')]).toEqual([true, false, false]);
        document.querySelector('.recap-popup-backdrop')._next();
        expect([busy('hook'), busy('rank'), busy('seasonhigh')]).toEqual([false, true, false]);
        window.ccRecap.closePopup();
    });
});
