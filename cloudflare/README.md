# YDC API Services - Cloudflare Worker

OpenAI-compatible API running on Cloudflare Workers with D1 database for conversation storage.

## Deploy Options

### Option 1: Cloudflare Dashboard

1. Login [Cloudflare Dashboard](https://dash.cloudflare.com)
2. Workers & Pages → Create → Create Worker
3. Pause `worker.js`
4. Settings → Variables → Add:
   - `YDC_API_KEYS` (Secret) 
   - `ACCESS_TOKEN` (Secret, optional)
5. Storage → D1 → Create database → `ydc-conversations`
6. Worker Settings → Bindings → Add D1 binding: `YDC_DB` 
7. Access `https://your-worker.workers.dev/setup` Create datebase

### Option 2: One-Click Deploy

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/linuxdo-ref/ydc-agent&authed=true)

### Option 3: Wrangler CLI

1. Create D1 database:
```bash
wrangler d1 create ydc-conversations
```

2. Update `wrangler.toml` with your database ID

3. Initialize schema:
```bash
wrangler d1 execute ydc-conversations --file=schema.sql
```

4. Set secrets:
```bash
wrangler secret put YDC_API_KEYS
wrangler secret put ACCESS_TOKEN  # optional
```

5. Deploy:
```bash
wrangler deploy
```

## Endpoints

- `POST /v1/chat/completions` - OpenAI-compatible chat
- `POST /v1/messages` - Anthropic-compatible chat
- `GET /v1/models` - List available models
- `GET /v1/conversations` - List conversations
- `DELETE /v1/conversations/:id` - Delete conversation
- `GET /setup` - Database setup page
- `GET /health` - Health check

## Environment Variables

- `YDC_API_KEYS` - You.com API key(s), comma-separated for multiple (required)
- `ACCESS_TOKEN` - Optional access token for authentication
- `CUSTOM_AGENTS` - Custom agents (format: `name:id,name2:id2`)

## Usage

```bash
# OpenAI format
curl https://your-worker.workers.dev/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -d '{
    "model": "express",
    "messages": [{"role": "user", "content": "Hello"}]
  }'

# Anthropic format
curl https://your-worker.workers.dev/v1/messages \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -d '{
    "model": "claude-3-5-sonnet-20241022",
    "messages": [{"role": "user", "content": "Hello"}]
  }'
```
