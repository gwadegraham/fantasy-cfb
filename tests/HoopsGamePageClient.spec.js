/**
 * @jest-environment jsdom
 *
 * public/hoopsGame.js — the basketball game page (#503) — rendering one
 * payload: the scoreboard (away left, home right), each side's fantasy read,
 * the four factors with the better side's bar the LONGER one even when lower
 * is better, and the box score with colliding short names kept apart.
 */
const fs = require('fs');
const path = require('path');
const SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'hoopsGame.js'), 'utf8');

const side = (o) => Object.assign({ byPeriod: [32, 43], points: 75, efgPct: 51, tovPct: 15.2, orbPct: 29.7, ftRate: 57.7,
    fgMade: 22, fgAtt: 52, threeMade: 9, threeAtt: 23, ftMade: 22, ftAtt: 30, rebounds: 37, assists: 13, steals: 8, blocks: 2,
    turnovers: 10, paintPoints: 24, fastBreakPoints: 11, pointsOffTurnovers: 8, largestLead: 17, players: [] }, o);
const player = (name, o) => Object.assign({ name, position: 'F', starter: true, minutes: 30, points: 10, rebounds: 5, assists: 2,
    threeMade: 1, threeAtt: 3, fgMade: 4, fgAtt: 9 }, o);

function payload(o) {
    return Object.assign({
        game: { id: 500, final: true, postseason: false, tournament: null, neutralSite: true, startDate: '2025-11-05T01:45:00.000Z',
            startTimeTbd: false, notes: 'Dick Vitale Invitational', venue: 'Spectrum Center', city: 'Charlotte', state: 'NC', status: 'final' },
        home: { id: 1, school: 'Duke', abbreviation: 'DUKE', color: '#013088', logo: 'https://x/d.png', hasPage: true, rank: 4,
            record: { w: 1, l: 0 }, points: 75, quadrant: 1, owner: { franchiseName: 'Hoop Dreams' }, banked: 5 },
        away: { id: 2, school: 'Texas', abbreviation: 'TEX', color: '#bf5700', logo: null, hasPage: false, rank: 37,
            record: { w: 0, l: 1 }, points: 60, quadrant: 2, owner: null, banked: null },
        quadrantValues: { 1: 5, 2: 3, 3: 1, 4: 0 },
        box: { pace: 66,
            home: side({ players: [player('Cameron Boozer', { points: 15 }), player('Cayden Boozer', { starter: false, minutes: 14, points: 2 }), player('Isaiah Evans', { points: 23, rebounds: 1 })] }),
            away: side({ points: 60, byPeriod: [33, 27], efgPct: 36.4, tovPct: 24.2, orbPct: 43.9, ftRate: 39, players: [player('Dailyn Swain', { points: 16 })] }) },
    }, o || {});
}

async function render(body, status = 200) {
    window.history.replaceState(null, '', window.location.pathname);
    document.body.innerHTML = '<title data-league-title="Game">Game</title><main id="hoops-game" data-game-id="500"></main>';
    window.ccLeague = { paint: jest.fn() };
    global.fetch = jest.fn(() => Promise.resolve({ ok: status === 200, status, json: () => Promise.resolve(body) }));
    (0, eval)(SRC);
    await new Promise(r => setTimeout(r, 0));
    await new Promise(r => setTimeout(r, 0));
}
const q = (s) => document.querySelector(s);
const txt = (s) => Array.from(document.querySelectorAll(s)).map(n => n.textContent).join(' | ');
const tab = (n) => q('[data-tab="' + n + '"]').click();
afterEach(() => { delete window.ccLeague; });

test('fetches its own game, and names the tab "TEX vs DUKE"', async () => {
    await render(payload());
    expect(global.fetch.mock.calls[0][0]).toBe('/hoops/games/500/page');
    expect(q('title').getAttribute('data-league-title')).toBe('TEX vs DUKE');
});

test('scoreboard: away on the left, home on the right, score in the same order', async () => {
    await render(payload());
    const sides = Array.from(document.querySelectorAll('.hg-side .hg-nm')).map(n => n.textContent);
    expect(sides).toEqual(['37TEXAS', '4DUKE']);
    expect(q('.hg-score').textContent).toBe('60–75');
    expect(q('.hg-score span').className).toBe('lose');            // the loser, on the left, is dimmed
    expect(txt('.hg-meta')).toContain('Dick Vitale Invitational');
    expect(txt('.hg-meta')).toContain('neutral site');
});

test('line score by half, in scoreboard order', async () => {
    await render(payload());
    const rows = Array.from(document.querySelectorAll('.hg-lines tr')).map(r => r.textContent);
    expect(rows).toEqual(['1st2ndT', 'TEX332760', 'DUKE324375']);
});

test('a team with a page is a link; one without (non-D-I) is not', async () => {
    await render(payload());
    const links = Array.from(document.querySelectorAll('.hg-side a')).map(a => a.getAttribute('href'));
    expect(links).toEqual(['/hoops/team/1']);
});

test('each side\'s own fantasy read', async () => {
    await render(payload());
    const cards = Array.from(document.querySelectorAll('.hg-fc')).map(n => n.textContent);
    expect(cards[0]).toBe('Q2loss for TexasNot on a roster');
    expect(cards[1]).toBe('Q1win for Duke+5 for Hoop Dreams');
});

test('no league selected: no roster lines at all', async () => {
    await render(payload({ quadrantValues: null }));
    expect(document.querySelectorAll('.hg-fc .p')).toHaveLength(0);
});

test('a game to play: "@", no box, and what a win would pay', async () => {
    const p = payload({ box: null });
    p.game = Object.assign({}, p.game, { final: false, neutralSite: false, status: 'scheduled' });
    p.home = Object.assign({}, p.home, { points: null, record: null, banked: null });
    p.away = Object.assign({}, p.away, { points: null, record: null });
    await render(p);
    expect(q('.hg-score').textContent).toBe('@');
    expect(q('.ht-tabs')).toBeNull();
    expect(txt('.ht-empty')).toContain('arrives after the final');
    expect(Array.from(document.querySelectorAll('.hg-fc'))[1].textContent).toBe('Q1game for Duke+5 if won, for Hoop Dreams');
});

test('postseason: the tournament, not a quadrant', async () => {
    const p = payload();
    p.game = Object.assign({}, p.game, { postseason: true, tournament: 'NCAA' });
    p.home = Object.assign({}, p.home, { quadrant: null });
    p.away = Object.assign({}, p.away, { quadrant: null });
    await render(p);
    expect(txt('.hg-q')).toBe('NCAA | NCAA');
});

test('final without a box: it lands overnight', async () => {
    await render(payload({ box: null }));
    expect(txt('.ht-empty')).toContain('lands overnight');
});

test('four factors: the better side is marked, and its bar is the LONGER one even when lower is better', async () => {
    await render(payload());
    const rows = Array.from(document.querySelectorAll('.hg-vs')).slice(0, 4);
    expect(rows.map(r => r.querySelector('.mid').firstChild.textContent)).toEqual(['Shooting', 'Ball security', 'Second chances', 'Getting to the line']);
    const sec = rows[1];                                             // Duke 15.2 turnovers vs Texas 24.2: Duke better
    expect(sec.querySelector('.r').className).toContain('edge');
    const bars = sec.querySelectorAll('.bars i');
    expect(bars[1].className).toBe('on');
    expect(Number(bars[1].style.flex.split(' ')[0])).toBeGreaterThan(Number(bars[0].style.flex.split(' ')[0]));
});

test('team stats side by side, and possessions', async () => {
    await render(payload());
    expect(txt('.hg-vs')).toContain('9-23Threes9-23');
    expect(txt('h2')).toContain('66 possessions');
});

test('leaders: one per side per stat', async () => {
    await render(payload());
    const pts = Array.from(document.querySelectorAll('.hg-ld'))[0].textContent;
    expect(pts).toContain('D. Swain TEX16');
    expect(pts).toContain('I. Evans DUKE23');
});

// Bootstrap ships .row (negative side margins) and .lead (oversized text);
// a bare class with either name pushed the leader lines outside their cards.
test('nothing on the page uses a bare Bootstrap layout class', async () => {
    await render(payload());
    expect(document.querySelectorAll('#hoops-game .row, #hoops-game .lead, #hoops-game .card, #hoops-game .table')).toHaveLength(0);
});

test('box score: starters then bench, a side toggle, game high marked, colliding short names kept full', async () => {
    window.history.replaceState(null, '', '#box');
    document.body.innerHTML = '<main id="hoops-game" data-game-id="500"></main>';
    global.fetch = jest.fn(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(payload()) }));
    window.ccLeague = { paint: jest.fn() };
    (0, eval)(SRC);
    await new Promise(r => setTimeout(r, 0)); await new Promise(r => setTimeout(r, 0));
    expect(q('.ht-tab.on').textContent).toBe('Box score');
    // Duke is the rostered side, so the box opens on Duke.
    expect(q('.hg-seg button.on').getAttribute('data-side')).toBe('home');
    const rows = Array.from(document.querySelectorAll('.hg-box tr')).map(r => r.textContent);
    expect(rows[1]).toBe('Starters');
    expect(rows.some(r => r.startsWith('Cameron BoozerF'))).toBe(true);   // two "C. Boozer"s: both full
    expect(rows.some(r => r.startsWith('Cayden BoozerF'))).toBe(true);
    expect(rows.some(r => r.startsWith('I. EvansF'))).toBe(true);
    expect(rows).toContain('Bench');
    expect(q('.hg-box .hi').textContent).toBe('23');
    q('[data-side="away"]').click();
    expect(txt('.hg-box')).toContain('D. Swain');
    tab('summary');
    expect(window.location.hash).toBe('#summary');
});

test('nobody rostered: the box opens on the left-hand (away) side', async () => {
    const p = payload();
    p.home = Object.assign({}, p.home, { owner: null });
    await render(p);
    tab('box');
    expect(q('.hg-seg button.on').getAttribute('data-side')).toBe('away');
});

test('an API error is shown, not a blank page', async () => {
    await render({ message: 'No such basketball game' }, 404);
    expect(txt('.ht-error')).toBe('No such basketball game');
});
