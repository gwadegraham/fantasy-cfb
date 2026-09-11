const { internalFetch } = require('./internal-api');
const { activeSeason } = require('./active-season');
module.exports = {
    // Betting is the last, non-critical step of the nightly update. Never let it
    // throw: a non-2xx (or a non-JSON body — e.g. an upstream timeout page) is
    // logged and swallowed so it can't fail the whole scoring job.
    updateAllBettingLines: async function() {
        try {
            const response = await internalFetch(`${process.env.URL}/betting-lines/new/${activeSeason('football')}`, {
                method: 'POST',
                headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json'
                },
                body: `{
                "season": "${activeSeason('football')}"
                }`,
            });

            if (response.status == 201) {
                console.log("✅ Betting lines successfully updated");
            } else {
                const text = await response.text().catch(() => '');
                console.log("❌ Betting lines could not be refreshed | " + response.status + (text ? ' | ' + text.slice(0, 140) : ''));
            }
        } catch (err) {
            console.log("❌ Betting lines update failed: " + err.message);
        }
    }
};