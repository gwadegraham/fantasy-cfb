// App-wide search palette: jump to any of the 138 FBS teams or any manager in
// your league from anywhere in the app.
//
// The gap it closes: every team link in the app is contextual — a roster card, a
// schedule row, a standings cell, a draft-board cell. So a team nobody drafted
// and nobody plays had no route to it at all, short of reopening the draft room
// to click it out of the pool table.
//
// Ranking lives in search-match.js (pure, unit-tested). This file is the DOM: a
// lazily-fetched index, the overlay, and keyboard handling.
(function () {
    var LIMIT_TEAMS = 6, LIMIT_MANAGERS = 3;

    var index = null;        // prepared entries, or null until first open
    var loading = false;
    var results = [];
    var active = 0;
    var lastFocus = null;
    var els = null;

    function esc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    // Managers' avatars are Cloudinary; ask for the 48px face crop the rest of
    // the app already uses (h2h-card.js, standings-insights.js) instead of
    // pulling the full upload and scaling it in the browser.
    function avatarUrl(url) {
        if (!url) return null;
        return url.indexOf('/upload/') !== -1
            ? url.replace('/upload/', '/upload/c_fill,g_face,w_48,h_48,q_auto,f_auto/')
            : url;
    }

    function hrefFor(item) {
        return item.type === 'team'
            ? '/team?team=' + encodeURIComponent(item.id)
            : '/userHome?user=' + encodeURIComponent(item.id);
    }

    // ---- Index ---------------------------------------------------------------
    // Fetched on FIRST OPEN, not at page load. The navbar is on every page, so an
    // eager fetch would re-pull the index on every navigation to serve a feature
    // most page views never use.
    function loadIndex() {
        if (index || loading) return Promise.resolve();
        loading = true;
        return fetch('/search/index', { headers: { 'Accept': 'application/json' } })
            .then(function (r) {
                if (!r.ok) throw new Error('search index ' + r.status);
                return r.json();
            })
            .then(function (data) {
                var items = (data.teams || []).concat(data.managers || []);
                index = window.ccSearchMatch.prepare(items);
                loading = false;
                render();
            })
            .catch(function (e) {
                loading = false;
                console.error('Search index failed to load:', e);
                if (els) els.list.innerHTML = '<li class="cc-search-empty">Search is unavailable right now.</li>';
            });
    }

    // ---- Rendering -----------------------------------------------------------
    function rowHtml(item, i) {
        var isTeam = item.type === 'team';
        var img = isTeam ? item.image : avatarUrl(item.image);
        var media = img
            ? '<img src="' + esc(img) + '" alt="" loading="lazy">'
            : (item.initials
                ? '<span class="cc-search-initials" style="background:' + esc(item.color || '#333') + '">' + esc(item.initials) + '</span>'
                : '<span class="cc-search-initials"></span>');

        return '<li class="cc-search-row' + (i === active ? ' active' : '') + '"'
            + ' id="cc-search-opt-' + i + '" role="option" aria-selected="' + (i === active ? 'true' : 'false') + '"'
            + ' data-i="' + i + '">'
            + '<span class="cc-search-media">' + media + '</span>'
            + '<span class="cc-search-text">'
            + '<span class="cc-search-name">' + esc(item.name) + '</span>'
            + (item.sub ? '<span class="cc-search-sub">' + esc(item.sub) + '</span>' : '')
            + '</span>'
            + '</li>';
    }

    function render() {
        if (!els) return;
        var q = els.input.value.trim();

        if (!index) {
            els.list.innerHTML = '<li class="cc-search-empty">' + (loading ? 'Loading…' : '') + '</li>';
            return;
        }
        if (!q) {
            results = [];
            els.list.innerHTML = '<li class="cc-search-empty">Search teams and managers</li>';
            els.input.removeAttribute('aria-activedescendant');
            return;
        }

        var all = window.ccSearchMatch.rank(index, q);
        // Sliced per type rather than off one flat list, so a query that matches
        // a whole conference can't push the managers out of view entirely.
        var teams = all.filter(function (x) { return x.type === 'team'; }).slice(0, LIMIT_TEAMS);
        var managers = all.filter(function (x) { return x.type === 'manager'; }).slice(0, LIMIT_MANAGERS);
        results = teams.concat(managers);

        if (!results.length) {
            els.list.innerHTML = '<li class="cc-search-empty">No matches for “' + esc(q) + '”</li>';
            els.input.removeAttribute('aria-activedescendant');
            return;
        }

        if (active >= results.length) active = 0;

        var html = '';
        if (teams.length) {
            html += '<li class="cc-search-group" role="presentation">Teams</li>';
            html += teams.map(function (t, i) { return rowHtml(t, i); }).join('');
        }
        if (managers.length) {
            html += '<li class="cc-search-group" role="presentation">Managers</li>';
            html += managers.map(function (m, i) { return rowHtml(m, teams.length + i); }).join('');
        }
        els.list.innerHTML = html;
        els.input.setAttribute('aria-activedescendant', 'cc-search-opt-' + active);
        scrollActiveIntoView();
    }

    function scrollActiveIntoView() {
        var row = els.list.querySelector('.cc-search-row.active');
        if (row && row.scrollIntoView) row.scrollIntoView({ block: 'nearest' });
    }

    function move(delta) {
        if (!results.length) return;
        active = (active + delta + results.length) % results.length;
        render();
    }

    function go(i) {
        var item = results[i];
        if (item) window.location.href = hrefFor(item);
    }

    // ---- Open / close --------------------------------------------------------
    function build() {
        if (els) return;
        var overlay = document.createElement('div');
        overlay.className = 'cc-search-overlay';
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-modal', 'true');
        overlay.setAttribute('aria-label', 'Search');
        overlay.innerHTML =
            '<div class="cc-search-panel">'
            + '<div class="cc-search-field">'
            + '<i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i>'
            + '<input type="text" class="cc-search-input" role="combobox" aria-expanded="true"'
            + ' aria-controls="cc-search-list" aria-autocomplete="list" autocomplete="off"'
            + ' spellcheck="false" placeholder="Search teams and managers…" aria-label="Search teams and managers">'
            + '<kbd class="cc-search-esc">esc</kbd>'
            + '</div>'
            + '<ul class="cc-search-list" id="cc-search-list" role="listbox" aria-label="Search results"></ul>'
            + '</div>';
        document.body.appendChild(overlay);

        els = {
            overlay: overlay,
            panel: overlay.querySelector('.cc-search-panel'),
            input: overlay.querySelector('.cc-search-input'),
            list: overlay.querySelector('.cc-search-list')
        };

        els.input.addEventListener('input', function () { active = 0; render(); });

        els.input.addEventListener('keydown', function (e) {
            if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
            else if (e.key === 'Enter') { e.preventDefault(); go(active); }
            else if (e.key === 'Escape') { e.preventDefault(); close(); }
        });

        // Click, not mousedown: mousedown would fire before the row's own state
        // settles and makes drag-select inside the input navigate away.
        els.list.addEventListener('click', function (e) {
            var row = e.target.closest('.cc-search-row');
            if (row) go(Number(row.getAttribute('data-i')));
        });
        els.list.addEventListener('mousemove', function (e) {
            var row = e.target.closest('.cc-search-row');
            if (!row) return;
            var i = Number(row.getAttribute('data-i'));
            if (i !== active) { active = i; render(); }
        });

        overlay.addEventListener('mousedown', function (e) {
            if (!els.panel.contains(e.target)) close();
        });
    }

    function isOpen() { return !!(els && els.overlay.classList.contains('open')); }

    function open() {
        build();
        if (isOpen()) return;
        lastFocus = document.activeElement;
        els.overlay.classList.add('open');
        document.body.classList.add('cc-search-lock');
        els.input.value = '';
        active = 0;
        results = [];
        render();
        els.input.focus();
        loadIndex();
    }

    function close() {
        if (!isOpen()) return;
        els.overlay.classList.remove('open');
        document.body.classList.remove('cc-search-lock');
        if (lastFocus && lastFocus.focus) lastFocus.focus();
        lastFocus = null;
    }

    // ---- Wiring --------------------------------------------------------------
    function init() {
        var btn = document.getElementById('nav-search');
        if (btn) btn.addEventListener('click', function (e) { e.preventDefault(); open(); });

        document.addEventListener('keydown', function (e) {
            // Cmd/Ctrl-K only. A bare "/" is the other common palette binding and
            // is deliberately NOT bound: the draft room has its own always-visible
            // filter input, and "/" would either be swallowed there or hijack a
            // keystroke someone meant to type. preventDefault is required because
            // Cmd-K is Chrome's own address-bar search.
            if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
                e.preventDefault();
                isOpen() ? close() : open();
            } else if (e.key === 'Escape' && isOpen()) {
                close();
            }
        });
    }

    if (document.readyState !== 'loading') init();
    else document.addEventListener('DOMContentLoaded', init);
})();
