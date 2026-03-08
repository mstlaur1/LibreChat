# Phase 3: Compaction Persistence — Design

## Problem

The reasoning proxy compacts conversations in-memory when context exceeds 50K tokens. But LibreChat stores the original messages in MongoDB. When the proxy's `prefix_msg_store` TTL expires (6h) or the user resumes in a new session, LibreChat reloads full history from MongoDB — compaction is lost.

Confirmed: post-compaction turn has 4 messages / 9K chars. Next turn: 25 messages / full history resent.

## Decision: Destructive Replace with Export

**Approach A chosen over overlay (B)** because:
- Fewer code paths, less failure-prone
- Matches what the proxy already does (4-message rewrite)
- No need to modify `buildMessages()` loading logic or React rendering
- Compaction is permanent and survives restarts, TTL expiry, session resume

**Safety net**: Full conversation history exported to `.md` file before compaction.

## Architecture

### New Endpoint

`POST /api/conversations/:id/compact`

Located in fork: `api/server/routes/compact.js`

**Flow**:
1. Load all messages for `conversationId` from MongoDB
2. Walk `parentMessageId` tree to get ordered message chain
3. Export full history to `.md` file (configurable output dir, default `/app/exports/`)
4. Run LexRank+MMR extractive summarization (ported from Python)
5. Delete all existing messages for this conversation
6. Insert 4 new messages with fresh `messageId`/`parentMessageId` chain:
   - `[0] system` — preserved from original
   - `[1] user` — summary (with "Full conversation history exported" note)
   - `[2] assistant` — "Continuing seamlessly."
   - `[3] user` — the latest user message that triggered compaction
7. Update conversation document with new message references
8. Return `{ success: true, exported: "/path/to/file.md", messages_removed: N, summary_sentences: N }`

### LexRank+MMR Port (Python -> JavaScript)

Port ~430 lines from `reasoning-proxy.py` to JS. All pure stdlib (no numpy/sklearn):
- `extractEntities(text)` — 7 regex patterns (paths, URLs, IPs, config keys, flags, packages, numbers)
- `CUE_PHRASES` — ~40 decision/problem/request/transition markers
- `lexrankSummarize(sentences, nSentences, threshold, boosts, speakerLabels)` — TF-IDF + cosine + power iteration (20 rounds, damping=0.85) + MMR (lambda=0.5) + speaker balance (25% min)
- `compactConversation(messages)` — orchestrator: merge small msgs, sentence split, boost calc, LexRank, entity backfill, format summary

Constants to preserve: `n_target = min(max(10, len/3), 30)`, merge threshold 80 chars, min fragment 15 chars, old summary penalty 0.6x, persistent entity boost 1.3x, positional U-curve 1.3x/1.2x.

### Markdown Export

Before deleting messages, write full history to:
```
{EXPORT_DIR}/{conversationId}-{YYYYMMDD-HHMMSS}.md
```

Format:
```markdown
# Conversation Export — {title}
Exported: {ISO timestamp}
Conversation ID: {id}
Reason: compaction (context threshold exceeded)

---

## System Prompt
{system message text}

---

## Messages

### User (2026-03-07 14:23)
{message text}

### Assistant (2026-03-07 14:24)
{message text}

### Tool: web_search (2026-03-07 14:24)
{tool response, truncated to 2000 chars}

...
```

`EXPORT_DIR` configurable via env var (default `/app/exports/`). For NAS, mount the NAS path to this directory in docker-compose.

### Trigger Mechanism

**Compaction lives entirely in the fork.** The proxy is not involved.

The fork's compact endpoint handles everything: token counting, LexRank summarization, MongoDB persistence, and .md export. The proxy's compaction code is removed after Phase 3 is stable (Phase 5 cleanup).

**Trigger options** (both supported):
- **Manual**: User clicks "Compact" in context indicator → `POST /api/conversations/:id/compact`
- **Auto**: The fork checks token count after each response. If `prompt_tokens > COMPACTION_THRESHOLD`, compact before the next turn. Token count comes from llama-server usage data (already forwarded through proxy in the SSE stream).

**Why not proxy-side**: The proxy rewrites messages in-memory but can't persist to MongoDB. This created the original bug — compaction lost on session resume. Moving compaction to the fork eliminates the split-brain problem entirely.

### Message Schema Mapping

Proxy messages are `{role, content}`. LibreChat messages need:

| Field | Value |
|---|---|
| `messageId` | `nanoid()` — fresh ID |
| `conversationId` | From route param |
| `parentMessageId` | Chain: null -> msg0 -> msg1 -> msg2 -> msg3 |
| `user` | From `req.user.id` |
| `text` | Message content |
| `sender` | `"User"` or `"Agent"` based on role |
| `isCreatedByUser` | `true` for user role, `false` for assistant |
| `endpoint` | `"agents"` |
| `model` | From conversation metadata |
| `tokenCount` | Estimated from text length |
| `summary` | (unused — we replace, not overlay) |
| `createdAt` | Current timestamp |

`parentMessageId` chain: First message uses `Constants.NO_PARENT`. Each subsequent message's parent is the previous message's `messageId`.

### Docker Compose Changes

Add export volume mount:
```yaml
services:
  api:
    volumes:
      - ./exports:/app/exports
```

For NAS: `- /mnt/nas/ai-exports:/app/exports`

## Files to Create/Modify

### New Files
- `api/server/routes/compact.js` — Express route handler
- `api/server/services/compaction/index.js` — LexRank+MMR + orchestrator
- `api/server/services/compaction/lexrank.js` — TF-IDF, cosine, power iteration, MMR
- `api/server/services/compaction/entities.js` — Entity extraction
- `api/server/services/compaction/export.js` — Markdown export

### Modified Files
- `api/server/routes/index.js` — Register `/api/conversations/:id/compact` route
- `docker-compose.yml.fork` — Add exports volume

### Proxy Changes (Phase 5 cleanup)
- `reasoning-proxy.py` — Remove `compact_conversation()`, `_lexrank_summarize()`, `_extract_entities()`, `_CUE_PHRASES`, compaction trigger logic, `/proxy/compact` endpoint (~430 lines)

## Testing

- Port `test_summarizer.py` logic to JS (or keep as integration test hitting the endpoint)
- Test: compact -> close tab -> reopen -> verify compacted state persists (4 messages)
- Test: compact -> verify .md export exists with full history
- Test: compact a conversation that was already compacted (multi-compaction awareness)
- Test: compact with tool responses (should be included in export, excluded from LexRank)

## Out of Scope

- React component for viewing exports (filesystem access is sufficient)
- Download link in chat UI (too much React surgery for now)
- Context indicator changes (already polls `/proxy/context`, works as-is)
- Moving compaction trigger from proxy to fork (future optimization)
