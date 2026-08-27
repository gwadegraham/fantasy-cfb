// Animate numeric values from 0 to their target on first appearance.
// Call ccCountUp(containerEl) after inserting DOM with numeric elements.
(function () {
    var DURATION = 800;
    var SELECTOR = '.stat-value, .uh-traj-num, .uh-mug-sc, .uh-rg-pts, .uh-mug-pct, .uh-sched-pct, .uh-pre-stat-v, .uh-hist-pts';
    var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    window.ccCountUp = function (root) {
        if (!root || reduced) return;
        var els = root.querySelectorAll(SELECTOR);
        for (var i = 0; i < els.length; i++) animate(els[i]);
    };

    function animate(el) {
        if (el.children.length > 0) return;
        var text = el.textContent.trim();
        var m = text.match(/^([+\-−]?)(\d+(?:\.\d+)?)(\s*%?)$/);
        if (!m) return;
        var prefix = m[1];
        var target = parseFloat(m[2]);
        var suffix = m[3];
        if (target === 0) return;
        var isInt = target % 1 === 0;
        var start = performance.now();

        requestAnimationFrame(function tick(now) {
            var t = Math.min((now - start) / DURATION, 1);
            var ease = 1 - Math.pow(1 - t, 3);
            var cur = ease * target;
            el.textContent = prefix + (isInt ? Math.round(cur) : cur.toFixed(1)) + suffix;
            if (t < 1) requestAnimationFrame(tick);
        });
    }
})();
