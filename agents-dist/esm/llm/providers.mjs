import { ChatMistralAI } from '@langchain/mistralai';
import { ChatMoonshot, ChatDeepSeek, AzureChatOpenAI, ChatOpenAI, ChatXAI } from './openai/index.mjs';
import { CustomChatGoogleGenerativeAI } from './google/index.mjs';
import { CustomChatBedrockConverse } from './bedrock/index.mjs';
import { CustomAnthropic } from './anthropic/index.mjs';
import { ChatOpenRouter } from './openrouter/index.mjs';
import { ChatVertexAI } from './vertexai/index.mjs';
import { Providers } from '../common/enum.mjs';

// src/llm/providers.ts
const llmProviders = {
    [Providers.XAI]: ChatXAI,
    [Providers.OPENAI]: ChatOpenAI,
    [Providers.AZURE]: AzureChatOpenAI,
    [Providers.VERTEXAI]: ChatVertexAI,
    [Providers.DEEPSEEK]: ChatDeepSeek,
    [Providers.MISTRALAI]: ChatMistralAI,
    [Providers.MISTRAL]: ChatMistralAI,
    [Providers.ANTHROPIC]: CustomAnthropic,
    [Providers.OPENROUTER]: ChatOpenRouter,
    [Providers.BEDROCK]: CustomChatBedrockConverse,
    // [Providers.ANTHROPIC]: ChatAnthropic,
    [Providers.GOOGLE]: CustomChatGoogleGenerativeAI,
    [Providers.MOONSHOT]: ChatMoonshot,
};
const manualToolStreamProviders = new Set([
    Providers.ANTHROPIC,
    Providers.BEDROCK,
]);
const getChatModelClass = (provider) => {
    const ChatModelClass = llmProviders[provider];
    if (!ChatModelClass) {
        throw new Error(`Unsupported LLM provider: ${provider}`);
    }
    return ChatModelClass;
};

export { getChatModelClass, llmProviders, manualToolStreamProviders };
//# sourceMappingURL=providers.mjs.map
