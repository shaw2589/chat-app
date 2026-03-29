const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const OpenAI = require('openai');
const rateLimit = require('express-rate-limit');
const config = require('./config');

const app = express();

// Ensure uploads directory exists
const uploadsDir = path.resolve(config.folders.uploadsDir);
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// In-memory store for conversations and folders
const conversations = {};
const folders = {};

// OpenAI client (initialized lazily to allow .env config)
function getOpenAIClient() {
  if (!config.openai.apiKey) {
    throw new Error('OpenAI API key not configured. Please set OPENAI_API_KEY in your .env file.');
  }
  return new OpenAI({ apiKey: config.openai.apiKey });
}

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Rate limiters
const chatLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
});

const fileLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
});

// Multer storage config
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const folderId = req.params.folderId;
    const folder = folders[folderId];
    if (!folder) {
      return cb(new Error('Folder not found'));
    }
    const folderPath = path.join(uploadsDir, folderId);
    if (!fs.existsSync(folderPath)) {
      fs.mkdirSync(folderPath, { recursive: true });
    }
    cb(null, folderPath);
  },
  filename: (req, file, cb) => {
    // Sanitize the filename: strip path components, then replace unsafe chars
    const base = path.basename(file.originalname);
    const safeName = base.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/^\.+/, '_');
    cb(null, safeName);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter: (req, file, cb) => {
    // Accept only text-based files
    const allowedMimes = [
      'text/plain',
      'text/markdown',
      'text/csv',
      'application/json',
      'text/html',
      'text/css',
      'application/javascript',
      'text/javascript',
      'text/x-python',
      'application/x-python-code',
    ];
    if (allowedMimes.includes(file.mimetype) || file.originalname.match(/\.(txt|md|csv|json|html|css|js|py|ts|yaml|yml|xml|log)$/i)) {
      cb(null, true);
    } else {
      cb(new Error('Only text-based files are allowed'));
    }
  },
});

// ─── Conversation Routes ─────────────────────────────────────────────────────

// List all conversations
app.get('/api/conversations', (req, res) => {
  const list = Object.values(conversations).map(({ id, title, createdAt, updatedAt, turns }) => ({
    id,
    title,
    createdAt,
    updatedAt,
    turnCount: turns.length,
  }));
  list.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  res.json(list);
});

// Get a single conversation
app.get('/api/conversations/:id', (req, res) => {
  const conv = conversations[req.params.id];
  if (!conv) return res.status(404).json({ error: 'Conversation not found' });
  res.json(conv);
});

// Create a new conversation
app.post('/api/conversations', (req, res) => {
  const id = uuidv4();
  const now = new Date().toISOString();
  conversations[id] = {
    id,
    title: req.body.title || 'New Conversation',
    createdAt: now,
    updatedAt: now,
    turns: [],
  };
  res.status(201).json(conversations[id]);
});

// Delete a conversation
app.delete('/api/conversations/:id', (req, res) => {
  if (!conversations[req.params.id]) return res.status(404).json({ error: 'Conversation not found' });
  delete conversations[req.params.id];
  res.json({ success: true });
});

// Send a chat message
app.post('/api/conversations/:id/chat', chatLimiter, async (req, res) => {
  const conv = conversations[req.params.id];
  if (!conv) return res.status(404).json({ error: 'Conversation not found' });

  const { message, folderIds } = req.body;
  if (!message || typeof message !== 'string' || message.trim() === '') {
    return res.status(400).json({ error: 'Message is required' });
  }

  // Build context from selected folders (async for performance)
  let contextText = '';
  if (Array.isArray(folderIds) && folderIds.length > 0) {
    const readTasks = [];
    for (const fid of folderIds) {
      const folder = folders[fid];
      if (!folder) continue;
      const folderPath = path.join(uploadsDir, fid);
      if (!fs.existsSync(folderPath)) continue;
      const files = fs.readdirSync(folderPath);
      for (const filename of files) {
        const filePath = path.join(folderPath, filename);
        readTasks.push(
          fs.promises.readFile(filePath, 'utf8')
            .then(content => `\n\n--- File: ${folder.name}/${filename} ---\n${content}`)
            .catch(() => '')
        );
      }
    }
    const parts = await Promise.all(readTasks);
    contextText = parts.join('');
  }

  const userContent = contextText
    ? `${message}\n\nContext from uploaded files:${contextText}`
    : message;

  // Add user turn
  const userTurn = { role: 'user', content: message, timestamp: new Date().toISOString() };
  conv.turns.push(userTurn);
  conv.updatedAt = new Date().toISOString();

  // Automatically update title from first message
  if (conv.turns.length === 1) {
    conv.title = message.length > 50 ? message.substring(0, 50) + '…' : message;
  }

  try {
    const openai = getOpenAIClient();

    // Build messages array for OpenAI
    const messages = conv.turns.slice(0, -1).map(t => ({ role: t.role, content: t.content }));
    messages.push({ role: 'user', content: userContent });

    const completion = await openai.chat.completions.create({
      model: config.openai.model,
      messages,
    });

    const assistantContent = completion.choices[0].message.content;
    const assistantTurn = {
      role: 'assistant',
      content: assistantContent,
      timestamp: new Date().toISOString(),
    };
    conv.turns.push(assistantTurn);
    conv.updatedAt = new Date().toISOString();

    res.json({ userTurn, assistantTurn, conversation: { id: conv.id, title: conv.title } });
  } catch (err) {
    // Remove the user turn we just added on error
    conv.turns.pop();
    res.status(500).json({ error: err.message || 'Failed to get response from OpenAI' });
  }
});

// ─── Folder Routes ────────────────────────────────────────────────────────────

// List folders
app.get('/api/folders', (req, res) => {
  const list = Object.values(folders).map(f => ({
    ...f,
    fileCount: f.files.length,
  }));
  res.json(list);
});

// Create a folder
app.post('/api/folders', fileLimiter, (req, res) => {
  const { name } = req.body;
  if (!name || typeof name !== 'string' || name.trim() === '') {
    return res.status(400).json({ error: 'Folder name is required' });
  }
  const id = uuidv4();
  const now = new Date().toISOString();
  folders[id] = { id, name: name.trim(), createdAt: now, files: [] };
  const folderPath = path.join(uploadsDir, id);
  fs.mkdirSync(folderPath, { recursive: true });
  res.status(201).json(folders[id]);
});

// Delete a folder
app.delete('/api/folders/:id', fileLimiter, (req, res) => {
  const folder = folders[req.params.id];
  if (!folder) return res.status(404).json({ error: 'Folder not found' });
  const folderPath = path.join(uploadsDir, req.params.id);
  if (fs.existsSync(folderPath)) {
    fs.rmSync(folderPath, { recursive: true, force: true });
  }
  delete folders[req.params.id];
  res.json({ success: true });
});

// Upload a file to a folder
app.post('/api/folders/:folderId/files', fileLimiter, (req, res) => {
  const folder = folders[req.params.folderId];
  if (!folder) return res.status(404).json({ error: 'Folder not found' });

  if (folder.files.length >= config.folders.maxFilesPerFolder) {
    return res.status(400).json({
      error: `Folder already contains the maximum of ${config.folders.maxFilesPerFolder} files`,
    });
  }

  upload.single('file')(req, res, err => {
    if (err) {
      return res.status(400).json({ error: err.message });
    }
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const fileInfo = {
      id: uuidv4(),
      name: req.file.filename,
      originalName: req.file.originalname,
      size: req.file.size,
      uploadedAt: new Date().toISOString(),
    };
    folder.files.push(fileInfo);
    res.status(201).json(fileInfo);
  });
});

// Delete a file from a folder
app.delete('/api/folders/:folderId/files/:fileId', fileLimiter, (req, res) => {
  const folder = folders[req.params.folderId];
  if (!folder) return res.status(404).json({ error: 'Folder not found' });

  const fileIdx = folder.files.findIndex(f => f.id === req.params.fileId);
  if (fileIdx === -1) return res.status(404).json({ error: 'File not found' });

  const fileInfo = folder.files[fileIdx];
  const filePath = path.join(uploadsDir, req.params.folderId, fileInfo.name);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
  folder.files.splice(fileIdx, 1);
  res.json({ success: true });
});

// ─── Start Server ─────────────────────────────────────────────────────────────

const PORT = config.server.port;
app.listen(PORT, () => {
  console.log(`Chat app running at http://localhost:${PORT}`);
  if (!config.openai.apiKey) {
    console.warn('Warning: OPENAI_API_KEY is not set. Copy .env.example to .env and add your key.');
  }
});

module.exports = app;
