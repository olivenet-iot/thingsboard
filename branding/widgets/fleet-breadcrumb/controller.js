// Fleet Breadcrumb — Controller
// Widget type: static
// Reads state from URL hash (TB encodes state as base64 JSON array in hash)

self.onInit = function() {
    self.$container = self.ctx.$container;
    self.trailEl = self.$container.find('#breadcrumb-trail');
    self.backEl = self.$container.find('#breadcrumb-back');

    self.buildBreadcrumb();

    self.backEl.on('click', function() {
        self.goBack();
    });
};

self.buildBreadcrumb = function() {
    // Parse state hierarchy from URL hash
    var stateArray = self.parseStateFromUrl();
    var crumbs = [];

    if (!stateArray || stateArray.length === 0 || (stateArray.length === 1 && stateArray[0].id === 'default')) {
        // HOME
        crumbs.push({ label: 'Fleet Overview', action: null, current: true });
    } else {
        // Always start with Fleet → HOME
        crumbs.push({ label: 'Fleet', action: 'home', current: false });

        for (var i = 0; i < stateArray.length; i++) {
            var entry = stateArray[i];
            if (entry.id === 'default') continue;

            var name = '';
            if (entry.params && entry.params.entityName) {
                name = entry.params.entityName;
            } else {
                name = entry.id.charAt(0).toUpperCase() + entry.id.slice(1);
            }

            var isLast = (i === stateArray.length - 1);
            crumbs.push({
                label: name,
                action: isLast ? null : ('go_' + i),
                stateIndex: i,
                current: isLast
            });
        }
    }

    // Store state array for navigation
    self.stateArray = stateArray || [];

    // Render
    var html = '';
    crumbs.forEach(function(crumb, i) {
        if (i > 0) {
            html += '<span class="crumb-sep">›</span>';
        }
        if (crumb.current) {
            html += '<span class="crumb crumb-current">' + self.escapeHtml(crumb.label) + '</span>';
        } else {
            html += '<span class="crumb" data-action="' + (crumb.action || '') + '">' + self.escapeHtml(crumb.label) + '</span>';
        }
    });

    self.trailEl.html(html);

    // Show/hide back
    var stateId = self.getCurrentStateId();
    if (stateId && stateId !== 'default') {
        self.backEl.show();
    } else {
        self.backEl.hide();
    }

    // Bind clicks
    self.trailEl.find('.crumb:not(.crumb-current)').on('click', function() {
        var action = $(this).data('action');
        if (action === 'home') {
            self.ctx.stateController.updateState('default', null);
        } else if (action && action.indexOf('go_') === 0) {
            var idx = parseInt(action.replace('go_', ''));
            self.navigateToIndex(idx);
        }
    });
};

self.parseStateFromUrl = function() {
    try {
        var hash = window.location.hash;
        if (!hash || hash.length < 2) return null;

        // TB stores state as: #state=base64encodedJSON
        var stateParam = null;

        if (hash.indexOf('state=') !== -1) {
            var parts = hash.substring(1).split('&');
            for (var i = 0; i < parts.length; i++) {
                if (parts[i].indexOf('state=') === 0) {
                    stateParam = parts[i].substring(6);
                    break;
                }
            }
        }

        if (!stateParam) return null;

        // Decode base64 → JSON
        var decoded = decodeURIComponent(stateParam);
        var json = atob(decoded);
        var stateArray = JSON.parse(json);

        return Array.isArray(stateArray) ? stateArray : [stateArray];
    } catch (e) {
        return null;
    }
};

self.getCurrentStateId = function() {
    try {
        return self.ctx.stateController.getStateId();
    } catch (e) {
        return 'default';
    }
};

self.navigateToIndex = function(targetIndex) {
    if (!self.stateArray || targetIndex >= self.stateArray.length) {
        self.ctx.stateController.updateState('default', null);
        return;
    }

    var target = self.stateArray[targetIndex];
    if (target && target.id) {
        self.ctx.stateController.updateState(target.id, target.params || null);
    }
};

self.goBack = function() {
    var stateId = self.getCurrentStateId();

    if (stateId === 'region') {
        // Try to go back to estate
        if (self.stateArray) {
            for (var i = 0; i < self.stateArray.length; i++) {
                if (self.stateArray[i].id === 'estate') {
                    self.ctx.stateController.updateState('estate', self.stateArray[i].params);
                    return;
                }
            }
        }
        self.ctx.stateController.updateState('default', null);
    } else if (stateId === 'estate') {
        self.ctx.stateController.updateState('default', null);
    } else {
        self.ctx.stateController.updateState('default', null);
    }
};

self.escapeHtml = function(text) {
    if (!text) return '';
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
};

self.onDataUpdated = function() {};
self.onResize = function() {};

self.onDestroy = function() {
    self.trailEl.find('.crumb').off('click');
    self.backEl.off('click');
};
