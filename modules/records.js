const { internalFetch, failureMessage } = require('./internal-api');
module.exports = {
    // Records are a non-critical tail step of the scoring pipeline, so a failure
    // is logged and swallowed rather than failing the run — the same contract
    // modules/betting.js already had.
    //
    // It used to end in an un-awaited `response.json().then(...)` with no .catch,
    // so a non-JSON body (Heroku's H12 / 503 page, which a long run provokes)
    // became an unhandled rejection — and with no process-level handler, that
    // exits Node partway through the pipeline. See internal-api failureMessage().
    updateAllTeamRecords: async function() {
        try {
            const response = await internalFetch(`${process.env.URL}/records/new/${process.env.YEAR}`, {
                method: 'POST',
                headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json'
                },
                body: `{
                "season": "${process.env.YEAR}"
                }`,
            });

            if (response.status == 201) {
                console.log("✅ New team records retrieved");
            } else {
                console.log("❌ Team Records could not be retrieved | " + await failureMessage(response));
            }
        } catch (err) {
            console.log("❌ Team records update failed: " + (err && err.message ? err.message : err));
        }
    }
};