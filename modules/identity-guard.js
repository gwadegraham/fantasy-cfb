// Identity-match guard.
//
// This app resolves "who you are" purely from an Auth0 login's custom claim
// `user_metadata.metadata.userId`, which points at a Mongo user `_id` — there is
// no lookup by the Auth0 `sub` or email. If that pointer is wrong (e.g. a second
// Auth0 identity for the same person was provisioned against another member's
// record), the app would silently render — and let you edit — someone else's
// franchise. That actually happened: a member's Google identity pointed at a
// different league's record, so logging in with Google showed the wrong league.
//
// This middleware is the seatbelt: on every authenticated request it compares
// the email on the *login* against the email on the *franchise the pointer
// resolves to*. A mismatch means the login and the record don't belong to the
// same person, so we refuse rather than serve the data (a "hard gate" — the
// whole app is paused for that session, with Log Out as the escape hatch, since
// the league context that would scope any other page rides on the same
// untrusted pointer). We fail OPEN — never lock anyone out — whenever there is
// nothing to compare (no email on the record or the token) or the lookup itself
// errors; we only fail CLOSED on a genuine, verifiable mismatch or a pointer
// that resolves to nothing.
//
// Notes:
// - We check the REAL identity (req.oidc.user), not the dev-spoofed effUser.
//   Dev role-spoofing only overrides roles/league, never userId/email, so it can
//   never trigger a false block.
// - /login, /logout, /callback are handled by the express-openid-connect router
//   mounted before this, so they never reach here — the escape hatch always works.

const norm = (e) => String(e == null ? '' : e).trim().toLowerCase();

// Pure decision, exported for testing. Given the pointer, the login's email, the
// resolved record (or null), and whether the DB lookup errored, decide whether to
// allow the request and why. `ok:true` proceeds; `ok:false` renders the block page.
function decideIdentity({ userId, tokenEmail, record, lookupError }) {
    if (lookupError) return { ok: true,  reason: 'lookup-error' };   // DB hiccup: don't lock people out
    if (!userId)     return { ok: false, reason: 'no-pointer' };     // login not linked to any franchise
    if (!record)     return { ok: false, reason: 'no-record' };      // pointer resolves to a deleted/missing user
    if (!record.email)   return { ok: true, reason: 'unverifiable' };// record has no email to compare — allow + warn
    if (!tokenEmail)     return { ok: true, reason: 'no-token-email' };// login carried no email — allow + warn
    if (norm(tokenEmail) === norm(record.email)) return { ok: true, reason: 'match' };
    return { ok: false, reason: 'mismatch' };                         // login email != franchise email — block
}

const ALLOW_EXT = /\.(?:css|js|mjs|map|png|jpe?g|svg|ico|webp|gif|woff2?|ttf|json|txt)$/i;
// Public / asset paths that should never be gated even for an authenticated,
// mismatched session (the block page is self-contained, but these keep other
// tabs and the public marketing page from throwing 403s).
const ALLOW_PATH = new Set(['/season-preview', '/favicon.ico', '/profile']);

// Self-contained block page — inline styles only, since this runs before the
// static middleware and we can't rely on styles.css loading.
// `inviteError` is the cc_invite_error claim the post-login Action sets when a
// claim was refused — a spent link, the wrong address. Without it this page says
// only "not linked", which is true but useless: the reason is knowable and the
// person can usually act on it.
function renderBlockPage(inviteError) {
    return '<!DOCTYPE html><html lang="en"><head>'
        + '<meta charset="utf-8">'
        + '<meta name="viewport" content="width=device-width, initial-scale=1">'
        + '<meta name="robots" content="noindex">'
        + '<title>Campus Clash — Login not linked</title>'
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
        + '.hint{font-size:.82rem;color:#767d9c;margin-top:18px;}'
        + '</style></head><body><div class="wrap"><div class="card">'
        + '<span class="dot"></span>'
        + '<h1>' + (inviteError ? 'That invite didn’t work' : 'This login isn’t linked to your team') + '</h1>'
        + (inviteError
            ? '<p>' + inviteError + '</p>'
            : '<p>To keep accounts safe, we’ve paused this session because the login you used '
              + 'doesn’t match a team we can verify as yours.</p>'
              + '<p>Log out and sign back in with your original login — or reach out to your commissioner '
              + 'to get this login linked.</p>')
        + '<a class="btn" href="/logout">Log out</a>'
        + '<div class="hint">If this keeps happening, tell your commissioner which email you’re using.</div>'
        + '</div></div></body></html>';
}

// Middleware factory. `deps.User` is the Mongoose User model (injected for
// testability). Returns an async Express middleware.
function identityGuard(deps) {
    const User = deps.User;
    return async function identityGuardMw(req, res, next) {
        try {
            // Public / logged-out traffic is not gated.
            if (!req.oidc || !req.oidc.isAuthenticated()) return next();

            const p = req.path || '';
            // /invite/* stays open to an authenticated-but-unlinked session.
            // Claims are resolved during login now, so this is no longer the
            // normal state for an invitee — but it is exactly where they land if
            // the Action couldn't reach the app, and retrying the link is how
            // they recover. Blocking it would make the one page they need
            // unreachable.
            if (ALLOW_PATH.has(p) || ALLOW_EXT.test(p)
                || p.indexOf('/images') === 0 || p.indexOf('/invite/') === 0) return next();

            const user = req.oidc.user || {};
            const innerMeta = (user.user_metadata && user.user_metadata.metadata) || {};
            const userId = innerMeta.userId;
            const tokenEmail = user.email;

            let record = null;
            let lookupError = false;
            if (userId) {
                try {
                    record = await User.findById(userId, { email: 1 }).lean();
                } catch (e) {
                    lookupError = true; // transient DB error: fail open, don't lock out
                }
            }

            const verdict = decideIdentity({ userId, tokenEmail, record, lookupError });
            const recEmail = (record && record.email) || '∅';

            if (verdict.ok) {
                // Log the non-happy allow paths so a commissioner can spot records
                // that need an email or logins that never carry one.
                if (verdict.reason !== 'match') {
                    console.warn('[identity-guard] allow (' + verdict.reason + ') '
                        + 'login=' + (tokenEmail || '∅') + ' userId=' + (userId || '∅')
                        + ' record=' + recEmail);
                }
                return next();
            }

            console.warn('[identity-guard] BLOCK (' + verdict.reason + ') '
                + 'login=' + (tokenEmail || '∅') + ' userId=' + (userId || '∅')
                + ' record=' + recEmail + ' path=' + p);

            const wantsHtml = (req.headers.accept || '').indexOf('text/html') !== -1;
            if (wantsHtml) {
                return res.status(403).type('html').send(renderBlockPage(user.cc_invite_error));
            }
            return res.status(403).json({
                error: 'account_not_linked',
                message: 'This login is not linked to your team. Log out and sign in with your '
                    + 'original login, or contact your commissioner.'
            });
        } catch (e) {
            // A bug in the guard must never take the whole app down: log and pass.
            console.error('[identity-guard] unexpected error, allowing request', e);
            return next();
        }
    };
}

module.exports = identityGuard;
module.exports.decideIdentity = decideIdentity;
module.exports.renderBlockPage = renderBlockPage;
