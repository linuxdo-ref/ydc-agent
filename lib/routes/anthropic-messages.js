/**
 * Anthropic Messages Route
 * Handles /v1/messages endpoint (Anthropic/Claude API compatible)
 */

import { Router } from 'express';
import { callYouApi } from '../api-client.js';
import { 
  mapAnthropicToYouParams, 
  convertToAnthropicResponse,
  createMessageStartEvent,
  createContentBlockStartEvent,
  createContentBlockDeltaEvent,
  createContentBlockStopEvent,
  createMessageDeltaEvent,
  createMessageStopEvent
} from '../anthropic-mapper.js';
import {
  getConversation,
  createConversation,
  addMessageToConversation,
  generateConversationId
} from '../conversation-store.js';
import { logRequest, logStreamComplete, logResponse } from '../request-logger.js';

const router = Router();

// Get API key with rotation support
function getApiKey() {
  const keys = (process.env.YDC_API_KEYS || process.env.YDC_API_KEY || '').split(',').filter(k => k.trim());
  if (keys.length === 0) throw new Error('No API key configured');
  return keys[Math.floor(Math.random() * keys.length)].trim();
}

// Anthropic Messages endpoint
router.post('/v1/messages', async (req, res) => {
  try {
    const { 
      model = 'claude-3-5-sonnet-20241022',
      messages,
      system,
      max_tokens = 1024,
      temperature = 0.7,
      stream = false,
      metadata
    } = req.body;

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({
        type: 'error',
        error: {
          type: 'invalid_request_error',
          message: 'messages is required and must be a non-empty array'
        }
      });
    }

    const apiKey = getApiKey();
    
    // Handle conversation persistence via metadata or generate new one
    let conversationId = metadata?.conversation_id || generateConversationId();
    const existingConv = getConversation(conversationId);
    if (!existingConv) {
      createConversation(conversationId);
    }

    // Map to You.com parameters
    const youParams = mapAnthropicToYouParams({
      model,
      messages,
      system,
      temperature,
      max_tokens,
      stream
    });

    // Get current user input for logging
    const lastUserMsg = messages.filter(m => m.role === 'user').pop();
    const currentInput = typeof lastUserMsg?.content === 'string' 
      ? lastUserMsg.content 
      : lastUserMsg?.content?.filter(c => c.type === 'text').map(c => c.text).join('\n') || '';

    // Build full messages for logging (including system prompt)
    const fullMessages = [];
    if (system) {
      fullMessages.push({ role: 'system', content: system });
    }
    messages.forEach(m => {
      const content = typeof m.content === 'string' 
        ? m.content 
        : m.content?.filter(c => c.type === 'text').map(c => c.text).join('\n') || '';
      fullMessages.push({ role: m.role, content });
    });

    logRequest({
      endpoint: '/v1/messages (Anthropic)',
      agent: youParams.agent,
      model,
      stream,
      conversationId,
      messageCount: fullMessages.length,
      input: currentInput,
      inputMessages: fullMessages
    });

    // Store user message
    if (conversationId) {
      const lastUserMsg = messages.filter(m => m.role === 'user').pop();
      if (lastUserMsg) {
        const content = typeof lastUserMsg.content === 'string' 
          ? lastUserMsg.content 
          : lastUserMsg.content.filter(c => c.type === 'text').map(c => c.text).join('\n');
        addMessageToConversation(conversationId, 'user', content);
      }
    }

    if (stream) {
      // Streaming response
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      // Send message_start with conversation_id
      res.write(createMessageStartEvent(model, conversationId));
      
      // Send content_block_start
      res.write(createContentBlockStartEvent(0));

      try {
        const response = await callYouApi(apiKey, { ...youParams, stream: true });
        
        let fullContent = '';
        let buffer = '';

        // Use Web Streams API (ReadableStream)
        const reader = response.body.getReader();
        const decoder = new TextDecoder();

        const processStream = async () => {
          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;

              buffer += decoder.decode(value, { stream: true });
              const lines = buffer.split('\n');
              buffer = lines.pop() || '';

              for (const line of lines) {
                if (line.startsWith('data: ')) {
                  const data = line.slice(6);
                  if (data === '[DONE]') continue;
                  
                  try {
                    const parsed = JSON.parse(data);
                    
                    // Handle streaming delta format
                    if (parsed.type === 'response.output_text.delta' && 
                        parsed.response?.type === 'message.answer' && 
                        parsed.response?.delta) {
                      const newText = parsed.response.delta;
                      if (newText) {
                        fullContent += newText;
                        res.write(createContentBlockDeltaEvent(newText, 0));
                      }
                    }
                    
                    // Also handle full output format (non-streaming fallback)
                    if (parsed.output) {
                      for (const item of parsed.output) {
                        if (item.type === 'message.answer' && item.text) {
                          const newText = item.text.slice(fullContent.length);
                          if (newText) {
                            fullContent = item.text;
                            res.write(createContentBlockDeltaEvent(newText, 0));
                          }
                        }
                      }
                    }
                  } catch (e) {
                    // Skip invalid JSON
                  }
                }
              }
            }

            // Store assistant response
            if (conversationId && fullContent) {
              addMessageToConversation(conversationId, 'assistant', fullContent);
            }

            logStreamComplete({
              conversationId,
              contentLength: fullContent.length,
              messageCount: fullMessages.length + 1,
              agent: youParams.agent,
              stream: true,
              responsePreview: fullContent,
              inputMessages: [...fullMessages, { role: 'assistant', content: fullContent }]
            });

            // Send closing events
            res.write(createContentBlockStopEvent(0));
            res.write(createMessageDeltaEvent(Math.floor(fullContent.length / 4)));
            res.write(createMessageStopEvent());
            res.end();
          } catch (error) {
            console.error('Stream processing error:', error);
            res.write(createContentBlockDeltaEvent(`Error: ${error.message}`, 0));
            res.write(createContentBlockStopEvent(0));
            res.write(createMessageDeltaEvent(0));
            res.write(createMessageStopEvent());
            res.end();
          }
        };

        processStream();

      } catch (error) {
        console.error('Streaming error:', error);
        res.write(createContentBlockDeltaEvent(`Error: ${error.message}`, 0));
        res.write(createContentBlockStopEvent(0));
        res.write(createMessageDeltaEvent(0));
        res.write(createMessageStopEvent());
        res.end();
      }

    } else {
      // Non-streaming response
      const response = await callYouApi(apiKey, youParams);
      const data = await response.json();
      
      console.log('📥 You.com response received');
      
      const anthropicResponse = convertToAnthropicResponse(data, model);
      
      // Store assistant response
      const assistantContent = anthropicResponse.content[0]?.text || '';
      if (conversationId && assistantContent) {
        addMessageToConversation(conversationId, 'assistant', assistantContent);
        // Add conversation_id to response
        anthropicResponse.metadata = { conversation_id: conversationId };
      }

      logStreamComplete({
        conversationId,
        contentLength: assistantContent.length,
        messageCount: fullMessages.length + 1,
        agent: youParams.agent,
        stream: false,
        inputMessages: [...fullMessages, { role: 'assistant', content: assistantContent }]
      });

      res.json(anthropicResponse);
    }

  } catch (error) {
    console.error('Anthropic messages error:', error);
    res.status(500).json({
      type: 'error',
      error: {
        type: 'api_error',
        message: error.message
      }
    });
  }
});

export default router;
