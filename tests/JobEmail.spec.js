const nodemailer = require('nodemailer');
const { buildJobEmailHtml, sendJobEmail } = require('../modules/job-mailer');
const { emailOnSuccess } = require('../modules/score-job');

describe('emailOnSuccess (scoring jobs are failure-only by default)', () => {
    const prev = process.env.JOB_EMAIL_ON_SUCCESS;
    afterEach(() => {
        if (prev === undefined) delete process.env.JOB_EMAIL_ON_SUCCESS;
        else process.env.JOB_EMAIL_ON_SUCCESS = prev;
    });

    it('defaults to off (no email on a healthy run)', () => {
        delete process.env.JOB_EMAIL_ON_SUCCESS;
        expect(emailOnSuccess()).toBe(false);
    });

    it('opts in only for the exact string "true"', () => {
        process.env.JOB_EMAIL_ON_SUCCESS = 'true';
        expect(emailOnSuccess()).toBe(true);
        process.env.JOB_EMAIL_ON_SUCCESS = 'yes';
        expect(emailOnSuccess()).toBe(false);
    });
});

describe('buildJobEmailHtml', () => {
    it('renders a success run report with the stat rows', () => {
        const html = buildJobEmailHtml({
            label: 'Daily Update',
            when: '7/17/2026, 11:00:00 PM',
            ok: true,
            rows: [['Season', 'regular 2025'], ['Week', '16'], ['Games', '7 new · 305 updated'], ['Teams', '138'], ['Duration', '41s']]
        });
        expect(html).toContain('Update complete');
        expect(html).toContain('Daily Update');
        expect(html).toContain('regular 2025');
        expect(html).toContain('7 new · 305 updated');
        expect(html).toContain('138');
        expect(html).not.toContain('Update failed');
        expect(html).not.toContain('>Error<');
    });

    it('renders a failure report with the error block', () => {
        const html = buildJobEmailHtml({
            label: 'Saturday Update',
            when: '7/17/2026, 3:00:00 PM',
            ok: false,
            rows: [['Failed after', '8s']],
            error: 'Error: CFBD request failed (500)'
        });
        expect(html).toContain('Update failed');
        expect(html).toContain('Failed after');
        expect(html).toContain('Error: CFBD request failed (500)');
    });

    it('escapes HTML in values so an error string cannot break the markup', () => {
        const html = buildJobEmailHtml({
            label: 'Daily Update', when: 'now', ok: false, rows: [],
            error: '<script>alert(1)</script>'
        });
        expect(html).toContain('&lt;script&gt;');
        expect(html).not.toContain('<script>alert(1)</script>');
    });
});

// A spec that requires a job module and calls its real run() reaches the mailer
// with the real Gmail credentials .env just loaded (dotenv runs for anything
// that isn't NODE_ENV=production). Iterating on tests/RemoteSeason.spec.js on
// 11 Sep 2026 mailed a run of real "FAILED" reports to the inbox from a laptop.
describe('sendJobEmail under test', () => {
    afterEach(() => jest.restoreAllMocks());

    it('never opens a transport', async () => {
        const createTransport = jest.spyOn(nodemailer, 'createTransport');
        jest.spyOn(console, 'log').mockImplementation(() => {});

        await sendJobEmail({ label: 'Player Season Leaders', ok: false, error: 'boom' });

        expect(createTransport).not.toHaveBeenCalled();
    });
});
