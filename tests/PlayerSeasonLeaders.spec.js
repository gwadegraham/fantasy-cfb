const { pivotPlayers, pickLeaders, CATEGORY_DEFS } = require('../routes/player-season-leaders');

describe('player season leaders pivot + pick', () => {
    const memphisRows = [
        { playerId: 1, player: 'Seth Henigan', position: 'QB', team: 'Memphis', category: 'passing', statType: 'YDS', stat: '612' },
        { playerId: 1, player: 'Seth Henigan', position: 'QB', team: 'Memphis', category: 'passing', statType: 'TD', stat: '4' },
        { playerId: 1, player: 'Seth Henigan', position: 'QB', team: 'Memphis', category: 'passing', statType: 'ATT', stat: '78' },
        { playerId: 1, player: 'Seth Henigan', position: 'QB', team: 'Memphis', category: 'passing', statType: 'COMPLETIONS', stat: '52' },
        { playerId: 1, player: 'Seth Henigan', position: 'QB', team: 'Memphis', category: 'passing', statType: 'INT', stat: '1' },
        { playerId: 1, player: 'Seth Henigan', position: 'QB', team: 'Memphis', category: 'passing', statType: 'PCT', stat: '66.7' },

        { playerId: 2, player: 'Mario Anderson Jr.', position: 'RB', team: 'Memphis', category: 'rushing', statType: 'YDS', stat: '180' },
        { playerId: 2, player: 'Mario Anderson Jr.', position: 'RB', team: 'Memphis', category: 'rushing', statType: 'CAR', stat: '30' },
        { playerId: 2, player: 'Mario Anderson Jr.', position: 'RB', team: 'Memphis', category: 'rushing', statType: 'TD', stat: '2' },
        { playerId: 2, player: 'Mario Anderson Jr.', position: 'RB', team: 'Memphis', category: 'rushing', statType: 'YPC', stat: '6.0' },

        { playerId: 3, player: 'Roc Taylor', position: 'RB', team: 'Memphis', category: 'rushing', statType: 'YDS', stat: '90' },
        { playerId: 3, player: 'Roc Taylor', position: 'RB', team: 'Memphis', category: 'rushing', statType: 'CAR', stat: '15' },
        { playerId: 3, player: 'Roc Taylor', position: 'RB', team: 'Memphis', category: 'rushing', statType: 'TD', stat: '1' },
        { playerId: 3, player: 'Roc Taylor', position: 'RB', team: 'Memphis', category: 'rushing', statType: 'YPC', stat: '6.0' },

        { playerId: 4, player: 'Kevin Davis', position: 'LB', team: 'Memphis', category: 'defensive', statType: 'TOT', stat: '16' },
        { playerId: 4, player: 'Kevin Davis', position: 'LB', team: 'Memphis', category: 'defensive', statType: 'SOLO', stat: '10' },
        { playerId: 4, player: 'Kevin Davis', position: 'LB', team: 'Memphis', category: 'defensive', statType: 'TFL', stat: '2' },
        { playerId: 4, player: 'Kevin Davis', position: 'LB', team: 'Memphis', category: 'defensive', statType: 'SACKS', stat: '1.5' },
        { playerId: 4, player: 'Kevin Davis', position: 'LB', team: 'Memphis', category: 'defensive', statType: 'QB HUR', stat: '3' },

        { playerId: 5, player: 'Chandler Martin', position: 'DB', team: 'Memphis', category: 'interceptions', statType: 'INT', stat: '2' },
        { playerId: 5, player: 'Chandler Martin', position: 'DB', team: 'Memphis', category: 'interceptions', statType: 'YDS', stat: '30' },
        { playerId: 5, player: 'Chandler Martin', position: 'DB', team: 'Memphis', category: 'interceptions', statType: 'TD', stat: '0' },

        { playerId: 6, player: 'Jake Wilding', position: 'K', team: 'Memphis', category: 'kicking', statType: 'FGM', stat: '3' },
        { playerId: 6, player: 'Jake Wilding', position: 'K', team: 'Memphis', category: 'kicking', statType: 'FGA', stat: '4' },
        { playerId: 6, player: 'Jake Wilding', position: 'K', team: 'Memphis', category: 'kicking', statType: 'XPM', stat: '5' },
        { playerId: 6, player: 'Jake Wilding', position: 'K', team: 'Memphis', category: 'kicking', statType: 'XPA', stat: '5' },
        { playerId: 6, player: 'Jake Wilding', position: 'K', team: 'Memphis', category: 'kicking', statType: 'PTS', stat: '14' }
    ];

    it('pivots flat rows into per-team per-category player maps', () => {
        const byTeam = pivotPlayers(memphisRows);
        expect(Object.keys(byTeam)).toEqual(['Memphis']);
        expect(Object.keys(byTeam.Memphis)).toEqual(
            expect.arrayContaining(['passing', 'rushing', 'defensive', 'interceptions', 'kicking'])
        );
        expect(byTeam.Memphis.passing[1].name).toBe('Seth Henigan');
        expect(byTeam.Memphis.passing[1].stats.YDS).toBe(612);
    });

    it('picks top 2 leaders per category sorted by the right stat', () => {
        const byTeam = pivotPlayers(memphisRows);
        const leaders = pickLeaders(byTeam.Memphis);

        expect(leaders.passing).toHaveLength(1);
        expect(leaders.passing[0].name).toBe('Seth Henigan');
        expect(leaders.passing[0].YDS).toBe(612);
        expect(leaders.passing[0].TD).toBe(4);
        expect(leaders.passing[0].PCT).toBe(67);

        expect(leaders.rushing).toHaveLength(2);
        expect(leaders.rushing[0].name).toBe('Mario Anderson Jr.');
        expect(leaders.rushing[1].name).toBe('Roc Taylor');

        expect(leaders.tackles[0].name).toBe('Kevin Davis');
        expect(leaders.tackles[0].TOT).toBe(16);

        expect(leaders.sacks[0].name).toBe('Kevin Davis');
        expect(leaders.sacks[0].SACKS).toBe(1.5);

        expect(leaders.interceptions[0].name).toBe('Chandler Martin');
        expect(leaders.interceptions[0].INT).toBe(2);

        expect(leaders.kicking[0].name).toBe('Jake Wilding');
        expect(leaders.kicking[0].PTS).toBe(14);
    });

    it('filters out sack leaders with 0 sacks', () => {
        const rows = [
            { playerId: 10, player: 'Zero Sack', position: 'DL', team: 'Test', category: 'defensive', statType: 'SACKS', stat: '0' },
            { playerId: 10, player: 'Zero Sack', position: 'DL', team: 'Test', category: 'defensive', statType: 'TOT', stat: '8' }
        ];
        const byTeam = pivotPlayers(rows);
        const leaders = pickLeaders(byTeam.Test);
        expect(leaders.sacks).toHaveLength(0);
        expect(leaders.tackles).toHaveLength(1);
    });

    it('returns empty arrays when a category has no data', () => {
        const rows = [
            { playerId: 1, player: 'QB Only', position: 'QB', team: 'Sparse', category: 'passing', statType: 'YDS', stat: '200' }
        ];
        const byTeam = pivotPlayers(rows);
        const leaders = pickLeaders(byTeam.Sparse);
        expect(leaders.rushing).toEqual([]);
        expect(leaders.interceptions).toEqual([]);
        expect(leaders.kicking).toEqual([]);
    });

    it('defines 7 leader categories', () => {
        expect(Object.keys(CATEGORY_DEFS)).toHaveLength(7);
    });
});
