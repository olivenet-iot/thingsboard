// Fleet Map Widget — Controller
// Widget type: latest
// Datasource: entity alias returning site assets (All Sites, Estate Sites, Region Sites)
// Datasource keys: latitude, longitude, address (all server attributes)
// Settings: onlineThresholdMinutes, targetDashboardId

self.onInit = function() {
    self.$container = self.ctx.$container;
    self.mapEl = self.$container.find('#fleet-map')[0];

    self.settings = {
        onlineThresholdMinutes: self.ctx.settings.onlineThresholdMinutes || 10,
        targetDashboardId: self.ctx.settings.targetDashboardId || ''
    };

    self.map = null;
    self.markers = {};
    self.markerGroup = null;
    self.statsCache = {};
    self.sitesData = {};
    self.initAttempted = false;

    // Wait for container to have dimensions
    self.initInterval = setInterval(function() {
        if (self.mapEl.offsetWidth > 0 && self.mapEl.offsetHeight > 0) {
            clearInterval(self.initInterval);
            self.initMap();
        }
    }, 100);

    // Safety timeout
    setTimeout(function() {
        clearInterval(self.initInterval);
        if (!self.map) {
            self.initMap();
        }
    }, 2000);
};

self.initMap = function() {
    if (self.initAttempted) return;
    self.initAttempted = true;

    try {
        self.map = L.map(self.mapEl, {
            zoomControl: true,
            attributionControl: false
        }).setView([51.5, 5.0], 5);

        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 19
        }).addTo(self.map);

        self.markerGroup = L.featureGroup().addTo(self.map);

        // Trigger data update now that map is ready
        if (Object.keys(self.sitesData).length > 0) {
            self.updateMarkers();
        }
    } catch (e) {
        console.error('Fleet Map init error:', e);
    }
};

self.onDataUpdated = function() {
    var data = self.ctx.data;
    if (!data || data.length === 0) return;

    // Extract site entities with their attributes
    var sites = {};
    data.forEach(function(item) {
        if (!item.datasource || !item.datasource.entityId) return;
        var id = item.datasource.entityId;

        if (!sites[id]) {
            sites[id] = {
                id: id,
                name: item.datasource.entityName || 'Unknown',
                entityType: item.datasource.entityType || 'ASSET',
                lat: null,
                lng: null,
                address: ''
            };
        }

        if (item.dataKey && item.data && item.data.length > 0) {
            var val = item.data[item.data.length - 1][1];
            switch (item.dataKey.name) {
                case 'latitude':
                    sites[id].lat = parseFloat(val);
                    break;
                case 'longitude':
                    sites[id].lng = parseFloat(val);
                    break;
                case 'address':
                    sites[id].address = val || '';
                    break;
            }
        }
    });

    self.sitesData = sites;

    if (self.map) {
        self.updateMarkers();
    }
};

self.updateMarkers = function() {
    var sites = self.sitesData;
    var siteList = Object.values(sites).filter(function(s) {
        return s.lat && s.lng && !isNaN(s.lat) && !isNaN(s.lng);
    });

    if (siteList.length === 0) return;

    // Fetch stats for all sites, then render markers
    var promises = siteList.map(function(site) {
        return self.getSiteStats(site.id);
    });

    Promise.all(promises).then(function() {
        self.renderMarkers(siteList);
    });
};

self.getSiteStats = function(siteId) {
    var cached = self.statsCache[siteId];
    if (cached && (Date.now() - cached.fetchedAt) < 30000) {
        return Promise.resolve(cached);
    }

    return self.fetchDescendantDevices(siteId).then(function(devices) {
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
            if (d.fault) stats.faults++;
        });

        self.statsCache[siteId] = stats;
        return stats;
    }).catch(function() {
        return { totalDevices: 0, online: 0, offline: 0, faults: 0, fetchedAt: Date.now() };
    });
};

self.fetchDescendantDevices = function(assetId) {
    var url = '/api/relations?fromId=' + assetId + '&fromType=ASSET&relationType=Contains';
    return self.ctx.http.get(url).toPromise().then(function(relations) {
        if (!relations) return [];

        var devices = [];
        relations.forEach(function(rel) {
            if (rel.to.entityType === 'DEVICE') {
                devices.push({ id: rel.to.id, lastTs: 0, fault: false });
            }
        });

        return self.enrichDevices(devices);
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

self.renderMarkers = function(siteList) {
    // Clear existing markers
    self.markerGroup.clearLayers();
    self.markers = {};

    siteList.forEach(function(site) {
        var stats = self.statsCache[site.id] || {};
        var status = self.getSiteStatus(stats);

        // Create colored circle marker
        var markerColor = status.color;
        var markerOptions = {
            radius: 10,
            fillColor: markerColor,
            color: '#ffffff',
            weight: 2,
            opacity: 1,
            fillOpacity: 0.9
        };

        var marker = L.circleMarker([site.lat, site.lng], markerOptions);

        // Add pulsing class for faults
        if (status.key === 'fault') {
            marker.on('add', function() {
                var el = marker.getElement();
                if (el) el.classList.add('marker-fault');
            });
        }

        // Build popup content
        var popupHtml = self.buildPopup(site, stats, status);
        marker.bindPopup(popupHtml, {
            closeButton: true,
            className: ''
        });

        // Add click handler for popup button (delegated after popup opens)
        marker.on('popupopen', function() {
            var btn = document.querySelector('.popup-btn[data-site-id="' + site.id + '"]');
            if (btn) {
                btn.addEventListener('click', function() {
                    self.navigateToSite(site.id, site.name);
                });
            }
        });

        marker.addTo(self.markerGroup);
        self.markers[site.id] = marker;
    });

    // Fit map to markers with padding
    if (siteList.length > 0) {
        try {
            self.map.fitBounds(self.markerGroup.getBounds(), {
                padding: [30, 30],
                maxZoom: 12
            });
        } catch (e) {
            // fallback
        }
    }
};

self.getSiteStatus = function(stats) {
    if (stats.faults > 0) {
        return { key: 'fault', color: '#ef4444', label: 'Fault' };
    }
    if (stats.offline > 0 && stats.online === 0) {
        return { key: 'offline', color: '#94a3b8', label: 'Offline' };
    }
    if (stats.offline > 0) {
        return { key: 'partial', color: '#f59e0b', label: 'Partial' };
    }
    return { key: 'online', color: '#059669', label: 'Online' };
};

self.buildPopup = function(site, stats, status) {
    var total = stats.totalDevices || 0;
    var online = stats.online || 0;
    var offline = stats.offline || 0;
    var faults = stats.faults || 0;

    var html = '<div class="map-popup">';
    html += '<div class="popup-name">' + self.escapeHtml(site.name) + '</div>';

    if (site.address) {
        html += '<div class="popup-address">' + self.escapeHtml(site.address) + '</div>';
    }

    html += '<div class="popup-stats">';
    html += '<span class="popup-stat"><strong>' + total + '</strong>&nbsp;devices</span>';
    if (online > 0) {
        html += '<span class="popup-stat online"><span class="popup-dot online"></span>' + online + '</span>';
    }
    if (offline > 0) {
        html += '<span class="popup-stat offline"><span class="popup-dot offline"></span>' + offline + '</span>';
    }
    if (faults > 0) {
        html += '<span class="popup-stat fault"><span class="popup-dot fault"></span>' + faults + '</span>';
    }
    html += '</div>';

    if (self.settings.targetDashboardId) {
        html += '<button class="popup-btn" data-site-id="' + site.id + '">Open SignConnect →</button>';
    }

    html += '</div>';
    return html;
};

// ── TB CE State Encoding ─────────────────────────────────────
// TB CE uses base64-encoded JSON state array in URL, not raw query params.
// Format: ?state={base64(encodeURIComponent(JSON.stringify(stateArray)))}
// Source: ThingsBoard ui-ngx/src/app/core/utils.ts (objToBase64URI)
self.objToBase64 = function(obj) {
    var json = JSON.stringify(obj);
    return btoa(encodeURIComponent(json).replace(/%([0-9A-F]{2})/g,
        function(match, p1) {
            return String.fromCharCode(Number('0x' + p1));
        }));
};

self.navigateToSite = function(siteId, siteName) {
    if (!self.settings.targetDashboardId) return;

    var stateArray = [{
        id: 'site',
        params: {
            entityId: { id: siteId, entityType: 'ASSET' },
            entityName: siteName
        }
    }];
    var stateParam = encodeURIComponent(self.objToBase64(stateArray));
    var url = '/dashboards/' + self.settings.targetDashboardId + '?state=' + stateParam;

    window.open(url, '_blank');
};

self.escapeHtml = function(text) {
    if (!text) return '';
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
};

self.onResize = function() {
    if (self.map) {
        setTimeout(function() {
            self.map.invalidateSize();
        }, 100);
    }
};

self.onDestroy = function() {
    if (self.initInterval) clearInterval(self.initInterval);
    if (self.map) {
        self.map.remove();
        self.map = null;
    }
};
