var DATE_RANGE;
(function (DATE_RANGE) {
    DATE_RANGE["PAST_HOUR"] = "h";
    DATE_RANGE["PAST_24_HOURS"] = "d";
    DATE_RANGE["PAST_WEEK"] = "w";
    DATE_RANGE["PAST_MONTH"] = "m";
    DATE_RANGE["PAST_YEAR"] = "y";
})(DATE_RANGE || (DATE_RANGE = {}));
const DEFAULT_QUERY_DESCRIPTION = 'Search query. Use concise keywords, not full sentences.';
const DEFAULT_COUNTRY_DESCRIPTION = '2-letter country code (e.g. "us", "ca", "de").';
const querySchema = {
    type: 'string',
    description: DEFAULT_QUERY_DESCRIPTION,
};
const dateSchema = {
    type: 'string',
    enum: Object.values(DATE_RANGE),
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
const WebSearchToolDescription = `Real-time web search. Returns numbered [N] sources. Max 3 per reply (counter shown).
TIPS: Concise keywords. date="d"/"w" for recency. news=true for breaking news. country for locale.`;
const WebSearchToolDefinition = {
    name: WebSearchToolName,
    description: WebSearchToolDescription,
    schema: WebSearchToolSchema,
};

export { DATE_RANGE, DEFAULT_COUNTRY_DESCRIPTION, DEFAULT_QUERY_DESCRIPTION, WebSearchToolDefinition, WebSearchToolDescription, WebSearchToolName, WebSearchToolSchema, countrySchema, dateSchema, imagesSchema, newsSchema, querySchema, videosSchema };
//# sourceMappingURL=schema.mjs.map
