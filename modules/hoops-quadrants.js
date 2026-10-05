// Quadrants: what a basketball result was WORTH, at the moment it happened.
//
// Football scores a win by the opponent's AP rank. That instrument does not
// exist in basketball: the poll ranks 25 of 364 teams, so nearly every game
// grades as "unranked" and a 31-game season collapses into an aggregate
// win-total contest decided at the draft. Quadrants are the sport's own
// answer — opponent strength crossed with WHERE the game was played, because
// winning at Duke is not the same as hosting Duke.
//
// The boundaries are the NCAA selection committee's shape. The rank feeding
// them is NOT the committee's NET: CBBD does not serve NET at all, and NET
// first publishes in December, so it cannot rank a preseason draft pool
// either. See rankSource below.
//
// ---- BANKED AT TIME OF PLAY ----
//
// The real committee re-reads a November win using the opponent's rank on
// Selection Sunday, so a past result changes value all season. We deliberately
// do not. A game is worth what it was worth that night, permanently.
//
// Not taste — mechanics. Weekly scores are banked and H2H settles per week,
// zero-sum, so re-scoring a November game in February means re-settling that
// week and taking a win bonus back off a manager. The repo has been bitten by
// that class of drift before, and draft grades already pin a MarketSnapshot
// for the same reason. Monday's standings are final.
//
// The committee's live view survives as a DISPLAY — "banked Q1, 5 pts ·
// Baylor has since fallen to #78, that'd be Q2 today" — never as the number.

// Opponent rank ceilings per venue. Read as: at HOME, an opponent ranked 1-30
// is Q1, 31-75 is Q2, 76-160 is Q3, anything worse is Q4.
//
// The same opponent is worth more away than at home, which is the whole point
// of crossing rank with venue.
const BANDS = {
    home:    [30, 75, 160],
    neutral: [50, 100, 200],
    away:    [75, 135, 240]
};

const VENUES = Object.keys(BANDS);

// A game with no venue recorded is treated as HOME: the stingiest of the
// three, so an unknown cannot inflate what a win was worth. Being wrong in
// the direction of fewer points is recoverable; the other direction is a
// manager who banked a Q1 they did not earn, and time-of-play means it is
// never taken back.
const DEFAULT_VENUE = 'home';

function venueOf(value) {
    const v = String(value || '').toLowerCase();
    return VENUES.includes(v) ? v : DEFAULT_VENUE;
}

// The quadrant of a result, 1-4.
//
// An unranked or unusable opponent rank is Q4, not "no quadrant". Every team
// a league can draft is ranked, and a missing rank means the ratings refresh
// has not reached that team yet — which must read as the cheapest possible
// win rather than as an error that stops a week from scoring.
function quadrantFor(rank, venue) {
    const n = Number(rank);
    if (!Number.isInteger(n) || n < 1) return 4;
    const bands = BANDS[venueOf(venue)];
    for (let i = 0; i < bands.length; i++) {
        if (n <= bands[i]) return i + 1;
    }
    return 4;
}

// Where a game was played, from the SCORING team's point of view.
//
// `neutralSite` wins over home/away: CBBD still names a home and an away team
// for a neutral-site game, and reading that literally would hand one of them
// a home-court advantage it never had — in the conference and NCAA
// tournaments, which is where it matters most.
function venueFor(teamId, game) {
    if (!game) return DEFAULT_VENUE;
    if (game.neutralSite) return 'neutral';
    return Number(game.homeId) === Number(teamId) ? 'home' : 'away';
}

module.exports = { quadrantFor, venueFor, venueOf, BANDS, VENUES, DEFAULT_VENUE };
