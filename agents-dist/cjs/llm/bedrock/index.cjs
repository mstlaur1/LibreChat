'use strict';

var aws = require('@langchain/aws');
var clientBedrockRuntime = require('@aws-sdk/client-bedrock-runtime');
var messages = require('@langchain/core/messages');
var outputs = require('@langchain/core/outputs');
var message_inputs = require('./utils/message_inputs.cjs');
var message_outputs = require('./utils/message_outputs.cjs');

/**
 * Optimized ChatBedrockConverse wrapper that fixes content block merging for
 * streaming responses and adds support for latest @langchain/aws features:
 *
 * - Application Inference Profiles (PR #9129)
 * - Service Tiers (Priority/Standard/Flex) (PR #9785) - requires AWS SDK 3.966.0+
 *
 * Bedrock's `@langchain/aws` library does not include an `index` property on content
 * blocks (unlike Anthropic/OpenAI), which causes LangChain's `_mergeLists` to append
 * each streaming chunk as a separate array entry instead of merging by index.
 *
 * This wrapper takes full ownership of the stream by directly interfacing with the
 * AWS SDK client (`this.client`) and using custom handlers from `./utils/` that
 * include `contentBlockIndex` in response_metadata for every delta type. It then
 * promotes `contentBlockIndex` to an `index` property on each content block
 * (mirroring Anthropic's pattern) and strips it from metadata to avoid
 * `_mergeDicts` conflicts.
 *
 * When multiple content block types are present (e.g. reasoning + text), text deltas
 * are promoted from strings to array form with `index` so they merge correctly once
 * the accumulated content is already an array.
 */
class CustomChatBedrockConverse extends aws.ChatBedrockConverse {
    /**
     * Application Inference Profile ARN to use instead of model ID.
     */
    applicationInferenceProfile;
    /**
     * Service tier for model invocation.
     */
    serviceTier;
    constructor(fields) {
        super(fields);
        this.applicationInferenceProfile = fields?.applicationInferenceProfile;
        this.serviceTier = fields?.serviceTier;
    }
    static lc_name() {
        return 'LibreChatBedrockConverse';
    }
    /**
     * Get the model ID to use for API calls.
     * Returns applicationInferenceProfile if set, otherwise returns this.model.
     */
    getModelId() {
        return this.applicationInferenceProfile ?? this.model;
    }
    /**
     * Override invocationParams to add serviceTier support.
     */
    invocationParams(options) {
        const baseParams = super.invocationParams(options);
        /** Service tier from options or fall back to class-level setting */
        const serviceTierType = options?.serviceTier ?? this.serviceTier;
        return {
            ...baseParams,
            serviceTier: serviceTierType ? { type: serviceTierType } : undefined,
        };
    }
    /**
     * Override _generateNonStreaming to use applicationInferenceProfile as modelId.
     * Uses the same model-swapping pattern as streaming for consistency.
     */
    async _generateNonStreaming(messages, options, runManager) {
        const originalModel = this.model;
        if (this.applicationInferenceProfile != null &&
            this.applicationInferenceProfile !== '') {
            this.model = this.applicationInferenceProfile;
        }
        try {
            return await super._generateNonStreaming(messages, options, runManager);
        }
        finally {
            this.model = originalModel;
        }
    }
    /**
     * Own the stream end-to-end so we have direct access to every
     * `contentBlockDelta.contentBlockIndex` from the AWS SDK.
     *
     * This replaces the parent's implementation which strips contentBlockIndex
     * from text and reasoning deltas, making it impossible to merge correctly.
     */
    async *_streamResponseChunks(messages$1, options, runManager) {
        const { converseMessages, converseSystem } = message_inputs.convertToConverseMessages(messages$1);
        const params = this.invocationParams(options);
        let { streamUsage } = this;
        if (options.streamUsage !== undefined) {
            streamUsage = options.streamUsage;
        }
        const modelId = this.getModelId();
        const command = new clientBedrockRuntime.ConverseStreamCommand({
            modelId,
            messages: converseMessages,
            system: converseSystem,
            ...params,
        });
        const response = await this.client.send(command, {
            abortSignal: options.signal,
        });
        if (!response.stream) {
            return;
        }
        const seenBlockIndices = new Set();
        for await (const event of response.stream) {
            if (event.contentBlockStart != null) {
                const startChunk = message_outputs.handleConverseStreamContentBlockStart(event.contentBlockStart);
                if (startChunk != null) {
                    const idx = event.contentBlockStart.contentBlockIndex;
                    if (idx != null) {
                        seenBlockIndices.add(idx);
                    }
                    yield this.enrichChunk(startChunk, seenBlockIndices);
                }
            }
            else if (event.contentBlockDelta != null) {
                const deltaChunk = message_outputs.handleConverseStreamContentBlockDelta(event.contentBlockDelta);
                const idx = event.contentBlockDelta.contentBlockIndex;
                if (idx != null) {
                    seenBlockIndices.add(idx);
                }
                yield this.enrichChunk(deltaChunk, seenBlockIndices);
                await runManager?.handleLLMNewToken(deltaChunk.text, undefined, undefined, undefined, undefined, { chunk: deltaChunk });
            }
            else if (event.metadata != null) {
                yield message_outputs.handleConverseStreamMetadata(event.metadata, { streamUsage });
            }
            else if (event.contentBlockStop != null) {
                const stopIdx = event.contentBlockStop.contentBlockIndex;
                if (stopIdx != null) {
                    seenBlockIndices.add(stopIdx);
                }
            }
            else {
                yield new outputs.ChatGenerationChunk({
                    text: '',
                    message: new messages.AIMessageChunk({
                        content: '',
                        response_metadata: event,
                    }),
                });
            }
        }
    }
    /**
     * Inject `index` on content blocks for proper merge behaviour, then strip
     * `contentBlockIndex` from response_metadata to prevent `_mergeDicts` conflicts.
     *
     * Text string content is promoted to array form only when the stream contains
     * multiple content block indices (e.g. reasoning at index 0, text at index 1),
     * ensuring text merges correctly with the already-array accumulated content.
     */
    enrichChunk(chunk, seenBlockIndices) {
        const message = chunk.message;
        if (!(message instanceof messages.AIMessageChunk)) {
            return chunk;
        }
        const metadata = message.response_metadata;
        const blockIndex = this.extractContentBlockIndex(metadata);
        const hasMetadataIndex = blockIndex != null;
        let content = message.content;
        let contentModified = false;
        if (Array.isArray(content) && blockIndex != null) {
            content = content.map((block) => typeof block === 'object' && !('index' in block)
                ? { ...block, index: blockIndex }
                : block);
            contentModified = true;
        }
        else if (typeof content === 'string' &&
            content !== '' &&
            blockIndex != null &&
            seenBlockIndices.size > 1) {
            content = [{ type: 'text', text: content, index: blockIndex }];
            contentModified = true;
        }
        if (!contentModified && !hasMetadataIndex) {
            return chunk;
        }
        const cleanedMetadata = hasMetadataIndex
            ? this.removeContentBlockIndex(metadata)
            : metadata;
        return new outputs.ChatGenerationChunk({
            text: chunk.text,
            message: new messages.AIMessageChunk({
                ...message,
                content,
                response_metadata: cleanedMetadata,
            }),
            generationInfo: chunk.generationInfo,
        });
    }
    /**
     * Extract `contentBlockIndex` from the top level of response_metadata.
     * Our custom handlers always place it at the top level.
     */
    extractContentBlockIndex(metadata) {
        if ('contentBlockIndex' in metadata &&
            typeof metadata.contentBlockIndex === 'number') {
            return metadata.contentBlockIndex;
        }
        return undefined;
    }
    removeContentBlockIndex(obj) {
        if (obj === null || obj === undefined) {
            return obj;
        }
        if (Array.isArray(obj)) {
            return obj.map((item) => this.removeContentBlockIndex(item));
        }
        if (typeof obj === 'object') {
            const cleaned = {};
            for (const [key, value] of Object.entries(obj)) {
                if (key !== 'contentBlockIndex') {
                    cleaned[key] = this.removeContentBlockIndex(value);
                }
            }
            return cleaned;
        }
        return obj;
    }
}

exports.CustomChatBedrockConverse = CustomChatBedrockConverse;
//# sourceMappingURL=index.cjs.map
