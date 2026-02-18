// ═══════════════════════════════════════════════
// SignConnect — Fault Status Widget Controller
// ═══════════════════════════════════════════════

var FAULT_KEYS = [
    { key: 'fault_overall_failure',           rowId: 'row-fault_overall_failure',           label: 'Overall Failure' },
    { key: 'fault_under_voltage',             rowId: 'row-fault_under_voltage',             label: 'Under Voltage' },
    { key: 'fault_over_voltage',              rowId: 'row-fault_over_voltage',              label: 'Over Voltage' },
    { key: 'fault_power_limit',               rowId: 'row-fault_power_limit',               label: 'Power Limit' },
    { key: 'fault_thermal_derating',          rowId: 'row-fault_thermal_derating',          label: 'Thermal Derating' },
    { key: 'fault_thermal_shutdown',          rowId: 'row-fault_thermal_shutdown',          label: 'Thermal Shutdown' },
    { key: 'fault_light_src_failure',         rowId: 'row-fault_light_src_failure',         label: 'Light Src Failure' },
    { key: 'fault_light_src_short_circuit',   rowId: 'row-fault_light_src_short_circuit',   label: 'Short Circuit' },
    { key: 'fault_light_src_thermal_derate',  rowId: 'row-fault_light_src_thermal_derate',  label: 'Light Src Derating' },
    { key: 'fault_light_src_thermal_shutdn',  rowId: 'row-fault_light_src_thermal_shutdn',  label: 'Light Src Shutdown' },
    { key: 'status_control_gear_failure',      rowId: 'row-status_control_gear_failure',     label: 'Control Gear Failure' },
    { key: 'status_lamp_failure',              rowId: 'row-status_lamp_failure',              label: 'Lamp Failure' }
];

var TILT_KEY = 'tilt';
var TILT_ROW_ID = 'row-tilt';
var TILT_THRESHOLD = 10; // degrees — above this = fault

var POLL_INTERVAL_MS = 10000; // 10 seconds
var pollTimer = null;
var DEVICE_ID = null;

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

self.onInit = function() {
    DEVICE_ID = resolveDeviceId();

    if (!DEVICE_ID) {
        showError('No device configured');
        return;
    }

    // Initial poll
    poll();

    // Start periodic polling
    pollTimer = setInterval(poll, POLL_INTERVAL_MS);
};

self.onDestroy = function() {
    if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
    }
};

function poll() {
    var allKeys = FAULT_KEYS.map(function(f) { return f.key; });
    allKeys.push(TILT_KEY);
    var keysParam = allKeys.join(',');

    var http = self.ctx.http;
    http.get('/api/plugins/telemetry/DEVICE/' + DEVICE_ID + '/values/timeseries?keys=' + keysParam)
        .toPromise()
        .then(function(resp) {
            updateUI(resp);
        })
        .catch(function(err) {
            showError('Telemetry error');
        });
}

function isFault(val) {
    if (val === undefined || val === null) return false;
    return val === 'true' || val === true || val === '1' || val === 1;
}

function updateUI(data) {
    var faultCount = 0;
    var latestTs = 0;

    // Process 10 fault flags
    FAULT_KEYS.forEach(function(f) {
        var row = document.getElementById(f.rowId);
        if (!row) return;

        var dot = row.querySelector('.fs-dot');
        var status = row.querySelector('.fs-status');
        var val = null;
        var ts = 0;

        if (data[f.key] && data[f.key].length > 0) {
            val = data[f.key][0].value;
            ts = data[f.key][0].ts;
            if (ts > latestTs) latestTs = ts;
        }

        var active = isFault(val);
        if (active) faultCount++;

        // Update dot
        dot.className = 'fs-dot ' + (active ? 'is-fault' : 'is-ok');

        // Update status text
        status.textContent = active ? 'FAULT' : 'OK';
        status.className = 'fs-status ' + (active ? 'is-fault' : 'is-ok');

        // Update row background
        row.className = 'fs-row' + (active ? ' is-fault' : '');
    });

    // Process tilt
    var tiltRow = document.getElementById(TILT_ROW_ID);
    if (tiltRow) {
        var tiltDot = tiltRow.querySelector('.fs-dot');
        var tiltStatus = tiltRow.querySelector('.fs-status');
        var tiltVal = 0;

        if (data[TILT_KEY] && data[TILT_KEY].length > 0) {
            tiltVal = parseFloat(data[TILT_KEY][0].value) || 0;
            var tiltTs = data[TILT_KEY][0].ts;
            if (tiltTs > latestTs) latestTs = tiltTs;
        }

        var tiltThreshold = TILT_THRESHOLD;
        if (self.ctx.settings && self.ctx.settings.tiltThreshold) {
            tiltThreshold = parseInt(self.ctx.settings.tiltThreshold) || TILT_THRESHOLD;
        }

        var tiltFault = tiltVal > tiltThreshold;
        if (tiltFault) faultCount++;

        tiltDot.className = 'fs-dot ' + (tiltFault ? 'is-fault' : 'is-ok');
        tiltStatus.textContent = tiltFault ? 'FAULT (' + tiltVal + '°)' : 'OK (' + tiltVal + '°)';
        tiltStatus.className = 'fs-status ' + (tiltFault ? 'is-fault' : 'is-ok');
        tiltRow.className = 'fs-row' + (tiltFault ? ' is-fault' : '');
    }

    // Update header badge
    var badge = document.getElementById('fsBadge');
    if (badge) {
        if (faultCount === 0) {
            badge.textContent = 'All OK';
            badge.className = 'fs-badge is-ok';
        } else {
            badge.textContent = faultCount + ' Fault' + (faultCount > 1 ? 's' : '');
            badge.className = 'fs-badge is-fault';
        }
    }

    // Update footer timestamp
    var footer = document.getElementById('fsFooter');
    if (footer && latestTs > 0) {
        var tsSpan = footer.querySelector('.fs-timestamp');
        if (tsSpan) {
            var date = new Date(latestTs);
            var hours = ('0' + date.getHours()).slice(-2);
            var minutes = ('0' + date.getMinutes()).slice(-2);
            var seconds = ('0' + date.getSeconds()).slice(-2);
            tsSpan.textContent = 'Last update: ' + hours + ':' + minutes + ':' + seconds;
        }
    }
}

function showError(msg) {
    var badge = document.getElementById('fsBadge');
    if (badge) {
        badge.textContent = msg;
        badge.className = 'fs-badge is-loading';
    }
}
