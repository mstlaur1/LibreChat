'use strict';

var messages = require('@langchain/core/messages');
var anthropic = require('@langchain/anthropic');
var outputs = require('@langchain/core/outputs');
var message_outputs = require('./utils/message_outputs.cjs');
var message_inputs = require('./utils/message_inputs.cjs');
var tools = require('./utils/tools.cjs');
var text = require('../text.cjs');

function _toolsInParams(params) {
    return !!(params.tools && params.tools.length > 0);
}
function _documentsInParams(params) {
    for (const message of params.messages ?? []) {
        if (typeof message.content === 'string') {
            continue;
        }
        for (const block of message.content ?? []) {
            if (typeof block === 'object' &&
                block != null &&
                block.type === 'document' &&
                block.citations != null &&
                typeof block.citations === 'object' &&
                block.citations.enabled) {
                return true;
            }
        }
    }
    return false;
}
function _thinkingInParams(params) {
    return !!(params.thinking &&
        (params.thinking.type === 'enabled' || params.thinking.type === 'adaptive'));
}
function _compactionInParams(params) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cm = params.context_management;
    return !!cm?.edits?.some((e) => e.type === 'compact_20260112');
}
function extractToken(chunk) {
    if (typeof chunk.content === 'string') {
        return [chunk.content, 'string'];
    }
    else if (Array.isArray(chunk.content) &&
        chunk.content.length >= 1 &&
        'input' in chunk.content[0]) {
        return typeof chunk.content[0].input === 'string'
            ? [chunk.content[0].input, 'input']
            : [JSON.stringify(chunk.content[0].input), 'input'];
    }
    else if (Array.isArray(chunk.content) &&
        chunk.content.length >= 1 &&
        'text' in chunk.content[0]) {
        return [chunk.content[0].text, 'content'];
    }
    else if (Array.isArray(chunk.content) &&
        chunk.content.length >= 1 &&
        'thinking' in chunk.content[0]) {
        return [chunk.content[0].thinking, 'content'];
    }
    return [undefined];
}
function cloneChunk(text, tokenType, chunk) {
    if (tokenType === 'string') {
        return new messages.AIMessageChunk(Object.assign({}, chunk, { content: text }));
    }
    else if (tokenType === 'input') {
        return chunk;
    }
    const content = chunk.content[0];
    if (tokenType === 'content' && content.type === 'text') {
        return new messages.AIMessageChunk(Object.assign({}, chunk, {
            content: [Object.assign({}, content, { text })],
        }));
    }
    else if (tokenType === 'content' && content.type === 'text_delta') {
        return new messages.AIMessageChunk(Object.assign({}, chunk, {
            content: [Object.assign({}, content, { text })],
        }));
    }
    else if (tokenType === 'content' && content.type?.startsWith('thinking')) {
        return new messages.AIMessageChunk(Object.assign({}, chunk, {
            content: [Object.assign({}, content, { thinking: text })],
        }));
    }
    return chunk;
}
class CustomAnthropic extends anthropic.ChatAnthropicMessages {
    _lc_stream_delay;
    message_start;
    message_delta;
    tools_in_params;
    emitted_usage;
    top_k;
    outputConfig;
    inferenceGeo;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    contextManagement;
    constructor(fields) {
        super(fields);
        this.resetTokenEvents();
        this.setDirectFields(fields);
        this._lc_stream_delay = fields?._lc_stream_delay ?? 25;
        this.outputConfig = fields?.outputConfig;
        this.inferenceGeo = fields?.inferenceGeo;
        this.contextManagement = fields?.contextManagement;
    }
    static lc_name() {
        return 'LibreChatAnthropic';
    }
    /**
     * Get the parameters used to invoke the model
     */
    invocationParams(options) {
        const tool_choice = tools.handleToolChoice(options?.tool_choice);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const callOptions = options;
        const mergedOutputConfig = (() => {
            const base = {
                ...this.outputConfig,
                ...callOptions?.outputConfig,
            };
            if (callOptions?.outputFormat && !base.format) {
                base.format = callOptions.outputFormat;
            }
            return Object.keys(base).length > 0 ? base : undefined;
        })();
        const inferenceGeo = callOptions?.inferenceGeo ?? this.inferenceGeo;
        const contextManagement = this.contextManagement;
        const sharedParams = {
            tools: this.formatStructuredToolToAnthropic(options?.tools),
            tool_choice,
            thinking: this.thinking,
            ...(mergedOutputConfig ? { output_config: mergedOutputConfig } : {}),
            ...(inferenceGeo ? { inference_geo: inferenceGeo } : {}),
            ...(contextManagement ? { context_management: contextManagement } : {}),
            ...this.invocationKwargs,
        };
        if (this.thinking.type === 'enabled' || this.thinking.type === 'adaptive') {
            if (this.top_k !== -1 && this.top_k != null) {
                throw new Error('topK is not supported when thinking is enabled');
            }
            if (this.topP !== -1 && this.topP != null) {
                throw new Error('topP is not supported when thinking is enabled');
            }
            if (this.temperature !== 1 &&
                this.temperature != null) {
                throw new Error('temperature is not supported when thinking is enabled');
            }
            return {
                model: this.model,
                stop_sequences: options?.stop ?? this.stopSequences,
                stream: this.streaming,
                max_tokens: this.maxTokens,
                ...sharedParams,
            };
        }
        return {
            model: this.model,
            temperature: this.temperature,
            top_k: this.top_k,
            top_p: this.topP,
            stop_sequences: options?.stop ?? this.stopSequences,
            stream: this.streaming,
            max_tokens: this.maxTokens,
            ...sharedParams,
        };
    }
    /**
     * Get stream usage as returned by this client's API response.
     * @returns The stream usage object.
     */
    getStreamUsage() {
        if (this.emitted_usage === true) {
            return;
        }
        const inputUsage = this.message_start?.message.usage;
        const outputUsage = this.message_delta?.usage;
        if (!outputUsage) {
            return;
        }
        const totalUsage = {
            input_tokens: inputUsage?.input_tokens ?? 0,
            output_tokens: outputUsage.output_tokens ?? 0,
            total_tokens: (inputUsage?.input_tokens ?? 0) + (outputUsage.output_tokens ?? 0),
        };
        if (inputUsage?.cache_creation_input_tokens != null ||
            inputUsage?.cache_read_input_tokens != null) {
            totalUsage.input_token_details = {
                cache_creation: inputUsage.cache_creation_input_tokens ?? 0,
                cache_read: inputUsage.cache_read_input_tokens ?? 0,
            };
        }
        this.emitted_usage = true;
        return totalUsage;
    }
    resetTokenEvents() {
        this.message_start = undefined;
        this.message_delta = undefined;
        this.emitted_usage = undefined;
        this.tools_in_params = undefined;
    }
    setDirectFields(fields) {
        this.temperature = fields?.temperature ?? undefined;
        this.topP = fields?.topP ?? undefined;
        this.top_k = fields?.topK;
        if (this.temperature === -1 || this.temperature === 1) {
            this.temperature = undefined;
        }
        if (this.topP === -1) {
            this.topP = undefined;
        }
        if (this.top_k === -1) {
            this.top_k = undefined;
        }
    }
    createGenerationChunk({ token, chunk, usageMetadata, shouldStreamUsage, }) {
        const usage_metadata = shouldStreamUsage
            ? (usageMetadata ?? chunk.usage_metadata)
            : undefined;
        return new outputs.ChatGenerationChunk({
            message: new messages.AIMessageChunk({
                // Just yield chunk as it is and tool_use will be concat by BaseChatModel._generateUncached().
                content: chunk.content,
                additional_kwargs: chunk.additional_kwargs,
                tool_call_chunks: chunk.tool_call_chunks,
                response_metadata: chunk.response_metadata,
                usage_metadata,
                id: chunk.id,
            }),
            text: token ?? '',
        });
    }
    async *_streamResponseChunks(messages, options, runManager) {
        this.resetTokenEvents();
        const params = this.invocationParams(options);
        const formattedMessages = message_inputs._convertMessagesToAnthropicPayload(messages);
        const payload = {
            ...params,
            ...formattedMessages,
            stream: true,
        };
        const coerceContentToString = !_toolsInParams(payload) &&
            !_documentsInParams(payload) &&
            !_thinkingInParams(payload) &&
            !_compactionInParams(payload);
        const stream = await this.createStreamWithRetry(payload, {
            headers: options.headers,
        });
        const shouldStreamUsage = this.streamUsage ?? options.streamUsage;
        for await (const data of stream) {
            if (options.signal?.aborted === true) {
                stream.controller.abort();
                throw new Error('AbortError: User aborted the request.');
            }
            if (data.type === 'message_start') {
                this.message_start = data;
            }
            else if (data.type === 'message_delta') {
                this.message_delta = data;
            }
            let usageMetadata;
            if (this.tools_in_params !== true && this.emitted_usage !== true) {
                usageMetadata = this.getStreamUsage();
            }
            const result = message_outputs._makeMessageChunkFromAnthropicEvent(data, {
                streamUsage: shouldStreamUsage,
                coerceContentToString,
            });
            if (!result)
                continue;
            const { chunk } = result;
            const [token = '', tokenType] = extractToken(chunk);
            if (!tokenType ||
                tokenType === 'input' ||
                (token === '' && (usageMetadata != null || chunk.id != null))) {
                const generationChunk = this.createGenerationChunk({
                    token,
                    chunk,
                    usageMetadata,
                    shouldStreamUsage,
                });
                yield generationChunk;
                await runManager?.handleLLMNewToken(token, undefined, undefined, undefined, undefined, { chunk: generationChunk });
                continue;
            }
            const textStream = new text.TextStream(token, {
                delay: this._lc_stream_delay,
                firstWordChunk: true,
                minChunkSize: 4,
                maxChunkSize: 8,
            });
            const generator = textStream.generateText(options.signal);
            try {
                let emittedUsage = false;
                for await (const currentToken of generator) {
                    if (options.signal?.aborted === true) {
                        break;
                    }
                    const newChunk = cloneChunk(currentToken, tokenType, chunk);
                    const generationChunk = this.createGenerationChunk({
                        token: currentToken,
                        chunk: newChunk,
                        usageMetadata: emittedUsage ? undefined : usageMetadata,
                        shouldStreamUsage,
                    });
                    if (usageMetadata && !emittedUsage) {
                        emittedUsage = true;
                    }
                    yield generationChunk;
                    await runManager?.handleLLMNewToken(currentToken, undefined, undefined, undefined, undefined, { chunk: generationChunk });
                }
            }
            finally {
                await generator.return();
            }
        }
        this.resetTokenEvents();
    }
}

exports.CustomAnthropic = CustomAnthropic;
//# sourceMappingURL=index.cjs.map
