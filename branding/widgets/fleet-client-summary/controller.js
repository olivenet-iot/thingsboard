// Fleet Client Summary Widget — Controller
// Operational overview per client: product tier, connectivity, alarm health, sign state.
// Walks the asset hierarchy to find descendant devices, then fetches
// status (online/offline), alarms (active), attributes (tier, dimLevel) in parallel.

self.onInit = function() {
    self.$container = self.ctx.$container;
    self.cardsEl = self.$container.find('#client-cards');

    self.settings = {
        fleetDashboardId: self.ctx.settings.fleetDashboardId || '',
        onlineThresholdMinutes: self.ctx.settings.onlineThresholdMinutes || 10
    };

    self.deviceCache = {};    // assetId → { devices: [{id,lastTs,dashboard_tier,dimLevel}], fetchedAt }
    self.statsCache = {};     // entityId → { totalDevices, online, offline, alarmCount, signsOn, signsOff, productType, fetchedAt }
    self.alarmCache = null;   // { alarmDeviceSet: {deviceId: count}, fetchedAt }
    self.fetchInProgress = {};
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

    // Fetch alarms once, then stats for all entities
    self.fetchAllActiveAlarms().then(function() {
        var promises = entityList.map(function(entity) {
            return self.getEntityStats(entity.id);
        });
        return Promise.all(promises);
    }).then(function() {
        self.renderCards(entityList, false);
        self.bindCardClicks(entityList);
    });
};

// ── Alarms (batch) ────────────────────────────────────────────

self.fetchAllActiveAlarms = function() {
    var cached = self.alarmCache;
    if (cached && (Date.now() - cached.fetchedAt) < 30000) {
        return Promise.resolve(cached.alarmDeviceSet);
    }

    var key = 'alarms_global';
    if (self.fetchInProgress[key]) {
        return self.fetchInProgress[key];
    }

    var promise = self.ctx.http.get('/api/alarms?searchStatus=ACTIVE&pageSize=1000&page=0')
        .toPromise().then(function(resp) {
            var deviceSet = {};
            var items = (resp && resp.data) ? resp.data : [];
            items.forEach(function(alarm) {
                if (alarm.originator && alarm.originator.id) {
                    var devId = alarm.originator.id;
                    deviceSet[devId] = (deviceSet[devId] || 0) + 1;
                }
            });
            self.alarmCache = { alarmDeviceSet: deviceSet, fetchedAt: Date.now() };
            delete self.fetchInProgress[key];
            return deviceSet;
        }).catch(function() {
            self.alarmCache = { alarmDeviceSet: {}, fetchedAt: Date.now() };
            delete self.fetchInProgress[key];
            return {};
        });

    self.fetchInProgress[key] = promise;
    return promise;
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
        var alarmDeviceSet = self.alarmCache ? self.alarmCache.alarmDeviceSet : {};

        var stats = {
            totalDevices: devices.length,
            online: 0,
            offline: 0,
            alarmCount: 0,
            signsOn: 0,
            signsOff: 0,
            productType: 'SignConnect',
            fetchedAt: now
        };

        devices.forEach(function(d) {
            // Online/offline
            if (d.lastTs > 0 && (now - d.lastTs) < thresholdMs) {
                stats.online++;
            } else {
                stats.offline++;
            }

            // Alarms
            if (alarmDeviceSet[d.id]) {
                stats.alarmCount += alarmDeviceSet[d.id];
            }

            // Signs on/off
            if (d.dimLevel !== null && d.dimLevel !== undefined && d.dimLevel > 0) {
                stats.signsOn++;
            } else {
                stats.signsOff++;
            }

            // Product tier
            if (d.dashboard_tier === 'plus') {
                stats.productType = 'SignConnect Plus';
            }
        });

        self.statsCache[entityId] = stats;
        delete self.fetchInProgress[key];
        return stats;
    }).catch(function() {
        delete self.fetchInProgress[key];
        return { totalDevices: 0, online: 0, offline: 0, alarmCount: 0, signsOn: 0, signsOff: 0, productType: 'SignConnect', fetchedAt: Date.now() };
    });

    self.fetchInProgress[key] = promise;
    return promise;
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
                devices.push({ id: child.to.id, lastTs: 0, dashboard_tier: null, dimLevel: null, enriched: false });
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

        // 3 parallel calls per device
        var tsUrl = '/api/plugins/telemetry/DEVICE/' + device.id +
                    '/values/timeseries?keys=dim_value';
        var tierUrl = '/api/plugins/telemetry/DEVICE/' + device.id +
                      '/values/attributes/SERVER_SCOPE?keys=dashboard_tier';
        var dimUrl = '/api/plugins/telemetry/DEVICE/' + device.id +
                     '/values/attributes/SHARED_SCOPE?keys=dimLevel';

        return Promise.all([
            self.ctx.http.get(tsUrl).toPromise().catch(function() { return null; }),
            self.ctx.http.get(tierUrl).toPromise().catch(function() { return null; }),
            self.ctx.http.get(dimUrl).toPromise().catch(function() { return null; })
        ]).then(function(results) {
            var tsData = results[0];
            var tierData = results[1];
            var dimData = results[2];

            // lastTs from dim_value timeseries
            if (tsData && tsData.dim_value && tsData.dim_value.length > 0) {
                device.lastTs = tsData.dim_value[0].ts;
            }

            // dashboard_tier from SERVER_SCOPE attribute
            if (tierData && Array.isArray(tierData) && tierData.length > 0) {
                device.dashboard_tier = tierData[0].value || null;
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

self.navigateToEstate = function(entityId, entityName) {
    var fleetId = self.settings.fleetDashboardId;
    if (!fleetId) {
        console.error('[CLIENT-SUMMARY] No fleet dashboard configured');
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
};

self.objToBase64 = function(obj) {
    var json = JSON.stringify(obj);
    return btoa(encodeURIComponent(json).replace(/%([0-9A-F]{2})/g,
        function(match, p1) {
            return String.fromCharCode(Number('0x' + p1));
        }));
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
        var alarmCount = stats.alarmCount || 0;
        var signsOn = stats.signsOn || 0;
        var signsOff = stats.signsOff || 0;
        var productType = stats.productType || 'SignConnect';

        // Status class for left border
        var statusClass = 'status-offline';
        if (alarmCount > 0) {
            statusClass = 'status-fault';
        } else if (online > 0 && offline === 0) {
            statusClass = 'status-healthy';
        } else if (online > 0 && offline > 0) {
            statusClass = 'status-warning';
        }

        var deviceText = total > 0 ? (total + ' device' + (total !== 1 ? 's' : '')) : '...';

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
        } else if (alarmCount > 0) {
            healthHtml = '<span class="health-dot fault"></span> <span class="client-health-issues">Health: ' +
                alarmCount + ' active alarm' + (alarmCount !== 1 ? 's' : '') + '</span>';
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
                    '<span class="card-chevron">\u203A</span>' +
                '</div>' +
                '<div class="card-subtitle-row">' +
                    '<span>' + self.escapeHtml(productType) + '</span>' +
                    '<span class="subtitle-sep"></span>' +
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
            self.navigateToEstate(entityId, entityName);
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
