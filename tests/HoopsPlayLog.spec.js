// The gamecast's play log (modules/hoops-play-log.js, hoops-espn-live.js
// playsFrom): one shape from two feeds.
//
// Fixtures are one real game from both: Notre Dame @ Villanova, 1 Nov 2026 —
// ESPN 401920982 (summary, trimmed) and CBBD 377909 (/plays/game, trimmed).
// A wrong side, score or filter shows up as the two disagreeing.

const log = require('../modules/hoops-play-log');
const live = require('../modules/hoops-espn-live');
const ESPN = require('./fixtures/espn-hoops-plays-401920982.json');
const CBBD = require('./fixtures/cbbd-plays-377909.json');

// CBBD home Villanova (338), away Notre Dame (213); ESPN ids 222 and 87.
const GAME = { id: 377909, season: 2027, homeTeamId: 338, awayTeamId: 213 };
const IDS = { home: '222', away: '87' };
const clone = (o) => JSON.parse(JSON.stringify(o));
const key = (p) => [p.period, p.clock, p.text].join('|');

describe('fromCbbd', () => {
    const plays = log.fromCbbd(CBBD, GAME);

    test('substitutions dropped; sides, score and win probability as CBBD sends them', () => {
        expect(plays.some(p => p.type === 'Substitution')).toBe(false);
        const last = plays[plays.length - 1];
        expect(last).toMatchObject({ period: 2, clock: '0:00', home: 72, away: 74 });
        const three = plays.find(p => p.text === 'Brady Koehler misses 23-foot three point jumper');
        expect(three).toMatchObject({ side: 'away', home: 2, away: 0, wp: 0.691 });
        expect(three.points).toBeUndefined();
    });

    test('a scoring play carries its points; a player\'s technical is marked', () => {
        expect(plays.filter(p => p.points).every(p => [1, 2, 3].includes(p.points))).toBe(true);
        expect(plays.find(p => /Technical/.test(p.type))).toMatchObject({ player: true });
    });

    test('nothing usable: an empty log', () => {
        expect(log.fromCbbd(null, GAME)).toEqual([]);
        expect(log.fromCbbd([{ playType: 'JumpShot', teamId: 9, homeWinProbability: 4 }], GAME)[0]).toMatchObject({ side: null, wp: null, home: null });
    });
});

describe('ESPN and CBBD agree on the same game', () => {
    const e = live.playsFrom(ESPN, GAME, IDS);
    const c = log.fromCbbd(CBBD, GAME);

    test('play for play: type, side, score and points', () => {
        const byKey = new Map(c.map(p => [key(p), p]));
        expect(e.length).toBe(c.length);
        for (const p of e) {
            const q = byKey.get(key(p));
            expect(q).toBeDefined();
            expect([p.type, p.side, p.home, p.away, p.points]).toEqual([q.type, q.side, q.home, q.away, q.points]);
        }
    });

    test('and on the team fouls (both past 7, Notre Dame at 10)', () => {
        expect(log.teamFouls(e)).toEqual(log.teamFouls(c));
        expect(log.teamFouls(c)).toEqual({ period: 2, home: { fouls: 9, bonus: 'double' }, away: { fouls: 10, bonus: 'single' } });
    });
});

describe('playsFrom (ESPN)', () => {
    test('live shots carry their spot on the chart; free throws and other plays do not', () => {
        const e = live.playsFrom(ESPN, GAME, IDS);
        const shots = e.filter(p => p.shot);
        expect(shots.length).toBe(117);
        expect(e.filter(p => /FreeThrow/.test(p.type)).some(p => p.shot)).toBe(false);
        const smith = e.find(p => p.period === 1 && p.clock === '19:45' && p.shot);
        expect(Math.hypot(smith.shot.x - 9, smith.shot.y - 6)).toBeLessThan(1.5);   // CBBD's own chart
    });

    test('win probability is OUR home side\'s', () => {
        const e = live.playsFrom(ESPN, GAME, IDS);
        // Villanova (our home, ESPN home here) lost: its number ends near 0.
        expect(e.filter(p => p.wp != null).pop().wp).toBeLessThan(0.1);
    });

    test('our home as ESPN\'s away (a neutral site): scores and win probability turned round', () => {
        const flipped = { id: 377909, season: 2027, homeTeamId: 213, awayTeamId: 338 };
        const e = live.playsFrom(ESPN, flipped, { home: '87', away: '222' });
        const last = e[e.length - 1];
        expect([last.home, last.away]).toEqual([74, 72]);
        expect(e.filter(p => p.wp != null).pop().wp).toBeGreaterThan(0.9);
    });

    // UAB v McNeese (2 Nov 2026): the header said McNeese home while every
    // UAB basket raised the plays' homeScore. The baskets win.
    test('plays that disagree with their own header follow the baskets', () => {
        const s = clone(ESPN);
        s.header.competitions[0].competitors.forEach(c => { c.homeAway = c.homeAway === 'home' ? 'away' : 'home'; });
        const e = live.playsFrom(s, GAME, IDS);
        const last = e[e.length - 1];
        expect([last.home, last.away]).toEqual([72, 74]);
        expect(e.filter(p => p.wp != null).pop().wp).toBeLessThan(0.1);
    });

    test('no baskets yet: the header decides', () => {
        const s = clone(ESPN);
        s.plays = s.plays.slice(0, 2).map(p => Object.assign(p, { homeScore: 0, awayScore: 0 }));
        expect(live.playsFrom(s, { id: 1, homeTeamId: 213, awayTeamId: 338 }, { home: '87', away: '222' })).toHaveLength(2);
    });

    test('before tip-off or no header: null', () => {
        expect(live.playsFrom(Object.assign(clone(ESPN), { plays: [] }), GAME, IDS)).toBeNull();
        expect(live.playsFrom({ plays: ESPN.plays }, GAME, IDS)).toBeNull();
    });

    test('a technical with no player named is not marked', () => {
        const s = clone(ESPN);
        s.plays = [{ id: '1', type: { text: 'Technical Foul' }, text: 'Technical Foul on Coach', period: { number: 1 }, clock: { displayValue: '5:00' }, team: { id: '222' }, homeScore: 0, awayScore: 0 }];
        expect(live.playsFrom(s, GAME, IDS)[0].player).toBeUndefined();
    });
});

describe('teamFouls', () => {
    const foul = (side, period, type = 'PersonalFoul', o = {}) => Object.assign({ type, side, period }, o);
    const many = (n, side, period) => Array.from({ length: n }, () => foul(side, period));

    test('the bonus belongs to the side the OTHER team has fouled: 7 single, 10 double', () => {
        const f = log.teamFouls([].concat(many(7, 'away', 1), many(10, 'home', 1)));
        expect(f).toEqual({ period: 1, home: { fouls: 10, bonus: 'single' }, away: { fouls: 7, bonus: 'double' } });
        expect(log.teamFouls(many(6, 'away', 1)).home.bonus).toBeNull();
    });

    test('a new half starts again; overtime keeps counting the second half', () => {
        expect(log.teamFouls([].concat(many(8, 'home', 1), [foul('home', 2)])).home.fouls).toBe(1);
        expect(log.teamFouls([].concat(many(6, 'home', 2), many(2, 'home', 3))).home.fouls).toBe(8);
    });

    test('only a player\'s technical counts; other plays never do', () => {
        const f = log.teamFouls([foul('home', 1, 'Technical Foul', { player: true }), foul('home', 1, 'Technical Foul'),
            foul('home', 1, 'JumpShot'), foul(null, 1)]);
        expect(f.home.fouls).toBe(1);
    });

    test('no plays: null', () => {
        expect(log.teamFouls([])).toBeNull();
        expect(log.teamFouls(null)).toBeNull();
        expect(log.teamFouls([{ type: 'X' }])).toBeNull();
    });
});
