const { generateQuote, generateImagePrompt, generateImage, getProviderStatus, textAI, TEXT_PROVIDERS } = require('../lib/ai');
const { cors } = require('../lib/auth');

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const results = {
    timestamp: new Date().toISOString(),
    providers: getProviderStatus(),
    tests: {},
  };

  // ── Test 1: Individual provider ping ──────────────────────────────────
  results.tests.providers = [];
  for (const provider of TEXT_PROVIDERS) {
    if (!provider.available()) {
      results.tests.providers.push({ name: provider.name, status: 'skipped', reason: `No ${provider.envKey}` });
      continue;
    }
    try {
      console.log(`[test-ai] Pinging ${provider.name}...`);
      const start = Date.now();
      const text = await provider.chat(
        'Reply with exactly: OK',
        'Say OK',
        { maxTokens: 10, temperature: 0 },
      );
      const ms = Date.now() - start;
      results.tests.providers.push({ name: provider.name, status: 'ok', response: text, latencyMs: ms });
      console.log(`[test-ai] ${provider.name}: OK (${ms}ms)`);
    } catch (e) {
      results.tests.providers.push({ name: provider.name, status: 'error', error: e.message });
      console.error(`[test-ai] ${provider.name}: FAIL —`, e.message);
    }
  }

  // ── Test 2: Quote generation (full pipeline) ─────────────────────────
  try {
    console.log('[test-ai] Testing quote generation...');
    const start = Date.now();
    const quote = await generateQuote({ quoteTypes: [], animeList: [], temperature: 1.0 });
    results.tests.quote = { success: true, data: quote, latencyMs: Date.now() - start };
    console.log('[test-ai] Quote OK:', quote);
  } catch (e) {
    results.tests.quote = { success: false, error: e.message };
    console.error('[test-ai] Quote FAIL:', e.message);
  }

  // ── Test 3: Image prompt generation ───────────────────────────────────
  try {
    console.log('[test-ai] Testing image prompt generation...');
    const start = Date.now();
    const testQuote = results.tests.quote?.data || 'The world is not beautiful, therefore it is. - Kino, Kino\'s Journey';
    const prompt = await generateImagePrompt(testQuote);
    results.tests.imagePrompt = { success: true, data: prompt, latencyMs: Date.now() - start };
    console.log('[test-ai] Image prompt OK:', prompt);
  } catch (e) {
    results.tests.imagePrompt = { success: false, error: e.message };
    console.error('[test-ai] Image prompt FAIL:', e.message);
  }

  // ── Test 4: Image generation (Pixazo) ─────────────────────────────────
  try {
    console.log('[test-ai] Testing image generation...');
    const start = Date.now();
    const testPrompt = results.tests.imagePrompt?.data || 'dramatic anime character in dark atmosphere';
    const imgBuf = await generateImage(testPrompt, 'anime');
    results.tests.image = {
      success: true,
      data: { size: imgBuf.length, type: 'Buffer' },
      latencyMs: Date.now() - start,
    };
    console.log('[test-ai] Image OK, size:', imgBuf.length);
  } catch (e) {
    results.tests.image = { success: false, error: e.message };
    console.error('[test-ai] Image FAIL:', e.message);
  }

  // ── Environment summary ───────────────────────────────────────────────
  results.env = {
    googleKey:       process.env.GOOGLE_API_KEY          ? 'SET' : 'MISSING',
    scitelyKey:      process.env.SCITELY_API_KEY         ? 'SET' : 'MISSING',
    scitelyBackup:   process.env.SCITELY_API_KEY_BACKUP  ? 'SET' : 'MISSING',
    puterToken:      process.env.PUTER_AUTH_TOKEN         ? 'SET' : 'MISSING',
    pixazoKey:       process.env.PIXAZO_API_KEY           ? 'SET' : 'MISSING',
    nodeVersion:     process.version,
  };

  res.json(results);
};
