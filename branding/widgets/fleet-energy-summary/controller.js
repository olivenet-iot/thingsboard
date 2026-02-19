// Fleet Energy Summary Widget — Controller
// Aggregates energy_wh and co2_grams across all descendant devices
// for each datasource entity, using the dashboard timewindow.

self.onInit = function() {
    self.$container = self.ctx.$container;
    self.cardsEl = self.$container.find('#energy-cards');
    self.periodEl = self.$container.find('#energy-period');
    self.titleEl = self.$container.find('.header-title');

    self.settings = {
        headerTitle: self.ctx.settings.headerTitle || 'Energy Overview'
    };

    self.titleEl.text(self.settings.headerTitle);

    self.deviceCache = {};   // assetId → { devices: [...ids], fetchedAt }
    self.energyCache = {};   // entityId → { deviceCount, energyWh, co2Grams, fetchedAt }
    self.fetchInProgress = {};
    self.lastTimewindowKey = '';
};

self.onDataUpdated = function() {
    var data = self.ctx.data;
    if (!data || data.length === 0) {
        self.cardsEl.html('<div class="energy-empty">No entities found</div>');
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

    // Extract timewindow
    var tw = self.extractTimewindow();
    var twKey = tw.startTs + '_' + tw.endTs;

    // Invalidate energy cache if timewindow changed
    if (twKey !== self.lastTimewindowKey) {
        self.energyCache = {};
        self.lastTimewindowKey = twKey;
    }

    // Update period label
    self.periodEl.text(self.formatPeriod(tw.startTs, tw.endTs));

    // Render loading state immediately
    self.renderCards(entityList, true);

    // Fetch energy for all entities
    var promises = entityList.map(function(entity) {
        return self.getEntityEnergy(entity.id, tw.startTs, tw.endTs);
    });

    Promise.all(promises).then(function() {
        self.renderCards(entityList, false);
    });
};

self.extractTimewindow = function() {
    var tw = self.ctx.dashboard.dashboardTimewindow || self.ctx.dashboardTimewindow;
    var now = Date.now();
    var startTs, endTs;

    if (tw && tw.history) {
        if (tw.history.fixedTimewindow) {
            startTs = tw.history.fixedTimewindow.startTimeMs;
            endTs = tw.history.fixedTimewindow.endTimeMs;
        } else if (tw.history.timewindowMs) {
            endTs = now;
            startTs = now - tw.history.timewindowMs;
        } else {
            // Default: last 24h
            endTs = now;
            startTs = now - 86400000;
        }
    } else if (tw && tw.realtime) {
        endTs = now;
        startTs = now - (tw.realtime.timewindowMs || 86400000);
    } else {
        // Fallback: last 24h
        endTs = now;
        startTs = now - 86400000;
    }

    return { startTs: startTs, endTs: endTs };
};

self.getEntityEnergy = function(entityId, startTs, endTs) {
    var cached = self.energyCache[entityId];
    if (cached && (Date.now() - cached.fetchedAt) < 30000) {
        return Promise.resolve(cached);
    }

    if (self.fetchInProgress[entityId]) {
        return self.fetchInProgress[entityId];
    }

    var promise = self.fetchDescendantDevices(entityId).then(function(deviceIds) {
        if (deviceIds.length === 0) {
            var empty = { deviceCount: 0, energyWh: 0, co2Grams: 0, fetchedAt: Date.now() };
            self.energyCache[entityId] = empty;
            delete self.fetchInProgress[entityId];
            return empty;
        }

        var interval = endTs - startTs;
        var devicePromises = deviceIds.map(function(devId) {
            var url = '/api/plugins/telemetry/DEVICE/' + devId +
                '/values/timeseries?keys=energy_wh,co2_grams' +
                '&startTs=' + startTs + '&endTs=' + endTs +
                '&agg=SUM&interval=' + interval;
            return self.ctx.http.get(url).toPromise().then(function(data) {
                var wh = 0, co2 = 0;
                if (data && data.energy_wh && data.energy_wh.length > 0) {
                    wh = parseFloat(data.energy_wh[0].value) || 0;
                }
                if (data && data.co2_grams && data.co2_grams.length > 0) {
                    co2 = parseFloat(data.co2_grams[0].value) || 0;
                }
                return { energyWh: wh, co2Grams: co2 };
            }).catch(function() {
                return { energyWh: 0, co2Grams: 0 };
            });
        });

        return Promise.all(devicePromises).then(function(results) {
            var totalWh = 0, totalCO2 = 0;
            results.forEach(function(r) {
                totalWh += r.energyWh;
                totalCO2 += r.co2Grams;
            });

            var result = {
                deviceCount: deviceIds.length,
                energyWh: totalWh,
                co2Grams: totalCO2,
                fetchedAt: Date.now()
            };
            self.energyCache[entityId] = result;
            delete self.fetchInProgress[entityId];
            return result;
        });
    }).catch(function() {
        delete self.fetchInProgress[entityId];
        return { deviceCount: 0, energyWh: 0, co2Grams: 0, fetchedAt: Date.now() };
    });

    self.fetchInProgress[entityId] = promise;
    return promise;
};

self.fetchDescendantDevices = function(assetId) {
    var cached = self.deviceCache[assetId];
    if (cached && (Date.now() - cached.fetchedAt) < 30000) {
        return Promise.resolve(cached.devices);
    }

    return self.getChildren(assetId).then(function(children) {
        var devices = [];
        var assetChildren = [];

        children.forEach(function(child) {
            if (child.to.entityType === 'DEVICE') {
                devices.push(child.to.id);
            } else if (child.to.entityType === 'ASSET') {
                assetChildren.push(child.to.id);
            }
        });

        if (assetChildren.length === 0) {
            self.deviceCache[assetId] = { devices: devices, fetchedAt: Date.now() };
            return devices;
        }

        var promises = assetChildren.map(function(childId) {
            return self.fetchDescendantDevices(childId);
        });

        return Promise.all(promises).then(function(results) {
            results.forEach(function(childDevices) {
                devices = devices.concat(childDevices);
            });
            self.deviceCache[assetId] = { devices: devices, fetchedAt: Date.now() };
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

self.renderCards = function(entityList, loading) {
    if (entityList.length === 0) {
        self.cardsEl.html('<div class="energy-empty">No entities found</div>');
        return;
    }

    var html = '';
    entityList.forEach(function(entity) {
        var result = self.energyCache[entity.id];
        var isLoading = loading || !result;
        var loadingClass = isLoading ? ' loading' : '';
        var deviceCount = result ? result.deviceCount : 0;
        var energyDisplay = isLoading ? '\u2014' : self.formatEnergy(result.energyWh);
        var co2Display = isLoading ? '\u2014' : self.formatCO2(result.co2Grams);
        var deviceText = isLoading ? '...' : (deviceCount + ' device' + (deviceCount !== 1 ? 's' : ''));

        html += '<div class="energy-card' + loadingClass + '">' +
            '<div class="card-top-row">' +
                '<span class="card-entity-name">' + self.escapeHtml(entity.name) + '</span>' +
                '<span class="card-device-count">' + deviceText + '</span>' +
            '</div>' +
            '<div class="card-metrics">' +
                '<div class="metric-block metric-energy">' +
                    '<span class="metric-value">' + energyDisplay + '</span>' +
                    '<span class="metric-label">energy used</span>' +
                '</div>' +
                '<div class="metric-block metric-co2">' +
                    '<span class="metric-value">' + co2Display + '</span>' +
                    '<span class="metric-label">CO\u2082 produced</span>' +
                '</div>' +
            '</div>' +
        '</div>';
    });

    self.cardsEl.html(html);
};

self.formatEnergy = function(wh) {
    if (wh === 0) return '0 <span class="metric-unit">kWh</span>';
    var kwh = wh / 1000;
    if (kwh >= 1000) {
        return (kwh / 1000).toLocaleString(undefined, { maximumFractionDigits: 1 }) +
            ' <span class="metric-unit">MWh</span>';
    }
    return kwh.toLocaleString(undefined, { maximumFractionDigits: 1 }) +
        ' <span class="metric-unit">kWh</span>';
};

self.formatCO2 = function(grams) {
    if (grams === 0) return '0 <span class="metric-unit">kg</span>';
    var kg = grams / 1000;
    if (kg >= 1000) {
        return (kg / 1000).toLocaleString(undefined, { maximumFractionDigits: 1 }) +
            ' <span class="metric-unit">t</span>';
    }
    return kg.toLocaleString(undefined, { maximumFractionDigits: 1 }) +
        ' <span class="metric-unit">kg</span>';
};

self.formatPeriod = function(startTs, endTs) {
    var opts = { month: 'short', day: 'numeric' };
    var start = new Date(startTs).toLocaleDateString(undefined, opts);
    var end = new Date(endTs).toLocaleDateString(undefined, opts);
    if (start === end) return start;
    return start + ' \u2013 ' + end;
};

self.escapeHtml = function(text) {
    if (!text) return '';
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
};

self.onResize = function() {};

self.onDestroy = function() {};
