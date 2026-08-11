// Claims a commissioner invite on the invitee's first login.
//
// GET /invite/:token drops a short-lived cookie holding the signed token and
// sends the visitor to /login. They authenticate with whatever connection they
// like — Google, Apple, password — and land back here with a session but no
// franchise pointer. This middleware writes that pointer to whichever Auth0
// identity they just used, so the invite is connection-agnostic by design:
// binding after the fact is the only way "Continue with Google" can work for
// someone who has never logged in before.
//
// MOUNT ORDER IS LOAD-BEARING. This runs after app.use(auth(config)) — so there
// is a session to read — and BEFORE identity-guard, which would otherwise 403
// the invitee for the missing pointer before they ever get bound.
//
// It fails OPEN in every ambiguous case. A broken or half-configured invite must
// never wedge an ordinary login, so anything unexpected calls next() and leaves
// the session exactly as it found it.

const { leagueFlagFor } = require('./league-access');

const norm = (e) => String(e == null ? '' : e).trim().toLowerCase();

const COOKIE = 'cc_invite';
const COOKIE_MAX_AGE_MS = 15 * 60 * 1000;

// Same raw-header read as modules/dev-role.js — the app doesn't run
// cookie-parser, and one cookie doesn't justify adding it.
function getCookie(req, name) {
    const raw = (req.headers && req.headers.cookie) || '';
    const hit = raw.split(';').map(s => s.trim()).find(s => s.startsWith(name + '='));
    return hit ? decodeURIComponent(hit.slice(name.length + 1)) : null;
}

// Pure decision, exported for testing.
//
// `action` is one of:
//   skip   — do nothing, leave the cookie (the situation may resolve next request)
//   clear  — drop the cookie, carry on; nothing to do and nothing wrong
//   refuse — drop the cookie, show the invitee why it didn't work
//   bind   — write the pointer
function decideInvite({ invite, sub, tokenEmail, sessionUserId, record, lookupError }) {
    if (!invite) return { action: 'skip', reason: 'no-invite' };
    if (!sub)    return { action: 'skip', reason: 'not-authenticated' };  // still pre-login

    // Already has a franchise. Someone opening a second invite link on a linked
    // session isn't an error, but we must never repoint a working login.
    if (sessionUserId) return { action: 'clear', reason: 'already-linked' };

    // A DB hiccup shouldn't spend the invite — leave the cookie and retry.
    if (lookupError) return { action: 'skip', reason: 'lookup-error' };

    if (!record) return { action: 'refuse', reason: 'no-record' };

    if (invite.league && record.league && invite.league !== record.league) {
        return { action: 'refuse', reason: 'league-mismatch' };
    }

    // Idempotent: re-entering with the identity that already owns this franchise
    // (a refresh, a stale cookie) is a no-op, not a failure.
    if (record.authSub && record.authSub === sub) {
        return { action: 'clear', reason: 'already-bound' };
    }
    // Single-use. A spent link must not hand the franchise to a second person.
    if (record.authSub) return { action: 'refuse', reason: 'already-claimed' };

    // Email gate. When the franchise already knows its manager's address, the
    // person claiming it has to be that person — this is what stops a forwarded
    // link from working. When it doesn't (every record predating this feature,
    // since nothing ever wrote User.email), we trust the commissioner's choice of
    // recipient and record the address on first use.
    if (record.email) {
        if (!tokenEmail) return { action: 'refuse', reason: 'no-token-email' };
        if (norm(tokenEmail) !== norm(record.email)) {
            return { action: 'refuse', reason: 'email-mismatch' };
        }
        return { action: 'bind', reason: 'verified' };
    }
    return { action: 'bind', reason: 'first-use' };
}

const REFUSAL_COPY = {
    'no-record':       'This invite points at a team that no longer exists.',
    'league-mismatch': 'This invite doesn’t match the league it was created for.',
    'already-claimed': 'This invite has already been used. If that wasn’t you, ask your commissioner for a new link.',
    'no-token-email':  'We couldn’t read an email address from that login, so we can’t confirm it’s yours.',
    'email-mismatch':  'This invite was sent to a different email address. Sign in with the address your commissioner invited.',
    'bind-failed':     'We couldn’t finish setting up your account. Tell your commissioner — nothing is broken on your end.'
};

// Self-contained page, inline styles only: like identity-guard's block page this
// can render before the static middleware, so styles.css may not be available.
function renderRefusalPage(reason) {
    const message = REFUSAL_COPY[reason] || REFUSAL_COPY['bind-failed'];
    return '<!DOCTYPE html><html lang="en"><head>'
        + '<meta charset="utf-8">'
        + '<meta name="viewport" content="width=device-width, initial-scale=1">'
        + '<meta name="robots" content="noindex">'
        + '<title>Campus Clash — Invite</title>'
        + '<style>'
        + 'html,body{margin:0;height:100%;background:#101322;color:#f4f6fb;'
        + "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;}"
        + '.wrap{min-height:100%;display:flex;align-items:center;justify-content:center;padding:24px;box-sizing:border-box;}'
        + '.card{width:100%;max-width:460px;background:#1a1f33;border:1px solid #2a2e42;border-radius:14px;'
        + 'padding:32px 28px;box-shadow:0 12px 40px rgba(0,0,0,.5);text-align:center;}'
        + '.dot{width:12px;height:12px;border-radius:50%;background:#ed5858;display:inline-block;'
        + 'box-shadow:0 0 12px 2px rgba(237,88,88,.4);margin-bottom:18px;}'
        + 'h1{font-size:1.4rem;margin:0 0 12px;}'
        + 'p{color:#a4a9c2;line-height:1.55;margin:0 0 14px;font-size:.98rem;}'
        + '.btn{display:inline-block;margin-top:10px;background:#ed5858;color:#fff;text-decoration:none;'
        + 'font-weight:600;padding:12px 22px;border-radius:10px;}'
        + '</style></head><body><div class="wrap"><div class="card">'
        + '<span class="dot"></span>'
        + '<h1>This invite didn’t work</h1>'
        + '<p>' + message + '</p>'
        + '<a class="btn" href="/logout">Log out</a>'
        + '</div></div></body></html>';
}

// Middleware factory. deps: { User, management, secret, inviteToken }.
function inviteBind(deps) {
    const User = deps.User;
    const management = deps.management;
    const inviteToken = deps.inviteToken;

    return async function inviteBindMw(req, res, next) {
        try {
            // Cheap short-circuit: the cookie only exists inside a claim window,
            // so ordinary traffic pays one header read.
            const raw = getCookie(req, COOKIE);
            if (!raw) return next();

            const secret = typeof deps.secret === 'function' ? deps.secret() : deps.secret;
            const invite = inviteToken.verify(raw, secret);
            if (!invite) {
                res.clearCookie(COOKIE);
                return next();
            }

            const oidcUser = (req.oidc && req.oidc.isAuthenticated()) ? req.oidc.user : null;
            const sub = oidcUser && oidcUser.sub;
            const innerMeta = (oidcUser && oidcUser.user_metadata && oidcUser.user_metadata.metadata) || {};

            let record = null;
            let lookupError = false;
            if (sub && !innerMeta.userId) {
                try {
                    record = await User.findById(invite.userId,
                        { email: 1, league: 1, authSub: 1, firstName: 1 }).lean();
                } catch (e) {
                    lookupError = true;
                }
            }

            const decision = decideInvite({
                invite,
                sub,
                tokenEmail: oidcUser && oidcUser.email,
                sessionUserId: innerMeta.userId,
                record,
                lookupError
            });

            if (decision.action === 'skip') return next();
            if (decision.action === 'clear') {
                res.clearCookie(COOKIE);
                return next();
            }
            if (decision.action === 'refuse') {
                res.clearCookie(COOKIE);
                return res.status(403).type('html').send(renderRefusalPage(decision.reason));
            }

            // bind
            //
            // MIND THE TWO RESHAPES between what we write and what the app reads.
            //
            // 1. Nesting. The tenant's "Post Login Add Metadata" Action sets the
            //    ID-token claim to { roles, metadata: <the whole user_metadata> }.
            //    So the app's user_metadata.metadata.userId is Auth0's TOP-LEVEL
            //    user_metadata.userId. Writing { metadata: { userId } } here would
            //    surface as metadata.metadata.userId and bind nothing.
            // 2. Vocabulary. Auth0 stores the league as the flag 'gg'/'cl'; Mongo
            //    stores 'graham-league'/'claunts-league'. leagueCodeFor treats
            //    anything that isn't 'gg' as claunts, so writing the Mongo value
            //    doesn't error — it quietly files the member in the wrong league.
            try {
                await management.patchUserMetadata(sub, {
                    userId: String(invite.userId),
                    league: leagueFlagFor(record.league || invite.league || '')
                });
                await User.updateOne(
                    { _id: invite.userId },
                    { $set: { authSub: sub, email: record.email || oidcUser.email } }
                );
            } catch (e) {
                console.error('invite bind failed:', e && e.message);
                res.clearCookie(COOKIE);
                return res.status(500).type('html').send(renderRefusalPage('bind-failed'));
            }

            res.clearCookie(COOKIE);
            // The session's ID token was minted BEFORE the PATCH, so it still
            // carries no pointer — serving any page now would hit identity-guard's
            // block. Round-trip through /login for a fresh token; Auth0's own
            // session is still valid, so this is a redirect, not a second sign-in.
            return res.redirect('/login?returnTo=%2Fstandings');
        } catch (e) {
            // Never let an invite problem break an ordinary request.
            console.error('invite-bind middleware error:', e && e.message);
            return next();
        }
    };
}

module.exports = {
    inviteBind, decideInvite, renderRefusalPage, getCookie,
    COOKIE, COOKIE_MAX_AGE_MS
};
