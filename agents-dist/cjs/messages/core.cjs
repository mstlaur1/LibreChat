'use strict';

var messages = require('@langchain/core/messages');
var _enum = require('../common/enum.cjs');

// src/messages.ts
function getConverseOverrideMessage({ userMessage, lastMessageX, lastMessageY, }) {
    const content = `
User: ${userMessage[1]}

---
# YOU HAVE ALREADY RESPONDED TO THE LATEST USER MESSAGE:

# Observations:
- ${lastMessageX?.content}

# Tool Calls:
- ${lastMessageX?.tool_calls?.join('\n- ')}

# Tool Responses:
- ${lastMessageY.content}
`;
    return new messages.HumanMessage(content);
}
const _allowedTypes = ['image_url', 'text', 'tool_use', 'tool_result'];
const allowedTypesByProvider = {
    default: _allowedTypes,
    [_enum.Providers.ANTHROPIC]: [..._allowedTypes, 'thinking', 'redacted_thinking'],
    [_enum.Providers.BEDROCK]: [..._allowedTypes, 'reasoning_content'],
    [_enum.Providers.OPENAI]: _allowedTypes,
};
const modifyContent = ({ provider, messageType, content, }) => {
    const allowedTypes = allowedTypesByProvider[provider] ?? allowedTypesByProvider.default;
    return content.map((item) => {
        if (item &&
            typeof item === 'object' &&
            'type' in item &&
            item.type != null &&
            item.type) {
            let newType = item.type;
            if (newType.endsWith('_delta')) {
                newType = newType.replace('_delta', '');
            }
            if (!allowedTypes.includes(newType)) {
                newType = 'text';
            }
            /* Handle the edge case for empty object 'tool_use' input in AI messages */
            if (messageType === 'ai' &&
                newType === 'tool_use' &&
                'input' in item &&
                item.input === '') {
                return { ...item, type: newType, input: '{}' };
            }
            return { ...item, type: newType };
        }
        return item;
    });
};
function reduceBlocks(blocks) {
    const reduced = [];
    for (const block of blocks) {
        const lastBlock = reduced[reduced.length - 1];
        // Merge consecutive 'reasoning_content'
        if (block.type === 'reasoning_content' &&
            lastBlock?.type === 'reasoning_content') {
            // append text if exists
            if (block.reasoningText?.text != null && block.reasoningText.text) {
                lastBlock.reasoningText.text =
                    (lastBlock.reasoningText?.text ?? '') + block.reasoningText.text;
            }
            // preserve the signature if exists
            if (block.reasoningText?.signature != null &&
                block.reasoningText.signature) {
                lastBlock.reasoningText.signature = block.reasoningText.signature;
            }
        }
        // Merge consecutive 'text'
        else if (block.type === 'text' && lastBlock?.type === 'text') {
            lastBlock.text += block.text;
        }
        // add a new block as it's a different type or first element
        else {
            // deep copy to avoid mutation of original
            reduced.push(JSON.parse(JSON.stringify(block)));
        }
    }
    return reduced;
}
function modifyDeltaProperties(provider, obj) {
    if (!obj || typeof obj !== 'object')
        return obj;
    const messageType = obj._getType
        ? obj._getType()
        : '';
    if (provider === _enum.Providers.BEDROCK && Array.isArray(obj.content)) {
        obj.content = reduceBlocks(obj.content);
    }
    if (Array.isArray(obj.content)) {
        obj.content = modifyContent({
            provider,
            messageType,
            content: obj.content,
        });
    }
    if (obj.lc_kwargs &&
        Array.isArray(obj.lc_kwargs.content)) {
        if (provider === _enum.Providers.BEDROCK) {
            obj.lc_kwargs.content = reduceBlocks(obj.lc_kwargs.content);
        }
        obj.lc_kwargs.content = modifyContent({
            provider,
            messageType,
            content: obj.lc_kwargs.content,
        });
    }
    return obj;
}
function formatAnthropicMessage(message) {
    if (!message.tool_calls || message.tool_calls.length === 0) {
        return new messages.AIMessage({ content: message.content });
    }
    const toolCallMap = new Map(message.tool_calls.map((tc) => [tc.id, tc]));
    let formattedContent;
    if (Array.isArray(message.content)) {
        formattedContent = message.content.reduce((acc, item) => {
            if (typeof item === 'object') {
                const extendedItem = item;
                if (extendedItem.type === 'text' &&
                    extendedItem.text != null &&
                    extendedItem.text) {
                    acc.push({ type: 'text', text: extendedItem.text });
                }
                else if (extendedItem.type === 'tool_use' &&
                    extendedItem.id != null &&
                    extendedItem.id) {
                    const toolCall = toolCallMap.get(extendedItem.id);
                    if (toolCall) {
                        acc.push({
                            type: 'tool_use',
                            id: extendedItem.id,
                            name: toolCall.name,
                            input: toolCall.args,
                        });
                    }
                }
                else if ('input' in extendedItem &&
                    extendedItem.input != null &&
                    extendedItem.input) {
                    try {
                        const parsedInput = JSON.parse(extendedItem.input);
                        const toolCall = message.tool_calls?.find((tc) => tc.args.input === parsedInput.input);
                        if (toolCall) {
                            acc.push({
                                type: 'tool_use',
                                id: toolCall.id,
                                name: toolCall.name,
                                input: toolCall.args,
                            });
                        }
                    }
                    catch {
                        if (extendedItem.input) {
                            acc.push({ type: 'text', text: extendedItem.input });
                        }
                    }
                }
            }
            else if (typeof item === 'string') {
                acc.push({ type: 'text', text: item });
            }
            return acc;
        }, []);
    }
    else if (typeof message.content === 'string') {
        formattedContent = message.content;
    }
    else {
        formattedContent = [];
    }
    // const formattedToolCalls: ToolCall[] = message.tool_calls.map(toolCall => ({
    //   id: toolCall.id ?? '',
    //   name: toolCall.name,
    //   args: toolCall.args,
    //   type: 'tool_call',
    // }));
    const formattedToolCalls = message.tool_calls.map((toolCall) => ({
        id: toolCall.id ?? '',
        type: 'function',
        function: {
            name: toolCall.name,
            arguments: toolCall.args,
        },
    }));
    return new messages.AIMessage({
        content: formattedContent,
        tool_calls: formattedToolCalls,
        additional_kwargs: {
            ...message.additional_kwargs,
        },
    });
}
function convertMessagesToContent(messages) {
    const processedContent = [];
    const addContentPart = (message) => {
        const content = message?.lc_kwargs.content != null
            ? message.lc_kwargs.content
            : message?.content;
        if (content === undefined) {
            return;
        }
        if (typeof content === 'string') {
            processedContent.push({
                type: 'text',
                text: content,
            });
        }
        else if (Array.isArray(content)) {
            const filteredContent = content.filter((item) => item != null && item.type !== 'tool_use');
            processedContent.push(...filteredContent);
        }
    };
    let currentAIMessageIndex = -1;
    const toolCallMap = new Map();
    for (let i = 0; i < messages.length; i++) {
        const message = messages[i];
        const messageType = message?._getType();
        if (messageType === 'ai' &&
            (message.tool_calls?.length ?? 0) > 0) {
            const tool_calls = message.tool_calls || [];
            for (const tool_call of tool_calls) {
                if (tool_call.id == null || !tool_call.id) {
                    continue;
                }
                toolCallMap.set(tool_call.id, tool_call);
            }
            addContentPart(message);
            currentAIMessageIndex = processedContent.length - 1;
            continue;
        }
        else if (messageType === 'tool' &&
            message.tool_call_id) {
            const id = message.tool_call_id;
            const output = message.content;
            const tool_call = toolCallMap.get(id);
            if (currentAIMessageIndex === -1) {
                processedContent.push({ type: 'text', text: '' });
                currentAIMessageIndex = processedContent.length - 1;
            }
            const contentPart = processedContent[currentAIMessageIndex];
            processedContent.push({
                type: 'tool_call',
                tool_call: Object.assign({}, tool_call, { output }),
            });
            const tool_call_ids = contentPart.tool_call_ids || [];
            tool_call_ids.push(id);
            contentPart.tool_call_ids = tool_call_ids;
            continue;
        }
        else if (messageType !== 'ai') {
            continue;
        }
        addContentPart(message);
    }
    return processedContent;
}
function formatAnthropicArtifactContent(messages$1) {
    const lastMessage = messages$1[messages$1.length - 1];
    if (!(lastMessage instanceof messages.ToolMessage))
        return;
    // Find the latest AIMessage with tool_calls that this tool message belongs to
    const latestAIParentIndex = findLastIndex(messages$1, (msg) => (msg instanceof messages.AIMessageChunk &&
        (msg.tool_calls?.length ?? 0) > 0 &&
        msg.tool_calls?.some((tc) => tc.id === lastMessage.tool_call_id)) ??
        false);
    if (latestAIParentIndex === -1)
        return;
    // Check if any tool message after the AI message has array artifact content
    const hasArtifactContent = messages$1.some((msg, i) => i > latestAIParentIndex &&
        msg instanceof messages.ToolMessage &&
        msg.artifact != null &&
        msg.artifact?.content != null &&
        Array.isArray(msg.artifact.content));
    if (!hasArtifactContent)
        return;
    const message = messages$1[latestAIParentIndex];
    const toolCallIds = message.tool_calls?.map((tc) => tc.id) ?? [];
    for (let j = latestAIParentIndex + 1; j < messages$1.length; j++) {
        const msg = messages$1[j];
        if (msg instanceof messages.ToolMessage &&
            toolCallIds.includes(msg.tool_call_id) &&
            msg.artifact != null &&
            Array.isArray(msg.artifact?.content) &&
            Array.isArray(msg.content)) {
            msg.content = msg.content.concat(msg.artifact.content);
        }
    }
}
function formatArtifactPayload(messages$1) {
    const lastMessageY = messages$1[messages$1.length - 1];
    if (!(lastMessageY instanceof messages.ToolMessage))
        return;
    // Find the latest AIMessage with tool_calls that this tool message belongs to
    const latestAIParentIndex = findLastIndex(messages$1, (msg) => (msg instanceof messages.AIMessageChunk &&
        (msg.tool_calls?.length ?? 0) > 0 &&
        msg.tool_calls?.some((tc) => tc.id === lastMessageY.tool_call_id)) ??
        false);
    if (latestAIParentIndex === -1)
        return;
    // Check if any tool message after the AI message has array artifact content
    const hasArtifactContent = messages$1.some((msg, i) => i > latestAIParentIndex &&
        msg instanceof messages.ToolMessage &&
        msg.artifact != null &&
        msg.artifact?.content != null &&
        Array.isArray(msg.artifact.content));
    if (!hasArtifactContent)
        return;
    // Collect all relevant tool messages and their artifacts
    const relevantMessages = messages$1
        .slice(latestAIParentIndex + 1)
        .filter((msg) => msg instanceof messages.ToolMessage);
    // Aggregate all content and artifacts
    const aggregatedContent = [];
    relevantMessages.forEach((msg) => {
        if (!Array.isArray(msg.artifact?.content)) {
            return;
        }
        let currentContent = msg.content;
        if (!Array.isArray(currentContent)) {
            currentContent = [
                {
                    type: 'text',
                    text: msg.content,
                },
            ];
        }
        aggregatedContent.push(...currentContent);
        msg.content =
            'Tool response is included in the next message as a Human message';
        aggregatedContent.push(...msg.artifact.content);
    });
    // Add single HumanMessage with all aggregated content
    if (aggregatedContent.length > 0) {
        messages$1.push(new messages.HumanMessage({ content: aggregatedContent }));
    }
}
function findLastIndex(array, predicate) {
    for (let i = array.length - 1; i >= 0; i--) {
        if (predicate(array[i])) {
            return i;
        }
    }
    return -1;
}

exports.convertMessagesToContent = convertMessagesToContent;
exports.findLastIndex = findLastIndex;
exports.formatAnthropicArtifactContent = formatAnthropicArtifactContent;
exports.formatAnthropicMessage = formatAnthropicMessage;
exports.formatArtifactPayload = formatArtifactPayload;
exports.getConverseOverrideMessage = getConverseOverrideMessage;
exports.modifyDeltaProperties = modifyDeltaProperties;
//# sourceMappingURL=core.cjs.map
