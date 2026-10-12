// The official NCAA NET, read off ncaa.com (#533).
//
// The NET is what managers know — the committee's ranking, the one the
// quadrants on every team sheet are drawn from — so once it publishes it
// drives scoring (modules/hoops-ranks.js). CBBD does not serve it: /rankings
// is AP and Coaches only, and /ratings/adjusted's "net" is an efficiency
// rank with ties. The source is NCAA's own page, a server-rendered table.
//
// This module is the pure part — parse the page, pair NCAA's names with our
// team rows — plus the one read the team and game pages make. The fetch and
// the writes are modules/hoops-net-job.js.
//
// NCAA.com's terms forbid reproducing its content. Graham weighed that for a
// private, non-commercial league; the footprint is one request a day, and
// every surface that shows the number credits NCAA.

const HoopsNetRank = require('../models/hoopsNetRank');
const { normaliseSchool, conferenceMismatches } = require('./torvik-pool');
// The alias file also carries the two KNOWN gaps between NCAA's field and
// ours — each a name someone checked, so a reclassifying school does not
// turn into a daily failure email (or, for an NCAA name, no NET at all):
//   notOurs    NCAA names with no team row of ours, left out of the match
//   notRanked  our schools NCAA does not rank, which will grade as unranked
const ALIAS_FILE = require('../data/ncaa-net-aliases.json');
const NAME_ALIASES = ALIAS_FILE.aliases;
const KNOWN_GAPS = { notOurs: ALIAS_FILE.notOurs, notRanked: ALIAS_FILE.notRanked };

const NET_URL = 'https://www.ncaa.com/rankings/basketball-men/d1/ncaa-mens-basketball-net-rankings';

// The columns the parse needs, by header text. Found by NAME rather than
// position: the table also carries Road/Neutral/Home/Non-Div I/Prev, and a
// column added or moved must not shift Quad 1 into Quad 2 unnoticed.
const REQUIRED_COLUMNS = ['Rank', 'School', 'Record', 'Conf', 'Quad 1', 'Quad 2', 'Quad 3', 'Quad 4'];

// Thrown when the page is there but no longer reads the way this parser
// expects. Always an error JobRun — never a skip, never a partial write.
class NetLayoutError extends Error {
    constructor(message) { super(`NET page layout changed: ${message}`); this.name = 'NetLayoutError'; }
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: '’', lsquo: '‘' };
function cellText(html) {
    return String(html)
        .replace(/<[^>]+>/g, ' ')
        .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
        .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
        .replace(/&([a-z]+);/gi, (m, name) => (name.toLowerCase() in ENTITIES ? ENTITIES[name.toLowerCase()] : m))
        .replace(/\s+/g, ' ')
        .trim();
}

// "21-3" -> { w: 21, l: 3 }, or null.
function parseRecord(text) {
    const m = /^(\d+)\s*-\s*(\d+)$/.exec(String(text).trim());
    return m ? { w: Number(m[1]), l: Number(m[2]) } : null;
}

const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };

// "Through Games Apr. 06 2026" -> 2026-04-06T00:00Z (an Eastern calendar
// day, hoops-calendar's convention), or null when the stamp is absent or
// unreadable.
function parseThroughGames(html) {
    const m = /Through Games\s+([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})/.exec(String(html));
    if (!m) return null;
    const month = MONTHS[m[1].slice(0, 3).toLowerCase()];
    if (month === undefined) return null;
    const d = new Date(Date.UTC(Number(m[3]), month, Number(m[2])));
    // Date.UTC rolls "Feb 31" into March rather than failing.
    return d.getUTCDate() === Number(m[2]) ? d : null;
}

// The page -> { throughGames, hasTable, rows }.
//
// hasTable is false when there is no ranking table at all: before NCAA's
// first release of the season the page may have none, and whether that is a
// skip or a failure depends on the date, which is the job's call. A table
// that IS the ranking (it has a School column) but is missing a column or
// carries an unreadable row is a NetLayoutError — that is never a skip.
function parseNetPage(html) {
    const page = String(html);
    const throughGames = parseThroughGames(page);
    const tables = page.match(/<table[^>]*>[\s\S]*?<\/table>/gi) || [];
    let table = null;
    let header = null;
    for (const t of tables) {
        const ths = (t.match(/<th(?:\s[^>]*)?>[\s\S]*?<\/th>/gi) || []).map(cellText);
        if (ths.includes('School')) { table = t; header = ths; break; }
    }
    if (!table) return { throughGames, hasTable: false, rows: [] };

    const missing = REQUIRED_COLUMNS.filter(c => !header.includes(c));
    if (missing.length) throw new NetLayoutError(`the ranking table has no ${missing.map(c => `"${c}"`).join(', ')} column`);
    const col = Object.fromEntries(REQUIRED_COLUMNS.map(c => [c, header.indexOf(c)]));

    const body = (/<tbody[^>]*>([\s\S]*?)<\/tbody>/i.exec(table) || [null, table])[1];
    const rows = [];
    for (const tr of body.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) || []) {
        const cells = (tr.match(/<td[^>]*>[\s\S]*?<\/td>/gi) || []).map(cellText);
        if (!cells.length) continue;   // a header row repeated inside the body
        // A single spanning cell is a message, not a team ("Rankings will be
        // released..."): skipped, so a table of nothing else reads as empty —
        // the cold start — rather than as a layout change.
        if (cells.length === 1 && /colspan/i.test(tr)) continue;
        if (cells.length !== header.length) {
            throw new NetLayoutError(`a row has ${cells.length} cells under ${header.length} headers: "${cells.join(' | ')}"`);
        }
        const rank = /^\d+$/.test(cells[col.Rank]) ? Number(cells[col.Rank]) : null;
        const school = cells[col.School];
        const record = parseRecord(cells[col.Record]);
        const quads = [1, 2, 3, 4].map(q => parseRecord(cells[col[`Quad ${q}`]]));
        if (!rank || !school || !record || quads.some(q => !q)) {
            throw new NetLayoutError(`unreadable row: "${cells.join(' | ')}"`);
        }
        rows.push({
            rank, school, record, conference: cells[col.Conf],
            quad1: quads[0], quad2: quads[1], quad3: quads[2], quad4: quads[3]
        });
    }
    return { throughGames, hasTable: true, rows };
}

// NCAA's abbreviations, spelled out. Only ever a word followed by a period,
// on its own or before a hyphen ("Ark.-Pine Bluff"). `St.` is not here:
// torvik-pool's normaliseSchool already reads it as State on BOTH sides, so
// "St. John's" and CBBD's "St. John's" still meet.
const ABBREVIATIONS = {
    'N.C': 'North Carolina', Ala: 'Alabama', Ariz: 'Arizona', Ark: 'Arkansas', Caro: 'Carolina',
    Colo: 'Colorado', Col: 'College', Conn: 'Connecticut', Fla: 'Florida', Ga: 'Georgia',
    Ill: 'Illinois', Ind: 'Indiana', Ky: 'Kentucky', La: 'Louisiana', Mich: 'Michigan',
    Miss: 'Mississippi', Mo: 'Missouri', Tenn: 'Tennessee', U: 'University', Val: 'Valley',
    Wash: 'Washington'
};
function expandAbbreviations(name) {
    return String(name).replace(/(^|[\s-])(N\.C|[A-Z][a-z]{0,4})\.(?=$|[\s-])/g,
        (m, pre, word) => (ABBREVIATIONS[word] ? pre + ABBREVIATIONS[word] : m));
}

// The keys a NCAA name is tried under, strictest first. The first key with
// any hit decides: one hit is a match, two or more is AMBIGUOUS and the name
// is left unmatched rather than tried looser — a looser key only widens a
// field that is already too wide.
function nameKeys(name) {
    const expanded = expandAbbreviations(name);
    return [...new Set([
        normaliseSchool(name),
        normaliseSchool(expanded),
        // "Saint Mary's (CA)", "Miami (FL)": the qualifier CBBD leaves off.
        normaliseSchool(expanded.replace(/\s*\([^)]*\)/g, ''))
    ])];
}

// Pair every NET row with a team row.
//
// Returns { matched, unmatched, doubleClaimed, unclaimed, ignored, conferenceMismatches }.
// The job refuses to write while unmatched, doubleClaimed or
// conferenceMismatches is non-empty: an unmatched team would sit unranked,
// and an unranked opponent reads as Q4.
//
// No fuzzy distance, for torvik-pool's reason: the near-misses are different
// schools ("Miami (FL)"/"Miami (OH)", "Connecticut"/"Central Conn. St.").
// And conferenceMismatches is the same guard against a swapped pair, fed
// NCAA's Conf column.
function matchNet(rows, teams, aliases = NAME_ALIASES, { notOurs = KNOWN_GAPS.notOurs, notRanked = KNOWN_GAPS.notRanked } = {}) {
    const byName = new Map();
    const byAbbr = new Map();
    const add = (map, key, team) => {
        if (!map.has(key)) map.set(key, new Set());
        map.get(key).add(team);
    };
    for (const t of teams) {
        add(byName, normaliseSchool(t.school), t);
        if (t.shortDisplayName) add(byName, normaliseSchool(t.shortDisplayName), t);
        if (t.abbreviation) add(byAbbr, t.abbreviation, t);
    }

    const matched = [];
    const unmatched = [];
    const doubleClaimed = [];
    const claimedBy = new Map();

    const ignored = [];
    for (const row of rows) {
        // A school NCAA ranks that has no team row of ours, checked and
        // listed by name in the alias file. Reported, never silent.
        if (notOurs.includes(row.school)) { ignored.push(row.school); continue; }
        let hits = [];
        if (Object.prototype.hasOwnProperty.call(aliases, row.school)) {
            // An alias is the only key tried: a stale one must fail, not
            // quietly fall through to a looser rewrite.
            hits = [...(byName.get(normaliseSchool(aliases[row.school])) || [])];
        } else {
            for (const key of nameKeys(row.school)) {
                hits = [...(byName.get(key) || [])];
                if (hits.length) break;
            }
            // "UNI", "SFA", "UNCW": NCAA uses some schools' acronyms, which
            // are CBBD's abbreviation. Only for a name that IS an acronym,
            // and only after every name key missed.
            if (!hits.length && /^[A-Z]{2,6}$/.test(row.school)) hits = [...(byAbbr.get(row.school) || [])];
        }
        if (hits.length !== 1) {
            unmatched.push({ school: row.school, candidates: hits.map(t => t.school) });
            continue;
        }
        const team = hits[0];
        if (claimedBy.has(team.id)) {
            doubleClaimed.push({ school: team.school, by: [claimedBy.get(team.id), row.school] });
            continue;
        }
        claimedBy.set(team.id, row.school);
        matched.push({ team, row });
    }

    const unclaimed = teams.filter(t => !claimedBy.has(t.id) && !notRanked.includes(t.school)).map(t => t.school);
    const mismatches = conferenceMismatches(matched.map(m => ({ team: m.team, rating: { conference: m.row.conference } })));
    return { matched, unmatched, doubleClaimed, unclaimed, ignored, conferenceMismatches: mismatches };
}

// The latest official NET for some teams, for display: { [teamId]: {...} }.
//
// The newest snapshot on file — the week filed furthest ahead, which is the
// most recent fetch — not the week a game was graded on. A page shows "the
// NET" as ncaa.com shows it today; what a game was PAID at is already banked
// with its points.
async function latestNet(season, teamIds) {
    const yr = Number(season);
    const ids = (teamIds || []).map(Number).filter(Number.isFinite);
    if (!Number.isFinite(yr) || !ids.length) return {};
    const newest = await HoopsNetRank.findOne({ season: yr }, { week: 1, _id: 0 }).sort({ week: -1 }).lean();
    if (!newest) return {};
    const rows = await HoopsNetRank.find({ season: yr, week: newest.week, teamId: { $in: ids } },
        { _id: 0, teamId: 1, rank: 1, record: 1, quad1: 1, quad2: 1, quad3: 1, quad4: 1, throughGames: 1 }).lean();
    const out = {};
    for (const r of rows) {
        out[String(r.teamId)] = {
            rank: r.rank,
            record: r.record || null,
            quads: [r.quad1, r.quad2, r.quad3, r.quad4].map(q => (q ? { w: q.w, l: q.l } : null)),
            throughGames: r.throughGames || null
        };
    }
    return out;
}

module.exports = {
    NET_URL, REQUIRED_COLUMNS, NAME_ALIASES, KNOWN_GAPS, NetLayoutError,
    parseNetPage, parseThroughGames, parseRecord, cellText, expandAbbreviations, nameKeys, matchNet, latestNet
};
