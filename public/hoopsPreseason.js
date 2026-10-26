// The "Preseason ratings" card on the basketball admin page (#544).
//
// Torvik's preseason T-Rank ranks the draft pool and seeds quadrant scoring
// until live ratings take over, so it is refreshed once, right before the
// draft. Fetch (or paste), Preview, Apply — and nothing is written until
// Apply, which the server re-checks from scratch.
//
// Its own container and script rather than a fifth card in hoopsAdmin.js:
// that page re-renders its whole <main> on every update, which would wipe a
// 300 KB paste out of the textarea. Here the shell is built once and only the
// status line and the result area are redrawn.

(function () {
    var root = document.getElementById('hoops-preseason');
    if (!root) return;

    var esc = window.ccSportPage.esc;
    var state = { info: null, preview: null, busy: false, armed: false };

    function day(iso) {
        if (!iso) return '—';
        var d = new Date(iso);
        return isNaN(d) ? '—' : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    }

    function post(url, body, contentType) {
        return fetch(url, {
            method: 'POST',
            headers: { Accept: 'application/json', 'Content-Type': contentType },
            body: body
        }).then(function (r) {
            return r.text().then(function (text) {
                var b = null;
                try { b = JSON.parse(text); } catch (e) { /* see below */ }
                if (!b) b = { ok: false, problems: ['No reply the page could read (HTTP ' + r.status + ')'] };
                b.status = r.status;
                return b;
            });
        });
    }

    function shell() {
        root.innerHTML = '<div class="sp-h">Preseason ratings</div>'
            + '<section class="sp-card ha-task ha-pre">'
            + '<div class="ha-head"><i class="fa-solid fa-ranking-star"></i><h2>Torvik T-Rank</h2>'
            + '<code data-pre-url></code></div>'
            + '<p class="ha-what">Ranks the draft pool. Scoring uses Torvik\'s current rank, pulled nightly, and falls back to this only for a week with no pull. '
            + 'Refresh once, right before the draft. Nothing is written until you Apply.</p>'
            + '<div class="ha-onfile" data-pre-onfile>Loading…</div>'
            + '<div data-pre-lock></div>'
            + '<div class="ha-actions"><button class="ha-run" data-pre-fetch>Fetch from barttorvik.com</button></div>'
            + '<details class="ha-pre-paste"><summary>Or paste it</summary>'
            + '<p class="ha-what">Open the JSON link above, select all, copy, and paste here. The page source of the '
            + 'T-Rank page works too. A copy of the table itself does not: it loses the team links.</p>'
            + '<textarea class="ha-pre-text" data-pre-text rows="5" spellcheck="false" placeholder="[[1,&quot;Duke&quot;,&quot;ACC&quot;,…"></textarea>'
            + '<div class="ha-actions"><button class="ha-run" data-pre-preview>Preview paste</button></div>'
            + '</details>'
            + '<div data-pre-result></div>'
            + '</section>';
    }

    function renderInfo() {
        var i = state.info;
        var onfile = root.querySelector('[data-pre-onfile]');
        if (!i) return;
        if (i.season == null) { onfile.textContent = 'No basketball season is set.'; return; }
        root.querySelector('[data-pre-url]').textContent = i.url.replace(/^https:\/\//, '');
        var c = i.current;
        onfile.innerHTML = '<small>On file for ' + esc(i.season) + '</small> '
            + esc(c.ranked) + ' / ' + esc(c.teams) + ' teams ranked'
            + (c.importedAt
                ? '<div class="ha-last">Imported ' + esc(day(c.importedAt)) + ' — ' + esc(c.source) + '</div>'
                : (c.source ? '<div class="ha-last">' + esc(c.source) + '</div>' : '<div class="ha-last ha-muted">Never imported</div>'))
            + (c.sources > 1 ? '<div class="ha-warn">' + esc(c.sources) + ' different imports are mixed on file — a refresh fixes it.</div>' : '');
        root.querySelector('[data-pre-lock]').innerHTML = i.locked
            ? '<div class="ha-warn">Locked: basketball ' + esc(i.season) + ' has scored games. A new preseason rank now would re-rank games not yet played. Preview still works.</div>'
            : '';
        renderButtons();
    }

    function renderButtons() {
        root.querySelectorAll('[data-pre-fetch],[data-pre-preview]').forEach(function (b) { b.disabled = state.busy; });
    }

    function problems(list) {
        return '<div class="ha-pre-problems"><b>Not imported.</b><ul>'
            + (list || []).slice(0, 40).map(function (p) { return '<li>' + esc(p) + '</li>'; }).join('')
            + ((list || []).length > 40 ? '<li>…and ' + (list.length - 40) + ' more</li>' : '')
            + '</ul></div>';
    }

    function teamList(rows, withDelta) {
        if (!rows.length) return '<div class="ha-muted">—</div>';
        return '<ol class="ha-pre-list">' + rows.map(function (t) {
            var d = '';
            if (withDelta && t.was != null && t.was !== t.rank) {
                var up = t.was > t.rank;
                d = ' <span class="ha-pre-d ' + (up ? 'up' : 'down') + '">' + (up ? '▲' : '▼') + Math.abs(t.was - t.rank) + '</span>';
            } else if (withDelta && t.was == null) {
                d = ' <span class="ha-pre-d">new</span>';
            }
            return '<li><span class="ha-pre-r">' + esc(t.rank) + '</span>' + esc(t.school) + d + '</li>';
        }).join('') + '</ol>';
    }

    function renderResult(extra) {
        var box = root.querySelector('[data-pre-result]');
        var p = state.preview;
        if (!p) { box.innerHTML = extra || ''; return; }
        if (!p.ok) { box.innerHTML = problems(p.problems) + (extra || ''); return; }
        var c = p.compare;
        var pool = function (label, rows) {
            return rows.length ? '<div class="ha-last"><b>' + label + ' the top ' + esc(c.pool) + ':</b> '
                + rows.map(function (t) { return esc(t.school) + ' (' + esc(t.was == null ? '—' : t.was) + '→' + esc(t.rank) + ')'; }).join(', ') + '</div>' : '';
        };
        var btn = state.info && state.info.locked
            ? '<button class="ha-run" disabled>Locked</button>'
            : state.armed
                ? '<button class="ha-run ha-confirm" data-pre-confirm' + (state.busy ? ' disabled' : '') + '>Write ' + esc(p.counts.matched) + ' teams</button>'
                    + '<button class="ha-cancel" data-pre-cancel>Cancel</button>'
                : '<button class="ha-run" data-pre-apply' + (state.busy ? ' disabled' : '') + '>Apply</button>';
        box.innerHTML = '<div class="ha-pre-ok">All checks passed: ' + esc(p.counts.ratings) + ' ratings, '
            + esc(p.counts.matched) + ' / ' + esc(p.counts.teams) + ' teams matched.</div>'
            + '<div class="ha-last">Will be stamped: ' + esc(p.source) + '</div>'
            + pool('Joins', c.joinsPool) + pool('Leaves', c.leavesPool)
            + '<div class="ha-pre-cols">'
            + '<div><div class="sp-h">Now</div>' + teamList(c.currentTop, false) + '</div>'
            + '<div><div class="sp-h">New</div>' + teamList(c.newTop, true) + '</div>'
            + '</div>'
            + (c.movers.length ? '<div class="sp-h">Biggest movers near the pool</div>' + teamList(c.movers, true) : '')
            + '<div class="ha-actions">' + btn + '</div>' + (extra || '');
    }

    function loadInfo() {
        return fetch('/hoops/admin/preseason', { headers: { Accept: 'application/json' } })
            .then(function (r) { return r.json(); })
            .then(function (i) { state.info = i; renderInfo(); })
            .catch(function () { root.querySelector('[data-pre-onfile]').textContent = 'Could not read what is on file.'; });
    }

    function preview(body, contentType) {
        state.busy = true; state.armed = false; state.preview = null;
        renderButtons();
        renderResult('<div class="ha-last"><i class="fa-solid fa-spinner fa-spin"></i> Checking…</div>');
        return post('/hoops/admin/preseason/preview', body, contentType).then(function (p) {
            state.preview = (p.problems || p.ok) ? p : { ok: false, problems: [p.message || 'Preview failed (HTTP ' + p.status + ')'] };
        }).catch(function (e) {
            state.preview = { ok: false, problems: ['Request failed: ' + e.message] };
        }).then(function () {
            state.busy = false;
            renderButtons();
            renderResult();
        });
    }

    function apply() {
        var p = state.preview;
        state.busy = true;
        renderResult();
        return post('/hoops/admin/preseason/apply', JSON.stringify({ rows: p.rows, origin: p.origin }), 'application/json')
            .then(function (r) {
                // Before any redraw: a result area drawn while busy keeps a
                // disabled Apply, and a failed write says "re-run".
                state.busy = false;
                if (r.ok) {
                    state.preview = null;
                    state.armed = false;
                    renderResult('<div class="ha-pre-ok">Imported: ' + esc(r.stamped) + ' / ' + esc(r.teams) + ' teams now carry a preseason rank.</div>');
                    return loadInfo();
                }
                state.armed = false;
                renderResult(problems(r.problems || [r.message || 'Apply failed (HTTP ' + r.status + ')']));
                // A lock or a partial write both change what is on file.
                return loadInfo();
            })
            .catch(function (e) { state.busy = false; renderResult(problems(['Request failed: ' + e.message])); })
            .then(function () { state.busy = false; renderButtons(); });
    }

    root.addEventListener('click', function (e) {
        if (state.busy) return;
        if (e.target.closest('[data-pre-fetch]')) {
            preview(JSON.stringify({ fetch: true }), 'application/json');
        } else if (e.target.closest('[data-pre-preview]')) {
            preview(root.querySelector('[data-pre-text]').value, 'text/plain');
        } else if (e.target.closest('[data-pre-apply]')) {
            state.armed = true; renderResult();
        } else if (e.target.closest('[data-pre-cancel]')) {
            state.armed = false; renderResult();
        } else if (e.target.closest('[data-pre-confirm]')) {
            apply();
        }
    });

    shell();
    loadInfo();
})();
