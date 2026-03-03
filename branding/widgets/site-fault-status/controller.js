// ═══════════════════════════════════════════════════════════════
// SignConnect — Site Fault Status Widget (controller.js)
// ═══════════════════════════════════════════════════════════════
// SITE state widget. Shows per-device fault/warning status for
// all devices at a site. Aggregates into a summary header with
// sorted device list showing active faults and warnings.
//
// Receives site ASSET ID from dashboard state params (Fleet nav).
// Queries relations to find child devices, polls fault telemetry.
// ═══════════════════════════════════════════════════════════════

var pollTimer = null;

self.onInit = function () {
    'use strict';

    var POLL_INTERVAL = (self.ctx.settings && self.ctx.settings.pollInterval) || 15000;

    var $root = self.ctx.$container[0];
    var container = $root.querySelector('.sfs-root');
    if (!container) {
        $root.innerHTML = '<div class="sfs-root"></div>';
        container = $root.querySelector('.sfs-root');
    }
    var http = self.ctx.http;

    var siteId = null;
    var entityName = '';
    var devices = [];
    var siteAttrs = {};

    // ── Fault & Warning Key Definitions ─────────────────────

    var FAULT_KEYS_PLUS = [
        { key: 'fault_overall_failure',          label: 'Overall Failure' },
        { key: 'fault_under_voltage',            label: 'Under Voltage' },
        { key: 'fault_over_voltage',             label: 'Over Voltage' },
        { key: 'fault_power_limit',              label: 'Power Limit' },
        { key: 'fault_thermal_derating',         label: 'Thermal Derating' },
        { key: 'fault_thermal_shutdown',         label: 'Thermal Shutdown' },
        { key: 'fault_light_src_failure',        label: 'Light Src Failure' },
        { key: 'fault_light_src_short_circuit',  label: 'Short Circuit' },
        { key: 'fault_light_src_thermal_derate', label: 'Light Src Derating' },
        { key: 'fault_light_src_thermal_shutdn', label: 'Light Src Shutdown' }
    ];

    var FAULT_KEYS_BOTH = [
        { key: 'status_control_gear_failure', label: 'Control Gear Failure' },
        { key: 'status_lamp_failure',         label: 'Lamp Failure' }
    ];

    var WARNING_KEYS = [
        { key: 'status_limit_error',        label: 'Limit Error' },
        { key: 'status_reset_state',        label: 'Reset State' },
        { key: 'status_missing_short_addr', label: 'Missing Short Addr' }
    ];

    // ── Resolve Site Asset ID ───────────────────────────────

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

    // ── API Helpers ─────────────────────────────────────────

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

    function isFault(val) {
        if (val === undefined || val === null) return false;
        return val === 'true' || val === true || val === '1' || val === 1;
    }

    function esc(str) {
        if (!str) return '';
        return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    // ── Fetch Devices via Relations ─────────────────────────

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
                            tier: 'standard',
                            faults: [],
                            warnings: [],
                            hasData: false
                        };
                    });
                });
                return Promise.all(promises).then(function (devs) {
                    devices = devs;
                });
            });
    }

    // ── Fetch Site Attributes ───────────────────────────────

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

    // ── Fetch Device Attributes (tier) ──────────────────────

    function fetchDeviceAttributes() {
        if (devices.length === 0) return Promise.resolve();

        var promises = devices.map(function (dev) {
            return apiGet('/plugins/telemetry/DEVICE/' + dev.id + '/values/attributes/SERVER_SCOPE')
                .then(function (attrs) {
                    if (attrs && Array.isArray(attrs)) {
                        attrs.forEach(function (a) {
                            if (a.key === 'dashboard_tier') {
                                dev.tier = (String(a.value) || '').toLowerCase();
                            }
                        });
                    }
                    if (!dev.tier) dev.tier = 'standard';
                })
                .catch(function () { dev.tier = 'standard'; });
        });

        return Promise.all(promises);
    }

    // ── Fetch Fault Telemetry ───────────────────────────────

    function fetchFaultTelemetry() {
        if (devices.length === 0) return Promise.resolve();

        var promises = devices.map(function (dev) {
            var isPlus = dev.tier === 'plus';
            var faultDefs = isPlus
                ? FAULT_KEYS_PLUS.concat(FAULT_KEYS_BOTH)
                : FAULT_KEYS_BOTH;
            var allDefs = faultDefs.concat(WARNING_KEYS);
            var keysParam = allDefs.map(function (d) { return d.key; }).join(',');

            return apiGet('/plugins/telemetry/DEVICE/' + dev.id + '/values/timeseries?keys=' + keysParam)
                .then(function (data) {
                    var faults = [];
                    var warnings = [];
                    var gotData = false;

                    faultDefs.forEach(function (fd) {
                        if (data[fd.key] && data[fd.key].length > 0) {
                            gotData = true;
                            if (isFault(data[fd.key][0].value)) {
                                faults.push(fd.label);
                            }
                        }
                    });

                    WARNING_KEYS.forEach(function (wd) {
                        if (data[wd.key] && data[wd.key].length > 0) {
                            gotData = true;
                            if (isFault(data[wd.key][0].value)) {
                                warnings.push(wd.label);
                            }
                        }
                    });

                    dev.faults = faults;
                    dev.warnings = warnings;
                    dev.hasData = gotData;
                })
                .catch(function () {
                    dev.faults = [];
                    dev.warnings = [];
                    dev.hasData = false;
                });
        });

        return Promise.all(promises);
    }

    // ── Render ──────────────────────────────────────────────

    function render() {
        var html = '';
        html += '<div class="sfs-section-title">SITE OPERATIONAL STATUS</div>';
        html += renderSummary();
        html += renderDeviceList();
        container.innerHTML = html;
    }

    function renderSummary() {
        if (devices.length === 0) {
            return '<div class="sfs-summary sfs-summary-empty">'
                + '<span class="sfs-summary-icon sfs-summary-icon-grey">&#9679;</span>'
                + '<span class="sfs-summary-text">No devices found</span>'
                + '</div>';
        }

        var totalFaults = 0, totalWarnings = 0, unknownCount = 0;
        devices.forEach(function (d) {
            totalFaults += d.faults.length;
            totalWarnings += d.warnings.length;
            if (!d.hasData) unknownCount++;
        });

        var html = '<div class="sfs-summary';
        var iconHtml, textHtml, subHtml;

        if (totalFaults === 0 && totalWarnings === 0) {
            html += ' sfs-summary-ok">';
            iconHtml = '<span class="sfs-summary-icon sfs-summary-icon-green">&#10003;</span>';
            textHtml = '<span class="sfs-summary-text">All Systems Operational</span>';
            subHtml = unknownCount > 0
                ? '<span class="sfs-summary-sub">' + unknownCount + ' device' + (unknownCount !== 1 ? 's' : '') + ' with no data</span>'
                : '';
        } else {
            var cls = totalFaults > 0 ? ' sfs-summary-fault' : ' sfs-summary-warning';
            html += cls + '">';
            iconHtml = '<span class="sfs-summary-icon ' + (totalFaults > 0 ? 'sfs-summary-icon-red' : 'sfs-summary-icon-amber') + '">&#9888;</span>';
            var parts = [];
            if (totalFaults > 0) parts.push(totalFaults + ' Fault' + (totalFaults !== 1 ? 's' : ''));
            if (totalWarnings > 0) parts.push(totalWarnings + ' Warning' + (totalWarnings !== 1 ? 's' : ''));
            textHtml = '<span class="sfs-summary-text">' + parts.join(', ') + '</span>';
            var affectedCount = 0;
            devices.forEach(function (d) { if (d.faults.length > 0 || d.warnings.length > 0) affectedCount++; });
            subHtml = '<span class="sfs-summary-sub">across ' + affectedCount + ' device' + (affectedCount !== 1 ? 's' : '') + '</span>';
        }

        html += iconHtml + '<div class="sfs-summary-content">' + textHtml + subHtml + '</div>';
        html += '</div>';
        return html;
    }

    function renderDeviceList() {
        if (devices.length === 0) return '';

        // Sort: faulted first (desc by issue count), then healthy, then unknown
        var sorted = devices.slice().sort(function (a, b) {
            var aIssues = a.faults.length + a.warnings.length;
            var bIssues = b.faults.length + b.warnings.length;
            // Unknown (no data) goes last
            if (!a.hasData && b.hasData) return 1;
            if (a.hasData && !b.hasData) return -1;
            // More issues first
            if (aIssues !== bIssues) return bIssues - aIssues;
            // Alphabetical
            return a.name.localeCompare(b.name);
        });

        var html = '<div class="sfs-device-list">';

        sorted.forEach(function (dev) {
            var hasFaults = dev.faults.length > 0;
            var hasWarnings = dev.warnings.length > 0;
            var hasIssues = hasFaults || hasWarnings;
            var rowClass = 'sfs-device-row';
            if (hasFaults) rowClass += ' sfs-status-fault';
            else if (hasWarnings) rowClass += ' sfs-status-warning';
            else if (!dev.hasData) rowClass += ' sfs-status-unknown';

            html += '<div class="' + rowClass + '">';
            html += '<div class="sfs-device-header">';
            html += '<div class="sfs-device-name-row">';

            // Status dot
            var dotClass = 'sfs-dot';
            if (hasFaults) dotClass += ' sfs-dot-fault';
            else if (hasWarnings) dotClass += ' sfs-dot-warning';
            else if (!dev.hasData) dotClass += ' sfs-dot-unknown';
            else dotClass += ' sfs-dot-ok';
            html += '<span class="' + dotClass + '"></span>';

            html += '<span class="sfs-device-name">' + esc(dev.name) + '</span>';
            html += '</div>';

            // Status label
            var statusClass = 'sfs-device-status';
            var statusText;
            if (hasFaults) {
                statusClass += ' sfs-device-status-fault';
                var count = dev.faults.length + dev.warnings.length;
                statusText = count + ' Issue' + (count !== 1 ? 's' : '');
            } else if (hasWarnings) {
                statusClass += ' sfs-device-status-warning';
                statusText = dev.warnings.length + ' Warning' + (dev.warnings.length !== 1 ? 's' : '');
            } else if (!dev.hasData) {
                statusClass += ' sfs-device-status-unknown';
                statusText = 'Status Unknown';
            } else {
                statusClass += ' sfs-device-status-ok';
                statusText = 'No Faults';
            }
            html += '<span class="' + statusClass + '">' + statusText + '</span>';

            html += '</div>'; // sfs-device-header

            // Fault/warning bullet list
            if (hasIssues) {
                html += '<ul class="sfs-fault-list">';
                dev.faults.forEach(function (label) {
                    html += '<li class="sfs-fault-item sfs-fault-item-red">' + esc(label) + '</li>';
                });
                dev.warnings.forEach(function (label) {
                    html += '<li class="sfs-fault-item sfs-fault-item-amber">' + esc(label) + '</li>';
                });
                html += '</ul>';
            }

            html += '</div>'; // sfs-device-row
        });

        html += '</div>';
        return html;
    }

    // ── Loading / Error States ──────────────────────────────

    function showLoading() {
        container.innerHTML = '<div class="sfs-loading"><span class="sfs-spinner"></span>Loading fault data\u2026</div>';
    }

    function showError(msg) {
        container.innerHTML = '<div class="sfs-error">' + esc(msg) + '</div>';
    }

    // ── Poll + Refresh Cycle ────────────────────────────────

    function pollAndRender() {
        fetchFaultTelemetry().then(function () {
            render();
        }).catch(function () {
            render();
        });
    }

    // ── Init ────────────────────────────────────────────────

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
        return fetchDeviceAttributes();
    }).then(function () {
        return fetchFaultTelemetry();
    }).then(function () {
        render();
        pollTimer = setInterval(pollAndRender, POLL_INTERVAL);
    }).catch(function (err) {
        showError('Failed to load fault data');
        console.error('[SFS] Init error:', err);
    });
};

self.onDestroy = function () {
    if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
    }
};
