'use strict';

var _enum = require('../common/enum.cjs');

// src/utils/llm.ts
function isOpenAILike(provider) {
    if (provider == null) {
        return false;
    }
    return [
        _enum.Providers.OPENAI,
        _enum.Providers.AZURE,
        _enum.Providers.OPENROUTER,
        _enum.Providers.XAI,
        _enum.Providers.DEEPSEEK,
    ].includes(provider);
}
function isGoogleLike(provider) {
    if (provider == null) {
        return false;
    }
    return [_enum.Providers.GOOGLE, _enum.Providers.VERTEXAI].includes(provider);
}

exports.isGoogleLike = isGoogleLike;
exports.isOpenAILike = isOpenAILike;
//# sourceMappingURL=llm.cjs.map
