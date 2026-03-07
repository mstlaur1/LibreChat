'use strict';

var tools = require('@langchain/core/tools');
var schema = require('./schema.cjs');
var search = require('./search.cjs');
var serperScraper = require('./serper-scraper.cjs');
var firecrawl = require('./firecrawl.cjs');
var highlights = require('./highlights.cjs');
var format = require('./format.cjs');
var utils = require('./utils.cjs');
var rerankers = require('./rerankers.cjs');
var _enum = require('../../common/enum.cjs');

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
function createSearchProcessor({ searchAPI, safeSearch, sourceProcessor, onGetHighlights, logger, }) {
    return async function ({ query, date, country, proMode = true, maxSources = 3, onSearchResults, images = false, videos = false, news = false, }) {
        try {
            // Execute parallel searches and merge results
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
            onSearchResults?.(searchResult);
            const processedSources = await sourceProcessor.processSources({
                query,
                news,
                result: searchResult,
                proMode,
                onGetHighlights,
                numElements: maxSources,
            });
            return highlights.expandHighlights(processedSources);
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
            const filtered = format.filterArtifactResults(results.data, query);
            onSearchResults({ ...results, data: filtered }, runnableConfig);
        }
        else {
            onSearchResults(results, runnableConfig);
        }
    };
}
function createTool({ schema: schema$1, search, onSearchResults: _onSearchResults, }) {
    return tools.tool(async (rawParams, runnableConfig) => {
        const params = rawParams;
        const { query, date, country: _c, images, videos, news } = params;
        const country = typeof _c === 'string' && _c ? _c : undefined;
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
        const turn = runnableConfig.toolCall?.turn ?? 0;
        const { output, references } = format.formatResultsForLLM(turn, searchResult);
        const filtered = format.filterArtifactResults(searchResult, query);
        const data = { turn, ...filtered, references };
        return [output, { [_enum.Constants.WEB_SEARCH]: data }];
    }, {
        name: schema.WebSearchToolName,
        description: schema.WebSearchToolDescription,
        schema: schema$1,
        responseFormat: _enum.Constants.CONTENT_AND_ARTIFACT,
    });
}
const createSearchTool = (config = {}) => {
    const { searchProvider = 'serper', serperApiKey, searxngInstanceUrl, searxngApiKey, rerankerType = 'cohere', topResults = 5, strategies = ['no_extraction'], filterContent = true, safeSearch = 1, scraperProvider = 'firecrawl', firecrawlApiKey, firecrawlApiUrl, firecrawlVersion, firecrawlOptions, serperScraperOptions, scraperTimeout, jinaApiKey, jinaApiUrl, cohereApiKey, onSearchResults: _onSearchResults, onGetHighlights, } = config;
    const logger = config.logger || utils.createDefaultLogger();
    const schemaProperties = {
        query: schema.querySchema,
        date: schema.dateSchema,
        images: schema.imagesSchema,
        videos: schema.videosSchema,
        news: schema.newsSchema,
    };
    // Country is useful for all providers — SearXNG uses it for language override
    schemaProperties.country = schema.countrySchema;
    const toolSchema = {
        type: 'object',
        properties: schemaProperties,
        required: ['query'],
    };
    const searchAPI = search.createSearchAPI({
        searchProvider,
        serperApiKey,
        searxngInstanceUrl,
        searxngApiKey,
    });
    /** Create scraper based on scraperProvider */
    let scraperInstance;
    if (scraperProvider === 'serper') {
        scraperInstance = serperScraper.createSerperScraper({
            ...serperScraperOptions,
            apiKey: serperApiKey,
            timeout: scraperTimeout ?? serperScraperOptions?.timeout,
            logger,
        });
    }
    else {
        scraperInstance = firecrawl.createFirecrawlScraper({
            ...firecrawlOptions,
            apiKey: firecrawlApiKey ?? process.env.FIRECRAWL_API_KEY,
            apiUrl: firecrawlApiUrl,
            version: firecrawlVersion,
            timeout: scraperTimeout ?? firecrawlOptions?.timeout,
            formats: firecrawlOptions?.formats ?? ['markdown', 'rawHtml'],
            logger,
        });
    }
    const selectedReranker = rerankers.createReranker({
        rerankerType,
        jinaApiKey,
        jinaApiUrl,
        cohereApiKey,
        logger,
    });
    if (!selectedReranker) {
        logger.warn('No reranker selected. Using default ranking.');
    }
    const sourceProcessor = search.createSourceProcessor({
        reranker: selectedReranker,
        topResults,
        logger,
    }, scraperInstance);
    const search$1 = createSearchProcessor({
        searchAPI,
        safeSearch,
        sourceProcessor,
        onGetHighlights,
        logger,
    });
    return createTool({
        search: search$1,
        schema: toolSchema,
        onSearchResults: _onSearchResults,
    });
};

exports.createSearchTool = createSearchTool;
//# sourceMappingURL=tool.cjs.map
