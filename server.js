require('dotenv').config();
const express = require('express');
const rateLimit = require('express-rate-limit');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const OpenAI = require('openai');
const config = require('./config');
const path = require('path');

const app = express();
const upload = multer();

const openai = new OpenAI({ apiKey: config.openaiApiKey });

// In-memory conversation store: conversationId -> { messages, turns }
// turns: [{ id, role, content, thinking, timestamp }]
const conversations = new Map();

// Rate limiter
const limiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.max,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
});

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/api', limiter);

// Helper: extract <thinking> block from model response
function extractThinking(text) {
  const thinkingMatch = text.match(/<thinking>([\s\S]*?)<\/thinking>/i);
  if (!thinkingMatch) {
    return { thinking: null, content: text.trim() };
  }
  const thinking = thinkingMatch[1].trim();
  const content = text.replace(/<thinking>[\s\S]*?<\/thinking>/i, '').trim();
  return { thinking, content };
}

// System prompt that asks the model to reason before answering
const THINKING_SYSTEM_PROMPT = `You are a helpful assistant. Before answering, wrap your step-by-step reasoning and planning inside <thinking>...</thinking> tags. Then provide your final answer outside those tags.

Example format:
<thinking>
Let me think through this step by step...
[your reasoning here]
</thinking>
[your actual answer here]`;

// POST /api/conversations - create a new conversation
app.post('/api/conversations', (req, res) => {
  const id = uuidv4();
  conversations.set(id, { messages: [], turns: [] });
  res.json({ conversationId: id });
});

// GET /api/conversations/:id - get conversation turns
app.get('/api/conversations/:id', (req, res) => {
  const conv = conversations.get(req.params.id);
  if (!conv) return res.status(404).json({ error: 'Conversation not found' });
  res.json({ turns: conv.turns });
});

// POST /api/conversations/:id/messages - send a message
app.post('/api/conversations/:id/messages', upload.none(), async (req, res) => {
  const conv = conversations.get(req.params.id);
  if (!conv) return res.status(404).json({ error: 'Conversation not found' });

  const { message } = req.body;
  if (!message || typeof message !== 'string' || !message.trim()) {
    return res.status(400).json({ error: 'Message is required' });
  }

  const userTurn = {
    id: uuidv4(),
    role: 'user',
    content: message.trim(),
    thinking: null,
    timestamp: new Date().toISOString(),
  };
  conv.turns.push(userTurn);
  conv.messages.push({ role: 'user', content: message.trim() });

  try {
    // Build messages array for OpenAI
    const apiMessages = [
      { role: 'system', content: THINKING_SYSTEM_PROMPT },
      ...conv.messages,
    ];

    const completion = await openai.chat.completions.create({
      model: config.model,
      messages: apiMessages,
      max_tokens: config.maxTokens,
    });

    const rawResponse = completion.choices[0].message.content || '';
    const { thinking, content } = extractThinking(rawResponse);

    const assistantTurn = {
      id: uuidv4(),
      role: 'assistant',
      content,
      thinking,
      timestamp: new Date().toISOString(),
    };
    conv.turns.push(assistantTurn);

    // Store only the clean response in message history
    conv.messages.push({ role: 'assistant', content });

    res.json({ turn: assistantTurn, userTurn });
  } catch (err) {
    console.error('OpenAI error:', err.message);
    const statusCode = err.status || 500;
    res.status(statusCode).json({ error: err.message || 'Failed to get response from AI' });
  }
});

// GET /api/conversations/:id/turns/:turnId/thinking - get thinking for a specific turn
app.get('/api/conversations/:id/turns/:turnId/thinking', (req, res) => {
  const conv = conversations.get(req.params.id);
  if (!conv) return res.status(404).json({ error: 'Conversation not found' });

  const turn = conv.turns.find(t => t.id === req.params.turnId);
  if (!turn) return res.status(404).json({ error: 'Turn not found' });

  res.json({ thinking: turn.thinking, role: turn.role, content: turn.content });
});

app.listen(config.port, () => {
  console.log(`Chat app running on http://localhost:${config.port}`);
});
