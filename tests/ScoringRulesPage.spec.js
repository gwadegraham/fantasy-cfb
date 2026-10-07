// The Draft Rules block on /rules (views/scoringRules.ejs, #492).
//
// It was football copy for every league — "Every FBS team is available to be
// drafted" — on a basketball league whose draft is a capped pool. It now
// reads the league's own draft settings (server.js resolves them, falling
// back to the sport's defaults).

const fs = require('fs');
const path = require('path');
const ejs = require('ejs');
const { resolveConfig, fieldsForModel } = require('../modules/scoring-defaults');

const VIEW = path.join(__dirname, '..', 'views', 'scoringRules.ejs');

function render(draftRules) {
    const cfg = resolveConfig('graham-league', null);
    const locals = {
        user: {}, userState: null, cfg, leagueCode: 'graham-league', engagement: null,
        fields: fieldsForModel(cfg.model, cfg.disabled, cfg.enabled)
    };
    if (draftRules !== undefined) locals.draftRules = draftRules;
    // The navbar and favicon partials are not what is under test.
    const html = ejs.render(fs.readFileSync(VIEW, 'utf8'), locals,
        { filename: VIEW, includer: () => ({ template: '' }) });
    const start = html.indexOf('draft-section');
    return html.slice(start, html.indexOf('</section>', start)).replace(/\s+/g, ' ');
}

describe('Draft Rules', () => {
    it('tells a basketball league its own pool and rounds', () => {
        const html = render({ sport: 'basketball', poolSize: 120, totalRounds: 10 });
        expect(html).toContain('The top <strong>120 teams</strong> by preseason rank');
        expect(html).toContain('<strong>10 rounds</strong>');
        expect(html).not.toContain('FBS');
    });

    it('follows a non-default pool size', () => {
        expect(render({ sport: 'basketball', poolSize: 96, totalRounds: 12 }))
            .toContain('<strong>96 teams</strong>');
    });

    it('an uncapped basketball draft says Division I, never "null teams"', () => {
        const html = render({ sport: 'basketball', poolSize: null, totalRounds: 10 });
        expect(html).toContain('Every <strong>Division I team</strong>');
        expect(html).not.toContain('null');
    });

    it('football is unchanged', () => {
        const html = render({ sport: 'football', poolSize: null, totalRounds: 10 });
        expect(html).toContain('Every <strong>FBS team</strong> is available to be drafted');
        expect(html).not.toContain('rounds</strong>');
    });

    it('and so is a render that passes no draft rules at all', () => {
        expect(render(undefined)).toContain('Every <strong>FBS team</strong>');
    });
});
