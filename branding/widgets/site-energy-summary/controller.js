// ═══════════════════════════════════════════════════════════════
// SignConnect — Site Energy Summary Widget (controller.js)
// ═══════════════════════════════════════════════════════════════
// SITE state header widget. Shows:
//   - Site name, tier badge, device status counts
//   - 4 metric cards: Energy, Cost, CO2, Power (today aggregates)
//
// Receives site ASSET ID from dashboard state params (Fleet nav).
// Queries relations to find child devices, polls telemetry.
// ═══════════════════════════════════════════════════════════════

var pollTimer = null;

self.onInit = function () {
    'use strict';

    var POLL_INTERVAL = (self.ctx.settings && self.ctx.settings.pollInterval) || 15000;
    var FRESHNESS_ONLINE = 600000;   // 10 min
    var FRESHNESS_STALE  = 3600000;  // 60 min

    var $root = self.ctx.$container[0];
    var container = $root.querySelector('.ses-root');
    if (!container) {
        $root.innerHTML = '<div class="ses-root"></div>';
        container = $root.querySelector('.ses-root');
    }
    var http = self.ctx.http;

    var siteId = null;
    var entityName = '';
    var devices = [];
    var siteAttrs = {};

    var TELEMETRY_KEYS = [
        'dim_value', 'power_watts', 'energy_wh', 'co2_grams', 'cost_currency',
        'status_light_src_on', 'status_driver_ok', 'status_ready',
        'fault_overall_failure', 'fault_input_power', 'fault_thermal_shutdown',
        'fault_thermal_derating', 'fault_current_limited', 'fault_light_src_failure',
        'fault_driver_failure', 'fault_external', 'fault_d4i_power_exceeded',
        'fault_overcurrent'
    ].join(',');

    // ── Resolve Site Asset ID ─────────────────────────────────

    function resolveSiteId() {
        try {
            var stateParams = self.ctx.stateController.getStateParams();
            if (stateParams && stateParams.entityId && stateParams.entityId.id) {
                entityName = stateParams.entityName || '';
                return stateParams.entityId.id;
            }
        } catch (e) { /* stateController unavailable */ }

        try {
            var ds = self.ctx.datasources;
            if (ds && ds.length > 0 && ds[0].entity) {
                var eid = ds[0].entity.id;
                return (typeof eid === 'object' && eid !== null) ? eid.id : eid;
            }
        } catch (e) { /* datasource unavailable */ }

        return (self.ctx.settings && self.ctx.settings.siteAssetId) || null;
    }

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

    // ── Fetch Devices via Relations ──────────────────────────

    function fetchDevices() {
        return apiGet('/relations?fromId=' + siteId + '&fromType=ASSET&relationType=Contains')
            .then(function (relations) {
                var deviceRelations = relations.filter(function (r) {
                    return r.to && r.to.entityType === 'DEVICE';
                });
                if (deviceRelations.length === 0) {
                    devices = [];
                    return Promise.resolve();
                }
                var promises = deviceRelations.map(function (r) {
                    return apiGet('/device/' + r.to.id).then(function (dev) {
                        return {
                            id: dev.id.id,
                            name: dev.name || 'Unknown',
                            type: dev.type || '',
                            telemetry: {},
                            faultCount: 0,
                            lastActivity: 0,
                            connectionStatus: 'offline'
                        };
                    });
                });
                return Promise.all(promises).then(function (devs) {
                    devices = devs;
                });
            });
    }

    // ── Fetch Site Attributes ────────────────────────────────

    function fetchSiteAttributes() {
        return apiGet('/plugins/telemetry/ASSET/' + siteId + '/values/attributes/SERVER_SCOPE')
            .then(function (attrs) {
                siteAttrs = {};
                if (attrs && Array.isArray(attrs)) {
                    attrs.forEach(function (a) {
                        siteAttrs[a.key] = a.value;
                    });
                }
            })
            .catch(function () { siteAttrs = {}; });
    }

    // ── Poll Telemetry ───────────────────────────────────────

    function pollAllDevices() {
        if (devices.length === 0) return Promise.resolve();

        var now = Date.now();
        var promises = devices.map(function (dev) {
            return apiGet('/plugins/telemetry/DEVICE/' + dev.id + '/values/timeseries?keys=' + TELEMETRY_KEYS)
                .then(function (data) {
                    var ts = {};
                    Object.keys(data).forEach(function (key) {
                        if (data[key] && data[key].length > 0) {
                            ts[key] = data[key][0].value;
                            var t = parseInt(data[key][0].ts);
                            if (t > dev.lastActivity) dev.lastActivity = t;
                        }
                    });
                    dev.telemetry = ts;

                    var age = now - dev.lastActivity;
                    if (age < FRESHNESS_ONLINE) dev.connectionStatus = 'online';
                    else if (age < FRESHNESS_STALE) dev.connectionStatus = 'stale';
                    else dev.connectionStatus = 'offline';

                    var faults = 0;
                    ['fault_overall_failure', 'fault_input_power', 'fault_thermal_shutdown',
                     'fault_thermal_derating', 'fault_current_limited', 'fault_light_src_failure',
                     'fault_driver_failure', 'fault_external', 'fault_d4i_power_exceeded',
                     'fault_overcurrent'].forEach(function (fk) {
                        if (ts[fk] === 'true' || ts[fk] === '1' || ts[fk] === true) faults++;
                    });
                    dev.faultCount = faults;
                })
                .catch(function () { /* device offline or unreachable */ });
        });

        return Promise.all(promises);
    }

    // ── Fetch Today's Aggregates (SUM) ───────────────────────

    function fetchTodayAggregates() {
        if (devices.length === 0) return Promise.resolve();

        var startOfDay = new Date();
        startOfDay.setHours(0, 0, 0, 0);
        var startTs = startOfDay.getTime();
        var endTs = Date.now();
        var interval = endTs - startTs;

        var promises = devices.map(function (dev) {
            return apiGet('/plugins/telemetry/DEVICE/' + dev.id +
                '/values/timeseries?keys=energy_wh,co2_grams,cost_currency&startTs=' + startTs +
                '&endTs=' + endTs + '&agg=SUM&interval=' + interval)
                .then(function (data) {
                    dev.telemetry.energy_today_wh = (data.energy_wh && data.energy_wh.length > 0)
                        ? (parseFloat(data.energy_wh[0].value) || 0) : 0;
                    dev.telemetry.co2_today_grams = (data.co2_grams && data.co2_grams.length > 0)
                        ? (parseFloat(data.co2_grams[0].value) || 0) : 0;
                    dev.telemetry.cost_today = (data.cost_currency && data.cost_currency.length > 0)
                        ? (parseFloat(data.cost_currency[0].value) || 0) : 0;
                })
                .catch(function () {
                    dev.telemetry.energy_today_wh = 0;
                    dev.telemetry.co2_today_grams = 0;
                    dev.telemetry.cost_today = 0;
                });
        });

        return Promise.all(promises);
    }

    // ── Format Helpers ───────────────────────────────────────

    function formatValue(val, decimals) {
        if (val == null || isNaN(val)) return '0';
        return Number(val).toLocaleString(undefined, {
            minimumFractionDigits: decimals,
            maximumFractionDigits: decimals
        });
    }

    function formatEnergy(wh) {
        if (wh >= 1000000) return { value: formatValue(wh / 1000000, 1), unit: 'MWh' };
        if (wh >= 1000) return { value: formatValue(wh / 1000, 1), unit: 'kWh' };
        return { value: formatValue(wh, 0), unit: 'Wh' };
    }

    function formatCO2(grams) {
        if (grams >= 1000000) return { value: formatValue(grams / 1000000, 1), unit: 't' };
        if (grams >= 1000) return { value: formatValue(grams / 1000, 1), unit: 'kg' };
        return { value: formatValue(grams, 0), unit: 'g' };
    }

    function esc(str) {
        if (!str) return '';
        return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    // ── SVG Icons ────────────────────────────────────────────

    var ICONS = {
        energy: '<svg class="ses-card-icon" viewBox="0 0 20 20" fill="#f59e0b"><path d="M11.3 1.05a.75.75 0 0 1 .4.85L10.15 8h4.1a.75.75 0 0 1 .58 1.22l-6.5 8a.75.75 0 0 1-1.33-.72L8.55 10.5H4.75a.75.75 0 0 1-.6-1.2l6.5-8a.75.75 0 0 1 .65-.25z"/></svg>',
        cost: '<svg class="ses-card-icon" viewBox="0 0 20 20" fill="#059669"><path fill-rule="evenodd" d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16zm.75-11.25a.75.75 0 0 0-1.5 0v.1c-.82.12-1.57.44-2.05.95-.54.57-.77 1.32-.48 2.14.27.76.93 1.2 1.56 1.46.56.24 1.25.4 1.8.53l.07.02c.63.15 1.13.28 1.48.44.3.14.35.25.37.31.05.13.02.35-.24.6-.28.27-.78.48-1.51.48-.85 0-1.3-.27-1.52-.5a.75.75 0 0 0-1.06 1.06c.47.47 1.13.8 1.83.94v.06a.75.75 0 0 0 1.5 0v-.1c.82-.12 1.57-.44 2.05-.95.54-.57.77-1.32.48-2.14-.27-.76-.93-1.2-1.56-1.46a14.6 14.6 0 0 0-1.8-.53l-.07-.02c-.63-.15-1.13-.28-1.48-.44-.3-.14-.35-.25-.37-.31-.05-.13-.02-.35.24-.6.28-.27.78-.48 1.51-.48.85 0 1.3.27 1.52.5a.75.75 0 0 0 1.06-1.06 3.22 3.22 0 0 0-1.83-.94v-.06z" clip-rule="evenodd"/></svg>',
        co2: '<svg class="ses-card-icon" viewBox="0 0 20 20" fill="#06b6d4"><path d="M15.59 7.02a4.5 4.5 0 0 0-8.68-.98 3.5 3.5 0 0 0-.46 6.96h8.05a3 3 0 0 0 1.1-5.98zM10 4a3.5 3.5 0 0 1 3.44 2.85.75.75 0 0 0 .72.58 2 2 0 0 1-.16 4H6.45a2.5 2.5 0 0 1 .29-4.98.75.75 0 0 0 .7-.53A3.5 3.5 0 0 1 10 4z"/></svg>',
        power: '<svg class="ses-card-icon" viewBox="0 0 20 20" fill="#8b5cf6"><path d="M10 1a.75.75 0 0 1 .75.75v1.5a.75.75 0 0 1-1.5 0v-1.5A.75.75 0 0 1 10 1zm5.3 2.2a.75.75 0 0 1 0 1.06l-1.06 1.06a.75.75 0 0 1-1.06-1.06l1.06-1.06a.75.75 0 0 1 1.06 0zM18 10a.75.75 0 0 1-.75.75h-1.5a.75.75 0 0 1 0-1.5h1.5A.75.75 0 0 1 18 10zm-3.76 5.3a.75.75 0 0 1-1.06 0l-1.06-1.06a.75.75 0 0 1 1.06-1.06l1.06 1.06a.75.75 0 0 1 0 1.06zM10 18a.75.75 0 0 1-.75-.75v-1.5a.75.75 0 0 1 1.5 0v1.5A.75.75 0 0 1 10 18zM4.7 15.3a.75.75 0 0 1 0-1.06l1.06-1.06a.75.75 0 0 1 1.06 1.06L5.76 15.3a.75.75 0 0 1-1.06 0zM2 10a.75.75 0 0 1 .75-.75h1.5a.75.75 0 0 1 0 1.5h-1.5A.75.75 0 0 1 2 10zm2.7-5.3a.75.75 0 0 1 1.06 0l1.06 1.06A.75.75 0 0 1 5.76 6.82L4.7 5.76a.75.75 0 0 1 0-1.06zM10 7a3 3 0 1 0 0 6 3 3 0 0 0 0-6zm-4 3a4 4 0 1 1 8 0 4 4 0 0 1-8 0z"/></svg>'
    };

    // ── Render ────────────────────────────────────────────────

    function render() {
        var html = '';
        html += renderHeader();
        html += renderCards();
        container.innerHTML = html;
    }

    function renderHeader() {
        var online = 0, offline = 0;
        devices.forEach(function (d) {
            if (d.connectionStatus === 'online' || d.connectionStatus === 'stale') online++;
            else offline++;
        });

        var siteName = esc(entityName || siteAttrs.installation_name || 'Site');
        var tier = (siteAttrs.dashboard_tier || '').toLowerCase();
        var tierLabel = tier === 'plus' ? 'Plus' : 'Standard';
        var tierClass = tier === 'plus' ? 'ses-tier-plus' : 'ses-tier-standard';

        var html = '<div class="ses-header">';
        html += '<div class="ses-header-left">';
        html += '<div class="ses-site-name">' + siteName + '</div>';
        html += '<div class="ses-status-line">';
        html += '<span>' + devices.length + ' device' + (devices.length !== 1 ? 's' : '') + '</span>';
        if (online > 0) {
            html += '<span class="ses-status-item"><span class="ses-dot ses-dot-online"></span>' + online + ' online</span>';
        }
        if (offline > 0) {
            html += '<span class="ses-status-item"><span class="ses-dot ses-dot-offline"></span>' + offline + ' offline</span>';
        }
        html += '</div></div>';
        html += '<span class="ses-tier-badge ' + tierClass + '">' + esc(tierLabel) + '</span>';
        html += '</div>';
        return html;
    }

    function renderCards() {
        var totalEnergyWh = 0, totalCost = 0, totalCO2g = 0, totalPowerW = 0;
        devices.forEach(function (d) {
            totalEnergyWh += d.telemetry.energy_today_wh || 0;
            totalCost += d.telemetry.cost_today || 0;
            totalCO2g += d.telemetry.co2_today_grams || 0;
            totalPowerW += parseFloat(d.telemetry.power_watts) || 0;
        });

        var currency = esc(siteAttrs.currency_symbol || '\u00A3');
        var energy = formatEnergy(totalEnergyWh);
        var co2 = formatCO2(totalCO2g);

        var html = '<div class="ses-cards">';

        // Card 1: Total Energy
        html += '<div class="ses-card ses-card-energy">';
        html += '<div class="ses-card-label">' + ICONS.energy + '<span class="ses-label-text">Total Energy</span></div>';
        html += '<div class="ses-card-value">' + energy.value + '<span class="ses-card-unit">' + energy.unit + '</span></div>';
        html += '<div class="ses-card-sub">today</div>';
        html += '</div>';

        // Card 2: Estimated Cost
        html += '<div class="ses-card ses-card-cost">';
        html += '<div class="ses-card-label">' + ICONS.cost + '<span class="ses-label-text">Estimated Cost</span></div>';
        html += '<div class="ses-card-value">' + currency + formatValue(totalCost, 2) + '</div>';
        html += '<div class="ses-card-sub">today</div>';
        html += '</div>';

        // Card 3: CO2 Emissions
        html += '<div class="ses-card ses-card-co2">';
        html += '<div class="ses-card-label">' + ICONS.co2 + '<span class="ses-label-text">CO\u2082 Emissions</span></div>';
        html += '<div class="ses-card-value">' + co2.value + '<span class="ses-card-unit">' + co2.unit + '</span></div>';
        html += '<div class="ses-card-sub">today</div>';
        html += '</div>';

        // Card 4: Total Power
        html += '<div class="ses-card ses-card-power">';
        html += '<div class="ses-card-label">' + ICONS.power + '<span class="ses-label-text">Total Power</span></div>';
        html += '<div class="ses-card-value">' + formatValue(totalPowerW, 0) + '<span class="ses-card-unit">W</span></div>';
        html += '<div class="ses-card-sub">now</div>';
        html += '</div>';

        html += '</div>';
        return html;
    }

    // ── Loading / Error States ───────────────────────────────

    function showLoading() {
        container.innerHTML = '<div class="ses-loading"><span class="ses-spinner"></span>Loading site data\u2026</div>';
    }

    function showError(msg) {
        container.innerHTML = '<div class="ses-error">' + esc(msg) + '</div>';
    }

    // ── Poll + Refresh Cycle ─────────────────────────────────

    function pollAndRender() {
        Promise.all([
            pollAllDevices(),
            fetchTodayAggregates()
        ]).then(function () {
            render();
        }).catch(function () {
            render();
        });
    }

    // ── Init ─────────────────────────────────────────────────

    siteId = resolveSiteId();
    if (!siteId) {
        showError('No site selected');
        return;
    }

    showLoading();

    Promise.all([
        fetchDevices(),
        fetchSiteAttributes()
    ]).then(function () {
        return Promise.all([
            pollAllDevices(),
            fetchTodayAggregates()
        ]);
    }).then(function () {
        render();
        pollTimer = setInterval(pollAndRender, POLL_INTERVAL);
    }).catch(function (err) {
        showError('Failed to load site data');
        console.error('[SES] Init error:', err);
    });
};

self.onDestroy = function () {
    if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
    }
};
