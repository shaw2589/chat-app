/* global state */
let conversationId = null;
let contextTargetTurnId = null;
let contextTargetContent = null;

/* DOM refs */
const messagesList = document.getElementById('messagesList');
const inputForm = document.getElementById('inputForm');
const messageInput = document.getElementById('messageInput');
const sendButton = document.getElementById('sendButton');
const contextMenu = document.getElementById('contextMenu');
const viewThinkingBtn = document.getElementById('viewThinkingBtn');
const copyMessageBtn = document.getElementById('copyMessageBtn');
const thinkingModal = document.getElementById('thinkingModal');
const modalClose = document.getElementById('modalClose');
const thinkingContent = document.getElementById('thinkingContent');
const responsePreview = document.getElementById('responsePreview');

/* ── Initialise conversation on load ── */
async function init() {
  try {
    const res = await fetch('/api/conversations', { method: 'POST' });
    if (!res.ok) throw new Error('Failed to start conversation');
    const data = await res.json();
    conversationId = data.conversationId;
  } catch (err) {
    showError('Could not connect to server. Please refresh.');
  }
}

/* ── Utility helpers ── */
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatTimestamp(iso) {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function showError(msg) {
  const el = document.createElement('div');
  el.style.cssText =
    'color:#f87171;background:#2d1a1a;border:1px solid #7f1d1d;border-radius:8px;padding:10px 14px;font-size:.85rem;margin:0 auto;max-width:400px;text-align:center;';
  el.textContent = msg;
  messagesList.appendChild(el);
  scrollToBottom();
}

function scrollToBottom() {
  messagesList.scrollTo({ top: messagesList.scrollHeight, behavior: 'smooth' });
}

/* ── Auto-resize textarea ── */
messageInput.addEventListener('input', () => {
  messageInput.style.height = 'auto';
  messageInput.style.height = Math.min(messageInput.scrollHeight, 140) + 'px';
});

/* ── Build a message row element ── */
function buildMessageRow(turn) {
  const isUser = turn.role === 'user';
  const row = document.createElement('div');
  row.className = `message-row message-row--${turn.role}`;
  row.dataset.turnId = turn.id;

  const avatar = document.createElement('div');
  avatar.className = `message-avatar message-avatar--${turn.role}`;
  avatar.textContent = isUser ? 'You' : 'AI';
  avatar.setAttribute('aria-hidden', 'true');

  const wrapper = document.createElement('div');
  wrapper.className = 'message-bubble-wrapper';

  const bubble = document.createElement('div');
  bubble.className = `message-bubble message-bubble--${turn.role}`;
  bubble.textContent = turn.content;
  bubble.dataset.turnId = turn.id;

  if (!isUser) {
    bubble.setAttribute('tabindex', '0');
    bubble.setAttribute('role', 'article');
    bubble.setAttribute('aria-label', 'Assistant message – right-click for options');
    bubble.addEventListener('contextmenu', onAssistantContextMenu);
    bubble.addEventListener('keydown', (e) => {
      if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) {
        e.preventDefault();
        openContextMenuAtElement(bubble, turn.id, turn.content);
      }
    });
  }

  const ts = document.createElement('span');
  ts.className = 'message-timestamp';
  ts.textContent = formatTimestamp(turn.timestamp);
  ts.setAttribute('aria-label', `Sent at ${formatTimestamp(turn.timestamp)}`);

  wrapper.appendChild(bubble);

  // Show "thinking available" badge for assistant turns with thinking
  if (!isUser && turn.thinking) {
    const badge = document.createElement('button');
    badge.className = 'thinking-badge';
    badge.setAttribute('aria-label', 'View LLM thinking for this message');
    badge.innerHTML =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="11" height="11"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg> Thinking available';
    badge.addEventListener('click', () => openThinkingModal(turn.id));
    wrapper.appendChild(badge);
  }

  wrapper.appendChild(ts);
  row.appendChild(avatar);
  row.appendChild(wrapper);
  return row;
}

/* ── Typing indicator ── */
function showTypingIndicator() {
  const indicator = document.createElement('div');
  indicator.className = 'typing-indicator';
  indicator.id = 'typingIndicator';

  const avatar = document.createElement('div');
  avatar.className = 'message-avatar message-avatar--assistant';
  avatar.textContent = 'AI';
  avatar.setAttribute('aria-hidden', 'true');

  const dots = document.createElement('div');
  dots.className = 'typing-dots';
  dots.setAttribute('aria-label', 'AI is thinking');
  dots.setAttribute('role', 'status');
  for (let i = 0; i < 3; i++) {
    const d = document.createElement('span');
    d.className = 'typing-dot';
    dots.appendChild(d);
  }

  indicator.appendChild(avatar);
  indicator.appendChild(dots);

  // Remove welcome message if still present
  const welcome = messagesList.querySelector('.welcome-message');
  if (welcome) welcome.remove();

  messagesList.appendChild(indicator);
  scrollToBottom();
}

function removeTypingIndicator() {
  const indicator = document.getElementById('typingIndicator');
  if (indicator) indicator.remove();
}

/* ── Send message ── */
inputForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = messageInput.value.trim();
  if (!text || !conversationId) return;

  setInputDisabled(true);
  messageInput.value = '';
  messageInput.style.height = 'auto';

  // Optimistically render user message
  const tempUserTurn = {
    id: `temp-${crypto.randomUUID()}`,
    role: 'user',
    content: text,
    thinking: null,
    timestamp: new Date().toISOString(),
  };

  // Remove welcome message if present
  const welcome = messagesList.querySelector('.welcome-message');
  if (welcome) welcome.remove();

  messagesList.appendChild(buildMessageRow(tempUserTurn));
  scrollToBottom();
  showTypingIndicator();

  try {
    const res = await fetch(`/api/conversations/${conversationId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: text }),
    });

    const data = await res.json();

    if (!res.ok) {
      removeTypingIndicator();
      showError(data.error || 'Failed to get a response. Please try again.');
      setInputDisabled(false);
      return;
    }

    removeTypingIndicator();

    // Replace temp user row with server-confirmed turn
    const tempRow = messagesList.querySelector(`[data-turn-id="${tempUserTurn.id}"]`);
    if (tempRow) {
      const confirmedUserRow = buildMessageRow(data.userTurn);
      tempRow.parentElement.replaceChild(confirmedUserRow, tempRow);
    }

    messagesList.appendChild(buildMessageRow(data.turn));
    scrollToBottom();
  } catch (err) {
    removeTypingIndicator();
    showError('Network error. Please check your connection.');
  } finally {
    setInputDisabled(false);
    messageInput.focus();
  }
});

/* ── Enter key handling ── */
messageInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    inputForm.dispatchEvent(new Event('submit'));
  }
});

function setInputDisabled(disabled) {
  messageInput.disabled = disabled;
  sendButton.disabled = disabled;
}

/* ── Context menu ── */
function onAssistantContextMenu(e) {
  e.preventDefault();
  const bubble = e.currentTarget;
  openContextMenuAtPosition(e.clientX, e.clientY, bubble.dataset.turnId, bubble.textContent);
}

function openContextMenuAtElement(el, turnId, content) {
  const rect = el.getBoundingClientRect();
  openContextMenuAtPosition(rect.left + 20, rect.bottom + 4, turnId, content);
}

function openContextMenuAtPosition(x, y, turnId, content) {
  contextTargetTurnId = turnId;
  contextTargetContent = content;

  contextMenu.classList.add('is-visible');

  // Position & keep inside viewport
  const menuW = 200;
  const menuH = 90;
  let left = x;
  let top = y;
  if (left + menuW > window.innerWidth - 8) left = window.innerWidth - menuW - 8;
  if (top + menuH > window.innerHeight - 8) top = y - menuH;
  contextMenu.style.left = left + 'px';
  contextMenu.style.top = top + 'px';

  // Focus first item for keyboard accessibility
  viewThinkingBtn.focus();
}

function closeContextMenu() {
  contextMenu.classList.remove('is-visible');
  contextTargetTurnId = null;
  contextTargetContent = null;
}

document.addEventListener('click', (e) => {
  if (!contextMenu.contains(e.target)) closeContextMenu();
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (!thinkingModal.hidden) closeThinkingModal();
    else closeContextMenu();
  }
});

/* ── View Thinking button ── */
viewThinkingBtn.addEventListener('click', () => {
  const id = contextTargetTurnId;
  closeContextMenu();
  if (id) openThinkingModal(id);
});

/* ── Copy message button ── */
copyMessageBtn.addEventListener('click', async () => {
  const text = contextTargetContent;
  closeContextMenu();
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    copyMessageBtn.textContent = '✓ Copied!';
    setTimeout(() => {
      copyMessageBtn.innerHTML =
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> Copy Message';
    }, 1500);
  } catch {
    // fallback: ignore
  }
});

/* ── Thinking Modal ── */
async function openThinkingModal(turnId) {
  if (!conversationId || !turnId) return;

  thinkingContent.innerHTML = '<p class="no-thinking" style="font-style:italic;color:var(--text-muted);">Loading…</p>';
  responsePreview.textContent = '';
  thinkingModal.removeAttribute('hidden');
  document.body.style.overflow = 'hidden';
  modalClose.focus();

  try {
    const res = await fetch(`/api/conversations/${conversationId}/turns/${turnId}/thinking`);
    const data = await res.json();

    if (!res.ok) {
      thinkingContent.innerHTML = `<p class="no-thinking">${escapeHtml(data.error || 'Error loading thinking data.')}</p>`;
      return;
    }

    if (data.thinking) {
      thinkingContent.textContent = data.thinking;
    } else {
      thinkingContent.innerHTML = '<p class="no-thinking">No thinking data was captured for this message.</p>';
    }

    responsePreview.textContent = data.content || '';
  } catch (err) {
    thinkingContent.innerHTML = '<p class="no-thinking">Failed to load thinking data.</p>';
  }
}

function closeThinkingModal() {
  thinkingModal.setAttribute('hidden', '');
  document.body.style.overflow = '';
}

modalClose.addEventListener('click', closeThinkingModal);

thinkingModal.addEventListener('click', (e) => {
  if (e.target === thinkingModal) closeThinkingModal();
});

/* ── Bootstrap ── */
init();
