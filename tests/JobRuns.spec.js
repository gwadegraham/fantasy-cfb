const { latestPerJob } = require('../modules/job-runs-util');

describe('latestPerJob', () => {
    it('returns the most recent run for each job', () => {
        const runs = [
            { jobName: 'daily-scores', startedAt: '2025-01-03T05:00:00Z', status: 'success' },
            { jobName: 'daily-scores', startedAt: '2025-01-02T05:00:00Z', status: 'error' },
            { jobName: 'saturday-scores', startedAt: '2025-01-04T20:00:00Z', status: 'success' }
        ];
        const latest = latestPerJob(runs);
        expect(latest).toHaveLength(2);
        const daily = latest.find(r => r.jobName === 'daily-scores');
        expect(daily.startedAt).toBe('2025-01-03T05:00:00Z');
        expect(daily.status).toBe('success');
    });

    it('handles empty / malformed input', () => {
        expect(latestPerJob([])).toEqual([]);
        expect(latestPerJob(undefined)).toEqual([]);
        expect(latestPerJob([{ startedAt: '2025-01-01' }])).toEqual([]); // no jobName -> skipped
    });
});
