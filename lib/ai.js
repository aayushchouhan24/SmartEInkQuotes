/* ═══════════════════════════════════════════════════════════════════════════ */
/* AI Service — Multi-Provider Text AI + Pixazo Image AI                     */
/*                                                                           */
/* Text Providers (cascading fallback):                                      */
/*   1. Google Gemini        (GOOGLE_API_KEY)                                */
/*   2. Scitely  — primary   (SCITELY_API_KEY)                              */
/*   3. Scitely  — backup    (SCITELY_API_KEY_BACKUP)                       */
/*                                                                           */
/* Image Provider:                                                           */
/*   1. Pixazo               (PIXAZO_API_KEY)                               */
/* ═══════════════════════════════════════════════════════════════════════════ */

const https = require('https');

// ═════════════════════════════════════════════════════════════════════════════
// HTTP HELPERS
// ═════════════════════════════════════════════════════════════════════════════

/**
 * POST JSON to a URL and return the parsed response.
 */
function httpPost(url, body, headers = {}) {
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
        if (res.statusCode >= 400) {
          reject(new Error(`HTTP ${res.statusCode}: ${buf.slice(0, 300)}`));
        } else {
          try { resolve(JSON.parse(buf)); }
          catch { resolve(buf); }
        }
      });
    });

    req.setTimeout(30_000, () => { req.destroy(); reject(new Error('Request timed out')); });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

/**
 * GET a URL and return raw Buffer. Follows one redirect.
 */
function httpGet(url) {
  return new Promise((resolve, reject) => {
    const get = (href) => {
      https.get(href, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return get(res.headers.location);
        }
        if (res.statusCode >= 400) {
          let buf = '';
          res.on('data', (c) => (buf += c));
          res.on('end', () => reject(new Error(`HTTP ${res.statusCode}: ${buf.slice(0, 200)}`)));
          return;
        }
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks)));
      }).on('error', reject);
    };
    get(url);
  });
}


// ═════════════════════════════════════════════════════════════════════════════
// TEXT AI — PROVIDER DEFINITIONS
// ═════════════════════════════════════════════════════════════════════════════
// Each provider exposes:
//   name        — display name for logging
//   envKey      — environment variable name (for status checks)
//   available() — returns true if the env key is set
//   chat(systemPrompt, userPrompt, opts) — returns string response
// ═════════════════════════════════════════════════════════════════════════════

const TEXT_PROVIDERS = [

  // ── 1. Google Gemini ────────────────────────────────────────────────────
  {
    name: 'Google Gemini',
    envKey: 'GOOGLE_API_KEY',
    available() { return !!process.env.GOOGLE_API_KEY; },

    async chat(system, user, opts = {}) {
      const key = process.env.GOOGLE_API_KEY;
      const resp = await httpPost(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${key}`,
        {
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: 'user', parts: [{ text: user }] }],
          generationConfig: {
            maxOutputTokens: opts.maxTokens || 120,
            temperature: opts.temperature || 1.0,
          },
        },
      );
      const text = resp?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) throw new Error('Empty Gemini response');
      return text.trim();
    },
  },

  // ── 2. Scitely — Primary Key ───────────────────────────────────────────
  {
    name: 'Scitely',
    envKey: 'SCITELY_API_KEY',
    available() { return !!process.env.SCITELY_API_KEY; },

    async chat(system, user, opts = {}) {
      const resp = await httpPost(
        'https://api.scitely.com/v1/chat/completions',
        {
          model: 'deepseek-v3.2',
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
          max_tokens: opts.maxTokens || 120,
          temperature: opts.temperature || 1.0,
        },
        { Authorization: `Bearer ${process.env.SCITELY_API_KEY}` },
      );
      const msg = resp?.choices?.[0]?.message;
      const text = msg?.content || msg?.reasoning_content || '';
      if (!text) throw new Error('Empty Scitely response');
      return text.trim();
    },
  },

  // ── 3. Scitely — Backup Key ────────────────────────────────────────────
  {
    name: 'Scitely Backup',
    envKey: 'SCITELY_API_KEY_BACKUP',
    available() { return !!process.env.SCITELY_API_KEY_BACKUP; },

    async chat(system, user, opts = {}) {
      const resp = await httpPost(
        'https://api.scitely.com/v1/chat/completions',
        {
          model: 'deepseek-v3.2',
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
          max_tokens: opts.maxTokens || 120,
          temperature: opts.temperature || 1.0,
        },
        { Authorization: `Bearer ${process.env.SCITELY_API_KEY_BACKUP}` },
      );
      const msg = resp?.choices?.[0]?.message;
      const text = msg?.content || msg?.reasoning_content || '';
      if (!text) throw new Error('Empty Scitely-Backup response');
      return text.trim();
    },
  },

];


// ═════════════════════════════════════════════════════════════════════════════
// TEXT AI — CORE ENGINE (try every provider in order)
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Run a text prompt through all available providers until one succeeds.
 * @param {string} system  — system prompt
 * @param {string} user    — user prompt
 * @param {object} opts    — { maxTokens, temperature }
 * @returns {{ text: string, provider: string }}
 */
async function textAI(system, user, opts = {}) {
  const errors = [];

  for (const provider of TEXT_PROVIDERS) {
    if (!provider.available()) {
      console.log(`[ai] ${provider.name} — skipped (no ${provider.envKey})`);
      continue;
    }

    try {
      console.log(`[ai] ${provider.name} — requesting...`);
      const text = await provider.chat(system, user, opts);
      console.log(`[ai] ${provider.name} — ✓ OK (${text.length} chars)`);
      return { text, provider: provider.name };
    } catch (err) {
      console.error(`[ai] ${provider.name} — ✗ FAILED: ${err.message}`);
      errors.push({ provider: provider.name, error: err.message });
    }
  }

  const summary = errors.map((e) => `${e.provider}: ${e.error}`).join(' | ');
  throw new Error(`All text AI providers failed → ${summary}`);
}


// ═════════════════════════════════════════════════════════════════════════════
// QUOTE GENERATION
// ═════════════════════════════════════════════════════════════════════════════

const recentQuotes = new Set();
const MAX_RECENT = 50;

function trackQuote(q) {
  recentQuotes.add(q.toLowerCase());
  if (recentQuotes.size > MAX_RECENT) {
    recentQuotes.delete(recentQuotes.values().next().value);
  }
}

/**
 * Generate a unique anime quote using all available text AI providers.
 * Retries up to 3 times (shuffling temperature) before failing.
 */
async function generateQuote(aiSettings = {}) {
  const { quoteTypes = [], animeList = [], temperature = 1.0 } = aiSettings;

  const defaultThemes = ['dark', 'motivational', 'melancholy', 'courage', 'love', 'solitude', 'power', 'destiny'];
  const theme = quoteTypes.length > 0
    ? quoteTypes[Math.floor(Math.random() * quoteTypes.length)]
    : defaultThemes[Math.floor(Math.random() * defaultThemes.length)];

  const animeStr = animeList.length > 0
    ? `Pick ONLY from these anime: ${animeList.join(', ')}.`
    : 'Pick from any well-known anime (Naruto, Death Note, Attack on Titan, Fullmetal Alchemist, One Piece, Bleach, Steins;Gate, Cowboy Bebop, Evangelion, Jujutsu Kaisen, Demon Slayer, Violet Evergarden, Code Geass, Hunter x Hunter, Tokyo Ghoul, etc.).';

  const system =
    'You are an anime quote expert. You output ONLY the quote line — nothing else. ' +
    'No markdown, no quotation marks wrapping it, no numbering, no commentary, no extra text. ' +
    'Format exactly: <quote text> - <Character>, <Anime>';

  for (let attempt = 0; attempt < 3; attempt++) {
    const temp = Math.min(temperature + attempt * 0.15, 2.0);

    const user =
      `Generate ONE unique, profound anime quote about "${theme}" (maximum 70 characters total including the attribution). ` +
      `${animeStr} ` +
      `The quote must be deep, memorable, and emotionally impactful. ` +
      `Format strictly: quote text - Character, Anime ` +
      `Be creative — do NOT repeat common overused quotes. Vary your character and anime choices randomly.` +
      (attempt > 0 ? ` (Attempt ${attempt + 1} — pick something COMPLETELY different this time.)` : '');

    try {
      const { text: raw, provider } = await textAI(system, user, { maxTokens: 90, temperature: temp });

      // Clean up: strip wrapping quotes, markdown, numbering
      let quote = raw
        .replace(/^["'""\u201C\u201D]+|["'""\u201C\u201D]+$/g, '')
        .replace(/^\d+\.\s*/, '')
        .replace(/\*+/g, '')
        .trim();

      // Validate format (should contain " - ")
      if (!quote.includes(' - ')) {
        console.log(`[quote] ✗ bad format from ${provider}: "${quote.slice(0, 60)}", retrying...`);
        continue;
      }

      if (quote.length > 80) {
        console.log(`[quote] ✗ too long (${quote.length} chars), retrying...`);
        continue;
      }

      if (recentQuotes.has(quote.toLowerCase())) {
        console.log(`[quote] ✗ duplicate, retrying...`);
        continue;
      }

      trackQuote(quote);
      console.log(`[quote] ✓ via ${provider}: ${quote}`);
      return quote;
    } catch (err) {
      console.error(`[quote attempt ${attempt}]`, err.message);
      if (attempt === 2) throw err;
    }
  }

  throw new Error('Failed to generate a valid quote after 3 attempts');
}


// ═════════════════════════════════════════════════════════════════════════════
// IMAGE PROMPT GENERATION (from quote)
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Given a quote, generate a detailed visual scene description for the image AI.
 * The prompt is crafted to be DEEPLY related to the quote's emotion and meaning.
 */
async function generateImagePrompt(quote) {
  const system =
    'You are a visual scene designer for anime art. ' +
    'You output ONLY a short scene description (15-25 words) — nothing else. ' +
    'No markdown, no labels, no commentary. Just the raw visual description.';

  const user =
    `Anime quote: "${quote}"\n\n` +
    'Describe a dramatic, cinematic anime scene that PERFECTLY captures this quote\'s emotion and meaning. ' +
    'Include: the character (or silhouette), their pose/expression, the environment, lighting, and mood. ' +
    'The image must visually TELL the same story as the quote. ' +
    'Keep it 15-25 words. Optimize for high-contrast black & white illustration.';

  try {
    const { text, provider } = await textAI(system, user, { maxTokens: 60, temperature: 0.9 });
    console.log(`[scene] ✓ via ${provider}: ${text}`);
    return text;
  } catch (err) {
    // Graceful fallback: extract character name from quote and build a generic scene
    console.error('[scene] All providers failed, using fallback:', err.message);
    const parts = quote.split(' - ');
    const character = parts[1]?.split(',')[0]?.trim() || 'anime character';
    return `${character} standing alone in dramatic cinematic moment, bold lines, high contrast, emotional atmosphere`;
  }
}


// ═════════════════════════════════════════════════════════════════════════════
// IMAGE GENERATION — PIXAZO
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Generate an image from a scene prompt using Pixazo AI.
 * Returns a raw image Buffer (PNG/JPEG).
 */
async function generateImage(prompt, style = 'anime') {
  const PIXAZO_KEY = process.env.PIXAZO_API_KEY;
  if (!PIXAZO_KEY) throw new Error('PIXAZO_API_KEY not configured');

  const styleMap = {
    anime:
      'Anime/manga style illustration for e-ink display. ' +
      'High contrast, bold clean lines, clear shapes, no fine grain detail, no text overlays. ' +
      'Black and white only. Wide cinematic 5:2 composition.',
    realistic:
      'Photorealistic illustration for e-ink display. ' +
      'High contrast, sharp edges, clear subjects. Black and white only. Wide composition.',
    minimalist:
      'Minimalist line-art illustration for e-ink display. ' +
      'Very bold strokes, simple geometric shapes, maximum contrast. Black and white. Wide composition.',
  };

  const stylePrefix = styleMap[style] || styleMap.anime;
  const fullPrompt = `${stylePrefix} Scene: ${prompt}`;

  console.log(`[pixazo] Generating image...`);
  console.log(`[pixazo] Prompt: ${fullPrompt.slice(0, 150)}...`);

  const resp = await httpPost(
    'https://gateway.pixazo.ai/flux-1-schnell/v1/getData',
    {
      prompt: fullPrompt,
      num_steps: 4,
      width: 640,
      height: 256,
    },
    {
      'Cache-Control': 'no-cache',
      'Ocp-Apim-Subscription-Key': PIXAZO_KEY,
    },
  );

  if (!resp.output) throw new Error('No image URL returned from Pixazo');

  console.log(`[pixazo] ✓ Downloading from: ${resp.output}`);
  return httpGet(resp.output);
}


// ═════════════════════════════════════════════════════════════════════════════
// PROVIDER STATUS (for startup banner / diagnostics)
// ═════════════════════════════════════════════════════════════════════════════

function getProviderStatus() {
  const text = TEXT_PROVIDERS.map((p) => ({
    name: p.name,
    envKey: p.envKey,
    available: p.available(),
  }));

  return {
    text,
    image: {
      name: 'Pixazo',
      envKey: 'PIXAZO_API_KEY',
      available: !!process.env.PIXAZO_API_KEY,
    },
    textAvailable: text.filter((p) => p.available).length,
    totalProviders: text.length + 1,
  };
}


// ═════════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═════════════════════════════════════════════════════════════════════════════

module.exports = {
  generateQuote,
  generateImagePrompt,
  generateImage,
  getProviderStatus,
  textAI,
  TEXT_PROVIDERS,
};
