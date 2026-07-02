/* ===== JAcoworks Chat — WebSocket Client ===== */
/* Auth token is injected by the server via __AUTH_TOKEN__. */

(function () {
  'use strict';

  var GATEWAY_URL = (window.__GATEWAY_URL__ || '').replace(/\/$/, '');
  var AUTH_TOKEN = window.__AUTH_TOKEN__ || '';

  // DOM
  var chatMessages = document.getElementById('chatMessages');
  var chatWelcome = document.getElementById('chatWelcome');
  var chatInput = document.getElementById('chatInput');
  var sendBtn = document.getElementById('sendBtn');
  var abortBtn = document.getElementById('abortBtn');
  var statusDot = document.getElementById('statusDot');
  var statusText = document.getElementById('statusText');

  // State
  var ws = null;
  var connected = false;
  var streaming = false;
  var currentBotMsg = null;
  var currentBotText = '';
  var reconnectTimer = null;
  var reconnectAttempt = 0;
  var lastSeq = 0;
  var requestIdCounter = 0;

  // ===== Init =====
  chatInput.addEventListener('keydown', onInputKeydown);
  sendBtn.addEventListener('click', onSend);
  abortBtn.addEventListener('click', onAbort);
  chatInput.addEventListener('input', autoResize);
  fetchTicketAndConnect();

  // ===== Get WS ticket from Gateway =====
  function fetchTicketAndConnect() {
    setStatus('connecting', '正在连接...');

    fetch(GATEWAY_URL + '/api/oc/ws-ticket', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + AUTH_TOKEN },
    })
      .then(function (res) {
        if (res.status === 401) {
          setStatus('disconnected', '登录已过期');
          setTimeout(function () { location.href = '/login?redirect=/chat'; }, 1500);
          throw new Error('expired');
        }
        if (!res.ok) throw new Error('获取凭证失败 (' + res.status + ')');
        return res.json();
      })
      .then(function (data) {
        if (!data.ticket) throw new Error('无效的 ticket');
        connectWebSocket(data.ticket);
      })
      .catch(function (err) {
        if (err.message === 'expired') return;
        setStatus('disconnected', err.message);
        scheduleReconnect();
      });
  }

  // ===== WebSocket =====
  function connectWebSocket(ticket) {
    setStatus('connecting', '正在建立连接...');
    var wsBase = GATEWAY_URL.replace(/^http/, 'ws');
    var wsUrl = wsBase + '/ws/oc?ticket=' + encodeURIComponent(ticket);
    if (lastSeq > 0) wsUrl += '&lastSeq=' + lastSeq;

    ws = new WebSocket(wsUrl);

    ws.onopen = function () {
      connected = true;
      reconnectAttempt = 0;
      setStatus('connected', '已连接');
      updateButtons();
    };

    ws.onmessage = function (evt) {
      try { handleFrame(JSON.parse(evt.data)); } catch (e) {}
    };

    ws.onclose = function () {
      connected = false;
      ws = null;
      setStatus('disconnected', '连接断开');
      updateButtons();
      if (!streaming) scheduleReconnect();
    };

    ws.onerror = function () {};
  }

  // ===== Frame handling =====
  function handleFrame(frame) {
    if (frame.seq) lastSeq = frame.seq;
    var evt = frame.event || '';
    var data = frame.data || {};
    var dt = data.type || '';

    if (evt === 'proxy.ready') { setStatus('connected', '已连接'); return; }
    if (evt === 'proxy.error') { setStatus('connecting', data.error || '代理错误'); return; }
    if (evt === 'session_event' || dt === 'session_event') { handleSessionEvent(data); return; }
    if (evt === 'response' || dt === 'response') { handleResponse(data); return; }
    if (evt === 'done' || dt === 'done') { finishStreaming(); return; }
    if (evt === 'error' || dt === 'error') {
      appendError(data.error || data.message || '未知错误');
      finishStreaming();
    }
  }

  function handleSessionEvent(data) {
    if (data.event === 'text' && typeof data.data === 'string') {
      if (!streaming) startStreaming();
      currentBotText += data.data;
      renderBotMessage(currentBotText);
    }
  }

  function handleResponse(data) {
    var text = data.text || data.content || data.message || '';
    if (text) {
      if (!streaming) startStreaming();
      currentBotText = text;
      renderBotMessage(currentBotText);
    }
  }

  function startStreaming() {
    streaming = true;
    currentBotText = '';
    currentBotMsg = appendMessage('bot', '');
    updateButtons();
  }

  function finishStreaming() {
    streaming = false;
    currentBotMsg = null;
    currentBotText = '';
    updateButtons();
  }

  // ===== Send / Abort =====
  function onSend() {
    var text = chatInput.value.trim();
    if (!text || !connected) return;
    hideWelcome();
    appendMessage('user', text);

    requestIdCounter++;
    try {
      ws.send(JSON.stringify({
        type: 'prompt',
        id: 'web-' + Date.now() + '-' + requestIdCounter,
        message: text,
      }));
    } catch (e) {
      appendError('发送失败: ' + e.message);
      return;
    }
    chatInput.value = '';
    autoResize();
  }

  function onAbort() {
    if (!ws || !connected) return;
    try { ws.send(JSON.stringify({ type: 'abort', id: 'abort-' + Date.now() })); } catch (e) {}
    finishStreaming();
  }

  function onInputKeydown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!streaming) onSend();
    }
  }

  function autoResize() {
    chatInput.style.height = 'auto';
    chatInput.style.height = Math.min(chatInput.scrollHeight, 140) + 'px';
  }

  // ===== DOM =====
  function appendMessage(role, text) {
    hideWelcome();
    var div = document.createElement('div');
    div.className = 'msg msg-' + (role === 'user' ? 'user' : 'bot');
    var av = document.createElement('div');
    av.className = 'msg-avatar';
    av.textContent = role === 'user' ? 'U' : 'AI';
    var body = document.createElement('div');
    body.className = 'msg-body';
    body.textContent = text;
    div.appendChild(av);
    div.appendChild(body);
    chatMessages.appendChild(div);
    scrollToBottom();
    return body;
  }

  function renderBotMessage(text) {
    if (currentBotMsg) { currentBotMsg.textContent = text; scrollToBottom(); }
  }

  function appendError(msg) {
    var div = document.createElement('div');
    div.className = 'msg msg-bot';
    var av = document.createElement('div');
    av.className = 'msg-avatar';
    av.style.background = '#ef4444';
    av.textContent = '!';
    var body = document.createElement('div');
    body.className = 'msg-body';
    body.style.cssText = 'background:#fef2f2;color:#991b1b;border:1px solid #fecaca';
    body.textContent = '错误: ' + msg;
    div.appendChild(av);
    div.appendChild(body);
    chatMessages.appendChild(div);
    scrollToBottom();
  }

  function hideWelcome() { if (chatWelcome) chatWelcome.style.display = 'none'; }
  function scrollToBottom() { chatMessages.scrollTop = chatMessages.scrollHeight; }

  function setStatus(state, text) {
    statusDot.className = 'status-dot ' + state;
    statusText.textContent = text;
  }

  function updateButtons() {
    sendBtn.disabled = !connected || streaming;
    sendBtn.style.display = streaming ? 'none' : '';
    abortBtn.style.display = streaming ? '' : 'none';
    chatInput.disabled = !connected;
  }

  function scheduleReconnect() {
    if (reconnectTimer) return;
    reconnectAttempt++;
    var delay = Math.min(1000 * Math.pow(2, reconnectAttempt - 1), 15000);
    var total = Math.round(delay + delay * 0.2 * Math.random());
    setStatus('connecting', Math.ceil(total / 1000) + '秒后重连...');
    reconnectTimer = setTimeout(function () {
      reconnectTimer = null;
      fetchTicketAndConnect();
    }, total);
  }
})();
