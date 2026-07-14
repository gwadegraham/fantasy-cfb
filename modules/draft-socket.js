const Draft = require('../models/draft');
const engine = require('./draft-engine');
const draftToken = require('./draft-token');
const { internalFetch } = require('./internal-api');

function roomKey(league, season) {
    return `draft:${league}:${season}`;
}

function isCommissioner(user) {
    return user && (user.role === 'Admin' || user.role === 'League Manager');
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
        draftOrder: (d.draftOrder || []).map(String),
        picks: d.picks || [],
        currentOverall: d.currentOverall,
        onTheClock: engine.whoseTurn(d)
    };
}

// On completion, write each member's drafted teams onto their season, reusing
// the existing PATCH /users/draft/:id endpoint (server-to-server, token auth).
async function persistTeamsToUsers(draft) {
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
        teamsByUser[uid].push(team);
    }

    for (const userId of Object.keys(teamsByUser)) {
        await internalFetch(`${process.env.URL}/users/draft/${userId}`, {
            method: 'PATCH',
            headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
            body: JSON.stringify({ season: draft.season, teams: teamsByUser[userId] })
        });
    }
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

        socket.on('make-pick', async ({ league, season, team, forUserId }) => {
            try {
                const draft = await Draft.findOne({ league, season });
                if (!draft) return socket.emit('draft-error', { message: 'No draft configured' });
                if (draft.status !== 'active') return socket.emit('draft-error', { message: 'Draft is not active' });
                if (!team || team.id == null) return socket.emit('draft-error', { message: 'Invalid team' });

                const turn = engine.whoseTurn(draft);
                if (!turn) return socket.emit('draft-error', { message: 'Draft is complete' });

                const commish = isCommissioner(socket.user);
                // A member may only pick on their own turn; a commissioner may
                // pick for whoever is on the clock (absent member).
                if (String(socket.user.userId) !== turn.userId && !commish) {
                    return socket.emit('draft-error', { message: "It's not your turn" });
                }

                const pick = {
                    round: turn.round,
                    overall: turn.overall,
                    userId: turn.userId,
                    team,
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
                        'picks.team.id': { $ne: team.id }
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
