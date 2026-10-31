// Best Bets list on the betting page (view only; UMD so the specs can load it).
//
// The data comes from GET /betting/best-bets/:season/:week, ranked by
// modules/best-bets.js: legs likely to hit, best value first. This file only
// turns it into rows. public/betting.js owns the fetch and what "Use" does,
// because filling a leg goes through its bet board.
//
// Written for someone who doesn't bet much. The first version spoke in EV,
// units and "-110 52%", and the first person to read it couldn't say what any
// of it meant. Every number here is said as a sentence: how often it wins,
// what $100 wins, how many ratings agree. Nothing says "lock": the win chances
// come from the betting lines, so these are the safest legs at the best price,
// not something the books missed.

(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.ccBestBets = factory();
}(typeof self !== 'undefined' ? self : this, function () {
    // How many rows the page shows. The route answers more so the week 0/1
    // split still leaves enough.
    var SHOW = 8;
    // What the record line prices each pick at. $10 reads as real money in a
    // group that wagers $20 a slip; "units" did not.
    var STAKE = 10;
    // The suggested parlay's wager box starts here; the group stakes $20 a slip.
    var DEFAULT_WAGER = 20;
    var MODEL_LABELS = { elo: 'Elo', sp: 'SP+', cfbd: 'CFBD' };

    function esc(v) {
        return String(v == null ? '' : v)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function formatOdds(odds) {
        if (odds == null) return '';
        return odds > 0 ? '+' + odds : String(odds);
    }

    // Profit on $100 at American odds, to the dollar.
    function winOn100(odds) {
        return Math.round(odds > 0 ? odds : 10000 / -odds);
    }

    function money(n) {
        var r = Math.round(Math.abs(n) * 100) / 100;
        var s = r % 1 === 0 ? String(r) : r.toFixed(2);
        return (n < 0 ? '−$' : '$') + s;
    }

    function team(pick) {
        return pick.teamSide === 'home' ? pick.homeTeam : pick.awayTeam;
    }

    // The bet, then what it needs to happen.
    function pickTitle(pick) {
        if (pick.betType === 'moneyline') return team(pick) + ' to win';
        if (pick.betType === 'over_under') return pick.selection + ' total points';
        return pick.selection;
    }

    function pickNeeds(pick) {
        if (pick.betType === 'spread') {
            var n = pick.line;
            if (n < 0) return 'Must win by ' + Math.floor(-n + 1) + ' or more';
            if (n > 0) return 'Wins, or loses by ' + Math.ceil(n - 1) + ' or fewer';
            return 'Must win';
        }
        if (pick.betType === 'over_under') {
            var over = pick.selection.indexOf('Over') === 0;
            return 'Both teams combined score ' + (over ? Math.floor(pick.line + 1) + ' or more' : Math.ceil(pick.line - 1) + ' or fewer');
        }
        return '';
    }

    // How the price compares with a fair one. DK's normal cut on a leg is ~4–5%,
    // so "normal" is the honest word for most of the list. Short enough to sit
    // on one line of a phone row.
    function valueNote(pick) {
        if (!pick.shopped) return 'Only DraftKings has this game';
        if (pick.priceEdge != null && pick.priceEdge >= 0.5) {
            var pts = Math.round(pick.priceEdge * 10) / 10;
            return 'Good value: ' + pts + ' more point' + (pts === 1 ? '' : 's') + ' than other books';
        }
        if (pick.ev > -0.02) return 'Good value: pays more than other books';
        if (pick.ev > -0.06) return 'Normal price';
        return 'A bit pricey';
    }

    // "2 of 3 ratings agree", with which ones in the tooltip. The chips this
    // replaced took a line per row on a phone for the least useful fact.
    function agreeNote(pick) {
        var voters = pick.voters || [];
        if (!voters.length) return '';
        var agreed = {};
        (pick.agree || []).forEach(function (k) { agreed[k] = true; });
        var who = voters.map(function (k) { return MODEL_LABELS[k] + (agreed[k] ? ' agrees' : ' disagrees'); }).join(', ');
        return '<span class="bestbets-agree" title="' + who + '">' + (pick.agree || []).length + ' of '
            + voters.length + ' ratings agree</span>';
    }

    function recordLine(record, perWeek) {
        if (!record || !(record.wins + record.losses + record.pushes)) {
            return 'No finished weeks to check yet.';
        }
        var decided = record.wins + record.losses;
        var line = 'This season, the top ' + perWeek + ' each week won <strong>'
            + record.wins + ' of ' + (decided + record.pushes) + '</strong>'
            + (record.hitPct != null ? ' (' + Math.round(record.hitPct) + '%)' : '') + '.';
        if (record.slips) {
            line += ' A slip of all ' + perWeek + ' would have hit <strong>' + record.slipsHit + ' of '
                + record.slips + '</strong> weeks.';
        }
        var dollars = record.units * STAKE;
        line += ' Betting ' + money(STAKE) + ' on each one separately: <span class="'
            + (dollars >= 0 ? 'stat-positive' : 'stat-negative') + '">'
            + (dollars >= 0 ? 'up ' : 'down ') + money(Math.abs(dollars)) + '</span>.';
        return line;
    }

    // ctx.canUse(pick) → { ok, label } decides the button; the page knows the
    // slip and the member, this file doesn't.
    function row(pick, i, ctx) {
        var status = '';
        if (pick.result === 'win') status = '<span class="bestbets-result bestbets-result--win" title="Won">W</span>';
        else if (pick.result === 'loss') status = '<span class="bestbets-result bestbets-result--loss" title="Lost">L</span>';
        else if (pick.result === 'push') status = '<span class="bestbets-result" title="Push, stake returned">P</span>';

        var action = '';
        if (!pick.started) {
            var use = ctx.canUse(pick);
            // No reason here when the whole list shares it: render() says it once.
            action = use.ok
                ? '<button type="button" class="bestbets-use" data-game-id="' + esc(pick.gameId) + '">' + esc(use.label) + '</button>'
                : use.label ? '<span class="bestbets-use-na">' + esc(use.label) + '</span>' : '';
        } else if (!status) {
            action = '<span class="bestbets-use-na">Started</span>';
        }

        // Three short lines, so a row is about as tall as its Use button:
        // the bet and its price; the game and what has to happen; the chance,
        // the $100 payout and the value.
        var needs = pickNeeds(pick);
        return '<li class="bestbets-row">'
            + '<div class="bestbets-main">'
            + '<div class="bestbets-pick">' + esc(pickTitle(pick))
            + ' <span class="bestbets-odds">' + formatOdds(pick.odds) + '</span></div>'
            + '<div class="bestbets-matchup">' + esc(pick.awayTeam) + ' @ ' + esc(pick.homeTeam)
            + (needs ? ' · <span class="bestbets-needs">' + esc(needs) + '</span>' : '') + '</div>'
            + '<div class="bestbets-facts">'
            + '<span class="bestbets-prob">Wins about ' + Math.round(pick.winProb * 100) + '%</span>'
            + '<span class="bestbets-pays">Bet $100, win $' + winOn100(pick.odds) + '</span>'
            + '<span class="bestbets-why">' + esc(valueNote(pick)) + '</span>'
            + agreeNote(pick)
            + '</div>'
            + '</div>'
            + '<div class="bestbets-action">' + status + action + '</div>'
            + '</li>';
    }

    // The rows the page shows, in order.
    //
    // Picks still open come first. Mid-Saturday the top of the ranking is
    // often a game that kicked off at noon, and two dead rows above the ones
    // you can still bet read as a broken list. A finished week is all
    // started, so its order is the ranking untouched.
    function visiblePicks(data, gameIds) {
        var allowed = {};
        (gameIds || []).forEach(function (id) { allowed[id] = true; });
        var picks = ((data && data.picks) || []).filter(function (p) { return allowed[p.gameId]; });
        var open = picks.filter(function (p) { return !p.started; });
        var started = picks.filter(function (p) { return p.started; });
        return open.concat(started).slice(0, SHOW);
    }

    // ---- Suggested parlay ---------------------------------------------------
    // The top `legCount` picks still open, one per member of the slip. The list
    // is already "likely, best value first" and one leg per game, so its head
    // IS the best slip it can build: swapping any leg for one further down
    // trades either chance or price for nothing.
    //
    // Legs are treated as independent (different games), so the chance all hit
    // is the product. No boost: the group's boosts are entered per slip by an
    // admin, and guessing one here would overstate the payout.
    function decimalOdds(american) {
        return american > 0 ? 1 + american / 100 : 1 + 100 / -american;
    }

    function decimalToAmerican(dec) {
        return dec >= 2 ? Math.round((dec - 1) * 100) : Math.round(-100 / (dec - 1));
    }

    function suggestedParlay(data, gameIds, legCount) {
        var legs = visiblePicks(data, gameIds).filter(function (p) { return !p.started; }).slice(0, legCount);
        if (!legs.length) return null;
        var dec = legs.reduce(function (d, p) { return d * decimalOdds(p.odds); }, 1);
        var hit = legs.reduce(function (h, p) { return h * p.winProb; }, 1);
        return { legs: legs, wanted: legCount, decimal: dec, american: decimalToAmerican(dec), hitProb: hit };
    }

    // Total back on a win, stake included — the figure the slip's Payout shows.
    function parlayPayout(parlay, wager) {
        return Math.round(wager * parlay.decimal * 100) / 100;
    }

    // "1 in 4" reads better than "24%" for a long shot, and both are shown.
    function oneIn(p) {
        return p > 0 ? Math.max(1, Math.round(1 / p)) : null;
    }

    function parlayPayLine(parlay, wager) {
        return 'Payout <strong>' + money(parlayPayout(parlay, wager)) + '</strong>'
            + ' <span class="bestbets-odds">(' + formatOdds(parlay.american) + ')</span>';
    }

    function legsWord(n) { return n + (n === 1 ? ' leg' : ' legs'); }

    // The one line the section shows while folded up.
    function summaryLine(parlay, wager) {
        if (!parlay) return 'Nothing likely enough yet';
        return legsWord(parlay.legs.length) + ' · ' + money(wager) + ' pays '
            + '<strong>' + money(parlayPayout(parlay, wager)) + '</strong>';
    }

    // The parlay card holds its legs as full rows, Use buttons and all. Its
    // legs are the head of the list, so showing them once here and again
    // below was the same picks twice, and on a phone the card alone filled
    // the screen.
    function renderParlay(parlay, wager, ctx) {
        if (!parlay) return '';
        var pct = Math.round(parlay.hitProb * 100);
        var n = oneIn(parlay.hitProb);
        var short = parlay.legs.length < parlay.wanted
            ? '<div class="bestbets-parlay-note">Only ' + parlay.legs.length + ' of ' + parlay.wanted
              + ' legs: there aren\u2019t enough likely bets left this week.</div>'
            : '';
        return '<div class="bestbets-parlay">'
            + '<div class="bestbets-parlay-head">Suggested parlay · ' + legsWord(parlay.legs.length) + '</div>'
            + '<div class="bestbets-parlay-hit">All ' + parlay.legs.length + ' hit about <strong>' + pct + '%</strong> of the time'
            + (n ? ' (about 1 in ' + n + ' weeks)' : '') + '</div>'
            + short
            + '<ol class="bestbets-list">' + parlay.legs.map(function (p, i) { return row(p, i, ctx); }).join('') + '</ol>'
            + '<div class="bestbets-parlay-pay">'
            + '<label class="bestbets-wager">Wager $<input type="number" id="bestbets-wager" min="1" step="any" inputmode="decimal" value="' + wager + '"></label>'
            + '<span id="bestbets-pay-line">' + parlayPayLine(parlay, wager) + '</span>'
            + '</div>'
            + '</div>';
    }

    // data: the route's answer. gameIds: the week's game ids as the page split
    // them (week 0 vs 1). Returns '' when there is nothing.
    // ctx: { canUse(pick), legCount, wager, open }.
    //
    // The whole section is one <details>: folded, it is a single line with the
    // parlay's payout, so a week where the slip is filling up still shows the
    // slip and the bet board without scrolling past the list. The page keeps
    // the open/closed choice (ctx.open).
    function render(data, gameIds, ctx) {
        if (!data) return '';
        var picks = visiblePicks(data, gameIds);
        var wager = ctx.wager || DEFAULT_WAGER;
        var parlay = suggestedParlay(data, gameIds, ctx.legCount || 6);
        var floor = Math.round((data.minWinProb || 0.7) * 100);
        // The parlay's legs are visiblePicks' first rows (open picks come
        // first), so the rest start where they end.
        var used = parlay ? parlay.legs.length : 0;
        var rest = picks.slice(used);

        // "No slip yet" is the member's state, not the pick's: say it once
        // above the list instead of in every row's button slot.
        var open = picks.filter(function (p) { return !p.started; })[0];
        var use = open ? ctx.canUse(open) : { ok: true };
        var notice = '';
        if (!use.ok) {
            notice = '<div class="bestbets-notice">' + esc(use.label) + ', so there\u2019s no leg of yours to fill.</div>';
            ctx = { canUse: function () { return { ok: false, label: '' }; }, open: ctx.open };
        }

        var body = !picks.length
            ? '<div class="bestbets-empty">No bets this week with at least a ' + floor + '% chance to win yet.</div>'
            : rest.length
                ? '<div class="bestbets-more-head">' + (used ? 'More likely bets' : 'Likely bets') + '</div>'
                  + '<ol class="bestbets-list">' + rest.map(function (p, i) { return row(p, used + i, ctx); }).join('') + '</ol>'
                : '';

        return '<details class="bestbets-fold"' + (ctx.open ? ' open' : '') + '>'
            + '<summary class="bestbets-summary">'
            + '<span class="bestbets-title"><i class="fa-solid fa-ranking-star"></i> Best Bets</span>'
            + '<span class="bestbets-summary-line" id="bestbets-summary-line">' + summaryLine(parlay, wager) + '</span>'
            + '<i class="fa-solid fa-chevron-down bestbets-caret" aria-hidden="true"></i>'
            + '</summary>'
            + '<div class="bestbets-body">'
            + notice
            + renderParlay(parlay, wager, ctx)
            + body
            + '<details class="bestbets-about"><summary>How these are picked</summary>'
            + '<p>Only bets the betting market gives at least a ' + floor + '% chance to win, so a parlay of them has a real shot. '
            + 'Of those, the ones where DraftKings pays the most for that chance come first. Huge underdogs never show up.</p>'
            + '<p>The win chances come from the betting lines themselves. These are the safest legs at the best price, '
            + 'not secrets the books missed, and a parlay still needs every leg to hit.</p>'
            + '<p>“Ratings” are three computer rankings we keep (Elo, SP+ and CFBD). '
            + '“2 of 3 ratings agree” means two of them also pick that side.</p>'
            + '<p class="bestbets-record">' + recordLine(data.record, data.picksPerWeek || 6) + '</p>'
            + '</details>'
            + '</div>'
            + '</details>';
    }

    return {
        SHOW: SHOW,
        STAKE: STAKE,
        DEFAULT_WAGER: DEFAULT_WAGER,
        suggestedParlay: suggestedParlay,
        parlayPayout: parlayPayout,
        parlayPayLine: parlayPayLine,
        summaryLine: summaryLine,
        pickTitle: pickTitle,
        pickNeeds: pickNeeds,
        valueNote: valueNote,
        recordLine: recordLine,
        render: render,
        visiblePicks: visiblePicks,
        winOn100: winOn100
    };
}));
