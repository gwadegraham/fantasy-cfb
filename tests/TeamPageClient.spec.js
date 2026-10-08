/**
 * @jest-environment jsdom
 *
 * public/team.js — the football team page on the shared kit (#506 Phase 2).
 * Renders one page model and asserts what a manager reads: the team-colour
 * hero with the records as the biggest numbers, whose roster the team is on
 * (or that it is undrafted), the sticky tabs that replaced the collapse
 * carets, the fantasy points on every game row, and that the sections the
 * old long scroll carried are all still somewhere.
 */

const fs = require('fs');
const path = require('path');

window.ccKickoff = require('../public/kickoff-day.js');
window.ccLogo = require('../public/logo.js').pickLogo;
const KIT = fs.readFileSync(path.join(__dirname, '..', 'public', 'sport-page.js'), 'utf8');
const SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'team.js'), 'utf8');
beforeAll(() => {
    (0, eval)(KIT);
    // team.js only assigns window.onload at the top level, so evaluating it
    // defines the page's functions without booting it.
    (0, eval)(SRC);
});
beforeEach(() => { window.matchMedia = (q) => ({ matches: /reduce/.test(q) }); });
afterEach(() => { delete window.ccLeague; });

const DUKE = 150, GT = 59, UNC = 153, WM = 2729, UVA = 258;

const game = (id, o) => Object.assign({
    id, season: 2026, week: 1, seasonType: 'regular', startDate: '2026-09-05T23:00:00.000Z', startTimeTbd: false,
    neutralSite: false, completed: true, homeId: DUKE, homeTeam: 'Duke', awayId: WM, awayTeam: 'William & Mary',
    homePoints: 62, awayPoints: 7, outlet: 'ACC Network'
}, o);

function model(o) {
    return Object.assign({
        team: {
            id: DUKE, school: 'Duke', mascot: 'Blue Devils', color: '00539b', logos: ['https://x/500/150.png'],
            twitter: '@DukeFootball', location: { name: 'Wallace Wade Stadium', city: 'Durham', state: 'NC', capacity: 40004, grass: true },
            seasons: [{ season: 2025 }, { season: 2026 }]
        },
        seasonObj: {
            season: 2026, conference: 'ACC', coach: 'Manny Diaz', cumulativeScoreV2: 5, cumulativeScoreV1: 9,
            spRank: 34, spRating: 10.2, fpiRank: 30, talentRank: 69, returningProduction: 17.1, expectedWins: 5.5,
            weeklyScore: [
                { week: 1, seasonType: 'regular', scoreV1: 4, scoreV2: 2 },
                { week: 2, seasonType: 'regular', scoreV1: 3, scoreV2: 3 }
            ]
        },
        year: 2026,
        scoreCode: 'cumulativeScoreV2',
        record: { total: { wins: 2, losses: 0 }, conferenceGames: { wins: 1, losses: 0 } },
        logos: [{ id: GT, logos: ['https://x/500/59.png'] }],
        recruiting: { rank: 71 },
        schedule: [
            game(1),
            game(2, { week: 2, startDate: '2026-09-12T23:00:00.000Z', homeId: UVA, homeTeam: 'Virginia', awayId: DUKE, awayTeam: 'Duke', homePoints: 20, awayPoints: 24, outlet: null }),
            game(3, { week: 3, startDate: '2099-10-10T19:30:00.000Z', completed: false, homeId: GT, homeTeam: 'Georgia Tech', awayId: DUKE, awayTeam: 'Duke', homePoints: null, awayPoints: null, outlet: 'ESPN' }),
            game(4, { week: 4, startDate: '2099-10-17T04:00:00.000Z', startTimeTbd: true, completed: false, homeId: DUKE, homeTeam: 'Duke', awayId: UNC, awayTeam: 'North Carolina', homePoints: null, awayPoints: null, outlet: null })
        ],
        rankings: [],
        bettingLines: [
            { homeTeam: 'Georgia Tech', awayTeam: 'Duke', lines: [{ provider: 'Bovada', formattedSpread: 'Georgia Tech -1' }, { provider: 'DraftKings', formattedSpread: 'Duke -4.5' }] },
            { homeTeam: 'Duke', awayTeam: 'North Carolina', lines: [{ provider: 'DraftKings', formattedSpread: 'North Carolina -6.5' }] }
        ],
        owner: null,
        fantasyRank: { rank: 14, total: 264 },
        playerLeaders: { leaders: { passing: [{ name: 'Walker Eget', pos: 'QB', YDS: 721, TD: 6, INT: 1, PCT: 0.62 }] } },
        teamStats: { team: 'Duke', games: 2, stats: { totalYards: 900, totalYardsOpponent: 500, rushingYards: 400, netPassingYards: 500, turnovers: 1, sacks: 4, thirdDowns: 20, thirdDownConversions: 9 } },
        standings: buildStandings(
            [{ teamId: GT, conferenceGames: { wins: 0, losses: 1 }, total: { wins: 1, losses: 3 } },
             { teamId: DUKE, conferenceGames: { wins: 1, losses: 0 }, total: { wins: 2, losses: 0 } },
             { teamId: UVA, conferenceGames: { wins: 1, losses: 1 }, total: { wins: 3, losses: 1 } }],
            [{ id: UVA, school: 'Virginia' }, { id: GT, school: 'Georgia Tech' }, { id: DUKE, school: 'Duke' }])
    }, o || {});
}

function render(m, opts = {}) {
    window.history.replaceState(null, '', '/team?team=150' + (opts.hash ? '#' + opts.hash : ''));
    document.head.innerHTML = '<title data-league-title="Team">Team</title>';
    document.body.innerHTML = '<main class="sp-page ft" id="team-page"></main>';
    window.ccLeague = Object.assign({
        sport: () => 'football', name: () => 'The Polar Depressed',
        title: (p) => p + ' · The Polar Depressed · Campus Clash'
    }, opts.league || {});
    ftPage.bound = false;
    renderTeamPage(m);
    return document.getElementById('team-page');
}
const txt = (sel) => Array.from(document.querySelectorAll(sel)).map(n => n.textContent.replace(/\s+/g, ' ').trim()).join(' | ');
const tab = (name) => document.querySelector('.sp-tab[data-tab="' + name + '"]').click();

describe('the hero', () => {
    test('team colour on the kit’s hero, over a drawn field', () => {
        render(model());
        const hero = document.querySelector('.sp-hero.team.ft-hero');
        expect(hero.getAttribute('style')).toContain('--team:#00539b');
        expect(hero.querySelector('svg.ft-field')).not.toBeNull();
        expect(txt('.ft-school')).toBe('DUKE');
        expect(txt('.ft-mascot')).toBe('Blue Devils · ACC · Wallace Wade Stadium');
    });

    test('records are the biggest numbers: overall, conference, season points', () => {
        render(model());
        expect(txt('.ft-rec .n')).toBe('2–0 | 1–0 | 5');
        expect(txt('.ft-rec .l')).toBe('Overall | ACC | Season pts');
    });

    test('SP+, FPI and the projection ride as chips', () => {
        render(model());
        expect(txt('.ft-chips')).toContain('SP+ #34');
        expect(txt('.ft-chips')).toContain('FPI #30');
        expect(txt('.ft-chips')).toContain('Proj. 5.5 wins');
    });

    test('the season picker survives, and the form marks are the kit’s', () => {
        render(model());
        expect(document.querySelectorAll('.ft-season option')).toHaveLength(2);
        expect(txt('.ft-form .sp-wl')).toBe('W | W');
    });

    test('a season not yet played says Preseason rather than leaving a bare 0–0', () => {
        render(model({ schedule: [game(3, { completed: false, homePoints: null, awayPoints: null })], record: undefined }));
        expect(txt('.ft-chips')).toContain('2026 Preseason');
        expect(document.querySelector('.ft-form')).toBeNull();
    });

    test('the tab title names the team and the league', () => {
        render(model());
        expect(document.title).toBe('Duke Blue Devils · The Polar Depressed · Campus Clash');
    });
});

describe('the owner strip', () => {
    test('undrafted says so, naming the league', () => {
        render(model());
        expect(document.querySelector('.sp-own.free')).not.toBeNull();
        expect(txt('.sp-own')).toBe('Undrafted in The Polar Depressed, 2026');
    });

    test('drafted: whose roster, linked, and what it has banked them', () => {
        render(model({ owner: { userId: 'u1', name: 'Garrett Graham', franchiseName: 'Name, Image, & Sadness', points: { 1: 2, 2: 3 } } }));
        const strip = document.querySelector('a.sp-own');
        expect(strip.getAttribute('href')).toBe('/userHome?user=u1');
        expect(txt('.sp-own .who')).toContain('On Name, Image, & Sadness’s roster');
        expect(txt('.sp-own .pts .n')).toBe('+5');
    });

    test('a basketball league drafts no football teams: no strip at all', () => {
        render(model(), { league: { sport: () => 'basketball' } });
        expect(document.querySelector('.sp-own')).toBeNull();
    });
});

describe('the tabs replace the collapse carets', () => {
    test('Overview · Schedule · Stats · <Conference>, sticky, Overview first', () => {
        render(model());
        expect(txt('.sp-tabs .sp-tab')).toBe('Overview | Schedule | Stats | ACC');
        expect(document.querySelector('.sp-tab.on').getAttribute('data-tab')).toBe('overview');
        expect(document.querySelector('.drop, .fa-caret-down')).toBeNull();
    });

    test('an independent has no conference tab', () => {
        render(model({ standings: [] }));
        expect(document.querySelector('[data-tab="conference"]')).toBeNull();
    });

    test('a tab repaints the panel and rides in the hash', () => {
        render(model());
        tab('stats');
        expect(window.location.hash).toBe('#stats');
        expect(txt('.ft-panel .sp-h')).toContain('Team stats');
        expect(document.querySelector('.sp-tab.on').getAttribute('data-tab')).toBe('stats');
    });

    test('a shared link lands on its tab; an unknown one on Overview', () => {
        render(model(), { hash: 'schedule' });
        expect(document.querySelector('.ft-panel .sp-games')).not.toBeNull();
        render(model(), { hash: 'nonsense' });
        expect(document.querySelector('.sp-tab.on').getAttribute('data-tab')).toBe('overview');
    });

    test('the peek’s button opens the full table', () => {
        render(model());
        document.querySelector('.sp-peek-more').click();
        expect(window.location.hash).toBe('#conference');
        expect(document.querySelectorAll('.ft-panel .sp-st tbody tr')).toHaveLength(3);
    });
});

describe('every section the long scroll had is still on a tab', () => {
    test('Overview: next game, season numbers, outlook, weekly points, standings peek, programme', () => {
        render(model());
        expect(txt('.ft-panel .sp-h')).toBe('Next up | Season | Outlook | Weekly points | ACC1st of 3 | Program');
        expect(txt('.sp-next')).toContain('Georgia Tech');
        expect(txt('.sp-next-pay')).toBe('−4.5');
        expect(txt('.ft-tile')).toContain('#14 of 264');
        expect(txt('.ft-tile')).toContain('#71');
        expect(txt('.ft-chips-row')).toContain('Talent #69');
        expect(txt('.ft-chips-row')).toContain('17.1% returning');
        expect(document.querySelectorAll('.ft-week')).toHaveLength(2);
        expect(txt('.ft-kvs')).toContain('Manny Diaz');
        expect(txt('.ft-kvs')).toContain('40,004');
        expect(txt('.ft-kvs')).toContain('@DukeFootball');
    });

    test('Stats: team stats (points off the games) and season leaders', () => {
        render(model(), { hash: 'stats' });
        expect(txt('.ft-kv')).toContain('Total YPG450.0');
        expect(txt('.ft-kv')).toContain('Points / game43.0');
        expect(txt('.tv-pl-name')).toBe('Walker Eget');
        expect(txt('.tv-pl-player .tv-pl-stat-cell')).toContain('62%');
    });

    test('Stats says so when there is nothing yet', () => {
        render(model({ playerLeaders: null, teamStats: null }), { hash: 'stats' });
        expect(txt('.ft-panel .sp-empty')).toContain('arrive once the season kicks off');
    });

    test('a finished regular season shows wins against the projection', () => {
        const done = model().schedule.map(g => Object.assign({}, g, { completed: true, homePoints: 1, awayPoints: 0 }));
        render(model({ schedule: done }));
        expect(txt('.ft-tile')).toContain('vs 5.5 expected');
    });
});

describe('the schedule: game rows with fantasy points', () => {
    const rows = () => Array.from(document.querySelectorAll('.sp-gr:not(.div)'));

    test('one row a game, from the viewed team’s side: mark, opponent, result', () => {
        render(model(), { hash: 'schedule' });
        const r = rows();
        expect(r).toHaveLength(4);
        expect(r[0].querySelector('.nm').textContent).toContain('vs');
        expect(r[0].querySelector('.nm').textContent).toContain('William & Mary');
        expect(r[0].querySelector('.res').textContent).toBe('W 62–7');
        expect(r[1].querySelector('.nm').textContent).toContain('@');
        expect(r[1].querySelector('.res').textContent).toBe('W 24–20');
        expect(r[0].querySelector('a.d').getAttribute('href')).toBe('/game/1');
        expect(txt('.sp-gr.div')).toBe('Up next');
    });

    test('an undrafted team’s points come off its own weekly rows, in this league’s model', () => {
        render(model(), { hash: 'schedule' });
        expect(rows().map(r => r.querySelector('.p').textContent)).toEqual(['+2', '+3', '', '']);
        render(model({ scoreCode: 'cumulativeScoreV1' }), { hash: 'schedule' });
        expect(rows().map(r => r.querySelector('.p').textContent)).toEqual(['+4', '+3', '', '']);
    });

    test('a drafted team’s are what it banked its manager, game by game', () => {
        render(model({ owner: { userId: 'u', name: 'G', franchiseName: 'F', points: { 1: 0, 2: 6 } } }), { hash: 'schedule' });
        expect(rows().map(r => r.querySelector('.p').textContent)).toEqual(['0', '+6', '', '']);
    });

    test('two games in one week can’t be split: the week’s total sits on the later, and says so', () => {
        const sched = model().schedule.slice();
        sched[1] = Object.assign({}, sched[1], { week: 1 });
        render(model({ schedule: sched }), { hash: 'schedule' });
        const p = rows().map(r => r.querySelector('.p'));
        expect(p[0].textContent).toBe('');
        expect(p[1].textContent).toBe('+2');
        expect(p[1].getAttribute('title')).toContain('two games');
    });

    test('the spread from the viewed team’s side, DraftKings first', () => {
        render(model(), { hash: 'schedule' });
        expect(rows()[2].querySelector('.res').textContent).toBe('−4.5');
        expect(rows()[3].querySelector('.res').textContent).toBe('+6.5');
    });

    test('a spread or rank off the feed is escaped, not markup', () => {
        const m = model();
        m.bettingLines[0].lines[1].formattedSpread = 'Duke -<b>x</b>';
        m.rankings = [{ season: 2026, week: 3, polls: [{ poll: 'AP Top 25', ranks: [{ school: 'Georgia Tech', rank: '<i>9</i>' }] }] }];
        render(m, { hash: 'schedule' });
        expect(rows()[2].querySelector('.res b')).toBeNull();
        expect(rows()[2].querySelector('.ft-rk i')).toBeNull();
        expect(rows()[2].querySelector('.ft-rk').textContent).toBe('<i>9</i>');
    });

    test('says which zone the times are in', () => {
        render(model(), { hash: 'schedule' });
        expect(txt('.ft-panel .sp-h small')).toMatch(/^All times \S+/);
    });
});

describe('buildStandings', () => {
    test('conference win % first, so 4–0 sits above 5–1', () => {
        const rows = buildStandings(
            [{ teamId: 1, conferenceGames: { wins: 5, losses: 1 }, total: { wins: 6, losses: 1 } },
             { teamId: 2, conferenceGames: { wins: 4, losses: 0 }, total: { wins: 5, losses: 2 } }],
            [{ id: 1, school: 'A' }, { id: 2, school: 'B' }, { id: 3, school: 'C' }]);
        expect(rows.map(r => r.team)).toEqual(['B', 'A', 'C']);
        expect(rows[2].conferenceGames.wins).toBe(0);
    });

    test('no records yet: alphabetical', () => {
        expect(buildStandings({ message: 'No conference records' }, [{ id: 1, school: 'b' }, { id: 2, school: 'A' }]).map(r => r.team)).toEqual(['A', 'b']);
    });
});

describe('loadTeamPage asks about the league being viewed', () => {
    test('with nothing in storage yet, another league’s franchise is not named the owner', async () => {
        window.ccSeasonOf = require('../public/season-of.js');
        window.localStorage.clear();
        window.history.replaceState(null, '', '/team?team=150');
        document.head.innerHTML = '<title>Team</title>';
        document.body.innerHTML = '<main class="sp-page ft" id="team-page"></main>';
        window.ccLeague = { sport: () => 'football', name: () => 'The Polar Depressed', title: (p) => p };
        window.ccLeagueCode = () => 'graham-league';
        const doc = { id: DUKE, school: 'Duke', mascot: 'Blue Devils', logos: [], seasons: [{ season: 2026, conference: 'ACC', weeklyScore: [{ week: 1 }] }] };
        // A basketball franchise owns basketball team 150 — Duke's football id.
        const users = [{ _id: 'h1', league: 'hoops-league', firstName: 'H', seasons: [{ season: 2026, franchiseName: 'Bracket Busters', teams: [{ id: 150 }] }] }];
        global.fetch = jest.fn((url) => Promise.resolve({ status: 200, ok: true,
            json: () => Promise.resolve(/\/teams\/info\//.test(url) ? [doc] : /\/users\/season\//.test(url) ? users : []) }));
        ftPage.bound = false;
        await loadTeamPage();
        expect(txt('.sp-own')).toContain('Undrafted');
        expect(txt('.sp-own')).not.toContain('Bracket Busters');
        delete window.ccLeagueCode;
    });
});
