module.exports = {
    updateAllTeamScores: async function() {
        await fetch(`${process.env.URL}/teams`, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            }
        }).then(res => res.json()).then(data => {
            console.log("Number of teams: " + data.length)
            data.forEach(async (team) => {
                var response = await fetch(`${process.env.URL}/calculate-team-score/${process.env.YEAR}/${team.id}/${team.school}`, {
                    method: 'GET',
                    headers: {
                    'Accept': 'application/json'
                    }
                });

                response.json().then(data => {
                    if (response.status == 200) {
                        console.log("✅ Score successfully calculated for " + data.school);
                    } else {
                        console.log("❌ Team score could not be calculated for " + data.school + " | " + response.status);
                    }
                });
            })
        });
    }
};