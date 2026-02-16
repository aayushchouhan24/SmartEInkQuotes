const https = require('https');

// ── HTTP helpers ────────────────────────────────────────────────────────────
// Use native fetch (available in Node 18+ / Vercel) for JSON APIs to avoid
// Cloudflare bot-detection issues. Fall back to raw https for binary (images).

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

async function httpsPost(url, body, headers = {}) {
    // Prefer native fetch (works better on Vercel with Cloudflare)
    if (typeof globalThis.fetch === 'function') {
        const resp = await globalThis.fetch(url, {
            method: 'POST',
            headers: {
                'User-Agent': UA,
                'Accept': 'application/json',
                'Accept-Language': 'en-US,en;q=0.9',
                'Content-Type': 'application/json',
                ...headers,
            },
            body: JSON.stringify(body),
        });
        const text = await resp.text();
        if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${text.slice(0, 200)}`);
        if (text.startsWith('<')) throw new Error(`Got HTML instead of JSON (status ${resp.status})`);
        try { return JSON.parse(text); } catch { return text; }
    }

    // Fallback: raw https (local dev on older Node)
    return new Promise((resolve, reject) => {
        const u = new URL(url);
        const data = JSON.stringify(body);
        const opts = {
            hostname: u.hostname,
            path: u.pathname + u.search,
            method: 'POST',
            headers: {
                'User-Agent': UA,
                'Accept': 'application/json',
                'Accept-Language': 'en-US,en;q=0.9',
                ...headers,
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(data),
            },
        };
        const req = https.request(opts, (res) => {
            let buf = '';
            res.on('data', (c) => (buf += c));
            res.on('end', () => {
                if (res.statusCode >= 400) reject(new Error(`HTTP ${res.statusCode}: ${buf.slice(0, 200)}`));
                else {
                    try { resolve(JSON.parse(buf)); } catch { resolve(buf); }
                }
            });
        });
        req.on('error', reject);
        req.write(data);
        req.end();
    });
}

async function httpsGetJson(url) {
    // Prefer native fetch for JSON
    if (typeof globalThis.fetch === 'function') {
        const resp = await globalThis.fetch(url, {
            headers: { 'User-Agent': UA, 'Accept': 'application/json' },
        });
        const text = await resp.text();
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        if (text.startsWith('<')) throw new Error('Got HTML instead of JSON');
        return JSON.parse(text);
    }

    // Fallback: raw https
    const buf = await httpsGetBinary(url, 'application/json');
    const text = buf.toString();
    if (text.startsWith('<')) throw new Error('Got HTML instead of JSON');
    return JSON.parse(text);
}

function httpsGetBinary(url, accept = 'image/*') {
    return new Promise((resolve, reject) => {
        const u = new URL(url);
        const opts = {
            hostname: u.hostname,
            path: u.pathname + u.search,
            headers: { 'User-Agent': UA, 'Accept': accept },
        };
        https.get(opts, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                return httpsGetBinary(res.headers.location, accept).then(resolve, reject);
            }
            if (res.statusCode >= 400) {
                let buf = '';
                res.on('data', (c) => (buf += c));
                res.on('end', () => reject(new Error(`HTTP ${res.statusCode}`)));
                return;
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

// ── Fallback APIs ───────────────────────────────────────────────────────────

async function tryPuterAI(promptContent) {
    const PUTER_TOKEN = process.env.PUTER_AUTH_TOKEN;
    if (!PUTER_TOKEN) return null;

    try {
        console.log('[Puter] Trying Puter AI (GPT-4o-mini)...');
        const resp = await httpsPost(
            'https://api.puter.com/drivers/call',
            {
                interface: 'puter-chat-completion',
                driver: 'openai-gpt-4o-mini',
                method: 'complete',
                args: {
                    messages: [{ role: 'user', content: promptContent }],
                    max_tokens: 80,
                    temperature: 1.0,
                },
            },
            { Authorization: `Bearer ${PUTER_TOKEN}` },
        );

        const quote = resp?.message?.content?.trim();
        if (quote && quote.length <= 75) {
            console.log('[Puter] Success:', quote);
            return quote;
        }
    } catch (e) {
        console.error('[Puter] Failed:', e.message);
    }
    return null;
}

async function fetchYurippeFallback() {
    try {
        console.log('[Yurippe] Trying Yurippe fallback API...');
        const data = await httpsGetJson('https://yurippe.vercel.app/api/quotes?random=1');
        if (data.quote) {
            const quote = `${data.quote} - ${data.character || 'Unknown'}, ${data.anime || 'Unknown'}`;
            console.log('[Yurippe] Success:', quote);
            return quote;
        }
    } catch (e) {
        console.error('[Yurippe] Failed:', e.message);
    }
    return null;
}

// ── Quote Generation (Scitely / deepseek) ───────────────────────────────────

async function generateQuote(aiSettings = {}) {
    const { quoteTypes = [], animeList = [], temperature = 1.0 } = aiSettings;
    const SCITELY_KEY = process.env.SCITELY_API_KEY;
    const SCITELY_KEY_2 = process.env.SCITELY_API_KEY_BACKUP;
    
    // Build prompt based on user restrictions
    let themePrompt = '';
    let animePrompt = '';

    if (quoteTypes.length > 0) {
        const theme = quoteTypes[Math.floor(Math.random() * quoteTypes.length)];
        themePrompt = `about ${theme}`;
    } else {
        themePrompt = 'on any theme (life, death, dreams, hope, love, friendship, struggle, etc)';
    }

    if (animeList.length > 0) {
        animePrompt = `Pick from: ${animeList.join(', ')}.`;
    } else {
        animePrompt = 'Pick from any popular anime series.';
    }

    const promptContent = 
        `Generate ONE unique profound anime quote ${themePrompt} (max 70 characters). ` +
        `Format: quote - Character, Anime. ` +
        `${animePrompt} ` +
        `BE CREATIVE and vary your choices. Just the quote, nothing else.`;

    // Try both Scitely keys
    const keys = [SCITELY_KEY, SCITELY_KEY_2].filter(Boolean);
    
    for (const key of keys) {
        for (let attempt = 0; attempt < 3; attempt++) {
            try {
                const resp = await httpsPost(
                    'https://api.scitely.com/v1/chat/completions',
                    {
                        model: 'deepseek-v3.2',
                        messages: [
                            {
                                role: 'user',
                                content: promptContent,
                            },
                        ],
                        max_tokens: 80,
                        temperature: Math.min(temperature + attempt * 0.1, 2.0),
                    },
                    { Authorization: `Bearer ${key}` },
                );

                const msg = resp.choices?.[0]?.message;
                const quote = (msg?.content || msg?.reasoning_content || '').trim();

                if (quote && quote.length <= 75 && !recentQuotes.has(quote.toLowerCase())) {
                    addRecent(quote);
                    console.log(`[quote] Success with key ${keys.indexOf(key) + 1}, attempt ${attempt + 1}`);
                    return quote;
                }
            } catch (e) {
                console.error(`[quote] Key ${keys.indexOf(key) + 1}, attempt ${attempt + 1}/3: ${e.message}`);
            }
        }
    }

    // All Scitely attempts failed - try Puter AI, then Yurippe
    console.warn('[quote] All Scitely keys failed, trying fallbacks...');
    
    const puterQuote = await tryPuterAI(promptContent);
    if (puterQuote) {
        addRecent(puterQuote);
        return puterQuote;
    }
    
    const yurippeFallback = await fetchYurippeFallback();
    if (yurippeFallback) {
        addRecent(yurippeFallback);
        return yurippeFallback;
    }
    
    console.error('[quote] All APIs failed (Scitely, Puter, Yurippe)');
    return "Unable to generate quote - all APIs failed";
}

// ── Scene Description (Scitely) ────────────────────────────────────────────

async function generateScene(quote) {
    const keys = [process.env.SCITELY_API_KEY, process.env.SCITELY_API_KEY_BACKUP].filter(Boolean);
    
    if (keys.length === 0) {
        const parts = quote.split(' - ');
        const character = parts[1]?.split(',')[0]?.trim() || 'anime character';
        return `${character} in dramatic cinematic moment, bold lines, high contrast`;
    }

    for (const key of keys) {
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
                { Authorization: `Bearer ${key}` },
            );

            const msg = resp.choices?.[0]?.message;
            const scene = (msg?.content || msg?.reasoning_content || '').trim();
            if (scene) {
                console.log(`[scene] Success with key ${keys.indexOf(key) + 1}`);
                return scene;
            }
        } catch (e) {
            console.error(`[scene] Key ${keys.indexOf(key) + 1} failed:`, e.message);
        }
    }

    // Fallback: extract character from quote and build a generic scene
    console.warn('[scene] All keys failed, using quote-derived fallback');
    const parts = quote.split(' - ');
    const character = parts[1]?.split(',')[0]?.trim() || 'anime character';
    const anime = parts[1]?.split(',')[1]?.trim() || 'anime';
    return `${character} from ${anime} in dramatic cinematic moment, dark atmosphere, bold lines, high contrast`;
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
    return httpsGetBinary(resp.output);
}

module.exports = { generateQuote, generateScene, generateImage };
