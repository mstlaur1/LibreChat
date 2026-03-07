'use strict';

var mistralai = require('@langchain/mistralai');
var index = require('./openai/index.cjs');
var index$1 = require('./google/index.cjs');
var index$2 = require('./bedrock/index.cjs');
var index$4 = require('./anthropic/index.cjs');
var index$3 = require('./openrouter/index.cjs');
var index$5 = require('./vertexai/index.cjs');
var _enum = require('../common/enum.cjs');

// src/llm/providers.ts
const llmProviders = {
    [_enum.Providers.XAI]: index.ChatXAI,
    [_enum.Providers.OPENAI]: index.ChatOpenAI,
    [_enum.Providers.AZURE]: index.AzureChatOpenAI,
    [_enum.Providers.VERTEXAI]: index$5.ChatVertexAI,
    [_enum.Providers.DEEPSEEK]: index.ChatDeepSeek,
    [_enum.Providers.MISTRALAI]: mistralai.ChatMistralAI,
    [_enum.Providers.MISTRAL]: mistralai.ChatMistralAI,
    [_enum.Providers.ANTHROPIC]: index$4.CustomAnthropic,
    [_enum.Providers.OPENROUTER]: index$3.ChatOpenRouter,
    [_enum.Providers.BEDROCK]: index$2.CustomChatBedrockConverse,
    // [Providers.ANTHROPIC]: ChatAnthropic,
    [_enum.Providers.GOOGLE]: index$1.CustomChatGoogleGenerativeAI,
    [_enum.Providers.MOONSHOT]: index.ChatMoonshot,
};
const manualToolStreamProviders = new Set([
    _enum.Providers.ANTHROPIC,
    _enum.Providers.BEDROCK,
]);
const getChatModelClass = (provider) => {
    const ChatModelClass = llmProviders[provider];
    if (!ChatModelClass) {
        throw new Error(`Unsupported LLM provider: ${provider}`);
    }
    return ChatModelClass;
};

exports.getChatModelClass = getChatModelClass;
exports.llmProviders = llmProviders;
exports.manualToolStreamProviders = manualToolStreamProviders;
//# sourceMappingURL=providers.cjs.map
