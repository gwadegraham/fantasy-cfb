// Pull-to-refresh for mobile — attach to any page by including this script.
// Shows a small spinner indicator when the user pulls down from the top,
// then reloads. Only activates on touch devices when scrolled to the top.
(function () {
    if (!('ontouchstart' in window)) return;

    var startY = 0;
    var pulling = false;
    var indicator = null;
    var THRESHOLD = 80;

    function createIndicator() {
        var el = document.createElement('div');
        el.className = 'ptr-indicator';
        el.innerHTML = '<span class="ptr-spinner"></span>';
        document.body.appendChild(el);
        return el;
    }

    document.addEventListener('touchstart', function (e) {
        if (window.scrollY > 5) return;
        startY = e.touches[0].clientY;
        pulling = true;
    }, { passive: true });

    document.addEventListener('touchmove', function (e) {
        if (!pulling) return;
        var dy = e.touches[0].clientY - startY;
        if (dy < 0) { pulling = false; return; }
        if (dy > 10 && !indicator) indicator = createIndicator();
        if (indicator) {
            var progress = Math.min(dy / THRESHOLD, 1);
            indicator.style.transform = 'translateX(-50%) translateY(' + Math.min(dy * 0.4, 60) + 'px)';
            indicator.style.opacity = progress;
            indicator.classList.toggle('ptr-ready', progress >= 1);
        }
    }, { passive: true });

    document.addEventListener('touchend', function () {
        if (!pulling) return;
        pulling = false;
        if (indicator && indicator.classList.contains('ptr-ready')) {
            indicator.classList.add('ptr-loading');
            indicator.style.transform = 'translateX(-50%) translateY(48px)';
            window.location.reload();
        } else if (indicator) {
            indicator.style.transform = 'translateX(-50%) translateY(0)';
            indicator.style.opacity = '0';
            setTimeout(function () { if (indicator) { indicator.remove(); indicator = null; } }, 200);
        }
    }, { passive: true });
})();
