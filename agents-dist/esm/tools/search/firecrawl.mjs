import axios from 'axios';
import { processContent } from './content.mjs';
import { createDefaultLogger } from './utils.mjs';

/**
 * Firecrawl scraper implementation
 * Uses the Firecrawl API to scrape web pages
 */
class FirecrawlScraper {
    apiKey;
    apiUrl;
    version;
    defaultFormats;
    timeout;
    logger;
    includeTags;
    excludeTags;
    waitFor;
    maxAge;
    mobile;
    skipTlsVerification;
    blockAds;
    removeBase64Images;
    parsePDF;
    storeInCache;
    zeroDataRetention;
    headers;
    location;
    onlyMainContent;
    changeTrackingOptions;
    constructor(config = {}) {
        this.apiKey = config.apiKey ?? process.env.FIRECRAWL_API_KEY ?? '';
        this.version = config.version ?? 'v2';
        const baseUrl = config.apiUrl ??
            process.env.FIRECRAWL_BASE_URL ??
            'https://api.firecrawl.dev';
        this.apiUrl = `${baseUrl.replace(/\/+$/, '')}/${this.version}/scrape`;
        this.defaultFormats = config.formats ?? ['markdown', 'rawHtml'];
        this.timeout = config.timeout ?? 7500;
        this.logger = config.logger || createDefaultLogger();
        this.includeTags = config.includeTags;
        this.excludeTags = config.excludeTags;
        this.waitFor = config.waitFor;
        this.maxAge = config.maxAge;
        this.mobile = config.mobile;
        this.skipTlsVerification = config.skipTlsVerification;
        this.blockAds = config.blockAds;
        this.removeBase64Images = config.removeBase64Images;
        this.parsePDF = config.parsePDF;
        this.storeInCache = config.storeInCache;
        this.zeroDataRetention = config.zeroDataRetention;
        this.headers = config.headers;
        this.location = config.location;
        this.onlyMainContent = config.onlyMainContent;
        this.changeTrackingOptions = config.changeTrackingOptions;
        if (!this.apiKey) {
            this.logger.warn('FIRECRAWL_API_KEY is not set. Scraping will not work.');
        }
        this.logger.debug(`Firecrawl scraper initialized with API URL: ${this.apiUrl}`);
    }
    /**
     * Scrape a single URL
     * @param url URL to scrape
     * @param options Scrape options
     * @returns Scrape response
     */
    async scrapeUrl(url, options = {}) {
        if (!this.apiKey) {
            return [
                url,
                {
                    success: false,
                    error: 'FIRECRAWL_API_KEY is not set',
                },
            ];
        }
        try {
            const payload = omitUndefined({
                url,
                formats: options.formats ?? this.defaultFormats,
                includeTags: options.includeTags ?? this.includeTags,
                excludeTags: options.excludeTags ?? this.excludeTags,
                headers: options.headers ?? this.headers,
                waitFor: options.waitFor ?? this.waitFor,
                timeout: options.timeout ?? this.timeout,
                onlyMainContent: options.onlyMainContent ?? this.onlyMainContent,
                maxAge: options.maxAge ?? this.maxAge,
                mobile: options.mobile ?? this.mobile,
                skipTlsVerification: options.skipTlsVerification ?? this.skipTlsVerification,
                parsePDF: options.parsePDF ?? this.parsePDF,
                location: options.location ?? this.location,
                removeBase64Images: options.removeBase64Images ?? this.removeBase64Images,
                blockAds: options.blockAds ?? this.blockAds,
                storeInCache: options.storeInCache ?? this.storeInCache,
                zeroDataRetention: options.zeroDataRetention ?? this.zeroDataRetention,
                changeTrackingOptions: options.changeTrackingOptions ?? this.changeTrackingOptions,
            });
            const response = await axios.post(this.apiUrl, payload, {
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${this.apiKey}`,
                },
                timeout: this.timeout,
            });
            return [url, response.data];
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            return [
                url,
                {
                    success: false,
                    error: `Firecrawl API request failed: ${errorMessage}`,
                },
            ];
        }
    }
    /**
     * Extract content from scrape response
     * @param response Scrape response
     * @returns Extracted content or empty string if not available
     */
    extractContent(response) {
        if (!response.success || !response.data) {
            return ['', undefined];
        }
        if (response.data.markdown != null && response.data.html != null) {
            try {
                const { markdown, ...rest } = processContent(response.data.html, response.data.markdown);
                return [markdown, rest];
            }
            catch (error) {
                this.logger.error('Error processing content:', error);
                return [response.data.markdown, undefined];
            }
        }
        else if (response.data.markdown != null) {
            return [response.data.markdown, undefined];
        }
        // Fall back to HTML content
        if (response.data.html != null) {
            return [response.data.html, undefined];
        }
        // Fall back to raw HTML content
        if (response.data.rawHtml != null) {
            return [response.data.rawHtml, undefined];
        }
        return ['', undefined];
    }
    /**
     * Extract metadata from scrape response
     * @param response Scrape response
     * @returns Metadata object
     */
    extractMetadata(response) {
        if (!response.success || !response.data || !response.data.metadata) {
            return {};
        }
        return response.data.metadata;
    }
}
/**
 * Create a Firecrawl scraper instance
 * @param config Scraper configuration
 * @returns Firecrawl scraper instance
 */
const createFirecrawlScraper = (config = {}) => {
    return new FirecrawlScraper(config);
};
// Helper function to clean up payload for firecrawl
function omitUndefined(obj) {
    return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));
}

export { FirecrawlScraper, createFirecrawlScraper };
//# sourceMappingURL=firecrawl.mjs.map
