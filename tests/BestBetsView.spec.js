// Tests for public/best-bets.js — the rows of the Best Bets list on the betting
// page. Pure string rendering; the page wires the buttons.

const view = require('../public/best-bets');

function pick(over = {}) {
    return {
        gameId: 1, homeTeam: 'Utah', awayTeam: 'BYU', betType: 'moneyline', teamSide: 'home',
        selection: 'Utah ML', line: null, odds: -250, winProb: 0.74, ev: -0.03,
        priceEdge: null, shopped: true, agree: ['elo'], voters: ['elo', 'sp'],
        started: false, result: null,
        ...over
    };
}

const canUse = () => ({ ok: true, label: 'Use' });

describe('render', () => {
    test('shows only the games in the page\'s own week split', () => {
        const data = { picks: [pick({ gameId: 1 }), pick({ gameId: 2, homeTeam: 'Iowa' })], record: null };
        const html = view.render(data, [2], { canUse });
        expect(html).toContain('Iowa to win');
        expect(html).not.toContain('Utah to win');
    });

    test('caps the list', () => {
        const picks = Array.from({ length: 20 }, (_, i) => pick({ gameId: i }));
        expect(view.visiblePicks({ picks }, picks.map(p => p.gameId))).toHaveLength(view.SHOW);
    });

    test('puts picks still open above ones already kicked off', () => {
        const data = { picks: [pick({ gameId: 1, started: true }), pick({ gameId: 2 }), pick({ gameId: 3, started: true }), pick({ gameId: 4 })] };
        expect(view.visiblePicks(data, [1, 2, 3, 4]).map(p => p.gameId)).toEqual([2, 4, 1, 3]);
    });

    test('says so, with the floor, when nothing is likely enough', () => {
        expect(view.render({ picks: [], minWinProb: 0.7 }, [], { canUse })).toContain('at least a 70% chance');
        expect(view.render(null, [], { canUse })).toBe('');
    });

    test('says every number as a sentence', () => {
        const html = view.render({ picks: [pick()] }, [1], { canUse });
        expect(html).toContain('Wins about 74%');
        expect(html).toContain('Bet $100, win $40');
        expect(html).toContain('1 of 2 ratings agree');
    });

    test('a pick the member can use gets a button indexed into the visible list', () => {
        const html = view.render({ picks: [pick()] }, [1], { canUse });
        expect(html).toContain('data-game-id="1"');
        expect(html).toContain('>Use<');
    });

    test('a member who cannot use any pick is told why once, not on every row', () => {
        const picks = [pick({ gameId: 1 }), pick({ gameId: 2 }), pick({ gameId: 3 })];
        const html = view.render({ picks }, [1, 2, 3], { canUse: () => ({ ok: false, label: 'No slip yet' }), legCount: 1 });
        expect(html).not.toContain('bestbets-use"');
        expect(html.match(/No slip yet/g)).toHaveLength(1);
        expect(html).not.toContain('bestbets-use-na');
    });

    test('saying why it can\'t be used doesn\'t fold an open section', () => {
        const html = view.render({ picks: [pick()] }, [1], { canUse: () => ({ ok: false, label: 'No slip yet' }), open: true });
        expect(html).toMatch(/^<details class="bestbets-fold" open>/);
    });

    test('folded unless the page says open, with the payout on the folded line', () => {
        const data = { picks: [pick({ odds: -250 })] };
        const shut = view.render(data, [1], { canUse, legCount: 1 });
        expect(shut).toMatch(/^<details class="bestbets-fold">/);
        expect(shut).toContain('1 leg · $20 pays <strong>$28</strong>');
        expect(view.render(data, [1], { canUse, legCount: 1, open: true })).toMatch(/^<details class="bestbets-fold" open>/);
    });

    test('each pick appears once: the parlay\'s legs are not repeated below it', () => {
        const picks = [pick({ gameId: 1, homeTeam: 'Iowa' }), pick({ gameId: 2, homeTeam: 'Rice' })];
        const html = view.render({ picks }, [1, 2], { canUse, legCount: 1 });
        expect(html.match(/Iowa to win/g)).toHaveLength(1);
        expect(html.match(/Rice to win/g)).toHaveLength(1);
        expect(html).toContain('data-game-id="2"');
        expect(html.indexOf('More likely bets')).toBeGreaterThan(html.indexOf('Iowa to win'));
    });

    test('a started game offers nothing; a graded one shows its result', () => {
        expect(view.render({ picks: [pick({ started: true })] }, [1], { canUse })).toContain('Started');
        const graded = view.render({ picks: [pick({ started: true, result: 'win' })] }, [1], { canUse });
        expect(graded).toContain('bestbets-result--win');
        expect(graded).not.toContain('data-game-id');
    });

    test('names which ratings agree, and none that did not vote', () => {
        const html = view.render({ picks: [pick()] }, [1], { canUse });
        expect(html).toContain('title="Elo agrees, SP+ disagrees"');
        expect(html).not.toMatch(/CFBD (agrees|disagrees)/);
    });

    test('escapes team names', () => {
        const html = view.render({ picks: [pick({ awayTeam: '<b>x</b>' })] }, [1], { canUse });
        expect(html).not.toContain('<b>x</b>');
    });

    test('carries the honest caveat', () => {
        expect(view.render({ picks: [pick()] }, [1], { canUse })).toContain('not secrets the books missed');
    });
});

describe('pickTitle / pickNeeds', () => {
    test('a moneyline is "to win" and needs no explanation', () => {
        expect(view.pickTitle(pick())).toBe('Utah to win');
        expect(view.pickTitle(pick({ teamSide: 'away' }))).toBe('BYU to win');
        expect(view.pickNeeds(pick())).toBe('');
    });

    test('a spread says what has to happen, push numbers excluded', () => {
        const s = (line) => pick({ betType: 'spread', line, selection: 'Utah ' + line });
        expect(view.pickNeeds(s(-6.5))).toBe('Must win by 7 or more');
        expect(view.pickNeeds(s(-7))).toBe('Must win by 8 or more');
        expect(view.pickNeeds(s(6.5))).toBe('Wins, or loses by 6 or fewer');
        expect(view.pickNeeds(s(7))).toBe('Wins, or loses by 6 or fewer');
        expect(view.pickNeeds(s(0))).toBe('Must win');
    });

    test('a total says what the combined score has to be', () => {
        const t = (sel, line) => pick({ betType: 'over_under', selection: sel, line });
        expect(view.pickTitle(t('Over 53.5', 53.5))).toBe('Over 53.5 total points');
        expect(view.pickNeeds(t('Over 53.5', 53.5))).toBe('Both teams combined score 54 or more');
        expect(view.pickNeeds(t('Over 53', 53))).toBe('Both teams combined score 54 or more');
        expect(view.pickNeeds(t('Under 42.5', 42.5))).toBe('Both teams combined score 42 or fewer');
        expect(view.pickNeeds(t('Under 42', 42))).toBe('Both teams combined score 41 or fewer');
    });

    test('profit on $100 at either sign of odds', () => {
        expect(view.winOn100(-250)).toBe(40);
        expect(view.winOn100(150)).toBe(150);
        expect(view.winOn100(-110)).toBe(91);
    });
});

describe('valueNote', () => {
    test('names the points DK gives over the field', () => {
        expect(view.valueNote(pick({ priceEdge: 1.5 }))).toBe('Good value: 1.5 more points than other books');
        expect(view.valueNote(pick({ priceEdge: 1 }))).toBe('Good value: 1 more point than other books');
    });

    test('otherwise speaks in plain price words', () => {
        expect(view.valueNote(pick({ ev: 0.01 }))).toMatch(/^Good value/);
        expect(view.valueNote(pick({ ev: -0.04 }))).toBe('Normal price');
        expect(view.valueNote(pick({ ev: -0.08 }))).toBe('A bit pricey');
    });

    test('never claims a comparison that was not made', () => {
        expect(view.valueNote(pick({ shopped: false, priceEdge: 2 }))).toMatch(/^Only DraftKings/);
    });
});

describe('recordLine', () => {
    test('nothing graded yet', () => {
        expect(view.recordLine(null, 6)).toBe('No finished weeks to check yet.');
        expect(view.recordLine({ wins: 0, losses: 0, pushes: 0 }, 6)).toBe('No finished weeks to check yet.');
    });

    test('legs won, slips that hit, and dollars at $10 a pick', () => {
        const line = view.recordLine({ wins: 37, losses: 11, pushes: 0, units: -2.47, hitPct: 77.1, slips: 8, slipsHit: 2 }, 6);
        expect(line).toContain('won <strong>37 of 48</strong> (77%)');
        expect(line).toContain('hit <strong>2 of 8</strong> weeks');
        expect(line).toContain('down $24.70');
        expect(line).toContain('stat-negative');
        expect(view.recordLine({ wins: 3, losses: 1, pushes: 0, units: 1.8, hitPct: 75, slips: 0 }, 6)).toContain('up $18');
    });

    test('leaves out the slip count when no week had six graded picks', () => {
        expect(view.recordLine({ wins: 3, losses: 1, pushes: 0, units: 1, hitPct: 75, slips: 0, slipsHit: 0 }, 6)).not.toContain('slip');
    });
});

describe('suggested parlay', () => {
    const ids = [1, 2, 3, 4];
    const data = { picks: [
        pick({ gameId: 1, odds: -250, winProb: 0.75 }),
        pick({ gameId: 2, odds: -200, winProb: 0.7, homeTeam: 'Iowa' }),
        pick({ gameId: 3, odds: -300, winProb: 0.8, homeTeam: 'Ohio State', started: true }),
        pick({ gameId: 4, odds: -400, winProb: 0.85, homeTeam: 'Georgia' })
    ] };

    test('takes the top open picks, one per leg, skipping games already started', () => {
        const p = view.suggestedParlay(data, ids, 3);
        expect(p.legs.map(l => l.gameId)).toEqual([1, 2, 4]);
    });

    test('multiplies the prices and the chances', () => {
        const p = view.suggestedParlay(data, ids, 2);
        // -250 → 1.4, -200 → 1.5: 2.1 decimal, +110.
        expect(p.decimal).toBeCloseTo(2.1, 10);
        expect(p.american).toBe(110);
        expect(p.hitProb).toBeCloseTo(0.75 * 0.7, 10);
    });

    test('pays the stake back plus winnings, like the slip\'s Payout', () => {
        const p = view.suggestedParlay(data, ids, 2);
        expect(view.parlayPayout(p, 20)).toBe(42);
        expect(view.parlayPayLine(p, 20)).toContain('Payout <strong>$42</strong>');
        expect(view.summaryLine(p, 20)).toBe('2 legs · $20 pays <strong>$42</strong>');
        expect(view.summaryLine(null, 20)).toBe('Nothing likely enough yet');
        expect(view.parlayPayLine(p, 20)).toContain('(+110)');
    });

    test('a short-priced slip quotes negative odds', () => {
        const p = view.suggestedParlay({ picks: [pick({ odds: -400 })] }, [1], 1);
        expect(p.american).toBe(-400);
    });

    test('the card defaults to a $20 wager and says how often it hits', () => {
        const html = view.render(data, ids, { canUse, legCount: 2 });
        expect(html).toContain('Suggested parlay · 2 legs');
        expect(html).toContain('value="20"');
        expect(html).toContain('Payout <strong>$42</strong>');
        // 0.75 x 0.70 = 0.525; Math.round on the float lands on 52.
        expect(html).toContain('hit about <strong>52%</strong>');
        expect(html).toContain('about 1 in 2 weeks');
    });

    test('says so when there aren\'t enough likely bets for every member', () => {
        const html = view.render(data, ids, { canUse, legCount: 6 });
        expect(html).toContain('Only 3 of 6 legs');
    });

    test('no open picks, no card', () => {
        expect(view.suggestedParlay({ picks: [pick({ started: true })] }, [1], 6)).toBeNull();
        expect(view.render({ picks: [] }, [], { canUse })).not.toContain('Suggested parlay');
    });
});
