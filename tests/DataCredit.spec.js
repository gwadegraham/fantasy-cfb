// The footer credits the data source the viewer's league actually uses:
// basketball leagues run on CBBD, everything else on CFBD.

const ejs = require('ejs');
const fs = require('fs');
const path = require('path');

const PARTIAL = path.join(__dirname, '..', 'views', 'partials', 'data-credit.ejs');
const template = fs.readFileSync(PARTIAL, 'utf8');
const render = (locals) => ejs.render(template, locals, { filename: PARTIAL });

describe('data-credit partial', () => {
    it('credits College Basketball Data on a basketball league', () => {
        const html = render({ viewerSport: 'basketball' });
        expect(html).toContain('href="https://collegebasketballdata.com/"');
        expect(html).toContain('Powered by College Basketball Data');
        expect(html).not.toContain('Football');
    });

    it('credits College Football Data on a football league', () => {
        const html = render({ viewerSport: 'football' });
        expect(html).toContain('href="https://collegefootballdata.com/"');
        expect(html).toContain('Powered by College Football Data');
    });

    it('falls back to football when no sport is set (signed out)', () => {
        expect(render({})).toContain('Powered by College Football Data');
    });
});
