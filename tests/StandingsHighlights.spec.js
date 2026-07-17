const { overachieverCard, draftStealCard, biggestUpsetCard } = require('../modules/standings-highlights');

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

describe('biggestUpsetCard', () => {
    const metaByName = { 'Vanderbilt': { mascot: 'Commodores', logos: ['v.png'] }, 'Northwestern': { mascot: 'Wildcats' } };
    const drafted = new Set(['Vanderbilt', 'Northwestern']);

    it('finds the drafted team that won as the biggest underdog', () => {
        const games = [
            { id: 1, homeTeam: 'Vanderbilt', awayTeam: 'Alabama', homePoints: 40, awayPoints: 35, completed: true }, // home won
            { id: 2, homeTeam: 'Ohio State', awayTeam: 'Northwestern', homePoints: 10, awayPoints: 14, completed: true } // away won
        ];
        // g1: home spread +14 -> Vanderbilt a 14-pt home dog, won.
        // g2: home spread -21 -> Ohio State favored by 21 -> Northwestern a 21-pt away dog, won.
        const spreadByGameId = { 1: 14, 2: -21 };
        const card = biggestUpsetCard(games, spreadByGameId, drafted, metaByName);
        expect(card.title).toBe('Biggest Upset');
        expect(card.name).toContain('Wildcats');           // 21 > 14
        expect(card.value).toContain('21-pt');
        expect(card.value).toContain('beat Ohio State');
    });

    it('ignores favored wins, losses, and games with no line', () => {
        const games = [
            { id: 1, homeTeam: 'Vanderbilt', awayTeam: 'Rice', homePoints: 50, awayPoints: 3, completed: true },    // favored
            { id: 2, homeTeam: 'Georgia', awayTeam: 'Vanderbilt', homePoints: 44, awayPoints: 10, completed: true }, // Vandy lost
            { id: 3, homeTeam: 'Vanderbilt', awayTeam: 'LSU', homePoints: 20, awayPoints: 17, completed: true }      // no line
        ];
        const spreadByGameId = { 1: -30, 2: -21 };   // g1 home favored; g3 absent
        expect(biggestUpsetCard(games, spreadByGameId, drafted, metaByName)).toBeNull();
    });
});
