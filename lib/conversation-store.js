/**
 * Conversation Store Module
 * Supports SQLite (persistent via sql.js) and Memory (in-memory) storage
 */

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import crypto from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Configuration
const STORE_TYPE = process.env.YDC_CONVERSATION_STORE || 'sqlite';
const DB_PATH = process.env.YDC_CONVERSATION_DB_PATH || join(__dirname, '..', 'conversations.db');
const CONVERSATION_TTL = 24 * 60 * 60 * 1000; // 24 hours
const MAX_CONVERSATIONS = 1000;
const MAX_MESSAGES_PER_CONVERSATION = 100;

// Memory store (fallback)
const memoryStore = new Map();

// SQLite database (sql.js)
let db = null;
let SQL = null;
let dbInitialized = false;

// Save database to file periodically
let saveTimeout = null;
function scheduleSave() {
  if (saveTimeout) clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => {
    if (db && STORE_TYPE === 'sqlite') {
      try {
        const data = db.export();
        writeFileSync(DB_PATH, Buffer.from(data));
      } catch (error) {
        console.error('⚠️ Failed to save database:', error.message);
      }
    }
  }, 1000); // Debounce saves by 1 second
}

async function initDatabase() {
  if (dbInitialized) return;
  dbInitialized = true;

  if (STORE_TYPE === 'memory') {
    console.log('📦 Using in-memory conversation store');
    return;
  }

  try {
    // Dynamic import sql.js
    const initSqlJs = (await import('sql.js')).default;
    SQL = await initSqlJs();
    
    // Load existing database or create new one
    if (existsSync(DB_PATH)) {
      try {
        const fileBuffer = readFileSync(DB_PATH);
        db = new SQL.Database(fileBuffer);
        console.log(`📦 Loaded SQLite database: ${DB_PATH}`);
      } catch (error) {
        console.error('⚠️ Failed to load existing database, creating new one:', error.message);
        db = new SQL.Database();
      }
    } else {
      db = new SQL.Database();
    }
    
    // Create tables
    db.run(`
      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        metadata TEXT DEFAULT '{}',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);
    
    db.run(`
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        conversation_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
      )
    `);
    
    db.run(`CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_conversations_updated ON conversations(updated_at)`);
    
    // Save initial database
    scheduleSave();
    
    console.log(`📦 Using SQLite conversation store: ${DB_PATH}`);
  } catch (error) {
    console.error('⚠️ Failed to initialize SQLite, falling back to memory store:', error.message);
    db = null;
  }
}

// Export init function for async initialization
export { initDatabase };

export function generateConversationId() {
  return crypto.randomUUID();
}

export function getConversation(conversationId) {
  if (!conversationId) return null;

  if (STORE_TYPE === 'memory' || !db) {
    if (!memoryStore.has(conversationId)) return null;
    const conv = memoryStore.get(conversationId);
    conv.updatedAt = Date.now();
    return conv;
  }

  const convResult = db.exec('SELECT * FROM conversations WHERE id = ?', [conversationId]);
  if (!convResult.length || !convResult[0].values.length) return null;
  
  const conv = convResult[0].values[0];
  const [id, metadata, created_at, updated_at] = conv;

  const messagesResult = db.exec('SELECT role, content, timestamp FROM messages WHERE conversation_id = ? ORDER BY id', [conversationId]);
  const messages = messagesResult.length ? messagesResult[0].values.map(row => ({
    role: row[0],
    content: row[1],
    timestamp: row[2]
  })) : [];
  
  db.run('UPDATE conversations SET updated_at = ? WHERE id = ?', [Date.now(), conversationId]);
  scheduleSave();

  return {
    id,
    messages,
    metadata: JSON.parse(metadata || '{}'),
    createdAt: created_at,
    updatedAt: Date.now()
  };
}

export function createConversation(conversationId = null, metadata = {}) {
  const id = conversationId || generateConversationId();
  const now = Date.now();

  if (STORE_TYPE === 'memory' || !db) {
    const conv = { id, messages: [], createdAt: now, updatedAt: now, metadata };
    memoryStore.set(id, conv);
    return conv;
  }

  db.run('INSERT OR REPLACE INTO conversations (id, metadata, created_at, updated_at) VALUES (?, ?, ?, ?)',
    [id, JSON.stringify(metadata), now, now]);
  scheduleSave();

  return { id, messages: [], createdAt: now, updatedAt: now, metadata };
}

export function addMessageToConversation(conversationId, role, content) {
  const now = Date.now();

  if (STORE_TYPE === 'memory' || !db) {
    let conv = memoryStore.get(conversationId);
    if (!conv) {
      conv = createConversation(conversationId);
    }
    
    if (conv.messages.length >= MAX_MESSAGES_PER_CONVERSATION) {
      const systemMsg = conv.messages.find(m => m.role === 'system');
      conv.messages = systemMsg ? [systemMsg, ...conv.messages.slice(-MAX_MESSAGES_PER_CONVERSATION + 2)] : conv.messages.slice(-MAX_MESSAGES_PER_CONVERSATION + 1);
    }
    
    conv.messages.push({ role, content, timestamp: now });
    conv.updatedAt = now;
    return conv;
  }

  const existing = db.exec('SELECT id FROM conversations WHERE id = ?', [conversationId]);
  if (!existing.length || !existing[0].values.length) {
    createConversation(conversationId);
  }

  const countResult = db.exec('SELECT COUNT(*) as count FROM messages WHERE conversation_id = ?', [conversationId]);
  const count = countResult.length ? countResult[0].values[0][0] : 0;
  
  if (count >= MAX_MESSAGES_PER_CONVERSATION) {
    const systemMsgResult = db.exec("SELECT id FROM messages WHERE conversation_id = ? AND role = 'system' LIMIT 1", [conversationId]);
    const deleteCount = count - MAX_MESSAGES_PER_CONVERSATION + 2;
    
    if (systemMsgResult.length && systemMsgResult[0].values.length) {
      const systemId = systemMsgResult[0].values[0][0];
      // Delete oldest messages except system message
      const toDeleteResult = db.exec('SELECT id FROM messages WHERE conversation_id = ? AND id != ? ORDER BY id LIMIT ?', 
        [conversationId, systemId, deleteCount]);
      if (toDeleteResult.length) {
        toDeleteResult[0].values.forEach(row => {
          db.run('DELETE FROM messages WHERE id = ?', [row[0]]);
        });
      }
    } else {
      const toDeleteResult = db.exec('SELECT id FROM messages WHERE conversation_id = ? ORDER BY id LIMIT ?', 
        [conversationId, deleteCount]);
      if (toDeleteResult.length) {
        toDeleteResult[0].values.forEach(row => {
          db.run('DELETE FROM messages WHERE id = ?', [row[0]]);
        });
      }
    }
  }

  db.run('INSERT INTO messages (conversation_id, role, content, timestamp) VALUES (?, ?, ?, ?)',
    [conversationId, role, content, now]);
  
  db.run('UPDATE conversations SET updated_at = ? WHERE id = ?', [now, conversationId]);
  scheduleSave();

  return getConversation(conversationId);
}


export function listAllConversations() {
  if (STORE_TYPE === 'memory' || !db) {
    const conversations = [];
    for (const [id, conv] of memoryStore.entries()) {
      conversations.push({
        id,
        message_count: conv.messages.length,
        created_at: new Date(conv.createdAt).toISOString(),
        updated_at: new Date(conv.updatedAt).toISOString(),
        metadata: conv.metadata,
        preview: conv.messages.slice(-1)[0]?.content?.substring(0, 100) || ''
      });
    }
    return conversations.sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
  }

  const convsResult = db.exec('SELECT * FROM conversations ORDER BY updated_at DESC');
  if (!convsResult.length) return [];
  
  return convsResult[0].values.map(conv => {
    const [id, metadata, created_at, updated_at] = conv;
    const lastMsgResult = db.exec('SELECT content FROM messages WHERE conversation_id = ? ORDER BY id DESC LIMIT 1', [id]);
    const msgCountResult = db.exec('SELECT COUNT(*) as count FROM messages WHERE conversation_id = ?', [id]);
    
    return {
      id,
      message_count: msgCountResult.length ? msgCountResult[0].values[0][0] : 0,
      created_at: new Date(created_at).toISOString(),
      updated_at: new Date(updated_at).toISOString(),
      metadata: JSON.parse(metadata || '{}'),
      preview: lastMsgResult.length && lastMsgResult[0].values.length ? lastMsgResult[0].values[0][0]?.substring(0, 100) || '' : ''
    };
  });
}

export function deleteConversation(conversationId) {
  if (STORE_TYPE === 'memory' || !db) {
    return memoryStore.delete(conversationId);
  }

  db.run('DELETE FROM messages WHERE conversation_id = ?', [conversationId]);
  db.run('DELETE FROM conversations WHERE id = ?', [conversationId]);
  scheduleSave();
  return true;
}

export function clearAllConversations() {
  if (STORE_TYPE === 'memory' || !db) {
    const count = memoryStore.size;
    memoryStore.clear();
    return count;
  }

  const countResult = db.exec('SELECT COUNT(*) as count FROM conversations');
  const count = countResult.length ? countResult[0].values[0][0] : 0;
  db.run('DELETE FROM messages');
  db.run('DELETE FROM conversations');
  scheduleSave();
  return count;
}

export function getConversationCount() {
  if (STORE_TYPE === 'memory' || !db) {
    return memoryStore.size;
  }
  const result = db.exec('SELECT COUNT(*) as count FROM conversations');
  return result.length ? result[0].values[0][0] : 0;
}

export function cleanupConversations() {
  const now = Date.now();
  const expireTime = now - CONVERSATION_TTL;

  if (STORE_TYPE === 'memory' || !db) {
    let deleted = 0;
    for (const [id, conv] of memoryStore.entries()) {
      if (conv.updatedAt < expireTime) {
        memoryStore.delete(id);
        deleted++;
      }
    }
    
    if (memoryStore.size > MAX_CONVERSATIONS) {
      const sorted = [...memoryStore.entries()].sort((a, b) => a[1].updatedAt - b[1].updatedAt);
      const toDelete = sorted.slice(0, memoryStore.size - MAX_CONVERSATIONS);
      toDelete.forEach(([id]) => memoryStore.delete(id));
      deleted += toDelete.length;
    }
    return deleted;
  }

  // Delete expired conversations
  const expiredResult = db.exec('SELECT id FROM conversations WHERE updated_at < ?', [expireTime]);
  let deleted = 0;
  if (expiredResult.length) {
    expiredResult[0].values.forEach(row => {
      db.run('DELETE FROM messages WHERE conversation_id = ?', [row[0]]);
      db.run('DELETE FROM conversations WHERE id = ?', [row[0]]);
      deleted++;
    });
  }

  // Enforce max conversations limit
  const countResult = db.exec('SELECT COUNT(*) as count FROM conversations');
  const count = countResult.length ? countResult[0].values[0][0] : 0;
  if (count > MAX_CONVERSATIONS) {
    const toDeleteResult = db.exec('SELECT id FROM conversations ORDER BY updated_at ASC LIMIT ?', [count - MAX_CONVERSATIONS]);
    if (toDeleteResult.length) {
      toDeleteResult[0].values.forEach(row => {
        db.run('DELETE FROM messages WHERE conversation_id = ?', [row[0]]);
        db.run('DELETE FROM conversations WHERE id = ?', [row[0]]);
        deleted++;
      });
    }
  }

  if (deleted > 0) scheduleSave();
  return deleted;
}

// Run cleanup every hour
setInterval(cleanupConversations, 60 * 60 * 1000);

// Export config for health check
export const storeConfig = {
  STORE_TYPE,
  DB_PATH,
  MAX_CONVERSATIONS,
  CONVERSATION_TTL,
  isDbConnected: () => !!db
};
