// Draft Grades page: fetch and render per-manager draft grades for the selected
// season. Read-only; the navbar owns nav behaviors.

function gradesLeagueCode() {
    var stored = window.localStorage.getItem('leagueCode');
    if (stored && stored !== 'undefined') return stored;
    try {
        var meta = userState.user_metadata.metadata || {};
        return meta.league === 'gg' ? 'graham-league' : 'claunts-league';
    } catch (e) {
        return 'claunts-league';
    }
}

function escGrades(s) {
    var d = document.createElement('div');
    d.textContent = String(s == null ? '' : s);
    return d.innerHTML;
}

// Face-cropped avatar or a colored initials fallback.
function gradesAvatar(m) {
    if (m.avatarUrl) {
        var src = m.avatarUrl.indexOf('/upload/') !== -1
            ? m.avatarUrl.replace('/upload/', '/upload/c_fill,g_face,w_96,h_96,q_auto,f_auto/')
            : m.avatarUrl;
        return '<span class="gg-avatar"><img src="' + escGrades(src) + '" alt=""></span>';
    }
    var initials = (m.name || '?').split(' ').map(function (p) { return p[0]; }).join('').slice(0, 2).toUpperCase();
    return '<span class="gg-avatar gg-avatar-initials">' + escGrades(initials) + '</span>';
}

function teamLogo(logo) {
    return logo ? '<img class="gg-logo" src="' + escGrades(logo) + '" alt="">' : '';
}

// "+7" for a positive value, "-4" otherwise (steal vs bust).
function signed(v) {
    return (v > 0 ? '+' : '') + v;
}

function pickLine(kind, p) {
    if (!p) return '';
    var cls = kind === 'best' ? 'gg-steal' : 'gg-bust';
    var label = kind === 'best' ? 'Best value' : 'Biggest reach';
    return '<div class="gg-pick ' + cls + '">'
        + '<span class="gg-pick-label">' + label + '</span>'
        + '<span class="gg-pick-team">' + teamLogo(p.logo) + escGrades(p.school) + '</span>'
        + '<span class="gg-pick-meta">R' + p.round + ' · ' + p.points + ' pts · ' + signed(p.value) + '</span>'
        + '</div>';
}

function renderGrades(data) {
    var el = document.getElementById('grades-container');
    if (data.pending || !data.managers || !data.managers.length) {
        el.innerHTML = '<p class="grades-empty">'
            + (data.pending
                ? 'Grades populate once the season’s games are scored.'
                : 'No draft found for this season.')
            + '</p>';
        return;
    }

    el.innerHTML = data.managers.map(function (m) {
        var tier = (m.grade || '').charAt(0).toLowerCase();  // a / b / c
        return '<div class="gg-card gg-tier-' + escGrades(tier) + '">'
            + '<div class="gg-card-head">'
            +   gradesAvatar(m)
            +   '<div class="gg-who">'
            +     '<span class="gg-name">' + escGrades(m.franchise || m.name) + '</span>'
            +     (m.franchise ? '<span class="gg-sub">' + escGrades(m.name) + '</span>' : '')
            +   '</div>'
            +   '<span class="gg-grade">' + escGrades(m.grade) + '</span>'
            + '</div>'
            + '<div class="gg-stats">'
            +   '<div class="gg-stat"><span class="gg-stat-val">' + m.totalPoints + '</span><span class="gg-stat-lbl">roster pts</span></div>'
            +   '<div class="gg-stat"><span class="gg-stat-val">' + signed(m.avgValue) + '</span><span class="gg-stat-lbl">avg value / pick</span></div>'
            + '</div>'
            + pickLine('best', m.bestPick)
            + pickLine('worst', m.worstPick)
            + '</div>';
    }).join('');
}

async function loadGrades() {
    var season = document.querySelector('[grades-season]').value;
    var league = gradesLeagueCode();
    var el = document.getElementById('grades-container');
    el.innerHTML = '<p class="grades-empty">Loading…</p>';
    try {
        var res = await fetch('/draft/grades/' + encodeURIComponent(league) + '/' + encodeURIComponent(season), {
            headers: { 'Accept': 'application/json' }
        });
        var data = await res.json();
        if (res.status !== 200) throw new Error((data && data.message) || res.status);
        renderGrades(data);
    } catch (err) {
        el.innerHTML = '<p class="grades-empty">Couldn’t load grades. Try again.</p>';
        console.error('grades load failed:', err);
    }
}

window.addEventListener('DOMContentLoaded', function () {
    var sel = document.querySelector('[grades-season]');
    if (sel) sel.addEventListener('change', loadGrades);
    loadGrades();
});
