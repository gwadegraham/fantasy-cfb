const { envNum } = require('../modules/env-num');

// Duration and threshold config for the live poller and the plays cache goes
// through here. The case worth pinning is the bad value: a NaN would make every
// comparison it feeds false, silently disabling the thing it gates.

describe('envNum', () => {
    afterEach(() => { delete process.env.TEST_ENV_NUM; });

    it('falls back when unset or blank', () => {
        expect(envNum('TEST_ENV_NUM', 120000)).toBe(120000);
        process.env.TEST_ENV_NUM = '';
        expect(envNum('TEST_ENV_NUM', 120000)).toBe(120000);
    });

    it('accepts an override', () => {
        process.env.TEST_ENV_NUM = '30000';
        expect(envNum('TEST_ENV_NUM', 120000)).toBe(30000);
    });

    it('treats 0 as a real value, not as unset', () => {
        // Callers use 0 as a kill switch — a 0 TTL means "never cache", a 0
        // quiet window means "don't debounce". Falling back here would make
        // those switches silently do nothing.
        process.env.TEST_ENV_NUM = '0';
        expect(envNum('TEST_ENV_NUM', 120000)).toBe(0);
    });

    it('falls back rather than trusting garbage', () => {
        for (const bad of ['abc', '90s', '-1', 'NaN', 'Infinity']) {
            process.env.TEST_ENV_NUM = bad;
            expect(envNum('TEST_ENV_NUM', 120000)).toBe(120000);
        }
    });
});
