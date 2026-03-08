'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { exportConversation } = require('./export');

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'export-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const baseMessages = [
  { role: 'system', content: 'You are a helpful assistant.', createdAt: '2026-03-07T14:20:00Z' },
  { role: 'user', content: 'What is the weather?', createdAt: '2026-03-07T14:23:00Z', sender: 'User' },
  { role: 'assistant', content: 'Let me search for that.', createdAt: '2026-03-07T14:24:00Z', sender: 'Assistant' },
  { role: 'tool', content: 'Sunny, 22°C in Montreal.', createdAt: '2026-03-07T14:24:05Z', sender: 'tool', name: 'web_search' },
  { role: 'assistant', content: 'It is sunny and 22°C in Montreal.', createdAt: '2026-03-07T14:24:10Z', sender: 'Assistant' },
];

describe('exportConversation', () => {
  test('writes .md file with correct headers and content', () => {
    const filePath = exportConversation({
      conversationId: 'conv-abc-123',
      title: 'Weather Chat',
      messages: baseMessages,
      exportDir: tmpDir,
    });

    expect(fs.existsSync(filePath)).toBe(true);
    expect(filePath.endsWith('.md')).toBe(true);

    const content = fs.readFileSync(filePath, 'utf8');

    // Header checks
    expect(content).toContain('# Conversation Export — Weather Chat');
    expect(content).toContain('Conversation ID: conv-abc-123');
    expect(content).toContain('Reason: compaction (context threshold exceeded)');
    expect(content).toMatch(/Exported: \d{4}-\d{2}-\d{2}T/);

    // System prompt section
    expect(content).toContain('## System Prompt');
    expect(content).toContain('You are a helpful assistant.');

    // Messages section
    expect(content).toContain('## Messages');
    expect(content).toContain('### User (2026-03-07 14:23)');
    expect(content).toContain('What is the weather?');
    expect(content).toContain('### Assistant (2026-03-07 14:24)');
    expect(content).toContain('Let me search for that.');
    expect(content).toContain('### Tool: web_search (2026-03-07 14:24)');
    expect(content).toContain('Sunny, 22°C in Montreal.');
    expect(content).toContain('It is sunny and 22°C in Montreal.');
  });

  test('truncates tool responses to 2000 chars with [truncated] marker', () => {
    const longContent = 'x'.repeat(5000);
    const messages = [
      { role: 'user', content: 'search', createdAt: '2026-03-07T14:23:00Z', sender: 'User' },
      { role: 'tool', content: longContent, createdAt: '2026-03-07T14:24:00Z', sender: 'tool', name: 'web_search' },
    ];

    const filePath = exportConversation({
      conversationId: 'conv-trunc',
      title: 'Truncation Test',
      messages,
      exportDir: tmpDir,
    });

    const content = fs.readFileSync(filePath, 'utf8');

    // Should contain truncated marker
    expect(content).toContain('[truncated]');

    // Extract the tool message block and verify it has exactly 2000 x's
    const toolSectionMatch = content.match(/### Tool: web_search[^\n]*\n([\s\S]*?)(?=\n###|\n$)/);
    expect(toolSectionMatch).not.toBeNull();
    const toolBody = toolSectionMatch[1];
    const xCount = (toolBody.match(/x/g) || []).length;
    expect(xCount).toBe(2000);
  });

  test('creates export directory recursively if it does not exist', () => {
    const nestedDir = path.join(tmpDir, 'a', 'b', 'c');
    expect(fs.existsSync(nestedDir)).toBe(false);

    const filePath = exportConversation({
      conversationId: 'conv-nested',
      title: 'Nested Dir Test',
      messages: [{ role: 'user', content: 'hello', createdAt: '2026-03-07T14:00:00Z', sender: 'User' }],
      exportDir: nestedDir,
    });

    expect(fs.existsSync(nestedDir)).toBe(true);
    expect(fs.existsSync(filePath)).toBe(true);
    expect(path.dirname(filePath)).toBe(nestedDir);
  });

  test('filename format is {conversationId}-{YYYYMMDD-HHMMSS}.md', () => {
    const filePath = exportConversation({
      conversationId: 'conv-fname',
      title: 'Filename Test',
      messages: [{ role: 'user', content: 'hi', createdAt: '2026-03-07T14:00:00Z', sender: 'User' }],
      exportDir: tmpDir,
    });

    const filename = path.basename(filePath);
    // Should match: conv-fname-YYYYMMDD-HHMMSS.md
    expect(filename).toMatch(/^conv-fname-\d{8}-\d{6}\.md$/);
  });
});
