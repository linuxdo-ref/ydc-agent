/**
 * You.com API Client Module
 * Shared API calling logic for MCP and OpenAI servers
 */

const API_BASE = 'https://api.you.com/v1/agents/runs';

// Agent type configurations
export const AGENT_TYPES = {
  'express': { agent: 'express', description: 'Fast AI answers with web search (~2s, GPT-3 level)' },
  'research': { agent: 'research', description: 'In-depth research and analysis' },
  'advanced': { agent: 'advanced', description: 'Complex reasoning without tools (~10s, GPT-3.5 level)', tools: [] },
  'advanced-3.0-high': { agent: 'advanced', verbosity: 'high', max_workflow_steps: 15, tools: [] },
  'advanced-3.0-medium': { agent: 'advanced', verbosity: 'medium', max_workflow_steps: 10, tools: [] },
  'advanced-4.0-high': { agent: 'advanced', verbosity: 'high', max_workflow_steps: 20, tools: [{ type: 'compute' }] },
  'advanced-4.5-research': { 
    agent: 'advanced', 
    verbosity: 'high', 
    max_workflow_steps: 20, 
    tools: [{ type: 'research', search_effort: 'high', report_verbosity: 'high' }, { type: 'compute' }] 
  }
};

/**
 * Call You.com API
 */
export async function callYouApi(apiKey, requestBody, options = {}) {
  const { timeout = 300000 } = options;
  
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(API_BASE, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API error: ${response.status} ${errorText}`);
    }

    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
}

/**
 * Extract text from You.com response
 */
export function extractText(data) {
  if (data.output && Array.isArray(data.output)) {
    return data.output
      .filter(item => item.type === 'message.answer')
      .map(item => item.text)
      .join('\n\n');
  }
  return JSON.stringify(data, null, 2);
}

/**
 * Build conversation input from messages
 */
export function buildConversationInput(messages) {
  let input = '';
  let systemPrompt = '';
  const conversationHistory = [];
  
  messages.forEach(msg => {
    if (msg.role === 'system') {
      systemPrompt = msg.content;
    } else if (msg.role === 'user') {
      conversationHistory.push(`User: ${msg.content}`);
    } else if (msg.role === 'assistant') {
      conversationHistory.push(`Assistant: ${msg.content}`);
    }
  });
  
  if (systemPrompt) {
    input = `[System Instructions]\n${systemPrompt}\n\n`;
  }
  
  if (conversationHistory.length > 1) {
    input += `[Conversation History]\n${conversationHistory.slice(0, -1).join('\n\n')}\n\n`;
    input += `[Current Message]\n${conversationHistory[conversationHistory.length - 1].replace(/^User: /, '')}`;
  } else if (conversationHistory.length === 1) {
    input += conversationHistory[0].replace(/^User: /, '');
  }

  return input;
}

/**
 * Build request body for agent call
 */
export function buildAgentRequest(agentType, input, options = {}) {
  const { tools, verbosity, max_workflow_steps, stream = false } = options;
  const agentConfig = AGENT_TYPES[agentType] || AGENT_TYPES['advanced-3.0-high'];
  const isExpressAgent = agentType === 'express' || agentConfig.agent === 'express';

  if (isExpressAgent) {
    return {
      agent: 'express',
      input,
      stream,
    };
  }

  // Use tools from options > agentConfig > empty array (no default tools)
  const finalTools = tools !== undefined ? tools : (agentConfig.tools !== undefined ? agentConfig.tools : []);

  const request = {
    agent: agentConfig.agent || 'advanced',
    input,
    stream,
    verbosity: verbosity || agentConfig.verbosity || 'high',
    workflow_config: {
      max_workflow_steps: max_workflow_steps || agentConfig.max_workflow_steps || 15
    },
  };

  // Only add tools if not empty
  if (finalTools.length > 0) {
    request.tools = finalTools;
  }

  return request;
}

export { API_BASE };
