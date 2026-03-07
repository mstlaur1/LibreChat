import { Providers } from '../common/enum.mjs';

// src/utils/llm.ts
function isOpenAILike(provider) {
    if (provider == null) {
        return false;
    }
    return [
        Providers.OPENAI,
        Providers.AZURE,
        Providers.OPENROUTER,
        Providers.XAI,
        Providers.DEEPSEEK,
    ].includes(provider);
}
function isGoogleLike(provider) {
    if (provider == null) {
        return false;
    }
    return [Providers.GOOGLE, Providers.VERTEXAI].includes(provider);
}

export { isGoogleLike, isOpenAILike };
//# sourceMappingURL=llm.mjs.map
