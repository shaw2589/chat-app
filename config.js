require('dotenv').config();

const config = {
  openai: {
    apiKey: process.env.OPENAI_API_KEY || '',
    model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
  },
  server: {
    port: process.env.PORT || 3000,
  },
  folders: {
    maxFilesPerFolder: 10,
    uploadsDir: process.env.UPLOADS_DIR || 'uploads',
  },
};

module.exports = config;
