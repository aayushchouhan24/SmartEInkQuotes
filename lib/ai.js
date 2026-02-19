const https = require('https');

// ── HTTP helpers ────────────────────────────────────────────────────────────

function httpsPost(url, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const data = JSON.stringify(body);
    const opts = {
      hostname: u.hostname,
      path: u.pathname + u.search,
      method: 'POST',
      headers: {
        ...headers,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
      },
    };
    const req = https.request(opts, (res) => {
      let buf = '';
      res.on('data', (c) => (buf += c));
      res.on('end', () => {
        if (res.statusCode >= 400) reject(new Error(`HTTP ${res.statusCode}: ${buf}`));
        else {
          try {
            resolve(JSON.parse(buf));
          } catch {
            resolve(buf);
          }
        }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function httpsGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return httpsGet(res.headers.location).then(resolve, reject);
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    }).on('error', reject);
  });
}

// ── Quote dedup ─────────────────────────────────────────────────────────────

const recentQuotes = new Set();
const MAX_RECENT = 50;

function addRecent(q) {
  recentQuotes.add(q.toLowerCase());
  if (recentQuotes.size > MAX_RECENT) {
    recentQuotes.delete(recentQuotes.values().next().value);
  }
}

// ── Quote Generation (Scitely AI → PUTER → Yurippe) ─────────────────────────

async function generateQuote(aiSettings = {}) {
  const { quoteTypes = [], animeList = [], temperature = 1.0 } = aiSettings;
  const SCITELY_KEY = process.env.SCITELY_API_KEY;
  const PUTER_TOKEN = process.env.PUTER_AUTH_TOKEN;

  // PRIMARY: Scitely AI
  if (SCITELY_KEY) {
    console.log('[scitely] Attempting with key:', SCITELY_KEY.substring(0, 10) + '...');
    const theme = quoteTypes.length > 0 
      ? quoteTypes[Math.floor(Math.random() * quoteTypes.length)]
      : 'anime';
    
    const animeStr = animeList.length > 0 
      ? animeList.join(', ')
      : 'any popular anime';

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        console.log(`[scitely attempt ${attempt}] sending request...`);
        const resp = await httpsPost(
          'https://api.scitely.com/v1/chat/completions',
          {
            model: 'deepseek-v3.2',
            messages: [
              {
                role: 'user',
                content:
                  `Generate ONE unique profound anime quote about ${theme} (max 70 characters). ` +
                  `Format: quote - Character, Anime. ` +
                  (animeList.length > 0 ? `Pick from: ${animeStr}. ` : '') +
                  `BE CREATIVE and vary your choices. Just the quote, nothing else.`,
              },
            ],
            max_tokens: 80,
            temperature: Math.min(temperature + attempt * 0.1, 2.0),
          },
          { Authorization: `Bearer ${SCITELY_KEY}` },
        );

        console.log(`[scitely attempt ${attempt}] Response:`, JSON.stringify(resp, null, 2));

        const msg = resp.choices?.[0]?.message;
        const quote = (msg?.content || msg?.reasoning_content || '').trim();

        if (quote && quote.length <= 75 && !recentQuotes.has(quote.toLowerCase())) {
          addRecent(quote);
          console.log('[scitely] Got quote');
          return quote;
        }
        console.log(`[scitely attempt ${attempt}] quote too long or duplicate, retrying...`);
      } catch (e) {
        console.error(`[scitely attempt ${attempt}]`, e.message);
      }
    }
  } else {
    console.log('[scitely] Skipped - no API key');
  }

  // FALLBACK 1: PUTER AI
  if (PUTER_TOKEN) {
    console.log('[puter] Attempting...');
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const theme = quoteTypes.length > 0 
          ? quoteTypes[Math.floor(Math.random() * quoteTypes.length)]
          : 'anime';

        const resp = await httpsPost(
          'https://api.puter.com/ai/chat',
          {
            model: 'gpt-4o-mini',
            messages: [
              {
                role: 'system',
                content: 'You generate short anime quotes in format: quote - Character, Anime',
              },
              {
                role: 'user',
                content: `Generate ONE profound anime quote about ${theme} (max 70 chars). Format: quote - Character, Anime. Just the quote.`,
              },
            ],
            max_tokens: 80,
          },
          { 
            Authorization: `Bearer ${PUTER_TOKEN}`,
            'Content-Type': 'application/json',
          },
        );

        console.log(`[puter attempt ${attempt}] Response:`, JSON.stringify(resp, null, 2));

        const quote = resp.choices?.[0]?.message?.content?.trim();
        if (quote && quote.length <= 75 && !recentQuotes.has(quote.toLowerCase())) {
          addRecent(quote);
          console.log('[puter] Got quote');
          return quote;
        }
      } catch (e) {
        console.error(`[puter attempt ${attempt}]`, e.message);
      }
    }
  } else {
    console.log('[puter] Skipped - no auth token');
  }

  // FALLBACK 2: Katanagari Anime Quotes API
  console.log('[katanagari] Attempting...');
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const buf = await httpsGet('https://katanagari.vercel.app/api/quote/random');
      const data = JSON.parse(buf.toString());
      
      if (data.quote && data.character && data.anime) {
        const quote = `${data.quote} - ${data.character}, ${data.anime}`;
        
        if (quote.length <= 75 && !recentQuotes.has(quote.toLowerCase())) {
          addRecent(quote);
          console.log('[katanagari] Got quote');
          return quote;
        }
      }
    } catch (e) {
      console.error(`[katanagari attempt ${attempt}]`, e.message);
    }
  }

  throw new Error('All quote sources failed - Scitely, PUTER, and Katanagari unavailable');
}

// ── Scene Description (Scitely) ────────────────────────────────────────────

async function generateScene(quote) {
  const SCITELY_KEY = process.env.SCITELY_API_KEY;
  if (!SCITELY_KEY) {
    const parts = quote.split(' - ');
    const character = parts[1]?.split(',')[0]?.trim() || 'anime character';
    return `${character} in dramatic cinematic moment, bold lines, high contrast`;
  }

  try {
    const resp = await httpsPost(
      'https://api.scitely.com/v1/chat/completions',
      {
        model: 'deepseek-v3.2',
        messages: [
          {
            role: 'user',
            content:
              `Based on this anime quote: "${quote}"\n` +
              'Describe a dramatic visual anime scene (12-18 words). ' +
              'Include character, setting, action/pose, emotion. Cinematic. Just the description.',
          },
        ],
        max_tokens: 60,
        temperature: 1.0,
      },
      { Authorization: `Bearer ${SCITELY_KEY}` },
    );

    const msg = resp.choices?.[0]?.message;
    return (msg?.content || msg?.reasoning_content || '').trim() || 'dramatic anime scene';
  } catch (e) {
    console.error('[scene error]', e.message);
    return 'dramatic anime character in cinematic pose, dark atmosphere, bold lines';
  }
}

// ── Image Generation (Pixazo / Flux Schnell) ────────────────────────────────

async function generateImage(prompt, style = 'anime') {
  const PIXAZO_KEY = process.env.PIXAZO_API_KEY;
  if (!PIXAZO_KEY) throw new Error('PIXAZO_API_KEY not configured');

  const stylePrefix =
    style === 'anime'
      ? 'Anime/manga style illustration for e-ink display. High contrast, bold lines, clear shapes, no fine details, no text. Black and white. Wide cinematic composition.'
      : 'Illustration for e-ink display. High contrast, bold lines, clear shapes. Black and white. Wide composition.';

  const resp = await httpsPost(
    'https://gateway.pixazo.ai/flux-1-schnell/v1/getData',
    {
      prompt: `${stylePrefix} Scene: ${prompt}`,
      num_steps: 4,
      width: 640,
      height: 256,
    },
    {
      'Cache-Control': 'no-cache',
      'Ocp-Apim-Subscription-Key': PIXAZO_KEY,
    },
  );

  if (!resp.output) throw new Error('No image URL from Pixazo');
  console.log('[pixazo]', resp.output);
  return httpsGet(resp.output);
}

module.exports = { generateQuote, generateScene, generateImage };
