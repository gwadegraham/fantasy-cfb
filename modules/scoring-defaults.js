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

const { sportForLeague } = require('./active-season');

const CLAUNTS_DEFAULTS = {
    nonConfWinUnranked: 1,
    nonConfWinRanked: 3,
    confWin: 2,
    // Optional finer categories (off by default; starting values a commissioner
    // can tune before enabling).
    confWinRanked: 3,
    confWinTop25: 3,
    confWinTop10: 4,
    nonConfWinTop25: 3,
    nonConfWinTop10: 4,
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


// Basketball (#316). A 31-game season, so flat per-win scoring would make the
// title an aggregate win-total contest decided at the draft, and would pay the
// same for hosting a 300-ranked team as for winning at Duke. Quadrants are the
// sport's own answer — see modules/hoops-quadrants.js for the table.
//
// The spread these produce is the design working: a 26-5 top-10 team scores
// around 57, a 19-12 bubble team around 41, and a 24-7 mid-major around 10.
const HOOPS_DEFAULTS = {
    q1Win: 5,
    q2Win: 3,
    q3Win: 1,
    q4Win: 0,
    // The only rule that subtracts, which is why it is off unless a league
    // opts in.
    badLoss: -2,

    confTournamentTitle: 10,

    // A CUMULATIVE ladder: each rung is an appearance and they stack, so a
    // champion banks 7+9+12+16+21+26 for the six games played, plus 35 for
    // winning the last one — 126 in all. Scaled for 12-team rosters.
    ncaaR64: 7,
    ncaaR32: 9,
    ncaaS16: 12,
    ncaaE8: 16,
    ncaaF4: 21,
    ncaaTitleGame: 26,
    ncaaChampion: 35,

    // PER SEED, not a flat bonus: the rule scales by how many seeds better
    // the beaten team was, so a 12 over a 5 is worth 7. Football structurally
    // cannot do this rule — the CFP has no comparable seeding spread, and its
    // bracket needs a notes-string parse where CBBD carries seeds natively.
    seedUpsetBonus: 1
};

// --- structural definitions ---------------------------------------------
//
// regularWin: ordered rules combined per `combineMode`. Under 'first' the first
//   matching rule's points win (Claunts: a conference win scores 2 even vs a
//   ranked team). Under 'sum' the points of every matching rule are added
//   (Graham: base + conference + ranked + upset bonuses stack).
// postseason: ordered independent events. The engine walks them in ARRAY order
//   and a non-`additive` match stops evaluation — this reproduces the old elif
//   precedence (e.g. a Rose Bowl quarterfinal scores the CFP value, not a bowl
//   appearance). `additive: true` rules add their points and keep going. This
//   array order is EVALUATION order and must not be reshuffled for cosmetics.
//   `displayOrder` gives the chronological order the UI lists events in
//   (conference championship -> bowls -> playoff rounds), independent of the
//   engine order; `stacksNote` explains an additive event on the admin form.
//
// `condition` is the detector key (scoring-detectors.js CONDITIONS); `pointsKey`
// indexes the point value; `label` drives the admin form and rules page.

const STRUCTURES = {
    claunts: {
        combineMode: 'first',
        // Ordered most-specific -> most-general (first match wins). The tiered /
        // ranked conference + non-conference categories are optional (defaultOff)
        // so Claunts scores exactly as before until a commissioner opts in; when
        // enabled they sit above the flat categories and take precedence.
        regularWin: [
            { condition: 'confWinTop10', pointsKey: 'confWinTop10', label: 'Conference win vs. opponent ranked #1–10', toggleable: true, defaultOff: true, rankGroup: 'conference' },
            { condition: 'confWinTop25', pointsKey: 'confWinTop25', label: 'Conference win vs. opponent ranked #11–25', toggleable: true, defaultOff: true, rankGroup: 'conference' },
            { condition: 'confRankedWin', pointsKey: 'confWinRanked', label: 'Conference win vs. a ranked opponent', toggleable: true, defaultOff: true, rankGroup: 'conference', rankFlat: true },
            { condition: 'conferenceWin', pointsKey: 'confWin', label: 'Conference win' },
            { condition: 'nonConfWinTop10', pointsKey: 'nonConfWinTop10', label: 'Non-conference win vs. opponent ranked #1–10', toggleable: true, defaultOff: true, rankGroup: 'nonconference' },
            { condition: 'nonConfWinTop25', pointsKey: 'nonConfWinTop25', label: 'Non-conference win vs. opponent ranked #11–25', toggleable: true, defaultOff: true, rankGroup: 'nonconference' },
            { condition: 'nonConfRankedWin', pointsKey: 'nonConfWinRanked', label: 'Non-conference win vs. ranked opponent', toggleable: true, rankGroup: 'nonconference', rankFlat: true },
            { condition: 'baseWin', pointsKey: 'nonConfWinUnranked', label: 'Non-conference win vs. unranked opponent' }
        ],
        postseason: [
            { condition: 'cfpQuarterfinal', pointsKey: 'cfpQuarterfinal', label: 'CFP Quarterfinal appearance', displayOrder: 5 },
            { condition: 'cfpSemifinal', pointsKey: 'cfpSemifinal', label: 'CFP Semifinal appearance', displayOrder: 6 },
            { condition: 'nationalChampionship', pointsKey: 'nationalChampionship', label: 'National Championship appearance', displayOrder: 7 },
            { condition: 'cfpFirstRoundLoss', pointsKey: 'cfpAppearance', label: 'CFP appearance (first-round exit)', displayOrder: 4 },
            { condition: 'bowlAppearance', pointsKey: 'bowlAppearance', label: 'Non-playoff bowl appearance', additive: true, displayOrder: 2, stacksNote: 'A bowl win also earns these bowl-appearance points.' },
            { condition: 'bowlWin', pointsKey: 'bowlWin', label: 'Non-playoff bowl win', displayOrder: 3 },
            { condition: 'confChampionship', pointsKey: 'confChampionship', label: 'Conference championship win', displayOrder: 1 }
        ]
    },
    graham: {
        combineMode: 'sum',
        regularWin: [
            { condition: 'baseWin', pointsKey: 'baseWin', label: 'Any win (base points)' },
            { condition: 'confBonus', pointsKey: 'confBonus', label: 'Conference win', additive: true },
            { condition: 'rankedTop25Bonus', pointsKey: 'rankedTop25Bonus', label: 'Win vs. opponent ranked #11–25', additive: true },
            { condition: 'rankedTop10Bonus', pointsKey: 'rankedTop10Bonus', label: 'Win vs. opponent ranked #1–10', additive: true },
            { condition: 'nonP5UpsetBonus', pointsKey: 'nonP5UpsetBonus', label: 'Non P5 team beats a P5 team', additive: true }
        ],
        postseason: [
            { condition: 'cfpFirstRound', pointsKey: 'cfpFirstRound', label: 'CFP First Round appearance', displayOrder: 3 },
            { condition: 'cfpQuarterfinalTop4Bonus', pointsKey: 'cfpQuarterfinalTop4Bonus', label: 'CFP Quarterfinal — top-4 seed bye bonus', additive: true, displayOrder: 5, stacksNote: 'A top-4 seed earns this on top of the CFP Quarterfinal appearance.' },
            { condition: 'cfpQuarterfinal', pointsKey: 'cfpQuarterfinal', label: 'CFP Quarterfinal appearance', displayOrder: 4 },
            { condition: 'cfpSemifinal', pointsKey: 'cfpSemifinal', label: 'CFP Semifinal appearance', displayOrder: 6 },
            { condition: 'nationalChampionshipWin', pointsKey: 'nationalChampionship', label: 'National Championship win', displayOrder: 7 },
            { condition: 'bowlWin', pointsKey: 'bowlWin', label: 'Non-playoff bowl win', displayOrder: 2 },
            { condition: 'confChampionship', pointsKey: 'confChampionship', label: 'Conference championship win', displayOrder: 1 }
        ]
    },
    hoops: {
        combineMode: 'sum',
        // Exactly one quadrant fires per game, and a loss cannot also be a
        // win, so 'sum' and 'first' would agree today. 'sum' because the
        // model is additive in spirit and a future bonus should stack.
        regularWin: [
            { condition: 'q1Win', pointsKey: 'q1Win', label: 'Quadrant 1 win' },
            { condition: 'q2Win', pointsKey: 'q2Win', label: 'Quadrant 2 win' },
            { condition: 'q3Win', pointsKey: 'q3Win', label: 'Quadrant 3 win' },
            { condition: 'q4Win', pointsKey: 'q4Win', label: 'Quadrant 4 win' },
            { condition: 'badLoss', pointsKey: 'badLoss', label: 'Quadrant 4 loss (penalty)', toggleable: true, defaultOff: true }
        ],
        // ARRAY ORDER IS EVALUATION ORDER. Every rung is additive, so a
        // tournament game sums what it matches and never falls through to the
        // quadrant rules beneath — which is correct: a tournament game is
        // scored by the round it is, not by who the opponent was.
        postseason: [
            { condition: 'ncaaChampion', pointsKey: 'ncaaChampion', label: 'NCAA championship win', additive: true, displayOrder: 9, stacksNote: 'Stacks on top of reaching the title game.' },
            { condition: 'ncaaTitleGame', pointsKey: 'ncaaTitleGame', label: 'Reached the national title game', additive: true, displayOrder: 8 },
            { condition: 'ncaaF4', pointsKey: 'ncaaF4', label: 'Reached the Final Four', additive: true, displayOrder: 7 },
            { condition: 'ncaaE8', pointsKey: 'ncaaE8', label: 'Reached the Elite Eight', additive: true, displayOrder: 6 },
            { condition: 'ncaaS16', pointsKey: 'ncaaS16', label: 'Reached the Sweet Sixteen', additive: true, displayOrder: 5 },
            { condition: 'ncaaR32', pointsKey: 'ncaaR32', label: 'Reached the second round', additive: true, displayOrder: 4 },
            { condition: 'ncaaR64', pointsKey: 'ncaaR64', label: 'Reached the NCAA tournament', additive: true, displayOrder: 3 },
            { condition: 'confTournamentTitle', pointsKey: 'confTournamentTitle', label: 'Conference tournament title', additive: true, displayOrder: 2 },
            // scaleBy multiplies the rule's points by a NUMBER off the
            // context — the only rule in the app whose value is not fixed.
            { condition: 'seedUpsetBonus', pointsKey: 'seedUpsetBonus', label: 'Upset bonus, per seed', additive: true, scaleBy: 'seedUpset', displayOrder: 1, stacksNote: 'Adds the seed difference on top of the round reached.' }
        ]
    }
};

const MODELS = {
    claunts: { defaults: CLAUNTS_DEFAULTS, structure: STRUCTURES.claunts },
    graham: { defaults: GRAHAM_DEFAULTS, structure: STRUCTURES.graham },
    hoops: { defaults: HOOPS_DEFAULTS, structure: STRUCTURES.hoops }
};

// Claunts = V1 engine, Graham = V2 engine. Unknown leagues default to Claunts.
function modelForLeague(league) {
    // The SPORT decides first. A basketball league scores on quadrants
    // whatever it is called, and the two football models are named after the
    // two football leagues only because those are the two that exist.
    if (sportForLeague(league) === 'basketball') return 'hoops';
    return league === 'graham-league' ? 'graham' : 'claunts';
}

// The leagues surfaced in the navbar switcher (array order = display order).
// One place to add or rename a league instead of hardcoding <a> tags in the
// navbar partial; codes map to the scoring engines via modelForLeague().
const LEAGUES = [
    { code: 'claunts-league', name: 'Claunts League' },
    { code: 'graham-league', name: 'Graham League' }
];

// Whether a rule is on for a config. A `defaultOff` rule is off unless its
// condition is explicitly in the `enabled` opt-in list; every other rule is on
// unless explicitly in the `disabled` list. Non-toggleable rules never appear in
// either list, so they resolve to on. Shared by the admin display and the engine
// so the two never disagree.
function ruleEnabled(rule, disabled, enabled) {
    if (rule.defaultOff) return (enabled || []).indexOf(rule.condition) !== -1;
    return (disabled || []).indexOf(rule.condition) === -1;
}

// Flat, ordered field metadata for the admin form + rules page. Each field
// carries `toggleable`, `defaultOff`, and its resolved `enabled` state (from the
// `disabled` + `enabled` lists). Regular-win fields keep engine/priority order;
// postseason fields are sorted into chronological `displayOrder` for the UI.
function fieldsForModel(model, disabled, enabled) {
    const structure = (MODELS[model] || MODELS.claunts).structure;
    const field = (r, group, extra) => Object.assign({
        key: r.pointsKey, condition: r.condition, label: r.label,
        additive: !!r.additive, group,
        toggleable: !!r.toggleable, defaultOff: !!r.defaultOff,
        // Mutual-exclusivity hints for the admin: within a rankGroup the flat
        // "vs ranked" rule and the tiered "#1-10 / #11-25" rules can't both be on.
        rankGroup: r.rankGroup || null, rankFlat: !!r.rankFlat,
        enabled: ruleEnabled(r, disabled, enabled)
    }, extra || {});
    const regular = structure.regularWin.map(r => field(r, 'regular'));
    const post = structure.postseason.map(r => field(r, 'postseason', {
        toggleable: true,                       // postseason events are always toggleable
        stacksNote: r.stacksNote || null,
        displayOrder: typeof r.displayOrder === 'number' ? r.displayOrder : 0
    })).sort((a, b) => a.displayOrder - b.displayOrder);
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
    const enabled = (overrides && Array.isArray(overrides.enabled)) ? overrides.enabled.slice() : [];
    return {
        model,
        combineMode,
        values: Object.assign({}, modelDef.defaults, (overrides && overrides.values) || {}),
        disabled,
        // Opt-in list for defaultOff rules (finer Fixed-shape win categories).
        enabled,
        // Legacy flat engagement (deprecated — see engagementBySeason). Kept in
        // the resolved shape for back-compat with any old reader.
        engagement: normalizeEngagement((overrides && overrides.engagement) || {}),
        // Raw per-season map, passed through untouched for engagementForSeason().
        engagementBySeason: (overrides && overrides.engagementBySeason) || {},
        // Which conferences the non-P5 upset bonus treats as "power". undefined
        // = use the engine default (the bare four), so a league that never sets
        // it scores exactly as before. See normalizePowerConferences.
        powerConferences: normalizePowerConferences(overrides && overrides.powerConferences)
    };
}

// A league's power-conference override, or undefined when it hasn't set a usable
// one. Deliberately strict: a malformed value falls back to the engine default
// rather than silently scoring against a half-built list. Kept here (rather than
// importing the default from scoring-detectors) so this module stays dependency-
// free — the detector applies the fallback.
function normalizePowerConferences(list) {
    if (!Array.isArray(list)) return undefined;
    const clean = list.filter(c => typeof c === 'string' && c.trim()).map(c => c.trim());
    return clean.length ? clean : undefined;
}

// Engagement (game modes) defaults: everything off, with the standard bonus /
// multiplier values used when a mode is turned on.
const ENGAGEMENT_DEFAULTS = { h2hEnabled: false, h2hWinBonus: 3, h2hTieBonus: 0, captainEnabled: false, captainMultiplier: 2 };

// THE canonical list of stored config fields, as resolveConfig() overrides.
//
// Every consumer that turns a saved ScoringConfig (a Mongo doc, or the JSON the
// /scoring-config route returns) into a resolved config MUST go through here.
// This list was previously spelled out at six call sites — the scoring job, the
// config route's read and write, draft grades, and two standings projections —
// and they drifted: adding `powerConferences` to the schema and the route left
// five of them silently dropping it, so the league's own scoring never saw the
// setting the admin page had happily saved. A field added here reaches every
// consumer at once; a field added anywhere else reaches one.
function overridesFromDoc(doc) {
    if (!doc) return null;
    return {
        model: doc.model,
        values: doc.values,
        combineMode: doc.combineMode,
        disabled: doc.disabled,
        enabled: doc.enabled,
        engagement: doc.engagement,
        engagementBySeason: doc.engagementBySeason || {},
        powerConferences: doc.powerConferences
    };
}

// Coerce a stored/partial engagement object into a complete, well-typed one.
function normalizeEngagement(e) {
    e = e || {};
    return {
        h2hEnabled: !!e.h2hEnabled,
        h2hWinBonus: typeof e.h2hWinBonus === 'number' ? e.h2hWinBonus : ENGAGEMENT_DEFAULTS.h2hWinBonus,
        h2hTieBonus: typeof e.h2hTieBonus === 'number' ? e.h2hTieBonus : ENGAGEMENT_DEFAULTS.h2hTieBonus,
        captainEnabled: !!e.captainEnabled,
        captainMultiplier: typeof e.captainMultiplier === 'number' ? e.captainMultiplier : ENGAGEMENT_DEFAULTS.captainMultiplier
    };
}

// Resolve the engagement (game-mode) settings for ONE season from a per-season
// map. A season with no explicit entry is fully OFF — this is what keeps each
// season independent: turning a mode on for 2026 leaves 2025 (no entry) off, so
// even a rescore of 2025 adds no captain/H2H bonus.
function engagementForSeason(bySeason, season) {
    const entry = bySeason && (bySeason[String(season)] || bySeason[Number(season)]);
    return normalizeEngagement(entry || {});
}

module.exports = {
    CLAUNTS_DEFAULTS, GRAHAM_DEFAULTS, STRUCTURES, MODELS, LEAGUES,
    modelForLeague, fieldsForModel, resolveConfig, ruleEnabled, normalizePowerConferences, overridesFromDoc,
    ENGAGEMENT_DEFAULTS, normalizeEngagement, engagementForSeason
};
