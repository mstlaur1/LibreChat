'use strict';

var messages = require('@langchain/core/messages');

/**
 * Utility functions for converting LangChain messages to Bedrock Converse messages.
 * Ported from @langchain/aws common.js
 */
/**
 * Convert a LangChain reasoning block to a Bedrock reasoning block.
 */
function langchainReasoningBlockToBedrockReasoningBlock(content) {
    if (content.reasoningText != null) {
        return {
            reasoningText: content.reasoningText,
        };
    }
    if (content.redactedContent != null && content.redactedContent !== '') {
        return {
            redactedContent: new Uint8Array(Buffer.from(content.redactedContent, 'base64')),
        };
    }
    throw new Error('Invalid reasoning content');
}
/**
 * Concatenate consecutive reasoning blocks in content array.
 */
function concatenateLangchainReasoningBlocks(content) {
    const result = [];
    for (const block of content) {
        if (block.type === 'reasoning_content') {
            const currentReasoning = block;
            const lastIndex = result.length - 1;
            // Check if we can merge with the previous block
            if (lastIndex >= 0) {
                const lastBlock = result[lastIndex];
                if (lastBlock.type === 'reasoning_content' &&
                    lastBlock.reasoningText != null &&
                    currentReasoning.reasoningText != null) {
                    const lastReasoning = lastBlock;
                    // Merge consecutive reasoning text blocks
                    const lastText = lastReasoning.reasoningText?.text;
                    const currentText = currentReasoning.reasoningText.text;
                    if (lastText != null &&
                        lastText !== '' &&
                        currentText != null &&
                        currentText !== '') {
                        lastReasoning.reasoningText.text = lastText + currentText;
                    }
                    else if (currentReasoning.reasoningText.signature != null &&
                        currentReasoning.reasoningText.signature !== '') {
                        lastReasoning.reasoningText.signature =
                            currentReasoning.reasoningText.signature;
                    }
                    continue;
                }
            }
            result.push({ ...block });
        }
        else {
            result.push(block);
        }
    }
    return result;
}
/**
 * Extract image info from a base64 string or URL.
 */
function extractImageInfo(base64) {
    // Extract the format from the base64 string
    const formatMatch = base64.match(/^data:image\/(\w+);base64,/);
    let format;
    if (formatMatch) {
        const extractedFormat = formatMatch[1].toLowerCase();
        if (['gif', 'jpeg', 'png', 'webp'].includes(extractedFormat)) {
            format = extractedFormat;
        }
    }
    // Remove the data URL prefix if present
    const base64Data = base64.replace(/^data:image\/\w+;base64,/, '');
    // Convert base64 to Uint8Array
    const binaryString = atob(base64Data);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i += 1) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    return {
        image: {
            format,
            source: {
                bytes,
            },
        },
    };
}
/**
 * Check if a block has a cache point.
 */
function isDefaultCachePoint(block) {
    if (typeof block !== 'object' || block === null) {
        return false;
    }
    if (!('cachePoint' in block)) {
        return false;
    }
    const cachePoint = block.cachePoint;
    if (typeof cachePoint !== 'object' || cachePoint === null) {
        return false;
    }
    if (!('type' in cachePoint)) {
        return false;
    }
    return cachePoint.type === 'default';
}
/**
 * Convert a LangChain content block to a Bedrock Converse content block.
 */
function convertLangChainContentBlockToConverseContentBlock({ block, onUnknown = 'throw', }) {
    if (typeof block === 'string') {
        return { text: block };
    }
    if (block.type === 'text') {
        return { text: block.text };
    }
    if (block.type === 'image_url') {
        const imageUrl = typeof block.image_url ===
            'string'
            ? block.image_url
            : block.image_url.url;
        return extractImageInfo(imageUrl);
    }
    if (block.type === 'image') {
        // Handle standard image block format
        const imageBlock = block;
        if (imageBlock.source_type === 'url' &&
            imageBlock.url != null &&
            imageBlock.url !== '') {
            const parsedData = messages.parseBase64DataUrl({
                dataUrl: imageBlock.url,
                asTypedArray: true,
            });
            if (parsedData != null) {
                const parsedMimeType = messages.parseMimeType(parsedData.mime_type);
                return {
                    image: {
                        format: parsedMimeType.subtype,
                        source: {
                            bytes: parsedData.data,
                        },
                    },
                };
            }
        }
        else if (imageBlock.source_type === 'base64' &&
            imageBlock.data != null &&
            imageBlock.data !== '') {
            let format;
            if (imageBlock.mime_type != null && imageBlock.mime_type !== '') {
                const parsedMimeType = messages.parseMimeType(imageBlock.mime_type);
                format = parsedMimeType.subtype;
            }
            return {
                image: {
                    format,
                    source: {
                        bytes: Uint8Array.from(atob(imageBlock.data), (c) => c.charCodeAt(0)),
                    },
                },
            };
        }
        // If it already has the Bedrock image structure, pass through
        if (block.image !== undefined) {
            return {
                image: block.image,
            };
        }
    }
    if (block.type === 'document' &&
        block.document !== undefined) {
        return {
            document: block.document,
        };
    }
    if (isDefaultCachePoint(block)) {
        return {
            cachePoint: {
                type: 'default',
            },
        };
    }
    if (onUnknown === 'throw') {
        throw new Error(`Unsupported content block type: ${block.type}`);
    }
    else {
        return block;
    }
}
/**
 * Convert a system message to Bedrock system content blocks.
 */
function convertSystemMessageToConverseMessage(msg) {
    if (typeof msg.content === 'string') {
        return [{ text: msg.content }];
    }
    else if (Array.isArray(msg.content) && msg.content.length > 0) {
        const contentBlocks = [];
        for (const block of msg.content) {
            if (typeof block === 'object' &&
                block.type === 'text' &&
                typeof block.text === 'string') {
                contentBlocks.push({
                    text: block.text,
                });
            }
            else if (isDefaultCachePoint(block)) {
                contentBlocks.push({
                    cachePoint: {
                        type: 'default',
                    },
                });
            }
            else {
                break;
            }
        }
        if (msg.content.length === contentBlocks.length) {
            return contentBlocks;
        }
    }
    throw new Error('System message content must be either a string, or an array of text blocks, optionally including a cache point.');
}
/**
 * Convert an AI message to a Bedrock message.
 */
function convertAIMessageToConverseMessage(msg) {
    // Check for v1 format from other providers (PR #9766 fix)
    if (msg.response_metadata.output_version === 'v1') {
        return convertFromV1ToChatBedrockConverseMessage(msg);
    }
    const assistantMsg = {
        role: 'assistant',
        content: [],
    };
    if (typeof msg.content === 'string' && msg.content !== '') {
        assistantMsg.content?.push({ text: msg.content });
    }
    else if (Array.isArray(msg.content)) {
        const concatenatedBlocks = concatenateLangchainReasoningBlocks(msg.content);
        const contentBlocks = [];
        concatenatedBlocks.forEach((block) => {
            if (block.type === 'text' && block.text !== '') {
                // Merge whitespace/newlines with previous text blocks to avoid validation errors.
                const text = block.text;
                const cleanedText = text.replace(/\n/g, '').trim();
                if (cleanedText === '') {
                    if (contentBlocks.length > 0) {
                        const lastBlock = contentBlocks[contentBlocks.length - 1];
                        if ('text' in lastBlock) {
                            const mergedTextContent = `${lastBlock.text}${text}`;
                            lastBlock.text = mergedTextContent;
                        }
                    }
                }
                else {
                    contentBlocks.push({ text });
                }
            }
            else if (block.type === 'reasoning_content') {
                contentBlocks.push({
                    reasoningContent: langchainReasoningBlockToBedrockReasoningBlock(block),
                });
            }
            else if (isDefaultCachePoint(block)) {
                contentBlocks.push({
                    cachePoint: {
                        type: 'default',
                    },
                });
            }
            else {
                const blockValues = Object.fromEntries(Object.entries(block).filter(([key]) => key !== 'type'));
                throw new Error(`Unsupported content block type: ${block.type} with content of ${JSON.stringify(blockValues, null, 2)}`);
            }
        });
        assistantMsg.content = [...(assistantMsg.content ?? []), ...contentBlocks];
    }
    // Important: this must be placed after any reasoning content blocks
    if (messages.isAIMessage(msg) && msg.tool_calls != null && msg.tool_calls.length > 0) {
        const toolUseBlocks = msg.tool_calls.map((tc) => ({
            toolUse: {
                toolUseId: tc.id,
                name: tc.name,
                input: tc.args,
            },
        }));
        assistantMsg.content = [
            ...(assistantMsg.content ?? []),
            ...toolUseBlocks,
        ];
    }
    return assistantMsg;
}
/**
 * Convert a v1 format message from other providers to Bedrock format.
 * This handles messages with standard content blocks like tool_call and reasoning.
 * (Implements PR #9766 fix for output_version v1 detection)
 */
function convertFromV1ToChatBedrockConverseMessage(msg) {
    const assistantMsg = {
        role: 'assistant',
        content: [],
    };
    if (Array.isArray(msg.content)) {
        for (const block of msg.content) {
            if (typeof block === 'string') {
                assistantMsg.content?.push({ text: block });
            }
            else if (block.type === 'text') {
                assistantMsg.content?.push({ text: block.text });
            }
            else if (block.type === 'tool_call') {
                const toolCall = block;
                assistantMsg.content?.push({
                    toolUse: {
                        toolUseId: toolCall.id,
                        name: toolCall.name,
                        input: toolCall.args,
                    },
                });
            }
            else if (block.type === 'reasoning') {
                const reasoning = block;
                assistantMsg.content?.push({
                    reasoningContent: {
                        reasoningText: { text: reasoning.reasoning },
                    },
                });
            }
            else if (block.type === 'reasoning_content') {
                assistantMsg.content?.push({
                    reasoningContent: langchainReasoningBlockToBedrockReasoningBlock(block),
                });
            }
        }
    }
    else if (typeof msg.content === 'string' && msg.content !== '') {
        assistantMsg.content?.push({ text: msg.content });
    }
    // Also handle tool_calls from the message
    if (messages.isAIMessage(msg) && msg.tool_calls != null && msg.tool_calls.length > 0) {
        // Check if tool calls are already in content
        const existingToolUseIds = new Set(assistantMsg.content
            ?.filter((c) => 'toolUse' in c)
            .map((c) => c.toolUse.toolUseId) ?? []);
        for (const tc of msg.tool_calls) {
            if (!existingToolUseIds.has(tc.id ?? '')) {
                assistantMsg.content?.push({
                    toolUse: {
                        toolUseId: tc.id,
                        name: tc.name,
                        input: tc.args,
                    },
                });
            }
        }
    }
    return assistantMsg;
}
/**
 * Convert a human message to a Bedrock message.
 */
function convertHumanMessageToConverseMessage(msg) {
    const userMessage = {
        role: 'user',
        content: [],
    };
    if (typeof msg.content === 'string') {
        userMessage.content = [{ text: msg.content }];
    }
    else if (Array.isArray(msg.content)) {
        userMessage.content = msg.content.map((block) => convertLangChainContentBlockToConverseContentBlock({ block }));
    }
    return userMessage;
}
/**
 * Convert a tool message to a Bedrock message.
 */
function convertToolMessageToConverseMessage(msg) {
    const toolCallId = msg.tool_call_id;
    let content;
    if (typeof msg.content === 'string') {
        content = [{ text: msg.content }];
    }
    else if (Array.isArray(msg.content)) {
        content = msg.content.map((block) => convertLangChainContentBlockToConverseContentBlock({
            block,
            onUnknown: 'passthrough',
        }));
    }
    else {
        content = [{ text: String(msg.content) }];
    }
    return {
        role: 'user',
        content: [
            {
                toolResult: {
                    toolUseId: toolCallId,
                    content: content,
                },
            },
        ],
    };
}
/**
 * Convert LangChain messages to Bedrock Converse messages.
 */
function convertToConverseMessages(messages) {
    const converseSystem = messages
        .filter((msg) => msg._getType() === 'system')
        .flatMap((msg) => convertSystemMessageToConverseMessage(msg));
    const converseMessages = messages
        .filter((msg) => msg._getType() !== 'system')
        .map((msg) => {
        if (msg._getType() === 'ai') {
            return convertAIMessageToConverseMessage(msg);
        }
        else if (msg._getType() === 'human' || msg._getType() === 'generic') {
            return convertHumanMessageToConverseMessage(msg);
        }
        else if (msg._getType() === 'tool') {
            return convertToolMessageToConverseMessage(msg);
        }
        else {
            throw new Error(`Unsupported message type: ${msg._getType()}`);
        }
    });
    // Combine consecutive user tool result messages into a single message
    const combinedConverseMessages = converseMessages.reduce((acc, curr) => {
        const lastMessage = acc[acc.length - 1];
        if (lastMessage == null) {
            acc.push(curr);
            return acc;
        }
        const lastHasToolResult = lastMessage.content?.some((c) => 'toolResult' in c) === true;
        const currHasToolResult = curr.content?.some((c) => 'toolResult' in c) === true;
        if (lastMessage.role === 'user' &&
            lastHasToolResult &&
            curr.role === 'user' &&
            currHasToolResult) {
            lastMessage.content = lastMessage.content?.concat(curr.content ?? []);
        }
        else {
            acc.push(curr);
        }
        return acc;
    }, []);
    return { converseMessages: combinedConverseMessages, converseSystem };
}

exports.concatenateLangchainReasoningBlocks = concatenateLangchainReasoningBlocks;
exports.convertToConverseMessages = convertToConverseMessages;
exports.extractImageInfo = extractImageInfo;
exports.langchainReasoningBlockToBedrockReasoningBlock = langchainReasoningBlockToBedrockReasoningBlock;
//# sourceMappingURL=message_inputs.cjs.map
