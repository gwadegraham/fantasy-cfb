// Haptic feedback on key mobile interactions.
// Uses the Vibration API (Android) — iOS doesn't support it from the web,
// but the tactile CSS press still provides visual feedback there.
(function () {
    if (!navigator.vibrate) return;

    var LIGHT = 8;
    var MEDIUM = 15;

    document.addEventListener('click', function (e) {
        var el = e.target.closest(
            '.btn-primary, .btn-secondary, .btn-ghost, ' +
            '.uh-season-pill, .uh-tile, ' +
            '.welcome-actions button, .modal-actions button, ' +
            '.standings-row, .h2h-card, .uh-edit'
        );
        if (!el) return;

        // Stronger pulse for primary actions
        if (el.matches('.btn-primary, .modal-actions .btn-primary')) {
            navigator.vibrate(MEDIUM);
        } else {
            navigator.vibrate(LIGHT);
        }
    }, { passive: true });
})();
