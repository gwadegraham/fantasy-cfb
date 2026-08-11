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

    testTimeout: 20000,
    transform: {
        "public[\\\\/].+\\.js$": "<rootDir>/tests/helpers/esm-transform.js",
        "\\.[jt]sx?$": "babel-jest"
    },
    collectCoverageFrom: [
        "modules/**/*.js",
        "routes/**/*.js",
        "*-job.js",
        "public/standings-insights.js",
        "public/standings.js",
        "public/weekByWeek.js"
    ],
    coveragePathIgnorePatterns: [
        "/node_modules/",
        "/tests/"
    ],
    coverageThreshold: {
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
        }
    }
};
