import { HumanMessage, AIMessage, AIMessageChunk, getBufferString, SystemMessage, ToolMessage } from '@langchain/core/messages';
import { ContentTypes, Constants, Providers } from '../common/enum.mjs';

/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Formats a message with media content (images, documents, videos, audios) to API payload format.
 *
 * @param params - The parameters for formatting.
 * @returns - The formatted message.
 */
const formatMediaMessage = ({ message, endpoint, mediaParts, }) => {
    // Create a new object to avoid mutating the input
    const result = {
        ...message,
        content: [],
    };
    if (endpoint === Providers.ANTHROPIC) {
        result.content = [
            ...mediaParts,
            { type: ContentTypes.TEXT, text: message.content },
        ];
        return result;
    }
    result.content = [
        { type: ContentTypes.TEXT, text: message.content },
        ...mediaParts,
    ];
    return result;
};
/**
 * Formats a message to OpenAI payload format based on the provided options.
 *
 * @param params - The parameters for formatting.
 * @returns - The formatted message.
 */
const formatMessage = ({ message, userName, endpoint, assistantName, langChain = false, }) => {
    // eslint-disable-next-line prefer-const
    let { role: _role, _name, sender, text, content: _content, lc_id } = message;
    if (lc_id && lc_id[2] && !langChain) {
        const roleMapping = {
            SystemMessage: 'system',
            HumanMessage: 'user',
            AIMessage: 'assistant',
        };
        _role = roleMapping[lc_id[2]] || _role;
    }
    const role = _role ??
        (sender != null && sender && sender.toLowerCase() === 'user'
            ? 'user'
            : 'assistant');
    const content = _content ?? text ?? '';
    const formattedMessage = {
        role,
        content,
    };
    // Set name fields first
    if (_name != null && _name) {
        formattedMessage.name = _name;
    }
    if (userName != null && userName && formattedMessage.role === 'user') {
        formattedMessage.name = userName;
    }
    if (assistantName != null &&
        assistantName &&
        formattedMessage.role === 'assistant') {
        formattedMessage.name = assistantName;
    }
    if (formattedMessage.name != null && formattedMessage.name) {
        // Conform to API regex: ^[a-zA-Z0-9_-]{1,64}$
        // https://community.openai.com/t/the-format-of-the-name-field-in-the-documentation-is-incorrect/175684/2
        formattedMessage.name = formattedMessage.name.replace(/[^a-zA-Z0-9_-]/g, '_');
        if (formattedMessage.name.length > 64) {
            formattedMessage.name = formattedMessage.name.substring(0, 64);
        }
    }
    const { image_urls, documents, videos, audios } = message;
    const mediaParts = [];
    if (Array.isArray(documents) && documents.length > 0) {
        mediaParts.push(...documents);
    }
    if (Array.isArray(videos) && videos.length > 0) {
        mediaParts.push(...videos);
    }
    if (Array.isArray(audios) && audios.length > 0) {
        mediaParts.push(...audios);
    }
    if (Array.isArray(image_urls) && image_urls.length > 0) {
        mediaParts.push(...image_urls);
    }
    if (mediaParts.length > 0 && role === 'user') {
        const mediaMessage = formatMediaMessage({
            message: {
                ...formattedMessage,
                content: typeof formattedMessage.content === 'string'
                    ? formattedMessage.content
                    : '',
            },
            mediaParts,
            endpoint,
        });
        if (!langChain) {
            return mediaMessage;
        }
        return new HumanMessage(mediaMessage);
    }
    if (!langChain) {
        return formattedMessage;
    }
    if (role === 'user') {
        return new HumanMessage(formattedMessage);
    }
    else if (role === 'assistant') {
        return new AIMessage(formattedMessage);
    }
    else {
        return new SystemMessage(formattedMessage);
    }
};
/**
 * Formats an array of messages for LangChain.
 *
 * @param messages - The array of messages to format.
 * @param formatOptions - The options for formatting each message.
 * @returns - The array of formatted LangChain messages.
 */
const formatLangChainMessages = (messages, formatOptions) => {
    return messages.map((msg) => {
        const formatted = formatMessage({
            ...formatOptions,
            message: msg,
            langChain: true,
        });
        return formatted;
    });
};
/**
 * Formats a LangChain message object by merging properties from `lc_kwargs` or `kwargs` and `additional_kwargs`.
 *
 * @param message - The message object to format.
 * @returns - The formatted LangChain message.
 */
const formatFromLangChain = (message) => {
    const kwargs = message.lc_kwargs ?? message.kwargs ?? {};
    const { additional_kwargs = {}, ...message_kwargs } = kwargs;
    return {
        ...message_kwargs,
        ...additional_kwargs,
    };
};
/**
 * Helper function to format an assistant message
 * @param message The message to format
 * @returns Array of formatted messages
 */
function formatAssistantMessage(message) {
    const formattedMessages = [];
    let currentContent = [];
    let lastAIMessage = null;
    let hasReasoning = false;
    if (Array.isArray(message.content)) {
        for (const part of message.content) {
            if (part == null) {
                continue;
            }
            if (part.type === ContentTypes.TEXT && part.tool_call_ids) {
                /*
                If there's pending content, it needs to be aggregated as a single string to prepare for tool calls.
                For Anthropic models, the "tool_calls" field on a message is only respected if content is a string.
                */
                if (currentContent.length > 0) {
                    let content = currentContent.reduce((acc, curr) => {
                        if (curr.type === ContentTypes.TEXT) {
                            return `${acc}${String(curr[ContentTypes.TEXT] ?? '')}\n`;
                        }
                        return acc;
                    }, '');
                    content =
                        `${content}\n${part[ContentTypes.TEXT] ?? part.text ?? ''}`.trim();
                    lastAIMessage = new AIMessage({ content });
                    formattedMessages.push(lastAIMessage);
                    currentContent = [];
                    continue;
                }
                // Create a new AIMessage with this text and prepare for tool calls
                lastAIMessage = new AIMessage({
                    content: part.text != null ? part.text : '',
                });
                formattedMessages.push(lastAIMessage);
            }
            else if (part.type === ContentTypes.TOOL_CALL) {
                // Skip malformed tool call entries without tool_call property
                if (part.tool_call == null) {
                    continue;
                }
                // Note: `tool_calls` list is defined when constructed by `AIMessage` class, and outputs should be excluded from it
                const { output, args: _args, ..._tool_call } = part.tool_call;
                // Skip invalid tool calls that have no name AND no output
                if (_tool_call.name == null ||
                    (_tool_call.name === '' && (output == null || output === ''))) {
                    continue;
                }
                if (!lastAIMessage) {
                    // "Heal" the payload by creating an AIMessage to precede the tool call
                    lastAIMessage = new AIMessage({ content: '' });
                    formattedMessages.push(lastAIMessage);
                }
                const tool_call = _tool_call;
                // TODO: investigate; args as dictionary may need to be providers-or-tool-specific
                let args = _args;
                try {
                    if (typeof _args === 'string') {
                        args = JSON.parse(_args);
                    }
                }
                catch {
                    if (typeof _args === 'string') {
                        args = { input: _args };
                    }
                }
                tool_call.args = args;
                if (!lastAIMessage.tool_calls) {
                    lastAIMessage.tool_calls = [];
                }
                lastAIMessage.tool_calls.push(tool_call);
                formattedMessages.push(new ToolMessage({
                    tool_call_id: tool_call.id ?? '',
                    name: tool_call.name,
                    content: output != null ? output : '',
                }));
            }
            else if (part.type === ContentTypes.THINK ||
                part.type === ContentTypes.THINKING ||
                part.type === ContentTypes.REASONING_CONTENT ||
                part.type === 'redacted_thinking') {
                hasReasoning = true;
                continue;
            }
            else if (part.type === ContentTypes.ERROR ||
                part.type === ContentTypes.AGENT_UPDATE) {
                continue;
            }
            else {
                if (part.type === ContentTypes.TEXT &&
                    !String(part.text ?? '').trim()) {
                    continue;
                }
                currentContent.push(part);
            }
        }
    }
    if (hasReasoning && currentContent.length > 0) {
        const content = currentContent
            .reduce((acc, curr) => {
            if (curr.type === ContentTypes.TEXT) {
                return `${acc}${String(curr[ContentTypes.TEXT] ?? '')}\n`;
            }
            return acc;
        }, '')
            .trim();
        if (content) {
            formattedMessages.push(new AIMessage({ content }));
        }
    }
    else if (currentContent.length > 0) {
        formattedMessages.push(new AIMessage({ content: currentContent }));
    }
    return formattedMessages;
}
/**
 * Labels all agent content for parallel patterns (fan-out/fan-in)
 * Groups consecutive content by agent and wraps with clear labels
 */
function labelAllAgentContent(contentParts, agentIdMap, agentNames) {
    const result = [];
    let currentAgentId;
    let agentContentBuffer = [];
    const flushAgentBuffer = () => {
        if (agentContentBuffer.length === 0) {
            return;
        }
        if (currentAgentId != null && currentAgentId !== '') {
            const agentName = (agentNames?.[currentAgentId] ?? '') || currentAgentId;
            const formattedParts = [];
            formattedParts.push(`--- ${agentName} ---`);
            for (const part of agentContentBuffer) {
                if (part.type === ContentTypes.THINK) {
                    const thinkContent = part.think || '';
                    if (thinkContent) {
                        formattedParts.push(`${agentName}: ${JSON.stringify({
                            type: 'think',
                            think: thinkContent,
                        })}`);
                    }
                }
                else if (part.type === ContentTypes.TEXT) {
                    const textContent = part.text ?? '';
                    if (textContent) {
                        formattedParts.push(`${agentName}: ${textContent}`);
                    }
                }
                else if (part.type === ContentTypes.TOOL_CALL) {
                    formattedParts.push(`${agentName}: ${JSON.stringify({
                        type: 'tool_call',
                        tool_call: part.tool_call,
                    })}`);
                }
            }
            formattedParts.push(`--- End of ${agentName} ---`);
            // Create a single text content part with all agent content
            result.push({
                type: ContentTypes.TEXT,
                text: formattedParts.join('\n\n'),
            });
        }
        else {
            // No agent ID, pass through as-is
            result.push(...agentContentBuffer);
        }
        agentContentBuffer = [];
    };
    for (let i = 0; i < contentParts.length; i++) {
        const part = contentParts[i];
        const agentId = agentIdMap[i];
        // If agent changed, flush previous buffer
        if (agentId !== currentAgentId && currentAgentId !== undefined) {
            flushAgentBuffer();
        }
        currentAgentId = agentId;
        agentContentBuffer.push(part);
    }
    // Flush any remaining content
    flushAgentBuffer();
    return result;
}
/**
 * Groups content parts by agent and formats them with agent labels
 * This preprocesses multi-agent content to prevent identity confusion
 *
 * @param contentParts - The content parts from a run
 * @param agentIdMap - Map of content part index to agent ID
 * @param agentNames - Optional map of agent ID to display name
 * @param options - Configuration options
 * @param options.labelNonTransferContent - If true, labels all agent transitions (for parallel patterns)
 * @returns Modified content parts with agent labels where appropriate
 */
const labelContentByAgent = (contentParts, agentIdMap, agentNames, options) => {
    if (!agentIdMap || Object.keys(agentIdMap).length === 0) {
        return contentParts;
    }
    // If labelNonTransferContent is true, use a different strategy for parallel patterns
    if (options?.labelNonTransferContent === true) {
        return labelAllAgentContent(contentParts, agentIdMap, agentNames);
    }
    const result = [];
    let currentAgentId;
    let agentContentBuffer = [];
    let transferToolCallIndex;
    let transferToolCallId;
    const flushAgentBuffer = () => {
        if (agentContentBuffer.length === 0) {
            return;
        }
        // If this is content from a transferred agent, format it specially
        if (currentAgentId != null &&
            currentAgentId !== '' &&
            transferToolCallIndex !== undefined) {
            const agentName = (agentNames?.[currentAgentId] ?? '') || currentAgentId;
            const formattedParts = [];
            formattedParts.push(`--- Transfer to ${agentName} ---`);
            for (const part of agentContentBuffer) {
                if (part.type === ContentTypes.THINK) {
                    formattedParts.push(`${agentName}: ${JSON.stringify({
                        type: 'think',
                        think: part.think,
                    })}`);
                }
                else if ('text' in part && part.type === ContentTypes.TEXT) {
                    const textContent = part.text ?? '';
                    if (textContent) {
                        formattedParts.push(`${agentName}: ${JSON.stringify({
                            type: 'text',
                            text: textContent,
                        })}`);
                    }
                }
                else if (part.type === ContentTypes.TOOL_CALL) {
                    formattedParts.push(`${agentName}: ${JSON.stringify({
                        type: 'tool_call',
                        tool_call: part.tool_call,
                    })}`);
                }
            }
            formattedParts.push(`--- End of ${agentName} response ---`);
            // Find the tool call that triggered this transfer and update its output
            if (transferToolCallIndex < result.length) {
                const transferToolCall = result[transferToolCallIndex];
                if (transferToolCall.type === ContentTypes.TOOL_CALL &&
                    transferToolCall.tool_call?.id === transferToolCallId) {
                    transferToolCall.tool_call.output = formattedParts.join('\n\n');
                }
            }
        }
        else {
            // Not from a transfer, add as-is
            result.push(...agentContentBuffer);
        }
        agentContentBuffer = [];
        transferToolCallIndex = undefined;
        transferToolCallId = undefined;
    };
    for (let i = 0; i < contentParts.length; i++) {
        const part = contentParts[i];
        const agentId = agentIdMap[i];
        // Check if this is a transfer tool call
        const isTransferTool = (part.type === ContentTypes.TOOL_CALL &&
            part.tool_call?.name?.startsWith('lc_transfer_to_')) ??
            false;
        // If agent changed, flush previous buffer
        if (agentId !== currentAgentId && currentAgentId !== undefined) {
            flushAgentBuffer();
        }
        currentAgentId = agentId;
        if (isTransferTool) {
            // Flush any existing buffer first
            flushAgentBuffer();
            // Add the transfer tool call to result
            result.push(part);
            // Mark that the next agent's content should be captured
            transferToolCallIndex = result.length - 1;
            transferToolCallId = part.tool_call?.id;
            currentAgentId = undefined; // Reset to capture the next agent
        }
        else {
            agentContentBuffer.push(part);
        }
    }
    flushAgentBuffer();
    return result;
};
/** Extracts tool names from a tool_search output JSON string. */
function extractToolNamesFromSearchOutput(output) {
    try {
        const parsed = JSON.parse(output);
        if (typeof parsed === 'object' &&
            parsed !== null &&
            Array.isArray(parsed.tools)) {
            return parsed.tools
                .map((t) => t.name)
                .filter((name) => typeof name === 'string');
        }
    }
    catch {
        /** Output may have warnings prepended, try to find JSON within it */
        const jsonMatch = output.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            try {
                const parsed = JSON.parse(jsonMatch[0]);
                if (typeof parsed === 'object' &&
                    parsed !== null &&
                    Array.isArray(parsed.tools)) {
                    return parsed.tools
                        .map((t) => t.name)
                        .filter((name) => typeof name === 'string');
                }
            }
            catch {
                /* ignore */
            }
        }
    }
    return [];
}
/**
 * Formats an array of messages for LangChain, handling tool calls and creating ToolMessage instances.
 *
 * @param payload - The array of messages to format.
 * @param indexTokenCountMap - Optional map of message indices to token counts.
 * @param tools - Optional set of tool names that are allowed in the request.
 * @returns - Object containing formatted messages and updated indexTokenCountMap if provided.
 */
const formatAgentMessages = (payload, indexTokenCountMap, tools) => {
    const messages = [];
    // If indexTokenCountMap is provided, create a new map to track the updated indices
    const updatedIndexTokenCountMap = {};
    // Keep track of the mapping from original payload indices to result indices
    const indexMapping = {};
    /**
     * Create a mutable copy of the tools set that can be expanded dynamically.
     * When we encounter tool_search results, we add discovered tools to this set,
     * making their subsequent tool calls valid.
     */
    const discoveredTools = tools ? new Set(tools) : undefined;
    // Process messages with tool conversion if tools set is provided
    for (let i = 0; i < payload.length; i++) {
        const message = payload[i];
        // Q: Store the current length of messages to track where this payload message starts in the result?
        // const startIndex = messages.length;
        if (typeof message.content === 'string') {
            message.content = [
                { type: ContentTypes.TEXT, [ContentTypes.TEXT]: message.content },
            ];
        }
        if (message.role !== 'assistant') {
            messages.push(formatMessage({
                message: message,
                langChain: true,
            }));
            // Update the index mapping for this message
            indexMapping[i] = [messages.length - 1];
            continue;
        }
        // For assistant messages, track the starting index before processing
        const startMessageIndex = messages.length;
        /**
         * If tools set is provided, process tool_calls:
         * - Keep valid tool_calls (tools in the set or dynamically discovered)
         * - Convert invalid tool_calls to string representation for context preservation
         * - Dynamically expand the set when tool_search results are encountered
         */
        let processedMessage = message;
        if (discoveredTools) {
            const content = message.content;
            if (content && Array.isArray(content)) {
                const filteredContent = [];
                const invalidToolCallIds = new Set();
                const invalidToolStrings = [];
                for (const part of content) {
                    if (part.type !== ContentTypes.TOOL_CALL) {
                        filteredContent.push(part);
                        continue;
                    }
                    /** Skip malformed tool_call entries */
                    if (part.tool_call == null ||
                        part.tool_call.name == null ||
                        part.tool_call.name === '') {
                        if (typeof part.tool_call?.id === 'string' &&
                            part.tool_call.id !== '') {
                            invalidToolCallIds.add(part.tool_call.id);
                        }
                        continue;
                    }
                    const toolName = part.tool_call.name;
                    /**
                     * If this is a tool_search result with output, extract discovered tool names
                     * and add them to the discoveredTools set for subsequent validation.
                     */
                    if (toolName === Constants.TOOL_SEARCH &&
                        typeof part.tool_call.output === 'string' &&
                        part.tool_call.output !== '') {
                        const extracted = extractToolNamesFromSearchOutput(part.tool_call.output);
                        for (const name of extracted) {
                            discoveredTools.add(name);
                        }
                    }
                    if (discoveredTools.has(toolName)) {
                        /** Valid tool - keep it */
                        filteredContent.push(part);
                    }
                    else {
                        /** Invalid tool - convert to string for context preservation */
                        if (typeof part.tool_call.id === 'string' &&
                            part.tool_call.id !== '') {
                            invalidToolCallIds.add(part.tool_call.id);
                        }
                        const output = part.tool_call.output ?? '';
                        invalidToolStrings.push(`Tool: ${toolName}, ${output}`);
                    }
                }
                /** Remove tool_call_ids references to invalid tools from text parts */
                if (invalidToolCallIds.size > 0) {
                    for (const part of filteredContent) {
                        if (part.type === ContentTypes.TEXT &&
                            Array.isArray(part.tool_call_ids)) {
                            part.tool_call_ids = part.tool_call_ids.filter((id) => !invalidToolCallIds.has(id));
                            if (part.tool_call_ids.length === 0) {
                                delete part.tool_call_ids;
                            }
                        }
                    }
                }
                /** Append invalid tool strings to the content for context preservation */
                if (invalidToolStrings.length > 0) {
                    /** Find the last text part or create one */
                    let lastTextPartIndex = -1;
                    for (let j = filteredContent.length - 1; j >= 0; j--) {
                        if (filteredContent[j].type === ContentTypes.TEXT) {
                            lastTextPartIndex = j;
                            break;
                        }
                    }
                    const invalidToolText = invalidToolStrings.join('\n');
                    if (lastTextPartIndex >= 0) {
                        const lastTextPart = filteredContent[lastTextPartIndex];
                        const existingText = lastTextPart[ContentTypes.TEXT] ?? lastTextPart.text ?? '';
                        filteredContent[lastTextPartIndex] = {
                            ...lastTextPart,
                            [ContentTypes.TEXT]: existingText
                                ? `${existingText}\n${invalidToolText}`
                                : invalidToolText,
                        };
                    }
                    else {
                        /** No text part exists, create one */
                        filteredContent.push({
                            type: ContentTypes.TEXT,
                            [ContentTypes.TEXT]: invalidToolText,
                        });
                    }
                }
                /** Use filtered content if we made any changes */
                if (filteredContent.length !== content.length ||
                    invalidToolStrings.length > 0) {
                    processedMessage = { ...message, content: filteredContent };
                }
            }
        }
        // Process the assistant message using the helper function
        const formattedMessages = formatAssistantMessage(processedMessage);
        messages.push(...formattedMessages);
        // Update the index mapping for this assistant message
        // Store all indices that were created from this original message
        const endMessageIndex = messages.length;
        const resultIndices = [];
        for (let j = startMessageIndex; j < endMessageIndex; j++) {
            resultIndices.push(j);
        }
        indexMapping[i] = resultIndices;
    }
    if (indexTokenCountMap) {
        for (let originalIndex = 0; originalIndex < payload.length; originalIndex++) {
            const resultIndices = indexMapping[originalIndex] || [];
            const tokenCount = indexTokenCountMap[originalIndex];
            if (tokenCount === undefined) {
                continue;
            }
            const msgCount = resultIndices.length;
            if (msgCount === 1) {
                updatedIndexTokenCountMap[resultIndices[0]] = tokenCount;
                continue;
            }
            if (msgCount < 2) {
                continue;
            }
            let totalLength = 0;
            const lastIdx = msgCount - 1;
            const lengths = new Array(msgCount);
            for (let k = 0; k < msgCount; k++) {
                const msg = messages[resultIndices[k]];
                const { content } = msg;
                let len = 0;
                if (typeof content === 'string') {
                    len = content.length;
                }
                else if (Array.isArray(content)) {
                    for (const part of content) {
                        if (typeof part === 'string') {
                            len += part.length;
                        }
                        else if (part != null && typeof part === 'object') {
                            const val = part.text ?? part.content;
                            if (typeof val === 'string') {
                                len += val.length;
                            }
                        }
                    }
                }
                const toolCalls = msg.tool_calls;
                if (Array.isArray(toolCalls)) {
                    for (const tc of toolCalls) {
                        if (typeof tc.name === 'string') {
                            len += tc.name.length;
                        }
                        const { args } = tc;
                        if (typeof args === 'string') {
                            len += args.length;
                        }
                        else if (args != null) {
                            len += JSON.stringify(args).length;
                        }
                    }
                }
                lengths[k] = len;
                totalLength += len;
            }
            if (totalLength === 0) {
                const countPerMessage = Math.floor(tokenCount / msgCount);
                for (let k = 0; k < lastIdx; k++) {
                    updatedIndexTokenCountMap[resultIndices[k]] = countPerMessage;
                }
                updatedIndexTokenCountMap[resultIndices[lastIdx]] =
                    tokenCount - countPerMessage * lastIdx;
            }
            else {
                let distributed = 0;
                for (let k = 0; k < lastIdx; k++) {
                    const share = Math.floor((lengths[k] / totalLength) * tokenCount);
                    updatedIndexTokenCountMap[resultIndices[k]] = share;
                    distributed += share;
                }
                updatedIndexTokenCountMap[resultIndices[lastIdx]] =
                    tokenCount - distributed;
            }
        }
    }
    return {
        messages,
        indexTokenCountMap: indexTokenCountMap
            ? updatedIndexTokenCountMap
            : undefined,
    };
};
/**
 * Adds a value at key 0 for system messages and shifts all key indices by one in an indexTokenCountMap.
 * This is useful when adding a system message at the beginning of a conversation.
 *
 * @param indexTokenCountMap - The original map of message indices to token counts
 * @param instructionsTokenCount - The token count for the system message to add at index 0
 * @returns A new map with the system message at index 0 and all other indices shifted by 1
 */
function shiftIndexTokenCountMap(indexTokenCountMap, instructionsTokenCount) {
    // Create a new map to avoid modifying the original
    const shiftedMap = {};
    shiftedMap[0] = instructionsTokenCount;
    // Shift all existing indices by 1
    for (const [indexStr, tokenCount] of Object.entries(indexTokenCountMap)) {
        const index = Number(indexStr);
        shiftedMap[index + 1] = tokenCount;
    }
    return shiftedMap;
}
/**
 * Ensures compatibility when switching from a non-thinking agent to a thinking-enabled agent.
 * Converts AI messages with tool calls (that lack thinking/reasoning blocks) into buffer strings,
 * avoiding the thinking block signature requirement.
 *
 * Recognizes the following as valid thinking/reasoning blocks:
 * - ContentTypes.THINKING (Anthropic)
 * - ContentTypes.REASONING_CONTENT (Bedrock)
 * - ContentTypes.REASONING (VertexAI / Google)
 * - 'redacted_thinking'
 *
 * @param messages - Array of messages to process
 * @param provider - The provider being used (unused but kept for future compatibility)
 * @returns The messages array with tool sequences converted to buffer strings if necessary
 */
function ensureThinkingBlockInMessages(messages, _provider) {
    if (messages.length === 0) {
        return messages;
    }
    // If the last message is already a HumanMessage, there is no trailing tool
    // sequence to convert — return early to preserve prompt caching and avoid
    // redundant token overhead from re-processing the entire history.
    const lastMsg = messages[messages.length - 1];
    const lastIsHuman = lastMsg instanceof HumanMessage ||
        ('role' in lastMsg && lastMsg.role === 'user');
    if (lastIsHuman) {
        return messages;
    }
    const result = [];
    let i = 0;
    while (i < messages.length) {
        const msg = messages[i];
        /** Detect AI messages by instanceof OR by role, in case cache-control cloning
         produced a plain object that lost the LangChain prototype. */
        const isAI = msg instanceof AIMessage ||
            msg instanceof AIMessageChunk ||
            ('role' in msg && msg.role === 'assistant');
        if (!isAI) {
            result.push(msg);
            i++;
            continue;
        }
        const aiMsg = msg;
        const hasToolCalls = aiMsg.tool_calls && aiMsg.tool_calls.length > 0;
        const contentIsArray = Array.isArray(aiMsg.content);
        // Check if the message has tool calls or tool_use content
        let hasToolUse = hasToolCalls ?? false;
        let hasThinkingBlock = false;
        if (contentIsArray && aiMsg.content.length > 0) {
            const content = aiMsg.content;
            hasToolUse =
                hasToolUse ||
                    content.some((c) => typeof c === 'object' && c.type === 'tool_use');
            // Check ALL content blocks for thinking/reasoning, not just [0].
            // Bedrock may emit a whitespace text chunk before the thinking block,
            // pushing the reasoning_content to index 1+.
            hasThinkingBlock = content.some((c) => typeof c === 'object' &&
                (c.type === ContentTypes.THINKING ||
                    c.type === ContentTypes.REASONING_CONTENT ||
                    c.type === ContentTypes.REASONING ||
                    c.type === 'redacted_thinking'));
        }
        // Bedrock also stores reasoning in additional_kwargs (may not be in content array)
        if (!hasThinkingBlock &&
            aiMsg.additional_kwargs.reasoning_content != null) {
            hasThinkingBlock = true;
        }
        // If message has tool use but no thinking block, check whether this is a
        // continuation of a thinking-enabled agent's chain before converting.
        // Bedrock reasoning models can produce multiple AI→Tool rounds after an
        // initial reasoning response: the first AI message has reasoning_content,
        // but follow-ups have content: "" with only tool_calls. These are the
        // same agent's turn and must NOT be converted to HumanMessages.
        if (hasToolUse && !hasThinkingBlock) {
            // Walk backwards — if an earlier AI message in the same chain (before
            // the nearest HumanMessage) has a thinking/reasoning block, this is a
            // continuation of a thinking-enabled turn, not a non-thinking handoff.
            if (chainHasThinkingBlock(messages, i)) {
                result.push(msg);
                i++;
                continue;
            }
            // Collect the AI message and any following tool messages
            const toolSequence = [msg];
            let j = i + 1;
            // Look ahead for tool messages that belong to this AI message
            const isToolMsg = (m) => m instanceof ToolMessage || ('role' in m && m.role === 'tool');
            while (j < messages.length && isToolMsg(messages[j])) {
                toolSequence.push(messages[j]);
                j++;
            }
            // Convert the sequence to a buffer string and wrap in a HumanMessage
            // This avoids the thinking block requirement which only applies to AI messages
            const bufferString = getBufferString(toolSequence);
            result.push(new HumanMessage({
                content: `[Previous agent context]\n${bufferString}`,
            }));
            // Skip the messages we've processed
            i = j;
        }
        else {
            // Keep the message as is
            result.push(msg);
            i++;
        }
    }
    return result;
}
/**
 * Walks backwards from `currentIndex` through the message array to check
 * whether an earlier AI message in the same "chain" (no HumanMessage boundary)
 * contains a thinking/reasoning block.
 *
 * A "chain" is a contiguous sequence of AI + Tool messages with no intervening
 * HumanMessage. Bedrock reasoning models produce reasoning on the first AI
 * response, then issue follow-up tool calls with `content: ""` and no
 * reasoning block. These follow-ups are part of the same thinking-enabled
 * turn and should not be converted.
 */
function chainHasThinkingBlock(messages, currentIndex) {
    for (let k = currentIndex - 1; k >= 0; k--) {
        const prev = messages[k];
        // HumanMessage = turn boundary — stop searching
        if (prev instanceof HumanMessage ||
            ('role' in prev && prev.role === 'user')) {
            return false;
        }
        // Check AI messages for thinking/reasoning blocks
        const isPrevAI = prev instanceof AIMessage ||
            prev instanceof AIMessageChunk ||
            ('role' in prev && prev.role === 'assistant');
        if (isPrevAI) {
            const prevAiMsg = prev;
            if (Array.isArray(prevAiMsg.content) && prevAiMsg.content.length > 0) {
                const content = prevAiMsg.content;
                if (content.some((c) => typeof c === 'object' &&
                    (c.type === ContentTypes.THINKING ||
                        c.type === ContentTypes.REASONING_CONTENT ||
                        c.type === ContentTypes.REASONING ||
                        c.type === 'redacted_thinking'))) {
                    return true;
                }
            }
            // Bedrock also stores reasoning in additional_kwargs
            if (prevAiMsg.additional_kwargs.reasoning_content != null) {
                return true;
            }
        }
        // ToolMessages are part of the chain — keep walking back
    }
    return false;
}

export { ensureThinkingBlockInMessages, formatAgentMessages, formatFromLangChain, formatLangChainMessages, formatMediaMessage, formatMessage, labelContentByAgent, shiftIndexTokenCountMap };
//# sourceMappingURL=format.mjs.map
