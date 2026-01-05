# ydc-agent

[![npm version](https://img.shields.io/npm/v/ydc-agent.svg)](https://www.npmjs.com/package/ydc-agent)
[![npm downloads](https://img.shields.io/npm/dm/ydc-agent.svg)](https://www.npmjs.com/package/ydc-agent)

MCP server for You.com AI agents with OpenAI-compatible API.

> 📖 Other languages: 繁體中文 | 简体中文 | 日本語 (see README_ZH_TW.md, README_ZH_CN.md, README_JA.md)

## MCP Configuration

### Claude Desktop / Cursor / Windsurf

Add to your MCP config file:

**macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`  
**Windows**: `%APPDATA%\Claude\claude_desktop_config.json`  
**Cursor/Windsurf**: `.cursor/mcp.json` or `.windsurf/mcp.json`

```json
{
  "mcpServers": {
    "ydc-agent": {
      "command": "npx",
      "args": ["-y", "ydc-agent"],
      "env": {
        "YDC_API_KEY": "your-api-key"
      }
    }
  }
}
```

### With Multiple API Keys

```json
{
  "mcpServers": {
    "ydc-agent": {
      "command": "npx",
      "args": ["-y", "ydc-agent"],
      "env": {
        "YDC_API_KEYS": "key1,key2,key3",
        "YDC_KEY_MODE": "round-robin"
      }
    }
  }
}
```

Key modes: `round-robin` (default), `sequential`, `random`

## Available MCP Tools

| Tool | Description |
|------|-------------|
| `you_cached_info` | Web and news search (cached data, limited to 2024) |
| `you_express` | Fast AI answers (cached data, limited to 2024) |
| `you_advanced` | Complex reasoning with compute/research tools |
| `you_agent` | Custom AI agent with intelligent prompt enhancement |
| `you_chat` | OpenAI-compatible chat with conversation history |
| `you_conversation_list` | List active conversations |
| `you_conversation_get` | Get conversation history |
| `you_conversation_delete` | Delete conversation |
| `you_key_status` | API key usage statistics |
| `openai_server_control` | Start/stop OpenAI-compatible HTTP server |

### Built-in AI Guidance

Tool descriptions include guidance for AI callers:

| Tool | Built-in Feature |
|------|------------------|
| `you_cached_info` | Guides AI to use `call_count=5+` for diverse results (cached data ≤2024) |
| `you_express` | Guides AI to use `call_count=5+` for diverse opinions (cached data ≤2024) |
| `you_advanced` | **AI Capability Rule**: If caller is GPT-3.5+, results are reference material only - use `call_count=5+` for multiple perspectives |
| `you_agent` | **Failure Tracking**: Auto-tracks failures, suggests switching to `you_advanced` after threshold (default: 3 failures) |

## AI Calling Decision Guide

### ⚠️ For GPT-3.5+ Level AI

If you are GPT-3.5 or above (GPT-4, Claude 3.5, etc.):
- `you_advanced` results are **reference material**, not authoritative answers
- Use `call_count=5+` to gather multiple perspectives, then integrate with your own judgment
- Avoid `call_count=1` for single answers (wastes multi-perspective capability)

### Quick Reference

| Use Case | Tool | Parameters |
|----------|------|------------|
| Diverse viewpoints | `you_advanced` | `call_count=5-10, summary=true, show_results=true` |
| Quick opinions | `you_express` | `call_count=10-20, show_results=true` |
| Deep research | `you_advanced` | `agent_type="advanced-4.5-research", call_count=1` |
| Cached web search | `you_cached_info` | `call_count=5-20, show_results=true` |

### ⚠️ Common Mistakes

| Wrong | Correct |
|-------|---------|
| `call_count=1` for single answer | `call_count=5+` for diverse perspectives |
| Treat results as authoritative | Treat as reference, integrate yourself |
| `call_count=10` with `you_advanced` | Use `you_express` or `call_count=3-5` |

## Models / Agent Types

| Model | Description |
|-------|-------------|
| `express` | Fast responses |
| `research` | Deep analysis |
| `advanced-3.0-high` | Compute tools (default) |
| `advanced-4.5-high-research` | Full tools (compute + research) |
| `<custom-agent-id>` | Any custom You.com agent ID |

### Custom Agent ID

You can use any custom You.com agent ID as the model name:

```bash
curl -X POST http://localhost:3002/v1/chat/completions \
  -H "Authorization: Bearer token" \
  -H "Content-Type: application/json" \
  -d '{"model":"your-custom-agent-uuid","messages":[{"role":"user","content":"Hello"}]}'
```

## OpenAI-Compatible Server

Start via npx:

```bash
# Start with single API key
npx ydc-agent --openai --api-key YOUR_API_KEY

# Start with multiple API keys (round-robin)
npx ydc-agent --openai --api-keys KEY1,KEY2,KEY3

# With custom port and key mode
npx ydc-agent --openai --api-keys KEY1,KEY2 --port 3003 --key-mode random

# With access token authentication
npx ydc-agent --openai --api-key YOUR_API_KEY --access-token SECRET

# With custom agents (name:id format)
npx ydc-agent --openai --api-key YOUR_API_KEY --agent mybot:uuid-here --agent another:uuid2
```

Or via MCP tool `openai_server_control`.

### Endpoints

- `POST /v1/chat/completions` - Chat completions
- `GET /v1/models` - List models
- `GET /health` - Health check

### Usage

```bash
curl -X POST http://localhost:3002/v1/chat/completions \
  -H "Authorization: Bearer token" \
  -H "Content-Type: application/json" \
  -d '{"model":"express","messages":[{"role":"user","content":"Hello"}]}'
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `YDC_API_KEY` | You.com API key | required |
| `YDC_API_KEYS` | Multiple keys (comma-separated) | - |
| `YDC_KEY_MODE` | round-robin / sequential / random | round-robin |
| `YDC_OPENAI_PORT` | HTTP server port | 3002 |
| `YDC_CONVERSATION_STORE` | sqlite / memory | sqlite |
| `YDC_OPENAI_ACCESS_TOKENS` | Allowed tokens (comma-separated) | - |
| `YDC_CUSTOM_AGENTS` | Custom agents (name:id,name2:id2) | - |
| `YDC_AGENT_FAILURE_THRESHOLD` | you_agent failure threshold before disable | 3 |

## PM2 Deployment

For production deployment with PM2:

```bash
# Using ecosystem config
pm2 start ecosystem.config.cjs

# Or direct command (Windows)
pm2 start "cmd /c npx ydc-agent --openai --api-key YOUR_KEY" --name ydc
```

## Cloudflare Worker Deployment

Deploy as a serverless Cloudflare Worker with D1 database for conversation storage.

### Quick Deploy

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/linuxdo-ref/ydc-agent&authed=true)

### Manual Deploy

1. Create D1 database in Cloudflare Dashboard
2. Create Worker and paste `cloudflare/worker.js`
3. Add environment variables: `YDC_API_KEYS`, `ACCESS_TOKEN` (optional)
4. Bind D1 database as `YDC_DB`
5. Visit `/setup` to initialize database

### Worker Features

- OpenAI & Anthropic API compatible
- D1 database for conversation history
- Multi API key support (random selection)
- Custom agents via `CUSTOM_AGENTS` env var
- Setup page at `/setup` for configuration

See [cloudflare/README.md](cloudflare/README.md) for detailed instructions.

## License

MIT
