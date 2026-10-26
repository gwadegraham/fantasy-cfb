const fs = require('fs');
const path = require('path');
const { easternDay } = require('../modules/hoops-calendar');
const { JOB_SCHEDULES, LIVE_POLL_SCHEDULE, HOOPS_LIVE_POLL_SCHEDULE, livePollEnabled, TZ, toRule } = require('../modules/scheduler');

describe('scheduler config', () => {
    it('schedules the three score jobs plus enrichment (expected wins is manual)', () => {
        const jobs = JOB_SCHEDULES.map(s => s.job).sort();
        expect(jobs).toEqual(['captain-reminder', 'daily-scores', 'enrichment', 'hoops-media', 'hoops-net', 'hoops-ratings', 'hoops-schedule', 'hoops-scores', 'hoops-stats', 'hoops-styles', 'hoops-torvik', 'hoops-turnover',
            'player-season-leaders', 'recap-notice', 'saturday-scores', 'season-stats', 'sunday-scores']);
        expect(JOB_SCHEDULES.find(s => s.job === 'expected-wins')).toBeUndefined();
    });

    // Basketball scoring is nightly and costs no API calls — the games,
    // rosters and ratings are all local by the time it runs. 23:30 Central
    // is after daily-scores at 23:00 and after the late West Coast tips
    // have gone final.
    it('scores basketball nightly, after football and after the late tips', () => {
        const spec = JOB_SCHEDULES.find(s => s.job === 'hoops-scores');
        expect(spec.rule).toEqual({ hour: 23, minute: 30 });
        const daily = JOB_SCHEDULES.find(s => s.job === 'daily-scores');
        expect(spec.rule.hour * 60 + spec.rule.minute)
            .toBeGreaterThan(daily.rule.hour * 60 + daily.rule.minute);
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
        // Basketball TV: weekly, the Monday after Selection Sunday included.
        expect(byJob['hoops-media']).toEqual({ dayOfWeek: 1, hour: 6, minute: 0 });
    });

    // CBBD keeps no ratings history (#318), so the snapshot runs every day
    // and the last run of the week wins. That last run is Sunday's late one,
    // and it must still fall on SUNDAY in Eastern — the hoops calendar's
    // zone — or it lands in the next week and is written one week too far.
    it('snapshots basketball ratings every day, Sunday\'s last run still inside the Eastern week', () => {
        const spec = JOB_SCHEDULES.find(s => s.job === 'hoops-ratings');
        expect(spec.rule).toEqual({ hour: [6, 22], minute: 15 });
        expect(spec.rule.dayOfWeek).toBeUndefined();
        const rule = toRule(spec.rule);
        // Saturday 7 Nov 2026 noon Central -> the last run before the week turns.
        let next = rule.nextInvocationDate(new Date('2026-11-07T18:00:00Z'));
        next = rule.nextInvocationDate(next);
        next = rule.nextInvocationDate(next);
        // Sunday 22:15 Central, and on the hoops calendar's day that is still Sunday.
        expect(next.toISOString()).toBe('2026-11-09T04:15:00.000Z');
        expect(easternDay(next).getUTCDay()).toBe(0);
    });

    // The NET (#533) is one GET of ncaa.com a DAY — NCAA's terms make the
    // footprint the point — after NCAA's morning update, and on the same
    // Eastern day it fires in, so Sunday's run files under the right week.
    it('reads the official NET once a day, midday, inside the Eastern day', () => {
        const spec = JOB_SCHEDULES.find(s => s.job === 'hoops-net');
        expect(spec.rule).toEqual({ hour: 11, minute: 30 });
        const rule = toRule(spec.rule);
        const sunday = rule.nextInvocationDate(new Date('2026-11-08T12:00:00Z'));
        expect(sunday.toISOString()).toBe('2026-11-08T17:30:00.000Z');
        expect(easternDay(sunday).getUTCDay()).toBe(0);
    });

    // Torvik's current T-Rank: a morning run after his overnight update,
    // and an evening retry that lands Saturday night — before a Sunday
    // opener freezes week 1.
    it('pulls Torvik twice a day, the evening run on Saturday night before a Sunday opener', () => {
        const spec = JOB_SCHEDULES.find(s => s.job === 'hoops-torvik');
        expect(spec.rule).toEqual({ hour: [6, 22], minute: 20 });
        const saturday = toRule(spec.rule).nextInvocationDate(new Date('2026-10-31T20:00:00Z'));
        expect(saturday.toISOString()).toBe('2026-11-01T03:20:00.000Z');
    });

    // Style tags (#542): one leaderboard call a day at most, after the
    // morning stats import so last night's games are in it.
    it('refreshes basketball style tags once a day, after hoops-stats', () => {
        const spec = JOB_SCHEDULES.find(s => s.job === 'hoops-styles');
        expect(spec.rule).toEqual({ hour: 7, minute: 0 });
        expect(spec.modulePath).toBe('../modules/hoops-styles-job');
    });

    // Roster turnover (#541): checked every morning, but the job itself
    // decides whether to spend its two calls (weekly before tip-off).
    it('checks basketball roster turnover every morning', () => {
        const spec = JOB_SCHEDULES.find(s => s.job === 'hoops-turnover');
        expect(spec.rule).toEqual({ hour: 7, minute: 10 });
        expect(spec.modulePath).toBe('../modules/hoops-turnover-job');
    });

    // The schedule look-ahead: early morning, when no basketball game is live.
    it('pulls the basketball schedule ahead every morning', () => {
        const spec = JOB_SCHEDULES.find(s => s.job === 'hoops-schedule');
        expect(spec.rule).toEqual({ hour: 6, minute: 40 });
        expect(spec.modulePath).toBe('../modules/hoops-schedule-job');
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
describe('the admin job list covers every scheduled job', () => {
    // Both admin pages draw their "Automated jobs" list from the Clipboard
    // model's JOBS (public/admin-clipboard.js). A scheduled job missing there
    // never shows on either page — so a job that needs attention would be
    // invisible. Asserted against the schedule itself.
    const { JOBS } = require('../public/admin-clipboard');
    const all = JOB_SCHEDULES.map(s => s.job).concat(LIVE_POLL_SCHEDULE.job, HOOPS_LIVE_POLL_SCHEDULE.job);
    const football = all.filter(j => !/^hoops-/.test(j));
    const basketball = all.filter(j => /^hoops-/.test(j));

    it('lists every football job on the football page', () => {
        const listed = JOBS.football.map(j => j.name);
        expect(football.filter(j => !listed.includes(j))).toEqual([]);
        expect(listed.filter(j => /^hoops-/.test(j))).toEqual([]);
    });

    it('lists every basketball job on the basketball page', () => {
        const listed = JOBS.basketball.map(j => j.name);
        expect(basketball.length).toBeGreaterThan(0);
        expect(basketball.filter(j => !listed.includes(j))).toEqual([]);
        expect(listed.filter(j => !/^hoops-/.test(j))).toEqual([]);
    });

    it('agrees with the basketball status route', () => {
        const { HOOPS_JOBS } = require('../routes/hoopsAdmin');
        expect(JOBS.basketball.map(j => j.name).sort()).toEqual([...HOOPS_JOBS].sort());
    });
});
