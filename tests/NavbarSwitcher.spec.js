// The league switcher, as the navbar actually renders it (#319 part 2).
//
// It was gated on `_role === 'Admin'` and built from `leagues`, the list of
// every league there is. Both halves were wrong for a member:
//
//   - a member holding a football and a basketball franchise had no switcher
//     at all, and so no way to reach their second team
//   - built from `leagues`, their switcher would have offered leagues they do
//     not play in — and POST /league/select refuses those with a 403, so the
//     dropdown would snap back and do nothing
//
// The partial is rendered for real, because the gate and the option list are
// template logic and nothing else exercises them.

const fs = require('fs');
const path = require('path');
const ejs = require('ejs');

const SRC = path.join(__dirname, '..', 'views', 'partials', 'navbar.ejs');

const BALL = { code: 'graham-league', name: 'The Polar Depressed' };
const OTHER = { code: 'claunts-league', name: 'Goofballers' };
const HOOPS = { code: 'hoops-league', name: 'Hardwood Heroes' };

// Only the locals the switcher reads; everything else the partial touches is
// optional and guarded by `typeof`.
function render(locals = {}) {
    return ejs.render(fs.readFileSync(SRC, 'utf8'), Object.assign({
        user: { role: '' },
        leagues: [OTHER, BALL, HOOPS],
        viewerLeagues: [],
        viewerCanSwitch: false,
        viewerLeagueCode: ''
    }, locals), { filename: SRC });
}

const options = (html) => {
    const sel = /<select[^>]*league-select[\s\S]*?<\/select>/.exec(html);
    if (!sel) return null;
    return [...sel[0].matchAll(/<option value="([^"]+)"([^>]*)>([^<]*)<\/option>/g)]
        .map(m => ({ code: m[1], selected: m[2].includes('selected'), label: m[3] }));
};

describe('who gets a switcher', () => {
    test('a member with one league does not', async () => {
        // A dropdown with a single option is a control that cannot do
        // anything, and it was never there before.
        expect(options(render({ viewerLeagues: [BALL], viewerCanSwitch: false }))).toBeNull();
    });

    test('a member with TWO leagues does — this is the feature', async () => {
        const opts = options(render({
            viewerLeagues: [BALL, HOOPS], viewerCanSwitch: true, viewerLeagueCode: HOOPS.code
        }));
        expect(opts.map(o => o.code)).toEqual([BALL.code, HOOPS.code]);
    });

    test('an Admin does, with every league', async () => {
        const opts = options(render({
            user: { role: 'Admin' },
            viewerLeagues: [OTHER, BALL, HOOPS], viewerCanSwitch: true, viewerLeagueCode: BALL.code
        }));
        expect(opts.map(o => o.code)).toEqual([OTHER.code, BALL.code, HOOPS.code]);
    });

    test('a signed-out page renders no switcher and does not throw', async () => {
        expect(options(render({ viewerLeagues: undefined, viewerCanSwitch: undefined }))).toBeNull();
    });

    test('the flag alone is not enough — one option still renders nothing', async () => {
        // Defence against the two sources disagreeing: a flag that says yes
        // with a list that says no must not produce a dead control.
        expect(options(render({ viewerLeagues: [BALL], viewerCanSwitch: true }))).toBeNull();
    });
});

describe('what it offers', () => {
    test('ONLY the viewer’s own leagues, never the full list', async () => {
        // The bug this replaces: built from `leagues`, a member's switcher
        // offered leagues the server would then refuse with a 403.
        const opts = options(render({
            leagues: [OTHER, BALL, HOOPS],
            viewerLeagues: [BALL, HOOPS],
            viewerCanSwitch: true
        }));
        expect(opts.map(o => o.code)).not.toContain(OTHER.code);
    });

    test('labelled with the league’s own name, not its code or sport', async () => {
        const opts = options(render({ viewerLeagues: [BALL, HOOPS], viewerCanSwitch: true }));
        expect(opts.map(o => o.label)).toEqual(['The Polar Depressed', 'Hardwood Heroes']);
    });

    test('the league being VIEWED is the selected one', async () => {
        // Without this the switcher shows whichever league is first whatever
        // the page is actually showing, and only corrects once league.js runs.
        const opts = options(render({
            viewerLeagues: [BALL, HOOPS], viewerCanSwitch: true, viewerLeagueCode: HOOPS.code
        }));
        expect(opts.find(o => o.selected).code).toBe(HOOPS.code);
        expect(opts.filter(o => o.selected)).toHaveLength(1);
    });

    test('and nothing is marked selected when the league is unknown', async () => {
        const opts = options(render({
            viewerLeagues: [BALL, HOOPS], viewerCanSwitch: true, viewerLeagueCode: 'gone'
        }));
        expect(opts.some(o => o.selected)).toBe(false);
    });
});
