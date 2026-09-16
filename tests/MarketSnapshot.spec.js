// Point-in-time copies of the projection's team inputs. The reconstruction path
// is the load-bearing one: the enrichment job overwrites spRating in place but
// appends to spHistory, so a truthful draft-time baseline can only be built by
// reading the history — by the time anyone asks, the live value has moved.

const { snapshotTeam, buildSnapshotTeams, teamsByIdFromSnapshot } = require('../modules/market-snapshot');

const season = 2026;
const oregon = {
    id: 2483, school: 'Oregon', alternateNames: ['Ducks'], conference: 'Big Ten',
    seasons: [{
        season, conference: 'Big Ten', spRating: 23.9, spRank: 7, expectedWins: 10.5,
        cfpMakeOdds: -320, cfpChampOdds: 750,
        spHistory: [{ week: 1, rating: 29.2, rank: 2 }, { week: 2, rating: 23.9, rank: 7 }]
    }]
};
const noHistory = {
    id: 99, school: 'Nohist', conference: 'MAC',
    seasons: [{ season, conference: 'MAC', spRating: 3, expectedWins: 6 }]
};
const empty = { id: 7, school: 'Empty', seasons: [{ season, conference: 'SEC' }] };

describe('snapshotTeam', () => {
    it('copies the live values when no week is asked for', () => {
        const r = snapshotTeam(oregon, season);
        expect(r).toMatchObject({ id: 2483, spRating: 23.9, spRank: 7, expectedWins: 10.5,
                                  cfpMakeOdds: -320, cfpChampOdds: 750, conference: 'Big Ten' });
    });

    it('reconstructs SP+ from history for a past week', () => {
        const r = snapshotTeam(oregon, season, { spWeek: 1 });
        expect(r.spRating).toBe(29.2);
        expect(r.spRank).toBe(2);
        // The market and win-total fields are not weekly, so they stay as stored.
        expect(r.cfpMakeOdds).toBe(-320);
        expect(r.expectedWins).toBe(10.5);
    });

    it('falls back to the live rating when a team has no history for that week', () => {
        expect(snapshotTeam(noHistory, season, { spWeek: 1 }).spRating).toBe(3);
    });

    it('can be told to drop the rating instead of falling back', () => {
        expect(snapshotTeam(noHistory, season, { spWeek: 1, requireSpWeek: true }).spRating).toBeUndefined();
    });

    it('reads nothing from a season the team has no row for', () => {
        expect(snapshotTeam(oregon, 2099).spRating).toBeUndefined();
    });
});

describe('buildSnapshotTeams', () => {
    it('keeps teams with any input and drops the ones with none', () => {
        const rows = buildSnapshotTeams([oregon, noHistory, empty], season);
        expect(rows.map(r => r.id).sort((a, b) => a - b)).toEqual([99, 2483]);
    });

    it('survives junk entries', () => {
        expect(buildSnapshotTeams([null, undefined, {}, oregon], season)).toHaveLength(1);
    });

    it('applies the week reconstruction across the pool', () => {
        const rows = buildSnapshotTeams([oregon], season, { spWeek: 1 });
        expect(rows[0].spRating).toBe(29.2);
    });
});

describe('teamsByIdFromSnapshot', () => {
    it('round-trips into the shape the projection engine reads', () => {
        const snap = { teams: buildSnapshotTeams([oregon], season, { spWeek: 1 }) };
        const byId = teamsByIdFromSnapshot(snap, season);
        const t = byId['2483'];
        expect(t.school).toBe('Oregon');
        expect(t.alternateNames).toEqual(['Ducks']);
        // seasonVal() in draft-projection.js reads through seasons[], so the
        // restored doc has to carry a row for exactly this season.
        const s = t.seasons.find(x => Number(x.season) === season);
        expect(s).toMatchObject({ spRating: 29.2, expectedWins: 10.5, cfpMakeOdds: -320, conference: 'Big Ten' });
    });

    it('answers an empty map for a missing or empty snapshot', () => {
        expect(teamsByIdFromSnapshot(null, season)).toEqual({});
        expect(teamsByIdFromSnapshot({ teams: [] }, season)).toEqual({});
    });
});
