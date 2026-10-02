const Draft = require('../models/draft');
const draftPool = require('./draft-pool');
const { rosterEntryFor } = require('./roster-teams');
const { sportForLeague } = require('./active-season');
const engine = require('./draft-engine');
const draftToken = require('./draft-token');
const { internalFetch, failureMessage } = require('./internal-api');

function roomKey(league, season) {
    return `draft:${league}:${season}`;
}

function isCommissioner(user) {
    return user && (user.role === 'Admin' || user.role === 'League Manager');
}

// Commissioner control is scoped by league: an Admin controls any league's
// draft; a League Manager only their own (the league is baked into their
// signed draft token).
function isCommissionerOf(user, league) {
    if (!user) return false;
    if (user.role === 'Admin') return true;
    return user.role === 'League Manager' && user.league === league;
}

// The shape broadcast to clients — the draft plus a derived "on the clock".
function publicState(draft) {
    const d = draft.toObject ? draft.toObject() : draft;
    return {
        _id: d._id,
        league: d.league,
        season: d.season,
        status: d.status,
        snake: d.snake,
        totalRounds: d.totalRounds,
        poolSize: d.poolSize == null ? null : d.poolSize,
        scheduledAt: d.scheduledAt,
        callUrl: d.callUrl || null,
        draftOrder: (d.draftOrder || []).map(String),
        picks: d.picks || [],
        currentOverall: d.currentOverall,
        onTheClock: engine.whoseTurn(d)
    };
}

// On completion, write each member's drafted teams onto their season, reusing
// the existing PATCH /users/draft/:id endpoint (server-to-server, token auth).
async function persistTeamsToUsers(draft) {
    // Basketball rosters store a REFERENCE; football still stores the whole
    // document (#478). The sport decides, once, here — rosterEntryFor is the
    // only place that choice is made.
    const sport = sportForLeague(draft.league);
    const teamsByUser = {};
    for (const pick of draft.picks) {
        const uid = String(pick.userId);
        if (!teamsByUser[uid]) teamsByUser[uid] = [];
        const team = pick.team || {};
        // CFBD team.location uses `id`; the user schema expects `venue_id`.
        if (team.location && team.location.id != null && team.location.venue_id == null) {
            team.location.venue_id = team.location.id;
            delete team.location.id;
        }
        // null means the id was unusable. Dropping that ONE pick beats sending
        // a ref carrying NaN, which fails validation for the whole manager —
        // and persistTeamsToUsers only logs that, so one bad pick would cost
        // someone their entire roster.
        const entry = rosterEntryFor(team, sport);
        if (entry) teamsByUser[uid].push(entry);
        else console.error(`draft ${draft.league}/${draft.season}: pick ${pick.overall} has an unusable team id (${JSON.stringify(team && team.id)}) — dropped`);
    }

    // ⚠️ THE RESPONSE IS READ. It was discarded, and that is what would have
    // made every other failure here invisible: the PATCH answers 400 when a
    // rostered team is missing a required field, and the draft still completed,
    // the confetti still fired, draft-complete still broadcast, and every
    // roster was empty with nothing in any log.
    //
    // Not thrown: by this point the picks are made and the draft is over, so
    // the useful thing is a loud record of WHICH manager did not get a roster,
    // not an exception that strands the room.
    const failed = [];
    for (const userId of Object.keys(teamsByUser)) {
        try {
            // THE LEAGUE TRAVELS WITH THE WRITE. Without it the route loads
            // whichever franchise comes back first, and a basketball draft
            // puts its roster on the manager's football team.
            const payload = Object.assign(
                { season: draft.season, league: draft.league },
                sport === 'basketball'
                    ? { teamRefs: teamsByUser[userId] }
                    : { teams: teamsByUser[userId] }
            );
            const res = await internalFetch(`${process.env.URL}/users/draft/${userId}`, {
                method: 'PATCH',
                headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            if (!res.ok) failed.push(`${userId}: ${res.status} ${await failureMessage(res)}`);
        } catch (err) {
            failed.push(`${userId}: ${err.message}`);
        }
    }
    if (failed.length) {
        console.error(`draft ${draft.league}/${draft.season}: ${failed.length} roster(s) FAILED to persist — ${failed.join(' | ')}`);
    }
    return { failed };
}

module.exports = function registerDraftSockets(io) {
    // Authenticate every socket from the handshake token.
    io.use((socket, next) => {
        const token = socket.handshake.auth && socket.handshake.auth.token;
        const payload = draftToken.verify(token, process.env.AUTH_SECRET);
        if (!payload || !payload.userId) {
            return next(new Error('unauthorized'));
        }
        socket.user = payload; // { userId, role, name }
        next();
    });

    io.on('connection', (socket) => {
        socket.on('join-draft', async ({ league, season }) => {
            try {
                const draft = await Draft.findOne({ league, season });
                if (!draft) {
                    return socket.emit('draft-error', { message: 'No draft configured' });
                }
                socket.data.league = league;
                socket.data.season = season;
                socket.join(roomKey(league, season));
                socket.emit('draft-state', publicState(draft));
            } catch (err) {
                socket.emit('draft-error', { message: err.message });
            }
        });

        socket.on('start-draft', async ({ league, season }) => {
            try {
                if (!isCommissionerOf(socket.user, league)) {
                    return socket.emit('draft-error', { message: 'Only the commissioner can start the draft' });
                }
                const draft = await Draft.findOne({ league, season });
                if (!draft) return socket.emit('draft-error', { message: 'No draft configured' });
                if (draft.status === 'complete') return socket.emit('draft-error', { message: 'Draft is already complete' });
                if (!Array.isArray(draft.draftOrder) || draft.draftOrder.length < 2) {
                    return socket.emit('draft-error', { message: 'Draft needs at least 2 participants' });
                }
                draft.status = 'active';
                if (!draft.currentOverall || draft.currentOverall < 1) draft.currentOverall = 1;
                draft.updatedAt = new Date();
                await draft.save();
                io.to(roomKey(league, season)).emit('draft-state', publicState(draft));
            } catch (err) {
                socket.emit('draft-error', { message: err.message });
            }
        });

        socket.on('undo-pick', async ({ league, season }) => {
            try {
                if (!isCommissionerOf(socket.user, league)) {
                    return socket.emit('draft-error', { message: 'Only the commissioner can undo a pick' });
                }
                const draft = await Draft.findOne({ league, season });
                if (!draft) return socket.emit('draft-error', { message: 'No draft configured' });
                if (draft.status !== 'active') return socket.emit('draft-error', { message: 'Can only undo during an active draft' });
                if (!draft.picks.length) return socket.emit('draft-error', { message: 'No picks to undo' });

                // Atomic: remove the last pick and step the clock back, guarded on
                // currentOverall so it can't race with an in-flight pick.
                const updated = await Draft.findOneAndUpdate(
                    { _id: draft._id, status: 'active', currentOverall: draft.currentOverall },
                    { $pop: { picks: 1 }, $inc: { currentOverall: -1 }, $set: { updatedAt: new Date() } },
                    { new: true }
                );
                if (!updated) return socket.emit('draft-error', { message: 'Undo failed — try again' });

                io.to(roomKey(league, season)).emit('draft-state', publicState(updated));
            } catch (err) {
                socket.emit('draft-error', { message: err.message });
            }
        });

        socket.on('make-pick', async ({ league, season, team, forUserId }) => {
            try {
                const draft = await Draft.findOne({ league, season });
                if (!draft) return socket.emit('draft-error', { message: 'No draft configured' });
                if (draft.status !== 'active') return socket.emit('draft-error', { message: 'Draft is not active' });
                if (!team || team.id == null) return socket.emit('draft-error', { message: 'Invalid team' });

                const turn = engine.whoseTurn(draft);
                if (!turn) return socket.emit('draft-error', { message: 'Draft is complete' });

                const commish = isCommissionerOf(socket.user, league);
                // A member may only pick on their own turn; a commissioner may
                // pick for whoever is on the clock (absent member).
                if (String(socket.user.userId) !== turn.userId && !commish) {
                    return socket.emit('draft-error', { message: "It's not your turn" });
                }

                // The team has to be IN the pool, and the row we store is the
                // one we looked up — never the object the client sent. The
                // board is the thing being bypassed here, so nothing it
                // supplies is trusted beyond the id, and even that is
                // re-resolved: a string "1" validated as team 1 and was then
                // written as "1", which the duplicate guard below compares
                // against stored NUMBERS, so two managers got the same team.
                const resolved = await draftPool.draftableTeam(league, {
                    teamId: team.id, poolSize: draft.poolSize, season
                });
                if (!resolved) {
                    return socket.emit('draft-error', { message: 'That team is not in the draft pool' });
                }

                const pick = {
                    round: turn.round,
                    overall: turn.overall,
                    userId: turn.userId,
                    team: resolved,
                    pickedAt: new Date(),
                    pickedByCommissioner: String(socket.user.userId) !== turn.userId
                };

                // Atomic apply: only if the turn hasn't advanced and the team
                // isn't already taken. Prevents double-picks / races.
                const updated = await Draft.findOneAndUpdate(
                    {
                        _id: draft._id,
                        status: 'active',
                        currentOverall: turn.overall,
                        // resolved.id, not team.id: the client's value may be a
                        // string, and "1" !== 1 against the stored numbers.
                        'picks.team.id': { $ne: resolved.id }
                    },
                    { $push: { picks: pick }, $inc: { currentOverall: 1 }, $set: { updatedAt: new Date() } },
                    { new: true }
                );

                if (!updated) {
                    return socket.emit('draft-error', { message: 'Pick no longer valid (turn advanced or team already taken)' });
                }

                let finalDraft = updated;
                if (engine.isComplete(updated)) {
                    finalDraft = await Draft.findByIdAndUpdate(
                        updated._id,
                        { $set: { status: 'complete', updatedAt: new Date() } },
                        { new: true }
                    );
                }

                io.to(roomKey(league, season)).emit('pick-made', { pick, state: publicState(finalDraft) });

                if (finalDraft.status === 'complete') {
                    await persistTeamsToUsers(finalDraft);
                    io.to(roomKey(league, season)).emit('draft-complete', publicState(finalDraft));
                }
            } catch (err) {
                socket.emit('draft-error', { message: err.message });
            }
        });
    });
};

module.exports.roomKey = roomKey;
module.exports.publicState = publicState;
// Exported for its own test. It had NO coverage: replacing the sport branch so
// it always sent `teams`, and deleting the PATCH's teamRefs handling, each left
// the whole suite green — the same gap as the pool gate in #476, in this same
// file, one PR later.
module.exports.persistTeamsToUsers = persistTeamsToUsers;
