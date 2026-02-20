const { connectDB, User } = require('../lib/db');
const { authenticateDevice, cors } = require('../lib/auth');
const { generateQuote, generateImagePrompt, generateImage } = require('../lib/ai');
const { imageToBitmap, textToBitmap, base64ToBitmap, BITMAP_BYTES } = require('../lib/imaging');
const { writeUserLog } = require('../lib/logs');

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).end();

  const key = req.query.key;
  const user = await authenticateDevice(key);
  if (!user) return res.status(401).send('Invalid device key');

  const { settings } = user;
  const { displayMode, viewType } = settings;

  await writeUserLog(user._id, {
    source: 'device',
    level: 'info',
    event: 'frame.request',
    message: `Device requested frame (mode=${displayMode}, view=${viewType})`,
    meta: { displayMode, viewType },
  });

  // ── Static modes: return cached frame if no refresh needed ────────────────
  if (displayMode !== 0 && !user.needsRefresh && user.lastFrame?.bitmap) {
    const combined = Buffer.concat([
      user.lastFrame.bitmap,
      Buffer.from(user.lastFrame.quote || '', 'utf-8'),
    ]);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('X-Display-Mode', String(displayMode));
    res.setHeader('X-Duration', String(settings.duration));
    await writeUserLog(user._id, {
      source: 'device',
      level: 'info',
      event: 'frame.cached',
      message: 'Returned cached frame (static mode)',
      meta: { displayMode, viewType },
    });
    return res.send(combined);
  }

  try {
    let quote = '';
    let bitmap;

    // ── Mode 0: Full Auto (AI everything) ───────────────────────────────────
    if (displayMode === 0) {
      if (viewType === 'quote') {
        quote = await generateQuote(settings.aiSettings);
        bitmap = Buffer.from(await textToBitmap(quote));
      } else if (viewType === 'image') {
        const tempQuote = await generateQuote(settings.aiSettings);
        const scene = await generateImagePrompt(tempQuote);
        const imgBuf = await generateImage(scene, settings.aiSettings?.imageStyle);
        bitmap = Buffer.from(await imageToBitmap(imgBuf));
      } else {
        // Both: quote + image
        quote = await generateQuote(settings.aiSettings);
        const scene = await generateImagePrompt(quote);
        try {
          const imgBuf = await generateImage(scene, settings.aiSettings?.imageStyle);
          bitmap = Buffer.from(await imageToBitmap(imgBuf));
        } catch (e) {
          console.error('[frame img fallback]', e.message);
          bitmap = Buffer.from(await textToBitmap(quote));
        }
      }

    // ── Mode 1: Custom Quote + AI Image ─────────────────────────────────────
    } else if (displayMode === 1) {
      quote = settings.customQuote || 'Set your custom quote in the web app';
      if (viewType === 'quote') {
        bitmap = Buffer.from(await textToBitmap(quote));
      } else {
        const scene = await generateImagePrompt(quote);
        try {
          const imgBuf = await generateImage(scene, settings.aiSettings?.imageStyle);
          bitmap = Buffer.from(await imageToBitmap(imgBuf));
        } catch (e) {
          console.error('[frame m1 fallback]', e.message);
          bitmap = Buffer.from(await textToBitmap(quote));
        }
      }

    // ── Mode 2: Both Custom (quote + user image) ────────────────────────────
    } else {
      quote = settings.customQuote || '';
      if (settings.customImage) {
        try {
          bitmap = Buffer.from(await base64ToBitmap(settings.customImage));
        } catch (e) {
          console.error('[frame m2 img error]', e.message);
          bitmap = Buffer.from(await textToBitmap(quote || 'Upload an image in the web app'));
        }
      } else {
        bitmap = Buffer.from(await textToBitmap(quote || 'Upload an image in the web app'));
      }
    }

    // ── Save & respond ──────────────────────────────────────────────────────
    await User.findByIdAndUpdate(user._id, {
      needsRefresh: false,
      'lastFrame.bitmap': bitmap,
      'lastFrame.quote': quote,
      'lastFrame.generatedAt': new Date(),
    });

    await writeUserLog(user._id, {
      source: 'server',
      level: 'info',
      event: 'frame.generated',
      message: `Frame generated (mode=${displayMode}, view=${viewType})`,
      meta: {
        quote: quote || '',
        bitmapBytes: bitmap.length,
        duration: settings.duration,
      },
    });

    const quoteBytes = Buffer.from(quote, 'utf-8');
    const combined = Buffer.concat([bitmap, quoteBytes]);

    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('X-Display-Mode', String(displayMode));
    res.setHeader('X-Duration', String(settings.duration));
    console.log(`[frame] mode=${displayMode} view=${viewType} bmp=${bitmap.length} q=${quoteBytes.length}`);
    res.send(combined);
  } catch (err) {
    console.error('[frame error]', err);
    await writeUserLog(user._id, {
      source: 'server',
      level: 'error',
      event: 'frame.error',
      message: `Frame generation error: ${err.message}`,
    });
    try {
      const fallback = 'Error generating content — check API keys';
      const bitmap = Buffer.from(await textToBitmap(fallback));
      const combined = Buffer.concat([bitmap, Buffer.from(fallback)]);
      res.setHeader('Content-Type', 'application/octet-stream');
      res.send(combined);
    } catch (e2) {
      res.status(500).send('Frame generation failed');
    }
  }
};
