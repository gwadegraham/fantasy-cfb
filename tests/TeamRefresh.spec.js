const { teamsById, applyTeamFields, sameArray } = require('../modules/team-refresh');

describe('teamsById', () => {
    test('maps team id -> source team object', () => {
        const map = teamsById([{ id: 333, school: 'Alabama' }, { id: 239, school: 'Baylor' }]);
        expect(map[333].school).toBe('Alabama');
        expect(map[239].school).toBe('Baylor');
    });
    test('skips teams without an id', () => {
        expect(teamsById([{ school: 'x' }, null])).toEqual({});
    });
});

describe('sameArray', () => {
    test('true only when arrays match element-for-element', () => {
        expect(sameArray(['a', 'b'], ['a', 'b'])).toBe(true);
        expect(sameArray(['a', 'b'], ['a', 'c'])).toBe(false);
        expect(sameArray(['a'], ['a', 'b'])).toBe(false);
        expect(sameArray(undefined, ['a'])).toBe(false);
    });
});

describe('applyTeamFields', () => {
    const NEW_LOGOS = ['https://cdn.collegefootballdata.com/logos-dark/500/333.png'];
    const src333 = {
        id: 333, school: 'Louisiana State', mascot: 'Tigers', abbreviation: 'LSU',
        color: '#461D7C', alt_color: '#FDD023', twitter: '@LSUfootball',
        logos: NEW_LOGOS, alternateNames: ['LSU', 'Louisiana State']
    };

    test('overwrites the synced display fields, including a renamed school', () => {
        const teams = [{ id: 333, school: 'Louisiana St.', mascot: 'Tigers', logos: ['old.png'] }];
        const changed = applyTeamFields(teams, teamsById([src333]));
        expect(changed).toBe(1);
        expect(teams[0].school).toBe('Louisiana State');   // rename flows through
        expect(teams[0].logos).toEqual(NEW_LOGOS);
        expect(teams[0].abbreviation).toBe('LSU');
        expect(teams[0].alternateNames).toEqual(['LSU', 'Louisiana State']);
    });

    test('re-running is a no-op (idempotent)', () => {
        const teams = [{ id: 333, school: 'Louisiana State', mascot: 'Tigers', abbreviation: 'LSU',
            color: '#461D7C', alt_color: '#FDD023', twitter: '@LSUfootball',
            logos: NEW_LOGOS.slice(), alternateNames: ['LSU', 'Louisiana State'] }];
        expect(applyTeamFields(teams, teamsById([src333]))).toBe(0);
    });

    test('does NOT touch conference/division/id (year-sensitive or the join key)', () => {
        const teams = [{ id: 333, school: 'Old', conference: 'SEC (2024)', division: 'West' }];
        applyTeamFields(teams, teamsById([{ id: 333, school: 'New', conference: 'SEC', division: 'None' }]));
        expect(teams[0].id).toBe(333);
        expect(teams[0].conference).toBe('SEC (2024)');
        expect(teams[0].division).toBe('West');
    });

    test('leaves teams not in the map untouched', () => {
        const teams = [{ id: 999, school: 'Keep' }];
        expect(applyTeamFields(teams, teamsById([src333]))).toBe(0);
        expect(teams[0].school).toBe('Keep');
    });

    test('copies arrays (no shared reference back to the source)', () => {
        const teams = [{ id: 333, logos: ['old'] }];
        applyTeamFields(teams, teamsById([src333]));
        expect(teams[0].logos).toEqual(NEW_LOGOS);
        expect(teams[0].logos).not.toBe(NEW_LOGOS);
    });

    test('handles empty / missing inputs', () => {
        expect(applyTeamFields([], teamsById([src333]))).toBe(0);
        expect(applyTeamFields(undefined, {})).toBe(0);
    });
});
