#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { randomUUID } from 'crypto';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Import shared modules
import { AGENT_TYPES, callYouApi, extractText, buildConversationInput, buildAgentRequest } from './lib/api-client.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ============ CLI MODE CHECK ============
const args = process.argv.slice(2);

// Parse CLI arguments
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--api-key' && args[i + 1]) {
    process.env.YDC_API_KEY = args[i + 1];
  }
  if (args[i] === '--api-keys' && args[i + 1]) {
    process.env.YDC_API_KEYS = args[i + 1];
  }
  if ((args[i] === '--port' || args[i] === '-p') && args[i + 1]) {
    process.env.YDC_OPENAI_PORT = args[i + 1];
  }
  if (args[i] === '--access-token' && args[i + 1]) {
    process.env.YDC_OPENAI_ACCESS_TOKENS = args[i + 1];
  }
  if (args[i] === '--key-mode' && args[i + 1]) {
    process.env.YDC_KEY_MODE = args[i + 1];
  }
  if (args[i] === '--agent' && args[i + 1]) {
    // Format: name:id or just id (name defaults to id)
    const existing = process.env.YDC_CUSTOM_AGENTS || '';
    process.env.YDC_CUSTOM_AGENTS = existing ? `${existing},${args[i + 1]}` : args[i + 1];
  }
  if (args[i] === '--no-history') {
    process.env.YDC_NO_HISTORY = 'true';
  }
}

const isOpenAIMode = args.includes('--openai') || args.includes('openai');

if (isOpenAIMode) {
  // Start OpenAI-compatible HTTP server using spawn
  const openaiServerPath = join(__dirname, 'openai-server.js');
  const child = spawn('node', [openaiServerPath], { 
    stdio: 'inherit',
    env: process.env
  });
  child.on('exit', (code) => process.exit(code));
} else if (args.includes('--help') || args.includes('-h')) {
  console.log(`
ydc-agent - MCP server for You.com AI agents

Usage:
  npx ydc-agent                              Start MCP server (stdio)
  npx ydc-agent --openai                     Start OpenAI-compatible HTTP server
  npx ydc-agent --openai --api-key KEY       Start with single API key
  npx ydc-agent --openai --api-keys K1,K2    Start with multiple API keys
  npx ydc-agent --openai --port 3003         Start on custom port
  npx ydc-agent --openai --access-token TOK  Require access token for HTTP server

Options:
  --openai              Start OpenAI-compatible HTTP server
  --api-key KEY         Set single You.com API key
  --api-keys K1,K2,K3   Set multiple API keys (comma-separated)
  --key-mode MODE       Key rotation: round-robin (default) / sequential / random
  --port, -p PORT       Set HTTP server port (default: 3002)
  --access-token TOKEN  Set access token for HTTP server authentication
  --agent NAME:ID       Add custom agent to models list (can use multiple times)
  --no-history          Minimal logging (one line per request/response)
  --help, -h            Show this help

Environment Variables:
  YDC_API_KEY                You.com API key (required)
  YDC_API_KEYS               Multiple keys (comma-separated)
  YDC_KEY_MODE               round-robin / sequential / random
  YDC_OPENAI_PORT            HTTP server port (default: 3002)
  YDC_CONVERSATION_STORE     sqlite / memory (default: sqlite)
  YDC_OPENAI_ACCESS_TOKENS   Allowed tokens (comma-separated)
  YDC_CUSTOM_AGENTS          Custom agents (name:id,name2:id2)
  YDC_NO_HISTORY             Set to 'true' for minimal logging
`);
  process.exit(0);
}

// Skip MCP server if in OpenAI mode
if (isOpenAIMode) {
  // Wait forever, child process handles everything
  setInterval(() => {}, 1000000);
} else {

// ============ OPENAI SERVER CONTROL ============
let openaiServerProcess = null;
let openaiServerPort = null;
let openaiServerStatus = 'stopped';

// ============ MULTI-KEY CONFIGURATION ============
const API_KEYS_RAW = process.env.YDC_API_KEYS || process.env.YDC_API_KEY || '';
const API_KEYS = API_KEYS_RAW.split(',').map(k => k.trim()).filter(k => k);
const KEY_MODE = process.env.YDC_KEY_MODE || 'round-robin';
let currentKeyIndex = 0;
const keyUsageCount = new Map();
const keyErrorCount = new Map();

// ============ OPENAI SERVER ENV PASSTHROUGH ============
const OPENAI_SERVER_STORE_TYPE = process.env.YDC_CONVERSATION_STORE || 'sqlite';
const OPENAI_SERVER_DB_PATH = process.env.YDC_CONVERSATION_DB_PATH || '';
const OPENAI_SERVER_ACCESS_TOKENS = process.env.YDC_OPENAI_ACCESS_TOKENS || '';

// ============ SUMMARY PREFERENCE ============
const PREFER_SUMMARY = process.env.YDC_PREFER_SUMMARY === 'true';
const DEFAULT_SUMMARY_LANGUAGE = process.env.YDC_SUMMARY_LANGUAGE || 'en';

// ============ ENABLE USAGE HINTS ============
const SHOW_USAGE_HINTS = process.env.YDC_ENABLE_USAGE_HINTS !== 'false';

// ============ CUSTOM AGENT CONFIGURATION ============
const CUSTOM_AGENTS_RAW = process.env.YDC_CUSTOM_AGENTS || '';
const CUSTOM_AGENTS = CUSTOM_AGENTS_RAW.split(',').map(a => a.trim()).filter(a => a);
const HAS_CUSTOM_AGENT = CUSTOM_AGENTS.length > 0;
const DEFAULT_AGENT_ID = HAS_CUSTOM_AGENT ? CUSTOM_AGENTS[0].split(':').pop() : null;

// ============ YOU_AGENT FAILURE TRACKING ============
let youAgentFailureCount = 0;
const YOU_AGENT_FAILURE_THRESHOLD = parseInt(process.env.YDC_AGENT_FAILURE_THRESHOLD) || 3;
let youAgentDisabled = false;

function recordYouAgentFailure() {
  youAgentFailureCount++;
  if (youAgentFailureCount >= YOU_AGENT_FAILURE_THRESHOLD) {
    youAgentDisabled = true;
  }
  return { count: youAgentFailureCount, disabled: youAgentDisabled };
}

function resetYouAgentFailures() {
  youAgentFailureCount = 0;
  youAgentDisabled = false;
}

function getYouAgentStatus() {
  return { 
    failure_count: youAgentFailureCount, 
    threshold: YOU_AGENT_FAILURE_THRESHOLD,
    disabled: youAgentDisabled 
  };
}

// ============ CONVERSATION STORE (Memory for MCP) ============
const conversationStore = new Map();
const CONVERSATION_TTL = 24 * 60 * 60 * 1000;
const MAX_MESSAGES_PER_CONVERSATION = 100;

function generateConversationId() {
  return randomUUID();
}

function getConversation(conversationId) {
  if (!conversationId || !conversationStore.has(conversationId)) return null;
  const conv = conversationStore.get(conversationId);
  conv.updatedAt = Date.now();
  return conv;
}

function createConversation(conversationId = null) {
  const id = conversationId || generateConversationId();
  const conv = { id, messages: [], createdAt: Date.now(), updatedAt: Date.now() };
  conversationStore.set(id, conv);
  return conv;
}

function addMessageToConversation(conversationId, role, content) {
  let conv = getConversation(conversationId);
  if (!conv) conv = createConversation(conversationId);
  
  if (conv.messages.length >= MAX_MESSAGES_PER_CONVERSATION) {
    const systemMsg = conv.messages.find(m => m.role === 'system');
    conv.messages = systemMsg 
      ? [systemMsg, ...conv.messages.slice(-MAX_MESSAGES_PER_CONVERSATION + 2)] 
      : conv.messages.slice(-MAX_MESSAGES_PER_CONVERSATION + 1);
  }
  
  conv.messages.push({ role, content, timestamp: Date.now() });
  conv.updatedAt = Date.now();
  return conv;
}

// Cleanup expired conversations
setInterval(() => {
  const now = Date.now();
  for (const [id, conv] of conversationStore.entries()) {
    if (now - conv.updatedAt > CONVERSATION_TTL) conversationStore.delete(id);
  }
}, 60 * 60 * 1000);

// ============ API KEY MANAGEMENT ============
function isRunningAsNpx() {
  const execPath = process.argv[1] || '';
  return execPath.includes('node_modules') || execPath.includes('.npm/_npx') || 
         execPath.includes('npx') || execPath.includes('pnpm/global');
}

function validateApiKeys() {
  if (API_KEYS.length === 0) {
    console.error('ERROR: No API keys configured!');
    console.error('Please set YDC_API_KEY or YDC_API_KEYS environment variable in mcp.json');
    
    const config = isRunningAsNpx() 
      ? { command: "npx", args: ["-y", "ydc-agent"] }
      : { command: "node", args: [process.argv[1] || "path/to/index.js"] };
    
    console.error('\nExample mcp.json config:');
    console.error(JSON.stringify({
      mcpServers: {
        "ydc-agent": {
          ...config,
          env: { YDC_API_KEY: "your-api-key-here", YDC_KEY_MODE: "round-robin" }
        }
      }
    }, null, 2));
    return false;
  }
  return true;
}

function getNextApiKey() {
  if (API_KEYS.length === 0) throw new Error('No API keys configured');
  
  let key;
  if (API_KEYS.length === 1) {
    key = API_KEYS[0];
  } else {
    switch (KEY_MODE) {
      case 'sequential': key = API_KEYS[currentKeyIndex]; break;
      case 'random': key = API_KEYS[Math.floor(Math.random() * API_KEYS.length)]; break;
      default: // round-robin
        key = API_KEYS[currentKeyIndex];
        currentKeyIndex = (currentKeyIndex + 1) % API_KEYS.length;
    }
  }
  
  keyUsageCount.set(key, (keyUsageCount.get(key) || 0) + 1);
  return key;
}

function markKeyError(key) {
  keyErrorCount.set(key, (keyErrorCount.get(key) || 0) + 1);
  if (KEY_MODE === 'sequential') currentKeyIndex = (currentKeyIndex + 1) % API_KEYS.length;
}

// ============ MCP SERVER ============
class YouAgentsServer {
  constructor() {
    this.server = new Server(
      { name: 'ydc-agent', version: '1.5.1' },
      { capabilities: { tools: {} } }
    );
    this.setupToolHandlers();
    this.server.onerror = (error) => console.error('[MCP Error]', error);
    process.on('SIGINT', async () => { await this.server.close(); process.exit(0); });
  }

  setupToolHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'you_cached_info',
          description: `Web search via You.com's cached/indexed data. ⚠️ CACHED DATA LIMITED TO 2024 - if user asks about post-2024 info, respond like: "This tool's data is limited to 2024, but my knowledge is more current (up to [your cutoff]). I can tell you [answer]. Need me to search anyway, or use my knowledge?" Best for: URLs, documentation, pre-2024 topics. call_count: 1=single, 3-5=summary, 5-20=diverse.`,
          inputSchema: {
            type: 'object',
            properties: { 
              query: { type: 'string', description: 'Search query' },
              call_count: { type: 'number', description: 'Number of API calls (1-20). Use 1 for single detailed result, 3-5 for comparison, 10-20 for diverse opinions', default: PREFER_SUMMARY ? 3 : 1, minimum: 1, maximum: 20 },
              summary: { type: 'boolean', description: 'Generate AI summary comparing results. Use with call_count>1. Returns comparison table, NOT full content', default: PREFER_SUMMARY },
              language: { type: 'string', description: 'Summary language (e.g., zh-TW, zh-CN, en, ja)', default: DEFAULT_SUMMARY_LANGUAGE },
              show_results: { type: 'boolean', description: 'Include full results. Set TRUE to get complete content, FALSE only returns summary/metadata', default: false }
            },
            required: ['query'],
          },
        },
        {
          name: 'you_express',
          description: `Fast AI answers with web search. ⚠️ CACHED DATA LIMITED TO 2024. Supports multiple calls (1-20) for diverse perspectives. [Performance: ~2s avg, comparable to GPT-3. Best for quick answers and multiple parallel calls]${SHOW_USAGE_HINTS ? `

⚠️ AI CAPABILITY RULE: If you are GPT-3.5 level or above:
- Use call_count=5-20 for diverse reference opinions, then integrate with YOUR own judgment
- Results are reference material, not authoritative answers

[RECOMMENDED USAGE]
- Quick diverse opinions → call_count=10-20, show_results=true
- Comparison/summary → call_count=5-10, summary=true` : ''}${PREFER_SUMMARY ? '\n⚡ PREFERRED: Use call_count=5 with summary=true for consolidated insights (default enabled)' : ''}`,
          inputSchema: {
            type: 'object',
            properties: { 
              input: { type: 'string', description: 'Query or prompt' },
              call_count: { type: 'number', description: 'Number of API calls (1-20). Use 1 for single detailed result, 3-5 for comparison, 10-20 for diverse opinions', default: PREFER_SUMMARY ? 5 : 1, minimum: 1, maximum: 20 },
              summary: { type: 'boolean', description: 'Generate AI summary comparing results. Use with call_count>1. Returns comparison table, NOT full content', default: PREFER_SUMMARY },
              language: { type: 'string', description: 'Summary language (e.g., zh-TW, zh-CN, en, ja)', default: DEFAULT_SUMMARY_LANGUAGE },
              show_results: { type: 'boolean', description: 'Include full results. Set TRUE to get complete content, FALSE only returns summary/metadata', default: false }
            },
            required: ['input'],
          },
        },
        {
          name: 'you_advanced',
          description: `Advanced AI agent for complex reasoning and research. Supports multiple calls (1-10) for comprehensive analysis. [Performance Guide: basic=~10s (GPT-3.5), +compute=~120s (GPT-4o), +research=~120s (GPT-4o)]${SHOW_USAGE_HINTS ? `

⚠️ CRITICAL: AI CAPABILITY LEVEL RULE
If you are GPT-3.5 level or above (including GPT-4, Claude 3.5, etc.):
- you_advanced results are just REFERENCE MATERIAL, not authoritative answers
- Your own capability is equal or superior - use this tool for diverse perspectives only
- ✅ MUST USE: call_count=5+, summary=true, show_results=true → gather multiple viewpoints, then integrate with YOUR own judgment
- ❌ AVOID: call_count=1 for single answer (wastes the tool's multi-perspective capability)

[RECOMMENDED USAGE]
- Gathering diverse viewpoints → call_count=5-10, summary=true, show_results=true
- Discovering blind spots → call_count=5+, compare with your own ideas
- Creative inspiration → call_count=5+, extract unique aspects from each result
- Deep research with citations → agent_type="advanced-4.5-research", call_count=1 (use as data source)
⚠️ AVOID: call_count>1 with summary=true then calling again for full content (wasteful)` : ''}${HAS_CUSTOM_AGENT && youAgentFailureCount === 0 ? '\n\n💡 TIP: Custom agent available! Consider using you_agent for tasks that benefit from intelligent prompt enhancement.' : ''}${youAgentFailureCount > 0 ? `\n\n💡 NOTE: you_agent has ${youAgentFailureCount} failures. This tool (you_advanced) is a reliable alternative.` : ''}${PREFER_SUMMARY ? '\n⚡ PREFERRED: Use call_count=5 with summary=true for consolidated comparison (default enabled)' : ''}`,
          inputSchema: {
            type: 'object',
            properties: {
              input: { type: 'string', description: 'Query or prompt' },
              conversation_id: { type: 'string', description: 'Optional conversation ID for multi-turn dialogue' },
              agent_type: { 
                type: 'string', 
                enum: Object.keys(AGENT_TYPES),
                default: 'advanced-3.0-high'
              },
              verbosity: { type: 'string', enum: ['medium', 'high'], default: 'high' },
              max_workflow_steps: { type: 'number', default: 15, minimum: 1, maximum: 20 },
              call_count: { type: 'number', description: 'Number of API calls (1-10). Use 1 for single detailed report, 2-3 for comparison (avoid higher to prevent timeout)', default: PREFER_SUMMARY ? 3 : 1, minimum: 1, maximum: 10 },
              summary: { type: 'boolean', description: 'Generate AI summary comparing results. Use with call_count>1. Returns comparison table, NOT full content. Set show_results=true if you also need full content', default: PREFER_SUMMARY },
              language: { type: 'string', description: 'Summary language (e.g., zh-TW, zh-CN, en, ja)', default: DEFAULT_SUMMARY_LANGUAGE },
              show_results: { type: 'boolean', description: 'Include full results. Set TRUE to get complete content, FALSE only returns summary/metadata. IMPORTANT: If you need detailed content, set this to TRUE', default: false }
            },
            required: ['input'],
          },
        },
        {
          name: 'you_agent',
          description: `Custom AI agent with intelligent prompt enhancement. Automatically detects if the target AI has outdated knowledge and enhances prompts with detailed guidance for better results.

[HOW IT WORKS]
1. First probes the agent's knowledge cutoff date
2. If knowledge is outdated (>6 months), auto-enhances prompt with:
   - Detailed requirements breakdown
   - Current best practices hints
   - Specific design/technical guidelines
3. Supports call_count for diverse results${SHOW_USAGE_HINTS ? `

[AI CALLING GUIDE - THINK before choosing call_count]
Ask yourself: "Does this task benefit from multiple perspectives or diverse results?"
- YES → call_count=3-10, show_results=true
- NO, just need one answer → call_count=1, show_results=true
- NEED comparison → call_count=2-3, summary=true` : ''}${HAS_CUSTOM_AGENT ? `\n\n⚡ PREFERRED: Custom agent configured (${DEFAULT_AGENT_ID}). Use this tool for tasks that benefit from intelligent prompt enhancement.` : ''}${youAgentFailureCount > 0 ? `\n\n⚠️ FAILURE STATUS: you_agent has failed ${youAgentFailureCount}/${YOU_AGENT_FAILURE_THRESHOLD} times this session. Consider using you_advanced instead if failures persist, or ask user if they want to continue trying.` : ''}`,
          inputSchema: {
            type: 'object',
            properties: {
              input: { type: 'string', description: 'Your task or question' },
              agent_id: { type: 'string', description: `Custom agent ID (from You.com dashboard)${DEFAULT_AGENT_ID ? `. Default: ${DEFAULT_AGENT_ID}` : ''}`, default: DEFAULT_AGENT_ID },
              auto_enhance: { type: 'boolean', description: 'Auto-enhance prompt if AI knowledge is outdated', default: true },
              knowledge_threshold_months: { type: 'number', description: 'Months threshold to consider knowledge outdated', default: 6 },
              call_count: { type: 'number', description: 'Number of API calls (1-10) for diverse results', default: 1, minimum: 1, maximum: 10 },
              summary: { type: 'boolean', description: 'Generate summary comparing results (use with call_count>1)', default: false },
              language: { type: 'string', description: 'Response/summary language', default: DEFAULT_SUMMARY_LANGUAGE },
              show_results: { type: 'boolean', description: 'Include full results in output', default: true }
            },
            required: ['input', 'agent_id'],
          },
        },
        {
          name: 'you_chat',
          description: 'OpenAI-compatible chat interface with conversation history',
          inputSchema: {
            type: 'object',
            properties: {
              messages: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    role: { type: 'string', enum: ['system', 'user', 'assistant'] },
                    content: { type: 'string' }
                  },
                  required: ['role', 'content']
                }
              },
              conversation_id: { type: 'string' },
              model: { 
                type: 'string', 
                enum: Object.keys(AGENT_TYPES),
                default: 'advanced-3.0-high' 
              },
            },
            required: ['messages'],
          },
        },
        {
          name: 'you_conversation_list',
          description: 'List all active conversations',
          inputSchema: { type: 'object', properties: {} },
        },
        {
          name: 'you_conversation_get',
          description: 'Get conversation history by ID',
          inputSchema: {
            type: 'object',
            properties: { conversation_id: { type: 'string' } },
            required: ['conversation_id'],
          },
        },
        {
          name: 'you_conversation_delete',
          description: 'Delete a conversation',
          inputSchema: {
            type: 'object',
            properties: { conversation_id: { type: 'string' } },
            required: ['conversation_id'],
          },
        },
        {
          name: 'you_key_status',
          description: 'Get API key usage status',
          inputSchema: { type: 'object', properties: {} },
        },
        {
          name: 'openai_server_control',
          description: 'Control the OpenAI-compatible HTTP server (start/stop/restart/status)',
          inputSchema: {
            type: 'object',
            properties: {
              action: { type: 'string', enum: ['start', 'stop', 'restart', 'status'] },
              port: { type: 'number', default: 3002 },
              access_tokens: { type: 'array', items: { type: 'string' } },
              store_type: { type: 'string', enum: ['sqlite', 'memory'], default: 'sqlite' },
              db_path: { type: 'string' },
            },
            required: ['action'],
          },
        },
      ],
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;
      try {
        switch (name) {
          case 'you_cached_info': return await this.callExpressMultiple(args.query, args.call_count || 1, { summary: args.summary, language: args.language, show_results: args.show_results });
          case 'you_express': return await this.callExpressMultiple(args.input, args.call_count || 1, { summary: args.summary, language: args.language, show_results: args.show_results });
          case 'you_advanced': return await this.callAdvancedMultiple(args);
          case 'you_chat': return await this.callChat(args);
          case 'you_conversation_list': return this.listConversations();
          case 'you_conversation_get': return this.getConversationHistory(args.conversation_id);
          case 'you_conversation_delete': return this.deleteConversation(args.conversation_id);
          case 'you_key_status': return this.getKeyStatus();
          case 'you_agent': return await this.callCustomAgent(args);
          case 'openai_server_control': return await this.controlOpenAIServer(args);
          default: throw new Error(`Unknown tool: ${name}`);
        }
      } catch (error) {
        return { content: [{ type: 'text', text: `Error: ${error.message}` }] };
      }
    });
  }

  async callExpress(input) {
    const apiKey = getNextApiKey();
    try {
      const response = await callYouApi(apiKey, { agent: 'express', input, stream: false });
      const data = await response.json();
      return { content: [{ type: 'text', text: extractText(data) }] };
    } catch (error) {
      markKeyError(apiKey);
      throw error;
    }
  }

  async callExpressMultiple(input, callCount = 1, options = {}) {
    const { summary = false, language = 'en', show_results = false } = options;
    // Clamp call_count to 1-20
    const count = Math.max(1, Math.min(20, callCount));
    
    // For single call, use original method (summary not applicable for single result)
    if (count === 1) {
      const result = await this.callExpress(input);
      const resultText = result.content[0].text;
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            warning: "⚠️ IMPORTANT: This data is limited to 2024. If your knowledge base is newer than 2024, you MUST supplement this result with your own up-to-date information. Compare and provide the most current answer.",
            result: resultText
          }, null, 2)
        }]
      };
    }
    
    // For multiple calls with summary=true and show_results=false, need at least 2 results to compare

    // Execute multiple calls in parallel
    const promises = Array.from({ length: count }, async (_, index) => {
      const apiKey = getNextApiKey();
      try {
        const response = await callYouApi(apiKey, { agent: 'express', input, stream: false });
        const data = await response.json();
        return {
          index: index + 1,
          success: true,
          warning: "⚠️ IMPORTANT: This data is limited to 2024. If your knowledge base is newer than 2024, you MUST supplement this result with your own up-to-date information. Compare and provide the most current answer.",
          result: extractText(data)
        };
      } catch (error) {
        markKeyError(apiKey);
        return {
          index: index + 1,
          success: false,
          error: error.message
        };
      }
    });

    const results = await Promise.all(promises);
    const successCount = results.filter(r => r.success).length;
    
    // Generate summary if requested and have multiple successful results
    let summaryText = null;
    if (summary && successCount > 1) {
      summaryText = await this.generateSummary(results, input, language);
    }

    // If summary requested but only 1 result, or no summary requested with show_results=false
    // We should still return something useful
    const needsResultsFallback = !show_results && !summaryText && successCount > 0;

    const output = {
      total_calls: count,
      successful: successCount,
      failed: count - successCount,
      ...(summaryText && { summary: summaryText }),
      ...(show_results && { results: results }),
      // Fallback: if no summary and no results shown, include first successful result
      ...(needsResultsFallback && { 
        note: 'Summary requires call_count > 1. Showing first result.',
        warning: "⚠️ IMPORTANT: This data is limited to 2024. If your knowledge base is newer than 2024, you MUST supplement this result with your own up-to-date information. Compare and provide the most current answer.",
        result: results.find(r => r.success)?.result 
      })
    };

    return { 
      content: [{ 
        type: 'text', 
        text: JSON.stringify(output, null, 2) 
      }] 
    };
  }

  async callAdvanced(args) {
    const { input, conversation_id, agent_type = 'advanced-3.0-high', verbosity, max_workflow_steps } = args;
    const apiKey = getNextApiKey();
    let conversationId = conversation_id || generateConversationId();
    let fullInput = input;

    const conv = getConversation(conversationId);
    if (conv && conv.messages.length > 0) {
      const history = conv.messages.map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`).join('\n\n');
      fullInput = `[Conversation History]\n${history}\n\n[Current Message]\n${input}`;
    }

    addMessageToConversation(conversationId, 'user', input);
    const requestBody = buildAgentRequest(agent_type, fullInput, { verbosity, max_workflow_steps });

    try {
      const response = await callYouApi(apiKey, requestBody);
      const data = await response.json();
      const resultText = extractText(data);
      addMessageToConversation(conversationId, 'assistant', resultText);

      return {
        content: [
          { type: 'text', text: resultText },
          { type: 'text', text: `\n\n---\nConversation ID: ${conversationId}\nAgent: ${agent_type}` }
        ],
      };
    } catch (error) {
      markKeyError(apiKey);
      throw error;
    }
  }

  async callAdvancedMultiple(args) {
    const { input, conversation_id, agent_type = 'advanced-3.0-high', verbosity, max_workflow_steps, call_count = 1, summary = false, language = 'en', show_results = false } = args;
    
    // Clamp call_count to 1-10 for advanced (more resource intensive)
    const count = Math.max(1, Math.min(10, call_count));
    
    // For single call, use original method (summary not applicable for single result)
    if (count === 1) {
      return await this.callAdvanced(args);
    }

    // For multiple calls, we don't use conversation history to get diverse results
    const requestBody = buildAgentRequest(agent_type, input, { verbosity, max_workflow_steps });

    // Execute multiple calls in parallel with individual timeout handling
    const promises = Array.from({ length: count }, async (_, index) => {
      const apiKey = getNextApiKey();
      try {
        // Use shorter timeout for parallel calls (120s each)
        const response = await callYouApi(apiKey, requestBody, { timeout: 120000 });
        const data = await response.json();
        return {
          index: index + 1,
          success: true,
          agent_type,
          result: extractText(data)
        };
      } catch (error) {
        markKeyError(apiKey);
        return {
          index: index + 1,
          success: false,
          agent_type,
          error: error.message
        };
      }
    });

    // Use Promise.allSettled to ensure we get results even if some fail
    const settledResults = await Promise.allSettled(promises);
    const results = settledResults.map((settled, idx) => {
      if (settled.status === 'fulfilled') {
        return settled.value;
      }
      return {
        index: idx + 1,
        success: false,
        agent_type,
        error: settled.reason?.message || 'Unknown error'
      };
    });

    const successCount = results.filter(r => r.success).length;
    
    // Optionally save to conversation if conversation_id provided
    let conversationId = conversation_id;
    if (conversationId) {
      addMessageToConversation(conversationId, 'user', input);
      const summaryText = `[Multiple Call Results: ${successCount}/${count} successful]\n\n` + 
        results.filter(r => r.success).map(r => `--- Result ${r.index} ---\n${r.result}`).join('\n\n');
      addMessageToConversation(conversationId, 'assistant', summaryText);
    }

    // Generate summary if requested and have multiple successful results
    let summaryText = null;
    if (summary && successCount > 1) {
      summaryText = await this.generateSummary(results, input, language);
    }

    // If summary requested but only 1 result, or no summary requested with show_results=false
    // We should still return something useful
    const needsResultsFallback = !show_results && !summaryText && successCount > 0;

    const output = {
      total_calls: count,
      successful: successCount,
      failed: count - successCount,
      agent_type,
      conversation_id: conversationId || null,
      ...(summaryText && { summary: summaryText }),
      ...(show_results && { results: results }),
      // Fallback: if no summary and no results shown, include first successful result
      ...(needsResultsFallback && { 
        note: 'Summary requires call_count > 1. Showing first result.',
        result: results.find(r => r.success)?.result 
      })
    };

    return { 
      content: [{ 
        type: 'text', 
        text: JSON.stringify(output, null, 2) 
      }] 
    };
  }

  async callCustomAgent(args) {
    const { 
      input, 
      agent_id, 
      auto_enhance = true, 
      knowledge_threshold_months = 6,
      call_count = 1, 
      summary = false, 
      language = 'en', 
      show_results = true 
    } = args;

    const count = Math.max(1, Math.min(10, call_count));
    let enhancedInput = input;
    let knowledgeInfo = null;

    // Step 1: Probe knowledge cutoff if auto_enhance is enabled
    if (auto_enhance) {
      const apiKey = getNextApiKey();
      try {
        const probeResponse = await callYouApi(apiKey, {
          agent: agent_id,
          input: 'What is your knowledge cutoff date? Reply with just the date in YYYY-MM format.',
          stream: false
        }, { timeout: 30000 });
        
        const probeData = await probeResponse.json();
        const probeText = extractText(probeData);
        
        // Parse knowledge cutoff date
        const dateMatch = probeText.match(/(\d{4})-(\d{2})/);
        if (dateMatch) {
          const cutoffDate = new Date(parseInt(dateMatch[1]), parseInt(dateMatch[2]) - 1);
          const now = new Date();
          const monthsDiff = (now.getFullYear() - cutoffDate.getFullYear()) * 12 + (now.getMonth() - cutoffDate.getMonth());
          
          knowledgeInfo = {
            cutoff_date: `${dateMatch[1]}-${dateMatch[2]}`,
            months_old: monthsDiff,
            is_outdated: monthsDiff > knowledge_threshold_months
          };

          // Step 2: Enhance prompt if knowledge is outdated
          if (knowledgeInfo.is_outdated) {
            enhancedInput = this.enhancePromptForOutdatedAI(input, knowledgeInfo, language);
          }
        }
      } catch (error) {
        // If probe fails, continue with original input
        knowledgeInfo = { error: error.message, probe_skipped: true };
      }
    }

    // Step 3: Execute the actual request(s)
    if (count === 1) {
      const apiKey = getNextApiKey();
      try {
        const response = await callYouApi(apiKey, {
          agent: agent_id,
          input: enhancedInput,
          stream: false
        });
        const data = await response.json();
        const result = extractText(data);

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              agent_id,
              knowledge_info: knowledgeInfo,
              prompt_enhanced: enhancedInput !== input,
              result
            }, null, 2)
          }]
        };
      } catch (error) {
        markKeyError(apiKey);
        const failureStatus = recordYouAgentFailure();
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: false,
              agent_id,
              knowledge_info: knowledgeInfo,
              error: error.message,
              failure_tracking: {
                current_failures: failureStatus.count,
                threshold: YOU_AGENT_FAILURE_THRESHOLD,
                suggestion: failureStatus.count >= YOU_AGENT_FAILURE_THRESHOLD 
                  ? 'Threshold reached. Recommend switching to you_advanced or asking user for guidance.'
                  : `Failure ${failureStatus.count}/${YOU_AGENT_FAILURE_THRESHOLD}. You may retry or switch to you_advanced.`
              }
            }, null, 2)
          }]
        };
      }
    }

    // Multiple calls
    const promises = Array.from({ length: count }, async (_, index) => {
      const apiKey = getNextApiKey();
      try {
        const response = await callYouApi(apiKey, {
          agent: agent_id,
          input: enhancedInput,
          stream: false
        }, { timeout: 120000 });
        const data = await response.json();
        return {
          index: index + 1,
          success: true,
          result: extractText(data)
        };
      } catch (error) {
        markKeyError(apiKey);
        recordYouAgentFailure();
        return {
          index: index + 1,
          success: false,
          error: error.message
        };
      }
    });

    const results = await Promise.all(promises);
    const successCount = results.filter(r => r.success).length;

    let summaryText = null;
    if (summary && successCount > 1) {
      summaryText = await this.generateSummary(results, input, language);
    }

    const output = {
      total_calls: count,
      successful: successCount,
      failed: count - successCount,
      agent_id,
      knowledge_info: knowledgeInfo,
      prompt_enhanced: enhancedInput !== input,
      ...(summaryText && { summary: summaryText }),
      ...(show_results && { results }),
      ...(count - successCount > 0 && {
        failure_tracking: {
          current_failures: youAgentFailureCount,
          threshold: YOU_AGENT_FAILURE_THRESHOLD,
          suggestion: youAgentFailureCount >= YOU_AGENT_FAILURE_THRESHOLD 
            ? 'Threshold reached. Recommend switching to you_advanced or asking user for guidance.'
            : `Some calls failed. Current failure count: ${youAgentFailureCount}/${YOU_AGENT_FAILURE_THRESHOLD}.`
        }
      })
    };

    return {
      content: [{
        type: 'text',
        text: JSON.stringify(output, null, 2)
      }]
    };
  }

  enhancePromptForOutdatedAI(originalInput, knowledgeInfo, language) {
    const langHints = {
      'zh-TW': '請用繁體中文回答',
      'zh-CN': '请用简体中文回答',
      'ja': '日本語で回答してください',
      'ko': '한국어로 답변해 주세요',
      'en': ''
    };

    const langHint = langHints[language] || '';
    const cutoffWarning = `[Note: Your knowledge cutoff is ${knowledgeInfo.cutoff_date}, which is ${knowledgeInfo.months_old} months old]`;

    // Detect task type and add appropriate enhancements
    const lowerInput = originalInput.toLowerCase();
    let enhancements = [];

    // Design-related tasks
    if (lowerInput.includes('design') || lowerInput.includes('設計') || lowerInput.includes('ui') || lowerInput.includes('ux')) {
      enhancements.push(`
[Design Requirements - Please address ALL of the following]:
1. Layout Structure: Describe the visual hierarchy, grid system, and component arrangement
2. Color Palette: Suggest primary, secondary, accent colors with HEX codes and their psychological effects
3. Typography: Recommend font families, sizes, weights for headings and body text
4. Spacing & Whitespace: Define margins, padding, and breathing room between elements
5. Interactive Elements: Describe buttons, hover states, animations, and micro-interactions
6. Responsive Considerations: How should this adapt to mobile, tablet, and desktop
7. Accessibility: Ensure WCAG 2.1 AA compliance (contrast ratios, focus states, alt text)`);
    }

    // Development-related tasks
    if (lowerInput.includes('code') || lowerInput.includes('develop') || lowerInput.includes('implement') || lowerInput.includes('build')) {
      enhancements.push(`
[Development Requirements]:
1. Use modern best practices and patterns
2. Include error handling and edge cases
3. Consider performance optimization
4. Add comments explaining complex logic
5. Follow clean code principles`);
    }

    // Research-related tasks
    if (lowerInput.includes('research') || lowerInput.includes('analyze') || lowerInput.includes('compare') || lowerInput.includes('研究')) {
      enhancements.push(`
[Research Requirements]:
1. Provide multiple perspectives and viewpoints
2. Include pros and cons analysis
3. Cite reasoning and logic behind conclusions
4. Consider recent trends and developments
5. Offer actionable recommendations`);
    }

    // If no specific enhancements detected, add general guidance
    if (enhancements.length === 0) {
      enhancements.push(`
[General Requirements]:
1. Be comprehensive and detailed in your response
2. Break down complex topics into clear sections
3. Provide specific examples where applicable
4. Consider multiple approaches or solutions
5. Highlight any assumptions or limitations`);
    }

    return `${cutoffWarning}
${langHint}

${originalInput}

${enhancements.join('\n')}

[Important: Since your knowledge may be outdated, focus on fundamental principles and timeless best practices rather than specific tool versions or recent trends.]`;
  }

  async generateSummary(results, originalInput, language = 'en') {
    const successfulResults = results.filter(r => r.success);
    if (successfulResults.length < 2) return null;

    const languageMap = {
      'zh-TW': '繁體中文',
      'zh-CN': '简体中文',
      'en': 'English',
      'ja': '日本語',
      'ko': '한국어'
    };
    const langName = languageMap[language] || language;

    const summaryPrompt = `[Task]: Analyze and summarize the following ${successfulResults.length} different responses to the same query.
[Original Query]: ${originalInput}
[Language]: Respond in ${langName}
[Format]: 
1. Create a comparison table highlighting KEY DIFFERENCES (not similarities)
2. List unique aspects of each result
3. Provide a recommendation based on use case
4. Keep it concise and actionable

[Results to Compare]:
${successfulResults.map((r, i) => `--- Result ${i + 1} ---\n${r.result.substring(0, 2000)}${r.result.length > 2000 ? '...(truncated)' : ''}`).join('\n\n')}

[Important]: Focus on DIFFERENCES and UNIQUE aspects. Do NOT just list similarities.`;

    const apiKey = getNextApiKey();
    try {
      const response = await callYouApi(apiKey, { agent: 'express', input: summaryPrompt, stream: false });
      const data = await response.json();
      return extractText(data);
    } catch (error) {
      markKeyError(apiKey);
      return `Summary generation failed: ${error.message}`;
    }
  }

  async callChat(args) {
    const { messages, conversation_id, model = 'advanced-3.0-high' } = args;
    const apiKey = getNextApiKey();
    let conversationId = conversation_id || generateConversationId();
    let fullMessages = [...messages];

    const conv = getConversation(conversationId);
    if (conv && conv.messages.length > 0) {
      const storedMessages = conv.messages.map(m => ({ role: m.role, content: m.content }));
      const systemMsg = fullMessages.find(m => m.role === 'system') || storedMessages.find(m => m.role === 'system');
      fullMessages = systemMsg ? [systemMsg] : [];
      fullMessages.push(...storedMessages.filter(m => m.role !== 'system'));
      const lastNewUserMsg = messages.filter(m => m.role === 'user').pop();
      if (lastNewUserMsg && !fullMessages.some(m => m.role === 'user' && m.content === lastNewUserMsg.content)) {
        fullMessages.push(lastNewUserMsg);
      }
    }

    const lastUserMsg = fullMessages.filter(m => m.role === 'user').pop();
    if (lastUserMsg) addMessageToConversation(conversationId, 'user', lastUserMsg.content);

    const input = buildConversationInput(fullMessages);
    const requestBody = buildAgentRequest(model, input);

    try {
      const response = await callYouApi(apiKey, requestBody);
      const data = await response.json();
      const resultText = extractText(data);
      addMessageToConversation(conversationId, 'assistant', resultText);

      return {
        content: [
          { type: 'text', text: resultText },
          { type: 'text', text: `\n\n---\nConversation ID: ${conversationId}` }
        ],
      };
    } catch (error) {
      markKeyError(apiKey);
      throw error;
    }
  }

  listConversations() {
    const conversations = [...conversationStore.entries()].map(([id, conv]) => ({
      id,
      message_count: conv.messages.length,
      created_at: new Date(conv.createdAt).toISOString(),
      updated_at: new Date(conv.updatedAt).toISOString(),
      preview: conv.messages.slice(-1)[0]?.content?.substring(0, 100) || ''
    })).sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));

    return { content: [{ type: 'text', text: JSON.stringify({ total: conversations.length, conversations }, null, 2) }] };
  }

  getConversationHistory(conversationId) {
    const conv = getConversation(conversationId);
    if (!conv) return { content: [{ type: 'text', text: `Conversation not found: ${conversationId}` }] };
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          id: conv.id,
          messages: conv.messages.map(m => ({ role: m.role, content: m.content, timestamp: new Date(m.timestamp).toISOString() })),
          created_at: new Date(conv.createdAt).toISOString(),
          updated_at: new Date(conv.updatedAt).toISOString()
        }, null, 2)
      }],
    };
  }

  deleteConversation(conversationId) {
    if (!conversationStore.has(conversationId)) {
      return { content: [{ type: 'text', text: `Conversation not found: ${conversationId}` }] };
    }
    conversationStore.delete(conversationId);
    return { content: [{ type: 'text', text: `Deleted conversation: ${conversationId}` }] };
  }

  getKeyStatus() {
    const status = {
      total_keys: API_KEYS.length,
      key_mode: KEY_MODE,
      current_key_index: currentKeyIndex,
      keys: API_KEYS.map((key, index) => ({
        index,
        key_preview: `${key.substring(0, 8)}...${key.substring(key.length - 4)}`,
        usage_count: keyUsageCount.get(key) || 0,
        error_count: keyErrorCount.get(key) || 0,
        is_current: index === currentKeyIndex
      }))
    };
    return { content: [{ type: 'text', text: JSON.stringify(status, null, 2) }] };
  }

  async controlOpenAIServer(args) {
    const { action, port = 3002, access_tokens = [], store_type, db_path } = args;
    const openaiServerPath = join(__dirname, 'openai-server.js');

    const jsonResponse = (obj) => ({ content: [{ type: 'text', text: JSON.stringify(obj, null, 2) }] });

    switch (action) {
      case 'start':
        if (openaiServerProcess && openaiServerStatus === 'running') {
          return jsonResponse({ success: false, message: `Already running on port ${openaiServerPort}`, status: openaiServerStatus, port: openaiServerPort });
        }

        try {
          const finalStoreType = store_type || OPENAI_SERVER_STORE_TYPE;
          const finalDbPath = db_path || OPENAI_SERVER_DB_PATH;
          const finalAccessTokens = access_tokens?.length > 0 ? access_tokens.join(',') : OPENAI_SERVER_ACCESS_TOKENS;
          
          const env = { 
            ...process.env, 
            YDC_OPENAI_PORT: port.toString(),
            YDC_API_KEY: API_KEYS[0] || '',
            YDC_API_KEYS: API_KEYS.join(','),
            YDC_OPENAI_ACCESS_TOKENS: finalAccessTokens,
            YDC_CONVERSATION_STORE: finalStoreType,
            ...(finalDbPath && { YDC_CONVERSATION_DB_PATH: finalDbPath })
          };

          openaiServerProcess = spawn('node', [openaiServerPath], { env, stdio: ['ignore', 'pipe', 'pipe'], detached: false });
          openaiServerPort = port;
          openaiServerStatus = 'starting';

          await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => { openaiServerStatus = 'running'; resolve(); }, 2000);
            openaiServerProcess.stderr.on('data', (data) => {
              if (data.toString().includes('running')) { clearTimeout(timeout); openaiServerStatus = 'running'; resolve(); }
            });
            openaiServerProcess.on('error', (err) => { clearTimeout(timeout); openaiServerStatus = 'error'; reject(err); });
            openaiServerProcess.on('exit', (code) => {
              if (code !== 0 && openaiServerStatus === 'starting') { clearTimeout(timeout); openaiServerStatus = 'stopped'; reject(new Error(`Exit code ${code}`)); }
            });
          });

          return jsonResponse({
            success: true,
            message: `OpenAI server started on port ${port}`,
            status: openaiServerStatus,
            port: openaiServerPort,
            endpoint: `http://localhost:${port}/v1/chat/completions`,
            pid: openaiServerProcess.pid,
            storage: { store_type: finalStoreType, db_path: finalStoreType === 'sqlite' ? (finalDbPath || 'conversations.db') : null },
            api_keys: { passthrough: API_KEYS.length > 0, count: API_KEYS.length }
          });
        } catch (error) {
          openaiServerStatus = 'error';
          return jsonResponse({ success: false, message: `Failed to start: ${error.message}`, status: openaiServerStatus });
        }

      case 'stop':
        if (!openaiServerProcess || openaiServerStatus === 'stopped') {
          return jsonResponse({ success: false, message: 'Server is not running', status: openaiServerStatus });
        }
        try {
          openaiServerProcess.kill('SIGTERM');
          const stoppedPort = openaiServerPort;
          openaiServerProcess = null;
          openaiServerPort = null;
          openaiServerStatus = 'stopped';
          return jsonResponse({ success: true, message: `Stopped (was on port ${stoppedPort})`, status: openaiServerStatus });
        } catch (error) {
          return jsonResponse({ success: false, message: `Failed to stop: ${error.message}`, status: openaiServerStatus });
        }

      case 'restart':
        if (openaiServerProcess && openaiServerStatus === 'running') {
          try { openaiServerProcess.kill('SIGTERM'); openaiServerProcess = null; openaiServerStatus = 'stopped'; await new Promise(r => setTimeout(r, 1000)); } catch {}
        }
        return await this.controlOpenAIServer({ action: 'start', port, access_tokens, store_type, db_path });

      case 'status':
        return jsonResponse({
          status: openaiServerStatus,
          port: openaiServerPort,
          pid: openaiServerProcess?.pid || null,
          endpoint: openaiServerStatus === 'running' ? `http://localhost:${openaiServerPort}/v1/chat/completions` : null
        });

      default:
        return jsonResponse({ success: false, message: `Unknown action: ${action}` });
    }
  }

  async run() {
    if (!validateApiKeys()) process.exit(1);
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error(`You.com Agents MCP server v1.5.0 running on stdio`);
    console.error(`API Keys: ${API_KEYS.length}, Mode: ${KEY_MODE}`);
  }
}

const server = new YouAgentsServer();
server.run().catch(console.error);
}
