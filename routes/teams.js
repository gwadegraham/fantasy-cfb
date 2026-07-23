const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const Team = require('../models/team');
const { parseOdds, americanToProb, buildTeamMatcher } = require('../modules/cfp-odds');

//Getting All
router.get('/', async (req, res) => {
    try {
        const teams = await Team.find();
        res.json(teams);
    } catch (err) {
        res.status(500).json({message: err.message});
    }
});

//Getting Multiple Logos
router.post('/teamLogos', async (req, res) => {
    try {
        // Guard the $in value: only accept an array of ids so a crafted body
        // (e.g. an operator object) can't be injected into the query.
        if (!Array.isArray(req.body.teams)) {
            return res.status(400).json({message: 'teams must be an array of team ids'});
        }
        const teamLogos = await Team.find({id: {$in: req.body.teams}}, "id school logos");

        if (JSON.stringify(teamLogos) === '[]') {
            res.status(400).json({message: `No teams found with names ${req.body.teams}`});
        } else {
            res.status(200).json(teamLogos);
        }

    } catch (err) {
        res.status(500).json({message: err.message});
    }
});

//Getting All Logos
router.get('/teamLogos/all', async (req,res) => {
    try {
        const teamLogos = await Team.find({}, "id logos");

        if (JSON.stringify(teamLogos) === '[]') {
            res.status(400).json({message: `Couldn't get all logos for all teams`});
        } else {
            res.status(200).json(teamLogos);
        }

    } catch (err) {
        res.status(500).json({message: err.message});
    }
});

// Getting cumulative fantasy scores for every team in a season, used to rank a
// team against the rest of the FBS. Projected down to just the ids/scores so
// this stays small (unlike a full Team.find()).
router.get('/scores/:season', async (req, res) => {
    try {
        const season = Number(req.params.season);
        if (!Number.isInteger(season)) {
            return res.status(400).json({message: 'Invalid season'});
        }
        const teams = await Team.find(
            {"seasons.season": season},
            {"id": 1, "school": 1, "seasons": {"$elemMatch": {"season": season}}}
        );
        res.status(200).json(teams);
    } catch (err) {
        res.status(500).json({message: err.message});
    }
});

// Getting One
router.get('/:id', async (req, res) => {
    try {
        const teamName = await Team.find({id: req.params.id}, "school");

        if (JSON.stringify(teamName) === '[]') {
            res.status(400).json({message: `No teams found with id ${req.body.id}`});
        } else {
            res.status(200).json(teamName);
        }

    } catch (err) {
        res.status(500).json({message: err.message});
    }
});

// Getting All Info for One
router.get('/info/:id', async (req, res) => {
    try {
        const teamName = await Team.find({id: req.params.id});

        if (JSON.stringify(teamName) === '[]') {
            res.status(400).json({message: `No teams found with id ${req.body.id}`});
        } else {
            res.status(200).json(teamName);
        }

    } catch (err) {
        res.status(500).json({message: err.message});
    }
});

// Getting All Teams from One Conference
router.get('/conference/:conference', async (req, res) => {
    try {
        const teamName = await Team.find({seasons: {
            $elemMatch: {
                season: process.env.YEAR,
                conference: req.params.conference
            }
        }});

        if (JSON.stringify(teamName) === '[]') {
            res.status(400).json({message: `No teams found with id ${req.body.id}`});
        } else {
            res.status(200).json(teamName);
        }

    } catch (err) {
        res.status(500).json({message: err.message});
    }
});

//Updating One
router.patch('/:id', getTeam, async (req, res) => {

    var index = res.team.seasons.findIndex(x => x.season == process.env.YEAR);

    if (index == -1) {
        var newSeasonObject = {
            season: process.env.YEAR,
            conference: res.team.conference,
            weeklyScore: req.body.weeklyScore,
            cumulativeScoreV1: req.body.cumulativeScoreV1,
            cumulativeScoreV2: req.body.cumulativeScoreV2
        };

        res.team.seasons.push(newSeasonObject);
    } else {
        if (req.body.weeklyScore != null) {
            res.team.seasons[index].weeklyScore = req.body.weeklyScore;
        } 
    
    
        if (req.body.cumulativeScoreV1 != null) {
            res.team.seasons[index].cumulativeScoreV1 = req.body.cumulativeScoreV1;
        }
        
        if (req.body.cumulativeScoreV2 != null) {
            res.team.seasons[index].cumulativeScoreV2 = req.body.cumulativeScoreV2;
        }
    }

    try {
        const updatedTeam = await res.team.save();
        res.status(200).json(updatedTeam);
    } catch (err) {
        res.status(400).json({message: err.message});
    }
});

//Updating One With Season
router.patch('/:id/:season', getTeam, async (req, res) => {

    var index = res.team.seasons.findIndex(x => x.season == req.params.season);

    if (index == -1) {
        var newSeasonObject = {
            season: req.params.season,
            conference: res.team.conference,
            weeklyScore: req.body.weeklyScore,
            cumulativeScoreV1: req.body.cumulativeScoreV1,
            cumulativeScoreV2: req.body.cumulativeScoreV2
        };

        res.team.seasons.push(newSeasonObject);
    } else {
        if (req.body.weeklyScore != null) {
            res.team.seasons[index].weeklyScore = req.body.weeklyScore;
        } 
    
        if (req.body.cumulativeScoreV1 != null) {
            res.team.seasons[index].cumulativeScoreV1 = req.body.cumulativeScoreV1;
        }
        
        if (req.body.cumulativeScoreV2 != null) {
            res.team.seasons[index].cumulativeScoreV2 = req.body.cumulativeScoreV2;
        }
    }

    try {
        const updatedTeam = await res.team.save();
        res.status(200).json(updatedTeam);
    } catch (err) {
        res.status(400).json({message: err.message});
    }
});

//Updating Expected Wins for One With Season
router.post('/:season/expectedWins', async (req, res) => {

    // Validate season is a 4-digit year before using it in a file path,
    // otherwise a value like "../../server" is a path-traversal vector.
    if (!/^\d{4}$/.test(req.params.season)) {
        return res.status(400).json({message: 'Invalid season'});
    }

    // Read fresh (not require()) so editing the JSON and re-running picks up
    // the new values without needing a server restart.
    var teamJsonData;
    try {
        const file = path.join(__dirname, '..', 'json', `expectedWins${req.params.season}.json`);
        teamJsonData = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (err) {
        return res.status(404).json({message: `No expected wins data for season ${req.params.season}`});
    }
    var updatedTeams = [];

    for (const teamJson of teamJsonData) {

        var team = await getTeamByName(teamJson.team);
        if (team == null) {
            console.log(`Skipping unknown team: ${teamJson.team}`);
            continue;
        }

        var index = team.seasons.findIndex(x => x.season == req.params.season);

        if (index > -1) {
            if (teamJson.expectedWins != null) {
                team.seasons[index].expectedWins = teamJson.expectedWins;
            }
        }

        try {
            const updatedTeam = await team.save();
            updatedTeams.push(updatedTeam);
        } catch (err) {
            // Log and keep going; sending a response here would collide with
            // the res.status(200) after the loop ("headers already sent").
            console.log(`Error saving expected wins for ${teamJson.team}: ${err.message}`);
        }
    }

    res.status(200).json(updatedTeams);
});

// Enrich each team's season with opponent-agnostic CFBD data: SP+ / FPI power
// ratings, 247 talent, returning production, and head coach. One run makes ~5
// CFBD calls total (each endpoint returns all teams), so it's cheap to schedule
// weekly. Commissioner/token-gated by the /teams middleware in server.js.
router.post('/:season/enrich', async (req, res) => {
    if (!/^\d{4}$/.test(req.params.season)) {
        return res.status(400).json({message: 'Invalid season'});
    }
    const season = Number(req.params.season);
    const cfbd = (path) => fetch(`https://api.collegefootballdata.com${path}`, {
        method: 'GET',
        headers: { 'Accept': 'application/json', 'Authorization': process.env.CFBD_API_KEY }
    }).then(r => r.ok ? r.json() : []);

    const norm = (s) => String(s == null ? '' : s).toLowerCase().trim();

    try {
        const [sp, fpi, talent, returning, coaches] = await Promise.all([
            cfbd(`/ratings/sp?year=${season}`),
            cfbd(`/ratings/fpi?year=${season}`),
            cfbd(`/talent?year=${season}`),
            cfbd(`/player/returning?year=${season}`),
            cfbd(`/coaches?year=${season}`)
        ]);

        // Build lookup maps keyed by normalized team name.
        const spMap = new Map();
        (Array.isArray(sp) ? sp : []).forEach(r => spMap.set(norm(r.team), r));

        // FPI has no overall rank field, so derive it by sorting the rating.
        const fpiMap = new Map();
        (Array.isArray(fpi) ? fpi : [])
            .filter(r => r.fpi != null)
            .sort((a, b) => b.fpi - a.fpi)
            .forEach((r, i) => fpiMap.set(norm(r.team), { fpi: r.fpi, rank: i + 1 }));

        // CFBD /talent keys the team as `team` (some other endpoints use
        // `school`). Rank is derived by sorting the composite, like FPI.
        const talentMap = new Map();
        (Array.isArray(talent) ? talent : [])
            .filter(r => r.talent != null)
            .sort((a, b) => b.talent - a.talent)
            .forEach((r, i) => talentMap.set(norm(r.team || r.school), { value: r.talent, rank: i + 1 }));

        const retMap = new Map();
        (Array.isArray(returning) ? returning : []).forEach(r => retMap.set(norm(r.team), r.percentPPA));

        // Coaches are coach-centric; flatten to a team->name map for the season.
        const coachMap = new Map();
        (Array.isArray(coaches) ? coaches : []).forEach(c => {
            (c.seasons || []).forEach(s => {
                if (Number(s.year) === season && s.school) {
                    coachMap.set(norm(s.school), `${c.firstName || ''} ${c.lastName || ''}`.trim());
                }
            });
        });

        const teams = await Team.find();
        let updated = 0;
        for (const team of teams) {
            const keys = [norm(team.school), ...((team.alternateNames || []).map(norm))];
            const pick = (map) => { for (const k of keys) if (map.has(k)) return map.get(k); return undefined; };

            const spR = pick(spMap), fpiR = pick(fpiMap), tal = pick(talentMap), ret = pick(retMap), coach = pick(coachMap);
            if (spR === undefined && fpiR === undefined && tal === undefined && ret === undefined && coach === undefined) continue;

            let idx = team.seasons.findIndex(x => x.season == season);
            if (idx === -1) {
                team.seasons.push({ season: season, conference: team.conference });
                idx = team.seasons.length - 1;
            }
            const s = team.seasons[idx];
            if (spR) {
                if (spR.rating != null) s.spRating = spR.rating;
                if (spR.ranking != null) s.spRank = spR.ranking;
            }
            if (fpiR) { s.fpiRating = fpiR.fpi; s.fpiRank = fpiR.rank; }
            if (tal) { s.talent = Number(tal.value); s.talentRank = tal.rank; }
            if (ret != null) {
                // percentPPA arrives as a 0-1 fraction; store as a 0-100 percent.
                var pct = Number(ret);
                s.returningProduction = Math.round((pct <= 1 ? pct * 100 : pct) * 10) / 10;
            }
            if (coach) s.coach = coach;

            await team.save();
            updated++;
        }

        res.status(200).json({
            season, updated,
            counts: {
                sp: (sp || []).length, fpi: (fpi || []).length, talent: (talent || []).length,
                returning: (returning || []).length, coaches: (coaches || []).length
            }
        });
    } catch (err) {
        console.log('Error enriching teams:', err.message);
        res.status(400).json({message: err.message});
    }
});

// Ingest market CFP futures pasted from a sportsbook (make-CFP or championship
// odds). Dry-run by default (returns matched/unmatched preview so the paste can
// be verified); writes to team.seasons only when commit === true.
// body: { market: 'make' | 'champ', text: '<pasted odds>', commit: bool }
router.post('/:season/cfp-odds', async (req, res) => {
    if (!/^\d{4}$/.test(req.params.season)) {
        return res.status(400).json({ message: 'Invalid season' });
    }
    const season = Number(req.params.season);
    const market = req.body.market === 'champ' ? 'champ' : 'make';
    const field = market === 'champ' ? 'cfpChampOdds' : 'cfpMakeOdds';
    const commit = req.body.commit === true;
    try {
        const entries = parseOdds(req.body.text || '');
        if (!entries.length) {
            return res.status(400).json({ message: 'No odds could be parsed from the input' });
        }

        const teams = await Team.find({}, 'id school alt_name1 alt_name2 alt_name3 alternateNames conference seasons');
        const match = buildTeamMatcher(teams);

        const matched = [], unmatched = [], seen = new Set();
        for (const e of entries) {
            const t = match(e.name);
            if (!t) { unmatched.push(e.name); continue; }
            if (seen.has(t.id)) continue;           // ignore duplicate lines
            seen.add(t.id);
            matched.push({ team: t, name: e.name, odds: e.odds, prob: Math.round(americanToProb(e.odds) * 1000) / 10 });
        }

        if (commit) {
            for (const m of matched) {
                const team = m.team;
                let idx = team.seasons.findIndex(x => x.season == season);
                if (idx === -1) { team.seasons.push({ season, conference: team.conference }); idx = team.seasons.length - 1; }
                team.seasons[idx][field] = m.odds;
                await team.save();
            }
        }

        res.status(200).json({
            season, market, field, dryRun: !commit,
            matchedCount: matched.length, unmatchedCount: unmatched.length,
            matched: matched.map(m => ({ school: m.team.school, id: m.team.id, name: m.name, odds: m.odds, prob: m.prob })),
            unmatched
        });
    } catch (err) {
        res.status(400).json({ message: err.message });
    }
});

//Refreshing All
router.post('/refresh', async (req, res) => {
    try {
        const response = await fetch(`https://api.collegefootballdata.com/teams/fbs?year=${req.body.year}`, {
            method: 'GET',
            headers: {
            'Accept': 'application/json',
            'Authorization': process.env.CFBD_API_KEY
            }
        });

        var allTeams = await response.json();

        var refreshedTeams = [];
        var newTeams = [];
        for (const team of allTeams) {
            var existingTeam = await Team.findOne({id: team.id});

            if (existingTeam != null) {
               
                existingTeam.school = team.school;
                existingTeam.mascot = team.mascot;
                existingTeam.abbreviation = team.abbreviation;
                existingTeam.alternateNames = team.alternateNames;
                existingTeam.color = team.color;
                existingTeam.alt_color = team.alt_color;
                existingTeam.logos = team.logos;
                existingTeam.twitter = team.twitter;
                existingTeam.location = team.location;

                var seasonIndex = existingTeam.seasons.findIndex(x => x.season == req.body.year);
                if (seasonIndex >= 0) {
                    existingTeam.seasons[seasonIndex].conference = team.conference;
                } else {
                    var newSeasonObject = {
                        season: req.body.year,
                        conference: team.conference
                    };

                    existingTeam.seasons.push(newSeasonObject);
                }

                var filter = {id: existingTeam.id};
                try {
                    var updatedTeam = await Team.findOneAndUpdate(filter, existingTeam, {new: true});
                    refreshedTeams.push(updatedTeam);
                } catch (err) {
                    console.log("Error updating team with id:", existingTeam.id);
                    console.log("Update error:", err.message);
                } 

            } else {
                var newSeasonObject = {
                    season: req.body.year,
                    conference: team.conference
                };
                team.seasons = [];
                team.seasons.push(newSeasonObject);
                newTeams.push(team)
            }
        }

        try {
            console.log("Refreshing " + refreshedTeams.length + " teams and adding " + newTeams.length + " new teams");
            const newCreatedTeams = await Team.insertMany(newTeams);

            var returnedTeams = {
                newTeams: newCreatedTeams,
                refreshedTeams: refreshedTeams
            };

            return res.status(201).json(returnedTeams);
        } catch (err) {
            console.log("Error refreshing teams: " + err.message);
            res.status(400).json({message: err.message});
        }
    } catch (err) {
        res.status(400).json({message: err.message});
    }
});

async function getTeam(req, res, next) {
    let team;
    try {
        team = await Team.findOne({id: req.params.id});
        if (team == null) {
            return res.status(404).json({message: 'Cannot find team'});
        }
    } catch (err) {
        return res.status(500).json({message: err.message});
    }
    res.team = team;
    next();
}

async function getTeamByName(teamName) {
    // Returns the matching team, or null if not found / on error. This is a
    // plain helper (no res in scope), so the caller decides how to respond.
    try {
        return await Team.findOne( { $or: [{"school": teamName}, {"alternateNames": teamName}]});
    } catch (err) {
        console.log(`Error looking up team ${teamName}: ${err.message}`);
        return null;
    }
}

module.exports = router;