// Campus Clash custom icon suite — a cohesive, duotone line set in the app
// palette that replaces the mixed emojis used around the UI. One place to define
// every icon so they stay consistent.
//
//   ccIcon('trophy')                      -> <svg …> string (default size 18)
//   ccIcon('flame', { size: 24 })         -> larger
//   ccIcon('trophy', { color: '#fff' })   -> recolor (icons use currentColor)
//
// Any element with a data-icon attribute is auto-hydrated on load, e.g.
//   <span data-icon="star" data-icon-size="24"></span>
//
// Icons draw with currentColor (stroke + a soft fill via fill-opacity), so a
// single `color` controls the whole glyph. Each has a semantic default color.
(function () {
    // name: { c: default color, sw: stroke width (opt, default 1.7),
    //         raw: skip the shared stroke wrapper (multicolor), svg: inner markup }
    var ICONS = {
        trophy: { c: '#E0B341', svg:
            '<path d="M6 4h12v4a6 6 0 0 1-12 0V4Z" fill="currentColor" fill-opacity=".22"/>' +
            '<path d="M6 5.5H3.5V7a3 3 0 0 0 3 3"/><path d="M18 5.5h2.5V7a3 3 0 0 1-3 3"/>' +
            '<path d="M12 14v2.5"/><path d="M8.5 20h7l-1-3.5h-5Z" fill="currentColor" fill-opacity=".22"/>' },
        // Two-tone fire (red-orange outer + amber core) — baked, so it stays
        // fire-colored regardless of any color override.
        flame: { c: '#EF5A2A', sw: 1.6, svg:
            '<path d="M13 2.5c.4 2.3-.4 4.1-1.7 5.6-.8.9-1.6 1.9-1.6 3.4 0 0-.6-.7-.6-1.9C7.5 10.6 6.5 12.4 6.5 14.5a5.5 5.5 0 0 0 11 0c0-3.6-2.9-6-4.5-12Z" fill="#EF5A2A" fill-opacity=".18" stroke="#EF5A2A"/>' +
            '<path d="M12 20a2.7 2.7 0 0 1-2.7-2.7c0-1.5 1.2-2.4 2.7-3.9 1.5 1.5 2.7 2.4 2.7 3.9A2.7 2.7 0 0 1 12 20Z" fill="#F7A81E" fill-opacity=".3" stroke="#F7A81E"/>' },
        snowflake: { c: '#7FC7FF', sw: 1.6, svg:
            '<path d="M12 3v18M4.2 7.5l15.6 9M19.8 7.5 4.2 16.5"/>' +
            '<path d="M12 6l-2-1.6M12 6l2-1.6M12 18l-2 1.6M12 18l2 1.6"/>' +
            '<path d="M6.6 9.4 6.9 7M6.6 9.4 4.3 9.7M17.4 14.6l.3 2.4M17.4 14.6l2.3.3"/>' },
        riser: { c: '#22C37A', svg:
            '<path d="M4 19V5" stroke-opacity=".45"/><path d="M4 19h16" stroke-opacity=".45"/>' +
            '<path d="M6.5 15l4-4 3 3 5-6"/><path d="M15 8h3.5v3.5"/>' },
        heartbreak: { c: '#ED5858', svg:
            '<path d="M12 20S4 14.6 4 9.3A3.7 3.7 0 0 1 12 7a3.7 3.7 0 0 1 8 2.3C20 14.6 12 20 12 20Z" fill="currentColor" fill-opacity=".18"/>' +
            '<path d="M12.4 7 10.6 10.4l2.6 1.8-1.8 3.2"/>' },
        checkered: { c: '#C9CEE6', sw: 1.6, svg:
            '<path d="M5.5 3v18"/><path d="M5.5 4.5h13v9h-13Z"/>' +
            '<g fill="currentColor" stroke="none">' +
            '<rect x="5.5" y="4.5" width="3.25" height="2.25"/><rect x="12" y="4.5" width="3.25" height="2.25"/>' +
            '<rect x="8.75" y="6.75" width="3.25" height="2.25"/><rect x="15.25" y="6.75" width="3.25" height="2.25"/>' +
            '<rect x="5.5" y="9" width="3.25" height="2.25"/><rect x="12" y="9" width="3.25" height="2.25"/>' +
            '<rect x="8.75" y="11.25" width="3.25" height="2.25"/><rect x="15.25" y="11.25" width="3.25" height="2.25"/></g>' },
        burst: { c: '#E0B341', sw: 1.6, svg:
            '<path d="M12 3.5 13.7 9l5.5 1.2-4.2 3.4 1.2 5.4L12 16.2 7.8 19l1.2-5.4L4.8 10.2 10.3 9Z" fill="currentColor" fill-opacity=".2"/>' +
            '<path d="M20.5 4.5 19 6M4 4.5 5.5 6M21 14l-1.8-.4M3 14l1.8-.4"/>' },
        medal: { c: '#E0B341', sw: 1.6, svg:
            '<path d="M8.5 3 6 8.5M15.5 3 18 8.5"/>' +
            '<circle cx="12" cy="15" r="5.2" fill="currentColor" fill-opacity=".2"/>' +
            '<path d="M12 12.6l.9 1.9 2 .3-1.5 1.4.4 2-1.8-1-1.8 1 .4-2L9.1 14.8l2-.3Z"/>' },
        bolt: { c: '#6C9BFF', sw: 1.6, svg:
            '<path d="M13.5 3 5.5 13.5H11l-1 7.5 8.5-11H13Z" fill="currentColor" fill-opacity=".2"/>' },
        target: { c: '#6C9BFF', sw: 1.6, svg:
            '<circle cx="12" cy="12" r="8.3"/><circle cx="12" cy="12" r="4.8" fill="currentColor" fill-opacity=".18"/>' +
            '<circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"/>' },
        gem: { c: '#6C9BFF', sw: 1.5, svg:
            '<path d="M7 4.5h10l3.2 4.2L12 20 3.8 8.7Z" fill="currentColor" fill-opacity=".18"/>' +
            '<path d="M3.8 8.7h16.4M9 4.5 6.4 8.7 12 20M15 4.5l2.6 4.2L12 20"/>' },
        upset: { c: '#ED5858', sw: 1.6, svg:
            '<rect x="4" y="4" width="16" height="16" rx="4" fill="currentColor" fill-opacity=".16"/>' +
            '<g fill="currentColor" stroke="none"><circle cx="8.5" cy="8.5" r="1.3"/><circle cx="15.5" cy="8.5" r="1.3"/>' +
            '<circle cx="12" cy="12" r="1.3"/><circle cx="8.5" cy="15.5" r="1.3"/><circle cx="15.5" cy="15.5" r="1.3"/></g>' },
        chart: { c: '#22C37A', sw: 1.6, svg:
            '<path d="M4 20V4" stroke-opacity=".45"/><path d="M4 20h16" stroke-opacity=".45"/>' +
            '<rect x="6.8" y="12" width="2.6" height="5" rx=".6" fill="currentColor" fill-opacity=".22"/>' +
            '<rect x="11.7" y="9" width="2.6" height="8" rx=".6" fill="currentColor" fill-opacity=".22"/>' +
            '<rect x="16.6" y="6" width="2.6" height="11" rx=".6" fill="currentColor" fill-opacity=".22"/>' },
        star: { c: '#E0B341', sw: 1.6, svg:
            '<path d="M12 3.2 14.6 8.9l6.2.6-4.7 4.1 1.4 6.1L12 16.6 6.5 19.7l1.4-6.1L3.2 9.5l6.2-.6Z" fill="currentColor" fill-opacity=".2"/>' },
        crystalball: { c: '#A98BFF', sw: 1.6, svg:
            '<circle cx="12" cy="10" r="6.3" fill="currentColor" fill-opacity=".18"/>' +
            '<path d="M6.6 17.5h10.8L18.5 21h-13Z"/><path d="M9.4 8.2A3.2 3.2 0 0 1 12.4 6"/>' +
            '<path d="M14.5 12.2l.5 1.4 1.4.5-1.4.5-.5 1.4-.5-1.4-1.4-.5 1.4-.5Z" fill="currentColor" stroke="none"/>' },
        football: { c: '#C58A4E', sw: 1.6, svg:
            '<g transform="rotate(-18 12 12)">' +
            '<path d="M3.5 12C7 5.8 17 5.8 20.5 12C17 18.2 7 18.2 3.5 12Z" fill="currentColor" fill-opacity=".2"/>' +
            '<path d="M6.5 12h11" stroke-opacity=".4"/>' +
            '<path d="M9.7 10.6v2.8M11.2 10.3v3.4M12.8 10.3v3.4M14.3 10.6v2.8"/></g>' },
        broadcast: { c: '#C9CEE6', sw: 1.6, svg:
            '<rect x="3" y="7" width="18" height="12" rx="2.5" fill="currentColor" fill-opacity=".12"/>' +
            '<path d="M8.5 4 12 7l3.5-3"/>' +
            '<path d="M10.5 10.5 14 13l-3.5 2.5Z" fill="currentColor" stroke="none"/>' },
        pennant: { c: '#E0B341', sw: 1.7, svg:
            '<path d="M6 3.4v17.2"/><path d="M6 5l12.6 3.3L6 11.6Z" fill="currentColor" fill-opacity=".2"/>' },
        // Multicolor by design — bypasses the currentColor wrapper.
        confetti: { c: '#F4F6FB', raw: true, svg:
            '<svg class="cc-icon cc-i-confetti" width="__S__" height="__S__" viewBox="0 0 24 24" fill="none" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
            '<path d="M3.5 20.5 8 9l7 7Z" fill="#6C9BFF" fill-opacity=".2" stroke="#6C9BFF" stroke-width="1.6"/>' +
            '<g stroke="none"><rect x="14" y="3.5" width="2.4" height="2.4" rx=".5" fill="#E0B341" transform="rotate(20 15 5)"/>' +
            '<rect x="18.5" y="7" width="2.4" height="2.4" rx=".5" fill="#22C37A" transform="rotate(-15 19 8)"/>' +
            '<rect x="19" y="13" width="2.2" height="2.2" rx=".5" fill="#ED5858" transform="rotate(25 20 14)"/>' +
            '<circle cx="12.5" cy="4.5" r="1.1" fill="#A98BFF"/></g></svg>' }
    };

    window.ccIcon = function (name, opts) {
        opts = opts || {};
        var d = ICONS[name];
        if (!d) return '';
        var size = opts.size || 18;
        if (d.raw) return d.svg.replace(/__S__/g, size);
        var color = opts.color || d.c;
        var sw = d.sw || 1.7;
        // Bake the concrete color into stroke + fills. (currentColor was
        // resolving to white — an app color rule interrupts `color` inheritance
        // to the SVG's descendants — so use the color directly, which inherits
        // via the `stroke`/`fill` presentation attributes with nothing competing.)
        var inner = d.svg.replace(/currentColor/g, color);
        return '<svg class="cc-icon cc-i-' + name + '" width="' + size + '" height="' + size + '"'
            + ' viewBox="0 0 24 24" fill="none" stroke="' + color + '" stroke-width="' + sw + '"'
            + ' stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + inner + '</svg>';
    };

    // Baseline alignment for inline icons, injected once (icons appear across
    // several pages, each with its own CSS — keep the rule in one place).
    (function injectStyle() {
        if (document.getElementById('cc-icon-style')) return;
        var st = document.createElement('style');
        st.id = 'cc-icon-style';
        st.textContent =
            '.cc-icon{vertical-align:-.18em;flex-shrink:0}' +
            // Headers: center the icon with the text via flex (baseline hacks
            // drift on large headings).
            '.highlights-header{display:flex;align-items:center;justify-content:center;gap:.4rem}' +
            '.proj-panel-title{display:flex;align-items:center;gap:.4rem}' +
            '.hof-champ-trophy .cc-icon{vertical-align:middle}';
        document.head.appendChild(st);
    })();

    // Auto-hydrate any <element data-icon="name" data-icon-size="24"> on load, so
    // server-rendered templates can drop in icons without page-specific JS.
    function hydrate(root) {
        (root || document).querySelectorAll('[data-icon]').forEach(function (el) {
            if (el.dataset.iconDone) return;
            el.dataset.iconDone = '1';
            el.innerHTML = window.ccIcon(el.getAttribute('data-icon'), {
                size: parseInt(el.getAttribute('data-icon-size'), 10) || 18,
                color: el.getAttribute('data-icon-color') || undefined
            });
        });
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () { hydrate(); });
    } else {
        hydrate();
    }
    window.ccHydrateIcons = hydrate;
})();
