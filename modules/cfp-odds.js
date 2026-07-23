// Parse pasted CFP / championship futures odds and match them to our teams.
// Used by the admin "CFP Odds" action. Tolerant of both the DraftKings HTML
// (title/odds spans) and plain rendered text (team then odds on alternating
// lines), and of the various minus glyphs sportsbooks use.

// Normalize American odds text → integer (handles −, –, —, U+2212 and +).
function parseAmerican(raw) {
    if (raw == null) return null;
    const s = String(raw).replace(/[−‒–—]/g, '-').replace(/[^0-9+\-]/g, '');
    if (!/^[+\-]?\d{2,7}$/.test(s)) return null;
    return parseInt(s, 10);
}

// American odds → implied probability (0..1), including the book's vig.
function americanToProb(odds) {
    if (odds == null || isNaN(odds)) return null;
    return odds < 0 ? (-odds) / (-odds + 100) : 100 / (odds + 100);
}

// Extract [{ name, odds }] from a pasted block (HTML markers first, else text).
function parseOdds(text) {
    if (!text) return [];
    const out = [];

    // 1. DraftKings HTML: title + odds spans, in order.
    const titles = [...text.matchAll(/button-title[^>]*>([^<]+)</g)].map(m => m[1].trim());
    const odds = [...text.matchAll(/button-odds[^>]*>([^<]+)</g)].map(m => m[1].trim());
    if (titles.length && titles.length === odds.length) {
        titles.forEach((name, i) => {
            const o = parseAmerican(odds[i]);
            if (name && o != null) out.push({ name, odds: o });
        });
        if (out.length) return out;
    }

    // 2. Plain text: team name line(s) then an odds line.
    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    let pendingName = null;
    const isOdds = (l) => parseAmerican(l) != null && /\d/.test(l) && l.replace(/[−‒–—]/g, '-').match(/^[+\-]?\d/);
    lines.forEach(line => {
        // "Team Name  -800" on one line
        const m = line.match(/^(.*?)[\s\t]+([−‒–—+\-]\d{2,7})$/);
        if (m && m[1].trim()) {
            const o = parseAmerican(m[2]);
            if (o != null) { out.push({ name: m[1].trim(), odds: o }); pendingName = null; return; }
        }
        if (isOdds(line)) {
            const o = parseAmerican(line);
            if (o != null && pendingName) { out.push({ name: pendingName, odds: o }); pendingName = null; }
        } else {
            pendingName = line;
        }
    });
    return out;
}

// Case/diacritic/punctuation-insensitive key for matching team names.
function normName(s) {
    return String(s || '')
        .normalize('NFD').replace(/[̀-ͯ]/g, '')  // strip accents
        .toLowerCase()
        .replace(/['’‘`´ʻ]/g, '')                           // delete apostrophes (Hawai'i → hawaii)
        .replace(/[^a-z0-9 ]/g, ' ')                        // &, (), / etc. → space
        .replace(/\bst\b/g, 'state')                        // "app st" → "app state"
        .replace(/\s+/g, ' ').trim();
}

// Build a matcher from team docs (school + all alt names). Returns name → team|null.
function buildTeamMatcher(teams) {
    const index = new Map();
    const add = (key, team) => { const k = normName(key); if (k && !index.has(k)) index.set(k, team); };
    teams.forEach(t => {
        add(t.school, t);
        [t.alt_name1, t.alt_name2, t.alt_name3, ...(t.alternateNames || [])].forEach(a => a && add(a, t));
    });
    return (name) => index.get(normName(name)) || null;
}

module.exports = { parseAmerican, americanToProb, parseOdds, normName, buildTeamMatcher };
