// Fleet Energy Summary Widget — Controller
// Combined estate status + energy/CO2 metrics per entity.
// Walks the asset hierarchy to find descendant devices, then fetches
// status (online/offline/faults) and energy (energy_wh/co2_grams) in parallel.

self.onInit = function() {
    self.$container = self.ctx.$container;
    self.cardsEl = self.$container.find('#energy-cards');
    self.periodEl = self.$container.find('#energy-period');
    self.titleEl = self.$container.find('.header-title');

    self.settings = {
        headerTitle: self.ctx.settings.headerTitle || 'Energy Overview',
        onlineThresholdMinutes: self.ctx.settings.onlineThresholdMinutes || 10,
        targetState: self.ctx.settings.targetState || 'estate',
        navigationType: self.ctx.settings.navigationType || 'state',
        targetDashboardId: self.ctx.settings.targetDashboardId || ''
    };

    self.titleEl.text(self.settings.headerTitle);

    self.deviceCache = {};    // assetId → { devices: [{id,lastTs,fault}], fetchedAt }
    self.statsCache = {};     // entityId → { totalDevices, online, offline, faults, fetchedAt }
    self.energyCache = {};    // entityId → { energyWh, co2Grams, fetchedAt }
    self.fetchInProgress = {};
    self.lastTimewindowKey = '';

    // Reports navigation button
    var reportsBtn = self.$container.find('#reports-nav-btn');
    if (reportsBtn.length) {
        reportsBtn.on('click', function(e) {
            e.stopPropagation();
            try {
                self.ctx.stateController.openState('report', {});
            } catch (err) {
                console.error('[FLEET] Failed to navigate to reports:', err);
            }
        });
    }

    // Subscribe to dashboard timewindow changes
    var twSub = self.ctx.dashboard.dashboardTimewindowChanged.subscribe(function() {
        self.onDataUpdated();
    });
    self.twSubscription = twSub;
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

    // Fetch stats + energy in parallel for all entities
    var promises = entityList.map(function(entity) {
        return Promise.all([
            self.getEntityStats(entity.id),
            self.getEntityEnergy(entity.id, tw.startTs, tw.endTs)
        ]);
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
            endTs = now;
            startTs = now - 86400000;
        }
    } else if (tw && tw.realtime) {
        endTs = now;
        startTs = now - (tw.realtime.timewindowMs || 86400000);
    } else {
        endTs = now;
        startTs = now - 86400000;
    }

    return { startTs: startTs, endTs: endTs };
};

// ── Device Status ──────────────────────────────────────────────

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
        delete self.fetchInProgress[key];
        return stats;
    }).catch(function() {
        delete self.fetchInProgress[key];
        return { totalDevices: 0, online: 0, offline: 0, faults: 0, fetchedAt: Date.now() };
    });

    self.fetchInProgress[key] = promise;
    return promise;
};

// ── Energy Data ────────────────────────────────────────────────

self.getEntityEnergy = function(entityId, startTs, endTs) {
    var cached = self.energyCache[entityId];
    if (cached && (Date.now() - cached.fetchedAt) < 30000) {
        return Promise.resolve(cached);
    }

    var key = 'energy_' + entityId;
    if (self.fetchInProgress[key]) {
        return self.fetchInProgress[key];
    }

    var promise = self.fetchDescendantDevices(entityId).then(function(devices) {
        if (devices.length === 0) {
            var empty = { energyWh: 0, co2Grams: 0, fetchedAt: Date.now() };
            self.energyCache[entityId] = empty;
            delete self.fetchInProgress[key];
            return empty;
        }

        var interval = endTs - startTs;
        var devicePromises = devices.map(function(d) {
            var url = '/api/plugins/telemetry/DEVICE/' + d.id +
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
                energyWh: totalWh,
                co2Grams: totalCO2,
                fetchedAt: Date.now()
            };
            self.energyCache[entityId] = result;
            delete self.fetchInProgress[key];
            return result;
        });
    }).catch(function() {
        delete self.fetchInProgress[key];
        return { energyWh: 0, co2Grams: 0, fetchedAt: Date.now() };
    });

    self.fetchInProgress[key] = promise;
    return promise;
};

// ── Hierarchy Walk ─────────────────────────────────────────────

self.fetchDescendantDevices = function(assetId) {
    var cached = self.deviceCache[assetId];
    if (cached && (Date.now() - cached.fetchedAt) < 30000) {
        return Promise.resolve(cached.devices);
    }

    // In-flight dedup: prevent double hierarchy walks when stats+energy call concurrently
    var key = 'devices_' + assetId;
    if (self.fetchInProgress[key]) {
        return self.fetchInProgress[key];
    }

    var promise = self.getChildren(assetId).then(function(children) {
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

// ── Rendering ──────────────────────────────────────────────────

self.renderCards = function(entityList, loading) {
    if (entityList.length === 0) {
        self.renderEmpty();
        return;
    }

    var isSiteList = self.settings.navigationType === 'dashboard';
    var html = '';

    entityList.forEach(function(entity) {
        var stats = self.statsCache[entity.id] || {};
        var energy = self.energyCache[entity.id];
        var isLoading = loading || !energy;
        var loadingClass = isLoading ? ' loading' : '';

        var total = stats.totalDevices || 0;
        var online = stats.online || 0;
        var offline = stats.offline || 0;
        var faults = stats.faults || 0;

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
        var energyDisplay = isLoading ? '\u2014' : self.formatEnergy(energy.energyWh);
        var co2Display = isLoading ? '\u2014' : self.formatCO2(energy.co2Grams);

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

        html += '<div class="energy-card ' + statusClass + loadingClass + '" data-entity-id="' + entity.id + '" data-entity-name="' + self.escapeHtml(entity.name) + '">' +
            '<div class="card-main">' +
                '<div class="card-top-row">' +
                    '<span class="card-entity-name">' + self.escapeHtml(entity.name) + '</span>' +
                    '<span class="card-device-count">' + deviceText + '</span>' +
                '</div>' +
                '<div class="card-pills">' + pillsHtml + '</div>' +
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
            '</div>' +
            '<div class="card-chevron">' +
                '<span class="chevron-icon">\u203A</span>' +
                chevronLabel +
            '</div>' +
        '</div>';
    });

    self.cardsEl.html(html);

    // Bind click handlers for navigation
    self.cardsEl.find('.energy-card').on('click', function() {
        var entityId = $(this).data('entity-id');
        var entityName = $(this).data('entity-name');

        if (self.settings.navigationType === 'dashboard' && self.settings.targetDashboardId) {
            self.navigateToDashboard(entityId, entityName);
        } else {
            self.navigateToState(entityId, entityName);
        }
    });
};

self.renderEmpty = function() {
    self.cardsEl.html('<div class="energy-empty">No data found</div>');
};

// ── Navigation ─────────────────────────────────────────────────

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

self.objToBase64 = function(obj) {
    var json = JSON.stringify(obj);
    return btoa(encodeURIComponent(json).replace(/%([0-9A-F]{2})/g,
        function(match, p1) {
            return String.fromCharCode(Number('0x' + p1));
        }));
};

self.navigateToDashboard = function(entityId, entityName) {
    var dashboardId = self.settings.targetDashboardId;

    var stateArray = [{
        id: 'site',
        params: {
            entityId: { id: entityId, entityType: 'ASSET' },
            entityName: entityName
        }
    }];
    var stateParam = encodeURIComponent(self.objToBase64(stateArray));
    var url = '/dashboards/' + dashboardId + '?state=' + stateParam;

    window.open(url, '_blank');
};

// ── Formatting ─────────────────────────────────────────────────

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

// ── Lifecycle ──────────────────────────────────────────────────

self.onResize = function() {};

self.onDestroy = function() {
    if (self.twSubscription) {
        self.twSubscription.unsubscribe();
        self.twSubscription = null;
    }
    self.cardsEl.find('.energy-card').off('click');
    self.$container.find('#reports-nav-btn').off('click');
};
