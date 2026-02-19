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

    // Schedule tab state
    var siteTasks = [];
    var schedEditingIndex = -1;
    var schedPendingDelete = -1;
    var schedTimeSlotCount = 0;
    var schedTasksLoaded = false;

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

    // ═══ RENDER ═══════════════════════════════════════════════

    function render() {
        var html = '';
        html += renderBanner();
        html += renderTabs();
        if (activeTab === 'devices') {
            html += renderDevicesTab();
        } else if (activeTab === 'schedule') {
            html += renderScheduleTab();
        } else if (activeTab === 'site-info') {
            html += renderSiteInfoTab();
        } else if (activeTab === 'alarms') {
            html += renderAlarmsTab();
        }
        container.innerHTML = html;
        bindEvents();
        if (activeTab === 'schedule') {
            initScheduleTab();
        }
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
                '<div>' +
                    (breadcrumb ? '<div class="so-breadcrumb">' + breadcrumb + '</div>' : '') +
                    '<div class="so-site-name">' + esc(siteName) + '</div>' +
                '</div>' +
            '</div>' +
            '<div class="so-banner-stats">' +
                statBox('Devices', devices.length, '') +
                statBox('Online', online, 'green') +
                (faulted > 0 ? statBox('Faults', faulted, 'red') : '') +
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
            tab('schedule', 'Schedule') +
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
            metaField('latitude', 'Latitude', siteAttrs.latitude || ''),
            metaField('longitude', 'Longitude', siteAttrs.longitude || ''),
            metaField('timezone_offset', 'Timezone Offset (UTC+)', siteAttrs.timezone_offset || ''),
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
                '<span class="so-meta-label">' + label + '</span>' +
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

    // ═══ SCHEDULE TAB ════════════════════════════════════════

    // ── Schedule API helpers ───────────────────────────────────
    // apiPost for SHARED_SCOPE returns empty 200 — handle via responseType:'text'

    function schedApiPost(path, body) {
        var obs = http.post('/api' + path, body, { responseType: 'text' });
        if (obs && typeof obs.toPromise === 'function') {
            return obs.toPromise().then(function (text) {
                if (!text) return {};
                try { return JSON.parse(text); } catch (e) { return {}; }
            });
        }
        return new Promise(function (resolve, reject) {
            obs.subscribe(
                function (data) { resolve(data || {}); },
                function (err) { reject(err); }
            );
        });
    }

    function loadSiteTasks() {
        return apiGet('/plugins/telemetry/ASSET/' + siteId + '/values/attributes/SERVER_SCOPE?keys=tasks_data')
            .then(function (data) {
                siteTasks = [];
                if (data && data.length) {
                    data.forEach(function (attr) {
                        if (attr.key === 'tasks_data') {
                            try {
                                siteTasks = typeof attr.value === 'string' ? JSON.parse(attr.value) : attr.value;
                                if (!Array.isArray(siteTasks)) siteTasks = [];
                            } catch (e) { siteTasks = []; }
                        }
                    });
                }
                schedTasksLoaded = true;
            });
    }

    function saveSiteTasks() {
        return schedApiPost('/plugins/telemetry/ASSET/' + siteId + '/attributes/SERVER_SCOPE', {
            tasks_data: JSON.stringify(siteTasks)
        });
    }

    function deployTaskToAllDevices(cmd) {
        if (devices.length === 0) return Promise.resolve({ succeeded: 0, failed: 0, total: 0 });
        var results = { succeeded: 0, failed: 0, total: devices.length };
        var promises = devices.map(function (dev) {
            return schedApiPost('/plugins/telemetry/DEVICE/' + dev.id + '/attributes/SHARED_SCOPE', {
                task_command: JSON.stringify(cmd)
            }).then(function () {
                results.succeeded++;
            }).catch(function () {
                results.failed++;
            });
        });
        return Promise.all(promises).then(function () { return results; });
    }

    function sendLocationToAllDevices(lat, lng, tz) {
        if (devices.length === 0) return Promise.resolve({ succeeded: 0, failed: 0, total: 0 });
        var cmd = {
            command: 'location_setup',
            latitude: lat,
            longitude: lng,
            timezone: tz
        };
        var results = { succeeded: 0, failed: 0, total: devices.length };
        var promises = devices.map(function (dev) {
            return schedApiPost('/plugins/telemetry/DEVICE/' + dev.id + '/attributes/SHARED_SCOPE', {
                task_command: JSON.stringify(cmd)
            }).then(function () {
                results.succeeded++;
            }).catch(function () {
                results.failed++;
            });
        });
        return Promise.all(promises).then(function () { return results; });
    }

    // ── Location Confirm Popup Helpers ────────────────────────

    function showLocConfirm() {
        var overlay = document.getElementById('so-loc-confirm-overlay');
        if (!overlay) return;
        var resultEl = document.getElementById('so-loc-confirm-result');
        var actionsEl = document.getElementById('so-loc-confirm-actions');
        if (resultEl) { resultEl.style.display = 'none'; resultEl.textContent = ''; resultEl.className = ''; }
        if (actionsEl) {
            actionsEl.innerHTML = '<button class="sched-btn sched-btn-secondary" data-action="loc-confirm-skip">Skip</button>' +
                '<button class="sched-btn sched-btn-primary" data-action="loc-confirm-send">Send Now</button>';
        }
        overlay.style.display = 'flex';
        bindLocConfirmEvents();
    }

    function hideLocConfirm() {
        var overlay = document.getElementById('so-loc-confirm-overlay');
        if (overlay) overlay.style.display = 'none';
    }

    function bindLocConfirmEvents() {
        var overlay = document.getElementById('so-loc-confirm-overlay');
        if (!overlay) return;
        overlay.querySelectorAll('[data-action="loc-confirm-skip"]').forEach(function (el) {
            el.onclick = function () { hideLocConfirm(); };
        });
        overlay.querySelectorAll('[data-action="loc-confirm-send"]').forEach(function (el) {
            el.onclick = function () {
                var lat = parseFloat(siteAttrs.latitude);
                var lng = parseFloat(siteAttrs.longitude);
                var tz  = parseFloat(siteAttrs.timezone_offset);
                el.disabled = true;
                el.textContent = 'Sending\u2026';
                sendLocationToAllDevices(lat, lng, tz)
                    .then(function (results) {
                        var resultEl = document.getElementById('so-loc-confirm-result');
                        var actionsEl = document.getElementById('so-loc-confirm-actions');
                        var ok = results.failed === 0;
                        if (resultEl) {
                            resultEl.className = 'so-loc-confirm-result ' + (ok ? 'so-loc-confirm-result-ok' : 'so-loc-confirm-result-err');
                            resultEl.textContent = 'Sent to ' + results.succeeded + '/' + results.total + ' device(s)' + (ok ? ' \u2713' : ' (' + results.failed + ' failed)');
                            resultEl.style.display = 'block';
                        }
                        if (actionsEl) {
                            actionsEl.innerHTML = '<button class="sched-btn sched-btn-secondary" data-action="loc-confirm-skip">Close</button>';
                            actionsEl.querySelector('[data-action="loc-confirm-skip"]').onclick = function () { hideLocConfirm(); };
                        }
                    })
                    .catch(function (err) {
                        var resultEl = document.getElementById('so-loc-confirm-result');
                        var actionsEl = document.getElementById('so-loc-confirm-actions');
                        if (resultEl) {
                            resultEl.className = 'so-loc-confirm-result so-loc-confirm-result-err';
                            resultEl.textContent = 'Failed: ' + (err.message || err);
                            resultEl.style.display = 'block';
                        }
                        if (actionsEl) {
                            actionsEl.innerHTML = '<button class="sched-btn sched-btn-secondary" data-action="loc-confirm-skip">Close</button>';
                            actionsEl.querySelector('[data-action="loc-confirm-skip"]').onclick = function () { hideLocConfirm(); };
                        }
                    });
            };
        });
    }

    // ── Schedule Utility Functions ─────────────────────────────

    function schedFormatDate(y, m, d) {
        return y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0');
    }

    function schedPadTime(h, m) {
        return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
    }

    function schedPriorityStars(p) {
        var full = 6 - p;
        var out = '';
        for (var i = 0; i < 5; i++) {
            out += i < full
                ? '<span class="sched-star sched-star-full">&#9733;</span>'
                : '<span class="sched-star sched-star-empty">&#9734;</span>';
        }
        return out;
    }

    function schedCyclicLabel(type, interval, mask) {
        switch (type) {
            case 2: return 'Odd Days';
            case 3: return 'Even Days';
            case 4: return 'Every ' + interval + 'd';
            case 5:
                if (mask === 0) return 'Every Day';
                var days = ['Su','Mo','Tu','We','Th','Fr','Sa'];
                var active = [];
                for (var i = 0; i < 7; i++) {
                    if (!(mask & (1 << i))) active.push(days[i]);
                }
                return active.join(', ');
            default: return '?';
        }
    }

    function schedEventEmoji(name) {
        if (name === 'sunrise') return '\u{1F305}';
        if (name === 'sunset') return '\u{1F307}';
        return name;
    }

    function schedSlotSummary(slots) {
        if (!slots || !slots.length) return '--';
        return slots.map(function (s) {
            var onStr = s.on_event
                ? (schedEventEmoji(s.on_event) + (s.on_offset ? (s.on_offset > 0 ? '+' : '') + s.on_offset + 'm' : ''))
                : schedPadTime(s.on_hour || 0, s.on_minute || 0);
            var offStr = s.off_event
                ? (schedEventEmoji(s.off_event) + (s.off_offset ? (s.off_offset > 0 ? '+' : '') + s.off_offset + 'm' : ''))
                : schedPadTime(s.off_hour || 0, s.off_minute || 0);
            return onStr + '\u2192' + offStr + ' ' + (s.dim_value != null ? s.dim_value : 100) + '%';
        }).join(' | ');
    }

    function schedShowLoading(msg) {
        var el = document.getElementById('sched-loading-overlay');
        if (el) {
            el.querySelector('.sched-loading-text').textContent = msg || 'Loading...';
            el.style.display = 'flex';
        }
    }

    function schedHideLoading() {
        var el = document.getElementById('sched-loading-overlay');
        if (el) el.style.display = 'none';
    }

    function schedShowToast(msg, type) {
        var el = document.getElementById('sched-toast');
        if (el) {
            el.textContent = msg;
            el.className = 'sched-toast sched-toast-' + (type || 'info');
            el.style.display = 'block';
            setTimeout(function () { el.style.display = 'none'; }, 4000);
        }
    }

    // ── Schedule Form Helper Functions ─────────────────────────

    function schedHourOptions(selected) {
        var html = '';
        for (var h = 0; h < 24; h++) {
            var val = String(h).padStart(2, '0');
            html += '<option value="' + h + '"' + (h === selected ? ' selected' : '') + '>' + val + '</option>';
        }
        return html;
    }

    function schedMinuteOptions(selected) {
        var html = '';
        for (var m = 0; m < 60; m++) {
            var val = String(m).padStart(2, '0');
            html += '<option value="' + m + '"' + (m === selected ? ' selected' : '') + '>' + val + '</option>';
        }
        return html;
    }

    function schedOffsetOptions(selected) {
        var html = '';
        for (var o = -60; o <= 60; o += 5) {
            var label = (o > 0 ? '+' : '') + o + 'm';
            html += '<option value="' + o + '"' + (o === selected ? ' selected' : '') + '>' + label + '</option>';
        }
        return html;
    }

    function schedCreateTimeSlotHTML(index, slot) {
        slot = slot || {};
        var onEvent = slot.on_event || '';
        var offEvent = slot.off_event || '';
        var onHour = slot.on_hour != null ? slot.on_hour : 18;
        var onMin = slot.on_minute != null ? slot.on_minute : 0;
        var offHour = slot.off_hour != null ? slot.off_hour : 6;
        var offMin = slot.off_minute != null ? slot.off_minute : 0;
        var onOffset = slot.on_offset || 0;
        var offOffset = slot.off_offset || 0;
        var dim = slot.dim_value != null ? slot.dim_value : 100;

        var onOffsetSnapped = Math.round(onOffset / 5) * 5;
        var offOffsetSnapped = Math.round(offOffset / 5) * 5;

        var onType = onEvent ? onEvent : 'fixed';
        var offType = offEvent ? offEvent : 'fixed';

        return '<div class="sched-timeslot-card" id="sched-slot-' + index + '">'
          + '<div class="sched-timeslot-header">'
          + '  <span class="sched-timeslot-label">Slot ' + (index + 1) + '</span>'
          + '  <button class="sched-btn-icon sched-btn-remove" onclick="SCHED.removeTimeSlot(' + index + ')" title="Remove slot">'
          + '    <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>'
          + '  </button>'
          + '</div>'
          + '<div class="sched-timeslot-body">'
          + '  <div class="sched-slot-row-onoff">'
          + '    <span class="sched-slot-direction-label sched-slot-direction-label-on">ON</span>'
          + '    <div class="sched-slot-group-narrow">'
          + '      <select class="sched-input sched-input-sm sched-slot-on-type" data-slot="' + index + '" onchange="SCHED.onSlotTypeChange(' + index + ', \'on\')">'
          + '        <option value="fixed"' + (onType === 'fixed' ? ' selected' : '') + '>Fixed</option>'
          + '        <option value="sunrise"' + (onType === 'sunrise' ? ' selected' : '') + '>Sunrise</option>'
          + '        <option value="sunset"' + (onType === 'sunset' ? ' selected' : '') + '>Sunset</option>'
          + '      </select>'
          + '    </div>'
          + '    <div class="sched-slot-group-narrow sched-slot-on-time-group" data-slot="' + index + '" style="' + (onType !== 'fixed' ? 'display:none' : '') + '">'
          + '      <div class="sched-time-select-group">'
          + '        <select class="sched-input sched-input-sm sched-slot-on-hour" data-slot="' + index + '">' + schedHourOptions(onHour) + '</select>'
          + '        <span class="sched-time-colon">:</span>'
          + '        <select class="sched-input sched-input-sm sched-slot-on-minute" data-slot="' + index + '">' + schedMinuteOptions(onMin) + '</select>'
          + '      </div>'
          + '    </div>'
          + '    <div class="sched-slot-group-narrow sched-slot-on-offset-group" data-slot="' + index + '" style="' + (onType === 'fixed' ? 'display:none' : '') + '">'
          + '      <select class="sched-input sched-input-sm sched-slot-on-offset sched-offset-select" data-slot="' + index + '">' + schedOffsetOptions(onOffsetSnapped) + '</select>'
          + '    </div>'
          + '    <span class="sched-slot-arrow">&rarr;</span>'
          + '    <span class="sched-slot-direction-label sched-slot-direction-label-off">OFF</span>'
          + '    <div class="sched-slot-group-narrow">'
          + '      <select class="sched-input sched-input-sm sched-slot-off-type" data-slot="' + index + '" onchange="SCHED.onSlotTypeChange(' + index + ', \'off\')">'
          + '        <option value="fixed"' + (offType === 'fixed' ? ' selected' : '') + '>Fixed</option>'
          + '        <option value="sunrise"' + (offType === 'sunrise' ? ' selected' : '') + '>Sunrise</option>'
          + '        <option value="sunset"' + (offType === 'sunset' ? ' selected' : '') + '>Sunset</option>'
          + '      </select>'
          + '    </div>'
          + '    <div class="sched-slot-group-narrow sched-slot-off-time-group" data-slot="' + index + '" style="' + (offType !== 'fixed' ? 'display:none' : '') + '">'
          + '      <div class="sched-time-select-group">'
          + '        <select class="sched-input sched-input-sm sched-slot-off-hour" data-slot="' + index + '">' + schedHourOptions(offHour) + '</select>'
          + '        <span class="sched-time-colon">:</span>'
          + '        <select class="sched-input sched-input-sm sched-slot-off-minute" data-slot="' + index + '">' + schedMinuteOptions(offMin) + '</select>'
          + '      </div>'
          + '    </div>'
          + '    <div class="sched-slot-group-narrow sched-slot-off-offset-group" data-slot="' + index + '" style="' + (offType === 'fixed' ? 'display:none' : '') + '">'
          + '      <select class="sched-input sched-input-sm sched-slot-off-offset sched-offset-select" data-slot="' + index + '">' + schedOffsetOptions(offOffsetSnapped) + '</select>'
          + '    </div>'
          + '  </div>'
          + '  <div class="sched-slot-row-dim">'
          + '    <span class="sched-slot-dim-label">Dim</span>'
          + '    <input type="range" class="sched-slider-dim" data-slot="' + index + '" min="0" max="100" value="' + dim + '" oninput="document.getElementById(\'sched-dim-val-' + index + '\').textContent=this.value+\'%\'" style="flex:1">'
          + '    <span class="sched-dim-val" id="sched-dim-val-' + index + '">' + dim + '%</span>'
          + '  </div>'
          + '</div>'
          + '</div>';
    }

    function schedRenderTimeSlots(slots) {
        slots = slots || [{}];
        schedTimeSlotCount = slots.length;
        var el = document.getElementById('sched-timeslots-container');
        if (!el) return;
        var html = '';
        slots.forEach(function (s, i) {
            html += schedCreateTimeSlotHTML(i, s);
        });
        el.innerHTML = html;
        schedUpdateAddSlotButton();
    }

    function schedUpdateAddSlotButton() {
        var btn = document.getElementById('sched-add-slot-btn');
        if (btn) {
            btn.disabled = schedTimeSlotCount >= 4;
            btn.textContent = schedTimeSlotCount >= 4 ? 'Max 4 Slots' : '+ Add Slot';
        }
    }

    function schedGatherTimeSlots() {
        var slots = [];
        for (var i = 0; i < schedTimeSlotCount; i++) {
            var card = document.getElementById('sched-slot-' + i);
            if (!card) continue;

            var onType = card.querySelector('.sched-slot-on-type').value;
            var offType = card.querySelector('.sched-slot-off-type').value;
            var slot = {};

            if (onType === 'fixed') {
                slot.on_hour = parseInt(card.querySelector('.sched-slot-on-hour').value) || 0;
                slot.on_minute = parseInt(card.querySelector('.sched-slot-on-minute').value) || 0;
                slot.on_offset = 0;
            } else {
                slot.on_event = onType;
                slot.on_hour = 0;
                slot.on_minute = 0;
                slot.on_offset = parseInt(card.querySelector('.sched-slot-on-offset').value) || 0;
            }

            if (offType === 'fixed') {
                slot.off_hour = parseInt(card.querySelector('.sched-slot-off-hour').value) || 0;
                slot.off_minute = parseInt(card.querySelector('.sched-slot-off-minute').value) || 0;
                slot.off_offset = 0;
            } else {
                slot.off_event = offType;
                slot.off_hour = 0;
                slot.off_minute = 0;
                slot.off_offset = parseInt(card.querySelector('.sched-slot-off-offset').value) || 0;
            }

            slot.dim_value = parseInt(card.querySelector('.sched-slider-dim').value) || 0;
            slots.push(slot);
        }
        return slots;
    }

    function schedGatherOffDaysMask() {
        var mask = 0;
        var checks = document.querySelectorAll('#sched-off-days-group input[type=checkbox]');
        checks.forEach(function (cb) {
            var day = parseInt(cb.getAttribute('data-day'));
            if (!cb.checked) {
                mask |= (1 << day);
            }
        });
        return mask;
    }

    function schedSetOffDaysFromMask(mask) {
        var checks = document.querySelectorAll('#sched-off-days-group input[type=checkbox]');
        checks.forEach(function (cb) {
            var day = parseInt(cb.getAttribute('data-day'));
            cb.checked = !(mask & (1 << day));
        });
    }

    function schedBuildTaskCommand(opType) {
        var profileId = parseInt(document.getElementById('sched-f-profile-id').value) || 1;
        var startDate = document.getElementById('sched-f-start-date').value;
        var endForever = document.getElementById('sched-f-end-forever').checked;
        var endDate = document.getElementById('sched-f-end-date').value;
        var priority = parseInt(document.getElementById('sched-f-priority').value) || 3;
        var cyclicType = parseInt(document.getElementById('sched-f-cyclic-type').value) || 5;
        var cyclicTime = parseInt(document.getElementById('sched-f-cyclic-time').value) || 0;
        var channel = parseInt(document.getElementById('sched-f-channel').value) || 1;

        if (!startDate) {
            schedShowToast('Start date is required', 'error');
            return null;
        }

        var sp = startDate.split('-');
        var cmd = {
            command: 'send_task',
            operation_type: opType,
            profile_id: profileId,
            start_year: parseInt(sp[0]),
            start_month: parseInt(sp[1]),
            start_day: parseInt(sp[2]),
            priority: priority,
            cyclic_type: cyclicType,
            cyclic_time: cyclicType === 4 ? cyclicTime : 0,
            off_days_mask: cyclicType === 5 ? schedGatherOffDaysMask() : 0,
            channel_number: channel,
            time_slots: schedGatherTimeSlots()
        };

        if (endForever) {
            cmd.end_forever = true;
        } else {
            if (!endDate) {
                schedShowToast('End date is required when "Forever" is unchecked', 'error');
                return null;
            }
            var ep = endDate.split('-');
            cmd.end_forever = false;
            cmd.end_year = parseInt(ep[0]);
            cmd.end_month = parseInt(ep[1]);
            cmd.end_day = parseInt(ep[2]);
        }

        if (!cmd.time_slots.length) {
            schedShowToast('At least one time slot is required', 'error');
            return null;
        }

        return cmd;
    }

    function schedTaskFromCommand(cmd) {
        var t = {
            profile_id: cmd.profile_id,
            start_year: cmd.start_year,
            start_month: cmd.start_month,
            start_day: cmd.start_day,
            end_forever: cmd.end_forever,
            priority: cmd.priority,
            cyclic_type: cmd.cyclic_type,
            cyclic_time: cmd.cyclic_time,
            off_days_mask: cmd.off_days_mask,
            channel_number: cmd.channel_number,
            time_slots: cmd.time_slots,
            _status: 'deployed',
            _deployed_at: new Date().toISOString()
        };
        if (!cmd.end_forever) {
            t.end_year = cmd.end_year;
            t.end_month = cmd.end_month;
            t.end_day = cmd.end_day;
        }
        return t;
    }

    // ── Schedule Rendering Functions ───────────────────────────

    function renderScheduleTab() {
        var html = '';

        // Header
        html += '<div class="sched-header">'
          + '<div class="sched-header-left">'
          + '  <svg class="sched-header-icon" viewBox="0 0 24 24" fill="currentColor"><path d="M9 21c0 .55.45 1 1 1h4c.55 0 1-.45 1-1v-1H9v1zm3-19C8.14 2 5 5.14 5 9c0 2.38 1.19 4.47 3 5.74V17c0 .55.45 1 1 1h6c.55 0 1-.45 1-1v-2.26c1.81-1.27 3-3.36 3-5.74 0-3.86-3.14-7-7-7zm2.85 11.1l-.85.6V16h-4v-2.3l-.85-.6A4.997 4.997 0 0 1 7 9c0-2.76 2.24-5 5-5s5 2.24 5 5c0 1.63-.8 3.16-2.15 4.1z"/></svg>'
          + '  <h1 class="sched-header-title">Site Schedule</h1>'
          + '</div>'
          + '<div class="sched-header-actions">'
          + '  <button class="sched-btn sched-btn-primary" onclick="SCHED.showNewTask()">'
          + '    <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>'
          + '    New Task'
          + '  </button>'
          + '</div>'
          + '</div>';

        // Task table section
        html += '<div class="sched-section">'
          + '<div class="sched-table-wrap">'
          + '  <table class="sched-task-table" id="sched-task-table" style="display:none;">'
          + '    <thead><tr>'
          + '      <th>#</th><th>Profile ID</th><th>Priority</th>'
          + '      <th>Date Range</th><th>Schedule</th><th>Cyclic</th>'
          + '      <th>Status</th><th>Actions</th>'
          + '    </tr></thead>'
          + '    <tbody id="sched-task-table-body"></tbody>'
          + '  </table>'
          + '  <div id="sched-empty-state" class="sched-empty-state" style="display:none;">'
          + '    <svg viewBox="0 0 24 24" fill="currentColor" width="48" height="48"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V5h14v14zM7 10h2v7H7zm4-3h2v10h-2zm4 6h2v4h-2z"/></svg>'
          + '    <p>No tasks deployed.</p>'
          + '    <p class="sched-empty-hint">Click <strong>+ New Task</strong> to create your first site schedule.</p>'
          + '  </div>'
          + '</div>'
          + '</div>';

        // Timeline section
        html += '<div class="sched-section">'
          + '<div class="sched-section-label">24-Hour Timeline</div>'
          + '<div class="sched-timeline-container">'
          + '  <svg id="sched-timeline-svg" width="100%" height="120" viewBox="0 0 960 120" preserveAspectRatio="xMidYMid meet"></svg>'
          + '</div>'
          + '<div id="sched-timeline-empty" class="sched-timeline-empty" style="display:none;">No time slots to display.</div>'
          + '</div>';

        // Status bar
        html += '<div class="sched-section sched-status-section">'
          + '<div class="sched-status-bar">'
          + '  <div class="sched-status-item">'
          + '    <span class="sched-status-label">Devices linked:</span>'
          + '    <span class="sched-status-value">' + devices.length + '</span>'
          + '  </div>'
          + '  <div class="sched-status-item sched-status-refresh">'
          + '    <span id="sched-last-refresh" class="sched-status-hint"></span>'
          + '    <button class="sched-btn sched-btn-small sched-btn-action" onclick="SCHED.refreshStatus()">Refresh</button>'
          + '  </div>'
          + '</div>'
          + '</div>';

        return html;
    }

    function initScheduleTab() {
        if (!schedTasksLoaded) {
            schedShowLoading('Loading tasks...');
            loadSiteTasks().then(function () {
                schedHideLoading();
                schedRenderTable();
                schedRenderTimeline();
                var el = document.getElementById('sched-last-refresh');
                if (el) el.textContent = 'Updated: ' + new Date().toLocaleTimeString();
            }).catch(function (err) {
                schedHideLoading();
                schedShowToast('Failed to load tasks: ' + (err.message || err), 'error');
            });
        } else {
            schedRenderTable();
            schedRenderTimeline();
        }
    }

    function schedRenderTable() {
        var tbody = document.getElementById('sched-task-table-body');
        var emptyEl = document.getElementById('sched-empty-state');
        var tableEl = document.getElementById('sched-task-table');
        if (!tbody || !emptyEl || !tableEl) return;

        if (!siteTasks.length) {
            tbody.innerHTML = '';
            tableEl.style.display = 'none';
            emptyEl.style.display = 'flex';
            return;
        }

        tableEl.style.display = 'table';
        emptyEl.style.display = 'none';

        var html = '';
        siteTasks.forEach(function (t, idx) {
            var dateRange = schedFormatDate(t.start_year, t.start_month, t.start_day);
            dateRange += t.end_forever ? ' \u2192 Forever' : ' \u2192 ' + schedFormatDate(t.end_year, t.end_month, t.end_day);

            var statusClass = t._status === 'deployed' ? 'sched-badge-success'
                : t._status === 'pending' ? 'sched-badge-warning'
                : t._status === 'error' ? 'sched-badge-error'
                : 'sched-badge-default';
            var statusText = t._status || 'saved';

            html += '<tr>'
              + '<td>' + (idx + 1) + '</td>'
              + '<td><span class="sched-profile-badge">' + t.profile_id + '</span></td>'
              + '<td>' + schedPriorityStars(t.priority) + '</td>'
              + '<td class="sched-date-cell">' + dateRange + '</td>'
              + '<td class="sched-schedule-cell">' + schedSlotSummary(t.time_slots) + '</td>'
              + '<td>' + schedCyclicLabel(t.cyclic_type, t.cyclic_time, t.off_days_mask) + '</td>'
              + '<td><span class="sched-badge ' + statusClass + '">' + statusText + '</span></td>'
              + '<td class="sched-actions-cell">'
              + '  <button class="sched-btn sched-btn-small sched-btn-action" onclick="SCHED.editTask(' + idx + ')" title="Edit">'
              + '    <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a.996.996 0 0 0 0-1.41l-2.34-2.34a.996.996 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>'
              + '  </button>'
              + '  <button class="sched-btn sched-btn-small sched-btn-danger-outline" onclick="SCHED.requestDelete(' + idx + ')" title="Delete">'
              + '    <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>'
              + '  </button>'
              + '</td>'
              + '</tr>';
        });
        tbody.innerHTML = html;
    }

    function schedRenderTimeline() {
        var svg = document.getElementById('sched-timeline-svg');
        var emptyEl = document.getElementById('sched-timeline-empty');
        if (!svg || !emptyEl) return;

        var allSlots = [];
        siteTasks.forEach(function (t, ti) {
            if (t.time_slots) {
                t.time_slots.forEach(function (s, si) {
                    allSlots.push({ task: ti, slot: si, data: s, profileId: t.profile_id });
                });
            }
        });

        if (!allSlots.length) {
            svg.style.display = 'none';
            emptyEl.style.display = 'block';
            return;
        }

        svg.style.display = 'block';
        emptyEl.style.display = 'none';

        var W = 960, H = 120;
        var margin = { left: 40, right: 20, top: 10, bottom: 30 };
        var plotW = W - margin.left - margin.right;
        var plotH = H - margin.top - margin.bottom;
        var barH = Math.min(20, Math.floor(plotH / (allSlots.length + 1)));

        var parts = [];
        var neededH = margin.top + 14 + allSlots.length * (barH + 4) + margin.bottom + 10;
        var actualH = Math.max(H, neededH);

        parts.push('<rect x="0" y="0" width="' + W + '" height="' + actualH + '" fill="#f8fafc" rx="4"/>');

        for (var h = 0; h <= 24; h += 2) {
            var x = margin.left + (h / 24) * plotW;
            parts.push('<line x1="' + x + '" y1="' + margin.top + '" x2="' + x + '" y2="' + (actualH - margin.bottom) + '" stroke="#e2e8f0" stroke-width="0.5"/>');
            parts.push('<text x="' + x + '" y="' + (actualH - 8) + '" fill="#94a3b8" font-size="10" text-anchor="middle">' + String(h).padStart(2, '0') + ':00</text>');
        }

        var sunriseX = margin.left + (6.5 / 24) * plotW;
        var sunsetX = margin.left + (18 / 24) * plotW;
        parts.push('<line x1="' + sunriseX + '" y1="' + margin.top + '" x2="' + sunriseX + '" y2="' + (actualH - margin.bottom) + '" stroke="#f59e0b" stroke-width="1" stroke-dasharray="4,3"/>');
        parts.push('<text x="' + (sunriseX + 3) + '" y="' + (margin.top + 10) + '" fill="#d97706" font-size="9" font-weight="600">Sunrise</text>');
        parts.push('<line x1="' + sunsetX + '" y1="' + margin.top + '" x2="' + sunsetX + '" y2="' + (actualH - margin.bottom) + '" stroke="#ea580c" stroke-width="1" stroke-dasharray="4,3"/>');
        parts.push('<text x="' + (sunsetX + 3) + '" y="' + (margin.top + 10) + '" fill="#ea580c" font-size="9" font-weight="600">Sunset</text>');

        var colors = ['#d97706', '#2563eb', '#059669', '#dc2626', '#7c3aed', '#0891b2', '#db2777', '#65a30d'];

        allSlots.forEach(function (slot, i) {
            var s = slot.data;
            var onHour, offHour;

            if (s.on_event === 'sunrise') { onHour = 6.5 + (s.on_offset || 0) / 60; }
            else if (s.on_event === 'sunset') { onHour = 18 + (s.on_offset || 0) / 60; }
            else { onHour = (s.on_hour || 0) + (s.on_minute || 0) / 60; }

            if (s.off_event === 'sunrise') { offHour = 6.5 + (s.off_offset || 0) / 60; }
            else if (s.off_event === 'sunset') { offHour = 18 + (s.off_offset || 0) / 60; }
            else { offHour = (s.off_hour || 0) + (s.off_minute || 0) / 60; }

            var dim = s.dim_value != null ? s.dim_value : 100;
            var opacity = Math.max(0.3, dim / 100);
            var color = colors[slot.task % colors.length];
            var y = margin.top + 14 + i * (barH + 4);

            if (offHour > onHour) {
                var x1 = margin.left + (onHour / 24) * plotW;
                var w = ((offHour - onHour) / 24) * plotW;
                parts.push('<rect x="' + x1 + '" y="' + y + '" width="' + w + '" height="' + barH + '" fill="' + color + '" opacity="' + opacity + '" rx="3"/>');
                parts.push('<text x="' + (x1 + w / 2) + '" y="' + (y + barH / 2 + 4) + '" fill="#fff" font-size="9" text-anchor="middle" font-weight="bold">' + dim + '%</text>');
            } else if (offHour < onHour) {
                var x1a = margin.left + (onHour / 24) * plotW;
                var w1 = ((24 - onHour) / 24) * plotW;
                parts.push('<rect x="' + x1a + '" y="' + y + '" width="' + w1 + '" height="' + barH + '" fill="' + color + '" opacity="' + opacity + '" rx="3"/>');
                var w2 = (offHour / 24) * plotW;
                parts.push('<rect x="' + margin.left + '" y="' + y + '" width="' + w2 + '" height="' + barH + '" fill="' + color + '" opacity="' + opacity + '" rx="3"/>');
                parts.push('<text x="' + (x1a + w1 / 2) + '" y="' + (y + barH / 2 + 4) + '" fill="#fff" font-size="9" text-anchor="middle" font-weight="bold">' + dim + '%</text>');
            }

            parts.push('<text x="' + (margin.left - 5) + '" y="' + (y + barH / 2 + 4) + '" fill="#64748b" font-size="9" text-anchor="end" font-weight="600">P' + slot.profileId + '</text>');
        });

        svg.innerHTML = parts.join('\n');
        svg.setAttribute('height', actualH);
        svg.setAttribute('viewBox', '0 0 ' + W + ' ' + actualH);
    }

    // ── window.SCHED Public API ────────────────────────────────

    window.SCHED = {
        showNewTask: function () {
            schedEditingIndex = -1;
            document.getElementById('sched-form-title').textContent = 'New Task';
            document.getElementById('sched-deploy-btn').textContent = 'Deploy to All Devices';

            document.getElementById('sched-f-profile-id').value = siteTasks.length ? Math.max.apply(null, siteTasks.map(function (t) { return t.profile_id; })) + 1 : 1;
            document.getElementById('sched-f-priority').value = '3';
            document.getElementById('sched-f-channel').value = '1';
            document.getElementById('sched-f-start-date').value = new Date().toISOString().split('T')[0];
            document.getElementById('sched-f-end-forever').checked = true;
            document.getElementById('sched-f-end-date').disabled = true;
            document.getElementById('sched-f-cyclic-type').value = '5';
            document.getElementById('sched-f-cyclic-time').value = '7';

            schedSetOffDaysFromMask(0);
            SCHED.onCyclicTypeChange();
            schedRenderTimeSlots([{}]);

            document.getElementById('sched-task-form-overlay').style.display = 'flex';
        },

        editTask: function (idx) {
            schedEditingIndex = idx;
            var t = siteTasks[idx];

            document.getElementById('sched-form-title').textContent = 'Edit Task (Profile ' + t.profile_id + ')';
            document.getElementById('sched-deploy-btn').textContent = 'Update & Deploy to All';

            document.getElementById('sched-f-profile-id').value = t.profile_id;
            document.getElementById('sched-f-priority').value = t.priority;
            document.getElementById('sched-f-channel').value = t.channel_number || 1;
            document.getElementById('sched-f-start-date').value = schedFormatDate(t.start_year, t.start_month, t.start_day);
            document.getElementById('sched-f-end-forever').checked = !!t.end_forever;

            if (!t.end_forever && t.end_year) {
                document.getElementById('sched-f-end-date').value = schedFormatDate(t.end_year, t.end_month, t.end_day);
                document.getElementById('sched-f-end-date').disabled = false;
            } else {
                document.getElementById('sched-f-end-date').value = '';
                document.getElementById('sched-f-end-date').disabled = true;
            }

            document.getElementById('sched-f-cyclic-type').value = t.cyclic_type || 5;
            document.getElementById('sched-f-cyclic-time').value = t.cyclic_time || 7;
            schedSetOffDaysFromMask(t.off_days_mask || 0);
            SCHED.onCyclicTypeChange();
            schedRenderTimeSlots(t.time_slots && t.time_slots.length ? t.time_slots : [{}]);

            document.getElementById('sched-task-form-overlay').style.display = 'flex';
        },

        hideTaskForm: function () {
            document.getElementById('sched-task-form-overlay').style.display = 'none';
        },

        toggleEndForever: function () {
            var checked = document.getElementById('sched-f-end-forever').checked;
            document.getElementById('sched-f-end-date').disabled = checked;
        },

        onCyclicTypeChange: function () {
            var val = document.getElementById('sched-f-cyclic-type').value;
            document.getElementById('sched-cyclic-interval-group').style.display = val === '4' ? '' : 'none';
            document.getElementById('sched-off-days-group').style.display = val === '5' ? '' : 'none';
        },

        onSlotTypeChange: function (index, direction) {
            var card = document.getElementById('sched-slot-' + index);
            if (!card) return;
            var type = card.querySelector('.sched-slot-' + direction + '-type').value;
            var timeGroup = card.querySelector('.sched-slot-' + direction + '-time-group[data-slot="' + index + '"]');
            var offsetGroup = card.querySelector('.sched-slot-' + direction + '-offset-group[data-slot="' + index + '"]');
            if (timeGroup) timeGroup.style.display = type === 'fixed' ? '' : 'none';
            if (offsetGroup) offsetGroup.style.display = type === 'fixed' ? 'none' : '';
        },

        addTimeSlot: function () {
            if (schedTimeSlotCount >= 4) return;
            var el = document.getElementById('sched-timeslots-container');
            if (el) {
                el.insertAdjacentHTML('beforeend', schedCreateTimeSlotHTML(schedTimeSlotCount, {}));
                schedTimeSlotCount++;
                schedUpdateAddSlotButton();
            }
        },

        removeTimeSlot: function (index) {
            var currentSlots = schedGatherTimeSlots();
            currentSlots.splice(index, 1);
            if (currentSlots.length === 0) currentSlots.push({});
            schedRenderTimeSlots(currentSlots);
        },

        deployTask: function () {
            try {
                var opType = schedEditingIndex >= 0 ? 2 : 1;
                var cmd = schedBuildTaskCommand(opType);
                if (!cmd) return;

                schedShowLoading('Deploying task to ' + devices.length + ' device(s)...');

                deployTaskToAllDevices(cmd)
                    .then(function (results) {
                        var taskObj = schedTaskFromCommand(cmd);

                        if (schedEditingIndex >= 0) {
                            siteTasks[schedEditingIndex] = taskObj;
                        } else {
                            siteTasks.push(taskObj);
                        }

                        return saveSiteTasks().then(function () { return results; });
                    })
                    .then(function (results) {
                        schedHideLoading();
                        var msg = 'Task deployed to ' + results.succeeded + '/' + results.total + ' devices';
                        if (results.failed > 0) msg += ' (' + results.failed + ' failed)';
                        schedShowToast(msg, results.failed > 0 ? 'error' : 'success');
                        SCHED.hideTaskForm();
                        schedRenderTable();
                        schedRenderTimeline();
                    })
                    .catch(function (err) {
                        schedHideLoading();
                        console.error('[SITE] Deploy failed:', err);
                        schedShowToast('Deploy failed: ' + (err.message || err), 'error');
                    });
            } catch (e) {
                schedHideLoading();
                console.error('[SITE] Deploy error (sync):', e);
                schedShowToast('Deploy error: ' + e.message, 'error');
            }
        },

        requestDelete: function (idx) {
            schedPendingDelete = idx;
            var t = siteTasks[idx];
            document.getElementById('sched-confirm-message').textContent =
                'Delete task profile ' + t.profile_id + ' (Priority ' + t.priority + ')? This will send a delete command to all ' + devices.length + ' device(s).';
            document.getElementById('sched-confirm-overlay').style.display = 'flex';
        },

        hideConfirm: function () {
            document.getElementById('sched-confirm-overlay').style.display = 'none';
            schedPendingDelete = -1;
        },

        confirmDelete: function () {
            try {
                var idx = schedPendingDelete;
                if (idx < 0 || idx >= siteTasks.length) return;

                var t = siteTasks[idx];
                SCHED.hideConfirm();
                schedShowLoading('Deleting task from ' + devices.length + ' device(s)...');

                var cmd = {
                    command: 'send_task',
                    operation_type: 3,
                    profile_id: t.profile_id,
                    start_year: t.start_year,
                    start_month: t.start_month,
                    start_day: t.start_day,
                    end_forever: true,
                    priority: t.priority,
                    cyclic_type: t.cyclic_type || 5,
                    cyclic_time: t.cyclic_time || 0,
                    off_days_mask: t.off_days_mask || 0,
                    channel_number: t.channel_number || 1,
                    time_slots: t.time_slots || []
                };

                deployTaskToAllDevices(cmd)
                    .then(function (results) {
                        siteTasks.splice(idx, 1);
                        return saveSiteTasks().then(function () { return results; });
                    })
                    .then(function (results) {
                        schedHideLoading();
                        var msg = 'Task deleted from ' + results.succeeded + '/' + results.total + ' devices';
                        schedShowToast(msg, results.failed > 0 ? 'error' : 'success');
                        schedRenderTable();
                        schedRenderTimeline();
                    })
                    .catch(function (err) {
                        schedHideLoading();
                        console.error('[SITE] Delete failed:', err);
                        schedShowToast('Delete failed: ' + (err.message || err), 'error');
                    });
            } catch (e) {
                schedHideLoading();
                console.error('[SITE] Delete error (sync):', e);
                schedShowToast('Delete error: ' + e.message, 'error');
            }
        },

        refreshStatus: function () {
            schedTasksLoaded = false;
            if (activeTab === 'schedule') {
                initScheduleTab();
            }
        }
    };

    // Ensure overlays position correctly
    $root.style.position = 'relative';

    // ── Event Binding ─────────────────────────────────────────

    function bindEvents() {
        // Tab clicks
        container.querySelectorAll('[data-tab]').forEach(function (btn) {
            btn.addEventListener('click', function () {
                activeTab = btn.getAttribute('data-tab');
                render();
            });
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
                    // Snapshot old location values before save
                    var oldLat = siteAttrs.latitude || '';
                    var oldLng = siteAttrs.longitude || '';
                    var oldTz  = siteAttrs.timezone_offset || '';

                    // Save
                    var inputs = container.querySelectorAll('[data-attr]');
                    var attrs = {};
                    inputs.forEach(function (inp) {
                        var key = inp.getAttribute('data-attr');
                        attrs[key] = inp.value || '';
                    });
                    // Propagate co2_per_kwh to all child devices (rule chain reads this)
                    if (attrs.co2_per_kwh !== undefined && attrs.co2_per_kwh !== '') {
                        var co2Val = parseFloat(attrs.co2_per_kwh);
                        if (!isNaN(co2Val)) {
                            devices.forEach(function (dev) {
                                apiPost(
                                    '/plugins/telemetry/DEVICE/' + dev.id + '/attributes/SERVER_SCOPE',
                                    { co2_per_kwh: co2Val }
                                ).catch(function (err) {
                                    console.warn('[SITE] co2_per_kwh propagate failed for ' + dev.id, err);
                                });
                            });
                        }
                    }
                    saveSiteAttributes(attrs).then(function () {
                        Object.keys(attrs).forEach(function (k) { siteAttrs[k] = attrs[k]; });
                        isEditing = false;
                        render();

                        // Check if location fields changed
                        var locChanged = (attrs.latitude !== oldLat) || (attrs.longitude !== oldLng) || (attrs.timezone_offset !== oldTz);
                        var locValid = !isNaN(parseFloat(attrs.latitude)) && !isNaN(parseFloat(attrs.longitude)) && !isNaN(parseFloat(attrs.timezone_offset));
                        if (locChanged && locValid && devices.length > 0) {
                            showLocConfirm();
                        }
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
                var attrs = {};
                container.querySelectorAll('[data-alarm-toggle]').forEach(function (cb) {
                    attrs[cb.getAttribute('data-alarm-toggle')] = cb.checked ? 'true' : 'false';
                });
                container.querySelectorAll('[data-alarm]').forEach(function (inp) {
                    attrs[inp.getAttribute('data-alarm')] = inp.value || '';
                });
                isSaving = true;
                render();
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

        // Prevent scroll jump when focusing inputs in edit mode
        container.querySelectorAll('.so-meta-input, .so-meta-textarea').forEach(function (inp) {
            inp.addEventListener('mousedown', function (e) {
                if (document.activeElement === inp) return; // already focused, let normal click work
                e.preventDefault();
                inp.focus({ preventScroll: true });
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
    delete window.SCHED;
};
