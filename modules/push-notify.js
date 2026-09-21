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
// ---- WHO GETS ONE -----------------------------------------------------------
// Turning alerts on is the manager's own decision: anyone with a registered
// device and a rostered team in the game is notified. The rollout is over, so
// the opt-in IS the gate — no admin has to add anyone to a list.
//
// PUSH_RECIPIENT_IDS survives as a NARROWING override, not the gate. Set it to a
// comma-separated list of User _ids and only those ids are notified; leave it
// unset (the normal state) and every subscribed manager is. That inverts what it
// used to mean — empty was "nobody" during the initial deploy — so clearing the
// var in prod is what opens alerts to the league. It stays because it is the
// only way to narrow delivery in a hurry without unsetting the VAPID keys and
// killing push for everyone.
//
// The gate is applied at SEND time, not at subscribe time, and not in the UI.
// A client-side gate would be cosmetic, and gating subscription would mean
// re-subscribing every device when the rollout changes.

const webpush = require('web-push');
const User = require('../models/user');
const Game = require('../models/game');
const { activeSeason } = require('./active-season');
const scoringModule = require('./scoring');
const { engagementForSeason } = require('./scoring-defaults');
const { captainFocusWeek, autoCaptainTeamId, captainForWeek } = require('./captain');
const { isDue, alreadySent, buildCaptainReminderPayload, leadMsFor } = require('./captain-reminder');

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

// Entries of the narrowing list, as written. Empty is the normal state and means
// "don't narrow" — see the header.
function rawRecipientIds() {
    return String(process.env.PUSH_RECIPIENT_IDS || '')
        .split(',')
        .map(s => s.trim())
        .filter(Boolean);
}

// Only entries Mongo can actually match. An id that is not a 24-char hex string
// makes `_id: { $in: [...] }` throw a CastError, which the wrappers below
// swallow — so an unusable list would mean total silence explained by one log
// line a tick. Screening here turns that into a visible, decided state.
const OBJECT_ID = /^[0-9a-f]{24}$/i;
function allowlist() {
    return new Set(rawRecipientIds().filter(id => OBJECT_ID.test(id)));
}

// True while delivery is narrowed. Note the asymmetry with allowlist(): a var
// set to something unusable ("none", "off", a typo) is still RESTRICTED, to an
// empty set — nobody. Setting it to a non-id is the kill switch, and it fails
// closed the way the original gate did, instead of quietly opening up.
function isRestricted() {
    return rawRecipientIds().length > 0;
}

// May this manager receive alerts at all? Open unless narrowed. Says nothing
// about whether they've turned them on — that's the subscription.
function isAllowedRecipient(userId) {
    return !isRestricted() || allowlist().has(String(userId));
}

// Logged once per process, so the mode push is running in is visible in the dyno
// log rather than something you infer from silence.
let announcedMode = false;
function announceMode() {
    if (announcedMode) return;
    announcedMode = true;
    if (!isRestricted()) {
        console.log('Push: alerts go to every manager with a registered device.');
        return;
    }
    const usable = allowlist().size;
    if (!usable) {
        console.log(`Push: PUSH_RECIPIENT_IDS is set to ${rawRecipientIds().length} value(s), none of them a User id — NO alerts will be sent to anyone.`);
    } else {
        console.log(`Push: PUSH_RECIPIENT_IDS narrows alerts to ${usable} manager(s); everyone else stays silent.`);
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

// What a score of this size almost certainly was, as an emoji plus a word.
//
// Worth doing because the scoreboard delta already carries it and a lock screen
// has room for about four words: "🏈 Texas touchdown" tells a manager more than
// "Texas scored" in the same space. Emoji are the only visual we can rely on —
// notification body text is plain text (no markup, no inline images), and iOS
// substitutes its own app icon for the `icon` slot.
//
// Inference, not fact: CFBD gives us a score delta, not a play type. A delta of
// 7 is a touchdown with the extra point already counted, 6 is one whose PAT has
// not landed yet, 8 is a two-point conversion. Anything unrecognised — most
// often two scores landing inside one 10-second tick — falls back to the
// generic wording rather than guessing wrong out loud.
function scoreLabel(delta) {
    if (delta === 6 || delta === 7 || delta === 8) return { emoji: '🏈', verb: 'touchdown' };
    if (delta === 3) return { emoji: '🎯', verb: 'field goal' };
    if (delta === 2) return { emoji: '🛡️', verb: 'safety' };
    // Unreachable from the live path — modules/score-events.js suppresses a
    // one-point delta before it ever becomes an event. Kept so this function is
    // correct on its own terms for any caller, rather than silently mislabelling
    // a PAT as a generic score if that rule is ever relaxed.
    if (delta === 1) return { emoji: '➕', verb: 'extra point' };
    return { emoji: '🏈', verb: 'scored' };
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
        const { emoji, verb } = scoreLabel(event.delta);
        return {
            type: 'score',
            title: `${emoji} ${team} ${verb}`,
            body: `${line}${suffix}`,
            url,
            tag: `game-${game.id}`
        };
    }
    if (event.type === 'leadChange') {
        const team = teamNameFor(game, event.side);
        return {
            type: 'leadChange',
            title: `⚡ ${team} takes the lead`,
            body: `${line}${suffix}`,
            url,
            tag: `game-${game.id}`
        };
    }
    if (event.type === 'closeGame') {
        return {
            type: 'closeGame',
            title: '⏰ Crunch time',
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

    // ✅ / ❌ carry the only thing that matters at a final in these leagues —
    // both score on WINS — so the result is legible before a word is read.
    let title;
    if (tied) title = `🤝 ${game.awayTeam} ${game.awayPoints} – ${game.homeTeam} ${game.homePoints}`;
    else title = won ? `✅ ${teamName} won` : `❌ ${teamName} lost`;

    const body = total > 0
        ? `+${total} pts${labels ? ` — ${labels}` : ''} · ${scoreline(game, game.homePoints, game.awayPoints)}`
        : `No points · ${scoreline(game, game.homePoints, game.awayPoints)}`;

    return { type: 'final', title, body, url: `/game/${game.id}`, tag: `final-${game.id}` };
}

// ---- recipients -------------------------------------------------------------

// Managers who roster either team in this game, for the active season, and who
// have at least one push subscription — the subscription being the manager's
// own opt-in. Any narrowing list is applied here so a caller cannot forget it.
//
// Returns [{ user, teamIds }] where teamIds are the rostered teams involved —
// a manager can roster BOTH sides of a game, which is why this is a list.
async function recipientsFor(game, season) {
    const teamIds = [game.homeId, game.awayId].filter(id => id != null);
    if (!teamIds.length) return [];

    const query = {
        pushSubscriptions: { $exists: true, $ne: [] },
        seasons: { $elemMatch: { season, 'teams.id': { $in: teamIds } } }
    };
    if (isRestricted()) query._id = { $in: [...allowlist()] };

    // Project the two roster fields this function reads, NOT the whole `seasons`
    // subtree: seasons[].teams holds a full team object each (logos, venue,
    // colors), so `seasons: 1` returned 108,610 bytes per matched manager where
    // this returns 1,208 — measured against the prod copy. That was one _id
    // lookup while the allowlist was the gate; it is now an unindexed match run
    // once per game, per tick, against a cluster capped around 85 KB/s.
    const users = await User.find(query,
        { firstName: 1, league: 1, pushSubscriptions: 1, pushPrefs: 1, 'seasons.season': 1, 'seasons.teams.id': 1 }).lean();

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

// The banked points for ONE rostered team in a finished game, as
// modules/scoring.js explainGame returns them: { matched: [{label, points}],
// total }.
//
// Exists as its own function purely to pin the argument that broke in prod:
// explainGame's `team` parameter is a TEAM ID, not a team object. Its context
// builder compares `game.homeId == team` (modules/scoring-detectors.js), so an
// object matches neither side, `won` comes out false, every rule scores 0, and
// a 52-3 blowout is announced as "No points" — silently, with no error to log
// and nothing in the UI disagreeing, because the standings are scored by a
// different code path that got this right.
//
// Returns null when the breakdown can't be computed, which buildFinalPayload
// reads as zero — the honest fallback for a genuine failure, but NOT something
// to reach for casually, since "No points" is a factual claim about a manager's
// score.
function explainForTeam(cfg, teamId, game, rankings, bracket) {
    try {
        return scoringModule.explainGame(cfg.model, teamId, game, rankings, cfg, bracket);
    } catch (e) {
        console.log(`Push: could not explain game ${game && game.id} for team ${teamId}: ${e && e.message}`);
        return null;
    }
}

// ---- entry points -----------------------------------------------------------

// Live in-game events. Called from modules/score-update.js with the events a
// tick produced, keyed by game id.
//
// Wrapped so it can NEVER take the poller down: an alert is a nicety, scoring is
// not, and the poller runs every 10 seconds.
async function notifyEvents(eventsByGameId) {
    announceMode();
    if (!isConfigured()) return { sent: 0 };
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
    announceMode();
    if (!isConfigured()) return { sent: 0 };
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
                    const explain = explainForTeam(cfg, teamId, game, rankings, bracket);
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

// ---- Captain lock reminder --------------------------------------------------

// Matches routes/users.js: a week stays in focus this long past its last kickoff
// before the tile advances. Duplicated as a constant rather than imported from a
// route, which would drag the whole router in.
const CAPTAIN_WEEK_GRACE_MS = 6 * 60 * 60 * 1000;

// Ahead of each manager's Captain lock, by the lead THEY chose (2 hours unless
// they changed it). Called from modules/captain-reminder-job.js on a fixed
// cadence.
//
// Three things make this different from the other four alerts, which are all
// reactions to a game event:
//
//   1. The lock instant is PER MANAGER — their own earliest kickoff that week —
//      so there is no shared deadline to schedule against. Each manager's window
//      is computed from their roster.
//   2. Captain is a per-league opt-in (engagementBySeason[year].captainEnabled).
//      A league playing the classic game has no pick to lock, and telling its
//      managers otherwise would be advertising a mechanic they don't have.
//   3. It must fire exactly once per manager per week, so it writes a row to
//      user.captainReminders and checks that row before sending. The other
//      alerts are naturally one-per-event.
//
// The lead is per manager, which is why there is no single window to query on:
// two managers with the same lock are due 23 hours apart if one picked a day's
// notice and the other picked an hour. Each row carries its own answer.
//
// Returns { sent, due, skipped } for the job report. Never throws: a reminder is
// a nicety.
async function notifyCaptainLocks(nowMs) {
    announceMode();
    if (!isConfigured()) return { sent: 0, due: 0, skipped: 'VAPID not configured' };

    const now = nowMs == null ? Date.now() : nowMs;
    const season = activeSeason('football');
    if (season == null) return { sent: 0, due: 0, skipped: 'no active season' };

    let sent = 0, due = 0;

    try {
        const query = {
            pushSubscriptions: { $exists: true, $ne: [] },
            seasons: { $elemMatch: { season } }
        };
        if (isRestricted()) query._id = { $in: [...allowlist()] };

        // Same projection discipline as recipientsFor: seasons[].teams holds a
        // full team object each, so pulling `seasons: 1` is ~100KB per manager
        // against a cluster capped around 85 KB/s. `school` is here because the
        // notification body names the team.
        const users = await User.find(query, {
            firstName: 1, league: 1, pushSubscriptions: 1, pushPrefs: 1, captainReminders: 1,
            'seasons.season': 1, 'seasons.teams.id': 1, 'seasons.teams.school': 1,
            'seasons.captains': 1, 'seasons.weeklyScore': 1
        }).lean();
        if (!users.length) return { sent: 0, due: 0 };

        // Captain is per-league, so resolve each league's config once rather
        // than once per manager.
        const captainByLeague = new Map();
        async function captainOn(league) {
            if (captainByLeague.has(league)) return captainByLeague.get(league);
            let on = false;
            try {
                const cfg = await scoringModule.getScoringConfig(league);
                on = !!engagementForSeason(cfg.engagementBySeason, season).captainEnabled;
            } catch (e) {
                console.log(`Push: could not read scoring config for ${league}: ${e && e.message}`);
            }
            captainByLeague.set(league, on);
            return on;
        }

        // One games read for the whole run. Every manager's focus week is
        // computed from the same regular-season slate, so fetching per manager
        // would be the same rows over and over.
        const games = await Game.find(
            { season, seasonType: 'regular' },
            { week: 1, homeId: 1, awayId: 1, startDate: 1, startTimeTbd: 1, seasonType: 1, _id: 0 }
        ).lean();
        if (!games.length) return { sent: 0, due: 0, skipped: 'no games stored' };

        for (const user of users) {
            if (!wantsType(user, 'captainLock')) continue;
            if (!(await captainOn(user.league))) continue;

            const entry = (user.seasons || []).find(s => Number(s.season) === Number(season));
            const roster = (entry && entry.teams) || [];
            if (!roster.length) continue;

            const teamIds = roster.map(t => Number(t.id));
            const focus = captainFocusWeek(games, teamIds, now, CAPTAIN_WEEK_GRACE_MS);
            if (!focus) continue;                                   // season out of reach
            // Their own lead, not a global one.
            if (!isDue(focus.first, now, leadMsFor(user.pushPrefs))) continue;
            if (alreadySent(user.captainReminders, season, focus.week)) continue;

            due++;

            const byId = new Map(roster.map(t => [Number(t.id), t]));
            const pickedId = captainForWeek(entry.captains, focus.week);
            // The default modules/captain.js would apply if they never pick —
            // scored off the weeks BEFORE this one, the same slice the scorer uses.
            const prior = ((entry && entry.weeklyScore) || []).filter(w => Number(w.week) < focus.week);
            const autoId = pickedId != null ? null : autoCaptainTeamId(roster, prior);

            const toTeam = id => {
                const t = id != null ? byId.get(Number(id)) : null;
                return t ? { id: Number(t.id), school: t.school } : null;
            };

            const payload = buildCaptainReminderPayload({
                userId: user._id,
                week: focus.week,
                lockMs: focus.first,
                nowMs: now,
                currentPick: toTeam(pickedId),
                autoPick: toTeam(autoId)
            });

            const res = await sendToUser(user, payload);
            sent += res.sent;

            // Recorded only when a device actually took it. A manager whose only
            // subscription was pruned mid-send has NOT been reminded, and
            // writing the row anyway would mean they never are.
            if (res.sent) {
                try {
                    await User.updateOne({ _id: user._id },
                        { $push: { captainReminders: { season, week: focus.week, sentAt: new Date() } } });
                } catch (e) {
                    // The send already happened; failing to log it risks one
                    // duplicate next tick, which the payload's tag collapses.
                    console.log(`Push: could not log captain reminder for ${user._id}: ${e && e.message}`);
                }
            }
        }
    } catch (err) {
        console.log(`Push: notifyCaptainLocks failed: ${err && err.message}`);
    }

    return { sent, due };
}

// One-off delivery used by the "send me a test" button, so a manager can prove
// the whole chain works without waiting for a Saturday.
// One-off delivery used by the "Send a test" button, so a manager can prove the
// whole chain works without waiting for a Saturday. Dressed exactly like a real
// alert, because a test that looks different from the thing it is testing is
// only half a test.
//
// It used to send three probe notifications comparing a team logo in the `icon`
// slot, the same logo as a big-picture `image`, and emoji. VERDICT, measured on
// a real iPhone (12 Sep 2026): iOS rendered NEITHER the icon nor the image —
// it substitutes the home-screen app icon and ignores both fields. Do not spend
// time re-adding team logos to these notifications; on iOS they cannot show.
// Emoji are the only visual that works, which is why buildPayload leads every
// alert with one. Notification body text is plain text besides — no markup, no
// inline images — so there is no third option.
//
// sw.js still forwards `icon`/`image` when a payload sets them: it costs two
// lines, it is correct behaviour on Android and desktop, and it means the
// finding above is the only thing that needs revisiting if Apple ever changes.
async function sendTest(userId) {
    if (!applyVapid()) return { sent: 0, reason: 'VAPID keys not configured' };
    if (!isAllowedRecipient(userId)) return { sent: 0, reason: 'Alerts are narrowed to other managers right now' };
    const user = await User.findById(userId, { pushSubscriptions: 1, firstName: 1 }).lean();
    if (!user) return { sent: 0, reason: 'User not found' };
    const res = await sendToUser(user, {
        type: 'test',
        // No app name here: iOS already stamps every notification with "from
        // Campus Clash", so putting it in the title too just says it twice. The
        // real alerts never had this problem — they lead with a team.
        title: '🏈 Alerts are on',
        body: "Real ones look like this — when your teams score, take the lead, or finish.",
        url: '/standings',
        tag: 'test'
    });
    return { sent: res.sent, pruned: res.pruned };
}

module.exports = {
    notifyEvents,
    notifyFinals,
    notifyCaptainLocks,
    sendTest,
    isConfigured,
    vapidConfig,
    isAllowedRecipient,
    isRestricted,
    // exported for reuse/tests:
    buildPayload, buildFinalPayload, scoreline, clockLabel, scoreLabel, wantsType, allowlist, rawRecipientIds, recipientsFor, explainForTeam
};
