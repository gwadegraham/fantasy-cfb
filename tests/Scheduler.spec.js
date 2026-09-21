const fs = require('fs');
const path = require('path');
const { JOB_SCHEDULES, LIVE_POLL_SCHEDULE, livePollEnabled, TZ, toRule } = require('../modules/scheduler');

describe('scheduler config', () => {
    it('schedules the three score jobs plus enrichment (expected wins is manual)', () => {
        const jobs = JOB_SCHEDULES.map(s => s.job).sort();
        expect(jobs).toEqual(['captain-reminder', 'daily-scores', 'enrichment', 'player-season-leaders',
            'recap-notice', 'saturday-scores', 'season-stats', 'sunday-scores']);
        expect(JOB_SCHEDULES.find(s => s.job === 'expected-wins')).toBeUndefined();
    });

    // The reminder lead is six hours, so the sweep only has to be fine-grained
    // enough that a manager is never first seen AFTER their lock. Half-hourly,
    // with the window in modules/captain-reminder.js open for the whole run-up.
    it('sweeps for captain locks every 30 minutes, around the clock', () => {
        const spec = JOB_SCHEDULES.find(s => s.job === 'captain-reminder');
        expect(spec.rule).toEqual({ minute: [0, 30] });
        expect(spec.rule.hour).toBeUndefined();     // unset = every hour
        expect(spec.rule.dayOfWeek).toBeUndefined();

        const rule = toRule(spec.rule);
        const first = rule.nextInvocationDate(new Date('2026-09-12T18:05:00.000Z'));
        const second = rule.nextInvocationDate(first);
        expect(second.getTime() - first.getTime()).toBe(30 * 60 * 1000);
    });

    it('keeps the live poller out of the always-on jobs (it is opt-in)', () => {
        expect(JOB_SCHEDULES.find(s => s.job === 'live-scores')).toBeUndefined();
    });

    it('live poller fires every 10s, every day (games-live gate decides), gated by env', () => {
        expect(LIVE_POLL_SCHEDULE.job).toBe('live-scores');
        expect(LIVE_POLL_SCHEDULE.rule).toEqual({ second: [0, 10, 20, 30, 40, 50] });
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

    it('leaves minute, hour and dayOfWeek unset for the every-10s live poller', () => {
        const rule = toRule(LIVE_POLL_SCHEDULE.rule);
        expect(rule.second).toEqual([0, 10, 20, 30, 40, 50]);
        expect(rule.minute == null).toBe(true);
        expect(rule.hour == null).toBe(true);
        expect(rule.dayOfWeek == null).toBe(true);
    });

    // node-schedule's RecurrenceRule defaults second to 0, so a spec that omits
    // it fires once a minute rather than 60 times. Asserted because the poller's
    // 10s cadence relies on the inverse of it.
    it('does not set second for a job that omits it', () => {
        expect(toRule({ hour: 23, minute: 0 }).second).toBe(0);
    });

    // The scheduler has to honor an actual firing, not just carry the field:
    // second is the one recurrence unit nothing else in the app uses.
    it('produces a rule that really fires 10s apart', () => {
        const rule = toRule(LIVE_POLL_SCHEDULE.rule);
        const from = new Date('2026-09-12T18:00:05.000Z');
        const first = rule.nextInvocationDate(from);
        const second = rule.nextInvocationDate(first);
        expect(first.getUTCSeconds()).toBe(10);
        expect(second.getTime() - first.getTime()).toBe(10000);
    });

    // The minute rollover is the one place a seconds list can go wrong: :50 has
    // to hand off to the next minute's :00, not wait a full minute for it.
    it('rolls over the minute boundary without a gap', () => {
        const rule = toRule(LIVE_POLL_SCHEDULE.rule);
        const at50 = rule.nextInvocationDate(new Date('2026-09-12T18:00:45.000Z'));
        const next = rule.nextInvocationDate(at50);
        expect(at50.getUTCSeconds()).toBe(50);
        expect(next.getUTCSeconds()).toBe(0);
        expect(next.getTime() - at50.getTime()).toBe(10000);
    });
});

// Every scheduled job writes a JobRun (via modules/score-job.js makeJob or its
// own startRun/finishRun), and the admin page's "Automated jobs" strip is the
// only place anyone sees them. Two tables in public/admin.js decide what that
// strip shows, and both were missing season-stats and player-season-leaders:
// an unlabelled job renders under its raw jobName, and one missing from `order`
// sorts to indexOf -1 and jumps ahead of the scoring jobs. Neither failure is
// visible from the server side, so assert it against the file itself.
describe('admin job strip covers every scheduled job', () => {
    const adminSrc = fs.readFileSync(path.join(__dirname, '..', 'public', 'admin.js'), 'utf8');

    // The jobs the scheduler can register: the always-on set plus the opt-in
    // live poller.
    const scheduled = JOB_SCHEDULES.map(s => s.job).concat(LIVE_POLL_SCHEDULE.job);

    function literal(name) {
        const m = adminSrc.match(new RegExp('var ' + name + '\\s*=\\s*([\\s\\S]*?);'));
        expect(m).not.toBeNull();
        return m[1];
    }

    it('labels every scheduled job', () => {
        const labels = literal('JOB_LABELS');
        const unlabelled = scheduled.filter(j => !labels.includes(`'${j}'`));
        expect(unlabelled).toEqual([]);
    });

    it('gives every scheduled job a sort position', () => {
        const order = adminSrc.match(/var order = \[([\s\S]*?)\];/);
        expect(order).not.toBeNull();
        const unordered = scheduled.filter(j => !order[1].includes(`'${j}'`));
        expect(unordered).toEqual([]);
    });
});
