// SignConnect Management Navigation Tree — Controller
// Tenant-admin sidebar for the Management Dashboard.
// Root: ALL customers (via /api/customers). Hierarchy: Customer > Estate > Region > Site > Device.
// Navigation: stateController.openState() (same-dashboard state transitions).

self.onInit = function() {
    self.$container = self.ctx.$container;
    self.treeEl = self.$container.find('.mnt-tree');
    self.loadingEl = self.$container.find('.mnt-loading');
    self.emptyEl = self.$container.find('.mnt-empty');
    self.searchInput = self.$container.find('.mnt-search-input');
    self.footerStats = self.$container.find('.mnt-footer-stats');
    self.brandEl = self.$container.find('.mnt-brand');

    self.settings = {
        brandName: self.ctx.settings.brandName || 'SIGNCONNECT',
        showSearch: self.ctx.settings.showSearch !== false,
        showStatusIndicators: self.ctx.settings.showStatusIndicators !== false,
        showFooterSummary: self.ctx.settings.showFooterSummary !== false,
        onlineThresholdMinutes: self.ctx.settings.onlineThresholdMinutes || 10,
        pollIntervalSeconds: self.ctx.settings.pollIntervalSeconds || 60
    };

    self.brandEl.text(self.settings.brandName);

    if (!self.settings.showSearch) {
        self.$container.find('.mnt-search').hide();
    }
    if (!self.settings.showFooterSummary) {
        self.$container.find('.mnt-footer').hide();
    }

    // Caches
    self.childrenCache = {};   // parentId -> { children, fetchedAt }
    self.deviceCache = {};     // siteId -> { devices, fetchedAt }
    self.assetCache = {};      // assetId -> { id, name, type }
    self.fetchInProgress = {};

    // Tree state — restore from sessionStorage if available
    var storageKey = 'mnt_expanded_' + (self.ctx.dashboard ? self.ctx.dashboard.id : 'mgmt');
    self.storageKey = storageKey;
    var saved = null;
    try { saved = JSON.parse(sessionStorage.getItem(storageKey)); } catch (e) { /* ignore */ }
    self.expandedNodes = saved || {};
    self.treeData = [];        // root-level customer nodes
    self.allDeviceStats = { total: 0, online: 0, offline: 0, faults: 0 };
    self.searchQuery = '';
    self.searchSavedState = null;
    self.pollTimer = null;
    self.searchTimer = null;

    // Show loading skeleton
    self.loadingEl.show();
    self.treeEl.hide();
    self.emptyEl.hide();

    // Load all customers
    self.loadCustomers().then(function() {
        self.loadingEl.hide();
        if (self.treeData.length === 0) {
            self.emptyEl.show();
        } else {
            self.treeEl.show();
            self.renderTree();
        }
    }).catch(function(err) {
        console.error('[MNT] Init failed:', err);
        self.loadingEl.hide();
        self.emptyEl.text('Failed to load customers').show();
    });

    // Bind search
    self.searchInput.on('input', function() {
        var query = $(this).val();
        if (self.searchTimer) clearTimeout(self.searchTimer);
        self.searchTimer = setTimeout(function() {
            self.filterTree(query);
        }, 300);
    });

    // Home button
    self.$container.find('.mnt-home-row').on('click', function() {
        self.navigateHome();
    });

    // New Customer button
    self.$container.find('.mnt-new-customer-row').on('click', function() {
        self.navigateToOnboarding();
    });

    // Clients section toggle
    self.clientsCollapsed = false;
    self.clientsLabelEl = self.$container.find('.mnt-clients-label');
    self.clientsChevronEl = self.$container.find('.mnt-clients-chevron');
    self.treeContainerEl = self.$container.find('.mnt-tree-container');

    self.clientsLabelEl.find('.mnt-clients-row').on('click', function() {
        self.clientsCollapsed = !self.clientsCollapsed;
        if (self.clientsCollapsed) {
            self.treeContainerEl.slideUp(200);
            self.clientsChevronEl.addClass('mnt-clients-collapsed');
        } else {
            self.treeContainerEl.slideDown(200);
            self.clientsChevronEl.removeClass('mnt-clients-collapsed');
        }
    });

    // Highlight active nav link
    self.updateNavHighlight();

    // Device status polling
    if (self.settings.showStatusIndicators && self.settings.pollIntervalSeconds > 0) {
        self.pollTimer = setInterval(function() {
            self.refreshDeviceStatuses();
        }, self.settings.pollIntervalSeconds * 1000);
    }
};

// ── API Helpers ─────────────────────────────────────────────

self.apiGet = function(path) {
    var obs = self.ctx.http.get('/api' + path);
    if (obs && typeof obs.toPromise === 'function') return obs.toPromise();
    return new Promise(function(resolve, reject) {
        obs.subscribe(function(d) { resolve(d); }, function(e) { reject(e); });
    });
};

// ── Customer Loading (Tenant-Level) ────────────────────────

self.loadCustomers = function() {
    return self.apiGet('/customers?pageSize=1000&page=0&sortProperty=title&sortOrder=ASC').then(function(resp) {
        var data = (resp && resp.data) ? resp.data : (Array.isArray(resp) ? resp : []);
        var customers = [];
        data.forEach(function(c) {
            if (!c || !c.id) return;
            var node = {
                id: c.id.id,
                name: c.title || c.name || 'Customer',
                type: 'customer',
                entityType: 'CUSTOMER',
                level: 0,
                children: null,
                deviceCount: null,
                deviceStats: null
            };
            customers.push(node);
        });
        customers.sort(function(a, b) { return a.name.localeCompare(b.name); });
        self.treeData = customers;
    }).catch(function(err) {
        console.error('[MNT] Failed to load customers:', err);
        self.treeData = [];
    });
};

// ── Children Loading (Assets under Customer or Asset) ──────

self.loadCustomerAssets = function(customerId) {
    var cacheKey = 'cust_' + customerId;
    var cached = self.childrenCache[cacheKey];
    if (cached && (Date.now() - cached.fetchedAt) < 300000) {
        return Promise.resolve(cached.children);
    }
    if (self.fetchInProgress[cacheKey]) return self.fetchInProgress[cacheKey];

    var promise = self.apiGet('/customer/' + customerId + '/assets?pageSize=1000&page=0').then(function(resp) {
        var data = (resp && resp.data) ? resp.data : (Array.isArray(resp) ? resp : []);
        var estates = [];
        data.forEach(function(a) {
            if (!a || !a.id) return;
            var t = (a.type || '').toLowerCase();
            if (t === 'estate') {
                estates.push({
                    id: a.id.id,
                    name: a.name,
                    type: 'estate',
                    entityType: 'ASSET',
                    level: 1,
                    children: null,
                    deviceCount: null
                });
                self.assetCache[a.id.id] = { id: a.id.id, name: a.name, type: 'estate' };
            }
        });
        estates.sort(function(a, b) { return a.name.localeCompare(b.name); });
        self.childrenCache[cacheKey] = { children: estates, fetchedAt: Date.now() };
        delete self.fetchInProgress[cacheKey];
        return estates;
    }).catch(function(err) {
        console.error('[MNT] Failed to load customer assets:', err);
        delete self.fetchInProgress[cacheKey];
        return [];
    });

    self.fetchInProgress[cacheKey] = promise;
    return promise;
};

self.loadAssetChildren = function(parentId, typeFilter, level) {
    var cacheKey = parentId + '_' + typeFilter;
    var cached = self.childrenCache[cacheKey];
    if (cached && (Date.now() - cached.fetchedAt) < 300000) {
        return Promise.resolve(cached.children);
    }
    if (self.fetchInProgress[cacheKey]) return self.fetchInProgress[cacheKey];

    var url = '/relations?fromId=' + parentId + '&fromType=ASSET&relationType=Contains';
    var promise = self.apiGet(url).then(function(rels) {
        var assetIds = [];
        (Array.isArray(rels) ? rels : []).forEach(function(r) {
            if (r.to && r.to.entityType === 'ASSET') assetIds.push(r.to.id);
        });
        if (assetIds.length === 0) {
            self.childrenCache[cacheKey] = { children: [], fetchedAt: Date.now() };
            delete self.fetchInProgress[cacheKey];
            return [];
        }
        var promises = assetIds.map(function(id) {
            return self.apiGet('/asset/' + id).catch(function() { return null; });
        });
        return Promise.all(promises).then(function(assets) {
            var result = [];
            assets.forEach(function(a) {
                if (!a) return;
                var t = (a.type || '').toLowerCase();
                if (t.indexOf(typeFilter) !== -1) {
                    result.push({
                        id: a.id.id,
                        name: a.name,
                        type: typeFilter,
                        entityType: 'ASSET',
                        level: level,
                        children: null,
                        deviceCount: null
                    });
                    self.assetCache[a.id.id] = { id: a.id.id, name: a.name, type: typeFilter };
                }
            });
            result.sort(function(a, b) { return a.name.localeCompare(b.name); });
            self.childrenCache[cacheKey] = { children: result, fetchedAt: Date.now() };
            delete self.fetchInProgress[cacheKey];
            return result;
        });
    }).catch(function(err) {
        console.error('[MNT] Failed to load children:', err);
        delete self.fetchInProgress[cacheKey];
        return [];
    });

    self.fetchInProgress[cacheKey] = promise;
    return promise;
};

// ── Device Loading ─────────────────────────────────────────

self.loadDevices = function(siteId) {
    var cached = self.deviceCache[siteId];
    if (cached && (Date.now() - cached.fetchedAt) < 30000) {
        return Promise.resolve(cached.devices);
    }
    var key = 'devices_' + siteId;
    if (self.fetchInProgress[key]) return self.fetchInProgress[key];

    var url = '/relations?fromId=' + siteId + '&fromType=ASSET&relationType=Contains';
    var promise = self.apiGet(url).then(function(rels) {
        var devices = [];
        (Array.isArray(rels) ? rels : []).forEach(function(r) {
            if (r.to && r.to.entityType === 'DEVICE') {
                devices.push({ id: r.to.id, name: '', lastTs: 0, fault: false });
            }
        });
        if (devices.length === 0) {
            self.deviceCache[siteId] = { devices: [], fetchedAt: Date.now() };
            delete self.fetchInProgress[key];
            return [];
        }
        var namePromises = devices.map(function(d) {
            return self.apiGet('/device/' + d.id).then(function(dev) {
                d.name = dev.name || 'Device';
                return d;
            }).catch(function() { d.name = 'Device'; return d; });
        });
        return Promise.all(namePromises).then(function(named) {
            return self.enrichDevices(named);
        }).then(function(enriched) {
            enriched.sort(function(a, b) { return a.name.localeCompare(b.name); });
            self.deviceCache[siteId] = { devices: enriched, fetchedAt: Date.now() };
            delete self.fetchInProgress[key];
            return enriched;
        });
    }).catch(function(err) {
        console.error('[MNT] Failed to load devices:', err);
        delete self.fetchInProgress[key];
        return [];
    });

    self.fetchInProgress[key] = promise;
    return promise;
};

self.enrichDevices = function(devices) {
    if (devices.length === 0) return Promise.resolve(devices);
    var promises = devices.map(function(device) {
        if (device.lastTs > 0 || device.fault) return Promise.resolve(device);
        var url = '/plugins/telemetry/DEVICE/' + device.id +
                  '/values/timeseries?keys=dim_value,fault_overall_failure';
        return self.apiGet(url).then(function(telemetry) {
            if (telemetry) {
                if (telemetry.dim_value && telemetry.dim_value.length > 0) {
                    device.lastTs = telemetry.dim_value[0].ts;
                }
                if (telemetry.fault_overall_failure && telemetry.fault_overall_failure.length > 0) {
                    var val = telemetry.fault_overall_failure[0].value;
                    device.fault = (val === true || val === 'true' || val === '1' || val === 1);
                }
            }
            return device;
        }).catch(function() { return device; });
    });
    return Promise.all(promises);
};

// ── Tree Rendering ─────────────────────────────────────────

self.renderTree = function() {
    var html = '';
    self.treeData.forEach(function(node) {
        html += self.buildTreeNode(node);
    });
    self.treeEl.html(html);
    self.bindTreeEvents();
    self.updateFooterStats();
    self.persistExpandState();
};

self.buildTreeNode = function(node) {
    var isExpanded = !!self.expandedNodes[node.id];
    var chevronClass = isExpanded ? 'mnt-chevron-expanded' : '';
    var childrenStyle = isExpanded ? '' : 'display:none;';
    var indent = node.level * 16;
    var icon = self.getNodeIcon(node.type);
    var levelClass = ' mnt-level-' + node.level;

    var childCountBadge = '';
    if (node.children && node.children.length > 0) {
        childCountBadge = '<span class="mnt-badge">' + node.children.length + '</span>';
    } else if (node.deviceCount !== null && node.type === 'site') {
        childCountBadge = '<span class="mnt-badge">' + node.deviceCount + '</span>';
    }

    var statusHtml = '';
    if (self.settings.showStatusIndicators && node.type === 'site' && node.deviceStats) {
        var s = node.deviceStats;
        statusHtml = self.buildStatusIndicator(s.online, s.total, s.faults);
    }

    var html = '<div class="mnt-node" data-id="' + node.id + '" data-type="' + node.type + '" data-level="' + node.level + '">';
    html += '<div class="mnt-node-row' + levelClass + '" data-id="' + node.id + '" style="padding-left:' + (12 + indent) + 'px;">';

    if (node.type !== 'device') {
        // Chevron zone
        html += '<span class="mnt-chevron-zone">';
        html += '<span class="mnt-chevron ' + chevronClass + '">&#9654;</span>';
        html += '</span>';

        // Label zone — click navigates to entity state
        html += '<span class="mnt-label-zone" data-id="' + node.id + '" data-type="' + node.type + '" data-entity-type="' + (node.entityType || 'ASSET') + '">';
        html += '<span class="mnt-icon">' + icon + '</span>';
        html += '<span class="mnt-label">' + self.esc(node.name) + '</span>';
        html += childCountBadge;
        html += statusHtml;
        html += '</span>';
    } else {
        // Device rows
        html += '<span class="mnt-chevron-spacer"></span>';
        html += '<span class="mnt-label-zone" data-id="' + node.id + '" data-type="device" data-entity-type="DEVICE">';
        html += '<span class="mnt-icon">' + icon + '</span>';
        html += '<span class="mnt-label">' + self.esc(node.name) + '</span>';
        html += self.buildDeviceStatusDot(node);
        html += '</span>';
    }

    html += '</div>';

    // Children container
    html += '<div class="mnt-children" style="' + childrenStyle + '">';
    if (isExpanded && node.children) {
        node.children.forEach(function(child) {
            html += self.buildTreeNode(child);
        });
    }
    if (isExpanded && node.type === 'site' && node.devices) {
        node.devices.forEach(function(device) {
            html += self.buildDeviceNode(device, node.level + 1);
        });
    }
    html += '</div>';
    html += '</div>';

    return html;
};

self.buildDeviceNode = function(device, level) {
    var indent = level * 16;
    var statusDot = self.buildDeviceStatusDot(device);

    var html = '<div class="mnt-node mnt-node-device" data-id="' + device.id + '" data-type="device" data-level="' + level + '">';
    html += '<div class="mnt-node-row mnt-level-' + level + '" data-id="' + device.id + '" style="padding-left:' + (12 + indent) + 'px;">';
    html += '<span class="mnt-chevron-spacer"></span>';
    html += '<span class="mnt-label-zone" data-id="' + device.id + '" data-type="device" data-entity-type="DEVICE">';
    html += '<span class="mnt-icon">&#9671;</span>';
    html += '<span class="mnt-label">' + self.esc(device.name) + '</span>';
    html += statusDot;
    html += '</span>';
    html += '</div>';
    html += '</div>';

    return html;
};

self.buildStatusIndicator = function(online, total, faults) {
    if (total === 0) return '';
    var dotClass = 'mnt-status-dot-online';
    if (faults > 0) dotClass = 'mnt-status-dot-fault';
    else if (online === 0) dotClass = 'mnt-status-dot-offline';
    else if (online < total) dotClass = 'mnt-status-dot-partial';
    return '<span class="mnt-status">' + online + '/' + total +
           ' <span class="' + dotClass + '"></span></span>';
};

self.buildDeviceStatusDot = function(device) {
    if (!self.settings.showStatusIndicators) return '';
    var now = Date.now();
    var thresholdMs = self.settings.onlineThresholdMinutes * 60 * 1000;
    if (device.fault) {
        return '<span class="mnt-device-dot mnt-status-dot-fault" title="Fault"></span>';
    }
    if (device.lastTs > 0 && (now - device.lastTs) < thresholdMs) {
        return '<span class="mnt-device-dot mnt-status-dot-online" title="Online"></span>';
    }
    return '<span class="mnt-device-dot mnt-status-dot-offline" title="Offline"></span>';
};

self.getNodeIcon = function(type) {
    switch (type) {
        case 'customer': return '&#9733;';  // star
        case 'estate':   return '&#9632;';  // filled square
        case 'region':   return '&#9670;';  // diamond
        case 'site':     return '&#9679;';  // filled circle
        case 'device':   return '&#9671;';  // hollow diamond
        default:         return '&#9642;';  // small filled square
    }
};

// ── Tree Events ────────────────────────────────────────────

self.bindTreeEvents = function() {
    // Chevron zone click → expand/collapse
    self.treeEl.find('.mnt-chevron-zone').off('click').on('click', function(e) {
        e.stopPropagation();
        var nodeEl = $(this).closest('.mnt-node');
        self.toggleNode(nodeEl.data('id'), nodeEl.data('type'), nodeEl);
    });

    // Label zone click → navigate to entity
    self.treeEl.find('.mnt-label-zone').off('click').on('click', function(e) {
        e.stopPropagation();
        var id = $(this).data('id');
        var type = $(this).data('type');
        var entityType = $(this).data('entity-type') || 'ASSET';
        var name = $(this).find('.mnt-label').first().text();
        self.navigateToEntity(id, name, entityType, type);
    });
};

self.toggleNode = function(nodeId, nodeType, nodeEl) {
    var childrenEl = nodeEl.find('> .mnt-children').first();
    var chevronEl = nodeEl.find('> .mnt-node-row .mnt-chevron').first();

    if (self.expandedNodes[nodeId]) {
        delete self.expandedNodes[nodeId];
        childrenEl.slideUp(200);
        chevronEl.removeClass('mnt-chevron-expanded');
        self.persistExpandState();
        return;
    }

    self.expandedNodes[nodeId] = true;
    chevronEl.addClass('mnt-chevron-expanded');
    self.persistExpandState();

    var node = self.findNodeById(nodeId);
    if (!node) return;

    var hasChildren = (node.children && node.children.length > 0);
    var hasDevices = (node.type === 'site' && node.devices && node.devices.length > 0);

    if (hasChildren || hasDevices || node.children === false) {
        childrenEl.slideDown(200);
        if (hasChildren || hasDevices) {
            self.renderChildrenInto(childrenEl, node);
        }
        return;
    }

    // Lazy-load
    childrenEl.html('<div class="mnt-node-loading">Loading...</div>').slideDown(200);

    if (nodeType === 'customer') {
        self.loadCustomerAssets(nodeId).then(function(estates) {
            node.children = estates.length > 0 ? estates : false;
            self.renderChildrenInto(childrenEl, node);
        });
    } else if (nodeType === 'estate') {
        self.loadAssetChildren(nodeId, 'region', node.level + 1).then(function(regions) {
            node.children = regions.length > 0 ? regions : false;
            self.renderChildrenInto(childrenEl, node);
        });
    } else if (nodeType === 'region') {
        self.loadAssetChildren(nodeId, 'site', node.level + 1).then(function(sites) {
            node.children = sites.length > 0 ? sites : false;
            self.renderChildrenInto(childrenEl, node);
        });
    } else if (nodeType === 'site') {
        self.loadDevices(nodeId).then(function(devices) {
            node.devices = devices;
            node.deviceCount = devices.length;
            node.deviceStats = self.computeDeviceStats(devices);
            self.renderChildrenInto(childrenEl, node);
            self.updateFooterStats();
        });
    }
};

self.renderChildrenInto = function(childrenEl, node) {
    var html = '';
    if (node.children && node.children !== false) {
        node.children.forEach(function(child) {
            html += self.buildTreeNode(child);
        });
    }
    if (node.type === 'site' && node.devices) {
        node.devices.forEach(function(device) {
            html += self.buildDeviceNode(device, node.level + 1);
        });
    }
    if (!html) {
        html = '<div class="mnt-node-empty">No items</div>';
    }
    childrenEl.html(html);
    self.bindTreeEvents();
};

self.findNodeById = function(nodeId) {
    return self.findNodeInList(self.treeData, nodeId);
};

self.findNodeInList = function(nodes, nodeId) {
    for (var i = 0; i < nodes.length; i++) {
        if (nodes[i].id === nodeId) return nodes[i];
        if (nodes[i].children && nodes[i].children !== false) {
            var found = self.findNodeInList(nodes[i].children, nodeId);
            if (found) return found;
        }
    }
    return null;
};

self.computeDeviceStats = function(devices) {
    var now = Date.now();
    var thresholdMs = self.settings.onlineThresholdMinutes * 60 * 1000;
    var stats = { total: devices.length, online: 0, offline: 0, faults: 0 };
    devices.forEach(function(d) {
        if (d.lastTs > 0 && (now - d.lastTs) < thresholdMs) stats.online++;
        else stats.offline++;
        if (d.fault) stats.faults++;
    });
    return stats;
};

// ── Navigation ─────────────────────────────────────────────

self.navigateHome = function() {
    try {
        var sc = self.ctx.stateController;
        if (sc && sc.resetState) {
            sc.resetState();
            return;
        }
    } catch (e) { /* fallback */ }
    // Fallback: reload dashboard
    window.location.reload();
};

self.navigateToOnboarding = function() {
    try {
        var sc = self.ctx.stateController;
        if (sc && sc.openState) {
            sc.resetState();
            sc.openState('onboarding', {});
            self.updateNavHighlight();
            return;
        }
    } catch (e) {
        console.error('[MNT] Failed to navigate to onboarding:', e);
    }
};

self.navigateToEntity = function(entityId, entityName, entityType, nodeType) {
    var stateId = '';
    if (nodeType === 'customer') stateId = 'customer';
    else if (nodeType === 'site') stateId = 'site';
    else if (nodeType === 'device') stateId = 'device';
    else {
        // For estate/region — no dedicated state yet, just log
        console.log('[MNT] No state defined for type:', nodeType, entityId);
        return;
    }

    try {
        var sc = self.ctx.stateController;
        if (sc && sc.openState) {
            sc.resetState();
            sc.openState(stateId, {
                entityId: { id: entityId, entityType: entityType },
                entityName: entityName
            });
            return;
        }
    } catch (e) {
        console.error('[MNT] Failed to navigate:', e);
    }
};

self.updateNavHighlight = function() {
    self.$container.find('.mnt-nav-row').removeClass('mnt-nav-active');
    var currentState = '';
    try {
        var sc = self.ctx.stateController;
        if (sc && sc.getStateId) {
            currentState = sc.getStateId() || 'default';
        }
    } catch (e) { /* ignore */ }

    if (!currentState || currentState === 'default') {
        self.$container.find('.mnt-home-row').addClass('mnt-nav-active');
    }
};

// ── Footer Stats ───────────────────────────────────────────

self.updateFooterStats = function() {
    if (!self.settings.showFooterSummary) return;
    var stats = { total: 0, online: 0, offline: 0, faults: 0 };
    self.aggregateStats(self.treeData, stats);
    self.allDeviceStats = stats;

    var html = '<span class="mnt-footer-item mnt-footer-total">' + self.treeData.length + ' customers</span>';
    if (stats.total > 0) {
        html += '<span class="mnt-footer-item">' + stats.total + ' devices</span>';
        if (stats.online > 0) {
            html += '<span class="mnt-footer-item"><span class="mnt-status-dot-online"></span>' + stats.online + '</span>';
        }
        if (stats.faults > 0) {
            html += '<span class="mnt-footer-item"><span class="mnt-status-dot-fault"></span>' + stats.faults + '</span>';
        }
    }
    self.footerStats.html(html);
};

self.aggregateStats = function(nodes, stats) {
    nodes.forEach(function(node) {
        if (node.deviceStats) {
            stats.total += node.deviceStats.total;
            stats.online += node.deviceStats.online;
            stats.offline += node.deviceStats.offline;
            stats.faults += node.deviceStats.faults;
        }
        if (node.children && node.children !== false) {
            self.aggregateStats(node.children, stats);
        }
    });
};

// ── Search / Filter ────────────────────────────────────────

self.filterTree = function(query) {
    query = (query || '').trim().toLowerCase();

    if (!query) {
        if (self.searchSavedState) {
            self.expandedNodes = self.searchSavedState;
            self.searchSavedState = null;
        }
        self.searchQuery = '';
        self.treeEl.find('.mnt-node').show();
        self.treeEl.find('.mnt-children').each(function() {
            var nodeId = $(this).parent().data('id');
            if (!self.expandedNodes[nodeId]) $(this).hide();
        });
        return;
    }

    if (!self.searchSavedState) {
        self.searchSavedState = Object.assign({}, self.expandedNodes);
    }

    self.searchQuery = query;
    self.treeEl.find('.mnt-node').hide();
    self.treeEl.find('.mnt-children').show();

    self.treeEl.find('.mnt-label').each(function() {
        var label = $(this).text().toLowerCase();
        if (label.indexOf(query) !== -1) {
            var nodeEl = $(this).closest('.mnt-node');
            nodeEl.show();
            nodeEl.parents('.mnt-node').show();
            nodeEl.parents('.mnt-children').show();
        }
    });
};

// ── Device Status Polling ──────────────────────────────────

self.refreshDeviceStatuses = function() {
    var siteIds = Object.keys(self.deviceCache);
    if (siteIds.length === 0) return;
    siteIds.forEach(function(id) { delete self.deviceCache[id]; });

    var promises = [];
    siteIds.forEach(function(siteId) {
        var node = self.findNodeById(siteId);
        if (node && self.expandedNodes[siteId]) {
            promises.push(
                self.loadDevices(siteId).then(function(devices) {
                    node.devices = devices;
                    node.deviceCount = devices.length;
                    node.deviceStats = self.computeDeviceStats(devices);
                })
            );
        }
    });

    if (promises.length > 0) {
        Promise.all(promises).then(function() { self.renderTree(); });
    }
};

// ── Session Storage Persistence ────────────────────────────

self.persistExpandState = function() {
    try {
        sessionStorage.setItem(self.storageKey, JSON.stringify(self.expandedNodes));
    } catch (e) { /* ignore */ }
};

// ── Utilities ──────────────────────────────────────────────

self.esc = function(text) {
    if (!text) return '';
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
};

// ── Lifecycle ──────────────────────────────────────────────

self.onDataUpdated = function() {};

self.onResize = function() {};

self.onDestroy = function() {
    if (self.pollTimer) {
        clearInterval(self.pollTimer);
        self.pollTimer = null;
    }
    if (self.searchTimer) {
        clearTimeout(self.searchTimer);
        self.searchTimer = null;
    }
    self.treeEl.find('.mnt-chevron-zone').off('click');
    self.treeEl.find('.mnt-label-zone').off('click');
    self.searchInput.off('input');
    self.clientsLabelEl.find('.mnt-clients-row').off('click');
    self.$container.find('.mnt-home-row').off('click');
    self.$container.find('.mnt-new-customer-row').off('click');
    self.brandEl.off('click');
};
