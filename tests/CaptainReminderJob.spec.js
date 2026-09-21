// The cron entry point (modules/captain-reminder-job.js).
//
// The thing worth pinning is the logging policy. This job ticks every 30
// minutes around the clock — 48 times a day — and almost every tick has nothing
// to do. Writing a JobRun for each one would push every other job's latest run
// out of the admin strip and bury a real failure in a column of
// nothing-happened rows. So a quiet tick logs nothing, and a tick that sends or
// fails always does.

jest.mock('../modules/push-notify', () => ({ notifyCaptainLocks: jest.fn() }));
jest.mock('../modules/job-logger', () => ({
    startRun: jest.fn(() => Promise.resolve('run-1')),
    finishRun: jest.fn(() => Promise.resolve())
}));

const pushNotify = require('../modules/push-notify');
const { startRun, finishRun } = require('../modules/job-logger');
const job = require('../modules/captain-reminder-job');

beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe('captain-reminder job', () => {
    it('exposes a stable JOB_NAME for the scheduler and the admin strip', () => {
        expect(job.JOB_NAME).toBe('captain-reminder');
    });

    it('logs a run when reminders actually went out', async () => {
        pushNotify.notifyCaptainLocks.mockResolvedValue({ due: 3, sent: 4 });

        await job.run();

        expect(startRun).toHaveBeenCalledWith('captain-reminder');
        const [, status, message] = finishRun.mock.calls[0];
        expect(status).toBe('success');
        expect(message).toContain('3 manager(s) reminded');
        expect(message).toContain('4 notification(s)');
    });

    it('writes nothing on a tick with nobody due', async () => {
        pushNotify.notifyCaptainLocks.mockResolvedValue({ due: 0, sent: 0 });

        const res = await job.run();

        expect(startRun).not.toHaveBeenCalled();
        expect(finishRun).not.toHaveBeenCalled();
        expect(res.skipped).toBe('nobody due');
    });

    it('passes through the reason when the fan-out declined to run', async () => {
        pushNotify.notifyCaptainLocks.mockResolvedValue({ due: 0, sent: 0, skipped: 'no active season' });

        const res = await job.run();

        expect(res.skipped).toBe('no active season');
        expect(startRun).not.toHaveBeenCalled();
    });

    // notifyCaptainLocks swallows its own errors, so anything reaching here is
    // a genuine break — and must not be the one outcome that leaves no trace.
    it('logs an error run and rethrows when the fan-out throws', async () => {
        pushNotify.notifyCaptainLocks.mockRejectedValue(new Error('mongo went away'));
        jest.spyOn(console, 'error').mockImplementation(() => {});

        await expect(job.run()).rejects.toThrow('mongo went away');

        expect(startRun).toHaveBeenCalledWith('captain-reminder');
        const [, status, message] = finishRun.mock.calls[0];
        expect(status).toBe('error');
        expect(message).toContain('mongo went away');
    });
});
