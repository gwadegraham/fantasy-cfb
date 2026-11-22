// The committee ranking publishes on Tuesday into a week-N poll doc we first
// stored on Monday night. Nov 2026: weeks 11 and 12 kept AP only, and every
// rank on the site (and in scoring) fell back to AP.
const { needsCfpRefresh, REFRESH_INTERVAL_MS } = require('../modules/rankings-freshness');

const NOW = Date.parse('2026-11-21T18:00:00Z');
const AP = { poll: 'AP Top 25', ranks: [] };
const CFP = { poll: 'Playoff Committee Rankings', ranks: [] };
const hoursAgo = (h) => new Date(NOW - h * 3600 * 1000).toISOString();
// An ObjectId whose embedded creation time is `h` hours before NOW.
const idHoursAgo = (h) => Math.floor((NOW - h * 3600 * 1000) / 1000).toString(16).padStart(8, '0') + '0000000000000000';

describe('needsCfpRefresh', () => {
    it('re-pulls a late-season week stored without the committee poll', () => {
        expect(needsCfpRefresh({ polls: [AP], fetchedAt: hoursAgo(4) }, 12, NOW)).toBe(true);
    });

    it('re-pulls the prod docs from the incident (no fetchedAt, aged by ObjectId)', () => {
        // week 12 doc, created 2026-11-17T05:00:07Z
        const doc = { _id: '6afbdf570000000000000000', polls: [AP] };
        expect(needsCfpRefresh(doc, 12, NOW)).toBe(true);
    });

    it('stops once the committee poll is in the doc', () => {
        expect(needsCfpRefresh({ polls: [AP, CFP], fetchedAt: hoursAgo(48) }, 12, NOW)).toBe(false);
    });

    it('throttles: no re-pull inside the interval', () => {
        const justUnder = new Date(NOW - REFRESH_INTERVAL_MS + 60000).toISOString();
        expect(needsCfpRefresh({ polls: [AP], fetchedAt: justUnder }, 12, NOW)).toBe(false);
        expect(needsCfpRefresh({ _id: idHoursAgo(1), polls: [AP] }, 12, NOW)).toBe(false);
    });

    it('never re-pulls before the committee could have published', () => {
        expect(needsCfpRefresh({ polls: [AP], fetchedAt: hoursAgo(100) }, 8, NOW)).toBe(false);
    });

    it('treats a missing or malformed doc as nothing to refresh', () => {
        expect(needsCfpRefresh(null, 12, NOW)).toBe(false);
        expect(needsCfpRefresh({ message: 'not found' }, 12, NOW)).toBe(false);
    });
});
