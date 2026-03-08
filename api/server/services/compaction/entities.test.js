'use strict';

const { extractEntities } = require('./entities');

describe('extractEntities', () => {
  test('extracts ~/ file paths', () => {
    const result = extractEntities('edit ~/models/chat-template.jinja');
    expect(result.has('~/models/chat-template.jinja')).toBe(true);
  });

  test('extracts /home and /etc file paths', () => {
    const result = extractEntities('config at /home/user/.bashrc and /etc/systemd/system/foo.service');
    expect(result.has('/home/user/.bashrc')).toBe(true);
    expect(result.has('/etc/systemd/system/foo.service')).toBe(true);
  });

  test('extracts http and https URLs', () => {
    const result = extractEntities('visit https://ai.mystle.ca and http://example.com/path');
    expect(result.has('https://ai.mystle.ca')).toBe(true);
    expect(result.has('http://example.com/path')).toBe(true);
  });

  test('extracts IP addresses without port', () => {
    const result = extractEntities('server at 192.168.10.138');
    expect(result.has('192.168.10.138')).toBe(true);
  });

  test('extracts IP addresses with port', () => {
    const result = extractEntities('proxy at 192.168.10.138:8085');
    expect(result.has('192.168.10.138:8085')).toBe(true);
  });

  test('extracts UPPER_SNAKE_CASE config keys with underscore', () => {
    const result = extractEntities('set COMPACTION_THRESHOLD=50000 and CONTEXT_MAX_TOKENS');
    expect(result.has('COMPACTION_THRESHOLD')).toBe(true);
    expect(result.has('CONTEXT_MAX_TOKENS')).toBe(true);
  });

  test('does not extract single-word uppercase', () => {
    const result = extractEntities('use ROCm for inference');
    expect(result.has('ROCm')).toBe(false);
  });

  test('extracts CLI flags', () => {
    const result = extractEntities('run with --no-mmap --repeat-penalty 1.05');
    expect(result.has('--no-mmap')).toBe(true);
    expect(result.has('--repeat-penalty')).toBe(true);
  });

  test('extracts scoped packages', () => {
    const result = extractEntities('install @librechat/agents and @scope/package');
    expect(result.has('@librechat/agents')).toBe(true);
    expect(result.has('@scope/package')).toBe(true);
  });

  test('extracts large numbers (4+ digits) but not small', () => {
    const result = extractEntities('port 8080 and value 50000 but not 123 or 42');
    expect(result.has('8080')).toBe(true);
    expect(result.has('50000')).toBe(true);
    expect(result.has('123')).toBe(false);
    expect(result.has('42')).toBe(false);
  });

  test('strips trailing punctuation from paths and URLs', () => {
    const result = extractEntities('see ~/foo/bar. and https://example.com,');
    expect(result.has('~/foo/bar')).toBe(true);
    expect(result.has('https://example.com')).toBe(true);
  });

  test('returns empty set for plain text', () => {
    const result = extractEntities('hello world this is plain text');
    expect(result.size).toBe(0);
  });
});
