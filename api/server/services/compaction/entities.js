'use strict';

const patterns = [
  // File paths: ~/... or /home/... /etc/... etc.
  /(?:~\/|\/(?:home|etc|opt|app|tmp|var|usr|patches|models))[a-zA-Z0-9_./-]+/g,
  // URLs
  /https?:\/\/[^\s,)>\]]+/g,
  // IP addresses with optional port
  /\b(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}(?::\d+)?)\b/g,
  // UPPER_SNAKE_CASE config keys (require at least one underscore)
  /\b([A-Z][A-Z0-9]*_[A-Z0-9_]{2,})\b/g,
  // CLI flags
  /(?:^|\s)(--[a-z][a-z0-9-]+)/gm,
  // Scoped packages
  /(@[a-z0-9-]+\/[a-z0-9-]+)/g,
  // Standalone large numbers (4+ digits)
  /\b(\d{4,})\b/g,
];

// Patterns whose full match (group 0) is the entity
const fullMatchIndices = new Set([0, 1]);

function extractEntities(text) {
  const entities = new Set();
  for (let i = 0; i < patterns.length; i++) {
    const re = new RegExp(patterns[i].source, patterns[i].flags);
    let m;
    while ((m = re.exec(text)) !== null) {
      let val = fullMatchIndices.has(i) ? m[0] : m[1];
      // Strip trailing punctuation from paths and URLs
      if (i <= 1) {
        val = val.replace(/[.,;:)]+$/, '');
      }
      entities.add(val);
    }
  }
  return entities;
}

module.exports = { extractEntities };
