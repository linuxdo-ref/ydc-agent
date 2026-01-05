#!/usr/bin/env node

/**
 * OpenAI-Compatible HTTP Server for You.com Agents
 * Provides a REST API that mimics OpenAI's chat completions endpoint
 * Supports multi-user, multi-conversation sessions
 */

import express from 'express';
import cors from 'cors';
import { createServer } from 'http';

// Import routes
import chatRoutes from './lib/routes/chat.js';
import modelsRoutes from './lib/routes/models.js';
import conversationsRoutes from './lib/routes/conversations.js';
import healthRoutes from './lib/routes/health.js';
import anthropicRoutes from './lib/routes/anthropic-messages.js';

// Import config
import { storeConfig, initDatabase } from './lib/conversation-store.js';
import { authConfig } from './lib/auth-middleware.js';
import { listAdvancedVersions, getDefaultAdvancedVersion } from './lib/advanced-versions.js';

const app = express();
const startPort = parseInt(process.env.YDC_OPENAI_PORT) || 3002;
const API_KEY = process.env.YDC_API_KEY;

// Function to find available port
async function findAvailablePort(startPort, maxAttempts = 10) {
  for (let i = 0; i < maxAttempts; i++) {
    const port = startPort + i;
    try {
      await new Promise((resolve, reject) => {
        const server = createServer();
        server.listen(port, () => {
          server.close(() => resolve());
        });
        server.on('error', reject);
      });
      return port;
    } catch (error) {
      if (error.code !== 'EADDRINUSE') {
        throw error;
      }
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

// Middleware
app.use(cors());
app.use(express.json());

// Routes
app.use(chatRoutes);
app.use(modelsRoutes);
app.use(conversationsRoutes);
app.use(healthRoutes);
app.use(anthropicRoutes);

// Start server with auto port detection
async function startServer() {
  try {
    // Initialize database (handles missing better-sqlite3 gracefully)
    await initDatabase();
    
    const port = await findAvailablePort(startPort);
    app.set('port', port);
    
    app.listen(port, () => {
      console.log(`🚀 You.com OpenAI-Compatible Server running on port ${port}`);
      console.log(`📋 Base URL: http://localhost:${port}`);
      console.log(`🔑 YDC API Key configured: ${!!API_KEY}`);
      console.log(`📦 Conversation Store: ${storeConfig.STORE_TYPE}${storeConfig.STORE_TYPE === 'sqlite' && storeConfig.isDbConnected() ? ` (${storeConfig.DB_PATH})` : ''}`);
      console.log(`🔐 Token Auth: ${authConfig.REQUIRE_TOKEN_AUTH ? `enabled (${authConfig.ACCESS_TOKENS_COUNT} tokens)` : 'disabled (accept all)'}`);
      console.log(`\n📖 Endpoints:`);
      console.log(`   POST http://localhost:${port}/v1/chat/completions  (OpenAI)`);
      console.log(`   POST http://localhost:${port}/v1/messages          (Anthropic/Claude)`);
      console.log(`   GET  http://localhost:${port}/v1/models`);
      console.log(`   GET  http://localhost:${port}/v1/versions`);
      console.log(`   GET  http://localhost:${port}/health`);
      console.log(`   GET/POST/DELETE http://localhost:${port}/v1/conversations`);
      
      try {
        const versions = listAdvancedVersions();
        const defaultVersion = getDefaultAdvancedVersion();
        console.log(`\n🎯 Advanced Versions: ${versions.length} available (default: ${defaultVersion})`);
      } catch (error) {
        console.error('❌ Error loading advanced versions:', error.message);
      }
    });
  } catch (error) {
    console.error('❌ Failed to start server:', error.message);
    process.exit(1);
  }
}

startServer();
