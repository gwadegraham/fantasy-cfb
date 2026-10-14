/**
 * @jest-environment jsdom
 *
 * The head-to-head reveal on My Team (public/win-reveal.js) brings Laces in:
 * he holds up the trophy beside a W, and on a loss he hands you the L himself,
 * so his L replaces the stamp, and a tie is two of him in a tug-of-war nobody
 * wins, which replaces the T. Dribbles has neither, so a basketball loss or tie
 * keeps the stamp. The result must still reach a screen reader when it is a
 * drawing.
 */
const fs = require('fs');
const path = require('path');

const read = f => fs.readFileSync(path.join(__dirname, '..', 'public', f), 'utf8');

function reveal(result, sport) {
    document.body.innerHTML = '';
    document.head.innerHTML = '';
    delete window.ccMascot;
    delete window.ccWinReveal;
    window.ccLeague = { sport: () => sport };
    window.matchMedia = () => ({ matches: true });   // reduced motion: no confetti canvas in jsdom
    new Function(read('mascots.js'))();
    new Function(read('win-reveal.js'))();
    window.ccWinReveal({ result, oppLabel: 'Brock M.', myScore: 118, oppScore: 141, duration: 60000 });
    const scrim = document.querySelector('.cwr-scrim');
    const svg = scrim.querySelector('.cwr-mascot svg');
    return {
        mascot: svg && svg.getAttribute('data-mascot'),
        stamp: scrim.querySelector('.cwr-stamp') && scrim.querySelector('.cwr-stamp').textContent,
        handsL: !!scrim.querySelector('.ccm-hl-offer'),
        trophy: !!scrim.querySelector('.cwr-mascot .ccm-prop'),
        tug: !!scrim.querySelector('.ccm-tw2-rope'),
        text: scrim.textContent
    };
}

describe('Laces in the head-to-head reveal', () => {
    test('a win: Laces holds up the trophy beside the W', () => {
        const r = reveal('win', 'football');
        expect(r).toMatchObject({ mascot: 'Laces', stamp: 'W', trophy: true, handsL: false });
    });

    test('a loss: Laces hands you the L, which replaces the stamp', () => {
        const r = reveal('loss', 'football');
        expect(r).toMatchObject({ mascot: 'Laces', stamp: null, handsL: true });
        expect(r.text).toContain('L');   // the screen-reader copy of the result
    });

    test('a basketball loss keeps the stamp and gives Dribbles his ice pack', () => {
        const r = reveal('loss', 'basketball');
        expect(r).toMatchObject({ mascot: 'Dribbles', stamp: 'L', handsL: false });
    });

    test('a tie: two Laces in a tug-of-war, which replaces the stamp', () => {
        const r = reveal('tie', 'football');
        expect(r).toMatchObject({ mascot: 'Laces', stamp: null, tug: true });
        expect(r.text).toContain('T');   // the screen-reader copy of the result
    });

    test('a basketball tie keeps the stamp beside Dribbles', () => {
        const r = reveal('tie', 'basketball');
        expect(r).toMatchObject({ mascot: 'Dribbles', stamp: 'T', tug: false });
    });
});
