import { getAttribution } from './utils.mjs';

/**
 * Coerces Anthropic web search results to the SearchResultData format
 * @param results - Array of Anthropic web search results
 * @param turn - The turn number to associate with these results
 * @returns SearchResultData with minimal ProcessedOrganic items
 */
function coerceAnthropicSearchResults({ results, turn = 0, }) {
    const organic = results
        .filter((result) => result.type === 'web_search_result')
        .map((result, index) => ({
        link: result.url,
        position: index + 1,
        title: result.title,
        date: result.page_age ?? undefined,
        attribution: getAttribution(result.url),
    }));
    return {
        turn,
        organic,
    };
}
/**
 * Helper function to check if an object is an Anthropic web search result
 */
function isAnthropicWebSearchResult(obj) {
    return (typeof obj === 'object' &&
        obj !== null &&
        'type' in obj &&
        obj.type === 'web_search_result' &&
        'url' in obj &&
        typeof obj.url === 'string');
}

export { coerceAnthropicSearchResults, isAnthropicWebSearchResult };
//# sourceMappingURL=anthropic.mjs.map
