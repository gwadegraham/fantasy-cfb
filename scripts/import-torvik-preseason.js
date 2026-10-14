#!/usr/bin/env node
//
// Stamp Bart Torvik's preseason T-Rank onto this season's basketball teams.
//
//   node scripts/import-torvik-preseason.js                      # dry run
//   node scripts/import-torvik-preseason.js --apply
//   node scripts/import-torvik-preseason.js --file paste.html    # a fresh paste
//   node scripts/import-torvik-preseason.js --season 2028        # not the active one
//
// Once a year, before the draft. CBBD has no preseason ratings to fetch
// (#318), so this is the only thing that ranks the pool until NET publishes in
// December.
//
// The commissioner's way to do this is the "Preseason ratings" card on
// /hoops/admin (#544), which needs no terminal. This script runs the SAME
// checks and the SAME write — both live in modules/torvik-import.js — and is
// kept for a developer with the committed file in hand.
//
// --file takes anything the card's paste box takes: the page's HTML source,
// the {season}_team_results.json text, or a committed data file.
//
// Dry run by default, and every check runs BEFORE the write, because the
// failure that matters here is silent: a team missing from the pool is a team
// nobody can draft, and a team holding another program's rating looks entirely
// normal. The checks, in the order they fire:
//
//   problemsWith()          the rating set itself — ranks 1..N, unique, in
//                           range, and sorted the right way up
//   matchTeams()            every rating paired with a team, nothing
//                           unmatched, double-claimed or left unrated
//   conferenceMismatches()  the two sources agree about which league each
//                           matched team is in — the only check that can see
//                           a SWAPPED pair of name aliases
//
// The write itself is the one place a partial result is still possible; it
// reports how many rows landed rather than leaving that to be guessed.

if (process.env.NODE_ENV !== 'production') {
    require('dotenv').config();
}

const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const torvik = require('../modules/torvik-import');
const { activeSeason, prime } = require('../modules/active-season');

const DATA_DIR = path.join(__dirname, '..', 'data');
const dataFileFor = (season) => path.join(DATA_DIR, `torvik-preseason-${season}.json`);

function arg(name) {
    const i = process.argv.indexOf(name);
    return i === -1 ? undefined : process.argv[i + 1];
}

async function main() {
    const apply = process.argv.includes('--apply');
    const file = arg('--file');

    await mongoose.connect(process.env.DATABASE_URL);
    await prime().catch(() => {});

    // The season comes from the ACTIVE one unless it is named, so next October
    // this runs correctly with no flags. Pinned to a filename it would find
    // 2027's rows still present — rows are per-season and never deleted —
    // rewrite them, and report "365 / 365" while the live pool got nothing.
    const asked = Number(arg('--season'));
    const live = activeSeason('basketball');
    const season = Number.isFinite(asked) ? asked : live;
    if (!Number.isFinite(season)) throw new Error('no active basketball season — pass --season');
    if (Number.isFinite(asked) && live && asked !== live) {
        console.log(`NOTE: importing ${asked}, while the active basketball season is ${live}.`);
    }

    let source;
    let ratings;
    if (file) {
        const parsed = torvik.parsePaste(fs.readFileSync(file, 'utf8'));
        if (parsed.season != null && Number(parsed.season) !== season) throw new Error(`${file} is for season ${parsed.season}`);
        ratings = parsed.rows;
        source = `${path.basename(file)}, parsed ${new Date().toISOString().slice(0, 10)}`;
    } else {
        const stored = JSON.parse(fs.readFileSync(dataFileFor(season), 'utf8'));
        if (stored.season !== season) throw new Error(`${dataFileFor(season)} is for season ${stored.season}`);
        source = stored.source;
        ratings = stored.teams;
    }

    const result = await torvik.check(season, ratings);
    // check() stops before reading teams when the rating set itself is bad,
    // so "0 teams" would read as a missing teams ingest. Say it only when read.
    console.log(`season ${season}: ${result.ratings} rating rows` +
        (result.teams ? `, ${result.teams} teams, ${result.matched.length} matched` : ''));
    if (!result.ok) {
        result.problems.slice(0, 40).forEach(p => console.log(`  ${p}`));
        throw new Error('refusing to import');
    }

    if (!apply) {
        console.log('\nDRY RUN. Top 10 by Torvik rank:');
        // Sorted, not sliced off the match order — a corrupt paste printed a
        // perfect-looking top ten here while 183 rows all claimed rank 1.
        [...result.matched].sort((a, b) => a.rating.rank - b.rating.rank).slice(0, 10)
            .forEach(m => console.log(`  ${String(m.rating.rank).padStart(3)}  ${m.team.school} (${m.team.conference})`));
        console.log(await torvik.seasonUnderway(season)
            ? `\nLOCKED: season ${season} already has scored basketball games, so --apply will refuse.`
            : '\nRe-run with --apply to write.');
        return;
    }

    // The admin card's lock, honoured here too: once a basketball league has
    // banked points, a new preseason rank re-ranks unplayed games mid-season.
    if (await torvik.seasonUnderway(season)) {
        throw new Error(`season ${season} already has scored basketball games — preseason ratings are locked`);
    }

    const res = await torvik.apply(season, result.matched, source);
    console.log(`wrote ${res.written} (matched ${res.matched})`);
    console.log(`teams now carrying a preseason rank: ${res.stamped} / ${res.teams}`);
}

main()
    .catch((err) => { console.error(err.message); process.exitCode = 1; })
    .finally(() => mongoose.disconnect());
