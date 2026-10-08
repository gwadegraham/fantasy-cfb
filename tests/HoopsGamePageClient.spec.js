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
// The shared kit (#506) the page script builds on, loaded once as the page would.
const KIT = fs.readFileSync(path.join(__dirname, '..', 'public', 'sport-page.js'), 'utf8');
beforeAll(() => { (0, eval)(KIT); });
// Numbers that count up (#506) show their final value at once under reduced
// motion; the animation itself is pinned in SportPageKit.spec.js.
beforeEach(() => { window.matchMedia = (q) => ({ matches: /reduce/.test(q) }); });
afterAll(() => { delete window.matchMedia; });

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
afterEach(() => { delete window.ccLeague; delete window.ccKickoff; });

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

test('the meta line ends with where it is on: venue · city · neutral site · TV', async () => {
    await render(payload({ game: Object.assign(payload().game, { tv: 'ESPN2' }) }));
    expect(q('.hg-meta').innerHTML).toContain('<br>Spectrum Center · Charlotte, NC · neutral site · ESPN2');
    await render(payload({ game: Object.assign(payload().game, { venue: null, city: null, state: null, neutralSite: false, tv: null }) }));
    expect(q('.hg-meta').innerHTML).not.toContain('<br>');
});

test('line score by half, in scoreboard order', async () => {
    await render(payload());
    const rows = Array.from(document.querySelectorAll('.sp-lines tr')).map(r => r.textContent);
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

test('postseason: the tournament, not a quadrant', async () => {
    const p = payload();
    p.game = Object.assign({}, p.game, { postseason: true, tournament: 'NCAA' });
    p.home = Object.assign({}, p.home, { quadrant: null });
    p.away = Object.assign({}, p.away, { quadrant: null });
    await render(p);
    expect(txt('.hg-q')).toBe('NCAA | NCAA');
});

test('final without a box: it lands overnight — unless the game is too old to get one', async () => {
    const recent = payload({ box: null });
    recent.game = Object.assign({}, recent.game, { startDate: new Date(Date.now() - 12 * 3600e3).toISOString() });
    await render(recent);
    expect(txt('.sp-empty')).toContain('lands overnight');
    await render(payload({ box: null }));                       // Nov 2025: long past the 3-day window
    expect(txt('.sp-empty')).toBe('There’s no box score for this game.');
});

test('final but not scored yet: "points post overnight", never a fake 0', async () => {
    const p = payload();
    p.home = Object.assign({}, p.home, { banked: null });
    await render(p);
    expect(Array.from(document.querySelectorAll('.hg-fc'))[1].textContent).toBe('Q1win for DukeHoop Dreams · points post overnight');
});

test('the box opens on the VIEWER\'s team when both sides are rostered', async () => {
    // Both rostered, viewer owns HOME: the old "home only if only home is
    // rostered" rule would have opened on the away side here.
    const p = payload();
    p.away = Object.assign({}, p.away, { owner: { franchiseName: 'Cinderella Story', mine: false } });
    p.home = Object.assign({}, p.home, { owner: { franchiseName: 'Hoop Dreams', mine: true } });
    await render(p);
    tab('box');
    expect(q('.sp-seg button.on').getAttribute('data-side')).toBe('home');
});

test('four factors: the better side is marked, and its bar is the LONGER one even when lower is better', async () => {
    await render(payload());
    const rows = Array.from(document.querySelectorAll('.sp-vs')).slice(0, 4);
    expect(rows.map(r => r.querySelector('.mid').firstChild.textContent)).toEqual(['Shooting', 'Ball security', 'Second chances', 'Getting to the line']);
    const sec = rows[1];                                             // Duke 15.2 turnovers vs Texas 24.2: Duke better
    expect(sec.querySelector('.r').className).toContain('edge');
    const flex = (i) => Number(i.style.flex.split(' ')[0]);
    const bars = sec.querySelectorAll('.bars i');
    expect(flex(bars[1])).toBeGreaterThan(flex(bars[0]));
    expect(flex(bars[0]) + flex(bars[1])).toBeCloseTo(100, 5);           // shares of 100, never half empty
    // Each side in its own team colour, eased to read on the dark page:
    // Texas #bf5700 on the left, Duke #013088 on the right.
    expect(bars[0].style.background).toBe('rgb(203, 117, 46)');
    expect(bars[1].style.background).toBe('rgb(115, 141, 189)');
});

test('bars compare fractions as shares too: field goals 22-52 vs 19-59 fill the whole bar', async () => {
    const p = payload();
    p.box.away.fgMade = 19; p.box.away.fgAtt = 59;
    await render(p);
    const fg = Array.from(document.querySelectorAll('.sp-vs')).find(r => r.querySelector('.mid').firstChild.textContent === 'Field goals');
    const [a, h] = Array.from(fg.querySelectorAll('.bars i')).map(i => Number(i.style.flex.split(' ')[0]));
    expect(a + h).toBeCloseTo(100, 5);
    expect(h).toBeGreaterThan(a);                                        // Duke shot 42%, Texas 32%
    expect(fg.querySelector('.l').textContent).toBe('19-59');
});

test('two teams in the same colour: home switches to its alternate', async () => {
    const p = payload();
    p.away.color = '#0021A5'; p.home.color = '#013088'; p.home.altColor = '#ffffff';
    await render(p);
    const bars = document.querySelectorAll('.sp-vs .bars i');
    expect(bars[1].style.background).toBe('rgb(255, 255, 255)');
});

test('team stats side by side, and possessions', async () => {
    await render(payload());
    expect(txt('.sp-vs')).toContain('9-23Threes9-23');
    expect(txt('h2')).toContain('66 possessions');
});

test('leaders: one per side per stat', async () => {
    await render(payload());
    const pts = Array.from(document.querySelectorAll('.sp-ld'))[0].textContent;
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
    expect(q('.sp-tab.on').textContent).toBe('Box score');
    // Duke is the rostered side, so the box opens on Duke.
    expect(q('.sp-seg button.on').getAttribute('data-side')).toBe('home');
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

test('box score and leaders: "#12 C. Boozer" when a number is on file, just the name when not', async () => {
    window.history.replaceState(null, '', '#box');
    const p = payload();
    p.box.home.players = [player('Cameron Boozer', { jersey: '12', points: 30 }), player('Isaiah Evans', { points: 23 })];
    p.box.away.players = [player('Dailyn Swain', { jersey: '00', points: 16 })];
    await render(p);
    tab('box');
    const names = Array.from(document.querySelectorAll('.hg-box tr td:first-child')).map(n => n.textContent);
    expect(names).toContain('#12 C. BoozerF');
    expect(names).toContain('I. EvansF');
    tab('summary');
    expect(txt('.sp-ld-row')).toContain('#12 C. Boozer DUKE');
    expect(txt('.sp-ld-row')).toContain('#00 D. Swain TEX');
});

test('nobody rostered: the box opens on the left-hand (away) side', async () => {
    const p = payload();
    p.home = Object.assign({}, p.home, { owner: null });
    await render(p);
    tab('box');
    expect(q('.sp-seg button.on').getAttribute('data-side')).toBe('away');
});

test('an API error is shown, not a blank page', async () => {
    await render({ message: 'No such basketball game' }, 404);
    expect(txt('.sp-error')).toBe('No such basketball game');
});

// ---- preview: a game still to play --------------------------------------

const prevSide = (o) => Object.assign({
    record: { w: 7, l: 2 }, confRecord: { w: 0, l: 0 }, q1Record: { w: 2, l: 2 }, roadRecord: { w: 1, l: 0 },
    streak: { won: true, n: 2 },
    last5: [{ won: false, us: 77, them: 81, venue: 'home', opponent: 'ILL' }, { won: true, us: 74, them: 62, venue: 'away', opponent: 'FLA' }],
    preseason: { rank: 1, adjOE: 120.8, adjDE: 91 },
    stats: { games: 10, pace: 66.5, ppg: 81.6, oppPpg: 63.6, efgPct: 56.7, tovPct: 16, orbPct: 30.8, ftRate: 38.2 },
    topScorers: [{ name: 'Cameron Boozer', position: 'F', ppg: 22.5, rpg: 10.2, apg: 4 }, { name: 'Cayden Boozer', position: 'G', ppg: 7.7, rpg: 2.3, apg: 2.9 }]
}, o);

function upcoming(o) {
    const p = payload({ box: null });
    p.game = Object.assign({}, p.game, { final: false, status: 'scheduled', startDate: new Date(Date.now() + 3 * 3600e3).toISOString() });
    p.home = Object.assign({}, p.home, { points: null, banked: null, quadrant: 1 });
    p.away = Object.assign({}, p.away, { points: null, quadrant: 1, owner: { franchiseName: 'Cinderella Story' } });
    p.preview = Object.assign({
        home: prevSide(),
        away: prevSide({ record: { w: 6, l: 1 }, preseason: { rank: 31, adjOE: 118.4, adjDE: 99.6 }, stats: null, topScorers: [] }),
        homeWinProb: 0.78, meetings: []
    }, o || {});
    return p;
}

// Real ccKickoff, so the countdown reads days the way the app does.
beforeEach(() => { window.ccKickoff = require('../public/kickoff-day.js'); });

test('a game to play: the preview replaces the fantasy cards, tabs and box', async () => {
    await render(upcoming());
    expect(q('.hg-score').textContent).toBe('vs');
    expect(q('.hg-fan')).toBeNull();
    expect(q('.sp-tabs')).toBeNull();
    expect(q('.sp-empty')).toBeNull();
    expect(q('.hg-preview')).not.toBeNull();
});

test('key players: the number in front of the name, or the name alone', async () => {
    const p = upcoming();
    p.preview.home.topScorers = [{ name: 'Cameron Boozer', jersey: '12', position: 'F', ppg: 22.5, rpg: 10.2, apg: 4 },
        { name: 'Caleb Foster', jersey: null, position: 'G', ppg: 9.1, rpg: 2, apg: 3 }];
    await render(p);
    const rows = Array.from(document.querySelectorAll('.hg-kp .sp-ld-row span')).map(n => n.textContent);
    expect(rows).toEqual(['#12 C. Boozer F', 'C. Foster G']);
});

test('the countdown: tonight, tomorrow, a date, TBD, and past tip-off', () => {
    window.ccKickoff = require('../public/kickoff-day.js');
    (0, eval)(SRC);
    const cd = window.ccHoopsGame.countdown;
    const at = (ms, tbd) => ({ startDate: new Date(ms).toISOString(), startTimeTbd: !!tbd });
    // Mid-day UTC, with tips three hours later: the same calendar day in UTC
    // and every US zone, so this passes wherever the suite runs. The clock
    // time is the viewer's local one, so it is matched by shape.
    const now = Date.UTC(2026, 10, 10, 15);
    const clock = '\\d{1,2}:\\d{2} [AP]M';
    expect(cd(at(now + 3 * 3600e3), now)).toMatch(new RegExp('^Tonight · ' + clock + '$'));
    expect(cd(at(now + 27 * 3600e3), now)).toMatch(new RegExp('^Tomorrow · ' + clock + '$'));
    expect(cd(at(now + 4 * 24 * 3600e3), now)).toMatch(new RegExp('^Sat, Nov 14 · ' + clock + '$'));
    expect(cd(at(Date.UTC(2026, 10, 14, 5), true), now)).toBe('Sat, Nov 14 · time TBD');
    expect(cd(at(now - 3600e3), now)).toBe('Awaiting the result');
});

test('win probability: away left, home right, in team colours', async () => {
    await render(upcoming());
    expect(q('.hg-wp-head').textContent).toBe('22% TexasDuke 78%');
    expect(q('.hg-floor').getAttribute('aria-label')).toBe('Texas 22%, Duke 78%');
    // The ball sits at the home side's chance, measured from the away end,
    // as football's field does; each lane is painted in its own team colour.
    expect(q('.hg-floor').style.getPropertyValue('--wp')).toBe('0.78');
    const lanes = Array.from(document.querySelectorAll('.hg-court rect[fill]')).map(r => r.getAttribute('fill'));
    expect(lanes).toEqual(['#cb752e', '#738dbd']);
    expect(txt('.hg-preview h2')).toContain('Matchup predictor');
    await render(upcoming({ homeWinProb: null }));
    expect(q('.hg-wp')).toBeNull();
});

test('both sides rostered: a manager matchup, with expected points', async () => {
    await render(upcoming());
    expect(txt('.hg-preview h2')).toContain('Manager matchup');
    const rows = Array.from(document.querySelectorAll('.hg-st-row')).map(r => r.textContent);
    expect(rows[0]).toBe('Q1Cinderella Story · Texas+5expected +1.1');
    expect(rows[1]).toBe('Q1Hoop Dreams · Duke+5expected +3.9');
});

test('one side rostered: fantasy stakes; a Q4 win says it pays nothing', async () => {
    const p = upcoming();
    p.away = Object.assign({}, p.away, { owner: null });
    p.home = Object.assign({}, p.home, { quadrant: 4 });
    await render(p);
    expect(txt('.hg-preview h2')).toContain('Fantasy stakes');
    const rows = Array.from(document.querySelectorAll('.hg-st-row')).map(r => r.textContent);
    expect(rows[0]).toBe('Q1Texas · not on a roster');
    expect(rows[1]).toBe('Q4Hoop Dreams · Dukeno pointsa Q4 win');
});

test('nobody rostered, or no league: no stakes section at all', async () => {
    const p = upcoming();
    p.away = Object.assign({}, p.away, { owner: null });
    p.home = Object.assign({}, p.home, { owner: null });
    await render(p);
    expect(q('.hg-stakes')).toBeNull();
    await render(upcoming());
    window.history.replaceState(null, '', window.location.pathname);
    const noLeague = upcoming(); noLeague.quadrantValues = null;
    await render(noLeague);
    expect(q('.hg-stakes')).toBeNull();
});

test('tale of the tape: the better side marked; stats rows only when both sides have stats', async () => {
    await render(upcoming());
    const rows = () => Array.from(document.querySelectorAll('.hg-preview .sp-vs')).map(r => r.querySelector('.mid').textContent);
    expect(rows()).toEqual(['T-Rank', 'Record', 'Conference', 'vs Q1', 'On the road', 'Offense', 'Defense']);
    const rank = document.querySelectorAll('.hg-preview .sp-vs')[0];
    expect(rank.querySelector('.r').className).toContain('edge');       // #1 beats #31: lower is better
    expect(txt('.hg-preview h2')).toContain('season stats arrive after tip-off');
    const p = upcoming();
    p.preview.away = prevSide({ preseason: { rank: 31 } });
    await render(p);
    expect(rows()).toContain('Turnovers / 100');
});

test('recent form: last five as W/L chips, with the streak', async () => {
    await render(upcoming());
    const duke = Array.from(document.querySelectorAll('.hg-form-row'))[1];
    expect(duke.querySelector('.nm').textContent).toBe('DUKE');
    expect(Array.from(duke.querySelectorAll('.sp-wl')).map(c => c.textContent)).toEqual(['L', 'W']);
    expect(duke.querySelector('.sp-wl').getAttribute('title')).toBe('L 77–81 vs ILL');
    expect(duke.querySelector('.sk').textContent).toBe('W2');
});

test('key players: top scorers, colliding short names kept full', async () => {
    await render(upcoming());
    const kp = txt('.hg-kp');
    expect(kp).toContain('Cameron Boozer');
    expect(kp).toContain('Cayden Boozer');
    expect(kp).toContain('22.5');
    expect(document.querySelectorAll('.hg-kp')).toHaveLength(1);            // Texas has none yet
});

test('an earlier meeting is listed and links to its game', async () => {
    await render(upcoming({ meetings: [{ id: 400, startDate: '2026-11-04T00:00:00.000Z', homeScore: 80, awayScore: 70, venue: 'away', notes: null }] }));
    const m = q('a.hg-meet');
    expect(m.getAttribute('href')).toBe('/hoops/game/400');
    expect(m.textContent).toContain('DUKE won 80–70');
});

test('a live game: LIVE · half · clock, and the running score with the trailing side dimmed', async () => {
    const p = upcoming();
    p.game = Object.assign({}, p.game, { live: true, status: 'in_progress', period: 2, clock: '8:43' });
    p.home = Object.assign({}, p.home, { points: 41 });
    p.away = Object.assign({}, p.away, { points: 38 });
    await render(p);
    expect(q('.hg-meta b').textContent).toBe('Live · 2nd · 8:43');
    expect(q('.hg-meta b').className).toBe('live');
    expect(txt('.hg-preview h2')).toContain('Pregame win probability');      // not a live number
    expect(q('.hg-score').textContent).toBe('38–41');
    expect(q('.hg-score span').className).toBe('lose');
    p.game.period = 3;
    await render(p);
    expect(q('.hg-meta b').textContent).toBe('Live · OT · 8:43');
});

test('a tied live score dims neither side', async () => {
    const p = upcoming();
    p.game = Object.assign({}, p.game, { live: true, status: 'in_progress', period: 2, clock: '1:02' });
    p.home = Object.assign({}, p.home, { points: 60 });
    p.away = Object.assign({}, p.away, { points: 60 });
    await render(p);
    expect(Array.from(document.querySelectorAll('.hg-score span')).map(x => x.className)).toEqual(['', 'dash', '']);
});

test('a stale listing (#498) says so and links to the played game, with no preview', async () => {
    window.ccKickoff = { parts: () => ({ monthShort: 'Nov', day: 14, weekdayLong: 'Saturday' }), time: () => '7 PM' };
    await render(payload({
        game: Object.assign(payload().game, { final: false, status: 'scheduled' }),
        rescheduled: { id: 372814, startDate: '2026-11-14T00:00:00.000Z', startTimeTbd: false },
        preview: { homeWinProb: 0.6, home: null, away: null, meetings: [] }, box: null
    }));
    expect(q('.hg-moved').textContent).toContain('played on Nov 14');
    expect(q('.hg-moved a').getAttribute('href')).toBe('/hoops/game/372814');
    expect(q('.hg-wp')).toBeNull();
    expect(txt('.hg-meta')).toContain('Rescheduled');
});

test('the tale of the tape says "per game", not "a game"', async () => {
    const p = upcoming();
    p.preview.home.stats = p.preview.away.stats = { games: 5, ppg: 80, oppPpg: 70, pace: 68, efgPct: 50, tovPct: 15, orbPct: 30, ftRate: 35 };
    await render(p);
    expect(txt('.sp-vs .mid')).toContain('Points per game');
    expect(txt('.sp-vs .mid')).toContain('Allowed per game');
    expect(txt('.sp-vs .mid')).not.toMatch(/a game/);
});

test('"Keys to the game", not "Four factors"', async () => {
    await render(payload());
    expect(txt('h2')).toContain('Keys to the game');
    expect(txt('h2')).not.toMatch(/four factors/i);
});

test('a white line marks the ball on the court, at the same place', async () => {
    await render(upcoming());
    const floor = q('.hg-floor');
    expect(floor.querySelector('.hg-mark')).not.toBeNull();
    expect(floor.querySelector('.hg-mark').nextElementSibling.className).toBe('hg-ball');   // drawn under the ball
});

