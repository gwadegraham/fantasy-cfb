const { withRetry } = require('../modules/retry');

describe('withRetry', () => {
    beforeEach(() => {
        jest.spyOn(console, 'log').mockImplementation(() => {});
    });
    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('returns the result on first success without retrying', async () => {
        const fn = jest.fn().mockResolvedValue('ok');

        await expect(withRetry(fn, { retries: 3, baseDelayMs: 1 })).resolves.toBe('ok');
        expect(fn).toHaveBeenCalledTimes(1);
    });

    it('retries after transient failures and then succeeds', async () => {
        const fn = jest.fn()
            .mockRejectedValueOnce(new Error('boom 1'))
            .mockRejectedValueOnce(new Error('boom 2'))
            .mockResolvedValue('ok');

        await expect(withRetry(fn, { retries: 3, baseDelayMs: 1 })).resolves.toBe('ok');
        expect(fn).toHaveBeenCalledTimes(3);
    });

    it('throws the last error after exhausting all retries', async () => {
        const fn = jest.fn().mockRejectedValue(new Error('persistent failure'));

        await expect(withRetry(fn, { retries: 2, baseDelayMs: 1 })).rejects.toThrow('persistent failure');
        expect(fn).toHaveBeenCalledTimes(2);
    });
});
