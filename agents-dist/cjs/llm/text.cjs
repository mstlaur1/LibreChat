'use strict';

class TextStream {
    text;
    currentIndex;
    minChunkSize;
    maxChunkSize;
    delay;
    firstWordChunk;
    constructor(text, options = {}) {
        this.text = text;
        this.currentIndex = 0;
        this.minChunkSize = options.minChunkSize ?? 4;
        this.maxChunkSize = options.maxChunkSize ?? 8;
        this.delay = options.delay ?? 20;
        this.firstWordChunk = options.firstWordChunk ?? true;
    }
    randomInt(min, max) {
        return Math.floor(Math.random() * (max - min)) + min;
    }
    static BOUNDARIES = new Set([
        ' ',
        '.',
        ',',
        '!',
        '?',
        ';',
        ':',
    ]);
    findFirstWordBoundary(text, minSize) {
        if (minSize >= text.length)
            return text.length;
        // Ensure we meet the minimum size first
        let pos = minSize;
        // Look forward until we find a boundary
        while (pos < text.length) {
            if (TextStream.BOUNDARIES.has(text[pos])) {
                return pos + 1; // Include the boundary character
            }
            pos++;
        }
        return text.length; // If no boundary found, return entire remaining text
    }
    async *generateText(signal, progressCallback) {
        const { delay, minChunkSize, maxChunkSize } = this;
        while (this.currentIndex < this.text.length) {
            if (signal?.aborted === true) {
                break;
            }
            await new Promise((resolve) => setTimeout(resolve, delay));
            const remainingText = this.text.slice(this.currentIndex);
            let chunkSize;
            if (this.firstWordChunk) {
                chunkSize = this.findFirstWordBoundary(remainingText, minChunkSize);
            }
            else {
                const remainingChars = remainingText.length;
                chunkSize = Math.min(this.randomInt(minChunkSize, maxChunkSize + 1), remainingChars);
            }
            const chunk = this.text.slice(this.currentIndex, this.currentIndex + chunkSize);
            progressCallback?.(chunk);
            yield chunk;
            this.currentIndex += chunkSize;
        }
    }
}

exports.TextStream = TextStream;
//# sourceMappingURL=text.cjs.map
