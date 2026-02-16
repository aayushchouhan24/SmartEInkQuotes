/*
 * Local Development Server
 * ────────────────────────────────────────────────
 * Serves public/ and routes /api/* to serverless functions.
 * Usage:  node server.dev.js
 */

require('dotenv').config();
const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 8787;

// ── Middleware ───────────────────────────────────────────────────────────────

app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ── API Routes → Serverless handlers ────────────────────────────────────────

const routes = {
  '/api/auth/login':    require('./api/auth/login'),
  '/api/auth/register': require('./api/auth/register'),
  '/api/auth/me':       require('./api/auth/me'),
  '/api/settings':      require('./api/settings'),
  '/api/frame':         require('./api/frame'),
  '/api/quote':         require('./api/quote'),
  '/api/preview':       require('./api/preview'),
  '/api/upload':        require('./api/upload'),
  '/api/test-ai':       require('./api/test-ai'),
};

for (const [route, handler] of Object.entries(routes)) {
  app.all(route, (req, res) => handler(req, res));
}

// ── SPA fallback ────────────────────────────────────────────────────────────

app.get('{*path}', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Start ───────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`\n  ══ EInk Smart Display ══`);
  console.log(`  Local:  http://localhost:${PORT}`);
  console.log(`  Env:    ${process.env.MONGODB_URI ? '✓ MongoDB' : '✗ MongoDB'}`);
  console.log(`  Keys:   ${process.env.SCITELY_API_KEY ? '✓' : '✗'} Scitely | ${process.env.PIXAZO_API_KEY ? '✓' : '✗'} Pixazo\n`);
});
