// The pure half of the Captain lock reminder: who is due, and what the
// notification says. modules/push-notify.js does the fan-out (covered in
// tests/CaptainReminderNotify.spec.js); nothing here touches a DB or a push
// service.

const {
    LEAD_MS, isDue, alreadySent, timeLeftLabel, buildCaptainReminderPayload
} = require('../modules/captain-reminder');

const ms = iso => Date.parse(iso);
const LOCK = ms('2026-09-26T23:30:00Z');          // a 6:30pm CT Saturday kickoff
const H = 3600 * 1000;

describe('isDue', () => {
    it('is due once the lock is within the lead time', () => {
        expect(isDue(LOCK, LOCK - 2 * H, LEAD_MS)).toBe(true);
        expect(isDue(LOCK, LOCK - 30 * 60000, LEAD_MS)).toBe(true);
    });

    it('is not due before the window opens', () => {
        expect(isDue(LOCK, LOCK - 2 * H - 1, LEAD_MS)).toBe(false);
        expect(isDue(LOCK, LOCK - 6 * H, LEAD_MS)).toBe(false);
        expect(isDue(LOCK, LOCK - 48 * H, LEAD_MS)).toBe(false);
    });

    // The window stays open for the whole run-up rather than closing after one
    // tick's width. A job run lost to a deploy or a restart would otherwise drop
    // the reminder outright, and a reminder that only sometimes arrives is worse
    // than one that arrives late.
    it('stays due through the run-up, so a missed tick still delivers', () => {
        const everyThirtyMin = [];
        for (let t = LOCK - 2 * H; t < LOCK; t += 30 * 60 * 1000) everyThirtyMin.push(isDue(LOCK, t, LEAD_MS));
        // Four ticks inside a two-hour window. A band one tick wide would have
        // three chances a week to miss the alert outright.
        expect(everyThirtyMin).toHaveLength(4);
        expect(everyThirtyMin.every(Boolean)).toBe(true);
    });

    it('stops at the lock — a pick that has already locked is not reminded', () => {
        expect(isDue(LOCK, LOCK, LEAD_MS)).toBe(false);
        expect(isDue(LOCK, LOCK + 60000, LEAD_MS)).toBe(false);
    });

    it('treats a missing or unusable lock as not due', () => {
        expect(isDue(null, Date.now(), LEAD_MS)).toBe(false);
        expect(isDue(NaN, Date.now(), LEAD_MS)).toBe(false);
        expect(isDue(undefined, Date.now(), LEAD_MS)).toBe(false);
    });

    it('defaults to the two-hour lead when none is passed', () => {
        expect(LEAD_MS).toBe(2 * H);
        expect(isDue(LOCK, LOCK - 1 * H)).toBe(true);
        expect(isDue(LOCK, LOCK - 3 * H)).toBe(false);
    });
});

describe('alreadySent', () => {
    const log = [{ season: 2026, week: 4 }, { season: 2025, week: 9 }];

    it('matches on season AND week', () => {
        expect(alreadySent(log, 2026, 4)).toBe(true);
        expect(alreadySent(log, 2026, 9)).toBe(false);   // right week, wrong season
        expect(alreadySent(log, 2025, 4)).toBe(false);
    });

    it('compares numerically, so a stored string still counts as sent', () => {
        expect(alreadySent([{ season: '2026', week: '4' }], 2026, 4)).toBe(true);
    });

    it('handles an empty or absent log', () => {
        expect(alreadySent([], 2026, 4)).toBe(false);
        expect(alreadySent(undefined, 2026, 4)).toBe(false);
        expect(alreadySent([null], 2026, 4)).toBe(false);
    });
});

// Rounding DOWN is the whole point: a manager told "2 hours" who actually has
// 1h50m can act on the wrong number and lose the pick.
describe('timeLeftLabel', () => {
    it('never claims more time than is left', () => {
        expect(timeLeftLabel(LOCK, LOCK - (2 * H - 10 * 60000))).toBe('1.5 hours');
        expect(timeLeftLabel(LOCK, LOCK - (2 * H - 60000))).toBe('1.5 hours');
    });

    it('reads the way a person would say it', () => {
        expect(timeLeftLabel(LOCK, LOCK - 2 * H)).toBe('2 hours');
        expect(timeLeftLabel(LOCK, LOCK - 1 * H)).toBe('1 hour');
        expect(timeLeftLabel(LOCK, LOCK - 90 * 60000)).toBe('1.5 hours');
        expect(timeLeftLabel(LOCK, LOCK - 40 * 60000)).toBe('40 minutes');
    });

    it('never says "0 minutes" while time remains', () => {
        expect(timeLeftLabel(LOCK, LOCK - 60000)).toBe('1 minute');
        expect(timeLeftLabel(LOCK, LOCK - 7 * 60000)).toBe('5 minutes');
        expect(timeLeftLabel(LOCK, LOCK)).toBe('now');
        expect(timeLeftLabel(LOCK, LOCK + H)).toBe('now');
    });
});

describe('buildCaptainReminderPayload', () => {
    const base = { week: 5, lockMs: LOCK, nowMs: LOCK - 2 * H };

    it('names the pick a manager already set, and says it can still change', () => {
        const p = buildCaptainReminderPayload(Object.assign({}, base, {
            currentPick: { id: 1, school: 'Miami' }, autoPick: null
        }));
        expect(p.body).toBe('Miami is your Captain for week 5. Change it within 2 hours.');
        expect(p.teamId).toBe(1);
    });

    // The alert has to answer "do I need to do anything?" from a lock screen.
    // Saying only "no pick yet" sends everyone into the app to find out what the
    // default would have been.
    it('names the auto-captain default when no pick is set', () => {
        const p = buildCaptainReminderPayload(Object.assign({}, base, {
            currentPick: null, autoPick: { id: 2, school: 'Georgia' }
        }));
        expect(p.body).toBe('No pick yet for week 5 — Georgia goes in by default. 2 hours to change it.');
        expect(p.teamId).toBe(2);
    });

    it('still sends something useful when neither is resolvable', () => {
        const p = buildCaptainReminderPayload(Object.assign({}, base, { currentPick: null, autoPick: null }));
        expect(p.body).toContain('week 5');
        expect(p.teamId).toBeNull();
    });

    it('quotes the real time left, not the two-hour constant', () => {
        const p = buildCaptainReminderPayload(Object.assign({}, base, {
            nowMs: LOCK - 40 * 60000, currentPick: { id: 1, school: 'Miami' }
        }));
        expect(p.body).toContain('40 minutes');
        expect(p.body).not.toContain('2 hours');
    });

    it('carries the type the mute switch reads and a per-week tag', () => {
        const p = buildCaptainReminderPayload(Object.assign({}, base, { currentPick: { id: 1, school: 'Miami' } }));
        expect(p.type).toBe('captainLock');
        expect(p.tag).toBe('captain-lock-w5');
    });

    // Tapping the notification has to land on the picker. The service worker
    // navigates to payload.url verbatim, and public/userHome.js opens the
    // Captain drawer on this hash.
    it('deep links into the Captain drawer', () => {
        const p = buildCaptainReminderPayload(Object.assign({}, base, { currentPick: { id: 1, school: 'Miami' } }));
        expect(p.url).toBe('/#captain');
    });
});
