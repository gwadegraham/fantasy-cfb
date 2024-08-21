const scoringModule = require('../scoring.js');

describe('Claunts Scoring Test Suite', () => {
    it('Non-Conference Unranked Game Loss', async () => {
        const team = "University of Central Florida";
        const game = {
            "_id": {
              "$oid": "65dfd87c1546400b2aeb7975"
            },
            "id": 401520363,
            "season": 2023,
            "week": 10,
            "seasonType": "regular",
            "startDate": "2023-11-04T16:00:00.000Z",
            "startTimeTbd": false,
            "completed": true,
            "neutralSite": false,
            "conferenceGame": false,
            "attendance": 89782,
            "venueId": 3634,
            "venue": "Bounce House",
            "homeId": 57,
            "homeTeam": "University of Central Florida",
            "homeConference": "Big 12",
            "homeDivision": "fbs",
            "homePoints": 36,
            "homeLineScores": [
              14,
              3,
              6,
              10,
              3
            ],
            "homePostWinProb": "0.08075347362469056",
            "homePregameElo": 1592,
            "homePostgameElo": 1588,
            "awayId": 8,
            "awayTeam": "Arkansas",
            "awayConference": "SEC",
            "awayDivision": "fbs",
            "awayPoints": 39,
            "awayLineScores": [
              14,
              3,
              3,
              13,
              6
            ],
            "awayPostWinProb": "0.9192465263753095",
            "awayPregameElo": 1596,
            "awayPostgameElo": 1600,
            "excitementIndex": "9.7718678848",
            "highlights": null,
            "notes": "test Arkansas game notes"
          };
        const week = 10;
        const rankings = [{
            "_id": {
              "$oid": "65de66651546400b2aeb6e64"
            },
            "season": 2023,
            "seasonType": "regular",
            "week": 10,
            "polls": [
              {
                "poll": "Coaches Poll",
                "ranks": [
                  {
                    "rank": 1,
                    "school": "Georgia",
                    "conference": "SEC",
                    "firstPlaceVotes": 58,
                    "points": 1590
                  },
                  {
                    "rank": 2,
                    "school": "Michigan",
                    "conference": "Big Ten",
                    "firstPlaceVotes": 3,
                    "points": 1520
                  },
                  {
                    "rank": 3,
                    "school": "Ohio State",
                    "conference": "Big Ten",
                    "firstPlaceVotes": 3,
                    "points": 1454
                  },
                  {
                    "rank": 4,
                    "school": "Florida State",
                    "conference": "ACC",
                    "firstPlaceVotes": 0,
                    "points": 1439
                  },
                  {
                    "rank": 5,
                    "school": "Washington",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 1344
                  },
                  {
                    "rank": 6,
                    "school": "Texas",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 1212
                  },
                  {
                    "rank": 7,
                    "school": "Oregon",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 1211
                  },
                  {
                    "rank": 8,
                    "school": "Alabama",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 1187
                  },
                  {
                    "rank": 9,
                    "school": "Penn State",
                    "conference": "Big Ten",
                    "firstPlaceVotes": 0,
                    "points": 1072
                  },
                  {
                    "rank": 10,
                    "school": "Ole Miss",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 1021
                  },
                  {
                    "rank": 11,
                    "school": "Oklahoma",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 948
                  },
                  {
                    "rank": 12,
                    "school": "Notre Dame",
                    "conference": "FBS Independents",
                    "firstPlaceVotes": 0,
                    "points": 847
                  },
                  {
                    "rank": 13,
                    "school": "LSU",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 809
                  },
                  {
                    "rank": 14,
                    "school": "Missouri",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 741
                  },
                  {
                    "rank": 15,
                    "school": "Louisville",
                    "conference": "ACC",
                    "firstPlaceVotes": 0,
                    "points": 701
                  },
                  {
                    "rank": 16,
                    "school": "Tennessee",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 553
                  },
                  {
                    "rank": 17,
                    "school": "Air Force",
                    "conference": "Mountain West",
                    "firstPlaceVotes": 0,
                    "points": 523
                  },
                  {
                    "rank": 18,
                    "school": "Utah",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 509
                  },
                  {
                    "rank": 19,
                    "school": "Oregon State",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 465
                  },
                  {
                    "rank": 20,
                    "school": "UCLA",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 309
                  },
                  {
                    "rank": 21,
                    "school": "Tulane",
                    "conference": "American Athletic",
                    "firstPlaceVotes": 0,
                    "points": 304
                  },
                  {
                    "rank": 22,
                    "school": "USC",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 239
                  },
                  {
                    "rank": 23,
                    "school": "Kansas",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 182
                  },
                  {
                    "rank": 24,
                    "school": "James Madison",
                    "conference": "Sun Belt",
                    "firstPlaceVotes": 0,
                    "points": 169
                  },
                  {
                    "rank": 25,
                    "school": "North Carolina",
                    "conference": "ACC",
                    "firstPlaceVotes": 0,
                    "points": 120
                  }
                ]
              },
              {
                "poll": "AP Top 25",
                "ranks": [
                  {
                    "rank": 1,
                    "school": "Georgia",
                    "conference": "SEC",
                    "firstPlaceVotes": 48,
                    "points": 1553
                  },
                  {
                    "rank": 2,
                    "school": "Michigan",
                    "conference": "Big Ten",
                    "firstPlaceVotes": 9,
                    "points": 1494
                  },
                  {
                    "rank": 3,
                    "school": "Ohio State",
                    "conference": "Big Ten",
                    "firstPlaceVotes": 3,
                    "points": 1446
                  },
                  {
                    "rank": 4,
                    "school": "Florida State",
                    "conference": "ACC",
                    "firstPlaceVotes": 3,
                    "points": 1421
                  },
                  {
                    "rank": 5,
                    "school": "Washington",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 1327
                  },
                  {
                    "rank": 6,
                    "school": "Oregon",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 1235
                  },
                  {
                    "rank": 7,
                    "school": "Texas",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 1189
                  },
                  {
                    "rank": 8,
                    "school": "Alabama",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 1114
                  },
                  {
                    "rank": 9,
                    "school": "Penn State",
                    "conference": "Big Ten",
                    "firstPlaceVotes": 0,
                    "points": 1044
                  },
                  {
                    "rank": 10,
                    "school": "Oklahoma",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 1010
                  },
                  {
                    "rank": 11,
                    "school": "Ole Miss",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 990
                  },
                  {
                    "rank": 12,
                    "school": "Notre Dame",
                    "conference": "FBS Independents",
                    "firstPlaceVotes": 0,
                    "points": 847
                  },
                  {
                    "rank": 13,
                    "school": "LSU",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 816
                  },
                  {
                    "rank": 14,
                    "school": "Missouri",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 714
                  },
                  {
                    "rank": 15,
                    "school": "Louisville",
                    "conference": "ACC",
                    "firstPlaceVotes": 0,
                    "points": 666
                  },
                  {
                    "rank": 16,
                    "school": "Oregon State",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 557
                  },
                  {
                    "rank": 17,
                    "school": "Air Force",
                    "conference": "Mountain West",
                    "firstPlaceVotes": 0,
                    "points": 526
                  },
                  {
                    "rank": 18,
                    "school": "Utah",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 510
                  },
                  {
                    "rank": 19,
                    "school": "Tennessee",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 473
                  },
                  {
                    "rank": 20,
                    "school": "UCLA",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 331
                  },
                  {
                    "rank": 21,
                    "school": "Tulane",
                    "conference": "American Athletic",
                    "firstPlaceVotes": 0,
                    "points": 303
                  },
                  {
                    "rank": 22,
                    "school": "Kansas",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 250
                  },
                  {
                    "rank": 23,
                    "school": "James Madison",
                    "conference": "Sun Belt",
                    "firstPlaceVotes": 0,
                    "points": 192
                  },
                  {
                    "rank": 24,
                    "school": "USC",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 139
                  },
                  {
                    "rank": 25,
                    "school": "Kansas State",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 112
                  }
                ]
              },
              {
                "poll": "FCS Coaches Poll",
                "ranks": [
                  {
                    "rank": 1,
                    "school": "South Dakota State",
                    "conference": "MVFC",
                    "firstPlaceVotes": 25,
                    "points": 625
                  },
                  {
                    "rank": 2,
                    "school": "Furman",
                    "conference": "Southern",
                    "firstPlaceVotes": 0,
                    "points": 577
                  },
                  {
                    "rank": 3,
                    "school": "Montana",
                    "conference": "Big Sky",
                    "firstPlaceVotes": 0,
                    "points": 544
                  },
                  {
                    "rank": 4,
                    "school": "Incarnate Word",
                    "conference": "Southland",
                    "firstPlaceVotes": 0,
                    "points": 533
                  },
                  {
                    "rank": 5,
                    "school": "Idaho",
                    "conference": "Big Sky",
                    "firstPlaceVotes": 0,
                    "points": 515
                  },
                  {
                    "rank": 6,
                    "school": "Delaware",
                    "conference": "CAA",
                    "firstPlaceVotes": 0,
                    "points": 507
                  },
                  {
                    "rank": 7,
                    "school": "Sacramento State",
                    "conference": "Big Sky",
                    "firstPlaceVotes": 0,
                    "points": 471
                  },
                  {
                    "rank": 8,
                    "school": "Montana State",
                    "conference": "Big Sky",
                    "firstPlaceVotes": 0,
                    "points": 458
                  },
                  {
                    "rank": 9,
                    "school": "North Carolina Central",
                    "conference": "MEAC",
                    "firstPlaceVotes": 0,
                    "points": 407
                  },
                  {
                    "rank": 10,
                    "school": "North Dakota State",
                    "conference": "MVFC",
                    "firstPlaceVotes": 0,
                    "points": 398
                  },
                  {
                    "rank": 11,
                    "school": "Southern Illinois",
                    "conference": "MVFC",
                    "firstPlaceVotes": 0,
                    "points": 380
                  },
                  {
                    "rank": 12,
                    "school": "South Dakota",
                    "conference": "MVFC",
                    "firstPlaceVotes": 0,
                    "points": 330
                  },
                  {
                    "rank": 13,
                    "school": "Florida A&M",
                    "conference": "SWAC",
                    "firstPlaceVotes": 0,
                    "points": 296
                  },
                  {
                    "rank": 13,
                    "school": "Chattanooga",
                    "conference": "Southern",
                    "firstPlaceVotes": 0,
                    "points": 296
                  },
                  {
                    "rank": 15,
                    "school": "North Dakota",
                    "conference": "MVFC",
                    "firstPlaceVotes": 0,
                    "points": 260
                  },
                  {
                    "rank": 16,
                    "school": "Lafayette",
                    "conference": "Patriot",
                    "firstPlaceVotes": 0,
                    "points": 241
                  },
                  {
                    "rank": 17,
                    "school": "Austin Peay",
                    "conference": "UAC",
                    "firstPlaceVotes": 0,
                    "points": 218
                  },
                  {
                    "rank": 18,
                    "school": "UT Martin",
                    "conference": "Big South-OVC",
                    "firstPlaceVotes": 0,
                    "points": 179
                  },
                  {
                    "rank": 19,
                    "school": "Harvard",
                    "conference": "Ivy",
                    "firstPlaceVotes": 0,
                    "points": 137
                  },
                  {
                    "rank": 20,
                    "school": "Western Carolina",
                    "conference": "Southern",
                    "firstPlaceVotes": 0,
                    "points": 124
                  },
                  {
                    "rank": 21,
                    "school": "Holy Cross",
                    "conference": "Patriot",
                    "firstPlaceVotes": 0,
                    "points": 120
                  },
                  {
                    "rank": 22,
                    "school": "Villanova",
                    "conference": "CAA",
                    "firstPlaceVotes": 0,
                    "points": 107
                  },
                  {
                    "rank": 23,
                    "school": "Northern Iowa",
                    "conference": "MVFC",
                    "firstPlaceVotes": 0,
                    "points": 105
                  },
                  {
                    "rank": 24,
                    "school": "William & Mary",
                    "conference": "CAA",
                    "firstPlaceVotes": 0,
                    "points": 83
                  },
                  {
                    "rank": 25,
                    "school": "Central Arkansas",
                    "conference": "UAC",
                    "firstPlaceVotes": 0,
                    "points": 73
                  }
                ]
              },
              {
                "poll": "AFCA Division II Coaches Poll",
                "ranks": [
                  {
                    "rank": 1,
                    "school": "Colorado Mines",
                    "conference": "Rocky Mountain",
                    "firstPlaceVotes": 26,
                    "points": 720
                  },
                  {
                    "rank": 2,
                    "school": "Pittsburg State",
                    "conference": "Mid America",
                    "firstPlaceVotes": 1,
                    "points": 694
                  },
                  {
                    "rank": 3,
                    "school": "Grand Valley State",
                    "conference": "GLIAC",
                    "firstPlaceVotes": 1,
                    "points": 662
                  },
                  {
                    "rank": 4,
                    "school": "Harding",
                    "conference": "Great American",
                    "firstPlaceVotes": 0,
                    "points": 637
                  },
                  {
                    "rank": 5,
                    "school": "Slippery Rock",
                    "conference": "Pennsylvania State Athletic",
                    "firstPlaceVotes": 1,
                    "points": 582
                  },
                  {
                    "rank": 6,
                    "school": "Benedict College",
                    "conference": "SIAC",
                    "firstPlaceVotes": 0,
                    "points": 573
                  },
                  {
                    "rank": 7,
                    "school": "Ferris State",
                    "conference": "GLIAC",
                    "firstPlaceVotes": 0,
                    "points": 534
                  },
                  {
                    "rank": 8,
                    "school": "Indianapolis",
                    "conference": "Great Lakes",
                    "firstPlaceVotes": 0,
                    "points": 503
                  },
                  {
                    "rank": 9,
                    "school": "Davenport",
                    "conference": "GLIAC",
                    "firstPlaceVotes": 0,
                    "points": 484
                  },
                  {
                    "rank": 10,
                    "school": "Minnesota State",
                    "conference": "Northern Sun",
                    "firstPlaceVotes": 0,
                    "points": 437
                  },
                  {
                    "rank": 11,
                    "school": "Central Missouri State",
                    "conference": "Mid America",
                    "firstPlaceVotes": 0,
                    "points": 406
                  },
                  {
                    "rank": 12,
                    "school": "Ouachita Baptist",
                    "conference": "Great American",
                    "firstPlaceVotes": 0,
                    "points": 399
                  },
                  {
                    "rank": 13,
                    "school": "Bemidji State",
                    "conference": "Northern Sun",
                    "firstPlaceVotes": 0,
                    "points": 353
                  },
                  {
                    "rank": 14,
                    "school": "Delta State",
                    "conference": "Gulf South",
                    "firstPlaceVotes": 0,
                    "points": 322
                  },
                  {
                    "rank": 15,
                    "school": "Western State",
                    "conference": "Rocky Mountain",
                    "firstPlaceVotes": 0,
                    "points": 321
                  },
                  {
                    "rank": 16,
                    "school": "Lenoir-Rhyne",
                    "conference": "South Atlantic",
                    "firstPlaceVotes": 0,
                    "points": 291
                  },
                  {
                    "rank": 17,
                    "school": "Tiffin",
                    "conference": "Great Midwest Athletic",
                    "firstPlaceVotes": 0,
                    "points": 282
                  },
                  {
                    "rank": 18,
                    "school": "University of Texas of the Permian Basin",
                    "conference": "Lone Star",
                    "firstPlaceVotes": 0,
                    "points": 228
                  },
                  {
                    "rank": 19,
                    "school": "Virginia Union",
                    "conference": "CIAA",
                    "firstPlaceVotes": 0,
                    "points": 210
                  },
                  {
                    "rank": 20,
                    "school": "Valdosta State",
                    "conference": "Gulf South",
                    "firstPlaceVotes": 0,
                    "points": 207
                  },
                  {
                    "rank": 21,
                    "school": "Augustana (SD)",
                    "conference": "Northern Sun",
                    "firstPlaceVotes": 0,
                    "points": 183
                  },
                  {
                    "rank": 22,
                    "school": "Virginia State",
                    "conference": "CIAA",
                    "firstPlaceVotes": 0,
                    "points": 86
                  },
                  {
                    "rank": 23,
                    "school": "Missouri Western",
                    "conference": "Mid America",
                    "firstPlaceVotes": 0,
                    "points": 69
                  },
                  {
                    "rank": 24,
                    "school": "Central Washington",
                    "conference": "Lone Star",
                    "firstPlaceVotes": 0,
                    "points": 54
                  },
                  {
                    "rank": 25,
                    "school": "Mars Hill",
                    "conference": "South Atlantic",
                    "firstPlaceVotes": 0,
                    "points": 43
                  }
                ]
              },
              {
                "poll": "AFCA Division III Coaches Poll",
                "ranks": [
                  {
                    "rank": 1,
                    "school": "North Central",
                    "conference": "CCIW",
                    "firstPlaceVotes": 48,
                    "points": 1224
                  },
                  {
                    "rank": 2,
                    "school": "Mount Union",
                    "conference": "Ohio",
                    "firstPlaceVotes": 1,
                    "points": 1173
                  },
                  {
                    "rank": 3,
                    "school": "Wartburg",
                    "conference": "American Rivers",
                    "firstPlaceVotes": 0,
                    "points": 1120
                  },
                  {
                    "rank": 4,
                    "school": "Linfield",
                    "conference": "Northwest",
                    "firstPlaceVotes": 0,
                    "points": 1024
                  },
                  {
                    "rank": 5,
                    "school": "Trinity (TX)",
                    "conference": "Southern Athletic",
                    "firstPlaceVotes": 0,
                    "points": 986
                  },
                  {
                    "rank": 6,
                    "school": "UW-Whitewater",
                    "conference": "Wisconsin",
                    "firstPlaceVotes": 0,
                    "points": 958
                  },
                  {
                    "rank": 7,
                    "school": "Wisconsin-La Crosse",
                    "conference": "Wisconsin",
                    "firstPlaceVotes": 0,
                    "points": 909
                  },
                  {
                    "rank": 8,
                    "school": "Johns Hopkins",
                    "conference": "Centennial",
                    "firstPlaceVotes": 0,
                    "points": 903
                  },
                  {
                    "rank": 9,
                    "school": "Randolph-Macon",
                    "conference": "Old Dominion",
                    "firstPlaceVotes": 0,
                    "points": 817
                  },
                  {
                    "rank": 10,
                    "school": "UW-River Falls",
                    "conference": "Wisconsin",
                    "firstPlaceVotes": 0,
                    "points": 779
                  },
                  {
                    "rank": 11,
                    "school": "Aurora",
                    "conference": "NACC",
                    "firstPlaceVotes": 0,
                    "points": 724
                  },
                  {
                    "rank": 12,
                    "school": "Susquehanna",
                    "conference": "Landmark Conference",
                    "firstPlaceVotes": 0,
                    "points": 688
                  },
                  {
                    "rank": 13,
                    "school": "Wheaton College (Ill)",
                    "conference": "CCIW",
                    "firstPlaceVotes": 0,
                    "points": 619
                  },
                  {
                    "rank": 14,
                    "school": "Alma College",
                    "conference": "Michigan",
                    "firstPlaceVotes": 0,
                    "points": 577
                  },
                  {
                    "rank": 15,
                    "school": "John Carroll",
                    "conference": "Ohio",
                    "firstPlaceVotes": 0,
                    "points": 549
                  },
                  {
                    "rank": 16,
                    "school": "Ithaca",
                    "conference": "Liberty League",
                    "firstPlaceVotes": 0,
                    "points": 457
                  },
                  {
                    "rank": 17,
                    "school": "SUNY Cortland",
                    "conference": "Empire 8",
                    "firstPlaceVotes": 0,
                    "points": 413
                  },
                  {
                    "rank": 18,
                    "school": "Endicott College",
                    "conference": "Commonwealth Coast",
                    "firstPlaceVotes": 0,
                    "points": 342
                  },
                  {
                    "rank": 19,
                    "school": "Hardin-Simmons",
                    "conference": "American Southwest",
                    "firstPlaceVotes": 0,
                    "points": 288
                  },
                  {
                    "rank": 20,
                    "school": "Grove City College",
                    "conference": "Presidents'",
                    "firstPlaceVotes": 0,
                    "points": 275
                  },
                  {
                    "rank": 21,
                    "school": "St. Johns (MN)",
                    "conference": "Minnesota",
                    "firstPlaceVotes": 0,
                    "points": 262
                  },
                  {
                    "rank": 22,
                    "school": "Muhlenberg",
                    "conference": "Centennial",
                    "firstPlaceVotes": 0,
                    "points": 230
                  },
                  {
                    "rank": 23,
                    "school": "DePauw",
                    "conference": "North Coast",
                    "firstPlaceVotes": 0,
                    "points": 183
                  },
                  {
                    "rank": 24,
                    "school": "Delaware Valley",
                    "conference": "Mid Atlantic",
                    "firstPlaceVotes": 0,
                    "points": 114
                  },
                  {
                    "rank": 25,
                    "school": "Berry College",
                    "conference": "Southern Athletic",
                    "firstPlaceVotes": 0,
                    "points": 99
                  }
                ]
              },
              {
                "poll": "Playoff Committee Rankings",
                "ranks": [
                  {
                    "rank": 1,
                    "school": "Ohio State",
                    "conference": "Big Ten",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 2,
                    "school": "Georgia",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 3,
                    "school": "Michigan",
                    "conference": "Big Ten",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 4,
                    "school": "Florida State",
                    "conference": "ACC",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 5,
                    "school": "Washington",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 6,
                    "school": "Oregon",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 7,
                    "school": "Texas",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 8,
                    "school": "Alabama",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 9,
                    "school": "Oklahoma",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 10,
                    "school": "Ole Miss",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 11,
                    "school": "Penn State",
                    "conference": "Big Ten",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 12,
                    "school": "Missouri",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 13,
                    "school": "Louisville",
                    "conference": "ACC",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 14,
                    "school": "LSU",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 15,
                    "school": "Notre Dame",
                    "conference": "FBS Independents",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 16,
                    "school": "Oregon State",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 17,
                    "school": "Tennessee",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 18,
                    "school": "Utah",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 19,
                    "school": "UCLA",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 20,
                    "school": "USC",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 21,
                    "school": "Kansas",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 22,
                    "school": "Oklahoma State",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 23,
                    "school": "Kansas State",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 24,
                    "school": "Tulane",
                    "conference": "American Athletic",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 25,
                    "school": "Air Force",
                    "conference": "Mountain West",
                    "firstPlaceVotes": 0,
                    "points": 0
                  }
                ]
              }
            ]
          }];

        global.fetch = jest.fn(() => Promise.resolve({
            json: () => Promise.resolve(rankings)
        }));

        var resultingScore = await scoringModule.calculateScoreV1(team, game, week);
        expect(resultingScore).toEqual(0);
    });
    
    it('Non-Conference Unranked Game Win', async () => {
        const team = "Arkansas";
        const game = {
            "_id": {
              "$oid": "65dfd87c1546400b2aeb7975"
            },
            "id": 401520363,
            "season": 2023,
            "week": 10,
            "seasonType": "regular",
            "startDate": "2023-11-04T16:00:00.000Z",
            "startTimeTbd": false,
            "completed": true,
            "neutralSite": false,
            "conferenceGame": false,
            "attendance": 89782,
            "venueId": 3634,
            "venue": "Bounce House",
            "homeId": 57,
            "homeTeam": "University of Central Florida",
            "homeConference": "Big 12",
            "homeDivision": "fbs",
            "homePoints": 36,
            "homeLineScores": [
              14,
              3,
              6,
              10,
              3
            ],
            "homePostWinProb": "0.08075347362469056",
            "homePregameElo": 1592,
            "homePostgameElo": 1588,
            "awayId": 8,
            "awayTeam": "Arkansas",
            "awayConference": "SEC",
            "awayDivision": "fbs",
            "awayPoints": 39,
            "awayLineScores": [
              14,
              3,
              3,
              13,
              6
            ],
            "awayPostWinProb": "0.9192465263753095",
            "awayPregameElo": 1596,
            "awayPostgameElo": 1600,
            "excitementIndex": "9.7718678848",
            "highlights": null,
            "notes": "test Arkansas game notes"
          };
        const week = 10;
        const rankings = [{
            "_id": {
              "$oid": "65de66651546400b2aeb6e64"
            },
            "season": 2023,
            "seasonType": "regular",
            "week": 10,
            "polls": [
              {
                "poll": "Coaches Poll",
                "ranks": [
                  {
                    "rank": 1,
                    "school": "Georgia",
                    "conference": "SEC",
                    "firstPlaceVotes": 58,
                    "points": 1590
                  },
                  {
                    "rank": 2,
                    "school": "Michigan",
                    "conference": "Big Ten",
                    "firstPlaceVotes": 3,
                    "points": 1520
                  },
                  {
                    "rank": 3,
                    "school": "Ohio State",
                    "conference": "Big Ten",
                    "firstPlaceVotes": 3,
                    "points": 1454
                  },
                  {
                    "rank": 4,
                    "school": "Florida State",
                    "conference": "ACC",
                    "firstPlaceVotes": 0,
                    "points": 1439
                  },
                  {
                    "rank": 5,
                    "school": "Washington",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 1344
                  },
                  {
                    "rank": 6,
                    "school": "Texas",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 1212
                  },
                  {
                    "rank": 7,
                    "school": "Oregon",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 1211
                  },
                  {
                    "rank": 8,
                    "school": "Alabama",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 1187
                  },
                  {
                    "rank": 9,
                    "school": "Penn State",
                    "conference": "Big Ten",
                    "firstPlaceVotes": 0,
                    "points": 1072
                  },
                  {
                    "rank": 10,
                    "school": "Ole Miss",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 1021
                  },
                  {
                    "rank": 11,
                    "school": "Oklahoma",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 948
                  },
                  {
                    "rank": 12,
                    "school": "Notre Dame",
                    "conference": "FBS Independents",
                    "firstPlaceVotes": 0,
                    "points": 847
                  },
                  {
                    "rank": 13,
                    "school": "LSU",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 809
                  },
                  {
                    "rank": 14,
                    "school": "Missouri",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 741
                  },
                  {
                    "rank": 15,
                    "school": "Louisville",
                    "conference": "ACC",
                    "firstPlaceVotes": 0,
                    "points": 701
                  },
                  {
                    "rank": 16,
                    "school": "Tennessee",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 553
                  },
                  {
                    "rank": 17,
                    "school": "Air Force",
                    "conference": "Mountain West",
                    "firstPlaceVotes": 0,
                    "points": 523
                  },
                  {
                    "rank": 18,
                    "school": "Utah",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 509
                  },
                  {
                    "rank": 19,
                    "school": "Oregon State",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 465
                  },
                  {
                    "rank": 20,
                    "school": "UCLA",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 309
                  },
                  {
                    "rank": 21,
                    "school": "Tulane",
                    "conference": "American Athletic",
                    "firstPlaceVotes": 0,
                    "points": 304
                  },
                  {
                    "rank": 22,
                    "school": "USC",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 239
                  },
                  {
                    "rank": 23,
                    "school": "Kansas",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 182
                  },
                  {
                    "rank": 24,
                    "school": "James Madison",
                    "conference": "Sun Belt",
                    "firstPlaceVotes": 0,
                    "points": 169
                  },
                  {
                    "rank": 25,
                    "school": "North Carolina",
                    "conference": "ACC",
                    "firstPlaceVotes": 0,
                    "points": 120
                  }
                ]
              },
              {
                "poll": "AP Top 25",
                "ranks": [
                  {
                    "rank": 1,
                    "school": "Georgia",
                    "conference": "SEC",
                    "firstPlaceVotes": 48,
                    "points": 1553
                  },
                  {
                    "rank": 2,
                    "school": "Michigan",
                    "conference": "Big Ten",
                    "firstPlaceVotes": 9,
                    "points": 1494
                  },
                  {
                    "rank": 3,
                    "school": "Ohio State",
                    "conference": "Big Ten",
                    "firstPlaceVotes": 3,
                    "points": 1446
                  },
                  {
                    "rank": 4,
                    "school": "Florida State",
                    "conference": "ACC",
                    "firstPlaceVotes": 3,
                    "points": 1421
                  },
                  {
                    "rank": 5,
                    "school": "Washington",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 1327
                  },
                  {
                    "rank": 6,
                    "school": "Oregon",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 1235
                  },
                  {
                    "rank": 7,
                    "school": "Texas",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 1189
                  },
                  {
                    "rank": 8,
                    "school": "Alabama",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 1114
                  },
                  {
                    "rank": 9,
                    "school": "Penn State",
                    "conference": "Big Ten",
                    "firstPlaceVotes": 0,
                    "points": 1044
                  },
                  {
                    "rank": 10,
                    "school": "Oklahoma",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 1010
                  },
                  {
                    "rank": 11,
                    "school": "Ole Miss",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 990
                  },
                  {
                    "rank": 12,
                    "school": "Notre Dame",
                    "conference": "FBS Independents",
                    "firstPlaceVotes": 0,
                    "points": 847
                  },
                  {
                    "rank": 13,
                    "school": "LSU",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 816
                  },
                  {
                    "rank": 14,
                    "school": "Missouri",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 714
                  },
                  {
                    "rank": 15,
                    "school": "Louisville",
                    "conference": "ACC",
                    "firstPlaceVotes": 0,
                    "points": 666
                  },
                  {
                    "rank": 16,
                    "school": "Oregon State",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 557
                  },
                  {
                    "rank": 17,
                    "school": "Air Force",
                    "conference": "Mountain West",
                    "firstPlaceVotes": 0,
                    "points": 526
                  },
                  {
                    "rank": 18,
                    "school": "Utah",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 510
                  },
                  {
                    "rank": 19,
                    "school": "Tennessee",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 473
                  },
                  {
                    "rank": 20,
                    "school": "UCLA",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 331
                  },
                  {
                    "rank": 21,
                    "school": "Tulane",
                    "conference": "American Athletic",
                    "firstPlaceVotes": 0,
                    "points": 303
                  },
                  {
                    "rank": 22,
                    "school": "Kansas",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 250
                  },
                  {
                    "rank": 23,
                    "school": "James Madison",
                    "conference": "Sun Belt",
                    "firstPlaceVotes": 0,
                    "points": 192
                  },
                  {
                    "rank": 24,
                    "school": "USC",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 139
                  },
                  {
                    "rank": 25,
                    "school": "Kansas State",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 112
                  }
                ]
              },
              {
                "poll": "FCS Coaches Poll",
                "ranks": [
                  {
                    "rank": 1,
                    "school": "South Dakota State",
                    "conference": "MVFC",
                    "firstPlaceVotes": 25,
                    "points": 625
                  },
                  {
                    "rank": 2,
                    "school": "Furman",
                    "conference": "Southern",
                    "firstPlaceVotes": 0,
                    "points": 577
                  },
                  {
                    "rank": 3,
                    "school": "Montana",
                    "conference": "Big Sky",
                    "firstPlaceVotes": 0,
                    "points": 544
                  },
                  {
                    "rank": 4,
                    "school": "Incarnate Word",
                    "conference": "Southland",
                    "firstPlaceVotes": 0,
                    "points": 533
                  },
                  {
                    "rank": 5,
                    "school": "Idaho",
                    "conference": "Big Sky",
                    "firstPlaceVotes": 0,
                    "points": 515
                  },
                  {
                    "rank": 6,
                    "school": "Delaware",
                    "conference": "CAA",
                    "firstPlaceVotes": 0,
                    "points": 507
                  },
                  {
                    "rank": 7,
                    "school": "Sacramento State",
                    "conference": "Big Sky",
                    "firstPlaceVotes": 0,
                    "points": 471
                  },
                  {
                    "rank": 8,
                    "school": "Montana State",
                    "conference": "Big Sky",
                    "firstPlaceVotes": 0,
                    "points": 458
                  },
                  {
                    "rank": 9,
                    "school": "North Carolina Central",
                    "conference": "MEAC",
                    "firstPlaceVotes": 0,
                    "points": 407
                  },
                  {
                    "rank": 10,
                    "school": "North Dakota State",
                    "conference": "MVFC",
                    "firstPlaceVotes": 0,
                    "points": 398
                  },
                  {
                    "rank": 11,
                    "school": "Southern Illinois",
                    "conference": "MVFC",
                    "firstPlaceVotes": 0,
                    "points": 380
                  },
                  {
                    "rank": 12,
                    "school": "South Dakota",
                    "conference": "MVFC",
                    "firstPlaceVotes": 0,
                    "points": 330
                  },
                  {
                    "rank": 13,
                    "school": "Florida A&M",
                    "conference": "SWAC",
                    "firstPlaceVotes": 0,
                    "points": 296
                  },
                  {
                    "rank": 13,
                    "school": "Chattanooga",
                    "conference": "Southern",
                    "firstPlaceVotes": 0,
                    "points": 296
                  },
                  {
                    "rank": 15,
                    "school": "North Dakota",
                    "conference": "MVFC",
                    "firstPlaceVotes": 0,
                    "points": 260
                  },
                  {
                    "rank": 16,
                    "school": "Lafayette",
                    "conference": "Patriot",
                    "firstPlaceVotes": 0,
                    "points": 241
                  },
                  {
                    "rank": 17,
                    "school": "Austin Peay",
                    "conference": "UAC",
                    "firstPlaceVotes": 0,
                    "points": 218
                  },
                  {
                    "rank": 18,
                    "school": "UT Martin",
                    "conference": "Big South-OVC",
                    "firstPlaceVotes": 0,
                    "points": 179
                  },
                  {
                    "rank": 19,
                    "school": "Harvard",
                    "conference": "Ivy",
                    "firstPlaceVotes": 0,
                    "points": 137
                  },
                  {
                    "rank": 20,
                    "school": "Western Carolina",
                    "conference": "Southern",
                    "firstPlaceVotes": 0,
                    "points": 124
                  },
                  {
                    "rank": 21,
                    "school": "Holy Cross",
                    "conference": "Patriot",
                    "firstPlaceVotes": 0,
                    "points": 120
                  },
                  {
                    "rank": 22,
                    "school": "Villanova",
                    "conference": "CAA",
                    "firstPlaceVotes": 0,
                    "points": 107
                  },
                  {
                    "rank": 23,
                    "school": "Northern Iowa",
                    "conference": "MVFC",
                    "firstPlaceVotes": 0,
                    "points": 105
                  },
                  {
                    "rank": 24,
                    "school": "William & Mary",
                    "conference": "CAA",
                    "firstPlaceVotes": 0,
                    "points": 83
                  },
                  {
                    "rank": 25,
                    "school": "Central Arkansas",
                    "conference": "UAC",
                    "firstPlaceVotes": 0,
                    "points": 73
                  }
                ]
              },
              {
                "poll": "AFCA Division II Coaches Poll",
                "ranks": [
                  {
                    "rank": 1,
                    "school": "Colorado Mines",
                    "conference": "Rocky Mountain",
                    "firstPlaceVotes": 26,
                    "points": 720
                  },
                  {
                    "rank": 2,
                    "school": "Pittsburg State",
                    "conference": "Mid America",
                    "firstPlaceVotes": 1,
                    "points": 694
                  },
                  {
                    "rank": 3,
                    "school": "Grand Valley State",
                    "conference": "GLIAC",
                    "firstPlaceVotes": 1,
                    "points": 662
                  },
                  {
                    "rank": 4,
                    "school": "Harding",
                    "conference": "Great American",
                    "firstPlaceVotes": 0,
                    "points": 637
                  },
                  {
                    "rank": 5,
                    "school": "Slippery Rock",
                    "conference": "Pennsylvania State Athletic",
                    "firstPlaceVotes": 1,
                    "points": 582
                  },
                  {
                    "rank": 6,
                    "school": "Benedict College",
                    "conference": "SIAC",
                    "firstPlaceVotes": 0,
                    "points": 573
                  },
                  {
                    "rank": 7,
                    "school": "Ferris State",
                    "conference": "GLIAC",
                    "firstPlaceVotes": 0,
                    "points": 534
                  },
                  {
                    "rank": 8,
                    "school": "Indianapolis",
                    "conference": "Great Lakes",
                    "firstPlaceVotes": 0,
                    "points": 503
                  },
                  {
                    "rank": 9,
                    "school": "Davenport",
                    "conference": "GLIAC",
                    "firstPlaceVotes": 0,
                    "points": 484
                  },
                  {
                    "rank": 10,
                    "school": "Minnesota State",
                    "conference": "Northern Sun",
                    "firstPlaceVotes": 0,
                    "points": 437
                  },
                  {
                    "rank": 11,
                    "school": "Central Missouri State",
                    "conference": "Mid America",
                    "firstPlaceVotes": 0,
                    "points": 406
                  },
                  {
                    "rank": 12,
                    "school": "Ouachita Baptist",
                    "conference": "Great American",
                    "firstPlaceVotes": 0,
                    "points": 399
                  },
                  {
                    "rank": 13,
                    "school": "Bemidji State",
                    "conference": "Northern Sun",
                    "firstPlaceVotes": 0,
                    "points": 353
                  },
                  {
                    "rank": 14,
                    "school": "Delta State",
                    "conference": "Gulf South",
                    "firstPlaceVotes": 0,
                    "points": 322
                  },
                  {
                    "rank": 15,
                    "school": "Western State",
                    "conference": "Rocky Mountain",
                    "firstPlaceVotes": 0,
                    "points": 321
                  },
                  {
                    "rank": 16,
                    "school": "Lenoir-Rhyne",
                    "conference": "South Atlantic",
                    "firstPlaceVotes": 0,
                    "points": 291
                  },
                  {
                    "rank": 17,
                    "school": "Tiffin",
                    "conference": "Great Midwest Athletic",
                    "firstPlaceVotes": 0,
                    "points": 282
                  },
                  {
                    "rank": 18,
                    "school": "University of Texas of the Permian Basin",
                    "conference": "Lone Star",
                    "firstPlaceVotes": 0,
                    "points": 228
                  },
                  {
                    "rank": 19,
                    "school": "Virginia Union",
                    "conference": "CIAA",
                    "firstPlaceVotes": 0,
                    "points": 210
                  },
                  {
                    "rank": 20,
                    "school": "Valdosta State",
                    "conference": "Gulf South",
                    "firstPlaceVotes": 0,
                    "points": 207
                  },
                  {
                    "rank": 21,
                    "school": "Augustana (SD)",
                    "conference": "Northern Sun",
                    "firstPlaceVotes": 0,
                    "points": 183
                  },
                  {
                    "rank": 22,
                    "school": "Virginia State",
                    "conference": "CIAA",
                    "firstPlaceVotes": 0,
                    "points": 86
                  },
                  {
                    "rank": 23,
                    "school": "Missouri Western",
                    "conference": "Mid America",
                    "firstPlaceVotes": 0,
                    "points": 69
                  },
                  {
                    "rank": 24,
                    "school": "Central Washington",
                    "conference": "Lone Star",
                    "firstPlaceVotes": 0,
                    "points": 54
                  },
                  {
                    "rank": 25,
                    "school": "Mars Hill",
                    "conference": "South Atlantic",
                    "firstPlaceVotes": 0,
                    "points": 43
                  }
                ]
              },
              {
                "poll": "AFCA Division III Coaches Poll",
                "ranks": [
                  {
                    "rank": 1,
                    "school": "North Central",
                    "conference": "CCIW",
                    "firstPlaceVotes": 48,
                    "points": 1224
                  },
                  {
                    "rank": 2,
                    "school": "Mount Union",
                    "conference": "Ohio",
                    "firstPlaceVotes": 1,
                    "points": 1173
                  },
                  {
                    "rank": 3,
                    "school": "Wartburg",
                    "conference": "American Rivers",
                    "firstPlaceVotes": 0,
                    "points": 1120
                  },
                  {
                    "rank": 4,
                    "school": "Linfield",
                    "conference": "Northwest",
                    "firstPlaceVotes": 0,
                    "points": 1024
                  },
                  {
                    "rank": 5,
                    "school": "Trinity (TX)",
                    "conference": "Southern Athletic",
                    "firstPlaceVotes": 0,
                    "points": 986
                  },
                  {
                    "rank": 6,
                    "school": "UW-Whitewater",
                    "conference": "Wisconsin",
                    "firstPlaceVotes": 0,
                    "points": 958
                  },
                  {
                    "rank": 7,
                    "school": "Wisconsin-La Crosse",
                    "conference": "Wisconsin",
                    "firstPlaceVotes": 0,
                    "points": 909
                  },
                  {
                    "rank": 8,
                    "school": "Johns Hopkins",
                    "conference": "Centennial",
                    "firstPlaceVotes": 0,
                    "points": 903
                  },
                  {
                    "rank": 9,
                    "school": "Randolph-Macon",
                    "conference": "Old Dominion",
                    "firstPlaceVotes": 0,
                    "points": 817
                  },
                  {
                    "rank": 10,
                    "school": "UW-River Falls",
                    "conference": "Wisconsin",
                    "firstPlaceVotes": 0,
                    "points": 779
                  },
                  {
                    "rank": 11,
                    "school": "Aurora",
                    "conference": "NACC",
                    "firstPlaceVotes": 0,
                    "points": 724
                  },
                  {
                    "rank": 12,
                    "school": "Susquehanna",
                    "conference": "Landmark Conference",
                    "firstPlaceVotes": 0,
                    "points": 688
                  },
                  {
                    "rank": 13,
                    "school": "Wheaton College (Ill)",
                    "conference": "CCIW",
                    "firstPlaceVotes": 0,
                    "points": 619
                  },
                  {
                    "rank": 14,
                    "school": "Alma College",
                    "conference": "Michigan",
                    "firstPlaceVotes": 0,
                    "points": 577
                  },
                  {
                    "rank": 15,
                    "school": "John Carroll",
                    "conference": "Ohio",
                    "firstPlaceVotes": 0,
                    "points": 549
                  },
                  {
                    "rank": 16,
                    "school": "Ithaca",
                    "conference": "Liberty League",
                    "firstPlaceVotes": 0,
                    "points": 457
                  },
                  {
                    "rank": 17,
                    "school": "SUNY Cortland",
                    "conference": "Empire 8",
                    "firstPlaceVotes": 0,
                    "points": 413
                  },
                  {
                    "rank": 18,
                    "school": "Endicott College",
                    "conference": "Commonwealth Coast",
                    "firstPlaceVotes": 0,
                    "points": 342
                  },
                  {
                    "rank": 19,
                    "school": "Hardin-Simmons",
                    "conference": "American Southwest",
                    "firstPlaceVotes": 0,
                    "points": 288
                  },
                  {
                    "rank": 20,
                    "school": "Grove City College",
                    "conference": "Presidents'",
                    "firstPlaceVotes": 0,
                    "points": 275
                  },
                  {
                    "rank": 21,
                    "school": "St. Johns (MN)",
                    "conference": "Minnesota",
                    "firstPlaceVotes": 0,
                    "points": 262
                  },
                  {
                    "rank": 22,
                    "school": "Muhlenberg",
                    "conference": "Centennial",
                    "firstPlaceVotes": 0,
                    "points": 230
                  },
                  {
                    "rank": 23,
                    "school": "DePauw",
                    "conference": "North Coast",
                    "firstPlaceVotes": 0,
                    "points": 183
                  },
                  {
                    "rank": 24,
                    "school": "Delaware Valley",
                    "conference": "Mid Atlantic",
                    "firstPlaceVotes": 0,
                    "points": 114
                  },
                  {
                    "rank": 25,
                    "school": "Berry College",
                    "conference": "Southern Athletic",
                    "firstPlaceVotes": 0,
                    "points": 99
                  }
                ]
              },
              {
                "poll": "Playoff Committee Rankings",
                "ranks": [
                  {
                    "rank": 1,
                    "school": "Ohio State",
                    "conference": "Big Ten",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 2,
                    "school": "Georgia",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 3,
                    "school": "Michigan",
                    "conference": "Big Ten",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 4,
                    "school": "Florida State",
                    "conference": "ACC",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 5,
                    "school": "Washington",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 6,
                    "school": "Oregon",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 7,
                    "school": "Texas",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 8,
                    "school": "Alabama",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 9,
                    "school": "Oklahoma",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 10,
                    "school": "Ole Miss",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 11,
                    "school": "Penn State",
                    "conference": "Big Ten",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 12,
                    "school": "Missouri",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 13,
                    "school": "Louisville",
                    "conference": "ACC",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 14,
                    "school": "LSU",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 15,
                    "school": "Notre Dame",
                    "conference": "FBS Independents",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 16,
                    "school": "Oregon State",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 17,
                    "school": "Tennessee",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 18,
                    "school": "Utah",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 19,
                    "school": "UCLA",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 20,
                    "school": "USC",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 21,
                    "school": "Kansas",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 22,
                    "school": "Oklahoma State",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 23,
                    "school": "Kansas State",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 24,
                    "school": "Tulane",
                    "conference": "American Athletic",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 25,
                    "school": "Air Force",
                    "conference": "Mountain West",
                    "firstPlaceVotes": 0,
                    "points": 0
                  }
                ]
              }
            ]
          }];

        global.fetch = jest.fn(() => Promise.resolve({
            json: () => Promise.resolve(rankings)
        }));

        var resultingScore = await scoringModule.calculateScoreV1(team, game, week);
        expect(resultingScore).toEqual(1);
    });

    it('Conference Game Win', async () => {
        const team = "Arkansas";
        const game = {
            "_id": {
              "$oid": "65dfd87c1546400b2aeb7975"
            },
            "id": 401520363,
            "season": 2023,
            "week": 10,
            "seasonType": "regular",
            "startDate": "2023-11-04T16:00:00.000Z",
            "startTimeTbd": false,
            "completed": true,
            "neutralSite": false,
            "conferenceGame": true,
            "attendance": 89782,
            "venueId": 3634,
            "venue": "Ben Hill Griffin Stadium",
            "homeId": 57,
            "homeTeam": "Florida",
            "homeConference": "SEC",
            "homeDivision": "fbs",
            "homePoints": 36,
            "homeLineScores": [
              14,
              3,
              6,
              10,
              3
            ],
            "homePostWinProb": "0.08075347362469056",
            "homePregameElo": 1592,
            "homePostgameElo": 1588,
            "awayId": 8,
            "awayTeam": "Arkansas",
            "awayConference": "SEC",
            "awayDivision": "fbs",
            "awayPoints": 39,
            "awayLineScores": [
              14,
              3,
              3,
              13,
              6
            ],
            "awayPostWinProb": "0.9192465263753095",
            "awayPregameElo": 1596,
            "awayPostgameElo": 1600,
            "excitementIndex": "9.7718678848",
            "highlights": null,
            "notes": "test Arkansas game notes"
          };
        const week = 10;
        const rankings = [{
            "_id": {
              "$oid": "65de66651546400b2aeb6e64"
            },
            "season": 2023,
            "seasonType": "regular",
            "week": 10,
            "polls": [
              {
                "poll": "Coaches Poll",
                "ranks": [
                  {
                    "rank": 1,
                    "school": "Georgia",
                    "conference": "SEC",
                    "firstPlaceVotes": 58,
                    "points": 1590
                  },
                  {
                    "rank": 2,
                    "school": "Michigan",
                    "conference": "Big Ten",
                    "firstPlaceVotes": 3,
                    "points": 1520
                  },
                  {
                    "rank": 3,
                    "school": "Ohio State",
                    "conference": "Big Ten",
                    "firstPlaceVotes": 3,
                    "points": 1454
                  },
                  {
                    "rank": 4,
                    "school": "Florida State",
                    "conference": "ACC",
                    "firstPlaceVotes": 0,
                    "points": 1439
                  },
                  {
                    "rank": 5,
                    "school": "Washington",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 1344
                  },
                  {
                    "rank": 6,
                    "school": "Texas",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 1212
                  },
                  {
                    "rank": 7,
                    "school": "Oregon",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 1211
                  },
                  {
                    "rank": 8,
                    "school": "Alabama",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 1187
                  },
                  {
                    "rank": 9,
                    "school": "Penn State",
                    "conference": "Big Ten",
                    "firstPlaceVotes": 0,
                    "points": 1072
                  },
                  {
                    "rank": 10,
                    "school": "Ole Miss",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 1021
                  },
                  {
                    "rank": 11,
                    "school": "Oklahoma",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 948
                  },
                  {
                    "rank": 12,
                    "school": "Notre Dame",
                    "conference": "FBS Independents",
                    "firstPlaceVotes": 0,
                    "points": 847
                  },
                  {
                    "rank": 13,
                    "school": "LSU",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 809
                  },
                  {
                    "rank": 14,
                    "school": "Missouri",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 741
                  },
                  {
                    "rank": 15,
                    "school": "Louisville",
                    "conference": "ACC",
                    "firstPlaceVotes": 0,
                    "points": 701
                  },
                  {
                    "rank": 16,
                    "school": "Tennessee",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 553
                  },
                  {
                    "rank": 17,
                    "school": "Air Force",
                    "conference": "Mountain West",
                    "firstPlaceVotes": 0,
                    "points": 523
                  },
                  {
                    "rank": 18,
                    "school": "Utah",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 509
                  },
                  {
                    "rank": 19,
                    "school": "Oregon State",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 465
                  },
                  {
                    "rank": 20,
                    "school": "UCLA",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 309
                  },
                  {
                    "rank": 21,
                    "school": "Tulane",
                    "conference": "American Athletic",
                    "firstPlaceVotes": 0,
                    "points": 304
                  },
                  {
                    "rank": 22,
                    "school": "USC",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 239
                  },
                  {
                    "rank": 23,
                    "school": "Kansas",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 182
                  },
                  {
                    "rank": 24,
                    "school": "James Madison",
                    "conference": "Sun Belt",
                    "firstPlaceVotes": 0,
                    "points": 169
                  },
                  {
                    "rank": 25,
                    "school": "North Carolina",
                    "conference": "ACC",
                    "firstPlaceVotes": 0,
                    "points": 120
                  }
                ]
              },
              {
                "poll": "AP Top 25",
                "ranks": [
                  {
                    "rank": 1,
                    "school": "Georgia",
                    "conference": "SEC",
                    "firstPlaceVotes": 48,
                    "points": 1553
                  },
                  {
                    "rank": 2,
                    "school": "Michigan",
                    "conference": "Big Ten",
                    "firstPlaceVotes": 9,
                    "points": 1494
                  },
                  {
                    "rank": 3,
                    "school": "Ohio State",
                    "conference": "Big Ten",
                    "firstPlaceVotes": 3,
                    "points": 1446
                  },
                  {
                    "rank": 4,
                    "school": "Florida State",
                    "conference": "ACC",
                    "firstPlaceVotes": 3,
                    "points": 1421
                  },
                  {
                    "rank": 5,
                    "school": "Washington",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 1327
                  },
                  {
                    "rank": 6,
                    "school": "Oregon",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 1235
                  },
                  {
                    "rank": 7,
                    "school": "Texas",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 1189
                  },
                  {
                    "rank": 8,
                    "school": "Alabama",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 1114
                  },
                  {
                    "rank": 9,
                    "school": "Penn State",
                    "conference": "Big Ten",
                    "firstPlaceVotes": 0,
                    "points": 1044
                  },
                  {
                    "rank": 10,
                    "school": "Oklahoma",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 1010
                  },
                  {
                    "rank": 11,
                    "school": "Ole Miss",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 990
                  },
                  {
                    "rank": 12,
                    "school": "Notre Dame",
                    "conference": "FBS Independents",
                    "firstPlaceVotes": 0,
                    "points": 847
                  },
                  {
                    "rank": 13,
                    "school": "LSU",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 816
                  },
                  {
                    "rank": 14,
                    "school": "Missouri",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 714
                  },
                  {
                    "rank": 15,
                    "school": "Louisville",
                    "conference": "ACC",
                    "firstPlaceVotes": 0,
                    "points": 666
                  },
                  {
                    "rank": 16,
                    "school": "Oregon State",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 557
                  },
                  {
                    "rank": 17,
                    "school": "Air Force",
                    "conference": "Mountain West",
                    "firstPlaceVotes": 0,
                    "points": 526
                  },
                  {
                    "rank": 18,
                    "school": "Utah",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 510
                  },
                  {
                    "rank": 19,
                    "school": "Tennessee",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 473
                  },
                  {
                    "rank": 20,
                    "school": "UCLA",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 331
                  },
                  {
                    "rank": 21,
                    "school": "Tulane",
                    "conference": "American Athletic",
                    "firstPlaceVotes": 0,
                    "points": 303
                  },
                  {
                    "rank": 22,
                    "school": "Kansas",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 250
                  },
                  {
                    "rank": 23,
                    "school": "James Madison",
                    "conference": "Sun Belt",
                    "firstPlaceVotes": 0,
                    "points": 192
                  },
                  {
                    "rank": 24,
                    "school": "USC",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 139
                  },
                  {
                    "rank": 25,
                    "school": "Kansas State",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 112
                  }
                ]
              },
              {
                "poll": "FCS Coaches Poll",
                "ranks": [
                  {
                    "rank": 1,
                    "school": "South Dakota State",
                    "conference": "MVFC",
                    "firstPlaceVotes": 25,
                    "points": 625
                  },
                  {
                    "rank": 2,
                    "school": "Furman",
                    "conference": "Southern",
                    "firstPlaceVotes": 0,
                    "points": 577
                  },
                  {
                    "rank": 3,
                    "school": "Montana",
                    "conference": "Big Sky",
                    "firstPlaceVotes": 0,
                    "points": 544
                  },
                  {
                    "rank": 4,
                    "school": "Incarnate Word",
                    "conference": "Southland",
                    "firstPlaceVotes": 0,
                    "points": 533
                  },
                  {
                    "rank": 5,
                    "school": "Idaho",
                    "conference": "Big Sky",
                    "firstPlaceVotes": 0,
                    "points": 515
                  },
                  {
                    "rank": 6,
                    "school": "Delaware",
                    "conference": "CAA",
                    "firstPlaceVotes": 0,
                    "points": 507
                  },
                  {
                    "rank": 7,
                    "school": "Sacramento State",
                    "conference": "Big Sky",
                    "firstPlaceVotes": 0,
                    "points": 471
                  },
                  {
                    "rank": 8,
                    "school": "Montana State",
                    "conference": "Big Sky",
                    "firstPlaceVotes": 0,
                    "points": 458
                  },
                  {
                    "rank": 9,
                    "school": "North Carolina Central",
                    "conference": "MEAC",
                    "firstPlaceVotes": 0,
                    "points": 407
                  },
                  {
                    "rank": 10,
                    "school": "North Dakota State",
                    "conference": "MVFC",
                    "firstPlaceVotes": 0,
                    "points": 398
                  },
                  {
                    "rank": 11,
                    "school": "Southern Illinois",
                    "conference": "MVFC",
                    "firstPlaceVotes": 0,
                    "points": 380
                  },
                  {
                    "rank": 12,
                    "school": "South Dakota",
                    "conference": "MVFC",
                    "firstPlaceVotes": 0,
                    "points": 330
                  },
                  {
                    "rank": 13,
                    "school": "Florida A&M",
                    "conference": "SWAC",
                    "firstPlaceVotes": 0,
                    "points": 296
                  },
                  {
                    "rank": 13,
                    "school": "Chattanooga",
                    "conference": "Southern",
                    "firstPlaceVotes": 0,
                    "points": 296
                  },
                  {
                    "rank": 15,
                    "school": "North Dakota",
                    "conference": "MVFC",
                    "firstPlaceVotes": 0,
                    "points": 260
                  },
                  {
                    "rank": 16,
                    "school": "Lafayette",
                    "conference": "Patriot",
                    "firstPlaceVotes": 0,
                    "points": 241
                  },
                  {
                    "rank": 17,
                    "school": "Austin Peay",
                    "conference": "UAC",
                    "firstPlaceVotes": 0,
                    "points": 218
                  },
                  {
                    "rank": 18,
                    "school": "UT Martin",
                    "conference": "Big South-OVC",
                    "firstPlaceVotes": 0,
                    "points": 179
                  },
                  {
                    "rank": 19,
                    "school": "Harvard",
                    "conference": "Ivy",
                    "firstPlaceVotes": 0,
                    "points": 137
                  },
                  {
                    "rank": 20,
                    "school": "Western Carolina",
                    "conference": "Southern",
                    "firstPlaceVotes": 0,
                    "points": 124
                  },
                  {
                    "rank": 21,
                    "school": "Holy Cross",
                    "conference": "Patriot",
                    "firstPlaceVotes": 0,
                    "points": 120
                  },
                  {
                    "rank": 22,
                    "school": "Villanova",
                    "conference": "CAA",
                    "firstPlaceVotes": 0,
                    "points": 107
                  },
                  {
                    "rank": 23,
                    "school": "Northern Iowa",
                    "conference": "MVFC",
                    "firstPlaceVotes": 0,
                    "points": 105
                  },
                  {
                    "rank": 24,
                    "school": "William & Mary",
                    "conference": "CAA",
                    "firstPlaceVotes": 0,
                    "points": 83
                  },
                  {
                    "rank": 25,
                    "school": "Central Arkansas",
                    "conference": "UAC",
                    "firstPlaceVotes": 0,
                    "points": 73
                  }
                ]
              },
              {
                "poll": "AFCA Division II Coaches Poll",
                "ranks": [
                  {
                    "rank": 1,
                    "school": "Colorado Mines",
                    "conference": "Rocky Mountain",
                    "firstPlaceVotes": 26,
                    "points": 720
                  },
                  {
                    "rank": 2,
                    "school": "Pittsburg State",
                    "conference": "Mid America",
                    "firstPlaceVotes": 1,
                    "points": 694
                  },
                  {
                    "rank": 3,
                    "school": "Grand Valley State",
                    "conference": "GLIAC",
                    "firstPlaceVotes": 1,
                    "points": 662
                  },
                  {
                    "rank": 4,
                    "school": "Harding",
                    "conference": "Great American",
                    "firstPlaceVotes": 0,
                    "points": 637
                  },
                  {
                    "rank": 5,
                    "school": "Slippery Rock",
                    "conference": "Pennsylvania State Athletic",
                    "firstPlaceVotes": 1,
                    "points": 582
                  },
                  {
                    "rank": 6,
                    "school": "Benedict College",
                    "conference": "SIAC",
                    "firstPlaceVotes": 0,
                    "points": 573
                  },
                  {
                    "rank": 7,
                    "school": "Ferris State",
                    "conference": "GLIAC",
                    "firstPlaceVotes": 0,
                    "points": 534
                  },
                  {
                    "rank": 8,
                    "school": "Indianapolis",
                    "conference": "Great Lakes",
                    "firstPlaceVotes": 0,
                    "points": 503
                  },
                  {
                    "rank": 9,
                    "school": "Davenport",
                    "conference": "GLIAC",
                    "firstPlaceVotes": 0,
                    "points": 484
                  },
                  {
                    "rank": 10,
                    "school": "Minnesota State",
                    "conference": "Northern Sun",
                    "firstPlaceVotes": 0,
                    "points": 437
                  },
                  {
                    "rank": 11,
                    "school": "Central Missouri State",
                    "conference": "Mid America",
                    "firstPlaceVotes": 0,
                    "points": 406
                  },
                  {
                    "rank": 12,
                    "school": "Ouachita Baptist",
                    "conference": "Great American",
                    "firstPlaceVotes": 0,
                    "points": 399
                  },
                  {
                    "rank": 13,
                    "school": "Bemidji State",
                    "conference": "Northern Sun",
                    "firstPlaceVotes": 0,
                    "points": 353
                  },
                  {
                    "rank": 14,
                    "school": "Delta State",
                    "conference": "Gulf South",
                    "firstPlaceVotes": 0,
                    "points": 322
                  },
                  {
                    "rank": 15,
                    "school": "Western State",
                    "conference": "Rocky Mountain",
                    "firstPlaceVotes": 0,
                    "points": 321
                  },
                  {
                    "rank": 16,
                    "school": "Lenoir-Rhyne",
                    "conference": "South Atlantic",
                    "firstPlaceVotes": 0,
                    "points": 291
                  },
                  {
                    "rank": 17,
                    "school": "Tiffin",
                    "conference": "Great Midwest Athletic",
                    "firstPlaceVotes": 0,
                    "points": 282
                  },
                  {
                    "rank": 18,
                    "school": "University of Texas of the Permian Basin",
                    "conference": "Lone Star",
                    "firstPlaceVotes": 0,
                    "points": 228
                  },
                  {
                    "rank": 19,
                    "school": "Virginia Union",
                    "conference": "CIAA",
                    "firstPlaceVotes": 0,
                    "points": 210
                  },
                  {
                    "rank": 20,
                    "school": "Valdosta State",
                    "conference": "Gulf South",
                    "firstPlaceVotes": 0,
                    "points": 207
                  },
                  {
                    "rank": 21,
                    "school": "Augustana (SD)",
                    "conference": "Northern Sun",
                    "firstPlaceVotes": 0,
                    "points": 183
                  },
                  {
                    "rank": 22,
                    "school": "Virginia State",
                    "conference": "CIAA",
                    "firstPlaceVotes": 0,
                    "points": 86
                  },
                  {
                    "rank": 23,
                    "school": "Missouri Western",
                    "conference": "Mid America",
                    "firstPlaceVotes": 0,
                    "points": 69
                  },
                  {
                    "rank": 24,
                    "school": "Central Washington",
                    "conference": "Lone Star",
                    "firstPlaceVotes": 0,
                    "points": 54
                  },
                  {
                    "rank": 25,
                    "school": "Mars Hill",
                    "conference": "South Atlantic",
                    "firstPlaceVotes": 0,
                    "points": 43
                  }
                ]
              },
              {
                "poll": "AFCA Division III Coaches Poll",
                "ranks": [
                  {
                    "rank": 1,
                    "school": "North Central",
                    "conference": "CCIW",
                    "firstPlaceVotes": 48,
                    "points": 1224
                  },
                  {
                    "rank": 2,
                    "school": "Mount Union",
                    "conference": "Ohio",
                    "firstPlaceVotes": 1,
                    "points": 1173
                  },
                  {
                    "rank": 3,
                    "school": "Wartburg",
                    "conference": "American Rivers",
                    "firstPlaceVotes": 0,
                    "points": 1120
                  },
                  {
                    "rank": 4,
                    "school": "Linfield",
                    "conference": "Northwest",
                    "firstPlaceVotes": 0,
                    "points": 1024
                  },
                  {
                    "rank": 5,
                    "school": "Trinity (TX)",
                    "conference": "Southern Athletic",
                    "firstPlaceVotes": 0,
                    "points": 986
                  },
                  {
                    "rank": 6,
                    "school": "UW-Whitewater",
                    "conference": "Wisconsin",
                    "firstPlaceVotes": 0,
                    "points": 958
                  },
                  {
                    "rank": 7,
                    "school": "Wisconsin-La Crosse",
                    "conference": "Wisconsin",
                    "firstPlaceVotes": 0,
                    "points": 909
                  },
                  {
                    "rank": 8,
                    "school": "Johns Hopkins",
                    "conference": "Centennial",
                    "firstPlaceVotes": 0,
                    "points": 903
                  },
                  {
                    "rank": 9,
                    "school": "Randolph-Macon",
                    "conference": "Old Dominion",
                    "firstPlaceVotes": 0,
                    "points": 817
                  },
                  {
                    "rank": 10,
                    "school": "UW-River Falls",
                    "conference": "Wisconsin",
                    "firstPlaceVotes": 0,
                    "points": 779
                  },
                  {
                    "rank": 11,
                    "school": "Aurora",
                    "conference": "NACC",
                    "firstPlaceVotes": 0,
                    "points": 724
                  },
                  {
                    "rank": 12,
                    "school": "Susquehanna",
                    "conference": "Landmark Conference",
                    "firstPlaceVotes": 0,
                    "points": 688
                  },
                  {
                    "rank": 13,
                    "school": "Wheaton College (Ill)",
                    "conference": "CCIW",
                    "firstPlaceVotes": 0,
                    "points": 619
                  },
                  {
                    "rank": 14,
                    "school": "Alma College",
                    "conference": "Michigan",
                    "firstPlaceVotes": 0,
                    "points": 577
                  },
                  {
                    "rank": 15,
                    "school": "John Carroll",
                    "conference": "Ohio",
                    "firstPlaceVotes": 0,
                    "points": 549
                  },
                  {
                    "rank": 16,
                    "school": "Ithaca",
                    "conference": "Liberty League",
                    "firstPlaceVotes": 0,
                    "points": 457
                  },
                  {
                    "rank": 17,
                    "school": "SUNY Cortland",
                    "conference": "Empire 8",
                    "firstPlaceVotes": 0,
                    "points": 413
                  },
                  {
                    "rank": 18,
                    "school": "Endicott College",
                    "conference": "Commonwealth Coast",
                    "firstPlaceVotes": 0,
                    "points": 342
                  },
                  {
                    "rank": 19,
                    "school": "Hardin-Simmons",
                    "conference": "American Southwest",
                    "firstPlaceVotes": 0,
                    "points": 288
                  },
                  {
                    "rank": 20,
                    "school": "Grove City College",
                    "conference": "Presidents'",
                    "firstPlaceVotes": 0,
                    "points": 275
                  },
                  {
                    "rank": 21,
                    "school": "St. Johns (MN)",
                    "conference": "Minnesota",
                    "firstPlaceVotes": 0,
                    "points": 262
                  },
                  {
                    "rank": 22,
                    "school": "Muhlenberg",
                    "conference": "Centennial",
                    "firstPlaceVotes": 0,
                    "points": 230
                  },
                  {
                    "rank": 23,
                    "school": "DePauw",
                    "conference": "North Coast",
                    "firstPlaceVotes": 0,
                    "points": 183
                  },
                  {
                    "rank": 24,
                    "school": "Delaware Valley",
                    "conference": "Mid Atlantic",
                    "firstPlaceVotes": 0,
                    "points": 114
                  },
                  {
                    "rank": 25,
                    "school": "Berry College",
                    "conference": "Southern Athletic",
                    "firstPlaceVotes": 0,
                    "points": 99
                  }
                ]
              },
              {
                "poll": "Playoff Committee Rankings",
                "ranks": [
                  {
                    "rank": 1,
                    "school": "Ohio State",
                    "conference": "Big Ten",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 2,
                    "school": "Georgia",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 3,
                    "school": "Michigan",
                    "conference": "Big Ten",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 4,
                    "school": "Florida State",
                    "conference": "ACC",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 5,
                    "school": "Washington",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 6,
                    "school": "Oregon",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 7,
                    "school": "Texas",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 8,
                    "school": "Alabama",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 9,
                    "school": "Oklahoma",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 10,
                    "school": "Ole Miss",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 11,
                    "school": "Penn State",
                    "conference": "Big Ten",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 12,
                    "school": "Missouri",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 13,
                    "school": "Louisville",
                    "conference": "ACC",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 14,
                    "school": "LSU",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 15,
                    "school": "Notre Dame",
                    "conference": "FBS Independents",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 16,
                    "school": "Oregon State",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 17,
                    "school": "Tennessee",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 18,
                    "school": "Utah",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 19,
                    "school": "UCLA",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 20,
                    "school": "USC",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 21,
                    "school": "Kansas",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 22,
                    "school": "Oklahoma State",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 23,
                    "school": "Kansas State",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 24,
                    "school": "Tulane",
                    "conference": "American Athletic",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 25,
                    "school": "Air Force",
                    "conference": "Mountain West",
                    "firstPlaceVotes": 0,
                    "points": 0
                  }
                ]
              }
            ]
          }];

        global.fetch = jest.fn(() => Promise.resolve({
            json: () => Promise.resolve(rankings)
        }));

        var resultingScore = await scoringModule.calculateScoreV1(team, game, week);
        expect(resultingScore).toEqual(2);
    });
    
    it('Top 25 Ranked Conference Game Win', async () => {
        const team = "Arkansas";
        const game = {
            "_id": {
              "$oid": "65dfd87c1546400b2aeb7975"
            },
            "id": 401520363,
            "season": 2023,
            "week": 10,
            "seasonType": "regular",
            "startDate": "2023-11-04T16:00:00.000Z",
            "startTimeTbd": false,
            "completed": true,
            "neutralSite": false,
            "conferenceGame": true,
            "attendance": 89782,
            "venueId": 3634,
            "venue": "Ben Hill Griffin Stadium",
            "homeId": 57,
            "homeTeam": "Florida",
            "homeConference": "SEC",
            "homeDivision": "fbs",
            "homePoints": 36,
            "homeLineScores": [
              14,
              3,
              6,
              10,
              3
            ],
            "homePostWinProb": "0.08075347362469056",
            "homePregameElo": 1592,
            "homePostgameElo": 1588,
            "awayId": 8,
            "awayTeam": "Arkansas",
            "awayConference": "SEC",
            "awayDivision": "fbs",
            "awayPoints": 39,
            "awayLineScores": [
              14,
              3,
              3,
              13,
              6
            ],
            "awayPostWinProb": "0.9192465263753095",
            "awayPregameElo": 1596,
            "awayPostgameElo": 1600,
            "excitementIndex": "9.7718678848",
            "highlights": null,
            "notes": "test Arkansas game notes"
          };
        const week = 10;
        const rankings = [{
            "_id": {
              "$oid": "65de66651546400b2aeb6e64"
            },
            "season": 2023,
            "seasonType": "regular",
            "week": 10,
            "polls": [
              {
                "poll": "Coaches Poll",
                "ranks": [
                  {
                    "rank": 1,
                    "school": "Georgia",
                    "conference": "SEC",
                    "firstPlaceVotes": 58,
                    "points": 1590
                  },
                  {
                    "rank": 2,
                    "school": "Michigan",
                    "conference": "Big Ten",
                    "firstPlaceVotes": 3,
                    "points": 1520
                  },
                  {
                    "rank": 3,
                    "school": "Ohio State",
                    "conference": "Big Ten",
                    "firstPlaceVotes": 3,
                    "points": 1454
                  },
                  {
                    "rank": 4,
                    "school": "Florida State",
                    "conference": "ACC",
                    "firstPlaceVotes": 0,
                    "points": 1439
                  },
                  {
                    "rank": 5,
                    "school": "Washington",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 1344
                  },
                  {
                    "rank": 6,
                    "school": "Texas",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 1212
                  },
                  {
                    "rank": 7,
                    "school": "Oregon",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 1211
                  },
                  {
                    "rank": 8,
                    "school": "Alabama",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 1187
                  },
                  {
                    "rank": 9,
                    "school": "Penn State",
                    "conference": "Big Ten",
                    "firstPlaceVotes": 0,
                    "points": 1072
                  },
                  {
                    "rank": 10,
                    "school": "Ole Miss",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 1021
                  },
                  {
                    "rank": 11,
                    "school": "Oklahoma",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 948
                  },
                  {
                    "rank": 12,
                    "school": "Notre Dame",
                    "conference": "FBS Independents",
                    "firstPlaceVotes": 0,
                    "points": 847
                  },
                  {
                    "rank": 13,
                    "school": "LSU",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 809
                  },
                  {
                    "rank": 14,
                    "school": "Missouri",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 741
                  },
                  {
                    "rank": 15,
                    "school": "Louisville",
                    "conference": "ACC",
                    "firstPlaceVotes": 0,
                    "points": 701
                  },
                  {
                    "rank": 16,
                    "school": "Tennessee",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 553
                  },
                  {
                    "rank": 17,
                    "school": "Air Force",
                    "conference": "Mountain West",
                    "firstPlaceVotes": 0,
                    "points": 523
                  },
                  {
                    "rank": 18,
                    "school": "Utah",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 509
                  },
                  {
                    "rank": 19,
                    "school": "Oregon State",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 465
                  },
                  {
                    "rank": 20,
                    "school": "UCLA",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 309
                  },
                  {
                    "rank": 21,
                    "school": "Tulane",
                    "conference": "American Athletic",
                    "firstPlaceVotes": 0,
                    "points": 304
                  },
                  {
                    "rank": 22,
                    "school": "USC",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 239
                  },
                  {
                    "rank": 23,
                    "school": "Kansas",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 182
                  },
                  {
                    "rank": 24,
                    "school": "James Madison",
                    "conference": "Sun Belt",
                    "firstPlaceVotes": 0,
                    "points": 169
                  },
                  {
                    "rank": 25,
                    "school": "North Carolina",
                    "conference": "ACC",
                    "firstPlaceVotes": 0,
                    "points": 120
                  }
                ]
              },
              {
                "poll": "AP Top 25",
                "ranks": [
                  {
                    "rank": 1,
                    "school": "Georgia",
                    "conference": "SEC",
                    "firstPlaceVotes": 48,
                    "points": 1553
                  },
                  {
                    "rank": 2,
                    "school": "Michigan",
                    "conference": "Big Ten",
                    "firstPlaceVotes": 9,
                    "points": 1494
                  },
                  {
                    "rank": 3,
                    "school": "Ohio State",
                    "conference": "Big Ten",
                    "firstPlaceVotes": 3,
                    "points": 1446
                  },
                  {
                    "rank": 4,
                    "school": "Florida State",
                    "conference": "ACC",
                    "firstPlaceVotes": 3,
                    "points": 1421
                  },
                  {
                    "rank": 5,
                    "school": "Washington",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 1327
                  },
                  {
                    "rank": 6,
                    "school": "Oregon",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 1235
                  },
                  {
                    "rank": 7,
                    "school": "Texas",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 1189
                  },
                  {
                    "rank": 8,
                    "school": "Alabama",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 1114
                  },
                  {
                    "rank": 9,
                    "school": "Penn State",
                    "conference": "Big Ten",
                    "firstPlaceVotes": 0,
                    "points": 1044
                  },
                  {
                    "rank": 10,
                    "school": "Oklahoma",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 1010
                  },
                  {
                    "rank": 11,
                    "school": "Ole Miss",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 990
                  },
                  {
                    "rank": 12,
                    "school": "Notre Dame",
                    "conference": "FBS Independents",
                    "firstPlaceVotes": 0,
                    "points": 847
                  },
                  {
                    "rank": 13,
                    "school": "LSU",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 816
                  },
                  {
                    "rank": 14,
                    "school": "Missouri",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 714
                  },
                  {
                    "rank": 15,
                    "school": "Louisville",
                    "conference": "ACC",
                    "firstPlaceVotes": 0,
                    "points": 666
                  },
                  {
                    "rank": 16,
                    "school": "Oregon State",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 557
                  },
                  {
                    "rank": 17,
                    "school": "Air Force",
                    "conference": "Mountain West",
                    "firstPlaceVotes": 0,
                    "points": 526
                  },
                  {
                    "rank": 18,
                    "school": "Utah",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 510
                  },
                  {
                    "rank": 19,
                    "school": "Tennessee",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 473
                  },
                  {
                    "rank": 20,
                    "school": "UCLA",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 331
                  },
                  {
                    "rank": 21,
                    "school": "Tulane",
                    "conference": "American Athletic",
                    "firstPlaceVotes": 0,
                    "points": 303
                  },
                  {
                    "rank": 22,
                    "school": "Kansas",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 250
                  },
                  {
                    "rank": 23,
                    "school": "James Madison",
                    "conference": "Sun Belt",
                    "firstPlaceVotes": 0,
                    "points": 192
                  },
                  {
                    "rank": 24,
                    "school": "USC",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 139
                  },
                  {
                    "rank": 25,
                    "school": "Kansas State",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 112
                  }
                ]
              },
              {
                "poll": "FCS Coaches Poll",
                "ranks": [
                  {
                    "rank": 1,
                    "school": "South Dakota State",
                    "conference": "MVFC",
                    "firstPlaceVotes": 25,
                    "points": 625
                  },
                  {
                    "rank": 2,
                    "school": "Furman",
                    "conference": "Southern",
                    "firstPlaceVotes": 0,
                    "points": 577
                  },
                  {
                    "rank": 3,
                    "school": "Montana",
                    "conference": "Big Sky",
                    "firstPlaceVotes": 0,
                    "points": 544
                  },
                  {
                    "rank": 4,
                    "school": "Incarnate Word",
                    "conference": "Southland",
                    "firstPlaceVotes": 0,
                    "points": 533
                  },
                  {
                    "rank": 5,
                    "school": "Idaho",
                    "conference": "Big Sky",
                    "firstPlaceVotes": 0,
                    "points": 515
                  },
                  {
                    "rank": 6,
                    "school": "Delaware",
                    "conference": "CAA",
                    "firstPlaceVotes": 0,
                    "points": 507
                  },
                  {
                    "rank": 7,
                    "school": "Sacramento State",
                    "conference": "Big Sky",
                    "firstPlaceVotes": 0,
                    "points": 471
                  },
                  {
                    "rank": 8,
                    "school": "Montana State",
                    "conference": "Big Sky",
                    "firstPlaceVotes": 0,
                    "points": 458
                  },
                  {
                    "rank": 9,
                    "school": "North Carolina Central",
                    "conference": "MEAC",
                    "firstPlaceVotes": 0,
                    "points": 407
                  },
                  {
                    "rank": 10,
                    "school": "North Dakota State",
                    "conference": "MVFC",
                    "firstPlaceVotes": 0,
                    "points": 398
                  },
                  {
                    "rank": 11,
                    "school": "Southern Illinois",
                    "conference": "MVFC",
                    "firstPlaceVotes": 0,
                    "points": 380
                  },
                  {
                    "rank": 12,
                    "school": "South Dakota",
                    "conference": "MVFC",
                    "firstPlaceVotes": 0,
                    "points": 330
                  },
                  {
                    "rank": 13,
                    "school": "Florida A&M",
                    "conference": "SWAC",
                    "firstPlaceVotes": 0,
                    "points": 296
                  },
                  {
                    "rank": 13,
                    "school": "Chattanooga",
                    "conference": "Southern",
                    "firstPlaceVotes": 0,
                    "points": 296
                  },
                  {
                    "rank": 15,
                    "school": "North Dakota",
                    "conference": "MVFC",
                    "firstPlaceVotes": 0,
                    "points": 260
                  },
                  {
                    "rank": 16,
                    "school": "Lafayette",
                    "conference": "Patriot",
                    "firstPlaceVotes": 0,
                    "points": 241
                  },
                  {
                    "rank": 17,
                    "school": "Austin Peay",
                    "conference": "UAC",
                    "firstPlaceVotes": 0,
                    "points": 218
                  },
                  {
                    "rank": 18,
                    "school": "UT Martin",
                    "conference": "Big South-OVC",
                    "firstPlaceVotes": 0,
                    "points": 179
                  },
                  {
                    "rank": 19,
                    "school": "Harvard",
                    "conference": "Ivy",
                    "firstPlaceVotes": 0,
                    "points": 137
                  },
                  {
                    "rank": 20,
                    "school": "Western Carolina",
                    "conference": "Southern",
                    "firstPlaceVotes": 0,
                    "points": 124
                  },
                  {
                    "rank": 21,
                    "school": "Holy Cross",
                    "conference": "Patriot",
                    "firstPlaceVotes": 0,
                    "points": 120
                  },
                  {
                    "rank": 22,
                    "school": "Villanova",
                    "conference": "CAA",
                    "firstPlaceVotes": 0,
                    "points": 107
                  },
                  {
                    "rank": 23,
                    "school": "Northern Iowa",
                    "conference": "MVFC",
                    "firstPlaceVotes": 0,
                    "points": 105
                  },
                  {
                    "rank": 24,
                    "school": "William & Mary",
                    "conference": "CAA",
                    "firstPlaceVotes": 0,
                    "points": 83
                  },
                  {
                    "rank": 25,
                    "school": "Central Arkansas",
                    "conference": "UAC",
                    "firstPlaceVotes": 0,
                    "points": 73
                  }
                ]
              },
              {
                "poll": "AFCA Division II Coaches Poll",
                "ranks": [
                  {
                    "rank": 1,
                    "school": "Colorado Mines",
                    "conference": "Rocky Mountain",
                    "firstPlaceVotes": 26,
                    "points": 720
                  },
                  {
                    "rank": 2,
                    "school": "Pittsburg State",
                    "conference": "Mid America",
                    "firstPlaceVotes": 1,
                    "points": 694
                  },
                  {
                    "rank": 3,
                    "school": "Grand Valley State",
                    "conference": "GLIAC",
                    "firstPlaceVotes": 1,
                    "points": 662
                  },
                  {
                    "rank": 4,
                    "school": "Harding",
                    "conference": "Great American",
                    "firstPlaceVotes": 0,
                    "points": 637
                  },
                  {
                    "rank": 5,
                    "school": "Slippery Rock",
                    "conference": "Pennsylvania State Athletic",
                    "firstPlaceVotes": 1,
                    "points": 582
                  },
                  {
                    "rank": 6,
                    "school": "Benedict College",
                    "conference": "SIAC",
                    "firstPlaceVotes": 0,
                    "points": 573
                  },
                  {
                    "rank": 7,
                    "school": "Ferris State",
                    "conference": "GLIAC",
                    "firstPlaceVotes": 0,
                    "points": 534
                  },
                  {
                    "rank": 8,
                    "school": "Indianapolis",
                    "conference": "Great Lakes",
                    "firstPlaceVotes": 0,
                    "points": 503
                  },
                  {
                    "rank": 9,
                    "school": "Davenport",
                    "conference": "GLIAC",
                    "firstPlaceVotes": 0,
                    "points": 484
                  },
                  {
                    "rank": 10,
                    "school": "Minnesota State",
                    "conference": "Northern Sun",
                    "firstPlaceVotes": 0,
                    "points": 437
                  },
                  {
                    "rank": 11,
                    "school": "Central Missouri State",
                    "conference": "Mid America",
                    "firstPlaceVotes": 0,
                    "points": 406
                  },
                  {
                    "rank": 12,
                    "school": "Ouachita Baptist",
                    "conference": "Great American",
                    "firstPlaceVotes": 0,
                    "points": 399
                  },
                  {
                    "rank": 13,
                    "school": "Bemidji State",
                    "conference": "Northern Sun",
                    "firstPlaceVotes": 0,
                    "points": 353
                  },
                  {
                    "rank": 14,
                    "school": "Delta State",
                    "conference": "Gulf South",
                    "firstPlaceVotes": 0,
                    "points": 322
                  },
                  {
                    "rank": 15,
                    "school": "Western State",
                    "conference": "Rocky Mountain",
                    "firstPlaceVotes": 0,
                    "points": 321
                  },
                  {
                    "rank": 16,
                    "school": "Lenoir-Rhyne",
                    "conference": "South Atlantic",
                    "firstPlaceVotes": 0,
                    "points": 291
                  },
                  {
                    "rank": 17,
                    "school": "Tiffin",
                    "conference": "Great Midwest Athletic",
                    "firstPlaceVotes": 0,
                    "points": 282
                  },
                  {
                    "rank": 18,
                    "school": "University of Texas of the Permian Basin",
                    "conference": "Lone Star",
                    "firstPlaceVotes": 0,
                    "points": 228
                  },
                  {
                    "rank": 19,
                    "school": "Virginia Union",
                    "conference": "CIAA",
                    "firstPlaceVotes": 0,
                    "points": 210
                  },
                  {
                    "rank": 20,
                    "school": "Valdosta State",
                    "conference": "Gulf South",
                    "firstPlaceVotes": 0,
                    "points": 207
                  },
                  {
                    "rank": 21,
                    "school": "Augustana (SD)",
                    "conference": "Northern Sun",
                    "firstPlaceVotes": 0,
                    "points": 183
                  },
                  {
                    "rank": 22,
                    "school": "Virginia State",
                    "conference": "CIAA",
                    "firstPlaceVotes": 0,
                    "points": 86
                  },
                  {
                    "rank": 23,
                    "school": "Missouri Western",
                    "conference": "Mid America",
                    "firstPlaceVotes": 0,
                    "points": 69
                  },
                  {
                    "rank": 24,
                    "school": "Central Washington",
                    "conference": "Lone Star",
                    "firstPlaceVotes": 0,
                    "points": 54
                  },
                  {
                    "rank": 25,
                    "school": "Mars Hill",
                    "conference": "South Atlantic",
                    "firstPlaceVotes": 0,
                    "points": 43
                  }
                ]
              },
              {
                "poll": "AFCA Division III Coaches Poll",
                "ranks": [
                  {
                    "rank": 1,
                    "school": "North Central",
                    "conference": "CCIW",
                    "firstPlaceVotes": 48,
                    "points": 1224
                  },
                  {
                    "rank": 2,
                    "school": "Mount Union",
                    "conference": "Ohio",
                    "firstPlaceVotes": 1,
                    "points": 1173
                  },
                  {
                    "rank": 3,
                    "school": "Wartburg",
                    "conference": "American Rivers",
                    "firstPlaceVotes": 0,
                    "points": 1120
                  },
                  {
                    "rank": 4,
                    "school": "Linfield",
                    "conference": "Northwest",
                    "firstPlaceVotes": 0,
                    "points": 1024
                  },
                  {
                    "rank": 5,
                    "school": "Trinity (TX)",
                    "conference": "Southern Athletic",
                    "firstPlaceVotes": 0,
                    "points": 986
                  },
                  {
                    "rank": 6,
                    "school": "UW-Whitewater",
                    "conference": "Wisconsin",
                    "firstPlaceVotes": 0,
                    "points": 958
                  },
                  {
                    "rank": 7,
                    "school": "Wisconsin-La Crosse",
                    "conference": "Wisconsin",
                    "firstPlaceVotes": 0,
                    "points": 909
                  },
                  {
                    "rank": 8,
                    "school": "Johns Hopkins",
                    "conference": "Centennial",
                    "firstPlaceVotes": 0,
                    "points": 903
                  },
                  {
                    "rank": 9,
                    "school": "Randolph-Macon",
                    "conference": "Old Dominion",
                    "firstPlaceVotes": 0,
                    "points": 817
                  },
                  {
                    "rank": 10,
                    "school": "UW-River Falls",
                    "conference": "Wisconsin",
                    "firstPlaceVotes": 0,
                    "points": 779
                  },
                  {
                    "rank": 11,
                    "school": "Aurora",
                    "conference": "NACC",
                    "firstPlaceVotes": 0,
                    "points": 724
                  },
                  {
                    "rank": 12,
                    "school": "Susquehanna",
                    "conference": "Landmark Conference",
                    "firstPlaceVotes": 0,
                    "points": 688
                  },
                  {
                    "rank": 13,
                    "school": "Wheaton College (Ill)",
                    "conference": "CCIW",
                    "firstPlaceVotes": 0,
                    "points": 619
                  },
                  {
                    "rank": 14,
                    "school": "Alma College",
                    "conference": "Michigan",
                    "firstPlaceVotes": 0,
                    "points": 577
                  },
                  {
                    "rank": 15,
                    "school": "John Carroll",
                    "conference": "Ohio",
                    "firstPlaceVotes": 0,
                    "points": 549
                  },
                  {
                    "rank": 16,
                    "school": "Ithaca",
                    "conference": "Liberty League",
                    "firstPlaceVotes": 0,
                    "points": 457
                  },
                  {
                    "rank": 17,
                    "school": "SUNY Cortland",
                    "conference": "Empire 8",
                    "firstPlaceVotes": 0,
                    "points": 413
                  },
                  {
                    "rank": 18,
                    "school": "Endicott College",
                    "conference": "Commonwealth Coast",
                    "firstPlaceVotes": 0,
                    "points": 342
                  },
                  {
                    "rank": 19,
                    "school": "Hardin-Simmons",
                    "conference": "American Southwest",
                    "firstPlaceVotes": 0,
                    "points": 288
                  },
                  {
                    "rank": 20,
                    "school": "Grove City College",
                    "conference": "Presidents'",
                    "firstPlaceVotes": 0,
                    "points": 275
                  },
                  {
                    "rank": 21,
                    "school": "St. Johns (MN)",
                    "conference": "Minnesota",
                    "firstPlaceVotes": 0,
                    "points": 262
                  },
                  {
                    "rank": 22,
                    "school": "Muhlenberg",
                    "conference": "Centennial",
                    "firstPlaceVotes": 0,
                    "points": 230
                  },
                  {
                    "rank": 23,
                    "school": "DePauw",
                    "conference": "North Coast",
                    "firstPlaceVotes": 0,
                    "points": 183
                  },
                  {
                    "rank": 24,
                    "school": "Delaware Valley",
                    "conference": "Mid Atlantic",
                    "firstPlaceVotes": 0,
                    "points": 114
                  },
                  {
                    "rank": 25,
                    "school": "Berry College",
                    "conference": "Southern Athletic",
                    "firstPlaceVotes": 0,
                    "points": 99
                  }
                ]
              },
              {
                "poll": "Playoff Committee Rankings",
                "ranks": [
                  {
                    "rank": 1,
                    "school": "Ohio State",
                    "conference": "Big Ten",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 2,
                    "school": "Georgia",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 3,
                    "school": "Michigan",
                    "conference": "Big Ten",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 4,
                    "school": "Florida State",
                    "conference": "ACC",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 5,
                    "school": "Washington",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 6,
                    "school": "Oregon",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 7,
                    "school": "Texas",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 8,
                    "school": "Alabama",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 9,
                    "school": "Oklahoma",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 10,
                    "school": "Ole Miss",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 11,
                    "school": "Penn State",
                    "conference": "Big Ten",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 12,
                    "school": "Missouri",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 13,
                    "school": "Louisville",
                    "conference": "ACC",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 14,
                    "school": "LSU",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 15,
                    "school": "Notre Dame",
                    "conference": "FBS Independents",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 16,
                    "school": "Oregon State",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 17,
                    "school": "Tennessee",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 18,
                    "school": "Florida",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 19,
                    "school": "UCLA",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 20,
                    "school": "USC",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 21,
                    "school": "Kansas",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 22,
                    "school": "Oklahoma State",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 23,
                    "school": "Kansas State",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 24,
                    "school": "Tulane",
                    "conference": "American Athletic",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 25,
                    "school": "Air Force",
                    "conference": "Mountain West",
                    "firstPlaceVotes": 0,
                    "points": 0
                  }
                ]
              }
            ]
          }];

        global.fetch = jest.fn(() => Promise.resolve({
            json: () => Promise.resolve(rankings)
        }));

        var resultingScore = await scoringModule.calculateScoreV1(team, game, week);
        expect(resultingScore).toEqual(3);
    });
    
    it('Top 10 Ranked Conference Game Win', async () => {
        const team = "Arkansas";
        const game = {
            "_id": {
              "$oid": "65dfd87c1546400b2aeb7975"
            },
            "id": 401520363,
            "season": 2023,
            "week": 10,
            "seasonType": "regular",
            "startDate": "2023-11-04T16:00:00.000Z",
            "startTimeTbd": false,
            "completed": true,
            "neutralSite": false,
            "conferenceGame": true,
            "attendance": 89782,
            "venueId": 3634,
            "venue": "Ben Hill Griffin Stadium",
            "homeId": 57,
            "homeTeam": "Florida",
            "homeConference": "SEC",
            "homeDivision": "fbs",
            "homePoints": 36,
            "homeLineScores": [
              14,
              3,
              6,
              10,
              3
            ],
            "homePostWinProb": "0.08075347362469056",
            "homePregameElo": 1592,
            "homePostgameElo": 1588,
            "awayId": 8,
            "awayTeam": "Arkansas",
            "awayConference": "SEC",
            "awayDivision": "fbs",
            "awayPoints": 39,
            "awayLineScores": [
              14,
              3,
              3,
              13,
              6
            ],
            "awayPostWinProb": "0.9192465263753095",
            "awayPregameElo": 1596,
            "awayPostgameElo": 1600,
            "excitementIndex": "9.7718678848",
            "highlights": null,
            "notes": "test Arkansas game notes"
          };
        const week = 10;
        const rankings = [{
            "_id": {
              "$oid": "65de66651546400b2aeb6e64"
            },
            "season": 2023,
            "seasonType": "regular",
            "week": 10,
            "polls": [
              {
                "poll": "Coaches Poll",
                "ranks": [
                  {
                    "rank": 1,
                    "school": "Georgia",
                    "conference": "SEC",
                    "firstPlaceVotes": 58,
                    "points": 1590
                  },
                  {
                    "rank": 2,
                    "school": "Michigan",
                    "conference": "Big Ten",
                    "firstPlaceVotes": 3,
                    "points": 1520
                  },
                  {
                    "rank": 3,
                    "school": "Ohio State",
                    "conference": "Big Ten",
                    "firstPlaceVotes": 3,
                    "points": 1454
                  },
                  {
                    "rank": 4,
                    "school": "Florida State",
                    "conference": "ACC",
                    "firstPlaceVotes": 0,
                    "points": 1439
                  },
                  {
                    "rank": 5,
                    "school": "Washington",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 1344
                  },
                  {
                    "rank": 6,
                    "school": "Texas",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 1212
                  },
                  {
                    "rank": 7,
                    "school": "Oregon",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 1211
                  },
                  {
                    "rank": 8,
                    "school": "Alabama",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 1187
                  },
                  {
                    "rank": 9,
                    "school": "Penn State",
                    "conference": "Big Ten",
                    "firstPlaceVotes": 0,
                    "points": 1072
                  },
                  {
                    "rank": 10,
                    "school": "Ole Miss",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 1021
                  },
                  {
                    "rank": 11,
                    "school": "Oklahoma",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 948
                  },
                  {
                    "rank": 12,
                    "school": "Notre Dame",
                    "conference": "FBS Independents",
                    "firstPlaceVotes": 0,
                    "points": 847
                  },
                  {
                    "rank": 13,
                    "school": "LSU",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 809
                  },
                  {
                    "rank": 14,
                    "school": "Missouri",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 741
                  },
                  {
                    "rank": 15,
                    "school": "Louisville",
                    "conference": "ACC",
                    "firstPlaceVotes": 0,
                    "points": 701
                  },
                  {
                    "rank": 16,
                    "school": "Tennessee",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 553
                  },
                  {
                    "rank": 17,
                    "school": "Air Force",
                    "conference": "Mountain West",
                    "firstPlaceVotes": 0,
                    "points": 523
                  },
                  {
                    "rank": 18,
                    "school": "Utah",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 509
                  },
                  {
                    "rank": 19,
                    "school": "Oregon State",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 465
                  },
                  {
                    "rank": 20,
                    "school": "UCLA",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 309
                  },
                  {
                    "rank": 21,
                    "school": "Tulane",
                    "conference": "American Athletic",
                    "firstPlaceVotes": 0,
                    "points": 304
                  },
                  {
                    "rank": 22,
                    "school": "USC",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 239
                  },
                  {
                    "rank": 23,
                    "school": "Kansas",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 182
                  },
                  {
                    "rank": 24,
                    "school": "James Madison",
                    "conference": "Sun Belt",
                    "firstPlaceVotes": 0,
                    "points": 169
                  },
                  {
                    "rank": 25,
                    "school": "North Carolina",
                    "conference": "ACC",
                    "firstPlaceVotes": 0,
                    "points": 120
                  }
                ]
              },
              {
                "poll": "AP Top 25",
                "ranks": [
                  {
                    "rank": 1,
                    "school": "Georgia",
                    "conference": "SEC",
                    "firstPlaceVotes": 48,
                    "points": 1553
                  },
                  {
                    "rank": 2,
                    "school": "Michigan",
                    "conference": "Big Ten",
                    "firstPlaceVotes": 9,
                    "points": 1494
                  },
                  {
                    "rank": 3,
                    "school": "Ohio State",
                    "conference": "Big Ten",
                    "firstPlaceVotes": 3,
                    "points": 1446
                  },
                  {
                    "rank": 4,
                    "school": "Florida State",
                    "conference": "ACC",
                    "firstPlaceVotes": 3,
                    "points": 1421
                  },
                  {
                    "rank": 5,
                    "school": "Washington",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 1327
                  },
                  {
                    "rank": 6,
                    "school": "Oregon",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 1235
                  },
                  {
                    "rank": 7,
                    "school": "Texas",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 1189
                  },
                  {
                    "rank": 8,
                    "school": "Alabama",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 1114
                  },
                  {
                    "rank": 9,
                    "school": "Penn State",
                    "conference": "Big Ten",
                    "firstPlaceVotes": 0,
                    "points": 1044
                  },
                  {
                    "rank": 10,
                    "school": "Oklahoma",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 1010
                  },
                  {
                    "rank": 11,
                    "school": "Ole Miss",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 990
                  },
                  {
                    "rank": 12,
                    "school": "Notre Dame",
                    "conference": "FBS Independents",
                    "firstPlaceVotes": 0,
                    "points": 847
                  },
                  {
                    "rank": 13,
                    "school": "LSU",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 816
                  },
                  {
                    "rank": 14,
                    "school": "Missouri",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 714
                  },
                  {
                    "rank": 15,
                    "school": "Louisville",
                    "conference": "ACC",
                    "firstPlaceVotes": 0,
                    "points": 666
                  },
                  {
                    "rank": 16,
                    "school": "Oregon State",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 557
                  },
                  {
                    "rank": 17,
                    "school": "Air Force",
                    "conference": "Mountain West",
                    "firstPlaceVotes": 0,
                    "points": 526
                  },
                  {
                    "rank": 18,
                    "school": "Utah",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 510
                  },
                  {
                    "rank": 19,
                    "school": "Tennessee",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 473
                  },
                  {
                    "rank": 20,
                    "school": "UCLA",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 331
                  },
                  {
                    "rank": 21,
                    "school": "Tulane",
                    "conference": "American Athletic",
                    "firstPlaceVotes": 0,
                    "points": 303
                  },
                  {
                    "rank": 22,
                    "school": "Kansas",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 250
                  },
                  {
                    "rank": 23,
                    "school": "James Madison",
                    "conference": "Sun Belt",
                    "firstPlaceVotes": 0,
                    "points": 192
                  },
                  {
                    "rank": 24,
                    "school": "USC",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 139
                  },
                  {
                    "rank": 25,
                    "school": "Kansas State",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 112
                  }
                ]
              },
              {
                "poll": "FCS Coaches Poll",
                "ranks": [
                  {
                    "rank": 1,
                    "school": "South Dakota State",
                    "conference": "MVFC",
                    "firstPlaceVotes": 25,
                    "points": 625
                  },
                  {
                    "rank": 2,
                    "school": "Furman",
                    "conference": "Southern",
                    "firstPlaceVotes": 0,
                    "points": 577
                  },
                  {
                    "rank": 3,
                    "school": "Montana",
                    "conference": "Big Sky",
                    "firstPlaceVotes": 0,
                    "points": 544
                  },
                  {
                    "rank": 4,
                    "school": "Incarnate Word",
                    "conference": "Southland",
                    "firstPlaceVotes": 0,
                    "points": 533
                  },
                  {
                    "rank": 5,
                    "school": "Idaho",
                    "conference": "Big Sky",
                    "firstPlaceVotes": 0,
                    "points": 515
                  },
                  {
                    "rank": 6,
                    "school": "Delaware",
                    "conference": "CAA",
                    "firstPlaceVotes": 0,
                    "points": 507
                  },
                  {
                    "rank": 7,
                    "school": "Sacramento State",
                    "conference": "Big Sky",
                    "firstPlaceVotes": 0,
                    "points": 471
                  },
                  {
                    "rank": 8,
                    "school": "Montana State",
                    "conference": "Big Sky",
                    "firstPlaceVotes": 0,
                    "points": 458
                  },
                  {
                    "rank": 9,
                    "school": "North Carolina Central",
                    "conference": "MEAC",
                    "firstPlaceVotes": 0,
                    "points": 407
                  },
                  {
                    "rank": 10,
                    "school": "North Dakota State",
                    "conference": "MVFC",
                    "firstPlaceVotes": 0,
                    "points": 398
                  },
                  {
                    "rank": 11,
                    "school": "Southern Illinois",
                    "conference": "MVFC",
                    "firstPlaceVotes": 0,
                    "points": 380
                  },
                  {
                    "rank": 12,
                    "school": "South Dakota",
                    "conference": "MVFC",
                    "firstPlaceVotes": 0,
                    "points": 330
                  },
                  {
                    "rank": 13,
                    "school": "Florida A&M",
                    "conference": "SWAC",
                    "firstPlaceVotes": 0,
                    "points": 296
                  },
                  {
                    "rank": 13,
                    "school": "Chattanooga",
                    "conference": "Southern",
                    "firstPlaceVotes": 0,
                    "points": 296
                  },
                  {
                    "rank": 15,
                    "school": "North Dakota",
                    "conference": "MVFC",
                    "firstPlaceVotes": 0,
                    "points": 260
                  },
                  {
                    "rank": 16,
                    "school": "Lafayette",
                    "conference": "Patriot",
                    "firstPlaceVotes": 0,
                    "points": 241
                  },
                  {
                    "rank": 17,
                    "school": "Austin Peay",
                    "conference": "UAC",
                    "firstPlaceVotes": 0,
                    "points": 218
                  },
                  {
                    "rank": 18,
                    "school": "UT Martin",
                    "conference": "Big South-OVC",
                    "firstPlaceVotes": 0,
                    "points": 179
                  },
                  {
                    "rank": 19,
                    "school": "Harvard",
                    "conference": "Ivy",
                    "firstPlaceVotes": 0,
                    "points": 137
                  },
                  {
                    "rank": 20,
                    "school": "Western Carolina",
                    "conference": "Southern",
                    "firstPlaceVotes": 0,
                    "points": 124
                  },
                  {
                    "rank": 21,
                    "school": "Holy Cross",
                    "conference": "Patriot",
                    "firstPlaceVotes": 0,
                    "points": 120
                  },
                  {
                    "rank": 22,
                    "school": "Villanova",
                    "conference": "CAA",
                    "firstPlaceVotes": 0,
                    "points": 107
                  },
                  {
                    "rank": 23,
                    "school": "Northern Iowa",
                    "conference": "MVFC",
                    "firstPlaceVotes": 0,
                    "points": 105
                  },
                  {
                    "rank": 24,
                    "school": "William & Mary",
                    "conference": "CAA",
                    "firstPlaceVotes": 0,
                    "points": 83
                  },
                  {
                    "rank": 25,
                    "school": "Central Arkansas",
                    "conference": "UAC",
                    "firstPlaceVotes": 0,
                    "points": 73
                  }
                ]
              },
              {
                "poll": "AFCA Division II Coaches Poll",
                "ranks": [
                  {
                    "rank": 1,
                    "school": "Colorado Mines",
                    "conference": "Rocky Mountain",
                    "firstPlaceVotes": 26,
                    "points": 720
                  },
                  {
                    "rank": 2,
                    "school": "Pittsburg State",
                    "conference": "Mid America",
                    "firstPlaceVotes": 1,
                    "points": 694
                  },
                  {
                    "rank": 3,
                    "school": "Grand Valley State",
                    "conference": "GLIAC",
                    "firstPlaceVotes": 1,
                    "points": 662
                  },
                  {
                    "rank": 4,
                    "school": "Harding",
                    "conference": "Great American",
                    "firstPlaceVotes": 0,
                    "points": 637
                  },
                  {
                    "rank": 5,
                    "school": "Slippery Rock",
                    "conference": "Pennsylvania State Athletic",
                    "firstPlaceVotes": 1,
                    "points": 582
                  },
                  {
                    "rank": 6,
                    "school": "Benedict College",
                    "conference": "SIAC",
                    "firstPlaceVotes": 0,
                    "points": 573
                  },
                  {
                    "rank": 7,
                    "school": "Ferris State",
                    "conference": "GLIAC",
                    "firstPlaceVotes": 0,
                    "points": 534
                  },
                  {
                    "rank": 8,
                    "school": "Indianapolis",
                    "conference": "Great Lakes",
                    "firstPlaceVotes": 0,
                    "points": 503
                  },
                  {
                    "rank": 9,
                    "school": "Davenport",
                    "conference": "GLIAC",
                    "firstPlaceVotes": 0,
                    "points": 484
                  },
                  {
                    "rank": 10,
                    "school": "Minnesota State",
                    "conference": "Northern Sun",
                    "firstPlaceVotes": 0,
                    "points": 437
                  },
                  {
                    "rank": 11,
                    "school": "Central Missouri State",
                    "conference": "Mid America",
                    "firstPlaceVotes": 0,
                    "points": 406
                  },
                  {
                    "rank": 12,
                    "school": "Ouachita Baptist",
                    "conference": "Great American",
                    "firstPlaceVotes": 0,
                    "points": 399
                  },
                  {
                    "rank": 13,
                    "school": "Bemidji State",
                    "conference": "Northern Sun",
                    "firstPlaceVotes": 0,
                    "points": 353
                  },
                  {
                    "rank": 14,
                    "school": "Delta State",
                    "conference": "Gulf South",
                    "firstPlaceVotes": 0,
                    "points": 322
                  },
                  {
                    "rank": 15,
                    "school": "Western State",
                    "conference": "Rocky Mountain",
                    "firstPlaceVotes": 0,
                    "points": 321
                  },
                  {
                    "rank": 16,
                    "school": "Lenoir-Rhyne",
                    "conference": "South Atlantic",
                    "firstPlaceVotes": 0,
                    "points": 291
                  },
                  {
                    "rank": 17,
                    "school": "Tiffin",
                    "conference": "Great Midwest Athletic",
                    "firstPlaceVotes": 0,
                    "points": 282
                  },
                  {
                    "rank": 18,
                    "school": "University of Texas of the Permian Basin",
                    "conference": "Lone Star",
                    "firstPlaceVotes": 0,
                    "points": 228
                  },
                  {
                    "rank": 19,
                    "school": "Virginia Union",
                    "conference": "CIAA",
                    "firstPlaceVotes": 0,
                    "points": 210
                  },
                  {
                    "rank": 20,
                    "school": "Valdosta State",
                    "conference": "Gulf South",
                    "firstPlaceVotes": 0,
                    "points": 207
                  },
                  {
                    "rank": 21,
                    "school": "Augustana (SD)",
                    "conference": "Northern Sun",
                    "firstPlaceVotes": 0,
                    "points": 183
                  },
                  {
                    "rank": 22,
                    "school": "Virginia State",
                    "conference": "CIAA",
                    "firstPlaceVotes": 0,
                    "points": 86
                  },
                  {
                    "rank": 23,
                    "school": "Missouri Western",
                    "conference": "Mid America",
                    "firstPlaceVotes": 0,
                    "points": 69
                  },
                  {
                    "rank": 24,
                    "school": "Central Washington",
                    "conference": "Lone Star",
                    "firstPlaceVotes": 0,
                    "points": 54
                  },
                  {
                    "rank": 25,
                    "school": "Mars Hill",
                    "conference": "South Atlantic",
                    "firstPlaceVotes": 0,
                    "points": 43
                  }
                ]
              },
              {
                "poll": "AFCA Division III Coaches Poll",
                "ranks": [
                  {
                    "rank": 1,
                    "school": "North Central",
                    "conference": "CCIW",
                    "firstPlaceVotes": 48,
                    "points": 1224
                  },
                  {
                    "rank": 2,
                    "school": "Mount Union",
                    "conference": "Ohio",
                    "firstPlaceVotes": 1,
                    "points": 1173
                  },
                  {
                    "rank": 3,
                    "school": "Wartburg",
                    "conference": "American Rivers",
                    "firstPlaceVotes": 0,
                    "points": 1120
                  },
                  {
                    "rank": 4,
                    "school": "Linfield",
                    "conference": "Northwest",
                    "firstPlaceVotes": 0,
                    "points": 1024
                  },
                  {
                    "rank": 5,
                    "school": "Trinity (TX)",
                    "conference": "Southern Athletic",
                    "firstPlaceVotes": 0,
                    "points": 986
                  },
                  {
                    "rank": 6,
                    "school": "UW-Whitewater",
                    "conference": "Wisconsin",
                    "firstPlaceVotes": 0,
                    "points": 958
                  },
                  {
                    "rank": 7,
                    "school": "Wisconsin-La Crosse",
                    "conference": "Wisconsin",
                    "firstPlaceVotes": 0,
                    "points": 909
                  },
                  {
                    "rank": 8,
                    "school": "Johns Hopkins",
                    "conference": "Centennial",
                    "firstPlaceVotes": 0,
                    "points": 903
                  },
                  {
                    "rank": 9,
                    "school": "Randolph-Macon",
                    "conference": "Old Dominion",
                    "firstPlaceVotes": 0,
                    "points": 817
                  },
                  {
                    "rank": 10,
                    "school": "UW-River Falls",
                    "conference": "Wisconsin",
                    "firstPlaceVotes": 0,
                    "points": 779
                  },
                  {
                    "rank": 11,
                    "school": "Aurora",
                    "conference": "NACC",
                    "firstPlaceVotes": 0,
                    "points": 724
                  },
                  {
                    "rank": 12,
                    "school": "Susquehanna",
                    "conference": "Landmark Conference",
                    "firstPlaceVotes": 0,
                    "points": 688
                  },
                  {
                    "rank": 13,
                    "school": "Wheaton College (Ill)",
                    "conference": "CCIW",
                    "firstPlaceVotes": 0,
                    "points": 619
                  },
                  {
                    "rank": 14,
                    "school": "Alma College",
                    "conference": "Michigan",
                    "firstPlaceVotes": 0,
                    "points": 577
                  },
                  {
                    "rank": 15,
                    "school": "John Carroll",
                    "conference": "Ohio",
                    "firstPlaceVotes": 0,
                    "points": 549
                  },
                  {
                    "rank": 16,
                    "school": "Ithaca",
                    "conference": "Liberty League",
                    "firstPlaceVotes": 0,
                    "points": 457
                  },
                  {
                    "rank": 17,
                    "school": "SUNY Cortland",
                    "conference": "Empire 8",
                    "firstPlaceVotes": 0,
                    "points": 413
                  },
                  {
                    "rank": 18,
                    "school": "Endicott College",
                    "conference": "Commonwealth Coast",
                    "firstPlaceVotes": 0,
                    "points": 342
                  },
                  {
                    "rank": 19,
                    "school": "Hardin-Simmons",
                    "conference": "American Southwest",
                    "firstPlaceVotes": 0,
                    "points": 288
                  },
                  {
                    "rank": 20,
                    "school": "Grove City College",
                    "conference": "Presidents'",
                    "firstPlaceVotes": 0,
                    "points": 275
                  },
                  {
                    "rank": 21,
                    "school": "St. Johns (MN)",
                    "conference": "Minnesota",
                    "firstPlaceVotes": 0,
                    "points": 262
                  },
                  {
                    "rank": 22,
                    "school": "Muhlenberg",
                    "conference": "Centennial",
                    "firstPlaceVotes": 0,
                    "points": 230
                  },
                  {
                    "rank": 23,
                    "school": "DePauw",
                    "conference": "North Coast",
                    "firstPlaceVotes": 0,
                    "points": 183
                  },
                  {
                    "rank": 24,
                    "school": "Delaware Valley",
                    "conference": "Mid Atlantic",
                    "firstPlaceVotes": 0,
                    "points": 114
                  },
                  {
                    "rank": 25,
                    "school": "Berry College",
                    "conference": "Southern Athletic",
                    "firstPlaceVotes": 0,
                    "points": 99
                  }
                ]
              },
              {
                "poll": "Playoff Committee Rankings",
                "ranks": [
                  {
                    "rank": 1,
                    "school": "Ohio State",
                    "conference": "Big Ten",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 2,
                    "school": "Georgia",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 3,
                    "school": "Michigan",
                    "conference": "Big Ten",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 4,
                    "school": "Florida State",
                    "conference": "ACC",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 5,
                    "school": "Washington",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 6,
                    "school": "Oregon",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 7,
                    "school": "Texas",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 8,
                    "school": "Alabama",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 9,
                    "school": "Florida",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 10,
                    "school": "Ole Miss",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 11,
                    "school": "Penn State",
                    "conference": "Big Ten",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 12,
                    "school": "Missouri",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 13,
                    "school": "Louisville",
                    "conference": "ACC",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 14,
                    "school": "LSU",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 15,
                    "school": "Notre Dame",
                    "conference": "FBS Independents",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 16,
                    "school": "Oregon State",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 17,
                    "school": "Tennessee",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 18,
                    "school": "Utah",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 19,
                    "school": "UCLA",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 20,
                    "school": "USC",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 21,
                    "school": "Kansas",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 22,
                    "school": "Oklahoma State",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 23,
                    "school": "Kansas State",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 24,
                    "school": "Tulane",
                    "conference": "American Athletic",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 25,
                    "school": "Air Force",
                    "conference": "Mountain West",
                    "firstPlaceVotes": 0,
                    "points": 0
                  }
                ]
              }
            ]
          }];

        global.fetch = jest.fn(() => Promise.resolve({
            json: () => Promise.resolve(rankings)
        }));

        var resultingScore = await scoringModule.calculateScoreV1(team, game, week);
        expect(resultingScore).toEqual(3);
    });
    
    it('Non Power 5 Win over Power 5 Opponent', async () => {
        const team = "Tulane";
        const game = {
            "_id": {
              "$oid": "65dfd87c1546400b2aeb7975"
            },
            "season": 2023,
            "week": 2,
            "seasonType": "regular",
            "startDate": "2023-09-09T19:30:00.000Z",
            "startTimeTbd": false,
            "completed": true,
            "neutralSite": false,
            "conferenceGame": false,
            "attendance": 30000,
            "venueId": 4729,
            "venue": "Benson Field at Yulman Stadium",
            "homeId": 2655,
            "homeTeam": "Tulane",
            "homeConference": "American Athletic",
            "homeDivision": "fbs",
            "homePoints": 40,
            "homeLineScores": [
                17,
                10,
                10,
                3
            ],
            "homePostWinProb": "0.0508540891906328",
            "homePregameElo": 1671,
            "homePostgameElo": 1621,
            "awayId": 8,
            "awayTeam": "Arkansas",
            "awayConference": "SEC",
            "awayDivision": "fbs",
            "awayPoints": 39,
            "awayLineScores": [
              14,
              3,
              3,
              13,
              6
            ],
            "awayPostWinProb": "0.9192465263753095",
            "awayPregameElo": 1596,
            "awayPostgameElo": 1600,
            "excitementIndex": "9.7718678848",
            "highlights": null,
            "notes": "test Arkansas game notes"
          };
        const week = 10;
        const rankings = [{
            "_id": {
              "$oid": "65de66651546400b2aeb6e64"
            },
            "season": 2023,
            "seasonType": "regular",
            "week": 10,
            "polls": [
              {
                "poll": "Coaches Poll",
                "ranks": [
                  {
                    "rank": 1,
                    "school": "Georgia",
                    "conference": "SEC",
                    "firstPlaceVotes": 58,
                    "points": 1590
                  },
                  {
                    "rank": 2,
                    "school": "Michigan",
                    "conference": "Big Ten",
                    "firstPlaceVotes": 3,
                    "points": 1520
                  },
                  {
                    "rank": 3,
                    "school": "Ohio State",
                    "conference": "Big Ten",
                    "firstPlaceVotes": 3,
                    "points": 1454
                  },
                  {
                    "rank": 4,
                    "school": "Florida State",
                    "conference": "ACC",
                    "firstPlaceVotes": 0,
                    "points": 1439
                  },
                  {
                    "rank": 5,
                    "school": "Washington",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 1344
                  },
                  {
                    "rank": 6,
                    "school": "Texas",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 1212
                  },
                  {
                    "rank": 7,
                    "school": "Oregon",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 1211
                  },
                  {
                    "rank": 8,
                    "school": "Alabama",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 1187
                  },
                  {
                    "rank": 9,
                    "school": "Penn State",
                    "conference": "Big Ten",
                    "firstPlaceVotes": 0,
                    "points": 1072
                  },
                  {
                    "rank": 10,
                    "school": "Ole Miss",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 1021
                  },
                  {
                    "rank": 11,
                    "school": "Oklahoma",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 948
                  },
                  {
                    "rank": 12,
                    "school": "Notre Dame",
                    "conference": "FBS Independents",
                    "firstPlaceVotes": 0,
                    "points": 847
                  },
                  {
                    "rank": 13,
                    "school": "LSU",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 809
                  },
                  {
                    "rank": 14,
                    "school": "Missouri",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 741
                  },
                  {
                    "rank": 15,
                    "school": "Louisville",
                    "conference": "ACC",
                    "firstPlaceVotes": 0,
                    "points": 701
                  },
                  {
                    "rank": 16,
                    "school": "Tennessee",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 553
                  },
                  {
                    "rank": 17,
                    "school": "Air Force",
                    "conference": "Mountain West",
                    "firstPlaceVotes": 0,
                    "points": 523
                  },
                  {
                    "rank": 18,
                    "school": "Utah",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 509
                  },
                  {
                    "rank": 19,
                    "school": "Oregon State",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 465
                  },
                  {
                    "rank": 20,
                    "school": "UCLA",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 309
                  },
                  {
                    "rank": 21,
                    "school": "Tulane",
                    "conference": "American Athletic",
                    "firstPlaceVotes": 0,
                    "points": 304
                  },
                  {
                    "rank": 22,
                    "school": "USC",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 239
                  },
                  {
                    "rank": 23,
                    "school": "Kansas",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 182
                  },
                  {
                    "rank": 24,
                    "school": "James Madison",
                    "conference": "Sun Belt",
                    "firstPlaceVotes": 0,
                    "points": 169
                  },
                  {
                    "rank": 25,
                    "school": "North Carolina",
                    "conference": "ACC",
                    "firstPlaceVotes": 0,
                    "points": 120
                  }
                ]
              },
              {
                "poll": "AP Top 25",
                "ranks": [
                  {
                    "rank": 1,
                    "school": "Georgia",
                    "conference": "SEC",
                    "firstPlaceVotes": 48,
                    "points": 1553
                  },
                  {
                    "rank": 2,
                    "school": "Michigan",
                    "conference": "Big Ten",
                    "firstPlaceVotes": 9,
                    "points": 1494
                  },
                  {
                    "rank": 3,
                    "school": "Ohio State",
                    "conference": "Big Ten",
                    "firstPlaceVotes": 3,
                    "points": 1446
                  },
                  {
                    "rank": 4,
                    "school": "Florida State",
                    "conference": "ACC",
                    "firstPlaceVotes": 3,
                    "points": 1421
                  },
                  {
                    "rank": 5,
                    "school": "Washington",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 1327
                  },
                  {
                    "rank": 6,
                    "school": "Oregon",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 1235
                  },
                  {
                    "rank": 7,
                    "school": "Texas",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 1189
                  },
                  {
                    "rank": 8,
                    "school": "Alabama",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 1114
                  },
                  {
                    "rank": 9,
                    "school": "Penn State",
                    "conference": "Big Ten",
                    "firstPlaceVotes": 0,
                    "points": 1044
                  },
                  {
                    "rank": 10,
                    "school": "Oklahoma",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 1010
                  },
                  {
                    "rank": 11,
                    "school": "Ole Miss",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 990
                  },
                  {
                    "rank": 12,
                    "school": "Notre Dame",
                    "conference": "FBS Independents",
                    "firstPlaceVotes": 0,
                    "points": 847
                  },
                  {
                    "rank": 13,
                    "school": "LSU",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 816
                  },
                  {
                    "rank": 14,
                    "school": "Missouri",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 714
                  },
                  {
                    "rank": 15,
                    "school": "Louisville",
                    "conference": "ACC",
                    "firstPlaceVotes": 0,
                    "points": 666
                  },
                  {
                    "rank": 16,
                    "school": "Oregon State",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 557
                  },
                  {
                    "rank": 17,
                    "school": "Air Force",
                    "conference": "Mountain West",
                    "firstPlaceVotes": 0,
                    "points": 526
                  },
                  {
                    "rank": 18,
                    "school": "Utah",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 510
                  },
                  {
                    "rank": 19,
                    "school": "Tennessee",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 473
                  },
                  {
                    "rank": 20,
                    "school": "UCLA",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 331
                  },
                  {
                    "rank": 21,
                    "school": "Tulane",
                    "conference": "American Athletic",
                    "firstPlaceVotes": 0,
                    "points": 303
                  },
                  {
                    "rank": 22,
                    "school": "Kansas",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 250
                  },
                  {
                    "rank": 23,
                    "school": "James Madison",
                    "conference": "Sun Belt",
                    "firstPlaceVotes": 0,
                    "points": 192
                  },
                  {
                    "rank": 24,
                    "school": "USC",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 139
                  },
                  {
                    "rank": 25,
                    "school": "Kansas State",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 112
                  }
                ]
              },
              {
                "poll": "FCS Coaches Poll",
                "ranks": [
                  {
                    "rank": 1,
                    "school": "South Dakota State",
                    "conference": "MVFC",
                    "firstPlaceVotes": 25,
                    "points": 625
                  },
                  {
                    "rank": 2,
                    "school": "Furman",
                    "conference": "Southern",
                    "firstPlaceVotes": 0,
                    "points": 577
                  },
                  {
                    "rank": 3,
                    "school": "Montana",
                    "conference": "Big Sky",
                    "firstPlaceVotes": 0,
                    "points": 544
                  },
                  {
                    "rank": 4,
                    "school": "Incarnate Word",
                    "conference": "Southland",
                    "firstPlaceVotes": 0,
                    "points": 533
                  },
                  {
                    "rank": 5,
                    "school": "Idaho",
                    "conference": "Big Sky",
                    "firstPlaceVotes": 0,
                    "points": 515
                  },
                  {
                    "rank": 6,
                    "school": "Delaware",
                    "conference": "CAA",
                    "firstPlaceVotes": 0,
                    "points": 507
                  },
                  {
                    "rank": 7,
                    "school": "Sacramento State",
                    "conference": "Big Sky",
                    "firstPlaceVotes": 0,
                    "points": 471
                  },
                  {
                    "rank": 8,
                    "school": "Montana State",
                    "conference": "Big Sky",
                    "firstPlaceVotes": 0,
                    "points": 458
                  },
                  {
                    "rank": 9,
                    "school": "North Carolina Central",
                    "conference": "MEAC",
                    "firstPlaceVotes": 0,
                    "points": 407
                  },
                  {
                    "rank": 10,
                    "school": "North Dakota State",
                    "conference": "MVFC",
                    "firstPlaceVotes": 0,
                    "points": 398
                  },
                  {
                    "rank": 11,
                    "school": "Southern Illinois",
                    "conference": "MVFC",
                    "firstPlaceVotes": 0,
                    "points": 380
                  },
                  {
                    "rank": 12,
                    "school": "South Dakota",
                    "conference": "MVFC",
                    "firstPlaceVotes": 0,
                    "points": 330
                  },
                  {
                    "rank": 13,
                    "school": "Florida A&M",
                    "conference": "SWAC",
                    "firstPlaceVotes": 0,
                    "points": 296
                  },
                  {
                    "rank": 13,
                    "school": "Chattanooga",
                    "conference": "Southern",
                    "firstPlaceVotes": 0,
                    "points": 296
                  },
                  {
                    "rank": 15,
                    "school": "North Dakota",
                    "conference": "MVFC",
                    "firstPlaceVotes": 0,
                    "points": 260
                  },
                  {
                    "rank": 16,
                    "school": "Lafayette",
                    "conference": "Patriot",
                    "firstPlaceVotes": 0,
                    "points": 241
                  },
                  {
                    "rank": 17,
                    "school": "Austin Peay",
                    "conference": "UAC",
                    "firstPlaceVotes": 0,
                    "points": 218
                  },
                  {
                    "rank": 18,
                    "school": "UT Martin",
                    "conference": "Big South-OVC",
                    "firstPlaceVotes": 0,
                    "points": 179
                  },
                  {
                    "rank": 19,
                    "school": "Harvard",
                    "conference": "Ivy",
                    "firstPlaceVotes": 0,
                    "points": 137
                  },
                  {
                    "rank": 20,
                    "school": "Western Carolina",
                    "conference": "Southern",
                    "firstPlaceVotes": 0,
                    "points": 124
                  },
                  {
                    "rank": 21,
                    "school": "Holy Cross",
                    "conference": "Patriot",
                    "firstPlaceVotes": 0,
                    "points": 120
                  },
                  {
                    "rank": 22,
                    "school": "Villanova",
                    "conference": "CAA",
                    "firstPlaceVotes": 0,
                    "points": 107
                  },
                  {
                    "rank": 23,
                    "school": "Northern Iowa",
                    "conference": "MVFC",
                    "firstPlaceVotes": 0,
                    "points": 105
                  },
                  {
                    "rank": 24,
                    "school": "William & Mary",
                    "conference": "CAA",
                    "firstPlaceVotes": 0,
                    "points": 83
                  },
                  {
                    "rank": 25,
                    "school": "Central Arkansas",
                    "conference": "UAC",
                    "firstPlaceVotes": 0,
                    "points": 73
                  }
                ]
              },
              {
                "poll": "AFCA Division II Coaches Poll",
                "ranks": [
                  {
                    "rank": 1,
                    "school": "Colorado Mines",
                    "conference": "Rocky Mountain",
                    "firstPlaceVotes": 26,
                    "points": 720
                  },
                  {
                    "rank": 2,
                    "school": "Pittsburg State",
                    "conference": "Mid America",
                    "firstPlaceVotes": 1,
                    "points": 694
                  },
                  {
                    "rank": 3,
                    "school": "Grand Valley State",
                    "conference": "GLIAC",
                    "firstPlaceVotes": 1,
                    "points": 662
                  },
                  {
                    "rank": 4,
                    "school": "Harding",
                    "conference": "Great American",
                    "firstPlaceVotes": 0,
                    "points": 637
                  },
                  {
                    "rank": 5,
                    "school": "Slippery Rock",
                    "conference": "Pennsylvania State Athletic",
                    "firstPlaceVotes": 1,
                    "points": 582
                  },
                  {
                    "rank": 6,
                    "school": "Benedict College",
                    "conference": "SIAC",
                    "firstPlaceVotes": 0,
                    "points": 573
                  },
                  {
                    "rank": 7,
                    "school": "Ferris State",
                    "conference": "GLIAC",
                    "firstPlaceVotes": 0,
                    "points": 534
                  },
                  {
                    "rank": 8,
                    "school": "Indianapolis",
                    "conference": "Great Lakes",
                    "firstPlaceVotes": 0,
                    "points": 503
                  },
                  {
                    "rank": 9,
                    "school": "Davenport",
                    "conference": "GLIAC",
                    "firstPlaceVotes": 0,
                    "points": 484
                  },
                  {
                    "rank": 10,
                    "school": "Minnesota State",
                    "conference": "Northern Sun",
                    "firstPlaceVotes": 0,
                    "points": 437
                  },
                  {
                    "rank": 11,
                    "school": "Central Missouri State",
                    "conference": "Mid America",
                    "firstPlaceVotes": 0,
                    "points": 406
                  },
                  {
                    "rank": 12,
                    "school": "Ouachita Baptist",
                    "conference": "Great American",
                    "firstPlaceVotes": 0,
                    "points": 399
                  },
                  {
                    "rank": 13,
                    "school": "Bemidji State",
                    "conference": "Northern Sun",
                    "firstPlaceVotes": 0,
                    "points": 353
                  },
                  {
                    "rank": 14,
                    "school": "Delta State",
                    "conference": "Gulf South",
                    "firstPlaceVotes": 0,
                    "points": 322
                  },
                  {
                    "rank": 15,
                    "school": "Western State",
                    "conference": "Rocky Mountain",
                    "firstPlaceVotes": 0,
                    "points": 321
                  },
                  {
                    "rank": 16,
                    "school": "Lenoir-Rhyne",
                    "conference": "South Atlantic",
                    "firstPlaceVotes": 0,
                    "points": 291
                  },
                  {
                    "rank": 17,
                    "school": "Tiffin",
                    "conference": "Great Midwest Athletic",
                    "firstPlaceVotes": 0,
                    "points": 282
                  },
                  {
                    "rank": 18,
                    "school": "University of Texas of the Permian Basin",
                    "conference": "Lone Star",
                    "firstPlaceVotes": 0,
                    "points": 228
                  },
                  {
                    "rank": 19,
                    "school": "Virginia Union",
                    "conference": "CIAA",
                    "firstPlaceVotes": 0,
                    "points": 210
                  },
                  {
                    "rank": 20,
                    "school": "Valdosta State",
                    "conference": "Gulf South",
                    "firstPlaceVotes": 0,
                    "points": 207
                  },
                  {
                    "rank": 21,
                    "school": "Augustana (SD)",
                    "conference": "Northern Sun",
                    "firstPlaceVotes": 0,
                    "points": 183
                  },
                  {
                    "rank": 22,
                    "school": "Virginia State",
                    "conference": "CIAA",
                    "firstPlaceVotes": 0,
                    "points": 86
                  },
                  {
                    "rank": 23,
                    "school": "Missouri Western",
                    "conference": "Mid America",
                    "firstPlaceVotes": 0,
                    "points": 69
                  },
                  {
                    "rank": 24,
                    "school": "Central Washington",
                    "conference": "Lone Star",
                    "firstPlaceVotes": 0,
                    "points": 54
                  },
                  {
                    "rank": 25,
                    "school": "Mars Hill",
                    "conference": "South Atlantic",
                    "firstPlaceVotes": 0,
                    "points": 43
                  }
                ]
              },
              {
                "poll": "AFCA Division III Coaches Poll",
                "ranks": [
                  {
                    "rank": 1,
                    "school": "North Central",
                    "conference": "CCIW",
                    "firstPlaceVotes": 48,
                    "points": 1224
                  },
                  {
                    "rank": 2,
                    "school": "Mount Union",
                    "conference": "Ohio",
                    "firstPlaceVotes": 1,
                    "points": 1173
                  },
                  {
                    "rank": 3,
                    "school": "Wartburg",
                    "conference": "American Rivers",
                    "firstPlaceVotes": 0,
                    "points": 1120
                  },
                  {
                    "rank": 4,
                    "school": "Linfield",
                    "conference": "Northwest",
                    "firstPlaceVotes": 0,
                    "points": 1024
                  },
                  {
                    "rank": 5,
                    "school": "Trinity (TX)",
                    "conference": "Southern Athletic",
                    "firstPlaceVotes": 0,
                    "points": 986
                  },
                  {
                    "rank": 6,
                    "school": "UW-Whitewater",
                    "conference": "Wisconsin",
                    "firstPlaceVotes": 0,
                    "points": 958
                  },
                  {
                    "rank": 7,
                    "school": "Wisconsin-La Crosse",
                    "conference": "Wisconsin",
                    "firstPlaceVotes": 0,
                    "points": 909
                  },
                  {
                    "rank": 8,
                    "school": "Johns Hopkins",
                    "conference": "Centennial",
                    "firstPlaceVotes": 0,
                    "points": 903
                  },
                  {
                    "rank": 9,
                    "school": "Randolph-Macon",
                    "conference": "Old Dominion",
                    "firstPlaceVotes": 0,
                    "points": 817
                  },
                  {
                    "rank": 10,
                    "school": "UW-River Falls",
                    "conference": "Wisconsin",
                    "firstPlaceVotes": 0,
                    "points": 779
                  },
                  {
                    "rank": 11,
                    "school": "Aurora",
                    "conference": "NACC",
                    "firstPlaceVotes": 0,
                    "points": 724
                  },
                  {
                    "rank": 12,
                    "school": "Susquehanna",
                    "conference": "Landmark Conference",
                    "firstPlaceVotes": 0,
                    "points": 688
                  },
                  {
                    "rank": 13,
                    "school": "Wheaton College (Ill)",
                    "conference": "CCIW",
                    "firstPlaceVotes": 0,
                    "points": 619
                  },
                  {
                    "rank": 14,
                    "school": "Alma College",
                    "conference": "Michigan",
                    "firstPlaceVotes": 0,
                    "points": 577
                  },
                  {
                    "rank": 15,
                    "school": "John Carroll",
                    "conference": "Ohio",
                    "firstPlaceVotes": 0,
                    "points": 549
                  },
                  {
                    "rank": 16,
                    "school": "Ithaca",
                    "conference": "Liberty League",
                    "firstPlaceVotes": 0,
                    "points": 457
                  },
                  {
                    "rank": 17,
                    "school": "SUNY Cortland",
                    "conference": "Empire 8",
                    "firstPlaceVotes": 0,
                    "points": 413
                  },
                  {
                    "rank": 18,
                    "school": "Endicott College",
                    "conference": "Commonwealth Coast",
                    "firstPlaceVotes": 0,
                    "points": 342
                  },
                  {
                    "rank": 19,
                    "school": "Hardin-Simmons",
                    "conference": "American Southwest",
                    "firstPlaceVotes": 0,
                    "points": 288
                  },
                  {
                    "rank": 20,
                    "school": "Grove City College",
                    "conference": "Presidents'",
                    "firstPlaceVotes": 0,
                    "points": 275
                  },
                  {
                    "rank": 21,
                    "school": "St. Johns (MN)",
                    "conference": "Minnesota",
                    "firstPlaceVotes": 0,
                    "points": 262
                  },
                  {
                    "rank": 22,
                    "school": "Muhlenberg",
                    "conference": "Centennial",
                    "firstPlaceVotes": 0,
                    "points": 230
                  },
                  {
                    "rank": 23,
                    "school": "DePauw",
                    "conference": "North Coast",
                    "firstPlaceVotes": 0,
                    "points": 183
                  },
                  {
                    "rank": 24,
                    "school": "Delaware Valley",
                    "conference": "Mid Atlantic",
                    "firstPlaceVotes": 0,
                    "points": 114
                  },
                  {
                    "rank": 25,
                    "school": "Berry College",
                    "conference": "Southern Athletic",
                    "firstPlaceVotes": 0,
                    "points": 99
                  }
                ]
              },
              {
                "poll": "Playoff Committee Rankings",
                "ranks": [
                  {
                    "rank": 1,
                    "school": "Ohio State",
                    "conference": "Big Ten",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 2,
                    "school": "Georgia",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 3,
                    "school": "Michigan",
                    "conference": "Big Ten",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 4,
                    "school": "Florida State",
                    "conference": "ACC",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 5,
                    "school": "Washington",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 6,
                    "school": "Oregon",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 7,
                    "school": "Texas",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 8,
                    "school": "Alabama",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 9,
                    "school": "Florida",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 10,
                    "school": "Ole Miss",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 11,
                    "school": "Penn State",
                    "conference": "Big Ten",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 12,
                    "school": "Missouri",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 13,
                    "school": "Louisville",
                    "conference": "ACC",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 14,
                    "school": "LSU",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 15,
                    "school": "Notre Dame",
                    "conference": "FBS Independents",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 16,
                    "school": "Oregon State",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 17,
                    "school": "Tennessee",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 18,
                    "school": "Utah",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 19,
                    "school": "UCLA",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 20,
                    "school": "USC",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 21,
                    "school": "Kansas",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 22,
                    "school": "Oklahoma State",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 23,
                    "school": "Kansas State",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 24,
                    "school": "Tulane",
                    "conference": "American Athletic",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 25,
                    "school": "Air Force",
                    "conference": "Mountain West",
                    "firstPlaceVotes": 0,
                    "points": 0
                  }
                ]
              }
            ]
          }];

        global.fetch = jest.fn(() => Promise.resolve({
            json: () => Promise.resolve(rankings)
        }));

        var resultingScore = await scoringModule.calculateScoreV1(team, game, week);
        expect(resultingScore).toEqual(1);
    });
    
    it('Conference Championship Win', async () => {
        const team = "Alabama";
        const game = {
            "_id": {
                "$oid": "65dfd87c1546400b2aeb7c84"
            },
            "id": 401539483,
            "season": 2023,
            "week": 14,
            "seasonType": "regular",
            "startDate": "2023-12-02T21:00:00.000Z",
            "startTimeTbd": false,
            "completed": true,
            "neutralSite": true,
            "conferenceGame": true,
            "attendance": 78320,
            "venueId": 5348,
            "venue": "Mercedes-Benz Stadium",
            "homeId": 333,
            "homeTeam": "Alabama",
            "homeConference": "SEC",
            "homeDivision": "fbs",
            "homePoints": 27,
            "homeLineScores": [
                3,
                14,
                3,
                7
            ],
            "homePostWinProb": "0.6057193086697867",
            "homePregameElo": 2028,
            "homePostgameElo": 2039,
            "awayId": 61,
            "awayTeam": "Georgia",
            "awayConference": "SEC",
            "awayDivision": "fbs",
            "awayPoints": 24,
            "awayLineScores": [
                7,
                0,
                3,
                14
            ],
            "awayPostWinProb": "0.39428069133021326",
            "awayPregameElo": 2122,
            "awayPostgameElo": 2111,
            "excitementIndex": "6.8059224938",
            "highlights": null,
            "notes": "SEC Championship"
          };
        const week = 10;
        const rankings = [{
            "_id": {
              "$oid": "65de66651546400b2aeb6e64"
            },
            "season": 2023,
            "seasonType": "regular",
            "week": 10,
            "polls": [
              {
                "poll": "Coaches Poll",
                "ranks": [
                  {
                    "rank": 1,
                    "school": "Georgia",
                    "conference": "SEC",
                    "firstPlaceVotes": 58,
                    "points": 1590
                  },
                  {
                    "rank": 2,
                    "school": "Michigan",
                    "conference": "Big Ten",
                    "firstPlaceVotes": 3,
                    "points": 1520
                  },
                  {
                    "rank": 3,
                    "school": "Ohio State",
                    "conference": "Big Ten",
                    "firstPlaceVotes": 3,
                    "points": 1454
                  },
                  {
                    "rank": 4,
                    "school": "Florida State",
                    "conference": "ACC",
                    "firstPlaceVotes": 0,
                    "points": 1439
                  },
                  {
                    "rank": 5,
                    "school": "Washington",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 1344
                  },
                  {
                    "rank": 6,
                    "school": "Texas",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 1212
                  },
                  {
                    "rank": 7,
                    "school": "Oregon",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 1211
                  },
                  {
                    "rank": 8,
                    "school": "Alabama",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 1187
                  },
                  {
                    "rank": 9,
                    "school": "Penn State",
                    "conference": "Big Ten",
                    "firstPlaceVotes": 0,
                    "points": 1072
                  },
                  {
                    "rank": 10,
                    "school": "Ole Miss",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 1021
                  },
                  {
                    "rank": 11,
                    "school": "Oklahoma",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 948
                  },
                  {
                    "rank": 12,
                    "school": "Notre Dame",
                    "conference": "FBS Independents",
                    "firstPlaceVotes": 0,
                    "points": 847
                  },
                  {
                    "rank": 13,
                    "school": "LSU",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 809
                  },
                  {
                    "rank": 14,
                    "school": "Missouri",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 741
                  },
                  {
                    "rank": 15,
                    "school": "Louisville",
                    "conference": "ACC",
                    "firstPlaceVotes": 0,
                    "points": 701
                  },
                  {
                    "rank": 16,
                    "school": "Tennessee",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 553
                  },
                  {
                    "rank": 17,
                    "school": "Air Force",
                    "conference": "Mountain West",
                    "firstPlaceVotes": 0,
                    "points": 523
                  },
                  {
                    "rank": 18,
                    "school": "Utah",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 509
                  },
                  {
                    "rank": 19,
                    "school": "Oregon State",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 465
                  },
                  {
                    "rank": 20,
                    "school": "UCLA",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 309
                  },
                  {
                    "rank": 21,
                    "school": "Tulane",
                    "conference": "American Athletic",
                    "firstPlaceVotes": 0,
                    "points": 304
                  },
                  {
                    "rank": 22,
                    "school": "USC",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 239
                  },
                  {
                    "rank": 23,
                    "school": "Kansas",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 182
                  },
                  {
                    "rank": 24,
                    "school": "James Madison",
                    "conference": "Sun Belt",
                    "firstPlaceVotes": 0,
                    "points": 169
                  },
                  {
                    "rank": 25,
                    "school": "North Carolina",
                    "conference": "ACC",
                    "firstPlaceVotes": 0,
                    "points": 120
                  }
                ]
              },
              {
                "poll": "AP Top 25",
                "ranks": [
                  {
                    "rank": 1,
                    "school": "Georgia",
                    "conference": "SEC",
                    "firstPlaceVotes": 48,
                    "points": 1553
                  },
                  {
                    "rank": 2,
                    "school": "Michigan",
                    "conference": "Big Ten",
                    "firstPlaceVotes": 9,
                    "points": 1494
                  },
                  {
                    "rank": 3,
                    "school": "Ohio State",
                    "conference": "Big Ten",
                    "firstPlaceVotes": 3,
                    "points": 1446
                  },
                  {
                    "rank": 4,
                    "school": "Florida State",
                    "conference": "ACC",
                    "firstPlaceVotes": 3,
                    "points": 1421
                  },
                  {
                    "rank": 5,
                    "school": "Washington",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 1327
                  },
                  {
                    "rank": 6,
                    "school": "Oregon",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 1235
                  },
                  {
                    "rank": 7,
                    "school": "Texas",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 1189
                  },
                  {
                    "rank": 8,
                    "school": "Alabama",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 1114
                  },
                  {
                    "rank": 9,
                    "school": "Penn State",
                    "conference": "Big Ten",
                    "firstPlaceVotes": 0,
                    "points": 1044
                  },
                  {
                    "rank": 10,
                    "school": "Oklahoma",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 1010
                  },
                  {
                    "rank": 11,
                    "school": "Ole Miss",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 990
                  },
                  {
                    "rank": 12,
                    "school": "Notre Dame",
                    "conference": "FBS Independents",
                    "firstPlaceVotes": 0,
                    "points": 847
                  },
                  {
                    "rank": 13,
                    "school": "LSU",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 816
                  },
                  {
                    "rank": 14,
                    "school": "Missouri",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 714
                  },
                  {
                    "rank": 15,
                    "school": "Louisville",
                    "conference": "ACC",
                    "firstPlaceVotes": 0,
                    "points": 666
                  },
                  {
                    "rank": 16,
                    "school": "Oregon State",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 557
                  },
                  {
                    "rank": 17,
                    "school": "Air Force",
                    "conference": "Mountain West",
                    "firstPlaceVotes": 0,
                    "points": 526
                  },
                  {
                    "rank": 18,
                    "school": "Utah",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 510
                  },
                  {
                    "rank": 19,
                    "school": "Tennessee",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 473
                  },
                  {
                    "rank": 20,
                    "school": "UCLA",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 331
                  },
                  {
                    "rank": 21,
                    "school": "Tulane",
                    "conference": "American Athletic",
                    "firstPlaceVotes": 0,
                    "points": 303
                  },
                  {
                    "rank": 22,
                    "school": "Kansas",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 250
                  },
                  {
                    "rank": 23,
                    "school": "James Madison",
                    "conference": "Sun Belt",
                    "firstPlaceVotes": 0,
                    "points": 192
                  },
                  {
                    "rank": 24,
                    "school": "USC",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 139
                  },
                  {
                    "rank": 25,
                    "school": "Kansas State",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 112
                  }
                ]
              },
              {
                "poll": "FCS Coaches Poll",
                "ranks": [
                  {
                    "rank": 1,
                    "school": "South Dakota State",
                    "conference": "MVFC",
                    "firstPlaceVotes": 25,
                    "points": 625
                  },
                  {
                    "rank": 2,
                    "school": "Furman",
                    "conference": "Southern",
                    "firstPlaceVotes": 0,
                    "points": 577
                  },
                  {
                    "rank": 3,
                    "school": "Montana",
                    "conference": "Big Sky",
                    "firstPlaceVotes": 0,
                    "points": 544
                  },
                  {
                    "rank": 4,
                    "school": "Incarnate Word",
                    "conference": "Southland",
                    "firstPlaceVotes": 0,
                    "points": 533
                  },
                  {
                    "rank": 5,
                    "school": "Idaho",
                    "conference": "Big Sky",
                    "firstPlaceVotes": 0,
                    "points": 515
                  },
                  {
                    "rank": 6,
                    "school": "Delaware",
                    "conference": "CAA",
                    "firstPlaceVotes": 0,
                    "points": 507
                  },
                  {
                    "rank": 7,
                    "school": "Sacramento State",
                    "conference": "Big Sky",
                    "firstPlaceVotes": 0,
                    "points": 471
                  },
                  {
                    "rank": 8,
                    "school": "Montana State",
                    "conference": "Big Sky",
                    "firstPlaceVotes": 0,
                    "points": 458
                  },
                  {
                    "rank": 9,
                    "school": "North Carolina Central",
                    "conference": "MEAC",
                    "firstPlaceVotes": 0,
                    "points": 407
                  },
                  {
                    "rank": 10,
                    "school": "North Dakota State",
                    "conference": "MVFC",
                    "firstPlaceVotes": 0,
                    "points": 398
                  },
                  {
                    "rank": 11,
                    "school": "Southern Illinois",
                    "conference": "MVFC",
                    "firstPlaceVotes": 0,
                    "points": 380
                  },
                  {
                    "rank": 12,
                    "school": "South Dakota",
                    "conference": "MVFC",
                    "firstPlaceVotes": 0,
                    "points": 330
                  },
                  {
                    "rank": 13,
                    "school": "Florida A&M",
                    "conference": "SWAC",
                    "firstPlaceVotes": 0,
                    "points": 296
                  },
                  {
                    "rank": 13,
                    "school": "Chattanooga",
                    "conference": "Southern",
                    "firstPlaceVotes": 0,
                    "points": 296
                  },
                  {
                    "rank": 15,
                    "school": "North Dakota",
                    "conference": "MVFC",
                    "firstPlaceVotes": 0,
                    "points": 260
                  },
                  {
                    "rank": 16,
                    "school": "Lafayette",
                    "conference": "Patriot",
                    "firstPlaceVotes": 0,
                    "points": 241
                  },
                  {
                    "rank": 17,
                    "school": "Austin Peay",
                    "conference": "UAC",
                    "firstPlaceVotes": 0,
                    "points": 218
                  },
                  {
                    "rank": 18,
                    "school": "UT Martin",
                    "conference": "Big South-OVC",
                    "firstPlaceVotes": 0,
                    "points": 179
                  },
                  {
                    "rank": 19,
                    "school": "Harvard",
                    "conference": "Ivy",
                    "firstPlaceVotes": 0,
                    "points": 137
                  },
                  {
                    "rank": 20,
                    "school": "Western Carolina",
                    "conference": "Southern",
                    "firstPlaceVotes": 0,
                    "points": 124
                  },
                  {
                    "rank": 21,
                    "school": "Holy Cross",
                    "conference": "Patriot",
                    "firstPlaceVotes": 0,
                    "points": 120
                  },
                  {
                    "rank": 22,
                    "school": "Villanova",
                    "conference": "CAA",
                    "firstPlaceVotes": 0,
                    "points": 107
                  },
                  {
                    "rank": 23,
                    "school": "Northern Iowa",
                    "conference": "MVFC",
                    "firstPlaceVotes": 0,
                    "points": 105
                  },
                  {
                    "rank": 24,
                    "school": "William & Mary",
                    "conference": "CAA",
                    "firstPlaceVotes": 0,
                    "points": 83
                  },
                  {
                    "rank": 25,
                    "school": "Central Arkansas",
                    "conference": "UAC",
                    "firstPlaceVotes": 0,
                    "points": 73
                  }
                ]
              },
              {
                "poll": "AFCA Division II Coaches Poll",
                "ranks": [
                  {
                    "rank": 1,
                    "school": "Colorado Mines",
                    "conference": "Rocky Mountain",
                    "firstPlaceVotes": 26,
                    "points": 720
                  },
                  {
                    "rank": 2,
                    "school": "Pittsburg State",
                    "conference": "Mid America",
                    "firstPlaceVotes": 1,
                    "points": 694
                  },
                  {
                    "rank": 3,
                    "school": "Grand Valley State",
                    "conference": "GLIAC",
                    "firstPlaceVotes": 1,
                    "points": 662
                  },
                  {
                    "rank": 4,
                    "school": "Harding",
                    "conference": "Great American",
                    "firstPlaceVotes": 0,
                    "points": 637
                  },
                  {
                    "rank": 5,
                    "school": "Slippery Rock",
                    "conference": "Pennsylvania State Athletic",
                    "firstPlaceVotes": 1,
                    "points": 582
                  },
                  {
                    "rank": 6,
                    "school": "Benedict College",
                    "conference": "SIAC",
                    "firstPlaceVotes": 0,
                    "points": 573
                  },
                  {
                    "rank": 7,
                    "school": "Ferris State",
                    "conference": "GLIAC",
                    "firstPlaceVotes": 0,
                    "points": 534
                  },
                  {
                    "rank": 8,
                    "school": "Indianapolis",
                    "conference": "Great Lakes",
                    "firstPlaceVotes": 0,
                    "points": 503
                  },
                  {
                    "rank": 9,
                    "school": "Davenport",
                    "conference": "GLIAC",
                    "firstPlaceVotes": 0,
                    "points": 484
                  },
                  {
                    "rank": 10,
                    "school": "Minnesota State",
                    "conference": "Northern Sun",
                    "firstPlaceVotes": 0,
                    "points": 437
                  },
                  {
                    "rank": 11,
                    "school": "Central Missouri State",
                    "conference": "Mid America",
                    "firstPlaceVotes": 0,
                    "points": 406
                  },
                  {
                    "rank": 12,
                    "school": "Ouachita Baptist",
                    "conference": "Great American",
                    "firstPlaceVotes": 0,
                    "points": 399
                  },
                  {
                    "rank": 13,
                    "school": "Bemidji State",
                    "conference": "Northern Sun",
                    "firstPlaceVotes": 0,
                    "points": 353
                  },
                  {
                    "rank": 14,
                    "school": "Delta State",
                    "conference": "Gulf South",
                    "firstPlaceVotes": 0,
                    "points": 322
                  },
                  {
                    "rank": 15,
                    "school": "Western State",
                    "conference": "Rocky Mountain",
                    "firstPlaceVotes": 0,
                    "points": 321
                  },
                  {
                    "rank": 16,
                    "school": "Lenoir-Rhyne",
                    "conference": "South Atlantic",
                    "firstPlaceVotes": 0,
                    "points": 291
                  },
                  {
                    "rank": 17,
                    "school": "Tiffin",
                    "conference": "Great Midwest Athletic",
                    "firstPlaceVotes": 0,
                    "points": 282
                  },
                  {
                    "rank": 18,
                    "school": "University of Texas of the Permian Basin",
                    "conference": "Lone Star",
                    "firstPlaceVotes": 0,
                    "points": 228
                  },
                  {
                    "rank": 19,
                    "school": "Virginia Union",
                    "conference": "CIAA",
                    "firstPlaceVotes": 0,
                    "points": 210
                  },
                  {
                    "rank": 20,
                    "school": "Valdosta State",
                    "conference": "Gulf South",
                    "firstPlaceVotes": 0,
                    "points": 207
                  },
                  {
                    "rank": 21,
                    "school": "Augustana (SD)",
                    "conference": "Northern Sun",
                    "firstPlaceVotes": 0,
                    "points": 183
                  },
                  {
                    "rank": 22,
                    "school": "Virginia State",
                    "conference": "CIAA",
                    "firstPlaceVotes": 0,
                    "points": 86
                  },
                  {
                    "rank": 23,
                    "school": "Missouri Western",
                    "conference": "Mid America",
                    "firstPlaceVotes": 0,
                    "points": 69
                  },
                  {
                    "rank": 24,
                    "school": "Central Washington",
                    "conference": "Lone Star",
                    "firstPlaceVotes": 0,
                    "points": 54
                  },
                  {
                    "rank": 25,
                    "school": "Mars Hill",
                    "conference": "South Atlantic",
                    "firstPlaceVotes": 0,
                    "points": 43
                  }
                ]
              },
              {
                "poll": "AFCA Division III Coaches Poll",
                "ranks": [
                  {
                    "rank": 1,
                    "school": "North Central",
                    "conference": "CCIW",
                    "firstPlaceVotes": 48,
                    "points": 1224
                  },
                  {
                    "rank": 2,
                    "school": "Mount Union",
                    "conference": "Ohio",
                    "firstPlaceVotes": 1,
                    "points": 1173
                  },
                  {
                    "rank": 3,
                    "school": "Wartburg",
                    "conference": "American Rivers",
                    "firstPlaceVotes": 0,
                    "points": 1120
                  },
                  {
                    "rank": 4,
                    "school": "Linfield",
                    "conference": "Northwest",
                    "firstPlaceVotes": 0,
                    "points": 1024
                  },
                  {
                    "rank": 5,
                    "school": "Trinity (TX)",
                    "conference": "Southern Athletic",
                    "firstPlaceVotes": 0,
                    "points": 986
                  },
                  {
                    "rank": 6,
                    "school": "UW-Whitewater",
                    "conference": "Wisconsin",
                    "firstPlaceVotes": 0,
                    "points": 958
                  },
                  {
                    "rank": 7,
                    "school": "Wisconsin-La Crosse",
                    "conference": "Wisconsin",
                    "firstPlaceVotes": 0,
                    "points": 909
                  },
                  {
                    "rank": 8,
                    "school": "Johns Hopkins",
                    "conference": "Centennial",
                    "firstPlaceVotes": 0,
                    "points": 903
                  },
                  {
                    "rank": 9,
                    "school": "Randolph-Macon",
                    "conference": "Old Dominion",
                    "firstPlaceVotes": 0,
                    "points": 817
                  },
                  {
                    "rank": 10,
                    "school": "UW-River Falls",
                    "conference": "Wisconsin",
                    "firstPlaceVotes": 0,
                    "points": 779
                  },
                  {
                    "rank": 11,
                    "school": "Aurora",
                    "conference": "NACC",
                    "firstPlaceVotes": 0,
                    "points": 724
                  },
                  {
                    "rank": 12,
                    "school": "Susquehanna",
                    "conference": "Landmark Conference",
                    "firstPlaceVotes": 0,
                    "points": 688
                  },
                  {
                    "rank": 13,
                    "school": "Wheaton College (Ill)",
                    "conference": "CCIW",
                    "firstPlaceVotes": 0,
                    "points": 619
                  },
                  {
                    "rank": 14,
                    "school": "Alma College",
                    "conference": "Michigan",
                    "firstPlaceVotes": 0,
                    "points": 577
                  },
                  {
                    "rank": 15,
                    "school": "John Carroll",
                    "conference": "Ohio",
                    "firstPlaceVotes": 0,
                    "points": 549
                  },
                  {
                    "rank": 16,
                    "school": "Ithaca",
                    "conference": "Liberty League",
                    "firstPlaceVotes": 0,
                    "points": 457
                  },
                  {
                    "rank": 17,
                    "school": "SUNY Cortland",
                    "conference": "Empire 8",
                    "firstPlaceVotes": 0,
                    "points": 413
                  },
                  {
                    "rank": 18,
                    "school": "Endicott College",
                    "conference": "Commonwealth Coast",
                    "firstPlaceVotes": 0,
                    "points": 342
                  },
                  {
                    "rank": 19,
                    "school": "Hardin-Simmons",
                    "conference": "American Southwest",
                    "firstPlaceVotes": 0,
                    "points": 288
                  },
                  {
                    "rank": 20,
                    "school": "Grove City College",
                    "conference": "Presidents'",
                    "firstPlaceVotes": 0,
                    "points": 275
                  },
                  {
                    "rank": 21,
                    "school": "St. Johns (MN)",
                    "conference": "Minnesota",
                    "firstPlaceVotes": 0,
                    "points": 262
                  },
                  {
                    "rank": 22,
                    "school": "Muhlenberg",
                    "conference": "Centennial",
                    "firstPlaceVotes": 0,
                    "points": 230
                  },
                  {
                    "rank": 23,
                    "school": "DePauw",
                    "conference": "North Coast",
                    "firstPlaceVotes": 0,
                    "points": 183
                  },
                  {
                    "rank": 24,
                    "school": "Delaware Valley",
                    "conference": "Mid Atlantic",
                    "firstPlaceVotes": 0,
                    "points": 114
                  },
                  {
                    "rank": 25,
                    "school": "Berry College",
                    "conference": "Southern Athletic",
                    "firstPlaceVotes": 0,
                    "points": 99
                  }
                ]
              },
              {
                "poll": "Playoff Committee Rankings",
                "ranks": [
                  {
                    "rank": 1,
                    "school": "Ohio State",
                    "conference": "Big Ten",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 2,
                    "school": "Georgia",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 3,
                    "school": "Michigan",
                    "conference": "Big Ten",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 4,
                    "school": "Florida State",
                    "conference": "ACC",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 5,
                    "school": "Washington",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 6,
                    "school": "Oregon",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 7,
                    "school": "Texas",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 8,
                    "school": "Alabama",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 9,
                    "school": "Florida",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 10,
                    "school": "Ole Miss",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 11,
                    "school": "Penn State",
                    "conference": "Big Ten",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 12,
                    "school": "Missouri",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 13,
                    "school": "Louisville",
                    "conference": "ACC",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 14,
                    "school": "LSU",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 15,
                    "school": "Notre Dame",
                    "conference": "FBS Independents",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 16,
                    "school": "Oregon State",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 17,
                    "school": "Tennessee",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 18,
                    "school": "Utah",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 19,
                    "school": "UCLA",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 20,
                    "school": "USC",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 21,
                    "school": "Kansas",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 22,
                    "school": "Oklahoma State",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 23,
                    "school": "Kansas State",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 24,
                    "school": "Tulane",
                    "conference": "American Athletic",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 25,
                    "school": "Air Force",
                    "conference": "Mountain West",
                    "firstPlaceVotes": 0,
                    "points": 0
                  }
                ]
              }
            ]
          }];

        global.fetch = jest.fn(() => Promise.resolve({
            json: () => Promise.resolve(rankings)
        }));

        var resultingScore = await scoringModule.calculateScoreV1(team, game, week);
        expect(resultingScore).toEqual(5);
    });
    
    it('Bowl Game Win', async () => {
        const team = "Western Kentucky";
        const game = {
            "_id": {
              "$oid": "65dfd98d1546400b2aeb7c96"
            },
            "id": 401551469,
            "season": 2023,
            "week": 1,
            "seasonType": "postseason",
            "startDate": "2023-12-18T19:30:00.000Z",
            "startTimeTbd": false,
            "completed": true,
            "neutralSite": true,
            "conferenceGame": false,
            "attendance": null,
            "venueId": 4418,
            "venue": "Jerry Richardson Stadium",
            "homeId": 295,
            "homeTeam": "Old Dominion",
            "homeConference": "Sun Belt",
            "homeDivision": "fbs",
            "homePoints": 35,
            "homeLineScores": [
              21,
              7,
              7,
              0,
              0
            ],
            "homePostWinProb": "0.7778881016633735",
            "homePregameElo": 1355,
            "homePostgameElo": 1359,
            "awayId": 98,
            "awayTeam": "Western Kentucky",
            "awayConference": "Conference USA",
            "awayDivision": "fbs",
            "awayPoints": 38,
            "awayLineScores": [
              0,
              7,
              7,
              21,
              3
            ],
            "awayPostWinProb": "0.22211189833662648",
            "awayPregameElo": 1453,
            "awayPostgameElo": 1449,
            "excitementIndex": "3.8571235001",
            "highlights": null,
            "notes": "Famous Toastery Bowl"
          };
        const week = 10;
        const rankings = [{
            "_id": {
              "$oid": "65de66651546400b2aeb6e64"
            },
            "season": 2023,
            "seasonType": "regular",
            "week": 10,
            "polls": [
              {
                "poll": "Coaches Poll",
                "ranks": [
                  {
                    "rank": 1,
                    "school": "Georgia",
                    "conference": "SEC",
                    "firstPlaceVotes": 58,
                    "points": 1590
                  },
                  {
                    "rank": 2,
                    "school": "Michigan",
                    "conference": "Big Ten",
                    "firstPlaceVotes": 3,
                    "points": 1520
                  },
                  {
                    "rank": 3,
                    "school": "Ohio State",
                    "conference": "Big Ten",
                    "firstPlaceVotes": 3,
                    "points": 1454
                  },
                  {
                    "rank": 4,
                    "school": "Florida State",
                    "conference": "ACC",
                    "firstPlaceVotes": 0,
                    "points": 1439
                  },
                  {
                    "rank": 5,
                    "school": "Washington",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 1344
                  },
                  {
                    "rank": 6,
                    "school": "Texas",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 1212
                  },
                  {
                    "rank": 7,
                    "school": "Oregon",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 1211
                  },
                  {
                    "rank": 8,
                    "school": "Alabama",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 1187
                  },
                  {
                    "rank": 9,
                    "school": "Penn State",
                    "conference": "Big Ten",
                    "firstPlaceVotes": 0,
                    "points": 1072
                  },
                  {
                    "rank": 10,
                    "school": "Ole Miss",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 1021
                  },
                  {
                    "rank": 11,
                    "school": "Oklahoma",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 948
                  },
                  {
                    "rank": 12,
                    "school": "Notre Dame",
                    "conference": "FBS Independents",
                    "firstPlaceVotes": 0,
                    "points": 847
                  },
                  {
                    "rank": 13,
                    "school": "LSU",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 809
                  },
                  {
                    "rank": 14,
                    "school": "Missouri",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 741
                  },
                  {
                    "rank": 15,
                    "school": "Louisville",
                    "conference": "ACC",
                    "firstPlaceVotes": 0,
                    "points": 701
                  },
                  {
                    "rank": 16,
                    "school": "Tennessee",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 553
                  },
                  {
                    "rank": 17,
                    "school": "Air Force",
                    "conference": "Mountain West",
                    "firstPlaceVotes": 0,
                    "points": 523
                  },
                  {
                    "rank": 18,
                    "school": "Utah",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 509
                  },
                  {
                    "rank": 19,
                    "school": "Oregon State",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 465
                  },
                  {
                    "rank": 20,
                    "school": "UCLA",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 309
                  },
                  {
                    "rank": 21,
                    "school": "Tulane",
                    "conference": "American Athletic",
                    "firstPlaceVotes": 0,
                    "points": 304
                  },
                  {
                    "rank": 22,
                    "school": "USC",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 239
                  },
                  {
                    "rank": 23,
                    "school": "Kansas",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 182
                  },
                  {
                    "rank": 24,
                    "school": "James Madison",
                    "conference": "Sun Belt",
                    "firstPlaceVotes": 0,
                    "points": 169
                  },
                  {
                    "rank": 25,
                    "school": "North Carolina",
                    "conference": "ACC",
                    "firstPlaceVotes": 0,
                    "points": 120
                  }
                ]
              },
              {
                "poll": "AP Top 25",
                "ranks": [
                  {
                    "rank": 1,
                    "school": "Georgia",
                    "conference": "SEC",
                    "firstPlaceVotes": 48,
                    "points": 1553
                  },
                  {
                    "rank": 2,
                    "school": "Michigan",
                    "conference": "Big Ten",
                    "firstPlaceVotes": 9,
                    "points": 1494
                  },
                  {
                    "rank": 3,
                    "school": "Ohio State",
                    "conference": "Big Ten",
                    "firstPlaceVotes": 3,
                    "points": 1446
                  },
                  {
                    "rank": 4,
                    "school": "Florida State",
                    "conference": "ACC",
                    "firstPlaceVotes": 3,
                    "points": 1421
                  },
                  {
                    "rank": 5,
                    "school": "Washington",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 1327
                  },
                  {
                    "rank": 6,
                    "school": "Oregon",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 1235
                  },
                  {
                    "rank": 7,
                    "school": "Texas",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 1189
                  },
                  {
                    "rank": 8,
                    "school": "Alabama",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 1114
                  },
                  {
                    "rank": 9,
                    "school": "Penn State",
                    "conference": "Big Ten",
                    "firstPlaceVotes": 0,
                    "points": 1044
                  },
                  {
                    "rank": 10,
                    "school": "Oklahoma",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 1010
                  },
                  {
                    "rank": 11,
                    "school": "Ole Miss",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 990
                  },
                  {
                    "rank": 12,
                    "school": "Notre Dame",
                    "conference": "FBS Independents",
                    "firstPlaceVotes": 0,
                    "points": 847
                  },
                  {
                    "rank": 13,
                    "school": "LSU",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 816
                  },
                  {
                    "rank": 14,
                    "school": "Missouri",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 714
                  },
                  {
                    "rank": 15,
                    "school": "Louisville",
                    "conference": "ACC",
                    "firstPlaceVotes": 0,
                    "points": 666
                  },
                  {
                    "rank": 16,
                    "school": "Oregon State",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 557
                  },
                  {
                    "rank": 17,
                    "school": "Air Force",
                    "conference": "Mountain West",
                    "firstPlaceVotes": 0,
                    "points": 526
                  },
                  {
                    "rank": 18,
                    "school": "Utah",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 510
                  },
                  {
                    "rank": 19,
                    "school": "Tennessee",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 473
                  },
                  {
                    "rank": 20,
                    "school": "UCLA",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 331
                  },
                  {
                    "rank": 21,
                    "school": "Tulane",
                    "conference": "American Athletic",
                    "firstPlaceVotes": 0,
                    "points": 303
                  },
                  {
                    "rank": 22,
                    "school": "Kansas",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 250
                  },
                  {
                    "rank": 23,
                    "school": "James Madison",
                    "conference": "Sun Belt",
                    "firstPlaceVotes": 0,
                    "points": 192
                  },
                  {
                    "rank": 24,
                    "school": "USC",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 139
                  },
                  {
                    "rank": 25,
                    "school": "Kansas State",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 112
                  }
                ]
              },
              {
                "poll": "FCS Coaches Poll",
                "ranks": [
                  {
                    "rank": 1,
                    "school": "South Dakota State",
                    "conference": "MVFC",
                    "firstPlaceVotes": 25,
                    "points": 625
                  },
                  {
                    "rank": 2,
                    "school": "Furman",
                    "conference": "Southern",
                    "firstPlaceVotes": 0,
                    "points": 577
                  },
                  {
                    "rank": 3,
                    "school": "Montana",
                    "conference": "Big Sky",
                    "firstPlaceVotes": 0,
                    "points": 544
                  },
                  {
                    "rank": 4,
                    "school": "Incarnate Word",
                    "conference": "Southland",
                    "firstPlaceVotes": 0,
                    "points": 533
                  },
                  {
                    "rank": 5,
                    "school": "Idaho",
                    "conference": "Big Sky",
                    "firstPlaceVotes": 0,
                    "points": 515
                  },
                  {
                    "rank": 6,
                    "school": "Delaware",
                    "conference": "CAA",
                    "firstPlaceVotes": 0,
                    "points": 507
                  },
                  {
                    "rank": 7,
                    "school": "Sacramento State",
                    "conference": "Big Sky",
                    "firstPlaceVotes": 0,
                    "points": 471
                  },
                  {
                    "rank": 8,
                    "school": "Montana State",
                    "conference": "Big Sky",
                    "firstPlaceVotes": 0,
                    "points": 458
                  },
                  {
                    "rank": 9,
                    "school": "North Carolina Central",
                    "conference": "MEAC",
                    "firstPlaceVotes": 0,
                    "points": 407
                  },
                  {
                    "rank": 10,
                    "school": "North Dakota State",
                    "conference": "MVFC",
                    "firstPlaceVotes": 0,
                    "points": 398
                  },
                  {
                    "rank": 11,
                    "school": "Southern Illinois",
                    "conference": "MVFC",
                    "firstPlaceVotes": 0,
                    "points": 380
                  },
                  {
                    "rank": 12,
                    "school": "South Dakota",
                    "conference": "MVFC",
                    "firstPlaceVotes": 0,
                    "points": 330
                  },
                  {
                    "rank": 13,
                    "school": "Florida A&M",
                    "conference": "SWAC",
                    "firstPlaceVotes": 0,
                    "points": 296
                  },
                  {
                    "rank": 13,
                    "school": "Chattanooga",
                    "conference": "Southern",
                    "firstPlaceVotes": 0,
                    "points": 296
                  },
                  {
                    "rank": 15,
                    "school": "North Dakota",
                    "conference": "MVFC",
                    "firstPlaceVotes": 0,
                    "points": 260
                  },
                  {
                    "rank": 16,
                    "school": "Lafayette",
                    "conference": "Patriot",
                    "firstPlaceVotes": 0,
                    "points": 241
                  },
                  {
                    "rank": 17,
                    "school": "Austin Peay",
                    "conference": "UAC",
                    "firstPlaceVotes": 0,
                    "points": 218
                  },
                  {
                    "rank": 18,
                    "school": "UT Martin",
                    "conference": "Big South-OVC",
                    "firstPlaceVotes": 0,
                    "points": 179
                  },
                  {
                    "rank": 19,
                    "school": "Harvard",
                    "conference": "Ivy",
                    "firstPlaceVotes": 0,
                    "points": 137
                  },
                  {
                    "rank": 20,
                    "school": "Western Carolina",
                    "conference": "Southern",
                    "firstPlaceVotes": 0,
                    "points": 124
                  },
                  {
                    "rank": 21,
                    "school": "Holy Cross",
                    "conference": "Patriot",
                    "firstPlaceVotes": 0,
                    "points": 120
                  },
                  {
                    "rank": 22,
                    "school": "Villanova",
                    "conference": "CAA",
                    "firstPlaceVotes": 0,
                    "points": 107
                  },
                  {
                    "rank": 23,
                    "school": "Northern Iowa",
                    "conference": "MVFC",
                    "firstPlaceVotes": 0,
                    "points": 105
                  },
                  {
                    "rank": 24,
                    "school": "William & Mary",
                    "conference": "CAA",
                    "firstPlaceVotes": 0,
                    "points": 83
                  },
                  {
                    "rank": 25,
                    "school": "Central Arkansas",
                    "conference": "UAC",
                    "firstPlaceVotes": 0,
                    "points": 73
                  }
                ]
              },
              {
                "poll": "AFCA Division II Coaches Poll",
                "ranks": [
                  {
                    "rank": 1,
                    "school": "Colorado Mines",
                    "conference": "Rocky Mountain",
                    "firstPlaceVotes": 26,
                    "points": 720
                  },
                  {
                    "rank": 2,
                    "school": "Pittsburg State",
                    "conference": "Mid America",
                    "firstPlaceVotes": 1,
                    "points": 694
                  },
                  {
                    "rank": 3,
                    "school": "Grand Valley State",
                    "conference": "GLIAC",
                    "firstPlaceVotes": 1,
                    "points": 662
                  },
                  {
                    "rank": 4,
                    "school": "Harding",
                    "conference": "Great American",
                    "firstPlaceVotes": 0,
                    "points": 637
                  },
                  {
                    "rank": 5,
                    "school": "Slippery Rock",
                    "conference": "Pennsylvania State Athletic",
                    "firstPlaceVotes": 1,
                    "points": 582
                  },
                  {
                    "rank": 6,
                    "school": "Benedict College",
                    "conference": "SIAC",
                    "firstPlaceVotes": 0,
                    "points": 573
                  },
                  {
                    "rank": 7,
                    "school": "Ferris State",
                    "conference": "GLIAC",
                    "firstPlaceVotes": 0,
                    "points": 534
                  },
                  {
                    "rank": 8,
                    "school": "Indianapolis",
                    "conference": "Great Lakes",
                    "firstPlaceVotes": 0,
                    "points": 503
                  },
                  {
                    "rank": 9,
                    "school": "Davenport",
                    "conference": "GLIAC",
                    "firstPlaceVotes": 0,
                    "points": 484
                  },
                  {
                    "rank": 10,
                    "school": "Minnesota State",
                    "conference": "Northern Sun",
                    "firstPlaceVotes": 0,
                    "points": 437
                  },
                  {
                    "rank": 11,
                    "school": "Central Missouri State",
                    "conference": "Mid America",
                    "firstPlaceVotes": 0,
                    "points": 406
                  },
                  {
                    "rank": 12,
                    "school": "Ouachita Baptist",
                    "conference": "Great American",
                    "firstPlaceVotes": 0,
                    "points": 399
                  },
                  {
                    "rank": 13,
                    "school": "Bemidji State",
                    "conference": "Northern Sun",
                    "firstPlaceVotes": 0,
                    "points": 353
                  },
                  {
                    "rank": 14,
                    "school": "Delta State",
                    "conference": "Gulf South",
                    "firstPlaceVotes": 0,
                    "points": 322
                  },
                  {
                    "rank": 15,
                    "school": "Western State",
                    "conference": "Rocky Mountain",
                    "firstPlaceVotes": 0,
                    "points": 321
                  },
                  {
                    "rank": 16,
                    "school": "Lenoir-Rhyne",
                    "conference": "South Atlantic",
                    "firstPlaceVotes": 0,
                    "points": 291
                  },
                  {
                    "rank": 17,
                    "school": "Tiffin",
                    "conference": "Great Midwest Athletic",
                    "firstPlaceVotes": 0,
                    "points": 282
                  },
                  {
                    "rank": 18,
                    "school": "University of Texas of the Permian Basin",
                    "conference": "Lone Star",
                    "firstPlaceVotes": 0,
                    "points": 228
                  },
                  {
                    "rank": 19,
                    "school": "Virginia Union",
                    "conference": "CIAA",
                    "firstPlaceVotes": 0,
                    "points": 210
                  },
                  {
                    "rank": 20,
                    "school": "Valdosta State",
                    "conference": "Gulf South",
                    "firstPlaceVotes": 0,
                    "points": 207
                  },
                  {
                    "rank": 21,
                    "school": "Augustana (SD)",
                    "conference": "Northern Sun",
                    "firstPlaceVotes": 0,
                    "points": 183
                  },
                  {
                    "rank": 22,
                    "school": "Virginia State",
                    "conference": "CIAA",
                    "firstPlaceVotes": 0,
                    "points": 86
                  },
                  {
                    "rank": 23,
                    "school": "Missouri Western",
                    "conference": "Mid America",
                    "firstPlaceVotes": 0,
                    "points": 69
                  },
                  {
                    "rank": 24,
                    "school": "Central Washington",
                    "conference": "Lone Star",
                    "firstPlaceVotes": 0,
                    "points": 54
                  },
                  {
                    "rank": 25,
                    "school": "Mars Hill",
                    "conference": "South Atlantic",
                    "firstPlaceVotes": 0,
                    "points": 43
                  }
                ]
              },
              {
                "poll": "AFCA Division III Coaches Poll",
                "ranks": [
                  {
                    "rank": 1,
                    "school": "North Central",
                    "conference": "CCIW",
                    "firstPlaceVotes": 48,
                    "points": 1224
                  },
                  {
                    "rank": 2,
                    "school": "Mount Union",
                    "conference": "Ohio",
                    "firstPlaceVotes": 1,
                    "points": 1173
                  },
                  {
                    "rank": 3,
                    "school": "Wartburg",
                    "conference": "American Rivers",
                    "firstPlaceVotes": 0,
                    "points": 1120
                  },
                  {
                    "rank": 4,
                    "school": "Linfield",
                    "conference": "Northwest",
                    "firstPlaceVotes": 0,
                    "points": 1024
                  },
                  {
                    "rank": 5,
                    "school": "Trinity (TX)",
                    "conference": "Southern Athletic",
                    "firstPlaceVotes": 0,
                    "points": 986
                  },
                  {
                    "rank": 6,
                    "school": "UW-Whitewater",
                    "conference": "Wisconsin",
                    "firstPlaceVotes": 0,
                    "points": 958
                  },
                  {
                    "rank": 7,
                    "school": "Wisconsin-La Crosse",
                    "conference": "Wisconsin",
                    "firstPlaceVotes": 0,
                    "points": 909
                  },
                  {
                    "rank": 8,
                    "school": "Johns Hopkins",
                    "conference": "Centennial",
                    "firstPlaceVotes": 0,
                    "points": 903
                  },
                  {
                    "rank": 9,
                    "school": "Randolph-Macon",
                    "conference": "Old Dominion",
                    "firstPlaceVotes": 0,
                    "points": 817
                  },
                  {
                    "rank": 10,
                    "school": "UW-River Falls",
                    "conference": "Wisconsin",
                    "firstPlaceVotes": 0,
                    "points": 779
                  },
                  {
                    "rank": 11,
                    "school": "Aurora",
                    "conference": "NACC",
                    "firstPlaceVotes": 0,
                    "points": 724
                  },
                  {
                    "rank": 12,
                    "school": "Susquehanna",
                    "conference": "Landmark Conference",
                    "firstPlaceVotes": 0,
                    "points": 688
                  },
                  {
                    "rank": 13,
                    "school": "Wheaton College (Ill)",
                    "conference": "CCIW",
                    "firstPlaceVotes": 0,
                    "points": 619
                  },
                  {
                    "rank": 14,
                    "school": "Alma College",
                    "conference": "Michigan",
                    "firstPlaceVotes": 0,
                    "points": 577
                  },
                  {
                    "rank": 15,
                    "school": "John Carroll",
                    "conference": "Ohio",
                    "firstPlaceVotes": 0,
                    "points": 549
                  },
                  {
                    "rank": 16,
                    "school": "Ithaca",
                    "conference": "Liberty League",
                    "firstPlaceVotes": 0,
                    "points": 457
                  },
                  {
                    "rank": 17,
                    "school": "SUNY Cortland",
                    "conference": "Empire 8",
                    "firstPlaceVotes": 0,
                    "points": 413
                  },
                  {
                    "rank": 18,
                    "school": "Endicott College",
                    "conference": "Commonwealth Coast",
                    "firstPlaceVotes": 0,
                    "points": 342
                  },
                  {
                    "rank": 19,
                    "school": "Hardin-Simmons",
                    "conference": "American Southwest",
                    "firstPlaceVotes": 0,
                    "points": 288
                  },
                  {
                    "rank": 20,
                    "school": "Grove City College",
                    "conference": "Presidents'",
                    "firstPlaceVotes": 0,
                    "points": 275
                  },
                  {
                    "rank": 21,
                    "school": "St. Johns (MN)",
                    "conference": "Minnesota",
                    "firstPlaceVotes": 0,
                    "points": 262
                  },
                  {
                    "rank": 22,
                    "school": "Muhlenberg",
                    "conference": "Centennial",
                    "firstPlaceVotes": 0,
                    "points": 230
                  },
                  {
                    "rank": 23,
                    "school": "DePauw",
                    "conference": "North Coast",
                    "firstPlaceVotes": 0,
                    "points": 183
                  },
                  {
                    "rank": 24,
                    "school": "Delaware Valley",
                    "conference": "Mid Atlantic",
                    "firstPlaceVotes": 0,
                    "points": 114
                  },
                  {
                    "rank": 25,
                    "school": "Berry College",
                    "conference": "Southern Athletic",
                    "firstPlaceVotes": 0,
                    "points": 99
                  }
                ]
              },
              {
                "poll": "Playoff Committee Rankings",
                "ranks": [
                  {
                    "rank": 1,
                    "school": "Ohio State",
                    "conference": "Big Ten",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 2,
                    "school": "Georgia",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 3,
                    "school": "Michigan",
                    "conference": "Big Ten",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 4,
                    "school": "Florida State",
                    "conference": "ACC",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 5,
                    "school": "Washington",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 6,
                    "school": "Oregon",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 7,
                    "school": "Texas",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 8,
                    "school": "Alabama",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 9,
                    "school": "Florida",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 10,
                    "school": "Ole Miss",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 11,
                    "school": "Penn State",
                    "conference": "Big Ten",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 12,
                    "school": "Missouri",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 13,
                    "school": "Louisville",
                    "conference": "ACC",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 14,
                    "school": "LSU",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 15,
                    "school": "Notre Dame",
                    "conference": "FBS Independents",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 16,
                    "school": "Oregon State",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 17,
                    "school": "Tennessee",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 18,
                    "school": "Utah",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 19,
                    "school": "UCLA",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 20,
                    "school": "USC",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 21,
                    "school": "Kansas",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 22,
                    "school": "Oklahoma State",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 23,
                    "school": "Kansas State",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 24,
                    "school": "Tulane",
                    "conference": "American Athletic",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 25,
                    "school": "Air Force",
                    "conference": "Mountain West",
                    "firstPlaceVotes": 0,
                    "points": 0
                  }
                ]
              }
            ]
          }];

        global.fetch = jest.fn(() => Promise.resolve({
            json: () => Promise.resolve(rankings)
        }));

        var resultingScore = await scoringModule.calculateScoreV1(team, game, week);
        expect(resultingScore).toEqual(6);
    });
    
    it('College Football Playoff Berth', async () => {
        const team = "Alabama";
        const game = {
            "_id": {
              "$oid": "65dfd98d1546400b2aeb7cb7"
            },
            "id": 401551786,
            "season": 2023,
            "week": 1,
            "seasonType": "postseason",
            "startDate": "2024-01-01T22:00:00.000Z",
            "startTimeTbd": false,
            "completed": true,
            "neutralSite": true,
            "conferenceGame": false,
            "attendance": null,
            "venueId": 1056,
            "venue": "Rose Bowl",
            "homeId": 130,
            "homeTeam": "Michigan",
            "homeConference": "Big Ten",
            "homeDivision": "fbs",
            "homePoints": 27,
            "homeLineScores": [
              7,
              6,
              0,
              7,
              7
            ],
            "homePostWinProb": "0.9826896588603007",
            "homePregameElo": 2174,
            "homePostgameElo": 2181,
            "awayId": 333,
            "awayTeam": "Alabama",
            "awayConference": "SEC",
            "awayDivision": "fbs",
            "awayPoints": 20,
            "awayLineScores": [
              7,
              3,
              0,
              10,
              0
            ],
            "awayPostWinProb": "0.017310341139699315",
            "awayPregameElo": 2039,
            "awayPostgameElo": 2032,
            "excitementIndex": "8.2128059565",
            "highlights": null,
            "notes": "CFP Semifinal at the Rose Bowl Game Pres. by Prudential"
          };
        const week = 10;
        const rankings = [{
            "_id": {
              "$oid": "65de66651546400b2aeb6e64"
            },
            "season": 2023,
            "seasonType": "regular",
            "week": 10,
            "polls": [
              {
                "poll": "Coaches Poll",
                "ranks": [
                  {
                    "rank": 1,
                    "school": "Georgia",
                    "conference": "SEC",
                    "firstPlaceVotes": 58,
                    "points": 1590
                  },
                  {
                    "rank": 2,
                    "school": "Michigan",
                    "conference": "Big Ten",
                    "firstPlaceVotes": 3,
                    "points": 1520
                  },
                  {
                    "rank": 3,
                    "school": "Ohio State",
                    "conference": "Big Ten",
                    "firstPlaceVotes": 3,
                    "points": 1454
                  },
                  {
                    "rank": 4,
                    "school": "Florida State",
                    "conference": "ACC",
                    "firstPlaceVotes": 0,
                    "points": 1439
                  },
                  {
                    "rank": 5,
                    "school": "Washington",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 1344
                  },
                  {
                    "rank": 6,
                    "school": "Texas",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 1212
                  },
                  {
                    "rank": 7,
                    "school": "Oregon",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 1211
                  },
                  {
                    "rank": 8,
                    "school": "Alabama",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 1187
                  },
                  {
                    "rank": 9,
                    "school": "Penn State",
                    "conference": "Big Ten",
                    "firstPlaceVotes": 0,
                    "points": 1072
                  },
                  {
                    "rank": 10,
                    "school": "Ole Miss",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 1021
                  },
                  {
                    "rank": 11,
                    "school": "Oklahoma",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 948
                  },
                  {
                    "rank": 12,
                    "school": "Notre Dame",
                    "conference": "FBS Independents",
                    "firstPlaceVotes": 0,
                    "points": 847
                  },
                  {
                    "rank": 13,
                    "school": "LSU",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 809
                  },
                  {
                    "rank": 14,
                    "school": "Missouri",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 741
                  },
                  {
                    "rank": 15,
                    "school": "Louisville",
                    "conference": "ACC",
                    "firstPlaceVotes": 0,
                    "points": 701
                  },
                  {
                    "rank": 16,
                    "school": "Tennessee",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 553
                  },
                  {
                    "rank": 17,
                    "school": "Air Force",
                    "conference": "Mountain West",
                    "firstPlaceVotes": 0,
                    "points": 523
                  },
                  {
                    "rank": 18,
                    "school": "Utah",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 509
                  },
                  {
                    "rank": 19,
                    "school": "Oregon State",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 465
                  },
                  {
                    "rank": 20,
                    "school": "UCLA",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 309
                  },
                  {
                    "rank": 21,
                    "school": "Tulane",
                    "conference": "American Athletic",
                    "firstPlaceVotes": 0,
                    "points": 304
                  },
                  {
                    "rank": 22,
                    "school": "USC",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 239
                  },
                  {
                    "rank": 23,
                    "school": "Kansas",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 182
                  },
                  {
                    "rank": 24,
                    "school": "James Madison",
                    "conference": "Sun Belt",
                    "firstPlaceVotes": 0,
                    "points": 169
                  },
                  {
                    "rank": 25,
                    "school": "North Carolina",
                    "conference": "ACC",
                    "firstPlaceVotes": 0,
                    "points": 120
                  }
                ]
              },
              {
                "poll": "AP Top 25",
                "ranks": [
                  {
                    "rank": 1,
                    "school": "Georgia",
                    "conference": "SEC",
                    "firstPlaceVotes": 48,
                    "points": 1553
                  },
                  {
                    "rank": 2,
                    "school": "Michigan",
                    "conference": "Big Ten",
                    "firstPlaceVotes": 9,
                    "points": 1494
                  },
                  {
                    "rank": 3,
                    "school": "Ohio State",
                    "conference": "Big Ten",
                    "firstPlaceVotes": 3,
                    "points": 1446
                  },
                  {
                    "rank": 4,
                    "school": "Florida State",
                    "conference": "ACC",
                    "firstPlaceVotes": 3,
                    "points": 1421
                  },
                  {
                    "rank": 5,
                    "school": "Washington",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 1327
                  },
                  {
                    "rank": 6,
                    "school": "Oregon",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 1235
                  },
                  {
                    "rank": 7,
                    "school": "Texas",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 1189
                  },
                  {
                    "rank": 8,
                    "school": "Alabama",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 1114
                  },
                  {
                    "rank": 9,
                    "school": "Penn State",
                    "conference": "Big Ten",
                    "firstPlaceVotes": 0,
                    "points": 1044
                  },
                  {
                    "rank": 10,
                    "school": "Oklahoma",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 1010
                  },
                  {
                    "rank": 11,
                    "school": "Ole Miss",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 990
                  },
                  {
                    "rank": 12,
                    "school": "Notre Dame",
                    "conference": "FBS Independents",
                    "firstPlaceVotes": 0,
                    "points": 847
                  },
                  {
                    "rank": 13,
                    "school": "LSU",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 816
                  },
                  {
                    "rank": 14,
                    "school": "Missouri",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 714
                  },
                  {
                    "rank": 15,
                    "school": "Louisville",
                    "conference": "ACC",
                    "firstPlaceVotes": 0,
                    "points": 666
                  },
                  {
                    "rank": 16,
                    "school": "Oregon State",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 557
                  },
                  {
                    "rank": 17,
                    "school": "Air Force",
                    "conference": "Mountain West",
                    "firstPlaceVotes": 0,
                    "points": 526
                  },
                  {
                    "rank": 18,
                    "school": "Utah",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 510
                  },
                  {
                    "rank": 19,
                    "school": "Tennessee",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 473
                  },
                  {
                    "rank": 20,
                    "school": "UCLA",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 331
                  },
                  {
                    "rank": 21,
                    "school": "Tulane",
                    "conference": "American Athletic",
                    "firstPlaceVotes": 0,
                    "points": 303
                  },
                  {
                    "rank": 22,
                    "school": "Kansas",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 250
                  },
                  {
                    "rank": 23,
                    "school": "James Madison",
                    "conference": "Sun Belt",
                    "firstPlaceVotes": 0,
                    "points": 192
                  },
                  {
                    "rank": 24,
                    "school": "USC",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 139
                  },
                  {
                    "rank": 25,
                    "school": "Kansas State",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 112
                  }
                ]
              },
              {
                "poll": "FCS Coaches Poll",
                "ranks": [
                  {
                    "rank": 1,
                    "school": "South Dakota State",
                    "conference": "MVFC",
                    "firstPlaceVotes": 25,
                    "points": 625
                  },
                  {
                    "rank": 2,
                    "school": "Furman",
                    "conference": "Southern",
                    "firstPlaceVotes": 0,
                    "points": 577
                  },
                  {
                    "rank": 3,
                    "school": "Montana",
                    "conference": "Big Sky",
                    "firstPlaceVotes": 0,
                    "points": 544
                  },
                  {
                    "rank": 4,
                    "school": "Incarnate Word",
                    "conference": "Southland",
                    "firstPlaceVotes": 0,
                    "points": 533
                  },
                  {
                    "rank": 5,
                    "school": "Idaho",
                    "conference": "Big Sky",
                    "firstPlaceVotes": 0,
                    "points": 515
                  },
                  {
                    "rank": 6,
                    "school": "Delaware",
                    "conference": "CAA",
                    "firstPlaceVotes": 0,
                    "points": 507
                  },
                  {
                    "rank": 7,
                    "school": "Sacramento State",
                    "conference": "Big Sky",
                    "firstPlaceVotes": 0,
                    "points": 471
                  },
                  {
                    "rank": 8,
                    "school": "Montana State",
                    "conference": "Big Sky",
                    "firstPlaceVotes": 0,
                    "points": 458
                  },
                  {
                    "rank": 9,
                    "school": "North Carolina Central",
                    "conference": "MEAC",
                    "firstPlaceVotes": 0,
                    "points": 407
                  },
                  {
                    "rank": 10,
                    "school": "North Dakota State",
                    "conference": "MVFC",
                    "firstPlaceVotes": 0,
                    "points": 398
                  },
                  {
                    "rank": 11,
                    "school": "Southern Illinois",
                    "conference": "MVFC",
                    "firstPlaceVotes": 0,
                    "points": 380
                  },
                  {
                    "rank": 12,
                    "school": "South Dakota",
                    "conference": "MVFC",
                    "firstPlaceVotes": 0,
                    "points": 330
                  },
                  {
                    "rank": 13,
                    "school": "Florida A&M",
                    "conference": "SWAC",
                    "firstPlaceVotes": 0,
                    "points": 296
                  },
                  {
                    "rank": 13,
                    "school": "Chattanooga",
                    "conference": "Southern",
                    "firstPlaceVotes": 0,
                    "points": 296
                  },
                  {
                    "rank": 15,
                    "school": "North Dakota",
                    "conference": "MVFC",
                    "firstPlaceVotes": 0,
                    "points": 260
                  },
                  {
                    "rank": 16,
                    "school": "Lafayette",
                    "conference": "Patriot",
                    "firstPlaceVotes": 0,
                    "points": 241
                  },
                  {
                    "rank": 17,
                    "school": "Austin Peay",
                    "conference": "UAC",
                    "firstPlaceVotes": 0,
                    "points": 218
                  },
                  {
                    "rank": 18,
                    "school": "UT Martin",
                    "conference": "Big South-OVC",
                    "firstPlaceVotes": 0,
                    "points": 179
                  },
                  {
                    "rank": 19,
                    "school": "Harvard",
                    "conference": "Ivy",
                    "firstPlaceVotes": 0,
                    "points": 137
                  },
                  {
                    "rank": 20,
                    "school": "Western Carolina",
                    "conference": "Southern",
                    "firstPlaceVotes": 0,
                    "points": 124
                  },
                  {
                    "rank": 21,
                    "school": "Holy Cross",
                    "conference": "Patriot",
                    "firstPlaceVotes": 0,
                    "points": 120
                  },
                  {
                    "rank": 22,
                    "school": "Villanova",
                    "conference": "CAA",
                    "firstPlaceVotes": 0,
                    "points": 107
                  },
                  {
                    "rank": 23,
                    "school": "Northern Iowa",
                    "conference": "MVFC",
                    "firstPlaceVotes": 0,
                    "points": 105
                  },
                  {
                    "rank": 24,
                    "school": "William & Mary",
                    "conference": "CAA",
                    "firstPlaceVotes": 0,
                    "points": 83
                  },
                  {
                    "rank": 25,
                    "school": "Central Arkansas",
                    "conference": "UAC",
                    "firstPlaceVotes": 0,
                    "points": 73
                  }
                ]
              },
              {
                "poll": "AFCA Division II Coaches Poll",
                "ranks": [
                  {
                    "rank": 1,
                    "school": "Colorado Mines",
                    "conference": "Rocky Mountain",
                    "firstPlaceVotes": 26,
                    "points": 720
                  },
                  {
                    "rank": 2,
                    "school": "Pittsburg State",
                    "conference": "Mid America",
                    "firstPlaceVotes": 1,
                    "points": 694
                  },
                  {
                    "rank": 3,
                    "school": "Grand Valley State",
                    "conference": "GLIAC",
                    "firstPlaceVotes": 1,
                    "points": 662
                  },
                  {
                    "rank": 4,
                    "school": "Harding",
                    "conference": "Great American",
                    "firstPlaceVotes": 0,
                    "points": 637
                  },
                  {
                    "rank": 5,
                    "school": "Slippery Rock",
                    "conference": "Pennsylvania State Athletic",
                    "firstPlaceVotes": 1,
                    "points": 582
                  },
                  {
                    "rank": 6,
                    "school": "Benedict College",
                    "conference": "SIAC",
                    "firstPlaceVotes": 0,
                    "points": 573
                  },
                  {
                    "rank": 7,
                    "school": "Ferris State",
                    "conference": "GLIAC",
                    "firstPlaceVotes": 0,
                    "points": 534
                  },
                  {
                    "rank": 8,
                    "school": "Indianapolis",
                    "conference": "Great Lakes",
                    "firstPlaceVotes": 0,
                    "points": 503
                  },
                  {
                    "rank": 9,
                    "school": "Davenport",
                    "conference": "GLIAC",
                    "firstPlaceVotes": 0,
                    "points": 484
                  },
                  {
                    "rank": 10,
                    "school": "Minnesota State",
                    "conference": "Northern Sun",
                    "firstPlaceVotes": 0,
                    "points": 437
                  },
                  {
                    "rank": 11,
                    "school": "Central Missouri State",
                    "conference": "Mid America",
                    "firstPlaceVotes": 0,
                    "points": 406
                  },
                  {
                    "rank": 12,
                    "school": "Ouachita Baptist",
                    "conference": "Great American",
                    "firstPlaceVotes": 0,
                    "points": 399
                  },
                  {
                    "rank": 13,
                    "school": "Bemidji State",
                    "conference": "Northern Sun",
                    "firstPlaceVotes": 0,
                    "points": 353
                  },
                  {
                    "rank": 14,
                    "school": "Delta State",
                    "conference": "Gulf South",
                    "firstPlaceVotes": 0,
                    "points": 322
                  },
                  {
                    "rank": 15,
                    "school": "Western State",
                    "conference": "Rocky Mountain",
                    "firstPlaceVotes": 0,
                    "points": 321
                  },
                  {
                    "rank": 16,
                    "school": "Lenoir-Rhyne",
                    "conference": "South Atlantic",
                    "firstPlaceVotes": 0,
                    "points": 291
                  },
                  {
                    "rank": 17,
                    "school": "Tiffin",
                    "conference": "Great Midwest Athletic",
                    "firstPlaceVotes": 0,
                    "points": 282
                  },
                  {
                    "rank": 18,
                    "school": "University of Texas of the Permian Basin",
                    "conference": "Lone Star",
                    "firstPlaceVotes": 0,
                    "points": 228
                  },
                  {
                    "rank": 19,
                    "school": "Virginia Union",
                    "conference": "CIAA",
                    "firstPlaceVotes": 0,
                    "points": 210
                  },
                  {
                    "rank": 20,
                    "school": "Valdosta State",
                    "conference": "Gulf South",
                    "firstPlaceVotes": 0,
                    "points": 207
                  },
                  {
                    "rank": 21,
                    "school": "Augustana (SD)",
                    "conference": "Northern Sun",
                    "firstPlaceVotes": 0,
                    "points": 183
                  },
                  {
                    "rank": 22,
                    "school": "Virginia State",
                    "conference": "CIAA",
                    "firstPlaceVotes": 0,
                    "points": 86
                  },
                  {
                    "rank": 23,
                    "school": "Missouri Western",
                    "conference": "Mid America",
                    "firstPlaceVotes": 0,
                    "points": 69
                  },
                  {
                    "rank": 24,
                    "school": "Central Washington",
                    "conference": "Lone Star",
                    "firstPlaceVotes": 0,
                    "points": 54
                  },
                  {
                    "rank": 25,
                    "school": "Mars Hill",
                    "conference": "South Atlantic",
                    "firstPlaceVotes": 0,
                    "points": 43
                  }
                ]
              },
              {
                "poll": "AFCA Division III Coaches Poll",
                "ranks": [
                  {
                    "rank": 1,
                    "school": "North Central",
                    "conference": "CCIW",
                    "firstPlaceVotes": 48,
                    "points": 1224
                  },
                  {
                    "rank": 2,
                    "school": "Mount Union",
                    "conference": "Ohio",
                    "firstPlaceVotes": 1,
                    "points": 1173
                  },
                  {
                    "rank": 3,
                    "school": "Wartburg",
                    "conference": "American Rivers",
                    "firstPlaceVotes": 0,
                    "points": 1120
                  },
                  {
                    "rank": 4,
                    "school": "Linfield",
                    "conference": "Northwest",
                    "firstPlaceVotes": 0,
                    "points": 1024
                  },
                  {
                    "rank": 5,
                    "school": "Trinity (TX)",
                    "conference": "Southern Athletic",
                    "firstPlaceVotes": 0,
                    "points": 986
                  },
                  {
                    "rank": 6,
                    "school": "UW-Whitewater",
                    "conference": "Wisconsin",
                    "firstPlaceVotes": 0,
                    "points": 958
                  },
                  {
                    "rank": 7,
                    "school": "Wisconsin-La Crosse",
                    "conference": "Wisconsin",
                    "firstPlaceVotes": 0,
                    "points": 909
                  },
                  {
                    "rank": 8,
                    "school": "Johns Hopkins",
                    "conference": "Centennial",
                    "firstPlaceVotes": 0,
                    "points": 903
                  },
                  {
                    "rank": 9,
                    "school": "Randolph-Macon",
                    "conference": "Old Dominion",
                    "firstPlaceVotes": 0,
                    "points": 817
                  },
                  {
                    "rank": 10,
                    "school": "UW-River Falls",
                    "conference": "Wisconsin",
                    "firstPlaceVotes": 0,
                    "points": 779
                  },
                  {
                    "rank": 11,
                    "school": "Aurora",
                    "conference": "NACC",
                    "firstPlaceVotes": 0,
                    "points": 724
                  },
                  {
                    "rank": 12,
                    "school": "Susquehanna",
                    "conference": "Landmark Conference",
                    "firstPlaceVotes": 0,
                    "points": 688
                  },
                  {
                    "rank": 13,
                    "school": "Wheaton College (Ill)",
                    "conference": "CCIW",
                    "firstPlaceVotes": 0,
                    "points": 619
                  },
                  {
                    "rank": 14,
                    "school": "Alma College",
                    "conference": "Michigan",
                    "firstPlaceVotes": 0,
                    "points": 577
                  },
                  {
                    "rank": 15,
                    "school": "John Carroll",
                    "conference": "Ohio",
                    "firstPlaceVotes": 0,
                    "points": 549
                  },
                  {
                    "rank": 16,
                    "school": "Ithaca",
                    "conference": "Liberty League",
                    "firstPlaceVotes": 0,
                    "points": 457
                  },
                  {
                    "rank": 17,
                    "school": "SUNY Cortland",
                    "conference": "Empire 8",
                    "firstPlaceVotes": 0,
                    "points": 413
                  },
                  {
                    "rank": 18,
                    "school": "Endicott College",
                    "conference": "Commonwealth Coast",
                    "firstPlaceVotes": 0,
                    "points": 342
                  },
                  {
                    "rank": 19,
                    "school": "Hardin-Simmons",
                    "conference": "American Southwest",
                    "firstPlaceVotes": 0,
                    "points": 288
                  },
                  {
                    "rank": 20,
                    "school": "Grove City College",
                    "conference": "Presidents'",
                    "firstPlaceVotes": 0,
                    "points": 275
                  },
                  {
                    "rank": 21,
                    "school": "St. Johns (MN)",
                    "conference": "Minnesota",
                    "firstPlaceVotes": 0,
                    "points": 262
                  },
                  {
                    "rank": 22,
                    "school": "Muhlenberg",
                    "conference": "Centennial",
                    "firstPlaceVotes": 0,
                    "points": 230
                  },
                  {
                    "rank": 23,
                    "school": "DePauw",
                    "conference": "North Coast",
                    "firstPlaceVotes": 0,
                    "points": 183
                  },
                  {
                    "rank": 24,
                    "school": "Delaware Valley",
                    "conference": "Mid Atlantic",
                    "firstPlaceVotes": 0,
                    "points": 114
                  },
                  {
                    "rank": 25,
                    "school": "Berry College",
                    "conference": "Southern Athletic",
                    "firstPlaceVotes": 0,
                    "points": 99
                  }
                ]
              },
              {
                "poll": "Playoff Committee Rankings",
                "ranks": [
                  {
                    "rank": 1,
                    "school": "Ohio State",
                    "conference": "Big Ten",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 2,
                    "school": "Georgia",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 3,
                    "school": "Michigan",
                    "conference": "Big Ten",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 4,
                    "school": "Florida State",
                    "conference": "ACC",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 5,
                    "school": "Washington",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 6,
                    "school": "Oregon",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 7,
                    "school": "Texas",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 8,
                    "school": "Alabama",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 9,
                    "school": "Florida",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 10,
                    "school": "Ole Miss",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 11,
                    "school": "Penn State",
                    "conference": "Big Ten",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 12,
                    "school": "Missouri",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 13,
                    "school": "Louisville",
                    "conference": "ACC",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 14,
                    "school": "LSU",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 15,
                    "school": "Notre Dame",
                    "conference": "FBS Independents",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 16,
                    "school": "Oregon State",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 17,
                    "school": "Tennessee",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 18,
                    "school": "Utah",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 19,
                    "school": "UCLA",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 20,
                    "school": "USC",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 21,
                    "school": "Kansas",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 22,
                    "school": "Oklahoma State",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 23,
                    "school": "Kansas State",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 24,
                    "school": "Tulane",
                    "conference": "American Athletic",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 25,
                    "school": "Air Force",
                    "conference": "Mountain West",
                    "firstPlaceVotes": 0,
                    "points": 0
                  }
                ]
              }
            ]
          }];

        global.fetch = jest.fn(() => Promise.resolve({
            json: () => Promise.resolve(rankings)
        }));

        var resultingScore = await scoringModule.calculateScoreV1(team, game, week);
        expect(resultingScore).toEqual(7);
    });
    
    it('College Football Playoff Final Win', async () => {
        const team = "Michigan";
        const game = {
            "_id": {
              "$oid": "65dfd98d1546400b2aeb7cba"
            },
            "id": 401551789,
            "season": 2023,
            "week": 1,
            "seasonType": "postseason",
            "startDate": "2024-01-09T00:30:00.000Z",
            "startTimeTbd": false,
            "completed": true,
            "neutralSite": true,
            "conferenceGame": false,
            "attendance": null,
            "venueId": 3891,
            "venue": "NRG Stadium",
            "homeId": 130,
            "homeTeam": "Michigan",
            "homeConference": "Big Ten",
            "homeDivision": "fbs",
            "homePoints": 34,
            "homeLineScores": [
              14,
              3,
              3,
              14
            ],
            "homePostWinProb": "0.9938549482877855",
            "homePregameElo": 2181,
            "homePostgameElo": 2210,
            "awayId": 264,
            "awayTeam": "Washington",
            "awayConference": "Pac-12",
            "awayDivision": "fbs",
            "awayPoints": 13,
            "awayLineScores": [
              3,
              7,
              3,
              0
            ],
            "awayPostWinProb": "0.0061450517122144666",
            "awayPregameElo": 1908,
            "awayPostgameElo": 1879,
            "excitementIndex": "5.6661554258",
            "highlights": null,
            "notes": "CFP National Championship Pres. by AT&T"
          };
        const week = 1;
        const rankings = [{
            "_id": {
              "$oid": "65de66651546400b2aeb6e64"
            },
            "season": 2023,
            "seasonType": "regular",
            "week": 10,
            "polls": [
              {
                "poll": "Coaches Poll",
                "ranks": [
                  {
                    "rank": 1,
                    "school": "Georgia",
                    "conference": "SEC",
                    "firstPlaceVotes": 58,
                    "points": 1590
                  },
                  {
                    "rank": 2,
                    "school": "Michigan",
                    "conference": "Big Ten",
                    "firstPlaceVotes": 3,
                    "points": 1520
                  },
                  {
                    "rank": 3,
                    "school": "Ohio State",
                    "conference": "Big Ten",
                    "firstPlaceVotes": 3,
                    "points": 1454
                  },
                  {
                    "rank": 4,
                    "school": "Florida State",
                    "conference": "ACC",
                    "firstPlaceVotes": 0,
                    "points": 1439
                  },
                  {
                    "rank": 5,
                    "school": "Washington",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 1344
                  },
                  {
                    "rank": 6,
                    "school": "Texas",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 1212
                  },
                  {
                    "rank": 7,
                    "school": "Oregon",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 1211
                  },
                  {
                    "rank": 8,
                    "school": "Alabama",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 1187
                  },
                  {
                    "rank": 9,
                    "school": "Penn State",
                    "conference": "Big Ten",
                    "firstPlaceVotes": 0,
                    "points": 1072
                  },
                  {
                    "rank": 10,
                    "school": "Ole Miss",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 1021
                  },
                  {
                    "rank": 11,
                    "school": "Oklahoma",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 948
                  },
                  {
                    "rank": 12,
                    "school": "Notre Dame",
                    "conference": "FBS Independents",
                    "firstPlaceVotes": 0,
                    "points": 847
                  },
                  {
                    "rank": 13,
                    "school": "LSU",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 809
                  },
                  {
                    "rank": 14,
                    "school": "Missouri",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 741
                  },
                  {
                    "rank": 15,
                    "school": "Louisville",
                    "conference": "ACC",
                    "firstPlaceVotes": 0,
                    "points": 701
                  },
                  {
                    "rank": 16,
                    "school": "Tennessee",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 553
                  },
                  {
                    "rank": 17,
                    "school": "Air Force",
                    "conference": "Mountain West",
                    "firstPlaceVotes": 0,
                    "points": 523
                  },
                  {
                    "rank": 18,
                    "school": "Utah",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 509
                  },
                  {
                    "rank": 19,
                    "school": "Oregon State",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 465
                  },
                  {
                    "rank": 20,
                    "school": "UCLA",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 309
                  },
                  {
                    "rank": 21,
                    "school": "Tulane",
                    "conference": "American Athletic",
                    "firstPlaceVotes": 0,
                    "points": 304
                  },
                  {
                    "rank": 22,
                    "school": "USC",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 239
                  },
                  {
                    "rank": 23,
                    "school": "Kansas",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 182
                  },
                  {
                    "rank": 24,
                    "school": "James Madison",
                    "conference": "Sun Belt",
                    "firstPlaceVotes": 0,
                    "points": 169
                  },
                  {
                    "rank": 25,
                    "school": "North Carolina",
                    "conference": "ACC",
                    "firstPlaceVotes": 0,
                    "points": 120
                  }
                ]
              },
              {
                "poll": "AP Top 25",
                "ranks": [
                  {
                    "rank": 1,
                    "school": "Georgia",
                    "conference": "SEC",
                    "firstPlaceVotes": 48,
                    "points": 1553
                  },
                  {
                    "rank": 2,
                    "school": "Michigan",
                    "conference": "Big Ten",
                    "firstPlaceVotes": 9,
                    "points": 1494
                  },
                  {
                    "rank": 3,
                    "school": "Ohio State",
                    "conference": "Big Ten",
                    "firstPlaceVotes": 3,
                    "points": 1446
                  },
                  {
                    "rank": 4,
                    "school": "Florida State",
                    "conference": "ACC",
                    "firstPlaceVotes": 3,
                    "points": 1421
                  },
                  {
                    "rank": 5,
                    "school": "Washington",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 1327
                  },
                  {
                    "rank": 6,
                    "school": "Oregon",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 1235
                  },
                  {
                    "rank": 7,
                    "school": "Texas",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 1189
                  },
                  {
                    "rank": 8,
                    "school": "Alabama",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 1114
                  },
                  {
                    "rank": 9,
                    "school": "Penn State",
                    "conference": "Big Ten",
                    "firstPlaceVotes": 0,
                    "points": 1044
                  },
                  {
                    "rank": 10,
                    "school": "Oklahoma",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 1010
                  },
                  {
                    "rank": 11,
                    "school": "Ole Miss",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 990
                  },
                  {
                    "rank": 12,
                    "school": "Notre Dame",
                    "conference": "FBS Independents",
                    "firstPlaceVotes": 0,
                    "points": 847
                  },
                  {
                    "rank": 13,
                    "school": "LSU",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 816
                  },
                  {
                    "rank": 14,
                    "school": "Missouri",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 714
                  },
                  {
                    "rank": 15,
                    "school": "Louisville",
                    "conference": "ACC",
                    "firstPlaceVotes": 0,
                    "points": 666
                  },
                  {
                    "rank": 16,
                    "school": "Oregon State",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 557
                  },
                  {
                    "rank": 17,
                    "school": "Air Force",
                    "conference": "Mountain West",
                    "firstPlaceVotes": 0,
                    "points": 526
                  },
                  {
                    "rank": 18,
                    "school": "Utah",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 510
                  },
                  {
                    "rank": 19,
                    "school": "Tennessee",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 473
                  },
                  {
                    "rank": 20,
                    "school": "UCLA",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 331
                  },
                  {
                    "rank": 21,
                    "school": "Tulane",
                    "conference": "American Athletic",
                    "firstPlaceVotes": 0,
                    "points": 303
                  },
                  {
                    "rank": 22,
                    "school": "Kansas",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 250
                  },
                  {
                    "rank": 23,
                    "school": "James Madison",
                    "conference": "Sun Belt",
                    "firstPlaceVotes": 0,
                    "points": 192
                  },
                  {
                    "rank": 24,
                    "school": "USC",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 139
                  },
                  {
                    "rank": 25,
                    "school": "Kansas State",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 112
                  }
                ]
              },
              {
                "poll": "FCS Coaches Poll",
                "ranks": [
                  {
                    "rank": 1,
                    "school": "South Dakota State",
                    "conference": "MVFC",
                    "firstPlaceVotes": 25,
                    "points": 625
                  },
                  {
                    "rank": 2,
                    "school": "Furman",
                    "conference": "Southern",
                    "firstPlaceVotes": 0,
                    "points": 577
                  },
                  {
                    "rank": 3,
                    "school": "Montana",
                    "conference": "Big Sky",
                    "firstPlaceVotes": 0,
                    "points": 544
                  },
                  {
                    "rank": 4,
                    "school": "Incarnate Word",
                    "conference": "Southland",
                    "firstPlaceVotes": 0,
                    "points": 533
                  },
                  {
                    "rank": 5,
                    "school": "Idaho",
                    "conference": "Big Sky",
                    "firstPlaceVotes": 0,
                    "points": 515
                  },
                  {
                    "rank": 6,
                    "school": "Delaware",
                    "conference": "CAA",
                    "firstPlaceVotes": 0,
                    "points": 507
                  },
                  {
                    "rank": 7,
                    "school": "Sacramento State",
                    "conference": "Big Sky",
                    "firstPlaceVotes": 0,
                    "points": 471
                  },
                  {
                    "rank": 8,
                    "school": "Montana State",
                    "conference": "Big Sky",
                    "firstPlaceVotes": 0,
                    "points": 458
                  },
                  {
                    "rank": 9,
                    "school": "North Carolina Central",
                    "conference": "MEAC",
                    "firstPlaceVotes": 0,
                    "points": 407
                  },
                  {
                    "rank": 10,
                    "school": "North Dakota State",
                    "conference": "MVFC",
                    "firstPlaceVotes": 0,
                    "points": 398
                  },
                  {
                    "rank": 11,
                    "school": "Southern Illinois",
                    "conference": "MVFC",
                    "firstPlaceVotes": 0,
                    "points": 380
                  },
                  {
                    "rank": 12,
                    "school": "South Dakota",
                    "conference": "MVFC",
                    "firstPlaceVotes": 0,
                    "points": 330
                  },
                  {
                    "rank": 13,
                    "school": "Florida A&M",
                    "conference": "SWAC",
                    "firstPlaceVotes": 0,
                    "points": 296
                  },
                  {
                    "rank": 13,
                    "school": "Chattanooga",
                    "conference": "Southern",
                    "firstPlaceVotes": 0,
                    "points": 296
                  },
                  {
                    "rank": 15,
                    "school": "North Dakota",
                    "conference": "MVFC",
                    "firstPlaceVotes": 0,
                    "points": 260
                  },
                  {
                    "rank": 16,
                    "school": "Lafayette",
                    "conference": "Patriot",
                    "firstPlaceVotes": 0,
                    "points": 241
                  },
                  {
                    "rank": 17,
                    "school": "Austin Peay",
                    "conference": "UAC",
                    "firstPlaceVotes": 0,
                    "points": 218
                  },
                  {
                    "rank": 18,
                    "school": "UT Martin",
                    "conference": "Big South-OVC",
                    "firstPlaceVotes": 0,
                    "points": 179
                  },
                  {
                    "rank": 19,
                    "school": "Harvard",
                    "conference": "Ivy",
                    "firstPlaceVotes": 0,
                    "points": 137
                  },
                  {
                    "rank": 20,
                    "school": "Western Carolina",
                    "conference": "Southern",
                    "firstPlaceVotes": 0,
                    "points": 124
                  },
                  {
                    "rank": 21,
                    "school": "Holy Cross",
                    "conference": "Patriot",
                    "firstPlaceVotes": 0,
                    "points": 120
                  },
                  {
                    "rank": 22,
                    "school": "Villanova",
                    "conference": "CAA",
                    "firstPlaceVotes": 0,
                    "points": 107
                  },
                  {
                    "rank": 23,
                    "school": "Northern Iowa",
                    "conference": "MVFC",
                    "firstPlaceVotes": 0,
                    "points": 105
                  },
                  {
                    "rank": 24,
                    "school": "William & Mary",
                    "conference": "CAA",
                    "firstPlaceVotes": 0,
                    "points": 83
                  },
                  {
                    "rank": 25,
                    "school": "Central Arkansas",
                    "conference": "UAC",
                    "firstPlaceVotes": 0,
                    "points": 73
                  }
                ]
              },
              {
                "poll": "AFCA Division II Coaches Poll",
                "ranks": [
                  {
                    "rank": 1,
                    "school": "Colorado Mines",
                    "conference": "Rocky Mountain",
                    "firstPlaceVotes": 26,
                    "points": 720
                  },
                  {
                    "rank": 2,
                    "school": "Pittsburg State",
                    "conference": "Mid America",
                    "firstPlaceVotes": 1,
                    "points": 694
                  },
                  {
                    "rank": 3,
                    "school": "Grand Valley State",
                    "conference": "GLIAC",
                    "firstPlaceVotes": 1,
                    "points": 662
                  },
                  {
                    "rank": 4,
                    "school": "Harding",
                    "conference": "Great American",
                    "firstPlaceVotes": 0,
                    "points": 637
                  },
                  {
                    "rank": 5,
                    "school": "Slippery Rock",
                    "conference": "Pennsylvania State Athletic",
                    "firstPlaceVotes": 1,
                    "points": 582
                  },
                  {
                    "rank": 6,
                    "school": "Benedict College",
                    "conference": "SIAC",
                    "firstPlaceVotes": 0,
                    "points": 573
                  },
                  {
                    "rank": 7,
                    "school": "Ferris State",
                    "conference": "GLIAC",
                    "firstPlaceVotes": 0,
                    "points": 534
                  },
                  {
                    "rank": 8,
                    "school": "Indianapolis",
                    "conference": "Great Lakes",
                    "firstPlaceVotes": 0,
                    "points": 503
                  },
                  {
                    "rank": 9,
                    "school": "Davenport",
                    "conference": "GLIAC",
                    "firstPlaceVotes": 0,
                    "points": 484
                  },
                  {
                    "rank": 10,
                    "school": "Minnesota State",
                    "conference": "Northern Sun",
                    "firstPlaceVotes": 0,
                    "points": 437
                  },
                  {
                    "rank": 11,
                    "school": "Central Missouri State",
                    "conference": "Mid America",
                    "firstPlaceVotes": 0,
                    "points": 406
                  },
                  {
                    "rank": 12,
                    "school": "Ouachita Baptist",
                    "conference": "Great American",
                    "firstPlaceVotes": 0,
                    "points": 399
                  },
                  {
                    "rank": 13,
                    "school": "Bemidji State",
                    "conference": "Northern Sun",
                    "firstPlaceVotes": 0,
                    "points": 353
                  },
                  {
                    "rank": 14,
                    "school": "Delta State",
                    "conference": "Gulf South",
                    "firstPlaceVotes": 0,
                    "points": 322
                  },
                  {
                    "rank": 15,
                    "school": "Western State",
                    "conference": "Rocky Mountain",
                    "firstPlaceVotes": 0,
                    "points": 321
                  },
                  {
                    "rank": 16,
                    "school": "Lenoir-Rhyne",
                    "conference": "South Atlantic",
                    "firstPlaceVotes": 0,
                    "points": 291
                  },
                  {
                    "rank": 17,
                    "school": "Tiffin",
                    "conference": "Great Midwest Athletic",
                    "firstPlaceVotes": 0,
                    "points": 282
                  },
                  {
                    "rank": 18,
                    "school": "University of Texas of the Permian Basin",
                    "conference": "Lone Star",
                    "firstPlaceVotes": 0,
                    "points": 228
                  },
                  {
                    "rank": 19,
                    "school": "Virginia Union",
                    "conference": "CIAA",
                    "firstPlaceVotes": 0,
                    "points": 210
                  },
                  {
                    "rank": 20,
                    "school": "Valdosta State",
                    "conference": "Gulf South",
                    "firstPlaceVotes": 0,
                    "points": 207
                  },
                  {
                    "rank": 21,
                    "school": "Augustana (SD)",
                    "conference": "Northern Sun",
                    "firstPlaceVotes": 0,
                    "points": 183
                  },
                  {
                    "rank": 22,
                    "school": "Virginia State",
                    "conference": "CIAA",
                    "firstPlaceVotes": 0,
                    "points": 86
                  },
                  {
                    "rank": 23,
                    "school": "Missouri Western",
                    "conference": "Mid America",
                    "firstPlaceVotes": 0,
                    "points": 69
                  },
                  {
                    "rank": 24,
                    "school": "Central Washington",
                    "conference": "Lone Star",
                    "firstPlaceVotes": 0,
                    "points": 54
                  },
                  {
                    "rank": 25,
                    "school": "Mars Hill",
                    "conference": "South Atlantic",
                    "firstPlaceVotes": 0,
                    "points": 43
                  }
                ]
              },
              {
                "poll": "AFCA Division III Coaches Poll",
                "ranks": [
                  {
                    "rank": 1,
                    "school": "North Central",
                    "conference": "CCIW",
                    "firstPlaceVotes": 48,
                    "points": 1224
                  },
                  {
                    "rank": 2,
                    "school": "Mount Union",
                    "conference": "Ohio",
                    "firstPlaceVotes": 1,
                    "points": 1173
                  },
                  {
                    "rank": 3,
                    "school": "Wartburg",
                    "conference": "American Rivers",
                    "firstPlaceVotes": 0,
                    "points": 1120
                  },
                  {
                    "rank": 4,
                    "school": "Linfield",
                    "conference": "Northwest",
                    "firstPlaceVotes": 0,
                    "points": 1024
                  },
                  {
                    "rank": 5,
                    "school": "Trinity (TX)",
                    "conference": "Southern Athletic",
                    "firstPlaceVotes": 0,
                    "points": 986
                  },
                  {
                    "rank": 6,
                    "school": "UW-Whitewater",
                    "conference": "Wisconsin",
                    "firstPlaceVotes": 0,
                    "points": 958
                  },
                  {
                    "rank": 7,
                    "school": "Wisconsin-La Crosse",
                    "conference": "Wisconsin",
                    "firstPlaceVotes": 0,
                    "points": 909
                  },
                  {
                    "rank": 8,
                    "school": "Johns Hopkins",
                    "conference": "Centennial",
                    "firstPlaceVotes": 0,
                    "points": 903
                  },
                  {
                    "rank": 9,
                    "school": "Randolph-Macon",
                    "conference": "Old Dominion",
                    "firstPlaceVotes": 0,
                    "points": 817
                  },
                  {
                    "rank": 10,
                    "school": "UW-River Falls",
                    "conference": "Wisconsin",
                    "firstPlaceVotes": 0,
                    "points": 779
                  },
                  {
                    "rank": 11,
                    "school": "Aurora",
                    "conference": "NACC",
                    "firstPlaceVotes": 0,
                    "points": 724
                  },
                  {
                    "rank": 12,
                    "school": "Susquehanna",
                    "conference": "Landmark Conference",
                    "firstPlaceVotes": 0,
                    "points": 688
                  },
                  {
                    "rank": 13,
                    "school": "Wheaton College (Ill)",
                    "conference": "CCIW",
                    "firstPlaceVotes": 0,
                    "points": 619
                  },
                  {
                    "rank": 14,
                    "school": "Alma College",
                    "conference": "Michigan",
                    "firstPlaceVotes": 0,
                    "points": 577
                  },
                  {
                    "rank": 15,
                    "school": "John Carroll",
                    "conference": "Ohio",
                    "firstPlaceVotes": 0,
                    "points": 549
                  },
                  {
                    "rank": 16,
                    "school": "Ithaca",
                    "conference": "Liberty League",
                    "firstPlaceVotes": 0,
                    "points": 457
                  },
                  {
                    "rank": 17,
                    "school": "SUNY Cortland",
                    "conference": "Empire 8",
                    "firstPlaceVotes": 0,
                    "points": 413
                  },
                  {
                    "rank": 18,
                    "school": "Endicott College",
                    "conference": "Commonwealth Coast",
                    "firstPlaceVotes": 0,
                    "points": 342
                  },
                  {
                    "rank": 19,
                    "school": "Hardin-Simmons",
                    "conference": "American Southwest",
                    "firstPlaceVotes": 0,
                    "points": 288
                  },
                  {
                    "rank": 20,
                    "school": "Grove City College",
                    "conference": "Presidents'",
                    "firstPlaceVotes": 0,
                    "points": 275
                  },
                  {
                    "rank": 21,
                    "school": "St. Johns (MN)",
                    "conference": "Minnesota",
                    "firstPlaceVotes": 0,
                    "points": 262
                  },
                  {
                    "rank": 22,
                    "school": "Muhlenberg",
                    "conference": "Centennial",
                    "firstPlaceVotes": 0,
                    "points": 230
                  },
                  {
                    "rank": 23,
                    "school": "DePauw",
                    "conference": "North Coast",
                    "firstPlaceVotes": 0,
                    "points": 183
                  },
                  {
                    "rank": 24,
                    "school": "Delaware Valley",
                    "conference": "Mid Atlantic",
                    "firstPlaceVotes": 0,
                    "points": 114
                  },
                  {
                    "rank": 25,
                    "school": "Berry College",
                    "conference": "Southern Athletic",
                    "firstPlaceVotes": 0,
                    "points": 99
                  }
                ]
              },
              {
                "poll": "Playoff Committee Rankings",
                "ranks": [
                  {
                    "rank": 1,
                    "school": "Ohio State",
                    "conference": "Big Ten",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 2,
                    "school": "Georgia",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 3,
                    "school": "Michigan",
                    "conference": "Big Ten",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 4,
                    "school": "Florida State",
                    "conference": "ACC",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 5,
                    "school": "Washington",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 6,
                    "school": "Oregon",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 7,
                    "school": "Texas",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 8,
                    "school": "Alabama",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 9,
                    "school": "Florida",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 10,
                    "school": "Ole Miss",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 11,
                    "school": "Penn State",
                    "conference": "Big Ten",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 12,
                    "school": "Missouri",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 13,
                    "school": "Louisville",
                    "conference": "ACC",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 14,
                    "school": "LSU",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 15,
                    "school": "Notre Dame",
                    "conference": "FBS Independents",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 16,
                    "school": "Oregon State",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 17,
                    "school": "Tennessee",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 18,
                    "school": "Utah",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 19,
                    "school": "UCLA",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 20,
                    "school": "USC",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 21,
                    "school": "Kansas",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 22,
                    "school": "Oklahoma State",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 23,
                    "school": "Kansas State",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 24,
                    "school": "Tulane",
                    "conference": "American Athletic",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 25,
                    "school": "Air Force",
                    "conference": "Mountain West",
                    "firstPlaceVotes": 0,
                    "points": 0
                  }
                ]
              }
            ]
          }];

        global.fetch = jest.fn(() => Promise.resolve({
            json: () => Promise.resolve(rankings)
        }));

        var resultingScore = await scoringModule.calculateScoreV1(team, game, week);
        expect(resultingScore).toEqual(10);
    });
});

describe('Graham Scoring Test Suite', () => {
    it('Non-Conference Unranked Game Loss', async () => {
        const team = "University of Central Florida";
        const game = {
            "_id": {
              "$oid": "65dfd87c1546400b2aeb7975"
            },
            "id": 401520363,
            "season": 2023,
            "week": 10,
            "seasonType": "regular",
            "startDate": "2023-11-04T16:00:00.000Z",
            "startTimeTbd": false,
            "completed": true,
            "neutralSite": false,
            "conferenceGame": false,
            "attendance": 89782,
            "venueId": 3634,
            "venue": "Bounce House",
            "homeId": 57,
            "homeTeam": "University of Central Florida",
            "homeConference": "Big 12",
            "homeDivision": "fbs",
            "homePoints": 36,
            "homeLineScores": [
              14,
              3,
              6,
              10,
              3
            ],
            "homePostWinProb": "0.08075347362469056",
            "homePregameElo": 1592,
            "homePostgameElo": 1588,
            "awayId": 8,
            "awayTeam": "Arkansas",
            "awayConference": "SEC",
            "awayDivision": "fbs",
            "awayPoints": 39,
            "awayLineScores": [
              14,
              3,
              3,
              13,
              6
            ],
            "awayPostWinProb": "0.9192465263753095",
            "awayPregameElo": 1596,
            "awayPostgameElo": 1600,
            "excitementIndex": "9.7718678848",
            "highlights": null,
            "notes": "test Arkansas game notes"
          };
        const week = 10;
        const rankings = [{
            "_id": {
              "$oid": "65de66651546400b2aeb6e64"
            },
            "season": 2023,
            "seasonType": "regular",
            "week": 10,
            "polls": [
              {
                "poll": "Coaches Poll",
                "ranks": [
                  {
                    "rank": 1,
                    "school": "Georgia",
                    "conference": "SEC",
                    "firstPlaceVotes": 58,
                    "points": 1590
                  },
                  {
                    "rank": 2,
                    "school": "Michigan",
                    "conference": "Big Ten",
                    "firstPlaceVotes": 3,
                    "points": 1520
                  },
                  {
                    "rank": 3,
                    "school": "Ohio State",
                    "conference": "Big Ten",
                    "firstPlaceVotes": 3,
                    "points": 1454
                  },
                  {
                    "rank": 4,
                    "school": "Florida State",
                    "conference": "ACC",
                    "firstPlaceVotes": 0,
                    "points": 1439
                  },
                  {
                    "rank": 5,
                    "school": "Washington",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 1344
                  },
                  {
                    "rank": 6,
                    "school": "Texas",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 1212
                  },
                  {
                    "rank": 7,
                    "school": "Oregon",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 1211
                  },
                  {
                    "rank": 8,
                    "school": "Alabama",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 1187
                  },
                  {
                    "rank": 9,
                    "school": "Penn State",
                    "conference": "Big Ten",
                    "firstPlaceVotes": 0,
                    "points": 1072
                  },
                  {
                    "rank": 10,
                    "school": "Ole Miss",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 1021
                  },
                  {
                    "rank": 11,
                    "school": "Oklahoma",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 948
                  },
                  {
                    "rank": 12,
                    "school": "Notre Dame",
                    "conference": "FBS Independents",
                    "firstPlaceVotes": 0,
                    "points": 847
                  },
                  {
                    "rank": 13,
                    "school": "LSU",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 809
                  },
                  {
                    "rank": 14,
                    "school": "Missouri",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 741
                  },
                  {
                    "rank": 15,
                    "school": "Louisville",
                    "conference": "ACC",
                    "firstPlaceVotes": 0,
                    "points": 701
                  },
                  {
                    "rank": 16,
                    "school": "Tennessee",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 553
                  },
                  {
                    "rank": 17,
                    "school": "Air Force",
                    "conference": "Mountain West",
                    "firstPlaceVotes": 0,
                    "points": 523
                  },
                  {
                    "rank": 18,
                    "school": "Utah",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 509
                  },
                  {
                    "rank": 19,
                    "school": "Oregon State",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 465
                  },
                  {
                    "rank": 20,
                    "school": "UCLA",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 309
                  },
                  {
                    "rank": 21,
                    "school": "Tulane",
                    "conference": "American Athletic",
                    "firstPlaceVotes": 0,
                    "points": 304
                  },
                  {
                    "rank": 22,
                    "school": "USC",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 239
                  },
                  {
                    "rank": 23,
                    "school": "Kansas",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 182
                  },
                  {
                    "rank": 24,
                    "school": "James Madison",
                    "conference": "Sun Belt",
                    "firstPlaceVotes": 0,
                    "points": 169
                  },
                  {
                    "rank": 25,
                    "school": "North Carolina",
                    "conference": "ACC",
                    "firstPlaceVotes": 0,
                    "points": 120
                  }
                ]
              },
              {
                "poll": "AP Top 25",
                "ranks": [
                  {
                    "rank": 1,
                    "school": "Georgia",
                    "conference": "SEC",
                    "firstPlaceVotes": 48,
                    "points": 1553
                  },
                  {
                    "rank": 2,
                    "school": "Michigan",
                    "conference": "Big Ten",
                    "firstPlaceVotes": 9,
                    "points": 1494
                  },
                  {
                    "rank": 3,
                    "school": "Ohio State",
                    "conference": "Big Ten",
                    "firstPlaceVotes": 3,
                    "points": 1446
                  },
                  {
                    "rank": 4,
                    "school": "Florida State",
                    "conference": "ACC",
                    "firstPlaceVotes": 3,
                    "points": 1421
                  },
                  {
                    "rank": 5,
                    "school": "Washington",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 1327
                  },
                  {
                    "rank": 6,
                    "school": "Oregon",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 1235
                  },
                  {
                    "rank": 7,
                    "school": "Texas",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 1189
                  },
                  {
                    "rank": 8,
                    "school": "Alabama",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 1114
                  },
                  {
                    "rank": 9,
                    "school": "Penn State",
                    "conference": "Big Ten",
                    "firstPlaceVotes": 0,
                    "points": 1044
                  },
                  {
                    "rank": 10,
                    "school": "Oklahoma",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 1010
                  },
                  {
                    "rank": 11,
                    "school": "Ole Miss",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 990
                  },
                  {
                    "rank": 12,
                    "school": "Notre Dame",
                    "conference": "FBS Independents",
                    "firstPlaceVotes": 0,
                    "points": 847
                  },
                  {
                    "rank": 13,
                    "school": "LSU",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 816
                  },
                  {
                    "rank": 14,
                    "school": "Missouri",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 714
                  },
                  {
                    "rank": 15,
                    "school": "Louisville",
                    "conference": "ACC",
                    "firstPlaceVotes": 0,
                    "points": 666
                  },
                  {
                    "rank": 16,
                    "school": "Oregon State",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 557
                  },
                  {
                    "rank": 17,
                    "school": "Air Force",
                    "conference": "Mountain West",
                    "firstPlaceVotes": 0,
                    "points": 526
                  },
                  {
                    "rank": 18,
                    "school": "Utah",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 510
                  },
                  {
                    "rank": 19,
                    "school": "Tennessee",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 473
                  },
                  {
                    "rank": 20,
                    "school": "UCLA",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 331
                  },
                  {
                    "rank": 21,
                    "school": "Tulane",
                    "conference": "American Athletic",
                    "firstPlaceVotes": 0,
                    "points": 303
                  },
                  {
                    "rank": 22,
                    "school": "Kansas",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 250
                  },
                  {
                    "rank": 23,
                    "school": "James Madison",
                    "conference": "Sun Belt",
                    "firstPlaceVotes": 0,
                    "points": 192
                  },
                  {
                    "rank": 24,
                    "school": "USC",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 139
                  },
                  {
                    "rank": 25,
                    "school": "Kansas State",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 112
                  }
                ]
              },
              {
                "poll": "FCS Coaches Poll",
                "ranks": [
                  {
                    "rank": 1,
                    "school": "South Dakota State",
                    "conference": "MVFC",
                    "firstPlaceVotes": 25,
                    "points": 625
                  },
                  {
                    "rank": 2,
                    "school": "Furman",
                    "conference": "Southern",
                    "firstPlaceVotes": 0,
                    "points": 577
                  },
                  {
                    "rank": 3,
                    "school": "Montana",
                    "conference": "Big Sky",
                    "firstPlaceVotes": 0,
                    "points": 544
                  },
                  {
                    "rank": 4,
                    "school": "Incarnate Word",
                    "conference": "Southland",
                    "firstPlaceVotes": 0,
                    "points": 533
                  },
                  {
                    "rank": 5,
                    "school": "Idaho",
                    "conference": "Big Sky",
                    "firstPlaceVotes": 0,
                    "points": 515
                  },
                  {
                    "rank": 6,
                    "school": "Delaware",
                    "conference": "CAA",
                    "firstPlaceVotes": 0,
                    "points": 507
                  },
                  {
                    "rank": 7,
                    "school": "Sacramento State",
                    "conference": "Big Sky",
                    "firstPlaceVotes": 0,
                    "points": 471
                  },
                  {
                    "rank": 8,
                    "school": "Montana State",
                    "conference": "Big Sky",
                    "firstPlaceVotes": 0,
                    "points": 458
                  },
                  {
                    "rank": 9,
                    "school": "North Carolina Central",
                    "conference": "MEAC",
                    "firstPlaceVotes": 0,
                    "points": 407
                  },
                  {
                    "rank": 10,
                    "school": "North Dakota State",
                    "conference": "MVFC",
                    "firstPlaceVotes": 0,
                    "points": 398
                  },
                  {
                    "rank": 11,
                    "school": "Southern Illinois",
                    "conference": "MVFC",
                    "firstPlaceVotes": 0,
                    "points": 380
                  },
                  {
                    "rank": 12,
                    "school": "South Dakota",
                    "conference": "MVFC",
                    "firstPlaceVotes": 0,
                    "points": 330
                  },
                  {
                    "rank": 13,
                    "school": "Florida A&M",
                    "conference": "SWAC",
                    "firstPlaceVotes": 0,
                    "points": 296
                  },
                  {
                    "rank": 13,
                    "school": "Chattanooga",
                    "conference": "Southern",
                    "firstPlaceVotes": 0,
                    "points": 296
                  },
                  {
                    "rank": 15,
                    "school": "North Dakota",
                    "conference": "MVFC",
                    "firstPlaceVotes": 0,
                    "points": 260
                  },
                  {
                    "rank": 16,
                    "school": "Lafayette",
                    "conference": "Patriot",
                    "firstPlaceVotes": 0,
                    "points": 241
                  },
                  {
                    "rank": 17,
                    "school": "Austin Peay",
                    "conference": "UAC",
                    "firstPlaceVotes": 0,
                    "points": 218
                  },
                  {
                    "rank": 18,
                    "school": "UT Martin",
                    "conference": "Big South-OVC",
                    "firstPlaceVotes": 0,
                    "points": 179
                  },
                  {
                    "rank": 19,
                    "school": "Harvard",
                    "conference": "Ivy",
                    "firstPlaceVotes": 0,
                    "points": 137
                  },
                  {
                    "rank": 20,
                    "school": "Western Carolina",
                    "conference": "Southern",
                    "firstPlaceVotes": 0,
                    "points": 124
                  },
                  {
                    "rank": 21,
                    "school": "Holy Cross",
                    "conference": "Patriot",
                    "firstPlaceVotes": 0,
                    "points": 120
                  },
                  {
                    "rank": 22,
                    "school": "Villanova",
                    "conference": "CAA",
                    "firstPlaceVotes": 0,
                    "points": 107
                  },
                  {
                    "rank": 23,
                    "school": "Northern Iowa",
                    "conference": "MVFC",
                    "firstPlaceVotes": 0,
                    "points": 105
                  },
                  {
                    "rank": 24,
                    "school": "William & Mary",
                    "conference": "CAA",
                    "firstPlaceVotes": 0,
                    "points": 83
                  },
                  {
                    "rank": 25,
                    "school": "Central Arkansas",
                    "conference": "UAC",
                    "firstPlaceVotes": 0,
                    "points": 73
                  }
                ]
              },
              {
                "poll": "AFCA Division II Coaches Poll",
                "ranks": [
                  {
                    "rank": 1,
                    "school": "Colorado Mines",
                    "conference": "Rocky Mountain",
                    "firstPlaceVotes": 26,
                    "points": 720
                  },
                  {
                    "rank": 2,
                    "school": "Pittsburg State",
                    "conference": "Mid America",
                    "firstPlaceVotes": 1,
                    "points": 694
                  },
                  {
                    "rank": 3,
                    "school": "Grand Valley State",
                    "conference": "GLIAC",
                    "firstPlaceVotes": 1,
                    "points": 662
                  },
                  {
                    "rank": 4,
                    "school": "Harding",
                    "conference": "Great American",
                    "firstPlaceVotes": 0,
                    "points": 637
                  },
                  {
                    "rank": 5,
                    "school": "Slippery Rock",
                    "conference": "Pennsylvania State Athletic",
                    "firstPlaceVotes": 1,
                    "points": 582
                  },
                  {
                    "rank": 6,
                    "school": "Benedict College",
                    "conference": "SIAC",
                    "firstPlaceVotes": 0,
                    "points": 573
                  },
                  {
                    "rank": 7,
                    "school": "Ferris State",
                    "conference": "GLIAC",
                    "firstPlaceVotes": 0,
                    "points": 534
                  },
                  {
                    "rank": 8,
                    "school": "Indianapolis",
                    "conference": "Great Lakes",
                    "firstPlaceVotes": 0,
                    "points": 503
                  },
                  {
                    "rank": 9,
                    "school": "Davenport",
                    "conference": "GLIAC",
                    "firstPlaceVotes": 0,
                    "points": 484
                  },
                  {
                    "rank": 10,
                    "school": "Minnesota State",
                    "conference": "Northern Sun",
                    "firstPlaceVotes": 0,
                    "points": 437
                  },
                  {
                    "rank": 11,
                    "school": "Central Missouri State",
                    "conference": "Mid America",
                    "firstPlaceVotes": 0,
                    "points": 406
                  },
                  {
                    "rank": 12,
                    "school": "Ouachita Baptist",
                    "conference": "Great American",
                    "firstPlaceVotes": 0,
                    "points": 399
                  },
                  {
                    "rank": 13,
                    "school": "Bemidji State",
                    "conference": "Northern Sun",
                    "firstPlaceVotes": 0,
                    "points": 353
                  },
                  {
                    "rank": 14,
                    "school": "Delta State",
                    "conference": "Gulf South",
                    "firstPlaceVotes": 0,
                    "points": 322
                  },
                  {
                    "rank": 15,
                    "school": "Western State",
                    "conference": "Rocky Mountain",
                    "firstPlaceVotes": 0,
                    "points": 321
                  },
                  {
                    "rank": 16,
                    "school": "Lenoir-Rhyne",
                    "conference": "South Atlantic",
                    "firstPlaceVotes": 0,
                    "points": 291
                  },
                  {
                    "rank": 17,
                    "school": "Tiffin",
                    "conference": "Great Midwest Athletic",
                    "firstPlaceVotes": 0,
                    "points": 282
                  },
                  {
                    "rank": 18,
                    "school": "University of Texas of the Permian Basin",
                    "conference": "Lone Star",
                    "firstPlaceVotes": 0,
                    "points": 228
                  },
                  {
                    "rank": 19,
                    "school": "Virginia Union",
                    "conference": "CIAA",
                    "firstPlaceVotes": 0,
                    "points": 210
                  },
                  {
                    "rank": 20,
                    "school": "Valdosta State",
                    "conference": "Gulf South",
                    "firstPlaceVotes": 0,
                    "points": 207
                  },
                  {
                    "rank": 21,
                    "school": "Augustana (SD)",
                    "conference": "Northern Sun",
                    "firstPlaceVotes": 0,
                    "points": 183
                  },
                  {
                    "rank": 22,
                    "school": "Virginia State",
                    "conference": "CIAA",
                    "firstPlaceVotes": 0,
                    "points": 86
                  },
                  {
                    "rank": 23,
                    "school": "Missouri Western",
                    "conference": "Mid America",
                    "firstPlaceVotes": 0,
                    "points": 69
                  },
                  {
                    "rank": 24,
                    "school": "Central Washington",
                    "conference": "Lone Star",
                    "firstPlaceVotes": 0,
                    "points": 54
                  },
                  {
                    "rank": 25,
                    "school": "Mars Hill",
                    "conference": "South Atlantic",
                    "firstPlaceVotes": 0,
                    "points": 43
                  }
                ]
              },
              {
                "poll": "AFCA Division III Coaches Poll",
                "ranks": [
                  {
                    "rank": 1,
                    "school": "North Central",
                    "conference": "CCIW",
                    "firstPlaceVotes": 48,
                    "points": 1224
                  },
                  {
                    "rank": 2,
                    "school": "Mount Union",
                    "conference": "Ohio",
                    "firstPlaceVotes": 1,
                    "points": 1173
                  },
                  {
                    "rank": 3,
                    "school": "Wartburg",
                    "conference": "American Rivers",
                    "firstPlaceVotes": 0,
                    "points": 1120
                  },
                  {
                    "rank": 4,
                    "school": "Linfield",
                    "conference": "Northwest",
                    "firstPlaceVotes": 0,
                    "points": 1024
                  },
                  {
                    "rank": 5,
                    "school": "Trinity (TX)",
                    "conference": "Southern Athletic",
                    "firstPlaceVotes": 0,
                    "points": 986
                  },
                  {
                    "rank": 6,
                    "school": "UW-Whitewater",
                    "conference": "Wisconsin",
                    "firstPlaceVotes": 0,
                    "points": 958
                  },
                  {
                    "rank": 7,
                    "school": "Wisconsin-La Crosse",
                    "conference": "Wisconsin",
                    "firstPlaceVotes": 0,
                    "points": 909
                  },
                  {
                    "rank": 8,
                    "school": "Johns Hopkins",
                    "conference": "Centennial",
                    "firstPlaceVotes": 0,
                    "points": 903
                  },
                  {
                    "rank": 9,
                    "school": "Randolph-Macon",
                    "conference": "Old Dominion",
                    "firstPlaceVotes": 0,
                    "points": 817
                  },
                  {
                    "rank": 10,
                    "school": "UW-River Falls",
                    "conference": "Wisconsin",
                    "firstPlaceVotes": 0,
                    "points": 779
                  },
                  {
                    "rank": 11,
                    "school": "Aurora",
                    "conference": "NACC",
                    "firstPlaceVotes": 0,
                    "points": 724
                  },
                  {
                    "rank": 12,
                    "school": "Susquehanna",
                    "conference": "Landmark Conference",
                    "firstPlaceVotes": 0,
                    "points": 688
                  },
                  {
                    "rank": 13,
                    "school": "Wheaton College (Ill)",
                    "conference": "CCIW",
                    "firstPlaceVotes": 0,
                    "points": 619
                  },
                  {
                    "rank": 14,
                    "school": "Alma College",
                    "conference": "Michigan",
                    "firstPlaceVotes": 0,
                    "points": 577
                  },
                  {
                    "rank": 15,
                    "school": "John Carroll",
                    "conference": "Ohio",
                    "firstPlaceVotes": 0,
                    "points": 549
                  },
                  {
                    "rank": 16,
                    "school": "Ithaca",
                    "conference": "Liberty League",
                    "firstPlaceVotes": 0,
                    "points": 457
                  },
                  {
                    "rank": 17,
                    "school": "SUNY Cortland",
                    "conference": "Empire 8",
                    "firstPlaceVotes": 0,
                    "points": 413
                  },
                  {
                    "rank": 18,
                    "school": "Endicott College",
                    "conference": "Commonwealth Coast",
                    "firstPlaceVotes": 0,
                    "points": 342
                  },
                  {
                    "rank": 19,
                    "school": "Hardin-Simmons",
                    "conference": "American Southwest",
                    "firstPlaceVotes": 0,
                    "points": 288
                  },
                  {
                    "rank": 20,
                    "school": "Grove City College",
                    "conference": "Presidents'",
                    "firstPlaceVotes": 0,
                    "points": 275
                  },
                  {
                    "rank": 21,
                    "school": "St. Johns (MN)",
                    "conference": "Minnesota",
                    "firstPlaceVotes": 0,
                    "points": 262
                  },
                  {
                    "rank": 22,
                    "school": "Muhlenberg",
                    "conference": "Centennial",
                    "firstPlaceVotes": 0,
                    "points": 230
                  },
                  {
                    "rank": 23,
                    "school": "DePauw",
                    "conference": "North Coast",
                    "firstPlaceVotes": 0,
                    "points": 183
                  },
                  {
                    "rank": 24,
                    "school": "Delaware Valley",
                    "conference": "Mid Atlantic",
                    "firstPlaceVotes": 0,
                    "points": 114
                  },
                  {
                    "rank": 25,
                    "school": "Berry College",
                    "conference": "Southern Athletic",
                    "firstPlaceVotes": 0,
                    "points": 99
                  }
                ]
              },
              {
                "poll": "Playoff Committee Rankings",
                "ranks": [
                  {
                    "rank": 1,
                    "school": "Ohio State",
                    "conference": "Big Ten",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 2,
                    "school": "Georgia",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 3,
                    "school": "Michigan",
                    "conference": "Big Ten",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 4,
                    "school": "Florida State",
                    "conference": "ACC",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 5,
                    "school": "Washington",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 6,
                    "school": "Oregon",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 7,
                    "school": "Texas",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 8,
                    "school": "Alabama",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 9,
                    "school": "Oklahoma",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 10,
                    "school": "Ole Miss",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 11,
                    "school": "Penn State",
                    "conference": "Big Ten",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 12,
                    "school": "Missouri",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 13,
                    "school": "Louisville",
                    "conference": "ACC",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 14,
                    "school": "LSU",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 15,
                    "school": "Notre Dame",
                    "conference": "FBS Independents",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 16,
                    "school": "Oregon State",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 17,
                    "school": "Tennessee",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 18,
                    "school": "Utah",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 19,
                    "school": "UCLA",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 20,
                    "school": "USC",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 21,
                    "school": "Kansas",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 22,
                    "school": "Oklahoma State",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 23,
                    "school": "Kansas State",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 24,
                    "school": "Tulane",
                    "conference": "American Athletic",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 25,
                    "school": "Air Force",
                    "conference": "Mountain West",
                    "firstPlaceVotes": 0,
                    "points": 0
                  }
                ]
              }
            ]
          }];

        global.fetch = jest.fn(() => Promise.resolve({
            json: () => Promise.resolve(rankings)
        }));

        var resultingScore = await scoringModule.calculateScoreV2(team, game, week);
        expect(resultingScore).toEqual(0);
    });
    
    it('Non-Conference Unranked Game Win', async () => {
        const team = "Arkansas";
        const game = {
            "_id": {
              "$oid": "65dfd87c1546400b2aeb7975"
            },
            "id": 401520363,
            "season": 2023,
            "week": 10,
            "seasonType": "regular",
            "startDate": "2023-11-04T16:00:00.000Z",
            "startTimeTbd": false,
            "completed": true,
            "neutralSite": false,
            "conferenceGame": false,
            "attendance": 89782,
            "venueId": 3634,
            "venue": "Bounce House",
            "homeId": 57,
            "homeTeam": "University of Central Florida",
            "homeConference": "Big 12",
            "homeDivision": "fbs",
            "homePoints": 36,
            "homeLineScores": [
              14,
              3,
              6,
              10,
              3
            ],
            "homePostWinProb": "0.08075347362469056",
            "homePregameElo": 1592,
            "homePostgameElo": 1588,
            "awayId": 8,
            "awayTeam": "Arkansas",
            "awayConference": "SEC",
            "awayDivision": "fbs",
            "awayPoints": 39,
            "awayLineScores": [
              14,
              3,
              3,
              13,
              6
            ],
            "awayPostWinProb": "0.9192465263753095",
            "awayPregameElo": 1596,
            "awayPostgameElo": 1600,
            "excitementIndex": "9.7718678848",
            "highlights": null,
            "notes": "test Arkansas game notes"
          };
        const week = 10;
        const rankings = [{
            "_id": {
              "$oid": "65de66651546400b2aeb6e64"
            },
            "season": 2023,
            "seasonType": "regular",
            "week": 10,
            "polls": [
              {
                "poll": "Coaches Poll",
                "ranks": [
                  {
                    "rank": 1,
                    "school": "Georgia",
                    "conference": "SEC",
                    "firstPlaceVotes": 58,
                    "points": 1590
                  },
                  {
                    "rank": 2,
                    "school": "Michigan",
                    "conference": "Big Ten",
                    "firstPlaceVotes": 3,
                    "points": 1520
                  },
                  {
                    "rank": 3,
                    "school": "Ohio State",
                    "conference": "Big Ten",
                    "firstPlaceVotes": 3,
                    "points": 1454
                  },
                  {
                    "rank": 4,
                    "school": "Florida State",
                    "conference": "ACC",
                    "firstPlaceVotes": 0,
                    "points": 1439
                  },
                  {
                    "rank": 5,
                    "school": "Washington",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 1344
                  },
                  {
                    "rank": 6,
                    "school": "Texas",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 1212
                  },
                  {
                    "rank": 7,
                    "school": "Oregon",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 1211
                  },
                  {
                    "rank": 8,
                    "school": "Alabama",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 1187
                  },
                  {
                    "rank": 9,
                    "school": "Penn State",
                    "conference": "Big Ten",
                    "firstPlaceVotes": 0,
                    "points": 1072
                  },
                  {
                    "rank": 10,
                    "school": "Ole Miss",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 1021
                  },
                  {
                    "rank": 11,
                    "school": "Oklahoma",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 948
                  },
                  {
                    "rank": 12,
                    "school": "Notre Dame",
                    "conference": "FBS Independents",
                    "firstPlaceVotes": 0,
                    "points": 847
                  },
                  {
                    "rank": 13,
                    "school": "LSU",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 809
                  },
                  {
                    "rank": 14,
                    "school": "Missouri",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 741
                  },
                  {
                    "rank": 15,
                    "school": "Louisville",
                    "conference": "ACC",
                    "firstPlaceVotes": 0,
                    "points": 701
                  },
                  {
                    "rank": 16,
                    "school": "Tennessee",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 553
                  },
                  {
                    "rank": 17,
                    "school": "Air Force",
                    "conference": "Mountain West",
                    "firstPlaceVotes": 0,
                    "points": 523
                  },
                  {
                    "rank": 18,
                    "school": "Utah",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 509
                  },
                  {
                    "rank": 19,
                    "school": "Oregon State",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 465
                  },
                  {
                    "rank": 20,
                    "school": "UCLA",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 309
                  },
                  {
                    "rank": 21,
                    "school": "Tulane",
                    "conference": "American Athletic",
                    "firstPlaceVotes": 0,
                    "points": 304
                  },
                  {
                    "rank": 22,
                    "school": "USC",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 239
                  },
                  {
                    "rank": 23,
                    "school": "Kansas",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 182
                  },
                  {
                    "rank": 24,
                    "school": "James Madison",
                    "conference": "Sun Belt",
                    "firstPlaceVotes": 0,
                    "points": 169
                  },
                  {
                    "rank": 25,
                    "school": "North Carolina",
                    "conference": "ACC",
                    "firstPlaceVotes": 0,
                    "points": 120
                  }
                ]
              },
              {
                "poll": "AP Top 25",
                "ranks": [
                  {
                    "rank": 1,
                    "school": "Georgia",
                    "conference": "SEC",
                    "firstPlaceVotes": 48,
                    "points": 1553
                  },
                  {
                    "rank": 2,
                    "school": "Michigan",
                    "conference": "Big Ten",
                    "firstPlaceVotes": 9,
                    "points": 1494
                  },
                  {
                    "rank": 3,
                    "school": "Ohio State",
                    "conference": "Big Ten",
                    "firstPlaceVotes": 3,
                    "points": 1446
                  },
                  {
                    "rank": 4,
                    "school": "Florida State",
                    "conference": "ACC",
                    "firstPlaceVotes": 3,
                    "points": 1421
                  },
                  {
                    "rank": 5,
                    "school": "Washington",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 1327
                  },
                  {
                    "rank": 6,
                    "school": "Oregon",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 1235
                  },
                  {
                    "rank": 7,
                    "school": "Texas",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 1189
                  },
                  {
                    "rank": 8,
                    "school": "Alabama",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 1114
                  },
                  {
                    "rank": 9,
                    "school": "Penn State",
                    "conference": "Big Ten",
                    "firstPlaceVotes": 0,
                    "points": 1044
                  },
                  {
                    "rank": 10,
                    "school": "Oklahoma",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 1010
                  },
                  {
                    "rank": 11,
                    "school": "Ole Miss",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 990
                  },
                  {
                    "rank": 12,
                    "school": "Notre Dame",
                    "conference": "FBS Independents",
                    "firstPlaceVotes": 0,
                    "points": 847
                  },
                  {
                    "rank": 13,
                    "school": "LSU",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 816
                  },
                  {
                    "rank": 14,
                    "school": "Missouri",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 714
                  },
                  {
                    "rank": 15,
                    "school": "Louisville",
                    "conference": "ACC",
                    "firstPlaceVotes": 0,
                    "points": 666
                  },
                  {
                    "rank": 16,
                    "school": "Oregon State",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 557
                  },
                  {
                    "rank": 17,
                    "school": "Air Force",
                    "conference": "Mountain West",
                    "firstPlaceVotes": 0,
                    "points": 526
                  },
                  {
                    "rank": 18,
                    "school": "Utah",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 510
                  },
                  {
                    "rank": 19,
                    "school": "Tennessee",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 473
                  },
                  {
                    "rank": 20,
                    "school": "UCLA",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 331
                  },
                  {
                    "rank": 21,
                    "school": "Tulane",
                    "conference": "American Athletic",
                    "firstPlaceVotes": 0,
                    "points": 303
                  },
                  {
                    "rank": 22,
                    "school": "Kansas",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 250
                  },
                  {
                    "rank": 23,
                    "school": "James Madison",
                    "conference": "Sun Belt",
                    "firstPlaceVotes": 0,
                    "points": 192
                  },
                  {
                    "rank": 24,
                    "school": "USC",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 139
                  },
                  {
                    "rank": 25,
                    "school": "Kansas State",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 112
                  }
                ]
              },
              {
                "poll": "FCS Coaches Poll",
                "ranks": [
                  {
                    "rank": 1,
                    "school": "South Dakota State",
                    "conference": "MVFC",
                    "firstPlaceVotes": 25,
                    "points": 625
                  },
                  {
                    "rank": 2,
                    "school": "Furman",
                    "conference": "Southern",
                    "firstPlaceVotes": 0,
                    "points": 577
                  },
                  {
                    "rank": 3,
                    "school": "Montana",
                    "conference": "Big Sky",
                    "firstPlaceVotes": 0,
                    "points": 544
                  },
                  {
                    "rank": 4,
                    "school": "Incarnate Word",
                    "conference": "Southland",
                    "firstPlaceVotes": 0,
                    "points": 533
                  },
                  {
                    "rank": 5,
                    "school": "Idaho",
                    "conference": "Big Sky",
                    "firstPlaceVotes": 0,
                    "points": 515
                  },
                  {
                    "rank": 6,
                    "school": "Delaware",
                    "conference": "CAA",
                    "firstPlaceVotes": 0,
                    "points": 507
                  },
                  {
                    "rank": 7,
                    "school": "Sacramento State",
                    "conference": "Big Sky",
                    "firstPlaceVotes": 0,
                    "points": 471
                  },
                  {
                    "rank": 8,
                    "school": "Montana State",
                    "conference": "Big Sky",
                    "firstPlaceVotes": 0,
                    "points": 458
                  },
                  {
                    "rank": 9,
                    "school": "North Carolina Central",
                    "conference": "MEAC",
                    "firstPlaceVotes": 0,
                    "points": 407
                  },
                  {
                    "rank": 10,
                    "school": "North Dakota State",
                    "conference": "MVFC",
                    "firstPlaceVotes": 0,
                    "points": 398
                  },
                  {
                    "rank": 11,
                    "school": "Southern Illinois",
                    "conference": "MVFC",
                    "firstPlaceVotes": 0,
                    "points": 380
                  },
                  {
                    "rank": 12,
                    "school": "South Dakota",
                    "conference": "MVFC",
                    "firstPlaceVotes": 0,
                    "points": 330
                  },
                  {
                    "rank": 13,
                    "school": "Florida A&M",
                    "conference": "SWAC",
                    "firstPlaceVotes": 0,
                    "points": 296
                  },
                  {
                    "rank": 13,
                    "school": "Chattanooga",
                    "conference": "Southern",
                    "firstPlaceVotes": 0,
                    "points": 296
                  },
                  {
                    "rank": 15,
                    "school": "North Dakota",
                    "conference": "MVFC",
                    "firstPlaceVotes": 0,
                    "points": 260
                  },
                  {
                    "rank": 16,
                    "school": "Lafayette",
                    "conference": "Patriot",
                    "firstPlaceVotes": 0,
                    "points": 241
                  },
                  {
                    "rank": 17,
                    "school": "Austin Peay",
                    "conference": "UAC",
                    "firstPlaceVotes": 0,
                    "points": 218
                  },
                  {
                    "rank": 18,
                    "school": "UT Martin",
                    "conference": "Big South-OVC",
                    "firstPlaceVotes": 0,
                    "points": 179
                  },
                  {
                    "rank": 19,
                    "school": "Harvard",
                    "conference": "Ivy",
                    "firstPlaceVotes": 0,
                    "points": 137
                  },
                  {
                    "rank": 20,
                    "school": "Western Carolina",
                    "conference": "Southern",
                    "firstPlaceVotes": 0,
                    "points": 124
                  },
                  {
                    "rank": 21,
                    "school": "Holy Cross",
                    "conference": "Patriot",
                    "firstPlaceVotes": 0,
                    "points": 120
                  },
                  {
                    "rank": 22,
                    "school": "Villanova",
                    "conference": "CAA",
                    "firstPlaceVotes": 0,
                    "points": 107
                  },
                  {
                    "rank": 23,
                    "school": "Northern Iowa",
                    "conference": "MVFC",
                    "firstPlaceVotes": 0,
                    "points": 105
                  },
                  {
                    "rank": 24,
                    "school": "William & Mary",
                    "conference": "CAA",
                    "firstPlaceVotes": 0,
                    "points": 83
                  },
                  {
                    "rank": 25,
                    "school": "Central Arkansas",
                    "conference": "UAC",
                    "firstPlaceVotes": 0,
                    "points": 73
                  }
                ]
              },
              {
                "poll": "AFCA Division II Coaches Poll",
                "ranks": [
                  {
                    "rank": 1,
                    "school": "Colorado Mines",
                    "conference": "Rocky Mountain",
                    "firstPlaceVotes": 26,
                    "points": 720
                  },
                  {
                    "rank": 2,
                    "school": "Pittsburg State",
                    "conference": "Mid America",
                    "firstPlaceVotes": 1,
                    "points": 694
                  },
                  {
                    "rank": 3,
                    "school": "Grand Valley State",
                    "conference": "GLIAC",
                    "firstPlaceVotes": 1,
                    "points": 662
                  },
                  {
                    "rank": 4,
                    "school": "Harding",
                    "conference": "Great American",
                    "firstPlaceVotes": 0,
                    "points": 637
                  },
                  {
                    "rank": 5,
                    "school": "Slippery Rock",
                    "conference": "Pennsylvania State Athletic",
                    "firstPlaceVotes": 1,
                    "points": 582
                  },
                  {
                    "rank": 6,
                    "school": "Benedict College",
                    "conference": "SIAC",
                    "firstPlaceVotes": 0,
                    "points": 573
                  },
                  {
                    "rank": 7,
                    "school": "Ferris State",
                    "conference": "GLIAC",
                    "firstPlaceVotes": 0,
                    "points": 534
                  },
                  {
                    "rank": 8,
                    "school": "Indianapolis",
                    "conference": "Great Lakes",
                    "firstPlaceVotes": 0,
                    "points": 503
                  },
                  {
                    "rank": 9,
                    "school": "Davenport",
                    "conference": "GLIAC",
                    "firstPlaceVotes": 0,
                    "points": 484
                  },
                  {
                    "rank": 10,
                    "school": "Minnesota State",
                    "conference": "Northern Sun",
                    "firstPlaceVotes": 0,
                    "points": 437
                  },
                  {
                    "rank": 11,
                    "school": "Central Missouri State",
                    "conference": "Mid America",
                    "firstPlaceVotes": 0,
                    "points": 406
                  },
                  {
                    "rank": 12,
                    "school": "Ouachita Baptist",
                    "conference": "Great American",
                    "firstPlaceVotes": 0,
                    "points": 399
                  },
                  {
                    "rank": 13,
                    "school": "Bemidji State",
                    "conference": "Northern Sun",
                    "firstPlaceVotes": 0,
                    "points": 353
                  },
                  {
                    "rank": 14,
                    "school": "Delta State",
                    "conference": "Gulf South",
                    "firstPlaceVotes": 0,
                    "points": 322
                  },
                  {
                    "rank": 15,
                    "school": "Western State",
                    "conference": "Rocky Mountain",
                    "firstPlaceVotes": 0,
                    "points": 321
                  },
                  {
                    "rank": 16,
                    "school": "Lenoir-Rhyne",
                    "conference": "South Atlantic",
                    "firstPlaceVotes": 0,
                    "points": 291
                  },
                  {
                    "rank": 17,
                    "school": "Tiffin",
                    "conference": "Great Midwest Athletic",
                    "firstPlaceVotes": 0,
                    "points": 282
                  },
                  {
                    "rank": 18,
                    "school": "University of Texas of the Permian Basin",
                    "conference": "Lone Star",
                    "firstPlaceVotes": 0,
                    "points": 228
                  },
                  {
                    "rank": 19,
                    "school": "Virginia Union",
                    "conference": "CIAA",
                    "firstPlaceVotes": 0,
                    "points": 210
                  },
                  {
                    "rank": 20,
                    "school": "Valdosta State",
                    "conference": "Gulf South",
                    "firstPlaceVotes": 0,
                    "points": 207
                  },
                  {
                    "rank": 21,
                    "school": "Augustana (SD)",
                    "conference": "Northern Sun",
                    "firstPlaceVotes": 0,
                    "points": 183
                  },
                  {
                    "rank": 22,
                    "school": "Virginia State",
                    "conference": "CIAA",
                    "firstPlaceVotes": 0,
                    "points": 86
                  },
                  {
                    "rank": 23,
                    "school": "Missouri Western",
                    "conference": "Mid America",
                    "firstPlaceVotes": 0,
                    "points": 69
                  },
                  {
                    "rank": 24,
                    "school": "Central Washington",
                    "conference": "Lone Star",
                    "firstPlaceVotes": 0,
                    "points": 54
                  },
                  {
                    "rank": 25,
                    "school": "Mars Hill",
                    "conference": "South Atlantic",
                    "firstPlaceVotes": 0,
                    "points": 43
                  }
                ]
              },
              {
                "poll": "AFCA Division III Coaches Poll",
                "ranks": [
                  {
                    "rank": 1,
                    "school": "North Central",
                    "conference": "CCIW",
                    "firstPlaceVotes": 48,
                    "points": 1224
                  },
                  {
                    "rank": 2,
                    "school": "Mount Union",
                    "conference": "Ohio",
                    "firstPlaceVotes": 1,
                    "points": 1173
                  },
                  {
                    "rank": 3,
                    "school": "Wartburg",
                    "conference": "American Rivers",
                    "firstPlaceVotes": 0,
                    "points": 1120
                  },
                  {
                    "rank": 4,
                    "school": "Linfield",
                    "conference": "Northwest",
                    "firstPlaceVotes": 0,
                    "points": 1024
                  },
                  {
                    "rank": 5,
                    "school": "Trinity (TX)",
                    "conference": "Southern Athletic",
                    "firstPlaceVotes": 0,
                    "points": 986
                  },
                  {
                    "rank": 6,
                    "school": "UW-Whitewater",
                    "conference": "Wisconsin",
                    "firstPlaceVotes": 0,
                    "points": 958
                  },
                  {
                    "rank": 7,
                    "school": "Wisconsin-La Crosse",
                    "conference": "Wisconsin",
                    "firstPlaceVotes": 0,
                    "points": 909
                  },
                  {
                    "rank": 8,
                    "school": "Johns Hopkins",
                    "conference": "Centennial",
                    "firstPlaceVotes": 0,
                    "points": 903
                  },
                  {
                    "rank": 9,
                    "school": "Randolph-Macon",
                    "conference": "Old Dominion",
                    "firstPlaceVotes": 0,
                    "points": 817
                  },
                  {
                    "rank": 10,
                    "school": "UW-River Falls",
                    "conference": "Wisconsin",
                    "firstPlaceVotes": 0,
                    "points": 779
                  },
                  {
                    "rank": 11,
                    "school": "Aurora",
                    "conference": "NACC",
                    "firstPlaceVotes": 0,
                    "points": 724
                  },
                  {
                    "rank": 12,
                    "school": "Susquehanna",
                    "conference": "Landmark Conference",
                    "firstPlaceVotes": 0,
                    "points": 688
                  },
                  {
                    "rank": 13,
                    "school": "Wheaton College (Ill)",
                    "conference": "CCIW",
                    "firstPlaceVotes": 0,
                    "points": 619
                  },
                  {
                    "rank": 14,
                    "school": "Alma College",
                    "conference": "Michigan",
                    "firstPlaceVotes": 0,
                    "points": 577
                  },
                  {
                    "rank": 15,
                    "school": "John Carroll",
                    "conference": "Ohio",
                    "firstPlaceVotes": 0,
                    "points": 549
                  },
                  {
                    "rank": 16,
                    "school": "Ithaca",
                    "conference": "Liberty League",
                    "firstPlaceVotes": 0,
                    "points": 457
                  },
                  {
                    "rank": 17,
                    "school": "SUNY Cortland",
                    "conference": "Empire 8",
                    "firstPlaceVotes": 0,
                    "points": 413
                  },
                  {
                    "rank": 18,
                    "school": "Endicott College",
                    "conference": "Commonwealth Coast",
                    "firstPlaceVotes": 0,
                    "points": 342
                  },
                  {
                    "rank": 19,
                    "school": "Hardin-Simmons",
                    "conference": "American Southwest",
                    "firstPlaceVotes": 0,
                    "points": 288
                  },
                  {
                    "rank": 20,
                    "school": "Grove City College",
                    "conference": "Presidents'",
                    "firstPlaceVotes": 0,
                    "points": 275
                  },
                  {
                    "rank": 21,
                    "school": "St. Johns (MN)",
                    "conference": "Minnesota",
                    "firstPlaceVotes": 0,
                    "points": 262
                  },
                  {
                    "rank": 22,
                    "school": "Muhlenberg",
                    "conference": "Centennial",
                    "firstPlaceVotes": 0,
                    "points": 230
                  },
                  {
                    "rank": 23,
                    "school": "DePauw",
                    "conference": "North Coast",
                    "firstPlaceVotes": 0,
                    "points": 183
                  },
                  {
                    "rank": 24,
                    "school": "Delaware Valley",
                    "conference": "Mid Atlantic",
                    "firstPlaceVotes": 0,
                    "points": 114
                  },
                  {
                    "rank": 25,
                    "school": "Berry College",
                    "conference": "Southern Athletic",
                    "firstPlaceVotes": 0,
                    "points": 99
                  }
                ]
              },
              {
                "poll": "Playoff Committee Rankings",
                "ranks": [
                  {
                    "rank": 1,
                    "school": "Ohio State",
                    "conference": "Big Ten",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 2,
                    "school": "Georgia",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 3,
                    "school": "Michigan",
                    "conference": "Big Ten",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 4,
                    "school": "Florida State",
                    "conference": "ACC",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 5,
                    "school": "Washington",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 6,
                    "school": "Oregon",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 7,
                    "school": "Texas",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 8,
                    "school": "Alabama",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 9,
                    "school": "Oklahoma",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 10,
                    "school": "Ole Miss",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 11,
                    "school": "Penn State",
                    "conference": "Big Ten",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 12,
                    "school": "Missouri",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 13,
                    "school": "Louisville",
                    "conference": "ACC",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 14,
                    "school": "LSU",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 15,
                    "school": "Notre Dame",
                    "conference": "FBS Independents",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 16,
                    "school": "Oregon State",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 17,
                    "school": "Tennessee",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 18,
                    "school": "Utah",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 19,
                    "school": "UCLA",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 20,
                    "school": "USC",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 21,
                    "school": "Kansas",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 22,
                    "school": "Oklahoma State",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 23,
                    "school": "Kansas State",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 24,
                    "school": "Tulane",
                    "conference": "American Athletic",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 25,
                    "school": "Air Force",
                    "conference": "Mountain West",
                    "firstPlaceVotes": 0,
                    "points": 0
                  }
                ]
              }
            ]
          }];

        global.fetch = jest.fn(() => Promise.resolve({
            json: () => Promise.resolve(rankings)
        }));

        var resultingScore = await scoringModule.calculateScoreV2(team, game, week);
        expect(resultingScore).toEqual(1);
    });

    it('Conference Game Win', async () => {
        const team = "Arkansas";
        const game = {
            "_id": {
              "$oid": "65dfd87c1546400b2aeb7975"
            },
            "id": 401520363,
            "season": 2023,
            "week": 10,
            "seasonType": "regular",
            "startDate": "2023-11-04T16:00:00.000Z",
            "startTimeTbd": false,
            "completed": true,
            "neutralSite": false,
            "conferenceGame": true,
            "attendance": 89782,
            "venueId": 3634,
            "venue": "Ben Hill Griffin Stadium",
            "homeId": 57,
            "homeTeam": "Florida",
            "homeConference": "SEC",
            "homeDivision": "fbs",
            "homePoints": 36,
            "homeLineScores": [
              14,
              3,
              6,
              10,
              3
            ],
            "homePostWinProb": "0.08075347362469056",
            "homePregameElo": 1592,
            "homePostgameElo": 1588,
            "awayId": 8,
            "awayTeam": "Arkansas",
            "awayConference": "SEC",
            "awayDivision": "fbs",
            "awayPoints": 39,
            "awayLineScores": [
              14,
              3,
              3,
              13,
              6
            ],
            "awayPostWinProb": "0.9192465263753095",
            "awayPregameElo": 1596,
            "awayPostgameElo": 1600,
            "excitementIndex": "9.7718678848",
            "highlights": null,
            "notes": "test Arkansas game notes"
          };
        const week = 10;
        const rankings = [{
            "_id": {
              "$oid": "65de66651546400b2aeb6e64"
            },
            "season": 2023,
            "seasonType": "regular",
            "week": 10,
            "polls": [
              {
                "poll": "Coaches Poll",
                "ranks": [
                  {
                    "rank": 1,
                    "school": "Georgia",
                    "conference": "SEC",
                    "firstPlaceVotes": 58,
                    "points": 1590
                  },
                  {
                    "rank": 2,
                    "school": "Michigan",
                    "conference": "Big Ten",
                    "firstPlaceVotes": 3,
                    "points": 1520
                  },
                  {
                    "rank": 3,
                    "school": "Ohio State",
                    "conference": "Big Ten",
                    "firstPlaceVotes": 3,
                    "points": 1454
                  },
                  {
                    "rank": 4,
                    "school": "Florida State",
                    "conference": "ACC",
                    "firstPlaceVotes": 0,
                    "points": 1439
                  },
                  {
                    "rank": 5,
                    "school": "Washington",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 1344
                  },
                  {
                    "rank": 6,
                    "school": "Texas",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 1212
                  },
                  {
                    "rank": 7,
                    "school": "Oregon",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 1211
                  },
                  {
                    "rank": 8,
                    "school": "Alabama",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 1187
                  },
                  {
                    "rank": 9,
                    "school": "Penn State",
                    "conference": "Big Ten",
                    "firstPlaceVotes": 0,
                    "points": 1072
                  },
                  {
                    "rank": 10,
                    "school": "Ole Miss",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 1021
                  },
                  {
                    "rank": 11,
                    "school": "Oklahoma",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 948
                  },
                  {
                    "rank": 12,
                    "school": "Notre Dame",
                    "conference": "FBS Independents",
                    "firstPlaceVotes": 0,
                    "points": 847
                  },
                  {
                    "rank": 13,
                    "school": "LSU",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 809
                  },
                  {
                    "rank": 14,
                    "school": "Missouri",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 741
                  },
                  {
                    "rank": 15,
                    "school": "Louisville",
                    "conference": "ACC",
                    "firstPlaceVotes": 0,
                    "points": 701
                  },
                  {
                    "rank": 16,
                    "school": "Tennessee",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 553
                  },
                  {
                    "rank": 17,
                    "school": "Air Force",
                    "conference": "Mountain West",
                    "firstPlaceVotes": 0,
                    "points": 523
                  },
                  {
                    "rank": 18,
                    "school": "Utah",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 509
                  },
                  {
                    "rank": 19,
                    "school": "Oregon State",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 465
                  },
                  {
                    "rank": 20,
                    "school": "UCLA",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 309
                  },
                  {
                    "rank": 21,
                    "school": "Tulane",
                    "conference": "American Athletic",
                    "firstPlaceVotes": 0,
                    "points": 304
                  },
                  {
                    "rank": 22,
                    "school": "USC",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 239
                  },
                  {
                    "rank": 23,
                    "school": "Kansas",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 182
                  },
                  {
                    "rank": 24,
                    "school": "James Madison",
                    "conference": "Sun Belt",
                    "firstPlaceVotes": 0,
                    "points": 169
                  },
                  {
                    "rank": 25,
                    "school": "North Carolina",
                    "conference": "ACC",
                    "firstPlaceVotes": 0,
                    "points": 120
                  }
                ]
              },
              {
                "poll": "AP Top 25",
                "ranks": [
                  {
                    "rank": 1,
                    "school": "Georgia",
                    "conference": "SEC",
                    "firstPlaceVotes": 48,
                    "points": 1553
                  },
                  {
                    "rank": 2,
                    "school": "Michigan",
                    "conference": "Big Ten",
                    "firstPlaceVotes": 9,
                    "points": 1494
                  },
                  {
                    "rank": 3,
                    "school": "Ohio State",
                    "conference": "Big Ten",
                    "firstPlaceVotes": 3,
                    "points": 1446
                  },
                  {
                    "rank": 4,
                    "school": "Florida State",
                    "conference": "ACC",
                    "firstPlaceVotes": 3,
                    "points": 1421
                  },
                  {
                    "rank": 5,
                    "school": "Washington",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 1327
                  },
                  {
                    "rank": 6,
                    "school": "Oregon",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 1235
                  },
                  {
                    "rank": 7,
                    "school": "Texas",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 1189
                  },
                  {
                    "rank": 8,
                    "school": "Alabama",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 1114
                  },
                  {
                    "rank": 9,
                    "school": "Penn State",
                    "conference": "Big Ten",
                    "firstPlaceVotes": 0,
                    "points": 1044
                  },
                  {
                    "rank": 10,
                    "school": "Oklahoma",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 1010
                  },
                  {
                    "rank": 11,
                    "school": "Ole Miss",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 990
                  },
                  {
                    "rank": 12,
                    "school": "Notre Dame",
                    "conference": "FBS Independents",
                    "firstPlaceVotes": 0,
                    "points": 847
                  },
                  {
                    "rank": 13,
                    "school": "LSU",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 816
                  },
                  {
                    "rank": 14,
                    "school": "Missouri",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 714
                  },
                  {
                    "rank": 15,
                    "school": "Louisville",
                    "conference": "ACC",
                    "firstPlaceVotes": 0,
                    "points": 666
                  },
                  {
                    "rank": 16,
                    "school": "Oregon State",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 557
                  },
                  {
                    "rank": 17,
                    "school": "Air Force",
                    "conference": "Mountain West",
                    "firstPlaceVotes": 0,
                    "points": 526
                  },
                  {
                    "rank": 18,
                    "school": "Utah",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 510
                  },
                  {
                    "rank": 19,
                    "school": "Tennessee",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 473
                  },
                  {
                    "rank": 20,
                    "school": "UCLA",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 331
                  },
                  {
                    "rank": 21,
                    "school": "Tulane",
                    "conference": "American Athletic",
                    "firstPlaceVotes": 0,
                    "points": 303
                  },
                  {
                    "rank": 22,
                    "school": "Kansas",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 250
                  },
                  {
                    "rank": 23,
                    "school": "James Madison",
                    "conference": "Sun Belt",
                    "firstPlaceVotes": 0,
                    "points": 192
                  },
                  {
                    "rank": 24,
                    "school": "USC",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 139
                  },
                  {
                    "rank": 25,
                    "school": "Kansas State",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 112
                  }
                ]
              },
              {
                "poll": "FCS Coaches Poll",
                "ranks": [
                  {
                    "rank": 1,
                    "school": "South Dakota State",
                    "conference": "MVFC",
                    "firstPlaceVotes": 25,
                    "points": 625
                  },
                  {
                    "rank": 2,
                    "school": "Furman",
                    "conference": "Southern",
                    "firstPlaceVotes": 0,
                    "points": 577
                  },
                  {
                    "rank": 3,
                    "school": "Montana",
                    "conference": "Big Sky",
                    "firstPlaceVotes": 0,
                    "points": 544
                  },
                  {
                    "rank": 4,
                    "school": "Incarnate Word",
                    "conference": "Southland",
                    "firstPlaceVotes": 0,
                    "points": 533
                  },
                  {
                    "rank": 5,
                    "school": "Idaho",
                    "conference": "Big Sky",
                    "firstPlaceVotes": 0,
                    "points": 515
                  },
                  {
                    "rank": 6,
                    "school": "Delaware",
                    "conference": "CAA",
                    "firstPlaceVotes": 0,
                    "points": 507
                  },
                  {
                    "rank": 7,
                    "school": "Sacramento State",
                    "conference": "Big Sky",
                    "firstPlaceVotes": 0,
                    "points": 471
                  },
                  {
                    "rank": 8,
                    "school": "Montana State",
                    "conference": "Big Sky",
                    "firstPlaceVotes": 0,
                    "points": 458
                  },
                  {
                    "rank": 9,
                    "school": "North Carolina Central",
                    "conference": "MEAC",
                    "firstPlaceVotes": 0,
                    "points": 407
                  },
                  {
                    "rank": 10,
                    "school": "North Dakota State",
                    "conference": "MVFC",
                    "firstPlaceVotes": 0,
                    "points": 398
                  },
                  {
                    "rank": 11,
                    "school": "Southern Illinois",
                    "conference": "MVFC",
                    "firstPlaceVotes": 0,
                    "points": 380
                  },
                  {
                    "rank": 12,
                    "school": "South Dakota",
                    "conference": "MVFC",
                    "firstPlaceVotes": 0,
                    "points": 330
                  },
                  {
                    "rank": 13,
                    "school": "Florida A&M",
                    "conference": "SWAC",
                    "firstPlaceVotes": 0,
                    "points": 296
                  },
                  {
                    "rank": 13,
                    "school": "Chattanooga",
                    "conference": "Southern",
                    "firstPlaceVotes": 0,
                    "points": 296
                  },
                  {
                    "rank": 15,
                    "school": "North Dakota",
                    "conference": "MVFC",
                    "firstPlaceVotes": 0,
                    "points": 260
                  },
                  {
                    "rank": 16,
                    "school": "Lafayette",
                    "conference": "Patriot",
                    "firstPlaceVotes": 0,
                    "points": 241
                  },
                  {
                    "rank": 17,
                    "school": "Austin Peay",
                    "conference": "UAC",
                    "firstPlaceVotes": 0,
                    "points": 218
                  },
                  {
                    "rank": 18,
                    "school": "UT Martin",
                    "conference": "Big South-OVC",
                    "firstPlaceVotes": 0,
                    "points": 179
                  },
                  {
                    "rank": 19,
                    "school": "Harvard",
                    "conference": "Ivy",
                    "firstPlaceVotes": 0,
                    "points": 137
                  },
                  {
                    "rank": 20,
                    "school": "Western Carolina",
                    "conference": "Southern",
                    "firstPlaceVotes": 0,
                    "points": 124
                  },
                  {
                    "rank": 21,
                    "school": "Holy Cross",
                    "conference": "Patriot",
                    "firstPlaceVotes": 0,
                    "points": 120
                  },
                  {
                    "rank": 22,
                    "school": "Villanova",
                    "conference": "CAA",
                    "firstPlaceVotes": 0,
                    "points": 107
                  },
                  {
                    "rank": 23,
                    "school": "Northern Iowa",
                    "conference": "MVFC",
                    "firstPlaceVotes": 0,
                    "points": 105
                  },
                  {
                    "rank": 24,
                    "school": "William & Mary",
                    "conference": "CAA",
                    "firstPlaceVotes": 0,
                    "points": 83
                  },
                  {
                    "rank": 25,
                    "school": "Central Arkansas",
                    "conference": "UAC",
                    "firstPlaceVotes": 0,
                    "points": 73
                  }
                ]
              },
              {
                "poll": "AFCA Division II Coaches Poll",
                "ranks": [
                  {
                    "rank": 1,
                    "school": "Colorado Mines",
                    "conference": "Rocky Mountain",
                    "firstPlaceVotes": 26,
                    "points": 720
                  },
                  {
                    "rank": 2,
                    "school": "Pittsburg State",
                    "conference": "Mid America",
                    "firstPlaceVotes": 1,
                    "points": 694
                  },
                  {
                    "rank": 3,
                    "school": "Grand Valley State",
                    "conference": "GLIAC",
                    "firstPlaceVotes": 1,
                    "points": 662
                  },
                  {
                    "rank": 4,
                    "school": "Harding",
                    "conference": "Great American",
                    "firstPlaceVotes": 0,
                    "points": 637
                  },
                  {
                    "rank": 5,
                    "school": "Slippery Rock",
                    "conference": "Pennsylvania State Athletic",
                    "firstPlaceVotes": 1,
                    "points": 582
                  },
                  {
                    "rank": 6,
                    "school": "Benedict College",
                    "conference": "SIAC",
                    "firstPlaceVotes": 0,
                    "points": 573
                  },
                  {
                    "rank": 7,
                    "school": "Ferris State",
                    "conference": "GLIAC",
                    "firstPlaceVotes": 0,
                    "points": 534
                  },
                  {
                    "rank": 8,
                    "school": "Indianapolis",
                    "conference": "Great Lakes",
                    "firstPlaceVotes": 0,
                    "points": 503
                  },
                  {
                    "rank": 9,
                    "school": "Davenport",
                    "conference": "GLIAC",
                    "firstPlaceVotes": 0,
                    "points": 484
                  },
                  {
                    "rank": 10,
                    "school": "Minnesota State",
                    "conference": "Northern Sun",
                    "firstPlaceVotes": 0,
                    "points": 437
                  },
                  {
                    "rank": 11,
                    "school": "Central Missouri State",
                    "conference": "Mid America",
                    "firstPlaceVotes": 0,
                    "points": 406
                  },
                  {
                    "rank": 12,
                    "school": "Ouachita Baptist",
                    "conference": "Great American",
                    "firstPlaceVotes": 0,
                    "points": 399
                  },
                  {
                    "rank": 13,
                    "school": "Bemidji State",
                    "conference": "Northern Sun",
                    "firstPlaceVotes": 0,
                    "points": 353
                  },
                  {
                    "rank": 14,
                    "school": "Delta State",
                    "conference": "Gulf South",
                    "firstPlaceVotes": 0,
                    "points": 322
                  },
                  {
                    "rank": 15,
                    "school": "Western State",
                    "conference": "Rocky Mountain",
                    "firstPlaceVotes": 0,
                    "points": 321
                  },
                  {
                    "rank": 16,
                    "school": "Lenoir-Rhyne",
                    "conference": "South Atlantic",
                    "firstPlaceVotes": 0,
                    "points": 291
                  },
                  {
                    "rank": 17,
                    "school": "Tiffin",
                    "conference": "Great Midwest Athletic",
                    "firstPlaceVotes": 0,
                    "points": 282
                  },
                  {
                    "rank": 18,
                    "school": "University of Texas of the Permian Basin",
                    "conference": "Lone Star",
                    "firstPlaceVotes": 0,
                    "points": 228
                  },
                  {
                    "rank": 19,
                    "school": "Virginia Union",
                    "conference": "CIAA",
                    "firstPlaceVotes": 0,
                    "points": 210
                  },
                  {
                    "rank": 20,
                    "school": "Valdosta State",
                    "conference": "Gulf South",
                    "firstPlaceVotes": 0,
                    "points": 207
                  },
                  {
                    "rank": 21,
                    "school": "Augustana (SD)",
                    "conference": "Northern Sun",
                    "firstPlaceVotes": 0,
                    "points": 183
                  },
                  {
                    "rank": 22,
                    "school": "Virginia State",
                    "conference": "CIAA",
                    "firstPlaceVotes": 0,
                    "points": 86
                  },
                  {
                    "rank": 23,
                    "school": "Missouri Western",
                    "conference": "Mid America",
                    "firstPlaceVotes": 0,
                    "points": 69
                  },
                  {
                    "rank": 24,
                    "school": "Central Washington",
                    "conference": "Lone Star",
                    "firstPlaceVotes": 0,
                    "points": 54
                  },
                  {
                    "rank": 25,
                    "school": "Mars Hill",
                    "conference": "South Atlantic",
                    "firstPlaceVotes": 0,
                    "points": 43
                  }
                ]
              },
              {
                "poll": "AFCA Division III Coaches Poll",
                "ranks": [
                  {
                    "rank": 1,
                    "school": "North Central",
                    "conference": "CCIW",
                    "firstPlaceVotes": 48,
                    "points": 1224
                  },
                  {
                    "rank": 2,
                    "school": "Mount Union",
                    "conference": "Ohio",
                    "firstPlaceVotes": 1,
                    "points": 1173
                  },
                  {
                    "rank": 3,
                    "school": "Wartburg",
                    "conference": "American Rivers",
                    "firstPlaceVotes": 0,
                    "points": 1120
                  },
                  {
                    "rank": 4,
                    "school": "Linfield",
                    "conference": "Northwest",
                    "firstPlaceVotes": 0,
                    "points": 1024
                  },
                  {
                    "rank": 5,
                    "school": "Trinity (TX)",
                    "conference": "Southern Athletic",
                    "firstPlaceVotes": 0,
                    "points": 986
                  },
                  {
                    "rank": 6,
                    "school": "UW-Whitewater",
                    "conference": "Wisconsin",
                    "firstPlaceVotes": 0,
                    "points": 958
                  },
                  {
                    "rank": 7,
                    "school": "Wisconsin-La Crosse",
                    "conference": "Wisconsin",
                    "firstPlaceVotes": 0,
                    "points": 909
                  },
                  {
                    "rank": 8,
                    "school": "Johns Hopkins",
                    "conference": "Centennial",
                    "firstPlaceVotes": 0,
                    "points": 903
                  },
                  {
                    "rank": 9,
                    "school": "Randolph-Macon",
                    "conference": "Old Dominion",
                    "firstPlaceVotes": 0,
                    "points": 817
                  },
                  {
                    "rank": 10,
                    "school": "UW-River Falls",
                    "conference": "Wisconsin",
                    "firstPlaceVotes": 0,
                    "points": 779
                  },
                  {
                    "rank": 11,
                    "school": "Aurora",
                    "conference": "NACC",
                    "firstPlaceVotes": 0,
                    "points": 724
                  },
                  {
                    "rank": 12,
                    "school": "Susquehanna",
                    "conference": "Landmark Conference",
                    "firstPlaceVotes": 0,
                    "points": 688
                  },
                  {
                    "rank": 13,
                    "school": "Wheaton College (Ill)",
                    "conference": "CCIW",
                    "firstPlaceVotes": 0,
                    "points": 619
                  },
                  {
                    "rank": 14,
                    "school": "Alma College",
                    "conference": "Michigan",
                    "firstPlaceVotes": 0,
                    "points": 577
                  },
                  {
                    "rank": 15,
                    "school": "John Carroll",
                    "conference": "Ohio",
                    "firstPlaceVotes": 0,
                    "points": 549
                  },
                  {
                    "rank": 16,
                    "school": "Ithaca",
                    "conference": "Liberty League",
                    "firstPlaceVotes": 0,
                    "points": 457
                  },
                  {
                    "rank": 17,
                    "school": "SUNY Cortland",
                    "conference": "Empire 8",
                    "firstPlaceVotes": 0,
                    "points": 413
                  },
                  {
                    "rank": 18,
                    "school": "Endicott College",
                    "conference": "Commonwealth Coast",
                    "firstPlaceVotes": 0,
                    "points": 342
                  },
                  {
                    "rank": 19,
                    "school": "Hardin-Simmons",
                    "conference": "American Southwest",
                    "firstPlaceVotes": 0,
                    "points": 288
                  },
                  {
                    "rank": 20,
                    "school": "Grove City College",
                    "conference": "Presidents'",
                    "firstPlaceVotes": 0,
                    "points": 275
                  },
                  {
                    "rank": 21,
                    "school": "St. Johns (MN)",
                    "conference": "Minnesota",
                    "firstPlaceVotes": 0,
                    "points": 262
                  },
                  {
                    "rank": 22,
                    "school": "Muhlenberg",
                    "conference": "Centennial",
                    "firstPlaceVotes": 0,
                    "points": 230
                  },
                  {
                    "rank": 23,
                    "school": "DePauw",
                    "conference": "North Coast",
                    "firstPlaceVotes": 0,
                    "points": 183
                  },
                  {
                    "rank": 24,
                    "school": "Delaware Valley",
                    "conference": "Mid Atlantic",
                    "firstPlaceVotes": 0,
                    "points": 114
                  },
                  {
                    "rank": 25,
                    "school": "Berry College",
                    "conference": "Southern Athletic",
                    "firstPlaceVotes": 0,
                    "points": 99
                  }
                ]
              },
              {
                "poll": "Playoff Committee Rankings",
                "ranks": [
                  {
                    "rank": 1,
                    "school": "Ohio State",
                    "conference": "Big Ten",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 2,
                    "school": "Georgia",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 3,
                    "school": "Michigan",
                    "conference": "Big Ten",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 4,
                    "school": "Florida State",
                    "conference": "ACC",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 5,
                    "school": "Washington",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 6,
                    "school": "Oregon",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 7,
                    "school": "Texas",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 8,
                    "school": "Alabama",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 9,
                    "school": "Oklahoma",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 10,
                    "school": "Ole Miss",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 11,
                    "school": "Penn State",
                    "conference": "Big Ten",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 12,
                    "school": "Missouri",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 13,
                    "school": "Louisville",
                    "conference": "ACC",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 14,
                    "school": "LSU",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 15,
                    "school": "Notre Dame",
                    "conference": "FBS Independents",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 16,
                    "school": "Oregon State",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 17,
                    "school": "Tennessee",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 18,
                    "school": "Utah",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 19,
                    "school": "UCLA",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 20,
                    "school": "USC",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 21,
                    "school": "Kansas",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 22,
                    "school": "Oklahoma State",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 23,
                    "school": "Kansas State",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 24,
                    "school": "Tulane",
                    "conference": "American Athletic",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 25,
                    "school": "Air Force",
                    "conference": "Mountain West",
                    "firstPlaceVotes": 0,
                    "points": 0
                  }
                ]
              }
            ]
          }];

        global.fetch = jest.fn(() => Promise.resolve({
            json: () => Promise.resolve(rankings)
        }));

        var resultingScore = await scoringModule.calculateScoreV2(team, game, week);
        expect(resultingScore).toEqual(2);
    });
    
    it('Top 25 Ranked Conference Game Win', async () => {
        const team = "Arkansas";
        const game = {
            "_id": {
              "$oid": "65dfd87c1546400b2aeb7975"
            },
            "id": 401520363,
            "season": 2023,
            "week": 10,
            "seasonType": "regular",
            "startDate": "2023-11-04T16:00:00.000Z",
            "startTimeTbd": false,
            "completed": true,
            "neutralSite": false,
            "conferenceGame": true,
            "attendance": 89782,
            "venueId": 3634,
            "venue": "Ben Hill Griffin Stadium",
            "homeId": 57,
            "homeTeam": "Florida",
            "homeConference": "SEC",
            "homeDivision": "fbs",
            "homePoints": 36,
            "homeLineScores": [
              14,
              3,
              6,
              10,
              3
            ],
            "homePostWinProb": "0.08075347362469056",
            "homePregameElo": 1592,
            "homePostgameElo": 1588,
            "awayId": 8,
            "awayTeam": "Arkansas",
            "awayConference": "SEC",
            "awayDivision": "fbs",
            "awayPoints": 39,
            "awayLineScores": [
              14,
              3,
              3,
              13,
              6
            ],
            "awayPostWinProb": "0.9192465263753095",
            "awayPregameElo": 1596,
            "awayPostgameElo": 1600,
            "excitementIndex": "9.7718678848",
            "highlights": null,
            "notes": "test Arkansas game notes"
          };
        const week = 10;
        const rankings = [{
            "_id": {
              "$oid": "65de66651546400b2aeb6e64"
            },
            "season": 2023,
            "seasonType": "regular",
            "week": 10,
            "polls": [
              {
                "poll": "Coaches Poll",
                "ranks": [
                  {
                    "rank": 1,
                    "school": "Georgia",
                    "conference": "SEC",
                    "firstPlaceVotes": 58,
                    "points": 1590
                  },
                  {
                    "rank": 2,
                    "school": "Michigan",
                    "conference": "Big Ten",
                    "firstPlaceVotes": 3,
                    "points": 1520
                  },
                  {
                    "rank": 3,
                    "school": "Ohio State",
                    "conference": "Big Ten",
                    "firstPlaceVotes": 3,
                    "points": 1454
                  },
                  {
                    "rank": 4,
                    "school": "Florida State",
                    "conference": "ACC",
                    "firstPlaceVotes": 0,
                    "points": 1439
                  },
                  {
                    "rank": 5,
                    "school": "Washington",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 1344
                  },
                  {
                    "rank": 6,
                    "school": "Texas",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 1212
                  },
                  {
                    "rank": 7,
                    "school": "Oregon",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 1211
                  },
                  {
                    "rank": 8,
                    "school": "Alabama",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 1187
                  },
                  {
                    "rank": 9,
                    "school": "Penn State",
                    "conference": "Big Ten",
                    "firstPlaceVotes": 0,
                    "points": 1072
                  },
                  {
                    "rank": 10,
                    "school": "Ole Miss",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 1021
                  },
                  {
                    "rank": 11,
                    "school": "Oklahoma",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 948
                  },
                  {
                    "rank": 12,
                    "school": "Notre Dame",
                    "conference": "FBS Independents",
                    "firstPlaceVotes": 0,
                    "points": 847
                  },
                  {
                    "rank": 13,
                    "school": "LSU",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 809
                  },
                  {
                    "rank": 14,
                    "school": "Missouri",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 741
                  },
                  {
                    "rank": 15,
                    "school": "Louisville",
                    "conference": "ACC",
                    "firstPlaceVotes": 0,
                    "points": 701
                  },
                  {
                    "rank": 16,
                    "school": "Tennessee",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 553
                  },
                  {
                    "rank": 17,
                    "school": "Air Force",
                    "conference": "Mountain West",
                    "firstPlaceVotes": 0,
                    "points": 523
                  },
                  {
                    "rank": 18,
                    "school": "Utah",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 509
                  },
                  {
                    "rank": 19,
                    "school": "Oregon State",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 465
                  },
                  {
                    "rank": 20,
                    "school": "UCLA",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 309
                  },
                  {
                    "rank": 21,
                    "school": "Tulane",
                    "conference": "American Athletic",
                    "firstPlaceVotes": 0,
                    "points": 304
                  },
                  {
                    "rank": 22,
                    "school": "USC",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 239
                  },
                  {
                    "rank": 23,
                    "school": "Kansas",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 182
                  },
                  {
                    "rank": 24,
                    "school": "James Madison",
                    "conference": "Sun Belt",
                    "firstPlaceVotes": 0,
                    "points": 169
                  },
                  {
                    "rank": 25,
                    "school": "North Carolina",
                    "conference": "ACC",
                    "firstPlaceVotes": 0,
                    "points": 120
                  }
                ]
              },
              {
                "poll": "AP Top 25",
                "ranks": [
                  {
                    "rank": 1,
                    "school": "Georgia",
                    "conference": "SEC",
                    "firstPlaceVotes": 48,
                    "points": 1553
                  },
                  {
                    "rank": 2,
                    "school": "Michigan",
                    "conference": "Big Ten",
                    "firstPlaceVotes": 9,
                    "points": 1494
                  },
                  {
                    "rank": 3,
                    "school": "Ohio State",
                    "conference": "Big Ten",
                    "firstPlaceVotes": 3,
                    "points": 1446
                  },
                  {
                    "rank": 4,
                    "school": "Florida State",
                    "conference": "ACC",
                    "firstPlaceVotes": 3,
                    "points": 1421
                  },
                  {
                    "rank": 5,
                    "school": "Washington",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 1327
                  },
                  {
                    "rank": 6,
                    "school": "Oregon",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 1235
                  },
                  {
                    "rank": 7,
                    "school": "Texas",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 1189
                  },
                  {
                    "rank": 8,
                    "school": "Alabama",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 1114
                  },
                  {
                    "rank": 9,
                    "school": "Penn State",
                    "conference": "Big Ten",
                    "firstPlaceVotes": 0,
                    "points": 1044
                  },
                  {
                    "rank": 10,
                    "school": "Oklahoma",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 1010
                  },
                  {
                    "rank": 11,
                    "school": "Ole Miss",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 990
                  },
                  {
                    "rank": 12,
                    "school": "Notre Dame",
                    "conference": "FBS Independents",
                    "firstPlaceVotes": 0,
                    "points": 847
                  },
                  {
                    "rank": 13,
                    "school": "LSU",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 816
                  },
                  {
                    "rank": 14,
                    "school": "Missouri",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 714
                  },
                  {
                    "rank": 15,
                    "school": "Louisville",
                    "conference": "ACC",
                    "firstPlaceVotes": 0,
                    "points": 666
                  },
                  {
                    "rank": 16,
                    "school": "Oregon State",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 557
                  },
                  {
                    "rank": 17,
                    "school": "Air Force",
                    "conference": "Mountain West",
                    "firstPlaceVotes": 0,
                    "points": 526
                  },
                  {
                    "rank": 18,
                    "school": "Utah",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 510
                  },
                  {
                    "rank": 19,
                    "school": "Tennessee",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 473
                  },
                  {
                    "rank": 20,
                    "school": "UCLA",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 331
                  },
                  {
                    "rank": 21,
                    "school": "Tulane",
                    "conference": "American Athletic",
                    "firstPlaceVotes": 0,
                    "points": 303
                  },
                  {
                    "rank": 22,
                    "school": "Kansas",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 250
                  },
                  {
                    "rank": 23,
                    "school": "James Madison",
                    "conference": "Sun Belt",
                    "firstPlaceVotes": 0,
                    "points": 192
                  },
                  {
                    "rank": 24,
                    "school": "USC",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 139
                  },
                  {
                    "rank": 25,
                    "school": "Kansas State",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 112
                  }
                ]
              },
              {
                "poll": "FCS Coaches Poll",
                "ranks": [
                  {
                    "rank": 1,
                    "school": "South Dakota State",
                    "conference": "MVFC",
                    "firstPlaceVotes": 25,
                    "points": 625
                  },
                  {
                    "rank": 2,
                    "school": "Furman",
                    "conference": "Southern",
                    "firstPlaceVotes": 0,
                    "points": 577
                  },
                  {
                    "rank": 3,
                    "school": "Montana",
                    "conference": "Big Sky",
                    "firstPlaceVotes": 0,
                    "points": 544
                  },
                  {
                    "rank": 4,
                    "school": "Incarnate Word",
                    "conference": "Southland",
                    "firstPlaceVotes": 0,
                    "points": 533
                  },
                  {
                    "rank": 5,
                    "school": "Idaho",
                    "conference": "Big Sky",
                    "firstPlaceVotes": 0,
                    "points": 515
                  },
                  {
                    "rank": 6,
                    "school": "Delaware",
                    "conference": "CAA",
                    "firstPlaceVotes": 0,
                    "points": 507
                  },
                  {
                    "rank": 7,
                    "school": "Sacramento State",
                    "conference": "Big Sky",
                    "firstPlaceVotes": 0,
                    "points": 471
                  },
                  {
                    "rank": 8,
                    "school": "Montana State",
                    "conference": "Big Sky",
                    "firstPlaceVotes": 0,
                    "points": 458
                  },
                  {
                    "rank": 9,
                    "school": "North Carolina Central",
                    "conference": "MEAC",
                    "firstPlaceVotes": 0,
                    "points": 407
                  },
                  {
                    "rank": 10,
                    "school": "North Dakota State",
                    "conference": "MVFC",
                    "firstPlaceVotes": 0,
                    "points": 398
                  },
                  {
                    "rank": 11,
                    "school": "Southern Illinois",
                    "conference": "MVFC",
                    "firstPlaceVotes": 0,
                    "points": 380
                  },
                  {
                    "rank": 12,
                    "school": "South Dakota",
                    "conference": "MVFC",
                    "firstPlaceVotes": 0,
                    "points": 330
                  },
                  {
                    "rank": 13,
                    "school": "Florida A&M",
                    "conference": "SWAC",
                    "firstPlaceVotes": 0,
                    "points": 296
                  },
                  {
                    "rank": 13,
                    "school": "Chattanooga",
                    "conference": "Southern",
                    "firstPlaceVotes": 0,
                    "points": 296
                  },
                  {
                    "rank": 15,
                    "school": "North Dakota",
                    "conference": "MVFC",
                    "firstPlaceVotes": 0,
                    "points": 260
                  },
                  {
                    "rank": 16,
                    "school": "Lafayette",
                    "conference": "Patriot",
                    "firstPlaceVotes": 0,
                    "points": 241
                  },
                  {
                    "rank": 17,
                    "school": "Austin Peay",
                    "conference": "UAC",
                    "firstPlaceVotes": 0,
                    "points": 218
                  },
                  {
                    "rank": 18,
                    "school": "UT Martin",
                    "conference": "Big South-OVC",
                    "firstPlaceVotes": 0,
                    "points": 179
                  },
                  {
                    "rank": 19,
                    "school": "Harvard",
                    "conference": "Ivy",
                    "firstPlaceVotes": 0,
                    "points": 137
                  },
                  {
                    "rank": 20,
                    "school": "Western Carolina",
                    "conference": "Southern",
                    "firstPlaceVotes": 0,
                    "points": 124
                  },
                  {
                    "rank": 21,
                    "school": "Holy Cross",
                    "conference": "Patriot",
                    "firstPlaceVotes": 0,
                    "points": 120
                  },
                  {
                    "rank": 22,
                    "school": "Villanova",
                    "conference": "CAA",
                    "firstPlaceVotes": 0,
                    "points": 107
                  },
                  {
                    "rank": 23,
                    "school": "Northern Iowa",
                    "conference": "MVFC",
                    "firstPlaceVotes": 0,
                    "points": 105
                  },
                  {
                    "rank": 24,
                    "school": "William & Mary",
                    "conference": "CAA",
                    "firstPlaceVotes": 0,
                    "points": 83
                  },
                  {
                    "rank": 25,
                    "school": "Central Arkansas",
                    "conference": "UAC",
                    "firstPlaceVotes": 0,
                    "points": 73
                  }
                ]
              },
              {
                "poll": "AFCA Division II Coaches Poll",
                "ranks": [
                  {
                    "rank": 1,
                    "school": "Colorado Mines",
                    "conference": "Rocky Mountain",
                    "firstPlaceVotes": 26,
                    "points": 720
                  },
                  {
                    "rank": 2,
                    "school": "Pittsburg State",
                    "conference": "Mid America",
                    "firstPlaceVotes": 1,
                    "points": 694
                  },
                  {
                    "rank": 3,
                    "school": "Grand Valley State",
                    "conference": "GLIAC",
                    "firstPlaceVotes": 1,
                    "points": 662
                  },
                  {
                    "rank": 4,
                    "school": "Harding",
                    "conference": "Great American",
                    "firstPlaceVotes": 0,
                    "points": 637
                  },
                  {
                    "rank": 5,
                    "school": "Slippery Rock",
                    "conference": "Pennsylvania State Athletic",
                    "firstPlaceVotes": 1,
                    "points": 582
                  },
                  {
                    "rank": 6,
                    "school": "Benedict College",
                    "conference": "SIAC",
                    "firstPlaceVotes": 0,
                    "points": 573
                  },
                  {
                    "rank": 7,
                    "school": "Ferris State",
                    "conference": "GLIAC",
                    "firstPlaceVotes": 0,
                    "points": 534
                  },
                  {
                    "rank": 8,
                    "school": "Indianapolis",
                    "conference": "Great Lakes",
                    "firstPlaceVotes": 0,
                    "points": 503
                  },
                  {
                    "rank": 9,
                    "school": "Davenport",
                    "conference": "GLIAC",
                    "firstPlaceVotes": 0,
                    "points": 484
                  },
                  {
                    "rank": 10,
                    "school": "Minnesota State",
                    "conference": "Northern Sun",
                    "firstPlaceVotes": 0,
                    "points": 437
                  },
                  {
                    "rank": 11,
                    "school": "Central Missouri State",
                    "conference": "Mid America",
                    "firstPlaceVotes": 0,
                    "points": 406
                  },
                  {
                    "rank": 12,
                    "school": "Ouachita Baptist",
                    "conference": "Great American",
                    "firstPlaceVotes": 0,
                    "points": 399
                  },
                  {
                    "rank": 13,
                    "school": "Bemidji State",
                    "conference": "Northern Sun",
                    "firstPlaceVotes": 0,
                    "points": 353
                  },
                  {
                    "rank": 14,
                    "school": "Delta State",
                    "conference": "Gulf South",
                    "firstPlaceVotes": 0,
                    "points": 322
                  },
                  {
                    "rank": 15,
                    "school": "Western State",
                    "conference": "Rocky Mountain",
                    "firstPlaceVotes": 0,
                    "points": 321
                  },
                  {
                    "rank": 16,
                    "school": "Lenoir-Rhyne",
                    "conference": "South Atlantic",
                    "firstPlaceVotes": 0,
                    "points": 291
                  },
                  {
                    "rank": 17,
                    "school": "Tiffin",
                    "conference": "Great Midwest Athletic",
                    "firstPlaceVotes": 0,
                    "points": 282
                  },
                  {
                    "rank": 18,
                    "school": "University of Texas of the Permian Basin",
                    "conference": "Lone Star",
                    "firstPlaceVotes": 0,
                    "points": 228
                  },
                  {
                    "rank": 19,
                    "school": "Virginia Union",
                    "conference": "CIAA",
                    "firstPlaceVotes": 0,
                    "points": 210
                  },
                  {
                    "rank": 20,
                    "school": "Valdosta State",
                    "conference": "Gulf South",
                    "firstPlaceVotes": 0,
                    "points": 207
                  },
                  {
                    "rank": 21,
                    "school": "Augustana (SD)",
                    "conference": "Northern Sun",
                    "firstPlaceVotes": 0,
                    "points": 183
                  },
                  {
                    "rank": 22,
                    "school": "Virginia State",
                    "conference": "CIAA",
                    "firstPlaceVotes": 0,
                    "points": 86
                  },
                  {
                    "rank": 23,
                    "school": "Missouri Western",
                    "conference": "Mid America",
                    "firstPlaceVotes": 0,
                    "points": 69
                  },
                  {
                    "rank": 24,
                    "school": "Central Washington",
                    "conference": "Lone Star",
                    "firstPlaceVotes": 0,
                    "points": 54
                  },
                  {
                    "rank": 25,
                    "school": "Mars Hill",
                    "conference": "South Atlantic",
                    "firstPlaceVotes": 0,
                    "points": 43
                  }
                ]
              },
              {
                "poll": "AFCA Division III Coaches Poll",
                "ranks": [
                  {
                    "rank": 1,
                    "school": "North Central",
                    "conference": "CCIW",
                    "firstPlaceVotes": 48,
                    "points": 1224
                  },
                  {
                    "rank": 2,
                    "school": "Mount Union",
                    "conference": "Ohio",
                    "firstPlaceVotes": 1,
                    "points": 1173
                  },
                  {
                    "rank": 3,
                    "school": "Wartburg",
                    "conference": "American Rivers",
                    "firstPlaceVotes": 0,
                    "points": 1120
                  },
                  {
                    "rank": 4,
                    "school": "Linfield",
                    "conference": "Northwest",
                    "firstPlaceVotes": 0,
                    "points": 1024
                  },
                  {
                    "rank": 5,
                    "school": "Trinity (TX)",
                    "conference": "Southern Athletic",
                    "firstPlaceVotes": 0,
                    "points": 986
                  },
                  {
                    "rank": 6,
                    "school": "UW-Whitewater",
                    "conference": "Wisconsin",
                    "firstPlaceVotes": 0,
                    "points": 958
                  },
                  {
                    "rank": 7,
                    "school": "Wisconsin-La Crosse",
                    "conference": "Wisconsin",
                    "firstPlaceVotes": 0,
                    "points": 909
                  },
                  {
                    "rank": 8,
                    "school": "Johns Hopkins",
                    "conference": "Centennial",
                    "firstPlaceVotes": 0,
                    "points": 903
                  },
                  {
                    "rank": 9,
                    "school": "Randolph-Macon",
                    "conference": "Old Dominion",
                    "firstPlaceVotes": 0,
                    "points": 817
                  },
                  {
                    "rank": 10,
                    "school": "UW-River Falls",
                    "conference": "Wisconsin",
                    "firstPlaceVotes": 0,
                    "points": 779
                  },
                  {
                    "rank": 11,
                    "school": "Aurora",
                    "conference": "NACC",
                    "firstPlaceVotes": 0,
                    "points": 724
                  },
                  {
                    "rank": 12,
                    "school": "Susquehanna",
                    "conference": "Landmark Conference",
                    "firstPlaceVotes": 0,
                    "points": 688
                  },
                  {
                    "rank": 13,
                    "school": "Wheaton College (Ill)",
                    "conference": "CCIW",
                    "firstPlaceVotes": 0,
                    "points": 619
                  },
                  {
                    "rank": 14,
                    "school": "Alma College",
                    "conference": "Michigan",
                    "firstPlaceVotes": 0,
                    "points": 577
                  },
                  {
                    "rank": 15,
                    "school": "John Carroll",
                    "conference": "Ohio",
                    "firstPlaceVotes": 0,
                    "points": 549
                  },
                  {
                    "rank": 16,
                    "school": "Ithaca",
                    "conference": "Liberty League",
                    "firstPlaceVotes": 0,
                    "points": 457
                  },
                  {
                    "rank": 17,
                    "school": "SUNY Cortland",
                    "conference": "Empire 8",
                    "firstPlaceVotes": 0,
                    "points": 413
                  },
                  {
                    "rank": 18,
                    "school": "Endicott College",
                    "conference": "Commonwealth Coast",
                    "firstPlaceVotes": 0,
                    "points": 342
                  },
                  {
                    "rank": 19,
                    "school": "Hardin-Simmons",
                    "conference": "American Southwest",
                    "firstPlaceVotes": 0,
                    "points": 288
                  },
                  {
                    "rank": 20,
                    "school": "Grove City College",
                    "conference": "Presidents'",
                    "firstPlaceVotes": 0,
                    "points": 275
                  },
                  {
                    "rank": 21,
                    "school": "St. Johns (MN)",
                    "conference": "Minnesota",
                    "firstPlaceVotes": 0,
                    "points": 262
                  },
                  {
                    "rank": 22,
                    "school": "Muhlenberg",
                    "conference": "Centennial",
                    "firstPlaceVotes": 0,
                    "points": 230
                  },
                  {
                    "rank": 23,
                    "school": "DePauw",
                    "conference": "North Coast",
                    "firstPlaceVotes": 0,
                    "points": 183
                  },
                  {
                    "rank": 24,
                    "school": "Delaware Valley",
                    "conference": "Mid Atlantic",
                    "firstPlaceVotes": 0,
                    "points": 114
                  },
                  {
                    "rank": 25,
                    "school": "Berry College",
                    "conference": "Southern Athletic",
                    "firstPlaceVotes": 0,
                    "points": 99
                  }
                ]
              },
              {
                "poll": "Playoff Committee Rankings",
                "ranks": [
                  {
                    "rank": 1,
                    "school": "Ohio State",
                    "conference": "Big Ten",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 2,
                    "school": "Georgia",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 3,
                    "school": "Michigan",
                    "conference": "Big Ten",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 4,
                    "school": "Florida State",
                    "conference": "ACC",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 5,
                    "school": "Washington",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 6,
                    "school": "Oregon",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 7,
                    "school": "Texas",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 8,
                    "school": "Alabama",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 9,
                    "school": "Oklahoma",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 10,
                    "school": "Ole Miss",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 11,
                    "school": "Penn State",
                    "conference": "Big Ten",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 12,
                    "school": "Missouri",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 13,
                    "school": "Louisville",
                    "conference": "ACC",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 14,
                    "school": "LSU",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 15,
                    "school": "Notre Dame",
                    "conference": "FBS Independents",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 16,
                    "school": "Oregon State",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 17,
                    "school": "Tennessee",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 18,
                    "school": "Florida",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 19,
                    "school": "UCLA",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 20,
                    "school": "USC",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 21,
                    "school": "Kansas",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 22,
                    "school": "Oklahoma State",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 23,
                    "school": "Kansas State",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 24,
                    "school": "Tulane",
                    "conference": "American Athletic",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 25,
                    "school": "Air Force",
                    "conference": "Mountain West",
                    "firstPlaceVotes": 0,
                    "points": 0
                  }
                ]
              }
            ]
          }];

        global.fetch = jest.fn(() => Promise.resolve({
            json: () => Promise.resolve(rankings)
        }));

        var resultingScore = await scoringModule.calculateScoreV2(team, game, week);
        expect(resultingScore).toEqual(3);
    });
    
    it('Top 10 Ranked Conference Game Win', async () => {
        const team = "Arkansas";
        const game = {
            "_id": {
              "$oid": "65dfd87c1546400b2aeb7975"
            },
            "id": 401520363,
            "season": 2023,
            "week": 10,
            "seasonType": "regular",
            "startDate": "2023-11-04T16:00:00.000Z",
            "startTimeTbd": false,
            "completed": true,
            "neutralSite": false,
            "conferenceGame": true,
            "attendance": 89782,
            "venueId": 3634,
            "venue": "Ben Hill Griffin Stadium",
            "homeId": 57,
            "homeTeam": "Florida",
            "homeConference": "SEC",
            "homeDivision": "fbs",
            "homePoints": 36,
            "homeLineScores": [
              14,
              3,
              6,
              10,
              3
            ],
            "homePostWinProb": "0.08075347362469056",
            "homePregameElo": 1592,
            "homePostgameElo": 1588,
            "awayId": 8,
            "awayTeam": "Arkansas",
            "awayConference": "SEC",
            "awayDivision": "fbs",
            "awayPoints": 39,
            "awayLineScores": [
              14,
              3,
              3,
              13,
              6
            ],
            "awayPostWinProb": "0.9192465263753095",
            "awayPregameElo": 1596,
            "awayPostgameElo": 1600,
            "excitementIndex": "9.7718678848",
            "highlights": null,
            "notes": "test Arkansas game notes"
          };
        const week = 10;
        const rankings = [{
            "_id": {
              "$oid": "65de66651546400b2aeb6e64"
            },
            "season": 2023,
            "seasonType": "regular",
            "week": 10,
            "polls": [
              {
                "poll": "Coaches Poll",
                "ranks": [
                  {
                    "rank": 1,
                    "school": "Georgia",
                    "conference": "SEC",
                    "firstPlaceVotes": 58,
                    "points": 1590
                  },
                  {
                    "rank": 2,
                    "school": "Michigan",
                    "conference": "Big Ten",
                    "firstPlaceVotes": 3,
                    "points": 1520
                  },
                  {
                    "rank": 3,
                    "school": "Ohio State",
                    "conference": "Big Ten",
                    "firstPlaceVotes": 3,
                    "points": 1454
                  },
                  {
                    "rank": 4,
                    "school": "Florida State",
                    "conference": "ACC",
                    "firstPlaceVotes": 0,
                    "points": 1439
                  },
                  {
                    "rank": 5,
                    "school": "Washington",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 1344
                  },
                  {
                    "rank": 6,
                    "school": "Texas",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 1212
                  },
                  {
                    "rank": 7,
                    "school": "Oregon",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 1211
                  },
                  {
                    "rank": 8,
                    "school": "Alabama",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 1187
                  },
                  {
                    "rank": 9,
                    "school": "Penn State",
                    "conference": "Big Ten",
                    "firstPlaceVotes": 0,
                    "points": 1072
                  },
                  {
                    "rank": 10,
                    "school": "Ole Miss",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 1021
                  },
                  {
                    "rank": 11,
                    "school": "Oklahoma",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 948
                  },
                  {
                    "rank": 12,
                    "school": "Notre Dame",
                    "conference": "FBS Independents",
                    "firstPlaceVotes": 0,
                    "points": 847
                  },
                  {
                    "rank": 13,
                    "school": "LSU",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 809
                  },
                  {
                    "rank": 14,
                    "school": "Missouri",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 741
                  },
                  {
                    "rank": 15,
                    "school": "Louisville",
                    "conference": "ACC",
                    "firstPlaceVotes": 0,
                    "points": 701
                  },
                  {
                    "rank": 16,
                    "school": "Tennessee",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 553
                  },
                  {
                    "rank": 17,
                    "school": "Air Force",
                    "conference": "Mountain West",
                    "firstPlaceVotes": 0,
                    "points": 523
                  },
                  {
                    "rank": 18,
                    "school": "Utah",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 509
                  },
                  {
                    "rank": 19,
                    "school": "Oregon State",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 465
                  },
                  {
                    "rank": 20,
                    "school": "UCLA",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 309
                  },
                  {
                    "rank": 21,
                    "school": "Tulane",
                    "conference": "American Athletic",
                    "firstPlaceVotes": 0,
                    "points": 304
                  },
                  {
                    "rank": 22,
                    "school": "USC",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 239
                  },
                  {
                    "rank": 23,
                    "school": "Kansas",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 182
                  },
                  {
                    "rank": 24,
                    "school": "James Madison",
                    "conference": "Sun Belt",
                    "firstPlaceVotes": 0,
                    "points": 169
                  },
                  {
                    "rank": 25,
                    "school": "North Carolina",
                    "conference": "ACC",
                    "firstPlaceVotes": 0,
                    "points": 120
                  }
                ]
              },
              {
                "poll": "AP Top 25",
                "ranks": [
                  {
                    "rank": 1,
                    "school": "Georgia",
                    "conference": "SEC",
                    "firstPlaceVotes": 48,
                    "points": 1553
                  },
                  {
                    "rank": 2,
                    "school": "Michigan",
                    "conference": "Big Ten",
                    "firstPlaceVotes": 9,
                    "points": 1494
                  },
                  {
                    "rank": 3,
                    "school": "Ohio State",
                    "conference": "Big Ten",
                    "firstPlaceVotes": 3,
                    "points": 1446
                  },
                  {
                    "rank": 4,
                    "school": "Florida State",
                    "conference": "ACC",
                    "firstPlaceVotes": 3,
                    "points": 1421
                  },
                  {
                    "rank": 5,
                    "school": "Washington",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 1327
                  },
                  {
                    "rank": 6,
                    "school": "Oregon",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 1235
                  },
                  {
                    "rank": 7,
                    "school": "Texas",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 1189
                  },
                  {
                    "rank": 8,
                    "school": "Alabama",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 1114
                  },
                  {
                    "rank": 9,
                    "school": "Penn State",
                    "conference": "Big Ten",
                    "firstPlaceVotes": 0,
                    "points": 1044
                  },
                  {
                    "rank": 10,
                    "school": "Oklahoma",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 1010
                  },
                  {
                    "rank": 11,
                    "school": "Ole Miss",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 990
                  },
                  {
                    "rank": 12,
                    "school": "Notre Dame",
                    "conference": "FBS Independents",
                    "firstPlaceVotes": 0,
                    "points": 847
                  },
                  {
                    "rank": 13,
                    "school": "LSU",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 816
                  },
                  {
                    "rank": 14,
                    "school": "Missouri",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 714
                  },
                  {
                    "rank": 15,
                    "school": "Louisville",
                    "conference": "ACC",
                    "firstPlaceVotes": 0,
                    "points": 666
                  },
                  {
                    "rank": 16,
                    "school": "Oregon State",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 557
                  },
                  {
                    "rank": 17,
                    "school": "Air Force",
                    "conference": "Mountain West",
                    "firstPlaceVotes": 0,
                    "points": 526
                  },
                  {
                    "rank": 18,
                    "school": "Utah",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 510
                  },
                  {
                    "rank": 19,
                    "school": "Tennessee",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 473
                  },
                  {
                    "rank": 20,
                    "school": "UCLA",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 331
                  },
                  {
                    "rank": 21,
                    "school": "Tulane",
                    "conference": "American Athletic",
                    "firstPlaceVotes": 0,
                    "points": 303
                  },
                  {
                    "rank": 22,
                    "school": "Kansas",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 250
                  },
                  {
                    "rank": 23,
                    "school": "James Madison",
                    "conference": "Sun Belt",
                    "firstPlaceVotes": 0,
                    "points": 192
                  },
                  {
                    "rank": 24,
                    "school": "USC",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 139
                  },
                  {
                    "rank": 25,
                    "school": "Kansas State",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 112
                  }
                ]
              },
              {
                "poll": "FCS Coaches Poll",
                "ranks": [
                  {
                    "rank": 1,
                    "school": "South Dakota State",
                    "conference": "MVFC",
                    "firstPlaceVotes": 25,
                    "points": 625
                  },
                  {
                    "rank": 2,
                    "school": "Furman",
                    "conference": "Southern",
                    "firstPlaceVotes": 0,
                    "points": 577
                  },
                  {
                    "rank": 3,
                    "school": "Montana",
                    "conference": "Big Sky",
                    "firstPlaceVotes": 0,
                    "points": 544
                  },
                  {
                    "rank": 4,
                    "school": "Incarnate Word",
                    "conference": "Southland",
                    "firstPlaceVotes": 0,
                    "points": 533
                  },
                  {
                    "rank": 5,
                    "school": "Idaho",
                    "conference": "Big Sky",
                    "firstPlaceVotes": 0,
                    "points": 515
                  },
                  {
                    "rank": 6,
                    "school": "Delaware",
                    "conference": "CAA",
                    "firstPlaceVotes": 0,
                    "points": 507
                  },
                  {
                    "rank": 7,
                    "school": "Sacramento State",
                    "conference": "Big Sky",
                    "firstPlaceVotes": 0,
                    "points": 471
                  },
                  {
                    "rank": 8,
                    "school": "Montana State",
                    "conference": "Big Sky",
                    "firstPlaceVotes": 0,
                    "points": 458
                  },
                  {
                    "rank": 9,
                    "school": "North Carolina Central",
                    "conference": "MEAC",
                    "firstPlaceVotes": 0,
                    "points": 407
                  },
                  {
                    "rank": 10,
                    "school": "North Dakota State",
                    "conference": "MVFC",
                    "firstPlaceVotes": 0,
                    "points": 398
                  },
                  {
                    "rank": 11,
                    "school": "Southern Illinois",
                    "conference": "MVFC",
                    "firstPlaceVotes": 0,
                    "points": 380
                  },
                  {
                    "rank": 12,
                    "school": "South Dakota",
                    "conference": "MVFC",
                    "firstPlaceVotes": 0,
                    "points": 330
                  },
                  {
                    "rank": 13,
                    "school": "Florida A&M",
                    "conference": "SWAC",
                    "firstPlaceVotes": 0,
                    "points": 296
                  },
                  {
                    "rank": 13,
                    "school": "Chattanooga",
                    "conference": "Southern",
                    "firstPlaceVotes": 0,
                    "points": 296
                  },
                  {
                    "rank": 15,
                    "school": "North Dakota",
                    "conference": "MVFC",
                    "firstPlaceVotes": 0,
                    "points": 260
                  },
                  {
                    "rank": 16,
                    "school": "Lafayette",
                    "conference": "Patriot",
                    "firstPlaceVotes": 0,
                    "points": 241
                  },
                  {
                    "rank": 17,
                    "school": "Austin Peay",
                    "conference": "UAC",
                    "firstPlaceVotes": 0,
                    "points": 218
                  },
                  {
                    "rank": 18,
                    "school": "UT Martin",
                    "conference": "Big South-OVC",
                    "firstPlaceVotes": 0,
                    "points": 179
                  },
                  {
                    "rank": 19,
                    "school": "Harvard",
                    "conference": "Ivy",
                    "firstPlaceVotes": 0,
                    "points": 137
                  },
                  {
                    "rank": 20,
                    "school": "Western Carolina",
                    "conference": "Southern",
                    "firstPlaceVotes": 0,
                    "points": 124
                  },
                  {
                    "rank": 21,
                    "school": "Holy Cross",
                    "conference": "Patriot",
                    "firstPlaceVotes": 0,
                    "points": 120
                  },
                  {
                    "rank": 22,
                    "school": "Villanova",
                    "conference": "CAA",
                    "firstPlaceVotes": 0,
                    "points": 107
                  },
                  {
                    "rank": 23,
                    "school": "Northern Iowa",
                    "conference": "MVFC",
                    "firstPlaceVotes": 0,
                    "points": 105
                  },
                  {
                    "rank": 24,
                    "school": "William & Mary",
                    "conference": "CAA",
                    "firstPlaceVotes": 0,
                    "points": 83
                  },
                  {
                    "rank": 25,
                    "school": "Central Arkansas",
                    "conference": "UAC",
                    "firstPlaceVotes": 0,
                    "points": 73
                  }
                ]
              },
              {
                "poll": "AFCA Division II Coaches Poll",
                "ranks": [
                  {
                    "rank": 1,
                    "school": "Colorado Mines",
                    "conference": "Rocky Mountain",
                    "firstPlaceVotes": 26,
                    "points": 720
                  },
                  {
                    "rank": 2,
                    "school": "Pittsburg State",
                    "conference": "Mid America",
                    "firstPlaceVotes": 1,
                    "points": 694
                  },
                  {
                    "rank": 3,
                    "school": "Grand Valley State",
                    "conference": "GLIAC",
                    "firstPlaceVotes": 1,
                    "points": 662
                  },
                  {
                    "rank": 4,
                    "school": "Harding",
                    "conference": "Great American",
                    "firstPlaceVotes": 0,
                    "points": 637
                  },
                  {
                    "rank": 5,
                    "school": "Slippery Rock",
                    "conference": "Pennsylvania State Athletic",
                    "firstPlaceVotes": 1,
                    "points": 582
                  },
                  {
                    "rank": 6,
                    "school": "Benedict College",
                    "conference": "SIAC",
                    "firstPlaceVotes": 0,
                    "points": 573
                  },
                  {
                    "rank": 7,
                    "school": "Ferris State",
                    "conference": "GLIAC",
                    "firstPlaceVotes": 0,
                    "points": 534
                  },
                  {
                    "rank": 8,
                    "school": "Indianapolis",
                    "conference": "Great Lakes",
                    "firstPlaceVotes": 0,
                    "points": 503
                  },
                  {
                    "rank": 9,
                    "school": "Davenport",
                    "conference": "GLIAC",
                    "firstPlaceVotes": 0,
                    "points": 484
                  },
                  {
                    "rank": 10,
                    "school": "Minnesota State",
                    "conference": "Northern Sun",
                    "firstPlaceVotes": 0,
                    "points": 437
                  },
                  {
                    "rank": 11,
                    "school": "Central Missouri State",
                    "conference": "Mid America",
                    "firstPlaceVotes": 0,
                    "points": 406
                  },
                  {
                    "rank": 12,
                    "school": "Ouachita Baptist",
                    "conference": "Great American",
                    "firstPlaceVotes": 0,
                    "points": 399
                  },
                  {
                    "rank": 13,
                    "school": "Bemidji State",
                    "conference": "Northern Sun",
                    "firstPlaceVotes": 0,
                    "points": 353
                  },
                  {
                    "rank": 14,
                    "school": "Delta State",
                    "conference": "Gulf South",
                    "firstPlaceVotes": 0,
                    "points": 322
                  },
                  {
                    "rank": 15,
                    "school": "Western State",
                    "conference": "Rocky Mountain",
                    "firstPlaceVotes": 0,
                    "points": 321
                  },
                  {
                    "rank": 16,
                    "school": "Lenoir-Rhyne",
                    "conference": "South Atlantic",
                    "firstPlaceVotes": 0,
                    "points": 291
                  },
                  {
                    "rank": 17,
                    "school": "Tiffin",
                    "conference": "Great Midwest Athletic",
                    "firstPlaceVotes": 0,
                    "points": 282
                  },
                  {
                    "rank": 18,
                    "school": "University of Texas of the Permian Basin",
                    "conference": "Lone Star",
                    "firstPlaceVotes": 0,
                    "points": 228
                  },
                  {
                    "rank": 19,
                    "school": "Virginia Union",
                    "conference": "CIAA",
                    "firstPlaceVotes": 0,
                    "points": 210
                  },
                  {
                    "rank": 20,
                    "school": "Valdosta State",
                    "conference": "Gulf South",
                    "firstPlaceVotes": 0,
                    "points": 207
                  },
                  {
                    "rank": 21,
                    "school": "Augustana (SD)",
                    "conference": "Northern Sun",
                    "firstPlaceVotes": 0,
                    "points": 183
                  },
                  {
                    "rank": 22,
                    "school": "Virginia State",
                    "conference": "CIAA",
                    "firstPlaceVotes": 0,
                    "points": 86
                  },
                  {
                    "rank": 23,
                    "school": "Missouri Western",
                    "conference": "Mid America",
                    "firstPlaceVotes": 0,
                    "points": 69
                  },
                  {
                    "rank": 24,
                    "school": "Central Washington",
                    "conference": "Lone Star",
                    "firstPlaceVotes": 0,
                    "points": 54
                  },
                  {
                    "rank": 25,
                    "school": "Mars Hill",
                    "conference": "South Atlantic",
                    "firstPlaceVotes": 0,
                    "points": 43
                  }
                ]
              },
              {
                "poll": "AFCA Division III Coaches Poll",
                "ranks": [
                  {
                    "rank": 1,
                    "school": "North Central",
                    "conference": "CCIW",
                    "firstPlaceVotes": 48,
                    "points": 1224
                  },
                  {
                    "rank": 2,
                    "school": "Mount Union",
                    "conference": "Ohio",
                    "firstPlaceVotes": 1,
                    "points": 1173
                  },
                  {
                    "rank": 3,
                    "school": "Wartburg",
                    "conference": "American Rivers",
                    "firstPlaceVotes": 0,
                    "points": 1120
                  },
                  {
                    "rank": 4,
                    "school": "Linfield",
                    "conference": "Northwest",
                    "firstPlaceVotes": 0,
                    "points": 1024
                  },
                  {
                    "rank": 5,
                    "school": "Trinity (TX)",
                    "conference": "Southern Athletic",
                    "firstPlaceVotes": 0,
                    "points": 986
                  },
                  {
                    "rank": 6,
                    "school": "UW-Whitewater",
                    "conference": "Wisconsin",
                    "firstPlaceVotes": 0,
                    "points": 958
                  },
                  {
                    "rank": 7,
                    "school": "Wisconsin-La Crosse",
                    "conference": "Wisconsin",
                    "firstPlaceVotes": 0,
                    "points": 909
                  },
                  {
                    "rank": 8,
                    "school": "Johns Hopkins",
                    "conference": "Centennial",
                    "firstPlaceVotes": 0,
                    "points": 903
                  },
                  {
                    "rank": 9,
                    "school": "Randolph-Macon",
                    "conference": "Old Dominion",
                    "firstPlaceVotes": 0,
                    "points": 817
                  },
                  {
                    "rank": 10,
                    "school": "UW-River Falls",
                    "conference": "Wisconsin",
                    "firstPlaceVotes": 0,
                    "points": 779
                  },
                  {
                    "rank": 11,
                    "school": "Aurora",
                    "conference": "NACC",
                    "firstPlaceVotes": 0,
                    "points": 724
                  },
                  {
                    "rank": 12,
                    "school": "Susquehanna",
                    "conference": "Landmark Conference",
                    "firstPlaceVotes": 0,
                    "points": 688
                  },
                  {
                    "rank": 13,
                    "school": "Wheaton College (Ill)",
                    "conference": "CCIW",
                    "firstPlaceVotes": 0,
                    "points": 619
                  },
                  {
                    "rank": 14,
                    "school": "Alma College",
                    "conference": "Michigan",
                    "firstPlaceVotes": 0,
                    "points": 577
                  },
                  {
                    "rank": 15,
                    "school": "John Carroll",
                    "conference": "Ohio",
                    "firstPlaceVotes": 0,
                    "points": 549
                  },
                  {
                    "rank": 16,
                    "school": "Ithaca",
                    "conference": "Liberty League",
                    "firstPlaceVotes": 0,
                    "points": 457
                  },
                  {
                    "rank": 17,
                    "school": "SUNY Cortland",
                    "conference": "Empire 8",
                    "firstPlaceVotes": 0,
                    "points": 413
                  },
                  {
                    "rank": 18,
                    "school": "Endicott College",
                    "conference": "Commonwealth Coast",
                    "firstPlaceVotes": 0,
                    "points": 342
                  },
                  {
                    "rank": 19,
                    "school": "Hardin-Simmons",
                    "conference": "American Southwest",
                    "firstPlaceVotes": 0,
                    "points": 288
                  },
                  {
                    "rank": 20,
                    "school": "Grove City College",
                    "conference": "Presidents'",
                    "firstPlaceVotes": 0,
                    "points": 275
                  },
                  {
                    "rank": 21,
                    "school": "St. Johns (MN)",
                    "conference": "Minnesota",
                    "firstPlaceVotes": 0,
                    "points": 262
                  },
                  {
                    "rank": 22,
                    "school": "Muhlenberg",
                    "conference": "Centennial",
                    "firstPlaceVotes": 0,
                    "points": 230
                  },
                  {
                    "rank": 23,
                    "school": "DePauw",
                    "conference": "North Coast",
                    "firstPlaceVotes": 0,
                    "points": 183
                  },
                  {
                    "rank": 24,
                    "school": "Delaware Valley",
                    "conference": "Mid Atlantic",
                    "firstPlaceVotes": 0,
                    "points": 114
                  },
                  {
                    "rank": 25,
                    "school": "Berry College",
                    "conference": "Southern Athletic",
                    "firstPlaceVotes": 0,
                    "points": 99
                  }
                ]
              },
              {
                "poll": "Playoff Committee Rankings",
                "ranks": [
                  {
                    "rank": 1,
                    "school": "Ohio State",
                    "conference": "Big Ten",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 2,
                    "school": "Georgia",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 3,
                    "school": "Michigan",
                    "conference": "Big Ten",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 4,
                    "school": "Florida State",
                    "conference": "ACC",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 5,
                    "school": "Washington",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 6,
                    "school": "Oregon",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 7,
                    "school": "Texas",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 8,
                    "school": "Alabama",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 9,
                    "school": "Florida",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 10,
                    "school": "Ole Miss",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 11,
                    "school": "Penn State",
                    "conference": "Big Ten",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 12,
                    "school": "Missouri",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 13,
                    "school": "Louisville",
                    "conference": "ACC",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 14,
                    "school": "LSU",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 15,
                    "school": "Notre Dame",
                    "conference": "FBS Independents",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 16,
                    "school": "Oregon State",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 17,
                    "school": "Tennessee",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 18,
                    "school": "Utah",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 19,
                    "school": "UCLA",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 20,
                    "school": "USC",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 21,
                    "school": "Kansas",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 22,
                    "school": "Oklahoma State",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 23,
                    "school": "Kansas State",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 24,
                    "school": "Tulane",
                    "conference": "American Athletic",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 25,
                    "school": "Air Force",
                    "conference": "Mountain West",
                    "firstPlaceVotes": 0,
                    "points": 0
                  }
                ]
              }
            ]
          }];

        global.fetch = jest.fn(() => Promise.resolve({
            json: () => Promise.resolve(rankings)
        }));

        var resultingScore = await scoringModule.calculateScoreV2(team, game, week);
        expect(resultingScore).toEqual(4);
    });
    
    it('Non Power 5 Win over Power 5 Opponent', async () => {
        const team = "Tulane";
        const game = {
            "_id": {
              "$oid": "65dfd87c1546400b2aeb7975"
            },
            "season": 2023,
            "week": 2,
            "seasonType": "regular",
            "startDate": "2023-09-09T19:30:00.000Z",
            "startTimeTbd": false,
            "completed": true,
            "neutralSite": false,
            "conferenceGame": false,
            "attendance": 30000,
            "venueId": 4729,
            "venue": "Benson Field at Yulman Stadium",
            "homeId": 2655,
            "homeTeam": "Tulane",
            "homeConference": "American Athletic",
            "homeDivision": "fbs",
            "homePoints": 40,
            "homeLineScores": [
                17,
                10,
                10,
                3
            ],
            "homePostWinProb": "0.0508540891906328",
            "homePregameElo": 1671,
            "homePostgameElo": 1621,
            "awayId": 8,
            "awayTeam": "Arkansas",
            "awayConference": "SEC",
            "awayDivision": "fbs",
            "awayPoints": 39,
            "awayLineScores": [
              14,
              3,
              3,
              13,
              6
            ],
            "awayPostWinProb": "0.9192465263753095",
            "awayPregameElo": 1596,
            "awayPostgameElo": 1600,
            "excitementIndex": "9.7718678848",
            "highlights": null,
            "notes": "test Arkansas game notes"
          };
        const week = 10;
        const rankings = [{
            "_id": {
              "$oid": "65de66651546400b2aeb6e64"
            },
            "season": 2023,
            "seasonType": "regular",
            "week": 10,
            "polls": [
              {
                "poll": "Coaches Poll",
                "ranks": [
                  {
                    "rank": 1,
                    "school": "Georgia",
                    "conference": "SEC",
                    "firstPlaceVotes": 58,
                    "points": 1590
                  },
                  {
                    "rank": 2,
                    "school": "Michigan",
                    "conference": "Big Ten",
                    "firstPlaceVotes": 3,
                    "points": 1520
                  },
                  {
                    "rank": 3,
                    "school": "Ohio State",
                    "conference": "Big Ten",
                    "firstPlaceVotes": 3,
                    "points": 1454
                  },
                  {
                    "rank": 4,
                    "school": "Florida State",
                    "conference": "ACC",
                    "firstPlaceVotes": 0,
                    "points": 1439
                  },
                  {
                    "rank": 5,
                    "school": "Washington",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 1344
                  },
                  {
                    "rank": 6,
                    "school": "Texas",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 1212
                  },
                  {
                    "rank": 7,
                    "school": "Oregon",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 1211
                  },
                  {
                    "rank": 8,
                    "school": "Alabama",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 1187
                  },
                  {
                    "rank": 9,
                    "school": "Penn State",
                    "conference": "Big Ten",
                    "firstPlaceVotes": 0,
                    "points": 1072
                  },
                  {
                    "rank": 10,
                    "school": "Ole Miss",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 1021
                  },
                  {
                    "rank": 11,
                    "school": "Oklahoma",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 948
                  },
                  {
                    "rank": 12,
                    "school": "Notre Dame",
                    "conference": "FBS Independents",
                    "firstPlaceVotes": 0,
                    "points": 847
                  },
                  {
                    "rank": 13,
                    "school": "LSU",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 809
                  },
                  {
                    "rank": 14,
                    "school": "Missouri",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 741
                  },
                  {
                    "rank": 15,
                    "school": "Louisville",
                    "conference": "ACC",
                    "firstPlaceVotes": 0,
                    "points": 701
                  },
                  {
                    "rank": 16,
                    "school": "Tennessee",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 553
                  },
                  {
                    "rank": 17,
                    "school": "Air Force",
                    "conference": "Mountain West",
                    "firstPlaceVotes": 0,
                    "points": 523
                  },
                  {
                    "rank": 18,
                    "school": "Utah",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 509
                  },
                  {
                    "rank": 19,
                    "school": "Oregon State",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 465
                  },
                  {
                    "rank": 20,
                    "school": "UCLA",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 309
                  },
                  {
                    "rank": 21,
                    "school": "Tulane",
                    "conference": "American Athletic",
                    "firstPlaceVotes": 0,
                    "points": 304
                  },
                  {
                    "rank": 22,
                    "school": "USC",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 239
                  },
                  {
                    "rank": 23,
                    "school": "Kansas",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 182
                  },
                  {
                    "rank": 24,
                    "school": "James Madison",
                    "conference": "Sun Belt",
                    "firstPlaceVotes": 0,
                    "points": 169
                  },
                  {
                    "rank": 25,
                    "school": "North Carolina",
                    "conference": "ACC",
                    "firstPlaceVotes": 0,
                    "points": 120
                  }
                ]
              },
              {
                "poll": "AP Top 25",
                "ranks": [
                  {
                    "rank": 1,
                    "school": "Georgia",
                    "conference": "SEC",
                    "firstPlaceVotes": 48,
                    "points": 1553
                  },
                  {
                    "rank": 2,
                    "school": "Michigan",
                    "conference": "Big Ten",
                    "firstPlaceVotes": 9,
                    "points": 1494
                  },
                  {
                    "rank": 3,
                    "school": "Ohio State",
                    "conference": "Big Ten",
                    "firstPlaceVotes": 3,
                    "points": 1446
                  },
                  {
                    "rank": 4,
                    "school": "Florida State",
                    "conference": "ACC",
                    "firstPlaceVotes": 3,
                    "points": 1421
                  },
                  {
                    "rank": 5,
                    "school": "Washington",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 1327
                  },
                  {
                    "rank": 6,
                    "school": "Oregon",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 1235
                  },
                  {
                    "rank": 7,
                    "school": "Texas",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 1189
                  },
                  {
                    "rank": 8,
                    "school": "Alabama",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 1114
                  },
                  {
                    "rank": 9,
                    "school": "Penn State",
                    "conference": "Big Ten",
                    "firstPlaceVotes": 0,
                    "points": 1044
                  },
                  {
                    "rank": 10,
                    "school": "Oklahoma",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 1010
                  },
                  {
                    "rank": 11,
                    "school": "Ole Miss",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 990
                  },
                  {
                    "rank": 12,
                    "school": "Notre Dame",
                    "conference": "FBS Independents",
                    "firstPlaceVotes": 0,
                    "points": 847
                  },
                  {
                    "rank": 13,
                    "school": "LSU",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 816
                  },
                  {
                    "rank": 14,
                    "school": "Missouri",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 714
                  },
                  {
                    "rank": 15,
                    "school": "Louisville",
                    "conference": "ACC",
                    "firstPlaceVotes": 0,
                    "points": 666
                  },
                  {
                    "rank": 16,
                    "school": "Oregon State",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 557
                  },
                  {
                    "rank": 17,
                    "school": "Air Force",
                    "conference": "Mountain West",
                    "firstPlaceVotes": 0,
                    "points": 526
                  },
                  {
                    "rank": 18,
                    "school": "Utah",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 510
                  },
                  {
                    "rank": 19,
                    "school": "Tennessee",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 473
                  },
                  {
                    "rank": 20,
                    "school": "UCLA",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 331
                  },
                  {
                    "rank": 21,
                    "school": "Tulane",
                    "conference": "American Athletic",
                    "firstPlaceVotes": 0,
                    "points": 303
                  },
                  {
                    "rank": 22,
                    "school": "Kansas",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 250
                  },
                  {
                    "rank": 23,
                    "school": "James Madison",
                    "conference": "Sun Belt",
                    "firstPlaceVotes": 0,
                    "points": 192
                  },
                  {
                    "rank": 24,
                    "school": "USC",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 139
                  },
                  {
                    "rank": 25,
                    "school": "Kansas State",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 112
                  }
                ]
              },
              {
                "poll": "FCS Coaches Poll",
                "ranks": [
                  {
                    "rank": 1,
                    "school": "South Dakota State",
                    "conference": "MVFC",
                    "firstPlaceVotes": 25,
                    "points": 625
                  },
                  {
                    "rank": 2,
                    "school": "Furman",
                    "conference": "Southern",
                    "firstPlaceVotes": 0,
                    "points": 577
                  },
                  {
                    "rank": 3,
                    "school": "Montana",
                    "conference": "Big Sky",
                    "firstPlaceVotes": 0,
                    "points": 544
                  },
                  {
                    "rank": 4,
                    "school": "Incarnate Word",
                    "conference": "Southland",
                    "firstPlaceVotes": 0,
                    "points": 533
                  },
                  {
                    "rank": 5,
                    "school": "Idaho",
                    "conference": "Big Sky",
                    "firstPlaceVotes": 0,
                    "points": 515
                  },
                  {
                    "rank": 6,
                    "school": "Delaware",
                    "conference": "CAA",
                    "firstPlaceVotes": 0,
                    "points": 507
                  },
                  {
                    "rank": 7,
                    "school": "Sacramento State",
                    "conference": "Big Sky",
                    "firstPlaceVotes": 0,
                    "points": 471
                  },
                  {
                    "rank": 8,
                    "school": "Montana State",
                    "conference": "Big Sky",
                    "firstPlaceVotes": 0,
                    "points": 458
                  },
                  {
                    "rank": 9,
                    "school": "North Carolina Central",
                    "conference": "MEAC",
                    "firstPlaceVotes": 0,
                    "points": 407
                  },
                  {
                    "rank": 10,
                    "school": "North Dakota State",
                    "conference": "MVFC",
                    "firstPlaceVotes": 0,
                    "points": 398
                  },
                  {
                    "rank": 11,
                    "school": "Southern Illinois",
                    "conference": "MVFC",
                    "firstPlaceVotes": 0,
                    "points": 380
                  },
                  {
                    "rank": 12,
                    "school": "South Dakota",
                    "conference": "MVFC",
                    "firstPlaceVotes": 0,
                    "points": 330
                  },
                  {
                    "rank": 13,
                    "school": "Florida A&M",
                    "conference": "SWAC",
                    "firstPlaceVotes": 0,
                    "points": 296
                  },
                  {
                    "rank": 13,
                    "school": "Chattanooga",
                    "conference": "Southern",
                    "firstPlaceVotes": 0,
                    "points": 296
                  },
                  {
                    "rank": 15,
                    "school": "North Dakota",
                    "conference": "MVFC",
                    "firstPlaceVotes": 0,
                    "points": 260
                  },
                  {
                    "rank": 16,
                    "school": "Lafayette",
                    "conference": "Patriot",
                    "firstPlaceVotes": 0,
                    "points": 241
                  },
                  {
                    "rank": 17,
                    "school": "Austin Peay",
                    "conference": "UAC",
                    "firstPlaceVotes": 0,
                    "points": 218
                  },
                  {
                    "rank": 18,
                    "school": "UT Martin",
                    "conference": "Big South-OVC",
                    "firstPlaceVotes": 0,
                    "points": 179
                  },
                  {
                    "rank": 19,
                    "school": "Harvard",
                    "conference": "Ivy",
                    "firstPlaceVotes": 0,
                    "points": 137
                  },
                  {
                    "rank": 20,
                    "school": "Western Carolina",
                    "conference": "Southern",
                    "firstPlaceVotes": 0,
                    "points": 124
                  },
                  {
                    "rank": 21,
                    "school": "Holy Cross",
                    "conference": "Patriot",
                    "firstPlaceVotes": 0,
                    "points": 120
                  },
                  {
                    "rank": 22,
                    "school": "Villanova",
                    "conference": "CAA",
                    "firstPlaceVotes": 0,
                    "points": 107
                  },
                  {
                    "rank": 23,
                    "school": "Northern Iowa",
                    "conference": "MVFC",
                    "firstPlaceVotes": 0,
                    "points": 105
                  },
                  {
                    "rank": 24,
                    "school": "William & Mary",
                    "conference": "CAA",
                    "firstPlaceVotes": 0,
                    "points": 83
                  },
                  {
                    "rank": 25,
                    "school": "Central Arkansas",
                    "conference": "UAC",
                    "firstPlaceVotes": 0,
                    "points": 73
                  }
                ]
              },
              {
                "poll": "AFCA Division II Coaches Poll",
                "ranks": [
                  {
                    "rank": 1,
                    "school": "Colorado Mines",
                    "conference": "Rocky Mountain",
                    "firstPlaceVotes": 26,
                    "points": 720
                  },
                  {
                    "rank": 2,
                    "school": "Pittsburg State",
                    "conference": "Mid America",
                    "firstPlaceVotes": 1,
                    "points": 694
                  },
                  {
                    "rank": 3,
                    "school": "Grand Valley State",
                    "conference": "GLIAC",
                    "firstPlaceVotes": 1,
                    "points": 662
                  },
                  {
                    "rank": 4,
                    "school": "Harding",
                    "conference": "Great American",
                    "firstPlaceVotes": 0,
                    "points": 637
                  },
                  {
                    "rank": 5,
                    "school": "Slippery Rock",
                    "conference": "Pennsylvania State Athletic",
                    "firstPlaceVotes": 1,
                    "points": 582
                  },
                  {
                    "rank": 6,
                    "school": "Benedict College",
                    "conference": "SIAC",
                    "firstPlaceVotes": 0,
                    "points": 573
                  },
                  {
                    "rank": 7,
                    "school": "Ferris State",
                    "conference": "GLIAC",
                    "firstPlaceVotes": 0,
                    "points": 534
                  },
                  {
                    "rank": 8,
                    "school": "Indianapolis",
                    "conference": "Great Lakes",
                    "firstPlaceVotes": 0,
                    "points": 503
                  },
                  {
                    "rank": 9,
                    "school": "Davenport",
                    "conference": "GLIAC",
                    "firstPlaceVotes": 0,
                    "points": 484
                  },
                  {
                    "rank": 10,
                    "school": "Minnesota State",
                    "conference": "Northern Sun",
                    "firstPlaceVotes": 0,
                    "points": 437
                  },
                  {
                    "rank": 11,
                    "school": "Central Missouri State",
                    "conference": "Mid America",
                    "firstPlaceVotes": 0,
                    "points": 406
                  },
                  {
                    "rank": 12,
                    "school": "Ouachita Baptist",
                    "conference": "Great American",
                    "firstPlaceVotes": 0,
                    "points": 399
                  },
                  {
                    "rank": 13,
                    "school": "Bemidji State",
                    "conference": "Northern Sun",
                    "firstPlaceVotes": 0,
                    "points": 353
                  },
                  {
                    "rank": 14,
                    "school": "Delta State",
                    "conference": "Gulf South",
                    "firstPlaceVotes": 0,
                    "points": 322
                  },
                  {
                    "rank": 15,
                    "school": "Western State",
                    "conference": "Rocky Mountain",
                    "firstPlaceVotes": 0,
                    "points": 321
                  },
                  {
                    "rank": 16,
                    "school": "Lenoir-Rhyne",
                    "conference": "South Atlantic",
                    "firstPlaceVotes": 0,
                    "points": 291
                  },
                  {
                    "rank": 17,
                    "school": "Tiffin",
                    "conference": "Great Midwest Athletic",
                    "firstPlaceVotes": 0,
                    "points": 282
                  },
                  {
                    "rank": 18,
                    "school": "University of Texas of the Permian Basin",
                    "conference": "Lone Star",
                    "firstPlaceVotes": 0,
                    "points": 228
                  },
                  {
                    "rank": 19,
                    "school": "Virginia Union",
                    "conference": "CIAA",
                    "firstPlaceVotes": 0,
                    "points": 210
                  },
                  {
                    "rank": 20,
                    "school": "Valdosta State",
                    "conference": "Gulf South",
                    "firstPlaceVotes": 0,
                    "points": 207
                  },
                  {
                    "rank": 21,
                    "school": "Augustana (SD)",
                    "conference": "Northern Sun",
                    "firstPlaceVotes": 0,
                    "points": 183
                  },
                  {
                    "rank": 22,
                    "school": "Virginia State",
                    "conference": "CIAA",
                    "firstPlaceVotes": 0,
                    "points": 86
                  },
                  {
                    "rank": 23,
                    "school": "Missouri Western",
                    "conference": "Mid America",
                    "firstPlaceVotes": 0,
                    "points": 69
                  },
                  {
                    "rank": 24,
                    "school": "Central Washington",
                    "conference": "Lone Star",
                    "firstPlaceVotes": 0,
                    "points": 54
                  },
                  {
                    "rank": 25,
                    "school": "Mars Hill",
                    "conference": "South Atlantic",
                    "firstPlaceVotes": 0,
                    "points": 43
                  }
                ]
              },
              {
                "poll": "AFCA Division III Coaches Poll",
                "ranks": [
                  {
                    "rank": 1,
                    "school": "North Central",
                    "conference": "CCIW",
                    "firstPlaceVotes": 48,
                    "points": 1224
                  },
                  {
                    "rank": 2,
                    "school": "Mount Union",
                    "conference": "Ohio",
                    "firstPlaceVotes": 1,
                    "points": 1173
                  },
                  {
                    "rank": 3,
                    "school": "Wartburg",
                    "conference": "American Rivers",
                    "firstPlaceVotes": 0,
                    "points": 1120
                  },
                  {
                    "rank": 4,
                    "school": "Linfield",
                    "conference": "Northwest",
                    "firstPlaceVotes": 0,
                    "points": 1024
                  },
                  {
                    "rank": 5,
                    "school": "Trinity (TX)",
                    "conference": "Southern Athletic",
                    "firstPlaceVotes": 0,
                    "points": 986
                  },
                  {
                    "rank": 6,
                    "school": "UW-Whitewater",
                    "conference": "Wisconsin",
                    "firstPlaceVotes": 0,
                    "points": 958
                  },
                  {
                    "rank": 7,
                    "school": "Wisconsin-La Crosse",
                    "conference": "Wisconsin",
                    "firstPlaceVotes": 0,
                    "points": 909
                  },
                  {
                    "rank": 8,
                    "school": "Johns Hopkins",
                    "conference": "Centennial",
                    "firstPlaceVotes": 0,
                    "points": 903
                  },
                  {
                    "rank": 9,
                    "school": "Randolph-Macon",
                    "conference": "Old Dominion",
                    "firstPlaceVotes": 0,
                    "points": 817
                  },
                  {
                    "rank": 10,
                    "school": "UW-River Falls",
                    "conference": "Wisconsin",
                    "firstPlaceVotes": 0,
                    "points": 779
                  },
                  {
                    "rank": 11,
                    "school": "Aurora",
                    "conference": "NACC",
                    "firstPlaceVotes": 0,
                    "points": 724
                  },
                  {
                    "rank": 12,
                    "school": "Susquehanna",
                    "conference": "Landmark Conference",
                    "firstPlaceVotes": 0,
                    "points": 688
                  },
                  {
                    "rank": 13,
                    "school": "Wheaton College (Ill)",
                    "conference": "CCIW",
                    "firstPlaceVotes": 0,
                    "points": 619
                  },
                  {
                    "rank": 14,
                    "school": "Alma College",
                    "conference": "Michigan",
                    "firstPlaceVotes": 0,
                    "points": 577
                  },
                  {
                    "rank": 15,
                    "school": "John Carroll",
                    "conference": "Ohio",
                    "firstPlaceVotes": 0,
                    "points": 549
                  },
                  {
                    "rank": 16,
                    "school": "Ithaca",
                    "conference": "Liberty League",
                    "firstPlaceVotes": 0,
                    "points": 457
                  },
                  {
                    "rank": 17,
                    "school": "SUNY Cortland",
                    "conference": "Empire 8",
                    "firstPlaceVotes": 0,
                    "points": 413
                  },
                  {
                    "rank": 18,
                    "school": "Endicott College",
                    "conference": "Commonwealth Coast",
                    "firstPlaceVotes": 0,
                    "points": 342
                  },
                  {
                    "rank": 19,
                    "school": "Hardin-Simmons",
                    "conference": "American Southwest",
                    "firstPlaceVotes": 0,
                    "points": 288
                  },
                  {
                    "rank": 20,
                    "school": "Grove City College",
                    "conference": "Presidents'",
                    "firstPlaceVotes": 0,
                    "points": 275
                  },
                  {
                    "rank": 21,
                    "school": "St. Johns (MN)",
                    "conference": "Minnesota",
                    "firstPlaceVotes": 0,
                    "points": 262
                  },
                  {
                    "rank": 22,
                    "school": "Muhlenberg",
                    "conference": "Centennial",
                    "firstPlaceVotes": 0,
                    "points": 230
                  },
                  {
                    "rank": 23,
                    "school": "DePauw",
                    "conference": "North Coast",
                    "firstPlaceVotes": 0,
                    "points": 183
                  },
                  {
                    "rank": 24,
                    "school": "Delaware Valley",
                    "conference": "Mid Atlantic",
                    "firstPlaceVotes": 0,
                    "points": 114
                  },
                  {
                    "rank": 25,
                    "school": "Berry College",
                    "conference": "Southern Athletic",
                    "firstPlaceVotes": 0,
                    "points": 99
                  }
                ]
              },
              {
                "poll": "Playoff Committee Rankings",
                "ranks": [
                  {
                    "rank": 1,
                    "school": "Ohio State",
                    "conference": "Big Ten",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 2,
                    "school": "Georgia",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 3,
                    "school": "Michigan",
                    "conference": "Big Ten",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 4,
                    "school": "Florida State",
                    "conference": "ACC",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 5,
                    "school": "Washington",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 6,
                    "school": "Oregon",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 7,
                    "school": "Texas",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 8,
                    "school": "Alabama",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 9,
                    "school": "Florida",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 10,
                    "school": "Ole Miss",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 11,
                    "school": "Penn State",
                    "conference": "Big Ten",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 12,
                    "school": "Missouri",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 13,
                    "school": "Louisville",
                    "conference": "ACC",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 14,
                    "school": "LSU",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 15,
                    "school": "Notre Dame",
                    "conference": "FBS Independents",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 16,
                    "school": "Oregon State",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 17,
                    "school": "Tennessee",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 18,
                    "school": "Utah",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 19,
                    "school": "UCLA",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 20,
                    "school": "USC",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 21,
                    "school": "Kansas",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 22,
                    "school": "Oklahoma State",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 23,
                    "school": "Kansas State",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 24,
                    "school": "Tulane",
                    "conference": "American Athletic",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 25,
                    "school": "Air Force",
                    "conference": "Mountain West",
                    "firstPlaceVotes": 0,
                    "points": 0
                  }
                ]
              }
            ]
          }];

        global.fetch = jest.fn(() => Promise.resolve({
            json: () => Promise.resolve(rankings)
        }));

        var resultingScore = await scoringModule.calculateScoreV2(team, game, week);
        expect(resultingScore).toEqual(3);
    });
    
    it('Conference Championship Win', async () => {
        const team = "Alabama";
        const game = {
            "_id": {
                "$oid": "65dfd87c1546400b2aeb7c84"
            },
            "id": 401539483,
            "season": 2023,
            "week": 14,
            "seasonType": "regular",
            "startDate": "2023-12-02T21:00:00.000Z",
            "startTimeTbd": false,
            "completed": true,
            "neutralSite": true,
            "conferenceGame": true,
            "attendance": 78320,
            "venueId": 5348,
            "venue": "Mercedes-Benz Stadium",
            "homeId": 333,
            "homeTeam": "Alabama",
            "homeConference": "SEC",
            "homeDivision": "fbs",
            "homePoints": 27,
            "homeLineScores": [
                3,
                14,
                3,
                7
            ],
            "homePostWinProb": "0.6057193086697867",
            "homePregameElo": 2028,
            "homePostgameElo": 2039,
            "awayId": 61,
            "awayTeam": "Georgia",
            "awayConference": "SEC",
            "awayDivision": "fbs",
            "awayPoints": 24,
            "awayLineScores": [
                7,
                0,
                3,
                14
            ],
            "awayPostWinProb": "0.39428069133021326",
            "awayPregameElo": 2122,
            "awayPostgameElo": 2111,
            "excitementIndex": "6.8059224938",
            "highlights": null,
            "notes": "SEC Championship"
          };
        const week = 10;
        const rankings = [{
            "_id": {
              "$oid": "65de66651546400b2aeb6e64"
            },
            "season": 2023,
            "seasonType": "regular",
            "week": 10,
            "polls": [
              {
                "poll": "Coaches Poll",
                "ranks": [
                  {
                    "rank": 1,
                    "school": "Georgia",
                    "conference": "SEC",
                    "firstPlaceVotes": 58,
                    "points": 1590
                  },
                  {
                    "rank": 2,
                    "school": "Michigan",
                    "conference": "Big Ten",
                    "firstPlaceVotes": 3,
                    "points": 1520
                  },
                  {
                    "rank": 3,
                    "school": "Ohio State",
                    "conference": "Big Ten",
                    "firstPlaceVotes": 3,
                    "points": 1454
                  },
                  {
                    "rank": 4,
                    "school": "Florida State",
                    "conference": "ACC",
                    "firstPlaceVotes": 0,
                    "points": 1439
                  },
                  {
                    "rank": 5,
                    "school": "Washington",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 1344
                  },
                  {
                    "rank": 6,
                    "school": "Texas",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 1212
                  },
                  {
                    "rank": 7,
                    "school": "Oregon",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 1211
                  },
                  {
                    "rank": 8,
                    "school": "Alabama",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 1187
                  },
                  {
                    "rank": 9,
                    "school": "Penn State",
                    "conference": "Big Ten",
                    "firstPlaceVotes": 0,
                    "points": 1072
                  },
                  {
                    "rank": 10,
                    "school": "Ole Miss",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 1021
                  },
                  {
                    "rank": 11,
                    "school": "Oklahoma",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 948
                  },
                  {
                    "rank": 12,
                    "school": "Notre Dame",
                    "conference": "FBS Independents",
                    "firstPlaceVotes": 0,
                    "points": 847
                  },
                  {
                    "rank": 13,
                    "school": "LSU",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 809
                  },
                  {
                    "rank": 14,
                    "school": "Missouri",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 741
                  },
                  {
                    "rank": 15,
                    "school": "Louisville",
                    "conference": "ACC",
                    "firstPlaceVotes": 0,
                    "points": 701
                  },
                  {
                    "rank": 16,
                    "school": "Tennessee",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 553
                  },
                  {
                    "rank": 17,
                    "school": "Air Force",
                    "conference": "Mountain West",
                    "firstPlaceVotes": 0,
                    "points": 523
                  },
                  {
                    "rank": 18,
                    "school": "Utah",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 509
                  },
                  {
                    "rank": 19,
                    "school": "Oregon State",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 465
                  },
                  {
                    "rank": 20,
                    "school": "UCLA",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 309
                  },
                  {
                    "rank": 21,
                    "school": "Tulane",
                    "conference": "American Athletic",
                    "firstPlaceVotes": 0,
                    "points": 304
                  },
                  {
                    "rank": 22,
                    "school": "USC",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 239
                  },
                  {
                    "rank": 23,
                    "school": "Kansas",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 182
                  },
                  {
                    "rank": 24,
                    "school": "James Madison",
                    "conference": "Sun Belt",
                    "firstPlaceVotes": 0,
                    "points": 169
                  },
                  {
                    "rank": 25,
                    "school": "North Carolina",
                    "conference": "ACC",
                    "firstPlaceVotes": 0,
                    "points": 120
                  }
                ]
              },
              {
                "poll": "AP Top 25",
                "ranks": [
                  {
                    "rank": 1,
                    "school": "Georgia",
                    "conference": "SEC",
                    "firstPlaceVotes": 48,
                    "points": 1553
                  },
                  {
                    "rank": 2,
                    "school": "Michigan",
                    "conference": "Big Ten",
                    "firstPlaceVotes": 9,
                    "points": 1494
                  },
                  {
                    "rank": 3,
                    "school": "Ohio State",
                    "conference": "Big Ten",
                    "firstPlaceVotes": 3,
                    "points": 1446
                  },
                  {
                    "rank": 4,
                    "school": "Florida State",
                    "conference": "ACC",
                    "firstPlaceVotes": 3,
                    "points": 1421
                  },
                  {
                    "rank": 5,
                    "school": "Washington",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 1327
                  },
                  {
                    "rank": 6,
                    "school": "Oregon",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 1235
                  },
                  {
                    "rank": 7,
                    "school": "Texas",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 1189
                  },
                  {
                    "rank": 8,
                    "school": "Alabama",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 1114
                  },
                  {
                    "rank": 9,
                    "school": "Penn State",
                    "conference": "Big Ten",
                    "firstPlaceVotes": 0,
                    "points": 1044
                  },
                  {
                    "rank": 10,
                    "school": "Oklahoma",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 1010
                  },
                  {
                    "rank": 11,
                    "school": "Ole Miss",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 990
                  },
                  {
                    "rank": 12,
                    "school": "Notre Dame",
                    "conference": "FBS Independents",
                    "firstPlaceVotes": 0,
                    "points": 847
                  },
                  {
                    "rank": 13,
                    "school": "LSU",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 816
                  },
                  {
                    "rank": 14,
                    "school": "Missouri",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 714
                  },
                  {
                    "rank": 15,
                    "school": "Louisville",
                    "conference": "ACC",
                    "firstPlaceVotes": 0,
                    "points": 666
                  },
                  {
                    "rank": 16,
                    "school": "Oregon State",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 557
                  },
                  {
                    "rank": 17,
                    "school": "Air Force",
                    "conference": "Mountain West",
                    "firstPlaceVotes": 0,
                    "points": 526
                  },
                  {
                    "rank": 18,
                    "school": "Utah",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 510
                  },
                  {
                    "rank": 19,
                    "school": "Tennessee",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 473
                  },
                  {
                    "rank": 20,
                    "school": "UCLA",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 331
                  },
                  {
                    "rank": 21,
                    "school": "Tulane",
                    "conference": "American Athletic",
                    "firstPlaceVotes": 0,
                    "points": 303
                  },
                  {
                    "rank": 22,
                    "school": "Kansas",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 250
                  },
                  {
                    "rank": 23,
                    "school": "James Madison",
                    "conference": "Sun Belt",
                    "firstPlaceVotes": 0,
                    "points": 192
                  },
                  {
                    "rank": 24,
                    "school": "USC",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 139
                  },
                  {
                    "rank": 25,
                    "school": "Kansas State",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 112
                  }
                ]
              },
              {
                "poll": "FCS Coaches Poll",
                "ranks": [
                  {
                    "rank": 1,
                    "school": "South Dakota State",
                    "conference": "MVFC",
                    "firstPlaceVotes": 25,
                    "points": 625
                  },
                  {
                    "rank": 2,
                    "school": "Furman",
                    "conference": "Southern",
                    "firstPlaceVotes": 0,
                    "points": 577
                  },
                  {
                    "rank": 3,
                    "school": "Montana",
                    "conference": "Big Sky",
                    "firstPlaceVotes": 0,
                    "points": 544
                  },
                  {
                    "rank": 4,
                    "school": "Incarnate Word",
                    "conference": "Southland",
                    "firstPlaceVotes": 0,
                    "points": 533
                  },
                  {
                    "rank": 5,
                    "school": "Idaho",
                    "conference": "Big Sky",
                    "firstPlaceVotes": 0,
                    "points": 515
                  },
                  {
                    "rank": 6,
                    "school": "Delaware",
                    "conference": "CAA",
                    "firstPlaceVotes": 0,
                    "points": 507
                  },
                  {
                    "rank": 7,
                    "school": "Sacramento State",
                    "conference": "Big Sky",
                    "firstPlaceVotes": 0,
                    "points": 471
                  },
                  {
                    "rank": 8,
                    "school": "Montana State",
                    "conference": "Big Sky",
                    "firstPlaceVotes": 0,
                    "points": 458
                  },
                  {
                    "rank": 9,
                    "school": "North Carolina Central",
                    "conference": "MEAC",
                    "firstPlaceVotes": 0,
                    "points": 407
                  },
                  {
                    "rank": 10,
                    "school": "North Dakota State",
                    "conference": "MVFC",
                    "firstPlaceVotes": 0,
                    "points": 398
                  },
                  {
                    "rank": 11,
                    "school": "Southern Illinois",
                    "conference": "MVFC",
                    "firstPlaceVotes": 0,
                    "points": 380
                  },
                  {
                    "rank": 12,
                    "school": "South Dakota",
                    "conference": "MVFC",
                    "firstPlaceVotes": 0,
                    "points": 330
                  },
                  {
                    "rank": 13,
                    "school": "Florida A&M",
                    "conference": "SWAC",
                    "firstPlaceVotes": 0,
                    "points": 296
                  },
                  {
                    "rank": 13,
                    "school": "Chattanooga",
                    "conference": "Southern",
                    "firstPlaceVotes": 0,
                    "points": 296
                  },
                  {
                    "rank": 15,
                    "school": "North Dakota",
                    "conference": "MVFC",
                    "firstPlaceVotes": 0,
                    "points": 260
                  },
                  {
                    "rank": 16,
                    "school": "Lafayette",
                    "conference": "Patriot",
                    "firstPlaceVotes": 0,
                    "points": 241
                  },
                  {
                    "rank": 17,
                    "school": "Austin Peay",
                    "conference": "UAC",
                    "firstPlaceVotes": 0,
                    "points": 218
                  },
                  {
                    "rank": 18,
                    "school": "UT Martin",
                    "conference": "Big South-OVC",
                    "firstPlaceVotes": 0,
                    "points": 179
                  },
                  {
                    "rank": 19,
                    "school": "Harvard",
                    "conference": "Ivy",
                    "firstPlaceVotes": 0,
                    "points": 137
                  },
                  {
                    "rank": 20,
                    "school": "Western Carolina",
                    "conference": "Southern",
                    "firstPlaceVotes": 0,
                    "points": 124
                  },
                  {
                    "rank": 21,
                    "school": "Holy Cross",
                    "conference": "Patriot",
                    "firstPlaceVotes": 0,
                    "points": 120
                  },
                  {
                    "rank": 22,
                    "school": "Villanova",
                    "conference": "CAA",
                    "firstPlaceVotes": 0,
                    "points": 107
                  },
                  {
                    "rank": 23,
                    "school": "Northern Iowa",
                    "conference": "MVFC",
                    "firstPlaceVotes": 0,
                    "points": 105
                  },
                  {
                    "rank": 24,
                    "school": "William & Mary",
                    "conference": "CAA",
                    "firstPlaceVotes": 0,
                    "points": 83
                  },
                  {
                    "rank": 25,
                    "school": "Central Arkansas",
                    "conference": "UAC",
                    "firstPlaceVotes": 0,
                    "points": 73
                  }
                ]
              },
              {
                "poll": "AFCA Division II Coaches Poll",
                "ranks": [
                  {
                    "rank": 1,
                    "school": "Colorado Mines",
                    "conference": "Rocky Mountain",
                    "firstPlaceVotes": 26,
                    "points": 720
                  },
                  {
                    "rank": 2,
                    "school": "Pittsburg State",
                    "conference": "Mid America",
                    "firstPlaceVotes": 1,
                    "points": 694
                  },
                  {
                    "rank": 3,
                    "school": "Grand Valley State",
                    "conference": "GLIAC",
                    "firstPlaceVotes": 1,
                    "points": 662
                  },
                  {
                    "rank": 4,
                    "school": "Harding",
                    "conference": "Great American",
                    "firstPlaceVotes": 0,
                    "points": 637
                  },
                  {
                    "rank": 5,
                    "school": "Slippery Rock",
                    "conference": "Pennsylvania State Athletic",
                    "firstPlaceVotes": 1,
                    "points": 582
                  },
                  {
                    "rank": 6,
                    "school": "Benedict College",
                    "conference": "SIAC",
                    "firstPlaceVotes": 0,
                    "points": 573
                  },
                  {
                    "rank": 7,
                    "school": "Ferris State",
                    "conference": "GLIAC",
                    "firstPlaceVotes": 0,
                    "points": 534
                  },
                  {
                    "rank": 8,
                    "school": "Indianapolis",
                    "conference": "Great Lakes",
                    "firstPlaceVotes": 0,
                    "points": 503
                  },
                  {
                    "rank": 9,
                    "school": "Davenport",
                    "conference": "GLIAC",
                    "firstPlaceVotes": 0,
                    "points": 484
                  },
                  {
                    "rank": 10,
                    "school": "Minnesota State",
                    "conference": "Northern Sun",
                    "firstPlaceVotes": 0,
                    "points": 437
                  },
                  {
                    "rank": 11,
                    "school": "Central Missouri State",
                    "conference": "Mid America",
                    "firstPlaceVotes": 0,
                    "points": 406
                  },
                  {
                    "rank": 12,
                    "school": "Ouachita Baptist",
                    "conference": "Great American",
                    "firstPlaceVotes": 0,
                    "points": 399
                  },
                  {
                    "rank": 13,
                    "school": "Bemidji State",
                    "conference": "Northern Sun",
                    "firstPlaceVotes": 0,
                    "points": 353
                  },
                  {
                    "rank": 14,
                    "school": "Delta State",
                    "conference": "Gulf South",
                    "firstPlaceVotes": 0,
                    "points": 322
                  },
                  {
                    "rank": 15,
                    "school": "Western State",
                    "conference": "Rocky Mountain",
                    "firstPlaceVotes": 0,
                    "points": 321
                  },
                  {
                    "rank": 16,
                    "school": "Lenoir-Rhyne",
                    "conference": "South Atlantic",
                    "firstPlaceVotes": 0,
                    "points": 291
                  },
                  {
                    "rank": 17,
                    "school": "Tiffin",
                    "conference": "Great Midwest Athletic",
                    "firstPlaceVotes": 0,
                    "points": 282
                  },
                  {
                    "rank": 18,
                    "school": "University of Texas of the Permian Basin",
                    "conference": "Lone Star",
                    "firstPlaceVotes": 0,
                    "points": 228
                  },
                  {
                    "rank": 19,
                    "school": "Virginia Union",
                    "conference": "CIAA",
                    "firstPlaceVotes": 0,
                    "points": 210
                  },
                  {
                    "rank": 20,
                    "school": "Valdosta State",
                    "conference": "Gulf South",
                    "firstPlaceVotes": 0,
                    "points": 207
                  },
                  {
                    "rank": 21,
                    "school": "Augustana (SD)",
                    "conference": "Northern Sun",
                    "firstPlaceVotes": 0,
                    "points": 183
                  },
                  {
                    "rank": 22,
                    "school": "Virginia State",
                    "conference": "CIAA",
                    "firstPlaceVotes": 0,
                    "points": 86
                  },
                  {
                    "rank": 23,
                    "school": "Missouri Western",
                    "conference": "Mid America",
                    "firstPlaceVotes": 0,
                    "points": 69
                  },
                  {
                    "rank": 24,
                    "school": "Central Washington",
                    "conference": "Lone Star",
                    "firstPlaceVotes": 0,
                    "points": 54
                  },
                  {
                    "rank": 25,
                    "school": "Mars Hill",
                    "conference": "South Atlantic",
                    "firstPlaceVotes": 0,
                    "points": 43
                  }
                ]
              },
              {
                "poll": "AFCA Division III Coaches Poll",
                "ranks": [
                  {
                    "rank": 1,
                    "school": "North Central",
                    "conference": "CCIW",
                    "firstPlaceVotes": 48,
                    "points": 1224
                  },
                  {
                    "rank": 2,
                    "school": "Mount Union",
                    "conference": "Ohio",
                    "firstPlaceVotes": 1,
                    "points": 1173
                  },
                  {
                    "rank": 3,
                    "school": "Wartburg",
                    "conference": "American Rivers",
                    "firstPlaceVotes": 0,
                    "points": 1120
                  },
                  {
                    "rank": 4,
                    "school": "Linfield",
                    "conference": "Northwest",
                    "firstPlaceVotes": 0,
                    "points": 1024
                  },
                  {
                    "rank": 5,
                    "school": "Trinity (TX)",
                    "conference": "Southern Athletic",
                    "firstPlaceVotes": 0,
                    "points": 986
                  },
                  {
                    "rank": 6,
                    "school": "UW-Whitewater",
                    "conference": "Wisconsin",
                    "firstPlaceVotes": 0,
                    "points": 958
                  },
                  {
                    "rank": 7,
                    "school": "Wisconsin-La Crosse",
                    "conference": "Wisconsin",
                    "firstPlaceVotes": 0,
                    "points": 909
                  },
                  {
                    "rank": 8,
                    "school": "Johns Hopkins",
                    "conference": "Centennial",
                    "firstPlaceVotes": 0,
                    "points": 903
                  },
                  {
                    "rank": 9,
                    "school": "Randolph-Macon",
                    "conference": "Old Dominion",
                    "firstPlaceVotes": 0,
                    "points": 817
                  },
                  {
                    "rank": 10,
                    "school": "UW-River Falls",
                    "conference": "Wisconsin",
                    "firstPlaceVotes": 0,
                    "points": 779
                  },
                  {
                    "rank": 11,
                    "school": "Aurora",
                    "conference": "NACC",
                    "firstPlaceVotes": 0,
                    "points": 724
                  },
                  {
                    "rank": 12,
                    "school": "Susquehanna",
                    "conference": "Landmark Conference",
                    "firstPlaceVotes": 0,
                    "points": 688
                  },
                  {
                    "rank": 13,
                    "school": "Wheaton College (Ill)",
                    "conference": "CCIW",
                    "firstPlaceVotes": 0,
                    "points": 619
                  },
                  {
                    "rank": 14,
                    "school": "Alma College",
                    "conference": "Michigan",
                    "firstPlaceVotes": 0,
                    "points": 577
                  },
                  {
                    "rank": 15,
                    "school": "John Carroll",
                    "conference": "Ohio",
                    "firstPlaceVotes": 0,
                    "points": 549
                  },
                  {
                    "rank": 16,
                    "school": "Ithaca",
                    "conference": "Liberty League",
                    "firstPlaceVotes": 0,
                    "points": 457
                  },
                  {
                    "rank": 17,
                    "school": "SUNY Cortland",
                    "conference": "Empire 8",
                    "firstPlaceVotes": 0,
                    "points": 413
                  },
                  {
                    "rank": 18,
                    "school": "Endicott College",
                    "conference": "Commonwealth Coast",
                    "firstPlaceVotes": 0,
                    "points": 342
                  },
                  {
                    "rank": 19,
                    "school": "Hardin-Simmons",
                    "conference": "American Southwest",
                    "firstPlaceVotes": 0,
                    "points": 288
                  },
                  {
                    "rank": 20,
                    "school": "Grove City College",
                    "conference": "Presidents'",
                    "firstPlaceVotes": 0,
                    "points": 275
                  },
                  {
                    "rank": 21,
                    "school": "St. Johns (MN)",
                    "conference": "Minnesota",
                    "firstPlaceVotes": 0,
                    "points": 262
                  },
                  {
                    "rank": 22,
                    "school": "Muhlenberg",
                    "conference": "Centennial",
                    "firstPlaceVotes": 0,
                    "points": 230
                  },
                  {
                    "rank": 23,
                    "school": "DePauw",
                    "conference": "North Coast",
                    "firstPlaceVotes": 0,
                    "points": 183
                  },
                  {
                    "rank": 24,
                    "school": "Delaware Valley",
                    "conference": "Mid Atlantic",
                    "firstPlaceVotes": 0,
                    "points": 114
                  },
                  {
                    "rank": 25,
                    "school": "Berry College",
                    "conference": "Southern Athletic",
                    "firstPlaceVotes": 0,
                    "points": 99
                  }
                ]
              },
              {
                "poll": "Playoff Committee Rankings",
                "ranks": [
                  {
                    "rank": 1,
                    "school": "Ohio State",
                    "conference": "Big Ten",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 2,
                    "school": "Georgia",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 3,
                    "school": "Michigan",
                    "conference": "Big Ten",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 4,
                    "school": "Florida State",
                    "conference": "ACC",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 5,
                    "school": "Washington",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 6,
                    "school": "Oregon",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 7,
                    "school": "Texas",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 8,
                    "school": "Alabama",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 9,
                    "school": "Florida",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 10,
                    "school": "Ole Miss",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 11,
                    "school": "Penn State",
                    "conference": "Big Ten",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 12,
                    "school": "Missouri",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 13,
                    "school": "Louisville",
                    "conference": "ACC",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 14,
                    "school": "LSU",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 15,
                    "school": "Notre Dame",
                    "conference": "FBS Independents",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 16,
                    "school": "Oregon State",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 17,
                    "school": "Tennessee",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 18,
                    "school": "Utah",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 19,
                    "school": "UCLA",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 20,
                    "school": "USC",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 21,
                    "school": "Kansas",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 22,
                    "school": "Oklahoma State",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 23,
                    "school": "Kansas State",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 24,
                    "school": "Tulane",
                    "conference": "American Athletic",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 25,
                    "school": "Air Force",
                    "conference": "Mountain West",
                    "firstPlaceVotes": 0,
                    "points": 0
                  }
                ]
              }
            ]
          }];

        global.fetch = jest.fn(() => Promise.resolve({
            json: () => Promise.resolve(rankings)
        }));

        var resultingScore = await scoringModule.calculateScoreV2(team, game, week);
        expect(resultingScore).toEqual(5);
    });
    
    it('Bowl Game Win', async () => {
        const team = "Western Kentucky";
        const game = {
            "_id": {
              "$oid": "65dfd98d1546400b2aeb7c96"
            },
            "id": 401551469,
            "season": 2023,
            "week": 1,
            "seasonType": "postseason",
            "startDate": "2023-12-18T19:30:00.000Z",
            "startTimeTbd": false,
            "completed": true,
            "neutralSite": true,
            "conferenceGame": false,
            "attendance": null,
            "venueId": 4418,
            "venue": "Jerry Richardson Stadium",
            "homeId": 295,
            "homeTeam": "Old Dominion",
            "homeConference": "Sun Belt",
            "homeDivision": "fbs",
            "homePoints": 35,
            "homeLineScores": [
              21,
              7,
              7,
              0,
              0
            ],
            "homePostWinProb": "0.7778881016633735",
            "homePregameElo": 1355,
            "homePostgameElo": 1359,
            "awayId": 98,
            "awayTeam": "Western Kentucky",
            "awayConference": "Conference USA",
            "awayDivision": "fbs",
            "awayPoints": 38,
            "awayLineScores": [
              0,
              7,
              7,
              21,
              3
            ],
            "awayPostWinProb": "0.22211189833662648",
            "awayPregameElo": 1453,
            "awayPostgameElo": 1449,
            "excitementIndex": "3.8571235001",
            "highlights": null,
            "notes": "Famous Toastery Bowl"
          };
        const week = 10;
        const rankings = [{
            "_id": {
              "$oid": "65de66651546400b2aeb6e64"
            },
            "season": 2023,
            "seasonType": "regular",
            "week": 10,
            "polls": [
              {
                "poll": "Coaches Poll",
                "ranks": [
                  {
                    "rank": 1,
                    "school": "Georgia",
                    "conference": "SEC",
                    "firstPlaceVotes": 58,
                    "points": 1590
                  },
                  {
                    "rank": 2,
                    "school": "Michigan",
                    "conference": "Big Ten",
                    "firstPlaceVotes": 3,
                    "points": 1520
                  },
                  {
                    "rank": 3,
                    "school": "Ohio State",
                    "conference": "Big Ten",
                    "firstPlaceVotes": 3,
                    "points": 1454
                  },
                  {
                    "rank": 4,
                    "school": "Florida State",
                    "conference": "ACC",
                    "firstPlaceVotes": 0,
                    "points": 1439
                  },
                  {
                    "rank": 5,
                    "school": "Washington",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 1344
                  },
                  {
                    "rank": 6,
                    "school": "Texas",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 1212
                  },
                  {
                    "rank": 7,
                    "school": "Oregon",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 1211
                  },
                  {
                    "rank": 8,
                    "school": "Alabama",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 1187
                  },
                  {
                    "rank": 9,
                    "school": "Penn State",
                    "conference": "Big Ten",
                    "firstPlaceVotes": 0,
                    "points": 1072
                  },
                  {
                    "rank": 10,
                    "school": "Ole Miss",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 1021
                  },
                  {
                    "rank": 11,
                    "school": "Oklahoma",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 948
                  },
                  {
                    "rank": 12,
                    "school": "Notre Dame",
                    "conference": "FBS Independents",
                    "firstPlaceVotes": 0,
                    "points": 847
                  },
                  {
                    "rank": 13,
                    "school": "LSU",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 809
                  },
                  {
                    "rank": 14,
                    "school": "Missouri",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 741
                  },
                  {
                    "rank": 15,
                    "school": "Louisville",
                    "conference": "ACC",
                    "firstPlaceVotes": 0,
                    "points": 701
                  },
                  {
                    "rank": 16,
                    "school": "Tennessee",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 553
                  },
                  {
                    "rank": 17,
                    "school": "Air Force",
                    "conference": "Mountain West",
                    "firstPlaceVotes": 0,
                    "points": 523
                  },
                  {
                    "rank": 18,
                    "school": "Utah",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 509
                  },
                  {
                    "rank": 19,
                    "school": "Oregon State",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 465
                  },
                  {
                    "rank": 20,
                    "school": "UCLA",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 309
                  },
                  {
                    "rank": 21,
                    "school": "Tulane",
                    "conference": "American Athletic",
                    "firstPlaceVotes": 0,
                    "points": 304
                  },
                  {
                    "rank": 22,
                    "school": "USC",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 239
                  },
                  {
                    "rank": 23,
                    "school": "Kansas",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 182
                  },
                  {
                    "rank": 24,
                    "school": "James Madison",
                    "conference": "Sun Belt",
                    "firstPlaceVotes": 0,
                    "points": 169
                  },
                  {
                    "rank": 25,
                    "school": "North Carolina",
                    "conference": "ACC",
                    "firstPlaceVotes": 0,
                    "points": 120
                  }
                ]
              },
              {
                "poll": "AP Top 25",
                "ranks": [
                  {
                    "rank": 1,
                    "school": "Georgia",
                    "conference": "SEC",
                    "firstPlaceVotes": 48,
                    "points": 1553
                  },
                  {
                    "rank": 2,
                    "school": "Michigan",
                    "conference": "Big Ten",
                    "firstPlaceVotes": 9,
                    "points": 1494
                  },
                  {
                    "rank": 3,
                    "school": "Ohio State",
                    "conference": "Big Ten",
                    "firstPlaceVotes": 3,
                    "points": 1446
                  },
                  {
                    "rank": 4,
                    "school": "Florida State",
                    "conference": "ACC",
                    "firstPlaceVotes": 3,
                    "points": 1421
                  },
                  {
                    "rank": 5,
                    "school": "Washington",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 1327
                  },
                  {
                    "rank": 6,
                    "school": "Oregon",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 1235
                  },
                  {
                    "rank": 7,
                    "school": "Texas",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 1189
                  },
                  {
                    "rank": 8,
                    "school": "Alabama",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 1114
                  },
                  {
                    "rank": 9,
                    "school": "Penn State",
                    "conference": "Big Ten",
                    "firstPlaceVotes": 0,
                    "points": 1044
                  },
                  {
                    "rank": 10,
                    "school": "Oklahoma",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 1010
                  },
                  {
                    "rank": 11,
                    "school": "Ole Miss",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 990
                  },
                  {
                    "rank": 12,
                    "school": "Notre Dame",
                    "conference": "FBS Independents",
                    "firstPlaceVotes": 0,
                    "points": 847
                  },
                  {
                    "rank": 13,
                    "school": "LSU",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 816
                  },
                  {
                    "rank": 14,
                    "school": "Missouri",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 714
                  },
                  {
                    "rank": 15,
                    "school": "Louisville",
                    "conference": "ACC",
                    "firstPlaceVotes": 0,
                    "points": 666
                  },
                  {
                    "rank": 16,
                    "school": "Oregon State",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 557
                  },
                  {
                    "rank": 17,
                    "school": "Air Force",
                    "conference": "Mountain West",
                    "firstPlaceVotes": 0,
                    "points": 526
                  },
                  {
                    "rank": 18,
                    "school": "Utah",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 510
                  },
                  {
                    "rank": 19,
                    "school": "Tennessee",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 473
                  },
                  {
                    "rank": 20,
                    "school": "UCLA",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 331
                  },
                  {
                    "rank": 21,
                    "school": "Tulane",
                    "conference": "American Athletic",
                    "firstPlaceVotes": 0,
                    "points": 303
                  },
                  {
                    "rank": 22,
                    "school": "Kansas",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 250
                  },
                  {
                    "rank": 23,
                    "school": "James Madison",
                    "conference": "Sun Belt",
                    "firstPlaceVotes": 0,
                    "points": 192
                  },
                  {
                    "rank": 24,
                    "school": "USC",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 139
                  },
                  {
                    "rank": 25,
                    "school": "Kansas State",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 112
                  }
                ]
              },
              {
                "poll": "FCS Coaches Poll",
                "ranks": [
                  {
                    "rank": 1,
                    "school": "South Dakota State",
                    "conference": "MVFC",
                    "firstPlaceVotes": 25,
                    "points": 625
                  },
                  {
                    "rank": 2,
                    "school": "Furman",
                    "conference": "Southern",
                    "firstPlaceVotes": 0,
                    "points": 577
                  },
                  {
                    "rank": 3,
                    "school": "Montana",
                    "conference": "Big Sky",
                    "firstPlaceVotes": 0,
                    "points": 544
                  },
                  {
                    "rank": 4,
                    "school": "Incarnate Word",
                    "conference": "Southland",
                    "firstPlaceVotes": 0,
                    "points": 533
                  },
                  {
                    "rank": 5,
                    "school": "Idaho",
                    "conference": "Big Sky",
                    "firstPlaceVotes": 0,
                    "points": 515
                  },
                  {
                    "rank": 6,
                    "school": "Delaware",
                    "conference": "CAA",
                    "firstPlaceVotes": 0,
                    "points": 507
                  },
                  {
                    "rank": 7,
                    "school": "Sacramento State",
                    "conference": "Big Sky",
                    "firstPlaceVotes": 0,
                    "points": 471
                  },
                  {
                    "rank": 8,
                    "school": "Montana State",
                    "conference": "Big Sky",
                    "firstPlaceVotes": 0,
                    "points": 458
                  },
                  {
                    "rank": 9,
                    "school": "North Carolina Central",
                    "conference": "MEAC",
                    "firstPlaceVotes": 0,
                    "points": 407
                  },
                  {
                    "rank": 10,
                    "school": "North Dakota State",
                    "conference": "MVFC",
                    "firstPlaceVotes": 0,
                    "points": 398
                  },
                  {
                    "rank": 11,
                    "school": "Southern Illinois",
                    "conference": "MVFC",
                    "firstPlaceVotes": 0,
                    "points": 380
                  },
                  {
                    "rank": 12,
                    "school": "South Dakota",
                    "conference": "MVFC",
                    "firstPlaceVotes": 0,
                    "points": 330
                  },
                  {
                    "rank": 13,
                    "school": "Florida A&M",
                    "conference": "SWAC",
                    "firstPlaceVotes": 0,
                    "points": 296
                  },
                  {
                    "rank": 13,
                    "school": "Chattanooga",
                    "conference": "Southern",
                    "firstPlaceVotes": 0,
                    "points": 296
                  },
                  {
                    "rank": 15,
                    "school": "North Dakota",
                    "conference": "MVFC",
                    "firstPlaceVotes": 0,
                    "points": 260
                  },
                  {
                    "rank": 16,
                    "school": "Lafayette",
                    "conference": "Patriot",
                    "firstPlaceVotes": 0,
                    "points": 241
                  },
                  {
                    "rank": 17,
                    "school": "Austin Peay",
                    "conference": "UAC",
                    "firstPlaceVotes": 0,
                    "points": 218
                  },
                  {
                    "rank": 18,
                    "school": "UT Martin",
                    "conference": "Big South-OVC",
                    "firstPlaceVotes": 0,
                    "points": 179
                  },
                  {
                    "rank": 19,
                    "school": "Harvard",
                    "conference": "Ivy",
                    "firstPlaceVotes": 0,
                    "points": 137
                  },
                  {
                    "rank": 20,
                    "school": "Western Carolina",
                    "conference": "Southern",
                    "firstPlaceVotes": 0,
                    "points": 124
                  },
                  {
                    "rank": 21,
                    "school": "Holy Cross",
                    "conference": "Patriot",
                    "firstPlaceVotes": 0,
                    "points": 120
                  },
                  {
                    "rank": 22,
                    "school": "Villanova",
                    "conference": "CAA",
                    "firstPlaceVotes": 0,
                    "points": 107
                  },
                  {
                    "rank": 23,
                    "school": "Northern Iowa",
                    "conference": "MVFC",
                    "firstPlaceVotes": 0,
                    "points": 105
                  },
                  {
                    "rank": 24,
                    "school": "William & Mary",
                    "conference": "CAA",
                    "firstPlaceVotes": 0,
                    "points": 83
                  },
                  {
                    "rank": 25,
                    "school": "Central Arkansas",
                    "conference": "UAC",
                    "firstPlaceVotes": 0,
                    "points": 73
                  }
                ]
              },
              {
                "poll": "AFCA Division II Coaches Poll",
                "ranks": [
                  {
                    "rank": 1,
                    "school": "Colorado Mines",
                    "conference": "Rocky Mountain",
                    "firstPlaceVotes": 26,
                    "points": 720
                  },
                  {
                    "rank": 2,
                    "school": "Pittsburg State",
                    "conference": "Mid America",
                    "firstPlaceVotes": 1,
                    "points": 694
                  },
                  {
                    "rank": 3,
                    "school": "Grand Valley State",
                    "conference": "GLIAC",
                    "firstPlaceVotes": 1,
                    "points": 662
                  },
                  {
                    "rank": 4,
                    "school": "Harding",
                    "conference": "Great American",
                    "firstPlaceVotes": 0,
                    "points": 637
                  },
                  {
                    "rank": 5,
                    "school": "Slippery Rock",
                    "conference": "Pennsylvania State Athletic",
                    "firstPlaceVotes": 1,
                    "points": 582
                  },
                  {
                    "rank": 6,
                    "school": "Benedict College",
                    "conference": "SIAC",
                    "firstPlaceVotes": 0,
                    "points": 573
                  },
                  {
                    "rank": 7,
                    "school": "Ferris State",
                    "conference": "GLIAC",
                    "firstPlaceVotes": 0,
                    "points": 534
                  },
                  {
                    "rank": 8,
                    "school": "Indianapolis",
                    "conference": "Great Lakes",
                    "firstPlaceVotes": 0,
                    "points": 503
                  },
                  {
                    "rank": 9,
                    "school": "Davenport",
                    "conference": "GLIAC",
                    "firstPlaceVotes": 0,
                    "points": 484
                  },
                  {
                    "rank": 10,
                    "school": "Minnesota State",
                    "conference": "Northern Sun",
                    "firstPlaceVotes": 0,
                    "points": 437
                  },
                  {
                    "rank": 11,
                    "school": "Central Missouri State",
                    "conference": "Mid America",
                    "firstPlaceVotes": 0,
                    "points": 406
                  },
                  {
                    "rank": 12,
                    "school": "Ouachita Baptist",
                    "conference": "Great American",
                    "firstPlaceVotes": 0,
                    "points": 399
                  },
                  {
                    "rank": 13,
                    "school": "Bemidji State",
                    "conference": "Northern Sun",
                    "firstPlaceVotes": 0,
                    "points": 353
                  },
                  {
                    "rank": 14,
                    "school": "Delta State",
                    "conference": "Gulf South",
                    "firstPlaceVotes": 0,
                    "points": 322
                  },
                  {
                    "rank": 15,
                    "school": "Western State",
                    "conference": "Rocky Mountain",
                    "firstPlaceVotes": 0,
                    "points": 321
                  },
                  {
                    "rank": 16,
                    "school": "Lenoir-Rhyne",
                    "conference": "South Atlantic",
                    "firstPlaceVotes": 0,
                    "points": 291
                  },
                  {
                    "rank": 17,
                    "school": "Tiffin",
                    "conference": "Great Midwest Athletic",
                    "firstPlaceVotes": 0,
                    "points": 282
                  },
                  {
                    "rank": 18,
                    "school": "University of Texas of the Permian Basin",
                    "conference": "Lone Star",
                    "firstPlaceVotes": 0,
                    "points": 228
                  },
                  {
                    "rank": 19,
                    "school": "Virginia Union",
                    "conference": "CIAA",
                    "firstPlaceVotes": 0,
                    "points": 210
                  },
                  {
                    "rank": 20,
                    "school": "Valdosta State",
                    "conference": "Gulf South",
                    "firstPlaceVotes": 0,
                    "points": 207
                  },
                  {
                    "rank": 21,
                    "school": "Augustana (SD)",
                    "conference": "Northern Sun",
                    "firstPlaceVotes": 0,
                    "points": 183
                  },
                  {
                    "rank": 22,
                    "school": "Virginia State",
                    "conference": "CIAA",
                    "firstPlaceVotes": 0,
                    "points": 86
                  },
                  {
                    "rank": 23,
                    "school": "Missouri Western",
                    "conference": "Mid America",
                    "firstPlaceVotes": 0,
                    "points": 69
                  },
                  {
                    "rank": 24,
                    "school": "Central Washington",
                    "conference": "Lone Star",
                    "firstPlaceVotes": 0,
                    "points": 54
                  },
                  {
                    "rank": 25,
                    "school": "Mars Hill",
                    "conference": "South Atlantic",
                    "firstPlaceVotes": 0,
                    "points": 43
                  }
                ]
              },
              {
                "poll": "AFCA Division III Coaches Poll",
                "ranks": [
                  {
                    "rank": 1,
                    "school": "North Central",
                    "conference": "CCIW",
                    "firstPlaceVotes": 48,
                    "points": 1224
                  },
                  {
                    "rank": 2,
                    "school": "Mount Union",
                    "conference": "Ohio",
                    "firstPlaceVotes": 1,
                    "points": 1173
                  },
                  {
                    "rank": 3,
                    "school": "Wartburg",
                    "conference": "American Rivers",
                    "firstPlaceVotes": 0,
                    "points": 1120
                  },
                  {
                    "rank": 4,
                    "school": "Linfield",
                    "conference": "Northwest",
                    "firstPlaceVotes": 0,
                    "points": 1024
                  },
                  {
                    "rank": 5,
                    "school": "Trinity (TX)",
                    "conference": "Southern Athletic",
                    "firstPlaceVotes": 0,
                    "points": 986
                  },
                  {
                    "rank": 6,
                    "school": "UW-Whitewater",
                    "conference": "Wisconsin",
                    "firstPlaceVotes": 0,
                    "points": 958
                  },
                  {
                    "rank": 7,
                    "school": "Wisconsin-La Crosse",
                    "conference": "Wisconsin",
                    "firstPlaceVotes": 0,
                    "points": 909
                  },
                  {
                    "rank": 8,
                    "school": "Johns Hopkins",
                    "conference": "Centennial",
                    "firstPlaceVotes": 0,
                    "points": 903
                  },
                  {
                    "rank": 9,
                    "school": "Randolph-Macon",
                    "conference": "Old Dominion",
                    "firstPlaceVotes": 0,
                    "points": 817
                  },
                  {
                    "rank": 10,
                    "school": "UW-River Falls",
                    "conference": "Wisconsin",
                    "firstPlaceVotes": 0,
                    "points": 779
                  },
                  {
                    "rank": 11,
                    "school": "Aurora",
                    "conference": "NACC",
                    "firstPlaceVotes": 0,
                    "points": 724
                  },
                  {
                    "rank": 12,
                    "school": "Susquehanna",
                    "conference": "Landmark Conference",
                    "firstPlaceVotes": 0,
                    "points": 688
                  },
                  {
                    "rank": 13,
                    "school": "Wheaton College (Ill)",
                    "conference": "CCIW",
                    "firstPlaceVotes": 0,
                    "points": 619
                  },
                  {
                    "rank": 14,
                    "school": "Alma College",
                    "conference": "Michigan",
                    "firstPlaceVotes": 0,
                    "points": 577
                  },
                  {
                    "rank": 15,
                    "school": "John Carroll",
                    "conference": "Ohio",
                    "firstPlaceVotes": 0,
                    "points": 549
                  },
                  {
                    "rank": 16,
                    "school": "Ithaca",
                    "conference": "Liberty League",
                    "firstPlaceVotes": 0,
                    "points": 457
                  },
                  {
                    "rank": 17,
                    "school": "SUNY Cortland",
                    "conference": "Empire 8",
                    "firstPlaceVotes": 0,
                    "points": 413
                  },
                  {
                    "rank": 18,
                    "school": "Endicott College",
                    "conference": "Commonwealth Coast",
                    "firstPlaceVotes": 0,
                    "points": 342
                  },
                  {
                    "rank": 19,
                    "school": "Hardin-Simmons",
                    "conference": "American Southwest",
                    "firstPlaceVotes": 0,
                    "points": 288
                  },
                  {
                    "rank": 20,
                    "school": "Grove City College",
                    "conference": "Presidents'",
                    "firstPlaceVotes": 0,
                    "points": 275
                  },
                  {
                    "rank": 21,
                    "school": "St. Johns (MN)",
                    "conference": "Minnesota",
                    "firstPlaceVotes": 0,
                    "points": 262
                  },
                  {
                    "rank": 22,
                    "school": "Muhlenberg",
                    "conference": "Centennial",
                    "firstPlaceVotes": 0,
                    "points": 230
                  },
                  {
                    "rank": 23,
                    "school": "DePauw",
                    "conference": "North Coast",
                    "firstPlaceVotes": 0,
                    "points": 183
                  },
                  {
                    "rank": 24,
                    "school": "Delaware Valley",
                    "conference": "Mid Atlantic",
                    "firstPlaceVotes": 0,
                    "points": 114
                  },
                  {
                    "rank": 25,
                    "school": "Berry College",
                    "conference": "Southern Athletic",
                    "firstPlaceVotes": 0,
                    "points": 99
                  }
                ]
              },
              {
                "poll": "Playoff Committee Rankings",
                "ranks": [
                  {
                    "rank": 1,
                    "school": "Ohio State",
                    "conference": "Big Ten",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 2,
                    "school": "Georgia",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 3,
                    "school": "Michigan",
                    "conference": "Big Ten",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 4,
                    "school": "Florida State",
                    "conference": "ACC",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 5,
                    "school": "Washington",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 6,
                    "school": "Oregon",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 7,
                    "school": "Texas",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 8,
                    "school": "Alabama",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 9,
                    "school": "Florida",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 10,
                    "school": "Ole Miss",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 11,
                    "school": "Penn State",
                    "conference": "Big Ten",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 12,
                    "school": "Missouri",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 13,
                    "school": "Louisville",
                    "conference": "ACC",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 14,
                    "school": "LSU",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 15,
                    "school": "Notre Dame",
                    "conference": "FBS Independents",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 16,
                    "school": "Oregon State",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 17,
                    "school": "Tennessee",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 18,
                    "school": "Utah",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 19,
                    "school": "UCLA",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 20,
                    "school": "USC",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 21,
                    "school": "Kansas",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 22,
                    "school": "Oklahoma State",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 23,
                    "school": "Kansas State",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 24,
                    "school": "Tulane",
                    "conference": "American Athletic",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 25,
                    "school": "Air Force",
                    "conference": "Mountain West",
                    "firstPlaceVotes": 0,
                    "points": 0
                  }
                ]
              }
            ]
          }];

        global.fetch = jest.fn(() => Promise.resolve({
            json: () => Promise.resolve(rankings)
        }));

        var resultingScore = await scoringModule.calculateScoreV2(team, game, week);
        expect(resultingScore).toEqual(6);
    });
    
    it('College Football Playoff Berth', async () => {
        const team = "Alabama";
        const game = {
            "_id": {
              "$oid": "65dfd98d1546400b2aeb7cb7"
            },
            "id": 401551786,
            "season": 2023,
            "week": 1,
            "seasonType": "postseason",
            "startDate": "2024-01-01T22:00:00.000Z",
            "startTimeTbd": false,
            "completed": true,
            "neutralSite": true,
            "conferenceGame": false,
            "attendance": null,
            "venueId": 1056,
            "venue": "Rose Bowl",
            "homeId": 130,
            "homeTeam": "Michigan",
            "homeConference": "Big Ten",
            "homeDivision": "fbs",
            "homePoints": 27,
            "homeLineScores": [
              7,
              6,
              0,
              7,
              7
            ],
            "homePostWinProb": "0.9826896588603007",
            "homePregameElo": 2174,
            "homePostgameElo": 2181,
            "awayId": 333,
            "awayTeam": "Alabama",
            "awayConference": "SEC",
            "awayDivision": "fbs",
            "awayPoints": 20,
            "awayLineScores": [
              7,
              3,
              0,
              10,
              0
            ],
            "awayPostWinProb": "0.017310341139699315",
            "awayPregameElo": 2039,
            "awayPostgameElo": 2032,
            "excitementIndex": "8.2128059565",
            "highlights": null,
            "notes": "CFP Semifinal at the Rose Bowl Game Pres. by Prudential"
          };
        const week = 10;
        const rankings = [{
            "_id": {
              "$oid": "65de66651546400b2aeb6e64"
            },
            "season": 2023,
            "seasonType": "regular",
            "week": 10,
            "polls": [
              {
                "poll": "Coaches Poll",
                "ranks": [
                  {
                    "rank": 1,
                    "school": "Georgia",
                    "conference": "SEC",
                    "firstPlaceVotes": 58,
                    "points": 1590
                  },
                  {
                    "rank": 2,
                    "school": "Michigan",
                    "conference": "Big Ten",
                    "firstPlaceVotes": 3,
                    "points": 1520
                  },
                  {
                    "rank": 3,
                    "school": "Ohio State",
                    "conference": "Big Ten",
                    "firstPlaceVotes": 3,
                    "points": 1454
                  },
                  {
                    "rank": 4,
                    "school": "Florida State",
                    "conference": "ACC",
                    "firstPlaceVotes": 0,
                    "points": 1439
                  },
                  {
                    "rank": 5,
                    "school": "Washington",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 1344
                  },
                  {
                    "rank": 6,
                    "school": "Texas",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 1212
                  },
                  {
                    "rank": 7,
                    "school": "Oregon",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 1211
                  },
                  {
                    "rank": 8,
                    "school": "Alabama",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 1187
                  },
                  {
                    "rank": 9,
                    "school": "Penn State",
                    "conference": "Big Ten",
                    "firstPlaceVotes": 0,
                    "points": 1072
                  },
                  {
                    "rank": 10,
                    "school": "Ole Miss",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 1021
                  },
                  {
                    "rank": 11,
                    "school": "Oklahoma",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 948
                  },
                  {
                    "rank": 12,
                    "school": "Notre Dame",
                    "conference": "FBS Independents",
                    "firstPlaceVotes": 0,
                    "points": 847
                  },
                  {
                    "rank": 13,
                    "school": "LSU",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 809
                  },
                  {
                    "rank": 14,
                    "school": "Missouri",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 741
                  },
                  {
                    "rank": 15,
                    "school": "Louisville",
                    "conference": "ACC",
                    "firstPlaceVotes": 0,
                    "points": 701
                  },
                  {
                    "rank": 16,
                    "school": "Tennessee",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 553
                  },
                  {
                    "rank": 17,
                    "school": "Air Force",
                    "conference": "Mountain West",
                    "firstPlaceVotes": 0,
                    "points": 523
                  },
                  {
                    "rank": 18,
                    "school": "Utah",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 509
                  },
                  {
                    "rank": 19,
                    "school": "Oregon State",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 465
                  },
                  {
                    "rank": 20,
                    "school": "UCLA",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 309
                  },
                  {
                    "rank": 21,
                    "school": "Tulane",
                    "conference": "American Athletic",
                    "firstPlaceVotes": 0,
                    "points": 304
                  },
                  {
                    "rank": 22,
                    "school": "USC",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 239
                  },
                  {
                    "rank": 23,
                    "school": "Kansas",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 182
                  },
                  {
                    "rank": 24,
                    "school": "James Madison",
                    "conference": "Sun Belt",
                    "firstPlaceVotes": 0,
                    "points": 169
                  },
                  {
                    "rank": 25,
                    "school": "North Carolina",
                    "conference": "ACC",
                    "firstPlaceVotes": 0,
                    "points": 120
                  }
                ]
              },
              {
                "poll": "AP Top 25",
                "ranks": [
                  {
                    "rank": 1,
                    "school": "Georgia",
                    "conference": "SEC",
                    "firstPlaceVotes": 48,
                    "points": 1553
                  },
                  {
                    "rank": 2,
                    "school": "Michigan",
                    "conference": "Big Ten",
                    "firstPlaceVotes": 9,
                    "points": 1494
                  },
                  {
                    "rank": 3,
                    "school": "Ohio State",
                    "conference": "Big Ten",
                    "firstPlaceVotes": 3,
                    "points": 1446
                  },
                  {
                    "rank": 4,
                    "school": "Florida State",
                    "conference": "ACC",
                    "firstPlaceVotes": 3,
                    "points": 1421
                  },
                  {
                    "rank": 5,
                    "school": "Washington",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 1327
                  },
                  {
                    "rank": 6,
                    "school": "Oregon",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 1235
                  },
                  {
                    "rank": 7,
                    "school": "Texas",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 1189
                  },
                  {
                    "rank": 8,
                    "school": "Alabama",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 1114
                  },
                  {
                    "rank": 9,
                    "school": "Penn State",
                    "conference": "Big Ten",
                    "firstPlaceVotes": 0,
                    "points": 1044
                  },
                  {
                    "rank": 10,
                    "school": "Oklahoma",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 1010
                  },
                  {
                    "rank": 11,
                    "school": "Ole Miss",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 990
                  },
                  {
                    "rank": 12,
                    "school": "Notre Dame",
                    "conference": "FBS Independents",
                    "firstPlaceVotes": 0,
                    "points": 847
                  },
                  {
                    "rank": 13,
                    "school": "LSU",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 816
                  },
                  {
                    "rank": 14,
                    "school": "Missouri",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 714
                  },
                  {
                    "rank": 15,
                    "school": "Louisville",
                    "conference": "ACC",
                    "firstPlaceVotes": 0,
                    "points": 666
                  },
                  {
                    "rank": 16,
                    "school": "Oregon State",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 557
                  },
                  {
                    "rank": 17,
                    "school": "Air Force",
                    "conference": "Mountain West",
                    "firstPlaceVotes": 0,
                    "points": 526
                  },
                  {
                    "rank": 18,
                    "school": "Utah",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 510
                  },
                  {
                    "rank": 19,
                    "school": "Tennessee",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 473
                  },
                  {
                    "rank": 20,
                    "school": "UCLA",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 331
                  },
                  {
                    "rank": 21,
                    "school": "Tulane",
                    "conference": "American Athletic",
                    "firstPlaceVotes": 0,
                    "points": 303
                  },
                  {
                    "rank": 22,
                    "school": "Kansas",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 250
                  },
                  {
                    "rank": 23,
                    "school": "James Madison",
                    "conference": "Sun Belt",
                    "firstPlaceVotes": 0,
                    "points": 192
                  },
                  {
                    "rank": 24,
                    "school": "USC",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 139
                  },
                  {
                    "rank": 25,
                    "school": "Kansas State",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 112
                  }
                ]
              },
              {
                "poll": "FCS Coaches Poll",
                "ranks": [
                  {
                    "rank": 1,
                    "school": "South Dakota State",
                    "conference": "MVFC",
                    "firstPlaceVotes": 25,
                    "points": 625
                  },
                  {
                    "rank": 2,
                    "school": "Furman",
                    "conference": "Southern",
                    "firstPlaceVotes": 0,
                    "points": 577
                  },
                  {
                    "rank": 3,
                    "school": "Montana",
                    "conference": "Big Sky",
                    "firstPlaceVotes": 0,
                    "points": 544
                  },
                  {
                    "rank": 4,
                    "school": "Incarnate Word",
                    "conference": "Southland",
                    "firstPlaceVotes": 0,
                    "points": 533
                  },
                  {
                    "rank": 5,
                    "school": "Idaho",
                    "conference": "Big Sky",
                    "firstPlaceVotes": 0,
                    "points": 515
                  },
                  {
                    "rank": 6,
                    "school": "Delaware",
                    "conference": "CAA",
                    "firstPlaceVotes": 0,
                    "points": 507
                  },
                  {
                    "rank": 7,
                    "school": "Sacramento State",
                    "conference": "Big Sky",
                    "firstPlaceVotes": 0,
                    "points": 471
                  },
                  {
                    "rank": 8,
                    "school": "Montana State",
                    "conference": "Big Sky",
                    "firstPlaceVotes": 0,
                    "points": 458
                  },
                  {
                    "rank": 9,
                    "school": "North Carolina Central",
                    "conference": "MEAC",
                    "firstPlaceVotes": 0,
                    "points": 407
                  },
                  {
                    "rank": 10,
                    "school": "North Dakota State",
                    "conference": "MVFC",
                    "firstPlaceVotes": 0,
                    "points": 398
                  },
                  {
                    "rank": 11,
                    "school": "Southern Illinois",
                    "conference": "MVFC",
                    "firstPlaceVotes": 0,
                    "points": 380
                  },
                  {
                    "rank": 12,
                    "school": "South Dakota",
                    "conference": "MVFC",
                    "firstPlaceVotes": 0,
                    "points": 330
                  },
                  {
                    "rank": 13,
                    "school": "Florida A&M",
                    "conference": "SWAC",
                    "firstPlaceVotes": 0,
                    "points": 296
                  },
                  {
                    "rank": 13,
                    "school": "Chattanooga",
                    "conference": "Southern",
                    "firstPlaceVotes": 0,
                    "points": 296
                  },
                  {
                    "rank": 15,
                    "school": "North Dakota",
                    "conference": "MVFC",
                    "firstPlaceVotes": 0,
                    "points": 260
                  },
                  {
                    "rank": 16,
                    "school": "Lafayette",
                    "conference": "Patriot",
                    "firstPlaceVotes": 0,
                    "points": 241
                  },
                  {
                    "rank": 17,
                    "school": "Austin Peay",
                    "conference": "UAC",
                    "firstPlaceVotes": 0,
                    "points": 218
                  },
                  {
                    "rank": 18,
                    "school": "UT Martin",
                    "conference": "Big South-OVC",
                    "firstPlaceVotes": 0,
                    "points": 179
                  },
                  {
                    "rank": 19,
                    "school": "Harvard",
                    "conference": "Ivy",
                    "firstPlaceVotes": 0,
                    "points": 137
                  },
                  {
                    "rank": 20,
                    "school": "Western Carolina",
                    "conference": "Southern",
                    "firstPlaceVotes": 0,
                    "points": 124
                  },
                  {
                    "rank": 21,
                    "school": "Holy Cross",
                    "conference": "Patriot",
                    "firstPlaceVotes": 0,
                    "points": 120
                  },
                  {
                    "rank": 22,
                    "school": "Villanova",
                    "conference": "CAA",
                    "firstPlaceVotes": 0,
                    "points": 107
                  },
                  {
                    "rank": 23,
                    "school": "Northern Iowa",
                    "conference": "MVFC",
                    "firstPlaceVotes": 0,
                    "points": 105
                  },
                  {
                    "rank": 24,
                    "school": "William & Mary",
                    "conference": "CAA",
                    "firstPlaceVotes": 0,
                    "points": 83
                  },
                  {
                    "rank": 25,
                    "school": "Central Arkansas",
                    "conference": "UAC",
                    "firstPlaceVotes": 0,
                    "points": 73
                  }
                ]
              },
              {
                "poll": "AFCA Division II Coaches Poll",
                "ranks": [
                  {
                    "rank": 1,
                    "school": "Colorado Mines",
                    "conference": "Rocky Mountain",
                    "firstPlaceVotes": 26,
                    "points": 720
                  },
                  {
                    "rank": 2,
                    "school": "Pittsburg State",
                    "conference": "Mid America",
                    "firstPlaceVotes": 1,
                    "points": 694
                  },
                  {
                    "rank": 3,
                    "school": "Grand Valley State",
                    "conference": "GLIAC",
                    "firstPlaceVotes": 1,
                    "points": 662
                  },
                  {
                    "rank": 4,
                    "school": "Harding",
                    "conference": "Great American",
                    "firstPlaceVotes": 0,
                    "points": 637
                  },
                  {
                    "rank": 5,
                    "school": "Slippery Rock",
                    "conference": "Pennsylvania State Athletic",
                    "firstPlaceVotes": 1,
                    "points": 582
                  },
                  {
                    "rank": 6,
                    "school": "Benedict College",
                    "conference": "SIAC",
                    "firstPlaceVotes": 0,
                    "points": 573
                  },
                  {
                    "rank": 7,
                    "school": "Ferris State",
                    "conference": "GLIAC",
                    "firstPlaceVotes": 0,
                    "points": 534
                  },
                  {
                    "rank": 8,
                    "school": "Indianapolis",
                    "conference": "Great Lakes",
                    "firstPlaceVotes": 0,
                    "points": 503
                  },
                  {
                    "rank": 9,
                    "school": "Davenport",
                    "conference": "GLIAC",
                    "firstPlaceVotes": 0,
                    "points": 484
                  },
                  {
                    "rank": 10,
                    "school": "Minnesota State",
                    "conference": "Northern Sun",
                    "firstPlaceVotes": 0,
                    "points": 437
                  },
                  {
                    "rank": 11,
                    "school": "Central Missouri State",
                    "conference": "Mid America",
                    "firstPlaceVotes": 0,
                    "points": 406
                  },
                  {
                    "rank": 12,
                    "school": "Ouachita Baptist",
                    "conference": "Great American",
                    "firstPlaceVotes": 0,
                    "points": 399
                  },
                  {
                    "rank": 13,
                    "school": "Bemidji State",
                    "conference": "Northern Sun",
                    "firstPlaceVotes": 0,
                    "points": 353
                  },
                  {
                    "rank": 14,
                    "school": "Delta State",
                    "conference": "Gulf South",
                    "firstPlaceVotes": 0,
                    "points": 322
                  },
                  {
                    "rank": 15,
                    "school": "Western State",
                    "conference": "Rocky Mountain",
                    "firstPlaceVotes": 0,
                    "points": 321
                  },
                  {
                    "rank": 16,
                    "school": "Lenoir-Rhyne",
                    "conference": "South Atlantic",
                    "firstPlaceVotes": 0,
                    "points": 291
                  },
                  {
                    "rank": 17,
                    "school": "Tiffin",
                    "conference": "Great Midwest Athletic",
                    "firstPlaceVotes": 0,
                    "points": 282
                  },
                  {
                    "rank": 18,
                    "school": "University of Texas of the Permian Basin",
                    "conference": "Lone Star",
                    "firstPlaceVotes": 0,
                    "points": 228
                  },
                  {
                    "rank": 19,
                    "school": "Virginia Union",
                    "conference": "CIAA",
                    "firstPlaceVotes": 0,
                    "points": 210
                  },
                  {
                    "rank": 20,
                    "school": "Valdosta State",
                    "conference": "Gulf South",
                    "firstPlaceVotes": 0,
                    "points": 207
                  },
                  {
                    "rank": 21,
                    "school": "Augustana (SD)",
                    "conference": "Northern Sun",
                    "firstPlaceVotes": 0,
                    "points": 183
                  },
                  {
                    "rank": 22,
                    "school": "Virginia State",
                    "conference": "CIAA",
                    "firstPlaceVotes": 0,
                    "points": 86
                  },
                  {
                    "rank": 23,
                    "school": "Missouri Western",
                    "conference": "Mid America",
                    "firstPlaceVotes": 0,
                    "points": 69
                  },
                  {
                    "rank": 24,
                    "school": "Central Washington",
                    "conference": "Lone Star",
                    "firstPlaceVotes": 0,
                    "points": 54
                  },
                  {
                    "rank": 25,
                    "school": "Mars Hill",
                    "conference": "South Atlantic",
                    "firstPlaceVotes": 0,
                    "points": 43
                  }
                ]
              },
              {
                "poll": "AFCA Division III Coaches Poll",
                "ranks": [
                  {
                    "rank": 1,
                    "school": "North Central",
                    "conference": "CCIW",
                    "firstPlaceVotes": 48,
                    "points": 1224
                  },
                  {
                    "rank": 2,
                    "school": "Mount Union",
                    "conference": "Ohio",
                    "firstPlaceVotes": 1,
                    "points": 1173
                  },
                  {
                    "rank": 3,
                    "school": "Wartburg",
                    "conference": "American Rivers",
                    "firstPlaceVotes": 0,
                    "points": 1120
                  },
                  {
                    "rank": 4,
                    "school": "Linfield",
                    "conference": "Northwest",
                    "firstPlaceVotes": 0,
                    "points": 1024
                  },
                  {
                    "rank": 5,
                    "school": "Trinity (TX)",
                    "conference": "Southern Athletic",
                    "firstPlaceVotes": 0,
                    "points": 986
                  },
                  {
                    "rank": 6,
                    "school": "UW-Whitewater",
                    "conference": "Wisconsin",
                    "firstPlaceVotes": 0,
                    "points": 958
                  },
                  {
                    "rank": 7,
                    "school": "Wisconsin-La Crosse",
                    "conference": "Wisconsin",
                    "firstPlaceVotes": 0,
                    "points": 909
                  },
                  {
                    "rank": 8,
                    "school": "Johns Hopkins",
                    "conference": "Centennial",
                    "firstPlaceVotes": 0,
                    "points": 903
                  },
                  {
                    "rank": 9,
                    "school": "Randolph-Macon",
                    "conference": "Old Dominion",
                    "firstPlaceVotes": 0,
                    "points": 817
                  },
                  {
                    "rank": 10,
                    "school": "UW-River Falls",
                    "conference": "Wisconsin",
                    "firstPlaceVotes": 0,
                    "points": 779
                  },
                  {
                    "rank": 11,
                    "school": "Aurora",
                    "conference": "NACC",
                    "firstPlaceVotes": 0,
                    "points": 724
                  },
                  {
                    "rank": 12,
                    "school": "Susquehanna",
                    "conference": "Landmark Conference",
                    "firstPlaceVotes": 0,
                    "points": 688
                  },
                  {
                    "rank": 13,
                    "school": "Wheaton College (Ill)",
                    "conference": "CCIW",
                    "firstPlaceVotes": 0,
                    "points": 619
                  },
                  {
                    "rank": 14,
                    "school": "Alma College",
                    "conference": "Michigan",
                    "firstPlaceVotes": 0,
                    "points": 577
                  },
                  {
                    "rank": 15,
                    "school": "John Carroll",
                    "conference": "Ohio",
                    "firstPlaceVotes": 0,
                    "points": 549
                  },
                  {
                    "rank": 16,
                    "school": "Ithaca",
                    "conference": "Liberty League",
                    "firstPlaceVotes": 0,
                    "points": 457
                  },
                  {
                    "rank": 17,
                    "school": "SUNY Cortland",
                    "conference": "Empire 8",
                    "firstPlaceVotes": 0,
                    "points": 413
                  },
                  {
                    "rank": 18,
                    "school": "Endicott College",
                    "conference": "Commonwealth Coast",
                    "firstPlaceVotes": 0,
                    "points": 342
                  },
                  {
                    "rank": 19,
                    "school": "Hardin-Simmons",
                    "conference": "American Southwest",
                    "firstPlaceVotes": 0,
                    "points": 288
                  },
                  {
                    "rank": 20,
                    "school": "Grove City College",
                    "conference": "Presidents'",
                    "firstPlaceVotes": 0,
                    "points": 275
                  },
                  {
                    "rank": 21,
                    "school": "St. Johns (MN)",
                    "conference": "Minnesota",
                    "firstPlaceVotes": 0,
                    "points": 262
                  },
                  {
                    "rank": 22,
                    "school": "Muhlenberg",
                    "conference": "Centennial",
                    "firstPlaceVotes": 0,
                    "points": 230
                  },
                  {
                    "rank": 23,
                    "school": "DePauw",
                    "conference": "North Coast",
                    "firstPlaceVotes": 0,
                    "points": 183
                  },
                  {
                    "rank": 24,
                    "school": "Delaware Valley",
                    "conference": "Mid Atlantic",
                    "firstPlaceVotes": 0,
                    "points": 114
                  },
                  {
                    "rank": 25,
                    "school": "Berry College",
                    "conference": "Southern Athletic",
                    "firstPlaceVotes": 0,
                    "points": 99
                  }
                ]
              },
              {
                "poll": "Playoff Committee Rankings",
                "ranks": [
                  {
                    "rank": 1,
                    "school": "Ohio State",
                    "conference": "Big Ten",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 2,
                    "school": "Georgia",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 3,
                    "school": "Michigan",
                    "conference": "Big Ten",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 4,
                    "school": "Florida State",
                    "conference": "ACC",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 5,
                    "school": "Washington",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 6,
                    "school": "Oregon",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 7,
                    "school": "Texas",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 8,
                    "school": "Alabama",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 9,
                    "school": "Florida",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 10,
                    "school": "Ole Miss",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 11,
                    "school": "Penn State",
                    "conference": "Big Ten",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 12,
                    "school": "Missouri",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 13,
                    "school": "Louisville",
                    "conference": "ACC",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 14,
                    "school": "LSU",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 15,
                    "school": "Notre Dame",
                    "conference": "FBS Independents",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 16,
                    "school": "Oregon State",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 17,
                    "school": "Tennessee",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 18,
                    "school": "Utah",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 19,
                    "school": "UCLA",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 20,
                    "school": "USC",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 21,
                    "school": "Kansas",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 22,
                    "school": "Oklahoma State",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 23,
                    "school": "Kansas State",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 24,
                    "school": "Tulane",
                    "conference": "American Athletic",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 25,
                    "school": "Air Force",
                    "conference": "Mountain West",
                    "firstPlaceVotes": 0,
                    "points": 0
                  }
                ]
              }
            ]
          }];

        global.fetch = jest.fn(() => Promise.resolve({
            json: () => Promise.resolve(rankings)
        }));

        var resultingScore = await scoringModule.calculateScoreV2(team, game, week);
        expect(resultingScore).toEqual(7);
    });
    
    it('College Football Playoff Final Win', async () => {
        const team = "Michigan";
        const game = {
            "_id": {
              "$oid": "65dfd98d1546400b2aeb7cba"
            },
            "id": 401551789,
            "season": 2023,
            "week": 1,
            "seasonType": "postseason",
            "startDate": "2024-01-09T00:30:00.000Z",
            "startTimeTbd": false,
            "completed": true,
            "neutralSite": true,
            "conferenceGame": false,
            "attendance": null,
            "venueId": 3891,
            "venue": "NRG Stadium",
            "homeId": 130,
            "homeTeam": "Michigan",
            "homeConference": "Big Ten",
            "homeDivision": "fbs",
            "homePoints": 34,
            "homeLineScores": [
              14,
              3,
              3,
              14
            ],
            "homePostWinProb": "0.9938549482877855",
            "homePregameElo": 2181,
            "homePostgameElo": 2210,
            "awayId": 264,
            "awayTeam": "Washington",
            "awayConference": "Pac-12",
            "awayDivision": "fbs",
            "awayPoints": 13,
            "awayLineScores": [
              3,
              7,
              3,
              0
            ],
            "awayPostWinProb": "0.0061450517122144666",
            "awayPregameElo": 1908,
            "awayPostgameElo": 1879,
            "excitementIndex": "5.6661554258",
            "highlights": null,
            "notes": "CFP National Championship Pres. by AT&T"
          };
        const week = 1;
        const rankings = [{
            "_id": {
              "$oid": "65de66651546400b2aeb6e64"
            },
            "season": 2023,
            "seasonType": "regular",
            "week": 10,
            "polls": [
              {
                "poll": "Coaches Poll",
                "ranks": [
                  {
                    "rank": 1,
                    "school": "Georgia",
                    "conference": "SEC",
                    "firstPlaceVotes": 58,
                    "points": 1590
                  },
                  {
                    "rank": 2,
                    "school": "Michigan",
                    "conference": "Big Ten",
                    "firstPlaceVotes": 3,
                    "points": 1520
                  },
                  {
                    "rank": 3,
                    "school": "Ohio State",
                    "conference": "Big Ten",
                    "firstPlaceVotes": 3,
                    "points": 1454
                  },
                  {
                    "rank": 4,
                    "school": "Florida State",
                    "conference": "ACC",
                    "firstPlaceVotes": 0,
                    "points": 1439
                  },
                  {
                    "rank": 5,
                    "school": "Washington",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 1344
                  },
                  {
                    "rank": 6,
                    "school": "Texas",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 1212
                  },
                  {
                    "rank": 7,
                    "school": "Oregon",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 1211
                  },
                  {
                    "rank": 8,
                    "school": "Alabama",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 1187
                  },
                  {
                    "rank": 9,
                    "school": "Penn State",
                    "conference": "Big Ten",
                    "firstPlaceVotes": 0,
                    "points": 1072
                  },
                  {
                    "rank": 10,
                    "school": "Ole Miss",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 1021
                  },
                  {
                    "rank": 11,
                    "school": "Oklahoma",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 948
                  },
                  {
                    "rank": 12,
                    "school": "Notre Dame",
                    "conference": "FBS Independents",
                    "firstPlaceVotes": 0,
                    "points": 847
                  },
                  {
                    "rank": 13,
                    "school": "LSU",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 809
                  },
                  {
                    "rank": 14,
                    "school": "Missouri",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 741
                  },
                  {
                    "rank": 15,
                    "school": "Louisville",
                    "conference": "ACC",
                    "firstPlaceVotes": 0,
                    "points": 701
                  },
                  {
                    "rank": 16,
                    "school": "Tennessee",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 553
                  },
                  {
                    "rank": 17,
                    "school": "Air Force",
                    "conference": "Mountain West",
                    "firstPlaceVotes": 0,
                    "points": 523
                  },
                  {
                    "rank": 18,
                    "school": "Utah",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 509
                  },
                  {
                    "rank": 19,
                    "school": "Oregon State",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 465
                  },
                  {
                    "rank": 20,
                    "school": "UCLA",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 309
                  },
                  {
                    "rank": 21,
                    "school": "Tulane",
                    "conference": "American Athletic",
                    "firstPlaceVotes": 0,
                    "points": 304
                  },
                  {
                    "rank": 22,
                    "school": "USC",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 239
                  },
                  {
                    "rank": 23,
                    "school": "Kansas",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 182
                  },
                  {
                    "rank": 24,
                    "school": "James Madison",
                    "conference": "Sun Belt",
                    "firstPlaceVotes": 0,
                    "points": 169
                  },
                  {
                    "rank": 25,
                    "school": "North Carolina",
                    "conference": "ACC",
                    "firstPlaceVotes": 0,
                    "points": 120
                  }
                ]
              },
              {
                "poll": "AP Top 25",
                "ranks": [
                  {
                    "rank": 1,
                    "school": "Georgia",
                    "conference": "SEC",
                    "firstPlaceVotes": 48,
                    "points": 1553
                  },
                  {
                    "rank": 2,
                    "school": "Michigan",
                    "conference": "Big Ten",
                    "firstPlaceVotes": 9,
                    "points": 1494
                  },
                  {
                    "rank": 3,
                    "school": "Ohio State",
                    "conference": "Big Ten",
                    "firstPlaceVotes": 3,
                    "points": 1446
                  },
                  {
                    "rank": 4,
                    "school": "Florida State",
                    "conference": "ACC",
                    "firstPlaceVotes": 3,
                    "points": 1421
                  },
                  {
                    "rank": 5,
                    "school": "Washington",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 1327
                  },
                  {
                    "rank": 6,
                    "school": "Oregon",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 1235
                  },
                  {
                    "rank": 7,
                    "school": "Texas",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 1189
                  },
                  {
                    "rank": 8,
                    "school": "Alabama",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 1114
                  },
                  {
                    "rank": 9,
                    "school": "Penn State",
                    "conference": "Big Ten",
                    "firstPlaceVotes": 0,
                    "points": 1044
                  },
                  {
                    "rank": 10,
                    "school": "Oklahoma",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 1010
                  },
                  {
                    "rank": 11,
                    "school": "Ole Miss",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 990
                  },
                  {
                    "rank": 12,
                    "school": "Notre Dame",
                    "conference": "FBS Independents",
                    "firstPlaceVotes": 0,
                    "points": 847
                  },
                  {
                    "rank": 13,
                    "school": "LSU",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 816
                  },
                  {
                    "rank": 14,
                    "school": "Missouri",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 714
                  },
                  {
                    "rank": 15,
                    "school": "Louisville",
                    "conference": "ACC",
                    "firstPlaceVotes": 0,
                    "points": 666
                  },
                  {
                    "rank": 16,
                    "school": "Oregon State",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 557
                  },
                  {
                    "rank": 17,
                    "school": "Air Force",
                    "conference": "Mountain West",
                    "firstPlaceVotes": 0,
                    "points": 526
                  },
                  {
                    "rank": 18,
                    "school": "Utah",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 510
                  },
                  {
                    "rank": 19,
                    "school": "Tennessee",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 473
                  },
                  {
                    "rank": 20,
                    "school": "UCLA",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 331
                  },
                  {
                    "rank": 21,
                    "school": "Tulane",
                    "conference": "American Athletic",
                    "firstPlaceVotes": 0,
                    "points": 303
                  },
                  {
                    "rank": 22,
                    "school": "Kansas",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 250
                  },
                  {
                    "rank": 23,
                    "school": "James Madison",
                    "conference": "Sun Belt",
                    "firstPlaceVotes": 0,
                    "points": 192
                  },
                  {
                    "rank": 24,
                    "school": "USC",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 139
                  },
                  {
                    "rank": 25,
                    "school": "Kansas State",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 112
                  }
                ]
              },
              {
                "poll": "FCS Coaches Poll",
                "ranks": [
                  {
                    "rank": 1,
                    "school": "South Dakota State",
                    "conference": "MVFC",
                    "firstPlaceVotes": 25,
                    "points": 625
                  },
                  {
                    "rank": 2,
                    "school": "Furman",
                    "conference": "Southern",
                    "firstPlaceVotes": 0,
                    "points": 577
                  },
                  {
                    "rank": 3,
                    "school": "Montana",
                    "conference": "Big Sky",
                    "firstPlaceVotes": 0,
                    "points": 544
                  },
                  {
                    "rank": 4,
                    "school": "Incarnate Word",
                    "conference": "Southland",
                    "firstPlaceVotes": 0,
                    "points": 533
                  },
                  {
                    "rank": 5,
                    "school": "Idaho",
                    "conference": "Big Sky",
                    "firstPlaceVotes": 0,
                    "points": 515
                  },
                  {
                    "rank": 6,
                    "school": "Delaware",
                    "conference": "CAA",
                    "firstPlaceVotes": 0,
                    "points": 507
                  },
                  {
                    "rank": 7,
                    "school": "Sacramento State",
                    "conference": "Big Sky",
                    "firstPlaceVotes": 0,
                    "points": 471
                  },
                  {
                    "rank": 8,
                    "school": "Montana State",
                    "conference": "Big Sky",
                    "firstPlaceVotes": 0,
                    "points": 458
                  },
                  {
                    "rank": 9,
                    "school": "North Carolina Central",
                    "conference": "MEAC",
                    "firstPlaceVotes": 0,
                    "points": 407
                  },
                  {
                    "rank": 10,
                    "school": "North Dakota State",
                    "conference": "MVFC",
                    "firstPlaceVotes": 0,
                    "points": 398
                  },
                  {
                    "rank": 11,
                    "school": "Southern Illinois",
                    "conference": "MVFC",
                    "firstPlaceVotes": 0,
                    "points": 380
                  },
                  {
                    "rank": 12,
                    "school": "South Dakota",
                    "conference": "MVFC",
                    "firstPlaceVotes": 0,
                    "points": 330
                  },
                  {
                    "rank": 13,
                    "school": "Florida A&M",
                    "conference": "SWAC",
                    "firstPlaceVotes": 0,
                    "points": 296
                  },
                  {
                    "rank": 13,
                    "school": "Chattanooga",
                    "conference": "Southern",
                    "firstPlaceVotes": 0,
                    "points": 296
                  },
                  {
                    "rank": 15,
                    "school": "North Dakota",
                    "conference": "MVFC",
                    "firstPlaceVotes": 0,
                    "points": 260
                  },
                  {
                    "rank": 16,
                    "school": "Lafayette",
                    "conference": "Patriot",
                    "firstPlaceVotes": 0,
                    "points": 241
                  },
                  {
                    "rank": 17,
                    "school": "Austin Peay",
                    "conference": "UAC",
                    "firstPlaceVotes": 0,
                    "points": 218
                  },
                  {
                    "rank": 18,
                    "school": "UT Martin",
                    "conference": "Big South-OVC",
                    "firstPlaceVotes": 0,
                    "points": 179
                  },
                  {
                    "rank": 19,
                    "school": "Harvard",
                    "conference": "Ivy",
                    "firstPlaceVotes": 0,
                    "points": 137
                  },
                  {
                    "rank": 20,
                    "school": "Western Carolina",
                    "conference": "Southern",
                    "firstPlaceVotes": 0,
                    "points": 124
                  },
                  {
                    "rank": 21,
                    "school": "Holy Cross",
                    "conference": "Patriot",
                    "firstPlaceVotes": 0,
                    "points": 120
                  },
                  {
                    "rank": 22,
                    "school": "Villanova",
                    "conference": "CAA",
                    "firstPlaceVotes": 0,
                    "points": 107
                  },
                  {
                    "rank": 23,
                    "school": "Northern Iowa",
                    "conference": "MVFC",
                    "firstPlaceVotes": 0,
                    "points": 105
                  },
                  {
                    "rank": 24,
                    "school": "William & Mary",
                    "conference": "CAA",
                    "firstPlaceVotes": 0,
                    "points": 83
                  },
                  {
                    "rank": 25,
                    "school": "Central Arkansas",
                    "conference": "UAC",
                    "firstPlaceVotes": 0,
                    "points": 73
                  }
                ]
              },
              {
                "poll": "AFCA Division II Coaches Poll",
                "ranks": [
                  {
                    "rank": 1,
                    "school": "Colorado Mines",
                    "conference": "Rocky Mountain",
                    "firstPlaceVotes": 26,
                    "points": 720
                  },
                  {
                    "rank": 2,
                    "school": "Pittsburg State",
                    "conference": "Mid America",
                    "firstPlaceVotes": 1,
                    "points": 694
                  },
                  {
                    "rank": 3,
                    "school": "Grand Valley State",
                    "conference": "GLIAC",
                    "firstPlaceVotes": 1,
                    "points": 662
                  },
                  {
                    "rank": 4,
                    "school": "Harding",
                    "conference": "Great American",
                    "firstPlaceVotes": 0,
                    "points": 637
                  },
                  {
                    "rank": 5,
                    "school": "Slippery Rock",
                    "conference": "Pennsylvania State Athletic",
                    "firstPlaceVotes": 1,
                    "points": 582
                  },
                  {
                    "rank": 6,
                    "school": "Benedict College",
                    "conference": "SIAC",
                    "firstPlaceVotes": 0,
                    "points": 573
                  },
                  {
                    "rank": 7,
                    "school": "Ferris State",
                    "conference": "GLIAC",
                    "firstPlaceVotes": 0,
                    "points": 534
                  },
                  {
                    "rank": 8,
                    "school": "Indianapolis",
                    "conference": "Great Lakes",
                    "firstPlaceVotes": 0,
                    "points": 503
                  },
                  {
                    "rank": 9,
                    "school": "Davenport",
                    "conference": "GLIAC",
                    "firstPlaceVotes": 0,
                    "points": 484
                  },
                  {
                    "rank": 10,
                    "school": "Minnesota State",
                    "conference": "Northern Sun",
                    "firstPlaceVotes": 0,
                    "points": 437
                  },
                  {
                    "rank": 11,
                    "school": "Central Missouri State",
                    "conference": "Mid America",
                    "firstPlaceVotes": 0,
                    "points": 406
                  },
                  {
                    "rank": 12,
                    "school": "Ouachita Baptist",
                    "conference": "Great American",
                    "firstPlaceVotes": 0,
                    "points": 399
                  },
                  {
                    "rank": 13,
                    "school": "Bemidji State",
                    "conference": "Northern Sun",
                    "firstPlaceVotes": 0,
                    "points": 353
                  },
                  {
                    "rank": 14,
                    "school": "Delta State",
                    "conference": "Gulf South",
                    "firstPlaceVotes": 0,
                    "points": 322
                  },
                  {
                    "rank": 15,
                    "school": "Western State",
                    "conference": "Rocky Mountain",
                    "firstPlaceVotes": 0,
                    "points": 321
                  },
                  {
                    "rank": 16,
                    "school": "Lenoir-Rhyne",
                    "conference": "South Atlantic",
                    "firstPlaceVotes": 0,
                    "points": 291
                  },
                  {
                    "rank": 17,
                    "school": "Tiffin",
                    "conference": "Great Midwest Athletic",
                    "firstPlaceVotes": 0,
                    "points": 282
                  },
                  {
                    "rank": 18,
                    "school": "University of Texas of the Permian Basin",
                    "conference": "Lone Star",
                    "firstPlaceVotes": 0,
                    "points": 228
                  },
                  {
                    "rank": 19,
                    "school": "Virginia Union",
                    "conference": "CIAA",
                    "firstPlaceVotes": 0,
                    "points": 210
                  },
                  {
                    "rank": 20,
                    "school": "Valdosta State",
                    "conference": "Gulf South",
                    "firstPlaceVotes": 0,
                    "points": 207
                  },
                  {
                    "rank": 21,
                    "school": "Augustana (SD)",
                    "conference": "Northern Sun",
                    "firstPlaceVotes": 0,
                    "points": 183
                  },
                  {
                    "rank": 22,
                    "school": "Virginia State",
                    "conference": "CIAA",
                    "firstPlaceVotes": 0,
                    "points": 86
                  },
                  {
                    "rank": 23,
                    "school": "Missouri Western",
                    "conference": "Mid America",
                    "firstPlaceVotes": 0,
                    "points": 69
                  },
                  {
                    "rank": 24,
                    "school": "Central Washington",
                    "conference": "Lone Star",
                    "firstPlaceVotes": 0,
                    "points": 54
                  },
                  {
                    "rank": 25,
                    "school": "Mars Hill",
                    "conference": "South Atlantic",
                    "firstPlaceVotes": 0,
                    "points": 43
                  }
                ]
              },
              {
                "poll": "AFCA Division III Coaches Poll",
                "ranks": [
                  {
                    "rank": 1,
                    "school": "North Central",
                    "conference": "CCIW",
                    "firstPlaceVotes": 48,
                    "points": 1224
                  },
                  {
                    "rank": 2,
                    "school": "Mount Union",
                    "conference": "Ohio",
                    "firstPlaceVotes": 1,
                    "points": 1173
                  },
                  {
                    "rank": 3,
                    "school": "Wartburg",
                    "conference": "American Rivers",
                    "firstPlaceVotes": 0,
                    "points": 1120
                  },
                  {
                    "rank": 4,
                    "school": "Linfield",
                    "conference": "Northwest",
                    "firstPlaceVotes": 0,
                    "points": 1024
                  },
                  {
                    "rank": 5,
                    "school": "Trinity (TX)",
                    "conference": "Southern Athletic",
                    "firstPlaceVotes": 0,
                    "points": 986
                  },
                  {
                    "rank": 6,
                    "school": "UW-Whitewater",
                    "conference": "Wisconsin",
                    "firstPlaceVotes": 0,
                    "points": 958
                  },
                  {
                    "rank": 7,
                    "school": "Wisconsin-La Crosse",
                    "conference": "Wisconsin",
                    "firstPlaceVotes": 0,
                    "points": 909
                  },
                  {
                    "rank": 8,
                    "school": "Johns Hopkins",
                    "conference": "Centennial",
                    "firstPlaceVotes": 0,
                    "points": 903
                  },
                  {
                    "rank": 9,
                    "school": "Randolph-Macon",
                    "conference": "Old Dominion",
                    "firstPlaceVotes": 0,
                    "points": 817
                  },
                  {
                    "rank": 10,
                    "school": "UW-River Falls",
                    "conference": "Wisconsin",
                    "firstPlaceVotes": 0,
                    "points": 779
                  },
                  {
                    "rank": 11,
                    "school": "Aurora",
                    "conference": "NACC",
                    "firstPlaceVotes": 0,
                    "points": 724
                  },
                  {
                    "rank": 12,
                    "school": "Susquehanna",
                    "conference": "Landmark Conference",
                    "firstPlaceVotes": 0,
                    "points": 688
                  },
                  {
                    "rank": 13,
                    "school": "Wheaton College (Ill)",
                    "conference": "CCIW",
                    "firstPlaceVotes": 0,
                    "points": 619
                  },
                  {
                    "rank": 14,
                    "school": "Alma College",
                    "conference": "Michigan",
                    "firstPlaceVotes": 0,
                    "points": 577
                  },
                  {
                    "rank": 15,
                    "school": "John Carroll",
                    "conference": "Ohio",
                    "firstPlaceVotes": 0,
                    "points": 549
                  },
                  {
                    "rank": 16,
                    "school": "Ithaca",
                    "conference": "Liberty League",
                    "firstPlaceVotes": 0,
                    "points": 457
                  },
                  {
                    "rank": 17,
                    "school": "SUNY Cortland",
                    "conference": "Empire 8",
                    "firstPlaceVotes": 0,
                    "points": 413
                  },
                  {
                    "rank": 18,
                    "school": "Endicott College",
                    "conference": "Commonwealth Coast",
                    "firstPlaceVotes": 0,
                    "points": 342
                  },
                  {
                    "rank": 19,
                    "school": "Hardin-Simmons",
                    "conference": "American Southwest",
                    "firstPlaceVotes": 0,
                    "points": 288
                  },
                  {
                    "rank": 20,
                    "school": "Grove City College",
                    "conference": "Presidents'",
                    "firstPlaceVotes": 0,
                    "points": 275
                  },
                  {
                    "rank": 21,
                    "school": "St. Johns (MN)",
                    "conference": "Minnesota",
                    "firstPlaceVotes": 0,
                    "points": 262
                  },
                  {
                    "rank": 22,
                    "school": "Muhlenberg",
                    "conference": "Centennial",
                    "firstPlaceVotes": 0,
                    "points": 230
                  },
                  {
                    "rank": 23,
                    "school": "DePauw",
                    "conference": "North Coast",
                    "firstPlaceVotes": 0,
                    "points": 183
                  },
                  {
                    "rank": 24,
                    "school": "Delaware Valley",
                    "conference": "Mid Atlantic",
                    "firstPlaceVotes": 0,
                    "points": 114
                  },
                  {
                    "rank": 25,
                    "school": "Berry College",
                    "conference": "Southern Athletic",
                    "firstPlaceVotes": 0,
                    "points": 99
                  }
                ]
              },
              {
                "poll": "Playoff Committee Rankings",
                "ranks": [
                  {
                    "rank": 1,
                    "school": "Ohio State",
                    "conference": "Big Ten",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 2,
                    "school": "Georgia",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 3,
                    "school": "Michigan",
                    "conference": "Big Ten",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 4,
                    "school": "Florida State",
                    "conference": "ACC",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 5,
                    "school": "Washington",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 6,
                    "school": "Oregon",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 7,
                    "school": "Texas",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 8,
                    "school": "Alabama",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 9,
                    "school": "Florida",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 10,
                    "school": "Ole Miss",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 11,
                    "school": "Penn State",
                    "conference": "Big Ten",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 12,
                    "school": "Missouri",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 13,
                    "school": "Louisville",
                    "conference": "ACC",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 14,
                    "school": "LSU",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 15,
                    "school": "Notre Dame",
                    "conference": "FBS Independents",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 16,
                    "school": "Oregon State",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 17,
                    "school": "Tennessee",
                    "conference": "SEC",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 18,
                    "school": "Utah",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 19,
                    "school": "UCLA",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 20,
                    "school": "USC",
                    "conference": "Pac-12",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 21,
                    "school": "Kansas",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 22,
                    "school": "Oklahoma State",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 23,
                    "school": "Kansas State",
                    "conference": "Big 12",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 24,
                    "school": "Tulane",
                    "conference": "American Athletic",
                    "firstPlaceVotes": 0,
                    "points": 0
                  },
                  {
                    "rank": 25,
                    "school": "Air Force",
                    "conference": "Mountain West",
                    "firstPlaceVotes": 0,
                    "points": 0
                  }
                ]
              }
            ]
          }];

        global.fetch = jest.fn(() => Promise.resolve({
            json: () => Promise.resolve(rankings)
        }));

        var resultingScore = await scoringModule.calculateScoreV2(team, game, week);
        expect(resultingScore).toEqual(10);
    });
});

describe('General Scoring Test Suite', () => {
  beforeEach(() => {
    // restore the spy created with spyOn
    jest.resetAllMocks();
  });
  afterEach(() => {
    // restore the spy created with spyOn
    jest.restoreAllMocks();
  });

  it('Testing calculateTeamScores(teamId, teamName)', async () => {
    const teamName = "Arkansas";
    const teamId = 8;
    const games = [{
      "_id": {
        "$oid": "65dfd87c1546400b2aeb6f6b"
      },
      "id": 401520150,
      "season": 2023,
      "week": 1,
      "seasonType": "regular",
      "startDate": "2023-09-02T20:00:00.000Z",
      "startTimeTbd": false,
      "completed": true,
      "neutralSite": true,
      "conferenceGame": false,
      "attendance": 44397,
      "venueId": 3983,
      "venue": "War Memorial Stadium",
      "homeId": 8,
      "homeTeam": "Arkansas",
      "homeConference": "SEC",
      "homeDivision": "fbs",
      "homePoints": 56,
      "homeLineScores": [
        21,
        14,
        7,
        14
      ],
      "homePostWinProb": "0.9988972468930762",
      "homePregameElo": 1624,
      "homePostgameElo": 1624,
      "awayId": 2717,
      "awayTeam": "Western Carolina",
      "awayConference": "Southern",
      "awayDivision": "fcs",
      "awayPoints": 13,
      "awayLineScores": [
        3,
        0,
        7,
        3
      ],
      "awayPostWinProb": "0.0011027531069237595",
      "awayPregameElo": null,
      "awayPostgameElo": null,
      "excitementIndex": "2.7199975500",
      "highlights": null,
      "notes": null
    },
    {
      "_id": {
        "$oid": "65dfd87c1546400b2aeb7079"
      },
      "id": 401520184,
      "season": 2023,
      "week": 2,
      "seasonType": "regular",
      "startDate": "2023-09-09T20:00:00.000Z",
      "startTimeTbd": false,
      "completed": true,
      "neutralSite": false,
      "conferenceGame": false,
      "attendance": 73173,
      "venueId": 3887,
      "venue": "Donald W. Reynolds Razorback Stadium Frank Broyles Field",
      "homeId": 8,
      "homeTeam": "Arkansas",
      "homeConference": "SEC",
      "homeDivision": "fbs",
      "homePoints": 28,
      "homeLineScores": [
        7,
        7,
        7,
        7
      ],
      "homePostWinProb": "0.9987026109024985",
      "homePregameElo": 1624,
      "homePostgameElo": 1641,
      "awayId": 2309,
      "awayTeam": "Kent State",
      "awayConference": "Mid-American",
      "awayDivision": "fbs",
      "awayPoints": 6,
      "awayLineScores": [
        3,
        3,
        0,
        0
      ],
      "awayPostWinProb": "0.0012973890975015445",
      "awayPregameElo": 1262,
      "awayPostgameElo": 1245,
      "excitementIndex": "6.4974422908",
      "highlights": null,
      "notes": null
    },
    {
      "_id": {
        "$oid": "65dfd87c1546400b2aeb722f"
      },
      "id": 401520220,
      "season": 2023,
      "week": 3,
      "seasonType": "regular",
      "startDate": "2023-09-16T23:30:00.000Z",
      "startTimeTbd": false,
      "completed": true,
      "neutralSite": false,
      "conferenceGame": false,
      "attendance": 74821,
      "venueId": 3887,
      "venue": "Donald W. Reynolds Razorback Stadium Frank Broyles Field",
      "homeId": 8,
      "homeTeam": "Arkansas",
      "homeConference": "SEC",
      "homeDivision": "fbs",
      "homePoints": 31,
      "homeLineScores": [
        14,
        10,
        7,
        0
      ],
      "homePostWinProb": "0.9581572039893834",
      "homePregameElo": 1641,
      "homePostgameElo": 1620,
      "awayId": 252,
      "awayTeam": "BYU",
      "awayConference": "Big 12",
      "awayDivision": "fbs",
      "awayPoints": 38,
      "awayLineScores": [
        14,
        7,
        10,
        7
      ],
      "awayPostWinProb": "0.04184279601061658",
      "awayPregameElo": 1544,
      "awayPostgameElo": 1565,
      "excitementIndex": "7.4565480655",
      "highlights": null,
      "notes": null
    },
    {
      "_id": {
        "$oid": "65dfd87c1546400b2aeb7328"
      },
      "id": 401520258,
      "season": 2023,
      "week": 4,
      "seasonType": "regular",
      "startDate": "2023-09-23T23:00:00.000Z",
      "startTimeTbd": false,
      "completed": true,
      "neutralSite": false,
      "conferenceGame": true,
      "attendance": 99648,
      "venueId": 3958,
      "venue": "Tiger Stadium",
      "homeId": 99,
      "homeTeam": "LSU",
      "homeConference": "SEC",
      "homeDivision": "fbs",
      "homePoints": 34,
      "homeLineScores": [
        0,
        10,
        14,
        10
      ],
      "homePostWinProb": "0.6764915389988592",
      "homePregameElo": 1753,
      "homePostgameElo": 1752,
      "awayId": 8,
      "awayTeam": "Arkansas",
      "awayConference": "SEC",
      "awayDivision": "fbs",
      "awayPoints": 31,
      "awayLineScores": [
        3,
        10,
        3,
        15
      ],
      "awayPostWinProb": "0.32350846100114083",
      "awayPregameElo": 1620,
      "awayPostgameElo": 1621,
      "excitementIndex": "6.8715642832",
      "highlights": null,
      "notes": null
    },
    {
      "_id": {
        "$oid": "65dfd87c1546400b2aeb7384"
      },
      "id": 401520279,
      "season": 2023,
      "week": 5,
      "seasonType": "regular",
      "startDate": "2023-09-30T16:00:00.000Z",
      "startTimeTbd": false,
      "completed": true,
      "neutralSite": true,
      "conferenceGame": true,
      "attendance": 59437,
      "venueId": 3687,
      "venue": "AT&T Stadium",
      "homeId": 8,
      "homeTeam": "Arkansas",
      "homeConference": "SEC",
      "homeDivision": "fbs",
      "homePoints": 22,
      "homeLineScores": [
        3,
        3,
        10,
        6
      ],
      "homePostWinProb": "0.00611137275536087",
      "homePregameElo": 1621,
      "homePostgameElo": 1610,
      "awayId": 245,
      "awayTeam": "Texas A&M",
      "awayConference": "SEC",
      "awayDivision": "fbs",
      "awayPoints": 34,
      "awayLineScores": [
        7,
        10,
        10,
        7
      ],
      "awayPostWinProb": "0.9938886272446391",
      "awayPregameElo": 1722,
      "awayPostgameElo": 1733,
      "excitementIndex": "4.4486811835",
      "highlights": null,
      "notes": null
    },
    {
      "_id": {
        "$oid": "65dfd87c1546400b2aeb75a8"
      },
      "id": 401520308,
      "season": 2023,
      "week": 6,
      "seasonType": "regular",
      "startDate": "2023-10-07T23:30:00.000Z",
      "startTimeTbd": false,
      "completed": true,
      "neutralSite": false,
      "conferenceGame": true,
      "attendance": 65748,
      "venueId": 3974,
      "venue": "Vaught-Hemingway Stadium",
      "homeId": 145,
      "homeTeam": "Ole Miss",
      "homeConference": "SEC",
      "homeDivision": "fbs",
      "homePoints": 27,
      "homeLineScores": [
        10,
        7,
        0,
        10
      ],
      "homePostWinProb": "0.7802857939582456",
      "homePregameElo": 1679,
      "homePostgameElo": 1685,
      "awayId": 8,
      "awayTeam": "Arkansas",
      "awayConference": "SEC",
      "awayDivision": "fbs",
      "awayPoints": 20,
      "awayLineScores": [
        7,
        0,
        6,
        7
      ],
      "awayPostWinProb": "0.2197142060417544",
      "awayPregameElo": 1610,
      "awayPostgameElo": 1604,
      "excitementIndex": "8.5068989251",
      "highlights": null,
      "notes": null
    },
    {
      "_id": {
        "$oid": "65dfd87c1546400b2aeb75df"
      },
      "id": 401520316,
      "season": 2023,
      "week": 7,
      "seasonType": "regular",
      "startDate": "2023-10-14T16:00:00.000Z",
      "startTimeTbd": false,
      "completed": true,
      "neutralSite": false,
      "conferenceGame": true,
      "attendance": 100077,
      "venueId": 3657,
      "venue": "Bryant Denny Stadium",
      "homeId": 333,
      "homeTeam": "Alabama",
      "homeConference": "SEC",
      "homeDivision": "fbs",
      "homePoints": 24,
      "homeLineScores": [
        7,
        14,
        3,
        0
      ],
      "homePostWinProb": "0.9433117531744127",
      "homePregameElo": 1969,
      "homePostgameElo": 1966,
      "awayId": 8,
      "awayTeam": "Arkansas",
      "awayConference": "SEC",
      "awayDivision": "fbs",
      "awayPoints": 21,
      "awayLineScores": [
        6,
        0,
        7,
        8
      ],
      "awayPostWinProb": "0.05668824682558726",
      "awayPregameElo": 1604,
      "awayPostgameElo": 1607,
      "excitementIndex": "6.0834716855",
      "highlights": null,
      "notes": null
    },
    {
      "_id": {
        "$oid": "65dfd87c1546400b2aeb7702"
      },
      "id": 401520334,
      "season": 2023,
      "week": 8,
      "seasonType": "regular",
      "startDate": "2023-10-21T16:00:00.000Z",
      "startTimeTbd": false,
      "completed": true,
      "neutralSite": false,
      "conferenceGame": true,
      "attendance": 71505,
      "venueId": 3887,
      "venue": "Donald W. Reynolds Razorback Stadium Frank Broyles Field",
      "homeId": 8,
      "homeTeam": "Arkansas",
      "homeConference": "SEC",
      "homeDivision": "fbs",
      "homePoints": 3,
      "homeLineScores": [
        3,
        0,
        0,
        0
      ],
      "homePostWinProb": "0.02002357900173437",
      "homePregameElo": 1607,
      "homePostgameElo": 1596,
      "awayId": 344,
      "awayTeam": "Mississippi State",
      "awayConference": "SEC",
      "awayDivision": "fbs",
      "awayPoints": 7,
      "awayLineScores": [
        0,
        7,
        0,
        0
      ],
      "awayPostWinProb": "0.9799764209982657",
      "awayPregameElo": 1538,
      "awayPostgameElo": 1549,
      "excitementIndex": "6.9555321923",
      "highlights": null,
      "notes": null
    },
    {
      "_id": {
        "$oid": "65dfd87c1546400b2aeb7975"
      },
      "id": 401520363,
      "season": 2023,
      "week": 10,
      "seasonType": "regular",
      "startDate": "2023-11-04T16:00:00.000Z",
      "startTimeTbd": false,
      "completed": true,
      "neutralSite": false,
      "conferenceGame": true,
      "attendance": 89782,
      "venueId": 3634,
      "venue": "Ben Hill Griffin Stadium",
      "homeId": 57,
      "homeTeam": "Florida",
      "homeConference": "SEC",
      "homeDivision": "fbs",
      "homePoints": 36,
      "homeLineScores": [
        14,
        3,
        6,
        10,
        3
      ],
      "homePostWinProb": "0.08075347362469056",
      "homePregameElo": 1592,
      "homePostgameElo": 1588,
      "awayId": 8,
      "awayTeam": "Arkansas",
      "awayConference": "SEC",
      "awayDivision": "fbs",
      "awayPoints": 39,
      "awayLineScores": [
        14,
        3,
        3,
        13,
        6
      ],
      "awayPostWinProb": "0.9192465263753095",
      "awayPregameElo": 1596,
      "awayPostgameElo": 1600,
      "excitementIndex": "9.7718678848",
      "highlights": null,
      "notes": null
    },
    {
      "_id": {
        "$oid": "65dfd87c1546400b2aeb7b8d"
      },
      "id": 401520380,
      "season": 2023,
      "week": 11,
      "seasonType": "regular",
      "startDate": "2023-11-11T21:00:00.000Z",
      "startTimeTbd": false,
      "completed": true,
      "neutralSite": false,
      "conferenceGame": true,
      "attendance": 72033,
      "venueId": 3887,
      "venue": "Donald W. Reynolds Razorback Stadium Frank Broyles Field",
      "homeId": 8,
      "homeTeam": "Arkansas",
      "homeConference": "SEC",
      "homeDivision": "fbs",
      "homePoints": 10,
      "homeLineScores": [
        3,
        0,
        0,
        7
      ],
      "homePostWinProb": "0.0006648208892655079",
      "homePregameElo": 1600,
      "homePostgameElo": 1485,
      "awayId": 2,
      "awayTeam": "Auburn",
      "awayConference": "SEC",
      "awayDivision": "fbs",
      "awayPoints": 48,
      "awayLineScores": [
        21,
        6,
        21,
        0
      ],
      "awayPostWinProb": "0.9993351791107344",
      "awayPregameElo": 1590,
      "awayPostgameElo": 1705,
      "excitementIndex": "1.2059728162",
      "highlights": null,
      "notes": null
    },
    {
      "_id": {
        "$oid": "65dfd87c1546400b2aeb7c33"
      },
      "id": 401520402,
      "season": 2023,
      "week": 12,
      "seasonType": "regular",
      "startDate": "2023-11-19T00:30:00.000Z",
      "startTimeTbd": false,
      "completed": true,
      "neutralSite": false,
      "conferenceGame": false,
      "attendance": 61442,
      "venueId": 3887,
      "venue": "Donald W. Reynolds Razorback Stadium Frank Broyles Field",
      "homeId": 8,
      "homeTeam": "Arkansas",
      "homeConference": "SEC",
      "homeDivision": "fbs",
      "homePoints": 44,
      "homeLineScores": [
        7,
        24,
        7,
        6
      ],
      "homePostWinProb": "0.99601692744545",
      "homePregameElo": 1485,
      "homePostgameElo": 1495,
      "awayId": 2229,
      "awayTeam": "Florida International",
      "awayConference": "Conference USA",
      "awayDivision": "fbs",
      "awayPoints": 20,
      "awayLineScores": [
        13,
        0,
        7,
        0
      ],
      "awayPostWinProb": "0.003983072554549993",
      "awayPregameElo": 995,
      "awayPostgameElo": 985,
      "excitementIndex": "6.9102763164",
      "highlights": null,
      "notes": null
    },
    {
      "_id": {
        "$oid": "65dfd87c1546400b2aeb7c48"
      },
      "id": 401520426,
      "season": 2023,
      "week": 13,
      "seasonType": "regular",
      "startDate": "2023-11-24T21:00:00.000Z",
      "startTimeTbd": false,
      "completed": true,
      "neutralSite": false,
      "conferenceGame": true,
      "attendance": 59847,
      "venueId": 3887,
      "venue": "Donald W. Reynolds Razorback Stadium Frank Broyles Field",
      "homeId": 8,
      "homeTeam": "Arkansas",
      "homeConference": "SEC",
      "homeDivision": "fbs",
      "homePoints": 14,
      "homeLineScores": [
        0,
        0,
        0,
        14
      ],
      "homePostWinProb": "0.0006685998002959501",
      "homePregameElo": 1495,
      "homePostgameElo": 1431,
      "awayId": 142,
      "awayTeam": "Missouri",
      "awayConference": "SEC",
      "awayDivision": "fbs",
      "awayPoints": 48,
      "awayLineScores": [
        10,
        10,
        21,
        7
      ],
      "awayPostWinProb": "0.999331400199704",
      "awayPregameElo": 1759,
      "awayPostgameElo": 1823,
      "excitementIndex": "1.9840319798",
      "highlights": null,
      "notes": null
    }];
    const scoreUpdateObject = {
      weeklyScore: [
        { week: 1, seasonType: 'regular', scoreV1: 20, scoreV2: 20 },
        { week: 2, seasonType: 'regular', scoreV1: 20, scoreV2: 20 },
        { week: 3, seasonType: 'regular', scoreV1: 20, scoreV2: 20 },
        { week: 4, seasonType: 'regular', scoreV1: 20, scoreV2: 20 },
        { week: 5, seasonType: 'regular', scoreV1: 20, scoreV2: 20 },
        { week: 6, seasonType: 'regular', scoreV1: 20, scoreV2: 20 },
        { week: 7, seasonType: 'regular', scoreV1: 20, scoreV2: 20 },
        { week: 8, seasonType: 'regular', scoreV1: 20, scoreV2: 20 },
        { week: 10, seasonType: 'regular', scoreV1: 20, scoreV2: 20 },
        { week: 11, seasonType: 'regular', scoreV1: 20, scoreV2: 20 },
        { week: 12, seasonType: 'regular', scoreV1: 20, scoreV2: 20 },
        { week: 13, seasonType: 'regular', scoreV1: 20, scoreV2: 20 }
      ],
      cumulativeScoreV1: 240,
      cumulativeScoreV2: 240
    };


    global.fetch = jest.fn(() => Promise.resolve({
          status: 200,
          json: () => Promise.resolve(games)
    }));
    jest.spyOn(scoringModule, 'calculateScoreV1').mockReturnValue(20);
    jest.spyOn(scoringModule, 'calculateScoreV2').mockReturnValue(20);
    jest.spyOn(scoringModule, 'updateTeamScores').mockImplementation(() =>
      Promise.resolve({
        status: 200,
        json: scoreUpdateObject
      })
    );


    var result = await scoringModule.calculateTeamScores(teamId, teamName);
    expect(jest.spyOn(scoringModule, 'updateTeamScores')).toBeCalledWith(teamId, scoreUpdateObject);

    expect(result.json.weeklyScore.length).toEqual(12)
    expect(result.json.cumulativeScoreV1).toEqual(240)
  });
});