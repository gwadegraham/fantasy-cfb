const express = require('express');
const franchiseRepo = require('../modules/franchise-repo');
const { activeSeason } = require('../modules/active-season');
const router = express.Router();
const Team = require('../models/team');
const { FBS_ONLY } = require('../modules/team-scope');
const { pickLogo } = require('../public/logo.js');
const { selectedLeague } = require('../modules/league-selection');

// Index behind the app-wide search palette (public/search.js).
//
// Two deliberate shapes here:
//
//  1. TEAMS are projected hard. A bare `Team.find()` hands back 1,097 KB across
//     138 teams — `seasons` alone is 729 KB — and the palette needs none of it.
//     The projection below measures 30 KB, so the whole index ships in one lazy
//     fetch and every keystroke is matched in memory. Logos are resolved HERE
//     with the shared pickLogo (dark variant, highest res, https-upgraded)
//     rather than shipping the raw arrays, which keeps another 95 KB off the
//     wire and keeps the palette's logo identical to the one Standings and the
//     draft board pick.
//
//  2. MANAGERS are scoped to the league the caller is VIEWING, and the point
//     is not where that value comes from but that it is CHECKED. A league code
//     in the URL would be a request to trust the browser about which league it
//     may read, and the members of the other league would be one edited query
//     string away.
//
//     selectedLeague is a cookie, so it is just as client-supplied as a query
//     string — the difference is that it is only honoured after being matched
//     against the franchises this account actually holds (#319). Someone can
//     therefore only ever scope search to a league whose members they can
//     already see, which is the property the original reasoning was after.
//     Anything that stops validating turns this straight back into the hole
//     the paragraph above describes.
//
// Items share one shape across both types so public/search-match.js can rank
// them through a single path:
//   { type, id, name, sub, image, initials, color, aliases: [] }

const initialsOf = (u) => (((u.firstName || '')[0] || '') + ((u.lastName || '')[0] || '')).toUpperCase();

// Everything a person might reasonably type for a team that isn't its school
// name: mascot, abbreviation, and CFBD's several alias fields (alt_name1..3 plus
// the alternateNames array) — which is where "Pitt", "Miami (FL)" and "TA&M"
// live. De-duped because those fields overlap heavily.
function teamAliases(t) {
    return [...new Set([
        t.mascot, t.abbreviation, t.alt_name1, t.alt_name2, t.alt_name3,
        ...(t.alternateNames || [])
    ].filter(Boolean))];
}

router.get('/index', async (req, res) => {
    try {
        const league = await selectedLeague(req);
        const season = activeSeason('football');

        const [teamDocs, userDocs] = await Promise.all([
            Team.find(FBS_ONLY, 'id school mascot abbreviation conference color logos alt_name1 alt_name2 alt_name3 alternateNames').lean(),
            franchiseRepo.byLeague(league, { fields: ['firstName', 'lastName', 'avatarUrl', 'color', 'seasons'] })
        ]);

        const teams = teamDocs.map((t) => ({
            type: 'team',
            id: t.id,
            name: t.school,
            sub: t.conference || '',
            image: pickLogo(t.logos || []),
            color: t.color || null,
            aliases: teamAliases(t)
        }));

        const managers = userDocs.map((u) => {
            // Franchise names are per-season and commissioner/self-editable, so
            // read the ACTIVE season's rather than the newest entry's — a member
            // who hasn't joined this season keeps their last name-only row.
            const s = (u.seasons || []).find((x) => Number(x.season) === season);
            const franchise = (s && s.franchiseName) || '';
            const name = [u.firstName, u.lastName].filter(Boolean).join(' ');
            return {
                type: 'manager',
                id: String(u._id),
                name,
                sub: franchise,
                image: u.avatarUrl || null,
                initials: initialsOf(u) || null,
                color: u.color || null,
                aliases: [franchise, u.firstName, u.lastName].filter(Boolean)
            };
        });

        res.json({ teams, managers });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

module.exports = router;
