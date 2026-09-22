// Pin the suite's timezone before Jest forks its workers.
//
// Several specs assert on rendered dates and times, and until this existed they
// were silently asserting against WHOEVER RAN THEM: the zone resolves once per
// process from the machine, so the same assertion passed in Chicago and failed
// in UTC. tests/TeamPageTimezone.spec.js even carries a comment claiming "Jest
// runs under TZ=UTC unless told otherwise" — it does not, and did not.
//
// Central because that is the league's zone, and because the bug that prompted
// this (a TBD kickoff stored as midnight Eastern reading as the night before —
// see public/kickoff-day.js) is invisible in UTC and in Eastern. A suite pinned
// to either of those would have gone on passing while the app showed managers
// the wrong day.
//
// Unconditional, deliberately. The first version deferred to an inherited TZ so
// `TZ=UTC npx jest` would still work — but plenty of container and CI images
// export TZ=UTC themselves, and there the pin would quietly step aside and the
// date specs would fail on expectations they never agreed to. An escape hatch
// that fires by accident is the same problem this file exists to remove.
module.exports = () => {
    process.env.TZ = 'America/Chicago';
};
