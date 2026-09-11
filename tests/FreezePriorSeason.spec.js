// Coverage for the prior-season config freeze latch in modules/scoring.js.
//
// On the first scoring run of a season it snapshots the PREVIOUS season's
// scoring config, so a past-season "Why these points?" breakdown stays accurate
// after a commissioner later changes point values.
//
// The latch used to be a bare boolean: freeze once, then never look again for
// the life of the process. That was fine while a season rollover was also a
// dyno restart, because the restart cleared it. Since #312 a rollover is a
// database write that every dyno picks up within a minute WITHOUT restarting —
// so a long-lived dyno would carry a latch set in the old season through the
// flip and never freeze the season it had just left. Heroku's daily dyno
// cycling would usually hide that, which is worse than failing outright.

const { useMongo } = require('./helpers/mongo');
const ScoringConfig = require('../models/scoringConfig');
const scoring = require('../modules/scoring');

useMongo();

beforeEach(async () => {
    scoring._resetFreezeLatch();
    jest.spyOn(console, 'log').mockImplementation(() => {});
    await ScoringConfig.create({
        league: 'graham-league', model: 'graham', values: { baseWin: 10 }
    });
});

afterEach(() => jest.restoreAllMocks());

const frozenSeasons = async () => {
    const doc = await ScoringConfig.findOne({ league: 'graham-league' }).lean();
    return Object.keys(doc.configBySeason || {}).sort();
};

test('freezes the season before the one being scored', async () => {
    await scoring.freezePriorSeasonConfig(2026);
    expect(await frozenSeasons()).toEqual(['2025']);
});

test('does not re-read within the same season', async () => {
    await scoring.freezePriorSeasonConfig(2026);
    const spy = jest.spyOn(ScoringConfig, 'find');
    await scoring.freezePriorSeasonConfig(2026);
    // The latch is what keeps this off every scoring pass.
    expect(spy).not.toHaveBeenCalled();
});

test('freezes again after a rollover, with no restart', async () => {
    // The regression this guards: same process, season moves 2026 -> 2027.
    await scoring.freezePriorSeasonConfig(2026);
    expect(await frozenSeasons()).toEqual(['2025']);

    await scoring.freezePriorSeasonConfig(2027);
    expect(await frozenSeasons()).toEqual(['2025', '2026']);
});

test('treats the season as a string or a number alike', async () => {
    await scoring.freezePriorSeasonConfig('2026');
    await scoring.freezePriorSeasonConfig(2026);
    expect(await frozenSeasons()).toEqual(['2025']);
});

test('never overwrites a season already frozen', async () => {
    await scoring.freezePriorSeasonConfig(2026);
    await ScoringConfig.updateOne(
        { league: 'graham-league' },
        { $set: { 'configBySeason.2025.values.baseWin': 999 } }
    );
    scoring._resetFreezeLatch();
    await scoring.freezePriorSeasonConfig(2026);
    const doc = await ScoringConfig.findOne({ league: 'graham-league' }).lean();
    expect(doc.configBySeason['2025'].values.baseWin).toBe(999);
});
