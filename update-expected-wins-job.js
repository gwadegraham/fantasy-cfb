if (process.env.NODE_ENV !== 'production') {
    require('dotenv').config()
}

async function updateExpectedWins() {
  var jsonData = require('./json/expectedWins2025.json');
  var updatedTeams = [];
  const season = 2025;

  for (team of jsonData) {

    var requestBody = {
      "expectedWins": team.expectedWins,
    };

    const response = await fetch(`${process.env.URL}/teams/${team.team}/${season}/expectedWins`, {
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