// Fetch CFBD pregame win probabilities and store them on Game docs.
//
// /metrics/wp/pregame returns one entry per game with { gameId, homeWinProbability }.
// The projection engine reads game.pregameWinProb directly instead of computing
// win probabilities from SP+ margins — CFBD's model already factors in SP+,
// home field, and weekly model updates.

const Game = require('../models/game');

const CFBD_BASE = 'https://api.collegefootballdata.com';

async function fetchPregameWP(year, week, seasonType) {
    const st = seasonType || 'regular';
    const url = `${CFBD_BASE}/metrics/wp/pregame?year=${year}&week=${week}&seasonType=${st}`;
    const res = await fetch(url, {
        method: 'GET',
        headers: {
            'Accept': 'application/json',
            'Authorization': process.env.CFBD_API_KEY
        }
    });
    if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`CFBD /metrics/wp/pregame ${res.status}: ${body.slice(0, 200)}`);
    }
    return res.json();
}

async function updatePregameWP(year, week, seasonType) {
    const entries = await fetchPregameWP(year, week, seasonType);
    if (!Array.isArray(entries) || !entries.length) return { fetched: 0, updated: 0 };

    let updated = 0;
    const ops = entries
        .filter(e => e.gameId != null && e.homeWinProbability != null)
        .map(e => ({
            updateOne: {
                filter: { id: e.gameId },
                update: { $set: { pregameWinProb: e.homeWinProbability } }
            }
        }));

    if (ops.length) {
        const result = await Game.bulkWrite(ops, { ordered: false });
        updated = result.modifiedCount || 0;
    }

    return { fetched: entries.length, updated };
}

module.exports = { fetchPregameWP, updatePregameWP };
