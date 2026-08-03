// Pure, DB-free per-manager weekly recap — a personal "here's your week" card.
// It's the same math the League Highlights use (public/standings-insights.js),
// scoped to ONE manager and ONE week: weekly score, league rank + movement,
// margin vs the league average, the roster's MVP team, and a one-line
// narrative. routes/standings.js gathers the league's per-season data (and an
// optional upset index) and hands it here. Kept DB-free so it's unit-testable
// AND so a future weekly-recap EMAIL job can reuse it verbatim — no rework.

const { pickLogo } = require('../public/logo.js');

function ordinal(n) {
    const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
const round = (v) => Math.round((v || 0) * 10) / 10;

// Effective week number so a postseason entry always sorts after Week 16.
// weeklyScore[].season is overloaded as a type tag ('postseason'); some data
// also just uses week > 16.
function effWeek(entry) {
    if (!entry) return 0;
    if (entry.season === 'postseason' || entry.week > 16) return 17;
    return entry.week;
}
function weekLabel(entry) {
    if (!entry) return '';
    return effWeek(entry) === 17 ? 'Postseason' : 'Week ' + entry.week;
}
function seasonOf(user, season) {
    return (user && user.seasons || []).find(s => String(s.season) === String(season)) || null;
}
// Cumulative points through effective-week W (inclusive) — matches how the
// season total is summed, but bounded by week.
function cumThrough(weekly, W) {
    return (weekly || []).reduce((sum, e) => effWeek(e) <= W ? sum + (e.score || 0) : sum, 0);
}
// Rank (1 = best) of userId among the league by cumulative-through-W. Null if
// the user isn't in the set.
// Standard competition ranking (1 + managers strictly ahead) so ties SHARE a
// rank instead of getting arbitrary DB-order placements. Returns { rank, tie }
// (tie = another manager holds the exact same total), or null if not found.
function rankAt(leagueSeasons, W, userId) {
    const mine = leagueSeasons.find(ls => String(ls.userId) === String(userId));
    if (!mine) return null;
    const myCum = cumThrough(mine.weekly, W);
    let ahead = 0, shared = 0;
    leagueSeasons.forEach(ls => {
        const c = cumThrough(ls.weekly, W);
        if (c > myCum) ahead += 1;
        else if (c === myCum && String(ls.userId) !== String(userId)) shared += 1;
    });
    return { rank: ahead + 1, tie: shared > 0 };
}

// Index completed regular-season games to underdog-winner info, keyed by
// gameId, for the layered "upset" narrative. spreadByGameId is the home
// spread (CFBD convention: a POSITIVE home spread means the home team was the
// underdog by that many points). Only games the underdog actually won land in
// the index. rankByWeek (optional) is { [week]: { [school]: apRank } } — the AP
// poll the loser held entering that week, so the narrative can read "upset of
// #3 Georgia". Mirrors modules/standings-highlights.js biggestUpsetCard.
function indexUpsets(games, spreadByGameId, rankByWeek) {
    const out = {};
    (games || []).forEach(g => {
        if (!g.completed) return;
        const homeWon = g.homePoints > g.awayPoints;
        const awayWon = g.awayPoints > g.homePoints;
        if (!homeWon && !awayWon) return;
        const spread = spreadByGameId ? spreadByGameId[g.id] : undefined;
        if (spread == null) return;
        const margin = homeWon ? (spread > 0 ? spread : null) : (spread < 0 ? -spread : null);
        if (margin == null || margin <= 0) return;
        const loser = homeWon ? g.awayTeam : g.homeTeam;
        const wk = rankByWeek && g.week != null ? rankByWeek[g.week] : null;
        out[g.id] = {
            winner: homeWon ? g.homeTeam : g.awayTeam,
            loser,
            loserRank: (wk && wk[loser] != null) ? wk[loser] : null,
            margin: round(margin),
            winScore: homeWon ? g.homePoints : g.awayPoints,
            loseScore: homeWon ? g.awayPoints : g.homePoints
        };
    });
    return out;
}

// The one-line story. Deterministic and rule-based (the reliable base); when a
// rostered team won as a betting underdog that week, the upset flavor takes
// over ("Oregon's upset over Georgia as a 10.5-pt underdog powered your week").
function narrate({ score, rank, rankDelta, rankTie, vsLeagueAvg, mvp, upset }) {
    const place = rank != null ? (rankTie ? 'T-' : '') + ordinal(rank) : null;
    const move = rankDelta == null ? null
        : rankDelta > 0 ? `climbed ${rankDelta} spot${rankDelta > 1 ? 's' : ''}`
        : rankDelta < 0 ? `slipped ${-rankDelta} spot${-rankDelta > 1 ? 's' : ''}`
        : 'held steady';
    const moved = move && rankDelta; // truthy only on an actual climb/slip

    if (score <= 0 && (!mvp || mvp.score <= 0)) return 'Quiet week — no points banked.';

    // Layered: an underdog win on your roster is the story worth telling.
    if (upset) {
        const foe = upset.loser ? `${upset.loserRank ? '#' + upset.loserRank + ' ' : ''}${upset.loser}` : '';
        const beat = foe ? ` over ${foe}` : '';
        const dog = upset.margin ? ` as a ${upset.margin}-pt underdog` : '';
        const tail = place ? (moved ? `, ${move} to ${place}` : `, good for ${place}`) : '';
        return `${upset.team}'s upset${beat}${dog} powered your ${score}-pt week${tail}.`;
    }

    const avg = vsLeagueAvg == null ? ''
        : vsLeagueAvg > 0 ? `, ${vsLeagueAvg} above the league average`
        : vsLeagueAvg < 0 ? `, ${-vsLeagueAvg} below the league average`
        : ', right on the league average';
    const lead = mvp && mvp.score > 0 ? `${mvp.school}'s ${mvp.score} pts led the way` : `${score} pts`;
    if (moved) return `${lead} as you ${move} to ${place}${avg}.`;
    return `${lead}${avg}${place ? ` — holding at ${place}` : ''}.`;
}

// Build one recap object per week the manager has played, oldest → newest.
//   user         — the profile user's full doc (all seasons)
//   leagueUsers  — every user in the league (full docs) for rank + average
//   season       — the season to recap (number or string)
//   upsetByGameId — optional output of indexUpsets(), for the upset narrative
function buildWeeklyRecaps({ user, leagueUsers, season, upsetByGameId }) {
    const mySeason = seasonOf(user, season);
    const result = { userId: String(user && user._id), season: Number(season), recaps: [] };
    if (!mySeason || !(mySeason.weeklyScore || []).length) return result;

    const leagueSeasons = (leagueUsers || [])
        .map(u => { const s = seasonOf(u, season); return s ? { userId: String(u._id), weekly: s.weeklyScore || [] } : null; })
        .filter(Boolean);

    // Roster meta by school name (scoreByTeam[].team is the school string).
    const metaBySchool = {};
    (mySeason.teams || []).forEach(t => { metaBySchool[t.school] = t; });
    const logoFor = (school) => {
        const m = metaBySchool[school];
        return (m && pickLogo(m.logos)) || null;
    };

    // Distinct effective weeks across the whole league, ascending — so "the
    // previous week" for rank movement is the real prior week, not W-1 (which
    // may not exist).
    const weekSet = new Set();
    leagueSeasons.forEach(ls => ls.weekly.forEach(e => weekSet.add(effWeek(e))));
    const weeksAsc = [...weekSet].sort((a, b) => a - b);

    // Per-week league stats (average / high / low) so slides can call out
    // "top score of the week", the margin vs average, streaks, etc.
    const weekStats = {};
    weeksAsc.forEach(W => {
        const arr = [];
        leagueSeasons.forEach(ls => {
            // One sample PER MANAGER (summed across any games/entries that week),
            // so a manager with multiple entries in a week isn't double-counted.
            let sum = 0, played = false;
            ls.weekly.forEach(e => { if (effWeek(e) === W) { sum += (e.score || 0); played = true; } });
            if (played) arr.push(sum);
        });
        weekStats[W] = {
            avg: arr.length ? round(arr.reduce((s, v) => s + v, 0) / arr.length) : null,
            max: arr.length ? round(Math.max(...arr)) : null,
            min: arr.length ? round(Math.min(...arr)) : null,
            count: arr.length
        };
    });

    // Fold entries that share an effective week (e.g. multiple postseason rounds
    // both tagged 'postseason') into one, so each week yields exactly one recap.
    const byEff = new Map();
    (mySeason.weeklyScore || []).forEach(e => {
        const W = effWeek(e);
        if (!byEff.has(W)) byEff.set(W, { week: e.week, season: e.season, score: 0, scoreByTeam: [] });
        const agg = byEff.get(W);
        agg.score += (e.score || 0);
        (e.scoreByTeam || []).forEach(st => agg.scoreByTeam.push(st));
    });
    const myWeekly = [...byEff.values()].sort((a, b) => effWeek(a) - effWeek(b));
    // Running state for the "momentum" slide (season high, streaks, milestones).
    let runningMax = -Infinity, runningTotal = 0, aboveStreak = 0, belowStreak = 0, regularWeeksSeen = 0;

    result.recaps = myWeekly.map(entry => {
        const W = effWeek(entry);
        const wi = weeksAsc.indexOf(W);
        const prevW = wi > 0 ? weeksAsc[wi - 1] : null;
        const score = round(entry.score || 0);
        const stats = weekStats[W] || {};

        const rankInfo = rankAt(leagueSeasons, W, user._id);
        const rank = rankInfo ? rankInfo.rank : null;
        const rankTie = rankInfo ? rankInfo.tie : false;
        const prevInfo = prevW != null ? rankAt(leagueSeasons, prevW, user._id) : null;
        const prevRank = prevInfo ? prevInfo.rank : null;
        const rankDelta = (rank != null && prevRank != null) ? (prevRank - rank) : null; // + = climbed

        const leagueAvg = stats.avg;
        const vsLeagueAvg = leagueAvg != null ? round(score - leagueAvg) : null;
        // stats.max/min are rounded to match `score`; small epsilon guards floats.
        const weekHigh = stats.count > 1 && stats.max != null && score >= stats.max - 0.05 && score > 0;
        const weekLow = stats.count > 1 && stats.min != null && score <= stats.min + 0.05;

        // MVP + dud among this week's roster teams. Sum per team first — a team
        // can appear multiple times in one entry (e.g. several postseason games),
        // so the MVP is a team's total for the week, not a single game.
        const teamAgg = {};
        (entry.scoreByTeam || []).forEach(st => {
            const t = teamAgg[st.team] || (teamAgg[st.team] = { school: st.team, score: 0, logo: logoFor(st.team) });
            t.score = round(t.score + (st.score || 0));
        });
        const teams = Object.values(teamAgg);
        let mvp = null, dud = null;
        teams.forEach(t => {
            if (!mvp || t.score > mvp.score) mvp = t;
            if (!dud || t.score < dud.score) dud = t;
        });
        const teamCount = teams.length;
        // All teams tied for the week's best (so co-MVPs surface together).
        const mvpTeams = mvp ? teams.filter(t => t.score === mvp.score) : [];
        const mvpShare = (mvp && score > 0) ? Math.round((mvp.score / score) * 100) : null;
        // Only call out a "dud" when there's real spread on the roster.
        const dudTeam = (dud && teamCount > 1 && mvp && dud.score < mvp.score) ? dud : null;

        // Upset flavor: the biggest-underdog win among this week's roster games.
        let upset = null;
        if (upsetByGameId) {
            (entry.scoreByTeam || []).forEach(st => {
                const u = st.gameId != null ? upsetByGameId[st.gameId] : null;
                if (u && u.winner === st.team && (!upset || u.margin > upset.margin)) {
                    upset = { team: st.team, loser: u.loser, loserRank: u.loserRank, margin: u.margin, fantasy: round(st.score || 0), logo: logoFor(st.team) };
                }
            });
        }

        // Momentum. "Season high" compares REGULAR-season weeks only — the
        // postseason is expected to be the biggest week (bonuses stack across
        // several games), so calling it a new high isn't real news. The finale
        // gets its own season-wrap beat instead (see buildSlides).
        runningTotal += score;
        const isRegularWeek = W <= 16;
        // "New high" only when the manager has a PRIOR regular week of their own
        // to beat — gate on their own played-week count, not the league index wi
        // (a manager whose first scored week isn't the league's earliest would
        // otherwise get a bogus season-high on week one).
        const isSeasonHigh = isRegularWeek && regularWeeksSeen > 0 && score > 0 && score > runningMax;
        if (isRegularWeek) { runningMax = Math.max(runningMax, score); regularWeeksSeen += 1; }
        if (vsLeagueAvg != null && vsLeagueAvg > 0) { aboveStreak += 1; belowStreak = 0; }
        else if (vsLeagueAvg != null && vsLeagueAvg < 0) { belowStreak += 1; aboveStreak = 0; }
        else { aboveStreak = 0; belowStreak = 0; }
        const prevTotal = runningTotal - score;                           // largest ×50 crossed this week
        const topMultiple = Math.floor(runningTotal / 50) * 50;
        const milestone = (topMultiple >= 50 && topMultiple > prevTotal) ? topMultiple : null;

        const recap = {
            week: entry.week, effWeek: W, label: weekLabel(entry),
            score, rank, rankDelta, rankTie, leagueAvg, vsLeagueAvg, weekHigh, weekLow,
            mvpTeam: mvp, mvpTeams, mvpShare, dudTeam, isUpset: !!upset, upset,
            isSeasonHigh, aboveAvgStreak: aboveStreak, belowAvgStreak: belowStreak,
            cumTotal: round(runningTotal), milestone,
            narrative: narrate({ score, rank, rankDelta, rankTie, vsLeagueAvg, mvp, upset })
        };
        recap.slides = buildSlides(recap);
        return recap;
    });

    return result;
}

// Turn one enriched recap into an ordered deck of one-idea-per-slide "story"
// beats for the popup carousel. Slides only appear when they have something to
// say (like the League Highlights cards), so a quiet week stays short. Shape
// per slide: { id, icon, kicker, title, big?, logo?, text?, sub?, tone, cta? }.
function buildSlides(r) {
    const slides = [];
    const place = r.rank != null ? (r.rankTie ? 'T-' : '') + ordinal(r.rank) : null;

    // Hook — the week + headline score.
    slides.push({ id: 'hook', icon: 'flame', kicker: 'Weekly Recap', title: r.label, big: String(r.score), sub: 'points banked', tone: 'neutral' });

    // Rank + movement.
    if (r.rank != null) {
        const moveSub = r.rankDelta == null ? 'your first week on the board'
            : r.rankDelta > 0 ? `up ${r.rankDelta} spot${r.rankDelta > 1 ? 's' : ''} from last week`
            : r.rankDelta < 0 ? `down ${-r.rankDelta} spot${-r.rankDelta > 1 ? 's' : ''} from last week`
            : 'held your ground';
        slides.push({ id: 'rank', icon: r.rankDelta > 0 ? 'riser' : 'chart', kicker: 'Where you stand', title: 'League rank', big: place, sub: moveSub, tone: r.rankDelta > 0 ? 'good' : (r.rankDelta < 0 ? 'bad' : 'neutral') });
    }

    // Top / bottom of the week (league-wide bragging rights or humbling).
    if (r.weekHigh) slides.push({ id: 'weekhigh', icon: 'trophy', kicker: 'Bragging rights', title: 'Top score of the week', big: String(r.score), sub: 'nobody in the league scored more', tone: 'good' });
    else if (r.weekLow) slides.push({ id: 'weeklow', icon: 'heartbreak', kicker: 'Oof', title: 'Low score of the week', big: String(r.score), sub: 'league-low this week — it happens', tone: 'bad' });

    // Margin vs the field.
    if (r.vsLeagueAvg != null) {
        slides.push({ id: 'vsavg', icon: 'target', kicker: 'vs the field', title: 'League average', big: (r.vsLeagueAvg > 0 ? '+' : '') + r.vsLeagueAvg, sub: `you ${r.score} · league avg ${r.leagueAvg}`, tone: r.vsLeagueAvg > 0 ? 'good' : (r.vsLeagueAvg < 0 ? 'bad' : 'neutral') });
    }

    // MVP spotlight (co-MVPs when teams tie for the week's best).
    if (r.mvpTeam && r.mvpTeam.score > 0) {
        const tied = (r.mvpTeams && r.mvpTeams.length) ? r.mvpTeams : [r.mvpTeam];
        const isTie = tied.length > 1;
        slides.push({
            id: 'mvp', icon: 'medal',
            kicker: isTie ? 'Co-MVPs' : 'Your MVP',
            title: tied.map(t => t.school).join(' & '),
            big: String(r.mvpTeam.score),
            logos: tied.map(t => t.logo).filter(Boolean),
            sub: isTie ? `${r.mvpTeam.score} pts each` : (r.mvpShare != null ? `${r.mvpShare}% of your points` : 'top team this week'),
            tone: 'good'
        });
    }

    // The dud.
    if (r.dudTeam) {
        slides.push({ id: 'dud', icon: 'snowflake', kicker: 'The dud', title: r.dudTeam.school, big: String(r.dudTeam.score), logo: r.dudTeam.logo, sub: 'quietest team on your roster', tone: 'bad' });
    }

    // The upset (with AP rank when the loser was ranked).
    if (r.upset) {
        const foe = `${r.upset.loserRank ? '#' + r.upset.loserRank + ' ' : ''}${r.upset.loser}`;
        slides.push({ id: 'upset', icon: 'dice', kicker: 'Upset alert', title: r.upset.team, big: 'UPSET', logo: r.upset.logo, sub: `beat ${foe} as a ${r.upset.margin}-pt underdog`, tone: 'good' });
    }

    // Momentum — a single beat. On the finale, wrap the season (the postseason
    // being your biggest week is expected, not a "new high"). Otherwise:
    // season high › milestone › hot streak › cold streak.
    if (r.effWeek === 17) slides.push({ id: 'seasonwrap', icon: 'star', kicker: 'Season in the books', title: 'Season total', big: String(r.cumTotal), sub: place ? `${place} place — that's a wrap` : "that's a wrap on the season", tone: 'good' });
    else if (r.isSeasonHigh) slides.push({ id: 'seasonhigh', icon: 'burst', kicker: 'Personal best', title: 'New season high!', big: String(r.score), sub: 'your biggest week yet', tone: 'good' });
    else if (r.milestone) slides.push({ id: 'milestone', icon: 'star', kicker: 'Milestone', title: `${r.milestone} points`, big: String(r.cumTotal), sub: 'season total and climbing', tone: 'good' });
    else if (r.aboveAvgStreak >= 2) slides.push({ id: 'streak', icon: 'flame', kicker: 'On a heater', title: `${r.aboveAvgStreak} weeks hot`, big: '🔥', sub: `${r.aboveAvgStreak} straight weeks above the league average`, tone: 'good' });
    else if (r.belowAvgStreak >= 2) slides.push({ id: 'coldstreak', icon: 'snowflake', kicker: 'Cold stretch', title: `${r.belowAvgStreak} weeks cold`, big: '❄️', sub: `${r.belowAvgStreak} straight weeks below average — bounce-back time`, tone: 'bad' });

    // Closing — the one-line story + the CTA.
    slides.push({ id: 'closing', icon: 'checkered', kicker: 'The story', title: 'Your week', text: r.narrative, tone: 'neutral', cta: true });

    return slides;
}

// ---- Weekly-popup gating (mirrored in public/weekly-recap.js) --------------
// The recap popup fires once per "recap week", which opens each Monday 07:00
// local — by then the weekend's scoring jobs have finalized the week. The key
// is the ISO date of that Monday-07:00 boundary; the client stores the last
// key it showed and only pops when the current key differs.
function recapWindowKey(date) {
    const d = new Date(date.getTime());
    const sinceMonday = (d.getDay() + 6) % 7;       // 0 = Mon … 6 = Sun
    const boundary = new Date(d.getFullYear(), d.getMonth(), d.getDate() - sinceMonday, 7, 0, 0, 0);
    if (d < boundary) boundary.setDate(boundary.getDate() - 7);   // before Mon 7am → last week's
    const y = boundary.getFullYear(), m = String(boundary.getMonth() + 1).padStart(2, '0'), day = String(boundary.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}
// Only nudge during the CFB season window (Aug–Jan) so the popup doesn't nag
// through the offseason; the recap stays available on My Team year-round.
function isRecapSeason(date) {
    const m = date.getMonth() + 1;
    return m >= 8 || m === 1;
}

module.exports = { buildWeeklyRecaps, buildSlides, indexUpsets, narrate, effWeek, weekLabel, cumThrough, rankAt, recapWindowKey, isRecapSeason };
