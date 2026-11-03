// Shared renderer for draft-grade cards. Loaded on the draft room (immediate
// post-draft feedback) and the user profile (later review).
//
//   renderDraftGrades(container, payload, { currentUserId, title })
//     payload = { league, season, managers: [...] }  (from /draft/grades/:league/:season)
(function () {
    function esc(s) { var d = document.createElement('div'); d.textContent = String(s == null ? '' : s); return d.innerHTML; }
    // value = draft slot − projected-points rank among every drafted team
    // (draft-grades computeGrades), so say it in picks, not "slots".
    function slotWords(v) {
        var n = Math.abs(v);
        return 'drafted ' + n + (n === 1 ? ' pick ' : ' picks ') + (v > 0 ? 'later' : 'earlier') + ' than projected';
    }

    function avatar(m) {
        if (m.avatarUrl) {
            var src = m.avatarUrl.indexOf('/upload/') !== -1
                ? m.avatarUrl.replace('/upload/', '/upload/c_fill,g_face,w_96,h_96,q_auto,f_auto/')
                : m.avatarUrl;
            return '<span class="gg-avatar"><img src="' + esc(src) + '" alt=""></span>';
        }
        var initials = (m.name || '?').split(' ').map(function (p) { return p[0]; }).join('').slice(0, 2).toUpperCase();
        return '<span class="gg-avatar gg-avatar-initials">' + esc(initials) + '</span>';
    }

    function logo(l) { return l ? '<img class="gg-logo" src="' + esc(l) + '" alt="">' : ''; }

    function pickLine(kind, p) {
        if (!p) return '';
        var cls = kind === 'best' ? 'gg-steal' : 'gg-bust';
        var label = kind === 'best' ? 'Best value' : 'Biggest reach';
        var teamInner = logo(p.logo) + esc(p.school);
        var team = p.teamId != null
            ? '<a class="gg-pick-team gg-tlink" href="/team?team=' + esc(p.teamId) + '" target="_blank" rel="noopener">' + teamInner + '</a>'
            : '<span class="gg-pick-team">' + teamInner + '</span>';
        return '<div class="gg-pick ' + cls + '">'
            + '<span class="gg-pick-label">' + label + '</span>'
            + team
            + '<span class="gg-pick-meta">R' + p.round + ' · ' + p.points + ' proj pts · ' + slotWords(p.value) + '</span>'
            + '</div>';
    }

    // Thin two-segment bar showing how projected points split between the
    // regular-season floor and postseason upside (football: CFP + conf title +
    // bowl; basketball: NCAA tournament + conference tournament + upsets).
    function splitBar(m) {
        var reg = m.regPoints || 0, post = m.postPoints || 0, tot = reg + post;
        if (tot <= 0) return '';
        var regPct = Math.round(reg / tot * 100);
        return '<div class="gg-split">'
            + '<div class="gg-split-bar">'
            +   '<span class="gg-split-reg" style="width:' + regPct + '%"></span>'
            +   '<span class="gg-split-post" style="width:' + (100 - regPct) + '%"></span>'
            + '</div>'
            + '<div class="gg-split-legend">'
            +   '<span class="gg-split-lg"><i class="gg-dot-reg"></i>' + reg + ' regular</span>'
            +   '<span class="gg-split-lg"><i class="gg-dot-post"></i>' + post + ' postseason</span>'
            + '</div>'
            + '</div>';
    }

    // Expected teams that make the field: the CFP for football, the NCAA
    // bracket for basketball (the server sends ncaaCount instead of
    // cfpCount, so a basketball count can never sit under a CFP label).
    // It is a sum of probabilities, so a fraction reads as an estimate
    // ("~4.5"), never a range that sounds like a promise. My Team's tile
    // reads this too, so both surfaces say the same thing.
    function makeCount(m) {
        var hoops = m.ncaaCount != null;
        var v = Number(hoops ? m.ncaaCount : m.cfpCount) || 0;
        return {
            value: v === Math.round(v) ? String(v) : '~' + v,
            label: hoops ? 'expected in the NCAA field' : 'expected in the CFP'
        };
    }
    window.draftGradeFieldCount = makeCount;

    function card(m, currentUserId) {
        var tier = (m.grade || '').charAt(0).toLowerCase();
        var you = (currentUserId && String(m.userId) === String(currentUserId)) ? ' gg-you' : '';
        var whoInner = avatar(m)
            + '<div class="gg-who">'
            +   '<span class="gg-name">' + esc(m.franchise || m.name) + (you ? ' <span class="gg-youtag">you</span>' : '') + '</span>'
            +   (m.franchise ? '<span class="gg-sub">' + esc(m.name) + '</span>' : '')
            + '</div>';
        var who = m.userId != null
            ? '<a class="gg-who-link" href="/userHome?user=' + esc(m.userId) + '" target="_blank" rel="noopener">' + whoInner + '</a>'
            : whoInner;
        return '<div class="gg-card gg-tier-' + esc(tier) + you + '">'
            + '<div class="gg-card-head">'
            +   who
            +   '<span class="gg-grade">' + esc(m.grade) + '</span>'
            + '</div>'
            + '<div class="gg-stats">'
            +   '<div class="gg-stat"><span class="gg-stat-val">' + m.projPoints + '</span><span class="gg-stat-lbl">proj points</span></div>'
            +   '<div class="gg-stat"><span class="gg-stat-val">' + m.projWins + '</span><span class="gg-stat-lbl">avg wins / team</span></div>'
            +   '<div class="gg-stat"><span class="gg-stat-val">' + makeCount(m).value + '</span><span class="gg-stat-lbl">' + makeCount(m).label + '</span></div>'
            + '</div>'
            + splitBar(m)
            + pickLine('best', m.bestPick)
            + pickLine('worst', m.worstPick)
            + '</div>';
    }

    window.renderDraftGrades = function (container, payload, opts) {
        opts = opts || {};
        if (!container) return;
        if (!payload || !payload.managers || !payload.managers.length) {
            container.innerHTML = '<p class="grades-empty">No draft grades for this season.</p>';
            return;
        }
        var head = opts.title ? '<h2 class="gg-title">' + esc(opts.title) + '</h2>' : '';
        var note = opts.note ? '<p class="grades-note">' + esc(opts.note) + '</p>' : '';
        container.innerHTML = head + note
            + '<div class="grades-grid">'
            + payload.managers.map(function (m) { return card(m, opts.currentUserId); }).join('')
            + '</div>';
    };

    // Render just one manager's card (used by the profile chip → expand panel).
    window.renderDraftGradeCard = function (container, manager, opts) {
        opts = opts || {};
        if (!container || !manager) return;
        var note = opts.note ? '<p class="grades-note">' + esc(opts.note) + '</p>' : '';
        container.innerHTML = note
            + '<div class="grades-grid grades-grid-single">'
            + card(manager, opts.currentUserId)
            + '</div>';
    };
})();
