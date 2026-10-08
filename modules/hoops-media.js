// Where a basketball game is on — the TV line on the game page (#506).
//
// CBBD /games/media, ONE billable call a night, and only when the stored
// schedule has a game in the window: the off-season and the gap before
// November cost nothing. The ScoreboardGame `tv` field is free but only
// covers today's slate, too late to tell anyone where tomorrow's game is.
//
// Football does this with one season-wide call (routes/games.js /media).
// Basketball cannot: /games/media caps at 3,000 rows like /games
// (cbbd-client.js), and a season is ~5,300 games. So a rolling window —
// the last three days, so a result that aired is still labelled, through
// the next week, so a manager can find tomorrow's game. Measured on
// January 2026: ~90 games a day, so ~1,000 rows, a third of the cap.
//
// Matched by game id and written as ONE field. A game the response does
// not mention is left alone; nothing is ever created here.

const cbbd = require('./cbbd-client');
const HoopsGame = require('../models/hoopsGame');
const { LOOKBACK_MS } = require('./hoops-box-score');

const DAY_MS = 24 * 60 * 60 * 1000;
const AHEAD_MS = 7 * DAY_MS;
const ymd = (ms) => new Date(ms).toISOString().slice(0, 10);

async function ingestWindow(season, { now = Date.now() } = {}) {
    const yr = Number(season);
    const from = now - LOOKBACK_MS;
    const to = now + AHEAD_MS;
    const any = await HoopsGame.exists({ season: yr, startDate: { $gte: new Date(from), $lte: new Date(to) } });
    if (!any) return { season: yr, games: 0, stored: 0, skippedReason: 'nothing scheduled' };

    // endDateRange the day AFTER the window: CBBD reads a bare date as
    // midnight UTC, the same trap fetchGamesInRange documents for /games.
    const { data, remainingCalls } = await cbbd.cbbdGet('/games/media', {
        season: yr, startDateRange: ymd(from), endDateRange: ymd(to + DAY_MS)
    });
    const ops = data.filter(m => m && m.gameId != null && Array.isArray(m.broadcasts)).map(m => ({
        updateOne: {
            filter: { id: Number(m.gameId) },
            update: { $set: { broadcasts: m.broadcasts
                .filter(b => b && b.broadcastName)
                .map(b => ({ name: String(b.broadcastName), type: b.broadcastType || null })) } }
        }
    }));
    let stored = 0;
    if (ops.length) stored = (await HoopsGame.bulkWrite(ops, { ordered: false })).matchedCount;
    return { season: yr, games: data.length, stored, capped: data.length >= cbbd.PAGE_CAP, remainingCalls };
}

// The outlets to print: TV when there is any, else streaming (ESPN+ is
// most of a weekday slate). Radio never — nobody looks a game up to find
// the AM station. Null when there is nothing to say.
function outlets(broadcasts) {
    const list = Array.isArray(broadcasts) ? broadcasts : [];
    const of = (type) => [...new Set(list.filter(b => b && b.name && b.type === type).map(b => b.name))];
    const tv = of('TV');
    const picked = tv.length ? tv : of('Streaming');
    return picked.length ? picked.join(' / ') : null;
}

module.exports = { ingestWindow, outlets, AHEAD_MS };
