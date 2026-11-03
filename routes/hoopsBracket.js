// The March Madness bracket page and its one read.
//
// ---- who sees it ----
//
// ADMINS ONLY, for now: the site Admin wants to look at it before deciding
// when the league does. Not a commissioner, not a member, not a signed-out
// visitor — so the gate is the Admin role and nothing else (no
// managedLeagues, which would let a commissioner in). Anyone else gets the
// app's plain 404 for the page and a 404 for the data, never a 403: a 403
// says the page exists. Signed out, the page goes to /login like every other
// page; the data is a 404 either way.
//
// The gate is in THIS router, as routes/hoopsAdmin.js keeps its own: the
// path list in server.js gates non-GETs only, and both routes here are GETs.
//
// ---- what it reads ----
//
// Stored rows only — hoopsgames (tournament 'NCAA'), hoopsteams, the league's
// franchises and scoring config. No CBBD call: those are billable against
// the shared 30k pool, and the nightly and live jobs already write every
// NCAA row this needs.

const express = require('express');
const HoopsGame = require('../models/hoopsGame');
const HoopsTeam = require('../models/hoopsTeam');
const seasons = require('../modules/active-season');
const franchiseRepo = require('../modules/franchise-repo');
const leagueSelection = require('../modules/league-selection');
const { effectiveRoles } = require('../modules/dev-role');
const { configFor, rosterIds } = require('../modules/hoops-scoring-pass');
const { entryFor } = require('../modules/roster-teams');
const { ownersByTeam } = require('../modules/hoops-league-scoreboard');
const { buildBracket } = require('../modules/hoops-march-bracket');
const { defaultModel } = require('../modules/hoops-march');
const { resolveConfig } = require('../modules/scoring-defaults');
const { pickLogo } = require('../public/logo.js');

function isAdmin(req) {
    return !!(req.oidc && req.oidc.isAuthenticated() && effectiveRoles(req).includes('Admin'));
}

const NCAA = /^\s*ncaa\s*$/i;

// The basketball league the page is about: the one the client names (its
// ccLeagueCode()), else the viewer's selection — but only a basketball one.
// An Admin may view any league, so naming one is no escalation; the route is
// Admin-only regardless.
async function leagueFor(req) {
    const asked = String((req.query && req.query.league) || '');
    if (asked && seasons.sportForLeague(asked) === 'basketball') return asked;
    let viewing = '';
    try { viewing = await leagueSelection.selectedLeague(req); } catch (e) { viewing = ''; }
    return viewing && seasons.sportForLeague(viewing) === 'basketball' ? viewing : null;
}

// { id: { school, abbr, logo } } for the field. A season whose teams were
// never ingested (a past season, in dev) borrows the nearest season's names
// and logos — a programme's logo does not change with the year.
async function teamMeta(season, ids) {
    if (!ids.length) return {};
    const docs = await HoopsTeam.find({ id: { $in: ids } }, { id: 1, season: 1, school: 1, abbreviation: 1, logos: 1, _id: 0 }).lean();
    const out = {};
    docs.sort((a, b) => Math.abs(a.season - season) - Math.abs(b.season - season))
        .forEach(t => { if (!out[t.id]) out[t.id] = { school: t.school, abbr: t.abbreviation || null, logo: pickLogo(t.logos) || null }; });
    return out;
}

// Before the bracket exists: each team's chance to make the field, from the
// March model the standings projection prices with (modules/hoops-march.js,
// the preseason basis and the preseason rank, as attachMarch defaults). The
// chance is the model's own makeProb, P(a Round-of-64 game): adding the
// play-in losers on top over-counts, because the play-in rung is the 68-team
// curve scaled up, and put every top-15 team at 100%.
async function outlook(season, franchises, owners, viewerId) {
    const mineIds = [];
    (franchises || []).forEach(u => {
        if (viewerId && String(u._id) === String(viewerId)) mineIds.push(...rosterIds(entryFor(u, season)));
    });
    // Not on a roster in this league (an Admin who does not play): the whole
    // league's teams instead, with their owners.
    const ids = mineIds.length ? mineIds : Object.keys(owners).map(Number);
    if (!ids.length) return { mine: !!mineIds.length, teams: [] };
    const [docs, meta] = await Promise.all([
        HoopsTeam.find({ season, id: { $in: ids } }, { id: 1, 'preseason.rank': 1, _id: 0 }).lean(),
        teamMeta(season, ids)
    ]);
    const model = defaultModel();
    const rankOf = {};
    docs.forEach(t => { rankOf[t.id] = t.preseason && t.preseason.rank; });
    const teams = ids.map(id => {
        const p = model.reach(rankOf[id], 'preseason');
        const owner = owners[id] || null;
        return {
            id, name: (meta[id] && meta[id].school) || null, logo: (meta[id] && meta[id].logo) || null,
            rank: rankOf[id] != null ? rankOf[id] : null,
            field: p.r64, opening: p.ff,
            owner: owner ? { initials: owner.initials, name: owner.franchise || owner.name, isMe: !!viewerId && owner.userId === String(viewerId) } : null
        };
    }).sort((a, b) => b.field - a.field);
    return { mine: !!mineIds.length, teams };
}

function build({ pageLocals = () => ({}) } = {}) {
    const router = express.Router();

    router.get('/', (req, res, next) => {
        try {
            if (!(req.oidc && req.oidc.isAuthenticated())) return res.redirect('/login');
            if (!isAdmin(req)) return next();
            const locals = Object.assign({ user: null, userState: null }, pageLocals(req, res));
            res.render('hoopsBracket', locals);
        } catch (err) {
            console.error(`march bracket page: ${err && err.message}`);
            return res.status(500).send('Could not load the bracket');
        }
    });

    router.get('/data', async (req, res) => {
        if (!isAdmin(req)) return res.status(404).json({ message: 'Not found' });
        try {
            const league = await leagueFor(req);
            const current = league ? seasons.seasonForLeague(league) : seasons.activeSeason('basketball');
            const stored = (await HoopsGame.distinct('season', { tournament: NCAA })).map(Number);
            const available = [...new Set(stored.concat(current != null ? [Number(current)] : []))]
                .filter(Number.isFinite).sort((a, b) => b - a);
            const asked = Number(req.query.season);
            const season = Number.isInteger(asked) && available.includes(asked) ? asked : (current != null ? Number(current) : available[0]);
            if (season == null || !Number.isFinite(season)) return res.status(404).json({ message: 'No basketball season is active' });

            const meta = (req.effUser && req.effUser.user_metadata) || {};
            const viewerId = (meta.metadata && meta.metadata.userId) || null;
            const [games, franchises, cfg] = await Promise.all([
                HoopsGame.find({ season, tournament: NCAA }, {
                    id: 1, season: 1, seasonType: 1, startDate: 1, startTimeTbd: 1, status: 1, period: 1, clock: 1,
                    tournament: 1, gameNotes: 1, neutralSite: 1, conferenceGame: 1,
                    homeTeamId: 1, homeTeam: 1, homeSeed: 1, homePoints: 1,
                    awayTeamId: 1, awayTeam: 1, awaySeed: 1, awayPoints: 1, _id: 0
                }).lean(),
                league ? franchiseRepo.byLeagueAndSeason(league, season,
                    { fields: ['firstName', 'lastName', 'color', 'avatarUrl', 'seasons'] }) : [],
                // No basketball league: the default basketball rules, so the
                // pay table still reads true for a new league.
                league ? configFor(league).then(c => c.cfg) : resolveConfig(null, { model: 'hoops' })
            ]);
            const owners = ownersByTeam(franchises, season);
            const ids = [...new Set(games.flatMap(g => [g.homeTeamId, g.awayTeamId]).filter(v => v != null && v !== '').map(Number))].filter(n => Number.isInteger(n) && n > 0);
            const teams = await teamMeta(season, ids);
            const page = buildBracket({ season, games, teams, franchises, owners, cfg, viewerId });
            page.league = league;
            page.seasons = available;
            if (page.state === 'pre') page.outlook = await outlook(season, franchises, owners, viewerId);
            return res.json(page);
        } catch (err) {
            console.error(`march bracket data: ${err && err.message}`);
            return res.status(500).json({ message: 'Could not load the bracket' });
        }
    });

    return router;
}

module.exports = { build, isAdmin };
