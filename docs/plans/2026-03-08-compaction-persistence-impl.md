# Compaction Persistence — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Port LexRank+MMR compaction from the Python proxy to the LibreChat fork as a persistent MongoDB endpoint that survives session resume.

**Architecture:** New Express route `POST /api/conversations/:conversationId/compact` deletes all messages for a conversation, replaces them with 4 summary messages, and exports full history to `.md` before deletion. Compaction logic is a JS port of ~430 lines from `reasoning-proxy.py`. No proxy involvement.

**Tech Stack:** Node.js (CommonJS), Express, MongoDB via Mongoose, Jest for tests, `uuid` v4 for message IDs.

**Design doc:** `docs/plans/2026-03-08-compaction-persistence-design.md`

---

### Task 1: Entity Extraction Module

Port `_extract_entities()` from Python to JS.

**Files:**
- Create: `api/server/services/compaction/entities.js`
- Test: `api/server/services/compaction/entities.test.js`

**Step 1: Write the test**

```javascript
// api/server/services/compaction/entities.test.js
const { extractEntities } = require('./entities');

describe('extractEntities', () => {
  it('extracts file paths', () => {
    const result = extractEntities('Check ~/models/Qwen3.5 and /etc/systemd/system/llama.service');
    expect(result.has('~/models/Qwen3.5')).toBe(true);
    expect(result.has('/etc/systemd/system/llama.service')).toBe(true);
  });

  it('extracts URLs', () => {
    const result = extractEntities('Visit https://ai.mystle.ca and http://localhost:8080/v1');
    expect(result.has('https://ai.mystle.ca')).toBe(true);
    expect(result.has('http://localhost:8080/v1')).toBe(true);
  });

  it('extracts IP addresses with optional port', () => {
    const result = extractEntities('Connect to 192.168.10.138:8085 or 10.0.0.1');
    expect(result.has('192.168.10.138:8085')).toBe(true);
    expect(result.has('10.0.0.1')).toBe(true);
  });

  it('extracts UPPER_SNAKE_CASE config keys (requires underscore)', () => {
    const result = extractEntities('Set COMPACTION_THRESHOLD and CONTEXT_MAX_TOKENS');
    expect(result.has('COMPACTION_THRESHOLD')).toBe(true);
    expect(result.has('CONTEXT_MAX_TOKENS')).toBe(true);
  });

  it('does not extract single-word uppercase', () => {
    const result = extractEntities('The API returned OK');
    expect(result.has('API')).toBe(false);
    expect(result.has('OK')).toBe(false);
  });

  it('extracts CLI flags', () => {
    const result = extractEntities('Use --no-mmap and --repeat-penalty flags');
    expect(result.has('--no-mmap')).toBe(true);
    expect(result.has('--repeat-penalty')).toBe(true);
  });

  it('extracts scoped packages', () => {
    const result = extractEntities('Install @librechat/agents and @anthropic-ai/sdk');
    expect(result.has('@librechat/agents')).toBe(true);
    expect(result.has('@anthropic-ai/sdk')).toBe(true);
  });

  it('extracts standalone large numbers (4+ digits)', () => {
    const result = extractEntities('Port 8085, threshold 50000, and 3 retries');
    expect(result.has('8085')).toBe(true);
    expect(result.has('50000')).toBe(true);
    expect(result.has('3')).toBeFalsy(); // too short
  });

  it('strips trailing punctuation from paths and URLs', () => {
    const result = extractEntities('See /home/user/file.txt, or https://example.com).');
    expect(result.has('/home/user/file.txt')).toBe(true);
    expect(result.has('https://example.com')).toBe(true);
  });

  it('returns empty set for text with no entities', () => {
    const result = extractEntities('Hello world, this is a simple message.');
    expect(result.size).toBe(0);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /home/mikhailst-laurent/projects/ashwater-ai/librechat-fork && npx jest api/server/services/compaction/entities.test.js --no-cache`
Expected: FAIL — module not found

**Step 3: Write the implementation**

```javascript
// api/server/services/compaction/entities.js
'use strict';

/**
 * Extract structured entities (paths, URLs, IPs, config keys, etc.) from text.
 * Returns a Set of entity strings. Used for coverage verification to ensure
 * the summary doesn't lose critical references.
 *
 * Ported from reasoning-proxy.py _extract_entities() — 7 regex patterns.
 *
 * @param {string} text
 * @returns {Set<string>}
 */
function extractEntities(text) {
  const entities = new Set();

  // File paths: ~/... or /home/... /etc/... etc.
  const pathRe = /(?:~\/|\/(?:home|etc|opt|app|tmp|var|usr|patches|models))[a-zA-Z0-9_./-]+/g;
  for (const m of text.matchAll(pathRe)) {
    entities.add(m[0].replace(/[.,;:)]+$/, ''));
  }

  // URLs
  const urlRe = /https?:\/\/[^\s,)>\]]+/g;
  for (const m of text.matchAll(urlRe)) {
    entities.add(m[0].replace(/[.,;:)]+$/, ''));
  }

  // IP addresses (with optional :port)
  const ipRe = /\b(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}(?::\d+)?)\b/g;
  for (const m of text.matchAll(ipRe)) {
    entities.add(m[1]);
  }

  // UPPER_SNAKE_CASE config keys (require at least one underscore)
  const configRe = /\b([A-Z][A-Z0-9]*_[A-Z0-9_]{2,})\b/g;
  for (const m of text.matchAll(configRe)) {
    entities.add(m[1]);
  }

  // CLI flags (--long-flag)
  const flagRe = /(?:^|\s)(--[a-z][a-z0-9-]+)/g;
  for (const m of text.matchAll(flagRe)) {
    entities.add(m[1]);
  }

  // Scoped package names (@scope/package)
  const pkgRe = /(@[a-z0-9-]+\/[a-z0-9-]+)/g;
  for (const m of text.matchAll(pkgRe)) {
    entities.add(m[1]);
  }

  // Standalone large numbers (4+ digits — ports, thresholds, dimensions)
  const numRe = /\b(\d{4,})\b/g;
  for (const m of text.matchAll(numRe)) {
    entities.add(m[1]);
  }

  return entities;
}

module.exports = { extractEntities };
```

**Step 4: Run test to verify it passes**

Run: `cd /home/mikhailst-laurent/projects/ashwater-ai/librechat-fork && npx jest api/server/services/compaction/entities.test.js --no-cache`
Expected: PASS — all 10 tests

**Step 5: Commit**

```bash
git add api/server/services/compaction/entities.js api/server/services/compaction/entities.test.js
git commit -m "feat: add entity extraction module for compaction (JS port)"
```

---

### Task 2: LexRank+MMR Module

Port `_lexrank_summarize()` from Python to JS: TF-IDF vectors, cosine similarity, power iteration, MMR selection, speaker balance.

**Files:**
- Create: `api/server/services/compaction/lexrank.js`
- Test: `api/server/services/compaction/lexrank.test.js`

**Step 1: Write the test**

```javascript
// api/server/services/compaction/lexrank.test.js
const { lexrankSummarize } = require('./lexrank');

describe('lexrankSummarize', () => {
  const sentences = [
    'The compaction threshold is set to 50000 tokens.',
    'LexRank uses TF-IDF cosine similarity for centrality.',
    'Power iteration runs for 20 rounds with damping 0.85.',
    'MMR selection balances centrality and diversity.',
    'The proxy sits between LibreChat and llama-server.',
    'Speaker balance ensures at least 25% representation.',
    'Entity backfill covers missing important references.',
    'The system prompt is frozen from turn one.',
    'Web search results are cleaned and reranked.',
    'Citations use PUA characters in the SSE stream.',
    'DeltaNet is a recurrent architecture with path-dependent state.',
    'The KV cache only covers the 12 GQA attention layers.',
  ];

  it('returns all sentences when n >= length', () => {
    const result = lexrankSummarize(sentences, 20);
    expect(result).toEqual(sentences);
  });

  it('returns exactly n sentences when n < length', () => {
    const result = lexrankSummarize(sentences, 5);
    expect(result).toHaveLength(5);
  });

  it('returns sentences in original order', () => {
    const result = lexrankSummarize(sentences, 4);
    const indices = result.map((s) => sentences.indexOf(s));
    const sorted = [...indices].sort((a, b) => a - b);
    expect(indices).toEqual(sorted);
  });

  it('applies boosts to favor specific sentences', () => {
    const boosts = sentences.map((_, i) => (i === 0 ? 10.0 : 1.0));
    const result = lexrankSummarize(sentences, 3, 0.1, boosts);
    expect(result).toContain(sentences[0]);
  });

  it('applies speaker balance post-pass', () => {
    const labels = sentences.map((_, i) => (i < 10 ? 'User' : 'Assistant'));
    // Only 2 of 12 are Assistant — balance should add more
    const result = lexrankSummarize(sentences, 6, 0.1, null, labels);
    const assistantCount = result.filter((s) => labels[sentences.indexOf(s)] === 'Assistant').length;
    expect(assistantCount).toBeGreaterThanOrEqual(2);
  });

  it('handles single sentence input', () => {
    const result = lexrankSummarize(['Only one sentence.'], 5);
    expect(result).toEqual(['Only one sentence.']);
  });

  it('handles empty input', () => {
    const result = lexrankSummarize([], 5);
    expect(result).toEqual([]);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /home/mikhailst-laurent/projects/ashwater-ai/librechat-fork && npx jest api/server/services/compaction/lexrank.test.js --no-cache`
Expected: FAIL — module not found

**Step 3: Write the implementation**

```javascript
// api/server/services/compaction/lexrank.js
'use strict';

const WORD_RE = /[a-z0-9]+/g;

/**
 * Tokenize text into lowercase alphanumeric words.
 * @param {string} text
 * @returns {string[]}
 */
function tokenize(text) {
  return (text.toLowerCase().match(WORD_RE) || []);
}

/**
 * Pure-stdlib LexRank extractive summarization with MMR diversity.
 *
 * Given a list of sentences, returns the top-N most central sentences
 * (in original order) using TF-IDF cosine similarity + power iteration.
 *
 * Ported from reasoning-proxy.py _lexrank_summarize().
 *
 * @param {string[]} sentences - Input sentences
 * @param {number} [nSentences=15] - Number of sentences to select
 * @param {number} [threshold=0.1] - Cosine similarity threshold for adjacency
 * @param {number[]|null} [boosts=null] - Per-sentence score multipliers
 * @param {string[]|null} [speakerLabels=null] - Per-sentence speaker ID for balance
 * @returns {string[]} Selected sentences in original order
 */
function lexrankSummarize(sentences, nSentences = 15, threshold = 0.1, boosts = null, speakerLabels = null) {
  if (sentences.length <= nSentences) {
    return sentences;
  }

  const nDocs = sentences.length;

  // Build TF vectors and document frequency
  const docFreq = new Map();
  const tfVectors = [];

  for (const sent of sentences) {
    const words = tokenize(sent);
    const tf = new Map();
    const seen = new Set();
    for (const w of words) {
      tf.set(w, (tf.get(w) || 0) + 1);
      if (!seen.has(w)) {
        docFreq.set(w, (docFreq.get(w) || 0) + 1);
        seen.add(w);
      }
    }
    tfVectors.push(tf);
  }

  // IDF
  const idf = new Map();
  for (const [word, df] of docFreq) {
    idf.set(word, Math.log(nDocs / (1 + df)));
  }

  // TF-IDF weighted vectors and norms
  const tfidf = [];
  const norms = [];
  for (const tf of tfVectors) {
    const vec = new Map();
    let normSq = 0;
    for (const [w, count] of tf) {
      const val = count * (idf.get(w) || 0);
      vec.set(w, val);
      normSq += val * val;
    }
    tfidf.push(vec);
    norms.push(Math.sqrt(normSq) || 1.0);
  }

  // Cosine similarity (sparse — only store above threshold)
  const adj = Array.from({ length: nDocs }, () => []);
  for (let i = 0; i < nDocs; i++) {
    for (let j = i + 1; j < nDocs; j++) {
      let dot = 0;
      // Iterate over smaller vector for efficiency
      const [smaller, larger] = tfidf[i].size <= tfidf[j].size ? [tfidf[i], tfidf[j]] : [tfidf[j], tfidf[i]];
      for (const [w, val] of smaller) {
        const otherVal = larger.get(w);
        if (otherVal !== undefined) {
          dot += val * otherVal;
        }
      }
      const sim = dot / (norms[i] * norms[j]);
      if (sim > threshold) {
        adj[i].push([j, sim]);
        adj[j].push([i, sim]);
      }
    }
  }

  // Power iteration for centrality scores
  let scores = new Array(nDocs).fill(1.0 / nDocs);
  const damping = 0.85;
  for (let iter = 0; iter < 20; iter++) {
    const newScores = new Array(nDocs).fill((1 - damping) / nDocs);
    for (let i = 0; i < nDocs; i++) {
      if (adj[i].length === 0) continue;
      let totalWeight = 0;
      for (const [, w] of adj[i]) totalWeight += w;
      for (const [j, w] of adj[i]) {
        newScores[j] += damping * scores[i] * (w / totalWeight);
      }
    }
    scores = newScores;
  }

  // Apply external boosts
  if (boosts) {
    scores = scores.map((s, i) => s * boosts[i]);
  }

  // Cosine helper for MMR
  function cosine(i, j) {
    let dot = 0;
    const [smaller, larger] = tfidf[i].size <= tfidf[j].size ? [tfidf[i], tfidf[j]] : [tfidf[j], tfidf[i]];
    for (const [w, val] of smaller) {
      const otherVal = larger.get(w);
      if (otherVal !== undefined) {
        dot += val * otherVal;
      }
    }
    return dot / (norms[i] * norms[j]);
  }

  // MMR-style selection: centrality vs diversity
  const lambda = 0.5;
  const selected = [];
  const candidates = new Set(Array.from({ length: nDocs }, (_, i) => i));

  for (let k = 0; k < nSentences; k++) {
    if (candidates.size === 0) break;
    let bestIdx = -1;
    let bestScore = -Infinity;
    for (const i of candidates) {
      let redundancy = 0;
      for (const j of selected) {
        const c = cosine(i, j);
        if (c > redundancy) redundancy = c;
      }
      const mmr = lambda * scores[i] - (1 - lambda) * redundancy;
      if (mmr > bestScore) {
        bestScore = mmr;
        bestIdx = i;
      }
    }
    selected.push(bestIdx);
    candidates.delete(bestIdx);
  }

  // Speaker balance post-pass: ensure >= 25% from each speaker
  if (speakerLabels) {
    const selectedSet = new Set(selected);
    const speakers = new Set(speakerLabels);
    if (speakers.size >= 2) {
      const minRep = Math.max(2, Math.floor(selected.length / 4));
      for (const speaker of speakers) {
        const count = selected.filter((i) => speakerLabels[i] === speaker).length;
        if (count < minRep) {
          const candidatesForSpeaker = [];
          for (let i = 0; i < nDocs; i++) {
            if (!selectedSet.has(i) && speakerLabels[i] === speaker) {
              candidatesForSpeaker.push([scores[i], i]);
            }
          }
          candidatesForSpeaker.sort((a, b) => b[0] - a[0]);
          for (let c = 0; c < Math.min(minRep - count, candidatesForSpeaker.length); c++) {
            const idx = candidatesForSpeaker[c][1];
            selected.push(idx);
            selectedSet.add(idx);
          }
        }
      }
    }
  }

  // Return in original order
  selected.sort((a, b) => a - b);
  return selected.map((i) => sentences[i]);
}

module.exports = { lexrankSummarize };
```

**Step 4: Run test to verify it passes**

Run: `cd /home/mikhailst-laurent/projects/ashwater-ai/librechat-fork && npx jest api/server/services/compaction/lexrank.test.js --no-cache`
Expected: PASS — all 7 tests

**Step 5: Commit**

```bash
git add api/server/services/compaction/lexrank.js api/server/services/compaction/lexrank.test.js
git commit -m "feat: add LexRank+MMR summarization module (JS port)"
```

---

### Task 3: Compaction Orchestrator

Port `compact_conversation()` — merge small messages, sentence splitting, boost calculation, LexRank, entity backfill, summary formatting.

**Files:**
- Create: `api/server/services/compaction/index.js`
- Test: `api/server/services/compaction/index.test.js`

**Step 1: Write the test**

```javascript
// api/server/services/compaction/index.test.js
const { compactMessages } = require('./index');

describe('compactMessages', () => {
  function makeMessages(pairs) {
    // pairs: [[role, content], ...] — first is always system
    return pairs.map(([role, content]) => ({ role, content }));
  }

  const systemMsg = ['system', 'You are a helpful assistant.'];

  it('returns null when fewer than 4 messages', () => {
    const msgs = makeMessages([systemMsg, ['user', 'Hello'], ['assistant', 'Hi']]);
    expect(compactMessages(msgs)).toBeNull();
  });

  it('compacts a multi-turn conversation into summary format', () => {
    const msgs = makeMessages([
      systemMsg,
      ['user', 'We need to set up the LLM stack on the Halo box with ROCm support.'],
      ['assistant', 'I will configure llama-server with the UD-Q4_K_XL model and ROCm 7.12.'],
      ['user', 'Make sure to use --no-mmap flag for ROCm performance.'],
      ['assistant', 'Confirmed. Using --no-mmap -ngl 999 -fa on for optimal performance.'],
      ['user', 'Good. Now set up the reasoning proxy on port 8085.'],
      ['assistant', 'The reasoning proxy is configured at http://192.168.10.138:8085.'],
      ['user', 'Perfect. What about the reranker?'],
      ['assistant', 'The reranker runs on port 8086 using jina-reranker-v2-base-multilingual.'],
      ['user', 'Now let us test the full pipeline.'],
    ]);

    const result = compactMessages(msgs);
    expect(result).not.toBeNull();
    expect(result.systemMessage).toEqual(systemMsg[1]);
    expect(result.summaryContent).toContain('continued from a previous conversation');
    expect(result.lastUserMessage).toBe('Now let us test the full pipeline.');
    expect(result.selectedCount).toBeGreaterThan(0);
  });

  it('preserves the last user+assistant exchange verbatim in summary', () => {
    const msgs = makeMessages([
      systemMsg,
      ['user', 'First message about configuration.'],
      ['assistant', 'First response about setup.'],
      ['user', 'Second message about testing.'],
      ['assistant', 'The reranker runs on port 8086 with the jina model deployed locally.'],
      ['user', 'Final question about deployment.'],
    ]);

    const result = compactMessages(msgs);
    expect(result).not.toBeNull();
    expect(result.summaryContent).toContain('The reranker runs on port 8086');
    expect(result.summaryContent).toContain('Second message about testing');
  });

  it('skips tool-role messages during summarization', () => {
    const msgs = makeMessages([
      systemMsg,
      ['user', 'Search for ROCm installation guide.'],
      ['assistant', 'Let me search for that.'],
      ['tool', '{"results": [{"title": "ROCm Install", "url": "https://rocm.docs.amd.com"}]}'],
      ['assistant', 'Here are the ROCm installation steps from the official docs.'],
      ['user', 'Thanks. Now configure the server.'],
    ]);

    const result = compactMessages(msgs);
    expect(result).not.toBeNull();
    // Tool content should not appear in summary text
    expect(result.summaryContent).not.toContain('"results"');
  });

  it('detects multi-compaction (old summary penalty)', () => {
    const priorSummary =
      'This session is being continued from a previous conversation that ran out of context. ' +
      'The summary below covers the earlier portion:\n- User: Set up the Halo box\n- Assistant: Configured llama-server';

    const msgs = makeMessages([
      systemMsg,
      ['user', priorSummary],
      ['assistant', 'Continuing seamlessly.'],
      ['user', 'Now we need to add the reasoning proxy with content cleaning.'],
      ['assistant', 'I will set up the proxy at port 8085 with firecrawl cache and reranker integration.'],
      ['user', 'Also add the entity extraction for compaction summaries.'],
      ['assistant', 'Entity extraction uses 7 regex patterns for paths, URLs, IPs, config keys, flags, packages, and numbers.'],
      ['user', 'Good. Test the compaction pipeline end to end.'],
    ]);

    const result = compactMessages(msgs);
    expect(result).not.toBeNull();
    // The old summary content should be de-prioritized (0.6x penalty)
    // but the conversation should still compact successfully
    expect(result.summaryContent).toContain('continued from a previous conversation');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /home/mikhailst-laurent/projects/ashwater-ai/librechat-fork && npx jest api/server/services/compaction/index.test.js --no-cache`
Expected: FAIL — module not found

**Step 3: Write the implementation**

```javascript
// api/server/services/compaction/index.js
'use strict';

const { extractEntities } = require('./entities');
const { lexrankSummarize } = require('./lexrank');

/**
 * Cue phrases that indicate decision/problem/request content.
 * Sentences containing these get a 1.5x boost in LexRank scoring.
 * Ported from reasoning-proxy.py _CUE_PHRASES.
 */
const CUE_PHRASES = new Set([
  // Decisions
  'the plan is', 'we decided', "let's go with", 'the approach is', 'the solution is',
  'we should', "i'll", "we'll", 'going to', "let's use",
  // Problems
  'the problem is', 'the issue is', 'the bug is', 'the error is', "what's wrong",
  "doesn't work", 'failed', 'broken', 'root cause',
  // Requests
  'i need', 'i want', 'can you', 'could you', 'please',
  // Summary / key points
  'to summarize', 'in summary', 'the key', 'the main', 'so basically',
  'the takeaway', 'in short', 'bottom line', 'to clarify',
  // Architecture / design
  'the architecture', 'the design', 'the pattern', 'the strategy', 'the workflow',
  // Confirmation
  'that works', 'sounds good', 'makes sense', 'agreed', 'confirmed', 'approved',
  'yes,', 'yeah,', 'go for it',
  // Correction / pivot
  'actually,', 'wait,', 'no,', 'instead,', 'but actually', 'correction',
  'changed my mind', 'on second thought',
  // Transition
  'moving on', 'next step', "now let's", 'the next thing',
]);

const MERGE_THRESHOLD = 80;      // chars — merge small messages with predecessor
const MIN_FRAGMENT = 15;         // chars — skip tiny sentence fragments
const SENT_RE = /(?<=[.!?])\s+|\n+/;

/**
 * Compact a conversation's messages into an extractive summary via LexRank+MMR.
 *
 * Does NOT mutate the input array. Returns a result object with the summary
 * content and metadata, or null if compaction is not possible.
 *
 * Ported from reasoning-proxy.py compact_conversation().
 *
 * @param {Array<{role: string, content: string}>} messages - Conversation messages
 * @returns {{ systemMessage: string, summaryContent: string, lastUserMessage: string, selectedCount: number } | null}
 */
function compactMessages(messages) {
  if (messages.length < 4) return null;

  // Find system message
  let systemMsg = null;
  let systemIdx = -1;
  for (let i = 0; i < messages.length; i++) {
    if (messages[i].role === 'system') {
      systemMsg = messages[i];
      systemIdx = i;
      break;
    }
  }

  // Find latest user message (the trigger)
  let lastUserIdx = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') {
      lastUserIdx = i;
      break;
    }
  }

  if (!systemMsg || lastUserIdx <= systemIdx) return null;

  const history = messages.slice(systemIdx + 1, lastUserIdx);
  const newUserMsg = messages[lastUserIdx];

  if (history.length < 2) return null;

  // Find last user+assistant exchange in history to preserve verbatim
  let lastHistAssistant = null;
  let lastHistUser = null;
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].role === 'assistant' && !lastHistAssistant) {
      lastHistAssistant = history[i];
    } else if (history[i].role === 'user' && lastHistAssistant) {
      lastHistUser = history[i];
      break;
    }
  }

  // Determine where to stop summarizing (preserve last exchange)
  let preserveFrom = history.length;
  if (lastHistUser && lastHistAssistant) {
    for (let i = history.length - 1; i >= 0; i--) {
      if (history[i] === lastHistUser) {
        preserveFrom = i;
        break;
      }
    }
  }

  const turnsToSummarize = history.slice(0, preserveFrom);
  if (turnsToSummarize.length === 0) return null;

  // Merge small messages with predecessor
  const mergedTurns = [];
  for (const m of turnsToSummarize) {
    const role = m.role || '';
    const content = (m.content || '').trim();
    if (!content || role === 'tool') continue;
    const label = role === 'user' ? 'User' : 'Assistant';
    if (mergedTurns.length > 0 && content.length < MERGE_THRESHOLD) {
      const prev = mergedTurns[mergedTurns.length - 1];
      mergedTurns[mergedTurns.length - 1] = [prev[0], `${prev[1]} (${label}: ${content})`];
    } else {
      mergedTurns.push([label, content]);
    }
  }

  // Build role-labeled sentences for LexRank
  const allSentences = [];
  const speakerLabels = [];
  const sentenceSources = []; // "summary" for prior compaction, "new" otherwise

  for (const [label, content] of mergedTurns) {
    const isOldSummary = content.toLowerCase().includes('continued from a previous conversation');
    const sents = content.split(SENT_RE).filter((s) => s.trim());
    for (const s of sents) {
      const trimmed = s.trim();
      if (trimmed.length > MIN_FRAGMENT) {
        allSentences.push(`${label}: ${trimmed}`);
        speakerLabels.push(label);
        sentenceSources.push(isOldSummary ? 'summary' : 'new');
      }
    }
  }

  if (allSentences.length === 0) return null;

  // Build per-sentence boost scores
  const nSents = allSentences.length;
  const boosts = new Array(nSents).fill(1.0);

  // Cue phrase boost: 1.5x
  for (let i = 0; i < nSents; i++) {
    const lower = allSentences[i].toLowerCase();
    for (const phrase of CUE_PHRASES) {
      if (lower.includes(phrase)) {
        boosts[i] *= 1.5;
        break;
      }
    }
  }

  // Positional U-curve: boost first 15% and last 25%
  for (let i = 0; i < nSents; i++) {
    const pos = i / Math.max(nSents - 1, 1);
    if (pos < 0.15) {
      boosts[i] *= 1.3;
    } else if (pos > 0.75) {
      boosts[i] *= 1.2;
    }
  }

  // Multi-compaction: penalize old summary, boost persistent entities
  const hasPriorCompaction = sentenceSources.includes('summary');
  if (hasPriorCompaction) {
    const oldSummaryEntities = new Set();
    for (let i = 0; i < nSents; i++) {
      if (sentenceSources[i] === 'summary') {
        boosts[i] *= 0.6;
        for (const e of extractEntities(allSentences[i])) {
          oldSummaryEntities.add(e);
        }
      }
    }
    if (oldSummaryEntities.size > 0) {
      const newEntities = new Set();
      for (let i = 0; i < nSents; i++) {
        if (sentenceSources[i] === 'new') {
          for (const e of extractEntities(allSentences[i])) {
            newEntities.add(e);
          }
        }
      }
      const persistent = new Set([...oldSummaryEntities].filter((e) => newEntities.has(e)));
      if (persistent.size > 0) {
        for (let i = 0; i < nSents; i++) {
          if (sentenceSources[i] === 'new') {
            const sentEnts = extractEntities(allSentences[i]);
            for (const e of persistent) {
              if (sentEnts.has(e)) {
                boosts[i] *= 1.3;
                break;
              }
            }
          }
        }
      }
    }
  }

  // LexRank selection
  const nTarget = Math.min(Math.max(10, Math.floor(allSentences.length / 3)), 30);
  let selected = lexrankSummarize(allSentences, nTarget, 0.1, boosts, speakerLabels);

  // Entity coverage verification: backfill missing important entities
  const entityFreq = new Map();
  for (const sent of allSentences) {
    for (const e of extractEntities(sent)) {
      entityFreq.set(e, (entityFreq.get(e) || 0) + 1);
    }
  }
  const importantEntities = new Set(
    [...entityFreq.entries()].filter(([, c]) => c >= 2).map(([e]) => e),
  );

  if (importantEntities.size > 0) {
    const covered = new Set();
    for (const sent of selected) {
      for (const e of extractEntities(sent)) covered.add(e);
    }
    const missing = [...importantEntities].filter((e) => !covered.has(e));
    if (missing.length > 0) {
      const selectedSet = new Set(selected);
      const backfilled = [];
      for (const ent of missing.sort()) {
        if (covered.has(ent)) continue;
        for (const sent of allSentences) {
          if (!selectedSet.has(sent) && sent.includes(ent)) {
            backfilled.push(sent);
            selectedSet.add(sent);
            for (const e of extractEntities(sent)) covered.add(e);
            break;
          }
        }
      }
      if (backfilled.length > 0) {
        const allSelected = new Set([...selected, ...backfilled]);
        selected = allSentences.filter((s) => allSelected.has(s));
      }
    }
  }

  const summary = selected.map((s) => `- ${s}`).join('\n');

  // Build preserved last exchange text
  let preserved = '';
  if (lastHistUser && lastHistAssistant) {
    preserved =
      '\n\nThe last two exchanges verbatim were:\n\n' +
      `User: ${lastHistUser.content || ''}\n\n` +
      `Assistant: ${lastHistAssistant.content || ''}`;
  }

  const summaryContent =
    'This session is being continued from a previous conversation that ran out of context. ' +
    'The summary below covers the earlier portion of the conversation.\n\n' +
    summary +
    preserved +
    '\n\nContinue the conversation from where it left off without asking the user any further questions. ' +
    'Resume directly — do not acknowledge the summary, do not recap what was happening, ' +
    'do not preface with "I\'ll continue" or similar. Pick up the last task as if the break never happened.';

  return {
    systemMessage: systemMsg.content,
    summaryContent,
    lastUserMessage: newUserMsg.content,
    selectedCount: selected.length,
  };
}

module.exports = { compactMessages, CUE_PHRASES };
```

**Step 4: Run test to verify it passes**

Run: `cd /home/mikhailst-laurent/projects/ashwater-ai/librechat-fork && npx jest api/server/services/compaction/index.test.js --no-cache`
Expected: PASS — all 5 tests

**Step 5: Commit**

```bash
git add api/server/services/compaction/index.js api/server/services/compaction/index.test.js
git commit -m "feat: add compaction orchestrator with LexRank pipeline (JS port)"
```

---

### Task 4: Markdown Export Module

Export full conversation history to `.md` file before destructive compaction.

**Files:**
- Create: `api/server/services/compaction/export.js`
- Test: `api/server/services/compaction/export.test.js`

**Step 1: Write the test**

```javascript
// api/server/services/compaction/export.test.js
const fs = require('fs');
const path = require('path');
const os = require('os');
const { exportConversation } = require('./export');

describe('exportConversation', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'compact-export-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('writes a .md file with conversation history', () => {
    const messages = [
      { role: 'system', content: 'You are helpful.', createdAt: new Date('2026-03-07T14:00:00Z') },
      { role: 'user', content: 'Hello there.', createdAt: new Date('2026-03-07T14:01:00Z'), sender: 'User' },
      { role: 'assistant', content: 'Hi! How can I help?', createdAt: new Date('2026-03-07T14:02:00Z'), sender: 'Agent' },
    ];

    const filePath = exportConversation({
      conversationId: 'test-conv-123',
      title: 'Test Conversation',
      messages,
      exportDir: tmpDir,
    });

    expect(fs.existsSync(filePath)).toBe(true);
    const content = fs.readFileSync(filePath, 'utf8');
    expect(content).toContain('# Conversation Export');
    expect(content).toContain('Test Conversation');
    expect(content).toContain('test-conv-123');
    expect(content).toContain('## System Prompt');
    expect(content).toContain('You are helpful.');
    expect(content).toContain('### User');
    expect(content).toContain('Hello there.');
    expect(content).toContain('### Assistant');
    expect(content).toContain('Hi! How can I help?');
  });

  it('truncates tool responses to 2000 chars', () => {
    const longToolContent = 'x'.repeat(3000);
    const messages = [
      { role: 'system', content: 'System.', createdAt: new Date() },
      { role: 'tool', content: longToolContent, createdAt: new Date(), sender: 'tool' },
      { role: 'user', content: 'Done.', createdAt: new Date(), sender: 'User' },
    ];

    const filePath = exportConversation({
      conversationId: 'test-trunc',
      title: 'Truncation Test',
      messages,
      exportDir: tmpDir,
    });

    const content = fs.readFileSync(filePath, 'utf8');
    expect(content).toContain('[truncated]');
    // Should not contain the full 3000-char string
    expect(content.length).toBeLessThan(longToolContent.length);
  });

  it('creates export directory if it does not exist', () => {
    const nestedDir = path.join(tmpDir, 'nested', 'dir');
    const messages = [
      { role: 'system', content: 'Sys.', createdAt: new Date() },
      { role: 'user', content: 'Hi.', createdAt: new Date(), sender: 'User' },
    ];

    const filePath = exportConversation({
      conversationId: 'test-mkdir',
      title: 'Mkdir Test',
      messages,
      exportDir: nestedDir,
    });

    expect(fs.existsSync(filePath)).toBe(true);
  });

  it('uses filename format: {conversationId}-{YYYYMMDD-HHMMSS}.md', () => {
    const messages = [
      { role: 'system', content: 'Sys.', createdAt: new Date() },
      { role: 'user', content: 'Hi.', createdAt: new Date(), sender: 'User' },
    ];

    const filePath = exportConversation({
      conversationId: 'abc-123',
      title: 'Name Test',
      messages,
      exportDir: tmpDir,
    });

    const filename = path.basename(filePath);
    expect(filename).toMatch(/^abc-123-\d{8}-\d{6}\.md$/);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /home/mikhailst-laurent/projects/ashwater-ai/librechat-fork && npx jest api/server/services/compaction/export.test.js --no-cache`
Expected: FAIL — module not found

**Step 3: Write the implementation**

```javascript
// api/server/services/compaction/export.js
'use strict';

const fs = require('fs');
const path = require('path');

const TOOL_TRUNCATE_LIMIT = 2000;

/**
 * Format a Date as YYYYMMDD-HHMMSS.
 * @param {Date} date
 * @returns {string}
 */
function formatTimestamp(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return (
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-` +
    `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  );
}

/**
 * Format a Date for display in the export header.
 * @param {Date} date
 * @returns {string}
 */
function formatDisplayDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

/**
 * Export a conversation's full message history to a Markdown file.
 *
 * @param {Object} opts
 * @param {string} opts.conversationId
 * @param {string} opts.title - Conversation title
 * @param {Array<{role: string, content: string, createdAt: Date, sender?: string}>} opts.messages
 * @param {string} opts.exportDir - Directory to write the file
 * @returns {string} Absolute path to the exported file
 */
function exportConversation({ conversationId, title, messages, exportDir }) {
  fs.mkdirSync(exportDir, { recursive: true });

  const now = new Date();
  const filename = `${conversationId}-${formatTimestamp(now)}.md`;
  const filePath = path.join(exportDir, filename);

  const lines = [];
  lines.push(`# Conversation Export — ${title || 'Untitled'}`);
  lines.push(`Exported: ${now.toISOString()}`);
  lines.push(`Conversation ID: ${conversationId}`);
  lines.push('Reason: compaction (context threshold exceeded)');
  lines.push('');
  lines.push('---');
  lines.push('');

  // System prompt
  const systemMsg = messages.find((m) => m.role === 'system');
  if (systemMsg) {
    lines.push('## System Prompt');
    lines.push(systemMsg.content || '(empty)');
    lines.push('');
    lines.push('---');
    lines.push('');
  }

  lines.push('## Messages');
  lines.push('');

  for (const msg of messages) {
    if (msg.role === 'system') continue;

    const ts = msg.createdAt ? formatDisplayDate(new Date(msg.createdAt)) : '';
    let content = msg.content || '';

    if (msg.role === 'tool') {
      const toolName = msg.sender || 'tool';
      lines.push(`### Tool: ${toolName} (${ts})`);
      if (content.length > TOOL_TRUNCATE_LIMIT) {
        content = content.slice(0, TOOL_TRUNCATE_LIMIT) + '\n\n[truncated]';
      }
    } else if (msg.role === 'user') {
      lines.push(`### User (${ts})`);
    } else if (msg.role === 'assistant') {
      lines.push(`### Assistant (${ts})`);
    } else {
      lines.push(`### ${msg.role} (${ts})`);
    }

    lines.push(content);
    lines.push('');
  }

  fs.writeFileSync(filePath, lines.join('\n'), 'utf8');
  return filePath;
}

module.exports = { exportConversation };
```

**Step 4: Run test to verify it passes**

Run: `cd /home/mikhailst-laurent/projects/ashwater-ai/librechat-fork && npx jest api/server/services/compaction/export.test.js --no-cache`
Expected: PASS — all 4 tests

**Step 5: Commit**

```bash
git add api/server/services/compaction/export.js api/server/services/compaction/export.test.js
git commit -m "feat: add markdown export for conversation history before compaction"
```

---

### Task 5: Compact Route Handler

Express route that loads messages from MongoDB, exports history, runs compaction, replaces messages, updates conversation.

**Files:**
- Create: `api/server/routes/compact.js`
- Modify: `api/server/routes/index.js` — add `compact` export
- Modify: `api/server/index.js` — mount at `/api/conversations`

**Step 1: Write the route handler**

```javascript
// api/server/routes/compact.js
'use strict';

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { Constants } = require('librechat-data-provider');
const { logger } = require('@librechat/data-schemas');
const requireJwtAuth = require('~/server/middleware/requireJwtAuth');
const { getMessages, deleteMessages } = require('~/models/Message');
const { getConvo, saveConvo } = require('~/models/Conversation');
const { compactMessages } = require('~/server/services/compaction');
const { exportConversation } = require('~/server/services/compaction/export');
const { Message } = require('~/db/models');

const router = express.Router();
router.use(requireJwtAuth);

const EXPORT_DIR = process.env.COMPACTION_EXPORT_DIR || '/app/exports';

router.post('/:conversationId/compact', async (req, res) => {
  const { conversationId } = req.params;
  const userId = req.user?.id ?? req.user?._id;

  try {
    // Verify conversation exists and belongs to user
    const convo = await getConvo(userId, conversationId);
    if (!convo) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    // Load all messages for this conversation
    const messages = await getMessages({ conversationId });
    if (!messages || messages.length < 4) {
      return res.status(400).json({ error: 'Not enough messages to compact' });
    }

    // Convert LibreChat messages to simple {role, content} for compaction
    const simpleMessages = messages.map((m) => ({
      role: m.isCreatedByUser ? 'user' : (m.sender === 'System' ? 'system' : 'assistant'),
      content: m.text || '',
    }));

    // Detect system message: first message or check for system-like content
    // LibreChat doesn't store system messages as separate Message docs typically.
    // The system prompt comes from the agent config, not from stored messages.
    // We need to handle the case where there is no system message in the DB.
    if (simpleMessages.length > 0 && simpleMessages[0].role !== 'system') {
      // Insert a placeholder system message so compaction has the right structure
      simpleMessages.unshift({ role: 'system', content: '' });
    }

    // Run compaction
    const result = compactMessages(simpleMessages);
    if (!result) {
      return res.status(400).json({ error: 'Compaction not possible — not enough content' });
    }

    // Export full history to .md before deletion
    const exportedPath = exportConversation({
      conversationId,
      title: convo.title || 'Untitled',
      messages: messages.map((m) => ({
        role: m.isCreatedByUser ? 'user' : 'assistant',
        content: m.text || '',
        createdAt: m.createdAt,
        sender: m.sender,
      })),
      exportDir: EXPORT_DIR,
    });

    // Delete all existing messages for this conversation
    const deleteResult = await deleteMessages({ conversationId });
    const deletedCount = deleteResult?.deletedCount || messages.length;

    // Create 4 new messages with fresh IDs and parentMessageId chain
    const msgIds = [uuidv4(), uuidv4(), uuidv4(), uuidv4()];
    const now = new Date();
    const endpoint = convo.endpoint || 'agents';
    const model = convo.model || '';

    const newMessages = [
      {
        messageId: msgIds[0],
        conversationId,
        parentMessageId: Constants.NO_PARENT,
        user: userId,
        text: result.summaryContent,
        sender: 'User',
        isCreatedByUser: true,
        endpoint,
        model,
        createdAt: new Date(now.getTime()),
      },
      {
        messageId: msgIds[1],
        conversationId,
        parentMessageId: msgIds[0],
        user: userId,
        text: 'Continuing seamlessly.',
        sender: 'Agent',
        isCreatedByUser: false,
        endpoint,
        model,
        createdAt: new Date(now.getTime() + 1),
      },
      {
        messageId: msgIds[2],
        conversationId,
        parentMessageId: msgIds[1],
        user: userId,
        text: result.lastUserMessage,
        sender: 'User',
        isCreatedByUser: true,
        endpoint,
        model,
        createdAt: new Date(now.getTime() + 2),
      },
    ];

    // Bulk insert using the Mongoose model directly
    await Message.insertMany(newMessages);

    // Update conversation to point to the new message chain
    await saveConvo(req, { conversationId }, { context: 'compact' });

    logger.info(
      `[compact] ${conversationId}: ${deletedCount} messages removed, ${result.selectedCount} summary sentences, exported to ${exportedPath}`,
    );

    res.status(200).json({
      success: true,
      exported: exportedPath,
      messages_removed: deletedCount,
      summary_sentences: result.selectedCount,
      new_message_count: 3,
    });
  } catch (error) {
    logger.error('[compact] Error compacting conversation:', error);
    res.status(500).json({ error: 'Internal server error during compaction' });
  }
});

module.exports = router;
```

**Note:** The design doc specified 4 messages (system + user summary + assistant + user latest). LibreChat doesn't store system prompt as a Message document — it comes from the agent config. So we store 3 messages: user summary, assistant ack, user latest. The system prompt persists via the agent configuration.

**Step 2: Register the route**

In `api/server/routes/index.js`, add:
```javascript
const compact = require('./compact');
```
And in the `module.exports` object, add `compact`.

In `api/server/index.js`, add after the other `app.use` lines (around line 163):
```javascript
app.use('/api/conversations', routes.compact);
```

**Step 3: Commit**

```bash
git add api/server/routes/compact.js api/server/routes/index.js api/server/index.js
git commit -m "feat: add POST /api/conversations/:id/compact route"
```

---

### Task 6: Docker Compose — Export Volume

Add the exports volume mount so `.md` files persist outside the container.

**Files:**
- Modify: `/opt/docker-containers/librechat/docker-compose.yml.fork` — add volume
- Modify: `/opt/docker-containers/librechat/docker-compose.override.yml.fork` — add volume (if override is used for volumes)

**Step 1: Add volume mount**

In `docker-compose.yml.fork`, under `services.api.volumes`, add:
```yaml
      - ./exports:/app/exports
```

**Step 2: Create exports directory**

```bash
mkdir -p /opt/docker-containers/librechat/exports
```

**Step 3: Commit fork compose changes**

```bash
cd /home/mikhailst-laurent/projects/ashwater-ai/librechat-fork
# Note: docker-compose.yml.fork is at /opt/docker-containers/librechat/
# Copy updated version or edit in place
git add -A && git commit -m "feat: add exports volume for compaction .md files"
```

---

### Task 7: Context Indicator — Wire Compact Button

The context indicator already has a "Compact" button in `context-indicator.js`. Wire it to call `POST /api/conversations/:id/compact` instead of the proxy's `/proxy/compact`.

**Files:**
- Modify: `client/public/context-indicator.js` — change compact button URL

**Step 1: Find current compact button code**

Search for `compact` in `context-indicator.js`. The button currently calls the proxy's `/proxy/compact` endpoint.

**Step 2: Update to use the fork's endpoint**

Change the fetch URL to `/api/conversations/${conversationId}/compact` and add the auth token header. The `conversationId` can be extracted from the current URL or the LibreChat React state.

**Step 3: Commit**

```bash
git add client/public/context-indicator.js
git commit -m "feat: wire compact button to fork endpoint instead of proxy"
```

---

### Task 8: Integration Test — Full Compaction Flow

Test the complete flow: load messages → export → compact → verify DB state.

**Files:**
- Create: `api/server/routes/compact.test.js`

**Step 1: Write the integration test**

```javascript
// api/server/routes/compact.test.js
const express = require('express');
const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Mock auth middleware
jest.mock('~/server/middleware/requireJwtAuth', () => (req, res, next) => {
  req.user = { id: 'test-user-123' };
  next();
});

let app;
let mongoServer;
let tmpExportDir;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
  tmpExportDir = fs.mkdtempSync(path.join(os.tmpdir(), 'compact-test-'));
  process.env.COMPACTION_EXPORT_DIR = tmpExportDir;

  const compactRoutes = require('./compact');
  app = express();
  app.use(express.json());
  app.use('/api/conversations', compactRoutes);
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
  fs.rmSync(tmpExportDir, { recursive: true, force: true });
});

describe('POST /api/conversations/:conversationId/compact', () => {
  it('compacts a conversation and persists to MongoDB', async () => {
    const { Message } = require('~/db/models');
    const { Conversation } = require('~/db/models');
    const conversationId = 'test-convo-' + Date.now();

    // Seed conversation
    await Conversation.create({
      conversationId,
      user: 'test-user-123',
      title: 'Test Compaction',
      endpoint: 'agents',
      model: 'test-model',
    });

    // Seed messages (enough for compaction)
    const msgs = [];
    for (let i = 0; i < 10; i++) {
      msgs.push({
        messageId: `msg-${i}`,
        conversationId,
        parentMessageId: i === 0 ? '00000000-0000-0000-0000-000000000000' : `msg-${i - 1}`,
        user: 'test-user-123',
        text: i % 2 === 0
          ? `User message ${i}: configuring the system with threshold ${50000 + i * 1000}`
          : `Assistant response ${i}: confirmed, the setting is applied to the server.`,
        sender: i % 2 === 0 ? 'User' : 'Agent',
        isCreatedByUser: i % 2 === 0,
        endpoint: 'agents',
      });
    }
    await Message.insertMany(msgs);

    // Compact
    const res = await request(app)
      .post(`/api/conversations/${conversationId}/compact`)
      .send({})
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.messages_removed).toBe(10);
    expect(res.body.exported).toBeTruthy();
    expect(fs.existsSync(res.body.exported)).toBe(true);

    // Verify DB state: should have 3 messages now
    const remaining = await Message.find({ conversationId }).sort({ createdAt: 1 }).lean();
    expect(remaining.length).toBe(3);
    expect(remaining[0].isCreatedByUser).toBe(true); // summary
    expect(remaining[0].text).toContain('continued from a previous conversation');
    expect(remaining[1].isCreatedByUser).toBe(false); // assistant ack
    expect(remaining[1].text).toBe('Continuing seamlessly.');
    expect(remaining[2].isCreatedByUser).toBe(true); // latest user msg
  });

  it('returns 404 for nonexistent conversation', async () => {
    await request(app)
      .post('/api/conversations/nonexistent-id/compact')
      .send({})
      .expect(404);
  });

  it('returns 400 when not enough messages', async () => {
    const { Conversation, Message } = require('~/db/models');
    const conversationId = 'test-short-' + Date.now();

    await Conversation.create({
      conversationId,
      user: 'test-user-123',
      title: 'Short Convo',
      endpoint: 'agents',
    });

    await Message.create({
      messageId: 'only-msg',
      conversationId,
      parentMessageId: '00000000-0000-0000-0000-000000000000',
      user: 'test-user-123',
      text: 'Only message',
      sender: 'User',
      isCreatedByUser: true,
      endpoint: 'agents',
    });

    await request(app)
      .post(`/api/conversations/${conversationId}/compact`)
      .send({})
      .expect(400);
  });
});
```

**Step 2: Run tests**

Run: `cd /home/mikhailst-laurent/projects/ashwater-ai/librechat-fork && npx jest api/server/routes/compact.test.js --no-cache`
Expected: PASS — all 3 tests

**Step 3: Commit**

```bash
git add api/server/routes/compact.test.js
git commit -m "test: add integration tests for compaction endpoint"
```

---

### Task 9: Build, Deploy, and Smoke Test

Build the fork image, deploy, and verify end-to-end.

**Step 1: Build the fork image**

```bash
cd /home/mikhailst-laurent/projects/ashwater-ai/librechat-fork
docker build -t librechat-ashwater:latest .
```

**Step 2: Restart API container**

```bash
cd /opt/docker-containers/librechat
docker compose -f docker-compose.yml.fork -f docker-compose.override.yml.fork rm -sf api
docker compose -f docker-compose.yml.fork -f docker-compose.override.yml.fork up -d api
```

**Step 3: Smoke test via curl**

```bash
# Get a valid token (check browser dev tools or use a test endpoint)
# Then test compaction on a long conversation:
curl -X POST http://localhost:3080/api/conversations/{CONVERSATION_ID}/compact \
  -H "Authorization: Bearer {TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{}'
```

Expected: `{"success": true, "exported": "/app/exports/...", "messages_removed": N, ...}`

**Step 4: Verify persistence**

1. Check export file exists: `ls /opt/docker-containers/librechat/exports/`
2. Reload the conversation in the browser — should show 3 messages (summary, ack, last user)
3. Close and reopen the tab — compacted state should persist

**Step 5: Commit and push**

```bash
cd /home/mikhailst-laurent/projects/ashwater-ai/librechat-fork
git push origin ashwater
```

---

## File Summary

| File | Action | Purpose |
|------|--------|---------|
| `api/server/services/compaction/entities.js` | Create | Entity extraction (7 regex patterns) |
| `api/server/services/compaction/entities.test.js` | Create | Entity extraction tests |
| `api/server/services/compaction/lexrank.js` | Create | LexRank+MMR summarization |
| `api/server/services/compaction/lexrank.test.js` | Create | LexRank tests |
| `api/server/services/compaction/index.js` | Create | Compaction orchestrator |
| `api/server/services/compaction/index.test.js` | Create | Orchestrator tests |
| `api/server/services/compaction/export.js` | Create | Markdown export |
| `api/server/services/compaction/export.test.js` | Create | Export tests |
| `api/server/routes/compact.js` | Create | Express route handler |
| `api/server/routes/compact.test.js` | Create | Integration test |
| `api/server/routes/index.js` | Modify | Register compact route |
| `api/server/index.js` | Modify | Mount at `/api/conversations` |
| `docker-compose.yml.fork` | Modify | Add exports volume |
| `client/public/context-indicator.js` | Modify | Wire compact button |
