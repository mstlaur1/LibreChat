'use strict';

var index = require('../openai/index.cjs');
var outputs = require('@langchain/core/outputs');
var messages = require('@langchain/core/messages');
var index$1 = require('../openai/utils/index.cjs');

class ChatOpenRouter extends index.ChatOpenAI {
    openRouterReasoning;
    /** @deprecated Use `reasoning` object instead */
    includeReasoning;
    constructor(_fields) {
        const { include_reasoning, reasoning: openRouterReasoning, modelKwargs = {}, ...fields } = _fields;
        // Extract reasoning from modelKwargs if provided there (e.g., from LLMConfig)
        const { reasoning: mkReasoning, ...restModelKwargs } = modelKwargs;
        super({
            ...fields,
            modelKwargs: restModelKwargs,
        });
        // Merge reasoning config: modelKwargs.reasoning < constructor reasoning
        if (mkReasoning != null || openRouterReasoning != null) {
            this.openRouterReasoning = {
                ...mkReasoning,
                ...openRouterReasoning,
            };
        }
        this.includeReasoning = include_reasoning;
    }
    static lc_name() {
        return 'LibreChatOpenRouter';
    }
    // @ts-expect-error - OpenRouter reasoning extends OpenAI Reasoning with additional
    // effort levels ('xhigh' | 'none' | 'minimal') not in ReasoningEffort.
    // The parent's generic conditional return type cannot be widened in an override.
    invocationParams(options, extra) {
        const params = super.invocationParams(options, extra);
        // Remove the OpenAI-native reasoning_effort that the parent sets;
        // OpenRouter uses a `reasoning` object instead
        delete params.reasoning_effort;
        // Build the OpenRouter reasoning config
        const reasoning = this.buildOpenRouterReasoning(options);
        if (reasoning != null) {
            params.reasoning = reasoning;
        }
        else {
            delete params.reasoning;
        }
        return params;
    }
    buildOpenRouterReasoning(options) {
        let reasoning;
        // 1. Instance-level reasoning config (from constructor)
        if (this.openRouterReasoning != null) {
            reasoning = { ...this.openRouterReasoning };
        }
        // 2. LangChain-style reasoning params (from parent's `this.reasoning`)
        const lcReasoning = this.getReasoningParams(options);
        if (lcReasoning?.effort != null) {
            reasoning = {
                ...reasoning,
                effort: lcReasoning.effort,
            };
        }
        // 3. Call-level reasoning override
        const callReasoning = options
            ?.reasoning;
        if (callReasoning != null) {
            reasoning = { ...reasoning, ...callReasoning };
        }
        // 4. Legacy include_reasoning backward compatibility
        if (reasoning == null && this.includeReasoning === true) {
            reasoning = { enabled: true };
        }
        return reasoning;
    }
    _convertOpenAIDeltaToBaseMessageChunk(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delta, rawResponse, defaultRole) {
        const messageChunk = super._convertOpenAIDeltaToBaseMessageChunk(delta, rawResponse, defaultRole);
        if (delta.reasoning != null) {
            messageChunk.additional_kwargs.reasoning = delta.reasoning;
        }
        if (delta.reasoning_details != null) {
            messageChunk.additional_kwargs.reasoning_details =
                delta.reasoning_details;
        }
        return messageChunk;
    }
    async *_streamResponseChunks2(messages$1, options, runManager) {
        const messagesMapped = index$1._convertMessagesToOpenAIParams(messages$1, this.model, {
            includeReasoningDetails: true,
            convertReasoningDetailsToContent: true,
        });
        const params = {
            ...this.invocationParams(options, {
                streaming: true,
            }),
            messages: messagesMapped,
            stream: true,
        };
        let defaultRole;
        const streamIterable = await this.completionWithRetry(params, options);
        let usage;
        // Store reasoning_details keyed by unique identifier to prevent incorrect merging
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const reasoningTextByIndex = new Map();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const reasoningEncryptedById = new Map();
        for await (const data of streamIterable) {
            const choice = data.choices[0];
            if (data.usage) {
                usage = data.usage;
            }
            if (!choice) {
                continue;
            }
            const { delta } = choice;
            if (!delta) {
                continue;
            }
            // Accumulate reasoning_details from each delta
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const deltaAny = delta;
            // Extract current chunk's reasoning text for streaming (before accumulation)
            let currentChunkReasoningText = '';
            if (deltaAny.reasoning_details != null &&
                Array.isArray(deltaAny.reasoning_details)) {
                for (const detail of deltaAny.reasoning_details) {
                    // For encrypted reasoning (thought signatures), store by ID - MUST be separate
                    if (detail.type === 'reasoning.encrypted' && detail.id) {
                        reasoningEncryptedById.set(detail.id, {
                            type: detail.type,
                            id: detail.id,
                            data: detail.data,
                            format: detail.format,
                            index: detail.index,
                        });
                    }
                    else if (detail.type === 'reasoning.text') {
                        // Extract current chunk's text for streaming
                        currentChunkReasoningText += detail.text || '';
                        // For text reasoning, accumulate text by index for final message
                        const idx = detail.index ?? 0;
                        const existing = reasoningTextByIndex.get(idx);
                        if (existing) {
                            // Only append text, keep other fields from first entry
                            existing.text = (existing.text || '') + (detail.text || '');
                        }
                        else {
                            reasoningTextByIndex.set(idx, {
                                type: detail.type,
                                text: detail.text || '',
                                format: detail.format,
                                index: idx,
                            });
                        }
                    }
                }
            }
            const chunk = this._convertOpenAIDeltaToBaseMessageChunk(delta, data, defaultRole);
            // For models that send reasoning_details (Gemini style) instead of reasoning (DeepSeek style),
            // set the current chunk's reasoning text to additional_kwargs.reasoning for streaming
            if (currentChunkReasoningText && !chunk.additional_kwargs.reasoning) {
                chunk.additional_kwargs.reasoning = currentChunkReasoningText;
            }
            // IMPORTANT: Only set reasoning_details on the FINAL chunk to prevent
            // LangChain's chunk concatenation from corrupting the array
            // Check if this is the final chunk (has finish_reason)
            if (choice.finish_reason != null) {
                // Build properly structured reasoning_details array
                // Text entries first (but we only need the encrypted ones for thought signatures)
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const finalReasoningDetails = [
                    ...reasoningTextByIndex.values(),
                    ...reasoningEncryptedById.values(),
                ];
                if (finalReasoningDetails.length > 0) {
                    chunk.additional_kwargs.reasoning_details = finalReasoningDetails;
                }
            }
            else {
                // Clear reasoning_details from intermediate chunks to prevent concatenation issues
                delete chunk.additional_kwargs.reasoning_details;
            }
            defaultRole = delta.role ?? defaultRole;
            const newTokenIndices = {
                prompt: options.promptIndex ?? 0,
                completion: choice.index ?? 0,
            };
            if (typeof chunk.content !== 'string') {
                // eslint-disable-next-line no-console
                console.log('[WARNING]: Received non-string content from OpenAI. This is currently not supported.');
                continue;
            }
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const generationInfo = { ...newTokenIndices };
            if (choice.finish_reason != null) {
                generationInfo.finish_reason = choice.finish_reason;
                generationInfo.system_fingerprint = data.system_fingerprint;
                generationInfo.model_name = data.model;
                generationInfo.service_tier = data.service_tier;
            }
            if (this.logprobs == true) {
                generationInfo.logprobs = choice.logprobs;
            }
            const generationChunk = new outputs.ChatGenerationChunk({
                message: chunk,
                text: chunk.content,
                generationInfo,
            });
            yield generationChunk;
            if (this._lc_stream_delay != null) {
                await new Promise((resolve) => setTimeout(resolve, this._lc_stream_delay));
            }
            await runManager?.handleLLMNewToken(generationChunk.text || '', newTokenIndices, undefined, undefined, undefined, { chunk: generationChunk });
        }
        if (usage) {
            const inputTokenDetails = {
                ...(usage.prompt_tokens_details?.audio_tokens != null && {
                    audio: usage.prompt_tokens_details.audio_tokens,
                }),
                ...(usage.prompt_tokens_details?.cached_tokens != null && {
                    cache_read: usage.prompt_tokens_details.cached_tokens,
                }),
            };
            const outputTokenDetails = {
                ...(usage.completion_tokens_details?.audio_tokens != null && {
                    audio: usage.completion_tokens_details.audio_tokens,
                }),
                ...(usage.completion_tokens_details?.reasoning_tokens != null && {
                    reasoning: usage.completion_tokens_details.reasoning_tokens,
                }),
            };
            const generationChunk = new outputs.ChatGenerationChunk({
                message: new messages.AIMessageChunk({
                    content: '',
                    response_metadata: {
                        usage: { ...usage },
                    },
                    usage_metadata: {
                        input_tokens: usage.prompt_tokens,
                        output_tokens: usage.completion_tokens,
                        total_tokens: usage.total_tokens,
                        ...(Object.keys(inputTokenDetails).length > 0 && {
                            input_token_details: inputTokenDetails,
                        }),
                        ...(Object.keys(outputTokenDetails).length > 0 && {
                            output_token_details: outputTokenDetails,
                        }),
                    },
                }),
                text: '',
            });
            yield generationChunk;
            if (this._lc_stream_delay != null) {
                await new Promise((resolve) => setTimeout(resolve, this._lc_stream_delay));
            }
        }
        if (options.signal?.aborted === true) {
            throw new Error('AbortError');
        }
    }
}

exports.ChatOpenRouter = ChatOpenRouter;
//# sourceMappingURL=index.cjs.map
