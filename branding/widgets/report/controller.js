// ═══════════════════════════════════════════════════════════════
// SignConnect — Report Manager Widget (controller.js)
// ═══════════════════════════════════════════════════════════════
// Static widget — no TB datasource. Communicates with the
// reports-service Python backend via fetch() and uses
// self.ctx.http for TB API calls.
// ═══════════════════════════════════════════════════════════════

self.onInit = function () {
    'use strict';

    var $root = self.ctx.$container[0];
    var container = $root.querySelector('.rpt-root');
    if (!container) {
        $root.innerHTML = '<div class="rpt-root"></div>';
        container = $root.querySelector('.rpt-root');
    }

    var http = self.ctx.http;
    var settings = self.ctx.settings || {};
    var reportsApiUrl = settings.reportsApiUrl || 'http://46.225.54.21:5000';
    var defaultSections = settings.defaultSections || 'energy,co2,faults,summary';
    var maxHistoryItems = settings.maxHistoryItems || 10;

    // ── API Helpers ───────────────────────────────────────────

    function apiGet(path) {
        var obs = http.get('/api' + path);
        if (obs && typeof obs.toPromise === 'function') {
            return obs.toPromise();
        }
        return new Promise(function (resolve, reject) {
            obs.subscribe(
                function (data) { resolve(data); },
                function (err) { reject(err); }
            );
        });
    }

    function fetchApi(url, options) {
        options = options || {};
        options.headers = options.headers || {};
        options.headers['Content-Type'] = options.headers['Content-Type'] || 'application/json';
        return fetch(url, options).then(function (resp) {
            if (!resp.ok) throw new Error('HTTP ' + resp.status);
            return resp.json();
        });
    }

    // ── Back Button Navigation ────────────────────────────────

    var backBtn = container.querySelector('[data-action="back"]');
    if (backBtn) {
        backBtn.addEventListener('click', function () {
            try {
                self.ctx.stateController.openState('default', {});
            } catch (e) {
                console.error('[REPORT] Failed to navigate back:', e);
            }
        });
    }

    // ── Show Main Content ─────────────────────────────────────

    var loadingEl = container.querySelector('.rpt-loading');
    var mainEl = container.querySelector('.rpt-main');
    if (loadingEl) loadingEl.style.display = 'none';
    if (mainEl) mainEl.style.display = 'block';

    console.log('[REPORT] Widget initialized. API:', reportsApiUrl);
};

self.onDataUpdated = function () {
    // Static widget — no datasource updates to handle
};

self.onDestroy = function () {
    // Cleanup if needed in future steps
};
