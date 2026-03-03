// Fleet Client Summary Widget — Controller
// Operational overview per client: connectivity, fault health, sign state.
// Walks the asset hierarchy to find descendant devices, then fetches
// status (online/offline), faults (fault_overall_failure), attributes (dimLevel) in parallel.

self.onInit = function() {
    self.$container = self.ctx.$container;
    self.cardsEl = self.$container.find('#client-cards');

    self.settings = {
        fleetDashboardId: self.ctx.settings.fleetDashboardId || '',
        onlineThresholdMinutes: self.ctx.settings.onlineThresholdMinutes || 10
    };

    self.deviceCache = {};    // assetId → { devices: [{id,lastTs,fault,dimLevel}], fetchedAt }
    self.statsCache = {};     // entityId → { totalDevices, online, offline, faults, signsOn, signsOff, fetchedAt }
    self.tierCache = {};      // entityId → 'signconnect' | 'signconnect_plus' | null
    self.fetchInProgress = {};

    // Detect current state level from URL
    var stack = self.getCurrentStateStack();
    self.currentLevel = (stack.length > 0) ? stack[stack.length - 1].id : 'default';
};

self.onDataUpdated = function() {
    var data = self.ctx.data;
    if (!data || data.length === 0) {
        self.renderEmpty();
        return;
    }

    // Extract entities from datasources
    var entities = {};
    data.forEach(function(item) {
        if (!item.datasource || !item.datasource.entityId) return;
        var id = item.datasource.entityId;
        if (!entities[id]) {
            entities[id] = {
                id: id,
                name: item.datasource.entityName || 'Unknown',
                entityType: item.datasource.entityType || 'ASSET'
            };
        }
    });

    var entityList = Object.values(entities);

    // Render loading state immediately
    self.renderCards(entityList, true);

    // Fetch stats for all entities (+ tier at region level)
    var promises = entityList.map(function(entity) {
        return self.getEntityStats(entity.id);
    });
    if (self.currentLevel === 'region') {
        entityList.forEach(function(entity) {
            promises.push(self.fetchEntityTier(entity.id));
        });
    }
    Promise.all(promises).then(function() {
        self.renderCards(entityList, false);
        self.bindCardClicks(entityList);
    });
};

// ── Device Status ─────────────────────────────────────────────

self.getEntityStats = function(entityId) {
    var cached = self.statsCache[entityId];
    if (cached && (Date.now() - cached.fetchedAt) < 30000) {
        return Promise.resolve(cached);
    }

    var key = 'stats_' + entityId;
    if (self.fetchInProgress[key]) {
        return self.fetchInProgress[key];
    }

    var promise = self.fetchDescendantDevices(entityId).then(function(devices) {
        var now = Date.now();
        var thresholdMs = self.settings.onlineThresholdMinutes * 60 * 1000;

        var stats = {
            totalDevices: devices.length,
            online: 0,
            offline: 0,
            faults: 0,
            signsOn: 0,
            signsOff: 0,
            fetchedAt: now
        };

        devices.forEach(function(d) {
            // Online/offline
            if (d.lastTs > 0 && (now - d.lastTs) < thresholdMs) {
                stats.online++;
            } else {
                stats.offline++;
            }

            // Faults
            if (d.fault) {
                stats.faults++;
            }

            // Signs on/off
            if (d.dimLevel !== null && d.dimLevel !== undefined && d.dimLevel > 0) {
                stats.signsOn++;
            } else {
                stats.signsOff++;
            }

        });

        self.statsCache[entityId] = stats;
        delete self.fetchInProgress[key];
        return stats;
    }).catch(function() {
        delete self.fetchInProgress[key];
        return { totalDevices: 0, online: 0, offline: 0, faults: 0, signsOn: 0, signsOff: 0, fetchedAt: Date.now() };
    });

    self.fetchInProgress[key] = promise;
    return promise;
};

// ── Tier Badge ────────────────────────────────────────────────

self.fetchEntityTier = function(entityId) {
    if (self.tierCache[entityId] !== undefined) {
        return Promise.resolve(self.tierCache[entityId]);
    }

    var url = '/api/plugins/telemetry/ASSET/' + entityId +
              '/values/attributes/SERVER_SCOPE?keys=dashboard_tier';
    return self.ctx.http.get(url).toPromise().then(function(attrs) {
        var tier = null;
        if (attrs && Array.isArray(attrs) && attrs.length > 0) {
            tier = attrs[0].value || null;
        }
        self.tierCache[entityId] = tier;
        return tier;
    }).catch(function() {
        self.tierCache[entityId] = null;
        return null;
    });
};

// ── Hierarchy Walk ────────────────────────────────────────────

self.fetchDescendantDevices = function(assetId) {
    var cached = self.deviceCache[assetId];
    if (cached && (Date.now() - cached.fetchedAt) < 30000) {
        return Promise.resolve(cached.devices);
    }

    var key = 'devices_' + assetId;
    if (self.fetchInProgress[key]) {
        return self.fetchInProgress[key];
    }

    var promise = self.getChildren(assetId).then(function(children) {
        var devices = [];
        var assetChildren = [];

        children.forEach(function(child) {
            if (child.to.entityType === 'DEVICE') {
                devices.push({ id: child.to.id, lastTs: 0, fault: false, dimLevel: null, enriched: false });
            } else if (child.to.entityType === 'ASSET') {
                assetChildren.push(child.to.id);
            }
        });

        if (assetChildren.length === 0) {
            return self.enrichDevices(devices).then(function(enriched) {
                self.deviceCache[assetId] = { devices: enriched, fetchedAt: Date.now() };
                delete self.fetchInProgress[key];
                return enriched;
            });
        }

        var promises = assetChildren.map(function(childId) {
            return self.fetchDescendantDevices(childId);
        });

        return Promise.all(promises).then(function(results) {
            results.forEach(function(childDevices) {
                devices = devices.concat(childDevices);
            });
            return self.enrichDevices(devices).then(function(enriched) {
                self.deviceCache[assetId] = { devices: enriched, fetchedAt: Date.now() };
                delete self.fetchInProgress[key];
                return enriched;
            });
        });
    }).catch(function() {
        delete self.fetchInProgress[key];
        return [];
    });

    self.fetchInProgress[key] = promise;
    return promise;
};

self.getChildren = function(assetId) {
    var url = '/api/relations?fromId=' + assetId + '&fromType=ASSET&relationType=Contains';
    return self.ctx.http.get(url).toPromise().then(function(relations) {
        return relations || [];
    }).catch(function() {
        return [];
    });
};

self.enrichDevices = function(devices) {
    if (devices.length === 0) return Promise.resolve(devices);

    var promises = devices.map(function(device) {
        // Skip if already enriched (from a cached sub-tree)
        if (device.enriched) return Promise.resolve(device);

        // 2 parallel calls per device: timeseries + shared attribute
        var tsUrl = '/api/plugins/telemetry/DEVICE/' + device.id +
                    '/values/timeseries?keys=dim_value,fault_overall_failure';
        var dimUrl = '/api/plugins/telemetry/DEVICE/' + device.id +
                     '/values/attributes/SHARED_SCOPE?keys=dimLevel';

        return Promise.all([
            self.ctx.http.get(tsUrl).toPromise().catch(function() { return null; }),
            self.ctx.http.get(dimUrl).toPromise().catch(function() { return null; })
        ]).then(function(results) {
            var tsData = results[0];
            var dimData = results[1];

            // lastTs from dim_value timeseries
            if (tsData && tsData.dim_value && tsData.dim_value.length > 0) {
                device.lastTs = tsData.dim_value[0].ts;
            }

            // fault from fault_overall_failure timeseries
            if (tsData && tsData.fault_overall_failure && tsData.fault_overall_failure.length > 0) {
                var val = tsData.fault_overall_failure[0].value;
                device.fault = (val === true || val === 'true' || val === '1');
            }

            // dimLevel from SHARED_SCOPE attribute
            if (dimData && Array.isArray(dimData) && dimData.length > 0) {
                var val = parseFloat(dimData[0].value);
                device.dimLevel = isNaN(val) ? null : val;
            }

            device.enriched = true;
            return device;
        });
    });

    return Promise.all(promises);
};

// ── Navigation ────────────────────────────────────────────────

// State hierarchy: default → estate → region → site
var STATE_LEVELS = ['default', 'estate', 'region', 'site'];

self.navigateToEntity = function(entityId, entityName) {
    // Auto-detect dashboard ID from current URL; fall back to setting
    var fleetId = self.settings.fleetDashboardId;
    var pathMatch = window.location.pathname.match(/\/dashboard\/([a-f0-9-]+)/);
    if (pathMatch) {
        fleetId = pathMatch[1];
    }
    if (!fleetId) {
        console.error('[CLIENT-SUMMARY] No fleet dashboard configured');
        return;
    }

    var currentStack = self.getCurrentStateStack();
    var nextLevel = self.getNextLevel(currentStack);
    if (!nextLevel) return;

    // Copy current stack; ensure 'default' is at the start
    var newStack = currentStack.slice();
    if (newStack.length === 0 || newStack[0].id !== 'default') {
        newStack.unshift({ id: 'default', params: {} });
    }

    // Append next level with the clicked entity
    newStack.push({
        id: nextLevel,
        params: {
            entityId: { id: entityId, entityType: 'ASSET' },
            entityName: entityName
        }
    });

    var stateParam = encodeURIComponent(self.objToBase64(newStack));
    window.location.href = '/dashboard/' + fleetId + '?state=' + stateParam;
};

self.getCurrentStateStack = function() {
    var params = new URLSearchParams(window.location.search);
    var stateParam = params.get('state');
    if (!stateParam) return [];
    try {
        return self.base64ToObj(stateParam);
    } catch(e) {
        console.error('[CLIENT-SUMMARY] Failed to parse state:', e);
        return [];
    }
};

self.getNextLevel = function(stack) {
    if (!stack || stack.length === 0) return 'estate';
    var lastId = stack[stack.length - 1].id;
    var idx = STATE_LEVELS.indexOf(lastId);
    if (idx < 0 || idx >= STATE_LEVELS.length - 1) return null;
    return STATE_LEVELS[idx + 1];
};

self.objToBase64 = function(obj) {
    var json = JSON.stringify(obj);
    return btoa(encodeURIComponent(json).replace(/%([0-9A-F]{2})/g,
        function(match, p1) {
            return String.fromCharCode(Number('0x' + p1));
        }));
};

self.base64ToObj = function(b64) {
    var decoded = atob(b64);
    var percent = decoded.split('').map(function(c) {
        return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
    }).join('');
    return JSON.parse(decodeURIComponent(percent));
};

// ── Rendering ─────────────────────────────────────────────────

self.renderCards = function(entityList, loading) {
    if (entityList.length === 0) {
        self.renderEmpty();
        return;
    }
    self.renderCardsHTML(entityList, loading);
};

self.renderCardsHTML = function(entityList, loading) {
    var html = '';

    entityList.forEach(function(entity) {
        var stats = self.statsCache[entity.id] || {};
        var isLoading = loading || !stats.fetchedAt;
        var loadingClass = isLoading ? ' loading' : '';

        var total = stats.totalDevices || 0;
        var online = stats.online || 0;
        var offline = stats.offline || 0;
        var faults = stats.faults || 0;
        var signsOn = stats.signsOn || 0;
        var signsOff = stats.signsOff || 0;
        // Status class for left border
        var statusClass = 'status-offline';
        if (faults > 0) {
            statusClass = 'status-fault';
        } else if (online > 0 && offline === 0) {
            statusClass = 'status-healthy';
        } else if (online > 0 && offline > 0) {
            statusClass = 'status-warning';
        }

        var deviceText = total > 0 ? (total + ' device' + (total !== 1 ? 's' : '')) : '...';

        // Tier badge (region level only)
        var tierBadgeHtml = '';
        if (self.currentLevel === 'region') {
            var tier = self.tierCache[entity.id];
            if (tier === 'signconnect_plus') {
                tierBadgeHtml = '<span class="tier-badge tier-plus">Plus</span>';
            } else if (tier === 'signconnect') {
                tierBadgeHtml = '<span class="tier-badge tier-standard">Standard</span>';
            }
        }

        // Build pills
        var pillsHtml = '';
        if (online > 0) {
            pillsHtml += '<span class="pill pill-online"><span class="pill-dot"></span>' + online + ' online</span>';
        }
        if (offline > 0) {
            pillsHtml += '<span class="pill pill-offline"><span class="pill-dot"></span>' + offline + ' offline</span>';
        }

        // Health row
        var healthHtml = '';
        if (isLoading) {
            healthHtml = '<span class="health-dot loading"></span> <span>Health: ...</span>';
        } else if (faults > 0) {
            healthHtml = '<span class="health-dot fault"></span> <span class="client-health-issues">Health: ' +
                faults + ' fault' + (faults !== 1 ? 's' : '') + '</span>';
        } else {
            healthHtml = '<span class="health-dot ok"></span> <span class="client-health-ok">Health: OK</span>';
        }

        // Signs row
        var signsHtml = '';
        if (isLoading) {
            signsHtml = '<span class="signs-dot loading"></span> <span>Signs: ...</span>';
        } else {
            signsHtml = '<span class="signs-dot"></span> <span class="client-signs">Signs: ' +
                '<span class="signs-on">' + signsOn + ' On</span> / ' +
                '<span class="signs-off">' + signsOff + ' Off</span></span>';
        }

        html += '<div class="client-card ' + statusClass + loadingClass + '"' +
            ' data-entity-id="' + self.escapeHtml(entity.id) + '"' +
            ' data-entity-name="' + self.escapeHtml(entity.name) + '">' +
            '<div class="card-main">' +
                '<div class="card-top-row">' +
                    '<span class="card-entity-name">' + self.escapeHtml(entity.name) + '</span>' +
                    tierBadgeHtml +
                    '<span class="card-chevron">\u203A</span>' +
                '</div>' +
                '<div class="card-subtitle-row">' +
                    '<span>' + deviceText + '</span>' +
                '</div>' +
                '<div class="card-pills">' + pillsHtml + '</div>' +
                '<div class="card-status-rows">' +
                    '<div class="card-status-row">' + healthHtml + '</div>' +
                    '<div class="card-status-row">' + signsHtml + '</div>' +
                '</div>' +
            '</div>' +
        '</div>';
    });

    self.cardsEl.html(html);
};

self.bindCardClicks = function(entityList) {
    self.cardsEl.find('.client-card').on('click', function() {
        var entityId = this.getAttribute('data-entity-id');
        var entityName = this.getAttribute('data-entity-name');
        if (entityId) {
            self.navigateToEntity(entityId, entityName);
        }
    });
};

self.renderEmpty = function() {
    self.cardsEl.html('<div class="client-empty">No data found</div>');
};

// ── Utilities ─────────────────────────────────────────────────

self.escapeHtml = function(text) {
    if (!text) return '';
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
};

// ── Lifecycle ─────────────────────────────────────────────────

self.onResize = function() {};

self.onDestroy = function() {};
