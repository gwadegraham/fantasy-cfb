// The H2H roster pin is an upsert on ScoringConfig. An upsert skips the
// schema's `required`, so if it ever creates the config it must set the model
// itself — a config with no model breaks the prior-season freeze.

const { useMongo } = require('./helpers/mongo');
const ScoringConfig = require('../models/scoringConfig');
const { bankLeague } = require('../modules/h2h-settle');

useMongo();

beforeEach(() => jest.spyOn(console, 'log').mockImplementation(() => {}));
afterEach(() => jest.restoreAllMocks());

test('a pin that creates the config gives it the league\'s model', async () => {
    const res = await bankLeague({
        league: 'graham-league', seasonNum: 2026, seasonStr: '2026', users: [],
        eng: { h2hEnabled: true }, pinnedIds: null,
        computed: { awards: {}, finalWeeks: [1], ids: ['a', 'b'] }
    });
    expect(res.rosterPinned).toBe(true);
    const doc = await ScoringConfig.findOne({ league: 'graham-league' }).lean();
    expect(doc.model).toBe('graham');
    expect(doc.h2hScheduleBySeason['2026'].ids).toEqual(['a', 'b']);
});

test('a basketball pin uses the model its caller passes, not the cold cache', async () => {
    await bankLeague({
        league: 'full-court-depressed', seasonNum: 2027, seasonStr: '2027', users: [],
        eng: { h2hEnabled: true }, pinnedIds: null, model: 'hoops',
        computed: { awards: {}, finalWeeks: [1], ids: ['a', 'b'] }
    });
    expect((await ScoringConfig.findOne({ league: 'full-court-depressed' }).lean()).model).toBe('hoops');
});
