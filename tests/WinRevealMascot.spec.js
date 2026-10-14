/**
 * @jest-environment jsdom
 *
 * The head-to-head reveal on My Team (public/win-reveal.js) brings Laces in:
 * he holds up the trophy beside a W, and on a loss he hands you the L himself,
 * so his L replaces the stamp, and a tie is two of him in a tug-of-war nobody
 * wins, which replaces the T. Dribbles answers with his own: spinning the L on
 * his foam finger, and a jump ball nobody reaches. The result must still reach
 * a screen reader when it is a drawing.
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
        spinL: !!scrim.querySelector('.ccm-sl-spin'),
        jumpBall: !!scrim.querySelector('.ccm-jb-ball'),
        srLetter: scrim.querySelector('.sr-only') && scrim.querySelector('.sr-only').textContent,
        mascotHidden: !scrim.querySelector('.cwr-mascot') || scrim.querySelector('.cwr-mascot').getAttribute('aria-hidden') === 'true',
        text: scrim.textContent
    };
}

describe('Laces in the head-to-head reveal', () => {
    test('a win: Laces holds up the trophy beside the W', () => {
        const r = reveal('win', 'football');
        expect(r).toMatchObject({ mascot: 'Laces', stamp: 'W', trophy: true, handsL: false, srLetter: null, mascotHidden: true });
    });

    test('a loss: Laces hands you the L, which replaces the stamp', () => {
        const r = reveal('loss', 'football');
        expect(r).toMatchObject({ mascot: 'Laces', stamp: null, handsL: true });
        // The drawing is hidden from screen readers; the letter is read instead.
        expect(r).toMatchObject({ srLetter: 'L', mascotHidden: true });
    });

    test('a basketball loss: Dribbles spins the L on his foam finger, replacing the stamp', () => {
        const r = reveal('loss', 'basketball');
        expect(r).toMatchObject({ mascot: 'Dribbles', stamp: null, spinL: true, handsL: false, srLetter: 'L' });
    });

    test('a tie: two Laces in a tug-of-war, which replaces the stamp', () => {
        const r = reveal('tie', 'football');
        expect(r).toMatchObject({ mascot: 'Laces', stamp: null, tug: true });
        expect(r).toMatchObject({ srLetter: 'T', mascotHidden: true });
    });

    test('a basketball tie: two Dribbles on a jump ball nobody reaches, replacing the stamp', () => {
        const r = reveal('tie', 'basketball');
        expect(r).toMatchObject({ mascot: 'Dribbles', stamp: null, jumpBall: true, tug: false, srLetter: 'T' });
    });

    test('a basketball win: Dribbles holds the trophy beside the W', () => {
        const r = reveal('win', 'basketball');
        expect(r).toMatchObject({ mascot: 'Dribbles', stamp: 'W', trophy: true });
    });
});
