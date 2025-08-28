if (process.env.NODE_ENV !== 'production') {
    require('dotenv').config()
}

// Configure CFB Data
const CFBD_API_KEY = process.env.CFBD_API_KEY;
var cfb = require('cfb.js');
var defaultClient = cfb.ApiClient.instance;
var ApiKeyAuth = defaultClient.authentications['ApiKeyAuth'];
ApiKeyAuth.apiKey = CFBD_API_KEY;

const retrieveGamesModule = require('./modules/retrieve-games.js');
const scoringModule = require('./modules/scoring.js');
const teamScoringModule = require('./modules/team-scoring.js');
const recordsModule = require('./modules/records.js');

async function updateScores () {

    var gamesApi = new cfb.GamesApi();
    var calendar = await gamesApi.getCalendar(process.env.YEAR);
    var weekNumber = 1;
    var isPostseason = false;

    if (calendar) {
        for (const calendarWeek of calendar) {
            var startDate = new Date(calendarWeek.firstGameStart);
            var endDate = new Date(calendarWeek.lastGameStart);
            var currentDate = new Date();


            if ((currentDate > startDate) && (currentDate < endDate)) {
                weekNumber = calendarWeek.week;
                if (calendarWeek.seasonType == "postseason") {
                    isPostseason = true;
                }
                break;
            } else if ((currentDate < startDate) && (calendarWeek.week == 1)) {
                weekNumber = 1;
                break;
            } else if ((currentDate < startDate) && (calendarWeek.week > 1)) {
                weekNumber = (calendarWeek.week - 1);
            }
        }
    }

    console.log("It is currently Week", weekNumber);
    console.log("Is it the postseason yet? ", isPostseason);

    const season = process.env.YEAR;
    var seasonType = '';
    var week = weekNumber;

    if (!isPostseason) {
        seasonType = "regular";
    } else {
        seasonType = "postseason";
        week = 1;
    }

    var response = await fetch(`${process.env.URL}/rankings/${season}/${week}/${seasonType}`, {
        method: 'GET',
        headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
        }
    });

    var rankings = await response;

    if (rankings.status == 200) {
        console.log(`Rankings already in system for Season: ${season}, Season Type: ${seasonType}, Week: ${week}`);
    } else {
        const response = await fetch(`${process.env.URL}/rankings/retrieveRankings`, {
            method: 'POST',
            headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json'
            },
            body: `{
            "season": "${season}",
            "seasonType": "${seasonType}",
            "week": "${week}"
            }`,
        });

        response.json().then(data => {
            if (response.status == 201) {
                console.log("New Rankings", data);
            } else {
                console.log(response.status + " Rankings could not be retrieved");
            }
        });
    }

    if (isPostseason) {
        var teams = await retrieveGamesModule.retrieveTeams();
        console.log("number of returned teams", teams.length);

        var games = await retrieveGamesModule.retrievePostseasonGames(teams, 1);
        console.log("number of returned games", games.length);

        await retrieveGamesModule.saveGames(games);
        await scoringModule.updateScores("postseason", 1);
        await scoringModule.updateCumulativeScores();
        await teamScoringModule.updateAllTeamScores();
        await recordsModule.updateAllTeamRecords();
    } else {
        var teams = await retrieveGamesModule.retrieveTeams();
        console.log("number of returned teams", teams.length);

        var games = await retrieveGamesModule.massRetrieveGames(weekNumber, "regular");
        console.log("number of returned new games", games.newGames.length);
        console.log("number of returned existing games", games.existingGames.length);
        
        await scoringModule.updateScores("regular", weekNumber);
        await scoringModule.updateCumulativeScores();
        await teamScoringModule.updateAllTeamScores();
        await recordsModule.updateAllTeamRecords();
    }
}

const todayDate = new Date();
todayDate.setHours(todayDate.getHours() - 5);

var dayText = "";

let nodemailer = require('nodemailer');

let transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: 'gwadegraham@gmail.com',
    pass: 'flgb pbdh dewn lhmw'
  }
});

var emailMessage = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Campus Clash - Weekly Recap</title>
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body {
      font-family: Arial, sans-serif;
      background-color: #121212;
      margin: 0;
      padding: 0;
      color: #e0e0e0;
    }
    .email-container {
      max-width: 600px;
      margin: 0 auto;
      background-color: #1e1e1e;
      border-radius: 8px;
      overflow: hidden;
    }
    .header {
      background-color: #0d47a1;
      color: #ffffff;
      padding: 20px;
      text-align: center;
    }
    .header h1 {
      margin: 0;
      font-size: 24px;
    }
    .section {
      padding: 20px;
      border-bottom: 1px solid #333333;
    }
    .section h2 {
      margin-top: 0;
      font-size: 18px;
      color: #90caf9;
    }
    .stat {
      margin: 6px 0;
      line-height: 1.4em;
    }
    .highlight {
      font-weight: bold;
      color: #64b5f6;
    }
    .footer {
      text-align: center;
      padding: 15px;
      font-size: 12px;
      color: #888888;
      background-color: #121212;
    }
    ol {
      padding-left: 18px;
    }
    @media (max-width: 600px) {
      .section h2 {
        font-size: 16px;
      }
    }
  </style>
</head>
<body>
  <div class="email-container" style="background-color: #1e1e1e;">

    <div class="header">
      <h1>🏈 Campus Clash - Saturday Update</h1>
    </div>

    <div class="section">
      <h2>✅ Update Complete</h2>
      <p class="stat" style="color: #e0e0e0;">Games & scores are being updated during the 3PM, 6PM, and 10PM windows.</p>
    </div>

    <div class="section">
      <h2>📅 Current Date & Time</h2>
      <p style="color: #e0e0e0;">${todayDate.toLocaleString()}</p>
    </div>
    
  </div>
</body>
</html>
`;

let mailOptions = {
  from: 'gwadegraham@gmail.com',
  to: 'gwadegraham@gmail.com',
  subject: 'Campus Clash | Saturday Update',
  html: emailMessage
};

if ((todayDate.getDay() == 6) && ((todayDate.getHours() == 15) || (todayDate.getHours() == 18) || (todayDate.getHours() == 22))) {
    dayText = "Today is Saturday, so games & scores are being updated during the 3PM, 6PM, and 10PM windows.";
    console.log(dayText);
    console.log("Current Date", todayDate.toLocaleString());
    
    updateScores();

    transporter.sendMail(mailOptions, function(error, info){
        if (error) {
            console.log(error);
        } else {
            console.log('Email sent: ' + info.response);
        }
    });
    
} else {
    dayText = "Today is not Saturday, so games & scores are NOT being updated.";
    console.log(dayText);
    console.log("Current Date", todayDate.toLocaleString());
}