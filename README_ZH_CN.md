# ydc-agent

[![npm version](https://img.shields.io/npm/v/ydc-agent.svg)](https://www.npmjs.com/package/ydc-agent)
[![npm downloads](https://img.shields.io/npm/dm/ydc-agent.svg)](https://www.npmjs.com/package/ydc-agent)

You.com AI 代理的 MCP 服务器，支持 OpenAI 兼容 API。

## MCP 配置

### Claude Desktop / Cursor / Windsurf

添加到 MCP 配置文件：

**macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`  
**Windows**: `%APPDATA%\Claude\claude_desktop_config.json`  
**Cursor/Windsurf**: `.cursor/mcp.json` 或 `.windsurf/mcp.json`

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

### 多 API Key 配置

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

Key 模式：`round-robin`（默认）、`sequential`、`random`

## 可用 MCP 工具

| 工具 | 说明 |
|------|------|
| `you_cached_info` | 网页与新闻搜索（缓存数据，限于 2024 年） |
| `you_express` | 快速 AI 回答（缓存数据，限于 2024 年） |
| `you_advanced` | 复杂推理（含计算/研究工具） |
| `you_agent` | 自定义 AI 代理（智能提示增强） |
| `you_chat` | OpenAI 兼容聊天（含对话历史） |
| `you_conversation_list` | 列出对话 |
| `you_conversation_get` | 获取对话历史 |
| `you_conversation_delete` | 删除对话 |
| `you_key_status` | API Key 使用统计 |
| `openai_server_control` | 启动/停止 OpenAI 兼容 HTTP 服务器 |

### 内置 AI 引导功能

工具描述中包含对 AI 调用方的引导：

| 工具 | 内置功能 |
|------|----------|
| `you_cached_info` | 引导 AI 使用 `call_count=5+` 获取多元搜索结果（缓存数据 ≤2024） |
| `you_express` | 引导 AI 使用 `call_count=5+` 获取多元意见（缓存数据 ≤2024） |
| `you_advanced` | **AI 能力规则**：如果调用方是 GPT-3.5+，结果仅作为参考资料 - 应使用 `call_count=5+` 收集多元观点 |
| `you_agent` | **累错追踪**：自动追踪失败次数，超过阈值（默认 3 次）后建议切换到 `you_advanced` |

## 模型 / Agent 类型

| 模型 | 说明 |
|------|------|
| `express` | 快速响应 |
| `research` | 深度分析 |
| `advanced-3.0-high` | 计算工具（默认） |
| `advanced-4.5-high-research` | 完整工具（计算 + 研究） |
| `<custom-agent-id>` | 任意自定义 You.com agent ID |

### 自定义 Agent ID

可使用任意 You.com 自定义 agent ID 作为 model 名称：

```bash
curl -X POST http://localhost:3002/v1/chat/completions \
  -H "Authorization: Bearer token" \
  -H "Content-Type: application/json" \
  -d '{"model":"your-custom-agent-uuid","messages":[{"role":"user","content":"你好"}]}'
```

## OpenAI 兼容服务器

通过 npx 启动：

```bash
# 单个 API key
npx ydc-agent --openai --api-key YOUR_API_KEY

# 多个 API keys（轮换）
npx ydc-agent --openai --api-keys KEY1,KEY2,KEY3

# 自定义 port 和 key 模式
npx ydc-agent --openai --api-keys KEY1,KEY2 --port 3003 --key-mode random

# 带 access token 验证
npx ydc-agent --openai --api-key YOUR_API_KEY --access-token SECRET

# 带自定义 agents（name:id 格式）
npx ydc-agent --openai --api-key YOUR_API_KEY --agent mybot:uuid-here --agent another:uuid2
```

或通过 MCP 工具 `openai_server_control`。

### API 端点

- `POST /v1/chat/completions` - 聊天完成
- `GET /v1/models` - 列出模型
- `GET /health` - 健康检查

### 使用示例

```bash
curl -X POST http://localhost:3002/v1/chat/completions \
  -H "Authorization: Bearer token" \
  -H "Content-Type: application/json" \
  -d '{"model":"express","messages":[{"role":"user","content":"你好"}]}'
```

## 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `YDC_API_KEY` | You.com API 密钥 | 必填 |
| `YDC_API_KEYS` | 多个密钥（逗号分隔） | - |
| `YDC_KEY_MODE` | round-robin / sequential / random | round-robin |
| `YDC_OPENAI_PORT` | HTTP 服务器端口 | 3002 |
| `YDC_CONVERSATION_STORE` | sqlite / memory | sqlite |
| `YDC_OPENAI_ACCESS_TOKENS` | 允许的 token（逗号分隔） | - |
| `YDC_CUSTOM_AGENTS` | 自定义 agents（name:id,name2:id2） | - |
| `YDC_AGENT_FAILURE_THRESHOLD` | you_agent 失败阈值（超过后停用） | 3 |

## PM2 部署

使用 PM2 进行生产环境部署：

```bash
# 使用 ecosystem 配置
pm2 start ecosystem.config.cjs

# 或直接命令（Windows）
pm2 start "cmd /c npx ydc-agent --openai --api-key YOUR_KEY" --name ydc
```

## Cloudflare Worker 部署

部署为无服务器 Cloudflare Worker，使用 D1 数据库存储对话历史。

### 快速部署

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/linuxdo-ref/ydc-agent&authed=true)

### 手动部署

1. 在 Cloudflare Dashboard 创建 D1 数据库
2. 创建 Worker 并粘贴 `cloudflare/worker.js`
3. 添加环境变量：`YDC_API_KEYS`、`ACCESS_TOKEN`（可选）
4. 绑定 D1 数据库为 `YDC_DB`
5. 访问 `/setup` 初始化数据库

### Worker 功能

- OpenAI 与 Anthropic API 兼容
- D1 数据库存储对话历史
- 多 API Key 支持（随机选择）
- 自定义 agents（通过 `CUSTOM_AGENTS` 环境变量）
- 设置页面 `/setup` 进行配置

详细说明请参阅 [cloudflare/README.md](cloudflare/README.md)。

## 许可证

MIT
