// Live draft board — a commissioner-only draft-night assistant.
//
// Joins the same socket room the draft room uses and re-pulls the board on every
// pick. Deliberately re-fetches rather than re-deriving the advice in the
// browser: the scarcity math lives in modules/draft-board.js and a second copy
// here would be a second thing to keep correct. A draft is 60 picks over a
// couple of hours, and the server caches the expensive projection half, so the
// re-fetch is cheap and the numbers can never disagree with the server's.

(function () {
    var LEAGUE = window.LEAGUE_CODE;
    var SEASON = window.APP_YEAR;
    // The app's user id lives in the Auth0 profile's nested metadata, NOT as an
    // `_id` on userState — userState is the OIDC user, whose only identity keys
    // are sub/email. Same accessor draftRoom.js uses (setUserContext).
    var META = (window.userState && window.userState.user_metadata) || {};
    var ME = (META.metadata && META.metadata.userId) || '';

    var data = null;          // last board payload
    var filter = '';
    var socket = null;

    var $ = function (sel) { return document.querySelector(sel); };
    function el(tag, cls, txt) {
        var n = document.createElement(tag);
        if (cls) n.className = cls;
        if (txt != null) n.textContent = txt;
        return n;
    }
    function fmt(n) { return n == null ? '—' : Number(n).toFixed(1); }

    // Logos ride along on the projections; every other surface (chips, roster,
    // pick log) looks them up by team id rather than carrying its own copy.
    var logoById = {};
    function indexLogos() {
        logoById = {};
        (data.projections || []).forEach(function (t) { if (t.logo) logoById[String(t.id)] = t.logo; });
    }
    // An <img> for a team, or nothing at all — a missing or broken logo must
    // never leave a ghost box in a table row.
    function logo(id, cls) {
        var src = logoById[String(id)];
        if (!src) return null;
        var img = el('img', cls || 'db-logo');
        img.src = src;
        img.alt = '';
        img.loading = 'lazy';
        img.addEventListener('error', function () { img.remove(); });
        return img;
    }
    function withLogo(cell, id, text) {
        var img = logo(id);
        if (img) cell.appendChild(img);
        cell.appendChild(el('span', null, text));
        return cell;
    }

    // ---- data ---------------------------------------------------------------

    async function load(refresh) {
        var url = '/draft/board/' + encodeURIComponent(LEAGUE) + '/' + encodeURIComponent(SEASON)
            + '?userId=' + encodeURIComponent(ME) + (refresh ? '&refresh=1' : '');
        var res = await fetch(url, { headers: { Accept: 'application/json' } });
        if (!res.ok) {
            var msg = await res.json().catch(function () { return {}; });
            renderError(msg.message || ('Could not load the board (' + res.status + ')'));
            return;
        }
        data = await res.json();
        render();
    }

    // ---- render -------------------------------------------------------------

    function renderError(text) {
        $('[db-advice]').innerHTML = '';
        $('[db-advice]').appendChild(el('div', 'db-error', text));
    }

    function renderAdvice() {
        var wrap = $('[db-advice]');
        wrap.innerHTML = '';
        var a = data.advice, s = data.schedule;

        if (!s.next) {
            wrap.appendChild(el('div', 'db-done', 'Your draft is complete — all ten picks are in.'));
            return;
        }
        if (!a.take) {
            wrap.appendChild(el('div', 'db-done', 'No teams left on the board.'));
            return;
        }

        var head = el('div', 'db-advice-head');
        head.appendChild(el('span', 'db-eyebrow',
            s.onTheClock ? 'You are on the clock' : ('Your next pick — #' + s.next.overall + ', round ' + s.next.round)));
        wrap.appendChild(head);

        var main = el('div', 'db-advice-main');
        var pick = el('div', 'db-pick');
        var hero = logo(a.take.id, 'db-pick-logo');
        if (hero) pick.appendChild(hero);
        var pickText = el('div', 'db-pick-text');
        pickText.appendChild(el('div', 'db-pick-label', 'Take'));
        pickText.appendChild(el('div', 'db-pick-team', a.take.school));
        var cap = a.captain || {};
        pickText.appendChild(el('div', 'db-pick-proj',
            cap.gain > 0
                ? fmt(a.take.total) + ' projected  +  ' + fmt(cap.gain) + ' captain  =  ' + fmt(a.effective)
                : fmt(a.take.total) + ' projected'));
        pick.appendChild(pickText);
        main.appendChild(pick);

        // The scarcity read: what waiting actually costs.
        // `cost` and `after` arrive on different halves of the payload, so the
        // no-more-turns branch checks both rather than trusting them to agree.
        var why = el('div', 'db-why');
        if (a.cost == null || !s.after) {
            why.appendChild(el('p', null, 'This is your last pick, so there is nothing to weigh against it — just take the best team left.'));
        } else {
            var gapTxt = s.gap + (s.gap === 1 ? ' pick' : ' picks') + ' before your next turn (#' + s.after.overall + ')';
            var p = el('p', null, '');
            p.appendChild(document.createTextNode(gapTxt + '. If you passed and waited, the best you should expect is '));
            p.appendChild(el('strong', null, (data.advice.safeToWait[0] || {}).school || 'nothing better'));
            p.appendChild(document.createTextNode(' — costing you about '));
            p.appendChild(el('strong', null, fmt(a.cost) + ' points'));
            p.appendChild(document.createTextNode('.'));
            why.appendChild(p);
            why.appendChild(el('p', 'db-caveat',
                'Assumes every other manager takes the best team left, which this league does not — treat it as a floor, not a forecast.'));
        }
        if (cap.enabled) why.appendChild(captainLine(cap, a));
        main.appendChild(why);
        wrap.appendChild(main);

        if (a.atRisk.length) {
            wrap.appendChild(listRow('Likely gone by your next turn', a.atRisk, 'db-risk'));
        }
        if (a.safeToWait.length) {
            wrap.appendChild(listRow('Should still be there — no need to reach', a.safeToWait, 'db-safe'));
        }
    }

    // What the captain is worth for THIS pick. Which of the three states shows is
    // the useful part: an empty roster means this pick also picks your season
    // captain; a settled anchor means per-week value can be ignored for the rest
    // of the draft; in between, the upgrade gets priced.
    function captainLine(cap) {
        var p = el('p', 'db-captain');
        if (cap.gain > 0) {
            p.appendChild(document.createTextNode(
                cap.anchorSchool ? 'Captain upgrade: ' : 'This also picks your season captain: '));
            p.appendChild(el('strong', null, '+' + fmt(cap.gain) + ' points'));
            p.appendChild(document.createTextNode(cap.anchorSchool
                ? ' over ' + cap.anchorSchool + ', which you would captain otherwise.'
                : ' on top of its board value \u2014 the captain doubles regular-season points every week.'));
        } else if (cap.settled) {
            p.appendChild(document.createTextNode('Captain settled \u2014 '));
            p.appendChild(el('strong', null, cap.anchorSchool || 'your anchor'));
            p.appendChild(document.createTextNode(' beats everything left on the board, so ignore Cap/wk for the rest of the draft.'));
        } else {
            p.appendChild(document.createTextNode('No captain upgrade here \u2014 '));
            p.appendChild(el('strong', null, cap.anchorSchool || 'your anchor'));
            p.appendChild(document.createTextNode(' still scores more per week.'));
        }
        return p;
    }

    function listRow(label, teams, cls) {
        var row = el('div', 'db-listrow ' + cls);
        row.appendChild(el('div', 'db-listrow-label', label));
        var ul = el('div', 'db-chips');
        teams.forEach(function (t) {
            var c = el('span', 'db-chip');
            var ci = logo(t.id, 'db-chip-logo');
            if (ci) c.appendChild(ci);
            c.appendChild(el('span', 'db-chip-name', t.school));
            c.appendChild(el('span', 'db-chip-val', fmt(t.total)));
            ul.appendChild(c);
        });
        row.appendChild(ul);
        return row;
    }

    function renderBoard() {
        var tbody = $('[db-board]');
        tbody.innerHTML = '';
        var taken = {};
        (data.draft.picks || []).forEach(function (p) { if (p.teamId != null) taken[String(p.teamId)] = true; });
        var q = filter.trim().toLowerCase();
        var rows = data.projections.filter(function (t) {
            if (taken[String(t.id)]) return false;
            if (!q) return true;
            return t.school.toLowerCase().indexOf(q) !== -1
                || (t.conference || '').toLowerCase().indexOf(q) !== -1;
        });
        // With the captain priced in the recommended team is not necessarily the
        // top row — the board stays in market order and the highlight moves.
        var best = data.advice.take;
        // Bars are scaled to the best team STILL on the board, so the tier cliffs
        // stay legible as the top gets picked away.
        var top = rows.length ? rows[0].total : 1;
        rows.slice(0, 120).forEach(function (t, i) {
            var tr = el('tr');
            if (best && t.id === best.id) tr.className = 'db-best';
            tr.appendChild(el('td', 'db-num db-rank', String(i + 1)));
            tr.appendChild(withLogo(el('td', 'db-team'), t.id, t.school));
            tr.appendChild(el('td', 'db-conf', t.conference || '—'));
            var projCell = el('td', 'db-num db-proj');
            var bar = el('span', 'db-bar');
            bar.style.width = Math.max(2, Math.round((t.total / (top || 1)) * 100)) + '%';
            projCell.appendChild(bar);
            projCell.appendChild(el('span', 'db-proj-val', fmt(t.total)));
            tr.appendChild(projCell);
            tr.appendChild(el('td', 'db-num', fmt(t.regular)));
            tr.appendChild(el('td', 'db-num', fmt(t.post)));
            tr.appendChild(el('td', 'db-num', t.perWeek == null ? '—' : t.perWeek.toFixed(2)));
            tbody.appendChild(tr);
        });
        $('[db-count]').textContent = rows.length + ' available';
    }

    function renderRoster() {
        var ol = $('[db-roster]');
        ol.innerHTML = '';
        if (!data.roster.length) {
            ol.appendChild(el('li', 'db-empty', 'No picks yet.'));
            return;
        }
        var total = 0;
        data.roster.forEach(function (r) {
            total += r.total || 0;
            var li = el('li');
            li.appendChild(el('span', 'db-r-round', 'R' + r.round));
            li.appendChild(withLogo(el('span', 'db-r-team'), r.id, r.school));
            li.appendChild(el('span', 'db-r-val', fmt(r.total)));
            ol.appendChild(li);
        });
        var sum = el('li', 'db-r-total');
        sum.appendChild(el('span', 'db-r-round', ''));
        sum.appendChild(el('span', 'db-r-team', 'Projected total'));
        sum.appendChild(el('span', 'db-r-val', fmt(total)));
        ol.appendChild(sum);
    }

    function renderLog() {
        var ol = $('[db-log]');
        ol.innerHTML = '';
        var picks = (data.draft.picks || []).slice().sort(function (a, b) { return b.overall - a.overall; });
        if (!picks.length) {
            ol.appendChild(el('li', 'db-empty', 'Draft has not started.'));
            return;
        }
        picks.slice(0, 40).forEach(function (p) {
            var li = el('li');
            if (String(p.userId) === String(ME)) li.className = 'db-mine';
            li.appendChild(el('span', 'db-l-num', '#' + p.overall));
            li.appendChild(withLogo(el('span', 'db-l-team'), p.teamId, p.school));
            ol.appendChild(li);
        });
    }

    function render() {
        if (!data) return;
        indexLogos();
        $('[db-source]').textContent = 'Ranked bonuses: ' + data.rankedSource;
        renderAdvice();
        renderBoard();
        renderRoster();
        renderLog();
    }

    // ---- live ---------------------------------------------------------------

    function setLive(state, text) {
        var strip = $('[db-live]');
        strip.className = 'db-live db-live-' + state;
        $('[db-live-text]').textContent = text;
    }

    async function connect() {
        try {
            var res = await fetch('/draft-token', { headers: { Accept: 'application/json' } });
            var token = (await res.json()).token;
            socket = io({ auth: { token } });
            socket.on('connect', function () {
                setLive('on', 'live');
                socket.emit('join-draft', { league: LEAGUE, season: SEASON });
            });
            socket.on('disconnect', function () { setLive('off', 'disconnected'); });
            socket.io.on('reconnect', function () { setLive('on', 'live'); load(); });
            // Any change to the draft re-pulls the board; the server owns the math.
            socket.on('pick-made', function () { load(); });
            socket.on('draft-state', function () { load(); });
            socket.on('draft-complete', function () { load(); });
        } catch (e) {
            setLive('off', 'offline — refresh to update');
        }
    }

    // ---- wire up ------------------------------------------------------------

    document.addEventListener('DOMContentLoaded', function () {
        $('[db-search]').addEventListener('input', function (e) {
            filter = e.target.value;
            if (data) renderBoard();
        });
        $('[db-refresh]').addEventListener('click', function () { load(true); });
        load();
        connect();
    });
})();
