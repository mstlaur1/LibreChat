import { ChatGenerationChunk } from '@langchain/core/outputs';
import { AIMessageChunk } from '@langchain/core/messages';

/**
 * Utility functions for converting Bedrock Converse responses to LangChain messages.
 * Ported from @langchain/aws common.js
 */
/**
 * Convert a Bedrock reasoning block delta to a LangChain partial reasoning block.
 */
function bedrockReasoningDeltaToLangchainPartialReasoningBlock(reasoningContent) {
    const { text, redactedContent, signature } = reasoningContent;
    if (typeof text === 'string') {
        return {
            type: 'reasoning_content',
            reasoningText: { text },
        };
    }
    if (signature != null) {
        return {
            type: 'reasoning_content',
            reasoningText: { signature },
        };
    }
    if (redactedContent != null) {
        return {
            type: 'reasoning_content',
            redactedContent: Buffer.from(redactedContent).toString('base64'),
        };
    }
    throw new Error('Invalid reasoning content');
}
/**
 * Handle a content block delta event from Bedrock Converse stream.
 */
function handleConverseStreamContentBlockDelta(contentBlockDelta) {
    if (contentBlockDelta.delta == null) {
        throw new Error('No delta found in content block.');
    }
    if (typeof contentBlockDelta.delta.text === 'string') {
        return new ChatGenerationChunk({
            text: contentBlockDelta.delta.text,
            message: new AIMessageChunk({
                content: contentBlockDelta.delta.text,
                response_metadata: {
                    contentBlockIndex: contentBlockDelta.contentBlockIndex,
                },
            }),
        });
    }
    else if (contentBlockDelta.delta.toolUse != null) {
        const index = contentBlockDelta.contentBlockIndex;
        return new ChatGenerationChunk({
            text: '',
            message: new AIMessageChunk({
                content: '',
                tool_call_chunks: [
                    {
                        args: contentBlockDelta.delta.toolUse.input,
                        index,
                        type: 'tool_call_chunk',
                    },
                ],
                response_metadata: {
                    contentBlockIndex: contentBlockDelta.contentBlockIndex,
                },
            }),
        });
    }
    else if (contentBlockDelta.delta.reasoningContent != null) {
        const reasoningBlock = bedrockReasoningDeltaToLangchainPartialReasoningBlock(contentBlockDelta.delta.reasoningContent);
        let reasoningText = '';
        if ('reasoningText' in reasoningBlock) {
            reasoningText = reasoningBlock.reasoningText.text ?? '';
        }
        else if ('redactedContent' in reasoningBlock) {
            reasoningText = reasoningBlock.redactedContent;
        }
        return new ChatGenerationChunk({
            text: '',
            message: new AIMessageChunk({
                content: [reasoningBlock],
                additional_kwargs: {
                    // Set reasoning_content for stream handler to detect reasoning mode
                    reasoning_content: reasoningText,
                },
                response_metadata: {
                    contentBlockIndex: contentBlockDelta.contentBlockIndex,
                },
            }),
        });
    }
    else {
        throw new Error(`Unsupported content block type(s): ${JSON.stringify(contentBlockDelta.delta, null, 2)}`);
    }
}
/**
 * Handle a content block start event from Bedrock Converse stream.
 */
function handleConverseStreamContentBlockStart(contentBlockStart) {
    const index = contentBlockStart.contentBlockIndex;
    if (contentBlockStart.start?.toolUse != null) {
        return new ChatGenerationChunk({
            text: '',
            message: new AIMessageChunk({
                content: '',
                tool_call_chunks: [
                    {
                        name: contentBlockStart.start.toolUse.name,
                        id: contentBlockStart.start.toolUse.toolUseId,
                        index,
                        type: 'tool_call_chunk',
                    },
                ],
                response_metadata: {
                    contentBlockIndex: index,
                },
            }),
        });
    }
    // Return null for non-tool content block starts (text blocks don't need special handling)
    return null;
}
/**
 * Handle a metadata event from Bedrock Converse stream.
 */
function handleConverseStreamMetadata(metadata, extra) {
    const usage = metadata.usage;
    const inputTokens = usage?.inputTokens ?? 0;
    const outputTokens = usage?.outputTokens ?? 0;
    const cacheRead = usage?.cacheReadInputTokens;
    const cacheWrite = usage?.cacheWriteInputTokens;
    const usage_metadata = {
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        total_tokens: usage?.totalTokens ?? inputTokens + outputTokens,
    };
    if (cacheRead != null || cacheWrite != null) {
        usage_metadata.input_token_details = {
            cache_read: cacheRead ?? 0,
            cache_creation: cacheWrite ?? 0,
        };
    }
    return new ChatGenerationChunk({
        text: '',
        message: new AIMessageChunk({
            content: '',
            usage_metadata: extra.streamUsage
                ? usage_metadata
                : undefined,
            response_metadata: {
                // Use the same key as returned from the Converse API
                metadata,
            },
        }),
    });
}

export { bedrockReasoningDeltaToLangchainPartialReasoningBlock, handleConverseStreamContentBlockDelta, handleConverseStreamContentBlockStart, handleConverseStreamMetadata };
//# sourceMappingURL=message_outputs.mjs.map
