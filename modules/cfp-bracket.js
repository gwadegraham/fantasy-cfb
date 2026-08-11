// Normalizes CFBD's /playoffs/cfp payload into the shape stored by
// models/cfpBracket.js, and looks facts back out of a stored bracket.
//
// WHY THIS EXISTS: postseason scoring used to classify bracket rounds by
// substring-matching CFBD's `notes` field — marketing prose that demonstrably
// drifts ("College Football Playoff First Round Game Presented by Allstate" in
// 2024 became "College Football Playoff First Round Game" in 2025), and bowl
// names move between rounds (the Fiesta was a quarterfinal in 2024 and a
// semifinal in 2025). A drifted string silently scores a playoff game as a
// plain bowl. The bracket states the round outright, keyed by game id.
//
// Pure: no I/O, no Mongo, no network. routes/playoffs.js does the fetching and
// storing; modules/scoring-detectors.js does the reading.

// The closed round vocabulary, matching CFBD's `round` codes. Verified
// identical across both published 12-team brackets (2024 and 2025).
const ROUNDS = {
    FIRST_ROUND: 'first_round',
    QUARTERFINAL: 'quarterfinal',
    SEMIFINAL: 'semifinal',
    CHAMPIONSHIP: 'championship'
};
const KNOWN_ROUNDS = Object.keys(ROUNDS).map(k => ROUNDS[k]);

// Thrown for a payload we refuse to store. Carried as its own type so the route
// can answer 400 (bad bracket) rather than 500 (we broke).
class BracketRejected extends Error {
    constructor(message) {
        super(message);
        this.name = 'BracketRejected';
    }
}

function participantOf(slot) {
    return (slot && slot.participant && slot.participant.id != null) ? slot.participant : null;
}

// Every (round, matchup) pair in the payload, flattened. Each matchup's own
// `round` wins over the round's `code` — they agree in both real seasons, and
// the per-matchup value is the one CFBD documents as authoritative.
function eachMatchup(payload) {
    const out = [];
    const rounds = Array.isArray(payload.rounds) ? payload.rounds : [];
    for (const round of rounds) {
        const matchups = Array.isArray(round.matchups) ? round.matchups : [];
        for (const matchup of matchups) {
            out.push({ round: matchup.round || round.code, order: round.order, matchup: matchup });
        }
    }
    return out;
}

// Two INDEPENDENT CFBD signals name the teams that got a first-round bye:
// the participant's `firstRoundBye` flag, and occupying a quarterfinal slot
// that no earlier matchup feeds (`source: null`). Graham's league pays a bonus
// for the bye, so a disagreement between them is worth failing loudly over
// rather than picking a winner — the notes fallback still scores the game.
//
// The trap this guards, and the reason the check is scoped to QUARTERFINAL
// slots: first-round slots are also sourceless (2025 Oregon is seed 5, source
// null, no bye). Read "source is null" unscoped and every first-round team
// collects the bye bonus.
//
// Skipped when the quarterfinal round isn't in the payload yet, or when its bye
// slots aren't populated: there's nothing to cross-check, and no quarterfinal
// game is in `games` to score off either.
function crossCheckByes(matchups, byeTeamIds) {
    const qfSlots = [];
    for (const m of matchups) {
        if (m.round !== ROUNDS.QUARTERFINAL) continue;
        for (const slot of (Array.isArray(m.matchup.slots) ? m.matchup.slots : [])) qfSlots.push(slot);
    }
    if (!qfSlots.length) return;

    const sourceless = qfSlots.filter(s => !s.source && participantOf(s));
    if (!sourceless.length) return;

    const byes = new Set(byeTeamIds);
    const named = (s) => `${participantOf(s).school} (${participantOf(s).id})`;

    // 1. A sourceless quarterfinal slot IS a bye slot.
    for (const slot of sourceless) {
        if (!byes.has(participantOf(slot).id)) {
            throw new BracketRejected(
                `${named(slot)} occupies a quarterfinal slot with no source but is not flagged firstRoundBye`);
        }
    }

    // 2. A bye team never arrives at a quarterfinal by winning something.
    for (const slot of qfSlots) {
        const team = participantOf(slot);
        if (slot.source && team && byes.has(team.id)) {
            throw new BracketRejected(
                `${named(slot)} is flagged firstRoundBye but reaches the quarterfinal via ${slot.source.bracketSlot}`);
        }
    }

    // 3. Every flagged bye is accounted for by a slot (catches a bye flag on a
    //    team that isn't in the bracket's quarterfinal round at all).
    if (sourceless.length !== byes.size) {
        throw new BracketRejected(
            `${byes.size} teams flagged firstRoundBye but ${sourceless.length} sourceless quarterfinal slots`);
    }
}

// CFBD payload -> the fields models/cfpBracket.js stores.
// Throws BracketRejected for a payload we won't score off.
function deriveBracket(payload) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        throw new BracketRejected('Bracket payload is not an object');
    }
    if (payload.season == null || !Number.isFinite(Number(payload.season))) {
        throw new BracketRejected('Bracket payload has no season');
    }

    const rawParticipants = Array.isArray(payload.participants) ? payload.participants : [];
    const participants = rawParticipants
        .filter(p => p && p.team && p.team.id != null)
        .map(p => ({
            teamId: p.team.id,
            school: p.team.school,
            conference: p.team.conference,
            seed: p.seed,
            committeeRank: p.committeeRank,
            firstRoundBye: !!p.firstRoundBye,
            bidType: p.bidType,
            conferenceChampion: !!p.conferenceChampion,
            outcome: p.outcome,
            eliminatedRound: p.eliminatedRound
        }));
    const byId = new Map(participants.map(p => [p.teamId, p]));

    const matchups = eachMatchup(payload);

    // An unrecognized round code means the format changed under us. Refuse the
    // whole bracket rather than store a partial one: a bracket missing a round
    // reads as "these games aren't playoff games", which is worse than falling
    // back to notes for all of them.
    for (const m of matchups) {
        if (!KNOWN_ROUNDS.includes(m.round)) {
            throw new BracketRejected(`Unrecognized CFP round "${m.round}" (format ${payload.format || 'unknown'})`);
        }
    }

    crossCheckByes(matchups, participants.filter(p => p.firstRoundBye).map(p => p.teamId));

    const games = [];
    for (const m of matchups) {
        const matchup = m.matchup;
        if (!matchup.game || matchup.game.id == null) continue;   // slot not scheduled yet
        const teams = (Array.isArray(matchup.slots) ? matchup.slots : [])
            .map(participantOf)
            .filter(Boolean)
            .map(team => {
                const p = byId.get(team.id);
                return {
                    teamId: team.id,
                    school: team.school,
                    // From the participant record, not the slot: a slot filled
                    // by a first-round winner carries seed: null.
                    seed: p ? p.seed : null,
                    firstRoundBye: p ? p.firstRoundBye : false
                };
            });
        games.push({
            gameId: matchup.game.id,
            round: m.round,
            bracketSlot: matchup.bracketSlot,
            roundOrder: matchup.roundOrder != null ? matchup.roundOrder : m.order,
            bowlName: matchup.bowlName,
            teams: teams
        });
    }

    // Before selection day the bracket exists with no games in it. Refusing
    // keeps a job run from overwriting a good bracket with an empty one, and
    // gives the run a clear reason instead of a silent no-op.
    if (!games.length) {
        throw new BracketRejected('Bracket has no scheduled games yet');
    }

    const champion = (payload.champion && payload.champion.id != null)
        ? { teamId: payload.champion.id, school: payload.champion.school }
        : undefined;

    return {
        season: Number(payload.season),
        format: payload.format,
        teamCount: payload.teamCount,
        status: payload.status,
        champion: champion,
        participants: participants,
        games: games
    };
}

// --- reads ---------------------------------------------------------------

// The bracket facts for one game, or null when this game isn't in the bracket
// (every non-playoff bowl, and every game in a season with no bracket on file).
// Callers treat null as "no bracket evidence" and fall back to notes.
function factsForGame(bracket, gameId) {
    if (!bracket || !Array.isArray(bracket.games) || gameId == null) return null;
    return bracket.games.find(g => g.gameId == gameId) || null;
}

// One team's seed/bye within a single bracket game.
function teamInGame(gameFacts, teamId) {
    if (!gameFacts || !Array.isArray(gameFacts.teams) || teamId == null) return null;
    return gameFacts.teams.find(t => t.teamId == teamId) || null;
}

module.exports = {
    ROUNDS,
    KNOWN_ROUNDS,
    BracketRejected,
    deriveBracket,
    factsForGame,
    teamInGame
};
