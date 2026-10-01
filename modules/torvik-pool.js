// Bart Torvik's preseason T-Rank, turned into our team rows (#320).
//
// WHY A HAND-PASTED FILE AND NOT AN API
//
// CBBD publishes no preseason ratings at all — every ratings endpoint answers 0
// rows for a season that has not tipped off, and NET does not first publish
// until early-to-mid December (#318). The basketball draft happens in late
// October. So the draft pool cannot be ranked from our own data, and this is
// the input that fills the gap: one paste of https://barttorvik.com, once a
// year, before the draft.
//
// ---- matching Torvik's names to CBBD's ----
//
// Measured against the live 2027 rows, both sides hold exactly 365 teams, so
// the mapping is a BIJECTION. Raw string equality gets 272; the deterministic
// rewrites below get 337; the remaining 28 are genuine renames, listed one by
// one.
//
// No fuzzy distance, deliberately. The near-misses here are not typos, they are
// DIFFERENT SCHOOLS: Torvik ships "Miami FL" and "Miami OH" against CBBD's
// "Miami" and "Miami (OH)", and "Connecticut" sits next to a real "Central
// Connecticut". Anything that scores candidates by similarity substitutes one
// for the other and the pool silently ranks the wrong program.
//
// ---- WHAT THE BIJECTION DOES NOT CATCH ----
//
// A single wrong alias shows up as a double-claim plus an unclaimed team. A
// SWAPPED PAIR does not: send "Miami FL" to Miami (OH) and "Miami OH" to Miami
// and the result is still 365 matched, 0 unmatched, 0 double-claimed, 0
// unclaimed. Measured. The pool then ranks Miami (OH) 18th and Miami 102nd and
// reports a clean import.
//
// conferenceMismatches() is the check that closes it, and it needs no second
// alias table: the abbreviation-to-name mapping is DERIVED from the matches
// themselves by majority, so a pair whose conference disagrees with the rest of
// its group is flagged. On the committed data it flags exactly one row, and
// that row is a genuine source disagreement — see KNOWN_CONFERENCE_DRIFT.
//
// models/hoopsTeam.js used to say this match is on (school, conference). It is
// not: `school` is already unique across all 365 rows, so conference is a
// VALIDATION here, never a key.

// Torvik's name -> CBBD's name, for the 29 the rewrites cannot reach.
// Alphabetical by Torvik's spelling. Every entry was confirmed against the
// unclaimed CBBD row it pairs with, not guessed from the string.
const NAME_ALIASES = {
    'Albany': 'UAlbany',
    'American': 'American University',
    'Appalachian St.': 'App State',
    'Cal Baptist': 'California Baptist',
    'Connecticut': 'UConn',
    'FIU': 'Florida International',
    'Grambling St.': 'Grambling',
    'IU Indy': 'IU Indianapolis',
    'Illinois Chicago': 'UIC',
    'LIU': 'Long Island University',
    'Louisiana Monroe': 'UL Monroe',
    'Loyola MD': 'Loyola Maryland',
    'McNeese St.': 'McNeese',
    'Miami FL': 'Miami',
    'Miami OH': 'Miami (OH)',
    'Mississippi': 'Ole Miss',
    'Nebraska Omaha': 'Omaha',
    'Nicholls St.': 'Nicholls',
    'Penn': 'Pennsylvania',
    'Queens': 'Queens University',
    'Sam Houston St.': 'Sam Houston',
    'Seattle': 'Seattle U',
    'Southeastern Louisiana': 'SE Louisiana',
    'St. Thomas': 'St. Thomas-Minnesota',
    'Tennessee Martin': 'UT Martin',
    'Texas A&M Corpus Chris': 'Texas A&M-Corpus Christi',
    'UMKC': 'Kansas City',
    'USC Upstate': 'South Carolina Upstate'
};

// Rewrites that hold for every school, so they belong in code rather than in
// the table above.
//
// `St.` -> `State` is the big one (63 rows). The accent fold is for CBBD's
// "San José State" against Torvik's "San Jose St."; the apostrophe strip is for
// "Hawai'i". Hyphens go to spaces because the two sources disagree about them
// in both directions ("Gardner Webb"/"Gardner-Webb", "UL Monroe"/"UL Monroe").
function normaliseSchool(name) {
    return String(name)
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        // Not \bSt\.\b — there is no word boundary after the period, so that
        // spelling matches nothing and every "St." row falls through to the
        // alias table. It did, and the table looked 63 entries longer than it
        // needed to be.
        .replace(/\bSt\./g, 'State')
        .replace(/[.'’]/g, '')
        .replace(/[-–]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
}

// Pull the rating rows out of a pasted T-Rank page.
//
// Torvik's table is plain server-rendered HTML with no ids on the cells, so the
// columns are positional. They have been stable for years, but a reorder would
// silently swap AdjOE and AdjDE — hence the range checks in the caller rather
// than trust here.
function parseTRank(html) {
    const rows = [];
    // Attributes allowed on BOTH tags. Torvik's current page emits a bare
    // <tr>, but the sibling <td[^>]*> already tolerates them, and a bare-only
    // <tr> pattern turns one added class into 0 rows and a refusal message
    // telling the operator to add 365 names to NAME_ALIASES.
    for (const block of String(html).match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) || []) {
        const cells = block.match(/<td[^>]*>[\s\S]*?<\/td>/gi) || [];
        if (cells.length < 8) continue;                  // header and spacer rows

        // The school comes from the LINK's query string, not the cell text:
        // the text carries seed markers and injury daggers in-season, and the
        // href does not.
        const link = /team\.php\?team=([^&"]+)/.exec(cells[1]);
        if (!link) continue;

        const text = (c) => c.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        // AdjOE and AdjDE share their cell with a national rank in a <span>,
        // so the cell reads "119.1 11". parseFloat stops at the space and is
        // the whole guard — an explicit .split() here was unfalsifiable by any
        // test, which makes it read as load-bearing to whoever refactors next.
        const lead = (c) => parseFloat(text(c));

        rows.push({
            rank: parseInt(text(cells[0]), 10),
            school: decodeURIComponent(link[1].replace(/\+/g, ' ')),
            conference: text(cells[2]),
            adjOE: lead(cells[3]),
            adjDE: lead(cells[4]),
            barthag: parseFloat(text(cells[5])),
            projectedRecord: text(cells[6])
        });
    }
    return rows;
}

// Pair every rating row with a team row, or refuse.
//
// Returns { matched, unmatched, doubleClaimed, unclaimed }. A caller that
// writes anything while the last three are non-empty has defeated the point:
// a team missing from the pool is a team nobody can draft, and it fails by
// being absent, which nothing notices.
function matchTeams(ratings, teams) {
    const byName = new Map();
    for (const t of teams) {
        const key = normaliseSchool(t.school);
        if (!byName.has(key)) byName.set(key, []);
        byName.get(key).push(t);
    }

    const matched = [];
    const unmatched = [];
    const doubleClaimed = [];
    const claimedBy = new Map();

    for (const row of ratings) {
        const wanted = NAME_ALIASES[row.school] || row.school;
        const hits = byName.get(normaliseSchool(wanted)) || [];
        if (hits.length !== 1) {
            unmatched.push({ school: row.school, wanted, candidates: hits.length });
            continue;
        }
        const team = hits[0];
        if (claimedBy.has(team.school)) {
            doubleClaimed.push({ school: team.school, by: [claimedBy.get(team.school), row.school] });
            continue;
        }
        claimedBy.set(team.school, row.school);
        matched.push({ team, rating: row });
    }

    const unclaimed = teams.filter(t => !claimedBy.has(t.school)).map(t => t.school);
    return { matched, unmatched, doubleClaimed, unclaimed };
}

// Conference disagreements that are real, not alias errors.
//
// Keyed by CBBD's school name, with what the two sources each say, so a wrong
// entry is obvious on sight. An entry here means "we looked, and the pairing is
// right even though the conferences differ" — it does NOT suppress a different
// disagreement on the same team later, because the expected pair is recorded.
const KNOWN_CONFERENCE_DRIFT = {
    // CBBD's 2027 row says Sun Belt; Torvik has it in CUSA, alongside the other
    // ten CUSA members both sources agree on. One of the two is stale. The
    // names match exactly — no alias is involved — so the RATING is right
    // whichever conference is, and the pool is unaffected.
    'Louisiana Tech': { torvik: 'CUSA', cbbd: 'Sun Belt' }
};

// Pairs whose two sources disagree about the conference.
//
// The point is NOT to police conference data. It is the only available check on
// a swapped pair of aliases, which the bijection cannot see: two schools whose
// ratings have been exchanged almost always sit in different leagues, and that
// shows up here as two flagged rows.
//
// The abbreviation-to-name mapping is derived by majority from the matches, so
// nothing has to be maintained by hand. The smallest real conference holds
// eight teams, so one mismatched row never becomes its own group's majority.
function conferenceMismatches(matched) {
    const tally = new Map();
    for (const { team, rating } of matched) {
        if (!tally.has(rating.conference)) tally.set(rating.conference, new Map());
        const inner = tally.get(rating.conference);
        inner.set(team.conference, (inner.get(team.conference) || 0) + 1);
    }
    const expected = new Map();
    for (const [abbr, inner] of tally) {
        expected.set(abbr, [...inner].sort((a, b) => b[1] - a[1])[0][0]);
    }

    const out = [];
    for (const { team, rating } of matched) {
        const want = expected.get(rating.conference);
        if (want === team.conference) continue;
        const known = KNOWN_CONFERENCE_DRIFT[team.school];
        if (known && known.torvik === rating.conference && known.cbbd === team.conference) continue;
        out.push({ school: team.school, torvik: rating.conference, expected: want, cbbd: team.conference });
    }
    return out;
}

module.exports = { NAME_ALIASES, KNOWN_CONFERENCE_DRIFT, normaliseSchool, parseTRank, matchTeams, conferenceMismatches };
