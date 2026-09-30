#!/usr/bin/env node
//
// Stamp Bart Torvik's preseason T-Rank onto this season's basketball teams.
//
//   node scripts/import-torvik-preseason.js                      # dry run
//   node scripts/import-torvik-preseason.js --apply
//   node scripts/import-torvik-preseason.js --file paste.html    # re-parse a fresh paste
//
// Dry run by default, and it REFUSES rather than writing a partial import — see
// the bijection note in modules/torvik-pool.js. A team missing from the pool is
// a team nobody can draft, and absence is the failure mode nothing notices.
//
// Once a year, before the draft. CBBD has no preseason ratings to fetch
// (#318), so this is the only thing that ranks the pool until NET publishes in
// December.

if (process.env.NODE_ENV !== 'production') {
    require('dotenv').config();
}

const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const HoopsTeam = require('../models/hoopsTeam');
const { parseTRank, matchTeams } = require('../modules/torvik-pool');
const { activeSeason, prime } = require('../modules/active-season');

const DATA = path.join(__dirname, '..', 'data', 'torvik-preseason-2027.json');

function arg(name) {
    const i = process.argv.indexOf(name);
    return i === -1 ? undefined : process.argv[i + 1];
}

// A reordered column on Torvik's side would swap AdjOE and AdjDE without
// changing the row count, so the shape is checked rather than assumed. The
// bands are generous: the real spread across 365 teams is 87.8-121.3.
function implausible(rows) {
    return rows.filter(r =>
        !Number.isFinite(r.rank) || !r.school ||
        !(r.adjOE > 70 && r.adjOE < 140) ||
        !(r.adjDE > 70 && r.adjDE < 140) ||
        !(r.barthag >= 0 && r.barthag <= 1));
}

async function main() {
    const apply = process.argv.includes('--apply');
    const file = arg('--file');

    let season;
    let source;
    let ratings;
    if (file) {
        ratings = parseTRank(fs.readFileSync(file, 'utf8'));
        source = `${path.basename(file)}, parsed ${new Date().toISOString().slice(0, 10)}`;
        season = Number(arg('--season'));
        if (!Number.isFinite(season)) throw new Error('--file needs --season too');
    } else {
        const stored = JSON.parse(fs.readFileSync(DATA, 'utf8'));
        ({ season, source } = stored);
        ratings = stored.teams;
    }

    await mongoose.connect(process.env.DATABASE_URL);
    await prime().catch(() => {});

    // Loud rather than clever: importing against the wrong season would stamp
    // ratings onto rows the draft never reads, and report success.
    const live = activeSeason('basketball');
    if (live && live !== season) {
        console.log(`NOTE: the active basketball season is ${live}, this file is ${season}.`);
    }

    const bad = implausible(ratings);
    if (bad.length) throw new Error(`${bad.length} rating row(s) are out of range — the columns may have moved: ${JSON.stringify(bad.slice(0, 3))}`);

    const teams = await HoopsTeam.find({ season }, { school: 1, conference: 1 }).lean();
    if (!teams.length) throw new Error(`no hoopsteams rows for season ${season} — run the teams ingest first`);

    const { matched, unmatched, doubleClaimed, unclaimed } = matchTeams(ratings, teams);
    console.log(`season ${season}: ${ratings.length} rating rows, ${teams.length} teams, ${matched.length} matched`);

    if (unmatched.length || doubleClaimed.length || unclaimed.length) {
        for (const u of unmatched) console.log(`  UNMATCHED  ${u.school} (looked for "${u.wanted}", ${u.candidates} candidates)`);
        for (const d of doubleClaimed) console.log(`  DOUBLE     ${d.school} claimed by ${d.by.join(' and ')}`);
        for (const u of unclaimed) console.log(`  NO RATING  ${u}`);
        throw new Error('refusing to import: add the missing names to NAME_ALIASES in modules/torvik-pool.js');
    }

    if (!apply) {
        console.log('\nDRY RUN. Top 10 by Torvik rank:');
        matched.slice(0, 10).forEach(m => console.log(`  ${String(m.rating.rank).padStart(3)}  ${m.team.school} (${m.team.conference})`));
        console.log('\nRe-run with --apply to write.');
        return;
    }

    const importedAt = new Date().toISOString();
    const ops = matched.map(({ team, rating }) => ({
        updateOne: {
            filter: { season, school: team.school },
            update: { $set: { preseason: {
                rank: rating.rank, adjOE: rating.adjOE, adjDE: rating.adjDE,
                barthag: rating.barthag, projectedRecord: rating.projectedRecord,
                source, importedAt
            } } }
        }
    }));
    const res = await HoopsTeam.bulkWrite(ops, { ordered: false });
    console.log(`wrote ${res.modifiedCount} (matched ${res.matchedCount})`);

    const stamped = await HoopsTeam.countDocuments({ season, 'preseason.rank': { $exists: true } });
    console.log(`teams now carrying a preseason rank: ${stamped} / ${teams.length}`);
}

main()
    .catch((err) => { console.error(err.message); process.exitCode = 1; })
    .finally(() => mongoose.disconnect());
