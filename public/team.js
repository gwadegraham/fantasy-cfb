// ---------------------------------------------------------------------------
// Small shared cache so the team document and the (large) all-logos payload are
// each fetched exactly once per page load instead of once per render function.
// ---------------------------------------------------------------------------
var _teamDocCache = {};
var _allLogosPromise = null;

async function getUserProfile() {
    const response = await fetch(`/profile`, {
        method: 'GET',
        headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
        }
    });

    response.json().then(async data => {

        // Mirror the league being viewed into storage, which the by-league
        // fetches below still read. From ccLeague — the server's validated
        // answer (#319) — not from the Auth0 flag, which is binary and so
        // could only ever name one of the two football leagues.
        if (window.ccLeague && window.ccLeague.code()) {
            try { window.localStorage.setItem("leagueCode", window.ccLeague.code()); } catch (e) {}
        }

        // (An Admin-only block that set the <select> from localStorage used
        // to sit here, in four identical copies. ccLeague.syncSwitcher()
        // does it from the SERVER's answer now, which is the validated one —
        // these could point the dropdown at a stale stored league while the
        // page rendered a different one.)
    });
}

window.onload = function() {
    // The navbar partial (views/partials/navbar.ejs) owns its hamburger and the
    // "My team" link + userId caching.
    initLeagueSelector();

    getUserProfile();
    loadTeamPage();
};

// Kept as a no-op: public/league.js binds the switcher once for every page
// via the navbar partial (#319), and the copy that used to live here did not
// tell the server which league had been chosen.
function initLeagueSelector() {}

// ---------------------------------------------------------------------------
// Page orchestration: fetch the team doc once, then fan out the dependent
// requests, then hand one page model to renderTeamPage. A missing / unknown
// ?team= param renders an error state instead of throwing and leaving a blank
// page.
// ---------------------------------------------------------------------------
async function loadTeamPage() {
    const urlParams = new URLSearchParams(window.location.search);
    const teamId = urlParams.get('team');

    if (!teamId) {
        renderTeamError("No team was specified.");
        return;
    }

    const teamData = await fetchTeamDoc(teamId);
    if (!teamData) {
        renderTeamError("We couldn't find that team.");
        return;
    }

    // Swap the favicon to the team's logo so the browser tab shows their mark.
    var teamLogoUrl = typeof ccLogo === 'function' ? ccLogo(teamData.logos) : (teamData.logos && teamData.logos[0] || '');
    if (teamLogoUrl) {
        var svgIcon = document.querySelector('link[rel="icon"][type="image/svg+xml"]');
        var pngIcons = document.querySelectorAll('link[rel="icon"][type="image/png"]');
        if (svgIcon) svgIcon.remove();
        pngIcons.forEach(function (el) { el.remove(); });
        var link = document.createElement('link');
        link.rel = 'icon';
        link.href = teamLogoUrl;
        document.head.appendChild(link);
    }

    // Honour an explicit ?season=YYYY (from the season selector); otherwise show
    // the latest season with games played.
    const seasonParam = urlParams.get('season');
    var seasonObj = null;
    if (seasonParam) {
        seasonObj = teamData.seasons.find(s => String(s.season) === String(seasonParam));
    }
    if (!seasonObj) seasonObj = latestPlayedSeason(teamData.seasons) || teamData.seasons.at(-1);

    const seasonYear = seasonObj?.season || new Date().getFullYear();
    const conference = seasonObj?.conference;
    // The league being VIEWED, from the server's answer — not the storage
    // mirror, which getUserProfile writes asynchronously and can still be
    // empty on a first visit (every league's franchises would then be
    // searched, basketball's colliding ids included, #489).
    const leagueCode = (window.ccLeagueCode && window.ccLeagueCode()) || window.localStorage.getItem("leagueCode");

    // Fire the independent requests together. allSettled (not all) so one failed
    // request can't blank the whole page — each section falls back to a default.
    const results = await Promise.allSettled([
        getRecord(teamData.school, seasonYear),
        getConferenceRecords(seasonYear, conference),
        getTeamLogos(),
        getRecruitingRankings(teamData.school, seasonYear),
        getScheduleGames(teamId, seasonYear),
        getRankings(seasonYear),
        getAllBettingLines(seasonYear),
        getTeamOwner(teamId, seasonYear, leagueCode),
        getTeamFantasyRank(teamId, seasonYear, leagueCode),
        getPlayerSeasonLeaders(teamData.school, seasonYear),
        getTeamSeasonStats(teamData.school, seasonYear),
        getConferenceTeams(conference)
    ]);
    const val = (i, fallback) => results[i].status === 'fulfilled' && results[i].value != null ? results[i].value : fallback;
    const conferenceRecords = val(1, []);
    const schedule = val(4, []);
    schedule.sort((a, b) => new Date(a.startDate) - new Date(b.startDate));

    renderTeamPage({
        team: teamData,
        seasonObj: seasonObj,
        year: seasonYear,
        // Claunts = V1, Graham = V2. leagueCode is 'claunts-league'/'graham-league'
        // (never 'gg'), so the old 'gg' test always fell through to V2 and showed
        // every viewer the Graham score.
        scoreCode: leagueCode === 'claunts-league' ? 'cumulativeScoreV1' : 'cumulativeScoreV2',
        record: val(0, undefined),
        logos: val(2, []),
        recruiting: val(3, undefined),
        schedule: schedule,
        rankings: val(5, []),
        bettingLines: val(6, []),
        owner: val(7, null),
        fantasyRank: val(8, null),
        playerLeaders: val(9, null),
        teamStats: val(10, null),
        standings: conference && conference !== 'FBS Independents'
            ? buildStandings(Array.isArray(conferenceRecords) ? conferenceRecords : [], val(11, []))
            : []
    });
}

// Find the fantasy manager who drafted this team in the given season/league.
// Returns { name, franchiseName, userId, points } or null if undrafted /
// unavailable; points is what the team banked for them, by game id.
async function getTeamOwner(teamId, seasonYear, leagueCode) {
    try {
        const res = await fetch(`/users/season/${seasonYear}`, {
            method: 'GET',
            headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' }
        });
        const users = await res.json();
        if (!Array.isArray(users)) return null;

        const scoped = leagueCode ? users.filter(u => u.league === leagueCode) : users;
        for (const user of scoped) {
            const season = ccSeasonOf.seasonOf(user, seasonYear);
            const owns = season?.teams?.some(t => String(t.id) === String(teamId));
            if (owns) {
                return {
                    userId: user._id,
                    name: `${user.firstName || ''} ${user.lastName || ''}`.trim(),
                    franchiseName: season.franchiseName || '',
                    points: ownerPointsFor(season, teamId)
                };
            }
        }
        return null;
    } catch (e) {
        return null;
    }
}

// What this team has banked for its manager, game by game: { gameId: points }
// off the franchise's weekly rows. Keyed by game id, so a week with two games
// (or a postseason week holding several) keeps each game's own points.
function ownerPointsFor(season, teamId) {
    var out = {};
    (season && season.weeklyScore || []).forEach(function (w) {
        (w.scoreByTeam || []).forEach(function (s) {
            if (String(s.teamId) !== String(teamId) || s.gameId == null) return;
            out[String(s.gameId)] = Number(s.score) || 0;
        });
    });
    return out;
}

// Rank this team's cumulative fantasy score against every FBS team for the
// season. Returns { rank, total } or null.
async function getTeamFantasyRank(teamId, seasonYear, leagueCode) {
    try {
        const res = await fetch(`/teams/scores/${seasonYear}`, {
            method: 'GET',
            headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' }
        });
        const teams = await res.json();
        if (!Array.isArray(teams) || !teams.length) return null;

        // Claunts league scores on V1, Graham on V2 (matches the header score).
        const key = (leagueCode === 'claunts-league') ? 'cumulativeScoreV1' : 'cumulativeScoreV2';
        const scored = teams.map(t => ({ id: t.id, score: Number(ccSeasonOf.seasonOrEmpty(t, seasonYear)[key]) || 0 }));

        const me = scored.find(t => String(t.id) === String(teamId));
        if (!me) return null;
        // Standard competition ranking: tied teams share a rank (count only teams
        // strictly ahead), so two teams at 41 pts are both #2, not #2 and #3.
        const rank = scored.filter(t => t.score > me.score).length + 1;
        return { rank, total: scored.length };
    } catch (e) {
        return null;
    }
}

// Build the season <select> from the seasons present on the team doc.
function renderSeasonSelector(seasons, currentSeason) {
    if (!Array.isArray(seasons) || seasons.length < 2) return '';
    var options = seasons
        .map(s => s.season)
        .filter((v, i, arr) => v != null && arr.indexOf(v) === i)
        .sort((a, b) => b - a)
        .map(y => `<option value="${y}" ${String(y) === String(currentSeason) ? 'selected' : ''}>${y}</option>`)
        .join('');
    return `
        <select class="ft-season" aria-label="Select season" onchange="onSeasonChange(this.value)">
            ${options}
        </select>
    `;
}

// Navigate to the chosen season (full reload re-runs loadTeamPage with the
// new ?season=).
function onSeasonChange(year) {
    const params = new URLSearchParams(window.location.search);
    params.set('season', year);
    window.location.search = params.toString();
}

async function fetchTeamDoc(teamId) {
    if (_teamDocCache[teamId] !== undefined) return _teamDocCache[teamId];
    try {
        const response = await fetch(`/teams/info/${teamId}`, {
            method: 'GET',
            headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' }
        });
        const data = await response.json();
        const team = Array.isArray(data) ? data[0] : null;
        _teamDocCache[teamId] = team || null;
        return _teamDocCache[teamId];
    } catch (e) {
        return null;
    }
}

// The latest season that actually has games played (a non-empty weeklyScore).
// Team docs can carry a future-season stub (e.g. a preseason 2026 with 0 games)
// as their LAST entry; using seasons.at(-1) would show an empty page, so prefer
// the newest season with real data and fall back to the last season.
function latestPlayedSeason(seasons) {
    if (!Array.isArray(seasons) || seasons.length === 0) return null;
    for (var i = seasons.length - 1; i >= 0; i--) {
        var s = seasons[i];
        if (s && Array.isArray(s.weeklyScore) && s.weeklyScore.length > 0) return s;
    }
    return seasons[seasons.length - 1];
}

async function getRecord(school, seasonYear) {
    const response = await fetch(`/records/${seasonYear}/${school}`, {
        method: 'GET',
        headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
        }
    });

    const data = await response.json();
    return Array.isArray(data) ? data[0] : undefined;
}

async function getConferenceRecords(seasonYear, conference) {
    const response = await fetch(`/records/${seasonYear}/conference/${conference}`, {
        method: 'GET',
        headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
        }
    });

    const data = await response.json();
    return data;
}

async function getScheduleGames(teamId, seasonYear) {
    const response = await fetch(`/games/season/${seasonYear}/teamId/${teamId}`, {
        method: 'GET',
        headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
        }
    });
    return await response.json();
}

// Fetch the all-team logos payload once and memoise it. (It's a large response
// and was previously requested twice per page load.)
async function getTeamLogos () {
    if (_allLogosPromise) return _allLogosPromise;
    _allLogosPromise = (async () => {
        var teamsPromise = await fetch('/teams/teamLogos/all', {
            method: 'GET',
            headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json'
            }
        });

        var response = await teamsPromise.json();

        if (teamsPromise.status == 200) {
            return response;
        } else {
            console.log(response.message);
            return [];
        }
    })();
    return _allLogosPromise;
}

// Vegas spreads for the schedule rows. /betting is the PARLAY router — asking it
// for a season ran Parlay.findById("2026"), which threw a CastError and 500'd on
// every team page load. The failure was invisible because a non-200 degrades to
// an empty array here and the spread just renders blank.
async function getAllBettingLines (seasonYear) {
    if (seasonYear == null) seasonYear = new Date().getFullYear();

    var bettingPromise = await fetch(`/betting-lines/${seasonYear}`, {
        method: 'GET',
        headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
        }
    });

    var response = await bettingPromise.json();

    if (bettingPromise.status == 200) {
        return response;
    } else {
        console.log(response.message);
        return [];
    }
}

// This page renders game times in the BROWSER's zone, not Central like the rest
// of the app — so it has to say which zone that is. The league spans two of
// them, and "2:30 PM" means different things to different managers.
//
// Prefers the generic label (CT) over the seasonal one (CDT / CST): a schedule
// runs August to January, straddling the November DST change, and both halves
// are still "CT". Anything that isn't a US-style abbreviation — "GMT+2", "UTC" —
// is shown exactly as the browser reported it.
function tzGenericLabel(shortName) {
    var name = String(shortName == null ? '' : shortName).trim();
    var m = /^([A-Z]{1,3})[SD]T$/.exec(name);
    return m ? m[1] + 'T' : name;
}
function localTzLabel(when) {
    try {
        var parts = new Intl.DateTimeFormat('en-US', { hour: 'numeric', timeZoneName: 'short' })
            .formatToParts(when ? new Date(when) : new Date());
        var found = parts.find(function (p) { return p.type === 'timeZoneName'; });
        return tzGenericLabel(found && found.value);
    } catch (e) {
        return '';   // no label beats a wrong one
    }
}

function getConferenceLogo(conference) {
    // All logos are self-hosted under /images so no conference logo depends on
    // an outside host. (The image files were added in 684d27d but only Big Ten
    // and Conference USA were actually wired up; the other 9 still hotlinked
    // sportslogos/cloudfront until this change.)
    var allLogos = [
        {
            confName: "ACC",
            url: "../images/logo-acc.svg"
        },
        {
            confName: "American Athletic",
            url: "../images/logo-aac.png"
        },
        {
            confName: "Big 12",
            url: "../images/logo-big12.png"
        },
        {
            confName: "Big Ten",
            url: "../images/logo-big-ten.svg"
        },
        {
            confName: "Conference USA",
            url: "../images/logo-cusa.png"
        },
        {
            confName: "FBS Independents",
            url: "../images/logo-fbs-independents.gif"
        },
        {
            confName: "Mid-American",
            url: "../images/logo-mac.png"
        },
        {
            confName: "Mountain West",
            url: "../images/logo-mountain-west.png"
        },
        {
            confName: "Pac-12",
            url: "../images/logo-pac12.png"
        },
        {
            confName: "Sun Belt",
            url: "../images/logo-sun-belt.png"
        },
        {
            confName: "SEC",
            url: "../images/logo-sec.png"
        }
    ]

    const logoObj = allLogos.find(logo => logo.confName == conference);
    // A renamed/new/absent conference isn't in the list above; return '' rather
    // than throwing on logoObj.url (which would break the whole team header).
    return logoObj ? logoObj.url : '';
}

async function getRankings (season) {
    var response = await fetch(`/rankings/${season}`, {
        method: 'GET',
        headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
        }
    });

    var rankings = await response.json();

    if (!Array.isArray(rankings)) {
        console.log(rankings.message);
        return [];
    }

    return rankings;
}

async function getConferenceTeams (conference) {
    var response = await fetch(`/teams/conference/${conference}`, {
        method: 'GET',
        headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
        }
    });

    var conferences = await response.json();

    if (!Array.isArray(conferences)) {
        console.log(conferences.message);
        return [];
    }

    return conferences;
}

async function getRecruitingRankings(team, seasonYear) {
    if (seasonYear == null) seasonYear = new Date().getFullYear();

    var response = await fetch(`/recruiting/${seasonYear}/${team}`, {
        method: 'GET',
        headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
        }
    });

    var recruitingRankings = await response.json();

    return Array.isArray(recruitingRankings) ? recruitingRankings[0] : undefined;
}

async function getTeamSeasonStats(team, seasonYear) {
    var res = await fetch('/team-season-stats?season=' + seasonYear + '&teams=' + encodeURIComponent(team), {
        method: 'GET',
        headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' }
    });
    var data = await res.json();
    return Array.isArray(data) && data.length ? data[0] : null;
}

// Points for / against off the played games. Season stats know the team by name,
// the schedule by name on either side, so match on that and count only games
// that have a score — an unplayed schedule must not drag the average down.
function teamScoring(games, teamName) {
    var pf = 0, pa = 0, n = 0;
    (games || []).forEach(function (gm) {
        if (gm.homePoints == null || gm.awayPoints == null) return;
        var isHome = gm.homeTeam === teamName;
        var isAway = gm.awayTeam === teamName;
        if (!isHome && !isAway) return;
        pf += isHome ? gm.homePoints : gm.awayPoints;
        pa += isHome ? gm.awayPoints : gm.homePoints;
        n++;
    });
    return { pointsFor: pf, pointsAgainst: pa, games: n };
}

async function getPlayerSeasonLeaders(team, seasonYear) {
    var res = await fetch('/player-season-leaders?season=' + seasonYear + '&teams=' + encodeURIComponent(team), {
        method: 'GET',
        headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' }
    });
    var data = await res.json();
    return Array.isArray(data) && data.length ? data[0] : null;
}

// Helper: Format the date to readable format
// SAT 10/3 TBD, or SAT 9/26, 5:30PM. The day and date come from ccKickoff
// (public/kickoff-day.js) because a TBD kickoff is stored as midnight EASTERN,
// which read locally is the night before — see that file.
function formatDate(isTbd, dateStr) {
  const day = window.ccKickoff.dayAbbr(dateStr, isTbd);
  if (!day) return '';
  const datePart = window.ccKickoff.monthDay(dateStr, isTbd);
  const time = window.ccKickoff.time(dateStr, isTbd);

  if (isTbd) {
    return day + ' ' + datePart + ' TBD';
  } else {
    return day + ' ' + datePart + ', ' + time;
  }
}

// ---------------------------------------------------------------------------
// Rendering (#506). The frame is the shared kit's (public/sport-page.css/.js):
// hero shell, owner strip, sticky tabs, cards, game rows — the same frame as
// the basketball team page. What is football's own lives here and in team.css:
// the yard lines, SP+/FPI, the spread, the weekly points.
//
// Four tabs, the tab riding in the URL hash so back, refresh and a shared link
// land where the reader was:
//   Overview    next game, the season in numbers, outlook, weekly points,
//               where they sit in the conference, the programme
//   Schedule    every game, with the fantasy points each one scored
//   Stats       team stats and season leaders
//   <Conf>      the full conference table (not for an independent)
// ---------------------------------------------------------------------------
var FT_TABS = ['overview', 'schedule', 'stats', 'conference'];
var ftPage = { data: null, tab: 'overview', bound: false };

function ftEsc(s) { return window.ccSportPage.esc(s); }
function ftIcon(name) { return window.ccIcon ? window.ccIcon(name, { size: 14 }) : ''; }

function renderTeamError(message) {
    var root = document.getElementById('team-page');
    if (!root) return;
    root.innerHTML = '<div class="sp-error"><p>' + ftEsc(message) + '</p>'
        + '<p><a class="ft-link" href="/standings">Back to standings</a></p></div>';
}

// The conference table: every member school, with its record where it has
// one. Ordered by conference win % → conference wins → overall wins → overall
// losses — real CFB standings order by conference winning percentage, so a
// 4-0 team sits above a 5-1 (raw wins would flip them mid-season, before byes
// even out). A 0-0 team counts as .000. With no records at all yet (a
// preseason), alphabetical.
function buildStandings(records, conferenceTeams) {
    var teams = (Array.isArray(conferenceTeams) ? conferenceTeams : []).slice()
        .sort(function (a, b) { return String(a.school).toLowerCase().localeCompare(String(b.school).toLowerCase()); });
    var byId = new Map((Array.isArray(records) ? records : []).map(function (r) { return [String(r.teamId), r]; }));
    var zero = function () { return { games: 0, wins: 0, losses: 0, ties: 0 }; };
    var rows = teams.map(function (t) {
        var r = byId.get(String(t.id));
        return {
            teamId: t.id,
            team: t.school,
            conferenceGames: r && r.conferenceGames ? r.conferenceGames : zero(),
            total: r && r.total ? r.total : zero()
        };
    });
    if (!byId.size) return rows;
    var pct = function (t) {
        var g = t.conferenceGames.wins + t.conferenceGames.losses;
        return g > 0 ? t.conferenceGames.wins / g : 0;
    };
    return rows.sort(function (a, b) {
        var pa = pct(a), pb = pct(b);
        if (pb !== pa) return pb - pa;
        if (b.conferenceGames.wins !== a.conferenceGames.wins) return b.conferenceGames.wins - a.conferenceGames.wins;
        if (b.total.wins !== a.total.wins) return b.total.wins - a.total.wins;
        return a.total.losses - b.total.losses;
    });
}

// The viewed team's completed results, oldest first.
function computeForm(schedule, teamId) {
    if (!Array.isArray(schedule)) return [];
    return schedule
        .filter(g => g.completed && (g.homeId == teamId || g.awayId == teamId))
        .sort((a, b) => new Date(a.startDate) - new Date(b.startDate))
        .map(g => {
            var isHome = g.homeId == teamId;
            var us = Number(isHome ? g.homePoints : g.awayPoints) || 0;
            var them = Number(isHome ? g.awayPoints : g.homePoints) || 0;
            return { win: us > them, tie: us === them, us: us, them: them };
        });
}

function ftHex(c) {
    if (!c) return null;
    var s = String(c).trim();
    if (s.charAt(0) !== '#') s = '#' + s;
    return /^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(s) ? s : null;
}
function ftLogoOf(d, id) {
    return ccLogo((d.logos.find(t => t.id == id))?.logos) || '';
}
function ftRec(r) { return (r && r.wins || 0) + '–' + (r && r.losses || 0); }
function ftSeasonScore(d) {
    var v = d.seasonObj[d.scoreCode];
    return v != null ? v : 0;
}

// A football field stood on end behind the name — the football twin of the
// basketball hero's court. Goal lines at both ends, a line every five yards,
// and the hash marks between them.
function ftYardLines() {
    var s = '<svg class="ft-field" viewBox="0 0 120 240" fill="none" stroke="#fff" stroke-width="1.6" aria-hidden="true">'
        + '<rect x="1" y="1" width="118" height="238"/>';
    for (var y = 30; y <= 210; y += 15) s += '<path d="M0 ' + y + 'H120"' + (y === 30 || y === 210 ? ' stroke-width="3"' : '') + '/>';
    s += '<g stroke-width=".8">';
    for (var h = 33; h < 210; h += 3) s += '<path d="M44 ' + h + 'h6M70 ' + h + 'h6"/>';
    return s + '</g></svg>';
}

function ftHero(d) {
    var t = d.team, s = d.seasonObj, rec = d.record;
    var form = computeForm(d.schedule, t.id);
    var conf = s.conference || '';
    var loc = t.location || {};
    var sub = [t.mascot, conf, loc.name].filter(Boolean).map(ftEsc).join(' · ');

    var chips = [];
    // A season not yet started says so, rather than reading 0–0 as a record.
    if (!form.length) chips.push('<span class="sp-chip">' + ftEsc(s.season) + ' Preseason</span>');
    if (s.spRank != null) {
        var spTip = s.spRating != null
            ? 'SP+ ' + (s.spRating > 0 ? '+' : '') + s.spRating + ' — projected points per game vs. an average team'
            : 'SP+ national rank';
        chips.push('<span class="sp-chip" title="' + ftEsc(spTip) + '">SP+ <b>#' + ftEsc(s.spRank) + '</b></span>');
    }
    if (s.fpiRank != null) chips.push('<span class="sp-chip" title="ESPN Football Power Index — national rank">FPI <b>#' + ftEsc(s.fpiRank) + '</b></span>');
    if (s.expectedWins != null) chips.push('<span class="sp-chip" title="Preseason projection">Proj. <b>' + Number(s.expectedWins).toFixed(1) + ' wins</b></span>');

    var score = ftSeasonScore(d);
    var marks = form.slice(-6).map(function (f) {
        var k = f.tie ? 't' : (f.win ? 'w' : 'l');
        return '<span class="sp-wl ' + k + '" title="' + f.us + '-' + f.them + '">' + k.toUpperCase() + '</span>';
    }).join('');
    var color = ftHex(t.color);
    var logo = ccLogo(t.logos);

    return '<section class="sp-hero team ft-hero"' + (color ? ' style="--team:' + color + '"' : '') + '>' + ftYardLines()
        + '<div class="ft-id">' + (logo ? '<img class="ft-logo" src="' + ftEsc(logo) + '" alt="' + ftEsc(t.school) + '">' : '')
        + '<div class="ft-idtext"><h1 class="ft-school">' + ftEsc(String(t.school || '').toUpperCase()) + '</h1>'
        + '<div class="ft-mascot">' + sub + '</div>'
        + (chips.length ? '<div class="ft-chips">' + chips.join('') + '</div>' : '') + '</div></div>'
        + '<div class="ft-rec">'
        + '<div><div class="n">' + ftRec(rec && rec.total) + '</div><div class="l">Overall</div></div>'
        + (conf && conf !== 'FBS Independents' ? '<div><div class="n">' + ftRec(rec && rec.conferenceGames) + '</div><div class="l">' + ftEsc(conf) + '</div></div>' : '')
        + '<div><div class="n" data-countup="' + score + '">' + score + '</div><div class="l">Season pts</div></div>'
        + renderSeasonSelector(t.seasons, s.season)
        + '</div>'
        + (marks ? '<div class="ft-form" title="Most recent results">' + marks + '</div>' : '')
        + '</section>';
}

// Whose roster the team is on in the league being viewed, and what it has
// banked them. A basketball league drafts no football teams, so it says
// nothing rather than "Undrafted".
function ftOwnerStrip(d) {
    var lg = window.ccLeague;
    if (lg && typeof lg.sport === 'function' && lg.sport() !== 'football') return '';
    var league = lg && typeof lg.name === 'function' ? lg.name() : '';
    if (!d.owner) {
        return '<div class="sp-own free"><div class="who"><b>Undrafted</b>' + (league ? ' in ' + ftEsc(league) : '')
            + ', ' + ftEsc(d.year) + '</div></div>';
    }
    var name = d.owner.franchiseName || d.owner.name || 'a manager';
    var banked = Object.keys(d.owner.points || {}).reduce(function (sum, k) { return sum + d.owner.points[k]; }, 0);
    var sub = [d.owner.franchiseName && d.owner.name ? d.owner.name : '', league].filter(Boolean).map(ftEsc).join(' · ');
    return '<a class="sp-own" href="/userHome?user=' + encodeURIComponent(d.owner.userId) + '">'
        + '<div class="who">On <b>' + ftEsc(name) + '</b>’s roster' + (sub ? '<br><span class="sub">' + sub + '</span>' : '') + '</div>'
        + '<div class="pts"><div class="n" data-countup="' + banked + '" data-sign="+">' + (banked > 0 ? '+' : '') + banked + '</div>'
        + '<div class="l">pts banked</div></div></a>';
}

// The AP (or, once it publishes, the Playoff Committee) rank a school held for
// one game: that week's poll for a regular-season game, falling back to the
// latest poll; the week-16 poll for the postseason.
function ftRankFor(d, game, school) {
    var rankings = d.rankings || [];
    var pollName = 'Playoff Committee Rankings';
    if (!rankings.find(r => r.week == game.week)?.polls?.find(p => p.poll == pollName) && game.seasonType != 'postseason') {
        pollName = 'AP Top 25';
    }
    var latest = rankings.slice().sort((a, b) => b.week - a.week)[0];
    var ranks;
    if (game.seasonType == 'regular') {
        var wk = rankings.find(r => r.week == game.week && r.season == d.year);
        ranks = (wk || latest)?.polls?.find(p => p.poll == pollName)?.ranks;
    } else {
        ranks = rankings.find(r => r.week == '16' && r.season == d.year)?.polls?.find(p => p.poll == pollName)?.ranks;
    }
    var hit = Array.isArray(ranks) ? ranks.find(w => w.school == school) : null;
    return hit ? hit.rank : null;
}

// The spread from the viewed team's side: "−7.5" when they are favoured,
// "+7.5" when not. DraftKings when there is a line from them. A missing or
// malformed line is just no line.
function ftSpreadFor(d, game, isHome) {
    var lines = (d.bettingLines || []).find(b => b.homeTeam == game.homeTeam && b.awayTeam == game.awayTeam)?.lines;
    if (!Array.isArray(lines) || !lines.length) return '';
    var line = lines.find(l => l.provider == 'DraftKings') || lines[0];
    var spread = line && line.formattedSpread;
    if (typeof spread !== 'string' || spread.indexOf('-') === -1) return '';
    var idx = spread.lastIndexOf('-');
    var fav = spread.slice(0, idx).trim();
    var number = spread.slice(idx + 1).trim();
    if (!number) return '';
    var us = isHome ? game.homeTeam : game.awayTeam;
    var them = isHome ? game.awayTeam : game.homeTeam;
    if (fav == us) return '−' + number;
    if (fav == them) return '+' + number;
    return '';
}

// What each game scored, by game id. A drafted team's points are what it
// banked its manager — exact per game. An undrafted team's come off its own
// weekly rows, which are per week: a week holding two of its games can't be
// split, so the week's total sits on the later one and says so.
function ftGamePoints(d) {
    var out = {};
    if (d.owner && d.owner.points && Object.keys(d.owner.points).length) {
        Object.keys(d.owner.points).forEach(function (k) { out[k] = { pts: d.owner.points[k] }; });
        return out;
    }
    var key = d.scoreCode === 'cumulativeScoreV1' ? 'scoreV1' : 'scoreV2';
    var byWeek = {};
    (d.seasonObj.weeklyScore || []).forEach(function (w) {
        var k = (w.seasonType || 'regular') + ':' + w.week;
        byWeek[k] = (byWeek[k] || 0) + (Number(w[key]) || 0);
    });
    var games = {};
    d.schedule.filter(g => g.completed && g.id != null).forEach(function (g) {
        var k = (g.seasonType || 'regular') + ':' + g.week;
        (games[k] = games[k] || []).push(g);
    });
    Object.keys(games).forEach(function (k) {
        if (!(k in byWeek)) return;
        var list = games[k];
        out[String(list[list.length - 1].id)] = { pts: byWeek[k], week: list.length > 1 };
    });
    return out;
}

function ftOpponent(d, g) {
    var isHome = String(g.homeId) === String(d.team.id);
    return {
        isHome: isHome,
        id: isHome ? g.awayId : g.homeId,
        name: isHome ? g.awayTeam : g.homeTeam,
        mark: g.neutralSite ? 'N' : (isHome ? 'vs' : '@')
    };
}

function ftGameRow(d, g, points) {
    var o = ftOpponent(d, g);
    var rank = ftRankFor(d, g, o.name);
    var ownRank = ftRankFor(d, g, d.team.school);
    var logo = ftLogoOf(d, o.id);
    var href = g.id != null ? '/game/' + encodeURIComponent(g.id) : null;

    var res;
    if (g.completed) {
        var us = Number(o.isHome ? g.homePoints : g.awayPoints) || 0;
        var them = Number(o.isHome ? g.awayPoints : g.homePoints) || 0;
        var letter = us === them ? 'T' : (us > them ? 'W' : 'L');
        res = '<span class="' + (letter === 'W' ? 'sp-w' : letter === 'L' ? 'sp-l' : '') + '">' + letter + '</span> ' + us + '–' + them;
    } else {
        var spread = ftSpreadFor(d, g, o.isHome);
        res = spread ? '<span title="Spread">' + ftEsc(spread) + '</span>' : '';
    }

    var note = [];
    if (!g.completed) note.push(ftEsc(window.ccKickoff.dayAbbr(g.startDate, g.startTimeTbd) + ' ' + window.ccKickoff.time(g.startDate, g.startTimeTbd)));
    if (ownRank) note.push('as #' + ftEsc(ownRank));
    if (g.outlet) note.push('<span class="ft-tv">' + ftIcon('broadcast') + ' ' + ftEsc(g.outlet) + '</span>');
    if (g.weather && g.weather.emoji && window.ccWeatherEmoji && window.ccWeatherEmoji[g.weather.emoji]) {
        note.push('<span title="' + ftEsc((g.weather.condition || '') + (g.weather.temp != null ? ' · ' + g.weather.temp + '°F' : '')) + '">'
            + window.ccWeatherEmoji[g.weather.emoji] + '</span>');
    }
    if (g.neutralSite && g.venue) note.push(ftEsc(g.venue));
    if (g.notes) note.push(ftEsc(g.notes));

    var p = g.id != null ? points[String(g.id)] : null;
    var pts = p ? (p.pts > 0 ? '+' + p.pts : String(p.pts)) : '';
    var open = function (cls) { return href ? '<a class="' + cls + '" href="' + href + '">' : '<span class="' + cls + '">'; };
    var close = href ? '</a>' : '</span>';

    return '<div class="sp-gr' + (g.completed ? '' : ' up') + '">'
        + open('d') + ftEsc(window.ccSportPage.dayOf(g)) + close
        + '<a class="opp" href="/team?team=' + encodeURIComponent(o.id) + '"><span class="nm">'
        + '<span class="ft-v">' + o.mark + '</span>'
        + (rank ? '<span class="ft-rk">' + ftEsc(rank) + '</span> ' : '')
        + (logo ? '<img class="sp-ologo" src="' + ftEsc(logo) + '" alt="" loading="lazy" onerror="this.remove()">' : '')
        + ftEsc(o.name) + '</span>'
        + (note.length ? '<span class="note">' + note.join(' · ') + '</span>' : '') + '</a>'
        + open('res') + res + close
        + '<span class="p' + (p && p.pts ? '' : ' z') + '"' + (p && p.week ? ' title="The week’s total: two games that week"' : '') + '>' + pts + '</span>'
        + '</div>';
}

function ftNextUp(d, now) {
    now = now == null ? Date.now() : now;
    var g = d.schedule.filter(x => !x.completed)[0];
    if (!g) return '';
    var o = ftOpponent(d, g);
    var rank = ftRankFor(d, g, o.name);
    var logo = ftLogoOf(d, o.id);
    var started = !g.startTimeTbd && g.startDate && now >= new Date(g.startDate).getTime();
    var spread = ftSpreadFor(d, g, o.isHome);
    var note = [];
    if (g.outlet) note.push(ftIcon('broadcast') + ' ' + ftEsc(g.outlet));
    if (g.neutralSite && g.venue) note.push(ftEsc(g.venue));
    if (g.notes) note.push(ftEsc(g.notes));
    return '<h2 class="sp-h">Next up</h2>'
        + '<a class="sp-card sp-next" href="' + (g.id != null ? '/game/' + encodeURIComponent(g.id) : '/team?team=' + encodeURIComponent(o.id)) + '">'
        + '<div class="sp-next-when">' + (started ? 'Under way' : ftEsc(formatDate(g.startTimeTbd, g.startDate))) + '</div>'
        + '<div class="sp-next-row"><span class="sp-next-opp"><span class="ft-v">' + o.mark + '</span>'
        + (rank ? '<span class="ft-rk">' + ftEsc(rank) + '</span> ' : '')
        + (logo ? '<img class="sp-ologo" src="' + ftEsc(logo) + '" alt="">' : '')
        + '<b>' + ftEsc(o.name) + '</b></span>'
        + (spread ? '<span class="sp-next-pay" title="Spread">' + ftEsc(spread) + '</span>' : '') + '</div>'
        + (note.length ? '<div class="sp-next-note">' + note.join(' · ') + '</div>' : '')
        + '</a>';
}

// The season in three numbers: fantasy points (and where that ranks
// nationally, once there are any), recruiting, and wins against the
// projection — a delta only once the regular season is over, because
// mid-season it reads as a shortfall the team hasn't had yet.
function ftSeason(d) {
    var s = d.seasonObj;
    var score = ftSeasonScore(d);
    var tile = function (n, l, sub) {
        return '<div class="ft-tile"><div class="n">' + n + '</div><div class="l">' + l + '</div>'
            + (sub ? '<div class="s">' + sub + '</div>' : '') + '</div>';
    };
    var rank = d.fantasyRank && score > 0 ? '#' + d.fantasyRank.rank + ' of ' + d.fantasyRank.total : '';
    var tiles = tile('<span data-countup="' + score + '">' + score + '</span>', 'Season pts', rank);
    tiles += tile(d.recruiting && d.recruiting.rank != null ? '#' + ftEsc(d.recruiting.rank) : '—', 'Recruiting', '');
    if (s.expectedWins != null) {
        var expected = Number(s.expectedWins);
        var regular = d.schedule.filter(g => !g.seasonType || g.seasonType === 'regular');
        var done = regular.length > 0 && regular.every(g => g.completed);
        if (done) {
            var wins = d.record?.total?.wins ?? computeForm(d.schedule, d.team.id).filter(f => f.win).length;
            var delta = wins - expected;
            tiles += tile(wins, 'Wins', 'vs ' + expected.toFixed(1) + ' expected <span class="' + (delta >= 0 ? 'sp-w' : 'sp-l') + '">'
                + (delta >= 0 ? '▲' : '▼') + ' ' + Math.abs(delta).toFixed(1) + '</span>');
        } else {
            tiles += tile(expected.toFixed(1), 'Projected wins', '');
        }
    }
    return '<h2 class="sp-h">Season</h2><div class="ft-tiles">' + tiles + '</div>';
}

// SP+/FPI power ratings, talent, returning production. Only once the
// enrichment job has populated them.
function ftOutlook(d) {
    var s = d.seasonObj;
    var chips = [];
    if (s.spRank != null) {
        chips.push('<span class="ft-chip" title="Projected points per game vs. an average team">SP+ <b>'
            + (s.spRating != null ? (s.spRating > 0 ? '+' : '') + ftEsc(s.spRating) + ' · ' : '') + '#' + ftEsc(s.spRank) + '</b></span>');
    }
    if (s.fpiRank != null) chips.push('<span class="ft-chip" title="ESPN Football Power Index — national rank">FPI <b>#' + ftEsc(s.fpiRank) + '</b></span>');
    if (s.talentRank != null || s.talent != null) {
        var talTip = '247Sports Talent Composite' + (s.talent != null ? ' (' + Math.round(s.talent) + ')' : '')
            + ' — total blue-chip recruiting talent on the roster; higher = more talent';
        chips.push('<span class="ft-chip" title="' + ftEsc(talTip) + '">Talent <b>'
            + (s.talentRank != null ? '#' + ftEsc(s.talentRank) : Math.round(s.talent)) + '</b></span>');
    }
    if (s.returningProduction != null) {
        chips.push('<span class="ft-chip" title="Share of last season\'s production (PPA) returning"><b>' + ftEsc(s.returningProduction) + '%</b> returning</span>');
    }
    if (!chips.length) return '';
    // Preseason: SP+/talent/returning land only once CFBD publishes them (FPI
    // arrives earlier), so a lone FPI chip says why it is alone.
    var played = computeForm(d.schedule, d.team.id).length;
    var note = played === 0 && s.spRank == null
        ? '<p class="ft-explain">SP+, talent &amp; returning production post closer to kickoff.</p>' : '';
    return '<h2 class="sp-h">Outlook</h2><div class="ft-chips-row">' + chips.join('') + '</div>' + note;
}

// Weekly points: one bar a week, postseason weeks after the regular season.
// Two games in one week are summed.
function ftWeekly(d) {
    var weekly = Array.isArray(d.seasonObj.weeklyScore) ? d.seasonObj.weeklyScore : [];
    if (!weekly.length) return '';
    var key = d.scoreCode === 'cumulativeScoreV1' ? 'scoreV1' : 'scoreV2';
    var byKey = {};
    weekly.forEach(function (w) {
        var k = (w.seasonType || 'regular') + ':' + w.week;
        if (!byKey[k]) byKey[k] = { week: w.week, seasonType: w.seasonType, score: 0 };
        byKey[k].score += Number(w[key]) || 0;
    });
    var merged = Object.values(byKey)
        .sort(function (a, b) { return (b.seasonType || '').localeCompare(a.seasonType || '') || a.week - b.week; });
    var max = Math.max(...merged.map(function (w) { return w.score; }), 1);
    var bars = merged.map(function (w, i) {
        var pct = Math.max(4, Math.round((w.score / max) * 100));
        var label = (w.seasonType && w.seasonType !== 'regular') ? 'P' + w.week : 'W' + w.week;
        return '<div class="ft-week" title="Week ' + w.week + ': ' + w.score + ' pts">'
            + '<span class="v">' + w.score + '</span>'
            + '<span class="f" style="height:' + pct + '%;animation-delay:' + (i * 50) + 'ms"></span>'
            + '<span class="k">' + label + '</span></div>';
    }).join('');
    return '<h2 class="sp-h">Weekly points</h2><div class="sp-card ft-weeks">' + bars + '</div>';
}

function ftOrdinal(n) {
    var t = n % 100, s = n % 10;
    return n + (t >= 11 && t <= 13 ? 'th' : s === 1 ? 'st' : s === 2 ? 'nd' : s === 3 ? 'rd' : 'th');
}
function ftStandingsRow(d, r, i) {
    var me = String(r.teamId) === String(d.team.id);
    var logo = ftLogoOf(d, r.teamId);
    return '<tr' + (me ? ' class="me"' : '') + '><td class="n">' + (i + 1) + '</td>'
        + '<td class="s"><a href="/team?team=' + encodeURIComponent(r.teamId) + '">' + (logo ? '<img src="' + ftEsc(logo) + '" alt="">' : '') + ftEsc(r.team) + '</a></td>'
        + '<td>' + ftRec(r.conferenceGames) + '</td><td>' + ftRec(r.total) + '</td></tr>';
}
var FT_TABLE_HEAD = '<table class="sp-st"><thead><tr><th></th><th>Team</th><th>Conf</th><th>Overall</th></tr></thead><tbody>';

// Where they sit, at a glance: the rows either side of this team, with the
// full table one tap away on its own tab.
var FT_PEEK = 2;
function ftStandingsPeek(d) {
    var at = d.standings.findIndex(r => String(r.teamId) === String(d.team.id));
    if (at === -1) return '';
    var from = Math.max(0, Math.min(at - FT_PEEK, d.standings.length - (FT_PEEK * 2 + 1)));
    var rows = d.standings.slice(from, from + FT_PEEK * 2 + 1);
    var conf = d.seasonObj.conference;
    return '<h2 class="sp-h">' + ftEsc(conf) + '<small>' + ftOrdinal(at + 1) + ' of ' + d.standings.length + '</small></h2>'
        + '<div class="sp-card">' + FT_TABLE_HEAD + rows.map(function (r, i) { return ftStandingsRow(d, r, from + i); }).join('')
        + '</tbody></table><button type="button" class="sp-peek-more" data-tab="conference">Full ' + ftEsc(conf) + ' table</button></div>';
}

function ftStandings(d) {
    return '<div class="sp-card">' + FT_TABLE_HEAD + d.standings.map(function (r, i) { return ftStandingsRow(d, r, i); }).join('')
        + '</tbody></table></div>';
}

// The programme: conference, coach, stadium and its facts, the account.
function ftProgram(d) {
    var t = d.team, s = d.seasonObj, loc = t.location || {};
    var rows = [];
    var row = function (k, v) { rows.push('<div class="ft-kv"><span>' + k + '</span><span>' + v + '</span></div>'); };
    if (s.conference) {
        var confLogo = getConferenceLogo(s.conference);
        row('Conference', (confLogo ? '<img class="ft-conf" src="' + confLogo + '" alt=""> ' : '') + ftEsc(s.conference));
    }
    if (s.coach) row('Coach', ftEsc(s.coach));
    if (loc.name) row('Stadium', ftEsc(loc.name));
    if (loc.city && loc.state) row('Location', ftEsc(loc.city + ', ' + loc.state));
    if (loc.capacity != null) row('Capacity', Number(loc.capacity).toLocaleString());
    if (loc.year_constructed) row('Built', ftEsc(loc.year_constructed));
    if (loc.grass === true || loc.grass === false) row('Surface', loc.grass ? 'Grass' : 'Turf');
    if (loc.dome === true) row('Roof', 'Dome');
    if (loc.elevation) row('Elevation', Math.round(Number(loc.elevation)).toLocaleString() + ' ft');
    // Twitter is optional; only shown when a handle exists (the old code once
    // printed the literal text "null" linking to twitter.com/null).
    var handle = t.twitter ? String(t.twitter).replace(/^@/, '') : '';
    if (handle) row('Twitter', '<a class="ft-link" href="https://twitter.com/' + encodeURIComponent(handle) + '" target="_blank" rel="noopener noreferrer">@' + ftEsc(handle) + '</a>');
    if (!rows.length) return '';
    return '<h2 class="sp-h">Program</h2><div class="sp-card ft-kvs">' + rows.join('') + '</div>';
}

function ftOverview(d) {
    return ftNextUp(d) + ftSeason(d) + ftOutlook(d) + ftWeekly(d)
        + (d.standings.length ? ftStandingsPeek(d) : '') + ftProgram(d);
}

// This page renders game times in the browser's zone (see localTzLabel), so
// the schedule says which zone that is.
function ftSchedule(d) {
    if (!d.schedule.length) return '<div class="sp-card sp-empty">No games on the ' + ftEsc(d.year) + ' schedule yet.</div>';
    var tz = localTzLabel();
    var points = ftGamePoints(d);
    var anyPlayed = d.schedule.some(g => g.completed);
    var h = '<h2 class="sp-h">' + ftEsc(d.year) + ' schedule' + (tz ? '<small>All times ' + ftEsc(tz) + '</small>' : '') + '</h2>'
        + '<div class="sp-card sp-games">';
    var split = false;
    d.schedule.forEach(function (g) {
        if (!g.completed && !split) {
            split = true;
            if (anyPlayed) h += '<div class="sp-gr div">Up next</div>';
        }
        h += ftGameRow(d, g, points);
    });
    return h + '</div><p class="ft-explain">The last column is the fantasy points the team scored in each game'
        + (d.owner ? ', as banked for its manager.' : '.') + '</p>';
}

// Team stats off CFBD's season aggregate. Points are summed off the played
// games instead — the aggregate carries no scoring at all, so both point rows
// once read a flat 0.0 next to real yardage.
function ftTeamStats(d) {
    var data = d.teamStats;
    if (!data || !data.stats || !data.games) return '';
    var s = data.stats, g = data.games;
    var scoring = teamScoring(d.schedule, data.team);
    var rows = [
        ['Total YPG', (s.totalYards || 0) / g],
        ['Opp YPG', (s.totalYardsOpponent || 0) / g],
        ['Rush YPG', (s.rushingYards || 0) / g],
        ['Pass YPG', (s.netPassingYards || 0) / g],
        ['Points / game', scoring.games ? scoring.pointsFor / scoring.games : 0],
        ['Opp PPG', scoring.games ? scoring.pointsAgainst / scoring.games : 0],
        ['Turnovers / game', (s.turnovers || 0) / g],
        ['Sacks / game', (s.sacks || 0) / g],
        ['3rd down %', s.thirdDowns > 0 ? (s.thirdDownConversions || 0) / s.thirdDowns * 100 : 0, true]
    ];
    return '<h2 class="sp-h">Team stats<small>' + g + (g === 1 ? ' game' : ' games') + '</small></h2><div class="sp-card ft-kvs">'
        + rows.map(function (r) {
            return '<div class="ft-kv"><span>' + r[0] + '</span><b>' + r[1].toFixed(1) + (r[2] ? '%' : '') + '</b></div>';
        }).join('') + '</div>';
}

var FT_LEADER_CATS = [
    { key: 'passing', label: 'Passing', cols: ['YDS', 'TD', 'INT', 'PCT'], colLabels: { 'PCT': 'CMP%' } },
    { key: 'rushing', label: 'Rushing', cols: ['CAR', 'YDS', 'TD', 'YPC'] },
    { key: 'receiving', label: 'Receiving', cols: ['REC', 'YDS', 'TD', 'YPR'] },
    { key: 'tackles', label: 'Tackles', cols: ['TOT', 'SOLO', 'TFL', 'SACKS'] },
    // 'QB HUR' is the widest label of any category; shortened so it doesn't
    // force every fixed-width column wider than the values need.
    { key: 'sacks', label: 'Sacks', cols: ['SACKS', 'TFL', 'QB HUR'], colLabels: { 'QB HUR': 'HUR' } },
    { key: 'interceptions', label: 'Interceptions', cols: ['INT', 'YDS', 'TD'] },
    { key: 'kicking', label: 'Kicking', cols: ['FGM', 'FGA', 'XPM', 'XPA', 'PTS'] }
];

// Each category's column labels sit once on its own line, and every player
// row lines up under them: the label and value cells share a fixed width, so
// a wide value can't widen its own column.
function ftLeaders(d) {
    var data = d.playerLeaders;
    if (!data || !data.leaders) return '';
    var h = '';
    FT_LEADER_CATS.forEach(function (cat) {
        var players = data.leaders[cat.key];
        if (!players || !players.length) return;
        h += '<div class="tv-pl-group"><div class="tv-pl-cathead"><span class="tv-pl-cat">' + cat.label + '</span><span class="tv-pl-stats">'
            + cat.cols.map(function (c) { return '<span class="tv-pl-hcell">' + ((cat.colLabels && cat.colLabels[c]) || c) + '</span>'; }).join('')
            + '</span></div>';
        players.forEach(function (p) {
            h += '<div class="tv-pl-player"><div class="tv-pl-player-info"><span class="tv-pl-name">' + ftEsc(p.name) + '</span>'
                + (p.pos ? '<span class="tv-pl-pos">' + ftEsc(p.pos) + '</span>' : '') + '</div><div class="tv-pl-stats">'
                + cat.cols.map(function (c) {
                    var v = p[c] != null ? p[c] : 0;
                    return '<span class="tv-pl-stat-cell">' + (c === 'PCT' ? (v <= 1 ? Math.round(v * 100) : v) + '%' : ftEsc(v)) + '</span>';
                }).join('') + '</div></div>';
        });
        h += '</div>';
    });
    return h ? '<h2 class="sp-h">Season leaders</h2><div class="sp-card ft-leaders">' + h + '</div>' : '';
}

function ftStats(d) {
    var h = ftTeamStats(d) + ftLeaders(d);
    return h || '<div class="sp-card sp-empty">Team stats and season leaders arrive once the season kicks off.</div>';
}

function ftTabList(d) {
    return FT_TABS.filter(function (t) { return t !== 'conference' || d.standings.length; });
}
function ftTabFromHash(d) {
    var h = (window.location.hash || '').replace('#', '');
    return ftTabList(d).indexOf(h) !== -1 ? h : 'overview';
}
function ftTabs(d) {
    var label = { overview: 'Overview', schedule: 'Schedule', stats: 'Stats', conference: d.seasonObj.conference || 'Conference' };
    return window.ccSportPage.tabs(ftTabList(d).map(function (t) { return [t, label[t]]; }), ftPage.tab);
}
function ftPanel(d) {
    if (ftPage.tab === 'schedule') return ftSchedule(d);
    if (ftPage.tab === 'stats') return ftStats(d);
    if (ftPage.tab === 'conference') return ftStandings(d);
    return ftOverview(d);
}

// Names in the leaders card get whatever width the stat columns leave, and
// shorten only when they would clip (public/fit-names.js).
function ftAfterPanel(root) {
    if (window.ccFitNames) {
        ccFitNames('.tv-pl-name', root);
        if (window.ccWatchNameFit) ccWatchNameFit('.tv-pl-name', root);
    }
}

function ftPaintPanel() {
    var root = document.getElementById('team-page');
    var d = ftPage.data;
    var tabsEl = root.querySelector('.sp-tabs');
    if (tabsEl) tabsEl.outerHTML = ftTabs(d);
    var panel = root.querySelector('.ft-panel');
    panel.innerHTML = ftPanel(d);
    ftAfterPanel(panel);
    window.ccSportPage.countUp(panel);
}

// Scroll so the panel starts just under the sticky navbar and tabs.
function ftToPanelTop(root) {
    var panel = root.querySelector('.ft-panel'), tabsEl = root.querySelector('.sp-tabs');
    var nav = document.getElementById('navbar');
    var cover = (nav ? nav.getBoundingClientRect().height : 0) + (tabsEl ? tabsEl.getBoundingClientRect().height : 0);
    window.scrollTo(0, Math.max(0, panel.getBoundingClientRect().top + window.pageYOffset - cover - 8));
}

function renderTeamPage(d) {
    var root = document.getElementById('team-page');
    if (!root) return;
    ftPage.data = d;
    ftPage.tab = ftTabFromHash(d);
    root.innerHTML = ftHero(d) + ftOwnerStrip(d) + ftTabs(d)
        + '<div class="ft-panel" role="tabpanel">' + ftPanel(d) + '</div>';

    // The tab title names the team, and the league being viewed.
    var name = (d.team.school + ' ' + (d.team.mascot || '')).trim();
    var t = document.querySelector('title');
    if (t) t.setAttribute('data-league-title', name);
    if (window.ccLeague && window.ccLeague.title) document.title = window.ccLeague.title(name);

    ftAfterPanel(root);
    window.ccSportPage.countUp(root);

    if (ftPage.bound) return;
    ftPage.bound = true;
    root.addEventListener('click', function (e) {
        var tab = e.target.closest('[data-tab]');
        if (!tab || !ftPage.data) return;
        ftPage.tab = tab.getAttribute('data-tab');
        if (window.history && window.history.replaceState) window.history.replaceState(null, '', '#' + ftPage.tab);
        ftPaintPanel();
        // From the peek at the bottom of the Overview, the table would
        // otherwise open scrolled to wherever the peek was.
        if (tab.classList.contains('sp-peek-more')) ftToPanelTop(root);
    });
}

// The navbar owns the "My team" link + userId caching (views/partials/navbar.ejs).
