# ydc-agent

[![npm version](https://img.shields.io/npm/v/ydc-agent.svg)](https://www.npmjs.com/package/ydc-agent)
[![npm downloads](https://img.shields.io/npm/dm/ydc-agent.svg)](https://www.npmjs.com/package/ydc-agent)

You.com AI エージェント用 MCP サーバー、OpenAI 互換 API 対応。

## MCP 設定

### Claude Desktop / Cursor / Windsurf

MCP 設定ファイルに追加：

**macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`  
**Windows**: `%APPDATA%\Claude\claude_desktop_config.json`  
**Cursor/Windsurf**: `.cursor/mcp.json` または `.windsurf/mcp.json`

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

### 複数 API Key 設定

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

Key モード：`round-robin`（デフォルト）、`sequential`、`random`

## 利用可能な MCP ツール

| ツール | 説明 |
|--------|------|
| `you_cached_info` | ウェブ・ニュース検索（キャッシュデータ、2024年まで） |
| `you_express` | 高速 AI 回答（キャッシュデータ、2024年まで） |
| `you_advanced` | 複雑な推論（計算/リサーチツール付き） |
| `you_agent` | カスタム AI エージェント（インテリジェントプロンプト強化） |
| `you_chat` | OpenAI 互換チャット（会話履歴付き） |
| `you_conversation_list` | 会話一覧 |
| `you_conversation_get` | 会話履歴取得 |
| `you_conversation_delete` | 会話削除 |
| `you_key_status` | API Key 使用統計 |
| `openai_server_control` | OpenAI 互換 HTTP サーバーの起動/停止 |

### 組み込み AI ガイダンス

ツール説明には AI 呼び出し元へのガイダンスが含まれています：

| ツール | 組み込み機能 |
|--------|--------------|
| `you_cached_info` | AI に `call_count=5+` で多様な検索結果を取得するよう誘導（キャッシュデータ ≤2024） |
| `you_express` | AI に `call_count=5+` で多様な意見を取得するよう誘導（キャッシュデータ ≤2024） |
| `you_advanced` | **AI 能力ルール**：呼び出し元が GPT-3.5+ の場合、結果は参考資料のみ - `call_count=5+` で多様な視点を収集すべき |
| `you_agent` | **失敗追跡**：失敗回数を自動追跡、閾値（デフォルト 3 回）超過後に `you_advanced` への切り替えを提案 |

## モデル / Agent タイプ

| モデル | 説明 |
|--------|------|
| `express` | 高速レスポンス |
| `research` | 深い分析 |
| `advanced-3.0-high` | 計算ツール（デフォルト） |
| `advanced-4.5-high-research` | フルツール（計算 + リサーチ） |
| `<custom-agent-id>` | 任意のカスタム You.com agent ID |

### カスタム Agent ID

任意の You.com カスタム agent ID をモデル名として使用可能：

```bash
curl -X POST http://localhost:3002/v1/chat/completions \
  -H "Authorization: Bearer token" \
  -H "Content-Type: application/json" \
  -d '{"model":"your-custom-agent-uuid","messages":[{"role":"user","content":"こんにちは"}]}'
```

## OpenAI 互換サーバー

npx で起動：

```bash
# 単一 API key
npx ydc-agent --openai --api-key YOUR_API_KEY

# 複数 API keys（ローテーション）
npx ydc-agent --openai --api-keys KEY1,KEY2,KEY3

# カスタムポートと key モード
npx ydc-agent --openai --api-keys KEY1,KEY2 --port 3003 --key-mode random

# アクセストークン認証付き
npx ydc-agent --openai --api-key YOUR_API_KEY --access-token SECRET

# カスタム agents 付き（name:id 形式）
npx ydc-agent --openai --api-key YOUR_API_KEY --agent mybot:uuid-here --agent another:uuid2
```

または MCP ツール `openai_server_control` 経由。

### API エンドポイント

- `POST /v1/chat/completions` - チャット完了
- `GET /v1/models` - モデル一覧
- `GET /health` - ヘルスチェック

### 使用例

```bash
curl -X POST http://localhost:3002/v1/chat/completions \
  -H "Authorization: Bearer token" \
  -H "Content-Type: application/json" \
  -d '{"model":"express","messages":[{"role":"user","content":"こんにちは"}]}'
```

## 環境変数

| 変数 | 説明 | デフォルト |
|------|------|------------|
| `YDC_API_KEY` | You.com API キー | 必須 |
| `YDC_API_KEYS` | 複数キー（カンマ区切り） | - |
| `YDC_KEY_MODE` | round-robin / sequential / random | round-robin |
| `YDC_OPENAI_PORT` | HTTP サーバーポート | 3002 |
| `YDC_CONVERSATION_STORE` | sqlite / memory | sqlite |
| `YDC_OPENAI_ACCESS_TOKENS` | 許可トークン（カンマ区切り） | - |
| `YDC_CUSTOM_AGENTS` | カスタム agents（name:id,name2:id2） | - |
| `YDC_AGENT_FAILURE_THRESHOLD` | you_agent 失敗閾値（無効化まで） | 3 |

## PM2 デプロイ

PM2 を使用した本番環境デプロイ：

```bash
# ecosystem 設定を使用
pm2 start ecosystem.config.cjs

# または直接コマンド（Windows）
pm2 start "cmd /c npx ydc-agent --openai --api-key YOUR_KEY" --name ydc
```

## Cloudflare Worker デプロイ

サーバーレス Cloudflare Worker としてデプロイ、D1 データベースで会話履歴を保存。

### クイックデプロイ

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/linuxdo-ref/ydc-agent&authed=true)

### 手動デプロイ

1. Cloudflare Dashboard で D1 データベースを作成
2. Worker を作成し `cloudflare/worker.js` を貼り付け
3. 環境変数を追加：`YDC_API_KEYS`、`ACCESS_TOKEN`（オプション）
4. D1 データベースを `YDC_DB` としてバインド
5. `/setup` にアクセスしてデータベースを初期化

### Worker 機能

- OpenAI と Anthropic API 互換
- D1 データベースで会話履歴を保存
- 複数 API Key 対応（ランダム選択）
- カスタム agents（`CUSTOM_AGENTS` 環境変数経由）
- 設定ページ `/setup` で構成

詳細は [cloudflare/README.md](cloudflare/README.md) を参照。

## ライセンス

MIT
