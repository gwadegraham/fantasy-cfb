// modules/hoops-espn-live.js — ESPN's live box and shots, in the shapes the
// game page already draws from CBBD.
//
// The fixture is a real ESPN summary, trimmed to the fields read: Notre Dame
// @ Villanova, 1 Nov 2026 (CBBD 377909 / ESPN 401920982). The expectations
// are CBBD's own numbers for that game, so a wrong mapping fails here.

const live = require('../modules/hoops-espn-live');
const SUMMARY = require('./fixtures/espn-hoops-summary-401920982.json');

const GAME = { id: 377909, season: 2027, homeTeamId: 338, awayTeamId: 213, sourceId: '401920982' };
const clone = (o) => JSON.parse(JSON.stringify(o));

describe('boxFrom', () => {
    test('each side lands on OUR team id, by ESPN home/away, with the header score', () => {
        const box = live.boxFrom(SUMMARY, GAME);
        expect(box).toMatchObject({ gameId: 377909, season: 2027, source: 'espn' });
        expect(box.home).toMatchObject({ teamId: 338, points: 72, fgMade: 24, fgAtt: 52 });
        expect(box.away).toMatchObject({ teamId: 213, points: 74, fgMade: 23, fgAtt: 65, threeMade: 9, threeAtt: 24, ftMade: 19, ftAtt: 25 });
        // Left for the live poller's line score: the box's would disagree mid-game.
        expect(box.home.byPeriod).toEqual([]);
    });

    test("a player's line matches CBBD's, with ESPN's id kept apart from CBBD's athleteId", () => {
        const royal = live.boxFrom(SUMMARY, GAME).home.players.find(p => p.name === 'Devin Royal');
        expect(royal).toMatchObject({ espnId: '4895776', jersey: '21', position: 'F', starter: true, minutes: 32, points: 5,
            rebounds: 8, offRebounds: 2, defRebounds: 6, turnovers: 3, fouls: 3, fgMade: 0, fgAtt: 1, ftMade: 5, ftAtt: 6,
            twoMade: 0, twoAtt: 1, efgPct: 0, tsPct: 68.7 });
        expect(royal.athleteId).toBeUndefined();
    });

    test('players who did not play are left out, as CBBD leaves them out', () => {
        const box = live.boxFrom(SUMMARY, GAME);
        expect(box.home.players).toHaveLength(8);
        expect(box.home.players.every(p => p.minutes != null)).toBe(true);
    });

    test('the score is the header\'s even when the players add up to something else (the 2 Nov drift)', () => {
        const s = clone(SUMMARY);
        s.header.competitions[0].competitors.find(c => c.homeAway === 'home').score = '73';
        expect(live.boxFrom(s, GAME).home.points).toBe(73);
    });

    test('before tip-off (no player lines) or with no header: null', () => {
        const s = clone(SUMMARY);
        s.boxscore.players.forEach(t => t.statistics[0].athletes.forEach(a => { a.stats = []; }));
        expect(live.boxFrom(s, GAME)).toBeNull();
        expect(live.boxFrom({ boxscore: SUMMARY.boxscore }, GAME)).toBeNull();
        expect(live.boxFrom(Object.assign({}, SUMMARY, { boxscore: {} }), GAME)).toBeNull();
    });

    test('a missing stat is absent, never 0', () => {
        const s = clone(SUMMARY);
        s.boxscore.teams[0].statistics = [];
        const away = live.boxFrom(s, GAME).away;
        expect(away.fgMade).toBeUndefined();
        expect(away.efgPct).toBeUndefined();
        expect(away.rebounds).toBeUndefined();
    });
});

describe('shotsFrom', () => {
    const shots = () => live.shotsFrom(SUMMARY, GAME);

    test('every field-goal attempt, free throws left out; the counts are CBBD\'s', () => {
        const c = shots();
        expect(c.attempts).toEqual({ home: 52, away: 65 });
        expect([c.home.length, c.away.length]).toEqual([52, 65]);
        expect(c).toMatchObject({ complete: false, source: 'espn' });
    });

    test('lands where CBBD put the same shot: x mirrored, y off the rim', () => {
        // CBBD's chart for 377909: Braeden Smith (ND) misses at (9, 6), 19:45 1st.
        const smith = shots().away.find(s => s.period === 1 && s.clock === '19:45');
        expect(smith).toMatchObject({ shooter: 'Braeden Smith', made: false, range: 'jumper', assisted: false });
        expect(Math.hypot(smith.x - 9, smith.y - 6)).toBeLessThan(1.5);
        // Tyler Perkins (Villanova) makes at (34, 9), 18:53.
        const perkins = shots().home.find(s => s.period === 1 && s.clock === '18:53');
        expect(perkins).toMatchObject({ shooter: 'Tyler Perkins', made: true, range: 'jumper' });
        expect(Math.hypot(perkins.x - 34, perkins.y - 9)).toBeLessThan(1.5);
    });

    test('a corner shot behind the rim (y below 0) is drawn on the baseline, not dropped', () => {
        const s = clone(SUMMARY);
        s.plays = [{ shootingPlay: true, scoringPlay: false, pointsAttempted: 3, type: { text: 'JumpShot' },
            coordinate: { x: 1, y: -1 }, period: { number: 1 }, clock: { displayValue: '5:00' }, team: { id: '87' }, participants: [] }];
        expect(live.shotsFrom(s, GAME).away[0]).toMatchObject({ x: 49, y: 4.3, range: 'three_pointer' });
    });

    // ESPN's team ids (Villanova 222, Notre Dame 87), not CBBD's.
    test('a shot with no real location is counted but not drawn; one for neither team is ignored', () => {
        const s = clone(SUMMARY);
        const base = { shootingPlay: true, scoringPlay: true, pointsAttempted: 2, type: { text: 'LayUpShot' },
            period: { number: 2 }, clock: { displayValue: '1:00' }, participants: [{ athlete: { id: '1' } }, { athlete: { id: '2' } }] };
        s.plays = [
            Object.assign({}, base, { team: { id: '222' }, coordinate: { x: -214748340, y: -214748365 } }),
            Object.assign({}, base, { team: { id: '222' }, coordinate: { x: 25, y: 0 } }),
            Object.assign({}, base, { team: { id: '9' }, coordinate: { x: 25, y: 0 } })
        ];
        const c = live.shotsFrom(s, GAME);
        expect(c.attempts).toEqual({ home: 2, away: 0 });
        expect(c.home).toHaveLength(1);
        expect(c.home[0]).toMatchObject({ made: true, assisted: true, range: 'rim', x: 25, y: 5.3, shooter: undefined });
    });

    test('nothing located yet: null', () => {
        expect(live.shotsFrom(Object.assign({}, SUMMARY, { plays: [] }), GAME)).toBeNull();
        expect(live.shotsFrom({ plays: [] }, GAME)).toBeNull();
    });

    test('ranges: a three by points, the rim by shot type, any other two a jumper', () => {
        expect(live.rangeOf({ pointsAttempted: 3, type: { text: 'JumpShot' } })).toBe('three_pointer');
        ['LayUpShot', 'DunkShot', 'TipShot'].forEach(t => expect(live.rangeOf({ pointsAttempted: 2, type: { text: t } })).toBe('rim'));
        expect(live.rangeOf({ pointsAttempted: 2, type: { text: 'JumpShot' } })).toBe('jumper');
        const byRange = shots().home.reduce((m, x) => Object.assign(m, { [x.range]: (m[x.range] || 0) + 1 }), {});
        expect(Object.keys(byRange).sort()).toEqual(['jumper', 'rim', 'three_pointer']);
    });
});

test('shape: both at once', () => {
    const out = live.shape(GAME)(SUMMARY);
    expect(out.box.source).toBe('espn');
    expect(out.shots.source).toBe('espn');
});
