/* ===================================================================
   SignConnect Chat Widget — controller.js
   Floating chat panel that talks to the AI backend via POST /api/chat.
   Follows the same lifecycle & HTTP patterns as nav-tree and
   site-energy-summary widgets.
   =================================================================== */

var API_URL_DEFAULT = 'http://46.225.54.21:5001';
var HISTORY_LIMIT = 20;

// ── SVG icons ──────────────────────────────────────────────────────
var ICON_CHAT = '<svg viewBox="0 0 24 24"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H5.2L4 17.2V4h16v12z"/></svg>';
var ICON_SEND = '<svg viewBox="0 0 24 24"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>';
var ICON_CLOSE = '&times;';
var ICON_SPARK = '<svg viewBox="0 0 24 24"><path d="M12 2L9.19 8.63 2 9.24l5.46 4.73L5.82 21 12 17.27 18.18 21l-1.64-7.03L22 9.24l-7.19-.61z"/></svg>';

// ── Lifecycle ──────────────────────────────────────────────────────

self.onInit = function () {
    var $root = self.ctx.$container[0];
    var container = $root.querySelector('.sc-chat-root');
    if (!container) {
        $root.innerHTML = '<div class="sc-chat-root"></div>';
        container = $root.querySelector('.sc-chat-root');
    }

    // Resolve API URL from widget settings, fall back to default
    var API_URL = (self.ctx.settings && self.ctx.settings.apiUrl) || API_URL_DEFAULT;

    // State
    var isOpen = false;
    var isLoading = false;
    var messages = [];         // display list: {role, content}
    var chatHistory = [];      // sent to backend (capped at HISTORY_LIMIT)
    var suggestions = [];
    var hasOpened = false;      // track first open for welcome message

    // Build static DOM
    container.innerHTML = buildShell();
    var panel     = container.querySelector('.sc-chat-panel');
    var msgList   = container.querySelector('.sc-chat-messages');
    var input     = container.querySelector('.sc-chat-input');
    var sendBtn   = container.querySelector('.sc-chat-send-btn');
    var fab       = container.querySelector('.sc-chat-fab');
    var closeBtn  = container.querySelector('.sc-chat-close-btn');

    // ── Event bindings ──────────────────────────────────────────
    fab.addEventListener('click', togglePanel);
    closeBtn.addEventListener('click', togglePanel);
    sendBtn.addEventListener('click', function () { sendMessage(); });
    input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });
    input.addEventListener('input', autoGrow);

    // ── Toggle panel ────────────────────────────────────────────
    function togglePanel() {
        isOpen = !isOpen;
        if (isOpen) {
            panel.classList.add('sc-chat-open');
            if (!hasOpened) {
                hasOpened = true;
                addAssistantMessage(
                    "Hello! I'm the **SignConnect Assistant**. Ask me anything about your smart lighting — device status, energy usage, alarms, and more.",
                    ['Show me the site overview', 'Any active alarms?', 'How are the energy savings?']
                );
            }
            setTimeout(function () { input.focus(); }, 250);
        } else {
            panel.classList.remove('sc-chat-open');
        }
    }

    // ── Auto-grow textarea ──────────────────────────────────────
    function autoGrow() {
        input.style.height = 'auto';
        input.style.height = Math.min(input.scrollHeight, 80) + 'px';
    }

    // ── Send a message ──────────────────────────────────────────
    function sendMessage(text) {
        var msg = (text || input.value || '').trim();
        if (!msg || isLoading) return;

        // Clear previous chips
        var oldChips = msgList.querySelector('.sc-chat-chips');
        if (oldChips) oldChips.remove();

        // Push user message
        messages.push({ role: 'user', content: msg });
        chatHistory.push({ role: 'user', content: msg });
        appendBubble('user', esc(msg));
        input.value = '';
        input.style.height = 'auto';
        scrollToBottom();

        // Show typing indicator
        isLoading = true;
        sendBtn.disabled = true;
        var typingEl = appendTyping();

        // Build request
        var body = {
            message: msg,
            chat_history: chatHistory.slice(-HISTORY_LIMIT),
            context: getEntityContext()
        };

        // POST to backend (RxJS observable → promise, matching existing pattern)
        var obs = self.ctx.http.post(API_URL + '/api/chat', body);
        var promise;
        if (obs && typeof obs.toPromise === 'function') {
            promise = obs.toPromise();
        } else {
            promise = new Promise(function (resolve, reject) {
                obs.subscribe(
                    function (data) { resolve(data); },
                    function (err) { reject(err); }
                );
            });
        }

        promise.then(function (resp) {
            var data = resp.data || resp;
            var text = data.response || 'No response received.';
            var chips = (data.metadata && data.metadata.suggestions) || [];

            messages.push({ role: 'assistant', content: text });
            chatHistory.push({ role: 'assistant', content: text });
            trimHistory();

            addAssistantMessage(text, chips);
        }).catch(function (err) {
            console.error('[SC-CHAT] API error:', err);
            var errMsg = 'Sorry, I could not reach the assistant. Please try again.';
            messages.push({ role: 'assistant', content: errMsg });
            appendBubble('error', esc(errMsg));
        }).finally(function () {
            if (typingEl && typingEl.parentNode) typingEl.remove();
            isLoading = false;
            sendBtn.disabled = false;
            scrollToBottom();
        });
    }

    // ── Helpers ─────────────────────────────────────────────────

    function addAssistantMessage(text, chips) {
        appendBubble('assistant', renderMarkdown(text));
        if (chips && chips.length) {
            suggestions = chips;
            appendChips(chips);
        }
        scrollToBottom();
    }

    function appendBubble(role, html) {
        var div = document.createElement('div');
        div.className = 'sc-chat-msg sc-chat-msg-' + role;
        div.innerHTML = html;
        msgList.appendChild(div);
    }

    function appendTyping() {
        var div = document.createElement('div');
        div.className = 'sc-chat-typing';
        div.innerHTML =
            '<span class="sc-chat-typing-dot"></span>' +
            '<span class="sc-chat-typing-dot"></span>' +
            '<span class="sc-chat-typing-dot"></span>';
        msgList.appendChild(div);
        scrollToBottom();
        return div;
    }

    function appendChips(chips) {
        var wrap = document.createElement('div');
        wrap.className = 'sc-chat-chips';
        chips.forEach(function (label) {
            var btn = document.createElement('button');
            btn.className = 'sc-chat-chip';
            btn.textContent = label;
            btn.addEventListener('click', function () { sendMessage(label); });
            wrap.appendChild(btn);
        });
        msgList.appendChild(wrap);
        scrollToBottom();
    }

    function scrollToBottom() {
        setTimeout(function () { msgList.scrollTop = msgList.scrollHeight; }, 50);
    }

    function trimHistory() {
        while (chatHistory.length > HISTORY_LIMIT) {
            chatHistory.shift();
        }
    }

    // ── Entity context (matches EntityContext Pydantic model) ────
    function getEntityContext() {
        var ctx = {
            user_id: null,
            customer_id: null,
            customer_name: null,
            dashboard: null,
            dashboard_state: null,
            entity_id: null,
            entity_type: null,
            entity_name: null,
            entity_subtype: null,
            dashboard_tier: null
        };

        try {
            var cu = self.ctx.currentUser || {};
            var rawUserId = cu.userId;
            ctx.user_id = typeof rawUserId === 'string' ? rawUserId
                : (rawUserId && rawUserId.id ? rawUserId.id : null);

            var rawCustId = cu.customerId;
            var custIdStr = typeof rawCustId === 'string' ? rawCustId
                : (rawCustId && rawCustId.id ? rawCustId.id : null);
            if (custIdStr && custIdStr !== '13814000-1dd2-11b2-8080-808080808080') {
                ctx.customer_id = custIdStr;
            }
            if (cu.customerTitle) {
                ctx.customer_name = cu.customerTitle;
            }
        } catch (e) {}

        try {
            var sc = self.ctx.stateController;
            if (sc) {
                var sp = sc.getStateParams();
                if (sp && sp.entityId) {
                    ctx.entity_id = sp.entityId.id || sp.entityId;
                    ctx.entity_type = sp.entityId.entityType || null;
                }
                if (sp && sp.entityName) ctx.entity_name = sp.entityName;
                if (sp && sp.entityLabel) ctx.entity_subtype = sp.entityLabel;
                ctx.dashboard_state = sc.getStateId ? sc.getStateId() : null;
            }
        } catch (e) {}

        // Datasource fallback for entity info
        try {
            var ds = self.ctx.datasources;
            if (ds && ds.length > 0 && ds[0].entity) {
                if (!ctx.entity_id) {
                    var eid = ds[0].entity.id;
                    ctx.entity_id = (typeof eid === 'object' && eid !== null) ? eid.id : eid;
                    ctx.entity_type = ds[0].entityType || null;
                }
                if (!ctx.entity_name && ds[0].entityName) {
                    ctx.entity_name = ds[0].entityName;
                }
                if (!ctx.entity_subtype && ds[0].entitySubtype) {
                    ctx.entity_subtype = ds[0].entitySubtype;
                }
            }
        } catch (e) {}

        // Dashboard name from widget context
        try {
            if (self.ctx.dashboard && self.ctx.dashboard.dashboardName) {
                ctx.dashboard = self.ctx.dashboard.dashboardName;
            }
        } catch (e) {}

        // Dashboard tier from widget settings or state params
        try {
            if (self.ctx.settings && self.ctx.settings.dashboardTier) {
                ctx.dashboard_tier = self.ctx.settings.dashboardTier;
            }
        } catch (e) {}

        console.log('[SC-CHAT] Entity context:', JSON.stringify(ctx));
        return ctx;
    }

    // ── XSS-safe HTML escape ────────────────────────────────────
    function esc(str) {
        var div = document.createElement('div');
        div.appendChild(document.createTextNode(str));
        return div.innerHTML;
    }

    // ── Lightweight markdown renderer ───────────────────────────
    function renderMarkdown(text) {
        // Escape first, then apply markdown transforms
        var safe = esc(text);

        // Code blocks: ```...```
        safe = safe.replace(/```([\s\S]*?)```/g, function (m, code) {
            return '<pre><code>' + code.trim() + '</code></pre>';
        });

        // Inline code: `...`
        safe = safe.replace(/`([^`]+)`/g, '<code>$1</code>');

        // Bold: **...**
        safe = safe.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

        // Split into lines for list processing (skip code blocks)
        var lines = safe.split('\n');
        var out = [];
        var inUl = false;
        var inOl = false;

        for (var i = 0; i < lines.length; i++) {
            var line = lines[i];

            // Unordered list
            var ulMatch = line.match(/^[\s]*[-*]\s+(.*)/);
            if (ulMatch) {
                if (!inUl) { out.push('<ul>'); inUl = true; }
                if (inOl) { out.push('</ol>'); inOl = false; }
                out.push('<li>' + ulMatch[1] + '</li>');
                continue;
            }

            // Ordered list
            var olMatch = line.match(/^[\s]*\d+\.\s+(.*)/);
            if (olMatch) {
                if (!inOl) { out.push('<ol>'); inOl = true; }
                if (inUl) { out.push('</ul>'); inUl = false; }
                out.push('<li>' + olMatch[1] + '</li>');
                continue;
            }

            // Close any open lists
            if (inUl) { out.push('</ul>'); inUl = false; }
            if (inOl) { out.push('</ol>'); inOl = false; }

            // Skip blank lines inside pre blocks (already handled)
            if (line.trim() === '') {
                out.push('<br>');
            } else {
                out.push(line);
            }
        }

        // Close dangling lists
        if (inUl) out.push('</ul>');
        if (inOl) out.push('</ol>');

        return out.join('\n');
    }

    // ── Build DOM shell ─────────────────────────────────────────
    function buildShell() {
        return '' +
            '<button class="sc-chat-fab" title="Open SignConnect Assistant">' + ICON_CHAT + '</button>' +
            '<div class="sc-chat-panel">' +
                '<div class="sc-chat-header">' +
                    '<span class="sc-chat-header-title">' + ICON_SPARK + ' SignConnect Assistant</span>' +
                    '<button class="sc-chat-close-btn">' + ICON_CLOSE + '</button>' +
                '</div>' +
                '<div class="sc-chat-messages"></div>' +
                '<div class="sc-chat-input-area">' +
                    '<textarea class="sc-chat-input" rows="1" placeholder="Ask about your lighting..."></textarea>' +
                    '<button class="sc-chat-send-btn" title="Send">' + ICON_SEND + '</button>' +
                '</div>' +
            '</div>';
    }

    // ── Store references for cleanup ────────────────────────────
    self._chatCleanup = function () {
        fab.removeEventListener('click', togglePanel);
        closeBtn.removeEventListener('click', togglePanel);
    };
};

self.onDataUpdated = function () {
    // Static widget — no datasource updates
};

self.onResize = function () {
    // No action needed
};

self.onDestroy = function () {
    if (self._chatCleanup) self._chatCleanup();
};
