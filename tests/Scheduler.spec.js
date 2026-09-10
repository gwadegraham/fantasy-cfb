const { JOB_SCHEDULES, LIVE_POLL_SCHEDULE, livePollEnabled, TZ, toRule } = require('../modules/scheduler');

describe('scheduler config', () => {
    it('schedules the three score jobs plus enrichment (expected wins is manual)', () => {
        const jobs = JOB_SCHEDULES.map(s => s.job).sort();
        expect(jobs).toEqual(['daily-scores', 'enrichment', 'player-season-leaders', 'saturday-scores', 'season-stats', 'sunday-scores']);
        expect(JOB_SCHEDULES.find(s => s.job === 'expected-wins')).toBeUndefined();
    });

    it('keeps the live poller out of the always-on jobs (it is opt-in)', () => {
        expect(JOB_SCHEDULES.find(s => s.job === 'live-scores')).toBeUndefined();
    });

    it('live poller fires every 30s, every day (games-live gate decides), gated by env', () => {
        expect(LIVE_POLL_SCHEDULE.job).toBe('live-scores');
        expect(LIVE_POLL_SCHEDULE.rule).toEqual({ second: [0, 30] });
        // Minute and hour stay unset on purpose: a minute list would pin the
        // poller to those minutes instead of running all the time.
        expect(LIVE_POLL_SCHEDULE.rule.minute == null).toBe(true);

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
        expect(byJob['saturday-scores']).toEqual({ dayOfWeek: 6, hour: [10, 15, 18, 22], minute: 0 });
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

    it('leaves minute, hour and dayOfWeek unset for the every-30s live poller', () => {
        const rule = toRule(LIVE_POLL_SCHEDULE.rule);
        expect(rule.second).toEqual([0, 30]);
        expect(rule.minute == null).toBe(true);
        expect(rule.hour == null).toBe(true);
        expect(rule.dayOfWeek == null).toBe(true);
    });

    // node-schedule's RecurrenceRule defaults second to 0, so a spec that omits
    // it fires once a minute rather than 60 times. Asserted because the poller's
    // 30s cadence relies on the inverse of it.
    it('does not set second for a job that omits it', () => {
        expect(toRule({ hour: 23, minute: 0 }).second).toBe(0);
    });

    // The scheduler has to honor an actual firing, not just carry the field:
    // second is the one recurrence unit nothing else in the app uses.
    it('produces a rule that really fires 30s apart', () => {
        const rule = toRule(LIVE_POLL_SCHEDULE.rule);
        const from = new Date('2026-09-12T18:00:05.000Z');
        const first = rule.nextInvocationDate(from);
        const second = rule.nextInvocationDate(first);
        expect(first.getUTCSeconds()).toBe(30);
        expect(second.getTime() - first.getTime()).toBe(30000);
    });
});
