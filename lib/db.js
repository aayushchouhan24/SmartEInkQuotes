const mongoose = require('mongoose');

// ── Connection Cache (for Vercel serverless cold starts) ────────────────────
let cached = global._mongooseCache;
if (!cached) cached = global._mongooseCache = { conn: null, promise: null };

async function connectDB() {
  if (cached.conn) return cached.conn;

  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI environment variable not set');

  if (!cached.promise) {
    cached.promise = mongoose.connect(uri, {
      bufferCommands: false,
      maxPoolSize: 10,
    });
  }

  cached.conn = await cached.promise;
  return cached.conn;
}

// ── User Schema ─────────────────────────────────────────────────────────────
const userSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
  },
  password: { type: String, required: true },
  deviceKey: { type: String, unique: true, sparse: true },

  settings: {
    // 0 = Full Auto (AI quote + AI image, auto-changes)
    // 1 = Quote Custom (user quote + AI image, static)
    // 2 = Both Custom (user quote + user image, static)
    displayMode: { type: Number, default: 0 },

    // "both" | "image" | "quote"
    viewType: { type: String, default: 'both', enum: ['both', 'image', 'quote'] },

    // Seconds between auto-refresh (only for mode 0)
    duration: { type: Number, default: 60, min: 10, max: 3600 },

    customQuote: { type: String, default: '' },
    customImage: { type: String, default: '' }, // base64 data URI

    aiSettings: {
      quoteTypes: { type: [String], default: [] },
      animeList: { type: [String], default: [] },
      temperature: { type: Number, default: 1.0, min: 0.1, max: 2.0 },
      imageStyle: { type: String, default: 'anime' },
    },

    wifi: {
      ssid: { type: String, default: '' },
      password: { type: String, default: '' },
    },
  },

  lastDeviceContact: Date,
  needsRefresh: { type: Boolean, default: true },

  lastFrame: {
    bitmap: Buffer,
    quote: String,
    generatedAt: Date,
  },

  createdAt: { type: Date, default: Date.now },
});

const User = mongoose.models.User || mongoose.model('User', userSchema);

module.exports = { connectDB, User };
