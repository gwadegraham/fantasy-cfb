/**
 * Campus Clash — Auth0 post-login Action ("Post Login Add Metadata").
 *
 * THIS FILE IS THE SOURCE OF TRUTH. The live copy lives in the Auth0 dashboard
 * under Actions > Library > Post Login Add Metadata; paste this whole file there
 * after editing, on BOTH tenants. Nothing deploys it for you — same discipline
 * as auth/login.html, and the same trap: the repo copy and the running copy
 * drift apart silently if you skip it. See README.
 *
 * It does two things.
 *
 * 1. Builds the `user_metadata` claim every page of the app reads. This half is
 *    unchanged and has run for years: server.js, modules/dev-role.js and
 *    modules/league-access.js all read user_metadata.metadata.* off the ID
 *    token, and nothing else puts it there.
 *
 * 2. Claims an invite, if the login carries one. This is the half that matters
 *    for new members, and the reason it lives HERE rather than in the app: an
 *    Action runs before the ID token is minted. The app used to write the
 *    franchise pointer after login, which meant the token was stale the instant
 *    it existed and the invitee had to sign in a second time to get a usable
 *    one. Resolving here puts the pointer in the first token.
 *
 * Secrets to configure alongside this Action (Actions editor, key icon):
 *   APP_URL             e.g. https://campusclash.io
 *   INTERNAL_API_TOKEN  must equal the app's INTERNAL_API_TOKEN
 */

const RESOLVE_TIMEOUT_MS = 5000;

exports.onExecutePostLogin = async (event, api) => {
  // Start from whatever the account already carries. An ordinary login gets
  // exactly what it got before this Action learned about invites.
  let metadata = event.user.user_metadata || {};

  // `ext-`-prefixed authorize parameters are forwarded by Auth0 to Actions.
  // server.js puts the signed invite token here in /invite/:token/start.
  const inviteToken = (event.request && event.request.query && event.request.query['ext-invite']) || null;

  // Only worth asking when the login has an invite AND no franchise yet. A
  // member who already has one is never repointed — that guard also exists
  // server-side, but not making the call at all is cheaper and safer.
  if (inviteToken && !metadata.userId) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), RESOLVE_TIMEOUT_MS);

      const res = await fetch(`${event.secrets.APP_URL}/invite/resolve`, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'content-type': 'application/json',
          'X-Internal-Token': event.secrets.INTERNAL_API_TOKEN
        },
        body: JSON.stringify({
          token: inviteToken,
          sub: event.user.user_id,
          email: event.user.email,
          currentUserId: metadata.userId || null
        })
      }).finally(() => clearTimeout(timer));

      const body = await res.json();

      if (body && body.claimed) {
        // Persist for every future login...
        api.user.setUserMetadata('userId', body.userId);
        api.user.setUserMetadata('league', body.league);
        // ...and use it for THIS one. setUserMetadata is applied after the flow
        // finishes, so event.user.user_metadata is still the old object here —
        // the claim has to be built from the response, not re-read.
        metadata = Object.assign({}, metadata, { userId: body.userId, league: body.league });
      } else if (body && body.message) {
        // A refusal is a real answer — spent link, wrong address — and the
        // person deserves to see why rather than a generic "not linked" page.
        // They still get a session; the app's identity guard stops them, and
        // this message rides along to explain it.
        api.idToken.setCustomClaim('cc_invite_error', body.message);
      }
    } catch (err) {
      // Deliberately swallowed. The app being asleep, slow or broken must never
      // take logins down for the whole league — an unclaimed invitee can retry,
      // an ordinary member never notices.
      console.log('invite resolve failed:', err && err.message);
    }
  }

  api.idToken.setCustomClaim('user_metadata', {
    roles: (event.authorization && event.authorization.roles) || [],
    metadata: metadata
  });
};

/**
 * Not used — this Action performs no redirects.
 */
// exports.onContinuePostLogin = async (event, api) => {};
