'use strict';

const { extractEntities } = require('./entities');
const { lexrankSummarize } = require('./lexrank');

const _SENT_RE = /(?<=[.!?])\s+|\n+/;

const CUE_PHRASES = new Set([
  'the plan is', 'we decided', "let's go with", 'the approach is', 'the solution is',
  'we should', "i'll", "we'll", 'going to', "let's use",
  'the problem is', 'the issue is', 'the bug is', 'the error is', "what's wrong",
  "doesn't work", 'failed', 'broken', 'root cause',
  'i need', 'i want', 'can you', 'could you', 'please',
  'to summarize', 'in summary', 'the key', 'the main', 'so basically',
  'the takeaway', 'in short', 'bottom line', 'to clarify',
  'the architecture', 'the design', 'the pattern', 'the strategy', 'the workflow',
  'that works', 'sounds good', 'makes sense', 'agreed', 'confirmed', 'approved',
  'yes,', 'yeah,', 'go for it',
  'actually,', 'wait,', 'no,', 'instead,', 'but actually', 'correction',
  'changed my mind', 'on second thought',
  'moving on', 'next step', "now let's", 'the next thing',
]);

const MERGE_THRESHOLD = 80;

/**
 * Compact a conversation's messages into a summary.
 *
 * @param {Array<{role: string, content: string}>} messages
 * @returns {{ systemMessage: string, summaryContent: string, lastUserMessage: string, selectedCount: number } | null}
 */
function compactMessages(messages) {
  if (messages.length < 4) {
    return null;
  }

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

  // Find last user message
  let lastUserIdx = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') {
      lastUserIdx = i;
      break;
    }
  }

  if (systemMsg === null || lastUserIdx <= systemIdx) {
    return null;
  }

  const history = messages.slice(systemIdx + 1, lastUserIdx);
  const newUserMsg = messages[lastUserIdx];

  if (history.length < 2) {
    return null;
  }

  // Find last assistant and preceding user in history
  let lastHistAssistant = null;
  let lastHistUser = null;
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].role === 'assistant' && lastHistAssistant === null) {
      lastHistAssistant = history[i];
    } else if (history[i].role === 'user' && lastHistAssistant !== null) {
      lastHistUser = history[i];
      break;
    }
  }

  // Find preserve boundary
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
  if (turnsToSummarize.length === 0) {
    return null;
  }

  // Merge short turns
  const mergedTurns = [];
  for (const m of turnsToSummarize) {
    const role = m.role || '';
    const content = (m.content || '').trim();
    if (!content || role === 'tool') {
      continue;
    }
    const label = role === 'user' ? 'User' : 'Assistant';
    if (mergedTurns.length > 0 && content.length < MERGE_THRESHOLD) {
      const prev = mergedTurns[mergedTurns.length - 1];
      mergedTurns[mergedTurns.length - 1] = [prev[0], `${prev[1]} (${label}: ${content})`];
    } else {
      mergedTurns.push([label, content]);
    }
  }

  // Split into sentences
  const allSentences = [];
  const speakerLabels = [];
  const sentenceSources = [];

  for (const [label, content] of mergedTurns) {
    const isOldSummary = content.toLowerCase().includes('continued from a previous conversation');
    const sents = content.split(_SENT_RE).map((s) => s.trim()).filter((s) => s);
    for (const s of sents) {
      if (s.length > 15) {
        allSentences.push(`${label}: ${s}`);
        speakerLabels.push(label);
        sentenceSources.push(isOldSummary ? 'summary' : 'new');
      }
    }
  }

  if (allSentences.length === 0) {
    return null;
  }

  const nSents = allSentences.length;
  const boosts = new Array(nSents).fill(1.0);

  // Cue phrase boost 1.5x
  for (let i = 0; i < nSents; i++) {
    const lower = allSentences[i].toLowerCase();
    for (const phrase of CUE_PHRASES) {
      if (lower.includes(phrase)) {
        boosts[i] *= 1.5;
        break;
      }
    }
  }

  // Positional U-curve
  for (let i = 0; i < nSents; i++) {
    const pos = i / Math.max(nSents - 1, 1);
    if (pos < 0.15) {
      boosts[i] *= 1.3;
    } else if (pos > 0.75) {
      boosts[i] *= 1.2;
    }
  }

  // Multi-compaction awareness
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
      const persistent = new Set();
      for (const e of oldSummaryEntities) {
        if (newEntities.has(e)) {
          persistent.add(e);
        }
      }
      if (persistent.size > 0) {
        for (let i = 0; i < nSents; i++) {
          if (sentenceSources[i] === 'new') {
            const ents = extractEntities(allSentences[i]);
            for (const e of persistent) {
              if (ents.has(e)) {
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

  // Entity backfill
  const entityFreq = new Map();
  for (const sent of allSentences) {
    for (const e of extractEntities(sent)) {
      entityFreq.set(e, (entityFreq.get(e) || 0) + 1);
    }
  }
  const importantEntities = new Set();
  for (const [e, c] of entityFreq) {
    if (c >= 2) {
      importantEntities.add(e);
    }
  }

  if (importantEntities.size > 0) {
    const covered = new Set();
    for (const sent of selected) {
      for (const e of extractEntities(sent)) {
        covered.add(e);
      }
    }
    const missing = new Set();
    for (const e of importantEntities) {
      if (!covered.has(e)) {
        missing.add(e);
      }
    }
    if (missing.size > 0) {
      const selectedSet = new Set(selected);
      const backfilled = [];
      const sortedMissing = Array.from(missing).sort();
      for (const ent of sortedMissing) {
        if (covered.has(ent)) {
          continue;
        }
        for (const sent of allSentences) {
          if (!selectedSet.has(sent) && sent.includes(ent)) {
            backfilled.push(sent);
            selectedSet.add(sent);
            for (const e of extractEntities(sent)) {
              covered.add(e);
            }
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

  // Build summary
  const summary = selected.map((s) => `- ${s}`).join('\n');

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
