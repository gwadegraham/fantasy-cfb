// Shared toast setup so every page's notifications look and behave identically.
// Loaded once via the navbar partial (after Toastify), so it initializes before
// the deferred page scripts that use it.
//
// Two ways to fire a toast, both styled the same:
//   ccToast.success('Saved');                     // preferred
//   successToast.options.text = 'Saved'; successToast.showToast();  // legacy
(function () {
    if (typeof Toastify === 'undefined') return;

    function make(kind, duration) {
        return Toastify({
            text: '',
            duration: duration,
            close: true,
            // Bottom-right clears the sticky navbar and the mobile hamburger, and
            // avoids Toastify's top-gravity offset bug that hid toasts off-screen
            // on narrow viewports.
            gravity: 'bottom',
            position: 'right',
            stopOnFocus: true,          // pause the auto-dismiss timer on hover
            className: 'cc-toast cc-toast--' + kind,
            offset: { y: '24px', x: '16px' }
        });
    }

    // Shared instances (legacy call sites set .options.text then .showToast()).
    window.successToast = make('success', 4000);
    window.failToast = make('error', 5000);   // errors get a beat longer to read
    window.infoToast = make('info', 4000);

    // Convenience helpers.
    window.ccToast = {
        success: function (msg) { successToast.options.text = msg; successToast.showToast(); },
        error: function (msg) { failToast.options.text = msg; failToast.showToast(); },
        info: function (msg) { infoToast.options.text = msg; infoToast.showToast(); }
    };
})();
