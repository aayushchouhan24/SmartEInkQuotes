const { authenticate, authenticateDevice, cors } = require('../lib/auth');
const { generateQuote } = require('../lib/ai');

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  let user = await authenticate(req);
  if (!user) user = await authenticateDevice(req.query.key);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });

  try {
    const quote = await generateQuote(user.settings?.aiSettings);
    res.setHeader('Content-Type', 'text/plain');
    res.send(quote);
  } catch (err) {
    console.error('[quote error]', err);
    res.setHeader('Content-Type', 'text/plain');
    res.send('The world is beautiful. - Anonymous');
  }
};
