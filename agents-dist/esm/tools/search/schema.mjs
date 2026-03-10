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
const WebSearchToolDescription = `Real-time web search tool. Returns a pre-synthesized summary with inline [1], [2], [3] citations and source URLs.

IMPORTANT RULES:
- You may search up to 3 times per reply. A counter in results tracks usage (e.g. "Search 1/3"). When 0 remain, stop and answer from what you have.
- Each search must target DIFFERENT information. Never repeat or rephrase the same query.
- For FOLLOWUP questions: answer from existing search results first. Only search again if the followup asks about a genuinely different topic.

RESPONSE FORMAT:
- Incorporate the search synthesis naturally into your response, preserving the [N] citation numbers.
- CRITICAL: Inline citations MUST be placed AFTER punctuation (e.g. "prices surged." [1], NOT "prices surged [1].").
- Use markdown formatting (headers, bullet points, bold) for readability.
- If sources conflict, note the disagreement and present both perspectives.

QUERY GUIDELINES:
- Use specific, targeted keywords rather than full sentences.
- For recent/current news, use the date parameter (date="d" for past 24h, date="w" for past week) and/or include the current month and year in the query.
- Set news=true for breaking news or current events topics.
- Set country for location-specific results (local businesses, regional news).`;
const WebSearchToolDefinition = {
    name: WebSearchToolName,
    description: WebSearchToolDescription,
    schema: WebSearchToolSchema,
};

export { DATE_RANGE, DEFAULT_COUNTRY_DESCRIPTION, DEFAULT_QUERY_DESCRIPTION, WebSearchToolDefinition, WebSearchToolDescription, WebSearchToolName, WebSearchToolSchema, countrySchema, dateSchema, imagesSchema, newsSchema, querySchema, videosSchema };
//# sourceMappingURL=schema.mjs.map
