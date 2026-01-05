/**
 * OpenAI Parameter Mapper Module
 * Maps OpenAI API parameters to You.com API parameters
 */

import { 
  getAdvancedVersion, 
  isAdvancedVersion, 
  getDefaultAdvancedVersion,
  adjustWorkflowSteps
} from './advanced-versions.js';

// Parse custom agents from env
function getCustomAgents() {
  const raw = process.env.YDC_CUSTOM_AGENTS || '';
  if (!raw) return new Map();
  
  const map = new Map();
  raw.split(',').forEach(entry => {
    const trimmed = entry.trim();
    if (!trimmed) return;
    
    const colonIndex = trimmed.indexOf(':');
    if (colonIndex > 0) {
      map.set(trimmed.substring(0, colonIndex), trimmed.substring(colonIndex + 1));
    } else {
      map.set(trimmed, trimmed);
    }
  });
  return map;
}

/**
 * Map OpenAI request parameters to You.com parameters
 */
export function mapOpenAIToYouParams(openaiRequest) {
  const {
    model = 'advanced-3.0-high',
    messages,
    temperature = 0.7,
    max_tokens = 1000,
    stream = false,
    tools = []
  } = openaiRequest;

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

  // Check if it's an advanced version model
  if (isAdvancedVersion(model)) {
    const versionConfig = getAdvancedVersion(model);
    if (versionConfig) {
      const adjustedSteps = adjustWorkflowSteps(versionConfig.max_workflow_steps, temperature);
      
      return {
        agent: 'advanced',
        input,
        stream,
        verbosity: versionConfig.verbosity,
        tools: tools.length > 0 ? tools : versionConfig.tools,
        workflow_config: {
          max_workflow_steps: adjustedSteps
        },
        timeout: versionConfig.timeout
      };
    }
  }

  // Handle legacy models (express, research, advanced)
  let agent = model;
  let verbosity = 'medium';
  let defaultTools = tools;
  let timeout = 300000;

  if (model === 'advanced') {
    const defaultVersion = getDefaultAdvancedVersion(temperature);
    const versionConfig = getAdvancedVersion(defaultVersion);
    if (versionConfig) {
      const adjustedSteps = adjustWorkflowSteps(versionConfig.max_workflow_steps, temperature);
      return {
        agent: 'advanced',
        input,
        stream,
        verbosity: versionConfig.verbosity,
        tools: tools.length > 0 ? tools : versionConfig.tools,
        workflow_config: {
          max_workflow_steps: adjustedSteps
        },
        timeout: versionConfig.timeout
      };
    }
  }

  if (temperature <= 0.3) verbosity = 'medium';
  else if (temperature >= 0.8) verbosity = 'high';

  const max_workflow_steps = Math.min(Math.max(Math.floor(max_tokens / 100), 1), 20);

  // Check if model is a known legacy type
  const knownAgents = ['express', 'research', 'advanced'];
  
  // Check custom agents mapping
  const customAgents = getCustomAgents();
  if (customAgents.has(model)) {
    return {
      agent: customAgents.get(model),
      input,
      stream,
      timeout: 300000
    };
  }
  
  if (!knownAgents.includes(agent)) {
    // Treat unknown model as custom agent ID
    return {
      agent: model,
      input,
      stream,
      timeout: 300000
    };
  }

  if (agent === 'advanced') {
    timeout = 3000000;
    if (tools.length === 0) {
      defaultTools = [
        { type: 'research', search_effort: 'auto', report_verbosity: 'medium' },
        { type: 'compute' }
      ];
    }
  }

  return {
    agent,
    input,
    stream,
    verbosity,
    tools: defaultTools,
    workflow_config: {
      max_workflow_steps
    },
    timeout
  };
}

/**
 * Convert You.com response to OpenAI format
 */
export function convertToOpenAIResponse(youResponse, model) {
  const content = youResponse.output && Array.isArray(youResponse.output)
    ? youResponse.output
        .filter(item => item.type === 'message.answer')
        .map(item => item.text)
        .join('\n\n')
    : 'No response content';

  return {
    id: `chatcmpl-${Date.now()}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: `you-${model}`,
    choices: [{
      index: 0,
      message: {
        role: 'assistant',
        content: content
      },
      finish_reason: 'stop'
    }],
    usage: {
      prompt_tokens: Math.floor(Math.random() * 100) + 50,
      completion_tokens: Math.floor(content.length / 4),
      total_tokens: Math.floor(Math.random() * 100) + 50 + Math.floor(content.length / 4)
    }
  };
}

/**
 * Create streaming chunk in OpenAI format
 */
export function createStreamChunk(model, content, finishReason = null) {
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
