const { JOB_SCHEDULES, LIVE_POLL_SCHEDULE, livePollEnabled, TZ, toRule } = require('../modules/scheduler');

describe('scheduler config', () => {
    it('schedules the three score jobs plus enrichment (expected wins is manual)', () => {
        const jobs = JOB_SCHEDULES.map(s => s.job).sort();
        expect(jobs).toEqual(['daily-scores', 'enrichment', 'saturday-scores', 'sunday-scores']);
        expect(JOB_SCHEDULES.find(s => s.job === 'expected-wins')).toBeUndefined();
    });

    it('keeps the live poller out of the always-on jobs (it is opt-in)', () => {
        expect(JOB_SCHEDULES.find(s => s.job === 'live-scores')).toBeUndefined();
    });

    it('live poller fires every 10 min, every day (phase gates decide), gated by env', () => {
        expect(LIVE_POLL_SCHEDULE.job).toBe('live-scores');
        // No dayOfWeek — postseason games run any day; the module's phase-aware
        // gates restrict regular-season polling to Thu/Fri/Sat.
        expect(LIVE_POLL_SCHEDULE.rule).toEqual({ minute: [0, 10, 20, 30, 40, 50] });

        const prev = process.env.LIVE_POLL_ENABLED;
        process.env.LIVE_POLL_ENABLED = 'true';
        expect(livePollEnabled()).toBe(true);
        process.env.LIVE_POLL_ENABLED = 'false';
        expect(livePollEnabled()).toBe(false);
        delete process.env.LIVE_POLL_ENABLED;
        expect(livePollEnabled()).toBe(false); // default off
        if (prev !== undefined) process.env.LIVE_POLL_ENABLED = prev;
    });

    it('matches the intended Central-time schedule', () => {
        const byJob = {};
        JOB_SCHEDULES.forEach(s => { byJob[s.job] = s.rule; });
        expect(byJob['daily-scores']).toEqual({ hour: 23, minute: 0 });
        expect(byJob['saturday-scores']).toEqual({ dayOfWeek: 6, hour: [15, 18, 22], minute: 0 });
        expect(byJob['sunday-scores']).toEqual({ dayOfWeek: 0, hour: [3, 6], minute: 0 });
        expect(byJob['enrichment']).toEqual({ dayOfWeek: 2, hour: 5, minute: 30 });
    });

    it('builds a timezone-aware recurrence rule', () => {
        expect(TZ).toBe('America/Chicago');
        const rule = toRule({ dayOfWeek: 6, hour: [15, 18, 22], minute: 0 });
        expect(rule.tz).toBe('America/Chicago');
        expect(rule.hour).toEqual([15, 18, 22]);
        expect(rule.minute).toBe(0);
        expect(rule.dayOfWeek).toBe(6);
    });

    it('leaves hour and dayOfWeek unset for the every-day live poller', () => {
        const rule = toRule(LIVE_POLL_SCHEDULE.rule);
        expect(rule.minute).toEqual([0, 10, 20, 30, 40, 50]);
        // Neither hour nor dayOfWeek assigned → node-schedule treats them as
        // "any", so the poller fires every 10 min, every day.
        expect(rule.hour == null).toBe(true);
        expect(rule.dayOfWeek == null).toBe(true);
    });
});
