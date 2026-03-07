import { Tools } from 'librechat-data-provider';

/** Builds the web search tool context with date-only (no ISO timestamp that busts KV cache). */
export function buildWebSearchContext(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const dateOnly = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  return `# \`${Tools.web_search}\`:
Current Date: ${dateOnly}`.trim();
}
