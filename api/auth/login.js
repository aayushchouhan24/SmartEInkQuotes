const { connectDB, User } = require('../../lib/db');
const { comparePassword, signToken, cors } = require('../../lib/auth');

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    await connectDB();
    const user = await User.findOne({ email: email.toLowerCase().trim() });

    if (!user || !(await comparePassword(password, user.password))) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const token = signToken(user._id);
    res.json({
      token,
      user: {
        id: user._id,
        email: user.email,
        settings: user.settings,
        deviceKey: user.deviceKey,
        lastDeviceContact: user.lastDeviceContact,
      },
    });
  } catch (err) {
    console.error('[login]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};
