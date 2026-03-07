// ===================================================================
// SignConnect - Site Manager Widget (controller.js)
// ===================================================================
// SITE state widget for the Management Dashboard. Shows:
//   Tab 1: Details (site metadata, address with Nominatim, edit mode)
//   Tab 2: Devices (live telemetry cards, banner stats)
//   Tab 3: Add Device (quick provisioning form)
//
// Receives site ASSET ID from dashboard state params.
// Queries relations to find child devices, polls telemetry.
// ===================================================================

var pollTimer = null;
var _addrDebounceTimer = null;
var _addrOutsideClickFn = null;

self.onInit = function () {
    'use strict';

    var POLL_INTERVAL = 15000;
    var FRESHNESS_ONLINE = 600000;   // 10 min
    var FRESHNESS_STALE  = 3600000;  // 60 min

    var $root = self.ctx.$container[0];
    var container = $root.querySelector('.sm-root');
    if (!container) {
        $root.innerHTML = '<div class="sm-root"></div>';
        container = $root.querySelector('.sm-root');
    }
    var http = self.ctx.http;

    // ── State Variables ────────────────────────────────────────

    var siteId = null;
    var siteEntity = null;
    var siteAttrs = {};
    var devices = [];
    var parentBreadcrumb = '';
    var activeTab = 'details';
    var isEditing = false;
    var isSaving = false;

    // Address autocomplete state
    var addressSearchExpanded = false;
    var addressSearchResults = [];
    var addressSelected = null;
    var addressFetching = false;
    var addressDebounceTimer = null;

    // Add Device tab state
    var deviceProfiles = {};
    var addDeviceForm = { name: '', profileId: '', profileName: '', token: '' };
    var addDeviceStatus = '';
    var addDeviceError = '';

    // ── CO2 Factors ────────────────────────────────────────────

    var CO2_FACTORS = {
        NL: { co2: 0.269, rate: 0.29, currency: 'EUR', symbol: '\u20ac', name: 'Netherlands' },
        GB: { co2: 0.207, rate: 0.30, currency: 'GBP', symbol: '\u00a3', name: 'United Kingdom' },
        DE: { co2: 0.371, rate: 0.38, currency: 'EUR', symbol: '\u20ac', name: 'Germany' },
        FR: { co2: 0.056, rate: 0.27, currency: 'EUR', symbol: '\u20ac', name: 'France' },
        BE: { co2: 0.144, rate: 0.36, currency: 'EUR', symbol: '\u20ac', name: 'Belgium' },
        TR: { co2: 0.440, rate: 4.20, currency: 'TRY', symbol: '\u20ba', name: 'Turkey' },
        AT: { co2: 0.105, rate: 0.29, currency: 'EUR', symbol: '\u20ac', name: 'Austria' },
        CH: { co2: 0.025, rate: 0.27, currency: 'CHF', symbol: 'Fr', name: 'Switzerland' },
        CZ: { co2: 0.450, rate: 0.31, currency: 'CZK', symbol: 'K\u010d', name: 'Czechia' },
        DK: { co2: 0.140, rate: 0.35, currency: 'DKK', symbol: 'kr', name: 'Denmark' },
        ES: { co2: 0.150, rate: 0.26, currency: 'EUR', symbol: '\u20ac', name: 'Spain' },
        FI: { co2: 0.070, rate: 0.19, currency: 'EUR', symbol: '\u20ac', name: 'Finland' },
        GR: { co2: 0.270, rate: 0.20, currency: 'EUR', symbol: '\u20ac', name: 'Greece' },
        IE: { co2: 0.296, rate: 0.37, currency: 'EUR', symbol: '\u20ac', name: 'Ireland' },
        IT: { co2: 0.315, rate: 0.33, currency: 'EUR', symbol: '\u20ac', name: 'Italy' },
        LU: { co2: 0.080, rate: 0.26, currency: 'EUR', symbol: '\u20ac', name: 'Luxembourg' },
        NO: { co2: 0.030, rate: 0.22, currency: 'NOK', symbol: 'kr', name: 'Norway' },
        PL: { co2: 0.662, rate: 0.30, currency: 'PLN', symbol: 'z\u0142', name: 'Poland' },
        PT: { co2: 0.120, rate: 0.22, currency: 'EUR', symbol: '\u20ac', name: 'Portugal' },
        SE: { co2: 0.041, rate: 0.25, currency: 'SEK', symbol: 'kr', name: 'Sweden' },
        AE: { co2: 0.410, rate: 0.08, currency: 'AED', symbol: 'AED', name: 'United Arab Emirates' },
        AU: { co2: 0.530, rate: 0.30, currency: 'AUD', symbol: 'A$', name: 'Australia' },
        BR: { co2: 0.080, rate: 0.70, currency: 'BRL', symbol: 'R$', name: 'Brazil' },
        CA: { co2: 0.120, rate: 0.14, currency: 'CAD', symbol: 'C$', name: 'Canada' },
        CN: { co2: 0.540, rate: 0.54, currency: 'CNY', symbol: '\u00a5', name: 'China' },
        IN: { co2: 0.713, rate: 6.50, currency: 'INR', symbol: '\u20b9', name: 'India' },
        JP: { co2: 0.460, rate: 0.27, currency: 'JPY', symbol: '\u00a5', name: 'Japan' },
        KR: { co2: 0.410, rate: 0.11, currency: 'KRW', symbol: '\u20a9', name: 'South Korea' },
        MX: { co2: 0.410, rate: 3.20, currency: 'MXN', symbol: 'MX$', name: 'Mexico' },
        SA: { co2: 0.560, rate: 0.05, currency: 'SAR', symbol: 'SAR', name: 'Saudi Arabia' },
        SG: { co2: 0.370, rate: 0.27, currency: 'SGD', symbol: 'S$', name: 'Singapore' },
        US: { co2: 0.390, rate: 0.17, currency: 'USD', symbol: '$', name: 'United States' },
        ZA: { co2: 0.710, rate: 2.50, currency: 'ZAR', symbol: 'R', name: 'South Africa' }
    };

    // ── Telemetry Keys ─────────────────────────────────────────

    var TELEMETRY_KEYS = [
        'dim_value', 'power_watts', 'energy_wh', 'co2_grams',
        'status_light_src_on', 'status_driver_ok', 'status_ready',
        'fault_overall_failure', 'fault_under_voltage', 'fault_over_voltage',
        'fault_power_limit', 'fault_thermal_derating', 'fault_thermal_shutdown',
        'fault_light_src_failure', 'fault_light_src_short_circuit',
        'fault_light_src_thermal_derate', 'fault_light_src_thermal_shutdn',
        'fault_input_power', 'fault_current_limited', 'fault_driver_failure',
        'fault_external', 'fault_d4i_power_exceeded', 'fault_overcurrent',
        'status_control_gear_failure', 'status_lamp_failure',
        'status_limit_error', 'status_reset_state', 'status_missing_short_addr'
    ].join(',');

    var FAULT_COUNT_KEYS = [
        'fault_overall_failure', 'fault_under_voltage', 'fault_over_voltage',
        'fault_power_limit', 'fault_thermal_derating', 'fault_thermal_shutdown',
        'fault_light_src_failure', 'fault_light_src_short_circuit',
        'fault_light_src_thermal_derate', 'fault_light_src_thermal_shutdn',
        'fault_input_power', 'fault_current_limited', 'fault_driver_failure',
        'fault_external', 'fault_d4i_power_exceeded', 'fault_overcurrent',
        'status_control_gear_failure', 'status_lamp_failure'
    ];

    function isFault(val) {
        if (val === undefined || val === null) return false;
        return val === 'true' || val === true || val === '1' || val === 1;
    }

    // ── Entity Resolution ──────────────────────────────────────

    function resolveSiteId() {
        try {
            var stateParams = self.ctx.stateController.getStateParams();
            if (stateParams && stateParams.entityId && stateParams.entityId.id) {
                return stateParams.entityId.id;
            }
        } catch (e) {}
        try {
            var ds = self.ctx.datasources;
            if (ds && ds.length > 0 && ds[0].entity) {
                var eid = ds[0].entity.id;
                return (typeof eid === 'object' && eid !== null) ? eid.id : eid;
            }
        } catch (e) {}
        return (self.ctx.settings && self.ctx.settings.siteAssetId) || null;
    }

    // ── API Helpers ────────────────────────────────────────────

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

    function apiPost(path, body) {
        var obs = http.post('/api' + path, body);
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

    function apiDelete(path) {
        var obs = http.delete('/api' + path);
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

    function fetchExternal(url, timeoutMs) {
        var ctrl = new AbortController();
        var timer = setTimeout(function () { ctrl.abort(); }, timeoutMs || 8000);
        return fetch(url, {
            headers: { 'Accept': 'application/json' },
            signal: ctrl.signal
        }).then(function (resp) {
            clearTimeout(timer);
            if (!resp.ok) throw new Error('HTTP ' + resp.status);
            return resp.json();
        }).catch(function (err) {
            clearTimeout(timer);
            throw err;
        });
    }

    function esc(str) {
        if (!str) return '';
        return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function generateToken() {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
            var r = Math.random() * 16 | 0;
            return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
        });
    }

    function timeSince(ts) {
        var diff = Date.now() - ts;
        if (diff < 60000) return 'Just now';
        if (diff < 3600000) return Math.floor(diff / 60000) + ' min ago';
        if (diff < 86400000) return Math.floor(diff / 3600000) + 'h ago';
        return Math.floor(diff / 86400000) + 'd ago';
    }

    // ── Data Fetching ──────────────────────────────────────────

    function fetchDevices() {
        return apiGet('/relations?fromId=' + siteId + '&fromType=ASSET&relationType=Contains')
            .then(function (relations) {
                var deviceRels = relations.filter(function (r) {
                    return r.to && r.to.entityType === 'DEVICE';
                });
                if (deviceRels.length === 0) { devices = []; return; }
                var promises = deviceRels.map(function (r) {
                    return apiGet('/device/' + r.to.id).then(function (dev) {
                        return {
                            id: dev.id.id,
                            name: dev.name || 'Unknown',
                            type: dev.type || '',
                            label: dev.label || '',
                            telemetry: {},
                            faultCount: 0,
                            lastActivity: 0,
                            connectionStatus: 'offline'
                        };
                    });
                });
                return Promise.all(promises).then(function (devs) { devices = devs; });
            });
    }

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
                    FAULT_COUNT_KEYS.forEach(function (fk) {
                        if (isFault(ts[fk])) faults++;
                    });
                    dev.faultCount = faults;
                });
        });
        return Promise.all(promises);
    }

    function fetchTodayEnergy() {
        if (devices.length === 0) return Promise.resolve();
        var startOfDay = new Date();
        startOfDay.setHours(0, 0, 0, 0);
        var startTs = startOfDay.getTime();
        var endTs = Date.now();
        var promises = devices.map(function (dev) {
            return apiGet('/plugins/telemetry/DEVICE/' + dev.id +
                '/values/timeseries?keys=energy_wh&startTs=' + startTs +
                '&endTs=' + endTs + '&agg=SUM&interval=' + (endTs - startTs))
                .then(function (data) {
                    if (data.energy_wh && data.energy_wh.length > 0) {
                        dev.telemetry.energy_today_wh = parseFloat(data.energy_wh[0].value) || 0;
                    } else {
                        dev.telemetry.energy_today_wh = 0;
                    }
                });
        });
        return Promise.all(promises);
    }

    function fetchBreadcrumb() {
        return apiGet('/relations?toId=' + siteId + '&toType=ASSET&relationType=Contains')
            .then(function (rels) {
                var parentRel = rels.find(function (r) { return r.from && r.from.entityType === 'ASSET'; });
                if (!parentRel) { parentBreadcrumb = ''; return; }
                return apiGet('/asset/' + parentRel.from.id).then(function (region) {
                    var regionName = region.name;
                    return apiGet('/relations?toId=' + parentRel.from.id + '&toType=ASSET&relationType=Contains')
                        .then(function (rels2) {
                            var estateRel = rels2.find(function (r) { return r.from && r.from.entityType === 'ASSET'; });
                            if (estateRel) {
                                return apiGet('/asset/' + estateRel.from.id).then(function (estate) {
                                    parentBreadcrumb = estate.name + ' > ' + regionName;
                                });
                            }
                            parentBreadcrumb = regionName;
                        });
                });
            }).catch(function () { parentBreadcrumb = ''; });
    }

    function saveSiteAttributes(attrs) {
        return apiPost('/plugins/telemetry/ASSET/' + siteId + '/attributes/SERVER_SCOPE', attrs);
    }

    // ── Polling ────────────────────────────────────────────────

    function startPolling() {
        pollTimer = setInterval(function () {
            pollAllDevices().then(function () { return fetchTodayEnergy(); }).then(function () {
                if (activeTab === 'devices') render();
            });
        }, POLL_INTERVAL);
    }

    // ═══ RENDER ════════════════════════════════════════════════

    function render() {
        var html = renderHeader() + renderTabs();
        if (activeTab === 'details') html += renderDetailsTab();
        else if (activeTab === 'devices') html += renderDevicesTab();
        else if (activeTab === 'add-device') html += renderAddDeviceTab();
        container.innerHTML = html;
        bindEvents();
    }

    // ── Header ─────────────────────────────────────────────────

    function renderHeader() {
        var siteName = (siteEntity && siteEntity.name) ? siteEntity.name : 'Site';
        var html = '<div class="sm-header">';
        html += '<button class="sm-back-btn" data-action="go-back">' +
            '<svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"/></svg>' +
            ' Back</button>';
        if (parentBreadcrumb) {
            html += '<div class="sm-breadcrumb">' + esc(parentBreadcrumb) + '</div>';
        }
        html += '<h2 class="sm-site-name">' + esc(siteName) + '</h2>';
        html += '</div>';
        return html;
    }

    // ── Tabs ───────────────────────────────────────────────────

    function renderTabs() {
        return '<div class="sm-tabs">' +
            tabBtn('details', 'Details') +
            tabBtn('devices', 'Devices (' + devices.length + ')') +
            tabBtn('add-device', 'Add Device') +
        '</div>';
    }

    function tabBtn(id, label) {
        var cls = activeTab === id ? ' active' : '';
        return '<button class="sm-tab' + cls + '" data-tab="' + id + '">' + label + '</button>';
    }

    // ═══ TAB 1: DETAILS ════════════════════════════════════════

    function renderDetailsTab() {
        var html = '';

        // Edit toolbar
        html += '<div class="sm-meta-toolbar">' +
            '<button class="sm-edit-btn" data-action="toggle-edit">' +
                (isEditing
                    ? '<svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg> Save Changes'
                    : '<svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg> Edit'
                ) +
            '</button>' +
        '</div>';

        html += '<div class="sm-meta-grid">';

        // Left column
        html += '<div class="sm-meta-col-left">';

        // Site Info card
        html += metaCard('Site Information', 'bolt', [
            metaField('installation_name', 'Installation Name', siteAttrs.installation_name || ''),
            metaField('dashboard_tier', 'Tier', siteAttrs.dashboard_tier || ''),
            metaField('site_address', 'Address', siteAttrs.site_address || siteAttrs.address || ''),
            metaField('site_city', 'City', siteAttrs.site_city || ''),
            metaField('site_country', 'Country', siteAttrs.site_country || '')
        ]);

        // GPS card
        html += metaCard('GPS Location', 'map', [
            metaField('latitude', 'Latitude', siteAttrs.latitude || ''),
            metaField('longitude', 'Longitude', siteAttrs.longitude || '')
        ]);

        html += '</div>';

        // Right column
        html += '<div class="sm-meta-col-right">';

        // Energy & Cost card
        html += metaCard('Energy & Cost', 'bolt', [
            metaField('co2_per_kwh', 'CO2 Factor (kg/kWh)', siteAttrs.co2_per_kwh || ''),
            metaField('energy_rate', 'Energy Rate (per kWh)', siteAttrs.energy_rate || ''),
            metaSelect('currency_symbol', 'Currency', siteAttrs.currency_symbol || '', [
                { value: '\u00a3', label: '\u00a3 (GBP)' },
                { value: '\u20ac', label: '\u20ac (EUR)' },
                { value: '$', label: '$ (USD)' },
                { value: '\u20ba', label: '\u20ba (TRY)' }
            ])
        ]);

        // Contact card
        html += metaCard('Site Contact', 'user', [
            metaField('contact_name', 'Contact Name', siteAttrs.contact_name || ''),
            metaField('contact_email', 'Contact Email', siteAttrs.contact_email || ''),
            metaField('contact_phone', 'Contact Phone', siteAttrs.contact_phone || '')
        ]);

        html += '</div>';
        html += '</div>';

        // Address autocomplete section (full-width)
        html += renderAddressSection();

        return html;
    }

    var META_ICONS = {
        bolt: '<svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>',
        map: '<svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"/></svg>',
        user: '<svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"/></svg>'
    };

    function metaCard(title, icon, fields) {
        return '<div class="sm-meta-card">' +
            '<div class="sm-meta-card-title">' +
                '<div class="sm-meta-icon sm-meta-icon-amber">' + META_ICONS[icon] + '</div>' +
                title +
            '</div>' +
            fields.join('') +
        '</div>';
    }

    function metaField(key, label, value) {
        if (isEditing) {
            return '<div class="sm-meta-row">' +
                '<span class="sm-meta-label">' + label + '</span>' +
                '<input class="sm-meta-input" data-attr="' + key + '" value="' + esc(value) + '" />' +
            '</div>';
        }
        return '<div class="sm-meta-row">' +
            '<span class="sm-meta-label">' + label + '</span>' +
            '<span class="sm-meta-value">' + (value ? esc(value) : '<em class="sm-meta-empty">Not set</em>') + '</span>' +
        '</div>';
    }

    function metaSelect(key, label, value, options) {
        if (isEditing) {
            var html = '<div class="sm-meta-row">' +
                '<span class="sm-meta-label">' + label + '</span>' +
                '<select class="sm-meta-input" data-attr="' + key + '">';
            html += '<option value="">-- Select --</option>';
            options.forEach(function (opt) {
                html += '<option value="' + esc(opt.value) + '"' +
                    (value === opt.value ? ' selected' : '') + '>' + esc(opt.label) + '</option>';
            });
            html += '</select></div>';
            return html;
        }
        var displayLabel = value || '';
        options.forEach(function (opt) {
            if (opt.value === value) displayLabel = opt.label;
        });
        return '<div class="sm-meta-row">' +
            '<span class="sm-meta-label">' + label + '</span>' +
            '<span class="sm-meta-value">' + (displayLabel ? esc(displayLabel) : '<em class="sm-meta-empty">Not set</em>') + '</span>' +
        '</div>';
    }

    // ── Address Autocomplete Section ───────────────────────────

    function renderAddressSection() {
        var hasLocation = siteAttrs.latitude && siteAttrs.longitude &&
            !isNaN(parseFloat(siteAttrs.latitude)) && !isNaN(parseFloat(siteAttrs.longitude));
        var showSearch = addressSearchExpanded || !hasLocation;

        var html = '<div class="sm-meta-card" style="margin-top:16px">' +
            '<div class="sm-meta-card-title">' +
                '<div class="sm-meta-icon sm-meta-icon-green">' + META_ICONS.map + '</div>' +
                'Address Lookup' +
            '</div>';

        if (hasLocation && !addressSearchExpanded) {
            var addr = siteAttrs.address || siteAttrs.site_address || '';
            var city = siteAttrs.site_city || '';
            var country = siteAttrs.site_country || '';
            var displayAddr = addr || [city, country].filter(Boolean).join(', ') || 'Coordinates set';
            html += '<div class="sm-addr-current">' +
                '<div class="sm-addr-current-text">' + esc(displayAddr) + '</div>' +
                '<div class="sm-addr-current-coords">' +
                    parseFloat(siteAttrs.latitude).toFixed(4) + ', ' +
                    parseFloat(siteAttrs.longitude).toFixed(4) +
                '</div>' +
                '<button class="sm-addr-change-btn" data-action="addr-toggle-search">Change Location</button>' +
            '</div>';
        }

        if (showSearch) {
            if (hasLocation && addressSearchExpanded) {
                html += '<div style="margin-bottom:8px">' +
                    '<button class="sm-addr-change-btn" data-action="addr-toggle-search" style="position:static">Cancel</button>' +
                '</div>';
            }
            html += '<div class="sm-addr-search-wrap">' +
                '<div class="sm-addr-input-wrap">' +
                    '<input type="text" class="sm-addr-input" data-action="addr-search-input"' +
                        ' placeholder="Search address or city\u2026" autocomplete="off" />' +
                    (addressFetching ? '<div class="sm-addr-spinner"></div>' : '') +
                '</div>';

            // Dropdown results
            if (addressSearchResults.length > 0 && !addressSelected) {
                html += '<div class="sm-addr-dropdown">';
                addressSearchResults.forEach(function (r, i) {
                    html += '<div class="sm-addr-option' + (i === 0 ? ' sm-addr-option-active' : '') +
                        '" data-action="addr-select" data-addr-idx="' + i + '">' +
                        esc(r.display_name) + '</div>';
                });
                html += '</div>';
            }

            // Preview selected result
            if (addressSelected) {
                var sel = addressSelected;
                html += '<div class="sm-addr-preview">' +
                    '<div class="sm-addr-preview-name">' + esc(sel.display_name) + '</div>' +
                    '<div class="sm-addr-preview-coords">' +
                        parseFloat(sel.lat).toFixed(4) + ', ' + parseFloat(sel.lon).toFixed(4) +
                    '</div>' +
                '</div>';
                html += '<div class="sm-addr-actions">' +
                    '<button class="sm-btn sm-btn-secondary sm-btn-sm" data-action="addr-clear">Clear</button>' +
                    '<button class="sm-btn sm-btn-primary sm-btn-sm" data-action="addr-confirm">Confirm & Save</button>' +
                '</div>';
            }

            html += '</div>';
        }

        html += '</div>';
        return html;
    }

    function fetchAddressSuggestions(query) {
        addressFetching = true;
        addressSearchResults = [];
        addressSelected = null;
        render();

        var url = 'https://nominatim.openstreetmap.org/search?q=' + encodeURIComponent(query) +
            '&format=json&limit=6&addressdetails=1';

        fetch(url, { headers: { 'Accept': 'application/json' } })
        .then(function (resp) { return resp.json(); })
        .then(function (results) {
            addressFetching = false;
            addressSearchResults = results || [];
            render();
            if (addressSearchResults.length === 0) {
                var wrap = container.querySelector('.sm-addr-search-wrap');
                if (wrap && !wrap.querySelector('.sm-addr-no-results')) {
                    var msg = document.createElement('div');
                    msg.className = 'sm-addr-no-results';
                    msg.textContent = 'No results found. Try a different search.';
                    wrap.appendChild(msg);
                }
            }
        })
        .catch(function () {
            addressFetching = false;
            addressSearchResults = [];
            render();
        });
    }

    function confirmAddress() {
        if (!addressSelected) return;
        var sel = addressSelected;
        var addrParts = sel.address || {};
        var cc = (addrParts.country_code || '').toUpperCase();
        var cInfo = CO2_FACTORS[cc] || {};

        var attrs = {
            latitude: String(sel.lat),
            longitude: String(sel.lon),
            address: sel.display_name || '',
            site_address: [addrParts.road, addrParts.house_number].filter(Boolean).join(' ') || '',
            site_city: addrParts.city || addrParts.town || addrParts.village || addrParts.municipality || '',
            site_postcode: addrParts.postcode || '',
            site_country: addrParts.country || ''
        };
        if (cc) attrs.country_code = cc;
        if (cInfo.co2) attrs.co2_per_kwh = String(cInfo.co2);
        if (cInfo.rate) attrs.energy_rate = String(cInfo.rate);
        if (cInfo.symbol) attrs.currency_symbol = cInfo.symbol;

        saveSiteAttributes(attrs).then(function () {
            Object.keys(attrs).forEach(function (k) { siteAttrs[k] = attrs[k]; });
            resetAddressState();
            render();
        }).catch(function () {
            render();
        });
    }

    function resetAddressState() {
        addressSearchExpanded = false;
        addressSearchResults = [];
        addressSelected = null;
        addressFetching = false;
        if (addressDebounceTimer) {
            clearTimeout(addressDebounceTimer);
            addressDebounceTimer = null;
        }
    }

    // ═══ TAB 2: DEVICES ════════════════════════════════════════

    function renderDevicesTab() {
        var html = '';

        // Banner stats
        var online = 0, faulted = 0, totalPower = 0, totalEnergy = 0;
        devices.forEach(function (d) {
            if (d.connectionStatus === 'online') online++;
            if (d.faultCount > 0) faulted++;
            totalPower += parseFloat(d.telemetry.power_watts) || 0;
            totalEnergy += (d.telemetry.energy_today_wh || 0) / 1000;
        });

        html += '<div class="sm-banner">' +
            statBox('Total Devices', devices.length, '') +
            statBox('Online', online, 'green') +
            (faulted > 0 ? statBox('Faults', faulted, 'red') : '') +
            statBox('Power', Math.round(totalPower) + '<span class="sm-stat-unit">W</span>', '') +
            statBox('Energy Today', totalEnergy.toFixed(1) + '<span class="sm-stat-unit">kWh</span>', '') +
        '</div>';

        if (devices.length === 0) {
            html += '<div class="sm-empty">' +
                '<div class="sm-empty-icon">&#128225;</div>' +
                '<div class="sm-empty-text">No devices found under this site.</div>' +
                '<div class="sm-empty-hint">Use the "Add Device" tab to provision a new device.</div>' +
            '</div>';
            return html;
        }

        var cols = devices.length <= 4 ? 'sm-device-grid' : 'sm-device-grid sm-grid-3';
        html += '<div class="' + cols + '">';
        devices.forEach(function (dev) {
            html += renderDeviceCard(dev);
        });
        html += '</div>';
        return html;
    }

    function statBox(label, value, color) {
        var cls = color === 'green' ? ' sm-stat-green' : color === 'red' ? ' sm-stat-red' : '';
        return '<div class="sm-stat-box">' +
            '<div class="sm-stat-label">' + label + '</div>' +
            '<div class="sm-stat-value' + cls + '">' + value + '</div>' +
        '</div>';
    }

    function renderDeviceCard(dev) {
        var dim = parseInt(dev.telemetry.dim_value) || 0;
        var power = parseFloat(dev.telemetry.power_watts) || 0;
        var energyKwh = ((dev.telemetry.energy_today_wh || 0) / 1000).toFixed(2);
        var lampOn = dev.telemetry.status_light_src_on === 'true' || dev.telemetry.status_light_src_on === '1';
        var hasFault = dev.faultCount > 0;
        var status = hasFault ? 'fault' : dev.connectionStatus;

        var statusLabel = status === 'online' ? 'Online' : status === 'fault' ? 'Fault' : status === 'stale' ? 'Stale' : 'Offline';
        var lastSeenText = dev.lastActivity > 0 ? timeSince(dev.lastActivity) : 'No data';

        return '<div class="sm-device-card sm-device-card-' + status + '" data-action="open-device" data-device-id="' + dev.id + '" data-device-name="' + esc(dev.name) + '">' +
            '<div class="sm-card-header">' +
                '<div>' +
                    '<div class="sm-card-name">' + esc(dev.name) + '</div>' +
                    '<div class="sm-card-type">' + esc(dev.type) + '</div>' +
                '</div>' +
                '<div class="sm-status-badge sm-status-' + status + '">' +
                    '<span class="sm-dot sm-dot-' + status + '"></span>' +
                    statusLabel +
                '</div>' +
            '</div>' +
            '<div class="sm-dim-bar-wrap">' +
                '<div class="sm-dim-bar-track">' +
                    '<div class="sm-dim-bar-fill' + (lampOn ? ' sm-dim-on' : '') + '" style="width:' + dim + '%"></div>' +
                '</div>' +
                '<span class="sm-dim-value' + (lampOn ? ' sm-dim-on-text' : '') + '">' + dim + '%</span>' +
            '</div>' +
            '<div class="sm-card-metrics">' +
                '<div class="sm-card-metric">' +
                    '<div class="sm-metric-label">Power</div>' +
                    '<div class="sm-metric-value">' + Math.round(power) + '<span class="sm-metric-unit">W</span></div>' +
                '</div>' +
                '<div class="sm-card-metric">' +
                    '<div class="sm-metric-label">Today</div>' +
                    '<div class="sm-metric-value">' + energyKwh + '<span class="sm-metric-unit">kWh</span></div>' +
                '</div>' +
            '</div>' +
            '<div class="sm-card-footer">' +
                '<span class="sm-last-seen">' + lastSeenText + '</span>' +
                (hasFault
                    ? '<span class="sm-fault-pill">' +
                        '<svg width="12" height="12" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z"/></svg> ' +
                        dev.faultCount + ' fault' + (dev.faultCount > 1 ? 's' : '') +
                      '</span>'
                    : '<span class="sm-view-link">View <svg width="12" height="12" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/></svg></span>'
                ) +
            '</div>' +
        '</div>';
    }

    // ═══ TAB 3: ADD DEVICE ═════════════════════════════════════

    function renderAddDeviceTab() {
        var html = '';

        // Status messages
        if (addDeviceStatus === 'done') {
            html += '<div class="sm-success-msg">Device created successfully and linked to this site.</div>';
        }
        if (addDeviceStatus === 'error') {
            html += '<div class="sm-error-msg">' + esc(addDeviceError || 'Failed to create device.') + '</div>';
        }

        html += '<div class="sm-meta-card">';
        html += '<div class="sm-meta-card-title">' +
            '<div class="sm-meta-icon sm-meta-icon-amber">' +
                '<svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/></svg>' +
            '</div>' +
            'Provision New Device' +
        '</div>';

        // Device name
        html += '<div class="sm-form-group">' +
            '<label>Device Name</label>' +
            '<input class="sm-input" data-add-field="name" value="' + esc(addDeviceForm.name) + '" placeholder="e.g. LUM-001" />' +
        '</div>';

        // Device profile dropdown
        html += '<div class="sm-form-group">' +
            '<label>Device Profile</label>' +
            '<select class="sm-select" data-add-field="profile">';
        html += '<option value="">-- Select Profile --</option>';
        Object.keys(deviceProfiles).forEach(function (name) {
            var selected = addDeviceForm.profileName === name ? ' selected' : '';
            html += '<option value="' + esc(name) + '"' + selected + '>' + esc(name) + '</option>';
        });
        html += '</select></div>';

        // Access token
        if (!addDeviceForm.token) addDeviceForm.token = generateToken();
        html += '<div class="sm-form-group">' +
            '<label>Access Token</label>' +
            '<div class="sm-token-wrap">' +
                '<div class="sm-token-value">' + esc(addDeviceForm.token) + '</div>' +
                '<button class="sm-token-btn" data-action="regenerate-token">Regenerate</button>' +
            '</div>' +
        '</div>';

        // Create button
        var canCreate = addDeviceForm.name.trim() && addDeviceForm.profileName;
        var btnDisabled = !canCreate || addDeviceStatus === 'saving' ? ' disabled' : '';
        var btnLabel = addDeviceStatus === 'saving' ? 'Creating...' : 'Create Device';
        html += '<div style="margin-top:20px; display:flex; justify-content:flex-end;">' +
            '<button class="sm-btn sm-btn-primary" data-action="create-device"' + btnDisabled + '>' + btnLabel + '</button>' +
        '</div>';

        html += '</div>';
        return html;
    }

    function fetchDeviceProfiles() {
        return apiGet('/deviceProfiles?pageSize=100&page=0')
            .then(function (resp) {
                var data = (resp && resp.data) ? resp.data : (Array.isArray(resp) ? resp : []);
                deviceProfiles = {};
                data.forEach(function (p) {
                    if (p && p.name) {
                        deviceProfiles[p.name] = p.id.id;
                    }
                });
            }).catch(function () { deviceProfiles = {}; });
    }

    function createDevice() {
        if (addDeviceStatus === 'saving') return;
        var name = addDeviceForm.name.trim();
        var profileName = addDeviceForm.profileName;
        var profileId = deviceProfiles[profileName];
        var token = addDeviceForm.token;

        if (!name || !profileId) {
            addDeviceStatus = 'error';
            addDeviceError = 'Please fill in device name and select a profile.';
            render();
            return;
        }

        addDeviceStatus = 'saving';
        addDeviceError = '';
        render();

        // Determine customerId from site entity
        var customerId = null;
        if (siteEntity && siteEntity.customerId && siteEntity.customerId.id &&
            siteEntity.customerId.id !== '13814000-1dd2-11b2-8080-808080808080') {
            customerId = siteEntity.customerId.id;
        }

        var body = {
            name: name,
            type: 'default',
            label: name,
            deviceProfileId: { id: profileId, entityType: 'DEVICE_PROFILE' }
        };
        if (customerId) {
            body.customerId = { id: customerId, entityType: 'CUSTOMER' };
        }

        var qp = '?accessToken=' + encodeURIComponent(token);
        var newDeviceId = null;

        apiPost('/device' + qp, body)
        .then(function (dev) {
            newDeviceId = dev.id.id;
            // Create relation: site Contains device
            var relation = {
                from: { id: siteId, entityType: 'ASSET' },
                to: { id: newDeviceId, entityType: 'DEVICE' },
                type: 'Contains',
                typeGroup: 'COMMON'
            };
            return apiPost('/relation', relation);
        })
        .then(function () {
            // Copy site CO2/rate attrs to device
            var devAttrs = {};
            if (siteAttrs.co2_per_kwh) devAttrs.co2_per_kwh = parseFloat(siteAttrs.co2_per_kwh) || 0;
            if (siteAttrs.energy_rate) devAttrs.energy_rate = parseFloat(siteAttrs.energy_rate) || 0;
            if (siteAttrs.currency_symbol) devAttrs.currency_symbol = siteAttrs.currency_symbol;
            if (Object.keys(devAttrs).length > 0) {
                return apiPost('/plugins/telemetry/DEVICE/' + newDeviceId + '/attributes/SERVER_SCOPE', devAttrs);
            }
        })
        .then(function () {
            addDeviceStatus = 'done';
            addDeviceForm = { name: '', profileId: '', profileName: '', token: generateToken() };
            // Refresh devices list
            return fetchDevices().then(function () {
                return pollAllDevices().then(function () { return fetchTodayEnergy(); });
            });
        })
        .then(function () {
            render();
        })
        .catch(function (err) {
            addDeviceStatus = 'error';
            var errMsg = 'Failed to create device.';
            if (err && err.error && err.error.message) errMsg = err.error.message;
            else if (err && err.message) errMsg = err.message;
            addDeviceError = errMsg;
            render();
        });
    }

    // ═══ EVENT BINDING ═════════════════════════════════════════

    function bindEvents() {
        // Tab clicks
        container.querySelectorAll('[data-tab]').forEach(function (btn) {
            btn.addEventListener('click', function () {
                var newTab = btn.getAttribute('data-tab');
                if (newTab !== activeTab) {
                    activeTab = newTab;
                    // Clear add-device status when switching tabs
                    if (newTab !== 'add-device') {
                        addDeviceStatus = '';
                        addDeviceError = '';
                    }
                    render();
                }
            });
        });

        // Back button
        container.querySelectorAll('[data-action="go-back"]').forEach(function (btn) {
            btn.addEventListener('click', function () {
                try {
                    var sc = self.ctx.stateController;
                    if (sc && sc.resetState) {
                        sc.resetState();
                        return;
                    }
                } catch (e) {}
                try {
                    window.history.back();
                } catch (e) {}
            });
        });

        // Device card clicks
        container.querySelectorAll('[data-action="open-device"]').forEach(function (card) {
            card.addEventListener('click', function () {
                var devId = card.getAttribute('data-device-id');
                var devName = card.getAttribute('data-device-name');
                try {
                    var sc = self.ctx.stateController;
                    sc.resetState();
                    sc.openState('device', {
                        entityId: { id: devId, entityType: 'DEVICE' },
                        entityName: devName
                    });
                } catch (e) {
                    console.error('[SM] Failed to navigate to device:', e);
                }
            });
        });

        // Edit toggle
        container.querySelectorAll('[data-action="toggle-edit"]').forEach(function (btn) {
            btn.addEventListener('click', function () {
                if (isEditing) {
                    // Save changes
                    var inputs = container.querySelectorAll('[data-attr]');
                    var attrs = {};
                    inputs.forEach(function (inp) {
                        var key = inp.getAttribute('data-attr');
                        attrs[key] = inp.value;
                    });
                    isSaving = true;
                    render();

                    // Save name change to asset entity if changed
                    var nameAttr = attrs.installation_name || '';
                    var saveEntityPromise = Promise.resolve();
                    if (siteEntity && nameAttr && nameAttr !== siteEntity.name) {
                        siteEntity.name = nameAttr;
                        saveEntityPromise = apiPost('/asset', siteEntity).then(function (updated) {
                            siteEntity = updated;
                        }).catch(function () {});
                    }

                    Promise.all([
                        saveSiteAttributes(attrs),
                        saveEntityPromise
                    ]).then(function () {
                        Object.keys(attrs).forEach(function (k) { siteAttrs[k] = attrs[k]; });
                        isEditing = false;
                        isSaving = false;
                        render();
                    }).catch(function () {
                        isSaving = false;
                        render();
                    });
                } else {
                    isEditing = true;
                    render();
                }
            });
        });

        // Address autocomplete events
        bindAddressEvents();

        // Add Device form events
        bindAddDeviceEvents();
    }

    function bindAddressEvents() {
        // Search input: debounced keyup
        var searchInput = container.querySelector('[data-action="addr-search-input"]');
        if (searchInput) {
            searchInput.addEventListener('keyup', function (e) {
                var val = searchInput.value.trim();
                if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === 'Escape') {
                    handleDropdownKeyboard(e);
                    return;
                }
                if (addressDebounceTimer) clearTimeout(addressDebounceTimer);
                _addrDebounceTimer = null;
                if (val.length < 4) {
                    addressSearchResults = [];
                    addressSelected = null;
                    var dd = container.querySelector('.sm-addr-dropdown');
                    if (dd) dd.remove();
                    return;
                }
                addressDebounceTimer = setTimeout(function () {
                    fetchAddressSuggestions(val);
                }, 350);
                _addrDebounceTimer = addressDebounceTimer;
            });
            setTimeout(function () { searchInput.focus({ preventScroll: true }); }, 50);
        }

        // Dropdown item clicks
        container.querySelectorAll('[data-action="addr-select"]').forEach(function (opt) {
            opt.addEventListener('click', function () {
                var idx = parseInt(opt.getAttribute('data-addr-idx'));
                if (addressSearchResults[idx]) {
                    addressSelected = addressSearchResults[idx];
                    addressSearchResults = [];
                    render();
                }
            });
        });

        // Toggle search button
        container.querySelectorAll('[data-action="addr-toggle-search"]').forEach(function (btn) {
            btn.addEventListener('click', function () {
                if (addressSearchExpanded) {
                    resetAddressState();
                } else {
                    addressSearchExpanded = true;
                }
                render();
            });
        });

        // Clear
        container.querySelectorAll('[data-action="addr-clear"]').forEach(function (btn) {
            btn.addEventListener('click', function () {
                addressSelected = null;
                addressSearchResults = [];
                render();
            });
        });

        // Confirm
        container.querySelectorAll('[data-action="addr-confirm"]').forEach(function (btn) {
            btn.addEventListener('click', function () {
                confirmAddress();
            });
        });

        // Outside click closes dropdown
        if (_addrOutsideClickFn) {
            document.removeEventListener('click', _addrOutsideClickFn);
        }
        _addrOutsideClickFn = function (e) {
            if (!container.querySelector('.sm-addr-dropdown')) return;
            var wrap = container.querySelector('.sm-addr-search-wrap');
            if (wrap && !wrap.contains(e.target)) {
                addressSearchResults = [];
                var dd = container.querySelector('.sm-addr-dropdown');
                if (dd) dd.remove();
            }
        };
        document.addEventListener('click', _addrOutsideClickFn);
    }

    function handleDropdownKeyboard(e) {
        var dd = container.querySelector('.sm-addr-dropdown');
        if (!dd) {
            if (e.key === 'Escape') {
                var searchInput = container.querySelector('[data-action="addr-search-input"]');
                if (searchInput) searchInput.blur();
            }
            return;
        }
        var items = dd.querySelectorAll('.sm-addr-option');
        if (items.length === 0) return;
        var activeIdx = -1;
        items.forEach(function (it, i) {
            if (it.classList.contains('sm-addr-option-active')) activeIdx = i;
        });

        if (e.key === 'ArrowDown') {
            e.preventDefault();
            var next = activeIdx < items.length - 1 ? activeIdx + 1 : 0;
            items.forEach(function (it) { it.classList.remove('sm-addr-option-active'); });
            items[next].classList.add('sm-addr-option-active');
            items[next].scrollIntoView({ block: 'nearest' });
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            var prev = activeIdx > 0 ? activeIdx - 1 : items.length - 1;
            items.forEach(function (it) { it.classList.remove('sm-addr-option-active'); });
            items[prev].classList.add('sm-addr-option-active');
            items[prev].scrollIntoView({ block: 'nearest' });
        } else if (e.key === 'Enter') {
            e.preventDefault();
            if (activeIdx >= 0 && addressSearchResults[activeIdx]) {
                addressSelected = addressSearchResults[activeIdx];
                addressSearchResults = [];
                render();
            }
        } else if (e.key === 'Escape') {
            addressSearchResults = [];
            dd.remove();
        }
    }

    function bindAddDeviceEvents() {
        // Device name input
        var nameInput = container.querySelector('[data-add-field="name"]');
        if (nameInput) {
            nameInput.addEventListener('input', function () {
                addDeviceForm.name = nameInput.value;
            });
        }

        // Profile select
        var profileSelect = container.querySelector('[data-add-field="profile"]');
        if (profileSelect) {
            profileSelect.addEventListener('change', function () {
                addDeviceForm.profileName = profileSelect.value;
                addDeviceForm.profileId = deviceProfiles[profileSelect.value] || '';
            });
        }

        // Regenerate token
        container.querySelectorAll('[data-action="regenerate-token"]').forEach(function (btn) {
            btn.addEventListener('click', function () {
                addDeviceForm.token = generateToken();
                render();
            });
        });

        // Create device button
        container.querySelectorAll('[data-action="create-device"]').forEach(function (btn) {
            btn.addEventListener('click', function () {
                createDevice();
            });
        });
    }

    // ── Loading & Error States ─────────────────────────────────

    function showLoading() {
        container.innerHTML = '<div class="sm-loading"><div class="sm-spinner"></div><div class="sm-loading-text">Loading site data...</div></div>';
    }

    function showError(msg) {
        container.innerHTML = '<div class="sm-error">' +
            '<div class="sm-error-icon">&#9888;&#65039;</div>' +
            '<div class="sm-error-text">' + esc(msg) + '</div>' +
        '</div>';
    }

    // ═══ INIT ══════════════════════════════════════════════════

    siteId = resolveSiteId();
    console.log('[SM] siteId:', siteId);

    if (!siteId) {
        showError('No site selected. Navigate from the customer view or set siteAssetId in widget settings.');
        return;
    }

    showLoading();

    Promise.all([
        apiGet('/asset/' + siteId),
        apiGet('/plugins/telemetry/ASSET/' + siteId + '/values/attributes/SERVER_SCOPE'),
        fetchDevices(),
        fetchBreadcrumb(),
        fetchDeviceProfiles()
    ]).then(function (results) {
        siteEntity = results[0];
        // Parse attributes
        siteAttrs = {};
        if (results[1] && Array.isArray(results[1])) {
            results[1].forEach(function (a) { siteAttrs[a.key] = a.value; });
        }
        return pollAllDevices().then(function () { return fetchTodayEnergy(); });
    }).then(function () {
        render();
        startPolling();
    }).catch(function (err) {
        console.error('[SM] Init error:', err);
        showError('Failed to load site data. Check console for details.');
    });
};

// ═══ LIFECYCLE ════════════════════════════════════════════════

self.onDataUpdated = function () {};

self.onResize = function () {};

self.onDestroy = function () {
    if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
    }
    if (_addrDebounceTimer) {
        clearTimeout(_addrDebounceTimer);
        _addrDebounceTimer = null;
    }
    if (_addrOutsideClickFn) {
        document.removeEventListener('click', _addrOutsideClickFn);
        _addrOutsideClickFn = null;
    }
};
