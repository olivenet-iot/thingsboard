// Fleet Estate List — Controller
// Widget type: latest
// Datasource: "All Estates" alias (assetType=estate)
// Datasource keys: client_name (server attribute)
// Navigates to "estate" dashboard state on click

self.onInit = function() {
    self.$container = self.ctx.$container;
    self.cardsEl = self.$container.find('#estate-cards');
    self.countEl = self.$container.find('#estate-count');

    self.settings = {
        onlineThresholdMinutes: self.ctx.settings.onlineThresholdMinutes || 10
    };

    // Cache for device stats per estate (avoid re-fetching every update)
    self.statsCache = {};
    self.statsFetchInProgress = {};
};

self.onDataUpdated = function() {
    var data = self.ctx.data;
    if (!data || data.length === 0) {
        self.renderEmpty();
        return;
    }

    // Extract unique estate entities from datasource
    var estates = {};
    data.forEach(function(item) {
        if (!item.datasource || !item.datasource.entityId) return;
        var id = item.datasource.entityId;
        if (!estates[id]) {
            estates[id] = {
                id: id,
                name: item.datasource.entityName || 'Unknown',
                entityType: item.datasource.entityType || 'ASSET',
                clientName: ''
            };
        }
        // Pick up client_name attribute
        if (item.dataKey && item.dataKey.name === 'client_name' && item.data && item.data.length > 0) {
            estates[id].clientName = item.data[item.data.length - 1][1] || '';
        }
    });

    var estateList = Object.values(estates);
    self.countEl.text(estateList.length + (estateList.length === 1 ? ' estate' : ' estates'));

    // Fetch device stats for each estate, then render
    var promises = estateList.map(function(estate) {
        return self.getEstateStats(estate.id);
    });

    // Render immediately with cached/empty stats, update when API calls complete
    self.renderCards(estateList);

    Promise.all(promises).then(function() {
        self.renderCards(estateList);
    });
};

self.getEstateStats = function(estateId) {
    // Return cached if fresh (< 30 seconds)
    var cached = self.statsCache[estateId];
    if (cached && (Date.now() - cached.fetchedAt) < 30000) {
        return Promise.resolve(cached);
    }

    // Prevent duplicate fetches
    if (self.statsFetchInProgress[estateId]) {
        return self.statsFetchInProgress[estateId];
    }

    var promise = self.fetchDescendantDevices(estateId).then(function(devices) {
        var now = Date.now();
        var thresholdMs = self.settings.onlineThresholdMinutes * 60 * 1000;
        var stats = {
            regions: 0,
            sites: 0,
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

        self.statsCache[estateId] = stats;
        delete self.statsFetchInProgress[estateId];
        return stats;
    }).catch(function() {
        delete self.statsFetchInProgress[estateId];
        return { regions: 0, sites: 0, totalDevices: 0, online: 0, offline: 0, faults: 0, fetchedAt: Date.now() };
    });

    self.statsFetchInProgress[estateId] = promise;
    return promise;
};

self.fetchDescendantDevices = function(assetId) {
    // Recursively find all DEVICE entities under this asset via Contains relations
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

        // Recurse into asset children
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

    // For each device, get latest telemetry timestamp + fault status
    var promises = devices.map(function(device) {
        var url = '/api/plugins/telemetry/DEVICE/' + device.id +
                  '/values/timeseries?keys=dim_value,fault_overall_failure';
        return self.ctx.http.get(url).toPromise().then(function(telemetry) {
            if (telemetry) {
                // Get latest timestamp from dim_value
                if (telemetry.dim_value && telemetry.dim_value.length > 0) {
                    device.lastTs = telemetry.dim_value[0].ts;
                }
                // Check fault
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

self.renderCards = function(estateList) {
    var html = '';

    if (estateList.length === 0) {
        html = '<div class="empty-state">No estates found</div>';
        self.cardsEl.html(html);
        return;
    }

    estateList.forEach(function(estate) {
        var stats = self.statsCache[estate.id] || {};
        var total = stats.totalDevices || 0;
        var online = stats.online || 0;
        var offline = stats.offline || 0;
        var faults = stats.faults || 0;

        // Build subtitle
        var subtitle = total + ' device' + (total !== 1 ? 's' : '');

        // Build status dots
        var statusHtml = '';
        statusHtml += '<span class="status-item online"><span class="dot dot-online"></span>' + online + ' online</span>';
        if (offline > 0) {
            statusHtml += '<span class="status-item offline"><span class="dot dot-offline"></span>' + offline + ' offline</span>';
        }
        if (faults > 0) {
            statusHtml += '<span class="status-item fault"><span class="dot dot-fault"></span>' + faults + ' fault' + (faults !== 1 ? 's' : '') + '</span>';
        }

        html += '<div class="estate-card" data-entity-id="' + estate.id + '" data-entity-name="' + self.escapeHtml(estate.name) + '">' +
            '<div class="card-content">' +
                '<div class="card-name">' + self.escapeHtml(estate.name) + '</div>' +
                '<div class="card-subtitle">' + subtitle + '</div>' +
                '<div class="card-status">' + statusHtml + '</div>' +
            '</div>' +
            '<div class="card-chevron">' +
                '<span class="chevron-icon">›</span>' +
            '</div>' +
        '</div>';
    });

    self.cardsEl.html(html);

    // Bind click handlers
    self.cardsEl.find('.estate-card').on('click', function() {
        var entityId = $(this).data('entity-id');
        var entityName = $(this).data('entity-name');
        self.navigateToEstate(entityId, entityName);
    });
};

self.navigateToEstate = function(entityId, entityName) {
    // Navigate to "estate" dashboard state with entity params
    var params = {
        entityId: {
            entityType: 'ASSET',
            id: entityId
        },
        entityName: entityName
    };

    self.ctx.stateController.updateState('estate', params);
};

self.renderEmpty = function() {
    self.countEl.text('0 estates');
    self.cardsEl.html('<div class="empty-state">No estates found. Assign estate assets to this customer.</div>');
};

self.escapeHtml = function(text) {
    if (!text) return '';
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
};

self.onResize = function() {
    // Handled by CSS
};

self.onDestroy = function() {
    self.cardsEl.find('.estate-card').off('click');
};
