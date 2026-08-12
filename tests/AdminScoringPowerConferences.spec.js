/**
 * @jest-environment jsdom
 *
 * Browser-side tests for the upset-bonus power-conference control in
 * public/admin.js.
 *
 * The control is a rule PARAMETER sitting inside the rule list, which is exactly
 * where it can go wrong: saveScoringConfig() harvests every `.scoring-toggle` in
 * that container into the disabled/enabled RULE lists, keyed by data-condition.
 * A parameter checkbox wearing that class would push a null condition into
 * `disabled` and switch a real scoring rule off. That regression is silent in
 * the UI and invisible to the route tests, so it is asserted directly below.
 *
 * public/admin.js is a classic script, so `require` would keep its functions in
 * a module scope where nothing can reach them. It's evaluated into the global
 * scope instead, which is how the browser actually runs it.
 */

const fs = require('fs');
const path = require('path');

const FIELDS = [
    { key: 'baseWin', condition: 'baseWin', label: 'Any win (base points)', group: 'regular', toggleable: false, defaultOff: false, enabled: true, additive: false },
    { key: 'confBonus', condition: 'confBonus', label: 'Conference win', group: 'regular', toggleable: false, defaultOff: false, enabled: true, additive: true },
    { key: 'nonP5UpsetBonus', condition: 'nonP5UpsetBonus', label: 'Non P5 team beats a P5 team', group: 'regular', toggleable: false, defaultOff: false, enabled: true, additive: true },
    { key: 'bowlWin', condition: 'bowlWin', label: 'Non-playoff bowl win', group: 'postseason', toggleable: true, defaultOff: false, enabled: true, additive: false }
];
const BASE = ['ACC', 'Big 12', 'Big Ten', 'SEC'];
const POWER_PLUS = BASE.concat('FBS Independents');

function loadAdmin() {
    const jq = () => new Proxy(function () {}, { get: () => jq, apply: () => jq });
    global.$ = global.jQuery = Object.assign(jq, { fn: {}, ajax: () => {}, each: () => {} });
    global.Toastify = () => ({ showToast: () => {}, options: {} });
    global.ccIcon = () => '';
    global.ccLogo = () => '';
    global.io = () => ({ on: () => {}, emit: () => {} });
    document.body.innerHTML =
        '<div scoring-config-fields></div>' +
        '<p scoring-config-note style="display:none"></p>' +   // saveScoringConfig writes its status here
        '<form id="scoring-config-form"></form>';
    const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'admin.js'), 'utf8');
    (0, eval)(src);                                   // indirect eval → global scope
    // Toasts are built from a Toastify() call the stub above doesn't reach.
    global.successToast = global.failToast = { options: {}, showToast: () => {} };
    global.getDraftLeagueCode = () => 'graham-league';
    global.getShape = () => 'graham';
    global.applyScoringConfig = () => {};
    global.renderShapeExample = () => {};
}

function setConfig(powerConferences) {
    global.scoringConfigData = {
        model: 'graham', combineMode: 'sum',
        values: { baseWin: 1, confBonus: 1, nonP5UpsetBonus: 2, bowlWin: 6 },
        fields: FIELDS, powerConferencesBase: BASE, powerConferences
    };
    global.renderScoringFields();
}

const box = () => document.getElementById('power-independents');

beforeEach(() => { jest.resetModules(); loadAdmin(); });

describe('power-conference control rendering', () => {
    it('renders under the upset-bonus rule, not as a rule of its own', () => {
        setConfig(undefined);
        expect(box()).not.toBeNull();
        // It follows the rule it modifies rather than floating elsewhere.
        const rows = [...document.querySelectorAll('[scoring-config-fields] .scoring-field')];
        const upset = rows.findIndex(r => r.getAttribute('data-condition') === 'nonP5UpsetBonus');
        const param = rows.findIndex(r => r.contains(box()));
        expect(upset).toBeGreaterThanOrEqual(0);
        expect(param).toBe(upset + 1);
        // A parameter has no points stepper.
        expect(rows[param].querySelector('.num-stepper')).toBeNull();
    });

    it('reflects whether independents are already counted', () => {
        setConfig(undefined);
        expect(box().checked).toBe(false);
        setConfig(POWER_PLUS);
        expect(box().checked).toBe(true);
        setConfig(BASE);
        expect(box().checked).toBe(false);
    });

    it('is NOT harvested as a scoring rule toggle', () => {
        setConfig(POWER_PLUS);
        expect(box().classList.contains('scoring-toggle')).toBe(false);
        const conditions = [...document.querySelectorAll('[scoring-config-fields] .scoring-toggle')]
            .map(cb => cb.getAttribute('data-condition'));
        expect(conditions).not.toContain(null);
        expect(conditions).toEqual(['bowlWin']);
    });

    it('is hidden for a model with no upset rule', () => {
        global.scoringConfigData = {
            model: 'claunts', values: { baseWin: 1 },
            fields: [{ key: 'baseWin', condition: 'baseWin', label: 'Win', group: 'regular', enabled: true }],
            powerConferencesBase: BASE
        };
        global.renderScoringFields();
        expect(box()).toBeNull();
    });
});

describe('what the save sends', () => {
    async function save() {
        let body = null;
        global.fetch = jest.fn((url, opts) => {
            body = JSON.parse(opts.body);
            return Promise.resolve({ status: 200, json: () => Promise.resolve(global.scoringConfigData) });
        });
        await global.saveScoringConfig();
        return body;
    }

    it('sends the base list plus independents when ticked', async () => {
        setConfig(undefined);
        box().checked = true;
        expect((await save()).powerConferences).toEqual(POWER_PLUS);
    });

    it('sends null when un-ticked, so the server clears it', async () => {
        setConfig(POWER_PLUS);
        box().checked = false;
        expect((await save()).powerConferences).toBeNull();
    });

    it('never spells conference names itself — it builds on the server list', async () => {
        setConfig(undefined);
        global.scoringConfigData.powerConferencesBase = ['Only Conference'];
        box().checked = true;
        expect((await save()).powerConferences).toEqual(['Only Conference', 'FBS Independents']);
    });

    it('leaves the real rule toggles alone', async () => {
        setConfig(POWER_PLUS);
        box().checked = true;
        const body = await save();
        expect(body.disabled).toEqual([]);
        expect(body.enabled).toEqual([]);
        expect(body.values).toMatchObject({ baseWin: 1, nonP5UpsetBonus: 2 });
    });
});
