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
        expect(html).toContain('The top <strong>120 teams</strong> by preseason T-Rank');
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

// Rankings Used was football copy for every league — "AP Poll until the CFP
// Poll" — on a basketball league ranked by T-Rank / adjusted efficiency / NET.
describe('Rankings Used', () => {
    const { BANDS } = require('../modules/hoops-quadrants');

    function renderPage(draftRules) {
        const cfg = resolveConfig('graham-league', null);
        const locals = {
            user: {}, userState: null, cfg, leagueCode: 'graham-league', engagement: null,
            fields: fieldsForModel(cfg.model, cfg.disabled, cfg.enabled), draftRules
        };
        const html = ejs.render(fs.readFileSync(VIEW, 'utf8'), locals,
            { filename: VIEW, includer: () => ({ template: '' }) });
        const start = html.indexOf('Rankings Used');
        return html.slice(start, html.indexOf('</section>', start)).replace(/\s+/g, ' ');
    }

    it('a basketball league never mentions the football polls', () => {
        const html = renderPage({ sport: 'basketball', poolSize: 120, totalRounds: 10 });
        expect(html).not.toMatch(/AP Poll|CFP/);
        expect(html).toContain('NCAA NET');
    });

    it('the quadrant table matches the bands scoring uses', () => {
        const html = renderPage({ sport: 'basketball', poolSize: 120, totalRounds: 10 });
        const row = (q, lo) => ['home', 'neutral', 'away']
            .map(v => `${v[0].toUpperCase()}${v.slice(1)} ${lo(v)}–${BANDS[v][q - 1]}`).join(' · ');
        expect(html).toContain(row(1, () => 1));
        expect(html).toContain(row(2, v => BANDS[v][0] + 1));
        expect(html).toContain(row(3, v => BANDS[v][1] + 1));
    });

    it('football keeps the AP → CFP copy', () => {
        const html = renderPage({ sport: 'football', poolSize: null, totalRounds: 10 });
        expect(html).toContain('<strong>AP Poll</strong> until the <strong>CFP Poll</strong>');
        expect(html).not.toContain('NCAA NET');
    });
});

// The hoops page used to borrow football mechanics — "base points plus every
// bonus", one undifferentiated Captain/H2H line — and never said the NCAA
// ladder stacks. Each line below is what modules/hoops-detectors.js does.
describe('Basketball page reads basketball mechanics', () => {
    function hoopsPage(engagement) {
        const cfg = resolveConfig('hoops-league', { model: 'hoops' });
        const html = ejs.render(fs.readFileSync(VIEW, 'utf8'), {
            user: {}, userState: null, cfg, leagueCode: 'hoops-league', engagement,
            fields: fieldsForModel(cfg.model, cfg.disabled, cfg.enabled),
            draftRules: { sport: 'basketball', poolSize: 120, totalRounds: 10 }
        }, { filename: VIEW, includer: () => ({ template: '' }) });
        return html.slice(html.indexOf('rules-container')).replace(/\s+/g, ' ');
    }
    const modes = { h2hEnabled: true, h2hWinBonus: 3, h2hTieBonus: 0, captainEnabled: true, captainMultiplier: 2 };

    it('a win scores one quadrant, not base points plus bonuses', () => {
        const html = hoopsPage(null);
        expect(html).toContain('Each win scores <strong>one quadrant</strong>');
        expect(html).not.toContain('base points');
        expect(html).not.toContain('highest-priority');
    });

    it('shows the conference title stacks note and the ladder stacking', () => {
        const html = hoopsPage(null);
        expect(html).toContain('Added on top of the quadrant win for the final itself.');
        expect(html).toContain('collects every round along the way');
        expect(html).toContain('Reached the first round (Round of 64)');
    });

    it('game modes say they skip conference tournaments and March', () => {
        const html = hoopsPage(modes);
        expect(html).toContain('each regular-season week you');
        expect(html).toContain('before your first team tips off');
        expect(html).not.toContain('kickoff');
    });
});

// The football lines were audited against modules/scoring-detectors.js:
// regular-win rules all require isRegular and exclude conference title games,
// the "power" list is four conferences (or the league's own), the Claunts
// title game pays win or lose, and Captain/H2H skip the postseason.
describe('Football page matches the football engine', () => {
    const { POWER_CONFERENCES } = require('../modules/scoring-detectors');
    const modes = { h2hEnabled: true, h2hWinBonus: 3, h2hTieBonus: 0, captainEnabled: true, captainMultiplier: 2 };

    function footballPage(code, extra) {
        const cfg = resolveConfig(code, null);
        const html = ejs.render(fs.readFileSync(VIEW, 'utf8'), Object.assign({
            user: {}, userState: null, cfg, leagueCode: code, engagement: modes,
            fields: fieldsForModel(cfg.model, cfg.disabled, cfg.enabled),
            draftRules: { sport: 'football', poolSize: null, totalRounds: 10 }
        }, extra), { filename: VIEW, includer: () => ({ template: '' }) });
        return html.slice(html.indexOf('rules-container')).replace(/\s+/g, ' ');
    }

    it('Graham names the power conferences, not "P5"', () => {
        const html = footballPage('graham-league', { powerConferences: POWER_CONFERENCES });
        expect(html).not.toContain('P5');
        expect(html).toContain('Non-power team beats a power-conference team');
        expect(html).toContain('Power conferences: ACC, Big 12, Big Ten, SEC.');
    });

    it("follows a league's own power list", () => {
        const html = footballPage('graham-league', { powerConferences: ['ACC', 'Big 12', 'Big Ten', 'SEC', 'FBS Independents'] });
        expect(html).toContain('SEC, FBS Independents.');
    });

    it('stacking and base points are regular-season only', () => {
        const html = footballPage('graham-league', {});
        expect(html).toContain('a regular-season win earns the base points');
        expect(html).toContain('Any regular-season win (base points)');
        expect(html).toContain('a deep run adds up the points for every round played');
    });

    it('Claunts title game pays win or lose', () => {
        expect(footballPage('claunts-league', {})).toContain('National Championship appearance (win or lose)');
    });

    it('game modes say regular season only, with kickoff wording', () => {
        const html = footballPage('claunts-league', {});
        expect(html).toContain('each regular-season week you');
        expect(html).toContain('before your first kickoff');
        expect(html).toContain('No Captain in bowls or the CFP.');
        expect(html).not.toContain('tips off');
    });
});
