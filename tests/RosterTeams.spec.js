// Two roster storage shapes, one answer (#478).
//
// Football stores a full copy of each team; basketball stores { id, sport }
// resolved against that season's team row. modules/roster-teams.js is the only
// place that knows, so this is where the difference has to be pinned.
//
// The failure that matters is not an error. It is a roster that comes back
// EMPTY, or comes back describing the wrong season — both of which render
// perfectly well and are only noticed by whoever owns the team.

const { useMongo } = require('./helpers/mongo');
const Team = require('../models/team');
const HoopsTeam = require('../models/hoopsTeam');
const { rosterTeams, rosterSize, rosterEntryFor, entryFor } = require('../modules/roster-teams');

useMongo();

beforeEach(() => jest.spyOn(console, 'log').mockImplementation(() => {}));
afterEach(() => jest.restoreAllMocks());

const LOC = { venue_id: 7, name: 'V', city: 'C', state: 'ST', zip: '1',
              latitude: 1, longitude: 1, capacity: 1, grass: true, dome: false };
const fbs = (id, school, over = {}) => Object.assign({
    id, school, mascot: 'M', abbreviation: school.slice(0, 3).toUpperCase(),
    conference: 'ACC', color: '#000', logos: ['a.png'], location: LOC
}, over);
const hoops = (id, school, season, conference) => ({
    id, season, school, mascot: 'M', abbreviation: school.slice(0, 3).toUpperCase(),
    conference, color: '#000', logos: ['a.png'], preseason: { rank: id }
});

const franchise = (season, entry) => ({ seasons: [{ season, ...entry }] });

describe('football rosters are unchanged', () => {
    test('the embedded copies are returned as they are stored', async () => {
        const teams = [fbs(1, 'Alabama'), fbs(2, 'Auburn')];
        const got = await rosterTeams(franchise(2026, { teams }), 2026);
        expect(got).toEqual(teams);
    });

    test('nothing is queried for them', async () => {
        // The point of leaving football alone: no extra read, no behaviour
        // change, no risk to a collection the nightly scoring pass writes.
        const spy = jest.spyOn(Team, 'find');
        await rosterTeams(franchise(2026, { teams: [fbs(1, 'Alabama')] }), 2026);
        expect(spy).not.toHaveBeenCalled();
        spy.mockRestore();
    });
});

describe('basketball rosters resolve', () => {
    test('a reference comes back as the whole team', async () => {
        await HoopsTeam.create([hoops(10, 'Duke', 2027, 'ACC')]);
        const [team] = await rosterTeams(
            franchise(2027, { teamRefs: [{ id: 10, sport: 'basketball' }] }), 2027);
        expect(team).toMatchObject({ id: 10, school: 'Duke', conference: 'ACC', logos: ['a.png'] });
    });

    test('roster ORDER is the draft order, not whatever Mongo returns', async () => {
        // Several surfaces show the first pick without labelling it. One query
        // fetches the set; the refs put it back in order.
        await HoopsTeam.create([
            hoops(10, 'Duke', 2027, 'ACC'), hoops(20, 'Gonzaga', 2027, 'WCC'), hoops(30, 'Iowa', 2027, 'B10')
        ]);
        const refs = [30, 10, 20].map(id => ({ id, sport: 'basketball' }));
        const got = await rosterTeams(franchise(2027, { teamRefs: refs }), 2027);
        expect(got.map(t => t.school)).toEqual(['Iowa', 'Duke', 'Gonzaga']);
    });

    // THE SCENARIO THIS DESIGN HAS TO SURVIVE.
    //
    // Miami is in the ACC in 2027 and moves to the SEC in 2028. Opening the
    // 2027 roster must still say ACC — if a reference resolved against
    // "today", every historical page would silently be rewritten by a
    // conference realignment.
    test('an old roster shows that season\'s conference, not today\'s', async () => {
        await HoopsTeam.create([
            hoops(5, 'Miami', 2027, 'ACC'),
            hoops(5, 'Miami', 2028, 'SEC')
        ]);
        const refs = [{ id: 5, sport: 'basketball' }];

        const [past] = await rosterTeams(franchise(2027, { teamRefs: refs }), 2027);
        const [now] = await rosterTeams(franchise(2028, { teamRefs: refs }), 2028);

        expect(past.conference).toBe('ACC');
        expect(now.conference).toBe('SEC');
    });

    test('a ref that resolves to nothing is dropped, not left as a hole', async () => {
        // A null inside a roster array reaches every renderer as a crash. An
        // absent team reads as what it is. Logged, because it should not happen.
        await HoopsTeam.create([hoops(10, 'Duke', 2027, 'ACC')]);
        const got = await rosterTeams(franchise(2027, {
            teamRefs: [{ id: 10, sport: 'basketball' }, { id: 99, sport: 'basketball' }]
        }), 2027);
        expect(got.map(t => t.school)).toEqual(['Duke']);
        expect(console.log).toHaveBeenCalledWith(expect.stringContaining('team 99 has no 2027 row'));
    });

    test('it does not reach into another season for a missing team', async () => {
        await HoopsTeam.create([hoops(5, 'Miami', 2026, 'ACC')]);
        expect(await rosterTeams(franchise(2027, { teamRefs: [{ id: 5, sport: 'basketball' }] }), 2027))
            .toEqual([]);
    });

    test('a football ref resolves against the football collection', async () => {
        // The sport is on the REF rather than inferred from the league, so a
        // roster stays readable with a cold season cache — the failure that
        // let a basketball pick match a football team in #476.
        await Team.create([fbs(1, 'Alabama')]);
        const [team] = await rosterTeams(
            franchise(2026, { teamRefs: [{ id: 1, sport: 'football' }] }), 2026);
        expect(team.school).toBe('Alabama');
    });

    // The first version branched on `refs.some(r => r.sport === 'basketball')`,
    // so ONE basketball ref sent the whole list to HoopsTeam and silently
    // dropped every football one — logging it as a missing basketball team.
    // That is the shape #478 produces while football is half migrated.
    test('a MIXED list resolves each ref against its own sport', async () => {
        await Team.create([fbs(1, 'Alabama')]);
        await HoopsTeam.create([hoops(10, 'Duke', 2026, 'ACC')]);
        const got = await rosterTeams(franchise(2026, { teamRefs: [
            { id: 1, sport: 'football' }, { id: 10, sport: 'basketball' }
        ] }), 2026);
        expect(got.map(t => t.school)).toEqual(['Alabama', 'Duke']);
    });

    test('the two collections number teams independently, and ids do not cross', async () => {
        // Football 1 and basketball 1 are different programs. Keyed on id
        // alone, one would answer for the other.
        await Team.create([fbs(1, 'Alabama')]);
        await HoopsTeam.create([hoops(1, 'Duke', 2026, 'ACC')]);
        const got = await rosterTeams(franchise(2026, { teamRefs: [
            { id: 1, sport: 'basketball' }, { id: 1, sport: 'football' }
        ] }), 2026);
        expect(got.map(t => t.school)).toEqual(['Duke', 'Alabama']);
    });
});

describe('the empty and mixed cases', () => {
    test('a season the manager never played is an empty roster', async () => {
        expect(await rosterTeams(franchise(2026, { teams: [fbs(1, 'Alabama')] }), 1999)).toEqual([]);
    });

    test('a franchise with no seasons at all is empty, not a throw', async () => {
        expect(await rosterTeams({}, 2026)).toEqual([]);
        expect(await rosterTeams(null, 2026)).toEqual([]);
    });

    test('an entry with neither shape is empty', async () => {
        expect(await rosterTeams(franchise(2026, {}), 2026)).toEqual([]);
    });

    test('teams WINS over teamRefs, so a half-migrated document cannot double', async () => {
        // #478 will write both for a while. Returning the concatenation would
        // give a manager twenty teams; preferring the copy keeps football's
        // answer stable until its refs are the only thing left.
        await HoopsTeam.create([hoops(10, 'Duke', 2026, 'ACC')]);
        const got = await rosterTeams(franchise(2026, {
            teams: [fbs(1, 'Alabama')], teamRefs: [{ id: 10, sport: 'basketball' }]
        }), 2026);
        expect(got.map(t => t.school)).toEqual(['Alabama']);
    });
});

describe('rosterSize counts without resolving', () => {
    test('it counts either shape', () => {
        expect(rosterSize(franchise(2026, { teams: [fbs(1, 'A'), fbs(2, 'B')] }), 2026)).toBe(2);
        expect(rosterSize(franchise(2027, { teamRefs: [{ id: 1, sport: 'basketball' }] }), 2027)).toBe(1);
        expect(rosterSize(franchise(2026, {}), 2026)).toBe(0);
        expect(rosterSize({}, 2026)).toBe(0);
    });

    test('it agrees with rosterTeams on a half-migrated document', async () => {
        // Both functions must read the same roster. rosterTeams prefers the
        // embedded copy; a rosterSize that preferred refs would report two
        // teams for a manager whose roster resolves to one.
        const f = franchise(2026, {
            teams: [fbs(1, 'Alabama')],
            teamRefs: [{ id: 10, sport: 'basketball' }, { id: 20, sport: 'basketball' }]
        });
        expect(rosterSize(f, 2026)).toBe(1);
    });

    test('and it queries nothing — that is the whole reason it exists', async () => {
        const spy = jest.spyOn(HoopsTeam, 'find');
        rosterSize(franchise(2027, { teamRefs: [{ id: 1, sport: 'basketball' }] }), 2027);
        expect(spy).not.toHaveBeenCalled();
        spy.mockRestore();
    });
});

describe('rosterEntryFor decides the shape once', () => {
    test('basketball stores a reference, and only a reference', () => {
        const entry = rosterEntryFor(fbs(10, 'Duke'), 'basketball');
        expect(entry).toEqual({ id: 10, sport: 'basketball' });
    });

    test('football keeps storing the whole document', () => {
        const team = fbs(1, 'Alabama');
        expect(rosterEntryFor(team, 'football')).toBe(team);
    });

    test('an unusable id yields NO ref, rather than one carrying NaN', () => {
        // { id: NaN } fails validation for the WHOLE manager, and
        // persistTeamsToUsers only logs that — so one bad pick would cost
        // someone their entire roster.
        expect(rosterEntryFor({ id: 'abc' }, 'basketball')).toBeNull();
        expect(rosterEntryFor({}, 'basketball')).toBeNull();
        expect(rosterEntryFor({ id: 1.5 }, 'basketball')).toBeNull();
        expect(rosterEntryFor({ id: '10' }, 'basketball')).toEqual({ id: 10, sport: 'basketball' });
    });

    test('an unknown sport is treated as football, never as a lossy ref', () => {
        // Guessing "reference" for a sport we do not recognise would throw away
        // the team data; guessing "copy" keeps it. Wrong either way, but one
        // is recoverable.
        const team = fbs(1, 'Alabama');
        expect(rosterEntryFor(team, undefined)).toBe(team);
    });
});

describe('entryFor', () => {
    test('matches a season given as a string, as the stored data has been', () => {
        const f = { seasons: [{ season: '2026', teams: [] }] };
        expect(entryFor(f, 2026)).toBeTruthy();
    });
});
