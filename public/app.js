/* ─────────────────────────────────────────────────────────────────
   State
   ───────────────────────────────────────────────────────────────── */
let currentConvId = null;
let conversations = [];
let folders = [];
let selectedFiles = []; // [{ folderId, fileName }]
let activeFolderPanel = null; // folder id currently open in panel

/* ─────────────────────────────────────────────────────────────────
   DOM refs
   ───────────────────────────────────────────────────────────────── */
const sidebar            = document.getElementById('sidebar');
const toggleSidebarBtn   = document.getElementById('toggleSidebar');
const mobileSidebarToggle= document.getElementById('mobileSidebarToggle');
const conversationList   = document.getElementById('conversationList');
const newChatBtn         = document.getElementById('newChatBtn');
const folderList         = document.getElementById('folderList');
const newFolderBtn       = document.getElementById('newFolderBtn');

const chatTitle          = document.getElementById('chatTitle');
const chatArea           = document.getElementById('chatArea');
const chatEmpty          = document.getElementById('chatEmpty');
const messageInput       = document.getElementById('messageInput');
const sendBtn            = document.getElementById('sendBtn');
const inputBar           = document.getElementById('inputBar');
const attachBtn          = document.getElementById('attachBtn');
const attachCount        = document.getElementById('attachCount');
const attachedFilesEl    = document.getElementById('attachedFiles');

const newFolderModal     = document.getElementById('newFolderModal');
const folderNameInput    = document.getElementById('folderNameInput');
const cancelFolderBtn    = document.getElementById('cancelFolderBtn');
const confirmFolderBtn   = document.getElementById('confirmFolderBtn');

const folderPanel        = document.getElementById('folderPanel');
const panelFolderName    = document.getElementById('panelFolderName');
const fileCountLabel     = document.getElementById('fileCountLabel');
const fileList           = document.getElementById('fileList');
const closePanelBtn      = document.getElementById('closePanelBtn');
const fileUploadInput    = document.getElementById('fileUploadInput');

const fileSelectModal    = document.getElementById('fileSelectModal');
const fileSelectList     = document.getElementById('fileSelectList');
const cancelFileSelectBtn= document.getElementById('cancelFileSelectBtn');
const confirmFileSelectBtn= document.getElementById('confirmFileSelectBtn');

/* ─────────────────────────────────────────────────────────────────
   API helpers
   ───────────────────────────────────────────────────────────────── */
async function api(method, path, body) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' }
  };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const res = await fetch(path, opts);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

async function apiUpload(path, file) {
  const fd = new FormData();
  fd.append('file', file);
  const res = await fetch(path, { method: 'POST', body: fd });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Upload failed');
  return data;
}

/* ─────────────────────────────────────────────────────────────────
   Helpers
   ───────────────────────────────────────────────────────────────── */
function formatTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function autoResize(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 160) + 'px';
}

/* ─────────────────────────────────────────────────────────────────
   Sidebar collapse
   ───────────────────────────────────────────────────────────────── */
toggleSidebarBtn.addEventListener('click', () => {
  sidebar.classList.toggle('collapsed');
});
mobileSidebarToggle.addEventListener('click', () => {
  sidebar.classList.toggle('mobile-open');
});
// Close mobile sidebar on outside click
document.addEventListener('click', e => {
  if (window.innerWidth <= 640 &&
      sidebar.classList.contains('mobile-open') &&
      !sidebar.contains(e.target) &&
      e.target !== mobileSidebarToggle) {
    sidebar.classList.remove('mobile-open');
  }
});

/* ─────────────────────────────────────────────────────────────────
   Conversations
   ───────────────────────────────────────────────────────────────── */
async function loadConversations() {
  conversations = await api('GET', '/api/conversations');
  renderConversationList();
}

function renderConversationList() {
  conversationList.innerHTML = '';
  if (conversations.length === 0) {
    conversationList.innerHTML = '<div style="padding:8px 12px;font-size:0.8rem;color:var(--text-muted)">No conversations yet</div>';
    return;
  }
  conversations.forEach(c => {
    const el = document.createElement('div');
    el.className = 'conv-item' + (c.id === currentConvId ? ' active' : '');
    el.dataset.id = c.id;
    el.innerHTML = `
      <span class="conv-item-title" title="${escapeHtml(c.title)}">${escapeHtml(c.title)}</span>
      <button class="conv-item-del" title="Delete conversation" data-id="${c.id}">✕</button>
    `;
    el.addEventListener('click', (e) => {
      if (e.target.classList.contains('conv-item-del')) return;
      selectConversation(c.id);
    });
    el.querySelector('.conv-item-del').addEventListener('click', async () => {
      if (!confirm('Delete this conversation?')) return;
      await api('DELETE', `/api/conversations/${c.id}`);
      if (currentConvId === c.id) {
        currentConvId = null;
        clearChat();
      }
      await loadConversations();
    });
    conversationList.appendChild(el);
  });
}

async function selectConversation(id) {
  currentConvId = id;
  const conv = await api('GET', `/api/conversations/${id}`);
  chatTitle.textContent = conv.title;
  enableInput();
  renderMessages(conv.messages || []);
  renderConversationList();
  if (window.innerWidth <= 640) sidebar.classList.remove('mobile-open');
}

function clearChat() {
  chatTitle.textContent = 'Select or start a conversation';
  chatArea.innerHTML = '';
  chatArea.appendChild(chatEmpty);
  chatEmpty.style.display = 'flex';
  disableInput();
  selectedFiles = [];
  renderAttachedFiles();
}

function enableInput() {
  messageInput.disabled = false;
  sendBtn.disabled = false;
  if (folders.length > 0) attachBtn.style.display = '';
}

function disableInput() {
  messageInput.disabled = true;
  sendBtn.disabled = true;
  attachBtn.style.display = 'none';
}

function renderMessages(messages) {
  chatArea.innerHTML = '';
  if (!messages || messages.length === 0) {
    chatArea.appendChild(chatEmpty);
    chatEmpty.style.display = 'flex';
    return;
  }
  chatEmpty.style.display = 'none';
  messages.forEach(m => appendMessage(m));
  scrollToBottom();
}

function appendMessage(msg) {
  chatEmpty.style.display = 'none';
  const el = document.createElement('div');
  el.className = `message ${msg.role}`;
  const avatar = msg.role === 'user' ? '🧑' : '🤖';
  const content = escapeHtml(msg.displayContent || msg.content || '');
  el.innerHTML = `
    <div class="message-avatar">${avatar}</div>
    <div class="message-body">
      <div class="message-bubble">${content}</div>
      <span class="message-time">${formatTime(msg.createdAt)}</span>
    </div>
  `;
  chatArea.appendChild(el);
}

function appendTypingIndicator() {
  const el = document.createElement('div');
  el.className = 'message assistant typing-indicator';
  el.id = 'typingIndicator';
  el.innerHTML = `
    <div class="message-avatar">🤖</div>
    <div class="message-body">
      <div class="message-bubble"><span class="dot"></span><span class="dot"></span><span class="dot"></span></div>
    </div>
  `;
  chatArea.appendChild(el);
  scrollToBottom();
  return el;
}

function removeTypingIndicator() {
  const el = document.getElementById('typingIndicator');
  if (el) el.remove();
}

function scrollToBottom() {
  chatArea.scrollTop = chatArea.scrollHeight;
}

newChatBtn.addEventListener('click', async () => {
  const conv = await api('POST', '/api/conversations');
  await loadConversations();
  await selectConversation(conv.id);
});

/* ─────────────────────────────────────────────────────────────────
   Sending messages
   ───────────────────────────────────────────────────────────────── */
messageInput.addEventListener('input', () => autoResize(messageInput));
messageInput.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    if (!sendBtn.disabled) sendMessage();
  }
});
sendBtn.addEventListener('click', sendMessage);

async function sendMessage() {
  const text = messageInput.value.trim();
  if (!text || !currentConvId) return;

  messageInput.value = '';
  autoResize(messageInput);
  sendBtn.disabled = true;
  messageInput.disabled = true;

  // Optimistically add user message
  const now = new Date().toISOString();
  appendMessage({ role: 'user', content: text, displayContent: text, createdAt: now });
  scrollToBottom();

  const typing = appendTypingIndicator();

  try {
    const result = await api('POST', `/api/conversations/${currentConvId}/chat`, {
      message: text,
      selectedFiles
    });
    removeTypingIndicator();
    appendMessage(result.message);
    scrollToBottom();

    // Update title if changed
    if (result.conversation && result.conversation.title) {
      chatTitle.textContent = result.conversation.title;
    }

    // Clear attached files after send
    selectedFiles = [];
    renderAttachedFiles();

    await loadConversations();
  } catch (err) {
    removeTypingIndicator();
    appendMessage({
      role: 'assistant',
      content: `⚠️ Error: ${err.message}`,
      displayContent: `⚠️ Error: ${err.message}`,
      createdAt: new Date().toISOString()
    });
    scrollToBottom();
  } finally {
    sendBtn.disabled = false;
    messageInput.disabled = false;
    messageInput.focus();
  }
}

/* ─────────────────────────────────────────────────────────────────
   Folders
   ───────────────────────────────────────────────────────────────── */
async function loadFolders() {
  folders = await api('GET', '/api/folders');
  renderFolderList();
  // Show attach button if there are folders and a conversation is active
  if (folders.length > 0 && currentConvId) {
    attachBtn.style.display = '';
  } else {
    attachBtn.style.display = 'none';
  }
}

function renderFolderList() {
  folderList.innerHTML = '';
  if (folders.length === 0) {
    folderList.innerHTML = '<li style="padding:6px 10px;font-size:0.8rem;color:var(--text-muted)">No folders</li>';
    return;
  }
  folders.forEach(f => {
    const li = document.createElement('li');
    li.className = 'folder-item';
    li.dataset.id = f.id;
    li.innerHTML = `
      <span>📁</span>
      <span class="folder-item-name" title="${escapeHtml(f.label)}">${escapeHtml(f.label)}</span>
      <span class="folder-item-count">${f.fileCount}/10</span>
      <button class="folder-item-del" title="Delete folder" data-id="${f.id}">✕</button>
    `;
    li.addEventListener('click', e => {
      if (e.target.classList.contains('folder-item-del')) return;
      openFolderPanel(f.id);
    });
    li.querySelector('.folder-item-del').addEventListener('click', async () => {
      if (!confirm(`Delete folder "${f.label}" and all its files?`)) return;
      await api('DELETE', `/api/folders/${f.id}`);
      // Remove any selected files from this folder
      selectedFiles = selectedFiles.filter(sf => sf.folderId !== f.id);
      renderAttachedFiles();
      await loadFolders();
    });
    folderList.appendChild(li);
  });
}

// New folder modal
newFolderBtn.addEventListener('click', () => {
  folderNameInput.value = '';
  newFolderModal.style.display = 'flex';
  folderNameInput.focus();
});
cancelFolderBtn.addEventListener('click', () => { newFolderModal.style.display = 'none'; });
newFolderModal.addEventListener('click', e => { if (e.target === newFolderModal) newFolderModal.style.display = 'none'; });

confirmFolderBtn.addEventListener('click', async () => {
  const name = folderNameInput.value.trim();
  if (!name) { folderNameInput.focus(); return; }
  await api('POST', '/api/folders', { name });
  newFolderModal.style.display = 'none';
  await loadFolders();
});
folderNameInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') confirmFolderBtn.click();
});

/* ─────────────────────────────────────────────────────────────────
   Folder files panel
   ───────────────────────────────────────────────────────────────── */
async function openFolderPanel(folderId) {
  activeFolderPanel = folderId;
  const folder = folders.find(f => f.id === folderId);
  panelFolderName.textContent = folder ? folder.label : 'Folder';
  await refreshFileList(folderId);
  folderPanel.style.display = 'flex';
}

closePanelBtn.addEventListener('click', () => {
  folderPanel.style.display = 'none';
  activeFolderPanel = null;
});
folderPanel.addEventListener('click', e => {
  if (e.target === folderPanel) {
    folderPanel.style.display = 'none';
    activeFolderPanel = null;
  }
});

async function refreshFileList(folderId) {
  const files = await api('GET', `/api/folders/${folderId}/files`);
  fileCountLabel.textContent = `${files.length} / 10 files`;
  fileList.innerHTML = '';
  if (files.length === 0) {
    fileList.innerHTML = '<li style="color:var(--text-muted);font-size:0.85rem;padding:8px 4px">No files uploaded yet</li>';
  } else {
    files.forEach(f => {
      const li = document.createElement('li');
      li.className = 'file-item';
      li.innerHTML = `
        <span>📄</span>
        <span class="file-item-name" title="${escapeHtml(f.name)}">${escapeHtml(f.name)}</span>
        <span class="file-item-size">${formatSize(f.size)}</span>
        <button class="file-item-del" data-folder="${folderId}" data-file="${escapeHtml(f.name)}" title="Delete file">✕</button>
      `;
      li.querySelector('.file-item-del').addEventListener('click', async () => {
        await api('DELETE', `/api/folders/${folderId}/files/${encodeURIComponent(f.name)}`);
        // Remove from selected files if present
        selectedFiles = selectedFiles.filter(sf => !(sf.folderId === folderId && sf.fileName === f.name));
        renderAttachedFiles();
        await refreshFileList(folderId);
        await loadFolders();
      });
      fileList.appendChild(li);
    });
  }
  // Update the upload button enabled state
  fileUploadInput.disabled = files.length >= 10;
}

fileUploadInput.addEventListener('change', async () => {
  const file = fileUploadInput.files[0];
  if (!file || !activeFolderPanel) return;
  try {
    await apiUpload(`/api/folders/${activeFolderPanel}/files`, file);
    await refreshFileList(activeFolderPanel);
    await loadFolders();
  } catch (err) {
    alert(err.message);
  } finally {
    fileUploadInput.value = '';
  }
});

/* ─────────────────────────────────────────────────────────────────
   Attach files to prompt
   ───────────────────────────────────────────────────────────────── */
attachBtn.addEventListener('click', openFileSelectModal);

async function openFileSelectModal() {
  // Build file list from all folders
  fileSelectList.innerHTML = '<p style="color:var(--text-muted);font-size:0.85rem">Loading…</p>';
  fileSelectModal.style.display = 'flex';

  let html = '';
  let hasFiles = false;
  for (const folder of folders) {
    const files = await api('GET', `/api/folders/${folder.id}/files`);
    if (files.length === 0) continue;
    hasFiles = true;
    html += `<div class="file-select-folder">📁 ${escapeHtml(folder.label)}</div>`;
    files.forEach(f => {
      const checked = selectedFiles.some(sf => sf.folderId === folder.id && sf.fileName === f.name);
      html += `
        <label class="file-select-item">
          <input type="checkbox"
            data-folder="${escapeHtml(folder.id)}"
            data-file="${escapeHtml(f.name)}"
            ${checked ? 'checked' : ''} />
          <span>${escapeHtml(f.name)}</span>
          <span style="margin-left:auto;color:var(--text-muted);font-size:0.75rem">${formatSize(f.size)}</span>
        </label>
      `;
    });
  }
  if (!hasFiles) html = '<p style="color:var(--text-muted);font-size:0.85rem">No files available. Upload files to a folder first.</p>';
  fileSelectList.innerHTML = html;
}

cancelFileSelectBtn.addEventListener('click', () => { fileSelectModal.style.display = 'none'; });
fileSelectModal.addEventListener('click', e => { if (e.target === fileSelectModal) fileSelectModal.style.display = 'none'; });

confirmFileSelectBtn.addEventListener('click', () => {
  const checkboxes = fileSelectList.querySelectorAll('input[type="checkbox"]');
  selectedFiles = [];
  checkboxes.forEach(cb => {
    if (cb.checked) {
      selectedFiles.push({ folderId: cb.dataset.folder, fileName: cb.dataset.file });
    }
  });
  fileSelectModal.style.display = 'none';
  renderAttachedFiles();
});

function renderAttachedFiles() {
  if (selectedFiles.length === 0) {
    attachedFilesEl.style.display = 'none';
    attachedFilesEl.innerHTML = '';
    attachCount.textContent = '0';
    return;
  }
  attachCount.textContent = selectedFiles.length;
  attachedFilesEl.style.display = 'flex';
  attachedFilesEl.innerHTML = selectedFiles.map((sf, i) => `
    <div class="file-chip">
      📎 ${escapeHtml(sf.fileName)}
      <button class="file-chip-remove" data-index="${i}" title="Remove">✕</button>
    </div>
  `).join('');
  attachedFilesEl.querySelectorAll('.file-chip-remove').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.index, 10);
      selectedFiles.splice(idx, 1);
      renderAttachedFiles();
    });
  });
}

/* ─────────────────────────────────────────────────────────────────
   Init
   ───────────────────────────────────────────────────────────────── */
(async function init() {
  await Promise.all([loadConversations(), loadFolders()]);
})();
