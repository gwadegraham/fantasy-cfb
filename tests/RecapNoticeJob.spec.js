// The cron entry point (modules/recap-notice-job.js).
//
// The logging policy is the thing worth pinning. The job runs twice on a Monday
// and the evening pass is a deliberate no-op whenever the morning worked — a
// JobRun for it would be noise on the admin strip, and would push a job that
// genuinely failed further down. So a quiet run logs nothing, and a run that
// sends or fails always does.

jest.mock('../modules/push-notify', () => ({ notifyRecapReady: jest.fn() }));
jest.mock('../modules/job-logger', () => ({
    startRun: jest.fn(() => Promise.resolve('run-1')),
    finishRun: jest.fn(() => Promise.resolve())
}));

const pushNotify = require('../modules/push-notify');
const { startRun, finishRun } = require('../modules/job-logger');
const job = require('../modules/recap-notice-job');

beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe('recap-notice job', () => {
    it('exposes a stable JOB_NAME for the scheduler and the admin strip', () => {
        expect(job.JOB_NAME).toBe('recap-notice');
    });

    it('logs a run when reminders actually went out', async () => {
        pushNotify.notifyRecapReady.mockResolvedValue({ due: 3, sent: 4 });

        await job.run();

        expect(startRun).toHaveBeenCalledWith('recap-notice');
        const [, status, message] = finishRun.mock.calls[0];
        expect(status).toBe('success');
        expect(message).toContain('3 manager(s) told their recap is ready');
        expect(message).toContain('4 notification(s)');
    });

    it('writes nothing on the evening retry when the morning already sent', async () => {
        pushNotify.notifyRecapReady.mockResolvedValue({ due: 0, sent: 0 });

        const res = await job.run();

        expect(startRun).not.toHaveBeenCalled();
        expect(finishRun).not.toHaveBeenCalled();
        expect(res.skipped).toBe('nobody due');
    });

    it('passes through the reason when the fan-out declined to run', async () => {
        pushNotify.notifyRecapReady.mockResolvedValue({ due: 0, sent: 0, skipped: 'offseason' });

        const res = await job.run();

        expect(res.skipped).toBe('offseason');
        expect(startRun).not.toHaveBeenCalled();
    });

    // notifyRecapReady swallows its own errors, so anything reaching here is
    // a genuine break — and must not be the one outcome that leaves no trace.
    it('logs an error run and rethrows when the fan-out throws', async () => {
        pushNotify.notifyRecapReady.mockRejectedValue(new Error('mongo went away'));
        jest.spyOn(console, 'error').mockImplementation(() => {});

        await expect(job.run()).rejects.toThrow('mongo went away');

        expect(startRun).toHaveBeenCalledWith('recap-notice');
        const [, status, message] = finishRun.mock.calls[0];
        expect(status).toBe('error');
        expect(message).toContain('mongo went away');
    });
});
