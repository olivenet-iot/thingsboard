// ===================================================================
// SignConnect - Site Manager Widget (controller.js)
// ===================================================================
// SITE state widget for the Management Dashboard. Shows:
//   Tab 1: Details (site metadata, address with Nominatim, edit mode)
//   Tab 2: Devices (table view with status)
//   Tab 3: Add Device (quick provisioning form)
//
// Receives site ASSET ID from dashboard state params.
// Queries relations to find child devices.
// ===================================================================

var _addrDebounceTimer = null;
var _addrOutsideClickFn = null;

self.onInit = function () {
    'use strict';

    var $root = self.ctx.$container[0];
    var container = $root.querySelector('.sm-root');
    if (!container) {
        $root.innerHTML = '<div class="sm-root"></div>';
        container = $root.querySelector('.sm-root');
    }
    var http = self.ctx.http;

    // ── State Variables ────────────────────────────────────────

    var siteId = null;
    var siteEntity = null;
    var siteAttrs = {};
    var devices = [];
    var parentBreadcrumb = '';
    var parentCustomerName = '';
    var parentEstateName = '';
    var parentRegionName = '';
    var activeTab = 'details';
    var isEditing = false;
    var isSaving = false;

    // Address autocomplete state
    var addressSearchExpanded = false;
    var addressSearchResults = [];
    var addressSelected = null;
    var addressFetching = false;
    var addressDebounceTimer = null;

    // Add Device tab state
    var deviceProfiles = {};
    var addDeviceForm = { name: '', profileId: '', profileName: '', poolDeviceId: '', poolDeviceName: '' };
    var addDeviceStatus = '';
    var addDeviceError = '';
    var poolDevices = [];
    var poolFetched = false;
    var poolFetchError = '';
    var addDevicePoolMode = true;

    // Delete state
    var deleteState = 'idle';
    var deleteLog = [];
    var deleteError = '';

    // ── CO2 Factors ────────────────────────────────────────────

    var CO2_FACTORS = {
        NL: { co2: 0.269, rate: 0.29, currency: 'EUR', symbol: '\u20ac', name: 'Netherlands' },
        GB: { co2: 0.207, rate: 0.30, currency: 'GBP', symbol: '\u00a3', name: 'United Kingdom' },
        DE: { co2: 0.371, rate: 0.38, currency: 'EUR', symbol: '\u20ac', name: 'Germany' },
        FR: { co2: 0.056, rate: 0.27, currency: 'EUR', symbol: '\u20ac', name: 'France' },
        BE: { co2: 0.144, rate: 0.36, currency: 'EUR', symbol: '\u20ac', name: 'Belgium' },
        TR: { co2: 0.440, rate: 4.20, currency: 'TRY', symbol: '\u20ba', name: 'Turkey' },
        AT: { co2: 0.105, rate: 0.29, currency: 'EUR', symbol: '\u20ac', name: 'Austria' },
        CH: { co2: 0.025, rate: 0.27, currency: 'CHF', symbol: 'Fr', name: 'Switzerland' },
        CZ: { co2: 0.450, rate: 0.31, currency: 'CZK', symbol: 'K\u010d', name: 'Czechia' },
        DK: { co2: 0.140, rate: 0.35, currency: 'DKK', symbol: 'kr', name: 'Denmark' },
        ES: { co2: 0.150, rate: 0.26, currency: 'EUR', symbol: '\u20ac', name: 'Spain' },
        FI: { co2: 0.070, rate: 0.19, currency: 'EUR', symbol: '\u20ac', name: 'Finland' },
        GR: { co2: 0.270, rate: 0.20, currency: 'EUR', symbol: '\u20ac', name: 'Greece' },
        IE: { co2: 0.296, rate: 0.37, currency: 'EUR', symbol: '\u20ac', name: 'Ireland' },
        IT: { co2: 0.315, rate: 0.33, currency: 'EUR', symbol: '\u20ac', name: 'Italy' },
        LU: { co2: 0.080, rate: 0.26, currency: 'EUR', symbol: '\u20ac', name: 'Luxembourg' },
        NO: { co2: 0.030, rate: 0.22, currency: 'NOK', symbol: 'kr', name: 'Norway' },
        PL: { co2: 0.662, rate: 0.30, currency: 'PLN', symbol: 'z\u0142', name: 'Poland' },
        PT: { co2: 0.120, rate: 0.22, currency: 'EUR', symbol: '\u20ac', name: 'Portugal' },
        SE: { co2: 0.041, rate: 0.25, currency: 'SEK', symbol: 'kr', name: 'Sweden' },
        AE: { co2: 0.410, rate: 0.08, currency: 'AED', symbol: 'AED', name: 'United Arab Emirates' },
        AU: { co2: 0.530, rate: 0.30, currency: 'AUD', symbol: 'A$', name: 'Australia' },
        BR: { co2: 0.080, rate: 0.70, currency: 'BRL', symbol: 'R$', name: 'Brazil' },
        CA: { co2: 0.120, rate: 0.14, currency: 'CAD', symbol: 'C$', name: 'Canada' },
        CN: { co2: 0.540, rate: 0.54, currency: 'CNY', symbol: '\u00a5', name: 'China' },
        IN: { co2: 0.713, rate: 6.50, currency: 'INR', symbol: '\u20b9', name: 'India' },
        JP: { co2: 0.460, rate: 0.27, currency: 'JPY', symbol: '\u00a5', name: 'Japan' },
        KR: { co2: 0.410, rate: 0.11, currency: 'KRW', symbol: '\u20a9', name: 'South Korea' },
        MX: { co2: 0.410, rate: 3.20, currency: 'MXN', symbol: 'MX$', name: 'Mexico' },
        SA: { co2: 0.560, rate: 0.05, currency: 'SAR', symbol: 'SAR', name: 'Saudi Arabia' },
        SG: { co2: 0.370, rate: 0.27, currency: 'SGD', symbol: 'S$', name: 'Singapore' },
        US: { co2: 0.390, rate: 0.17, currency: 'USD', symbol: '$', name: 'United States' },
        ZA: { co2: 0.710, rate: 2.50, currency: 'ZAR', symbol: 'R', name: 'South Africa' }
    };

    // ── Entity Resolution ──────────────────────────────────────

    function resolveSiteId() {
        try {
            var stateParams = self.ctx.stateController.getStateParams();
            if (stateParams && stateParams.entityId && stateParams.entityId.id) {
                return stateParams.entityId.id;
            }
        } catch (e) {}
        try {
            var ds = self.ctx.datasources;
            if (ds && ds.length > 0 && ds[0].entity) {
                var eid = ds[0].entity.id;
                return (typeof eid === 'object' && eid !== null) ? eid.id : eid;
            }
        } catch (e) {}
        return (self.ctx.settings && self.ctx.settings.siteAssetId) || null;
    }

    // ── API Helpers ────────────────────────────────────────────

    function apiGet(path) {
        var obs = http.get('/api' + path);
        if (obs && typeof obs.toPromise === 'function') {
            return obs.toPromise();
        }
        return new Promise(function (resolve, reject) {
            obs.subscribe(
                function (data) { resolve(data); },
                function (err) { reject(err); }
            );
        });
    }

    function apiPost(path, body) {
        var obs = http.post('/api' + path, body);
        if (obs && typeof obs.toPromise === 'function') {
            return obs.toPromise();
        }
        return new Promise(function (resolve, reject) {
            obs.subscribe(
                function (data) { resolve(data); },
                function (err) { reject(err); }
            );
        });
    }

    function apiDelete(path) {
        var obs = http.delete('/api' + path);
        if (obs && typeof obs.toPromise === 'function') {
            return obs.toPromise();
        }
        return new Promise(function (resolve, reject) {
            obs.subscribe(
                function (data) { resolve(data); },
                function (err) { reject(err); }
            );
        });
    }

    function fetchExternal(url, timeoutMs) {
        var ctrl = new AbortController();
        var timer = setTimeout(function () { ctrl.abort(); }, timeoutMs || 8000);
        return fetch(url, {
            headers: { 'Accept': 'application/json' },
            signal: ctrl.signal
        }).then(function (resp) {
            clearTimeout(timer);
            if (!resp.ok) throw new Error('HTTP ' + resp.status);
            return resp.json();
        }).catch(function (err) {
            clearTimeout(timer);
            throw err;
        });
    }

    function esc(str) {
        if (!str) return '';
        return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function timeSince(ts) {
        var diff = Date.now() - ts;
        if (diff < 60000) return 'Just now';
        if (diff < 3600000) return Math.floor(diff / 60000) + ' min ago';
        if (diff < 86400000) return Math.floor(diff / 3600000) + 'h ago';
        return Math.floor(diff / 86400000) + 'd ago';
    }

    // ── Data Fetching ──────────────────────────────────────────

    function fetchDevices() {
        return apiGet('/relations?fromId=' + siteId + '&fromType=ASSET&relationType=Contains')
            .then(function (relations) {
                var deviceRels = relations.filter(function (r) {
                    return r.to && r.to.entityType === 'DEVICE';
                });
                if (deviceRels.length === 0) { devices = []; return; }
                var promises = deviceRels.map(function (r) {
                    return apiGet('/device/' + r.to.id).then(function (dev) {
                        var lastAct = 0;
                        if (dev.additionalInfo && dev.additionalInfo.lastActivityTime) {
                            lastAct = dev.additionalInfo.lastActivityTime;
                        }
                        return {
                            id: dev.id.id,
                            name: dev.name || 'Unknown',
                            type: dev.type || '',
                            profileId: dev.deviceProfileId ? dev.deviceProfileId.id : '',
                            profileName: '',
                            lastActivity: lastAct,
                            online: lastAct > 0 && (Date.now() - lastAct) < 600000
                        };
                    });
                });
                return Promise.all(promises).then(function (devs) {
                    devices = devs;
                    // Resolve profile names
                    var profileIds = {};
                    devs.forEach(function (d) { if (d.profileId) profileIds[d.profileId] = true; });
                    var profilePromises = Object.keys(profileIds).map(function (pid) {
                        return apiGet('/deviceProfile/' + pid).then(function (p) {
                            return { id: pid, name: p.name };
                        }).catch(function () { return { id: pid, name: 'Unknown' }; });
                    });
                    return Promise.all(profilePromises).then(function (profiles) {
                        var profileMap = {};
                        profiles.forEach(function (p) { profileMap[p.id] = p.name; });
                        devices.forEach(function (d) { d.profileName = profileMap[d.profileId] || d.type || ''; });
                    });
                });
            });
    }

    function fetchBreadcrumb() {
        parentEstateName = '';
        parentRegionName = '';
        return apiGet('/relations?toId=' + siteId + '&toType=ASSET&relationType=Contains')
            .then(function (rels) {
                var parentRel = rels.find(function (r) { return r.from && r.from.entityType === 'ASSET'; });
                if (!parentRel) { parentBreadcrumb = ''; return; }
                return apiGet('/asset/' + parentRel.from.id).then(function (region) {
                    parentRegionName = region.name;
                    return apiGet('/relations?toId=' + parentRel.from.id + '&toType=ASSET&relationType=Contains')
                        .then(function (rels2) {
                            var estateRel = rels2.find(function (r) { return r.from && r.from.entityType === 'ASSET'; });
                            if (estateRel) {
                                return apiGet('/asset/' + estateRel.from.id).then(function (estate) {
                                    parentEstateName = estate.name;
                                    parentBreadcrumb = estate.name + ' > ' + parentRegionName;
                                });
                            }
                            parentBreadcrumb = parentRegionName;
                        });
                });
            }).catch(function () { parentBreadcrumb = ''; });
    }

    function saveSiteAttributes(attrs) {
        return apiPost('/plugins/telemetry/ASSET/' + siteId + '/attributes/SERVER_SCOPE', attrs);
    }

    // ═══ RENDER ════════════════════════════════════════════════

    function render() {
        var html = renderHeader() + renderTabs();
        if (activeTab === 'details') html += renderDetailsTab();
        else if (activeTab === 'devices') html += renderDevicesTab();
        else if (activeTab === 'add-device') html += renderAddDeviceTab();
        container.innerHTML = html;
        bindEvents();
    }

    // ── Header ─────────────────────────────────────────────────

    function renderHeader() {
        var siteName = (siteEntity && siteEntity.name) ? siteEntity.name : 'Site';
        var html = '<div class="sm-header">';
        html += '<button class="sm-back-btn" data-action="go-back">' +
            '<svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"/></svg>' +
            ' Back</button>';
        if (parentBreadcrumb) {
            html += '<div class="sm-breadcrumb">' + esc(parentBreadcrumb) + '</div>';
        }
        html += '<h2 class="sm-site-name">' + esc(siteName) + '</h2>';
        html += '</div>';
        return html;
    }

    // ── Tabs ───────────────────────────────────────────────────

    function renderTabs() {
        return '<div class="sm-tabs">' +
            tabBtn('details', 'Details') +
            tabBtn('devices', 'Devices (' + devices.length + ')') +
            tabBtn('add-device', 'Add Device') +
        '</div>';
    }

    function tabBtn(id, label) {
        var cls = activeTab === id ? ' active' : '';
        return '<button class="sm-tab' + cls + '" data-tab="' + id + '">' + label + '</button>';
    }

    // ═══ TAB 1: DETAILS ════════════════════════════════════════

    function renderDetailsTab() {
        var html = '';

        // Action toolbar
        html += '<div class="sm-meta-toolbar">';
        if (deleteState !== 'idle') {
            html += renderDeleteDialog();
        }
        html += '<button class="sm-edit-btn" data-action="toggle-edit">' +
                (isEditing
                    ? '<svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg> Save Changes'
                    : '<svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg> Edit'
                ) +
            '</button>';
        html += '<button class="sm-delete-btn" data-action="delete-site">Delete Site</button>';
        html += '</div>';

        // Single flat card with all site metadata
        html += '<div class="sm-card">';
        html += metaField('name', 'Site Name', siteEntity ? siteEntity.name : '');
        html += metaField('dashboard_tier', 'Tier', siteAttrs.dashboard_tier || '');
        html += metaField('site_address', 'Address', siteAttrs.site_address || siteAttrs.address || '');
        html += metaField('site_city', 'City', siteAttrs.site_city || '');
        html += metaField('site_country', 'Country', siteAttrs.site_country || '');
        html += metaField('latitude', 'Latitude', siteAttrs.latitude || '');
        html += metaField('longitude', 'Longitude', siteAttrs.longitude || '');

        // Timezone display
        var tzVal = siteAttrs.tzOffset;
        var tzDisplay = tzVal ? ((parseFloat(tzVal) >= 0 ? '+' : '') + tzVal) : '';
        html += metaField('tzOffset', 'Timezone', tzDisplay);

        // CO2 Factor display
        var co2Val = siteAttrs.co2_per_kwh || '';
        var co2Display = co2Val ? (co2Val + ' kg/kWh') : '';
        html += metaField('co2_per_kwh', 'CO2 Factor', isEditing ? (siteAttrs.co2_per_kwh || '') : co2Display);

        // Energy Rate display
        var rateVal = siteAttrs.energy_rate || '';
        var currSym = siteAttrs.currency_symbol || '';
        var rateDisplay = rateVal ? (currSym + rateVal + '/kWh') : '';
        html += metaField('energy_rate', 'Energy Rate', isEditing ? (siteAttrs.energy_rate || '') : rateDisplay);

        html += metaSelect('currency_symbol', 'Currency', siteAttrs.currency_symbol || '', [
            { value: '\u00a3', label: '\u00a3 (GBP)' },
            { value: '\u20ac', label: '\u20ac (EUR)' },
            { value: '$', label: '$ (USD)' },
            { value: '\u20ba', label: '\u20ba (TRY)' }
        ]);
        html += '</div>';

        // Address autocomplete section (full-width)
        html += renderAddressSection();

        return html;
    }

    var META_ICONS = {
        bolt: '<svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>',
        map: '<svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"/></svg>',
        user: '<svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"/></svg>'
    };

    function metaCard(title, icon, fields) {
        return '<div class="sm-meta-card">' +
            '<div class="sm-meta-card-title">' +
                '<div class="sm-meta-icon sm-meta-icon-amber">' + META_ICONS[icon] + '</div>' +
                title +
            '</div>' +
            fields.join('') +
        '</div>';
    }

    function metaField(key, label, value) {
        if (isEditing) {
            return '<div class="sm-meta-row">' +
                '<span class="sm-meta-label">' + label + '</span>' +
                '<input class="sm-meta-input" data-attr="' + key + '" value="' + esc(value) + '" />' +
            '</div>';
        }
        return '<div class="sm-meta-row">' +
            '<span class="sm-meta-label">' + label + '</span>' +
            '<span class="sm-meta-value">' + (value ? esc(value) : '<em class="sm-meta-empty">Not set</em>') + '</span>' +
        '</div>';
    }

    function metaSelect(key, label, value, options) {
        if (isEditing) {
            var html = '<div class="sm-meta-row">' +
                '<span class="sm-meta-label">' + label + '</span>' +
                '<select class="sm-meta-input" data-attr="' + key + '">';
            html += '<option value="">-- Select --</option>';
            options.forEach(function (opt) {
                html += '<option value="' + esc(opt.value) + '"' +
                    (value === opt.value ? ' selected' : '') + '>' + esc(opt.label) + '</option>';
            });
            html += '</select></div>';
            return html;
        }
        var displayLabel = value || '';
        options.forEach(function (opt) {
            if (opt.value === value) displayLabel = opt.label;
        });
        return '<div class="sm-meta-row">' +
            '<span class="sm-meta-label">' + label + '</span>' +
            '<span class="sm-meta-value">' + (displayLabel ? esc(displayLabel) : '<em class="sm-meta-empty">Not set</em>') + '</span>' +
        '</div>';
    }

    // ── Address Autocomplete Section ───────────────────────────

    function renderAddressSection() {
        var hasLocation = siteAttrs.latitude && siteAttrs.longitude &&
            !isNaN(parseFloat(siteAttrs.latitude)) && !isNaN(parseFloat(siteAttrs.longitude));
        var showSearch = addressSearchExpanded || !hasLocation;

        var html = '<div class="sm-meta-card" style="margin-top:16px">' +
            '<div class="sm-meta-card-title">' +
                '<div class="sm-meta-icon sm-meta-icon-green">' + META_ICONS.map + '</div>' +
                'Address Lookup' +
            '</div>';

        if (hasLocation && !addressSearchExpanded) {
            var addr = siteAttrs.address || siteAttrs.site_address || '';
            var city = siteAttrs.site_city || '';
            var country = siteAttrs.site_country || '';
            var displayAddr = addr || [city, country].filter(Boolean).join(', ') || 'Coordinates set';
            html += '<div class="sm-addr-current">' +
                '<div class="sm-addr-current-text">' + esc(displayAddr) + '</div>' +
                '<div class="sm-addr-current-coords">' +
                    parseFloat(siteAttrs.latitude).toFixed(4) + ', ' +
                    parseFloat(siteAttrs.longitude).toFixed(4) +
                '</div>' +
                '<button class="sm-addr-change-btn" data-action="addr-toggle-search">Change Location</button>' +
            '</div>';
        }

        if (showSearch) {
            if (hasLocation && addressSearchExpanded) {
                html += '<div style="margin-bottom:8px">' +
                    '<button class="sm-addr-change-btn" data-action="addr-toggle-search" style="position:static">Cancel</button>' +
                '</div>';
            }
            html += '<div class="sm-addr-search-wrap">' +
                '<div class="sm-addr-input-wrap">' +
                    '<input type="text" class="sm-addr-input" data-action="addr-search-input"' +
                        ' placeholder="Search address or city\u2026" autocomplete="off" />' +
                    (addressFetching ? '<div class="sm-addr-spinner"></div>' : '') +
                '</div>';

            // Dropdown results
            if (addressSearchResults.length > 0 && !addressSelected) {
                html += '<div class="sm-addr-dropdown">';
                addressSearchResults.forEach(function (r, i) {
                    html += '<div class="sm-addr-option' + (i === 0 ? ' sm-addr-option-active' : '') +
                        '" data-action="addr-select" data-addr-idx="' + i + '">' +
                        esc(r.display_name) + '</div>';
                });
                html += '</div>';
            }

            // Preview selected result
            if (addressSelected) {
                var sel = addressSelected;
                html += '<div class="sm-addr-preview">' +
                    '<div class="sm-addr-preview-name">' + esc(sel.display_name) + '</div>' +
                    '<div class="sm-addr-preview-coords">' +
                        parseFloat(sel.lat).toFixed(4) + ', ' + parseFloat(sel.lon).toFixed(4) +
                    '</div>' +
                '</div>';
                html += '<div class="sm-addr-actions">' +
                    '<button class="sm-btn sm-btn-secondary sm-btn-sm" data-action="addr-clear">Clear</button>' +
                    '<button class="sm-btn sm-btn-primary sm-btn-sm" data-action="addr-confirm">Confirm & Save</button>' +
                '</div>';
            }

            html += '</div>';
        }

        html += '</div>';
        return html;
    }

    function fetchAddressSuggestions(query) {
        addressFetching = true;
        addressSearchResults = [];
        addressSelected = null;
        render();

        var url = 'https://nominatim.openstreetmap.org/search?q=' + encodeURIComponent(query) +
            '&format=json&limit=6&addressdetails=1';

        fetch(url, { headers: { 'Accept': 'application/json' } })
        .then(function (resp) { return resp.json(); })
        .then(function (results) {
            addressFetching = false;
            addressSearchResults = results || [];
            render();
            if (addressSearchResults.length === 0) {
                var wrap = container.querySelector('.sm-addr-search-wrap');
                if (wrap && !wrap.querySelector('.sm-addr-no-results')) {
                    var msg = document.createElement('div');
                    msg.className = 'sm-addr-no-results';
                    msg.textContent = 'No results found. Try a different search.';
                    wrap.appendChild(msg);
                }
            }
        })
        .catch(function () {
            addressFetching = false;
            addressSearchResults = [];
            render();
        });
    }

    function confirmAddress() {
        if (!addressSelected) return;
        var sel = addressSelected;
        var addrParts = sel.address || {};
        var cc = (addrParts.country_code || '').toUpperCase();
        var cInfo = CO2_FACTORS[cc] || {};

        var attrs = {
            latitude: String(sel.lat),
            longitude: String(sel.lon),
            address: sel.display_name || '',
            site_address: [addrParts.road, addrParts.house_number].filter(Boolean).join(' ') || '',
            site_city: addrParts.city || addrParts.town || addrParts.village || addrParts.municipality || '',
            site_postcode: addrParts.postcode || '',
            site_country: addrParts.country || ''
        };
        if (cc) attrs.country_code = cc;
        if (cInfo.co2) attrs.co2_per_kwh = String(cInfo.co2);
        if (cInfo.rate) attrs.energy_rate = String(cInfo.rate);
        if (cInfo.symbol) attrs.currency_symbol = cInfo.symbol;

        saveSiteAttributes(attrs).then(function () {
            Object.keys(attrs).forEach(function (k) { siteAttrs[k] = attrs[k]; });
            resetAddressState();
            render();
        }).catch(function () {
            render();
        });
    }

    function resetAddressState() {
        addressSearchExpanded = false;
        addressSearchResults = [];
        addressSelected = null;
        addressFetching = false;
        if (addressDebounceTimer) {
            clearTimeout(addressDebounceTimer);
            addressDebounceTimer = null;
        }
    }

    // ═══ TAB 2: DEVICES ════════════════════════════════════════

    function renderDevicesTab() {
        var html = '';

        if (devices.length === 0) {
            html += '<div class="sm-empty">' +
                '<div class="sm-empty-icon">&#128225;</div>' +
                '<div class="sm-empty-text">No devices found under this site.</div>' +
                '<div class="sm-empty-hint">Use the "Add Device" tab to provision a new device.</div>' +
            '</div>';
            return html;
        }

        html += '<div class="sm-table-wrap">';
        html += '<table class="sm-table">';
        html += '<thead><tr>' +
            '<th>Device Name</th>' +
            '<th>Profile</th>' +
            '<th>Status</th>' +
            '<th>Last Seen</th>' +
        '</tr></thead>';
        html += '<tbody>';
        devices.forEach(function (dev) {
            var statusCls = dev.online ? 'sm-status-online' : 'sm-status-offline';
            var statusLabel = dev.online ? 'Online' : 'Offline';
            var dotCls = dev.online ? 'sm-dot-online' : 'sm-dot-offline';
            var lastSeen = dev.lastActivity > 0 ? timeSince(dev.lastActivity) : 'Never';
            html += '<tr class="sm-device-row-click" data-action="open-device" data-device-id="' + dev.id + '" data-device-name="' + esc(dev.name) + '">';
            html += '<td><strong>' + esc(dev.name) + '</strong></td>';
            html += '<td>' + esc(dev.profileName) + '</td>';
            html += '<td><span class="sm-status-badge ' + statusCls + '"><span class="sm-dot ' + dotCls + '"></span>' + statusLabel + '</span></td>';
            html += '<td style="color:#94a3b8;font-size:12px">' + lastSeen + '</td>';
            html += '</tr>';
        });
        html += '</tbody></table></div>';
        return html;
    }

    // ── Delete Dialog ──────────────────────────────────────────

    function renderDeleteDialog() {
        var html = '<div class="sm-dialog-overlay">';
        html += '<div class="sm-dialog">';

        if (deleteState === 'confirm') {
            var name = siteEntity ? siteEntity.name : 'this site';
            html += '<h3 class="sm-dialog-title">Delete ' + esc(name) + '?</h3>';
            html += '<p class="sm-dialog-message">This will delete ' + devices.length + ' device' + (devices.length !== 1 ? 's' : '') + ' and this site asset. This cannot be undone.</p>';
            html += '<div class="sm-dialog-actions">';
            html += '<button class="sm-btn sm-btn-secondary" data-action="cancel-delete-site">Cancel</button>';
            html += '<button class="sm-btn sm-btn-danger" data-action="confirm-delete-site">Delete</button>';
            html += '</div>';
        } else if (deleteState === 'deleting') {
            html += '<h3 class="sm-dialog-title">Deleting...</h3>';
            html += '<div style="max-height:200px;overflow-y:auto;margin-top:12px">';
            deleteLog.forEach(function (entry) {
                html += '<div class="sm-log-entry ' + (entry.status || '') + '">' + esc(entry.text) + '</div>';
            });
            html += '</div>';
        } else if (deleteState === 'done') {
            html += '<h3 class="sm-dialog-title">Site Deleted</h3>';
            html += '<p class="sm-dialog-message">All entities have been removed.</p>';
            html += '<div class="sm-dialog-actions">';
            html += '<button class="sm-btn sm-btn-primary" data-action="go-back">Go Back</button>';
            html += '</div>';
        } else if (deleteState === 'error') {
            html += '<h3 class="sm-dialog-title">Delete Failed</h3>';
            html += '<p class="sm-dialog-message" style="color:#ef4444">' + esc(deleteError) + '</p>';
            html += '<div class="sm-dialog-actions">';
            html += '<button class="sm-btn sm-btn-secondary" data-action="cancel-delete-site">Close</button>';
            html += '</div>';
        }

        html += '</div></div>';
        return html;
    }

    function startDeleteSite() {
        deleteState = 'confirm';
        deleteLog = [];
        deleteError = '';
        render();
    }

    function executeDeleteSite() {
        deleteState = 'deleting';
        deleteLog = [];
        render();

        function log(text, status) {
            deleteLog.push({ text: text, status: status || 'run' });
            render();
        }

        // Delete devices first
        var chain = Promise.resolve();
        devices.forEach(function (dev) {
            chain = chain.then(function () {
                log('Deleting device ' + dev.name + '...', 'run');
                return apiDelete('/device/' + dev.id).then(function () {
                    deleteLog[deleteLog.length - 1].status = 'ok';
                    deleteLog[deleteLog.length - 1].text += ' - done';
                }).catch(function () {
                    deleteLog[deleteLog.length - 1].status = 'fail';
                    deleteLog[deleteLog.length - 1].text += ' - failed';
                });
            });
        });

        // Then delete the site asset
        chain.then(function () {
            log('Deleting site asset...', 'run');
            return apiDelete('/asset/' + siteId).then(function () {
                deleteLog[deleteLog.length - 1].status = 'ok';
                deleteLog[deleteLog.length - 1].text += ' - done';
            });
        }).then(function () {
            deleteState = 'done';
            render();
        }).catch(function () {
            deleteState = 'error';
            deleteError = 'Deletion failed. Some entities may have been removed.';
            render();
        });
    }

    // ═══ TAB 3: ADD DEVICE ═════════════════════════════════════

    function getDefaultTierProfile() {
        var tier = (siteAttrs.dashboard_tier || 'standard').toLowerCase();
        var profKeys = Object.keys(deviceProfiles);
        for (var p = 0; p < profKeys.length; p++) {
            var pLower = profKeys[p].toLowerCase();
            if (tier === 'plus' && pLower.indexOf('d4i') >= 0) return profKeys[p];
            if (tier === 'standard' && pLower.indexOf('dali2') >= 0) return profKeys[p];
        }
        return profKeys[0] || '';
    }

    function renderAddDeviceTab() {
        var html = '';

        // Status messages
        if (addDeviceStatus === 'done') {
            var doneMsg = addDevicePoolMode ? 'Device assigned successfully and linked to this site.' : 'Device created successfully and linked to this site.';
            html += '<div class="sm-success-msg">' + doneMsg + '</div>';
        }
        if (addDeviceStatus === 'error') {
            html += '<div class="sm-error-msg">' + esc(addDeviceError || 'Failed to create device.') + '</div>';
        }

        html += '<div class="sm-meta-card">';
        html += '<div class="sm-meta-card-title">' +
            '<div class="sm-meta-icon sm-meta-icon-amber">' +
                '<svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/></svg>' +
            '</div>' +
            (addDevicePoolMode ? 'Assign Device from Pool' : 'Provision New Device') +
        '</div>';

        if (addDevicePoolMode) {
            // Pool mode
            if (poolFetchError) {
                html += '<div class="sm-info-msg">' + esc(poolFetchError) + '</div>';
            } else if (poolDevices.length === 0) {
                html += '<div class="sm-info-msg">No devices in pool. <a href="#" data-action="toggle-pool-mode" class="sm-pool-toggle">Create device manually</a> or register devices first.</div>';
            } else {
                // Pool device dropdown
                html += '<div class="sm-form-group">' +
                    '<label>Select Device from Pool</label>' +
                    '<select class="sm-select" data-add-field="poolDevice">' +
                    '<option value="">-- Select Pool Device --</option>';
                for (var pi = 0; pi < poolDevices.length; pi++) {
                    var pd = poolDevices[pi];
                    var pdLabel = pd.name + ' (' + pd.dev_eui + ')';
                    var pdSel = addDeviceForm.poolDeviceId === pd.id ? ' selected' : '';
                    html += '<option value="' + esc(pd.id) + '"' + pdSel + '>' + esc(pdLabel) + '</option>';
                }
                html += '</select></div>';

                // Device profile dropdown (auto-selected by tier)
                html += '<div class="sm-form-group">' +
                    '<label>Device Profile</label>' +
                    '<select class="sm-select" data-add-field="profile">';
                html += '<option value="">-- Select Profile --</option>';
                var profKeys = Object.keys(deviceProfiles);
                for (var pk = 0; pk < profKeys.length; pk++) {
                    var selected = addDeviceForm.profileName === profKeys[pk] ? ' selected' : '';
                    html += '<option value="' + esc(profKeys[pk]) + '"' + selected + '>' + esc(profKeys[pk]) + '</option>';
                }
                html += '</select></div>';
            }

            // Assign button
            var canAssign = addDeviceForm.poolDeviceId && addDeviceForm.profileName;
            var btnDisabled = !canAssign || addDeviceStatus === 'saving' ? ' disabled' : '';
            var btnLabel = addDeviceStatus === 'saving' ? 'Assigning...' : 'Assign Device';
            html += '<div style="margin-top:20px; display:flex; justify-content:flex-end; align-items:center;">';
            if (!poolFetchError) {
                html += '<a href="#" data-action="toggle-pool-mode" class="sm-pool-toggle" style="margin-right:auto">or create device manually</a>';
            }
            html += '<button class="sm-btn sm-btn-primary" data-action="create-device"' + btnDisabled + '>' + btnLabel + '</button>';
            html += '</div>';
        } else {
            // Manual mode (original form)
            html += '<div class="sm-form-group">' +
                '<label>Device Name</label>' +
                '<input class="sm-input" data-add-field="name" value="' + esc(addDeviceForm.name) + '" placeholder="e.g. LUM-001" />' +
            '</div>';

            html += '<div class="sm-form-group">' +
                '<label>Device Profile</label>' +
                '<select class="sm-select" data-add-field="profile">';
            html += '<option value="">-- Select Profile --</option>';
            var profKeys2 = Object.keys(deviceProfiles);
            for (var pk2 = 0; pk2 < profKeys2.length; pk2++) {
                var selected2 = addDeviceForm.profileName === profKeys2[pk2] ? ' selected' : '';
                html += '<option value="' + esc(profKeys2[pk2]) + '"' + selected2 + '>' + esc(profKeys2[pk2]) + '</option>';
            }
            html += '</select></div>';

            var canCreate = addDeviceForm.name.trim() && addDeviceForm.profileName;
            var btnDisabled2 = !canCreate || addDeviceStatus === 'saving' ? ' disabled' : '';
            var btnLabel2 = addDeviceStatus === 'saving' ? 'Creating...' : 'Create Device';
            html += '<div style="margin-top:20px; display:flex; justify-content:flex-end; align-items:center;">';
            html += '<a href="#" data-action="toggle-pool-mode" class="sm-pool-toggle" style="margin-right:auto">or select from device pool</a>';
            html += '<button class="sm-btn sm-btn-primary" data-action="create-device"' + btnDisabled2 + '>' + btnLabel2 + '</button>';
            html += '</div>';
        }

        html += '</div>';
        return html;
    }

    function fetchDeviceProfiles() {
        return apiGet('/deviceProfiles?pageSize=100&page=0')
            .then(function (resp) {
                var data = (resp && resp.data) ? resp.data : (Array.isArray(resp) ? resp : []);
                deviceProfiles = {};
                data.forEach(function (p) {
                    if (p && p.name) {
                        deviceProfiles[p.name] = p.id.id;
                    }
                });
            }).catch(function () { deviceProfiles = {}; });
    }

    function fetchPool() {
        return fetchExternal('http://46.225.54.21:5002/pool', 10000)
            .then(function (resp) {
                poolDevices = (resp && resp.devices) ? resp.devices : [];
                poolFetched = true;
                poolFetchError = '';
            })
            .catch(function (err) {
                poolDevices = [];
                poolFetched = true;
                poolFetchError = 'Could not reach device pool service.';
            });
    }

    function createDevice() {
        if (addDeviceStatus === 'saving') return;
        var name = addDeviceForm.name.trim();
        var profileName = addDeviceForm.profileName;
        var profileId = deviceProfiles[profileName];

        if (!name || !profileId) {
            addDeviceStatus = 'error';
            addDeviceError = 'Please fill in device name and select a profile.';
            render();
            return;
        }

        addDeviceStatus = 'saving';
        addDeviceError = '';
        render();

        // Determine customerId from site entity
        var customerId = null;
        if (siteEntity && siteEntity.customerId && siteEntity.customerId.id &&
            siteEntity.customerId.id !== '13814000-1dd2-11b2-8080-808080808080') {
            customerId = siteEntity.customerId.id;
        }

        var body = {
            name: name,
            type: 'default',
            label: name,
            deviceProfileId: { id: profileId, entityType: 'DEVICE_PROFILE' }
        };
        if (customerId) {
            body.customerId = { id: customerId, entityType: 'CUSTOMER' };
        }

        var newDeviceId = null;

        apiPost('/device', body)
        .then(function (dev) {
            newDeviceId = dev.id.id;
            // Create relation: site Contains device
            var relation = {
                from: { id: siteId, entityType: 'ASSET' },
                to: { id: newDeviceId, entityType: 'DEVICE' },
                type: 'Contains',
                typeGroup: 'COMMON'
            };
            return apiPost('/relation', relation);
        })
        .then(function () {
            // Copy site CO2/rate attrs to device
            var devAttrs = {};
            if (siteAttrs.co2_per_kwh) devAttrs.co2_per_kwh = parseFloat(siteAttrs.co2_per_kwh) || 0;
            if (siteAttrs.energy_rate) devAttrs.energy_rate = parseFloat(siteAttrs.energy_rate) || 0;
            if (siteAttrs.currency_symbol) devAttrs.currency_symbol = siteAttrs.currency_symbol;
            if (Object.keys(devAttrs).length > 0) {
                return apiPost('/plugins/telemetry/DEVICE/' + newDeviceId + '/attributes/SERVER_SCOPE', devAttrs);
            }
        })
        .then(function () {
            // Provision attributes (SHARED_SCOPE — bridge receives via MQTT)
            return apiPost('/plugins/telemetry/DEVICE/' + newDeviceId + '/attributes/SHARED_SCOPE', {
                provision_tier: siteAttrs.dashboard_tier || 'standard',
                provision_lat: parseFloat(siteAttrs.latitude) || 0,
                provision_lon: parseFloat(siteAttrs.longitude) || 0,
                provision_tz: parseFloat(siteAttrs.tzOffset) || 0,
                provision_status: 'pending'
            });
        })
        .then(function () {
            addDeviceStatus = 'done';
            addDeviceForm = { name: '', profileId: '', profileName: '', poolDeviceId: '', poolDeviceName: '' };
            // Refresh devices list
            return fetchDevices();
        })
        .then(function () {
            render();
        })
        .catch(function (err) {
            addDeviceStatus = 'error';
            var errMsg = 'Failed to create device.';
            if (err && err.error && err.error.message) errMsg = err.error.message;
            else if (err && err.message) errMsg = err.message;
            addDeviceError = errMsg;
            render();
        });
    }

    function assignPoolDevice() {
        if (addDeviceStatus === 'saving') return;
        var poolDeviceId = addDeviceForm.poolDeviceId;
        var profileName = addDeviceForm.profileName;
        var profileId = deviceProfiles[profileName];

        if (!poolDeviceId || !profileId) {
            addDeviceStatus = 'error';
            addDeviceError = 'Please select a pool device and a profile.';
            render();
            return;
        }

        addDeviceStatus = 'saving';
        addDeviceError = '';
        render();

        var customerId = null;
        if (siteEntity && siteEntity.customerId && siteEntity.customerId.id &&
            siteEntity.customerId.id !== '13814000-1dd2-11b2-8080-808080808080') {
            customerId = siteEntity.customerId.id;
        }

        if (!customerId) {
            addDeviceStatus = 'error';
            addDeviceError = 'Site has no customer assigned. Cannot assign device.';
            render();
            return;
        }

        var assignedDeviceId = null;

        // Step 1: Assign device to customer
        apiPost('/customer/' + customerId + '/device/' + poolDeviceId, {})
        .then(function (dev) {
            assignedDeviceId = dev.id.id;
            // Step 2: Update device profile + set label
            dev.deviceProfileId = { id: profileId, entityType: 'DEVICE_PROFILE' };
            // Auto-generate label: Site - ##
            var siteName = siteEntity ? siteEntity.name : '';
            var deviceNum = devices.length + 1;
            var numStr = deviceNum < 10 ? '0' + deviceNum : '' + deviceNum;
            dev.label = siteName ? (siteName + ' - ' + numStr) : numStr;
            return apiPost('/device', dev);
        })
        .then(function () {
            // Step 3: Create relation: site Contains device
            return apiPost('/relation', {
                from: { id: siteId, entityType: 'ASSET' },
                to: { id: assignedDeviceId, entityType: 'DEVICE' },
                type: 'Contains',
                typeGroup: 'COMMON'
            });
        })
        .then(function () {
            // Step 4: Copy site CO2/rate attrs to device
            var devAttrs = {};
            if (siteAttrs.co2_per_kwh) devAttrs.co2_per_kwh = parseFloat(siteAttrs.co2_per_kwh) || 0;
            if (siteAttrs.energy_rate) devAttrs.energy_rate = parseFloat(siteAttrs.energy_rate) || 0;
            if (siteAttrs.currency_symbol) devAttrs.currency_symbol = siteAttrs.currency_symbol;
            if (Object.keys(devAttrs).length > 0) {
                return apiPost('/plugins/telemetry/DEVICE/' + assignedDeviceId + '/attributes/SERVER_SCOPE', devAttrs);
            }
        })
        .then(function () {
            // Provision attributes (SHARED_SCOPE — bridge receives via MQTT)
            return apiPost('/plugins/telemetry/DEVICE/' + assignedDeviceId + '/attributes/SHARED_SCOPE', {
                provision_tier: siteAttrs.dashboard_tier || 'standard',
                provision_lat: parseFloat(siteAttrs.latitude) || 0,
                provision_lon: parseFloat(siteAttrs.longitude) || 0,
                provision_tz: parseFloat(siteAttrs.tzOffset) || 0,
                provision_status: 'pending'
            });
        })
        .then(function () {
            addDeviceStatus = 'done';
            addDeviceForm = { name: '', profileId: '', profileName: '', poolDeviceId: '', poolDeviceName: '' };
            // Remove from local pool cache + re-fetch
            for (var ri = poolDevices.length - 1; ri >= 0; ri--) {
                if (poolDevices[ri].id === poolDeviceId) {
                    poolDevices.splice(ri, 1);
                    break;
                }
            }
            poolFetched = false;
            fetchPool().then(function () { return fetchDevices(); }).then(function () { render(); });
        })
        .catch(function (err) {
            addDeviceStatus = 'error';
            var errMsg = 'Failed to assign device.';
            if (err && err.error && err.error.message) errMsg = err.error.message;
            else if (err && err.message) errMsg = err.message;
            addDeviceError = errMsg;
            render();
        });
    }

    // ═══ EVENT BINDING ═════════════════════════════════════════

    function bindEvents() {
        // Tab clicks
        container.querySelectorAll('[data-tab]').forEach(function (btn) {
            btn.addEventListener('click', function () {
                var newTab = btn.getAttribute('data-tab');
                if (newTab !== activeTab) {
                    activeTab = newTab;
                    // Clear add-device status when switching tabs
                    if (newTab !== 'add-device') {
                        addDeviceStatus = '';
                        addDeviceError = '';
                    }
                    // Auto-select profile based on tier when entering add-device tab
                    if (newTab === 'add-device' && !addDeviceForm.profileName) {
                        var defProf = getDefaultTierProfile();
                        if (defProf) {
                            addDeviceForm.profileName = defProf;
                            addDeviceForm.profileId = deviceProfiles[defProf] || '';
                        }
                    }
                    render();
                }
            });
        });

        // Back button
        container.querySelectorAll('[data-action="go-back"]').forEach(function (btn) {
            btn.addEventListener('click', function () {
                try {
                    var sc = self.ctx.stateController;
                    if (sc && sc.resetState) {
                        sc.resetState();
                        return;
                    }
                } catch (e) {}
                try {
                    window.history.back();
                } catch (e) {}
            });
        });

        // Device row clicks
        container.querySelectorAll('[data-action="open-device"]').forEach(function (card) {
            card.addEventListener('click', function () {
                var devId = card.getAttribute('data-device-id');
                var devName = card.getAttribute('data-device-name');
                try {
                    var sc = self.ctx.stateController;
                    sc.resetState();
                    sc.openState('device', {
                        entityId: { id: devId, entityType: 'DEVICE' },
                        entityName: devName
                    });
                } catch (e) {
                    console.error('[SM] Failed to navigate to device:', e);
                }
            });
        });

        // Edit toggle
        container.querySelectorAll('[data-action="toggle-edit"]').forEach(function (btn) {
            btn.addEventListener('click', function () {
                if (isEditing) {
                    // Save changes
                    var inputs = container.querySelectorAll('[data-attr]');
                    var attrs = {};
                    inputs.forEach(function (inp) {
                        var key = inp.getAttribute('data-attr');
                        attrs[key] = inp.value;
                    });
                    isSaving = true;
                    render();

                    // Save name change to asset entity if changed
                    var nameAttr = attrs.name || '';
                    delete attrs.name; // name is on the entity, not a server attribute
                    var saveEntityPromise = Promise.resolve();
                    if (siteEntity && nameAttr && nameAttr !== siteEntity.name) {
                        siteEntity.name = nameAttr;
                        saveEntityPromise = apiPost('/asset', siteEntity).then(function (updated) {
                            siteEntity = updated;
                        }).catch(function () {});
                    }

                    Promise.all([
                        saveSiteAttributes(attrs),
                        saveEntityPromise
                    ]).then(function () {
                        Object.keys(attrs).forEach(function (k) { siteAttrs[k] = attrs[k]; });
                        isEditing = false;
                        isSaving = false;
                        render();
                    }).catch(function () {
                        isSaving = false;
                        render();
                    });
                } else {
                    isEditing = true;
                    render();
                }
            });
        });

        // Delete site actions
        container.querySelectorAll('[data-action="delete-site"]').forEach(function (btn) {
            btn.addEventListener('click', function () {
                startDeleteSite();
            });
        });

        container.querySelectorAll('[data-action="confirm-delete-site"]').forEach(function (btn) {
            btn.addEventListener('click', function () {
                executeDeleteSite();
            });
        });

        container.querySelectorAll('[data-action="cancel-delete-site"]').forEach(function (btn) {
            btn.addEventListener('click', function () {
                deleteState = 'idle';
                render();
            });
        });

        // Address autocomplete events
        bindAddressEvents();

        // Add Device form events
        bindAddDeviceEvents();
    }

    function bindAddressEvents() {
        // Search input: debounced keyup
        var searchInput = container.querySelector('[data-action="addr-search-input"]');
        if (searchInput) {
            searchInput.addEventListener('keyup', function (e) {
                var val = searchInput.value.trim();
                if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === 'Escape') {
                    handleDropdownKeyboard(e);
                    return;
                }
                if (addressDebounceTimer) clearTimeout(addressDebounceTimer);
                _addrDebounceTimer = null;
                if (val.length < 4) {
                    addressSearchResults = [];
                    addressSelected = null;
                    var dd = container.querySelector('.sm-addr-dropdown');
                    if (dd) dd.remove();
                    return;
                }
                addressDebounceTimer = setTimeout(function () {
                    fetchAddressSuggestions(val);
                }, 350);
                _addrDebounceTimer = addressDebounceTimer;
            });
            setTimeout(function () { searchInput.focus({ preventScroll: true }); }, 50);
        }

        // Dropdown item clicks
        container.querySelectorAll('[data-action="addr-select"]').forEach(function (opt) {
            opt.addEventListener('click', function () {
                var idx = parseInt(opt.getAttribute('data-addr-idx'));
                if (addressSearchResults[idx]) {
                    addressSelected = addressSearchResults[idx];
                    addressSearchResults = [];
                    render();
                }
            });
        });

        // Toggle search button
        container.querySelectorAll('[data-action="addr-toggle-search"]').forEach(function (btn) {
            btn.addEventListener('click', function () {
                if (addressSearchExpanded) {
                    resetAddressState();
                } else {
                    addressSearchExpanded = true;
                }
                render();
            });
        });

        // Clear
        container.querySelectorAll('[data-action="addr-clear"]').forEach(function (btn) {
            btn.addEventListener('click', function () {
                addressSelected = null;
                addressSearchResults = [];
                render();
            });
        });

        // Confirm
        container.querySelectorAll('[data-action="addr-confirm"]').forEach(function (btn) {
            btn.addEventListener('click', function () {
                confirmAddress();
            });
        });

        // Outside click closes dropdown
        if (_addrOutsideClickFn) {
            document.removeEventListener('click', _addrOutsideClickFn);
        }
        _addrOutsideClickFn = function (e) {
            if (!container.querySelector('.sm-addr-dropdown')) return;
            var wrap = container.querySelector('.sm-addr-search-wrap');
            if (wrap && !wrap.contains(e.target)) {
                addressSearchResults = [];
                var dd = container.querySelector('.sm-addr-dropdown');
                if (dd) dd.remove();
            }
        };
        document.addEventListener('click', _addrOutsideClickFn);
    }

    function handleDropdownKeyboard(e) {
        var dd = container.querySelector('.sm-addr-dropdown');
        if (!dd) {
            if (e.key === 'Escape') {
                var searchInput = container.querySelector('[data-action="addr-search-input"]');
                if (searchInput) searchInput.blur();
            }
            return;
        }
        var items = dd.querySelectorAll('.sm-addr-option');
        if (items.length === 0) return;
        var activeIdx = -1;
        items.forEach(function (it, i) {
            if (it.classList.contains('sm-addr-option-active')) activeIdx = i;
        });

        if (e.key === 'ArrowDown') {
            e.preventDefault();
            var next = activeIdx < items.length - 1 ? activeIdx + 1 : 0;
            items.forEach(function (it) { it.classList.remove('sm-addr-option-active'); });
            items[next].classList.add('sm-addr-option-active');
            items[next].scrollIntoView({ block: 'nearest' });
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            var prev = activeIdx > 0 ? activeIdx - 1 : items.length - 1;
            items.forEach(function (it) { it.classList.remove('sm-addr-option-active'); });
            items[prev].classList.add('sm-addr-option-active');
            items[prev].scrollIntoView({ block: 'nearest' });
        } else if (e.key === 'Enter') {
            e.preventDefault();
            if (activeIdx >= 0 && addressSearchResults[activeIdx]) {
                addressSelected = addressSearchResults[activeIdx];
                addressSearchResults = [];
                render();
            }
        } else if (e.key === 'Escape') {
            addressSearchResults = [];
            dd.remove();
        }
    }

    function bindAddDeviceEvents() {
        // Device name input
        var nameInput = container.querySelector('[data-add-field="name"]');
        if (nameInput) {
            nameInput.addEventListener('input', function () {
                addDeviceForm.name = nameInput.value;
            });
        }

        // Profile select
        var profileSelect = container.querySelector('[data-add-field="profile"]');
        if (profileSelect) {
            profileSelect.addEventListener('change', function () {
                addDeviceForm.profileName = profileSelect.value;
                addDeviceForm.profileId = deviceProfiles[profileSelect.value] || '';
                render();
            });
        }

        // Create/Assign device button
        container.querySelectorAll('[data-action="create-device"]').forEach(function (btn) {
            btn.addEventListener('click', function () {
                if (addDevicePoolMode) {
                    assignPoolDevice();
                } else {
                    createDevice();
                }
            });
        });

        // Pool device select
        var poolSelect = container.querySelector('[data-add-field="poolDevice"]');
        if (poolSelect) {
            poolSelect.addEventListener('change', function () {
                addDeviceForm.poolDeviceId = poolSelect.value;
                // Find pool device name
                for (var pi = 0; pi < poolDevices.length; pi++) {
                    if (poolDevices[pi].id === poolSelect.value) {
                        addDeviceForm.poolDeviceName = poolDevices[pi].name;
                        break;
                    }
                }
                render();
            });
        }

        // Toggle pool mode
        container.querySelectorAll('[data-action="toggle-pool-mode"]').forEach(function (btn) {
            btn.addEventListener('click', function (e) {
                e.preventDefault();
                addDevicePoolMode = !addDevicePoolMode;
                addDeviceForm = { name: '', profileId: '', profileName: '', poolDeviceId: '', poolDeviceName: '' };
                addDeviceStatus = '';
                addDeviceError = '';
                if (addDevicePoolMode && !poolFetched) {
                    fetchPool().then(function () { render(); });
                } else {
                    render();
                }
            });
        });
    }

    // ── Loading & Error States ─────────────────────────────────

    function showLoading() {
        container.innerHTML = '<div class="sm-loading"><div class="sm-spinner"></div><div class="sm-loading-text">Loading site data...</div></div>';
    }

    function showError(msg) {
        container.innerHTML = '<div class="sm-error">' +
            '<div class="sm-error-icon">&#9888;&#65039;</div>' +
            '<div class="sm-error-text">' + esc(msg) + '</div>' +
        '</div>';
    }

    // ═══ INIT ══════════════════════════════════════════════════

    siteId = resolveSiteId();
    console.log('[SM] siteId:', siteId);

    if (!siteId) {
        showError('No site selected. Navigate from the customer view or set siteAssetId in widget settings.');
        return;
    }

    showLoading();

    Promise.all([
        apiGet('/asset/' + siteId),
        apiGet('/plugins/telemetry/ASSET/' + siteId + '/values/attributes/SERVER_SCOPE'),
        fetchDevices(),
        fetchBreadcrumb(),
        fetchDeviceProfiles(),
        fetchPool()
    ]).then(function (results) {
        siteEntity = results[0];
        siteAttrs = {};
        if (results[1] && Array.isArray(results[1])) {
            results[1].forEach(function (a) { siteAttrs[a.key] = a.value; });
        }
        // Fetch customer name and prepend to breadcrumb
        if (siteEntity && siteEntity.customerId && siteEntity.customerId.id &&
            siteEntity.customerId.id !== '13814000-1dd2-11b2-8080-808080808080') {
            return apiGet('/customer/' + siteEntity.customerId.id).then(function (c) {
                if (c && c.title) {
                    parentCustomerName = c.title;
                    parentBreadcrumb = parentBreadcrumb
                        ? (c.title + ' > ' + parentBreadcrumb)
                        : c.title;
                }
            }).catch(function () {});
        }
    }).then(function () {
        render();
    }).catch(function (err) {
        console.error('[SM] Init error:', err);
        showError('Failed to load site data. Check console for details.');
    });
};

// ═══ LIFECYCLE ════════════════════════════════════════════════

self.onDataUpdated = function () {};

self.onResize = function () {};

self.onDestroy = function () {
    if (_addrDebounceTimer) {
        clearTimeout(_addrDebounceTimer);
        _addrDebounceTimer = null;
    }
    if (_addrOutsideClickFn) {
        document.removeEventListener('click', _addrOutsideClickFn);
        _addrOutsideClickFn = null;
    }
};
