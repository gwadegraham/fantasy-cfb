// Game-day scoreboard: the whole FBS slate for a week, kickoff-ordered, with
// the league's drafted teams badged with their owner and live fantasy points.
//
// The server does the joining (GET /games/scoreboard/:league/:season/:week);
// this file owns three things the server can't: the filter chips, the day
// grouping, and the refresh loop.

var sbState = {
    week: null,
    weeks: [],
    weekRange: null,
    games: [],
    filter: 'all',
    conf: '',
    liveCount: 0,
    timer: null
};

// Refresh cadence. The live poller writes new scores every 2 minutes, so
// polling faster than that only burns requests to re-read the same numbers —
// 30s is "at most 30s behind the truth we have". With nothing in progress
// there's nothing to be behind, so we back off hard.
var LIVE_MS = 30000;
var IDLE_MS = 300000;

function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
}

function sbApi(url) {
    return fetch(url, { headers: { Accept: 'application/json' } }).then(function (r) {
        if (!r.ok) throw new Error('Request failed: ' + r.status);
        return r.json();
    });
}

// ---- formatting -------------------------------------------------------------

function kickoff(startDate, tbd) {
    if (tbd) return 'TBD';
    var d = new Date(startDate);
    if (isNaN(d)) return '';
    return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function dayKey(startDate) {
    var d = new Date(startDate);
    if (isNaN(d)) return 'TBD';
    return d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
}

// Q3 8:42 / OT. Periods past 4 are overtime — CFBD keeps counting (5 = OT1).
function clockLabel(game) {
    if (game.period == null) return 'Live';
    var qtr = game.period <= 4 ? 'Q' + game.period : 'OT' + (game.period > 5 ? game.period - 4 : '');
    return game.clock ? qtr + ' ' + game.clock : qtr;
}

function stateLabel(game) {
    if (game.state === 'final') return 'Final';
    if (game.state === 'live') return clockLabel(game);
    return kickoff(game.startDate, game.startTimeTbd);
}

// ---- rendering --------------------------------------------------------------

// The manager's profile picture when they've set one, initials otherwise —
// the same fallback every other manager surface uses (standings, h2h-card,
// draft room). Cloudinary is asked for a face-cropped 48px so a 18px chip on a
// retina screen isn't downloading the full upload.
function ownerAvatarHtml(o) {
    if (o.avatarUrl) {
        var src = o.avatarUrl.indexOf('/upload/') !== -1
            ? o.avatarUrl.replace('/upload/', '/upload/c_fill,g_face,w_48,h_48,q_auto,f_auto/')
            : o.avatarUrl;
        return '<span class="sb-owner-chip"><img src="' + esc(src) + '" alt=""></span>';
    }
    var style = o.color ? ' style="background:' + esc(o.color) + '"' : '';
    return '<span class="sb-owner-chip sb-owner-initials"' + style + '>' + esc(o.initials) + '</span>';
}

// The avatar links to its manager, the same as every other manager surface
// (standings, h2h-card, CFP bracket, team page). It also carries the only
// answer to "whose is that?" on touch, where the title tooltip never appears.
//
// The points stay outside the link: they belong to the game, not the manager,
// and folding them in would make a 20px chip and its badge one wide target
// sitting between two others.
function ownerHtml(side) {
    var o = side.owner;
    if (!o) return '';
    var pts = (o.points != null && o.points > 0) ? '<span class="sb-owner-pts">+' + o.points + '</span>' : '';
    var label = o.franchise ? o.franchise + ' (' + o.name + ')' : o.name;
    return '<span class="sb-owner">'
        + '<a class="sb-owner-link" href="/userHome?user=' + esc(o.userId) + '"'
        + ' title="' + esc(label) + '" aria-label="' + esc(label) + '">'
        + ownerAvatarHtml(o) + '</a>' + pts + '</span>';
}

function sideHtml(side, game, isWinner) {
    var logo = side.logo
        ? '<img class="sb-logo" src="' + esc(side.logo) + '" alt="">'
        : '<i class="fa-solid fa-helmet-un sb-logo-fallback"></i>';
    var rank = side.rank ? '<span class="sb-rank">' + side.rank + '</span>' : '';
    // Records only while a game still lies ahead. The Record collection holds
    // today's record, not the one a team carried into a game five weeks ago, so
    // on a finished game it would quietly describe the wrong moment — and a
    // final score is the more interesting number anyway.
    var record = (side.record && game.state !== 'final')
        ? '<span class="sb-record">(' + esc(side.record) + ')</span>' : '';
    var poss = (game.state === 'live' && side.possession) ? '<span class="sb-poss" aria-label="Has possession">&#9679;</span>' : '';

    // The right-hand slot is the score once there is one; before kickoff it
    // carries the spread, on the row of the team laying the points. That reads
    // as "Georgia Tech is giving 7" against the team it applies to, which the
    // old meta-line version ("Georgia Tech -7 · ESPN") had to spell out.
    // On a final, the score carries a caret marking the winner — the same
    // fa-caret-left the My Team cards use. It is rendered on BOTH rows and
    // hidden on the loser's rather than omitted, so the two scores stay in one
    // column instead of the winner's shifting left by the width of the icon.
    // Brightness alone marks the winner otherwise, and colour alone is not a
    // signal everyone receives.
    var trailing;
    if (game.state === 'final') {
        trailing = (side.points != null ? side.points : '')
            + '<i class="fa-solid fa-caret-left sb-win' + (isWinner ? ' is-win' : '') + '" aria-hidden="true"></i>'
            + (isWinner ? '<span class="sb-sr">Winner</span>' : '');
    } else if (side.points != null) {
        trailing = side.points;
    } else {
        trailing = (game.state === 'pre' && side.line)
            ? '<span class="sb-line">' + esc(side.line) + '</span>' : '';
    }

    return '<div class="sb-side' + (isWinner ? ' is-winner' : '') + (side.owner ? ' is-rostered' : '') + '">'
        + logo + rank
        + '<a class="sb-team" href="/team?team=' + side.id + '">' + esc(side.team) + '</a>'
        + record + poss + ownerHtml(side)
        + '<span class="sb-score">' + trailing + '</span>'
        + '</div>';
}

function cardHtml(game) {
    var homeWon = game.state === 'final' && game.home.points > game.away.points;
    var awayWon = game.state === 'final' && game.away.points > game.home.points;

    // The spread used to live here; it now sits on the favoured team's own row
    // (see sideHtml), so the meta line is broadcast + weather only.
    var meta = [];
    if (game.outlet) meta.push(esc(game.outlet));
    if (game.weather && window.ccWeatherEmoji && window.ccWeatherEmoji[game.weather.emoji]) {
        meta.push(window.ccWeatherEmoji[game.weather.emoji]);
    }

    // A div, not an <a>. The card links to the game detail page AND each team
    // name links to that team — and an <a> inside an <a> is invalid HTML that
    // browsers "fix" by closing the outer one early, which drops every row out
    // of the card. The navigation lives in a delegated click handler instead.
    return '<div class="sb-card sb-state-' + game.state + (game.leagueGame ? ' is-league' : '') + '"'
        + ' data-game="' + game.id + '" role="link" tabindex="0"'
        + ' aria-label="' + esc(game.away.team + ' at ' + game.home.team) + '">'
        + '<div class="sb-card-head">'
        + '<span class="sb-state">' + esc(stateLabel(game)) + '</span>'
        + (meta.length ? '<span class="sb-meta">' + meta.join(' · ') + '</span>' : '')
        + '</div>'
        + sideHtml(game.away, game, awayWon)
        + sideHtml(game.home, game, homeWon)
        + '</div>';
}

// The chips filter the slate the browser already has — no refetch. A week is
// ~90 games and it all arrived in one response, so every chip is instant.
function visibleGames() {
    return sbState.games.filter(function (g) {
        if (sbState.filter === 'league' && !g.leagueGame) return false;
        if (sbState.filter === 'top25' && !g.ranked) return false;
        if (sbState.conf && g.home.conference !== sbState.conf && g.away.conference !== sbState.conf) return false;
        return true;
    });
}

function render() {
    var container = document.getElementById('scoreboard-content');
    var games = visibleGames();

    if (!games.length) {
        container.innerHTML = '<p class="sb-empty">No games match this filter.</p>';
        return;
    }

    // Games arrive kickoff-ordered, so walking them in order produces day
    // groups already in sequence — no second sort.
    var html = '';
    var currentDay = null;
    games.forEach(function (g) {
        var day = dayKey(g.startDate);
        if (day !== currentDay) {
            if (currentDay !== null) html += '</div>';
            html += '<h2 class="sb-day">' + esc(day) + '</h2><div class="sb-grid">';
            currentDay = day;
        }
        html += cardHtml(g);
    });
    if (currentDay !== null) html += '</div>';

    container.innerHTML = html;
}

// "Aug 29 - Sep 1", or a single date when the whole slate lands on one day.
function weekDateLabel(range) {
    if (!range) return '';
    var opts = { month: 'short', day: 'numeric' };
    var first = new Date(range.first);
    var last = new Date(range.last);
    if (isNaN(first) || isNaN(last)) return '';
    var a = first.toLocaleDateString('en-US', opts);
    var b = last.toLocaleDateString('en-US', opts);
    return a === b ? a : a + ' \u2013 ' + b;
}

function renderWeekNav() {
    var label = document.getElementById('week-label');
    label.textContent = sbState.week != null ? 'Week ' + sbState.week : 'No games';
    document.getElementById('week-dates').textContent = weekDateLabel(sbState.weekRange);

    var i = sbState.weeks.indexOf(sbState.week);
    document.getElementById('week-prev').disabled = i <= 0;
    document.getElementById('week-next').disabled = i < 0 || i >= sbState.weeks.length - 1;
}

// Options are { name, label }: the value stays the full conference name the
// games carry, while the label is the short form that fits the control.
function renderConfOptions(conferences) {
    var sel = document.getElementById('conf-filter');
    var keep = sel.value;
    var list = conferences || [];
    sel.innerHTML = '<option value="">Conference</option>'
        + list.map(function (c) {
            return '<option value="' + esc(c.name) + '">' + esc(c.label) + '</option>';
        }).join('');
    // A conference the new week has no games in falls back to "all" rather than
    // leaving the chip row claiming a filter that matches nothing.
    sel.value = list.some(function (c) { return c.name === keep; }) ? keep : '';
    sbState.conf = sel.value;
}

function renderLiveCount() {
    var el = document.getElementById('live-count');
    if (!sbState.liveCount) { el.hidden = true; return; }
    el.hidden = false;
    el.textContent = sbState.liveCount + (sbState.liveCount === 1 ? ' game live' : ' games live');
}

// ---- data -------------------------------------------------------------------

function sbUrl(week, live) {
    var base = '/games/scoreboard/' + LEAGUE_CODE + '/' + APP_YEAR + (week != null ? '/' + week : '');
    return base + (live ? '?live=1' : '');
}

// `jumpToCurrent` is only ever true for the first paint. A refresh that falls
// back to a full reload must NOT yank the page around under someone who is
// reading a different part of the slate.
function loadWeek(week, jumpToCurrent) {
    return sbApi(sbUrl(week, false)).then(function (data) {
        sbState.week = data.week;
        sbState.weeks = data.weeks || [];
        sbState.weekRange = data.weekRange || null;
        sbState.games = data.games || [];
        sbState.liveCount = data.liveCount || 0;
        renderWeekNav();
        renderConfOptions(data.conferences);
        renderLiveCount();
        render();
        if (jumpToCurrent) scrollToCurrent();
        scheduleRefresh();
    }).catch(function (err) {
        console.error('Scoreboard load failed:', err);
        document.getElementById('scoreboard-content').innerHTML =
            '<p class="sb-empty">Couldn\'t load the slate. Try refreshing.</p>';
    });
}

// Land on what's still to come rather than on last Saturday's finals.
//
// Live games first; failing that, the next kickoff. Anchoring only on live
// games was too narrow — something is actually in progress for a few hours a
// week, and every other hour the page opened on results five days old. "First
// game that isn't over" is the same answer during a slate and a useful one
// outside it. A week that is entirely upcoming lands on its own first card,
// i.e. the top, which is where it should be anyway.
//
// Deferred until document.fonts.ready: Poppins loads asynchronously, and when
// it swaps in, ~90 cards each change height by a hair. Measured before the swap
// the target was ~470px off, which put the games near the bottom of the screen
// instead of under the filter row. Waiting for final text metrics lands it
// exactly.
//
// Instant, not smooth — this is an anchor jump on first paint, and animating
// 4,000px of slate is both slow and disorienting. Nothing to animate also means
// nothing for prefers-reduced-motion to object to.
function scrollToCurrent() {
    var run = function () {
        var card = document.querySelector('.sb-card.sb-state-live')
            || document.querySelector('.sb-card.sb-state-pre');
        if (!card) return;

        // When the card we're aiming at opens its day, aim at the day heading
        // instead — landing on a bare "5:00 PM" with THURSDAY hidden behind the
        // filter row loses the one bit of context the jump was for. Mid-day
        // targets keep the card itself: scrolling back to the heading would bury
        // the game under everything already played that day.
        var target = card;
        var grid = card.parentElement;
        if (!card.previousElementSibling && grid && grid.previousElementSibling
            && grid.previousElementSibling.classList.contains('sb-day')) {
            target = grid.previousElementSibling;
        }

        var stuck = document.querySelector('.sb-filters');
        var offset = (stuck ? stuck.getBoundingClientRect().height : 0)
            + stickyTopPx() + 12;
        var y = target.getBoundingClientRect().top + window.scrollY - offset;
        window.scrollTo(0, Math.max(0, y));
    };
    // No requestAnimationFrame here on purpose. rAF does not fire in a hidden
    // tab, so opening this page in a background tab (cmd-click, a restored
    // session) either never jumped at all or lurched much later when the tab was
    // finally focused. getBoundingClientRect forces layout synchronously, so
    // measuring straight after the font swap is already accurate.
    if (document.fonts && document.fonts.ready && document.fonts.ready.then) {
        document.fonts.ready.then(run).catch(run);
    } else {
        run();
    }
}

// Patch one card in place rather than re-rendering the list. A full innerHTML
// rewrite every 30s throws away the user's scroll position and flickers the
// whole page — on the one screen someone leaves open for three hours.
function patchCard(game) {
    var card = document.querySelector('[data-game="' + game.id + '"]');
    if (!card) return false;
    var fresh = document.createElement('div');
    fresh.innerHTML = cardHtml(game);
    var next = fresh.firstChild;
    card.className = next.className;
    card.innerHTML = next.innerHTML;
    return true;
}

function refresh() {
    if (sbState.week == null) return Promise.resolve();

    return sbApi(sbUrl(sbState.week, true)).then(function (data) {
        var live = data.games || [];
        var wasLive = sbState.liveCount;
        sbState.liveCount = data.liveCount || 0;
        renderLiveCount();

        // A game that just kicked off has no card yet (it rendered as "pre"),
        // and one that just went final drops out of the live response with its
        // card still showing a clock. Either way the slate's shape changed, so
        // take the full payload instead of patching.
        var missing = live.some(function (g) { return !patchCard(g); });
        if (missing || sbState.liveCount !== wasLive) return loadWeek(sbState.week, false);

        // Keep the cached copy in step so a filter change doesn't repaint stale
        // scores from the last full load.
        live.forEach(function (g) {
            var i = sbState.games.findIndex(function (x) { return x.id === g.id; });
            if (i > -1) sbState.games[i] = g;
        });
        scheduleRefresh();
    }).catch(function (err) {
        console.error('Scoreboard refresh failed:', err);
        scheduleRefresh();
    });
}

function scheduleRefresh() {
    clearTimeout(sbState.timer);
    // A hidden tab is a phone in a pocket — nothing to update, and waking every
    // 30s to do it is the kind of thing that shows up in someone's battery
    // screen. The visibilitychange handler catches up on the way back.
    if (document.hidden) return;
    sbState.timer = setTimeout(refresh, sbState.liveCount ? LIVE_MS : IDLE_MS);
}

function loadLastUpdated() {
    sbApi('/standings/last-updated').then(function (run) {
        if (!run) return;
        var when = new Date(run.finishedAt || run.startedAt);
        if (isNaN(when)) return;
        document.getElementById('sb-updated').textContent = 'Updated ' +
            when.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    }).catch(function () { /* the badge is a nicety, not worth a toast */ });
}

// ---- wiring -----------------------------------------------------------------

// The navbar is sticky with a height that changes between phone and desktop, so
// the filter row's own sticky offset is measured rather than hardcoded.
//
// Floor, not round: half a pixel too FAR down leaves a hairline of scrolling
// content visible between the navbar and the filter row, while half a pixel too
// high just tucks under an opaque navbar and is invisible. The CSS pairs this
// with an upward box-shadow in the page colour to cover the seam either way.
function stickyTopPx() {
    var nav = document.getElementById('navbar');
    return nav ? Math.floor(nav.getBoundingClientRect().height) : 0;
}
function syncStickyTop() {
    document.documentElement.style.setProperty('--sb-sticky-top', stickyTopPx() + 'px');
}

document.addEventListener('DOMContentLoaded', function () {
    syncStickyTop();
    window.addEventListener('resize', syncStickyTop);
    // The navbar carries the brand wordmark in a webfont, so its height changes
    // when that font swaps in — an offset measured at DOMContentLoaded can be
    // stale by the time anyone scrolls.
    if (document.fonts && document.fonts.ready && document.fonts.ready.then) {
        document.fonts.ready.then(syncStickyTop).catch(function () {});
    }

    document.querySelectorAll('.sb-chip').forEach(function (chip) {
        chip.addEventListener('click', function () {
            document.querySelectorAll('.sb-chip').forEach(function (c) { c.classList.remove('is-active'); });
            chip.classList.add('is-active');
            sbState.filter = chip.getAttribute('data-filter');
            render();
        });
    });

    // Delegated so it survives every re-render and every patched card. A click
    // on a team name is that team's link, not the card's — the card only claims
    // clicks nobody else wanted.
    var content = document.getElementById('scoreboard-content');
    function openGame(target) {
        var card = target.closest ? target.closest('.sb-card') : null;
        if (!card) return;
        window.location.href = '/game/' + card.getAttribute('data-game');
    }
    content.addEventListener('click', function (e) {
        if (e.target.closest('a')) return;
        openGame(e.target);
    });
    content.addEventListener('keydown', function (e) {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        if (!e.target.classList || !e.target.classList.contains('sb-card')) return;
        e.preventDefault();
        openGame(e.target);
    });

    document.getElementById('conf-filter').addEventListener('change', function () {
        sbState.conf = this.value;
        render();
    });

    document.getElementById('week-prev').addEventListener('click', function () {
        var i = sbState.weeks.indexOf(sbState.week);
        if (i > 0) loadWeek(sbState.weeks[i - 1]);
    });
    document.getElementById('week-next').addEventListener('click', function () {
        var i = sbState.weeks.indexOf(sbState.week);
        if (i > -1 && i < sbState.weeks.length - 1) loadWeek(sbState.weeks[i + 1]);
    });

    document.addEventListener('visibilitychange', function () {
        if (document.hidden) clearTimeout(sbState.timer);
        else refresh();
    });

    loadWeek(null, true);
    loadLastUpdated();
});
