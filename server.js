require('dotenv').config();
const express = require('express');
const path = require('path');
const { getProviderStatus } = require('./lib/ai');

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
  '/api/generate':      require('./api/generate'),
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
  const status = getProviderStatus();
  const tick = (ok) => (ok ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m');

  console.log('');
  console.log('  ╔══════════════════════════════════════════════╗');
  console.log('  ║         EInk Smart Display  v2.0             ║');
  console.log('  ╚══════════════════════════════════════════════╝');
  console.log('');
  console.log(`  Local:    http://localhost:${PORT}`);
  console.log(`  MongoDB:  ${tick(!!process.env.MONGODB_URI)} ${process.env.MONGODB_URI ? 'Connected' : 'NOT SET'}`);
  console.log('');
  console.log('  ── Text AI Providers ──────────────────────────');
  for (const p of status.text) {
    console.log(`    ${tick(p.available)} ${p.name.padEnd(18)} ${p.available ? 'Ready' : `Missing ${p.envKey}`}`);
  }
  console.log('');
  console.log('  ── Image AI Provider ─────────────────────────');
  console.log(`    ${tick(status.image.available)} ${status.image.name.padEnd(18)} ${status.image.available ? 'Ready' : `Missing ${status.image.envKey}`}`);
  console.log('');
  console.log(`  Text AI:  ${status.textAvailable}/${status.text.length} providers available (fallback chain)`);
  console.log(`  Image AI: ${status.image.available ? '1/1' : '0/1'} provider available`);
  console.log('');
});
