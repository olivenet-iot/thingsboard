// SignConnect Navigation Tree Widget — Controller
// Static widget — no datasource. Provides a dynamic, expandable asset
// hierarchy (Estate > Region > Site > Device) for sidebar navigation.
// Lazy-loads children on expand, enriches devices with telemetry status,
// and navigates to tier-aware dashboards.

self.onInit = function() {
    self.$container = self.ctx.$container;
    self.treeEl = self.$container.find('.nt-tree');
    self.loadingEl = self.$container.find('.nt-loading');
    self.emptyEl = self.$container.find('.nt-empty');
    self.searchInput = self.$container.find('.nt-search-input');
    self.footerStats = self.$container.find('.nt-footer-stats');
    self.brandEl = self.$container.find('.nt-brand');

    self.settings = {
        brandName: self.ctx.settings.brandName || 'SIGNCONNECT',
        fleetDashboardId: self.ctx.settings.fleetDashboardId || 'b6d83390-0c08-11f1-9f20-c3880cf3b963',
        standardDashboardId: self.ctx.settings.standardDashboardId || '57108320-0764-11f1-9f20-c3880cf3b963',
        plusDashboardId: self.ctx.settings.plusDashboardId || '549a40a0-0f33-11f1-9f20-c3880cf3b963',
        defaultTier: self.ctx.settings.defaultTier || 'standard',
        showSearch: self.ctx.settings.showSearch !== false,
        showDevices: self.ctx.settings.showDevices !== false,
        showStatusIndicators: self.ctx.settings.showStatusIndicators !== false,
        showFooterSummary: self.ctx.settings.showFooterSummary !== false,
        onlineThresholdMinutes: self.ctx.settings.onlineThresholdMinutes || 10,
        pollIntervalSeconds: self.ctx.settings.pollIntervalSeconds || 60
    };

    self.brandEl.text(self.settings.brandName);

    if (!self.settings.showSearch) {
        self.$container.find('.nt-search').hide();
    }
    if (!self.settings.showFooterSummary) {
        self.$container.find('.nt-footer').hide();
    }

    // Caches
    self.childrenCache = {};   // parentId -> { children: [...], fetchedAt }
    self.deviceCache = {};     // siteId -> { devices: [...], fetchedAt }
    self.tierCache = {};       // assetId -> { tier, fetchedAt }
    self.assetCache = {};      // assetId -> { id, name, type }
    self.fetchInProgress = {};

    // Tree state
    self.expandedNodes = {};   // nodeId -> true
    self.treeData = [];        // root-level estate nodes
    self.allDeviceStats = { total: 0, online: 0, offline: 0, faults: 0 };
    self.searchQuery = '';
    self.searchSavedState = null;
    self.pollTimer = null;
    self.searchTimer = null;

    // Show loading skeleton
    self.loadingEl.show();
    self.treeEl.hide();
    self.emptyEl.hide();

    // Detect customer and load estates
    self.getCustomerId().then(function(customerId) {
        self.customerId = customerId;
        if (!customerId) {
            self.loadingEl.hide();
            self.emptyEl.text('No customer ID found').show();
            return;
        }
        return self.loadEstates();
    }).then(function() {
        self.loadingEl.hide();
        if (self.treeData.length === 0) {
            self.emptyEl.show();
        } else {
            self.treeEl.show();
            self.renderTree();
            self.updateActiveHighlight();
        }
    }).catch(function(err) {
        console.error('[NAV-TREE] Init failed:', err);
        self.loadingEl.hide();
        self.emptyEl.text('Failed to load navigation').show();
    });

    // Bind search input
    self.searchInput.on('input', function() {
        var query = $(this).val();
        if (self.searchTimer) clearTimeout(self.searchTimer);
        self.searchTimer = setTimeout(function() {
            self.filterTree(query);
        }, 300);
    });

    // Bind collapse-all button
    self.$container.find('.nt-collapse-all').on('click', function() {
        self.expandedNodes = {};
        self.renderTree();
    });

    // Start device status polling
    if (self.settings.showStatusIndicators && self.settings.pollIntervalSeconds > 0) {
        self.pollTimer = setInterval(function() {
            self.refreshDeviceStatuses();
        }, self.settings.pollIntervalSeconds * 1000);
    }
};

// ── Customer ID Detection ──────────────────────────────────────

self.getCustomerId = function() {
    // 1. Try currentUser.customerId
    try {
        var cu = self.ctx.currentUser;
        if (cu && cu.customerId && cu.customerId.id &&
            cu.customerId.id !== '13814000-1dd2-11b2-8080-808080808080') {
            return Promise.resolve(cu.customerId.id);
        }
    } catch (e) { /* ignore */ }

    // 2. Fallback: GET /api/auth/user
    return self.ctx.http.get('/api/auth/user').toPromise().then(function(user) {
        if (user && user.customerId && user.customerId.id &&
            user.customerId.id !== '13814000-1dd2-11b2-8080-808080808080') {
            return user.customerId.id;
        }
        // 3. Fallback: widget setting
        return self.ctx.settings.customerId || null;
    }).catch(function() {
        return self.ctx.settings.customerId || null;
    });
};

// ── Estate Loading ─────────────────────────────────────────────

self.loadEstates = function() {
    var url = '/api/customer/' + self.customerId + '/assets?pageSize=1000&page=0';
    return self.ctx.http.get(url).toPromise().then(function(resp) {
        var data = resp.data || resp;
        var estates = [];
        (Array.isArray(data) ? data : []).forEach(function(a) {
            if (a.type && a.type.toLowerCase() === 'estate') {
                var node = {
                    id: a.id.id,
                    name: a.name,
                    type: 'estate',
                    entityType: 'ASSET',
                    level: 0,
                    children: null,
                    deviceCount: null
                };
                estates.push(node);
                self.assetCache[a.id.id] = { id: a.id.id, name: a.name, type: 'estate' };
            }
        });
        estates.sort(function(a, b) { return a.name.localeCompare(b.name); });
        self.treeData = estates;
    }).catch(function(err) {
        console.error('[NAV-TREE] Failed to load estates:', err);
        self.treeData = [];
    });
};

// ── Children Loading ───────────────────────────────────────────

self.loadChildren = function(parentId, typeFilter) {
    var cacheKey = parentId + '_' + typeFilter;
    var cached = self.childrenCache[cacheKey];
    if (cached && (Date.now() - cached.fetchedAt) < 300000) {
        return Promise.resolve(cached.children);
    }

    var key = 'children_' + cacheKey;
    if (self.fetchInProgress[key]) {
        return self.fetchInProgress[key];
    }

    var url = '/api/relations?fromId=' + parentId + '&fromType=ASSET&relationType=Contains';
    var promise = self.ctx.http.get(url).toPromise().then(function(rels) {
        var assetIds = [];
        (Array.isArray(rels) ? rels : []).forEach(function(r) {
            if (r.to && r.to.entityType === 'ASSET') {
                assetIds.push(r.to.id);
            }
        });
        if (assetIds.length === 0) {
            self.childrenCache[cacheKey] = { children: [], fetchedAt: Date.now() };
            delete self.fetchInProgress[key];
            return [];
        }

        var promises = assetIds.map(function(id) {
            return self.ctx.http.get('/api/asset/' + id).toPromise().catch(function() { return null; });
        });
        return Promise.all(promises).then(function(assets) {
            var result = [];
            assets.forEach(function(a) {
                if (!a) return;
                var t = (a.type || '').toLowerCase();
                if (t.indexOf(typeFilter) !== -1) {
                    var level = typeFilter === 'region' ? 1 : (typeFilter === 'site' ? 2 : 0);
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
            delete self.fetchInProgress[key];
            return result;
        });
    }).catch(function(err) {
        console.error('[NAV-TREE] Failed to load children:', err);
        delete self.fetchInProgress[key];
        return [];
    });

    self.fetchInProgress[key] = promise;
    return promise;
};

// ── Device Loading ─────────────────────────────────────────────

self.loadDevices = function(siteId) {
    var cached = self.deviceCache[siteId];
    if (cached && (Date.now() - cached.fetchedAt) < 30000) {
        return Promise.resolve(cached.devices);
    }

    var key = 'devices_' + siteId;
    if (self.fetchInProgress[key]) {
        return self.fetchInProgress[key];
    }

    var url = '/api/relations?fromId=' + siteId + '&fromType=ASSET&relationType=Contains';
    var promise = self.ctx.http.get(url).toPromise().then(function(rels) {
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

        // Fetch device names
        var namePromises = devices.map(function(d) {
            return self.ctx.http.get('/api/device/' + d.id).toPromise().then(function(dev) {
                d.name = dev.name || 'Device';
                return d;
            }).catch(function() {
                d.name = 'Device';
                return d;
            });
        });

        return Promise.all(namePromises).then(function(namedDevices) {
            return self.enrichDevices(namedDevices);
        }).then(function(enriched) {
            enriched.sort(function(a, b) { return a.name.localeCompare(b.name); });
            self.deviceCache[siteId] = { devices: enriched, fetchedAt: Date.now() };
            delete self.fetchInProgress[key];
            return enriched;
        });
    }).catch(function(err) {
        console.error('[NAV-TREE] Failed to load devices:', err);
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

        var url = '/api/plugins/telemetry/DEVICE/' + device.id +
                  '/values/timeseries?keys=dim_value,fault_overall_failure';
        return self.ctx.http.get(url).toPromise().then(function(telemetry) {
            if (telemetry) {
                if (telemetry.dim_value && telemetry.dim_value.length > 0) {
                    device.lastTs = telemetry.dim_value[0].ts;
                }
                if (telemetry.fault_overall_failure && telemetry.fault_overall_failure.length > 0) {
                    var val = telemetry.fault_overall_failure[0].value;
                    device.fault = (val === true || val === 'true' || val === '1');
                }
            }
            return device;
        }).catch(function() {
            return device;
        });
    });

    return Promise.all(promises);
};

// ── Tier Lookup ────────────────────────────────────────────────

self.getEntityTier = function(entityId) {
    var cached = self.tierCache[entityId];
    if (cached && (Date.now() - cached.fetchedAt) < 60000) {
        return Promise.resolve(cached.tier);
    }

    var key = 'tier_' + entityId;
    if (self.fetchInProgress[key]) {
        return self.fetchInProgress[key];
    }

    var url = '/api/plugins/telemetry/ASSET/' + entityId +
        '/values/attributes/SERVER_SCOPE?keys=dashboard_tier';
    var promise = self.ctx.http.get(url).toPromise().then(function(attrs) {
        var tier = self.settings.defaultTier;
        if (attrs && attrs.length > 0 && attrs[0].value) {
            tier = String(attrs[0].value).toLowerCase();
        }
        self.tierCache[entityId] = { tier: tier, fetchedAt: Date.now() };
        delete self.fetchInProgress[key];
        return tier;
    }).catch(function() {
        delete self.fetchInProgress[key];
        return self.settings.defaultTier;
    });

    self.fetchInProgress[key] = promise;
    return promise;
};

// ── Tree Rendering ─────────────────────────────────────────────

self.renderTree = function() {
    var html = '';
    self.treeData.forEach(function(node) {
        html += self.buildTreeNode(node);
    });
    self.treeEl.html(html);
    self.bindTreeEvents();
    self.updateFooterStats();
    self.updateActiveHighlight();
};

self.buildTreeNode = function(node) {
    var isExpanded = !!self.expandedNodes[node.id];
    var chevronClass = isExpanded ? 'nt-chevron-expanded' : '';
    var childrenStyle = isExpanded ? '' : 'display:none;';
    var indent = node.level * 20;
    var icon = self.getNodeIcon(node.type);
    var activeClass = self.isActiveNode(node.id) ? ' nt-node-active' : '';
    var levelClass = ' nt-level-' + node.level;

    var childCountBadge = '';
    if (node.children && node.children.length > 0) {
        childCountBadge = '<span class="nt-badge">' + node.children.length + '</span>';
    } else if (node.deviceCount !== null && node.type === 'site') {
        childCountBadge = '<span class="nt-badge">' + node.deviceCount + '</span>';
    }

    var statusHtml = '';
    if (self.settings.showStatusIndicators && node.type === 'site' && node.deviceStats) {
        var s = node.deviceStats;
        statusHtml = self.buildStatusIndicator(s.online, s.total, s.faults);
    }

    var html = '<div class="nt-node" data-id="' + node.id + '" data-type="' + node.type + '" data-level="' + node.level + '">';
    html += '<div class="nt-node-row' + levelClass + activeClass + '" data-id="' + node.id + '" style="padding-left:' + (12 + indent) + 'px;">';

    // Chevron for expandable nodes
    if (node.type !== 'device') {
        html += '<span class="nt-chevron ' + chevronClass + '">&#9654;</span>';
    } else {
        html += '<span class="nt-chevron-spacer"></span>';
    }

    html += '<span class="nt-icon">' + icon + '</span>';
    html += '<span class="nt-label">' + self.escapeHtml(node.name) + '</span>';
    html += childCountBadge;
    html += statusHtml;

    // Device-level status dot
    if (node.type === 'device') {
        html += self.buildDeviceStatusDot(node);
    }

    // Nav arrow for navigable (non-device) nodes
    if (node.type !== 'device') {
        html += '<span class="nt-nav-arrow">&#8250;</span>';
    }

    html += '</div>';

    // Children container
    html += '<div class="nt-children" style="' + childrenStyle + '">';
    if (isExpanded && node.children) {
        node.children.forEach(function(child) {
            html += self.buildTreeNode(child);
        });
    }
    // Render devices if this is an expanded site node
    if (isExpanded && node.type === 'site' && node.devices && self.settings.showDevices) {
        node.devices.forEach(function(device) {
            html += self.buildDeviceNode(device, node.level + 1);
        });
    }
    html += '</div>';
    html += '</div>';

    return html;
};

self.buildDeviceNode = function(device, level) {
    var indent = level * 20;
    var statusDot = self.buildDeviceStatusDot(device);
    var activeClass = self.isActiveNode(device.id) ? ' nt-node-active' : '';
    var levelClass = ' nt-level-' + level;

    var html = '<div class="nt-node nt-node-device" data-id="' + device.id + '" data-type="device" data-level="' + level + '">';
    html += '<div class="nt-node-row' + levelClass + activeClass + '" data-id="' + device.id + '" style="padding-left:' + (12 + indent) + 'px;">';
    html += '<span class="nt-chevron-spacer"></span>';
    html += '<span class="nt-icon nt-icon-device">&#9671;</span>';
    html += '<span class="nt-label">' + self.escapeHtml(device.name) + '</span>';
    html += statusDot;
    html += '</div>';
    html += '</div>';

    return html;
};

self.buildStatusIndicator = function(online, total, faults) {
    if (total === 0) return '';
    var dotClass = 'nt-status-dot-online';
    if (faults > 0) {
        dotClass = 'nt-status-dot-fault';
    } else if (online === 0) {
        dotClass = 'nt-status-dot-offline';
    } else if (online < total) {
        dotClass = 'nt-status-dot-partial';
    }
    return '<span class="nt-status">' + online + '/' + total +
           ' <span class="' + dotClass + '"></span></span>';
};

self.buildDeviceStatusDot = function(device) {
    if (!self.settings.showStatusIndicators) return '';
    var now = Date.now();
    var thresholdMs = self.settings.onlineThresholdMinutes * 60 * 1000;

    if (device.fault) {
        return '<span class="nt-device-dot nt-status-dot-fault" title="Fault"></span>';
    }
    if (device.lastTs > 0 && (now - device.lastTs) < thresholdMs) {
        return '<span class="nt-device-dot nt-status-dot-online" title="Online"></span>';
    }
    return '<span class="nt-device-dot nt-status-dot-offline" title="Offline"></span>';
};

self.getNodeIcon = function(type) {
    switch (type) {
        case 'estate': return '&#9632;';  // filled square
        case 'region': return '&#9670;';  // diamond
        case 'site':   return '&#9679;';  // filled circle
        case 'device': return '&#9671;';  // hollow diamond
        default:       return '&#9642;';  // small filled square
    }
};

// ── Tree Events ────────────────────────────────────────────────

self.bindTreeEvents = function() {
    // Chevron click → expand/collapse only
    self.treeEl.find('.nt-chevron').off('click').on('click', function(e) {
        e.stopPropagation();
        var nodeEl = $(this).closest('.nt-node');
        self.toggleNode(nodeEl.data('id'), nodeEl.data('type'), nodeEl);
    });

    // Row click → navigate to entity
    self.treeEl.find('.nt-node-row').off('click').on('click', function(e) {
        e.stopPropagation();
        var nodeEl = $(this).closest('.nt-node');
        var nodeType = nodeEl.data('type');
        var nodeId = $(this).data('id');
        var nodeName = nodeEl.find('> .nt-node-row .nt-label').first().text();

        if (nodeType === 'device') {
            self.navigateToEntity(nodeId, '', 'DEVICE', 'device');
        } else {
            self.navigateToEntity(nodeId, nodeName,
                'ASSET', nodeType);
        }
    });
};

self.toggleNode = function(nodeId, nodeType, nodeEl) {
    var childrenEl = nodeEl.find('> .nt-children').first();
    var chevronEl = nodeEl.find('> .nt-node-row .nt-chevron').first();

    if (self.expandedNodes[nodeId]) {
        // Collapse
        delete self.expandedNodes[nodeId];
        childrenEl.slideUp(200);
        chevronEl.removeClass('nt-chevron-expanded');
        return;
    }

    // Expand
    self.expandedNodes[nodeId] = true;
    chevronEl.addClass('nt-chevron-expanded');

    var node = self.findNodeById(nodeId);
    if (!node) return;

    // Already loaded children?
    var hasChildren = (node.children && node.children.length > 0);
    var hasDevices = (node.type === 'site' && node.devices && node.devices.length > 0);

    if (hasChildren || hasDevices || node.children === false) {
        // children === false means we already loaded and found none
        childrenEl.slideDown(200);
        if (hasChildren || hasDevices) {
            self.renderChildrenInto(childrenEl, node);
        }
        return;
    }

    // Need to lazy-load
    childrenEl.html('<div class="nt-node-loading">Loading...</div>').slideDown(200);

    var nextType = '';
    if (nodeType === 'estate') nextType = 'region';
    else if (nodeType === 'region') nextType = 'site';

    if (nodeType === 'site') {
        // Load devices
        self.loadDevices(nodeId).then(function(devices) {
            node.devices = devices;
            node.deviceCount = devices.length;
            node.deviceStats = self.computeDeviceStats(devices);
            self.renderChildrenInto(childrenEl, node);
            self.updateFooterStats();
            self.updateActiveHighlight();
        });
    } else if (nextType) {
        self.loadChildren(nodeId, nextType).then(function(children) {
            node.children = children.length > 0 ? children : false;
            self.renderChildrenInto(childrenEl, node);
            self.updateActiveHighlight();
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
    if (node.type === 'site' && node.devices && self.settings.showDevices) {
        node.devices.forEach(function(device) {
            html += self.buildDeviceNode(device, node.level + 1);
        });
    }
    if (!html) {
        html = '<div class="nt-node-empty">No items</div>';
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
        if (d.lastTs > 0 && (now - d.lastTs) < thresholdMs) {
            stats.online++;
        } else {
            stats.offline++;
        }
        if (d.fault) stats.faults++;
    });

    return stats;
};

// ── Navigation ─────────────────────────────────────────────────

self.navigateToEntity = function(entityId, entityName, entityType, level) {
    if (!entityName) {
        var cached = self.assetCache[entityId];
        entityName = cached ? cached.name : '';
    }

    if (level === 'estate') {
        var fleetId = self.settings.fleetDashboardId;
        if (!fleetId) {
            console.error('[NAV-TREE] No fleet dashboard configured');
            return;
        }
        var estateState = [
            { id: 'default', params: {} },
            { id: 'estate', params: {
                entityId: { id: entityId, entityType: 'ASSET' },
                entityName: entityName
            }}
        ];
        var estateParam = encodeURIComponent(self.objToBase64(estateState));
        window.location.href = '/dashboard/' + fleetId + '?state=' + estateParam;
        return;
    }

    if (level === 'region') {
        var fleetId = self.settings.fleetDashboardId;
        if (!fleetId) {
            console.error('[NAV-TREE] No fleet dashboard configured');
            return;
        }
        var parentEstate = self.findParentEstate(entityId);
        var regionState = [
            { id: 'default', params: {} }
        ];
        if (parentEstate) {
            regionState.push({ id: 'estate', params: {
                entityId: { id: parentEstate.id, entityType: 'ASSET' },
                entityName: parentEstate.name
            }});
        }
        regionState.push({ id: 'region', params: {
            entityId: { id: entityId, entityType: 'ASSET' },
            entityName: entityName
        }});
        var regionParam = encodeURIComponent(self.objToBase64(regionState));
        window.location.href = '/dashboard/' + fleetId + '?state=' + regionParam;
        return;
    }

    if (level === 'site') {
        // Cross-dashboard navigation based on tier
        self.getEntityTier(entityId).then(function(tier) {
            var dashboardId = tier === 'plus'
                ? self.settings.plusDashboardId
                : self.settings.standardDashboardId;

            if (!dashboardId) {
                console.error('[NAV-TREE] No dashboard configured for tier "' + tier + '"');
                return;
            }

            var stateArray = [{
                id: 'site',
                params: {
                    entityId: { id: entityId, entityType: 'ASSET' },
                    entityName: entityName
                }
            }];
            var stateParam = encodeURIComponent(self.objToBase64(stateArray));
            var url = '/dashboard/' + dashboardId + '?state=' + stateParam;

            window.location.href = url;
        });
        return;
    }

    if (level === 'device') {
        // Navigate to the parent site dashboard with device context
        // Find parent site by walking up the tree
        var parentSite = self.findParentSite(entityId);
        if (parentSite) {
            self.getEntityTier(parentSite.id).then(function(tier) {
                var dashboardId = tier === 'plus'
                    ? self.settings.plusDashboardId
                    : self.settings.standardDashboardId;

                if (!dashboardId) return;

                var stateArray = [{
                    id: 'site',
                    params: {
                        entityId: { id: parentSite.id, entityType: 'ASSET' },
                        entityName: parentSite.name
                    }
                }];
                var stateParam = encodeURIComponent(self.objToBase64(stateArray));
                var url = '/dashboard/' + dashboardId + '?state=' + stateParam;

                window.location.href = url;
            });
        }
    }
};

self.findParentSite = function(deviceId) {
    // Search through tree data to find the site that contains this device
    return self.findParentSiteInList(self.treeData, deviceId);
};

self.findParentSiteInList = function(nodes, deviceId) {
    for (var i = 0; i < nodes.length; i++) {
        var node = nodes[i];
        if (node.type === 'site' && node.devices) {
            for (var j = 0; j < node.devices.length; j++) {
                if (node.devices[j].id === deviceId) {
                    return { id: node.id, name: node.name };
                }
            }
        }
        if (node.children && node.children !== false) {
            var found = self.findParentSiteInList(node.children, deviceId);
            if (found) return found;
        }
    }
    return null;
};

self.findParentEstate = function(regionId) {
    // Walk treeData (array of estate nodes) to find which estate contains
    // the given region as a direct child.
    for (var i = 0; i < self.treeData.length; i++) {
        var estate = self.treeData[i];
        if (estate.children && estate.children !== false) {
            for (var j = 0; j < estate.children.length; j++) {
                if (estate.children[j].id === regionId) {
                    return { id: estate.id, name: estate.name };
                }
            }
        }
    }
    return null;
};

self.objToBase64 = function(obj) {
    var json = JSON.stringify(obj);
    return btoa(encodeURIComponent(json).replace(/%([0-9A-F]{2})/g,
        function(match, p1) {
            return String.fromCharCode(Number('0x' + p1));
        }));
};

// ── Active Node Detection ──────────────────────────────────────

self.getActiveEntityId = function() {
    try {
        var sc = self.ctx.stateController;
        if (sc && sc.getStateParams) {
            var params = sc.getStateParams();
            if (params && params.entityId && params.entityId.id) {
                return params.entityId.id;
            }
        }
    } catch (e) { /* ignore */ }
    return null;
};

self.isActiveNode = function(nodeId) {
    var activeId = self.getActiveEntityId();
    return activeId && activeId === nodeId;
};

self.updateActiveHighlight = function() {
    self.treeEl.find('.nt-node-row').removeClass('nt-node-active');
    var activeId = self.getActiveEntityId();
    if (activeId) {
        self.treeEl.find('.nt-node-row[data-id="' + activeId + '"]').addClass('nt-node-active');
    }
};

// ── Footer Stats ───────────────────────────────────────────────

self.updateFooterStats = function() {
    if (!self.settings.showFooterSummary) return;

    var stats = { total: 0, online: 0, offline: 0, faults: 0 };
    self.aggregateStats(self.treeData, stats);
    self.allDeviceStats = stats;

    if (stats.total === 0) {
        self.footerStats.html('<span class="nt-footer-text">Expand nodes to load devices</span>');
        return;
    }

    var html = '<span class="nt-footer-item nt-footer-total">' + stats.total + ' devices</span>';
    if (stats.online > 0) {
        html += '<span class="nt-footer-item nt-footer-online"><span class="nt-status-dot-online"></span>' + stats.online + ' online</span>';
    }
    if (stats.offline > 0) {
        html += '<span class="nt-footer-item nt-footer-offline"><span class="nt-status-dot-offline"></span>' + stats.offline + ' offline</span>';
    }
    if (stats.faults > 0) {
        html += '<span class="nt-footer-item nt-footer-fault"><span class="nt-status-dot-fault"></span>' + stats.faults + ' faults</span>';
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

// ── Search / Filter ────────────────────────────────────────────

self.filterTree = function(query) {
    query = (query || '').trim().toLowerCase();

    if (!query) {
        // Restore previous expand state
        if (self.searchSavedState) {
            self.expandedNodes = self.searchSavedState;
            self.searchSavedState = null;
        }
        self.searchQuery = '';
        self.treeEl.find('.nt-node').show();
        self.treeEl.find('.nt-children').each(function() {
            var nodeId = $(this).parent().data('id');
            if (!self.expandedNodes[nodeId]) {
                $(this).hide();
            }
        });
        return;
    }

    // Save expand state on first search
    if (!self.searchSavedState) {
        self.searchSavedState = Object.assign({}, self.expandedNodes);
    }

    self.searchQuery = query;

    // Show all nodes, then hide non-matching branches
    self.treeEl.find('.nt-node').hide();
    self.treeEl.find('.nt-children').show();

    // Find matching node rows and show them + all ancestors
    self.treeEl.find('.nt-label').each(function() {
        var label = $(this).text().toLowerCase();
        if (label.indexOf(query) !== -1) {
            var nodeEl = $(this).closest('.nt-node');
            nodeEl.show();
            // Show all parent nodes
            nodeEl.parents('.nt-node').show();
            nodeEl.parents('.nt-children').show();
        }
    });
};

// ── Device Status Polling ──────────────────────────────────────

self.refreshDeviceStatuses = function() {
    // Re-enrich all cached devices and re-render affected nodes
    var siteIds = Object.keys(self.deviceCache);
    if (siteIds.length === 0) return;

    // Invalidate device caches so they get re-fetched
    siteIds.forEach(function(siteId) {
        delete self.deviceCache[siteId];
    });

    // Re-load devices for all expanded sites
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
        Promise.all(promises).then(function() {
            self.renderTree();
        });
    }
};

// ── Utilities ──────────────────────────────────────────────────

self.escapeHtml = function(text) {
    if (!text) return '';
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
};

// ── Lifecycle ──────────────────────────────────────────────────

self.onDataUpdated = function() {
    // Static widget — no datasource updates
};

self.onResize = function() {
    // No action needed
};

self.onDestroy = function() {
    if (self.pollTimer) {
        clearInterval(self.pollTimer);
        self.pollTimer = null;
    }
    if (self.searchTimer) {
        clearTimeout(self.searchTimer);
        self.searchTimer = null;
    }
    self.treeEl.find('.nt-chevron').off('click');
    self.treeEl.find('.nt-node-row').off('click');
    self.searchInput.off('input');
    self.$container.find('.nt-collapse-all').off('click');
};
