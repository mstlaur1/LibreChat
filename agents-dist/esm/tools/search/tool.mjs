import axios from 'axios';
import { tool } from '@langchain/core/tools';
import { WebSearchToolDescription, WebSearchToolName, countrySchema, newsSchema, videosSchema, imagesSchema, dateSchema, querySchema } from './schema.mjs';
import { createSearchAPI, createSourceProcessor } from './search.mjs';
import { createSerperScraper } from './serper-scraper.mjs';
import { createFirecrawlScraper } from './firecrawl.mjs';
import { expandHighlights } from './highlights.mjs';
import { formatResultsForLLM, filterArtifactResults } from './format.mjs';
import { createDefaultLogger } from './utils.mjs';
import { createReranker } from './rerankers.mjs';
import { Constants } from '../../common/enum.mjs';

/** Max total chars for the formatted LLM output */
const MAX_OUTPUT_CHARS = 6000;
// Local synthesis: runs AFTER the search pipeline to synthesize cleaned,
// reranked highlights into a coherent answer with inline [N] citations.
const SYNTH_URL = process.env.LOCAL_SYNTH_URL || 'http://localhost:8087/v1/chat/completions';
const SYNTH_TIMEOUT = 30000;
const SYNTH_MAX_SOURCES = 5;
/** Max searches the model may perform per reply (enforced by counter in output) */
const MAX_SEARCHES = 3;
/**
 * Compute objective quality signals from pipeline data.
 * These are facts about the search results — not model self-assessment.
 */
function computeQualitySignals(query, sources, results) {
    // Query keyword coverage across all source content
    const keywords = query
        .toLowerCase()
        .split(/\s+/)
        .filter((w) => w.length > 2);
    const allText = sources.map((s) => `${s.title} ${s.content}`).join(' ').toLowerCase();
    const coverage = keywords.length > 0
        ? keywords.filter((kw) => allText.includes(kw)).length / keywords.length
        : 1;
    // Average highlight reranker score
    const scores = [];
    for (const sType of ['organic', 'topStories']) {
        const items = results[sType];
        if (!items)
            continue;
        for (const item of items) {
            if (item.highlights) {
                for (const h of item.highlights) {
                    scores.push(h.score);
                }
            }
        }
    }
    const avgScore = scores.length > 0
        ? scores.reduce((a, b) => a + b, 0) / scores.length
        : 0;
    return {
        sourcesCited: sources.length,
        queryTermCoverage: coverage,
        avgRelevance: avgScore,
        minSourceChars: sources.length > 0
            ? Math.min(...sources.map((s) => s.content.length))
            : 0,
    };
}
/**
 * Format quality signals as a compact hint line for the 122B model.
 */
function formatQualityHint(signals) {
    const rel = signals.avgRelevance >= 0.5 ? 'high'
        : signals.avgRelevance >= 0.2 ? 'medium' : 'low';
    const cov = Math.round(signals.queryTermCoverage * 100);
    return `[Quality: ${signals.sourcesCited} sources, keyword coverage: ${cov}%, relevance: ${rel}, min source: ${signals.minSourceChars} chars]`;
}
/**
 * Synthesize search results into a coherent answer using the local 4B model.
 * Collects highlights/snippets from processed results, sends to 4B for synthesis.
 * Returns formatted text with inline [N] citations, or null to fall through.
 */
async function tryLocalSynthesis(query, results, logger) {
    // Collect source content from highlights/snippets
    const sources = [];
    for (const sType of ['organic', 'topStories']) {
        const items = results[sType];
        if (!items)
            continue;
        for (const item of items) {
            let content = '';
            if (item.highlights?.length) {
                content = item.highlights.map((h) => h.text).join('\n\n');
            }
            else if ('snippet' in item && item.snippet) {
                content = String(item.snippet);
            }
            if (content && item.link) {
                sources.push({
                    title: item.title || '(no title)',
                    url: item.link,
                    content: content.slice(0, 2000),
                });
            }
        }
    }
    if (sources.length === 0)
        return null;
    // Cap sources to keep citations manageable and token budget bounded
    if (sources.length > SYNTH_MAX_SOURCES) {
        sources.length = SYNTH_MAX_SOURCES;
    }
    // Compute quality signals from pipeline data (zero-cost — no inference)
    const quality = computeQualitySignals(query, sources, results);
    const qualityHint = formatQualityHint(quality);
    const sourceText = sources
        .map((s, i) => `[${i + 1}] ${s.title}\n${s.url}\n${s.content}`)
        .join('\n\n---\n\n');
    try {
        const resp = await axios.post(SYNTH_URL, {
            model: 'qwen3.5-4b',
            messages: [
                {
                    role: 'system',
                    content: 'You are a search synthesis engine. Given a query and search results, write a thorough, well-structured answer using the provided sources. Cover all key points and details from the sources — do not summarize too aggressively. Use inline citations [1], [2] etc. Use bold headers and bullet points where appropriate. Stick closely to source material but you may add brief context from your knowledge if clearly relevant. Do not list source URLs at the end — they are injected automatically. Keep it under 600 words.\n\nAfter your answer, on a new line starting with "Flags:", note any of these ONLY if clearly present: "sources disagree" (sources contradict each other on a claim), "single-source claim" (a key claim relies on only one source), "query partially answered" (the query asks for things the sources don\'t cover). If none apply, omit the Flags line entirely.',
                },
                {
                    role: 'user',
                    content: `Query: ${query}\n\nSources:\n${sourceText}\n\nSynthesize a clear answer with [N] citations.`,
                },
            ],
            temperature: 0.3,
            max_tokens: 800,
            stream: false,
            chat_template_kwargs: { enable_thinking: false },
        }, { timeout: SYNTH_TIMEOUT });
        let answer = resp.data?.choices?.[0]?.message?.content?.trim() ?? '';
        // Strip thinking blocks if present (safety net if /no_think is ignored)
        answer = answer.replace(/<think>[\s\S]*?<\/think>\s*/g, '').trim();
        if (answer.length < 50) {
            logger.debug('Local synthesis: answer too short (%d chars), skipping', answer.length);
            return null;
        }
        // Build references matching the [N] citation order given to the 4B
        const references = sources.map((s) => ({
            type: 'link',
            link: s.url,
            title: s.title,
            attribution: '',
        }));
        // Append quality hint + source list so the 122B can assess and cite
        const lines = [answer, '', qualityHint, '', 'Sources:'];
        for (let i = 0; i < sources.length; i++) {
            lines.push(`[${i + 1}] ${sources[i].url}`);
        }
        logger.info('Local synthesis: %d chars from %d sources via 4B | %s', answer.length, sources.length, qualityHint);
        return { text: lines.join('\n'), references };
    }
    catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        logger.warn('Local synthesis failed (%s), using raw results', msg);
        return null;
    }
}
/** Minimum reranker score to keep a highlight */
const RERANKER_MIN_SCORE = 0.05;
/**
 * Cross-result reranking: collect highlights from all sources, rerank against query,
 * apply tiered selection, and reassign filtered highlights back to sources.
 * Drops sources with no surviving highlights and short/empty snippets.
 */
async function crossResultRerank(results, query, reranker, logger) {
    const sourceTypes = ['organic', 'topStories'];
    const allHighlights = [];
    for (const sType of sourceTypes) {
        const sources = results[sType];
        if (!sources)
            continue;
        for (let si = 0; si < sources.length; si++) {
            const s = sources[si];
            if (!s.highlights)
                continue;
            for (let hi = 0; hi < s.highlights.length; hi++) {
                allHighlights.push({
                    text: s.highlights[hi].text,
                    score: s.highlights[hi].score,
                    sourceType: sType,
                    sourceIdx: si,
                    highlightIdx: hi,
                });
            }
        }
    }
    if (allHighlights.length <= 1)
        return;
    try {
        // Rerank all highlights against the query
        const reranked = await reranker.rerank(query, allHighlights.map((h) => h.text), allHighlights.length // get scores for all
        );
        // Map scores back by text match (reranker returns results in relevance
        // order, not original order, so positional mapping would be wrong)
        const scoreMap = new Map(reranked.map((r) => [r.text, r.score]));
        const scored = allHighlights.map((h) => ({
            ...h,
            rerankScore: scoreMap.get(h.text) ?? h.score,
        }));
        // Apply minimum score threshold
        const passing = scored.filter((h) => h.rerankScore >= RERANKER_MIN_SCORE);
        // Tiered selection
        const total = passing.length;
        let keepCount;
        if (total <= 8) {
            keepCount = Math.min(6, total);
        }
        else if (total <= 20) {
            keepCount = Math.ceil(total * 0.6);
        }
        else {
            keepCount = Math.min(12, Math.ceil(total * 0.5));
        }
        // Sort by rerank score descending, take top N
        passing.sort((a, b) => b.rerankScore - a.rerankScore);
        const kept = new Set(passing
            .slice(0, keepCount)
            .map((h) => `${h.sourceType}:${h.sourceIdx}:${h.highlightIdx}`));
        logger.debug(`Cross-result rerank: ${allHighlights.length} highlights → ${kept.size} kept`);
        // Filter highlights in-place on each source
        for (const sType of sourceTypes) {
            const sources = results[sType];
            if (!sources)
                continue;
            for (let si = 0; si < sources.length; si++) {
                const s = sources[si];
                if (!s.highlights)
                    continue;
                s.highlights = s.highlights.filter((_h, hi) => kept.has(`${sType}:${si}:${hi}`));
            }
        }
        // Drop sources with no surviving highlights AND snippet <100 chars
        for (const sType of sourceTypes) {
            const sources = results[sType];
            if (!sources)
                continue;
            results[sType] = sources.filter((s) => {
                if (s.highlights && s.highlights.length > 0)
                    return true;
                const snippet = 'snippet' in s ? s.snippet : undefined;
                return snippet != null && snippet.length >= 100;
            });
        }
    }
    catch (error) {
        logger.error('Cross-result reranking failed, keeping original highlights:', error);
    }
}
/**
 * Executes parallel searches and merges the results
 */
async function executeParallelSearches({ searchAPI, query, date, country, safeSearch, images, videos, news, logger, }) {
    // Prepare all search tasks to run in parallel
    const searchTasks = [
        // Main search
        searchAPI.getSources({
            query,
            date,
            country,
            safeSearch,
        }),
    ];
    if (images) {
        searchTasks.push(searchAPI
            .getSources({
            query,
            date,
            country,
            safeSearch,
            type: 'images',
        })
            .catch((error) => {
            logger.error('Error fetching images:', error);
            return {
                success: false,
                error: `Images search failed: ${error instanceof Error ? error.message : String(error)}`,
            };
        }));
    }
    if (videos) {
        searchTasks.push(searchAPI
            .getSources({
            query,
            date,
            country,
            safeSearch,
            type: 'videos',
        })
            .catch((error) => {
            logger.error('Error fetching videos:', error);
            return {
                success: false,
                error: `Videos search failed: ${error instanceof Error ? error.message : String(error)}`,
            };
        }));
    }
    if (news) {
        searchTasks.push(searchAPI
            .getSources({
            query,
            date,
            country,
            safeSearch,
            type: 'news',
        })
            .catch((error) => {
            logger.error('Error fetching news:', error);
            return {
                success: false,
                error: `News search failed: ${error instanceof Error ? error.message : String(error)}`,
            };
        }));
    }
    // Run all searches in parallel
    const results = await Promise.all(searchTasks);
    // Get the main search result (first result)
    const mainResult = results[0];
    if (!mainResult.success) {
        throw new Error(mainResult.error ?? 'Search failed');
    }
    // Merge additional results with the main results
    const mergedResults = { ...mainResult.data };
    // Convert existing news to topStories if present
    if (mergedResults.news !== undefined && mergedResults.news.length > 0) {
        const existingNewsAsTopStories = mergedResults.news
            .filter((newsItem) => newsItem.link !== undefined && newsItem.link !== '')
            .map((newsItem) => ({
            title: newsItem.title ?? '',
            link: newsItem.link ?? '',
            source: newsItem.source ?? '',
            date: newsItem.date ?? '',
            imageUrl: newsItem.imageUrl ?? '',
            processed: false,
        }));
        mergedResults.topStories = [
            ...(mergedResults.topStories ?? []),
            ...existingNewsAsTopStories,
        ];
        delete mergedResults.news;
    }
    results.slice(1).forEach((result) => {
        if (result.success && result.data !== undefined) {
            if (result.data.images !== undefined && result.data.images.length > 0) {
                mergedResults.images = [
                    ...(mergedResults.images ?? []),
                    ...result.data.images,
                ];
            }
            if (result.data.videos !== undefined && result.data.videos.length > 0) {
                mergedResults.videos = [
                    ...(mergedResults.videos ?? []),
                    ...result.data.videos,
                ];
            }
            if (result.data.news !== undefined && result.data.news.length > 0) {
                const newsAsTopStories = result.data.news.map((newsItem) => ({
                    ...newsItem,
                    link: newsItem.link ?? '',
                }));
                mergedResults.topStories = [
                    ...(mergedResults.topStories ?? []),
                    ...newsAsTopStories,
                ];
            }
        }
    });
    return { success: true, data: mergedResults };
}
function createSearchProcessor({ searchAPI, safeSearch, sourceProcessor, onGetHighlights, reranker, logger, }) {
    return async function ({ query, date, country, proMode = true, maxSources = 3, onSearchResults, images = false, videos = false, news = false, }) {
        try {
            // Execute parallel searches and merge results
            const t0 = Date.now();
            const searchResult = await executeParallelSearches({
                searchAPI,
                query,
                date,
                country,
                safeSearch,
                images,
                videos,
                news,
                logger,
            });
            const tSearch = Date.now();
            onSearchResults?.(searchResult);
            const processedSources = await sourceProcessor.processSources({
                query,
                news,
                result: searchResult,
                proMode,
                onGetHighlights,
                numElements: maxSources,
            });
            const tScrape = Date.now();
            // Cross-result reranking: collect ALL highlights, rerank, apply tiered selection
            if (reranker) {
                await crossResultRerank(processedSources, query, reranker, logger);
            }
            const tRerank = Date.now();
            logger.info('search pipeline: api=%dms scrape+chunk=%dms rerank=%dms total=%dms', tSearch - t0, tScrape - tSearch, tRerank - tScrape, tRerank - t0);
            return expandHighlights(processedSources);
        }
        catch (error) {
            logger.error('Error in search:', error);
            return {
                organic: [],
                topStories: [],
                images: [],
                videos: [],
                news: [],
                relatedSearches: [],
                error: error instanceof Error ? error.message : String(error),
            };
        }
    };
}
function createOnSearchResults({ runnableConfig, onSearchResults, query, }) {
    return function (results) {
        if (!onSearchResults) {
            return;
        }
        if (results.success && results.data) {
            const filtered = filterArtifactResults(results.data, query);
            onSearchResults({ ...results, data: filtered }, runnableConfig);
        }
        else {
            onSearchResults(results, runnableConfig);
        }
    };
}
function createTool({ schema, search, logger, onSearchResults: _onSearchResults, }) {
    return tool(async (rawParams, runnableConfig) => {
        const params = rawParams;
        const { query, date, country: _c, images, videos, news } = params;
        const country = typeof _c === 'string' && _c ? _c : undefined;
        const turn = runnableConfig.toolCall?.turn ?? 0;
        // Full SearXNG → scrape → clean → rerank pipeline (always runs for UI artifact data)
        const tPipelineStart = Date.now();
        const searchResult = await search({
            query,
            date,
            country,
            images,
            videos,
            news,
            onSearchResults: createOnSearchResults({
                runnableConfig,
                onSearchResults: _onSearchResults,
                query,
            }),
        });
        const tPipelineDone = Date.now();
        const formatted = formatResultsForLLM(turn, searchResult);
        // Try local 4B synthesis for text queries (skip for images/videos)
        let output;
        let references;
        if (!images && !videos) {
            const tSynthStart = Date.now();
            const synthesized = await tryLocalSynthesis(query, searchResult, logger);
            const tSynthDone = Date.now();
            if (synthesized) {
                output = synthesized.text;
                references = synthesized.references;
                logger.info('search total: pipeline=%dms synth=%dms total=%dms', tPipelineDone - tPipelineStart, tSynthDone - tSynthStart, tSynthDone - tPipelineStart);
            }
            else {
                output = formatted.output;
                references = formatted.references;
                logger.info('search total: pipeline=%dms synth=skipped total=%dms', tPipelineDone - tPipelineStart, tPipelineDone - tPipelineStart);
            }
        }
        else {
            output = formatted.output;
            references = formatted.references;
            logger.info('search total: pipeline=%dms (no synth) total=%dms', tPipelineDone - tPipelineStart, tPipelineDone - tPipelineStart);
        }
        // Append search counter so the model knows how many searches remain
        const searchNum = turn + 1;
        const remaining = Math.max(0, MAX_SEARCHES - searchNum);
        output += `\n\nSearch ${searchNum}/${MAX_SEARCHES}. ${remaining} remaining.`;
        // Cap total output to keep token budget manageable
        if (output.length > MAX_OUTPUT_CHARS) {
            output = output.slice(0, MAX_OUTPUT_CHARS).trimEnd();
        }
        const filtered = filterArtifactResults(searchResult, query);
        const data = { turn, ...filtered, references };
        return [output, { [Constants.WEB_SEARCH]: data }];
    }, {
        name: WebSearchToolName,
        description: WebSearchToolDescription,
        schema: schema,
        responseFormat: Constants.CONTENT_AND_ARTIFACT,
    });
}
const createSearchTool = (config = {}) => {
    const { searchProvider = 'serper', serperApiKey, searxngInstanceUrl, searxngApiKey, rerankerType = 'cohere', topResults = 5, strategies = ['no_extraction'], filterContent = true, safeSearch = 1, scraperProvider = 'firecrawl', firecrawlApiKey, firecrawlApiUrl, firecrawlVersion, firecrawlOptions, serperScraperOptions, scraperTimeout, jinaApiKey, jinaApiUrl, cohereApiKey, onSearchResults: _onSearchResults, onGetHighlights, } = config;
    const logger = config.logger || createDefaultLogger();
    const schemaProperties = {
        query: querySchema,
        date: dateSchema,
        images: imagesSchema,
        videos: videosSchema,
        news: newsSchema,
    };
    // Country is useful for all providers — SearXNG uses it for language override
    schemaProperties.country = countrySchema;
    const toolSchema = {
        type: 'object',
        properties: schemaProperties,
        required: ['query'],
    };
    const searchAPI = createSearchAPI({
        searchProvider,
        serperApiKey,
        searxngInstanceUrl,
        searxngApiKey,
    });
    /** Create scraper based on scraperProvider */
    let scraperInstance;
    if (scraperProvider === 'serper') {
        scraperInstance = createSerperScraper({
            ...serperScraperOptions,
            apiKey: serperApiKey,
            timeout: scraperTimeout ?? serperScraperOptions?.timeout,
            logger,
        });
    }
    else {
        scraperInstance = createFirecrawlScraper({
            ...firecrawlOptions,
            apiKey: firecrawlApiKey ?? process.env.FIRECRAWL_API_KEY,
            apiUrl: firecrawlApiUrl,
            version: firecrawlVersion,
            timeout: scraperTimeout ?? firecrawlOptions?.timeout,
            formats: firecrawlOptions?.formats ?? ['markdown', 'rawHtml'],
            logger,
        });
    }
    const selectedReranker = createReranker({
        rerankerType,
        jinaApiKey,
        jinaApiUrl,
        cohereApiKey,
        logger,
    });
    if (!selectedReranker) {
        logger.warn('No reranker selected. Using default ranking.');
    }
    const sourceProcessor = createSourceProcessor({
        reranker: selectedReranker,
        topResults,
        logger,
    }, scraperInstance);
    const search = createSearchProcessor({
        searchAPI,
        safeSearch,
        sourceProcessor,
        onGetHighlights,
        reranker: selectedReranker,
        logger,
    });
    return createTool({
        search,
        logger,
        schema: toolSchema,
        onSearchResults: _onSearchResults,
    });
};

export { createSearchTool };
//# sourceMappingURL=tool.mjs.map
