// ═══════════════════════════════════════════════════════════════
// SignConnect — Site Overview Widget (controller.js)
// ═══════════════════════════════════════════════════════════════
// SITE state root widget. Shows:
//   Tab 1: Device cards with live telemetry
//   Tab 2: Site metadata (installation info, LED/driver specs)
//   Tab 3: Alarm settings (recipients, notification toggles)
//
// Receives site ASSET ID from dashboard state params (Fleet nav)
// Queries relations to find child devices, polls telemetry.
// ═══════════════════════════════════════════════════════════════

var pollTimer = null; // outer scope — accessible by onDestroy

self.onInit = function () {
    'use strict';

    var POLL_INTERVAL = 15000; // 15s telemetry refresh
    var FRESHNESS_ONLINE = 600000;  // 10 min
    var FRESHNESS_STALE  = 3600000; // 60 min

    var $root = self.ctx.$container[0];
    var container = $root.querySelector('.so-root');
    if (!container) {
        // Fallback: create so-root if template didn't load
        $root.innerHTML = '<div class="so-root"></div>';
        container = $root.querySelector('.so-root');
    }
    var http = self.ctx.http;

    var siteId = null;
    var devices = [];       // [{id, name, type, telemetry: {...}, lastActivity}]
    var siteAttrs = {};     // server attributes on site asset
    var activeTab = 'devices';
    var isEditing = false;
    var isSaving = false;

    // ── Resolve Site Asset ID ─────────────────────────────────

    function resolveSiteId() {
        // 1. Dashboard state (Fleet navigation)
        try {
            var stateParams = self.ctx.stateController.getStateParams();
            if (stateParams && stateParams.entityId && stateParams.entityId.id) {
                return stateParams.entityId.id;
            }
        } catch (e) { /* stateController unavailable */ }

        // 2. Datasource entity (entity alias)
        try {
            var ds = self.ctx.datasources;
            if (ds && ds.length > 0 && ds[0].entity) {
                var eid = ds[0].entity.id;
                return (typeof eid === 'object' && eid !== null) ? eid.id : eid;
            }
        } catch (e) { /* datasource unavailable */ }

        // 3. Fallback: widget settings
        return (self.ctx.settings && self.ctx.settings.siteAssetId) || null;
    }

    // ── API Helpers ───────────────────────────────────────────
    // TB CE http.get/post return RxJS Observables, not Promises.
    // Convert via .toPromise() for easier chaining.

    function apiGet(path) {
        var obs = http.get('/api' + path);
        if (obs && typeof obs.toPromise === 'function') {
            return obs.toPromise();
        }
        // Fallback: wrap Observable manually
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

    // ── Fetch Devices via Relations ───────────────────────────

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
                // Fetch device info for each
                var promises = deviceRelations.map(function (r) {
                    return apiGet('/device/' + r.to.id).then(function (dev) {
                        return {
                            id: dev.id.id,
                            name: dev.name || 'Unknown',
                            type: dev.type || 'Zenosmart DALI',
                            label: dev.label || '',
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

    // ── Poll Telemetry for All Devices ────────────────────────

    var TELEMETRY_KEYS = [
        'dim_value', 'power_watts', 'energy_wh', 'co2_grams',
        'status_light_src_on', 'status_driver_ok', 'status_ready',
        'fault_overall_failure', 'fault_input_power', 'fault_thermal_shutdown',
        'fault_thermal_derating', 'fault_current_limited', 'fault_light_src_failure',
        'fault_driver_failure', 'fault_external', 'fault_d4i_power_exceeded',
        'fault_overcurrent'
    ].join(',');

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
                            // Track most recent timestamp for connection status
                            var t = parseInt(data[key][0].ts);
                            if (t > dev.lastActivity) dev.lastActivity = t;
                        }
                    });
                    dev.telemetry = ts;

                    // Connection status
                    var age = now - dev.lastActivity;
                    if (age < FRESHNESS_ONLINE) dev.connectionStatus = 'online';
                    else if (age < FRESHNESS_STALE) dev.connectionStatus = 'stale';
                    else dev.connectionStatus = 'offline';

                    // Fault count
                    var faults = 0;
                    ['fault_overall_failure', 'fault_input_power', 'fault_thermal_shutdown',
                     'fault_thermal_derating', 'fault_current_limited', 'fault_light_src_failure',
                     'fault_driver_failure', 'fault_external', 'fault_d4i_power_exceeded',
                     'fault_overcurrent'].forEach(function (fk) {
                        if (ts[fk] === 'true' || ts[fk] === '1' || ts[fk] === true) faults++;
                    });
                    dev.faultCount = faults;
                });
        });

        return Promise.all(promises);
    }

    // ── Fetch today's energy per device (SUM aggregation) ─────

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

    // ── Fetch Site Attributes ─────────────────────────────────

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

    // ── Save Site Attributes ──────────────────────────────────

    function saveSiteAttributes(attrs) {
        return apiPost('/plugins/telemetry/ASSET/' + siteId + '/attributes/SERVER_SCOPE', attrs);
    }

    // ── Navigate to Device Overview ───────────────────────────

    function openDeviceOverview(deviceId, deviceName) {
        try {
            self.ctx.stateController.openState('default', {
                entityId: { id: deviceId, entityType: 'DEVICE' },
                entityName: deviceName
            });
        } catch (e) {
            console.error('[SITE] Failed to navigate:', e);
        }
    }

    // ── Navigate Back to Fleet ────────────────────────────────

    function goBackToFleet() {
        try {
            window.history.back();
        } catch (e) {
            console.error('[SITE] Failed to navigate back:', e);
        }
    }

    // ═══ RENDER ═══════════════════════════════════════════════

    function render() {
        var html = '';
        html += renderBanner();
        html += renderTabs();
        if (activeTab === 'devices') {
            html += renderDevicesTab();
        } else if (activeTab === 'site-info') {
            html += renderSiteInfoTab();
        } else if (activeTab === 'alarms') {
            html += renderAlarmsTab();
        }
        container.innerHTML = html;
        bindEvents();
    }

    // ── Banner ────────────────────────────────────────────────

    function renderBanner() {
        var online = 0, faulted = 0, totalPower = 0, totalEnergy = 0;
        devices.forEach(function (d) {
            if (d.connectionStatus === 'online') online++;
            if (d.faultCount > 0) faulted++;
            totalPower += parseFloat(d.telemetry.power_watts) || 0;
            totalEnergy += (d.telemetry.energy_today_wh || 0) / 1000;
        });

        var siteName = siteAttrs.installation_name || siteAttrs.siteName || 'Site';
        var estate = siteAttrs.estate_name || '';
        var region = siteAttrs.region_name || '';
        var breadcrumb = '';
        if (estate) breadcrumb += esc(estate);
        if (region) breadcrumb += (estate ? ' › ' : '') + esc(region);

        return '<div class="so-banner">' +
            '<div class="so-banner-left">' +
                '<button class="so-back-btn" data-action="back" title="Back to Fleet">' +
                    '<svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"/></svg>' +
                '</button>' +
                '<div>' +
                    (breadcrumb ? '<div class="so-breadcrumb">' + breadcrumb + '</div>' : '') +
                    '<div class="so-site-name">' + esc(siteName) + '</div>' +
                '</div>' +
            '</div>' +
            '<div class="so-banner-stats">' +
                statBox('Devices', devices.length, '') +
                '<div class="so-stat-divider"></div>' +
                statBox('Online', online, 'green') +
                (faulted > 0 ? '<div class="so-stat-divider"></div>' + statBox('Faults', faulted, 'red') : '') +
                '<div class="so-stat-divider"></div>' +
                statBox('Power', Math.round(totalPower) + '<span class="so-stat-unit">W</span>', '') +
                statBox('Today', totalEnergy.toFixed(1) + '<span class="so-stat-unit">kWh</span>', '') +
            '</div>' +
        '</div>';
    }

    function statBox(label, value, color) {
        var cls = color === 'green' ? ' so-stat-green' : color === 'red' ? ' so-stat-red' : '';
        return '<div class="so-stat-box">' +
            '<div class="so-stat-label">' + label + '</div>' +
            '<div class="so-stat-value' + cls + '">' + value + '</div>' +
        '</div>';
    }

    // ── Tabs ──────────────────────────────────────────────────

    function renderTabs() {
        return '<div class="so-tab-bar">' +
            tab('devices', 'Devices (' + devices.length + ')') +
            tab('site-info', 'Site Information') +
            tab('alarms', 'Alarm Settings') +
        '</div>';
    }

    function tab(id, label) {
        var cls = activeTab === id ? ' so-tab-active' : '';
        return '<button class="so-tab' + cls + '" data-tab="' + id + '">' + label + '</button>';
    }

    // ── Devices Tab ───────────────────────────────────────────

    function renderDevicesTab() {
        if (devices.length === 0) {
            return '<div class="so-empty">' +
                '<div class="so-empty-icon">📡</div>' +
                '<div class="so-empty-text">No devices found under this site.</div>' +
                '<div class="so-empty-hint">Assign devices via asset relations in ThingsBoard.</div>' +
            '</div>';
        }

        var cols = devices.length <= 2 ? 'so-grid-2' : 'so-grid-3';
        var html = '<div class="so-device-grid ' + cols + '">';
        devices.forEach(function (dev) {
            html += renderDeviceCard(dev);
        });
        html += '</div>';
        return html;
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

        return '<div class="so-card so-card-' + status + '" data-action="open-device" data-device-id="' + dev.id + '" data-device-name="' + esc(dev.name) + '">' +
            '<div class="so-card-header">' +
                '<div>' +
                    '<div class="so-card-name">' + esc(dev.name) + '</div>' +
                    '<div class="so-card-type">' + esc(dev.type) + '</div>' +
                '</div>' +
                '<div class="so-status-badge so-status-' + status + '">' +
                    '<span class="so-dot so-dot-' + status + '"></span>' +
                    statusLabel +
                '</div>' +
            '</div>' +
            // Dim bar
            '<div class="so-dim-bar-wrap">' +
                '<div class="so-dim-bar-track">' +
                    '<div class="so-dim-bar-fill' + (lampOn ? ' so-dim-on' : '') + '" style="width:' + dim + '%"></div>' +
                '</div>' +
                '<span class="so-dim-value' + (lampOn ? ' so-dim-on-text' : '') + '">' + dim + '%</span>' +
            '</div>' +
            // Metrics
            '<div class="so-card-metrics">' +
                '<div class="so-card-metric">' +
                    '<div class="so-metric-label">Power</div>' +
                    '<div class="so-metric-value">' + Math.round(power) + '<span class="so-metric-unit">W</span></div>' +
                '</div>' +
                '<div class="so-card-metric">' +
                    '<div class="so-metric-label">Today</div>' +
                    '<div class="so-metric-value">' + energyKwh + '<span class="so-metric-unit">kWh</span></div>' +
                '</div>' +
            '</div>' +
            // Footer
            '<div class="so-card-footer">' +
                '<span class="so-last-seen">' + lastSeenText + '</span>' +
                (hasFault
                    ? '<span class="so-fault-pill">' +
                        '<svg width="12" height="12" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z"/></svg> ' +
                        dev.faultCount + ' fault' + (dev.faultCount > 1 ? 's' : '') +
                      '</span>'
                    : '<span class="so-view-link">View Details <svg width="12" height="12" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/></svg></span>'
                ) +
            '</div>' +
        '</div>';
    }

    // ── Site Info Tab ─────────────────────────────────────────

    function renderSiteInfoTab() {
        var html = '<div class="so-meta-toolbar">' +
            '<button class="so-edit-btn" data-action="toggle-edit">' +
                (isEditing
                    ? '<svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg> Save Changes'
                    : '<svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg> Edit'
                ) +
            '</button>' +
        '</div>';

        html += '<div class="so-meta-grid">';

        // Installation Info
        html += metaCard('Installation', 'bolt', [
            metaField('installation_name', 'Installation Name', siteAttrs.installation_name || ''),
            metaField('dali_name', 'DALI Name', siteAttrs.dali_name || ''),
        ]);

        // LED & Driver Info
        html += metaCard('LED & Driver', 'bulb', [
            metaField('led_type', 'LED Type', siteAttrs.led_type || ''),
            metaField('driver_type', 'Driver Type', siteAttrs.driver_type || ''),
            metaField('total_connected_wattage', 'Total Connected Wattage (W)', siteAttrs.total_connected_wattage || ''),
            metaField('co2_per_kwh', 'CO₂ per kWh (g)', siteAttrs.co2_per_kwh || '207'),
        ]);

        // Location
        html += metaCard('Location', 'map', [
            metaField('address', 'Address', siteAttrs.address || ''),
            metaField('gps_lat', 'GPS Latitude', siteAttrs.gps_lat || ''),
            metaField('gps_lng', 'GPS Longitude', siteAttrs.gps_lng || ''),
            metaField('contract_ref', 'Contract Reference', siteAttrs.contract_ref || ''),
        ]);

        // Contact
        html += metaCard('Site Contact', 'user', [
            metaField('contact_name', 'Contact Name', siteAttrs.contact_name || ''),
            metaField('contact_email', 'Contact Email', siteAttrs.contact_email || ''),
            metaField('contact_phone', 'Contact Phone', siteAttrs.contact_phone || ''),
        ]);

        html += '</div>';

        // Notes (full width)
        html += '<div class="so-meta-card so-meta-full">' +
            '<div class="so-meta-card-title">' +
                '<div class="so-meta-icon so-meta-icon-amber"><svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg></div>' +
                'Notes' +
            '</div>' +
            (isEditing
                ? '<textarea class="so-meta-textarea" data-attr="notes" rows="3">' + esc(siteAttrs.notes || '') + '</textarea>'
                : '<div class="so-meta-notes-text">' + esc(siteAttrs.notes || 'No notes.') + '</div>'
            ) +
        '</div>';

        return html;
    }

    var META_ICONS = {
        bolt: '<svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>',
        bulb: '<svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"/></svg>',
        map: '<svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"/></svg>',
        user: '<svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"/></svg>'
    };

    function metaCard(title, icon, fields) {
        return '<div class="so-meta-card">' +
            '<div class="so-meta-card-title">' +
                '<div class="so-meta-icon so-meta-icon-amber">' + META_ICONS[icon] + '</div>' +
                title +
            '</div>' +
            fields.join('') +
        '</div>';
    }

    function metaField(key, label, value) {
        if (isEditing) {
            return '<div class="so-meta-row">' +
                '<label class="so-meta-label">' + label + '</label>' +
                '<input class="so-meta-input" data-attr="' + key + '" value="' + esc(value) + '" />' +
            '</div>';
        }
        return '<div class="so-meta-row">' +
            '<span class="so-meta-label">' + label + '</span>' +
            '<span class="so-meta-value">' + (value ? esc(value) : '<em class="so-meta-empty">Not set</em>') + '</span>' +
        '</div>';
    }

    // ── Alarm Settings Tab ────────────────────────────────────

    function renderAlarmsTab() {
        var html = '<div class="so-meta-grid">';

        // Notification Toggles
        html += '<div class="so-meta-card">' +
            '<div class="so-meta-card-title">' +
                '<div class="so-meta-icon so-meta-icon-red"><svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z"/></svg></div>' +
                'Fault Notifications' +
            '</div>' +
            alarmToggle('alarm_fault_email', 'Fault Detected → Email', siteAttrs.alarm_fault_email !== 'false') +
            alarmToggle('alarm_cleared_email', 'Fault Cleared → Email', siteAttrs.alarm_cleared_email !== 'false') +
            alarmToggle('alarm_offline_email', 'Offline Watchdog → Email', siteAttrs.alarm_offline_email !== 'false') +
            '<div class="so-meta-row">' +
                '<span class="so-meta-label">Watchdog Threshold</span>' +
                '<div class="so-alarm-threshold">' +
                    '<input class="so-meta-input so-input-sm" data-alarm="alarm_watchdog_hours" type="number" min="1" max="168" value="' + (siteAttrs.alarm_watchdog_hours || '24') + '" />' +
                    '<span class="so-threshold-unit">hours</span>' +
                '</div>' +
            '</div>' +
        '</div>';

        // Recipients
        html += '<div class="so-meta-card">' +
            '<div class="so-meta-card-title">' +
                '<div class="so-meta-icon so-meta-icon-green"><svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"/></svg></div>' +
                'Alarm Recipients' +
            '</div>' +
            '<div class="so-meta-row so-meta-row-col">' +
                '<label class="so-meta-label">Email Addresses</label>' +
                '<textarea class="so-meta-textarea so-recipients-input" data-alarm="alarm_emails" rows="2" placeholder="one@example.com&#10;two@example.com">' + esc(siteAttrs.alarm_emails || '') + '</textarea>' +
                '<div class="so-meta-hint">One email per line. All recipients receive fault and watchdog notifications.</div>' +
            '</div>' +
            '<div class="so-meta-row so-meta-row-col">' +
                '<label class="so-meta-label">SMS Number</label>' +
                '<input class="so-meta-input" data-alarm="alarm_sms" value="' + esc(siteAttrs.alarm_sms || '') + '" placeholder="+44 7700 000000" />' +
            '</div>' +
        '</div>';

        html += '</div>';

        html += '<div class="so-alarm-save-wrap">' +
            '<button class="so-alarm-save-btn" data-action="save-alarms"' + (isSaving ? ' disabled' : '') + '>' +
                (isSaving ? 'Saving...' : 'Save Alarm Settings') +
            '</button>' +
        '</div>';

        return html;
    }

    function alarmToggle(key, label, enabled) {
        return '<div class="so-meta-row">' +
            '<span class="so-meta-label">' + label + '</span>' +
            '<label class="so-toggle">' +
                '<input type="checkbox" data-alarm-toggle="' + key + '"' + (enabled ? ' checked' : '') + ' />' +
                '<span class="so-toggle-slider"></span>' +
            '</label>' +
        '</div>';
    }

    // ── Event Binding ─────────────────────────────────────────

    function bindEvents() {
        // Tab clicks
        container.querySelectorAll('[data-tab]').forEach(function (btn) {
            btn.addEventListener('click', function () {
                activeTab = btn.getAttribute('data-tab');
                render();
            });
        });

        // Back button
        container.querySelectorAll('[data-action="back"]').forEach(function (btn) {
            btn.addEventListener('click', goBackToFleet);
        });

        // Device card clicks
        container.querySelectorAll('[data-action="open-device"]').forEach(function (card) {
            card.addEventListener('click', function () {
                var devId = card.getAttribute('data-device-id');
                var devName = card.getAttribute('data-device-name');
                openDeviceOverview(devId, devName);
            });
        });

        // Edit toggle
        container.querySelectorAll('[data-action="toggle-edit"]').forEach(function (btn) {
            btn.addEventListener('click', function () {
                if (isEditing) {
                    // Save
                    var inputs = container.querySelectorAll('[data-attr]');
                    var attrs = {};
                    inputs.forEach(function (inp) {
                        var key = inp.getAttribute('data-attr');
                        attrs[key] = inp.value || '';
                    });
                    saveSiteAttributes(attrs).then(function () {
                        Object.keys(attrs).forEach(function (k) { siteAttrs[k] = attrs[k]; });
                        isEditing = false;
                        render();
                    }).catch(function (err) {
                        console.error('[SITE] Failed to save attributes:', err);
                    });
                } else {
                    isEditing = true;
                    render();
                }
            });
        });

        // Save alarm settings
        container.querySelectorAll('[data-action="save-alarms"]').forEach(function (btn) {
            btn.addEventListener('click', function () {
                isSaving = true;
                render();
                var attrs = {};
                container.querySelectorAll('[data-alarm-toggle]').forEach(function (cb) {
                    attrs[cb.getAttribute('data-alarm-toggle')] = cb.checked ? 'true' : 'false';
                });
                container.querySelectorAll('[data-alarm]').forEach(function (inp) {
                    attrs[inp.getAttribute('data-alarm')] = inp.value || '';
                });
                saveSiteAttributes(attrs).then(function () {
                    Object.keys(attrs).forEach(function (k) { siteAttrs[k] = attrs[k]; });
                    isSaving = false;
                    render();
                }).catch(function (err) {
                    console.error('[SITE] Failed to save alarm settings:', err);
                    isSaving = false;
                    render();
                });
            });
        });
    }

    // ── Utility ───────────────────────────────────────────────

    function esc(str) {
        if (!str) return '';
        return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }

    function timeSince(ts) {
        var diff = Date.now() - ts;
        if (diff < 60000) return 'Just now';
        if (diff < 3600000) return Math.floor(diff / 60000) + ' min ago';
        if (diff < 86400000) return Math.floor(diff / 3600000) + 'h ago';
        return Math.floor(diff / 86400000) + 'd ago';
    }

    // ── Loading State ─────────────────────────────────────────

    function showLoading() {
        container.innerHTML = '<div class="so-loading"><div class="so-spinner"></div><div class="so-loading-text">Loading site data...</div></div>';
    }

    function showError(msg) {
        container.innerHTML = '<div class="so-error">' +
            '<div class="so-error-icon">⚠️</div>' +
            '<div class="so-error-text">' + esc(msg) + '</div>' +
        '</div>';
    }

    // ═══ INIT ═════════════════════════════════════════════════

    siteId = resolveSiteId();
    console.log('[SITE] siteId:', siteId);

    if (!siteId) {
        showError('No site configured. Navigate from Fleet Dashboard or set siteAssetId in widget settings.');
        return;
    }

    showLoading();

    // Initial load: fetch devices + attributes → render → start polling
    Promise.all([fetchDevices(), fetchSiteAttributes()])
        .then(function () {
            return Promise.all([pollAllDevices(), fetchTodayEnergy()]);
        })
        .then(function () {
            render();
            // Start polling
            pollTimer = setInterval(function () {
                Promise.all([pollAllDevices(), fetchTodayEnergy()]).then(function () {
                    if (activeTab === 'devices') render();
                });
            }, POLL_INTERVAL);
        })
        .catch(function (err) {
            console.error('[SITE] Init error:', err);
            showError('Failed to load site data. Check console for details.');
        });
};

// ═══ LIFECYCLE ════════════════════════════════════════════════

self.onDestroy = function () {
    if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
    }
};
