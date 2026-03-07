'use strict';

var messages = require('@langchain/core/messages');
var runnables = require('@langchain/core/runnables');
var schema$1 = require('../tools/schema.cjs');
var _enum = require('../common/enum.cjs');
var schema = require('../utils/schema.cjs');

/* eslint-disable no-console */
// src/agents/AgentContext.ts
/**
 * Encapsulates agent-specific state that can vary between agents in a multi-agent system
 */
class AgentContext {
    /**
     * Create an AgentContext from configuration with token accounting initialization
     */
    static fromConfig(agentConfig, tokenCounter, indexTokenCountMap) {
        const { agentId, name, provider, clientOptions, tools, toolMap, toolEnd, toolRegistry, toolDefinitions, instructions, additional_instructions, streamBuffer, maxContextTokens, reasoningKey, useLegacyContent, discoveredTools, } = agentConfig;
        const agentContext = new AgentContext({
            agentId,
            name: name ?? agentId,
            provider,
            clientOptions,
            maxContextTokens,
            streamBuffer,
            tools,
            toolMap,
            toolRegistry,
            toolDefinitions,
            instructions,
            additionalInstructions: additional_instructions,
            reasoningKey,
            toolEnd,
            instructionTokens: 0,
            tokenCounter,
            useLegacyContent,
            discoveredTools,
        });
        if (tokenCounter) {
            // Initialize system runnable BEFORE async tool token calculation
            // This ensures system message tokens are in instructionTokens before
            // updateTokenMapWithInstructions is called
            agentContext.initializeSystemRunnable();
            const tokenMap = indexTokenCountMap || {};
            agentContext.baseIndexTokenCountMap = { ...tokenMap };
            agentContext.indexTokenCountMap = tokenMap;
            agentContext.tokenCalculationPromise = agentContext
                .calculateInstructionTokens(tokenCounter)
                .then(() => {
                // Update token map with instruction tokens (includes system + tool tokens)
                agentContext.updateTokenMapWithInstructions(tokenMap);
            })
                .catch((err) => {
                console.error('Error calculating instruction tokens:', err);
            });
        }
        else if (indexTokenCountMap) {
            agentContext.baseIndexTokenCountMap = { ...indexTokenCountMap };
            agentContext.indexTokenCountMap = indexTokenCountMap;
        }
        return agentContext;
    }
    /** Agent identifier */
    agentId;
    /** Human-readable name for this agent (used in handoff context). Falls back to agentId if not provided. */
    name;
    /** Provider for this specific agent */
    provider;
    /** Client options for this agent */
    clientOptions;
    /** Token count map indexed by message position */
    indexTokenCountMap = {};
    /** Canonical pre-run token map used to restore token accounting on reset */
    baseIndexTokenCountMap = {};
    /** Maximum context tokens for this agent */
    maxContextTokens;
    /** Current usage metadata for this agent */
    currentUsage;
    /** Prune messages function configured for this agent */
    pruneMessages;
    /** Token counter function for this agent */
    tokenCounter;
    /** Instructions/system message token count */
    instructionTokens = 0;
    /** The amount of time that should pass before another consecutive API call */
    streamBuffer;
    /** Last stream call timestamp for rate limiting */
    lastStreamCall;
    /** Tools available to this agent */
    tools;
    /** Graph-managed tools (e.g., handoff tools created by MultiAgentGraph) that bypass event-driven dispatch */
    graphTools;
    /** Tool map for this agent */
    toolMap;
    /**
     * Tool definitions registry (includes deferred and programmatic tool metadata).
     * Used for tool search and programmatic tool calling.
     */
    toolRegistry;
    /**
     * Serializable tool definitions for event-driven execution.
     * When provided, ToolNode operates in event-driven mode.
     */
    toolDefinitions;
    /** Set of tool names discovered via tool search (to be loaded) */
    discoveredToolNames = new Set();
    /** Instructions for this agent */
    instructions;
    /** Additional instructions for this agent */
    additionalInstructions;
    /** Reasoning key for this agent */
    reasoningKey = 'reasoning_content';
    /** Last token for reasoning detection */
    lastToken;
    /** Token type switch state */
    tokenTypeSwitch;
    /** Tracks how many reasoning→text transitions have occurred (ensures unique post-reasoning step keys) */
    reasoningTransitionCount = 0;
    /** Current token type being processed */
    currentTokenType = _enum.ContentTypes.TEXT;
    /** Whether tools should end the workflow */
    toolEnd = false;
    /** Cached system runnable (created lazily) */
    cachedSystemRunnable;
    /** Whether system runnable needs rebuild (set when discovered tools change) */
    systemRunnableStale = true;
    /** Cached system message token count (separate from tool tokens) */
    systemMessageTokens = 0;
    /** Promise for token calculation initialization */
    tokenCalculationPromise;
    /** Format content blocks as strings (for legacy compatibility) */
    useLegacyContent = false;
    /**
     * Handoff context when this agent receives control via handoff.
     * Contains source and parallel execution info for system message context.
     */
    handoffContext;
    constructor({ agentId, name, provider, clientOptions, maxContextTokens, streamBuffer, tokenCounter, tools, toolMap, toolRegistry, toolDefinitions, instructions, additionalInstructions, reasoningKey, toolEnd, instructionTokens, useLegacyContent, discoveredTools, }) {
        this.agentId = agentId;
        this.name = name;
        this.provider = provider;
        this.clientOptions = clientOptions;
        this.maxContextTokens = maxContextTokens;
        this.streamBuffer = streamBuffer;
        this.tokenCounter = tokenCounter;
        this.tools = tools;
        this.toolMap = toolMap;
        this.toolRegistry = toolRegistry;
        this.toolDefinitions = toolDefinitions;
        this.instructions = instructions;
        this.additionalInstructions = additionalInstructions;
        if (reasoningKey) {
            this.reasoningKey = reasoningKey;
        }
        if (toolEnd !== undefined) {
            this.toolEnd = toolEnd;
        }
        if (instructionTokens !== undefined) {
            this.instructionTokens = instructionTokens;
        }
        this.useLegacyContent = useLegacyContent ?? false;
        if (discoveredTools && discoveredTools.length > 0) {
            for (const toolName of discoveredTools) {
                this.discoveredToolNames.add(toolName);
            }
        }
    }
    /**
     * Builds instructions text for tools that are ONLY callable via programmatic code execution.
     * These tools cannot be called directly by the LLM but are available through the
     * run_tools_with_code tool.
     *
     * Includes:
     * - Code_execution-only tools that are NOT deferred
     * - Code_execution-only tools that ARE deferred but have been discovered via tool search
     */
    buildProgrammaticOnlyToolsInstructions() {
        if (!this.toolRegistry)
            return '';
        const programmaticOnlyTools = [];
        for (const [name, toolDef] of this.toolRegistry) {
            const allowedCallers = toolDef.allowed_callers ?? ['direct'];
            const isCodeExecutionOnly = allowedCallers.includes('code_execution') &&
                !allowedCallers.includes('direct');
            if (!isCodeExecutionOnly)
                continue;
            // Include if: not deferred OR deferred but discovered
            const isDeferred = toolDef.defer_loading === true;
            const isDiscovered = this.discoveredToolNames.has(name);
            if (!isDeferred || isDiscovered) {
                programmaticOnlyTools.push(toolDef);
            }
        }
        if (programmaticOnlyTools.length === 0)
            return '';
        const toolDescriptions = programmaticOnlyTools
            .map((tool) => {
            let desc = `- **${tool.name}**`;
            if (tool.description != null && tool.description !== '') {
                desc += `: ${tool.description}`;
            }
            if (tool.parameters) {
                desc += `\n  Parameters: ${JSON.stringify(tool.parameters, null, 2).replace(/\n/g, '\n  ')}`;
            }
            return desc;
        })
            .join('\n\n');
        return ('\n\n## Programmatic-Only Tools\n\n' +
            'The following tools are available exclusively through the `run_tools_with_code` tool. ' +
            'You cannot call these tools directly; instead, use `run_tools_with_code` with Python code that invokes them.\n\n' +
            toolDescriptions);
    }
    /**
     * Gets the system runnable, creating it lazily if needed.
     * Includes instructions, additional instructions, and programmatic-only tools documentation.
     * Only rebuilds when marked stale (via markToolsAsDiscovered).
     */
    get systemRunnable() {
        // Return cached if not stale
        if (!this.systemRunnableStale && this.cachedSystemRunnable !== undefined) {
            return this.cachedSystemRunnable;
        }
        // Stale or first access - rebuild
        const instructionsString = this.buildInstructionsString();
        this.cachedSystemRunnable = this.buildSystemRunnable(instructionsString);
        this.systemRunnableStale = false;
        return this.cachedSystemRunnable;
    }
    /**
     * Explicitly initializes the system runnable.
     * Call this before async token calculation to ensure system message tokens are counted first.
     */
    initializeSystemRunnable() {
        if (this.systemRunnableStale || this.cachedSystemRunnable === undefined) {
            const instructionsString = this.buildInstructionsString();
            this.cachedSystemRunnable = this.buildSystemRunnable(instructionsString);
            this.systemRunnableStale = false;
        }
    }
    /**
     * Builds the raw instructions string (without creating SystemMessage).
     * Includes agent identity preamble and handoff context when available.
     */
    buildInstructionsString() {
        const parts = [];
        /** Build agent identity and handoff context preamble */
        const identityPreamble = this.buildIdentityPreamble();
        if (identityPreamble) {
            parts.push(identityPreamble);
        }
        /** Add main instructions */
        if (this.instructions != null && this.instructions !== '') {
            parts.push(this.instructions);
        }
        /** Add additional instructions */
        if (this.additionalInstructions != null &&
            this.additionalInstructions !== '') {
            parts.push(this.additionalInstructions);
        }
        /** Add programmatic tools documentation */
        const programmaticToolsDoc = this.buildProgrammaticOnlyToolsInstructions();
        if (programmaticToolsDoc) {
            parts.push(programmaticToolsDoc);
        }
        return parts.join('\n\n');
    }
    /**
     * Builds the agent identity preamble including handoff context if present.
     * This helps the agent understand its role in the multi-agent workflow.
     */
    buildIdentityPreamble() {
        if (!this.handoffContext)
            return '';
        const displayName = this.name ?? this.agentId;
        const { sourceAgentName, parallelSiblings } = this.handoffContext;
        const isParallel = parallelSiblings.length > 0;
        const lines = [];
        lines.push('## Multi-Agent Workflow');
        lines.push(`You are "${displayName}", transferred from "${sourceAgentName}".`);
        if (isParallel) {
            lines.push(`Running in parallel with: ${parallelSiblings.join(', ')}.`);
        }
        lines.push('Execute only tasks relevant to your role. Routing is already handled if requested, unless you can route further.');
        return lines.join('\n');
    }
    /**
     * Build system runnable from pre-built instructions string.
     * Only called when content has actually changed.
     */
    buildSystemRunnable(instructionsString) {
        if (!instructionsString) {
            // Remove previous tokens if we had a system message before
            this.instructionTokens -= this.systemMessageTokens;
            this.systemMessageTokens = 0;
            return undefined;
        }
        let finalInstructions = instructionsString;
        // Handle Anthropic prompt caching
        if (this.provider === _enum.Providers.ANTHROPIC) {
            const anthropicOptions = this.clientOptions;
            if (anthropicOptions?.promptCache === true) {
                finalInstructions = {
                    content: [
                        {
                            type: 'text',
                            text: instructionsString,
                            cache_control: { type: 'ephemeral' },
                        },
                    ],
                };
            }
        }
        const systemMessage = new messages.SystemMessage(finalInstructions);
        // Update token counts (subtract old, add new)
        if (this.tokenCounter) {
            this.instructionTokens -= this.systemMessageTokens;
            this.systemMessageTokens = this.tokenCounter(systemMessage);
            this.instructionTokens += this.systemMessageTokens;
        }
        return runnables.RunnableLambda.from((messages) => {
            return [systemMessage, ...messages];
        }).withConfig({ runName: 'prompt' });
    }
    /**
     * Reset context for a new run
     */
    reset() {
        this.instructionTokens = 0;
        this.systemMessageTokens = 0;
        this.cachedSystemRunnable = undefined;
        this.systemRunnableStale = true;
        this.lastToken = undefined;
        this.indexTokenCountMap = { ...this.baseIndexTokenCountMap };
        this.currentUsage = undefined;
        this.pruneMessages = undefined;
        this.lastStreamCall = undefined;
        this.tokenTypeSwitch = undefined;
        this.reasoningTransitionCount = 0;
        this.currentTokenType = _enum.ContentTypes.TEXT;
        this.discoveredToolNames.clear();
        this.handoffContext = undefined;
        if (this.tokenCounter) {
            this.initializeSystemRunnable();
            const baseTokenMap = { ...this.baseIndexTokenCountMap };
            this.indexTokenCountMap = baseTokenMap;
            this.tokenCalculationPromise = this.calculateInstructionTokens(this.tokenCounter)
                .then(() => {
                this.updateTokenMapWithInstructions(baseTokenMap);
            })
                .catch((err) => {
                console.error('Error calculating instruction tokens:', err);
            });
        }
        else {
            this.tokenCalculationPromise = undefined;
        }
    }
    /**
     * Update the token count map with instruction tokens
     */
    updateTokenMapWithInstructions(baseTokenMap) {
        if (this.instructionTokens > 0) {
            // Shift all indices by the instruction token count
            const shiftedMap = {};
            for (const [key, value] of Object.entries(baseTokenMap)) {
                const index = parseInt(key, 10);
                if (!isNaN(index)) {
                    shiftedMap[String(index)] =
                        value + (index === 0 ? this.instructionTokens : 0);
                }
            }
            this.indexTokenCountMap = shiftedMap;
        }
        else {
            this.indexTokenCountMap = { ...baseTokenMap };
        }
    }
    /**
     * Calculate tool tokens and add to instruction tokens
     * Note: System message tokens are calculated during systemRunnable creation
     */
    async calculateInstructionTokens(tokenCounter) {
        let toolTokens = 0;
        // Track names to avoid double-counting when a tool appears in both
        // this.tools (bound StructuredTool instances) and this.toolDefinitions
        // (MCP / event-driven schemas).
        const countedToolNames = new Set();
        // Count tokens for bound tools (StructuredTool instances with .schema)
        if (this.tools && this.tools.length > 0) {
            for (const tool of this.tools) {
                const genericTool = tool;
                if (genericTool.schema != null &&
                    typeof genericTool.schema === 'object') {
                    const toolName = genericTool.name ?? '';
                    const jsonSchema = schema.toJsonSchema(genericTool.schema, toolName, genericTool.description ?? '');
                    toolTokens += tokenCounter(new messages.SystemMessage(JSON.stringify(jsonSchema)));
                    if (toolName) {
                        countedToolNames.add(toolName);
                    }
                }
            }
        }
        // Count tokens for tool definitions (MCP / event-driven tools).
        // These are sent to the provider API as tool schemas alongside bound tools.
        // Both can be populated simultaneously (graph tools + MCP tools).
        if (this.toolDefinitions && this.toolDefinitions.length > 0) {
            for (const def of this.toolDefinitions) {
                if (countedToolNames.has(def.name)) {
                    continue; // Already counted via this.tools
                }
                const schema = {
                    name: def.name,
                    description: def.description ?? '',
                    parameters: def.parameters ?? {},
                };
                toolTokens += tokenCounter(new messages.SystemMessage(JSON.stringify(schema)));
            }
        }
        this.instructionTokens += toolTokens;
    }
    /**
     * Gets the tool registry for deferred tools (for tool search).
     * @param onlyDeferred If true, only returns tools with defer_loading=true
     * @returns LCToolRegistry with tool definitions
     */
    getDeferredToolRegistry(onlyDeferred = true) {
        const registry = new Map();
        if (!this.toolRegistry) {
            return registry;
        }
        for (const [name, toolDef] of this.toolRegistry) {
            if (!onlyDeferred || toolDef.defer_loading === true) {
                registry.set(name, toolDef);
            }
        }
        return registry;
    }
    /**
     * Sets the handoff context for this agent.
     * Call this when the agent receives control via handoff from another agent.
     * Marks system runnable as stale to include handoff context in system message.
     * @param sourceAgentName - Name of the agent that transferred control
     * @param parallelSiblings - Names of other agents executing in parallel with this one
     */
    setHandoffContext(sourceAgentName, parallelSiblings) {
        this.handoffContext = { sourceAgentName, parallelSiblings };
        this.systemRunnableStale = true;
    }
    /**
     * Clears any handoff context.
     * Call this when resetting the agent or when handoff context is no longer relevant.
     */
    clearHandoffContext() {
        if (this.handoffContext) {
            this.handoffContext = undefined;
            this.systemRunnableStale = true;
        }
    }
    /**
     * Marks tools as discovered via tool search.
     * Discovered tools will be included in the next model binding.
     * Only marks system runnable stale if NEW tools were actually added.
     * @param toolNames - Array of discovered tool names
     * @returns true if any new tools were discovered
     */
    markToolsAsDiscovered(toolNames) {
        let hasNewDiscoveries = false;
        for (const name of toolNames) {
            if (!this.discoveredToolNames.has(name)) {
                this.discoveredToolNames.add(name);
                hasNewDiscoveries = true;
            }
        }
        if (hasNewDiscoveries) {
            this.systemRunnableStale = true;
        }
        return hasNewDiscoveries;
    }
    /**
     * Gets tools that should be bound to the LLM.
     * In event-driven mode (toolDefinitions present, tools empty), creates schema-only tools.
     * Otherwise filters tool instances based on:
     * 1. Non-deferred tools with allowed_callers: ['direct']
     * 2. Discovered tools (from tool search)
     * @returns Array of tools to bind to model
     */
    getToolsForBinding() {
        /** Event-driven mode: create schema-only tools from definitions */
        if (this.toolDefinitions && this.toolDefinitions.length > 0) {
            return this.getEventDrivenToolsForBinding();
        }
        /** Traditional mode: filter actual tool instances */
        const filtered = !this.tools || !this.toolRegistry
            ? this.tools
            : this.filterToolsForBinding(this.tools);
        if (this.graphTools && this.graphTools.length > 0) {
            return [...(filtered ?? []), ...this.graphTools];
        }
        return filtered;
    }
    /** Creates schema-only tools from toolDefinitions for event-driven mode, merged with native tools */
    getEventDrivenToolsForBinding() {
        if (!this.toolDefinitions) {
            return this.graphTools ?? [];
        }
        const defsToInclude = this.toolDefinitions.filter((def) => {
            const allowedCallers = def.allowed_callers ?? ['direct'];
            if (!allowedCallers.includes('direct')) {
                return false;
            }
            if (def.defer_loading === true &&
                !this.discoveredToolNames.has(def.name)) {
                return false;
            }
            return true;
        });
        const schemaTools = schema$1.createSchemaOnlyTools(defsToInclude);
        const allTools = [...schemaTools];
        if (this.graphTools && this.graphTools.length > 0) {
            allTools.push(...this.graphTools);
        }
        if (this.tools && this.tools.length > 0) {
            allTools.push(...this.tools);
        }
        return allTools;
    }
    /** Filters tool instances for binding based on registry config */
    filterToolsForBinding(tools) {
        return tools.filter((tool) => {
            if (!('name' in tool)) {
                return true;
            }
            const toolDef = this.toolRegistry?.get(tool.name);
            if (!toolDef) {
                return true;
            }
            if (this.discoveredToolNames.has(tool.name)) {
                const allowedCallers = toolDef.allowed_callers ?? ['direct'];
                return allowedCallers.includes('direct');
            }
            const allowedCallers = toolDef.allowed_callers ?? ['direct'];
            return (allowedCallers.includes('direct') && toolDef.defer_loading !== true);
        });
    }
}

exports.AgentContext = AgentContext;
//# sourceMappingURL=AgentContext.cjs.map
