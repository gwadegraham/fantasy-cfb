// Pure snake-draft math and validation helpers. No I/O — easy to unit test.

// For a 1-based overall pick number, return which round it's in, the 0-based
// position within that round, and the 0-based slot into draftOrder (reversed on
// even rounds when snake is on).
function slotForOverall(overall, numPlayers, snake) {
    const round = Math.floor((overall - 1) / numPlayers) + 1;   // 1-based
    const pickInRound = (overall - 1) % numPlayers;             // 0-based
    let slotIndex = pickInRound;
    if (snake && round % 2 === 0) {
        slotIndex = numPlayers - 1 - pickInRound;               // reverse even rounds
    }
    return { round, pickInRound, slotIndex };
}

function totalPicks(draft) {
    return draft.totalRounds * draft.draftOrder.length;
}

function isComplete(draft) {
    return draft.currentOverall > totalPicks(draft);
}

// Who is on the clock right now, or null if the draft is complete / empty.
function whoseTurn(draft) {
    const numPlayers = draft.draftOrder.length;
    if (numPlayers === 0 || isComplete(draft)) {
        return null;
    }
    const { round, slotIndex } = slotForOverall(draft.currentOverall, numPlayers, draft.snake);
    return {
        userId: String(draft.draftOrder[slotIndex]),
        overall: draft.currentOverall,
        round
    };
}

// Full pick-by-pick order of userIds (useful for rendering the board upcoming).
function pickOrder(draft) {
    const order = [];
    const numPlayers = draft.draftOrder.length;
    for (let overall = 1; overall <= totalPicks(draft); overall++) {
        const { round, slotIndex } = slotForOverall(overall, numPlayers, draft.snake);
        order.push({ overall, round, userId: String(draft.draftOrder[slotIndex]) });
    }
    return order;
}

module.exports = { slotForOverall, totalPicks, isComplete, whoseTurn, pickOrder };
