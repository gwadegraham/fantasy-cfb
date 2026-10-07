// Whether a viewer may know basketball exists at all (#319 / hoops stays
// hidden). An Admin, or someone holding a franchise in a basketball league.
//
// The league stays invisible to everyone else until it is announced, and
// EXISTENCE counts: a basketball page any signed-in member could open by URL
// is the leak. Callers refuse with a plain 404, never a 403, for the same
// reason. Fails CLOSED — a lookup that throws hides basketball rather than
// revealing it.
//
// Shared by the team page (#494) and the game page (#503) so the two cannot
// drift into different answers.

const leagueSelection = require('./league-selection');
const seasons = require('./active-season');

async function seesBasketball(req) {
    try {
        const mine = await leagueSelection.viewableBy(req);
        return (mine || []).some(code => seasons.sportForLeague(code) === 'basketball');
    } catch (e) {
        console.error(`hoops visibility check failed: ${e.message}`);
        return false;
    }
}

module.exports = { seesBasketball };
