/**
 * Anthropic/Claude Parameter Mapper Module
 * Maps Anthropic API parameters to You.com API parameters
 */

import { 
  getAdvancedVersion, 
  isAdvancedVersion, 
  getDefaultAdvancedVersion,
  adjustWorkflowSteps
} from './advanced-versions.js';

/**
 * Map Anthropic request parameters to You.com parameters
 */
export function mapAnthropicToYouParams(anthropicRequest) {
  const {
    model = 'advanced-3.0-high',
    messages,
    system,
    temperature = 0.7,
    max_tokens = 1024,
    stream = false
  } = anthropicRequest;

  let input = '';
  const conversationHistory = [];
  
  // Handle system prompt
  if (system) {
    input = `[System Instructions]\n${system}\n\n`;
  }
  
  // Process messages
  messages.forEach(msg => {
    if (msg.role === 'user') {
      // Handle content as string or array
      const content = typeof msg.content === 'string' 
        ? msg.content 
        : msg.content.filter(c => c.type === 'text').map(c => c.text).join('\n');
      conversationHistory.push(`User: ${content}`);
    } else if (msg.role === 'assistant') {
      const content = typeof msg.content === 'string'
        ? msg.content
        : msg.content.filter(c => c.type === 'text').map(c => c.text).join('\n');
      conversationHistory.push(`Assistant: ${content}`);
    }
  });
  
  if (conversationHistory.length > 1) {
    input += `[Conversation History]\n${conversationHistory.slice(0, -1).join('\n\n')}\n\n`;
    input += `[Current Message]\n${conversationHistory[conversationHistory.length - 1].replace(/^User: /, '')}`;
  } else if (conversationHistory.length === 1) {
    input += conversationHistory[0].replace(/^User: /, '');
  }

  // Map model to You.com agent
  const modelMapping = {
    'claude-3-opus-20240229': 'advanced-3.0-high',
    'claude-3-sonnet-20240229': 'advanced-3.0-medium',
    'claude-3-haiku-20240307': 'express',
    'claude-3-5-sonnet-20240620': 'advanced-3.0-high',
    'claude-3-5-sonnet-20241022': 'advanced-3.0-high',
    'claude-sonnet-4-20250514': 'advanced-3.0-high',
    'claude-sonnet-4-5-20250929': 'advanced-4.5-research'
  };

  const mappedModel = modelMapping[model] || model;

  // Check if it's an advanced version model
  if (isAdvancedVersion(mappedModel)) {
    const versionConfig = getAdvancedVersion(mappedModel);
    if (versionConfig) {
      const adjustedSteps = adjustWorkflowSteps(versionConfig.max_workflow_steps, temperature);
      
      return {
        agent: 'advanced',
        input,
        stream,
        verbosity: versionConfig.verbosity,
        tools: versionConfig.tools,
        workflow_config: {
          max_workflow_steps: adjustedSteps
        },
        timeout: versionConfig.timeout
      };
    }
  }

  // Default handling
  let agent = mappedModel;
  let verbosity = 'medium';
  let timeout = 300000;

  if (temperature <= 0.3) verbosity = 'medium';
  else if (temperature >= 0.8) verbosity = 'high';

  const max_workflow_steps = Math.min(Math.max(Math.floor(max_tokens / 100), 1), 20);

  const knownAgents = ['express', 'research', 'advanced'];
  if (!knownAgents.includes(agent)) {
    agent = 'advanced';
  }

  if (agent === 'advanced') {
    timeout = 3000000;
  }

  return {
    agent,
    input,
    stream,
    verbosity,
    tools: [
      { type: 'research', search_effort: 'auto', report_verbosity: 'medium' },
      { type: 'compute' }
    ],
    workflow_config: {
      max_workflow_steps
    },
    timeout
  };
}

/**
 * Convert You.com response to Anthropic format
 */
export function convertToAnthropicResponse(youResponse, model, inputTokens = 100) {
  const content = youResponse.output && Array.isArray(youResponse.output)
    ? youResponse.output
        .filter(item => item.type === 'message.answer')
        .map(item => item.text)
        .join('\n\n')
    : 'No response content';

  const outputTokens = Math.floor(content.length / 4);

  return {
    id: `msg_${Date.now()}`,
    type: 'message',
    role: 'assistant',
    content: [
      {
        type: 'text',
        text: content
      }
    ],
    model: model,
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: {
      input_tokens: inputTokens,
      output_tokens: outputTokens
    }
  };
}

/**
 * Create streaming event in Anthropic format
 */
export function createAnthropicStreamEvent(eventType, data) {
  return `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
}

/**
 * Create message_start event
 */
export function createMessageStartEvent(model, conversationId = null) {
  const message = {
    id: `msg_${Date.now()}`,
    type: 'message',
    role: 'assistant',
    content: [],
    model: model,
    stop_reason: null,
    stop_sequence: null,
    usage: {
      input_tokens: 0,
      output_tokens: 0
    }
  };
  
  // Add conversation_id in metadata if provided
  if (conversationId) {
    message.metadata = { conversation_id: conversationId };
  }
  
  return createAnthropicStreamEvent('message_start', {
    type: 'message_start',
    message
  });
}

/**
 * Create content_block_start event
 */
export function createContentBlockStartEvent(index = 0) {
  return createAnthropicStreamEvent('content_block_start', {
    type: 'content_block_start',
    index: index,
    content_block: {
      type: 'text',
      text: ''
    }
  });
}

/**
 * Create content_block_delta event
 */
export function createContentBlockDeltaEvent(text, index = 0) {
  return createAnthropicStreamEvent('content_block_delta', {
    type: 'content_block_delta',
    index: index,
    delta: {
      type: 'text_delta',
      text: text
    }
  });
}

/**
 * Create content_block_stop event
 */
export function createContentBlockStopEvent(index = 0) {
  return createAnthropicStreamEvent('content_block_stop', {
    type: 'content_block_stop',
    index: index
  });
}

/**
 * Create message_delta event
 */
export function createMessageDeltaEvent(outputTokens = 0) {
  return createAnthropicStreamEvent('message_delta', {
    type: 'message_delta',
    delta: {
      stop_reason: 'end_turn',
      stop_sequence: null
    },
    usage: {
      output_tokens: outputTokens
    }
  });
}

/**
 * Create message_stop event
 */
export function createMessageStopEvent() {
  return createAnthropicStreamEvent('message_stop', {
    type: 'message_stop'
  });
}
