/**
 * Enum representing the various event types emitted during the execution of runnables.
 * These events provide real-time information about the progress and state of different components.
 *
 * @enum {string}
 */
var GraphEvents;
(function (GraphEvents) {
    /* Custom Events */
    /** [Custom] Agent update event in multi-agent graph/workflow */
    GraphEvents["ON_AGENT_UPDATE"] = "on_agent_update";
    /** [Custom] Delta event for run steps (message creation and tool calls) */
    GraphEvents["ON_RUN_STEP"] = "on_run_step";
    /** [Custom] Delta event for run steps (tool calls) */
    GraphEvents["ON_RUN_STEP_DELTA"] = "on_run_step_delta";
    /** [Custom] Completed event for run steps (tool calls) */
    GraphEvents["ON_RUN_STEP_COMPLETED"] = "on_run_step_completed";
    /** [Custom] Delta events for messages */
    GraphEvents["ON_MESSAGE_DELTA"] = "on_message_delta";
    /** [Custom] Reasoning Delta events for messages */
    GraphEvents["ON_REASONING_DELTA"] = "on_reasoning_delta";
    /** [Custom] Request to execute tools - dispatched by ToolNode, handled by host */
    GraphEvents["ON_TOOL_EXECUTE"] = "on_tool_execute";
    /* Official Events */
    /** Custom event, emitted by system */
    GraphEvents["ON_CUSTOM_EVENT"] = "on_custom_event";
    /** Emitted when a chat model starts processing. */
    GraphEvents["CHAT_MODEL_START"] = "on_chat_model_start";
    /** Emitted when a chat model streams a chunk of its response. */
    GraphEvents["CHAT_MODEL_STREAM"] = "on_chat_model_stream";
    /** Emitted when a chat model completes its processing. */
    GraphEvents["CHAT_MODEL_END"] = "on_chat_model_end";
    /** Emitted when a language model starts processing. */
    GraphEvents["LLM_START"] = "on_llm_start";
    /** Emitted when a language model streams a chunk of its response. */
    GraphEvents["LLM_STREAM"] = "on_llm_stream";
    /** Emitted when a language model completes its processing. */
    GraphEvents["LLM_END"] = "on_llm_end";
    /** Emitted when a chain starts processing. */
    GraphEvents["CHAIN_START"] = "on_chain_start";
    /** Emitted when a chain streams a chunk of its output. */
    GraphEvents["CHAIN_STREAM"] = "on_chain_stream";
    /** Emitted when a chain completes its processing. */
    GraphEvents["CHAIN_END"] = "on_chain_end";
    /** Emitted when a tool starts its operation. */
    GraphEvents["TOOL_START"] = "on_tool_start";
    /** Emitted when a tool completes its operation. */
    GraphEvents["TOOL_END"] = "on_tool_end";
    /** Emitted when a retriever starts its operation. */
    GraphEvents["RETRIEVER_START"] = "on_retriever_start";
    /** Emitted when a retriever completes its operation. */
    GraphEvents["RETRIEVER_END"] = "on_retriever_end";
    /** Emitted when a prompt starts processing. */
    GraphEvents["PROMPT_START"] = "on_prompt_start";
    /** Emitted when a prompt completes its processing. */
    GraphEvents["PROMPT_END"] = "on_prompt_end";
})(GraphEvents || (GraphEvents = {}));
var Providers;
(function (Providers) {
    Providers["OPENAI"] = "openAI";
    Providers["VERTEXAI"] = "vertexai";
    Providers["BEDROCK"] = "bedrock";
    Providers["ANTHROPIC"] = "anthropic";
    Providers["MISTRALAI"] = "mistralai";
    Providers["MISTRAL"] = "mistral";
    Providers["GOOGLE"] = "google";
    Providers["AZURE"] = "azureOpenAI";
    Providers["DEEPSEEK"] = "deepseek";
    Providers["OPENROUTER"] = "openrouter";
    Providers["XAI"] = "xai";
    Providers["MOONSHOT"] = "moonshot";
})(Providers || (Providers = {}));
var GraphNodeKeys;
(function (GraphNodeKeys) {
    GraphNodeKeys["TOOLS"] = "tools=";
    GraphNodeKeys["AGENT"] = "agent=";
    GraphNodeKeys["ROUTER"] = "router";
    GraphNodeKeys["PRE_TOOLS"] = "pre_tools";
    GraphNodeKeys["POST_TOOLS"] = "post_tools";
})(GraphNodeKeys || (GraphNodeKeys = {}));
var GraphNodeActions;
(function (GraphNodeActions) {
    GraphNodeActions["TOOL_NODE"] = "tool_node";
    GraphNodeActions["CALL_MODEL"] = "call_model";
    GraphNodeActions["ROUTE_MESSAGE"] = "route_message";
})(GraphNodeActions || (GraphNodeActions = {}));
var CommonEvents;
(function (CommonEvents) {
    CommonEvents["LANGGRAPH"] = "LangGraph";
})(CommonEvents || (CommonEvents = {}));
var StepTypes;
(function (StepTypes) {
    StepTypes["TOOL_CALLS"] = "tool_calls";
    StepTypes["MESSAGE_CREATION"] = "message_creation";
})(StepTypes || (StepTypes = {}));
var ContentTypes;
(function (ContentTypes) {
    ContentTypes["TEXT"] = "text";
    ContentTypes["ERROR"] = "error";
    ContentTypes["THINK"] = "think";
    ContentTypes["TOOL_CALL"] = "tool_call";
    ContentTypes["IMAGE_URL"] = "image_url";
    ContentTypes["IMAGE_FILE"] = "image_file";
    /** Anthropic */
    ContentTypes["THINKING"] = "thinking";
    /** Vertex AI / Google Common */
    ContentTypes["REASONING"] = "reasoning";
    /** Multi-Agent Switch */
    ContentTypes["AGENT_UPDATE"] = "agent_update";
    /** Bedrock */
    ContentTypes["REASONING_CONTENT"] = "reasoning_content";
})(ContentTypes || (ContentTypes = {}));
var ToolCallTypes;
(function (ToolCallTypes) {
    ToolCallTypes["FUNCTION"] = "function";
    ToolCallTypes["RETRIEVAL"] = "retrieval";
    ToolCallTypes["FILE_SEARCH"] = "file_search";
    ToolCallTypes["CODE_INTERPRETER"] = "code_interpreter";
    /* Agents Tool Call */
    ToolCallTypes["TOOL_CALL"] = "tool_call";
})(ToolCallTypes || (ToolCallTypes = {}));
var Callback;
(function (Callback) {
    Callback["TOOL_ERROR"] = "handleToolError";
    Callback["TOOL_START"] = "handleToolStart";
    Callback["TOOL_END"] = "handleToolEnd";
    Callback["CUSTOM_EVENT"] = "handleCustomEvent";
    /*
    LLM_START = 'handleLLMStart',
    LLM_NEW_TOKEN = 'handleLLMNewToken',
    LLM_ERROR = 'handleLLMError',
    LLM_END = 'handleLLMEnd',
    CHAT_MODEL_START = 'handleChatModelStart',
    CHAIN_START = 'handleChainStart',
    CHAIN_ERROR = 'handleChainError',
    CHAIN_END = 'handleChainEnd',
    TEXT = 'handleText',
    AGENT_ACTION = 'handleAgentAction',
    AGENT_END = 'handleAgentEnd',
    RETRIEVER_START = 'handleRetrieverStart',
    RETRIEVER_END = 'handleRetrieverEnd',
    RETRIEVER_ERROR = 'handleRetrieverError',
    */
})(Callback || (Callback = {}));
var Constants;
(function (Constants) {
    Constants["OFFICIAL_CODE_BASEURL"] = "https://api.librechat.ai/v1";
    Constants["EXECUTE_CODE"] = "execute_code";
    Constants["TOOL_SEARCH"] = "tool_search";
    Constants["PROGRAMMATIC_TOOL_CALLING"] = "run_tools_with_code";
    Constants["WEB_SEARCH"] = "web_search";
    Constants["CONTENT_AND_ARTIFACT"] = "content_and_artifact";
    Constants["LC_TRANSFER_TO_"] = "lc_transfer_to_";
    /** Delimiter for MCP tools: toolName_mcp_serverName */
    Constants["MCP_DELIMITER"] = "_mcp_";
})(Constants || (Constants = {}));
var TitleMethod;
(function (TitleMethod) {
    TitleMethod["STRUCTURED"] = "structured";
    TitleMethod["FUNCTIONS"] = "functions";
    TitleMethod["COMPLETION"] = "completion";
})(TitleMethod || (TitleMethod = {}));
var EnvVar;
(function (EnvVar) {
    EnvVar["CODE_API_KEY"] = "LIBRECHAT_CODE_API_KEY";
    EnvVar["CODE_BASEURL"] = "LIBRECHAT_CODE_BASEURL";
})(EnvVar || (EnvVar = {}));

export { Callback, CommonEvents, Constants, ContentTypes, EnvVar, GraphEvents, GraphNodeActions, GraphNodeKeys, Providers, StepTypes, TitleMethod, ToolCallTypes };
//# sourceMappingURL=enum.mjs.map
