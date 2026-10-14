// The Leagues page (#536). Lists every league an Admin runs and walks
// through Create league in three steps:
//
//   1. sport and name        POST /leagues/admin
//   2. who's in              POST /leagues/admin/:code/members (existing managers)
//                            POST /users + /users/:id/invite-link (someone new)
//   3. draft and settings    POST /draft, then the league's own admin page
//
// The league exists from step 1 on, so leaving half way is fine: it sits on
// the list as "Setting up" with a Continue button that comes back to step 2.
//
// "Manage" goes through GET /leagues/admin/:code/open, which selects the
// league before landing on its admin page — both admin pages follow the
// league being viewed.

(function () {
    var root = document.getElementById('leagues-page');
    if (!root) return;

    var esc = window.ccSportPage.esc;
    var SEASONS = window.LEAGUE_SEASONS || {};
    var DEFAULTS = window.DRAFT_DEFAULTS || {};
    var SPORTS = [
        { key: 'football', label: 'Football', icon: 'fa-football' },
        { key: 'basketball', label: 'Basketball', icon: 'fa-basketball' }
    ];
    var STATE = {
        live: { label: 'Live', cls: 'live' },
        setup: { label: 'Setting up', cls: 'setup' },
        archived: { label: 'Archived', cls: 'archived' }
    };

    // Football names a season by its starting year; basketball (CBBD) by
    // its ending one, so 2027 is 2026–27.
    function seasonLabel(sport, s) {
        if (s == null) return '—';
        return sport === 'basketball' ? (s - 1) + '–' + String(s).slice(-2) : String(s);
    }
    function sportOf(key) { return SPORTS.filter(function (s) { return s.key === key; })[0] || SPORTS[0]; }
    function plural(n, word) { return n + ' ' + word + (n === 1 ? '' : 's'); }
    function openHref(code) { return '/leagues/admin/' + encodeURIComponent(code) + '/open'; }

    function api(method, url, body) {
        var opts = { method: method, headers: { Accept: 'application/json' } };
        if (body !== undefined) {
            opts.headers['Content-Type'] = 'application/json';
            opts.body = JSON.stringify(body);
        }
        return fetch(url, opts).then(function (res) {
            return res.json().catch(function () { return {}; }).then(function (data) {
                if (!res.ok) throw new Error((data && data.message) || ('HTTP ' + res.status));
                return data;
            });
        });
    }

    function toast(kind, msg) {
        if (window.ccToast && window.ccToast[kind]) window.ccToast[kind](msg);
    }

    // ---- the list ---------------------------------------------------------

    function row(l) {
        var sp = sportOf(l.sport);
        var st = STATE[l.state] || STATE.setup;
        var actions = l.state === 'archived' ? ''
            : (l.state === 'setup'
                ? '<button type="button" class="lg-btn lg-ghost" data-continue="' + esc(l.code) + '">Continue setup</button>'
                : '')
              + '<a class="lg-btn" data-manage href="' + esc(openHref(l.code)) + '">Manage</a>';
        return '<li class="lg-row sp-card" data-league="' + esc(l.code) + '">'
            + '<i class="fa-solid ' + sp.icon + ' lg-sport" aria-hidden="true"></i>'
            + '<div class="lg-main">'
            + '<div class="lg-name">' + esc(l.name) + '</div>'
            + '<div class="lg-meta">' + esc(sp.label) + ' · ' + esc(seasonLabel(l.sport, l.season))
            + ' · ' + esc(plural(l.managers || 0, 'manager')) + '</div>'
            + '</div>'
            + '<span class="lg-chip ' + st.cls + '">' + st.label + '</span>'
            + '<div class="lg-actions">' + actions + '</div>'
            + '</li>';
    }

    var rows = [];

    function renderList() {
        var open = rows.filter(function (l) { return l.state !== 'archived'; });
        var archived = rows.filter(function (l) { return l.state === 'archived'; });
        root.innerHTML = '<header class="lg-top">'
            + '<h1>Leagues</h1>'
            + '<button type="button" class="lg-btn lg-primary" data-create><i class="fa-solid fa-plus" aria-hidden="true"></i> Create league</button>'
            + '</header>'
            + (open.length ? '<ul class="lg-list">' + open.map(row).join('') + '</ul>'
                : '<div class="sp-empty">No leagues yet.</div>')
            + (archived.length
                ? '<details class="lg-archived"><summary>Archived (' + archived.length + ')</summary>'
                    + '<ul class="lg-list">' + archived.map(row).join('') + '</ul></details>'
                : '');
    }

    function loadList() {
        return api('GET', '/leagues/admin/rows').then(function (data) {
            rows = data || [];
            renderList();
        }).catch(function (e) {
            root.innerHTML = '<div class="sp-error">' + esc(e.message) + '</div>';
        });
    }

    // ---- create: shared frame ----------------------------------------------

    // The league being set up: { code, name, sport, season } once step 1 is done.
    var league = null;

    function frame(step, body) {
        var steps = ['Sport & name', "Who's in", 'Draft'];
        return '<header class="lg-top"><h1>' + (league ? esc(league.name) : 'Create league') + '</h1>'
            + '<button type="button" class="lg-btn lg-ghost" data-back-list>Back to leagues</button></header>'
            + '<ol class="lg-steps">' + steps.map(function (s, i) {
                return '<li class="' + (i + 1 === step ? 'on' : (i + 1 < step ? 'done' : '')) + '">'
                    + '<span>' + (i + 1) + '</span>' + esc(s) + '</li>';
            }).join('') + '</ol>'
            + '<section class="lg-step" data-step="' + step + '">' + body + '</section>';
    }

    // ---- step 1 ------------------------------------------------------------

    function renderStep1() {
        var cards = SPORTS.map(function (s, i) {
            var season = SEASONS[s.key];
            var ok = season != null;
            return '<label class="lg-sport-card' + (ok ? '' : ' off') + '">'
                + '<input type="radio" name="lg-sport" value="' + s.key + '"' + (ok ? '' : ' disabled')
                + (ok && i === 0 ? ' checked' : '') + '>'
                + '<i class="fa-solid ' + s.icon + '" aria-hidden="true"></i>'
                + '<span><b>' + s.label + '</b><small>' + (ok ? esc(seasonLabel(s.key, season)) + ' season' : 'No season set') + '</small></span>'
                + '</label>';
        }).join('');
        root.innerHTML = frame(1, '<form data-step1>'
            + '<div class="lg-field"><span class="lg-label">Sport</span><div class="lg-sports">' + cards + '</div></div>'
            + '<label class="lg-field"><span class="lg-label">League name</span>'
            + '<input type="text" data-name maxlength="40" required autocomplete="off"></label>'
            + '<p class="lg-hint">The season is the sport\'s current one. Nobody is in the league until you add them in the next step.</p>'
            + '<div class="lg-foot"><button type="submit" class="lg-btn lg-primary">Create and continue</button></div>'
            + '</form>');
    }

    function submitStep1(form) {
        var picked = form.querySelector('input[name="lg-sport"]:checked');
        var name = form.querySelector('[data-name]').value.trim();
        if (!picked) return toast('error', 'Pick a sport');
        if (!name) return toast('error', 'The league needs a name');
        var btn = form.querySelector('button[type="submit"]');
        btn.disabled = true;
        return api('POST', '/leagues/admin', { sport: picked.value, name: name }).then(function (made) {
            league = made;
            toast('success', 'Created ' + made.name);
            return startStep2();
        }).catch(function (e) {
            btn.disabled = false;
            toast('error', e.message);
        });
    }

    // ---- step 2 ------------------------------------------------------------

    var members = [];      // already in the league: [{ _id, firstName, lastName }]
    var candidates = [];   // in another league, not this one
    var invites = [];      // new people added here: [{ name, link }]

    function memberName(m) { return [m.firstName, m.lastName].filter(Boolean).join(' '); }

    function loadMembers() {
        return api('GET', '/users/league/' + encodeURIComponent(league.code) + '/all').then(function (list) {
            members = (list || []).map(function (m) {
                return { _id: String(m._id), firstName: m.firstName, lastName: m.lastName,
                    inSeason: (m.seasons || []).some(function (s) { return Number(s.season) === Number(league.season); }) };
            });
        });
    }

    function startStep2() {
        root.innerHTML = frame(2, '<div class="sp-loading">Loading managers…</div>');
        return Promise.all([
            loadMembers(),
            api('GET', '/leagues/admin/candidates?league=' + encodeURIComponent(league.code)).then(function (c) { candidates = c || []; })
        ]).then(renderStep2).catch(function (e) {
            root.innerHTML = frame(2, '<div class="sp-error">' + esc(e.message) + '</div>');
        });
    }

    // Existing managers ticked but not yet added. Kept OUTSIDE the DOM so a
    // re-render (adding someone new reloads the step) can't untick them, and
    // added on "Next" — ticking IS choosing; there is no separate button to
    // miss on the way out.
    var picked = {};
    function pickedIds() {
        return Object.keys(picked).filter(function (id) { return candidates.some(function (c) { return String(c._id) === id; }); });
    }
    function nextLabel() {
        var n = pickedIds().length;
        return n ? 'Add ' + plural(n, 'manager') + ' and continue' : 'Next: draft';
    }

    function renderStep2() {
        var pick = candidates.length
            ? '<ul class="lg-pick">' + candidates.map(function (c) {
                return '<li><label><input type="checkbox" data-pick="' + esc(c._id) + '"' + (picked[String(c._id)] ? ' checked' : '') + '>'
                    + '<span class="lg-who"><b>' + esc(memberName(c)) + '</b><small>' + esc(c.leagues.join(', ')) + '</small></span>'
                    + '</label></li>';
            }).join('') + '</ul>'
              + '<p class="lg-hint">Everyone ticked is added when you continue.</p>'
            : '<div class="sp-empty">Everyone from your other leagues is already in this one.</div>';

        var inLeague = members.length
            ? '<ul class="lg-in">' + members.map(function (m) {
                return '<li data-member="' + esc(m._id) + '"><i class="fa-solid fa-check" aria-hidden="true"></i> ' + esc(memberName(m)) + '</li>';
            }).join('') + '</ul>'
            : '<div class="sp-empty">Nobody yet.</div>';

        var links = invites.map(function (inv) {
            return '<div class="lg-invite"><b>' + esc(inv.name) + '</b> — send them this link to sign in:'
                + '<div class="lg-invite-row"><input type="text" readonly value="' + esc(inv.link) + '">'
                + '<button type="button" class="lg-btn" data-copy="' + esc(inv.link) + '">Copy</button></div></div>';
        }).join('');

        root.innerHTML = frame(2,
            '<h2 class="sp-h">In ' + esc(league.name) + ' <small>' + esc(plural(members.length, 'manager')) + '</small></h2>' + inLeague
            + '<h2 class="sp-h">From your other leagues <small>same login, no invite</small></h2>' + pick
            + '<h2 class="sp-h">Someone new <small>gets an invite link</small></h2>'
            + '<form class="lg-new" data-new-person>'
            + '<input type="text" data-first placeholder="First name" required autocomplete="off">'
            + '<input type="text" data-last placeholder="Last name" required autocomplete="off">'
            + '<input type="email" data-email placeholder="Email" required autocomplete="off">'
            + '<button type="submit" class="lg-btn">Add</button>'
            + '</form>' + links
            + '<div class="lg-foot lg-foot-split"><button type="button" class="lg-btn lg-primary" data-to-step3>' + esc(nextLabel()) + '</button></div>');
    }

    // "Next" from step 2: add whoever is ticked, then go on. A refusal stays
    // on the step with the ticks intact, so nothing is silently dropped.
    function continueFromStep2(btn) {
        var ids = pickedIds();
        if (!ids.length) return startStep3();
        btn.disabled = true;
        return api('POST', '/leagues/admin/' + encodeURIComponent(league.code) + '/members', { accountIds: ids })
            .then(function (out) {
                var n = (out.added || []).length;
                if (n) toast('success', 'Added ' + plural(n, 'manager'));
                picked = {};
                return startStep3();
            }).catch(function (e) {
                btn.disabled = false;
                toast('error', e.message);
            });
    }

    function addNewPerson(form) {
        var first = form.querySelector('[data-first]').value.trim();
        var last = form.querySelector('[data-last]').value.trim();
        var email = form.querySelector('[data-email]').value.trim();
        if (!first || !last || !email) return toast('error', 'First name, last name and email are all needed');
        var btn = form.querySelector('button[type="submit"]');
        btn.disabled = true;
        var code = encodeURIComponent(league.code);
        // The email first. Add a Player always makes an Account, so someone
        // who already has one would get a second — a team nobody can log in
        // as. They join under the login they have instead.
        return api('GET', '/leagues/admin/account?email=' + encodeURIComponent(email) + '&league=' + code).then(function (found) {
            if (found.found) {
                var who = memberName(found);
                if (found.inLeague) throw new Error(who + ' is already in this league');
                if (!found.elsewhere) throw new Error('That email already belongs to ' + who + ', who is in no league. Ask an admin to sort out that account.');
                return api('POST', '/leagues/admin/' + code + '/members', { accountIds: [found._id] }).then(function () {
                    toast('success', who + ' already has a login — added under it, no invite needed');
                    return startStep2();
                });
            }
            // Add a Player, the same call the admin page makes. The season is
            // sent rather than left to the server, which would read it from a
            // season cache another dyno may not have refreshed since step 1.
            return api('POST', '/users', {
                firstName: first, lastName: last, email: email,
                league: league.code, seasons: [{ season: league.season }]
            }).then(function (made) {
                return api('POST', '/users/' + encodeURIComponent(made._id) + '/invite-link').then(function (inv) {
                    invites.push({ name: first + ' ' + last, link: inv.link });
                    toast('success', 'Added ' + first + ' ' + last);
                    return startStep2();
                });
            });
        }).catch(function (e) {
            btn.disabled = false;
            toast('error', e.message);
        });
    }

    // ---- step 3 ------------------------------------------------------------

    var order = [];        // account ids, pick order
    var draft = null;      // the league's draft for this season, if one is saved

    // A datetime-local value, in the browser's own zone.
    function localInput(iso) {
        if (!iso) return '';
        var d = new Date(iso);
        if (isNaN(d)) return '';
        var p = function (n) { return (n < 10 ? '0' : '') + n; };
        return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T' + p(d.getHours()) + ':' + p(d.getMinutes());
    }

    function shuffle(list) {
        var a = list.slice();
        for (var i = a.length - 1; i > 0; i--) {
            var j = Math.floor(Math.random() * (i + 1));
            var t = a[i]; a[i] = a[j]; a[j] = t;
        }
        return a;
    }

    function startStep3() {
        root.innerHTML = frame(3, '<div class="sp-loading">Loading…</div>');
        // The saved draft too, so coming back through Continue setup edits it
        // rather than overwriting its order, date and call link with blanks.
        return Promise.all([
            loadMembers(),
            api('GET', '/draft/' + encodeURIComponent(league.code) + '/' + encodeURIComponent(league.season))
                .then(function (d) { draft = d || null; })
        ]).then(function () {
            var ids = members.filter(function (m) { return m.inSeason; }).map(function (m) { return m._id; });
            if (draft && draft.draftOrder && draft.draftOrder.length && !order.length) order = draft.draftOrder.map(String);
            // Keep an order already arranged on a return visit; append anyone new.
            order = order.filter(function (id) { return ids.indexOf(id) !== -1; })
                .concat(ids.filter(function (id) { return order.indexOf(id) === -1; }));
            renderStep3();
        }).catch(function (e) {
            root.innerHTML = frame(3, '<div class="sp-error">' + esc(e.message) + '</div>');
        });
    }

    function renderOrder() {
        var byId = {};
        members.forEach(function (m) { byId[m._id] = m; });
        return order.map(function (id, i) {
            return '<li data-order="' + esc(id) + '"><span class="lg-pos">' + (i + 1) + '</span>'
                + '<span class="lg-who"><b>' + esc(memberName(byId[id] || {})) + '</b></span>'
                + '<button type="button" class="lg-mv" data-up="' + i + '"' + (i === 0 ? ' disabled' : '') + ' aria-label="Move up"><i class="fa-solid fa-chevron-up"></i></button>'
                + '<button type="button" class="lg-mv" data-down="' + i + '"' + (i === order.length - 1 ? ' disabled' : '') + ' aria-label="Move down"><i class="fa-solid fa-chevron-down"></i></button>'
                + '</li>';
        }).join('');
    }

    function renderStep3() {
        if (draft && (draft.status === 'active' || draft.status === 'complete')) {
            root.innerHTML = frame(3, '<div class="sp-empty">The draft is ' + esc(draft.status)
                + ', so its settings are locked.</div>'
                + '<div class="lg-foot lg-foot-split"><button type="button" class="lg-btn lg-ghost" data-to-step2>Back</button>'
                + '<a class="lg-btn lg-primary" data-finish-skip href="' + esc(openHref(league.code)) + '">Open admin</a></div>');
            return;
        }
        var d = Object.assign({}, DEFAULTS[league.sport] || {});
        if (draft) {
            if (draft.totalRounds) d.totalRounds = draft.totalRounds;
            // A saved null is a deliberate "uncapped", not "use the default".
            if (draft.poolSize !== undefined) d.poolSize = draft.poolSize;
        }
        var enough = order.length >= 2;
        root.innerHTML = frame(3, '<form data-step3>'
            + '<h2 class="sp-h">Draft order <small>' + (enough ? 'first pick at the top' : 'needs at least 2 managers') + '</small></h2>'
            + (order.length ? '<ol class="lg-order" data-order-list>' + renderOrder() + '</ol>'
                + '<div class="lg-foot"><button type="button" class="lg-btn lg-ghost" data-randomize>Randomize</button></div>'
                : '<div class="sp-empty">Nobody is in the league yet. Go back a step, or finish and add people from the admin page.</div>')
            + '<h2 class="sp-h">Settings</h2>'
            + '<div class="lg-grid">'
            + '<label class="lg-field"><span class="lg-label">Rounds</span><input type="number" data-rounds min="1" max="20" value="' + esc(d.totalRounds || 10) + '"></label>'
            + '<label class="lg-field"><span class="lg-label">Type</span><select data-type><option value="snake">Snake</option>'
            + '<option value="linear"' + (draft && draft.snake === false ? ' selected' : '') + '>Linear</option></select></label>'
            // No pool size here: "how many teams can be drafted" is a setting
            // a commissioner shouldn't have to understand to start a league.
            // The sport's default (or what's already saved) is sent; it can be
            // changed under Configure Draft on the league's admin page.
            + '<label class="lg-field lg-field-wide"><span class="lg-label">Draft date (optional)</span><input type="datetime-local" data-when value="' + esc(localInput(draft && draft.scheduledAt)) + '"></label>'
            + '</div>'
            + '<p class="lg-hint">Scoring, game modes and everything else are on the league\'s admin page.</p>'
            + '<div class="lg-foot lg-foot-split">'
            + '<button type="button" class="lg-btn lg-ghost" data-to-step2>Back</button>'
            + (enough ? '<button type="submit" class="lg-btn lg-primary">Save and open admin</button>'
                : '<a class="lg-btn lg-primary" data-finish-skip href="' + esc(openHref(league.code)) + '">Skip the draft for now</a>')
            + '</div></form>');
    }

    function move(from, to) {
        if (to < 0 || to >= order.length) return;
        var id = order.splice(from, 1)[0];
        order.splice(to, 0, id);
        var list = root.querySelector('[data-order-list]');
        if (list) list.innerHTML = renderOrder();
    }

    function submitStep3(form) {
        var when = form.querySelector('[data-when]').value;
        var body = {
            league: league.code,
            season: league.season,
            draftOrder: order.slice(),
            orderMethod: 'manual',
            snake: form.querySelector('[data-type]').value === 'snake',
            totalRounds: parseInt(form.querySelector('[data-rounds]').value, 10) || (DEFAULTS[league.sport] || {}).totalRounds || 10,
            scheduledAt: when ? new Date(when).toISOString() : null,
            // Not on this form, so kept as saved: POST /draft overwrites both.
            autoOpen: !!(draft && draft.autoOpen),
            callUrl: (draft && draft.callUrl) || ''
        };
        // Only basketball has a pool cap (football's route refuses one): the
        // saved value if there is one — a saved null is a deliberate
        // "uncapped" — else the sport's default.
        if (league.sport === 'basketball') {
            body.poolSize = draft && draft.poolSize !== undefined ? draft.poolSize
                : ((DEFAULTS.basketball || {}).poolSize || null);
        }
        var btn = form.querySelector('button[type="submit"]');
        btn.disabled = true;
        return api('POST', '/draft', body).then(function () {
            finish();
        }).catch(function (e) {
            btn.disabled = false;
            toast('error', e.message);
        });
    }

    // The admin page follows the league being viewed; /open selects it. The
    // localStorage mirror is what the client helpers read (public/league.js).
    function finish() {
        try { window.localStorage.setItem('leagueCode', league.code); } catch (e) { /* private window */ }
        window.location.assign(openHref(league.code));
    }

    // ---- wiring --------------------------------------------------------------

    root.addEventListener('click', function (e) {
        var t = e.target.closest ? e.target.closest('button, a') : null;
        if (!t) return;
        if (t.hasAttribute('data-create')) { league = null; members = []; invites = []; order = []; draft = null; picked = {}; return renderStep1(); }
        if (t.hasAttribute('data-back-list')) { league = null; return loadList(); }
        if (t.hasAttribute('data-continue')) {
            var code = t.getAttribute('data-continue');
            var l = rows.filter(function (r) { return r.code === code; })[0];
            if (!l) return;
            league = { code: l.code, name: l.name, sport: l.sport, season: l.season };
            members = []; invites = []; order = []; draft = null; picked = {};
            return startStep2();
        }
        if (t.hasAttribute('data-to-step3')) return continueFromStep2(t);
        if (t.hasAttribute('data-to-step2')) return startStep2();
        if (t.hasAttribute('data-randomize')) { order = shuffle(order); var list = root.querySelector('[data-order-list]'); if (list) list.innerHTML = renderOrder(); return; }
        if (t.hasAttribute('data-up')) return move(Number(t.getAttribute('data-up')), Number(t.getAttribute('data-up')) - 1);
        if (t.hasAttribute('data-down')) return move(Number(t.getAttribute('data-down')), Number(t.getAttribute('data-down')) + 1);
        if (t.hasAttribute('data-copy')) {
            var text = t.getAttribute('data-copy');
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(text).then(function () { toast('success', 'Link copied'); });
            }
            return;
        }
        if (t.hasAttribute('data-manage') || t.hasAttribute('data-finish-skip')) {
            var c = t.closest('[data-league]');
            var lc = c ? c.getAttribute('data-league') : (league && league.code);
            try { if (lc) window.localStorage.setItem('leagueCode', lc); } catch (err) { /* private window */ }
        }
    });

    root.addEventListener('change', function (e) {
        if (e.target.hasAttribute && e.target.hasAttribute('data-pick')) {
            var id = e.target.getAttribute('data-pick');
            if (e.target.checked) picked[id] = true; else delete picked[id];
            var next = root.querySelector('[data-to-step3]');
            if (next) next.textContent = nextLabel();
        }
    });

    root.addEventListener('submit', function (e) {
        var f = e.target;
        if (f.hasAttribute('data-step1')) { e.preventDefault(); submitStep1(f); }
        else if (f.hasAttribute('data-new-person')) { e.preventDefault(); addNewPerson(f); }
        else if (f.hasAttribute('data-step3')) { e.preventDefault(); submitStep3(f); }
    });

    loadList();
})();
