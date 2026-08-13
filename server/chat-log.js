// Chat logging to Turso (libSQL). Buffers messages and flushes in batches so
// writes stay low. Disabled (no-op) unless TURSO_DB_URL and TURSO_DB_TOKEN are set.
'use strict';

const TURSO_DB_URL = process.env.TURSO_DB_URL || '';
const TURSO_DB_TOKEN = process.env.TURSO_DB_TOKEN || '';
const FLUSH_MS = 3000;
const FLUSH_MAX = 50;

let client = null;
let buffer = [];
let flushing = false;

const CREATE_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS chat_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts TEXT NOT NULL,
    userId TEXT,
    username TEXT,
    message TEXT NOT NULL,
    gameId TEXT,
    roomKey TEXT,
    system INTEGER NOT NULL DEFAULT 0
  )
`;
const INSERT_SQL = `INSERT INTO chat_log (ts, userId, username, message, gameId, roomKey, system) VALUES (?, ?, ?, ?, ?, ?, ?)`;

async function flush() {
  if (!client || flushing || buffer.length === 0) return;
  flushing = true;
  const rows = buffer.splice(0, buffer.length);
  try {
    await client.batch(rows.map((r) => ({
      sql: INSERT_SQL,
      args: [r.ts, r.userId, r.username, r.message, r.gameId, r.roomKey, r.system ? 1 : 0],
    })));
  } catch (e) {
    console.warn('[ChatLog] flush failed, will retry:', e.message);
    buffer = rows.concat(buffer);
  } finally {
    flushing = false;
  }
}

function init() {
  if (!TURSO_DB_URL || !TURSO_DB_TOKEN) {
    console.warn('[ChatLog] TURSO_DB_URL / TURSO_DB_TOKEN not set — chat logging disabled.');
    return;
  }
  try {
    const { createClient } = require('@libsql/client');
    client = createClient({ url: TURSO_DB_URL, authToken: TURSO_DB_TOKEN });
    client.execute(CREATE_TABLE_SQL)
      .then(() => console.log('[ChatLog] table ready — logging chat to ' + TURSO_DB_URL))
      .catch((e) => console.warn('[ChatLog] table ensure failed:', e.message));
    setInterval(flush, FLUSH_MS);
    console.log('[ChatLog] enabled');
  } catch (e) {
    console.warn('[ChatLog] init failed:', e.message);
  }
}

function logChat(entry) {
  if (!client) return;
  buffer.push({ ts: new Date().toISOString(), system: false, ...entry });
  if (buffer.length >= FLUSH_MAX) flush();
}

module.exports = { init, logChat };
