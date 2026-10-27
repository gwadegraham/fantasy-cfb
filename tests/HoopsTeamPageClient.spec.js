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
// The shared kit (#506) the page script builds on, loaded once as the page would.
const KIT = fs.readFileSync(path.join(__dirname, '..', 'public', 'sport-page.js'), 'utf8');
beforeAll(() => { (0, eval)(KIT); });
// Count-up numbers (#506) show their final value at once under reduced motion.
beforeEach(() => { window.matchMedia = (q) => ({ matches: /reduce/.test(q) }); });
afterAll(() => { delete window.matchMedia; });

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

async function render(body, status = 200, hash = '') {
    // The tab rides in the hash, and a test that taps a tab leaves it there.
    window.history.replaceState(null, '', hash ? '#' + hash : window.location.pathname);
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

// Style tags (#542) in the hero, with the season they describe when it is
// not this one.
test('the hero shows style tags, and says when they are last season\'s', async () => {
    await render(payload({ style: { fromSeason: 2026, label: '2025–26', lastSeason: true, tags: [
        { key: 'elite-both', label: 'Elite both ends', detail: '#4 adjusted offense, #1 adjusted defense' },
        { key: 'rim', label: 'Rim attackers', detail: null }
    ] } }));
    expect(txt('.ht-tag')).toBe('Elite both ends | Rim attackers');
    expect(document.querySelector('.ht-tag').getAttribute('title')).toBe('#4 adjusted offense, #1 adjusted defense');
    expect(txt('.ht-tags-src')).toBe('from 2025–26');
});

test('this season\'s tags carry no season note; no tags, no row', async () => {
    await render(payload({ style: { fromSeason: 2027, label: '2026–27', lastSeason: false, tags: [{ key: 'slow', label: 'Slow pace' }] } }));
    expect(txt('.ht-tag')).toBe('Slow pace');
    expect(document.querySelector('.ht-tags-src')).toBeNull();
    await render(payload({ style: null }));
    expect(document.querySelector('.ht-tags')).toBeNull();
});

test('tag text is escaped', async () => {
    await render(payload({ style: { lastSeason: false, tags: [{ key: 'x', label: '<img src=x onerror=alert(1)>' }] } }));
    expect(document.querySelector('.ht-tag img')).toBeNull();
});

// Roster turnover (#541) on the Resume tab: three chips, then who arrived
// and who left, linked when the other school has a page.
describe('roster turnover', () => {
    const tv = (o) => Object.assign({
        fromYear: 2026, season: 2027, in: 2, out: 3, inTop: 1, outTop: 0, classRank: 12, classRating: 51.3,
        arrivals: [
            { name: 'Al Pha', position: 'SG', stars: 4, rating: 0.95, teamId: 51, school: 'Cincinnati' },
            { name: 'Be Ta', position: 'C', stars: null, rating: null, teamId: null, school: 'Lander' }
        ],
        departures: [{ name: 'Ga Mma', position: 'PF', stars: 3, rating: 0.85, teamId: null, school: null }]
    }, o);

    test('the panel: counts, class rank, and each name with where they came from or went', async () => {
        await render(payload({ turnover: tv() }));
        expect(txt('.sp-h')).toContain('Roster turnoverSpring 2026 portal and class, into 2026\u201327');
        expect(txt('.ht-to-sum b')).toBe('+2 | \u22123 | #12');
        expect(txt('.ht-to-sum small')).toContain('transfers in \u00b7 1 four-star+');
        expect(txt('.ht-to-col h3')).toBe('Arrived | Left');
        expect(txt('.ht-to-nm')).toBe('Al Pha | Be Ta | Ga Mma');
        expect(txt('.ht-to-wh')).toBe('from Cincinnati | from Lander | to no school listed');
        expect(document.querySelector('.ht-to-wh a').getAttribute('href')).toBe('/hoops/team/51');
        // Division II: named, not linked to a page that does not exist.
        expect(document.querySelectorAll('.ht-to-wh a')).toHaveLength(1);
        expect(txt('.ht-to-st')).toBe('4\u2605 | 3\u2605');
        // 3 out but one name listed: the other two are "+2 more".
        expect(txt('.ht-to-more')).toBe('+2 more');
    });

    test('an unranked class is a dash; an empty side says None', async () => {
        await render(payload({ turnover: tv({ in: 0, arrivals: [], classRank: null }) }));
        expect(txt('.ht-to-sum b')).toBe('+0 | \u22123 | \u2014');
        expect(txt('.ht-to-col .ht-to-none')).toContain('None');
    });

    test('no turnover on file, no panel', async () => {
        await render(payload({ turnover: null }));
        expect(document.querySelector('.ht-to')).toBeNull();
        expect(txt('.sp-h')).not.toContain('Roster turnover');
    });

    test('names are escaped', async () => {
        await render(payload({ turnover: tv({ arrivals: [{ name: '<img src=x onerror=alert(1)>', school: '<b>x</b>' }] }) }));
        expect(document.querySelector('.ht-to img')).toBeNull();
        expect(document.querySelector('.ht-to-wh b')).toBeNull();
    });
});

const tab = (name) => document.querySelector('[data-tab="' + name + '"]').click();

describe('official NET (#533)', () => {
    const NET = { rank: 12, record: { w: 9, l: 2 }, throughGames: '2026-12-09T00:00:00.000Z',
        quads: [{ w: 3, l: 1 }, { w: 2, l: 1 }, null, { w: 4, l: 0 }] };

    test('a NET chip in the hero, and the official team sheet on the Resume, credited to NCAA', async () => {
        await render(payload({ net: NET }));
        expect(txt('.ht-chips')).toMatch(/^NET #12/);
        expect(txt('.ht-net')).toBe('#12NET3–1Quad 12–1Quad 2—Quad 34–0Quad 4');
        const head = Array.from(document.querySelectorAll('.sp-h')).find(h => /Official NET/.test(h.textContent));
        expect(head.textContent).toBe('Official NETNET: NCAA · through Dec 9');
    });

    test('before the NET publishes: no chip, no card', async () => {
        await render(payload({ net: null }));
        expect(txt('.ht-chips')).not.toMatch(/NET/);
        expect(document.querySelector('.ht-net')).toBeNull();
    });

    test('only on the Resume tab', async () => {
        await render(payload({ net: NET }), 200, 'schedule');
        expect(document.querySelector('.ht-net')).toBeNull();
    });

    test('no Through Games date: credited without one', async () => {
        await render(payload({ net: Object.assign({}, NET, { throughGames: null }) }));
        const head = Array.from(document.querySelectorAll('.sp-h')).find(h => /Official NET/.test(h.textContent));
        expect(head.textContent).toBe('Official NETNET: NCAA');
        expect(window.ccHoopsTeam.netDay('garbage')).toBe('');
    });
});

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

// No franchise name: first name AND last initial, since a league can have
// two managers called Michael.
test('an owner without a franchise name is named with a last initial', async () => {
    await render(payload({ owner: { franchiseName: null, firstName: 'Michael', name: 'Michael B.' } }));
    expect(document.querySelector('.ht-own').textContent).toContain('On Michael B.’s roster');
});

test('no owner, no strip — and no point values, no "+N a win"', async () => {
    await render(payload({ owner: null, quadrantValues: null }));
    expect(document.querySelector('.ht-own')).toBeNull();
    expect(document.querySelector('.ht-tile[data-q="1"] .ht-tile-sub').textContent.trim()).toBe('');
});

test('tabs: the hash picks the tab, a tap changes it and the hash', async () => {
    await render(payload(), 200, 'stats');
    expect(document.querySelector('.sp-tab.on').textContent).toBe('Stats');
    tab('schedule');
    expect(window.location.hash).toBe('#schedule');
    expect(document.querySelector('.sp-tab.on').textContent).toBe('Schedule');
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
    expect(txt('.sp-empty')).toContain('arrive once the season tips off');
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
    expect(txt('.ht-style')).toContain('possessions per game');
    const names = Array.from(document.querySelectorAll('.ht-rot tbody tr .full')).map(n => n.textContent);
    expect(names).toEqual(['Big Minutes Few Games', 'Star <b>', 'Bench Guy']);    // by minutes A GAME; DNP dropped; escaped
    expect(document.querySelector('.ht-rot tbody tr .short').textContent).toBe('B. Minutes Few Games');
    expect(document.querySelector('.ht-rot tbody tr:nth-child(2) .ht-lead').textContent).toBe('20.0');
});

test('rotation: "#12 C. Boozer" on a phone and "#12 Cameron Boozer" with room; no number, just the name', async () => {
    const stats = { games: 10, team: {}, opponent: {}, players: [
        { athleteId: 1, name: 'Cameron Boozer', jersey: '12', games: 10, minutes: 320, points: 225, rebounds: 100, assists: 40 },
        { athleteId: 2, name: 'Caleb Foster', games: 10, minutes: 300, points: 120, rebounds: 20, assists: 30 }
    ] };
    await render(payload({ stats }));
    tab('stats');
    const full = Array.from(document.querySelectorAll('.ht-rot tbody tr .full')).map(n => n.textContent);
    const short = Array.from(document.querySelectorAll('.ht-rot tbody tr .short')).map(n => n.textContent);
    expect(full).toEqual(['#12 Cameron Boozer', 'Caleb Foster']);
    expect(short).toEqual(['#12 C. Boozer', 'C. Foster']);
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
    const shown = () => Array.from(document.querySelectorAll('.sp-games .sp-gr:not(.div)')).length;
    expect(shown()).toBe(8);
    expect(txt('.sp-games')).toContain('Up next');
    expect(txt('.sp-games')).not.toContain('Played 3');
    expect(document.querySelector('.sp-gr.up .res').textContent).toBe('+5 if won');
    document.querySelector('[data-more="games"]').click();
    expect(shown()).toBe(14);
    expect(document.querySelector('[data-more="games"]').textContent).toBe('Show less');
});

test('a result shows its banked points', async () => {
    await render(payload());
    tab('schedule');
    const florida = Array.from(document.querySelectorAll('.sp-gr')).find(n => n.textContent.includes('Florida'));
    expect(florida.querySelector('.res').textContent).toBe('W 80–70');
    expect(florida.querySelector('.p').textContent).toBe('+5');
});

// The number beside the name is the AP poll; the quadrant grades on another
// rank, which the Q chip's tooltip carries — the reason a Q1 can sit beside
// an unranked name.
test('the Q chip names the rank its quadrant is graded on; no rank, no tooltip', async () => {
    const p = payload();
    p.games[0].opponent = { id: 2, school: 'Florida', rank: null, quadrantRank: 34 };
    await render(p);
    tab('schedule');
    const florida = Array.from(document.querySelectorAll('.sp-gr')).find(n => n.textContent.includes('Florida'));
    expect(florida.querySelector('.ht-rk')).toBeNull();
    expect(florida.querySelector('.ht-qt').getAttribute('title')).toBe('Q1: opponent ranked #34 (T-Rank, then NET), adjusted for venue');
    const army = Array.from(document.querySelectorAll('.sp-gr')).find(n => n.textContent.includes('Army'));
    expect(army.querySelector('.ht-qt').hasAttribute('title')).toBe(false);
});

// Phones never show a title tooltip, so a tap on the chip shows the same
// reason in a bubble; a second tap, a tap elsewhere or Escape closes it.
describe('the Q chip on a phone', () => {
    const bubble = () => document.querySelector('.sp-qtip');
    async function floridaChip() {
        const p = payload();
        p.games[0].opponent = { id: 2, school: 'Florida', rank: null, quadrantRank: 34 };
        await render(p);
        tab('schedule');
        return Array.from(document.querySelectorAll('.sp-gr')).find(n => n.textContent.includes('Florida')).querySelector('.ht-qt');
    }
    afterEach(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });

    test('a tap shows "Q1 · graded vs #34"; a second tap hides it', async () => {
        const chip = await floridaChip();
        expect(chip.getAttribute('role')).toBe('button');
        chip.click();
        expect(bubble().hidden).toBe(false);
        expect(bubble().textContent).toBe('Q1 · graded vs #34');
        expect(chip.getAttribute('aria-expanded')).toBe('true');
        chip.click();
        expect(bubble().hidden).toBe(true);
        expect(chip.getAttribute('aria-expanded')).toBe('false');
    });

    test('a tap anywhere else, or Escape, closes it; Enter opens it from the keyboard', async () => {
        const chip = await floridaChip();
        chip.click();
        document.querySelector('main').click();
        expect(bubble().hidden).toBe(true);
        chip.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        expect(bubble().hidden).toBe(false);
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        expect(bubble().hidden).toBe(true);
    });

    test('a tap on the chip inside the Next up card does not follow the card\'s link', async () => {
        const p = payload();
        p.games[3].opponent = { id: 5, school: 'Virginia', rank: 3, quadrantRank: 21 };
        await render(p);
        const chip = document.querySelector('.ht-next .ht-qt');
        const ev = new MouseEvent('click', { bubbles: true, cancelable: true });
        chip.dispatchEvent(ev);
        expect(ev.defaultPrevented).toBe(true);
        expect(bubble().textContent).toBe('Q1 · graded vs #21');
    });
});

test('a postseason game is off the team sheet and off the table, and says its tournament', async () => {
    const base = payload();
    base.games.push(g(20, { final: false, us: null, them: null, points: null, quadrant: null, postseason: true,
        tournament: 'NCAA', opponent: { id: 30, school: 'Gonzaga', rank: 9 } }));
    await render(base);
    expect(document.querySelector('.ht-tile[data-q="1"] .ht-tile-left').textContent).toBe('1 left');   // unchanged
    expect(txt('.ht-own')).toContain('up to +6');                                                         // unchanged
    expect(txt('.ht-qlist')).not.toContain('Gonzaga');
    tab('schedule');
    const row = Array.from(document.querySelectorAll('.sp-gr')).find(n => n.textContent.includes('Gonzaga'));
    expect(row.querySelector('.ht-qt').textContent).toBe('NCAA');
    expect(row.querySelector('.res').textContent).toBe('');
});

test('game rows carry the opponent\'s logo, and none when there is no logo', async () => {
    const base = payload();
    base.games[0].opponent.logo = 'https://x/fla.png';
    await render(base);
    const row = (school) => Array.from(document.querySelectorAll('.ht-qlist .sp-gr')).find(n => n.textContent.includes(school));
    expect(row('Florida').querySelector('.sp-ologo').getAttribute('src')).toBe('https://x/fla.png');
    expect(row('UConn').querySelector('.sp-ologo')).toBeNull();
    tab('schedule');
    expect(document.querySelectorAll('.sp-games .sp-ologo')).toHaveLength(1);
});

test('a row reads venue, rank, logo, then the school', async () => {
    const base = payload();
    base.games[0].opponent = { id: 2, school: 'Texas Tech', abbreviation: 'TTU', rank: 14, logo: 'https://x/ttu.png' };
    await render(base);
    const nm = document.querySelector('.ht-qlist .nm');
    expect(Array.from(nm.children).map(c => c.className || c.tagName)).toEqual(['ht-v', 'ht-rk', 'sp-ologo', 'ht-school-nm']);
    expect(nm.textContent).toBe('@14 Texas Tech');
});

// jsdom has no layout, so the measurement is stubbed: the name's own box
// is narrower than its text only when told to be.
test('a school name that would be cut off becomes its abbreviation, and comes back when it fits', async () => {
    const base = payload();
    base.games[0].opponent = { id: 2, school: 'Michigan State', abbreviation: 'MSU', rank: 10 };
    let squeezed = true;
    const realRange = document.createRange.bind(document);
    document.createRange = () => {
        const r = realRange();
        r.getBoundingClientRect = () => ({ width: squeezed ? 200 : 50 });
        return r;
    };
    const rect = jest.spyOn(window.HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => ({ width: 100, top: 0, height: 0 }));
    try {
        await render(base);
        const name = () => document.querySelector('.ht-qlist .ht-school-nm').textContent;
        expect(name()).toBe('MSU');
        expect(document.querySelector('.ht-qlist .ht-school-nm').getAttribute('title')).toBe('Michigan State');
        squeezed = false;
        window.dispatchEvent(new window.Event('resize'));
        expect(name()).toBe('Michigan State');
    } finally {
        document.createRange = realRange;
        rect.mockRestore();
    }
});

test('no abbreviation on file: the full name stays, ellipsis and all', async () => {
    const base = payload();
    base.games[0].opponent = { id: 2, school: 'Long Name University', rank: 10 };
    await render(base);
    expect(document.querySelector('.ht-qlist .ht-school-nm').hasAttribute('data-abbr')).toBe(false);
});

test('a non-D-I opponent is plain text, not a link to a missing page', async () => {
    const base = payload();
    base.games[0].opponent = { id: 9999, school: 'Division II College', rank: null, hasPage: false };
    await render(base);
    const row = Array.from(document.querySelectorAll('.ht-qlist .sp-gr')).find(n => n.textContent.includes('Division II'));
    expect(row.querySelector('.opp').tagName).toBe('SPAN');
    expect(row.querySelector('a.opp')).toBeNull();
    expect(document.querySelectorAll('.ht-qlist a.opp').length).toBeGreaterThan(0);   // the rest still link
});

test('names the tab after the team and repaints the league chrome', async () => {
    await render(payload());
    expect(document.querySelector('title').getAttribute('data-league-title')).toBe('Duke');
    expect(window.ccLeague.paint).toHaveBeenCalled();
});

test('an API error is shown, not a blank page', async () => {
    await render({ message: 'No such basketball team this season' }, 404);
    expect(txt('.sp-error')).toBe('No such basketball team this season');
});

describe('Next up (#506)', () => {
    test('the first game still to play, linked to its preview, with what a win pays', async () => {
        await render(payload());
        const card = document.querySelector('.ht-next');
        expect(card.getAttribute('href')).toBe('/hoops/game/4');
        expect(card.querySelector('.ht-next-opp').textContent).toBe('vs3 Virginia');
        expect(card.querySelector('.ht-qt').textContent).toBe('Q1');
        expect(card.querySelector('.ht-qt').hasAttribute('title')).toBe(false);   // no quadrantRank in the fixture
        expect(card.querySelector('.ht-next-pay').textContent).toBe('+5 if won');
        expect(card.querySelector('.ht-next-when').textContent).toMatch(/^Next up · /);
    });
    test('season over: no card', async () => {
        const p = payload();
        p.games = p.games.filter(x => x.final);
        await render(p);
        expect(document.querySelector('.ht-next')).toBeNull();
    });
    test('only on the Resume tab', async () => {
        await render(payload(), 200, 'schedule');
        expect(document.querySelector('.ht-next')).toBeNull();
    });
});

describe('standings peek (#506)', () => {
    const conf = (n, at) => Array.from({ length: n }, (_, i) => ({
        teamId: i === at ? 72 : 900 + i, school: i === at ? 'Duke' : 'Team ' + (i + 1), logo: null, confW: n - i, confL: i, w: 10, l: 2
    }));
    const rows = () => Array.from(document.querySelectorAll('.ht-panel .ht-st tbody tr')).map(r => r.querySelector('.n').textContent + (r.className === 'me' ? '*' : ''));

    test('two either side of this team, its place in the header', async () => {
        await render(payload({ standings: conf(15, 6) }));
        expect(rows()).toEqual(['5', '6', '7*', '8', '9']);
        expect(txt('.ht-panel h2')).toContain('ACC7th of 15');
    });
    test('top of the table: the first five, not a window off the edge', async () => {
        await render(payload({ standings: conf(15, 0) }));
        expect(rows()).toEqual(['1*', '2', '3', '4', '5']);
        expect(txt('.ht-panel h2')).toContain('1st of 15');
    });
    test('bottom of the table: the last five', async () => {
        await render(payload({ standings: conf(15, 14) }));
        expect(rows()).toEqual(['11', '12', '13', '14', '15*']);
    });
    test('the button opens the full table on its own tab', async () => {
        await render(payload({ standings: conf(15, 6) }));
        window.scrollTo = jest.fn();
        document.querySelector('.ht-peek-more').click();
        expect(window.location.hash).toBe('#conference');
        expect(rows()).toHaveLength(15);
        expect(window.scrollTo).toHaveBeenCalled();
    });
    // Nobody has played: the order is alphabetical, so no place is claimed.
    test('preseason: no invented place, and no rank numbers', async () => {
        const flat = conf(11, 8).map(r => Object.assign(r, { confW: 0, confL: 0, w: 0, l: 0 }));
        await render(payload({ standings: flat }));
        expect(txt('.ht-panel h2')).toContain('ACCPreseason');
        expect(txt('.ht-panel h2')).not.toContain('of 11');
        expect(rows()).toEqual(['', '', '*', '', '']);
    });
    test('no conference standings: no peek', async () => {
        await render(payload({ standings: [] }));
        expect(document.querySelector('.ht-peek-more')).toBeNull();
    });
    test('ordinals', async () => {
        for (const [at, want] of [[1, '2nd'], [2, '3rd'], [10, '11th'], [11, '12th'], [12, '13th'], [20, '21st']]) {
            await render(payload({ standings: conf(24, at) }));
            expect(txt('.ht-panel h2')).toContain(want + ' of 24');
        }
    });
});

test('the points banked count up: from 0 to the banked total', async () => {
    window.matchMedia = () => ({ matches: false });
    const frames = [];
    window.requestAnimationFrame = (fn) => frames.push(fn);
    Object.defineProperty(document, 'hidden', { value: false, configurable: true });
    try {
        await render(payload());
        const n = document.querySelector('.ht-own .pts .n');
        expect(n.textContent).toBe('0');
        frames.splice(0).forEach(f => f(0));
        frames.splice(0).forEach(f => f(1000));
        expect(n.textContent).toBe('+5');
    } finally { delete document.hidden; }
});

test('Next up skips a game long past its tip with no final (cancelled, or the result is late)', async () => {
    const p = payload();
    p.games[3].startDate = new Date(Date.now() - 6 * 3600e3).toISOString();      // Virginia: tipped 6h ago, no final
    p.games[4].startDate = new Date(Date.now() + 24 * 3600e3).toISOString();
    await render(p);
    expect(document.querySelector('.ht-next').getAttribute('href')).toBe('/hoops/game/5');
});

test('Next up keeps a game that tipped an hour ago: it is being played', async () => {
    const p = payload();
    p.games[3].startDate = new Date(Date.now() - 3600e3).toISOString();
    await render(p);
    expect(document.querySelector('.ht-next').getAttribute('href')).toBe('/hoops/game/4');
});

test('labels: "Resume" without accents, and "per game" throughout', async () => {
    await render(payload());
    expect(document.querySelector('.sp-tab').textContent).toBe('Resume');
});

test('the Stats tab calls them "Keys to the game"', async () => {
    const r = await render(payload({ stats: { games: 5, pace: 68, team: { efgPct: 50, tovRatio: .15, orbPct: 30, ftRate: 35 }, opponent: { efgPct: 48, tovRatio: .17, orbPct: 28, ftRate: 30 }, players: [] } }), 200, 'stats');
    expect(Array.from(r.querySelectorAll('h2')).map(h => h.firstChild.textContent)).toContain('Keys to the game');
});

test('Next up: a game that has tipped and is not final says "Under way"', async () => {
    const p = payload();
    p.games[3].startDate = new Date(Date.now() - 3600e3).toISOString();
    await render(p);
    expect(document.querySelector('.ht-next-when').textContent).toBe('Under way');
});

test('Next up keeps a game with no date yet rather than treating it as 1970', async () => {
    const p = payload();
    p.games[3].startDate = null;
    await render(p);
    expect(document.querySelector('.ht-next').getAttribute('href')).toBe('/hoops/game/4');
});

