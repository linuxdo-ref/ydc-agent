/**
 * YDC API Services - Cloudflare Worker
 * OpenAI-compatible API with D1 conversation storage
 */

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    
    // CORS headers
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    // Auth check (setup page uses query string token)
    const authHeader = request.headers.get('Authorization');
    const queryToken = url.searchParams.get('token');
    const isSetupPage = url.pathname === '/setup';
    
    if (env.ACCESS_TOKEN) {
      const validAuth = authHeader === `Bearer ${env.ACCESS_TOKEN}` || queryToken === env.ACCESS_TOKEN;
      if (!validAuth && !isSetupPage) {
        return json({ error: 'Unauthorized' }, 401, corsHeaders);
      }
      // Setup page requires token if ACCESS_TOKEN is set
      if (isSetupPage && !validAuth) {
        return json({ error: 'Unauthorized. Use /setup?token=YOUR_ACCESS_TOKEN' }, 401, corsHeaders);
      }
    }

    try {
      // Routes
      if (isSetupPage) {
        return await handleSetup(request, env);
      }
      if (url.pathname === '/v1/chat/completions' && request.method === 'POST') {
        return await handleChat(request, env, corsHeaders);
      }
      if (url.pathname === '/v1/models' && request.method === 'GET') {
        return await handleModels(env, corsHeaders);
      }
      if (url.pathname === '/v1/conversations' && request.method === 'GET') {
        return await handleListConversations(env, corsHeaders);
      }
      if (url.pathname.startsWith('/v1/conversations/') && request.method === 'DELETE') {
        const id = url.pathname.split('/')[3];
        return await handleDeleteConversation(env, id, corsHeaders);
      }
      // Anthropic endpoint
      if (url.pathname === '/v1/messages' && request.method === 'POST') {
        return await handleAnthropicMessages(request, env, corsHeaders);
      }
      if (url.pathname === '/health') {
        return json({ status: 'ok', store: 'd1' }, 200, corsHeaders);
      }
      
      // Redirect root to setup page
      if (url.pathname === '/') {
        return Response.redirect(url.origin + '/setup', 302);
      }
      
      return json({ error: 'Not found' }, 404, corsHeaders);
    } catch (error) {
      return json({ error: error.message }, 500, corsHeaders);
    }
  }
};


function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers }
  });
}

// Multi-key support
function getApiKey(env) {
  const keys = (env.YDC_API_KEYS || '').split(',').map(k => k.trim()).filter(k => k);
  if (keys.length === 0) throw new Error('No API key configured');
  // Random selection for load balancing
  return keys[Math.floor(Math.random() * keys.length)];
}

// Agent types mapping
const AGENT_TYPES = {
  'express': { agent: 'express' },
  'research': { agent: 'research' },
  'advanced': { agent: 'advanced', verbosity: 'high', max_workflow_steps: 15 },
};

// Parse custom agents from env (format: name:id,name2:id2)
function getCustomAgents(env) {
  const raw = env.CUSTOM_AGENTS || '';
  if (!raw) return {};
  const agents = {};
  raw.split(',').forEach(entry => {
    const [name, id] = entry.trim().split(':');
    if (name && id) agents[name] = id;
    else if (name) agents[name] = name;
  });
  return agents;
}

async function handleModels(env, corsHeaders) {
  const customAgents = getCustomAgents(env);
  const allModels = { ...AGENT_TYPES };
  Object.keys(customAgents).forEach(name => {
    allModels[name] = { agent: customAgents[name] };
  });
  
  const models = Object.keys(allModels).map(id => ({
    id,
    object: 'model',
    created: Date.now(),
    owned_by: 'you.com'
  }));
  return json({ object: 'list', data: models }, 200, corsHeaders);
}

async function handleChat(request, env, corsHeaders) {
  const body = await request.json();
  const { model = 'express', messages, stream = false, conversation_id } = body;
  
  // Validate messages
  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return json({ error: 'messages is required and must be a non-empty array' }, 400, corsHeaders);
  }
  
  // Get or create conversation
  let convId = conversation_id || crypto.randomUUID();
  
  // Build input from messages
  const input = buildInput(messages);
  
  // Get agent config (check custom agents first)
  const customAgents = getCustomAgents(env);
  let agentConfig;
  if (customAgents[model]) {
    agentConfig = { agent: customAgents[model] };
  } else {
    agentConfig = AGENT_TYPES[model] || { agent: model };
  }
  
  // Store user message
  const lastUserMsg = messages.filter(m => m.role === 'user').pop();
  if (lastUserMsg) {
    await storeMessage(env.ydc_db, convId, 'user', lastUserMsg.content);
  }
  
  // Call You.com API
  const youResponse = await callYouApi(getApiKey(env), {
    agent: agentConfig.agent,
    input,
    stream,
    ...(agentConfig.verbosity && { verbosity: agentConfig.verbosity }),
    ...(agentConfig.max_workflow_steps && { 
      workflow_config: { max_workflow_steps: agentConfig.max_workflow_steps }
    })
  });

  if (stream) {
    return handleStreamResponse(youResponse, env, convId, model, corsHeaders);
  } else {
    return handleSyncResponse(youResponse, env, convId, model, corsHeaders);
  }
}


function buildInput(messages) {
  if (!messages || !Array.isArray(messages)) {
    return '';
  }
  
  let input = '';
  let systemPrompt = '';
  const history = [];
  
  messages.forEach(msg => {
    if (msg.role === 'system') {
      systemPrompt = msg.content;
    } else if (msg.role === 'user') {
      history.push(`User: ${msg.content}`);
    } else if (msg.role === 'assistant') {
      history.push(`Assistant: ${msg.content}`);
    }
  });
  
  if (systemPrompt) {
    input = `[System Instructions]\n${systemPrompt}\n\n`;
  }
  
  if (history.length > 1) {
    input += `[Conversation History]\n${history.slice(0, -1).join('\n\n')}\n\n`;
    input += `[Current Message]\n${history[history.length - 1].replace(/^User: /, '')}`;
  } else if (history.length === 1) {
    input += history[0].replace(/^User: /, '');
  }
  
  return input;
}

async function callYouApi(apiKey, params) {
  const response = await fetch('https://api.you.com/v1/agents/runs', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      'Accept': 'application/json',
      'Accept-Encoding': 'gzip, deflate, br',
      'User-Agent': 'node'
    },
    body: JSON.stringify(params)
  });
  return response;
}

async function handleSyncResponse(response, env, convId, model, corsHeaders) {
  // Check if API call failed
  if (!response.ok) {
    let errText;
    try {
      errText = await response.text();
    } catch (e) {
      errText = 'Unable to read error response';
    }
    return json({ 
      error: { 
        message: `You.com API error: ${response.status} ${response.statusText}`,
        details: errText,
        type: 'api_error'
      }
    }, 502, corsHeaders);
  }
  
  const data = await response.json();
  const content = extractContent(data);
  
  // Store assistant response
  await storeMessage(env.ydc_db, convId, 'assistant', content);
  
  return json({
    id: `chatcmpl-${Date.now()}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: `you-${model}`,
    conversation_id: convId,
    choices: [{
      index: 0,
      message: { role: 'assistant', content },
      finish_reason: 'stop'
    }]
  }, 200, corsHeaders);
}


async function handleStreamResponse(response, env, convId, model, corsHeaders) {
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();
  
  const processStream = async () => {
    let fullContent = '';
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              if (data.type === 'response.output_text.delta' && 
                  data.response?.type === 'message.answer' && 
                  data.response?.delta) {
                fullContent += data.response.delta;
                const chunk = createStreamChunk(model, data.response.delta);
                await writer.write(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
              }
            } catch (e) {}
          }
        }
      }
      
      // Store assistant response
      if (fullContent) {
        await storeMessage(env.ydc_db, convId, 'assistant', fullContent);
      }
      
      // Send final chunk
      const finalChunk = createStreamChunk(model, null, 'stop');
      await writer.write(encoder.encode(`data: ${JSON.stringify(finalChunk)}\n\n`));
      await writer.write(encoder.encode('data: [DONE]\n\n'));
    } catch (error) {
      await writer.write(encoder.encode(`data: {"error": "${error.message}"}\n\n`));
    } finally {
      await writer.close();
    }
  };
  
  processStream();
  
  return new Response(readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      ...corsHeaders
    }
  });
}

function createStreamChunk(model, content, finishReason = null) {
  return {
    id: `chatcmpl-${Date.now()}`,
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000),
    model: `you-${model}`,
    choices: [{
      index: 0,
      delta: content ? { content } : {},
      finish_reason: finishReason
    }]
  };
}

function extractContent(data) {
  // Handle output array format
  if (data.output && Array.isArray(data.output)) {
    const answers = data.output
      .filter(item => item.type === 'message.answer')
      .map(item => item.text)
      .join('\n\n');
    if (answers) return answers;
  }
  
  // Handle direct answer format
  if (data.answer) return data.answer;
  
  // Handle message format
  if (data.message) return data.message;
  
  // Handle text format
  if (data.text) return data.text;
  
  // Handle error
  if (data.error) return `Error: ${data.error}`;
  
  // Debug: return raw data if unknown format
  return `No response (raw: ${JSON.stringify(data).substring(0, 200)})`;
}


// D1 Database functions
async function initDatabase(db) {
  if (!db) {
    throw new Error('D1 database not bound. Please add D1 binding "ydc_db" in Worker settings.');
  }
  
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      timestamp INTEGER NOT NULL
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_conversations_updated ON conversations(updated_at)`)
  ]);
}

// Setup page
async function handleSetup(request, env) {
  const url = new URL(request.url);
  
  if (request.method === 'POST') {
    const action = url.searchParams.get('action') || 'init';
    
    if (action === 'init') {
      if (!env.ydc_db) {
        return json({ success: false, error: 'D1 database not bound. Please create a D1 database and add binding "ydc_db" in Worker settings.' }, 400);
      }
      try {
        await initDatabase(env.ydc_db);
        return json({ success: true, message: 'Database initialized!' });
      } catch (error) {
        return json({ success: false, error: error.message }, 500);
      }
    }
    
    if (action === 'test') {
      // Check API key first
      const keys = (env.YDC_API_KEYS || '').split(',').map(k => k.trim()).filter(k => k);
      if (keys.length === 0) {
        return json({ success: false, error: 'No API key configured. Set YDC_API_KEYS in Worker secrets.' }, 400);
      }
      try {
        const apiKey = keys[Math.floor(Math.random() * keys.length)];
        const keyPreview = apiKey.substring(0, 15) + '...' + apiKey.substring(apiKey.length - 5);
        
        const requestBody = { agent: 'express', input: 'test', stream: false };
        const res = await fetch('https://api.you.com/v1/agents/runs', {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json', 
            'Authorization': `Bearer ${apiKey}`,
            'Accept': 'application/json',
            'Accept-Encoding': 'gzip, deflate, br',
            'User-Agent': 'node'
          },
          body: JSON.stringify(requestBody)
        });
        
        const responseText = await res.text();
        
        return json({ 
          success: res.ok, 
          status: res.status,
          statusText: res.statusText,
          keyPreview,
          keyLength: apiKey.length,
          response: responseText.substring(0, 500),
          message: res.ok ? 'API connection successful!' : 'API call failed'
        }, res.ok ? 200 : 400);
      } catch (error) {
        return json({ success: false, error: error.message, stack: error.stack }, 500);
      }
    }
    
    if (action === 'status') {
      const hasApiKey = !!env.YDC_API_KEYS;
      const hasAccessToken = !!env.ACCESS_TOKEN;
      const hasCustomAgents = !!env.CUSTOM_AGENTS;
      const hasD1Binding = !!env.ydc_db;
      let dbConnected = false, convCount = 0, msgCount = 0;
      if (hasD1Binding) {
        try {
          const c = await env.ydc_db.prepare('SELECT COUNT(*) as c FROM conversations').first();
          const m = await env.ydc_db.prepare('SELECT COUNT(*) as c FROM messages').first();
          dbConnected = true; convCount = c?.c || 0; msgCount = m?.c || 0;
        } catch (e) {}
      }
      return json({ success: true, status: { apiKey: hasApiKey, accessToken: hasAccessToken, customAgents: hasCustomAgents, d1Binding: hasD1Binding, database: dbConnected, conversations: convCount, messages: msgCount } });
    }
    
    return json({ success: false, error: 'Unknown action' }, 400);
  }
  
  const workerName = url.hostname.split('.')[0];
  return new Response(getSetupHtml(workerName), { headers: { 'Content-Type': 'text/html' } });
}

function getSetupHtml(workerName) {
  return `<!DOCTYPE html><html><head><title>YDC API Services Setup</title><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>*{box-sizing:border-box}body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:500px;margin:40px auto;padding:15px;background:#f5f5f5;font-size:14px}.card{background:#fff;border-radius:10px;padding:20px;box-shadow:0 2px 8px rgba(0,0,0,.1);margin-bottom:15px}h1{margin:0 0 5px;color:#333;font-size:20px}h2{margin:15px 0 10px;color:#333;font-size:15px}p{color:#666;margin:0 0 12px;font-size:13px}.btn{background:#0070f3;color:#fff;border:none;padding:8px 16px;border-radius:6px;font-size:13px;cursor:pointer;margin:3px 3px 3px 0;text-decoration:none;display:inline-block}.btn:hover{background:#0060df}.btn-secondary{background:#6c757d}.btn-secondary:hover{background:#5a6268}.btn-sm{padding:5px 10px;font-size:12px}.status-box{padding:10px;border-radius:6px;margin:10px 0;font-size:13px}.status-box.success{background:#d4edda;color:#155724}.status-box.error{background:#f8d7da;color:#721c24}.status-box.info{background:#e7f3ff;color:#004085}.check-item{display:flex;align-items:center;padding:6px 0;border-bottom:1px solid #eee;font-size:13px}.check-item:last-child{border-bottom:none}.check-icon{width:20px;margin-right:8px;font-size:14px}.check-label{flex:1}.check-status{font-weight:500;font-size:12px}.check-status.ok{color:#28a745}.check-status.warn{color:#ffc107}.check-status.error{color:#dc3545}code{background:#f0f0f0;padding:1px 4px;border-radius:3px;font-size:12px}a{color:#0070f3}.stats{display:flex;gap:15px;margin:10px 0}.stat{text-align:center;padding:10px;background:#f8f9fa;border-radius:6px;flex:1}.stat-value{font-size:20px;font-weight:700;color:#333}.stat-label{font-size:11px;color:#666;margin-top:3px}#result{display:none}.link-row{display:flex;gap:8px;flex-wrap:wrap}</style></head>
<body><div class="card"><h1>API Services</h1><div id="statusChecks">Loading...</div><div class="stats" id="stats" style="display:none"><div class="stat"><div class="stat-value" id="convCount">-</div><div class="stat-label">Conversations</div></div><div class="stat"><div class="stat-value" id="msgCount">-</div><div class="stat-label">Messages</div></div></div></div>
<div class="card"><h2>Configure</h2><div class="link-row"><a href="https://dash.cloudflare.com/?to=/:account/workers/d1" target="_blank" class="btn btn-secondary btn-sm">1. Create D1 Database</a><a href="https://dash.cloudflare.com/?to=/:account/workers/services/view/${workerName}/production/bindings" target="_blank" class="btn btn-secondary btn-sm">2. Add D1 Binding</a><a href="https://dash.cloudflare.com/?to=/:account/workers/services/view/${workerName}/production/settings/bindings" target="_blank" class="btn btn-secondary btn-sm">3. Add Secrets</a></div><div class="status-box info" style="margin-top:10px"><strong>D1:</strong> binding <code>ydc_db</code><br><strong>Secrets:</strong> <code>YDC_API_KEYS</code>, <code>ACCESS_TOKEN</code>, <code>CUSTOM_AGENTS</code></div><div style="margin-top:12px"><button class="btn" onclick="doAction('init')">Initialize Database</button><button class="btn btn-secondary" onclick="doAction('test')">Test API</button></div><div id="result" class="status-box"></div></div>
<div class="card"><h2>Endpoints</h2><div class="status-box info"><code>POST /v1/chat/completions</code> (OpenAI)<br><code>POST /v1/messages</code> (Anthropic)<br><code>GET /v1/models</code> | <code>GET /health</code></div></div>
<script>const t=new URLSearchParams(location.search).get('token')||'';const q=t?'&token='+t:'';async function loadStatus(){try{const r=await fetch('/setup?action=status'+q,{method:'POST'});const d=await r.json();if(d.success){const s=d.status;document.getElementById('statusChecks').innerHTML=\`<div class="check-item"><span class="check-icon">\${s.apiKey?'✅':'❌'}</span><span class="check-label">API Key</span><span class="check-status \${s.apiKey?'ok':'error'}">\${s.apiKey?'OK':'Not Set'}</span></div><div class="check-item"><span class="check-icon">\${s.accessToken?'✅':'⚠️'}</span><span class="check-label">Access Token</span><span class="check-status \${s.accessToken?'ok':'warn'}">\${s.accessToken?'On':'Off'}</span></div><div class="check-item"><span class="check-icon">\${s.d1Binding?'✅':'❌'}</span><span class="check-label">D1 Binding</span><span class="check-status \${s.d1Binding?'ok':'error'}">\${s.d1Binding?'OK':'Not Bound'}</span></div><div class="check-item"><span class="check-icon">\${s.database?'✅':'⚠️'}</span><span class="check-label">Tables</span><span class="check-status \${s.database?'ok':'warn'}">\${s.database?'OK':'Not Init'}</span></div><div class="check-item"><span class="check-icon">\${s.customAgents?'✅':'➖'}</span><span class="check-label">Custom Agents</span><span class="check-status">\${s.customAgents?'Yes':'No'}</span></div>\`;if(s.database){document.getElementById('stats').style.display='flex';document.getElementById('convCount').textContent=s.conversations;document.getElementById('msgCount').textContent=s.messages}}}catch(e){document.getElementById('statusChecks').innerHTML='<div class="status-box error">Failed to load</div>'}}async function doAction(a){const r=document.getElementById('result');r.style.display='block';r.className='status-box info';r.textContent='Processing...';try{const res=await fetch('/setup?action='+a+q,{method:'POST'});const d=await res.json();r.className='status-box '+(d.success?'success':'error');r.textContent=(d.success?'✅ ':'❌ ')+(d.message||d.error);loadStatus()}catch(e){r.className='status-box error';r.textContent='❌ '+e.message}}loadStatus()</script></body></html>`;
}

async function storeMessage(db, conversationId, role, content) {
  if (!db) return; // Skip if D1 not bound
  
  // Ensure conversation exists
  await db.prepare(`
    INSERT OR IGNORE INTO conversations (id, created_at, updated_at)
    VALUES (?, ?, ?)
  `).bind(conversationId, Date.now(), Date.now()).run();
  
  // Update conversation timestamp
  await db.prepare(`
    UPDATE conversations SET updated_at = ? WHERE id = ?
  `).bind(Date.now(), conversationId).run();
  
  // Insert message
  await db.prepare(`
    INSERT INTO messages (conversation_id, role, content, timestamp)
    VALUES (?, ?, ?, ?)
  `).bind(conversationId, role, content, Date.now()).run();
}

async function handleListConversations(env, corsHeaders) {
  if (!env.ydc_db) {
    return json({ error: 'D1 database not bound' }, 400, corsHeaders);
  }
  
  try {
    const result = await env.ydc_db.prepare(`
      SELECT c.id, c.created_at, c.updated_at,
             (SELECT COUNT(*) FROM messages WHERE conversation_id = c.id) as message_count,
             (SELECT content FROM messages WHERE conversation_id = c.id ORDER BY id DESC LIMIT 1) as preview
      FROM conversations c
      ORDER BY c.updated_at DESC
      LIMIT 100
    `).all();
    
    const conversations = result.results.map(c => ({
      id: c.id,
      message_count: c.message_count,
      created_at: new Date(c.created_at).toISOString(),
      updated_at: new Date(c.updated_at).toISOString(),
      preview: c.preview?.substring(0, 100) || ''
    }));
    
    return json({ total: conversations.length, conversations }, 200, corsHeaders);
  } catch (e) {
    return json({ error: 'Database not initialized', conversations: [] }, 200, corsHeaders);
  }
}

async function handleDeleteConversation(env, id, corsHeaders) {
  if (!env.ydc_db) {
    return json({ error: 'D1 database not bound' }, 400, corsHeaders);
  }
  
  await env.ydc_db.prepare('DELETE FROM messages WHERE conversation_id = ?').bind(id).run();
  await env.ydc_db.prepare('DELETE FROM conversations WHERE id = ?').bind(id).run();
  return json({ success: true, deleted: id }, 200, corsHeaders);
}

// Anthropic Messages endpoint
async function handleAnthropicMessages(request, env, corsHeaders) {
  const body = await request.json();
  const { model = 'claude-3-5-sonnet-20241022', messages, system, stream = false, metadata } = body;
  
  // Map Claude model to You.com agent
  let agent = 'express';
  if (model.includes('opus') || model.includes('sonnet')) agent = 'advanced';
  
  // Get or create conversation
  let convId = metadata?.conversation_id || crypto.randomUUID();
  
  // Build input
  let input = '';
  if (system) input = `[System Instructions]\n${system}\n\n`;
  
  const history = [];
  messages.forEach(msg => {
    const content = typeof msg.content === 'string' 
      ? msg.content 
      : msg.content?.filter(c => c.type === 'text').map(c => c.text).join('\n') || '';
    if (msg.role === 'user') history.push(`User: ${content}`);
    else if (msg.role === 'assistant') history.push(`Assistant: ${content}`);
  });
  
  if (history.length > 1) {
    input += `[Conversation History]\n${history.slice(0, -1).join('\n\n')}\n\n`;
    input += `[Current Message]\n${history[history.length - 1].replace(/^User: /, '')}`;
  } else if (history.length === 1) {
    input += history[0].replace(/^User: /, '');
  }
  
  // Store user message
  const lastUserMsg = messages.filter(m => m.role === 'user').pop();
  if (lastUserMsg) {
    const content = typeof lastUserMsg.content === 'string' 
      ? lastUserMsg.content 
      : lastUserMsg.content?.filter(c => c.type === 'text').map(c => c.text).join('\n') || '';
    await storeMessage(env.ydc_db, convId, 'user', content);
  }
  
  const youResponse = await callYouApi(getApiKey(env), { agent, input, stream });
  
  if (stream) {
    return handleAnthropicStream(youResponse, env, convId, model, corsHeaders);
  } else {
    const data = await youResponse.json();
    const content = extractContent(data);
    await storeMessage(env.ydc_db, convId, 'assistant', content);
    
    return json({
      id: `msg_${Date.now()}`,
      type: 'message',
      role: 'assistant',
      content: [{ type: 'text', text: content }],
      model,
      stop_reason: 'end_turn',
      metadata: { conversation_id: convId }
    }, 200, corsHeaders);
  }
}

async function handleAnthropicStream(response, env, convId, model, corsHeaders) {
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();
  
  const msgId = `msg_${Date.now()}`;
  
  const processStream = async () => {
    let fullContent = '';
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    
    // Send message_start
    await writer.write(encoder.encode(`event: message_start\ndata: ${JSON.stringify({
      type: 'message_start',
      message: { id: msgId, type: 'message', role: 'assistant', content: [], model }
    })}\n\n`));
    
    // Send content_block_start
    await writer.write(encoder.encode(`event: content_block_start\ndata: ${JSON.stringify({
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'text', text: '' }
    })}\n\n`));
    
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              if (data.type === 'response.output_text.delta' && 
                  data.response?.type === 'message.answer' && 
                  data.response?.delta) {
                fullContent += data.response.delta;
                await writer.write(encoder.encode(`event: content_block_delta\ndata: ${JSON.stringify({
                  type: 'content_block_delta',
                  index: 0,
                  delta: { type: 'text_delta', text: data.response.delta }
                })}\n\n`));
              }
            } catch (e) {}
          }
        }
      }
      
      if (fullContent) {
        await storeMessage(env.ydc_db, convId, 'assistant', fullContent);
      }
      
      // Send closing events
      await writer.write(encoder.encode(`event: content_block_stop\ndata: ${JSON.stringify({ type: 'content_block_stop', index: 0 })}\n\n`));
      await writer.write(encoder.encode(`event: message_delta\ndata: ${JSON.stringify({ type: 'message_delta', delta: { stop_reason: 'end_turn' } })}\n\n`));
      await writer.write(encoder.encode(`event: message_stop\ndata: ${JSON.stringify({ type: 'message_stop' })}\n\n`));
    } catch (error) {
      await writer.write(encoder.encode(`event: error\ndata: ${JSON.stringify({ type: 'error', error: { message: error.message } })}\n\n`));
    } finally {
      await writer.close();
    }
  };
  
  processStream();
  
  return new Response(readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      ...corsHeaders
    }
  });
}
