const { connectDB, User } = require('../lib/db');
const { authenticate, cors } = require('../lib/auth');

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const user = await authenticate(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });

  try {
    const { image } = req.body || {};
    if (!image) return res.status(400).json({ error: 'No image data provided' });

    // Validate it looks like base64 image data
    if (!image.startsWith('data:image/')) {
      return res.status(400).json({ error: 'Invalid image format. Send as data URI.' });
    }

    await connectDB();
    await User.findByIdAndUpdate(user._id, {
      'settings.customImage': image,
      needsRefresh: true,
    });

    res.json({ success: true, message: 'Image uploaded successfully' });
  } catch (err) {
    console.error('[upload error]', err);
    res.status(500).json({ error: 'Upload failed' });
  }
};
