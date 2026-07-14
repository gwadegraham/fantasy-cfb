const { internalFetch } = require('./modules/internal-api');
if (process.env.NODE_ENV !== 'production') {
    require('dotenv').config()
}

async function updateExpectedWins() {
  // Season from CLI arg (e.g. `node update-expected-wins-job.js 2026`),
  // falling back to YEAR. Loads json/expectedWins{season}.json.
  const season = parseInt(process.argv[2], 10) || parseInt(process.env.YEAR, 10);
  var jsonData = require(`./json/expectedWins${season}.json`);
  var updatedTeams = [];

  for (const team of jsonData) {

    var requestBody = {
      "expectedWins": team.expectedWins,
    };

    const response = await internalFetch(`${process.env.URL}/teams/${team.team}/${season}/expectedWins`, {
      method: 'PATCH',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody),
    });

    response.json().then(data => {
      if (response.status == 200) {
          var updatedTeam = {status: response.status, updatedTeam: data};
          updatedTeams.push(updatedTeam);
      } else {
          console.log(data.message);
      }
    });
  }

  return updatedTeams;
}

updateExpectedWins();