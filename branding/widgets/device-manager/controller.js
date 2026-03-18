// ═══════════════════════════════════════════════════════════════
// SignConnect — Device Manager Widget (controller.js)
// ═══════════════════════════════════════════════════════════════
// DEVICE state widget. Shows device metadata, profile, parent site.
//
// Receives device ID from dashboard state params.
// ═══════════════════════════════════════════════════════════════

self.onInit = function () {
    'use strict';

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
    var parentSite = null;
    var isEditing = false;
    var isSaving = false;
    var deviceLastActivity = 0;
    var deviceOnline = false;
    var deleteState = 'idle';

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

    function esc(text) {
        if (!text) return '';
        return text.replace(/&/g, '&amp;').replace(/</g, '&lt;')
                   .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    // ── Helpers ─────────────────────────────────────────────────

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

    // ── Navigation ──────────────────────────────────────────────

    function openState(stateId, params) {
        try {
            var sc = self.ctx.stateController;
            sc.resetState();
            sc.openState(stateId, params);
        } catch (e) { console.error('[DM] Navigate failed:', e); }
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
        var cls = deviceOnline ? 'dm-status-online' : 'dm-status-offline';
        var dotCls = deviceOnline ? 'dm-dot-online' : 'dm-dot-offline';
        var label = deviceOnline ? 'Online' : 'Offline';
        return '<span class="dm-status-badge ' + cls + '">' +
               '<span class="dm-dot ' + dotCls + '"></span>' + label + '</span>';
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
            html += '<button class="dm-btn dm-btn-danger" data-action="delete-device">Delete</button>';
        } else {
            html += '<button class="dm-btn dm-btn-secondary" data-action="cancel-edit">Cancel</button>';
            html += '<button class="dm-btn dm-btn-primary" data-action="save"' +
                    (isSaving ? ' disabled' : '') + '>' +
                    (isSaving ? 'Saving...' : 'Save') + '</button>';
        }
        html += '</div>';

        // Delete dialog
        if (deleteState !== 'idle') {
            html += renderDeleteDeviceDialog();
        }

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

        // Status
        var statusLabel = deviceOnline ? 'Online' : 'Offline';
        var lastSeen = deviceLastActivity > 0 ? timeSince(deviceLastActivity) : 'Never';
        html += renderMetaRow('Status', statusLabel);
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

    // ── Render: Delete Device Dialog ────────────────────────────

    function renderDeleteDeviceDialog() {
        var html = '<div class="dm-confirm-overlay">';
        html += '<div class="dm-confirm-panel">';

        if (deleteState === 'confirm') {
            var name = deviceEntity ? deviceEntity.name : 'this device';
            html += '<h3 style="font-size:18px;font-weight:700;margin:0 0 12px 0">Delete ' + esc(name) + '?</h3>';
            html += '<p style="color:#64748b;font-size:14px;margin:0 0 20px 0;line-height:1.5">This will permanently delete this device and its data. This cannot be undone.</p>';
            html += '<div style="display:flex;justify-content:flex-end;gap:8px">';
            html += '<button class="dm-btn dm-btn-secondary" data-action="cancel-delete-device">Cancel</button>';
            html += '<button class="dm-btn dm-btn-danger" data-action="confirm-delete-device">Delete</button>';
            html += '</div>';
        } else if (deleteState === 'deleting') {
            html += '<h3 style="font-size:18px;font-weight:700;margin:0 0 12px 0">Deleting...</h3>';
            html += '<p style="color:#64748b;font-size:14px">Please wait...</p>';
        }

        html += '</div></div>';
        return html;
    }

    // ── Main Render ─────────────────────────────────────────────

    function render() {
        var html = renderHeader() + renderDetailsTab();
        container.innerHTML = html;
        bindEvents();
    }

    // ── Bind Events ─────────────────────────────────────────────

    function bindEvents() {
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

            case 'delete-device':
                deleteState = 'confirm';
                render();
                break;

            case 'cancel-delete-device':
                deleteState = 'idle';
                render();
                break;

            case 'confirm-delete-device':
                deleteState = 'deleting';
                render();
                apiDelete('/device/' + deviceId).then(function () {
                    try {
                        self.ctx.stateController.resetState();
                    } catch (e) {
                        console.error('[DM] Navigate failed:', e);
                    }
                }).catch(function (err) {
                    console.error('[DM] Delete failed:', err);
                    deleteState = 'idle';
                    render();
                });
                break;
        }
    }

    // ── Save Device ─────────────────────────────────────────────

    function saveDevice() {
        if (isSaving || !deviceEntity) return;

        var nameInput = container.querySelector('#edit-name');
        var labelInput = container.querySelector('#edit-label');
        var newName = nameInput ? nameInput.value.trim() : deviceEntity.name;
        var newLabel = labelInput ? labelInput.value.trim() : (deviceEntity.label || '');

        isSaving = true;
        render();

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
        fetchParentSite()
    ]).then(function (results) {
        deviceEntity = results[0];
        // Extract lastActivity from additionalInfo
        if (deviceEntity && deviceEntity.additionalInfo && deviceEntity.additionalInfo.lastActivityTime) {
            deviceLastActivity = deviceEntity.additionalInfo.lastActivityTime;
        }
        deviceOnline = deviceLastActivity > 0 && (Date.now() - deviceLastActivity) < 600000;
        var followUp = [];
        if (deviceEntity && deviceEntity.deviceProfileId) {
            followUp.push(apiGet('/deviceProfile/' + deviceEntity.deviceProfileId.id).then(function (p) {
                deviceProfile = p;
            }));
        }
        if (deviceEntity && deviceEntity.customerId && deviceEntity.customerId.id &&
            deviceEntity.customerId.id !== '13814000-1dd2-11b2-8080-808080808080') {
            followUp.push(apiGet('/customer/' + deviceEntity.customerId.id).then(function (c) {
                deviceEntity.customerTitle = c.title;
            }).catch(function () {}));
        }
        return Promise.all(followUp);
    }).then(function () {
        render();
    }).catch(function (err) {
        console.error('[DM] Init failed:', err);
        container.innerHTML = '<div class="dm-error">' +
            '<div class="dm-error-icon">&#9888;</div>' +
            '<div class="dm-error-text">Failed to load device data</div></div>';
    });
};

self.onDataUpdated = function () {};
self.onResize = function () {};
self.onDestroy = function () {};
