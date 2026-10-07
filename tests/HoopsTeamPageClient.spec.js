/**
 * @jest-environment jsdom
 *
 * public/hoopsTeam.js — the basketball team page (#494) — rendering one
 * payload. Asserts what a manager reads: the team sheet's quadrant records,
 * what is banked and still on the table, the standings, and that the stats
 * sections say plainly when there are none yet.
 */

const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'hoopsTeam.js'), 'utf8');

const g = (id, o) => Object.assign({
    id, startDate: '2026-11-10T00:00:00.000Z', startTimeTbd: false, week: 1, venue: 'home',
    conferenceGame: false, notes: null, final: true, us: 80, them: 70, points: 0,
    opponent: { id: id + 100, school: 'Opp ' + id, logo: null, rank: 50 }, quadrant: 2
}, o);

function payload(o) {
    return Object.assign({
        season: 2027,
        team: { id: 72, school: 'Duke', mascot: 'Blue Devils', conference: 'ACC', color: '#013088', logo: 'https://x/d.png', venue: 'Cameron Indoor Stadium' },
        preseason: { rank: 1, adjOE: 120.8, adjDE: 91, barthag: 0.9629, projectedRecord: '26-6', oeRank: 3, deRank: 1, ratedTeams: 365 },
        owner: { franchiseName: 'Hoop Dreams', firstName: 'Garrett' },
        quadrantValues: { 1: 5, 2: 3, 3: 1, 4: 0 },
        games: [
            g(1, { quadrant: 1, venue: 'away', points: 5, opponent: { id: 2, school: 'Florida', rank: 4 } }),
            g(2, { quadrant: 1, venue: 'neutral', us: 78, them: 95, opponent: { id: 3, school: 'UConn', rank: 12 } }),
            g(3, { quadrant: 4, opponent: { id: 4, school: 'Army', rank: 358 } }),
            g(4, { final: false, us: null, them: null, points: null, quadrant: 1, conferenceGame: true, opponent: { id: 5, school: 'Virginia', rank: 3 } }),
            g(5, { final: false, us: null, them: null, points: null, quadrant: 3, opponent: { id: 6, school: 'Harvard', rank: 120 } })
        ],
        standings: [
            { teamId: 5, school: 'Virginia', logo: null, confW: 1, confL: 0, w: 9, l: 1 },
            { teamId: 72, school: 'Duke', logo: null, confW: 0, confL: 0, w: 2, l: 1 }
        ],
        stats: null
    }, o || {});
}

async function render(body, status = 200) {
    document.body.innerHTML = '<title data-league-title="Team">Team</title><main id="hoops-team" data-team-id="72"></main>';
    window.ccLeague = { paint: jest.fn() };
    global.fetch = jest.fn(() => Promise.resolve({ ok: status === 200, status, json: () => Promise.resolve(body) }));
    (0, eval)(SRC);
    await new Promise(r => setTimeout(r, 0));
    await new Promise(r => setTimeout(r, 0));
    return document.getElementById('hoops-team');
}
const txt = (sel) => Array.from(document.querySelectorAll(sel)).map(n => n.textContent).join(' | ');

afterEach(() => { delete window.ccLeague; delete window.ccHoopsTeam; });

test('fetches its own team', async () => {
    await render(payload());
    expect(global.fetch.mock.calls[0][0]).toBe('/hoops/teams/72/page');
});

test('the hero: record, conference record, record vs Q1, and Torvik', async () => {
    await render(payload());
    expect(txt('.ht-rec')).toContain('2–1');          // overall
    expect(txt('.ht-rec')).toContain('0–0');          // ACC: no conference game played yet
    expect(txt('.ht-rec')).toContain('1–1');          // vs Q1
    expect(txt('.ht-chips')).toContain('T-Rank #1');
    expect(txt('.ht-chips')).toContain('26-6');
    expect(document.querySelector('.ht-hero').getAttribute('style')).toContain('--team:#013088');
});

const tab = (name) => document.querySelector('[data-tab="' + name + '"]').click();

test('the team sheet: four tiles — each quadrant\'s record, what a win pays, and what is left', async () => {
    await render(payload());
    const tile = (n) => document.querySelector('.ht-tile[data-q="' + n + '"]');
    expect(tile(1).querySelector('.ht-tile-wl').textContent).toBe('1–1');
    expect(tile(1).querySelector('.ht-tile-sub').textContent).toBe('+5 a win');
    expect(tile(1).querySelector('.ht-tile-left').textContent).toBe('1 left');
    expect(tile(4).querySelector('.ht-tile-sub').textContent).toBe('no pts');
    expect(tile(2).querySelector('.ht-tile-wl').textContent).toBe('—');
});

test('one list under the tiles: Q1 first, and a tap switches it', async () => {
    await render(payload());
    const listed = () => Array.from(document.querySelectorAll('.ht-qlist .opp .nm')).map(n => n.textContent);
    expect(listed()).toEqual(['@4 Florida', 'N12 UConn', 'vs3 Virginia']);
    expect(document.querySelector('.ht-tile[data-q="1"]').getAttribute('aria-selected')).toBe('true');
    document.querySelector('.ht-tile[data-q="4"]').click();
    expect(listed()).toEqual(['vs358 Army']);
    document.querySelector('.ht-tile[data-q="2"]').click();
    expect(document.querySelector('.ht-qlist').textContent).toContain('No Q2 games');
    expect(document.querySelector('.ht-qlist .opp')).toBeNull();
});

test('opens on the best quadrant that has games', async () => {
    await render(payload({ games: [g(9, { quadrant: 3 })] }));
    expect(document.querySelector('.ht-tile.on').getAttribute('data-q')).toBe('3');
});

test('no owner, no strip — and no point values, no "+N a win"', async () => {
    await render(payload({ owner: null, quadrantValues: null }));
    expect(document.querySelector('.ht-own')).toBeNull();
    expect(document.querySelector('.ht-tile[data-q="1"] .ht-tile-sub').textContent.trim()).toBe('');
});

test('tabs: the hash picks the tab, a tap changes it and the hash', async () => {
    window.location.hash = 'stats';
    await render(payload());
    expect(document.querySelector('.ht-tab.on').textContent).toBe('Stats');
    tab('schedule');
    expect(window.location.hash).toBe('#schedule');
    expect(document.querySelector('.ht-tab.on').textContent).toBe('Schedule');
    window.location.hash = '';
});

test('the conference tab is named for the conference, and hidden without standings', async () => {
    await render(payload());
    expect(document.querySelector('[data-tab="conference"]').textContent).toBe('ACC');
    await render(payload({ standings: [] }));
    expect(document.querySelector('[data-tab="conference"]')).toBeNull();
});

test('stats not imported yet: says so instead of an empty table', async () => {
    await render(payload());
    tab('stats');
    expect(txt('.ht-empty')).toContain('arrive once the season tips off');
});

test('stats imported: exactly the four factors, named and explained, with the edge marked', async () => {
    const stats = {
        games: 10, pace: 68.2,
        team: { efgPct: 55.1, tovRatio: 0.15, orbPct: 31.2, ftRate: 34, threeRate: 40, rating: 118.4 },
        opponent: { efgPct: 46, tovRatio: 0.18, orbPct: 33, ftRate: 22, threeRate: 38, rating: 96 },
        players: [
            { athleteId: 1, name: 'Bench Guy', position: 'F', games: 10, minutes: 100, points: 30, rebounds: 20, assists: 5, threePct: 30, trueShootingPct: 50 },
            { athleteId: 2, name: 'Star <b>', position: 'G', games: 10, minutes: 340, points: 200, rebounds: 40, assists: 50, threePct: 40, trueShootingPct: 59.6 },
            { athleteId: 4, name: 'Big Minutes Few Games', games: 2, minutes: 70, points: 10, rebounds: 4, assists: 1 },
            { athleteId: 3, name: 'Redshirt', games: 0, minutes: 0, points: 0 }
        ]
    };
    await render(payload({ stats }));
    tab('stats');
    const rows = Array.from(document.querySelectorAll('.ht-ff-row'));
    expect(rows.map(r => r.querySelector('b').textContent)).toEqual(['Shooting', 'Ball security', 'Second chances', 'Getting to the line']);
    expect(rows[1].textContent).toContain('15.0');                                  // turnovers per 100, not 0.15
    expect(rows[1].querySelectorAll('span')[0].className).toBe('edge');            // fewer turnovers is better
    expect(rows[2].querySelectorAll('span')[1].className).toBe('edge');            // they out-rebounded us
    expect(txt('.ht-style')).toContain('possessions a game');
    const names = Array.from(document.querySelectorAll('.ht-rot tbody tr .full')).map(n => n.textContent);
    expect(names).toEqual(['Big Minutes Few Games', 'Star <b>', 'Bench Guy']);    // by minutes A GAME; DNP dropped; escaped
    expect(document.querySelector('.ht-rot tbody tr .short').textContent).toBe('B. Minutes Few Games');
    expect(document.querySelector('.ht-rot tbody tr:nth-child(2) .ht-lead').textContent).toBe('20.0');
});

test('conference standings, with this team highlighted', async () => {
    await render(payload());
    tab('conference');
    expect(document.querySelector('.ht-st tr.me').textContent).toContain('Duke');
    expect(txt('.ht-st tbody tr')).toContain('Virginia');
});

test('schedule: the last five and the next three, then the whole season on request', async () => {
    const games = [];
    for (let i = 1; i <= 8; i++) games.push(g(i, { opponent: { id: i, school: 'Played ' + i, rank: 50 } }));
    for (let i = 9; i <= 14; i++) games.push(g(i, { final: false, us: null, them: null, points: null, quadrant: 1, opponent: { id: i, school: 'Next ' + i, rank: 5 } }));
    await render(payload({ games }));
    tab('schedule');
    const shown = () => Array.from(document.querySelectorAll('.ht-log .ht-lg:not(.div)')).length;
    expect(shown()).toBe(8);
    expect(txt('.ht-log')).toContain('Up next');
    expect(txt('.ht-log')).not.toContain('Played 3');
    expect(document.querySelector('.ht-lg.up .res').textContent).toBe('+5 if won');
    document.querySelector('[data-more="games"]').click();
    expect(shown()).toBe(14);
    expect(document.querySelector('[data-more="games"]').textContent).toBe('Show less');
});

test('a result shows its banked points', async () => {
    await render(payload());
    tab('schedule');
    const florida = Array.from(document.querySelectorAll('.ht-lg')).find(n => n.textContent.includes('Florida'));
    expect(florida.querySelector('.res').textContent).toBe('W 80–70');
    expect(florida.querySelector('.p').textContent).toBe('+5');
});

test('names the tab after the team and repaints the league chrome', async () => {
    await render(payload());
    expect(document.querySelector('title').getAttribute('data-league-title')).toBe('Duke');
    expect(window.ccLeague.paint).toHaveBeenCalled();
});

test('an API error is shown, not a blank page', async () => {
    await render({ message: 'No such basketball team this season' }, 404);
    expect(txt('.ht-error')).toBe('No such basketball team this season');
});
