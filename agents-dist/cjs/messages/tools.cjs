'use strict';

var messages = require('@langchain/core/messages');
var _enum = require('../common/enum.cjs');
var core = require('./core.cjs');

// src/messages/toolDiscovery.ts
/**
 * Extracts discovered tool names from tool search results in the current turn.
 * Only processes tool search messages after the latest AI message with tool calls.
 *
 * Similar pattern to formatArtifactPayload - finds relevant messages efficiently
 * by identifying the latest AI parent and only processing subsequent tool messages.
 *
 * @param messages - All messages in the conversation
 * @returns Array of discovered tool names (empty if no new discoveries)
 */
function extractToolDiscoveries(messages$1) {
    const lastMessage = messages$1[messages$1.length - 1];
    if (!(lastMessage instanceof messages.ToolMessage))
        return [];
    // Find the latest AIMessage with tool_calls that this tool message belongs to
    const latestAIParentIndex = core.findLastIndex(messages$1, (msg) => (msg instanceof messages.AIMessageChunk &&
        (msg.tool_calls?.length ?? 0) > 0 &&
        msg.tool_calls?.some((tc) => tc.id === lastMessage.tool_call_id)) ??
        false);
    if (latestAIParentIndex === -1)
        return [];
    // Collect tool_call_ids from the AI message
    const aiMessage = messages$1[latestAIParentIndex];
    const toolCallIds = new Set(aiMessage.tool_calls?.map((tc) => tc.id) ?? []);
    // Only process tool search results after the AI message that belong to this turn
    const discoveredNames = [];
    for (let i = latestAIParentIndex + 1; i < messages$1.length; i++) {
        const msg = messages$1[i];
        if (!(msg instanceof messages.ToolMessage))
            continue;
        if (msg.name !== _enum.Constants.TOOL_SEARCH)
            continue;
        if (!toolCallIds.has(msg.tool_call_id))
            continue;
        // This is a tool search result from the current turn
        if (typeof msg.artifact === 'object' && msg.artifact != null) {
            const artifact = msg.artifact;
            if (artifact.tool_references && artifact.tool_references.length > 0) {
                for (const ref of artifact.tool_references) {
                    discoveredNames.push(ref.tool_name);
                }
            }
        }
    }
    return discoveredNames;
}
/**
 * Checks if the current turn has any tool search results.
 * Quick check to avoid full extraction when not needed.
 */
function hasToolSearchInCurrentTurn(messages$1) {
    const lastMessage = messages$1[messages$1.length - 1];
    if (!(lastMessage instanceof messages.ToolMessage))
        return false;
    // Find the latest AIMessage with tool_calls
    const latestAIParentIndex = core.findLastIndex(messages$1, (msg) => (msg instanceof messages.AIMessageChunk &&
        (msg.tool_calls?.length ?? 0) > 0 &&
        msg.tool_calls?.some((tc) => tc.id === lastMessage.tool_call_id)) ??
        false);
    if (latestAIParentIndex === -1)
        return false;
    const aiMessage = messages$1[latestAIParentIndex];
    const toolCallIds = new Set(aiMessage.tool_calls?.map((tc) => tc.id) ?? []);
    // Check if any tool search results exist after the AI message
    for (let i = latestAIParentIndex + 1; i < messages$1.length; i++) {
        const msg = messages$1[i];
        if (msg instanceof messages.ToolMessage &&
            msg.name === _enum.Constants.TOOL_SEARCH &&
            toolCallIds.has(msg.tool_call_id)) {
            return true;
        }
    }
    return false;
}

exports.extractToolDiscoveries = extractToolDiscoveries;
exports.hasToolSearchInCurrentTurn = hasToolSearchInCurrentTurn;
//# sourceMappingURL=tools.cjs.map
