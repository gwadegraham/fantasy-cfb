// A basketball game's play log, as the gamecast reads it: one shape whether
// it came from ESPN (live, modules/hoops-espn-live.js) or CBBD (stored once
// final, modules/hoops-shots.js). The two feeds carry the same play types and
// text — CBBD copies ESPN's — so only the field names differ.
//
// One play:
//   { type, text, period, clock, side: 'home'|'away'|null,
//     home, away,            // the score AFTER the play, OUR home and away
//     points,                // on a scoring play only: 1, 2 or 3
//     wp,                    // OUR home side's win probability after it, 0-1
//     player,                // on a technical: true when it names a player
//     shot }                 // live only: { x, y, made } on the chart's half court
//
// Substitutions are dropped: 178 of 533 rows on a measured game, and the page
// never shows them.
//
// ---- team fouls (the bonus) ----
//
// NCAA men's rules book (2026-27): a team is in the bonus from the
// opponent's 7th team foul in a half, the double bonus from the 10th (Rule 8,
// Section 2). Each extra period is an extension of the second half (Rule 5,
// Section 9), so overtime keeps counting the second half's fouls. A player's
// technical counts toward the team total, a bench or coach technical does not
// (Rule 10): a technical is counted only when it names a player.

const NOISE = new Set(['Substitution']);
const PERSONAL = /^(PersonalFoul|Flagrant ?Foul)/i;
const TECHNICAL = /Technical/i;

const num = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const prob = (v) => { const n = num(v); return n === null || n < 0 || n > 1 ? null : Math.round(n * 1000) / 1000; };

// From CBBD /plays/game rows. Pure. CBBD's home and away are ours, and its
// teamId is our team id.
function fromCbbd(rows, game) {
    const home = Number(game.homeTeamId), away = Number(game.awayTeamId);
    return (Array.isArray(rows) ? rows : []).filter(r => r && !NOISE.has(r.playType)).map(r => {
        const team = Number(r.teamId);
        const out = {
            type: r.playType || null,
            text: r.playText || null,
            period: num(r.period),
            clock: r.clock || null,
            side: team === home ? 'home' : team === away ? 'away' : null,
            home: num(r.homeScore),
            away: num(r.awayScore),
            wp: prob(r.homeWinProbability)
        };
        if (r.scoringPlay && num(r.scoreValue)) out.points = num(r.scoreValue);
        if (TECHNICAL.test(out.type || '') && Array.isArray(r.participants) && r.participants.some(p => p && p.id != null)) out.player = true;
        return out;
    });
}

// Team fouls in the half being played (overtime counts with the second).
function teamFouls(plays) {
    const list = Array.isArray(plays) ? plays : [];
    const last = list.length ? list[list.length - 1] : null;
    if (!last || !Number.isFinite(last.period)) return null;
    const second = last.period >= 2;
    const inHalf = (p) => (second ? p.period >= 2 : p.period === 1);
    const counts = { home: 0, away: 0 };
    for (const p of list) {
        if (!inHalf(p) || !counts.hasOwnProperty(p.side)) continue;
        if (PERSONAL.test(p.type || '') || (TECHNICAL.test(p.type || '') && p.player)) counts[p.side]++;
    }
    // A team is in the bonus on the OTHER side's fouls.
    const bonus = (fouls) => (fouls >= 10 ? 'double' : fouls >= 7 ? 'single' : null);
    return {
        period: last.period,
        home: { fouls: counts.home, bonus: bonus(counts.away) },
        away: { fouls: counts.away, bonus: bonus(counts.home) }
    };
}

module.exports = { fromCbbd, teamFouls, NOISE, prob, num };
