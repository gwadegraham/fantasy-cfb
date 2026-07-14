const { internalFetch } = require('./internal-api');
module.exports = {
    updateAllTeamScores: async function() {
        const teamsResponse = await internalFetch(`${process.env.URL}/teams`, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            }
        });
        const teams = await teamsResponse.json();
        console.log("Number of teams: " + teams.length);

        // Sequential + awaited: forEach(async) fired ~130 requests at once and
        // returned before any completed, so the caller (the jobs) resolved
        // before scores were actually written, and rejections went unhandled.
        for (const team of teams) {
            try {
                const response = await internalFetch(`${process.env.URL}/calculate-team-score/${process.env.YEAR}/${team.id}/${team.school}`, {
                    method: 'GET',
                    headers: {
                    'Accept': 'application/json'
                    }
                });

                const data = await response.json();
                if (response.status == 200) {
                    console.log("✅ Score successfully calculated for " + data.school);
                } else {
                    console.log("❌ Team score could not be calculated for " + team.school + " | " + response.status);
                }
            } catch (err) {
                console.log(`❌ Error calculating score for team ${team.school}: ${err.message || err}`);
            }
        }
    }
};