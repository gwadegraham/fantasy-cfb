// How long a kickoff can still count as "in progress".
//
// One constant, two consumers that MUST agree: modules/live-poll.js gates
// whether it spends a CFBD call on the slate, and modules/league-scoreboard.js
// decides whether a card reads live or final. When they drifted apart a game
// could stop updating while still showing a live clock, or the reverse.
//
// It exists because `completed` is not perfectly reliable — CFBD occasionally
// never flips the flag (see routes/games.js, where /scoreboard can drop a game
// before the poller sees its final), and without a ceiling a stuck game would
// poll forever and read "live" all week.
//
// 9h, not the 6h it started at: a lightning delay routinely pushes a game past
// six hours from kickoff, and at six the poller quit and the card flipped to
// FINAL while the game was still on TV. The extra three hours only cost calls
// in the stuck-flag case, which the poller's own call buffer already bounds.
const MAX_GAME_HOURS = Number(process.env.LIVE_POLL_MAX_GAME_HOURS) || 9;
const MAX_GAME_MS = MAX_GAME_HOURS * 3600 * 1000;

module.exports = { MAX_GAME_HOURS, MAX_GAME_MS };
