const { connectDB } = require('../lib/db');
const { authenticate, cors } = require('../lib/auth');
const { readUserLogs } = require('../lib/logs');

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const user = await authenticate(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });

  await connectDB();

  try {
    const logs = await readUserLogs(user._id, { limit: req.query.limit || 150 });
    return res.json({ logs });
  } catch (err) {
    console.error('[logs error]', err);
    return res.status(500).json({ error: 'Failed to load logs' });
  }
};
