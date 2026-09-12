// Web Push fan-out for game-day alerts.
//
// modules/score-events.js decides WHAT happened; this decides WHO hears about
// it and says it in words. Split that way so the interesting live-game logic is
// unit-testable without a push service, and so the recipient rules (which are
// the part that can leak someone else's notifications) are in one auditable file.
//
// Delivery is Web Push (VAPID), not APNs: iOS 16.4+ supports it for a PWA the
// user has added to the home screen, which costs nothing and needs no Apple
// Developer account or App Store review. The catch that shapes the UI is that
// iOS will not even show a permission prompt to a plain Safari tab — the site
// must be installed first. public/push-alerts.js is what explains that.
//
// ---- ROLLOUT GATE -----------------------------------------------------------
// PUSH_RECIPIENT_IDS is an allowlist of User _ids that may receive a push. It
// FAILS CLOSED: unset or empty means nobody is notified, and the reason is
// logged once per process rather than silently. That is deliberate for the
// initial deploy — the alerts run live against a real Saturday for one person
// (the admin) before the rest of the league can be woken up by a bug in them.
// Widening the rollout is an env var change, not a deploy.
//
// The gate is applied at SEND time, not at subscribe time, and not in the UI.
// A client-side gate would be cosmetic, and gating subscription would mean
// re-subscribing every device when the rollout widens.

const webpush = require('web-push');
const User = require('../models/user');
const Game = require('../models/game');
const { activeSeason } = require('./active-season');
const scoringModule = require('./scoring');

// ---- config ----------------------------------------------------------------

function vapidConfig() {
    return {
        publicKey: process.env.VAPID_PUBLIC_KEY || '',
        privateKey: process.env.VAPID_PRIVATE_KEY || '',
        subject: process.env.VAPID_SUBJECT || 'mailto:admin@example.com'
    };
}

function isConfigured() {
    const c = vapidConfig();
    return !!(c.publicKey && c.privateKey);
}

let vapidApplied = false;
function applyVapid() {
    if (vapidApplied || !isConfigured()) return isConfigured();
    const c = vapidConfig();
    webpush.setVapidDetails(c.subject, c.publicKey, c.privateKey);
    vapidApplied = true;
    return true;
}

// Parsed allowlist of User _ids. Comma-separated, whitespace tolerated.
function allowlist() {
    return new Set(
        String(process.env.PUSH_RECIPIENT_IDS || '')
            .split(',')
            .map(s => s.trim())
            .filter(Boolean)
    );
}

function isAllowedRecipient(userId) {
    return allowlist().has(String(userId));
}

// Logged once per process so an empty allowlist is visibly a choice rather than
// a silent dead feature — the exact failure mode that makes push feel broken.
let warnedEmptyAllowlist = false;
function warnIfClosed() {
    if (warnedEmptyAllowlist) return;
    if (!allowlist().size) {
        console.log('Push: PUSH_RECIPIENT_IDS is empty — no game alerts will be sent to anyone.');
        warnedEmptyAllowlist = true;
    }
}

// ---- payload building (pure, unit-tested) ----------------------------------

// Scoreline in the conventional away-at-home order, so it reads the way a
// scoreboard does rather than the way the DB stores it.
function scoreline(game, homePoints, awayPoints) {
    return `${game.awayTeam} ${awayPoints} – ${game.homeTeam} ${homePoints}`;
}

// "Q3 · 4:12", or just "Q3" between periods when CFBD withholds the clock, or
// '' when we know neither. Never fabricates a clock.
function clockLabel(period, clock) {
    if (typeof period !== 'number') return '';
    const q = period > 4 ? `OT${period - 4}` : `Q${period}`;
    return clock ? `${q} · ${clock}` : q;
}

function teamNameFor(game, side) {
    return side === 'home' ? game.homeTeam : game.awayTeam;
}

// Turn a detected event into notification text. `tag` collapses same-game
// notifications on the device so a busy game replaces its own banner instead of
// stacking six of them.
function buildPayload(event, game) {
    const line = scoreline(game, event.homePoints, event.awayPoints);
    const when = clockLabel(event.period, event.clock);
    const suffix = when ? ` · ${when}` : '';
    const url = `/game/${game.id}`;

    if (event.type === 'score') {
        const team = teamNameFor(game, event.side);
        return {
            type: 'score',
            title: `${team} scored`,
            body: `${line}${suffix}`,
            url,
            tag: `game-${game.id}`
        };
    }
    if (event.type === 'leadChange') {
        const team = teamNameFor(game, event.side);
        return {
            type: 'leadChange',
            title: `${team} takes the lead`,
            body: `${line}${suffix}`,
            url,
            tag: `game-${game.id}`
        };
    }
    if (event.type === 'closeGame') {
        return {
            type: 'closeGame',
            title: 'Crunch time',
            body: `${line}${suffix}`,
            url,
            tag: `game-${game.id}`
        };
    }
    return null;
}

// Final-result text for ONE manager's rostered team, including what the game
// actually banked for them. `explain` is modules/scoring.js explainGame output:
// { matched: [{label, points}], total }. Both leagues score on wins, so a loss
// legitimately reads as zero — saying so out loud is the point of the alert.
function buildFinalPayload(game, teamName, explain) {
    const homeWon = game.homePoints > game.awayPoints;
    const tied = game.homePoints === game.awayPoints;
    const isHome = teamName === game.homeTeam;
    const won = !tied && (isHome ? homeWon : !homeWon);
    const total = (explain && explain.total) || 0;
    const labels = (explain && explain.matched || []).map(m => m.label).join(' + ');

    let title;
    if (tied) title = `${game.awayTeam} ${game.awayPoints} – ${game.homeTeam} ${game.homePoints}`;
    else title = won ? `${teamName} won` : `${teamName} lost`;

    const body = total > 0
        ? `+${total} pts${labels ? ` — ${labels}` : ''} · ${scoreline(game, game.homePoints, game.awayPoints)}`
        : `No points · ${scoreline(game, game.homePoints, game.awayPoints)}`;

    return { type: 'final', title, body, url: `/game/${game.id}`, tag: `final-${game.id}` };
}

// ---- recipients -------------------------------------------------------------

// Managers who roster either team in this game, for the active season, and who
// have at least one push subscription. The allowlist is applied here so it
// cannot be forgotten by a caller.
//
// Returns [{ user, teamIds }] where teamIds are the rostered teams involved —
// a manager can roster BOTH sides of a game, which is why this is a list.
async function recipientsFor(game, season) {
    const teamIds = [game.homeId, game.awayId].filter(id => id != null);
    if (!teamIds.length) return [];

    const ids = [...allowlist()];
    if (!ids.length) return [];

    const users = await User.find({
        _id: { $in: ids },
        pushSubscriptions: { $exists: true, $ne: [] },
        seasons: { $elemMatch: { season, 'teams.id': { $in: teamIds } } }
    }, { firstName: 1, league: 1, pushSubscriptions: 1, pushPrefs: 1, seasons: 1 }).lean();

    return users.map(user => {
        const entry = (user.seasons || []).find(s => Number(s.season) === Number(season));
        const rostered = ((entry && entry.teams) || [])
            .map(t => t.id)
            .filter(id => teamIds.includes(id));
        return { user, teamIds: rostered };
    }).filter(r => r.teamIds.length);
}

// Has this manager muted this alert type? Unset prefs mean "all on".
function wantsType(user, type) {
    const prefs = user.pushPrefs;
    if (!prefs) return true;
    return prefs[type] !== false;
}

// ---- sending ----------------------------------------------------------------

// Push a payload to every device a manager has registered. A subscription the
// push service rejects as gone (404/410) is deleted — that is the normal end of
// life for one, e.g. the manager removed the home-screen icon.
async function sendToUser(user, payload) {
    if (!applyVapid()) return { sent: 0, pruned: 0 };
    const subs = user.pushSubscriptions || [];
    let sent = 0;
    const dead = [];

    for (const sub of subs) {
        try {
            await webpush.sendNotification(
                { endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } },
                JSON.stringify(payload)
            );
            sent++;
        } catch (err) {
            if (err && (err.statusCode === 404 || err.statusCode === 410)) {
                dead.push(sub.endpoint);
            } else {
                console.log(`Push: send failed for ${user._id}: ${err && err.message}`);
            }
        }
    }

    if (dead.length) {
        try {
            await User.updateOne(
                { _id: user._id },
                { $pull: { pushSubscriptions: { endpoint: { $in: dead } } } }
            );
        } catch (e) { /* non-fatal: retried on the next send */ }
    }

    return { sent, pruned: dead.length };
}

// ---- entry points -----------------------------------------------------------

// Live in-game events. Called from modules/score-update.js with the events a
// tick produced, keyed by game id.
//
// Wrapped so it can NEVER take the poller down: an alert is a nicety, scoring is
// not, and the poller runs every 10 seconds.
async function notifyEvents(eventsByGameId) {
    warnIfClosed();
    if (!isConfigured() || !allowlist().size) return { sent: 0 };
    const gameIds = Object.keys(eventsByGameId).map(Number).filter(n => !Number.isNaN(n));
    if (!gameIds.length) return { sent: 0 };

    const season = activeSeason('football');
    let sent = 0;

    try {
        const games = await Game.find(
            { id: { $in: gameIds } },
            { id: 1, homeId: 1, awayId: 1, homeTeam: 1, awayTeam: 1 }
        ).lean();

        for (const game of games) {
            const events = eventsByGameId[game.id] || eventsByGameId[String(game.id)] || [];
            if (!events.length) continue;
            const recipients = await recipientsFor(game, season);
            if (!recipients.length) continue;

            for (const event of events) {
                const payload = buildPayload(event, game);
                if (!payload) continue;
                for (const { user, teamIds } of recipients) {
                    // A `score` or `leadChange` is about one specific side. Only
                    // tell a manager when the side in question is THEIR team —
                    // otherwise rostering the opponent means being notified that
                    // you are losing, which is not what was asked for.
                    if (event.side) {
                        const sideId = event.side === 'home' ? game.homeId : game.awayId;
                        if (!teamIds.includes(sideId)) continue;
                    }
                    if (!wantsType(user, payload.type)) continue;
                    const res = await sendToUser(user, payload);
                    sent += res.sent;
                }
            }
        }
    } catch (err) {
        console.log(`Push: notifyEvents failed: ${err && err.message}`);
    }

    return { sent };
}

// Games that just went final. Separate from notifyEvents because the banked
// points need an async scoring lookup (config + rankings + bracket), and because
// both leagues score on wins — this is the only alert of the four that reports a
// change to a manager's actual total.
async function notifyFinals(gameIds) {
    warnIfClosed();
    if (!isConfigured() || !allowlist().size) return { sent: 0 };
    const ids = (gameIds || []).map(Number).filter(n => !Number.isNaN(n));
    if (!ids.length) return { sent: 0 };

    const season = activeSeason('football');
    let sent = 0;

    try {
        const games = await Game.find({ id: { $in: ids } }).lean();
        const cfgCache = new Map();
        // Shared by getRankingsForGame and getBracketForGame — they use
        // distinct key prefixes, so one Map serves both.
        const scoringCache = new Map();

        for (const game of games) {
            const recipients = await recipientsFor(game, season);
            if (!recipients.length) continue;

            for (const { user, teamIds } of recipients) {
                if (!wantsType(user, 'final')) continue;

                // Per-league config: the two leagues score the same game
                // differently, so the points in the alert have to be the ones
                // THIS manager actually banked.
                let cfg = cfgCache.get(user.league);
                if (!cfg) {
                    cfg = await scoringModule.getScoringConfig(user.league);
                    cfgCache.set(user.league, cfg);
                }
                const rankings = await scoringModule.getRankingsForGame(game, game.week, season, scoringCache);
                // Share the cache: getBracketForGame keys on `bracket|<season>`,
                // so without it the identical CFP bracket is re-fetched over
                // HTTP once per game per manager.
                const bracket = await scoringModule.getBracketForGame(game, season, scoringCache);

                for (const teamId of teamIds) {
                    const teamName = teamId === game.homeId ? game.homeTeam : game.awayTeam;
                    let explain = null;
                    try {
                        explain = scoringModule.explainGame(cfg.model, { id: teamId, school: teamName }, game, rankings, cfg, bracket);
                    } catch (e) {
                        // A breakdown we couldn't compute still deserves the
                        // result — buildFinalPayload reads a null explain as
                        // zero, which is the honest fallback.
                    }
                    const payload = buildFinalPayload(game, teamName, explain);
                    const res = await sendToUser(user, payload);
                    sent += res.sent;
                }
            }
        }
    } catch (err) {
        console.log(`Push: notifyFinals failed: ${err && err.message}`);
    }

    return { sent };
}

// One-off delivery used by the "send me a test" button, so a manager can prove
// the whole chain works without waiting for a Saturday.
async function sendTest(userId) {
    if (!applyVapid()) return { sent: 0, reason: 'VAPID keys not configured' };
    if (!isAllowedRecipient(userId)) return { sent: 0, reason: 'Not on the alert allowlist yet' };
    const user = await User.findById(userId, { pushSubscriptions: 1, firstName: 1 }).lean();
    if (!user) return { sent: 0, reason: 'User not found' };
    const res = await sendToUser(user, {
        type: 'test',
        title: 'Campus Clash alerts are on',
        body: "You'll get these when your teams score, take the lead, or finish.",
        url: '/standings',
        tag: 'test'
    });
    return { sent: res.sent, pruned: res.pruned };
}

module.exports = {
    notifyEvents,
    notifyFinals,
    sendTest,
    isConfigured,
    vapidConfig,
    isAllowedRecipient,
    // exported for reuse/tests:
    buildPayload, buildFinalPayload, scoreline, clockLabel, wantsType, allowlist, recipientsFor
};
