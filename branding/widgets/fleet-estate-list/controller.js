// Fleet List Widget — Controller v2
// Redesigned cards with status pills and colored left border

self.onInit = function() {
    self.$container = self.ctx.$container;
    self.cardsEl = self.$container.find('#estate-cards');
    self.countEl = self.$container.find('#estate-count');
    self.titleEl = self.$container.find('.header-title');

    self.settings = {
        onlineThresholdMinutes: self.ctx.settings.onlineThresholdMinutes || 10,
        targetState: self.ctx.settings.targetState || 'estate',
        headerTitle: self.ctx.settings.headerTitle || 'Estates',
        navigationType: self.ctx.settings.navigationType || 'state',
        targetDashboardId: self.ctx.settings.targetDashboardId || ''
    };

    self.titleEl.text(self.settings.headerTitle);

    self.statsCache = {};
    self.statsFetchInProgress = {};
};

self.onDataUpdated = function() {
    var data = self.ctx.data;
    if (!data || data.length === 0) {
        self.renderEmpty();
        return;
    }

    var entities = {};
    data.forEach(function(item) {
        if (!item.datasource || !item.datasource.entityId) return;
        var id = item.datasource.entityId;
        if (!entities[id]) {
            entities[id] = {
                id: id,
                name: item.datasource.entityName || 'Unknown',
                entityType: item.datasource.entityType || 'ASSET',
                clientName: ''
            };
        }
        if (item.dataKey && item.dataKey.name === 'client_name' && item.data && item.data.length > 0) {
            entities[id].clientName = item.data[item.data.length - 1][1] || '';
        }
    });

    var entityList = Object.values(entities);
    var label = self.settings.headerTitle.toLowerCase();
    self.countEl.text(entityList.length + ' ' + (entityList.length === 1 ? label.replace(/s$/, '') : label));

    var promises = entityList.map(function(entity) {
        return self.getEntityStats(entity.id);
    });

    self.renderCards(entityList);

    Promise.all(promises).then(function() {
        self.renderCards(entityList);
    });
};

self.getEntityStats = function(entityId) {
    var cached = self.statsCache[entityId];
    if (cached && (Date.now() - cached.fetchedAt) < 30000) {
        return Promise.resolve(cached);
    }

    if (self.statsFetchInProgress[entityId]) {
        return self.statsFetchInProgress[entityId];
    }

    var promise = self.fetchDescendantDevices(entityId).then(function(devices) {
        var now = Date.now();
        var thresholdMs = self.settings.onlineThresholdMinutes * 60 * 1000;
        var stats = {
            totalDevices: devices.length,
            online: 0,
            offline: 0,
            faults: 0,
            fetchedAt: now
        };

        devices.forEach(function(d) {
            if (d.lastTs > 0 && (now - d.lastTs) < thresholdMs) {
                stats.online++;
            } else {
                stats.offline++;
            }
            if (d.fault) {
                stats.faults++;
            }
        });

        self.statsCache[entityId] = stats;
        delete self.statsFetchInProgress[entityId];
        return stats;
    }).catch(function() {
        delete self.statsFetchInProgress[entityId];
        return { totalDevices: 0, online: 0, offline: 0, faults: 0, fetchedAt: Date.now() };
    });

    self.statsFetchInProgress[entityId] = promise;
    return promise;
};

self.fetchDescendantDevices = function(assetId) {
    return self.getChildren(assetId).then(function(children) {
        var devices = [];
        var assetChildren = [];

        children.forEach(function(child) {
            if (child.to.entityType === 'DEVICE') {
                devices.push({ id: child.to.id, lastTs: 0, fault: false });
            } else if (child.to.entityType === 'ASSET') {
                assetChildren.push(child.to.id);
            }
        });

        if (assetChildren.length === 0) {
            return self.enrichDevices(devices);
        }

        var promises = assetChildren.map(function(childId) {
            return self.fetchDescendantDevices(childId);
        });

        return Promise.all(promises).then(function(results) {
            results.forEach(function(childDevices) {
                devices = devices.concat(childDevices);
            });
            return devices;
        });
    });
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

self.renderCards = function(entityList) {
    var html = '';

    if (entityList.length === 0) {
        html = '<div class="empty-state">No ' + self.settings.headerTitle.toLowerCase() + ' found</div>';
        self.cardsEl.html(html);
        return;
    }

    var isSiteList = self.settings.navigationType === 'dashboard';

    entityList.forEach(function(entity) {
        var stats = self.statsCache[entity.id] || {};
        var total = stats.totalDevices || 0;
        var online = stats.online || 0;
        var offline = stats.offline || 0;
        var faults = stats.faults || 0;

        // Determine card status class for left border
        var statusClass = 'status-offline';
        if (faults > 0) {
            statusClass = 'status-fault';
        } else if (online > 0 && offline === 0) {
            statusClass = 'status-healthy';
        } else if (online > 0 && offline > 0) {
            statusClass = 'status-warning';
        }

        // Device count text
        var deviceText = total + ' device' + (total !== 1 ? 's' : '');

        // Build pills
        var pillsHtml = '';
        if (online > 0) {
            pillsHtml += '<span class="pill pill-online"><span class="pill-dot"></span>' + online + ' online</span>';
        }
        if (offline > 0) {
            pillsHtml += '<span class="pill pill-offline"><span class="pill-dot"></span>' + offline + ' offline</span>';
        }
        if (faults > 0) {
            pillsHtml += '<span class="pill pill-fault"><span class="pill-dot"></span>' + faults + ' fault' + (faults !== 1 ? 's' : '') + '</span>';
        }

        // Chevron
        var chevronLabel = isSiteList ? '<span class="chevron-label">SignConnect</span>' : '';

        html += '<div class="estate-card ' + statusClass + '" data-entity-id="' + entity.id + '" data-entity-name="' + self.escapeHtml(entity.name) + '">' +
            '<div class="card-main">' +
                '<div class="card-top-row">' +
                    '<span class="card-name">' + self.escapeHtml(entity.name) + '</span>' +
                    '<span class="card-device-count">' + deviceText + '</span>' +
                '</div>' +
                '<div class="card-pills">' + pillsHtml + '</div>' +
            '</div>' +
            '<div class="card-chevron">' +
                '<span class="chevron-icon">›</span>' +
                chevronLabel +
            '</div>' +
        '</div>';
    });

    self.cardsEl.html(html);

    self.cardsEl.find('.estate-card').on('click', function() {
        var entityId = $(this).data('entity-id');
        var entityName = $(this).data('entity-name');

        if (self.settings.navigationType === 'dashboard' && self.settings.targetDashboardId) {
            self.navigateToDashboard(entityId, entityName);
        } else {
            self.navigateToState(entityId, entityName);
        }
    });
};

self.navigateToState = function(entityId, entityName) {
    var sc = self.ctx.stateController;
    var targetState = self.settings.targetState;

    if (sc && sc.openState) {
        sc.openState(targetState, {
            entityId: { entityType: 'ASSET', id: entityId },
            entityName: entityName
        });
    } else {
        sc.updateState(targetState, {
            entityId: { entityType: 'ASSET', id: entityId },
            entityName: entityName
        });
    }
};

self.navigateToDashboard = function(entityId, entityName) {
    var dashboardId = self.settings.targetDashboardId;
    var url = '/dashboards/' + dashboardId +
              '?entityId=' + entityId +
              '&entityType=ASSET' +
              '&entityName=' + encodeURIComponent(entityName);
    window.open(url, '_blank');
};

self.renderEmpty = function() {
    self.countEl.text('0 ' + self.settings.headerTitle.toLowerCase());
    self.cardsEl.html('<div class="empty-state">No ' + self.settings.headerTitle.toLowerCase() + ' found</div>');
};

self.escapeHtml = function(text) {
    if (!text) return '';
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
};

self.onResize = function() {};

self.onDestroy = function() {
    self.cardsEl.find('.estate-card').off('click');
};
