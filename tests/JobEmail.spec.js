const { buildJobEmailHtml } = require('../modules/job-mailer');

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
