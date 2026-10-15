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
const franchiseRepo = require('./franchise-repo');
const Game = require('../models/game');
const { activeSeason } = require('./active-season');
const seasons = require('./active-season');
const scoringModule = require('./scoring');
const { engagementForSeason } = require('./scoring-defaults');
const { captainFocusWeek, autoCaptainTeamId, captainForWeek, captainWeeklyBonus } = require('./captain');
const { isDue, alreadySent, buildCaptainReminderPayload, leadMsFor } = require('./captain-reminder');
const { alreadyNoticed, latestRecap, buildRecapNoticePayload } = require('./recap-notice');
const { isRecapSeason } = require('./weekly-recap');
const { internalFetch } = require('./internal-api');

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

    // Split across the two documents since #313: the subscription is the
    // person's, the roster is their league entry's.
    const accountFilter = { pushSubscriptions: { $exists: true, $ne: [] } };
    const franchiseFilter = { seasons: { $elemMatch: { season, 'teams.id': { $in: teamIds } } } };
    if (isRestricted()) accountFilter._id = { $in: [...allowlist()] };

    // Project the two roster fields this function reads, NOT the whole `seasons`
    // subtree: seasons[].teams holds a full team object each (logos, venue,
    // colors), so `seasons: 1` returned 108,610 bytes per matched manager where
    // this returns 1,208 — measured against the prod copy. That was one _id
    // lookup while the allowlist was the gate; it is now an unindexed match run
    // once per game, per tick, against a cluster capped around 85 KB/s.
    const users = await franchiseRepo.findManagers({ accountFilter, franchiseFilter,
        fields: ['firstName', 'league', 'pushSubscriptions', 'pushPrefs', 'seasons.season', 'seasons.teams.id'] });

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
            await franchiseRepo.updateAccount(
                user._id,
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

// ---- Basketball game alerts (#557) ------------------------------------------
//
// Three alerts, each its own pref so a two-sport manager can mute basketball
// without muting football: hoopsTipoff, hoopsCloseGame, hoopsFinal. Events
// come from modules/hoops-score-events.js via the hoops live poller.
//
// Basketball and football team ids COLLIDE (130 of them), so recipients are
// read from basketball leagues' franchises only, each in its own league's
// season — never from football's `recipientsFor`.

// "H2 · 3:41", "OT1", or '' when the half is unknown. CBBD's period is the
// half, and 3+ is overtime.
function hoopsClockLabel(period, clock) {
    if (typeof period !== 'number') return '';
    const p = period > 2 ? `OT${period - 2}` : `H${period}`;
    return clock ? `${p} · ${clock}` : p;
}

// Live-event text. Tags carry a `hoops-` prefix: a CBBD game id can equal a
// CFBD one, and a shared tag would let a basketball banner replace a football
// one on the device.
function buildHoopsPayload(event, game) {
    const when = hoopsClockLabel(event.period, event.clock);
    const suffix = when ? ` · ${when}` : '';
    const url = `/hoops/game/${game.id}`;
    if (event.type === 'tipoff') {
        return { type: 'hoopsTipoff', title: '🏀 Tip-off', body: `${game.awayTeam} at ${game.homeTeam}${suffix}`, url, tag: `hoops-game-${game.id}` };
    }
    if (event.type === 'closeGame') {
        return { type: 'hoopsCloseGame', title: '⏰ Crunch time',
            body: `${scoreline(game, event.homePoints, event.awayPoints)}${suffix}`, url, tag: `hoops-game-${game.id}` };
    }
    return null;
}

// Signed points for a lock screen: "+6", "−2".
function signedPts(n) { return n > 0 ? `+${n}` : `−${Math.abs(n)}`; }

// Final text for ONE manager's rostered team. Unlike football a basketball
// result can bank NEGATIVE points (the bad-loss penalty), so a loss is not
// always "No points".
//
// `captainBonus`: what Captain adds on top when this team is the manager's
// Captain for the week — base × (multiplier − 1), the scorer's own formula
// (modules/captain.js captainWeeklyBonus). The headline points include it,
// and the bonus is named separately so the manager can see what the pick was
// worth. It doubles a penalty too, so it can be negative.
function buildHoopsFinalPayload(game, teamName, explain, captainBonus) {
    const isHome = teamName === game.homeTeam;
    const won = isHome ? game.homePoints > game.awayPoints : game.awayPoints > game.homePoints;
    const base = (explain && explain.total) || 0;
    const bonus = captainBonus || 0;
    const total = Math.round((base + bonus) * 10) / 10;
    const labels = ((explain && explain.matched) || []).map(m => m.label).join(' + ');
    const line = scoreline(game, game.homePoints, game.awayPoints);
    const captain = bonus ? ` · 👑 Captain bonus ${signedPts(bonus)}` : '';
    const body = total === 0 ? `No points · ${line}` : `${signedPts(total)} pts${labels ? ` — ${labels}` : ''}${captain} · ${line}`;
    return { type: 'hoopsFinal', title: won ? `✅ ${teamName} won` : `❌ ${teamName} lost`,
        // Per team: a manager rostering BOTH sides gets two finals, and one
        // tag would let the second replace the first on the device.
        body, url: `/hoops/game/${game.id}`, tag: `hoops-final-${game.id}-${isHome ? game.homeTeamId : game.awayTeamId}` };
}

// Managers in every basketball league who roster a team in this game, in that
// league's own season, with a device registered. One row per FRANCHISE: the
// points in a final are per league.
async function hoopsRecipientsFor(game) {
    const teamIds = [game.homeTeamId, game.awayTeamId].map(Number).filter(Number.isFinite);
    if (!teamIds.length) return [];
    const League = require('../models/league');
    const { rosterIds } = require('./hoops-scoring-pass');

    const leagues = (await League.find({}, { code: 1, status: 1, _id: 0 }).lean())
        .filter(l => l.status !== 'archived' && seasons.sportForLeague(l.code) === 'basketball');
    const out = [];
    for (const { code: league } of leagues) {
        const season = seasons.seasonForLeague(league);
        if (!Number.isFinite(season) || Number(game.season) !== Number(season)) continue;
        const accountFilter = { pushSubscriptions: { $exists: true, $ne: [] } };
        if (isRestricted()) accountFilter._id = { $in: [...allowlist()] };
        const users = await franchiseRepo.findManagers({
            accountFilter,
            franchiseFilter: { league, seasons: { $elemMatch: { season, $or: [
                { 'teamRefs.id': { $in: teamIds } }, { 'teams.id': { $in: teamIds } }] } } },
            // captains + weeklyScore: the final resolves this week's Captain.
            fields: ['firstName', 'league', 'pushSubscriptions', 'pushPrefs',
                'seasons.season', 'seasons.teamRefs', 'seasons.teams.id', 'seasons.captains', 'seasons.weeklyScore']
        });
        for (const user of users) {
            const entry = (user.seasons || []).find(s => Number(s.season) === Number(season));
            const roster = rosterIds(entry);
            const rostered = roster.filter(id => teamIds.includes(id));
            if (rostered.length) out.push({ user, teamIds: rostered, league, season, entry, roster });
        }
    }
    return out;
}

// Claim one alert type on one game, atomically: true for the caller that set
// it, false for every caller after. This is the once-per-game guarantee.
async function claimHoopsAlert(gameId, type) {
    const HoopsGame = require('../models/hoopsGame');
    const res = await HoopsGame.updateOne(
        { id: Number(gameId), pushAlerts: { $ne: type } },
        { $addToSet: { pushAlerts: type } }
    );
    return res.modifiedCount === 1;
}

// Tip-off and crunch time. Called from modules/hoops-live-poll.js with the
// events a tick produced, keyed by game id. Never throws.
async function notifyHoopsEvents(eventsByGameId) {
    announceMode();
    if (!isConfigured()) return { sent: 0 };
    const gameIds = Object.keys(eventsByGameId || {}).map(Number).filter(n => !Number.isNaN(n));
    if (!gameIds.length) return { sent: 0 };
    let sent = 0;
    try {
        const HoopsGame = require('../models/hoopsGame');
        const games = await HoopsGame.find({ id: { $in: gameIds } },
            { id: 1, season: 1, homeTeamId: 1, awayTeamId: 1, homeTeam: 1, awayTeam: 1, _id: 0 }).lean();
        for (const game of games) {
            const events = eventsByGameId[game.id] || eventsByGameId[String(game.id)] || [];
            if (!events.length) continue;
            const recipients = await hoopsRecipientsFor(game);
            if (!recipients.length) continue;
            for (const event of events) {
                const payload = buildHoopsPayload(event, game);
                if (!payload) continue;
                if (!(await claimHoopsAlert(game.id, event.type))) continue;
                // Live text is the same in every league, so a manager in two
                // basketball leagues hears it once.
                const told = new Set();
                for (const { user } of recipients) {
                    if (told.has(String(user._id))) continue;
                    told.add(String(user._id));
                    if (!wantsType(user, payload.type)) continue;
                    sent += (await sendToUser(user, payload)).sent;
                }
            }
        }
    } catch (err) {
        console.log(`Push: notifyHoopsEvents failed: ${err && err.message}`);
    }
    return { sent };
}

// Basketball games that just went final, with what each manager banked in
// their own league. Never throws.
async function notifyHoopsFinals(gameIds) {
    announceMode();
    if (!isConfigured()) return { sent: 0 };
    const ids = (gameIds || []).map(Number).filter(n => !Number.isNaN(n));
    if (!ids.length) return { sent: 0 };
    let sent = 0;
    try {
        const HoopsGame = require('../models/hoopsGame');
        const { configFor, isFinal } = require('./hoops-scoring-pass');
        const { ranksFor } = require('./hoops-ranks');
        const { seasonModeWeeks, isModeGame } = require('./hoops-modes');
        const hoopsCaptain = require('./hoops-captain');
        const games = await HoopsGame.find({ id: { $in: ids } }).lean();
        const cfgCache = new Map();
        const modeWeeks = new Map();
        for (const game of games) {
            if (!isFinal(game)) continue;
            const recipients = await hoopsRecipientsFor(game);
            if (!recipients.length) continue;
            // Every lookup that can fail runs BEFORE the claim: a claim
            // followed by a failed read would use up the final for everyone.
            // The ranks are the ones the scoring pass grades this game against.
            const ranks = (await ranksFor(game.season, game.week)).ranks;
            for (const { league } of recipients) {
                if (cfgCache.has(league)) continue;
                const { cfg, doc } = await configFor(league);
                const eng = engagementForSeason(doc && doc.engagementBySeason, game.season);
                // Captain counts only in a mode week, on a mode game — the
                // scorer's rule (modules/hoops-scoring-pass.js).
                let captainOn = false;
                if (eng.captainEnabled && isModeGame(game)) {
                    if (!modeWeeks.has(game.season)) modeWeeks.set(game.season, await seasonModeWeeks(game.season));
                    captainOn = modeWeeks.get(game.season).includes(Number(game.week));
                }
                cfgCache.set(league, { cfg, captainOn, multiplier: eng.captainMultiplier });
            }
            if (!(await claimHoopsAlert(game.id, 'final'))) continue;
            for (const { user, teamIds, league, entry, roster } of recipients) {
                if (!wantsType(user, 'hoopsFinal')) continue;
                const { cfg, captainOn, multiplier } = cfgCache.get(league);
                // This week's Captain as the scorer resolves it: the pick, else
                // the frozen default, else the default from earlier weeks.
                let captainId = null;
                if (captainOn) {
                    const parts = hoopsCaptain.pickParts(entry && entry.captains, game.week);
                    captainId = parts.picked != null ? parts.picked
                        : parts.frozenAuto != null ? parts.frozenAuto
                        : hoopsCaptain.autoNow(entry, roster, game.week);
                }
                for (const teamId of teamIds) {
                    const teamName = teamId === Number(game.homeTeamId) ? game.homeTeam : game.awayTeam;
                    let explain = null;
                    try {
                        explain = scoringModule.explainGame('hoops', teamId, game, ranks, cfg);
                    } catch (e) {
                        console.log(`Push: could not explain hoops game ${game.id} for team ${teamId}: ${e && e.message}`);
                    }
                    const bonus = (captainId != null && Number(captainId) === teamId && explain)
                        ? captainWeeklyBonus([{ teamId, score: explain.total }], teamId, multiplier) : 0;
                    sent += (await sendToUser(user, buildHoopsFinalPayload(game, teamName, explain, bonus))).sent;
                }
            }
        }
    } catch (err) {
        console.log(`Push: notifyHoopsFinals failed: ${err && err.message}`);
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
    const football = await notifyFootballCaptainLocks(now);
    const hoops = await notifyHoopsCaptainLocks(now);
    // Football's answer, with basketball's counts added: a run where only
    // basketball had someone due must still report (and log) them, and a
    // run where neither did keeps football's skip reason for the job report.
    const out = Object.assign({}, football, {
        sent: football.sent + hoops.sent,
        due: football.due + hoops.due
    });
    if (hoops.due && out.skipped) delete out.skipped;
    return out;
}

async function notifyFootballCaptainLocks(now) {
    const season = activeSeason('football');
    if (season == null) return { sent: 0, due: 0, skipped: 'no active season' };

    let sent = 0, due = 0;

    try {
        // Split across the two documents since #313: the subscription belongs to
        // the person, the season entry to their league franchise.
        const accountFilter = { pushSubscriptions: { $exists: true, $ne: [] } };
        const franchiseFilter = { seasons: { $elemMatch: { season } } };
        if (isRestricted()) accountFilter._id = { $in: [...allowlist()] };

        // Same projection discipline as recipientsFor: seasons[].teams holds a
        // full team object each, so pulling `seasons: 1` is ~100KB per manager
        // against a cluster capped around 85 KB/s. `school` is here because the
        // notification body names the team.
        const users = await franchiseRepo.findManagers({ accountFilter, franchiseFilter, fields: [
            'firstName', 'league', 'pushSubscriptions', 'pushPrefs', 'captainReminders',
            'seasons.season', 'seasons.teams.id', 'seasons.teams.school',
            'seasons.captains', 'seasons.weeklyScore'
        ] });
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
            // Basketball has its own pass below. Its season is a different
            // year only until football rolls over to it, and then this
            // football slate would lock a basketball pick by football games
            // (130 team ids collide).
            if (seasons.sportForLeague(user.league) === 'basketball') continue;
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
                    // The ledger is a FRANCHISE field, and the read above
                    // already comes from there. This is the pairing the flag
                    // used to break: read the ledger from one place, write it to
                    // another, and the dedupe never sees its own writes — every
                    // eligible manager is reminded again on every tick.
                    await franchiseRepo.updateFranchise(user._id,
                        { $push: { captainReminders: { season, week: focus.week, sentAt: new Date() } } },
                        { league: user.league });
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

// The same reminder on every basketball league that plays Captain.
//
// Football's pass, fed by basketball: the lock is the manager's first TIP-OFF
// of the week from `hoopsgames`, a TBD tip locks at the start of its Eastern
// day, and the week offered is the first one not yet locked (see
// modules/hoops-modes.js for both). The ledger is the same per-franchise
// captainReminders, which is per league — a basketball reminder for week 3
// never silences the football one.
//
// Never throws, like the football pass.
async function notifyHoopsCaptainLocks(now) {
    let sent = 0, due = 0;
    try {
        const League = require('../models/league');
        const HoopsTeam = require('../models/hoopsTeam');
        const { seasonModeWeeks, captainGames, captainFocus } = require('./hoops-modes');
        const { rosterIds } = require('./hoops-scoring-pass');
        const hoopsCaptain = require('./hoops-captain');

        const leagues = (await League.find({}, { code: 1, status: 1, _id: 0 }).lean())
            .filter(l => l.status !== 'archived' && seasons.sportForLeague(l.code) === 'basketball');

        for (const { code: league } of leagues) {
            const season = seasons.seasonForLeague(league);
            if (!Number.isFinite(season)) continue;
            let on = false;
            try {
                const cfg = await scoringModule.getScoringConfig(league);
                on = !!engagementForSeason(cfg.engagementBySeason, season).captainEnabled;
            } catch (e) {
                console.log(`Push: could not read scoring config for ${league}: ${e && e.message}`);
            }
            if (!on) continue;

            const accountFilter = { pushSubscriptions: { $exists: true, $ne: [] } };
            if (isRestricted()) accountFilter._id = { $in: [...allowlist()] };
            const users = await franchiseRepo.findManagers({
                accountFilter,
                franchiseFilter: { league, seasons: { $elemMatch: { season } } },
                fields: ['firstName', 'league', 'pushSubscriptions', 'pushPrefs', 'captainReminders',
                    'seasons.season', 'seasons.teamRefs', 'seasons.captains', 'seasons.weeklyScore']
            });
            if (!users.length) continue;
            const weeks = await seasonModeWeeks(season);
            if (!weeks.length) continue;

            for (const user of users) {
                if (!wantsType(user, 'captainLock')) continue;
                const entry = (user.seasons || []).find(s => Number(s.season) === Number(season));
                const teamIds = entry ? rosterIds(entry) : [];
                if (!teamIds.length) continue;

                const games = await captainGames(season, teamIds, weeks);
                const focus = captainFocus(games, teamIds, now);
                if (!focus) continue;
                if (!isDue(focus.first, now, leadMsFor(user.pushPrefs))) continue;
                if (alreadySent(user.captainReminders, season, focus.week)) continue;

                due++;
                // A default already frozen (an earlier reminder) is named as
                // the default, not as their pick.
                const parts = hoopsCaptain.pickParts(entry.captains, focus.week);
                const pickedId = parts.picked;
                const autoId = pickedId != null ? null
                    : (parts.frozenAuto != null ? parts.frozenAuto : hoopsCaptain.autoNow(entry, teamIds, focus.week));
                const wanted = [pickedId, autoId].filter(id => id != null);
                const names = {};
                if (wanted.length) {
                    (await HoopsTeam.find({ season, id: { $in: wanted } }, { id: 1, school: 1, _id: 0 }).lean())
                        .forEach(t => { names[t.id] = t.school; });
                }
                const toTeam = id => (id != null && names[id]) ? { id: Number(id), school: names[id] } : null;

                const payload = buildCaptainReminderPayload({
                    userId: user._id, week: focus.week, lockMs: focus.first, nowMs: now,
                    currentPick: toTeam(pickedId), autoPick: toTeam(autoId),
                    league, sport: 'basketball'
                });
                const res = await sendToUser(user, payload);
                sent += res.sent;
                if (res.sent) {
                    try {
                        // The team this reminder just NAMED is the team that
                        // gets doubled if they never pick: freeze it now, so
                        // a late game in last week's averages cannot swap it.
                        if (autoId != null && parts.frozenAuto == null) {
                            await hoopsCaptain.freezeAutoCaptain({ accountId: user._id, league, season, week: focus.week, teamId: autoId });
                        }
                        await franchiseRepo.updateFranchise(user._id,
                            { $push: { captainReminders: { season, week: focus.week, sentAt: new Date() } } },
                            { league });
                    } catch (e) {
                        console.log(`Push: could not log captain reminder for ${user._id}: ${e && e.message}`);
                    }
                }
            }
        }
    } catch (err) {
        console.log(`Push: notifyHoopsCaptainLocks failed: ${err && err.message}`);
    }
    return { sent, due };
}

// ---- Weekly recap ready -----------------------------------------------------

// "Your week is written up." Called from modules/recap-notice-job.js on Monday
// morning, once the weekend is scored.
//
// The recap is computed by GET /standings/recap, which pulls the whole league's
// season plus games, spreads, rankings and weather to place one manager's week
// in context. That is far too much to reimplement here, and it is the same call
// the My Team tile makes on every page load — so this asks the API for it,
// once per manager, a dozen times a week. modules/scoring.js already talks to
// our own API this way.
//
// Unlike the Captain reminder there is no per-league gate: every league gets
// recaps, and buildWeeklyRecaps answers with an empty list for a season that
// hasn't been played rather than needing to be asked whether it has.
//
// Each manager is asked about THEIR league's season, in their sport's window
// (#558): a basketball season is numbered by its ending year (2027 is
// 2026-27) and runs Nov–Apr, so the football season and the Aug–Jan gate
// would ask a hoops league about a year it has no entry for, and go quiet
// through March.
//
// Returns { sent, due, skipped }. Never throws.
async function notifyRecapReady(nowMs) {
    announceMode();
    if (!isConfigured()) return { sent: 0, due: 0, skipped: 'VAPID not configured' };

    const now = nowMs == null ? Date.now() : nowMs;
    // Matches the in-app popup's own gate, so the offseason is quiet on both.
    const openSports = ['football', 'basketball'].filter(sp => isRecapSeason(new Date(now), sp));
    if (!openSports.length) return { sent: 0, due: 0, skipped: 'offseason' };

    // The pre-filter below: any franchise holding an open sport's season. The
    // per-manager season is resolved from their league inside the loop.
    const candidates = openSports.map(sp => activeSeason(sp)).filter(s => s != null);
    if (!candidates.length) return { sent: 0, due: 0, skipped: 'no active season' };

    let sent = 0, due = 0;

    try {
        // Split across the two documents since #313: the subscription belongs to
        // the person, the season entry to their league franchise.
        const accountFilter = { pushSubscriptions: { $exists: true, $ne: [] } };
        const franchiseFilter = { seasons: { $elemMatch: { season: { $in: candidates } } } };
        if (isRestricted()) accountFilter._id = { $in: [...allowlist()] };

        // No roster fields here — unlike the Captain reminder this needs nothing
        // from seasons[].teams, and that subtree is ~100KB a manager.
        const users = await franchiseRepo.findManagers({ accountFilter, franchiseFilter,
            fields: ['firstName', 'league', 'pushSubscriptions', 'pushPrefs', 'recapNotices'] });
        if (!users.length) return { sent: 0, due: 0 };

        for (const user of users) {
            if (!wantsType(user, 'recapReady')) continue;
            if (!isRecapSeason(new Date(now), seasons.sportForLeague(user.league))) continue;
            const season = seasons.seasonForLeague(user.league);
            if (season == null) continue;

            let payload;
            try {
                const res = await internalFetch(
                    `${process.env.URL}/standings/recap/${encodeURIComponent(user.league)}/${season}/${user._id}`,
                    { headers: { Accept: 'application/json' } });
                if (res.status !== 200) {
                    console.log(`Push: recap lookup for ${user._id} answered ${res.status}`);
                    continue;
                }
                payload = await res.json();
            } catch (e) {
                console.log(`Push: could not load recap for ${user._id}: ${e && e.message}`);
                continue;
            }

            // An empty list is the preseason, or a league that hasn't played —
            // not an error, and nothing to announce.
            const recap = latestRecap(payload);
            if (!recap) continue;
            if (alreadyNoticed(user.recapNotices, season, recap.week)) continue;

            due++;

            const res = await sendToUser(user, buildRecapNoticePayload({ userId: user._id, recap, league: user.league }));
            sent += res.sent;

            // Logged only on delivery, for the same reason as the Captain
            // reminder: a manager whose last subscription was pruned mid-send
            // has not been told, and a row here would mean they never are.
            if (res.sent) {
                try {
                    // Franchise-side, and per-league on purpose: the dedupe key
                    // is {season, week} with no league in it, so a shared ledger
                    // would let the football recap silence the basketball one.
                    await franchiseRepo.updateFranchise(user._id,
                        { $push: { recapNotices: { season, week: recap.week, sentAt: new Date() } } },
                        { league: user.league });
                } catch (e) {
                    console.log(`Push: could not log recap notice for ${user._id}: ${e && e.message}`);
                }
            }
        }
    } catch (err) {
        console.log(`Push: notifyRecapReady failed: ${err && err.message}`);
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
    const user = await franchiseRepo.byAccountId(userId, { fields: ['pushSubscriptions', 'firstName'] });
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
    notifyHoopsEvents, notifyHoopsFinals,
    notifyCaptainLocks, notifyHoopsCaptainLocks,
    notifyRecapReady,
    sendTest,
    isConfigured,
    vapidConfig,
    isAllowedRecipient,
    isRestricted,
    // exported for reuse/tests:
    buildPayload, buildFinalPayload, scoreline, clockLabel, scoreLabel, wantsType, allowlist, rawRecipientIds, recipientsFor, explainForTeam,
    hoopsClockLabel, buildHoopsPayload, buildHoopsFinalPayload, hoopsRecipientsFor, claimHoopsAlert
};
