/**
 * Chat Completions Route
 */

import { Router } from 'express';
import { authenticate } from '../auth-middleware.js';
import { mapOpenAIToYouParams, convertToOpenAIResponse, createStreamChunk } from '../openai-mapper.js';
import { callYouApi } from '../api-client.js';
import { 
  getConversation, 
  addMessageToConversation,
  generateConversationId 
} from '../conversation-store.js';
import { logRequest, logStreamComplete } from '../request-logger.js';

const router = Router();
const API_KEY = process.env.YDC_API_KEY;

router.post('/v1/chat/completions', authenticate, async (req, res) => {
  try {
    // Debug: log raw request
    console.log('📨 Raw request body:', JSON.stringify({
      conversation_id: req.body.conversation_id,
      model: req.body.model,
      messages_count: req.body.messages?.length,
      messages: req.body.messages?.map(m => ({ role: m.role, content: m.content?.substring(0, 50) }))
    }, null, 2));
    
    if (!API_KEY) {
      return res.status(500).json({
        error: {
          message: 'YDC_API_KEY not configured on server',
          type: 'server_error',
          code: 'missing_api_key'
        }
      });
    }

    const { conversation_id, messages } = req.body;
    let conversationId = conversation_id;
    let fullMessages = messages || [];
    
    if (conversationId) {
      const existingConv = getConversation(conversationId);
      if (existingConv && existingConv.messages.length > 0) {
        const storedMessages = existingConv.messages.map(m => ({ role: m.role, content: m.content }));
        const newUserMessages = fullMessages.filter(m => m.role === 'user');
        const systemMsg = fullMessages.find(m => m.role === 'system') || storedMessages.find(m => m.role === 'system');
        
        fullMessages = systemMsg ? [systemMsg] : [];
        fullMessages.push(...storedMessages.filter(m => m.role !== 'system'));
        
        const lastNewUserMsg = newUserMessages[newUserMessages.length - 1];
        if (lastNewUserMsg) {
          const alreadyExists = fullMessages.some(m => m.role === 'user' && m.content === lastNewUserMsg.content);
          if (!alreadyExists) {
            fullMessages.push(lastNewUserMsg);
          }
        }
      }
    } else {
      conversationId = generateConversationId();
    }
    
    const lastUserMsg = fullMessages.filter(m => m.role === 'user').pop();
    if (lastUserMsg) {
      addMessageToConversation(conversationId, 'user', lastUserMsg.content);
    }
    
    const systemMsg = fullMessages.find(m => m.role === 'system');
    if (systemMsg) {
      const conv = getConversation(conversationId);
      if (conv && !conv.messages.some(m => m.role === 'system')) {
        conv.messages.unshift({ role: 'system', content: systemMsg.content, timestamp: Date.now() });
      }
    }

    const youParams = mapOpenAIToYouParams({ ...req.body, messages: fullMessages });
    
    // Get current user input for logging
    const currentUserMsg = fullMessages.filter(m => m.role === 'user').pop();
    const currentInput = currentUserMsg?.content || '';
    
    logRequest({
      endpoint: '/v1/chat/completions (OpenAI)',
      agent: youParams.agent,
      model: req.body.model,
      stream: req.body.stream || false,
      conversationId,
      messageCount: fullMessages.length,
      input: currentInput,
      inputMessages: fullMessages
    });

    const timeoutMs = youParams.timeout || (youParams.agent === 'advanced' ? 3000000 : 300000);

    if (req.body.stream) {
      const response = await callYouApi(API_KEY, { ...youParams, stream: true }, { timeout: timeoutMs });
      await handleStreamingResponse(req, res, response, youParams, conversationId, fullMessages);
    } else {
      const response = await callYouApi(API_KEY, youParams, { timeout: timeoutMs });
      await handleNonStreamingResponse(req, res, response, conversationId, fullMessages);
    }

  } catch (error) {
    console.error('❌ Server error:', error);
    
    if (error.name === 'AbortError') {
      return res.status(408).json({
        error: {
          message: 'Request timeout - Advanced agent responses may require extended processing time',
          type: 'timeout_error',
          code: 'request_timeout'
        }
      });
    }
    
    res.status(500).json({
      error: {
        message: error.message,
        type: 'server_error',
        code: 'internal_error'
      }
    });
  }
});

async function handleStreamingResponse(req, res, response, youParams, conversationId, inputMessages = []) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (!response.body) {
    res.write(`data: {"error": "No response body"}\n\n`);
    res.end();
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let fullContent = '';
  const model = req.body.model || 'advanced';
  const messageCount = req.body.messages?.length || 0;
  const STREAM_TIMEOUT = youParams.timeout || (youParams.agent === 'advanced' ? 3000000 : 300000);

  try {
    let streamTimeout = setTimeout(() => {
      const chunk = createStreamChunk(model, `\n\n[Response timeout]`, 'length');
      res.write(`data: ${JSON.stringify(chunk)}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
    }, STREAM_TIMEOUT);

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        clearTimeout(streamTimeout);
        break;
      }

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
              
              clearTimeout(streamTimeout);
              streamTimeout = setTimeout(() => {
                const chunk = createStreamChunk(model, `\n\n[Response timeout]`, 'length');
                res.write(`data: ${JSON.stringify(chunk)}\n\n`);
                res.write('data: [DONE]\n\n');
                res.end();
              }, STREAM_TIMEOUT);

              fullContent += data.response.delta;
              const chunk = createStreamChunk(model, data.response.delta);
              res.write(`data: ${JSON.stringify(chunk)}\n\n`);
            }
          } catch (e) {
            console.error('❌ Error parsing streaming data:', e);
          }
        }
      }
    }
    
    clearTimeout(streamTimeout);
    
    // Store assistant response
    if (conversationId && fullContent) {
      addMessageToConversation(conversationId, 'assistant', fullContent);
    }
    
    // Log completion
    logStreamComplete({
      conversationId,
      contentLength: fullContent.length,
      messageCount: messageCount + 1,
      agent: youParams.agent,
      stream: true,
      responsePreview: fullContent,
      inputMessages: inputMessages
    });
    
  } catch (streamError) {
    console.error('❌ Streaming error:', streamError);
    res.write(`data: {"error": "Streaming error: ${streamError.message}"}\n\n`);
  } finally {
    const finalChunk = createStreamChunk(model, null, 'stop');
    res.write(`data: ${JSON.stringify(finalChunk)}\n\n`);
    res.write('data: [DONE]\n\n');
    res.end();
  }
}

async function handleNonStreamingResponse(req, res, response, conversationId, inputMessages = []) {
  const data = await response.json();
  console.log('📥 You.com response:', JSON.stringify(data, null, 2));
  
  const openaiResponse = convertToOpenAIResponse(data, req.body.model || 'advanced');
  
  const assistantContent = openaiResponse.choices?.[0]?.message?.content;
  if (assistantContent && conversationId) {
    addMessageToConversation(conversationId, 'assistant', assistantContent);
  }
  
  // Log completion
  logStreamComplete({
    conversationId,
    contentLength: assistantContent?.length || 0,
    messageCount: inputMessages.length + 1,
    agent: req.body.model || 'advanced',
    stream: false,
    inputMessages: inputMessages
  });
  
  openaiResponse.conversation_id = conversationId;
  res.json(openaiResponse);
}

export default router;
