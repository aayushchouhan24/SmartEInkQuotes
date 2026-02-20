const { connectDB, User } = require('../lib/db');
const { authenticate, cors } = require('../lib/auth');
const { bitmapToPng } = require('../lib/imaging');

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const user = await authenticate(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });

  await connectDB();
  const full = await User.findById(user._id).select('lastFrame').lean();

  if (!full?.lastFrame?.bitmap) {
    return res.status(404).json({ error: 'No preview available yet. Press Refresh first.' });
  }

  try {
    const png = await bitmapToPng(full.lastFrame.bitmap);
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'no-cache');
    if (full.lastFrame.generatedAt) {
      res.setHeader('X-Preview-At', new Date(full.lastFrame.generatedAt).toISOString());
    }
    res.send(png);
  } catch (err) {
    console.error('[preview error]', err);
    res.status(500).json({ error: 'Preview generation failed' });
  }
};
