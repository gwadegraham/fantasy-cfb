// What a parlay leg's second line says (client + server; UMD so both can load
// this one file, matching public/season-scoring.js).
//
// Before kickoff it names the matchup. Once the game is final it becomes the box
// score, because at that point "Stanford @ Duke" is the only thing on the row
// that hasn't moved — the tick beside it already says whether the leg won, and
// the score is what says HOW.
//
// Kept out of public/betting.js so the two judgements that actually have edges —
// when a game counts as final, and who gets emphasised on a tie — are testable
// without standing up the whole betting page.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.ccLegDisplay = factory();
}(typeof self !== 'undefined' ? self : this, function () {

    // A game with a score to show. `completed` alone is not enough: the ingest
    // writes the flag from CFBD's /games, and modules/retrieve-games.js
    // deliberately leaves the points alone when they arrive null mid-game — so
    // a game can read completed with nothing to print for a tick.
    function isFinal(game) {
        return !!(game && game.completed && game.homePoints != null && game.awayPoints != null);
    }

    // The final score, away side first the way a scoreboard reads, or null when
    // there isn't one yet.
    //
    // `winner` is 'away', 'home', or null on a tie — college football has
    // overtime so a tie is vanishingly rare, but bolding both sides of one would
    // look like a bug rather than a rarity.
    //
    // Abbreviations fall back to full team names: a team CFBD has no
    // abbreviation for should cost the row its tidiness, not its score.
    function finalScore(game) {
        if (!isFinal(game)) return null;
        var a = Number(game.awayPoints), h = Number(game.homePoints);
        return {
            away: game.awayAbbr || game.awayTeam || '',
            home: game.homeAbbr || game.homeTeam || '',
            awayPoints: a,
            homePoints: h,
            winner: a > h ? 'away' : (h > a ? 'home' : null)
        };
    }

    // Plain-text form, for anywhere that can't take markup: "STAN 7 – 21 DUKE".
    function finalScoreText(game) {
        var s = finalScore(game);
        if (!s) return null;
        return s.away + ' ' + s.awayPoints + ' – ' + s.homePoints + ' ' + s.home;
    }

    // The matchup line when the game has NOT finished.
    function matchupText(game) {
        if (!game) return null;
        return (game.awayTeam || '') + ' @ ' + (game.homeTeam || '');
    }

    // Does this leg need a PERSON to grade it?
    //
    // Only a `custom` leg. modules/parlay-resolve.js grades every other type off
    // the final score and falls through to 'pending' for custom, because custom
    // is free text ("Arkansas Over 3.5 turnovers") with no line to grade
    // against — so nothing but a human will ever settle it.
    //
    // Deliberately NOT "any pending leg whose game is final". A spread leg sits
    // in exactly that state between the whistle and the next scoring run — up to
    // a couple of hours on a Saturday — and flagging those would put a warning
    // on four rows every weekend for something that fixes itself. A flag that
    // cries wolf is how the real one went a week unnoticed.
    function needsManualGrading(leg, game) {
        if (!leg || (leg.result && leg.result !== 'pending')) return false;
        return leg.betType === 'custom' && isFinal(game);
    }

    // What the history table's "Legs" column says for one week.
    //
    // The column used to count picks that had a game attached, which answers
    // "has everyone got a pick in yet?" — a live question for the current week
    // and a dead one for every row below it, where it read 4/4 forever. So a
    // settled week counts legs that HIT instead, which is what you want when
    // scanning down the table for why a week lost.
    //
    // The denominator drops pushes, matching the payout: deriveParlayStatus in
    // modules/parlay-resolve.js takes them out of the slip, so a 2-1 week with a
    // push reads 2/3, not 2/4. The pushes are named in the tooltip rather than
    // silently vanishing.
    //
    // A slip goes 'lost' the moment one leg loses, with its other legs still
    // pending, so the denominator is DECIDED legs — the fraction grows as the
    // rest settle instead of showing a Saturday-afternoon 1/4 that reads as a
    // wipeout.
    function legTally(parlay) {
        var legs = (parlay && parlay.legs) || [];
        var total = legs.length;
        if (!total) return { kind: 'none', text: '—', title: 'No legs on this slip' };

        var decided = legs.filter(function (l) { return l.result === 'win' || l.result === 'loss'; });
        var pushes = legs.filter(function (l) { return l.result === 'push'; }).length;
        var settled = !!parlay.status && parlay.status !== 'pending';

        if (!settled) {
            var filled = legs.filter(function (l) { return l.gameId; }).length;
            return {
                kind: 'submitted',
                text: filled + '/' + total,
                title: filled + ' of ' + total + ' picks in'
            };
        }

        // Every leg pushed. There is no fraction to print; "0/0" would read as a
        // wipeout for a week that cost nothing.
        if (!decided.length) {
            return { kind: 'pushed', text: '—', title: 'All ' + total + ' legs pushed' };
        }

        var wins = decided.filter(function (l) { return l.result === 'win'; }).length;
        var title = wins + ' of ' + decided.length + ' legs hit';
        if (pushes) title += ' (' + pushes + ' push' + (pushes > 1 ? 'es' : '') + ' not counted)';
        var pending = total - decided.length - pushes;
        if (pending) title += ', ' + pending + ' still pending';

        return { kind: 'hits', text: wins + '/' + decided.length, title: title };
    }

    return {
        isFinal: isFinal,
        legTally: legTally,
        needsManualGrading: needsManualGrading,
        finalScore: finalScore,
        finalScoreText: finalScoreText,
        matchupText: matchupText
    };
}));
