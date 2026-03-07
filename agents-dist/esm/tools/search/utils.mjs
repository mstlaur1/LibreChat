/* eslint-disable no-console */
/**
 * Singleton instance of the default logger
 */
let defaultLoggerInstance = null;
/**
 * Creates a default logger that maps to console methods
 * Uses a singleton pattern to avoid creating multiple instances
 * @returns A default logger that implements the Logger interface
 */
const createDefaultLogger = () => {
    if (!defaultLoggerInstance) {
        defaultLoggerInstance = {
            error: console.error,
            warn: console.warn,
            info: console.info,
            debug: console.debug,
        };
    }
    return defaultLoggerInstance;
};
const getDomainName = (link, metadata, logger) => {
    try {
        const url = metadata?.sourceURL ?? metadata?.url ?? (link || '');
        const domain = new URL(url).hostname.replace(/^www\./, '');
        if (domain) {
            return domain;
        }
    }
    catch (e) {
        // URL parsing failed
        if (logger) {
            logger.error('Error parsing URL:', e);
        }
        else {
            console.error('Error parsing URL:', e);
        }
    }
    return;
};
function getAttribution(link, metadata, logger) {
    if (!metadata)
        return getDomainName(link, metadata, logger);
    const twitterSite = metadata['twitter:site'];
    const twitterSiteFormatted = typeof twitterSite === 'string' ? twitterSite.replace(/^@/, '') : undefined;
    const possibleAttributions = [
        metadata.ogSiteName,
        metadata['og:site_name'],
        metadata.title?.split('|').pop()?.trim(),
        twitterSiteFormatted,
    ];
    const attribution = possibleAttributions.find((attr) => attr != null && typeof attr === 'string' && attr.trim() !== '');
    if (attribution != null) {
        return attribution;
    }
    return getDomainName(link, metadata, logger);
}

export { createDefaultLogger, getAttribution, getDomainName };
//# sourceMappingURL=utils.mjs.map
