// FCS teams share the `teams` collection with FBS ones, but they are REFERENCE
// DATA, not part of the league's team universe. They exist so an opponent can be
// rendered properly — its abbreviation on a matchup row, its logo — and for
// nothing else. They must never reach the draft pool, roster assignment, site
// search, the CFP-odds name matcher, or the enrichment-readiness denominator.
//
// `$ne: 'fcs'` rather than `$eq: 'fbs'` on purpose: every doc that predates the
// classification field was pulled from CFBD's /teams/fbs endpoint, so an absent
// value means FBS. That keeps the filter correct without a backfill migration.
const FBS_ONLY = Object.freeze({ classification: { $ne: 'fcs' } });

module.exports = { FBS_ONLY };
