require('dotenv').config();

module.exports = {
  port: process.env.PORT || 3000,
  openaiApiKey: process.env.OPENAI_API_KEY || '',
  model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
  maxTokens: parseInt(process.env.MAX_TOKENS || '2048', 10),
  rateLimit: {
    windowMs: 15 * 60 * 1000,
    max: parseInt(process.env.RATE_LIMIT_MAX || '100', 10),
  },
};
