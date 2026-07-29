// Shared Weekly Recap client: rendering + the app-wide weekly popup. Loaded on
// every page via the navbar partial, so both the My Team card and the popup
// draw from one place. The popup fires once per "recap week" (opens Monday
// 07:00 local), the same window the server module documents. Exposes
// window.ccRecap for userHome.js to mount the inline card.
(function () {
    'use strict';

    function escapeHtml(v) {
        return String(v == null ? '' : v)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }
    function ordinal(n) {
        const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
        return n + (s[(v - 20) % 10] || s[v] || s[0]);
    }
    // Movement chip: ▲ climbed / ▼ slipped / – held.
    function movement(delta) {
        if (delta == null || delta === 0) return '<span class="recap-move flat">–</span>';
        if (delta > 0) return `<span class="recap-move up">▲${delta}</span>`;
        return `<span class="recap-move down">▼${-delta}</span>`;
    }
    function statTile(valueHtml, label) {
        return `<div class="stat"><span class="stat-value">${valueHtml}</span><span class="stat-label">${escapeHtml(label)}</span></div>`;
    }

    // One week's recap card body (narrative + optional UPSET badge + tiles).
    function cardHtml(r) {
        if (!r) return '';
        const tiles = [];
        tiles.push(statTile(String(r.score), 'Points this week'));
        if (r.rank != null) tiles.push(statTile(`${escapeHtml(ordinal(r.rank))} ${movement(r.rankDelta)}`, 'League rank'));
        if (r.vsLeagueAvg != null) {
            const tone = r.vsLeagueAvg > 0 ? 'up' : (r.vsLeagueAvg < 0 ? 'down' : 'flat');
            const txt = r.vsLeagueAvg > 0 ? `+${r.vsLeagueAvg}` : String(r.vsLeagueAvg);
            tiles.push(statTile(`<span class="recap-move ${tone}">${txt}</span>`, 'vs league avg'));
        }
        if (r.mvpTeam && r.mvpTeam.score > 0) {
            const tied = (r.mvpTeams && r.mvpTeams.length) ? r.mvpTeams : [r.mvpTeam];
            const logos = tied.map(t => t.logo ? `<img src="${escapeHtml(t.logo)}" alt="">` : '').join('');
            tiles.push(statTile(`${logos}${r.mvpTeam.score}`, `MVP: ${tied.map(t => t.school).join(' & ')}`));
        }
        const badge = r.isUpset ? `<span class="recap-badge">${window.ccIcon ? window.ccIcon('upset', { size: 16 }) : ''} Upset</span>` : '';
        return `
            <p class="recap-narrative">${escapeHtml(r.narrative)}${badge}</p>
            <div class="recap-stats">${tiles.join('')}</div>`;
    }

    function selectorHtml(recaps) {
        return recaps.map(r => `<option value="${r.effWeek}">${escapeHtml(r.label)}</option>`).join('');
    }

    async function fetchRecap(league, season, userId) {
        const res = await fetch(
            `/standings/recap/${encodeURIComponent(league)}/${encodeURIComponent(season)}/${encodeURIComponent(userId)}`,
            { headers: { 'Accept': 'application/json' } });
        if (!res.ok) return null;
        return res.json();
    }

    // Mount the full "Your Week" card (header + week selector + body) into `el`,
    // defaulting to the latest week. Returns the latest recap so the caller can
    // build a teaser (used by the My Team pill). Does not reveal `el` itself —
    // the caller controls that (collapsed behind the pill).
    function mountInline(el, data) {
        const recaps = (data && data.recaps) || [];
        if (!recaps.length) return null;
        el.innerHTML = `
            <div class="recap-head">
                <div class="header-title">Your Week</div>
                <label class="recap-week-picker">
                    <span class="recap-week-caption">Recap week</span>
                    <select recap-week aria-label="Recap week">${selectorHtml(recaps)}</select>
                </label>
            </div>
            <div class="recap-card" recap-body></div>`;
        const sel = el.querySelector('[recap-week]');
        const body = el.querySelector('[recap-body]');
        const paint = () => {
            const r = recaps.find(x => String(x.effWeek) === sel.value) || recaps[recaps.length - 1];
            body.innerHTML = cardHtml(r);
            if (window.ccHydrateIcons) window.ccHydrateIcons(body);
        };
        sel.addEventListener('change', paint);
        sel.value = String(recaps[recaps.length - 1].effWeek);
        paint();
        return recaps[recaps.length - 1];
    }

    // ---- Weekly popup: a swipe/tap "story" carousel -------------------------

    let openEl = null, lastFocused = null, prevBodyOverflow = '';
    function closePopup() {
        if (!openEl) return;
        const el = openEl; openEl = null;
        el.classList.remove('is-in');
        document.removeEventListener('keydown', onKey);
        document.body.style.overflow = prevBodyOverflow;   // release scroll lock
        const done = () => el.remove();
        el.addEventListener('transitionend', done, { once: true });
        setTimeout(done, 450);   // fallback if transitions don't fire
        // Return focus to whatever opened the popup (a11y).
        if (lastFocused && typeof lastFocused.focus === 'function') { try { lastFocused.focus(); } catch (e) { /* gone */ } }
        lastFocused = null;
    }
    function onKey(e) {
        if (!openEl) return;
        if (e.key === 'Escape') closePopup();
        else if (e.key === 'ArrowRight') openEl._next();
        else if (e.key === 'ArrowLeft') openEl._prev();
    }

    // One story beat. Big number/emoji, optional team logo, or a narrative line.
    function slideHtml(s, ctaHref) {
        const logo = (Array.isArray(s.logos) && s.logos.length)
            ? `<div class="recap-slide-logos">${s.logos.map(u => `<img class="recap-slide-logo" src="${escapeHtml(u)}" alt="">`).join('')}</div>`
            : (s.logo ? `<img class="recap-slide-logo" src="${escapeHtml(s.logo)}" alt="">` : '');
        const big = s.big != null ? `<div class="recap-slide-big ${s.tone || 'neutral'}">${escapeHtml(s.big)}</div>` : '';
        const text = s.text ? `<p class="recap-slide-text">${escapeHtml(s.text)}</p>` : '';
        const sub = s.sub ? `<div class="recap-slide-sub">${escapeHtml(s.sub)}</div>` : '';
        const cta = (s.cta && ctaHref) ? `<a class="recap-popup-link" href="${ctaHref}">See all weeks →</a>` : '';
        return `<div class="recap-slide tone-${s.tone || 'neutral'}" data-slide-id="${s.id || ''}">
            <div class="recap-slide-kicker">${window.ccIcon ? window.ccIcon(s.icon, { size: 15 }) : ''} ${escapeHtml(s.kicker || '')}</div>
            ${logo}
            <div class="recap-slide-title">${escapeHtml(s.title || '')}</div>
            ${big}${text}${sub}${cta}
        </div>`;
    }

    function showPopup(data, userId) {
        if (openEl) { openEl.remove(); document.removeEventListener('keydown', onKey); openEl = null; }   // never stack
        const recaps = (data && data.recaps) || [];
        if (!recaps.length) return;
        lastFocused = document.activeElement;   // to restore on close
        const latest = recaps[recaps.length - 1];
        const slides = (latest.slides && latest.slides.length) ? latest.slides
            : [{ id: 'only', icon: 'flame', kicker: 'Weekly Recap', title: latest.label, text: latest.narrative, tone: 'neutral', cta: true }];
        const ctaHref = userId ? `/userHome?user=${encodeURIComponent(userId)}` : null;

        const el = document.createElement('div');
        el.className = 'recap-popup-backdrop';
        el.innerHTML = `
            <div class="recap-popup recap-story" role="dialog" aria-modal="true" aria-label="Weekly recap">
                <div class="recap-progress" aria-hidden="true">${slides.map(() => '<span></span>').join('')}</div>
                <span class="recap-sr" aria-live="polite"></span>
                <button type="button" class="recap-popup-close" aria-label="Close">&times;</button>
                <div class="recap-story-viewport">
                    <div class="recap-story-track">${slides.map(s => slideHtml(s, ctaHref)).join('')}</div>
                </div>
                <button type="button" class="recap-nav-hint left" aria-label="Previous">‹</button>
                <button type="button" class="recap-nav-hint right" aria-label="Next">›</button>
            </div>`;

        const track = el.querySelector('.recap-story-track');
        const bars = el.querySelectorAll('.recap-progress span');
        const slideEls = Array.from(track.children);
        const prevBtn = el.querySelector('.recap-nav-hint.left');
        const nextBtn = el.querySelector('.recap-nav-hint.right');
        const sr = el.querySelector('.recap-sr');
        let idx = 0;
        const showSlide = (i) => {
            idx = Math.max(0, Math.min(slides.length - 1, i));
            track.style.transform = `translateX(${-idx * 100}%)`;
            bars.forEach((b, n) => b.classList.toggle('filled', n <= idx));
            if (sr) sr.textContent = `Slide ${idx + 1} of ${slides.length}`;
            // Nothing to go back to on the first beat.
            if (prevBtn) prevBtn.style.visibility = idx === 0 ? 'hidden' : 'visible';
            // Replay the current slide's content animation each time it's shown:
            // drop the class off everyone, force a reflow, re-arm the active one.
            slideEls.forEach(s => s.classList.remove('is-active'));
            void slideEls[idx].offsetWidth;
            slideEls[idx].classList.add('is-active');
        };
        el._next = () => { if (idx < slides.length - 1) showSlide(idx + 1); else closePopup(); };
        el._prev = () => { if (idx > 0) showSlide(idx - 1); };
        if (prevBtn) prevBtn.addEventListener('click', (e) => { e.stopPropagation(); el._prev(); });
        if (nextBtn) nextBtn.addEventListener('click', (e) => { e.stopPropagation(); el._next(); });

        // Tap left third / right two-thirds to page; leave links + the close
        // button to their own handlers. Measure against the VIEWPORT (fixed) —
        // the track's own rect shifts with its translateX and would mis-zone.
        const viewport = el.querySelector('.recap-story-viewport');
        let swiped = false;   // set by a swipe so the synthesized click doesn't double-advance
        viewport.addEventListener('click', (e) => {
            if (swiped) { swiped = false; return; }
            if (e.target.closest('a')) return;
            const r = viewport.getBoundingClientRect();
            (e.clientX - r.left) < r.width * 0.33 ? el._prev() : el._next();
        });
        // Swipe on touch.
        let sx = null;
        el.addEventListener('touchstart', (e) => { sx = e.touches[0].clientX; }, { passive: true });
        el.addEventListener('touchend', (e) => {
            if (sx == null) return;
            const dx = e.changedTouches[0].clientX - sx; sx = null;
            if (Math.abs(dx) > 40) { swiped = true; (dx < 0 ? el._next() : el._prev()); }
        });
        el.addEventListener('click', (e) => {
            if (e.target === el || e.target.closest('.recap-popup-close')) closePopup();
        });
        // Focus trap: keep Tab inside the dialog while it's open.
        el.addEventListener('keydown', (e) => {
            if (e.key !== 'Tab') return;
            const f = Array.from(el.querySelectorAll('button:not([disabled]), a[href]'))
                .filter(x => x.offsetParent !== null);
            if (!f.length) return;
            const first = f[0], last = f[f.length - 1];
            if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
            else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
        });

        prevBodyOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';   // lock background scroll
        document.body.appendChild(el);
        if (window.ccHydrateIcons) window.ccHydrateIcons(el);
        openEl = el;
        document.addEventListener('keydown', onKey);
        showSlide(0);
        void el.offsetWidth;             // reflow so the entrance transition runs
        el.classList.add('is-in');
        const closeBtn = el.querySelector('.recap-popup-close');
        if (closeBtn) closeBtn.focus();   // move focus into the dialog
    }

    // ---- Gating (mirror of modules/weekly-recap.js) -------------------------
    function recapWindowKey(date) {
        const d = new Date(date.getTime());
        const sinceMonday = (d.getDay() + 6) % 7;
        const b = new Date(d.getFullYear(), d.getMonth(), d.getDate() - sinceMonday, 7, 0, 0, 0);
        if (d < b) b.setDate(b.getDate() - 7);
        const y = b.getFullYear(), m = String(b.getMonth() + 1).padStart(2, '0'), day = String(b.getDate()).padStart(2, '0');
        return `${y}-${m}-${day}`;
    }
    function isRecapSeason(date) { const m = date.getMonth() + 1; return m >= 8 || m === 1; }

    const SEEN_KEY = 'ccRecapPopupSeen';

    // Decide + show the popup once per recap week. `force` (?recapPopup=1)
    // bypasses the gate for testing.
    async function maybeShowPopup(opts) {
        opts = opts || {};
        const now = new Date();
        const here = (location.pathname || '').replace(/\/+$/, '');
        if (!opts.force) {
            if (!isRecapSeason(now)) return;
            if (here === '/userHome') return;                 // already visible there
            if (localStorage.getItem(SEEN_KEY) === recapWindowKey(now)) return;
        }
        const data = await fetchRecap(opts.league, 'latest', opts.userId);
        if (!data || !(data.recaps || []).length) return;     // nothing to show yet — don't burn the key
        showPopup(data, opts.userId);
        if (!opts.force) localStorage.setItem(SEEN_KEY, recapWindowKey(now));
    }

    window.ccRecap = { cardHtml, selectorHtml, fetchRecap, mountInline, showPopup, closePopup, maybeShowPopup, recapWindowKey, isRecapSeason, movement, ordinal };

    // App-wide auto-run: after the page's userState is in scope, offer the
    // weekly popup to the logged-in viewer (their own recap, not the profile
    // being viewed).
    if (typeof document !== 'undefined') {
        document.addEventListener('DOMContentLoaded', function () {
            try {
                const meta = window.userState && window.userState.user_metadata && window.userState.user_metadata.metadata;
                if (!meta || !meta.userId) return;
                const league = meta.league === 'gg' ? 'graham-league' : 'claunts-league';
                const force = new URLSearchParams(location.search).get('recapPopup') === '1';
                window.ccRecap.maybeShowPopup({ league: league, userId: meta.userId, force: force });
            } catch (e) { /* non-fatal */ }
        });
    }

    // Allow node/jest to exercise the pure gating helpers.
    if (typeof module !== 'undefined' && module.exports) module.exports = { recapWindowKey, isRecapSeason };
})();
