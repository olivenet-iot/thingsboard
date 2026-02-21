// ═══════════════════════════════════════════════
// SignConnect — Fault Status DALI2 Widget Controller
// ═══════════════════════════════════════════════

var FAULT_KEYS = [
    { key: 'status_control_gear_failure', rowId: 'row-status_control_gear_failure', label: 'Control Gear Failure' },
    { key: 'status_lamp_failure',         rowId: 'row-status_lamp_failure',         label: 'Lamp Failure' }
];

var WARNING_KEYS = [
    { key: 'status_limit_error',        rowId: 'row-status_limit_error',        label: 'Limit Error' },
    { key: 'status_reset_state',        rowId: 'row-status_reset_state',        label: 'Reset State' },
    { key: 'status_missing_short_addr', rowId: 'row-status_missing_short_addr', label: 'Missing Short Addr' }
];

var INFO_KEYS = [
    { key: 'status_lamp_on',            rowId: 'row-status_lamp_on',            label: 'Lamp On',            activeText: 'ON',     inactiveText: 'OFF' },
    { key: 'status_power_cycle_seen',   rowId: 'row-status_power_cycle_seen',   label: 'Power Cycle Seen',   activeText: 'YES',    inactiveText: 'NO' },
    { key: 'status_fade_running',       rowId: 'row-status_fade_running',       label: 'Fade Running',       activeText: 'ACTIVE', inactiveText: 'IDLE' }
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
    WARNING_KEYS.forEach(function(w) { allKeys.push(w.key); });
    INFO_KEYS.forEach(function(i) { allKeys.push(i.key); });
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
    var warningCount = 0;
    var latestTs = 0;

    // Process fault flags (red)
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

        dot.className = 'fs-dot ' + (active ? 'is-fault' : 'is-ok');
        status.textContent = active ? 'FAULT' : 'OK';
        status.className = 'fs-status ' + (active ? 'is-fault' : 'is-ok');
        row.className = 'fs-row' + (active ? ' is-fault' : '');
    });

    // Process warning flags (amber)
    WARNING_KEYS.forEach(function(w) {
        var row = document.getElementById(w.rowId);
        if (!row) return;

        var dot = row.querySelector('.fs-dot');
        var status = row.querySelector('.fs-status');
        var val = null;
        var ts = 0;

        if (data[w.key] && data[w.key].length > 0) {
            val = data[w.key][0].value;
            ts = data[w.key][0].ts;
            if (ts > latestTs) latestTs = ts;
        }

        var active = isFault(val);
        if (active) warningCount++;

        dot.className = 'fs-dot ' + (active ? 'is-warning' : 'is-ok');
        status.textContent = active ? 'WARNING' : 'OK';
        status.className = 'fs-status ' + (active ? 'is-warning' : 'is-ok');
        row.className = 'fs-row' + (active ? ' is-warning' : '');
    });

    // Process info flags (blue/grey)
    INFO_KEYS.forEach(function(i) {
        var row = document.getElementById(i.rowId);
        if (!row) return;

        var dot = row.querySelector('.fs-dot');
        var status = row.querySelector('.fs-status');
        var val = null;
        var ts = 0;

        if (data[i.key] && data[i.key].length > 0) {
            val = data[i.key][0].value;
            ts = data[i.key][0].ts;
            if (ts > latestTs) latestTs = ts;
        }

        var active = isFault(val);
        var cls = active ? 'is-info-active' : 'is-info-inactive';

        dot.className = 'fs-dot ' + cls;
        status.textContent = active ? i.activeText : i.inactiveText;
        status.className = 'fs-status ' + cls;
        row.className = 'fs-row';
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
        if (faultCount === 0 && warningCount === 0) {
            badge.textContent = 'All Clear';
            badge.className = 'fs-badge is-ok';
        } else {
            var parts = [];
            if (faultCount > 0) parts.push(faultCount + ' Fault' + (faultCount > 1 ? 's' : ''));
            if (warningCount > 0) parts.push(warningCount + ' Warning' + (warningCount > 1 ? 's' : ''));
            badge.textContent = parts.join(', ');
            badge.className = 'fs-badge ' + (faultCount > 0 ? 'is-fault' : 'is-warning');
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
