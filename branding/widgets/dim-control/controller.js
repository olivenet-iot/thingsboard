/* =========================================================
   DIM CONTROL WIDGET — controller.js
   ThingsBoard CE Custom Widget (static type)
   
   Reads:  dim_value (telemetry) + status_lamp_on (telemetry)
   Writes: dimLevel (SHARED_SCOPE attribute) → bridge → TTN downlink
   ========================================================= */

self.onInit = function () {
    'use strict';

    // ── Resolve Device ID ─────────────────────────────────────────
    var DEVICE_ID = null;
    var ds = self.ctx.datasources;

    console.log('[DIM] onInit started');
    console.log('[DIM] datasources:', JSON.stringify(ds));
    console.log('[DIM] settings:', JSON.stringify(self.ctx.settings));

    // Try entity alias from datasource
    if (ds && ds.length > 0 && ds[0].entity) {
        DEVICE_ID = ds[0].entity.id;
    }

    // Fallback: widget settings
    if (!DEVICE_ID && self.ctx.settings && self.ctx.settings.deviceId) {
        DEVICE_ID = self.ctx.settings.deviceId;
    }

    console.log('[DIM] DEVICE_ID:', DEVICE_ID);

    if (!DEVICE_ID) {
        showToast('No device configured', 'error');
        console.error('[DIM] No device ID — widget cannot operate.');
        return;
    }

    // ── State ─────────────────────────────────────────────────────
    var http = self.ctx.http;
    var currentDimValue = null;   // last known dim from telemetry
    var isLampOn = false;
    var pendingValue = null;      // value awaiting confirmation
    var pollTimer = null;
    var toastTimer = null;
    var isSliderDragging = false;

    var POLL_MS = (self.ctx.settings && self.ctx.settings.pollIntervalMs)
        ? self.ctx.settings.pollIntervalMs
        : 10000;

    // ── DOM refs ──────────────────────────────────────────────────
    var elValue       = document.getElementById('dim-current-value');
    var elSlider      = document.getElementById('dim-slider');
    var elRingFill    = document.getElementById('dim-ring-fill');
    var elLampDot     = document.getElementById('dim-lamp-dot');
    var elStatus      = document.getElementById('dim-header-status');
    var elBtnOn       = document.getElementById('dim-btn-on');
    var elBtnOff      = document.getElementById('dim-btn-off');
    var elLastCmd     = document.getElementById('dim-last-cmd');
    var elOverlay     = document.getElementById('dim-confirm-overlay');
    var elConfirmText = document.getElementById('dim-confirm-text');
    var elConfirmTitle = document.getElementById('dim-confirm-title');
    var elConfirmIcon = document.getElementById('dim-confirm-icon');
    var elConfirmBtn  = document.getElementById('dim-confirm-btn');

    // Ring gauge circumference: 2 * π * 52 ≈ 326.73
    var RING_CIRC = 326.73;

    // ── Display helpers ───────────────────────────────────────────

    function updateDisplay(dimVal) {
        if (dimVal === null || dimVal === undefined) return;

        var val = Math.max(0, Math.min(100, parseInt(dimVal)));

        // Value text
        elValue.textContent = val;

        // Ring gauge
        var offset = RING_CIRC - (RING_CIRC * val / 100);
        elRingFill.style.strokeDashoffset = offset;
        if (val === 0) {
            elRingFill.classList.add('is-off');
        } else {
            elRingFill.classList.remove('is-off');
        }

        // Slider (only update if user is not dragging)
        if (!isSliderDragging) {
            elSlider.value = val;
            updateSliderTrack(val);
        }

        // Button active states
        if (val === 0) {
            elBtnOff.classList.add('is-active');
            elBtnOn.classList.remove('is-active');
        } else if (val === 100) {
            elBtnOff.classList.remove('is-active');
            elBtnOn.classList.add('is-active');
        } else {
            elBtnOff.classList.remove('is-active');
            elBtnOn.classList.remove('is-active');
        }
    }

    function updateLampStatus(on) {
        isLampOn = on;
        if (on) {
            elLampDot.classList.add('is-on');
            elLampDot.classList.remove('is-off');
            elStatus.textContent = 'LAMP ON';
            elStatus.style.color = '#d97706';
            elStatus.style.background = '#fef3c7';
        } else {
            elLampDot.classList.remove('is-on');
            elLampDot.classList.add('is-off');
            elStatus.textContent = 'LAMP OFF';
            elStatus.style.color = '#64748b';
            elStatus.style.background = '#f1f5f9';
        }
    }

    function updateSliderTrack(val) {
        // Fill the slider track up to the thumb position
        var pct = val + '%';
        elSlider.style.background = 'linear-gradient(to right, #f59e0b 0%, #f59e0b '
            + pct + ', #e2e8f0 ' + pct + ', #e2e8f0 100%)';
    }

    function showToast(msg, type) {
        var el = document.getElementById('dim-toast');
        if (!el) return;
        el.textContent = msg;
        el.className = 'dim-toast ' + (type || 'info');
        el.style.display = 'block';
        if (toastTimer) clearTimeout(toastTimer);
        toastTimer = setTimeout(function () {
            el.style.display = 'none';
        }, 3000);
    }

    // ── Telemetry Polling ─────────────────────────────────────────

    function poll() {
        var url = '/api/plugins/telemetry/DEVICE/' + DEVICE_ID
            + '/values/timeseries?keys=dim_value,status_lamp_on';

        http.get(url).toPromise().then(function (resp) {
            // dim_value
            if (resp.dim_value && resp.dim_value.length > 0) {
                var newVal = parseInt(resp.dim_value[0].value);
                if (!isNaN(newVal) && newVal !== currentDimValue) {
                    currentDimValue = newVal;
                    updateDisplay(currentDimValue);
                }
            }
            // status_lamp_on
            if (resp.status_lamp_on && resp.status_lamp_on.length > 0) {
                var raw = resp.status_lamp_on[0].value;
                var on = (raw === true || raw === 'true' || raw === '1');
                updateLampStatus(on);
            }
        }).catch(function (err) {
            console.warn('[DIM] Poll error:', err);
        });
    }

    // ── Confirm Dialog ────────────────────────────────────────────

    function showConfirm(value) {
        pendingValue = value;

        if (value === 0) {
            elConfirmTitle.textContent = 'Turn Off';
            elConfirmText.textContent = 'Switch the light OFF?';
            elConfirmIcon.classList.add('is-off');
            elConfirmBtn.classList.add('is-off');
        } else if (value === 100) {
            elConfirmTitle.textContent = 'Turn On';
            elConfirmText.textContent = 'Switch the light ON (100%)?';
            elConfirmIcon.classList.remove('is-off');
            elConfirmBtn.classList.remove('is-off');
        } else {
            elConfirmTitle.textContent = 'Set Dim Level';
            elConfirmText.textContent = 'Set brightness to ' + value + '%?';
            elConfirmIcon.classList.remove('is-off');
            elConfirmBtn.classList.remove('is-off');
        }

        elOverlay.style.display = 'flex';
    }

    function hideConfirm() {
        elOverlay.style.display = 'none';
        pendingValue = null;
    }

    function sendDimCommand(value) {
        var url = '/api/plugins/telemetry/DEVICE/' + DEVICE_ID + '/SHARED_SCOPE';
        var payload = { dimLevel: value };

        console.log('[DIM] Sending command:', payload);

        http.post(url, payload).toPromise().then(function () {
            showToast('Command sent: ' + value + '%', 'success');
            elLastCmd.textContent = 'Last: ' + value + '% at '
                + new Date().toLocaleTimeString();
            // Optimistic update
            currentDimValue = value;
            updateDisplay(value);
            if (value > 0) {
                updateLampStatus(true);
            }
        }).catch(function (err) {
            showToast('Command failed!', 'error');
            console.error('[DIM] Send error:', err);
            // Revert slider to last known value
            if (currentDimValue !== null) {
                updateDisplay(currentDimValue);
            }
        });
    }

    // ── Public API (accessible from onclick handlers) ─────────────

    window.DIM_CTRL = {
        setDim: function (value) {
            showConfirm(value);
        },

        onSliderInput: function () {
            // Live preview while dragging (no command yet)
            isSliderDragging = true;
            var val = parseInt(elSlider.value);
            elValue.textContent = val;
            updateSliderTrack(val);

            // Update ring gauge preview
            var offset = RING_CIRC - (RING_CIRC * val / 100);
            elRingFill.style.strokeDashoffset = offset;
        },

        onSliderCommit: function () {
            // User released the slider → ask for confirmation
            isSliderDragging = false;
            var val = parseInt(elSlider.value);

            // Only confirm if value actually changed
            if (val !== currentDimValue) {
                showConfirm(val);
            }
        },

        cancelConfirm: function () {
            hideConfirm();
            // Revert display to actual device value
            if (currentDimValue !== null) {
                updateDisplay(currentDimValue);
            }
        },

        executeConfirm: function () {
            var val = pendingValue;
            hideConfirm();
            if (val !== null) {
                sendDimCommand(val);
            }
        }
    };

    console.log('[DIM] DIM_CTRL created on window');

    // ── Initialize ────────────────────────────────────────────────
    updateDisplay(0);
    updateLampStatus(false);

    // Initial poll
    poll();

    // Start periodic polling
    pollTimer = setInterval(poll, POLL_MS);

    // Store timer ref for cleanup
    self._dimPollTimer = pollTimer;
    self._dimToastTimer = toastTimer;
};

// ── Lifecycle ─────────────────────────────────────────────────────

self.onDataUpdated = function () {
    // For static widget type, this may not fire.
    // We use our own polling instead.
};

self.onDestroy = function () {
    console.log('[DIM] onDestroy');
    if (self._dimPollTimer) clearInterval(self._dimPollTimer);
    if (self._dimToastTimer) clearTimeout(self._dimToastTimer);
    if (window.DIM_CTRL) delete window.DIM_CTRL;
};
