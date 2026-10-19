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
//   GET  /leagues/admin/:code/commissioners   who runs it, and who could (Admin)
//   PUT  /leagues/admin/:code/commissioners   {accountIds} — replace the list (Admin)
//
// Step 2's NEW people and step 3's draft settings reuse what already exists
// (POST /users + its invite link, POST /draft), so there is one write path for
// each and no second contract to drift.
//
// ---- who gets in ----
//
// Admins and League Managers (#600); everyone else gets a plain 404 — never a
// 403. The page names basketball leagues, and basketball stays invisible to
// anyone who is not in it (modules/hoops-visibility.js); a 403 says the thing
// exists.
//
// What a League Manager gets is narrower than an Admin's, everywhere:
//   - the list shows only the leagues they may manage (canManageLeague);
//   - a league they create names them its commissioner, which is what lets
//     them run it afterwards — the Auth0 flag can only ever name a football
//     league;
//   - step 2 offers only people they already share a league with. The Admin
//     list is every account in the app, which is not a League Manager's to
//     browse; the email lookup likewise names nobody outside those leagues;
//   - appointing commissioners stays Admin-only.
// An appointed commissioner WITHOUT the role does not get this page: running
// a league is not the same as being trusted to start new ones.
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
const { canManageLeague, accountIdOf } = require('../modules/league-access');

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

// May open this page and create a league: an Admin, or a League Manager.
function canCreate(req) {
    if (!(req.oidc && req.oidc.isAuthenticated())) return false;
    const roles = effectiveRoles(req);
    return roles.includes('Admin') || roles.includes('League Manager');
}

// The leagues a non-Admin may draw people from: the ones they hold a
// franchise in. null for an Admin, meaning "every league".
async function shareableLeagues(req) {
    if (isAdmin(req)) return null;
    const me = accountIdOf(req);
    if (!me || !mongoose.isValidObjectId(me)) return [];
    return Franchise.distinct('league', { accountId: me });
}

// Does this account hold a franchise in one of `leagues`? (null = any.)
async function sharesLeague(accountId, leagues) {
    if (leagues === null) return true;
    if (!leagues.length) return false;
    return !!(await Franchise.exists({ accountId, league: { $in: leagues } }));
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
// two ways a league's season is visibly underway. Before that: Ready to
// draft once it has the managers a draft needs (2+) and a saved draft, so a
// finished setup doesn't keep reading "Setting up"; otherwise setup.
function stateOf({ status, rostered, draftStatus, managers = 0 }) {
    if (status === 'archived') return 'archived';
    if (rostered || draftStatus === 'active' || draftStatus === 'complete') return 'live';
    if (draftStatus && managers >= 2) return 'ready';
    return 'setup';
}

async function rows(req) {
    const [allNamed, docs] = await Promise.all([
        leagueCatalog.named(req),
        League.find({}, { code: 1, sport: 1, season: 1, status: 1, commissioners: 1, _id: 0 }).lean()
    ]);
    const byCode = new Map(docs.map(d => [d.code, d]));
    // A League Manager sees the leagues they run, not every league there is.
    const admin = isAdmin(req);
    const named = admin ? allNamed : allNamed.filter(l => canManageLeague(req, l.code));
    // Commissioner names, for the Admin's Commissioners control only.
    const people = new Map();
    if (admin) {
        const ids = [...new Set(docs.flatMap(d => (d.commissioners || []).map(String)))];
        if (ids.length) {
            (await Account.find({ _id: { $in: ids } }, { firstName: 1, lastName: 1 }).lean())
                .forEach(a => people.set(String(a._id), [a.firstName, a.lastName].filter(Boolean).join(' ')));
        }
    }
    return Promise.all(named.map(async (l) => {
        const doc = byCode.get(l.code) || { code: l.code };
        const sport = doc.sport || 'football';
        const season = seasonOf(doc);
        const [managers, rostered, draft] = await Promise.all([
            Franchise.countDocuments({ league: l.code, 'seasons.season': season }),
            Franchise.exists({ league: l.code, seasons: { $elemMatch: { season, 'teams.0': { $exists: true } } } }),
            Draft.findOne({ league: l.code, season }, { status: 1, _id: 0 }).lean()
        ]);
        const row = {
            code: l.code, name: l.name, sport, season, managers,
            state: stateOf({ status: doc.status, rostered: !!rostered, draftStatus: draft && draft.status, managers })
        };
        if (admin) {
            row.commissioners = (doc.commissioners || []).map(String)
                .map(id => ({ _id: id, name: people.get(id) || 'Unknown account' }));
        }
        return row;
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
//
// For a League Manager, "other leagues" means the ones they play in
// themselves (shareableLeagues): they choose among people they already know,
// not the whole app's membership.
async function candidates(req, league) {
    const from = await shareableLeagues(req);
    const otherLeagues = from === null ? { $ne: league } : { $in: from.filter(c => c !== league) };
    const [others, inLeague, named, docs] = await Promise.all([
        Franchise.find({ league: otherLeagues }, { accountId: 1, league: 1, 'seasons.season': 1, _id: 0 }).lean(),
        Franchise.find({ league }, { accountId: 1, 'seasons.season': 1, _id: 0 }).lean(),
        leagueCatalog.named(req),
        League.find({}, { code: 1, sport: 1, season: 1, _id: 0 }).lean()
    ]);
    // "Already in" means playing THIS season. A former member (a franchise
    // with no entry for it) is offered again, so they can be brought back.
    const docBy = new Map(docs.map(d => [d.code, d]));
    const thisSeason = seasonOf(docBy.get(league) || null);
    const already = new Set(inLeague
        .filter(f => (f.seasons || []).some(s => Number(s.season) === thisSeason))
        .map(f => String(f.accountId)));
    const names = new Map(named.map(l => [l.code, l.name]));
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
        if (!canCreate(req)) return res.status(404).send('Not found');
        const locals = Object.assign({ user: null, userState: null }, pageLocals(req, res));
        return res.render('leagues', Object.assign(locals, {
            isAdmin: isAdmin(req),
            activeSeasons: JSON.stringify({
                football: seasons.activeSeason('football'),
                basketball: seasons.activeSeason('basketball')
            })
        }));
    });

    // Everything under /admin: Admins and League Managers, 404 for anyone
    // else. Each route below then scopes a League Manager to leagues they run.
    router.use('/admin', (req, res, next) => (canCreate(req) ? next() : notFound(res)));

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
        if (!canManageLeague(req, league)) return notFound(res);
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
    // case, the way POST /users stores it.
    //
    // A League Manager is told only that an email outside their own leagues
    // HAS an account — never whose, or its id. They need the "yes" (or they
    // would make that person a second account), but not a way to put names
    // to emails across the app; an Admin adds that person instead.
    router.get('/admin/account', async (req, res) => {
        const email = String(req.query.email || '').trim().toLowerCase();
        const league = String(req.query.league || '');
        if (!email || !league) return res.status(400).json({ message: 'Which email, and which league?' });
        if (!canManageLeague(req, league)) return notFound(res);
        try {
            const escaped = email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const acct = await Account.findOne({ email: new RegExp(`^${escaped}$`, 'i') }, { firstName: 1, lastName: 1 }).lean();
            if (!acct) return res.json({ found: false });
            if (!await sharesLeague(acct._id, await shareableLeagues(req))) {
                return res.json({ found: true, outside: true });
            }
            const doc = await League.findOne({ code: league }, { code: 1, sport: 1, season: 1, _id: 0 }).lean();
            const [inLeague, joined] = await Promise.all([
                // In it THIS season; a former member can be added back.
                Franchise.exists({ accountId: acct._id, league, 'seasons.season': seasonOf(doc) }),
                // Has a team anywhere — THIS league's past seasons included, so
                // someone who only ever played here can come back. No team at
                // all is an account that never finished joining.
                Franchise.exists({ accountId: acct._id })
            ]);
            return res.json({
                found: true, _id: String(acct._id), firstName: acct.firstName, lastName: acct.lastName,
                inLeague: !!inLeague, joined: !!joined
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
        // The creator's account. Refused for a League Manager without one:
        // the league would have no commissioner, and so nobody but an Admin
        // could ever manage it — including the person who just made it.
        const meta = (req.effUser && req.effUser.user_metadata) || {};
        const rawId = meta.metadata && meta.metadata.userId;
        const creatorId = rawId && mongoose.isValidObjectId(rawId) ? String(rawId) : null;
        if (!creatorId && !isAdmin(req)) {
            return res.status(409).json({ message: 'Your login is not linked to a manager yet, so you cannot run a league. Ask an admin.' });
        }
        try {
            const named = await leagueCatalog.named(req);
            if (named.some(l => (l.name || '').trim().toLowerCase() === name.toLowerCase())) {
                // Only an Admin is told it is a league: the list holds leagues
                // a League Manager has no part in, basketball ones included.
                return res.status(409).json({ message: isAdmin(req)
                    ? `There is already a league called "${name}".`
                    : 'That name is not available; try another.' });
            }
            const taken = new Set(named.map(l => l.code)
                .concat((await League.find({}, { code: 1, _id: 0 }).lean()).map(d => d.code)));

            // `season` deliberately unset: the league follows its sport, so it
            // rolls over with it. Set only when a league sits a year out.
            //
            // A League Manager who creates it is its first commissioner
            // (#600) — the only way they can run what they made, since the
            // Auth0 flag names a football league and nothing else. NOT an
            // Admin: the role already runs every league, and a list entry
            // would outlive it — and show up in every dev role-spoof preview
            // of a member, since the list is a fact about the person.
            const commissioners = creatorId && !isAdmin(req) ? [creatorId] : [];
            let doc = null;
            for (let tries = 0; !doc && tries < 3; tries++) {
                const code = codeFor(name, taken);
                try {
                    doc = await League.create({ code, name, sport, status: 'active', commissioners });
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
            // Whoever creates a league plays in it by default: a team under
            // their OWN account (the same login, no invite), like any manager
            // added from another league. Not fatal — the league exists either
            // way, and they can still add themselves on step 2.
            let creatorJoined = false;
            if (creatorId) {
                try {
                    const lastUpdated = new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' });
                    creatorJoined = (await franchiseRepo.addFranchise(creatorId, doc.code, { season, lastUpdated })).created;
                } catch (e) {
                    console.error(`league create: adding the creator failed: ${e && e.message}`);
                }
            }
            // A League Manager's league names them commissioner, and a
            // commissioner must play in their league. If they could not be
            // added, the league is taken back out rather than left with a
            // commissioner who is not in it. Nobody else is in it yet — it
            // was made a moment ago — so nothing is lost. An Admin's league
            // has no list, so for them joining stays optional, as before.
            if (commissioners.length && !creatorJoined) {
                await League.deleteOne({ _id: doc._id });
                await seasons.prime().catch(e => console.error(`league create: re-prime failed: ${e && e.message}`));
                return res.status(500).json({ message: 'Could not create the league' });
            }
            await audit.record(req, {
                action: 'league.create', league: doc.code, season: String(season),
                summary: `Created ${sport} league "${doc.name}"` + (creatorJoined ? ', and joined it' : ''),
                meta: { sport, creatorJoined, commissioners }
            });
            return res.status(201).json({ code: doc.code, name: doc.name, sport, season, creatorJoined });
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
        if (!canManageLeague(req, code)) return notFound(res);
        try {
            const doc = await League.findOne({ code }).lean();
            if (!doc || doc.status === 'archived') return notFound(res);
            const season = seasonOf(doc);
            const lastUpdated = new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' });
            // A League Manager adds only people they share a league with —
            // the same people step 2 offered them. Anyone else is refused,
            // whatever id the browser sends.
            const from = await shareableLeagues(req);

            const added = [];
            const already = [];
            const refused = [];
            for (const id of [...new Set(ids.map(String))]) {
                // Anyone with a team somewhere — another league, or a past
                // season of this one. An account with no franchise anywhere is
                // someone who never finished joining, and belongs to Add a
                // Player's invite.
                const joined = await Franchise.exists({ accountId: id });
                if (!joined || !await sharesLeague(id, from)) { refused.push(id); continue; }
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

    // ---- commissioners (#600) — Admin only ----
    //
    // Who may manage a league besides an Admin. Read by canManageLeague,
    // the draft socket and both admin pages, all through the season cache —
    // so every write re-primes it, or this dyno would go on answering from
    // the old list until the next interval.
    //
    // Only someone with a team IN that league may be appointed: a
    // commissioner who does not play in their league is not a thing this app
    // has (Graham, #602). No route ever deletes a franchise, so checking here,
    // at the only write, keeps it true. Removing the last commissioner is
    // allowed: the league falls back to Admins only.
    router.get('/admin/:code/commissioners', async (req, res) => {
        if (!isAdmin(req)) return notFound(res);
        const code = req.params.code;
        try {
            const doc = await League.findOne({ code }, { code: 1, sport: 1, season: 1, commissioners: 1, _id: 0 }).lean();
            if (!doc) return notFound(res);
            const season = seasonOf(doc);
            const memberIds = (await Franchise.find({ league: code, 'seasons.season': season }, { accountId: 1, _id: 0 }).lean())
                .map(f => String(f.accountId));
            const ids = [...new Set(memberIds.concat((doc.commissioners || []).map(String)))];
            // `members` is THIS season's; a commissioner who sat it out still
            // has a franchise here, so they are offered too, and can be kept.
            const people = new Map((await Account.find({ _id: { $in: ids } }, { firstName: 1, lastName: 1 }).lean())
                .map(a => [String(a._id), [a.firstName, a.lastName].filter(Boolean).join(' ')]));
            const person = id => ({ _id: id, name: people.get(id) || 'Unknown account' });
            return res.json({
                commissioners: (doc.commissioners || []).map(String).map(person),
                members: ids.map(person).sort((a, b) => a.name.localeCompare(b.name))
            });
        } catch (err) {
            console.error(`league commissioners read: ${err && err.message}`);
            return res.status(500).json({ message: 'Could not read the commissioners' });
        }
    });

    router.put('/admin/:code/commissioners', async (req, res) => {
        if (!isAdmin(req)) return notFound(res);
        const code = req.params.code;
        const ids = (req.body && req.body.accountIds);
        if (!Array.isArray(ids)) return res.status(400).json({ message: 'accountIds must be a list.' });
        if (ids.length > MEMBERS_MAX) return res.status(400).json({ message: `At most ${MEMBERS_MAX}.` });
        if (!ids.every(id => mongoose.isValidObjectId(id))) return res.status(400).json({ message: 'Unknown account.' });
        const wanted = [...new Set(ids.map(String))];
        try {
            const doc = await League.findOne({ code }, { commissioners: 1 }).lean();
            if (!doc) return notFound(res);
            // Every id must be a real account. An unknown one would sit on the
            // list granting nothing — and read as a commissioner to whoever
            // looks at the document later.
            const found = await Account.find({ _id: { $in: wanted } }, { firstName: 1, lastName: 1 }).lean();
            if (found.length !== wanted.length) return res.status(400).json({ message: 'Unknown account.' });
            const members = new Set((await Franchise.distinct('accountId', { league: code, accountId: { $in: wanted } })).map(String));
            const outside = wanted.filter(id => !members.has(id));
            if (outside.length) {
                return res.status(400).json({ message: 'A commissioner has to be in the league. Add them as a manager first.' });
            }
            const before = (doc.commissioners || []).map(String);
            await League.updateOne({ code }, { $set: { commissioners: wanted } });
            // Saved either way; a failed re-prime is caught up by the
            // interval, and must not report a saved list as a failure.
            await seasons.prime().catch(e => console.error(`league commissioners: re-prime failed: ${e && e.message}`));
            const name = id => {
                const a = found.find(x => String(x._id) === id);
                return a ? [a.firstName, a.lastName].filter(Boolean).join(' ') : id;
            };
            const added = wanted.filter(id => !before.includes(id));
            const removed = before.filter(id => !wanted.includes(id));
            if (added.length || removed.length) {
                await audit.record(req, {
                    action: 'league.commissioners', league: code,
                    summary: [
                        added.length ? `Made ${added.map(name).join(', ')} commissioner` : '',
                        removed.length ? `Removed ${removed.length} commissioner${removed.length === 1 ? '' : 's'}` : ''
                    ].filter(Boolean).join('; '),
                    meta: { before, after: wanted }
                });
            }
            return res.json({ commissioners: wanted.map(id => ({ _id: id, name: name(id) })) });
        } catch (err) {
            console.error(`league commissioners write: ${err && err.message}`);
            return res.status(500).json({ message: 'Could not save the commissioners' });
        }
    });

    // "Manage": view that league, then open its sport's admin page — which
    // follows the league being viewed. The same cookie and the same check
    // POST /league/select uses.
    router.get('/admin/:code/open', async (req, res) => {
        const code = req.params.code;
        try {
            // A League Manager opens only a league they run — which, a
            // commissioner always being a member, they can also view.
            if (!isAdmin(req) && !canManageLeague(req, code)) return res.status(404).send('Not found');
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
