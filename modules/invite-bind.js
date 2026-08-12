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

// An Auth0 database identity — someone who typed an address into the sign-up
// form. Social subs look like `google-oauth2|…` or `apple|…`.
const isDatabaseIdentity = (sub) => /^auth0\|/.test(String(sub || ''));

// Pure decision, exported for testing.
//
// `action` is one of:
//   skip   — do nothing, leave the cookie (the situation may resolve next request)
//   clear  — drop the cookie, carry on; nothing to do and nothing wrong
//   refuse — drop the cookie, show the invitee why it didn't work
//   bind   — write the pointer
function decideInvite({ invite, sub, tokenEmail, emailVerified, sessionUserId, record, lookupError }) {
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

    // Mailbox control. Anyone can type any address into the sign-up form, so a
    // password identity has to prove it owns the address before that address is
    // allowed to claim a franchise — otherwise a leaked link plus a self-signup
    // walks straight past the email gate below. Google and Apple already vouch
    // for the address they hand us, so they're exempt.
    if (isDatabaseIdentity(sub) && !emailVerified) {
        return { action: 'refuse', reason: 'unverified-email' };
    }

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

// Heading as well as body, because these are not all the same kind of event.
// An unconfirmed address is a step still to take, not a failure — telling
// someone "this invite didn't work" when their invite worked fine and their
// account was created sends them back to the commissioner for nothing.
const REFUSAL_COPY = {
    'no-record':       { heading: 'This invite didn’t work',
                         body: 'This invite points at a team that no longer exists.' },
    'league-mismatch': { heading: 'This invite didn’t work',
                         body: 'This invite doesn’t match the league it was created for.' },
    'already-claimed': { heading: 'This invite has already been used',
                         body: 'If that wasn’t you, ask your commissioner for a new link.' },
    'no-token-email':  { heading: 'We couldn’t confirm it’s you',
                         body: 'That login didn’t give us an email address, so we can’t match it to your team.' },
    'email-mismatch':  { heading: 'Wrong email address',
                         body: 'This invite was sent to a different address. Sign in with the one your commissioner invited.' },
    'unverified-email':{ heading: 'One more step',
                         body: 'Your account is set up. Click the link in the email we just sent to confirm your address, then come back here.',
                         retry: true },
    'verified-no-cookie': { heading: 'Address confirmed',
                         body: 'Open the invite link your commissioner sent you and you’ll be straight in.' },
    'bind-failed':     { heading: 'We couldn’t finish setting up',
                         body: 'Tell your commissioner — nothing is broken on your end.' }
};

// Self-contained page, inline styles only: like identity-guard's block page this
// can render before the static middleware, so styles.css may not be available.
// `retryHref` re-opens the invite (the cookie is cleared on refusal, and that
// route sets it again). Only offered where retrying can actually succeed —
// after confirming an address, say. Everywhere else the way out is Log out.
function renderRefusalPage(reason, retryHref) {
    const copy = REFUSAL_COPY[reason] || REFUSAL_COPY['bind-failed'];
    const canRetry = !!(copy.retry && retryHref);
    const action = canRetry
        ? '<a class="btn" href="' + retryHref + '">I’ve confirmed it — continue</a>'
          + '<div class="alt"><a href="/logout">Log out instead</a></div>'
        : '<a class="btn" href="/logout">Log out</a>';
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
        + '.alt{margin-top:16px;font-size:.85rem;}'
        + '.alt a{color:#8a90a8;}'
        + '</style></head><body><div class="wrap"><div class="card">'
        + '<span class="dot"></span>'
        + '<h1>' + copy.heading + '</h1>'
        + '<p>' + copy.body + '</p>'
        + action
        + '</div></div></body></html>';
}

// Middleware factory. deps: { User, management, secret, inviteToken }.
function inviteBind(deps) {
    const User = deps.User;
    const management = deps.management;
    const inviteToken = deps.inviteToken;

    return async function inviteBindMw(req, res, next) {
        try {
            // /invite/* is where a claim is STARTED or restarted, never where it
            // completes — the bind lands on whatever page they hit after the
            // login round trip. Judging them here judges the token they arrived
            // with, which is precisely the stale one they came back to replace:
            // someone who has just confirmed their address still carries an ID
            // token minted before the click, so this would refuse them on the
            // very route whose job is to go and get them a fresh one, and the
            // retry link would loop forever.
            if (String(req.path || '').indexOf('/invite/') === 0) return next();

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
                emailVerified: !!(oidcUser && oidcUser.email_verified),
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
                const copy = REFUSAL_COPY[decision.reason];
                // A retryable refusal (an unconfirmed address) KEEPS the cookie:
                // the situation resolves on its own once they click the email,
                // and clearing it would force the whole claim to start over.
                // Everything else is final, so the invite is spent.
                if (!(copy && copy.retry)) res.clearCookie(COOKIE);
                // Straight to /start, not the invite page — that mints a fresh
                // login, which is the only way the confirmed-address flag reaches
                // us. The ID token they're holding was issued before they clicked.
                return res.status(403).type('html').send(renderRefusalPage(
                    decision.reason, '/invite/' + encodeURIComponent(raw) + '/start'));
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
