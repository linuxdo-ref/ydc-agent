# ydc-agent

[![npm version](https://img.shields.io/npm/v/ydc-agent.svg)](https://www.npmjs.com/package/ydc-agent)
[![npm downloads](https://img.shields.io/npm/dm/ydc-agent.svg)](https://www.npmjs.com/package/ydc-agent)

You.com AI 代理的 MCP 伺服器，支援 OpenAI 相容 API。

## MCP 設定

### Claude Desktop / Cursor / Windsurf

加入 MCP 設定檔：

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

### 多 API Key 設定

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

Key 模式：`round-robin`（預設）、`sequential`、`random`

## 可用 MCP 工具

| 工具 | 說明 |
|------|------|
| `you_cached_info` | 網頁與新聞搜尋（快取資料，限於 2024 年） |
| `you_express` | 快速 AI 回答（快取資料，限於 2024 年） |
| `you_advanced` | 複雜推理（含計算/研究工具） |
| `you_agent` | 自訂 AI 代理（智慧提示增強） |
| `you_chat` | OpenAI 相容聊天（含對話歷史） |
| `you_conversation_list` | 列出對話 |
| `you_conversation_get` | 取得對話歷史 |
| `you_conversation_delete` | 刪除對話 |
| `you_key_status` | API Key 使用統計 |
| `openai_server_control` | 啟動/停止 OpenAI 相容 HTTP 伺服器 |

### 內建 AI 引導功能

工具描述中包含對 AI 調用方的引導：

| 工具 | 內建功能 |
|------|----------|
| `you_cached_info` | 引導 AI 使用 `call_count=5+` 獲取多元搜尋結果（快取資料 ≤2024） |
| `you_express` | 引導 AI 使用 `call_count=5+` 獲取多元意見（快取資料 ≤2024） |
| `you_advanced` | **AI 能力規則**：如果調用方是 GPT-3.5+，結果僅作為參考資料 - 應使用 `call_count=5+` 收集多元觀點 |
| `you_agent` | **累錯追蹤**：自動追蹤失敗次數，超過閾值（預設 3 次）後建議切換到 `you_advanced` |

## 模型 / Agent 類型

| 模型 | 說明 |
|------|------|
| `express` | 快速回應 |
| `research` | 深度分析 |
| `advanced-3.0-high` | 計算工具（預設） |
| `advanced-4.5-high-research` | 完整工具（計算 + 研究） |
| `<custom-agent-id>` | 任意自定義 You.com agent ID |

### 自定義 Agent ID

可使用任意 You.com 自定義 agent ID 作為 model 名稱：

```bash
curl -X POST http://localhost:3002/v1/chat/completions \
  -H "Authorization: Bearer token" \
  -H "Content-Type: application/json" \
  -d '{"model":"your-custom-agent-uuid","messages":[{"role":"user","content":"你好"}]}'
```

## OpenAI 相容伺服器

透過 npx 啟動：

```bash
# 單個 API key
npx ydc-agent --openai --api-key YOUR_API_KEY

# 多個 API keys（輪換）
npx ydc-agent --openai --api-keys KEY1,KEY2,KEY3

# 自訂 port 和 key 模式
npx ydc-agent --openai --api-keys KEY1,KEY2 --port 3003 --key-mode random

# 帶 access token 驗證
npx ydc-agent --openai --api-key YOUR_API_KEY --access-token SECRET

# 帶自定義 agents（name:id 格式）
npx ydc-agent --openai --api-key YOUR_API_KEY --agent mybot:uuid-here --agent another:uuid2
```

或透過 MCP 工具 `openai_server_control`。

### API 端點

- `POST /v1/chat/completions` - 聊天完成
- `GET /v1/models` - 列出模型
- `GET /health` - 健康檢查

### 使用範例

```bash
curl -X POST http://localhost:3002/v1/chat/completions \
  -H "Authorization: Bearer token" \
  -H "Content-Type: application/json" \
  -d '{"model":"express","messages":[{"role":"user","content":"你好"}]}'
```

## 環境變數

| 變數 | 說明 | 預設值 |
|------|------|--------|
| `YDC_API_KEY` | You.com API 金鑰 | 必填 |
| `YDC_API_KEYS` | 多個金鑰（逗號分隔） | - |
| `YDC_KEY_MODE` | round-robin / sequential / random | round-robin |
| `YDC_OPENAI_PORT` | HTTP 伺服器埠 | 3002 |
| `YDC_CONVERSATION_STORE` | sqlite / memory | sqlite |
| `YDC_OPENAI_ACCESS_TOKENS` | 允許的 token（逗號分隔） | - |
| `YDC_CUSTOM_AGENTS` | 自定義 agents（name:id,name2:id2） | - |
| `YDC_AGENT_FAILURE_THRESHOLD` | you_agent 失敗閾值（超過後停用） | 3 |

## PM2 部署

使用 PM2 進行生產環境部署：

```bash
# 使用 ecosystem 設定
pm2 start ecosystem.config.cjs

# 或直接命令（Windows）
pm2 start "cmd /c npx ydc-agent --openai --api-key YOUR_KEY" --name ydc
```

## Cloudflare Worker 部署

部署為無伺服器 Cloudflare Worker，使用 D1 資料庫儲存對話歷史。

### 快速部署

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/linuxdo-ref/ydc-agent&authed=true)

### 手動部署

1. 在 Cloudflare Dashboard 建立 D1 資料庫
2. 建立 Worker 並貼上 `cloudflare/worker.js`
3. 加入環境變數：`YDC_API_KEYS`、`ACCESS_TOKEN`（選填）
4. 綁定 D1 資料庫為 `YDC_DB`
5. 訪問 `/setup` 初始化資料庫

### Worker 功能

- OpenAI 與 Anthropic API 相容
- D1 資料庫儲存對話歷史
- 多 API Key 支援（隨機選擇）
- 自定義 agents（透過 `CUSTOM_AGENTS` 環境變數）
- 設定頁面 `/setup` 進行配置

詳細說明請參閱 [cloudflare/README.md](cloudflare/README.md)。

## 授權

MIT
