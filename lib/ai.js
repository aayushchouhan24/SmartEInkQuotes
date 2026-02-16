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
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
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

function httpsGet(url, accept = 'image/*') {
    return new Promise((resolve, reject) => {
        const u = new URL(url);
        const opts = {
            hostname: u.hostname,
            path: u.pathname + u.search,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': accept,
            },
        };
        https.get(opts, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                return httpsGet(res.headers.location, accept).then(resolve, reject);
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

function httpsGetJson(url) {
    return httpsGet(url, 'application/json').then(buf => {
        const text = buf.toString();
        if (text.startsWith('<')) throw new Error('Got HTML instead of JSON');
        return JSON.parse(text);
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

// ── QuotesAPI fallback ──────────────────────────────────────────────────────

async function fetchQuotesAPI() {
    // Try multiple anime quote APIs in order
    const apis = [
        {
            name: 'AnimeChan',
            url: 'https://animechan.io/api/v1/quotes/random',
            parse: (d) => d.data ? `${d.data.content} - ${d.data.character?.name || 'Unknown'}, ${d.data.anime?.name || 'Unknown'}` : null,
        },
        {
            name: 'Yurippe',
            url: 'https://yurippe.vercel.app/api/quotes/random',
            parse: (d) => d.quote ? `${d.quote} - ${d.character || 'Unknown'}, ${d.anime || 'Unknown'}` : null,
        },
        {
            name: 'Katanime',
            url: 'https://katanime.vercel.app/api/getquote',
            parse: (d) => {
                const r = d.result?.[0] || d;
                return r.quote ? `${r.quote} - ${r.character || 'Unknown'}, ${r.anime || 'Unknown'}` : null;
            },
        },
    ];

    for (const api of apis) {
        try {
            console.log(`[QuotesAPI] Trying ${api.name}...`);
            const data = await httpsGetJson(api.url);
            const quote = api.parse(data);
            if (quote) {
                console.log(`[QuotesAPI] ${api.name} success:`, quote);
                return quote;
            }
        } catch (e) {
            console.error(`[QuotesAPI] ${api.name} failed:`, e.message);
        }
    }
    return null;
}

// ── Quote Generation (Scitely / deepseek) ───────────────────────────────────

async function generateQuote(aiSettings = {}) {
    const { quoteTypes = [], animeList = [], temperature = 1.0 } = aiSettings;
    const SCITELY_KEY = process.env.SCITELY_API_KEY;
    const SCITELY_KEY_2 = process.env.SCITELY_API_KEY_BACKUP;
    
    if (!SCITELY_KEY && !SCITELY_KEY_2) {
        console.warn('[quote] No Scitely keys, using QuotesAPI');
        return await fetchQuotesAPI() || "Error: No API keys configured";
    }

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

    // All Scitely attempts failed - use QuotesAPI
    console.warn('[quote] All Scitely keys failed, trying QuotesAPI...');
    const fallbackQuote = await fetchQuotesAPI();
    
    if (fallbackQuote) {
        console.log('[quote] QuotesAPI success:', fallbackQuote);
        return fallbackQuote;
    }
    
    console.error('[quote] All APIs failed');
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
    return httpsGet(resp.output);
}

module.exports = { generateQuote, generateScene, generateImage };
