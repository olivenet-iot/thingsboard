// Fleet Breadcrumb — Controller
// Widget type: static
// No datasource needed — reads state from stateController

self.onInit = function() {
    self.$container = self.ctx.$container;
    self.trailEl = self.$container.find('#breadcrumb-trail');
    self.backEl = self.$container.find('#breadcrumb-back');

    self.buildBreadcrumb();

    // Back button click
    self.backEl.on('click', function() {
        self.goBack();
    });
};

self.buildBreadcrumb = function() {
    var stateCtrl = self.ctx.stateController;
    var stateId = stateCtrl.getStateId();
    var stateParams = stateCtrl.getStateParams();

    // Determine current state and entity names from state params
    // TB stores state hierarchy — we build crumbs from it
    var stateObject = stateCtrl.getStateObject();

    var crumbs = [];
    var backTarget = null;

    if (stateId === 'default' || !stateId) {
        // HOME — just show title, no back
        crumbs.push({ label: 'Fleet Overview', state: null, current: true });
    } else if (stateId === 'estate') {
        var entityName = self.getEntityName(stateParams) || 'Estate';
        crumbs.push({ label: 'Fleet', state: 'default', current: false });
        crumbs.push({ label: entityName, state: null, current: true });
        backTarget = 'default';
    } else if (stateId === 'region') {
        var entityName = self.getEntityName(stateParams) || 'Region';

        crumbs.push({ label: 'Fleet', state: 'default', current: false });

        // Try to get parent estate name from state history
        var parentName = self.getParentName(stateObject);
        if (parentName) {
            crumbs.push({ label: parentName, state: 'estate_back', current: false });
        }

        crumbs.push({ label: entityName, state: null, current: true });
        backTarget = 'estate_back';
    }

    // Render breadcrumb trail
    var html = '';
    crumbs.forEach(function(crumb, i) {
        if (i > 0) {
            html += '<span class="crumb-sep">›</span>';
        }
        if (crumb.current) {
            html += '<span class="crumb crumb-current">' + self.escapeHtml(crumb.label) + '</span>';
        } else {
            html += '<span class="crumb" data-state="' + (crumb.state || '') + '">' + self.escapeHtml(crumb.label) + '</span>';
        }
    });

    self.trailEl.html(html);

    // Show/hide back button
    if (stateId && stateId !== 'default') {
        self.backEl.show();
    } else {
        self.backEl.hide();
    }

    // Bind crumb clicks
    self.trailEl.find('.crumb:not(.crumb-current)').on('click', function() {
        var targetState = $(this).data('state');
        self.navigateTo(targetState);
    });
};

self.getEntityName = function(stateParams) {
    // stateParams might have different structures depending on TB version
    if (!stateParams) return null;

    // Try direct entityName
    if (stateParams.entityName) return stateParams.entityName;

    // Try nested structure
    if (stateParams[0] && stateParams[0].entityName) return stateParams[0].entityName;

    return null;
};

self.getParentName = function(stateObject) {
    // Try to extract parent estate name from state history
    // stateObject is an array of state entries in TB
    if (!stateObject || !Array.isArray(stateObject)) return null;

    // Look for estate entry (index 1 typically - 0=default, 1=estate, 2=region)
    for (var i = 0; i < stateObject.length; i++) {
        var entry = stateObject[i];
        if (entry && entry.id === 'estate' && entry.params && entry.params.entityName) {
            return entry.params.entityName;
        }
    }

    return null;
};

self.navigateTo = function(targetState) {
    var stateCtrl = self.ctx.stateController;
    var stateObject = stateCtrl.getStateObject();

    if (targetState === 'default') {
        // Go to HOME
        stateCtrl.updateState('default', null);
    } else if (targetState === 'estate_back') {
        // Go back to estate — need to find estate params from state history
        if (stateObject && Array.isArray(stateObject)) {
            for (var i = 0; i < stateObject.length; i++) {
                if (stateObject[i] && stateObject[i].id === 'estate') {
                    stateCtrl.updateState('estate', stateObject[i].params);
                    return;
                }
            }
        }
        // Fallback — just go home
        stateCtrl.updateState('default', null);
    }
};

self.goBack = function() {
    var stateCtrl = self.ctx.stateController;
    var stateId = stateCtrl.getStateId();

    if (stateId === 'region') {
        // Go back to estate
        self.navigateTo('estate_back');
    } else if (stateId === 'estate') {
        // Go back to home
        self.navigateTo('default');
    }
};

self.escapeHtml = function(text) {
    if (!text) return '';
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
};

self.onDataUpdated = function() {
    // Rebuild on data updates (state changes trigger this)
    self.buildBreadcrumb();
};

self.onResize = function() {};

self.onDestroy = function() {
    self.trailEl.find('.crumb').off('click');
    self.backEl.off('click');
};
