const { connectDB, User } = require('../lib/db');
const { authenticate, generateDeviceKey, cors } = require('../lib/auth');

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const user = await authenticate(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });

  await connectDB();

  // ── GET: return current settings ──────────────────────────────────────────
  if (req.method === 'GET') {
    const full = await User.findById(user._id)
      .select('-password -lastFrame.bitmap')
      .lean();
    return res.json({
      settings: full.settings,
      deviceKey: full.deviceKey,
      lastDeviceContact: full.lastDeviceContact,
    });
  }

  // ── PUT: update settings ──────────────────────────────────────────────────
  if (req.method === 'PUT') {
    const u = req.body || {};
    const set = {};

    if (u.displayMode !== undefined) set['settings.displayMode'] = u.displayMode;
    if (u.viewType !== undefined) set['settings.viewType'] = u.viewType;
    if (u.duration !== undefined) set['settings.duration'] = Math.max(10, Math.min(3600, u.duration));
    if (u.customQuote !== undefined) set['settings.customQuote'] = u.customQuote;
    if (u.customImage !== undefined) set['settings.customImage'] = u.customImage;

    if (u.aiSettings) {
      if (u.aiSettings.quoteTypes !== undefined) set['settings.aiSettings.quoteTypes'] = u.aiSettings.quoteTypes;
      if (u.aiSettings.animeList !== undefined) set['settings.aiSettings.animeList'] = u.aiSettings.animeList;
      if (u.aiSettings.temperature !== undefined)
        set['settings.aiSettings.temperature'] = u.aiSettings.temperature;
      if (u.aiSettings.imageStyle !== undefined) set['settings.aiSettings.imageStyle'] = u.aiSettings.imageStyle;
    }

    if (u.wifi) {
      if (u.wifi.ssid !== undefined) set['settings.wifi.ssid'] = u.wifi.ssid;
      if (u.wifi.password !== undefined) set['settings.wifi.password'] = u.wifi.password;
    }

    if (u.regenerateKey) set.deviceKey = generateDeviceKey();

    // Flag device for refresh
    set.needsRefresh = true;

    const updated = await User.findByIdAndUpdate(user._id, set, { new: true })
      .select('-password -lastFrame.bitmap')
      .lean();

    return res.json({
      settings: updated.settings,
      deviceKey: updated.deviceKey,
    });
  }

  res.status(405).json({ error: 'Method not allowed' });
};
