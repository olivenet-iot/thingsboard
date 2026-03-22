// ===================================================================
// SignConnect - Device Pool Widget (controller.js)
// ===================================================================
// POOL state widget for the Management Dashboard. Shows:
//   Tab 1: Pool (unassigned devices from register-service)
//   Tab 2: Register (form to register new LoRaWAN devices)
//
// Calls external register-service API (not TB API).
// ===================================================================

self.onInit = function () {
    'use strict';

    var $root = self.ctx.$container[0];
    var container = $root.querySelector('.dp-root');
    if (!container) {
        $root.innerHTML = '<div class="dp-root"></div>';
        container = $root.querySelector('.dp-root');
    }

    // ── Constants ────────────────────────────────────────────────

    var REGISTER_API = 'http://46.225.54.21:5002';

    // ── State Variables ─────────────────────────────────────────

    var activeTab = 'pool';
    var poolDevices = [];
    var poolLoading = false;
    var poolError = '';

    var registerRows = [{ name: '', dev_eui: '', join_eui: '0101010101010101', app_key: '2AE60CB235944C98BB5665BF25DD6B16' }];
    var registerStatus = 'idle'; // idle | registering | done
    var registerResults = null;

    var sortColumn = '';      // 'name' | 'eui' | 'profile' | 'created' | 'status'
    var sortDirection = 'asc'; // 'asc' | 'desc'

    var toastMessage = '';
    var toastType = 'success';
    var toastTimer = null;

    var dialogVisible = false;
    var dialogAction = null;

    // ── Render Engine ───────────────────────────────────────────

    function render() {
        container.innerHTML = renderHeader() + renderTabs() +
            '<div class="dp-content">' + renderActiveTab() + '</div>' +
            renderToast() + renderDialog();
        bindEvents();
    }

    function renderHeader() {
        return '<div class="dp-header">' +
            '<button class="dp-back-btn" data-action="back" title="Back to Home">&#8592;</button>' +
            '<div class="dp-title">Device Pool</div>' +
            '</div>';
    }

    function renderTabs() {
        return '<div class="dp-tabs">' +
            '<div class="dp-tab' + (activeTab === 'pool' ? ' dp-tab-active' : '') + '" data-tab="pool">Pool</div>' +
            '<div class="dp-tab' + (activeTab === 'register' ? ' dp-tab-active' : '') + '" data-tab="register">Register</div>' +
            '</div>';
    }

    function renderActiveTab() {
        if (activeTab === 'pool') return renderPoolTab();
        if (activeTab === 'register') return renderRegisterTab();
        return '';
    }

    // ── Pool Tab ────────────────────────────────────────────────

    function renderPoolTab() {
        var html = '<div class="dp-toolbar">';
        html += '<button class="dp-btn dp-btn-secondary dp-btn-sm" data-action="refresh">&#8635; Refresh</button>';
        html += '<div class="dp-toolbar-spacer"></div>';
        html += '<button class="dp-btn dp-btn-danger dp-btn-sm" data-action="bridge-restart">Restart Bridge</button>';
        html += '</div>';

        if (poolLoading) {
            html += '<div class="dp-card" style="text-align:center;padding:32px;">' +
                '<div class="dp-inline-spinner"></div>' +
                '<div style="margin-top:8px;color:#94a3b8;font-size:13px;">Loading pool...</div></div>';
            return html;
        }

        if (poolError) {
            html += '<div class="dp-error-banner">' +
                '<span>' + esc(poolError) + '</span>' +
                '<button class="dp-btn dp-btn-secondary dp-btn-sm" data-action="refresh">Retry</button>' +
                '</div>';
        }

        if (!poolDevices || poolDevices.length === 0) {
            html += '<div class="dp-empty">' +
                '<div class="dp-empty-icon">&#9645;</div>' +
                '<div class="dp-empty-text">No unassigned devices</div>' +
                '<div class="dp-empty-sub">Registered devices that haven\'t been assigned to a site will appear here.</div>' +
                '</div>';
            return html;
        }

        html += renderDeviceTable(getSortedDevices(poolDevices));
        return html;
    }

    function getSortedDevices(devices) {
        if (!sortColumn || !devices || devices.length === 0) return devices;
        var sorted = devices.slice();
        var dir = sortDirection === 'desc' ? -1 : 1;
        sorted.sort(function (a, b) {
            var va, vb;
            switch (sortColumn) {
                case 'name':
                    va = (a.name || a.device_name || '').toLowerCase();
                    vb = (b.name || b.device_name || '').toLowerCase();
                    return dir * va.localeCompare(vb);
                case 'eui':
                    va = (a.dev_eui || a.devEui || '').toLowerCase();
                    vb = (b.dev_eui || b.devEui || '').toLowerCase();
                    return dir * va.localeCompare(vb);
                case 'profile':
                    va = (a.device_profile || a.profile || '').toLowerCase();
                    vb = (b.device_profile || b.profile || '').toLowerCase();
                    return dir * va.localeCompare(vb);
                case 'created':
                    va = new Date(a.created_time || a.created_at || a.createdAt || 0).getTime();
                    vb = new Date(b.created_time || b.created_at || b.createdAt || 0).getTime();
                    return dir * (va - vb);
                case 'status':
                    va = a.assigned || a.is_assigned ? 1 : 0;
                    vb = b.assigned || b.is_assigned ? 1 : 0;
                    return dir * (va - vb);
                default:
                    return 0;
            }
        });
        return sorted;
    }

    function sortIcon(col) {
        if (sortColumn !== col) return '';
        var arrow = sortDirection === 'asc' ? '\u25B2' : '\u25BC';
        return '<span class="dp-sort-icon">' + arrow + '</span>';
    }

    function renderDeviceTable(devices) {
        var html = '<div class="dp-table-wrap"><table class="dp-table">';
        html += '<thead><tr>' +
            '<th class="dp-th-sort" data-sort="name">Name' + sortIcon('name') + '</th>' +
            '<th class="dp-th-sort" data-sort="eui">DevEUI' + sortIcon('eui') + '</th>' +
            '<th class="dp-th-sort" data-sort="profile">Profile' + sortIcon('profile') + '</th>' +
            '<th class="dp-th-sort" data-sort="created">Created' + sortIcon('created') + '</th>' +
            '<th class="dp-th-sort" data-sort="status">Status' + sortIcon('status') + '</th>' +
            '<th style="width:32px"></th>' +
            '</tr></thead><tbody>';

        for (var i = 0; i < devices.length; i++) {
            var d = devices[i];
            var name = d.name || d.device_name || '—';
            var eui = d.dev_eui || d.devEui || '—';
            var profile = d.device_profile || d.profile || '—';
            var created = d.created_time || d.created_at || d.createdAt || '';
            var assigned = d.assigned || d.is_assigned || false;

            var createdStr = '';
            if (created) {
                try {
                    var dt = new Date(created);
                    createdStr = dt.toLocaleDateString() + ' ' + dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                } catch (e) {
                    createdStr = String(created);
                }
            }

            var statusClass = assigned ? 'dp-status-assigned' : 'dp-status-unassigned';
            var statusText = assigned ? 'Assigned' : 'Unassigned';

            var hasId = d.id ? true : false;
            html += '<tr' + (hasId ? ' class="dp-row-clickable" data-device-id="' + esc(d.id) + '"' : '') + '>' +
                '<td>' + esc(name) + '</td>' +
                '<td class="dp-mono">' + esc(eui) + '</td>' +
                '<td>' + esc(profile) + '</td>' +
                '<td>' + esc(createdStr) + '</td>' +
                '<td><span class="dp-status-badge ' + statusClass + '">' + statusText + '</span></td>' +
                '<td class="dp-row-chevron">' + (hasId ? '\u203A' : '') + '</td>' +
                '</tr>';
        }

        html += '</tbody></table></div>';
        return html;
    }

    // ── Register Tab ────────────────────────────────────────────

    function renderRegisterTab() {
        if (registerStatus === 'registering') {
            return '<div class="dp-registering-overlay">' +
                '<div class="dp-spinner"></div>' +
                '<div class="dp-registering-text">Registering devices...</div>' +
                '</div>';
        }

        var html = '';

        if (registerStatus === 'done' && registerResults) {
            html += renderResults(registerResults);
            html += '<div style="margin-top:12px;">' +
                '<button class="dp-btn dp-btn-secondary" data-action="register-reset">Register More</button>' +
                '</div>';
            return html;
        }

        html += '<div class="dp-card">';
        html += '<div class="dp-card-header">';
        html += '<div class="dp-card-title">Register Devices</div>';
        html += '<div style="display:flex;gap:6px;">';
        html += '<button class="dp-btn dp-btn-secondary dp-btn-sm" data-action="download-template">&#8681; Template</button>';
        html += '<button class="dp-btn dp-btn-secondary dp-btn-sm" data-action="upload-csv">&#8679; Upload CSV</button>';
        html += '</div>';
        html += '</div>';

        html += renderFormMode();

        html += '</div>';
        return html;
    }

    function renderFormMode() {
        var html = '';

        // Labels row (only once)
        html += '<div class="dp-form-header">' +
            '<span class="dp-hdr-num"></span>' +
            '<span class="dp-hdr-id">Device ID</span>' +
            '<span class="dp-hdr-eui">DevEUI</span>' +
            '<span class="dp-hdr-joineui">JoinEUI</span>' +
            '<span class="dp-hdr-appkey">AppKey</span>' +
            '<span class="dp-hdr-actions"></span>' +
            '</div>';

        html += '<div class="dp-form-rows">';
        for (var i = 0; i < registerRows.length; i++) {
            html += renderFormRow(registerRows[i], i);
        }
        html += '</div>';

        html += '<div style="display:flex;gap:8px;margin-top:12px;">';
        html += '<button class="dp-btn dp-btn-secondary dp-btn-sm" data-action="add-row">+ Add Row</button>';
        html += '<div class="dp-toolbar-spacer"></div>';
        html += '<button class="dp-btn dp-btn-primary" data-action="register-all"' +
            (registerRows.length === 0 ? ' disabled' : '') + '>Register All</button>';
        html += '</div>';

        return html;
    }

    function renderFormRow(row, index) {
        return '<div class="dp-form-row">' +
            '<span class="dp-row-num">' + (index + 1) + '</span>' +
            '<input class="dp-input dp-input-id" data-field="name" data-idx="' + index + '" ' +
            'placeholder="e.g. lumosoft-001" value="' + esc(row.name) + '" />' +
            '<input class="dp-input dp-input-eui" data-field="dev_eui" data-idx="' + index + '" ' +
            'placeholder="16 HEX" maxlength="16" value="' + esc(row.dev_eui) + '" />' +
            '<input class="dp-input dp-input-joineui" data-field="join_eui" data-idx="' + index + '" ' +
            'placeholder="16 HEX" maxlength="16" value="' + esc(row.join_eui) + '" />' +
            '<input class="dp-input dp-input-appkey" data-field="app_key" data-idx="' + index + '" ' +
            'placeholder="32 HEX" maxlength="32" value="' + esc(row.app_key) + '" />' +
            '<button class="dp-row-remove" data-action="remove-row" data-idx="' + index + '" title="Remove">&times;</button>' +
            '</div>';
    }

    function renderResults(results) {
        var devices = results.results || results.devices || [];
        var successCount = 0;
        var failCount = 0;

        for (var i = 0; i < devices.length; i++) {
            if (devices[i].success || devices[i].status === 'success' || devices[i].status === 'ok') {
                successCount++;
            } else {
                failCount++;
            }
        }

        var summaryClass = failCount === 0 ? 'dp-result-summary-success' :
            (successCount === 0 ? 'dp-result-summary-error' : 'dp-result-summary-partial');

        var html = '<div class="dp-results">';
        html += '<div class="dp-result-summary ' + summaryClass + '">';
        html += successCount + ' succeeded, ' + failCount + ' failed';
        html += '</div>';

        for (var j = 0; j < devices.length; j++) {
            var d = devices[j];
            var ok = d.success || d.status === 'success' || d.status === 'ok';
            var name = d.name || d.device_name || 'Device ' + (j + 1);
            var msg = d.message || d.error || (ok ? 'Registered' : 'Failed');

            html += '<div class="dp-result-item">' +
                '<span class="' + (ok ? 'dp-result-ok' : 'dp-result-fail') + '">' + (ok ? '&#10003;' : '&#10007;') + '</span>' +
                '<span class="dp-result-name">' + esc(name) + '</span>' +
                '<span class="dp-result-msg">' + esc(msg) + '</span>' +
                '</div>';
        }

        html += '</div>';
        return html;
    }

    // ── Toast ───────────────────────────────────────────────────

    function renderToast() {
        if (!toastMessage) return '';
        var cls = toastType === 'error' ? 'dp-toast-error' : 'dp-toast-success';
        return '<div class="dp-toast ' + cls + '">' +
            '<span>' + esc(toastMessage) + '</span>' +
            '<span class="dp-toast-close" data-action="close-toast">&times;</span>' +
            '</div>';
    }

    function showToast(msg, type) {
        toastMessage = msg;
        toastType = type || 'success';
        if (toastTimer) clearTimeout(toastTimer);
        toastTimer = setTimeout(function () {
            toastMessage = '';
            render();
        }, 4000);
        render();
    }

    // ── Dialog ──────────────────────────────────────────────────

    function renderDialog() {
        if (!dialogVisible) return '';
        return '<div class="dp-dialog-overlay" data-action="close-dialog">' +
            '<div class="dp-dialog" onclick="event.stopPropagation()">' +
            '<div class="dp-dialog-title">Restart Bridge</div>' +
            '<div class="dp-dialog-body">Are you sure you want to restart the TTN-to-ThingsBoard bridge? ' +
            'This will briefly interrupt telemetry forwarding.</div>' +
            '<div class="dp-dialog-actions">' +
            '<button class="dp-btn dp-btn-secondary" data-action="close-dialog">Cancel</button>' +
            '<button class="dp-btn dp-btn-danger" data-action="confirm-restart">Restart</button>' +
            '</div></div></div>';
    }

    // ── Data Fetching ───────────────────────────────────────────

    function loadPool() {
        poolLoading = true;
        poolError = '';
        render();

        fetch(REGISTER_API + '/pool')
            .then(function (resp) {
                if (!resp.ok) throw new Error('HTTP ' + resp.status);
                return resp.json();
            })
            .then(function (data) {
                poolDevices = Array.isArray(data) ? data : (data.devices || data.pool || []);
                poolLoading = false;
                poolError = '';
                render();
            })
            .catch(function (err) {
                console.error('[DevicePool] Failed to load pool:', err);
                poolLoading = false;
                poolError = 'Failed to load device pool: ' + (err.message || err);
                render();
            });
    }

    function registerDevices() {
        // Validate
        var valid = [];
        for (var i = 0; i < registerRows.length; i++) {
            var row = registerRows[i];
            if (!row.dev_eui || row.dev_eui.length < 16) {
                showToast('Row ' + (i + 1) + ': DevEUI must be 16 hex characters', 'error');
                return;
            }
            if (!row.app_key) {
                row.app_key = generateAppKey();
            }
            if (!row.name) {
                row.name = 'Device-' + row.dev_eui.substring(0, 8);
            }
            valid.push({
                device_name: row.name,
                dev_eui: row.dev_eui.toUpperCase(),
                join_eui: (row.join_eui || '0101010101010101').toUpperCase(),
                app_key: row.app_key.toUpperCase()
            });
        }

        if (valid.length === 0) {
            showToast('Add at least one device to register', 'error');
            return;
        }

        registerStatus = 'registering';
        render();

        fetch(REGISTER_API + '/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ devices: valid })
        })
            .then(function (resp) {
                if (!resp.ok) throw new Error('HTTP ' + resp.status);
                return resp.json();
            })
            .then(function (data) {
                registerStatus = 'done';
                registerResults = data;
                render();
                // Reload pool in background
                loadPoolSilent();
            })
            .catch(function (err) {
                console.error('[DevicePool] Registration failed:', err);
                registerStatus = 'idle';
                showToast('Registration failed: ' + (err.message || err), 'error');
            });
    }

    function restartBridge() {
        dialogVisible = false;
        render();

        fetch(REGISTER_API + '/bridge/restart', { method: 'POST' })
            .then(function (resp) {
                if (!resp.ok) throw new Error('HTTP ' + resp.status);
                return resp.json();
            })
            .then(function () {
                showToast('Bridge restart initiated', 'success');
            })
            .catch(function (err) {
                console.error('[DevicePool] Bridge restart failed:', err);
                showToast('Bridge restart failed: ' + (err.message || err), 'error');
            });
    }

    function loadPoolSilent() {
        fetch(REGISTER_API + '/pool')
            .then(function (resp) { return resp.ok ? resp.json() : []; })
            .then(function (data) {
                poolDevices = Array.isArray(data) ? data : (data.devices || data.pool || []);
            })
            .catch(function () { /* silent */ });
    }

    // ── App Key Generation ──────────────────────────────────────

    function generateAppKey() {
        var hex = '';
        for (var i = 0; i < 32; i++) {
            hex += Math.floor(Math.random() * 16).toString(16);
        }
        return hex.toUpperCase();
    }

    // ── CSV Parsing ─────────────────────────────────────────────

    function cleanHexField(val, expectedLength) {
        val = val.replace(/^="?(.*?)"?$/, '$1');  // strip Excel ="..." wrapper
        val = val.replace(/[^0-9A-Fa-f]/g, '');
        val = val.toUpperCase();
        while (val.length < expectedLength) val = '0' + val;
        if (val.length > expectedLength) val = val.substring(0, expectedLength);
        return val;
    }

    function parseCSV(text) {
        var lines = text.trim().split('\n');
        var rows = [];
        var errors = [];

        for (var i = 0; i < lines.length; i++) {
            var line = lines[i].trim();
            if (!line) continue;

            // Skip header row
            if (i === 0 && /device.?id|device.?name|dev.?eui/i.test(line)) continue;

            var parts = line.split(/[,;\t]+/);
            if (parts.length < 2) {
                errors.push('Row ' + (i + 1) + ': needs at least device_id and dev_eui');
                continue;
            }

            var devEui = cleanHexField((parts[1] || '').trim(), 16);
            if (/^0+$/.test(devEui) || devEui.length === 0) {
                errors.push('Row ' + (i + 1) + ': invalid DevEUI (need 16 hex chars)');
                continue;
            }

            var joinEui = parts[2] ? cleanHexField(parts[2].trim(), 16) : '0101010101010101';
            if (/^0+$/.test(joinEui)) joinEui = '0101010101010101';

            var appKey = parts[3] ? cleanHexField(parts[3].trim(), 32) : '';
            if (/^0+$/.test(appKey)) appKey = '';

            rows.push({
                name: (parts[0] || '').trim(),
                dev_eui: devEui,
                join_eui: joinEui,
                app_key: appKey
            });
        }

        return { rows: rows, errors: errors };
    }

    function downloadTemplate() {
        var csv = 'device_id,dev_eui,join_eui,app_key\n' +
            'lumosoft-001,50FACB7000000001,0101010101010101,2AE60CB235944C98BB5665BF25DD6B16\n' +
            'lumosoft-002,50FACB7000000002,0101010101010101,2AE60CB235944C98BB5665BF25DD6B16\n' +
            'lumosoft-003,50FACB7000000003,0101010101010101,2AE60CB235944C98BB5665BF25DD6B16\n';
        var blob = new Blob([csv], { type: 'text/csv' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = 'device-registration-template.csv';
        a.click();
        URL.revokeObjectURL(url);
    }

    function uploadCSV() {
        var input = document.createElement('input');
        input.type = 'file';
        input.accept = '.csv';
        input.onchange = function () {
            if (!input.files || !input.files[0]) return;
            var reader = new FileReader();
            reader.onload = function (e) {
                var result = parseCSV(e.target.result);
                if (result.errors.length > 0) {
                    showToast(result.errors[0], 'error');
                    return;
                }
                if (result.rows.length === 0) {
                    showToast('No valid rows found in CSV', 'error');
                    return;
                }
                registerRows = result.rows;
                render();
                showToast('Loaded ' + result.rows.length + ' devices from CSV', 'success');
            };
            reader.readAsText(input.files[0]);
        };
        input.click();
    }

    // ── Event Binding ───────────────────────────────────────────

    function bindEvents() {
        // Tabs
        var tabs = container.querySelectorAll('.dp-tab');
        for (var t = 0; t < tabs.length; t++) {
            tabs[t].addEventListener('click', handleTabClick);
        }

        // Buttons
        var btns = container.querySelectorAll('[data-action]');
        for (var b = 0; b < btns.length; b++) {
            btns[b].addEventListener('click', handleAction);
        }

        // Sort headers
        var sortHeaders = container.querySelectorAll('.dp-th-sort');
        for (var s = 0; s < sortHeaders.length; s++) {
            sortHeaders[s].addEventListener('click', handleSort);
        }

        // Row click → navigate to device
        var rows = container.querySelectorAll('.dp-row-clickable');
        for (var r = 0; r < rows.length; r++) {
            rows[r].addEventListener('click', handleRowClick);
        }

        // Form inputs
        var inputs = container.querySelectorAll('.dp-input');
        for (var n = 0; n < inputs.length; n++) {
            inputs[n].addEventListener('input', handleInput);
        }

        // Dialog overlay
        var overlay = container.parentElement.querySelector('.dp-dialog-overlay');
        if (overlay) {
            overlay.addEventListener('click', function (e) {
                if (e.target === overlay) {
                    dialogVisible = false;
                    render();
                }
            });
        }
    }

    function handleTabClick(e) {
        var tab = e.currentTarget.getAttribute('data-tab');
        if (tab && tab !== activeTab) {
            activeTab = tab;
            if (tab === 'pool') loadPool();
            else render();
        }
    }

    function handleAction(e) {
        e.stopPropagation();
        var action = e.currentTarget.getAttribute('data-action');
        var idx = parseInt(e.currentTarget.getAttribute('data-idx'), 10);

        switch (action) {
            case 'back':
                navigateBack();
                break;
            case 'refresh':
                loadPool();
                break;
            case 'bridge-restart':
                dialogVisible = true;
                dialogAction = 'restart';
                render();
                break;
            case 'confirm-restart':
                restartBridge();
                break;
            case 'close-dialog':
                dialogVisible = false;
                render();
                break;
            case 'close-toast':
                toastMessage = '';
                if (toastTimer) clearTimeout(toastTimer);
                render();
                break;
            case 'add-row':
                registerRows.push({ name: '', dev_eui: '', join_eui: '0101010101010101', app_key: '2AE60CB235944C98BB5665BF25DD6B16' });
                render();
                break;
            case 'remove-row':
                if (!isNaN(idx) && registerRows.length > 1) {
                    registerRows.splice(idx, 1);
                    render();
                }
                break;
            case 'register-all':
                registerDevices();
                break;
            case 'register-reset':
                registerStatus = 'idle';
                registerResults = null;
                registerRows = [{ name: '', dev_eui: '', join_eui: '0101010101010101', app_key: '2AE60CB235944C98BB5665BF25DD6B16' }];
                render();
                break;
            case 'download-template':
                downloadTemplate();
                break;
            case 'upload-csv':
                uploadCSV();
                break;
        }
    }

    function handleInput(e) {
        var field = e.target.getAttribute('data-field');
        var idx = parseInt(e.target.getAttribute('data-idx'), 10);
        if (field && !isNaN(idx) && registerRows[idx]) {
            var val = e.target.value;
            if (field === 'dev_eui' || field === 'join_eui' || field === 'app_key') {
                val = val.toUpperCase().replace(/[^0-9A-F]/g, '');
                e.target.value = val;
            }
            registerRows[idx][field] = val;
        }
    }

    function handleSort(e) {
        var col = e.currentTarget.getAttribute('data-sort');
        if (col === sortColumn) {
            sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
        } else {
            sortColumn = col;
            sortDirection = 'asc';
        }
        render();
    }

    // ── Navigation ──────────────────────────────────────────────

    function navigateBack() {
        try {
            var sc = self.ctx.stateController;
            if (sc && sc.resetState) {
                sc.resetState();
                return;
            }
        } catch (e) {
            console.error('[DevicePool] Back navigation failed:', e);
        }
    }

    function handleRowClick(e) {
        if (e.target.closest('[data-action]')) return;
        var row = e.currentTarget;
        var devId = row.getAttribute('data-device-id');
        if (!devId) return;
        try {
            var sc = self.ctx.stateController;
            if (sc && sc.openState) {
                sc.openState('device', { entityId: { id: devId, entityType: 'DEVICE' } });
            }
        } catch (err) {
            console.error('[DevicePool] Navigate to device failed:', err);
        }
    }

    // ── Utilities ───────────────────────────────────────────────

    function esc(text) {
        if (!text) return '';
        return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    // ── Init ────────────────────────────────────────────────────

    loadPool();

    // ── Destroy hook ────────────────────────────────────────────

    self.onDestroy = function () {
        if (toastTimer) {
            clearTimeout(toastTimer);
            toastTimer = null;
        }
    };
};

self.onDataUpdated = function () {};
self.onResize = function () {};
