// The Leagues page (#536): every league an Admin runs, both sports, and the
// three-step "Create league".
//
// Graham's call on #536 (Option 1): one sport-neutral page rather than a
// section on each sport's admin page. It is also how an Admin reaches a
// sport's admin page at all — /hoops/admin follows the league being VIEWED,
// so with no basketball league to switch to it could not be opened. "Manage"
// here selects the league first and then lands on its page.
//
//   GET  /leagues                         the page (HTML only — see below)
//   GET  /leagues/admin/rows              one row per league
//   GET  /leagues/admin/candidates        managers from the other leagues
//   POST /leagues/admin                   step 1: create the League record
//   POST /leagues/admin/:code/members     step 2: existing managers join it
//   GET  /leagues/admin/:code/open        select it, then its admin page
//
// Step 2's NEW people and step 3's draft settings reuse what already exists
// (POST /users + its invite link, POST /draft), so there is one write path for
// each and no second contract to drift.
//
// ---- who gets in ----
//
// Admins only, everywhere, and everyone else gets a plain 404 — never a 403.
// The page names basketball leagues, and basketball stays invisible to anyone
// who is not in it (modules/hoops-visibility.js); a 403 says the thing exists.
// League Managers too: creating a league is not a league-scoped power, and a
// football commissioner is not in on basketball.
//
// The gate is in THIS router. server.js's path list sends non-GETs on /leagues
// through requireCommissioner, which a League Manager passes, and lets every
// GET through.
//
// ---- GET /leagues is shared ----
//
// routes/leagues.js already answers GET /leagues with JSON (the admin page's
// rename form reads it). The page takes the request only when the browser
// asked for HTML; a fetch asking for JSON falls through untouched.

const express = require('express');
const mongoose = require('mongoose');
const League = require('../models/league');
const Account = require('../models/account');
const Franchise = require('../models/franchise');
const Draft = require('../models/draft');
const audit = require('../modules/audit-log');
const seasons = require('../modules/active-season');
const leagueCatalog = require('../modules/league-catalog');
const leagueSelection = require('../modules/league-selection');
const franchiseRepo = require('../modules/franchise-repo');
const { effectiveRoles } = require('../modules/dev-role');

const SPORTS = ['football', 'basketball'];
const NAME_MAX = 40;
// Most managers anyone could tick in one go; a guard on the loop below, not a
// league-size rule.
const MEMBERS_MAX = 30;
// Codes that would read as something else in a URL under /leagues.
const RESERVED = new Set(['admin', 'new', 'select']);

function isAdmin(req) {
    return !!(req.oidc && req.oidc.isAuthenticated() && effectiveRoles(req).includes('Admin'));
}

function notFound(res) {
    return res.status(404).json({ message: 'Not found' });
}

// A league's code from its name: lowercase, dashes, ASCII. Codes go into
// URLs, cookies and every Mongo query, and are never shown — the name is.
function slugFor(name) {
    const s = String(name || '').toLowerCase()
        .normalize('NFKD').replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 32)
        .replace(/-+$/, '');
    return s || 'league';
}

// The first free code for a name. `taken` includes the hardcoded football
// leagues, which may not have a document yet.
function codeFor(name, taken) {
    const base = slugFor(name);
    let code = base;
    for (let n = 2; taken.has(code) || RESERVED.has(code); n++) code = `${base}-${n}`;
    return code;
}

// The season a league plays. Read from the DOCUMENT rather than the season
// cache: the cache is primed per dyno on an interval, so a league created a
// moment ago may not be in it yet — and then it reads as football's season,
// which is the wrong year for a basketball league.
function seasonOf(doc) {
    const own = doc && doc.season != null ? Number(doc.season) : NaN;
    if (Number.isFinite(own)) return own;
    return seasons.activeSeason((doc && doc.sport) || 'football');
}

// Live, Setting up, or Archived.
//
// Live once anyone holds a team this season or the draft has started — the
// two ways a league's season is visibly underway. Everything before that is
// setup, which is where a newly created league sits until its draft.
function stateOf({ status, rostered, draftStatus }) {
    if (status === 'archived') return 'archived';
    if (rostered || draftStatus === 'active' || draftStatus === 'complete') return 'live';
    return 'setup';
}

async function rows(req) {
    const [named, docs] = await Promise.all([
        leagueCatalog.named(req),
        League.find({}, { code: 1, sport: 1, season: 1, status: 1, _id: 0 }).lean()
    ]);
    const byCode = new Map(docs.map(d => [d.code, d]));
    return Promise.all(named.map(async (l) => {
        const doc = byCode.get(l.code) || { code: l.code };
        const sport = doc.sport || 'football';
        const season = seasonOf(doc);
        const [managers, rostered, draft] = await Promise.all([
            Franchise.countDocuments({ league: l.code, 'seasons.season': season }),
            Franchise.exists({ league: l.code, seasons: { $elemMatch: { season, 'teams.0': { $exists: true } } } }),
            Draft.findOne({ league: l.code, season }, { status: 1, _id: 0 }).lean()
        ]);
        return {
            code: l.code, name: l.name, sport, season, managers,
            state: stateOf({ status: doc.status, rostered: !!rostered, draftStatus: draft && draft.status })
        };
    }));
}

// Everyone who plays in some OTHER league, once each, with the leagues they
// are in — the people step 2 can add without an invite. Someone already in
// `league` is left out rather than shown pre-ticked: there is nothing to do
// for them, and a ticked box you cannot untick reads as a bug.
//
// A league they hold a franchise in but are not playing THIS season is marked
// "(past)": someone who left a league is still a person you might invite
// back, but the Admin should be able to tell them apart from a current player.
async function candidates(req, league) {
    const [others, inLeague, named, docs] = await Promise.all([
        Franchise.find({ league: { $ne: league } }, { accountId: 1, league: 1, 'seasons.season': 1, _id: 0 }).lean(),
        Franchise.find({ league }, { accountId: 1, _id: 0 }).lean(),
        leagueCatalog.named(req),
        League.find({}, { code: 1, sport: 1, season: 1, _id: 0 }).lean()
    ]);
    const already = new Set(inLeague.map(f => String(f.accountId)));
    const names = new Map(named.map(l => [l.code, l.name]));
    const docBy = new Map(docs.map(d => [d.code, d]));
    const leaguesBy = new Map();
    others.forEach(f => {
        const id = String(f.accountId);
        if (already.has(id)) return;
        if (!leaguesBy.has(id)) leaguesBy.set(id, []);
        const season = seasonOf(docBy.get(f.league) || null);
        const current = (f.seasons || []).some(s => Number(s.season) === season);
        leaguesBy.get(id).push((names.get(f.league) || f.league) + (current ? '' : ' (past)'));
    });
    if (!leaguesBy.size) return [];
    const accounts = await Account.find(
        { _id: { $in: [...leaguesBy.keys()] } },
        { firstName: 1, lastName: 1, avatarUrl: 1, color: 1 }
    ).lean();
    return accounts
        .map(a => ({
            _id: String(a._id), firstName: a.firstName, lastName: a.lastName,
            avatarUrl: a.avatarUrl || null, color: a.color || null,
            leagues: leaguesBy.get(String(a._id)).sort()
        }))
        .sort((a, b) => (a.lastName || '').localeCompare(b.lastName || '')
            || (a.firstName || '').localeCompare(b.firstName || ''));
}

// pageLocals builds what the navbar partial needs; injected from server.js so
// a test can mount the real router without the whole app (as hoopsAdmin does).
function build({ pageLocals = () => ({}) } = {}) {
    const router = express.Router();

    router.get('/', (req, res, next) => {
        // One URL, two representations: say so, so no cache hands the page
        // to the fetch or the JSON to the browser.
        res.vary('Accept');
        // A JSON read of the league list: routes/leagues.js's, not ours.
        if (req.accepts(['json', 'html']) !== 'html') return next();
        if (!(req.oidc && req.oidc.isAuthenticated())) return res.redirect('/login');
        if (!isAdmin(req)) return res.status(404).send('Not found');
        const locals = Object.assign({ user: null, userState: null }, pageLocals(req, res));
        return res.render('leagues', Object.assign(locals, {
            activeSeasons: JSON.stringify({
                football: seasons.activeSeason('football'),
                basketball: seasons.activeSeason('basketball')
            })
        }));
    });

    // Everything under /admin is Admin-only, and 404 for anyone else.
    router.use('/admin', (req, res, next) => (isAdmin(req) ? next() : notFound(res)));

    router.get('/admin/rows', async (req, res) => {
        try {
            return res.json(await rows(req));
        } catch (err) {
            console.error(`leagues rows: ${err && err.message}`);
            return res.status(500).json({ message: 'Could not read the leagues' });
        }
    });

    router.get('/admin/candidates', async (req, res) => {
        const league = String(req.query.league || '');
        if (!league) return res.status(400).json({ message: 'Which league?' });
        try {
            return res.json(await candidates(req, league));
        } catch (err) {
            console.error(`leagues candidates: ${err && err.message}`);
            return res.status(500).json({ message: 'Could not read the managers' });
        }
    });

    // Step 2's "someone new" checks the email here FIRST. Add a Player always
    // makes an Account, so typing in an existing person's email would give
    // them a second one — a franchise nobody can log in as. Matched without
    // case, the way POST /users stores it. Admin-only like everything here,
    // so this is not a way to probe who has an account.
    router.get('/admin/account', async (req, res) => {
        const email = String(req.query.email || '').trim().toLowerCase();
        const league = String(req.query.league || '');
        if (!email || !league) return res.status(400).json({ message: 'Which email, and which league?' });
        try {
            const escaped = email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const acct = await Account.findOne({ email: new RegExp(`^${escaped}$`, 'i') }, { firstName: 1, lastName: 1 }).lean();
            if (!acct) return res.json({ found: false });
            const [inLeague, elsewhere] = await Promise.all([
                Franchise.exists({ accountId: acct._id, league }),
                Franchise.exists({ accountId: acct._id, league: { $ne: league } })
            ]);
            return res.json({
                found: true, _id: String(acct._id), firstName: acct.firstName, lastName: acct.lastName,
                inLeague: !!inLeague, elsewhere: !!elsewhere
            });
        } catch (err) {
            console.error(`leagues account lookup: ${err && err.message}`);
            return res.status(500).json({ message: 'Could not check that email' });
        }
    });

    // Step 1: sport and name. The season is the sport's own, so a league is
    // never created into a year its sport is not playing.
    router.post('/admin', async (req, res) => {
        const body = req.body || {};
        const sport = String(body.sport || '');
        const name = String(body.name || '').trim();
        if (!SPORTS.includes(sport)) return res.status(400).json({ message: 'Pick football or basketball.' });
        if (!name) return res.status(400).json({ message: 'The league needs a name.' });
        if (name.length > NAME_MAX) return res.status(400).json({ message: `Name too long (${NAME_MAX} characters max)` });

        const season = seasons.activeSeason(sport);
        if (!Number.isFinite(season)) {
            return res.status(409).json({ message: `There is no ${sport} season set yet, so there is nothing to create a league in.` });
        }
        try {
            const named = await leagueCatalog.named(req);
            if (named.some(l => (l.name || '').trim().toLowerCase() === name.toLowerCase())) {
                return res.status(409).json({ message: `There is already a league called "${name}".` });
            }
            const taken = new Set(named.map(l => l.code)
                .concat((await League.find({}, { code: 1, _id: 0 }).lean()).map(d => d.code)));

            // `season` deliberately unset: the league follows its sport, so it
            // rolls over with it. Set only when a league sits a year out.
            let doc = null;
            for (let tries = 0; !doc && tries < 3; tries++) {
                const code = codeFor(name, taken);
                try {
                    doc = await League.create({ code, name, sport, status: 'active' });
                } catch (e) {
                    if (!(e && e.code === 11000)) throw e;
                    taken.add(code);    // created between our read and our write
                }
            }
            if (!doc) return res.status(409).json({ message: 'Could not find a free code for that name; try another.' });

            // This dyno knows the new league's sport at once. Other dynos pick
            // it up on their next re-prime (a minute at most); the routes on
            // this page read the document, not the cache, for that reason.
            // Not fatal: the league is written, and a 500 here would tell the
            // Admin it was not — then refuse the retry as a duplicate name.
            // The interval re-prime, and /open below, catch this dyno up.
            await seasons.prime().catch(e => console.error(`league create: re-prime failed: ${e && e.message}`));
            await audit.record(req, {
                action: 'league.create', league: doc.code, season: String(season),
                summary: `Created ${sport} league "${doc.name}"`,
                meta: { sport }
            });
            return res.status(201).json({ code: doc.code, name: doc.name, sport, season });
        } catch (err) {
            console.error(`league create: ${err && err.message}`);
            return res.status(500).json({ message: 'Could not create the league' });
        }
    });

    // Step 2: existing managers join under their SAME account. No Account is
    // created, no invite is needed — they switch to it with the login they
    // already have.
    router.post('/admin/:code/members', async (req, res) => {
        const code = req.params.code;
        const ids = (req.body && req.body.accountIds) || [];
        if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ message: 'Tick at least one manager.' });
        if (ids.length > MEMBERS_MAX) return res.status(400).json({ message: `At most ${MEMBERS_MAX} at a time.` });
        if (!ids.every(id => mongoose.isValidObjectId(id))) return res.status(400).json({ message: 'Unknown manager.' });
        try {
            const doc = await League.findOne({ code }).lean();
            if (!doc || doc.status === 'archived') return notFound(res);
            const season = seasonOf(doc);
            const lastUpdated = new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' });

            const added = [];
            const already = [];
            const refused = [];
            for (const id of [...new Set(ids.map(String))]) {
                // From the other leagues, which is what this step offers. An
                // account with no franchise anywhere is someone who never
                // finished joining, and belongs to Add a Player's invite.
                const elsewhere = await Franchise.exists({ accountId: id, league: { $ne: code } });
                if (!elsewhere) { refused.push(id); continue; }
                const out = await franchiseRepo.addFranchise(id, code, { season, lastUpdated });
                (out.created ? added : already).push(id);
            }

            if (added.length) {
                const people = await Account.find({ _id: { $in: added } }, { firstName: 1, lastName: 1 }).lean();
                await audit.record(req, {
                    action: 'league.members', league: code, season: String(season),
                    summary: `Added ${people.map(p => `${p.firstName} ${p.lastName}`).join(', ')} from other leagues`,
                    meta: { accountIds: added }
                });
            }
            return res.json({ added, already, refused, season });
        } catch (err) {
            console.error(`league members: ${err && err.message}`);
            return res.status(500).json({ message: 'Could not add those managers' });
        }
    });

    // "Manage": view that league, then open its sport's admin page — which
    // follows the league being viewed. The same cookie and the same check
    // POST /league/select uses.
    router.get('/admin/:code/open', async (req, res) => {
        const code = req.params.code;
        try {
            if (!await leagueSelection.maySelect(req, code)) return res.status(404).send('Not found');
            const doc = await League.findOne({ code }, { sport: 1, _id: 0 }).lean();
            const sport = (doc && doc.sport) || 'football';
            // A league made on another dyno a moment ago: without this the
            // admin page would read it as football and send a basketball
            // league to football's tools.
            if (seasons.sportForLeague(code) !== sport) await seasons.prime();
            res.cookie(leagueSelection.COOKIE, code, leagueSelection.COOKIE_OPTS);
            return res.redirect(sport === 'basketball' ? '/hoops/admin' : '/admin');
        } catch (err) {
            console.error(`league open: ${err && err.message}`);
            return res.status(500).send('Could not open that league');
        }
    });

    return router;
}

module.exports = { build, slugFor, codeFor, stateOf, seasonOf, rows, candidates };
