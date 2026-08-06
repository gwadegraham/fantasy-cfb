// Draft-night FX: a "THE PICK IS IN" hero reveal + a synthesized draft-pick
// stinger. Loaded on the draft page after confetti.js (which provides ccBurst).
// Everything degrades gracefully: no-op hero under prefers-reduced-motion, and
// the sound is a mutable Web Audio synth (no audio file, so nothing to license
// or host).
(function () {
    var revealing = false;

    function reduced() {
        return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    }

    // Lighten a very dark team color (navy/black) until it reads on the dark UI,
    // so the hero glow/ring is visible for every team. Bright colors pass through.
    function hexToRgb(hex) {
        if (typeof hex !== 'string') return null;
        var m = hex.trim().replace('#', '');
        if (m.length === 3) m = m.split('').map(function (c) { return c + c; }).join('');
        if (!/^[0-9a-fA-F]{6}$/.test(m)) return null;
        return { r: parseInt(m.slice(0, 2), 16), g: parseInt(m.slice(2, 4), 16), b: parseInt(m.slice(4, 6), 16) };
    }
    function lum(r, g, b) {
        var a = [r, g, b].map(function (v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
        return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2];
    }
    window.ccLiftColor = function (hex) {
        var rgb = hexToRgb(hex);
        if (!rgb) return null;
        var r = rgb.r, g = rgb.g, b = rgb.b, guard = 0;
        while (lum(r, g, b) < 0.12 && guard < 14) { r += (255 - r) * 0.12; g += (255 - g) * 0.12; b += (255 - b) * 0.12; guard++; }
        var h = function (v) { return Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0'); };
        return '#' + h(r) + h(g) + h(b);
    };

    // ---- Hero reveal ---------------------------------------------------------
    // cell: the target board <td>. info: {logo, color, name, sub}. opts.onLand
    // fires when the badge lands in the cell (wire the confetti/sound there).
    window.ccDraftReveal = function (cell, info, opts) {
        opts = opts || {};
        var onLand = opts.onLand || function () {};
        // Reduced motion, no cell, or a reveal already mid-flight -> skip the
        // animation but still fire onLand so sound/confetti aren't lost.
        if (!cell || reduced() || revealing) { onLand(); return; }
        revealing = true;

        var color = info.color || '#8E8CF0';
        var img = cell.querySelector('img');
        if (img) { img.style.transition = 'none'; img.style.opacity = '0'; }

        var glow = document.createElement('div');
        glow.className = 'dr-hero-glow';
        glow.style.background = 'radial-gradient(circle at 50% 45%, ' + color + '55, transparent 46%)';
        var stage = document.createElement('div');
        stage.className = 'dr-hero-stage';
        stage.innerHTML =
            '<div class="dr-hero" style="--tc:' + color + '">' +
                '<span class="dr-hero-kicker">The pick is in</span>' +
                '<span class="dr-hero-badge">' + (info.logo ? '<img src="' + info.logo + '" alt="">' : '') + '</span>' +
                '<span class="dr-hero-name"></span>' +
                '<span class="dr-hero-sub"></span>' +
            '</div>';
        document.body.appendChild(glow);
        document.body.appendChild(stage);
        var hero = stage.firstChild;
        // textContent (not innerHTML) for the school/manager strings — untrusted.
        hero.querySelector('.dr-hero-name').textContent = info.name || '';
        hero.querySelector('.dr-hero-sub').textContent = info.sub || '';

        requestAnimationFrame(function () { hero.classList.add('show'); glow.classList.add('show'); });

        setTimeout(function () {
            var h = hero.getBoundingClientRect(), c = cell.getBoundingClientRect();
            var dx = (c.left + c.width / 2) - (h.left + h.width / 2);
            var dy = (c.top + c.height / 2) - (h.top + h.height / 2);
            var scale = Math.max(0.12, (c.width * 0.72) / h.width);
            hero.style.transition = 'transform .62s cubic-bezier(.5,0,.2,1), opacity .3s ease .4s';
            hero.style.transform = 'translate(' + dx + 'px,' + dy + 'px) scale(' + scale + ')';
            hero.style.opacity = '0';
            glow.classList.remove('show');
            setTimeout(function () {
                if (img) { img.style.transition = 'transform .4s cubic-bezier(.2,1.4,.3,1), opacity .25s'; img.style.opacity = '1'; }
                try { stage.remove(); glow.remove(); } catch (e) {}
                revealing = false;
                onLand();
            }, 620);
        }, 560);
    };

    // ---- Draft-pick stinger --------------------------------------------------
    // Plays the league's draft chime (public/sounds/draft-pick.mp3). If the file
    // can't load/play (network, decode, autoplay-before-gesture), it falls back
    // to a synthesized brass + stamp hit so a pick is never silent.
    function muted() { return window.localStorage.getItem('cc_draft_mute') === '1'; }

    var chime = null, chimeBroken = false;
    function getChime() {
        if (chime) return chime;
        chime = new Audio('/sounds/draft-pick.mp3');
        chime.preload = 'auto';
        chime.volume = 0.6;
        chime.addEventListener('error', function () { chimeBroken = true; });
        return chime;
    }

    // Synth fallback (Web Audio): a brass-ish major chord blip + a low "stamp".
    var actx = null;
    function ctx() {
        if (actx) return actx;
        var AC = window.AudioContext || window.webkitAudioContext;
        if (AC) actx = new AC();
        return actx;
    }
    function synthStinger() {
        var a = ctx(); if (!a) return;
        if (a.state === 'suspended') { try { a.resume(); } catch (e) {} }
        var t = a.currentTime;
        var master = a.createGain();
        master.connect(a.destination);
        master.gain.setValueAtTime(0.0001, t);
        master.gain.exponentialRampToValueAtTime(0.26, t + 0.02);
        master.gain.exponentialRampToValueAtTime(0.0001, t + 0.55);
        var lp = a.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.setValueAtTime(1100, t);
        lp.frequency.exponentialRampToValueAtTime(3200, t + 0.12);
        lp.connect(master);
        [220, 277.18, 329.63].forEach(function (f, i) {
            var o = a.createOscillator();
            o.type = 'sawtooth';
            o.frequency.setValueAtTime(f, t);
            o.detune.value = (i - 1) * 6;
            var g = a.createGain(); g.gain.value = 0.5;
            o.connect(g); g.connect(lp);
            o.start(t); o.stop(t + 0.5);
        });
        var thump = a.createOscillator();
        thump.type = 'triangle';
        thump.frequency.setValueAtTime(150, t);
        thump.frequency.exponentialRampToValueAtTime(60, t + 0.18);
        var tg = a.createGain();
        tg.gain.setValueAtTime(0.6, t);
        tg.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
        thump.connect(tg); tg.connect(master);
        thump.start(t); thump.stop(t + 0.24);
    }

    // Browsers block audio until a user gesture; on the first one, prime the
    // chime (and resume the fallback context) so the first pick isn't silent.
    ['pointerdown', 'keydown'].forEach(function (ev) {
        window.addEventListener(ev, function unlock() {
            try { getChime().load(); } catch (e) {}
            var a = ctx(); if (a && a.state === 'suspended') a.resume();
        }, { once: true, passive: true });
    });

    // Play the chime through. (An earlier version capped playback at ~1.4s on
    // the mistaken belief the clip contained the chime twice — it's a single
    // chime, so let it finish.)
    window.ccDraftStinger = function () {
        if (muted()) return;
        if (chimeBroken) { synthStinger(); return; }
        try {
            var c = getChime();
            c.currentTime = 0;
            var p = c.play();
            if (p && p.catch) p.catch(function () { synthStinger(); });
        } catch (e) { synthStinger(); }
    };

    // ---- Small mute toggle (self-injected; draft page only) ------------------
    function injectMute() {
        if (document.getElementById('dr-mute')) return;
        var b = document.createElement('button');
        b.id = 'dr-mute';
        b.type = 'button';
        b.className = 'dr-mute';
        function render() {
            b.setAttribute('aria-label', muted() ? 'Unmute draft sounds' : 'Mute draft sounds');
            b.textContent = muted() ? '🔇' : '🔊';
        }
        render();
        b.addEventListener('click', function () {
            window.localStorage.setItem('cc_draft_mute', muted() ? '0' : '1');
            render();
            if (!muted()) { try { window.ccDraftStinger(); } catch (e) {} }   // preview on unmute
        });
        document.body.appendChild(b);
    }
    if (document.readyState !== 'loading') injectMute();
    else document.addEventListener('DOMContentLoaded', injectMute);
})();
