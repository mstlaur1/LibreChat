'use strict';

exports.DATE_RANGE = void 0;
(function (DATE_RANGE) {
    DATE_RANGE["PAST_HOUR"] = "h";
    DATE_RANGE["PAST_24_HOURS"] = "d";
    DATE_RANGE["PAST_WEEK"] = "w";
    DATE_RANGE["PAST_MONTH"] = "m";
    DATE_RANGE["PAST_YEAR"] = "y";
})(exports.DATE_RANGE || (exports.DATE_RANGE = {}));
const DEFAULT_QUERY_DESCRIPTION = 'Search query. Use concise keywords, not full sentences.';
const DEFAULT_COUNTRY_DESCRIPTION = '2-letter country code (e.g. "us", "ca", "de").';
const querySchema = {
    type: 'string',
    description: DEFAULT_QUERY_DESCRIPTION,
};
const dateSchema = {
    type: 'string',
    enum: Object.values(exports.DATE_RANGE),
    description: 'Date range for search results.',
};
const countrySchema = {
    type: 'string',
    description: DEFAULT_COUNTRY_DESCRIPTION,
};
const imagesSchema = {
    type: 'boolean',
    description: 'Whether to also run an image search.',
};
const videosSchema = {
    type: 'boolean',
    description: 'Whether to also run a video search.',
};
const newsSchema = {
    type: 'boolean',
    description: 'Whether to also run a news search.',
};
/** Combined web search tool schema with all properties */
const WebSearchToolSchema = {
    type: 'object',
    properties: {
        query: querySchema,
        date: dateSchema,
        country: countrySchema,
        images: imagesSchema,
        videos: videosSchema,
        news: newsSchema,
    },
    required: ['query'],
};
const WebSearchToolName = 'web_search';
const WebSearchToolDescription = `Real-time web search. Results contain numbered sources with [N] citation markers.

**CITE EVERY FACT FROM SEARCH RESULTS:**
Use the [N] source numbers provided in the results. Every claim derived from search MUST have a citation.
- Single: "The population grew 12% [1]."
- Multiple: "Both studies confirmed the trend [1] [3]."
- Conflicting: "Source A says X [1], but Source B disagrees [3]."

**NEVER** omit citations, renumber sources, or use markdown links instead of [N] markers.

SEARCH RULES:
- Up to 3 searches per reply. A counter tracks usage (e.g. "Search 1/3"). When 0 remain, stop and answer.
- Each search must target DIFFERENT information. Never repeat or rephrase the same query.
- For followups: answer from existing results first. Only search again for genuinely different topics.

QUERY TIPS:
- Use concise keywords, not full sentences.
- For recent news: use date="d" (24h) or date="w" (week), and/or include current month/year in query.
- Set news=true for breaking news or current events.
- Set country for location-specific results.`;
const WebSearchToolDefinition = {
    name: WebSearchToolName,
    description: WebSearchToolDescription,
    schema: WebSearchToolSchema,
};

exports.DEFAULT_COUNTRY_DESCRIPTION = DEFAULT_COUNTRY_DESCRIPTION;
exports.DEFAULT_QUERY_DESCRIPTION = DEFAULT_QUERY_DESCRIPTION;
exports.WebSearchToolDefinition = WebSearchToolDefinition;
exports.WebSearchToolDescription = WebSearchToolDescription;
exports.WebSearchToolName = WebSearchToolName;
exports.WebSearchToolSchema = WebSearchToolSchema;
exports.countrySchema = countrySchema;
exports.dateSchema = dateSchema;
exports.imagesSchema = imagesSchema;
exports.newsSchema = newsSchema;
exports.querySchema = querySchema;
exports.videosSchema = videosSchema;
//# sourceMappingURL=schema.cjs.map
