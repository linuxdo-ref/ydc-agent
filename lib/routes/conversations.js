/**
 * Conversations Route
 */

import { Router } from 'express';
import { authenticate } from '../auth-middleware.js';
import { 
  getConversation, 
  createConversation, 
  addMessageToConversation,
  listAllConversations,
  deleteConversation,
  clearAllConversations
} from '../conversation-store.js';

const router = Router();

// List all conversations
router.get('/v1/conversations', authenticate, (req, res) => {
  const conversations = listAllConversations();
  
  res.json({
    object: 'list',
    data: conversations.sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at)),
    total: conversations.length
  });
});

// Get single conversation
router.get('/v1/conversations/:id', authenticate, (req, res) => {
  const conv = getConversation(req.params.id);
  if (!conv) {
    return res.status(404).json({
      error: {
        message: 'Conversation not found',
        type: 'not_found_error',
        code: 'conversation_not_found'
      }
    });
  }
  
  res.json({
    id: conv.id,
    messages: conv.messages.map(m => ({
      role: m.role,
      content: m.content,
      timestamp: new Date(m.timestamp).toISOString()
    })),
    created_at: new Date(conv.createdAt).toISOString(),
    updated_at: new Date(conv.updatedAt).toISOString(),
    metadata: conv.metadata
  });
});

// Create new conversation
router.post('/v1/conversations', authenticate, (req, res) => {
  const { metadata = {}, system_message } = req.body;
  const conv = createConversation(null, metadata);
  
  if (system_message) {
    addMessageToConversation(conv.id, 'system', system_message);
  }
  
  res.status(201).json({
    id: conv.id,
    created_at: new Date(conv.createdAt).toISOString(),
    metadata: conv.metadata
  });
});

// Delete conversation
router.delete('/v1/conversations/:id', authenticate, (req, res) => {
  const conv = getConversation(req.params.id);
  if (!conv) {
    return res.status(404).json({
      error: {
        message: 'Conversation not found',
        type: 'not_found_error',
        code: 'conversation_not_found'
      }
    });
  }
  
  deleteConversation(req.params.id);
  res.json({ deleted: true, id: req.params.id });
});

// Clear all conversations
router.delete('/v1/conversations', authenticate, (req, res) => {
  const count = clearAllConversations();
  res.json({ deleted: true, count });
});

export default router;
