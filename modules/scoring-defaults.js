// Single source of truth for the two leagues' scoring models: default point
// values (matching the historical hardcoded engine exactly) plus ordered field
// metadata that drives BOTH the admin "Configure Scoring" form and the rules
// page — so the page can never drift from the engine.

const CLAUNTS_DEFAULTS = {
    nonConfWinUnranked: 1,
    nonConfWinRanked: 3,
    confWin: 2,
    confChampionship: 6,
    bowlAppearance: 4,
    bowlWin: 5,
    cfpAppearance: 7,
    cfpQuarterfinal: 8,
    cfpSemifinal: 9,
    nationalChampionship: 10
};

const GRAHAM_DEFAULTS = {
    baseWin: 1,
    confBonus: 1,
    rankedTop25Bonus: 1,
    rankedTop10Bonus: 2,
    nonP5UpsetBonus: 2,
    confChampionship: 5,
    bowlWin: 6,
    cfpFirstRound: 6,
    cfpQuarterfinal: 6,
    cfpQuarterfinalTop4Bonus: 6,
    cfpSemifinal: 6,
    nationalChampionship: 10
};

// Ordered fields for UI + rules page. `additive: true` marks a Graham bonus
// that stacks on top of the base win (rendered with a "+").
const CLAUNTS_FIELDS = [
    { key: 'nonConfWinUnranked', label: 'Non-conference win vs. unranked opponent' },
    { key: 'nonConfWinRanked', label: 'Non-conference win vs. ranked opponent' },
    { key: 'confWin', label: 'Conference win' },
    { key: 'confChampionship', label: 'Conference championship win' },
    { key: 'bowlAppearance', label: 'Non-playoff bowl appearance' },
    { key: 'bowlWin', label: 'Non-playoff bowl win' },
    { key: 'cfpAppearance', label: 'CFP appearance' },
    { key: 'cfpQuarterfinal', label: 'CFP Quarterfinal appearance' },
    { key: 'cfpSemifinal', label: 'CFP Semifinal appearance' },
    { key: 'nationalChampionship', label: 'National Championship appearance' }
];

const GRAHAM_FIELDS = [
    { key: 'baseWin', label: 'Non-con win vs. unranked opponent' },
    { key: 'confBonus', label: 'Conference win vs. unranked opponent', additive: true },
    { key: 'rankedTop25Bonus', label: 'Win vs. opponent ranked #11–25', additive: true },
    { key: 'rankedTop10Bonus', label: 'Win vs. opponent ranked #1–10', additive: true },
    { key: 'nonP5UpsetBonus', label: 'Non P5 team beats a P5 team', additive: true },
    { key: 'confChampionship', label: 'Conference championship win' },
    { key: 'bowlWin', label: 'Non-playoff bowl win' },
    { key: 'cfpFirstRound', label: 'CFP First Round appearance' },
    { key: 'cfpQuarterfinal', label: 'CFP Quarterfinal appearance' },
    { key: 'cfpQuarterfinalTop4Bonus', label: 'CFP Quarterfinal — top-4 seed bye bonus' },
    { key: 'cfpSemifinal', label: 'CFP Semifinal appearance' },
    { key: 'nationalChampionship', label: 'National Championship win' }
];

const MODELS = {
    claunts: { defaults: CLAUNTS_DEFAULTS, fields: CLAUNTS_FIELDS },
    graham: { defaults: GRAHAM_DEFAULTS, fields: GRAHAM_FIELDS }
};

// Claunts = V1 engine, Graham = V2 engine. Unknown leagues default to Claunts.
function modelForLeague(league) {
    return league === 'graham-league' ? 'graham' : 'claunts';
}

// Returns { model, values } for a league, merging any provided overrides over
// the model defaults (so a partial/absent config still yields valid values).
function resolveConfig(league, overrides) {
    const model = (overrides && overrides.model) || modelForLeague(league);
    const base = MODELS[model] ? MODELS[model].defaults : CLAUNTS_DEFAULTS;
    return {
        model,
        values: Object.assign({}, base, (overrides && overrides.values) || {})
    };
}

module.exports = {
    CLAUNTS_DEFAULTS, GRAHAM_DEFAULTS, CLAUNTS_FIELDS, GRAHAM_FIELDS,
    MODELS, modelForLeague, resolveConfig
};
