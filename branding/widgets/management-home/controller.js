// SignConnect Management Home Widget — Controller
// Overview page: stat cards + customer table with lazy-enriched counts.
// Static widget — no datasource.

self.onInit = function() {
    var $root = self.ctx.$container;
    self.statsEl = $root.find('.mh-stats');
    self.tbodyEl = $root.find('.mh-tbody');
    self.loadingEl = $root.find('.mh-loading');
    self.emptyEl = $root.find('.mh-empty');
    self.newCustomerBtn = $root.find('.mh-new-customer-btn');

    self.customers = [];
    self.enriched = {};  // customerId -> { sites, devices, online }

    // New Customer button
    self.newCustomerBtn.on('click', function() {
        try {
            var sc = self.ctx.stateController;
            if (sc && sc.openState) {
                sc.resetState();
                sc.openState('onboarding', {});
                return;
            }
        } catch (e) { /* fallback */ }
    });

    // Show loading
    self.loadingEl.show();
    self.emptyEl.hide();

    // Load customers
    self.loadCustomers().then(function() {
        self.loadingEl.hide();
        if (self.customers.length === 0) {
            self.emptyEl.show();
            self.renderStats(0, 0, 0, 0);
        } else {
            self.renderStats(self.customers.length, 0, 0, 0);
            self.renderTable();
            self.lazyEnrichAll();
        }
    }).catch(function(err) {
        console.error('[MH] Init failed:', err);
        self.loadingEl.hide();
        self.emptyEl.text('Failed to load customers').show();
    });
};

// ── API Helper ─────────────────────────────────────────────

self.apiGet = function(path) {
    var obs = self.ctx.http.get('/api' + path);
    if (obs && typeof obs.toPromise === 'function') return obs.toPromise();
    return new Promise(function(resolve, reject) {
        obs.subscribe(function(d) { resolve(d); }, function(e) { reject(e); });
    });
};

self.esc = function(text) {
    if (!text) return '';
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
};

// ── Customer Loading ───────────────────────────────────────

self.loadCustomers = function() {
    return self.apiGet('/customers?pageSize=1000&page=0&sortProperty=title&sortOrder=ASC').then(function(resp) {
        var data = (resp && resp.data) ? resp.data : (Array.isArray(resp) ? resp : []);
        self.customers = data.filter(function(c) { return c && c.id; }).map(function(c) {
            return {
                id: c.id.id,
                name: c.title || c.name || 'Customer',
                email: c.email || '',
                createdTime: c.createdTime || 0
            };
        });
        self.customers.sort(function(a, b) { return a.name.localeCompare(b.name); });
    }).catch(function(err) {
        console.error('[MH] Failed to load customers:', err);
        self.customers = [];
    });
};

// ── Stat Cards ─────────────────────────────────────────────

self.renderStats = function(customerCount, siteCount, deviceCount, onlinePct) {
    var html = '';
    html += '<div class="mh-stat-card">';
    html += '  <div class="mh-stat-value">' + customerCount + '</div>';
    html += '  <div class="mh-stat-label">Customers</div>';
    html += '</div>';
    html += '<div class="mh-stat-card">';
    html += '  <div class="mh-stat-value">' + siteCount + '</div>';
    html += '  <div class="mh-stat-label">Sites</div>';
    html += '</div>';
    html += '<div class="mh-stat-card">';
    html += '  <div class="mh-stat-value">' + deviceCount + '</div>';
    html += '  <div class="mh-stat-label">Devices</div>';
    html += '</div>';
    html += '<div class="mh-stat-card' + (onlinePct > 0 ? ' mh-stat-online' : '') + '">';
    html += '  <div class="mh-stat-value">' + onlinePct + '%</div>';
    html += '  <div class="mh-stat-label">Online</div>';
    html += '</div>';
    self.statsEl.html(html);
};

// ── Customer Table ─────────────────────────────────────────

self.renderTable = function() {
    var html = '';
    self.customers.forEach(function(c) {
        var createdStr = '';
        if (c.createdTime) {
            var d = new Date(c.createdTime);
            createdStr = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
        }

        html += '<tr data-id="' + c.id + '" data-name="' + self.esc(c.name) + '">';
        html += '  <td>';
        html += '    <div class="mh-customer-name">' + self.esc(c.name) + '</div>';
        if (c.email) html += '    <div class="mh-customer-email">' + self.esc(c.email) + '</div>';
        html += '  </td>';
        html += '  <td class="mh-td-center mh-cell-sites" data-id="' + c.id + '"><span class="mh-spinner"></span></td>';
        html += '  <td class="mh-td-center mh-cell-devices" data-id="' + c.id + '"><span class="mh-spinner"></span></td>';
        html += '  <td class="mh-td-center mh-cell-online" data-id="' + c.id + '"><span class="mh-spinner"></span></td>';
        html += '  <td>' + createdStr + '</td>';
        html += '</tr>';
    });
    self.tbodyEl.html(html);

    // Row click → navigate to customer state
    self.tbodyEl.find('tr').on('click', function() {
        var id = $(this).data('id');
        var name = $(this).data('name');
        try {
            var sc = self.ctx.stateController;
            if (sc && sc.openState) {
                sc.resetState();
                sc.openState('customer', {
                    entityId: { id: id, entityType: 'CUSTOMER' },
                    entityName: name
                });
                return;
            }
        } catch (e) {
            console.log('[MH] Customer state not defined yet:', id);
        }
    });
};

// ── Lazy Enrichment ────────────────────────────────────────

self.lazyEnrichAll = function() {
    var totalSites = 0;
    var totalDevices = 0;
    var totalOnline = 0;

    // Process customers in batches of 5 to avoid overwhelming the API
    var queue = self.customers.slice();
    var batchSize = 5;

    function processBatch() {
        var batch = queue.splice(0, batchSize);
        if (batch.length === 0) return Promise.resolve();

        var promises = batch.map(function(c) {
            return self.enrichCustomer(c.id).then(function(data) {
                totalSites += data.sites;
                totalDevices += data.devices;
                totalOnline += data.online;
            });
        });

        return Promise.all(promises).then(function() {
            // Update stats after each batch
            var onlinePct = totalDevices > 0 ? Math.round((totalOnline / totalDevices) * 100) : 0;
            self.renderStats(self.customers.length, totalSites, totalDevices, onlinePct);
            return processBatch();
        });
    }

    processBatch().catch(function(err) {
        console.error('[MH] Enrichment error:', err);
    });
};

self.enrichCustomer = function(customerId) {
    var result = { sites: 0, devices: 0, online: 0 };

    // Count sites (assets of type containing 'site')
    var sitePromise = self.apiGet('/customer/' + customerId + '/assets?pageSize=1000&page=0').then(function(resp) {
        var data = (resp && resp.data) ? resp.data : (Array.isArray(resp) ? resp : []);
        var siteCount = 0;
        data.forEach(function(a) {
            var t = (a.type || '').toLowerCase();
            if (t === 'site' || t.indexOf('site') !== -1) siteCount++;
        });
        result.sites = siteCount;
    }).catch(function() {});

    // Count devices
    var devicePromise = self.apiGet('/customer/' + customerId + '/devices?pageSize=1000&page=0').then(function(resp) {
        var data = (resp && resp.data) ? resp.data : (Array.isArray(resp) ? resp : []);
        result.devices = data.length;

        // Quick online check via latest telemetry
        if (data.length > 0) {
            var now = Date.now();
            var thresholdMs = 10 * 60 * 1000; // 10 minutes
            var onlineChecks = data.map(function(d) {
                return self.apiGet('/plugins/telemetry/DEVICE/' + d.id.id +
                    '/values/timeseries?keys=dim_value').then(function(ts) {
                    if (ts && ts.dim_value && ts.dim_value.length > 0) {
                        if ((now - ts.dim_value[0].ts) < thresholdMs) {
                            result.online++;
                        }
                    }
                }).catch(function() {});
            });
            return Promise.all(onlineChecks);
        }
    }).catch(function() {});

    return Promise.all([sitePromise, devicePromise]).then(function() {
        self.enriched[customerId] = result;

        // Update table cells
        var siteCell = self.tbodyEl.find('.mh-cell-sites[data-id="' + customerId + '"]');
        var deviceCell = self.tbodyEl.find('.mh-cell-devices[data-id="' + customerId + '"]');
        var onlineCell = self.tbodyEl.find('.mh-cell-online[data-id="' + customerId + '"]');

        siteCell.text(result.sites);
        deviceCell.text(result.devices);

        if (result.devices > 0) {
            var pct = Math.round((result.online / result.devices) * 100);
            onlineCell.html(
                '<span class="mh-online-pct">' +
                '<span class="mh-online-bar"><span class="mh-online-bar-fill" style="width:' + pct + '%"></span></span>' +
                pct + '%' +
                '</span>'
            );
        } else {
            onlineCell.text('-');
        }

        return result;
    });
};

// ── Lifecycle ──────────────────────────────────────────────

self.onDataUpdated = function() {};

self.onResize = function() {};

self.onDestroy = function() {
    self.newCustomerBtn.off('click');
    self.tbodyEl.find('tr').off('click');
};
