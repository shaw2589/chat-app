/* ── State ────────────────────────────────────────────────────────────────── */
let conversations = [];
let currentConvId = null;
let folders = [];
let selectedFolderIds = [];   // folders attached to next message
let pendingAttachIds = [];     // temp selection inside attach modal
let currentFolderId = null;   // folder open in file-management modal

/* ── Helpers ──────────────────────────────────────────────────────────────── */
async function api(method, path, body) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const res = await fetch(path, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

function toast(msg, type = '') {
  let container = document.getElementById('toastContainer');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toastContainer';
    container.className = 'toast-container';
    document.body.appendChild(container);
  }
  const el = document.createElement('div');
  el.className = `toast${type ? ' ' + type : ''}`;
  el.textContent = msg;
  container.appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

function formatTime(iso) {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatFileSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

/* ── Sidebar toggle ───────────────────────────────────────────────────────── */
const sidebar  = document.getElementById('sidebar');
const overlay  = document.getElementById('overlay');
const hamburger = document.getElementById('hamburgerBtn');

hamburger.addEventListener('click', toggleSidebar);
overlay.addEventListener('click', closeSidebar);

function toggleSidebar() {
  sidebar.classList.toggle('open');
  overlay.classList.toggle('open');
}
function closeSidebar() {
  sidebar.classList.remove('open');
  overlay.classList.remove('open');
}

/* ── Conversations ────────────────────────────────────────────────────────── */
async function loadConversations() {
  try {
    conversations = await api('GET', '/api/conversations');
    renderConvList();
  } catch (e) {
    toast(e.message, 'error');
  }
}

function renderConvList() {
  const list = document.getElementById('convList');
  list.innerHTML = '';
  if (conversations.length === 0) {
    list.innerHTML = '<li style="padding:8px 10px;font-size:12.5px;color:var(--text-dim)">No conversations yet</li>';
    return;
  }
  for (const conv of conversations) {
    const li = document.createElement('li');
    li.className = `conv-item${conv.id === currentConvId ? ' active' : ''}`;
    li.dataset.id = conv.id;
    li.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="flex-shrink:0">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
      </svg>
      <span class="item-label">${escHtml(conv.title)}</span>
      <span class="item-meta">${conv.turnCount > 0 ? conv.turnCount + ' msg' + (conv.turnCount !== 1 ? 's' : '') : ''}</span>
      <span class="item-actions">
        <button class="delete-conv-btn" title="Delete">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
          </svg>
        </button>
      </span>`;
    li.addEventListener('click', (e) => {
      if (e.target.closest('.delete-conv-btn')) return;
      selectConversation(conv.id);
      closeSidebar();
    });
    li.querySelector('.delete-conv-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      deleteConversation(conv.id);
    });
    list.appendChild(li);
  }
}

async function selectConversation(id) {
  currentConvId = id;
  renderConvList();
  try {
    const conv = await api('GET', `/api/conversations/${id}`);
    document.getElementById('convTitle').textContent = conv.title;
    document.getElementById('deleteConvBtn').style.display = '';
    document.getElementById('inputArea').style.display = '';
    document.getElementById('emptyState').style.display = 'none';
    renderMessages(conv.turns);
    scrollToBottom();
  } catch (e) {
    toast(e.message, 'error');
  }
}

function renderMessages(turns) {
  const container = document.getElementById('messages');
  container.innerHTML = '';
  for (const turn of turns) {
    appendMessage(turn);
  }
}

function appendMessage(turn) {
  const container = document.getElementById('messages');
  const div = document.createElement('div');
  div.className = `message ${turn.role}`;

  const avatarLabel = turn.role === 'user' ? 'U' : 'AI';
  const contentHtml = turn.role === 'assistant'
    ? DOMPurify.sanitize(marked.parse(turn.content))
    : `<p>${escHtml(turn.content)}</p>`;

  div.innerHTML = `
    <div class="avatar">${avatarLabel}</div>
    <div>
      <div class="bubble">${contentHtml}</div>
      <div class="turn-time">${formatTime(turn.timestamp)}</div>
    </div>`;
  container.appendChild(div);
}

function showTypingIndicator() {
  const container = document.getElementById('messages');
  const div = document.createElement('div');
  div.className = 'message assistant';
  div.id = 'typingIndicator';
  div.innerHTML = `
    <div class="avatar">AI</div>
    <div class="bubble">
      <div class="typing-indicator">
        <span></span><span></span><span></span>
      </div>
    </div>`;
  container.appendChild(div);
  scrollToBottom();
}

function removeTypingIndicator() {
  const el = document.getElementById('typingIndicator');
  if (el) el.remove();
}

function scrollToBottom() {
  const c = document.getElementById('chatContainer');
  c.scrollTop = c.scrollHeight;
}

document.getElementById('newConvBtn').addEventListener('click', async () => {
  try {
    const conv = await api('POST', '/api/conversations', { title: 'New Conversation' });
    conversations.unshift(conv);
    renderConvList();
    await selectConversation(conv.id);
    closeSidebar();
  } catch (e) {
    toast(e.message, 'error');
  }
});

document.getElementById('deleteConvBtn').addEventListener('click', () => {
  if (currentConvId) deleteConversation(currentConvId);
});

async function deleteConversation(id) {
  if (!confirm('Delete this conversation?')) return;
  try {
    await api('DELETE', `/api/conversations/${id}`);
    conversations = conversations.filter(c => c.id !== id);
    if (currentConvId === id) {
      currentConvId = null;
      document.getElementById('convTitle').textContent = 'Select or start a conversation';
      document.getElementById('deleteConvBtn').style.display = 'none';
      document.getElementById('inputArea').style.display = 'none';
      document.getElementById('emptyState').style.display = '';
      document.getElementById('messages').innerHTML = '';
    }
    renderConvList();
    toast('Conversation deleted');
  } catch (e) {
    toast(e.message, 'error');
  }
}

/* ── Send message ─────────────────────────────────────────────────────────── */
const messageInput = document.getElementById('messageInput');
const sendBtn = document.getElementById('sendBtn');

messageInput.addEventListener('input', () => {
  sendBtn.disabled = messageInput.value.trim() === '';
  // Auto-resize textarea
  messageInput.style.height = 'auto';
  messageInput.style.height = Math.min(messageInput.scrollHeight, 180) + 'px';
});

messageInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    if (!sendBtn.disabled) sendMessage();
  }
});

sendBtn.addEventListener('click', sendMessage);

async function sendMessage() {
  if (!currentConvId) return;
  const message = messageInput.value.trim();
  if (!message) return;

  messageInput.value = '';
  messageInput.style.height = 'auto';
  sendBtn.disabled = true;

  // Append user message optimistically
  appendMessage({ role: 'user', content: message, timestamp: new Date().toISOString() });
  scrollToBottom();
  showTypingIndicator();

  try {
    const res = await api('POST', `/api/conversations/${currentConvId}/chat`, {
      message,
      folderIds: selectedFolderIds,
    });
    removeTypingIndicator();
    appendMessage(res.assistantTurn);
    scrollToBottom();

    // Update title in conv list
    const conv = conversations.find(c => c.id === currentConvId);
    if (conv) {
      conv.title = res.conversation.title;
      conv.turnCount = (conv.turnCount || 0) + 2;
      document.getElementById('convTitle').textContent = conv.title;
      renderConvList();
    }
  } catch (e) {
    removeTypingIndicator();
    toast(e.message, 'error');
    // Remove optimistic user message on error
    const msgs = document.getElementById('messages');
    if (msgs.lastChild) msgs.removeChild(msgs.lastChild);
  }
}

/* ── Folders ──────────────────────────────────────────────────────────────── */
async function loadFolders() {
  try {
    folders = await api('GET', '/api/folders');
    renderFolderList();
  } catch (e) {
    toast(e.message, 'error');
  }
}

function renderFolderList() {
  const list = document.getElementById('folderList');
  list.innerHTML = '';
  if (folders.length === 0) {
    list.innerHTML = '<li style="padding:8px 10px;font-size:12.5px;color:var(--text-dim)">No folders yet</li>';
    return;
  }
  for (const folder of folders) {
    const li = document.createElement('li');
    li.className = 'folder-item';
    li.dataset.id = folder.id;
    li.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="flex-shrink:0">
        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
      </svg>
      <span class="item-label">${escHtml(folder.name)}</span>
      <span class="folder-badge">${folder.fileCount}/10</span>
      <span class="item-actions">
        <button class="open-btn" title="Manage files">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
          </svg>
        </button>
        <button class="delete-folder-btn" title="Delete folder">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
          </svg>
        </button>
      </span>`;
    li.querySelector('.open-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      openFolderModal(folder.id);
    });
    li.querySelector('.delete-folder-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      deleteFolder(folder.id);
    });
    li.addEventListener('click', () => openFolderModal(folder.id));
    list.appendChild(li);
  }
}

/* New folder modal */
document.getElementById('newFolderBtn').addEventListener('click', () => {
  document.getElementById('folderNameInput').value = '';
  document.getElementById('newFolderModal').classList.add('open');
  setTimeout(() => document.getElementById('folderNameInput').focus(), 50);
});
document.getElementById('cancelFolderBtn').addEventListener('click', () => {
  document.getElementById('newFolderModal').classList.remove('open');
});
document.getElementById('folderNameInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('createFolderBtn').click();
});

document.getElementById('createFolderBtn').addEventListener('click', async () => {
  const name = document.getElementById('folderNameInput').value.trim();
  if (!name) return toast('Please enter a folder name', 'error');
  try {
    const folder = await api('POST', '/api/folders', { name });
    folders.push(folder);
    renderFolderList();
    document.getElementById('newFolderModal').classList.remove('open');
    toast(`Folder "${folder.name}" created`);
  } catch (e) {
    toast(e.message, 'error');
  }
});

async function deleteFolder(id) {
  const folder = folders.find(f => f.id === id);
  if (!folder) return;
  if (!confirm(`Delete folder "${folder.name}" and all its files?`)) return;
  try {
    await api('DELETE', `/api/folders/${id}`);
    folders = folders.filter(f => f.id !== id);
    selectedFolderIds = selectedFolderIds.filter(fid => fid !== id);
    renderFolderList();
    renderFolderChips();
    toast('Folder deleted');
  } catch (e) {
    toast(e.message, 'error');
  }
}

/* ── Folder Files Modal ───────────────────────────────────────────────────── */
function openFolderModal(id) {
  const folder = folders.find(f => f.id === id);
  if (!folder) return;
  currentFolderId = id;
  document.getElementById('folderModalTitle').textContent = folder.name;
  renderModalFileList(folder);
  document.getElementById('folderModal').classList.add('open');
}

function renderModalFileList(folder) {
  const list = document.getElementById('modalFileList');
  const countLabel = document.getElementById('fileCountLabel');
  const uploadInput = document.getElementById('fileUploadInput');

  countLabel.textContent = `${folder.files.length} / 10 files`;
  uploadInput.disabled = folder.files.length >= 10;
  document.getElementById('uploadLabel').style.opacity = folder.files.length >= 10 ? '0.4' : '1';

  list.innerHTML = '';
  if (folder.files.length === 0) {
    list.innerHTML = '<li style="padding:12px;font-size:13px;color:var(--text-dim);text-align:center">No files yet. Upload some!</li>';
    return;
  }
  for (const file of folder.files) {
    const li = document.createElement('li');
    li.className = 'file-item';
    li.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="flex-shrink:0;color:var(--text-dim)">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
        <polyline points="14 2 14 8 20 8"/>
      </svg>
      <span class="file-name" title="${escHtml(file.originalName)}">${escHtml(file.originalName)}</span>
      <span class="file-size">${formatFileSize(file.size)}</span>
      <button class="delete-file-btn" title="Delete file" data-file-id="${escHtml(file.id)}">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>`;
    li.querySelector('.delete-file-btn').addEventListener('click', () => deleteFile(currentFolderId, file.id));
    list.appendChild(li);
  }
}

document.getElementById('closeFolderModalBtn').addEventListener('click', () => {
  document.getElementById('folderModal').classList.remove('open');
  currentFolderId = null;
});

document.getElementById('fileUploadInput').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file || !currentFolderId) return;

  const folder = folders.find(f => f.id === currentFolderId);
  if (folder && folder.files.length >= 10) {
    toast('This folder already has 10 files (maximum)', 'error');
    e.target.value = '';
    return;
  }

  const formData = new FormData();
  formData.append('file', file);
  try {
    const res = await fetch(`/api/folders/${currentFolderId}/files`, {
      method: 'POST',
      body: formData,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);

    if (folder) {
      folder.files.push(data);
      folder.fileCount = folder.files.length;
      renderModalFileList(folder);
      renderFolderList();
      toast(`"${file.name}" uploaded`);
    }
  } catch (err) {
    toast(err.message, 'error');
  }
  e.target.value = '';
});

async function deleteFile(folderId, fileId) {
  try {
    await api('DELETE', `/api/folders/${folderId}/files/${fileId}`);
    const folder = folders.find(f => f.id === folderId);
    if (folder) {
      folder.files = folder.files.filter(f => f.id !== fileId);
      folder.fileCount = folder.files.length;
      renderModalFileList(folder);
      renderFolderList();
    }
    toast('File deleted');
  } catch (e) {
    toast(e.message, 'error');
  }
}

/* ── Attach Folder Modal ──────────────────────────────────────────────────── */
document.getElementById('attachFolderBtn').addEventListener('click', openAttachModal);

function openAttachModal() {
  pendingAttachIds = [...selectedFolderIds];
  renderAttachFolderList();
  document.getElementById('attachModal').classList.add('open');
}

function renderAttachFolderList() {
  const list = document.getElementById('attachFolderList');
  list.innerHTML = '';
  if (folders.length === 0) {
    list.innerHTML = '<li style="padding:12px;font-size:13px;color:var(--text-dim);text-align:center">No folders yet. Create one in the sidebar!</li>';
    return;
  }
  for (const folder of folders) {
    const li = document.createElement('li');
    li.className = `folder-select-item${pendingAttachIds.includes(folder.id) ? ' selected' : ''}`;
    li.innerHTML = `
      <input type="checkbox" ${pendingAttachIds.includes(folder.id) ? 'checked' : ''} />
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
      </svg>
      <span class="folder-select-name">${escHtml(folder.name)}</span>
      <span class="folder-select-count">${folder.fileCount || folder.files?.length || 0} file(s)</span>`;
    const cb = li.querySelector('input[type="checkbox"]');
    li.addEventListener('click', (e) => {
      if (e.target === cb) return;
      cb.checked = !cb.checked;
      togglePendingFolder(folder.id, cb.checked, li);
    });
    cb.addEventListener('change', () => togglePendingFolder(folder.id, cb.checked, li));
    list.appendChild(li);
  }
}

function togglePendingFolder(id, checked, li) {
  if (checked) {
    if (!pendingAttachIds.includes(id)) pendingAttachIds.push(id);
    li.classList.add('selected');
  } else {
    pendingAttachIds = pendingAttachIds.filter(fid => fid !== id);
    li.classList.remove('selected');
  }
}

document.getElementById('cancelAttachBtn').addEventListener('click', () => {
  document.getElementById('attachModal').classList.remove('open');
});
document.getElementById('closeAttachModalBtn').addEventListener('click', () => {
  document.getElementById('attachModal').classList.remove('open');
});

document.getElementById('confirmAttachBtn').addEventListener('click', () => {
  selectedFolderIds = [...pendingAttachIds];
  renderFolderChips();
  document.getElementById('attachModal').classList.remove('open');
});

function renderFolderChips() {
  const row = document.getElementById('folderChipRow');
  row.innerHTML = '';
  for (const fid of selectedFolderIds) {
    const folder = folders.find(f => f.id === fid);
    if (!folder) continue;
    const chip = document.createElement('div');
    chip.className = 'folder-chip';
    chip.innerHTML = `
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
      </svg>
      ${escHtml(folder.name)}
      <button data-id="${escHtml(folder.id)}" aria-label="Remove folder">&times;</button>`;
    chip.querySelector('button').addEventListener('click', () => {
      selectedFolderIds = selectedFolderIds.filter(id => id !== fid);
      renderFolderChips();
    });
    row.appendChild(chip);
  }
}

document.getElementById('clearContextBtn').addEventListener('click', () => {
  selectedFolderIds = [];
  renderFolderChips();
  document.getElementById('contextBar').style.display = 'none';
});

/* ── Escape HTML ──────────────────────────────────────────────────────────── */
function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* ── Close modals on backdrop click ──────────────────────────────────────── */
['newFolderModal', 'folderModal', 'attachModal'].forEach(id => {
  document.getElementById(id).addEventListener('click', (e) => {
    if (e.target === document.getElementById(id)) {
      document.getElementById(id).classList.remove('open');
    }
  });
});

/* ── Init ─────────────────────────────────────────────────────────────────── */
async function init() {
  await Promise.all([loadConversations(), loadFolders()]);
}

init();
