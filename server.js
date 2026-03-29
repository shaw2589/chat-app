'use strict';

const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const fse = require('fs-extra');
const { v4: uuidv4 } = require('uuid');
const { OpenAI } = require('openai');
const rateLimit = require('express-rate-limit');
const config = require('./config.json');

const app = express();
const PORT = config.server.port || 3000;

// Directories
const UPLOADS_DIR = path.join(__dirname, 'uploads');
const DATA_FILE = path.join(__dirname, 'data', 'conversations.json');

fse.ensureDirSync(UPLOADS_DIR);
fse.ensureDirSync(path.join(__dirname, 'data'));

// Initialize OpenAI client
const openai = new OpenAI({ apiKey: config.openai.apiKey });

// In-memory store for conversations (persisted to JSON)
let conversations = {};

function loadConversations() {
  if (fs.existsSync(DATA_FILE)) {
    try {
      conversations = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
    } catch {
      conversations = {};
    }
  }
}

function saveConversations() {
  fse.ensureDirSync(path.dirname(DATA_FILE));
  fs.writeFileSync(DATA_FILE, JSON.stringify(conversations, null, 2), 'utf-8');
}

loadConversations();

// Multer – disk storage per folder
const storage = multer.diskStorage({
  destination(req, file, cb) {
    const folderPath = safeResolvePath(UPLOADS_DIR, req.params.folderId);
    if (!folderPath) return cb(new Error('Invalid folder.'));
    fse.ensureDirSync(folderPath);
    cb(null, folderPath);
  },
  filename(req, file, cb) {
    cb(null, file.originalname);
  }
});

function fileFilter(req, file, cb) {
  const folderPath = safeResolvePath(UPLOADS_DIR, req.params.folderId);
  if (!folderPath) return cb(new Error('Invalid folder.'));
  fse.ensureDirSync(folderPath);
  const existing = fs.readdirSync(folderPath).filter(f =>
    f !== '.meta.json' && fs.statSync(path.join(folderPath, f)).isFile()
  );
  if (existing.length >= 10) {
    return cb(new Error('Folder already contains 10 files (maximum allowed).'));
  }
  cb(null, true);
}

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 5 * 1024 * 1024 } // 5 MB per file
});

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Rate limiters
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,   // 1 minute
  max: 120,               // up to 120 requests per minute for general API
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' }
});

const chatLimiter = rateLimit({
  windowMs: 60 * 1000,   // 1 minute
  max: 20,                // up to 20 chat requests per minute
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many chat requests, please slow down.' }
});

app.use('/api/conversations/:id/chat', chatLimiter);
app.use('/api', apiLimiter);

// Guard against path traversal: resolved path must start with the expected base
function safeResolvePath(base, ...parts) {
  const resolved = path.resolve(base, ...parts);
  if (!resolved.startsWith(path.resolve(base) + path.sep) && resolved !== path.resolve(base)) {
    return null;
  }
  return resolved;
}

/* ─────────────────────────────  FOLDER ROUTES  ──────────────────────────── */

// List all folders
app.get('/api/folders', (req, res) => {
  fse.ensureDirSync(UPLOADS_DIR);
  const folders = fs.readdirSync(UPLOADS_DIR)
    .filter(name => fs.statSync(path.join(UPLOADS_DIR, name)).isDirectory())
    .map(name => {
      const folderPath = path.join(UPLOADS_DIR, name);
      const files = fs.readdirSync(folderPath).filter(f =>
        f !== '.meta.json' && fs.statSync(path.join(folderPath, f)).isFile()
      );
      const metaFile = path.join(UPLOADS_DIR, name, '.meta.json');
      let label = name;
      if (fs.existsSync(metaFile)) {
        try { label = JSON.parse(fs.readFileSync(metaFile, 'utf-8')).label || name; } catch {}
      }
      return { id: name, label, fileCount: files.length };
    });
  res.json(folders);
});

// Create a folder
app.post('/api/folders', (req, res) => {
  const { name } = req.body;
  if (!name || typeof name !== 'string' || name.trim() === '') {
    return res.status(400).json({ error: 'Folder name is required.' });
  }
  const id = uuidv4();
  const folderPath = path.join(UPLOADS_DIR, id);
  fse.ensureDirSync(folderPath);
  fs.writeFileSync(
    path.join(folderPath, '.meta.json'),
    JSON.stringify({ label: name.trim() }),
    'utf-8'
  );
  res.status(201).json({ id, label: name.trim(), fileCount: 0 });
});

// Delete a folder
app.delete('/api/folders/:folderId', (req, res) => {
  const folderPath = safeResolvePath(UPLOADS_DIR, req.params.folderId);
  if (!folderPath || !fs.existsSync(folderPath)) return res.status(404).json({ error: 'Folder not found.' });
  fse.removeSync(folderPath);
  res.json({ success: true });
});

/* ──────────────────────────────  FILE ROUTES  ───────────────────────────── */

// List files in a folder
app.get('/api/folders/:folderId/files', (req, res) => {
  const folderPath = safeResolvePath(UPLOADS_DIR, req.params.folderId);
  if (!folderPath || !fs.existsSync(folderPath)) return res.status(404).json({ error: 'Folder not found.' });
  const files = fs.readdirSync(folderPath)
    .filter(f => f !== '.meta.json' && fs.statSync(path.join(folderPath, f)).isFile())
    .map(f => ({ name: f, size: fs.statSync(path.join(folderPath, f)).size }));
  res.json(files);
});

// Upload a file to a folder
app.post('/api/folders/:folderId/files', (req, res) => {
  upload.single('file')(req, res, err => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });
    res.status(201).json({ name: req.file.originalname, size: req.file.size });
  });
});

// Delete a file from a folder
app.delete('/api/folders/:folderId/files/:fileName', (req, res) => {
  const folderPath = safeResolvePath(UPLOADS_DIR, req.params.folderId);
  if (!folderPath) return res.status(400).json({ error: 'Invalid folder.' });
  const filePath = safeResolvePath(folderPath, req.params.fileName);
  if (!filePath || !fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found.' });
  fs.unlinkSync(filePath);
  res.json({ success: true });
});

/* ────────────────────────────  CONVERSATION ROUTES  ─────────────────────── */

// List all conversations
app.get('/api/conversations', (req, res) => {
  const list = Object.values(conversations).map(c => ({
    id: c.id,
    title: c.title,
    updatedAt: c.updatedAt
  }));
  list.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  res.json(list);
});

// Get a single conversation with all messages
app.get('/api/conversations/:id', (req, res) => {
  const conv = conversations[req.params.id];
  if (!conv) return res.status(404).json({ error: 'Conversation not found.' });
  res.json(conv);
});

// Create a new conversation
app.post('/api/conversations', (req, res) => {
  const id = uuidv4();
  const now = new Date().toISOString();
  conversations[id] = { id, title: 'New Chat', messages: [], createdAt: now, updatedAt: now };
  saveConversations();
  res.status(201).json(conversations[id]);
});

// Delete a conversation
app.delete('/api/conversations/:id', (req, res) => {
  if (!conversations[req.params.id]) return res.status(404).json({ error: 'Conversation not found.' });
  delete conversations[req.params.id];
  saveConversations();
  res.json({ success: true });
});

/* ───────────────────────────────  CHAT ROUTE  ───────────────────────────── */

app.post('/api/conversations/:id/chat', async (req, res) => {
  const conv = conversations[req.params.id];
  if (!conv) return res.status(404).json({ error: 'Conversation not found.' });

  const { message, selectedFiles } = req.body;
  if (!message || typeof message !== 'string' || message.trim() === '') {
    return res.status(400).json({ error: 'Message is required.' });
  }

  // Build user content – optionally prepend selected file contents
  let userContent = message.trim();

  if (Array.isArray(selectedFiles) && selectedFiles.length > 0) {
    const fileParts = [];
    for (const { folderId, fileName } of selectedFiles) {
      const folderPath = safeResolvePath(UPLOADS_DIR, folderId);
      if (!folderPath) continue;
      const filePath = safeResolvePath(folderPath, fileName);
      if (filePath && fs.existsSync(filePath)) {
        try {
          const content = fs.readFileSync(filePath, 'utf-8');
          fileParts.push(`--- File: ${fileName} ---\n${content}`);
        } catch {
          fileParts.push(`--- File: ${fileName} --- [Could not read file]`);
        }
      }
    }
    if (fileParts.length > 0) {
      userContent = `${fileParts.join('\n\n')}\n\n${userContent}`;
    }
  }

  // Append user message to history
  const userMsg = { role: 'user', content: userContent, displayContent: message.trim(), createdAt: new Date().toISOString() };
  conv.messages.push(userMsg);

  // Build messages array for OpenAI (use display content for history, full content for latest)
  const openAiMessages = conv.messages.slice(0, -1).map(m => ({
    role: m.role,
    content: m.displayContent || m.content
  }));
  openAiMessages.push({ role: 'user', content: userContent });

  try {
    const completion = await openai.chat.completions.create({
      model: config.openai.model || 'gpt-4o-mini',
      messages: openAiMessages,
      max_tokens: config.openai.maxTokens || 1024
    });

    const assistantContent = completion.choices[0].message.content;
    const assistantMsg = {
      role: 'assistant',
      content: assistantContent,
      displayContent: assistantContent,
      createdAt: new Date().toISOString()
    };
    conv.messages.push(assistantMsg);

    // Update title from first user message if still default
    if (conv.title === 'New Chat' && conv.messages.filter(m => m.role === 'user').length === 1) {
      conv.title = message.trim().slice(0, 50) + (message.trim().length > 50 ? '…' : '');
    }

    conv.updatedAt = new Date().toISOString();
    saveConversations();

    res.json({ message: assistantMsg, conversation: { id: conv.id, title: conv.title } });
  } catch (err) {
    // Remove the user message we added if the API call failed
    conv.messages.pop();
    console.error('OpenAI error:', err.message);
    res.status(502).json({ error: err.message || 'Failed to get response from OpenAI.' });
  }
});

/* ────────────────────────────────  START  ───────────────────────────────── */

app.listen(PORT, () => {
  console.log(`Chat app running at http://localhost:${PORT}`);
});

module.exports = app;
