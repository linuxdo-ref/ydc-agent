/**
 * Health Check Route
 */

import { Router } from 'express';
import { getConversationCount, storeConfig } from '../conversation-store.js';
import { authConfig } from '../auth-middleware.js';

const router = Router();
const API_KEY = process.env.YDC_API_KEY;

router.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    ydc_api_key_configured: !!API_KEY,
    auth: {
      token_auth_enabled: authConfig.REQUIRE_TOKEN_AUTH,
      allowed_tokens_count: authConfig.ACCESS_TOKENS_COUNT
    },
    conversations: {
      store_type: storeConfig.STORE_TYPE,
      db_path: storeConfig.STORE_TYPE === 'sqlite' && storeConfig.isDbConnected() ? storeConfig.DB_PATH : null,
      active: getConversationCount(),
      max: storeConfig.MAX_CONVERSATIONS,
      ttl_hours: storeConfig.CONVERSATION_TTL / (60 * 60 * 1000)
    }
  });
});

export default router;
