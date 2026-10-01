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
const HoopsTeam = require('../models/hoopsTeam');
const { parseTRank, matchTeams, conferenceMismatches } = require('../modules/torvik-pool');
const { activeSeason, prime } = require('../modules/active-season');

const DATA_DIR = path.join(__dirname, '..', 'data');
const dataFileFor = (season) => path.join(DATA_DIR, `torvik-preseason-${season}.json`);

function arg(name) {
    const i = process.argv.indexOf(name);
    return i === -1 ? undefined : process.argv[i + 1];
}

// Everything that has to be true of a rating set before it can rank a draft.
//
// These used to live only in the spec, hard-wired to the committed file — so
// --file, the path that produces NEXT year's data, skipped all of them. A
// paste where 183 rows all claimed rank 1 imported cleanly and printed a
// plausible top ten.
function problemsWith(rows) {
    const bad = [];
    const ranks = rows.map(r => r.rank);

    // A reordered column would swap AdjOE and AdjDE without changing the row
    // count. The bands are generous: the real spread across 365 teams is
    // 87.8-121.3.
    for (const r of rows) {
        if (!Number.isFinite(r.rank) || !r.school) bad.push(`malformed row: ${JSON.stringify(r)}`);
        else if (!(r.adjOE > 70 && r.adjOE < 140)) bad.push(`${r.school}: adjOE ${r.adjOE} out of range`);
        else if (!(r.adjDE > 70 && r.adjDE < 140)) bad.push(`${r.school}: adjDE ${r.adjDE} out of range`);
        else if (!(r.barthag >= 0 && r.barthag <= 1)) bad.push(`${r.school}: barthag ${r.barthag} out of range`);
        else if (!/^\d+-\d+$/.test(String(r.projectedRecord))) bad.push(`${r.school}: projected record "${r.projectedRecord}"`);
    }

    // RANK IS THE POOL. A duplicated or missing rank is the one corruption
    // that still looks entirely normal in every other column.
    if (new Set(ranks).size !== ranks.length) bad.push(`ranks are not unique (${ranks.length} rows, ${new Set(ranks).size} distinct)`);
    const sorted = [...ranks].sort((a, b) => a - b);
    if (sorted[0] !== 1 || sorted[sorted.length - 1] !== ranks.length) {
        bad.push(`ranks run ${sorted[0]}..${sorted[sorted.length - 1]} across ${ranks.length} rows — expected 1..${ranks.length}`);
    }
    if (new Set(rows.map(r => r.school)).size !== rows.length) bad.push('a school is named more than once');

    // And the right way up: barthag is win probability, so it falls as the
    // rank number rises. Catches a reversed sort, which otherwise ranks the
    // worst 120 teams as the draft pool.
    const best = rows.find(r => r.rank === 1);
    const worst = rows.find(r => r.rank === ranks.length);
    if (best && worst) {
        if (!(best.barthag > worst.barthag)) {
            bad.push(`rank 1 (${best.school}, barthag ${best.barthag}) is not stronger than rank ${ranks.length} (${worst.school}, ${worst.barthag}) — the sort may be reversed`);
        }
        // AdjOE and AdjDE occupy adjacent cells and share a plausible range,
        // so exchanging them passes every band check above and simply inverts
        // the pool. The best team scores MORE and concedes LESS than the
        // worst; that asymmetry is what tells the two columns apart.
        if (!(best.adjOE > worst.adjOE) || !(best.adjDE < worst.adjDE)) {
            bad.push(`rank 1 (${best.school}: OE ${best.adjOE}, DE ${best.adjDE}) does not outscore and outdefend rank ${ranks.length} (${worst.school}: OE ${worst.adjOE}, DE ${worst.adjDE}) — the two columns may be swapped`);
        }
    }
    return bad;
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
        ratings = parseTRank(fs.readFileSync(file, 'utf8'));
        source = `${path.basename(file)}, parsed ${new Date().toISOString().slice(0, 10)}`;
    } else {
        const stored = JSON.parse(fs.readFileSync(dataFileFor(season), 'utf8'));
        if (stored.season !== season) throw new Error(`${dataFileFor(season)} is for season ${stored.season}`);
        source = stored.source;
        ratings = stored.teams;
    }
    if (!ratings.length) throw new Error('parsed 0 rating rows — check the paste actually contains the T-Rank table');

    const bad = problemsWith(ratings);
    if (bad.length) {
        bad.slice(0, 10).forEach(b => console.log(`  BAD  ${b}`));
        throw new Error(`${bad.length} problem(s) with the rating set — refusing to import`);
    }

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

    // The bijection above is satisfied by a SWAPPED pair of aliases, which is
    // the only way left to get a silently mis-rated pool. Two swapped schools
    // almost always sit in different leagues, and that lands here.
    const drifted = conferenceMismatches(matched);
    if (drifted.length) {
        drifted.forEach(d => console.log(`  CONFERENCE  ${d.school}: torvik says ${d.torvik} (= ${d.expected}), we have ${d.cbbd}`));
        throw new Error('refusing to import: check these are not a swapped pair of aliases, then record them in KNOWN_CONFERENCE_DRIFT');
    }

    if (!apply) {
        console.log('\nDRY RUN. Top 10 by Torvik rank:');
        // Sorted, not sliced off the match order — a corrupt paste printed a
        // perfect-looking top ten here while 183 rows all claimed rank 1.
        [...matched].sort((a, b) => a.rating.rank - b.rating.rank).slice(0, 10)
            .forEach(m => console.log(`  ${String(m.rating.rank).padStart(3)}  ${m.team.school} (${m.team.conference})`));
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
    // ordered:false keeps going past a rejected op, so a failure here means a
    // PARTIAL import — exactly what the header promises not to do. Rethrowing
    // the raw driver error loses the one number the operator needs: how many
    // rows actually landed. routes/hoopsTeams.js reads err.result for this.
    let res;
    try {
        res = await HoopsTeam.bulkWrite(ops, { ordered: false });
    } catch (err) {
        const partial = err.result ? err.result.nModified : 0;
        console.log(`PARTIAL IMPORT: ${partial} of ${ops.length} rows written before the failure.`);
        console.log('The pool is half-ranked. Fix the cause and re-run — the write is an upsert, so repeating it is safe.');
        throw err;
    }
    console.log(`wrote ${res.modifiedCount} (matched ${res.matchedCount})`);

    const stamped = await HoopsTeam.countDocuments({ season, 'preseason.rank': { $exists: true } });
    console.log(`teams now carrying a preseason rank: ${stamped} / ${teams.length}`);
    if (stamped !== teams.length) throw new Error(`${teams.length - stamped} team(s) still have no preseason rank`);
}

main()
    .catch((err) => { console.error(err.message); process.exitCode = 1; })
    .finally(() => mongoose.disconnect());
