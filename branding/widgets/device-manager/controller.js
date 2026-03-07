// ═══════════════════════════════════════════════════════════════
// SignConnect — Device Manager Widget (controller.js)
// ═══════════════════════════════════════════════════════════════
// DEVICE state widget. Shows:
//   Tab 1: Details — device metadata, profile, parent site
//   Tab 2: Telemetry — live dim/power/energy/faults
//   Tab 3: Credentials — access token, copy, regenerate
//
// Receives device ID from dashboard state params.
// Polls telemetry every 15s.
// ═══════════════════════════════════════════════════════════════

var pollTimer = null;

self.onInit = function () {
    'use strict';

    var POLL_INTERVAL = 15000;
    var FRESHNESS_ONLINE = 600000;   // 10 min
    var FRESHNESS_STALE  = 3600000;  // 60 min

    var $root = self.ctx.$container[0];
    var container = $root.querySelector('.dm-root');
    if (!container) {
        $root.innerHTML = '<div class="dm-root"></div>';
        container = $root.querySelector('.dm-root');
    }
    var http = self.ctx.http;

    // ── State Variables ─────────────────────────────────────────

    var deviceId = null;
    var deviceEntity = null;
    var deviceProfile = null;
    var deviceCredentials = null;
    var parentSite = null;
    var telemetry = {};
    var lastActivity = 0;
    var connectionStatus = 'offline';
    var faultCount = 0;
    var activeTab = 'details';
    var isEditing = false;
    var isSaving = false;
    var showRegenConfirm = false;
    var isRegenerating = false;
    var copySuccess = false;
    var copyTimer = null;

    // ── Telemetry Keys ──────────────────────────────────────────

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

    var FAULT_KEYS = [
        'fault_overall_failure', 'fault_under_voltage', 'fault_over_voltage',
        'fault_power_limit', 'fault_thermal_derating', 'fault_thermal_shutdown',
        'fault_light_src_failure', 'fault_light_src_short_circuit',
        'fault_light_src_thermal_derate', 'fault_light_src_thermal_shutdn',
        'fault_input_power', 'fault_current_limited', 'fault_driver_failure',
        'fault_external', 'fault_d4i_power_exceeded', 'fault_overcurrent',
        'status_control_gear_failure', 'status_lamp_failure'
    ];

    var WARNING_KEYS = [
        'status_limit_error', 'status_reset_state', 'status_missing_short_addr'
    ];

    // ── Resolve Device ID ───────────────────────────────────────

    function resolveDeviceId() {
        try {
            var stateParams = self.ctx.stateController.getStateParams();
            if (stateParams && stateParams.entityId && stateParams.entityId.id) {
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
        return (self.ctx.settings && self.ctx.settings.deviceId) || null;
    }

    // ── API Helpers ─────────────────────────────────────────────

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

    function esc(text) {
        if (!text) return '';
        return text.replace(/&/g, '&amp;').replace(/</g, '&lt;')
                   .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    // ── Fault Check ─────────────────────────────────────────────

    function isFault(val) {
        if (val === undefined || val === null) return false;
        return val === 'true' || val === true || val === '1' || val === 1;
    }

    // ── Helpers ─────────────────────────────────────────────────

    function generateToken() {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
            var r = Math.random() * 16 | 0;
            return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
        });
    }

    function timeSince(ts) {
        if (!ts) return 'never';
        var seconds = Math.floor((Date.now() - ts) / 1000);
        if (seconds < 0) return 'just now';
        if (seconds < 60) return seconds + 's ago';
        var minutes = Math.floor(seconds / 60);
        if (minutes < 60) return minutes + 'm ago';
        var hours = Math.floor(minutes / 60);
        if (hours < 24) return hours + 'h ago';
        return Math.floor(hours / 24) + 'd ago';
    }

    function fmtNumber(val, decimals) {
        if (val === undefined || val === null || val === '') return '-';
        var n = parseFloat(val);
        if (isNaN(n)) return '-';
        return n.toFixed(decimals !== undefined ? decimals : 1);
    }

    function faultLabel(key) {
        return key.replace(/^fault_|^status_/g, '').replace(/_/g, ' ')
                   .replace(/\b\w/g, function (c) { return c.toUpperCase(); });
    }

    // ── Navigation ──────────────────────────────────────────────

    function openState(stateId, params) {
        try { self.ctx.stateController.openState(stateId, params); }
        catch (e) { console.error('[DM] Navigate failed:', e); }
    }

    // ── Fetch Parent Site ───────────────────────────────────────

    function fetchParentSite() {
        return apiGet('/relations?toId=' + deviceId + '&toType=DEVICE&relationType=Contains')
            .then(function (rels) {
                var siteRel = rels.find(function (r) {
                    return r.from && r.from.entityType === 'ASSET';
                });
                if (siteRel) {
                    return apiGet('/asset/' + siteRel.from.id).then(function (asset) {
                        parentSite = { id: siteRel.from.id, name: asset.name };
                    });
                }
            }).catch(function () { parentSite = null; });
    }

    // ── Telemetry Polling ───────────────────────────────────────

    function pollTelemetry() {
        return apiGet('/plugins/telemetry/DEVICE/' + deviceId +
            '/values/timeseries?keys=' + TELEMETRY_KEYS)
            .then(function (data) {
                var now = Date.now();
                Object.keys(data).forEach(function (key) {
                    if (data[key] && data[key].length > 0) {
                        telemetry[key] = data[key][0].value;
                        var t = parseInt(data[key][0].ts);
                        if (t > lastActivity) lastActivity = t;
                    }
                });
                var age = now - lastActivity;
                if (age < FRESHNESS_ONLINE) connectionStatus = 'online';
                else if (age < FRESHNESS_STALE) connectionStatus = 'stale';
                else connectionStatus = 'offline';

                faultCount = 0;
                FAULT_KEYS.forEach(function (fk) {
                    if (isFault(telemetry[fk])) faultCount++;
                });
            }).catch(function () {});
    }

    function fetchTodayEnergy() {
        var startOfDay = new Date();
        startOfDay.setHours(0, 0, 0, 0);
        var startTs = startOfDay.getTime();
        var endTs = Date.now();
        return apiGet('/plugins/telemetry/DEVICE/' + deviceId +
            '/values/timeseries?keys=energy_wh&startTs=' + startTs +
            '&endTs=' + endTs + '&agg=SUM&interval=' + (endTs - startTs))
            .then(function (data) {
                telemetry.energy_today_wh = (data.energy_wh && data.energy_wh.length > 0)
                    ? parseFloat(data.energy_wh[0].value) || 0 : 0;
            }).catch(function () { telemetry.energy_today_wh = 0; });
    }

    function startPolling() {
        pollTimer = setInterval(function () {
            pollTelemetry().then(function () {
                return fetchTodayEnergy();
            }).then(function () {
                if (activeTab === 'telemetry') render();
            });
        }, POLL_INTERVAL);
    }

    // ── Render: Header ──────────────────────────────────────────

    function renderHeader() {
        var name = deviceEntity ? esc(deviceEntity.name) : 'Device';
        var html = '<div class="dm-header">';

        // Breadcrumb
        html += '<div class="dm-breadcrumb">';
        if (parentSite) {
            html += '<span class="dm-breadcrumb-link" data-action="go-site">' + esc(parentSite.name) + '</span>';
            html += '<span class="dm-breadcrumb-sep"> / </span>';
        }
        html += '<span>' + name + '</span>';
        html += '</div>';

        // Device name + status
        html += '<div class="dm-header-row">';
        html += '<div class="dm-device-name">' + name + '</div>';
        html += renderStatusBadge();
        html += '</div>';
        html += '</div>';
        return html;
    }

    function renderStatusBadge() {
        var cls = 'dm-status-' + connectionStatus;
        var dotCls = 'dm-dot-' + connectionStatus;
        var label = connectionStatus.charAt(0).toUpperCase() + connectionStatus.slice(1);
        if (faultCount > 0 && connectionStatus === 'online') {
            cls = 'dm-status-fault';
            dotCls = 'dm-dot-fault';
            label = faultCount + ' Fault' + (faultCount > 1 ? 's' : '');
        }
        return '<span class="dm-status-badge ' + cls + '">' +
               '<span class="dm-dot ' + dotCls + '"></span>' + label + '</span>';
    }

    // ── Render: Tabs ────────────────────────────────────────────

    function renderTabs() {
        var tabs = [
            { id: 'details', label: 'Details' },
            { id: 'telemetry', label: 'Telemetry' },
            { id: 'credentials', label: 'Credentials' }
        ];
        var html = '<div class="dm-tabs">';
        tabs.forEach(function (t) {
            var cls = activeTab === t.id ? 'dm-tab dm-tab-active' : 'dm-tab';
            html += '<button class="' + cls + '" data-tab="' + t.id + '">' + t.label + '</button>';
        });
        html += '</div>';
        return html;
    }

    // ── Render: Details Tab ─────────────────────────────────────

    function renderDetailsTab() {
        var html = '<div class="dm-tab-content">';

        // Action bar
        html += '<div class="dm-action-bar">';
        if (!isEditing) {
            html += '<button class="dm-btn dm-btn-secondary" data-action="edit">' +
                    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
                    '<path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/>' +
                    '<path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>' +
                    ' Edit</button>';
        } else {
            html += '<button class="dm-btn dm-btn-secondary" data-action="cancel-edit">Cancel</button>';
            html += '<button class="dm-btn dm-btn-primary" data-action="save"' +
                    (isSaving ? ' disabled' : '') + '>' +
                    (isSaving ? 'Saving...' : 'Save') + '</button>';
        }
        html += '</div>';

        // Device info card
        html += '<div class="dm-card">';
        html += '<div class="dm-card-title">' +
                '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
                '<rect x="4" y="4" width="16" height="16" rx="2"/><line x1="9" y1="9" x2="15" y2="9"/>' +
                '<line x1="9" y1="13" x2="15" y2="13"/></svg>' +
                ' Device Information</div>';

        if (isEditing) {
            html += renderMetaRowInput('Name', 'edit-name', deviceEntity ? deviceEntity.name : '');
            html += renderMetaRowInput('Label', 'edit-label', deviceEntity ? (deviceEntity.label || '') : '');
        } else {
            html += renderMetaRow('Name', deviceEntity ? deviceEntity.name : '-');
            html += renderMetaRow('Label', deviceEntity && deviceEntity.label ? deviceEntity.label : '-');
        }

        html += renderMetaRow('Device ID', deviceId || '-');
        html += renderMetaRow('Type', deviceEntity && deviceEntity.type ? deviceEntity.type : '-');
        html += renderMetaRow('Profile', deviceProfile ? deviceProfile.name : '-');

        // Customer
        var customerName = '-';
        if (deviceEntity && deviceEntity.customerTitle) {
            customerName = deviceEntity.customerTitle;
        }
        html += renderMetaRow('Customer', customerName);

        // Parent site (clickable)
        if (parentSite) {
            html += '<div class="dm-meta-row">';
            html += '<div class="dm-meta-label">Site</div>';
            html += '<div class="dm-meta-value"><span class="dm-link" data-action="go-site">' +
                    esc(parentSite.name) + '</span></div>';
            html += '</div>';
        } else {
            html += renderMetaRow('Site', '-');
        }

        // Created time
        if (deviceEntity && deviceEntity.createdTime) {
            var d = new Date(deviceEntity.createdTime);
            html += renderMetaRow('Created', d.toLocaleDateString('en-GB', {
                day: 'numeric', month: 'short', year: 'numeric'
            }));
        }

        html += '</div>'; // .dm-card

        // Quick telemetry summary
        html += '<div class="dm-card">';
        html += '<div class="dm-card-title">' +
                '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
                '<polyline points="22,12 18,12 15,21 9,3 6,12 2,12"/></svg>' +
                ' Quick Status</div>';

        var dimVal = telemetry.dim_value !== undefined ? fmtNumber(telemetry.dim_value, 0) : '-';
        var lampOn = isFault(telemetry.status_light_src_on) ? 'ON' : 'OFF';
        var driverOk = isFault(telemetry.status_driver_ok) ? 'OK' : 'N/A';
        var power = telemetry.power_watts !== undefined ? fmtNumber(telemetry.power_watts, 1) + ' W' : '-';
        var lastSeen = lastActivity > 0 ? timeSince(lastActivity) : 'Never';

        html += renderMetaRow('Connection', connectionStatus.charAt(0).toUpperCase() + connectionStatus.slice(1));
        html += renderMetaRow('Dim Level', dimVal + '%');
        html += renderMetaRow('Lamp', lampOn);
        html += renderMetaRow('Driver', driverOk);
        html += renderMetaRow('Power', power);
        html += renderMetaRow('Active Faults', faultCount > 0 ?
                '<span class="dm-fault-count">' + faultCount + '</span>' : '0');
        html += renderMetaRow('Last Seen', lastSeen);

        html += '</div>'; // .dm-card

        html += '</div>'; // .dm-tab-content
        return html;
    }

    function renderMetaRow(label, value) {
        return '<div class="dm-meta-row">' +
               '<div class="dm-meta-label">' + esc(label) + '</div>' +
               '<div class="dm-meta-value">' + value + '</div>' +
               '</div>';
    }

    function renderMetaRowInput(label, inputId, value) {
        return '<div class="dm-meta-row">' +
               '<div class="dm-meta-label">' + esc(label) + '</div>' +
               '<div class="dm-meta-value">' +
               '<input type="text" class="dm-input" id="' + inputId + '" value="' + esc(value) + '" />' +
               '</div></div>';
    }

    // ── Render: Telemetry Tab ───────────────────────────────────

    function renderTelemetryTab() {
        var html = '<div class="dm-tab-content">';

        // Status Card
        html += '<div class="dm-card">';
        html += '<div class="dm-card-title">' +
                '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
                '<circle cx="12" cy="12" r="10"/><polyline points="12,6 12,12 16,14"/></svg>' +
                ' Status</div>';
        html += '<div class="dm-status-row">';
        html += renderStatusBadge();
        html += '<span class="dm-last-seen">Last seen: ' +
                (lastActivity > 0 ? timeSince(lastActivity) : 'Never') + '</span>';
        html += '</div>';

        // Dim level bar
        var dimRaw = telemetry.dim_value !== undefined ? parseFloat(telemetry.dim_value) : 0;
        var dimPct = isNaN(dimRaw) ? 0 : Math.max(0, Math.min(100, dimRaw));
        var dimOn = isFault(telemetry.status_light_src_on);
        html += '<div class="dm-dim-section">';
        html += '<div class="dm-dim-label">Dim Level</div>';
        html += '<div class="dm-dim-bar-wrap">';
        html += '<div class="dm-dim-bar-track"><div class="dm-dim-bar-fill' +
                (dimOn ? ' dm-dim-on' : '') + '" style="width:' + dimPct + '%"></div></div>';
        html += '<span class="dm-dim-value' + (dimOn ? ' dm-dim-on-text' : '') + '">' +
                fmtNumber(dimRaw, 0) + '%</span>';
        html += '</div></div>';

        // Lamp status
        html += '<div class="dm-inline-row">';
        html += '<span class="dm-inline-label">Lamp:</span>';
        html += '<span class="dm-inline-value' + (dimOn ? ' dm-val-green' : ' dm-val-muted') + '">' +
                (dimOn ? 'ON' : 'OFF') + '</span>';
        html += '<span class="dm-inline-label" style="margin-left:16px">Driver:</span>';
        html += '<span class="dm-inline-value' +
                (isFault(telemetry.status_driver_ok) ? ' dm-val-green' : ' dm-val-muted') + '">' +
                (isFault(telemetry.status_driver_ok) ? 'OK' : 'N/A') + '</span>';
        html += '</div>';
        html += '</div>'; // .dm-card

        // Power & Energy Card
        html += '<div class="dm-card">';
        html += '<div class="dm-card-title">' +
                '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
                '<polygon points="13,2 3,14 12,14 11,22 21,10 12,10"/></svg>' +
                ' Power & Energy</div>';
        html += '<div class="dm-telemetry-grid">';

        var powerW = telemetry.power_watts !== undefined ? fmtNumber(telemetry.power_watts, 1) : '-';
        var energyWh = telemetry.energy_wh !== undefined ? fmtNumber(parseFloat(telemetry.energy_wh) / 1000, 2) : '-';
        var todayWh = telemetry.energy_today_wh !== undefined ? fmtNumber(telemetry.energy_today_wh / 1000, 2) : '-';
        var co2 = telemetry.co2_grams !== undefined ? fmtNumber(parseFloat(telemetry.co2_grams) / 1000, 2) : '-';

        html += renderTelemetryCell('Power', powerW, 'W');
        html += renderTelemetryCell('Total Energy', energyWh, 'kWh');
        html += renderTelemetryCell('Today Energy', todayWh, 'kWh');
        html += renderTelemetryCell('CO2 Saved', co2, 'kg');

        html += '</div></div>'; // .dm-telemetry-grid, .dm-card

        // Faults Card
        html += '<div class="dm-card">';
        html += '<div class="dm-card-title">' +
                '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
                '<path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>' +
                '<line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>' +
                ' Faults (' + faultCount + ')</div>';
        html += '<div class="dm-fault-list">';

        FAULT_KEYS.forEach(function (key) {
            var active = isFault(telemetry[key]);
            html += '<div class="dm-fault-item' + (active ? ' dm-fault-active' : ' dm-fault-inactive') + '">';
            html += '<span class="dm-fault-dot' + (active ? ' dm-fault-dot-red' : ' dm-fault-dot-green') + '"></span>';
            html += '<span class="dm-fault-name">' + faultLabel(key) + '</span>';
            html += '</div>';
        });

        html += '</div></div>'; // .dm-fault-list, .dm-card

        // Warnings Card
        html += '<div class="dm-card">';
        html += '<div class="dm-card-title">' +
                '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
                '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/>' +
                '<line x1="12" y1="16" x2="12.01" y2="16"/></svg>' +
                ' Warnings</div>';
        html += '<div class="dm-fault-list">';

        WARNING_KEYS.forEach(function (key) {
            var active = isFault(telemetry[key]);
            html += '<div class="dm-fault-item' + (active ? ' dm-fault-active' : ' dm-fault-inactive') + '">';
            html += '<span class="dm-fault-dot' + (active ? ' dm-fault-dot-amber' : ' dm-fault-dot-green') + '"></span>';
            html += '<span class="dm-fault-name">' + faultLabel(key) + '</span>';
            html += '</div>';
        });

        html += '</div></div>'; // .dm-fault-list, .dm-card

        html += '</div>'; // .dm-tab-content
        return html;
    }

    function renderTelemetryCell(label, value, unit) {
        return '<div class="dm-telem-cell">' +
               '<div class="dm-telem-label">' + label + '</div>' +
               '<div class="dm-telem-value">' + value +
               '<span class="dm-telem-unit">' + unit + '</span></div>' +
               '</div>';
    }

    // ── Render: Credentials Tab ─────────────────────────────────

    function renderCredentialsTab() {
        var html = '<div class="dm-tab-content">';

        html += '<div class="dm-card">';
        html += '<div class="dm-card-title">' +
                '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
                '<rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>' +
                '<path d="M7 11V7a5 5 0 0110 0v4"/></svg>' +
                ' Access Token</div>';

        var token = '-';
        var credType = '';
        if (deviceCredentials) {
            token = deviceCredentials.credentialsId || '-';
            credType = deviceCredentials.credentialsType || 'ACCESS_TOKEN';
        }

        html += renderMetaRow('Type', credType);

        // Token display with copy button
        html += '<div class="dm-meta-row">';
        html += '<div class="dm-meta-label">Token</div>';
        html += '<div class="dm-meta-value">';
        html += '<div class="dm-token-display">';
        html += '<code class="dm-token-code">' + esc(token) + '</code>';
        html += '<button class="dm-btn-icon" data-action="copy-token" title="Copy to clipboard">';
        if (copySuccess) {
            html += '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#059669" stroke-width="2">' +
                    '<polyline points="20,6 9,17 4,12"/></svg>';
        } else {
            html += '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
                    '<rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>' +
                    '<path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>';
        }
        html += '</button>';
        html += '</div></div></div>'; // .dm-token-display, .dm-meta-value, .dm-meta-row

        if (copySuccess) {
            html += '<div class="dm-copy-toast">Copied!</div>';
        }

        html += '</div>'; // .dm-card

        // Regenerate section
        html += '<div class="dm-card">';
        html += '<div class="dm-card-title">' +
                '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
                '<polyline points="23,4 23,10 17,10"/><polyline points="1,20 1,14 7,14"/>' +
                '<path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/></svg>' +
                ' Regenerate Token</div>';

        html += '<p class="dm-regen-hint">Generate a new access token. ' +
                'The current token will be invalidated and the device will need to be reconfigured.</p>';

        if (!showRegenConfirm) {
            html += '<button class="dm-btn dm-btn-danger" data-action="show-regen"' +
                    (isRegenerating ? ' disabled' : '') + '>Regenerate Token</button>';
        } else {
            html += '<div class="dm-regen-confirm">';
            html += '<p class="dm-regen-warning">Are you sure? This will invalidate the current token. ' +
                    'The device will need to be reconfigured.</p>';
            html += '<div class="dm-regen-actions">';
            html += '<button class="dm-btn dm-btn-secondary" data-action="cancel-regen">Cancel</button>';
            html += '<button class="dm-btn dm-btn-danger" data-action="confirm-regen"' +
                    (isRegenerating ? ' disabled' : '') + '>' +
                    (isRegenerating ? 'Regenerating...' : 'Yes, Regenerate') + '</button>';
            html += '</div></div>';
        }

        html += '</div>'; // .dm-card

        html += '</div>'; // .dm-tab-content
        return html;
    }

    // ── Main Render ─────────────────────────────────────────────

    function render() {
        var html = renderHeader() + renderTabs();
        if (activeTab === 'details') html += renderDetailsTab();
        else if (activeTab === 'telemetry') html += renderTelemetryTab();
        else if (activeTab === 'credentials') html += renderCredentialsTab();
        container.innerHTML = html;
        bindEvents();
    }

    // ── Bind Events ─────────────────────────────────────────────

    function bindEvents() {
        // Tab clicks
        var tabBtns = container.querySelectorAll('.dm-tab');
        tabBtns.forEach(function (btn) {
            btn.addEventListener('click', function () {
                activeTab = btn.getAttribute('data-tab');
                render();
            });
        });

        // Action buttons
        var actionBtns = container.querySelectorAll('[data-action]');
        actionBtns.forEach(function (btn) {
            btn.addEventListener('click', function (e) {
                var action = btn.getAttribute('data-action');
                handleAction(action, e);
            });
        });
    }

    function handleAction(action, e) {
        switch (action) {
            case 'edit':
                isEditing = true;
                render();
                break;

            case 'cancel-edit':
                isEditing = false;
                render();
                break;

            case 'save':
                saveDevice();
                break;

            case 'go-site':
                if (parentSite) {
                    openState('site', {
                        entityId: { id: parentSite.id, entityType: 'ASSET' },
                        entityName: parentSite.name
                    });
                }
                break;

            case 'copy-token':
                copyToken();
                break;

            case 'show-regen':
                showRegenConfirm = true;
                render();
                break;

            case 'cancel-regen':
                showRegenConfirm = false;
                render();
                break;

            case 'confirm-regen':
                regenerateToken();
                break;
        }
    }

    // ── Save Device ─────────────────────────────────────────────

    function saveDevice() {
        if (isSaving || !deviceEntity) return;
        isSaving = true;
        render();

        var nameInput = container.querySelector('#edit-name');
        var labelInput = container.querySelector('#edit-label');
        var newName = nameInput ? nameInput.value.trim() : deviceEntity.name;
        var newLabel = labelInput ? labelInput.value.trim() : (deviceEntity.label || '');

        // Re-fetch to get latest version (optimistic locking)
        apiGet('/device/' + deviceId).then(function (latest) {
            latest.name = newName;
            latest.label = newLabel;
            return apiPost('/device', latest);
        }).then(function (saved) {
            deviceEntity = saved;
            isEditing = false;
            isSaving = false;
            render();
        }).catch(function (err) {
            console.error('[DM] Save failed:', err);
            isSaving = false;
            render();
        });
    }

    // ── Copy Token ──────────────────────────────────────────────

    function copyToken() {
        if (!deviceCredentials || !deviceCredentials.credentialsId) return;
        var token = deviceCredentials.credentialsId;
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(token).then(function () {
                showCopySuccess();
            }).catch(function () {
                fallbackCopy(token);
            });
        } else {
            fallbackCopy(token);
        }
    }

    function fallbackCopy(text) {
        var ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand('copy'); showCopySuccess(); }
        catch (e) { console.error('[DM] Copy failed'); }
        document.body.removeChild(ta);
    }

    function showCopySuccess() {
        copySuccess = true;
        render();
        if (copyTimer) clearTimeout(copyTimer);
        copyTimer = setTimeout(function () {
            copySuccess = false;
            if (activeTab === 'credentials') render();
        }, 2000);
    }

    // ── Regenerate Token ────────────────────────────────────────

    function regenerateToken() {
        if (isRegenerating || !deviceCredentials) return;
        isRegenerating = true;
        render();

        // Re-fetch current credentials to get latest version
        apiGet('/device/' + deviceId + '/credentials').then(function (creds) {
            creds.credentialsId = generateToken();
            return apiPost('/device/' + deviceId + '/credentials', creds);
        }).then(function (newCreds) {
            deviceCredentials = newCreds;
            isRegenerating = false;
            showRegenConfirm = false;
            render();
        }).catch(function (err) {
            console.error('[DM] Regenerate failed:', err);
            isRegenerating = false;
            render();
        });
    }

    // ── Init Flow ───────────────────────────────────────────────

    deviceId = resolveDeviceId();
    if (!deviceId) {
        container.innerHTML = '<div class="dm-error">' +
            '<div class="dm-error-icon">&#9888;</div>' +
            '<div class="dm-error-text">No device selected</div></div>';
        return;
    }

    Promise.all([
        apiGet('/device/' + deviceId),
        apiGet('/device/' + deviceId + '/credentials'),
        pollTelemetry(),
        fetchTodayEnergy(),
        fetchParentSite()
    ]).then(function (results) {
        deviceEntity = results[0];
        deviceCredentials = results[1];
        if (deviceEntity && deviceEntity.deviceProfileId) {
            return apiGet('/deviceProfile/' + deviceEntity.deviceProfileId.id).then(function (p) {
                deviceProfile = p;
            });
        }
    }).then(function () {
        render();
        startPolling();
    }).catch(function (err) {
        console.error('[DM] Init failed:', err);
        container.innerHTML = '<div class="dm-error">' +
            '<div class="dm-error-icon">&#9888;</div>' +
            '<div class="dm-error-text">Failed to load device data</div></div>';
    });
};

self.onDataUpdated = function () {};
self.onResize = function () {};
self.onDestroy = function () {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
};
