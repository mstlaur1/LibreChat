'use strict';

require('./instrumentation.cjs');
var langchain = require('@langfuse/langchain');
var prompts = require('@langchain/core/prompts');
var runnables = require('@langchain/core/runnables');
var openai = require('@langchain/openai');
var base = require('@langchain/core/callbacks/base');
var title = require('./utils/title.cjs');
var _enum = require('./common/enum.cjs');
var MultiAgentGraph = require('./graphs/MultiAgentGraph.cjs');
var tokens = require('./utils/tokens.cjs');
var Graph = require('./graphs/Graph.cjs');
var events = require('./events.cjs');
var llm = require('./utils/llm.cjs');
var misc = require('./utils/misc.cjs');

// src/run.ts
const defaultOmitOptions = new Set([
    'stream',
    'thinking',
    'streaming',
    'maxTokens',
    'clientOptions',
    'thinkingConfig',
    'thinkingBudget',
    'includeThoughts',
    'maxOutputTokens',
    'additionalModelRequestFields',
]);
class Run {
    id;
    tokenCounter;
    handlerRegistry;
    indexTokenCountMap;
    graphRunnable;
    Graph;
    returnContent = false;
    skipCleanup = false;
    constructor(config) {
        const runId = config.runId ?? '';
        if (!runId) {
            throw new Error('Run ID not provided');
        }
        this.id = runId;
        this.tokenCounter = config.tokenCounter;
        this.indexTokenCountMap = config.indexTokenCountMap;
        const handlerRegistry = new events.HandlerRegistry();
        if (config.customHandlers) {
            for (const [eventType, handler] of Object.entries(config.customHandlers)) {
                handlerRegistry.register(eventType, handler);
            }
        }
        this.handlerRegistry = handlerRegistry;
        if (!config.graphConfig) {
            throw new Error('Graph config not provided');
        }
        /** Handle different graph types */
        if (config.graphConfig.type === 'multi-agent') {
            this.graphRunnable = this.createMultiAgentGraph(config.graphConfig);
            if (this.Graph) {
                this.Graph.handlerRegistry = handlerRegistry;
            }
        }
        else {
            /** Default to legacy graph for 'standard' or undefined type */
            this.graphRunnable = this.createLegacyGraph(config.graphConfig);
            if (this.Graph) {
                this.Graph.compileOptions =
                    config.graphConfig.compileOptions ?? this.Graph.compileOptions;
                this.Graph.handlerRegistry = handlerRegistry;
            }
        }
        this.returnContent = config.returnContent ?? false;
        this.skipCleanup = config.skipCleanup ?? false;
    }
    createLegacyGraph(config) {
        let agentConfig;
        let signal;
        /** Check if this is a multi-agent style config (has agents array) */
        if ('agents' in config && Array.isArray(config.agents)) {
            if (config.agents.length === 0) {
                throw new Error('At least one agent must be provided');
            }
            agentConfig = config.agents[0];
            signal = config.signal;
        }
        else {
            /** Legacy path: build agent config from llmConfig */
            const { type: _type, llmConfig, signal: legacySignal, tools = [], ...agentInputs } = config;
            const { provider, ...clientOptions } = llmConfig;
            agentConfig = {
                ...agentInputs,
                tools,
                provider,
                clientOptions,
                agentId: 'default',
            };
            signal = legacySignal;
        }
        const standardGraph = new Graph.StandardGraph({
            signal,
            runId: this.id,
            agents: [agentConfig],
            tokenCounter: this.tokenCounter,
            indexTokenCountMap: this.indexTokenCountMap,
        });
        /** Propagate compile options from graph config */
        standardGraph.compileOptions = config.compileOptions;
        this.Graph = standardGraph;
        return standardGraph.createWorkflow();
    }
    createMultiAgentGraph(config) {
        const { agents, edges, compileOptions } = config;
        const multiAgentGraph = new MultiAgentGraph.MultiAgentGraph({
            runId: this.id,
            agents,
            edges,
            tokenCounter: this.tokenCounter,
            indexTokenCountMap: this.indexTokenCountMap,
        });
        if (compileOptions != null) {
            multiAgentGraph.compileOptions = compileOptions;
        }
        this.Graph = multiAgentGraph;
        return multiAgentGraph.createWorkflow();
    }
    static async create(config) {
        /** Create tokenCounter if indexTokenCountMap is provided but tokenCounter is not */
        if (config.indexTokenCountMap && !config.tokenCounter) {
            config.tokenCounter = await tokens.createTokenCounter();
        }
        return new Run(config);
    }
    getRunMessages() {
        if (!this.Graph) {
            throw new Error('Graph not initialized. Make sure to use Run.create() to instantiate the Run.');
        }
        return this.Graph.getRunMessages();
    }
    /**
     * Creates a custom event callback handler that intercepts custom events
     * and processes them through our handler registry instead of EventStreamCallbackHandler
     */
    createCustomEventCallback() {
        return async (eventName, data, runId, tags, metadata) => {
            const handler = this.handlerRegistry?.getHandler(eventName);
            if (handler && this.Graph) {
                return await handler.handle(eventName, data, metadata, this.Graph);
            }
        };
    }
    async processStream(inputs, config, streamOptions) {
        if (this.graphRunnable == null) {
            throw new Error('Run not initialized. Make sure to use Run.create() to instantiate the Run.');
        }
        if (!this.Graph) {
            throw new Error('Graph not initialized. Make sure to use Run.create() to instantiate the Run.');
        }
        this.Graph.resetValues(streamOptions?.keepContent);
        /** Custom event callback to intercept and handle custom events */
        const customEventCallback = this.createCustomEventCallback();
        const baseCallbacks = config.callbacks ?? [];
        const streamCallbacks = streamOptions?.callbacks
            ? this.getCallbacks(streamOptions.callbacks)
            : [];
        const customHandler = base.BaseCallbackHandler.fromMethods({
            [_enum.Callback.CUSTOM_EVENT]: customEventCallback,
        });
        customHandler.awaitHandlers = true;
        config.callbacks = baseCallbacks
            .concat(streamCallbacks)
            .concat(customHandler);
        if (misc.isPresent(process.env.LANGFUSE_SECRET_KEY) &&
            misc.isPresent(process.env.LANGFUSE_PUBLIC_KEY) &&
            misc.isPresent(process.env.LANGFUSE_BASE_URL)) {
            const userId = config.configurable?.user_id;
            const sessionId = config.configurable?.thread_id;
            const traceMetadata = {
                messageId: this.id,
                parentMessageId: config.configurable?.requestBody?.parentMessageId,
            };
            const handler = new langchain.CallbackHandler({
                userId,
                sessionId,
                traceMetadata,
            });
            config.callbacks = (config.callbacks ?? []).concat([handler]);
        }
        if (!this.id) {
            throw new Error('Run ID not provided');
        }
        config.run_id = this.id;
        config.configurable = Object.assign(config.configurable ?? {}, {
            run_id: this.id,
        });
        const stream = this.graphRunnable.streamEvents(inputs, config, {
            raiseError: true,
            /**
             * Prevent EventStreamCallbackHandler from processing custom events.
             * Custom events are already handled via our createCustomEventCallback()
             * which routes them through the handlerRegistry.
             * Without this flag, EventStreamCallbackHandler throws errors when
             * custom events are dispatched for run IDs not in its internal map
             * (due to timing issues in parallel execution or after run cleanup).
             */
            ignoreCustomEvent: true,
        });
        for await (const event of stream) {
            const { data, metadata, ...info } = event;
            const eventName = info.event;
            /** Skip custom events as they're handled by our callback */
            if (eventName === _enum.GraphEvents.ON_CUSTOM_EVENT) {
                continue;
            }
            const handler = this.handlerRegistry?.getHandler(eventName);
            if (handler) {
                await handler.handle(eventName, data, metadata, this.Graph);
            }
        }
        /**
         * Break the reference chain that keeps heavy data alive via
         * LangGraph's internal `__pregel_scratchpad.currentTaskInput` →
         * `@langchain/core` `RunTree.extra[lc:child_config]` →
         * Node.js `AsyncLocalStorage` context captured by timers/promises.
         *
         * Without this, base64-encoded images/PDFs in message content remain
         * reachable from lingering `Timeout` handles until GC runs.
         */
        if (!this.skipCleanup) {
            if (config.configurable != null) {
                for (const key of Object.getOwnPropertySymbols(config.configurable)) {
                    const val = config.configurable[key];
                    if (val != null &&
                        typeof val === 'object' &&
                        'currentTaskInput' in val) {
                        val.currentTaskInput = undefined;
                    }
                    delete config.configurable[key];
                }
                config.configurable = undefined;
            }
            config.callbacks = undefined;
        }
        const result = this.returnContent
            ? this.Graph.getContentParts()
            : undefined;
        if (!this.skipCleanup) {
            this.Graph.clearHeavyState();
        }
        return result;
    }
    createSystemCallback(clientCallbacks, key) {
        return ((...args) => {
            const clientCallback = clientCallbacks[key];
            if (clientCallback && this.Graph) {
                clientCallback(this.Graph, ...args);
            }
        });
    }
    getCallbacks(clientCallbacks) {
        return {
            [_enum.Callback.TOOL_ERROR]: this.createSystemCallback(clientCallbacks, _enum.Callback.TOOL_ERROR),
            [_enum.Callback.TOOL_START]: this.createSystemCallback(clientCallbacks, _enum.Callback.TOOL_START),
            [_enum.Callback.TOOL_END]: this.createSystemCallback(clientCallbacks, _enum.Callback.TOOL_END),
        };
    }
    async generateTitle({ provider, inputText, contentParts, titlePrompt, clientOptions, chainOptions, skipLanguage, titleMethod = _enum.TitleMethod.COMPLETION, titlePromptTemplate, }) {
        if (chainOptions != null &&
            misc.isPresent(process.env.LANGFUSE_SECRET_KEY) &&
            misc.isPresent(process.env.LANGFUSE_PUBLIC_KEY) &&
            misc.isPresent(process.env.LANGFUSE_BASE_URL)) {
            const userId = chainOptions.configurable?.user_id;
            const sessionId = chainOptions.configurable?.thread_id;
            const traceMetadata = {
                messageId: 'title-' + this.id,
            };
            const handler = new langchain.CallbackHandler({
                userId,
                sessionId,
                traceMetadata,
            });
            chainOptions.callbacks = (chainOptions.callbacks ?? []).concat([handler]);
        }
        const convoTemplate = prompts.PromptTemplate.fromTemplate(titlePromptTemplate ?? 'User: {input}\nAI: {output}');
        const response = contentParts
            .map((part) => {
            if (part?.type === 'text')
                return part.text;
            return '';
        })
            .join('\n');
        const model = this.Graph?.getNewModel({
            provider,
            clientOptions,
        });
        if (!model) {
            return { language: '', title: '' };
        }
        if (llm.isOpenAILike(provider) &&
            (model instanceof openai.ChatOpenAI || model instanceof openai.AzureChatOpenAI)) {
            model.temperature = clientOptions
                ?.temperature;
            model.topP = clientOptions
                ?.topP;
            model.frequencyPenalty = clientOptions?.frequencyPenalty;
            model.presencePenalty = clientOptions?.presencePenalty;
            model.n = clientOptions
                ?.n;
        }
        const convoToTitleInput = new runnables.RunnableLambda({
            func: (promptValue) => ({
                convo: promptValue.value,
                inputText,
                skipLanguage,
            }),
        }).withConfig({ runName: 'ConvoTransform' });
        const titleChain = titleMethod === _enum.TitleMethod.COMPLETION
            ? await title.createCompletionTitleRunnable(model, titlePrompt)
            : await title.createTitleRunnable(model, titlePrompt);
        /** Pipes `convoTemplate` -> `transformer` -> `titleChain` */
        const fullChain = convoTemplate
            .withConfig({ runName: 'ConvoTemplate' })
            .pipe(convoToTitleInput)
            .pipe(titleChain)
            .withConfig({ runName: 'TitleChain' });
        const invokeConfig = Object.assign({}, chainOptions, {
            run_id: this.id,
            runId: this.id,
        });
        try {
            return await fullChain.invoke({ input: inputText, output: response }, invokeConfig);
        }
        catch (_e) {
            // Fallback: strip callbacks to avoid EventStream tracer errors in certain environments
            // But preserve langfuse handler if it exists
            const langfuseHandler = invokeConfig.callbacks?.find((cb) => cb instanceof langchain.CallbackHandler);
            const { callbacks: _cb, ...rest } = invokeConfig;
            const safeConfig = Object.assign({}, rest, {
                callbacks: langfuseHandler ? [langfuseHandler] : [],
            });
            return await fullChain.invoke({ input: inputText, output: response }, safeConfig);
        }
    }
}

exports.Run = Run;
exports.defaultOmitOptions = defaultOmitOptions;
//# sourceMappingURL=run.cjs.map
