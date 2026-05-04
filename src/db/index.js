const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DATA_DIR = path.join(__dirname, '../../data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'xmessenger.db'));

function initDb() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      character_name TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      last_message_at INTEGER,
      phase TEXT NOT NULL DEFAULT 'text',
      summary TEXT
    );

    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      metadata TEXT,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (session_id) REFERENCES sessions(id)
    );

    CREATE TABLE IF NOT EXISTS images (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      filename TEXT NOT NULL,
      prompt TEXT,
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, created_at);
  `);
}

// Sessions
function createSession(id, characterName) {
  const now = Date.now();
  db.prepare(`
    INSERT INTO sessions (id, character_name, created_at, last_message_at, phase)
    VALUES (?, ?, ?, ?, 'text')
  `).run(id, characterName, now, now);
  return getSession(id);
}

function getSession(id) {
  return db.prepare('SELECT * FROM sessions WHERE id = ?').get(id);
}

function listSessions() {
  return db.prepare(`
    SELECT s.*,
      (SELECT content FROM messages WHERE session_id = s.id ORDER BY created_at DESC LIMIT 1) AS last_message,
      (SELECT created_at FROM messages WHERE session_id = s.id ORDER BY created_at DESC LIMIT 1) AS last_message_at
    FROM sessions s
    ORDER BY last_message_at DESC
  `).all();
}

function getOrCreateSession(characterName) {
  const existing = db.prepare(`
    SELECT * FROM sessions WHERE character_name = ? ORDER BY last_message_at DESC LIMIT 1
  `).get(characterName);
  if (existing) return existing;
  const { v4: uuidv4 } = require('uuid');
  return createSession(uuidv4(), characterName);
}

function updateSessionPhase(id, phase) {
  db.prepare('UPDATE sessions SET phase = ? WHERE id = ?').run(phase, id);
}

function updateSessionSummary(id, summary) {
  db.prepare('UPDATE sessions SET summary = ? WHERE id = ?').run(summary, id);
}

function touchSession(id) {
  db.prepare('UPDATE sessions SET last_message_at = ? WHERE id = ?').run(Date.now(), id);
}

// Messages
function addMessage(sessionId, role, content, metadata = null) {
  const now = Date.now();
  const result = db.prepare(`
    INSERT INTO messages (session_id, role, content, metadata, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(sessionId, role, content, metadata ? JSON.stringify(metadata) : null, now);
  touchSession(sessionId);
  return getMessageById(result.lastInsertRowid);
}

function getMessageById(id) {
  const msg = db.prepare('SELECT * FROM messages WHERE id = ?').get(id);
  if (msg && msg.metadata) msg.metadata = JSON.parse(msg.metadata);
  return msg;
}

function getMessages(sessionId, limit = 100) {
  const rows = db.prepare(`
    SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC LIMIT ?
  `).all(sessionId, limit);
  return rows.map(r => ({ ...r, metadata: r.metadata ? JSON.parse(r.metadata) : null }));
}

function getRecentMessages(sessionId, limit = 40) {
  const rows = db.prepare(`
    SELECT * FROM (SELECT * FROM messages WHERE session_id = ? ORDER BY created_at DESC LIMIT ?)
    ORDER BY created_at ASC
  `).all(sessionId, limit);
  return rows.map(r => ({ ...r, metadata: r.metadata ? JSON.parse(r.metadata) : null }));
}

function countMessages(sessionId) {
  return db.prepare('SELECT COUNT(*) as n FROM messages WHERE session_id = ?').get(sessionId).n;
}

// Images
function addImage(sessionId, filename, prompt) {
  db.prepare(`
    INSERT INTO images (session_id, filename, prompt, created_at) VALUES (?, ?, ?, ?)
  `).run(sessionId, filename, prompt, Date.now());
}

module.exports = {
  db,
  initDb,
  createSession,
  getSession,
  listSessions,
  getOrCreateSession,
  updateSessionPhase,
  updateSessionSummary,
  touchSession,
  addMessage,
  getMessageById,
  getMessages,
  getRecentMessages,
  countMessages,
  addImage,
};
