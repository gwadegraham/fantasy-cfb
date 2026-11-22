// Which poll's ranks the team page, Standings and My Team show for a game.
// Nov 2026: Texas's "Up next" game (week 13, no doc yet) showed AP #8 while the
// newest doc (week 12) had the committee at #5.
const { ranksFor } = require('../public/poll-pick.js');

const doc = (week, polls, season = 2026) => ({ season, week, polls });
const AP = (ranks) => ({ poll: 'AP Top 25', ranks });
const CFP = (ranks) => ({ poll: 'Playoff Committee Rankings', ranks });
const rankOf = (ranks, school) => (ranks.find(r => r.school === school) || {}).rank;

const RANKINGS = [
    doc(11, [AP([{ rank: 20, school: 'South Carolina' }])]),
    doc(12, [AP([{ rank: 8, school: 'Texas' }]), CFP([{ rank: 5, school: 'Texas' }, { rank: 21, school: 'South Carolina' }])])
];

describe('ccPollPick.ranksFor', () => {
    it('a week with no doc yet reads the newest doc, committee first', () => {
        expect(rankOf(ranksFor(RANKINGS, 13, 'regular', 2026), 'Texas')).toBe(5);
    });

    it("a week with its own doc uses it, committee over AP", () => {
        expect(rankOf(ranksFor(RANKINGS, 12, 'regular', 2026), 'South Carolina')).toBe(21);
    });

    it('falls back to AP when that week has no committee poll', () => {
        expect(rankOf(ranksFor(RANKINGS, 11, 'regular', 2026), 'South Carolina')).toBe(20);
    });

    it('postseason reads week 16 only, and is empty without it', () => {
        expect(ranksFor(RANKINGS, 1, 'postseason', 2026)).toEqual([]);
        const withFinal = RANKINGS.concat([doc(16, [CFP([{ rank: 2, school: 'Texas' }])])]);
        expect(rankOf(ranksFor(withFinal, 1, 'postseason', 2026), 'Texas')).toBe(2);
    });

    it('ignores another season, and survives junk input', () => {
        const mixed = [doc(13, [CFP([{ rank: 1, school: 'Texas' }])], 2025)].concat(RANKINGS);
        expect(rankOf(ranksFor(mixed, 13, 'regular', 2026), 'Texas')).toBe(5);
        expect(ranksFor(undefined, 12, 'regular', 2026)).toEqual([]);
        expect(ranksFor({ message: 'nope' }, 12, 'regular', 2026)).toEqual([]);
    });
});
