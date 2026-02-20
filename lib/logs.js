const { EventLog } = require('./db');

async function writeUserLog(userId, {
  source = 'server',
  level = 'info',
  event = '',
  message,
  meta = {},
} = {}) {
  if (!userId || !message) return;
  try {
    await EventLog.create({ userId, source, level, event, message, meta });
  } catch (err) {
    console.error('[logs] write failed:', err.message);
  }
}

async function readUserLogs(userId, { limit = 120 } = {}) {
  if (!userId) return [];

  const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 120, 1), 300);
  const docs = await EventLog.find({ userId })
    .sort({ createdAt: -1 })
    .limit(safeLimit)
    .lean();

  return docs.map((d) => ({
    id: String(d._id),
    source: d.source,
    level: d.level,
    event: d.event,
    message: d.message,
    meta: d.meta || {},
    createdAt: d.createdAt,
  }));
}

module.exports = {
  writeUserLog,
  readUserLogs,
};
