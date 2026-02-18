/* =========================================================
   DIM CONTROL WIDGET — controller.js
   ThingsBoard CE Custom Widget (static type)

   Reads:  dim_value (telemetry) + status_lamp_on (telemetry)
   Writes: dimLevel (SHARED_SCOPE attribute) → bridge → TTN downlink

   Confirm flow (pessimistic update):
     1. POST dimLevel → enter PENDING state (slider locked, ring pulses)
     2. Poll live_control_confirmed every 2s (up to 30s)
     3a. PASS  → apply new dim value, exit pending
     3b. FAIL  → revert to pre-command value, show error
     3c. 30s   → revert, show "No response from device"

   Confirm detection uses TB telemetry `ts` (server receive time in ms)
   so device clock drift doesn't matter.
   ========================================================= */

self.onInit = function () {
    'use strict';

    // ── Resolve Device ID ─────────────────────────────────────────
    function resolveDeviceId() {
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
        return (self.ctx.settings && self.ctx.settings.deviceId) || null;
    }

    var DEVICE_ID = resolveDeviceId();

    if (!DEVICE_ID) {
        console.error('[DIM] No device ID — widget cannot operate.');
        return;
    }

    // ── Settings ──────────────────────────────────────────────────
    var http = self.ctx.http;

    // Normal telemetry poll (dim_value, lamp status) — default 10s
    var POLL_MS = (self.ctx.settings && self.ctx.settings.pollIntervalMs)
        ? self.ctx.settings.pollIntervalMs
        : 10000;

    // How often to check for device confirm while pending — 2s
    var CONFIRM_POLL_MS = 2000;

    // Give up waiting for confirm after this many ms
    var CONFIRM_TIMEOUT_MS = 30000;

    // ── State ─────────────────────────────────────────────────────
    var currentDimValue = null;   // last confirmed dim from telemetry
    var isLampOn = false;
    var isSliderDragging = false;

    // Pending state (waiting for device confirm)
    var isPending = false;
    var pendingDimValue = null;   // value we just sent
    var sentAt = null;            // Date.now() when POST was made

    // Timers
    var pollTimer = null;
    var confirmTimer = null;
    var pendingTimeoutTimer = null;
    var toastTimer = null;

    // ── DOM refs ──────────────────────────────────────────────────
    var elValue        = document.getElementById('dim-current-value');
    var elSlider       = document.getElementById('dim-slider');
    var elRingFill     = document.getElementById('dim-ring-fill');
    var elLampDot      = document.getElementById('dim-lamp-dot');
    var elStatus       = document.getElementById('dim-header-status');
    var elBtnOn        = document.getElementById('dim-btn-on');
    var elBtnOff       = document.getElementById('dim-btn-off');
    var elLastCmd      = document.getElementById('dim-last-cmd');
    var elOverlay      = document.getElementById('dim-confirm-overlay');
    var elConfirmText  = document.getElementById('dim-confirm-text');
    var elConfirmTitle = document.getElementById('dim-confirm-title');
    var elConfirmIcon  = document.getElementById('dim-confirm-icon');
    var elConfirmBtn   = document.getElementById('dim-confirm-btn');
    var elPendingBadge = document.getElementById('dim-pending-badge');

    // Ring gauge circumference: 2 * π * 52 ≈ 326.73
    var RING_CIRC = 326.73;

    // ── Display helpers ───────────────────────────────────────────

    function updateDisplay(dimVal) {
        if (dimVal === null || dimVal === undefined) return;
        var val = Math.max(0, Math.min(100, parseInt(dimVal)));

        elValue.textContent = val;

        var offset = RING_CIRC - (RING_CIRC * val / 100);
        elRingFill.style.strokeDashoffset = offset;
        if (val === 0) {
            elRingFill.classList.add('is-off');
        } else {
            elRingFill.classList.remove('is-off');
        }

        if (!isSliderDragging && !isPending) {
            elSlider.value = val;
            updateSliderTrack(val);
        }

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
            if (!isPending) {
                elStatus.textContent = 'LAMP ON';
                elStatus.style.color = '#d97706';
                elStatus.style.background = '#fef3c7';
            }
        } else {
            elLampDot.classList.remove('is-on');
            elLampDot.classList.add('is-off');
            if (!isPending) {
                elStatus.textContent = 'LAMP OFF';
                elStatus.style.color = '#64748b';
                elStatus.style.background = '#f1f5f9';
            }
        }
    }

    function updateSliderTrack(val) {
        var pct = val + '%';
        elSlider.style.background = 'linear-gradient(to right, #f59e0b 0%, #f59e0b '
            + pct + ', #e2e8f0 ' + pct + ', #e2e8f0 100%)';
    }

    function showToast(msg, type, durationMs) {
        var el = document.getElementById('dim-toast');
        if (!el) return;
        el.textContent = msg;
        el.className = 'dim-toast ' + (type || 'info');
        el.style.display = 'block';
        if (toastTimer) clearTimeout(toastTimer);
        toastTimer = setTimeout(function () { el.style.display = 'none'; }, durationMs || 3000);
    }

    // ── Pending State ─────────────────────────────────────────────

    function enterPendingState(value) {
        isPending = true;
        pendingDimValue = value;
        sentAt = Date.now();

        // Lock slider and buttons
        elSlider.disabled = true;
        elBtnOn.disabled = true;
        elBtnOff.disabled = true;

        // Visual: ring pulses amber
        elRingFill.classList.add('is-pending');
        elRingFill.classList.remove('is-off');

        // Show pending value as preview (dimmed)
        elValue.textContent = value;
        var offset = RING_CIRC - (RING_CIRC * value / 100);
        elRingFill.style.strokeDashoffset = offset;

        // Status badge
        elStatus.textContent = 'SENDING…';
        elStatus.style.color = '#1e40af';
        elStatus.style.background = '#dbeafe';

        if (elPendingBadge) elPendingBadge.style.display = 'flex';

        // Start fast confirm polling
        if (confirmTimer) clearInterval(confirmTimer);
        confirmTimer = setInterval(pollConfirm, CONFIRM_POLL_MS);

        // Hard timeout
        if (pendingTimeoutTimer) clearTimeout(pendingTimeoutTimer);
        pendingTimeoutTimer = setTimeout(function () {
            if (isPending) {
                exitPendingState();
                showToast('No response from device', 'error', 4000);
                // Revert display to last confirmed value
                if (currentDimValue !== null) updateDisplay(currentDimValue);
                elLastCmd.textContent = 'No response — reverted';
            }
        }, CONFIRM_TIMEOUT_MS);
    }

    function exitPendingState() {
        isPending = false;
        pendingDimValue = null;
        sentAt = null;

        if (confirmTimer) { clearInterval(confirmTimer); confirmTimer = null; }
        if (pendingTimeoutTimer) { clearTimeout(pendingTimeoutTimer); pendingTimeoutTimer = null; }

        // Unlock controls
        elSlider.disabled = false;
        elBtnOn.disabled = false;
        elBtnOff.disabled = false;

        elRingFill.classList.remove('is-pending');
        if (elPendingBadge) elPendingBadge.style.display = 'none';

        // Restore lamp status label
        updateLampStatus(isLampOn);
    }

    // ── Confirm Polling (runs every 2s while pending) ──────────────

    function pollConfirm() {
        if (!isPending) return;

        var url = '/api/plugins/telemetry/DEVICE/' + DEVICE_ID
            + '/values/timeseries?keys=live_control_confirmed,live_control_time,live_control_status';

        http.get(url).toPromise().then(function (resp) {
            if (!isPending) return; // state may have changed while awaiting HTTP

            var confirmed = resp.live_control_confirmed && resp.live_control_confirmed[0];
            if (!confirmed) return;

            // ── Timestamp check ──────────────────────────────────
            // Use TB server receive timestamp (confirmed.ts, ms epoch).
            // Accept confirm only if TB received it AFTER we sent the command.
            // Allow 2s of slack for bridge processing latency.
            var confirmTs = confirmed.ts || 0;
            if (confirmTs < sentAt - 2000) {
                // This is an old confirm from a previous command — ignore it
                console.log('[DIM] Ignoring stale confirm ts=' + confirmTs + ' sentAt=' + sentAt);
                return;
            }

            var isPass = (confirmed.value === true || confirmed.value === 'true');
            var capturedPendingValue = pendingDimValue; // capture before exitPendingState clears it

            exitPendingState();

            if (isPass) {
                currentDimValue = capturedPendingValue;
                updateDisplay(currentDimValue);
                if (currentDimValue > 0) updateLampStatus(true);
                showToast('Device confirmed: ' + currentDimValue + '%', 'success');
                elLastCmd.textContent = 'Confirmed: ' + currentDimValue + '% at '
                    + new Date().toLocaleTimeString();
                console.log('[DIM] Confirm PASS → dim=' + currentDimValue);
            } else {
                // FAIL — revert to last known good value
                if (currentDimValue !== null) updateDisplay(currentDimValue);
                showToast('Device rejected command', 'error', 4000);
                elLastCmd.textContent = 'FAILED at ' + new Date().toLocaleTimeString();
                console.warn('[DIM] Confirm FAIL');
            }
        }).catch(function (err) {
            console.warn('[DIM] Confirm poll error:', err);
            // Don't exit pending on network error — keep trying until timeout
        });
    }

    // ── Normal Telemetry Polling ──────────────────────────────────

    function poll() {
        var url = '/api/plugins/telemetry/DEVICE/' + DEVICE_ID
            + '/values/timeseries?keys=dim_value,status_lamp_on';

        http.get(url).toPromise().then(function (resp) {
            // dim_value — only update display if not currently pending
            if (resp.dim_value && resp.dim_value.length > 0) {
                var newVal = parseInt(resp.dim_value[0].value);
                if (!isNaN(newVal)) {
                    currentDimValue = newVal;
                    if (!isPending) {
                        updateDisplay(currentDimValue);
                    }
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

    // ── User Confirmation Dialog ───────────────────────────────────

    var dialogPendingValue = null; // value shown in the confirm dialog

    function showConfirm(value) {
        dialogPendingValue = value;

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
        dialogPendingValue = null;
    }

    // ── Send Command ──────────────────────────────────────────────

    function sendDimCommand(value) {
        var url = '/api/plugins/telemetry/DEVICE/' + DEVICE_ID + '/SHARED_SCOPE';
        var payload = { dimLevel: value };

        console.log('[DIM] Sending dimLevel=' + value);

        // Enter pending BEFORE the POST so we capture sentAt accurately
        enterPendingState(value);
        elLastCmd.textContent = 'Sending ' + value + '%…';

        http.post(url, payload).toPromise().then(function () {
            showToast('Sent ' + value + '% — waiting for device…', 'info', 5000);
            console.log('[DIM] POST success, waiting for confirm');
        }).catch(function (err) {
            // POST itself failed (network/auth) — exit pending immediately
            exitPendingState();
            showToast('Send failed!', 'error');
            console.error('[DIM] POST error:', err);
            if (currentDimValue !== null) updateDisplay(currentDimValue);
            elLastCmd.textContent = 'Send failed at ' + new Date().toLocaleTimeString();
        });
    }

    // ── Public API ────────────────────────────────────────────────

    window.DIM_CTRL = {
        setDim: function (value) {
            if (isPending) {
                showToast('Waiting for device response…', 'info');
                return;
            }
            showConfirm(value);
        },

        onSliderInput: function () {
            if (isPending) return; // ignore drag while pending
            isSliderDragging = true;
            var val = parseInt(elSlider.value);
            elValue.textContent = val;
            updateSliderTrack(val);
            var offset = RING_CIRC - (RING_CIRC * val / 100);
            elRingFill.style.strokeDashoffset = offset;
        },

        onSliderCommit: function () {
            if (isPending) return;
            isSliderDragging = false;
            var val = parseInt(elSlider.value);
            if (val !== currentDimValue) {
                showConfirm(val);
            }
        },

        cancelConfirm: function () {
            hideConfirm();
            if (currentDimValue !== null) updateDisplay(currentDimValue);
        },

        executeConfirm: function () {
            var val = dialogPendingValue;
            hideConfirm();
            if (val !== null) {
                sendDimCommand(val);
            }
        }
    };

    // ── Initialize ────────────────────────────────────────────────
    updateDisplay(0);
    updateLampStatus(false);
    if (elPendingBadge) elPendingBadge.style.display = 'none';

    poll();
    pollTimer = setInterval(poll, POLL_MS);

    self._dimPollTimer = pollTimer;
    self._dimToastTimer = toastTimer;
};

// ── Lifecycle ──────────────────────────────────────────────────────

self.onDataUpdated = function () {};

self.onDestroy = function () {
    console.log('[DIM] onDestroy');
    if (self._dimPollTimer) clearInterval(self._dimPollTimer);
    if (self._dimToastTimer) clearTimeout(self._dimToastTimer);
    if (window.DIM_CTRL) delete window.DIM_CTRL;
};
