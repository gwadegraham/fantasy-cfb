// Single source of truth for the two leagues' scoring models.
//
// Phase 1 made point VALUES configurable. Phase 2 makes the STRUCTURE
// configurable within a fixed vocabulary (see scoring-detectors.js): a
// commissioner can edit each rule's points, enable/disable postseason events,
// and flip the regular-win combine mode ('first' = priority, 'sum' = additive).
//
// A model's STRUCTURE (which conditions exist, their order, additive flags, the
// default combine mode) is code-owned. The commissioner's overrides are just:
// point `values`, a `combineMode`, and a `disabled` list of postseason
// condition keys. resolveConfig() merges overrides onto the model defaults so a
// partial/absent config always yields a valid, fully-populated config.

// --- default point values (match the historical hardcoded engine exactly) ---

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

// --- structural definitions ---------------------------------------------
//
// regularWin: ordered rules combined per `combineMode`. Under 'first' the first
//   matching rule's points win (Claunts: a conference win scores 2 even vs a
//   ranked team). Under 'sum' the points of every matching rule are added
//   (Graham: base + conference + ranked + upset bonuses stack).
// postseason: ordered independent events. The engine walks them in order and a
//   non-`additive` match stops evaluation — this reproduces the old elif
//   precedence (e.g. a Rose Bowl quarterfinal scores the CFP value, not a bowl
//   appearance). `additive: true` rules add their points and keep going.
//
// `condition` is the detector key (scoring-detectors.js CONDITIONS); `pointsKey`
// indexes the point value; `label` drives the admin form and rules page.

const STRUCTURES = {
    claunts: {
        combineMode: 'first',
        regularWin: [
            { condition: 'conferenceWin', pointsKey: 'confWin', label: 'Conference win' },
            { condition: 'nonConfRankedWin', pointsKey: 'nonConfWinRanked', label: 'Non-conference win vs. ranked opponent' },
            { condition: 'baseWin', pointsKey: 'nonConfWinUnranked', label: 'Non-conference win vs. unranked opponent' }
        ],
        postseason: [
            { condition: 'cfpQuarterfinal', pointsKey: 'cfpQuarterfinal', label: 'CFP Quarterfinal appearance' },
            { condition: 'cfpSemifinal', pointsKey: 'cfpSemifinal', label: 'CFP Semifinal appearance' },
            { condition: 'nationalChampionship', pointsKey: 'nationalChampionship', label: 'National Championship appearance' },
            { condition: 'cfpFirstRoundLoss', pointsKey: 'cfpAppearance', label: 'CFP appearance (first-round exit)' },
            { condition: 'bowlAppearance', pointsKey: 'bowlAppearance', label: 'Non-playoff bowl appearance', additive: true },
            { condition: 'bowlWin', pointsKey: 'bowlWin', label: 'Non-playoff bowl win' },
            { condition: 'confChampionship', pointsKey: 'confChampionship', label: 'Conference championship win' }
        ]
    },
    graham: {
        combineMode: 'sum',
        regularWin: [
            { condition: 'baseWin', pointsKey: 'baseWin', label: 'Non-con win vs. unranked opponent' },
            { condition: 'confBonus', pointsKey: 'confBonus', label: 'Conference win vs. unranked opponent', additive: true },
            { condition: 'rankedTop25Bonus', pointsKey: 'rankedTop25Bonus', label: 'Win vs. opponent ranked #11–25', additive: true },
            { condition: 'rankedTop10Bonus', pointsKey: 'rankedTop10Bonus', label: 'Win vs. opponent ranked #1–10', additive: true },
            { condition: 'nonP5UpsetBonus', pointsKey: 'nonP5UpsetBonus', label: 'Non P5 team beats a P5 team', additive: true }
        ],
        postseason: [
            { condition: 'cfpFirstRound', pointsKey: 'cfpFirstRound', label: 'CFP First Round appearance' },
            { condition: 'cfpQuarterfinalTop4Bonus', pointsKey: 'cfpQuarterfinalTop4Bonus', label: 'CFP Quarterfinal — top-4 seed bye bonus', additive: true },
            { condition: 'cfpQuarterfinal', pointsKey: 'cfpQuarterfinal', label: 'CFP Quarterfinal appearance' },
            { condition: 'cfpSemifinal', pointsKey: 'cfpSemifinal', label: 'CFP Semifinal appearance' },
            { condition: 'nationalChampionshipWin', pointsKey: 'nationalChampionship', label: 'National Championship win' },
            { condition: 'bowlWin', pointsKey: 'bowlWin', label: 'Non-playoff bowl win' },
            { condition: 'confChampionship', pointsKey: 'confChampionship', label: 'Conference championship win' }
        ]
    }
};

const MODELS = {
    claunts: { defaults: CLAUNTS_DEFAULTS, structure: STRUCTURES.claunts },
    graham: { defaults: GRAHAM_DEFAULTS, structure: STRUCTURES.graham }
};

// Claunts = V1 engine, Graham = V2 engine. Unknown leagues default to Claunts.
function modelForLeague(league) {
    return league === 'graham-league' ? 'graham' : 'claunts';
}

// The leagues surfaced in the navbar switcher (array order = display order).
// One place to add or rename a league instead of hardcoding <a> tags in the
// navbar partial; codes map to the scoring engines via modelForLeague().
const LEAGUES = [
    { code: 'claunts-league', name: 'Claunts League' },
    { code: 'graham-league', name: 'Graham League' }
];

// Flat, ordered field metadata for the admin form + rules page. Regular-win
// fields carry group 'regular'; postseason fields group 'postseason' and are
// toggleable (enable/disable). `enabled` reflects the resolved `disabled` set.
function fieldsForModel(model, disabled) {
    const structure = (MODELS[model] || MODELS.claunts).structure;
    const off = new Set(disabled || []);
    const regular = structure.regularWin.map(r => ({
        key: r.pointsKey, condition: r.condition, label: r.label,
        additive: !!r.additive, group: 'regular', toggleable: false, enabled: true
    }));
    const post = structure.postseason.map(r => ({
        key: r.pointsKey, condition: r.condition, label: r.label,
        additive: !!r.additive, group: 'postseason', toggleable: true, enabled: !off.has(r.condition)
    }));
    return regular.concat(post);
}

// Returns a fully-resolved config for a league:
//   { model, combineMode, values, disabled }
// merging any provided overrides over the model defaults.
function resolveConfig(league, overrides) {
    const model = (overrides && overrides.model && MODELS[overrides.model]) ? overrides.model : modelForLeague(league);
    const modelDef = MODELS[model] || MODELS.claunts;
    const combineMode = (overrides && (overrides.combineMode === 'sum' || overrides.combineMode === 'first'))
        ? overrides.combineMode
        : modelDef.structure.combineMode;
    const disabled = (overrides && Array.isArray(overrides.disabled)) ? overrides.disabled.slice() : [];
    return {
        model,
        combineMode,
        values: Object.assign({}, modelDef.defaults, (overrides && overrides.values) || {}),
        disabled
    };
}

module.exports = {
    CLAUNTS_DEFAULTS, GRAHAM_DEFAULTS, STRUCTURES, MODELS, LEAGUES,
    modelForLeague, fieldsForModel, resolveConfig
};
