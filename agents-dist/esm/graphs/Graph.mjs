import { nanoid } from 'nanoid';
import { concat } from '@langchain/core/utils/stream';
import { ChatVertexAI } from '@langchain/google-vertexai';
import { Annotation, messagesStateReducer, StateGraph, START, END } from '@langchain/langgraph';
import { RunnableLambda } from '@langchain/core/runnables';
import { SystemMessage, AIMessageChunk, ToolMessage } from '@langchain/core/messages';
import { convertMessagesToContent, modifyDeltaProperties, formatAnthropicArtifactContent, formatArtifactPayload } from '../messages/core.mjs';
import { getMessageId } from '../messages/ids.mjs';
import { createPruneMessages } from '../messages/prune.mjs';
import { ensureThinkingBlockInMessages } from '../messages/format.mjs';
import { addCacheControl, addBedrockCacheControl } from '../messages/cache.mjs';
import { formatContentStrings } from '../messages/content.mjs';
import { extractToolDiscoveries } from '../messages/tools.mjs';
import { GraphNodeKeys, ContentTypes, Providers, GraphEvents, StepTypes } from '../common/enum.mjs';
import { resetIfNotEmpty, joinKeys } from '../utils/graph.mjs';
import { isOpenAILike, isGoogleLike } from '../utils/llm.mjs';
import { ChatModelStreamHandler } from '../stream.mjs';
import { handleToolCalls } from '../tools/handlers.mjs';
import { sleep } from '../utils/run.mjs';
import 'js-tiktoken/lite';
import 'zod-to-json-schema';
import { getChatModelClass, manualToolStreamProviders } from '../llm/providers.mjs';
import { ToolNode, toolsCondition } from '../tools/ToolNode.mjs';
import { ChatOpenAI, AzureChatOpenAI } from '../llm/openai/index.mjs';
import { safeDispatchCustomEvent } from '../utils/events.mjs';
import { createSchemaOnlyTools } from '../tools/schema.mjs';
import { AgentContext } from '../agents/AgentContext.mjs';
import { createFakeStreamingLLM } from '../llm/fake.mjs';

/* eslint-disable no-console */
// src/graphs/Graph.ts
const { AGENT, TOOLS } = GraphNodeKeys;
class Graph {
    messageStepHasToolCalls = new Map();
    messageIdsByStepKey = new Map();
    prelimMessageIdsByStepKey = new Map();
    config;
    contentData = [];
    stepKeyIds = new Map();
    contentIndexMap = new Map();
    toolCallStepIds = new Map();
    signal;
    /** Set of invoked tool call IDs from non-message run steps completed mid-run, if any */
    invokedToolIds;
    handlerRegistry;
    /**
     * Tool session contexts for automatic state persistence across tool invocations.
     * Keyed by tool name (e.g., Constants.EXECUTE_CODE).
     * Currently supports code execution session tracking (session_id, files).
     */
    sessions = new Map();
    /**
     * Clears heavy references to allow GC to reclaim memory held by
     * LangGraph's internal config / AsyncLocalStorage RunTree chain.
     * Call after a run completes and content has been extracted.
     */
    clearHeavyState() {
        this.config = undefined;
        this.signal = undefined;
        this.contentData = [];
        this.contentIndexMap = new Map();
        this.stepKeyIds = new Map();
        this.toolCallStepIds.clear();
        this.messageIdsByStepKey = new Map();
        this.messageStepHasToolCalls = new Map();
        this.prelimMessageIdsByStepKey = new Map();
        this.invokedToolIds = undefined;
        this.handlerRegistry = undefined;
        this.sessions.clear();
    }
}
class StandardGraph extends Graph {
    overrideModel;
    /** Optional compile options passed into workflow.compile() */
    compileOptions;
    messages = [];
    runId;
    startIndex = 0;
    signal;
    /** Map of agent contexts by agent ID */
    agentContexts = new Map();
    /** Default agent ID to use */
    defaultAgentId;
    constructor({ 
    // parent-level graph inputs
    runId, signal, agents, tokenCounter, indexTokenCountMap, }) {
        super();
        this.runId = runId;
        this.signal = signal;
        if (agents.length === 0) {
            throw new Error('At least one agent configuration is required');
        }
        for (const agentConfig of agents) {
            const agentContext = AgentContext.fromConfig(agentConfig, tokenCounter, indexTokenCountMap);
            this.agentContexts.set(agentConfig.agentId, agentContext);
        }
        this.defaultAgentId = agents[0].agentId;
    }
    /* Init */
    resetValues(keepContent) {
        this.messages = [];
        this.config = resetIfNotEmpty(this.config, undefined);
        if (keepContent !== true) {
            this.contentData = resetIfNotEmpty(this.contentData, []);
            this.contentIndexMap = resetIfNotEmpty(this.contentIndexMap, new Map());
        }
        this.stepKeyIds = resetIfNotEmpty(this.stepKeyIds, new Map());
        /**
         * Clear in-place instead of replacing with a new Map to preserve the
         * shared reference held by ToolNode (passed at construction time).
         * Using resetIfNotEmpty would create a new Map, leaving ToolNode with
         * a stale reference on 2nd+ processStream calls.
         */
        this.toolCallStepIds.clear();
        this.messageIdsByStepKey = resetIfNotEmpty(this.messageIdsByStepKey, new Map());
        this.messageStepHasToolCalls = resetIfNotEmpty(this.messageStepHasToolCalls, new Map());
        this.prelimMessageIdsByStepKey = resetIfNotEmpty(this.prelimMessageIdsByStepKey, new Map());
        this.invokedToolIds = resetIfNotEmpty(this.invokedToolIds, undefined);
        for (const context of this.agentContexts.values()) {
            context.reset();
        }
    }
    clearHeavyState() {
        super.clearHeavyState();
        this.messages = [];
        this.overrideModel = undefined;
        for (const context of this.agentContexts.values()) {
            context.reset();
        }
    }
    /* Run Step Processing */
    getRunStep(stepId) {
        const index = this.contentIndexMap.get(stepId);
        if (index !== undefined) {
            return this.contentData[index];
        }
        return undefined;
    }
    getAgentContext(metadata) {
        if (!metadata) {
            throw new Error('No metadata provided to retrieve agent context');
        }
        const currentNode = metadata.langgraph_node;
        if (!currentNode) {
            throw new Error('No langgraph_node in metadata to retrieve agent context');
        }
        let agentId;
        if (currentNode.startsWith(AGENT)) {
            agentId = currentNode.substring(AGENT.length);
        }
        else if (currentNode.startsWith(TOOLS)) {
            agentId = currentNode.substring(TOOLS.length);
        }
        const agentContext = this.agentContexts.get(agentId ?? '');
        if (!agentContext) {
            throw new Error(`No agent context found for agent ID ${agentId}`);
        }
        return agentContext;
    }
    getStepKey(metadata) {
        if (!metadata)
            return '';
        const keyList = this.getKeyList(metadata);
        if (this.checkKeyList(keyList)) {
            throw new Error('Missing metadata');
        }
        return joinKeys(keyList);
    }
    getStepIdByKey(stepKey, index) {
        const stepIds = this.stepKeyIds.get(stepKey);
        if (!stepIds) {
            throw new Error(`No step IDs found for stepKey ${stepKey}`);
        }
        if (index === undefined) {
            return stepIds[stepIds.length - 1];
        }
        return stepIds[index];
    }
    generateStepId(stepKey) {
        const stepIds = this.stepKeyIds.get(stepKey);
        let newStepId;
        let stepIndex = 0;
        if (stepIds) {
            stepIndex = stepIds.length;
            newStepId = `step_${nanoid()}`;
            stepIds.push(newStepId);
            this.stepKeyIds.set(stepKey, stepIds);
        }
        else {
            newStepId = `step_${nanoid()}`;
            this.stepKeyIds.set(stepKey, [newStepId]);
        }
        return [newStepId, stepIndex];
    }
    getKeyList(metadata) {
        if (!metadata)
            return [];
        const keyList = [
            metadata.run_id,
            metadata.thread_id,
            metadata.langgraph_node,
            metadata.langgraph_step,
            metadata.checkpoint_ns,
        ];
        const agentContext = this.getAgentContext(metadata);
        if (agentContext.currentTokenType === ContentTypes.THINK ||
            agentContext.currentTokenType === 'think_and_text') {
            keyList.push('reasoning');
        }
        else if (agentContext.tokenTypeSwitch === 'content') {
            keyList.push(`post-reasoning-${agentContext.reasoningTransitionCount}`);
        }
        if (this.invokedToolIds != null && this.invokedToolIds.size > 0) {
            keyList.push(this.invokedToolIds.size + '');
        }
        return keyList;
    }
    checkKeyList(keyList) {
        return keyList.some((key) => key === undefined);
    }
    /* Misc.*/
    getRunMessages() {
        return this.messages.slice(this.startIndex);
    }
    getContentParts() {
        return convertMessagesToContent(this.messages.slice(this.startIndex));
    }
    /**
     * Get all run steps, optionally filtered by agent ID
     */
    getRunSteps(agentId) {
        if (agentId == null || agentId === '') {
            return [...this.contentData];
        }
        return this.contentData.filter((step) => step.agentId === agentId);
    }
    /**
     * Get run steps grouped by agent ID
     */
    getRunStepsByAgent() {
        const stepsByAgent = new Map();
        for (const step of this.contentData) {
            if (step.agentId == null || step.agentId === '')
                continue;
            const steps = stepsByAgent.get(step.agentId) ?? [];
            steps.push(step);
            stepsByAgent.set(step.agentId, steps);
        }
        return stepsByAgent;
    }
    /**
     * Get agent IDs that participated in this run
     */
    getActiveAgentIds() {
        const agentIds = new Set();
        for (const step of this.contentData) {
            if (step.agentId != null && step.agentId !== '') {
                agentIds.add(step.agentId);
            }
        }
        return Array.from(agentIds);
    }
    /**
     * Maps contentPart indices to agent IDs for post-run analysis
     * Returns a map where key is the contentPart index and value is the agentId
     */
    getContentPartAgentMap() {
        const contentPartAgentMap = new Map();
        for (const step of this.contentData) {
            if (step.agentId != null &&
                step.agentId !== '' &&
                Number.isFinite(step.index)) {
                contentPartAgentMap.set(step.index, step.agentId);
            }
        }
        return contentPartAgentMap;
    }
    /* Graph */
    createSystemRunnable({ provider, clientOptions, instructions, additional_instructions, }) {
        let finalInstructions = instructions;
        if (additional_instructions != null && additional_instructions !== '') {
            finalInstructions =
                finalInstructions != null && finalInstructions
                    ? `${finalInstructions}\n\n${additional_instructions}`
                    : additional_instructions;
        }
        if (finalInstructions != null &&
            finalInstructions &&
            provider === Providers.ANTHROPIC &&
            clientOptions.promptCache === true) {
            finalInstructions = {
                content: [
                    {
                        type: 'text',
                        text: instructions,
                        cache_control: { type: 'ephemeral' },
                    },
                ],
            };
        }
        if (finalInstructions != null && finalInstructions !== '') {
            const systemMessage = new SystemMessage(finalInstructions);
            return RunnableLambda.from((messages) => {
                return [systemMessage, ...messages];
            }).withConfig({ runName: 'prompt' });
        }
    }
    initializeTools({ currentTools, currentToolMap, agentContext, }) {
        const toolDefinitions = agentContext?.toolDefinitions;
        const eventDrivenMode = toolDefinitions != null && toolDefinitions.length > 0;
        if (eventDrivenMode) {
            const schemaTools = createSchemaOnlyTools(toolDefinitions);
            const toolDefMap = new Map(toolDefinitions.map((def) => [def.name, def]));
            const graphTools = agentContext?.graphTools;
            const directToolNames = new Set();
            const allTools = [...schemaTools];
            const allToolMap = new Map(schemaTools.map((tool) => [tool.name, tool]));
            if (graphTools && graphTools.length > 0) {
                for (const tool of graphTools) {
                    if ('name' in tool) {
                        allTools.push(tool);
                        allToolMap.set(tool.name, tool);
                        directToolNames.add(tool.name);
                    }
                }
            }
            return new ToolNode({
                tools: allTools,
                toolMap: allToolMap,
                eventDrivenMode: true,
                sessions: this.sessions,
                toolDefinitions: toolDefMap,
                agentId: agentContext?.agentId,
                toolCallStepIds: this.toolCallStepIds,
                toolRegistry: agentContext?.toolRegistry,
                directToolNames: directToolNames.size > 0 ? directToolNames : undefined,
                errorHandler: (data, metadata) => StandardGraph.handleToolCallErrorStatic(this, data, metadata),
            });
        }
        const graphTools = agentContext?.graphTools;
        const baseTools = currentTools ?? [];
        const allTraditionalTools = graphTools && graphTools.length > 0
            ? [...baseTools, ...graphTools]
            : baseTools;
        const traditionalToolMap = graphTools && graphTools.length > 0
            ? new Map([
                ...(currentToolMap ?? new Map()),
                ...graphTools
                    .filter((t) => 'name' in t)
                    .map((t) => [t.name, t]),
            ])
            : currentToolMap;
        return new ToolNode({
            tools: allTraditionalTools,
            toolMap: traditionalToolMap,
            toolCallStepIds: this.toolCallStepIds,
            errorHandler: (data, metadata) => StandardGraph.handleToolCallErrorStatic(this, data, metadata),
            toolRegistry: agentContext?.toolRegistry,
            sessions: this.sessions,
        });
    }
    initializeModel({ provider, tools, clientOptions, }) {
        const ChatModelClass = getChatModelClass(provider);
        const model = new ChatModelClass(clientOptions ?? {});
        if (isOpenAILike(provider) &&
            (model instanceof ChatOpenAI || model instanceof AzureChatOpenAI)) {
            model.temperature = clientOptions
                .temperature;
            model.topP = clientOptions.topP;
            model.frequencyPenalty = clientOptions
                .frequencyPenalty;
            model.presencePenalty = clientOptions
                .presencePenalty;
            model.n = clientOptions.n;
        }
        else if (provider === Providers.VERTEXAI &&
            model instanceof ChatVertexAI) {
            model.temperature = clientOptions
                .temperature;
            model.topP = clientOptions.topP;
            model.topK = clientOptions.topK;
            model.topLogprobs = clientOptions
                .topLogprobs;
            model.frequencyPenalty = clientOptions
                .frequencyPenalty;
            model.presencePenalty = clientOptions
                .presencePenalty;
            model.maxOutputTokens = clientOptions
                .maxOutputTokens;
        }
        if (!tools || tools.length === 0) {
            return model;
        }
        return model.bindTools(tools);
    }
    overrideTestModel(responses, sleep, toolCalls) {
        this.overrideModel = createFakeStreamingLLM({
            responses,
            sleep,
            toolCalls,
        });
    }
    getNewModel({ provider, clientOptions, }) {
        const ChatModelClass = getChatModelClass(provider);
        return new ChatModelClass(clientOptions ?? {});
    }
    getUsageMetadata(finalMessage) {
        if (finalMessage &&
            'usage_metadata' in finalMessage &&
            finalMessage.usage_metadata != null) {
            return finalMessage.usage_metadata;
        }
    }
    /** Execute model invocation with streaming support */
    async attemptInvoke({ currentModel, finalMessages, provider, tools: _tools, }, config) {
        const model = this.overrideModel ?? currentModel;
        if (!model) {
            throw new Error('No model found');
        }
        if (model.stream) {
            /**
             * Process all model output through a local ChatModelStreamHandler in the
             * graph execution context. Each chunk is awaited before the next one is
             * consumed, so by the time the stream is exhausted every run step
             * (MESSAGE_CREATION, TOOL_CALLS) has been created and toolCallStepIds is
             * fully populated — the graph will not transition to ToolNode until this
             * is done.
             *
             * This replaces the previous pattern where ChatModelStreamHandler lived
             * in the for-await stream consumer (handler registry). That consumer
             * runs concurrently with graph execution, so the graph could advance to
             * ToolNode before the consumer had processed all events. By handling
             * chunks here, inside the agent node, the race is eliminated.
             *
             * The for-await consumer no longer needs a ChatModelStreamHandler; its
             * on_chat_model_stream events are simply ignored (no handler registered).
             * The dispatched custom events (ON_RUN_STEP, ON_MESSAGE_DELTA, etc.)
             * still reach the content aggregator and SSE handlers through the custom
             * event callback in Run.createCustomEventCallback.
             */
            const metadata = config?.metadata;
            const streamHandler = new ChatModelStreamHandler();
            const stream = await model.stream(finalMessages, config);
            let finalChunk;
            for await (const chunk of stream) {
                await streamHandler.handle(GraphEvents.CHAT_MODEL_STREAM, { chunk }, metadata, this);
                finalChunk = finalChunk ? concat(finalChunk, chunk) : chunk;
            }
            if (manualToolStreamProviders.has(provider)) {
                finalChunk = modifyDeltaProperties(provider, finalChunk);
            }
            if ((finalChunk?.tool_calls?.length ?? 0) > 0) {
                finalChunk.tool_calls = finalChunk.tool_calls?.filter((tool_call) => !!tool_call.name);
            }
            return { messages: [finalChunk] };
        }
        else {
            /** Fallback for models without stream support. */
            const finalMessage = await model.invoke(finalMessages, config);
            if ((finalMessage.tool_calls?.length ?? 0) > 0) {
                finalMessage.tool_calls = finalMessage.tool_calls?.filter((tool_call) => !!tool_call.name);
            }
            return { messages: [finalMessage] };
        }
    }
    cleanupSignalListener(currentModel) {
        if (!this.signal) {
            return;
        }
        const model = this.overrideModel ?? currentModel;
        if (!model) {
            return;
        }
        const client = model?.exposedClient;
        if (!client?.abortHandler) {
            return;
        }
        this.signal.removeEventListener('abort', client.abortHandler);
        client.abortHandler = undefined;
    }
    createCallModel(agentId = 'default') {
        return async (state, config) => {
            /**
             * Get agent context - it must exist by this point
             */
            const agentContext = this.agentContexts.get(agentId);
            if (!agentContext) {
                throw new Error(`Agent context not found for agentId: ${agentId}`);
            }
            if (!config) {
                throw new Error('No config provided');
            }
            const { messages } = state;
            // Extract tool discoveries from current turn only (similar to formatArtifactPayload pattern)
            const discoveredNames = extractToolDiscoveries(messages);
            if (discoveredNames.length > 0) {
                agentContext.markToolsAsDiscovered(discoveredNames);
            }
            const toolsForBinding = agentContext.getToolsForBinding();
            let model = this.overrideModel ??
                this.initializeModel({
                    tools: toolsForBinding,
                    provider: agentContext.provider,
                    clientOptions: agentContext.clientOptions,
                });
            if (agentContext.systemRunnable) {
                model = agentContext.systemRunnable.pipe(model);
            }
            if (agentContext.tokenCalculationPromise) {
                await agentContext.tokenCalculationPromise;
            }
            if (!config.signal) {
                config.signal = this.signal;
            }
            this.config = config;
            let messagesToUse = messages;
            if (!agentContext.pruneMessages &&
                agentContext.tokenCounter &&
                agentContext.maxContextTokens != null &&
                agentContext.indexTokenCountMap[0] != null) {
                const isAnthropicWithThinking = (agentContext.provider === Providers.ANTHROPIC &&
                    agentContext.clientOptions.thinking !=
                        null) ||
                    (agentContext.provider === Providers.BEDROCK &&
                        agentContext.clientOptions
                            .additionalModelRequestFields?.['thinking'] != null) ||
                    (agentContext.provider === Providers.OPENAI &&
                        agentContext.clientOptions.modelKwargs
                            ?.thinking?.type === 'enabled');
                agentContext.pruneMessages = createPruneMessages({
                    startIndex: this.startIndex,
                    provider: agentContext.provider,
                    tokenCounter: agentContext.tokenCounter,
                    maxTokens: agentContext.maxContextTokens,
                    thinkingEnabled: isAnthropicWithThinking,
                    indexTokenCountMap: agentContext.indexTokenCountMap,
                });
            }
            if (agentContext.pruneMessages) {
                const { context, indexTokenCountMap } = agentContext.pruneMessages({
                    messages,
                    usageMetadata: agentContext.currentUsage,
                    // startOnMessageType: 'human',
                });
                agentContext.indexTokenCountMap = indexTokenCountMap;
                messagesToUse = context;
            }
            let finalMessages = messagesToUse;
            if (agentContext.useLegacyContent) {
                finalMessages = formatContentStrings(finalMessages);
            }
            const lastMessageX = finalMessages.length >= 2
                ? finalMessages[finalMessages.length - 2]
                : null;
            const lastMessageY = finalMessages.length >= 1
                ? finalMessages[finalMessages.length - 1]
                : null;
            if (agentContext.provider === Providers.BEDROCK &&
                lastMessageX instanceof AIMessageChunk &&
                lastMessageY instanceof ToolMessage &&
                typeof lastMessageX.content === 'string') {
                finalMessages[finalMessages.length - 2].content = '';
            }
            const isLatestToolMessage = lastMessageY instanceof ToolMessage;
            if (isLatestToolMessage &&
                agentContext.provider === Providers.ANTHROPIC) {
                formatAnthropicArtifactContent(finalMessages);
            }
            else if (isLatestToolMessage &&
                ((isOpenAILike(agentContext.provider) &&
                    agentContext.provider !== Providers.DEEPSEEK) ||
                    isGoogleLike(agentContext.provider))) {
                formatArtifactPayload(finalMessages);
            }
            if (agentContext.provider === Providers.ANTHROPIC) {
                const anthropicOptions = agentContext.clientOptions;
                if (anthropicOptions?.promptCache === true) {
                    finalMessages = addCacheControl(finalMessages);
                }
            }
            else if (agentContext.provider === Providers.BEDROCK) {
                const bedrockOptions = agentContext.clientOptions;
                if (bedrockOptions?.promptCache === true) {
                    finalMessages = addBedrockCacheControl(finalMessages);
                }
            }
            /**
             * Handle edge case: when switching from a non-thinking agent to a thinking-enabled agent,
             * convert AI messages with tool calls to HumanMessages to avoid thinking block requirements.
             * This is required by Anthropic/Bedrock when thinking is enabled.
             */
            const isAnthropicWithThinking = (agentContext.provider === Providers.ANTHROPIC &&
                agentContext.clientOptions.thinking !=
                    null) ||
                (agentContext.provider === Providers.BEDROCK &&
                    agentContext.clientOptions
                        .additionalModelRequestFields?.['thinking'] != null);
            if (isAnthropicWithThinking) {
                finalMessages = ensureThinkingBlockInMessages(finalMessages, agentContext.provider);
            }
            if (agentContext.lastStreamCall != null &&
                agentContext.streamBuffer != null) {
                const timeSinceLastCall = Date.now() - agentContext.lastStreamCall;
                if (timeSinceLastCall < agentContext.streamBuffer) {
                    const timeToWait = Math.ceil((agentContext.streamBuffer - timeSinceLastCall) / 1000) *
                        1000;
                    await sleep(timeToWait);
                }
            }
            agentContext.lastStreamCall = Date.now();
            let result;
            const fallbacks = agentContext.clientOptions?.fallbacks ??
                [];
            if (finalMessages.length === 0) {
                throw new Error(JSON.stringify({
                    type: 'empty_messages',
                    info: 'Message pruning removed all messages as none fit in the context window. Please increase the context window size or make your message shorter.',
                }));
            }
            try {
                result = await this.attemptInvoke({
                    currentModel: model,
                    finalMessages,
                    provider: agentContext.provider,
                    tools: agentContext.tools,
                }, config);
            }
            catch (primaryError) {
                let lastError = primaryError;
                for (const fb of fallbacks) {
                    try {
                        let model = this.getNewModel({
                            provider: fb.provider,
                            clientOptions: fb.clientOptions,
                        });
                        const bindableTools = agentContext.tools;
                        model = (!bindableTools || bindableTools.length === 0
                            ? model
                            : model.bindTools(bindableTools));
                        result = await this.attemptInvoke({
                            currentModel: model,
                            finalMessages,
                            provider: fb.provider,
                            tools: agentContext.tools,
                        }, config);
                        lastError = undefined;
                        break;
                    }
                    catch (e) {
                        lastError = e;
                        continue;
                    }
                }
                if (lastError !== undefined) {
                    throw lastError;
                }
            }
            if (!result) {
                throw new Error('No result after model invocation');
            }
            /**
             * Fallback: populate toolCallStepIds in the graph execution context.
             *
             * When model.stream() is available (the common case), attemptInvoke
             * processes all chunks through a local ChatModelStreamHandler which
             * creates run steps and populates toolCallStepIds before returning.
             * The code below is a fallback for the rare case where model.stream
             * is unavailable and model.invoke() was used instead.
             *
             * Text content is dispatched FIRST so that MESSAGE_CREATION is the
             * current step when handleToolCalls runs. handleToolCalls then creates
             * TOOL_CALLS on top of it. The dedup in getMessageId and
             * toolCallStepIds.has makes this safe when attemptInvoke already
             * handled everything — both paths become no-ops.
             */
            const responseMessage = result.messages?.[0];
            const toolCalls = responseMessage
                ?.tool_calls;
            const hasToolCalls = Array.isArray(toolCalls) && toolCalls.length > 0;
            if (hasToolCalls) {
                const metadata = config.metadata;
                const stepKey = this.getStepKey(metadata);
                const content = responseMessage?.content;
                const hasTextContent = content != null &&
                    (typeof content === 'string'
                        ? content !== ''
                        : Array.isArray(content) && content.length > 0);
                /**
                 * Dispatch text content BEFORE creating TOOL_CALLS steps.
                 * getMessageId returns a new ID only on the first call for a step key;
                 * if the for-await consumer already claimed it, this is a no-op.
                 */
                if (hasTextContent) {
                    const messageId = getMessageId(stepKey, this) ?? '';
                    if (messageId) {
                        await this.dispatchRunStep(stepKey, {
                            type: StepTypes.MESSAGE_CREATION,
                            message_creation: { message_id: messageId },
                        }, metadata);
                        const stepId = this.getStepIdByKey(stepKey);
                        if (typeof content === 'string') {
                            await this.dispatchMessageDelta(stepId, {
                                content: [{ type: ContentTypes.TEXT, text: content }],
                            });
                        }
                        else if (Array.isArray(content) &&
                            content.every((c) => typeof c === 'object' &&
                                'type' in c &&
                                typeof c.type === 'string' &&
                                c.type.startsWith('text'))) {
                            await this.dispatchMessageDelta(stepId, {
                                content: content,
                            });
                        }
                    }
                }
                await handleToolCalls(toolCalls, metadata, this);
            }
            /**
             * When streaming is disabled, on_chat_model_stream events are never
             * emitted so ChatModelStreamHandler never fires. Dispatch the text
             * content as MESSAGE_CREATION + MESSAGE_DELTA here.
             */
            const disableStreaming = agentContext.clientOptions
                ?.disableStreaming === true;
            if (disableStreaming &&
                !hasToolCalls &&
                responseMessage != null &&
                responseMessage.content != null) {
                const metadata = config.metadata;
                const stepKey = this.getStepKey(metadata);
                const messageId = getMessageId(stepKey, this) ?? '';
                if (messageId) {
                    await this.dispatchRunStep(stepKey, {
                        type: StepTypes.MESSAGE_CREATION,
                        message_creation: { message_id: messageId },
                    }, metadata);
                    const stepId = this.getStepIdByKey(stepKey);
                    const content = responseMessage.content;
                    if (typeof content === 'string') {
                        await this.dispatchMessageDelta(stepId, {
                            content: [{ type: ContentTypes.TEXT, text: content }],
                        });
                    }
                    else if (Array.isArray(content) &&
                        content.every((c) => typeof c === 'object' &&
                            'type' in c &&
                            typeof c.type === 'string' &&
                            c.type.startsWith('text'))) {
                        await this.dispatchMessageDelta(stepId, {
                            content: content,
                        });
                    }
                }
            }
            agentContext.currentUsage = this.getUsageMetadata(result.messages?.[0]);
            this.cleanupSignalListener();
            return result;
        };
    }
    createAgentNode(agentId) {
        const agentContext = this.agentContexts.get(agentId);
        if (!agentContext) {
            throw new Error(`Agent context not found for agentId: ${agentId}`);
        }
        const agentNode = `${AGENT}${agentId}`;
        const toolNode = `${TOOLS}${agentId}`;
        const routeMessage = (state, config) => {
            this.config = config;
            return toolsCondition(state, toolNode, this.invokedToolIds);
        };
        const StateAnnotation = Annotation.Root({
            messages: Annotation({
                reducer: messagesStateReducer,
                default: () => [],
            }),
        });
        const workflow = new StateGraph(StateAnnotation)
            .addNode(agentNode, this.createCallModel(agentId))
            .addNode(toolNode, this.initializeTools({
            currentTools: agentContext.tools,
            currentToolMap: agentContext.toolMap,
            agentContext,
        }))
            .addEdge(START, agentNode)
            .addConditionalEdges(agentNode, routeMessage)
            .addEdge(toolNode, agentContext.toolEnd ? END : agentNode);
        // Cast to unknown to avoid tight coupling to external types; options are opt-in
        return workflow.compile(this.compileOptions);
    }
    createWorkflow() {
        /** Use the default (first) agent for now */
        const agentNode = this.createAgentNode(this.defaultAgentId);
        const StateAnnotation = Annotation.Root({
            messages: Annotation({
                reducer: (a, b) => {
                    if (!a.length) {
                        this.startIndex = a.length + b.length;
                    }
                    const result = messagesStateReducer(a, b);
                    this.messages = result;
                    return result;
                },
                default: () => [],
            }),
        });
        const workflow = new StateGraph(StateAnnotation)
            .addNode(this.defaultAgentId, agentNode, { ends: [END] })
            .addEdge(START, this.defaultAgentId)
            .compile();
        return workflow;
    }
    /**
     * Indicates if this is a multi-agent graph.
     * Override in MultiAgentGraph to return true.
     * Used to conditionally include agentId in RunStep for frontend rendering.
     */
    isMultiAgentGraph() {
        return false;
    }
    /**
     * Get the parallel group ID for an agent, if any.
     * Override in MultiAgentGraph to provide actual group IDs.
     * Group IDs are incrementing numbers (1, 2, 3...) reflecting execution order.
     * @param _agentId - The agent ID to look up
     * @returns undefined for StandardGraph (no parallel groups), or group number for MultiAgentGraph
     */
    getParallelGroupIdForAgent(_agentId) {
        return undefined;
    }
    /* Dispatchers */
    /**
     * Dispatches a run step to the client, returns the step ID
     */
    async dispatchRunStep(stepKey, stepDetails, metadata) {
        if (!this.config) {
            throw new Error('No config provided');
        }
        const [stepId, stepIndex] = this.generateStepId(stepKey);
        if (stepDetails.type === StepTypes.TOOL_CALLS && stepDetails.tool_calls) {
            for (const tool_call of stepDetails.tool_calls) {
                const toolCallId = tool_call.id ?? '';
                if (!toolCallId || this.toolCallStepIds.has(toolCallId)) {
                    continue;
                }
                this.toolCallStepIds.set(toolCallId, stepId);
            }
        }
        const runStep = {
            stepIndex,
            id: stepId,
            type: stepDetails.type,
            index: this.contentData.length,
            stepDetails,
            usage: null,
        };
        const runId = this.runId ?? '';
        if (runId) {
            runStep.runId = runId;
        }
        /**
         * Extract agentId and parallelGroupId from metadata
         * Only set agentId for MultiAgentGraph (so frontend knows when to show agent labels)
         */
        if (metadata) {
            try {
                const agentContext = this.getAgentContext(metadata);
                if (this.isMultiAgentGraph() && agentContext.agentId) {
                    // Only include agentId for MultiAgentGraph - enables frontend to show agent labels
                    runStep.agentId = agentContext.agentId;
                    // Set group ID if this agent is part of a parallel group
                    // Group IDs are incrementing numbers (1, 2, 3...) reflecting execution order
                    const groupId = this.getParallelGroupIdForAgent(agentContext.agentId);
                    if (groupId != null) {
                        runStep.groupId = groupId;
                    }
                }
            }
            catch (_e) {
                /** If we can't get agent context, that's okay - agentId remains undefined */
            }
        }
        this.contentData.push(runStep);
        this.contentIndexMap.set(stepId, runStep.index);
        await safeDispatchCustomEvent(GraphEvents.ON_RUN_STEP, runStep, this.config);
        return stepId;
    }
    /**
     * Static version of handleToolCallError to avoid creating strong references
     * that prevent garbage collection
     */
    static async handleToolCallErrorStatic(graph, data, metadata) {
        if (!graph.config) {
            throw new Error('No config provided');
        }
        if (!data.id) {
            console.warn('No Tool ID provided for Tool Error');
            return;
        }
        const stepId = graph.toolCallStepIds.get(data.id) ?? '';
        if (!stepId) {
            throw new Error(`No stepId found for tool_call_id ${data.id}`);
        }
        const { name, input: args, error } = data;
        const runStep = graph.getRunStep(stepId);
        if (!runStep) {
            throw new Error(`No run step found for stepId ${stepId}`);
        }
        const tool_call = {
            id: data.id,
            name: name || '',
            args: typeof args === 'string' ? args : JSON.stringify(args),
            output: `Error processing tool${error?.message != null ? `: ${error.message}` : ''}`,
            progress: 1,
        };
        await graph.handlerRegistry
            ?.getHandler(GraphEvents.ON_RUN_STEP_COMPLETED)
            ?.handle(GraphEvents.ON_RUN_STEP_COMPLETED, {
            result: {
                id: stepId,
                index: runStep.index,
                type: 'tool_call',
                tool_call,
            },
        }, metadata, graph);
    }
    /**
     * Instance method that delegates to the static method
     * Kept for backward compatibility
     */
    async handleToolCallError(data, metadata) {
        await StandardGraph.handleToolCallErrorStatic(this, data, metadata);
    }
    async dispatchRunStepDelta(id, delta) {
        if (!this.config) {
            throw new Error('No config provided');
        }
        else if (!id) {
            throw new Error('No step ID found');
        }
        const runStepDelta = {
            id,
            delta,
        };
        await safeDispatchCustomEvent(GraphEvents.ON_RUN_STEP_DELTA, runStepDelta, this.config);
    }
    async dispatchMessageDelta(id, delta) {
        if (!this.config) {
            throw new Error('No config provided');
        }
        const messageDelta = {
            id,
            delta,
        };
        await safeDispatchCustomEvent(GraphEvents.ON_MESSAGE_DELTA, messageDelta, this.config);
    }
    dispatchReasoningDelta = async (stepId, delta) => {
        if (!this.config) {
            throw new Error('No config provided');
        }
        const reasoningDelta = {
            id: stepId,
            delta,
        };
        await safeDispatchCustomEvent(GraphEvents.ON_REASONING_DELTA, reasoningDelta, this.config);
    };
}

export { Graph, StandardGraph };
//# sourceMappingURL=Graph.mjs.map
