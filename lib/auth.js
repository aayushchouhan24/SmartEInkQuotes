const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { connectDB, User } = require('./db');

const JWT_SECRET = process.env.JWT_SECRET || 'eink-sketch-jwt-secret-2026';

// ── Token Helpers ───────────────────────────────────────────────────────────

function signToken(userId) {
  return jwt.sign({ id: userId.toString() }, JWT_SECRET, { expiresIn: '30d' });
}

function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}

// ── Password Helpers ────────────────────────────────────────────────────────

async function hashPassword(password) {
  return bcrypt.hash(password, 12);
}

async function comparePassword(plain, hash) {
  return bcrypt.compare(plain, hash);
}

// ── Middleware: authenticate web user via Bearer token ───────────────────────

async function authenticate(req) {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) return null;

  const decoded = verifyToken(auth.slice(7));
  if (!decoded) return null;

  await connectDB();
  return User.findById(decoded.id).select('-password -lastFrame.bitmap').lean();
}

// ── Middleware: authenticate ESP32 device via key query param ────────────────

async function authenticateDevice(key) {
  if (!key) return null;
  await connectDB();
  const user = await User.findOneAndUpdate(
    { deviceKey: key },
    { lastDeviceContact: new Date() },
    { new: true },
  );
  return user;
}

// ── Device Key Generator ────────────────────────────────────────────────────

function generateDeviceKey() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let key = 'eink_';
  for (let i = 0; i < 32; i++) {
    key += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return key;
}

// ── CORS Helper ─────────────────────────────────────────────────────────────

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

module.exports = {
  signToken,
  verifyToken,
  hashPassword,
  comparePassword,
  authenticate,
  authenticateDevice,
  generateDeviceKey,
  cors,
};
