const { generateQuote, generateScene, generateImage } = require('../lib/ai');
const { cors } = require('../lib/auth');

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const results = {
    timestamp: new Date().toISOString(),
    tests: {},
  };

  // Test 1: Quote generation
  try {
    console.log('[test-ai] Testing quote generation...');
    const quote = await generateQuote({ quoteTypes: [], animeList: [], temperature: 1.0 });
    results.tests.quote = { success: true, data: quote };
    console.log('[test-ai] Quote OK:', quote);
  } catch (e) {
    results.tests.quote = { success: false, error: e.message, stack: e.stack };
    console.error('[test-ai] Quote FAIL:', e.message);
  }

  // Test 2: Scene generation
  try {
    console.log('[test-ai] Testing scene generation...');
    const scene = await generateScene('The world is not beautiful, therefore it is.');
    results.tests.scene = { success: true, data: scene };
    console.log('[test-ai] Scene OK:', scene);
  } catch (e) {
    results.tests.scene = { success: false, error: e.message };
    console.error('[test-ai] Scene FAIL:', e.message);
  }

  // Test 3: Image generation
  try {
    console.log('[test-ai] Testing image generation...');
    const imgBuf = await generateImage('dramatic anime character in dark atmosphere', 'anime');
    results.tests.image = {
      success: true,
      data: { size: imgBuf.length, type: 'Buffer' },
    };
    console.log('[test-ai] Image OK, size:', imgBuf.length);
  } catch (e) {
    results.tests.image = { success: false, error: e.message };
    console.error('[test-ai] Image FAIL:', e.message);
  }

  // Environment check
  results.env = {
    scitelyKey: process.env.SCITELY_API_KEY ? 'SET' : 'MISSING',
    scitelyKeyBackup: process.env.SCITELY_API_KEY_BACKUP ? 'SET' : 'MISSING',
    pixazoKey: process.env.PIXAZO_API_KEY ? 'SET' : 'MISSING',
    hasFetch: typeof globalThis.fetch === 'function',
    nodeVersion: process.version,
  };

  res.json(results);
};
