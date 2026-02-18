self.onInit = function() {
  'use strict';

  console.log('[DALI] onInit started');
  console.log('[DALI] datasources:', JSON.stringify(self.ctx.datasources));
  console.log('[DALI] settings:', JSON.stringify(self.ctx.settings));

  // ===================== RESOLVE DEVICE ID =====================

  function resolveDeviceId() {
    // 1. Dashboard state (Fleet navigation, URL params)
    try {
      var stateParams = self.ctx.stateController.getStateParams();
      if (stateParams && stateParams.entityId && stateParams.entityId.id) {
        return stateParams.entityId.id;
      }
    } catch (e) { /* stateController unavailable */ }

    // 2. Datasource entity (entity alias)
    try {
      var ds = self.ctx.datasources;
      if (ds && ds.length > 0 && ds[0].entity) {
        var eid = ds[0].entity.id;
        return (typeof eid === 'object' && eid !== null) ? eid.id : eid;
      }
    } catch (e) { /* datasource unavailable */ }

    // 3. Fallback: widget settings
    return (self.ctx.settings && self.ctx.settings.deviceId) || null;
  }

  var DEVICE_ID = resolveDeviceId();

  console.log('[DALI] DEVICE_ID:', DEVICE_ID);

  if (!DEVICE_ID) {
    showToast('No device configured. Add a datasource with entity alias.', 'error');
    return;
  }

  var BASE = '/api/plugins/telemetry/DEVICE/' + DEVICE_ID;
  var tasks = [];
  var editingIndex = -1;
  var pendingDeleteIndex = -1;
  var timeSlotCount = 0;
  var statusInterval = null;

  // ===================== API HELPERS (via self.ctx.http) =====================

  var http = self.ctx.http;

  function apiGet(path) {
    return http.get(path).toPromise();
  }

  function apiPost(path, body) {
    return http.post(path, body, { responseType: 'text' }).toPromise()
      .then(function(text) {
        if (!text) return {};
        try { return JSON.parse(text); } catch(e) { return {}; }
      });
  }

  // ===================== UTILITY FUNCTIONS =====================

  function showLoading(msg) {
    var el = document.getElementById('loading-overlay');
    el.querySelector('.loading-text').textContent = msg || 'Loading...';
    el.style.display = 'flex';
  }

  function hideLoading() {
    document.getElementById('loading-overlay').style.display = 'none';
  }

  function showToast(msg, type) {
    var el = document.getElementById('toast');
    el.textContent = msg;
    el.className = 'toast toast-' + (type || 'info');
    el.style.display = 'block';
    setTimeout(function() { el.style.display = 'none'; }, 4000);
  }

  function formatDate(y, m, d) {
    return y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0');
  }

  function padTime(h, m) {
    return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
  }

  function priorityStars(p) {
    var full = 6 - p;
    var out = '';
    for (var i = 0; i < 5; i++) {
      out += i < full
        ? '<span class="star star-full">&#9733;</span>'
        : '<span class="star star-empty">&#9734;</span>';
    }
    return out;
  }

  function cyclicLabel(type, interval, mask) {
    switch (type) {
      case 2: return 'Odd Days';
      case 3: return 'Even Days';
      case 4: return 'Every ' + interval + 'd';
      case 5:
        if (mask === 0) return 'Every Day';
        var days = ['Su','Mo','Tu','We','Th','Fr','Sa'];
        var active = [];
        for (var i = 0; i < 7; i++) {
          if (!(mask & (1 << i))) active.push(days[i]);
        }
        return active.join(', ');
      default: return '?';
    }
  }

  function eventEmoji(name) {
    if (name === 'sunrise') return '\u{1F305}';
    if (name === 'sunset') return '\u{1F307}';
    return name;
  }

  function slotSummary(slots) {
    if (!slots || !slots.length) return '--';
    return slots.map(function(s) {
      var onStr = s.on_event
        ? (eventEmoji(s.on_event) + (s.on_offset ? (s.on_offset > 0 ? '+' : '') + s.on_offset + 'm' : ''))
        : padTime(s.on_hour || 0, s.on_minute || 0);
      var offStr = s.off_event
        ? (eventEmoji(s.off_event) + (s.off_offset ? (s.off_offset > 0 ? '+' : '') + s.off_offset + 'm' : ''))
        : padTime(s.off_hour || 0, s.off_minute || 0);
      return onStr + '\u2192' + offStr + ' ' + (s.dim_value != null ? s.dim_value : 100) + '%';
    }).join(' | ');
  }

  // ===================== DATA LOADING =====================

  function loadTasksData() {
    return apiGet(BASE + '/values/attributes/SERVER_SCOPE?keys=tasks_data')
      .then(function(data) {
        tasks = [];
        if (data && data.length) {
          data.forEach(function(attr) {
            if (attr.key === 'tasks_data') {
              try {
                tasks = typeof attr.value === 'string' ? JSON.parse(attr.value) : attr.value;
                if (!Array.isArray(tasks)) tasks = [];
              } catch(e) { tasks = []; }
            }
          });
        }
      });
  }

  function saveTasksData() {
    return apiPost(BASE + '/SERVER_SCOPE', {
      tasks_data: JSON.stringify(tasks)
    });
  }

  function loadStatus() {
    apiGet(BASE + '/values/attributes/CLIENT_SCOPE?keys=task_response,task_query_response')
      .then(function(data) {
        var tr = '--', qr = '--';
        if (data && data.length) {
          data.forEach(function(attr) {
            if (attr.key === 'task_response') {
              try {
                var val = typeof attr.value === 'string' ? JSON.parse(attr.value) : attr.value;
                tr = formatStatusResponse(val, attr.lastUpdateTs);
              } catch(e) { tr = String(attr.value); }
            }
            if (attr.key === 'task_query_response') {
              try {
                var val2 = typeof attr.value === 'string' ? JSON.parse(attr.value) : attr.value;
                qr = formatQueryResponse(val2, attr.lastUpdateTs);
              } catch(e) { qr = String(attr.value); }
            }
          });
        }
        document.getElementById('task-response-text').innerHTML = tr;
        document.getElementById('query-response-text').innerHTML = qr;
        document.getElementById('last-refresh-text').textContent = 'Updated: ' + new Date().toLocaleTimeString();
      })
      .catch(function() {
        document.getElementById('last-refresh-text').textContent = 'Refresh failed';
      });
  }

  function formatStatusResponse(val, ts) {
    if (!val) return '--';
    var time = ts ? new Date(ts).toLocaleString() : '';
    var status = val.status || val.result || '';
    var profile = val.profile_id != null ? ' profile ' + val.profile_id : '';
    var cssClass = (status === 'PASS' || status === 'OK' || status === 'success') ? 'status-pass' : 'status-fail';
    return '<span class="' + cssClass + '">' + status + '</span>' + profile + (time ? ' <span class="status-time">(' + time + ')</span>' : '');
  }

  function formatQueryResponse(val, ts) {
    if (!val) return '--';
    var time = ts ? new Date(ts).toLocaleString() : '';
    if (typeof val === 'object') {
      var text = JSON.stringify(val).substring(0, 200);
      return text + (time ? ' <span class="status-time">(' + time + ')</span>' : '');
    }
    return String(val) + (time ? ' <span class="status-time">(' + time + ')</span>' : '');
  }

  // ===================== RENDER TABLE =====================

  function renderTable() {
    var tbody = document.getElementById('task-table-body');
    var emptyEl = document.getElementById('empty-state');
    var tableEl = document.getElementById('task-table');

    if (!tasks.length) {
      tbody.innerHTML = '';
      tableEl.style.display = 'none';
      emptyEl.style.display = 'flex';
      return;
    }

    tableEl.style.display = 'table';
    emptyEl.style.display = 'none';

    var html = '';
    tasks.forEach(function(t, idx) {
      var dateRange = formatDate(t.start_year, t.start_month, t.start_day);
      dateRange += t.end_forever ? ' \u2192 Forever' : ' \u2192 ' + formatDate(t.end_year, t.end_month, t.end_day);

      var statusClass = t._status === 'deployed' ? 'badge-success'
        : t._status === 'pending' ? 'badge-warning'
        : t._status === 'error' ? 'badge-error'
        : 'badge-default';
      var statusText = t._status || 'saved';

      html += '<tr>'
        + '<td>' + (idx + 1) + '</td>'
        + '<td><span class="profile-badge">' + t.profile_id + '</span></td>'
        + '<td>' + priorityStars(t.priority) + '</td>'
        + '<td class="date-cell">' + dateRange + '</td>'
        + '<td class="schedule-cell">' + slotSummary(t.time_slots) + '</td>'
        + '<td>' + cyclicLabel(t.cyclic_type, t.cyclic_time, t.off_days_mask) + '</td>'
        + '<td><span class="badge ' + statusClass + '">' + statusText + '</span></td>'
        + '<td class="actions-cell">'
        + '  <button class="btn btn-small btn-action" onclick="DALI.editTask(' + idx + ')" title="Edit">'
        + '    <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a.996.996 0 0 0 0-1.41l-2.34-2.34a.996.996 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>'
        + '  </button>'
        + '  <button class="btn btn-small btn-danger-outline" onclick="DALI.requestDelete(' + idx + ')" title="Delete">'
        + '    <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>'
        + '  </button>'
        + '  <button class="btn btn-small btn-action" onclick="DALI.verifyTask(' + idx + ')" title="Verify on device (sends 1 downlink)">'
        + '    <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>'
        + '  </button>'
        + '</td>'
        + '</tr>';
    });
    tbody.innerHTML = html;
  }

  // ===================== RENDER TIMELINE (Light Theme) =====================

  function renderTimeline() {
    var svg = document.getElementById('timeline-svg');
    var emptyEl = document.getElementById('timeline-empty');

    var allSlots = [];
    tasks.forEach(function(t, ti) {
      if (t.time_slots) {
        t.time_slots.forEach(function(s, si) {
          allSlots.push({ task: ti, slot: si, data: s, profileId: t.profile_id });
        });
      }
    });

    if (!allSlots.length) {
      svg.style.display = 'none';
      emptyEl.style.display = 'block';
      return;
    }

    svg.style.display = 'block';
    emptyEl.style.display = 'none';

    var W = 960, H = 120;
    var margin = { left: 40, right: 20, top: 10, bottom: 30 };
    var plotW = W - margin.left - margin.right;
    var plotH = H - margin.top - margin.bottom;
    var barH = Math.min(20, Math.floor(plotH / (allSlots.length + 1)));

    var parts = [];

    var neededH = margin.top + 14 + allSlots.length * (barH + 4) + margin.bottom + 10;
    var actualH = Math.max(H, neededH);

    // Light background
    parts.push('<rect x="0" y="0" width="' + W + '" height="' + actualH + '" fill="#f8fafc" rx="4"/>');

    // Grid lines and hour labels
    for (var h = 0; h <= 24; h += 2) {
      var x = margin.left + (h / 24) * plotW;
      parts.push('<line x1="' + x + '" y1="' + margin.top + '" x2="' + x + '" y2="' + (actualH - margin.bottom) + '" stroke="#e2e8f0" stroke-width="0.5"/>');
      parts.push('<text x="' + x + '" y="' + (actualH - 8) + '" fill="#94a3b8" font-size="10" text-anchor="middle">' + String(h).padStart(2, '0') + ':00</text>');
    }

    // Sunrise / sunset reference lines
    var sunriseX = margin.left + (6.5 / 24) * plotW;
    var sunsetX = margin.left + (18 / 24) * plotW;
    parts.push('<line x1="' + sunriseX + '" y1="' + margin.top + '" x2="' + sunriseX + '" y2="' + (actualH - margin.bottom) + '" stroke="#f59e0b" stroke-width="1" stroke-dasharray="4,3"/>');
    parts.push('<text x="' + (sunriseX + 3) + '" y="' + (margin.top + 10) + '" fill="#d97706" font-size="9" font-weight="600">Sunrise</text>');
    parts.push('<line x1="' + sunsetX + '" y1="' + margin.top + '" x2="' + sunsetX + '" y2="' + (actualH - margin.bottom) + '" stroke="#ea580c" stroke-width="1" stroke-dasharray="4,3"/>');
    parts.push('<text x="' + (sunsetX + 3) + '" y="' + (margin.top + 10) + '" fill="#ea580c" font-size="9" font-weight="600">Sunset</text>');

    // Slot bars (saturated colors for light theme contrast)
    var colors = ['#d97706', '#2563eb', '#059669', '#dc2626', '#7c3aed', '#0891b2', '#db2777', '#65a30d'];

    allSlots.forEach(function(slot, i) {
      var s = slot.data;
      var onHour, offHour;

      if (s.on_event === 'sunrise') {
        onHour = 6.5 + (s.on_offset || 0) / 60;
      } else if (s.on_event === 'sunset') {
        onHour = 18 + (s.on_offset || 0) / 60;
      } else {
        onHour = (s.on_hour || 0) + (s.on_minute || 0) / 60;
      }

      if (s.off_event === 'sunrise') {
        offHour = 6.5 + (s.off_offset || 0) / 60;
      } else if (s.off_event === 'sunset') {
        offHour = 18 + (s.off_offset || 0) / 60;
      } else {
        offHour = (s.off_hour || 0) + (s.off_minute || 0) / 60;
      }

      var dim = s.dim_value != null ? s.dim_value : 100;
      var opacity = Math.max(0.3, dim / 100);
      var color = colors[slot.task % colors.length];
      var y = margin.top + 14 + i * (barH + 4);

      if (offHour > onHour) {
        var x1 = margin.left + (onHour / 24) * plotW;
        var w = ((offHour - onHour) / 24) * plotW;
        parts.push('<rect x="' + x1 + '" y="' + y + '" width="' + w + '" height="' + barH + '" fill="' + color + '" opacity="' + opacity + '" rx="3"/>');
        parts.push('<text x="' + (x1 + w / 2) + '" y="' + (y + barH / 2 + 4) + '" fill="#fff" font-size="9" text-anchor="middle" font-weight="bold">' + dim + '%</text>');
      } else if (offHour < onHour) {
        var x1a = margin.left + (onHour / 24) * plotW;
        var w1 = ((24 - onHour) / 24) * plotW;
        parts.push('<rect x="' + x1a + '" y="' + y + '" width="' + w1 + '" height="' + barH + '" fill="' + color + '" opacity="' + opacity + '" rx="3"/>');

        var w2 = (offHour / 24) * plotW;
        parts.push('<rect x="' + margin.left + '" y="' + y + '" width="' + w2 + '" height="' + barH + '" fill="' + color + '" opacity="' + opacity + '" rx="3"/>');

        parts.push('<text x="' + (x1a + w1 / 2) + '" y="' + (y + barH / 2 + 4) + '" fill="#fff" font-size="9" text-anchor="middle" font-weight="bold">' + dim + '%</text>');
      }

      parts.push('<text x="' + (margin.left - 5) + '" y="' + (y + barH / 2 + 4) + '" fill="#64748b" font-size="9" text-anchor="end" font-weight="600">P' + slot.profileId + '</text>');
    });

    svg.innerHTML = parts.join('\n');

    svg.setAttribute('height', actualH);
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + actualH);
  }

  // ===================== TASK FORM =====================

  function hourOptions(selected) {
    var html = '';
    for (var h = 0; h < 24; h++) {
      var val = String(h).padStart(2, '0');
      html += '<option value="' + h + '"' + (h === selected ? ' selected' : '') + '>' + val + '</option>';
    }
    return html;
  }

  function minuteOptions(selected) {
    var html = '';
    for (var m = 0; m < 60; m++) {
      var val = String(m).padStart(2, '0');
      html += '<option value="' + m + '"' + (m === selected ? ' selected' : '') + '>' + val + '</option>';
    }
    return html;
  }

  function offsetOptions(selected) {
    var html = '';
    for (var o = -60; o <= 60; o += 5) {
      var label = (o > 0 ? '+' : '') + o + 'm';
      html += '<option value="' + o + '"' + (o === selected ? ' selected' : '') + '>' + label + '</option>';
    }
    return html;
  }

  function createTimeSlotHTML(index, slot) {
    slot = slot || {};
    var onEvent = slot.on_event || '';
    var offEvent = slot.off_event || '';
    var onHour = slot.on_hour != null ? slot.on_hour : 18;
    var onMin = slot.on_minute != null ? slot.on_minute : 0;
    var offHour = slot.off_hour != null ? slot.off_hour : 6;
    var offMin = slot.off_minute != null ? slot.off_minute : 0;
    var onOffset = slot.on_offset || 0;
    var offOffset = slot.off_offset || 0;
    var dim = slot.dim_value != null ? slot.dim_value : 100;

    var onOffsetSnapped = Math.round(onOffset / 5) * 5;
    var offOffsetSnapped = Math.round(offOffset / 5) * 5;

    var onType = onEvent ? onEvent : 'fixed';
    var offType = offEvent ? offEvent : 'fixed';

    var html = '<div class="timeslot-card" id="slot-' + index + '">'
      + '<div class="timeslot-header">'
      + '  <span class="timeslot-label">Slot ' + (index + 1) + '</span>'
      + '  <button class="btn-icon btn-remove" onclick="DALI.removeTimeSlot(' + index + ')" title="Remove slot">'
      + '    <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>'
      + '  </button>'
      + '</div>'
      + '<div class="timeslot-body">'
      + '  <div class="slot-row-onoff">'
      + '    <span class="slot-direction-label slot-direction-label-on">ON</span>'
      + '    <div class="slot-group-narrow">'
      + '      <select class="input input-sm slot-on-type" data-slot="' + index + '" onchange="DALI.onSlotTypeChange(' + index + ', \'on\')">'
      + '        <option value="fixed"' + (onType === 'fixed' ? ' selected' : '') + '>Fixed</option>'
      + '        <option value="sunrise"' + (onType === 'sunrise' ? ' selected' : '') + '>Sunrise</option>'
      + '        <option value="sunset"' + (onType === 'sunset' ? ' selected' : '') + '>Sunset</option>'
      + '      </select>'
      + '    </div>'
      + '    <div class="slot-group-narrow slot-on-time-group" data-slot="' + index + '" style="' + (onType !== 'fixed' ? 'display:none' : '') + '">'
      + '      <div class="time-select-group">'
      + '        <select class="input input-sm slot-on-hour" data-slot="' + index + '">' + hourOptions(onHour) + '</select>'
      + '        <span class="time-colon">:</span>'
      + '        <select class="input input-sm slot-on-minute" data-slot="' + index + '">' + minuteOptions(onMin) + '</select>'
      + '      </div>'
      + '    </div>'
      + '    <div class="slot-group-narrow slot-on-offset-group" data-slot="' + index + '" style="' + (onType === 'fixed' ? 'display:none' : '') + '">'
      + '      <select class="input input-sm slot-on-offset offset-select" data-slot="' + index + '">' + offsetOptions(onOffsetSnapped) + '</select>'
      + '    </div>'
      + '    <span class="slot-arrow">&rarr;</span>'
      + '    <span class="slot-direction-label slot-direction-label-off">OFF</span>'
      + '    <div class="slot-group-narrow">'
      + '      <select class="input input-sm slot-off-type" data-slot="' + index + '" onchange="DALI.onSlotTypeChange(' + index + ', \'off\')">'
      + '        <option value="fixed"' + (offType === 'fixed' ? ' selected' : '') + '>Fixed</option>'
      + '        <option value="sunrise"' + (offType === 'sunrise' ? ' selected' : '') + '>Sunrise</option>'
      + '        <option value="sunset"' + (offType === 'sunset' ? ' selected' : '') + '>Sunset</option>'
      + '      </select>'
      + '    </div>'
      + '    <div class="slot-group-narrow slot-off-time-group" data-slot="' + index + '" style="' + (offType !== 'fixed' ? 'display:none' : '') + '">'
      + '      <div class="time-select-group">'
      + '        <select class="input input-sm slot-off-hour" data-slot="' + index + '">' + hourOptions(offHour) + '</select>'
      + '        <span class="time-colon">:</span>'
      + '        <select class="input input-sm slot-off-minute" data-slot="' + index + '">' + minuteOptions(offMin) + '</select>'
      + '      </div>'
      + '    </div>'
      + '    <div class="slot-group-narrow slot-off-offset-group" data-slot="' + index + '" style="' + (offType === 'fixed' ? 'display:none' : '') + '">'
      + '      <select class="input input-sm slot-off-offset offset-select" data-slot="' + index + '">' + offsetOptions(offOffsetSnapped) + '</select>'
      + '    </div>'
      + '  </div>'
      + '  <div class="slot-row-dim">'
      + '    <span class="slot-dim-label">Dim</span>'
      + '    <input type="range" class="slider-dim" data-slot="' + index + '" min="0" max="100" value="' + dim + '" oninput="document.getElementById(\'dim-val-' + index + '\').textContent=this.value+\'%\'" style="flex:1">'
      + '    <span class="dim-val" id="dim-val-' + index + '">' + dim + '%</span>'
      + '  </div>'
      + '</div>'
      + '</div>';
    return html;
  }

  function renderTimeSlots(slots) {
    slots = slots || [{}];
    timeSlotCount = slots.length;
    var container = document.getElementById('timeslots-container');
    var html = '';
    slots.forEach(function(s, i) {
      html += createTimeSlotHTML(i, s);
    });
    container.innerHTML = html;
    updateAddSlotButton();
  }

  function updateAddSlotButton() {
    var btn = document.getElementById('add-slot-btn');
    btn.disabled = timeSlotCount >= 4;
    btn.textContent = timeSlotCount >= 4 ? 'Max 4 Slots' : '+ Add Slot';
  }

  function gatherTimeSlots() {
    var slots = [];
    for (var i = 0; i < timeSlotCount; i++) {
      var card = document.getElementById('slot-' + i);
      if (!card) continue;

      var onType = card.querySelector('.slot-on-type').value;
      var offType = card.querySelector('.slot-off-type').value;

      var slot = {};

      if (onType === 'fixed') {
        slot.on_hour = parseInt(card.querySelector('.slot-on-hour').value) || 0;
        slot.on_minute = parseInt(card.querySelector('.slot-on-minute').value) || 0;
        slot.on_offset = 0;
      } else {
        slot.on_event = onType;
        slot.on_hour = 0;
        slot.on_minute = 0;
        slot.on_offset = parseInt(card.querySelector('.slot-on-offset').value) || 0;
      }

      if (offType === 'fixed') {
        slot.off_hour = parseInt(card.querySelector('.slot-off-hour').value) || 0;
        slot.off_minute = parseInt(card.querySelector('.slot-off-minute').value) || 0;
        slot.off_offset = 0;
      } else {
        slot.off_event = offType;
        slot.off_hour = 0;
        slot.off_minute = 0;
        slot.off_offset = parseInt(card.querySelector('.slot-off-offset').value) || 0;
      }

      slot.dim_value = parseInt(card.querySelector('.slider-dim').value) || 0;
      slots.push(slot);
    }
    return slots;
  }

  function gatherOffDaysMask() {
    var mask = 0;
    var checks = document.querySelectorAll('#off-days-group input[type=checkbox]');
    checks.forEach(function(cb) {
      var day = parseInt(cb.getAttribute('data-day'));
      if (!cb.checked) {
        mask |= (1 << day);
      }
    });
    return mask;
  }

  function setOffDaysFromMask(mask) {
    var checks = document.querySelectorAll('#off-days-group input[type=checkbox]');
    checks.forEach(function(cb) {
      var day = parseInt(cb.getAttribute('data-day'));
      cb.checked = !(mask & (1 << day));
    });
  }

  function buildTaskCommand(opType) {
    var profileId = parseInt(document.getElementById('f-profile-id').value) || 1;
    var startDate = document.getElementById('f-start-date').value;
    var endForever = document.getElementById('f-end-forever').checked;
    var endDate = document.getElementById('f-end-date').value;
    var priority = parseInt(document.getElementById('f-priority').value) || 3;
    var cyclicType = parseInt(document.getElementById('f-cyclic-type').value) || 5;
    var cyclicTime = parseInt(document.getElementById('f-cyclic-time').value) || 0;
    var channel = parseInt(document.getElementById('f-channel').value) || 1;

    if (!startDate) {
      showToast('Start date is required', 'error');
      return null;
    }

    var sp = startDate.split('-');
    var cmd = {
      command: 'send_task',
      operation_type: opType,
      profile_id: profileId,
      start_year: parseInt(sp[0]),
      start_month: parseInt(sp[1]),
      start_day: parseInt(sp[2]),
      priority: priority,
      cyclic_type: cyclicType,
      cyclic_time: cyclicType === 4 ? cyclicTime : 0,
      off_days_mask: cyclicType === 5 ? gatherOffDaysMask() : 0,
      channel_number: channel,
      time_slots: gatherTimeSlots()
    };

    if (endForever) {
      cmd.end_forever = true;
    } else {
      if (!endDate) {
        showToast('End date is required when "Forever" is unchecked', 'error');
        return null;
      }
      var ep = endDate.split('-');
      cmd.end_forever = false;
      cmd.end_year = parseInt(ep[0]);
      cmd.end_month = parseInt(ep[1]);
      cmd.end_day = parseInt(ep[2]);
    }

    if (!cmd.time_slots.length) {
      showToast('At least one time slot is required', 'error');
      return null;
    }

    return cmd;
  }

  function taskFromCommand(cmd) {
    var t = {
      profile_id: cmd.profile_id,
      start_year: cmd.start_year,
      start_month: cmd.start_month,
      start_day: cmd.start_day,
      end_forever: cmd.end_forever,
      priority: cmd.priority,
      cyclic_type: cmd.cyclic_type,
      cyclic_time: cmd.cyclic_time,
      off_days_mask: cmd.off_days_mask,
      channel_number: cmd.channel_number,
      time_slots: cmd.time_slots,
      _status: 'deployed',
      _deployed_at: new Date().toISOString()
    };
    if (!cmd.end_forever) {
      t.end_year = cmd.end_year;
      t.end_month = cmd.end_month;
      t.end_day = cmd.end_day;
    }
    return t;
  }

  // ===================== PUBLIC API (window.DALI) =====================

  window.DALI = {

    init: function() {
      showLoading('Loading tasks...');
      var today = new Date();
      document.getElementById('f-start-date').value = today.toISOString().split('T')[0];

      loadTasksData()
        .then(function() {
          renderTable();
          renderTimeline();
          hideLoading();
        })
        .catch(function(err) {
          hideLoading();
          showToast('Failed to load tasks: ' + err.message, 'error');
        });

      loadStatus();
      var pollMs = (self.ctx.settings && self.ctx.settings.pollIntervalMs) || 30000;
      statusInterval = setInterval(loadStatus, pollMs);
      DALI._statusInterval = statusInterval;
    },

    showNewTask: function() {
      editingIndex = -1;
      document.getElementById('form-title').textContent = 'New Task';
      document.getElementById('deploy-btn').textContent = 'Deploy';

      document.getElementById('f-profile-id').value = tasks.length ? Math.max.apply(null, tasks.map(function(t) { return t.profile_id; })) + 1 : 1;
      document.getElementById('f-priority').value = '3';
      document.getElementById('f-channel').value = '1';
      document.getElementById('f-start-date').value = new Date().toISOString().split('T')[0];
      document.getElementById('f-end-forever').checked = true;
      document.getElementById('f-end-date').disabled = true;
      document.getElementById('f-cyclic-type').value = '5';
      document.getElementById('f-cyclic-time').value = '7';

      setOffDaysFromMask(0);
      DALI.onCyclicTypeChange();
      renderTimeSlots([{}]);

      document.getElementById('task-form-overlay').style.display = 'flex';
    },

    editTask: function(idx) {
      editingIndex = idx;
      var t = tasks[idx];

      document.getElementById('form-title').textContent = 'Edit Task (Profile ' + t.profile_id + ')';
      document.getElementById('deploy-btn').textContent = 'Update & Deploy';

      document.getElementById('f-profile-id').value = t.profile_id;
      document.getElementById('f-priority').value = t.priority;
      document.getElementById('f-channel').value = t.channel_number || 1;
      document.getElementById('f-start-date').value = formatDate(t.start_year, t.start_month, t.start_day);
      document.getElementById('f-end-forever').checked = !!t.end_forever;

      if (!t.end_forever && t.end_year) {
        document.getElementById('f-end-date').value = formatDate(t.end_year, t.end_month, t.end_day);
        document.getElementById('f-end-date').disabled = false;
      } else {
        document.getElementById('f-end-date').value = '';
        document.getElementById('f-end-date').disabled = true;
      }

      document.getElementById('f-cyclic-type').value = t.cyclic_type || 5;
      document.getElementById('f-cyclic-time').value = t.cyclic_time || 7;
      setOffDaysFromMask(t.off_days_mask || 0);
      DALI.onCyclicTypeChange();
      renderTimeSlots(t.time_slots && t.time_slots.length ? t.time_slots : [{}]);

      document.getElementById('task-form-overlay').style.display = 'flex';
    },

    hideTaskForm: function() {
      document.getElementById('task-form-overlay').style.display = 'none';
    },

    toggleEndForever: function() {
      var checked = document.getElementById('f-end-forever').checked;
      document.getElementById('f-end-date').disabled = checked;
    },

    onCyclicTypeChange: function() {
      var val = document.getElementById('f-cyclic-type').value;
      document.getElementById('cyclic-interval-group').style.display = val === '4' ? '' : 'none';
      document.getElementById('off-days-group').style.display = val === '5' ? '' : 'none';
    },

    onSlotTypeChange: function(index, direction) {
      var card = document.getElementById('slot-' + index);
      if (!card) return;
      var type = card.querySelector('.slot-' + direction + '-type').value;
      var timeGroup = card.querySelector('.slot-' + direction + '-time-group[data-slot="' + index + '"]');
      var offsetGroup = card.querySelector('.slot-' + direction + '-offset-group[data-slot="' + index + '"]');
      if (timeGroup) timeGroup.style.display = type === 'fixed' ? '' : 'none';
      if (offsetGroup) offsetGroup.style.display = type === 'fixed' ? 'none' : '';
    },

    addTimeSlot: function() {
      if (timeSlotCount >= 4) return;
      var container = document.getElementById('timeslots-container');
      container.insertAdjacentHTML('beforeend', createTimeSlotHTML(timeSlotCount, {}));
      timeSlotCount++;
      updateAddSlotButton();
    },

    removeTimeSlot: function(index) {
      var currentSlots = gatherTimeSlots();
      currentSlots.splice(index, 1);
      if (currentSlots.length === 0) currentSlots.push({});
      renderTimeSlots(currentSlots);
    },

    deployTask: function() {
      try {
        var opType = editingIndex >= 0 ? 2 : 1;
        var cmd = buildTaskCommand(opType);
        if (!cmd) return;

        showLoading('Deploying task to device...');

        apiPost(BASE + '/SHARED_SCOPE', { task_command: JSON.stringify(cmd) })
          .then(function() {
            var taskObj = taskFromCommand(cmd);

            if (editingIndex >= 0) {
              tasks[editingIndex] = taskObj;
            } else {
              tasks.push(taskObj);
            }

            return saveTasksData();
          })
          .then(function() {
            hideLoading();
            showToast('Task deployed successfully', 'success');
            DALI.hideTaskForm();
            renderTable();
            renderTimeline();
            setTimeout(loadStatus, 3000);
          })
          .catch(function(err) {
            hideLoading();
            console.error('Deploy failed:', err);
            var msg = (err && err.message) ? err.message : String(err);
            showToast('Deploy failed: ' + msg, 'error');
          });
      } catch(e) {
        hideLoading();
        console.error('Deploy error (sync):', e);
        showToast('Deploy error: ' + e.message, 'error');
      }
    },

    requestDelete: function(idx) {
      pendingDeleteIndex = idx;
      var t = tasks[idx];
      document.getElementById('confirm-message').textContent =
        'Delete task profile ' + t.profile_id + ' (Priority ' + t.priority + ')? This will send a delete command to the device.';
      document.getElementById('confirm-overlay').style.display = 'flex';
    },

    hideConfirm: function() {
      document.getElementById('confirm-overlay').style.display = 'none';
      pendingDeleteIndex = -1;
    },

    confirmDelete: function() {
      try {
        var idx = pendingDeleteIndex;
        if (idx < 0 || idx >= tasks.length) return;

        var t = tasks[idx];
        DALI.hideConfirm();
        showLoading('Deleting task...');

        var cmd = {
          command: 'send_task',
          operation_type: 3,
          profile_id: t.profile_id,
          start_year: t.start_year,
          start_month: t.start_month,
          start_day: t.start_day,
          end_forever: true,
          priority: t.priority,
          cyclic_type: t.cyclic_type || 5,
          cyclic_time: t.cyclic_time || 0,
          off_days_mask: t.off_days_mask || 0,
          channel_number: t.channel_number || 1,
          time_slots: t.time_slots || []
        };

        apiPost(BASE + '/SHARED_SCOPE', { task_command: JSON.stringify(cmd) })
          .then(function() {
            tasks.splice(idx, 1);
            return saveTasksData();
          })
          .then(function() {
            hideLoading();
            showToast('Task deleted', 'success');
            renderTable();
            renderTimeline();
            setTimeout(loadStatus, 3000);
          })
          .catch(function(err) {
            hideLoading();
            console.error('Delete failed:', err);
            var msg = (err && err.message) ? err.message : String(err);
            showToast('Delete failed: ' + msg, 'error');
          });
      } catch(e) {
        hideLoading();
        console.error('Delete error (sync):', e);
        showToast('Delete error: ' + e.message, 'error');
      }
    },

    // Single task verify - sends 1 downlink to query task from device
    verifyTask: function(idx) {
      try {
        var t = tasks[idx];
        if (!t) return;
        showLoading('Verifying task on device...');
        var cmd = { command: 'task_request', task_index: t.profile_id };
        apiPost(BASE + '/SHARED_SCOPE', { task_command: JSON.stringify(cmd) })
          .then(function() {
            hideLoading();
            showToast('Verify sent for profile ' + t.profile_id + '. Response on next uplink (~3 min).', 'info');
            setTimeout(loadStatus, 5000);
          })
          .catch(function(err) {
            hideLoading();
            console.error('Verify failed:', err);
            var msg = (err && err.message) ? err.message : String(err);
            showToast('Verify failed: ' + msg, 'error');
          });
      } catch(e) {
        hideLoading();
        console.error('Verify error (sync):', e);
        showToast('Verify error: ' + e.message, 'error');
      }
    },

    refreshStatus: function() {
      loadStatus();
    }
  };

  console.log('[DALI] DALI object created, window.DALI:', typeof window.DALI);

  // ===== Kick off =====
  DALI.init();
};

self.onDestroy = function() {
  console.log('[DALI] onDestroy');
  if (window.DALI && window.DALI._statusInterval) {
    clearInterval(window.DALI._statusInterval);
  }
  delete window.DALI;
};
