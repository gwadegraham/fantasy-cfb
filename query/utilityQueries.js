db.teams.updateOne({"id": 2026}, {
    "$set": {
        "seasons": [
            {
                "season": 2023,
                "conference": db.teams.findOne({"id": 2026}).conference,
                "cumulativeScoreV1": db.teams.findOne({"id": 2026}).cumulativeScoreV1, 
                "cumulativeScoreV2": db.teams.findOne({"id": 2026}).cumulativeScoreV2,
                "weeklyScore": db.teams.findOne({"id": 2026}).weeklyScore
            }
        ]
    }
})

db.teams.find().forEach(team => {
    print(team.mascot);
    db.teams.updateOne({"id": team.id}, {
        "$set": {
            "seasons": [
                {
                    "season": 2023,
                    "conference": team.conference,
                    "cumulativeScoreV1": team.cumulativeScoreV1, 
                    "cumulativeScoreV2": team.cumulativeScoreV2,
                    "weeklyScore": team.weeklyScore
                }
            ]
        }
    })
})
    