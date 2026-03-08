// =====================================================================
// SignConnect — Customer Manager Widget (controller.js)
// =====================================================================
// 4-tab customer management widget:
//   Tab 1: Details — view/edit customer entity fields
//   Tab 2: Users — list, add, delete customer users
//   Tab 3: Hierarchy — estate > region > site tree view
//   Tab 4: Add Site — create new sites with assets/devices
//
// Receives CUSTOMER ID from dashboard state params.
// =====================================================================

var _cmAddrDebounceTimer = null;

self.onInit = function () {
    'use strict';

    var $root = self.ctx.$container[0];
    var container = $root.querySelector('.cm-root');
    if (!container) {
        $root.innerHTML = '<div class="cm-root"></div>';
        container = $root.querySelector('.cm-root');
    }
    var http = self.ctx.http;
    var settings = self.ctx.settings || {};

    // ── State Variables ─────────────────────────────────────────

    var customerId = null;
    var customerEntity = null;
    var customerAttrs = {};
    var customerUsers = [];
    var activeTab = 'details';
    var isEditing = false;
    var isSaving = false;

    // Hierarchy tab
    var hierarchy = { estates: [], regions: [], sites: [] };
    var hierarchyTree = [];
    var hierarchyLoaded = false;
    var expandedNodes = {};

    // Users tab
    var addUserForm = { email: '', firstName: '', lastName: '' };
    var addUserError = '';
    var addUserSaving = false;
    var deleteUserId = null;

    // Delete Customer state
    var deleteCustomerState = 'idle';
    var deleteCounts = {};
    var deleteLog = [];
    var deleteError = '';

    // Add Site tab
    var addSiteForm = {
        estate: '', estateNew: '',
        region: '', regionNew: '',
        siteName: '', tier: 'standard',
        address: '', lat: '', lon: '',
        co2: '', rate: '',
        currency: '\u00a3', currencyCode: 'GBP',
        countryCode: ''
    };
    var existingEstates = [];
    var existingRegions = [];
    var addressResults = [];
    var addressSelected = null;
    var addressFetching = false;
    var addrDebounceTimer = null;
    var addSiteStatus = '';
    var addSiteError = '';
    var addSiteLog = [];

    // ── CO2 Factors by Country ──────────────────────────────────

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

    // ── Entity Resolution ───────────────────────────────────────

    function resolveCustomerId() {
        try {
            var stateParams = self.ctx.stateController.getStateParams();
            if (stateParams && stateParams.entityId && stateParams.entityId.id) {
                return stateParams.entityId.id;
            }
        } catch (e) { /* stateController unavailable */ }
        try {
            var ds = self.ctx.datasources;
            if (ds && ds.length > 0 && ds[0].entity) {
                var eid = ds[0].entity.id;
                return (typeof eid === 'object' && eid !== null) ? eid.id : eid;
            }
        } catch (e) { /* datasource unavailable */ }
        return (settings && settings.customerId) || null;
    }

    // ── API Helpers ─────────────────────────────────────────────

    function apiGet(path) {
        var obs = http.get('/api' + path);
        if (obs && typeof obs.toPromise === 'function') return obs.toPromise();
        return new Promise(function (resolve, reject) {
            obs.subscribe(function (d) { resolve(d); }, function (e) { reject(e); });
        });
    }

    function apiPost(path, body) {
        var obs = http.post('/api' + path, body);
        if (obs && typeof obs.toPromise === 'function') return obs.toPromise();
        return new Promise(function (resolve, reject) {
            obs.subscribe(function (d) { resolve(d); }, function (e) { reject(e); });
        });
    }

    function apiDelete(path) {
        var obs = http.delete('/api' + path);
        if (obs && typeof obs.toPromise === 'function') return obs.toPromise();
        return new Promise(function (resolve, reject) {
            obs.subscribe(function (d) { resolve(d); }, function (e) { reject(e); });
        });
    }

    function fetchExternal(url, timeoutMs) {
        var ctrl = new AbortController();
        var timer = setTimeout(function () { ctrl.abort(); }, timeoutMs || 8000);
        return fetch(url, { headers: { 'Accept': 'application/json' }, signal: ctrl.signal })
            .then(function (resp) { clearTimeout(timer); if (!resp.ok) throw new Error('HTTP ' + resp.status); return resp.json(); })
            .catch(function (err) { clearTimeout(timer); throw err; });
    }

    // ── Utilities ───────────────────────────────────────────────

    function esc(str) {
        if (!str) return '';
        return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function formatDate(ts) {
        if (!ts) return '';
        var d = new Date(ts);
        return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    }

    function validateEmail(email) {
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    }

    // ── Navigation ──────────────────────────────────────────────

    function openState(stateId, params) {
        try {
            var sc = self.ctx.stateController;
            if (stateId === 'default') {
                sc.resetState();
            } else {
                sc.resetState();
                sc.openState(stateId, params);
            }
        } catch (e) {
            console.error('[CM] Navigate failed:', e);
        }
    }

    // ═══════════════════════════════════════════════════════════
    // RENDER
    // ═══════════════════════════════════════════════════════════

    function render() {
        var html = '';
        html += renderHeader();
        html += renderTabs();
        if (activeTab === 'details') html += renderDetailsTab();
        else if (activeTab === 'users') html += renderUsersTab();
        else if (activeTab === 'hierarchy') html += renderHierarchyTab();
        else if (activeTab === 'add-site') html += renderAddSiteTab();
        container.innerHTML = html;
        bindEvents();
    }

    // ── Header ──────────────────────────────────────────────────

    function renderHeader() {
        var name = (customerEntity && customerEntity.title) ? customerEntity.title : 'Customer';
        var html = '<div class="cm-header">';
        html += '<div class="cm-breadcrumb">';
        html += '<a data-action="go-home">Home</a>';
        html += '<span class="cm-sep">/</span>';
        html += '<span>' + esc(name) + '</span>';
        html += '</div>';
        html += '<h1 class="cm-header-title">' + esc(name) + '</h1>';
        html += '</div>';
        return html;
    }

    // ── Tabs ────────────────────────────────────────────────────

    function renderTabs() {
        function tab(id, label) {
            return '<button class="cm-tab' + (activeTab === id ? ' active' : '') + '" data-tab="' + id + '">' + label + '</button>';
        }
        return '<div class="cm-tabs">' +
            tab('details', 'Details') +
            tab('users', 'Users (' + customerUsers.length + ')') +
            tab('hierarchy', 'Hierarchy') +
            tab('add-site', 'Add Site') +
            '</div>';
    }

    // ═══════════════════════════════════════════════════════════
    // TAB 1: DETAILS
    // ═══════════════════════════════════════════════════════════

    function renderDetailsTab() {
        var c = customerEntity || {};
        var html = '<div class="cm-card">';
        html += '<div style="display:flex;align-items:center;justify-content:space-between">';
        html += '<h2 class="cm-card-title">Customer Details</h2>';
        if (!isEditing) {
            html += '<div style="display:flex;gap:8px">';
            html += '<button class="cm-btn cm-btn-outline cm-btn-sm" data-action="edit-details">Edit</button>';
            html += '<button class="cm-btn cm-btn-danger cm-btn-sm" data-action="delete-customer">Delete</button>';
            html += '</div>';
        }
        html += '</div>';

        // Delete customer dialog overlay
        if (deleteCustomerState !== 'idle') {
            html += renderDeleteCustomerDialog();
        }

        if (isEditing) {
            html += '<div class="cm-form-row">';
            html += '<div class="cm-form-group"><label>Name</label><input class="cm-input" data-field="title" value="' + esc(c.title || '') + '"></div>';
            html += '<div class="cm-form-group"><label>Email</label><input class="cm-input" data-field="email" value="' + esc(c.email || '') + '"></div>';
            html += '</div>';
            html += '<div class="cm-form-row">';
            html += '<div class="cm-form-group"><label>Phone</label><input class="cm-input" data-field="phone" value="' + esc(c.phone || '') + '"></div>';
            html += '<div class="cm-form-group"><label>Country</label><input class="cm-input" data-field="country" value="' + esc(c.country || '') + '"></div>';
            html += '</div>';
            html += '<div class="cm-form-row">';
            html += '<div class="cm-form-group"><label>City</label><input class="cm-input" data-field="city" value="' + esc(c.city || '') + '"></div>';
            html += '<div class="cm-form-group"><label>State / Province</label><input class="cm-input" data-field="state" value="' + esc(c.state || '') + '"></div>';
            html += '</div>';
            html += '<div class="cm-form-group"><label>Address</label><input class="cm-input" data-field="address" value="' + esc(c.address || '') + '"></div>';
            html += '<div class="cm-form-group"><label>Address 2</label><input class="cm-input" data-field="address2" value="' + esc(c.address2 || '') + '"></div>';
            html += '<div class="cm-form-row">';
            html += '<div class="cm-form-group"><label>Zip / Postal Code</label><input class="cm-input" data-field="zip" value="' + esc(c.zip || '') + '"></div>';
            html += '<div class="cm-form-group"></div>';
            html += '</div>';
            html += '<div class="cm-actions">';
            html += '<button class="cm-btn cm-btn-primary" data-action="save-details"' + (isSaving ? ' disabled' : '') + '>' + (isSaving ? 'Saving...' : 'Save') + '</button>';
            html += '<button class="cm-btn cm-btn-secondary" data-action="cancel-edit">Cancel</button>';
            html += '</div>';
        } else {
            html += '<div class="cm-form-row">';
            html += '<div class="cm-form-group"><label>Name</label><div class="cm-field-value">' + esc(c.title || '-') + '</div></div>';
            html += '<div class="cm-form-group"><label>Email</label><div class="cm-field-value">' + esc(c.email || '-') + '</div></div>';
            html += '</div>';
            html += '<div class="cm-form-row">';
            html += '<div class="cm-form-group"><label>Phone</label><div class="cm-field-value">' + esc(c.phone || '-') + '</div></div>';
            html += '<div class="cm-form-group"><label>Country</label><div class="cm-field-value">' + esc(c.country || '-') + '</div></div>';
            html += '</div>';
            html += '<div class="cm-form-row">';
            html += '<div class="cm-form-group"><label>City</label><div class="cm-field-value">' + esc(c.city || '-') + '</div></div>';
            html += '<div class="cm-form-group"><label>State / Province</label><div class="cm-field-value">' + esc(c.state || '-') + '</div></div>';
            html += '</div>';
            html += '<div class="cm-form-group"><label>Address</label><div class="cm-field-value">' + esc(c.address || '-') + '</div></div>';
            if (c.address2) {
                html += '<div class="cm-form-group"><label>Address 2</label><div class="cm-field-value">' + esc(c.address2) + '</div></div>';
            }
            if (c.zip) {
                html += '<div class="cm-form-group"><label>Zip / Postal Code</label><div class="cm-field-value">' + esc(c.zip) + '</div></div>';
            }
        }
        html += '</div>';

        // Server attributes card
        var attrKeys = Object.keys(customerAttrs);
        if (attrKeys.length > 0) {
            html += '<div class="cm-card">';
            html += '<h2 class="cm-card-title">Server Attributes</h2>';
            for (var i = 0; i < attrKeys.length; i++) {
                var k = attrKeys[i];
                html += '<div class="cm-form-group"><label>' + esc(k) + '</label><div class="cm-field-value">' + esc(String(customerAttrs[k])) + '</div></div>';
            }
            html += '</div>';
        }

        return html;
    }

    // ═══════════════════════════════════════════════════════════
    // TAB 2: USERS
    // ═══════════════════════════════════════════════════════════

    function renderUsersTab() {
        var html = '';

        // Add user form
        html += '<div class="cm-card">';
        html += '<h2 class="cm-card-title">Add User</h2>';
        html += '<div class="cm-form-row-3">';
        html += '<div class="cm-form-group"><label>Email</label><input class="cm-input" data-user-field="email" value="' + esc(addUserForm.email) + '" placeholder="user@example.com"></div>';
        html += '<div class="cm-form-group"><label>First Name</label><input class="cm-input" data-user-field="firstName" value="' + esc(addUserForm.firstName) + '" placeholder="First name"></div>';
        html += '<div class="cm-form-group"><label>Last Name</label><input class="cm-input" data-user-field="lastName" value="' + esc(addUserForm.lastName) + '" placeholder="Last name"></div>';
        html += '</div>';
        if (addUserError) {
            html += '<div class="cm-inline-error">' + esc(addUserError) + '</div>';
        }
        html += '<div class="cm-actions">';
        html += '<button class="cm-btn cm-btn-primary cm-btn-sm" data-action="add-user"' + (addUserSaving ? ' disabled' : '') + '>' + (addUserSaving ? 'Adding...' : 'Add User') + '</button>';
        html += '</div>';
        html += '</div>';

        // Users table
        if (customerUsers.length === 0) {
            html += '<div class="cm-empty">No users found for this customer.</div>';
        } else {
            html += '<div class="cm-table-wrap">';
            html += '<table class="cm-table"><thead><tr>';
            html += '<th>Email</th><th>First Name</th><th>Last Name</th><th>Created</th><th style="width:80px"></th>';
            html += '</tr></thead><tbody>';
            for (var i = 0; i < customerUsers.length; i++) {
                var u = customerUsers[i];
                var uid = u.id ? (u.id.id || u.id) : '';
                html += '<tr>';
                html += '<td>' + esc(u.email || '') + '</td>';
                html += '<td>' + esc(u.firstName || '') + '</td>';
                html += '<td>' + esc(u.lastName || '') + '</td>';
                html += '<td>' + formatDate(u.createdTime) + '</td>';
                html += '<td class="cm-td-actions"><button class="cm-btn cm-btn-danger cm-btn-sm" data-action="delete-user" data-user-id="' + esc(uid) + '" data-user-email="' + esc(u.email || '') + '">Delete</button></td>';
                html += '</tr>';
            }
            html += '</tbody></table></div>';
        }

        // Delete confirmation dialog
        if (deleteUserId) {
            html += renderDeleteDialog();
        }

        return html;
    }

    function renderDeleteDialog() {
        var html = '<div class="cm-dialog-overlay" data-action="cancel-delete">';
        html += '<div class="cm-dialog" onclick="event.stopPropagation()">';
        html += '<h3 class="cm-dialog-title">Delete User</h3>';
        html += '<p class="cm-dialog-message">Are you sure you want to delete this user? This action cannot be undone.</p>';
        html += '<div class="cm-dialog-actions">';
        html += '<button class="cm-btn cm-btn-secondary" data-action="cancel-delete">Cancel</button>';
        html += '<button class="cm-btn cm-btn-danger" data-action="confirm-delete">Delete</button>';
        html += '</div></div></div>';
        return html;
    }

    // ═══════════════════════════════════════════════════════════
    // TAB 3: HIERARCHY
    // ═══════════════════════════════════════════════════════════

    function renderHierarchyTab() {
        if (!hierarchyLoaded) {
            return '<div class="cm-loading"><div class="cm-spinner"></div><div class="cm-loading-text">Loading hierarchy...</div></div>';
        }

        if (hierarchyTree.length === 0) {
            return '<div class="cm-empty">No estates, regions, or sites found for this customer. Use the "Add Site" tab to create your first site.</div>';
        }

        var html = '<div class="cm-card"><h2 class="cm-card-title">Site Hierarchy</h2><div class="cm-tree">';
        for (var ei = 0; ei < hierarchyTree.length; ei++) {
            var estate = hierarchyTree[ei];
            var estateKey = 'estate-' + ei;
            var estateExpanded = expandedNodes[estateKey] !== false;
            html += '<div class="cm-tree-node">';
            html += '<div class="cm-tree-estate" data-toggle="' + estateKey + '">';
            html += '<span class="cm-tree-toggle' + (estateExpanded ? ' expanded' : '') + '">\u25b6</span>';
            html += '<span class="cm-tree-icon">\ud83c\udfe2</span>';
            html += '<span class="cm-tree-label">' + esc(estate.name) + '</span>';
            html += '<span class="cm-tree-count">' + estate.regions.length + ' region' + (estate.regions.length !== 1 ? 's' : '') + '</span>';
            html += '</div>';
            html += '<div class="cm-tree-children' + (estateExpanded ? '' : ' collapsed') + '">';

            for (var ri = 0; ri < estate.regions.length; ri++) {
                var region = estate.regions[ri];
                var regionKey = 'region-' + ei + '-' + ri;
                var regionExpanded = expandedNodes[regionKey] !== false;
                html += '<div class="cm-tree-node">';
                html += '<div class="cm-tree-region" data-toggle="' + regionKey + '">';
                html += '<span class="cm-tree-toggle' + (regionExpanded ? ' expanded' : '') + '">\u25b6</span>';
                html += '<span class="cm-tree-icon">\ud83d\udccd</span>';
                html += '<span class="cm-tree-label">' + esc(region.name) + '</span>';
                html += '<span class="cm-tree-count">' + region.sites.length + ' site' + (region.sites.length !== 1 ? 's' : '') + '</span>';
                html += '</div>';
                html += '<div class="cm-tree-children' + (regionExpanded ? '' : ' collapsed') + '">';

                for (var si = 0; si < region.sites.length; si++) {
                    var site = region.sites[si];
                    html += '<div class="cm-tree-site" data-action="open-site" data-site-id="' + esc(site.id) + '" data-site-name="' + esc(site.name) + '">';
                    html += '<span class="cm-tree-icon">\ud83d\udda5</span>';
                    html += '<span class="cm-tree-label">' + esc(site.name) + '</span>';
                    html += '</div>';
                }

                html += '</div></div>';
            }

            // Sites without regions (directly under estate)
            if (estate.directSites && estate.directSites.length > 0) {
                for (var dsi = 0; dsi < estate.directSites.length; dsi++) {
                    var ds = estate.directSites[dsi];
                    html += '<div class="cm-tree-site" data-action="open-site" data-site-id="' + esc(ds.id) + '" data-site-name="' + esc(ds.name) + '">';
                    html += '<span class="cm-tree-icon">\ud83d\udda5</span>';
                    html += '<span class="cm-tree-label">' + esc(ds.name) + '</span>';
                    html += '</div>';
                }
            }

            html += '</div></div>';
        }

        // Orphan sites (not linked to any estate/region)
        if (hierarchy.orphanSites && hierarchy.orphanSites.length > 0) {
            html += '<div class="cm-tree-node">';
            html += '<div class="cm-tree-estate" style="color:#94a3b8">';
            html += '<span class="cm-tree-icon">\u2753</span>';
            html += '<span class="cm-tree-label">Unlinked Sites</span>';
            html += '<span class="cm-tree-count">' + hierarchy.orphanSites.length + '</span>';
            html += '</div>';
            for (var osi = 0; osi < hierarchy.orphanSites.length; osi++) {
                var os = hierarchy.orphanSites[osi];
                html += '<div class="cm-tree-site" data-action="open-site" data-site-id="' + esc(os.id) + '" data-site-name="' + esc(os.name) + '">';
                html += '<span class="cm-tree-icon">\ud83d\udda5</span>';
                html += '<span class="cm-tree-label">' + esc(os.name) + '</span>';
                html += '</div>';
            }
            html += '</div>';
        }

        html += '</div></div>';
        return html;
    }

    // ═══════════════════════════════════════════════════════════
    // TAB 4: ADD SITE
    // ═══════════════════════════════════════════════════════════

    function renderAddSiteTab() {
        if (addSiteStatus === 'done') {
            var html = '<div class="cm-success">';
            html += '<div style="font-size:32px;margin-bottom:12px">\u2705</div>';
            html += '<div style="font-size:18px;font-weight:700">Site Created Successfully</div>';
            html += '<div style="margin-top:8px;color:#166534">The site and all related entities have been created.</div>';
            html += '<div class="cm-actions" style="justify-content:center;margin-top:16px">';
            html += '<button class="cm-btn cm-btn-primary" data-action="add-another-site">Add Another Site</button>';
            html += '<button class="cm-btn cm-btn-secondary" data-action="go-hierarchy">View Hierarchy</button>';
            html += '</div></div>';
            return html;
        }

        var html = '<div class="cm-card">';
        html += '<h2 class="cm-card-title">Add New Site</h2>';

        // Estate selection
        html += '<div class="cm-form-row">';
        html += '<div class="cm-form-group"><label>Estate</label>';
        html += '<select class="cm-select" data-site-field="estate">';
        html += '<option value="">Select estate...</option>';
        for (var i = 0; i < existingEstates.length; i++) {
            html += '<option value="' + esc(existingEstates[i]) + '"' + (addSiteForm.estate === existingEstates[i] ? ' selected' : '') + '>' + esc(existingEstates[i]) + '</option>';
        }
        html += '<option value="__new__"' + (addSiteForm.estate === '__new__' ? ' selected' : '') + '>+ New estate</option>';
        html += '</select></div>';
        if (addSiteForm.estate === '__new__') {
            html += '<div class="cm-form-group"><label>New Estate Name</label><input class="cm-input" data-site-field="estateNew" value="' + esc(addSiteForm.estateNew) + '" placeholder="Estate name"></div>';
        } else {
            html += '<div class="cm-form-group"></div>';
        }
        html += '</div>';

        // Region selection
        html += '<div class="cm-form-row">';
        html += '<div class="cm-form-group"><label>Region</label>';
        html += '<select class="cm-select" data-site-field="region">';
        html += '<option value="">Select region...</option>';
        for (var ri = 0; ri < existingRegions.length; ri++) {
            html += '<option value="' + esc(existingRegions[ri]) + '"' + (addSiteForm.region === existingRegions[ri] ? ' selected' : '') + '>' + esc(existingRegions[ri]) + '</option>';
        }
        html += '<option value="__new__"' + (addSiteForm.region === '__new__' ? ' selected' : '') + '>+ New region</option>';
        html += '</select></div>';
        if (addSiteForm.region === '__new__') {
            html += '<div class="cm-form-group"><label>New Region Name</label><input class="cm-input" data-site-field="regionNew" value="' + esc(addSiteForm.regionNew) + '" placeholder="Region name"></div>';
        } else {
            html += '<div class="cm-form-group"></div>';
        }
        html += '</div>';

        // Site name + tier
        html += '<div class="cm-form-row">';
        html += '<div class="cm-form-group"><label>Site Name</label><input class="cm-input" data-site-field="siteName" value="' + esc(addSiteForm.siteName) + '" placeholder="e.g. Main Street Installation"></div>';
        html += '<div class="cm-form-group"><label>Tier</label>';
        html += '<select class="cm-select" data-site-field="tier">';
        html += '<option value="standard"' + (addSiteForm.tier === 'standard' ? ' selected' : '') + '>Standard</option>';
        html += '<option value="plus"' + (addSiteForm.tier === 'plus' ? ' selected' : '') + '>Plus</option>';
        html += '</select></div>';
        html += '</div>';

        // Address
        html += '<div class="cm-form-group cm-addr-wrap">';
        html += '<label>Address (search)</label>';
        html += '<input class="cm-input" data-site-field="address" value="' + esc(addSiteForm.address) + '" placeholder="Start typing an address...">';
        if (addressFetching) {
            html += '<div class="cm-addr-dropdown"><div class="cm-addr-fetching">Searching...</div></div>';
        } else if (addressResults.length > 0 && !addressSelected) {
            html += '<div class="cm-addr-dropdown">';
            for (var ai = 0; ai < addressResults.length; ai++) {
                html += '<div class="cm-addr-option" data-addr-idx="' + ai + '">' + esc(addressResults[ai].display_name) + '</div>';
            }
            html += '</div>';
        }
        if (addressSelected) {
            html += '<div class="cm-addr-preview">';
            html += esc(addressSelected.display_name);
            if (addSiteForm.countryCode) html += ' <strong>(' + esc(addSiteForm.countryCode) + ')</strong>';
            html += '</div>';
        }
        html += '</div>';

        // Lat/Lon/Country
        html += '<div class="cm-form-row-3">';
        html += '<div class="cm-form-group"><label>Latitude</label><input class="cm-input" data-site-field="lat" value="' + esc(addSiteForm.lat) + '" placeholder="0.000"></div>';
        html += '<div class="cm-form-group"><label>Longitude</label><input class="cm-input" data-site-field="lon" value="' + esc(addSiteForm.lon) + '" placeholder="0.000"></div>';
        html += '<div class="cm-form-group"><label>Country Code</label><input class="cm-input" data-site-field="countryCode" value="' + esc(addSiteForm.countryCode) + '" placeholder="GB"></div>';
        html += '</div>';

        // CO2 / Rate / Currency
        html += '<div class="cm-form-row-3">';
        html += '<div class="cm-form-group"><label>CO2 per kWh (kg)</label><input class="cm-input" data-site-field="co2" value="' + esc(addSiteForm.co2) + '" placeholder="0.207"></div>';
        html += '<div class="cm-form-group"><label>Energy Rate</label><input class="cm-input" data-site-field="rate" value="' + esc(addSiteForm.rate) + '" placeholder="0.30"></div>';
        html += '<div class="cm-form-group"><label>Currency</label>';
        html += '<select class="cm-select" data-site-field="currencyCode">';
        var currencies = [
            { code: 'GBP', sym: '\u00a3' }, { code: 'EUR', sym: '\u20ac' }, { code: 'USD', sym: '$' },
            { code: 'TRY', sym: '\u20ba' }, { code: 'CHF', sym: 'Fr' }, { code: 'CZK', sym: 'K\u010d' },
            { code: 'DKK', sym: 'kr' }, { code: 'NOK', sym: 'kr' }, { code: 'PLN', sym: 'z\u0142' },
            { code: 'SEK', sym: 'kr' }, { code: 'AED', sym: 'AED' }, { code: 'AUD', sym: 'A$' },
            { code: 'BRL', sym: 'R$' }, { code: 'CAD', sym: 'C$' }, { code: 'CNY', sym: '\u00a5' },
            { code: 'INR', sym: '\u20b9' }, { code: 'JPY', sym: '\u00a5' }, { code: 'KRW', sym: '\u20a9' },
            { code: 'MXN', sym: 'MX$' }, { code: 'SAR', sym: 'SAR' }, { code: 'SGD', sym: 'S$' },
            { code: 'ZAR', sym: 'R' }
        ];
        for (var ci = 0; ci < currencies.length; ci++) {
            html += '<option value="' + currencies[ci].code + '"' + (addSiteForm.currencyCode === currencies[ci].code ? ' selected' : '') + '>' + currencies[ci].code + ' (' + currencies[ci].sym + ')</option>';
        }
        html += '</select></div>';
        html += '</div>';

        // Error/Status
        if (addSiteError) {
            html += '<div class="cm-inline-error" style="margin-top:12px">' + esc(addSiteError) + '</div>';
        }

        // Progress log
        if (addSiteStatus === 'saving' || addSiteLog.length > 0) {
            html += '<div class="cm-progress-bar"><div class="cm-progress-fill' + (addSiteStatus === 'error' ? ' error' : '') + '" style="width:' + (addSiteStatus === 'saving' ? '60' : (addSiteStatus === 'error' ? '100' : '0')) + '%"></div></div>';
            for (var li = 0; li < addSiteLog.length; li++) {
                var entry = addSiteLog[li];
                html += '<div class="cm-log-entry ' + (entry.type || '') + '">' + esc(entry.msg) + '</div>';
            }
        }

        // Create button
        html += '<div class="cm-actions" style="margin-top:20px">';
        html += '<button class="cm-btn cm-btn-primary" data-action="create-site"' + (addSiteStatus === 'saving' ? ' disabled' : '') + '>' + (addSiteStatus === 'saving' ? 'Creating...' : 'Create Site') + '</button>';
        html += '</div>';

        html += '</div>';
        return html;
    }

    // ═══════════════════════════════════════════════════════════
    // EVENT BINDING
    // ═══════════════════════════════════════════════════════════

    function bindEvents() {
        // Tab clicks
        var tabs = container.querySelectorAll('.cm-tab');
        for (var i = 0; i < tabs.length; i++) {
            tabs[i].addEventListener('click', function (e) {
                var newTab = this.getAttribute('data-tab');
                if (newTab && newTab !== activeTab) {
                    activeTab = newTab;
                    if (newTab === 'hierarchy' && !hierarchyLoaded) {
                        loadHierarchy();
                    }
                    render();
                }
            });
        }

        // Action buttons
        var actions = container.querySelectorAll('[data-action]');
        for (var ai = 0; ai < actions.length; ai++) {
            actions[ai].addEventListener('click', handleAction);
        }

        // Toggle tree nodes
        var toggles = container.querySelectorAll('[data-toggle]');
        for (var ti = 0; ti < toggles.length; ti++) {
            toggles[ti].addEventListener('click', function (e) {
                var key = this.getAttribute('data-toggle');
                expandedNodes[key] = expandedNodes[key] === false ? true : false;
                render();
            });
        }

        // Details form inputs
        if (isEditing) {
            var detailInputs = container.querySelectorAll('[data-field]');
            for (var di = 0; di < detailInputs.length; di++) {
                detailInputs[di].addEventListener('input', function () {
                    var field = this.getAttribute('data-field');
                    if (customerEntity) {
                        customerEntity[field] = this.value;
                    }
                });
            }
        }

        // User form inputs
        var userInputs = container.querySelectorAll('[data-user-field]');
        for (var ui = 0; ui < userInputs.length; ui++) {
            userInputs[ui].addEventListener('input', function () {
                var field = this.getAttribute('data-user-field');
                addUserForm[field] = this.value;
            });
        }

        // Site form inputs
        var siteInputs = container.querySelectorAll('[data-site-field]');
        for (var si = 0; si < siteInputs.length; si++) {
            var el = siteInputs[si];
            var evtType = (el.tagName === 'SELECT') ? 'change' : 'input';
            el.addEventListener(evtType, handleSiteFieldChange);
        }

        // Address option clicks
        var addrOpts = container.querySelectorAll('.cm-addr-option');
        for (var aoi = 0; aoi < addrOpts.length; aoi++) {
            addrOpts[aoi].addEventListener('click', function () {
                var idx = parseInt(this.getAttribute('data-addr-idx'));
                selectAddress(idx);
            });
        }
    }

    function handleAction(e) {
        var action = this.getAttribute('data-action');

        if (action === 'go-home') {
            openState('default', {});
        } else if (action === 'edit-details') {
            isEditing = true;
            render();
        } else if (action === 'cancel-edit') {
            isEditing = false;
            // Reload to discard changes
            apiGet('/customer/' + customerId).then(function (c) {
                customerEntity = c;
                render();
            });
        } else if (action === 'save-details') {
            saveCustomerDetails();
        } else if (action === 'add-user') {
            addUser();
        } else if (action === 'delete-user') {
            deleteUserId = this.getAttribute('data-user-id');
            render();
        } else if (action === 'cancel-delete') {
            deleteUserId = null;
            render();
        } else if (action === 'confirm-delete') {
            confirmDeleteUser();
        } else if (action === 'open-site') {
            var siteId = this.getAttribute('data-site-id');
            var siteName = this.getAttribute('data-site-name');
            openState('site', {
                entityId: { id: siteId, entityType: 'ASSET' },
                entityName: siteName
            });
        } else if (action === 'create-site') {
            createSite();
        } else if (action === 'add-another-site') {
            resetAddSiteForm();
            render();
        } else if (action === 'go-hierarchy') {
            activeTab = 'hierarchy';
            hierarchyLoaded = false;
            loadHierarchy();
        } else if (action === 'delete-customer') {
            startDeleteCustomer();
        } else if (action === 'confirm-delete-customer') {
            executeDeleteCustomer();
        } else if (action === 'cancel-delete-customer') {
            deleteCustomerState = 'idle';
            deleteCounts = {};
            deleteLog = [];
            deleteError = '';
            render();
        } else if (action === 'delete-customer-home') {
            openState('default', {});
        }
    }

    function handleSiteFieldChange() {
        var field = this.getAttribute('data-site-field');
        addSiteForm[field] = this.value;

        if (field === 'estate') {
            // Update regions for selected estate
            updateRegionsForEstate();
            render();
        } else if (field === 'region') {
            render();
        } else if (field === 'address') {
            addressSelected = null;
            addressResults = [];
            debounceAddressSearch(this.value);
        } else if (field === 'countryCode') {
            applyCountryDefaults(this.value.toUpperCase());
        } else if (field === 'currencyCode') {
            var info = null;
            var keys = Object.keys(CO2_FACTORS);
            for (var i = 0; i < keys.length; i++) {
                if (CO2_FACTORS[keys[i]].currency === this.value) {
                    info = CO2_FACTORS[keys[i]];
                    break;
                }
            }
            if (info) {
                addSiteForm.currency = info.symbol;
            }
        }
    }

    // ═══════════════════════════════════════════════════════════
    // DELETE CUSTOMER (CASCADE)
    // ═══════════════════════════════════════════════════════════

    function renderDeleteCustomerDialog() {
        var html = '<div class="cm-dialog-overlay">';
        html += '<div class="cm-dialog" style="max-width:500px">';

        if (deleteCustomerState === 'counting') {
            html += '<h3 class="cm-dialog-title">Scanning Customer Data...</h3>';
            html += '<div class="cm-progress-bar"><div class="cm-progress-fill" style="width:50%"></div></div>';
            html += '<p class="cm-dialog-message">Counting devices, assets, and users...</p>';
        } else if (deleteCustomerState === 'confirm') {
            var name = customerEntity ? customerEntity.title : 'this customer';
            html += '<h3 class="cm-dialog-title">Delete ' + esc(name) + '?</h3>';
            html += '<p class="cm-dialog-message">This will permanently delete the following:</p>';
            html += '<div style="margin-bottom:16px;font-size:14px;line-height:1.8">';
            if (deleteCounts.devices > 0) html += '<div><strong>' + deleteCounts.devices + '</strong> device' + (deleteCounts.devices !== 1 ? 's' : '') + '</div>';
            if (deleteCounts.sites > 0) html += '<div><strong>' + deleteCounts.sites + '</strong> site' + (deleteCounts.sites !== 1 ? 's' : '') + '</div>';
            if (deleteCounts.regions > 0) html += '<div><strong>' + deleteCounts.regions + '</strong> region' + (deleteCounts.regions !== 1 ? 's' : '') + '</div>';
            if (deleteCounts.estates > 0) html += '<div><strong>' + deleteCounts.estates + '</strong> estate' + (deleteCounts.estates !== 1 ? 's' : '') + '</div>';
            if (deleteCounts.users > 0) html += '<div><strong>' + deleteCounts.users + '</strong> user' + (deleteCounts.users !== 1 ? 's' : '') + '</div>';
            if (deleteCounts.devices === 0 && deleteCounts.sites === 0 && deleteCounts.regions === 0 && deleteCounts.estates === 0 && deleteCounts.users === 0) {
                html += '<div>No child entities found.</div>';
            }
            html += '</div>';
            html += '<p class="cm-dialog-message" style="color:#ef4444;font-weight:600">This action cannot be undone.</p>';
            html += '<div class="cm-dialog-actions">';
            html += '<button class="cm-btn cm-btn-secondary" data-action="cancel-delete-customer">Cancel</button>';
            html += '<button class="cm-btn cm-btn-danger" data-action="confirm-delete-customer">Delete Everything</button>';
            html += '</div>';
        } else if (deleteCustomerState === 'deleting') {
            html += '<h3 class="cm-dialog-title">Deleting...</h3>';
            html += '<div class="cm-progress-bar"><div class="cm-progress-fill" style="width:' +
                    (deleteLog.length > 0 ? Math.min(95, (deleteLog.length / Math.max(1, deleteCounts.devices + deleteCounts.sites + deleteCounts.regions + deleteCounts.estates + deleteCounts.users + 1)) * 100) : 5) +
                    '%"></div></div>';
            html += '<div style="max-height:200px;overflow-y:auto;margin-top:12px">';
            deleteLog.forEach(function (entry) {
                html += '<div class="cm-log-entry ' + (entry.status || '') + '">' + esc(entry.text) + '</div>';
            });
            html += '</div>';
        } else if (deleteCustomerState === 'done') {
            html += '<h3 class="cm-dialog-title">Customer Deleted</h3>';
            html += '<div class="cm-progress-bar"><div class="cm-progress-fill done" style="width:100%"></div></div>';
            html += '<p class="cm-dialog-message">All entities have been removed.</p>';
            html += '<div style="max-height:150px;overflow-y:auto;margin-bottom:16px">';
            deleteLog.forEach(function (entry) {
                html += '<div class="cm-log-entry ' + (entry.status || '') + '">' + esc(entry.text) + '</div>';
            });
            html += '</div>';
            html += '<div class="cm-dialog-actions">';
            html += '<button class="cm-btn cm-btn-primary" data-action="delete-customer-home">Go Home</button>';
            html += '</div>';
        } else if (deleteCustomerState === 'error') {
            html += '<h3 class="cm-dialog-title">Delete Failed</h3>';
            html += '<div class="cm-progress-bar"><div class="cm-progress-fill error" style="width:100%"></div></div>';
            html += '<p class="cm-dialog-message" style="color:#ef4444">' + esc(deleteError) + '</p>';
            html += '<div style="max-height:150px;overflow-y:auto;margin-bottom:16px">';
            deleteLog.forEach(function (entry) {
                html += '<div class="cm-log-entry ' + (entry.status || '') + '">' + esc(entry.text) + '</div>';
            });
            html += '</div>';
            html += '<div class="cm-dialog-actions">';
            html += '<button class="cm-btn cm-btn-secondary" data-action="cancel-delete-customer">Close</button>';
            html += '</div>';
        }

        html += '</div></div>';
        return html;
    }

    function startDeleteCustomer() {
        deleteCustomerState = 'counting';
        deleteCounts = { devices: 0, estates: 0, regions: 0, sites: 0, users: 0, _devices: [], _assets: [], _users: [] };
        deleteLog = [];
        deleteError = '';
        render();

        Promise.all([
            apiGet('/customer/' + customerId + '/devices?pageSize=1000&page=0'),
            apiGet('/customer/' + customerId + '/assets?pageSize=1000&page=0'),
            apiGet('/customer/' + customerId + '/users?pageSize=100&page=0')
        ]).then(function (results) {
            var devData = results[0] && results[0].data ? results[0].data : [];
            var assetData = results[1] && results[1].data ? results[1].data : [];
            var userData = results[2] && results[2].data ? results[2].data : [];

            deleteCounts.devices = devData.length;
            deleteCounts._devices = devData.map(function (d) { return d.id.id; });

            deleteCounts.estates = 0;
            deleteCounts.regions = 0;
            deleteCounts.sites = 0;
            deleteCounts._assets = [];
            assetData.forEach(function (a) {
                var t = (a.type || '').toLowerCase();
                if (t === 'estate') deleteCounts.estates++;
                else if (t === 'region') deleteCounts.regions++;
                else if (t === 'site') deleteCounts.sites++;
                deleteCounts._assets.push({ id: a.id.id, type: t });
            });

            deleteCounts.users = userData.length;
            deleteCounts._users = userData.map(function (u) { return u.id.id; });

            deleteCustomerState = 'confirm';
            render();
        }).catch(function (err) {
            deleteCustomerState = 'error';
            deleteError = 'Failed to count customer entities.';
            render();
        });
    }

    function executeDeleteCustomer() {
        deleteCustomerState = 'deleting';
        deleteLog = [];
        render();

        function log(text, status) {
            deleteLog.push({ text: text, status: status || 'run' });
            render();
        }

        function deleteSequential(items, labelFn, pathFn) {
            var chain = Promise.resolve();
            items.forEach(function (item) {
                chain = chain.then(function () {
                    log(labelFn(item), 'run');
                    return apiDelete(pathFn(item)).then(function () {
                        deleteLog[deleteLog.length - 1].status = 'ok';
                        deleteLog[deleteLog.length - 1].text += ' - done';
                    }).catch(function (err) {
                        deleteLog[deleteLog.length - 1].status = 'fail';
                        deleteLog[deleteLog.length - 1].text += ' - failed';
                    });
                });
            });
            return chain;
        }

        // 1. Delete devices
        deleteSequential(
            deleteCounts._devices,
            function (id) { return 'Deleting device ' + id.substring(0, 8) + '...'; },
            function (id) { return '/device/' + id; }
        )
        // 2. Delete assets in child-first order: sites, regions, estates
        .then(function () {
            var sites = deleteCounts._assets.filter(function (a) { return a.type === 'site'; });
            return deleteSequential(sites, function (a) { return 'Deleting site ' + a.id.substring(0, 8) + '...'; }, function (a) { return '/asset/' + a.id; });
        })
        .then(function () {
            var regions = deleteCounts._assets.filter(function (a) { return a.type === 'region'; });
            return deleteSequential(regions, function (a) { return 'Deleting region ' + a.id.substring(0, 8) + '...'; }, function (a) { return '/asset/' + a.id; });
        })
        .then(function () {
            var estates = deleteCounts._assets.filter(function (a) { return a.type === 'estate'; });
            return deleteSequential(estates, function (a) { return 'Deleting estate ' + a.id.substring(0, 8) + '...'; }, function (a) { return '/asset/' + a.id; });
        })
        // 3. Delete users
        .then(function () {
            return deleteSequential(deleteCounts._users, function (id) { return 'Deleting user ' + id.substring(0, 8) + '...'; }, function (id) { return '/user/' + id; });
        })
        // 4. Delete customer
        .then(function () {
            log('Deleting customer...', 'run');
            return apiDelete('/customer/' + customerId).then(function () {
                deleteLog[deleteLog.length - 1].status = 'ok';
                deleteLog[deleteLog.length - 1].text += ' - done';
            });
        })
        .then(function () {
            deleteCustomerState = 'done';
            render();
        })
        .catch(function (err) {
            deleteCustomerState = 'error';
            deleteError = 'Deletion failed. Some entities may have been removed.';
            render();
        });
    }

    // ═══════════════════════════════════════════════════════════
    // DETAILS: SAVE
    // ═══════════════════════════════════════════════════════════

    function saveCustomerDetails() {
        if (isSaving) return;
        isSaving = true;
        render();

        // GET fresh entity for optimistic locking (version field)
        apiGet('/customer/' + customerId).then(function (fresh) {
            // Merge editable fields
            fresh.title = customerEntity.title || fresh.title;
            fresh.email = customerEntity.email || '';
            fresh.phone = customerEntity.phone || '';
            fresh.country = customerEntity.country || '';
            fresh.city = customerEntity.city || '';
            fresh.state = customerEntity.state || '';
            fresh.address = customerEntity.address || '';
            fresh.address2 = customerEntity.address2 || '';
            fresh.zip = customerEntity.zip || '';

            return apiPost('/customer', fresh);
        }).then(function (saved) {
            customerEntity = saved;
            isEditing = false;
            isSaving = false;
            render();
        }).catch(function (err) {
            console.error('[CM] Save failed:', err);
            isSaving = false;
            render();
        });
    }

    // ═══════════════════════════════════════════════════════════
    // USERS: ADD / DELETE
    // ═══════════════════════════════════════════════════════════

    function addUser() {
        addUserError = '';
        if (!addUserForm.email || !validateEmail(addUserForm.email)) {
            addUserError = 'Please enter a valid email address.';
            render();
            return;
        }
        if (!addUserForm.firstName.trim()) {
            addUserError = 'First name is required.';
            render();
            return;
        }

        addUserSaving = true;
        render();

        var body = {
            customerId: { id: customerId, entityType: 'CUSTOMER' },
            email: addUserForm.email.trim(),
            firstName: addUserForm.firstName.trim(),
            lastName: addUserForm.lastName.trim(),
            authority: 'CUSTOMER_USER'
        };

        apiPost('/user?sendActivationMail=true', body).then(function (user) {
            customerUsers.push(user);
            addUserForm = { email: '', firstName: '', lastName: '' };
            addUserSaving = false;
            addUserError = '';
            render();
        }).catch(function (err) {
            addUserSaving = false;
            var msg = 'Failed to create user.';
            try {
                if (err && err.error && err.error.message) msg = err.error.message;
                else if (err && err.message) msg = err.message;
            } catch (e) {}
            addUserError = msg;
            render();
        });
    }

    function confirmDeleteUser() {
        if (!deleteUserId) return;
        var uid = deleteUserId;

        apiDelete('/user/' + uid).then(function () {
            customerUsers = customerUsers.filter(function (u) {
                var id = u.id ? (u.id.id || u.id) : '';
                return id !== uid;
            });
            deleteUserId = null;
            render();
        }).catch(function (err) {
            console.error('[CM] Delete user failed:', err);
            deleteUserId = null;
            render();
        });
    }

    // ═══════════════════════════════════════════════════════════
    // HIERARCHY: LOAD + BUILD TREE
    // ═══════════════════════════════════════════════════════════

    function loadHierarchy() {
        hierarchyLoaded = false;
        render();

        apiGet('/customer/' + customerId + '/assets?pageSize=1000&page=0').then(function (resp) {
            var assets = (resp && resp.data) ? resp.data : (Array.isArray(resp) ? resp : []);
            var estates = [];
            var regions = [];
            var sites = [];
            var assetMap = {};

            for (var i = 0; i < assets.length; i++) {
                var a = assets[i];
                var aid = a.id ? a.id.id : '';
                var t = (a.type || '').toLowerCase();
                assetMap[aid] = { id: aid, name: a.name || a.label || 'Unknown', type: t };

                if (t === 'estate') estates.push(assetMap[aid]);
                else if (t === 'region') regions.push(assetMap[aid]);
                else if (t === 'site') sites.push(assetMap[aid]);
            }

            hierarchy = { estates: estates, regions: regions, sites: sites, orphanSites: [] };

            // Update existing estates/regions for Add Site tab
            existingEstates = estates.map(function (e) { return e.name; });
            existingRegions = regions.map(function (r) { return r.name; });

            // Build tree via relations
            return buildHierarchyTree(estates, regions, sites, assetMap);
        }).then(function (tree) {
            hierarchyTree = tree;
            hierarchyLoaded = true;
            render();
        }).catch(function (err) {
            console.error('[CM] Hierarchy load failed:', err);
            hierarchyLoaded = true;
            hierarchyTree = [];
            render();
        });
    }

    function buildHierarchyTree(estates, regions, sites, assetMap) {
        var tree = [];
        var regionToEstate = {};
        var siteToRegion = {};
        var siteToEstate = {};
        var linkedSites = {};
        var linkedRegions = {};

        // Fetch relations for each estate
        var estatePromises = estates.map(function (estate) {
            return apiGet('/relations?fromId=' + estate.id + '&fromType=ASSET&relationType=Contains').then(function (rels) {
                var estateNode = { name: estate.name, id: estate.id, regions: [], directSites: [] };
                var regionIds = [];

                for (var r = 0; r < rels.length; r++) {
                    if (rels[r].to && rels[r].to.entityType === 'ASSET') {
                        var targetId = rels[r].to.id;
                        var target = assetMap[targetId];
                        if (target) {
                            if (target.type === 'region') {
                                regionIds.push(targetId);
                                linkedRegions[targetId] = true;
                                regionToEstate[targetId] = estate.id;
                            } else if (target.type === 'site') {
                                estateNode.directSites.push(target);
                                linkedSites[targetId] = true;
                                siteToEstate[targetId] = estate.id;
                            }
                        }
                    }
                }

                // Fetch relations for each region under this estate
                var regionPromises = regionIds.map(function (regionId) {
                    var regionAsset = assetMap[regionId];
                    return apiGet('/relations?fromId=' + regionId + '&fromType=ASSET&relationType=Contains').then(function (rRels) {
                        var regionNode = { name: regionAsset.name, id: regionId, sites: [] };
                        for (var s = 0; s < rRels.length; s++) {
                            if (rRels[s].to && rRels[s].to.entityType === 'ASSET') {
                                var sTarget = assetMap[rRels[s].to.id];
                                if (sTarget && sTarget.type === 'site') {
                                    regionNode.sites.push(sTarget);
                                    linkedSites[sTarget.id] = true;
                                    siteToRegion[sTarget.id] = regionId;
                                }
                            }
                        }
                        regionNode.sites.sort(function (a, b) { return a.name.localeCompare(b.name); });
                        return regionNode;
                    });
                });

                return Promise.all(regionPromises).then(function (regionNodes) {
                    estateNode.regions = regionNodes;
                    estateNode.regions.sort(function (a, b) { return a.name.localeCompare(b.name); });
                    estateNode.directSites.sort(function (a, b) { return a.name.localeCompare(b.name); });
                    return estateNode;
                });
            });
        });

        return Promise.all(estatePromises).then(function (estateNodes) {
            tree = estateNodes;
            tree.sort(function (a, b) { return a.name.localeCompare(b.name); });

            // Find orphan sites
            var orphans = sites.filter(function (s) { return !linkedSites[s.id]; });
            hierarchy.orphanSites = orphans;

            return tree;
        });
    }

    // ═══════════════════════════════════════════════════════════
    // ADD SITE: ADDRESS AUTOCOMPLETE
    // ═══════════════════════════════════════════════════════════

    function debounceAddressSearch(query) {
        if (_cmAddrDebounceTimer) clearTimeout(_cmAddrDebounceTimer);
        if (!query || query.length < 3) {
            addressResults = [];
            addressFetching = false;
            return;
        }
        _cmAddrDebounceTimer = setTimeout(function () {
            addressFetching = true;
            render();
            fetchExternal('https://nominatim.openstreetmap.org/search?q=' + encodeURIComponent(query) + '&format=json&limit=6&addressdetails=1')
                .then(function (results) {
                    addressResults = results || [];
                    addressFetching = false;
                    render();
                })
                .catch(function () {
                    addressResults = [];
                    addressFetching = false;
                    render();
                });
        }, 400);
    }

    function selectAddress(idx) {
        if (idx < 0 || idx >= addressResults.length) return;
        var result = addressResults[idx];
        addressSelected = result;
        addressResults = [];

        addSiteForm.address = result.display_name || '';
        addSiteForm.lat = result.lat || '';
        addSiteForm.lon = result.lon || '';

        // Extract country code
        var cc = '';
        if (result.address && result.address.country_code) {
            cc = result.address.country_code.toUpperCase();
        }
        addSiteForm.countryCode = cc;
        applyCountryDefaults(cc);

        render();
    }

    function applyCountryDefaults(cc) {
        var info = CO2_FACTORS[cc];
        if (info) {
            addSiteForm.co2 = String(info.co2);
            addSiteForm.rate = String(info.rate);
            addSiteForm.currencyCode = info.currency;
            addSiteForm.currency = info.symbol;
        }
    }

    // ═══════════════════════════════════════════════════════════
    // ADD SITE: REGION UPDATES
    // ═══════════════════════════════════════════════════════════

    function updateRegionsForEstate() {
        var estateName = addSiteForm.estate;
        if (!estateName || estateName === '__new__') {
            existingRegions = [];
            return;
        }

        // Find estate in hierarchy tree and get its regions
        for (var i = 0; i < hierarchyTree.length; i++) {
            if (hierarchyTree[i].name === estateName) {
                existingRegions = hierarchyTree[i].regions.map(function (r) { return r.name; });
                return;
            }
        }
        existingRegions = [];
    }

    // ═══════════════════════════════════════════════════════════
    // ADD SITE: CREATE
    // ═══════════════════════════════════════════════════════════

    function createSite() {
        addSiteError = '';
        addSiteLog = [];

        // Validation
        var estateName = addSiteForm.estate === '__new__' ? addSiteForm.estateNew.trim() : addSiteForm.estate;
        var regionName = addSiteForm.region === '__new__' ? addSiteForm.regionNew.trim() : addSiteForm.region;

        if (!estateName) { addSiteError = 'Please select or create an estate.'; render(); return; }
        if (!regionName) { addSiteError = 'Please select or create a region.'; render(); return; }
        if (!addSiteForm.siteName.trim()) { addSiteError = 'Site name is required.'; render(); return; }

        addSiteStatus = 'saving';
        render();

        var createdIds = {};
        var steps = [];

        // Step 1: Create or find estate
        steps.push(function () {
            addSiteLog.push({ type: 'run', msg: 'Setting up estate: ' + estateName });
            render();

            if (addSiteForm.estate !== '__new__') {
                // Find existing estate ID
                for (var i = 0; i < hierarchyTree.length; i++) {
                    if (hierarchyTree[i].name === estateName) {
                        createdIds.estateId = hierarchyTree[i].id;
                        addSiteLog[addSiteLog.length - 1] = { type: 'ok', msg: 'Found estate: ' + estateName };
                        render();
                        return Promise.resolve();
                    }
                }
            }

            // Create new estate
            return apiPost('/asset', {
                name: estateName,
                type: 'estate',
                label: estateName,
                customerId: { id: customerId, entityType: 'CUSTOMER' }
            }).then(function (a) {
                createdIds.estateId = a.id.id;
                addSiteLog[addSiteLog.length - 1] = { type: 'ok', msg: 'Created estate: ' + estateName };
                render();
            });
        });

        // Step 2: Create or find region
        steps.push(function () {
            addSiteLog.push({ type: 'run', msg: 'Setting up region: ' + regionName });
            render();

            if (addSiteForm.region !== '__new__') {
                // Find existing region ID from hierarchy
                for (var i = 0; i < hierarchyTree.length; i++) {
                    for (var j = 0; j < hierarchyTree[i].regions.length; j++) {
                        if (hierarchyTree[i].regions[j].name === regionName) {
                            createdIds.regionId = hierarchyTree[i].regions[j].id;
                            addSiteLog[addSiteLog.length - 1] = { type: 'ok', msg: 'Found region: ' + regionName };
                            render();
                            return Promise.resolve();
                        }
                    }
                }
            }

            // Create new region
            return apiPost('/asset', {
                name: regionName,
                type: 'region',
                label: regionName,
                customerId: { id: customerId, entityType: 'CUSTOMER' }
            }).then(function (a) {
                createdIds.regionId = a.id.id;
                addSiteLog[addSiteLog.length - 1] = { type: 'ok', msg: 'Created region: ' + regionName };
                render();

                // Link estate -> region
                return apiPost('/relation', {
                    from: { id: createdIds.estateId, entityType: 'ASSET' },
                    to: { id: createdIds.regionId, entityType: 'ASSET' },
                    type: 'Contains',
                    typeGroup: 'COMMON'
                });
            });
        });

        // Step 3: Create site asset
        steps.push(function () {
            var siteName = addSiteForm.siteName.trim();
            addSiteLog.push({ type: 'run', msg: 'Creating site: ' + siteName });
            render();

            return apiPost('/asset', {
                name: siteName,
                type: 'site',
                label: siteName,
                customerId: { id: customerId, entityType: 'CUSTOMER' }
            }).then(function (a) {
                createdIds.siteId = a.id.id;
                addSiteLog[addSiteLog.length - 1] = { type: 'ok', msg: 'Created site: ' + siteName };
                render();

                // Link region -> site
                return apiPost('/relation', {
                    from: { id: createdIds.regionId, entityType: 'ASSET' },
                    to: { id: createdIds.siteId, entityType: 'ASSET' },
                    type: 'Contains',
                    typeGroup: 'COMMON'
                });
            });
        });

        // Step 4: Set site attributes
        steps.push(function () {
            addSiteLog.push({ type: 'run', msg: 'Setting site attributes' });
            render();

            var cc = addSiteForm.countryCode || '';
            var cInfo = CO2_FACTORS[cc] || {};
            var attrs = {
                dashboard_tier: addSiteForm.tier,
                co2_per_kwh: parseFloat(addSiteForm.co2) || cInfo.co2 || 0,
                energy_rate: parseFloat(addSiteForm.rate) || cInfo.rate || 0,
                currency_symbol: addSiteForm.currency || cInfo.symbol || '',
                latitude: parseFloat(addSiteForm.lat) || 0,
                longitude: parseFloat(addSiteForm.lon) || 0
            };
            if (cc) attrs.country_code = cc;
            if (addSiteForm.currencyCode || cInfo.currency) attrs.currency_code = addSiteForm.currencyCode || cInfo.currency;
            if (addSiteForm.address) attrs.address = addSiteForm.address;

            return apiPost('/plugins/telemetry/ASSET/' + createdIds.siteId + '/attributes/SERVER_SCOPE', attrs).then(function () {
                addSiteLog[addSiteLog.length - 1] = { type: 'ok', msg: 'Site attributes saved' };
                render();
            });
        });

        // Execute steps sequentially
        var stepIdx = 0;
        function runNext() {
            if (stepIdx >= steps.length) {
                addSiteStatus = 'done';
                addSiteLog.push({ type: 'ok', msg: 'All done!' });
                render();
                return;
            }
            var step = steps[stepIdx];
            stepIdx++;
            step().then(function () {
                runNext();
            }).catch(function (err) {
                var msg = 'Error';
                try {
                    if (err && err.error && err.error.message) msg = err.error.message;
                    else if (err && err.message) msg = err.message;
                    else msg = String(err);
                } catch (e) { msg = 'Unknown error'; }
                addSiteLog.push({ type: 'fail', msg: 'Failed: ' + msg });
                addSiteStatus = 'error';
                addSiteError = msg;
                render();
            });
        }
        runNext();
    }

    function resetAddSiteForm() {
        addSiteForm = {
            estate: '', estateNew: '',
            region: '', regionNew: '',
            siteName: '', tier: 'standard',
            address: '', lat: '', lon: '',
            co2: '', rate: '',
            currency: '\u00a3', currencyCode: 'GBP',
            countryCode: ''
        };
        addressResults = [];
        addressSelected = null;
        addressFetching = false;
        addSiteStatus = '';
        addSiteError = '';
        addSiteLog = [];
    }

    // ═══════════════════════════════════════════════════════════
    // INIT
    // ═══════════════════════════════════════════════════════════

    customerId = resolveCustomerId();
    if (!customerId) {
        container.innerHTML = '<div class="cm-error">No customer selected. Navigate here from the customer list.</div>';
        return;
    }

    // Load all initial data in parallel
    Promise.all([
        apiGet('/customer/' + customerId),
        apiGet('/customer/' + customerId + '/users?pageSize=100&page=0'),
        apiGet('/plugins/telemetry/CUSTOMER/' + customerId + '/values/attributes/SERVER_SCOPE')
    ]).then(function (results) {
        customerEntity = results[0];

        var usersResp = results[1];
        customerUsers = (usersResp && usersResp.data) ? usersResp.data : (Array.isArray(usersResp) ? usersResp : []);

        customerAttrs = {};
        if (results[2] && Array.isArray(results[2])) {
            results[2].forEach(function (a) { customerAttrs[a.key] = a.value; });
        }

        render();
    }).catch(function (err) {
        console.error('[CM] Init failed:', err);
        container.innerHTML = '<div class="cm-error">Failed to load customer data. Please try again.</div>';
    });

};

// ── Lifecycle ──────────────────────────────────────────────

self.onDataUpdated = function () {};

self.onResize = function () {};

self.onDestroy = function () {
    if (_cmAddrDebounceTimer) {
        clearTimeout(_cmAddrDebounceTimer);
        _cmAddrDebounceTimer = null;
    }
};
