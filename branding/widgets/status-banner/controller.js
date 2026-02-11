/* =========================================================
   STATUS BANNER WIDGET — controller.js
   ThingsBoard CE Custom Widget (static type)
   
   Polls: dim_value, status_lamp_on, device_type, all fault_* flags
   Calculates: connection status from last telemetry timestamp
   ========================================================= */

self.onInit = function () {
    'use strict';

    // ── Resolve Device ID ─────────────────────────────────────────
    var DEVICE_ID = null;
    var ds = self.ctx.datasources;

    console.log('[SB] onInit started');
    console.log('[SB] datasources:', JSON.stringify(ds));

    if (ds && ds.length > 0 && ds[0].entity) {
        DEVICE_ID = ds[0].entity.id;
    }
    if (!DEVICE_ID && self.ctx.settings && self.ctx.settings.deviceId) {
        DEVICE_ID = self.ctx.settings.deviceId;
    }

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
    var tooltipVisible = false;

    // ── Fault Definitions ─────────────────────────────────────────
    var FAULT_MAP = {
        controller: [
            { key: 'fault_overall_failure', label: 'Overall Failure' },
            { key: 'fault_under_voltage', label: 'Under Voltage' },
            { key: 'fault_over_voltage', label: 'Over Voltage' },
            { key: 'fault_power_limit', label: 'Power Limit' }
        ],
        driver: [
            { key: 'fault_thermal_derating', label: 'Thermal Derating' },
            { key: 'fault_thermal_shutdown', label: 'Thermal Shutdown' }
        ],
        lightSrc: [
            { key: 'fault_light_src_failure', label: 'Light Source Failure' },
            { key: 'fault_light_src_short_circuit', label: 'Short Circuit' },
            { key: 'fault_light_src_thermal_derate', label: 'Thermal Derating' },
            { key: 'fault_light_src_thermal_shutdn', label: 'Thermal Shutdown' }
        ]
    };

    var ALL_FAULT_KEYS = [];
    Object.keys(FAULT_MAP).forEach(function (cat) {
        FAULT_MAP[cat].forEach(function (f) {
            ALL_FAULT_KEYS.push(f.key);
        });
    });

    // ── Telemetry keys ────────────────────────────────────────────
    var TELEMETRY_KEYS = ['dim_value', 'status_lamp_on', 'device_type']
        .concat(ALL_FAULT_KEYS).join(',');

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
    var elTooltip      = document.getElementById('sb-fault-tooltip');
    var elConnDot      = document.getElementById('sb-conn-dot');
    var elConnLabel    = document.getElementById('sb-conn-label');
    var elConnTime     = document.getElementById('sb-conn-time');

    // Tooltip lists
    var elTtController     = document.getElementById('sb-tooltip-controller');
    var elTtControllerList = document.getElementById('sb-tooltip-controller-list');
    var elTtDriver         = document.getElementById('sb-tooltip-driver');
    var elTtDriverList     = document.getElementById('sb-tooltip-driver-list');
    var elTtLightsrc       = document.getElementById('sb-tooltip-lightsrc');
    var elTtLightsrcList   = document.getElementById('sb-tooltip-lightsrc-list');

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
        var activeFaults = { controller: [], driver: [], lightSrc: [] };
        var totalFaults = 0;

        Object.keys(FAULT_MAP).forEach(function (cat) {
            FAULT_MAP[cat].forEach(function (f) {
                var val = getLatestValue(telemetryData, f.key);
                if (val === 'true' || val === true || val === '1') {
                    activeFaults[cat].push(f.label);
                    totalFaults++;
                }
            });
        });

        if (totalFaults === 0) {
            // All OK
            elFaultIcon.className = 'sb-fault-icon is-ok';
            elIconOk.style.display = 'block';
            elIconWarn.style.display = 'none';
            elFaultTitle.textContent = 'All Systems OK';
            elFaultTitle.className = 'sb-fault-title is-ok';
            elFaultDetail.textContent = 'No active faults';
            elFaultZone.style.cursor = 'default';
        } else {
            // Faults detected
            elFaultIcon.className = 'sb-fault-icon is-warn';
            elIconOk.style.display = 'none';
            elIconWarn.style.display = 'block';
            elFaultTitle.textContent = totalFaults + ' Fault' + (totalFaults > 1 ? 's' : '') + ' Detected';
            elFaultTitle.className = 'sb-fault-title is-warn';

            // Build detail summary
            var parts = [];
            if (activeFaults.controller.length > 0) parts.push('Controller: ' + activeFaults.controller.length);
            if (activeFaults.driver.length > 0) parts.push('Driver: ' + activeFaults.driver.length);
            if (activeFaults.lightSrc.length > 0) parts.push('Light Src: ' + activeFaults.lightSrc.length);
            elFaultDetail.textContent = parts.join(' · ');
            elFaultZone.style.cursor = 'pointer';
        }

        // Build tooltip content
        buildTooltipSection(elTtController, elTtControllerList, activeFaults.controller);
        buildTooltipSection(elTtDriver, elTtDriverList, activeFaults.driver);
        buildTooltipSection(elTtLightsrc, elTtLightsrcList, activeFaults.lightSrc);

        // Hide tooltip if no faults
        if (totalFaults === 0 && tooltipVisible) {
            elTooltip.style.display = 'none';
            tooltipVisible = false;
        }
    }

    function buildTooltipSection(sectionEl, listEl, faults) {
        if (faults.length === 0) {
            sectionEl.style.display = 'none';
            return;
        }
        sectionEl.style.display = 'block';
        listEl.innerHTML = '';
        faults.forEach(function (label) {
            var li = document.createElement('li');
            li.textContent = label;
            listEl.appendChild(li);
        });
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

    // ── Tooltip toggle ────────────────────────────────────────────
    elFaultZone.addEventListener('click', function () {
        // Only toggle if there are faults
        if (elFaultTitle.classList.contains('is-warn')) {
            tooltipVisible = !tooltipVisible;
            elTooltip.style.display = tooltipVisible ? 'block' : 'none';
        }
    });

    // Close tooltip on outside click
    document.addEventListener('click', function (e) {
        if (tooltipVisible && !elFaultZone.contains(e.target)) {
            tooltipVisible = false;
            elTooltip.style.display = 'none';
        }
    });

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
