// Jest config. Was jest.config.json — moved to JS so the testPathIgnorePatterns
// rationale below can live next to the setting it explains.
module.exports = {
    testRegex: "((\\.|/*.)(spec))\\.js?$",

    // Scoped to test DISCOVERY, not the file crawl.
    //
    // Without this, `npm test` at the repo root also runs every spec under
    // .claude/worktrees/ — i.e. whatever happens to be checked out on other
    // branches. A green run then proves nothing about this branch, and a red one
    // may be someone else's work in progress.
    //
    // `roots: ["<rootDir>/tests"]` scopes discovery too, and is the obvious
    // first thing to reach for — don't. It also stops Jest from ever seeing the
    // modules/ and routes/ files that no test imports, so instead of showing up
    // at 0% they drop out of the coverage report entirely. Measured: 64 files
    // reported before, 47 after, with saturday-job.js and identity-guard.js
    // among the ones that quietly vanished. Keep the default rootDir crawl so
    // collectCoverageFrom can still find them.
    //
    // Setting this REPLACES Jest's default of ["/node_modules/"], hence the
    // first entry.
    testPathIgnorePatterns: ["/node_modules/", "<rootDir>/.claude/worktrees/"],

    // Pins TZ before the workers fork — see the file for why the suite cannot
    // be left to inherit whatever zone the machine is in.
    globalSetup: "<rootDir>/tests/helpers/global-setup.js",

    testTimeout: 20000,
    transform: {
        "public[\\\\/].+\\.js$": "<rootDir>/tests/helpers/esm-transform.js",
        "\\.[jt]sx?$": "babel-jest"
    },
    collectCoverageFrom: [
        "modules/**/*.js",
        "routes/**/*.js",
        "*-job.js",
        "public/season-of.js",
        "public/standings-insights.js",
        "public/standings.js",
        "public/weekByWeek.js",
        "public/search-match.js"
    ],
    coveragePathIgnorePatterns: [
        "/node_modules/",
        "/tests/"
    ],
    coverageThreshold: {
        // The cutover for #313. It runs once, against a live season, and its
        // failure modes are quiet — a dropped field passes verification unless
        // the guard that catches it is itself covered.
        "./modules/account-migration.js": {
            statements: 90,
            branches: 80,
            functions: 100,
            lines: 90
        },
        // Every manager read in the app goes through here, and it answers from
        // one of two collections depending on a flag. Both branches have to stay
        // covered: the flag-off branch is what production runs today, and the
        // flag-on branch is what the write cutover will make permanent. Three of
        // the four QA rounds on #458 found evidence that only reached one of
        // them.
        "./modules/franchise-repo.js": {
            statements: 95,
            branches: 82,
            functions: 100,
            lines: 95
        },
        // The two middlewares that decide whether anyone gets into the app at
        // all, and the only reads whose failure mode is a lockout rather than a
        // wrong number. Both fail OPEN in every ambiguous case, which means the
        // safe-looking paths are the ones that have to stay covered: a guard
        // that silently stopped comparing would pass every smoke test.
        // identity-guard was at 57/50/60/66 before #313 phase 2 put a ratchet
        // on it.
        "./modules/identity-guard.js": {
            statements: 95,
            branches: 85,
            functions: 100,
            lines: 95
        },
        "./modules/invite-bind.js": {
            statements: 95,
            branches: 88,
            functions: 100,
            lines: 95
        },
        // What 94 call sites now route through for "what season is it?", and it
        // fails soft by design (an unprimed cache answers from process.env.YEAR),
        // so the fallback paths have to stay covered or a regression is silent.
        "./modules/active-season.js": {
            statements: 90,
            branches: 85,
            functions: 100,
            lines: 90
        },
        // Pure lookup module, and the thing 35 call sites now route through —
        // the uncovered line is the UMD browser branch, unreachable under CJS.
        "./public/season-of.js": {
            statements: 95,
            branches: 90,
            functions: 100,
            lines: 94
        },
        "./modules/scoring-detectors.js": {
            statements: 95,
            branches: 90,
            functions: 100,
            lines: 95
        },
        "./modules/draft-grades.js": {
            statements: 90,
            branches: 70,
            functions: 95,
            lines: 95
        },
        // Pure normalizer for the CFP bracket. It decides which postseason round
        // a game is — and refuses brackets whose two bye signals disagree — so
        // every branch, including the refusals, is held to the pure-module bar.
        "./modules/cfp-bracket.js": {
            statements: 100,
            branches: 95,
            functions: 100,
            lines: 100
        },
        "./modules/h2h.js": {
            statements: 95,
            branches: 85,
            functions: 100,
            lines: 100
        },
        "./modules/season-readiness.js": {
            statements: 100,
            branches: 85,
            functions: 100,
            lines: 100
        },
        "./modules/roster-correction.js": {
            statements: 95,
            branches: 85,
            functions: 100,
            lines: 100
        },
        "./modules/draft-call-link.js": {
            statements: 100,
            branches: 100,
            functions: 100,
            lines: 100
        },
        "./modules/audit-log.js": {
            statements: 100,
            branches: 90,
            functions: 100,
            lines: 100
        },
        "./modules/internal-api.js": {
            statements: 100,
            branches: 100,
            functions: 100,
            lines: 100
        },
        "./modules/http-errors.js": {
            statements: 100,
            branches: 90,
            functions: 100,
            lines: 100
        },
        "./modules/invite-token.js": {
            statements: 100,
            branches: 85,
            functions: 100,
            lines: 100
        },
        // The bind middleware writes to Auth0 and to Mongo, and its refusal
        // branches are the security properties (single-use, email-gated), so it
        // is held to the same bar as the pure modules despite doing I/O.
        "./modules/invite-bind.js": {
            statements: 95,
            branches: 90,
            functions: 100,
            lines: 95
        },
        "./modules/auth-sub-backfill.js": {
            statements: 100,
            branches: 100,
            functions: 100,
            lines: 100
        },
        "./modules/auth0-management.js": {
            statements: 90,
            branches: 80,
            functions: 100,
            lines: 100
        },
        "./modules/env-num.js": {
            statements: 100,
            branches: 100,
            functions: 100,
            lines: 100
        },
        // Shapes the play-by-play log. It decides what counts as a scoring
        // play — by score delta, not by matching CFBD's play-type vocabulary —
        // and a wrong answer there is a silently wrong log, so it's held to the
        // pure-module bar.
        "./modules/play-by-play.js": {
            statements: 100,
            branches: 85,
            functions: 100,
            lines: 100
        },
        // The only billable live endpoint. Its cache and its "is this final"
        // check are what keep a game detail page from costing a call per view,
        // and both fail silently in the direction of spending money — a TTL
        // that never hits just looks like a working page. Held to the
        // pure-module bar.
        "./modules/live-plays.js": {
            statements: 95,
            branches: 90,
            functions: 90,
            lines: 95
        },
        // Debounce timing for the live poller's post-completion work. The
        // rules decide how much billable CFBD work a fast poll cadence costs,
        // and getting them wrong is invisible in the UI (finals just settle
        // late, or never), so the pure module is held to the pure-module bar.
        "./modules/completion-flush.js": {
            statements: 100,
            branches: 85,
            functions: 100,
            lines: 100
        },
        // Decides whether a manager's phone buzzes. Every rule in it fails
        // SILENTLY in production — a bad edge either spams a lock screen for a
        // whole Saturday or says nothing at all, and neither shows up in a log
        // or in the UI. Held to the pure-module bar. Not 100 branches: the two
        // uncovered are defensive `|| []` guards on fields the schema requires.
        "./modules/score-events.js": {
            statements: 100,
            branches: 95,
            functions: 100,
            lines: 100
        },
        // Validates a client-supplied push endpoint that the dyno will later
        // make outbound requests to on every scoring tick, so the https check
        // and the length caps are security properties rather than formatting.
        "./modules/push-subscription.js": {
            statements: 100,
            branches: 100,
            functions: 100,
            lines: 100
        },
        "./modules/job-runs-util.js": {
            statements: 100,
            branches: 100,
            functions: 100,
            lines: 100
        },
        "./update-enrichment-job.js": {
            statements: 80,
            branches: 60,
            functions: 60,
            lines: 90
        },
        "./modules/hall-of-fame.js": {
            statements: 95,
            branches: 85,
            functions: 100,
            lines: 100
        },
        "./public/standings-insights.js": {
            statements: 95,
            branches: 95,
            functions: 100,
            lines: 100
        },
        "./public/standings.js": {
            statements: 95,
            branches: 80,
            functions: 95,
            lines: 98
        },
        "./public/weekByWeek.js": {
            statements: 90,
            branches: 75,
            functions: 100,
            lines: 100
        },
        // Pure ranking for the search palette. It decides which of two schools
        // sharing a prefix is the one you meant — Arkansas vs Arkansas State —
        // so it's held to the pure-module bar. Not 100: the UMD browser-global
        // line can't run under Node's require.
        "./public/search-match.js": {
            statements: 95,
            branches: 85,
            functions: 100,
            lines: 95
        }
    }
};
