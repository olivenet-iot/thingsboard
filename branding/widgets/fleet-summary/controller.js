// Fleet Summary Cards — Controller
// Widget type: latest
// Datasource: entity alias returning devices (all_devices or descendant_devices)
// Required datasource keys: dim_value + 21 canonical fault/warning keys (see deploy.py)
//
// NOTE: This widget is datasource-driven — it reads fault keys from the entity alias
// subscription, not from direct API calls. For full fault coverage, the datasource
// entity alias must include ALL 21 canonical fault/warning keys:
//   fault_overall_failure, fault_under_voltage, fault_over_voltage, fault_power_limit,
//   fault_thermal_derating, fault_thermal_shutdown, fault_light_src_failure,
//   fault_light_src_short_circuit, fault_light_src_thermal_derate,
//   fault_light_src_thermal_shutdn, fault_input_power, fault_current_limited,
//   fault_driver_failure, fault_external, fault_d4i_power_exceeded, fault_overcurrent,
//   status_control_gear_failure, status_lamp_failure,
//   status_limit_error, status_reset_state, status_missing_short_addr

// All 21 canonical fault/warning keys
var FAULT_WARNING_KEYS = {
    'fault_overall_failure': true, 'fault_under_voltage': true, 'fault_over_voltage': true,
    'fault_power_limit': true, 'fault_thermal_derating': true, 'fault_thermal_shutdown': true,
    'fault_light_src_failure': true, 'fault_light_src_short_circuit': true,
    'fault_light_src_thermal_derate': true, 'fault_light_src_thermal_shutdn': true,
    'fault_input_power': true, 'fault_current_limited': true, 'fault_driver_failure': true,
    'fault_external': true, 'fault_d4i_power_exceeded': true, 'fault_overcurrent': true,
    'status_control_gear_failure': true, 'status_lamp_failure': true,
    'status_limit_error': true, 'status_reset_state': true, 'status_missing_short_addr': true
};

function isFault(val) {
    if (val === undefined || val === null) return false;
    return val === 'true' || val === true || val === '1' || val === 1;
}

self.onInit = function() {
    self.$container = self.ctx.$container;

    // Settings with defaults
    self.settings = {
        onlineThresholdMinutes: self.ctx.settings.onlineThresholdMinutes || 10,
        label: self.ctx.settings.label || 'Devices'
    };
    
    // Cache DOM elements
    self.elements = {
        total: self.$container.find('#value-total'),
        online: self.$container.find('#value-online'),
        offline: self.$container.find('#value-offline'),
        faults: self.$container.find('#value-faults'),
        subTotal: self.$container.find('#sub-total'),
        subOnline: self.$container.find('#sub-online'),
        subOffline: self.$container.find('#sub-offline'),
        subFaults: self.$container.find('#sub-faults'),
        dotFault: self.$container.find('#dot-fault'),
        cards: self.$container.find('.summary-card')
    };
    
    // Set label text
    self.$container.find('#card-total .label-text').text('Total ' + self.settings.label);
    
    // Show loading state
    self.elements.cards.addClass('loading');
    
    // Initial render
    self.updateDisplay(0, 0, 0, 0);
};

self.onDataUpdated = function() {
    var data = self.ctx.data;
    
    if (!data || data.length === 0) {
        self.updateDisplay(0, 0, 0, 0);
        return;
    }
    
    // Group data by device entity ID
    var devices = {};
    
    data.forEach(function(item) {
        if (!item.datasource || !item.datasource.entityId) return;
        
        var entityId = item.datasource.entityId;
        
        if (!devices[entityId]) {
            devices[entityId] = {
                name: item.datasource.entityName || 'Unknown',
                entityType: item.datasource.entityType || 'DEVICE',
                lastTs: 0,
                fault: false,
                hasFaultKey: false
            };
        }
        
        var device = devices[entityId];
        
        // Extract latest timestamp from any key
        if (item.data && item.data.length > 0) {
            var ts = item.data[item.data.length - 1][0];
            if (ts > device.lastTs) {
                device.lastTs = ts;
            }
        }
        
        // Check fault/warning status across all canonical keys
        if (item.dataKey && FAULT_WARNING_KEYS[item.dataKey.name]) {
            device.hasFaultKey = true;
            if (item.data && item.data.length > 0) {
                var val = item.data[item.data.length - 1][1];
                if (isFault(val)) {
                    device.fault = true;
                }
            }
        }
    });
    
    // Calculate counts
    var now = Date.now();
    var thresholdMs = self.settings.onlineThresholdMinutes * 60 * 1000;
    
    var total = 0;
    var online = 0;
    var offline = 0;
    var faults = 0;
    
    Object.keys(devices).forEach(function(id) {
        var device = devices[id];
        
        // Only count DEVICE entities (skip any assets that might be in datasource)
        if (device.entityType !== 'DEVICE') return;
        
        total++;
        
        // Online/offline determination
        if (device.lastTs > 0 && (now - device.lastTs) < thresholdMs) {
            online++;
        } else {
            offline++;
        }
        
        // Fault count
        if (device.fault) {
            faults++;
        }
    });
    
    // Remove loading state
    self.elements.cards.removeClass('loading');
    
    self.updateDisplay(total, online, offline, faults);
};

self.updateDisplay = function(total, online, offline, faults) {
    // Update values
    self.elements.total.text(total);
    self.elements.online.text(online);
    self.elements.offline.text(offline);
    self.elements.faults.text(faults);
    
    // Update subtitles
    if (total > 0) {
        self.elements.subTotal.text(online + ' active now');
        self.elements.subOnline.text(total > 0 ? Math.round(online / total * 100) + '%' : '');
        self.elements.subOffline.text(offline > 0 ? offline + ' ' + (offline === 1 ? 'device' : 'devices') + ' unreachable' : 'All connected');
        self.elements.subFaults.text(faults > 0 ? faults + ' need' + (faults === 1 ? 's' : '') + ' attention' : 'All healthy');
    } else {
        self.elements.subTotal.text('No devices found');
        self.elements.subOnline.text('');
        self.elements.subOffline.text('');
        self.elements.subFaults.text('');
    }
    
    // Pulse fault dot if faults > 0
    if (faults > 0) {
        self.elements.dotFault.addClass('pulsing');
    } else {
        self.elements.dotFault.removeClass('pulsing');
    }
    
    // Update offline value color — show emerald "0" when all online
    if (offline === 0) {
        self.elements.offline.css('color', '#059669');
    } else {
        self.elements.offline.css('color', '#94a3b8');
    }
    
    // Update faults value color
    if (faults === 0) {
        self.elements.faults.css('color', '#059669');
    } else {
        self.elements.faults.css('color', '#ef4444');
    }
};

self.onResize = function() {
    // Grid handles responsive via CSS
};

self.onDestroy = function() {
    // Cleanup
};
