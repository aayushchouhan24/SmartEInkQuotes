const { connectDB, User } = require('../../lib/db');
const { hashPassword, signToken, generateDeviceKey, cors } = require('../../lib/auth');

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    await connectDB();

    const exists = await User.findOne({ email: email.toLowerCase().trim() });
    if (exists) {
      return res.status(409).json({ error: 'An account with this email already exists' });
    }

    const hashed = await hashPassword(password);
    const user = await User.create({
      email: email.toLowerCase().trim(),
      password: hashed,
      deviceKey: generateDeviceKey(),
      settings: {
        displayMode: 0,
        viewType: 'both',
        duration: 60,
        aiSettings: {
          quoteTypes: ['motivational', 'philosophical'],
          animeList: ['Naruto', 'One Piece', 'Attack on Titan', 'Fullmetal Alchemist'],
          temperature: 1.0,
          imageStyle: 'anime',
        },
      },
    });

    const token = signToken(user._id);
    res.status(201).json({
      token,
      user: {
        id: user._id,
        email: user.email,
        settings: user.settings,
        deviceKey: user.deviceKey,
      },
    });
  } catch (err) {
    console.error('[register]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};
