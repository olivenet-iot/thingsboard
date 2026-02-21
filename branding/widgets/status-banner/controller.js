/* =========================================================
   STATUS BANNER WIDGET — controller.js
   ThingsBoard CE Custom Widget (static type)
   
   Polls: dim_value, status_lamp_on, device_type, fault_*/status_* flags, tilt
   Calculates: connection status from last telemetry timestamp
   ========================================================= */

self.onInit = function () {
    'use strict';

    // ── Resolve Device ID ─────────────────────────────────────────
    function resolveDeviceId() {
        // 1. Dashboard state (Fleet navigation, URL params)
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
        return (self.ctx.settings && self.ctx.settings.deviceId) || null;
    }

    console.log('[SB] onInit started');

    var DEVICE_ID = resolveDeviceId();

    console.log('[SB] DEVICE_ID:', DEVICE_ID);

    if (!DEVICE_ID) {
        document.getElementById('sb-device-name').textContent = 'No device configured';
        console.error('[SB] No device ID.');
        return;
    }

    // ── Config ────────────────────────────────────────────────────
    var http = self.ctx.http;
    var POLL_MS = (self.ctx.settings && self.ctx.settings.pollIntervalMs)
        ? self.ctx.settings.pollIntervalMs : 10000;
    var OFFLINE_THRESHOLD_MS = (self.ctx.settings && self.ctx.settings.offlineThresholdMin)
        ? self.ctx.settings.offlineThresholdMin * 60 * 1000 : 60 * 60 * 1000; // default 60 min
    var STALE_THRESHOLD_MS = 10 * 60 * 1000; // 10 min = stale (warning)

    var pollTimer = null;

    // ── Fault / Warning Definitions ────────────────────────────────
    // Keys that indicate a FAULT when true (critical)
    var FAULT_KEYS = [
        // D4i fault summary (Ch4) — only present on D4i devices
        'fault_overall_failure', 'fault_under_voltage', 'fault_over_voltage',
        'fault_power_limit', 'fault_thermal_derating', 'fault_thermal_shutdown',
        'fault_light_src_failure', 'fault_light_src_short_circuit',
        'fault_light_src_thermal_derate', 'fault_light_src_thermal_shutdn',
        // DALI status (Ch3) — present on BOTH D4i and DALI2
        'status_control_gear_failure', 'status_lamp_failure'
    ];

    // Keys that indicate a WARNING when true (attention needed)
    var WARNING_KEYS = [
        'status_limit_error', 'status_reset_state', 'status_missing_short_addr'
    ];

    // Tilt — fault if above threshold
    var TILT_KEY = 'tilt';
    var TILT_THRESHOLD = 10;

    // ── Telemetry keys ────────────────────────────────────────────
    var TELEMETRY_KEYS = ['dim_value', 'status_lamp_on', 'device_type']
        .concat(FAULT_KEYS).concat(WARNING_KEYS).concat([TILT_KEY]).join(',');

    // ── DOM Refs ──────────────────────────────────────────────────
    var elDeviceName   = document.getElementById('sb-device-name');
    var elDeviceType   = document.getElementById('sb-device-type');
    var elDimLabel     = document.getElementById('sb-dim-label');
    var elLampDot      = document.getElementById('sb-lamp-dot');
    var elFaultIcon    = document.getElementById('sb-fault-icon');
    var elIconOk       = document.getElementById('sb-icon-ok');
    var elIconWarn     = document.getElementById('sb-icon-warn');
    var elFaultTitle   = document.getElementById('sb-fault-title');
    var elFaultDetail  = document.getElementById('sb-fault-detail');
    var elFaultZone    = document.getElementById('sb-fault-zone');
    var elConnDot      = document.getElementById('sb-conn-dot');
    var elConnLabel    = document.getElementById('sb-conn-label');
    var elConnTime     = document.getElementById('sb-conn-time');

    // ── Fetch device name from attributes ─────────────────────────
    function fetchDeviceName() {
        // Try device label/name from entity info
        http.get('/api/device/' + DEVICE_ID).toPromise().then(function (device) {
            var name = device.label || device.name || 'Unknown Device';
            elDeviceName.textContent = name;
        }).catch(function () {
            elDeviceName.textContent = 'Device';
        });
    }

    // ── Update Functions ──────────────────────────────────────────

    function updateLamp(isOn, dimVal) {
        // Lamp dot
        elLampDot.classList.remove('is-on', 'is-off');
        elLampDot.classList.add(isOn ? 'is-on' : 'is-off');

        // Dim label
        if (dimVal !== null && dimVal !== undefined) {
            elDimLabel.textContent = 'Dim ' + dimVal + '%';
        } else {
            elDimLabel.textContent = isOn ? 'ON' : 'OFF';
        }
    }

    function updateDeviceType(type) {
        if (type) {
            elDeviceType.textContent = type;
        }
    }

    function updateFaults(telemetryData) {
        var faultCount = 0;
        var warnCount = 0;
        var labels = [];

        // Check fault keys
        FAULT_KEYS.forEach(function (key) {
            var val = getLatestValue(telemetryData, key);
            if (val === 'true' || val === true || val === '1') {
                faultCount++;
                labels.push(formatKeyLabel(key));
            }
        });

        // Check warning keys
        WARNING_KEYS.forEach(function (key) {
            var val = getLatestValue(telemetryData, key);
            if (val === 'true' || val === true || val === '1') {
                warnCount++;
                labels.push(formatKeyLabel(key));
            }
        });

        // Check tilt
        var tiltThreshold = (self.ctx.settings && self.ctx.settings.tiltThreshold)
            ? self.ctx.settings.tiltThreshold : TILT_THRESHOLD;
        var tiltVal = getLatestValue(telemetryData, TILT_KEY);
        if (tiltVal !== null && parseFloat(tiltVal) > tiltThreshold) {
            faultCount++;
            labels.push('Tilt (' + parseFloat(tiltVal).toFixed(1) + '\u00B0)');
        }

        var totalIssues = faultCount + warnCount;

        if (totalIssues === 0) {
            // All OK
            elFaultIcon.className = 'sb-fault-icon is-ok';
            elIconOk.style.display = 'block';
            elIconWarn.style.display = 'none';
            elFaultTitle.textContent = 'All Systems OK';
            elFaultTitle.className = 'sb-fault-title is-ok';
            elFaultDetail.textContent = 'No active faults';
            elFaultZone.style.cursor = 'default';
        } else {
            // Issues detected
            elFaultIcon.className = 'sb-fault-icon is-warn';
            elIconOk.style.display = 'none';
            elIconWarn.style.display = 'block';

            // Title: "X Fault(s), Y Warning(s)" or just faults/warnings
            var titleParts = [];
            if (faultCount > 0) titleParts.push(faultCount + ' Fault' + (faultCount > 1 ? 's' : ''));
            if (warnCount > 0) titleParts.push(warnCount + ' Warning' + (warnCount > 1 ? 's' : ''));
            elFaultTitle.textContent = titleParts.join(', ');
            elFaultTitle.className = 'sb-fault-title is-warn';

            // Detail: first 3 labels + overflow
            var maxShow = 3;
            var shown = labels.slice(0, maxShow).join(' · ');
            if (labels.length > maxShow) {
                shown += ' +' + (labels.length - maxShow) + ' more';
            }
            elFaultDetail.textContent = shown;
        }
    }

    function updateConnection(telemetryData) {
        // Find the most recent timestamp across all telemetry keys
        var latestTs = 0;
        Object.keys(telemetryData).forEach(function (key) {
            var arr = telemetryData[key];
            if (arr && arr.length > 0 && arr[0].ts > latestTs) {
                latestTs = arr[0].ts;
            }
        });

        if (latestTs === 0) {
            elConnDot.className = 'sb-conn-dot is-offline';
            elConnLabel.textContent = 'No Data';
            elConnLabel.className = 'sb-conn-label is-offline';
            elConnTime.textContent = '—';
            return;
        }

        var now = Date.now();
        var ageMs = now - latestTs;

        // Format relative time
        var ageText = formatAge(ageMs);

        if (ageMs > OFFLINE_THRESHOLD_MS) {
            elConnDot.className = 'sb-conn-dot is-offline';
            elConnLabel.textContent = 'Offline';
            elConnLabel.className = 'sb-conn-label is-offline';
        } else if (ageMs > STALE_THRESHOLD_MS) {
            elConnDot.className = 'sb-conn-dot is-stale';
            elConnLabel.textContent = 'Stale';
            elConnLabel.className = 'sb-conn-label is-stale';
        } else {
            elConnDot.className = 'sb-conn-dot is-online';
            elConnLabel.textContent = 'Online';
            elConnLabel.className = 'sb-conn-label is-online';
        }

        elConnTime.textContent = ageText + ' ago';
    }

    // ── Helpers ───────────────────────────────────────────────────

    function getLatestValue(data, key) {
        if (data[key] && data[key].length > 0) {
            return data[key][0].value;
        }
        return null;
    }

    function formatKeyLabel(key) {
        // 'fault_under_voltage' → 'Under Voltage', 'status_control_gear_failure' → 'Control Gear Failure'
        var stripped = key.replace(/^(fault_|status_)/, '');
        return stripped.replace(/_/g, ' ').replace(/\b\w/g, function (c) {
            return c.toUpperCase();
        });
    }

    function formatAge(ms) {
        var sec = Math.floor(ms / 1000);
        if (sec < 60) return sec + 's';
        var min = Math.floor(sec / 60);
        if (min < 60) return min + ' min';
        var hrs = Math.floor(min / 60);
        if (hrs < 24) return hrs + 'h ' + (min % 60) + 'm';
        var days = Math.floor(hrs / 24);
        return days + 'd ' + (hrs % 24) + 'h';
    }

    // ── Poll ──────────────────────────────────────────────────────

    function poll() {
        var url = '/api/plugins/telemetry/DEVICE/' + DEVICE_ID
            + '/values/timeseries?keys=' + TELEMETRY_KEYS;

        http.get(url).toPromise().then(function (data) {
            // Lamp status
            var lampOn = getLatestValue(data, 'status_lamp_on');
            var isOn = (lampOn === 'true' || lampOn === true || lampOn === '1');
            var dimVal = getLatestValue(data, 'dim_value');
            updateLamp(isOn, dimVal !== null ? parseInt(dimVal) : null);

            // Device type
            var devType = getLatestValue(data, 'device_type');
            updateDeviceType(devType);

            // Faults
            updateFaults(data);

            // Connection
            updateConnection(data);

        }).catch(function (err) {
            console.warn('[SB] Poll error:', err);
        });
    }

    // ── Initialize ────────────────────────────────────────────────
    fetchDeviceName();
    poll();
    pollTimer = setInterval(poll, POLL_MS);
    self._sbPollTimer = pollTimer;

    console.log('[SB] Status Banner initialized');
};

self.onDataUpdated = function () {};

self.onDestroy = function () {
    console.log('[SB] onDestroy');
    if (self._sbPollTimer) clearInterval(self._sbPollTimer);
};
