/**
 * Request Logger Module
 * Pretty prints request/response info using cli-table3
 */

let Table;
let tableAvailable = false;

// Try to load cli-table3 (optional dependency)
try {
  Table = (await import('cli-table3')).default;
  tableAvailable = true;
} catch (e) {
  // cli-table3 not available, use simple logging
}

// Track last request ID for comparison
let lastRequestId = null;

// Check if no-history mode
const noHistory = process.env.YDC_NO_HISTORY === 'true';

// Helper to create table
function createTable() {
  return new Table({
    colWidths: [4, 12, 60],
    wordWrap: true,
    chars: {
      'top': '─', 'top-mid': '┬', 'top-left': '┌', 'top-right': '┐',
      'bottom': '─', 'bottom-mid': '┴', 'bottom-left': '└', 'bottom-right': '┘',
      'left': '│', 'left-mid': '├', 'mid': '─', 'mid-mid': '┼',
      'right': '│', 'right-mid': '┤', 'middle': '│'
    }
  });
}

// Helper to print history
function printHistory(history, label) {
  if (noHistory || history.length === 0) return;
  
  if (tableAvailable) {
    const table = createTable();
    history.forEach((item, index) => {
      const content = item.content || '';
      const preview = content.length > 80 ? content.substring(0, 80) + '...' : content;
      table.push([index + 1, item.role, preview]);
    });
    console.log(`   ${label}:`);
    console.log(table.toString());
  } else {
    console.log(`   ${label}:`);
    history.forEach((item, index) => {
      const content = item.content || '';
      const preview = content.length > 50 ? content.substring(0, 50) + '...' : content;
      console.log(`   ${index + 1}. [${item.role}] ${preview}`);
    });
  }
}

/**
 * Log request with history
 */
export function logRequest(info) {
  const { 
    conversationId, 
    agent = 'unknown',
    stream = false,
    messageCount = 0,
    inputMessages = []
  } = info;
  
  const convId = conversationId || 'new';
  lastRequestId = convId;
  const streamMode = stream ? 'stream' : 'sync';
  
  if (noHistory) {
    console.log(`📤 ${convId} | ${agent}(${streamMode}) | msgs:${messageCount}`);
  } else {
    console.log(`📤 Request: ${convId}, Messages: ${messageCount}`);
    console.log(`   ${agent}(${streamMode})`);
    printHistory(inputMessages, 'History');
  }
}

/**
 * Log stream complete with history
 */
export function logStreamComplete(info) {
  const {
    conversationId,
    contentLength = 0,
    messageCount = 0,
    agent = 'unknown',
    stream = true,
    inputMessages = []
  } = info;

  const streamMode = stream ? 'stream' : 'sync';
  const convId = conversationId || 'new';
  
  // 如果 Complete ID 和 Request ID 不同，顯示括號
  let idDisplay;
  if (lastRequestId && lastRequestId !== convId) {
    idDisplay = `(${convId})`;
  } else {
    idDisplay = convId;
  }
  
  if (noHistory) {
    console.log(`📥 ${idDisplay} | ${agent}(${streamMode}) | ${contentLength}chars | msgs:${messageCount}`);
  } else {
    console.log(`📥 Complete: ${idDisplay}, ${contentLength} chars, Messages: ${messageCount}`);
    console.log(`   ${agent}(${streamMode})`);
    printHistory(inputMessages, 'History');
    console.log('');
  }
}

/**
 * Log error
 */
export function logError(conversationId, error) {
  const shortId = conversationId ? conversationId.split('-')[0] : 'unknown';
  console.log(`❌ ${shortId} | ${error.message || error}`);
}

/**
 * Log response (for non-streaming)
 */
export function logResponse(info) {
  logStreamComplete(info);
}
