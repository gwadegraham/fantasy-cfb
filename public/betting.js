// Seeded from the league calendar in init(). The literal here is only what the
// label shows for the blink before that resolves — it used to be the permanent
// answer, which parked the page on week 0 for the whole season.
var currentWeek = 0;
var currentSeason = window.APP_YEAR;
var parlays = [];
var games = [];
var memberNames = {};
var memberAvatars = {};
var memberFranchises = {};
var myUserId = '';

var MEMBER_COLORS = ['#ed5858', '#6C9BFF', '#22C37A', '#E0B341', '#8E8CF0', '#D27171'];
var adminEditing = false;

var SEEN_KEY = 'parlay-seen-resolved';
var SEEN_TTL = 30 * 24 * 60 * 60 * 1000;
function getSeenMap() {
    try { var m = JSON.parse(localStorage.getItem(SEEN_KEY) || '{}'); } catch (e) { var m = {}; }
    var now = Date.now(), changed = false;
    Object.keys(m).forEach(function (k) { if (now - m[k] > SEEN_TTL) { delete m[k]; changed = true; } });
    if (changed) localStorage.setItem(SEEN_KEY, JSON.stringify(m));
    return m;
}
function hasSeenResolve(id) { return !!getSeenMap()[id]; }
function markResolveAsSeen(id) { var m = getSeenMap(); m[id] = Date.now(); localStorage.setItem(SEEN_KEY, JSON.stringify(m)); }

function getMyUserId() {
    if (!window.userState) return '';
    var meta = userState.user_metadata && userState.user_metadata.metadata;
    return (meta && meta.userId) || '';
}

function initials(name) {
    if (!name) return '?';
    var parts = name.trim().split(/\s+/);
    return parts.map(function (p) { return p[0]; }).join('').toUpperCase().slice(0, 2);
}

function avatarHtml(contributorId, color, init) {
    var url = memberAvatars[contributorId];
    if (url) return '<img class="leg-avatar-img" src="' + url + '" alt="">';
    return '<div class="leg-avatar" style="background:' + color + ';">' + init + '</div>';
}

function displayName(contributorId) {
    var name = memberNames[contributorId] || 'Member';
    return '<span class="leg-name">' + name + '</span>';
}

function americanToDecimal(odds) {
    if (odds >= 100) return 1 + (odds / 100);
    if (odds <= -100) return 1 + (100 / Math.abs(odds));
    return 1;
}

// Books boost the PROFIT, not the stake, and cap the stake they'll boost
// ("Max $10.00 wager"). The group plays a $20 ticket, so the cap usually bites
// and the ticket's real odds are a blend of boosted and unboosted. Mirrors
// modules/parlay-calc.js — keep the two in step.
function boostDecimal(dec, pct) {
    if (!pct) return dec;
    return 1 + ((dec - 1) * (1 + (pct / 100)));
}

// Decimal odds for the boosted slice. The percentage reproduces the book's own
// arithmetic; the stored boostedOdds is only its rounded display, so that's the
// fallback for a ticket where someone typed a boosted number and no percentage.
function boostedSliceDecimal(parlay, rawDec) {
    if (parlay.boostPct) return boostDecimal(rawDec, parlay.boostPct);
    if (isRealOdds(parlay.boostedOdds)) return americanToDecimal(parlay.boostedOdds);
    return rawDec;
}

// The legs win over the hand-typed parlayOdds: the slip's number is ROUNDED to
// whole American odds, while the legs are quoted whole and multiply out exactly.
// A real $20 ticket at -345/-205/-200/-172 is 4.552171, which FanDuel displays
// as "+355" (4.55) — computing off the display loses 11 cents. Mirrors
// ticketDecimalOdds in modules/parlay-calc.js; keep the two in step.
function isRealOdds(odds) {
    return typeof odds === 'number' && !isNaN(odds) && Math.abs(odds) >= 100;
}

function boostMath(parlay, legs) {
    var wager = Number(parlay.wager) || 0;
    var active = (legs || []).filter(function (l) { return l.result !== 'push'; });
    var allPriced = active.length && active.every(function (l) { return isRealOdds(l.odds); });
    var rawDec = allPriced
        ? active.reduce(function (acc, l) { return acc * americanToDecimal(l.odds); }, 1)
        : (isRealOdds(parlay.parlayOdds) ? americanToDecimal(parlay.parlayOdds) : 0);
    if (!wager || rawDec <= 1) return null;

    var cap = Number(parlay.boostCap);
    var boostedStake = (cap > 0) ? Math.min(cap, wager) : wager;
    var plainStake = wager - boostedStake;
    var boostedDec = boostedSliceDecimal(parlay, rawDec);
    var total = (boostedStake * boostedDec) + (plainStake * rawDec);

    return {
        rawOdds: decimalToAmerican(rawDec),
        boostedOdds: decimalToAmerican(boostedDec),
        effectiveOdds: decimalToAmerican(total / wager),
        capped: plainStake > 0,
        boostedStake: boostedStake,
        payout: (Math.round(total * 100) / 100).toFixed(2)
    };
}

function formatOdds(odds) {
    if (odds == null) return '';
    return odds >= 0 ? '+' + odds : String(odds);
}

function combinedOdds(legs) {
    var active = legs.filter(function (l) { return l.odds && l.result !== 'push'; });
    if (!active.length) return '—';
    var dec = active.reduce(function (acc, l) { return acc * americanToDecimal(l.odds); }, 1);
    if (dec >= 2) return '+' + Math.round((dec - 1) * 100);
    if (dec > 1) return String(Math.round(-100 / (dec - 1)));
    return '+100';
}

function calcPayout(wager, legs) {
    if (!wager) return 0;
    var active = legs.filter(function (l) { return l.odds && l.result !== 'push'; });
    var dec = active.reduce(function (acc, l) { return acc * americanToDecimal(l.odds); }, 1);
    return Math.round(wager * dec * 100) / 100;
}

function formatGameTime(dateStr) {
    if (!dateStr) return '';
    var d = new Date(dateStr);
    var days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    var h = d.getHours();
    var m = d.getMinutes();
    var p = h >= 12 ? 'p' : 'a';
    h = h % 12 || 12;
    return days[d.getDay()] + ' ' + h + (m ? ':' + String(m).padStart(2, '0') : '') + p;
}

async function loadMemberNames() {
    try {
        var r = await fetch('/betting-groups');
        if (!r.ok) return;
        var group = await r.json();
        if (group && group.memberDetails) {
            group.memberDetails.forEach(function (u) {
                memberNames[u._id] = u.firstName || 'Unknown';
                if (u.avatarUrl) memberAvatars[u._id] = u.avatarUrl;
                if (u.franchiseName) memberFranchises[u._id] = u.franchiseName;
            });
        }
    } catch (e) { /* skip */ }
}

async function loadParlays() {
    try {
        var res = await fetch('/betting/list?season=' + currentSeason);
        if (!res.ok) return;
        parlays = await res.json();
    } catch (e) {
        parlays = [];
    }
}

async function loadGames() {
    try {
        var res = await fetch('/betting/games/' + currentSeason + '/' + currentWeek);
        if (!res.ok) return;
        games = await res.json();
    } catch (e) {
        games = [];
    }
}

async function loadSeasonSummary() {
    var el = document.getElementById('season-summary');
    var yearEl = document.getElementById('summary-year');
    if (yearEl) yearEl.textContent = currentSeason;
    if (!el) return;

    try {
        var res = await fetch('/betting/season-summary/' + currentSeason);
        if (!res.ok) return;
        var data = await res.json();
        var r = data.record;
        var netClass = data.net >= 0 ? 'stat-positive' : 'stat-negative';
        var netSign = data.net >= 0 ? '+' : '';
        el.innerHTML =
            '<div class="stat-card"><div class="stat-label">Record</div><div class="stat-value">'
            + r.wins + '-' + r.losses + (r.pushes ? '-' + r.pushes : '') + '</div></div>'
            + '<div class="stat-card"><div class="stat-label">Wagered</div><div class="stat-value">$' + data.totalWagered + '</div></div>'
            + '<div class="stat-card"><div class="stat-label">Won</div><div class="stat-value">$' + data.totalReturned + '</div></div>'
            + '<div class="stat-card"><div class="stat-label">Net</div><div class="stat-value ' + netClass + '">' + netSign + '$' + Math.abs(data.net) + '</div></div>';
    } catch (e) { /* skip */ }
}

function renderHistory() {
    var body = document.getElementById('history-body');
    if (!body) return;
    if (!parlays.length) { body.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--cc-muted);padding:20px;">No parlays yet this season.</td></tr>'; return; }

    var sorted = parlays.slice().sort(function (a, b) { return a.week - b.week; });
    body.innerHTML = sorted.map(function (p) {
        var filled = p.legs.filter(function (l) { return l.gameId; }).length;
        var total = p.legs.length;
        var statusColor = p.status === 'won' ? 'var(--cc-success)' : (p.status === 'lost' ? 'var(--cc-danger-text)' : 'var(--cc-info)');
        var statusLabel = p.status === 'won' ? 'Won' : (p.status === 'lost' ? 'Lost' : (p.status === 'push' ? 'Push' : 'Pend'));
        var payoutColor = p.status === 'won' ? 'var(--cc-success)' : (p.status === 'lost' ? 'var(--cc-danger-text)' : 'var(--cc-muted)');
        var payoutText = p.payout != null ? '$' + p.payout : '—';

        return '<tr>'
            + '<td>Wk ' + p.week + '</td>'
            + '<td style="color:var(--cc-muted-2);">' + filled + '/' + total + '</td>'
            + '<td>$' + (p.wager || 0) + '</td>'
            + '<td><span style="font-weight:600;color:' + statusColor + ';">' + statusLabel + '</span></td>'
            + '<td class="text-right" style="color:' + payoutColor + ';">' + payoutText + '</td>'
            + '</tr>';
    }).join('');
}

function renderCurrentParlay() {
    var container = document.getElementById('betting-content');
    if (!container) return;

    var parlay = parlays.find(function (p) { return p.week === currentWeek; });

    if (!parlay) {
        container.innerHTML =
            '<div class="create-parlay-cta">'
            + '<p>No parlay for Week ' + currentWeek + ' yet.</p>'
            + '<button class="btn-create-parlay" onclick="createParlay()">Create Week ' + currentWeek + ' Parlay</button>'
            + '</div>';
        return;
    }

    var shouldAnimate = parlay.status !== 'pending'
        && !hasSeenResolve(parlay._id)
        && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    var statusClass = 'status-' + parlay.status;
    var statusLabel = parlay.status === 'won' ? 'Won' : (parlay.status === 'lost' ? 'Lost' : (parlay.status === 'push' ? 'Push' : 'Pending'));

    var legsHtml = parlay.legs.map(function (leg, i) {
        var name = memberNames[leg.contributor] || 'Member';
        var color = MEMBER_COLORS[i % MEMBER_COLORS.length];
        var init = initials(name);

        if (!leg.gameId) {
            var isMine = leg.contributor === myUserId;
            if (isMine) {
                return renderLegPickCTA(leg, parlay._id, i, name, color, init);
            }
            if (window.IS_ADMIN) {
                return renderLegPickCTA(leg, parlay._id, i, name, color, init);
            }
            return '<div class="leg leg-empty" data-contributor="' + leg.contributor + '">'
                + '<div class="leg-contributor">' + avatarHtml(leg.contributor, color, init) + displayName(leg.contributor) + '</div>'
                + '<div class="leg-detail"><div class="leg-pick">Awaiting pick...</div></div>'
                + '</div>';
        }

        var game = games.find(function (g) { return g.id === leg.gameId; });
        var matchup = game ? (game.awayTeam + ' @ ' + game.homeTeam) : 'Game #' + leg.gameId;

        var resultHtml = '';
        if (leg.result === 'win') resultHtml = '<div class="leg-result result-win"><i class="fa-solid fa-check"></i></div>';
        else if (leg.result === 'loss') resultHtml = '<div class="leg-result result-loss"><i class="fa-solid fa-xmark"></i></div>';
        else if (leg.result === 'push') resultHtml = '<div class="leg-result result-push"><i class="fa-solid fa-minus"></i></div>';
        else resultHtml = '<div class="leg-result result-pending"><i class="fa-solid fa-clock"></i></div>';

        if (shouldAnimate && leg.result && leg.result !== 'pending') {
            resultHtml = '<div class="leg-result-slot leg--unrevealed">'
                + '<div class="slot-spinner"><i class="fa-solid fa-question"></i></div>'
                + '<div class="slot-reveal">' + resultHtml + '</div>'
                + '</div>';
        }

        var editBtn = '';
        if (parlay.status === 'pending' && (leg.contributor === myUserId || (window.IS_ADMIN && adminEditing))) {
            editBtn = '<button type="button" onclick="editLeg(\'' + parlay._id + '\',\'' + leg.contributor + '\')" style="background:none;border:none;color:var(--cc-interactive);font-size:12px;cursor:pointer;padding:2px 4px;" title="Edit"><i class="fa-solid fa-pen-to-square"></i></button>';
        }

        var resolveHtml = '';
        if (window.IS_ADMIN && adminEditing && leg.gameId) {
            resolveHtml = '<div class="leg-resolve">'
                + '<button type="button" class="btn-resolve btn-resolve-win" onclick="resolveLeg(\'' + parlay._id + '\',\'' + leg.contributor + '\',\'win\')">W</button>'
                + '<button type="button" class="btn-resolve btn-resolve-loss" onclick="resolveLeg(\'' + parlay._id + '\',\'' + leg.contributor + '\',\'loss\')">L</button>'
                + '<button type="button" class="btn-resolve btn-resolve-push" onclick="resolveLeg(\'' + parlay._id + '\',\'' + leg.contributor + '\',\'push\')">P</button>'
                + '</div>';
        }

        return '<div class="leg" data-contributor="' + leg.contributor + '">'
            + '<div class="leg-contributor">' + avatarHtml(leg.contributor, color, init) + displayName(leg.contributor) + '</div>'
            + '<div class="leg-detail"><div class="leg-pick">' + (leg.selection || '—') + '</div><div class="leg-game">' + matchup + '</div></div>'
            + '<div class="leg-odds">' + formatOdds(leg.odds) + '</div>'
            + '<div class="leg-actions">' + resultHtml + editBtn + resolveHtml + '</div>'
            + '</div>';
    }).join('');

    var filledLegs = parlay.legs.filter(function (l) { return l.odds; });
    var calcOdds = filledLegs.length ? combinedOdds(filledLegs) : '—';
    var calcPay = parlay.wager && filledLegs.length ? '$' + calcPayout(parlay.wager, filledLegs) : '—';

    var boost = (parlay.boostPct || parlay.boostedOdds) ? boostMath(parlay, parlay.legs) : null;

    var oddsHtml = '';
    if (boost) {
        // With a cap in play the advertised boosted number isn't what the
        // ticket pays, so lead with the blended odds and show the cap.
        var badge = (parlay.boostPct ? '+' + parlay.boostPct + '%' : 'boost')
            + (boost.capped ? ' &middot; $' + boost.boostedStake + ' cap' : '');
        oddsHtml = '<span class="odds-original">' + formatOdds(parlay.parlayOdds || boost.rawOdds) + '</span>'
            + ' <span class="boost-badge">' + badge + '</span> '
            + '<span class="odds-boosted">' + formatOdds(boost.effectiveOdds) + '</span>';
    } else if (parlay.parlayOdds) {
        oddsHtml = formatOdds(parlay.parlayOdds);
    } else {
        oddsHtml = calcOdds;
    }

    var payoutDisplay;
    if (parlay.payout != null) {
        payoutDisplay = '$' + parlay.payout;
    } else if (parlay.totalPayout) {
        payoutDisplay = '$' + parlay.totalPayout;
    } else if (boost) {
        payoutDisplay = '$' + boost.payout;
    } else {
        payoutDisplay = calcPay;
    }
    var payoutClass = parlay.status === 'won' ? 'payout-won' : (parlay.status === 'lost' ? 'payout-lost' : '');

    var statusAnimClass = shouldAnimate ? ' parlay-status--unrevealed' : '';
    var payoutAnimClass = shouldAnimate ? ' payout-bar--unrevealed' : '';

    var placedByName = parlay.placedBy
        ? (typeof parlay.placedBy === 'object' ? (parlay.placedBy.firstName || 'Unknown') : (memberNames[parlay.placedBy] || 'Unknown'))
        : '';

    var wagerHtml = '';
    if (window.IS_ADMIN && adminEditing && parlay.status === 'pending') {
        var placedByOptions = '<option value="">—</option>';
        Object.keys(memberNames).forEach(function (id) {
            var sel = (parlay.placedBy && ((typeof parlay.placedBy === 'object' ? parlay.placedBy._id : parlay.placedBy) === id)) ? ' selected' : '';
            placedByOptions += '<option value="' + id + '"' + sel + '>' + memberNames[id] + '</option>';
        });

        wagerHtml = '<div class="wager-section">'
            + '<label>Wager $</label>'
            + '<input type="number" class="wager-input" value="' + (parlay.wager || '') + '" onchange="updateWager(\'' + parlay._id + '\', this.value)">'
            + '<label>Placed by</label>'
            + '<select class="wager-input" onchange="updatePlacedBy(\'' + parlay._id + '\', this.value)">' + placedByOptions + '</select>'
            + '</div>'
            + '<div class="boost-section">'
            + '<label>Odds</label>'
            + '<input type="number" class="boost-input" value="' + (parlay.parlayOdds || '') + '" placeholder="—" onchange="updateBoost(\'' + parlay._id + '\', \'parlayOdds\', this.value)">'
            + '<label>Boost %</label>'
            + '<input type="number" class="boost-input" value="' + (parlay.boostPct || '') + '" placeholder="—" onchange="updateBoost(\'' + parlay._id + '\', \'boostPct\', this.value)">'
            + '<label>Boost cap $</label>'
            + '<input type="number" class="boost-input" value="' + (parlay.boostCap || '') + '" placeholder="all" onchange="updateBoost(\'' + parlay._id + '\', \'boostCap\', this.value)">'
            + '<label>Boosted</label>'
            + '<input type="number" class="boost-input" value="' + (parlay.boostedOdds || '') + '" placeholder="' + (boost ? formatOdds(boost.boostedOdds) : '—') + '" onchange="updateBoost(\'' + parlay._id + '\', \'boostedOdds\', this.value)">'
            + '<label>Payout $</label>'
            + '<input type="number" class="boost-input" value="' + (parlay.totalPayout || '') + '" placeholder="—" onchange="updateBoost(\'' + parlay._id + '\', \'totalPayout\', this.value)" step="0.01">'
            + '</div>';
    }

    container.innerHTML =
        '<div class="parlay-card">'
        + '<div class="parlay-header"><div class="parlay-week">Week ' + currentWeek + ' Parlay' + (placedByName ? ' <span class="placed-by">placed by ' + placedByName + '</span>' : '') + '</div>'
        + '<div class="parlay-header-actions">'
        + (window.IS_ADMIN ? '<button type="button" class="btn-admin-edit' + (adminEditing ? ' active' : '') + '" onclick="toggleAdminEdit()" title="Edit parlay"><i class="fa-solid fa-pen"></i></button>' : '')
        + '<span class="parlay-status ' + statusClass + statusAnimClass + '">' + statusLabel + '</span>'
        + '</div></div>'
        + '<div class="legs">' + legsHtml + '</div>'
        + '<div class="payout-bar' + payoutAnimClass + '">'
        + '<div class="payout-item"><div class="payout-label">Wager</div><div class="payout-value">$' + (parlay.wager || 0) + '</div></div>'
        + '<div class="payout-item"><div class="payout-label">Odds</div><div class="payout-value payout-odds">' + oddsHtml + '</div></div>'
        + '<div class="payout-item"><div class="payout-label">Payout</div><div class="payout-value ' + payoutClass + '">' + payoutDisplay + '</div></div>'
        + '</div>'
        + '</div>'
        + wagerHtml;

    if (shouldAnimate) {
        requestAnimationFrame(function () { playResolveAnimation(parlay); });
    }
}

function delay(ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); }

async function playResolveAnimation(parlay) {
    var legs = document.querySelectorAll('.leg-result-slot');
    var statusBadge = document.querySelector('.parlay-status--unrevealed');
    var payoutBar = document.querySelector('.payout-bar--unrevealed');

    await delay(600);

    for (var i = 0; i < legs.length; i++) {
        var el = legs[i];
        el.classList.add('slot--spinning');
        await delay(800);
        el.classList.remove('slot--spinning');
        el.classList.remove('leg--unrevealed');
        el.classList.add('slot--revealed');
        await delay(400);
    }

    await delay(500);
    if (statusBadge) {
        statusBadge.classList.remove('parlay-status--unrevealed');
        statusBadge.classList.add('parlay-status--revealed');
    }
    if (payoutBar) {
        payoutBar.classList.remove('payout-bar--unrevealed');
        payoutBar.classList.add('payout-bar--revealed');
        if (parlay.status === 'won') {
            var payoutEl = payoutBar.querySelector('.payout-won') || payoutBar.querySelector('.payout-value:last-child');
            if (payoutEl) moneyExplosion(payoutEl);
        }
    }

    markResolveAsSeen(parlay._id);
}

function moneyExplosion(anchor) {
    var rect = anchor.getBoundingClientRect();
    var cx = rect.left + rect.width / 2;
    var cy = rect.top + rect.height / 2;
    var symbols = ['💰', '💸', '💵', '🤑'];
    var count = 32;
    for (var i = 0; i < count; i++) {
        var el = document.createElement('div');
        el.className = 'money-particle';
        el.textContent = symbols[i % symbols.length];
        el.style.left = cx + 'px';
        el.style.top = cy + 'px';
        document.body.appendChild(el);
        var angle = (i / count) * 2 * Math.PI;
        var dist = 120 + Math.random() * 90;
        var dx = Math.cos(angle) * dist;
        var dy = Math.sin(angle) * dist;
        (function (e, x, y) {
            requestAnimationFrame(function () {
                requestAnimationFrame(function () {
                    e.style.translate = 'calc(' + x + 'px - 50%) calc(' + y + 'px - 50%)';
                    e.style.scale = '0.4';
                    e.style.rotate = (x > 0 ? 540 : -540) + 'deg';
                    e.style.opacity = '0';
                });
            });
            setTimeout(function () { e.remove(); }, 2000);
        })(el, dx, dy);
    }
}

/* ── New leg entry: CTA button → game picker → bet board ── */

function renderLegPickCTA(leg, parlayId, index, name, color, init) {
    return '<div class="leg-pick-cta" id="leg-cta-' + index + '" data-contributor="' + leg.contributor + '">'
        + '<div class="leg-pick-cta-row">'
        + '<div class="leg-contributor">'
        + avatarHtml(leg.contributor, color, init)
        + '<span class="leg-name">' + name + '</span>'
        + '</div>'
        + '<button type="button" class="btn-pick-game" onclick="openGamePicker(\'' + parlayId + '\',\'' + leg.contributor + '\',' + index + ')">'
        + '<span>Choose a game...</span><i class="fa-solid fa-chevron-right"></i>'
        + '</button>'
        + '</div>'
        + '<div id="bet-board-' + index + '"></div>'
        + '</div>';
}

var activePick = null; // { parlayId, contributor, index, gameId, game }

// Keep the eye on the row that was just acted on.
//
// renderCurrentParlay() replaces all of #betting-content, and an open bet board
// is taller than a phone viewport. When it collapses on submit, the page does
// not scroll at all — roughly 600px above the fold simply stops existing, so an
// unchanged scroll offset ends up pointing at whatever slid up into it, which
// in practice is the season summary two sections down. Restoring the old
// scrollTop wouldn't help: the element it was measured against is gone. Anchor
// on the contributor's row instead, which survives every one of these renders
// in one shape or another.
function scrollLegIntoView(contributor, position) {
    if (!contributor) return;
    var el = document.querySelector('#betting-content [data-contributor="' + contributor + '"]');
    if (!el || !el.scrollIntoView) return;
    var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollIntoView({ block: position || 'center', behavior: reduced ? 'auto' : 'smooth' });
}

function openGamePicker(parlayId, contributor, index) {
    activePick = { parlayId: parlayId, contributor: contributor, index: index };

    var sortedGames = games.slice().sort(function (a, b) {
        return (a.startDate || '').localeCompare(b.startDate || '');
    });

    var html = '<div class="game-picker-backdrop" id="game-picker-backdrop" onclick="closeGamePicker(event)">'
        + '<div class="game-picker" onclick="event.stopPropagation()">'
        + '<div class="game-picker-head">'
        + '<input type="text" id="game-search" placeholder="Search teams..." oninput="filterGames(this.value)" autocomplete="off">'
        + '<button type="button" class="game-picker-close" onclick="closeGamePicker()">✕</button>'
        + '</div>'
        + '<div class="game-picker-list" id="game-picker-list">'
        + renderGameList(sortedGames)
        + '</div>'
        + '</div></div>';

    document.body.insertAdjacentHTML('beforeend', html);
    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';
    var searchInput = document.getElementById('game-search');
    if (searchInput) searchInput.focus();
}

function teamLogo(logos) {
    var src = typeof ccLogo === 'function' ? ccLogo(logos) : (logos && logos[0] || '');
    if (!src) return '';
    return '<img class="game-picker-logo" src="' + src + '" alt="" loading="lazy">';
}

function rankLabel(rank) {
    return rank ? '<span class="game-picker-rank">#' + rank + '</span>' : '';
}

function renderGameList(gamesToShow) {
    if (!gamesToShow.length) return '<div class="game-picker-empty">No games found.</div>';
    return gamesToShow.map(function (g) {
        return '<div class="game-picker-item" onclick="selectGame(' + g.id + ')">'
            + '<div class="game-picker-teams">'
            + teamLogo(g.awayLogos) + rankLabel(g.awayRank) + '<span>' + g.awayTeam + '</span>'
            + '<span class="game-picker-at">@</span>'
            + teamLogo(g.homeLogos) + rankLabel(g.homeRank) + '<span>' + g.homeTeam + '</span>'
            + '</div>'
            + '<span class="game-picker-time">' + formatGameTime(g.startDate) + '</span>'
            + '</div>';
    }).join('');
}

function filterGames(query) {
    var list = document.getElementById('game-picker-list');
    if (!list) return;
    var q = query.toLowerCase();
    var filtered = games.filter(function (g) {
        return g.homeTeam.toLowerCase().includes(q) || g.awayTeam.toLowerCase().includes(q);
    }).sort(function (a, b) {
        return (a.startDate || '').localeCompare(b.startDate || '');
    });
    list.innerHTML = renderGameList(filtered);
}

function closeGamePicker(e) {
    if (e && e.target !== document.getElementById('game-picker-backdrop')) return;
    var backdrop = document.getElementById('game-picker-backdrop');
    if (backdrop) backdrop.remove();
    document.documentElement.style.overflow = '';
    document.body.style.overflow = '';
}

function selectGame(gameId) {
    var backdrop = document.getElementById('game-picker-backdrop');
    if (backdrop) backdrop.remove();
    document.documentElement.style.overflow = '';
    document.body.style.overflow = '';
    if (!activePick) return;

    var game = games.find(function (g) { return g.id === gameId; });
    if (!game) return;

    activePick.gameId = gameId;
    activePick.game = game;

    var btn = document.querySelector('#leg-cta-' + activePick.index + ' .btn-pick-game');
    if (btn) btn.innerHTML = '<span>' + game.awayTeam + ' @ ' + game.homeTeam + '</span><i class="fa-solid fa-chevron-down"></i>';

    renderBetBoard(activePick.index, game);
    // 'start' rather than 'center': the board is taller than the viewport, so
    // centring it would cut off the tabs and the spread row at the top.
    scrollLegIntoView(activePick.contributor, 'start');
}

function renderBetBoard(index, game) {
    var board = document.getElementById('bet-board-' + index);
    if (!board) return;

    var dk = game.dk;
    var html = '<div class="bet-board">';

    html += '<div class="bet-board-game">'
        + '<span>' + game.awayTeam + ' @ ' + game.homeTeam + '</span>'
        + (dk ? ' <span class="dk-badge"><i class="fa-solid fa-bolt"></i> DraftKings</span>' : '')
        + '<button type="button" onclick="openGamePicker(\'' + activePick.parlayId + '\',\'' + activePick.contributor + '\',' + index + ')">change</button>'
        + '</div>';

    // Tab bar
    html += '<div class="bb-tabs" id="bb-tabs-' + index + '">'
        + '<button type="button" class="bb-tab active" onclick="switchBetTab(' + index + ',\'lines\',this)">Lines</button>'
        + '<button type="button" class="bb-tab" onclick="switchBetTab(' + index + ',\'stats\',this)">Stats</button>'
        + '<button type="button" class="bb-tab" onclick="switchBetTab(' + index + ',\'custom\',this)">Custom</button>'
        + '</div>';

    // Lines panel
    html += '<div class="bb-panel" data-tab="lines" id="bb-lines-' + index + '">';

    // Spread row
    html += '<div class="bet-row"><div class="bet-row-label">Spread</div>';
    if (dk && dk.spread != null) {
        var homeSpread = dk.spread;
        var awaySpread = -homeSpread;
        var homeFmt = (homeSpread >= 0 ? '+' : '') + homeSpread;
        var awayFmt = (awaySpread >= 0 ? '+' : '') + awaySpread;
        html += betButton(index, 'spread', game.homeTeam + ' ' + homeFmt, homeSpread, -110, game.homeTeam + ' ' + homeFmt, 'home');
        html += betButton(index, 'spread', game.awayTeam + ' ' + awayFmt, awaySpread, -110, game.awayTeam + ' ' + awayFmt, 'away');
    } else {
        html += '<div class="bet-btn-na">N/A</div><div class="bet-btn-na">N/A</div>';
    }
    html += '</div>';

    // Alt spread: pick a team, then slide off the book number. Home on the left,
    // away on the right — the same order as the Spread and ML rows this sits
    // between. (The Stats panel below runs away-then-home, but it's a separate
    // tab; here the mismatch reads as the teams having swapped sides.)
    html += '<div class="bet-row alt-team-row"><div class="bet-row-label">Alt</div>'
        + '<button type="button" class="alt-team-btn" data-side="home" onclick="pickAltTeam(' + index + ',\'home\',this)">' + game.homeTeam + '</button>'
        + '<button type="button" class="alt-team-btn" data-side="away" onclick="pickAltTeam(' + index + ',\'away\',this)">' + game.awayTeam + '</button>'
        + '</div>';
    html += '<div class="alt-spread-wrap" id="alt-spread-' + index + '"></div>';

    // Moneyline row
    html += '<div class="bet-row"><div class="bet-row-label">ML</div>';
    if (dk && (dk.homeMoneyline != null || dk.awayMoneyline != null)) {
        html += betButton(index, 'moneyline', game.homeTeam + ' ML', null, dk.homeMoneyline, game.homeTeam + ' ML', 'home');
        html += betButton(index, 'moneyline', game.awayTeam + ' ML', null, dk.awayMoneyline, game.awayTeam + ' ML', 'away');
    } else {
        html += '<div class="bet-btn-na">N/A</div><div class="bet-btn-na">N/A</div>';
    }
    html += '</div>';

    // Over/Under row
    html += '<div class="bet-row"><div class="bet-row-label">O/U</div>';
    if (dk && dk.overUnder != null) {
        var ou = dk.overUnder;
        html += betButton(index, 'over_under', 'Over ' + ou, ou, -110, 'Over ' + ou);
        html += betButton(index, 'over_under', 'Under ' + ou, ou, -110, 'Under ' + ou);
    } else {
        html += '<div class="bet-btn-na">N/A</div><div class="bet-btn-na">N/A</div>';
    }
    html += '</div>';
    html += '</div>'; // end lines panel

    // Stats panel
    html += '<div class="bb-panel" data-tab="stats" id="bb-stats-' + index + '" style="display:none">'
        + '<div class="stat-team-pick">'
        + '<button type="button" class="stat-team-btn" data-side="away" onclick="pickStatTeam(' + index + ',\'away\',this)">' + game.awayTeam + '</button>'
        + '<button type="button" class="stat-team-btn" data-side="home" onclick="pickStatTeam(' + index + ',\'home\',this)">' + game.homeTeam + '</button>'
        + '</div>'
        + '<div class="stat-cat-pick" id="stat-cats-' + index + '"></div>'
        + '<div class="stat-slider-wrap" id="stat-slider-' + index + '"></div>'
        + '</div>';

    // Custom panel
    html += '<div class="bb-panel" data-tab="custom" id="bb-custom-' + index + '" style="display:none">'
        + '<div class="bet-row bet-row-custom"><div class="bet-row-label">Custom</div>'
        + '<input type="text" class="bet-custom-input" id="custom-desc-' + index + '" placeholder="e.g. Arkansas Over 3.5 turnovers">'
        + '<button type="button" class="bet-btn bet-btn-custom" onclick="pickCustomBet(' + index + ', this)"><span class="bet-btn-label">Use</span></button>'
        + '</div></div>';

    // Odds + submit (shared across all tabs)
    html += '<div class="bet-custom-odds">Odds: <input type="number" id="custom-odds-' + index + '" value="" placeholder="auto"></div>';
    html += '<div class="bet-confirm"><button class="btn-submit-leg" id="btn-submit-' + index + '" onclick="submitLegNew(' + index + ')" disabled>Submit Leg</button></div>';

    html += '</div>';
    board.innerHTML = html;
}

function switchBetTab(index, tab, btn) {
    var board = document.getElementById('bet-board-' + index);
    if (!board) return;
    board.querySelectorAll('.bb-tab').forEach(function (t) { t.classList.remove('active'); });
    btn.classList.add('active');
    board.querySelectorAll('.bb-panel').forEach(function (p) { p.style.display = 'none'; });
    var panel = board.querySelector('.bb-panel[data-tab="' + tab + '"]');
    if (panel) panel.style.display = '';
}

var selectedBet = null; // { index, betType, selection, line, odds, teamSide?, statCategory?, statTeamSide? }

// Stat categories available for stat O/U legs, with default lines.
var STAT_CATS = [
    { key: 'totalYards',       label: 'Total Yards',    defaultLine: 350, step: 10, min: 100, max: 700 },
    { key: 'netPassingYards',  label: 'Pass Yards',     defaultLine: 225, step: 5,  min: 50,  max: 500 },
    { key: 'rushingYards',     label: 'Rush Yards',      defaultLine: 150, step: 5,  min: 30,  max: 400 },
    { key: 'turnovers',        label: 'Turnovers',       defaultLine: 1.5, step: 0.5,min: 0.5, max: 5.5 },
    { key: 'sacks',            label: 'Sacks',           defaultLine: 2.5, step: 0.5,min: 0.5, max: 8.5 },
    { key: 'penalties',        label: 'Penalties',        defaultLine: 6.5, step: 0.5,min: 1.5, max: 15.5 },
    { key: 'interceptions',    label: 'INTs',             defaultLine: 1.5, step: 0.5,min: 0.5, max: 4.5 },
    { key: 'fumblesLost',      label: 'Fumbles Lost',     defaultLine: 0.5, step: 0.5,min: 0.5, max: 3.5 },
];

var activeStatPick = null; // { index, side, teamName, cat }

function betButton(index, betType, label, line, odds, selection, side) {
    var safeSelection = selection.replace(/'/g, "\\'");
    return '<button type="button" class="bet-btn" '
        + 'onclick="pickBet(' + index + ',\'' + betType + '\',\'' + safeSelection + '\',' + (line != null ? line : 'null') + ',' + (odds != null ? odds : 'null') + ',\'' + (side || '') + '\', this)">'
        + '<span class="bet-btn-label">' + label + '</span>'
        + '<span class="bet-btn-odds">' + formatOdds(odds) + '</span>'
        + '</button>';
}

function pickBet(index, betType, selection, line, odds, side, btn) {
    selectedBet = { index: index, betType: betType, selection: selection, line: line, odds: odds, teamSide: side || null };

    // Toggle selected state
    var board = document.getElementById('bet-board-' + index);
    if (board) {
        board.querySelectorAll('.bet-btn').forEach(function (b) { b.classList.remove('selected'); });
    }
    btn.classList.add('selected');

    // Clear custom description when picking a standard bet
    var customDesc = document.getElementById('custom-desc-' + index);
    if (customDesc) customDesc.value = '';

    // Fill custom odds field and enable submit
    var oddsInput = document.getElementById('custom-odds-' + index);
    if (oddsInput) oddsInput.value = odds || '';

    var submitBtn = document.getElementById('btn-submit-' + index);
    if (submitBtn) submitBtn.disabled = false;
}

function pickCustomBet(index, btn) {
    var descInput = document.getElementById('custom-desc-' + index);
    var desc = descInput ? descInput.value.trim() : '';
    if (!desc) { descInput.focus(); return; }

    selectedBet = { index: index, betType: 'custom', selection: desc, line: null, odds: null };

    var board = document.getElementById('bet-board-' + index);
    if (board) {
        board.querySelectorAll('.bet-btn').forEach(function (b) { b.classList.remove('selected'); });
    }
    btn.classList.add('selected');

    var oddsInput = document.getElementById('custom-odds-' + index);
    if (oddsInput) { oddsInput.value = ''; oddsInput.focus(); }

    var submitBtn = document.getElementById('btn-submit-' + index);
    if (submitBtn) submitBtn.disabled = false;
}

/* ── Alt spread: team → half-point ladder off the book number ── */
//
// The point of this section: an alt spread submits as a REAL spread leg
// (betType 'spread' + line + teamSide), so modules/parlay-resolve.js grades it
// on Saturday night like any other. Typed into the Custom box — which is where
// these picks used to go — it would have waited on an admin.

var activeAltPick = null; // { index, side, teamName, base, steps }

// How far either side of the book number the ladder reaches. 21 points covers
// buying a big favorite down to a coin flip and taking a dog out to a blowout.
var ALT_REACH = 21;

function pickAltTeam(index, side, btn) {
    var board = document.getElementById('bet-board-' + index);
    if (board) board.querySelectorAll('.alt-team-btn').forEach(function (b) { b.classList.remove('selected'); });
    btn.classList.add('selected');

    var game = activePick && activePick.game;
    if (!game) return;

    // Book spread from the PICKED team's point of view — dk.spread is always
    // the home team's, so the away side is its mirror.
    var base = game.dk && game.dk.spread != null
        ? (side === 'home' ? game.dk.spread : -game.dk.spread)
        : null;

    activeAltPick = {
        index: index,
        side: side,
        teamName: side === 'home' ? game.homeTeam : game.awayTeam,
        base: base,
        steps: ccAltSpread.ladder(base, ALT_REACH)
    };

    renderAltLadder(index);
}

function renderAltLadder(index) {
    var wrap = document.getElementById('alt-spread-' + index);
    if (!wrap || !activeAltPick) return;

    var steps = activeAltPick.steps;
    var startIdx = steps.indexOf(activeAltPick.base == null ? 0 : Math.round(activeAltPick.base * 2) / 2);
    if (startIdx < 0) startIdx = Math.floor(steps.length / 2);

    wrap.innerHTML =
        '<div class="alt-line-row">'
        + '<button type="button" class="alt-nudge" onclick="nudgeAltLine(' + index + ',-1)" aria-label="Half point down">&minus;</button>'
        + '<div class="alt-line-display" id="alt-line-val-' + index + '"></div>'
        + '<button type="button" class="alt-nudge" onclick="nudgeAltLine(' + index + ',1)" aria-label="Half point up">+</button>'
        + '</div>'
        + '<input type="range" class="stat-slider alt-slider" id="alt-range-' + index + '" min="0" max="' + (steps.length - 1) + '" value="' + startIdx + '" oninput="updateAltLine(' + index + ')">'
        + '<div class="alt-line-note" id="alt-line-note-' + index + '"></div>'
        + '<button type="button" class="bet-btn alt-use-btn" onclick="pickAltSpread(' + index + ', this)"><span class="bet-btn-label">Use this line</span></button>';

    updateAltLine(index, true);
}

function altLineAt(index) {
    var slider = document.getElementById('alt-range-' + index);
    if (!slider || !activeAltPick) return null;
    var v = activeAltPick.steps[Number(slider.value)];
    return v == null ? null : v;
}

function updateAltLine(index, keepSelection) {
    if (!activeAltPick || activeAltPick.index !== index) return;
    var line = altLineAt(index);
    if (line == null) return;

    var display = document.getElementById('alt-line-val-' + index);
    if (display) display.textContent = activeAltPick.teamName + ' ' + ccAltSpread.formatLine(line);

    var suggested = ccAltSpread.suggestedOdds(activeAltPick.base, line);
    var note = document.getElementById('alt-line-note-' + index);
    if (note) {
        if (activeAltPick.base == null) {
            note.textContent = 'No book line for this game — set the odds yourself.';
        } else if (line === Math.round(activeAltPick.base * 2) / 2) {
            note.textContent = 'The book number · est. ' + formatOdds(suggested);
        } else {
            note.textContent = 'Book has ' + ccAltSpread.formatLine(activeAltPick.base)
                + ' · est. ' + formatOdds(suggested);
        }
    }

    // Moving the line invalidates the price the user already agreed to, so make
    // them press Use again rather than silently submitting a stale pairing.
    if (!keepSelection) {
        var wrap = document.getElementById('alt-spread-' + index);
        if (wrap) wrap.querySelectorAll('.alt-use-btn').forEach(function (b) { b.classList.remove('selected'); });
        if (selectedBet && selectedBet.isAlt) {
            selectedBet = null;
            var submitBtn = document.getElementById('btn-submit-' + index);
            if (submitBtn) submitBtn.disabled = true;
        }
    }
}

function nudgeAltLine(index, direction) {
    var slider = document.getElementById('alt-range-' + index);
    if (!slider) return;
    var next = Number(slider.value) + direction;
    if (next < 0 || next > Number(slider.max)) return;
    slider.value = next;
    updateAltLine(index);
}

function pickAltSpread(index, btn) {
    if (!activeAltPick || activeAltPick.index !== index) return;
    var line = altLineAt(index);
    if (line == null) return;

    var board = document.getElementById('bet-board-' + index);
    if (board) board.querySelectorAll('.bet-btn').forEach(function (b) { b.classList.remove('selected'); });
    btn.classList.add('selected');

    var suggested = ccAltSpread.suggestedOdds(activeAltPick.base, line);
    selectedBet = {
        index: index,
        betType: 'spread',
        selection: activeAltPick.teamName + ' ' + ccAltSpread.formatLine(line),
        line: line,
        odds: suggested,
        teamSide: activeAltPick.side,
        isAlt: true
    };

    // The estimate is a starting point — whatever price the book actually shows
    // belongs in this box, and it's what gets stored.
    var oddsInput = document.getElementById('custom-odds-' + index);
    if (oddsInput) oddsInput.value = suggested == null ? '' : suggested;

    var submitBtn = document.getElementById('btn-submit-' + index);
    if (submitBtn) submitBtn.disabled = false;
}

/* ── Stat O/U: team → category → slider → over/under ── */

function pickStatTeam(index, side, btn) {
    var section = document.getElementById('bb-stats-' + index);
    if (!section) return;
    section.querySelectorAll('.stat-team-btn').forEach(function (b) { b.classList.remove('selected'); });
    btn.classList.add('selected');

    var game = activePick && activePick.game;
    var teamName = side === 'home' ? (game && game.homeTeam || 'Home') : (game && game.awayTeam || 'Away');
    activeStatPick = { index: index, side: side, teamName: teamName, cat: null };

    // Render stat category chips
    var catsEl = document.getElementById('stat-cats-' + index);
    if (catsEl) {
        catsEl.innerHTML = STAT_CATS.map(function (c) {
            return '<button type="button" class="stat-cat-chip" onclick="pickStatCat(' + index + ',\'' + c.key + '\',this)">' + c.label + '</button>';
        }).join('');
    }
    // Clear slider
    var sliderEl = document.getElementById('stat-slider-' + index);
    if (sliderEl) sliderEl.innerHTML = '';
}

function pickStatCat(index, catKey, btn) {
    if (!activeStatPick || activeStatPick.index !== index) return;
    var section = document.getElementById('bb-stats-' + index);
    if (section) section.querySelectorAll('.stat-cat-chip').forEach(function (b) { b.classList.remove('selected'); });
    btn.classList.add('selected');

    var cat = STAT_CATS.find(function (c) { return c.key === catKey; });
    if (!cat) return;
    activeStatPick.cat = cat;

    renderStatSlider(index, cat);
}

function renderStatSlider(index, cat) {
    var wrap = document.getElementById('stat-slider-' + index);
    if (!wrap) return;

    var steps = [];
    for (var v = cat.min; v <= cat.max; v = Math.round((v + cat.step) * 100) / 100) {
        steps.push(v);
    }
    var defaultIdx = 0;
    var minDist = Infinity;
    steps.forEach(function (s, i) {
        var d = Math.abs(s - cat.defaultLine);
        if (d < minDist) { minDist = d; defaultIdx = i; }
    });

    wrap.innerHTML =
        '<div class="stat-slider-row">'
        + '<span class="stat-slider-min">' + cat.min + '</span>'
        + '<input type="range" class="stat-slider" id="stat-range-' + index + '" min="0" max="' + (steps.length - 1) + '" value="' + defaultIdx + '" oninput="updateStatLine(' + index + ')">'
        + '<span class="stat-slider-max">' + cat.max + '</span>'
        + '</div>'
        + '<div class="stat-line-display" id="stat-line-val-' + index + '">' + steps[defaultIdx] + '</div>'
        + '<div class="stat-ou-btns">'
        + '<button type="button" class="bet-btn stat-ou-btn" onclick="pickStatOU(' + index + ',\'over\',this)"><span class="bet-btn-label">Over</span></button>'
        + '<button type="button" class="bet-btn stat-ou-btn" onclick="pickStatOU(' + index + ',\'under\',this)"><span class="bet-btn-label">Under</span></button>'
        + '</div>';

    wrap.dataset.steps = JSON.stringify(steps);
}

function updateStatLine(index) {
    var slider = document.getElementById('stat-range-' + index);
    var display = document.getElementById('stat-line-val-' + index);
    var wrap = document.getElementById('stat-slider-' + index);
    if (!slider || !display || !wrap) return;
    var steps = JSON.parse(wrap.dataset.steps || '[]');
    display.textContent = steps[slider.value] != null ? steps[slider.value] : slider.value;

    // Deselect over/under when line changes
    wrap.querySelectorAll('.stat-ou-btn').forEach(function (b) { b.classList.remove('selected'); });
    var submitBtn = document.getElementById('btn-submit-' + index);
    if (submitBtn) submitBtn.disabled = true;
}

function pickStatOU(index, direction, btn) {
    if (!activeStatPick || !activeStatPick.cat) return;
    var wrap = document.getElementById('stat-slider-' + index);
    if (!wrap) return;
    wrap.querySelectorAll('.stat-ou-btn').forEach(function (b) { b.classList.remove('selected'); });
    btn.classList.add('selected');

    // Also deselect any standard bet buttons
    var board = document.getElementById('bet-board-' + index);
    if (board) board.querySelectorAll('.bet-btn:not(.stat-ou-btn):not(.bet-btn-custom)').forEach(function (b) { b.classList.remove('selected'); });

    var slider = document.getElementById('stat-range-' + index);
    var steps = JSON.parse(wrap.dataset.steps || '[]');
    var line = steps[slider.value];

    var cat = activeStatPick.cat;
    var team = activeStatPick.teamName;
    var sel = team + ' ' + (direction === 'over' ? 'Over' : 'Under') + ' ' + line + ' ' + cat.label;

    selectedBet = {
        index: index,
        betType: 'stat_over_under',
        selection: sel,
        line: line,
        odds: -110,
        statCategory: cat.key,
        statTeamSide: activeStatPick.side
    };

    var oddsInput = document.getElementById('custom-odds-' + index);
    if (oddsInput) oddsInput.value = -110;

    var submitBtn = document.getElementById('btn-submit-' + index);
    if (submitBtn) submitBtn.disabled = false;
}

async function submitLegNew(index) {
    if (!activePick || !selectedBet) return;

    // Read before refresh() clears activePick — it's the anchor afterwards.
    var contributor = activePick.contributor;

    var oddsInput = document.getElementById('custom-odds-' + index);
    var finalOdds = oddsInput && oddsInput.value ? Number(oddsInput.value) : selectedBet.odds;

    if (!finalOdds) { alert('Enter the odds'); return; }

    try {
        var res = await fetch('/betting/' + activePick.parlayId + '/legs', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contributor: activePick.contributor,
                gameId: activePick.gameId,
                betType: selectedBet.betType,
                selection: selectedBet.selection,
                line: selectedBet.line,
                odds: finalOdds,
                teamSide: selectedBet.teamSide || null,
                statCategory: selectedBet.statCategory || null,
                statTeamSide: selectedBet.statTeamSide || null
            })
        });
        if (res.ok) {
            if (window.ccToast) ccToast.success('Leg submitted');
            activePick = null;
            selectedBet = null;
            await refresh();
            scrollLegIntoView(contributor);
        } else {
            var data = await res.json();
            if (window.ccToast) ccToast.error(data.message || 'Failed to submit');
        }
    } catch (e) {
        if (window.ccToast) ccToast.error('Failed to submit leg');
    }
}

var editingLeg = null;

function editLeg(parlayId, contributor) {
    editingLeg = { parlayId: parlayId, contributor: contributor };
    var parlay = parlays.find(function (p) { return p._id === parlayId; });
    if (!parlay) return;
    var leg = parlay.legs.find(function (l) { return l.contributor === contributor; });
    if (!leg) return;
    leg.gameId = null;
    renderCurrentParlay();
    scrollLegIntoView(contributor, 'start');
}

async function createParlay() {
    try {
        var prevWager = null;
        var prev = parlays.filter(function (p) { return p.week < currentWeek && p.wager; })
            .sort(function (a, b) { return b.week - a.week; });
        if (prev.length) prevWager = prev[0].wager;

        var res = await fetch('/betting', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ season: currentSeason, week: currentWeek, wager: prevWager })
        });
        if (res.ok) {
            if (window.ccToast) ccToast.success('Parlay created for Week ' + currentWeek);
            await refresh();
        } else {
            var data = await res.json();
            if (window.ccToast) ccToast.error(data.message || 'Failed to create');
        }
    } catch (e) {
        if (window.ccToast) ccToast.error('Failed to create parlay');
    }
}

function toggleAdminEdit() {
    adminEditing = !adminEditing;
    renderCurrentParlay();
}

async function updateWager(parlayId, value) {
    try {
        var res = await fetch('/betting/' + parlayId, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ wager: (value === '' || value == null) ? null : Number(value) })
        });
        if (res.ok) {
            if (window.ccToast) ccToast.success('Wager updated');
            await refresh();
        }
    } catch (e) { /* skip */ }
}

async function updatePlacedBy(parlayId, value) {
    try {
        var res = await fetch('/betting/' + parlayId, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ placedBy: value || null })
        });
        if (res.ok) {
            if (window.ccToast) ccToast.success('Placed by updated');
            await refresh();
        }
    } catch (e) { /* skip */ }
}

function decimalToAmerican(dec) {
    if (dec >= 2) return Math.round((dec - 1) * 100);
    if (dec > 1) return Math.round(-100 / (dec - 1));
    return 0;
}

function computeBoostedOdds(parlay) {
    if (!parlay.parlayOdds || !parlay.boostPct) return null;
    return decimalToAmerican(boostDecimal(americanToDecimal(parlay.parlayOdds), parlay.boostPct));
}

async function updateBoost(parlayId, field, value) {
    try {
        var parlay = parlays.find(function (p) { return p._id === parlayId; });
        if (!parlay) return;

        // An emptied box means "unset", not zero — Number('') is 0, and a 0
        // boost cap would read as a real cap that boosts nothing.
        var num = (value === '' || value == null) ? null : Number(value);
        parlay[field] = num;
        var body = {};
        body[field] = num;

        // Keep the boosted readout in step with the raw odds + percentage it's
        // derived from. Crucially it has to be CLEARED when the derivation no
        // longer holds: leaving a stale number behind kept a parlay boosted
        // after the admin emptied the Boost % box, which is the undo this panel
        // exists to provide.
        if (field !== 'boostedOdds') {
            body.boostedOdds = computeBoostedOdds(parlay);
            parlay.boostedOdds = body.boostedOdds;
        }

        var res = await fetch('/betting/' + parlayId, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        if (res.ok) {
            if (window.ccToast) ccToast.success('Boost updated');
            await refresh();
        }
    } catch (e) { /* skip */ }
}

async function resolveLeg(parlayId, contributor, result) {
    try {
        var res = await fetch('/betting/' + parlayId + '/legs/' + contributor + '/resolve', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ result: result })
        });
        if (res.ok) {
            if (window.ccToast) ccToast.success('Leg marked as ' + result);
            var data = await res.json();
            if (data.status !== 'pending') {
                var m = getSeenMap();
                delete m[parlayId];
                localStorage.setItem(SEEN_KEY, JSON.stringify(m));
            }
            await refresh();
        } else {
            var data = await res.json();
            if (window.ccToast) ccToast.error(data.message || 'Failed to resolve');
        }
    } catch (e) {
        if (window.ccToast) ccToast.error('Failed to resolve leg');
    }
}

async function refresh() {
    await Promise.all([loadParlays(), loadGames(), loadMemberNames()]);
    renderCurrentParlay();
    renderHistory();
    loadSeasonSummary();
}

document.getElementById('week-prev').addEventListener('click', function () {
    if (currentWeek > 0) { currentWeek--; updateWeekDisplay(); refresh(); }
});
document.getElementById('week-next').addEventListener('click', function () {
    currentWeek++;
    updateWeekDisplay();
    refresh();
});

function updateWeekDisplay() {
    document.getElementById('week-label').textContent = 'Week ' + currentWeek;
}

async function init() {
    myUserId = getMyUserId();
    currentSeason = window.APP_YEAR || new Date().getFullYear();

    // Open on the week people are actually betting. Week 0 is a real week here
    // (early-season games), so it stays reachable with the arrows — it just
    // isn't where the page should land in November.
    if (window.ccCurrentWeek) {
        var wk = await window.ccCurrentWeek.get(currentSeason);
        if (wk != null) currentWeek = wk;
    }

    updateWeekDisplay();
    await refresh();
}

init();
