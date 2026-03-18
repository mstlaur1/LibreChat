/** Non-Latin script ranges: CJK, Hiragana, Katakana, Hangul, Cyrillic, Arabic */
const NON_LATIN_RE = /[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af\u0400-\u04ff\u0600-\u06ff]/;
/** Domains that return noise instead of useful content */
const JUNK_DOMAINS = new Set([
    'islamicfinder.org',
    'shopch.jp',
    'shopee.com',
    'shop.app',
    'ejje.weblio.jp',
    'bestbuy.com',
    'bestbuy.ca',
    'dafont.com',
    'dictionary.com',
    'thesaurus.com',
    'merriam-webster.com',
    'wiktionary.org',
    'ell.stackexchange.com',
    'english.stackexchange.com',
    'biblegateway.com',
    'biblia.com',
    'openbible.info',
    'bible.com',
]);
function isJunkResult(title, link) {
    if (title && NON_LATIN_RE.test(title))
        return true;
    if (link) {
        try {
            const domain = new URL(link).hostname.replace(/^www\./, '');
            if (JUNK_DOMAINS.has(domain))
                return true;
        }
        catch {
            // invalid URL, not junk
        }
    }
    return false;
}
/**
 * Score a result's relevance to the query via keyword overlap.
 * Returns 0–1 where 1 = all query keywords found in title+snippet.
 */
function relevanceScore(query, title, snippet) {
    const keywords = query
        .toLowerCase()
        .split(/\s+/)
        .filter((w) => w.length > 2);
    if (keywords.length === 0)
        return 1;
    const text = `${title ?? ''} ${snippet ?? ''}`.toLowerCase();
    const hits = keywords.filter((kw) => text.includes(kw)).length;
    // Require at least 2 keyword hits when query has 3+ keywords.
    // A single common word match (e.g. "Mark" from "Mark Carney") is not enough.
    if (keywords.length >= 3 && hits < 2)
        return 0;
    return hits / keywords.length;
}
function rankAndFilter(items, query, minScore = 0.3) {
    if (!items?.length)
        return items;
    const scored = items
        .filter((r) => !isJunkResult(r.title, r.link))
        .map((r) => {
        const snippet = 'snippet' in r ? r.snippet : undefined;
        const source = 'source' in r ? r.source : undefined;
        return {
            result: r,
            score: relevanceScore(query, r.title, snippet ?? source),
        };
    })
        .filter((s) => s.score >= minScore);
    scored.sort((a, b) => b.score - a.score);
    return scored.map((s) => s.result);
}
/**
 * Filter and rank artifact data by relevance before it reaches the UI.
 * Removes non-Latin titles, junk domains, linkless results, and sorts by
 * keyword relevance to the search query.
 */
function filterArtifactResults(results, query) {
    return {
        ...results,
        organic: rankAndFilter(results.organic, query),
        topStories: rankAndFilter(results.topStories, query, 0.2),
        news: rankAndFilter(results.news, query, 0.2),
    };
}
/** Max chars of highlight text to keep per source */
const HIGHLIGHT_MAX_CHARS = 3000;
/**
 * Strip markdown images, link markup, raw URLs, and formatting noise
 * from highlight text so the LLM sees only readable content.
 */
function cleanHighlightText(text) {
    if (!text)
        return '';
    return text
        .replace(/!\[[^\]]*\]\([^)]*\)/g, '') // markdown images
        .replace(/!\[[^\]]*\]\s*/g, '') // orphaned ![alt text] remnants
        .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // links → text only
        .replace(/https?:\/\/\S+/g, '') // raw URLs
        .replace(/[*_]{2,}/g, '') // bold/italic artifacts
        .replace(/\\([-[\]()])/g, '$1') // escaped chars: \- → -, \[ → [
        .replace(/^\s*\|[\s-|]+\|\s*$/gm, '') // table separators: | --- | --- |
        .replace(/ {2,}/g, ' ') // collapse spaces
        .replace(/\n{3,}/g, '\n\n') // collapse newlines
        .trim();
}
/**
 * Deduplicate highlights within a single source by checking prefix overlap.
 * Keeps the higher-scored highlight when two share >60% of their first 200 chars.
 */
function deduplicateHighlights(highlights) {
    if (highlights.length <= 1)
        return highlights;
    // Sort by score descending so we keep higher-scored ones
    const sorted = [...highlights].sort((a, b) => b.score - a.score);
    const kept = [];
    const seenPrefixes = [];
    for (const h of sorted) {
        const prefix = h.text.slice(0, 200).toLowerCase();
        const isDupe = seenPrefixes.some((existing) => {
            // Check overlap: count matching chars in first 200
            const shorter = Math.min(prefix.length, existing.length);
            if (shorter === 0)
                return false;
            let matches = 0;
            for (let i = 0; i < shorter; i++) {
                if (prefix[i] === existing[i])
                    matches++;
            }
            return matches / shorter > 0.6;
        });
        if (!isDupe) {
            kept.push(h);
            seenPrefixes.push(prefix);
        }
    }
    return kept;
}
/**
 * Extract year from a date string. Handles ISO dates, relative dates,
 * and common formats like "Jan 15, 2025" or "2025-01-15".
 */
function extractYear(dateStr) {
    if (!dateStr)
        return null;
    const m = dateStr.match(/\b(20\d{2})\b/);
    return m ? parseInt(m[1], 10) : null;
}
/**
 * Build a preamble summarizing result counts and date range.
 */
function buildPreamble(results) {
    const parts = [];
    const nOrganic = results.organic?.length ?? 0;
    const nNews = results.topStories?.length ?? 0;
    const nVideos = results.videos?.length ?? 0;
    const counts = [];
    if (nOrganic > 0)
        counts.push(`${nOrganic} source${nOrganic > 1 ? 's' : ''}`);
    if (nNews > 0)
        counts.push(`${nNews} news`);
    if (nVideos > 0)
        counts.push(`${nVideos} video${nVideos > 1 ? 's' : ''}`);
    if (counts.length > 0)
        parts.push(counts.join(', '));
    // Compute date range across all results
    const years = [];
    for (const s of results.organic ?? []) {
        const y = extractYear(s.date);
        if (y)
            years.push(y);
    }
    for (const s of results.topStories ?? []) {
        const y = extractYear(s.date);
        if (y)
            years.push(y);
    }
    let dateHint = '';
    if (years.length > 0) {
        const minY = Math.min(...years);
        const maxY = Math.max(...years);
        parts.push(minY === maxY ? `dates: ${minY}` : `dates: ${minY}–${maxY}`);
        if (maxY - minY >= 2) {
            dateHint =
                '\nNote: results span multiple years. If the user needs recent info, suggest they ask again with a narrower time range (e.g. past week or month).';
        }
    }
    const summary = parts.length > 0 ? `(${parts.join(' | ')})` : '';
    return summary + dateHint;
}
/**
 * Format search results for LLM consumption.
 * Outputs clean [Source N] / [News N] blocks with URL, attribution, date,
 * and content highlights. No PUA Unicode citation anchors.
 */
function formatResultsForLLM(_turn, results) {
    const outputLines = [];
    const references = [];
    // Preamble with counts and date range
    const preamble = buildPreamble(results);
    if (preamble) {
        outputLines.push(preamble);
        outputLines.push('');
    }
    // Global sequential counter so citations [1],[2],[3] match reference order
    let sourceNum = 0;
    const formatSources = (sources) => {
        if (!sources?.length)
            return;
        for (let i = 0; i < sources.length; i++) {
            const s = sources[i];
            sourceNum++;
            outputLines.push(`[${sourceNum}] ${s.title || '(no title)'}`);
            outputLines.push(s.link);
            const meta = [s.attribution, s.date].filter(Boolean).join(' | ');
            if (meta)
                outputLines.push(meta);
            outputLines.push('');
            if (s.highlights?.length) {
                const deduped = deduplicateHighlights(s.highlights);
                let charBudget = HIGHLIGHT_MAX_CHARS;
                for (const h of deduped) {
                    const text = cleanHighlightText(h.text);
                    if (text && charBudget > 0) {
                        const trimmed = text.slice(0, charBudget);
                        outputLines.push(trimmed);
                        outputLines.push('');
                        charBudget -= trimmed.length;
                    }
                }
            }
            else if ('snippet' in s && s.snippet) {
                outputLines.push(s.snippet);
                outputLines.push('');
            }
            if (s.link) {
                references.push({
                    type: 'link',
                    link: s.link,
                    attribution: s.attribution || '',
                    title: s.title || '',
                });
            }
            outputLines.push('---');
            outputLines.push('');
        }
    };
    formatSources(results.organic);
    formatSources(results.topStories);
    // Format video results with metadata (duration, date, channel)
    if (results.videos?.length) {
        for (let i = 0; i < results.videos.length; i++) {
            const v = results.videos[i];
            outputLines.push(`[Video ${i + 1}] ${v.title || '(no title)'}`);
            if (v.link)
                outputLines.push(v.link);
            const vMeta = [v.channel, v.duration, v.date].filter(Boolean).join(' | ');
            if (vMeta)
                outputLines.push(vMeta);
            if (v.snippet) {
                outputLines.push('');
                outputLines.push(v.snippet);
            }
            outputLines.push('');
            outputLines.push('---');
            outputLines.push('');
            if (v.link) {
                references.push({
                    type: 'video',
                    link: v.link,
                    title: v.title || '',
                });
            }
        }
    }
    // Citation instruction so the model produces [1],[2] refs the proxy can map
    if (sourceNum > 0) {
        outputLines.push('Cite sources inline as [1], [2], etc. in your response.');
    }
    return {
        output: outputLines.join('\n').trim(),
        references,
    };
}

export { cleanHighlightText, deduplicateHighlights, filterArtifactResults, formatResultsForLLM };
//# sourceMappingURL=format.mjs.map
