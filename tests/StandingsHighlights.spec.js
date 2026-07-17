const { overachieverCard, draftStealCard, giantKillerCard } = require('../modules/standings-highlights');

describe('overachieverCard', () => {
    it('picks the team most over its expected wins', () => {
        const records = [
            { teamId: 1, team: 'Indiana', expectedWins: 6, total: { wins: 11 } },   // +5
            { teamId: 2, team: 'Georgia', expectedWins: 10, total: { wins: 11 } }    // +1
        ];
        const card = overachieverCard(records, { 1: { mascot: 'Hoosiers', logos: ['x.png'] } });
        expect(card.title).toBe('Overachiever');
        expect(card.name).toContain('Hoosiers');
        expect(card.value).toBe('+5 wins');
    });
    it('returns null when nobody meaningfully beat expectation', () => {
        expect(overachieverCard([{ teamId: 1, team: 'A', expectedWins: 8, total: { wins: 8 } }], {})).toBeNull();
        expect(overachieverCard([], {})).toBeNull();
    });
});

describe('draftStealCard', () => {
    it('flags the late pick that scored near the top', () => {
        const picks = [
            { overall: 1, team: { id: 1, school: 'A', mascot: 'Aces' } },
            { overall: 2, team: { id: 2, school: 'B', mascot: 'Bears' } },
            { overall: 3, team: { id: 3, school: 'C', mascot: 'Cats' } }
        ];
        // last pick (C) scored the most -> pickRank 3, scoreRank 1, edge +2
        const card = draftStealCard(picks, { 1: 10, 2: 20, 3: 40 });
        expect(card.title).toBe('Draft Steal');
        expect(card.name).toContain('Cats');
        expect(card.value).toContain('pick #3');
        expect(card.value).toContain('1st in points');
    });
    it('returns null with too few picks or no edge', () => {
        expect(draftStealCard([{ overall: 1, team: { id: 1 } }], {})).toBeNull();
        const evenPicks = [
            { overall: 1, team: { id: 1 } }, { overall: 2, team: { id: 2 } }, { overall: 3, team: { id: 3 } }
        ];
        // score order matches pick order -> no steal
        expect(draftStealCard(evenPicks, { 1: 30, 2: 20, 3: 10 })).toBeNull();
    });
});

describe('giantKillerCard', () => {
    const metaByName = { 'Vanderbilt': { mascot: 'Commodores', logos: ['v.png'] } };
    const drafted = new Set(['Vanderbilt']);
    it('finds a drafted team beating the highest-ranked opponent', () => {
        const games = [
            { homeTeam: 'Vanderbilt', awayTeam: 'Alabama', homePoints: 40, awayPoints: 35, week: 6, completed: true },
            { homeTeam: 'Vanderbilt', awayTeam: 'Kentucky', homePoints: 20, awayPoints: 13, week: 7, completed: true }
        ];
        const rankByWeek = { 6: { Alabama: 1 }, 7: { Kentucky: 18 } };  // beat #1 and #18
        const card = giantKillerCard(games, rankByWeek, drafted, metaByName);
        expect(card.title).toBe('Giant Killer');
        expect(card.name).toContain('Commodores');
        expect(card.value).toBe('beat #1 Alabama');
    });
    it('ignores wins over unranked teams and games the drafted team lost', () => {
        const games = [
            { homeTeam: 'Vanderbilt', awayTeam: 'Rice', homePoints: 50, awayPoints: 3, week: 1, completed: true },     // unranked
            { homeTeam: 'Georgia', awayTeam: 'Vanderbilt', homePoints: 44, awayPoints: 10, week: 2, completed: true }  // Vandy lost
        ];
        const rankByWeek = { 2: { Georgia: 2 } };
        expect(giantKillerCard(games, rankByWeek, drafted, metaByName)).toBeNull();
    });
    it('does not count a win where the winner was already higher-ranked (not an upset)', () => {
        const games = [{ homeTeam: 'Vanderbilt', awayTeam: 'Auburn', homePoints: 30, awayPoints: 20, week: 3, completed: true }];
        const rankByWeek = { 3: { Vanderbilt: 2, Auburn: 10 } };  // favored winner
        expect(giantKillerCard(games, rankByWeek, drafted, metaByName)).toBeNull();
    });
});
