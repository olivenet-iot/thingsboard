/* =========================================================
   NAV BUTTONS WIDGET — controller.js
   ThingsBoard CE Custom Widget (static type)
   
   Renders navigation cards from settings.
   Clicks navigate to dashboard states via stateController.
   ========================================================= */

self.onInit = function () {
    'use strict';

    console.log('[NAV] onInit started');

    var settings = self.ctx.settings || {};

    // ── Default buttons config ────────────────────────────────────
    var DEFAULT_BUTTONS = [
        {
            stateId: 'energy',
            title: 'Energy',
            description: 'Consumption & savings',
            icon: 'bolt',
            color: 'amber'
        },
        {
            stateId: 'health',
            title: 'Health & Faults',
            description: 'Diagnostics & alarms',
            icon: 'heart',
            color: 'emerald'
        },
        {
            stateId: 'schedule',
            title: 'Schedule',
            description: 'Lighting programs',
            icon: 'clock',
            color: 'indigo'
        }
    ];

    var buttons = settings.buttons || DEFAULT_BUTTONS;

    // ── SVG Icons ─────────────────────────────────────────────────
    var ICONS = {
        bolt: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M11 21h-1l1-7H7.5c-.58 0-.57-.32-.38-.66.19-.34.05-.08.07-.12C8.48 10.94 10.42 7.54 13 3h1l-1 7h3.5c.49 0 .56.33.47.51l-.07.15C12.96 17.55 11 21 11 21z"/></svg>',
        heart: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>',
        clock: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z"/></svg>',
        chart: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3.5 18.49l6-6.01 4 4L22 6.92l-1.41-1.41-7.09 7.97-4-4L2 16.99z"/></svg>',
        settings: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.488.488 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.484.484 0 0 0-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.07.62-.07.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/></svg>',
        shield: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm0 10.99h7c-.53 4.12-3.28 7.79-7 8.94V12H5V6.3l7-3.11v8.8z"/></svg>'
    };

    var ARROW_SVG = '<svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><path d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6z"/></svg>';

    // ── Render ────────────────────────────────────────────────────
    var grid = document.getElementById('nav-grid');
    if (!grid) return;

    grid.innerHTML = '';

    buttons.forEach(function (btn, index) {
        var card = document.createElement('div');
        card.className = 'nav-card';
        card.setAttribute('data-state', btn.stateId || '');

        var iconSvg = ICONS[btn.icon] || ICONS['bolt'];
        var colorClass = 'color-' + (btn.color || 'amber');

        card.innerHTML =
            '<div class="nav-icon ' + colorClass + '">' + iconSvg + '</div>' +
            '<div class="nav-text">' +
                '<div class="nav-title">' + (btn.title || 'Navigate') + '</div>' +
                '<div class="nav-desc">' + (btn.description || '') + '</div>' +
            '</div>' +
            '<div class="nav-arrow">' + ARROW_SVG + '</div>';

        card.addEventListener('click', function () {
            var stateId = btn.stateId;
            if (!stateId) { return; }

            var sc = self.ctx.stateController;
            
            // Debug: list ALL methods and properties
            var info = [];
            for (var key in sc) {
                info.push(key + ':' + typeof sc[key]);
            }
            console.log('[NAV] stateController keys:', info.join(', '));
            console.log('[NAV] Target state:', stateId);
            console.log('[NAV] Current stateId:', sc.getStateId ? sc.getStateId() : 'N/A');
            console.log('[NAV] getStateParams:', sc.getStateParams ? JSON.stringify(sc.getStateParams()) : 'N/A');
            console.log('[NAV] getStateIdAtIndex:', sc.getStateIdAtIndex ? sc.getStateIdAtIndex(0) : 'N/A');
            
            // Try: openState with params object
            try {
                sc.openState(stateId, {});
                console.log('[NAV] openState(id, {}) called');
            } catch(e) {
                console.error('[NAV] openState failed:', e.message);
            }
        });

        grid.appendChild(card);
    });

    console.log('[NAV] Rendered', buttons.length, 'nav buttons');
};

self.onDataUpdated = function () {};

self.onDestroy = function () {
    console.log('[NAV] onDestroy');
};
