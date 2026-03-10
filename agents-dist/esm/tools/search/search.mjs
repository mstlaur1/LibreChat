import axios from 'axios';
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';
import { createDefaultLogger, getAttribution } from './utils.mjs';

// --- Content cleaning regexes (ported from proxy's noise-stripping pipeline) ---
const RE_DASH_LINES = /^-{3,}\s*$/gm;
const RE_DECORATION = /^[=\-#]{4,}\s*$/gm;
const RE_BROKEN_LINKS = /\]\(\/[^)\n]+\)/g;
const RE_NAV_BULLETS = /^\* \S[^\n]{0,25}$\n?/gm;
const RE_ELEMENTOR = /(?:elementor-action|popup:open|popup:close)[^\s)\]]*/gi;
const RE_LOGO_IMG = /!\[[^\]]*(?:logo|icon|avatar|badge|seal|favicon)[^\]]*\]\([^)]*\)/gi;
const RE_BARE_IMG_URL = /^\s*(?:!\[[^\]]*\]\([^)]*\)|https?:\/\/\S+\.(?:png|jpg|jpeg|gif|svg|webp|ico)(?:\?\S*)?)\s*$/gim;
const RE_CTA_LINES = /^\s*(?:View (?:full )?profile|See all \w+|Sign (?:in|up)|Log in|Follow|Connect|Message|Share|Report|Claim this|Get directions|Write a review|Add a photo|Suggest an edit)\s*$/gim;
const RE_BLANK_RUNS = /\n{3,}/g;
// Breadcrumb / site-search UI noise (e.g. "!Search !SiteName Title" or "1. [Home] 2. [News]")
const RE_BREADCRUMB_NAV = /^\s*(?:\d+\.\s*\[[\w\s]+\]\s*)+\s*$/gm;
const RE_SEARCH_UI = /^\s*!(?:Search|Filter|Sort)\b[^\n]*$/gm;
const RE_SITE_CHROME = /^\s*(?:Type keyword|Enter the terms|Search Enter|Main Content|Skip to (?:main |)content)\b[^\n]*$/gim;
// Translation / language picker links
const RE_TRANSLATION_LINK = /\[Go to the translated (?:article|page|version)\]/gi;
// Comment section detection: date-with-time, "says:", standalone "Reply"
const RE_COMMENT_INDICATOR = /(?:(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4}\s+at\s+\d{1,2}:\d{2}|\b\w+\s+says:\s*$|^\s*Reply\s*$)/gim;
/**
 * Strip comment sections from scraped content.
 * Detects clusters of 3+ comment indicators within 2000 chars,
 * then truncates at the paragraph boundary before the cluster.
 */
function stripCommentSection(content) {
    const indicators = [];
    let match;
    // Reset regex state for each call
    RE_COMMENT_INDICATOR.lastIndex = 0;
    while ((match = RE_COMMENT_INDICATOR.exec(content)) !== null) {
        indicators.push(match.index);
    }
    if (indicators.length < 3)
        return content;
    // Find first cluster: 3+ indicators within 2000 chars
    for (let i = 0; i <= indicators.length - 3; i++) {
        const span = indicators[i + 2] - indicators[i];
        if (span <= 2000) {
            // Truncate at paragraph boundary before this cluster
            const cutpoint = content.lastIndexOf('\n\n', indicators[i]);
            if (cutpoint > content.length * 0.15) {
                return content.slice(0, cutpoint).trimEnd();
            }
            break;
        }
    }
    return content;
}
/**
 * Strip CMS noise, decorative lines, broken links, navigation bullets,
 * bare image URLs, CTA lines, breadcrumbs, and comment sections from
 * scraped markdown content.
 * Called AFTER firecrawl/trafilatura returns content, BEFORE chunking.
 */
function cleanScrapedContent(content) {
    if (!content)
        return '';
    // Strip comment sections first (before line-level regex, needs paragraph structure)
    content = stripCommentSection(content);
    content = content.replace(RE_DASH_LINES, '');
    content = content.replace(RE_DECORATION, '');
    content = content.replace(RE_BROKEN_LINKS, ']');
    content = content.replace(RE_NAV_BULLETS, '');
    content = content.replace(RE_ELEMENTOR, '');
    content = content.replace(RE_LOGO_IMG, '');
    content = content.replace(RE_BARE_IMG_URL, '');
    content = content.replace(RE_CTA_LINES, '');
    content = content.replace(RE_BREADCRUMB_NAV, '');
    content = content.replace(RE_SEARCH_UI, '');
    content = content.replace(RE_SITE_CHROME, '');
    content = content.replace(RE_TRANSLATION_LINK, '');
    content = content.replace(RE_BLANK_RUNS, '\n\n');
    return content.trim();
}
/**
 * Quality gate: reject pages dominated by markdown links or too short+linky.
 * Returns true if content is usable, false if it should be skipped.
 */
function isQualityContent(content) {
    if (!content)
        return false;
    const linkChars = Array.from(content.matchAll(/\[[^\]]*\]\([^)]*\)/g)).reduce((sum, m) => sum + m[0].length, 0);
    const ratio = linkChars / content.length;
    // >50% links → junk (e.g. nav pages, link farms)
    if (ratio > 0.5)
        return false;
    // Short + linky → junk (e.g. sidebar-only pages)
    if (content.length < 300 && ratio > 0.3)
        return false;
    return true;
}
const chunker = {
    cleanText: (text) => {
        if (!text)
            return '';
        /** Normalized all line endings to '\n' */
        const normalizedText = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
        /** Handle multiple backslashes followed by newlines
         * This replaces patterns like '\\\\\\n' with a single newline */
        const fixedBackslashes = normalizedText.replace(/\\+\n/g, '\n');
        /** Cleaned up consecutive newlines, tabs, and spaces around newlines */
        const cleanedNewlines = fixedBackslashes.replace(/[\t ]*\n[\t \n]*/g, '\n');
        /** Cleaned up excessive spaces and tabs */
        const cleanedSpaces = cleanedNewlines.replace(/[ \t]+/g, ' ');
        return cleanedSpaces.trim();
    },
    splitText: async (text, options) => {
        const chunkSize = options?.chunkSize ?? 500;
        const chunkOverlap = options?.chunkOverlap ?? 100;
        const separators = options?.separators || ['\n\n', '\n'];
        const splitter = new RecursiveCharacterTextSplitter({
            separators,
            chunkSize,
            chunkOverlap,
        });
        return await splitter.splitText(text);
    },
    splitTexts: async (texts, options, logger) => {
        // Split multiple texts
        const logger_ = logger || createDefaultLogger();
        const promises = texts.map((text) => chunker.splitText(text, options).catch((error) => {
            logger_.error('Error splitting text:', error);
            return [text];
        }));
        return Promise.all(promises);
    },
};
function createSourceUpdateCallback(sourceMap) {
    return (link, update) => {
        const source = sourceMap.get(link);
        if (source) {
            sourceMap.set(link, {
                ...source,
                ...update,
            });
        }
    };
}
const getHighlights = async ({ query, content, reranker, topResults = 5, logger, }) => {
    const logger_ = logger || createDefaultLogger();
    if (!content) {
        logger_.warn('No content provided for highlights');
        return;
    }
    if (!reranker) {
        logger_.warn('No reranker provided for highlights');
        return;
    }
    try {
        const documents = await chunker.splitText(content);
        if (Array.isArray(documents)) {
            return await reranker.rerank(query, documents, topResults);
        }
        else {
            logger_.error('Expected documents to be an array, got:', typeof documents);
            return;
        }
    }
    catch (error) {
        logger_.error('Error in content processing:', error);
        return;
    }
};
const createSerperAPI = (apiKey) => {
    const config = {
        apiKey: apiKey ?? process.env.SERPER_API_KEY,
        apiUrl: 'https://google.serper.dev/search',
        timeout: 10000,
    };
    if (config.apiKey == null || config.apiKey === '') {
        throw new Error('SERPER_API_KEY is required for SerperAPI');
    }
    const getSources = async ({ query, date, country, safeSearch, numResults = 8, type, }) => {
        if (!query.trim()) {
            return { success: false, error: 'Query cannot be empty' };
        }
        try {
            const safe = ['off', 'moderate', 'active'];
            const payload = {
                q: query,
                safe: safe[safeSearch ?? 1],
                num: Math.min(Math.max(1, numResults), 10),
            };
            // Set the search type if provided
            if (type) {
                payload.type = type;
            }
            if (date != null) {
                payload.tbs = `qdr:${date}`;
            }
            if (country != null && country !== '') {
                payload['gl'] = country.toLowerCase();
            }
            // Determine the API endpoint based on the search type
            let apiEndpoint = config.apiUrl;
            if (type === 'images') {
                apiEndpoint = 'https://google.serper.dev/images';
            }
            else if (type === 'videos') {
                apiEndpoint = 'https://google.serper.dev/videos';
            }
            else if (type === 'news') {
                apiEndpoint = 'https://google.serper.dev/news';
            }
            const response = await axios.post(apiEndpoint, payload, {
                headers: {
                    'X-API-KEY': config.apiKey,
                    'Content-Type': 'application/json',
                },
                timeout: config.timeout,
            });
            const data = response.data;
            const results = {
                organic: data.organic,
                images: data.images ?? [],
                answerBox: data.answerBox,
                topStories: data.topStories ?? [],
                peopleAlsoAsk: data.peopleAlsoAsk,
                knowledgeGraph: data.knowledgeGraph,
                relatedSearches: data.relatedSearches,
                videos: data.videos ?? [],
                news: data.news ?? [],
            };
            return { success: true, data: results };
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            return { success: false, error: `API request failed: ${errorMessage}` };
        }
    };
    return { getSources };
};
const createSearXNGAPI = (instanceUrl, apiKey) => {
    const config = {
        instanceUrl: instanceUrl ?? process.env.SEARXNG_INSTANCE_URL,
        apiKey: apiKey ?? process.env.SEARXNG_API_KEY,
        defaultLocation: 'all',
        timeout: 10000,
    };
    if (config.instanceUrl == null || config.instanceUrl === '') {
        throw new Error('SEARXNG_INSTANCE_URL is required for SearXNG API');
    }
    const getSources = async ({ query, date, country, numResults = 8, safeSearch, type, }) => {
        if (!query.trim()) {
            return { success: false, error: 'Query cannot be empty' };
        }
        try {
            // Ensure the instance URL ends with /search
            if (config.instanceUrl == null || config.instanceUrl === '') {
                return { success: false, error: 'Instance URL is not defined' };
            }
            let searchUrl = config.instanceUrl;
            if (!searchUrl.endsWith('/search')) {
                searchUrl = searchUrl.replace(/\/$/, '') + '/search';
            }
            // Determine the search category based on the type
            let category = 'general';
            if (type === 'images') {
                category = 'images';
            }
            else if (type === 'videos') {
                category = 'videos';
            }
            else if (type === 'news') {
                category = 'news';
            }
            // Map LibreChat date codes (h/d/w/m/y) to SearXNG time_range values
            const dateMap = {
                h: 'day',
                d: 'day',
                w: 'week',
                m: 'month',
                y: 'year',
            };
            // Temporal keyword detection: auto-set time_range for recency queries
            const temporalRe = /\b(today|tonight|latest|breaking|current|this week|this month|right now|just now|yesterday|recent|news)\b/i;
            const rawDate = date || (temporalRe.test(query) ? 'd' : undefined);
            const effectiveDate = rawDate ? dateMap[rawDate] || rawDate : undefined;
            // Prepare parameters for SearXNG
            const params = {
                q: query,
                format: 'json',
                pageno: 1,
                categories: category,
                language: 'en',
                safesearch: safeSearch,
            };
            if (effectiveDate) {
                params.time_range =
                    effectiveDate;
            }
            if (country) {
                params.language = `en-${country.toUpperCase()}`;
            }
            const headers = {
                'Content-Type': 'application/json',
            };
            if (config.apiKey != null && config.apiKey !== '') {
                headers['X-API-Key'] = config.apiKey;
            }
            const response = await axios.get(searchUrl, {
                headers,
                params,
                timeout: config.timeout,
            });
            const data = response.data;
            // Helper function to identify news results since SearXNG doesn't provide that classification by default
            const isNewsResult = (result) => {
                const url = result.url?.toLowerCase() ?? '';
                const title = result.title?.toLowerCase() ?? '';
                // News-related keywords in title/content
                const newsKeywords = [
                    'breaking news',
                    'latest news',
                    'top stories',
                    'news today',
                    'developing story',
                    'trending news',
                    'news',
                ];
                // Check if title/content contains news keywords
                const hasNewsKeywords = newsKeywords.some((keyword) => title.toLowerCase().includes(keyword) // just title probably fine, content parsing is overkill for what we need: || content.includes(keyword)
                );
                // Check if URL contains news-related paths
                const hasNewsPath = url.includes('/news/') ||
                    url.includes('/world/') ||
                    url.includes('/politics/') ||
                    url.includes('/breaking/');
                return hasNewsKeywords || hasNewsPath;
            };
            // Transform SearXNG results to match SerperAPI format
            const organicResults = (data.results ?? [])
                .slice(0, numResults)
                .map((result, index) => {
                let attribution = '';
                try {
                    attribution = new URL(result.url ?? '').hostname;
                }
                catch {
                    attribution = '';
                }
                return {
                    position: index + 1,
                    title: result.title ?? '',
                    link: result.url ?? '',
                    snippet: result.content ?? '',
                    date: result.publishedDate ?? '',
                    attribution,
                };
            });
            const imageResults = (data.results ?? [])
                .filter((result) => result.img_src)
                .slice(0, 6)
                .map((result, index) => ({
                title: result.title ?? '',
                imageUrl: result.img_src ?? '',
                position: index + 1,
                source: new URL(result.url ?? '').hostname,
                domain: new URL(result.url ?? '').hostname,
                link: result.url ?? '',
            }));
            // Extract news results from organic results
            const newsResults = (data.results ?? [])
                .filter(isNewsResult)
                .map((result, index) => {
                let attribution = '';
                try {
                    attribution = new URL(result.url ?? '').hostname;
                }
                catch {
                    attribution = '';
                }
                return {
                    title: result.title ?? '',
                    link: result.url ?? '',
                    snippet: result.content ?? '',
                    date: result.publishedDate ?? '',
                    source: attribution,
                    imageUrl: result.img_src ?? '',
                    position: index + 1,
                };
            });
            const topStories = newsResults.slice(0, 5);
            const relatedSearches = Array.isArray(data.suggestions)
                ? data.suggestions.map((suggestion) => ({ query: suggestion }))
                : [];
            const results = {
                organic: organicResults,
                images: imageResults,
                topStories: topStories, // Use first 5 extracted news as top stories
                relatedSearches,
                videos: [],
                news: newsResults,
                // Add empty arrays for other Serper fields to maintain parity
                places: [],
                shopping: [],
                peopleAlsoAsk: [],
                knowledgeGraph: undefined,
                answerBox: undefined,
            };
            return { success: true, data: results };
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            return {
                success: false,
                error: `SearXNG API request failed: ${errorMessage}`,
            };
        }
    };
    return { getSources };
};
const createSearchAPI = (config) => {
    const { searchProvider = 'serper', serperApiKey, searxngInstanceUrl, searxngApiKey, } = config;
    if (searchProvider.toLowerCase() === 'serper') {
        return createSerperAPI(serperApiKey);
    }
    else if (searchProvider.toLowerCase() === 'searxng') {
        return createSearXNGAPI(searxngInstanceUrl, searxngApiKey);
    }
    else {
        throw new Error(`Invalid search provider: ${searchProvider}. Must be 'serper' or 'searxng'`);
    }
};
const createSourceProcessor = (config = {}, scraperInstance) => {
    if (!scraperInstance) {
        throw new Error('Scraper instance is required');
    }
    const { topResults = 5, 
    // strategies = ['no_extraction'],
    // filterContent = true,
    reranker, logger, } = config;
    const logger_ = logger || createDefaultLogger();
    const scraper = scraperInstance;
    const webScraper = {
        scrapeMany: async ({ query, links, onGetHighlights, }) => {
            logger_.debug(`Scraping ${links.length} links`);
            const promises = [];
            try {
                for (let i = 0; i < links.length; i++) {
                    const currentLink = links[i];
                    const promise = scraper
                        .scrapeUrl(currentLink, {})
                        .then(([url, response]) => {
                        const attribution = getAttribution(url, response.data?.metadata, logger_);
                        if (response.success && response.data) {
                            const [rawContent, references] = scraper.extractContent(response);
                            // Clean CMS noise, then basic whitespace normalization
                            const content = chunker.cleanText(cleanScrapedContent(rawContent));
                            return {
                                url,
                                references,
                                attribution,
                                content,
                            };
                        }
                        else {
                            logger_.error(`Error scraping ${url}: ${response.error ?? 'Unknown error'}`);
                        }
                        return {
                            url,
                            attribution,
                            error: true,
                            content: '',
                        };
                    })
                        .then(async (result) => {
                        try {
                            if (result.error != null) {
                                logger_.error(`Error scraping ${result.url}: ${result.content}`);
                                return {
                                    ...result,
                                };
                            }
                            // Quality gate: skip highlight extraction for junk pages
                            if (!isQualityContent(result.content)) {
                                logger_.debug(`Quality gate rejected: ${result.url} (link-heavy or too short)`);
                                return { ...result };
                            }
                            const highlights = await getHighlights({
                                query,
                                reranker,
                                topResults,
                                content: result.content,
                                logger: logger_,
                            });
                            if (onGetHighlights) {
                                onGetHighlights(result.url);
                            }
                            return {
                                ...result,
                                highlights,
                            };
                        }
                        catch (error) {
                            logger_.error('Error processing scraped content:', error);
                            return {
                                ...result,
                            };
                        }
                    })
                        .catch((error) => {
                        logger_.error(`Error scraping ${currentLink}:`, error);
                        return {
                            url: currentLink,
                            error: true,
                            content: '',
                        };
                    });
                    promises.push(promise);
                }
                return await Promise.all(promises);
            }
            catch (error) {
                logger_.error('Error in scrapeMany:', error);
                return [];
            }
        },
    };
    const fetchContents = async ({ links, query, target, onGetHighlights, onContentScraped, }) => {
        const initialLinks = links.slice(0, target);
        // const remainingLinks = links.slice(target).reverse();
        const results = await webScraper.scrapeMany({
            query,
            links: initialLinks,
            onGetHighlights,
        });
        for (const result of results) {
            if (result.error === true) {
                continue;
            }
            const { url, content, attribution, references, highlights } = result;
            onContentScraped?.(url, {
                content,
                attribution,
                references,
                highlights,
            });
        }
    };
    const processSources = async ({ result, numElements, query, news, proMode = true, onGetHighlights, }) => {
        try {
            if (!result.data) {
                return {
                    organic: [],
                    topStories: [],
                    images: [],
                    relatedSearches: [],
                };
            }
            else if (!result.data.organic) {
                return result.data;
            }
            if (!proMode) {
                const wikiSources = result.data.organic.filter((source) => source.link.includes('wikipedia.org'));
                if (!wikiSources.length) {
                    return result.data;
                }
                const wikiSourceMap = new Map();
                wikiSourceMap.set(wikiSources[0].link, wikiSources[0]);
                const onContentScraped = createSourceUpdateCallback(wikiSourceMap);
                await fetchContents({
                    query,
                    target: 1,
                    onGetHighlights,
                    onContentScraped,
                    links: [wikiSources[0].link],
                });
                for (let i = 0; i < result.data.organic.length; i++) {
                    const source = result.data.organic[i];
                    const updatedSource = wikiSourceMap.get(source.link);
                    if (updatedSource) {
                        result.data.organic[i] = {
                            ...source,
                            ...updatedSource,
                        };
                    }
                }
                return result.data;
            }
            const sourceMap = new Map();
            const organicLinksSet = new Set();
            // Collect organic links
            const organicLinks = collectLinks(result.data.organic, sourceMap, organicLinksSet);
            // Collect top story links, excluding any that are already in organic links
            const topStories = result.data.topStories ?? [];
            const topStoryLinks = collectLinks(topStories, sourceMap, organicLinksSet);
            if (organicLinks.length === 0 && (topStoryLinks.length === 0 || !news)) {
                return result.data;
            }
            const onContentScraped = createSourceUpdateCallback(sourceMap);
            const promises = [];
            // Process organic links
            if (organicLinks.length > 0) {
                promises.push(fetchContents({
                    query,
                    onGetHighlights,
                    onContentScraped,
                    links: organicLinks,
                    target: numElements,
                }));
            }
            // Process top story links
            if (news && topStoryLinks.length > 0) {
                promises.push(fetchContents({
                    query,
                    onGetHighlights,
                    onContentScraped,
                    links: topStoryLinks,
                    target: numElements,
                }));
            }
            await Promise.all(promises);
            if (result.data.organic.length > 0) {
                updateSourcesWithContent(result.data.organic, sourceMap);
            }
            if (news && topStories.length > 0) {
                updateSourcesWithContent(topStories, sourceMap);
            }
            return result.data;
        }
        catch (error) {
            logger_.error('Error in processSources:', error);
            return {
                organic: [],
                topStories: [],
                images: [],
                relatedSearches: [],
                ...result.data,
                error: error instanceof Error ? error.message : String(error),
            };
        }
    };
    return {
        processSources,
        topResults,
    };
};
/** Helper function to collect links and update sourceMap */
function collectLinks(sources, sourceMap, existingLinksSet) {
    const links = [];
    for (const source of sources) {
        if (source.link) {
            // For topStories, only add if not already in organic links
            if (existingLinksSet && existingLinksSet.has(source.link)) {
                continue;
            }
            links.push(source.link);
            if (existingLinksSet) {
                existingLinksSet.add(source.link);
            }
            sourceMap.set(source.link, source);
        }
    }
    return links;
}
/** Helper function to update sources with scraped content */
function updateSourcesWithContent(sources, sourceMap) {
    for (let i = 0; i < sources.length; i++) {
        const source = sources[i];
        const updatedSource = sourceMap.get(source.link);
        if (updatedSource) {
            sources[i] = {
                ...source,
                ...updatedSource,
            };
        }
    }
}

export { cleanScrapedContent, createSearchAPI, createSourceProcessor, isQualityContent };
//# sourceMappingURL=search.mjs.map
