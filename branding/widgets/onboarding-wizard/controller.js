// =====================================================================
// SignConnect — Onboarding Wizard Widget (controller.js)
// =====================================================================
// 5-step wizard to onboard a new SignConnect customer:
//   Step 1: Customer details (company, email, user accounts)
//   Step 2: Site structure (estate/region/site hierarchy)
//   Step 3: Devices (per-site, profile)
//   Step 4: Review summary
//   Step 5: Provisioning execution
// =====================================================================

var _owDebounceTimers = {};

self.onInit = function () {
    'use strict';

    var $root = self.ctx.$container[0];
    var container = $root.querySelector('.ow-root');
    if (!container) {
        $root.innerHTML = '<div class="ow-root"></div>';
        container = $root.querySelector('.ow-root');
    }
    var http = self.ctx.http;
    var settings = self.ctx.settings || {};

    // ── State Variables ─────────────────────────────────────────

    var currentStep = 1;

    var customer = {
        companyName: '',
        contactEmail: '',
        contactPhone: '',
        users: [{ email: '', firstName: '', lastName: '', sendActivation: true }]
    };

    var sites = [];      // [{estate, region, site, tier, address, lat, lon, co2Override, rateOverride, countryCode, currencySymbol, currencyCode, expanded, tzOffset, city, postcode, siteCountry}]
    var devices = [];    // [{siteName, deviceName, profile, token, tokenMode}]
    var deviceProfiles = {};  // name -> id map
    var profilesFetched = false;

    var provisionState = {
        running: false,
        done: false,
        failed: false,
        plan: [],         // [{phase, label, fn, status}]
        currentIndex: 0,
        log: [],          // [{type, msg}]  type: ok|fail|skip|run
        error: null,
        errorStepIndex: -1,
        createdIds: {},   // entityType:name -> id (duplicate prevention)
        customerId: null,
        userId: null,
        renameValue: ''
    };

    var _activeAddrIdx = -1;
    var _activeAddrCursor = 0;
    var _owAddrOutsideClickFn = null;

    // ── CO2 Factors by Country ──────────────────────────────────

    var CO2_FACTORS = {
        // Primary Markets
        NL: { co2: 0.269, rate: 0.29, currency: 'EUR', symbol: '\u20ac', name: 'Netherlands' },
        GB: { co2: 0.207, rate: 0.30, currency: 'GBP', symbol: '\u00a3', name: 'United Kingdom' },
        DE: { co2: 0.371, rate: 0.38, currency: 'EUR', symbol: '\u20ac', name: 'Germany' },
        FR: { co2: 0.056, rate: 0.27, currency: 'EUR', symbol: '\u20ac', name: 'France' },
        BE: { co2: 0.144, rate: 0.36, currency: 'EUR', symbol: '\u20ac', name: 'Belgium' },
        TR: { co2: 0.440, rate: 4.20, currency: 'TRY', symbol: '\u20ba', name: 'Turkey' },
        // Europe
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
        // Rest of World
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

    // ── API Helpers ─────────────────────────────────────────────

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

    // ── Utilities ───────────────────────────────────────────────

    function esc(str) {
        if (!str) return '';
        return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function generateToken() {
        // UUID v4
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
            var r = Math.random() * 16 | 0;
            return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
        });
    }

    function slugify(str) {
        return String(str).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    }

    function validateEmail(email) {
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    }

    function uniqueValues(arr, key) {
        var seen = {};
        var result = [];
        for (var i = 0; i < arr.length; i++) {
            var v = (arr[i][key] || '').trim();
            if (v && !seen[v]) {
                seen[v] = true;
                result.push(v);
            }
        }
        return result;
    }

    // ── Validation ──────────────────────────────────────────────

    function validateStep1() {
        var errors = [];
        if (!customer.companyName.trim()) errors.push('Company name is required');
        if (!customer.contactEmail.trim()) errors.push('Contact email is required');
        else if (!validateEmail(customer.contactEmail)) errors.push('Contact email is not valid');
        if (customer.users.length === 0) errors.push('At least one user is required');
        for (var u = 0; u < customer.users.length; u++) {
            var usr = customer.users[u];
            var n = u + 1;
            if (!usr.email.trim()) errors.push('User ' + n + ': email is required');
            else if (!validateEmail(usr.email)) errors.push('User ' + n + ': email is not valid');
            if (!usr.firstName.trim()) errors.push('User ' + n + ': first name is required');
            if (!usr.lastName.trim()) errors.push('User ' + n + ': last name is required');
        }
        return { valid: errors.length === 0, errors: errors };
    }

    function validateStep2() {
        var errors = [];
        if (sites.length === 0) errors.push('Add at least one site');
        for (var i = 0; i < sites.length; i++) {
            var s = sites[i];
            if (!s.estate.trim()) errors.push('Row ' + (i + 1) + ': Estate is required');
            if (!s.region.trim()) errors.push('Row ' + (i + 1) + ': Region is required');
            if (!s.site.trim()) errors.push('Row ' + (i + 1) + ': Site name is required');
        }
        // Check duplicate site names
        var seen = {};
        for (var j = 0; j < sites.length; j++) {
            var name = sites[j].site.trim().toLowerCase();
            if (name && seen[name]) errors.push('Duplicate site name: "' + sites[j].site.trim() + '"');
            seen[name] = true;
        }
        return { valid: errors.length === 0, errors: errors };
    }

    function validateStep3() {
        var errors = [];
        if (devices.length === 0) errors.push('Add at least one device');
        var seen = {};
        for (var i = 0; i < devices.length; i++) {
            var d = devices[i];
            if (!d.siteName) errors.push('Row ' + (i + 1) + ': Site is required');
            if (!d.deviceName.trim()) errors.push('Row ' + (i + 1) + ': Device name is required');
            var dname = d.deviceName.trim().toLowerCase();
            if (dname && seen[dname]) errors.push('Duplicate device name: "' + d.deviceName.trim() + '"');
            seen[dname] = true;
            if (d.tokenMode === 'manual' && !d.token.trim()) errors.push('Row ' + (i + 1) + ': Manual token is required');
        }
        return { valid: errors.length === 0, errors: errors };
    }

    // ── Step Renderers ──────────────────────────────────────────

    var STEP_LABELS = ['Customer', 'Sites', 'Devices', 'Review', 'Provision'];

    function renderStepper() {
        var html = '<div class="ow-stepper">';
        for (var i = 0; i < STEP_LABELS.length; i++) {
            var step = i + 1;
            var cls = step < currentStep ? 'ow-step-done' : (step === currentStep ? 'ow-step-active' : 'ow-step-pending');
            var clickable = step < currentStep && !provisionState.running;
            if (i > 0) {
                html += '<div class="ow-step-line' + (step <= currentStep ? ' ow-line-done' : '') + '"></div>';
            }
            html += '<div class="ow-step-item ' + cls + (clickable ? ' ow-step-clickable' : '') + '"' +
                (clickable ? ' data-action="goto-step" data-step="' + step + '"' : '') + '>' +
                '<div class="ow-step-circle">' + (step < currentStep ? '\u2713' : step) + '</div>' +
                '<span class="ow-step-label">' + STEP_LABELS[i] + '</span>' +
                '</div>';
        }
        html += '</div>';
        return html;
    }

    // ── Step 1: Customer Form ───────────────────────────────────

    function renderStep1() {
        var html = '<div class="ow-card">';
        html += '<div class="ow-card-title">Customer Details</div>';
        html += '<div class="ow-card-subtitle">Company information and user accounts</div>';

        // Company details
        html += '<div class="ow-form-row">';
        html += formGroup('Company Name *', '<input class="ow-input" data-field="companyName" value="' + esc(customer.companyName) + '" placeholder="e.g. Acme Lighting Ltd">');
        html += formGroup('Contact Email *', '<input class="ow-input" type="email" data-field="contactEmail" value="' + esc(customer.contactEmail) + '" placeholder="info@company.com">');
        html += formGroup('Phone', '<input class="ow-input" data-field="contactPhone" value="' + esc(customer.contactPhone) + '" placeholder="+31 6 1234 5678">');
        html += '</div>';

        // User Accounts section
        html += '<div class="ow-divider">User Accounts</div>';
        html += '<div class="ow-table-wrap"><table class="ow-table">';
        html += '<thead><tr><th>Email *</th><th>First Name *</th><th>Last Name *</th><th style="width:80px" class="ow-checkbox-cell">Activation</th><th style="width:40px"></th></tr></thead>';
        html += '<tbody>';
        for (var u = 0; u < customer.users.length; u++) {
            var usr = customer.users[u];
            html += '<tr>';
            html += '<td><input class="ow-table-input" type="email" data-user-field="email" data-user-idx="' + u + '" value="' + esc(usr.email) + '" placeholder="user@company.com"></td>';
            html += '<td><input class="ow-table-input" data-user-field="firstName" data-user-idx="' + u + '" value="' + esc(usr.firstName) + '" placeholder="First name"></td>';
            html += '<td><input class="ow-table-input" data-user-field="lastName" data-user-idx="' + u + '" value="' + esc(usr.lastName) + '" placeholder="Last name"></td>';
            html += '<td class="ow-checkbox-cell"><input type="checkbox" data-user-field="sendActivation" data-user-idx="' + u + '"' + (usr.sendActivation ? ' checked' : '') + '></td>';
            if (customer.users.length > 1) {
                html += '<td><button class="ow-btn-icon" data-action="remove-user" data-user-idx="' + u + '" title="Remove">\u2715</button></td>';
            } else {
                html += '<td></td>';
            }
            html += '</tr>';
        }
        html += '</tbody></table></div>';
        html += '<div class="ow-table-actions">';
        html += '<button class="ow-btn ow-btn-sm ow-btn-primary" data-action="add-user">+ Add User</button>';
        html += '</div>';

        html += '</div>';
        return html;
    }

    // ── Step 2: Site Structure ──────────────────────────────────

    function renderStep2() {
        var html = '<div class="ow-card">';
        html += '<div class="ow-card-title">Site Structure</div>';
        html += '<div class="ow-card-subtitle">Define estate / region / site hierarchy. Expand rows for address details.</div>';

        html += '<div class="ow-table-wrap"><table class="ow-table">';
        html += '<thead><tr><th>Estate</th><th>Region</th><th>Site Name</th><th>Tier</th><th style="width:60px"></th></tr></thead>';
        html += '<tbody>';

        var estates = uniqueValues(sites, 'estate');
        var regions = uniqueValues(sites, 'region');

        for (var i = 0; i < sites.length; i++) {
            var s = sites[i];
            var tierSel = '<select class="ow-table-input" data-site-field="tier" data-idx="' + i + '">' +
                '<option value="standard"' + (s.tier === 'standard' ? ' selected' : '') + '>Standard</option>' +
                '<option value="plus"' + (s.tier === 'plus' ? ' selected' : '') + '>Plus</option>' +
                '</select>';

            html += '<tr data-row="' + i + '">';
            html += '<td>' + suggestInput('estate', i, s.estate, estates) + '</td>';
            html += '<td>' + suggestInput('region', i, s.region, regions) + '</td>';
            html += '<td><input class="ow-table-input" data-site-field="site" data-idx="' + i + '" value="' + esc(s.site) + '" placeholder="Site name"></td>';
            html += '<td>' + tierSel + '</td>';
            html += '<td style="white-space:nowrap;">' +
                '<button class="ow-btn-icon" data-action="toggle-expand" data-idx="' + i + '" title="' + (s.expanded ? 'Collapse' : 'Expand') + '">' +
                (s.expanded ? '\u25B2' : '\u25BC') + '</button>' +
                '<button class="ow-btn-icon" data-action="remove-site" data-idx="' + i + '" title="Remove">\u2715</button>' +
                '</td>';
            html += '</tr>';

            if (s.expanded) {
                html += '<tr class="ow-expand-row"><td colspan="5"><div class="ow-expand-inner">';
                // Address input + dropdown wrapped together in .ow-suggest-wrap
                html += '<div class="ow-form-group ow-suggest-wrap">';
                html += '<label>Address</label>';
                html += '<input class="ow-table-input" data-site-field="address" data-idx="' + i + '" value="' + esc(s.address) + '" placeholder="Search address..." data-action="address-search">';
                if (s._addrResults && s._addrResults.length > 0) {
                    html += '<div class="ow-suggest-list" data-addr-suggest="' + i + '">';
                    for (var a = 0; a < s._addrResults.length; a++) {
                        html += '<div class="ow-suggest-item" data-action="select-address" data-idx="' + i + '" data-addr-idx="' + a + '">' + esc(s._addrResults[a].display_name) + '</div>';
                    }
                    html += '</div>';
                }
                if (s._addrFetching) {
                    html += '<div class="ow-suggest-list" data-addr-suggest="' + i + '"><div class="ow-suggest-empty">Searching...</div></div>';
                }
                html += '</div>';
                html += formGroupSm('Latitude', '<input class="ow-table-input" type="number" step="any" data-site-field="lat" data-idx="' + i + '" value="' + (s.lat || '') + '">');
                html += formGroupSm('Longitude', '<input class="ow-table-input" type="number" step="any" data-site-field="lon" data-idx="' + i + '" value="' + (s.lon || '') + '">');
                html += formGroupSm('CO\u2082 (kg/kWh)' + (s.countryCode ? ' \u2014 ' + ((CO2_FACTORS[s.countryCode] || {}).name || s.countryCode) : ''),
                    '<input class="ow-table-input" type="number" step="0.001" data-site-field="co2Override" data-idx="' + i + '" value="' + (s.co2Override || '') + '" placeholder="Select address to auto-fill">');
                html += formGroupSm('Rate (' + (s.currencySymbol || '-') + '/kWh)',
                    '<input class="ow-table-input" type="number" step="0.01" data-site-field="rateOverride" data-idx="' + i + '" value="' + (s.rateOverride || '') + '" placeholder="Select address to auto-fill">');
                if (s.countryCode) {
                    html += formGroupSm('Currency', '<input class="ow-table-input" readonly value="' +
                        esc((s.currencySymbol || '') + ' (' + (s.currencyCode || '') + ')') + '">');
                }
                html += formGroupSm('Timezone (UTC offset)', '<input class="ow-table-input" type="number" step="0.5" data-site-field="tzOffset" data-idx="' + i + '" value="' + (s.tzOffset != null ? s.tzOffset : '') + '" placeholder="Auto-detect">');
                html += '</div>';
                html += '</td></tr>';
            }
        }

        html += '</tbody></table></div>';

        // Summary
        if (sites.length > 0) {
            var estCount = uniqueValues(sites, 'estate').length;
            var regCount = uniqueValues(sites, 'region').length;
            html += '<div class="ow-summary">';
            html += '<span class="ow-summary-badge"><b>' + estCount + '</b> estate' + (estCount !== 1 ? 's' : '') + '</span>';
            html += '<span class="ow-summary-badge"><b>' + regCount + '</b> region' + (regCount !== 1 ? 's' : '') + '</span>';
            html += '<span class="ow-summary-badge"><b>' + sites.length + '</b> site' + (sites.length !== 1 ? 's' : '') + '</span>';
            html += '</div>';
        }

        // Actions
        html += '<div class="ow-table-actions">';
        html += '<button class="ow-btn ow-btn-sm ow-btn-primary" data-action="add-site">+ Add Row</button>';
        html += '<button class="ow-btn ow-btn-sm ow-btn-secondary" data-action="paste-csv">Paste from CSV</button>';
        html += '<button class="ow-btn ow-btn-sm ow-btn-danger" data-action="clear-sites">Clear All</button>';
        html += '</div>';

        html += '</div>';
        return html;
    }

    function suggestInput(field, idx, value, options) {
        return '<div class="ow-suggest-wrap">' +
            '<input class="ow-table-input" data-site-field="' + field + '" data-idx="' + idx + '" value="' + esc(value) + '" placeholder="' + field + '" autocomplete="off" data-action="suggest-focus">' +
            '</div>';
    }

    // ── Step 3: Devices ─────────────────────────────────────────

    function renderStep3() {
        var html = '<div class="ow-card">';
        html += '<div class="ow-card-title">Devices</div>';
        html += '<div class="ow-card-subtitle">Assign devices to sites. Profiles determine DALI2 (standard) or D4i (plus) capability.</div>';

        if (!profilesFetched) {
            html += '<div class="ow-loading"><div class="ow-spinner"></div><div class="ow-loading-text">Loading device profiles...</div></div>';
            html += '</div>';
            return html;
        }

        var siteNames = [];
        for (var s = 0; s < sites.length; s++) {
            siteNames.push(sites[s].site);
        }

        html += '<div class="ow-table-wrap"><table class="ow-table">';
        html += '<thead><tr><th>Site</th><th>Device Name</th><th>Profile</th><th style="width:40px"></th></tr></thead>';
        html += '<tbody>';

        var profileNames = Object.keys(deviceProfiles);

        for (var i = 0; i < devices.length; i++) {
            var d = devices[i];
            // Site dropdown
            var siteSel = '<select class="ow-table-input" data-dev-field="siteName" data-idx="' + i + '">';
            siteSel += '<option value="">-- Select --</option>';
            for (var si = 0; si < siteNames.length; si++) {
                siteSel += '<option value="' + esc(siteNames[si]) + '"' + (d.siteName === siteNames[si] ? ' selected' : '') + '>' + esc(siteNames[si]) + '</option>';
            }
            siteSel += '</select>';

            // Profile dropdown
            var profSel = '<select class="ow-table-input" data-dev-field="profile" data-idx="' + i + '">';
            for (var pi = 0; pi < profileNames.length; pi++) {
                profSel += '<option value="' + esc(profileNames[pi]) + '"' + (d.profile === profileNames[pi] ? ' selected' : '') + '>' + esc(profileNames[pi]) + '</option>';
            }
            if (profileNames.length === 0) {
                profSel += '<option value="default">default</option>';
            }
            profSel += '</select>';

            // Tier mismatch warning
            var warn = '';
            if (d.siteName) {
                var siteTier = getSiteTier(d.siteName);
                var profileLower = (d.profile || '').toLowerCase();
                if (siteTier === 'plus' && profileLower.indexOf('dali2') >= 0 && profileLower.indexOf('d4i') < 0) {
                    warn = '<div class="ow-warn">Plus site expects D4i profile</div>';
                } else if (siteTier === 'standard' && profileLower.indexOf('d4i') >= 0) {
                    warn = '<div class="ow-warn">Standard site expects DALI2 profile</div>';
                }
            }

            html += '<tr>';
            html += '<td>' + siteSel + '</td>';
            html += '<td><input class="ow-table-input" data-dev-field="deviceName" data-idx="' + i + '" value="' + esc(d.deviceName) + '" placeholder="Device name">' + warn + '</td>';
            html += '<td>' + profSel + '</td>';
            html += '<td><button class="ow-btn-icon" data-action="remove-device" data-idx="' + i + '" title="Remove">\u2715</button></td>';
            html += '</tr>';
        }

        html += '</tbody></table></div>';

        // Actions
        html += '<div class="ow-table-actions">';
        html += '<button class="ow-btn ow-btn-sm ow-btn-primary" data-action="add-device">+ Add Device</button>';
        html += '<button class="ow-btn ow-btn-sm ow-btn-secondary" data-action="auto-generate-devices">Auto-generate (1 per site)</button>';
        html += '</div>';

        html += '</div>';
        return html;
    }

    function getSiteTier(siteName) {
        for (var i = 0; i < sites.length; i++) {
            if (sites[i].site === siteName) return sites[i].tier;
        }
        return 'standard';
    }

    // ── Step 4: Review ──────────────────────────────────────────

    function renderStep4() {
        var html = '<div class="ow-card">';
        html += '<div class="ow-card-title">Review & Confirm</div>';
        html += '<div class="ow-card-subtitle">Verify all details before provisioning</div>';

        // Customer info
        html += '<div class="ow-review-section"><h3>Customer</h3>';
        html += '<div class="ow-review-info">';
        html += reviewField('Company', customer.companyName);
        html += reviewField('Contact', customer.contactEmail);
        html += reviewField('Users', customer.users.length + ' account(s)');
        html += '</div>';
        for (var u = 0; u < customer.users.length; u++) {
            var usr = customer.users[u];
            html += '<div class="ow-review-info" style="margin-top:4px">';
            html += reviewField('User ' + (u + 1), usr.email);
            html += reviewField('Name', usr.firstName + ' ' + usr.lastName);
            html += reviewField('Activation', usr.sendActivation ? 'Email will be sent' : 'Manual');
            html += '</div>';
        }
        html += '</div>';

        // Hierarchy tree
        html += '<div class="ow-review-section"><h3>Hierarchy</h3>';
        html += '<div class="ow-tree">';
        var tree = buildHierarchyTree();
        for (var ei = 0; ei < tree.length; ei++) {
            var estate = tree[ei];
            html += '<div class="ow-tree-estate"><span class="ow-tree-icon">\uD83C\uDFE2</span>' + esc(estate.name) + '</div>';
            for (var ri = 0; ri < estate.regions.length; ri++) {
                var region = estate.regions[ri];
                html += '<div class="ow-tree-region"><span class="ow-tree-icon">\uD83D\uDCC1</span>' + esc(region.name) + '</div>';
                for (var si = 0; si < region.sites.length; si++) {
                    var site = region.sites[si];
                    html += '<div class="ow-tree-site"><span class="ow-tree-icon">\uD83D\uDCCD</span>' + esc(site.name) +
                        ' <span class="ow-tier ow-tier-' + site.tier + '">' + site.tier + '</span>' +
                        (site.countryCode ? ' <span style="color:#94a3b8;font-size:12px">(' + esc(site.countryCode) + ')</span>' : '') +
                        '</div>';
                    var siteDevs = getDevicesForSite(site.name);
                    for (var di = 0; di < siteDevs.length; di++) {
                        html += '<div class="ow-tree-device"><span class="ow-tree-icon">\u2B24</span>' + esc(siteDevs[di].deviceName) +
                            ' <span style="color:#94a3b8">(' + esc(siteDevs[di].profile) + ')</span></div>';
                    }
                }
            }
        }
        html += '</div></div>';

        // API call estimate
        var estCount = uniqueValues(sites, 'estate').length;
        var regCount = uniqueValues(sites, 'region').length;
        var siteCount = sites.length;
        var devCount = devices.length;
        var userCount = customer.users.length;
        // 1 customer + U users + 3 dashboard assigns + E estates + 2R regions (asset+relation) + 3S sites (asset+relation+attrs) + 3D devices (device+relation+attrs)
        var apiCalls = 1 + userCount + 3 + estCount + (2 * regCount) + (3 * siteCount) + (3 * devCount);
        html += '<div class="ow-estimate">';
        html += 'This will make approximately <b>' + apiCalls + '</b> API calls: ';
        html += '1 customer, ' + userCount + ' user(s), 3 dashboard assignments, ' + estCount + ' estate(s), ' + regCount + ' region(s), ' + siteCount + ' site(s), ' + devCount + ' device(s).';
        html += '</div>';

        // Provision button
        html += '<div style="text-align:center;margin-top:20px">';
        html += '<button class="ow-btn ow-btn-success" data-action="provision-now" style="padding:12px 40px;font-size:15px;font-weight:700">PROVISION NOW</button>';
        html += '</div>';

        html += '</div>';
        return html;
    }

    function reviewField(label, value) {
        return '<div class="ow-review-field"><span class="ow-rlabel">' + esc(label) + ': </span><span class="ow-rvalue">' + esc(value) + '</span></div>';
    }

    function buildHierarchyTree() {
        var tree = [];
        var estateMap = {};
        for (var i = 0; i < sites.length; i++) {
            var s = sites[i];
            if (!estateMap[s.estate]) {
                estateMap[s.estate] = { name: s.estate, regions: [], regionMap: {} };
                tree.push(estateMap[s.estate]);
            }
            var est = estateMap[s.estate];
            if (!est.regionMap[s.region]) {
                est.regionMap[s.region] = { name: s.region, sites: [] };
                est.regions.push(est.regionMap[s.region]);
            }
            est.regionMap[s.region].sites.push({ name: s.site, tier: s.tier, countryCode: s.countryCode || '' });
        }
        return tree;
    }

    function getDevicesForSite(siteName) {
        var result = [];
        for (var i = 0; i < devices.length; i++) {
            if (devices[i].siteName === siteName) result.push(devices[i]);
        }
        return result;
    }

    // ── Step 5: Provisioning ────────────────────────────────────

    function renderStep5() {
        var html = '<div class="ow-card">';

        if (provisionState.done && !provisionState.failed) {
            // Completion panel
            html += '<div class="ow-complete">';
            html += '<div class="ow-complete-icon">\u2705</div>';
            html += '<h2>Provisioning Complete</h2>';
            html += '<p>Successfully onboarded <b>' + esc(customer.companyName) + '</b> with ' + sites.length + ' site(s) and ' + devices.length + ' device(s).</p>';

            html += '<div class="ow-complete-actions">';
            if (settings.fleetDashboardId) {
                html += '<button class="ow-btn ow-btn-primary" data-action="goto-fleet">Go to Fleet Dashboard</button>';
            }
            html += '<button class="ow-btn ow-btn-success" data-action="reset-wizard">Onboard Another</button>';
            html += '</div>';
            html += '</div>';
        } else {
            // Progress
            html += '<div class="ow-card-title">Provisioning</div>';
            html += '<div class="ow-card-subtitle">' + (provisionState.running ? 'Creating entities...' : (provisionState.failed ? 'Paused due to error' : 'Ready to provision')) + '</div>';

            var total = provisionState.plan.length || 1;
            var done = provisionState.currentIndex;
            var pct = Math.round((done / total) * 100);
            var barClass = 'ow-progress-bar';
            if (provisionState.done) barClass += ' ow-progress-done';
            if (provisionState.failed) barClass += ' ow-progress-error';

            html += '<div class="ow-progress-wrap">';
            html += '<div class="' + barClass + '" style="width:' + pct + '%"></div>';
            html += '<span class="ow-progress-pct">' + pct + '%</span>';
            html += '</div>';

            // Log
            html += '<div class="ow-log">';
            for (var li = 0; li < provisionState.log.length; li++) {
                var entry = provisionState.log[li];
                var icon = entry.type === 'ok' ? '\u2713' : (entry.type === 'fail' ? '\u2717' : (entry.type === 'skip' ? '\u2192' : '\u25B6'));
                html += '<div class="ow-log-entry ow-log-' + entry.type + '"><span class="ow-log-icon">' + icon + '</span><span class="ow-log-msg">' + entry.msg + '</span></div>';
            }
            html += '</div>';

            // Error panel
            if (provisionState.failed && provisionState.error) {
                html += '<div class="ow-error-panel">';
                html += '<p>' + esc(provisionState.error) + '</p>';

                // 409 conflict — offer rename
                if (provisionState.error.indexOf('409') >= 0 || provisionState.error.toLowerCase().indexOf('already exists') >= 0) {
                    html += '<div class="ow-rename-wrap">';
                    html += '<input class="ow-input" data-field="renameValue" value="' + esc(provisionState.renameValue) + '" placeholder="New name...">';
                    html += '<button class="ow-btn ow-btn-sm ow-btn-primary" data-action="retry-rename">Retry with new name</button>';
                    html += '</div>';
                }

                html += '<div class="ow-error-actions">';
                html += '<button class="ow-btn ow-btn-sm ow-btn-primary" data-action="retry-step">Retry</button>';
                html += '<button class="ow-btn ow-btn-sm ow-btn-secondary" data-action="skip-step">Skip</button>';
                html += '</div>';
                html += '</div>';
            }
        }

        html += '</div>';
        return html;
    }

    // ── Form Helpers ────────────────────────────────────────────

    function formGroup(label, input) {
        return '<div class="ow-form-group"><label>' + label + '</label>' + input + '</div>';
    }

    function formGroupSm(label, input) {
        return '<div class="ow-form-group"><label>' + label + '</label>' + input + '</div>';
    }

    // ── Provisioning Engine ─────────────────────────────────────

    function buildProvisionPlan() {
        var plan = [];
        var tree = buildHierarchyTree();
        var fleetId = settings.fleetDashboardId || '';
        var standardId = settings.standardDashboardId || '';
        var plusId = settings.plusDashboardId || '';

        // 1. Create customer
        plan.push({
            phase: 'customer', label: 'Create customer: ' + customer.companyName,
            fn: function () {
                var key = 'CUSTOMER:' + customer.companyName;
                if (provisionState.createdIds[key]) return Promise.resolve();
                return apiPost('/customer', {
                    title: customer.companyName,
                    email: customer.contactEmail,
                    phone: customer.contactPhone || '',
                    additionalInfo: {
                        description: 'Onboarded via SignConnect wizard'
                    }
                }).then(function (c) {
                    provisionState.customerId = c.id.id;
                    provisionState.createdIds[key] = c.id.id;
                });
            }
        });

        // 2. Create users
        for (var ui = 0; ui < customer.users.length; ui++) {
            (function (usr, idx) {
                plan.push({
                    phase: 'user', label: 'Create user: ' + usr.email,
                    fn: function () {
                        var key = 'USER:' + usr.email;
                        if (provisionState.createdIds[key]) return Promise.resolve();
                        var defaultDash = fleetId || '';
                        return apiPost('/user?sendActivationMail=' + (usr.sendActivation ? 'true' : 'false'), {
                            email: usr.email,
                            firstName: usr.firstName,
                            lastName: usr.lastName,
                            authority: 'CUSTOMER_USER',
                            customerId: { id: provisionState.customerId, entityType: 'CUSTOMER' },
                            additionalInfo: {
                                defaultDashboardId: defaultDash,
                                defaultDashboardFullscreen: true,
                                homeDashboardId: defaultDash,
                                homeDashboardHideToolbar: true
                            }
                        }).then(function (u) {
                            if (idx === 0) provisionState.userId = u.id.id;
                            provisionState.createdIds[key] = u.id.id;
                        });
                    }
                });
            })(customer.users[ui], ui);
        }

        // 3. Assign dashboards
        var dashIds = [];
        if (fleetId) dashIds.push({ id: fleetId, label: 'Fleet' });
        if (standardId) dashIds.push({ id: standardId, label: 'Standard' });
        if (plusId) dashIds.push({ id: plusId, label: 'Plus' });

        for (var di = 0; di < dashIds.length; di++) {
            (function (dash) {
                plan.push({
                    phase: 'dashboard', label: 'Assign ' + dash.label + ' dashboard',
                    fn: function () {
                        return apiPost('/customer/' + provisionState.customerId + '/dashboard/' + dash.id, null);
                    }
                });
            })(dashIds[di]);
        }

        // 4. Create estates
        for (var ei = 0; ei < tree.length; ei++) {
            (function (estate) {
                plan.push({
                    phase: 'estate', label: 'Create estate: ' + estate.name,
                    fn: function () {
                        var key = 'ESTATE:' + estate.name;
                        if (provisionState.createdIds[key]) return Promise.resolve();
                        return apiPost('/asset', {
                            name: estate.name,
                            type: 'estate',
                            label: estate.name,
                            customerId: { id: provisionState.customerId, entityType: 'CUSTOMER' }
                        }).then(function (a) {
                            provisionState.createdIds[key] = a.id.id;
                        });
                    }
                });
            })(tree[ei]);
        }

        // 5. Create regions with relations to estates
        for (var ei2 = 0; ei2 < tree.length; ei2++) {
            for (var ri = 0; ri < tree[ei2].regions.length; ri++) {
                (function (estate, region) {
                    plan.push({
                        phase: 'region', label: 'Create region: ' + region.name,
                        fn: function () {
                            var key = 'REGION:' + region.name;
                            if (provisionState.createdIds[key]) return Promise.resolve();
                            return apiPost('/asset', {
                                name: region.name,
                                type: 'region',
                                label: region.name,
                                customerId: { id: provisionState.customerId, entityType: 'CUSTOMER' }
                            }).then(function (a) {
                                provisionState.createdIds[key] = a.id.id;
                            });
                        }
                    });
                    plan.push({
                        phase: 'relation', label: 'Link estate \u2192 region: ' + estate.name + ' \u2192 ' + region.name,
                        fn: function () {
                            var estateId = provisionState.createdIds['ESTATE:' + estate.name];
                            var regionId = provisionState.createdIds['REGION:' + region.name];
                            return apiPost('/relation', {
                                from: { id: estateId, entityType: 'ASSET' },
                                to: { id: regionId, entityType: 'ASSET' },
                                type: 'Contains',
                                typeGroup: 'COMMON'
                            });
                        }
                    });
                })(tree[ei2], tree[ei2].regions[ri]);
            }
        }

        // 6. Create sites with relations and attributes
        for (var si = 0; si < sites.length; si++) {
            (function (siteData) {
                plan.push({
                    phase: 'site', label: 'Create site: ' + siteData.site,
                    fn: function () {
                        var key = 'SITE:' + siteData.site;
                        if (provisionState.createdIds[key]) return Promise.resolve();
                        return apiPost('/asset', {
                            name: siteData.site,
                            type: 'site',
                            label: siteData.site,
                            customerId: { id: provisionState.customerId, entityType: 'CUSTOMER' }
                        }).then(function (a) {
                            provisionState.createdIds[key] = a.id.id;
                        });
                    }
                });
                plan.push({
                    phase: 'relation', label: 'Link region \u2192 site: ' + siteData.region + ' \u2192 ' + siteData.site,
                    fn: function () {
                        var regionId = provisionState.createdIds['REGION:' + siteData.region];
                        var siteId = provisionState.createdIds['SITE:' + siteData.site];
                        return apiPost('/relation', {
                            from: { id: regionId, entityType: 'ASSET' },
                            to: { id: siteId, entityType: 'ASSET' },
                            type: 'Contains',
                            typeGroup: 'COMMON'
                        });
                    }
                });
                plan.push({
                    phase: 'attributes', label: 'Set attributes: ' + siteData.site,
                    fn: function () {
                        var siteId = provisionState.createdIds['SITE:' + siteData.site];
                        var siteCC = siteData.countryCode || '';
                        var cInfo = CO2_FACTORS[siteCC] || {};
                        var co2 = siteData.co2Override || cInfo.co2 || 0;
                        var rate = siteData.rateOverride || cInfo.rate || 0;
                        var attrs = {
                            dashboard_tier: siteData.tier,
                            co2_per_kwh: parseFloat(co2) || 0,
                            energy_rate: parseFloat(rate) || 0,
                            currency_symbol: siteData.currencySymbol || cInfo.symbol || '',
                            latitude: parseFloat(siteData.lat) || 0,
                            longitude: parseFloat(siteData.lon) || 0
                        };
                        if (siteCC) attrs.country_code = siteCC;
                        if (siteData.currencyCode || cInfo.currency) attrs.currency_code = siteData.currencyCode || cInfo.currency;
                        if (siteData.address) attrs.address = siteData.address;
                        if (siteData.city) attrs.site_city = siteData.city;
                        if (siteData.postcode) attrs.site_postcode = siteData.postcode;
                        if (siteData.siteCountry) attrs.site_country = siteData.siteCountry;
                        if (siteData.tzOffset != null && siteData.tzOffset !== '') {
                            attrs.timezone_offset = parseFloat(siteData.tzOffset);
                        }
                        return apiPost('/plugins/telemetry/ASSET/' + siteId + '/attributes/SERVER_SCOPE', attrs);
                    }
                });
            })(sites[si]);
        }

        // 7. Create devices with relations and attributes
        for (var dvi = 0; dvi < devices.length; dvi++) {
            (function (devData) {
                // Ensure token is generated
                if (devData.tokenMode === 'auto' && !devData.token) {
                    devData.token = generateToken();
                }

                plan.push({
                    phase: 'device', label: 'Create device: ' + devData.deviceName,
                    fn: function () {
                        var key = 'DEVICE:' + devData.deviceName;
                        if (provisionState.createdIds[key]) return Promise.resolve();
                        var profileId = deviceProfiles[devData.profile];
                        var body = {
                            name: devData.deviceName,
                            type: 'default',
                            label: devData.deviceName,
                            customerId: { id: provisionState.customerId, entityType: 'CUSTOMER' }
                        };
                        if (profileId) {
                            body.deviceProfileId = { id: profileId, entityType: 'DEVICE_PROFILE' };
                        }
                        var qp = '?accessToken=' + encodeURIComponent(devData.token);
                        return apiPost('/device' + qp, body).then(function (dev) {
                            provisionState.createdIds[key] = dev.id.id;
                        });
                    }
                });
                plan.push({
                    phase: 'relation', label: 'Link site \u2192 device: ' + devData.siteName + ' \u2192 ' + devData.deviceName,
                    fn: function () {
                        var siteId = provisionState.createdIds['SITE:' + devData.siteName];
                        var deviceId = provisionState.createdIds['DEVICE:' + devData.deviceName];
                        return apiPost('/relation', {
                            from: { id: siteId, entityType: 'ASSET' },
                            to: { id: deviceId, entityType: 'DEVICE' },
                            type: 'Contains',
                            typeGroup: 'COMMON'
                        });
                    }
                });
                plan.push({
                    phase: 'attributes', label: 'Set device attributes: ' + devData.deviceName,
                    fn: function () {
                        var deviceId = provisionState.createdIds['DEVICE:' + devData.deviceName];
                        // Find the site for this device to get its CO2/rate values
                        var siteCo2 = 0;
                        var siteRate = 0;
                        var devCurrencySymbol = '';
                        for (var x = 0; x < sites.length; x++) {
                            if (sites[x].site === devData.siteName) {
                                var sInfo = CO2_FACTORS[sites[x].countryCode] || {};
                                siteCo2 = sites[x].co2Override || sInfo.co2 || 0;
                                siteRate = sites[x].rateOverride || sInfo.rate || 0;
                                devCurrencySymbol = sites[x].currencySymbol || sInfo.symbol || '';
                                break;
                            }
                        }
                        return apiPost('/plugins/telemetry/DEVICE/' + deviceId + '/attributes/SERVER_SCOPE', {
                            co2_per_kwh: parseFloat(siteCo2) || 0,
                            energy_rate: parseFloat(siteRate) || 0,
                            currency_symbol: devCurrencySymbol
                        });
                    }
                });
            })(devices[dvi]);
        }

        return plan;
    }

    function runProvisionPlan() {
        provisionState.running = true;
        provisionState.done = false;
        provisionState.failed = false;
        provisionState.error = null;

        function runNext() {
            if (provisionState.currentIndex >= provisionState.plan.length) {
                provisionState.running = false;
                provisionState.done = true;
                provisionState.log.push({ type: 'ok', msg: '<b>All done!</b> Provisioning complete.' });
                render();
                return;
            }

            var step = provisionState.plan[provisionState.currentIndex];
            provisionState.log.push({ type: 'run', msg: step.label });
            render();

            // Auto-scroll log to bottom
            setTimeout(function () {
                var logEl = container.querySelector('.ow-log');
                if (logEl) logEl.scrollTop = logEl.scrollHeight;
            }, 50);

            step.fn().then(function () {
                // Replace "run" entry with "ok"
                provisionState.log[provisionState.log.length - 1] = { type: 'ok', msg: step.label };
                provisionState.currentIndex++;
                render();
                // Small delay to make progress visible
                setTimeout(runNext, 80);
            }).catch(function (err) {
                var errMsg = '';
                if (err && err.error) {
                    errMsg = err.error.message || JSON.stringify(err.error);
                } else if (err && err.message) {
                    errMsg = err.message;
                } else if (err && err.status) {
                    errMsg = 'HTTP ' + err.status + ': ' + (err.statusText || 'Error');
                } else {
                    errMsg = String(err);
                }
                provisionState.log[provisionState.log.length - 1] = { type: 'fail', msg: step.label + ' \u2014 ' + errMsg };
                provisionState.running = false;
                provisionState.failed = true;
                provisionState.error = errMsg;
                provisionState.errorStepIndex = provisionState.currentIndex;
                render();
            });
        }

        runNext();
    }

    // ── Fetch Device Profiles ───────────────────────────────────

    function fetchDeviceProfiles() {
        if (profilesFetched) return;
        apiGet('/deviceProfiles?pageSize=100&page=0&sortProperty=name&sortOrder=ASC')
            .then(function (result) {
                var data = result.data || [];
                for (var i = 0; i < data.length; i++) {
                    deviceProfiles[data[i].name] = data[i].id.id;
                }
                profilesFetched = true;
                if (currentStep === 3) render();
            })
            .catch(function (err) {
                console.error('[OW] Failed to fetch device profiles:', err);
                profilesFetched = true;
                if (currentStep === 3) render();
            });
    }

    // ── Address Search (Nominatim) ──────────────────────────────

    function searchAddress(idx, query) {
        if (!query || query.length < 3) {
            sites[idx]._addrResults = [];
            sites[idx]._addrFetching = false;
            _activeAddrIdx = -1;
            render();
            return;
        }

        sites[idx]._addrFetching = true;
        sites[idx]._addrResults = [];
        _activeAddrIdx = idx;
        _activeAddrCursor = query.length;
        render();

        var url = 'https://nominatim.openstreetmap.org/search?q=' + encodeURIComponent(query) +
            '&format=json&limit=6&addressdetails=1';

        fetchExternal(url, 8000)
            .then(function (results) {
                sites[idx]._addrFetching = false;
                sites[idx]._addrResults = results || [];
                _activeAddrIdx = (results && results.length > 0) ? idx : -1;
                render();
            })
            .catch(function () {
                sites[idx]._addrFetching = false;
                sites[idx]._addrResults = [];
                _activeAddrIdx = -1;
                render();
            });
    }

    function selectAddress(siteIdx, addrIdx) {
        var result = sites[siteIdx]._addrResults[addrIdx];
        if (!result) return;

        sites[siteIdx].address = result.display_name || '';
        sites[siteIdx].lat = result.lat || '';
        sites[siteIdx].lon = result.lon || '';
        sites[siteIdx]._addrResults = [];
        _activeAddrIdx = -1;

        // Extract address components
        var addr = result.address || {};
        sites[siteIdx].city = addr.city || addr.town || addr.village || '';
        sites[siteIdx].postcode = addr.postcode || '';
        sites[siteIdx].siteCountry = addr.country || '';

        // Derive country and auto-fill CO2/rate
        var cc = (addr.country_code || '').toUpperCase();
        sites[siteIdx].countryCode = cc;
        var countryInfo = CO2_FACTORS[cc];
        if (countryInfo) {
            sites[siteIdx].co2Override = countryInfo.co2;
            sites[siteIdx].rateOverride = countryInfo.rate;
            sites[siteIdx].currencySymbol = countryInfo.symbol;
            sites[siteIdx].currencyCode = countryInfo.currency;
        } else {
            sites[siteIdx].currencySymbol = '';
            sites[siteIdx].currencyCode = '';
        }

        // Fetch timezone
        if (result.lat && result.lon) {
            fetchTimezoneForSite(siteIdx, result.lat, result.lon);
        }

        render();
    }

    function fetchTimezoneForSite(idx, lat, lon) {
        var url = 'https://timeapi.io/api/timezone/coordinate?latitude=' +
            encodeURIComponent(lat) + '&longitude=' + encodeURIComponent(lon);

        fetchExternal(url, 8000)
            .then(function (data) {
                if (data && data.currentUtcOffset && data.currentUtcOffset.seconds !== undefined) {
                    sites[idx].tzOffset = data.currentUtcOffset.seconds / 3600;
                } else if (data && data.standardUtcOffset && data.standardUtcOffset.seconds !== undefined) {
                    sites[idx].tzOffset = data.standardUtcOffset.seconds / 3600;
                } else {
                    sites[idx].tzOffset = Math.round(parseFloat(lon) / 15);
                }
                render();
            })
            .catch(function () {
                sites[idx].tzOffset = Math.round(parseFloat(lon) / 15);
                render();
            });
    }

    // ── CSV Parser ──────────────────────────────────────────────

    function parseCSV(text) {
        var lines = text.split(/\r?\n/).filter(function (l) { return l.trim(); });
        var newSites = [];
        for (var i = 0; i < lines.length; i++) {
            var parts = lines[i].split(/[,\t]/).map(function (p) { return p.trim(); });
            // Expect: estate, region, site, tier[, address]
            if (parts.length >= 3) {
                newSites.push({
                    estate: parts[0] || '',
                    region: parts[1] || '',
                    site: parts[2] || '',
                    tier: (parts[3] || 'standard').toLowerCase() === 'plus' ? 'plus' : 'standard',
                    address: parts[4] || '',
                    lat: '', lon: '', co2Override: '', rateOverride: '',
                    countryCode: '', currencySymbol: '', currencyCode: '',
                    expanded: false, tzOffset: null,
                    city: '', postcode: '', siteCountry: '',
                    _addrResults: [], _addrFetching: false
                });
            }
        }
        return newSites;
    }

    // ── Main Render ─────────────────────────────────────────────

    function render() {
        var html = '';

        html += '<div class="ow-header"><h1>Customer Onboarding</h1><p>SignConnect provisioning wizard</p></div>';
        html += renderStepper();

        // Validation errors
        var validation = null;
        if (currentStep === 1) {
            html += renderStep1();
        } else if (currentStep === 2) {
            html += renderStep2();
        } else if (currentStep === 3) {
            html += renderStep3();
        } else if (currentStep === 4) {
            html += renderStep4();
        } else if (currentStep === 5) {
            html += renderStep5();
        }

        // Navigation bar (not shown on step 5 while running/done)
        if (currentStep <= 4 || (!provisionState.running && !provisionState.done)) {
            html += '<div class="ow-nav">';
            html += '<div class="ow-nav-left">';
            if (currentStep > 1 && currentStep <= 4) {
                html += '<button class="ow-btn ow-btn-secondary" data-action="prev-step">\u2190 Back</button>';
            }
            html += '</div>';
            html += '<div class="ow-nav-right">';
            if (currentStep < 4) {
                html += '<button class="ow-btn ow-btn-primary" data-action="next-step">Next \u2192</button>';
            }
            html += '</div>';
            html += '</div>';
        }

        container.innerHTML = html;
        bindEvents();

        // Restore focus to address input after re-render (searchAddress triggers render)
        if (_activeAddrIdx >= 0) {
            var addrInp = container.querySelector('[data-site-field="address"][data-idx="' + _activeAddrIdx + '"]');
            if (addrInp) {
                addrInp.focus();
                if (_activeAddrCursor > 0 && _activeAddrCursor <= addrInp.value.length) {
                    addrInp.setSelectionRange(_activeAddrCursor, _activeAddrCursor);
                }
            }
        }
    }

    // ── Event Binding ───────────────────────────────────────────

    function bindEvents() {
        // Data-action delegation
        container.querySelectorAll('[data-action]').forEach(function (el) {
            var action = el.getAttribute('data-action');

            if (action === 'next-step') {
                el.addEventListener('click', function () { goToStep(currentStep + 1); });
            } else if (action === 'prev-step') {
                el.addEventListener('click', function () { goToStep(currentStep - 1); });
            } else if (action === 'goto-step') {
                el.addEventListener('click', function () {
                    var step = parseInt(el.getAttribute('data-step'));
                    if (step < currentStep) goToStep(step);
                });
            } else if (action === 'add-user') {
                el.addEventListener('click', function () {
                    captureStepState();
                    customer.users.push({ email: '', firstName: '', lastName: '', sendActivation: true });
                    render();
                });
            } else if (action === 'remove-user') {
                el.addEventListener('click', function () {
                    var idx = parseInt(el.getAttribute('data-user-idx'));
                    if (customer.users.length > 1) {
                        captureStepState();
                        customer.users.splice(idx, 1);
                        render();
                    }
                });
            } else if (action === 'add-site') {
                el.addEventListener('click', function () {
                    captureStepState();
                    sites.push({
                        estate: sites.length > 0 ? sites[sites.length - 1].estate : '',
                        region: sites.length > 0 ? sites[sites.length - 1].region : '',
                        site: '', tier: 'standard', address: '',
                        lat: '', lon: '', co2Override: '', rateOverride: '',
                        countryCode: '', currencySymbol: '', currencyCode: '',
                        expanded: false, tzOffset: null,
                        city: '', postcode: '', siteCountry: '',
                        _addrResults: [], _addrFetching: false
                    });
                    render();
                });
            } else if (action === 'remove-site') {
                el.addEventListener('click', function () {
                    var idx = parseInt(el.getAttribute('data-idx'));
                    captureStepState();
                    sites.splice(idx, 1);
                    render();
                });
            } else if (action === 'toggle-expand') {
                el.addEventListener('click', function () {
                    var idx = parseInt(el.getAttribute('data-idx'));
                    captureStepState();
                    sites[idx].expanded = !sites[idx].expanded;
                    render();
                });
            } else if (action === 'clear-sites') {
                el.addEventListener('click', function () {
                    sites = [];
                    render();
                });
            } else if (action === 'paste-csv') {
                el.addEventListener('click', function () {
                    var csv = prompt('Paste CSV data (estate, region, site, tier, address):\nOne row per line, comma or tab separated.');
                    if (csv) {
                        captureStepState();
                        var parsed = parseCSV(csv);
                        sites = sites.concat(parsed);
                        render();
                    }
                });
            } else if (action === 'address-search') {
                // Handled via input event below
            } else if (action === 'select-address') {
                el.addEventListener('click', function () {
                    var siteIdx = parseInt(el.getAttribute('data-idx'));
                    var addrIdx = parseInt(el.getAttribute('data-addr-idx'));
                    captureStepState();
                    selectAddress(siteIdx, addrIdx);
                });
            } else if (action === 'add-device') {
                el.addEventListener('click', function () {
                    captureStepState();
                    var defaultProfile = Object.keys(deviceProfiles)[0] || 'default';
                    devices.push({
                        siteName: sites.length > 0 ? sites[0].site : '',
                        deviceName: '',
                        profile: defaultProfile,
                        token: generateToken(),
                        tokenMode: 'auto'
                    });
                    render();
                });
            } else if (action === 'remove-device') {
                el.addEventListener('click', function () {
                    var idx = parseInt(el.getAttribute('data-idx'));
                    captureStepState();
                    devices.splice(idx, 1);
                    render();
                });
            } else if (action === 'auto-generate-devices') {
                el.addEventListener('click', function () {
                    captureStepState();
                    var defaultProfile = Object.keys(deviceProfiles)[0] || 'default';
                    for (var i = 0; i < sites.length; i++) {
                        var devName = slugify(sites[i].site) + '-01';
                        // Check if device already exists for this site
                        var exists = false;
                        for (var j = 0; j < devices.length; j++) {
                            if (devices[j].siteName === sites[i].site) { exists = true; break; }
                        }
                        if (!exists) {
                            // Choose profile based on tier
                            var prof = defaultProfile;
                            var profileNames = Object.keys(deviceProfiles);
                            for (var p = 0; p < profileNames.length; p++) {
                                var pLower = profileNames[p].toLowerCase();
                                if (sites[i].tier === 'plus' && pLower.indexOf('d4i') >= 0) { prof = profileNames[p]; break; }
                                if (sites[i].tier === 'standard' && pLower.indexOf('dali2') >= 0) { prof = profileNames[p]; break; }
                            }
                            devices.push({
                                siteName: sites[i].site,
                                deviceName: devName,
                                profile: prof,
                                token: generateToken(),
                                tokenMode: 'auto'
                            });
                        }
                    }
                    render();
                });
            } else if (action === 'provision-now') {
                el.addEventListener('click', function () {
                    provisionState.plan = buildProvisionPlan();
                    provisionState.currentIndex = 0;
                    provisionState.log = [];
                    provisionState.createdIds = {};
                    provisionState.customerId = null;
                    provisionState.userId = null;
                    provisionState.done = false;
                    provisionState.failed = false;
                    provisionState.error = null;
                    currentStep = 5;
                    render();
                    runProvisionPlan();
                });
            } else if (action === 'retry-step') {
                el.addEventListener('click', function () {
                    provisionState.failed = false;
                    provisionState.error = null;
                    runProvisionPlan();
                });
            } else if (action === 'skip-step') {
                el.addEventListener('click', function () {
                    provisionState.log.push({ type: 'skip', msg: 'Skipped: ' + provisionState.plan[provisionState.currentIndex].label });
                    provisionState.currentIndex++;
                    provisionState.failed = false;
                    provisionState.error = null;
                    runProvisionPlan();
                });
            } else if (action === 'retry-rename') {
                el.addEventListener('click', function () {
                    var input = container.querySelector('[data-field="renameValue"]');
                    var newName = input ? input.value.trim() : '';
                    if (!newName) return;

                    // Update the entity name in the failing step's data
                    var step = provisionState.plan[provisionState.currentIndex];
                    if (step.phase === 'customer') {
                        customer.companyName = newName;
                    } else if (step.phase === 'estate' || step.phase === 'region' || step.phase === 'site') {
                        // Update in sites array + rebuild plan
                        provisionState.plan = buildProvisionPlan();
                    }
                    provisionState.failed = false;
                    provisionState.error = null;
                    provisionState.renameValue = '';
                    render();
                    runProvisionPlan();
                });
            } else if (action === 'goto-fleet') {
                el.addEventListener('click', function () {
                    if (settings.fleetDashboardId) {
                        var url = '/dashboards/' + settings.fleetDashboardId;
                        window.open(url, '_blank');
                    }
                });
            } else if (action === 'reset-wizard') {
                el.addEventListener('click', function () {
                    customer = {
                        companyName: '', contactEmail: '', contactPhone: '',
                        users: [{ email: '', firstName: '', lastName: '', sendActivation: true }]
                    };
                    sites = [];
                    devices = [];
                    provisionState = {
                        running: false, done: false, failed: false,
                        plan: [], currentIndex: 0, log: [],
                        error: null, errorStepIndex: -1,
                        createdIds: {}, customerId: null, userId: null, renameValue: ''
                    };
                    currentStep = 1;
                    render();
                });
            }
        });

        // Input change capture for Step 1 fields
        container.querySelectorAll('[data-field]').forEach(function (inp) {
            inp.addEventListener('input', function () {
                var field = inp.getAttribute('data-field');
                if (field === 'renameValue') {
                    provisionState.renameValue = inp.value;
                } else if (customer.hasOwnProperty(field)) {
                    customer[field] = inp.value;
                }
            });
        });

        // Input change capture for user fields
        container.querySelectorAll('[data-user-field]').forEach(function (inp) {
            var field = inp.getAttribute('data-user-field');
            var idx = parseInt(inp.getAttribute('data-user-idx'));
            inp.addEventListener('input', function () {
                if (idx >= 0 && idx < customer.users.length) {
                    if (field === 'sendActivation') {
                        customer.users[idx][field] = inp.checked;
                    } else {
                        customer.users[idx][field] = inp.value;
                    }
                }
            });
            inp.addEventListener('change', function () {
                if (idx >= 0 && idx < customer.users.length) {
                    if (field === 'sendActivation') {
                        customer.users[idx][field] = inp.checked;
                    } else {
                        customer.users[idx][field] = inp.value;
                    }
                }
            });
        });

        // Input change capture for Step 2 site fields
        container.querySelectorAll('[data-site-field]').forEach(function (inp) {
            var field = inp.getAttribute('data-site-field');
            var idx = parseInt(inp.getAttribute('data-idx'));

            inp.addEventListener('input', function () {
                if (idx >= 0 && idx < sites.length) {
                    sites[idx][field] = inp.value;
                }
            });

            inp.addEventListener('change', function () {
                if (idx >= 0 && idx < sites.length) {
                    sites[idx][field] = inp.value;
                }
            });

            // Address search debounce
            if (field === 'address') {
                inp.addEventListener('input', function () {
                    var query = inp.value.trim();
                    clearTimeout(_owDebounceTimers['addr_' + idx]);
                    _owDebounceTimers['addr_' + idx] = setTimeout(function () {
                        searchAddress(idx, query);
                    }, 350);
                });
            }
        });

        // Input change capture for Step 3 device fields
        container.querySelectorAll('[data-dev-field]').forEach(function (inp) {
            var field = inp.getAttribute('data-dev-field');
            var idx = parseInt(inp.getAttribute('data-idx'));

            inp.addEventListener('input', function () {
                if (idx >= 0 && idx < devices.length) {
                    devices[idx][field] = inp.value;
                }
            });

            inp.addEventListener('change', function () {
                if (idx >= 0 && idx < devices.length) {
                    devices[idx][field] = inp.value;
                }
            });
        });

        // Click-outside dismissal for address suggestion dropdowns
        if (_owAddrOutsideClickFn) {
            document.removeEventListener('click', _owAddrOutsideClickFn, true);
        }
        _owAddrOutsideClickFn = function (e) {
            var wraps = container.querySelectorAll('.ow-suggest-wrap');
            for (var w = 0; w < wraps.length; w++) {
                var list = wraps[w].querySelector('.ow-suggest-list[data-addr-suggest]');
                if (list && !wraps[w].contains(e.target)) {
                    var idx = parseInt(list.getAttribute('data-addr-suggest'));
                    if (idx >= 0 && idx < sites.length && sites[idx]._addrResults && sites[idx]._addrResults.length > 0) {
                        sites[idx]._addrResults = [];
                        _activeAddrIdx = -1;
                        render();
                        return;
                    }
                }
            }
        };
        document.addEventListener('click', _owAddrOutsideClickFn, true);
    }

    // ── Navigation ──────────────────────────────────────────────

    function goToStep(step) {
        // Validate before going forward
        if (step > currentStep) {
            captureStepState();
            var v;
            if (currentStep === 1) {
                v = validateStep1();
                if (!v.valid) { showValidationErrors(v.errors); return; }
            } else if (currentStep === 2) {
                v = validateStep2();
                if (!v.valid) { showValidationErrors(v.errors); return; }
            } else if (currentStep === 3) {
                v = validateStep3();
                if (!v.valid) { showValidationErrors(v.errors); return; }
            }
        }

        currentStep = step;

        // Fetch device profiles when entering step 3
        if (currentStep === 3 && !profilesFetched) {
            fetchDeviceProfiles();
        }

        render();
    }

    function captureStepState() {
        // Step 1: read from DOM
        if (currentStep === 1) {
            container.querySelectorAll('[data-field]').forEach(function (inp) {
                var field = inp.getAttribute('data-field');
                if (customer.hasOwnProperty(field)) {
                    customer[field] = inp.value;
                }
            });
            container.querySelectorAll('[data-user-field]').forEach(function (inp) {
                var field = inp.getAttribute('data-user-field');
                var idx = parseInt(inp.getAttribute('data-user-idx'));
                if (idx >= 0 && idx < customer.users.length) {
                    if (field === 'sendActivation') {
                        customer.users[idx][field] = inp.checked;
                    } else {
                        customer.users[idx][field] = inp.value;
                    }
                }
            });
        }
        // Steps 2 and 3: already captured via input events
    }

    function showValidationErrors(errors) {
        // Insert error block at top of card
        var card = container.querySelector('.ow-card');
        if (!card) return;
        var existing = card.querySelector('.ow-errors');
        if (existing) existing.remove();

        var html = '<ul class="ow-errors">';
        for (var i = 0; i < errors.length; i++) {
            html += '<li>' + esc(errors[i]) + '</li>';
        }
        html += '</ul>';

        card.insertAdjacentHTML('afterbegin', html);

        // Scroll to top
        container.scrollTop = 0;
    }

    // ── Lifecycle ───────────────────────────────────────────────

    // Initial render
    render();
};

self.onDataUpdated = function () {
    // Static widget — no telemetry data
};

self.onDestroy = function () {
    // Clear debounce timers
    var keys = Object.keys(_owDebounceTimers);
    for (var i = 0; i < keys.length; i++) {
        clearTimeout(_owDebounceTimers[keys[i]]);
    }
    _owDebounceTimers = {};
    // Remove click-outside listener for address suggestions
    if (_owAddrOutsideClickFn) {
        document.removeEventListener('click', _owAddrOutsideClickFn, true);
        _owAddrOutsideClickFn = null;
    }
};
