// Win reveal: a transient full-screen "moment" that plays when your weekly H2H
// matchup goes final — a slamming W (win), a quieter L (loss), or a T (tie),
// with the score and confetti on a win. Self-contained: it injects its own
// styles and confetti, so it works on any page that loads this one file.
//
//   ccWinReveal({ result:'win'|'loss'|'tie', oppLabel, myScore, oppScore, onDone })
//
// No-op-ish under prefers-reduced-motion (shows the card, skips the slam +
// confetti). Auto-dismisses after ~2.8s; tap anywhere to dismiss early.
(function () {
    function reduced() {
        return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    }

    var styled = false;
    function injectStyle() {
        if (styled) return; styled = true;
        var css =
        '.cwr-scrim{position:fixed;inset:0;z-index:4000;display:flex;align-items:center;justify-content:center;' +
        'background:rgba(16,19,34,.74);-webkit-backdrop-filter:blur(4px);backdrop-filter:blur(4px);' +
        'opacity:0;transition:opacity .3s ease;pointer-events:none}' +
        '.cwr-scrim.show{opacity:1;pointer-events:auto}' +
        '.cwr-card{display:flex;flex-direction:column;align-items:center;gap:8px;text-align:center;padding:0 24px}' +
        '.cwr-stamp{font-family:Graduate,serif;font-weight:800;font-size:7.5rem;line-height:.9;' +
        'color:var(--cc-success,#22C37A);text-shadow:0 8px 30px rgba(0,0,0,.5);opacity:0;transform:scale(2.8) rotate(-14deg)}' +
        '.cwr-loss .cwr-stamp{color:var(--cc-danger,#B5423F)}.cwr-tie .cwr-stamp{color:var(--cc-muted,#8A90A8)}' +
        '.cwr-stamp.slam{animation:cwr-slam .5s cubic-bezier(.3,1.5,.4,1) forwards}' +
        '@keyframes cwr-slam{0%{opacity:0;transform:scale(2.8) rotate(-14deg)}' +
        '60%{opacity:1;transform:scale(.92) rotate(-7deg)}100%{opacity:1;transform:scale(1) rotate(-7deg)}}' +
        '.cwr-head{font-size:1.7rem;font-weight:800;color:var(--cc-text,#F4F6FB)}' +
        '.cwr-sub{font-size:1rem;color:var(--cc-muted,#8A90A8)}' +
        '.cwr-bar{width:min(280px,72vw);height:10px;border-radius:99px;background:rgba(0,0,0,.35);overflow:hidden;margin-top:6px}' +
        '.cwr-bar i{display:block;height:100%;width:52%;border-radius:99px;background:var(--cc-success,#22C37A);transition:width .8s cubic-bezier(.4,0,.2,1)}' +
        '.cwr-loss .cwr-bar i{background:var(--cc-danger,#B5423F)}.cwr-tie .cwr-bar i{background:var(--cc-muted,#8A90A8)}' +
        '.cwr-score{font-size:1.5rem;font-weight:800;color:var(--cc-text,#F4F6FB);font-variant-numeric:tabular-nums}' +
        '.cwr-tap{font-size:.72rem;color:var(--cc-muted,#8A90A8);margin-top:14px;opacity:.7}' +
        '#cwr-burst{position:fixed;inset:0;z-index:4001;pointer-events:none}' +
        '@media (prefers-reduced-motion:reduce){.cwr-stamp{opacity:1;transform:none}.cwr-bar i,.cwr-scrim{transition:none}}';
        var s = document.createElement('style'); s.id = 'cwr-style'; s.textContent = css; document.head.appendChild(s);
    }

    // ---- self-contained confetti burst (the tuned draft burst) --------------
    var cv, ctx, parts = [], raf = null;
    function sizeCv() { cv.width = window.innerWidth; cv.height = window.innerHeight; ctx = cv.getContext('2d'); }
    function ensureCv() {
        cv = document.getElementById('cwr-burst');
        if (!cv) { cv = document.createElement('canvas'); cv.id = 'cwr-burst'; document.body.appendChild(cv); }
        sizeCv();
    }
    function loop() {
        ctx.clearRect(0, 0, cv.width, cv.height);
        for (var i = parts.length - 1; i >= 0; i--) {
            var p = parts[i];
            p.vy += 0.102; p.vx *= 0.837; p.vy *= 0.837; p.x += p.vx; p.y += p.vy; p.rot += p.rs; p.life -= 0.005;
            if (p.life <= 0 || p.y > cv.height + 40) { parts.splice(i, 1); continue; }
            ctx.save(); ctx.globalAlpha = Math.max(0, Math.min(1, p.life)); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
            ctx.fillStyle = p.c; ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h); ctx.restore();
        }
        raf = parts.length ? requestAnimationFrame(loop) : null;
        if (!parts.length) ctx.clearRect(0, 0, cv.width, cv.height);
    }
    function burst(x, y, cols) {
        ensureCv();
        for (var i = 0; i < 120; i++) {
            var a = Math.random() * Math.PI * 2, s = 22 + Math.random() * 28;
            parts.push({ x: x, y: y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 2, w: 5 + Math.random() * 6, h: 3 + Math.random() * 4,
                rot: Math.random() * Math.PI, rs: (Math.random() - 0.5) * 0.4, life: 1 + Math.random() * 0.3, c: cols[(Math.random() * cols.length) | 0] });
        }
        if (raf === null) raf = requestAnimationFrame(loop);
    }

    window.ccWinReveal = function (opts) {
        opts = opts || {};
        var result = opts.result === 'loss' ? 'loss' : opts.result === 'tie' ? 'tie' : 'win';
        injectStyle();

        var stamp = result === 'win' ? 'W' : result === 'loss' ? 'L' : 'T';
        var head = result === 'win' ? 'You win!' : result === 'loss' ? 'Tough one' : 'All square';
        var opp = opts.oppLabel || 'your opponent';
        var sub = result === 'win' ? ('You beat ' + opp) : result === 'loss' ? (opp + ' got you') : ('Tied with ' + opp);
        if (opts.bonus > 0 && result !== 'loss') sub += result === 'tie' ? (' · +' + opts.bonus + ' each') : (' · +' + opts.bonus + ' bonus');
        var hasScore = opts.myScore != null && opts.oppScore != null;

        var scrim = document.createElement('div');
        scrim.className = 'cwr-scrim cwr-' + result;
        scrim.innerHTML =
            '<div class="cwr-card">' +
                '<div class="cwr-stamp">' + stamp + '</div>' +
                '<div class="cwr-head"></div>' +
                '<div class="cwr-sub"></div>' +
                (hasScore ? '<div class="cwr-bar"><i></i></div><div class="cwr-score"></div>' : '') +
                '<div class="cwr-tap">tap to dismiss</div>' +
            '</div>';
        document.body.appendChild(scrim);
        // textContent for the manager-supplied strings (names / franchise).
        scrim.querySelector('.cwr-head').textContent = head;
        scrim.querySelector('.cwr-sub').textContent = sub;
        if (hasScore) scrim.querySelector('.cwr-score').textContent = opts.myScore + ' – ' + opts.oppScore;

        var bar = scrim.querySelector('.cwr-bar i');
        var isReduced = reduced();

        requestAnimationFrame(function () {
            scrim.classList.add('show');
            if (!isReduced) scrim.querySelector('.cwr-stamp').classList.add('slam');
            if (bar) setTimeout(function () { bar.style.width = result === 'win' ? '100%' : result === 'loss' ? '8%' : '50%'; }, 300);
            if (result === 'win' && !isReduced) {
                setTimeout(function () { burst(window.innerWidth / 2, window.innerHeight * 0.42, ['#ffffff', '#22C37A', '#8E8CF0', '#E0B341']); }, 380);
            }
        });

        var done = false;
        function close() {
            if (done) return; done = true;
            scrim.classList.remove('show');
            setTimeout(function () { try { scrim.remove(); } catch (e) {} if (typeof opts.onDone === 'function') opts.onDone(); }, 320);
        }
        scrim.addEventListener('click', close);
        setTimeout(close, opts.duration || 2800);
        return close;
    };

    window.addEventListener('resize', function () { if (cv) sizeCv(); });
})();
