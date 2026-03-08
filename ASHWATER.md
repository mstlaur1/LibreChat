# Ashwater AI — LibreChat Fork

Thin fork of [LibreChat](https://github.com/danny-avila/LibreChat) for the Ashwater AI self-hosted LLM stack. Converts 6 runtime entrypoint patches + a custom `@librechat/agents` build into proper source changes and a single Docker image.

## Stack Overview

| Machine | Role | Key Services |
|---|---|---|
| **Halo** (192.168.10.138) | GPU inference | llama-server (Qwen 3.5 122B), reasoning-proxy, local-reranker |
| **Media** (192.168.10.100) | Web services | LibreChat (this fork), SearXNG, firecrawl, MongoDB, Meilisearch |

- **Model**: Qwen 3.5 122B-A10B (UD-Q4_K_XL) on AMD Strix Halo iGPU (96 GB unified RAM)
- **Inference**: llama-server with ROCm, 75K context, FA on
- **Proxy**: reasoning-proxy handles prefix replay, KV cache optimization, compaction, content cleaning
- **Search**: SearXNG meta-search → firecrawl scraping → Jina reranker
- **URL**: https://ai.mystle.ca (Caddy reverse proxy)

## Branch: `ashwater`

Based 92 commits after the `v0.8.3-rc1` tag. All Ashwater changes are isolated commits on top of upstream history.

### Commits

| # | Commit | Description |
|---|---|---|
| 1 | `5f65765` | `buildWebSearchContext` date-only — removes ISO timestamp that busts KV cache every turn |
| 2 | `c0a7648` | Wire `topResults` from `librechat.yaml` webSearch config into `createSearchTool()` |
| 3 | `f336f5e` | Memory timeout 3s→10s (local inference is slower), user-only message extraction |
| 4 | `a5f9d23` | Context usage indicator — vanilla JS polling `/proxy/context` for token counts |
| 5 | `e469df4` | MCP fetch content cleaning — strips noise, normalizes markdown before windowing |
| 6 | `e5bbc82` | Kimi provider icon (`kimi.svg`) |
| 7 | `ccec8e2` | Bundle custom `@librechat/agents` search tool (pre-built dist overlay) |
| 8 | `56eb714` | Copy `context-indicator.js` to dist after Vite build (publicDir=false in production) |
| 9 | `6ab7042` | Pin `@librechat/agents` to 3.1.55 matching fork |
| 10 | `e905d14` | Fix: save `hide_sequential_outputs` before `runAgents` clears `config.configurable` |
| 11 | `e5229fa` | Code audit: topResults ordering, Dockerfile cleanup, entrypoint error handling |

## Files Added

| File | Purpose |
|---|---|
| `agents-dist/` | Pre-built `@librechat/agents` dist with custom search tool (SearXNG adapter, result filtering, temporal detection). Source: `mstlaur1/librechat-agents` branch `custom` |
| `scripts/entrypoint.sh` | Container entrypoint — patches MCP fetch tool, then starts Node server |
| `scripts/patch-mcp-fetch.py` | Injects content cleaning (noise stripping, markdown normalization) into `mcp-server-fetch` cached package at container start |
| `client/public/context-indicator.js` | Vanilla JS widget — polls `/proxy/context` for token usage, shows count above chat input, manual compact button |
| `client/public/assets/kimi.svg` | Custom Kimi K2.5 provider icon |
| `ASHWATER.md` | This file |

## Files Modified

| File | Change |
|---|---|
| `Dockerfile` | Custom entrypoint, agents-dist overlay, context-indicator copy, dead weight cleanup |
| `packages/api/src/tools/toolkits/web.ts` | Date-only format in web search context (prevents KV cache busting) |
| `api/app/clients/tools/util/handleTools.js` | Wire `topResults` from YAML config to search tool |
| `api/server/controllers/agents/client.js` | Memory timeout 10s, user-only extraction, `hideSequentialOutputs` fix |
| `client/index.html` | Script tag for context-indicator.js |
| `api/package.json` | `@librechat/agents` version range `^3.1.52` |
| `package.json` | Remove stray root-level agents dependency |
| `.dockerignore` | No changes (agents-dist removed from image in RUN step) |

## Custom @librechat/agents (agents-dist/)

Pre-built from `mstlaur1/librechat-agents` branch `custom` (5 commits above `v3.1.55`). Key changes in `src/tools/search/`:

| File | Changes |
|---|---|
| `schema.ts` | Custom `WebSearchToolSchema` with date/country/images/videos/news params. Behavioral rules in tool description |
| `format.ts` | Result filtering (non-Latin, junk domains), clean `[Source N]`/`[News N]` formatting, keyword relevance ranking |
| `search.ts` | SearXNG adapter with temporal keyword auto-detection, country-to-language mapping, news result extraction |
| `tool.ts` | Parallel search execution (images/videos/news concurrent with main), country schema for all providers |
| `types.ts` | `ResultReference` type, `turn` and `references` fields on `SearchResultData` |

## Docker Build

```bash
# Build
docker build -t librechat-ashwater:latest .

# Run with docker-compose
# Uses docker-compose.yml.fork + docker-compose.override.yml.fork
docker compose up -d api
```

The image:
- Overlays custom agents dist into `node_modules/@librechat/agents/dist/`
- Copies `context-indicator.js` to `client/dist/` after frontend build
- Runs `scripts/entrypoint.sh` which patches MCP fetch at container start
- Cleans up dead weight (`agents-dist/` copy, dev dependencies)

## Remaining Work

### Phase 3: Native Compaction (not started)
Port the reasoning-proxy's LexRank+MMR extractive summarizer (~430 lines Python) to a native LibreChat endpoint with MongoDB persistence.

- **Problem**: Proxy-side compaction rewrites messages in memory, but LibreChat stores originals in MongoDB. When prefix cache entries expire (6h TTL), full uncompacted history is reloaded.
- **Solution**: `POST /api/conversations/:id/compact` endpoint that updates MongoDB directly
- **Spec**: LexRank TF-IDF + cosine similarity + power iteration (20 rounds) + MMR diversity selection + entity coverage backfill
- **Export**: Write compacted conversation as `.md` file to configurable directory
- **Dependencies**: Pure stdlib (re, math, collections) — no numpy/sklearn/nltk

### Phase 5: Cleanup (not started)
- Delete `patches/`, `agents-dist/`, `entrypoint-patch.sh` from media server
- Archive `~/librechat-agents/` on halo
- Remove compaction code from `reasoning-proxy.py` (after Phase 3)
- Convert context indicator from vanilla JS to React component

### Known Limitations
- MCP fetch tool can't handle JS-heavy sites (readabilipy limitation)
- Context indicator uses MutationObserver on full DOM (planned React rewrite)
- `_normalize_md` in fetch cleaning is aggressive — strips all markdown structure
- Upstream image was built from unmerged PR branch `pr-12009`, not v0.8.3-rc1 tag — ~15 files differ from our base

## Upstream Sync

The fork is pinned to avoid surprise breakage. To rebase on upstream:

```bash
git fetch upstream
git rebase upstream/main
# Resolve conflicts in modified files (client.js, handleTools.js, web.ts)
# Rebuild and test
```

Keep patches small and isolated to minimize merge conflicts. The agents-dist overlay is the highest conflict risk since it replaces compiled output.
