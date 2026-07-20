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

        // Only set leagueCode from metaData if it's not already stored
        if (!window.localStorage.getItem("leagueCode") && data?.user_metadata?.metadata?.league) {
            var newLeagueCode = (data.user_metadata.metadata.league == 'gg' ? 'graham-league' : 'claunts-league');
            window.localStorage.setItem("leagueCode", newLeagueCode);
        }

        if (userState.user_metadata.roles?.at(-1) == 'Admin') {
            const leagueCode = window.localStorage.getItem("leagueCode");

            if (leagueCode && (leagueCode != "undefined")) {
                const currentSelectedLeague = window.sessionStorage.getItem("league");
                if (currentSelectedLeague) {
                    var btn = document.getElementById("dropdownMenuButton");
                    if (btn) btn.textContent = currentSelectedLeague;
                }
            }
        }
    });
}

window.onload = function() {
    function initNavbarToggle() {
        const toggleButton = document.querySelector('.toggle-button');
        const navbarLinks = document.querySelector('.navbar-links');

        if (toggleButton && navbarLinks) {
            toggleButton.addEventListener('click', () => {
                navbarLinks.classList.toggle('active');
            });
        } else {
            // Retry after 500ms if elements aren't in the DOM yet
            setTimeout(initNavbarToggle, 500);
        }
    }

    initNavbarToggle();
    initLeagueSelector();

    getUserProfile();
    loadTeamPage();
    setNavbarUserId();
};

// Vanilla replacement for the old jQuery league-selector handler. The navbar's
// Bootstrap handles opening the dropdown; this only wires the item clicks.
function initLeagueSelector() {
    const items = document.querySelectorAll('[league-selector] a');
    if (!items.length) return;

    const button = document.getElementById('dropdownMenuButton');
    items.forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            const label = item.textContent;
            const value = item.getAttribute('value');
            if (button) {
                button.textContent = label;
                button.value = value;
            }
            window.sessionStorage.setItem("league", label);
            window.localStorage.setItem("leagueCode", value);
            window.location.reload();
        });
    });
}

// ---------------------------------------------------------------------------
// Page orchestration: fetch the team doc once, then fan out the dependent
// requests. A missing / unknown ?team= param renders an error card instead of
// throwing and leaving a blank page.
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

    // Theme the page from the team's own colours before anything renders.
    applyTeamTheme(teamData);

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
    const leagueCode = window.localStorage.getItem("leagueCode");

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
        getTeamFantasyRank(teamId, seasonYear, leagueCode)
    ]);
    const val = (i, fallback) => results[i].status === 'fulfilled' && results[i].value != null ? results[i].value : fallback;
    const record = val(0, undefined);
    const conferenceRecords = val(1, []);
    const allLogos = val(2, []);
    const recruiting = val(3, undefined);
    const schedule = val(4, []);
    const rankings = val(5, []);
    const bettingLines = val(6, []);
    const owner = val(7, null);
    const fantasyRank = val(8, null);

    renderConferenceStandings(conferenceRecords, teamData, allLogos, conference);
    renderTeamInfo(teamData, record, recruiting, seasonObj, schedule, owner, fantasyRank);
    renderTeamScheduleInfo(schedule, allLogos, rankings, bettingLines, seasonYear, teamData);
}

// Find the fantasy manager who drafted this team in the given season/league.
// Returns { name, franchiseName, userId } or null if undrafted / unavailable.
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
            const season = user.seasons?.[0];
            const owns = season?.teams?.some(t => String(t.id) === String(teamId));
            if (owns) {
                return {
                    userId: user._id,
                    name: `${user.firstName || ''} ${user.lastName || ''}`.trim(),
                    franchiseName: season.franchiseName || ''
                };
            }
        }
        return null;
    } catch (e) {
        return null;
    }
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
        const scored = teams
            .map(t => ({ id: t.id, score: Number(t.seasons?.[0]?.[key]) || 0 }))
            .sort((a, b) => b.score - a.score);

        const idx = scored.findIndex(t => String(t.id) === String(teamId));
        if (idx === -1) return null;
        return { rank: idx + 1, total: scored.length };
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
        <select class="season-select" aria-label="Select season" onchange="onSeasonChange(this.value)">
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

async function getAllBettingLines (seasonYear) {
    if (seasonYear == null) seasonYear = new Date().getFullYear();

    var bettingPromise = await fetch(`/betting/${seasonYear}`, {
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

// ---------------------------------------------------------------------------
// Team-colour theming. Sets CSS custom properties from the team's stored
// colours; team.css consumes them (with the old red as fallback).
// ---------------------------------------------------------------------------
function applyTeamTheme(team) {
    var accent = readableOnDark(team?.color) || readableOnDark(team?.alt_color) || '#ed5858';
    var rgb = hexToRgb(accent);
    var root = document.documentElement;
    root.style.setProperty('--team-accent', accent);
    if (rgb) {
        root.style.setProperty('--team-accent-rgb', `${rgb.r}, ${rgb.g}, ${rgb.b}`);
        root.style.setProperty('--team-accent-contrast', contrastText(rgb));
    }
}

function hexToRgb(hex) {
    if (typeof hex !== 'string') return null;
    var m = hex.trim().replace('#', '');
    if (m.length === 3) m = m.split('').map(c => c + c).join('');
    if (!/^[0-9a-fA-F]{6}$/.test(m)) return null;
    return {
        r: parseInt(m.slice(0, 2), 16),
        g: parseInt(m.slice(2, 4), 16),
        b: parseInt(m.slice(4, 6), 16)
    };
}

function rgbToHex(r, g, b) {
    const h = v => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0');
    return `#${h(r)}${h(g)}${h(b)}`;
}

// Relative luminance (0 = black, 1 = white), used to decide readability.
function luminance(r, g, b) {
    const a = [r, g, b].map(v => {
        v /= 255;
        return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2];
}

// Returns a version of the colour that reads on the dark (#101322) background:
// very dark team colours (e.g. navy/black) are lightened toward white until
// they clear a minimum luminance. Returns null for unparseable input.
function readableOnDark(hex) {
    var rgb = hexToRgb(hex);
    if (!rgb) return null;
    var { r, g, b } = rgb;
    var guard = 0;
    while (luminance(r, g, b) < 0.22 && guard < 12) {
        r = r + (255 - r) * 0.18;
        g = g + (255 - g) * 0.18;
        b = b + (255 - b) * 0.18;
        guard++;
    }
    return rgbToHex(r, g, b);
}

// Black or white text to sit on top of the accent colour.
function contrastText(rgb) {
    return luminance(rgb.r, rgb.g, rgb.b) > 0.45 ? '#101322' : '#F4F6FB';
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------
function renderTeamError(message) {
    const container = document.getElementById("team-container");
    if (!container) return;
    container.innerHTML = `
        <div class="team-empty">
            <i class="fa-solid fa-helmet-un"></i>
            <h2>${message}</h2>
            <p><a href="/standings">Back to standings</a></p>
        </div>
    `;
    // Nothing else can render without a team; hide the lower panels.
    var lower = document.querySelector('.standings-container');
    if (lower) lower.style.display = 'none';
    var hr = document.querySelector('.hr-subtle');
    if (hr) hr.style.display = 'none';
}

// Compute the viewed team's completed results in chronological order.
function computeForm(schedule, teamId) {
    if (!Array.isArray(schedule)) return [];
    return schedule
        .filter(g => g.completed && (g.homeId == teamId || g.awayId == teamId))
        .sort((a, b) => new Date(a.startDate) - new Date(b.startDate))
        .map(g => {
            var isHome = g.homeId == teamId;
            var us = isHome ? g.homePoints : g.awayPoints;
            var them = isHome ? g.awayPoints : g.homePoints;
            return { win: Number(us) > Number(them), us, them };
        });
}

// Render team info
function renderTeamInfo(team, record, recruiting, seasonObj, schedule, owner, fantasyRank) {
    const leagueCode = window.localStorage.getItem("leagueCode");
    const container = document.getElementById("team-container");
    // Claunts = V1, Graham = V2. leagueCode is 'claunts-league'/'graham-league'
    // (never 'gg'), so the old 'gg' test always fell through to V2 and showed
    // every viewer the Graham score.
    var scoreCode = (leagueCode == 'claunts-league') ? 'cumulativeScoreV1' : 'cumulativeScoreV2';
    var formatConference = seasonObj.conference;
    var confLogo = getConferenceLogo(seasonObj.conference);

    var recruitingRank = (recruiting?.rank != null) ? `#${recruiting.rank}` : '—';
    var seasonScore = (seasonObj[scoreCode] != null) ? seasonObj[scoreCode] : 0;

    // Twitter is optional; only render the link when a handle exists (otherwise
    // the old code printed the literal text "null" linking to twitter.com/null).
    var handle = team.twitter ? String(team.twitter).replace(/^@/, '') : '';
    var twitterHtml = handle
        ? `<a class="team-twitter" href="https://twitter.com/${handle}" target="_blank" rel="noopener noreferrer">@${handle}</a>`
        : '';

    // Stadium fields are individually optional in the schema; guard each.
    var loc = team.location || {};
    var capacity = (loc.capacity != null) ? loc.capacity.toLocaleString() : null;
    var stadiumChips = [];
    if (loc.year_constructed) stadiumChips.push(`Built ${loc.year_constructed}`);
    if (capacity) stadiumChips.push(`${capacity} seats`);
    if (loc.grass === true) stadiumChips.push('Grass');
    if (loc.grass === false) stadiumChips.push('Turf');
    if (loc.dome === true) stadiumChips.push('Dome');
    if (loc.elevation) stadiumChips.push(`${Math.round(Number(loc.elevation)).toLocaleString()} ft`);

    // Win/loss form strip + expected-wins comparison.
    var form = computeForm(schedule, team.id);
    var wins = record?.total?.wins ?? form.filter(f => f.win).length;
    var expected = seasonObj.expectedWins;
    var formStrip = form.slice(-6).map(f =>
        `<span class="form-dot ${f.win ? 'form-win' : 'form-loss'}" title="${f.us}-${f.them}">${f.win ? 'W' : 'L'}</span>`
    ).join('');

    var expectedHtml = (expected != null)
        ? `<p class="score expected-wins">${wins} actual vs ${Number(expected).toFixed(1)} expected
             <span class="ew-delta ${wins - expected >= 0 ? 'ew-up' : 'ew-down'}">
                ${wins - expected >= 0 ? '▲' : '▼'} ${Math.abs(wins - expected).toFixed(1)}
             </span></p>`
        : '';

    // "Drafted by" — ties the team back to its fantasy manager for the season.
    var ownerHtml = owner
        ? `<a class="team-owner" href="/userHome?user=${owner.userId}">
               <i class="fa-solid fa-user-group"></i>
               <span>${owner.franchiseName || owner.name || 'a manager'}</span>
           </a>`
        : `<span class="team-owner team-owner--undrafted"><i class="fa-solid fa-user-slash"></i> Undrafted</span>`;

    // National fantasy-scoring rank alongside the raw point total.
    var rankHtml = fantasyRank
        ? `<span class="fantasy-rank">#${fantasyRank.rank} of ${fantasyRank.total}</span>`
        : '';

    // Set the tab title to the team being viewed.
    document.title = `${team.school} ${team.mascot} · Campus Clash`;

    const html = `

        <div class="team-header">
            <img class="team-logo" src="${team.logos.at(-1)}" alt="${team.school}" />
            <div class="team-meta">
            <div class="team-name-row">
                <h2 class="team-name">${team.school} ${team.mascot}</h2>
                ${renderSeasonSelector(team.seasons, seasonObj.season)}
            </div>
            <p class="team-conf"><img class="conf-logo" src="${confLogo}" alt="${formatConference}" /> ${formatConference}</p>
            <div class="team-meta-links">${twitterHtml}${ownerHtml}</div>
            ${formStrip ? `<div class="form-strip" title="Most recent results">${formStrip}</div>` : ''}
            </div>
        </div>

        <hr class="divider" />

        <div class="team-details">
            <div>
                <h4>${seasonObj.season} Record</h4>
                <p class="score">${record?.total?.wins || 0}-${record?.total?.losses || 0}    Overall</p>
                <p class="score">${record?.conferenceGames?.wins || 0}-${record?.conferenceGames?.losses || 0}    Conference</p>
                ${expectedHtml}
            </div>
            <div>
                <h4>📈 Season Score</h4>
                <p class="score">${seasonScore} Points ${rankHtml}</p>
                <h4>Recruiting Rank</h4>
                <p class="score">${recruitingRank}</p>
            </div>
            <div>
                <h4>🏟 Stadium</h4>
                <p>${loc.name || '—'}</p>
                ${(loc.city && loc.state) ? `<p><small>${loc.city}, ${loc.state}</small></p>` : ''}
                ${stadiumChips.length ? `<div class="stadium-chips">${stadiumChips.map(c => `<span class="chip">${c}</span>`).join('')}</div>` : ''}
            </div>
        </div>

        ${renderWeeklyScores(seasonObj, scoreCode)}
    `;

    container.innerHTML = html;
}

// Weekly points bar chart from the season's weeklyScore[] (previously collected
// but never shown; the .weekly-scores/.score-grid styles already existed).
function renderWeeklyScores(seasonObj, scoreCode) {
    var weekly = Array.isArray(seasonObj.weeklyScore) ? seasonObj.weeklyScore : [];
    if (!weekly.length) return '';

    var key = (scoreCode == 'cumulativeScoreV1') ? 'scoreV1' : 'scoreV2';
    var values = weekly.map(w => Number(w[key]) || 0);
    var max = Math.max(...values, 1);

    var bars = weekly.map((w, i) => {
        var v = values[i];
        var pct = Math.max(4, Math.round((v / max) * 100));
        var label = (w.seasonType && w.seasonType !== 'regular') ? 'P' + w.week : 'W' + w.week;
        return `
            <div class="week-bar" title="Week ${w.week}: ${v} pts">
                <span class="week-bar-value">${v}</span>
                <span class="week-bar-fill" style="height:${pct}%"></span>
                <span class="week-bar-label">${label}</span>
            </div>
        `;
    }).join('');

    return `
        <div class="weekly-scores">
            <h4>📊 Weekly Points</h4>
            <div class="week-bars">${bars}</div>
        </div>
    `;
}

// Render schedule info
function renderTeamScheduleInfo(schedule, logos, rankings, bettingLines, year, teamData) {
    const container = document.getElementById("schedule-container");
    const teamId = teamData?.id;

    var nextGameHtml = renderNextGame(schedule, logos, teamId);

    var html = `
        <div class="schedule-head">
            <h2><i class="fa-solid fa-calendar-days fa-rank-stand"></i>${year} Schedule</h2>
            <i class="fa-solid fa-caret-down drop"></i>
        </div>
        ${nextGameHtml}
        <div class="games-container">
    `;

    if (schedule != null && schedule.length > 0) {
        schedule.sort((a, b) => {
            return new Date(a.startDate) - new Date(b.startDate);
        });

        schedule.forEach(game => {
            var homePoints = '';
            var awayPoints = '';

            var bettingLineObj = bettingLines.find(bettingObj => bettingObj.homeTeam == game.homeTeam && bettingObj.awayTeam == game.awayTeam)?.lines;

            var awayLine = '';
            var homeLine = '';

            if(bettingLineObj?.length > 0 && bettingLineObj != null) {
                var providerLine = bettingLineObj.find(line => line.provider == "DraftKings") || bettingLineObj[0];
                // formattedSpread looks like "Georgia -7.5"; guard a missing /
                // malformed value so one bad line can't break the whole render.
                var spread = providerLine?.formattedSpread;
                if (typeof spread === 'string' && spread.includes('-')) {
                    var idx = spread.lastIndexOf('-');
                    var favTeam = spread.slice(0, idx).trim();
                    var number = spread.slice(idx + 1).trim();
                    awayLine = (favTeam == game.awayTeam) ? number : '';
                    homeLine = (favTeam == game.homeTeam) ? number : '';
                }
            }

            var homeLogo = logos.find((team) => team.id == game.homeId)?.logos.at(-1);
            homeLogo = homeLogo ? `<img src="${homeLogo}" alt="${game.homeTeam}">` : '<i class="fa-solid fa-helmet-un" style="padding-right: 5px;"></i>';

            var awayLogo = logos.find((team) => team.id == game.awayId)?.logos.at(-1);
            awayLogo = awayLogo ? `<img src="${awayLogo}" alt="${game.awayTeam}">` : '<i class="fa-solid fa-helmet-un" style="padding-right: 5px;"></i>';

            var pollName = 'Playoff Committee Rankings';
            if (!rankings.find(r => r.week == game.week)?.polls?.find(p => p.poll == "Playoff Committee Rankings") && game.seasonType != "postseason" ) {
                pollName = "AP Top 25";
            }

            rankings.sort((a, b) => {
                return b.week - a.week;
            });

            var weekRankings;
            if (game.seasonType == 'regular') {
                weekRankings = rankings.find(r => r.week == game.week && r.season == year) ? rankings.find(r => r.week == game.week && r.season == year)?.polls?.find(p => p.poll == pollName)?.ranks : rankings[0]?.polls?.find(p => p.poll == pollName)?.ranks;
            } else {
                weekRankings = rankings.find(r => r.week == '16' && r.season == year)?.polls?.find(p => p.poll == pollName)?.ranks;
            }
            // A week with no loaded rankings (or a poll that lacks this team)
            // leaves weekRankings undefined; default to [] so .length/.find below
            // don't throw and the schedule still renders without ranks.
            if (!Array.isArray(weekRankings)) weekRankings = [];

            var homeRank = '';
            var awayRank = '';
            if (weekRankings.length > 0) {
                homeRank = weekRankings.find(w => w.school == game.homeTeam) ? `<span class="rank">${weekRankings.find(w => w.school == game.homeTeam)?.rank}</span>` : '';
                awayRank = weekRankings.find(w => w.school == game.awayTeam) ? `<span class="rank">${weekRankings.find(w => w.school == game.awayTeam)?.rank}</span>` : '';
            }


            if (game.completed) {
                homePoints = game.homePoints || '0';
                awayPoints = game.awayPoints || '0';
            }

            // Winner logic (compare numerically, not as strings)
            const homeIsWinner = game.completed && Number(homePoints) > Number(awayPoints);
            const awayIsWinner = game.completed && Number(awayPoints) > Number(homePoints);

            // Result badge from the VIEWED team's perspective (W/L/T + score),
            // so a completed game reads at a glance without relying on colour.
            var resultBadge = '';
            if (game.completed) {
                var teamIsHome = String(game.homeId) === String(teamId);
                var us = Number(teamIsHome ? homePoints : awayPoints);
                var them = Number(teamIsHome ? awayPoints : homePoints);
                var isTie = us === them;
                var cls = isTie ? 'result-tie' : (us > them ? 'result-win' : 'result-loss');
                var letter = isTie ? 'T' : (us > them ? 'W' : 'L');
                // Just the W/L/T (the per-team scores already show the numbers);
                // keep the exact score available on hover.
                resultBadge = `<span class="game-result ${cls}" title="${us}-${them}">${letter}</span>`;
            }

            const awayTeamHTML = `
                ${awayIsWinner ? '<strong class="game-winner">' : ''}
               <a href="/team?team=${game.awayId}">${awayLogo}${awayRank}${game.awayTeam}</a>
                ${awayIsWinner ? '</strong>' : ''}
                </span><span class="betting-line">${awayLine ? '-' + awayLine : ''}</span><span class="team-score">
                ${awayIsWinner ? '<strong class="game-winner">' : ''}
                ${awayPoints ? awayPoints : ''}
                ${awayIsWinner ? '</strong>' : ''}
                </span>
            `;

            const homeTeamHTML = `
                ${homeIsWinner ? '<strong class="game-winner">' : ''}
               <a href="/team?team=${game.homeId}">${homeLogo}${homeRank}${game.homeTeam}</a>
                ${homeIsWinner ? '</strong>' : ''}
                </span><span class="betting-line">${homeLine ? '-' + homeLine : ''}</span><span class="team-score">
                ${homeIsWinner ? '<strong class="game-winner">' : ''}
                ${homePoints ? homePoints : ''}
                ${homeIsWinner ? '</strong>' : ''}
                </span>
            `;

            html += `
                <div class="game-row">
                    <div class="game-info">
                        <div class="team-row">
                            <span class="team-vs">${awayTeamHTML}
                        </div>
                        <div class="team-row">
                            <span class="team-vs">${homeTeamHTML}
                        </div>
                        <span class="game-date">${formatDate(game.startTimeTbd, game.startDate)}</span>
                        <span class="game-date">${game.neutralSite ? game.venue : ''}</span>
                        <span class="game-date">${game.notes ? game.notes : ''}</span>
                    </div>
                    ${resultBadge}
                </div>
            `;
        });
    }

    html += '</div>';
    container.innerHTML = html;

    const scheduleButton = document.querySelector('#schedule-container .schedule-head');

    if (scheduleButton && document.querySelector('.drop').checkVisibility()) {
        //Listener to open/close schedule
        const toggle = document.querySelector('#schedule-container .schedule-head');
        const content = document.querySelector('.games-container');

        toggle.addEventListener('click', () => {
            content.classList.toggle('active');

            if (content.classList.contains('active')) {
                document.querySelector('#schedule-container .drop').classList.add('fa-caret-up');
                document.querySelector('#schedule-container .drop').classList.remove('fa-caret-down');
            } else {
                document.querySelector('#schedule-container .drop').classList.add('fa-caret-down');
                document.querySelector('#schedule-container .drop').classList.remove('fa-caret-up');
            }
        });
    }
}

// The next upcoming (not-yet-completed) game, surfaced as a hero card above the
// collapsible schedule list.
function renderNextGame(schedule, logos, teamId) {
    if (!Array.isArray(schedule) || !schedule.length) return '';
    var upcoming = schedule
        .filter(g => !g.completed)
        .sort((a, b) => new Date(a.startDate) - new Date(b.startDate));
    var game = upcoming[0];
    if (!game) return '';

    var isHome = game.homeId == teamId;
    var oppName = isHome ? game.awayTeam : game.homeTeam;
    var oppId = isHome ? game.awayId : game.homeId;
    var oppLogoUrl = logos.find(t => t.id == oppId)?.logos.at(-1);
    var oppLogo = oppLogoUrl ? `<img src="${oppLogoUrl}" alt="${oppName}">` : '<i class="fa-solid fa-helmet-un"></i>';
    var prefix = game.neutralSite ? 'vs' : (isHome ? 'vs' : '@');

    return `
        <a class="next-game" href="/team?team=${oppId}">
            <span class="next-game-tag">Next Up</span>
            <div class="next-game-body">
                <span class="next-game-opp">${oppLogo} ${prefix} ${oppName}</span>
                <span class="next-game-date">${formatDate(game.startTimeTbd, game.startDate)}</span>
                ${game.neutralSite && game.venue ? `<span class="next-game-venue">${game.venue}</span>` : ''}
            </div>
        </a>
    `;
}

async function renderConferenceStandings(data, teamData, logos, conference) {
    // Filter for specified conference
    var standings = [];
    var conferenceTeams = await getConferenceTeams(conference);
    conferenceTeams.sort((a,b) => {
        return a.school.toLowerCase().localeCompare(b.school.toLowerCase());
    });
    standings = conferenceTeams.map(team => ({
            ...team,
            team: team.school,
            teamId: team.id,
            conferenceGames: {
                games: 0,
                wins: 0,
                losses: 0,
                ties: 0,
            },
            total: {
                games: 0,
                wins: 0,
                losses: 0,
                ties: 0,
            }
        }));
    if (data.message?.startsWith("No conference records")){

    } else {

        // Create a map for quick lookup by teamId
        const dataMap = new Map(data.map(item => [item.teamId, item]));

        // Replace matching objects in standings
        const updatedStandings = standings.map(team => {
            return dataMap.get(team.teamId) || team;
        });

        // Sort: conference wins → overall wins → overall losses
        updatedStandings.sort((a, b) => {
            if (b.conferenceGames.wins !== a.conferenceGames.wins) {
            return b.conferenceGames.wins - a.conferenceGames.wins;
            }
            if (b.total.wins !== a.total.wins) {
            return b.total.wins - a.total.wins;
            }
            return a.total.losses - b.total.losses;
        });

        standings = updatedStandings;
    }

    if (standings.length > 0 && conference != 'FBS Independents') {
        // Build table HTML
        let html = `
            <div class="standing-head">
                <h2><i class="fa-solid fa-ranking-star fa-rank-stand"></i>${data[0]?.conference || conference} Standings</h2>
                <i class="fa-solid fa-caret-down drop"></i>
            </div>
            <table class="standings-table">
                <thead>
                    <tr>
                        <th class="standingColumn">Rank</th>
                        <th class="standingColumn">Team</th>
                        <th class="standingColumn">Conf</th>
                        <th class="standingColumn">Overall</th>
                    </tr>
                </thead>
                <tbody>
        `;

        standings.forEach((team, index) => {
            var teamLogo = logos.find((logo) => logo.id == team.teamId)?.logos.at(-1);
            teamLogo = teamLogo ? `<img src="${teamLogo}" alt="${team.mascot}">` : '<i class="fa-solid fa-helmet-un" style="padding-right: 5px;"></i>';

            var isViewedTeam = team.team == teamData.school;
            var boldCls = isViewedTeam ? ' boldTeam' : '';

            // Logo and name are their own flex columns so a long name (e.g.
            // "Georgia Tech", "Florida State") wraps beside the logo, centered,
            // instead of dropping onto a second line underneath it.
            var rankHtml = isViewedTeam ? `<strong class="boldTeam">${index + 1}</strong>` : (index + 1);
            var teamHtml = `<span class="standings-team"><span class="standings-team-logo">${teamLogo}</span><span class="standings-team-name${boldCls}">${team.team}</span></span>`;
            var confHtml = isViewedTeam
                ? `<strong class="boldTeam">${team.conferenceGames.wins} - ${team.conferenceGames.losses}</strong>`
                : `${team.conferenceGames.wins}-${team.conferenceGames.losses}`;
            var ovrHtml = isViewedTeam
                ? `<strong class="boldTeam">${team.total.wins} - ${team.total.losses}</strong>`
                : `${team.total.wins}-${team.total.losses}`;

            html += `
                <tr class="${isViewedTeam ? 'viewed-team-row' : ''}">
                    <td class="standingColumn">${rankHtml}</td>
                    <td class="standingColumn"><a href="/team?team=${team.teamId}">${teamHtml}</a></td>
                    <td class="standingColumn">${confHtml}</td>
                    <td class="standingColumn">${ovrHtml}</td>
                </tr>
            `;
        });

        html += `
                </tbody>
            </table>
        `;

        // Render to DOM
        const container = document.getElementById('conference-standings');
        if (container) {
            container.innerHTML = html;

            const standingsButton = document.querySelector('#conference-standings .standing-head');

            if (standingsButton) {
                //Listener to open/close standings
                const toggle = document.querySelector('#conference-standings .standing-head');
                const content = document.querySelector('.standings-table');

                toggle.addEventListener('click', () => {
                    content.classList.toggle('active');

                    if (content.classList.contains('active')) {
                        document.querySelector('#conference-standings .drop').classList.add('fa-caret-up');
                        document.querySelector('#conference-standings .drop').classList.remove('fa-caret-down');
                    } else {
                        document.querySelector('#conference-standings .drop').classList.add('fa-caret-down');
                        document.querySelector('#conference-standings .drop').classList.remove('fa-caret-up');
                    }
                });
            }
        } else {
            console.warn("Missing container with id 'conference-standings'");
        }
    } else {
        const container = document.getElementById('conference-standings');
        container.style.display = 'none';

        const scheduleContainer = document.getElementById('schedule-container');
        scheduleContainer.style.width = '100%';
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

// Helper: Format the date to readable format
function formatDate(isTbd, dateStr) {
  const date = new Date(dateStr);

  if (isTbd) {
    var formatDate = date.toLocaleString(undefined, {
        month: 'numeric',
        day: 'numeric',         // "30"
    });

    return formatDate + " TBD";
  } else {
    return date.toLocaleString(undefined, {
        month: 'numeric',
        day: 'numeric',         // "30"
        hour: 'numeric',        // "1"
        minute: '2-digit',      // "00"
        hour12: true            // AM/PM
    });
  }
}

function setNavbarUserId() {
    var userId = userState.user_metadata.metadata.userId || null;

    if (userId == null) {
        userId = window.localStorage.getItem("userId");
    }

    const toggleButton = document.querySelector('.toggle-button');
    const navbarLinks = document.querySelector('.navbar-links');
    const myLink = document.querySelector('[user-home]');

    if (toggleButton && navbarLinks && myLink) {
        myLink.href = `/userHome?user=${userId}`;
    } else {
        // Retry after 500ms if elements aren't in the DOM yet
        setTimeout(setNavbarUserId, 500);
    }
}
