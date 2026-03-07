'use strict';

var prompts = require('@langchain/core/prompts');
var runnables = require('@langchain/core/runnables');
var _enum = require('../common/enum.cjs');

const defaultTitlePrompt = `Analyze this conversation and provide:
1. The detected language of the conversation
2. A concise title in the detected language (5 words or less, no punctuation or quotation)

{convo}`;
const titleSchema = {
    type: 'object',
    properties: {
        title: {
            type: 'string',
            description: 'A concise title for the conversation in 5 words or less, without punctuation or quotation',
        },
    },
    required: ['title'],
};
const combinedSchema = {
    type: 'object',
    properties: {
        language: {
            type: 'string',
            description: 'The detected language of the conversation',
        },
        title: {
            type: 'string',
            description: 'A concise title for the conversation in 5 words or less, without punctuation or quotation',
        },
    },
    required: ['language', 'title'],
};
const createTitleRunnable = async (model, _titlePrompt) => {
    // Disabled since this works fine
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    /* @ts-ignore */
    const titleLLM = model.withStructuredOutput(titleSchema);
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    /* @ts-ignore */
    const combinedLLM = model.withStructuredOutput(combinedSchema);
    const titlePrompt = prompts.ChatPromptTemplate.fromTemplate(_titlePrompt ?? defaultTitlePrompt).withConfig({ runName: 'TitlePrompt' });
    const titleOnlyInnerChain = runnables.RunnableSequence.from([titlePrompt, titleLLM]);
    const combinedInnerChain = runnables.RunnableSequence.from([titlePrompt, combinedLLM]);
    /** Wrap titleOnlyChain in RunnableLambda to create parent span */
    const titleOnlyChain = new runnables.RunnableLambda({
        func: async (input, config) => {
            const result = await titleOnlyInnerChain.invoke(input, config);
            return result;
        },
    }).withConfig({ runName: 'TitleOnlyChain' });
    /** Wrap combinedChain in RunnableLambda to create parent span */
    const combinedChain = new runnables.RunnableLambda({
        func: async (input, config) => {
            const result = await combinedInnerChain.invoke(input, config);
            return result;
        },
    }).withConfig({ runName: 'TitleLanguageChain' });
    /** Runnable to add default values if needed */
    const addDefaults = new runnables.RunnableLambda({
        func: (result) => ({
            language: result?.language ?? 'English',
            title: result?.title ?? '',
        }),
    }).withConfig({ runName: 'AddDefaults' });
    const combinedChainInner = runnables.RunnableSequence.from([
        combinedChain,
        addDefaults,
    ]);
    /** Wrap combinedChainWithDefaults in RunnableLambda to create parent span */
    const combinedChainWithDefaults = new runnables.RunnableLambda({
        func: async (input, config) => {
            return await combinedChainInner.invoke(input, config);
        },
    }).withConfig({ runName: 'CombinedChainWithDefaults' });
    return new runnables.RunnableLambda({
        func: async (input, config) => {
            const invokeInput = { convo: input.convo };
            if (input.skipLanguage) {
                return (await titleOnlyChain.invoke(invokeInput, config));
            }
            return await combinedChainWithDefaults.invoke(invokeInput, config);
        },
    }).withConfig({ runName: 'TitleGenerator' });
};
const defaultCompletionPrompt = `Provide a concise, 5-word-or-less title for the conversation, using title case conventions. Only return the title itself.

Conversation:
{convo}`;
const createCompletionTitleRunnable = async (model, titlePrompt) => {
    const completionPrompt = prompts.ChatPromptTemplate.fromTemplate(titlePrompt ?? defaultCompletionPrompt).withConfig({ runName: 'CompletionTitlePrompt' });
    /** Runnable to extract content from model response */
    const extractContent = new runnables.RunnableLambda({
        func: (response) => {
            let content = '';
            if (typeof response.content === 'string') {
                content = response.content;
            }
            else if (Array.isArray(response.content)) {
                content = response.content
                    .filter((part) => part.type === _enum.ContentTypes.TEXT)
                    .map((part) => part.text)
                    .join('');
            }
            return { title: content.trim() };
        },
    }).withConfig({ runName: 'ExtractTitle' });
    const innerChain = runnables.RunnableSequence.from([
        completionPrompt,
        model,
        extractContent,
    ]);
    /** Wrap in RunnableLambda to create a parent span for LangFuse */
    return new runnables.RunnableLambda({
        func: async (input, config) => {
            return await innerChain.invoke(input, config);
        },
    }).withConfig({ runName: 'CompletionTitleChain' });
};

exports.createCompletionTitleRunnable = createCompletionTitleRunnable;
exports.createTitleRunnable = createTitleRunnable;
//# sourceMappingURL=title.cjs.map
