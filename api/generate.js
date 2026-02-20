/**
 * POST /api/generate — Generate a new frame and return details + preview
 *
 * Returns JSON with:
 *   quote, scenePrompt, imageStyle, provider, elapsed, previewUrl
 *
 * Also saves the frame to the user's DB record so /api/preview works.
 */
const { connectDB, User } = require('../lib/db');
const { authenticate, cors } = require('../lib/auth');
const { generateQuote, generateImagePrompt, generateImage } = require('../lib/ai');
const { imageToBitmap, textToBitmap, base64ToBitmap, bitmapToPng } = require('../lib/imaging');
const { writeUserLog } = require('../lib/logs');

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const user = await authenticate(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });

  await connectDB();
  const full = await User.findById(user._id).lean();
  const settings = full.settings || {};
  const { displayMode = 0, viewType = 'both' } = settings;

  const t0 = Date.now();
  const log = [];

  try {
    let quote = '';
    let scenePrompt = '';
    let bitmap;
    await writeUserLog(user._id, {
      source: 'server',
      level: 'info',
      event: 'generate.start',
      message: `Manual refresh started (mode=${displayMode}, view=${viewType})`,
      meta: { displayMode, viewType },
    });

    // ── Mode 0: Full Auto ─────────────────────────────────────────────────
    if (displayMode === 0) {
      if (viewType === 'quote') {
        quote = await generateQuote(settings.aiSettings);
        log.push({ step: 'quote', detail: quote });
        bitmap = Buffer.from(await textToBitmap(quote));
      } else if (viewType === 'image') {
        const tempQuote = await generateQuote(settings.aiSettings);
        log.push({ step: 'quote', detail: tempQuote });
        scenePrompt = await generateImagePrompt(tempQuote);
        log.push({ step: 'scene', detail: scenePrompt });
        const imgBuf = await generateImage(scenePrompt, settings.aiSettings?.imageStyle);
        log.push({ step: 'image', detail: 'Generated OK' });
        bitmap = Buffer.from(await imageToBitmap(imgBuf));
      } else {
        quote = await generateQuote(settings.aiSettings);
        log.push({ step: 'quote', detail: quote });
        scenePrompt = await generateImagePrompt(quote);
        log.push({ step: 'scene', detail: scenePrompt });
        try {
          const imgBuf = await generateImage(scenePrompt, settings.aiSettings?.imageStyle);
          log.push({ step: 'image', detail: 'Generated OK' });
          bitmap = Buffer.from(await imageToBitmap(imgBuf));
        } catch (e) {
          log.push({ step: 'image', detail: 'Fallback to text: ' + e.message });
          bitmap = Buffer.from(await textToBitmap(quote));
        }
      }

    // ── Mode 1: Custom Quote + AI Image ─────────────────────────────────
    } else if (displayMode === 1) {
      quote = settings.customQuote || 'Set your custom quote in the web app';
      log.push({ step: 'quote', detail: '(custom) ' + quote });
      if (viewType === 'quote') {
        bitmap = Buffer.from(await textToBitmap(quote));
      } else {
        scenePrompt = await generateImagePrompt(quote);
        log.push({ step: 'scene', detail: scenePrompt });
        try {
          const imgBuf = await generateImage(scenePrompt, settings.aiSettings?.imageStyle);
          log.push({ step: 'image', detail: 'Generated OK' });
          bitmap = Buffer.from(await imageToBitmap(imgBuf));
        } catch (e) {
          log.push({ step: 'image', detail: 'Fallback to text: ' + e.message });
          bitmap = Buffer.from(await textToBitmap(quote));
        }
      }

    // ── Mode 2: Both Custom ─────────────────────────────────────────────
    } else {
      quote = settings.customQuote || '';
      log.push({ step: 'quote', detail: '(custom) ' + quote });
      if (settings.customImage) {
        try {
          bitmap = Buffer.from(await base64ToBitmap(settings.customImage));
          log.push({ step: 'image', detail: 'Custom image processed' });
        } catch (e) {
          bitmap = Buffer.from(await textToBitmap(quote || 'Upload an image in the web app'));
          log.push({ step: 'image', detail: 'Custom image failed: ' + e.message });
        }
      } else {
        bitmap = Buffer.from(await textToBitmap(quote || 'Upload an image in the web app'));
        log.push({ step: 'image', detail: 'No custom image uploaded' });
      }
    }

    // ── Save to DB ──────────────────────────────────────────────────────
    await User.findByIdAndUpdate(user._id, {
      needsRefresh: false,
      'lastFrame.bitmap': bitmap,
      'lastFrame.quote': quote,
      'lastFrame.generatedAt': new Date(),
    });

    // ── Build PNG preview ───────────────────────────────────────────────
    const png = await bitmapToPng(bitmap);
    const previewBase64 = 'data:image/png;base64,' + png.toString('base64');

    const elapsed = Date.now() - t0;
    log.push({ step: 'done', detail: `Completed in ${elapsed}ms` });

    await writeUserLog(user._id, {
      source: 'server',
      level: 'info',
      event: 'generate.done',
      message: `Manual refresh finished in ${elapsed}ms`,
      meta: {
        quote: quote || '',
        scenePrompt: scenePrompt || '',
        imageStyle: settings.aiSettings?.imageStyle || 'anime',
        displayMode,
        viewType,
      },
    });

    res.json({
      ok: true,
      quote,
      scenePrompt,
      imageStyle: settings.aiSettings?.imageStyle || 'anime',
      displayMode,
      viewType,
      elapsed,
      log,
      previewBase64,
    });
  } catch (err) {
    const elapsed = Date.now() - t0;
    log.push({ step: 'error', detail: err.message });
    console.error('[generate error]', err);
    await writeUserLog(user._id, {
      source: 'server',
      level: 'error',
      event: 'generate.error',
      message: `Manual refresh failed: ${err.message}`,
      meta: { elapsed },
    });
    res.status(500).json({
      ok: false,
      error: err.message,
      elapsed,
      log,
    });
  }
};
