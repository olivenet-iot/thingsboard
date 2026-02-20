// ═══════════════════════════════════════════════════════════════
// SignConnect — Report Manager Widget (controller.js)
// ═══════════════════════════════════════════════════════════════
// Static widget — no TB datasource. Communicates with the
// reports-service Python backend via fetch() and uses
// self.ctx.http for TB API calls.
// ═══════════════════════════════════════════════════════════════

self.onInit = function () {
    'use strict';

    var $root = self.ctx.$container[0];
    var container = $root.querySelector('.rpt-root');
    if (!container) {
        $root.innerHTML = '<div class="rpt-root"></div>';
        container = $root.querySelector('.rpt-root');
    }

    var http = self.ctx.http;
    var settings = self.ctx.settings || {};
    var reportsApiUrl = settings.reportsApiUrl || 'http://46.225.54.21:5000';
    var defaultSections = settings.defaultSections || 'energy,co2,faults,summary';
    var maxHistoryItems = settings.maxHistoryItems || 10;

    // ── API Helpers ───────────────────────────────────────────

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

    function fetchApi(url, options) {
        options = options || {};
        options.headers = options.headers || {};
        options.headers['Content-Type'] = options.headers['Content-Type'] || 'application/json';
        return fetch(url, options).then(function (resp) {
            if (!resp.ok) throw new Error('HTTP ' + resp.status);
            return resp.json();
        });
    }

    // ── Back Button Navigation ────────────────────────────────

    var backBtn = container.querySelector('[data-action="back"]');
    if (backBtn) {
        backBtn.addEventListener('click', function () {
            try {
                self.ctx.stateController.openState('default', {});
            } catch (e) {
                console.error('[REPORT] Failed to navigate back:', e);
            }
        });
    }

    // ── DOM References ──────────────────────────────────────────

    var loadingEl = container.querySelector('.rpt-loading');
    var mainEl = container.querySelector('.rpt-main');
    var levelSelect = container.querySelector('#rpt-level');
    var estateSelect = container.querySelector('#rpt-estate');
    var regionSelect = container.querySelector('#rpt-region');
    var siteSelect = container.querySelector('#rpt-site');
    var estateRow = container.querySelector('#rpt-estate-row');
    var regionRow = container.querySelector('#rpt-region-row');
    var siteRow = container.querySelector('#rpt-site-row');
    var estateLoading = container.querySelector('#rpt-estate-loading');
    var regionLoading = container.querySelector('#rpt-region-loading');
    var siteLoading = container.querySelector('#rpt-site-loading');

    // ── State ───────────────────────────────────────────────────

    var customerId = settings.customerId || '6e1b23e0-fc24-11f0-999c-9b8fab55435e';
    var estates = [];
    var regions = [];
    var sites = [];
    var selectedLevel = 'estate';
    var selectedEstateId = null;
    var selectedRegionId = null;
    var selectedSiteId = null;

    // ── Helpers ─────────────────────────────────────────────────

    function populateSelect(selectEl, items, placeholder) {
        selectEl.innerHTML = '';
        var opt = document.createElement('option');
        opt.value = '';
        opt.textContent = placeholder;
        selectEl.appendChild(opt);
        items.forEach(function (item) {
            var o = document.createElement('option');
            o.value = item.id;
            o.textContent = item.name;
            selectEl.appendChild(o);
        });
    }

    function toggleLoading(el, show) {
        if (!el) return;
        if (show) {
            el.classList.remove('rpt-hidden');
        } else {
            el.classList.add('rpt-hidden');
        }
    }

    function updateVisibility() {
        if (regionRow) {
            if (selectedLevel === 'region' || selectedLevel === 'site') {
                regionRow.classList.remove('rpt-hidden');
            } else {
                regionRow.classList.add('rpt-hidden');
            }
        }
        if (siteRow) {
            if (selectedLevel === 'site') {
                siteRow.classList.remove('rpt-hidden');
            } else {
                siteRow.classList.add('rpt-hidden');
            }
        }
    }

    function getSelectedScope() {
        if (selectedLevel === 'site' && selectedSiteId) {
            return { entityId: selectedSiteId, entityType: 'ASSET' };
        }
        if (selectedLevel === 'region' && selectedRegionId) {
            return { entityId: selectedRegionId, entityType: 'ASSET' };
        }
        if (selectedEstateId) {
            return { entityId: selectedEstateId, entityType: 'ASSET' };
        }
        return null;
    }

    // ── Hierarchy Loaders ───────────────────────────────────────

    function loadEstates() {
        toggleLoading(estateLoading, true);
        return apiGet('/customer/' + customerId + '/assets?pageSize=100&page=0')
            .then(function (resp) {
                var data = resp.data || resp;
                estates = [];
                (Array.isArray(data) ? data : []).forEach(function (a) {
                    if (a.type && a.type.toLowerCase() === 'estate') {
                        estates.push({ id: a.id.id, name: a.name });
                    }
                });
                estates.sort(function (a, b) { return a.name.localeCompare(b.name); });
                populateSelect(estateSelect, estates, '\u2014 Select estate \u2014');
                if (estates.length > 0) {
                    estateSelect.value = estates[0].id;
                    selectedEstateId = estates[0].id;
                }
            })
            .catch(function (err) {
                console.error('[REPORT] Failed to load estates:', err);
                populateSelect(estateSelect, [], '\u2014 Error loading \u2014');
            })
            .then(function () {
                toggleLoading(estateLoading, false);
            });
    }

    function loadChildren(parentId, typeFilter) {
        return apiGet('/relations?fromId=' + parentId + '&fromType=ASSET&relationType=Contains')
            .then(function (rels) {
                var assetIds = [];
                (Array.isArray(rels) ? rels : []).forEach(function (r) {
                    if (r.to && r.to.entityType === 'ASSET') {
                        assetIds.push(r.to.id);
                    }
                });
                if (assetIds.length === 0) return [];
                var promises = assetIds.map(function (id) {
                    return apiGet('/asset/' + id).catch(function () { return null; });
                });
                return Promise.all(promises).then(function (assets) {
                    var result = [];
                    assets.forEach(function (a) {
                        if (!a) return;
                        var t = (a.type || '').toLowerCase();
                        if (t.indexOf(typeFilter) !== -1) {
                            result.push({ id: a.id.id, name: a.name });
                        }
                    });
                    result.sort(function (a, b) { return a.name.localeCompare(b.name); });
                    return result;
                });
            });
    }

    function loadRegions(estateId) {
        regions = [];
        populateSelect(regionSelect, [], '\u2014 Loading... \u2014');
        toggleLoading(regionLoading, true);
        return loadChildren(estateId, 'region')
            .then(function (result) {
                regions = result;
                populateSelect(regionSelect, regions, '\u2014 Select region \u2014');
                if (regions.length > 0) {
                    regionSelect.value = regions[0].id;
                    selectedRegionId = regions[0].id;
                }
            })
            .catch(function (err) {
                console.error('[REPORT] Failed to load regions:', err);
                populateSelect(regionSelect, [], '\u2014 Error loading \u2014');
            })
            .then(function () {
                toggleLoading(regionLoading, false);
            });
    }

    function loadSites(regionId) {
        sites = [];
        populateSelect(siteSelect, [], '\u2014 Loading... \u2014');
        toggleLoading(siteLoading, true);
        return loadChildren(regionId, 'site')
            .then(function (result) {
                sites = result;
                populateSelect(siteSelect, sites, '\u2014 Select site \u2014');
                if (sites.length > 0) {
                    siteSelect.value = sites[0].id;
                    selectedSiteId = sites[0].id;
                }
            })
            .catch(function (err) {
                console.error('[REPORT] Failed to load sites:', err);
                populateSelect(siteSelect, [], '\u2014 Error loading \u2014');
            })
            .then(function () {
                toggleLoading(siteLoading, false);
            });
    }

    // ── Event Handlers ──────────────────────────────────────────

    if (levelSelect) {
        levelSelect.addEventListener('change', function () {
            selectedLevel = levelSelect.value;
            updateVisibility();
            // Reset dependent selections
            selectedRegionId = null;
            selectedSiteId = null;
            populateSelect(regionSelect, [], '\u2014 Select region \u2014');
            populateSelect(siteSelect, [], '\u2014 Select site \u2014');
            // Load children if estate selected
            if (selectedEstateId && (selectedLevel === 'region' || selectedLevel === 'site')) {
                loadRegions(selectedEstateId).then(function () {
                    if (selectedLevel === 'site' && selectedRegionId) {
                        loadSites(selectedRegionId);
                    }
                });
            }
        });
    }

    if (estateSelect) {
        estateSelect.addEventListener('change', function () {
            selectedEstateId = estateSelect.value || null;
            selectedRegionId = null;
            selectedSiteId = null;
            populateSelect(regionSelect, [], '\u2014 Select region \u2014');
            populateSelect(siteSelect, [], '\u2014 Select site \u2014');
            if (selectedEstateId && (selectedLevel === 'region' || selectedLevel === 'site')) {
                loadRegions(selectedEstateId).then(function () {
                    if (selectedLevel === 'site' && selectedRegionId) {
                        loadSites(selectedRegionId);
                    }
                });
            }
        });
    }

    if (regionSelect) {
        regionSelect.addEventListener('change', function () {
            selectedRegionId = regionSelect.value || null;
            selectedSiteId = null;
            populateSelect(siteSelect, [], '\u2014 Select site \u2014');
            if (selectedRegionId && selectedLevel === 'site') {
                loadSites(selectedRegionId);
            }
        });
    }

    if (siteSelect) {
        siteSelect.addEventListener('change', function () {
            selectedSiteId = siteSelect.value || null;
        });
    }

    // ── Init: Load Estates & Show Content ───────────────────────

    updateVisibility();
    loadEstates().then(function () {
        if (loadingEl) loadingEl.style.display = 'none';
        if (mainEl) mainEl.style.display = 'block';
        // If starting at region/site level, load children of first estate
        if (selectedEstateId && (selectedLevel === 'region' || selectedLevel === 'site')) {
            loadRegions(selectedEstateId).then(function () {
                if (selectedLevel === 'site' && selectedRegionId) {
                    loadSites(selectedRegionId);
                }
            });
        }
        console.log('[REPORT] Widget initialized. API:', reportsApiUrl, 'Customer:', customerId);
    });
};

self.onDataUpdated = function () {
    // Static widget — no datasource updates to handle
};

self.onDestroy = function () {
    // Cleanup if needed in future steps
};
