'use strict';

const fs = require('fs');
const path = require('path');

const TOOL_TRUNCATE_LIMIT = 2000;

/**
 * Format a Date or date-string as "YYYY-MM-DD HH:MM".
 */
function formatTimestamp(dateVal) {
  const d = dateVal instanceof Date ? dateVal : new Date(dateVal);
  if (isNaN(d.getTime())) {
    return 'unknown time';
  }
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

/**
 * Format a Date or date-string as "YYYYMMDD-HHMMSS" for filenames.
 */
function formatFilenameTimestamp(dateVal) {
  const d = dateVal instanceof Date ? dateVal : new Date(dateVal);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

/**
 * Determine the heading label for a message based on role/sender.
 */
function messageHeading(msg) {
  const ts = formatTimestamp(msg.createdAt);
  if (msg.role === 'system') {
    return null; // system messages handled separately
  }
  if (msg.role === 'tool' || msg.sender === 'tool') {
    const toolName = msg.name || msg.sender || 'tool';
    return `### Tool: ${toolName} (${ts})`;
  }
  if (msg.role === 'user') {
    return `### User (${ts})`;
  }
  if (msg.role === 'assistant') {
    return `### Assistant (${ts})`;
  }
  // Fallback: use role name
  const label = msg.role ? msg.role.charAt(0).toUpperCase() + msg.role.slice(1) : 'Unknown';
  return `### ${label} (${ts})`;
}

/**
 * Export a conversation to a Markdown file before destructive compaction.
 *
 * @param {Object} opts
 * @param {string} opts.conversationId
 * @param {string} opts.title - Conversation title
 * @param {Array}  opts.messages - Array of { role, content, createdAt, sender, name? }
 * @param {string} opts.exportDir - Directory to write the export file
 * @returns {string} Absolute path to the written file
 */
function exportConversation({ conversationId, title, messages, exportDir }) {
  // Ensure export directory exists
  fs.mkdirSync(exportDir, { recursive: true });

  const now = new Date();
  const filename = `${conversationId}-${formatFilenameTimestamp(now)}.md`;
  const filePath = path.resolve(exportDir, filename);

  const lines = [];

  // Header
  lines.push(`# Conversation Export — ${title}`);
  lines.push(`Exported: ${now.toISOString()}`);
  lines.push(`Conversation ID: ${conversationId}`);
  lines.push('Reason: compaction (context threshold exceeded)');
  lines.push('');
  lines.push('---');

  // Extract system message(s)
  const systemMessages = messages.filter((m) => m.role === 'system');
  const nonSystemMessages = messages.filter((m) => m.role !== 'system');

  if (systemMessages.length > 0) {
    lines.push('');
    lines.push('## System Prompt');
    for (const sm of systemMessages) {
      lines.push(typeof sm.content === 'string' ? sm.content : JSON.stringify(sm.content));
    }
    lines.push('');
    lines.push('---');
  }

  // Messages section
  lines.push('');
  lines.push('## Messages');

  for (const msg of nonSystemMessages) {
    const heading = messageHeading(msg);
    if (!heading) {
      continue;
    }
    lines.push('');
    lines.push(heading);

    let content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);

    // Truncate tool responses
    if ((msg.role === 'tool' || msg.sender === 'tool') && content.length > TOOL_TRUNCATE_LIMIT) {
      content = content.slice(0, TOOL_TRUNCATE_LIMIT) + '\n[truncated]';
    }

    lines.push(content);
  }

  // Trailing newline
  lines.push('');

  fs.writeFileSync(filePath, lines.join('\n'), 'utf8');

  return filePath;
}

module.exports = { exportConversation };
